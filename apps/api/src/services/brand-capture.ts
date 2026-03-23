import { chromium, type Browser, type Page } from "playwright";
import { createLLMAdapter } from "@bidwright/agent";
import type { BrandProfile } from "@bidwright/domain";

// ── Types ────────────────────────────────────────────────────────────────────

interface CrawledPage {
  url: string;
  title: string;
  content: string;
}

interface CrawlResult {
  pages: CrawledPage[];
  allContent: string;
}

export interface BrandCaptureConfig {
  provider: string;
  apiKey: string;
  model: string;
}

// ── Priority paths to crawl first ────────────────────────────────────────────

const PRIORITY_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/services",
  "/what-we-do",
  "/industries",
  "/contact",
  "/contact-us",
  "/team",
  "/our-team",
  "/products",
  "/solutions",
];

// ── URL helpers ──────────────────────────────────────────────────────────────

function stripWww(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function normalizeUrl(url: string, preferredOrigin?: string): string {
  try {
    const parsed = new URL(url);
    if (preferredOrigin) {
      const preferred = new URL(preferredOrigin);
      if (stripWww(parsed.hostname) === stripWww(preferred.hostname)) {
        parsed.protocol = preferred.protocol;
        parsed.host = preferred.host;
      }
    }
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}

function isInternalUrl(url: string, baseHostname: string): boolean {
  try {
    const parsed = new URL(url);
    if (stripWww(parsed.hostname) !== baseHostname) return false;
    const skipExtensions = [
      ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
      ".css", ".js", ".zip", ".doc", ".docx", ".xls", ".xlsx",
      ".mp3", ".mp4", ".avi", ".mov", ".ico", ".woff", ".woff2", ".ttf", ".eot",
    ];
    const pathname = parsed.pathname.toLowerCase();
    if (skipExtensions.some((ext) => pathname.endsWith(ext))) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Page helpers ─────────────────────────────────────────────────────────────

async function stabilizePage(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(750);

  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const docHeight = Math.min(document.body?.scrollHeight || 0, 8000);
    const step = Math.max(window.innerHeight, 600);
    for (let offset = 0; offset <= docHeight; offset += step) {
      window.scrollTo(0, offset);
      await delay(150);
    }
    window.scrollTo(0, 0);
  }).catch(() => {});

  await page.waitForTimeout(250);
}

async function extractPageContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const normalizeText = (v: string): string =>
      v.replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

    const collectLines = (root: ParentNode): string[] => {
      const selectors = "h1,h2,h3,h4,p,li,dt,dd,address,a[href^='tel:'],a[href^='mailto:']";
      return Array.from(root.querySelectorAll(selectors))
        .map((node) => normalizeText(node.textContent || ""))
        .filter((line) => line.length >= 3 && /[a-z]/i.test(line));
    };

    const collectLinkSignals = (root: ParentNode): string[] =>
      Array.from(root.querySelectorAll("a[href]"))
        .map((node) => {
          const a = node as HTMLAnchorElement;
          const href = a.getAttribute("href") || "";
          const label = normalizeText(a.textContent || "");
          if (href.startsWith("mailto:")) {
            const email = href.replace(/^mailto:/i, "").trim();
            return email ? `Email: ${email}${label ? ` (${label})` : ""}` : "";
          }
          if (href.startsWith("tel:")) {
            const phone = href.replace(/^tel:/i, "").trim();
            return phone ? `Phone: ${phone}${label ? ` (${label})` : ""}` : "";
          }
          if (/linkedin\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com/i.test(href))
            return label ? `Social: ${label} -> ${href}` : `Social: ${href}`;
          return "";
        })
        .filter((l) => l.length >= 3);

    const dedupe = (vals: string[]): string[] => {
      const seen = new Set<string>();
      return vals.filter((v) => {
        const k = v.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };

    const meta = [
      document.title,
      document.querySelector("meta[name='description']")?.getAttribute("content"),
      document.querySelector("meta[property='og:description']")?.getAttribute("content"),
    ].map((v) => normalizeText(v || "")).filter(Boolean);

    const mainRoot = document.querySelector("main, [role='main'], article") || document.body;
    const semanticLines = dedupe(collectLines(mainRoot));
    const linkSignals = dedupe(collectLinkSignals(document.body));
    const fallbackLines = semanticLines.length >= 10 ? [] : dedupe(collectLines(document.body)).slice(0, 120);
    const combined = dedupe([...meta, ...semanticLines, ...linkSignals, ...fallbackLines]);
    const joined = combined.join("\n");
    return joined.length >= 200 ? joined : normalizeText(document.body?.innerText || "");
  });
}

async function extractBrandSignals(page: Page): Promise<string> {
  return page.evaluate(() => {
    const signals: string[] = [];

    // Extract theme-color meta
    const themeColor = document.querySelector("meta[name='theme-color']")?.getAttribute("content");
    if (themeColor) signals.push(`Theme color: ${themeColor}`);

    // Extract favicon / logo candidates
    const icons = document.querySelectorAll("link[rel*='icon'], link[rel='apple-touch-icon']");
    icons.forEach((el) => {
      const href = el.getAttribute("href");
      if (href) signals.push(`Icon: ${href}`);
    });

    // Extract OG image (often the logo)
    const ogImage = document.querySelector("meta[property='og:image']")?.getAttribute("content");
    if (ogImage) signals.push(`OG image: ${ogImage}`);

    // Extract CSS custom properties from :root for brand colors
    const rootStyles = getComputedStyle(document.documentElement);
    const colorProps = ["--primary", "--accent", "--brand", "--color-primary", "--color-accent", "--color-brand"];
    for (const prop of colorProps) {
      const val = rootStyles.getPropertyValue(prop).trim();
      if (val) signals.push(`CSS ${prop}: ${val}`);
    }

    // Look for logo images
    const logoImgs = document.querySelectorAll("img[class*='logo'], img[alt*='logo'], img[id*='logo'], header img");
    logoImgs.forEach((img) => {
      const src = (img as HTMLImageElement).src;
      const alt = (img as HTMLImageElement).alt;
      if (src) signals.push(`Logo candidate: ${src} (alt: ${alt || "none"})`);
    });

    return signals.join("\n");
  });
}

// ── BFS Crawler ──────────────────────────────────────────────────────────────

async function crawlWebsite(url: string, maxPages = 8): Promise<CrawlResult & { brandSignals: string }> {
  let browser: Browser | null = null;

  try {
    const baseUrl = new URL(url);
    const baseOrigin = baseUrl.origin;
    const baseHostname = stripWww(baseUrl.hostname);
    let canonicalOrigin: string | undefined;

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      userAgent: "Mozilla/5.0 (compatible; BidwrightBot/1.0)",
    });
    const page = await context.newPage();

    const visited = new Set<string>();
    const pages: CrawledPage[] = [];
    let allBrandSignals = "";

    const priorityQueue: string[] = PRIORITY_PATHS.map((p) => normalizeUrl(baseOrigin + p));
    const bfsQueue: string[] = [];

    const rootNormalized = normalizeUrl(url);
    if (!priorityQueue.includes(rootNormalized)) priorityQueue.unshift(rootNormalized);

    const getNext = (): string | undefined => {
      while (priorityQueue.length > 0) {
        const next = priorityQueue.shift()!;
        if (!visited.has(next)) return next;
      }
      while (bfsQueue.length > 0) {
        const next = bfsQueue.shift()!;
        if (!visited.has(next)) return next;
      }
      return undefined;
    };

    let nextUrl: string | undefined;
    while ((nextUrl = getNext()) !== undefined && pages.length < maxPages) {
      const currentUrl = nextUrl;
      visited.add(currentUrl);

      try {
        const response = await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        if (!response || response.status() >= 400) continue;

        await stabilizePage(page);

        const finalUrl = page.url();
        if (!isInternalUrl(finalUrl, baseHostname)) continue;

        canonicalOrigin = new URL(finalUrl).origin;
        const normalizedFinal = normalizeUrl(finalUrl, canonicalOrigin);
        visited.add(normalizedFinal);

        const title = await page.title();
        const content = await extractPageContent(page);

        // Extract brand signals from home page
        if (pages.length === 0) {
          allBrandSignals = await extractBrandSignals(page);
        }

        if (content.length > 50) {
          pages.push({ url: finalUrl, title: title || "", content: content.slice(0, 10000) });
        }

        // Discover links
        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]"))
            .map((a) => { try { return new URL((a as HTMLAnchorElement).href, window.location.href).href; } catch { return null; } })
            .filter((h): h is string => h !== null)
        );

        for (const link of links) {
          if (!isInternalUrl(link, baseHostname)) continue;
          const normalized = normalizeUrl(link, canonicalOrigin);
          if (!visited.has(normalized) && !priorityQueue.includes(normalized) && !bfsQueue.includes(normalized)) {
            bfsQueue.push(normalized);
          }
        }
      } catch {
        continue;
      }
    }

    await context.close();

    const allContent = pages.map((p) => `--- ${p.title} (${p.url}) ---\n${p.content}`).join("\n\n");
    return { pages, allContent, brandSignals: allBrandSignals };
  } finally {
    if (browser) await browser.close();
  }
}

// ── LLM Brand Extraction ─────────────────────────────────────────────────────

const BRAND_EXTRACTION_PROMPT = `You are a brand analyst. Extract a structured brand profile from the provided website content and brand signals.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "companyName": "official company name",
  "tagline": "tagline or slogan if found",
  "industry": "primary industry or sector",
  "description": "2-3 sentence summary of what the company does",
  "services": ["list of services or products offered"],
  "targetMarkets": ["target markets, industries, or customer segments"],
  "brandVoice": "description of brand tone and communication style (professional, casual, technical, etc.)",
  "colors": {
    "primary": "#hex color or empty string",
    "secondary": "#hex color or empty string",
    "accent": "#hex color or empty string"
  },
  "logoUrl": "URL to the company logo if found, empty string otherwise",
  "socialLinks": {
    "linkedin": "url or empty",
    "twitter": "url or empty",
    "facebook": "url or empty",
    "instagram": "url or empty",
    "youtube": "url or empty"
  }
}

Rules:
- Only include information explicitly found in the content
- Do not fabricate any information
- Only include social link fields that were actually found
- For colors, extract from CSS variables, theme-color meta, or dominant visual colors mentioned
- For logoUrl, prefer SVG or PNG logo URLs found in the content
- Do not include any text outside the JSON object`;

function extractJson(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : text.trim();
}

export async function captureBrand(websiteUrl: string, config: BrandCaptureConfig): Promise<BrandProfile> {
  // Crawl the website
  const { allContent, brandSignals } = await crawlWebsite(websiteUrl, 8);

  // Build the LLM prompt
  const userPrompt = `Analyze the following website content for brand extraction.

--- BRAND SIGNALS ---
${brandSignals}
--- END SIGNALS ---

--- WEBSITE CONTENT ---
${allContent.slice(0, 20000)}
--- END CONTENT ---`;

  // Call the LLM
  const adapter = createLLMAdapter({
    provider: config.provider as any,
    apiKey: config.apiKey,
    model: config.model,
  });

  const response = await adapter.chat({
    messages: [
      { role: "system", content: BRAND_EXTRACTION_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    maxTokens: 1500,
  });

  const text = typeof response.content[0] === "string"
    ? response.content[0]
    : (response.content[0] as { text?: string }).text ?? "";

  const parsed = JSON.parse(extractJson(text));

  return {
    companyName: parsed.companyName || "",
    tagline: parsed.tagline || "",
    industry: parsed.industry || "",
    description: parsed.description || "",
    services: Array.isArray(parsed.services) ? parsed.services : [],
    targetMarkets: Array.isArray(parsed.targetMarkets) ? parsed.targetMarkets : [],
    brandVoice: parsed.brandVoice || "",
    colors: {
      primary: parsed.colors?.primary || "",
      secondary: parsed.colors?.secondary || "",
      accent: parsed.colors?.accent || "",
    },
    logoUrl: parsed.logoUrl || "",
    socialLinks: parsed.socialLinks || {},
    websiteUrl,
    lastCapturedAt: new Date().toISOString(),
  };
}

// Export crawler for reuse by agent tools
export { crawlWebsite, extractPageContent, stabilizePage };

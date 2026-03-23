import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";

type WebOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<Omit<ToolResult, "duration_ms">>;

function createWebTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  tags: string[];
  mutates?: boolean;
}, operation: WebOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "web",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: false,
      mutates: def.mutates ?? false,
      tags: def.tags,
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try {
        const result = await operation(context, input);
        return { ...result, duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

// ── Shared Playwright helpers ────────────────────────────────────────────────

async function launchBrowser() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  return { browser, context, page };
}

async function stabilizePage(page: import("playwright").Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function extractPageContent(page: import("playwright").Page): Promise<string> {
  return page.evaluate(() => {
    const normalize = (v: string): string => v.replace(/\s+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

    const lines = (root: ParentNode): string[] => {
      const sel = "h1,h2,h3,h4,p,li,dt,dd,address,blockquote,figcaption,td,th";
      return Array.from(root.querySelectorAll(sel))
        .map((n) => normalize(n.textContent || ""))
        .filter((l) => l.length >= 3 && /[a-z]/i.test(l));
    };

    const dedupe = (vals: string[]): string[] => {
      const seen = new Set<string>();
      return vals.filter((v) => { const k = v.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    };

    const meta = [
      document.title,
      document.querySelector("meta[name='description']")?.getAttribute("content"),
      document.querySelector("meta[property='og:description']")?.getAttribute("content"),
    ].map((v) => normalize(v || "")).filter(Boolean);

    const mainRoot = document.querySelector("main, [role='main'], article") || document.body;
    const semantic = dedupe(lines(mainRoot));
    const fallback = semantic.length >= 10 ? [] : dedupe(lines(document.body)).slice(0, 120);
    const combined = dedupe([...meta, ...semantic, ...fallback]);
    const joined = combined.join("\n");
    return joined.length >= 100 ? joined : normalize(document.body?.innerText || "");
  });
}

async function extractLinks(page: import("playwright").Page): Promise<Array<{ text: string; url: string }>> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => {
        const anchor = a as HTMLAnchorElement;
        const text = (anchor.textContent || "").replace(/\s+/g, " ").trim();
        try { return { text, url: new URL(anchor.href, window.location.href).href }; }
        catch { return null; }
      })
      .filter((l): l is { text: string; url: string } => l !== null && l.text.length > 0)
      .slice(0, 100)
  );
}

// ── web.browse ───────────────────────────────────────────────────────────────

export const browseTool = createWebTool({
  id: "web.browse",
  name: "Browse Website",
  description: "Navigate to a URL and extract the page content, title, and links. Use this to read web pages, documentation, supplier catalogs, or any online resource.",
  inputSchema: z.object({
    url: z.string().describe("The URL to navigate to"),
    extractMode: z.enum(["text", "structured", "full"]).optional().describe("text: just text content; structured: text + links; full: text + links + metadata. Default: structured"),
  }),
  tags: ["web", "browse", "read", "research"],
}, async (_ctx, input) => {
  const url = input.url as string;
  const mode = (input.extractMode as string) || "structured";

  const { browser, page } = await launchBrowser();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await stabilizePage(page);

    const title = await page.title();
    const finalUrl = page.url();
    const content = await extractPageContent(page);

    const result: Record<string, unknown> = { title, url: finalUrl, content: content.slice(0, 15000) };

    if (mode === "structured" || mode === "full") {
      result.links = await extractLinks(page);
    }

    if (mode === "full") {
      result.metadata = await page.evaluate(() => {
        const getMeta = (name: string) =>
          document.querySelector(`meta[name='${name}'], meta[property='${name}']`)?.getAttribute("content") || "";
        return {
          description: getMeta("description") || getMeta("og:description"),
          ogImage: getMeta("og:image"),
          ogTitle: getMeta("og:title"),
          canonical: document.querySelector("link[rel='canonical']")?.getAttribute("href") || "",
        };
      });
    }

    return { success: true, data: result };
  } finally {
    await browser.close();
  }
});

// ── web.search ───────────────────────────────────────────────────────────────

export const searchTool = createWebTool({
  id: "web.search",
  name: "Web Search",
  description: "Search the web using DuckDuckGo and return results with titles, URLs, and snippets. Use this to find suppliers, pricing data, product specs, code documentation, or any web information.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    maxResults: z.number().optional().describe("Maximum number of results to return (default: 8)"),
  }),
  tags: ["web", "search", "research"],
}, async (_ctx, input) => {
  const query = input.query as string;
  const maxResults = (input.maxResults as number) || 8;

  const { browser, page } = await launchBrowser();
  try {
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await stabilizePage(page);

    // Wait for results to render
    await page.waitForSelector("[data-result], .result, article", { timeout: 5000 }).catch(() => {});

    const results = await page.evaluate((max: number) => {
      const items: Array<{ title: string; url: string; snippet: string }> = [];

      // DuckDuckGo result selectors
      const resultEls = document.querySelectorAll("[data-result='web'], .result__body, article[data-testid='result']");

      for (const el of Array.from(resultEls)) {
        if (items.length >= max) break;

        const titleEl = el.querySelector("a[data-testid='result-title-a'], .result__a, h2 a");
        const snippetEl = el.querySelector("[data-result='snippet'], .result__snippet, span[data-testid='result-snippet']");

        const title = titleEl?.textContent?.trim() || "";
        const url = (titleEl as HTMLAnchorElement)?.href || "";
        const snippet = snippetEl?.textContent?.trim() || "";

        if (title && url) {
          items.push({ title, url, snippet });
        }
      }

      // Fallback: try generic link extraction if DDG layout changed
      if (items.length === 0) {
        const allLinks = document.querySelectorAll("a[href]");
        for (const a of Array.from(allLinks)) {
          if (items.length >= max) break;
          const anchor = a as HTMLAnchorElement;
          const href = anchor.href;
          if (href && !href.includes("duckduckgo.com") && !href.includes("javascript:") && anchor.textContent?.trim()) {
            items.push({ title: anchor.textContent.trim(), url: href, snippet: "" });
          }
        }
      }

      return items;
    }, maxResults);

    return { success: true, data: { query, results } };
  } finally {
    await browser.close();
  }
});

// ── web.screenshot ───────────────────────────────────────────────────────────

export const screenshotTool = createWebTool({
  id: "web.screenshot",
  name: "Screenshot Website",
  description: "Take a screenshot of a webpage. Returns the screenshot as a base64-encoded PNG. Useful for capturing visual layouts, checking how a page looks, or documenting web content.",
  inputSchema: z.object({
    url: z.string().describe("The URL to screenshot"),
    fullPage: z.boolean().optional().describe("Capture the full scrollable page (default: false, captures viewport only)"),
  }),
  tags: ["web", "screenshot", "vision"],
}, async (_ctx, input) => {
  const url = input.url as string;
  const fullPage = (input.fullPage as boolean) ?? false;

  const { browser, page } = await launchBrowser();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await stabilizePage(page);

    const buffer = await page.screenshot({ fullPage, type: "png" });
    const base64 = buffer.toString("base64");
    const title = await page.title();

    return {
      success: true,
      data: {
        title,
        url: page.url(),
        screenshot: `data:image/png;base64,${base64}`,
        width: 1440,
        height: fullPage ? undefined : 900,
      },
    };
  } finally {
    await browser.close();
  }
});

// ── web.extractTable ─────────────────────────────────────────────────────────

export const extractTableTool = createWebTool({
  id: "web.extractTable",
  name: "Extract Table from Website",
  description: "Extract tabular data from a webpage. Finds HTML tables and returns them as structured data with headers and rows. Useful for extracting pricing tables, spec sheets, or data grids.",
  inputSchema: z.object({
    url: z.string().describe("The URL to extract tables from"),
    selector: z.string().optional().describe("CSS selector to target a specific table (default: first table found)"),
    tableIndex: z.number().optional().describe("Index of the table to extract if multiple found (default: 0)"),
  }),
  tags: ["web", "table", "data", "extraction"],
}, async (_ctx, input) => {
  const url = input.url as string;
  const selector = (input.selector as string) || "table";
  const tableIndex = (input.tableIndex as number) || 0;

  const { browser, page } = await launchBrowser();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await stabilizePage(page);

    const tableData = await page.evaluate(({ sel, idx }: { sel: string; idx: number }) => {
      const tables = document.querySelectorAll(sel);
      if (tables.length === 0) return null;

      const table = tables[Math.min(idx, tables.length - 1)] as HTMLTableElement;

      const headers: string[] = [];
      const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
      if (headerRow) {
        headerRow.querySelectorAll("th, td").forEach((cell) => {
          headers.push((cell.textContent || "").trim());
        });
      }

      const rows: string[][] = [];
      const bodyRows = table.querySelectorAll("tbody tr") || table.querySelectorAll("tr");
      bodyRows.forEach((row, i) => {
        // Skip header row if no thead
        if (!table.querySelector("thead") && i === 0) return;
        const cells: string[] = [];
        row.querySelectorAll("td, th").forEach((cell) => {
          cells.push((cell.textContent || "").trim());
        });
        if (cells.length > 0) rows.push(cells);
      });

      return { headers, rows, tableCount: tables.length };
    }, { sel: selector, idx: tableIndex });

    if (!tableData) {
      return { success: false, error: `No tables found matching selector "${selector}" at ${url}` };
    }

    return { success: true, data: tableData };
  } finally {
    await browser.close();
  }
});

// ── web.fillForm ─────────────────────────────────────────────────────────────

export const fillFormTool = createWebTool({
  id: "web.fillForm",
  name: "Fill Web Form",
  description: "Fill in and optionally submit a web form. Provide field selectors and values. Useful for logging into supplier portals, submitting search queries on specialized sites, or interacting with web apps.",
  inputSchema: z.object({
    url: z.string().describe("The URL of the page with the form"),
    fields: z.array(z.object({
      selector: z.string().describe("CSS selector for the input field"),
      value: z.string().describe("Value to fill in"),
    })).describe("Array of fields to fill"),
    submitSelector: z.string().optional().describe("CSS selector for the submit button (if omitted, form is filled but not submitted)"),
    waitAfterSubmit: z.number().optional().describe("Milliseconds to wait after submit for page to update (default: 2000)"),
  }),
  tags: ["web", "form", "interact", "write"],
  mutates: true,
}, async (_ctx, input) => {
  const url = input.url as string;
  const fields = input.fields as Array<{ selector: string; value: string }>;
  const submitSelector = input.submitSelector as string | undefined;
  const waitAfterSubmit = (input.waitAfterSubmit as number) || 2000;

  const { browser, page } = await launchBrowser();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await stabilizePage(page);

    // Fill each field
    for (const field of fields) {
      await page.fill(field.selector, field.value);
    }

    let afterContent = "";
    if (submitSelector) {
      await page.click(submitSelector);
      await page.waitForTimeout(waitAfterSubmit);
      await stabilizePage(page);
      afterContent = (await extractPageContent(page)).slice(0, 10000);
    }

    return {
      success: true,
      data: {
        url: page.url(),
        title: await page.title(),
        fieldsFilledCount: fields.length,
        submitted: !!submitSelector,
        resultContent: afterContent || undefined,
      },
      sideEffects: submitSelector ? ["Submitted web form"] : undefined,
    };
  } finally {
    await browser.close();
  }
});

// ── Export all web tools ─────────────────────────────────────────────────────

export const webTools: Tool[] = [
  browseTool,
  searchTool,
  screenshotTool,
  extractTableTool,
  fillFormTool,
];

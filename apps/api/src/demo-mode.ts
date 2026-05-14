import type { PrismaClient } from "@bidwright/db";
import { seedAllForOrganization } from "@bidwright/db";

export const DEMO_DISABLED_MESSAGE =
  "This public demo saves quote, client, worksheet, phase, factor, condition, library, document, and manual takeoff data, but disables AI, agent CLI, uploads, package/file ingest, vision and auto-takeoff processing, email delivery, external integrations, plugin execution, and PDF generation.";

export type DemoIdentity = {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    active: boolean;
    organizationId: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    settings?: { general?: unknown } | null;
  };
};

export function isApiDemoMode() {
  return process.env.BIDWRIGHT_DEMO_MODE === "1" || process.env.BIDWRIGHT_PUBLIC_DEMO === "1";
}

export function resetDemoIdentityCache() {
  // Kept for older call sites/tests. Public demo identity is intentionally
  // revalidated on each request so an external demo DB reset is repaired by
  // the next request instead of serving a stale in-memory identity.
}

export async function ensureDemoIdentity(prisma: PrismaClient): Promise<DemoIdentity> {
  if (!isApiDemoMode()) {
    throw new Error("Bidwright demo identity requested outside demo mode");
  }

  return ensureDemoIdentityUncached(prisma);
}

async function ensureDemoIdentityUncached(prisma: PrismaClient): Promise<DemoIdentity> {
  const slug = normalizeSlug(process.env.BIDWRIGHT_DEMO_ORG_SLUG || "demo");
  const orgName = (process.env.BIDWRIGHT_DEMO_ORG_NAME || "Bidwright Demo").trim() || "Bidwright Demo";
  const email = (process.env.BIDWRIGHT_DEMO_USER_EMAIL || "demo@bidwright.app").trim().toLowerCase();
  const name = (process.env.BIDWRIGHT_DEMO_USER_NAME || "Bidwright Demo User").trim() || "Bidwright Demo User";

  const org = await prisma.organization.upsert({
    where: { slug },
    update: { name: orgName },
    create: { id: `demo-org-${slug}`, name: orgName, slug },
    select: { id: true, name: true, slug: true, settings: { select: { general: true } } },
  });

  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {
      general: { orgName, companyName: orgName, language: "en" },
      defaults: {
        defaultMarkup: 15,
        breakoutStyle: "category",
        quoteType: "Firm",
        timezone: "America/Toronto",
        currency: "USD",
        benchmarkingEnabled: false,
      },
      integrations: {
        llmProvider: "none",
        documentExtractionProvider: "none",
        drawingExtractionProvider: "none",
        drawingExtractionEnabled: false,
        maxConcurrentSubAgents: 0,
      },
      brand: {
        companyName: orgName,
        industry: "Construction estimating",
        description: "Public Bidwright demo workspace.",
        websiteUrl: "https://bidwright.app",
      },
    },
    create: {
      organizationId: org.id,
      general: { orgName, companyName: orgName, language: "en" },
      defaults: {
        defaultMarkup: 15,
        breakoutStyle: "category",
        quoteType: "Firm",
        timezone: "America/Toronto",
        currency: "USD",
        benchmarkingEnabled: false,
      },
      integrations: {
        llmProvider: "none",
        documentExtractionProvider: "none",
        drawingExtractionProvider: "none",
        drawingExtractionEnabled: false,
        maxConcurrentSubAgents: 0,
      },
      brand: {
        companyName: orgName,
        industry: "Construction estimating",
        description: "Public Bidwright demo workspace.",
        websiteUrl: "https://bidwright.app",
      },
    },
  });

  const user = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email } },
    update: { name, role: "admin", active: true },
    create: {
      id: "demo-user",
      organizationId: org.id,
      email,
      name,
      role: "admin",
      active: true,
      passwordHash: "demo-login-disabled",
    },
    select: { id: true, email: true, name: true, role: true, active: true, organizationId: true },
  });

  const projectCount = await prisma.project.count({ where: { organizationId: org.id } });
  if (projectCount === 0) {
    await seedAllForOrganization(prisma, org.id);
  }

  const hydratedOrg = await prisma.organization.findUnique({
    where: { id: org.id },
    select: { id: true, name: true, slug: true, settings: { select: { general: true } } },
  });

  return { user, organization: hydratedOrg ?? org };
}

export function demoDisabledPayload(path?: string) {
  return { error: "Demo feature disabled", message: DEMO_DISABLED_MESSAGE, path };
}

export function isDemoDisabledRequest(method: string, requestUrl: string) {
  if (!isApiDemoMode()) return false;

  const path = requestUrl.split("?")[0] || "/";
  const normalizedMethod = method.toUpperCase();

  if (path === "/health" || path === "/api/demo/status") return false;
  if (path === "/api/setup/status") return false;
  if (path === "/api/auth/me" || path === "/api/auth/logout" || path === "/api/auth/login") return false;
  if (path === "/api/auth/organizations" || path === "/api/auth/switch-org") return false;
  if (path === "/settings" || path === "/settings/brand" || path === "/settings/user" || path === "/user-settings") return false;

  if (path === "/api/setup/init" || path === "/api/auth/signup" || path === "/api/auth/super-login") return true;
  if (path === "/api/auth/profile" && normalizedMethod !== "GET") return true;
  if (path.startsWith("/api/admin/")) return true;
  if (path.startsWith("/api/cli") || path.startsWith("/cli")) return true;
  if (path.startsWith("/api/review") || path.startsWith("/api/estimate")) return true;
  if (path.startsWith("/api/vision")) return true;
  if (path.startsWith("/api/takeoff")) {
    const lowerTakeoffPath = path.toLowerCase();
    return lowerTakeoffPath.includes("/process") ||
      lowerTakeoffPath.includes("/auto") ||
      lowerTakeoffPath.includes("/dwg-metadata");
  }
  if (path.startsWith("/api/model") || path.startsWith("/model")) return true;
  if (path.startsWith("/api/files/") && path.includes("/ingest")) return true;
  if (path.startsWith("/api/integrations") || path.startsWith("/integrations")) return true;
  if (path.startsWith("/api/plugins") || path.startsWith("/plugins")) return true;
  if (path.startsWith("/settings/integrations") || path === "/settings/test-email") return true;

  const lower = path.toLowerCase();
  return lower.includes("/upload") ||
    lower.includes("/ingest") ||
    lower.includes("/pdf") ||
    lower.includes("/send-quote") ||
    lower.includes("/send-email") ||
    lower.includes("/brand/capture");
}

function normalizeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "demo";
}

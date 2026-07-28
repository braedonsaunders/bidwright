const PUBLIC_PREFIXES = ["/auth/", "/health", "/api/webhooks/"];

const PUBLIC_EXACT_ROUTES = [
  "/api/auth/login",
  "/api/auth/signup",
  "/api/auth/super-login",
  "/api/auth/logout",
  "/api/auth/me",
  "/api/setup/status",
  "/api/setup/init",
  "/api/setup/seed-essentials",
];

const AUTHENTICATED_ROUTES_WITHOUT_ORG_CONTEXT = [
  "/api/auth/profile",
  "/api/auth/organizations",
  "/api/auth/switch-org",
];

export function isPublicRoute(url: string): boolean {
  const path = url.split("?")[0];
  if (PUBLIC_EXACT_ROUTES.includes(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function requiresOrganizationContext(url: string): boolean {
  const path = url.split("?")[0];
  if (isPublicRoute(path)) return false;
  if (path.startsWith("/api/admin/")) return false;
  if (AUTHENTICATED_ROUTES_WITHOUT_ORG_CONTEXT.includes(path)) return false;
  return true;
}

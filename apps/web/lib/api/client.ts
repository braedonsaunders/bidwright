const DEFAULT_API_BASE_URL = "http://localhost:4001";
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

// In production we front the API behind the same public origin via Traefik, so
// the browser should prefer its current origin if no public build-time API URL
// was injected into the bundle.
export const apiBaseUrl =
  configuredApiBaseUrl ??
  (process.env.NODE_ENV === "development" ? DEFAULT_API_BASE_URL : null) ??
  (typeof window !== "undefined" ? window.location.origin : null) ??
  DEFAULT_API_BASE_URL;

function resolveBrowserProxyPath(path: string) {
  if (path.startsWith("/api/")) {
    return path;
  }
  return `/proxy${path}`;
}

export function resolveApiUrl(path: string) {
  if (typeof window !== "undefined") {
    const currentOrigin = window.location.origin;
    if (apiBaseUrl === currentOrigin) {
      return new URL(resolveBrowserProxyPath(path), currentOrigin).toString();
    }
  }
  return new URL(path, apiBaseUrl).toString();
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };

  const { headers: _discardHeaders, ...restInit } = init ?? {};
  const response = await fetch(resolveApiUrl(path), {
    cache: "no-store",
    credentials: "include",
    ...restInit,
    headers,
  });

  if (response.status === 401) {
    if (typeof window !== "undefined" && !path.includes("/auth/")) {
      localStorage.removeItem("bw_user");
      localStorage.removeItem("bw_org");
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `API request failed for ${path} (${response.status} ${response.statusText})${errorBody ? `: ${errorBody}` : ""}`
    );
  }

  return (await response.json()) as T;
}

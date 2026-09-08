const DEFAULT_API_BASE_URL = "http://localhost:4001";
const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
// Desktop builds spawn the api as a child on a dynamic port; the browser
// can't be told the URL via NEXT_PUBLIC_* (those are baked at build time),
// so it routes every request through the web sidecar's `/proxy/` handler,
// which reads `INTERNAL_API_BASE_URL` at runtime.
const isDesktopBuild = process.env.NEXT_PUBLIC_BIDWRIGHT_DESKTOP === "1";

// In production we front the API behind the same public origin via Traefik, so
// the browser should prefer its current origin if no public build-time API URL
// was injected into the bundle.
export const apiBaseUrl =
  configuredApiBaseUrl ??
  (process.env.NODE_ENV === "development" ? DEFAULT_API_BASE_URL : null) ??
  (typeof window !== "undefined" ? window.location.origin : null) ??
  DEFAULT_API_BASE_URL;

function resolveBrowserProxyPath(path: string) {
  // Desktop: every browser-side api call funnels through the web sidecar's
  // /proxy/ route, which forwards to the spawned api on its dynamic port.
  if (isDesktopBuild) {
    return `/proxy${path}`;
  }
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

/**
 * Every failure out of `apiRequest`. Callers need the status to tell an
 * expected 401 ("nobody is signed in") apart from a backend that is down —
 * the two demand very different UI, and a bare Error made them
 * indistinguishable. `status` is 0 when the request never reached the server.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(message: string, options: { status: number; path: string; body?: string; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.status = options.status;
    this.path = options.path;
    this.body = options.body ?? "";
  }

  /** The request never got an HTTP response (offline, DNS, TLS, CORS). */
  get isNetworkError() {
    return this.status === 0;
  }

  /** The server answered, but not with a success this app can use. */
  get isServerError() {
    return this.status >= 500;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };

  const { headers: _discardHeaders, ...restInit } = init ?? {};
  let response: Response;
  try {
    response = await fetch(resolveApiUrl(path), {
      cache: "no-store",
      credentials: "include",
      ...restInit,
      headers,
    });
  } catch (cause) {
    throw new ApiError(
      `API request failed for ${path}: ${cause instanceof Error ? cause.message : "network error"}`,
      { status: 0, path, cause },
    );
  }

  if (response.status === 401) {
    if (typeof window !== "undefined" && !path.includes("/auth/")) {
      localStorage.removeItem("bw_user");
      localStorage.removeItem("bw_org");
      window.location.href = "/login";
    }
  }

  // Read the body once as text so we control parsing for both the error and
  // success paths. Calling response.json() directly surfaces a raw
  // "...is not valid JSON" SyntaxError whenever a proxy/gateway hands back a
  // non-JSON body (HTML error page, truncated/compressed bytes), which is
  // confusing and hides the real status.
  const rawBody = await response.text().catch(() => "");

  if (!response.ok) {
    throw new ApiError(
      `API request failed for ${path} (${response.status} ${response.statusText})${rawBody ? `: ${rawBody}` : ""}`,
      { status: response.status, path, body: rawBody },
    );
  }

  if (!rawBody) {
    // Endpoints that legitimately return no content (e.g. 204).
    return undefined as T;
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch {
    const snippet = rawBody.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new ApiError(
      `API request for ${path} returned a ${response.status} response with a non-JSON body — ` +
      `a proxy or gateway likely altered it. First bytes: ${snippet}`,
      { status: response.status, path, body: rawBody },
    );
  }
}

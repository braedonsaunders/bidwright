/**
 * HTTP client for calling the Bidwright API from the MCP server.
 * All env vars are set by the Bidwright API when spawning this process.
 * Retries on transient errors (429, 502, 503, 504) with exponential backoff.
 */

const API_URL = process.env.BIDWRIGHT_API_URL || "http://localhost:4001";
const AUTH_TOKEN = process.env.BIDWRIGHT_AUTH_TOKEN || "";
const PROJECT_ID = process.env.BIDWRIGHT_PROJECT_ID || "";
const REVISION_ID = process.env.BIDWRIGHT_REVISION_ID || "";
const QUOTE_ID = process.env.BIDWRIGHT_QUOTE_ID || "";

export function getProjectId() { return PROJECT_ID; }
export function getRevisionId() { return REVISION_ID; }
export function getQuoteId() { return QUOTE_ID; }

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (AUTH_TOKEN) h["Authorization"] = `Bearer ${AUTH_TOKEN}`;
  h["X-Bidwright-Actor"] = "mcp-agent";
  return h;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with exponential backoff retry on 429 / transient server errors */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const MAX_RETRIES = 4;
  let lastRes: Response | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    lastRes = await fetch(url, init);

    if (lastRes.status === 429 || lastRes.status === 502 || lastRes.status === 503 || lastRes.status === 504) {
      if (attempt < MAX_RETRIES) {
        const retryAfter = lastRes.headers.get("Retry-After");
        const delayMs = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 30_000)
          : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30_000);
        await sleep(delayMs);
        continue;
      }
    }

    return lastRes;
  }

  return lastRes!;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetchWithRetry(url, { method: "GET", headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API GET ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API POST ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T = any>(path: string, body: unknown): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetchWithRetry(url, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API PATCH ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetchWithRetry(url, { method: "DELETE", headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API DELETE ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Helper: project-scoped API path */
export function projectPath(subpath: string): string {
  return `/projects/${PROJECT_ID}${subpath}`;
}

/**
 * HTTP client for calling the Bidwright API from the MCP server.
 * All env vars are set by the Bidwright API when spawning this process.
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
  return h;
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, { method: "GET", headers: headers() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API GET ${path} failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
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
  const res = await fetch(url, {
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
  const res = await fetch(url, { method: "DELETE", headers: headers() });
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

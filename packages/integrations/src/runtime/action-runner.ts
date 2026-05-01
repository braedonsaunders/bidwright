import type {
  IntegrationManifestParsed, ManifestAction, ManifestRequest,
} from "../manifest/schema.js";
import { applyAuth, type AuthApplyContext, type OutboundRequest } from "../auth/index.js";
import { renderDeep, renderString } from "./template.js";
import { selectAndMap } from "./jsonpath.js";
import { hmacSign } from "../crypto.js";

/**
 * Manifest-driven HTTP action runner. Handles:
 *   - {{...}} template substitution against config / credential / input
 *   - URL composition (baseUrl + path + query)
 *   - body encoding (json | form | none)
 *   - auth projection (api_key | bearer | basic | oauth2 | hmac)
 *   - retry with exponential backoff for retryable HTTP statuses + network errors
 *   - timeout via AbortController
 *   - response selection + JSONPath mapping into the action's declared output
 *
 * Returns a deterministic shape — never throws on non-2xx; instead returns
 * `{ success: false, ... }` so the caller (the action route + agent tool)
 * can persist a clean IntegrationRun row.
 */

export interface RunActionInput {
  manifest: IntegrationManifestParsed;
  action: ManifestAction;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
  input: Record<string, unknown>;
  /** Optional fetch override for tests. */
  fetchImpl?: typeof fetch;
  /** Optional logger; receives only safe-to-log diagnostics (no secrets). */
  log?: (entry: { level: "info" | "warn" | "error"; msg: string; data?: unknown }) => void;
}

export interface RunActionOutput {
  success: boolean;
  output?: unknown;       // selected + mapped response payload
  raw?: unknown;          // full parsed response body
  error?: string;
  httpStatus?: number;
  durationMs: number;
  attempts: number;
}

const REDACT = "***";
const HOP_BY_HOP = new Set([
  "authorization", "x-api-key", "x-auth-token", "cookie", "set-cookie",
  "proxy-authorization",
]);

function safeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = HOP_BY_HOP.has(k.toLowerCase()) ? REDACT : v;
  }
  return out;
}

function composeUrl(baseUrl: string | undefined, path: string, query: Record<string, string>): string {
  let url: URL;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    url = new URL(path);
  } else if (!baseUrl) {
    throw new Error(`Action request needs baseUrl or absolute path (got: ${path})`);
  } else {
    // Join base + path safely
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const rel = path.startsWith("/") ? path.slice(1) : path;
    url = new URL(rel, base);
  }
  for (const [k, v] of Object.entries(query)) {
    if (v === "" || v == null) continue;
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function encodeBody(body: unknown, encoding: "json" | "form" | "none"):
  | { body: string | undefined; contentType: string | undefined } {
  if (encoding === "none" || body == null) return { body: undefined, contentType: undefined };
  if (encoding === "form") {
    const params = new URLSearchParams();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        if (v == null) continue;
        params.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    }
    return { body: params.toString(), contentType: "application/x-www-form-urlencoded" };
  }
  return { body: JSON.stringify(body), contentType: "application/json" };
}

async function parseResponseBody(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { return await res.json(); } catch { return null; }
  }
  const text = await res.text();
  if (!text) return null;
  // Best-effort: try JSON first, fall back to text wrapper.
  try { return JSON.parse(text); } catch { return { _text: text }; }
}

function isRetryable(req: ManifestRequest, status: number | undefined, networkError: boolean): boolean {
  if (networkError) return true;
  if (!status) return false;
  return req.retry.retryOnStatus.includes(status);
}

function backoffDelay(req: ManifestRequest, attempt: number): number {
  const base = req.retry.initialDelayMs;
  if (req.retry.backoff === "fixed") return base;
  // exponential with full jitter, capped at 30s
  const exp = Math.min(base * Math.pow(2, attempt - 1), 30_000);
  return Math.floor(Math.random() * exp);
}

function checkAllowedHost(allowed: string[], url: string): void {
  if (allowed.length === 0) return;
  const u = new URL(url);
  const host = u.host.toLowerCase();
  const ok = allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*.")) return host.endsWith(p.slice(1));
    return host === p;
  });
  if (!ok) {
    throw new Error(`Outbound host not allowed by manifest: ${u.host}`);
  }
}

export async function runAction(opts: RunActionInput): Promise<RunActionOutput> {
  const { manifest, action, config, credentials, input } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? (() => {});
  const start = Date.now();

  // 1. Validate required inputs
  for (const f of action.input) {
    if (f.required && !(f.name in input)) {
      return {
        success: false,
        error: `Missing required input: ${f.name}`,
        durationMs: Date.now() - start,
        attempts: 0,
      };
    }
  }

  // 2. Render templates
  const ctx = { config, credential: credentials, input, cursor: null };
  const renderedRequest: ManifestRequest = {
    ...action.request,
    path: renderString(action.request.path, ctx),
    headers: renderDeep(action.request.headers, ctx),
    query: renderDeep(action.request.query, ctx),
    body: renderDeep(action.request.body, ctx),
  };

  const baseUrl = manifest.connection.baseUrl
    ? renderString(manifest.connection.baseUrl, ctx)
    : undefined;

  let url: string;
  try {
    url = composeUrl(baseUrl, renderedRequest.path, renderedRequest.query);
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
      durationMs: Date.now() - start,
      attempts: 0,
    };
  }

  // 3. Defense-in-depth: pin to allowed hosts when manifest declares any
  try {
    checkAllowedHost(manifest.connection.allowedHosts ?? [], url);
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
      durationMs: Date.now() - start,
      attempts: 0,
    };
  }

  // 4. Apply auth + serialize body
  const initialOutbound: OutboundRequest = {
    method: renderedRequest.method,
    url,
    headers: { Accept: "application/json", ...renderedRequest.headers },
    query: {}, // already merged into url
    body: renderedRequest.body,
    bodyEncoding: renderedRequest.bodyEncoding,
  };

  let outbound: OutboundRequest;
  try {
    outbound = applyAuth(manifest.connection.auth, initialOutbound, {
      credentials,
      config,
    } satisfies AuthApplyContext);
  } catch (e) {
    return {
      success: false,
      error: (e as Error).message,
      durationMs: Date.now() - start,
      attempts: 0,
    };
  }

  const { body: encodedBody, contentType } = encodeBody(outbound.body, outbound.bodyEncoding);
  if (contentType && !Object.keys(outbound.headers).some((h) => h.toLowerCase() === "content-type")) {
    outbound.headers["Content-Type"] = contentType;
  }

  // 5. HMAC signing — applied last, after the body is serialized
  if (manifest.connection.auth.type === "hmac") {
    const hmac = manifest.connection.auth;
    const secret = credentials.hmac_secret;
    if (!secret) {
      return {
        success: false,
        error: "Missing credential: hmac_secret",
        durationMs: Date.now() - start,
        attempts: 0,
      };
    }
    const payloadForSig = encodedBody ?? "";
    const signature = `${hmac.signaturePrefix}${hmacSign(hmac.algorithm, secret, payloadForSig, hmac.encoding)}`;
    outbound.headers[hmac.signatureHeader] = signature;
  }

  // 6. Execute with retry + timeout
  let attempts = 0;
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let body: unknown;

  for (let attempt = 1; attempt <= renderedRequest.retry.maxAttempts; attempt++) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), renderedRequest.timeoutMs);
    let networkError = false;
    let res: Response | undefined;
    try {
      res = await fetchImpl(url, {
        method: outbound.method,
        headers: outbound.headers,
        body: encodedBody,
        signal: controller.signal,
      });
      lastStatus = res.status;
      body = await parseResponseBody(res);
      if (res.ok) {
        // Apply select + map to shape the response
        let shaped: unknown;
        try {
          shaped = selectAndMap(action.output.select ?? "$", action.output.map, body as never);
        } catch {
          shaped = body;
        }
        return {
          success: true,
          output: shaped,
          raw: body,
          httpStatus: res.status,
          durationMs: Date.now() - start,
          attempts,
        };
      }
      lastError = `HTTP ${res.status}: ${typeof body === "object" ? JSON.stringify(body) : String(body)}`;
    } catch (err) {
      networkError = true;
      lastError = (err as Error).message ?? "network_error";
      log({ level: "warn", msg: "action_request_error", data: { attempt, error: lastError, headers: safeHeaders(outbound.headers) } });
    } finally {
      clearTimeout(timer);
    }

    if (attempt < renderedRequest.retry.maxAttempts && isRetryable(renderedRequest, lastStatus, networkError)) {
      const delay = backoffDelay(renderedRequest, attempt);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    break;
  }

  return {
    success: false,
    error: lastError ?? "unknown_error",
    raw: body,
    httpStatus: lastStatus,
    durationMs: Date.now() - start,
    attempts,
  };
}

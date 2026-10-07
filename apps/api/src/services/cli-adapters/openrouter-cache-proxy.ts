/**
 * Loopback bridge between Codex and OpenRouter that turns on Anthropic prompt
 * caching.
 *
 * OpenRouter's Responses API caches Claude prompts only when the request body
 * carries a top-level `cache_control: { type: "ephemeral" }`
 * (https://openrouter.ai/docs/guides/best-practices/prompt-caching). Codex's
 * provider config can add headers and query parameters but not body fields,
 * so Claude runs sent the whole growing prompt uncached on every turn while
 * GPT runs, which OpenRouter caches automatically, were ~96% cached.
 *
 * One bridge per agent session. It listens on 127.0.0.1 only, accepts only
 * `POST /api/v1/responses` carrying that session's own OpenRouter key (so no
 * other local process can spend it), forwards to one fixed upstream, adds
 * `cache_control` to Anthropic requests that do not already set it, and
 * passes every other byte through unchanged: image payloads, SSE streams and
 * error bodies. When the client goes away the upstream request is aborted.
 * Nothing about prompts or keys is logged.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";

const RESPONSES_PATH = "/api/v1/responses";
const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

// Hop-by-hop headers (RFC 9110 §7.6.1) plus ones fetch recomputes.
const DROPPED_REQUEST_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade",
  "te", "trailer", "content-length", "expect",
]);
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection", "keep-alive", "transfer-encoding", "upgrade", "trailer",
  // fetch decodes compressed bodies, so the original encoding/length no longer apply.
  "content-encoding", "content-length",
]);

export interface OpenRouterCacheProxyOptions {
  /** The session's OpenRouter key; callers must present it as their Bearer token. */
  apiKey: string;
  /** Agent session the bridge belongs to (for the caller's bookkeeping). */
  sessionId?: string;
  /** Fixed upstream; defaults to OpenRouter. Tests point this at a mock. */
  upstreamBaseUrl?: string;
  /** Which models get cache_control. Defaults to Anthropic slugs and aliases. */
  shouldCache?: (model: string) => boolean;
  maxBodyBytes?: number;
  fetchImpl?: typeof fetch;
  /** Called when a request handler has fully finished (tests use it to prove none hang). */
  onRequestSettled?: () => void;
}

export interface OpenRouterCacheProxy {
  /** Use as the Codex provider base_url, e.g. http://127.0.0.1:41234/api/v1 */
  baseUrl: string;
  sessionId?: string;
  close(): Promise<void>;
}

export function isAnthropicModel(model: string): boolean {
  return /^~?anthropic\//i.test(model.trim());
}

/**
 * Add top-level cache_control to an Anthropic Responses request. Returns the
 * original bytes untouched for every other request.
 */
export function withCacheControl(path: string, body: Buffer, shouldCache: (model: string) => boolean = isAnthropicModel): Buffer {
  if (!/\/responses\/?$/.test(path) || body.length === 0) return body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return body;
  const request = parsed as Record<string, unknown>;
  if (typeof request.model !== "string" || !shouldCache(request.model)) return body;
  if (request.cache_control !== undefined) return body;
  return Buffer.from(JSON.stringify({ ...request, cache_control: { type: "ephemeral" } }), "utf8");
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error(`request body exceeds ${limit} bytes`), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function bearerMatches(header: string | string[] | undefined, apiKey: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(String(value ?? ""));
  if (!match) return false;
  const presented = Buffer.from(match[1], "utf8");
  const expected = Buffer.from(apiKey, "utf8");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function sendError(response: ServerResponse, status: number, message: string) {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: { message, type: "bidwright_cache_proxy" } }));
}

export async function startOpenRouterCacheProxy(options: OpenRouterCacheProxyOptions): Promise<OpenRouterCacheProxy> {
  if (!options.apiKey) throw new Error("startOpenRouterCacheProxy needs the session's OpenRouter apiKey");
  const apiKey = options.apiKey;
  const upstream = new URL(options.upstreamBaseUrl ?? OPENROUTER_API_BASE);
  const upstreamBase = upstream.href.replace(/\/+$/, "");
  const shouldCache = options.shouldCache ?? isAnthropicModel;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;

  const server = createServer((request, response) => {
    handle(request, response).finally(() => options.onRequestSettled?.());
  });

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.replace(/\/+$/, "") !== RESPONSES_PATH) {
      sendError(response, 404, "Only POST /api/v1/responses is forwarded");
      return;
    }
    if (request.method !== "POST") {
      sendError(response, 405, `Method ${request.method} is not forwarded`);
      return;
    }
    if (!bearerMatches(request.headers.authorization, apiKey)) {
      request.resume();
      sendError(response, 401, "Missing or wrong bearer token for this session");
      return;
    }

    const abort = new AbortController();
    // Client went away (Codex cancelled or the broker stopped): stop paying for the upstream call.
    response.on("close", () => {
      if (!response.writableFinished) abort.abort();
    });

    try {
      const rawBody = await readBody(request, maxBodyBytes);
      const relativePath = "/responses";
      const body = withCacheControl(relativePath, rawBody, shouldCache);

      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }

      const upstreamResponse = await fetchImpl(`${upstreamBase}${relativePath}${url.search}`, {
        method: request.method,
        headers,
        body: new Uint8Array(body),
        signal: abort.signal,
      });

      const responseHeaders: Record<string, string> = {};
      upstreamResponse.headers.forEach((value, name) => {
        if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
      });
      response.writeHead(upstreamResponse.status, responseHeaders);
      response.flushHeaders();

      if (!upstreamResponse.body) {
        response.end();
        return;
      }
      // Stream chunk by chunk so SSE events reach Codex as they arrive.
      const reader = upstreamResponse.body.getReader();
      try {
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!response.write(value)) {
            // Wait for the client to catch up, or for it to go away; a client
            // that disconnects while backpressured must not strand this handler.
            const drained = await new Promise<boolean>((resolve) => {
              const finish = (ok: boolean) => {
                response.off("drain", onDrain);
                response.off("close", onClose);
                response.off("error", onClose);
                resolve(ok);
              };
              const onDrain = () => finish(true);
              const onClose = () => finish(false);
              response.on("drain", onDrain);
              response.on("close", onClose);
              response.on("error", onClose);
            });
            if (!drained) break;
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (abort.signal.aborted || response.destroyed) return;
      response.end();
    } catch (error) {
      if (abort.signal.aborted) {
        response.destroy();
        return;
      }
      const status = (error as { status?: number }).status ?? 502;
      sendError(response, status, error instanceof Error ? error.message : String(error));
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    sessionId: options.sessionId,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

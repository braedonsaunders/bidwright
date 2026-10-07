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
 *
 * Inside the agent sandbox all HTTP goes through an authenticated egress
 * proxy that refuses loopback, so Codex could not reach a loopback bridge.
 * The bridge therefore also serves as the Codex process's HTTP_PROXY
 * (`childEnv`): requests for its own address are answered here, every other
 * plain-HTTP request is relayed unchanged to the original HTTP_PROXY (whose
 * allowlist still decides), and CONNECT is refused because HTTPS_PROXY stays
 * the egress proxy. The bridge's own call to OpenRouter tunnels through the
 * original HTTPS_PROXY, so it is held to the same allowlist.
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";
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
  /** The sandbox's original HTTP_PROXY (with credentials); other plain-HTTP traffic is relayed to it. */
  relayProxyUrl?: string;
  /** The sandbox's original HTTPS_PROXY; the upstream call tunnels through it with CONNECT. */
  upstreamProxyUrl?: string;
  /** Extra CA for the upstream TLS connection (tests use a self-signed mock). */
  upstreamCa?: string | Buffer;
}

export interface OpenRouterCacheProxy {
  /** Use as the Codex provider base_url, e.g. http://127.0.0.1:41234/api/v1 */
  baseUrl: string;
  sessionId?: string;
  /** Env overrides for the Codex child: point HTTP_PROXY at this bridge. Empty when there is no proxy to relay to. */
  childEnv: Record<string, string>;
  close(): Promise<void>;
}

/** The bridge is opt-in per deployment until its egress path is proven there. */
export function openRouterPromptCacheEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.BIDWRIGHT_OPENROUTER_PROMPT_CACHE === "on";
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

function proxyAuthorization(proxy: URL): string | undefined {
  if (!proxy.username && !proxy.password) return undefined;
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

interface UpstreamResult {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array> | null;
}

/** POST to the upstream through an HTTP CONNECT proxy (the sandbox's egress proxy). */
function tunnelledRequest(
  target: URL,
  proxy: URL,
  init: { method: string; headers: Record<string, string>; body: Buffer },
  signal: AbortSignal,
  ca?: string | Buffer,
): Promise<UpstreamResult> {
  return new Promise((resolve, reject) => {
    const targetPort = Number(target.port) || (target.protocol === "https:" ? 443 : 80);
    const authority = `${target.hostname}:${targetPort}`;
    const auth = proxyAuthorization(proxy);
    const connect = httpRequest({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: "CONNECT",
      path: authority,
      headers: { host: authority, ...(auth ? { "proxy-authorization": auth } : {}) },
      signal,
    });
    connect.once("error", reject);
    connect.once("connect", (res, socket: Socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(Object.assign(new Error(`upstream proxy refused CONNECT ${authority} (${res.statusCode})`), { status: 502 }));
        return;
      }
      const tunnel = target.protocol === "https:" ? tlsConnect({ socket, servername: target.hostname, ...(ca ? { ca } : {}) }) : socket;
      const send = target.protocol === "https:" ? httpsRequest : httpRequest;
      const upstreamRequest = send({
        host: target.hostname,
        port: targetPort,
        method: init.method,
        path: `${target.pathname}${target.search}`,
        headers: { ...init.headers, host: target.host, "content-length": String(init.body.length) },
        createConnection: () => tunnel,
        signal,
      }, (upstreamResponse) => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(upstreamResponse.headers)) {
          if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
        }
        resolve({ status: upstreamResponse.statusCode ?? 502, headers, body: upstreamResponse });
      });
      upstreamRequest.once("error", reject);
      upstreamRequest.end(init.body);
    });
    connect.end();
  });
}

/** Relay a plain-HTTP absolute-form request unchanged to the original proxy. */
function relayToProxy(request: IncomingMessage, response: ServerResponse, proxy: URL) {
  const auth = proxyAuthorization(proxy);
  const headers = { ...request.headers };
  delete headers["proxy-authorization"];
  if (auth) headers["proxy-authorization"] = auth;
  const forwarded = httpRequest({
    host: proxy.hostname,
    port: Number(proxy.port) || 80,
    method: request.method,
    path: request.url,
    headers,
  }, (proxied) => {
    response.writeHead(proxied.statusCode ?? 502, proxied.headers);
    proxied.pipe(response);
  });
  forwarded.on("error", () => sendError(response, 502, "relay to the egress proxy failed"));
  response.on("close", () => forwarded.destroy());
  request.pipe(forwarded);
  return new Promise<void>((resolve) => response.on("close", resolve));
}

export async function startOpenRouterCacheProxy(options: OpenRouterCacheProxyOptions): Promise<OpenRouterCacheProxy> {
  if (!options.apiKey) throw new Error("startOpenRouterCacheProxy needs the session's OpenRouter apiKey");
  const apiKey = options.apiKey;
  const upstream = new URL(options.upstreamBaseUrl ?? OPENROUTER_API_BASE);
  const upstreamBase = upstream.href.replace(/\/+$/, "");
  const shouldCache = options.shouldCache ?? isAnthropicModel;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const fetchImpl = options.fetchImpl ?? fetch;
  const relayProxy = options.relayProxyUrl ? new URL(options.relayProxyUrl) : null;
  const upstreamProxy = options.upstreamProxyUrl ? new URL(options.upstreamProxyUrl) : null;
  let ownPort = 0;

  const server = createServer((request, response) => {
    handle(request, response).finally(() => options.onRequestSettled?.());
  });
  // HTTPS keeps using the egress proxy directly; this bridge never tunnels.
  server.on("connect", (_request, socket: Socket) => {
    socket.end("HTTP/1.1 405 Method Not Allowed\r\nconnection: close\r\n\r\n");
  });

  function isOwnAddress(target: URL): boolean {
    const host = target.hostname.replace(/^\[|\]$/g, "");
    return (host === "127.0.0.1" || host === "localhost" || host === "::1") && Number(target.port || 80) === ownPort;
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const raw = request.url ?? "/";
    const absolute = /^https?:\/\//i.test(raw);
    const url = new URL(raw, `http://127.0.0.1:${ownPort}`);
    if (absolute && !isOwnAddress(url)) {
      // Anything that is not for this bridge goes to the real egress proxy.
      if (!relayProxy) {
        request.resume();
        sendError(response, 403, "No egress proxy to relay to");
        return;
      }
      await relayToProxy(request, response, relayProxy);
      return;
    }
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

      const forwardHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (value === undefined || DROPPED_REQUEST_HEADERS.has(name.toLowerCase()) || name.toLowerCase() === "proxy-authorization") continue;
        forwardHeaders[name] = Array.isArray(value) ? value.join(", ") : value;
      }
      const target = new URL(`${upstreamBase}${relativePath}${url.search}`);

      let upstreamResult: UpstreamResult;
      if (upstreamProxy) {
        upstreamResult = await tunnelledRequest(target, upstreamProxy, { method: "POST", headers: forwardHeaders, body }, abort.signal, options.upstreamCa);
      } else {
        const fetched = await fetchImpl(target, { method: "POST", headers: forwardHeaders, body: new Uint8Array(body), signal: abort.signal });
        const headers: Record<string, string> = {};
        fetched.headers.forEach((value, name) => { headers[name] = value; });
        upstreamResult = { status: fetched.status, headers, body: fetched.body as AsyncIterable<Uint8Array> | null };
      }

      const responseHeaders: Record<string, string> = {};
      for (const [name, value] of Object.entries(upstreamResult.headers)) {
        if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
      }
      response.writeHead(upstreamResult.status, responseHeaders);
      response.flushHeaders();

      if (!upstreamResult.body) {
        response.end();
        return;
      }
      // Stream chunk by chunk so SSE events reach Codex as they arrive.
      const reader = upstreamResult.body[Symbol.asyncIterator]();
      try {
        while (!abort.signal.aborted) {
          const { done, value } = await reader.next();
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
        // Cancels a fetch stream / destroys a tunnelled response.
        await reader.return?.().catch(() => undefined);
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
  ownPort = port;
  const bridgeProxy = `http://127.0.0.1:${port}`;

  return {
    baseUrl: `${bridgeProxy}/api/v1`,
    sessionId: options.sessionId,
    childEnv: relayProxy ? { HTTP_PROXY: bridgeProxy, http_proxy: bridgeProxy } : {},
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

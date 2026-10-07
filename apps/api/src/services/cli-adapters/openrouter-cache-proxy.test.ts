import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { createConnection, type AddressInfo, type Socket } from "node:net";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import { isAnthropicModel, startOpenRouterCacheProxy, withCacheControl } from "./openrouter-cache-proxy.js";

const KEY = "sk-or-test-key";

interface Seen { path: string; method: string; headers: IncomingMessage["headers"]; body: Buffer; closedEarly: boolean }

async function mockUpstream(handler: (req: IncomingMessage, res: ServerResponse, seen: Seen) => void) {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const entry: Seen = { path: req.url ?? "", method: req.method ?? "", headers: req.headers, body: Buffer.concat(chunks), closedEarly: false };
    res.on("close", () => { if (!res.writableFinished) entry.closedEarly = true; });
    seen.push(entry);
    handler(req, res, entry);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/api/v1`, seen, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

test("model routing: only Anthropic slugs and aliases are cached", () => {
  assert.equal(isAnthropicModel("anthropic/claude-opus-5.5"), true);
  assert.equal(isAnthropicModel("~anthropic/claude-sonnet-latest"), true);
  assert.equal(isAnthropicModel("openai/gpt-6.1-sol"), false);
  assert.equal(isAnthropicModel("moonshotai/kimi-k3"), false);
});

test("withCacheControl adds top-level ephemeral cache_control only to Anthropic Responses requests", () => {
  const anthropic = Buffer.from(JSON.stringify({ model: "anthropic/claude-opus-5.5", input: [], prompt_cache_key: "thread-1" }));
  const out = JSON.parse(withCacheControl("/responses", anthropic).toString());
  assert.deepEqual(out.cache_control, { type: "ephemeral" });
  assert.equal(out.prompt_cache_key, "thread-1");

  const gpt = Buffer.from(JSON.stringify({ model: "openai/gpt-6.1-sol", input: [] }));
  assert.equal(withCacheControl("/responses", gpt), gpt, "non-Anthropic bytes are untouched");

  const preset = Buffer.from(JSON.stringify({ model: "anthropic/claude-opus-5.5", cache_control: { type: "ephemeral", ttl: "1h" } }));
  assert.equal(withCacheControl("/responses", preset), preset, "an existing cache_control is respected");

  const garbage = Buffer.from("not json");
  assert.equal(withCacheControl("/responses", garbage), garbage);
});

test("forwards Anthropic requests with cache_control, auth intact, and streams SSE as it arrives", async () => {
  let releaseSecondEvent: () => void = () => {};
  const upstream = await mockUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream", "x-request-id": "abc" });
    res.write("event: response.created\ndata: {\"id\":\"r1\"}\n\n");
    releaseSecondEvent = () => res.end("event: response.completed\ndata: {\"usage\":{\"cached_tokens\":12}}\n\n");
  });
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: upstream.base });
  try {
    const image = "A".repeat(3 * 1024 * 1024);
    const body = JSON.stringify({ model: "anthropic/claude-opus-5.5", stream: true, prompt_cache_key: "t1", input: [{ type: "input_image", image_url: `data:image/png;base64,${image}` }] });
    const response = await fetch(`${proxy.baseUrl}/responses`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("x-request-id"), "abc");

    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /response\.created/, "first SSE event arrives before the upstream finishes");
    releaseSecondEvent();
    let rest = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += new TextDecoder().decode(chunk.value);
    assert.match(rest, /response\.completed/);

    const forwarded = upstream.seen[0];
    assert.equal(forwarded.path, "/api/v1/responses");
    assert.equal(forwarded.headers.authorization, `Bearer ${KEY}`);
    const sent = JSON.parse(forwarded.body.toString());
    assert.deepEqual(sent.cache_control, { type: "ephemeral" });
    assert.equal(sent.prompt_cache_key, "t1");
    assert.equal(sent.input[0].image_url.length, image.length + "data:image/png;base64,".length, "image payload intact");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("non-Anthropic bodies reach the upstream byte for byte, and upstream errors pass through", async () => {
  const upstream = await mockUpstream((_req, res) => json(res, 429, { error: { message: "rate limited" } }));
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: upstream.base });
  try {
    const body = '{"model":"openai/gpt-6.1-sol",  "input":[] }';
    const response = await fetch(`${proxy.baseUrl}/responses`, { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body });
    assert.equal(response.status, 429);
    assert.deepEqual(await response.json(), { error: { message: "rate limited" } });
    assert.equal(upstream.seen[0].body.toString(), body);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("only POST /api/v1/responses with this session's key is forwarded", async () => {
  const upstream = await mockUpstream((_req, res) => json(res, 200, {}));
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: upstream.base });
  try {
    const post = (path: string, auth?: string) => fetch(`${proxy.baseUrl.replace(/\/api\/v1$/, "")}${path}`, {
      method: "POST", headers: auth ? { authorization: auth } : {}, body: "{}",
    });
    assert.equal((await post("/api/v1/responses")).status, 401);
    assert.equal((await post("/api/v1/responses", "Bearer sk-or-someone-else")).status, 401);
    assert.equal((await post("/api/v1/responses", KEY)).status, 401, "a raw key without the Bearer scheme is refused");
    assert.equal((await post("/api/v1/chat/completions", `Bearer ${KEY}`)).status, 404);
    assert.equal((await post("/api/v1/../../etc/passwd", `Bearer ${KEY}`)).status, 404);
    assert.equal((await fetch(`${proxy.baseUrl}/responses`, { headers: { authorization: `Bearer ${KEY}` } })).status, 405);
    assert.equal(upstream.seen.length, 0, "nothing rejected reached the upstream");
    assert.equal((await post("/api/v1/responses", `Bearer ${KEY}`)).status, 200);
    assert.equal(upstream.seen.length, 1);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("listens on loopback only and requires an api key", async () => {
  await assert.rejects(() => startOpenRouterCacheProxy({ apiKey: "" }), /apiKey/);
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: "http://127.0.0.1:9/api/v1" });
  try {
    assert.match(proxy.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);
  } finally {
    await proxy.close();
  }
});

test("a client that disconnects aborts the upstream request", async () => {
  const upstream = await mockUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write("event: response.created\ndata: {}\n\n");
    // never ends on its own
  });
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: upstream.base });
  try {
    const { port } = new URL(proxy.baseUrl);
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/api/v1/responses", method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" } }, (res) => {
        res.once("data", () => { req.destroy(); resolve(); });
      });
      req.on("error", () => undefined);
      req.end(JSON.stringify({ model: "anthropic/claude-opus-5.5" }));
      setTimeout(() => reject(new Error("no first event")), 3000);
    });
    for (let i = 0; i < 50 && !upstream.seen[0]?.closedEarly; i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(upstream.seen[0]?.closedEarly, true, "upstream connection closed when the client left");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

test("a backpressured client that disconnects never strands the handler", async () => {
  const chunk = "x".repeat(64 * 1024);
  const upstream = await mockUpstream((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    // Keep pushing far more than socket buffers hold, as fast as the proxy reads.
    const pump = () => {
      while (!res.destroyed && res.write(`data: ${chunk}\n\n`)) { /* fill */ }
      if (!res.destroyed) res.once("drain", pump);
    };
    pump();
  });
  let settled = 0;
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: upstream.base, onRequestSettled: () => { settled += 1; } });
  try {
    const { port } = new URL(proxy.baseUrl);
    await new Promise<void>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/api/v1/responses", method: "POST", headers: { authorization: `Bearer ${KEY}` } }, (res) => {
        res.pause(); // stop reading: the proxy's writes start returning false
        setTimeout(() => { req.destroy(); resolve(); }, 300);
      });
      req.on("error", () => undefined);
      req.end(JSON.stringify({ model: "anthropic/claude-opus-5.5" }));
      setTimeout(() => reject(new Error("no response")), 3000);
    });
    for (let i = 0; i < 100 && (settled === 0 || !upstream.seen[0]?.closedEarly); i += 1) await new Promise((r) => setTimeout(r, 20));
    assert.equal(settled, 1, "the request handler finished after the client left");
    assert.equal(upstream.seen[0]?.closedEarly, true, "the upstream stream was cancelled");
  } finally {
    await proxy.close();
    await upstream.close();
  }
});

// ── Sandbox egress: the bridge as the Codex child's HTTP_PROXY ────────────


/** Minimal authenticated forward proxy standing in for the sandbox egress proxy. */
async function mockEgressProxy(allow: (host: string, port: number) => boolean) {
  const log: string[] = [];
  const server = createServer((req, res) => {
    // Plain-HTTP absolute-form forwarding.
    if (req.headers["proxy-authorization"] !== `Basic ${Buffer.from("bidwright:s3cret").toString("base64")}`) {
      log.push(`407 ${req.url}`);
      res.writeHead(407).end();
      return;
    }
    const target = new URL(req.url ?? "");
    if (!allow(target.hostname, Number(target.port || 80))) {
      log.push(`DENY ${target.host}`);
      res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "EgressDenied", host: target.hostname }));
      return;
    }
    log.push(`HTTP ${target.host}${target.pathname}`);
    const forwarded = httpRequest({ host: target.hostname, port: Number(target.port || 80), method: req.method, path: target.pathname + target.search, headers: { ...req.headers, host: target.host } }, (upstream) => {
      res.writeHead(upstream.statusCode ?? 502, upstream.headers);
      upstream.pipe(res);
    });
    req.pipe(forwarded);
  });
  server.on("connect", (req, clientSocket: Socket, head) => {
    if (req.headers["proxy-authorization"] !== `Basic ${Buffer.from("bidwright:s3cret").toString("base64")}`) {
      log.push(`407 CONNECT ${req.url}`);
      clientSocket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      return;
    }
    const [host, port] = String(req.url).split(":");
    if (!allow(host, Number(port))) {
      log.push(`DENY CONNECT ${req.url}`);
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    log.push(`CONNECT ${req.url}`);
    const upstream = createConnection({ host, port: Number(port) }, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { url: `http://bidwright:s3cret@127.0.0.1:${port}`, port, log, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

/** Send one absolute-form request through an HTTP proxy, as Codex/curl do with HTTP_PROXY. */
function viaProxy(proxyUrl: string, target: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const proxy = new URL(proxyUrl);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: proxy.hostname, port: Number(proxy.port), method: init.method ?? "GET", path: target, headers: init.headers ?? {} }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
}

test("childEnv points only HTTP_PROXY at the bridge, and only when there is an egress proxy", async () => {
  const bare = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: "http://127.0.0.1:9/api/v1" });
  const relaying = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: "http://127.0.0.1:9/api/v1", relayProxyUrl: "http://bidwright:s3cret@127.0.0.1:1" });
  try {
    assert.deepEqual(bare.childEnv, {});
    const origin = relaying.baseUrl.replace(/\/api\/v1$/, "");
    assert.deepEqual(relaying.childEnv, { HTTP_PROXY: origin, http_proxy: origin });
    assert.ok(!("HTTPS_PROXY" in relaying.childEnv) && !("NO_PROXY" in relaying.childEnv));
  } finally {
    await bare.close();
    await relaying.close();
  }
});

test("as HTTP_PROXY: its own address is served here, everything else goes through the egress proxy", async () => {
  const upstream = await mockUpstream((_req, res) => json(res, 200, { ok: true }));
  const otherLoopbackService = await mockUpstream((_req, res) => json(res, 200, { leaked: true }));
  const allowedSite = await mockUpstream((_req, res) => json(res, 200, { allowed: true }));
  const allowedPort = Number(new URL(allowedSite.base).port);
  const upstreamPort = Number(new URL(upstream.base).port);
  // Egress allowlist: the mock OpenRouter and one "public" site; loopback services are not on it.
  const egress = await mockEgressProxy((_host, port) => port === allowedPort || port === upstreamPort);
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: upstream.base, relayProxyUrl: egress.url, upstreamProxyUrl: egress.url });
  const bridgeProxy = proxy.childEnv.HTTP_PROXY;
  try {
    // Codex: absolute-form request for the bridge itself.
    const own = await viaProxy(bridgeProxy, `${proxy.baseUrl}/responses`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: "anthropic/claude-opus-5.5" }) });
    assert.equal(own.status, 200);
    assert.deepEqual(JSON.parse(upstream.seen[0].body.toString()).cache_control, { type: "ephemeral" });
    // ...and its upstream call was tunnelled through the egress proxy (allowlist applies).
    assert.ok(egress.log.some((line) => line === `CONNECT 127.0.0.1:${upstreamPort}`), egress.log.join("; "));

    // Bridge route without this session's key is still refused.
    assert.equal((await viaProxy(bridgeProxy, `${proxy.baseUrl}/responses`, { method: "POST", body: "{}" })).status, 401);

    // A shell child reaching another loopback service: relayed, and the egress proxy denies it.
    const leak = await viaProxy(bridgeProxy, `${otherLoopbackService.base.replace(/\/api\/v1$/, "")}/secrets`);
    assert.equal(leak.status, 403);
    assert.match(leak.body, /EgressDenied/);
    assert.equal(otherLoopbackService.seen.length, 0);

    // Plain HTTP to an allowed host: relayed with the egress proxy's own credentials.
    const allowed = await viaProxy(bridgeProxy, `${allowedSite.base}/ping`);
    assert.equal(allowed.status, 200);
    assert.ok(egress.log.some((line) => line.startsWith("HTTP 127.0.0.1:" + allowedPort)));
    assert.ok(!egress.log.some((line) => line.startsWith("407")), "relayed requests carry the egress credentials");
  } finally {
    await proxy.close();
    await egress.close();
    await upstream.close();
    await otherLoopbackService.close();
    await allowedSite.close();
  }
});

test("as HTTP_PROXY: CONNECT is refused (HTTPS keeps using the egress proxy)", async () => {
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: "http://127.0.0.1:9/api/v1", relayProxyUrl: "http://bidwright:s3cret@127.0.0.1:1" });
  try {
    const { port } = new URL(proxy.baseUrl);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, method: "CONNECT", path: "example.com:443" });
      req.on("connect", (res, socket) => { socket.destroy(); resolve(res.statusCode ?? 0); });
      req.on("response", (res) => resolve(res.statusCode ?? 0));
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 405);
  } finally {
    await proxy.close();
  }
});

test("upstream tunnel failures surface as 502, not a hang", async () => {
  const egress = await mockEgressProxy(() => false);
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: "http://127.0.0.1:9/api/v1", upstreamProxyUrl: egress.url });
  try {
    const response = await fetch(`${proxy.baseUrl}/responses`, { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ model: "anthropic/claude-opus-5.5" }) });
    assert.equal(response.status, 502);
    assert.ok(egress.log.some((line) => line.startsWith("DENY CONNECT")));
  } finally {
    await proxy.close();
    await egress.close();
  }
});

test("through the CONNECT tunnel, compressed SSE and errors reach Codex decodable", async () => {
  const sse = "event: response.created\ndata: {\"id\":\"r1\"}\n\nevent: response.completed\ndata: {}\n\n";
  const error = JSON.stringify({ error: { message: "rate limited" } });
  let mode: "sse" | "error" = "sse";
  const upstream = await mockUpstream((_req, res) => {
    const body = gzipSync(mode === "sse" ? sse : error);
    res.writeHead(mode === "sse" ? 200 : 429, {
      "content-type": mode === "sse" ? "text/event-stream" : "application/json",
      "content-encoding": "gzip",
      "content-length": String(body.length),
    });
    res.end(body);
  });
  const upstreamPort = Number(new URL(upstream.base).port);
  const egress = await mockEgressProxy((_host, port) => port === upstreamPort);
  const proxy = await startOpenRouterCacheProxy({ apiKey: KEY, upstreamBaseUrl: upstream.base, upstreamProxyUrl: egress.url });
  try {
    const raw = (status: number, acceptEncoding?: string) => new Promise<{ status: number; headers: IncomingMessage["headers"]; body: Buffer }>((resolve, reject) => {
      const { port } = new URL(proxy.baseUrl);
      const headers: Record<string, string> = { authorization: `Bearer ${KEY}` };
      if (acceptEncoding) headers["accept-encoding"] = acceptEncoding;
      const req = httpRequest({ host: "127.0.0.1", port, path: "/api/v1/responses", method: "POST", headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ model: "anthropic/claude-opus-5.5" }));
      void status;
    });

    // Codex: no Accept-Encoding, cannot decode. It must get plain text.
    const forCodex = await raw(200);
    assert.equal(forCodex.status, 200);
    assert.equal(forCodex.headers["content-encoding"], undefined);
    assert.equal(forCodex.body.toString(), sse, "gzip SSE is decoded for a client that did not ask for gzip");

    // A client that accepts gzip gets the upstream bytes untouched.
    const streamed = await raw(200, "gzip, br");
    assert.equal(streamed.headers["content-encoding"], "gzip");
    assert.equal(gunzipSync(streamed.body).toString(), sse);

    mode = "error";
    const limitedPlain = await raw(429);
    assert.equal(limitedPlain.status, 429);
    assert.equal(limitedPlain.headers["content-encoding"], undefined);
    assert.equal(limitedPlain.body.toString(), error, "gzip 429 is decoded for Codex");

    const limited = await raw(429, "gzip");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers["content-encoding"], "gzip");
    assert.equal(limited.headers["content-length"], String(limited.body.length));
    assert.equal(gunzipSync(limited.body).toString(), error, "gzip 429 body arrives intact and decodable");
  } finally {
    await proxy.close();
    await egress.close();
    await upstream.close();
  }
});

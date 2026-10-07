import assert from "node:assert/strict";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

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

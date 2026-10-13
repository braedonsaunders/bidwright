import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { fetchWithRetry } from "./api-client.js";

test("MCP API calls fail clearly instead of hanging forever", async () => {
  const server = createServer(() => {
    // Deliberately never write a response.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    await assert.rejects(
      fetchWithRetry(`http://127.0.0.1:${address.port}/hang`, { method: "GET" }, 25),
      /timed out after 0s: GET/i,
    );
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

test("proxy 404 during an unhealthy rollout retries GET and recovers", async t => {
  let reads = 0, probes = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/health")) { probes++; return new Response("404 page not found\n", { status: 404 }); }
    return ++reads === 1 ? new Response("404 page not found\n", { status: 404 }) : Response.json({ ok: true });
  });
  const response = await fetchWithRetry("http://example.invalid/projects/project/workspace", { method: "GET" }, 1000);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(reads, 2);
  assert.equal(probes, 1);
});

for (const healthy of [true, false]) test(`real missing resource is not retried (${healthy ? "proxy with healthy API" : "application JSON"})`, async t => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/health")) return Response.json({ status: "ok" });
    reads++;
    return healthy ? new Response("404 page not found\n", { status: 404 }) : Response.json({ message: "Project not found" }, { status: 404 });
  });
  assert.equal((await fetchWithRetry("http://example.invalid/missing", { method: "GET" }, 1000)).status, 404);
  assert.equal(reads, 1);
});

for (const status of [404, 503]) test(`writes are not replayed on ${status}`, async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return new Response("404 page not found\n", { status }); });
  assert.equal((await fetchWithRetry("http://example.invalid/create", { method: "POST" }, 1000)).status, status);
  assert.equal(requests, 1);
});

test("persistent missing proxy route reports API restart uncertainty after bounded retries", async t => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (!url.endsWith("/health")) reads++;
    return new Response("404 page not found\n", { status: 404 });
  });
  await assert.rejects(fetchWithRetry("http://example.invalid/projects/project/workspace", { method: "GET" }, 1000), /API restarting or temporarily unavailable.*5 attempts/);
  assert.equal(reads, 5);
});

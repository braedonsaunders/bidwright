import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("queryLibrary omits refresh=false so search stays a read of the indexed table", () => {
  const source = readFileSync(new URL("./tools/resource-tools.ts", import.meta.url), "utf8");
  const start = source.indexOf("function queryString(");
  assert.notEqual(start, -1, "queryString missing");
  const body = source.slice(start, start + 800);
  assert.match(body, /value === false/, "must omit false flags like refresh:false");
});

test("queryLibrary and recommendCostSource do not send refresh=false", async () => {
  const requestedUrls: string[] = [];
  const api = createServer((request, response) => {
    requestedUrls.push(`${request.method} ${request.url}`);
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/projects/project-test/workspace")) {
      response.end(JSON.stringify({ workspace: { currentRevision: { defaultMarkup: 0 } } }));
      return;
    }
    if (request.url?.startsWith("/projects/project-test/line-item-search")) {
      response.end(JSON.stringify([{
        id: "lis_pipe",
        sourceType: "catalog_item",
        sourceId: "item-1",
        actionType: "select",
        title: "3 inch butt weld",
        unitCost: 12,
        unitPrice: 14,
        payload: { itemId: "item-1" },
      }]));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address === "object");

  const previousApiUrl = process.env.BIDWRIGHT_API_URL;
  const previousProjectId = process.env.BIDWRIGHT_PROJECT_ID;
  process.env.BIDWRIGHT_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.BIDWRIGHT_PROJECT_ID = "project-test";
  const { registerResourceTools } = await import("./tools/resource-tools.js");
  const server = new McpServer({ name: "search-test-server", version: "1.0.0" });
  registerResourceTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "search-test", version: "1.0.0" }, { capabilities: {} });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await client.callTool({ name: "queryLibrary", arguments: { q: "3 inch butt weld" } });
    await client.callTool({ name: "recommendCostSource", arguments: { q: "3 inch butt weld" } });
    const searchUrls = requestedUrls.filter((url) => url.includes("/line-item-search"));
    assert.equal(searchUrls.length, 2, `expected two searches, got ${requestedUrls.join(", ")}`);
    for (const url of searchUrls) {
      assert.doesNotMatch(url, /refresh=/, `${url} must not send a refresh flag by default`);
    }
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    if (previousApiUrl === undefined) delete process.env.BIDWRIGHT_API_URL;
    else process.env.BIDWRIGHT_API_URL = previousApiUrl;
    if (previousProjectId === undefined) delete process.env.BIDWRIGHT_PROJECT_ID;
    else process.env.BIDWRIGHT_PROJECT_ID = previousProjectId;
    api.close();
    await once(api, "close");
  }
});

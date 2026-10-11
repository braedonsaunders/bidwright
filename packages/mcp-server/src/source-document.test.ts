import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("knowledge tools accept FileNode and UI keys through the same source resolver", async t => {
  const promoted: string[] = [];
  const reads: string[] = [];
  const api = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && request.url === "/projects/project-test/documents/from-file-node") {
      let body = ""; for await (const chunk of request) body += chunk;
      promoted.push(JSON.parse(body).fileNodeId);
      response.end(JSON.stringify({ id: "doc-resolved" })); return;
    }
    reads.push(request.url!);
    response.end(JSON.stringify({ fileName: "bom.xlsx", content: "Pipe 317 ft", allSheetNames: ["BOM"], sheetCount: 1, sheets: [{ name: "BOM", rowCount: 1, markdown: "Pipe 317 ft" }], results: [] }));
  });
  t.after(() => new Promise<void>(resolve => api.close(() => resolve())));
  api.listen(0, "127.0.0.1"); await once(api, "listening");
  const address = api.address(); assert.ok(address && typeof address === "object");
  const previous = { BIDWRIGHT_API_URL: process.env.BIDWRIGHT_API_URL, BIDWRIGHT_PROJECT_ID: process.env.BIDWRIGHT_PROJECT_ID };
  process.env.BIDWRIGHT_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.BIDWRIGHT_PROJECT_ID = "project-test";
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { registerKnowledgeTools } = await import("./tools/knowledge-tools.js");
  const server = new McpServer({ name: "source-test", version: "1" }); registerKnowledgeTools(server);
  const client = new Client({ name: "source-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  for (const [name, documentId] of [["readDocumentText", "fn-source"], ["getDocumentStructured", "file-fn-source"], ["readSpreadsheet", "file-copy"], ["queryProjectFile", "file-file-copy"]]) {
    const result = await client.callTool({ name, arguments: { documentId, ...(name === "queryProjectFile" ? { query: "pipe" } : {}) } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
  }
  assert.deepEqual(promoted, ["fn-source", "file-fn-source", "file-copy", "file-file-copy"]);
  assert.equal(reads.length, 4);
  assert.ok(reads.every(path => path.includes("doc-resolved")));
});

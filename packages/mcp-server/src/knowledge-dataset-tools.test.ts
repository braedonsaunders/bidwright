import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("queryKnowledgeDataset uses typed filters for an exact row and reads a dataset by id alone", async () => {
  let queryBody: unknown;
  let rowsUrl = "";
  const api = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && request.url === "/datasets/ds-piping/query") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        queryBody = JSON.parse(body);
        response.end(JSON.stringify([{
          id: "row-3",
          data: {
            NominalDiameter: "3",
            ActualSize: 3.5,
            FittingHrs: 0.75,
            MinutesPerInch: 2,
            NumberOfPasses: 3,
            StainlessPercentAdder: 10,
          },
        }]));
      });
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/datasets/ds-piping/rows?")) {
      rowsUrl = request.url;
      response.end(JSON.stringify({
        rows: Array.from({ length: 20 }, (_, i) => ({ id: `row-${i+5}`, data: { NominalDiameter: String(i + 6), FittingHrs: i / 4 } })),
        total: 40,
      }));
      return;
    }
    if (request.method === "GET" && request.url === "/datasets/ds-piping") {
      response.end(JSON.stringify({
        id: "ds-piping",
        name: "Piping Man-Hour Data",
        description: "Pipe fitting and welding productivity",
        columns: [
          { key: "NominalDiameter", name: "Nominal diameter", type: "text" },
          { key: "FittingHrs", name: "Fitting hours", type: "number" },
        ],
      }));
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
  process.env.BIDWRIGHT_API_URL = `http://127.0.0.1:${address.port}`;
  const { registerKnowledgeTools } = await import("./tools/knowledge-tools.js");
  const server = new McpServer({ name: "dataset-test-server", version: "1.0.0" });
  registerKnowledgeTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dataset-test", version: "1.0.0" }, { capabilities: {} });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "queryKnowledgeDataset",
      arguments: {
        datasetId: "ds-piping",
        filters: [{ column: "NominalDiameter", op: "eq", value: 3 }],
      },
    });
    assert.deepEqual(queryBody, {
      filters: [{ column: "NominalDiameter", op: "eq", value: 3 }],
    });
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    const payload = JSON.parse(String(content.find((item) => item.type === "text")?.text));
    assert.equal(payload.dataset.name, "Piping Man-Hour Data");
    assert.equal(payload.rows.total, 1);
    assert.equal(payload.rows.values[0].NominalDiameter, "3");
    assert.equal(payload.evidence.match, "exact_filters");

    const browse = await client.callTool({
      name: "queryKnowledgeDataset",
      arguments: { datasetId: "ds-piping", offset: 5, rowLimit: 20 },
    });
    const browseContent = (browse as { content: Array<{ type: string; text?: string }>; isError?: boolean });
    assert.notEqual(browseContent.isError, true);
    const rows = JSON.parse(String(browseContent.content.find((item) => item.type === "text")?.text)).rows;
    assert.equal(rowsUrl, "/datasets/ds-piping/rows?limit=20&offset=5");
    assert.equal(rows.values.length, 20);
    assert.equal(rows.values[0].NominalDiameter, "6");
    assert.equal(rows.total, 40);
    assert.equal(rows.hasMore, true);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    if (previousApiUrl === undefined) delete process.env.BIDWRIGHT_API_URL;
    else process.env.BIDWRIGHT_API_URL = previousApiUrl;
    api.close();
    await once(api, "close");
  }
});

test("combined search returns drillable sources and expands the matched book passage", async () => {
  const api = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/knowledge/search") response.end(JSON.stringify([{ id: "kc-1", bookId: "kb-1", chunkOrder: 7,
      source: "Workshop manual", excerpt: "Hole | hours\n1/4 | 0.004", text: "Full passage", pageNumber: 12 }]));
    else if (url.pathname === "/api/labor-units/units") response.end(JSON.stringify({ total: 1, units: [{ id: "lu-1", name: "Tap a hole", hoursNormal: 0.004, outputUom: "EA" }] }));
    else if (url.pathname === "/datasets/search/global") response.end(JSON.stringify({ results: [{ datasetId: "ds-1", datasetName: "Workshop tables", columns: [{ key: "size", name: "Size in inches" }], sampleRows: [{ size: "1/4", hours: 0.004 }], samplesAreMatches: true }] }));
    else if (url.pathname === "/knowledge/books/kb-1/read-page") response.end(JSON.stringify({ success: true, bookId: "kb-1", pageNumber: 12, image: "data:image/png;base64,aGVsbG8=" }));
    else if (url.pathname === "/knowledge/books/kb-1/info") response.end(JSON.stringify({ book: { storagePath: "knowledge/kb-1/manual.pdf" } }));
    else if (url.pathname === "/knowledge/books/kb-1/passage") {
      assert.equal(url.searchParams.get("chunkId"), "kc-1");
      response.end(JSON.stringify({ book: { id: "kb-1", name: "Workshop manual" }, chunkId: "kc-1", chunks: [
        { id: "kc-0", order: 6, text: "Neighbor ".repeat(2000) }, { id: "kc-1", order: 7, text: "MATCHED TABLE\nHole | hours\n1/4 | 0.004" },
      ] }));
    } else { response.statusCode = 404; response.end("{}"); }
  });
  api.listen(0, "127.0.0.1"); await once(api, "listening");
  const address = api.address(); assert.ok(address && typeof address === "object");
  // api-client's base URL is captured at import time; use this test's transport
  // only in its own subprocess to avoid module state shared with the prior test.
  const { spawn } = await import("node:child_process");
  const script = `
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { registerKnowledgeTools } from './packages/mcp-server/src/tools/knowledge-tools.ts';
    const server=new McpServer({name:'search-proof',version:'1'}); registerKnowledgeTools(server);
    const [ct,st]=InMemoryTransport.createLinkedPair(); const client=new Client({name:'proof',version:'1'});
    await server.connect(st); await client.connect(ct);
    try {
      const search=await client.callTool({name:'searchEstimatingKnowledge',arguments:{query:'tap hole'}});
      const passage=await client.callTool({name:'readKnowledgePassage',arguments:{bookId:'kb-1',chunkId:'kc-1',maxChars:1000}});
      const page=await client.callTool({name:'getBookPage',arguments:{bookId:'kb-1',pageNumber:12}});
      console.log(JSON.stringify({search,passage,page}));
    } finally { await client.close(); await server.close(); }
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { env: { ...process.env, BIDWRIGHT_API_URL: `http://127.0.0.1:${address.port}` }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stdout.on("data", (chunk) => output += chunk); child.stderr.on("data", (chunk) => errors += chunk);
  try {
    const [code] = await once(child, "exit"); assert.equal(code, 0, errors);
    const { search, passage, page } = JSON.parse(output);
    assert.equal(page.content[0].type, "image");
    assert.equal(page.content[0].mimeType, "image/png");
    const groups = JSON.parse(search.content[0].text).results;
    const book = groups.find((group: any) => group.source === "books").hits[0];
    assert.equal(book.bookId, "kb-1"); assert.equal(book.id, "kc-1"); assert.match(book.text, /0\.004/);
    assert.equal(groups.find((group: any) => group.source === "labor").hits[0].hoursNormal, 0.004);
    const chunks = JSON.parse(passage.content[0].text).chunks;
    assert.match(chunks.find((chunk: any) => chunk.id === "kc-1").text, /MATCHED TABLE/);
    assert.ok(chunks.reduce((sum: number, chunk: any) => sum + chunk.text.length, 0) <= 1000);
  } finally {
    if (child.exitCode == null) child.kill("SIGTERM");
    api.close(); await once(api, "close");
  }
});

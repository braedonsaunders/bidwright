import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

// A mocked project context is established before api-client captures environment variables.
process.env.BIDWRIGHT_PROJECT_ID = "project-coverage-fixture";
const { registerKnowledgeTools } = await import("./knowledge-tools.js");
const { registerComponentTools } = await import("./component-tools.js");

test("read tools record only delivered slices and provide working continuation parameters", async t => {
  const handlers = new Map<string, any>();
  const server = { tool: (name: string, _description: string, shape: any, run: any) => handlers.set(name, (args: any) => run(z.object(shape).parse(args))) } as any;
  registerKnowledgeTools(server);
  registerComponentTools(server);
  const records: any[] = [];
  const markdown = "| Type | Tag | Qty |\n|---|---|---|\n| Receptacle | R-1 | 4 |";
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    if (init.method === "POST") { records.push(JSON.parse(init.body)); return Response.json({ recorded: true }); }
    return Response.json({ fileName: "Device schedule.pdf", content: "Electrical device schedule text.", textPages: [2], checksum: "version1", structuredData: { tables: [{ pageNumber: 2, markdown }], pageText: [{ pageNumber: 2, lines: [{ text: "R-1 R-2 R-1" }] }] } });
  });
  const first = await handlers.get("readDocumentText")({ documentId: "doc-device", pages: "2", maxChars: 10 });
  assert.match(first.content[0].text, /offset=10/);
  assert.deepEqual(records[0], { documentId: "doc-device", tool: "readDocumentText", pages: [2], offset: 0, returnedChars: 10, totalChars: 32, truncated: true, checksum: "version1" });
  await handlers.get("readDocumentText")({ documentId: "doc-device", pages: "2", offset: 10 });
  assert.equal(records[1].returnedChars, 22);
  assert.equal(records[1].truncated, false);
  const structured = JSON.parse((await handlers.get("getDocumentStructured")({ documentId: "doc-device", maxTableChars: 10 })).content[0].text);
  assert.equal(structured.tables[0].nextOffset, 10);
  assert.equal(records[2].returnedChars, 10);
  assert.equal(records[2].section, "table:0");
  const census = JSON.parse((await handlers.get("countComponents")({ documentId: "doc-device", pages: "2", tagPrefixes: ["R"] })).content[0].text);
  assert.equal(census.entries.find((e: any) => e.type === "Receptacle").count, 4);
  assert.equal(census.entries.find((e: any) => e.type === "R").count, 2);
  assert.equal(records[3].returnedChars, 0, "a census does not claim to deliver full source text");
});

test("census retains extracted counts and later page scans when one scan fails", async t => {
  let handler: any;
  registerComponentTools({ tool: (_name: string, _description: string, shape: any, run: any) => { handler = (args: any) => run(z.object(shape).parse(args)); } } as any);
  t.mock.method(globalThis, "fetch", async (url: any, init: any) => {
    if (init.method === "GET") return Response.json({ content: "Devices", structuredData: { tables: [{ pageNumber: 1, markdown: "| Type | Qty |\n|---|---|\n| Receptacle | 4 |" }] } });
    if (String(url).includes("scan-drawing")) return JSON.parse(init.body).pageNumber === 1 ? new Response("image unavailable", {status:400}) : Response.json({ success: true, clusters: [] });
    return Response.json({ recorded: true });
  });
  const result = JSON.parse((await handler({ documentId: "doc-device", symbolPages: [1,2] })).content[0].text);
  assert.equal(result.entries[0].count, 4);
  assert.equal(result.symbolMatches[0].success, false);
  assert.match(result.symbolMatches[0].error, /image unavailable/);
  assert.equal(result.symbolMatches[1].success, true);
});

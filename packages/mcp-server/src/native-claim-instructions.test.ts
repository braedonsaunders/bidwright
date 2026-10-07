import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Sonnet re-inspected 15 tiles and 7 pages with legacy tools to "get" image
// hashes the server already fills from a viewId, because the claim schema
// advertised imageHash but not viewId and several hints said to copy the hash.
const ASKS_FOR_HASH = /(include|with|put|copy|supply|must include)[^.]{0,60}imageHash(?![^.]{0,40}(server|leave empty|filled))/i;

async function listTools() {
  process.env.BIDWRIGHT_API_URL ??= "http://127.0.0.1:9";
  process.env.BIDWRIGHT_PROJECT_ID ??= "project-test";
  const { registerDrawingEvidenceTools } = await import("./tools/drawing-evidence-tools.js");
  const { registerVisionTools } = await import("./tools/vision-tools.js");
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerDrawingEvidenceTools(server);
  registerVisionTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

test("evidence claims advertise viewId and tell the agent the server fills the hash", async () => {
  const tools = await listTools();
  const claim = tools.find((tool) => tool.name === "saveDrawingEvidenceClaim");
  assert.ok(claim, "saveDrawingEvidenceClaim is registered");
  const evidence = (claim.inputSchema.properties as any).evidence;
  const itemProps = JSON.stringify(evidence);
  assert.match(itemProps, /"viewId"/);
  assert.match(claim.description ?? "", /cite the viewId/i);
  assert.match(claim.description ?? "", /never type an imageHash/i);
});

test("no drawing tool or gate message asks the agent to supply an image hash", async () => {
  for (const tool of await listTools()) {
    assert.doesNotMatch(tool.description ?? "", ASKS_FOR_HASH, `${tool.name} description asks for an imageHash`);
  }
  for (const file of ["./tools/drawing-evidence-tools.ts", "./tools/quote-tools.ts", "./tools/vision-tools.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const messages = source.match(/(["`])(?:(?!\1)[^\\]|\\.)*imageHash(?:(?!\1)[^\\]|\\.)*\1/g) ?? [];
    for (const message of messages.filter((text) => text.length > 60)) {
      assert.doesNotMatch(message, ASKS_FOR_HASH, `${file}: ${message.slice(0, 160)}`);
    }
  }
});

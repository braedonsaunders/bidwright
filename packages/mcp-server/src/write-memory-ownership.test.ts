import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("writeMemory replaces a memory file it cannot open for writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bw-memory-"));
  const previousCwd = process.cwd();
  const memoryPath = join(dir, "agent-memory.json");
  // Stand-in for the root-owned 0644 file the API left behind: unwritable to
  // us, inside a directory we own.
  await writeFile(memoryPath, JSON.stringify({ sections: { ingestion_results: "3 documents" } }));
  await chmod(memoryPath, 0o444);
  process.chdir(dir);
  try {
    const { registerSystemTools } = await import("./tools/system-tools.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSystemTools(server);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "writeMemory", arguments: { section: "progress", content: "Alexanderwerk sheet read" } });
    assert.notEqual(result.isError, true, JSON.stringify(result.content));
    const saved = JSON.parse(await readFile(memoryPath, "utf8"));
    assert.equal(saved.progress, "Alexanderwerk sheet read");
    // What the API wrote is kept alongside.
    assert.equal(saved.sections.ingestion_results, "3 documents");
    await client.close();
  } finally {
    process.chdir(previousCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

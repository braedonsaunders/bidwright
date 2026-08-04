import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

test("queryKnowledgeDataset uses typed filters for an exact one-digit pipe-size row", async () => {
  let queryBody: unknown;
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
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    if (previousApiUrl === undefined) delete process.env.BIDWRIGHT_API_URL;
    else process.env.BIDWRIGHT_API_URL = previousApiUrl;
    api.close();
    await once(api, "close");
  }
});

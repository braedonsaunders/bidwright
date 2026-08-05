import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

async function requestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function textPayload(result: unknown) {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  const text = content.find((item) => item.type === "text")?.text;
  assert.ok(text);
  return JSON.parse(text);
}

test("model MCP tools expose topology, native properties, and atomic group-to-worksheet flow", async () => {
  const group = {
    id: "group-run-1",
    modelId: "model-1",
    signature: "run:pipe:a",
    parentId: "group-system-1",
    kind: "run",
    name: "Heating water run A",
    trade: "mechanical",
    source: "authored",
    confidence: 0.98,
    measurementType: "length",
    quantity: 30,
    unit: "m",
    warnings: [],
    memberElementIds: ["element-1", "element-2"],
    memberCount: 2,
    childCount: 0,
  };
  const elements = [
    {
      id: "element-1",
      externalId: "101",
      name: "Pipe segment 1",
      elementClass: "Pipe",
      elementType: "DN100",
      system: "Heating Water",
      material: "Carbon Steel",
      level: "L1",
      properties: { Diameter: "100 mm", Service: "Heating Water" },
      quantities: [{ id: "quantity-1", quantityType: "length", value: 12, unit: "m", confidence: 1 }],
    },
    {
      id: "element-2",
      externalId: "102",
      name: "Pipe segment 2",
      elementClass: "Pipe",
      elementType: "DN100",
      system: "Heating Water",
      material: "Carbon Steel",
      level: "L1",
      properties: { Diameter: "100 mm", Service: "Heating Water" },
      quantities: [{ id: "quantity-2", quantityType: "length", value: 18, unit: "m", confidence: 1 }],
    },
  ];
  let createdBody: Record<string, unknown> | null = null;
  let bulkBody: Record<string, unknown> | null = null;

  const api = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/models/project-test/assets/model-1/topology") {
      response.end(JSON.stringify({
        version: 1,
        diagnostics: { systemCount: 1, runCount: 1 },
        groups: [group],
        connections: [],
        connectionCount: 1,
        recipes: [],
        overrides: [],
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/models/project-test/assets/model-1/elements") {
      const requested = new Set((url.searchParams.get("ids") ?? "").split(",").filter(Boolean));
      const matched = elements.filter((element) => requested.size === 0 || requested.has(element.id));
      response.end(JSON.stringify({ elements: matched, count: matched.length, offset: 0, limit: matched.length }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/projects/project-test/worksheets/worksheet-1/items") {
      createdBody = await requestJson(request);
      response.statusCode = 201;
      response.end(JSON.stringify({ item: { id: "worksheet-item-1", ...createdBody } }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/models/project-test/assets/model-1/takeoff-links/bulk") {
      bulkBody = await requestJson(request);
      response.statusCode = 201;
      response.end(JSON.stringify({ created: (bulkBody?.links as unknown[]).length }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address === "object");

  const previousEnvironment = {
    BIDWRIGHT_API_URL: process.env.BIDWRIGHT_API_URL,
    BIDWRIGHT_AUTH_TOKEN: process.env.BIDWRIGHT_AUTH_TOKEN,
    BIDWRIGHT_PROJECT_ID: process.env.BIDWRIGHT_PROJECT_ID,
  };
  process.env.BIDWRIGHT_API_URL = `http://127.0.0.1:${address.port}`;
  process.env.BIDWRIGHT_AUTH_TOKEN = "test-token";
  process.env.BIDWRIGHT_PROJECT_ID = "project-test";

  const { registerModelTools } = await import("./tools/model-tools.js");
  const server = new McpServer({ name: "model-tools-test-server", version: "1.0.0" });
  registerModelTools(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "model-tools-test", version: "1.0.0" }, { capabilities: {} });

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = await client.listTools();
    for (const toolName of ["queryModelTakeoffGroups", "getModelElementDetails", "addModelTakeoffGroupToWorksheet"]) {
      assert.ok(tools.tools.some((tool) => tool.name === toolName), `${toolName} should be registered`);
    }

    const queried = textPayload(await client.callTool({
      name: "queryModelTakeoffGroups",
      arguments: { modelId: "model-1", kind: "run" },
    }));
    assert.equal(queried.groups[0].signature, "run:pipe:a");
    assert.equal(queried.groups[0].quantity, 30);

    const inspected = textPayload(await client.callTool({
      name: "getModelElementDetails",
      arguments: { modelId: "model-1", elementIds: ["element-1"] },
    }));
    assert.equal(inspected.elements[0].properties.Diameter, "100 mm");
    assert.equal(inspected.elements[0].takeoffGroups[0].signature, "run:pipe:a");

    const added = textPayload(await client.callTool({
      name: "addModelTakeoffGroupToWorksheet",
      arguments: {
        modelId: "model-1",
        groupSignature: "run:pipe:a",
        worksheetId: "worksheet-1",
        category: "Material",
        entityType: "material",
      },
    }));
    assert.equal(added.worksheetItemId, "worksheet-item-1");
    assert.equal(added.linksCreated, 2);
    const createdPayload = createdBody as unknown as Record<string, unknown>;
    const bulkPayload = bulkBody as unknown as Record<string, unknown>;
    assert.equal(createdPayload.quantity, 30);
    assert.equal(createdPayload.uom, "m");
    const links = bulkPayload.links as Array<Record<string, unknown>>;
    assert.deepEqual(links.map((link) => link.derivedQuantity), [12, 18]);
    assert.deepEqual(links.map((link) => link.modelQuantityId), ["quantity-1", "quantity-2"]);
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    api.close();
    await once(api, "close");
  }
});

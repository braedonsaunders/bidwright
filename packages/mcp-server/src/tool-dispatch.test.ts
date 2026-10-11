import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

test("direct and indirect calls share schemas, project scope, images, logging and QA policy", async (t) => {
  process.env.BIDWRIGHT_PROJECT_ID = "dispatch-project";
  const { registerTools } = await import("./index.js");
  const requests: { path: string; body: any }[] = [];
  const events: any[] = [];
  t.mock.method(console, "error", (line: string) => { events.push(JSON.parse(line)); });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, body: { ...body, query: new URL(url).search } });
    if (path.endsWith("/assets")) return Response.json({ scan: { status: "failed", error: "model.nwd: extractor -777" }, assets: [{ id: "model", status: "failed", progress: "complete", terminalErrors: [{ code: "aps_translation_failed", message: "extractor -777" }] }] });
    if (path === "/integrations") return Response.json({ integrations: [] });
    if (path.endsWith("/pickups")) return Response.json(init.method === "GET" ? [] : { id: "saved-pickup", ...body });
    if (path.endsWith("/read-page")) return Response.json({ success: true, image: "data:image/png;base64,cG5n", viewId: "view-1", textLines: [{ text: "Dimension", bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } }], rotation: 90 });
    if (path.endsWith("/render-page")) return Response.json({ success: true, image: "data:image/png;base64,cG5n", viewId: "native-view", width: 1200, height: 900, pageWidth: 576, pageHeight: 432 });
    return Response.json({ id: "saved" });
  });
  for (const mode of ["build_estimate", "qa"]) {
    const server = new McpServer({ name: "dispatch-test", version: "1" });
    await registerTools(server, { mode });
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      for (const name of ["getSourceOverview", "describeTools", "invokeTool", "listModels", "listPickups"]) {
        assert.equal(listed.tools.find(tool => tool.name === name)?._meta?.["anthropic/alwaysLoad"], true);
      }
      assert.equal(listed.tools.find(tool => tool.name === "readDrawingPage")?._meta?.["anthropic/alwaysLoad"], undefined);
      const polled: any = await client.callTool({ name: "listModels", arguments: { refresh: false } });
      assert.equal(requests.at(-1)!.body.query, "?refresh=0");
      const modelStatus = JSON.parse(polled.content[0].text);
      assert.equal(modelStatus.scan.status, "failed");
      assert.equal(modelStatus.models[0].terminalErrors[0].code, "aps_translation_failed");
      assert.equal(modelStatus.models[0].progress, "complete");
      const direct = await client.callTool({ name: "listPickups", arguments: { projectId: "foreign" } });
      const indirect = await client.callTool({ name: "invokeTool", arguments: { name: "listPickups", args: { projectId: "foreign" } } });
      assert.deepEqual(indirect, direct);
      assert.equal(requests.filter(({ path }) => path.endsWith("/pickups")).every(({ path }) => path === "/api/takeoff/dispatch-project/pickups"), true);
      const readArgs = { documentId: "drawing", pageNumber: "1" };
      const directImage = await client.callTool({ name: "readDrawingPage", arguments: readArgs });
      const indirectImage = await client.callTool({ name: "invokeTool", arguments: { name: "readDrawingPage", args: readArgs } });
      assert.deepEqual(indirectImage, directImage);
      assert.equal(requests.at(-1)!.body.pageNumber, 1);
      assert.equal(requests.at(-1)!.body.projectId, "dispatch-project");
      const detailed: any = await client.callTool({ name: "readDrawingPage", arguments: { ...readArgs, responseFormat: "detailed" } });
      assert.deepEqual(JSON.parse(detailed.content[1].text).textLines[0].bbox, { x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
      const native: any = await client.callTool({ name: "renderDrawingPage", arguments: { documentId: "drawing", dpi: 200 } });
      assert.equal(JSON.parse(native.content[1].text).imageWidth, 1200);
      assert.equal(requests.at(-1)!.body.dpi, 200);
      assert.equal(requests.at(-1)!.body.rotation, undefined);
      const region = { x: 10, y: 20, width: 30, height: 40, imageWidth: 1200, imageHeight: 900 };
      const zoom: any = await client.callTool({ name: "zoomDrawingRegion", arguments: { documentId: "drawing", region } });
      assert.deepEqual(JSON.parse(zoom.content[1].text).originalRegion, region);
      assert.equal(requests.at(-1)!.body.dpi, 300);
      const directMath = await client.callTool({ name: "calculateMath", arguments: { expression: "3 * 7" } });
      const indirectMath = await client.callTool({ name: "invokeTool", arguments: { name: "calculateMath", args: { expression: "3 * 7" } } });
      assert.deepEqual(indirectMath, directMath);
      const beforeInvalid = requests.length;
      for (const call of [
        { name: "readDrawingPage", arguments: {} },
        { name: "invokeTool", arguments: { name: "readDrawingPage", args: {} } },
      ]) assert.equal((await client.callTool(call)).isError, true);
      assert.equal(requests.length, beforeInvalid);
      const described: any = await client.callTool({ name: "describeTools", arguments: { name: "listPickups" } });
      const definition = JSON.parse(described.content[0].text)[0];
      assert.equal(definition.mutates, false);
      assert.equal(definition.inputSchema.properties.responseFormat.default, "concise");
      // Every integrated takeoff family must participate in discovery and the
      // same read/write policy as direct registration.
      for (const name of ["getSourceOverview", "getTakeoffCalibration", "queryCadEntities", "getModelSolidMetrics", "getPipingMto"]) {
        const result: any = await client.callTool({ name: "describeTools", arguments: { name } });
        const tool = JSON.parse(result.content[0].text)[0];
        assert.equal(tool.name, name);
        assert.equal(tool.mutates, false);
        assert.equal(tool.inputSchema.type, "object");
      }
      for (const name of ["saveTakeoffMeasurement", "saveSourceQuantityTakeoff", "saveCadEntityTakeoff", "savePipingTakeoff"]) {
        const result: any = await client.callTool({ name: "describeTools", arguments: { name } });
        assert.equal(result.isError === true, mode === "qa", name);
        if (mode !== "qa") assert.equal(JSON.parse(result.content[0].text)[0].mutates, true, name);
      }
      const catalog: any = await client.callTool({ name: "describeTools", arguments: { family: "vision" } });
      const names = JSON.parse(catalog.content[0].text).map((tool: any) => tool.name);
      assert.ok(names.includes("listPickups"));
      assert.equal(names.includes("saveCountAsAnnotations"), mode !== "qa");
      const beforeWrite = requests.length;
      const write = await client.callTool({ name: "invokeTool", arguments: { name: "saveCountAsAnnotations", args: { documentId: "drawing", pageNumber: 1, matches: [{ rect: { x: 10, y: 20 }, confidence: 0.9 }], label: "Count", imageWidth: 1200, imageHeight: 900, pdfPageWidth: 576, pdfPageHeight: 432 } } });
      assert.equal(write.isError === true, mode === "qa");
      assert.equal(requests.length, beforeWrite + (mode === "qa" ? 0 : 1));
      if (mode !== "qa") {
        assert.equal(requests.at(-1)!.path, "/api/takeoff/dispatch-project/pickups");
        assert.equal(requests.at(-1)!.body.measurement.value, 1);
      }
      for (const name of ["invokeTool", "unregisteredReadTool", "integration_missing_action"]) {
        assert.equal((await client.callTool({ name: "invokeTool", arguments: { name, args: {} } })).isError, true);
      }
      assert.ok(events.filter((event) => event.tool === "readDrawingPage").length >= 2);
    } finally {
      await client.close();
      await server.close();
    }
  }
});

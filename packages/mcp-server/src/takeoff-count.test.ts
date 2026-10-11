import assert from "node:assert/strict";
import test from "node:test";
import { pickupLinkQuantity } from "@bidwright/domain";
import { z } from "zod";

test("count reads never save; an explicit grouped save links quantity N, not N squared", async (t) => {
  process.env.BIDWRIGHT_PROJECT_ID = "test-project";
  const { registerVisionTools } = await import("./tools/vision-tools.js");
  const { registerResourceTools } = await import("./tools/resource-tools.js");
  const handlers = new Map<string, (args: any) => Promise<any>>();
  const server = { tool(name: string, _description: string, shape: z.ZodRawShape, handler: (args: any) => Promise<any>) {
    handlers.set(name, (args) => handler(z.object(shape).parse(args)));
  } } as any;
  registerVisionTools(server);
  registerResourceTools(server);
  const matches = [20, 80, 140].map((x) => ({ rect: { x, y: 30, width: 12, height: 8 }, confidence: 0.9, method: "template_matching" }));
  const pickups: any[] = [];
  const requests: { path: string; body: any }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    requests.push({ path, body });
    if (path.endsWith("/count-symbols")) return Response.json({ success: true, matches, totalCount: 3, imageWidth: 1200, imageHeight: 900 });
    if (path.endsWith("/render-page")) return Response.json({ success: true, width: 1200, height: 900, pageWidth: 576, pageHeight: 432 });
    if (path.endsWith("/run-on-page") || path.endsWith("/run-on-document")) {
      assert.equal(body.autoSave, false);
      const templateResults = [{ matches: [...matches, ...matches, ...matches, ...matches].map(({ rect, confidence }) => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, confidence })), totalCount: 12 }];
      return Response.json({ templateResults, imageWidth: 1200, imageHeight: 900, pages: [{ pageNumber: 1, imageWidth: 1200, imageHeight: 900, templateResults }] });
    }
    assert.equal(path, "/api/takeoff/test-project/pickups");
    if (init.method === "GET") return Response.json(pickups);
    const pickup = { id: `pickup-${pickups.length + 1}`, ...body };
    pickups.push(pickup);
    return Response.json(pickup);
  });
  const call = async (name: string, args: any) => JSON.parse((await handlers.get(name)!(args)).content[0].text);
  const countInput = { documentId: "drawing", pageNumber: 1, autoSave: true, boundingBox: { x: 20, y: 30, width: 12, height: 8, imageWidth: 600, imageHeight: 450 } };
  const count = await call("countSymbols", countInput);
  const drawingCount = await call("countDrawingSymbol", countInput);
  assert.equal(count.imageWidth, 1200);
  assert.equal(drawingCount.imageWidth, 1200);
  let libraryMatchSetId = "";
  for (const scope of ["page", "document"]) {
    const result = await call("runProjectSymbolLibrary", { documentId: "drawing", pageNumber: 1, scope, autoSave: true });
    assert.match(result.note, /read-only/);
    const template = (result.templateResults ?? result.pages[0].totalsBySymbol)[0];
    assert.equal(template.sampleMatches.length, 3);
    assert.equal(template.matches, undefined);
    libraryMatchSetId = template.matchSetId;
    assert.ok(libraryMatchSetId);
  }
  assert.equal(pickups.length, 0);
  assert.ok(requests.every(({ path }) => !path.includes("save-detections") && !path.endsWith("/pickups")));
  const saved = await call("saveCountAsAnnotations", { ...count, label: "Counted symbol" });
  assert.equal(saved.savedCount, 1);
  assert.deepEqual(saved.pickupIds, ["pickup-1"]);
  assert.equal(pickups.length, 1);
  assert.equal(pickups[0].points.length, 3);
  assert.deepEqual(pickups[0].points[0], { x: 26, y: 34 });
  assert.equal(pickups[0].metadata.matches.length, 3);
  assert.equal(pickups[0].metadata.canvasWidth, 1200);
  assert.equal(pickups[0].metadata.pdfPageWidth, 576);
  const listed = await call("listPickups", {});
  assert.equal(listed.annotations[0].measurement.value, 3);

  const linkedQuantity = pickups.reduce((sum, pickup) => sum + pickupLinkQuantity(pickup.measurement), 0);
  assert.equal(linkedQuantity, matches.length);
  assert.equal(pickupLinkQuantity({ value: 3, area: 12 }, "area", 2), 24);
  assert.equal(pickupLinkQuantity({ value: 3 }, "value", 0), 0);
  const referenceSave = await call("saveCountAsAnnotations", { documentId: "drawing", pageNumber: 1, matchSetId: libraryMatchSetId, label: "Library count" });
  assert.equal(referenceSave.savedCount, 1);
  assert.equal(pickups[1].measurement.value, 12);
  const mismatch = await handlers.get("saveCountAsAnnotations")!({ documentId: "another-drawing", pageNumber: 1, matchSetId: libraryMatchSetId, label: "Count" });
  assert.equal(mismatch.isError, true);
  await call("saveCountAsAnnotations", { documentId: "drawing", pageNumber: 1, matches, label: "Legacy dimensions" });
  assert.equal(pickups[2].metadata.canvasWidth, 1200);
  await assert.rejects(() => call("saveCountAsAnnotations", { documentId: "drawing", pageNumber: 1, matches, label: "Count", imageWidth: -1 }), /greater than 0/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
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
    if (path.endsWith("/render-page")) return Response.json({ success: true, imageWidth: 1200, imageHeight: 900, pageWidth: 576, pageHeight: 432 });
    if (path.endsWith("/run-on-page") || path.endsWith("/run-on-document")) {
      assert.equal(body.autoSave, false);
      const templateResults = [{ matches: matches.map(({ rect, confidence }) => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height, confidence })), totalCount: 3 }];
      return Response.json({ templateResults, pages: [{ pageNumber: 1, templateResults }] });
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
  for (const scope of ["page", "document"]) {
    const result = await call("runProjectSymbolLibrary", { documentId: "drawing", pageNumber: 1, scope, autoSave: true });
    assert.match(result.note, /read-only/);
    assert.equal((result.templateResults ?? result.pages[0].totalsBySymbol)[0].matches.length, 3);
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

  // Run the production link method against an in-memory store. No DB connection.
  const source = readFileSync(new URL("../../../apps/api/src/prisma-store.ts", import.meta.url), "utf8");
  const start = source.indexOf("  async createPickupLink(");
  const end = source.indexOf("  async updatePickupLink(", start);
  assert.ok(start > 0 && end > start);
  const compiled = ts.transpileModule(`class LinkStore { ${source.slice(start, end)} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const LinkStore = new Function("createId", "mapPickupLink", `${compiled}; return LinkStore;`)(() => "link-1", (value: unknown) => value);
  const store = new LinkStore();
  const links: any[] = [];
  Object.assign(store, {
    requireProject: async () => {}, findCurrentRevision: async () => ({ revision: { id: "revision" } }),
    assertLinkQuantityCompatible: () => {}, recalcLinkedItemQuantity: async () => {},
    db: {
      pickup: { findFirst: async () => pickups[0] },
      worksheetItem: { findFirst: async () => ({ id: "item", worksheetId: "worksheet", uom: "count" }) },
      worksheet: { findFirst: async () => ({ revisionId: "revision" }) },
      pickupLink: { create: async ({ data }: any) => { links.push(data); return data; } },
    },
  });
  for (const pickup of pickups) await store.createPickupLink("test-project", { pickupId: pickup.id, worksheetItemId: "item" });
  assert.equal(links.reduce((sum, link) => sum + link.derivedQuantity, 0), matches.length);
  await assert.rejects(() => call("saveCountAsAnnotations", { documentId: "drawing", pageNumber: 1, matches, label: "Count", imageWidth: -1 }), /greater than 0/);
});

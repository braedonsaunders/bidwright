import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { savedPickupFacts } from "./takeoff-hints.js";

test("row tools and batch schemas retain takeoff and return the server's derived quantities", async t => {
  process.env.BIDWRIGHT_PROJECT_ID = "test-project";
  const { registerQuoteTools } = await import("./tools/quote-tools.js");
  const handlers = new Map<string, (args: any) => Promise<any>>();
  registerQuoteTools({ tool(name: string, _description: string, shape: z.ZodRawShape, handler: (args: any) => Promise<any>) {
    handlers.set(name, (args) => handler(z.object(shape).parse(args)));
  } } as any);
  const takeoff = [{ pickupId: "a" }, { pickupId: "b", multiplier: 2 }];
  const saved = { id: "row", worksheetId: "worksheet", entityName: "Pipe", category: "Material", quantity: 20, uom: "ft", takeoff: { count: 2, sum: 20, unit: "ft", pickupIds: ["a", "b"] }, removedLinks: [], changedLinks: [], takeoffFact: "Linked quantity 20 replaces supplied quantity 99." };
  const workspace = {
    currentRevision: { id: "rev" }, project: { name: "test" },
    worksheets: [{ id: "worksheet", items: [saved] }],
    entityCategories: [{ id: "cat", name: "Material", entityType: "Material", calculationType: "manual", entryMode: "freeform", defaultUom: "ft", validUoms: ["ft"], allowedUoms: ["ft"] }],
    rateSchedules: [{ id: "schedule", category: "Material", tiers: [{ id: "tier", name: "Standard" }], items: [{ id: "rate", name: "Pipe", tierRates: { tier: 5 } }] }],
  };
  const writes: any[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const target = new URL(url);
    if (init.method === "GET") return Response.json({ workspace });
    const body = JSON.parse(String(init.body)); writes.push({ path: target.pathname, query: target.search, body });
    if (target.pathname.endsWith("/batch")) return Response.json({ results: [{ index: 0, op: "create", itemId: "row", item: saved }] });
    return Response.json({ item: saved });
  });
  const derivation = { version: 1, target: "quantity", formula: "length", inputs: [{ name: "length", value: 20, unit: "ft", source: { kind: "assumption", ref: "fixture" } }], result: { value: 20, unit: "ft" }, status: "draft" };
  for (const [name, input] of [
    ["createWorksheetItem", { worksheetId: "worksheet", entityName: "Pipe", categoryId: "cat", quantity: 99, uom: "ft", cost: 5, takeoff }],
    ["updateWorksheetItem", { itemId: "row", quantity: 99, takeoff }],
    ["createRateScheduleWorksheetItem", { worksheetId: "worksheet", rateScheduleItemId: "rate", evidenceBasis: {}, tierUnits: { tier: 1 }, quantity: 99, uom: "ft", takeoff }],
  ] as const) {
    const response = await handlers.get(name)!({ ...input, derivation });
    assert.ok(!response.isError, response.content[0].text);
    assert.deepEqual(writes.at(-1).body.takeoff, takeoff, name);
    assert.equal(writes.at(-1).query, "?response=delta");
    assert.match(response.content[0].text, /"quantity":\s*20/);
    assert.match(response.content[0].text, /takeoffFact/);
    assert.match(response.content[0].text, /removedLinks/);
  }
  const batch = await handlers.get("batchEditWorksheetItems")!({ operations: [{ op: "create", worksheetId: "worksheet", item: { entityName: "Pipe", categoryId: "cat", uom: "ft", takeoff } }] });
  assert.ok(!batch.isError, batch.content[0].text);
  assert.deepEqual(writes.at(-1).body.operations[0].item.takeoff, takeoff);
  assert.match(batch.content[0].text, /takeoffFact/);
  const read = await handlers.get("getWorkspace")!({});
  assert.match(read.content[0].text, /linkedRows/);
  assert.match(read.content[0].text, /"count":\s*2/);
});

test("pickup hints report pickup IDs from each saved-tool shape, never link IDs", () => {
  for (const response of [
    { pickup: { id: "p" }, link: { id: "not-a-pickup" } },
    { pickups: [{ pickup: { id: "p" }, link: { id: "not-a-pickup" } }] },
    { saved: [{ pickup: { id: "p" } }] },
    { annotations: [{ id: "p" }] },
    { link: { id: "not-a-pickup", pickupId: "p" } },
    { pickupIds: ["p", "p"] },
  ]) {
    const result = savedPickupFacts(response);
    assert.deepEqual(result.pickupIds, ["p"]);
    assert.match(result.rowLinkFact, /createWorksheetItem\/updateWorksheetItem/);
    assert.match(result.rowLinkFact, /"takeoff":\[\{"pickupId":"p"\}\]/);
  }
});

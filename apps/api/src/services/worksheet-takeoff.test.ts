import assert from "node:assert/strict";
import test from "node:test";
import { PrismaApiStore } from "../prisma-store.js";
import { rowTakeoffSummary } from "../store/mappers.js";
import { takeoffRowId } from "./worksheet-takeoff.js";

// No live database: exercise the store's transaction, integrity, link replacement
// and existing recalc path. The ordinary row-write fixture only persists a row.
test("takeoff row writes sum, replace, retry, and roll back atomically", async t => {
  let rows: any[] = [], links: any[] = [];
  let transactions = 0, failLink = false;
  const activities: any[] = [];
  const pickups = [
    { id: "one", projectId: "project", label: "Run A", metadata: { measuredBy: "person", editedBy: "person" }, annotationType: "linear", measurement: { value: 12, unit: "ft" } },
    { id: "two", projectId: "project", label: "Run B", metadata: { measuredBy: "agent" }, annotationType: "linear", measurement: { value: 8, count: 8, unit: "ft" } },
    { id: "metric", projectId: "project", annotationType: "linear", measurement: { value: 1, unit: "m" } },
    { id: "pixels", projectId: "project", annotationType: "linear", measurement: { value: 50, unit: "px" } },
    { id: "foreign", projectId: "other", annotationType: "linear", measurement: { value: 99, unit: "ft" } },
    { id: "model", projectId: "project", annotationType: "model-element", measurement: { value: 10, unit: "ft" } },
    { id: "unknown", projectId: "project", annotationType: "model-element", measurement: { value: 10, unit: "" } },
  ];
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([key, value]) => row[key] === value);
  const db: any = {
    $executeRaw: async () => 1,
    project: { findFirst: async () => ({ id: "project" }) },
    worksheet: { findFirst: async () => ({ id: "worksheet", revisionId: "revision" }) },
    activity: { create: async ({ data }: any) => { activities.push(data); return data; } },
    worksheetItem: {
      findFirst: async ({ where }: any) => rows.find(row => matches(row, where)),
      create: async ({ data }: any) => { rows.push(data); return data; },
      update: async ({ where, data }: any) => Object.assign(rows.find(row => matches(row, where)), data),
    },
    pickup: { findFirst: async ({ where }: any) => pickups.find(row => matches(row, where)) },
    pickupLink: {
      findMany: async ({ where, include }: any) => links.filter(row => matches(row, where)).map(row => ({ ...row, ...(include?.pickup ? { pickup: pickups.find(p => p.id === row.pickupId) } : {}) })),
      deleteMany: async ({ where }: any) => { links = links.filter(link => link.worksheetItemId !== where.worksheetItemId || where.pickupId.notIn.includes(link.pickupId)); },
      upsert: async ({ where, create, update }: any) => {
        if (failLink) throw new Error("simulated link write failure");
        const existing = links.find(link => matches(link, where.pickupId_worksheetItemId));
        if (existing) return Object.assign(existing, update);
        links.push(create); return create;
      },
    },
    entityCategory: { findMany: async () => [{ id: "cat", name: "Material", entityType: "Material", calculationType: "manual" }] },
    rateSchedule: { findMany: async () => [] },
  };
  const rootDb = { ...db, $transaction: async (work: any) => {
    transactions++;
    const before = structuredClone({ rows, links });
    try { return await work(db); }
    catch (error) { rows = before.rows; links = before.links; throw error; }
  } };
  const proto = PrismaApiStore.prototype as any;
  t.mock.method(proto, "findCurrentRevision", async () => ({ revision: { id: "revision", defaultMarkup: 0.2, createdAt: new Date(), updatedAt: new Date() } }));
  t.mock.method(proto, "syncProjectEstimate", async () => {});
  t.mock.method(proto, "resolveCurrentRevisionTotals", async () => ({ mappedRevision: { id: "revision" }, totals: {} }));
  t.mock.method(proto, "validateWorksheetItemProvenanceRefs", async () => {});
  t.mock.method(proto, "markDependentDerivationsStale", async () => {});
  t.mock.method(proto, "syncProjectEstimateForWorksheetItemMutation", async () => ({}));
  const originalCreate = proto.createWorksheetItemWithSnapshot;
  const originalUpdate = proto.updateWorksheetItemWithSnapshot;
  t.mock.method(proto, "createWorksheetItemWithSnapshot", async function(this: any, project: string, worksheet: string, input: any, context: any, id: string) {
    if (input.takeoff !== undefined) return originalCreate.call(this, project, worksheet, input, context);
    assert.equal(this.db, db, "row write uses the transaction client");
    const item = await this.db.worksheetItem.create({ data: { ...input, id, worksheetId: worksheet, categoryId: "cat", cost: 5, markup: 0.2, price: 0, lineOrder: rows.length } });
    return { item, snapshot: {} };
  });
  t.mock.method(proto, "updateWorksheetItemWithSnapshot", async function(this: any, project: string, id: string, patch: any, context: any, resolved: boolean) {
    if (!resolved) return originalUpdate.call(this, project, id, patch, context);
    assert.equal(this.db, db, "row update uses the transaction client");
    return { item: await this.db.worksheetItem.update({ where: { id }, data: patch }), snapshot: {} };
  });
  const store = new PrismaApiStore(rootDb, "org");
  const input = { category: "Material", entityType: "Material", entityName: "Pipe", description: "", quantity: 99, uom: "LF", takeoff: [{ pickupId: "one" }, { pickupId: "two" }] };
  const created = await store.createWorksheetItemWithSnapshot("project", "worksheet", input);
  assert.equal(created.item.quantity, 20);
  assert.equal(created.item.takeoff?.count, 2);
  assert.match(created.item.takeoffFact!, /20 LF replaces supplied quantity 99/);
  assert.equal(links.reduce((sum, link) => sum + link.derivedQuantity, 0), 20);
  const retried = await store.createWorksheetItemWithSnapshot("project", "worksheet", input);
  assert.equal(retried.item.id, created.item.id);
  assert.equal(rows.length, 1); assert.equal(links.length, 2);

  const replaced = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { takeoff: [{ pickupId: "two", multiplier: 2 }] });
  assert.equal(replaced.item.quantity, 16); assert.equal(links.length, 1);
  assert.deepEqual(replaced.item.removedLinks?.map(link => [link.pickupId, link.measuredBy, link.editedBy]), [["one", "person", "person"]]);
  assert.equal(replaced.item.changedLinks?.[0].multiplier, 1);
  assert.equal(replaced.item.changedLinks?.[0].after.multiplier, 2);
  assert.equal(replaced.item.changedLinks?.[0].measuredBy, "agent");
  assert.deepEqual(activities.at(-1).data.removedLinks, replaced.item.removedLinks);
  // Retained settings survive omitted fields, including a legacy selected field.
  links[0].quantityField = "count";
  pickups[1].annotationType = "model-element";
  rows[0].uom = "EA";
  pickups[1].measurement.unit = "EA";
  const retained = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { takeoff: [{ pickupId: "two" }] });
  assert.equal(retained.item.quantity, 16);
  assert.equal(links[0].quantityField, "count");
  assert.equal(links[0].multiplier, 2);
  assert.deepEqual(retained.item.changedLinks, []);
  links[0].quantityField = "value";
  pickups[1].annotationType = "linear";
  rows[0].uom = "LF";
  pickups[1].measurement.unit = "ft";
  await store.updateWorksheetItemWithSnapshot("project", created.item.id, { takeoff: [{ pickupId: "two", multiplier: 2 }] });
  assert.equal(links.length, 1);
  // UI patches must never inspect or reject legacy pickup units, or reapply links.
  for (const unit of ["", "px", "ft"]) {
    pickups[1].measurement.unit = unit;
    const preserved = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { quantity: 100 });
    assert.equal(preserved.item.quantity, 100);
    const editedUnit = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { uom: "m" });
    assert.equal(editedUnit.item.uom, "m");
    assert.equal(editedUnit.item.quantity, 100);
    assert.equal(links.length, 1);
    assert.equal(links[0].multiplier, 2);
  }
  pickups[1].measurement.unit = "ft";
  rows[0].uom = "LF";
  const derivation = (value: number) => ({ version: 1, target: "quantity", formula: "length", inputs: [{ name: "length", value, unit: "ft", source: { kind: "assumption", ref: "fixture" } }], result: { value, unit: "ft" }, status: "draft" });
  const valid = await store.createWorksheetItemWithSnapshot("project", "worksheet", { ...input, derivation: derivation(20) });
  assert.equal(valid.item.quantity, 20);
  const beforeMismatch = structuredClone({ rows, links });
  await assert.rejects(store.createWorksheetItemWithSnapshot("project", "worksheet", { ...input, derivation: derivation(99) }), /produces 99 but the row quantity is 20/);
  await assert.rejects(store.updateWorksheetItemWithSnapshot("project", valid.item.id, { takeoff: input.takeoff, derivation: derivation(1) }), /produces 1 but the row quantity is 20/);
  assert.deepEqual({ rows, links }, beforeMismatch);
  // Keep the original row's link assertions local after the derivation fixture.
  rows = rows.filter(row => row.id === created.item.id);
  links = links.filter(link => link.worksheetItemId === created.item.id);

  for (const [pickupId, uom, pattern, multiplier] of [
    ["one", "EA", /length quantity/, 1],
    ["metric", "ft", /Explicit multiplier/],
    ["pixels", "ft", /Pixel/],
    ["foreign", "ft", /not found in project/],
    ["model", "EA", /length quantity/, 1],
    ["unknown", "ft", /unit is unknown/],
  ] as const) {
    const before = structuredClone({ rows, links });
    await assert.rejects(store.createWorksheetItemWithSnapshot("project", "worksheet", { ...input, uom, takeoff: [{ pickupId, multiplier }] }), pattern);
    assert.deepEqual({ rows, links }, before);
  }
  const converted = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { takeoff: [{ pickupId: "metric", multiplier: 3.28084 }] });
  assert.equal(converted.item.quantity, 3.28084);
  failLink = true;
  const before = structuredClone({ rows, links });
  await assert.rejects(store.updateWorksheetItemWithSnapshot("project", created.item.id, { description: "rolled back", takeoff: [{ pickupId: "one" }] }), /simulated/);
  assert.deepEqual({ rows, links }, before, "failed link rolls back both row write and link deletions");
  failLink = false;
  const cleared = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { takeoff: [] });
  assert.equal(cleared.item.quantity, 0); assert.equal(links.length, 0);
  const batch = await store.batchWorksheetItemMutations("project", [
    { op: "create", worksheetId: "worksheet", item: { ...input, entityName: "Batch pipe" } },
  ] as any);
  assert.equal(batch.results[0].item!.quantity, 20);
  const beforeBatch = structuredClone({ rows, links });
  await assert.rejects(store.batchWorksheetItemMutations("project", [
    { op: "create", worksheetId: "worksheet", item: { ...input, entityName: "Should roll back" } },
    { op: "create", worksheetId: "worksheet", item: { ...input, takeoff: [{ pickupId: "foreign" }] } },
  ] as any), /Batch rolled back/);
  assert.deepEqual({ rows, links }, beforeBatch, "invalid pickup rolls back earlier rows in the batch");
  assert.ok(transactions > 10);
});

test("create retry identity is independent of object key order", () => {
  assert.equal(takeoffRowId("p", "w", { uom: "ft", takeoff: [{ pickupId: "a", multiplier: 2 }] }), takeoffRowId("p", "w", { takeoff: [{ multiplier: 2, pickupId: "a" }], uom: "ft" }));
});


test("row link summaries are bounded for large BIM rows", () => {
  const links = Array.from({ length: 4000 }, (_, index) => ({ pickupId: `p${index}`, derivedQuantity: 2 }));
  assert.deepEqual(rowTakeoffSummary(links, "ft"), { count: 4000, sum: 8000, unit: "ft", pickupIds: ["p0", "p1", "p2", "p3", "p4"] });
});

test("UI createPickupLink recognizes square and cubic yard dimensions", async t => {
  let unit = "SY", annotationType = "linear";
  const db: any = {
    project: { findFirst: async () => ({ id: "project" }) },
    pickup: { findFirst: async () => ({ id: "pickup", annotationType, measurement: { value: 2, unit } }) },
    worksheetItem: { findFirst: async () => ({ id: "row", uom: unit, worksheetId: "worksheet" }) },
    pickupLink: { create: async ({ data }: any) => data },
  };
  const store = new PrismaApiStore(db, "org");
  t.mock.method(store as any, "findCurrentRevision", async () => ({ revision: null }));
  t.mock.method(store as any, "recalcLinkedItemQuantity", async () => {});
  const input = { pickupId: "pickup", worksheetItemId: "row" };
  await assert.rejects(store.createPickupLink("project", input), /length quantity.*area/);
  annotationType = "area";
  assert.equal((await store.createPickupLink("project", input)).derivedQuantity, 2);
  unit = "CY";
  await assert.rejects(store.createPickupLink("project", input), /area quantity.*volume/);
  annotationType = "volume";
  assert.equal((await store.createPickupLink("project", input)).derivedQuantity, 2);
});

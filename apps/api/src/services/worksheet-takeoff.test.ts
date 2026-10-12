import assert from "node:assert/strict";
import test from "node:test";
import { PrismaApiStore } from "../prisma-store.js";
import { takeoffRowId } from "./worksheet-takeoff.js";

// No live database: exercise the store's transaction, integrity, link replacement
// and existing recalc path. The ordinary row-write fixture only persists a row.
test("takeoff row writes sum, replace, retry, and roll back atomically", async t => {
  let rows: any[] = [], links: any[] = [];
  let transactions = 0, failLink = false;
  const pickups = [
    { id: "one", projectId: "project", label: "Run A", annotationType: "linear", measurement: { value: 12, unit: "ft" } },
    { id: "two", projectId: "project", label: "Run B", annotationType: "linear", measurement: { value: 8, unit: "ft" } },
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
  assert.equal(created.item.takeoff?.length, 2);
  assert.match(created.item.takeoffFact!, /20 LF replaces supplied quantity 99/);
  assert.equal(links.reduce((sum, link) => sum + link.derivedQuantity, 0), 20);
  const retried = await store.createWorksheetItemWithSnapshot("project", "worksheet", input);
  assert.equal(retried.item.id, created.item.id);
  assert.equal(rows.length, 1); assert.equal(links.length, 2);

  const replaced = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { takeoff: [{ pickupId: "two", multiplier: 2 }] });
  assert.equal(replaced.item.quantity, 16); assert.equal(links.length, 1);
  await store.updateWorksheetItemWithSnapshot("project", created.item.id, { takeoff: [{ pickupId: "two", multiplier: 2 }] });
  assert.equal(links.length, 1);
  const preserved = await store.updateWorksheetItemWithSnapshot("project", created.item.id, { quantity: 100 });
  assert.equal(preserved.item.quantity, 16, "omitting takeoff preserves links and their quantity");
  assert.match(preserved.item.takeoffFact!, /replaces supplied quantity 100/);

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
  await assert.rejects(store.updateWorksheetItemWithSnapshot("project", created.item.id, { uom: "m" }), /explicit conversion multipliers/);
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

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateLineItem } from "../calc-utils.js";
import { PrismaApiStore } from "../prisma-store.js";

// Scrubbed five duration rows and authored rates from the round-9 tool calls.
const fixtures = JSON.parse(await readFile(new URL("./fixtures/round9-equipment-rates.json", import.meta.url), "utf8"));

test("authoring quote equipment costs refreshes all five saved rows through the real calculator", async t => {
  const rows = fixtures.map((f: any, i: number) => ({ id: `row-${i}`, worksheetId: "worksheet", entityName: f.label,
    entityType: "Equipment", entityCategory: { calculationType: "duration_rate" }, category: "Equipment", quantity: f.quantity,
    uom: f.uom, tierUnits: f.tierUnits, rateScheduleItemId: `rate-${i}`, cost: 0, price: f.expectedCost, markup: 0,
    createdAt: new Date(), updatedAt: new Date() }));
  const schedule: any = { id: "book", scope: "revision", projectId: "project", revisionId: "revision", name: "Equipment", category: "Equipment",
    tiers: fixtures[0].tiers, metadata: {}, items: fixtures.map((f: any, i: number) => ({ id: `rate-${i}`, scheduleId: "book", name: f.label, code: "",
      unit: f.uom, catalogItem: { unitCost: 0 }, rates: f.rates, costRates: {}, metadata: {} })) };
  const writes: any[] = [];
  const db: any = {
    quoteRevision: { findFirst: async () => ({ id: "revision", quoteId: "quote", createdAt: new Date(), updatedAt: new Date() }) },
    quote: { findFirst: async () => ({ projectId: "project" }) },
    worksheet: { findMany: async () => [{ id: "worksheet" }] },
    worksheetItem: { findMany: async () => rows, update: async ({ where, data }: any) => {
      Object.assign(rows.find((r: any) => r.id === where.id)!, data); writes.push({ id: where.id, ...data });
    } },
    rateSchedule: { findFirst: async () => schedule, findMany: async () => [schedule] },
    rateScheduleItem: { findFirst: async ({ where }: any) => schedule.items.find((x: any) => x.id === where.id),
      update: async ({ where, data }: any) => Object.assign(schedule.items.find((x: any) => x.id === where.id), data) },
  };
  const proto = PrismaApiStore.prototype as any;
  t.mock.method(proto, "getOrganizationDefaults", async () => ({ currency: "CAD" }));
  t.mock.method(proto, "refreshRateScheduleSearchDocuments", async () => {});
  t.mock.method(proto, "syncProjectEstimate", async () => ({}));
  t.mock.method(proto, "pushActivity", async () => {});
  t.mock.method(proto, "getRateSchedule", async () => schedule);
  const store = new PrismaApiStore(db, "org");
  for (let i = 0; i < fixtures.length; i++) {
    await store.updateRateScheduleItem(`rate-${i}`, { costRates: fixtures[i].costRates, metadata: { costProvenance: { type: "estimator_allowance", currency: "CAD" } } });
    assert.equal(schedule.items[i].metadata.costRatesAuthored, true);
    assert.equal(rows[i].cost, fixtures[i].expectedCost);
    assert.equal(rows[i].price, fixtures[i].expectedCost, "authoring cost does not change sell");
    const saved = writes.filter(w => w.id === rows[i].id).at(-1);
    assert.equal(saved.rateResolution.totalCost, fixtures[i].expectedCost);
    assert.equal(saved.costSnapshot.currency, "CAD", "inherited currency survives the calculation adapter");
    assert.equal(saved.rateResolution.components.find((c: any) => c.target === "cost").metadata.basis, "authored cost rate");
  }
  assert.equal(rows.reduce((sum: number, r: any) => sum + r.cost * r.quantity, 0), 5130);
});

test("calculation adapter retains library scope; legacy costs remain catalog-derived", () => {
  const f = fixtures[0];
  const item: any = { id: "row", quantity: 1, uom: f.uom, tierUnits: f.tierUnits, rateScheduleItemId: "rate" };
  const rates: any = { id: "book", scope: "global", sourceCurrency: "EUR", tiers: f.tiers, items: [{ id: "rate", name: "Resource", code: "", catalogUnitCost: 10, rates: f.rates, costRates: f.costRates, metadata: f.metadata }] };
  const result = calculateLineItem(item, { id: "revision" } as any, "duration_rate", [rates]);
  assert.notEqual(result.cost, f.expectedCost);
  assert.equal(result.rateResolution?.currency, "EUR");
  assert.equal(result.rateResolution?.components.find(c => c.target === "cost")?.metadata?.basis, "catalog unit cost");
});

import assert from "node:assert/strict";
import test from "node:test";
import { PrismaApiStore } from "../prisma-store.js";

test("rate import inherits explicit currency and drops legacy global costs for any category", async t => {
  const proto = PrismaApiStore.prototype as any;
  t.mock.method(proto, "requireProject", async () => {});
  t.mock.method(proto, "findCurrentRevision", async () => ({ revision: { id: "revision" } }));
  t.mock.method(proto, "getOrganizationDefaults", async () => ({ currency: "CAD" }));
  t.mock.method(proto, "repriceRevisionRateScheduleLines", async () => 0);
  t.mock.method(proto, "syncProjectEstimate", async () => ({}));
  for (const [category, currency, expected] of [["Electrical labour", "USD", "USD"], ["Finishes access", null, "CAD"]]) {
    const source: any = { id: "source", name: category, category, metadata: { currency }, tiers: [{ id: "old", name: "Usage", multiplier: 1, uom: "DAY" }], items: [{ id: "item", name: "Resource", rates: { old: 130 }, costRates: { old: 100 }, metadata: { costProvenance: { basis: "supplier quote" } } }] };
    const imported: any = { tiers: [], items: [], createdAt: new Date(), updatedAt: new Date() };
    const tx: any = { rateSchedule: { create: async ({data}: any) => Object.assign(imported, data), findFirst: async () => imported }, rateScheduleTier: { create: async ({data}: any) => imported.tiers.push(data) }, rateScheduleItem: { create: async ({data}: any) => imported.items.push(data) } };
    const db: any = { rateSchedule: { findFirst: async ({where}: any) => where.id === "source" ? source : null }, $transaction: async (run: any) => run(tx) };
    const result = await new PrismaApiStore(db, "org").importRateScheduleToRevision("project", "source");
    assert.equal(result.metadata.currency, expected);
    const tierId = result.tiers[0].id;
    assert.equal(result.items[0].rates[tierId], 130);
    assert.deepEqual(result.items[0].costRates, {});
    assert.deepEqual(result.items[0].metadata.costProvenance, { basis: "supplier quote" });
    assert.deepEqual(source.items[0].costRates, { old: 100 }, "source rate book is unchanged");
  }
});

test("REST create and update lock costs on both library and imported rate books", async () => {
  for (const scope of ["global", "revision"]) {
    const db: any = { rateSchedule: { findFirst: async () => ({ id: "rates", scope }) },
      rateScheduleItem: { findFirst: async () => ({ id: "resource", scheduleId: "rates" }), update: async () => assert.fail("cost rates must not be written") } };
    const store = new PrismaApiStore(db, "org");
    await assert.rejects(store.createRateScheduleItem("rates", { catalogItemId: "catalog", costRates: { day: 100 } }), /costs come from the catalog/);
    await assert.rejects(store.updateRateScheduleItem("resource", { costRates: { day: 100 } }), scope === "revision" ? /only modify sell rates/ : /costs come from the catalog/);
  }
});

test("rate maps reject invalid math before writes", async t => {
  const db: any = { rateScheduleItem: { findFirst: async () => ({ id: "resource", scheduleId: "rates" }), update: async () => assert.fail("invalid rates must not be written") }, rateSchedule: { findFirst: async () => ({ id: "rates", scope: "revision" }) } };
  for (const value of [-1, Infinity, NaN]) {
    await assert.rejects(new PrismaApiStore(db, "org").updateRateScheduleItem("resource", { rates: { day: value } }), /finite, nonnegative/);
  }
});

test("reading a legacy book resolves explicit org currency without changing metadata", async t => {
  t.mock.method(PrismaApiStore.prototype, "getOrganizationDefaults", async () => ({ currency: "CAD" }) as any);
  const book = { id: "rates", metadata: {}, createdAt: new Date(), updatedAt: new Date(), items: [], tiers: [] };
  const store = new PrismaApiStore({ rateSchedule: { findFirst: async () => book, findMany: async () => [book] } } as any, "org");
  assert.equal((await store.getRateSchedule("rates")).sourceCurrency, "CAD");
  assert.equal((await store.listRateSchedules())[0].sourceCurrency, "CAD");
  assert.deepEqual(book.metadata, {}, "read-time inheritance does not backfill");
});

test("resolution comparison ignores JSONB key order and timestamp, but detects meaningful changes", async () => {
  const { sameRateResolution, DEFAULT_SETTINGS } = await import("../store/mappers.js");
  assert.equal(DEFAULT_SETTINGS.defaults.currency, null);
  const saved = { source: "rate_book", currency: "CAD", resolvedAt: "old", quantity: 2, tierUnits: { a: 1, b: 2 }, components: [{ amount: 30, metadata: { x: 1, y: 2 } }] };
  const fresh = { components: [{ metadata: { y: 2, x: 1 }, amount: 30 }], tierUnits: { b: 2, a: 1 }, quantity: 2, resolvedAt: "new", currency: "CAD", source: "rate_book" };
  assert.equal(sameRateResolution(saved, fresh), true);
  assert.equal(sameRateResolution(saved, { ...fresh, currency: "USD" }), false);
  assert.equal(sameRateResolution(saved, { ...fresh, tierUnits: { a: 1, b: 3 } }), false);
});

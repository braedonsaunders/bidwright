import assert from "node:assert/strict";
import test from "node:test";
import { PrismaApiStore } from "../prisma-store.js";

test("rate import inherits explicit currency and preserves cost and sell tiers for any category", async t => {
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
    assert.equal(result.items[0].costRates[tierId], 100);
    assert.deepEqual(result.items[0].metadata.costProvenance, { basis: "supplier quote" });
    assert.deepEqual(source.items[0].costRates, { old: 100 }, "source rate book is unchanged");
  }
});

test("an imported quote rate item accepts separate authored cost and sell without altering its category", async t => {
  const proto = PrismaApiStore.prototype as any;
  t.mock.method(proto, "repriceRevisionRateScheduleLines", async () => 0);
  t.mock.method(proto, "syncProjectEstimate", async () => ({}));
  t.mock.method(proto, "getRateSchedule", async () => ({}));
  t.mock.method(proto, "pushActivity", async () => {});
  let written: any;
  const db: any = { rateScheduleItem: { findFirst: async () => ({ id: "resource", scheduleId: "rates" }), update: async ({data}: any) => { written = data; } }, rateSchedule: { findFirst: async () => ({ id: "rates", scope: "revision", projectId: "project", revisionId: "revision", category: "Rental Equipment" }) } };
  await new PrismaApiStore(db, "org").updateRateScheduleItem("resource", { rates: { day: 130 }, costRates: { day: 100 }, metadata: { costProvenance: { basis: "quoted" }, sellProvenance: { basis: "authored" } } });
  assert.deepEqual(written.costRates, { day: 100 }); assert.deepEqual(written.rates, { day: 130 });
  assert.equal(written.category, undefined);
});

test("rate maps reject invalid math before writes", async t => {
  const db: any = { rateScheduleItem: { findFirst: async () => ({ id: "resource", scheduleId: "rates" }), update: async () => assert.fail("invalid rates must not be written") }, rateSchedule: { findFirst: async () => ({ id: "rates", scope: "revision" }) } };
  for (const value of [-1, Infinity, NaN]) {
    await assert.rejects(new PrismaApiStore(db, "org").updateRateScheduleItem("resource", { costRates: { day: value } }), /finite, nonnegative/);
  }
});

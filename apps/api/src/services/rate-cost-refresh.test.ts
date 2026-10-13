import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateLineItem } from "../calc-utils.js";
import { summarizePricingIntegrity, validateEstimateWorkspace } from "@bidwright/domain";

// Scrubbed duration rows from round 9. Its cost-authoring attempt was incorrect:
// these internal rate-book rentals are sell-only, even with obsolete saved cost maps.
const fixtures = JSON.parse(await readFile(new URL("./fixtures/round9-equipment-rates.json", import.meta.url), "utf8"));

test("five internal rentals retain pre-147 sell totals with zero cost and no cost warnings", () => {
  let totalSell = 0;
  for (const f of fixtures) {
    const row: any = { id: "row", entityName: f.label, category: "Equipment", quantity: f.quantity, uom: f.uom, tierUnits: f.tierUnits, rateScheduleItemId: "rate" };
    const book: any = { id: "book", scope: "revision", sourceCurrency: "CAD", tiers: f.tiers,
      items: [{ id: "rate", name: f.label, rates: f.rates, costRates: f.costRates, metadata: f.metadata }] };
    const result = calculateLineItem(row, { id: "revision" } as any, "duration_rate", [book]);
    assert.equal(result.cost, 0);
    assert.equal(result.price, f.expectedCost, "the recorded rate is the sell rate");
    assert.equal(result.rateResolution?.currency, "CAD");
    assert.deepEqual(result.rateResolution?.warnings, []);
    const workspace = { quoteCurrency: "CAD", rateSchedules: [book], worksheets: [{ items: [{ ...row, ...result }] }] };
    assert.equal("costUnknown" in summarizePricingIntegrity(workspace), false);
    assert.equal(validateEstimateWorkspace(workspace).issues.some(i => i.ruleId === "worksheet.pricing.zero_cost_or_price"), false);
    assert.ok(result.price !== undefined);
    totalSell += result.price;
  }
  assert.equal(totalSell, 5130);
});

test("catalog cost still prices identically to the pre-147 calculation", () => {
  const f = fixtures[0];
  const row: any = { id: "row", quantity: 1, uom: "MO", tierUnits: f.tierUnits, rateScheduleItemId: "rate" };
  const book: any = { id: "book", scope: "revision", sourceCurrency: "EUR", tiers: f.tiers,
    items: [{ id: "rate", name: "Resource", catalogUnitCost: 10, rates: f.rates, costRates: f.costRates, metadata: f.metadata }] };
  const result = calculateLineItem(row, { id: "revision" } as any, "duration_rate", [book]);
  assert.equal(result.cost, 240, "catalog 10 × monthly multiplier 12 × 2 months");
  assert.equal(result.price, 2280);
  assert.equal(result.rateResolution?.currency, "EUR");
});

test("saved snapshots omit obsolete rate-book cost warnings without hiding missing sell rates", async () => {
  const { mapWorksheetItem } = await import("../store/mappers.js");
  const warnings = ["Missing catalog item cost for Resource.", "Missing explicit rate or catalog item cost for Resource.", "Missing sell rate for Weekly."];
  const raw = { id: "row", rateResolution: { source: "rate_book", warnings } };
  assert.deepEqual(mapWorksheetItem(raw).rateResolution?.warnings, ["Missing sell rate for Weekly."]);
  assert.equal(raw.rateResolution.warnings.length, 3, "reading does not rewrite the stored snapshot");
  assert.deepEqual(mapWorksheetItem({ ...raw, rateResolution: { source: "manual", warnings } }).rateResolution?.warnings, warnings);
});

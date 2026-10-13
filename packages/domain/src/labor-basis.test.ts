import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summarizeLaborBasis } from "./labor-basis";
import { lineDerivationExpectedValue, normalizeLineDerivation, validateLineDerivation } from "./line-derivation";

const operations = JSON.parse(readFileSync(new URL("./__fixtures__/labor-per-unit-batch.json", import.meta.url), "utf8"));
const workspace = (items: any[]) => ({ worksheets: [{ items }],
  entityCategories: [{ id: "cat", name: "Labour", entityType: "Labour", analyticsBucket: "labour", calculationType: "tiered_rate" }],
  rateSchedules: [{ items: [{ id: "rate" }], tiers: [{ id: "regular", name: "Regular", uom: "HR" }] }] });

test("five real per-unit traces preserve source classification: two adjusted and three sourced", () => {
  const items = operations.map((op: any, i: number) => ({ ...op.item, id: `row-${i}`, entityType: "Labour" }));
  const basis = summarizeLaborBasis(workspace(items));
  assert.equal(basis.adjustedHours, 100.36);
  assert.equal(basis.sourcedHours, 83.2);
  assert.equal(basis.assumedHours, 0);
  assert.equal(basis.adjustedRowCount, 2);
  for (const row of basis.topAdjustedRows) assert.ok(Math.abs(row.factor - 1.25) < 1e-10);
  for (const item of items) {
    assert.deepEqual(validateLineDerivation(normalizeLineDerivation(item.derivation), { expectedValue: lineDerivationExpectedValue("tierUnits", item) }).filter(issue => issue.severity === "error"), []);
  }
});

test("joint-count × cited baseline × factor traces work for total-hours and per-unit rows", () => {
  const item = structuredClone(operations[0].item);
  item.id = "row"; item.entityType = "Labour";
  const extended = 72 * 1.24191125;
  item.quantity = 1; item.uom = "HR"; item.tierUnits.regular = extended;
  item.derivation.formula = "joints * baseline * factor";
  item.derivation.inputs.unshift({ name: "joints", value: 72, unit: "WELD", source: { kind: "manual", ref: "joint-count" } });
  item.derivation.result = { value: extended, unit: "HR" };
  assert.equal(summarizeLaborBasis(workspace([item])).adjustedHours, 89.42);
  assert.equal(summarizeLaborBasis(workspace([item])).topAdjustedRows[0].factor, 1.25);
  item.derivation.target = "quantity"; item.quantity = extended; item.tierUnits.regular = 1;
  assert.equal(summarizeLaborBasis(workspace([item])).adjustedHours, 89.42);
  item.derivation.inputs.find((input: any) => input.name === "factor").value = 1;
  item.quantity = 72 * .993529; item.derivation.result.value = item.quantity;
  assert.equal(summarizeLaborBasis(workspace([item])).sourcedHours, 71.53);
  item.derivation.result.value = 12;
  assert.equal(summarizeLaborBasis(workspace([item])).assumedHours, 71.53);
});

test("tier target sums tiers per unit and never accepts the extended amount as that target", () => {
  const item = structuredClone(operations[0].item);
  assert.equal(lineDerivationExpectedValue("tierUnits", { quantity: 72, tierUnits: { regular: 1, overtime: .24191125 } }), 1.24191125);
  assert.equal(lineDerivationExpectedValue("quantity", item), 72);
  item.derivation.result.value *= 72;
  item.derivation.formula = "baseline * factor * 72";
  assert.ok(validateLineDerivation(normalizeLineDerivation(item.derivation), { expectedValue: lineDerivationExpectedValue("tierUnits", item) }).some(issue => issue.code === "result_target_mismatch"));
});

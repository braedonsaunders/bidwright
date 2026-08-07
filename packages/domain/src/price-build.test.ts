import assert from "node:assert/strict";
import test from "node:test";

import { buildPriceBuildView, scalePriceBuildAmount } from "./price-build";

const adjustment = (over: Partial<Parameters<typeof buildPriceBuildView>[0]["adjustments"][number]> & { value: number }) => ({
  active: true,
  show: "Yes",
  affectsSubtotal: true,
  ...over,
});

test("a hidden adjustment is absorbed into the rollup so the rows reconcile with the price", () => {
  const view = buildPriceBuildView({
    rowsSubtotal: 100_000,
    grandTotal: 112_000,
    adjustments: [
      adjustment({ value: 10_000 }),                    // shown
      adjustment({ value: 2_000, show: "No" }),         // hidden fuel surcharge
    ],
  });

  assert.equal(view.visibleAdjustments.length, 1, "only the shown adjustment is itemized");
  assert.equal(view.hiddenAdjustmentTotal, 2_000);
  assert.equal(view.rollupAmount, 102_000, "the hidden surcharge lands inside the rollup");
  assert.equal(view.total, 112_000);
  // The printed arithmetic must hold: rollup + shown adjustments = price.
  assert.equal(view.rollupAmount + view.visibleAdjustments[0].value, view.total);
  assert.ok(view.showRollup);

  // Row amounts scale so the rollup's own lines still sum to it.
  assert.equal(scalePriceBuildAmount(50_000, view.rowScale), 51_000);
  assert.equal(scalePriceBuildAmount(50_000, view.rowScale) * 2, view.rollupAmount);
});

test("with no visible adjustments the rollup equals the price and is not printed twice", () => {
  const view = buildPriceBuildView({
    rowsSubtotal: 100_000,
    grandTotal: 102_000,
    adjustments: [adjustment({ value: 2_000, show: "No" })],
  });

  assert.equal(view.visibleAdjustments.length, 0);
  assert.equal(view.rollupAmount, view.total, "nothing left to show between rollup and total");
  assert.equal(view.showRollup, false, "print a single total row instead");
});

test("a quote with no adjustments at all shows one total", () => {
  const view = buildPriceBuildView({ rowsSubtotal: 80_000, grandTotal: 80_000, adjustments: [] });
  assert.equal(view.showRollup, false);
  assert.equal(view.rollupAmount, 80_000);
  assert.equal(view.rowScale, 1);
  assert.equal(scalePriceBuildAmount(1_234.567, view.rowScale), 1_234.57);
});

test("inactive and non-subtotal adjustments never itemize or shift the rollup", () => {
  const view = buildPriceBuildView({
    rowsSubtotal: 50_000,
    grandTotal: 50_000,
    adjustments: [
      adjustment({ value: 5_000, active: false }),
      adjustment({ value: 7_000, affectsSubtotal: false }),
    ],
  });
  assert.equal(view.visibleAdjustments.length, 0);
  assert.equal(view.rollupAmount, 50_000);
  assert.equal(view.hiddenAdjustmentTotal, 0);
  assert.equal(view.showRollup, false);
});

test("a zero line subtotal cannot be scaled and leaves amounts untouched", () => {
  const view = buildPriceBuildView({
    rowsSubtotal: 0,
    grandTotal: 1_500,
    adjustments: [adjustment({ value: 1_500, show: "No" })],
  });
  assert.equal(view.rowScale, 1, "no basis to prorate against");
  assert.equal(view.rollupAmount, 1_500);
  assert.equal(view.showRollup, false);
});

test("a hidden credit reduces the rollup rather than appearing as a discount line", () => {
  const view = buildPriceBuildView({
    rowsSubtotal: 100_000,
    grandTotal: 95_000,
    adjustments: [adjustment({ value: -5_000, show: "No" })],
  });
  assert.equal(view.rollupAmount, 95_000);
  assert.equal(view.hiddenAdjustmentTotal, -5_000);
  assert.equal(scalePriceBuildAmount(20_000, view.rowScale), 19_000);
});

test("a modifier already priced into the rows is neither itemized nor added again", () => {
  // Real shape from a quote carrying a hidden Labour fuel surcharge applied as
  // a line-item modifier: the dimension rows already total the grand total.
  const view = buildPriceBuildView({
    rowsSubtotal: 171_351.04,
    grandTotal: 171_351.04,
    adjustments: [{ value: 4_876.76, active: true, show: "No", affectsSubtotal: false }],
  });
  assert.equal(view.visibleAdjustments.length, 0);
  assert.equal(view.rollupAmount, 171_351.04);
  assert.equal(view.rowScale, 1, "rows already include it — never scale them again");
  assert.equal(view.hiddenAdjustmentTotal, 0);
  assert.equal(view.showRollup, false);
});

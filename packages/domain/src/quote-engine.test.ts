import test from "node:test";
import assert from "node:assert/strict";

import { calculateTotals, computeItemCost } from "./quote-engine";
import { mockStore } from "./mock-data";
import type { WorksheetItem } from "./models";

const baseItem: WorksheetItem = {
  id: "li-test",
  worksheetId: "ws-test",
  category: "Material",
  entityType: "Material",
  entityName: "test",
  description: "",
  quantity: 1,
  uom: "EA",
  cost: 0,
  markup: 0,
  price: 0,
  lineOrder: 0,
};

/* ─── Storage convention ──────────────────────────────────────────────────
 * `WorksheetItem.cost` is always per-unit (see the calc-engine docblock).
 * The line's extended cost is qty × cost for every category, regardless of
 * what an org chooses to call its categories — these tests lock that contract
 * for project rollups.
 */

test("computeItemCost: Material with qty=3 cost=50 returns 150", () => {
  assert.equal(
    computeItemCost({ ...baseItem, category: "Material", quantity: 3, cost: 50 }),
    150,
  );
});

test("computeItemCost: Labour with qty=2 cost=332.25 returns 664.50", () => {
  // Per-unit Labour cost 332.25 with qty 2 must roll up to 664.50.
  assert.equal(
    computeItemCost({ ...baseItem, category: "Labour", entityType: "Labour", quantity: 2, cost: 332.25 }),
    664.5,
  );
});

test("computeItemCost: works for any category name (orgs configure their own)", () => {
  const cases = ["Equipment", "Subcontractor", "Travel & Per Diem", "Rental Equipment", "Consumables", "WidgetMaking", ""];
  for (const category of cases) {
    const ext = computeItemCost({ ...baseItem, category, entityType: category || "Material", quantity: 4, cost: 10 });
    assert.equal(ext, 40, `${category || "(empty)"} should ext-cost qty × cost`);
  }
});

test("computeItemCost: zero quantity returns 0 (does not throw)", () => {
  assert.equal(
    computeItemCost({ ...baseItem, category: "Labour", quantity: 0, cost: 100 }),
    0,
  );
});

test("mock demo project totals use per-unit worksheet costs", () => {
  const revision = mockStore.revisions.find((entry) => entry.id === "rev-0");
  assert.ok(revision);

  const worksheets = mockStore.worksheets
    .filter((worksheet) => worksheet.revisionId === revision.id)
    .map((worksheet) => ({
      ...worksheet,
      items: mockStore.worksheetItems.filter((item) => item.worksheetId === worksheet.id),
    }));
  const phases = mockStore.phases.filter((phase) => phase.revisionId === revision.id);
  const adjustments = mockStore.adjustments.filter((adjustment) => adjustment.revisionId === revision.id);

  const totals = calculateTotals(revision, worksheets, phases, adjustments);

  assert.equal(totals.cost, 969040);
  assert.equal(totals.lineSubtotalBeforeFactors, 1239854);
  assert.equal(totals.subtotal, 1330268.12);
  assert.equal(totals.estimatedProfit, 361228.12);
  assert.equal(totals.estimatedMargin, 0.27);

  const labour = totals.costBreakdown.find((entry) => entry.id === "labour");
  assert.equal(labour?.cost, 229040);
  assert.equal(labour?.value, 330714);
});

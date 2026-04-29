import test from "node:test";
import assert from "node:assert/strict";

import { computeItemCost } from "./quote-engine";
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
  unit1: 0,
  unit2: 0,
  unit3: 0,
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

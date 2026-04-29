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
 * The line's extended cost is qty × cost for every category. There used to
 * be a `directCostCategories` set that special-cased Material / Subcontractor
 * etc., because Labour/Equipment used to store cost as a line total. After
 * the calc-engine fix, all categories share the per-unit convention and the
 * special case is gone — these tests lock that contract for project rollups.
 */

test("computeItemCost: Material with qty=3 cost=50 returns 150", () => {
  assert.equal(
    computeItemCost({ ...baseItem, category: "Material", quantity: 3, cost: 50 }),
    150,
  );
});

test("computeItemCost: Labour with qty=2 cost=332.25 returns 664.50 (the bug-row case)", () => {
  // The user's bug: per-unit Labour cost 332.25 with qty 2 must roll up to 664.50,
  // not 332.25 (which is what the legacy directCostCategories branch produced).
  assert.equal(
    computeItemCost({ ...baseItem, category: "Labour", entityType: "Labour", quantity: 2, cost: 332.25 }),
    664.5,
  );
});

test("computeItemCost: Equipment, Subcontractor, Travel & Per Diem all use qty × cost", () => {
  const cases: Array<{ category: string; entityType?: string }> = [
    { category: "Equipment", entityType: "Equipment" },
    { category: "Subcontractor", entityType: "Subcontractor" },
    { category: "Subcontractors" }, // legacy plural form
    { category: "Travel & Per Diem", entityType: "Travel" },
    { category: "Rental Equipment", entityType: "RentalEquipment" },
    { category: "Consumables", entityType: "Consumable" },
  ];
  for (const c of cases) {
    const ext = computeItemCost({ ...baseItem, category: c.category, entityType: c.entityType ?? c.category, quantity: 4, cost: 10 });
    assert.equal(ext, 40, `${c.category} should ext-cost qty × cost`);
  }
});

test("computeItemCost: zero quantity returns 0 (does not throw)", () => {
  assert.equal(
    computeItemCost({ ...baseItem, category: "Labour", quantity: 0, cost: 100 }),
    0,
  );
});

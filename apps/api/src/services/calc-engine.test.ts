/**
 * Calc-engine invariants.
 *
 * Locks the storage convention documented in calc-engine.ts: `cost` is always
 * per-unit, `price` is always the line total. The UI is allowed to compute
 * `extCost = cost × quantity` for every category and arrive at the true line
 * cost; tests below enforce that across each calculation strategy.
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { EntityCategory, WorksheetItem } from "@bidwright/domain";
import { calculateItem, type CalcContext, type RateScheduleContext } from "./calc-engine";

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

const baseCategory: EntityCategory = {
  id: "ec-test",
  name: "Material",
  entityType: "Material",
  shortform: "M",
  defaultUom: "EA",
  validUoms: ["EA"],
  editableFields: { quantity: true, cost: true, markup: true, price: true, unit1: false, unit2: false, unit3: false },
  unitLabels: { unit1: "", unit2: "", unit3: "" },
  calculationType: "manual",
  calcFormula: "",
  itemSource: "freeform",
  catalogId: null,
  color: "#22c55e",
  order: 1,
  isBuiltIn: true,
  enabled: true,
};

const labourCategory: EntityCategory = {
  ...baseCategory,
  id: "ec-labour",
  name: "Labour",
  entityType: "Labour",
  shortform: "L",
  defaultUom: "HR",
  validUoms: ["HR"],
  calculationType: "tiered_rate",
  itemSource: "rate_schedule",
  editableFields: { quantity: true, cost: false, markup: false, price: false, unit1: true, unit2: true, unit3: true },
};

/* ─── manual / unit_markup / quantity_markup ──────────────────────────── */

test("manual: per-unit cost convention — extCost = cost × qty matches qty × unit", () => {
  const result = calculateItem(
    { ...baseItem, quantity: 4, cost: 25, markup: 0.2 },
    baseCategory,
  );
  // Engine doesn't touch cost in manual; user input survives.
  assert.equal(result.price, 4 * 25 * 1.2);
  // Caller-side invariant: extCost = cost × qty.
  const cost = 25; // unchanged
  const extCost = cost * 4;
  assert.equal(extCost, 100);
  assert.equal((result.price! - extCost) / extCost, 0.2);
});

test("unit_markup: identical to manual (price = qty × cost × (1 + markup))", () => {
  const result = calculateItem(
    { ...baseItem, quantity: 3, cost: 10, markup: 0.5 },
    { ...baseCategory, calculationType: "unit_markup" },
  );
  assert.equal(result.price, 45);
});

/* ─── tiered_rate (Labour) ────────────────────────────────────────────── */

const labourRateSchedule: RateScheduleContext = {
  id: "rs-test",
  category: "labour",
  tiers: [
    { id: "tier-reg", name: "Regular", multiplier: 1, sortOrder: 0 },
    { id: "tier-ot", name: "Overtime", multiplier: 1.5, sortOrder: 1 },
    { id: "tier-dt", name: "Double Time", multiplier: 2, sortOrder: 2 },
  ],
  items: [
    {
      id: "rsi-test",
      name: "MECH:Trade Labour",
      code: "TL",
      rates: { "tier-reg": 100, "tier-ot": 150, "tier-dt": 200 },
      costRates: { "tier-reg": 50, "tier-ot": 75, "tier-dt": 100 },
      burden: 0,
      perDiem: 0,
    },
  ],
};

test("tiered_rate: cost is stored per-unit so UI extCost = cost × qty matches the line total", () => {
  // 1h Reg @ 100, 1h OT @ 150, 2h DT @ 200 = 650 total per unit.
  // Cost per unit: 1×50 + 1×75 + 2×100 = 325.
  const item: WorksheetItem = {
    ...baseItem,
    category: "Labour",
    entityType: "Labour",
    entityName: "MECH:Trade Labour",
    rateScheduleItemId: "rsi-test",
    quantity: 2,
    cost: 0,
    markup: 0.99, // user noise — engine should overwrite
    price: 0,
    tierUnits: { "tier-reg": 1, "tier-ot": 1, "tier-dt": 2 },
  };
  const ctx: CalcContext = { rateSchedules: [labourRateSchedule] };

  const result = calculateItem(item, labourCategory, ctx);

  // price = qty × Σ(rates × tierUnits) = 2 × 650 = 1300
  assert.equal(result.price, 1300);
  // cost is per-unit (engine divided totalCost / qty)
  assert.equal(result.cost, 325);
  // extCost (UI computation) = cost × qty = 650; line total cost.
  const extCost = result.cost! * item.quantity;
  assert.equal(extCost, 650);
  // Critical invariant: ext cost must not exceed price under positive markup.
  assert.ok(result.price! >= extCost, "price must cover ext cost");
  // Markup is engine-derived (user's 0.99 ignored), reflects (price - extCost) / extCost.
  assert.equal(result.markup, 1); // (1300 - 650) / 650 = 1.0
});

test("tiered_rate with 46% MECH burden: burden is applied to total cost before per-unit storage", () => {
  // tierUnits = {Reg:1, OT:1, DT:2}; cost rates (per labourCost) = {50, 75, 100}.
  // Raw per-unit cost: 1×50 + 1×75 + 2×100 = 325.
  // With 46% burden: 325 × 1.46 = 474.5 per-unit.
  // qty=2 → line total cost (with burden) = 949, stored per-unit = 474.5.
  const item: WorksheetItem = {
    ...baseItem,
    category: "Labour",
    entityType: "Labour",
    entityName: "MECH:Trade Labour",
    rateScheduleItemId: "rsi-test",
    quantity: 2,
    tierUnits: { "tier-reg": 1, "tier-ot": 1, "tier-dt": 2 },
  };
  const ctx: CalcContext = {
    rateSchedules: [labourRateSchedule],
    labourCost: {
      entries: [
        { code: "TL", name: "MECH:Trade Labour", group: "MECH", costRates: { regular: 50, overtime: 75, doubletime: 100 } },
      ],
      burdenPeriods: [
        { group: "MECH", percentage: 0.46, startDate: "2026-01-01", endDate: "2026-12-31" },
      ],
      referenceDate: "2026-04-29",
    },
  };

  const result = calculateItem(item, labourCategory, ctx);

  // price uses rates (not costRates), unaffected by burden.
  assert.equal(result.price, 1300); // qty × Σ(rates × tierUnits)
  // cost includes burden, stored per-unit.
  assert.equal(result.cost, 474.5);
  // UI extCost = 474.5 × 2 = 949; not 1898 (which the old engine would have produced).
  const extCost = result.cost! * item.quantity;
  assert.equal(extCost, 949);
  assert.ok(result.price! > extCost, "price > ext cost under burden");
  // Markup is engine-derived and matches actual margin: (1300 - 949) / 949 ≈ 0.3699.
  assert.equal(result.markup, 0.3699);
});

test("tiered_rate: zero quantity does not divide by zero", () => {
  const item: WorksheetItem = {
    ...baseItem,
    category: "Labour",
    entityType: "Labour",
    entityName: "MECH:Trade Labour",
    rateScheduleItemId: "rsi-test",
    quantity: 0,
    tierUnits: { "tier-reg": 1 },
  };
  const ctx: CalcContext = { rateSchedules: [labourRateSchedule] };
  const result = calculateItem(item, labourCategory, ctx);
  // Should not throw, should produce finite numbers
  assert.equal(Number.isFinite(result.cost ?? 0), true);
  assert.equal(Number.isFinite(result.price ?? 0), true);
});

import test from "node:test";
import assert from "node:assert/strict";

import { resolveRateBookLine } from "./rate-book-pricing";
import type { EntityCategory, WorksheetItem } from "./models";

function worksheetItem(overrides: Partial<WorksheetItem> = {}): WorksheetItem {
  return {
    id: "wi-1",
    worksheetId: "ws-1",
    category: "Mechanical",
    entityType: "mechanical",
    entityName: "Pump",
    description: "",
    quantity: 3,
    uom: "EA",
    cost: 0,
    markup: 0,
    price: 0,
    lineOrder: 1,
    ...overrides,
  };
}

const category: EntityCategory = {
  id: "cat-mech",
  name: "Mechanical",
  entityType: "mechanical",
  shortform: "MECH",
  defaultUom: "EA",
  validUoms: ["EA"],
  editableFields: { quantity: true, cost: true, markup: true, price: true },
  unitLabels: {},
  calculationType: "quantity_markup",
  calcFormula: "",
  itemSource: "rate_schedule",
  color: "",
  order: 1,
  isBuiltIn: false,
  enabled: true,
};

test("rate book resolves resource cost and sell sides without tier units", () => {
  const resolution = resolveRateBookLine(
    worksheetItem({ costResourceId: "res-pump" }),
    category,
    {
      rateBooks: [{
        id: "rb-1",
        name: "Acme customer rates",
        category: "mechanical",
        metadata: {
          costComponents: [
            { code: "travel", label: "Travel", kind: "travel", target: "cost", basis: "per_line", amount: 25 },
          ],
          pricingComponents: [
            { code: "margin-adder", label: "Margin adder", kind: "markup", target: "price", basis: "per_line", amount: 10 },
          ],
        },
        tiers: [{ id: "tier-ea", name: "Each", multiplier: 1, sortOrder: 1, uom: "EA" }],
        items: [{
          id: "rsi-1",
          resourceId: "res-pump",
          catalogItemId: "ci-pump",
          catalogUnitCost: 90,
          name: "Pump",
          code: "PMP",
          unit: "EA",
          rates: { "tier-ea": 150 },
        }],
      }],
      customerId: "customer-1",
      currency: "CAD",
      resolvedAt: "2026-05-05T12:00:00.000Z",
    },
  );

  assert.ok(resolution);
  assert.equal(resolution.cost, 98.33);
  assert.equal(resolution.price, 460);
  assert.equal(resolution.snapshot.resourceId, "res-pump");
  assert.equal(resolution.snapshot.catalogItemId, "ci-pump");
  assert.equal(resolution.snapshot.totalCost, 295);
  assert.equal(resolution.snapshot.totalPrice, 460);
  assert.deepEqual(resolution.snapshot.tierUnits, { "tier-ea": 1 });
  assert.equal(resolution.snapshot.components.filter((component) => component.target === "cost").length, 2);
  assert.equal(resolution.snapshot.components.filter((component) => component.target === "price").length, 2);
});

test("resource identity wins over name fallback when resolving rate book items", () => {
  const resolution = resolveRateBookLine(
    worksheetItem({ costResourceId: "res-target", entityName: "Shared name", quantity: 1 }),
    category,
    {
      rateBooks: [{
        id: "rb-1",
        name: "Customer resources",
        tiers: [{ id: "tier-ea", name: "Each", multiplier: 1, sortOrder: 1, uom: "EA" }],
        items: [
          {
            id: "rsi-name",
            resourceId: "res-other",
            catalogUnitCost: 999,
            name: "Shared name",
            code: "OTHER",
            unit: "EA",
            rates: { "tier-ea": 999 },
          },
          {
            id: "rsi-resource",
            resourceId: "res-target",
            catalogUnitCost: 20,
            name: "Different display name",
            code: "TARGET",
            unit: "EA",
            rates: { "tier-ea": 25 },
          },
        ],
      }],
    },
  );

  assert.ok(resolution);
  assert.equal(resolution.snapshot.rateBookItemId, "rsi-resource");
  assert.equal(resolution.cost, 20);
  assert.equal(resolution.price, 25);
});

const durationCategory: EntityCategory = {
  ...category,
  id: "cat-equip",
  name: "Equipment",
  entityType: "equipment",
  shortform: "EQ",
  defaultUom: "DAY",
  validUoms: ["DAY", "WK", "EA"],
  calculationType: "duration_rate",
  itemSource: "catalog",
};

function equipmentRateBooks() {
  return [{
    id: "rb-equip",
    name: "Owned equipment rates",
    tiers: [
      { id: "day", name: "Daily", multiplier: 1, sortOrder: 1, uom: "DAY" },
      { id: "week", name: "Weekly", multiplier: 5, sortOrder: 2, uom: "WK" },
      { id: "each", name: "Each", multiplier: 1, sortOrder: 3, uom: "EA" },
    ],
    items: [{
      id: "rsi-exc",
      catalogItemId: "ci-exc",
      catalogUnitCost: 60,
      name: "Excavator",
      code: "EXC",
      unit: "DAY",
      rates: { day: 100, week: 450, each: 80 },
    }],
  }];
}

test("duration line prices by the UoM-matched tier rate x quantity (Bug 4)", () => {
  const day = resolveRateBookLine(
    worksheetItem({ itemId: "ci-exc", entityName: "Excavator", quantity: 4, uom: "DAY", tierUnits: {} }),
    durationCategory,
    { rateBooks: equipmentRateBooks() },
  );
  assert.ok(day);
  assert.equal(day.price, 400); // 100/day x qty 4

  const week = resolveRateBookLine(
    worksheetItem({ itemId: "ci-exc", entityName: "Excavator", quantity: 4, uom: "WK", tierUnits: {} }),
    durationCategory,
    { rateBooks: equipmentRateBooks() },
  );
  assert.ok(week);
  assert.equal(week.price, 1800); // 450/wk x 4 — switching UoM re-prices against the weekly tier
});

test("duration line treats seeded all-zero tier units as one UoM unit so quantity drives price (Bug 5)", () => {
  const each = resolveRateBookLine(
    worksheetItem({ itemId: "ci-exc", entityName: "Excavator", quantity: 3, uom: "EA", tierUnits: { day: 0, week: 0, each: 0 } }),
    durationCategory,
    { rateBooks: equipmentRateBooks() },
  );
  assert.ok(each);
  assert.equal(each.price, 240); // 80/each x 3 — quantity changes price despite seeded-zero tiers
});

test("non-duration line with all-zero tier units still prices at zero (no Labour regression)", () => {
  const resolution = resolveRateBookLine(
    worksheetItem({ costResourceId: "res-pump", quantity: 3, uom: "EA", tierUnits: { "tier-ea": 0 } }),
    category, // quantity_markup, not duration
    {
      rateBooks: [{
        id: "rb-1",
        name: "Acme",
        tiers: [{ id: "tier-ea", name: "Each", multiplier: 1, sortOrder: 1, uom: "EA" }],
        items: [{ id: "rsi-1", resourceId: "res-pump", catalogUnitCost: 90, name: "Pump", code: "PMP", unit: "EA", rates: { "tier-ea": 150 } }],
      }],
    },
  );
  assert.ok(resolution);
  assert.equal(resolution.price, 0); // present-but-zero tiers => no sell, unchanged for tiered/Labour lines
});

test("rate book cost uses generic tier multipliers and schedule-level components", () => {
  const resolution = resolveRateBookLine(
    worksheetItem({
      costResourceId: "res-tech",
      entityName: "Technician",
      quantity: 2,
      tierUnits: { regular: 4, overtime: 3, doubletime: 1 },
      uom: "HR",
    }),
    { ...category, defaultUom: "HR", validUoms: ["HR"] },
    {
      rateBooks: [{
        id: "rb-labour",
        name: "Flexible labour rates",
        metadata: {
          costComponents: [
            { code: "burden", label: "Burden", kind: "burden", target: "cost", basis: "per_tier_unit", amount: 12 },
          ],
        },
        tiers: [
          { id: "regular", name: "Regular", multiplier: 1, sortOrder: 1, uom: "HR" },
          { id: "overtime", name: "Overtime", multiplier: 1.5, sortOrder: 2, uom: "HR" },
          { id: "doubletime", name: "Double Time", multiplier: 2, sortOrder: 3, uom: "HR" },
        ],
        items: [{
          id: "rsi-tech",
          resourceId: "res-tech",
          catalogItemId: "ci-tech",
          catalogUnitCost: 40,
          name: "Technician",
          code: "TECH",
          unit: "HR",
          rates: { regular: 100, overtime: 150, doubletime: 200 },
          metadata: {
            costComponents: [
              { code: "ignored-item-delta", label: "Ignored item delta", kind: "other", target: "cost", basis: "per_tier_unit", amount: 999 },
            ],
          },
          burden: 999,
          perDiem: 999,
        }],
      }],
    },
  );

  assert.ok(resolution);
  assert.equal(resolution.snapshot.baseCost, 840);
  assert.equal(resolution.snapshot.totalCost, 1032);
  assert.equal(resolution.cost, 516);
  assert.equal(resolution.price, 2100);
  assert.deepEqual(
    resolution.snapshot.components
      .filter((component) => component.target === "cost")
      .map((component) => [component.code, component.amount]),
    [
      ["Regular", 320],
      ["Overtime", 360],
      ["Double Time", 160],
      ["burden", 192],
    ],
  );
});

test("electrical and finishes equipment retain separate cost/sell currency and duration rates", () => {
  for (const name of ["Cable puller", "Finishes access lift"]) {
    const equipment = { ...category, name: "Access", entityType: "Access", calculationType: "duration_rate" as const };
    const item = worksheetItem({ category: "Access", entityType: "Access", entityName: name, rateScheduleItemId: "rental", quantity: 2, uom: "WK", tierUnits: { week: 3 } });
    const book = { id: "book", scope: "revision" as const, category: "Access", metadata: { currency: "USD" }, tiers: [{ id: "week", uom: "WK", multiplier: 1 }], items: [{ id: "rental", name, costRates: { week: 100 }, rates: { week: 130 }, metadata: { costRatesAuthored: true, costProvenance: { basis: "supplier quote" }, sellProvenance: { basis: "authored" } } }] };
    const result = resolveRateBookLine(item, equipment, { currency: "CAD", rateBooks: [book] })!;
    assert.equal(result.snapshot.currency, "USD", "quote currency does not relabel source rates");
    assert.equal(result.snapshot.totalCost, 600); assert.equal(result.price, 780);
    assert.deepEqual(result.snapshot.components.find(c => c.target === "cost")?.metadata?.provenance, { basis: "supplier quote" });
    const unknown = resolveRateBookLine(item, equipment, { currency: "CAD", rateBooks: [{ ...book, metadata: {} }] })!;
    assert.equal(unknown.snapshot.currency, undefined);
  }
});

test("legacy sell-as-cost maps never replace catalog cost, including after revision copying", () => {
  for (const scope of ["global", "revision"] as const) {
    const item = worksheetItem({ rateScheduleItemId: "legacy", quantity: 2, tierUnits: { day: 3 } });
    const book = { id: "book", scope, tiers: [{ id: "day", multiplier: 2 }], items: [{ id: "legacy", catalogUnitCost: 25, rates: { day: 130 }, costRates: { day: 130 } }] };
    const result = resolveRateBookLine(item, category, { rateBooks: [book] })!;
    assert.equal(result.snapshot.totalCost, 300, "2 × 3 × catalog 25 × tier multiplier 2");
    assert.equal(result.snapshot.totalPrice, 780);
    assert.equal(result.snapshot.components.find(c => c.target === "cost")?.metadata?.basis, "catalog unit cost");
  }
});

test("rate currency uses read-time org configuration, without adopting the quote context", () => {
  const book = { id: "book", sourceCurrency: "CAD", tiers: [{ id: "day", multiplier: 1 }], items: [{ id: "rate", catalogUnitCost: 25, rates: { day: 40 } }] };
  const item = worksheetItem({ rateScheduleItemId: "rate", tierUnits: { day: 1 } });
  assert.equal(resolveRateBookLine(item, category, { currency: "EUR", rateBooks: [book] })!.snapshot.currency, "CAD");
  assert.equal(resolveRateBookLine(item, category, { rateBooks: [{ ...book, metadata: { currency: "USD" } }] })!.snapshot.currency, "USD");
});

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
        tiers: [{ id: "tier-ea", name: "Each", multiplier: 1, sortOrder: 1, uom: "EA" }],
        items: [{
          id: "rsi-1",
          resourceId: "res-pump",
          catalogItemId: "ci-pump",
          name: "Pump",
          code: "PMP",
          unit: "EA",
          rates: { "tier-ea": 150 },
          costRates: { "tier-ea": 90 },
          metadata: {
            costComponents: [
              { code: "travel", label: "Travel", kind: "travel", target: "cost", basis: "per_line", amount: 25 },
            ],
            pricingComponents: [
              { code: "margin-adder", label: "Margin adder", kind: "markup", target: "price", basis: "per_line", amount: 10 },
            ],
          },
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
            name: "Shared name",
            code: "OTHER",
            unit: "EA",
            rates: { "tier-ea": 999 },
            costRates: { "tier-ea": 999 },
          },
          {
            id: "rsi-resource",
            resourceId: "res-target",
            name: "Different display name",
            code: "TARGET",
            unit: "EA",
            rates: { "tier-ea": 25 },
            costRates: { "tier-ea": 20 },
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

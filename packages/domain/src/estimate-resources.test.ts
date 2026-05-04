import test from "node:test";
import assert from "node:assert/strict";

import {
  EstimateResourceType,
  createEstimateResourceCompositionSnapshot,
  createEstimateResourceLine,
  deriveResourcePositionTotals,
  deriveResourceUnitTotals,
  resourceLineFromCatalogItem,
  resourceLineFromRateScheduleItem,
  rollupEstimateResourcesByCode,
  rollupEstimateResourcesByName,
  rollupEstimateResourcesByType,
  type EstimateResourceLineInput,
} from "./estimate-resources";

const baseResources: EstimateResourceLineInput[] = [
  {
    id: "res-pipe",
    type: EstimateResourceType.Material,
    code: "MAT-PIPE",
    name: "Pipe",
    quantityPerUnit: 2,
    unit: "LF",
    unitCost: 12.5,
    unitPrice: 18,
  },
  {
    id: "res-labor",
    type: EstimateResourceType.Labor,
    code: "LAB-JM",
    name: "Journeyman",
    quantityPerUnit: 0.4,
    unit: "HR",
    unitCost: 70,
    unitPrice: 105,
  },
];

test("deriveResourceUnitTotals returns resource-composed unit cost and price", () => {
  assert.deepEqual(deriveResourceUnitTotals(baseResources), {
    unitCost: 53,
    unitPrice: 78,
  });
});

test("deriveResourcePositionTotals extends composed unit totals by worksheet quantity", () => {
  assert.deepEqual(deriveResourcePositionTotals(baseResources, 3), {
    quantity: 3,
    unitCost: 53,
    unitPrice: 78,
    totalCost: 159,
    totalPrice: 234,
  });
});

test("rollups aggregate resources by type, name, and code", () => {
  const resources: EstimateResourceLineInput[] = [
    {
      id: "res-bolt-a",
      type: EstimateResourceType.Material,
      code: "MAT-BOLT",
      name: "Anchor Bolt",
      quantityPerUnit: 2,
      unit: "EA",
      unitCost: 10,
      unitPrice: 14,
    },
    {
      id: "res-bolt-b",
      type: EstimateResourceType.Material,
      code: "MAT-BOLT",
      name: "Anchor Bolt",
      quantityPerUnit: 3,
      unit: "EA",
      unitCost: 12,
      unitPrice: 16,
    },
    {
      id: "res-labor",
      type: EstimateResourceType.Labor,
      code: "LAB-JM",
      name: "Journeyman",
      quantityPerUnit: 0.5,
      unit: "HR",
      unitCost: 80,
      unitPrice: 120,
    },
  ];

  const material = rollupEstimateResourcesByType(resources, 4).find(
    (entry) => entry.key === EstimateResourceType.Material,
  );
  assert.ok(material);
  assert.equal(material.quantityPerUnit, 5);
  assert.equal(material.totalQuantity, 20);
  assert.equal(material.unitCost, 56);
  assert.equal(material.unitPrice, 76);
  assert.equal(material.totalCost, 224);
  assert.equal(material.totalPrice, 304);
  assert.equal(material.resourceCount, 2);

  const byName = rollupEstimateResourcesByName(resources, 4).find(
    (entry) => entry.key === "anchor bolt",
  );
  assert.equal(byName?.totalCost, 224);

  const byCode = rollupEstimateResourcesByCode(resources, 4).find(
    (entry) => entry.key === "mat-bolt",
  );
  assert.equal(byCode?.totalPrice, 304);
});

test("resourceLineFromCatalogItem creates a catalog resource snapshot", () => {
  const line = resourceLineFromCatalogItem(
    {
      id: "catalog-lift",
      code: "EQ-LIFT-19",
      name: "19 ft Scissor Lift",
      unit: "DAY",
      unitCost: 90,
      unitPrice: 125,
      metadata: { category: "equipment", variantId: "19ft" },
    },
    { quantityPerUnit: 0.5, variantMetadata: { selected: true } },
  );

  assert.equal(line.type, EstimateResourceType.Equipment);
  assert.equal(line.source?.catalogItemId, "catalog-lift");
  assert.equal(line.variant?.source, "catalog_item");
  assert.equal(line.variant?.metadata.variantId, "19ft");
  assert.equal(line.variant?.metadata.selected, true);
});

test("rate schedule conversion and composition snapshots preserve selected variants", () => {
  const line = resourceLineFromRateScheduleItem(
    {
      id: "rsi-jm",
      code: "LAB-JM",
      name: "Journeyman",
      unit: "HR",
      rates: { regular: 100, overtime: 150 },
      costRates: { regular: 70, overtime: 105 },
      metadata: { resourceType: "labour", sourceVariant: "night-shift" },
    },
    {
      rateKey: "overtime",
      quantityPerUnit: 0.25,
      variantMetadata: { selectedShift: "night" },
    },
  );

  assert.equal(line.type, EstimateResourceType.Labor);
  assert.equal(line.unitCost, 105);
  assert.equal(line.unitPrice, 150);
  assert.equal(line.variant?.selectedRateKey, "overtime");
  assert.equal(line.variant?.selectedCostRateKey, "overtime");
  assert.deepEqual(line.variant?.metadata, {
    resourceType: "labour",
    sourceVariant: "night-shift",
    selectedShift: "night",
  });

  const snapshot = createEstimateResourceCompositionSnapshot({
    worksheetItemId: "li-1",
    quantity: 10,
    uom: "EA",
    resources: [line],
    variant: line.variant,
  });

  assert.equal(snapshot.unitCost, 26.25);
  assert.equal(snapshot.unitPrice, 37.5);
  assert.equal(snapshot.totalCost, 262.5);
  assert.equal(snapshot.totalPrice, 375);
  assert.equal(snapshot.variant?.metadata.sourceVariant, "night-shift");
});

test("resource helpers reject invalid input", () => {
  assert.throws(
    () =>
      createEstimateResourceLine({
        id: "bad",
        type: EstimateResourceType.Material,
        name: "Bad Quantity",
        quantityPerUnit: -1,
        unit: "EA",
        unitCost: 10,
        unitPrice: 12,
      }),
    /quantityPerUnit/,
  );

  assert.throws(
    () => deriveResourcePositionTotals([], -2),
    /Position quantity/,
  );

  assert.throws(
    () =>
      resourceLineFromRateScheduleItem(
        {
          id: "rsi-jm",
          code: "LAB-JM",
          name: "Journeyman",
          unit: "HR",
          rates: { regular: 100 },
          costRates: { regular: 70 },
          metadata: {},
        },
        { rateKey: "missing" },
      ),
    /rate key "missing"/,
  );
});

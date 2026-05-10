import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResourceFingerprint,
  deriveEffectiveCostFromObservations,
  normalizeCostObservation,
  normalizeResourceName,
} from "./cost-intelligence";

const resource = {
  id: "resource-copper-pipe",
  defaultUom: "FT",
};

test("normalizeResourceName creates stable matching text", () => {
  assert.equal(normalizeResourceName("  Copper  Pipe & Fittings, 1/2\"  "), "copper pipe and fittings 1 2");
});

test("buildResourceFingerprint combines manufacturer, part, code, name, and unit", () => {
  assert.equal(
    buildResourceFingerprint({
      manufacturer: "Acme",
      manufacturerPartNumber: "CP-050",
      code: "MAT-PIPE",
      name: "1/2 inch Copper Pipe",
      defaultUom: "feet",
    }),
    "acme:cp 050:mat pipe:1 2 inch copper pipe:ft",
  );
});

test("deriveEffectiveCostFromObservations selects the latest matching observation", () => {
  const effective = deriveEffectiveCostFromObservations(
    resource,
    [
      {
        id: "old",
        resourceId: resource.id,
        observedAt: "2026-01-01T00:00:00.000Z",
        observedUom: "FT",
        unitCost: 10,
        currency: "USD",
        confidence: 0.8,
      },
      {
        id: "new",
        resourceId: resource.id,
        vendorName: "North Supply",
        observedAt: "2026-02-01T00:00:00.000Z",
        observedUom: "feet",
        unitCost: 12.34567,
        unitPrice: 15.49999,
        currency: "usd",
        confidence: 0.9,
      },
    ],
    { asOf: "2026-03-01T00:00:00.000Z" },
  );

  assert.ok(effective);
  assert.equal(effective.sourceObservationId, "new");
  assert.equal(effective.unitCost, 12.3457);
  assert.equal(effective.unitPrice, 15.5);
  assert.equal(effective.vendorName, "North Supply");
  assert.equal(effective.uom, "FT");
  assert.equal(effective.currency, "USD");
});

test("deriveEffectiveCostFromObservations filters incompatible unit and currency", () => {
  const effective = deriveEffectiveCostFromObservations(
    resource,
    [
      {
        id: "wrong-unit",
        resourceId: resource.id,
        observedAt: "2026-02-01T00:00:00.000Z",
        observedUom: "EA",
        unitCost: 3,
        currency: "USD",
        confidence: 1,
      },
      {
        id: "wrong-currency",
        resourceId: resource.id,
        observedAt: "2026-02-02T00:00:00.000Z",
        observedUom: "FT",
        unitCost: 4,
        currency: "CAD",
        confidence: 1,
      },
    ],
    { asOf: "2026-03-01T00:00:00.000Z", currency: "USD" },
  );

  assert.equal(effective, null);
});

test("deriveEffectiveCostFromObservations computes recency and confidence weighted averages", () => {
  const effective = deriveEffectiveCostFromObservations(
    resource,
    [
      {
        id: "older-low-confidence",
        resourceId: resource.id,
        observedAt: "2026-01-01T00:00:00.000Z",
        observedUom: "FT",
        unitCost: 10,
        currency: "USD",
        confidence: 0.4,
      },
      {
        id: "newer-high-confidence",
        resourceId: resource.id,
        observedAt: "2026-02-15T00:00:00.000Z",
        observedUom: "FT",
        unitCost: 20,
        currency: "USD",
        confidence: 1,
      },
    ],
    {
      method: "weighted_average",
      asOf: "2026-03-01T00:00:00.000Z",
      lookbackDays: 120,
    },
  );

  assert.ok(effective);
  assert.equal(effective.method, "weighted_average");
  assert.equal(effective.sampleSize, 2);
  assert.ok(effective.unitCost > 16);
  assert.ok(effective.unitCost < 20);
  assert.deepEqual(effective.metadata.observationIds, ["newer-high-confidence", "older-low-confidence"]);
});

test("normalizeCostObservation clamps and standardizes persisted costs", () => {
  assert.deepEqual(
    normalizeCostObservation({
      id: "obs",
      observedUom: "hours",
      unitCost: -5,
      unitPrice: 12.34567,
      currency: "cad",
      confidence: 2,
    }),
    {
      id: "obs",
      observedUom: "HR",
      unitCost: 0,
      unitPrice: 12.3457,
      currency: "CAD",
      confidence: 1,
    },
  );
});

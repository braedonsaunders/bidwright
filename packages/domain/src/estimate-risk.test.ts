import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSensitivityDrivers,
  classifyEstimateMaturity,
} from "./estimate-risk";

test("classifyEstimateMaturity returns class 1 for highly mature estimates", () => {
  const result = classifyEstimateMaturity({
    lineItemCount: 180,
    sourceEvidenceCoverage: 0.98,
    resourceCoverage: 0.95,
    rateLinkageCoverage: 0.96,
    takeoffCoverage: 0.92,
    validationScore: 0.99,
    benchmarkCoverage: 0.9,
  });

  assert.equal(result.estimateClass, 1);
  assert.equal(result.confidence, "institutional");
  assert.deepEqual(result.expectedAccuracyRange, { lowPct: -10, highPct: 15 });
});

test("classifyEstimateMaturity returns class 5 when coverage is weak", () => {
  const result = classifyEstimateMaturity({
    lineItemCount: 4,
    sourceEvidenceCoverage: 0.1,
    resourceCoverage: 0,
    rateLinkageCoverage: 0.2,
    takeoffCoverage: 0,
    validationScore: 0.35,
    benchmarkCoverage: 0,
  });

  assert.equal(result.estimateClass, 5);
  assert.equal(result.confidence, "low");
  assert.equal(result.drivers[0].impact, "high");
});

test("classifyEstimateMaturity accepts percentage-style inputs", () => {
  const result = classifyEstimateMaturity({
    lineItemCount: 80,
    sourceEvidenceCoverage: 80,
    resourceCoverage: 75,
    rateLinkageCoverage: 85,
    takeoffCoverage: 60,
    validationScore: 90,
    benchmarkCoverage: 70,
  });

  assert.equal(result.estimateClass, 2);
  assert.deepEqual(result.expectedAccuracyRange, { lowPct: -15, highPct: 20 });
  assert.ok(result.maturityScore > 0.78);
});

test("buildSensitivityDrivers sorts by uncertainty exposure", () => {
  const drivers = buildSensitivityDrivers([
    { id: "a", label: "Pipe", category: "Material", totalCost: 10000, uncertaintyPct: 0.1 },
    { id: "b", label: "Labour", category: "Labour", totalCost: 8000, uncertaintyPct: 0.4 },
    { id: "c", label: "Rental", category: "Equipment", quantity: 2, unitCost: 1000, confidence: 0.8 },
  ]);

  assert.equal(drivers[0].id, "b");
  assert.equal(drivers[0].exposure, 3200);
  assert.equal(drivers.reduce((sum, driver) => sum + driver.contributionPct, 0).toFixed(3), "1.000");
});

test("buildSensitivityDrivers supports topK", () => {
  const drivers = buildSensitivityDrivers(
    [
      { id: "a", label: "A", totalCost: 100, uncertaintyPct: 0.1 },
      { id: "b", label: "B", totalCost: 200, uncertaintyPct: 0.1 },
      { id: "c", label: "C", totalCost: 300, uncertaintyPct: 0.1 },
    ],
    { topK: 2 },
  );

  assert.deepEqual(drivers.map((driver) => driver.id), ["c", "b"]);
});

test("buildSensitivityDrivers normalizes percentage-style confidence", () => {
  const drivers = buildSensitivityDrivers([
    { id: "a", label: "Percent confidence", totalCost: 1000, confidence: 80 },
    { id: "b", label: "Explicit uncertainty", totalCost: 1000, uncertaintyPct: 25, confidence: 95 },
  ]);

  assert.equal(drivers[0].id, "b");
  assert.equal(drivers[0].uncertaintyPct, 0.25);
  assert.equal(drivers[0].exposure, 250);
  assert.equal(drivers[1].id, "a");
  assert.equal(drivers[1].uncertaintyPct, 0.2);
  assert.equal(drivers[1].exposure, 200);
});

test("buildSensitivityDrivers clamps negative topK to an empty result", () => {
  const drivers = buildSensitivityDrivers(
    [
      { id: "a", label: "A", totalCost: 100, uncertaintyPct: 0.1 },
      { id: "b", label: "B", totalCost: 200, uncertaintyPct: 0.1 },
    ],
    { topK: -1 },
  );

  assert.deepEqual(drivers, []);
});

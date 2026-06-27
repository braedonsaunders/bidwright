import test from "node:test";
import assert from "node:assert/strict";
import {
  convertLinearDimension,
  parseConstructionDimensionInput,
  parseConstructionDimensionToUnit,
} from "./construction-dimension";

test("parseConstructionDimensionInput handles bare decimals, fractions, and mixed numbers", () => {
  assert.deepEqual(parseConstructionDimensionInput("10.5", "ft"), {
    value: 10.5,
    unit: "ft",
    explicitUnit: false,
  });
  assert.deepEqual(parseConstructionDimensionInput("1/4", "in"), {
    value: 0.25,
    unit: "in",
    explicitUnit: false,
  });
  assert.deepEqual(parseConstructionDimensionInput("10 1/2", "ft"), {
    value: 10.5,
    unit: "ft",
    explicitUnit: false,
  });
});

test("parseConstructionDimensionInput handles architectural feet and inches", () => {
  assert.equal(parseConstructionDimensionInput(`10' 6"`, "ft")?.value, 10.5);
  assert.equal(parseConstructionDimensionInput(`10ft 6in`, "ft")?.value, 10.5);
  assert.equal(parseConstructionDimensionInput(`10' - 1/4"`, "ft")?.value, 10 + 0.25 / 12);
  assert.equal(parseConstructionDimensionInput("10-6", "ft")?.value, 10.5);
});

test("parseConstructionDimensionInput handles explicit metric and imperial units", () => {
  assert.deepEqual(parseConstructionDimensionInput("2500 mm", "ft"), {
    value: 2500,
    unit: "mm",
    explicitUnit: true,
  });
  assert.deepEqual(parseConstructionDimensionInput("3.2 m", "ft"), {
    value: 3.2,
    unit: "m",
    explicitUnit: true,
  });
  assert.deepEqual(parseConstructionDimensionInput(`126"`, "ft"), {
    value: 126,
    unit: "in",
    explicitUnit: true,
  });
});

test("parseConstructionDimensionToUnit converts explicit dimensions into the selected unit", () => {
  assert.equal(parseConstructionDimensionToUnit(`10' 6"`, "ft"), 10.5);
  assert.ok(Math.abs((parseConstructionDimensionToUnit("126 in", "ft") ?? 0) - 10.5) < 0.000001);
  assert.ok(Math.abs((parseConstructionDimensionToUnit("10-6", "in") ?? 0) - 126) < 0.000001);
  assert.equal(parseConstructionDimensionToUnit("2500 mm", "m"), 2.5);
  assert.equal(Math.round((parseConstructionDimensionToUnit("3 m", "ft") ?? 0) * 1000) / 1000, 9.843);
});

test("convertLinearDimension converts between supported linear units", () => {
  assert.equal(convertLinearDimension(1, "yd", "ft"), 3);
  assert.ok(Math.abs(convertLinearDimension(12, "in", "ft") - 1) < 0.000001);
  assert.equal(convertLinearDimension(100, "cm", "m"), 1);
});

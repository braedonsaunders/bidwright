import assert from "node:assert/strict";
import test from "node:test";

import { formatFeetInches, formatMeasurement, isFeetInchesUnit } from "./measurement-format";

test("decimal feet render as feet and inches", () => {
  assert.equal(formatFeetInches(4.9), `4'11"`);
  assert.equal(formatFeetInches(1), `1'`);
  assert.equal(formatFeetInches(0.5), `6"`);
  assert.equal(formatFeetInches(10.25), `10'3"`);
  assert.equal(formatFeetInches(0), `0"`);
});

test("rounding carries into the next foot instead of printing twelve inches", () => {
  // 4.999 ft is 11.99 inches — must read 5', never 4'12".
  assert.equal(formatFeetInches(4.999), `5'`);
  assert.equal(formatFeetInches(11.96 / 12), `1'`);
});

test("negative lengths keep their sign", () => {
  assert.equal(formatFeetInches(-2.5), `-2'6"`);
});

test("fractional precision reduces to the simplest fraction", () => {
  assert.equal(formatFeetInches(1 + 0.5 / 12, { precision: 8 }), `1'0 1/2"`);
  assert.equal(formatFeetInches(1 + 1.25 / 12, { precision: 8 }), `1'1 1/4"`);
  // A fraction that reduces away entirely prints as whole inches.
  assert.equal(formatFeetInches(1 + 2 / 12, { precision: 8 }), `1'2"`);
});

test("inch-denominated values convert before formatting", () => {
  // 59 inches is 4'11" — the same length the topology engine resolves.
  assert.equal(formatMeasurement(59, "in"), `4'11"`);
  assert.equal(formatMeasurement(5.00049, "in"), `5"`);
});

test("non-imperial units keep a compact decimal and their unit", () => {
  assert.equal(formatMeasurement(4.9, "m"), "4.9 m");
  assert.equal(formatMeasurement(1234.5, "mm"), "1,235 mm");
  assert.equal(formatMeasurement(3, "EA"), "3 EA");
  assert.equal(formatMeasurement(12.5, "ft²"), "12.5 ft²");
  assert.equal(formatMeasurement(7, null), "7");
});

test("only linear imperial units switch to feet-inches", () => {
  assert.ok(isFeetInchesUnit("ft"));
  assert.ok(isFeetInchesUnit("in"));
  assert.ok(!isFeetInchesUnit("ft²"), "areas stay decimal");
  assert.ok(!isFeetInchesUnit("m"));
  assert.ok(!isFeetInchesUnit("EA"));
});

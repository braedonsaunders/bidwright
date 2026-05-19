/**
 * Tests for Azure → ExtractedTable helpers. Focused on pure conversion
 * functions so we don't need to mock Azure HTTP calls here.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { polygonToBbox } from "./pdf-parser";

test("polygonToBbox: clockwise polygon → axis-aligned bbox", () => {
  // Standard top-left, top-right, bottom-right, bottom-left at (1,2)..(4,5)
  const bbox = polygonToBbox([1, 2, 4, 2, 4, 5, 1, 5]);
  assert.deepEqual(bbox, { x: 1, y: 2, width: 3, height: 3 });
});

test("polygonToBbox: skewed quadrilateral takes min/max of all four corners", () => {
  // Rotated rectangle — bbox should contain the full hull.
  const bbox = polygonToBbox([1.5, 2.0, 4.0, 1.5, 4.5, 4.5, 1.0, 4.0]);
  assert.deepEqual(bbox, { x: 1.0, y: 1.5, width: 3.5, height: 3.0 });
});

test("polygonToBbox: undefined input returns undefined", () => {
  assert.equal(polygonToBbox(undefined), undefined);
});

test("polygonToBbox: short polygon returns undefined", () => {
  // Only 6 numbers — three points, not a quadrilateral.
  assert.equal(polygonToBbox([1, 2, 3, 4, 5, 6]), undefined);
});

test("polygonToBbox: zero-area polygon returns undefined", () => {
  // All four points identical → width/height both 0.
  assert.equal(polygonToBbox([1, 1, 1, 1, 1, 1, 1, 1]), undefined);
});

test("polygonToBbox: degenerate vertical line (zero width) returns undefined", () => {
  assert.equal(polygonToBbox([1, 2, 1, 4, 1, 6, 1, 8]), undefined);
});

test("polygonToBbox: NaN input returns undefined", () => {
  assert.equal(polygonToBbox([1, NaN, 3, 4, 5, 6, 7, 8]), undefined);
});

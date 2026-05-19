/**
 * Unit tests for symbol-template-service pure helpers. The runner functions
 * are integration-shaped (subprocess + Prisma + filesystem) and exercised
 * in route-level smoke tests; this file focuses on the math that turns a
 * legend cell into a crop rectangle.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { bboxInchesToPaddedPixels } from "./symbol-template-coords";

test("bboxInchesToPaddedPixels: typical 1\"x1\" cell at 150 DPI yields ~158x158px (incl. 4px padding)", () => {
  const out = bboxInchesToPaddedPixels(
    { x: 2, y: 3, width: 1, height: 1 },
    8.5,
    11,
    150,
  );
  assert.equal(out.imageWidth, Math.round(8.5 * 150));
  assert.equal(out.imageHeight, Math.round(11 * 150));
  // 2"*150 = 300, minus 4px padding = 296. Same for y.
  assert.equal(out.xPx, 296);
  assert.equal(out.yPx, 446);
  // 1"*150 = 150, plus 4px padding on each side = 158.
  assert.equal(out.wPx, 158);
  assert.equal(out.hPx, 158);
});

test("bboxInchesToPaddedPixels: bbox at the very top-left clamps padding to zero", () => {
  const out = bboxInchesToPaddedPixels(
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    8.5,
    11,
    150,
  );
  // Padding subtraction shouldn't go negative.
  assert.equal(out.xPx, 0);
  assert.equal(out.yPx, 0);
  // 0.5"*150 = 75, plus 4px padding on each side BUT clamped at xPx=0 →
  // width grows by the full 8px since we still have room on the right.
  assert.equal(out.wPx, 83);
  assert.equal(out.hPx, 83);
});

test("bboxInchesToPaddedPixels: bbox flush with right/bottom edge clamps padded width", () => {
  // Cell of 1"x1" placed exactly at the page edge — padding right/bottom
  // should be clamped so we don't overrun the page bounds.
  const out = bboxInchesToPaddedPixels(
    { x: 7.5, y: 10, width: 1, height: 1 },
    8.5,
    11,
    150,
  );
  // imageWidth = 1275, imageHeight = 1650.
  // xPx = max(0, 7.5*150 - 4) = 1121
  // wPx clamped to imageWidth - xPx = 1275 - 1121 = 154
  assert.equal(out.xPx, 1121);
  assert.equal(out.wPx, 154);
  assert.equal(out.yPx, 1496);
  assert.equal(out.hPx, 154);
});

test("bboxInchesToPaddedPixels: lower DPI scales coordinates proportionally", () => {
  const out = bboxInchesToPaddedPixels(
    { x: 1, y: 1, width: 1, height: 1 },
    8.5,
    11,
    72,
  );
  // 1"*72 = 72, minus 4 = 68
  assert.equal(out.xPx, 68);
  assert.equal(out.yPx, 68);
  // 1"*72 = 72 + 4+4 padding = 80
  assert.equal(out.wPx, 80);
  assert.equal(out.hPx, 80);
});

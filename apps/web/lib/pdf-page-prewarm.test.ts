import test from "node:test";
import assert from "node:assert/strict";
import { buildPdfPrewarmQueue } from "./pdf-page-prewarm";

test("buildPdfPrewarmQueue prioritizes nearest adjacent pages", () => {
  assert.deepEqual(buildPdfPrewarmQueue(5, 10), [4, 6, 3, 7]);
});

test("buildPdfPrewarmQueue clamps near document boundaries", () => {
  assert.deepEqual(buildPdfPrewarmQueue(1, 4), [2, 3]);
  assert.deepEqual(buildPdfPrewarmQueue(4, 4), [3, 2]);
});

test("buildPdfPrewarmQueue can include the current page", () => {
  assert.deepEqual(buildPdfPrewarmQueue(2, 3, { includeCurrent: true, radius: 1 }), [2, 1, 3]);
});

test("buildPdfPrewarmQueue handles invalid input", () => {
  assert.deepEqual(buildPdfPrewarmQueue(Number.NaN, 10), []);
  assert.deepEqual(buildPdfPrewarmQueue(1, 0), []);
});

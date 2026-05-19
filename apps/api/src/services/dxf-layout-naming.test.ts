// Unit tests for the dwg-processing-service pure helpers — the bits that
// don't need a DXF fixture or a Prisma client. Layout-name normalization
// is the load-bearing piece for the multi-layout fix; the full
// `parseDxfDrawing` end-to-end is exercised in higher-level integration
// flows where a real fixture exists.

import test from "node:test";
import assert from "node:assert/strict";

import { prettifyLayoutName } from "./dxf-math";

test("prettifyLayoutName: modelspace block becomes 'Model'", () => {
  assert.equal(prettifyLayoutName("*Model_Space"), "Model");
  assert.equal(prettifyLayoutName("*MODEL_SPACE"), "Model");
  // Some authors use lowercase.
  assert.equal(prettifyLayoutName("*model_space"), "Model");
});

test("prettifyLayoutName: active paperspace becomes 'Paper Space'", () => {
  assert.equal(prettifyLayoutName("*Paper_Space"), "Paper Space");
  assert.equal(prettifyLayoutName("*PAPER_SPACE"), "Paper Space");
});

test("prettifyLayoutName: numbered paperspace layouts get numeric suffix", () => {
  assert.equal(prettifyLayoutName("*Paper_Space0"), "Paper Space 0");
  assert.equal(prettifyLayoutName("*Paper_Space1"), "Paper Space 1");
  assert.equal(prettifyLayoutName("*PAPER_SPACE17"), "Paper Space 17");
});

test("prettifyLayoutName: unknown block names strip leading '*' and convert underscores", () => {
  // Defensive fallback for non-AutoCAD-canonical authors. Stays
  // recognisable in the UI even if we don't know the convention.
  assert.equal(prettifyLayoutName("*Custom_Layout_Name"), "Custom Layout Name");
  assert.equal(prettifyLayoutName("My Sheet"), "My Sheet");
});

test("prettifyLayoutName: empty / asterisk-only fallback to 'Layout'", () => {
  assert.equal(prettifyLayoutName(""), "Layout");
  assert.equal(prettifyLayoutName("*"), "Layout");
});

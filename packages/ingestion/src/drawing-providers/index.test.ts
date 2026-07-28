import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveActiveProvider } from "./index.js";

test("drawing extraction uses one configurable Gemini provider", () => {
  const active = resolveActiveProvider({
    drawingExtractionProvider: "gemini",
    drawingExtractionEnabled: true,
    geminiKey: "tenant-key",
    drawingExtractionModel: "gemini-custom-image-model",
  });

  assert.equal(active.id, "gemini");
  assert.equal(active.enabled, true);
  assert.equal(active.provider?.modelLabel({
    drawingExtractionProvider: "gemini",
    geminiKey: "tenant-key",
    drawingExtractionModel: "gemini-custom-image-model",
  }), "gemini-custom-image-model");
});

test("retired provider ids cannot activate drawing extraction", () => {
  const active = resolveActiveProvider({
    drawingExtractionProvider: "retired-provider",
    drawingExtractionEnabled: true,
    apiKey: "ignored",
  });

  assert.equal(active.id, "none");
  assert.equal(active.enabled, false);
  assert.equal(active.provider, null);
});

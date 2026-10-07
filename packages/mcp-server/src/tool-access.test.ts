import assert from "node:assert/strict";
import { test } from "node:test";
import { isToolAllowed } from "./tool-access.js";

test("review reports can be saved but estimator mutations cannot", () => {
  for (const tool of ["createWorksheetItem", "updateWorksheetItem", "deleteWorksheetItem", "finalizeEstimate", "updateQuote", "writeMemory"]) {
    assert.equal(isToolAllowed(tool, "qa", true), false, tool);
  }
  for (const tool of ["saveReviewCoverage", "saveReviewFindings", "saveReviewSummary", "getWorkspace", "readDrawingPage", "readDrawingTile", "getLineDerivation"]) {
    assert.equal(isToolAllowed(tool, "qa", true), true, tool);
  }
  assert.equal(isToolAllowed("saveReviewSummary", "qa"), false);
  assert.equal(isToolAllowed("updateWorksheetItem", "build_estimate"), true);
});

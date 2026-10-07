import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompactClaudeMdContent, buildReviewClaudeMdContent } from "./claude-md-generator.js";
const params = { projectDir: "/tmp/not-created", dataRoot: "/tmp", projectName: "Installation", clientName: "Client", location: "Site", scope: "Install only, exclude fabrication", quoteNumber: "Test", documents: [] };
test("active estimate instructions require native pixels and traceable calculations even with no drawing classifier", () => {
  const text = buildCompactClaudeMdContent(params);
  for (const required of ["readDrawingPage", "readDrawingTile", "viewIds", "getLineDerivation", "batchEditWorksheetItems", "saveEstimateStrategyStages", "listCalibrationLessons", "person-hours", "procurement pack", "Install only, exclude fabrication"]) assert.ok(text.includes(required), required);
  assert.ok(!text.includes("ToolSearch"));
  assert.ok(!text.includes("queued Gemini"));
});
test("review instructions require independent source reading before comparing priced quantities", () => {
  assert.match(buildReviewClaudeMdContent(params), /independently derive high-risk quantities/);
});

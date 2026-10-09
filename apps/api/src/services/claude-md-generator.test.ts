import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompactClaudeMdContent, buildReviewClaudeMdContent } from "./claude-md-generator.js";
const params = { projectDir: "/tmp/not-created", dataRoot: "/tmp", projectName: "Installation", clientName: "Client", location: "Site", scope: "Install only, exclude fabrication", quoteNumber: "Test", documents: [] };
test("estimate instructions expose the project scope and estimating toolkit", () => {
  const text = buildCompactClaudeMdContent(params);
  for (const required of ["readDrawingPage", "readDrawingTile", "viewIds", "getLineDerivation", "batchEditWorksheetItems", "saveEstimateStrategyStages", "listCalibrationLessons", "person-hours", "procurement pack", "Install only, exclude fabrication"]) assert.ok(text.includes(required), required);
  assert.ok(!text.includes("ToolSearch"));
  assert.ok(!text.includes("queued Gemini"));
});
test("review instructions require independent source reading before comparing priced quantities", () => {
  assert.match(buildReviewClaudeMdContent(params), /independently derive high-risk quantities/i);
});

test("estimate and review agents recover from overview analysis failures without claiming an unreadable PDF", () => {
  for (const text of [buildCompactClaudeMdContent(params), buildReviewClaudeMdContent(params)]) {
    assert.match(text, /try `readDrawingTile` on the same page with an explicit `bbox/);
    assert.match(text, /bypasses optional overview analysis/);
    assert.match(text, /one overview timeout does not establish that the PDF itself is unreadable/);
    assert.match(text, /qualify dependent quantities rather than claiming complete inspection/);
  }
});

test("estimating instructions require a saved customer-facing scope narrative proportional to the job", () => {
  const text = buildCompactClaudeMdContent(params);
  assert.match(text, /Setup → General → Description \/ Scope of Work/);
  assert.match(text, /updateQuote\(\{ description:/);
  assert.match(text, /one substantial paragraph/);
  assert.match(text, /approaching a page/);
  assert.match(text, /respect an explicit user request for shorter wording/);
  assert.match(text, /Preserve substantive human wording and approved commercial terms/);
  assert.match(text, /Do not promise unconfirmed/);
  assert.match(text, /reread `getWorkspace` and verify `revision\.description`/);
  assert.match(text, /chat summary, report section, leadLetter, or internal scratchpad does not fill this field/);
});

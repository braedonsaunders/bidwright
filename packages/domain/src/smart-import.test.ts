import test from "node:test";
import assert from "node:assert/strict";

import {
  SmartImportSourceType,
  countSmartImportIssues,
  createStagedEstimateRow,
  markSmartImportDuplicateRows,
  normalizeSmartImportRows,
  summarizeSmartImportBatch,
  transitionSmartImportRow,
} from "./smart-import";

test("createStagedEstimateRow maps an Excel-like row into staged estimate fields", () => {
  const [row] = normalizeSmartImportRows(
    [
      ["Item", "Qty", "Unit", "Unit Cost", "Category", "Notes"],
      ["Panelboard", "2", "EA", "$100.50", "Electrical", "Service entrance gear"],
    ],
    {
      sourceType: SmartImportSourceType.Excel,
      sourceId: "import-1",
      fileName: "takeoff.xlsx",
      sheetName: "Estimate",
    },
  );

  assert.ok(row);
  const staged = createStagedEstimateRow(row, { importBatchId: "batch-1" });

  assert.equal(staged.id, "staged:import-1:Estimate:row-2");
  assert.equal(staged.importBatchId, "batch-1");
  assert.equal(staged.source.sourceType, SmartImportSourceType.Excel);
  assert.equal(staged.source.fileName, "takeoff.xlsx");
  assert.equal(staged.source.sheetName, "Estimate");
  assert.equal(staged.source.rowNumber, 2);
  assert.deepEqual(staged.fields, {
    phase: "",
    category: "Electrical",
    entityType: "Electrical",
    entityName: "Panelboard",
    description: "",
    quantity: 2,
    uom: "EA",
    unitCost: 100.5,
    markup: 0,
    unitPrice: 0,
    sourceNotes: "Service entrance gear",
  });
  assert.equal(staged.review.status, "pending");
  assert.equal(staged.issues.length, 0);
  assert.ok(staged.confidence > 0.5);

  const quantityDiagnostic = staged.diagnostics.find((diagnostic) => diagnostic.targetField === "quantity");
  assert.equal(quantityDiagnostic?.sourceHeader, "Qty");
  assert.equal(quantityDiagnostic?.status, "coerced");
});

test("confidence and issue aggregation report blocking import problems", () => {
  const [row] = normalizeSmartImportRows(
    [{ Item: "", Qty: "not a number", Unit: "" }],
    { sourceType: SmartImportSourceType.Csv, sourceId: "bad-csv" },
  );

  assert.ok(row);
  const staged = createStagedEstimateRow(row);
  const counts = countSmartImportIssues(staged.issues);
  const summary = summarizeSmartImportBatch([staged]);

  assert.equal(counts.error, 2);
  assert.equal(counts.warning, 0);
  assert.deepEqual(
    staged.issues.map((issue) => issue.code).sort(),
    ["invalid_quantity", "missing_item_identity"],
  );
  assert.ok(staged.confidence < 0.25);
  assert.equal(summary.issueCounts.error, 2);
  assert.equal(summary.rowsWithErrors, 1);
  assert.equal(summary.importableRows, 0);
});

test("markSmartImportDuplicateRows detects duplicate staged estimates by normalized signature", () => {
  const rows = normalizeSmartImportRows(
    [
      { Item: "Conduit", Qty: 10, Unit: "LF", "Unit Cost": "$2.50", Category: "Material" },
      { Item: " conduit ", Qty: "10.000", Unit: "lf", "Unit Cost": 2.5, Category: "material" },
      { Item: "Disconnect", Qty: 1, Unit: "EA", "Unit Cost": 80, Category: "Material" },
    ],
    { sourceType: SmartImportSourceType.Csv, sourceId: "takeoff-csv" },
  );

  const staged = rows.map((row) => createStagedEstimateRow(row));
  const marked = markSmartImportDuplicateRows(staged);
  const summary = summarizeSmartImportBatch(marked);

  assert.equal(marked[0]?.duplicate?.groupSize, 2);
  assert.equal(marked[1]?.duplicate?.duplicateOf, marked[0]?.id);
  assert.equal(marked[2]?.duplicate, undefined);
  assert.equal(marked[0]?.issues.some((issue) => issue.code === "duplicate_row"), true);
  assert.equal(marked[1]?.issues.some((issue) => issue.code === "duplicate_row"), true);
  assert.equal(summary.duplicateGroups, 1);
  assert.equal(summary.duplicateRows, 2);
  assert.equal(summary.rowsWithWarnings, 2);
});

test("transitionSmartImportRow accepts, rejects, resets, and blocks invalid acceptance", () => {
  const [validRow] = normalizeSmartImportRows(
    [{ Item: "Cable tray", Qty: 4, Unit: "EA", "Unit Cost": 120 }],
    { sourceType: SmartImportSourceType.Csv, sourceId: "review-csv" },
  );
  const [invalidRow] = normalizeSmartImportRows(
    [{ Item: "", Qty: 0 }],
    { sourceType: SmartImportSourceType.Csv, sourceId: "review-csv" },
  );

  assert.ok(validRow);
  assert.ok(invalidRow);

  const valid = createStagedEstimateRow(validRow);
  const accepted = transitionSmartImportRow(valid, "accept", {
    at: "2026-05-01T10:00:00.000Z",
    by: "estimator-1",
  });
  const rejected = transitionSmartImportRow(accepted, "reject", {
    at: "2026-05-01T10:05:00.000Z",
    by: "estimator-1",
    reason: "Covered by another line",
  });
  const reset = transitionSmartImportRow(rejected, "reset");

  assert.equal(accepted.review.status, "accepted");
  assert.equal(accepted.review.reviewedBy, "estimator-1");
  assert.equal(rejected.review.status, "rejected");
  assert.equal(rejected.review.reason, "Covered by another line");
  assert.equal(reset.review.status, "pending");
  assert.equal(reset.review.history.length, 3);
  assert.equal(valid.review.status, "pending");

  const invalid = createStagedEstimateRow(invalidRow);
  assert.throws(() => transitionSmartImportRow(invalid, "accept"), /blocking validation issues/);

  const acceptedWithOverride = transitionSmartImportRow(invalid, "accept", { allowAcceptWithErrors: true });
  assert.equal(acceptedWithOverride.review.status, "accepted");
});

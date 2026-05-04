import test from "node:test";
import assert from "node:assert/strict";

import {
  UNASSIGNED_WORKSHEET_ITEM_ID,
  groupEstimateEvidenceByWorksheetItemId,
  isWeakEstimateEvidence,
  normalizeEstimateEvidence,
  renderEstimateEvidenceSourceNote,
  renderEstimateEvidenceSourceNotes,
  scoreEstimateEvidenceCoverage,
  scoreEstimateEvidenceCoverageByWorksheetItemId,
  validateEstimateEvidence,
  validateEstimateEvidenceRows,
  type EstimateEvidence,
} from "./estimate-evidence";

test("normalizeEstimateEvidence trims text, normalizes confidence, and repairs page ranges", () => {
  const evidence = normalizeEstimateEvidence({
    kind: "document_page",
    id: " ev-1 ",
    worksheetItemId: " line-1 ",
    fileName: "  Specs.pdf  ",
    pageNumber: 12.9,
    pageEnd: 10,
    sectionTitle: "  22 10 00   Plumbing  ",
    confidence: 82,
    metadata: {},
  });

  assert.deepEqual(evidence, {
    kind: "document_page",
    id: "ev-1",
    worksheetItemId: "line-1",
    fileName: "Specs.pdf",
    pageNumber: 12,
    pageEnd: 12,
    sectionTitle: "22 10 00 Plumbing",
    confidence: 0.82,
  });
});

test("renderEstimateEvidenceSourceNotes produces compact human source notes and deduplicates", () => {
  const rows: EstimateEvidence[] = [
    {
      kind: "document_chunk",
      fileName: "Spec.pdf",
      pageNumber: 4,
      chunkId: "chunk-44",
      excerpt: "Use schedule 40 steel pipe.",
    },
    {
      kind: "document_chunk",
      fileName: "Spec.pdf",
      pageNumber: 4,
      chunkId: "chunk-44",
      excerpt: "Use schedule 40 steel pipe.",
    },
    {
      kind: "rate_schedule_item",
      rateScheduleName: "2026 Labour",
      itemName: "Pipefitter",
      tierName: "Regular",
      rate: 112.5,
      unit: "HR",
    },
    {
      kind: "takeoff_link",
      annotationLabel: "Pipe run A",
      quantityField: "value",
      multiplier: 1.1,
      derivedQuantity: 121,
      uom: "LF",
    },
  ];

  assert.equal(
    renderEstimateEvidenceSourceNotes(rows),
    "Spec.pdf p. 4, #chunk-44 - Use schedule 40 steel pipe.; Rate schedule: 2026 Labour, Pipefitter, Regular, rate 112.5/HR; Takeoff link: Pipe run A value x 1.1 = 121 LF",
  );
});

test("renderEstimateEvidenceSourceNote covers all evidence kinds with useful source text", () => {
  const examples: EstimateEvidence[] = [
    { kind: "document_page", fileName: "Drawings.pdf", pageNumber: 7 },
    { kind: "knowledge_book", bookName: "Estimator Handbook", sectionTitle: "Supports" },
    { kind: "knowledge_table", tableName: "Pipe Supports", rowKey: "PS-2", bookName: "Estimator Handbook" },
    { kind: "knowledge_page", pageTitle: "Welding Factors", pageNumber: 14 },
    { kind: "dataset_row", datasetName: "Vendor Import", rowLabel: "SKU-100", fieldLabel: "Unit Cost" },
    { kind: "web_url", title: "Manufacturer sheet", url: "https://example.com/spec" },
    {
      kind: "takeoff_annotation",
      annotationLabel: "Area B",
      documentName: "A-101",
      pageNumber: 2,
      quantityField: "area",
      measurement: { area: 320, unit: "SF" },
    },
    { kind: "model_quantity", model: "gpt-5", quantity: 12, uom: "EA", rationale: "Counted tagged fixtures." },
    { kind: "model_link", aiRunId: "run-1", targetType: "worksheet_item", targetId: "line-1" },
    { kind: "assumption", statement: "Existing housekeeping pad can be reused.", status: "open" },
    { kind: "correction_factor", factorName: "Winter productivity", operation: "multiply", factorValue: 0.9, basis: "Outdoor work." },
    { kind: "catalog_item", catalogName: "Materials", itemName: "2 in valve", unitCost: 45, unit: "EA" },
    { kind: "manual_note", text: "Estimator verified with foreman.", author: "Sam" },
  ];

  for (const evidence of examples) {
    assert.notEqual(renderEstimateEvidenceSourceNote(evidence), "", evidence.kind);
  }
});

test("scoreEstimateEvidenceCoverage rewards source, quantity, and rate coverage", () => {
  const coverage = scoreEstimateEvidenceCoverage([
    {
      kind: "document_chunk",
      worksheetItemId: "line-1",
      fileName: "Spec.pdf",
      pageNumber: 8,
      chunkId: "chunk-8",
      excerpt: "Provide isolation valves.",
      confidence: 0.9,
    },
    {
      kind: "takeoff_link",
      worksheetItemId: "line-1",
      takeoffLinkId: "tol-1",
      annotationId: "ann-1",
      quantityField: "value",
      derivedQuantity: 8,
      uom: "EA",
    },
    {
      kind: "catalog_item",
      worksheetItemId: "line-1",
      catalogItemId: "cat-1",
      catalogName: "Valve Catalog",
      itemName: "2 in ball valve",
      unitCost: 44,
      unit: "EA",
    },
  ]);

  assert.equal(coverage.status, "strong");
  assert.deepEqual(coverage.missingFacets, []);
  assert.equal(coverage.evidenceCount, 3);
  assert.equal(coverage.byKind.document_chunk, 1);
  assert.equal(coverage.byKind.takeoff_link, 1);
  assert.equal(coverage.byKind.catalog_item, 1);
  assert.ok(coverage.score >= 0.85);
});

test("scoreEstimateEvidenceCoverage flags missing default facets", () => {
  const coverage = scoreEstimateEvidenceCoverage([
    {
      kind: "manual_note",
      text: "Estimator carried forward prior bid value.",
    },
  ]);

  assert.equal(coverage.status, "weak");
  assert.deepEqual(coverage.missingFacets, ["quantity", "rate"]);
  assert.ok(coverage.issues.some((issue) => issue.code === "missing_evidence_facet" && issue.message === "Missing quantity evidence."));
  assert.equal(isWeakEstimateEvidence({ kind: "manual_note", text: "Estimator carried forward prior bid value." }), true);
});

test("groupEstimateEvidenceByWorksheetItemId groups normalized rows and preserves unassigned evidence", () => {
  const groups = groupEstimateEvidenceByWorksheetItemId([
    { kind: "document_page", worksheetItemId: " line-1 ", fileName: "Spec.pdf", pageNumber: 2 },
    { kind: "dataset_row", worksheetItemId: "line-2", datasetName: "Rates", rowLabel: "PF" },
    { kind: "manual_note", text: "General bid note" },
  ]);

  assert.deepEqual(Object.keys(groups).sort(), [UNASSIGNED_WORKSHEET_ITEM_ID, "line-1", "line-2"].sort());
  assert.equal(groups["line-1"][0].worksheetItemId, "line-1");
  assert.equal(groups[UNASSIGNED_WORKSHEET_ITEM_ID][0].kind, "manual_note");
});

test("scoreEstimateEvidenceCoverageByWorksheetItemId scores each worksheet item independently", () => {
  const scores = scoreEstimateEvidenceCoverageByWorksheetItemId(
    [
      { kind: "document_page", worksheetItemId: "line-1", fileName: "Spec.pdf", pageNumber: 2 },
      { kind: "takeoff_link", worksheetItemId: "line-2", annotationId: "ann-1", derivedQuantity: 10 },
      { kind: "rate_schedule_item", worksheetItemId: "line-2", itemName: "Electrician", rate: 95 },
    ],
    { expectedFacets: ["quantity", "rate"] },
  );

  assert.equal(scores["line-1"].status, "weak");
  assert.equal(scores["line-1"].missingFacets.length, 2);
  assert.equal(scores["line-2"].status, "strong");
});

test("validation helpers flag empty rows and weak evidence", () => {
  const emptyIssues = validateEstimateEvidence({ kind: "manual_note" });
  assert.deepEqual(emptyIssues.map((issue) => issue.code), ["empty_evidence"]);

  const weakIssues = validateEstimateEvidence({
    kind: "web_url",
    url: "example.com/catalog",
  });
  assert.ok(weakIssues.some((issue) => issue.code === "non_http_url"));
  assert.ok(weakIssues.some((issue) => issue.code === "missing_web_context"));
  assert.equal(isWeakEstimateEvidence({ kind: "web_url", url: "example.com/catalog" }), true);

  const setIssues = validateEstimateEvidenceRows([]);
  assert.ok(setIssues.some((issue) => issue.code === "empty_evidence_set"));
});

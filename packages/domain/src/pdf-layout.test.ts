import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuotePdfSegments,
  getPdfAttachmentSectionKey,
  insertPdfAttachmentAfterReport,
  pdfAttachmentIdForSource,
} from "./pdf-layout";

test("insertPdfAttachmentAfterReport places the file after report and before terms", () => {
  const order = ["coverPage", "reportSections", "pricingSummary", "terms"];
  insertPdfAttachmentAfterReport(order, "attachment:att_1");
  assert.deepEqual(order, [
    "coverPage",
    "reportSections",
    "attachment:att_1",
    "pricingSummary",
    "terms",
  ]);
});

test("buildQuotePdfSegments splits HTML around file attachments", () => {
  const attachments = [
    { id: "spec", title: "Spec.pdf", fileNodeId: "fn1" },
    { id: "drawing", title: "Drawing.pdf", documentId: "doc1" },
  ];
  const segments = buildQuotePdfSegments(
    [
      "coverPage",
      "reportSections",
      getPdfAttachmentSectionKey("spec"),
      "terms",
      getPdfAttachmentSectionKey("drawing"),
    ],
    attachments,
  );

  assert.deepEqual(segments, [
    { kind: "html", sectionKeys: ["coverPage", "reportSections"] },
    { kind: "attachment", attachment: attachments[0] },
    { kind: "html", sectionKeys: ["terms"] },
    { kind: "attachment", attachment: attachments[1] },
  ]);
});

test("buildQuotePdfSegments skips unknown attachment keys without splitting HTML", () => {
  const segments = buildQuotePdfSegments(
    ["coverPage", getPdfAttachmentSectionKey("missing"), "terms"],
    [{ id: "other", title: "Other.pdf", fileNodeId: "fn2" }],
  );
  assert.deepEqual(segments, [
    { kind: "html", sectionKeys: ["coverPage", "terms"] },
  ]);
});

test("pdfAttachmentIdForSource prefers the file node id", () => {
  assert.equal(pdfAttachmentIdForSource({ fileNodeId: "fn9", documentId: "doc9" }), "att_fn9");
  assert.equal(pdfAttachmentIdForSource({ documentId: "doc9" }), "att_doc9");
});

test("buildQuotePdfSegments treats the schedule as its own landscape part", () => {
  const segments = buildQuotePdfSegments(
    ["coverPage", "reportSections", "schedule", "terms"],
    [],
  );
  assert.deepEqual(segments, [
    { kind: "html", sectionKeys: ["coverPage", "reportSections"] },
    { kind: "schedule" },
    { kind: "html", sectionKeys: ["terms"] },
  ]);
});

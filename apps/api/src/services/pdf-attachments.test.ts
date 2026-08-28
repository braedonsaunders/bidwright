import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import {
  loadQuotePdfAttachmentBytes,
  mergePdfBuffers,
  quotePdfSegmentsFromLayout,
} from "./pdf-attachments";

async function tinyPdf(label: string) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText(label, { x: 24, y: 100, size: 12 });
  return Buffer.from(await doc.save());
}

test("mergePdfBuffers concatenates pages from each part", async () => {
  const first = await tinyPdf("one");
  const second = await tinyPdf("two");
  const merged = await mergePdfBuffers([first, second]);
  const doc = await PDFDocument.load(merged);
  assert.equal(doc.getPageCount(), 2);
});

test("mergePdfBuffers returns the only part unchanged", async () => {
  const only = await tinyPdf("solo");
  const merged = await mergePdfBuffers([only]);
  assert.equal(merged, only);
});

test("loadQuotePdfAttachmentBytes skips missing and non-PDF files", async () => {
  const store = {
    async getFileNode(nodeId: string) {
      if (nodeId === "missing") return null;
      if (nodeId === "text") {
        return { name: "notes.txt", storagePath: "https://example.test/notes.txt", projectId: "p1" };
      }
      return null;
    },
    async getDocument() {
      return null;
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("not a pdf", { status: 200 })) as typeof fetch;
  try {
    const missing = await loadQuotePdfAttachmentBytes(store, "p1", {
      id: "att_missing",
      title: "Missing.pdf",
      fileNodeId: "missing",
    });
    assert.equal(missing.bytes, null);
    assert.match(missing.warning ?? "", /not found/);

    const notPdf = await loadQuotePdfAttachmentBytes(store, "p1", {
      id: "att_text",
      title: "Notes",
      fileNodeId: "text",
    });
    assert.equal(notPdf.bytes, null);
    assert.match(notPdf.warning ?? "", /not a PDF/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("quotePdfSegmentsFromLayout inserts missing attachments after the report", () => {
  const { sectionOrder, segments } = quotePdfSegmentsFromLayout({
    sectionOrder: ["coverPage", "reportSections", "terms"],
    attachments: [{ id: "spec", title: "Spec.pdf", fileNodeId: "fn1" }],
  });
  assert.deepEqual(sectionOrder, ["coverPage", "reportSections", "attachment:spec", "terms"]);
  assert.equal(segments[1]?.kind, "attachment");
});

test("quotePdfSegmentsFromLayout only emits a schedule part when the section is on", () => {
  const off = quotePdfSegmentsFromLayout({
    sectionOrder: ["coverPage", "schedule", "terms"],
    sections: { schedule: false } as never,
  });
  assert.deepEqual(off.segments, [
    { kind: "html", sectionKeys: ["coverPage", "terms"] },
  ]);

  const on = quotePdfSegmentsFromLayout({
    sectionOrder: ["coverPage", "schedule", "terms"],
    sections: { schedule: true } as never,
  });
  assert.deepEqual(on.segments, [
    { kind: "html", sectionKeys: ["coverPage"] },
    { kind: "schedule" },
    { kind: "html", sectionKeys: ["terms"] },
  ]);
});

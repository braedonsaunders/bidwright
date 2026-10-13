import assert from "node:assert/strict";
import test from "node:test";
import { documentPageText, parseDocumentPages } from "./document-page-text.js";

test("flat native PDF text never pretends that page 450 has no text", async () => {
  const doc = { pageCount: 572, extractedText: "Issued for Tender flat text without page separators", structuredData: { nativePdf: {} } };
  const pages = Array.from({ length: 572 }, (_, i) => `Physical text ${i + 1}`);
  pages[449] = "High Voltage Outdoor Switchgear";
  const result = await documentPageText(doc, "450-460", "/local/test.pdf", async () => pages);
  assert.match(result.content, /--- Page 450 ---\nHigh Voltage/);
  assert.match(result.content, /Physical text 460/);
  assert.doesNotMatch(result.content, /Physical text 461/);
});
test("structured pages and blank pages preserve physical numbering without extraction", async () => {
  const result = await documentPageText({ pageCount: 3, structuredData: { pages: [{ pageNumber: 2, text: "" }] } }, "2", undefined, async () => { throw new Error("unexpected extraction"); });
  assert.equal(result.pageTextStatus, "available");
  assert.match(result.content, /No text layer on this page/);
});
test("missing page indexes say unavailable, malformed/out-of-range requests are precise", async () => {
  assert.equal((await documentPageText({ pageCount: 500, extractedText: "flat text" }, "450")).pageTextStatus, "unavailable");
  for (const value of ["0", "3-2", "junk", "2-4"]) assert.throws(() => parseDocumentPages(value, 3), /Invalid physical PDF page range/);
});
test("Azure pageText serves remote PDFs without fetching bytes", async () => {
  const result = await documentPageText({ fileName: "remote.pdf", pageCount: 4, storagePath: "https://example.invalid/file.pdf",
    structuredData: { pageText: [{ pageNumber: 3, lines: [{ text: "Stored OCR page three" }] }] } }, "3", "https://example.invalid/file.pdf", async () => { throw new Error("Unexpected extraction"); });
  assert.match(result.content, /Page 3 ---\nStored OCR page three/);
});
test("ingestion Page Break markers work for non-PDF text without extraction", async () => {
  const result = await documentPageText({ fileName: "source.docx", pageCount: 2, extractedText: "First page\n\n--- Page Break ---\n\nSecond page" }, "2", "/local/source.docx", async () => { throw new Error("Unexpected extraction"); });
  assert.equal(result.content, "--- Page 2 ---\nSecond page");
  assert.equal((await documentPageText({ fileName: "source.txt", extractedText: "No page boundaries" }, "2", "/local/source.txt")).pageTextStatus, "unavailable");
});

test("full document reads expose exact page offsets without a pages argument", async () => {
  const { fullDocumentText } = await import("./document-page-text.js");
  const content = "Device obligations\n\n--- Page Break ---\n\nDoor obligations";
  const result = fullDocumentText({ extractedText: content });
  assert.equal(result.content, content);
  assert.deepEqual(result.pageRanges.map(r => [r.page, content.slice(r.start, r.end)]), [[1, "Device obligations"], [2, "Door obligations"]]);
});


test("unpaged single-page and native-PDF reads retain their known physical page mapping", async () => {
  const { fullDocumentText } = await import("./document-page-text.js");
  assert.deepEqual(fullDocumentText({ extractedText: "Device schedule", pageCount: 1 }).pageRanges, [{ page: 1, start: 0, end: 15 }]);
  const native = fullDocumentText({ extractedText: "Devices\nDoors", structuredData: { nativePdf: { pages: [{ pageNumber: 1, text: "Devices" }, { pageNumber: 2, text: "Doors" }] } } });
  assert.deepEqual(native.pageRanges, [{ page: 1, start: 0, end: 7 }, { page: 2, start: 8, end: 13 }]);
});


test("a selected physical page range also exposes offsets for partially delivered chunks", async () => {
  const result = await documentPageText({ extractedText: "Devices\fDoors", pageCount: 2 }, "1-2");
  assert.deepEqual(result.pageRanges?.map(r => [r.page, result.content.slice(r.start, r.end)]), [[1, "Devices"], [2, "Doors"]]);
});

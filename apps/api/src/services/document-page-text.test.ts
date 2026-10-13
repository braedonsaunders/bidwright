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

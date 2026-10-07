import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { extractArchiveEntries } from "./zip.js";

test("extractArchiveEntries expands ZIPs nested inside the uploaded ZIP", async () => {
  const inner = new JSZip();
  inner.file("2025-05-26 Layouts and Platforms-Signed.pdf", "%PDF-1.7 layouts");
  inner.file("M04020-0001_Rev.01_Alex.pdf", "%PDF-1.7 alex");
  const outer = new JSZip();
  outer.file("RE__RFQ_for_Rassaun_Services.zip", await inner.generateAsync({ type: "uint8array" }));
  outer.file("__MACOSX/._junk", "x");
  outer.file("notes.txt", "scope");

  const entries = await extractArchiveEntries(await outer.generateAsync({ type: "nodebuffer" }));

  assert.deepEqual(entries.map((entry) => entry.path), [
    "RE__RFQ_for_Rassaun_Services.zip/2025-05-26 Layouts and Platforms-Signed.pdf",
    "RE__RFQ_for_Rassaun_Services.zip/M04020-0001_Rev.01_Alex.pdf",
    "notes.txt",
  ]);
  assert.equal(entries[0].extension, "pdf");
  assert.equal(entries[0].mimeType, "application/pdf");
});

test("extractArchiveEntries keeps an unreadable .zip as an opaque entry", async () => {
  const outer = new JSZip();
  outer.file("broken.zip", "not really a zip");
  const entries = await extractArchiveEntries(await outer.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(entries.map((entry) => entry.path), ["broken.zip"]);
});

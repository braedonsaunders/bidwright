import assert from "node:assert/strict";
import test from "node:test";
import { derivePagesForIndexing, planPageChunks } from "./page-provenance.js";

const platformNote = '8x8x5/8" Base Plate c/w (1) 1" dia hole for 3/4" SS epoxy anchor 1" epoxy grout Platform Framing Arrangement';

test("positioned per-page text wins and keeps the recorded page numbers, gaps included", () => {
  const pages = derivePagesForIndexing("ignored when structured pages exist", {
    pageText: [
      { pageNumber: 1, lines: [{ text: "Digitally signed by Sam Ravida" }] },
      { pageNumber: 4, lines: [{ text: '8x8x5/8" Base Plate c/w (1) 1" dia hole' }, { text: 'for 3/4" SS epoxy anchor' }, { text: "" }] },
    ],
  });
  assert.deepEqual(pages?.map((page) => page.pageNumber), [1, 4]);
  assert.match(pages![1].text, /\(1\) 1" dia hole\nfor 3\/4" SS epoxy anchor/);
});

test("truncated positioned text is not trusted; fall back to delimiter split", () => {
  const text = ["cover", "notes", "plan", platformNote, "details"].join("\n\n--- Page Break ---\n\n");
  const pages = derivePagesForIndexing(text, { pageText: [{ pageNumber: 1, lines: [{ text: "partial" }], truncated: true }] });
  assert.equal(pages?.length, 5);
  assert.equal(pages![3].pageNumber, 4);
  assert.match(pages![3].text, /epoxy grout/);
});

test("extracted text with form feeds or legacy markers splits sequentially", () => {
  assert.deepEqual(derivePagesForIndexing("a\fb\fc", {})?.map((page) => page.pageNumber), [1, 2, 3]);
  assert.deepEqual(derivePagesForIndexing("a\n\n---\n\nb", {})?.map((page) => page.text), ["a", "b"]);
  assert.deepEqual(derivePagesForIndexing("a --- Page 2 --- b", null)?.map((page) => page.text), ["a", "b"]);
});

test("no page mapping means null, never an invented page", () => {
  assert.equal(derivePagesForIndexing("single page body with no delimiters", {}), null);
  assert.equal(derivePagesForIndexing("", {}), null);
  assert.equal(derivePagesForIndexing(null, { pageText: [] }), null);
});

test("regression: a chunk from page 4 of a multi-page PDF carries pageNumber 4", () => {
  const text = ["cover", "notes", "plan", platformNote, "details"].join("\n\n--- Page Break ---\n\n");
  const pages = derivePagesForIndexing(text, {})!;
  // A stub chunker that splits on sentences, like the real section-aware one would on long pages.
  const chunks = planPageChunks(pages, (pageText) => pageText.split(/(?<=anchor)\s+/).map((part) => ({ text: part })));
  const grout = chunks.find((chunk) => /epoxy grout/.test(chunk.text));
  assert.ok(grout);
  assert.equal(grout!.pageNumber, 4);
  assert.ok(chunks.every((chunk) => Number.isInteger(chunk.pageNumber) && chunk.pageNumber >= 1));
  assert.equal(new Set(chunks.map((chunk) => chunk.pageNumber)).size, 5, "every page produced at least one chunk");
});

test("empty pages and empty chunks are skipped without shifting page numbers", () => {
  const chunks = planPageChunks(
    [{ pageNumber: 1, text: "  " }, { pageNumber: 2, text: "two" }, { pageNumber: 3, text: "three" }],
    (pageText) => [{ text: pageText }, { text: "" }],
  );
  assert.deepEqual(chunks.map((chunk) => [chunk.pageNumber, chunk.text]), [[2, "two"], [3, "three"]]);
});

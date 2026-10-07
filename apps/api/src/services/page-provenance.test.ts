import assert from "node:assert/strict";
import test from "node:test";
import { derivePagesForIndexing, planPageChunks } from "./page-provenance.js";

const platformNote = '8x8x5/8" Base Plate c/w (1) 1" dia hole for 3/4" SS epoxy anchor 1" epoxy grout Platform Framing Arrangement';

test("positioned per-page text wins and keeps the recorded page numbers, gaps included", () => {
  const pages = derivePagesForIndexing('Digitally signed by Sam Ravida 8x8x5/8" Base Plate c/w (1) 1" dia hole for 3/4" SS epoxy anchor', {
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

test("form feeds split sequentially", () => {
  assert.deepEqual(derivePagesForIndexing("a\fb\fc", {})?.map((page) => page.pageNumber), [1, 2, 3]);
});

test("explicit numbered markers keep their numbers, including a leading marker and gaps", () => {
  const leading = derivePagesForIndexing("--- Page 4 --- note on four --- Page 7 --- note on seven", {});
  assert.deepEqual(leading?.map((page) => [page.pageNumber, page.text]), [[4, "note on four"], [7, "note on seven"]]);
  // text before the first marker has no page; it is kept but not numbered
  const preface = derivePagesForIndexing("cover text --- Page 2 --- body two", null);
  assert.deepEqual(preface?.map((page) => page.pageNumber), [null, 2]);
  assert.equal(preface![0].text, "cover text");
});

test("a bare Markdown horizontal rule is not a page boundary unless the caller proves the extractor used it", () => {
  const prose = "Scope summary\n\n---\n\nExclusions list";
  assert.equal(derivePagesForIndexing(prose, {}), null, "ordinary markdown rule: no pages invented");
  assert.deepEqual(derivePagesForIndexing(prose, {}, { bareRuleIsPageBreak: true })?.map((page) => page.pageNumber), [1, 2]);
});

test("structured page numbers must be positive integers", () => {
  const pages = derivePagesForIndexing("two", {
    pageText: [
      { pageNumber: 1.5, lines: [{ text: "half" }] },
      { pageNumber: 0, lines: [{ text: "zero" }] },
      { pageNumber: 2, lines: [{ text: "two" }] },
    ],
  });
  assert.deepEqual(pages?.map((page) => [page.pageNumber, page.text]), [[2, "two"]]);
  // when no structured page survives validation, the delimiter fallback applies
  const none = derivePagesForIndexing("fallback\ftext", { pageText: [{ pageNumber: "x" as unknown as number, lines: [{ text: "bad" }] }] });
  assert.deepEqual(none?.map((page) => page.pageNumber), [1, 2]);
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
  assert.ok(chunks.every((chunk) => chunk.pageNumber !== null && Number.isInteger(chunk.pageNumber) && chunk.pageNumber >= 1));
  assert.equal(new Set(chunks.map((chunk) => chunk.pageNumber)).size, 5, "every page produced at least one chunk");
});

test("empty pages and empty chunks are skipped without shifting page numbers", () => {
  const chunks = planPageChunks(
    [{ pageNumber: 1, text: "  " }, { pageNumber: 2, text: "two" }, { pageNumber: 3, text: "three" }],
    (pageText) => [{ text: pageText }, { text: "" }],
  );
  assert.deepEqual(chunks.map((chunk) => [chunk.pageNumber, chunk.text]), [[2, "two"], [3, "three"]]);
});

test("a positioned cover page must not discard an OCR body: body is kept with page=null", () => {
  const body = "SECTION 1 SCOPE OF WORK. The contractor shall install the roller compactor and servo-lift. ".repeat(6);
  const pages = derivePagesForIndexing(`COVER SHEET Teva Canada\n${body}`, {
    pageText: [{ pageNumber: 1, lines: [{ text: "COVER SHEET Teva Canada" }] }],
  });
  assert.ok(pages);
  assert.deepEqual(pages!.map((page) => page.pageNumber), [1, null]);
  assert.equal(pages![0].text, "COVER SHEET Teva Canada");
  assert.match(pages![1].text, /roller compactor and servo-lift/);
  assert.ok(!/COVER SHEET/.test(pages![1].text), "known cover text is not duplicated into the unpaged remainder");
});

test("when the extractor's delimiters give a complete mapping, it beats a partial positioned cover", () => {
  const text = ["COVER SHEET", "scope body text here", "exclusions body text here"].join("\n\n--- Page Break ---\n\n");
  const pages = derivePagesForIndexing(text, { pageText: [{ pageNumber: 1, lines: [{ text: "COVER SHEET" }] }] });
  assert.deepEqual(pages?.map((page) => page.pageNumber), [1, 2, 3]);
  assert.equal(pages![2].text, "exclusions body text here");
});

test("positioned pages that cover the document are used as-is", () => {
  const pages = derivePagesForIndexing("alpha beta\ngamma delta", {
    pageText: [{ pageNumber: 1, lines: [{ text: "alpha beta" }] }, { pageNumber: 2, lines: [{ text: "gamma delta" }] }],
  });
  assert.deepEqual(pages?.map((page) => [page.pageNumber, page.text]), [[1, "alpha beta"], [2, "gamma delta"]]);
});

test("a short OCR-only quantity note survives alongside long positioned text", () => {
  const longCover = Array.from({ length: 40 }, (_, i) => `General note ${i + 1}: contractor to verify all dimensions on site.`).join("\n");
  const extracted = `${longCover}\nTYP 4`;
  const pages = derivePagesForIndexing(extracted, {
    pageText: [{ pageNumber: 1, lines: longCover.split("\n").map((text) => ({ text })) }],
  });
  assert.ok(pages);
  assert.deepEqual(pages!.map((page) => page.pageNumber), [1, null]);
  assert.equal(pages![1].text, "TYP 4", "the 5-character unmatched note is kept, not dropped by a length threshold");
  assert.ok(!/TYP 4/.test(pages![0].text));
});

test("positioned pages with no unmatched remainder are returned as-is", () => {
  const pages = derivePagesForIndexing("alpha beta\ngamma delta", {
    pageText: [{ pageNumber: 1, lines: [{ text: "alpha beta" }] }, { pageNumber: 2, lines: [{ text: "gamma delta" }] }],
  });
  assert.deepEqual(pages?.map((page) => page.pageNumber), [1, 2]);
});

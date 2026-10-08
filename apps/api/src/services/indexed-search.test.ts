import assert from "node:assert/strict";
import test from "node:test";
import { buildEstimatorSearchProfile, rankEstimatorSearchItems } from "./estimator-search.js";
import { rankIndexedCandidates, searchExcerpt } from "./indexed-search.js";

test("engineering sizes remain distinct when ranking weld operations", () => {
  const rows = ["3/4 inch stainless butt weld", "3/8 inch stainless butt weld", "3 inch stainless butt weld"];
  const hits = rankEstimatorSearchItems(rows, buildEstimatorSearchProfile("3 inch stainless butt weld"), (row) => row);
  assert.equal(hits[0].item, rows[2]);
  assert.equal(hits[1].matchedTerms.includes("3"), false);
});

test("database stemming survives reranking; dimensional false positives do not", () => {
  const rows = [{ name: "Tapping holes", _indexedMatchedTerms: ["tap"] }, { name: "Tape adhesive", _indexedMatchedTerms: [] }];
  assert.deepEqual(rankIndexedCandidates(rows, buildEstimatorSearchProfile("tap"), (row) => row.name).map((hit) => hit.item.name), ["Tapping holes"]);
  assert.equal(rankIndexedCandidates([{ name: "3/4 inch", _indexedMatchedTerms: ["3"] }], buildEstimatorSearchProfile("3"), (row) => row.name).length, 0);
});

test("book snippets find the requested passage and retain table line breaks", () => {
  const text = "Preface and acknowledgements. ".repeat(80) + "\nDRILL AND TAP\nHole size | hours per hole\n1/4 inch | 0.004\n" + "Other chapters. ".repeat(80);
  const excerpt = searchExcerpt(text, "drill tap hours hole 1/4 inch", 500);
  assert.match(excerpt, /DRILL AND TAP\nHole size/);
  assert.match(excerpt, /0\.004/);
  assert.ok(excerpt.length < 510);
});

test("multi-term intent outranks an isolated rare word; numeric codes do not masquerade as sizes", () => {
  const rows = [
    { name: "Adhesive base", text: "adhesive base", _indexedMatchedTerms: ["adhesive"] },
    { name: "3/4 drill anchors", text: "3/4 drill anchors", _indexedMatchedTerms: ["anchor", "drill"] },
  ];
  assert.equal(rankIndexedCandidates(rows, buildEstimatorSearchProfile("adhesive anchor 3/4 drill epoxy"), (row) => row.text)[0].item.name, rows[1].name);
  const coded = [{ name: "3/4 inch", code: "item-3-4", _indexedMatchedTerms: ["3", "inch"] }];
  assert.equal(rankIndexedCandidates(coded, buildEstimatorSearchProfile("3 inch"), (row) => `${row.name} ${row.code}`, (row) => row.name, (row) => row.name)[0].matchedTerms.includes("3"), false);
});

test("numeric identifiers stay whole and unrelated word prefixes do not count", () => {
  assert.equal(rankEstimatorSearchItems(["304L alloy", "304 cost"], buildEstimatorSearchProfile("304L"), (row) => row)[0].item, "304L alloy");
  assert.equal(rankEstimatorSearchItems(["butterfly valve"], buildEstimatorSearchProfile("butt weld"), (row) => row).length, 0);
});


test("standard stemming finds the source table over a contents entry", () => {
  const pages = ["Contents: Drilling Holes 50", "Drilling holes in plate. If holes are tapped, add a factor. Hole size and hours."];
  assert.equal(rankEstimatorSearchItems(pages, buildEstimatorSearchProfile("drill tap holes"), (row) => row)[0].item, pages[1]);
});

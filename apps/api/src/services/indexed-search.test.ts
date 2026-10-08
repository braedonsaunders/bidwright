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

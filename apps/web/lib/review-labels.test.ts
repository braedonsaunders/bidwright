import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewLabelIndex, segmentReviewText } from "./review-labels";

const SOURCES = {
  worksheets: [{
    id: "ws-11112222-3333-4444-5555-666677778888",
    name: "Valves",
    items: [
      { id: "li-2830cf0b-b0a4-49e1-8db8-d8030745e8f3", entityName: "Material" },
      { id: "li-871da7c8-6539-4ed0-a7b9-7933d965e7fc", entityName: "", description: "Crane Supply placeholder" },
    ],
  }],
  sourceDocuments: [{ id: "doc-2104cf37-2b94-4cb2-a4e3-20ecd2a046f9", fileName: "file/M-E012-0727.nwd" }],
  knowledgeBooks: [{ id: "kb-29e8c125-9413-4d53-8290-8424c66b45d4", name: "Pipe Fitters Handbook" }],
  datasets: [{ id: "ds-9f87cb2a-c384-4300-a280-6f627db1c0aa", name: "Weld productivity" }],
};

test("abbreviated ids in review prose resolve to record names", () => {
  const index = buildReviewLabelIndex(SOURCES);

  // The agent writes only the first segment of the id.
  const segments = segmentReviewText(
    "The two placeholder lines (Howell li-2830cf0b and Crane Supply li-871da7c8) are carried at $0.",
    index,
  );
  const labels = segments.filter((segment) => segment.type === "label");
  assert.equal(labels.length, 2);
  assert.equal(labels[0].label.label, "Material — Valves", "qualifies a generic line name with its worksheet");
  assert.equal(labels[1].label.label, "Crane Supply placeholder — Valves", "falls back to the description");
  assert.equal(labels[0].label.kind, "line");

  // Surrounding prose is preserved exactly.
  assert.equal(
    segments.map((segment) => (segment.type === "text" ? segment.value : segment.value)).join(""),
    "The two placeholder lines (Howell li-2830cf0b and Crane Supply li-871da7c8) are carried at $0.",
  );
});

test("documents, books and datasets resolve, and storage paths are stripped", () => {
  const index = buildReviewLabelIndex(SOURCES);
  const resolve = (text: string) => {
    const found = segmentReviewText(text, index).find((segment) => segment.type === "label");
    return found && found.type === "label" ? found.label.label : null;
  };

  assert.equal(resolve("see doc-2104cf37"), "M-E012-0727.nwd", "drops the storage path prefix");
  assert.equal(resolve("per kb-29e8c125 chapter 4"), "Pipe Fitters Handbook");
  assert.equal(resolve("from ds-9f87cb2a"), "Weld productivity");
  assert.equal(resolve("full id doc-2104cf37-2b94-4cb2-a4e3-20ecd2a046f9"), "M-E012-0727.nwd", "matches full ids too");
});

test("unknown ids and ordinary prose are left untouched", () => {
  const index = buildReviewLabelIndex(SOURCES);

  const unknown = segmentReviewText("carried on li-deadbeef with no record", index);
  assert.deepEqual(unknown, [{ type: "text", value: "carried on li-deadbeef with no record" }]);

  // Estimating prose is full of hyphenated codes that must not be mangled.
  const prose = "3\"P-150S1-9002 spool, ASME B16.5 flanges, 150 LB";
  assert.deepEqual(segmentReviewText(prose, index), [{ type: "text", value: prose }]);

  assert.deepEqual(segmentReviewText("", index), []);
  assert.deepEqual(segmentReviewText("no index", new Map()), [{ type: "text", value: "no index" }]);
});

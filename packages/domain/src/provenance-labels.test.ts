import assert from "node:assert/strict";
import test from "node:test";

import {
  findProvenanceIds,
  humanizeProvenanceIds,
  resolveTruncatedId,
} from "./provenance-labels.js";

test("finds truncated ids the agent actually writes", () => {
  // Verbatim from a prod worksheet item.
  const notes = "350 LF high-level 8 in storm @1%, claim-storm. $21.90/LF Sch40 list, ds-fb7262c3.";
  assert.deepEqual(findProvenanceIds(notes).map((t) => t.raw), ["ds-fb7262c3"]);
});

test("finds full uuids and plugin-style ids too", () => {
  const notes = "322 x 0.547161 hr/weld (lu-plugin-shop-pipe-2-butt-weld-stainless), ds-c40dad50-003d-4e8c-abba-8a36d345b3bc";
  assert.deepEqual(findProvenanceIds(notes).map((t) => t.raw), [
    "lu-plugin-shop-pipe-2-butt-weld-stainless",
    "ds-c40dad50-003d-4e8c-abba-8a36d345b3bc",
  ]);
});

test("de-duplicates repeated citations", () => {
  const notes = "ds-c40dad50 for ells, ds-c40dad50 for tees";
  assert.equal(findProvenanceIds(notes).length, 1);
});

test("replaces ids with names", () => {
  const notes = "$21.90/LF Sch40 list, ds-fb7262c3.";
  const names = new Map([["ds-fb7262c3", "PVC Schedule 40 Pipe and Standard Fittings - List Prices"]]);
  assert.equal(
    humanizeProvenanceIds(notes, names),
    "$21.90/LF Sch40 list, PVC Schedule 40 Pipe and Standard Fittings - List Prices.",
  );
});

test("an unresolvable id is left as written, not deleted", () => {
  // Losing it entirely would destroy the only clue for debugging a bad cite.
  const notes = "From ds-deadbeef basis.";
  assert.equal(humanizeProvenanceIds(notes, new Map()), "From ds-deadbeef basis.");
});

test("leaves non-citation text alone", () => {
  for (const text of ["24 ends x 2.8 hr/end = 67 hr.", "", "claim-39db15f58413 only"]) {
    assert.equal(humanizeProvenanceIds(text, new Map()), text);
  }
});

test("a truncated id resolves against the full id", () => {
  const ids = [
    "ds-fb7262c3-19ed-4b62-8c68-f44f07bf0326",
    "ds-c40dad50-003d-4e8c-abba-8a36d345b3bc",
  ];
  assert.equal(resolveTruncatedId("ds-fb7262c3", ids), ids[0]);
  assert.equal(resolveTruncatedId(ids[1], ids), ids[1], "an exact id resolves to itself");
});

test("an ambiguous abbreviation is refused rather than guessed", () => {
  // Citing the wrong dataset is worse than citing an opaque one.
  const ids = ["ds-ab12-one", "ds-ab12-two"];
  assert.equal(resolveTruncatedId("ds-ab12", ids), null);
});

test("an abbreviation matching nothing resolves to null", () => {
  assert.equal(resolveTruncatedId("ds-nope", ["ds-fb7262c3-19ed"]), null);
});

test("multiple ids in one note are all replaced", () => {
  const notes = "24 ends x 2.8 hr/end (ds-1a7a903e Sch80 ≤2in), handling lu-60f42aa6.";
  const names = new Map([
    ["ds-1a7a903e", "Hydrostatic Testing of Plain or Beveled Ends - Scheduled"],
    ["lu-60f42aa6", '3" or less'],
  ]);
  assert.equal(
    humanizeProvenanceIds(notes, names),
    '24 ends x 2.8 hr/end (Hydrostatic Testing of Plain or Beveled Ends - Scheduled Sch80 ≤2in), handling 3" or less.',
  );
});

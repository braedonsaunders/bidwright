import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEstimatorSearchProfile,
  datasetRowIdentityText,
  datasetValueMatchesFilter,
  estimatorSearchTokens,
  rankEstimatorSearchItems,
} from "./services/estimator-search.js";

test("structured search retains one-digit sizes and does not confuse 3 with 30", () => {
  assert.deepEqual(estimatorSearchTokens("3 inch butt weld"), ["3", "inch", "butt", "weld"]);

  const profile = buildEstimatorSearchProfile("3 inch butt weld");
  const rows = [
    { NominalDiameter: "30", Description: "butt weld" },
    { NominalDiameter: "30", NumberOfPasses: 3, Description: "butt weld" },
    { NominalDiameter: "3", Description: "butt weld" },
  ];
  const ranked = rankEstimatorSearchItems(
    rows,
    profile,
    (row) => JSON.stringify(row),
    (row) => datasetRowIdentityText(row),
  );

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].item.NominalDiameter, "3");
  assert.equal(ranked[0].anchorMatches, 1);
  assert.equal(ranked[2].item.NominalDiameter, "30");
  assert.equal(ranked[2].anchorMatches, 0);
});

test("typed dataset equality matches equivalent numeric strings without broad text matching", () => {
  assert.equal(datasetValueMatchesFilter("3", { column: "NominalDiameter", op: "eq", value: 3 }), true);
  assert.equal(datasetValueMatchesFilter("30", { column: "NominalDiameter", op: "eq", value: 3 }), false);
  assert.equal(datasetValueMatchesFilter(3.5, { column: "ActualSize", op: "gte", value: "3" }), true);
});

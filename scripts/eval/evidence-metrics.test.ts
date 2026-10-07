import assert from "node:assert/strict";
import { test } from "node:test";
import { evidenceMetrics } from "./evidence-metrics.js";
test("unknown or absent view ids cannot earn evidence coverage", () => {
  const item = (id: string, refs: string[]) => ({ id, name: "Anchor", evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: refs } } });
  const result = evidenceMetrics({ worksheets: [{ items: [item("1", ["v"]), item("2", ["fake"]), item("3", [])] }] }, [{ id: "v", imageHash: "hash" }]);
  assert.equal(result.groundedDrawingCoverage, 1 / 3);
  assert.deepEqual(result.unsupported, ["2", "3"]);
  assert.equal(result.anchorRows.length, 3);
});

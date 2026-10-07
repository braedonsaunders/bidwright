import assert from "node:assert/strict";
import { test } from "node:test";
import { drawingToolEvidence } from "./drawing-tool-evidence.js";

test("persisted MCP content recovers exact view after image bytes are stripped", () => {
  const payload = { content: [
    { type: "image", data: "[stripped]", mimeType: "image/png" },
    { type: "text", text: JSON.stringify({ viewId: "view-abc", documentId: "doc-1", pageNumber: 4, bbox: { x: 0.2, y: 0.3, width: 0.1, height: 0.2 }, imageWidth: 1568, imageHeight: 900 }) },
  ] };
  assert.deepEqual(drawingToolEvidence(JSON.stringify(payload)), {
    viewId: "view-abc", documentId: "doc-1", pageNumber: 4, bbox: { x: 0.2, y: 0.3, width: 0.1, height: 0.2 }, imageWidth: 1568, imageHeight: 900, dpi: undefined,
  });
});

test("does not promote arbitrary region ids or discarded images into views", () => {
  assert.equal(drawingToolEvidence({ regionId: "region-1", image: "[stripped]" }), null);
  assert.equal(drawingToolEvidence({ content: [{ type: "text", text: "rendered and visually inspected" }] }), null);
  assert.equal(drawingToolEvidence({ viewId: null }), null);
});

test("uses request page for legacy tools without inventing bbox coordinates", () => {
  const evidence = drawingToolEvidence({ result: { viewId: "view-legacy" } }, { documentId: "doc-2", pageNumber: 3, bbox: { x: 0, y: 0, width: 200, height: 200 } });
  assert.equal(evidence?.pageNumber, 3);
  assert.equal(evidence?.documentId, "doc-2");
  assert.equal(evidence?.bbox, undefined);
});

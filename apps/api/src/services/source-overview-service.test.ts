import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSourceOverview } from "./source-overview-service.js";

test("overview joins Documents and Files without inventing scan, unit or human provenance facts", () => {
  const overview = buildSourceOverview({
    sources: [
      { id: "doc", name: "plan.pdf", source: "document", documentId: "doc", fileType: "pdf", facts: { pages: 2, positionedTextAvailable: true, cadStatus: null } },
      { id: "alias", name: "plan.pdf", source: "file", documentId: "doc", fileType: "pdf", facts: {} },
      { id: "ifc", name: "structure.ifc", source: "file", documentId: null, fileType: "ifc", facts: {} },
      { id: "zip-child", name: "extracted.step", source: "file", documentId: null, fileType: "step", facts: {} },
    ],
    models: [{ id: "model", sourceDocumentId: null, fileNodeId: "ifc", status: "partial", units: "model", facts: { schema: "IFC4", elementCount: 10, qtoElementCount: 4 } }],
    pickups: [
      { documentId: "doc", pageNumber: 1, measuredBy: "person", count: 2, linked: 1, unlinked: 1 },
      { documentId: "doc", pageNumber: 1, measuredBy: "unrecorded", count: 3, linked: 0, unlinked: 3 },
      { documentId: "alias", pageNumber: 2, measuredBy: "agent", count: 1, linked: 1, unlinked: 0 },
    ],
    calibrations: { doc: { "1": { scale: 50 } } },
    documentProgress: [{ id: "doc", status: "complete", extractionProvider: "azure_di" }],
  });
  assert.equal(overview.sources.length, 3);
  assert.deepEqual(overview.sources[0].fileNodeIds, ["alias"]);
  assert.equal(overview.sources[0].kind, "pdf");
  assert.equal(overview.sources[0].extractionStatus, "complete");
  assert.equal(overview.sources[0].pickups, 6);
  assert.equal(overview.sources[0].humanPickups, 2);
  assert.equal(overview.sources[1].models[0].units, "unknown");
  assert.equal(overview.sources[1].models[0].qtoCoveragePercent, 40);
  assert.equal(overview.sources[2].kind, "step");
  assert.deepEqual(overview.takeoff.calibrations, { doc: { "1": { scale: 50 } } });
});

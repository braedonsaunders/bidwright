import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSourceOverview } from "./source-overview-service.js";
import { buildCompactClaudeMdContent } from "./claude-md-generator.js";

test("overview joins Documents and Files without inventing scan, unit or human provenance facts", () => {
  const overview = buildSourceOverview({
    sources: [
      { id: "doc", name: "plan.pdf", source: "document", documentId: "doc", fileType: "pdf", facts: { pages: 2, positionedTextAvailable: true, cadStatus: null } },
      { id: "alias", name: "plan.pdf", source: "file", documentId: "doc", fileType: "pdf", facts: {} },
      { id: "ifc", name: "structure.ifc", source: "file", documentId: null, fileType: "ifc", facts: {} },
      { id: "zip-child", name: "extracted.step", source: "file", documentId: null, fileType: "step", facts: {} },
      { id: "file-only", name: "scan.pdf", source: "file", documentId: null, fileType: "pdf", facts: {} },
    ],
    models: [{ id: "model", sourceDocumentId: null, fileNodeId: "ifc", status: "partial", units: "model", facts: { schema: "IFC4", elementCount: 10, qtoElementCount: 4 } }],
    pickups: [
      { documentId: "doc", pageNumber: 1, measuredBy: "person", count: 2, linked: 1, unlinked: 1 },
      { documentId: "doc", pageNumber: 1, measuredBy: "unrecorded", count: 3, linked: 0, unlinked: 3 },
      { documentId: "alias", pageNumber: 2, measuredBy: "agent", count: 1, linked: 1, unlinked: 0 },
      { documentId: "file-alias", pageNumber: 1, measuredBy: "unrecorded", count: 4, linked: 2, unlinked: 2 },
      { documentId: "file-file-only", pageNumber: 1, measuredBy: "person", count: 1, linked: 0, unlinked: 1 },
    ],
    calibrations: { doc: { "1": { scale: 50 } }, "file-alias": { "1": { scale: 20 } }, "file-file-only": { "2": { scale: 100 } } },
    documentProgress: [{ id: "doc", status: "complete", extractionProvider: "azure_di" }],
  });
  assert.equal(overview.sources.length, 4);
  assert.deepEqual(overview.sources[0].fileNodeIds, ["alias"]);
  assert.equal(overview.sources[0].kind, "pdf");
  assert.equal(overview.sources[0].extractionStatus, "complete");
  assert.equal(overview.sources[0].pickups, 10);
  assert.deepEqual(overview.sources[0].pickupCounts, { person: 2, agent: 1, unrecorded: 7 });
  assert.equal(overview.sources[1].models[0].units, "unknown");
  assert.equal(overview.sources[1].models[0].qtoCoveragePercent, 40);
  assert.equal(overview.sources[2].kind, "step");
  assert.deepEqual(overview.sources[0].calibrations, { doc: { "1": { scale: 50 } }, "file-alias": { "1": { scale: 20 } } });
  assert.deepEqual(overview.sources[3].calibrations, { "file-file-only": { "2": { scale: 100 } } });
  assert.equal(overview.sources[3].pickups, 1);
  assert.equal(overview.sources[3].facts.positionedTextAvailable, null);
  const brief = buildCompactClaudeMdContent({ projectDir: "/tmp/not-created", dataRoot: "/tmp", projectName: "Synthetic",
    clientName: "", location: "", scope: "", quoteNumber: "", documents: [], sourceOverview: overview });
  assert.match(brief, /pickups: 10 total \(2 person, 1 agent, 7 unrecorded\)/);
});

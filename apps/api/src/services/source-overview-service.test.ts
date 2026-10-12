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
    models: [{ id: "model", sourceDocumentId: null, fileNodeId: "ifc", status: "partial", units: "model", facts: { schema: "IFC4", elementCount: 10, estimateRelevantElementCount: 8, quantityElementCount: 4, quantityCount: 7, quantityMethods: { ifc_declared_quantity: 7 } } }],
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
  assert.equal(overview.sources[1].models[0].quantityCoveragePercent, 50);
  assert.equal(overview.sources[2].kind, "step");
  assert.equal(overview.sources[2].modelStatus, "not_ingested");
  assert.equal(overview.sources[2].modelIngestTool, "listModels");
  assert.equal(overview.sources[1].modelStatus, null);
  assert.deepEqual(overview.sources[0].calibrations, { doc: { "1": { scale: 50 } }, "file-alias": { "1": { scale: 20 } } });
  assert.deepEqual(overview.sources[3].calibrations, { "file-file-only": { "2": { scale: 100 } } });
  assert.equal(overview.sources[3].pickups, 1);
  assert.equal(overview.sources[3].facts.positionedTextAvailable, null);
  const brief = buildCompactClaudeMdContent({ projectDir: "/tmp/not-created", dataRoot: "/tmp", projectName: "Synthetic",
    clientName: "", location: "", scope: "", quoteNumber: "", documents: [], sourceOverview: overview });
  assert.match(brief, /STEP\/IGES model, not yet ingested \(listModels starts ingestion/);
  assert.match(brief, /IFC4, model partial, 10 elements, 7 quantities; 4 of 8 estimate-relevant elements have quantities \(50%\)/);
  assert.doesNotMatch(brief, /"models":|"positionedTextAvailable":|pdf, pdf/);
  for (const tool of ["aggregateModelElements", "queryCadEntities", "measureTakeoff", "getPipingMto"]) assert.ok(brief.includes(tool));
  assert.match(brief, /10 takeoff marks \(2 person, 1 agent, 7 unrecorded\)/);
});


test("APS quantities count toward coverage in the overview and brief without IFC Qto", () => {
  const overview = buildSourceOverview({
    sources: [{ id: "nwd", name: "plant.nwd", source: "document", documentId: "nwd", fileType: "nwd", facts: {} }],
    models: [{ id: "model", sourceDocumentId: "nwd", fileNodeId: null, status: "indexed", units: "ft", facts: {
      elementCount: 6831, estimateRelevantElementCount: 4408, quantityElementCount: 1980, quantityCount: 2529,
      qtoElementCount: 0, quantityMethods: { aps_model_derivative_property: 2529 },
    } }], pickups: [],
  });
  const model = overview.sources[0].models[0];
  assert.equal(model.quantityCoveragePercent, 1980 / 4408 * 100);
  assert.equal(model.quantitySources[0].label, "authored Navisworks properties");
  const brief = buildCompactClaudeMdContent({ projectDir: "/tmp/not-created", dataRoot: "/tmp", projectName: "Synthetic",
    clientName: "", location: "", scope: "", quoteNumber: "", documents: [], sourceOverview: overview });
  assert.match(brief, /6,831 elements, 2,529 quantities; 1,980 of 4,408 estimate-relevant elements have quantities \(44.9%\)/);
  assert.match(brief, /authored Navisworks properties \(2,529\)/);
  assert.doesNotMatch(brief, /quantities on 0%/);
});

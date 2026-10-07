import assert from "node:assert/strict";
import test from "node:test";
import {
  __setEvidenceViewFetcherForTests,
  validateLineEvidenceBasisForPricing,
  validateTraceableQuantityForPricing,
} from "./quote-tools.js";

/**
 * Guards the rules added after the Alexanderwerk/Servo-Lift quote
 * (JT-261002-0001), where 32 anchors were priced against a drawing note that
 * said "(1) 1" dia hole" per base plate, on a project whose only SourceDocument
 * was an unexpanded ZIP:
 *   - the line-evidence gate runs on every project, not only ones with a
 *     drawing-typed SourceDocument;
 *   - assumptionIds must resolve to saved assumptions;
 *   - drawing-driven quantities cite viewIds the server actually delivered;
 *   - drawing-driven quantities carry a derivation that reproduces the row;
 *   - per-instance inputs are checked against explicit callouts in cited text;
 *   - large assumption-based quantities need an askUser confirmation.
 */

const zipOnlyWorkspace = {
  sourceDocuments: [
    { id: "doc_zip", fileName: "RE__RFQ.zip", fileType: "zip", documentType: "reference", checksum: "zip-v1" },
    { id: "doc_platform", fileName: "2025-05-26 Layouts and Platforms-Signed.pdf", fileType: "pdf", documentType: "drawing", checksum: "platform-v1" },
  ],
  entityCategories: [
    { id: "ecat-material", name: "Material", entityType: "Material" },
    { id: "ecat-labour", name: "Labour", entityType: "Labour" },
  ],
};

const strategy = {
  assumptions: [{ id: "A1", statement: "Platform arrives prefabricated." }],
  summary: { drawingEvidenceEngine: { claims: [] } },
};

const platformNote = '8x8x5/8" Base Plate c/w (1) 1" dia hole for 3/4" SS epoxy anchor. 1" epoxy grout.';

function anchorDerivation(anchorsPerPlate: number, plates = 6) {
  return {
    formula: "basePlates * anchorsPerPlate",
    inputs: [
      { name: "basePlates", value: plates, unit: "EA", source: { kind: "view", ref: "view-plan", excerpt: "4 main posts + 2 landing posts" } },
      { name: "anchorsPerPlate", value: anchorsPerPlate, unit: "EA", perInstance: true, instanceOf: "base plate", source: { kind: "view", ref: "view-detail", excerpt: platformNote } },
    ],
    result: { value: plates * anchorsPerPlate, unit: "EA" },
  };
}

test.beforeEach(() => {
  __setEvidenceViewFetcherForTests(async (ids) => ({
    views: ids
      .filter((id) => id === "view-plan" || id === "view-detail")
      .map((id) => ({ id, documentId: "doc_platform", sourceChecksum: "platform-v1", pageNumber: 4, tool: "readDrawingTile", imageHash: "abc", textSnippet: id === "view-detail" ? platformNote : "" })),
    missingIds: ids.filter((id) => id !== "view-plan" && id !== "view-detail"),
  }));
});

test.afterEach(() => __setEvidenceViewFetcherForTests(null));

// ── gate runs regardless of the drawing classifier ────────────────────────

test("a row with no evidence basis is rejected even when no SourceDocument is typed drawing", () => {
  const error = validateLineEvidenceBasisForPricing(zipOnlyWorkspace, {
    evidenceBasis: null,
    sourceNotes: "32 anchors per base plate detail",
    categoryId: "ecat-material",
  });
  assert.ok(error, "ZIP-only project must still require an evidence basis");
  assert.match(error!, /evidence basis is required on every priced row/i);
});

test("assumptionIds must resolve to saved assumptions", () => {
  const unresolved = validateLineEvidenceBasisForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "assumption", assumptionIds: ["A9"] }, pricing: { type: "allowance", rationale: "Allowance pending Hilti quote, confirmed by procurement." } },
    sourceNotes: "Allowance for anchors pending vendor quote from Hilti Canada.",
    categoryId: "ecat-material",
    strategy,
  });
  assert.match(unresolved!, /assumptionIds not found among saved assumptions: A9/);

  const resolved = validateLineEvidenceBasisForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "assumption", assumptionIds: ["A1"] }, pricing: { type: "allowance", assumptionIds: ["A1"], rationale: "Allowance pending Hilti quote, confirmed by procurement." } },
    sourceNotes: "Allowance for anchors pending vendor quote from Hilti Canada.",
    categoryId: "ecat-material",
    strategy,
  });
  assert.equal(resolved, null);
});

// ── drawing-driven quantities need viewed pixels + a derivation ───────────

test("a drawing-driven quantity without viewIds is rejected", async () => {
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", drawingClaimIds: ["claim-abcdef123456"] }, pricing: { type: "allowance" } },
    quantity: 32,
    strategy,
  });
  assert.match(error!, /requires evidenceBasis\.quantity\.viewIds/);
});

test("viewIds the server never delivered are rejected", async () => {
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-made-up"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 6,
    strategy,
  });
  assert.match(error!, /viewIds not found for this project: view-made-up/);
});

test("the view service being unavailable fails closed", async () => {
  __setEvidenceViewFetcherForTests(async () => ({ error: "API GET /api/vision/views failed: 503" }));
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 6,
    strategy,
  });
  assert.match(error!, /Could not verify .*viewIds/);
});

test("a drawing-driven quantity without a derivation is rejected", async () => {
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan"] }, pricing: { type: "allowance" } },
    quantity: 6,
    strategy,
  });
  assert.match(error!, /need a derivation/);
});

test("a derivation that does not reproduce the row quantity is rejected", async () => {
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan", "view-detail"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 32,
    strategy,
  });
  assert.match(error!, /Derivation is not valid/);
  assert.match(error!, /produces 6 but the row quantity is 32/);
});

// ── the anchor case itself ────────────────────────────────────────────────

test("4 anchors per plate is rejected when the cited view text says (1) hole", async () => {
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan", "view-detail"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(4),
    quantity: 24,
    strategy,
  });
  assert.ok(error);
  assert.match(error!, /Per-instance contradiction/);
  assert.match(error!, /anchorsPerPlate' = 4/);
  assert.match(error!, /\(1\)/);
});

test("the contradiction is caught from the agent's own excerpt even without a view snippet", async () => {
  __setEvidenceViewFetcherForTests(async (ids) => ({
    views: ids.map((id) => ({ id, documentId: "doc_platform", sourceChecksum: "platform-v1", pageNumber: 4, tool: "readDrawingTile", imageHash: "x", textSnippet: "" })),
    missingIds: [],
  }));
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(4),
    quantity: 24,
    strategy,
  });
  assert.match(error!, /Per-instance contradiction/);
});

test("1 anchor per plate across 6 viewed base plates passes", async () => {
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan", "view-detail"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 6,
    strategy,
  });
  assert.equal(error, null);
});

// ── assumption-based quantities above threshold need confirmation ─────────

test("a large assumption-based quantity needs an askUser confirmation", async () => {
  const basis = { quantity: { type: "assumption", assumptionIds: ["A1"] }, pricing: { type: "allowance" } };
  const blocked = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: basis,
    quantity: 1,
    cost: 25000,
    strategy,
  });
  assert.match(blocked!, /assumption-based and the row is significant/);

  const confirmed = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { ...basis, quantity: { ...basis.quantity, userConfirmation: { questionId: "ask-1", answer: "Carry $25k allowance" } } },
    quantity: 1,
    cost: 25000,
    strategy,
  });
  assert.equal(confirmed, null);

  const small = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: basis,
    quantity: 8,
    cost: 95,
    strategy,
  });
  assert.equal(small, null, "small assumption rows do not need confirmation");
});

test("rate-schedule hours above the threshold also need confirmation", async () => {
  const blocked = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "assumption", assumptionIds: ["A1"] }, pricing: { type: "rate_schedule" } },
    quantity: 2,
    tierUnits: { "rst-trade": 20 },
    strategy,
  });
  assert.match(blocked!, /40 h/);
});

// ── views are evidence for one document version only ─────────────────────

test("a view rendered from an earlier version of the document is rejected", async () => {
  __setEvidenceViewFetcherForTests(async (ids) => ({
    views: ids.map((id) => ({ id, documentId: "doc_platform", sourceChecksum: "platform-v0", pageNumber: 4, tool: "readDrawingTile", imageHash: "old", textSnippet: platformNote })),
    missingIds: [],
  }));
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 6,
    strategy,
  });
  assert.match(error!, /earlier version of "2025-05-26 Layouts and Platforms-Signed.pdf"/);
  assert.match(error!, /source checksum changed/);
});

test("a view whose source document was replaced or removed is rejected", async () => {
  __setEvidenceViewFetcherForTests(async (ids) => ({
    views: ids.map((id) => ({ id, documentId: "doc_gone", sourceChecksum: "x", pageNumber: 1, tool: "readDrawingPage", imageHash: "h", textSnippet: "" })),
    missingIds: [],
  }));
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 6,
    strategy,
  });
  assert.match(error!, /no longer a source document in this project/);
});

test("a view of the current document version passes the staleness check", async () => {
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan", "view-detail"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 6,
    strategy,
  });
  assert.equal(error, null);
});

test("a Files-area-only view with no source document identity fails closed with the promotion action", async () => {
  __setEvidenceViewFetcherForTests(async (ids) => ({
    views: ids.map((id) => ({ id, documentId: null, fileNodeId: "fn-2f6e3094", sourceChecksum: null, pageNumber: 4, tool: "readDrawingTile", imageHash: "h", textSnippet: platformNote })),
    missingIds: [],
  }));
  const error = await validateTraceableQuantityForPricing(zipOnlyWorkspace, {
    evidenceBasis: { quantity: { type: "drawing_quantity", viewIds: ["view-plan"] }, pricing: { type: "allowance" } },
    derivation: anchorDerivation(1),
    quantity: 6,
    strategy,
  });
  assert.match(error!, /not a registered source document/);
  assert.match(error!, /fn-2f6e3094/);
  assert.match(error!, /promotePdfToDrawingEvidence/);
});

// ── declared installed/procurement links ──────────────────────────────────

const workspaceWithLabourRow = {
  ...zipOnlyWorkspace,
  worksheets: [{
    id: "ws-platform",
    name: "Work Platform",
    items: [{
      id: "li-labour",
      entityName: "Drill and set anchors",
      quantity: 2,
      uom: "HR",
      derivation: {
        version: 1,
        target: "tierUnits",
        formula: "anchors * hoursPerAnchor",
        inputs: [
          { name: "anchors", value: 32, unit: "EA", source: { kind: "view", ref: "view-plan" } },
          { name: "hoursPerAnchor", value: 0.375, unit: "HR", source: { kind: "laborUnit", ref: "lu-1" } },
        ],
        result: { value: 12, unit: "HR" },
        status: "draft",
      },
    }],
  }],
};

const rodDerivation = (packs: number, extra: Record<string, unknown> = {}) => ({
  formula: "packs",
  inputs: [{ name: "packs", value: packs, unit: "PK", source: { kind: "manual", ref: "estimator" }, note: "Hilti HAS-R sold in packs of 10 rods per distributor listing." }],
  result: { value: packs, unit: "PK" },
  procurement: { suppliesItemId: "li-labour", installedFromInput: "anchors", packSize: 10, ...extra },
});

test("regression: a material row buying 2 x 10 rods for a labour row installing 32 is rejected", async () => {
  const error = await validateTraceableQuantityForPricing(workspaceWithLabourRow, {
    evidenceBasis: { quantity: { type: "document_quantity", sourceRefs: ["doc_platform"] }, pricing: { type: "material_quote", sourceRefs: ["https://example.com/has-r"] } },
    derivation: rodDerivation(2),
    quantity: 2,
    uom: "PK",
    strategy,
  });
  assert.match(error!, /does not reconcile/);
  assert.match(error!, /32 installed via linked_input/);
  assert.match(error!, /supplies 20 but 32/);
  assert.match(error!, /short by 12/);
  assert.match(error!, /Buy at least 4/);
});

test("4 packs of 10 for 32 installed reconciles", async () => {
  const error = await validateTraceableQuantityForPricing(workspaceWithLabourRow, {
    evidenceBasis: { quantity: { type: "document_quantity", sourceRefs: ["doc_platform"] }, pricing: { type: "material_quote", sourceRefs: ["https://example.com/has-r"] } },
    derivation: rodDerivation(4),
    quantity: 4,
    uom: "PK",
    strategy,
  });
  assert.equal(error, null);
});

test("one cartridge for 5 anchors passes only with an explained surplus", async () => {
  const basis = { quantity: { type: "document_quantity", sourceRefs: ["doc_platform"] }, pricing: { type: "material_quote", sourceRefs: ["https://example.com/hy200"] } };
  const cartridge = (surplusRationale?: string) => ({
    formula: "cartridges",
    inputs: [{ name: "cartridges", value: 1, unit: "CARTRIDGE", source: { kind: "web", ref: "https://example.com/hy200", excerpt: "~19 anchors per 330 ml cartridge" } }],
    result: { value: 1, unit: "CARTRIDGE" },
    procurement: { installedQuantity: 5, installedUom: "EA", packSize: 19, ...(surplusRationale ? { surplusRationale } : {}) },
  });
  const unexplained = await validateTraceableQuantityForPricing(workspaceWithLabourRow, { evidenceBasis: basis, derivation: cartridge(), quantity: 1, uom: "CARTRIDGE", strategy });
  assert.match(unexplained!, /surplusRationale/);
  const explained = await validateTraceableQuantityForPricing(workspaceWithLabourRow, { evidenceBasis: basis, derivation: cartridge("Minimum purchase is one 330 ml cartridge; remainder is spares."), quantity: 1, uom: "CARTRIDGE", strategy });
  assert.equal(explained, null);
});

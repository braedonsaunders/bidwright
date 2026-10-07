import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  __setEvidenceViewFetcherForTests,
  validateLineEvidenceBasisForPricing,
  validateTraceableQuantityForPricing,
} from "./quote-tools.js";

/**
 * Replays GPT-6.1 Sol's exact batchEditWorksheetItems rows from the 2026-10-07
 * matrix run (clone project-4a37d318). Arguments are copied verbatim from the
 * Codex rollout, not from the truncated event previews. Each was rejected by
 * an app gate while its inputs were honest:
 *   - a $0 fabrication-by-others LS placeholder (composite LS rule);
 *   - a client-fixed $25,000 LS allowance (composite LS rule);
 *   - deck-fastening labour whose "baseDrillHoursPerHole = 0.24 HR/EA" rate was
 *     compared with the drawing's "(1) 1\" dia hole" callout.
 */

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/gpt-matrix-2026-10-07-rows.json", import.meta.url), "utf8"));
const strategy = { assumptions: fixture.assumptions, summary: { drawingEvidenceEngine: { claims: [] } } };
const PLATFORM_DOC = "doc_f14748c7-4b90-487e-b4b1-897fcddd37e5";
const ws = {
  sourceDocuments: [{ id: PLATFORM_DOC, fileName: "2025-05-26-Layouts-and-Platforms-Signed.pdf", fileType: "pdf", documentType: "drawing", checksum: "platform" }],
  entityCategories: [
    { id: "ecat-sub", name: "Subcontractor", entityType: "Subcontractor" },
    { id: "ecat-labour", name: "Labour", entityType: "Labour" },
    { id: "ecat-material", name: "Material", entityType: "Material" },
  ],
};
// Text the server held for view-40fa7a7b (readDrawingTile textLines, coordinates stripped).
const VIEW_TEXT = '8x8x5 8" Base Plate c/w (1) 1" dia hole for 3 4" SS epoxy anchor 1" epoxy grout';

function lineInput(op: any) {
  const item = op.item ?? op;
  return { ...item, strategy };
}

test.beforeEach(() => {
  __setEvidenceViewFetcherForTests(async (ids) => ({
    views: ids.map((id) => ({ id, documentId: PLATFORM_DOC, sourceChecksum: "platform", pageNumber: 4, tool: "readDrawingTile", imageHash: "h", textSnippet: id.startsWith("view-40fa") ? VIEW_TEXT : "" })),
    missingIds: [],
  }));
});
test.afterEach(() => __setEvidenceViewFetcherForTests(null));

test("fixture holds the full rollout arguments, not event previews", () => {
  const text = JSON.stringify(fixture);
  assert.ok(!text.includes("…"), "no preview ellipses");
  assert.equal(fixture.zeroFabricationPlaceholder.item.cost, 0);
  assert.equal(fixture.clientFixedAllowance25k.item.cost, 25000);
  assert.equal(fixture.deckFasteningLabour.item.derivation.inputs[1].name, "baseDrillHoursPerHole");
  assert.ok(fixture.assumptions.some((a: any) => a.id === "A-INTERFACES"));
});

test("GPT's $0 fabrication-by-others placeholder passes the line evidence gate", () => {
  assert.equal(validateLineEvidenceBasisForPricing(ws, lineInput(fixture.zeroFabricationPlaceholder)), null);
});

test("GPT's client-fixed $25,000 allowance passes the line evidence gate", () => {
  assert.equal(validateLineEvidenceBasisForPricing(ws, lineInput(fixture.clientFixedAllowance25k)), null);
});

test("GPT's deck-fastening labour row is not rejected for an hours-per-hole rate", async () => {
  const input = lineInput(fixture.deckFasteningLabour);
  const error = await validateTraceableQuantityForPricing(ws, input);
  assert.doesNotMatch(error ?? "", /Per-instance contradiction/);
});

test("the same labour row with a real per-plate count that disagrees with the drawing is still rejected", async () => {
  const input = lineInput(structuredClone(fixture.deckFasteningLabour));
  input.derivation.inputs.push({ name: "holesPerPlate", value: 4, unit: "EA", source: { kind: "view", ref: "view-40fa7a7b-f3b1-4827-9f63-08896f5c05a6" } });
  input.derivation.formula = "(installedDeckFastenings * baseDrillHoursPerHole) * installationPackages";
  const error = await validateTraceableQuantityForPricing(ws, input);
  assert.match(error ?? "", /Per-instance contradiction: derivation input 'holesPerPlate' = 4/);
});

test("GPT's applied 96 h erection row is flagged assumption-dominated by the quality rule, without blocking", async () => {
  const { validateEstimateWorkspace } = await import("@bidwright/domain");
  const item = fixture.platformErectionLabourApplied.item;
  // GPT sent status "reviewed". The API now stores agent-written derivations
  // with assumed inputs as "draft" (prepareDerivationForWrite), so that is the
  // persisted state the quality rule sees.
  assert.equal(item.derivation.status, "reviewed");
  item.derivation = { ...item.derivation, status: "draft" };
  const workspace = {
    worksheets: [{ id: item.worksheetId, name: "Platform", items: [{ id: "li-erection", worksheetId: item.worksheetId, entityName: item.entityName, category: item.category, quantity: item.quantity, uom: item.uom, tierUnits: item.tierUnits, sourceNotes: item.sourceNotes, derivation: item.derivation }] }],
  };
  const result = validateEstimateWorkspace(workspace as any, { ruleIds: ["worksheet.evidence.assumed_derivation_unreviewed"] } as any);
  const issue = result.issues.find((entry: any) => entry.ruleId === "worksheet.evidence.assumed_derivation_unreviewed");
  assert.ok(issue, JSON.stringify(result.issues).slice(0, 400));
  assert.equal(issue!.severity, "warning", "visible, never error/critical, so a draft still saves and finalize is not blocked");
  assert.match(issue!.message, /crewMembers, crewDays, hoursPerDay/);
});

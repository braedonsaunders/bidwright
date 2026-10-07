import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveClaimEvidenceViews, validateClaimEvidence } from "./drawing-evidence-tools.js";
import { __setEvidenceViewFetcherForTests, validateVisualTakeoffAuditWithNativeViews } from "./quote-tools.js";

/**
 * The native drawing workflow (readDrawingPage / readDrawingTile /
 * inspectDrawingRegion, each recorded server-side as an EvidenceView) must be
 * accepted on its own terms, without the model inventing legacy tool calls.
 * Inputs are GPT-6.1 Sol's own, from the 2026-10-07 matrix Codex rollout.
 */

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/gpt-matrix-2026-10-07-rows.json", import.meta.url), "utf8"));
const TILE = "view-e65fed29-0eb3-4b9d-b7e2-7eb9574fcd36";
const PAGE = "view-page4-overview-000000000000";
const PLATFORM_DOC = "doc_f14748c7-4b90-487e-b4b1-897fcddd37e5";
const serverViews: Record<string, any> = {
  [TILE]: { id: TILE, documentId: PLATFORM_DOC, pageNumber: 4, tool: "readDrawingTile", imageHash: "f9617209799dc00183b334012dc1a640276e03ebf8df9c809e2ebbc9c9444561", bbox: { x: 0.03, y: 0.07, width: 0.31, height: 0.49 } },
  [PAGE]: { id: PAGE, documentId: PLATFORM_DOC, pageNumber: 4, tool: "readDrawingPage", imageHash: "2d796f7d52ce4dd0005e0e35b2aa8c9e3371a44e76a523ba9049a82ba02b7e14", bbox: null },
};
const fetchServerViews = async (ids: string[]) => ids.map((id) => serverViews[id]).filter(Boolean);

// ── claims ────────────────────────────────────────────────────────────────

test("GPT's tile-backed '5 base plates' claim was unsaveable as sent: no imageHash, tile not a crop tool", () => {
  const failures = validateClaimEvidence(fixture.tileVisualCountClaim);
  assert.ok(failures.some((failure) => /needs the viewId/.test(failure)), failures.join(" | "));
});

test("the same claim saves once the server view fills imageHash, document, page and tool", async () => {
  const { evidence, failures } = await resolveClaimEvidenceViews(fixture.tileVisualCountClaim.evidence, fetchServerViews);
  assert.deepEqual(failures, []);
  assert.equal(evidence[0].imageHash, serverViews[TILE].imageHash);
  assert.equal(evidence[0].tool, "readDrawingTile");
  assert.deepEqual(validateClaimEvidence({ ...fixture.tileVisualCountClaim, evidence }), []);
});

test("a viewId the server never delivered is rejected, and an agent-supplied hash is not trusted", async () => {
  const forged = [{ ...fixture.tileVisualCountClaim.evidence[0], viewId: "view-made-up-0000", imageHash: "a".repeat(64) }];
  const { failures } = await resolveClaimEvidenceViews(forged, fetchServerViews);
  assert.match(failures.join(" "), /view-made-up-0000 was not delivered to this project/);
});

test("a view of a different document than the evidence names is rejected", async () => {
  const wrongDoc = [{ ...fixture.tileVisualCountClaim.evidence[0], documentId: "doc_other000000" }];
  const { failures } = await resolveClaimEvidenceViews(wrongDoc, fetchServerViews);
  assert.match(failures.join(" "), /cites document doc_other000000 but view/);
});

test("a full-page view is not accepted as visual-count crop evidence", async () => {
  const pageOnly = [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: PAGE, tool: "readDrawingPage", result: "5 columns" }];
  const { evidence } = await resolveClaimEvidenceViews(pageOnly, fetchServerViews);
  const failures = validateClaimEvidence({ ...fixture.tileVisualCountClaim, evidence });
  assert.ok(failures.some((failure) => /targeted crop/.test(failure)), failures.join(" | "));
});

test("a view lookup failure rejects the claim instead of trusting the agent's hash and tool", async () => {
  const plausible = [{ ...fixture.tileVisualCountClaim.evidence[0], imageHash: "f".repeat(64), tool: "inspectDrawingRegion" }];
  const { failures } = await resolveClaimEvidenceViews(plausible, async () => { throw new Error("503 Service Unavailable"); });
  assert.match(failures.join(" "), /Could not verify cited viewId\(s\) view-e65fed29/);
});

test("a full-page server view clears a caller-supplied bbox, so a page cannot pose as a crop", async () => {
  const posing = [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: PAGE, tool: "readDrawingTile", bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, imageHash: "e".repeat(64) }];
  const { evidence, failures } = await resolveClaimEvidenceViews(posing, fetchServerViews);
  assert.deepEqual(failures, []);
  assert.equal("bbox" in evidence[0], false);
  assert.equal(evidence[0].tool, "readDrawingPage");
  assert.equal(evidence[0].imageHash, serverViews[PAGE].imageHash);
  assert.ok(validateClaimEvidence({ ...fixture.tileVisualCountClaim, evidence }).some((failure) => /needs regionId or bbox|targeted crop/.test(failure)));
});

// ── visual takeoff audit ──────────────────────────────────────────────────

const ws = {
  sourceDocuments: [{ id: PLATFORM_DOC, fileName: "2025-05-26-Layouts-and-Platforms-Signed.pdf", fileType: "pdf", documentType: "drawing", checksum: "platform" }],
  aiRuns: [],
};
const rowBasis = { quantity: { type: "drawing_quantity", viewIds: [TILE] } };
// Atlas present, no usable claim yet: the audit's own page/crop checks run.
const strategyFor = (pkg: Record<string, unknown>) => ({
  scopeGraph: { visualTakeoffAudit: { completedBeforePricing: true, drawingDrivenPackages: [{ packageId: "platform", ...pkg }] } },
  summary: { drawingEvidenceEngine: { atlas: { status: "ready", regionCount: 33 }, claims: [] } },
});
const NATIVE_AUDIT_ERRORS = /Missing atlas\/page evidence|Missing targeted crop evidence|Page evidence does not match|Zoom evidence does not match|No actual atlas\/render evidence|only overview evidence/;

test.beforeEach(() => {
  __setEvidenceViewFetcherForTests(async (ids) => ({ views: ids.map((id) => serverViews[id]).filter(Boolean), missingIds: ids.filter((id) => !serverViews[id]) }));
});
test.afterEach(() => __setEvidenceViewFetcherForTests(null));

test("an actual page overview plus an actual tile satisfies the audit's page and crop checks", async () => {
  const error = await validateVisualTakeoffAuditWithNativeViews(ws, strategyFor({
    renderedPages: [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: PAGE }],
    zoomEvidence: [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: TILE, region: { x: 0.03, y: 0.07, width: 0.31, height: 0.49 } }],
  }), "", rowBasis);
  // The next gate (the claim ledger) still applies; the audit itself is satisfied.
  assert.doesNotMatch(error ?? "", NATIVE_AUDIT_ERRORS);
  assert.match(error ?? "", /ledger is empty/);
});

test("a tile cited as a page overview is rejected", async () => {
  const error = await validateVisualTakeoffAuditWithNativeViews(ws, strategyFor({
    renderedPages: [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: TILE }],
    zoomEvidence: [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: TILE, region: { x: 0.03, y: 0.07, width: 0.31, height: 0.49 } }],
  }), "", rowBasis);
  assert.match(error ?? "", /No actual atlas\/render evidence|Page evidence does not match an actual atlas\/render record/);
});

test("a view id the server never delivered does not count as audit evidence", async () => {
  const error = await validateVisualTakeoffAuditWithNativeViews(ws, strategyFor({
    renderedPages: [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: "view-not-real-0000" }],
    zoomEvidence: [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: TILE, region: { x: 0.03, y: 0.07, width: 0.31, height: 0.49 } }],
  }), "", rowBasis);
  assert.match(error ?? "", /No actual atlas\/render evidence|Page evidence does not match an actual atlas\/render record/);
});

test("the audit messages name the native tools and the viewId fields", async () => {
  const missing = await validateVisualTakeoffAuditWithNativeViews(ws, { scopeGraph: {}, summary: {} }, "", rowBasis);
  assert.match(missing ?? "", /readDrawingPage/);
  assert.match(missing ?? "", /renderedPages\[\]\.viewId/);
});

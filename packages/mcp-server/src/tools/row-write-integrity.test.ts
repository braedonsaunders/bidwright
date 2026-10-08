import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { __setEvidenceViewFetcherForTests, rowWriteIntegrityProblem } from "./quote-tools.js";
import { resolveClaimEvidenceViews, validateClaimEvidence } from "./drawing-evidence-tools.js";

/**
 * A row write is refused only when what it cites is not real or its stated
 * arithmetic or explicit unit conversion is wrong. The regression payloads are
 * the exact arguments Opus 5.5 sent on a production equipment-installation
 * run; each was refused by a judgment rule that no longer exists.
 */

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/opus-medium-2026-10-08.json", import.meta.url), "utf8"));
const row = (key: string) => structuredClone(fixture[key].item ?? fixture[key]);

const DOC = { id: "doc_layout01", fileName: "layout.pdf", checksum: "sha-current" };
const deliveredViews = new Set([
  "view-8e493054-e6b7-4227-8cef-7875783bba30",
  "view-95d5c3eb-9c52-42db-b4b7-7ed618779374",
  "view-29025b9b-8678-424f-b6b4-b444f695c2df",
  "view-d1b64b26-9755-48a5-9d68-8c173f67e304",
]);
const view = (id: string, extra: Record<string, unknown> = {}) => ({ id, documentId: DOC.id, pageNumber: 1, tool: "readDrawingTile", imageHash: `hash-${id}`, sourceChecksum: DOC.checksum, ...extra });

__setEvidenceViewFetcherForTests(async (ids) => ({
  views: ids.filter((id) => deliveredViews.has(id)).map((id) => view(id)),
  missingIds: ids.filter((id) => !deliveredViews.has(id)),
}));
test.after(() => __setEvidenceViewFetcherForTests(null));

// Claims are deliberately in other packages than the GC foreman row.
const claim = (claimId: string, packageId: string) => ({ claimId, packageId, quantityName: claimId, value: 1, method: "visual_count" });
const strategy = {
  assumptions: ["A-DURATION", "A-OT", "A-MOB", "A-FX"].map((id) => ({ id, text: id })),
  summary: { drawingEvidenceEngine: { claims: [
    claim("clm-platform-baseplates", "pkg-platform"),
    claim("clm-anchor-per-plate", "pkg-platform"),
    claim("clm-grout-thickness", "pkg-platform"),
    claim("clm-utility-connections", "pkg-equipment"),
    claim("clm-aw-weights", "pkg-equipment"),
  ] } },
};
const ws = { sourceDocuments: [DOC], worksheets: [{ id: "ws-gc", items: [] }] };
const check = (item: Record<string, any>, overrides: Record<string, any> = {}) => rowWriteIntegrityProblem(overrides.ws ?? ws, { ...item, strategy: overrides.strategy ?? strategy });

test("regression: an honestly assumed 88 h foreman row saves", async () => {
  assert.equal(await check(row("foreman88hAssumed")), null);
});

test("regression: a GC row may cite claims from other packages", async () => {
  // Saved as sent: there is no package-ownership or label-honesty rule. The
  // 259.5 / 2.95 = 87.97 h result is within rounding of the stated 88 h.
  assert.equal(await check(row("foremanCrossPackage")), null);
});

test("regression: the fl-oz-per-anchor adhesive row saves", async () => {
  // anchors_per_plate=1 next to an annulus_floz_per_anchor input used to trip
  // the per-instance phrase matcher; the math and the 1 EA purchase are right.
  assert.equal(await check(row("adhesiveFlozPerAnchorFinal")), null);
});

test("regression: a claim quoting a short note (1\" epoxy grout) is valid", () => {
  assert.deepEqual(validateClaimEvidence(fixture.shortGroutClaim), []);
});

test("integrity: unknown claim, assumption, view and document ids are refused", async () => {
  const unknownClaim = row("foremanCrossPackage");
  unknownClaim.evidenceBasis.quantity.drawingClaimIds.push("clm-invented");
  assert.match(String(await check(unknownClaim)), /claim id\(s\) not found.*clm-invented/);

  const unknownAssumption = row("foreman88hAssumed");
  unknownAssumption.evidenceBasis.quantity.assumptionIds = ["A-NOT-SAVED"];
  assert.match(String(await check(unknownAssumption)), /assumptionIds not found.*A-NOT-SAVED/);

  const unknownView = row("adhesiveFlozPerAnchorFinal");
  unknownView.evidenceBasis.quantity.viewIds = ["view-never-delivered"];
  assert.match(String(await check(unknownView)), /viewIds not found.*view-never-delivered/);

  const otherProjectDoc = row("foreman88hAssumed");
  otherProjectDoc.evidenceBasis.quantity.sourceRefs = ["doc_otherproject99"];
  assert.match(String(await check(otherProjectDoc)), /not in this project: doc_otherproject99/);

  const unknownType = row("foreman88hAssumed");
  unknownType.evidenceBasis.quantity.type = "gut_feel";
  assert.match(String(await check(unknownType)), /Unsupported evidenceBasis.quantity.type 'gut_feel'/);
});

test("integrity: views fail closed and must be of the current source version", async () => {
  const item = row("adhesiveFlozPerAnchorFinal");
  __setEvidenceViewFetcherForTests(async () => ({ error: "connect ECONNREFUSED" }));
  try {
    assert.match(String(await check(item)), /Could not verify the cited viewIds/);
  } finally {
    __setEvidenceViewFetcherForTests(async (ids) => ({ views: ids.map((id) => view(id)), missingIds: [] }));
  }
  const replaced = { ...ws, sourceDocuments: [{ ...DOC, checksum: "sha-new-upload" }] };
  assert.match(String(await check(item, { ws: replaced })), /earlier version/);
  const removed = { ...ws, sourceDocuments: [{ id: "doc_somethingelse01" }] };
  assert.match(String(await check(item, { ws: removed })), /no longer a source document/);
  __setEvidenceViewFetcherForTests(async (ids) => ({
    views: ids.filter((id) => deliveredViews.has(id)).map((id) => view(id)),
    missingIds: ids.filter((id) => !deliveredViews.has(id)),
  }));
});

test("integrity: claim evidence view fields come from the server, never the agent", async () => {
  const forged = [{ viewId: "view-a", imageHash: "agent-hash", imageHashVerifiedAt: "2020-01-01", sourceChecksum: "agent", bbox: { x: 0, y: 0, w: 9, h: 9 } }];
  const { evidence, failures } = await resolveClaimEvidenceViews(forged, async () => [view("view-a", { bbox: null })]);
  assert.deepEqual(failures, []);
  assert.equal(evidence[0].imageHash, "hash-view-a");
  assert.equal(evidence[0].sourceChecksum, DOC.checksum);
  assert.equal(evidence[0].bbox, undefined);
  assert.notEqual(evidence[0].imageHashVerifiedAt, "2020-01-01");

  const undelivered = await resolveClaimEvidenceViews([{ viewId: "view-b", imageHashVerifiedAt: "2020-01-01" }], async () => []);
  assert.match(undelivered.failures[0], /not delivered to this project/);
  assert.equal(undelivered.evidence[0].imageHashVerifiedAt, undefined);

  const down = await resolveClaimEvidenceViews([{ viewId: "view-c" }], async () => { throw new Error("timeout"); });
  assert.match(down.failures[0], /Could not verify/);
});

test("integrity: derivation arithmetic must reproduce the row", async () => {
  const wrongTotal = row("foreman88hAssumed");
  wrongTotal.tierUnits = { "rst-293c3cfc-43a0-4971-a64d-bcc2d88f94fc": 8, "rst-8a03a4ad-c020-4a17-b650-5e311627b775": 100 };
  assert.match(String(await check(wrongTotal)), /Derivation is not valid/);

  const wrongResult = row("foreman88hAssumed");
  wrongResult.derivation.result.value = 120;
  assert.match(String(await check(wrongResult)), /Derivation is not valid/);
});

test("integrity: a purchase in other units needs an explicit conversion", async () => {
  const item = row("adhesiveFlozPerAnchorFinal");
  item.derivation.procurement = { installedQuantity: 3.3, installedUom: "floz" };
  assert.match(String(await check(item)), /Procurement does not reconcile/);
  item.derivation.procurement.packSize = 11.16;
  assert.equal(await check(item), null);
});

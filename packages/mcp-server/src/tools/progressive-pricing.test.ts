import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mechanicalClaimCheck } from "./drawing-evidence-tools.js";
import { resolveWorksheetPackage, strategyPricingReadiness, validateVisualTakeoffAuditForPricing } from "./quote-tools.js";

/**
 * Incremental, package-by-package pricing (round-3 root cause: Opus and Sonnet
 * never priced a row in 90 minutes because the first row needed the whole
 * strategy, the whole visual audit and a ledger-wide verifier pass).
 * A row may be priced for ONE declared package; every per-row evidence rule is
 * unchanged, and the missing pieces stay finalize blockers.
 */

const PLATFORM_DOC = "doc_platform0001";
const strategyBase = () => ({
  scopeGraph: {
    scopeItems: [{ id: "scope-platform", name: "Platform erection" }, { id: "scope-servo", name: "Servo-Lift" }],
    visualTakeoffAudit: {
      completedBeforePricing: false,
      drawingDrivenPackages: [
        { packageId: "pkg-platform", completed: true, renderedPages: [{ documentId: PLATFORM_DOC, pageNumber: 4 }], zoomEvidence: [] },
        { packageId: "pkg-servo", completed: false },
      ],
    },
  },
  packagePlan: [
    { id: "pkg-platform", name: "SS Platform Field Installation", scopeRefs: ["scope-platform"], bindings: { worksheetIds: ["ws-platform"] } },
    { id: "pkg-servo", name: "Servo-Lift Mechanical Installation", scopeRefs: ["scope-servo"], bindings: {} },
  ],
  executionPlan: {},
  assumptions: [],
  summary: { drawingEvidenceEngine: { atlas: { status: "ready", regionCount: 33 }, claims: [] as any[], verifications: [] as any[] } },
});

const platformClaim = (overrides: Record<string, unknown> = {}) => ({
  claimId: "claim-plates",
  packageId: "pkg-platform",
  quantityName: "Platform base plates",
  value: 5,
  unit: "EA",
  method: "visual_count",
  evidence: [{ documentId: PLATFORM_DOC, pageNumber: 4, viewId: "view-tile-1", bbox: { x: 0.03, y: 0.07, width: 0.31, height: 0.49 }, tool: "readDrawingTile", imageHash: "f".repeat(64), sourceChecksum: "platform-v1" }],
  mechanicalCheck: { kind: "mechanical_on_save", status: "passed", problems: [] },
  ...overrides,
});

const ws = { sourceDocuments: [{ id: PLATFORM_DOC, fileName: "Platforms.pdf", fileType: "pdf", documentType: "drawing", checksum: "platform-v1" }], aiRuns: [] };
const drawingRow = (claimIds = ["claim-plates"]) => ({ quantity: { type: "drawing_quantity", drawingClaimIds: claimIds, viewIds: ["view-tile-1"] } });

// ── strategy readiness ────────────────────────────────────────────────────

test("a row for package P is allowed while package Q, the execution plan and assumptions are still missing", () => {
  const readiness = strategyPricingReadiness(strategyBase(), "createWorksheetItem", { id: "ws-platform", name: "SS Platform Field Installation" });
  assert.equal(readiness.ok, true, readiness.reason);
  assert.equal(readiness.mode, "incremental");
  assert.equal(readiness.packageId, "pkg-platform");
  assert.deepEqual(readiness.finalizeBlockers, ["executionPlan", "assumptions", "reconcileReport", "package pkg-servo has no bound worksheet"]);
});

test("incremental pricing refuses rows whose package is undeclared, ambiguous, or unscoped", () => {
  const unbound = strategyPricingReadiness(strategyBase(), "createWorksheetItem", { id: "ws-misc", name: "Misc" });
  assert.equal(unbound.ok, false);
  assert.match(unbound.reason ?? "", /not bound to a packagePlan entry/);

  const ambiguous = strategyBase();
  (ambiguous.packagePlan[1].bindings as any).worksheetIds = ["ws-platform"];
  assert.match(strategyPricingReadiness(ambiguous, "createWorksheetItem", { id: "ws-platform", name: "x" }).reason ?? "", /more than one package/);

  const unscoped = strategyBase();
  unscoped.packagePlan[0].scopeRefs = ["scope-missing"];
  assert.match(strategyPricingReadiness(unscoped, "createWorksheetItem", { id: "ws-platform", name: "x" }).reason ?? "", /not in scopeGraph: scope-missing/);

  const noPlan = { ...strategyBase(), packagePlan: [] };
  assert.match(strategyPricingReadiness(noPlan, "createWorksheetItem", { id: "ws-platform" }).reason ?? "", /Save packagePlan/);
  const noScope = { ...strategyBase(), scopeGraph: {} };
  assert.match(strategyPricingReadiness(noScope, "createWorksheet", null).reason ?? "", /Save scopeGraph/);
});

test("with the whole strategy saved the old behaviour is unchanged (no binding required)", () => {
  const full = { ...strategyBase(), executionPlan: { crew: "x" }, assumptions: [{ id: "A1" }] };
  const readiness = strategyPricingReadiness(full, "createWorksheetItem", { id: "ws-anything", name: "Anything" });
  assert.equal(readiness.ok, true);
  assert.equal(readiness.mode, "full");
});

test("a worksheet can bind by id, by bound name, or by matching the package name", () => {
  const strategy = strategyBase();
  assert.equal(resolveWorksheetPackage(strategy, { id: "ws-platform" }).entry?.id, "pkg-platform");
  assert.equal(resolveWorksheetPackage(strategy, { id: "ws-new", name: "Servo-Lift Mechanical Installation" }).entry?.id, "pkg-servo");
});

// ── drawing rows for one package ──────────────────────────────────────────

function audit(strategy: any, claims: any[], verifications: any[] = []) {
  strategy.summary.drawingEvidenceEngine.claims = claims;
  strategy.summary.drawingEvidenceEngine.verifications = verifications;
  return (claimIds?: string[]) => validateVisualTakeoffAuditForPricing(ws, strategy, "SS Platform Field Installation base plate anchors", drawingRow(claimIds), [], "pkg-platform");
}

test("P's drawing row passes on P's completed audit entry and a passed save-time check, with Q unaudited and no ledger verifier", () => {
  assert.equal(audit(strategyBase(), [platformClaim()])(), null);
});

test("the same row is still blocked when P's own audit entry is not complete", () => {
  const strategy = strategyBase();
  strategy.scopeGraph.visualTakeoffAudit.drawingDrivenPackages[0].completed = false;
  assert.match(audit(strategy, [platformClaim()])() ?? "", /Incremental pricing of package pkg-platform: its visualTakeoffAudit/);
});

test("a claim from another package is blocked", () => {
  assert.match(audit(strategyBase(), [platformClaim({ packageId: "pkg-servo" })])() ?? "", /belong to another package/);
});

test("a claim whose document changed or was removed is blocked", () => {
  assert.match(audit(strategyBase(), [platformClaim({ evidence: [{ ...platformClaim().evidence[0], sourceChecksum: "platform-v0" }] })])() ?? "", /changed since the claim was saved/);
  assert.match(audit(strategyBase(), [platformClaim({ evidence: [{ ...platformClaim().evidence[0], documentId: "doc_gone00000" }] })])() ?? "", /no longer in the project/);
});

test("a malformed claim is blocked (no hash on a visual count)", () => {
  const malformed = platformClaim({ evidence: [{ ...platformClaim().evidence[0], imageHash: "" }] });
  // With no usable claim the audit's own page/crop evidence rule fires first; either way the row is blocked.
  assert.match(audit(strategyBase(), [malformed])() ?? "", /not usable for pricing|No actual atlas\/render evidence/);
});

test("fail closed: no save-time check and no ledger verifier, or a failed check, still blocks", () => {
  assert.match(audit(strategyBase(), [platformClaim({ mechanicalCheck: undefined })])() ?? "", /verification has not run/);
  assert.match(audit(strategyBase(), [platformClaim({ mechanicalCheck: { status: "failed", problems: ["conflicts with claim-x"] } })])() ?? "", /failed their save-time check: claim-plates: conflicts with claim-x/);
});

test("a failed ledger verifier for the cited claim still blocks even with a passed save-time check", () => {
  const failed = [{ status: "failed", failures: ["claim-plates: crop does not show the count"] }];
  assert.match(audit(strategyBase(), [platformClaim()], failed)() ?? "", /verification failed for a selected claim/);
});

// ── save-time mechanical check ────────────────────────────────────────────

test("the save-time check passes clean claims, fails contradicted ones, and records source versions", () => {
  const claim = platformClaim({ mechanicalCheck: undefined });
  const clean = mechanicalClaimCheck(claim, []);
  assert.equal(clean.status, "passed");
  assert.deepEqual(clean.sourceChecksums, { "view-tile-1": "platform-v1" });
  assert.match(String(clean.note), /not a human review/);
  const contradicted = mechanicalClaimCheck(claim, [{ claimIds: ["claim-plates", "claim-other"], message: "5 vs 6 base plates" }]);
  assert.equal(contradicted.status, "failed");
  assert.deepEqual(contradicted.problems, ["5 vs 6 base plates"]);
});

// ── finalize is not weakened ──────────────────────────────────────────────

test("finalize still blocks on the missing sections, reconcile report, and ledger verifier", () => {
  const store = readFileSync(new URL("../../../../apps/api/src/prisma-store.ts", import.meta.url), "utf8");
  for (const code of ["missing_execution_plan", "missing_assumptions", "missing_package_plan", "missing_reconcile_report", "drawing_evidence_verifier_missing", "package_binding_unresolved"]) {
    assert.ok(store.includes(`"${code}"`), `finalize issue ${code} must remain`);
  }
});

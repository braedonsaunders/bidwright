import assert from "node:assert/strict";
import test from "node:test";
import {
  detectPerInstanceContradictions,
  derivationInvalidatedByFields,
  derivationReferencesDocument,
  evaluateProcurementLink,
  evaluateDerivationFormula,
  extractPerInstanceCallouts,
  groutVolumeUnderPlates,
  markDerivationStale,
  normalizeLineDerivation,
  packsRequired,
  reconcileProcurementQuantities,
  validateLineDerivation,
  type LineDerivation,
} from "./line-derivation";

const anchorDerivation = (anchorsPerPlate: number): LineDerivation => ({
  version: 1,
  target: "quantity",
  formula: "basePlates * anchorsPerPlate",
  inputs: [
    {
      name: "basePlates",
      value: 8,
      unit: "EA",
      source: { kind: "view", ref: "view-abc", excerpt: "8 columns on W460x52" },
    },
    {
      name: "anchorsPerPlate",
      value: anchorsPerPlate,
      unit: "EA",
      perInstance: true,
      instanceOf: "base plate",
      source: { kind: "text", ref: "doc_1#4", excerpt: "8x8x5/8 Base Plate c/w (1) 1\" dia hole for 3/4\" SS epoxy anchor" },
    },
  ],
  result: { value: 8 * anchorsPerPlate, unit: "EA" },
  status: "draft",
});

const platformText = {
  ref: "doc_1#4",
  text: `1" epoxy grout\n8x8x5/8" Base Plate c/w (1) 1" dia hole\nfor 3/4" SS epoxy anchor\nPlatform Framing Arrangement`,
};

test("formula evaluation handles arithmetic, precedence, and functions", () => {
  assert.equal(evaluateDerivationFormula("a * b", { a: 8, b: 4 }), 32);
  assert.equal(evaluateDerivationFormula("a + b * 2", { a: 1, b: 3 }), 7);
  assert.equal(evaluateDerivationFormula("(a + b) * 2", { a: 1, b: 3 }), 8);
  assert.equal(evaluateDerivationFormula("ceil(a / b)", { a: 32, b: 19 }), 2);
  assert.equal(evaluateDerivationFormula("round(a * 1.15, 1)", { a: 10 }), 11.5);
  assert.equal(evaluateDerivationFormula("qty = a * b", { a: 2, b: 3 }), 6);
  assert.throws(() => evaluateDerivationFormula("a * missing", { a: 2 }), /Unknown input 'missing'/);
  assert.throws(() => evaluateDerivationFormula("a / b", { a: 2, b: 0 }), /Division by zero/);
  assert.throws(() => evaluateDerivationFormula("process.exit()", {}), /Unexpected character|Unknown input|Invalid number/);
});

test("a consistent derivation validates clean", () => {
  const issues = validateLineDerivation(anchorDerivation(1), { expectedValue: 8 });
  assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
});

test("result mismatch, missing sources, and target mismatch are errors", () => {
  const bad = anchorDerivation(4);
  bad.result.value = 30;
  const issues = validateLineDerivation(bad, { expectedValue: 32 });
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("result_mismatch"));

  const noSource = anchorDerivation(1);
  (noSource.inputs[0].source as any) = { kind: "", ref: "" };
  const sourceIssues = validateLineDerivation(noSource);
  assert.ok(sourceIssues.some((issue) => issue.code === "input_source_kind"));
  assert.ok(sourceIssues.some((issue) => issue.code === "input_source_ref"));

  const wrongTarget = anchorDerivation(1);
  const targetIssues = validateLineDerivation(wrongTarget, { expectedValue: 32 });
  assert.ok(targetIssues.some((issue) => issue.code === "result_target_mismatch"));
});

test("manual inputs need a rationale", () => {
  const manual = anchorDerivation(1);
  manual.inputs[0].source = { kind: "manual", ref: "estimator" };
  const issues = validateLineDerivation(manual);
  assert.ok(issues.some((issue) => issue.code === "manual_input_rationale"));
});

test("per-instance callouts are extracted from drafting idioms", () => {
  const callouts = extractPerInstanceCallouts(platformText.text);
  assert.ok(callouts.some((callout) => callout.count === 1 && callout.pattern === "parenthesized"));

  const typ = extractPerInstanceCallouts("HSS 4x4x.375 SS TYP 4 ANCHORS PER BASE PLATE, 4-HOLES, TYP. (2)");
  const counts = typ.map((callout) => `${callout.pattern}:${callout.count}`);
  assert.ok(counts.includes("per:4"));
  assert.ok(counts.includes("hyphenated:4"));
  assert.ok(counts.includes("typ:2"));
  // dimensions like 8x8 are not callouts
  assert.equal(extractPerInstanceCallouts("8x8x5/8 plate 12 ft long").length, 0);
});

test("the Alexanderwerk anchor case: (1) hole per plate contradicts a claimed 4 per plate", () => {
  const contradictions = detectPerInstanceContradictions(anchorDerivation(4), [platformText]);
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0].inputName, "anchorsPerPlate");
  assert.equal(contradictions[0].claimedValue, 4);
  assert.equal(contradictions[0].textValue, 1);
  assert.match(contradictions[0].excerpt, /\(1\)/);
});

test("a per-instance input that matches the text produces no contradiction", () => {
  assert.deepEqual(detectPerInstanceContradictions(anchorDerivation(1), [platformText]), []);
});

test("totals are never compared against per-instance callouts", () => {
  // basePlates is a total, not per-instance; the (1) callout must not flag it.
  const derivation = anchorDerivation(1);
  derivation.inputs[0].value = 8;
  const contradictions = detectPerInstanceContradictions(derivation, [platformText]);
  assert.deepEqual(contradictions, []);
});

test("unrelated callouts in the text do not flag an input", () => {
  const derivation = anchorDerivation(2);
  const text = { ref: "doc_2#1", text: "Handrail posts c/w (3) 1/2\" dia bolts per post" };
  // 'bolts per post' shares no stem with 'anchorsPerPlate / base plate' — no contradiction
  assert.deepEqual(detectPerInstanceContradictions(derivation, [text]), []);
});

test("procurement reconciliation catches 2 x 10 rod packs for 32 installed anchors", () => {
  const result = reconcileProcurementQuantities({
    installedQuantity: 32,
    installedUom: "EA",
    purchaseQuantity: 2,
    purchaseUom: "PK",
    packSize: 10,
  });
  assert.equal(result.ok, false);
  assert.equal(result.suppliedBaseUnits, 20);
  assert.equal(result.requiredPurchaseQuantity, 4);
  assert.ok(result.issues.some((issue) => issue.code === "procurement_shortfall"));

  const covered = reconcileProcurementQuantities({ installedQuantity: 32, purchaseQuantity: 32, purchaseUom: "EA" });
  assert.equal(covered.ok, true);

  const noPackSize = reconcileProcurementQuantities({ installedQuantity: 32, purchaseQuantity: 2, purchaseUom: "BOX" });
  assert.ok(noPackSize.issues.some((issue) => issue.code === "pack_size_unknown"));
});

test("packsRequired rounds up and honours waste", () => {
  assert.equal(packsRequired(32, 19), 2);
  assert.equal(packsRequired(38, 19), 2);
  assert.equal(packsRequired(39, 19), 3);
  assert.equal(packsRequired(32, 19, 0.15), 2);
  assert.equal(packsRequired(36, 19, 0.15), 3);
});

test("grout under an 8x8 plate with a 1 inch bed is about 0.037 ft3, not 1 ft3", () => {
  const grout = groutVolumeUnderPlates({ plateLength: 8, plateWidth: 8, bedThickness: 1, unit: "in", plateCount: 8, wasteFactor: 0.15, bagYieldFt3: 0.5 });
  assert.ok(Math.abs(grout.perPlateFt3 - 0.037) < 0.001, `per plate ${grout.perPlateFt3}`);
  assert.ok(Math.abs(grout.totalFt3 - 0.296) < 0.001, `total ${grout.totalFt3}`);
  assert.equal(grout.bags, 1);
});

test("derivations go stale when their target fields change", () => {
  const derivation = anchorDerivation(1);
  assert.deepEqual(derivationInvalidatedByFields(derivation, ["description"]), []);
  assert.deepEqual(derivationInvalidatedByFields(derivation, ["quantity", "sourceNotes"]), ["quantity"]);
  const stale = markDerivationStale(derivation, { reason: "human_edit", at: "2026-10-07T00:00:00Z", field: "quantity", previousValue: 8, newValue: 10 });
  assert.equal(stale.status, "stale");
  assert.equal(stale.invalidatedBy?.length, 1);
  assert.equal(derivation.status, "draft", "original is not mutated");
});

test("normalizeLineDerivation tolerates loose JSON", () => {
  const normalized = normalizeLineDerivation({
    formula: "a*b",
    inputs: [{ name: "a", value: "2", source: { kind: "manual", ref: "me" } }, { name: "b", value: 3, source: { kind: "view", ref: "view-1" } }],
    result: { value: "6" },
    status: "bogus",
    target: "quantity",
  });
  assert.ok(normalized);
  assert.equal(normalized!.version, 1);
  assert.equal(normalized!.status, "draft");
  assert.equal(normalized!.inputs[0].value, 2);
  assert.equal(normalized!.result.value, 6);
  assert.equal(normalizeLineDerivation(null), null);
  assert.equal(normalizeLineDerivation([1, 2]), null);
});

test("derivationReferencesDocument sees views of the document and document#page text refs", () => {
  const derivation = anchorDerivation(1);
  assert.equal(derivationReferencesDocument(derivation, "doc_1", ["view-abc"]), true, "view input belongs to the document");
  assert.equal(derivationReferencesDocument(derivation, "doc_1", []), true, "text input ref doc_1#4 belongs to the document");
  assert.equal(derivationReferencesDocument(derivation, "doc_other", ["view-zzz"]), false);
  assert.equal(derivationReferencesDocument(null, "doc_1", ["view-abc"]), false);
});

// ── declared installed/procurement links ──────────────────────────────────

const labourRow = {
  quantity: 2,
  uom: "HR",
  entityName: "Drill and set anchors",
  derivation: {
    ...anchorDerivation(1),
    formula: "anchors * hoursPerAnchor",
    inputs: [
      { name: "anchors", value: 32, unit: "EA", source: { kind: "view" as const, ref: "view-plan" } },
      { name: "hoursPerAnchor", value: 0.375, unit: "HR", source: { kind: "laborUnit" as const, ref: "lu-1" } },
    ],
    result: { value: 12, unit: "HR" },
  },
};
const resolveItem = (itemId: string) => (itemId === "li-labour" ? labourRow : null);

test("regression: 2 packs x 10 rods against 32 installed anchors is a shortfall", () => {
  const result = evaluateProcurementLink(
    { suppliesItemId: "li-labour", installedFromInput: "anchors", packSize: 10 },
    { purchaseQuantity: 2, purchaseUom: "PK", resolveItem },
  );
  assert.equal(result.ok, false);
  assert.equal(result.installedQuantity, 32);
  assert.equal(result.installedSource, "linked_input");
  assert.equal(result.suppliedBaseUnits, 20);
  assert.equal(result.requiredPurchaseQuantity, 4);
  assert.ok(result.issues.some((issue) => issue.code === "procurement_shortfall"));
});

test("1 cartridge covering 5 anchors passes when the surplus is explained, fails when it is not", () => {
  const context = { purchaseQuantity: 1, purchaseUom: "CARTRIDGE", resolveItem };
  const unexplained = evaluateProcurementLink({ installedQuantity: 5, installedUom: "EA", packSize: 19 }, context);
  assert.equal(unexplained.ok, false);
  assert.ok(unexplained.issues.some((issue) => issue.code === "procurement_excess_unexplained"));

  const explained = evaluateProcurementLink(
    { installedQuantity: 5, installedUom: "EA", packSize: 19, surplusRationale: "Minimum purchase is one 330 ml cartridge; remainder is spares." },
    context,
  );
  assert.equal(explained.ok, true);
  assert.equal(explained.suppliedBaseUnits, 19);
  assert.equal(explained.requiredPurchaseQuantity, 1);
});

test("procurement links must name a requirement and resolve their linked row", () => {
  const missing = evaluateProcurementLink({ packSize: 10 }, { purchaseQuantity: 2, purchaseUom: "PK", resolveItem });
  assert.ok(missing.issues.some((issue) => issue.code === "procurement_requirement_missing"));
  const unresolved = evaluateProcurementLink({ suppliesItemId: "li-ghost", packSize: 10 }, { purchaseQuantity: 2, purchaseUom: "PK", resolveItem });
  assert.ok(unresolved.issues.some((issue) => issue.code === "procurement_link_unresolved"));
  const noPack = evaluateProcurementLink({ installedQuantity: 32 }, { purchaseQuantity: 2, purchaseUom: "BOX", resolveItem });
  assert.ok(noPack.issues.some((issue) => issue.code === "pack_size_unknown"));
  // The labour row's quantity is 2 crew units, not 2 anchors: linking without
  // naming the physical-count input must be refused, not silently compared.
  const ambiguous = evaluateProcurementLink({ suppliesItemId: "li-labour", packSize: 10 }, { purchaseQuantity: 2, purchaseUom: "PK", resolveItem });
  assert.equal(ambiguous.ok, false);
  const issue = ambiguous.issues.find((entry) => entry.code === "procurement_requirement_ambiguous");
  assert.ok(issue);
  assert.match(issue!.message, /installedFromInput/);
  assert.match(issue!.message, /anchors/);
});

test("a physical-count row can be linked by quantity; units stay distinct", () => {
  const resolvePhysical = (itemId: string) => (itemId === "li-plates" ? { quantity: 5, uom: "EA", entityName: "Base plates set", derivation: null } : null);
  const onePack = evaluateProcurementLink({ suppliesItemId: "li-plates", packSize: 10 }, { purchaseQuantity: 1, purchaseUom: "PK", resolveItem: resolvePhysical });
  assert.equal(onePack.installedSource, "linked_quantity");
  assert.equal(onePack.ok, true, "1 pack of 10 for 5 installed is a 5-unit surplus within 2x; no rationale needed");
  assert.equal(onePack.suppliedBaseUnits, 10);
  const short = evaluateProcurementLink({ installedQuantity: 32, installedUom: "EA", packSize: 10 }, { purchaseQuantity: 2, purchaseUom: "PK", resolveItem: resolvePhysical });
  assert.match(short.issues[0].message, /short by 12/);
});

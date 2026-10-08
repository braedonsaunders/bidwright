import assert from "node:assert/strict";
import test from "node:test";
import {
  derivationInvalidatedByFields,
  derivationReferencesDocument,
  evaluateProcurementLink,
  uomsEquivalent,
  evaluateDerivationFormula,
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

test("result mismatch, unknown source kinds, and target mismatch are errors; a missing source is not", () => {
  const bad = anchorDerivation(4);
  bad.result.value = 30;
  const issues = validateLineDerivation(bad, { expectedValue: 32 });
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("result_mismatch"));

  const noSource = anchorDerivation(1);
  (noSource.inputs[0].source as any) = { kind: "", ref: "" };
  assert.deepEqual(validateLineDerivation(noSource, { expectedValue: 8 }).filter((issue) => issue.severity === "error"), [], "a source is optional");
  const badKind = anchorDerivation(1);
  (badKind.inputs[0].source as any) = { kind: "hunch", ref: "x" };
  assert.ok(validateLineDerivation(badKind).some((issue) => issue.code === "input_source_kind"));

  const wrongTarget = anchorDerivation(1);
  const targetIssues = validateLineDerivation(wrongTarget, { expectedValue: 32 });
  assert.ok(targetIssues.some((issue) => issue.code === "result_target_mismatch"));
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

test("1 cartridge covering 5 anchors reconciles (a surplus is not an error)", () => {
  const result = evaluateProcurementLink({ installedQuantity: 5, installedUom: "EA", packSize: 19 }, { purchaseQuantity: 1, purchaseUom: "CARTRIDGE", resolveItem });
  assert.equal(result.ok, true);
  assert.equal(result.suppliedBaseUnits, 19);
});

test("explicit units: a packSize converts any purchase unit; different units without one are an error", () => {
  // medium Opus 2026-10-08: 3.3 floz installed against "1 EA" was told "short by 2.3. Buy at least 4."
  const noConversion = reconcileProcurementQuantities({ installedQuantity: 3.3, installedUom: "floz", purchaseQuantity: 1, purchaseUom: "EA" });
  assert.equal(noConversion.issues[0].code, "procurement_conversion_missing");
  assert.equal(reconcileProcurementQuantities({ installedQuantity: 3.3, installedUom: "floz", purchaseQuantity: 1, purchaseUom: "EA", packSize: 11.16 }).ok, true);
  assert.equal(reconcileProcurementQuantities({ installedQuantity: 5, installedUom: "EA", purchaseQuantity: 4, purchaseUom: "EA" }).issues[0].code, "procurement_shortfall");
});

test("procurement links resolve their linked row; with no stated requirement there is nothing to reconcile", () => {
  assert.equal(evaluateProcurementLink({ packSize: 10 }, { purchaseQuantity: 2, purchaseUom: "PK", resolveItem }).ok, true);
  const unresolved = evaluateProcurementLink({ suppliesItemId: "li-ghost", packSize: 10 }, { purchaseQuantity: 2, purchaseUom: "PK", resolveItem });
  assert.ok(unresolved.issues.some((issue) => issue.code === "procurement_link_unresolved"));
  const noPack = evaluateProcurementLink({ installedQuantity: 32 }, { purchaseQuantity: 2, purchaseUom: "BOX", resolveItem });
  assert.ok(noPack.issues.some((issue) => issue.code === "pack_size_unknown"));
  // A labour row's quantity is crew units, not anchors: without installedFromInput it is not compared.
  assert.equal(evaluateProcurementLink({ suppliesItemId: "li-labour", packSize: 10 }, { purchaseQuantity: 2, purchaseUom: "PK", resolveItem }).ok, true);
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

test("an explicit installedUom may not reinterpret a linked input's unit; synonyms are fine", () => {
  const pipeRow = {
    quantity: 1, uom: "LS", entityName: "Install pipe",
    derivation: {
      version: 1, target: "quantity" as const, formula: "lengthFt", status: "draft" as const,
      inputs: [{ name: "lengthFt", value: 10, unit: "FT", source: { kind: "view" as const, ref: "view-iso" } }],
      result: { value: 10, unit: "FT" },
    },
  };
  const resolve = (id: string) => (id === "li-pipe" ? pipeRow : null);
  // 10 FT labelled as M must not become 10 M.
  const conflict = evaluateProcurementLink(
    { suppliesItemId: "li-pipe", installedFromInput: "lengthFt", installedUom: "M", packSize: 6 },
    { purchaseQuantity: 2, purchaseUom: "LEN", resolveItem: resolve },
  );
  assert.equal(conflict.ok, false);
  const issue = conflict.issues.find((entry) => entry.code === "procurement_unit_conflict");
  assert.ok(issue);
  assert.match(issue!.message, /lengthFtM/);
  assert.equal(conflict.installedQuantity, null, "no requirement is derived from a conflicting unit");
  // A synonym spelling is accepted and the number is kept.
  const synonym = evaluateProcurementLink(
    { suppliesItemId: "li-pipe", installedFromInput: "lengthFt", installedUom: "feet" },
    { purchaseQuantity: 10, purchaseUom: "FT", resolveItem: resolve },
  );
  assert.equal(synonym.ok, true);
  assert.equal(synonym.installedQuantity, 10);
  assert.equal(uomsEquivalent("EA", "eaches"), true);
  assert.equal(uomsEquivalent("FT", "M"), false);
  assert.equal(uomsEquivalent("", "M"), true, "a missing unit cannot conflict");
});

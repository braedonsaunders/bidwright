/**
 * Per-line derivation ledger.
 *
 * A derivation is the auditable "how did you get this number" for one
 * worksheet row: a formula, the inputs that feed it, where each input came
 * from, and the result. It exists so a follow-up question ("how did you get 32
 * anchors?") is answered from a persisted trace instead of reconstructed from
 * memory, and so an edit to any input can mark dependent rows stale.
 *
 * Everything here is pure and deterministic. No LLM judgement is involved: the
 * per-instance contradiction check compares explicit callouts in cited text
 * ("(1) hole", "TYP 4", "2 PER PLATE") against the per-instance factor the
 * estimator claimed. It never compares against a row total, because a total
 * stays unknown until an instance count has been physically evidenced.
 */

export const LINE_DERIVATION_SOURCE_KINDS = [
  "view",        // EvidenceView id — an image the model actually received
  "claim",       // Drawing Evidence Engine claim id
  "text",        // extracted/positioned document text (ref = documentId[#page])
  "document",    // a document reference without a precise excerpt
  "rateItem",    // RateScheduleItem id
  "laborUnit",   // LaborUnit id
  "dataset",     // Dataset / dataset row id
  "book",        // KnowledgeBook id (+ page)
  "catalog",     // CatalogItem / ResourceCatalogItem / EffectiveCost id
  "vendorQuote", // PriceObservation / vendor quote reference
  "assumption",  // saved estimate assumption id
  "user",        // askUser questionId whose answer supplied the value
  "web",         // URL
  "item",        // another worksheet item id (dependency)
  "manual",      // estimator-entered with rationale
] as const;

export type LineDerivationSourceKind = (typeof LINE_DERIVATION_SOURCE_KINDS)[number];

export type LineDerivationStatus = "draft" | "verified" | "reviewed" | "stale";

export type LineDerivationTarget = "quantity" | "tierUnits" | "cost" | "price";

export interface LineDerivationSource {
  kind: LineDerivationSourceKind;
  /** The id, URL, or locator for the source. */
  ref: string;
  /** Short quote of the source text or value that supplied the input. */
  excerpt?: string | null;
}

export interface LineDerivationInput {
  /** Identifier used in the formula, e.g. `basePlates`. */
  name: string;
  value: number;
  unit?: string | null;
  /**
   * True when this input is a per-instance factor (per plate, per column,
   * per valve). Per-instance inputs are the ones the contradiction check
   * compares against explicit callouts in cited text.
   */
  perInstance?: boolean;
  /** Noun the per-instance factor applies to, e.g. "base plate". */
  instanceOf?: string | null;
  source: LineDerivationSource;
  note?: string | null;
}

export interface LineDerivationInvalidation {
  eventId?: string | null;
  reason: string;
  at: string;
  by?: string | null;
  field?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
}

export interface LineDerivation {
  version: number;
  target: LineDerivationTarget;
  formula: string;
  inputs: LineDerivationInput[];
  result: { value: number; unit?: string | null };
  status: LineDerivationStatus;
  computedAt?: string | null;
  invalidatedBy?: LineDerivationInvalidation[];
  notes?: string | null;
}

export interface LineDerivationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  inputName?: string;
}

// ── Formula evaluation ─────────────────────────────────────────────────────

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" };

const FORMULA_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  ceil: (x) => Math.ceil(x),
  floor: (x) => Math.floor(x),
  round: (x, digits = 0) => {
    const factor = 10 ** Math.max(0, Math.trunc(digits));
    return Math.round(x * factor) / factor;
  },
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  sqrt: (x) => Math.sqrt(x),
  abs: (x) => Math.abs(x),
};

function tokenizeFormula(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < formula.length) {
        if (/[0-9.]/.test(formula[j])) { j += 1; continue; }
        // A comma is a thousands separator only when exactly three digits follow it.
        if (formula[j] === "," && /^\d{3}(?!\d)/.test(formula.slice(j + 1, j + 5))) { j += 1; continue; }
        break;
      }
      const raw = formula.slice(i, j).replace(/,/g, "");
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`Invalid number '${raw}' in formula`);
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < formula.length && /[A-Za-z0-9_]/.test(formula[j])) j += 1;
      tokens.push({ type: "ident", value: formula.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/^".includes(ch) || ch === "×" || ch === "÷") {
      tokens.push({ type: "op", value: ch === "×" ? "*" : ch === "÷" ? "/" : ch });
      i += 1;
      continue;
    }
    if (ch === "(") { tokens.push({ type: "lparen" }); i += 1; continue; }
    if (ch === ")") { tokens.push({ type: "rparen" }); i += 1; continue; }
    if (ch === ",") { tokens.push({ type: "comma" }); i += 1; continue; }
    if (ch === "=") {
      // Allow "result = a * b" style; everything before '=' is a label.
      tokens.length = 0;
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' in formula`);
  }
  return tokens;
}

/** Identifiers referenced by a formula (excludes function names). */
export function formulaIdentifiers(formula: string): string[] {
  const names = new Set<string>();
  let tokens: Token[];
  try {
    tokens = tokenizeFormula(formula);
  } catch {
    return [];
  }
  tokens.forEach((token, index) => {
    if (token.type !== "ident") return;
    const next = tokens[index + 1];
    if (next && next.type === "lparen" && FORMULA_FUNCTIONS[token.value.toLowerCase()]) return;
    names.add(token.value);
  });
  return [...names];
}

/**
 * Evaluate an arithmetic formula against named inputs. Supports + - * / ^,
 * parentheses, and ceil/floor/round/min/max/sqrt/abs. Throws on unknown
 * identifiers or malformed syntax; never uses eval.
 */
export function evaluateDerivationFormula(formula: string, inputs: Record<string, number>): number {
  const tokens = tokenizeFormula(formula);
  let pos = 0;

  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() && peek()!.type === "op" && ((peek() as any).value === "+" || (peek() as any).value === "-")) {
      const op = (next() as any).value;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() && peek()!.type === "op" && ((peek() as any).value === "*" || (peek() as any).value === "/")) {
      const op = (next() as any).value;
      const rhs = parseFactor();
      if (op === "/" && rhs === 0) throw new Error("Division by zero in formula");
      value = op === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  function parseFactor(): number {
    const base = parseUnary();
    if (peek() && peek()!.type === "op" && (peek() as any).value === "^") {
      next();
      const exponent = parseFactor();
      return base ** exponent;
    }
    return base;
  }

  function parseUnary(): number {
    const token = peek();
    if (token && token.type === "op" && (token.value === "-" || token.value === "+")) {
      next();
      const value = parseUnary();
      return token.value === "-" ? -value : value;
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = next();
    if (!token) throw new Error("Unexpected end of formula");
    if (token.type === "num") return token.value;
    if (token.type === "lparen") {
      const value = parseExpression();
      const close = next();
      if (!close || close.type !== "rparen") throw new Error("Missing closing parenthesis");
      return value;
    }
    if (token.type === "ident") {
      const fn = FORMULA_FUNCTIONS[token.value.toLowerCase()];
      if (peek() && peek()!.type === "lparen" && fn) {
        next();
        const args: number[] = [];
        if (peek() && peek()!.type !== "rparen") {
          args.push(parseExpression());
          while (peek() && peek()!.type === "comma") {
            next();
            args.push(parseExpression());
          }
        }
        const close = next();
        if (!close || close.type !== "rparen") throw new Error(`Missing closing parenthesis after ${token.value}(`);
        return fn(...args);
      }
      if (!(token.value in inputs)) throw new Error(`Unknown input '${token.value}' in formula`);
      const value = inputs[token.value];
      if (!Number.isFinite(value)) throw new Error(`Input '${token.value}' is not a finite number`);
      return value;
    }
    throw new Error(`Unexpected token in formula`);
  }

  const result = parseExpression();
  if (pos < tokens.length) throw new Error("Unexpected trailing tokens in formula");
  if (!Number.isFinite(result)) throw new Error("Formula did not produce a finite number");
  return result;
}

// ── Validation ─────────────────────────────────────────────────────────────

export interface ValidateLineDerivationOptions {
  /** Value the derivation must reproduce (usually the row quantity). */
  expectedValue?: number | null;
  /** Relative tolerance for result comparisons. Default 0.5%. */
  relativeTolerance?: number;
  /** Absolute tolerance floor for result comparisons. Default 0.01. */
  absoluteTolerance?: number;
}

function withinTolerance(a: number, b: number, relative: number, absolute: number) {
  const diff = Math.abs(a - b);
  return diff <= Math.max(absolute, Math.abs(b) * relative);
}

export function validateLineDerivation(
  derivation: LineDerivation | null | undefined,
  options: ValidateLineDerivationOptions = {},
): LineDerivationIssue[] {
  const issues: LineDerivationIssue[] = [];
  if (!derivation || typeof derivation !== "object") {
    issues.push({ severity: "error", code: "missing_derivation", message: "A derivation (formula, inputs with sources, result) is required." });
    return issues;
  }
  const relative = options.relativeTolerance ?? 0.005;
  const absolute = options.absoluteTolerance ?? 0.01;

  const formula = String(derivation.formula ?? "").trim();
  if (!formula) {
    issues.push({ severity: "error", code: "missing_formula", message: "derivation.formula is required (e.g. 'basePlates * anchorsPerPlate')." });
  }
  const inputs = Array.isArray(derivation.inputs) ? derivation.inputs : [];
  if (inputs.length === 0) {
    issues.push({ severity: "error", code: "missing_inputs", message: "derivation.inputs must list every value the formula uses, each with a source." });
  }

  const inputMap: Record<string, number> = {};
  const seen = new Set<string>();
  for (const input of inputs) {
    const name = String(input?.name ?? "").trim();
    if (!name) {
      issues.push({ severity: "error", code: "input_missing_name", message: "Every derivation input needs a name used in the formula." });
      continue;
    }
    if (seen.has(name)) {
      issues.push({ severity: "error", code: "input_duplicate", message: `Input '${name}' is listed more than once.`, inputName: name });
    }
    seen.add(name);
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
      issues.push({ severity: "error", code: "input_not_numeric", message: `Input '${name}' must have a finite numeric value.`, inputName: name });
    } else {
      inputMap[name] = input.value;
    }
    const source = input.source;
    const kind = String(source?.kind ?? "").trim() as LineDerivationSourceKind;
    const ref = String(source?.ref ?? "").trim();
    if (!kind || !(LINE_DERIVATION_SOURCE_KINDS as readonly string[]).includes(kind)) {
      issues.push({ severity: "error", code: "input_source_kind", message: `Input '${name}' needs source.kind from: ${LINE_DERIVATION_SOURCE_KINDS.join(", ")}.`, inputName: name });
    }
    if (!ref) {
      issues.push({ severity: "error", code: "input_source_ref", message: `Input '${name}' needs source.ref (an id, URL, or document#page locator).`, inputName: name });
    }
    if (kind === "manual" && String(input.note ?? source?.excerpt ?? "").trim().length < 20) {
      issues.push({ severity: "error", code: "manual_input_rationale", message: `Input '${name}' is manual; give a note of at least 20 characters explaining the basis.`, inputName: name });
    }
  }

  if (formula) {
    const identifiers = formulaIdentifiers(formula);
    for (const identifier of identifiers) {
      if (!(identifier in inputMap) && !seen.has(identifier)) {
        issues.push({ severity: "error", code: "formula_unknown_input", message: `Formula references '${identifier}' but no input with that name is listed.`, inputName: identifier });
      }
    }
    for (const name of seen) {
      if (!identifiers.includes(name)) {
        issues.push({ severity: "warning", code: "input_unused", message: `Input '${name}' is not referenced by the formula.`, inputName: name });
      }
    }
    if (!issues.some((issue) => issue.severity === "error")) {
      try {
        const evaluated = evaluateDerivationFormula(formula, inputMap);
        const declared = Number(derivation.result?.value);
        if (!Number.isFinite(declared)) {
          issues.push({ severity: "error", code: "missing_result", message: "derivation.result.value must be a finite number." });
        } else if (!withinTolerance(evaluated, declared, relative, absolute)) {
          issues.push({ severity: "error", code: "result_mismatch", message: `Formula evaluates to ${evaluated} but result.value is ${declared}.` });
        }
        if (options.expectedValue !== undefined && options.expectedValue !== null && Number.isFinite(options.expectedValue)) {
          if (!withinTolerance(evaluated, options.expectedValue, relative, absolute)) {
            issues.push({ severity: "error", code: "result_target_mismatch", message: `Derivation produces ${evaluated} but the row ${derivation.target ?? "quantity"} is ${options.expectedValue}. Fix the row or the derivation so they agree.` });
          }
        }
      } catch (error) {
        issues.push({ severity: "error", code: "formula_invalid", message: `Formula could not be evaluated: ${(error as Error).message}` });
      }
    }
  }

  return issues;
}

// ── Per-instance callouts and contradictions ───────────────────────────────

export interface PerInstanceCallout {
  count: number;
  /** The text around the number, normalized to lower case. */
  phrase: string;
  /** Pattern that produced the match. */
  pattern: "parenthesized" | "per" | "typ" | "hyphenated" | "times" | "each";
  index: number;
}

const CALLOUT_NOUN = "([a-z0-9\"'″′#/.\\- ]{0,48})";

/**
 * Find explicit per-instance count callouts in drawing or spec text. Only
 * patterns that drafters use for per-instance counts are recognised; bare
 * numbers are ignored because they are usually dimensions or totals.
 */
export function extractPerInstanceCallouts(text: string): PerInstanceCallout[] {
  const source = String(text ?? "").replace(/\s+/g, " ");
  const lowered = source.toLowerCase();
  const callouts: PerInstanceCallout[] = [];
  const push = (count: number, phrase: string, pattern: PerInstanceCallout["pattern"], index: number) => {
    if (!Number.isFinite(count) || count <= 0 || count > 1000) return;
    callouts.push({ count, phrase: phrase.trim(), pattern, index });
  };

  // (1) 1" dia hole   /  c/w (4) anchors
  for (const match of lowered.matchAll(new RegExp(`\\((\\d{1,4})\\)\\s*${CALLOUT_NOUN}`, "g"))) {
    push(Number(match[1]), `(${match[1]}) ${match[2] ?? ""}`, "parenthesized", match.index ?? 0);
  }
  // 4 PER PLATE / 2 EA PER COLUMN / 4 ANCHORS PER BASE PLATE
  for (const match of lowered.matchAll(new RegExp(`\\b(\\d{1,4})\\s*(?:ea\\.?|each|pcs?|nos?\\.?)?\\s*${CALLOUT_NOUN}?\\bper\\b\\s*${CALLOUT_NOUN}`, "g"))) {
    push(Number(match[1]), match[0], "per", match.index ?? 0);
  }
  // TYP 4 / TYP. (4) / 4 TYP / (4) TYP
  for (const match of lowered.matchAll(/\btyp\.?\s*\(?(\d{1,4})\)?\b/g)) {
    push(Number(match[1]), match[0], "typ", match.index ?? 0);
  }
  for (const match of lowered.matchAll(/\(?\b(\d{1,4})\)?\s*(?:places?\s*)?typ\.?\b/g)) {
    push(Number(match[1]), match[0], "typ", match.index ?? 0);
  }
  // 4-HOLES / 4 HOLES / 4-BOLTS
  for (const match of lowered.matchAll(/\b(\d{1,4})\s*[- ]\s*(holes?|bolts?|anchors?|studs?|rods?|lugs?|clips?|fasteners?|screws?|nuts?|washers?|places?|plcs?|pcs?|nos?)\b/g)) {
    push(Number(match[1]), match[0], "hyphenated", match.index ?? 0);
  }
  // x4 / 4x (only when followed by a noun to avoid dimensions like 8x8)
  for (const match of lowered.matchAll(/\b(?:x|×)\s*(\d{1,4})\s+(holes?|bolts?|anchors?|studs?|rods?|lugs?|clips?|fasteners?|screws?)\b/g)) {
    push(Number(match[1]), match[0], "times", match.index ?? 0);
  }

  return callouts.sort((a, b) => a.index - b.index);
}

export interface PerInstanceContradiction {
  inputName: string;
  claimedValue: number;
  textValue: number;
  excerpt: string;
  ref: string;
  pattern: PerInstanceCallout["pattern"];
}

const STOP_TERMS = new Set([
  "per", "each", "ea", "the", "and", "for", "with", "dia", "inch", "in", "mm", "ss", "typ", "of", "to", "at", "on",
  "count", "qty", "quantity", "number", "total", "plate", "plates", "base",
]);

function stem(term: string) {
  return term.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(es|s)$/, "");
}

function instanceTerms(input: LineDerivationInput): string[] {
  const raw = [input.name, input.instanceOf ?? "", input.note ?? "", input.unit ?? ""].join(" ");
  return [...new Set(
    raw
      .replace(/([a-z])([A-Z])/g, "$1 $2") // split camelCase
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map(stem)
      .filter((term) => term.length >= 3 && !STOP_TERMS.has(term)),
  )];
}

function isPerInstanceInput(input: LineDerivationInput) {
  if (input.perInstance === true) return true;
  const name = String(input.name ?? "").toLowerCase();
  return /per[A-Z_]|_per_|per\b|each|every/.test(input.name ?? "") || /per|each/.test(name);
}

/**
 * Compare per-instance derivation inputs against explicit callouts in the
 * texts the row cites. Deterministic and per-instance only.
 */
export function detectPerInstanceContradictions(
  derivation: LineDerivation | null | undefined,
  texts: Array<{ ref: string; text: string }>,
): PerInstanceContradiction[] {
  if (!derivation || !Array.isArray(derivation.inputs)) return [];
  const contradictions: PerInstanceContradiction[] = [];
  for (const input of derivation.inputs) {
    if (!isPerInstanceInput(input)) continue;
    if (typeof input.value !== "number" || !Number.isFinite(input.value)) continue;
    const terms = instanceTerms(input);
    if (terms.length === 0) continue;
    for (const entry of texts) {
      const callouts = extractPerInstanceCallouts(entry.text ?? "");
      for (const callout of callouts) {
        const phraseTerms = callout.phrase.split(/[^a-z0-9]+/).map(stem).filter(Boolean);
        const related = phraseTerms.some((term) => terms.includes(term));
        if (!related) continue;
        if (callout.count === input.value) continue;
        contradictions.push({
          inputName: input.name,
          claimedValue: input.value,
          textValue: callout.count,
          excerpt: callout.phrase.slice(0, 160),
          ref: entry.ref,
          pattern: callout.pattern,
        });
      }
    }
  }
  return contradictions;
}

// ── Unit and procurement reconciliation ────────────────────────────────────

export const PACKAGED_UOMS = ["PK", "PACK", "PKG", "BOX", "BX", "CTN", "CARTON", "CASE", "CS", "BAG", "PAIL", "ROLL", "RL", "KIT", "SET", "CART", "CARTRIDGE", "TUBE"] as const;

export function isPackagedUom(uom: string | null | undefined) {
  return (PACKAGED_UOMS as readonly string[]).includes(String(uom ?? "").trim().toUpperCase());
}

export function packsRequired(installedQuantity: number, packSize: number, wasteFactor = 0): number {
  if (!Number.isFinite(installedQuantity) || !Number.isFinite(packSize) || packSize <= 0) return NaN;
  return Math.ceil((installedQuantity * (1 + Math.max(0, wasteFactor))) / packSize);
}

export interface ProcurementReconciliationInput {
  /** Count the labour/installation row says will be installed, in base units. */
  installedQuantity: number;
  installedUom?: string | null;
  /** Quantity on the material/purchase row. */
  purchaseQuantity: number;
  purchaseUom?: string | null;
  /** Base units per purchase unit when the purchase UOM is a pack/box/cartridge. */
  packSize?: number | null;
  wasteFactor?: number | null;
}

export interface ProcurementReconciliationResult {
  ok: boolean;
  issues: LineDerivationIssue[];
  suppliedBaseUnits: number | null;
  requiredPurchaseQuantity: number | null;
}

/** Check that what is bought covers what is installed. */
export function reconcileProcurementQuantities(input: ProcurementReconciliationInput): ProcurementReconciliationResult {
  const issues: LineDerivationIssue[] = [];
  const packaged = isPackagedUom(input.purchaseUom);
  const packSize = Number(input.packSize ?? NaN);
  let suppliedBaseUnits: number | null = null;
  let requiredPurchaseQuantity: number | null = null;

  if (packaged && !(Number.isFinite(packSize) && packSize > 0)) {
    issues.push({ severity: "error", code: "pack_size_unknown", message: `Purchase UOM '${input.purchaseUom}' is a package unit; packSize (base units per package) is required to reconcile against ${input.installedQuantity} installed.` });
    return { ok: false, issues, suppliedBaseUnits, requiredPurchaseQuantity };
  }

  const perUnit = packaged ? packSize : 1;
  suppliedBaseUnits = input.purchaseQuantity * perUnit;
  requiredPurchaseQuantity = packaged
    ? packsRequired(input.installedQuantity, packSize, input.wasteFactor ?? 0)
    : Math.ceil(input.installedQuantity * (1 + Math.max(0, input.wasteFactor ?? 0)));

  if (suppliedBaseUnits < input.installedQuantity) {
    issues.push({
      severity: "error",
      code: "procurement_shortfall",
      message: `Purchasing ${input.purchaseQuantity} ${input.purchaseUom ?? "units"}${packaged ? ` × ${packSize}` : ""} supplies ${suppliedBaseUnits} but ${input.installedQuantity} ${input.installedUom ?? "EA"} are installed. Buy at least ${requiredPurchaseQuantity}.`,
    });
  } else if (suppliedBaseUnits > input.installedQuantity * 2 && input.installedQuantity > 0) {
    issues.push({
      severity: "warning",
      code: "procurement_excess",
      message: `Purchasing ${suppliedBaseUnits} base units for ${input.installedQuantity} installed is more than double; confirm the overage is intentional.`,
    });
  }
  return { ok: !issues.some((issue) => issue.severity === "error"), issues, suppliedBaseUnits, requiredPurchaseQuantity };
}

export type LinearUnit = "in" | "ft" | "mm" | "cm" | "m";

const TO_METRES: Record<LinearUnit, number> = { in: 0.0254, ft: 0.3048, mm: 0.001, cm: 0.01, m: 1 };
const FT3_PER_M3 = 35.3146667;

export interface RectangularVolume {
  m3: number;
  ft3: number;
  in3: number;
  litres: number;
}

/** Volume of a rectangular prism in several units. */
export function rectangularVolume(length: number, width: number, thickness: number, unit: LinearUnit): RectangularVolume {
  const factor = TO_METRES[unit];
  const m3 = length * factor * width * factor * thickness * factor;
  return {
    m3,
    ft3: m3 * FT3_PER_M3,
    in3: m3 / (0.0254 ** 3),
    litres: m3 * 1000,
  };
}

export interface GroutVolumeInput {
  plateLength: number;
  plateWidth: number;
  bedThickness: number;
  unit: LinearUnit;
  plateCount: number;
  /** Fraction added for waste and irregular bed. Default 15%. */
  wasteFactor?: number;
  /** Yield of one bag/unit of grout in ft³ (typical 50 lb bag ≈ 0.45–0.5 ft³). */
  bagYieldFt3?: number;
}

export interface GroutVolumeResult {
  perPlateFt3: number;
  totalFt3: number;
  totalWithWasteFt3: number;
  totalLitres: number;
  bags: number | null;
}

/** Grout under base plates: area × bed thickness × count, plus waste. */
export function groutVolumeUnderPlates(input: GroutVolumeInput): GroutVolumeResult {
  const perPlate = rectangularVolume(input.plateLength, input.plateWidth, input.bedThickness, input.unit);
  const waste = Math.max(0, input.wasteFactor ?? 0.15);
  const totalFt3 = perPlate.ft3 * input.plateCount;
  const totalWithWasteFt3 = totalFt3 * (1 + waste);
  const bags = input.bagYieldFt3 && input.bagYieldFt3 > 0 ? Math.ceil(totalWithWasteFt3 / input.bagYieldFt3) : null;
  return {
    perPlateFt3: perPlate.ft3,
    totalFt3,
    totalWithWasteFt3,
    totalLitres: perPlate.litres * input.plateCount * (1 + waste),
    bags,
  };
}

// ── Dependency helpers ─────────────────────────────────────────────────────

export function derivationReferencesItem(derivation: LineDerivation | null | undefined, itemId: string): boolean {
  if (!derivation || !Array.isArray(derivation.inputs)) return false;
  return derivation.inputs.some((input) => input.source?.kind === "item" && String(input.source.ref ?? "") === itemId);
}

export function markDerivationStale(derivation: LineDerivation, invalidation: LineDerivationInvalidation): LineDerivation {
  return {
    ...derivation,
    status: "stale",
    invalidatedBy: [...(derivation.invalidatedBy ?? []), invalidation],
  };
}

/** Fields whose change invalidates a derivation that targets them. */
export const DERIVATION_TARGET_FIELDS: Record<LineDerivationTarget, string[]> = {
  quantity: ["quantity", "uom"],
  tierUnits: ["tierUnits", "quantity"],
  cost: ["cost"],
  price: ["price", "markup", "cost"],
};

export function derivationInvalidatedByFields(derivation: LineDerivation | null | undefined, changedFields: string[]): string[] {
  if (!derivation) return [];
  const target = derivation.target ?? "quantity";
  const watched = DERIVATION_TARGET_FIELDS[target] ?? DERIVATION_TARGET_FIELDS.quantity;
  return changedFields.filter((field) => watched.includes(field));
}

/** Normalize loosely-shaped JSON into a LineDerivation, or null if unusable. */
export function normalizeLineDerivation(value: unknown): LineDerivation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  // An empty object is how the store clears a derivation (nullable JSON
  // columns cannot be set to null without the Prisma runtime namespace).
  if (!String(raw.formula ?? "").trim() && !(Array.isArray(raw.inputs) && raw.inputs.length > 0)) return null;
  const inputs = Array.isArray(raw.inputs)
    ? raw.inputs.map((entry) => {
        const input = (entry ?? {}) as Record<string, unknown>;
        const source = (input.source ?? {}) as Record<string, unknown>;
        return {
          name: String(input.name ?? "").trim(),
          value: Number(input.value),
          unit: input.unit === undefined ? null : (input.unit as string | null),
          perInstance: input.perInstance === true,
          instanceOf: (input.instanceOf as string | null | undefined) ?? null,
          source: {
            kind: String(source.kind ?? "").trim() as LineDerivationSourceKind,
            ref: String(source.ref ?? "").trim(),
            excerpt: (source.excerpt as string | null | undefined) ?? null,
          },
          note: (input.note as string | null | undefined) ?? null,
        } satisfies LineDerivationInput;
      })
    : [];
  const result = (raw.result ?? {}) as Record<string, unknown>;
  const status = String(raw.status ?? "draft") as LineDerivationStatus;
  return {
    version: Number.isFinite(Number(raw.version)) && Number(raw.version) > 0 ? Math.trunc(Number(raw.version)) : 1,
    target: (["quantity", "tierUnits", "cost", "price"].includes(String(raw.target)) ? String(raw.target) : "quantity") as LineDerivationTarget,
    formula: String(raw.formula ?? "").trim(),
    inputs,
    result: { value: Number(result.value), unit: (result.unit as string | null | undefined) ?? null },
    status: ["draft", "verified", "reviewed", "stale"].includes(status) ? status : "draft",
    computedAt: (raw.computedAt as string | null | undefined) ?? null,
    invalidatedBy: Array.isArray(raw.invalidatedBy) ? (raw.invalidatedBy as LineDerivationInvalidation[]) : [],
    notes: (raw.notes as string | null | undefined) ?? null,
  };
}

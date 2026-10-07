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

/**
 * Explicit installed-vs-procurement relationship for a purchase row. The link
 * is declared, never inferred from shared views, so unrelated rows are not
 * compared. Either `suppliesItemId` (optionally with `installedFromInput`, an
 * input name on that row's derivation) or an explicit `installedQuantity`
 * must identify what this purchase has to cover.
 */
export interface LineDerivationProcurement {
  /** Worksheet item id of the installed/labour row this purchase supplies. */
  suppliesItemId?: string | null;
  /** Name of a derivation input on the linked row that holds the installed count (defaults to that row's quantity). */
  installedFromInput?: string | null;
  /** Explicit installed requirement when no row link exists. */
  installedQuantity?: number | null;
  installedUom?: string | null;
  /** Base units per purchase unit: rods per pack, anchors per cartridge, ft³ per bag. */
  packSize?: number | null;
  /** Fraction added for waste/breakage, e.g. 0.15. */
  wasteFactor?: number | null;
  /** Required when supplied base units exceed twice the requirement. */
  surplusRationale?: string | null;
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
  procurement?: LineDerivationProcurement | null;
  /** Server-computed review flags (see flagDerivationAssumptions). Never trusted from the caller. */
  reviewFlags?: LineDerivationReviewFlag[];
}

export interface LineDerivationReviewFlag {
  code: "assumed_inputs" | "assumption_dominated";
  message: string;
  inputs: string[];
  /**
   * For assumption_dominated: what the evidence inputs (all factors of 1)
   * actually establish. physical_count = a drawing count of a real object
   * (legitimate "1 machine x assumed hours"); scope_only = a package/lot/scope
   * factor; unclassified = no positive physical evidence either way;
   * assumption_only = no evidence input at all.
   */
  basis?: DominatedEvidenceBasis;
}

export type DominatedEvidenceBasis = "physical_count" | "scope_only" | "unclassified" | "assumption_only";

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

/**
 * Plural to singular for matching input names against callout phrases.
 * Stripping a bare "es" turned "holes" into "hol", so a holesPerPlate input
 * never matched a "(1) 1\" dia hole" callout.
 */
function stem(term: string) {
  const word = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/(ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
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

/**
 * Rates, durations and money are never instance counts. "baseDrillHoursPerHole
 * = 0.24 HR/EA" was compared with a drawing's "(1) 1\" dia hole" callout and
 * the row was rejected (2026-10-07 GPT matrix). A per-instance count is a
 * count of things, so anything with a rate/time unit or a rate-like name is
 * excluded, even when the agent marked it perInstance.
 */
function isRateLikeInput(input: LineDerivationInput) {
  const unit = String(input.unit ?? "").trim();
  if (unit.includes("/") || isRateOrTimeUom(unit)) return true;
  const words = String(input.name ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return /\b(hours?|hrs?|mh|minutes?|mins?|days?|duration|rate|rates|cost|price|dollars?|productivity|factor|percent|pct)\b/.test(words);
}

function isPerInstanceInput(input: LineDerivationInput) {
  if (isRateLikeInput(input)) return false;
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
      message: `Purchasing ${input.purchaseQuantity} ${input.purchaseUom ?? "units"}${packaged ? ` × ${packSize}` : ""} supplies ${suppliedBaseUnits} but ${input.installedQuantity} ${input.installedUom ?? "EA"} are installed — short by ${input.installedQuantity - suppliedBaseUnits}. Buy at least ${requiredPurchaseQuantity}.`,
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

const RATE_OR_TIME_UOMS = new Set(["HR", "HRS", "HOUR", "HOURS", "MH", "DAY", "DAYS", "WK", "WEEK", "WEEKS", "MO", "MONTH", "MONTHS", "SHIFT", "CREW", "LS", "LUMP", "LUMPSUM", "%"]);

/** UOMs whose row quantity is time, crew, or lump-sum rather than a physical count. */
export function isRateOrTimeUom(uom: string | null | undefined) {
  return RATE_OR_TIME_UOMS.has(String(uom ?? "").trim().toUpperCase());
}

const UOM_SYNONYM_GROUPS: string[][] = [
  ["EA", "EACH", "EACHES", "PC", "PCS", "PIECE", "PIECES", "NO", "NOS", "UNIT", "UNITS"],
  ["FT", "FEET", "FOOT", "LF", "LIN FT", "LINFT"],
  ["M", "METRE", "METRES", "METER", "METERS", "LM"],
  ["IN", "INCH", "INCHES"],
  ["MM", "MILLIMETRE", "MILLIMETRES", "MILLIMETER", "MILLIMETERS"],
  ["SF", "SQFT", "SQ FT", "FT2", "FT²"],
  ["SM", "M2", "M²", "SQM", "SQ M"],
  ["CF", "CUFT", "CU FT", "FT3", "FT³"],
  ["CM3", "M3", "M³", "CUM", "CU M"],
  ["LB", "LBS", "POUND", "POUNDS"],
  ["KG", "KGS", "KILOGRAM", "KILOGRAMS"],
  ["HR", "HRS", "HOUR", "HOURS", "MH"],
];
const UOM_CANONICAL = new Map<string, string>();
for (const group of UOM_SYNONYM_GROUPS) for (const member of group) UOM_CANONICAL.set(member, group[0]);

/** Same unit, allowing spelling/abbreviation synonyms (EA/each, FT/feet). Never a conversion. */
export function uomsEquivalent(a: string | null | undefined, b: string | null | undefined) {
  const left = String(a ?? "").trim().toUpperCase();
  const right = String(b ?? "").trim().toUpperCase();
  if (!left || !right) return true; // nothing to conflict with
  if (left === right) return true;
  return (UOM_CANONICAL.get(left) ?? left) === (UOM_CANONICAL.get(right) ?? right);
}

export interface ProcurementLinkContext {
  /** The purchase row being checked. */
  purchaseQuantity: number;
  purchaseUom?: string | null;
  /** Resolve a linked row: returns its quantity/uom and derivation, or null when unknown. */
  resolveItem?: (itemId: string) => { quantity: number; uom?: string | null; derivation?: LineDerivation | null; entityName?: string | null } | null;
}

export interface ProcurementLinkResult {
  ok: boolean;
  issues: LineDerivationIssue[];
  installedQuantity: number | null;
  installedSource: "explicit" | "linked_quantity" | "linked_input" | null;
  suppliedBaseUnits: number | null;
  requiredPurchaseQuantity: number | null;
}

/**
 * Evaluate a declared installed/procurement relationship. Shortfalls are
 * errors; a surplus above 2x needs a written rationale; a packaged UOM
 * without packSize is an error because nothing can be reconciled.
 */
export function evaluateProcurementLink(
  procurement: LineDerivationProcurement | null | undefined,
  context: ProcurementLinkContext,
): ProcurementLinkResult {
  const none: ProcurementLinkResult = { ok: true, issues: [], installedQuantity: null, installedSource: null, suppliedBaseUnits: null, requiredPurchaseQuantity: null };
  if (!procurement) return none;
  const issues: LineDerivationIssue[] = [];

  let installedQuantity: number | null = null;
  let installedSource: ProcurementLinkResult["installedSource"] = null;
  let installedUom: string | null | undefined = procurement.installedUom ?? null;
  const linkedId = String(procurement.suppliesItemId ?? "").trim();
  if (linkedId) {
    const linked = context.resolveItem?.(linkedId) ?? null;
    if (!linked) {
      issues.push({ severity: "error", code: "procurement_link_unresolved", message: `procurement.suppliesItemId '${linkedId}' does not resolve to a worksheet item in this revision.` });
    } else if (procurement.installedFromInput) {
      const input = (linked.derivation?.inputs ?? []).find((entry) => entry.name === procurement.installedFromInput);
      if (!input || !Number.isFinite(input.value)) {
        issues.push({ severity: "error", code: "procurement_input_missing", message: `Linked row ${linkedId}${linked.entityName ? ` ("${linked.entityName}")` : ""} has no derivation input named '${procurement.installedFromInput}'.` });
      } else if (procurement.installedUom && !uomsEquivalent(procurement.installedUom, input.unit)) {
        // An explicit unit must never reinterpret the sourced number
        // (10 FT labelled M would silently become 10 M).
        issues.push({ severity: "error", code: "procurement_unit_conflict", message: `procurement.installedUom '${procurement.installedUom}' conflicts with linked input '${input.name}' whose unit is '${input.unit}'. Units are not converted here: source a separately converted input on that row (e.g. '${input.name}${String(procurement.installedUom).replace(/[^A-Za-z0-9]/g, "")}') and link that instead, or drop installedUom to use the input's unit.` });
      } else {
        installedQuantity = input.value;
        installedUom = installedUom ?? input.unit ?? null;
        installedSource = "linked_input";
      }
    } else if (isRateOrTimeUom(linked.uom)) {
      // A labour/rate row's quantity is crew or rate units (2 crew, 1 LS),
      // not a physical count. Comparing packs against it would be meaningless.
      const candidates = (linked.derivation?.inputs ?? []).filter((entry) => entry.perInstance !== true && !isRateOrTimeUom(entry.unit)).map((entry) => entry.name);
      issues.push({ severity: "error", code: "procurement_requirement_ambiguous", message: `Linked row ${linkedId}${linked.entityName ? ` ("${linked.entityName}")` : ""} is a ${linked.uom ?? "rate"} row; its quantity (${linked.quantity}) is crew/rate units, not an installed count. Set procurement.installedFromInput to the physical-count input on that row${candidates.length > 0 ? ` (one of: ${candidates.join(", ")})` : ""}, or give installedQuantity explicitly.` });
    } else if (procurement.installedUom && !uomsEquivalent(procurement.installedUom, linked.uom)) {
      issues.push({ severity: "error", code: "procurement_unit_conflict", message: `procurement.installedUom '${procurement.installedUom}' conflicts with linked row ${linkedId} whose UOM is '${linked.uom}'. Units are not converted here: give installedQuantity in the row's unit, or link a converted derivation input via installedFromInput.` });
    } else {
      installedQuantity = linked.quantity;
      installedUom = installedUom ?? linked.uom ?? null;
      installedSource = "linked_quantity";
    }
  } else if (typeof procurement.installedQuantity === "number" && Number.isFinite(procurement.installedQuantity)) {
    installedQuantity = procurement.installedQuantity;
    installedSource = "explicit";
  } else {
    issues.push({ severity: "error", code: "procurement_requirement_missing", message: "procurement needs suppliesItemId (optionally installedFromInput) or an explicit installedQuantity so the purchase can be reconciled against what is installed." });
  }
  if (issues.length > 0 || installedQuantity === null) {
    return { ok: false, issues, installedQuantity, installedSource, suppliedBaseUnits: null, requiredPurchaseQuantity: null };
  }

  const reconciled = reconcileProcurementQuantities({
    installedQuantity,
    installedUom,
    purchaseQuantity: context.purchaseQuantity,
    purchaseUom: context.purchaseUom ?? null,
    packSize: procurement.packSize ?? null,
    wasteFactor: procurement.wasteFactor ?? null,
  });
  for (const issue of reconciled.issues) {
    if (issue.code === "procurement_excess") {
      const rationale = String(procurement.surplusRationale ?? "").trim();
      if (rationale.length >= 20) continue; // explained surplus is acceptable (minimum pack, spares)
      issues.push({ severity: "error", code: "procurement_excess_unexplained", message: `${issue.message} Add procurement.surplusRationale (>= 20 chars), e.g. "minimum one cartridge; remainder is spares".` });
      continue;
    }
    issues.push(issue);
  }
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
    installedQuantity,
    installedSource,
    suppliedBaseUnits: reconciled.suppliedBaseUnits,
    requiredPurchaseQuantity: reconciled.requiredPurchaseQuantity,
  };
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

/**
 * Does this derivation rest on a given source document? True when an input
 * cites one of the document's evidence views, or cites document text/claims
 * whose ref is the document id (optionally suffixed with #page).
 */
export function derivationReferencesDocument(
  derivation: LineDerivation | null | undefined,
  documentId: string,
  viewIdsForDocument: Iterable<string> = [],
): boolean {
  if (!derivation || !Array.isArray(derivation.inputs) || !documentId) return false;
  const views = new Set(viewIdsForDocument);
  return derivation.inputs.some((input) => {
    const kind = input.source?.kind;
    const ref = String(input.source?.ref ?? "");
    if (kind === "view") return views.has(ref);
    if (kind === "text" || kind === "document") return ref === documentId || ref.startsWith(`${documentId}#`);
    return false;
  });
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
    procurement: normalizeProcurement(raw.procurement),
    reviewFlags: normalizeReviewFlags(raw.reviewFlags),
  };
}

function normalizeReviewFlags(value: unknown): LineDerivationReviewFlag[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (entry && typeof entry === "object" ? entry as Record<string, unknown> : {}))
    .filter((entry) => entry.code === "assumed_inputs" || entry.code === "assumption_dominated")
    .map((entry) => ({
      code: entry.code as LineDerivationReviewFlag["code"],
      message: String(entry.message ?? ""),
      inputs: Array.isArray(entry.inputs) ? entry.inputs.map(String) : [],
      ...(["physical_count", "scope_only", "unclassified", "assumption_only"].includes(String(entry.basis)) ? { basis: entry.basis as DominatedEvidenceBasis } : {}),
    }));
}

// ── Assumed inputs ─────────────────────────────────────────────────────────

/** Sources that are the estimator's or agent's judgement rather than a document, view, library or answer. */
const UNVERIFIED_SOURCE_KINDS = new Set<LineDerivationSourceKind>(["assumption", "manual"]);

/**
 * Which inputs of a derivation are assumed, and whether assumptions set its
 * magnitude. On the 2026-10-07 GPT matrix a 96 h platform-erection row was
 * labelled drawing_quantity because one input, "installationPackages = 1",
 * cited a view; crewMembers 3 × crewDays 4 × hoursPerDay 8 all came from an
 * assumption. A value of 1 sourced from evidence does not size anything, so
 * the row is assumption-dominated.
 */
/**
 * Lookups that let assumption flags follow references. A derivation input that
 * cites a claim whose method is "assumption" is as assumed as one citing the
 * assumption directly (round-3 GPT carried 80 deck fastenings that way and the
 * row was unflagged). An input that cites another worksheet item inherits the
 * same-named input of that item's derivation, or the item's own dominance.
 */
export interface DerivationSourceLookup {
  claimMethod?: (claimId: string) => string | null | undefined;
  claimInfo?: (claimId: string) => { method: string; unit: string; quantityName: string } | null | undefined;
  itemDerivation?: (itemId: string) => LineDerivation | null | undefined;
}

const MAX_REFERENCE_DEPTH = 8;

function inputIsAssumed(input: LineDerivationInput, lookup: DerivationSourceLookup, visited: Set<string>): boolean {
  const kind = input.source?.kind;
  const ref = String(input.source?.ref ?? "").trim();
  if (UNVERIFIED_SOURCE_KINDS.has(kind)) return true;
  if (kind === "claim") return String(lookup.claimMethod?.(ref) ?? "").trim().toLowerCase() === "assumption";
  if (kind === "item" && ref && lookup.itemDerivation) {
    // A reference cycle or an over-long chain cannot establish a source: treat as assumed.
    if (visited.has(ref) || visited.size >= MAX_REFERENCE_DEPTH) return true;
    const linked = lookup.itemDerivation(ref);
    if (!linked) return false;
    const next = new Set(visited).add(ref);
    const sameName = linked.inputs.find((candidate) => candidate.name === input.name);
    if (sameName) return inputIsAssumed(sameName, lookup, next);
    return summarize(linked, lookup, next).dominated;
  }
  return false;
}

const FORMULA_FUNCTION_NAMES = new Set(["ceil", "floor", "round", "min", "max", "abs", "sqrt", "pow"]);

/**
 * Inputs the formula actually uses. Round-3 GPT attached evidence inputs
 * (2 interfaces, 12 fixing locations) to a "mechanics * crewDuration" row; they
 * do not size the result and must not make it look evidence-backed. With no
 * parseable formula every input is treated as used.
 */
function formulaInputs(derivation: LineDerivation): LineDerivationInput[] {
  const identifiers = new Set((String(derivation.formula ?? "").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).filter((name) => !FORMULA_FUNCTION_NAMES.has(name.toLowerCase())));
  if (identifiers.size === 0) return derivation.inputs;
  const used = derivation.inputs.filter((input) => identifiers.has(input.name));
  return used.length > 0 ? used : derivation.inputs;
}

function summarize(derivation: LineDerivation | null | undefined, lookup: DerivationSourceLookup, visited: Set<string>) {
  const inputs = derivation?.inputs ?? [];
  const assumed = inputs.filter((input) => inputIsAssumed(input, lookup, visited));
  const assumedNames = new Set(assumed.map((input) => input.name));
  const sizing = (derivation ? formulaInputs(derivation) : []).filter((input) => Number.isFinite(input.value) && input.value !== 1 && input.value !== 0);
  const dominated = assumed.length > 0 && sizing.length > 0 && sizing.every((input) => assumedNames.has(input.name));
  return {
    assumedInputs: assumed.map((input) => input.name),
    assumptionRefs: [...new Set(assumed.map((input) => input.source?.ref).filter(Boolean))] as string[],
    dominated,
  };
}

/**
 * Which inputs of a derivation are assumed, and whether assumptions set its
 * magnitude. On the 2026-10-07 GPT matrix a 96 h platform-erection row was
 * labelled drawing_quantity because one input, "installationPackages = 1",
 * cited a view; crewMembers 3 × crewDays 4 × hoursPerDay 8 all came from an
 * assumption. A value of 1 sourced from evidence does not size anything, so
 * the row is assumption-dominated.
 */
export function summarizeDerivationAssumptions(derivation: LineDerivation | null | undefined, lookup: DerivationSourceLookup = {}) {
  return summarize(derivation, lookup, new Set());
}

const SCOPE_ONLY_UNITS = new Set(["LOT", "LOTS", "LS", "LUMP", "LUMPSUM", "SCOPE", "PKG", "PACKAGE", "PACKAGES"]);
const COUNT_UNITS = new Set(["EA", "EACH", "PC", "PCS", "PIECE", "PIECES", "NO", "NOS", "UNIT", "UNITS"]);
const PHYSICAL_COUNT_METHODS = new Set(["visual_count", "bom_table", "drawing_table", "takeoff"]);
const SCOPE_ONLY_NAME = /\b(packages?|scope|lots?|work assembl(?:y|ies))\b/;

function words(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}

/**
 * What a factor-of-1 evidence input establishes. Scope-only needs an explicit
 * LOT/LS/SCOPE/PKG unit or package/scope/lot/work-assembly naming. Physical
 * needs positive evidence: a counting claim (visual_count, BOM/drawing table,
 * or takeoff) in a count unit. Everything else, including SET and bare view
 * inputs, stays unclassified.
 */
export function classifyFactorOneEvidence(input: LineDerivationInput, lookup: DerivationSourceLookup = {}): "physical_count" | "scope_only" | "unclassified" {
  const claim = input.source?.kind === "claim" ? lookup.claimInfo?.(String(input.source.ref ?? "").trim()) : null;
  const units = [input.unit, claim?.unit].map((unit) => String(unit ?? "").trim().toUpperCase()).filter(Boolean);
  const names = words(`${input.name ?? ""} ${claim?.quantityName ?? ""}`);
  if (units.some((unit) => SCOPE_ONLY_UNITS.has(unit)) || SCOPE_ONLY_NAME.test(names)) return "scope_only";
  if (claim && PHYSICAL_COUNT_METHODS.has(claim.method.trim().toLowerCase()) && units.length > 0 && units.every((unit) => COUNT_UNITS.has(unit))) return "physical_count";
  return "unclassified";
}

function dominatedBasis(derivation: LineDerivation, assumedNames: Set<string>, lookup: DerivationSourceLookup): DominatedEvidenceBasis {
  const evidence = formulaInputs(derivation).filter((input) => !assumedNames.has(input.name) && ["view", "claim"].includes(String(input.source?.kind)));
  if (evidence.length === 0) return "assumption_only";
  const kinds = evidence.map((input) => classifyFactorOneEvidence(input, lookup));
  if (kinds.includes("physical_count")) return "physical_count";
  if (kinds.includes("scope_only")) return "scope_only";
  return "unclassified";
}

const DOMINATED_BASIS_TEXT: Record<DominatedEvidenceBasis, string> = {
  physical_count: "The drawing counts a physical object; the hours per object are assumed.",
  scope_only: "The drawing only confirms the scope exists (a package/lot factor of 1); it does not size the hours.",
  unclassified: "The evidence inputs are factors of 1 that do not establish a physical count.",
  assumption_only: "No input comes from a drawing, document, or library.",
};

/** Review flags recomputed on every write; callers cannot supply or clear them. */
export function flagDerivationAssumptions(derivation: LineDerivation, lookup: DerivationSourceLookup = {}): LineDerivationReviewFlag[] {
  const summary = summarizeDerivationAssumptions(derivation, lookup);
  if (summary.assumedInputs.length === 0) return [];
  const refs = summary.assumptionRefs.length > 0 ? ` (${summary.assumptionRefs.join(", ")})` : "";
  if (summary.dominated) {
    const basis = dominatedBasis(derivation, new Set(summary.assumedInputs), lookup);
    return [{
      code: "assumption_dominated",
      message: `Every input that sizes this result is assumed${refs}: ${summary.assumedInputs.join(", ")}. ${DOMINATED_BASIS_TEXT[basis]}`,
      inputs: summary.assumedInputs,
      basis,
    }];
  }
  return [{
    code: "assumed_inputs",
    message: `Some inputs are assumed${refs}: ${summary.assumedInputs.join(", ")}.`,
    inputs: summary.assumedInputs,
  }];
}

export type HourBasisCategory = "sourced" | "partly_assumed" | "assumed_physical_count" | "assumed_scope_only" | "assumed_unclassified" | "assumed_only" | "no_derivation";

/** Which basis a row's hours rest on, from its derivation's sources, never from the evidence-basis label. */
export function classifyHourBasis(derivation: LineDerivation | null | undefined, lookup: DerivationSourceLookup = {}): HourBasisCategory {
  if (!derivation || derivation.inputs.length === 0) return "no_derivation";
  const [flag] = flagDerivationAssumptions(derivation, lookup);
  if (!flag) return "sourced";
  if (flag.code === "assumed_inputs") return "partly_assumed";
  switch (flag.basis) {
    case "physical_count": return "assumed_physical_count";
    case "scope_only": return "assumed_scope_only";
    case "assumption_only": return "assumed_only";
    default: return "assumed_unclassified";
  }
}

export interface HourBasisSummary {
  /** What the numbers measure; always direct labour hours before estimate factors. */
  unit: "direct_labour_hours_before_estimate_factors";
  /** Sum of byBasis; equals the direct labour hours of the rows passed in. */
  total: number;
  byBasis: Record<HourBasisCategory, number>;
}

/**
 * Hours per basis across rows. `hoursOf` must return a row's DIRECT labour
 * hours (0 for equipment duration, materials, etc.); estimate factors are not
 * classified and are reported separately by the caller. Every row lands in
 * exactly one category, so byBasis always sums to total.
 */
export function summarizeHourBasis<T extends { derivation?: unknown }>(rows: T[], hoursOf: (row: T) => number, lookup: DerivationSourceLookup = {}): HourBasisSummary {
  const byBasis: Record<HourBasisCategory, number> = { sourced: 0, partly_assumed: 0, assumed_physical_count: 0, assumed_scope_only: 0, assumed_unclassified: 0, assumed_only: 0, no_derivation: 0 };
  let total = 0;
  for (const row of rows) {
    const hours = Number(hoursOf(row));
    if (!Number.isFinite(hours) || hours <= 0) continue;
    byBasis[classifyHourBasis(normalizeLineDerivation(row.derivation), lookup)] += hours;
    total += hours;
  }
  for (const key of Object.keys(byBasis) as HourBasisCategory[]) byBasis[key] = Math.round(byBasis[key] * 100) / 100;
  return { unit: "direct_labour_hours_before_estimate_factors", total: Math.round(total * 100) / 100, byBasis };
}

/** Lookup built from a strategy's Drawing Evidence Engine claims and a set of rows' derivations. */
export function derivationSourceLookup(claims: unknown, items: Array<{ id?: unknown; derivation?: unknown }>): DerivationSourceLookup {
  const info = new Map<string, { method: string; unit: string; quantityName: string }>();
  for (const claim of Array.isArray(claims) ? claims : []) {
    const record = (claim ?? {}) as Record<string, unknown>;
    const id = String(record.claimId ?? record.id ?? "").trim();
    if (id) info.set(id, { method: String(record.method ?? ""), unit: String(record.unit ?? ""), quantityName: String(record.quantityName ?? record.claim ?? "") });
  }
  const derivations = new Map<string, LineDerivation>();
  for (const item of items) {
    const id = String(item.id ?? "").trim();
    const derivation = normalizeLineDerivation(item.derivation);
    if (id && derivation) derivations.set(id, derivation);
  }
  return { claimMethod: (id) => info.get(id)?.method ?? null, claimInfo: (id) => info.get(id) ?? null, itemDerivation: (id) => derivations.get(id) ?? null };
}

function normalizeProcurement(value: unknown): LineDerivationProcurement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const num = (entry: unknown) => (entry === undefined || entry === null || entry === "" ? null : Number.isFinite(Number(entry)) ? Number(entry) : null);
  const str = (entry: unknown) => (entry === undefined || entry === null ? null : String(entry).trim() || null);
  const normalized: LineDerivationProcurement = {
    suppliesItemId: str(raw.suppliesItemId),
    installedFromInput: str(raw.installedFromInput),
    installedQuantity: num(raw.installedQuantity),
    installedUom: str(raw.installedUom),
    packSize: num(raw.packSize ?? raw.yieldPerUnit),
    wasteFactor: num(raw.wasteFactor),
    surplusRationale: str(raw.surplusRationale),
  };
  const meaningful = Object.values(normalized).some((entry) => entry !== null);
  return meaningful ? normalized : null;
}

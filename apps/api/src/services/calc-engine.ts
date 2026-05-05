/**
 * Universal Calculation Engine for Bidwright.
 *
 * Reads the EntityCategory.calculationType to determine how to compute
 * each worksheet item's cost, price, and related fields.
 *
 * Supports custom formula expressions via the "formula" calc type.
 * Supports rate-schedule-driven pricing via dynamic tiers.
 */

import type {
  EntityCategory,
  LineTotal,
  MarkupRatio,
  PerUnitCost,
  RateResolutionSnapshot,
  WorksheetItem,
} from "@bidwright/domain";
import {
  asLineTotal,
  asPerUnitCost,
  deriveMarkup as deriveMarkupRatio,
  normalizeMarkup as normalizeMarkupRatio,
  perUnitFromLine,
  ZERO_MARKUP,
  ZERO_PER_UNIT_COST,
  normalizeCalculationType,
  resolveRateBookLine,
} from "@bidwright/domain";

// ── Types ─────────────────────────────────────────────────────────────────

export interface RateScheduleContext {
  id: string;
  category: string;
  name?: string;
  defaultMarkup?: number;
  metadata?: Record<string, unknown>;
  tiers: Array<{ id: string; name: string; multiplier: number; sortOrder: number; uom?: string | null }>;
  items: Array<{
    id: string;
    scheduleId?: string;
    catalogItemId?: string | null;
    resourceId?: string | null;
    name: string;
    code: string;
    unit?: string;
    rates: Record<string, number>;
    costRates: Record<string, number>;
    burden: number;
    perDiem: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface CalcContext {
  rateSchedules?: RateScheduleContext[];
  projectId?: string | null;
  revisionId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  currency?: string;
  region?: string;
}

/**
 * Engine results carry branded numeric types so a per-unit cost cannot be
 * silently committed as a line-total price (or vice versa). All runtime
 * values are still plain numbers — the brand only constrains assignment.
 */
export interface CalcResult {
  cost?: PerUnitCost;
  price?: LineTotal;
  markup?: MarkupRatio;
  rateResolution?: RateResolutionSnapshot | null;
}

// ── Storage convention (now type-enforced via @bidwright/domain/money) ────
//
// `WorksheetItem.cost`  — stored as a plain number, but every value the
//   engine writes is produced via `asPerUnitCost` so it represents per-unit.
// `WorksheetItem.price` — stored as a plain number; engine writes are
//   produced via `asLineTotal` (already extended × qty).
// `WorksheetItem.markup` — markup ratio. For "manual"/"unit_markup"/
//   "quantity_markup" the user drives markup → price = qty × cost × (1+m).
//   For "tiered_rate"/"duration_rate"/"formula" markup is DERIVED from the
//   real price vs ext-cost so the UI Markup column is truthful.

// ── Rate Schedule Strategy ───────────────────────────────────────────────

function findRateScheduleItem(item: WorksheetItem, ctx: CalcContext) {
  if (!ctx.rateSchedules?.length) return null;

  for (const schedule of ctx.rateSchedules) {
    // Match by rateScheduleItemId
    if (item.rateScheduleItemId) {
      const rsItem = schedule.items.find((i) => i.id === item.rateScheduleItemId);
      if (rsItem) return { schedule, rsItem };
    }
    // Fallback: match by entity name
    const rsItem = schedule.items.find(
      (i) => i.name === item.entityName || i.code === item.entityName,
    );
    if (rsItem) return { schedule, rsItem };
  }
  return null;
}

/**
 * Resolve a tier ID that may be truncated (e.g., "rst-f6d2116a" instead of full UUID)
 * by prefix-matching against a map of valid keys.
 */
function resolveTierId(tierId: string, validKeys: string[]): string {
  if (validKeys.includes(tierId)) return tierId;
  // Prefix match: the AI agent sometimes truncates UUIDs
  const match = validKeys.find((k) => k.startsWith(tierId));
  return match ?? tierId;
}

function calcRateSchedule(item: WorksheetItem, category: EntityCategory | undefined, ctx: CalcContext): CalcResult | null {
  const resolution = resolveRateBookLine(item, category, {
    rateBooks: ctx.rateSchedules ?? [],
    projectId: ctx.projectId,
    revisionId: ctx.revisionId,
    customerId: ctx.customerId,
    customerName: ctx.customerName,
    currency: ctx.currency,
    region: ctx.region,
  });
  if (!resolution) return null;
  const price = asLineTotal(resolution.price);
  const extCost = asLineTotal(resolution.cost * item.quantity);
  return {
    price,
    cost: asPerUnitCost(resolution.cost),
    markup: deriveMarkupRatio(price, extCost),
    rateResolution: resolution.snapshot,
  };
}

// ── Strategies ────────────────────────────────────────────────────────────

function calcTieredRate(item: WorksheetItem, ctx: CalcContext): CalcResult {
  const rsResult = calcRateSchedule(item, undefined, ctx);
  if (rsResult) return rsResult;

  return {};
}

function calcDurationRate(item: WorksheetItem, ctx: CalcContext): CalcResult {
  // Duration pricing flows through rate schedules. The schedule defines tiers
  // for the duration units (DAY/WEEK/MONTH) and the line item populates
  // `tierUnits` keyed by tier id. No legacy fallback path.
  const rsResult = calcRateSchedule(item, undefined, ctx);
  if (rsResult) return rsResult;
  return {};
}

function calcQuantityMarkup(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkupRatio(item.markup);
  const extCost = asLineTotal(item.quantity * item.cost);
  const price = asLineTotal(extCost * (1 + markup));
  // Per the storage convention, `cost` stays per-unit. We re-emit it from the
  // input rounded so callers committing to the DB store cents-precision.
  return { cost: asPerUnitCost(item.cost), price, markup };
}

function calcUnitMarkup(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkupRatio(item.markup);
  const price = asLineTotal(item.quantity * item.cost * (1 + markup));
  return { price, markup };
}

function calcManual(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkupRatio(item.markup);
  const price = asLineTotal(item.quantity * item.cost * (1 + markup));
  return { price, markup };
}

function calcDirectTotal(_item: WorksheetItem): CalcResult {
  // Price is entered directly by the user, no calculation needed.
  return { cost: ZERO_PER_UNIT_COST, markup: ZERO_MARKUP };
}

/**
 * Evaluate a custom formula expression.
 *
 * Available variables: qty, cost, markup, price, totalHours (sum of all
 * tierUnits hours).
 *
 * Example formulas:
 *   "qty * cost * (1 + markup)"   → standard markup
 *   "qty * cost * 1.15 + 500"     → fixed overhead
 *   "totalHours * 85"             → flat hourly rate
 *
 * Uses Function() constructor for sandboxed evaluation.
 * Only numeric operations are allowed.
 */
function calcFormula(item: WorksheetItem, formula: string): CalcResult {
  if (!formula.trim()) return calcManual(item);

  try {
    const totalHours = Object.values(item.tierUnits ?? {}).reduce(
      (acc, h) => acc + (Number(h) || 0),
      0,
    );
    const vars = {
      qty: item.quantity,
      cost: item.cost,
      markup: normalizeMarkupRatio(item.markup),
      price: item.price,
      totalHours,
    };

    // Basic safety: only allow math operations, numbers, and variable names
    const sanitized = formula.replace(/[^a-zA-Z0-9_.+\-*/()%\s]/g, "");
    const varNames = Object.keys(vars);
    const varValues = Object.values(vars);

    // eslint-disable-next-line no-new-func
    const fn = new Function(...varNames, `"use strict"; return (${sanitized});`);
    const result = fn(...varValues);

    if (typeof result === "number" && isFinite(result)) {
      return { price: asLineTotal(result) };
    }
  } catch {
    // Formula evaluation failed — fall back to manual
  }

  return calcManual(item);
}

// ── Main Entry Point ──────────────────────────────────────────────────────

/**
 * Calculate line item fields based on its EntityCategory's calculation type.
 *
 * Returns only the computed fields that should be overwritten.
 */
export function calculateItem(
  item: WorksheetItem,
  category: EntityCategory | undefined,
  ctx: CalcContext = {},
): CalcResult {
  const rateBookOverride = calcRateSchedule(item, category, ctx);
  if (rateBookOverride) return rateBookOverride;

  const calcType = normalizeCalculationType(category?.calculationType);

  switch (calcType) {
    case "tiered_rate":
      return calcTieredRate(item, ctx);
    case "duration_rate":
      return calcDurationRate(item, ctx);
    case "quantity_markup":
      return calcQuantityMarkup(item);
    case "unit_markup":
      return calcUnitMarkup(item);
    case "direct_total":
      return calcDirectTotal(item);
    case "formula":
      return calcFormula(item, category?.calcFormula ?? "");
    case "manual":
    default:
      return calcManual(item);
  }
}

/**
 * Apply calculated results to a worksheet item, returning only changed fields.
 */
export function applyCalculation(
  item: WorksheetItem,
  category: EntityCategory | undefined,
  ctx: CalcContext = {},
): Partial<WorksheetItem> {
  const result = calculateItem(item, category, ctx);
  const patch: Partial<WorksheetItem> = {};

  if (result.cost !== undefined) patch.cost = result.cost;
  if (result.price !== undefined) patch.price = result.price;
  if (result.markup !== undefined) patch.markup = result.markup;
  if (result.rateResolution !== undefined) patch.rateResolution = result.rateResolution;

  return patch;
}

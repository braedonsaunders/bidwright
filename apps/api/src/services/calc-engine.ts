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
} from "@bidwright/domain";

// ── Types ─────────────────────────────────────────────────────────────────

export interface RateScheduleContext {
  id: string;
  category: string;
  tiers: Array<{ id: string; name: string; multiplier: number; sortOrder: number; uom?: string | null }>;
  items: Array<{
    id: string;
    name: string;
    code: string;
    rates: Record<string, number>;
    costRates: Record<string, number>;
    burden: number;
    perDiem: number;
  }>;
}

export interface CalcContext {
  rateSchedules?: RateScheduleContext[];
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

function calcRateSchedule(item: WorksheetItem, ctx: CalcContext): CalcResult | null {
  const match = findRateScheduleItem(item, ctx);
  if (!match) return null;

  const { rsItem } = match;
  const tierUnits = item.tierUnits ?? {};
  if (Object.keys(tierUnits).length === 0) return null;

  // Cost rates come directly from the rate schedule item.
  const effectiveCostRates = rsItem.costRates;

  // Collect valid tier IDs for prefix matching
  const validRateKeys = Object.keys(rsItem.rates);
  const validCostKeys = Object.keys(effectiveCostRates);

  let totalPrice = 0;
  let totalCost = 0;
  let totalHours = 0;

  for (const [rawTierId, hours] of Object.entries(tierUnits)) {
    const h = Number(hours) || 0;
    const priceKey = resolveTierId(rawTierId, validRateKeys);
    const costKey = resolveTierId(rawTierId, validCostKeys);
    totalPrice += (rsItem.rates[priceKey] ?? 0) * h;
    totalCost += (effectiveCostRates[costKey] ?? 0) * h;
    totalHours += h;
  }

  totalPrice *= item.quantity;
  totalCost *= item.quantity;

  // Burden: per-item flat $/hr, scaled by hours × qty.
  if (rsItem.burden > 0) {
    totalCost += rsItem.burden * totalHours * item.quantity;
  }

  // Per diem: per-item $/day, scaled by ceil(hours / 8) × qty.
  if (rsItem.perDiem > 0) {
    totalCost += rsItem.perDiem * Math.ceil(totalHours / 8) * item.quantity;
  }

  const price = asLineTotal(totalPrice);
  const extCost = asLineTotal(totalCost);
  return {
    price,
    cost: perUnitFromLine(extCost, item.quantity),
    markup: deriveMarkupRatio(price, extCost),
  };
}

// ── Strategies ────────────────────────────────────────────────────────────

function calcTieredRate(item: WorksheetItem, ctx: CalcContext): CalcResult {
  const rsResult = calcRateSchedule(item, ctx);
  if (rsResult) return rsResult;

  return {};
}

function calcDurationRate(item: WorksheetItem, ctx: CalcContext): CalcResult {
  // Duration pricing flows through rate schedules. The schedule defines tiers
  // for the duration units (DAY/WEEK/MONTH) and the line item populates
  // `tierUnits` keyed by tier id. No legacy fallback path.
  const rsResult = calcRateSchedule(item, ctx);
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

  return patch;
}

/**
 * Universal Calculation Engine for Bidwright.
 *
 * Reads the EntityCategory.calculationType to determine how to compute
 * each worksheet item's cost, price, and related fields.
 *
 * Supports custom formula expressions via the "formula" calc type.
 * Supports rate-schedule-driven pricing via dynamic tiers.
 */

import type { EntityCategory, WorksheetItem } from "@bidwright/domain";

// ── Types ─────────────────────────────────────────────────────────────────

export interface RateScheduleContext {
  id: string;
  category: string;
  tiers: Array<{ id: string; name: string; multiplier: number; sortOrder: number }>;
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
  catalogItems?: Array<{ name: string; unitCost: number; unitPrice: number; metadata: Record<string, unknown> }>;
  burdenPercent?: number; // labour cost as % of price, default 0.7
  rateSchedules?: RateScheduleContext[];
}

export interface CalcResult {
  cost?: number;
  price?: number;
  markup?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Normalize markup values.
 * Users may enter 15 meaning 15%, or 0.15. Values > 1 are treated as
 * percentages and divided by 100.
 */
function normalizeMarkup(v: number): number {
  if (v > 1) return v / 100;
  return v;
}

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

function calcAutoRateSchedule(item: WorksheetItem, ctx: CalcContext): CalcResult | null {
  const match = findRateScheduleItem(item, ctx);
  if (!match) return null;

  const { rsItem } = match;
  const tierUnits = item.tierUnits ?? {};

  // If no tier hours set, check if legacy labor hours can be mapped
  const hasTierHours = Object.keys(tierUnits).length > 0;
  if (!hasTierHours) return null;

  let totalPrice = 0;
  let totalCost = 0;
  let totalHours = 0;

  for (const [tierId, hours] of Object.entries(tierUnits)) {
    const h = Number(hours) || 0;
    totalPrice += (rsItem.rates[tierId] ?? 0) * h;
    totalCost += (rsItem.costRates[tierId] ?? 0) * h;
    totalHours += h;
  }

  totalPrice *= item.quantity;
  totalCost *= item.quantity;

  // Add burden per hour and per diem per day
  totalCost += rsItem.burden * totalHours * item.quantity;
  totalCost += rsItem.perDiem * Math.ceil(totalHours / 8) * item.quantity;

  return {
    price: round(totalPrice),
    cost: round(totalCost),
  };
}

// ── Strategies ────────────────────────────────────────────────────────────

function calcAutoLabour(item: WorksheetItem, ctx: CalcContext): CalcResult {
  const rsResult = calcAutoRateSchedule(item, ctx);
  if (rsResult) return rsResult;

  return {};
}

function calcAutoEquipment(item: WorksheetItem, ctx: CalcContext): CalcResult {
  // Try rate schedule first
  const rsResult = calcAutoRateSchedule(item, ctx);
  if (rsResult) return rsResult;

  // Duration is stored in laborHourReg (days)
  const duration = item.laborHourReg || 1;
  let dailyRate = item.cost;

  // Try to find catalog item with weekly/monthly rates in metadata
  const catItem = ctx.catalogItems?.find(
    (c) => c.name === item.entityName || c.name === item.vendor,
  );

  if (catItem?.metadata) {
    const monthlyRate = Number(catItem.metadata.monthlyRate) || 0;
    const weeklyRate = Number(catItem.metadata.weeklyRate) || 0;
    const dailyCatRate = catItem.unitCost || dailyRate;

    // Smart rate rollup: pick cheapest aggregate
    if (monthlyRate > 0 && duration >= 20) {
      const months = Math.ceil(duration / 22); // ~22 working days/month
      const monthlyTotal = monthlyRate * months;
      const dailyTotal = dailyCatRate * duration;
      if (monthlyTotal < dailyTotal) {
        return { price: round(monthlyTotal * item.quantity), cost: round(monthlyTotal * item.quantity) };
      }
    }

    if (weeklyRate > 0 && duration >= 5) {
      const weeks = Math.ceil(duration / 5);
      const weeklyTotal = weeklyRate * weeks;
      const dailyTotal = dailyCatRate * duration;
      if (weeklyTotal < dailyTotal) {
        return { price: round(weeklyTotal * item.quantity), cost: round(weeklyTotal * item.quantity) };
      }
    }

    dailyRate = dailyCatRate || dailyRate;
  }

  const price = round(dailyRate * duration * item.quantity);
  return { price, cost: price };
}

function calcAutoConsumable(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkup(item.markup);
  const cost = round(item.quantity * item.cost);
  const price = round(cost * (1 + markup));
  return { price, cost };
}

function calcAutoSubcontract(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkup(item.markup);
  const price = round(item.quantity * item.cost * (1 + markup));
  return { price };
}

function calcManual(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkup(item.markup);
  const price = round(item.quantity * item.cost * (1 + markup));
  return { price };
}

function calcDirectPrice(_item: WorksheetItem): CalcResult {
  // Price is entered directly by the user, no calculation needed
  return { cost: 0, markup: 0 };
}

/**
 * Evaluate a custom formula expression.
 *
 * Available variables: qty, cost, markup, price, regHrs, otHrs, dtHrs
 *
 * Example formulas:
 *   "qty * cost * (1 + markup)"        → standard markup
 *   "qty * cost * 1.15 + 500"          → fixed overhead
 *   "regHrs * 85 + otHrs * 127.50"     → custom rate calc
 *
 * Uses Function() constructor for sandboxed evaluation.
 * Only numeric operations are allowed.
 */
function calcFormula(item: WorksheetItem, formula: string): CalcResult {
  if (!formula.trim()) return calcManual(item);

  try {
    const vars = {
      qty: item.quantity,
      cost: item.cost,
      markup: normalizeMarkup(item.markup),
      price: item.price,
      regHrs: item.laborHourReg,
      otHrs: item.laborHourOver,
      dtHrs: item.laborHourDouble,
    };

    // Basic safety: only allow math operations, numbers, and variable names
    const sanitized = formula.replace(/[^a-zA-Z0-9_.+\-*/()%\s]/g, "");
    const varNames = Object.keys(vars);
    const varValues = Object.values(vars);

    // eslint-disable-next-line no-new-func
    const fn = new Function(...varNames, `"use strict"; return (${sanitized});`);
    const result = fn(...varValues);

    if (typeof result === "number" && isFinite(result)) {
      return { price: round(result) };
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
  const calcType = category?.calculationType ?? "manual";

  switch (calcType) {
    case "auto_labour":
      return calcAutoLabour(item, ctx);
    case "auto_equipment":
      return calcAutoEquipment(item, ctx);
    case "auto_consumable":
      return calcAutoConsumable(item);
    case "auto_subcontract":
      return calcAutoSubcontract(item);
    case "auto_stock":
      return calcManual(item); // stock calc uses same as manual for now
    case "direct_price":
      return calcDirectPrice(item);
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

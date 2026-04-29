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
import { normalizeCalculationType } from "@bidwright/domain";

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

export interface LabourCostContextEntry {
  code: string;
  name: string;
  group: string;
  costRates: Record<string, number>; // { regular: 35.01, overtime: 52.52, doubletime: 70.02 }
}

export interface BurdenPeriodEntry {
  group: string;
  percentage: number; // 0.46 = 46%
  startDate: string;
  endDate: string;
}

export interface LabourCostContext {
  entries: LabourCostContextEntry[];
  burdenPeriods: BurdenPeriodEntry[];
  referenceDate?: string; // date for burden period matching
}

export interface TravelPolicyContext {
  perDiemRate: number;
  perDiemEmbedMode: "separate" | "embed_hourly" | "embed_cost_only";
  hoursPerDay: number;
  fuelSurchargePercent: number;
  fuelSurchargeAppliesTo: "labour" | "all" | "none";
}

export interface CalcContext {
  catalogItems?: Array<{ name: string; unitCost: number; unitPrice: number; metadata: Record<string, unknown> }>;
  burdenPercent?: number; // labour cost as % of price, default 0.7
  rateSchedules?: RateScheduleContext[];
  labourCost?: LabourCostContext;
  travelPolicy?: TravelPolicyContext;
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

/**
 * Map canonical tier name ("regular", "overtime", "doubletime") to a schedule tier ID
 * by matching the tier's multiplier (1.0 → regular, 1.5 → overtime, 2.0 → doubletime).
 */
function mapCanonicalTierToId(
  canonicalName: string,
  tiers: RateScheduleContext["tiers"],
): string | null {
  const multiplierMap: Record<string, number> = { regular: 1, overtime: 1.5, doubletime: 2 };
  const targetMultiplier = multiplierMap[canonicalName];
  if (targetMultiplier === undefined) return null;
  const tier = tiers.find((t) => t.multiplier === targetMultiplier);
  return tier?.id ?? null;
}

/**
 * Find the active burden period for a group at a given date.
 */
function findActiveBurden(
  group: string,
  burdenPeriods: BurdenPeriodEntry[],
  referenceDate?: string,
): number {
  const ref = referenceDate ?? new Date().toISOString().substring(0, 10);
  // Match by group first, fallback to empty group (applies to all)
  const candidates = burdenPeriods.filter(
    (bp) => (bp.group === group || bp.group === "") && ref >= bp.startDate && ref <= bp.endDate,
  );
  // Prefer exact group match over wildcard
  const exact = candidates.find((bp) => bp.group === group);
  return exact?.percentage ?? candidates[0]?.percentage ?? 0;
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

  const { schedule, rsItem } = match;
  let tierUnits = item.tierUnits ?? {};

  // If no tier hours set, fall back to unit1/unit2/unit3 mapped to schedule tiers.
  // The LLM populates the data; Bidwright calculates the pricing.
  // unit1 → Regular (multiplier 1.0), unit2 → Overtime (1.5), unit3 → DoubleTime (2.0)
  const hasTierHours = Object.keys(tierUnits).length > 0;
  if (!hasTierHours) {
    const hasLegacyUnits = (item.unit1 || 0) > 0 || (item.unit2 || 0) > 0 || (item.unit3 || 0) > 0;
    if (!hasLegacyUnits) return null;

    // Map unit1/unit2/unit3 to the corresponding tier IDs by multiplier
    const sortedTiers = [...schedule.tiers].sort((a, b) => a.multiplier - b.multiplier);
    const regularTier = sortedTiers.find((t) => t.multiplier === 1 || t.multiplier === 1.0);
    const overtimeTier = sortedTiers.find((t) => t.multiplier === 1.5);
    const doubletimeTier = sortedTiers.find((t) => t.multiplier === 2 || t.multiplier === 2.0);

    tierUnits = {};
    if ((item.unit1 || 0) > 0 && regularTier) tierUnits[regularTier.id] = item.unit1;
    if ((item.unit2 || 0) > 0 && overtimeTier) tierUnits[overtimeTier.id] = item.unit2;
    if ((item.unit3 || 0) > 0 && doubletimeTier) tierUnits[doubletimeTier.id] = item.unit3;

    // For equipment, unit3 may represent monthly duration — try matching by tier name patterns
    if (Object.keys(tierUnits).length === 0) {
      // Try matching tiers by name convention (Daily/Weekly/Monthly) for equipment
      for (const tier of schedule.tiers) {
        const lowerName = tier.name.toLowerCase();
        if ((item.unit1 || 0) > 0 && (lowerName.includes("daily") || lowerName.includes("day"))) {
          tierUnits[tier.id] = item.unit1;
        } else if ((item.unit2 || 0) > 0 && (lowerName.includes("weekly") || lowerName.includes("week"))) {
          tierUnits[tier.id] = item.unit2;
        } else if ((item.unit3 || 0) > 0 && (lowerName.includes("monthly") || lowerName.includes("month"))) {
          tierUnits[tier.id] = item.unit3;
        }
      }
    }

    if (Object.keys(tierUnits).length === 0) return null;
  }

  // Determine cost rates: prefer global LabourCostContext over per-item costRates
  let effectiveCostRates = rsItem.costRates;
  let costGroup = "";

  if (ctx.labourCost?.entries.length) {
    // Match by code or name
    const costEntry = ctx.labourCost.entries.find(
      (e) => e.code === rsItem.code || e.name === rsItem.name,
    );
    if (costEntry) {
      // Map canonical rates to schedule tier IDs
      effectiveCostRates = {};
      for (const [canonicalName, rate] of Object.entries(costEntry.costRates)) {
        const tierId = mapCanonicalTierToId(canonicalName, schedule.tiers);
        if (tierId) effectiveCostRates[tierId] = Number(rate) || 0;
      }
      costGroup = costEntry.group;
    }
  }

  // Collect valid tier IDs for prefix matching
  const validRateKeys = Object.keys(rsItem.rates);
  const validCostKeys = Object.keys(effectiveCostRates);

  let totalPrice = 0;
  let totalCost = 0;
  let totalHours = 0;

  for (const [rawTierId, hours] of Object.entries(tierUnits)) {
    const h = Number(hours) || 0;
    // Resolve potentially truncated tier IDs
    const priceKey = resolveTierId(rawTierId, validRateKeys);
    const costKey = resolveTierId(rawTierId, validCostKeys);
    totalPrice += (rsItem.rates[priceKey] ?? 0) * h;
    totalCost += (effectiveCostRates[costKey] ?? 0) * h;
    totalHours += h;
  }

  totalPrice *= item.quantity;
  totalCost *= item.quantity;

  // Apply burden: prefer org-level burden periods over item-level burden field
  if (ctx.labourCost?.burdenPeriods.length && costGroup) {
    const burdenPct = findActiveBurden(
      costGroup,
      ctx.labourCost.burdenPeriods,
      ctx.labourCost.referenceDate,
    );
    if (burdenPct > 0) {
      totalCost += totalCost * burdenPct;
    }
  } else if (rsItem.burden > 0) {
    // Fallback to per-item flat burden ($/hr)
    totalCost += rsItem.burden * totalHours * item.quantity;
  }

  // Per diem: add to cost
  const hoursPerDay = ctx.travelPolicy?.hoursPerDay ?? 8;
  if (rsItem.perDiem > 0) {
    totalCost += rsItem.perDiem * Math.ceil(totalHours / hoursPerDay) * item.quantity;
  }

  // Travel policy: fuel surcharge on sell price
  if (ctx.travelPolicy && ctx.travelPolicy.fuelSurchargePercent > 0) {
    if (ctx.travelPolicy.fuelSurchargeAppliesTo === "labour" || ctx.travelPolicy.fuelSurchargeAppliesTo === "all") {
      totalPrice *= 1 + ctx.travelPolicy.fuelSurchargePercent / 100;
    }
  }

  // Travel policy: per diem embed modes
  if (ctx.travelPolicy && ctx.travelPolicy.perDiemRate > 0) {
    const days = Math.ceil(totalHours / hoursPerDay);
    if (ctx.travelPolicy.perDiemEmbedMode === "embed_cost_only") {
      totalCost += ctx.travelPolicy.perDiemRate * days * item.quantity;
    } else if (ctx.travelPolicy.perDiemEmbedMode === "embed_hourly") {
      const hourlyPerDiem = ctx.travelPolicy.perDiemRate / hoursPerDay;
      totalPrice += hourlyPerDiem * totalHours * item.quantity;
      totalCost += hourlyPerDiem * totalHours * item.quantity;
    }
    // "separate" mode: travel shows as its own line item, handled outside calc engine
  }

  // Convention: `cost` is stored per-unit (UI computes extCost = cost × qty);
  // `price` is stored as the line total. Up to here totalCost has been
  // accumulated as the line total (× quantity, with burden / per-diem / etc.
  // applied to that total), so divide back to per-unit before returning.
  const qty = item.quantity || 1;
  return {
    price: round(totalPrice),
    cost: round(totalCost / qty),
  };
}

// ── Strategies ────────────────────────────────────────────────────────────

function calcTieredRate(item: WorksheetItem, ctx: CalcContext): CalcResult {
  const rsResult = calcRateSchedule(item, ctx);
  if (rsResult) return rsResult;

  return {};
}

function calcDurationRate(item: WorksheetItem, ctx: CalcContext): CalcResult {
  // Try rate schedule first
  const rsResult = calcRateSchedule(item, ctx);
  if (rsResult) return rsResult;

  // Duration is stored in unit1 (days)
  const duration = item.unit1 || 1;
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
        return { price: round(monthlyTotal * item.quantity), cost: round(monthlyTotal) };
      }
    }

    if (weeklyRate > 0 && duration >= 5) {
      const weeks = Math.ceil(duration / 5);
      const weeklyTotal = weeklyRate * weeks;
      const dailyTotal = dailyCatRate * duration;
      if (weeklyTotal < dailyTotal) {
        return { price: round(weeklyTotal * item.quantity), cost: round(weeklyTotal) };
      }
    }

    dailyRate = dailyCatRate || dailyRate;
  }

  // cost is stored per-unit; price is stored as line total (UI multiplies cost × qty for extCost)
  const perUnit = round(dailyRate * duration);
  return { price: round(perUnit * item.quantity), cost: perUnit };
}

function calcQuantityMarkup(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkup(item.markup);
  const cost = round(item.quantity * item.cost);
  const price = round(cost * (1 + markup));
  return { price, cost };
}

function calcUnitMarkup(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkup(item.markup);
  const price = round(item.quantity * item.cost * (1 + markup));
  return { price };
}

function calcManual(item: WorksheetItem): CalcResult {
  const markup = normalizeMarkup(item.markup);
  const price = round(item.quantity * item.cost * (1 + markup));
  return { price };
}

function calcDirectTotal(_item: WorksheetItem): CalcResult {
  // Price is entered directly by the user, no calculation needed
  return { cost: 0, markup: 0 };
}

/**
 * Evaluate a custom formula expression.
 *
 * Available variables: qty, cost, markup, price, unit1, unit2, unit3 (aliases: regHrs, otHrs, dtHrs)
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
      unit1: item.unit1,
      unit2: item.unit2,
      unit3: item.unit3,
      regHrs: item.unit1,
      otHrs: item.unit2,
      dtHrs: item.unit3,
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

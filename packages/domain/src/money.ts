/**
 * Branded numeric types for the Bidwright financial engine.
 *
 * These prevent accidentally mixing per-unit and line-total values in the
 * codebase. Both brands are still numbers at runtime — arithmetic on a
 * `PerUnitCost` returns a `number`, which is intentional: it forces the
 * caller to re-state intent (via `asPerUnitCost`, `asLineTotal`, or one of
 * the helpers below) when assigning to a typed field again.
 *
 * Convention (enforced by these types, no longer just by comment):
 *   - `WorksheetItem.cost`  is a `PerUnitCost`. UI/API always treat it as
 *     "$ per UoM unit". To get the extended line cost: `lineCost(cost, qty)`.
 *   - `WorksheetItem.price` is a `LineTotal`. It is already extended.
 */

declare const __PerUnitCostBrand: unique symbol;
declare const __LineTotalBrand: unique symbol;
declare const __MarkupRatioBrand: unique symbol;

export type PerUnitCost = number & { readonly [__PerUnitCostBrand]: true };
export type LineTotal = number & { readonly [__LineTotalBrand]: true };
/** Markup expressed as a decimal ratio: 0.15 = 15%. Never as a percentage. */
export type MarkupRatio = number & { readonly [__MarkupRatioBrand]: true };

/** Cents-precision rounding shared by all money values. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Mark a number as a per-unit cost. Rounds to cents. */
export function asPerUnitCost(n: number): PerUnitCost {
  return roundMoney(Number.isFinite(n) ? n : 0) as PerUnitCost;
}

/** Mark a number as a line-total amount. Rounds to cents. */
export function asLineTotal(n: number): LineTotal {
  return roundMoney(Number.isFinite(n) ? n : 0) as LineTotal;
}

/** Mark a number as a markup ratio (0.15 = 15%). Rounds to 1bp (0.0001). */
export function asMarkupRatio(n: number): MarkupRatio {
  const v = Number.isFinite(n) ? n : 0;
  return (Math.round(v * 10000) / 10000) as MarkupRatio;
}

/** Zero literals — use these to initialize fields without losing the brand. */
export const ZERO_PER_UNIT_COST = asPerUnitCost(0);
export const ZERO_LINE_TOTAL = asLineTotal(0);
export const ZERO_MARKUP = asMarkupRatio(0);

/** Extend a per-unit cost to a line total. Always rounded. */
export function lineCost(cost: PerUnitCost, qty: number): LineTotal {
  const q = Number.isFinite(qty) ? qty : 0;
  return asLineTotal(cost * q);
}

/** Reduce a line total back to a per-unit cost given a quantity. Safe on qty=0. */
export function perUnitFromLine(line: LineTotal, qty: number): PerUnitCost {
  const q = Number.isFinite(qty) && qty !== 0 ? qty : 1;
  return asPerUnitCost(line / q);
}

/** Apply a markup ratio to a line total. */
export function withMarkup(amount: LineTotal, markup: MarkupRatio): LineTotal {
  return asLineTotal(amount * (1 + markup));
}

/** Derive markup from price vs ext-cost. Safe-guards 0 / negative cost. */
export function deriveMarkup(price: LineTotal, extCost: LineTotal): MarkupRatio {
  if (extCost <= 0) return ZERO_MARKUP;
  return asMarkupRatio((price - extCost) / extCost);
}

/**
 * Normalize markup that may have been entered either as a ratio (0.15) or a
 * percentage (15). Values > 1 are interpreted as percentages.
 */
export function normalizeMarkup(value: number): MarkupRatio {
  const v = Number.isFinite(value) ? value : 0;
  return asMarkupRatio(v > 1 ? v / 100 : v);
}

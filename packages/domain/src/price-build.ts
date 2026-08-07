import { roundMoney } from "./money";

/**
 * Shared shape of the customer-facing Price Build, so the UI and the PDF can
 * never disagree about what the client is shown.
 *
 * Two rules drive it:
 *  - A hidden adjustment still changes the price, so its value is folded into
 *    the rollup (and proportionally into the rollup's own rows) rather than
 *    printed as its own line. Otherwise rollup + shown adjustments would not
 *    reconcile with the total the client is asked to pay.
 *  - With nothing left to show between the rollup and the total, the two rows
 *    carry identical amounts; print one total instead of repeating it.
 */

export interface PriceBuildAdjustmentLike {
  value: number;
  active?: boolean | null;
  /** "No" hides the adjustment from customer-facing output. */
  show?: string | null;
  affectsSubtotal?: boolean | null;
}

export interface PriceBuildView<T extends PriceBuildAdjustmentLike> {
  /** Adjustments that get their own printed line. */
  visibleAdjustments: T[];
  /** Value absorbed into the rollup rather than itemized. */
  hiddenAdjustmentTotal: number;
  /** Rollup amount to print — the displayed rows plus any hidden adjustment. */
  rollupAmount: number;
  /**
   * Factor for each displayed row/cell amount so the rows still sum to the
   * printed rollup once hidden adjustments are absorbed. 1 when nothing is
   * hidden.
   */
  rowScale: number;
  /** The client price. */
  total: number;
  /** False when the rollup equals the total and a separate row adds nothing. */
  showRollup: boolean;
}

export function buildPriceBuildView<T extends PriceBuildAdjustmentLike>(input: {
  /**
   * What the displayed rows currently sum to. This is NOT always the ladder's
   * line subtotal: a modifier priced into the line items (affectsSubtotal
   * false) is already inside every dimension total, so scaling against the
   * pre-modifier subtotal would count it twice.
   */
  rowsSubtotal: number;
  grandTotal: number;
  adjustments: T[];
}): PriceBuildView<T> {
  const rowsSubtotal = Number.isFinite(input.rowsSubtotal) ? roundMoney(input.rowsSubtotal) : 0;
  const total = roundMoney(Number.isFinite(input.grandTotal) ? input.grandTotal : 0);

  // Only adjustments that sit on top of the rows can be itemized; the rest are
  // already priced into the rows themselves.
  const applicable = (input.adjustments ?? []).filter(
    (adjustment) => adjustment.active !== false && adjustment.affectsSubtotal !== false,
  );
  const visibleAdjustments = applicable.filter((adjustment) => adjustment.show !== "No");
  const visibleTotal = roundMoney(
    visibleAdjustments.reduce((sum, adjustment) => sum + (Number(adjustment.value) || 0), 0),
  );

  // Derive the rollup from the total rather than by summing hidden
  // adjustments: whatever is not shown as its own line belongs in the rollup,
  // so the printed column always reconciles with the price.
  const rollupAmount = roundMoney(total - visibleTotal);
  const hiddenAdjustmentTotal = roundMoney(rollupAmount - rowsSubtotal);
  const rowScale = rowsSubtotal !== 0 ? rollupAmount / rowsSubtotal : 1;

  return {
    visibleAdjustments,
    hiddenAdjustmentTotal,
    rollupAmount,
    rowScale,
    total,
    showRollup: visibleAdjustments.length > 0,
  };
}

/** Apply the rollup's hidden-adjustment scaling to a displayed row amount. */
export function scalePriceBuildAmount(amount: number | null | undefined, rowScale: number): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(rowScale) || rowScale === 1) return roundMoney(value);
  return roundMoney(value * rowScale);
}

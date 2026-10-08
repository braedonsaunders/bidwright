/**
 * Opaque placeholder for a parsed layer-filter boolean expression tree.
 *
 * @remarks
 * Mirrors ObjectARX `AcLyBoolExpr`. A full expression-AST implementation is
 * not required to support the {@link AcLyLayerFilter} nesting API; property
 * filters currently evaluate {@link AcLyLayerFilter.filterExpression} as a
 * string.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcLy_Classes
 */
export class AcLyBoolExpr {
  /** Original filter expression text. */
  private readonly _expression: string

  /**
   * Creates a new {@link AcLyBoolExpr} instance.
   *
   * @param expression - Source filter expression string.
   */
  constructor(expression: string) {
    this._expression = expression
  }

  /**
   * Gets the original filter expression text.
   *
   * @returns The filter expression string.
   */
  get expression(): string {
    return this._expression
  }
}

import type { AcDbObjectId } from '../base/AcDbObject'
import type { AcDbLayerTableRecord } from '../database/AcDbLayerTableRecord'
import { AcLyBoolExpr } from './AcLyBoolExpr'

/**
 * Result returned by {@link AcLyLayerFilter.showEditor}.
 *
 * @remarks
 * Mirrors ObjectARX `AcLyLayerFilter::DialogResult`.
 */
export enum AcLyLayerFilterDialogResult {
  /** The editor was cancelled. */
  Cancel = 0,
  /** The editor completed successfully. */
  Ok = 1
}

/**
 * Main Layer Manager filter class (property filter).
 *
 * An {@link AcLyLayerFilter} allows clients to specify a filter expression and
 * nest other filters into a tree. This is the AutoCAD Layer Properties Manager
 * filter model (`AcLy*` classes), not the block-index {@link AcDbLayerFilter}.
 *
 * Nesting rules (AutoCAD Layer Manager behavior):
 * - The tree root may contain both group filters and property filters.
 * - A non-root property filter ({@link isIdFilter} = `false`) may contain
 *   other property filters, but may **not** contain a group filter.
 * - A group filter may contain both group filters and property filters.
 *
 * @remarks
 * Mirrors ObjectARX `AcLyLayerFilter` from `acly.h`.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcLy_Classes
 * @see https://help.autodesk.com/cloudhelp/2019/ENU/OARX-RefGuide/files/OREF-AcLyLayerFilter.html
 *
 * @example
 * ```typescript
 * const unlocked = new AcLyLayerFilter();
 * unlocked.name = 'Unlocked Layers';
 * unlocked.setFilterExpression('LOCKED=="False"');
 *
 * const root = new AcLyLayerFilter();
 * root.name = 'All';
 * root.addNested(unlocked);
 * ```
 */
export class AcLyLayerFilter {
  /** Display name of this filter. */
  private _name: string
  /** Property-filter expression string (unused by group filters). */
  private _filterExpression: string
  /** Nested child filters. */
  private readonly _nestedFilters: AcLyLayerFilter[]
  /** Parent filter in the tree, if any. */
  private _parent: AcLyLayerFilter | null
  /** Whether this filter may be deleted from the UI. */
  private _allowDelete: boolean
  /** Whether this filter may be renamed from the UI. */
  private _allowRename: boolean
  /** Whether this filter was generated dynamically by AutoCAD. */
  private _dynamicallyGenerated: boolean
  /** Whether this filter is a proxy for an unknown custom filter type. */
  private _isProxy: boolean

  /**
   * Creates a new {@link AcLyLayerFilter} instance (property filter).
   */
  constructor() {
    this._name = ''
    this._filterExpression = ''
    this._nestedFilters = []
    this._parent = null
    this._allowDelete = true
    this._allowRename = true
    this._dynamicallyGenerated = false
    this._isProxy = false
  }

  /**
   * Gets the filter name.
   *
   * @returns The filter name.
   */
  get name(): string {
    return this._name
  }

  /**
   * Sets the filter name.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::setName`.
   *
   * @param value - New filter name.
   * @returns `true` if the name was set.
   */
  setName(value: string): boolean {
    if (!this.allowRename() && this._name.length > 0) {
      return false
    }
    this._name = value
    return true
  }

  /**
   * Sets the filter name via property assignment.
   *
   * @param value - New filter name.
   */
  set name(value: string) {
    this.setName(value)
  }

  /**
   * Gets the property-filter expression string.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::filterExpression`. Group filters do
   * not use expression strings and return an empty string.
   *
   * @returns The filter expression, or an empty string.
   */
  get filterExpression(): string {
    return this._filterExpression
  }

  /**
   * Sets the property-filter expression string.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::setFilterExpression`.
   *
   * @param expression - Filter expression (for example `LOCKED=="False"`).
   * @returns `true` if the expression was accepted.
   */
  setFilterExpression(expression: string): boolean {
    if (this.isIdFilter()) {
      return false
    }
    this._filterExpression = expression ?? ''
    return true
  }

  /**
   * Sets the filter expression via property assignment.
   *
   * @param value - Filter expression string.
   */
  set filterExpression(value: string) {
    this.setFilterExpression(value)
  }

  /**
   * Returns a parsed expression-tree representation of the filter expression.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::filterExpressionTree`. Returns `null`
   * when no expression is set, or for ID/group filters.
   *
   * @returns An {@link AcLyBoolExpr}, or `null`.
   */
  filterExpressionTree(): AcLyBoolExpr | null {
    if (this.isIdFilter() || !this._filterExpression) {
      return null
    }
    return new AcLyBoolExpr(this._filterExpression)
  }

  /**
   * Gets the nested child filters of this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::getNestedFilters`.
   *
   * @returns A read-only array of nested filters.
   */
  getNestedFilters(): readonly AcLyLayerFilter[] {
    return this._nestedFilters
  }

  /**
   * Convenience accessor for nested filters (mirrors .NET `NestedFilters`).
   *
   * @returns A read-only array of nested filters.
   */
  get nestedFilters(): readonly AcLyLayerFilter[] {
    return this._nestedFilters
  }

  /**
   * Gets the parent filter in the tree.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::parent`.
   *
   * @returns The parent filter, or `null` for the root.
   */
  parent(): AcLyLayerFilter | null {
    return this._parent
  }

  /**
   * Returns whether this filter is an ID/group filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::isIdFilter`. Property filters return
   * `false`; {@link AcLyLayerGroup} overrides this to return `true`.
   *
   * @returns `true` for group filters; otherwise `false`.
   */
  isIdFilter(): boolean {
    return false
  }

  /**
   * Returns whether nested filters are allowed under this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::allowNested`. Both property and group
   * filters allow nesting by default.
   *
   * @returns `true` if nested filters are allowed.
   */
  allowNested(): boolean {
    return true
  }

  /**
   * Returns whether this filter may be deleted.
   *
   * @returns `true` if deletion is allowed.
   */
  allowDelete(): boolean {
    return this._allowDelete
  }

  /**
   * Sets whether this filter may be deleted.
   *
   * @param value - `true` to allow deletion.
   */
  setAllowDelete(value: boolean): void {
    this._allowDelete = value
  }

  /**
   * Returns whether this filter may be renamed.
   *
   * @returns `true` if renaming is allowed.
   */
  allowRename(): boolean {
    return this._allowRename
  }

  /**
   * Sets whether this filter may be renamed.
   *
   * @param value - `true` to allow renaming.
   */
  setAllowRename(value: boolean): void {
    this._allowRename = value
  }

  /**
   * Returns whether this filter was generated dynamically.
   *
   * @returns `true` if dynamically generated.
   */
  dynamicallyGenerated(): boolean {
    return this._dynamicallyGenerated
  }

  /**
   * Sets whether this filter was generated dynamically.
   *
   * @param value - `true` if dynamically generated.
   */
  setDynamicallyGenerated(value: boolean): void {
    this._dynamicallyGenerated = value
  }

  /**
   * Returns whether this filter is a proxy for an unknown custom type.
   *
   * @returns `true` if this is a proxy filter.
   */
  isProxy(): boolean {
    return this._isProxy
  }

  /**
   * Sets whether this filter is a proxy.
   *
   * @param value - `true` if this is a proxy filter.
   */
  setIsProxy(value: boolean): void {
    this._isProxy = value
  }

  /**
   * Adds a nested child filter under this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::addNested`.
   *
   * Nesting rules:
   * - This filter must {@link allowNested}.
   * - The tree root may contain both group and property filters.
   * - A non-root property filter may not contain a group filter.
   * - A group filter may contain both group and property filters.
   *
   * @param filter - Child filter to add.
   * @returns `true` if the child was added.
   */
  addNested(filter: AcLyLayerFilter): boolean {
    if (!filter || filter === this) {
      return false
    }
    if (!this.allowNested()) {
      return false
    }
    // Non-root Property Filter cannot contain Group Filter.
    // The root "All" filter is allowed to host both kinds (AutoCAD behavior).
    const isRoot = this._parent == null
    if (!isRoot && !this.isIdFilter() && filter.isIdFilter()) {
      return false
    }
    if (this._nestedFilters.includes(filter)) {
      return false
    }
    if (filter._parent) {
      filter._parent.removeNested(filter)
    }
    filter._parent = this
    this._nestedFilters.push(filter)
    return true
  }

  /**
   * Removes a nested child filter from this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::removeNested`.
   *
   * @param filter - Child filter to remove.
   * @returns `true` if the child was removed.
   */
  removeNested(filter: AcLyLayerFilter): boolean {
    const index = this._nestedFilters.indexOf(filter)
    if (index < 0) {
      return false
    }
    this._nestedFilters.splice(index, 1)
    if (filter._parent === this) {
      filter._parent = null
    }
    return true
  }

  /**
   * Generates nested filters from this filter's expression, when supported.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::generateNested`. Not implemented beyond
   * API parity; returns `false`.
   *
   * @returns `true` if nested filters were generated.
   */
  generateNested(): boolean {
    return false
  }

  /**
   * Compares this filter to another filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::compareTo`.
   *
   * @param other - Filter to compare against.
   * @returns `true` if the filters are considered equal.
   */
  compareTo(other: AcLyLayerFilter | null | undefined): boolean {
    if (!other) {
      return false
    }
    return (
      this.isIdFilter() === other.isIdFilter() &&
      this._name === other._name &&
      this._filterExpression === other._filterExpression
    )
  }

  /**
   * Tests whether the given layer table record passes this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::filter`. Property filters evaluate
   * {@link filterExpression}; group filters override this method.
   *
   * @param layer - Layer table record to test.
   * @returns `true` if the layer is accepted by this filter.
   */
  filter(layer: AcDbLayerTableRecord): boolean {
    if (!layer) {
      return false
    }
    if (!this._filterExpression) {
      return true
    }
    return evaluateLayerFilterExpression(this._filterExpression, layer)
  }

  /**
   * Shows the filter editor UI.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::showEditor`. No UI is available in
   * this port; always returns {@link AcLyLayerFilterDialogResult.Cancel}.
   *
   * @returns Dialog result.
   */
  showEditor(): AcLyLayerFilterDialogResult {
    return AcLyLayerFilterDialogResult.Cancel
  }
}

/**
 * Evaluates a simple AutoCAD-style layer filter expression against a layer.
 *
 * Supports `AND` / `OR` combinations of relational clauses such as:
 * `LOCKED=="False"`, `FROZEN=="True"`, `OFF=="False"`, `NAME=="0"`,
 * `COLOR=="7"`, `PLOT=="True"`.
 *
 * @param expression - Filter expression string.
 * @param layer - Layer to evaluate.
 * @returns `true` if the layer matches the expression.
 */
function evaluateLayerFilterExpression(
  expression: string,
  layer: AcDbLayerTableRecord
): boolean {
  const trimmed = expression.trim()
  if (!trimmed) {
    return true
  }

  // Split on top-level OR first, then AND within each branch.
  const orParts = splitBooleanExpression(trimmed, 'OR')
  return orParts.some(orPart => {
    const andParts = splitBooleanExpression(orPart, 'AND')
    return andParts.every(clause => evaluateRelationalClause(clause, layer))
  })
}

/**
 * Splits an expression on a top-level boolean operator.
 *
 * @param expression - Expression text.
 * @param operator - `AND` or `OR`.
 * @returns Clause segments.
 */
function splitBooleanExpression(
  expression: string,
  operator: 'AND' | 'OR'
): string[] {
  const pattern = new RegExp(`\\s+${operator}\\s+`, 'i')
  return expression
    .split(pattern)
    .map(part => part.trim())
    .filter(part => part.length > 0)
}

/**
 * Evaluates a single relational clause such as `LOCKED=="False"`.
 *
 * @param clause - Relational clause.
 * @param layer - Layer to evaluate.
 * @returns `true` if the clause matches.
 */
function evaluateRelationalClause(
  clause: string,
  layer: AcDbLayerTableRecord
): boolean {
  const match = clause
    .trim()
    .match(/^([A-Za-z_]+)\s*(==|=)\s*"?(.*?)"?\s*$/)
  if (!match) {
    return false
  }

  const property = match[1].toUpperCase()
  const expected = match[3]
  const expectedBool = parseBooleanLiteral(expected)

  switch (property) {
    case 'NAME':
      return matchLayerNamePattern(layer.name, expected)
    case 'LOCKED':
      return expectedBool != null ? layer.isLocked === expectedBool : false
    case 'FROZEN':
      return expectedBool != null ? layer.isFrozen === expectedBool : false
    case 'OFF':
      return expectedBool != null ? layer.isOff === expectedBool : false
    case 'PLOT':
      return expectedBool != null ? layer.isPlottable === expectedBool : false
    case 'COLOR': {
      const colorIndex = layer.color?.colorIndex
      return colorIndex != null && String(colorIndex) === expected
    }
    case 'LINETYPE':
      return (
        layer.linetype.localeCompare(expected, undefined, {
          sensitivity: 'accent'
        }) === 0
      )
    default:
      return false
  }
}

/**
 * Matches a layer name against an AutoCAD-style filter pattern.
 *
 * Supports `*` (any sequence) and `?` (any single character). Matching is
 * case-insensitive to mirror AutoCAD layer name comparisons.
 *
 * @param layerName - Layer table record name.
 * @param pattern - Filter pattern from a `NAME=="..."` clause.
 * @returns `true` if the layer name matches the pattern.
 */
function matchLayerNamePattern(layerName: string, pattern: string): boolean {
  if (!/[*?]/.test(pattern)) {
    return (
      layerName.localeCompare(pattern, undefined, {
        sensitivity: 'accent'
      }) === 0
    )
  }

  const regex = new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i'
  )
  return regex.test(layerName)
}

/**
 * Parses AutoCAD boolean literals used in filter expressions.
 *
 * @param value - Literal text such as `True` / `False`.
 * @returns Parsed boolean, or `null` if not recognized.
 */
function parseBooleanLiteral(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === '0') {
    return false
  }
  return null
}

/**
 * Type alias used by group filters for layer object IDs.
 */
export type AcLyLayerId = AcDbObjectId

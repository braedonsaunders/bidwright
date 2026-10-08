import { AcLyLayerFilter } from './AcLyLayerFilter'

/**
 * In-memory tree of Layer Manager filters for a drawing database.
 *
 * Mirrors the AutoCAD .NET `LayerFilterTree` wrapper around the ObjectARX
 * `AcLy*` filter hierarchy. The tree is typically accessed through
 * {@link AcDbDatabase.layerFilters}.
 *
 * @remarks
 * AutoCAD exposes the tree **by value**: callers should get the tree, mutate
 * {@link root} / nested filters, then assign it back to the database.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcLy_Classes
 *
 * @example
 * ```typescript
 * const tree = db.layerFilters;
 * const unlocked = new AcLyLayerFilter();
 * unlocked.name = 'Unlocked Layers';
 * unlocked.setFilterExpression('LOCKED=="False"');
 * tree.root.addNested(unlocked);
 * db.layerFilters = tree;
 * ```
 */
export class AcLyLayerFilterTree {
  /** Root filter of the tree. */
  private _root: AcLyLayerFilter
  /** Currently active filter, if any. */
  private _current: AcLyLayerFilter | null

  /**
   * Creates a new {@link AcLyLayerFilterTree}.
   *
   * @param root - Root filter. When omitted, a default `"All"` root is created.
   * @param current - Currently active filter (defaults to `root`).
   */
  constructor(root?: AcLyLayerFilter, current?: AcLyLayerFilter | null) {
    this._root = root ?? AcLyLayerFilterTree.createDefaultRoot()
    this._current = current === undefined ? this._root : current
  }

  /**
   * Creates the default root property filter used by AutoCAD (`All`).
   *
   * @returns A root {@link AcLyLayerFilter}.
   */
  static createDefaultRoot(): AcLyLayerFilter {
    const root = new AcLyLayerFilter()
    root.setName('All')
    root.setAllowDelete(false)
    root.setAllowRename(false)
    root.setFilterExpression('')
    return root
  }

  /**
   * Gets the root filter of this tree.
   *
   * @returns The root {@link AcLyLayerFilter}.
   */
  get root(): AcLyLayerFilter {
    return this._root
  }

  /**
   * Gets the currently active filter.
   *
   * @returns The current filter, or `null`.
   */
  get current(): AcLyLayerFilter | null {
    return this._current
  }

  /**
   * Sets the currently active filter.
   *
   * @param value - Filter to make current, or `null`.
   */
  set current(value: AcLyLayerFilter | null) {
    this._current = value
  }

  /**
   * Creates a shallow copy of this tree that shares the same filter instances.
   *
   * @remarks
   * Useful when following AutoCAD's by-value `Database.LayerFilters` pattern.
   *
   * @returns A new {@link AcLyLayerFilterTree}.
   */
  clone(): AcLyLayerFilterTree {
    return new AcLyLayerFilterTree(this._root, this._current)
  }
}

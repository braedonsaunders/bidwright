import type { AcDbObjectId } from '../base/AcDbObject'
import type { AcDbLayerTableRecord } from '../database/AcDbLayerTableRecord'
import { AcLyLayerFilter } from './AcLyLayerFilter'

/**
 * Layer group filter (ID filter) used by the Layer Properties Manager.
 *
 * An {@link AcLyLayerGroup} selects layers by object ID rather than by a
 * property expression. Use {@link isIdFilter} (always `true`) to distinguish
 * group filters from property filters.
 *
 * Nesting rules (AutoCAD Layer Manager behavior):
 * - A group filter may contain other group filters.
 * - A group filter may contain property filters.
 * - A property filter may **not** contain a group filter (enforced by
 *   {@link AcLyLayerFilter.addNested}).
 *
 * @remarks
 * Mirrors ObjectARX `AcLyLayerGroup`. Filter expression APIs are unused and
 * return empty / `null` values.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcLy_Classes
 *
 * @example
 * ```typescript
 * const group = new AcLyLayerGroup();
 * group.name = 'My Layer Group';
 * group.addLayerId(layer.objectId);
 *
 * const tree = db.layerFilters;
 * tree.root.addNested(group); // root may contain groups
 *
 * const nested = new AcLyLayerGroup();
 * nested.name = 'Nested Group';
 * group.addNested(nested); // group may contain groups
 * ```
 */
export class AcLyLayerGroup extends AcLyLayerFilter {
  /** Layer object IDs included in this group. */
  private readonly _layerIds: AcDbObjectId[]

  /**
   * Creates a new {@link AcLyLayerGroup} instance.
   */
  constructor() {
    super()
    this._layerIds = []
  }

  /**
   * Returns whether this filter is an ID/group filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerFilter::isIdFilter` for group filters.
   *
   * @returns Always `true`.
   */
  override isIdFilter(): boolean {
    return true
  }

  /**
   * Gets the layer object IDs included in this group.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerGroup::layerIds`.
   *
   * @returns A read-only array of layer object IDs.
   */
  layerIds(): readonly AcDbObjectId[] {
    return this._layerIds
  }

  /**
   * Convenience accessor for layer IDs (mirrors .NET `LayerIds`).
   *
   * @returns A read-only array of layer object IDs.
   */
  get layerIdList(): readonly AcDbObjectId[] {
    return this._layerIds
  }

  /**
   * Adds a layer object ID to this group.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerGroup::addLayerId`.
   *
   * @param layerId - Layer table record object ID to include.
   * @returns `true` if the ID was added; `false` if empty or already present.
   */
  addLayerId(layerId: AcDbObjectId): boolean {
    if (!layerId) {
      return false
    }
    if (this._layerIds.includes(layerId)) {
      return false
    }
    this._layerIds.push(layerId)
    return true
  }

  /**
   * Removes a layer object ID from this group.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerGroup::removeLayerId`.
   *
   * @param layerId - Layer table record object ID to remove.
   * @returns `true` if the ID was removed.
   */
  removeLayerId(layerId: AcDbObjectId): boolean {
    const index = this._layerIds.indexOf(layerId)
    if (index < 0) {
      return false
    }
    this._layerIds.splice(index, 1)
    return true
  }

  /**
   * Tests whether the given layer is a member of this group.
   *
   * @remarks
   * Mirrors ObjectARX `AcLyLayerGroup` filter behavior: returns `true` when
   * the layer's object ID is contained in {@link layerIds}.
   *
   * @param layer - Layer table record to test.
   * @returns `true` if the layer ID is in this group.
   */
  override filter(layer: AcDbLayerTableRecord): boolean {
    if (!layer) {
      return false
    }
    return this._layerIds.includes(layer.objectId)
  }

  /**
   * Group filters do not use filter expression strings.
   *
   * @param _expression - Ignored.
   * @returns Always `false`.
   */
  override setFilterExpression(_expression: string): boolean {
    return false
  }
}

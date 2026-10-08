import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbFilter } from './AcDbFilter'

/**
 * Layer filter object used with the AutoCAD **index/filter** scheme
 * (`INDEXCTL` / block regeneration), not the Layer Properties Manager tree.
 *
 * An {@link AcDbLayerFilter} stores a flat list of layer names that participate
 * in a layer-based query against a block. It is the counterpart to
 * {@link AcDbLayerIndex}; {@link AcDbLayerFilter.indexClass} returns the layer
 * index class name.
 *
 * @remarks
 * Mirrors the ObjectARX `AcDbLayerFilter` class. For the Layer Manager
 * property/group filter **tree**, see {@link AcLyLayerFilter} /
 * {@link AcLyLayerGroup} under the ObjectARX `AcLy*` classes.
 *
 * In DXF this object is written as type `LAYER_FILTER` with subclass markers
 * `AcDbFilter` and `AcDbLayerFilter`, and repeated group code 8 entries for
 * layer names.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbLayerFilter
 *
 * @example
 * ```typescript
 * const filter = new AcDbLayerFilter();
 * filter.add('Walls');
 * filter.add('Doors');
 * console.log(filter.layerCount()); // 2
 * console.log(filter.getAt(0)); // 'Walls'
 * ```
 */
export class AcDbLayerFilter extends AcDbFilter {
  /** Layer names included in this filter (DXF group code 8, repeated). */
  private _layerNames: string[]

  /**
   * Creates a new {@link AcDbLayerFilter} instance.
   *
   * @example
   * ```typescript
   * const filter = new AcDbLayerFilter();
   * ```
   */
  constructor() {
    super()
    this._layerNames = []
  }

  /**
   * Gets a copy of the layer names stored in this filter.
   *
   * @returns An array of layer names.
   */
  get layerNames(): readonly string[] {
    return this._layerNames
  }

  /**
   * Replaces the layer names stored in this filter.
   *
   * @param value - The new list of layer names.
   */
  set layerNames(value: readonly string[]) {
    this._layerNames = [...value]
  }

  /**
   * Adds a layer name to this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerFilter::add`. Duplicate names are ignored.
   *
   * @param layerName - Layer name to include in the filter.
   * @returns `true` if the name was added; `false` if it was empty or already present.
   *
   * @example
   * ```typescript
   * filter.add('0');
   * ```
   */
  add(layerName: string): boolean {
    const name = layerName?.trim()
    if (!name) return false
    if (this._layerNames.includes(name)) return false
    this._layerNames.push(name)
    return true
  }

  /**
   * Gets the layer name at the specified index.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerFilter::getAt`.
   *
   * @param index - Zero-based index into the layer name list.
   * @returns The layer name at `index`.
   * @throws {Error} If `index` is out of range.
   *
   * @example
   * ```typescript
   * const name = filter.getAt(0);
   * ```
   */
  getAt(index: number): string {
    if (index < 0 || index >= this._layerNames.length) {
      throw new Error('The layer index is out of range!')
    }
    return this._layerNames[index]
  }

  /**
   * Removes a layer name from this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerFilter::remove`.
   *
   * @param layerName - Layer name to remove.
   * @returns `true` if the name was removed; otherwise `false`.
   *
   * @example
   * ```typescript
   * filter.remove('Walls');
   * ```
   */
  remove(layerName: string): boolean {
    const index = this._layerNames.indexOf(layerName)
    if (index < 0) return false
    this._layerNames.splice(index, 1)
    return true
  }

  /**
   * Returns the number of layer names in this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerFilter::layerCount`.
   *
   * @returns The number of layer names.
   *
   * @example
   * ```typescript
   * const count = filter.layerCount();
   * ```
   */
  layerCount(): number {
    return this._layerNames.length
  }

  /**
   * Returns the index class name associated with this filter.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerFilter::indexClass`, which returns
   * `AcDbLayerIndex::desc()`. This port returns the class name string.
   *
   * @returns Always `'AcDbLayerIndex'`.
   */
  override indexClass(): string {
    return 'AcDbLayerIndex'
  }

  /**
   * Returns whether this filter is considered valid.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerFilter::isValid`. A filter is valid when it
   * contains at least one non-empty layer name.
   *
   * @returns `true` if the filter is valid; otherwise `false`.
   */
  isValid(): boolean {
    return this._layerNames.some(name => name.length > 0)
  }

  /**
   * Writes DXF fields for this layer filter object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbLayerFilter')
    for (const layerName of this._layerNames) {
      filer.writeString(8, layerName)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbLayerFilter')

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      switch (code) {
        case 8:
          this.add(String(item.value))
          break
        case 100:
          filer.pushBackItem(item)
          return this
        default:
          break
      }
    }
    return this
  }
}

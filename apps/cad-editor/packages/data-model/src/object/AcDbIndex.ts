import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject, AcDbObjectId } from '../base/AcDbObject'
import type { AcDbFilter } from './AcDbFilter'

/**
 * Opaque handle for filtered-block iteration results.
 *
 * @remarks
 * ObjectARX returns an `AcDbFilteredBlockIterator*`. A full iterator
 * implementation is not yet available in this port; methods that would create
 * one currently return `null`.
 */
export type AcDbFilteredBlockIterator = object

/**
 * Opaque handle for index rebuild update data.
 *
 * @remarks
 * Mirrors ObjectARX `AcDbIndexUpdateData`. Passed to
 * {@link AcDbIndex.rebuildFull}.
 */
export type AcDbIndexUpdateData = object

/**
 * Opaque handle for block-change iteration during incremental rebuilds.
 *
 * @remarks
 * Mirrors ObjectARX `AcDbBlockChangeIterator`. Passed to
 * {@link AcDbIndex.rebuildModified}.
 */
export type AcDbBlockChangeIterator = object

/**
 * Abstract base class for index objects used with the AutoCAD index/filter
 * scheme.
 *
 * An {@link AcDbIndex} accelerates queries defined by an {@link AcDbFilter}.
 * Keeping the index up to date is typically done through index-filter manager
 * update calls (or during save).
 *
 * @remarks
 * Mirrors the ObjectARX `AcDbIndex` class. {@link AcDbLayerIndex} and spatial
 * indexes derive from this type.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbIndex
 *
 * @example
 * ```typescript
 * const index = new AcDbLayerIndex();
 * index.lastUpdatedAt = Date.now();
 * ```
 */
export abstract class AcDbIndex extends AcDbObject {
  /** Julian / local last-updated timestamp (DXF group code 40). */
  private _lastUpdatedAt: number
  /** UTC last-updated timestamp. */
  private _lastUpdatedAtU: number
  /** Whether this index is considered current. */
  private _isUptoDate: boolean
  /** Object ID of the block table record being indexed. */
  private _objectBeingIndexedId: AcDbObjectId

  /**
   * Creates a new {@link AcDbIndex} instance.
   */
  constructor() {
    super()
    this._lastUpdatedAt = 0
    this._lastUpdatedAtU = 0
    this._isUptoDate = false
    this._objectBeingIndexedId = ''
  }

  /**
   * Gets the local last-updated timestamp for this index.
   *
   * @remarks
   * In ObjectARX this returns an `AcDbDate`. This port stores a numeric
   * timestamp (Julian date when read from DXF group code 40).
   *
   * @returns The last-updated timestamp.
   */
  get lastUpdatedAt(): number {
    return this._lastUpdatedAt
  }

  /**
   * Sets the local last-updated timestamp for this index.
   *
   * @param value - The new timestamp value.
   */
  set lastUpdatedAt(value: number) {
    this._lastUpdatedAt = value
  }

  /**
   * Gets the UTC last-updated timestamp for this index.
   *
   * @returns The UTC last-updated timestamp.
   */
  get lastUpdatedAtU(): number {
    return this._lastUpdatedAtU
  }

  /**
   * Sets the UTC last-updated timestamp for this index.
   *
   * @param value - The new UTC timestamp value.
   */
  set lastUpdatedAtU(value: number) {
    this._lastUpdatedAtU = value
  }

  /**
   * Returns whether this index is considered up to date.
   *
   * @returns `true` if the index is current; otherwise `false`.
   */
  get isUptoDate(): boolean {
    return this._isUptoDate
  }

  /**
   * Sets whether this index is considered up to date.
   *
   * @param value - `true` if the index is current.
   */
  set isUptoDate(value: boolean) {
    this._isUptoDate = value
  }

  /**
   * Gets the object ID of the object (typically a block table record) being
   * indexed.
   *
   * @returns The object ID being indexed.
   */
  objectBeingIndexedId(): AcDbObjectId {
    return this._objectBeingIndexedId
  }

  /**
   * Sets the object ID of the object being indexed.
   *
   * @param value - The object ID to associate with this index.
   */
  setObjectBeingIndexedId(value: AcDbObjectId): void {
    this._objectBeingIndexedId = value
  }

  /**
   * Creates a filtered block iterator for the given filter query.
   *
   * @param filter - The filter defining the query.
   * @returns A filtered block iterator, or `null` if not available.
   */
  abstract newIterator(
    filter: AcDbFilter
  ): AcDbFilteredBlockIterator | null

  /**
   * Fully rebuilds this index from the given update data.
   *
   * @param updateData - Index update mapping data.
   * @returns `true` if the rebuild succeeded.
   */
  abstract rebuildFull(updateData?: AcDbIndexUpdateData): boolean

  /**
   * Incrementally rebuilds this index for modified block contents.
   *
   * @param changeIterator - Iterator over changed block entities.
   * @returns `true` if the rebuild succeeded.
   */
  protected abstract rebuildModified(
    changeIterator?: AcDbBlockChangeIterator
  ): boolean

  /**
   * Writes DXF fields for this index object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbIndex')
    filer.writeDouble(40, this.lastUpdatedAt)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbIndex')

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      switch (code) {
        case 40:
          this.lastUpdatedAt = Number(item.value)
          this.lastUpdatedAtU = this.lastUpdatedAt
          break
        case 100:
          // Next subclass (e.g. AcDbLayerIndex).
          filer.pushBackItem(item)
          return this
        default:
          break
      }
    }
    return this
  }
}

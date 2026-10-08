import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbObjectId } from '../base/AcDbObject'
import type { AcDbBlockTableRecord } from '../database/AcDbBlockTableRecord'
import type { AcDbLayerTable } from '../database/AcDbLayerTable'
import type { AcDbFilter } from './AcDbFilter'
import {
  AcDbBlockChangeIterator,
  AcDbFilteredBlockIterator,
  AcDbIndex,
  AcDbIndexUpdateData
} from './AcDbIndex'

/**
 * Describes one layer entry stored in an {@link AcDbLayerIndex}.
 *
 * @remarks
 * LAYER_INDEX DXF objects store parallel arrays of layer names (group 8),
 * hard-owner IDBUFFER handles (group 360), and IDBUFFER entry counts
 * (group 90). This type groups those related values for convenience.
 */
export interface AcDbLayerIndexEntry {
  /** Layer name (DXF group code 8). */
  layerName: string
  /** Hard-owner handle of the associated IDBUFFER object (DXF group code 360). */
  idBufferId: AcDbObjectId
  /** Number of entries in the associated IDBUFFER (DXF group code 90). */
  idBufferEntryCount: number
}

/**
 * Layer index object used with the AutoCAD index/filter scheme.
 *
 * An {@link AcDbLayerIndex} is an index implementation specialized for layers.
 * It is typically associated with a block table record and used together with
 * {@link AcDbLayerFilter} when regenerating xrefs and blocks under the
 * `INDEXCTL` system variable.
 *
 * @remarks
 * Mirrors the ObjectARX `AcDbLayerIndex` class. In DXF this object is written
 * as type `LAYER_INDEX` with subclass markers `AcDbIndex` and
 * `AcDbLayerIndex`.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbLayerIndex
 *
 * @example
 * ```typescript
 * const index = new AcDbLayerIndex();
 * index.lastUpdatedAt = 2451545.0;
 * index.layerNames = ['0', 'Walls'];
 * index.idBufferIds = ['1A', '1B'];
 * index.idBufferEntryCounts = [10, 4];
 * ```
 */
export class AcDbLayerIndex extends AcDbIndex {
  /** Layer names included in this index (DXF group code 8, repeated). */
  private _layerNames: string[]
  /** Hard-owner handles to IDBUFFER objects (DXF group code 360, repeated). */
  private _idBufferIds: AcDbObjectId[]
  /** Entry counts for each IDBUFFER (DXF group code 90, repeated). */
  private _idBufferEntryCounts: number[]

  /**
   * Creates a new {@link AcDbLayerIndex} instance.
   *
   * @example
   * ```typescript
   * const index = new AcDbLayerIndex();
   * ```
   */
  constructor() {
    super()
    this._layerNames = []
    this._idBufferIds = []
    this._idBufferEntryCounts = []
  }

  /**
   * Gets a copy of the layer names stored in this index.
   *
   * @returns An array of layer names.
   */
  get layerNames(): readonly string[] {
    return this._layerNames
  }

  /**
   * Replaces the layer names stored in this index.
   *
   * @param value - The new list of layer names.
   */
  set layerNames(value: readonly string[]) {
    this._layerNames = [...value]
  }

  /**
   * Gets a copy of the IDBUFFER object IDs referenced by this index.
   *
   * @returns An array of hard-owner IDBUFFER handles.
   */
  get idBufferIds(): readonly AcDbObjectId[] {
    return this._idBufferIds
  }

  /**
   * Replaces the IDBUFFER object IDs referenced by this index.
   *
   * @param value - The new list of IDBUFFER handles.
   */
  set idBufferIds(value: readonly AcDbObjectId[]) {
    this._idBufferIds = [...value]
  }

  /**
   * Gets a copy of the IDBUFFER entry counts stored in this index.
   *
   * @returns An array of IDBUFFER entry counts.
   */
  get idBufferEntryCounts(): readonly number[] {
    return this._idBufferEntryCounts
  }

  /**
   * Replaces the IDBUFFER entry counts stored in this index.
   *
   * @param value - The new list of entry counts.
   */
  set idBufferEntryCounts(value: readonly number[]) {
    this._idBufferEntryCounts = [...value]
  }

  /**
   * Returns grouped layer-index entries derived from the parallel DXF arrays.
   *
   * @returns An array of {@link AcDbLayerIndexEntry} values.
   */
  get entries(): AcDbLayerIndexEntry[] {
    const count = Math.max(
      this._layerNames.length,
      this._idBufferIds.length,
      this._idBufferEntryCounts.length
    )
    const result: AcDbLayerIndexEntry[] = []
    for (let i = 0; i < count; i++) {
      result.push({
        layerName: this._layerNames[i] ?? '',
        idBufferId: this._idBufferIds[i] ?? '',
        idBufferEntryCount: this._idBufferEntryCounts[i] ?? 0
      })
    }
    return result
  }

  /**
   * Replaces this index from grouped layer-index entries.
   *
   * @param value - The entries to store.
   */
  set entries(value: readonly AcDbLayerIndexEntry[]) {
    this._layerNames = value.map(entry => entry.layerName)
    this._idBufferIds = value.map(entry => entry.idBufferId)
    this._idBufferEntryCounts = value.map(entry => entry.idBufferEntryCount)
  }

  /**
   * Computes (rebuilds) this layer index from a layer table and block table
   * record.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerIndex::compute`. This port records layer names
   * present in `layerTable` and associates the index with `blockTableRecord`;
   * IDBUFFER population is not performed here.
   *
   * @param layerTable - Layer table used as the index source.
   * @param blockTableRecord - Block table record being indexed.
   * @returns `true` if the compute succeeded.
   */
  compute(
    layerTable?: AcDbLayerTable,
    blockTableRecord?: AcDbBlockTableRecord
  ): boolean {
    if (blockTableRecord) {
      this.setObjectBeingIndexedId(blockTableRecord.objectId)
    }
    if (layerTable) {
      this._layerNames = []
      for (const layer of layerTable.newIterator()) {
        this._layerNames.push(layer.name)
      }
    }
    this.lastUpdatedAt = Date.now()
    this.lastUpdatedAtU = Date.now()
    this.isUptoDate = true
    return true
  }

  /**
   * Creates a filtered block iterator for the given layer filter query.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerIndex::newIterator`. A full filtered iterator
   * is not yet implemented in this port.
   *
   * @param _filter - The filter defining the query (typically an
   *   {@link AcDbLayerFilter}).
   * @returns Always `null` until filtered iteration is implemented.
   */
  override newIterator(_filter: AcDbFilter): AcDbFilteredBlockIterator | null {
    return null
  }

  /**
   * Fully rebuilds this layer index.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerIndex::rebuildFull`.
   *
   * @param _updateData - Optional index update mapping data.
   * @returns `true` if the rebuild succeeded.
   */
  override rebuildFull(_updateData?: AcDbIndexUpdateData): boolean {
    this.lastUpdatedAt = Date.now()
    this.lastUpdatedAtU = Date.now()
    this.isUptoDate = true
    return true
  }

  /**
   * Incrementally rebuilds this layer index for modified block contents.
   *
   * @remarks
   * Mirrors ObjectARX `AcDbLayerIndex::rebuildModified`.
   *
   * @param _changeIterator - Optional iterator over changed block entities.
   * @returns `true` if the rebuild succeeded.
   */
  protected override rebuildModified(
    _changeIterator?: AcDbBlockChangeIterator
  ): boolean {
    this.lastUpdatedAt = Date.now()
    this.lastUpdatedAtU = Date.now()
    this.isUptoDate = true
    return true
  }

  /**
   * Writes DXF fields for this layer index object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbLayerIndex')
    const count = Math.max(
      this._layerNames.length,
      this._idBufferIds.length,
      this._idBufferEntryCounts.length
    )
    for (let i = 0; i < count; i++) {
      if (this._layerNames[i] != null) {
        filer.writeString(8, this._layerNames[i])
      }
      if (this._idBufferIds[i]) {
        filer.writeHandle(360, this._idBufferIds[i])
      }
      if (this._idBufferEntryCounts[i] != null) {
        filer.writeInt32(90, this._idBufferEntryCounts[i])
      }
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbLayerIndex')

    const layerNames: string[] = []
    const idBufferIds: AcDbObjectId[] = []
    const idBufferEntryCounts: number[] = []

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      switch (code) {
        case 8:
          layerNames.push(String(item.value))
          break
        case 360:
          idBufferIds.push(String(item.value))
          break
        case 90:
          idBufferEntryCounts.push(Number(item.value))
          break
        case 100:
          filer.pushBackItem(item)
          this.layerNames = layerNames
          this.idBufferIds = idBufferIds
          this.idBufferEntryCounts = idBufferEntryCounts
          this.isUptoDate = true
          return this
        default:
          break
      }
    }

    this.layerNames = layerNames
    this.idBufferIds = idBufferIds
    this.idBufferEntryCounts = idBufferEntryCounts
    this.isUptoDate = true
    return this
  }
}

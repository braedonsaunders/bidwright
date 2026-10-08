import { defaults } from '@mlightcad/common'
import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObjectId } from '../base/AcDbObject'
import { AcDbEntity } from '../entity/AcDbEntity'
import { AcDbObjectIterator } from '../misc/AcDbObjectIterator'
import { AcDbUnitsValue } from '../misc/AcDbUnitsValue'
import { acdbHexStringsToBytes } from '../misc/proxyGraphic/AcDbProxyGraphicBinaryStream'
import {
  AcDbSymbolTableRecord,
  AcDbSymbolTableRecordAttrs
} from './AcDbSymbolTableRecord'

/**
 * Block table record that serves as a container for entities within drawing databases.
 *
 * Block table records (BTRs) are used to organize and group entities together.
 * There are two special BTRs that are always present in every database:
 * - *MODEL_SPACE: Contains entities in model space
 * - *PAPER_SPACE: Contains entities in paper space
 *
 * Each block table record has an origin point and can contain multiple entities.
 *
 * @example
 * ```typescript
 * const blockRecord = new AcDbBlockTableRecord();
 * blockRecord.name = 'MyBlock';
 * blockRecord.origin = new AcGePoint3d(0, 0, 0);
 * blockRecord.appendEntity(new AcDbLine());
 * ```
 */
export enum AcDbBlockScaling {
  Any,
  Uniform
}

/**
 * Block-type flags for {@link AcDbBlockTableRecord} (DXF group code 70 on BLOCK).
 *
 * Bit values may be combined.
 */
export enum AcDbBlockTableRecordFlag {
  /** No special block type flags apply */
  None = 0,
  /** Anonymous block (hatch, associative dimension, etc.) */
  Anonymous = 1,
  /** Block has non-constant attribute definitions */
  HasNonConstantAttributes = 2,
  /** External reference (xref) */
  Xref = 4,
  /** Xref overlay */
  XrefOverlay = 8,
  /** Externally dependent */
  ExternallyDependent = 16,
  /** Resolved external reference (or dependent of one) */
  Resolved = 32,
  /** Referenced external reference */
  Referenced = 64
}

/**
 * Interface defining the attributes for block table records.
 */
export interface AcDbBlockTableRecordAttrs extends AcDbSymbolTableRecordAttrs {
  /** The base point of the block in WCS coordinates */
  origin: AcGePoint3d
  /** The object id of the associated AcDbLayout object in the Layouts dictionary */
  layoutId: AcDbObjectId
  /** Block insertion units (DXF group code 70 on BLOCK_RECORD) */
  blockInsertUnits: AcDbUnitsValue
  /** Block explodability flag (DXF group code 280) */
  explodability: number
  /** Block scalability flag (DXF group code 281) */
  blockScaling: AcDbBlockScaling
  /**
   * Block-type flags (DXF group code 70 on BLOCK / BLOCK_HEADER).
   * See {@link AcDbBlockTableRecordFlag}.
   */
  flags: number
  /**
   * Path name of the externally referenced drawing when this block is an xref
   * (DXF group code 1 on BLOCK). Empty when not an xref or the path is unknown.
   */
  pathName: string
  /**
   * PreviewIcon binary payload (DXF BLOCK_RECORD group 310), typically a DIB
   * (BITMAPINFO + bits). Stored as raw bytes rather than hex to save memory.
   */
  previewIcon?: Uint8Array
}

export class AcDbBlockTableRecord extends AcDbSymbolTableRecord<AcDbBlockTableRecordAttrs> {
  /** Name constant for model space block table record */
  static MODEL_SPACE_NAME = '*Model_Space'
  /** Name prefix for paper space block table records */
  static PAPER_SPACE_NAME_PREFIX = '*Paper_Space'

  /** Entities owned by this block table record, in insertion order */
  private _entities: AcDbEntity[]

  /**
   * Returns true if the specified name is the name of the model space block table record.
   *
   * Model space is the primary drawing area where most entities are created.
   *
   * @param name - The name of one block table record.
   * @returns True if the specified name is the name of the model space block table record.
   *
   * @example
   * ```typescript
   * if (AcDbBlockTableRecord.isModelSapceName('*Model_Space')) {
   *   console.log('This is the name of the model space block table record.');
   * }
   * ```
   */
  static isModelSapceName(name: string) {
    return (
      name.toLowerCase() == AcDbBlockTableRecord.MODEL_SPACE_NAME.toLowerCase()
    )
  }

  /**
   * Returns true if the specified name is the name of a paper space block table record.
   *
   * Paper space is used for creating layouts for printing and plotting.
   *
   * @param name - The name of one block table record.
   * @returns True if the specified name is the name of a paper space block table record.
   *
   * @example
   * ```typescript
   * if (AcDbBlockTableRecord.isPaperSapceName('*Paper_Space1')) {
   *   console.log('This is the name of the paper space block table record.');
   * }
   * ```
   */
  static isPaperSapceName(name: string) {
    return name
      .toLowerCase()
      .startsWith(AcDbBlockTableRecord.PAPER_SPACE_NAME_PREFIX.toLowerCase())
  }

  /**
   * Clears AutoCAD-internal xref status bits from BLOCK flags read from a file.
   *
   * DXF group 70 bits 32 ({@link AcDbBlockTableRecordFlag.Resolved}) and 64
   * ({@link AcDbBlockTableRecordFlag.Referenced}) are documented as AutoCAD
   * internal and ignored on input. Web converters do not bind xref geometry, so
   * those bits must not suppress {@link isUnresolvedXref}. Runtime code (for
   * example XATTACH overlay load) may set Resolved after content is available.
   *
   * @param flags - Raw block-type flags from DXF/DWG.
   * @returns Flags with Resolved and Referenced cleared.
   */
  static sanitizeImportedFlags(flags: number) {
    return (
      flags &
      ~(
        AcDbBlockTableRecordFlag.Resolved |
        AcDbBlockTableRecordFlag.Referenced
      )
    )
  }

  /**
   * Creates a new AcDbBlockTableRecord instance.
   *
   * @param attrs - Input attribute values for this block table record
   * @param defaultAttrs - Default values for attributes of this block table record
   *
   * @example
   * ```typescript
   * const blockRecord = new AcDbBlockTableRecord();
   * ```
   */
  constructor(
    attrs?: Partial<AcDbBlockTableRecordAttrs>,
    defaultAttrs?: Partial<AcDbBlockTableRecordAttrs>
  ) {
    attrs = attrs || {}
    defaults(attrs, {
      origin: new AcGePoint3d(),
      layoutId: '',
      flags: AcDbBlockTableRecordFlag.None,
      pathName: '',
      blockInsertUnits: 0,
      explodability: 1,
      blockScaling: AcDbBlockScaling.Uniform,
      previewIcon: undefined
    })
    super(attrs, defaultAttrs)
    this._entities = []
  }

  /**
   * Returns true if this is a model space block table record.
   *
   * Model space is the primary drawing area where most entities are created.
   *
   * @returns True if this is a model space block table record
   *
   * @example
   * ```typescript
   * if (blockRecord.isModelSapce) {
   *   console.log('This is model space');
   * }
   * ```
   */
  get isModelSapce() {
    return AcDbBlockTableRecord.isModelSapceName(this.name)
  }

  /**
   * Returns true if this is a paper space block table record.
   *
   * Paper space is used for creating layouts for printing and plotting.
   *
   * @returns True if this is a paper space block table record
   *
   * @example
   * ```typescript
   * if (blockRecord.isPaperSapce) {
   *   console.log('This is paper space');
   * }
   * ```
   */
  get isPaperSapce() {
    return AcDbBlockTableRecord.isPaperSapceName(this.name)
  }

  /**
   * Gets or sets the base point of the block in WCS coordinates.
   *
   * This point is the origin of the MCS (Model Coordinate System), which is the
   * local WCS for the entities within the block table record.
   *
   * @returns The origin point of the block
   *
   * @example
   * ```typescript
   * const origin = blockRecord.origin;
   * blockRecord.origin = new AcGePoint3d(10, 20, 0);
   * ```
   */
  get origin() {
    return this.getAttr('origin')
  }
  set origin(value: AcGePoint3d) {
    this.getAttr('origin').copy(value)
  }

  /**
   * Gets or sets the object ID of the associated AcDbLayout object in the Layouts dictionary.
   *
   * This property links the block table record to its corresponding layout object,
   * which defines the viewport configuration and display settings for the block.
   * For model space blocks, this is typically empty, while paper space blocks
   * have a corresponding layout ID.
   *
   * @returns The object ID of the associated layout
   *
   * @example
   * ```typescript
   * const layoutId = blockRecord.layoutId;
   * blockRecord.layoutId = 'some-layout-object-id';
   * ```
   */
  get layoutId() {
    return this.getAttr('layoutId')
  }
  set layoutId(value: AcDbObjectId) {
    this.setAttr('layoutId', value)
  }

  /**
   * Gets or sets block-type flags (DXF BLOCK group code 70).
   *
   * @see {@link AcDbBlockTableRecordFlag}
   */
  get flags() {
    return this.getAttr('flags')
  }
  set flags(value: number) {
    this.setAttr('flags', value)
  }

  /**
   * Gets or sets the path of the externally referenced drawing.
   *
   * Corresponds to DXF BLOCK group code 1. Empty when this is not an xref.
   */
  get pathName() {
    return this.getAttr('pathName')
  }
  set pathName(value: string) {
    this.setAttr('pathName', value)
  }

  /**
   * True when this block is an external reference or an xref overlay.
   */
  get isXref() {
    return (
      (this.flags &
        (AcDbBlockTableRecordFlag.Xref |
          AcDbBlockTableRecordFlag.XrefOverlay)) !==
      0
    )
  }

  /**
   * True when this block is an xref overlay (flag bit 8).
   */
  get isOverlayReference() {
    return (this.flags & AcDbBlockTableRecordFlag.XrefOverlay) !== 0
  }

  /**
   * True when this is an xref whose content has not been loaded into the block.
   *
   * File importers clear the Resolved bit via {@link sanitizeImportedFlags}
   * because AutoCAD often writes Resolved even though web converters do not bind
   * xref geometry. Runtime loaders (for example XATTACH) may set Resolved once
   * an overlay session is available, even when the BTR stays empty.
   */
  get isUnresolvedXref() {
    if (!this.isXref) return false
    if ((this.flags & AcDbBlockTableRecordFlag.Resolved) !== 0) {
      return false
    }
    return this._entities.length === 0
  }

  /**
   * Gets or sets the block insertion units.
   *
   * This corresponds to DXF group code 70 in BLOCK_RECORD entries.
   *
   * @returns The insertion units value
   */
  get blockInsertUnits() {
    return this.getAttr('blockInsertUnits')
  }
  set blockInsertUnits(value: AcDbUnitsValue) {
    this.setAttr('blockInsertUnits', value)
  }

  /**
   * Gets or sets the block explodability flag.
   *
   * This corresponds to DXF group code 280 in BLOCK_RECORD entries.
   *
   * @returns The explodability value
   */
  get explodability() {
    return this.getAttr('explodability')
  }
  set explodability(value: number) {
    this.setAttr('explodability', value)
  }

  /**
   * Gets or sets the block scalability flag.
   *
   * This corresponds to DXF group code 281 in BLOCK_RECORD entries.
   *
   * @returns The scalability value
   */
  get blockScaling() {
    return this.getAttr('blockScaling')
  }
  set blockScaling(value: AcDbBlockScaling) {
    this.setAttr('blockScaling', value)
  }

  /**
   * Gets or sets the PreviewIcon binary payload for this block definition.
   *
   * Corresponds to AutoCAD .NET `BlockTableRecord.PreviewIcon` and DXF
   * BLOCK_RECORD group code 310. The payload is typically a DIB (BITMAPINFO +
   * bits), not a full BMP file. Stored as raw bytes to avoid hex doubling.
   *
   * @returns Preview icon bytes, or `undefined` when none exist
   */
  get previewIcon(): Uint8Array | undefined {
    return this.getAttrWithoutException('previewIcon')
  }
  set previewIcon(value: Uint8Array | undefined) {
    if (!value || value.length === 0) {
      this.setAttr('previewIcon', undefined)
      return
    }
    this.setAttr('previewIcon', value)
  }

  /**
   * Appends the specified entity or entities to this block table record.
   *
   * This method adds an entity to the block and sets up the necessary
   * relationships between the entity and the block table record.
   *
   * @param entity - The entity or entities to append to this block table record
   *
   * @example
   * ```typescript
   * const line = new AcDbLine();
   * blockRecord.appendEntity(line);
   * ```
   */
  appendEntity(entity: AcDbEntity | AcDbEntity[]) {
    const manager = this.database.transactionManager
    if (
      manager.strictMode &&
      !manager.isRecording() &&
      !manager.isApplyingUndoRedo()
    ) {
      throw new Error('Cannot append entities outside an active transaction.')
    }

    const commitEntity = (item: AcDbEntity) => {
      item.database = this.database
      item.ownerId = this.objectId
      this.database.ensureEntityStyleDefaults(item)
      this.database.commitObjectHandle(item, id => this.hasEntityId(id))
      item.resolveEffectiveProperties()
      this._entities.push(item)
      if (
        item.dxfTypeName === 'INSERT' &&
        'syncAttributeDatabases' in item &&
        typeof item.syncAttributeDatabases === 'function'
      ) {
        item.syncAttributeDatabases()
      }
    }

    const entitiesToAppend = Array.isArray(entity) ? entity : [entity]
    for (const item of entitiesToAppend) {
      commitEntity(item)
    }

    if (manager.isRecording()) {
      for (const item of entitiesToAppend) {
        manager.recordAppend(
          { type: 'blockTableRecord', ownerId: this.objectId },
          item
        )
      }
    }

    // When creating one block, it will also go to this function. But we don't want `entityAppended` event
    // tiggered in this case. So check whether the block name is name of the model space.
    if (
      (this.isModelSapce || this.isPaperSapce) &&
      !manager.isRecording() &&
      !manager.isApplyingUndoRedo()
    ) {
      this.database.notifyEntityAppended(entity)
    }
  }

  /**
   * Removes the specified entity or entities from this block table record.
   *
   * Notes:
   * Please call method AcDbEntity.erase to remove one entity instead of calling
   * this function.
   *
   * AutoCAD ObjectARX API doesn't provide such one method to remove entities
   * from the block table record. I guess it is done by friend class or function
   * feature in C++. However, there are no similar feature in TypeScript. So
   * we have to expose such one public method in AcDbBlockTableRecord.
   *
   * @param objectId - The object id or ids of entities to remove from this block table record
   * @returns ??true if an entity in the block table record existed and has been removed,
   * or false if the entity does not exist.
   */
  removeEntity(objectId: AcDbObjectId | AcDbObjectId[]) {
    const manager = this.database.transactionManager
    if (
      manager.strictMode &&
      !manager.isRecording() &&
      !manager.isApplyingUndoRedo()
    ) {
      throw new Error('Cannot remove entities outside an active transaction.')
    }

    const ids = Array.isArray(objectId) ? objectId : [objectId]
    if (ids.length === 0) {
      return false
    }

    const idSet = new Set(ids)
    const entities: AcDbEntity[] = []
    let write = 0

    for (const entity of this._entities) {
      if (idSet.has(entity.objectId)) {
        if (manager.isRecording()) {
          manager.recordRemove(
            { type: 'blockTableRecord', ownerId: this.objectId },
            entity
          )
        }
        entities.push(entity)
        this.database.releaseObjectHandle(entity)
      } else {
        this._entities[write++] = entity
      }
    }
    this._entities.length = write
    if (
      entities.length > 0 &&
      !manager.isRecording() &&
      !manager.isApplyingUndoRedo()
    ) {
      this.database.notifyEntityErased(entities)
    }
    return entities.length > 0
  }

  /**
   * Creates an iterator object that can be used to iterate over the entities in the block table record.
   *
   * @returns An iterator object that can be used to iterate over the entities
   *
   * @example
   * ```typescript
   * const iterator = blockRecord.newIterator();
   * for (const entity of iterator) {
   *   console.log('Entity:', entity.type);
   * }
   * ```
   */
  newIterator(): AcDbObjectIterator<AcDbEntity> {
    return new AcDbObjectIterator(this._entities)
  }

  /**
   * Searches for an entity in this block table record with the specified ID.
   *
   * @param id - The entity ID to search for
   * @returns The entity with the specified ID, or undefined if not found
   */
  getIdAt(id: AcDbObjectId) {
    const object = this.database.getObjectById(id)
    if (!(object instanceof AcDbEntity)) {
      return undefined
    }
    const ownerId = object.getAttrWithoutException('ownerId')
    if (ownerId !== this.objectId) {
      return undefined
    }
    return object
  }

  /**
   * Returns true when this block table record already owns an entity with the given id.
   *
   * @internal
   */
  hasEntityId(id: AcDbObjectId) {
    return this.getIdAt(id) !== undefined
  }

  /**
   * Writes the BLOCK_RECORD table entry for this block table record.
   *
   * @param filer - DXF output writer.
   * @returns The block table record instance (for chaining).
   */
  dxfOutBlockRecord(filer: AcDbDxfFiler) {
    filer.writeStart('BLOCK_RECORD')
    this.dxfOut(filer)
    return this
  }

  /**
   * Writes the BLOCK entity that begins a block definition in the BLOCKS section.
   *
   * @param filer - DXF output writer.
   * @returns The block table record instance (for chaining).
   */
  dxfOutBlockBegin(filer: AcDbDxfFiler) {
    filer.writeStart('BLOCK')
    // DWG/DXF parser doesn't parse AcDbBlockBegin and AcDbBlockEnd.
    // There is no handle data avaiable for AcDbBlockBegin. So generate
    // one new handle dynamically.
    filer.writeHandle(5, this.database.generateHandle())
    filer.writeObjectId(330, this.objectId)
    filer.writeSubclassMarker('AcDbEntity')
    // TODO: Assign the correct layer name
    filer.writeString(8, '0')
    filer.writeSubclassMarker('AcDbBlockBegin')
    filer.writeString(2, this.name)
    filer.writeInt16(70, this.flags)
    filer.writePoint3d(10, this.origin)
    filer.writeString(3, this.name)
    if (this.pathName) {
      filer.writeString(1, this.pathName)
    }
    return this
  }

  /**
   * Writes the ENDBLK entity that terminates a block definition.
   *
   * @param filer - DXF output writer.
   * @returns The block table record instance (for chaining).
   */
  dxfOutBlockEnd(filer: AcDbDxfFiler) {
    filer.writeStart('ENDBLK')
    // DWG/DXF parser doesn't parse AcDbBlockBegin and AcDbBlockEnd.
    // There is no handle data avaiable for AcDbBlockBegin. So generate
    // one new handle dynamically.
    filer.writeHandle(5, this.database.generateHandle())
    filer.writeObjectId(330, this.objectId)
    filer.writeSubclassMarker('AcDbEntity')
    filer.writeSubclassMarker('AcDbBlockEnd')
    return this
  }

  /**
   * Writes the BLOCK_RECORD fields for this block table record.
   *
   * @param filer - DXF output writer.
   * @returns The block table record instance (for chaining).
   */
  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbBlockTableRecord')
    filer.writeString(2, this.name)
    filer.writeInt16(70, this.blockInsertUnits)
    filer.writeInt16(280, this.explodability)
    filer.writeInt16(281, this.blockScaling)
    // TODO: Output PreviewIcon (group 310) with the correct DIB/hex format
    // if (this.previewIcon?.length) { ... }
    if (this.isModelSapce || this.isPaperSapce) {
      filer.writeObjectId(340, this.layoutId)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbSymbolTableRecord')
    filer.atSubclassData('AcDbBlockTableRecord')

    const previewChunks: string[] = []

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      if (code === 100) {
        filer.pushBackItem(item)
        break
      }
      switch (code) {
        case 2:
          this.name = String(item.value)
          break
        case 70:
          this.blockInsertUnits = Number(item.value)
          break
        case 280:
          this.explodability = Number(item.value)
          break
        case 281:
          this.blockScaling = Number(item.value) as AcDbBlockScaling
          break
        case 340:
          this.layoutId = String(item.value)
          break
        case 310: {
          const hex = String(item.value).replace(/\s+/g, '')
          if (hex) previewChunks.push(hex)
          break
        }
        default:
          break
      }
    }

    if (previewChunks.length > 0) {
      this.previewIcon = acdbHexStringsToBytes(previewChunks)
    }
    return this
  }
}

import { AcDbDxfCode } from '../base/AcDbDxfCode'
import { AcDbObject, AcDbObjectId } from '../base/AcDbObject'
import { AcDbBlockTableRecord } from '../database/AcDbBlockTableRecord'
import { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbBlockReference } from '../entity/AcDbBlockReference'
import {
  ACDB_DYN_BLOCK_ENHANCED_BLOCK,
  ACDB_DYN_BLOCK_REP_BTAG_APP,
  ACDB_DYN_BLOCK_REP_DATA,
  ACDB_DYN_BLOCK_REPRESENTATION_DICT,
  acdbIsAnonymousUserBlockName
} from '../misc/AcDbDynBlockConstants'
import { AcDbBlockRepresentationData } from './AcDbBlockRepresentationData'
import { AcDbDictionary } from './AcDbDictionary'

/**
 * ObjectARX-style helper for working with dynamic block references.
 *
 * This is not a database-resident object. Construct it from an
 * {@link AcDbBlockReference} (or its object id) and query the anonymous /
 * dynamic definition relationship used for correct display.
 *
 * @example
 * ```typescript
 * const dyn = new AcDbDynBlockReference(blockRef)
 * if (dyn.isDynamicBlock()) {
 *   const anonId = dyn.anonymousBlockTableRecord()
 *   const defId = dyn.dynamicBlockTableRecord()
 * }
 * ```
 */
export class AcDbDynBlockReference {
  private readonly _blockRef: AcDbBlockReference | undefined
  private readonly _blockRefId: AcDbObjectId

  constructor(blockRefOrId: AcDbBlockReference | AcDbObjectId) {
    if (typeof blockRefOrId === 'string') {
      this._blockRefId = blockRefOrId
      this._blockRef = undefined
    } else {
      this._blockRef = blockRefOrId
      this._blockRefId = blockRefOrId.objectId
    }
  }

  /**
   * Returns true when the given block-reference object id is a dynamic block.
   */
  static isDynamicBlock(blockRefId: AcDbObjectId, db?: AcDbDatabase): boolean {
    return new AcDbDynBlockReference(blockRefId).isDynamicBlock(db)
  }

  /**
   * Returns the block table record that should be used to draw `blockRef`.
   *
   * Prefer the anonymous representation when this is a dynamic block instance;
   * otherwise return {@link AcDbBlockReference.blockTableRecord}.
   */
  static drawableBlockTableRecord(
    blockRef: AcDbBlockReference
  ): AcDbBlockTableRecord | undefined {
    const dyn = new AcDbDynBlockReference(blockRef)
    if (dyn.isDynamicBlock()) {
      const anonId = dyn.anonymousBlockTableRecord()
      if (anonId && blockRef.database) {
        const anon = blockRef.database.tables.blockTable.getIdAt(anonId)
        if (anon) return anon
        const byId = blockRef.database.getObjectById(anonId)
        if (byId instanceof AcDbBlockTableRecord) return byId
      }
    }
    return blockRef.blockTableRecord
  }

  /**
   * Object id of the wrapped block reference.
   */
  blockId(): AcDbObjectId {
    return this._blockRefId
  }

  /**
   * Returns true when this reference is (or points at) a dynamic block.
   */
  isDynamicBlock(db?: AcDbDatabase): boolean {
    const ref = this.resolveBlockRef(db)
    if (!ref) return false

    if (this.getRepresentationData(ref)) return true
    // LibreDWG may import the AcDbBlockRepresentation dictionary tree without
    // a typed AcDbBlockRepresentationData object; the key alone is enough.
    if (this.hasRepresentationDictionary(ref)) return true

    const btr = ref.blockTableRecord
    if (!btr) return false

    if (this.getDynamicDefinitionIdFromBTag(btr)) return true
    if (this.blockTableRecordIsEnhanced(btr)) return true

    return false
  }

  /**
   * Object id of the anonymous block table record used to draw this reference,
   * or `undefined` when the reference does not use an anonymous representation.
   *
   * Matches ObjectARX `AcDbDynBlockReference::anonymousBlockTableRecord()`.
   */
  anonymousBlockTableRecord(db?: AcDbDatabase): AcDbObjectId | undefined {
    const ref = this.resolveBlockRef(db)
    if (!ref) return undefined
    if (!this.isDynamicBlock(db)) return undefined

    const btr = ref.blockTableRecord
    if (!btr) return undefined

    // Evaluated instances point at *U…; that BTR is the drawable representation.
    if (
      acdbIsAnonymousUserBlockName(btr.name) ||
      this.getDynamicDefinitionIdFromBTag(btr) != null
    ) {
      return btr.objectId
    }

    return undefined
  }

  /**
   * Object id of the original dynamic block definition, or `undefined` when
   * this is not a dynamic block reference.
   *
   * Matches ObjectARX `AcDbDynBlockReference::dynamicBlockTableRecord()`.
   */
  dynamicBlockTableRecord(db?: AcDbDatabase): AcDbObjectId | undefined {
    const ref = this.resolveBlockRef(db)
    if (!ref) return undefined

    const fromRep = this.getRepresentationData(ref)?.blockId
    if (fromRep) return fromRep

    const btr = ref.blockTableRecord
    if (!btr) return undefined

    const fromTag = this.getDynamicDefinitionIdFromBTag(btr)
    if (fromTag) return fromTag

    if (this.blockTableRecordIsEnhanced(btr)) {
      return btr.objectId
    }

    return undefined
  }

  private resolveBlockRef(db?: AcDbDatabase): AcDbBlockReference | undefined {
    if (this._blockRef) return this._blockRef
    const database = db ?? this.guessDatabase()
    if (!database) return undefined
    const obj = database.getObjectById(this._blockRefId)
    return obj instanceof AcDbBlockReference ? obj : undefined
  }

  private guessDatabase(): AcDbDatabase | undefined {
    return this._blockRef?.database
  }

  private getExtensionDictionary(
    obj: AcDbObject
  ): AcDbDictionary | undefined {
    const id = obj.extensionDictionary
    if (!id || !obj.database) return undefined
    const dict = obj.database.getObjectById(id)
    return dict instanceof AcDbDictionary ? dict : undefined
  }

  private hasRepresentationDictionary(ref: AcDbBlockReference): boolean {
    const ext = this.getExtensionDictionary(ref)
    if (!ext) return false
    return (
      ext.getAt(ACDB_DYN_BLOCK_REPRESENTATION_DICT) != null ||
      ext.has(ACDB_DYN_BLOCK_REPRESENTATION_DICT)
    )
  }

  private getRepresentationData(
    ref: AcDbBlockReference
  ): AcDbBlockRepresentationData | undefined {
    const ext = this.getExtensionDictionary(ref)
    if (!ext) return undefined

    const repDictObj = ext.getAt(ACDB_DYN_BLOCK_REPRESENTATION_DICT)
    const repDict =
      repDictObj instanceof AcDbDictionary
        ? repDictObj
        : this.asDictionary(repDictObj)
    if (!repDict) return undefined

    const repDataObj = repDict.getAt(ACDB_DYN_BLOCK_REP_DATA)
    if (repDataObj instanceof AcDbBlockRepresentationData) {
      return repDataObj
    }
    return undefined
  }

  private asDictionary(obj: AcDbObject | undefined): AcDbDictionary | undefined {
    if (!obj) return undefined
    if (obj instanceof AcDbDictionary) return obj
    // Entry may only be registered by handle; resolve again from database.
    if (!obj.database) return undefined
    const again = obj.database.getObjectById(obj.objectId)
    return again instanceof AcDbDictionary ? again : undefined
  }

  private getDynamicDefinitionIdFromBTag(
    btr: AcDbBlockTableRecord
  ): AcDbObjectId | undefined {
    const xdata = btr.getXData(ACDB_DYN_BLOCK_REP_BTAG_APP)
    if (!xdata) return undefined
    for (const item of xdata) {
      if (Number(item.code) === AcDbDxfCode.ExtendedDataHandle) {
        const handle = String(item.value ?? '').trim()
        if (handle) return handle.toUpperCase()
      }
    }
    return undefined
  }

  private blockTableRecordIsEnhanced(btr: AcDbBlockTableRecord): boolean {
    const ext = this.getExtensionDictionary(btr)
    if (!ext) return false
    return (
      ext.getAt(ACDB_DYN_BLOCK_ENHANCED_BLOCK) != null ||
      ext.has(ACDB_DYN_BLOCK_ENHANCED_BLOCK)
    )
  }
}

import { AcDbDxfCode } from '../base/AcDbDxfCode'
import { AcDbObjectId } from '../base/AcDbObject'
import { AcDbBlockTableRecord } from '../database/AcDbBlockTableRecord'
import { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbBlockReference } from '../entity/AcDbBlockReference'
import {
  ACDB_DYN_BLOCK_ENHANCED_BLOCK,
  ACDB_DYN_BLOCK_REP_BTAG_APP,
  acdbIsAnonymousUserBlockName
} from '../misc/AcDbDynBlockConstants'
import { AcDbDictionary } from './AcDbDictionary'
import { AcDbDynBlockReference } from './AcDbDynBlockReference'

/**
 * ObjectARX-style helper for a dynamic block table record (definition).
 *
 * Construct from an {@link AcDbBlockTableRecord} that owns `ACAD_ENHANCEDBLOCK`
 * (or is referenced by anonymous `*U` representations).
 */
export class AcDbDynBlockTableRecord {
  private readonly _btr: AcDbBlockTableRecord

  constructor(btr: AcDbBlockTableRecord) {
    this._btr = btr
  }

  /**
   * Returns true when the block table record is a dynamic block definition.
   */
  isDynamicBlock(): boolean {
    if (this.hasEnhancedBlockDictionary()) return true

    // Any anonymous representation tagged back to this definition.
    const selfId = this.normalizeId(this._btr.objectId)
    if (!selfId || !this._btr.database) return false
    for (const record of this._btr.database.tables.blockTable.newIterator()) {
      if (!acdbIsAnonymousUserBlockName(record.name)) continue
      if (this.definitionIdFromBTag(record) === selfId) return true
    }
    return false
  }

  /**
   * Object ids of anonymous (`*U`) block table records that represent this
   * dynamic definition.
   *
   * Matches ObjectARX `AcDbDynBlockTableRecord::getAnonymousBlockIds()`.
   */
  getAnonymousBlockIds(): AcDbObjectId[] {
    const db = this._btr.database
    if (!db) return []

    const selfId = this.normalizeId(this._btr.objectId)
    if (!selfId) return []

    const ids = new Set<string>()

    for (const record of db.tables.blockTable.newIterator()) {
      if (!acdbIsAnonymousUserBlockName(record.name)) continue
      if (this.definitionIdFromBTag(record) === selfId) {
        ids.add(record.objectId)
      }
    }

    // Also collect anonymous BTRs referenced by inserts whose dynamic
    // definition resolves to this record (covers files without BTag xdata).
    this.collectAnonymousIdsFromInserts(db, selfId, ids)

    return [...ids]
  }

  private hasEnhancedBlockDictionary(): boolean {
    const extId = this._btr.extensionDictionary
    if (!extId || !this._btr.database) return false
    const ext = this._btr.database.getObjectById(extId)
    if (!(ext instanceof AcDbDictionary)) return false
    return (
      ext.getAt(ACDB_DYN_BLOCK_ENHANCED_BLOCK) != null ||
      ext.has(ACDB_DYN_BLOCK_ENHANCED_BLOCK)
    )
  }

  private definitionIdFromBTag(
    btr: AcDbBlockTableRecord
  ): AcDbObjectId | undefined {
    const xdata = btr.getXData(ACDB_DYN_BLOCK_REP_BTAG_APP)
    if (!xdata) return undefined
    for (const item of xdata) {
      if (Number(item.code) === AcDbDxfCode.ExtendedDataHandle) {
        const handle = String(item.value ?? '').trim()
        if (handle) return this.normalizeId(handle)
      }
    }
    return undefined
  }

  private collectAnonymousIdsFromInserts(
    db: AcDbDatabase,
    selfId: string,
    ids: Set<string>
  ) {
    for (const space of db.tables.blockTable.newIterator()) {
      if (!space.isModelSapce && !space.isPaperSapce) continue
      for (const entity of space.newIterator()) {
        if (!(entity instanceof AcDbBlockReference)) continue
        const dyn = new AcDbDynBlockReference(entity)
        if (this.normalizeId(dyn.dynamicBlockTableRecord() ?? '') !== selfId) {
          continue
        }
        const anonId = dyn.anonymousBlockTableRecord()
        if (anonId) ids.add(anonId)
      }
    }
  }

  private normalizeId(id: AcDbObjectId): string {
    return String(id ?? '')
      .trim()
      .toUpperCase()
  }
}

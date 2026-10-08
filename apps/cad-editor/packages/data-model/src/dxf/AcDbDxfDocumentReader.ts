import {
  ACCM_DEFAULT_UI_YIELD_BUDGET_MS,
  AcCmUiYieldGate,
  accmYieldToUi
} from '@mlightcad/common'
import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbObjectId } from '../base/AcDbObject'
import {
  AcDbBlockTableRecord,
  AcDbBlockTableRecordFlag
} from '../database/AcDbBlockTableRecord'
import type { AcDbClass } from '../database/AcDbClass'
import type { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbDimStyleTableRecord } from '../database/AcDbDimStyleTableRecord'
import { AcDbLayerTableRecord } from '../database/AcDbLayerTableRecord'
import { AcDbLinetypeTableRecord } from '../database/AcDbLinetypeTableRecord'
import { AcDbRegAppTableRecord } from '../database/AcDbRegAppTableRecord'
import { AcDbTextStyleTableRecord } from '../database/AcDbTextStyleTableRecord'
import { AcDbUcsTableRecord } from '../database/AcDbUcsTableRecord'
import { AcDbViewportTableRecord } from '../database/AcDbViewportTableRecord'
import { AcDbViewTableRecord } from '../database/AcDbViewTableRecord'
import { AcDb3dSolid } from '../entity/AcDb3dSolid'
import { AcDbAttribute } from '../entity/AcDbAttribute'
import { AcDbBlockReference } from '../entity/AcDbBlockReference'
import type { AcDbEntity } from '../entity/AcDbEntity'
import { acdbCombineDxfBinaryChunks } from '../misc/proxyGraphic'
import {
  acdbDxfInAcdsData,
  acdbNormalizeDxfHandle
} from './AcDbDxfAcdsDataReader'
import { acdbDxfInEntity } from './AcDbDxfEntityFactory'
import { acdbDxfInHeader } from './AcDbDxfHeaderReader'
import { AcDbDxfObjectsReader } from './AcDbDxfObjectsReader'

export interface AcDbDxfDocumentReaderOptions {
  /**
   * How often to check parse progress / UI yield while streaming entities
   * (entity count). Actual yields are time-budgeted via {@link yieldBudgetMs}.
   */
  entityBatchSize?: number
  /**
   * Minimum wall time between cooperative UI yields during parse.
   * Defaults to {@link ACCM_DEFAULT_UI_YIELD_BUDGET_MS}.
   */
  yieldBudgetMs?: number
  /**
   * Called with approximate parse completion in `[0, 1]` based on byte
   * offset. Used by the native converter to emit mid-PARSE progress.
   */
  onProgress?: (ratio: number) => void | Promise<void>
  /** Total DXF byte length for {@link onProgress}. */
  totalBytes?: number
}

export interface AcDbDxfDocumentReaderResult {
  unknownEntityCount: number
  /** OBJECTS-section types that were skipped (no native reader yet). */
  unknownObjectCount: number
}

/**
 * Single-pass streaming DXF document reader.
 *
 * Walks HEADER → CLASSES → TABLES → BLOCKS → ENTITIES → OBJECTS in file
 * order and writes directly into {@link AcDbDatabase}. Does not buffer the
 * whole file as tag groups.
 */
export class AcDbDxfDocumentReader {
  private _unknownEntityCount = 0
  private _unknownObjectCount = 0
  /** ATTRIB entities waiting for their owning INSERT (keyed by INSERT objectId). */
  private readonly _attributeMap = new Map<AcDbObjectId, AcDbAttribute[]>()
  private readonly _yieldGate: AcCmUiYieldGate

  constructor(
    private readonly _db: AcDbDatabase,
    private readonly _options: AcDbDxfDocumentReaderOptions = {}
  ) {
    this._yieldGate = new AcCmUiYieldGate(
      this._options.yieldBudgetMs ?? ACCM_DEFAULT_UI_YIELD_BUDGET_MS
    )
  }

  get unknownEntityCount() {
    return this._unknownEntityCount
  }

  get unknownObjectCount() {
    return this._unknownObjectCount
  }

  async read(filer: AcDbDxfFiler): Promise<AcDbDxfDocumentReaderResult> {
    this._unknownEntityCount = 0
    this._unknownObjectCount = 0
    this._attributeMap.clear()
    filer.database = this._db

    while (!filer.atEof) {
      const item = filer.readItem()
      if (!item) break
      if (Number(item.code) !== 0) continue

      const name = String(item.value).toUpperCase()
      if (name === 'EOF') break
      if (name === 'SECTION') {
        const sectionName = this.readSectionName(filer)
        await this.readSection(filer, sectionName)
        continue
      }
    }

    this.flushRemainingAttributes()

    return {
      unknownEntityCount: this._unknownEntityCount,
      unknownObjectCount: this._unknownObjectCount
    }
  }

  private readSectionName(filer: AcDbDxfFiler): string {
    const item = filer.readItem()
    if (item && Number(item.code) === 2) {
      return String(item.value).toUpperCase()
    }
    if (item) filer.pushBackItem(item)
    return ''
  }

  private async readSection(filer: AcDbDxfFiler, section: string) {
    switch (section) {
      case 'HEADER':
        acdbDxfInHeader(filer, this._db)
        await this.reportParseProgress(filer)
        break
      case 'CLASSES':
        this.readClassesSection(filer)
        await this.reportParseProgress(filer)
        break
      case 'TABLES':
        this.readTablesSection(filer)
        await this.reportParseProgress(filer)
        break
      case 'BLOCKS':
        await this.readBlocksSection(filer)
        await this.reportParseProgress(filer)
        break
      case 'ENTITIES':
        await this.readEntitiesSection(filer)
        await this.reportParseProgress(filer)
        break
      case 'OBJECTS':
        {
          const objectsReader = new AcDbDxfObjectsReader(this._db)
          objectsReader.read(filer)
          this._unknownObjectCount += objectsReader.unknownObjectCount
        }
        await this.reportParseProgress(filer)
        break
      case 'ACDSDATA':
        this.applyAcdsDataToSolids(acdbDxfInAcdsData(filer))
        await this.reportParseProgress(filer)
        break
      case 'THUMBNAILIMAGE':
        this.readThumbnailImageSection(filer)
        await this.reportParseProgress(filer)
        break
      default:
        this.skipUntilEndSec(filer)
        await this.reportParseProgress(filer)
        break
    }
  }

  /**
   * Attaches ACDSDATA `ASM_Data` SAB payloads to matching {@link AcDb3dSolid}
   * entities (keyed by entity handle / group 5).
   *
   * Modern DXF files often store 3DSOLID geometry only in ACDSDATA rather than
   * inline encrypted SAT groups 1/3 — without this step solids render empty.
   */
  private applyAcdsDataToSolids(section: {
    byOwnerHandle: Record<string, Uint8Array>
  }): void {
    const ownerHandles = Object.keys(section.byOwnerHandle)
    if (ownerHandles.length === 0) return

    // Build a handle → solid map once (handles may differ in case from DXF).
    const solidsByHandle = new Map<string, AcDb3dSolid>()
    for (const btr of this._db.tables.blockTable.newIterator()) {
      for (const entity of btr.newIterator()) {
        if (entity instanceof AcDb3dSolid) {
          solidsByHandle.set(acdbNormalizeDxfHandle(entity.objectId), entity)
        }
      }
    }

    for (const ownerHandle of ownerHandles) {
      const sabBytes = section.byOwnerHandle[ownerHandle]
      if (!sabBytes) continue
      const solid = solidsByHandle.get(acdbNormalizeDxfHandle(ownerHandle))
      if (solid) {
        solid.setSabBytes(sabBytes)
      }
    }
  }

  private readThumbnailImageSection(filer: AcDbDxfFiler) {
    let expectedLength = 0
    const dataChunks: Array<string | Uint8Array> = []
    while (!filer.atEof) {
      const item = filer.readItem()
      if (!item) break
      if (Number(item.code) === 0) {
        const name = String(item.value).toUpperCase()
        if (name === 'ENDSEC') break
        // Unexpected — push back and stop
        filer.pushBackItem(item)
        break
      }
      if (Number(item.code) === 90) {
        expectedLength = Number(item.value) || 0
      } else if (Number(item.code) === 310) {
        // ASCII readers may leave hex as string; typed binary pairs yield Uint8Array.
        if (item.value instanceof Uint8Array) {
          dataChunks.push(item.value)
        } else {
          dataChunks.push(String(item.value))
        }
      }
    }
    if (dataChunks.length === 0) return
    const bytes = acdbCombineDxfBinaryChunks(dataChunks)
    if (!bytes || bytes.length === 0) return
    this._db.thumbnailImage =
      expectedLength > 0 && bytes.length > expectedLength
        ? bytes.subarray(0, expectedLength)
        : bytes
  }

  private readClassesSection(filer: AcDbDxfFiler) {
    const classes: AcDbClass[] = []

    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) break
      if (Number(item.code) !== 0) {
        filer.readItem()
        continue
      }

      const name = String(item.value).toUpperCase()
      if (name === 'ENDSEC') {
        filer.readItem()
        break
      }
      if (name === 'CLASS') {
        filer.readItem()
        const dxfClass = this.readClassRecord(filer)
        if (dxfClass.name || dxfClass.cppClassName) {
          classes.push(dxfClass)
        }
        continue
      }

      filer.readItem()
      filer.skipToEndOfObject()
    }

    if (classes.length > 0) {
      this._db.classes = classes
    }
  }

  private readClassRecord(filer: AcDbDxfFiler): AcDbClass {
    const result: AcDbClass = {
      name: '',
      cppClassName: '',
      appName: '',
      proxyFlag: 0,
      instanceCount: 0,
      wasProxy: false,
      isEntity: false
    }

    while (!filer.atEndOfObject && !filer.atEof) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      switch (code) {
        case 1:
          result.name = String(item.value)
          break
        case 2:
          result.cppClassName = String(item.value)
          break
        case 3:
          result.appName = String(item.value)
          break
        case 90:
          result.proxyFlag = Number(item.value)
          break
        case 91:
          result.instanceCount = Number(item.value)
          break
        case 280:
          result.wasProxy = Number(item.value) !== 0
          break
        case 281:
          result.isEntity = Number(item.value) !== 0
          break
        default:
          // Tolerate unknown CLASS fields without ending early on soft codes.
          break
      }
    }

    return result
  }

  private readTablesSection(filer: AcDbDxfFiler) {
    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) break
      if (Number(item.code) !== 0) {
        filer.readItem()
        continue
      }

      const name = String(item.value).toUpperCase()
      if (name === 'ENDSEC') {
        filer.readItem()
        break
      }
      if (name === 'TABLE') {
        filer.readItem()
        const tableName = this.readTableName(filer)
        this.readTable(filer, tableName)
        continue
      }

      // Unexpected — skip object
      filer.readItem()
      filer.skipToEndOfObject()
    }

    this._db.ensureTextStyleDefaults()
  }

  private readTableName(filer: AcDbDxfFiler): string {
    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) return ''
      const code = Number(item.code)
      if (code === 0) return ''
      filer.readItem()
      if (code === 2) return String(item.value).toUpperCase()
    }
    return ''
  }

  private readTable(filer: AcDbDxfFiler, tableName: string) {
    switch (tableName) {
      case 'LAYER':
        this.readNamedTable(filer, 'LAYER', () => new AcDbLayerTableRecord(), r => {
          if (r.name) this._db.tables.layerTable.add(r)
        })
        break
      case 'LTYPE':
        this.readNamedTable(
          filer,
          'LTYPE',
          () => new AcDbLinetypeTableRecord(),
          r => {
            if (r.name) this._db.tables.linetypeTable.add(r)
          }
        )
        break
      case 'STYLE':
        this.readNamedTable(
          filer,
          'STYLE',
          () => new AcDbTextStyleTableRecord(),
          r => {
            // Shape-file STYLE entries often have an empty name.
            this._db.tables.textStyleTable.add(r)
          }
        )
        break
      case 'DIMSTYLE':
        this.readNamedTable(
          filer,
          'DIMSTYLE',
          () => new AcDbDimStyleTableRecord(),
          r => {
            if (r.name) this._db.tables.dimStyleTable.add(r)
          }
        )
        break
      case 'VPORT':
        this.readNamedTable(
          filer,
          'VPORT',
          () => new AcDbViewportTableRecord(),
          r => {
            if (r.name) this._db.tables.viewportTable.add(r)
          }
        )
        break
      case 'APPID':
        this.readNamedTable(
          filer,
          'APPID',
          () => new AcDbRegAppTableRecord(),
          r => {
            if (r.name) this._db.tables.appIdTable.add(r)
          }
        )
        break
      case 'VIEW':
        this.readNamedTable(
          filer,
          'VIEW',
          () => new AcDbViewTableRecord(),
          r => {
            if (r.name) this._db.tables.viewTable.add(r)
          }
        )
        break
      case 'UCS':
        this.readNamedTable(
          filer,
          'UCS',
          () => new AcDbUcsTableRecord(),
          r => {
            if (r.name) this._db.tables.ucsTable.add(r)
          }
        )
        break
      case 'BLOCK_RECORD':
        this.readBlockRecordTable(filer)
        break
      default:
        this.skipUntilEndTab(filer)
        break
    }
  }

  private readNamedTable<T extends { dxfIn(filer: AcDbDxfFiler): unknown }>(
    filer: AcDbDxfFiler,
    recordType: string,
    create: () => T,
    add: (record: T) => void
  ) {
    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) break
      if (Number(item.code) !== 0) {
        filer.readItem()
        continue
      }

      const name = String(item.value).toUpperCase()
      if (name === 'ENDTAB') {
        filer.readItem()
        break
      }
      if (name === 'ENDSEC') {
        break
      }
      if (name === recordType) {
        filer.readItem()
        const record = create()
        record.dxfIn(filer)
        add(record)
        continue
      }

      filer.readItem()
      filer.skipToEndOfObject()
    }
  }

  private readBlockRecordTable(filer: AcDbDxfFiler) {
    let cleared = false

    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) break
      if (Number(item.code) !== 0) {
        filer.readItem()
        continue
      }

      const name = String(item.value).toUpperCase()
      if (name === 'ENDTAB') {
        filer.readItem()
        break
      }
      if (name === 'ENDSEC') {
        break
      }
      if (name === 'BLOCK_RECORD') {
        filer.readItem()
        if (!cleared) {
          this._db.tables.blockTable.removeAll()
          cleared = true
        }
        const record = new AcDbBlockTableRecord()
        record.dxfIn(filer)
        if (record.name) {
          this._db.tables.blockTable.add(record)
        }
        continue
      }

      filer.readItem()
      filer.skipToEndOfObject()
    }
  }

  private skipUntilEndTab(filer: AcDbDxfFiler) {
    while (!filer.atEof) {
      const item = filer.readItem()
      if (!item) break
      if (
        Number(item.code) === 0 &&
        String(item.value).toUpperCase() === 'ENDTAB'
      ) {
        break
      }
    }
  }

  private async readBlocksSection(filer: AcDbDxfFiler) {
    const batchSize = Math.max(1, this._options.entityBatchSize ?? 200)
    let sinceYield = 0

    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) break
      if (Number(item.code) !== 0) {
        filer.readItem()
        continue
      }

      const name = String(item.value).toUpperCase()
      if (name === 'ENDSEC') {
        filer.readItem()
        break
      }
      if (name === 'BLOCK') {
        filer.readItem()
        const yielded = await this.readBlockDefinition(
          filer,
          batchSize,
          sinceYield
        )
        sinceYield = yielded
        continue
      }

      filer.readItem()
      filer.skipToEndOfObject()
    }
  }

  /**
   * Reads one BLOCK … ENDBLK definition: sync BTR metadata, then stream entities.
   * @returns Updated sinceYield counter for batching.
   */
  private async readBlockDefinition(
    filer: AcDbDxfFiler,
    batchSize: number,
    sinceYield: number
  ): Promise<number> {
    const header = this.readBlockBeginFields(filer)
    const btr = this.ensureBlockTableRecord(header)

    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) break
      if (Number(item.code) !== 0) {
        filer.readItem()
        continue
      }

      const typeName = String(item.value).toUpperCase()
      if (typeName === 'ENDBLK') {
        filer.readItem()
        filer.skipToEndOfObject()
        break
      }
      if (typeName === 'ENDSEC') {
        break
      }

      filer.readItem()
      // SEQEND closes INSERT+ATTRIB / POLYLINE vertex streams — not an entity.
      if (this.consumeSeqend(filer, typeName)) {
        sinceYield += 1
        if (sinceYield >= batchSize) {
          sinceYield = 0
          await this.yieldAndReportProgress(filer)
        }
        continue
      }
      // POLYLINE/DIMENSION composites are handled inside acdbDxfInEntity.
      const entity = acdbDxfInEntity(filer, typeName)
      if (entity) {
        // Model/paper geometry lives in ENTITIES; skip space BTRs here to
        // avoid duplicating entities that also appear with group 67 / owner.
        if (this.shouldAcceptBlockEntity(btr)) {
          this.acceptEntity(entity, btr)
        }
      } else {
        this._unknownEntityCount += 1
        filer.skipToEndOfObject()
      }

      sinceYield += 1
      if (sinceYield >= batchSize) {
        sinceYield = 0
        await this.yieldAndReportProgress(filer)
      }
    }

    return sinceYield
  }

  /**
   * Block definitions may own entities; *Model_Space / *Paper_Space contents
   * are streamed from the ENTITIES section in modern DXF.
   */
  private shouldAcceptBlockEntity(btr: AcDbBlockTableRecord): boolean {
    return !btr.isModelSapce && !btr.isPaperSapce
  }

  /** Consume a SEQEND object after its `(0, SEQEND)` pair was already read. */
  private consumeSeqend(filer: AcDbDxfFiler, typeName: string): boolean {
    if (typeName !== 'SEQEND') return false
    filer.skipToEndOfObject()
    return true
  }

  private readBlockBeginFields(filer: AcDbDxfFiler): {
    name: string
    flags: number
    origin: AcGePoint3d
    pathName: string
    objectId?: string
    ownerId?: string
  } {
    const origin = new AcGePoint3d()
    let name = ''
    let flags = 0
    let pathName = ''
    let objectId: string | undefined
    let ownerId: string | undefined

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      if (code === 100) {
        // Consume AcDbEntity / AcDbBlockBegin markers; continue fields after.
        continue
      }
      const n = Number(item.value)
      switch (code) {
        case 5:
          objectId = String(item.value)
          break
        case 330:
          ownerId = String(item.value)
          break
        case 2:
        case 3:
          if (!name) name = String(item.value)
          break
        case 70:
          flags = n
          break
        case 10:
          origin.x = n
          break
        case 20:
          origin.y = n
          break
        case 30:
          origin.z = n
          break
        case 1:
          pathName = String(item.value)
          break
        case 8:
        case 67:
        case 410:
          // Entity common fields on BLOCK — ignore for BTR metadata.
          break
        default:
          // Unknown BLOCK begin field — keep scanning until end of object.
          break
      }
    }

    return { name, flags, origin, pathName, objectId, ownerId }
  }

  private ensureBlockTableRecord(header: {
    name: string
    flags: number
    origin: AcGePoint3d
    pathName: string
    objectId?: string
    ownerId?: string
  }): AcDbBlockTableRecord {
    let btr = header.name
      ? this._db.tables.blockTable.getAt(header.name)
      : undefined

    if (!btr) {
      btr = new AcDbBlockTableRecord()
      btr.name = header.name || '*UNKNOWN'
      if (header.objectId) {
        btr.objectId = header.objectId
      }
      this._db.tables.blockTable.add(btr)
    }

    btr.origin.copy(header.origin)
    let flags = AcDbBlockTableRecord.sanitizeImportedFlags(header.flags)
    if (header.pathName) {
      btr.pathName = header.pathName
      if (
        (flags &
          (AcDbBlockTableRecordFlag.Xref |
            AcDbBlockTableRecordFlag.XrefOverlay)) ===
        0
      ) {
        flags = flags | AcDbBlockTableRecordFlag.Xref
      }
    }
    btr.flags = flags
    return btr
  }

  private async readEntitiesSection(filer: AcDbDxfFiler) {
    const batchSize = Math.max(1, this._options.entityBatchSize ?? 200)
    let sinceYield = 0
    const modelSpace = this._db.tables.blockTable.modelSpace

    while (!filer.atEof) {
      const item = filer.peekItem()
      if (!item) break
      if (Number(item.code) !== 0) {
        filer.readItem()
        continue
      }

      const name = String(item.value).toUpperCase()
      if (name === 'ENDSEC') {
        filer.readItem()
        break
      }

      filer.readItem()
      // SEQEND closes INSERT+ATTRIB / POLYLINE vertex streams — not an entity.
      if (this.consumeSeqend(filer, name)) {
        sinceYield += 1
        if (sinceYield >= batchSize) {
          sinceYield = 0
          await this.yieldAndReportProgress(filer)
        }
        continue
      }
      // POLYLINE/DIMENSION composites are handled inside acdbDxfInEntity.
      const entity = acdbDxfInEntity(filer, name)
      if (entity) {
        this.acceptEntity(entity, this.resolveEntityOwner(entity, modelSpace))
      } else {
        this._unknownEntityCount += 1
        filer.skipToEndOfObject()
      }

      sinceYield += 1
      if (sinceYield >= batchSize) {
        sinceYield = 0
        await this.yieldAndReportProgress(filer)
      }
    }
  }

  /**
   * Chooses model vs paper space BTR for an ENTITIES-section entity.
   * Prefers ownerId (330) when it names a space BTR; falls back to DXF group 67.
   */
  private resolveEntityOwner(
    entity: AcDbEntity,
    modelSpace: AcDbBlockTableRecord
  ): AcDbBlockTableRecord {
    const ownerId = entity.getAttrWithoutException('ownerId')
    if (ownerId) {
      const owner = this._db.tables.blockTable.getIdAt(ownerId)
      if (owner && (owner.isModelSapce || owner.isPaperSapce)) {
        return owner
      }
    }
    if (entity.dxfPaperSpace) {
      const paper = this._db.tables.blockTable.getAt(
        AcDbBlockTableRecord.PAPER_SPACE_NAME_PREFIX
      )
      if (paper) return paper
    }
    return modelSpace
  }

  /**
   * Appends an entity (or links ATTRIB → INSERT).
   */
  private acceptEntity(
    entity: AcDbEntity,
    owner: AcDbBlockTableRecord
  ): void {
    if (entity instanceof AcDbAttribute) {
      this.linkOrDeferAttribute(entity, owner)
      return
    }

    owner.appendEntity(entity)

    if (entity instanceof AcDbBlockReference) {
      const pending = this._attributeMap.get(entity.objectId)
      if (pending && pending.length > 0) {
        for (const attrib of pending) {
          entity.appendAttributes(attrib)
        }
        this._attributeMap.delete(entity.objectId)
      }
    }
  }

  private linkOrDeferAttribute(
    attrib: AcDbAttribute,
    ownerBtr: AcDbBlockTableRecord
  ): void {
    const insertId = attrib.getAttrWithoutException('ownerId')
    if (!insertId || insertId === '0') return

    const insert =
      (ownerBtr.getIdAt(insertId) as AcDbBlockReference | undefined) ??
      (this._db.tables.blockTable.getEntityById(insertId) as
        | AcDbBlockReference
        | undefined)

    if (insert instanceof AcDbBlockReference) {
      insert.appendAttributes(attrib)
      return
    }

    let list = this._attributeMap.get(insertId)
    if (!list) {
      list = []
      this._attributeMap.set(insertId, list)
    }
    list.push(attrib)
  }

  private flushRemainingAttributes(): void {
    for (const [insertId, attribs] of this._attributeMap) {
      const insert = this._db.tables.blockTable.getEntityById(insertId)
      if (insert instanceof AcDbBlockReference) {
        for (const attrib of attribs) {
          insert.appendAttributes(attrib)
        }
      }
    }
    this._attributeMap.clear()
  }

  private skipUntilEndSec(filer: AcDbDxfFiler) {
    while (!filer.atEof) {
      const item = filer.readItem()
      if (!item) break
      if (
        Number(item.code) === 0 &&
        String(item.value).toUpperCase() === 'ENDSEC'
      ) {
        break
      }
    }
  }

  private async reportParseProgress(filer: AcDbDxfFiler) {
    const { onProgress, totalBytes } = this._options
    if (!onProgress || !totalBytes || totalBytes <= 0) return
    const ratio = Math.min(1, Math.max(0, filer.position().byteOffset / totalBytes))
    await onProgress(ratio)
  }

  private async yieldAndReportProgress(filer: AcDbDxfFiler) {
    await this.reportParseProgress(filer)
    // Progress may fire every batch; UI yield is time-budgeted so large DXFs
    // are not dominated by per-batch requestAnimationFrame waits.
    await this._yieldGate.maybeYield(accmYieldToUi)
  }
}

import type { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbObject } from '../base/AcDbObject'
import { AcDbBlockTableRecord } from '../database/AcDbBlockTableRecord'
import type { AcDbDatabase } from '../database/AcDbDatabase'
import {
  type AcDbLayerFilterPersistSource,
  type AcDbPersistDictionary,
  type AcDbPersistXRecord,
  acdbReadLayerFilterTree} from '../ly/AcLyLayerFilterIO'
import { AcDbDictionary } from '../object/AcDbDictionary'
import { AcDbGroup } from '../object/AcDbGroup'
import { AcDbLayerFilter } from '../object/AcDbLayerFilter'
import { AcDbLayerIndex } from '../object/AcDbLayerIndex'
import { AcDbMLeaderStyle } from '../object/AcDbMLeaderStyle'
import { AcDbMlineStyle } from '../object/AcDbMlineStyle'
import { AcDbRasterImageDef } from '../object/AcDbRasterImageDef'
import { AcDbSortentsTable } from '../object/AcDbSortentsTable'
import { AcDbXrecord } from '../object/AcDbXrecord'
import { AcDbLayout } from '../object/layout/AcDbLayout'

const normalizeHandle = (handle?: string) =>
  handle ? handle.trim().toUpperCase() : ''

/**
 * Streams the DXF OBJECTS section into {@link AcDbDatabase} dictionaries.
 *
 * Known object types are written immediately. DICTIONARY / XRECORD payloads
 * are also buffered as lightweight persist maps for the Layer Manager filter
 * tree, then discarded after {@link acdbReadLayerFilterTree}.
 */
export class AcDbDxfObjectsReader {
  private readonly _dictionaries: AcDbLayerFilterPersistSource['dictionaries'] =
    new Map()
  private readonly _xrecords: AcDbLayerFilterPersistSource['xrecords'] =
    new Map()
  private _unknownObjectCount = 0

  constructor(private readonly _db: AcDbDatabase) {}

  /** Count of OBJECTS types skipped because no native reader exists yet. */
  get unknownObjectCount() {
    return this._unknownObjectCount
  }

  /**
   * Reads OBJECTS until ENDSEC. Caller must have already consumed the
   * `(0, SECTION)` / `(2, OBJECTS)` header pairs.
   */
  read(filer: AcDbDxfFiler): void {
    this._unknownObjectCount = 0
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
      this.readObject(filer, name)
    }

    this.finishNamedObjectDictionaries()
    this.finishLayerFilterTree()
    this.linkLayoutsToBlockTableRecords()
    if (this._db.objects.layout.numEntries === 0) {
      this._db.createDefaultData({ layout: true })
    }
  }

  private readObject(filer: AcDbDxfFiler, typeName: string): void {
    switch (typeName) {
      case 'LAYOUT': {
        const layout = new AcDbLayout()
        layout.dxfIn(filer)
        if (layout.layoutName) {
          this._db.objects.layout.setAt(layout.layoutName, layout)
        }
        break
      }
      case 'IMAGEDEF': {
        const imageDef = new AcDbRasterImageDef()
        imageDef.dxfIn(filer)
        this._db.objects.imageDefinition.setAt(imageDef.objectId, imageDef)
        break
      }
      case 'LAYER_FILTER': {
        const filter = new AcDbLayerFilter()
        filter.dxfIn(filer)
        this._db.objects.layerFilter.setAt(filter.objectId, filter)
        break
      }
      case 'LAYER_INDEX': {
        const index = new AcDbLayerIndex()
        index.dxfIn(filer)
        this._db.objects.layerIndex.setAt(index.objectId, index)
        break
      }
      case 'MLEADERSTYLE': {
        const style = new AcDbMLeaderStyle()
        style.dxfIn(filer)
        this._db.objects.mleaderStyle.setAt(style.objectId, style)
        break
      }
      case 'MLINESTYLE': {
        const style = new AcDbMlineStyle()
        style.dxfIn(filer)
        this._db.objects.mlineStyle.setAt(
          style.styleName || style.objectId,
          style
        )
        break
      }
      case 'GROUP': {
        const group = new AcDbGroup()
        group.dxfIn(filer)
        const key = group.name || group.objectId
        this._db.objects.group.setAt(key, group)
        break
      }
      case 'SORTENTSTABLE': {
        const sortents = new AcDbSortentsTable()
        sortents.dxfIn(filer)
        this._db.objects.sortentsTable.setAt(sortents.objectId, sortents)
        break
      }
      case 'DICTIONARY': {
        const dict = this.readPersistDictionary(filer)
        if (dict.handle) {
          this._dictionaries.set(normalizeHandle(dict.handle), dict)
        }
        break
      }
      case 'XRECORD': {
        const xrecord = new AcDbXrecord()
        xrecord.dxfIn(filer)
        const handle = normalizeHandle(xrecord.objectId)
        if (handle) {
          this._db.objects.xrecord.setAt(handle, xrecord)
          const persist: AcDbPersistXRecord = {
            handle,
            ownerObjectId: normalizeHandle(xrecord.ownerId),
            data: xrecord.data
              ? xrecord.data.toArray().map(item => ({
                  code: Number(item.code),
                  value: item.value
                }))
              : []
          }
          if (xrecord.extensionDictionary) {
            persist.extensionDictionaryId = normalizeHandle(
              xrecord.extensionDictionary
            )
          }
          this._xrecords.set(handle, persist)
        }
        break
      }
      default:
        // Unsupported object type — skip its pairs and record for diagnostics.
        this._unknownObjectCount += 1
        filer.skipToEndOfObject()
        break
    }
  }

  /**
   * Wire the root named-object dictionary and known child dictionaries
   * (ACAD_LAYOUT / ACAD_GROUP / …) from buffered DICTIONARY persist maps.
   */
  private finishNamedObjectDictionaries(): void {
    if (this._dictionaries.size === 0) return

    let root: AcDbPersistDictionary | undefined
    for (const dict of this._dictionaries.values()) {
      if (!dict.ownerObjectId || dict.ownerObjectId === '0') {
        root = dict
        break
      }
    }
    if (!root?.handle) return

    const rootDict = this._db.objects.dictionary
    rootDict.objectId = root.handle
    rootDict.ownerId = '0'

    const typedByKey: Record<string, AcDbDictionary> = {
      ACAD_LAYOUT: this._db.objects.layout,
      ACAD_GROUP: this._db.objects.group,
      ACAD_SORTENTS: this._db.objects.sortentsTable,
      ACAD_MLEADERSTYLE: this._db.objects.mleaderStyle,
      ACAD_MLINESTYLE: this._db.objects.mlineStyle,
      ISM_RASTER_IMAGE_DICT: this._db.objects.imageDefinition,
      MLIGHT_XRECORD: this._db.objects.xrecord
    }

    const objectsByHandle = this.collectLoadedObjectsByHandle()

    for (const [key, childHandle] of Object.entries(root.entries)) {
      const typed = typedByKey[key.toUpperCase()]
      if (!typed) continue

      typed.objectId = childHandle
      typed.ownerId = root.handle
      rootDict.setAt(key, typed)

      const child = this._dictionaries.get(normalizeHandle(childHandle))
      if (!child) continue

      for (const [entryName, entryHandle] of Object.entries(child.entries)) {
        const obj = objectsByHandle.get(normalizeHandle(entryHandle))
        if (!obj) continue
        if (!typed.getAt(entryName)) {
          typed.setAt(entryName, obj)
        }
      }
    }
  }

  private collectLoadedObjectsByHandle(): Map<string, AcDbObject> {
    const map = new Map<string, AcDbObject>()
    const add = (obj: AcDbObject) => {
      const id = normalizeHandle(obj.objectId)
      if (id) map.set(id, obj)
    }
    for (const [, o] of this._db.objects.layout.entries()) add(o)
    for (const [, o] of this._db.objects.group.entries()) add(o)
    for (const [, o] of this._db.objects.sortentsTable.entries()) add(o)
    for (const [, o] of this._db.objects.imageDefinition.entries()) add(o)
    for (const [, o] of this._db.objects.mleaderStyle.entries()) add(o)
    for (const [, o] of this._db.objects.mlineStyle.entries()) add(o)
    for (const [, o] of this._db.objects.layerFilter.entries()) add(o)
    for (const [, o] of this._db.objects.layerIndex.entries()) add(o)
    for (const [, o] of this._db.objects.xrecord.entries()) add(o)
    return map
  }

  private readPersistDictionary(filer: AcDbDxfFiler): AcDbPersistDictionary {
    const result: AcDbPersistDictionary = {
      handle: '',
      ownerObjectId: '',
      entries: {}
    }
    let pendingName: string | undefined

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      switch (code) {
        case 5:
          result.handle = String(item.value)
          break
        case 330:
          result.ownerObjectId = String(item.value)
          break
        case 100:
        case 280:
        case 281:
          break
        case 3:
          pendingName = String(item.value)
          break
        case 350:
        case 340:
        case 360: {
          const target = normalizeHandle(String(item.value))
          if (pendingName) {
            result.entries[pendingName] = target
            pendingName = undefined
          } else if (code === 360 && !result.extensionDictionaryId) {
            // Extension dictionary hard-pointer before entry list.
            result.extensionDictionaryId = target
          }
          break
        }
        default:
          // Tolerate unknown dictionary fields.
          break
      }
    }

    result.handle = normalizeHandle(result.handle)
    result.ownerObjectId = normalizeHandle(result.ownerObjectId)
    if (result.extensionDictionaryId) {
      result.extensionDictionaryId = normalizeHandle(
        result.extensionDictionaryId
      )
    }
    return result
  }

  private finishLayerFilterTree(): void {
    if (this._dictionaries.size === 0 && this._xrecords.size === 0) {
      return
    }
    const tree = acdbReadLayerFilterTree({
      dictionaries: this._dictionaries,
      xrecords: this._xrecords
    })
    if (tree.root.getNestedFilters().length > 0) {
      this._db.layerFilters = tree
    }
    this._dictionaries.clear()
    this._xrecords.clear()
  }

  /**
   * Cross-links LAYOUT objects with BLOCK_RECORD layoutId / blockTableRecordId,
   * matching {@link AcDbObjectConverter.convertLayout} resolution rules.
   */
  private linkLayoutsToBlockTableRecords(): void {
    const blockTable = this._db.tables.blockTable
    const modelSpaceName = AcDbBlockTableRecord.MODEL_SPACE_NAME.toUpperCase()

    for (const [, layout] of this._db.objects.layout.entries()) {
      if (layout.layoutName === 'Model') {
        const modelSpace = blockTable.modelSpace
        layout.blockTableRecordId = modelSpace.objectId
        modelSpace.layoutId = layout.objectId
        continue
      }

      const layoutHandle = normalizeHandle(layout.objectId)
      let linked = false
      for (const btr of blockTable.newIterator()) {
        if (normalizeHandle(btr.layoutId) === layoutHandle) {
          layout.blockTableRecordId = btr.objectId
          linked = true
          break
        }
      }

      if (!linked && layout.blockTableRecordId) {
        const btr = blockTable.getIdAt(layout.blockTableRecordId)
        if (btr) {
          btr.layoutId = layout.objectId
        }
      } else if (!linked) {
        // Fallback: paper-space BTR whose name is not model space and has no layout yet.
        for (const btr of blockTable.newIterator()) {
          if (
            btr.isPaperSapce &&
            btr.name.toUpperCase() !== modelSpaceName &&
            !btr.layoutId
          ) {
            layout.blockTableRecordId = btr.objectId
            btr.layoutId = layout.objectId
            break
          }
        }
      }
    }
  }
}

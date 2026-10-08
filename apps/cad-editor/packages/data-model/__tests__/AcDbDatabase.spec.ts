import { AcCmColor, AcCmColorMethod } from '@mlightcad/common'
import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'
import { AcDbBlockTableRecord } from '../src/database/AcDbBlockTableRecord'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbDatabaseConverterManager } from '../src/database/AcDbDatabaseConverterManager'
import { AcDbLayerTableRecord } from '../src/database/AcDbLayerTableRecord'
import { AcDbOpenDatabaseError } from '../src/database/AcDbOpenDatabaseError'
import { AcDbSystemVariables } from '../src/database/AcDbSystemVariables'
import { AcDbSysVarManager } from '../src/database/AcDbSysVarManager'
import { AcDbTextStyleTableRecord } from '../src/database/AcDbTextStyleTableRecord'
import { AcDbAttributeDefinition } from '../src/entity/AcDbAttributeDefinition'
import { AcDbLine } from '../src/entity/AcDbLine'
import { DEFAULT_TEXT_STYLE } from '../src/misc/AcDbConstants'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbDatabase', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbDatabase())
  })

  it('assigns sequential default DWGNAME values to new databases', () => {
    const db1 = new AcDbDatabase()
    const db2 = new AcDbDatabase()

    expect(db1.dwgname).toMatch(/^Drawing\d+\.dwg$/)
    expect(db2.dwgname).toMatch(/^Drawing\d+\.dwg$/)
    expect(db1.dwgname).not.toBe(db2.dwgname)
  })

  it('updates DWGNAME when setDwgName is called', () => {
    const db = new AcDbDatabase()
    const manager = AcDbSysVarManager.instance()

    db.setDwgName('Site Plan.dxf')
    expect(db.dwgname).toBe('Site Plan.dxf')
    expect(manager.getVar(AcDbSystemVariables.DWGNAME, db)).toBe(
      'Site Plan.dxf'
    )
  })

  it('stores and clears thumbnailImage bytes', () => {
    const db = new AcDbDatabase()
    expect(db.thumbnailImage).toBeUndefined()

    const bytes = new Uint8Array([0x42, 0x4d, 0x00, 0x01])
    db.thumbnailImage = bytes
    expect(db.thumbnailImage).toBe(bytes)

    db.thumbnailImage = new Uint8Array()
    expect(db.thumbnailImage).toBeUndefined()

    db.thumbnailImage = bytes
    db.thumbnailImage = undefined
    expect(db.thumbnailImage).toBeUndefined()
  })

  it('reassigns symbol-table handles that collide across tables', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    const textStyle = new AcDbTextStyleTableRecord({
      name: DEFAULT_TEXT_STYLE,
      font: 'SimKai'
    })
    db.tables.textStyleTable.add(textStyle)

    const layer = new AcDbLayerTableRecord({
      name: '0',
      isOff: false,
      isPlottable: true,
      color: new AcCmColor(AcCmColorMethod.ByACI, 7),
      linetype: 'Continuous'
    })
    layer.objectId = textStyle.objectId
    const preferredLayerId = layer.objectId
    db.tables.layerTable.add(layer)

    expect(layer.objectId).toBe(preferredLayerId)
    expect(textStyle.objectId).not.toBe(layer.objectId)
    expect(db.tables.layerTable.getIdAt(layer.objectId)).toBe(layer)
    expect(db.tables.textStyleTable.getIdAt(textStyle.objectId)).toBe(textStyle)
  })

  it('rewires block entity ownerIds when a BTR handle is displaced', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db

    const block = new AcDbBlockTableRecord()
    block.name = 'TITLE_BLOCK'
    block.objectId = 'BTR1'
    db.tables.blockTable.add(block)
    expect(block.objectId).toBe('BTR1')

    const line = new AcDbLine(new AcGePoint3d(0, 0, 0), new AcGePoint3d(1, 0, 0))
    const attDef = new AcDbAttributeDefinition()
    attDef.tag = '设计日期'
    attDef.height = 2.5
    block.appendEntity([line, attDef])
    expect(line.ownerId).toBe('BTR1')
    expect(attDef.ownerId).toBe('BTR1')

    // A later non-temp object claims BTR1 → BTR is displaced to a generated id.
    const usurper = new AcDbLayerTableRecord({
      name: 'USURPER',
      isOff: false,
      isPlottable: true,
      color: new AcCmColor(AcCmColorMethod.ByACI, 1),
      linetype: 'Continuous'
    })
    usurper.objectId = 'BTR1'
    db.tables.layerTable.add(usurper)

    expect(usurper.objectId).toBe('BTR1')
    expect(block.objectId).not.toBe('BTR1')
    expect(line.ownerId).toBe(block.objectId)
    expect(attDef.ownerId).toBe(block.objectId)
    expect(db.tables.blockTable.getIdAt(attDef.ownerId)).toBe(block)
  })

  it('initializes handle seed from hexadecimal HANDSEED values', () => {
    const db = new AcDbDatabase()
    db.initializeHandleSeed('FFFF')
    expect(db.generateHandle()).toBe('FFFF')
  })

  it('generates handles beyond Number.MAX_SAFE_INTEGER without hanging', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    // Real drawings emit HANDSEED values past float-safe range; numeric
    // increments stall at that magnitude (x + 1 === x), which used to spin
    // generateUniqueHandle forever.
    db.initializeHandleSeed('FFFFF10000002B')
    expect(db.generateHandle()).toBe('FFFFF10000002B')
    expect(db.generateHandle()).toBe('FFFFF10000002C')

    const textStyle = new AcDbTextStyleTableRecord({
      name: 'Standard',
      font: 'txt'
    })
    textStyle.objectId = '11'
    db.tables.textStyleTable.add(textStyle)

    // Force handle regeneration by claiming the style's id from another table.
    const layer = new AcDbLayerTableRecord({ name: '0' })
    layer.objectId = '11'
    db.tables.layerTable.add(layer)

    expect(layer.objectId).toBe('11')
    expect(textStyle.objectId).not.toBe('11')
    expect(db.tables.textStyleTable.getIdAt(textStyle.objectId)).toBe(textStyle)
  })

  it('exposes worker OOM failures via lastOpenError, openFailed, and openProgress', async () => {
    const db = new AcDbDatabase()
    const fileType = 'test-open-failure'
    const oomError = new AcDbOpenDatabaseError(
      'Failed to parse drawing due to error: \'Data cannot be cloned, out of memory.\'',
      'worker_oom',
      { stage: 'PARSE' }
    )
    const converter = {
      read: jest.fn(
        async (
          _data: ArrayBuffer,
          _db: AcDbDatabase,
          options?: {
            progress?: (
              percentage: number,
              stage: string,
              stageStatus: string,
              data?: unknown,
              taskError?: {
                error: unknown
                task: { name: string }
                taskIndex: number
              }
            ) => Promise<void>
          }
        ) => {
          if (options?.progress) {
            await options.progress(5, 'PARSE', 'ERROR', undefined, {
              error: oomError,
              task: { name: 'PARSE' },
              taskIndex: 1
            })
          }
          throw oomError
        }
      )
    }
    const manager = AcDbDatabaseConverterManager.instance
    manager.register(fileType, converter as never)

    const openFailed = jest.fn()
    const openProgress = jest.fn()
    db.events.openFailed.addEventListener(openFailed)
    db.events.openProgress.addEventListener(openProgress)

    try {
      await expect(
        db.read(new ArrayBuffer(0), { readOnly: true }, fileType)
      ).rejects.toMatchObject({ code: 'worker_oom' })

      expect(db.lastOpenError?.code).toBe('worker_oom')
      expect(openFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          database: db,
          error: expect.objectContaining({ code: 'worker_oom' })
        })
      )
      expect(openProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          subStageStatus: 'ERROR',
          data: expect.objectContaining({ code: 'worker_oom' })
        })
      )
    } finally {
      manager.unregister(fileType)
    }
  })
})

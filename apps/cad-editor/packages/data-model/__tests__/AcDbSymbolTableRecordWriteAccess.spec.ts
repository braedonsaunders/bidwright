import { AcCmColor } from '@mlightcad/common'

import { AcDbOpenMode } from '../src/base'
import {
  AcDbDatabase,
  AcDbLayerModifiedEventArgs
} from '../src/database/AcDbDatabase'
import {
  AcDbLayerTableRecord,
  createLayerTableRecordDefaultAttrs,
  LAYER_TABLE_RECORD_DIFF_ATTR_KEYS
} from '../src/database/AcDbLayerTableRecord'
import { AcDbTextStyleTableRecord } from '../src/database/AcDbTextStyleTableRecord'

describe('AcDbSymbolTableRecord write access', () => {
  it('derives layer diff keys from default attrs plus name', () => {
    const expected = [
      'name',
      ...Object.keys(createLayerTableRecordDefaultAttrs())
    ].sort()

    expect([...LAYER_TABLE_RECORD_DIFF_ATTR_KEYS].sort()).toEqual(expected)
  })

  it('requires openObjectForWrite to modify an existing record in a transaction', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')!

    db.transactionManager.startTransaction()
    expect(() => {
      layer.isOff = true
    }).toThrow('not open for write')

    const opened = db.openObjectForWrite<AcDbLayerTableRecord>(layer.objectId)
    opened!.isOff = true
    db.transactionManager.commitTransaction()

    expect(layer.isOff).toBe(true)
  })

  it('allows modifying temporary records before they are added', () => {
    const db = new AcDbDatabase()
    const layer = new AcDbLayerTableRecord({ name: 'TempLayer' })

    expect(() => {
      layer.isOff = true
    }).not.toThrow()

    db.tables.layerTable.add(layer)
    expect(layer.isOff).toBe(true)
  })

  it('dispatches layerModified on commit, not during editing', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')!
    let modifiedCount = 0

    db.events.layerModified.addEventListener(() => {
      modifiedCount++
    })

    db.transactionManager.runUndoable('Layer Off', () => {
      const opened = db.openObjectForWrite<AcDbLayerTableRecord>(
        layer.objectId
      )
      opened!.isOff = true
      expect(modifiedCount).toBe(0)
    })

    expect(modifiedCount).toBe(1)
    expect(layer.isOff).toBe(true)
  })

  it('dispatches layerModified with changed attributes on commit', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')!
    const nextColor = new AcCmColor()
    nextColor.colorIndex = 1
    let payload: { changes: Partial<{ isOff: boolean; color: AcCmColor }> } | undefined

    db.events.layerModified.addEventListener(args => {
      payload = args
    })

    db.transactionManager.runUndoable('Layer Color', () => {
      const opened = db.openObjectForWrite<AcDbLayerTableRecord>(
        layer.objectId
      )
      opened!.color = nextColor
    })

    expect(payload?.changes.color?.colorIndex).toBe(1)
  })

  it('upgrades read open to write open in the same transaction', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')!

    db.transactionManager.startTransaction()
    const tr = db.transactionManager.currentTransaction()!
    tr.getObject(layer.objectId, AcDbOpenMode.kForRead)
    const opened = tr.getObject<AcDbLayerTableRecord>(
      layer.objectId,
      AcDbOpenMode.kForWrite
    )

    expect(() => {
      opened!.isOff = true
    }).not.toThrow()

    db.transactionManager.commitTransaction()
    expect(layer.isOff).toBe(true)
  })

  it('enforces strictMode for symbol table record mutations outside transactions', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    db.transactionManager.strictMode = true
    const layer = db.tables.layerTable.getAt('0')!

    expect(() => {
      layer.isOff = true
    }).toThrow('outside an active transaction')
  })

  it('requires openObjectForWrite to modify text style table records', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const style = db.tables.textStyleTable.getAt('Standard')!

    db.transactionManager.startTransaction()
    expect(() => {
      style.xScale = 2
    }).toThrow('not open for write')

    const opened = db.openObjectForWrite<AcDbTextStyleTableRecord>(
      style.objectId
    )
    opened!.xScale = 2
    db.transactionManager.commitTransaction()

    expect(style.xScale).toBe(2)
  })

  it('requires openObjectForWrite again after transaction abort', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')!

    db.transactionManager.startTransaction()
    const opened = db.openObjectForWrite<AcDbLayerTableRecord>(layer.objectId)
    opened!.isOff = true
    db.transactionManager.abortTransaction()

    expect(layer.isOff).toBe(false)

    db.transactionManager.startTransaction()
    expect(() => {
      layer.isOff = true
    }).toThrow('not open for write')
    db.transactionManager.abortTransaction()
  })

  it('defers layerModified until event batch ends', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')!
    let modifiedCount = 0

    db.events.layerModified.addEventListener(() => {
      modifiedCount++
    })

    db.beginEventBatch()
    db.transactionManager.startTransaction()
    const opened = db.openObjectForWrite<AcDbLayerTableRecord>(layer.objectId)
    opened!.isOff = true
    db.transactionManager.commitTransaction()
    expect(modifiedCount).toBe(0)

    db.endEventBatch()
    expect(modifiedCount).toBe(1)
    expect(layer.isOff).toBe(true)
  })

  it('dispatches layerModified with inverse changes on undo and redo', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')!
    const wasOff = layer.isOff
    const payloads: AcDbLayerModifiedEventArgs[] = []

    db.events.layerModified.addEventListener(args => {
      payloads.push(args)
    })

    db.transactionManager.runUndoable('Layer Off', () => {
      const opened = db.openObjectForWrite<AcDbLayerTableRecord>(
        layer.objectId
      )
      opened!.isOff = !wasOff
    })

    expect(payloads).toHaveLength(1)
    expect(payloads[0].changes.isOff).toBe(!wasOff)

    payloads.length = 0
    db.transactionManager.undo()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].changes.isOff).toBe(wasOff)

    payloads.length = 0
    db.transactionManager.redo()
    expect(payloads).toHaveLength(1)
    expect(payloads[0].changes.isOff).toBe(!wasOff)
  })
})

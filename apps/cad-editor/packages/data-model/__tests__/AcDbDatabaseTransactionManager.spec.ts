import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { AcDbDxfCode, AcDbOpenMode, AcDbResultBuffer } from '../src/base'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbLayerTableRecord } from '../src/database/AcDbLayerTableRecord'
import { AcDbSysVarManager } from '../src/database/AcDbSysVarManager'
import { AcDbLine } from '../src/entity/AcDbLine'
import { AcDbDictionary } from '../src/object/AcDbDictionary'
import { AcDbLayout } from '../src/object/layout/AcDbLayout'

const createLine = (
  start = new AcGePoint3d(0, 0, 0),
  end = new AcGePoint3d(10, 0, 0)
) => new AcDbLine(start, end)

describe('AcDbDatabaseTransactionManager', () => {
  it('rolls back entity geometry changes on abort', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    const manager = db.transactionManager
    const tr = manager.startTransaction()
    const opened = tr.getObject<AcDbLine>(line.objectId, AcDbOpenMode.kForWrite)
    opened!.endPoint = new AcGePoint3d(20, 0, 0)

    manager.abortTransaction()

    expect(line.endPoint.x).toBe(10)
  })

  it('rolls back entity append on abort', () => {
    const db = new AcDbDatabase()
    const line = createLine()

    const manager = db.transactionManager
    manager.startTransaction()
    db.tables.blockTable.modelSpace.appendEntity(line)
    expect(db.tables.blockTable.getEntityById(line.objectId)).toBe(line)

    manager.abortTransaction()

    expect(db.tables.blockTable.getEntityById(line.objectId)).toBeUndefined()
  })

  it('returns the same object when opened twice in one transaction', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    const tr = db.transactionManager.startTransaction()
    const first = tr.getObject<AcDbLine>(line.objectId, AcDbOpenMode.kForWrite)
    const second = tr.getObject<AcDbLine>(line.objectId, AcDbOpenMode.kForWrite)

    expect(first).toBe(line)
    expect(second).toBe(line)
    db.transactionManager.abortTransaction()
  })

  it('dispatches entity events once on commit and undo', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    let appendCount = 0
    let eraseCount = 0

    db.events.entityAppended.addEventListener(() => {
      appendCount++
    })
    db.events.entityErased.addEventListener(() => {
      eraseCount++
    })

    db.transactionManager.runUndoable('Add Line', () => {
      db.tables.blockTable.modelSpace.appendEntity(line)
    })
    expect(appendCount).toBe(1)

    db.transactionManager.undo()
    expect(eraseCount).toBe(1)
  })

  it('supports undo and redo for entity append and remove', () => {
    const db = new AcDbDatabase()
    const line = createLine(new AcGePoint3d(1, 2, 3), new AcGePoint3d(4, 5, 6))

    db.transactionManager.runUndoable('Add Line', () => {
      db.tables.blockTable.modelSpace.appendEntity(line)
    })

    expect(db.tables.blockTable.getEntityById(line.objectId)).toBe(line)
    expect(db.transactionManager.canUndo()).toBe(true)

    db.transactionManager.undo()
    expect(db.tables.blockTable.getEntityById(line.objectId)).toBeUndefined()
    expect(db.transactionManager.canRedo()).toBe(true)

    db.transactionManager.redo()
    expect(db.tables.blockTable.getEntityById(line.objectId)).toBeDefined()
  })

  it('supports undo and redo for entity modification', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    db.transactionManager.runUndoable('Move', tr => {
      const opened = tr.getObject<AcDbLine>(
        line.objectId,
        AcDbOpenMode.kForWrite
      )
      opened!.endPoint = new AcGePoint3d(30, 0, 0)
    })

    expect(line.endPoint.x).toBe(30)
    db.transactionManager.undo()
    expect(line.endPoint.x).toBe(10)
    db.transactionManager.redo()
    expect(line.endPoint.x).toBe(30)
  })

  it('dispatches entityModified on commit without manual event notification', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    let modifiedCount = 0
    db.events.entityModified.addEventListener(args => {
      modifiedCount++
      expect(args.entity).toBe(line)
    })

    db.transactionManager.runUndoable('Move', tr => {
      const opened = tr.getObject<AcDbLine>(
        line.objectId,
        AcDbOpenMode.kForWrite
      )
      opened!.endPoint = new AcGePoint3d(30, 0, 0)
    })

    expect(modifiedCount).toBe(1)
  })

  it('dispatches entityModified on undo and redo for entity modification', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    let modifiedCount = 0
    db.events.entityModified.addEventListener(args => {
      modifiedCount++
      expect(args.entity).toBe(line)
    })

    db.transactionManager.runUndoable('Move', tr => {
      const opened = tr.getObject<AcDbLine>(
        line.objectId,
        AcDbOpenMode.kForWrite
      )
      opened!.endPoint = new AcGePoint3d(30, 0, 0)
    })
    expect(modifiedCount).toBe(1)

    db.transactionManager.undo()
    expect(modifiedCount).toBe(2)

    db.transactionManager.redo()
    expect(modifiedCount).toBe(3)
  })

  it('does not dispatch entityModified when entity is mutated outside a transaction', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    let modifiedCount = 0
    db.events.entityModified.addEventListener(() => {
      modifiedCount++
    })

    line.endPoint = new AcGePoint3d(25, 0, 0)

    expect(modifiedCount).toBe(0)
  })

  it('merges nested transaction changes into one undo record', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    db.transactionManager.startUndoMark('Nested')
    db.transactionManager.startTransaction()
    const inner = db.transactionManager.startTransaction()
    const opened = inner.getObject<AcDbLine>(
      line.objectId,
      AcDbOpenMode.kForWrite
    )
    opened!.endPoint = new AcGePoint3d(40, 0, 0)
    db.transactionManager.commitTransaction()
    db.transactionManager.commitTransaction()
    db.transactionManager.endUndoMark()

    expect(line.endPoint.x).toBe(40)
    db.transactionManager.undo()
    expect(line.endPoint.x).toBe(10)
  })

  it('rolls back committed nested transaction changes on outer abort', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    db.transactionManager.startTransaction()
    const inner = db.transactionManager.startTransaction()
    const opened = inner.getObject<AcDbLine>(
      line.objectId,
      AcDbOpenMode.kForWrite
    )
    opened!.endPoint = new AcGePoint3d(40, 0, 0)
    db.transactionManager.commitTransaction()
    db.transactionManager.abortTransaction()

    expect(line.endPoint.x).toBe(10)
  })

  it('rolls back system variable changes on abort', () => {
    const db = new AcDbDatabase()
    const original = db.orthomode

    db.transactionManager.startTransaction()
    db.orthomode = 1
    db.transactionManager.abortTransaction()

    expect(db.orthomode).toBe(original)
  })

  it('records symbol table additions and removals', () => {
    const db = new AcDbDatabase()
    const layer = new AcDbLayerTableRecord({ name: 'UndoLayer' })

    db.transactionManager.runUndoable('Add Layer', () => {
      db.tables.layerTable.add(layer)
    })

    expect(db.tables.layerTable.getAt('UndoLayer')).toBe(layer)
    db.transactionManager.undo()
    expect(db.tables.layerTable.getAt('UndoLayer')).toBeUndefined()
    db.transactionManager.redo()
    expect(db.tables.layerTable.has('UndoLayer')).toBe(true)
  })

  it('records system variable changes through updateSysVar', () => {
    const db = new AcDbDatabase()
    const original = db.orthomode

    db.transactionManager.runUndoable('Ortho', () => {
      db.orthomode = 1
    })

    expect(db.orthomode).toBe(1)
    db.transactionManager.undo()
    expect(db.orthomode).toBe(original)
    db.transactionManager.redo()
    expect(db.orthomode).toBe(1)
  })

  it('clears undo stack when clearUndoStack is called', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.transactionManager.runUndoable('Add', () => {
      db.tables.blockTable.modelSpace.appendEntity(line)
    })
    expect(db.transactionManager.canUndo()).toBe(true)

    db.transactionManager.clearUndoStack()
    expect(db.transactionManager.canUndo()).toBe(false)
  })

  it('deduplicates modify records for the same object', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    db.transactionManager.startUndoMark()
    const tr = db.transactionManager.startTransaction()
    const opened = tr.getObject<AcDbLine>(line.objectId, AcDbOpenMode.kForWrite)
    opened!.endPoint = new AcGePoint3d(20, 0, 0)
    opened!.endPoint = new AcGePoint3d(30, 0, 0)
    db.transactionManager.commitTransaction()
    db.transactionManager.endUndoMark()

    db.transactionManager.undo()
    expect(line.endPoint.x).toBe(10)
  })

  it('resolves objects through getObjectById', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const layer = db.tables.layerTable.getAt('0')
    expect(db.getObjectById(db.objectId)).toBe(db)
    expect(db.getObjectById(layer!.objectId)).toBe(layer)
  })

  it('does not create undo records for commit without undo mark', () => {
    const db = new AcDbDatabase()
    const line = createLine()

    db.transactionManager.startTransaction()
    db.tables.blockTable.modelSpace.appendEntity(line)
    db.transactionManager.commitTransaction()

    expect(db.tables.blockTable.getEntityById(line.objectId)).toBe(line)
    expect(db.transactionManager.canUndo()).toBe(false)
  })

  it('cancels append/remove pairs within one undo mark', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const line = createLine()

    db.transactionManager.startUndoMark('Transient')
    db.transactionManager.startTransaction()
    db.tables.blockTable.modelSpace.appendEntity(line)
    db.tables.blockTable.modelSpace.removeEntity(line.objectId)
    db.transactionManager.commitTransaction()
    db.transactionManager.endUndoMark()

    expect(db.transactionManager.canUndo()).toBe(false)
  })

  it('supports undo and redo for dictionary setAt', () => {
    const db = new AcDbDatabase()
    const layout = new AcDbLayout()

    db.transactionManager.runUndoable('Add Layout', () => {
      db.objects.layout.setAt('TestLayout', layout)
    })

    expect(db.objects.layout.getAt('TestLayout')).toBe(layout)
    db.transactionManager.undo()
    expect(db.objects.layout.getAt('TestLayout')).toBeUndefined()
    db.transactionManager.redo()
    expect(db.objects.layout.getAt('TestLayout')).toBeDefined()
  })

  it('dispatches dictionary events once on commit and undo', () => {
    const db = new AcDbDatabase()
    const layout = new AcDbLayout()
    let setCount = 0
    let eraseCount = 0

    db.events.dictObjetSet.addEventListener(() => {
      setCount++
    })
    db.events.dictObjectErased.addEventListener(() => {
      eraseCount++
    })

    db.transactionManager.runUndoable('Add Layout', () => {
      db.objects.layout.setAt('L1', layout)
    })
    expect(setCount).toBe(1)

    db.transactionManager.undo()
    expect(eraseCount).toBe(1)
  })

  it('records system variable changes through setVar', () => {
    const db = new AcDbDatabase()
    const manager = AcDbSysVarManager.instance()
    const original = manager.getVar('dynmode', db) ?? 3
    const next = original === 1 ? 2 : 1

    db.transactionManager.runUndoable('Dynmode', () => {
      manager.setVar('dynmode', next, db)
    })

    expect(manager.getVar('dynmode', db)).toBe(next)
    db.transactionManager.undo()
    expect(manager.getVar('dynmode', db)).toBe(original)
    db.transactionManager.redo()
    expect(manager.getVar('dynmode', db)).toBe(next)
  })

  it('records isDbVar system variable changes through setVar', () => {
    const db = new AcDbDatabase()
    const manager = AcDbSysVarManager.instance()
    const original = manager.getVar('orthomode', db) ?? 0
    const next = original === 1 ? 0 : 1

    db.transactionManager.runUndoable('Ortho', () => {
      manager.setVar('orthomode', next, db)
    })

    expect(manager.getVar('orthomode', db)).toBe(next)
    db.transactionManager.undo()
    expect(manager.getVar('orthomode', db)).toBe(original)
    db.transactionManager.redo()
    expect(manager.getVar('orthomode', db)).toBe(next)
  })

  it('resolves objects in nested dictionaries through getObjectById', () => {
    const db = new AcDbDatabase()
    const nested = new AcDbDictionary(db)
    db.objects.dictionary.setAt('NESTED', nested)
    const inner = new AcDbDictionary(db)
    nested.setAt('INNER', inner)

    expect(db.getObjectById(inner.objectId)).toBe(inner)
    expect(db.getObjectById(nested.objectId)).toBe(nested)
  })

  it('enforces strictMode for mutations outside transactions', () => {
    const db = new AcDbDatabase()
    db.transactionManager.strictMode = true
    const line = createLine()

    expect(() => {
      db.tables.blockTable.modelSpace.appendEntity(line)
    }).toThrow('outside an active transaction')
  })
})

describe('AcDbObject restoreFrom', () => {
  it('restores cloned state while preserving identity fields', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    const snapshot = line.clonePreservingIdentity()
    snapshot.endPoint = new AcGePoint3d(99, 0, 0)

    line.endPoint = new AcGePoint3d(50, 0, 0)
    line.restoreFrom(snapshot)

    expect(line.endPoint.x).toBe(99)
    expect(line.objectId).toBe(snapshot.objectId)
    expect(line.database).toBe(db)
  })

  it('restores xdata through restoreFrom', () => {
    const db = new AcDbDatabase()
    const line = createLine()
    db.tables.blockTable.modelSpace.appendEntity(line)

    const snapshot = line.clonePreservingIdentity()
    snapshot.setXData(
      new AcDbResultBuffer([
        { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'MY_APP' },
        { code: AcDbDxfCode.ExtendedDataAsciiString, value: 'changed' }
      ])
    )

    line.removeXData('MY_APP')
    line.restoreFrom(snapshot)

    expect(line.getXData('MY_APP')?.at(1)?.value).toBe('changed')
  })
})
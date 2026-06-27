import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbBlockTable } from '../src/database/AcDbBlockTable'
import { AcDbBlockTableRecord } from '../src/database/AcDbBlockTableRecord'
import { AcDbLine } from '../src/entity/AcDbLine'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbBlockTable', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbBlockTable(new AcDbDatabase()))
  })

  it('creates model space lazily and reuses the same record', () => {
    const db = new AcDbDatabase()
    const table = db.tables.blockTable

    const modelA = table.modelSpace
    const modelB = table.modelSpace

    expect(modelA).toBe(modelB)
    expect(modelA.name).toBe(AcDbBlockTableRecord.MODEL_SPACE_NAME)
    expect(table.getAt('*MODEL_SPACE')).toBe(modelA)
  })

  it('normalizes model/paper space names consistently', () => {
    const db = new AcDbDatabase()
    const table = db.tables.blockTable
    const paper = new AcDbBlockTableRecord()
    paper.name = '*PAPER_SPACE12'
    table.add(paper)

    expect(table.has('*paper_space12')).toBe(true)
    expect(table.getAt('*Paper_Space12')).toBe(paper)
    expect(table.remove('*PAPER_SPACE12')).toBe(true)
    expect(table.has('*Paper_Space12')).toBe(false)
  })

  it('finds and removes entities across all block table records', () => {
    const db = new AcDbDatabase()
    const table = db.tables.blockTable
    const modelSpace = table.modelSpace
    const block = new AcDbBlockTableRecord()
    block.name = 'MyBlock'
    table.add(block)

    const modelLine = new AcDbLine({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const blockLine = new AcDbLine({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 })
    modelSpace.appendEntity(modelLine)
    block.appendEntity(blockLine)

    expect(table.getEntityById(modelLine.objectId)).toBe(modelLine)
    expect(table.getEntityById(blockLine.objectId)).toBe(blockLine)
    expect(table.getEntityById('NOT_EXISTS')).toBeUndefined()

    expect(table.removeEntity(blockLine.objectId)).toBe(true)
    expect(table.getEntityById(blockLine.objectId)).toBeUndefined()
    expect(table.removeEntity('NOT_EXISTS')).toBe(false)
  })
})

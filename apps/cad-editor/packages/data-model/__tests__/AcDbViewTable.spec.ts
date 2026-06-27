import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbViewTable } from '../src/database/AcDbViewTable'
import { AcDbViewTableRecord } from '../src/database/AcDbViewTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbViewTable', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbViewTable(new AcDbDatabase()))
  })

  it('supports inherited symbol table operations', () => {
    const db = new AcDbDatabase()
    const table = db.tables.viewTable
    const record = new AcDbViewTableRecord()
    record.name = 'Front'
    table.add(record)

    expect(table.getAt('Front')).toBe(record)
    expect(table.removeId(record.objectId)).toBe(true)
    expect(table.getAt('Front')).toBeUndefined()
  })
})

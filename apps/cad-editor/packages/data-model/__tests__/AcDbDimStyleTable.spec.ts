import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbDimStyleTable } from '../src/database/AcDbDimStyleTable'
import { AcDbDimStyleTableRecord } from '../src/database/AcDbDimStyleTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbDimStyleTable', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbDimStyleTable(new AcDbDatabase()))
  })

  it('supports inherited symbol table operations', () => {
    const db = new AcDbDatabase()
    const table = db.tables.dimStyleTable
    const record = new AcDbDimStyleTableRecord({ name: 'D1' })
    table.add(record)

    expect(table.getAt('D1')).toBe(record)
    expect(table.remove('D1')).toBe(true)
    expect(table.getAt('D1')).toBeUndefined()
  })
})

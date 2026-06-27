import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbRegAppTable } from '../src/database/AcDbRegAppTable'
import { AcDbRegAppTableRecord } from '../src/database/AcDbRegAppTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbRegAppTable', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbRegAppTable(new AcDbDatabase()))
  })

  it('supports inherited symbol table operations', () => {
    const db = new AcDbDatabase()
    const table = db.tables.appIdTable
    const record = new AcDbRegAppTableRecord('APP_A')
    table.add(record)

    expect(table.has('APP_A')).toBe(true)
    expect(table.remove('APP_A')).toBe(true)
    expect(table.has('APP_A')).toBe(false)
  })
})

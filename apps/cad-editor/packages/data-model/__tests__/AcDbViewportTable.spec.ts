import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbViewportTable } from '../src/database/AcDbViewportTable'
import { AcDbViewportTableRecord } from '../src/database/AcDbViewportTableRecord'
import { ACTIVE_VPORT_NAME } from '../src/misc/AcDbConstants'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbViewportTable', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbViewportTable(new AcDbDatabase()))
  })

  it('supports inherited symbol table operations', () => {
    const db = new AcDbDatabase()
    const table = db.tables.viewportTable
    const record = new AcDbViewportTableRecord()
    record.name = ACTIVE_VPORT_NAME
    table.add(record)

    expect(table.has(ACTIVE_VPORT_NAME)).toBe(true)
    expect(table.remove(ACTIVE_VPORT_NAME)).toBe(true)
    expect(table.getAt(ACTIVE_VPORT_NAME)).toBeUndefined()
  })

  it('normalizes *Active and other configuration names case-insensitively', () => {
    const db = new AcDbDatabase()
    const table = db.tables.viewportTable
    const active = new AcDbViewportTableRecord()
    active.name = '*ACTIVE'
    table.add(active)

    expect(table.getAt('*Active')).toBe(active)
    expect(table.getAt('*active')).toBe(active)
    expect(table.has('*ACTIVE')).toBe(true)

    const config = new AcDbViewportTableRecord()
    config.name = '4view'
    table.add(config)

    expect(table.getAt('4VIEW')).toBe(config)
    expect(table.remove('4View')).toBe(true)
    expect(table.has('4view')).toBe(false)
  })
})

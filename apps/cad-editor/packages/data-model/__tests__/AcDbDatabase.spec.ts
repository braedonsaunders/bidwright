import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbSystemVariables } from '../src/database/AcDbSystemVariables'
import { AcDbSysVarManager } from '../src/database/AcDbSysVarManager'
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
})
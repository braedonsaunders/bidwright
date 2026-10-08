import { acdbHostApplicationServices } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbOleFrame } from '../src/entity'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbOleFrame', () => {
  it('exposes editable OLE properties', () => {
    createWorkingDb()
    const ole = new AcDbOleFrame()
    ole.oleVersion = 1

    const props = ole.properties
    expect(props.type).toBe('OleFrame')
    const oleGroup = props.groups.find(g => g.groupName === 'ole')
    expect(oleGroup).toBeDefined()

    const byName = Object.fromEntries(
      (oleGroup?.properties ?? []).map(p => [p.name, p])
    )
    expect(byName.oleVersion.accessor.get()).toBe(1)

    byName.oleVersion.accessor.set?.(2)
    expect(ole.oleVersion).toBe(2)
    expect(byName.oleVersion.accessor.get()).toBe(2)
  })
})

import { AcDbObject, TEMP_OBJECT_ID_PREFIX } from '../src/base/AcDbObject'
import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

function getWorkingDatabaseSlot(): {
  get: () => AcDbDatabase | null
  set: (db: AcDbDatabase | null) => void
} {
  const services = acdbHostApplicationServices() as unknown as {
    _workingDatabase: AcDbDatabase | null
  }
  return {
    get: () => services._workingDatabase,
    set: (db) => {
      services._workingDatabase = db
    }
  }
}

describe('AcDbObject', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbObject())
  })

  it('assigns a TEMP_ handle when not yet bound to a database, even if a working database exists', () => {
    const slot = getWorkingDatabaseSlot()
    const previousDb = slot.get()
    const working = new AcDbDatabase()
    slot.set(working)
    try {
      const obj = new AcDbObject()
      expect(obj.objectId.startsWith(TEMP_OBJECT_ID_PREFIX)).toBe(true)
      expect(obj.isTemp).toBe(true)
    } finally {
      slot.set(previousDb)
    }
  })

  it('accepts a real handle on an unbound object without requiring a working database', () => {
    const slot = getWorkingDatabaseSlot()
    const previousDb = slot.get()
    slot.set(null)
    try {
      const obj = new AcDbObject()
      expect(() => {
        obj.objectId = '1A2B'
      }).not.toThrow()
      expect(obj.objectId).toBe('1A2B')
      expect(obj.isTemp).toBe(false)
    } finally {
      slot.set(previousDb)
    }
  })
})

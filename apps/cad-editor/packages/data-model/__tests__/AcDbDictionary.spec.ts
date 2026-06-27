import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbDictionary } from '../src/object/AcDbDictionary'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbDictionary', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbDictionary(new AcDbDatabase()))
  })
})

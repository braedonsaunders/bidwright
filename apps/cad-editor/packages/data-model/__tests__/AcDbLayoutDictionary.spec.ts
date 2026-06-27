import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbLayoutDictionary } from '../src/object/layout/AcDbLayoutDictionary'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbLayoutDictionary', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbLayoutDictionary(new AcDbDatabase()))
  })
})

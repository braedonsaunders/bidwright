import { AcDbObject } from '../src/base/AcDbObject'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbObject', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbObject())
  })
})

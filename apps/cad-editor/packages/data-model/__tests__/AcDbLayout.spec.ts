import { AcDbLayout } from '../src/object/layout/AcDbLayout'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbLayout', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbLayout())
  })
})

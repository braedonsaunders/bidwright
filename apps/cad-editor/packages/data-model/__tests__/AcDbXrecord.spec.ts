import { AcDbXrecord } from '../src/object/AcDbXrecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbXrecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbXrecord())
  })
})

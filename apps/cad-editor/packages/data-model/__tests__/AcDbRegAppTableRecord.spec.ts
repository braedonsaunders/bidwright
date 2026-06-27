import { AcDbRegAppTableRecord } from '../src/database/AcDbRegAppTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbRegAppTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbRegAppTableRecord('TEST_APP'))
  })
})

import { AcDbBlockTableRecord } from '../src/database/AcDbBlockTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbBlockTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbBlockTableRecord())
  })
})

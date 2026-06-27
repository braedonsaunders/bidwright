import { AcDbViewTableRecord } from '../src/database/AcDbViewTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbViewTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbViewTableRecord())
  })
})

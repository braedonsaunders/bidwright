import { AcDbViewportTableRecord } from '../src/database/AcDbViewportTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbViewportTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbViewportTableRecord())
  })
})

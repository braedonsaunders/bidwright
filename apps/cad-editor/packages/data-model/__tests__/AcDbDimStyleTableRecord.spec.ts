import { AcDbDimStyleTableRecord } from '../src/database/AcDbDimStyleTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbDimStyleTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbDimStyleTableRecord())
  })
})

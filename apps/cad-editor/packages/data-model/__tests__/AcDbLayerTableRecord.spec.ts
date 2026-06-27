import { AcDbLayerTableRecord } from '../src/database/AcDbLayerTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbLayerTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbLayerTableRecord())
  })
})

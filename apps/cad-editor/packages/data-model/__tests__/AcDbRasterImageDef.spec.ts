import { AcDbRasterImageDef } from '../src/object/AcDbRasterImageDef'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbRasterImageDef', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbRasterImageDef())
  })
})

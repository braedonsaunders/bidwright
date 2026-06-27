import { AcDbSymbolTableRecord } from '../src/database/AcDbSymbolTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbSymbolTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbSymbolTableRecord())
  })
})

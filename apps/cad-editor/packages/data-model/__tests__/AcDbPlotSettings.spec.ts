import { AcDbPlotSettings } from '../src/object/layout/AcDbPlotSettings'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbPlotSettings', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbPlotSettings())
  })
})

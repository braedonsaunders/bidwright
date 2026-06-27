import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { AcDbOrdinateDimension } from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbOrdinateDimension', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDbOrdinateDimension(new AcGePoint3d(), new AcGePoint3d(1, 0, 0))
    )
  })

  it('returns geometricExtents and recomputes when defining point changes', () => {
    const dim = new AcDbOrdinateDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(5, 0, 0)
    )

    expect(dim.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(dim.geometricExtents.max).toMatchObject({ x: 5, y: 0, z: 0 })

    dim.definingPoint = new AcGePoint3d(10, 20, 0)
    dim.leaderEndPoint = new AcGePoint3d(15, 25, 0)

    expect(dim.geometricExtents.min).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(dim.geometricExtents.max).toMatchObject({ x: 15, y: 25, z: 0 })
  })
})

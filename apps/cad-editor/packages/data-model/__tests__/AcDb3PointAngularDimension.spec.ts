import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { AcDb3PointAngularDimension } from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDb3PointAngularDimension', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDb3PointAngularDimension(
          new AcGePoint3d(),
          new AcGePoint3d(1, 0, 0),
          new AcGePoint3d(0, 1, 0),
          new AcGePoint3d(1, 1, 0)
        )
    )
  })

  it('returns geometricExtents and recomputes when center point changes', () => {
    const dim = new AcDb3PointAngularDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0),
      new AcGePoint3d(0, 1, 0),
      new AcGePoint3d(1, 1, 0)
    )

    expect(dim.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(dim.geometricExtents.max).toMatchObject({ x: 1, y: 1, z: 0 })

    dim.centerPoint = new AcGePoint3d(10, 20, 0)
    dim.arcPoint = new AcGePoint3d(12, 22, 0)

    expect(dim.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(dim.geometricExtents.max).toMatchObject({ x: 12, y: 22, z: 0 })
  })
})

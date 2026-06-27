import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { AcDbRadialDimension } from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbRadialDimension', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDbRadialDimension(new AcGePoint3d(), new AcGePoint3d(1, 0, 0), 1)
    )
  })

  it('returns geometricExtents and recomputes when center changes', () => {
    const dim = new AcDbRadialDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(5, 0, 0),
      1
    )

    expect(dim.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(dim.geometricExtents.max.x).toBeCloseTo(6)

    dim.center = new AcGePoint3d(10, 20, 0)
    dim.chordPoint = new AcGePoint3d(15, 20, 0)

    expect(dim.geometricExtents.min).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(dim.geometricExtents.max.x).toBeCloseTo(16)
  })
})

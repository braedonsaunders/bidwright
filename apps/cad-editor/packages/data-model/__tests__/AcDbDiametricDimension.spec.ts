import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { AcDbDiametricDimension } from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbDiametricDimension', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDbDiametricDimension(
          new AcGePoint3d(1, 0, 0),
          new AcGePoint3d(-1, 0, 0),
          1
        )
    )
  })

  it('returns geometricExtents and recomputes when chord points change', () => {
    const dim = new AcDbDiametricDimension(
      new AcGePoint3d(1, 0, 0),
      new AcGePoint3d(-1, 0, 0),
      1
    )

    expect(dim.geometricExtents.min.x).toBeCloseTo(-2)
    expect(dim.geometricExtents.max.x).toBeCloseTo(1)

    dim.chordPoint = new AcGePoint3d(10, 0, 0)
    dim.farChordPoint = new AcGePoint3d(20, 0, 0)

    expect(dim.geometricExtents.min.x).toBeCloseTo(10)
    expect(dim.geometricExtents.max.x).toBeCloseTo(21)
  })
})

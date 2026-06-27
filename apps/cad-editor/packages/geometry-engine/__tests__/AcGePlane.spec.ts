import { AcGeBox3d, AcGePlane, AcGePoint3d, AcGeVector3d } from '../src'

describe('AcGePlane', () => {
  it('computes distance and projection and intersects box', () => {
    const plane = new AcGePlane().setFromNormalAndCoplanarPoint(
      new AcGeVector3d(0, 0, 1),
      new AcGePoint3d(0, 0, 2)
    )

    expect(plane.distanceToPoint(new AcGePoint3d(0, 0, 5))).toBeCloseTo(3, 8)

    const projected = plane.projectPoint(
      new AcGePoint3d(1, 1, 7),
      new AcGeVector3d()
    )
    expect(projected.z).toBeCloseTo(2, 8)

    const box = new AcGeBox3d({ x: -1, y: -1, z: 1 }, { x: 1, y: 1, z: 3 })
    expect(plane.intersectsBox(box)).toBe(true)
  })
})

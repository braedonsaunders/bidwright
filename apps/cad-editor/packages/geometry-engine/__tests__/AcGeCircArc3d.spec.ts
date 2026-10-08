import {
  AcGeCircArc3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d,
  ORIGIN_POINT_3D,
  TAU
} from '../src'

describe('Test AcGeCircArc3d', () => {
  it('computes length correctly', () => {
    const arc = new AcGeCircArc3d(
      ORIGIN_POINT_3D,
      1,
      0,
      Math.PI,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS
    )
    expect(arc.length).toBe(Math.PI)
  })

  it('covers edge branches in arc helpers', () => {
    expect(
      AcGeCircArc3d.computeCenterPoint(
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        { x: 2, y: 2, z: 2 }
      )
    ).toBeNull()

    const fullArc = new AcGeCircArc3d(
      ORIGIN_POINT_3D,
      2,
      1.25,
      1.25 + Math.PI * 2,
      AcGeVector3d.Z_AXIS
    )
    expect(fullArc.startAngle).toBe(0)
    expect(fullArc.endAngle).toBeCloseTo(Math.PI * 2, 8)
    expect(fullArc.midPoint).toBeInstanceOf(AcGePoint3d)
    expect(fullArc.getPoints(8)).toHaveLength(9)

    const arc = new AcGeCircArc3d(
      ORIGIN_POINT_3D,
      3,
      0,
      Math.PI / 2,
      AcGeVector3d.Z_AXIS
    )
    // nearestPoint center-degenerate branch
    const centerNearest = arc.nearestPoint({ x: 0, y: 0, z: 0 })
    expect(centerNearest).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number)
    })

    // force endpoint-selection branch by controlling computed angle
    const getAngleSpy = jest.spyOn(arc, 'getAngle').mockReturnValue(Math.PI / 4)
    const nearEnd = arc.endPoint.clone()
    const nearest = arc.nearestPoint(nearEnd)
    expect(nearest.distanceTo(arc.endPoint)).toBeCloseTo(0, 8)
    getAngleSpy.mockRestore()

    // regular nearest-point branch (returns projected arc point)
    const nearMid = arc.nearestPoint({ x: 2, y: 2, z: 0 })
    expect(nearMid.distanceTo(arc.center)).toBeCloseTo(arc.radius, 6)

    // nearestTangentPoint second-branch selection
    const tangentSpy = jest
      .spyOn(arc, 'tangentPoints')
      .mockReturnValue([new AcGePoint3d(5, 5, 0), new AcGePoint3d(0, 3, 0)])
    const nearestTangent = arc.nearestTangentPoint({ x: 0, y: 3.1, z: 0 })
    expect(nearestTangent?.distanceTo(new AcGePoint3d(0, 3, 0))).toBeCloseTo(
      0,
      8
    )
    tangentSpy.mockRestore()

    // transform fallback normal branch (cross product degenerates)
    const degenerated = new AcGeCircArc3d(
      ORIGIN_POINT_3D,
      1,
      0,
      Math.PI / 2,
      AcGeVector3d.Z_AXIS
    )
    expect(degenerated.transform(new AcGeMatrix3d().makeScale(0, 0, 0))).toBe(
      degenerated
    )
  })

  it('computes circumcenter of three non-collinear points', () => {
    const center = AcGeCircArc3d.computeCenterPoint(
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }
    )
    expect(center).not.toBeNull()
    expect(center!.x).toBeCloseTo(0)
    expect(center!.y).toBeCloseTo(0)
    expect(center!.z).toBeCloseTo(0)
  })

  it('computes circle area and returns 0 for open arc', () => {
    const circle = new AcGeCircArc3d({ x: 0, y: 0, z: 0 }, 5, 0, TAU, {
      x: 0,
      y: 0,
      z: 1
    })
    expect(circle.area).toBeCloseTo(Math.PI * 25, 8)

    const arc = new AcGeCircArc3d({ x: 0, y: 0, z: 0 }, 5, 0, Math.PI / 2, {
      x: 0,
      y: 0,
      z: 1
    })
    expect(arc.area).toBe(0)
  })

  it('creates a three-point arc that follows the through point, including major arcs', () => {
    const minor = AcGeCircArc3d.tryCreateByThreePoints(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }
    )
    expect(minor).not.toBeNull()
    expect(minor!.length).toBeCloseTo(Math.PI / 2)
    expect(minor!.midPoint.x).toBeCloseTo(Math.SQRT1_2)
    expect(minor!.midPoint.y).toBeCloseTo(Math.SQRT1_2)

    const major = AcGeCircArc3d.tryCreateByThreePoints(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: -1, y: 0, z: 0 }
    )
    expect(major).not.toBeNull()
    expect(major!.length).toBeCloseTo((3 * Math.PI) / 2)
    expect(major!.midPoint.x).toBeCloseTo(-Math.SQRT1_2)
    expect(major!.midPoint.y).toBeCloseTo(-Math.SQRT1_2)

    // Through at 120° with end at 60° must take the long CCW sweep (300°),
    // not the short start×through frame that would drop the through point.
    const longSweep = AcGeCircArc3d.tryCreateByThreePoints(
      { x: 1, y: 0, z: 0 },
      { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
      { x: -0.5, y: Math.sqrt(3) / 2, z: 0 }
    )
    expect(longSweep).not.toBeNull()
    expect(longSweep!.length).toBeCloseTo((5 * Math.PI) / 3)
    expect(longSweep!.midPoint.x).toBeCloseTo(-Math.sqrt(3) / 2)
    expect(longSweep!.midPoint.y).toBeCloseTo(-0.5)

    expect(
      AcGeCircArc3d.tryCreateByThreePoints(
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 }
      )
    ).toBeNull()
  })
})

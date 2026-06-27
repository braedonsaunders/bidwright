import {
  AcGeCircArc3d,
  AcGeLine3d,
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
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    expect(
      AcGeCircArc3d.computeCenterPoint(
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
        { x: 2, y: 2, z: 2 }
      )
    ).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()

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

  it('covers computeCenterPoint failure branch when center cannot be solved', () => {
    const errSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const closestSpy = jest
      .spyOn(AcGeLine3d.prototype, 'closestPointToPoint')
      .mockReturnValue(null as unknown as AcGePoint3d)

    expect(
      AcGeCircArc3d.computeCenterPoint(
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      )
    ).toBeNull()

    closestSpy.mockRestore()
    errSpy.mockRestore()
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
})

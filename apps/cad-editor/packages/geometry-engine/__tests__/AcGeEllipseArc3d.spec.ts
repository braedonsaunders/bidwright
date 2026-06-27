import {
  AcGeEllipseArc3d,
  AcGeMatrix3d,
  AcGeVector3d,
  DEFAULT_TOL,
  ORIGIN_POINT_3D
} from '../src'

describe('Test AcGeEllipseArc3d', () => {
  it('caches and recalculates bounding box correctly', () => {
    const arc1 = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      2,
      1.5,
      0,
      Math.PI
    )
    let box1 = arc1.box
    let box2 = arc1.box
    expect(box1 === box2).toBeTruthy()
    expect(DEFAULT_TOL.equalPoint2d(arc1.box.min, { x: -2, y: 0 })).toBeTruthy()
    expect(
      DEFAULT_TOL.equalPoint2d(arc1.box.max, { x: 2, y: 1.5 })
    ).toBeTruthy()

    arc1.majorAxisRadius = 3
    box1 = arc1.box
    box2 = arc1.box
    expect(box1 === box2).toBeTruthy()
    expect(DEFAULT_TOL.equalPoint2d(arc1.box.min, { x: -3, y: 0 })).toBeTruthy()
    expect(
      DEFAULT_TOL.equalPoint2d(arc1.box.max, { x: 3, y: 1.5 })
    ).toBeTruthy()

    const arc2 = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.Y_AXIS,
      2,
      1.5,
      0,
      Math.PI
    )
    expect(
      DEFAULT_TOL.equalPoint2d(arc2.box.min, { x: -1.5, y: -2 })
    ).toBeTruthy()
    expect(DEFAULT_TOL.equalPoint2d(arc2.box.max, { x: 0, y: 2 })).toBeTruthy()
  })

  it('computes length correctly', () => {
    const arc1 = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      2,
      2,
      0,
      Math.PI
    )
    expect(arc1.length).toBeCloseTo(2 * Math.PI, 5)

    const arc2 = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      2,
      1,
      0,
      2 * Math.PI
    )
    expect(arc2.length).toBeCloseTo(9.688448220547675, 4)
  })

  it('covers branch-heavy getters and transform paths', () => {
    const largeArc = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      3,
      2,
      0,
      Math.PI * 1.5
    )
    expect(largeArc.isLargeArc).toBe(1)
    expect(largeArc.clockwise).toBe(false)
    expect(largeArc.getPoints()).toHaveLength(101)

    const fullEllipse = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      3,
      2,
      0,
      Math.PI * 2
    )
    expect(fullEllipse.midPoint).toBeInstanceOf(Object)
    expect(fullEllipse.area).toBeCloseTo(Math.PI * 6, 8)

    const openArc = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      3,
      2,
      0,
      Math.PI / 2
    )
    expect(openArc.area).toBe(0)

    const skewAxis = new AcGeVector3d(1, 1, 0).normalize()
    const skew = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      skewAxis,
      4,
      1.5,
      0,
      Math.PI
    )
    const skewBox = skew.calculateBoundingBox()
    expect(skewBox.min.x).toBeLessThan(skewBox.max.x)
    expect(skewBox.min.y).toBeLessThan(skewBox.max.y)

    // closed branch in getPoints (startAngle === endAngle)
    const closedEllipse = new AcGeEllipseArc3d(
      ORIGIN_POINT_3D,
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      2,
      1,
      0,
      0
    )
    expect(closedEllipse.closed).toBe(true)
    expect(closedEllipse.getPoints(12)).toHaveLength(13)

    // force minor-axis orientation correction branch in transform
    const dotSpy = jest
      .spyOn(AcGeVector3d.prototype, 'dot')
      .mockImplementation(function () {
        return -1
      })
    expect(closedEllipse.transform(new AcGeMatrix3d().makeScale(1, 1, 1))).toBe(
      closedEllipse
    )
    dotSpy.mockRestore()

    expect(
      () =>
        new AcGeEllipseArc3d(
          ORIGIN_POINT_3D,
          AcGeVector3d.Z_AXIS,
          AcGeVector3d.X_AXIS,
          -1,
          1
        )
    ).toThrow()
    expect(
      () =>
        new AcGeEllipseArc3d(
          ORIGIN_POINT_3D,
          AcGeVector3d.Z_AXIS,
          AcGeVector3d.X_AXIS,
          1,
          -1
        )
    ).toThrow()
  })
})

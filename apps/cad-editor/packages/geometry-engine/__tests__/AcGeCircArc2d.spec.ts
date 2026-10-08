import {
  AcGeCircArc2d,
  AcGeTol,
  DEFAULT_TOL,
  ORIGIN_POINT_2D,
  TAU
} from '../src'
import { AcGeMatrix2d } from '../src'

describe('Test AcGeCircArc2d', () => {
  const expectPointClose = (
    actual: { x: number; y: number },
    expected: { x: number; y: number }
  ) => {
    expect(actual.x).toBeCloseTo(expected.x, 10)
    expect(actual.y).toBeCloseTo(expected.y, 10)
  }

  it('computes closed property correctly', () => {
    const closedArc1 = new AcGeCircArc2d(
      ORIGIN_POINT_2D,
      1,
      0,
      2 * Math.PI,
      true
    )
    expect(closedArc1.closed).toBe(true)

    const closedArc2 = new AcGeCircArc2d(
      ORIGIN_POINT_2D,
      1,
      0,
      4 * Math.PI,
      true
    )
    expect(closedArc2.closed).toBe(true)

    const closedArc3 = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, 0, true)
    expect(closedArc3.closed).toBe(true)

    const notClosedArc1 = new AcGeCircArc2d(
      ORIGIN_POINT_2D,
      1,
      0,
      Math.PI,
      true
    )
    expect(notClosedArc1.closed).toBe(false)
  })

  it('computes clockwise property correctly', () => {
    const arc1 = new AcGeCircArc2d(
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 }
    )
    expect(arc1.clockwise).toBe(true)
    expect(arc1.midPoint.y).toBeCloseTo(1)

    const arc2 = new AcGeCircArc2d(
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: 1, y: 0 }
    )
    expect(arc2.clockwise).toBe(false)
    expect(arc2.midPoint.y).toBeCloseTo(-1)
  })

  it('nearestPoint returns on-arc point and endpoints when outside span', () => {
    const arc = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI / 2, false)
    const onArc = arc.nearestPoint({ x: 0.7, y: 0.7 })
    expect(onArc.distanceTo({ x: 0.7, y: 0.7 })).toBeLessThan(0.2)

    const nearStart = arc.nearestPoint({ x: 1.5, y: -1 })
    expectPointClose(nearStart, arc.startPoint)
  })

  it('getQuadrantPoints returns axis points on arc', () => {
    const arc = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI, false)
    const quads = arc.getQuadrantPoints()
    expect(quads.length).toBeGreaterThanOrEqual(2)
    expect(
      quads.some(p => Math.abs(p.x - 1) < 1e-6 && Math.abs(p.y) < 1e-6)
    ).toBe(true)
  })

  it('computes midpoint correctly', () => {
    const arc1 = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI, true)
    expect(AcGeTol.equal(arc1.midPoint.x, 0))
    expect(AcGeTol.equal(arc1.midPoint.y, 1))

    const arc2 = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI, false)
    expect(AcGeTol.equal(arc2.midPoint.x, 0))
    expect(AcGeTol.equal(arc2.midPoint.y, -1))
  })

  it('computes bounding box correctly', () => {
    const arc1 = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI, false)
    const box1 = arc1.box
    const box2 = arc1.box
    // The bounding box should be cached and not be calculated again
    expect(box1 === box2).toBeTruthy()

    expect(DEFAULT_TOL.equalPoint2d(arc1.box.min, { x: -1, y: 0 })).toBeTruthy()
    expect(DEFAULT_TOL.equalPoint2d(arc1.box.max, { x: 1, y: 1 })).toBeTruthy()

    const arc2 = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI, true)
    expect(
      DEFAULT_TOL.equalPoint2d(arc2.box.min, { x: -1, y: -1 })
    ).toBeTruthy()
    expect(DEFAULT_TOL.equalPoint2d(arc2.box.max, { x: 1, y: 0 })).toBeTruthy()
  })

  it('caches and recalculates bounding box correctly', () => {
    const arc1 = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI, false)
    let box1 = arc1.box
    let box2 = arc1.box
    expect(box1 === box2).toBeTruthy()

    arc1.radius = 2
    box1 = arc1.box
    box2 = arc1.box
    expect(box1 === box2).toBeTruthy()
    expect(DEFAULT_TOL.equalPoint2d(arc1.box.min, { x: -2, y: 0 })).toBeTruthy()
    expect(DEFAULT_TOL.equalPoint2d(arc1.box.max, { x: 2, y: 2 })).toBeTruthy()
  })

  it('creates arc by three points correctly', () => {
    const arc = new AcGeCircArc2d(
      { x: 0, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 1 }
    )
    expect(arc.startAngle).toBe(Math.PI)
    expect(arc.endAngle).toBe(0)
    expect(arc.radius).toBe(1)
    expect(arc.center.x).toBe(1)
    expect(arc.center.y).toBe(1)
  })

  it('creates arc by start point, end point, and bulge correctly', () => {
    const arc1 = new AcGeCircArc2d({ x: 0, y: 0 }, { x: 2, y: 0 }, 1)
    expect(arc1.radius).toBe(1)
    expect(arc1.center.x).toBe(1)
    expect(AcGeTol.equalToZero(arc1.center.y)).toBeTruthy()
    expect(arc1.startAngle).toBe(Math.PI)
    expect(AcGeTol.equalToZero(arc1.endAngle)).toBeTruthy()
    expect(arc1.clockwise).toBe(false)

    const arc2 = new AcGeCircArc2d({ x: 0, y: 0 }, { x: 2, y: 0 }, -1)
    expect(arc2.radius).toBe(1)
    expect(arc2.center.x).toBe(1)
    expect(AcGeTol.equalToZero(arc2.center.y)).toBeTruthy()
    expect(arc2.startAngle).toBe(Math.PI)
    expect(AcGeTol.equalToZero(arc2.endAngle)).toBeTruthy()
    expect(arc2.clockwise).toBe(true)
  })

  it('creates non-semicircle minor arcs from bulge correctly', () => {
    const quarterBulge = Math.SQRT2 - 1

    const ccwArc = new AcGeCircArc2d(
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      quarterBulge
    )
    expect(ccwArc.clockwise).toBe(false)
    expect(ccwArc.radius).toBeCloseTo(Math.SQRT2, 10)
    expectPointClose(ccwArc.center, { x: 1, y: 1 })
    expect(ccwArc.deltaAngle).toBeCloseTo(Math.PI / 2, 10)
    expectPointClose(ccwArc.startPoint, { x: 0, y: 0 })
    expectPointClose(ccwArc.endPoint, { x: 2, y: 0 })
    expectPointClose(ccwArc.midPoint, { x: 1, y: 1 - Math.SQRT2 })

    const cwArc = new AcGeCircArc2d(
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      -quarterBulge
    )
    expect(cwArc.clockwise).toBe(true)
    expect(cwArc.radius).toBeCloseTo(Math.SQRT2, 10)
    expectPointClose(cwArc.center, { x: 1, y: -1 })
    expect(cwArc.deltaAngle).toBeCloseTo(Math.PI / 2, 10)
    expectPointClose(cwArc.startPoint, { x: 0, y: 0 })
    expectPointClose(cwArc.endPoint, { x: 2, y: 0 })
    expectPointClose(cwArc.midPoint, { x: 1, y: Math.SQRT2 - 1 })
  })

  it('creates non-semicircle major arcs from bulge correctly', () => {
    const majorBulge = 2

    const ccwArc = new AcGeCircArc2d({ x: 0, y: 0 }, { x: 2, y: 0 }, majorBulge)
    expect(ccwArc.clockwise).toBe(false)
    expect(ccwArc.radius).toBeCloseTo(1.25, 10)
    expectPointClose(ccwArc.center, { x: 1, y: -0.75 })
    expect(ccwArc.deltaAngle).toBeCloseTo(4 * Math.atan(majorBulge), 10)
    expectPointClose(ccwArc.startPoint, { x: 0, y: 0 })
    expectPointClose(ccwArc.endPoint, { x: 2, y: 0 })
    expectPointClose(ccwArc.midPoint, { x: 1, y: -2 })

    const cwArc = new AcGeCircArc2d({ x: 0, y: 0 }, { x: 2, y: 0 }, -majorBulge)
    expect(cwArc.clockwise).toBe(true)
    expect(cwArc.radius).toBeCloseTo(1.25, 10)
    expectPointClose(cwArc.center, { x: 1, y: 0.75 })
    expect(cwArc.deltaAngle).toBeCloseTo(4 * Math.atan(majorBulge), 10)
    expectPointClose(cwArc.startPoint, { x: 0, y: 0 })
    expectPointClose(cwArc.endPoint, { x: 2, y: 0 })
    expectPointClose(cwArc.midPoint, { x: 1, y: 2 })
  })

  it('creates bulge arcs correctly for non-axis-aligned chords', () => {
    const from = { x: -3, y: 5 }
    const to = { x: 4, y: -1 }

    const minorArc = new AcGeCircArc2d(from, to, 0.25)
    expect(minorArc.clockwise).toBe(false)
    expect(minorArc.radius).toBeCloseTo(9.795765985873693, 10)
    expectPointClose(minorArc.center, { x: 6.125, y: 8.5625 })
    expect(minorArc.deltaAngle).toBeCloseTo(4 * Math.atan(0.25), 10)
    expectPointClose(minorArc.startPoint, from)
    expectPointClose(minorArc.endPoint, to)
    expectPointClose(minorArc.midPoint, { x: -0.25, y: 1.125 })

    const majorArc = new AcGeCircArc2d(from, to, -3)
    expect(majorArc.clockwise).toBe(true)
    expect(majorArc.radius).toBeCloseTo(7.682953714410739, 10)
    expectPointClose(majorArc.center, { x: 4.5, y: 6.666666666666667 })
    expect(majorArc.deltaAngle).toBeCloseTo(4 * Math.atan(3), 10)
    expectPointClose(majorArc.startPoint, from)
    expectPointClose(majorArc.endPoint, to)
    expectPointClose(majorArc.midPoint, { x: 9.5, y: 12.5 })
  })

  it('covers closed transform/getPoints and constructor guard', () => {
    expect(() => new (AcGeCircArc2d as any)(ORIGIN_POINT_2D, 1)).toThrow()

    const closed = new AcGeCircArc2d(ORIGIN_POINT_2D, 2, 0, Math.PI * 2, false)
    expect(closed.closed).toBe(true)
    expect(closed.getPoints(6)).toHaveLength(7)

    const transformed = closed.transform(
      new AcGeMatrix2d().makeTranslation(3, 4)
    )
    expect(transformed).toBe(closed)
    expect(closed.center.x).toBeCloseTo(3, 8)
    expect(closed.center.y).toBeCloseTo(4, 8)
  })

  it('creates a three-point arc through a vertical chord', () => {
    const arc = new AcGeCircArc2d(
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 }
    )
    expect(arc.center.x).toBeCloseTo(0.5)
    expect(arc.center.y).toBeCloseTo(0.5)
    expect(arc.radius).toBeCloseTo(Math.SQRT1_2)
    expect(arc.length).toBeCloseTo(((3 * Math.PI) / 2) * Math.SQRT1_2)
  })

  it('throws for collinear three-point construction', () => {
    expect(
      () => new AcGeCircArc2d({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })
    ).toThrow()
  })

  it('selects the major arc when the through point is on the long sweep', () => {
    const start = { x: 1, y: 0 }
    const end = { x: 0, y: 1 }
    const major = AcGeCircArc2d.tryCreateByThreePoints(
      start,
      { x: -1, y: 0 },
      end
    )
    expect(major).not.toBeNull()
    expect(major!.length).toBeCloseTo((3 * Math.PI) / 2)
    expect(major!.clockwise).toBe(true)
    expect(major!.midPoint.x).toBeCloseTo(-Math.SQRT1_2)
    expect(major!.midPoint.y).toBeCloseTo(-Math.SQRT1_2)

    const minor = AcGeCircArc2d.tryCreateByThreePoints(
      start,
      { x: Math.SQRT1_2, y: Math.SQRT1_2 },
      end
    )
    expect(minor).not.toBeNull()
    expect(minor!.length).toBeCloseTo(Math.PI / 2)
    expect(minor!.clockwise).toBe(false)

    const longSweep = AcGeCircArc2d.tryCreateByThreePoints(
      { x: 1, y: 0 },
      { x: -0.5, y: Math.sqrt(3) / 2 },
      { x: 0.5, y: Math.sqrt(3) / 2 }
    )
    expect(longSweep).not.toBeNull()
    expect(longSweep!.length).toBeCloseTo((5 * Math.PI) / 3)
    expect(longSweep!.clockwise).toBe(true)
    expect(longSweep!.midPoint.x).toBeCloseTo(-Math.sqrt(3) / 2)
    expect(longSweep!.midPoint.y).toBeCloseTo(-0.5)
  })

  it('creates circles from center, diameter, and three points', () => {
    const byCenter = AcGeCircArc2d.tryCreateCircle({ x: 1, y: 2 }, 3)
    expect(byCenter).not.toBeNull()
    expect(byCenter!.closed).toBe(true)
    expect(byCenter!.radius).toBe(3)

    const byDiameter = AcGeCircArc2d.tryCreateCircleByDiameter(
      { x: 0, y: 0 },
      { x: 4, y: 0 }
    )
    expect(byDiameter).not.toBeNull()
    expect(byDiameter!.center.x).toBeCloseTo(2)
    expect(byDiameter!.radius).toBeCloseTo(2)

    const byThree = AcGeCircArc2d.tryCreateCircleByThreePoints(
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 }
    )
    expect(byThree).not.toBeNull()
    expect(byThree!.center.x).toBeCloseTo(0)
    expect(byThree!.center.y).toBeCloseTo(0)
    expect(byThree!.radius).toBeCloseTo(1)
    expect(
      AcGeCircArc2d.tryCreateCircleByThreePoints(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 }
      )
    ).toBeNull()
  })

  it('creates the shorter arc between two circle points', () => {
    const shorter = AcGeCircArc2d.tryCreateShorterArc(
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 0 }
    )
    expect(shorter).not.toBeNull()
    expect(shorter!.length).toBeCloseTo(Math.PI / 2)
  })

  it('creates center-start-sweep and start-end-radius arcs', () => {
    const sweep = AcGeCircArc2d.tryCreateByCenterStartSweep(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      Math.PI / 2
    )
    expect(sweep).not.toBeNull()
    expect(sweep!.length).toBeCloseTo(Math.PI / 2)
    expect(sweep!.clockwise).toBe(false)

    const radius = AcGeCircArc2d.tryCreateByStartEndRadius(
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      1
    )
    expect(radius).not.toBeNull()
    expect(radius!.radius).toBeCloseTo(1)
  })

  it('pointLiesOnCircle uses a relative radial tolerance', () => {
    expect(
      AcGeCircArc2d.pointLiesOnCircle({ x: 10, y: 0 }, { x: 0, y: 0 }, 10)
    ).toBe(true)
    expect(
      AcGeCircArc2d.pointLiesOnCircle({ x: 10.2, y: 0 }, { x: 0, y: 0 }, 10)
    ).toBe(false)
    // Default eps is max(1e-6, r * 1e-5) = 1e-4 for r = 10.
    expect(
      AcGeCircArc2d.pointLiesOnCircle(
        { x: 10.00005, y: 0 },
        { x: 0, y: 0 },
        10
      )
    ).toBe(true)
    expect(
      AcGeCircArc2d.pointLiesOnCircle(
        { x: 10.001, y: 0 },
        { x: 0, y: 0 },
        10
      )
    ).toBe(false)
  })

  it('sameCircle compares center and radius', () => {
    expect(
      AcGeCircArc2d.sameCircle({ x: 1, y: 2 }, 3, { x: 1, y: 2 }, 3)
    ).toBe(true)
    expect(
      AcGeCircArc2d.sameCircle({ x: 1, y: 2 }, 3, { x: 1.1, y: 2 }, 3)
    ).toBe(false)
  })

  it('isBetterDistanceAlign prefers closer points, then larger align', () => {
    expect(AcGeCircArc2d.isBetterDistanceAlign(1, 0, 4, 10)).toBe(true)
    expect(AcGeCircArc2d.isBetterDistanceAlign(9, 10, 4, 0)).toBe(false)
    expect(AcGeCircArc2d.isBetterDistanceAlign(4, 2, 4, 1)).toBe(true)
    expect(AcGeCircArc2d.isBetterDistanceAlign(4, 1, 4, 2)).toBe(false)
  })

  it('inwardAlignment picks the arc interior at a shared vertex', () => {
    const first = new AcGeCircArc2d(
      ORIGIN_POINT_2D,
      1,
      0,
      Math.PI / 2,
      false
    )
    const second = new AcGeCircArc2d(
      ORIGIN_POINT_2D,
      1,
      (3 * Math.PI) / 2,
      TAU,
      false
    )
    const vertex = { x: 1, y: 0 }
    const towardFirst = { x: 0.95, y: 0.05 }
    const towardSecond = { x: 0.95, y: -0.05 }
    expect(first.inwardAlignment(vertex, towardFirst)).toBeGreaterThan(0)
    expect(second.inwardAlignment(vertex, towardFirst)).toBeLessThan(0)
    expect(second.inwardAlignment(vertex, towardSecond)).toBeGreaterThan(0)
    expect(first.inwardAlignment(vertex, towardSecond)).toBeLessThan(0)
    expect(first.inwardAlignment(vertex, vertex)).toBe(0)
  })
})

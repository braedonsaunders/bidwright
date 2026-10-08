import {
  AcGeCircArc3d,
  AcGeCurveExtent,
  AcGeEllipseArc3d,
  acgeIntersectCurves,
  AcGeIntersectPrimitive,
  AcGeLine3d,
  AcGePlane,
  AcGePoint3d,
  AcGeSpline3d,
  AcGeVector3d,
  TAU
} from '../src'

function linePrim(
  start: [number, number, number],
  end: [number, number, number],
  extent: AcGeCurveExtent = 'bounded',
  extendable = true
): AcGeIntersectPrimitive {
  return {
    kind: 'line',
    line: new AcGeLine3d(
      { x: start[0], y: start[1], z: start[2] },
      { x: end[0], y: end[1], z: end[2] }
    ),
    extent,
    extendable
  }
}

function expectPoint(
  points: AcGePoint3d[],
  expected: { x: number; y: number; z: number },
  digits = 5
) {
  const match = points.find(
    point =>
      Math.abs(point.x - expected.x) < 10 ** -digits &&
      Math.abs(point.y - expected.y) < 10 ** -digits &&
      Math.abs(point.z - expected.z) < 10 ** -digits
  )
  expect(match).toBeDefined()
}

describe('acgeIntersectCurves', () => {
  it('intersects two crossing line segments', () => {
    const points = acgeIntersectCurves(
      [linePrim([0, 0, 0], [10, 0, 0])],
      [linePrim([5, -5, 0], [5, 5, 0])]
    )
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 5, y: 0, z: 0 })
  })

  it('returns empty for parallel lines', () => {
    const points = acgeIntersectCurves(
      [linePrim([0, 0, 0], [10, 0, 0])],
      [linePrim([0, 1, 0], [10, 1, 0])]
    )
    expect(points).toEqual([])
  })

  it('returns empty for collinear overlapping segments', () => {
    const points = acgeIntersectCurves(
      [linePrim([0, 0, 0], [10, 0, 0])],
      [linePrim([5, 0, 0], [15, 0, 0])]
    )
    expect(points).toEqual([])
  })

  it('returns empty for skew 3d lines', () => {
    const points = acgeIntersectCurves(
      [linePrim([0, 0, 0], [10, 0, 0])],
      [linePrim([5, -5, 1], [5, 5, 1])]
    )
    expect(points).toEqual([])
  })

  it('extends a bounded segment to meet another line', () => {
    const points = acgeIntersectCurves(
      [linePrim([0, 0, 0], [4, 0, 0])],
      [linePrim([8, -1, 0], [8, 1, 0])],
      true,
      false
    )
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 8, y: 0, z: 0 })
  })

  it('does not extend when extendable is false', () => {
    const points = acgeIntersectCurves(
      [linePrim([0, 0, 0], [4, 0, 0], 'bounded', false)],
      [linePrim([8, -1, 0], [8, 1, 0])],
      true,
      false
    )
    expect(points).toEqual([])
  })

  it('intersects a ray but not behind its origin', () => {
    const ray = linePrim([0, 0, 0], [1, 0, 0], 'ray')
    const ahead = acgeIntersectCurves([ray], [linePrim([5, -1, 0], [5, 1, 0])])
    expect(ahead).toHaveLength(1)
    const behind = acgeIntersectCurves(
      [ray],
      [linePrim([-5, -1, 0], [-5, 1, 0])]
    )
    expect(behind).toEqual([])
  })

  it('intersects a line with a circle at two points', () => {
    const circle: AcGeIntersectPrimitive = {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        { x: 0, y: 0, z: 0 },
        5,
        0,
        TAU,
        AcGeVector3d.Z_AXIS
      ),
      extendable: false
    }
    const points = acgeIntersectCurves(
      [linePrim([-10, 0, 0], [10, 0, 0])],
      [circle]
    )
    expect(points).toHaveLength(2)
    expectPoint(points, { x: 5, y: 0, z: 0 })
    expectPoint(points, { x: -5, y: 0, z: 0 })
  })

  it('clips circle intersections to an arc sweep', () => {
    const arc: AcGeIntersectPrimitive = {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        { x: 0, y: 0, z: 0 },
        5,
        0,
        Math.PI / 2,
        AcGeVector3d.Z_AXIS
      )
    }
    const points = acgeIntersectCurves(
      [linePrim([-10, 0, 0], [10, 0, 0])],
      [arc]
    )
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 5, y: 0, z: 0 })
  })

  it('extends an arc to a full circle', () => {
    const arc: AcGeIntersectPrimitive = {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        { x: 0, y: 0, z: 0 },
        5,
        0,
        Math.PI / 2,
        AcGeVector3d.Z_AXIS
      )
    }
    const points = acgeIntersectCurves(
      [linePrim([-10, 0, 0], [10, 0, 0])],
      [arc],
      false,
      true
    )
    expect(points).toHaveLength(2)
    expectPoint(points, { x: 5, y: 0, z: 0 })
    expectPoint(points, { x: -5, y: 0, z: 0 })
  })

  it('finds a tangent line-circle intersection', () => {
    const circle: AcGeIntersectPrimitive = {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        { x: 0, y: 0, z: 0 },
        5,
        0,
        TAU,
        AcGeVector3d.Z_AXIS
      ),
      extendable: false
    }
    const points = acgeIntersectCurves(
      [linePrim([-10, 5, 0], [10, 5, 0])],
      [circle]
    )
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 0, y: 5, z: 0 })
  })

  it('intersects two coplanar circles', () => {
    const a: AcGeIntersectPrimitive = {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        { x: 0, y: 0, z: 0 },
        5,
        0,
        TAU,
        AcGeVector3d.Z_AXIS
      ),
      extendable: false
    }
    const b: AcGeIntersectPrimitive = {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        { x: 6, y: 0, z: 0 },
        5,
        0,
        TAU,
        AcGeVector3d.Z_AXIS
      ),
      extendable: false
    }
    const points = acgeIntersectCurves([a], [b])
    expect(points).toHaveLength(2)
    expectPoint(points, { x: 3, y: 4, z: 0 }, 4)
    expectPoint(points, { x: 3, y: -4, z: 0 }, 4)
  })

  it('intersects a line with an ellipse', () => {
    const ellipse: AcGeIntersectPrimitive = {
      kind: 'ellipseArc',
      arc: new AcGeEllipseArc3d(
        { x: 0, y: 0, z: 0 },
        AcGeVector3d.Z_AXIS,
        AcGeVector3d.X_AXIS,
        10,
        5,
        0,
        TAU
      ),
      extendable: false
    }
    const points = acgeIntersectCurves(
      [linePrim([-20, 0, 0], [20, 0, 0])],
      [ellipse]
    )
    expect(points).toHaveLength(2)
    expectPoint(points, { x: 10, y: 0, z: 0 })
    expectPoint(points, { x: -10, y: 0, z: 0 })
  })

  it('finds apparent intersection by projecting onto a plane', () => {
    const plane = new AcGePlane().setFromNormalAndCoplanarPoint(
      AcGeVector3d.Z_AXIS,
      new AcGePoint3d(0, 0, 0)
    )
    const points = acgeIntersectCurves(
      [linePrim([0, 0, 5], [10, 0, 5])],
      [linePrim([5, -5, -3], [5, 5, -3])],
      false,
      false,
      plane
    )
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 5, y: 0, z: 0 })
  })

  it('intersects a sampled spline with a line', () => {
    const spline = new AcGeSpline3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
        { x: 7, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
      ],
      [0, 0, 0, 0, 1, 1, 1, 1],
      [1, 1, 1, 1]
    )
    const points = acgeIntersectCurves(
      [{ kind: 'spline', spline, extendable: false }],
      [linePrim([5, -5, 0], [5, 5, 0])]
    )
    expect(points.length).toBeGreaterThanOrEqual(1)
    expect(points[0].x).toBeCloseTo(5, 5)
    expect(points[0].y).toBeCloseTo(0, 5)
  })

  it('projects a tilted circle onto a plane as an ellipse', () => {
    const n = new AcGeVector3d(0, 1, 1).normalize()
    const circle: AcGeIntersectPrimitive = {
      kind: 'circArc',
      arc: new AcGeCircArc3d({ x: 0, y: 0, z: 0 }, 5, 0, TAU, n),
      extendable: false
    }
    const plane = new AcGePlane().setFromNormalAndCoplanarPoint(
      AcGeVector3d.Z_AXIS,
      new AcGePoint3d(0, 0, 0)
    )
    const points = acgeIntersectCurves(
      [circle],
      [linePrim([-10, 0, 0], [10, 0, 0])],
      false,
      false,
      plane
    )
    expect(points).toHaveLength(2)
    expectPoint(points, { x: 5, y: 0, z: 0 }, 4)
    expectPoint(points, { x: -5, y: 0, z: 0 }, 4)
  })
})

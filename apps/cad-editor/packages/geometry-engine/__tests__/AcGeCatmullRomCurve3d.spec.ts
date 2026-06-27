import { AcGeCatmullRomCurve3d, AcGeMatrix3d } from '../src'

describe('AcGeCatmullRomCurve3d', () => {
  it('samples points along curve', () => {
    const catmull = new AcGeCatmullRomCurve3d([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 1, z: 0 }
    ])

    const pts = catmull.getPoints(8)
    expect(pts).toHaveLength(9)
    expect(catmull.length).toBeGreaterThan(0)
  })

  it('covers empty/single/closed and bounding-box branches', () => {
    const empty = new AcGeCatmullRomCurve3d([])
    expect(empty.getPoint(0.5).toArray()).toEqual([0, 0, 0])
    expect(empty.box.isEmpty()).toBe(true)

    const single = new AcGeCatmullRomCurve3d([{ x: 2, y: 3, z: 4 }])
    expect(single.getPoint(0.2).toArray()).toEqual([2, 3, 4])

    const closed = new AcGeCatmullRomCurve3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 }
      ],
      true,
      'catmullrom'
    )
    expect(closed.length).toBeGreaterThan(2)
    closed.setClosed(true) // no-op early return branch
    expect(closed.getPoint(1).toArray()).toHaveLength(3)

    const transformed = closed.transform(
      new AcGeMatrix3d().makeTranslation(1, 2, 3)
    )
    expect(transformed.startPoint.z).toBeCloseTo(3, 8)
    expect(transformed.box.isEmpty()).toBe(false)
  })

  it('covers chordal repeated-point safety, t=1 edge and setters', () => {
    const curve = new AcGeCatmullRomCurve3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      false,
      'chordal'
    )

    // hits non-closed t=1 branch where intPoint/weight are adjusted
    const end = curve.getPoint(1)
    expect(end.toArray()).toHaveLength(3)

    // hits nonuniform dt safety branches with repeated points
    expect(curve.getPoint(0.5).x).toBeGreaterThanOrEqual(0)

    curve.setCurveType('catmullrom')
    curve.setTension(0.25)
    expect(curve.getPoint(0.25).toArray()).toHaveLength(3)

    curve.setPoints([
      { x: -1, y: -2, z: -3 },
      { x: 2, y: 0, z: 1 },
      { x: 4, y: 1, z: 2 }
    ])
    curve.setClosed(false)
    expect(curve.startPoint.x).toBe(-1)
    expect(curve.endPoint.x).toBe(4)
    expect(curve.transform(new AcGeMatrix3d().makeTranslation(1, 0, 0))).toBe(
      curve
    )
  })

  it('covers default constructor and length short-circuit', () => {
    const curve = new AcGeCatmullRomCurve3d()
    expect(curve.points).toHaveLength(0)
    expect(curve.closed).toBe(false)
    expect(curve.curveType).toBe('centripetal')
    expect(curve.tension).toBe(0.5)
    expect(curve.length).toBe(0)
  })

  it('clones curve with deep-copied points', () => {
    const curve = new AcGeCatmullRomCurve3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 }
      ],
      true,
      'catmullrom',
      0.3
    )
    const cloned = curve.clone()

    expect(cloned).not.toBe(curve)
    expect(cloned.closed).toBe(true)
    expect(cloned.curveType).toBe('catmullrom')
    expect(cloned.tension).toBeCloseTo(0.3, 8)

    cloned.points[0].x = 99
    expect(curve.points[0].x).toBe(0)
  })
})

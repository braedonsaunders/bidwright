import {
  AcGeCircArc2d,
  AcGeEllipseArc2d,
  AcGeLine2d,
  AcGeLoop2d,
  AcGeMatrix2d,
  AcGeSpline3d
} from '../src'

describe('AcGeLoop2d', () => {
  it('is closed and computes perimeter', () => {
    const loop = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 2, y: 0 }),
      new AcGeLine2d({ x: 2, y: 0 }, { x: 2, y: 2 }),
      new AcGeLine2d({ x: 2, y: 2 }, { x: 0, y: 2 }),
      new AcGeLine2d({ x: 0, y: 2 }, { x: 0, y: 0 })
    ])

    expect(loop.closed).toBe(true)
    expect(loop.length).toBe(8)
  })

  it('covers build and transform edge branches', () => {
    expect(AcGeLoop2d.buildFromEdges([])).toEqual([])

    const almostClosed = AcGeLoop2d.buildFromEdges(
      [
        new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 }),
        new AcGeLine2d({ x: 5, y: 5 }, { x: 6, y: 6 })
      ],
      1e-6
    )
    expect(almostClosed).toHaveLength(2)

    const lineA = new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 })
    const lineBReverse = new AcGeLine2d({ x: 1, y: 1 }, { x: 1, y: 0 })
    const arcReverse = new AcGeCircArc2d(
      { x: 0.5, y: 1 },
      0.5,
      Math.PI,
      0,
      false
    )
    const ellipseReverse = new AcGeEllipseArc2d(
      { x: 0, y: 0.5 },
      0.5,
      0.25,
      Math.PI / 2,
      -Math.PI / 2,
      false,
      0
    )
    const splineReverse = new AcGeSpline3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0.5, z: 0 },
        { x: 0, y: 1, z: 0 }
      ],
      [0, 0, 0, 1, 1, 1],
      [],
      2,
      false
    )

    const built = AcGeLoop2d.buildFromEdges(
      [lineA, lineBReverse, arcReverse, ellipseReverse, splineReverse],
      2
    )
    expect(built.length).toBeGreaterThan(0)
    expect(built[0].numberOfEdges).toBeGreaterThan(0)

    const loopWithSpline = new AcGeLoop2d([
      lineA,
      new AcGeSpline3d(
        [
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 0.5, z: 0 },
          { x: 0, y: 1, z: 0 }
        ],
        [0, 0, 0, 1, 1, 1],
        [],
        2,
        false
      )
    ])
    expect(
      loopWithSpline.transform(new AcGeMatrix2d().makeTranslation(1, 2))
    ).toBe(loopWithSpline)
  })

  it('throws when accessing start point of empty loop', () => {
    const empty = new AcGeLoop2d()
    expect(() => empty.startPoint).toThrow(
      'Start point does not exist in an empty loop.'
    )
  })

  it('covers reverse-edge helpers for all edge types', () => {
    const reverseEdge = (AcGeLoop2d as unknown as { reverseEdge: Function })
      .reverseEdge

    const line = new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 })
    const reversedLine = reverseEdge(line) as AcGeLine2d
    expect(reversedLine.startPoint.x).toBeCloseTo(1, 8)

    const arc = new AcGeCircArc2d({ x: 0, y: 0 }, 1, 0, Math.PI / 2, false)
    const reversedArc = reverseEdge(arc) as AcGeCircArc2d
    expect(reversedArc.startAngle).toBeCloseTo(arc.endAngle, 8)

    const ellipse = new AcGeEllipseArc2d(
      { x: 0, y: 0 },
      2,
      1,
      0,
      Math.PI / 2,
      false,
      0.1
    )
    const reversedEllipse = reverseEdge(ellipse) as AcGeEllipseArc2d
    expect(reversedEllipse.startAngle).toBeCloseTo(ellipse.endAngle, 8)

    const splineWithWeights = new AcGeSpline3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 }
      ],
      [0, 0, 0, 1, 1, 1],
      [1, 2, 3],
      2,
      false
    )
    const reversedWeighted = reverseEdge(splineWithWeights) as AcGeSpline3d
    expect(reversedWeighted.controlPoints[0].x).toBeCloseTo(2, 8)
    expect(reversedWeighted.weights[0]).toBe(3)

    const splineNoWeights = new AcGeSpline3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 2, z: 0 }
      ],
      [0, 0, 0, 1, 1, 1],
      [],
      2,
      false
    )
    Object.defineProperty(splineNoWeights, 'weights', {
      get: () => []
    })
    const reversedNoWeights = reverseEdge(splineNoWeights) as AcGeSpline3d
    expect(reversedNoWeights.weights.length).toBeGreaterThan(0)
  })

  it('clones loop with independent edge instances', () => {
    const loop = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 2, y: 0 }),
      new AcGeLine2d({ x: 2, y: 0 }, { x: 2, y: 2 })
    ])

    const cloned = loop.clone()
    expect(cloned).not.toBe(loop)
    expect(cloned.curves.length).toBe(loop.curves.length)

    cloned.transform(new AcGeMatrix2d().makeTranslation(3, 0))
    expect(loop.startPoint.x).toBeCloseTo(0, 8)
  })
})

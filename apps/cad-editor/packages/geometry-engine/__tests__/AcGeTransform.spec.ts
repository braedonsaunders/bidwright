import {
  AcGeArea2d,
  AcGeCatmullRomCurve3d,
  AcGeCircArc2d,
  AcGeCircArc3d,
  AcGeEllipseArc2d,
  AcGeEllipseArc3d,
  AcGeLine2d,
  AcGeLine3d,
  AcGeLoop2d,
  AcGeMatrix2d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePolyline2d,
  AcGeSpline3d,
  AcGeVector3d
} from '../src'

const expectPoint2dClose = (
  actual: { x: number; y: number },
  expected: { x: number; y: number }
) => {
  expect(actual.x).toBeCloseTo(expected.x, 8)
  expect(actual.y).toBeCloseTo(expected.y, 8)
}

const expectPoint3dClose = (
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number }
) => {
  expect(actual.x).toBeCloseTo(expected.x, 8)
  expect(actual.y).toBeCloseTo(expected.y, 8)
  expect(actual.z).toBeCloseTo(expected.z, 8)
}

const transformPoint2d = (
  point: { x: number; y: number },
  matrix: AcGeMatrix2d
) => new AcGePoint2d(point).applyMatrix2d(matrix)

const transformPoint3d = (
  point: { x: number; y: number; z: number },
  matrix: AcGeMatrix3d
) => new AcGePoint3d(point).applyMatrix4(matrix)

describe('Geometry transform regression', () => {
  it('keeps line geometry aligned across common matrix families', () => {
    const line2dCases = [
      {
        name: 'translation',
        matrix: new AcGeMatrix2d().makeTranslation(3, -2)
      },
      {
        name: 'rotation',
        matrix: new AcGeMatrix2d().makeRotation(Math.PI / 2)
      },
      {
        name: 'mirror',
        matrix: new AcGeMatrix2d().makeScale(-1, 1)
      },
      {
        name: 'non-uniform-scale',
        matrix: new AcGeMatrix2d().makeScale(2, 3)
      }
    ]
    const line3dCases = [
      {
        name: 'translation',
        matrix: new AcGeMatrix3d().makeTranslation(3, -2, 5)
      },
      {
        name: 'rotation',
        matrix: new AcGeMatrix3d().makeRotationZ(Math.PI / 2)
      },
      {
        name: 'mirror',
        matrix: new AcGeMatrix3d().makeScale(-1, 1, 1)
      },
      {
        name: 'non-uniform-scale',
        matrix: new AcGeMatrix3d().makeScale(2, 3, 4)
      }
    ]

    line2dCases.forEach(({ matrix }) => {
      const start = { x: 1, y: 2 }
      const end = { x: 4, y: -1 }
      const line = new AcGeLine2d(start, end)

      line.transform(matrix)

      expectPoint2dClose(line.startPoint, transformPoint2d(start, matrix))
      expectPoint2dClose(line.endPoint, transformPoint2d(end, matrix))
    })

    line3dCases.forEach(({ matrix }) => {
      const start = { x: 1, y: 2, z: 3 }
      const end = { x: 4, y: -1, z: 2 }
      const line = new AcGeLine3d(start, end)

      line.transform(matrix)

      expectPoint3dClose(line.startPoint, transformPoint3d(start, matrix))
      expectPoint3dClose(line.endPoint, transformPoint3d(end, matrix))
    })
  })

  it('transforms 2d and 3d lines directly', () => {
    const line2d = new AcGeLine2d({ x: 0, y: 0 }, { x: 2, y: 1 })
    const line3d = new AcGeLine3d(
      new AcGePoint3d(1, 2, 3),
      new AcGePoint3d(4, 5, 6)
    )

    line2d.transform(new AcGeMatrix2d().makeTranslation(3, -4))
    line3d.transform(new AcGeMatrix3d().makeTranslation(-1, 2, -3))

    expectPoint2dClose(line2d.startPoint, { x: 3, y: -4 })
    expectPoint2dClose(line2d.endPoint, { x: 5, y: -3 })
    expectPoint3dClose(line3d.startPoint, { x: 0, y: 4, z: 0 })
    expectPoint3dClose(line3d.endPoint, { x: 3, y: 7, z: 3 })
  })

  it('transforms 2d circular arcs and flips orientation on mirror', () => {
    const arc = new AcGeCircArc2d({ x: 0, y: 0 }, 2, 0, Math.PI / 2, false)
    arc.transform(new AcGeMatrix2d().makeScale(1, -1))

    expectPoint2dClose(arc.center, { x: 0, y: 0 })
    expect(arc.radius).toBeCloseTo(2, 8)
    expect(arc.clockwise).toBe(true)
    expectPoint2dClose(arc.startPoint, { x: 2, y: 0 })
    expectPoint2dClose(arc.endPoint, { x: 0, y: -2 })
  })

  it('transforms 2d ellipse arcs with rotation', () => {
    const ellipse = new AcGeEllipseArc2d({ x: 0, y: 0 }, 4, 2, 0, Math.PI / 2)
    ellipse.transform(new AcGeMatrix2d().makeRotation(Math.PI / 2))

    expectPoint2dClose(ellipse.center, { x: 0, y: 0 })
    expect(ellipse.rotation).toBeCloseTo(Math.PI / 2, 8)
    expectPoint2dClose(ellipse.startPoint, { x: 0, y: 4 })
    expectPoint2dClose(ellipse.endPoint, { x: -2, y: 0 })
  })

  it('transforms 2d polylines and mirrored bulges', () => {
    const polyline = new AcGePolyline2d([
      { x: 0, y: 0, bulge: 1 },
      { x: 2, y: 0 }
    ])

    polyline.transform(new AcGeMatrix2d().makeScale(1, -1))

    expectPoint2dClose(polyline.getPointAt(0), { x: 0, y: 0 })
    expectPoint2dClose(polyline.getPointAt(1), { x: 2, y: 0 })
    expect(polyline.vertices[0].bulge).toBe(-1)
  })

  it('keeps polyline vertices consistent across translation rotation and mirror', () => {
    const cases = [
      {
        matrix: new AcGeMatrix2d().makeTranslation(5, 6),
        expectedBulge: 1
      },
      {
        matrix: new AcGeMatrix2d().makeRotation(Math.PI / 2),
        expectedBulge: 1
      },
      {
        matrix: new AcGeMatrix2d().makeScale(-1, 1),
        expectedBulge: -1
      }
    ]

    cases.forEach(({ matrix, expectedBulge }) => {
      const vertices = [
        { x: 0, y: 0, bulge: 1 },
        { x: 2, y: 1 }
      ]
      const polyline = new AcGePolyline2d(
        vertices.map(vertex => ({ ...vertex }))
      )

      polyline.transform(matrix)

      expectPoint2dClose(
        polyline.getPointAt(0),
        transformPoint2d(vertices[0], matrix)
      )
      expectPoint2dClose(
        polyline.getPointAt(1),
        transformPoint2d(vertices[1], matrix)
      )
      expect(polyline.vertices[0].bulge).toBe(expectedBulge)
    })
  })

  it('transforms loops and areas through child curves', () => {
    const loop = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 }),
      new AcGeLine2d({ x: 1, y: 0 }, { x: 1, y: 1 }),
      new AcGeLine2d({ x: 1, y: 1 }, { x: 0, y: 1 }),
      new AcGeLine2d({ x: 0, y: 1 }, { x: 0, y: 0 })
    ])
    const area = new AcGeArea2d()
    area.add(
      new AcGePolyline2d(
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 }
        ],
        true
      )
    )

    loop.transform(new AcGeMatrix2d().makeTranslation(3, 4))
    area.transform(new AcGeMatrix2d().makeScale(2, 2))

    expectPoint2dClose(loop.startPoint, { x: 3, y: 4 })
    expect(area.area).toBeCloseTo(4, 8)
  })

  it('transforms 3d circular arcs using transformed points instead of origin-relative vectors', () => {
    const arc = new AcGeCircArc3d(
      new AcGePoint3d(5, 5, 0),
      2,
      0,
      Math.PI / 2,
      AcGeVector3d.Z_AXIS
    )

    arc.transform(new AcGeMatrix3d().makeTranslation(3, -1, 2))

    expectPoint3dClose(arc.center, { x: 8, y: 4, z: 2 })
    expectPoint3dClose(arc.startPoint, { x: 10, y: 4, z: 2 })
    expectPoint3dClose(arc.endPoint, { x: 8, y: 6, z: 2 })
  })

  it('transforms mirrored 3d circular arcs and updates the plane normal', () => {
    const arc = new AcGeCircArc3d(
      new AcGePoint3d(0, 0, 0),
      2,
      0,
      Math.PI / 2,
      AcGeVector3d.Z_AXIS
    )

    arc.transform(new AcGeMatrix3d().makeScale(-1, 1, 1))

    expectPoint3dClose(arc.center, { x: 0, y: 0, z: 0 })
    expectPoint3dClose(arc.startPoint, { x: -2, y: 0, z: 0 })
    expectPoint3dClose(arc.endPoint, { x: 0, y: 2, z: 0 })
    expect(Math.abs(arc.normal.z)).toBeCloseTo(1, 8)
  })

  it('transforms 3d ellipse arcs and preserves endpoints', () => {
    const ellipse = new AcGeEllipseArc3d(
      new AcGePoint3d(1, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      4,
      2,
      0,
      Math.PI / 2
    )
    const matrix = new AcGeMatrix3d().makeTranslation(2, 3, 4)

    ellipse.transform(matrix)

    expectPoint3dClose(ellipse.center, { x: 3, y: 3, z: 4 })
    expectPoint3dClose(ellipse.startPoint, { x: 7, y: 3, z: 4 })
    expectPoint3dClose(ellipse.endPoint, { x: 3, y: 5, z: 4 })
  })

  it('transforms 3d ellipse arcs under non-uniform scaling', () => {
    const ellipse = new AcGeEllipseArc3d(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      2,
      1,
      0,
      Math.PI / 2
    )

    ellipse.transform(new AcGeMatrix3d().makeScale(3, 4, 1))

    expect(ellipse.majorAxisRadius).toBeCloseTo(6, 8)
    expect(ellipse.minorAxisRadius).toBeCloseTo(4, 8)
    expectPoint3dClose(ellipse.startPoint, { x: 6, y: 0, z: 0 })
    expectPoint3dClose(ellipse.endPoint, { x: 0, y: 4, z: 0 })
  })

  it('transforms splines built from control points and fit points', () => {
    const controlSpline = new AcGeSpline3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ],
      [0, 0, 0, 0, 1, 1, 1, 1]
    )
    const fitSpline = new AcGeSpline3d(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ],
      'Uniform'
    )
    const matrix = new AcGeMatrix3d().makeTranslation(10, -2, 5)

    controlSpline.transform(matrix)
    fitSpline.transform(matrix)

    expectPoint3dClose(controlSpline.startPoint, { x: 10, y: -2, z: 5 })
    expectPoint3dClose(controlSpline.endPoint, { x: 13, y: -1, z: 5 })
    expectPoint3dClose(fitSpline.startPoint, { x: 10, y: -2, z: 5 })
    expectPoint3dClose(fitSpline.endPoint, { x: 13, y: -1, z: 5 })
  })

  it('transforms catmull-rom curves by moving their control points', () => {
    const curve = new AcGeCatmullRomCurve3d([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 2, z: 0 },
      { x: 3, y: 2, z: 1 },
      { x: 4, y: 0, z: 1 }
    ])

    curve.transform(new AcGeMatrix3d().makeTranslation(2, -3, 4))

    expectPoint3dClose(curve.startPoint, { x: 2, y: -3, z: 4 })
    expectPoint3dClose(curve.endPoint, { x: 6, y: -3, z: 5 })
    expectPoint3dClose(curve.points[1], { x: 3, y: -1, z: 4 })
  })
})

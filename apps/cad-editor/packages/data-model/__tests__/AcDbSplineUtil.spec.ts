import { AcGeSpline3d } from '@mlightcad/geometry-engine'

import { AcDbSpline } from '../src/entity/AcDbSpline'

describe('AcDbSpline factory methods', () => {
  it('derives degree from knot and control point counts when declared degree is zero', () => {
    const geo = AcGeSpline3d.fromControlPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ],
      [0, 0, 0, 0, 1, 1, 1, 1],
      undefined,
      0,
      false
    )

    expect(geo).not.toBeNull()
    expect(geo!.degree).toBe(3)
  })

  it('clamps declared degree to available control points', () => {
    const geo = AcGeSpline3d.fromControlPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      [0, 0, 0, 0, 1, 1, 1, 1],
      undefined,
      5,
      false
    )

    expect(geo).not.toBeNull()
    expect(geo!.degree).toBe(1)
  })

  it('clamps fit-point degree using tangent constraints', () => {
    const withTangents = AcGeSpline3d.fromFitPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
      ],
      'Uniform',
      3,
      false,
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    )
    const withoutTangents = AcGeSpline3d.fromFitPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
      ],
      'Uniform',
      3,
      false
    )

    expect(withTangents).not.toBeNull()
    expect(withTangents!.degree).toBe(3)
    expect(withoutTangents).not.toBeNull()
    expect(withoutTangents!.degree).toBe(1)
  })

  it('creates control-point splines with mismatched declared degree', () => {
    const spline = AcDbSpline.fromControlPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ],
      [0, 0, 0, 0, 1, 1, 1, 1],
      undefined,
      0,
      false
    )

    expect(spline).not.toBeNull()
    expect(spline!.geometricExtents.isEmpty()).toBe(false)
  })

  it('creates fit-point splines with start/end tangents and only two fit points', () => {
    const spline = AcDbSpline.fromFitPoints(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 }
      ],
      'Uniform',
      3,
      false,
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 }
    )

    expect(spline).not.toBeNull()
    expect(spline!.geometricExtents.max.x).toBeGreaterThan(0)
  })

  it('falls back from invalid control points to valid fit points', () => {
    const spline = AcDbSpline.fromDwgSpline({
      flag: 0,
      degree: 3,
      numberOfControlPoints: 2,
      numberOfKnots: 8,
      numberOfFitPoints: 4,
      controlPoints: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 }
      ],
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      fitPoints: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
    })

    expect(spline).not.toBeNull()
  })
})

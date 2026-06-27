import { AcCmErrors } from '@mlightcad/common'
import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import type { AcGeKnotParameterizationType } from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbSpline, AcDbPolyline } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbSpline', () => {
  const controlPoints = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 2, y: -1, z: 0 },
    { x: 3, y: 0, z: 0 }
  ]
  const knots = [0, 0, 0, 0, 1, 1, 1, 1]
  let db: AcDbDatabase

  beforeAll(() => {
    db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db
  })

  it('exposes static and DXF type names', () => {
    const spline = new AcDbSpline(controlPoints, knots)

    expect(AcDbSpline.typeName).toBe('Spline')
    expect(spline.dxfTypeName).toBe('SPLINE')
  })

  it('supports control-point constructor with geometric extents and closed setter', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const extents = spline.geometricExtents

    expect(extents.min.x).toBeLessThanOrEqual(0)
    expect(extents.max.x).toBeGreaterThanOrEqual(3)

    spline.closed = true
    expect(spline.closed).toBe(true)
  })

  it('updates geometricExtents when control points are rebuilt', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const beforeMaxX = spline.geometricExtents.max.x

    spline.rebuild(
      [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 10, y: 5, z: 0 },
        { x: 0, y: 5, z: 0 }
      ],
      knots
    )

    expect(spline.geometricExtents.max.x).toBeGreaterThan(beforeMaxX)
    expect(spline.geometricExtents.max.y).toBeGreaterThan(2)
  })

  it('supports fit-point constructor and rebuild overloads', () => {
    const fitPoints = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0.5, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0.5, z: 0 }
    ]
    const spline = new AcDbSpline(
      fitPoints,
      0 as unknown as AcGeKnotParameterizationType
    )

    spline.rebuild(controlPoints, knots, [1, 2, 3, 4], 3, true)
    expect(spline.closed).toBe(true)

    spline.rebuild(
      fitPoints,
      0 as unknown as AcGeKnotParameterizationType,
      3,
      false
    )
    expect(spline.closed).toBe(false)
  })

  it('throws illegal parameters for invalid rebuild argument count', () => {
    const spline = new AcDbSpline(controlPoints, knots)

    expect(() =>
      (spline as unknown as { rebuild: (...args: unknown[]) => void }).rebuild()
    ).toThrow(AcCmErrors.ILLEGAL_PARAMETERS)
    expect(() =>
      (spline as unknown as { rebuild: (...args: unknown[]) => void }).rebuild(
        [],
        [],
        [],
        3,
        false,
        'extra'
      )
    ).toThrow(AcCmErrors.ILLEGAL_PARAMETERS)
  })

  it('returns endpoint osnap points and ignores unsupported osnap mode', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const endpointSnaps: AcGePoint3d[] = []
    const unsupportedSnaps: AcGePoint3d[] = []

    spline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endpointSnaps
    )
    spline.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      unsupportedSnaps
    )

    expect(endpointSnaps).toHaveLength(2)
    expect(endpointSnaps[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(endpointSnaps[1]).toMatchObject({ x: 3, y: 0, z: 0 })
    expect(unsupportedSnaps).toHaveLength(0)
  })

  it('returns nearest osnap point on the spline curve', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const nearestPoints: AcGePoint3d[] = []

    spline.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(1.5, 2, 0),
      new AcGePoint3d(),
      nearestPoints
    )

    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0].x).toBeGreaterThanOrEqual(0)
    expect(nearestPoints[0].x).toBeLessThanOrEqual(3)
  })

  it('returns control vertices as grip points for control-point splines', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const grips = spline.subGetGripPoints()
    expect(grips).toHaveLength(4)
    expect(grips[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(grips[3]).toMatchObject({ x: 3, y: 0, z: 0 })
  })

  it('uses control vertices rather than derived fit data for CV splines', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const grips = spline.subGetGripPoints()

    expect(grips).toHaveLength(controlPoints.length)
    grips.forEach((grip, index) => {
      expect(grip).toMatchObject(controlPoints[index])
    })
  })

  it('moves control vertices via subMoveGripPointsAt and updates the curve', () => {
    const spline = new AcDbSpline(controlPoints, knots)

    const endBefore: AcGePoint3d[] = []
    spline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endBefore
    )

    spline.subMoveGripPointsAt([3], new AcGeVector3d(0, 2, 0))

    const endAfter: AcGePoint3d[] = []
    spline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endAfter
    )

    expect(spline.subGetGripPoints()[3]).toMatchObject({ x: 3, y: 2, z: 0 })
    expect(endAfter[1].y).toBeGreaterThan(endBefore[1].y)
  })

  it('returns fit points as grip points for fit-point splines', () => {
    const fitPoints = [
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(3, 4, 0),
      new AcGePoint3d(7, 4, 0),
      new AcGePoint3d(10, 0, 0)
    ]
    const spline = new AcDbSpline(
      fitPoints,
      'Uniform' as AcGeKnotParameterizationType
    )
    const grips = spline.subGetGripPoints()

    expect(grips).toHaveLength(fitPoints.length)
    grips.forEach((grip, index) => {
      expect(grip).toMatchObject({
        x: fitPoints[index].x,
        y: fitPoints[index].y,
        z: fitPoints[index].z
      })
    })
  })

  it('moves fit points via subMoveGripPointsAt and updates the curve', () => {
    const fitPoints = [
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(3, 4, 0),
      new AcGePoint3d(7, 4, 0),
      new AcGePoint3d(10, 0, 0)
    ]
    const spline = new AcDbSpline(
      fitPoints,
      'Uniform' as AcGeKnotParameterizationType
    )

    spline.subMoveGripPointsAt([1], new AcGeVector3d(0, 3, 0))

    expect(spline.subGetGripPoints()[1]).toMatchObject({ x: 3, y: 7, z: 0 })
    expect(spline.subGetGripPoints()).toHaveLength(fitPoints.length)
  })

  it('transforms by matrix and returns itself', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const before: AcGePoint3d[] = []
    const after: AcGePoint3d[] = []

    spline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      before
    )

    const result = spline.transformBy(
      new AcGeMatrix3d().makeTranslation(2, -1, 5)
    )

    spline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      after
    )

    expect(result).toBe(spline)
    expect(after[0]).toMatchObject({
      x: before[0].x + 2,
      y: before[0].y - 1,
      z: before[0].z + 5
    })
    expect(after[1]).toMatchObject({
      x: before[1].x + 2,
      y: before[1].y - 1,
      z: before[1].z + 5
    })
  })

  it('delegates drawing to renderer.lines with sampled points', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const rendered = { id: 'entity' }
    const renderer = {
      lines: jest.fn(() => rendered)
    } as unknown as AcGiRenderer

    const result = spline.subWorldDraw(renderer)

    expect(result).toBe(rendered)
    expect(
      (renderer as unknown as { lines: jest.Mock }).lines
    ).toHaveBeenCalledTimes(1)
    expect(
      (renderer as unknown as { lines: jest.Mock }).lines.mock.calls[0][0]
    ).toHaveLength(100)
  })

  it('writes spline-specific DXF fields for control points', () => {
    const spline = new AcDbSpline(
      controlPoints,
      knots,
      [1, 1.5, 2, 2.5],
      3,
      true
    )
    const filer = new AcDbDxfFiler()
    db.tables.blockTable.modelSpace.appendEntity(spline)

    const result = spline.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(spline)
    expect(dxf).toContain('100\nAcDbSpline\n')
    expect(dxf).toContain('70\n1\n')
    expect(dxf).toContain('71\n3\n')
    expect(dxf).toContain('72\n8\n')
    expect(dxf).toContain('73\n4\n')
    expect(dxf).toContain('74\n0\n')
    expect(dxf).toContain('40\n0\n')
    expect(dxf).toContain('41\n1.5\n')
    expect(dxf).toContain('10\n0\n20\n0\n30\n0\n')
  })

  it('writes fit points in DXF when underlying geometry exposes them', () => {
    const spline = new AcDbSpline(controlPoints, knots)
    const filer = new AcDbDxfFiler()
    db.tables.blockTable.modelSpace.appendEntity(spline)
    ;(spline as unknown as { _geo: unknown })._geo = {
      degree: 3,
      knots: [0, 0, 0, 0, 1, 1, 1, 1],
      weights: [1, 1, 1, 1],
      controlPoints,
      fitPoints: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 }
      ],
      closed: false
    }

    spline.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain('74\n2\n')
    expect(dxf).toContain('11\n0\n21\n0\n31\n0\n')
    expect(dxf).toContain('11\n1\n21\n1\n31\n0\n')
  })
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDbSpline(
          [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
            { x: 2, y: 0, z: 0 },
            { x: 3, y: 0, z: 0 }
          ],
          [0, 0, 0, 0, 1, 1, 1, 1]
        )
    )
  })

  it('offsets a control-point spline as a sampled polyline', () => {
    const spline = new AcDbSpline(
      [
        new AcGePoint3d(0, 0, 0),
        new AcGePoint3d(1, 1, 0),
        new AcGePoint3d(2, -1, 0),
        new AcGePoint3d(3, 0, 0)
      ],
      [0, 0, 0, 0, 1, 1, 1, 1]
    )
    expect(spline.getOffsetCurves(1).length).toBeGreaterThan(0)
  })

  it('offsets a tight spline without self-intersecting loops', () => {
    const spline = new AcDbSpline(
      [
        new AcGePoint3d(0, 0, 0),
        new AcGePoint3d(10, 8, 0),
        new AcGePoint3d(20, -8, 0),
        new AcGePoint3d(30, 8, 0),
        new AcGePoint3d(40, 0, 0)
      ],
      [0, 0, 0, 0, 0.5, 1, 1, 1, 1]
    )
    const [result] = spline.getOffsetCurves(2) as AcDbPolyline[]
    expect(result).toBeDefined()
    const points = Array.from({ length: result.numberOfVertices }, (_, i) =>
      result.getPoint2dAt(i)
    )
    const hasCrossing = (() => {
      for (let i = 0; i < points.length - 1; i++) {
        const a0 = points[i]
        const a1 = points[i + 1]
        for (let j = i + 2; j < points.length - 1; j++) {
          const b0 = points[j]
          const b1 = points[j + 1]
          const dx1 = a1.x - a0.x
          const dy1 = a1.y - a0.y
          const dx2 = b1.x - b0.x
          const dy2 = b1.y - b0.y
          const det = dx1 * dy2 - dy1 * dx2
          if (Math.abs(det) <= 1e-9) continue
          const qpx = b0.x - a0.x
          const qpy = b0.y - a0.y
          const t = (qpx * dy2 - qpy * dx2) / det
          const u = (qpx * dy1 - qpy * dx1) / det
          if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true
        }
      }
      return false
    })()
    expect(hasCrossing).toBe(false)
  })
})
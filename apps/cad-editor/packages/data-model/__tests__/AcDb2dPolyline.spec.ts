import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../src/base'
import { AcDb2dPolyline, AcDbPoly2dType, AcDbPolyline } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'
import {
  attachEntityToNewModelSpace,
  getDxfGroupValues
} from '../test-utils/entityTestUtils'

describe('AcDb2dPolyline', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, []))
  })

  it('covers constructor behavior, basic getters and setters', () => {
    const polyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 3, z: 0 }
      ],
      5,
      true,
      0,
      0,
      [0.5]
    )

    expect(polyline.dxfTypeName).toBe('POLYLINE')
    expect(polyline.numberOfVertices).toBe(2)
    expect(polyline.polyType).toBe(AcDbPoly2dType.SimplePoly)
    expect(polyline.elevation).toBe(5)
    expect(polyline.closed).toBe(true)
    expect(polyline.getPointAt(1)).toEqual({ x: 2, y: 3 })
    expect(polyline.getBulgeAt(0)).toBe(0)

    polyline.polyType = AcDbPoly2dType.CubicSplinePoly
    polyline.elevation = 9
    polyline.closed = false
    expect(polyline.polyType).toBe(AcDbPoly2dType.CubicSplinePoly)
    expect(polyline.elevation).toBe(9)
    expect(polyline.closed).toBe(false)
  })

  it('gets bulges and falls back to 0 when missing/out of range', () => {
    const polyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: 0, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 }
      ],
      0,
      false,
      0,
      0,
      [0.25, -0.5]
    )

    expect(polyline.getBulgeAt(0)).toBe(0.25)
    expect(polyline.getBulgeAt(1)).toBe(-0.5)
    expect(polyline.getBulgeAt(9)).toBe(0)

    const noBulgePolyline = new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, [
      { x: 0, y: 0, z: 0 }
    ])
    expect(noBulgePolyline.getBulgeAt(0)).toBe(0)
  })

  it('returns geometric extents with elevation', () => {
    const polyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: -1, y: 2, z: 0 },
        { x: 3, y: -4, z: 0 }
      ],
      7
    )

    const ext = polyline.geometricExtents
    expect(ext.min).toMatchObject({ x: -1, y: -4, z: 7 })
    expect(ext.max).toMatchObject({ x: 3, y: 2, z: 7 })
  })

  it('updates geometricExtents when elevation changes', () => {
    const polyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 3, z: 0 }
      ],
      1
    )

    expect(polyline.geometricExtents.min.z).toBe(1)

    polyline.elevation = 9

    expect(polyline.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 9 })
    expect(polyline.geometricExtents.max).toMatchObject({ x: 4, y: 3, z: 9 })
  })

  it('returns grip points and osnap points for supported modes', () => {
    const polyline = new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 }
    ])

    const gripPoints = polyline.subGetGripPoints()
    expect(gripPoints).toHaveLength(3)
    expect(gripPoints[0]).toEqual(new AcGePoint3d(0, 0, 0))

    const endpointSnaps: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endpointSnaps
    )
    expect(endpointSnaps).toHaveLength(3)

    const midPoints: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(2)
    expect(midPoints[0]).toMatchObject({ x: 1, y: 0, z: 0 })
    expect(midPoints[1]).toMatchObject({ x: 2, y: 1, z: 0 })

    const nearestPoints: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toMatchObject({ x: 1, y: 0, z: 0 })

    const perpendicularPoints: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 1, y: 0, z: 0 })

    const unsupportedPoints: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      unsupportedPoints
    )
    expect(unsupportedPoints).toHaveLength(0)
  })

  it('returns grip points at polyline elevation', () => {
    const polyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 }
      ],
      5
    )
    const grips = polyline.subGetGripPoints()
    expect(grips).toHaveLength(2)
    expect(grips[0]).toMatchObject({ x: 0, y: 0, z: 5 })
    expect(grips[1]).toMatchObject({ x: 2, y: 0, z: 5 })
  })

  it('transforms geometry and flips bulges for mirrored transform', () => {
    const polyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: 1, y: 2, z: 0 },
        { x: 3, y: 4, z: 0 }
      ],
      3,
      false,
      0,
      0,
      [0.25, -0.5]
    )

    const result = polyline.transformBy(new AcGeMatrix3d().makeScale(-1, 1, 1))
    expect(result).toBe(polyline)
    expect(polyline.getPointAt(0)).toEqual({ x: -1, y: 2 })
    expect(polyline.getBulgeAt(0)).toBe(-0.25)
    expect(polyline.getBulgeAt(1)).toBe(0.5)

    polyline.transformBy(new AcGeMatrix3d().makeTranslation(0, 0, 5))
    expect(polyline.elevation).toBe(8)
  })

  it('exposes properties groups and property accessors', () => {
    const polyline = new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 }
    ])

    const props = polyline.properties
    expect(props.type).toBe(polyline.type)

    const geometryGroup = props.groups.find(g => g.groupName === 'geometry')
    const othersGroup = props.groups.find(g => g.groupName === 'others')
    expect(geometryGroup).toBeDefined()
    expect(othersGroup).toBeDefined()

    const verticesProp = geometryGroup!.properties.find(
      p => p.name === 'vertices'
    )
    const elevationProp = geometryGroup!.properties.find(
      p => p.name === 'elevation'
    )
    const lengthProp = geometryGroup!.properties.find(p => p.name === 'length')
    const closedProp = othersGroup!.properties.find(p => p.name === 'closed')

    expect((verticesProp?.accessor.get() as unknown[]).length).toBe(2)
    expect(lengthProp?.accessor.get()).toBe(5)

    elevationProp?.accessor.set?.(11)
    expect(elevationProp?.accessor.get()).toBe(11)

    closedProp?.accessor.set?.(true)
    expect(closedProp?.accessor.get()).toBe(true)
  })

  it('draws through subWorldDraw using sampled points at current elevation', () => {
    const polyline = new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 }
    ])
    polyline.elevation = 6

    const renderer = {
      lines: jest.fn(() => 'rendered')
    }

    const result = polyline.subWorldDraw(renderer as never)
    expect(result).toBe('rendered')
    expect(renderer.lines).toHaveBeenCalledTimes(1)
    const [points] = renderer.lines.mock.calls[0] as unknown as [AcGePoint3d[]]
    expect(points.length).toBeGreaterThan(1)
    expect(points.every(p => p.z === 6)).toBe(true)
  })

  it('writes dxf fields with expected flags and vertex-follow marker', () => {
    const cases = [
      {
        polyline: new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, [
          { x: 0, y: 0, z: 0 }
        ]),
        expected66: 1,
        expectedFlag: 0
      },
      {
        polyline: new AcDb2dPolyline(AcDbPoly2dType.FitCurvePoly, []),
        expected66: 0,
        expectedFlag: 2
      },
      {
        polyline: new AcDb2dPolyline(AcDbPoly2dType.QuadSplinePoly, [
          { x: 0, y: 0, z: 0 }
        ]),
        expected66: 1,
        expectedFlag: 4
      },
      {
        polyline: new AcDb2dPolyline(AcDbPoly2dType.CubicSplinePoly, [
          { x: 0, y: 0, z: 0 }
        ]),
        expected66: 1,
        expectedFlag: 9,
        closed: true,
        elevation: 12
      }
    ]

    cases.forEach(
      ({ polyline, expected66, expectedFlag, closed, elevation }) => {
        if (closed != null) polyline.closed = closed
        if (elevation != null) polyline.elevation = elevation
        attachEntityToNewModelSpace(polyline)
        const filer = new AcDbDxfFiler()
        polyline.dxfOutFields(filer)
        const out = filer.toString()

        expect(getDxfGroupValues(out, 100)).toContain('AcDb2dPolyline')
        expect(getDxfGroupValues(out, 66)).toContain(String(expected66))
        expect(getDxfGroupValues(out, 70)).toContain(String(expectedFlag))
        if (elevation != null) {
          expect(getDxfGroupValues(out, 30)).toContain(String(elevation))
        }
      }
    )
  })

  it('writes full dxf records including VERTEX and SEQEND records', () => {
    const polyline = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 }
      ],
      3,
      false,
      0,
      0,
      [0.5, 0]
    )
    attachEntityToNewModelSpace(polyline)

    const filer = new AcDbDxfFiler()
    const result = polyline.dxfOut(filer)
    expect(result).toBe(polyline)

    const out = filer.toString()
    const vertexRecords = out.match(/\n0\nVERTEX\n/g) ?? []
    expect(vertexRecords.length).toBe(2)
    expect(out).toContain('\n0\nSEQEND\n')
    expect(out).toContain('\n100\nAcDb2dVertex\n')
    expect(out).toContain('\n42\n0.5\n')
    expect(out).toContain('\n30\n3\n')
  })

  it('offsets a simple 2d polyline path', () => {
    const poly = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [new AcGePoint3d(0, 0, 0), new AcGePoint3d(10, 0, 0)],
      0,
      false
    )
    const [result] = poly.getOffsetCurves(1) as AcDbPolyline[]
    expect(result.numberOfVertices).toBeGreaterThanOrEqual(2)
  })

  it('offsets a 2d polyline path that contains bulge arcs', () => {
    const poly = new AcDb2dPolyline(
      AcDbPoly2dType.SimplePoly,
      [new AcGePoint3d(0, 0, 0), new AcGePoint3d(10, 0, 0)],
      0,
      false,
      0,
      0,
      [1, 0]
    )
    const [result] = poly.getOffsetCurves(1) as AcDbPolyline[]
    let minY = Infinity
    for (let i = 0; i < result.numberOfVertices; i++) {
      minY = Math.min(minY, result.getPoint2dAt(i).y)
    }
    expect(minY).toBeLessThan(-5)
  })
})

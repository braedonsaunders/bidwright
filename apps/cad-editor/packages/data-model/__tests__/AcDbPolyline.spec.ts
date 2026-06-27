import {
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'

import { AcDbDxfFiler, acdbHostApplicationServices } from '../src/base'
import { TEMP_OBJECT_ID_PREFIX } from '../src/base/AcDbObject'
import { AcDbDatabase } from '../src/database'
import { AcDbSystemVariables } from '../src/database/AcDbSystemVariables'
import { AcDbSysVarManager } from '../src/database/AcDbSysVarManager'
import { AcDbPolyline } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'
import {
  attachEntityToNewModelSpace,
  getDxfGroupValues,
  setupWorkingDatabase
} from '../test-utils/entityTestUtils'

describe('AcDbPolyline', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbPolyline())
  })
  it('covers constructor defaults and basic getters/setters', () => {
    const polyline = new AcDbPolyline()

    expect(AcDbPolyline.typeName).toBe('Polyline')
    expect(polyline.dxfTypeName).toBe('LWPOLYLINE')
    expect(polyline.numberOfVertices).toBe(0)
    expect(polyline.elevation).toBe(0)
    expect(polyline.closed).toBe(false)

    polyline.elevation = 8
    polyline.closed = true

    expect(polyline.elevation).toBe(8)
    expect(polyline.closed).toBe(true)
  })

  it('falls back to temporary object id when working database is unavailable', () => {
    const services = acdbHostApplicationServices() as unknown as {
      _workingDatabase: AcDbDatabase | null
    }
    const previousDb = services._workingDatabase
    services._workingDatabase = null

    try {
      const polyline = new AcDbPolyline()
      expect(polyline.objectId.startsWith(TEMP_OBJECT_ID_PREFIX)).toBe(true)
    } finally {
      services._workingDatabase = previousDb
    }
  })

  it('supports add/get/remove/reset vertex operations', () => {
    const polyline = new AcDbPolyline()

    polyline.addVertexAt(0, new AcGePoint2d(1, 2), 0.5, 1.2, 3.4)
    polyline.addVertexAt(1, new AcGePoint2d(4, 5))
    polyline.addVertexAt(1, new AcGePoint2d(9, 7), -0.25)

    expect(polyline.numberOfVertices).toBe(3)
    expect(polyline.getPoint2dAt(0)).toEqual(new AcGePoint2d(1, 2))
    expect(polyline.getPoint2dAt(1)).toEqual(new AcGePoint2d(9, 7))
    expect(polyline.getPoint2dAt(2)).toEqual(new AcGePoint2d(4, 5))

    polyline.removeVertexAt(1)
    expect(polyline.numberOfVertices).toBe(2)
    expect(polyline.getPoint2dAt(1)).toEqual(new AcGePoint2d(4, 5))

    polyline.reset(true, 1)
    expect(polyline.numberOfVertices).toBe(1)

    polyline.reset(false)
    expect(polyline.numberOfVertices).toBe(0)
  })

  it('returns 3d points and geometric extents at current elevation', () => {
    const polyline = new AcDbPolyline()
    polyline.elevation = 6
    polyline.addVertexAt(0, new AcGePoint2d(-1, 2))
    polyline.addVertexAt(1, new AcGePoint2d(3, -4))

    expect(polyline.getPoint3dAt(0)).toEqual(new AcGePoint3d(-1, 2, 6))
    expect(polyline.getPoint3dAt(1)).toEqual(new AcGePoint3d(3, -4, 6))

    const extents = polyline.geometricExtents
    expect(extents.min).toMatchObject({ x: -1, y: -4, z: 6 })
    expect(extents.max).toMatchObject({ x: 3, y: 2, z: 6 })
  })

  it('updates geometricExtents when vertices and elevation change', () => {
    const polyline = new AcDbPolyline()
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))

    expect(polyline.geometricExtents.max).toMatchObject({ x: 2, y: 0, z: 0 })

    polyline.addVertexAt(2, new AcGePoint2d(2, 5))
    polyline.elevation = 3

    expect(polyline.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 3 })
    expect(polyline.geometricExtents.max).toMatchObject({ x: 2, y: 5, z: 3 })
  })

  it('returns grip points and osnap points for supported modes', () => {
    const db = setupWorkingDatabase()
    const manager = AcDbSysVarManager.instance()
    const oldGrips = manager.getVar(AcDbSystemVariables.GRIPS, db)
    manager.setVar(AcDbSystemVariables.GRIPS, 1, db)

    const polyline = new AcDbPolyline()
    polyline.elevation = 2
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))
    polyline.addVertexAt(2, new AcGePoint2d(2, 3))

    const grips = polyline.subGetGripPoints()
    expect(grips).toEqual([
      new AcGePoint3d(0, 0, 2),
      new AcGePoint3d(2, 0, 2),
      new AcGePoint3d(2, 3, 2)
    ])

    const endpointSnaps: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endpointSnaps
    )
    expect(endpointSnaps).toEqual(grips)

    const midPoints: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(2)
    expect(midPoints[0]).toMatchObject({ x: 1, y: 0, z: 2 })

    const nearestPoints: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toMatchObject({ x: 1, y: 0, z: 2 })

    const perpendicularPoints: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 1, y: 0, z: 2 })

    const centerSnaps: AcGePoint3d[] = []
    polyline.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      centerSnaps
    )
    expect(centerSnaps).toHaveLength(0)

    manager.setVar(AcDbSystemVariables.GRIPS, oldGrips as number, db)
  })

  it('returns segment midpoint grips when GRIPS is 2', () => {
    const db = setupWorkingDatabase()
    const manager = AcDbSysVarManager.instance()
    const oldGrips = manager.getVar(AcDbSystemVariables.GRIPS, db)
    manager.setVar(AcDbSystemVariables.GRIPS, 2, db)

    const polyline = new AcDbPolyline()
    polyline.elevation = 2
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))
    polyline.addVertexAt(2, new AcGePoint2d(2, 3))

    const grips = polyline.subGetGripPoints()
    expect(grips).toHaveLength(5)
    expect(grips.slice(0, 3)).toEqual([
      new AcGePoint3d(0, 0, 2),
      new AcGePoint3d(2, 0, 2),
      new AcGePoint3d(2, 3, 2)
    ])
    expect(grips[3]).toMatchObject({ x: 1, y: 0, z: 2 })
    expect(grips[4]).toMatchObject({ x: 2, y: 1.5, z: 2 })

    manager.setVar(AcDbSystemVariables.GRIPS, oldGrips as number, db)
  })

  it('moves segment midpoint grips by translating both segment vertices', () => {
    const db = setupWorkingDatabase()
    const manager = AcDbSysVarManager.instance()
    const oldGrips = manager.getVar(AcDbSystemVariables.GRIPS, db)
    manager.setVar(AcDbSystemVariables.GRIPS, 2, db)

    const polyline = new AcDbPolyline()
    polyline.elevation = 2
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))
    polyline.addVertexAt(2, new AcGePoint2d(2, 3))

    polyline.subMoveGripPointsAt([3], new AcGeVector3d(1, 0, 0))

    expect(polyline.getPoint2dAt(0)).toEqual(new AcGePoint2d(1, 0))
    expect(polyline.getPoint2dAt(1)).toEqual(new AcGePoint2d(3, 0))
    expect(polyline.getPoint2dAt(2)).toEqual(new AcGePoint2d(2, 3))

    manager.setVar(AcDbSystemVariables.GRIPS, oldGrips as number, db)
  })

  it('moves vertex grip points by index', () => {
    const polyline = new AcDbPolyline()
    polyline.elevation = 2
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))
    polyline.addVertexAt(2, new AcGePoint2d(2, 3))

    polyline.subMoveGripPointsAt([1], new AcGeVector3d(1, 2, 0))

    expect(polyline.getPoint2dAt(1)).toEqual(new AcGePoint2d(3, 2))
    expect(polyline.getPoint3dAt(1)).toMatchObject({ x: 3, y: 2, z: 2 })
  })

  it('transforms points, updates elevation and flips bulges for mirrored transforms', () => {
    const polyline = new AcDbPolyline()
    polyline.elevation = 3
    polyline.addVertexAt(0, new AcGePoint2d(1, 2), 0.5)
    polyline.addVertexAt(1, new AcGePoint2d(4, 5), -1)

    expect(
      polyline.transformBy(new AcGeMatrix3d().makeTranslation(10, -2, 4))
    ).toBe(polyline)
    expect(polyline.elevation).toBe(7)
    expect(polyline.getPoint2dAt(0)).toEqual(new AcGePoint2d(11, 0))
    expect(polyline.getPoint2dAt(1)).toEqual(new AcGePoint2d(14, 3))

    const verticesBeforeMirror = polyline.properties.groups
      .find(g => g.groupName === 'geometry')
      ?.properties.find(p => p.name === 'vertices')
      ?.accessor.get() as Array<{ bulge?: number }>
    verticesBeforeMirror[0].bulge = undefined

    polyline.transformBy(new AcGeMatrix3d().makeScale(-1, 1, 1))

    const vertices = polyline.properties.groups
      .find(g => g.groupName === 'geometry')
      ?.properties.find(p => p.name === 'vertices')
      ?.accessor.get() as Array<{ bulge?: number }>

    expect(vertices[0].bulge).toBeUndefined()
    expect(vertices[1].bulge).toBe(1)

    const afterMirrorLength = Number(
      polyline.properties.groups
        .find(g => g.groupName === 'geometry')
        ?.properties.find(p => p.name === 'length')
        ?.accessor.get() ?? 0
    )
    expect(afterMirrorLength).toBeGreaterThan(0)
  })

  it('exposes properties with working accessors', () => {
    const polyline = new AcDbPolyline()
    polyline.addVertexAt(0, new AcGePoint2d(0, 0), 0.25, 2, 3)
    polyline.addVertexAt(1, new AcGePoint2d(3, 4))

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

    const vertices = verticesProp?.accessor.get() as Array<{
      x: number
      y: number
      bulge?: number
      startWidth?: number
      endWidth?: number
    }>

    expect(vertices).toHaveLength(2)
    expect(vertices[0]).toMatchObject({
      x: 0,
      y: 0,
      bulge: 0.25,
      startWidth: 2,
      endWidth: 3
    })
    expect(vertices[1]).toMatchObject({
      x: 3,
      y: 4,
      bulge: 0
    })
    expect(vertices[1].startWidth).toBeUndefined()
    expect(vertices[1].endWidth).toBeUndefined()

    expect(Number(lengthProp?.accessor.get())).toBeGreaterThan(5)

    elevationProp?.accessor.set?.(9)
    closedProp?.accessor.set?.(true)

    expect(elevationProp?.accessor.get()).toBe(9)
    expect(closedProp?.accessor.get()).toBe(true)
  })

  it('draws with sampled points using current elevation', () => {
    const polyline = new AcDbPolyline()
    polyline.elevation = 5
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))

    const giEntity = { id: 'polyline-gi' }
    const renderer = {
      lines: jest.fn(() => giEntity)
    }

    const result = polyline.subWorldDraw(renderer as never)
    expect(result).toBe(giEntity)
    expect(renderer.lines).toHaveBeenCalledTimes(1)

    const [points] = renderer.lines.mock.calls[0] as unknown as [AcGePoint3d[]]
    expect(points.length).toBeGreaterThan(1)
    expect(points.every(point => point.z === 5)).toBe(true)
  })

  it('renders constant-width polyline as filled area', () => {
    const polyline = new AcDbPolyline()
    polyline.elevation = 2
    polyline.closed = true
    polyline.addVertexAt(0, new AcGePoint2d(0, 0), 0, 2, 2)
    polyline.addVertexAt(1, new AcGePoint2d(10, 0), 0, 2, 2)
    polyline.addVertexAt(2, new AcGePoint2d(10, 5), 0, 2, 2)
    polyline.addVertexAt(3, new AcGePoint2d(0, 5), 0, 2, 2)

    const giEntity = { id: 'wide-polyline-gi' }
    const renderer = {
      lines: jest.fn(),
      area: jest.fn(() => giEntity),
      subEntityTraits: {
        fillType: {
          solidFill: false,
          patternAngle: 30,
          definitionLines: [
            {
              angle: 0,
              base: { x: 0, y: 0 },
              offset: { x: 1, y: 0 },
              dashLengths: []
            }
          ]
        }
      }
    }

    const result = polyline.subWorldDraw(renderer as never)
    const areaArg = (renderer.area as jest.Mock).mock.calls[0][0] as {
      area: number
      loops: Array<{
        getPoints: (numPoints: number) => Array<{ x: number; y: number }>
      }>
    }
    const boundaries = areaArg.loops.map(loop => loop.getPoints(4))
    const loopBoxes = boundaries
      .map(points => ({
        minX: Math.min(...points.map(point => point.x)),
        maxX: Math.max(...points.map(point => point.x)),
        minY: Math.min(...points.map(point => point.y)),
        maxY: Math.max(...points.map(point => point.y))
      }))
      .sort(
        (a, b) =>
          (b.maxX - b.minX) * (b.maxY - b.minY) -
          (a.maxX - a.minX) * (a.maxY - a.minY)
      )

    expect(result).toBe(giEntity)
    expect(renderer.area).toHaveBeenCalledTimes(1)
    expect(renderer.lines).not.toHaveBeenCalled()
    expect(areaArg.loops).toHaveLength(2)
    expect(areaArg.area).toBeCloseTo(60, 8)
    expect(loopBoxes[0]).toMatchObject({
      minX: -1,
      maxX: 11,
      minY: -1,
      maxY: 6
    })
    expect(loopBoxes[1]).toMatchObject({
      minX: 1,
      maxX: 9,
      minY: 1,
      maxY: 4
    })
    expect(renderer.subEntityTraits.fillType).toMatchObject({
      solidFill: true,
      patternAngle: 0
    })
    expect(
      (renderer.subEntityTraits.fillType as { isHatchFill?: boolean })
        .isHatchFill
    ).toBeUndefined()
  })

  it('renders variable-width polyline as filled area', () => {
    const polyline = new AcDbPolyline()
    polyline.elevation = 0
    polyline.addVertexAt(0, new AcGePoint2d(0, 0), 0, 1, 6)
    polyline.addVertexAt(1, new AcGePoint2d(20, 0), 0, 6, 2)
    polyline.addVertexAt(2, new AcGePoint2d(25, 8), 0, 2, 2)

    const giEntity = { id: 'variable-width-polyline-gi' }
    const renderer = {
      lines: jest.fn(),
      area: jest.fn(() => giEntity),
      subEntityTraits: {
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        }
      }
    }

    const result = polyline.subWorldDraw(renderer as never)
    expect(result).toBe(giEntity)
    expect(renderer.area).toHaveBeenCalledTimes(1)
    expect(renderer.lines).not.toHaveBeenCalled()
    expect(
      (renderer.subEntityTraits.fillType as { isHatchFill?: boolean })
        .isHatchFill
    ).toBeUndefined()
  })

  it('writes LWPOLYLINE-specific dxf fields and vertices', () => {
    const polyline = new AcDbPolyline()
    attachEntityToNewModelSpace(polyline)

    polyline.closed = true
    polyline.elevation = 12
    polyline.addVertexAt(0, new AcGePoint2d(1, 2))
    polyline.addVertexAt(1, new AcGePoint2d(3, 4))

    const filer = new AcDbDxfFiler()
    expect(polyline.dxfOutFields(filer)).toBe(polyline)

    const dxf = filer.toString()
    expect(getDxfGroupValues(dxf, 100)).toContain('AcDbPolyline')
    expect(getDxfGroupValues(dxf, 90)).toContain('2')
    expect(getDxfGroupValues(dxf, 70)).toContain('1')
    expect(getDxfGroupValues(dxf, 38)).toContain('12')
    expect(getDxfGroupValues(dxf, 10)).toEqual(['1', '3'])
    expect(getDxfGroupValues(dxf, 20)).toEqual(['2', '4'])
  })

  it('writes closed flag as 0 in dxf fields when polyline is open', () => {
    const polyline = new AcDbPolyline()
    attachEntityToNewModelSpace(polyline)

    polyline.closed = false
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))

    const filer = new AcDbDxfFiler()
    polyline.dxfOutFields(filer)

    const dxf = filer.toString()
    expect(getDxfGroupValues(dxf, 70)).toContain('0')
  })

  it('offsets a closed square', () => {
    const poly = new AcDbPolyline()
    poly.addVertexAt(0, new AcGePoint2d(0, 0))
    poly.addVertexAt(1, new AcGePoint2d(10, 0))
    poly.addVertexAt(2, new AcGePoint2d(10, 10))
    poly.addVertexAt(3, new AcGePoint2d(0, 10))
    poly.closed = true
    const [result] = poly.getOffsetCurves(1) as AcDbPolyline[]
    expect(result.numberOfVertices).toBe(4)
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i < result.numberOfVertices; i++) {
      const point = result.getPoint2dAt(i)
      xs.push(point.x)
      ys.push(point.y)
    }
    expect(Math.min(...xs)).toBeCloseTo(1)
    expect(Math.max(...xs)).toBeCloseTo(9)
    expect(Math.min(...ys)).toBeCloseTo(1)
    expect(Math.max(...ys)).toBeCloseTo(9)
  })

  it('offsets an open polyline with 2 vertices', () => {
    const poly = new AcDbPolyline()
    poly.addVertexAt(0, new AcGePoint2d(0, 0))
    poly.addVertexAt(1, new AcGePoint2d(10, 0))
    const [result] = poly.getOffsetCurves(2) as AcDbPolyline[]
    expect(result.numberOfVertices).toBe(2)
    expect(result.getPoint2dAt(0).y).toBeCloseTo(2)
    expect(result.getPoint2dAt(1).y).toBeCloseTo(2)
  })

  it('offsets an open polyline with a bulge arc segment', () => {
    const poly = new AcDbPolyline()
    poly.addVertexAt(0, new AcGePoint2d(0, 0), 1)
    poly.addVertexAt(1, new AcGePoint2d(10, 0))
    const [result] = poly.getOffsetCurves(1) as AcDbPolyline[]
    let minY = Infinity
    for (let i = 0; i < result.numberOfVertices; i++) {
      minY = Math.min(minY, result.getPoint2dAt(i).y)
    }
    expect(minY).toBeLessThan(-5)
  })

  it('computes area for closed polyline and returns 0 when open', () => {
    const polyline = new AcDbPolyline()
    polyline.closed = true
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(10, 0))
    polyline.addVertexAt(2, new AcGePoint2d(10, 5))
    polyline.addVertexAt(3, new AcGePoint2d(0, 5))
    expect(polyline.area).toBeCloseTo(50, 8)

    polyline.closed = false
    expect(polyline.area).toBe(0)
  })
})

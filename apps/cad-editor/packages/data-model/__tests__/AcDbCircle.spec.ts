import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbCircle } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbCircle', () => {
  it('exposes static and DXF type names', () => {
    const circle = new AcDbCircle(new AcGePoint3d(), 1)

    expect(AcDbCircle.typeName).toBe('Circle')
    expect(circle.dxfTypeName).toBe('CIRCLE')
  })

  it('initializes center radius normal and closed state', () => {
    const circle = new AcDbCircle(new AcGePoint3d(1, 2, 3), 4)

    expect(circle.center).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(circle.radius).toBe(4)
    expect(circle.normal).toMatchObject({ x: 0, y: 0, z: 1 })
    expect(circle.closed).toBe(true)

    const extents = circle.geometricExtents
    expect(extents.min).toMatchObject({ x: -3, y: -2, z: 3 })
    expect(extents.max).toMatchObject({ x: 5, y: 6, z: 3 })
  })

  it('supports center and radius setters', () => {
    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 1)

    circle.center = new AcGePoint3d(-2, 3, 5)
    circle.radius = 7

    expect(circle.center).toMatchObject({ x: -2, y: 3, z: 5 })
    expect(circle.radius).toBe(7)
  })

  it('updates geometricExtents when center and radius change', () => {
    const circle = new AcDbCircle(new AcGePoint3d(1, 2, 3), 4)

    expect(circle.geometricExtents.min).toMatchObject({ x: -3, y: -2, z: 3 })
    expect(circle.geometricExtents.max).toMatchObject({ x: 5, y: 6, z: 3 })

    circle.center = new AcGePoint3d(10, 20, 0)
    circle.radius = 2

    expect(circle.geometricExtents.min).toMatchObject({ x: 8, y: 18, z: 0 })
    expect(circle.geometricExtents.max).toMatchObject({ x: 12, y: 22, z: 0 })
  })

  it('returns grip points with center and quadrant points', () => {
    const circle = new AcDbCircle(new AcGePoint3d(1, 2, 0), 3)

    const grips = circle.subGetGripPoints()

    expect(grips).toHaveLength(5)
    expect(grips[0]).toBe(circle.center)
    expect(grips[0]).toMatchObject({ x: 1, y: 2, z: 0 })
    expect(grips[1].x).toBeCloseTo(4, 8)
    expect(grips[1].y).toBeCloseTo(2, 8)
    expect(grips[2].x).toBeCloseTo(1, 8)
    expect(grips[2].y).toBeCloseTo(5, 8)
    expect(grips[3].x).toBeCloseTo(-2, 8)
    expect(grips[3].y).toBeCloseTo(2, 8)
    expect(grips[4].x).toBeCloseTo(1, 8)
    expect(grips[4].y).toBeCloseTo(-1, 8)
  })

  it('translates the circle when moving grip index 0', () => {
    const circle = new AcDbCircle(new AcGePoint3d(2, 3, 4), 5)

    circle.subMoveGripPointsAt([0], new AcGeVector3d(1, -2, 3))

    expect(circle.center).toMatchObject({ x: 3, y: 1, z: 7 })
    expect(circle.radius).toBe(5)
  })

  it('scales the circle when moving a quadrant grip', () => {
    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 5)

    circle.subMoveGripPointsAt([1], new AcGeVector3d(3, 0, 0))

    expect(circle.center).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(circle.radius).toBeCloseTo(8, 8)
  })

  it('collects center and centroid osnap points', () => {
    const circle = new AcDbCircle(new AcGePoint3d(3, 4, 0), 2)

    const centerPoints: AcGePoint3d[] = []
    circle.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      centerPoints
    )
    expect(centerPoints).toHaveLength(1)
    expect(centerPoints[0]).toBe(circle.center)

    const centroidPoints: AcGePoint3d[] = []
    circle.subGetOsnapPoints(
      AcDbOsnapMode.Centroid,
      new AcGePoint3d(),
      new AcGePoint3d(),
      centroidPoints
    )
    expect(centroidPoints).toHaveLength(1)
    expect(centroidPoints[0]).toBe(circle.center)
  })

  it('collects quadrant osnap points', () => {
    const circle = new AcDbCircle(new AcGePoint3d(1, 2, 0), 3)
    const snapPoints: AcGePoint3d[] = []

    circle.subGetOsnapPoints(
      AcDbOsnapMode.Quadrant,
      new AcGePoint3d(),
      new AcGePoint3d(),
      snapPoints
    )

    expect(snapPoints).toHaveLength(4)
    expect(snapPoints[0].x).toBeCloseTo(4, 8)
    expect(snapPoints[0].y).toBeCloseTo(2, 8)
    expect(snapPoints[1].x).toBeCloseTo(1, 8)
    expect(snapPoints[1].y).toBeCloseTo(5, 8)
    expect(snapPoints[2].x).toBeCloseTo(-2, 8)
    expect(snapPoints[2].y).toBeCloseTo(2, 8)
    expect(snapPoints[3].x).toBeCloseTo(1, 8)
    expect(snapPoints[3].y).toBeCloseTo(-1, 8)
  })

  it('collects nearest and tangent osnap points and ignores unsupported mode', () => {
    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 2)
    const geo = (
      circle as unknown as {
        _geo: {
          nearestPoint: (pick: AcGePoint3d) => AcGePoint3d
          tangentPoints: (pick: AcGePoint3d) => AcGePoint3d[]
        }
      }
    )._geo
    const nearest = new AcGePoint3d(1, 1, 0)
    const tangentA = new AcGePoint3d(2, 0, 0)
    const tangentB = new AcGePoint3d(0, 2, 0)
    jest.spyOn(geo, 'nearestPoint').mockReturnValue(nearest)
    jest.spyOn(geo, 'tangentPoints').mockReturnValue([tangentA, tangentB])

    const nearestPoints: AcGePoint3d[] = []
    circle.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(3, 1, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toEqual(nearest)

    const tangentPoints: AcGePoint3d[] = []
    circle.subGetOsnapPoints(
      AcDbOsnapMode.Tangent,
      new AcGePoint3d(6, 0, 0),
      new AcGePoint3d(),
      tangentPoints
    )
    expect(tangentPoints).toEqual([tangentA, tangentB])

    const perpendicularPoints: AcGePoint3d[] = []
    circle.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(6, 0, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 2, y: 0, z: 0 })

    const unsupportedPoints: AcGePoint3d[] = []
    circle.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      unsupportedPoints
    )
    expect(unsupportedPoints).toHaveLength(0)
  })

  it('exposes geometry properties with editable accessors and derived values', () => {
    const circle = new AcDbCircle(new AcGePoint3d(1, 2, 3), 4)
    const geometryGroup = circle.properties.groups.find(
      group => group.groupName === 'geometry'
    )
    expect(geometryGroup).toBeDefined()

    const byName = new Map(
      geometryGroup!.properties.map(property => [property.name, property])
    )

    byName.get('centerX')!.accessor.set!(10)
    byName.get('centerY')!.accessor.set!(20)
    byName.get('centerZ')!.accessor.set!(30)
    byName.get('radius')!.accessor.set!(5)
    byName.get('normalX')!.accessor.set!(0)
    byName.get('normalY')!.accessor.set!(1)
    byName.get('normalZ')!.accessor.set!(0)

    expect(byName.get('centerX')!.accessor.get()).toBe(10)
    expect(byName.get('centerY')!.accessor.get()).toBe(20)
    expect(byName.get('centerZ')!.accessor.get()).toBe(30)
    expect(byName.get('radius')!.accessor.get()).toBe(5)
    expect(byName.get('normalX')!.accessor.get()).toBe(0)
    expect(byName.get('normalY')!.accessor.get()).toBe(1)
    expect(byName.get('normalZ')!.accessor.get()).toBe(0)
    expect(circle.center).toMatchObject({ x: 10, y: 20, z: 30 })
    expect(circle.radius).toBe(5)
    expect(circle.normal).toMatchObject({ x: 0, y: 1, z: 0 })
    expect(byName.get('diameter')!.editable).toBe(false)
    expect(byName.get('diameter')!.accessor.get()).toBeCloseTo(10, 8)
    expect(byName.get('perimeter')!.accessor.get()).toBeCloseTo(Math.PI * 10, 8)
    expect(byName.get('area')!.accessor.get()).toBeCloseTo(Math.PI * 25, 8)
  })

  it('transforms by matrix and returns itself', () => {
    const circle = new AcDbCircle(
      new AcGePoint3d(1, 2, 3),
      2,
      new AcGeVector3d(0, 0, 1)
    )

    const result = circle.transformBy(
      new AcGeMatrix3d().makeTranslation(4, -2, 5)
    )

    expect(result).toBe(circle)
    expect(circle.center).toMatchObject({ x: 5, y: 0, z: 8 })
    expect(circle.radius).toBeCloseTo(2, 8)
  })

  it('delegates drawing to renderer.circularArc', () => {
    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 2)
    const rendered = { id: 'entity' }
    const renderer = {
      circularArc: jest.fn(() => rendered)
    } as unknown as AcGiRenderer

    const result = circle.subWorldDraw(renderer)

    expect(result).toBe(rendered)
    expect(
      (renderer as unknown as { circularArc: jest.Mock }).circularArc
    ).toHaveBeenCalledTimes(1)
  })

  it('writes circle-specific DXF fields', () => {
    createWorkingDb()
    const circle = new AcDbCircle(new AcGePoint3d(1.5, -2, 3.25), 4.75)
    circle.ownerId = 'ABC'
    const filer = new AcDbDxfFiler()

    const result = circle.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(circle)
    expect(dxf).toContain('100\nAcDbCircle\n')
    expect(dxf).toContain('10\n1.5\n20\n-2\n30\n3.25\n')
    expect(dxf).toContain('40\n4.75\n')
    expect(dxf).toContain('210\n0\n220\n0\n230\n1\n')
  })

  it('writes CIRCLE center in OCS for non-default extrusion', () => {
    createWorkingDb()
    const circle = new AcDbCircle(
      new AcGePoint3d(-1.5, -2, 3.25),
      4.75,
      new AcGeVector3d(0, 0, -1)
    )
    circle.ownerId = 'ABC'
    const filer = new AcDbDxfFiler()

    circle.dxfOutFields(filer)

    const dxf = filer.toString()
    expect(dxf).toContain('10\n1.5\n20\n-2\n30\n-3.25\n')
    expect(dxf).toContain('210\n0\n220\n0\n230\n-1\n')
  })

  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbCircle(new AcGePoint3d(), 1))
  })

  it('increases radius when offsetting outward', () => {
    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 5)
    expect((circle.getOffsetCurves(3)[0] as AcDbCircle).radius).toBeCloseTo(8)
  })

  it('computes area as πr²', () => {
    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 5)
    expect(circle.area).toBeCloseTo(Math.PI * 25, 8)
  })
})

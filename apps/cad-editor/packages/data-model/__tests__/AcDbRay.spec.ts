import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbRay } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbRay', () => {
  it('exposes static and DXF type names and open-state flag', () => {
    const ray = new AcDbRay()

    expect(AcDbRay.typeName).toBe('Ray')
    expect(ray.dxfTypeName).toBe('RAY')
    expect(ray.closed).toBe(false)
  })

  it('supports base point and unit direction getter/setter with copy semantics', () => {
    const ray = new AcDbRay()
    const base = new AcGePoint3d(1, 2, 3)
    const dir = new AcGePoint3d(0, 1, -2)

    ray.basePoint = base
    ray.unitDir = dir
    base.set(10, 20, 30)
    dir.set(-3, -4, -5)

    expect(ray.basePoint).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(ray.unitDir).toMatchObject({ x: 0, y: 1, z: -2 })
  })

  it('returns geometric extents expanded from base point in both direction offsets', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(1, 2, 3)
    ray.unitDir = new AcGeVector3d(0, 2, -1)

    const extents = ray.geometricExtents

    expect(extents.min).toMatchObject({ x: 1, y: -18, z: -7 })
    expect(extents.max).toMatchObject({ x: 1, y: 22, z: 13 })
  })

  it('updates geometricExtents when basePoint changes', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(0, 0, 0)
    ray.unitDir = new AcGeVector3d(1, 0, 0)

    expect(ray.geometricExtents.min).toMatchObject({ x: -10, y: 0, z: 0 })
    expect(ray.geometricExtents.max).toMatchObject({ x: 10, y: 0, z: 0 })

    ray.basePoint = new AcGePoint3d(5, 0, 0)

    expect(ray.geometricExtents.min).toMatchObject({ x: -5, y: 0, z: 0 })
    expect(ray.geometricExtents.max).toMatchObject({ x: 15, y: 0, z: 0 })
  })

  it('exposes editable geometry properties and updates ray coordinates via accessors', () => {
    const ray = new AcDbRay()
    const geometryGroup = ray.properties.groups.find(
      group => group.groupName === 'geometry'
    )

    expect(ray.properties.type).toBe('Ray')
    expect(geometryGroup).toBeDefined()
    expect(geometryGroup?.properties.map(p => p.name)).toEqual([
      'basePointX',
      'basePointY',
      'basePointZ',
      'unitDirX',
      'unitDirY',
      'unitDirZ'
    ])

    const byName = new Map(
      geometryGroup!.properties.map(property => [property.name, property])
    )

    byName.get('basePointX')!.accessor.set!(3.5)
    byName.get('basePointY')!.accessor.set!(-4.25)
    byName.get('basePointZ')!.accessor.set!(5.75)
    byName.get('unitDirX')!.accessor.set!(-1)
    byName.get('unitDirY')!.accessor.set!(2)
    byName.get('unitDirZ')!.accessor.set!(0.5)

    expect(byName.get('basePointX')!.accessor.get()).toBe(3.5)
    expect(byName.get('basePointY')!.accessor.get()).toBe(-4.25)
    expect(byName.get('basePointZ')!.accessor.get()).toBe(5.75)
    expect(byName.get('unitDirX')!.accessor.get()).toBe(-1)
    expect(byName.get('unitDirY')!.accessor.get()).toBe(2)
    expect(byName.get('unitDirZ')!.accessor.get()).toBe(0.5)
    expect(ray.basePoint).toMatchObject({ x: 3.5, y: -4.25, z: 5.75 })
    expect(ray.unitDir).toMatchObject({ x: -1, y: 2, z: 0.5 })
  })

  it('returns base point as the only grip point', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(6, 7, 8)

    const gripPoints = ray.subGetGripPoints()

    expect(gripPoints).toHaveLength(1)
    expect(gripPoints[0]).toBe(ray.basePoint)
  })

  it('adds endpoint osnap for EndPoint mode and ignores unsupported modes', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(9, 8, 7)
    ray.unitDir = new AcGeVector3d(1, 0, 0)
    const endpointSnaps: AcGePoint3d[] = []
    const unsupportedSnaps: AcGePoint3d[] = []

    ray.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endpointSnaps
    )
    ray.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      unsupportedSnaps
    )

    expect(endpointSnaps).toEqual([ray.basePoint])
    expect(unsupportedSnaps).toHaveLength(0)
  })

  it('computes nearest and perpendicular osnap points along the ray direction', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(0, 0, 0)
    ray.unitDir = new AcGeVector3d(1, 0, 0)

    const nearestPoints: AcGePoint3d[] = []
    ray.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(5, 3, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toMatchObject({ x: 5, y: 0, z: 0 })

    const behindNearestPoints: AcGePoint3d[] = []
    ray.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(-4, 2, 0),
      new AcGePoint3d(),
      behindNearestPoints
    )
    expect(behindNearestPoints).toHaveLength(1)
    expect(behindNearestPoints[0]).toMatchObject({ x: 0, y: 0, z: 0 })

    const perpendicularPoints: AcGePoint3d[] = []
    ray.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(2, 4, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 2, y: 0, z: 0 })
  })

  it('transforms base point and direction and returns itself', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(1, 2, 3)
    ray.unitDir = new AcGeVector3d(4, -5, 6)
    const expectedNormalized = new AcGeVector3d(4, -5, 6).normalize()

    const result = ray.transformBy(new AcGeMatrix3d().makeTranslation(7, -8, 9))

    expect(result).toBe(ray)
    expect(ray.basePoint).toMatchObject({ x: 8, y: -6, z: 12 })
    expect(ray.unitDir).toMatchObject({
      x: expectedNormalized.x,
      y: expectedNormalized.y,
      z: expectedNormalized.z
    })
  })

  it('draws as a line from base point to far point in direction vector', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(1, -2, 3)
    ray.unitDir = new AcGeVector3d(0.5, 0, -1)

    const rendered = { id: 'ray-rendered' }
    const renderer = {
      lines: jest.fn(() => rendered)
    }

    const result = ray.subWorldDraw(renderer as never)

    expect(result).toBe(rendered)
    expect(renderer.lines).toHaveBeenCalledTimes(1)
    expect(renderer.lines).toHaveBeenCalledWith([
      expect.objectContaining({ x: 1, y: -2, z: 3 }),
      expect.objectContaining({ x: 500001, y: -2, z: -999997 })
    ])
  })

  it('writes ray-specific DXF fields and returns itself', () => {
    const db = createWorkingDb()
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(1.25, -2.5, 3.75)
    ray.unitDir = new AcGeVector3d(0.5, 1.5, -2.5)
    db.tables.blockTable.modelSpace.appendEntity(ray)
    const filer = new AcDbDxfFiler()

    const result = ray.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(ray)
    expect(dxf).toContain('100\nAcDbEntity\n')
    expect(dxf).toContain('100\nAcDbRay\n')
    expect(dxf).toContain('10\n1.25\n20\n-2.5\n30\n3.75\n')
    expect(dxf).toContain('11\n0.5\n21\n1.5\n31\n-2.5\n')
  })
  it('creates a detached clone with a new objectId', () => {
    createWorkingDb()
    expectDetachedClone(() => new AcDbRay())
  })

  it('offsets base point perpendicular to direction', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(0, 0, 0)
    ray.unitDir = new AcGeVector3d(1, 0, 0)
    const [result] = ray.getOffsetCurves(3) as AcDbRay[]
    expect(result.basePoint.y).toBeCloseTo(3)
    expect(result.unitDir.x).toBeCloseTo(1)
  })
})

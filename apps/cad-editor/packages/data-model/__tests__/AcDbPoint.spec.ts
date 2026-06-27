import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbPoint } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbPoint', () => {
  it('exposes static and DXF type names', () => {
    createWorkingDb()
    const point = new AcDbPoint()

    expect(AcDbPoint.typeName).toBe('Point')
    expect(point.dxfTypeName).toBe('POINT')
  })

  it('initializes at origin and supports position getter/setter', () => {
    createWorkingDb()
    const point = new AcDbPoint()

    expect(point.position).toMatchObject({ x: 0, y: 0, z: 0 })

    const source = new AcGePoint3d(1, 2, 3)
    point.position = source
    source.x = 100
    source.y = 200
    source.z = 300

    expect(point.position).toMatchObject({ x: 1, y: 2, z: 3 })

    point.position = { x: -4, y: 5 }
    expect(point.position).toMatchObject({ x: -4, y: 5, z: 0 })
  })

  it('returns point-like geometric extents', () => {
    createWorkingDb()
    const point = new AcDbPoint()
    point.position = { x: 7.5, y: -2, z: 9 }

    const extents = point.geometricExtents
    expect(extents.min).toMatchObject({ x: 7.5, y: -2, z: 9 })
    expect(extents.max).toMatchObject({ x: 7.5, y: -2, z: 9 })
  })

  it('updates geometricExtents when position changes', () => {
    createWorkingDb()
    const point = new AcDbPoint()
    point.position = { x: 1, y: 2, z: 3 }

    expect(point.geometricExtents.min).toMatchObject({ x: 1, y: 2, z: 3 })

    point.position = { x: 10, y: -5, z: 8 }

    expect(point.geometricExtents.min).toMatchObject({ x: 10, y: -5, z: 8 })
    expect(point.geometricExtents.max).toMatchObject({ x: 10, y: -5, z: 8 })
  })

  it('adds osnap point only in Node mode', () => {
    createWorkingDb()
    const point = new AcDbPoint()
    point.position = { x: 3, y: 4, z: 5 }

    const nodePoints: AcGePoint3d[] = []
    point.subGetOsnapPoints(
      AcDbOsnapMode.Node,
      new AcGePoint3d(),
      new AcGePoint3d(),
      nodePoints
    )
    expect(nodePoints).toHaveLength(1)
    expect(nodePoints[0]).toBe(point.position)

    const unsupportedModePoints: AcGePoint3d[] = []
    point.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      unsupportedModePoints
    )
    expect(unsupportedModePoints).toHaveLength(0)
  })

  it('returns position as grip point', () => {
    createWorkingDb()
    const point = new AcDbPoint()
    point.position = { x: 7, y: 8, z: 9 }
    const grips = point.subGetGripPoints()
    expect(grips).toHaveLength(1)
    expect(grips[0]).toBe(point.position)
  })

  it('exposes geometry properties with editable accessors', () => {
    createWorkingDb()
    const point = new AcDbPoint()
    const geometryGroup = point.properties.groups.find(
      group => group.groupName === 'geometry'
    )

    expect(point.properties.type).toBe('Point')
    expect(point.properties.groups.length).toBe(2)
    expect(geometryGroup).toBeDefined()

    const byName = new Map(
      geometryGroup!.properties.map(property => [property.name, property])
    )

    byName.get('positionX')!.accessor.set!(10)
    byName.get('positionY')!.accessor.set!(-20)
    byName.get('positionZ')!.accessor.set!(30)

    expect(byName.get('positionX')!.editable).toBe(true)
    expect(byName.get('positionY')!.editable).toBe(true)
    expect(byName.get('positionZ')!.editable).toBe(true)
    expect(byName.get('positionX')!.accessor.get()).toBe(10)
    expect(byName.get('positionY')!.accessor.get()).toBe(-20)
    expect(byName.get('positionZ')!.accessor.get()).toBe(30)
    expect(point.position).toMatchObject({ x: 10, y: -20, z: 30 })
  })

  it('transforms by matrix and returns itself', () => {
    createWorkingDb()
    const point = new AcDbPoint()
    point.position = { x: 1, y: 2, z: 3 }

    const result = point.transformBy(
      new AcGeMatrix3d().makeTranslation(4, -2, 1)
    )

    expect(result).toBe(point)
    expect(point.position).toMatchObject({ x: 5, y: 0, z: 4 })
  })

  it('draws through renderer.point with database point style', () => {
    const db = createWorkingDb()
    db.pdmode = 34
    db.pdsize = 2.5

    const point = new AcDbPoint()
    point.position = { x: 9, y: 8, z: 7 }

    const rendered = { id: 'point-rendered' }
    const renderer = {
      point: jest.fn(() => rendered)
    }

    const result = point.subWorldDraw(renderer as never)

    expect(result).toBe(rendered)
    expect(renderer.point).toHaveBeenCalledTimes(1)
    expect(renderer.point).toHaveBeenCalledWith(point.position, {
      displayMode: 34,
      displaySize: 2.5
    })
  })

  it('writes point-specific DXF fields', () => {
    createWorkingDb()
    const point = new AcDbPoint()
    point.position = { x: 1.25, y: -2, z: 3.5 }
    point.ownerId = '0'
    const filer = new AcDbDxfFiler()

    const result = point.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(point)
    expect(dxf).toContain('100\nAcDbEntity\n')
    expect(dxf).toContain('100\nAcDbPoint\n')
    expect(dxf).toContain('10\n1.25\n20\n-2\n30\n3.5\n')
  })
  it('creates a detached clone with a new objectId', () => {
    createWorkingDb()
    expectDetachedClone(() => new AcDbPoint())
  })
})

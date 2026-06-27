import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbArc } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbArc', () => {
  it('creates a detached clone with a new objectId', () => {
    createWorkingDb()
    expectDetachedClone(() => new AcDbArc(new AcGePoint3d(), 1, 0, Math.PI))
  })

  it('supports public geometric getters and setters', () => {
    createWorkingDb()
    const arc = new AcDbArc(new AcGePoint3d(1, 2, 0), 2, 0, Math.PI / 2)
    const arcWithNormal = new AcDbArc(
      new AcGePoint3d(0, 0, 0),
      1,
      0,
      Math.PI / 2,
      new AcGeVector3d(0, 0, 1)
    )

    expect(arc.dxfTypeName).toBe('ARC')
    expect(arc.center).toBeInstanceOf(AcGePoint3d)
    expect(arc.radius).toBe(2)
    expect(arc.startAngle).toBe(0)
    expect(arc.endAngle).toBeCloseTo(Math.PI / 2)
    expect(arc.normal).toBeInstanceOf(AcGeVector3d)
    expect(arcWithNormal.normal.z).toBeCloseTo(1)

    arc.center = new AcGePoint3d(3, 4, 1)
    arc.radius = 5
    arc.startAngle = Math.PI / 4
    arc.endAngle = Math.PI
    arc.normal = new AcGeVector3d(0, 0, 1)

    expect(arc.center.x).toBeCloseTo(3)
    expect(arc.center.y).toBeCloseTo(4)
    expect(arc.center.z).toBeCloseTo(1)
    expect(arc.radius).toBe(5)
    expect(arc.startAngle).toBeCloseTo(Math.PI / 4)
    expect(arc.endAngle).toBeCloseTo(Math.PI)
    expect(arc.normal.z).toBeCloseTo(1)

    expect(arc.startPoint).toBeInstanceOf(AcGePoint3d)
    expect(arc.endPoint).toBeInstanceOf(AcGePoint3d)
    expect(arc.midPoint).toBeInstanceOf(AcGePoint3d)
    expect(arc.geometricExtents).toBeDefined()
    expect(typeof arc.closed).toBe('boolean')
  })

  it('returns geometricExtents and updates when center or radius change', () => {
    createWorkingDb()
    const arc = new AcDbArc(new AcGePoint3d(0, 0, 0), 3, 0, Math.PI / 2)

    expect(arc.geometricExtents.min.x).toBeCloseTo(0, 5)
    expect(arc.geometricExtents.min.y).toBeCloseTo(0, 5)
    expect(arc.geometricExtents.max.x).toBeCloseTo(3, 5)
    expect(arc.geometricExtents.max.y).toBeCloseTo(3, 5)

    arc.center = new AcGePoint3d(10, 10, 0)
    arc.radius = 2

    expect(arc.geometricExtents.min.x).toBeCloseTo(10, 5)
    expect(arc.geometricExtents.min.y).toBeCloseTo(10, 5)
    expect(arc.geometricExtents.max.x).toBeCloseTo(12, 5)
    expect(arc.geometricExtents.max.y).toBeCloseTo(12, 5)
  })

  it('exposes runtime properties and accessors', () => {
    createWorkingDb()
    const arc = new AcDbArc(new AcGePoint3d(0, 0, 0), 3, 0, Math.PI / 2)
    const properties = arc.properties

    expect(properties.type).toBe('Arc')
    expect(properties.groups.length).toBe(2)

    const geometryGroup = properties.groups.find(
      group => group.groupName === 'geometry'
    )
    expect(geometryGroup).toBeDefined()

    const radiusProp = geometryGroup!.properties.find(p => p.name === 'radius')
    expect(radiusProp?.editable).toBe(true)
    radiusProp?.accessor.set?.(10)
    expect(arc.radius).toBe(10)
    expect(radiusProp?.accessor.get()).toBe(10)

    const centerXProp = geometryGroup!.properties.find(
      p => p.name === 'centerX'
    )
    centerXProp?.accessor.set?.(7)
    expect(arc.center.x).toBe(7)

    const arcLengthProp = geometryGroup!.properties.find(
      p => p.name === 'arcLength'
    )
    expect(arcLengthProp?.editable).toBe(false)
    expect(typeof arcLengthProp?.accessor.get()).toBe('number')

    const propertyValues: Record<string, number> = {
      centerX: 11,
      centerY: 12,
      centerZ: 13,
      radius: 14,
      startAngle: Math.PI / 6,
      endAngle: Math.PI / 3,
      normalX: 0,
      normalY: 0,
      normalZ: 1
    }

    for (const prop of geometryGroup!.properties) {
      prop.accessor.get()
      if (prop.editable && prop.accessor.set) {
        prop.accessor.set(propertyValues[prop.name] ?? 0)
      }
      prop.accessor.get()
    }

    expect(arc.center.x).toBeCloseTo(11)
    expect(arc.center.y).toBeCloseTo(12)
    expect(arc.center.z).toBeCloseTo(13)
    expect(arc.radius).toBeCloseTo(14)
    expect(arc.startAngle).toBeCloseTo(Math.PI / 6)
    expect(arc.endAngle).toBeCloseTo(Math.PI / 3)
    expect(arc.normal.z).toBeCloseTo(1)
  })

  it('returns grip points for center/start/end', () => {
    createWorkingDb()
    const arc = new AcDbArc(new AcGePoint3d(0, 0, 0), 2, 0, Math.PI / 2)
    const gripPoints = arc.subGetGripPoints()

    expect(gripPoints).toHaveLength(3)
    expect(gripPoints[0]).toBe(arc.center)
    expect(gripPoints[1]).toEqual(arc.startPoint)
    expect(gripPoints[2]).toEqual(arc.endPoint)
  })

  it('computes osnap points for all supported modes', () => {
    createWorkingDb()
    const arc = new AcDbArc(new AcGePoint3d(0, 0, 0), 5, 0, Math.PI)
    const geo = (
      arc as unknown as {
        _geo: {
          nearestPoint: (pick: AcGePoint3d) => AcGePoint3d
          tangentPoints: (pick: AcGePoint3d) => AcGePoint3d[]
        }
      }
    )._geo

    const nearest = new AcGePoint3d(1, 1, 0)
    const tangentA = new AcGePoint3d(2, 2, 0)
    const tangentB = new AcGePoint3d(3, 3, 0)
    jest.spyOn(geo, 'nearestPoint').mockReturnValue(nearest)
    jest.spyOn(geo, 'tangentPoints').mockReturnValue([tangentA, tangentB])

    const endPoints: AcGePoint3d[] = []
    arc.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(9, 9, 0),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints).toHaveLength(2)

    const midPoints: AcGePoint3d[] = []
    arc.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(9, 9, 0),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(1)

    const nearestPoints: AcGePoint3d[] = []
    arc.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(9, 9, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toEqual([nearest])

    const perpendicularPoints: AcGePoint3d[] = []
    arc.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(10, 0, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 5, y: 0, z: 0 })

    const tangentPoints: AcGePoint3d[] = []
    arc.subGetOsnapPoints(
      AcDbOsnapMode.Tangent,
      new AcGePoint3d(9, 9, 0),
      new AcGePoint3d(),
      tangentPoints
    )
    expect(tangentPoints).toEqual([tangentA, tangentB])

    const centerPoints: AcGePoint3d[] = []
    arc.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(9, 9, 0),
      new AcGePoint3d(),
      centerPoints
    )
    expect(centerPoints).toHaveLength(1)
    expect(centerPoints[0]).toBe(arc.center)

    const unsupportedPoints: AcGePoint3d[] = []
    arc.subGetOsnapPoints(
      AcDbOsnapMode.Node,
      new AcGePoint3d(9, 9, 0),
      new AcGePoint3d(),
      unsupportedPoints
    )
    expect(unsupportedPoints).toHaveLength(0)
  })

  it('transforms itself and draws with renderer', () => {
    createWorkingDb()
    const arc = new AcDbArc(new AcGePoint3d(1, 2, 3), 2, 0, Math.PI / 2)
    const matrix = new AcGeMatrix3d().makeTranslation(10, -2, 1)

    expect(arc.transformBy(matrix)).toBe(arc)
    expect(arc.center.x).toBeCloseTo(11)
    expect(arc.center.y).toBeCloseTo(0)
    expect(arc.center.z).toBeCloseTo(4)

    const drawResult = { id: 'arc-rendered' }
    const renderer = {
      circularArc: jest.fn(() => drawResult)
    }

    expect(arc.subWorldDraw(renderer as never)).toBe(drawResult)
    expect(renderer.circularArc).toHaveBeenCalledTimes(1)
  })

  it('writes arc-specific DXF fields', () => {
    createWorkingDb()
    const arc = new AcDbArc(new AcGePoint3d(1, 2, 3), 4, 0, Math.PI / 2)
    arc.ownerId = 'ABC'
    const filer = new AcDbDxfFiler()

    expect(arc.dxfOutFields(filer)).toBe(arc)

    const out = filer.toString()
    expect(out).toContain('100\nAcDbEntity')
    expect(out).toContain('100\nAcDbArc')
    expect(out).toContain('10\n1')
    expect(out).toContain('20\n2')
    expect(out).toContain('30\n3')
    expect(out).toContain('40\n4')
    expect(out).toContain('50\n0')
    expect(out).toContain('51\n90')
    expect(out).toContain('210\n0')
    expect(out).toContain('220\n0')
    expect(out).toContain('230\n1')
  })

  it('writes ARC center and angles in OCS for non-default extrusion', () => {
    createWorkingDb()
    const arc = new AcDbArc(
      new AcGePoint3d(-1, 2, 0),
      4,
      0,
      Math.PI / 2,
      new AcGeVector3d(0, 0, -1)
    )
    arc.ownerId = 'ABC'
    const filer = new AcDbDxfFiler()

    arc.dxfOutFields(filer)

    const out = filer.toString()
    expect(out).toContain('10\n1')
    expect(out).toContain('20\n2')
    expect(out).toContain('30\n0')
    expect(out).toContain('50\n0')
    expect(out).toContain('51\n90')
    expect(out).toContain('230\n-1')
  })

  it('increases radius when offsetting outward', () => {
    const arc = new AcDbArc(new AcGePoint3d(0, 0, 0), 5, 0, Math.PI)
    const [result] = arc.getOffsetCurves(2) as AcDbArc[]
    expect(result.radius).toBeCloseTo(7)
  })

  it('returns empty array when inward offset collapses radius', () => {
    const arc = new AcDbArc(new AcGePoint3d(0, 0, 0), 2, 0, Math.PI)
    expect(arc.getOffsetCurves(-3)).toEqual([])
  })

  it('returns 0 area for open arc', () => {
    const arc = new AcDbArc(new AcGePoint3d(), 5, 0, Math.PI / 2)
    expect(arc.area).toBe(0)
  })
})

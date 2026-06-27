import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d,
  TAU
} from '@mlightcad/geometry-engine'
import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbEllipse } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbEllipse', () => {
  it('creates a detached clone with a new objectId', () => {
    createWorkingDb()
    expectDetachedClone(
      () =>
        new AcDbEllipse(
          new AcGePoint3d(),
          AcGeVector3d.Z_AXIS,
          AcGeVector3d.X_AXIS,
          2,
          1,
          0,
          Math.PI
        )
    )
  })

  it('supports public geometric getters and setters', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(1, 2, 3),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      5,
      2,
      0.1,
      Math.PI
    )
    const openEllipse = new AcDbEllipse(
      new AcGePoint3d(),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      5,
      2,
      0,
      Math.PI / 2
    )
    const closedEllipse = new AcDbEllipse(
      new AcGePoint3d(),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      5,
      2,
      0,
      0
    )

    expect(AcDbEllipse.typeName).toBe('Ellipse')
    expect(ellipse.dxfTypeName).toBe('ELLIPSE')

    expect(ellipse.center).toBeInstanceOf(AcGePoint3d)
    expect(ellipse.majorAxisRadius).toBeCloseTo(5)
    expect(ellipse.minorAxisRadius).toBeCloseTo(2)
    expect(ellipse.startAngle).toBeCloseTo(0.1)
    expect(ellipse.endAngle).toBeCloseTo(Math.PI)
    expect(ellipse.normal).toBeInstanceOf(AcGeVector3d)
    expect(ellipse.geometricExtents).toBeDefined()
    expect(openEllipse.closed).toBe(false)
    expect(closedEllipse.closed).toBe(true)

    ellipse.center = new AcGePoint3d(7, 8, 9)
    ellipse.majorAxisRadius = 8
    ellipse.minorAxisRadius = 3
    ellipse.startAngle = Math.PI / 4
    ellipse.endAngle = Math.PI * 1.5
    ellipse.normal = new AcGeVector3d(0, 1, 0)

    expect(ellipse.center.x).toBeCloseTo(7)
    expect(ellipse.center.y).toBeCloseTo(8)
    expect(ellipse.center.z).toBeCloseTo(9)
    expect(ellipse.majorAxisRadius).toBeCloseTo(8)
    expect(ellipse.minorAxisRadius).toBeCloseTo(3)
    expect(ellipse.startAngle).toBeCloseTo(Math.PI / 4)
    expect(ellipse.endAngle).toBeCloseTo(Math.PI * 1.5)
    expect(ellipse.normal.y).toBeCloseTo(1)
  })

  it('returns geometricExtents and updates when center or radii change', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      5,
      2,
      0,
      Math.PI / 2
    )

    expect(ellipse.geometricExtents.min.x).toBeCloseTo(0, 5)
    expect(ellipse.geometricExtents.max.x).toBeCloseTo(5, 5)
    expect(ellipse.geometricExtents.max.y).toBeCloseTo(2, 5)

    ellipse.center = new AcGePoint3d(10, 20, 0)
    ellipse.majorAxisRadius = 4
    ellipse.minorAxisRadius = 1

    expect(ellipse.geometricExtents.min).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(ellipse.geometricExtents.max.x).toBeCloseTo(14, 5)
    expect(ellipse.geometricExtents.max.y).toBeCloseTo(21, 5)
  })

  it('computes osnap points for supported modes', () => {
    createWorkingDb()
    const openEllipse = new AcDbEllipse(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      6,
      3,
      0,
      Math.PI
    )
    const closedEllipse = new AcDbEllipse(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      6,
      3,
      0,
      0
    )

    const endPoints: AcGePoint3d[] = []
    openEllipse.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints).toHaveLength(2)

    const midPoints: AcGePoint3d[] = []
    openEllipse.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(1)

    const centerPoints: AcGePoint3d[] = []
    closedEllipse.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      centerPoints
    )
    expect(centerPoints).toHaveLength(1)
    expect(centerPoints[0]).toMatchObject({ x: 0, y: 0, z: 0 })

    const quadrantPoints: AcGePoint3d[] = []
    closedEllipse.subGetOsnapPoints(
      AcDbOsnapMode.Quadrant,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      quadrantPoints
    )
    expect(quadrantPoints).toHaveLength(4)

    const nearestPoints: AcGePoint3d[] = []
    openEllipse.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(10, 0, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0].x).toBeCloseTo(6, 5)

    const tangentPoints: AcGePoint3d[] = []
    openEllipse.subGetOsnapPoints(
      AcDbOsnapMode.Tangent,
      new AcGePoint3d(10, 10, 0),
      new AcGePoint3d(),
      tangentPoints
    )
    expect(tangentPoints.length).toBeGreaterThan(0)

    const perpendicularPoints: AcGePoint3d[] = []
    openEllipse.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(10, 0, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0].x).toBeCloseTo(6, 5)
    expect(perpendicularPoints[0].y).toBeCloseTo(0, 5)

    const unsupportedPoints: AcGePoint3d[] = []
    openEllipse.subGetOsnapPoints(
      AcDbOsnapMode.Insertion,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      unsupportedPoints
    )
    expect(unsupportedPoints).toHaveLength(0)

    const openQuadrantPoints: AcGePoint3d[] = []
    openEllipse.subGetOsnapPoints(
      AcDbOsnapMode.Quadrant,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      openQuadrantPoints
    )
    expect(openQuadrantPoints).toHaveLength(0)
  })

  it('returns grip points for center, start, and end on open ellipse arcs', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(1, 2, 3),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      5,
      2,
      0,
      Math.PI / 2
    )
    const grips = ellipse.subGetGripPoints()
    expect(grips).toHaveLength(3)
    expect(grips[0]).toBe(ellipse.center)
    expect(grips[1]).toMatchObject({ x: 6, y: 2, z: 3 })
    expect(grips[2].x).toBeCloseTo(1, 10)
    expect(grips[2].y).toBeCloseTo(4, 10)
    expect(grips[2].z).toBeCloseTo(3, 10)
  })

  it('returns grip points with center and quadrant points on closed ellipses', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(1, 2, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      3,
      2,
      0,
      0
    )
    const grips = ellipse.subGetGripPoints()
    expect(ellipse.closed).toBe(true)
    expect(grips).toHaveLength(5)
    expect(grips[0]).toBe(ellipse.center)
    expect(grips[0]).toMatchObject({ x: 1, y: 2, z: 0 })
    expect(grips[1].x).toBeCloseTo(4, 8)
    expect(grips[1].y).toBeCloseTo(2, 8)
    expect(grips[2].x).toBeCloseTo(1, 8)
    expect(grips[2].y).toBeCloseTo(4, 8)
    expect(grips[3].x).toBeCloseTo(-2, 8)
    expect(grips[3].y).toBeCloseTo(2, 8)
    expect(grips[4].x).toBeCloseTo(1, 8)
    expect(grips[4].y).toBeCloseTo(0, 8)
  })

  it('treats a full ellipse stored with a 0 to 2π span as closed', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(1, 2, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      3,
      2,
      0,
      TAU
    )

    expect(ellipse.closed).toBe(true)
    expect(ellipse.subGetGripPoints()).toHaveLength(5)
  })

  it('scales the closed ellipse when moving a quadrant grip', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      5,
      2,
      0,
      0
    )

    ellipse.subMoveGripPointsAt([1], new AcGeVector3d(3, 0, 0))

    expect(ellipse.center).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(ellipse.majorAxisRadius).toBeCloseTo(8, 8)
    expect(ellipse.minorAxisRadius).toBeCloseTo(2, 8)
  })

  it('exposes runtime properties and accessors', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(0, 0, 0),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      10,
      5,
      0,
      Math.PI
    )

    const properties = ellipse.properties
    expect(properties.type).toBe('Ellipse')
    expect(properties.groups).toHaveLength(2)

    const geometryGroup = properties.groups.find(
      group => group.groupName === 'geometry'
    )
    expect(geometryGroup).toBeDefined()

    const expectedValues: Record<string, number> = {
      centerX: 11,
      centerY: 12,
      centerZ: 13,
      minorAxisRadius: 4,
      startAngle: Math.PI / 6,
      endAngle: Math.PI / 3,
      normalX: 0,
      normalY: 0,
      normalZ: 1
    }

    for (const prop of geometryGroup!.properties) {
      prop.accessor.get()
      if (
        prop.editable &&
        prop.accessor.set &&
        expectedValues[prop.name] != null
      ) {
        prop.accessor.set(expectedValues[prop.name])
      }
      prop.accessor.get()
    }

    const majorAxisProp = geometryGroup!.properties.find(
      prop => prop.name === 'majorAxisRadius'
    )
    const originalMajorRadius = ellipse.majorAxisRadius
    majorAxisProp?.accessor.set?.(99)
    expect(ellipse.center.x).toBeCloseTo(99)
    expect(ellipse.majorAxisRadius).toBeCloseTo(originalMajorRadius)
    expect(majorAxisProp?.accessor.get()).toBeCloseTo(originalMajorRadius)

    const lengthProp = geometryGroup!.properties.find(
      prop => prop.name === 'length'
    )
    const areaProp = geometryGroup!.properties.find(
      prop => prop.name === 'area'
    )
    expect(lengthProp?.editable).toBe(false)
    expect(areaProp?.editable).toBe(false)
    expect(typeof lengthProp?.accessor.get()).toBe('number')
    expect(typeof areaProp?.accessor.get()).toBe('number')

    expect(ellipse.center.y).toBeCloseTo(12)
    expect(ellipse.center.z).toBeCloseTo(13)
    expect(ellipse.minorAxisRadius).toBeCloseTo(4)
    expect(ellipse.startAngle).toBeCloseTo(Math.PI / 6)
    expect(ellipse.endAngle).toBeCloseTo(Math.PI / 3)
    expect(ellipse.normal.z).toBeCloseTo(1)
  })

  it('transforms itself and draws with renderer', () => {
    createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(1, 2, 3),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.X_AXIS,
      5,
      2,
      0,
      Math.PI
    )
    const matrix = new AcGeMatrix3d().makeTranslation(10, -2, 1)

    expect(ellipse.transformBy(matrix)).toBe(ellipse)
    expect(ellipse.center.x).toBeCloseTo(11)
    expect(ellipse.center.y).toBeCloseTo(0)
    expect(ellipse.center.z).toBeCloseTo(4)

    const drawResult = { id: 'ellipse-rendered' }
    const renderer = {
      ellipticalArc: jest.fn(() => drawResult)
    }

    expect(ellipse.subWorldDraw(renderer as never)).toBe(drawResult)
    expect(renderer.ellipticalArc).toHaveBeenCalledTimes(1)
  })

  it('writes ellipse-specific DXF fields', () => {
    const db = createWorkingDb()
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(1, 2, 3),
      AcGeVector3d.Z_AXIS,
      AcGeVector3d.Y_AXIS,
      4,
      1,
      0.25,
      1.5
    )

    db.tables.blockTable.modelSpace.appendEntity(ellipse)

    const filer = new AcDbDxfFiler()

    expect(ellipse.dxfOutFields(filer)).toBe(ellipse)

    const dxf = filer.toString()
    expect(dxf).toContain('100\nAcDbEntity')
    expect(dxf).toContain('100\nAcDbEllipse')
    expect(dxf).toContain('10\n1')
    expect(dxf).toContain('20\n2')
    expect(dxf).toContain('30\n3')
    expect(dxf).toContain('11\n0')
    expect(dxf).toContain('21\n4')
    expect(dxf).toContain('31\n0')
    expect(dxf).toContain('210\n0')
    expect(dxf).toContain('220\n0')
    expect(dxf).toContain('230\n1')
    expect(dxf).toContain('40\n0.25')
    expect(dxf).toContain('41\n0.25')
    expect(dxf).toContain('42\n1.5')
  })

  it('increases both radii when offsetting outward', () => {
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(0, 0, 0),
      new AcGeVector3d(0, 0, 1),
      new AcGeVector3d(1, 0, 0),
      10,
      5,
      0,
      Math.PI * 2
    )
    const [result] = ellipse.getOffsetCurves(2) as AcDbEllipse[]
    expect(result.majorAxisRadius).toBeCloseTo(12)
    expect(result.minorAxisRadius).toBeCloseTo(7)
  })

  it('computes area for full ellipse and returns 0 for open arc', () => {
    const ellipse = new AcDbEllipse(
      new AcGePoint3d(),
      new AcGeVector3d(0, 0, 1),
      new AcGeVector3d(3, 0, 0),
      3,
      2,
      0,
      Math.PI * 2
    )
    expect(ellipse.area).toBeCloseTo(Math.PI * 6, 8)

    ellipse.endAngle = Math.PI / 2
    expect(ellipse.area).toBe(0)
  })
})

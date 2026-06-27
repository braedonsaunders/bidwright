import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbXline } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbXline', () => {
  it('exposes expected type names and default state', () => {
    const xline = new AcDbXline()

    expect(AcDbXline.typeName).toBe('Xline')
    expect(xline.dxfTypeName).toBe('XLINE')
    expect(xline.closed).toBe(false)
    expect(xline.basePoint).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(xline.unitDir).toMatchObject({ x: 0, y: 0, z: 0 })
  })

  it('supports basePoint/unitDir setters via copy semantics', () => {
    const xline = new AcDbXline()
    const base = new AcGePoint3d(2, 3, 4)
    const dir = new AcGeVector3d(5, -6, 7)

    xline.basePoint = base
    xline.unitDir = dir
    base.set(100, 100, 100)
    dir.set(100, 100, 100)

    expect(xline.basePoint).toMatchObject({ x: 2, y: 3, z: 4 })
    expect(xline.unitDir).toMatchObject({ x: 5, y: -6, z: 7 })
  })

  it('returns geometricExtents around +/-10 units from basePoint along unitDir', () => {
    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(1, 2, 3)
    xline.unitDir = new AcGeVector3d(2, -1, 0.5)

    const extents = xline.geometricExtents

    expect(extents.min).toMatchObject({ x: -19, y: -8, z: -2 })
    expect(extents.max).toMatchObject({ x: 21, y: 12, z: 8 })
  })

  it('updates geometricExtents when basePoint changes', () => {
    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(0, 0, 0)
    xline.unitDir = new AcGeVector3d(1, 0, 0)

    expect(xline.geometricExtents.min).toMatchObject({ x: -10, y: 0, z: 0 })

    xline.basePoint = new AcGePoint3d(20, 0, 0)

    expect(xline.geometricExtents.min).toMatchObject({ x: 10, y: 0, z: 0 })
    expect(xline.geometricExtents.max).toMatchObject({ x: 30, y: 0, z: 0 })
  })

  it('exposes editable geometry properties via runtime accessors', () => {
    const xline = new AcDbXline()
    const geometryGroup = xline.properties.groups.find(
      g => g.groupName === 'geometry'
    )

    expect(xline.properties.type).toBe('Xline')
    expect(geometryGroup).toBeDefined()
    expect(geometryGroup?.properties.map(p => p.name)).toEqual([
      'basePointX',
      'basePointY',
      'basePointZ',
      'unitDirX',
      'unitDirY',
      'unitDirZ'
    ])

    const basePointX = geometryGroup?.properties.find(
      p => p.name === 'basePointX'
    )
    const basePointY = geometryGroup?.properties.find(
      p => p.name === 'basePointY'
    )
    const basePointZ = geometryGroup?.properties.find(
      p => p.name === 'basePointZ'
    )
    const unitDirX = geometryGroup?.properties.find(p => p.name === 'unitDirX')
    const unitDirY = geometryGroup?.properties.find(p => p.name === 'unitDirY')
    const unitDirZ = geometryGroup?.properties.find(p => p.name === 'unitDirZ')

    basePointX?.accessor.set?.(-1.25)
    basePointY?.accessor.set?.(2.5)
    basePointZ?.accessor.set?.(3.75)
    unitDirX?.accessor.set?.(4.25)
    unitDirY?.accessor.set?.(-5.5)
    unitDirZ?.accessor.set?.(6.75)

    expect(basePointX?.accessor.get()).toBe(-1.25)
    expect(basePointY?.accessor.get()).toBe(2.5)
    expect(basePointZ?.accessor.get()).toBe(3.75)
    expect(unitDirX?.accessor.get()).toBe(4.25)
    expect(unitDirY?.accessor.get()).toBe(-5.5)
    expect(unitDirZ?.accessor.get()).toBe(6.75)
  })

  it('returns basePoint as the only grip point', () => {
    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(7, 8, 9)

    const gripPoints = xline.subGetGripPoints()

    expect(gripPoints).toHaveLength(1)
    expect(gripPoints[0]).toBe(xline.basePoint)
    expect(gripPoints[0]).toMatchObject({ x: 7, y: 8, z: 9 })
  })

  it('computes osnap points for endpoint, nearest, and perpendicular modes', () => {
    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(0, 0, 0)
    xline.unitDir = new AcGeVector3d(1, 0, 0)

    const endPoints: AcGePoint3d[] = []
    xline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints).toHaveLength(1)
    expect(endPoints[0]).toMatchObject({ x: 0, y: 0, z: 0 })

    const nearestPoints: AcGePoint3d[] = []
    xline.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(-5, 4, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toMatchObject({ x: -5, y: 0, z: 0 })

    const perpendicularPoints: AcGePoint3d[] = []
    xline.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(2, 3, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 2, y: 0, z: 0 })
  })

  it('transforms itself and draws through renderer.lines', () => {
    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(1, 0, 0)
    xline.unitDir = new AcGeVector3d(1, 0, 0)

    const matrix = new AcGeMatrix3d().makeRotationZ(Math.PI / 2)
    const drawResult = { id: 'xline-rendered' }
    const renderer = {
      lines: jest.fn<unknown, [AcGePoint3d[]]>(() => drawResult)
    }

    expect(xline.transformBy(matrix)).toBe(xline)
    expect(xline.basePoint.x).toBeCloseTo(0)
    expect(xline.basePoint.y).toBeCloseTo(1)
    expect(xline.unitDir.x).toBeCloseTo(0)
    expect(xline.unitDir.y).toBeCloseTo(1)

    expect(xline.subWorldDraw(renderer as never)).toBe(drawResult)
    expect(renderer.lines).toHaveBeenCalledTimes(1)

    const points = renderer.lines.mock.calls[0]![0]
    expect(points).toHaveLength(2)
    expect(points[0].x).toBeCloseTo(0)
    expect(points[0].y).toBeCloseTo(-999999)
    expect(points[1].x).toBeCloseTo(0)
    expect(points[1].y).toBeCloseTo(1000001)
  })

  it('writes xline-specific DXF fields and returns itself', () => {
    const db = createWorkingDb()
    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(1.25, -2.5, 3.75)
    xline.unitDir = new AcGeVector3d(0.5, -0.25, 1.5)
    db.tables.blockTable.modelSpace.appendEntity(xline)
    const filer = new AcDbDxfFiler()

    expect(xline.dxfOutFields(filer)).toBe(xline)

    const out = filer.toString()
    expect(out).toContain('100\nAcDbEntity\n')
    expect(out).toContain('100\nAcDbXline\n')
    expect(out).toContain('10\n1.25\n20\n-2.5\n30\n3.75\n')
    expect(out).toContain('11\n0.5\n21\n-0.25\n31\n1.5\n')
  })
  it('creates a detached clone with a new objectId', () => {
    createWorkingDb()
    expectDetachedClone(() => new AcDbXline())
  })
})

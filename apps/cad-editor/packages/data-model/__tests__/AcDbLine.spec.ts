import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbLine } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbLine', () => {
  it('exposes expected type names', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 2, 3)
    )

    expect(AcDbLine.typeName).toBe('Line')
    expect(line.dxfTypeName).toBe('LINE')
    expect(line.closed).toBe(false)
  })

  it('supports start/end point setters and derived geometric getters', () => {
    const line = new AcDbLine(
      new AcGePoint3d(-1, 10, 2),
      new AcGePoint3d(3, 2, -4)
    )

    line.startPoint = { x: 2, y: 6, z: 8 }
    line.endPoint = { x: 10, y: 14, z: 16 }

    expect(line.startPoint).toMatchObject({ x: 2, y: 6, z: 8 })
    expect(line.endPoint).toMatchObject({ x: 10, y: 14, z: 16 })
    expect(line.midPoint).toMatchObject({ x: 6, y: 10, z: 12 })

    const extents = line.geometricExtents
    expect(extents.min).toMatchObject({ x: 2, y: 6, z: 8 })
    expect(extents.max).toMatchObject({ x: 10, y: 14, z: 16 })
  })

  it('exposes editable geometry properties through accessors', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(3, 4, 0)
    )
    const geometryGroup = line.properties.groups.find(
      g => g.groupName === 'geometry'
    )

    expect(line.properties.type).toBe('Line')
    expect(geometryGroup).toBeDefined()
    expect(geometryGroup?.properties.map(p => p.name)).toEqual([
      'startX',
      'startY',
      'startZ',
      'endX',
      'endY',
      'endZ',
      'length'
    ])

    const startX = geometryGroup?.properties.find(p => p.name === 'startX')
    const startY = geometryGroup?.properties.find(p => p.name === 'startY')
    const startZ = geometryGroup?.properties.find(p => p.name === 'startZ')
    const endX = geometryGroup?.properties.find(p => p.name === 'endX')
    const endY = geometryGroup?.properties.find(p => p.name === 'endY')
    const endZ = geometryGroup?.properties.find(p => p.name === 'endZ')
    const length = geometryGroup?.properties.find(p => p.name === 'length')

    startX?.accessor.set?.(1.5)
    startY?.accessor.set?.(-2.5)
    startZ?.accessor.set?.(3.25)
    endX?.accessor.set?.(4.5)
    endY?.accessor.set?.(5.5)
    endZ?.accessor.set?.(6.5)

    expect(startX?.accessor.get()).toBe(1.5)
    expect(startY?.accessor.get()).toBe(-2.5)
    expect(startZ?.accessor.get()).toBe(3.25)
    expect(endX?.accessor.get()).toBe(4.5)
    expect(endY?.accessor.get()).toBe(5.5)
    expect(endZ?.accessor.get()).toBe(6.5)
    expect(length?.editable).toBe(false)
    expect(length?.accessor.get()).toBeCloseTo(
      Math.sqrt(
        (4.5 - 1.5) * (4.5 - 1.5) +
          (5.5 - -2.5) * (5.5 - -2.5) +
          (6.5 - 3.25) * (6.5 - 3.25)
      )
    )
  })

  it('returns grip points in midpoint-start-end order', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(8, 2, 0)
    )

    const gripPoints = line.subGetGripPoints()

    expect(gripPoints).toHaveLength(3)
    expect(gripPoints[0]).toMatchObject({ x: 4, y: 1, z: 0 })
    expect(gripPoints[1]).toBe(line.startPoint)
    expect(gripPoints[2]).toBe(line.endPoint)
  })

  it('moves grip points by index', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )

    line.subMoveGripPointsAt([0], new AcGeVector3d(1, 2, 3))
    expect(line.startPoint).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(line.endPoint).toMatchObject({ x: 11, y: 2, z: 3 })

    line.subMoveGripPointsAt([1], new AcGeVector3d(-1, 0, 0))
    expect(line.startPoint).toMatchObject({ x: 0, y: 2, z: 3 })
    expect(line.endPoint).toMatchObject({ x: 11, y: 2, z: 3 })

    line.subMoveGripPointsAt([2], new AcGeVector3d(0, 1, 0))
    expect(line.endPoint).toMatchObject({ x: 11, y: 3, z: 3 })
  })

  it('computes osnap points for all supported modes', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    const geo = (
      line as unknown as {
        _geo: {
          project: (pickPoint: AcGePoint3d) => AcGePoint3d
          perpPoint: (pickPoint: AcGePoint3d) => AcGePoint3d
        }
      }
    )._geo

    const projectedPoint = new AcGePoint3d(7, 0, 0)
    const perpendicularPoint = new AcGePoint3d(2, 0, 0)
    jest.spyOn(geo, 'project').mockReturnValue(projectedPoint)
    jest.spyOn(geo, 'perpPoint').mockReturnValue(perpendicularPoint)

    const endPoints: AcGePoint3d[] = []
    line.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints).toEqual([line.startPoint, line.endPoint])

    const midPoints: AcGePoint3d[] = []
    line.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(1)
    expect(midPoints[0]).toMatchObject({ x: 5, y: 0, z: 0 })

    const nearestPoints: AcGePoint3d[] = []
    line.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(2, 3, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(geo.project).toHaveBeenCalledWith(
      expect.objectContaining({ x: 2, y: 3, z: 0 })
    )
    expect(nearestPoints).toEqual([projectedPoint])

    const perpendicularPoints: AcGePoint3d[] = []
    line.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(4, 3, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(geo.perpPoint).toHaveBeenCalledWith(
      expect.objectContaining({ x: 4, y: 3, z: 0 })
    )
    expect(perpendicularPoints).toEqual([perpendicularPoint])

    const tangentPoints: AcGePoint3d[] = []
    line.subGetOsnapPoints(
      AcDbOsnapMode.Tangent,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      tangentPoints
    )
    expect(tangentPoints).toHaveLength(0)

    const unsupportedPoints: AcGePoint3d[] = []
    line.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(1, 1, 0),
      new AcGePoint3d(),
      unsupportedPoints
    )
    expect(unsupportedPoints).toHaveLength(0)
  })

  it('transforms itself and draws via renderer.lines with z flattened to 0', () => {
    const line = new AcDbLine(
      new AcGePoint3d(1, 2, 3),
      new AcGePoint3d(4, 5, 6)
    )
    const matrix = new AcGeMatrix3d().makeTranslation(10, -3, 2)
    const drawResult = { id: 'line-rendered' }
    const renderer = {
      lines: jest.fn(() => drawResult)
    }

    expect(line.transformBy(matrix)).toBe(line)
    expect(line.startPoint).toMatchObject({ x: 11, y: -1, z: 5 })
    expect(line.endPoint).toMatchObject({ x: 14, y: 2, z: 8 })

    expect(line.subWorldDraw(renderer as never)).toBe(drawResult)
    expect(renderer.lines).toHaveBeenCalledTimes(1)
    expect(renderer.lines).toHaveBeenCalledWith([
      expect.objectContaining({ x: 11, y: -1, z: 0 }),
      expect.objectContaining({ x: 14, y: 2, z: 0 })
    ])
  })

  it('writes line-specific DXF fields and returns itself', () => {
    const db = createWorkingDb()
    const line = new AcDbLine(
      new AcGePoint3d(1.25, -2.5, 3.75),
      new AcGePoint3d(4.5, 5.25, -6.75)
    )
    db.tables.blockTable.modelSpace.appendEntity(line)
    const filer = new AcDbDxfFiler()

    expect(line.dxfOutFields(filer)).toBe(line)

    const out = filer.toString()
    expect(out).toContain('100\nAcDbEntity\n')
    expect(out).toContain('100\nAcDbLine\n')
    expect(out).toContain('10\n1.25\n20\n-2.5\n30\n3.75\n')
    expect(out).toContain('11\n4.5\n21\n5.25\n31\n-6.75\n')
  })
  it('creates a detached clone with a new objectId', () => {
    createWorkingDb()
    expectDetachedClone(
      () => new AcDbLine(new AcGePoint3d(), new AcGePoint3d(1, 1, 0))
    )
  })

  it('offsets a horizontal line upward by distance 2', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    const [result] = line.getOffsetCurves(2) as AcDbLine[]
    expect(result.startPoint.y).toBeCloseTo(2)
    expect(result.endPoint.y).toBeCloseTo(2)
  })

  it('offsets a horizontal line downward with negative distance', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    const [result] = line.getOffsetCurves(-2) as AcDbLine[]
    expect(result.startPoint.y).toBeCloseTo(-2)
    expect(result.endPoint.y).toBeCloseTo(-2)
  })

  it('returns 1 for point above a horizontal line in getOffsetSideAtPoint', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    expect(line.getOffsetSideAtPoint(new AcGePoint3d(5, 3, 0))).toBe(1)
  })

  it('returns -1 for point below a horizontal line in getOffsetSideAtPoint', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    expect(line.getOffsetSideAtPoint(new AcGePoint3d(5, -3, 0))).toBe(-1)
  })

  it('returns 0 area', () => {
    const line = new AcDbLine(new AcGePoint3d(), new AcGePoint3d(10, 0, 0))
    expect(line.area).toBe(0)
  })
})
import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { TEMP_OBJECT_ID_PREFIX } from '../src/base/AcDbObject'
import { AcDbDatabase } from '../src/database'
import { AcDbFace } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbFace', () => {
  it('exposes type names and default vertex behavior', () => {
    const face = new AcDbFace()

    expect(AcDbFace.typeName).toBe('Face')
    expect(face.dxfTypeName).toBe('3DFACE')

    expect(face.getVertexAt(0)).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(face.getVertexAt(-1)).toBe(face.getVertexAt(0))
    expect(face.getVertexAt(1)).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(face.getVertexAt(4)).toBe(face.getVertexAt(2))
    expect(face.getVertexAt(3)).toBeUndefined()
  })

  it('supports setVertexAt for normal and high indexes, and keeps current negative-index behavior', () => {
    const face = new AcDbFace()

    face.setVertexAt(1, { x: 1, y: 2, z: 3 })
    expect(face.getVertexAt(1)).toMatchObject({ x: 1, y: 2, z: 3 })

    expect(() => face.setVertexAt(-1, { x: 9, y: 8, z: 7 })).toThrow()
    expect(face.getVertexAt(0)).toMatchObject({ x: 9, y: 8, z: 7 })

    face.setVertexAt(3, { x: 4, y: 5, z: 6 })
    expect(face.getVertexAt(3)).toMatchObject({ x: 4, y: 5, z: 6 })

    face.setVertexAt(99, { x: 7, y: 8, z: 9 })
    expect(face.getVertexAt(3)).toMatchObject({ x: 7, y: 8, z: 9 })
  })

  it('falls back to temporary object id when working database is unavailable', () => {
    const services = acdbHostApplicationServices() as unknown as {
      _workingDatabase: AcDbDatabase | null
    }
    const previousDb = services._workingDatabase
    services._workingDatabase = null

    try {
      const face = new AcDbFace()
      expect(face.objectId.startsWith(TEMP_OBJECT_ID_PREFIX)).toBe(true)
    } finally {
      services._workingDatabase = previousDb
    }
  })

  it('supports edge visibility bit operations and throws for invalid edge indexes', () => {
    const face = new AcDbFace()

    expect(face.isEdgeVisibleAt(0)).toBe(true)
    expect(face.isEdgeVisibleAt(1)).toBe(true)
    expect(face.isEdgeVisibleAt(2)).toBe(true)
    expect(face.isEdgeVisibleAt(3)).toBe(true)

    face.setEdgeInvisibilities(0b0101)
    expect(face.isEdgeVisibleAt(0)).toBe(false)
    expect(face.isEdgeVisibleAt(1)).toBe(true)
    expect(face.isEdgeVisibleAt(2)).toBe(false)
    expect(face.isEdgeVisibleAt(3)).toBe(true)

    face.makeEdgeInvisibleAt(1)
    expect(face.isEdgeVisibleAt(1)).toBe(false)

    expect(() => face.isEdgeVisibleAt(-1)).toThrow('Index out of range')
    expect(() => face.isEdgeVisibleAt(4)).toThrow('Index out of range')
    expect(() => face.makeEdgeInvisibleAt(-1)).toThrow('Index out of range')
    expect(() => face.makeEdgeInvisibleAt(4)).toThrow('Index out of range')
  })

  it('returns extents, grip points and endpoint osnap points', () => {
    const face = new AcDbFace()
    face.setVertexAt(0, { x: -1, y: 4, z: 2 })
    face.setVertexAt(1, { x: 3, y: 1, z: 8 })
    face.setVertexAt(2, { x: 2, y: -5, z: -3 })
    face.setVertexAt(3, { x: 6, y: 2, z: 0 })

    const extents = face.geometricExtents
    expect(extents.min).toMatchObject({ x: -1, y: -5, z: -3 })
    expect(extents.max).toMatchObject({ x: 6, y: 4, z: 8 })

    const grips = face.subGetGripPoints()
    expect(grips).toHaveLength(4)
    expect(grips[0]).toBe(face.getVertexAt(0))
    expect(grips[3]).toBe(face.getVertexAt(3))

    const endPoints: AcGePoint3d[] = []
    face.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints).toEqual(grips)

    const unsupportedPoints: AcGePoint3d[] = []
    face.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      unsupportedPoints
    )
    expect(unsupportedPoints).toHaveLength(0)

    const midPoints: AcGePoint3d[] = []
    face.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(4)

    const nearestPoints: AcGePoint3d[] = []
    face.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(1, 2.5, 5),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0].x).toBeCloseTo(1)
    expect(nearestPoints[0].y).toBeCloseTo(2.5)
    expect(nearestPoints[0].z).toBeCloseTo(5)

    const perpendicularPoints: AcGePoint3d[] = []
    face.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(0.5, 0.5, -1),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
  })

  it('updates geometricExtents when a vertex changes', () => {
    const face = new AcDbFace()
    face.setVertexAt(0, { x: 0, y: 0, z: 0 })
    face.setVertexAt(1, { x: 2, y: 0, z: 0 })
    face.setVertexAt(2, { x: 2, y: 2, z: 0 })
    face.setVertexAt(3, { x: 0, y: 2, z: 0 })

    expect(face.geometricExtents.max).toMatchObject({ x: 2, y: 2, z: 0 })

    face.setVertexAt(2, { x: 8, y: 6, z: 4 })

    expect(face.geometricExtents.max).toMatchObject({ x: 8, y: 6, z: 4 })
  })

  it('transforms vertices and draws visible edges via line segments', () => {
    const face = new AcDbFace()
    face.setVertexAt(0, { x: 0, y: 0, z: 0 })
    face.setVertexAt(1, { x: 1, y: 0, z: 0 })
    face.setVertexAt(2, { x: 1, y: 1, z: 0 })
    face.setVertexAt(3, { x: 0, y: 1, z: 0 })

    const matrix = new AcGeMatrix3d().makeTranslation(10, -2, 3)
    expect(face.transformBy(matrix)).toBe(face)
    expect(face.getVertexAt(0)).toMatchObject({ x: 10, y: -2, z: 3 })
    expect(face.getVertexAt(2)).toMatchObject({ x: 11, y: -1, z: 3 })

    face.setEdgeInvisibilities(0b0010)

    const drawResult = { id: 'face-rendered' }
    const renderer = {
      lineSegments: jest.fn(() => drawResult)
    }

    expect(face.subWorldDraw(renderer as never)).toBe(drawResult)
    expect(renderer.lineSegments).toHaveBeenCalledTimes(1)

    const [buffer, stride, indices] = renderer.lineSegments.mock
      .calls[0] as unknown as [Float32Array, number, Uint16Array]

    expect(stride).toBe(3)
    expect(buffer).toHaveLength(12)
    expect(indices).toEqual(new Uint16Array([0, 1, 0, 0, 2, 3, 3, 0]))
  })

  it('writes face-specific DXF fields and edge visibility mask', () => {
    const db = createWorkingDb()
    const face = new AcDbFace()

    db.tables.blockTable.modelSpace.appendEntity(face)

    face.setVertexAt(0, { x: 1, y: 2, z: 3 })
    face.setVertexAt(1, { x: 4, y: 5, z: 6 })
    face.setVertexAt(2, { x: 7, y: 8, z: 9 })
    face.setVertexAt(3, { x: 10, y: 11, z: 12 })
    face.setEdgeInvisibilities(0)
    face.makeEdgeInvisibleAt(1)
    face.makeEdgeInvisibleAt(3)

    const filer = new AcDbDxfFiler()
    expect(face.dxfOutFields(filer)).toBe(face)

    const dxf = filer.toString()
    expect(dxf).toContain('100\nAcDbEntity\n')
    expect(dxf).toContain('100\nAcDbFace\n')
    expect(dxf).toContain('10\n1\n')
    expect(dxf).toContain('20\n2\n')
    expect(dxf).toContain('30\n3\n')
    expect(dxf).toContain('11\n4\n')
    expect(dxf).toContain('21\n5\n')
    expect(dxf).toContain('31\n6\n')
    expect(dxf).toContain('12\n7\n')
    expect(dxf).toContain('22\n8\n')
    expect(dxf).toContain('32\n9\n')
    expect(dxf).toContain('13\n10\n')
    expect(dxf).toContain('23\n11\n')
    expect(dxf).toContain('33\n12\n')
    expect(dxf).toContain('70\n10\n')
  })

  it('clone creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbFace())
  })

  it('computes triangle area', () => {
    const face = new AcDbFace()
    face.setVertexAt(0, new AcGePoint3d(0, 0, 0))
    face.setVertexAt(1, new AcGePoint3d(4, 0, 0))
    face.setVertexAt(2, new AcGePoint3d(0, 3, 0))
    face.setVertexAt(3, new AcGePoint3d(0, 3, 0))
    expect(face.area).toBeCloseTo(6, 8)
  })
})

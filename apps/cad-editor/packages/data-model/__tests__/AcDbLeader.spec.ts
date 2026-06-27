import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import {
  AcDbLeader,
  AcDbLeaderAnnotationType,
  AcDbPolyline
} from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'
import { AcDbOsnapMode } from '../src/misc'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

const createRenderer = () => ({
  lines: jest.fn((points: unknown[]) => ({ kind: 'lines', points }))
})

describe('AcDbLeader', () => {
  it('exposes type names and public getters/setters', () => {
    const leader = new AcDbLeader()

    expect(AcDbLeader.typeName).toBe('Leader')
    expect(leader.dxfTypeName).toBe('LEADER')

    expect(leader.isSplined).toBe(false)
    expect(leader.hasArrowHead).toBe(false)
    expect(leader.hasHookLine).toBe(false)
    expect(leader.numVertices).toBe(0)
    expect(leader.vertices).toEqual([])
    expect(leader.dimensionStyle).toBe('')
    expect(leader.annoType).toBe(AcDbLeaderAnnotationType.NoAnnotation)
    expect(leader.closed).toBe(false)

    leader.isSplined = true
    leader.hasArrowHead = true
    leader.hasHookLine = true
    leader.dimensionStyle = 'Standard'
    leader.annoType = AcDbLeaderAnnotationType.MText
    leader.closed = true

    expect(leader.isSplined).toBe(true)
    expect(leader.hasArrowHead).toBe(true)
    expect(leader.hasHookLine).toBe(true)
    expect(leader.dimensionStyle).toBe('Standard')
    expect(leader.annoType).toBe(AcDbLeaderAnnotationType.MText)
    expect(leader.closed).toBe(false)
  })

  it('supports appendVertex, numVertices and returns cloned vertices', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(0, 0, 0))
    leader.appendVertex(new AcGePoint3d(2, 1, 0))

    expect(leader.numVertices).toBe(2)
    expect(leader.vertices).toHaveLength(2)

    const exported = leader.vertices
    exported[0].x = 999
    expect(leader.vertices[0].x).toBe(0)
  })

  it('returns all leader vertices as grip points', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(0, 0, 0))
    leader.appendVertex(new AcGePoint3d(5, 5, 0))
    leader.appendVertex(new AcGePoint3d(10, 5, 0))
    const grips = leader.subGetGripPoints()
    expect(grips).toHaveLength(3)
    expect(grips[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(grips[2]).toMatchObject({ x: 10, y: 5, z: 0 })
  })

  it('supports setVertexAt and vertexAt with range checking', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(0, 0, 0))

    expect(leader.setVertexAt(0, new AcGePoint3d(5, 5, 0))).toBe(leader)
    expect(leader.vertexAt(0)).toMatchObject({ x: 5, y: 5, z: 0 })

    expect(() => leader.setVertexAt(-1, new AcGePoint3d(9, 8, 7))).toThrow(
      'The vertex index is out of range!'
    )
    expect(() => leader.vertexAt(-1)).toThrow(
      'The vertex index is out of range!'
    )
  })

  it('returns geometric extents for non-splined and splined leader', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(-1, 3, 0))
    leader.appendVertex(new AcGePoint3d(4, -2, 1))

    const extents = leader.geometricExtents
    expect(extents.min).toMatchObject({ x: -1, y: -2, z: 0 })
    expect(extents.max).toMatchObject({ x: 4, y: 3, z: 1 })

    leader.appendVertex(new AcGePoint3d(6, 1, 2))
    leader.appendVertex(new AcGePoint3d(8, 0, 0))
    leader.isSplined = true
    leader.subWorldDraw(createRenderer() as never)

    const splineExtents = leader.geometricExtents
    expect(splineExtents.isEmpty()).toBe(false)
  })

  it('updates geometricExtents when a vertex is moved', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(0, 0, 0))
    leader.appendVertex(new AcGePoint3d(4, 0, 0))

    expect(leader.geometricExtents.max.x).toBeCloseTo(4)

    leader.setVertexAt(1, new AcGePoint3d(4, 8, 0))

    expect(leader.geometricExtents.max.y).toBeCloseTo(8)
  })

  it('draws polyline/spline branches in subWorldDraw', () => {
    const rendererA = createRenderer()
    const leaderA = new AcDbLeader()
    leaderA.appendVertex(new AcGePoint3d(0, 0, 0))
    const drawA = leaderA.subWorldDraw(rendererA as never)
    expect(rendererA.lines).toHaveBeenCalledTimes(1)
    expect(drawA).toMatchObject({ kind: 'lines' })
    expect((rendererA.lines.mock.calls[0] as unknown[][])[0]).toHaveLength(1)

    const rendererB = createRenderer()
    const leaderB = new AcDbLeader()
    leaderB.appendVertex(new AcGePoint3d(0, 0, 0))
    leaderB.isSplined = true
    leaderB.subWorldDraw(rendererB as never)
    expect((rendererB.lines.mock.calls[0] as unknown[][])[0]).toHaveLength(1)

    const rendererC = createRenderer()
    const leaderC = new AcDbLeader()
    leaderC.appendVertex(new AcGePoint3d(0, 0, 0))
    leaderC.appendVertex(new AcGePoint3d(2, 1, 0))
    leaderC.appendVertex(new AcGePoint3d(4, 0, 0))
    leaderC.appendVertex(new AcGePoint3d(6, 1, 0))
    leaderC.isSplined = true
    leaderC.subWorldDraw(rendererC as never)
    expect((rendererC.lines.mock.calls[0] as unknown[][])[0]).toHaveLength(100)
  })

  it('transforms vertices and keeps working for splined geometry', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(0, 0, 0))
    leader.appendVertex(new AcGePoint3d(1, 0, 0))

    const matrix = new AcGeMatrix3d().makeTranslation(10, -2, 3)
    expect(leader.transformBy(matrix)).toBe(leader)
    expect(leader.vertices[0]).toMatchObject({ x: 10, y: -2, z: 3 })
    expect(leader.vertices[1]).toMatchObject({ x: 11, y: -2, z: 3 })

    leader.appendVertex(new AcGePoint3d(12, -1, 3))
    leader.appendVertex(new AcGePoint3d(14, -2, 3))
    leader.isSplined = true
    leader.subWorldDraw(createRenderer() as never)
    expect(
      leader.transformBy(new AcGeMatrix3d().makeTranslation(1, 1, 0))
    ).toBe(leader)

    const renderer = createRenderer()
    leader.subWorldDraw(renderer as never)
    expect((renderer.lines.mock.calls[0] as unknown[][])[0]).toHaveLength(100)
  })

  it('writes leader-specific DXF fields', () => {
    const db = createWorkingDb()
    const leader = new AcDbLeader()
    db.tables.blockTable.modelSpace.appendEntity(leader)

    leader.dimensionStyle = 'Standard'
    leader.hasArrowHead = true
    leader.hasHookLine = true
    leader.isHookLineSameDirection = true
    leader.isSplined = true
    leader.annoType = AcDbLeaderAnnotationType.BlockReference
    leader.textHeight = 2.5
    leader.textWidth = 8
    leader.associatedAnnotation = 'ABC'
    leader.appendVertex(new AcGePoint3d(1, 2, 3))
    leader.appendVertex(new AcGePoint3d(4, 5, 6))

    const filer = new AcDbDxfFiler()
    expect(leader.dxfOutFields(filer)).toBe(leader)

    const dxf = filer.toString()
    expect(dxf).toContain('100\nAcDbLeader\n')
    expect(dxf).toContain('\n3\nStandard\n')
    expect(dxf).toContain('\n71\n1\n')
    expect(dxf).toContain('\n72\n1\n')
    expect(dxf).toContain('\n73\n2\n')
    expect(dxf).toContain('\n74\n1\n')
    expect(dxf).toContain('\n75\n1\n')
    expect(dxf).toContain('\n76\n2\n')
    expect(dxf).toContain('\n40\n2.5\n')
    expect(dxf).toContain('\n41\n8\n')
    expect(dxf).toContain('\n340\nABC\n')
    expect(dxf).toContain('\n10\n1\n')
    expect(dxf).toContain('\n20\n2\n')
    expect(dxf).toContain('\n30\n3\n')
    expect(dxf).toContain('\n10\n4\n')
    expect(dxf).toContain('\n20\n5\n')
    expect(dxf).toContain('\n30\n6\n')
  })

  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbLeader())
  })

  it('offsets straight leader vertices as a polyline path', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(0, 0, 0))
    leader.appendVertex(new AcGePoint3d(10, 0, 0))
    leader.appendVertex(new AcGePoint3d(10, 5, 0))
    const [result] = leader.getOffsetCurves(2) as AcDbPolyline[]
    expect(result.numberOfVertices).toBeGreaterThanOrEqual(2)
  })

  it('computes osnap points for straight and splined leaders', () => {
    const leader = new AcDbLeader()
    leader.appendVertex(new AcGePoint3d(0, 0, 0))
    leader.appendVertex(new AcGePoint3d(4, 0, 0))
    leader.appendVertex(new AcGePoint3d(4, 3, 0))

    const endPoints: AcGePoint3d[] = []
    leader.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints).toHaveLength(3)

    const midPoints: AcGePoint3d[] = []
    leader.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(2)
    expect(midPoints[0]).toMatchObject({ x: 2, y: 0, z: 0 })
    expect(midPoints[1]).toMatchObject({ x: 4, y: 1.5, z: 0 })

    const straightNearestPoints: AcGePoint3d[] = []
    leader.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(4, 2, 0),
      new AcGePoint3d(),
      straightNearestPoints
    )
    expect(straightNearestPoints).toHaveLength(1)
    expect(straightNearestPoints[0]).toMatchObject({ x: 4, y: 2, z: 0 })

    const perpendicularPoints: AcGePoint3d[] = []
    leader.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(4, 2, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 4, y: 2, z: 0 })

    leader.appendVertex(new AcGePoint3d(6, 1, 0))
    leader.appendVertex(new AcGePoint3d(8, 0, 0))
    leader.isSplined = true

    const splineEndPoints: AcGePoint3d[] = []
    leader.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      splineEndPoints
    )
    expect(splineEndPoints).toHaveLength(2)
    expect(splineEndPoints[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(splineEndPoints[1]).toMatchObject({ x: 8, y: 0, z: 0 })

    const nearestPoints: AcGePoint3d[] = []
    leader.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(4, 2, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
  })
})

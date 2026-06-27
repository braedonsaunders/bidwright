import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDb3dVertex, AcDb3dVertexType } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDb3dVertex', () => {
  it('exposes static and DXF type names', () => {
    const vertex = new AcDb3dVertex()

    expect(AcDb3dVertex.typeName).toBe('3dVertex')
    expect(vertex.dxfTypeName).toBe('VERTEX')
  })

  it('initializes with default position and vertex type', () => {
    const vertex = new AcDb3dVertex()

    expect(vertex.position).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(vertex.vertexType).toBe(AcDb3dVertexType.SimpleVertex)
  })

  it('sets position by copying input values and updates geometric extents', () => {
    const vertex = new AcDb3dVertex()
    const source = new AcGePoint3d(1, 2, 3)

    vertex.position = source
    source.x = 100
    source.y = 200
    source.z = 300

    expect(vertex.position).toMatchObject({ x: 1, y: 2, z: 3 })

    const extents = vertex.geometricExtents
    expect(extents.min).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(extents.max).toMatchObject({ x: 1, y: 2, z: 3 })
  })

  it('updates geometricExtents when position changes', () => {
    const vertex = new AcDb3dVertex()
    vertex.position = { x: 0, y: 0, z: 0 }

    expect(vertex.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })

    vertex.position = { x: 5, y: -2, z: 7 }

    expect(vertex.geometricExtents.min).toMatchObject({ x: 5, y: -2, z: 7 })
    expect(vertex.geometricExtents.max).toMatchObject({ x: 5, y: -2, z: 7 })
  })

  it('gets and sets vertexType', () => {
    const vertex = new AcDb3dVertex()

    vertex.vertexType = AcDb3dVertexType.ControlVertex
    expect(vertex.vertexType).toBe(AcDb3dVertexType.ControlVertex)
  })

  it('returns grip points containing its position', () => {
    const vertex = new AcDb3dVertex()
    vertex.position = { x: 7, y: 8, z: 9 }

    const gripPoints = vertex.subGetGripPoints()
    expect(gripPoints).toHaveLength(1)
    expect(gripPoints[0]).toBe(vertex.position)
    expect(gripPoints[0]).toMatchObject({ x: 7, y: 8, z: 9 })
  })

  it('appends osnap point with current position', () => {
    const vertex = new AcDb3dVertex()
    vertex.position = { x: -1, y: 2.5, z: 3 }

    const snapPoints: Array<{ x: number; y: number; z: number }> = []
    vertex.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      snapPoints
    )

    expect(snapPoints).toHaveLength(1)
    expect(snapPoints[0]).toBe(vertex.position)
    expect(snapPoints[0]).toMatchObject({ x: -1, y: 2.5, z: 3 })

    const nodeSnaps: Array<{ x: number; y: number; z: number }> = []
    vertex.subGetOsnapPoints(
      AcDbOsnapMode.Node,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      nodeSnaps
    )
    expect(nodeSnaps).toHaveLength(1)
    expect(nodeSnaps[0]).toBe(vertex.position)

    const unsupportedSnaps: Array<{ x: number; y: number; z: number }> = []
    vertex.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      unsupportedSnaps
    )
    expect(unsupportedSnaps).toHaveLength(0)
  })

  it('transforms position by matrix and returns itself', () => {
    const vertex = new AcDb3dVertex()
    vertex.position = { x: 1, y: 2, z: 3 }

    const result = vertex.transformBy(
      new AcGeMatrix3d().makeTranslation(4, -2, 1)
    )

    expect(result).toBe(vertex)
    expect(vertex.position).toMatchObject({ x: 5, y: 0, z: 4 })
  })

  it('subWorldDraw returns undefined', () => {
    const vertex = new AcDb3dVertex()

    expect(vertex.subWorldDraw({} as never)).toBeUndefined()
  })

  it('writes vertex-specific DXF fields', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db

    const vertex = new AcDb3dVertex()
    vertex.position = { x: 1.25, y: -2, z: 3.5 }
    vertex.vertexType = AcDb3dVertexType.ControlVertex
    db.tables.blockTable.modelSpace.appendEntity(vertex)

    const filer = new AcDbDxfFiler()
    const result = vertex.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(vertex)
    expect(dxf).toContain('100\nAcDbVertex\n100\nAcDb3dPolylineVertex\n')
    expect(dxf).toContain('10\n1.25\n20\n-2\n30\n3.5\n')
    expect(dxf).toContain('70\n33\n')
  })
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDb3dVertex())
  })
})

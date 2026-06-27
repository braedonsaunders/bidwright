import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDb2dVertex, AcDb2dVertexType } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDb2dVertex', () => {
  it('exposes expected type names and default values', () => {
    const vertex = new AcDb2dVertex()

    expect(AcDb2dVertex.typeName).toBe('2dVertex')
    expect(vertex.dxfTypeName).toBe('VERTEX')
    expect(vertex.position).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(vertex.bulge).toBe(0)
    expect(vertex.startWidth).toBe(0)
    expect(vertex.endWidth).toBe(0)
    expect(vertex.vertexType).toBe(AcDb2dVertexType.Vertex)
  })

  it('supports all public setters and getters', () => {
    const vertex = new AcDb2dVertex()

    vertex.position = { x: 1.5, y: -2.25, z: 3.75 }
    vertex.bulge = 0.5
    vertex.startWidth = 2.2
    vertex.endWidth = 3.3
    vertex.vertexType = AcDb2dVertexType.CurveFitVertex

    expect(vertex.position).toMatchObject({ x: 1.5, y: -2.25, z: 3.75 })
    expect(vertex.bulge).toBe(0.5)
    expect(vertex.startWidth).toBe(2.2)
    expect(vertex.endWidth).toBe(3.3)
    expect(vertex.vertexType).toBe(AcDb2dVertexType.CurveFitVertex)
  })

  it('returns a point-like extents box centered on position', () => {
    const vertex = new AcDb2dVertex()
    vertex.position = { x: 6, y: 7, z: 8 }

    const extents = vertex.geometricExtents

    expect(extents.min).toMatchObject({ x: 6, y: 7, z: 8 })
    expect(extents.max).toMatchObject({ x: 6, y: 7, z: 8 })
  })

  it('updates geometricExtents when position changes', () => {
    const vertex = new AcDb2dVertex()
    vertex.position = { x: 1, y: 2, z: 3 }

    expect(vertex.geometricExtents.min).toMatchObject({ x: 1, y: 2, z: 3 })

    vertex.position = { x: 9, y: -4, z: 6 }

    expect(vertex.geometricExtents.min).toMatchObject({ x: 9, y: -4, z: 6 })
    expect(vertex.geometricExtents.max).toMatchObject({ x: 9, y: -4, z: 6 })
  })

  it('returns one grip point and one osnap point at vertex position', () => {
    const vertex = new AcDb2dVertex()
    vertex.position = { x: 9, y: 10, z: 11 }

    const grips = vertex.subGetGripPoints()
    expect(grips).toHaveLength(1)
    expect(grips[0]).toBe(vertex.position)

    const snapPoints: AcGePoint3d[] = []
    vertex.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 1, 1),
      snapPoints
    )
    expect(snapPoints).toHaveLength(1)
    expect(snapPoints[0]).toBe(vertex.position)

    const nodeSnaps: AcGePoint3d[] = []
    vertex.subGetOsnapPoints(
      AcDbOsnapMode.Node,
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 1, 1),
      nodeSnaps
    )
    expect(nodeSnaps).toHaveLength(1)

    const unsupportedSnaps: AcGePoint3d[] = []
    vertex.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 1, 1),
      unsupportedSnaps
    )
    expect(unsupportedSnaps).toHaveLength(0)
  })

  it('transforms position and returns itself', () => {
    const vertex = new AcDb2dVertex()
    vertex.position = { x: 1, y: 2, z: 3 }

    const matrix = new AcGeMatrix3d().makeTranslation(4, -5, 6)
    const result = vertex.transformBy(matrix)

    expect(result).toBe(vertex)
    expect(vertex.position).toMatchObject({ x: 5, y: -3, z: 9 })
  })

  it('returns undefined from subWorldDraw because parent polyline draws it', () => {
    const vertex = new AcDb2dVertex()

    expect(vertex.subWorldDraw({} as never)).toBeUndefined()
  })

  it('writes DXF fields for AcDbVertex/AcDb2dVertex data and returns itself', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db

    const vertex = new AcDb2dVertex()
    db.tables.blockTable.modelSpace.appendEntity(vertex)
    vertex.position = { x: 1.25, y: 2.5, z: 3.75 }
    vertex.startWidth = 4.5
    vertex.endWidth = 5.5
    vertex.bulge = 0.25
    vertex.vertexType = AcDb2dVertexType.SplineFitVertex

    const filer = new AcDbDxfFiler()
    const result = vertex.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(vertex)
    expect(dxf).toContain('100\nAcDbVertex\n')
    expect(dxf).toContain('100\nAcDb2dVertex\n')
    expect(dxf).toContain('10\n1.25\n')
    expect(dxf).toContain('20\n2.5\n')
    expect(dxf).toContain('40\n4.5\n')
    expect(dxf).toContain('41\n5.5\n')
    expect(dxf).toContain('42\n0.25\n')
    expect(dxf).toContain('70\n8\n')
  })

  it('clone creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDb2dVertex())
  })
})

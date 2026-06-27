import {
  AcDbPolyFaceMeshFace,
  AcDbPolyFaceMeshVertex
} from '../src/entity/AcDbPolyFaceMesh'
import { AcDbPolygonMeshVertex } from '../src/entity/AcDbPolygonMesh'

describe('Mesh helper classes', () => {
  it('constructs polyface vertex and face', () => {
    const vertex = new AcDbPolyFaceMeshVertex({ x: 1, y: 2, z: 3 })
    const face = new AcDbPolyFaceMeshFace([1, 2, 3])

    expect(vertex.position.x).toBe(1)
    expect(vertex.position.y).toBe(2)
    expect(vertex.position.z).toBe(3)
    expect(face.vertexIndices).toEqual([1, 2, 3])
  })

  it('constructs polygon mesh vertex with default z', () => {
    const vertex = new AcDbPolygonMeshVertex({ x: 4, y: 5, z: 0 })
    expect(vertex.position.x).toBe(4)
    expect(vertex.position.y).toBe(5)
    expect(vertex.position.z).toBe(0)
  })
})

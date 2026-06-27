import { AcDbPolygonMeshVertex } from '../src/entity/AcDbPolygonMesh'

describe('AcDbPolygonMeshVertex', () => {
  it('stores vertex position with explicit z', () => {
    const vertex = new AcDbPolygonMeshVertex({ x: 1, y: 2, z: 3 })

    expect(vertex.position.x).toBe(1)
    expect(vertex.position.y).toBe(2)
    expect(vertex.position.z).toBe(3)
  })

  it('stores vertex position with default z fallback', () => {
    const vertex = new AcDbPolygonMeshVertex({ x: 4, y: 5, z: 0 })

    expect(vertex.position.x).toBe(4)
    expect(vertex.position.y).toBe(5)
    expect(vertex.position.z).toBe(0)
  })

  it('defaults z to 0 when omitted', () => {
    const vertex = new AcDbPolygonMeshVertex({ x: 10, y: 20 } as any)

    expect(vertex.position.x).toBe(10)
    expect(vertex.position.y).toBe(20)
    expect(vertex.position.z).toBe(0)
  })

  it('creates an internal AcGePoint3d instance instead of keeping external reference', () => {
    const source = { x: 5, y: 6, z: 7 }
    const vertex = new AcDbPolygonMeshVertex(source)

    source.x = 100
    source.y = 200
    source.z = 300

    expect(vertex.position.x).toBe(5)
    expect(vertex.position.y).toBe(6)
    expect(vertex.position.z).toBe(7)
  })
})

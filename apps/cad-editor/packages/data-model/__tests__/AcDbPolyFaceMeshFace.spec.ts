import { AcDbPolyFaceMeshFace } from '../src/entity/AcDbPolyFaceMesh'

describe('AcDbPolyFaceMeshFace', () => {
  it('stores face vertex indices as provided', () => {
    const face = new AcDbPolyFaceMeshFace([1, 2, 3])

    expect(face.vertexIndices).toEqual([1, 2, 3])
  })

  it('supports an empty face definition', () => {
    const face = new AcDbPolyFaceMeshFace([])

    expect(face.vertexIndices).toEqual([])
  })

  it('preserves index sign and zero values', () => {
    const face = new AcDbPolyFaceMeshFace([1, -2, 0, 4])

    expect(face.vertexIndices).toEqual([1, -2, 0, 4])
  })

  it('keeps the same vertexIndices array reference', () => {
    const indices = [1, 2, 3]
    const face = new AcDbPolyFaceMeshFace(indices)

    indices.push(4)

    expect(face.vertexIndices).toBe(indices)
    expect(face.vertexIndices).toEqual([1, 2, 3, 4])
  })

  it('allows replacing vertexIndices through the public field', () => {
    const face = new AcDbPolyFaceMeshFace([1, 2, 3])

    face.vertexIndices = [5, 6, 7, 8]

    expect(face.vertexIndices).toEqual([5, 6, 7, 8])
  })
})

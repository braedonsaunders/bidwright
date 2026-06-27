import { AcGePoint3d, AcGeVector3dLike } from '@mlightcad/geometry-engine'

/**
 * Invokes a grip move handler for each valid grip index.
 */
export function acdbForEachGripIndex(
  indices: readonly number[],
  moveAtIndex: (index: number) => void
) {
  for (const index of indices) {
    if (Number.isInteger(index) && index >= 0) {
      moveAtIndex(index)
    }
  }
}

/**
 * Moves the primary grip point at index 0.
 */
export function acdbMovePrimaryGripPointAt(
  indices: readonly number[],
  offset: AcGeVector3dLike,
  point: AcGePoint3d
) {
  acdbForEachGripIndex(indices, index => {
    if (index === 0) {
      point.add(offset)
    }
  })
}

/**
 * Moves one vertex on a 2D polyline geometry object.
 */
export function acdbMovePolyline2dVertexAt(
  vertices: Array<{ x: number; y: number }>,
  index: number,
  offset: AcGeVector3dLike
) {
  const vertex = vertices[index]
  if (!vertex) return
  vertex.x += offset.x
  vertex.y += offset.y
}

/**
 * Moves indexed points in a mutable point array.
 */
export function acdbMovePointArrayGripAt(
  indices: readonly number[],
  offset: AcGeVector3dLike,
  points: readonly AcGePoint3d[]
) {
  acdbForEachGripIndex(indices, index => {
    const point = points[index]
    if (point) {
      point.add(offset)
    }
  })
}
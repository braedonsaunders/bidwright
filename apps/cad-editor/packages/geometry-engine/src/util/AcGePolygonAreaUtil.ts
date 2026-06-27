import { AcGePoint2dLike } from '../math/AcGePoint2d'
import { AcGePoint3dLike } from '../math/AcGePoint3d'

/**
 * Computes the signed area of a 2D polygon using the shoelace formula.
 */
export function acGeSignedPolygonArea2d(points: AcGePoint2dLike[]): number {
  const count = points.length
  if (count < 3) return 0

  let area = 0
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const p1 = points[j]
    const p2 = points[i]
    area += p1.x * p2.y - p2.x * p1.y
  }

  return area * 0.5
}

/**
 * Computes the absolute area of a 2D polygon using the shoelace formula.
 */
export function acGePolygonArea2d(points: AcGePoint2dLike[]): number {
  return Math.abs(acGeSignedPolygonArea2d(points))
}

/**
 * Computes the area of a planar 3D polygon using Newell's method.
 */
export function acGePolygonArea3d(points: AcGePoint3dLike[]): number {
  const count = points.length
  if (count < 3) return 0

  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const p1 = points[j]
    const p2 = points[i]
    const x1 = p1.x
    const y1 = p1.y
    const z1 = p1.z ?? 0
    const x2 = p2.x
    const y2 = p2.y
    const z2 = p2.z ?? 0
    nx += (z1 + z2) * (y1 - y2)
    ny += (x1 + x2) * (z1 - z2)
    nz += (y1 + y2) * (x1 - x2)
  }

  return 0.5 * Math.hypot(nx, ny, nz)
}

/**
 * Returns the absolute polygon area for a closed loop, or `0` when the loop is
 * open or degenerate.
 */
export function acGeClosedPolygonArea2d(points: AcGePoint2dLike[]): number {
  if (points.length < 3) return 0
  return acGePolygonArea2d(points)
}

/**
 * Returns the absolute polygon area for a closed loop, or `0` when the loop is
 * open or degenerate.
 */
export function acGeClosedPolygonArea3d(points: AcGePoint3dLike[]): number {
  if (points.length < 3) return 0
  return acGePolygonArea3d(points)
}

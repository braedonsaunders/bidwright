import { AcGePolyline2d } from '../geometry/AcGePolyline2d'
import {
  offsetAcGePolyline2d,
  preparePolylineForOffset
} from '../geometry/AcGePolyline2dOffset'
import { AcGePoint3d, AcGePoint3dLike, AcGeVector3dLike } from '../math'
import { AcGePoint2d } from '../math/AcGePoint2d'
import { AcGeTol } from './AcGeTol'

/**
 * Offsets a point perpendicular to the XY projection of a direction vector.
 *
 * @param point - Base point to translate
 * @param direction - Direction whose XY component defines the offset normal
 * @param offsetDist - Signed offset distance in drawing units
 * @returns Translated point, or `null` when the XY direction is degenerate
 */
export function offsetPointByDirectionInXY(
  point: AcGePoint3dLike,
  direction: AcGeVector3dLike,
  offsetDist: number
): AcGePoint3d | null {
  const len = Math.hypot(direction.x, direction.y)
  if (AcGeTol.isNonPositive(len)) return null
  const nx = (-direction.y / len) * offsetDist
  const ny = (direction.x / len) * offsetDist
  return new AcGePoint3d(point.x + nx, point.y + ny, point.z)
}

/**
 * Offsets a planar vertex path in the XY plane.
 *
 * @param points - Sampled or vertex-derived 2D path
 * @param closed - Whether the path is treated as a closed polygon
 * @param offsetDist - Signed offset distance in drawing units
 * @returns The first offset polyline, or `null` when offsetting fails
 */
export function offsetVertexPath(
  points: AcGePoint2d[],
  closed: boolean,
  offsetDist: number
): AcGePolyline2d | null {
  if (points.length < 2) return null
  const polyline = preparePolylineForOffset(
    new AcGePolyline2d(
      points.map(point => ({ x: point.x, y: point.y })),
      closed
    )
  )
  const results = offsetAcGePolyline2d(polyline, offsetDist)
  return results[0] ?? null
}

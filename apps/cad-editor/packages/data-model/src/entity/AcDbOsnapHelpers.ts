import {
  AcGeCircArc2d,
  AcGeLine3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike
} from '@mlightcad/geometry-engine'

import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'

function distSq3d(a: AcGePoint3dLike, b: AcGePoint3dLike): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = (a.z || 0) - (b.z || 0)
  return dx * dx + dy * dy + dz * dz
}

/**
 * Picks the candidate snap point closest to the pick point.
 */
export function acdbPickNearestOsnapPoint(
  pickPoint: AcGePoint3dLike,
  candidates: readonly AcGePoint3dLike[]
): AcGePoint3d | undefined {
  if (candidates.length === 0) return undefined

  let best = new AcGePoint3d(
    candidates[0].x,
    candidates[0].y,
    candidates[0].z || 0
  )
  let bestDistSq = distSq3d(pickPoint, best)
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]
    const point = new AcGePoint3d(candidate.x, candidate.y, candidate.z || 0)
    const distSq = distSq3d(pickPoint, point)
    if (distSq < bestDistSq) {
      best = point
      bestDistSq = distSq
    }
  }
  return best
}

/**
 * Collects object snap points for one 3D line segment.
 */
export function acdbCollectLineSegmentOsnapPoints(
  start: AcGePoint3dLike,
  end: AcGePoint3dLike,
  osnapMode: AcDbOsnapMode,
  pickPoint: AcGePoint3dLike,
  snapPoints: AcGePoint3dLike[]
) {
  const startPoint = new AcGePoint3d(start.x, start.y, start.z || 0)
  const endPoint = new AcGePoint3d(end.x, end.y, end.z || 0)
  const line = new AcGeLine3d(startPoint, endPoint)

  switch (osnapMode) {
    case AcDbOsnapMode.EndPoint:
      snapPoints.push(startPoint, endPoint)
      break
    case AcDbOsnapMode.MidPoint:
      snapPoints.push(line.midPoint)
      break
    case AcDbOsnapMode.Nearest:
      snapPoints.push(line.nearestPoint(pickPoint))
      break
    case AcDbOsnapMode.Perpendicular:
      snapPoints.push(line.perpPoint(pickPoint))
      break
    default:
      break
  }
}

/**
 * Collects object snap points for one 2D polyline segment, including bulge arcs.
 */
export function acdbCollectPolyline2dSegmentOsnapPoints(
  start: AcGePoint2d,
  end: AcGePoint2d,
  bulge: number | undefined,
  elevation: number,
  osnapMode: AcDbOsnapMode,
  pickPoint: AcGePoint3dLike,
  snapPoints: AcGePoint3dLike[]
) {
  if (bulge) {
    const arc = new AcGeCircArc2d(start, end, bulge)
    switch (osnapMode) {
      case AcDbOsnapMode.EndPoint:
        snapPoints.push(
          new AcGePoint3d(arc.startPoint.x, arc.startPoint.y, elevation),
          new AcGePoint3d(arc.endPoint.x, arc.endPoint.y, elevation)
        )
        break
      case AcDbOsnapMode.MidPoint:
        snapPoints.push(
          new AcGePoint3d(arc.midPoint.x, arc.midPoint.y, elevation)
        )
        break
      case AcDbOsnapMode.Nearest: {
        const nearest = arc.nearestPoint({ x: pickPoint.x, y: pickPoint.y })
        snapPoints.push(new AcGePoint3d(nearest.x, nearest.y, elevation))
        break
      }
      case AcDbOsnapMode.Perpendicular: {
        const perpPoints = arc.perpendicularPoints({
          x: pickPoint.x,
          y: pickPoint.y
        })
        perpPoints.forEach(point =>
          snapPoints.push(new AcGePoint3d(point.x, point.y, elevation))
        )
        break
      }
      case AcDbOsnapMode.Tangent: {
        const tangentPoints = arc.tangentPoints({
          x: pickPoint.x,
          y: pickPoint.y
        })
        tangentPoints.forEach(point =>
          snapPoints.push(new AcGePoint3d(point.x, point.y, elevation))
        )
        break
      }
      default:
        break
    }
    return
  }

  acdbCollectLineSegmentOsnapPoints(
    new AcGePoint3d(start.x, start.y, elevation),
    new AcGePoint3d(end.x, end.y, elevation),
    osnapMode,
    pickPoint,
    snapPoints
  )
}

/**
 * Collects object snap points along a 3D vertex path.
 */
export function acdbCollectVertexPathOsnapPoints(
  vertices: readonly AcGePoint3dLike[],
  closed: boolean,
  osnapMode: AcDbOsnapMode,
  pickPoint: AcGePoint3dLike,
  snapPoints: AcGePoint3dLike[]
) {
  if (vertices.length === 0) return

  switch (osnapMode) {
    case AcDbOsnapMode.EndPoint:
      vertices.forEach(vertex =>
        snapPoints.push(new AcGePoint3d(vertex.x, vertex.y, vertex.z || 0))
      )
      break
    case AcDbOsnapMode.MidPoint:
    case AcDbOsnapMode.Nearest:
    case AcDbOsnapMode.Perpendicular: {
      const segmentCount = closed ? vertices.length : vertices.length - 1
      const candidates: AcGePoint3d[] = []
      for (let index = 0; index < segmentCount; index++) {
        const segmentSnaps: AcGePoint3d[] = []
        acdbCollectLineSegmentOsnapPoints(
          vertices[index],
          vertices[(index + 1) % vertices.length],
          osnapMode,
          pickPoint,
          segmentSnaps
        )
        candidates.push(...segmentSnaps)
      }
      if (osnapMode === AcDbOsnapMode.MidPoint) {
        snapPoints.push(...candidates)
      } else {
        const nearest = acdbPickNearestOsnapPoint(pickPoint, candidates)
        if (nearest) snapPoints.push(nearest)
      }
      break
    }
    default:
      break
  }
}

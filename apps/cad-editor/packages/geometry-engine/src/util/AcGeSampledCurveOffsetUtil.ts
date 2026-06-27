import { AcGePolyline2d } from '../geometry/AcGePolyline2d'
import { AcGePoint2d } from '../math/AcGePoint2d'
import { AcGeTol, DEFAULT_TOL } from './AcGeTol'

/** Intersection of two non-adjacent polyline segments during loop trimming. */
type SegmentIntersection = {
  /** Intersection point in WCS (XY). */
  point: AcGePoint2d
  /** Index of the first intersecting segment (segment `i` connects `points[i]` to `points[i+1]`). */
  segmentA: number
  /** Index of the second intersecting segment. */
  segmentB: number
}

/**
 * Offsets a densely sampled smooth curve path in the XY plane.
 *
 * Unlike vertex polyline offset (parallel edges with miter joins), each sample
 * is shifted along the local left normal. Self-intersecting loops that appear
 * when the offset distance exceeds the local radius of curvature are trimmed.
 *
 * Sign convention: positive `offsetDist` offsets to the left of the travel
 * direction along the sampled path (consistent with {@link offsetAcGePolyline2d}).
 *
 * @param points - Sampled path points in travel order
 * @param closed - Whether the path is treated as a closed polygon for trimming
 * @param offsetDist - Signed offset distance in drawing units (left = positive)
 * @param tangents - Optional unit tangents aligned with `points`; when omitted,
 * tangents are estimated from neighboring samples via central differences
 * @returns Offset polyline, or `null` when input is degenerate or offset distance is zero
 */
export function offsetSmoothedSampledPath(
  points: AcGePoint2d[],
  closed: boolean,
  offsetDist: number,
  tangents?: AcGePoint2d[]
): AcGePolyline2d | null {
  if (points.length < 2 || AcGeTol.equalToZero(offsetDist)) return null

  const { points: source, tangents: sourceTangents } = dedupeConsecutiveSamples(
    points,
    tangents
  )
  if (source.length < 2) return null

  const resolvedTangents =
    sourceTangents ?? computePathSampleTangents(source, closed)
  const offsetPoints = offsetPointsByNormals(
    source,
    resolvedTangents,
    offsetDist
  )
  const trimmed = closed
    ? trimClosedPolylineSelfIntersections(offsetPoints)
    : trimOpenPolylineSelfIntersections(offsetPoints)

  if (trimmed.length < 2) return null

  const result = new AcGePolyline2d()
  trimmed.forEach((point, index) => {
    result.addVertexAt(index, { x: point.x, y: point.y })
  })
  result.closed = closed
  return result
}

/**
 * Computes unit tangents for a sampled path using central differences.
 *
 * Open paths use one-sided differences at endpoints and central differences
 * at interior samples. Closed paths wrap the predecessor of the first point
 * and the successor of the last.
 *
 * @param points - Sampled path vertices in travel order
 * @param closed - Whether the path wraps from last point back to first
 * @returns Unit tangent at each sample; degenerate segments fall back to `(1, 0)`
 */
function computePathSampleTangents(
  points: AcGePoint2d[],
  closed: boolean
): AcGePoint2d[] {
  const count = points.length
  const tangents: AcGePoint2d[] = new Array(count)

  for (let i = 0; i < count; i++) {
    let dx = 0
    let dy = 0

    if (closed) {
      const prev = points[(i - 1 + count) % count]
      const next = points[(i + 1) % count]
      dx = next.x - prev.x
      dy = next.y - prev.y
    } else if (i === 0) {
      dx = points[1].x - points[0].x
      dy = points[1].y - points[0].y
    } else if (i === count - 1) {
      dx = points[count - 1].x - points[count - 2].x
      dy = points[count - 1].y - points[count - 2].y
    } else {
      dx = points[i + 1].x - points[i - 1].x
      dy = points[i + 1].y - points[i - 1].y
    }

    const len = Math.hypot(dx, dy)
    if (AcGeTol.isNonPositive(len)) {
      tangents[i] = new AcGePoint2d(1, 0)
    } else {
      tangents[i] = new AcGePoint2d(dx / len, dy / len)
    }
  }

  return tangents
}

/**
 * Offsets each sample along the left normal of its tangent.
 *
 * The left normal of a unit tangent `(tx, ty)` is `(-ty, tx)`, scaled by
 * `offsetDist` and added to the sample position.
 *
 * @param points - Source samples in travel order
 * @param tangents - Unit tangents aligned index-for-index with `points`
 * @param offsetDist - Signed offset distance in drawing units
 * @returns Translated samples forming the raw offset polyline before trimming
 */
function offsetPointsByNormals(
  points: AcGePoint2d[],
  tangents: AcGePoint2d[],
  offsetDist: number
): AcGePoint2d[] {
  return points.map((point, index) => {
    const tangent = tangents[index]
    const nx = -tangent.y * offsetDist
    const ny = tangent.x * offsetDist
    return new AcGePoint2d(point.x + nx, point.y + ny)
  })
}

/**
 * Removes self-intersecting loops from an open offset polyline.
 *
 * Repeatedly finds the earliest non-adjacent segment crossing and replaces the
 * enclosed vertex chain with the intersection point until no crossings remain.
 * This produces cusp-style joins when the offset distance exceeds the local
 * radius of curvature at concave bends.
 *
 * @param points - Raw offset samples connected in order
 * @returns Trimmed open vertex chain with loops removed
 */
function trimOpenPolylineSelfIntersections(
  points: AcGePoint2d[]
): AcGePoint2d[] {
  let current = dedupeConsecutivePoints(points)
  if (current.length < 3) return current

  while (true) {
    const hit = findFirstSelfIntersection(current, false)
    if (!hit) break
    current = dedupeConsecutivePoints([
      ...current.slice(0, hit.segmentA + 1),
      hit.point,
      ...current.slice(hit.segmentB + 1)
    ])
    if (current.length < 2) break
  }

  return current
}

/**
 * Removes self-intersecting loops from a closed offset polyline.
 *
 * Uses the same earliest-intersection trimming strategy as
 * {@link trimOpenPolylineSelfIntersections}, but treats the last-to-first
 * segment as part of the closed ring.
 *
 * @param points - Raw offset samples forming a closed ring
 * @returns Trimmed closed vertex chain with loops removed
 */
function trimClosedPolylineSelfIntersections(
  points: AcGePoint2d[]
): AcGePoint2d[] {
  let current = dedupeConsecutivePoints(points)
  if (current.length < 4) return current

  while (true) {
    const hit = findFirstSelfIntersection(current, true)
    if (!hit) break
    current = dedupeConsecutivePoints([
      ...current.slice(0, hit.segmentA + 1),
      hit.point,
      ...current.slice(hit.segmentB + 1)
    ])
    if (current.length < 3) break
  }

  return current
}

/**
 * Finds the earliest non-adjacent segment intersection in a polyline.
 *
 * Segments are tested in lexicographic order `(segmentA, segmentB)` so trimming
 * removes the innermost loop encountered first along the path.
 *
 * @param points - Polyline vertices in order
 * @param closed - Whether the polyline wraps from last vertex back to first
 * @returns Intersection data, or `null` when no crossing exists
 */
function findFirstSelfIntersection(
  points: AcGePoint2d[],
  closed: boolean
): SegmentIntersection | null {
  const segmentCount = closed ? points.length : points.length - 1
  if (segmentCount < 2) return null

  for (let i = 0; i < segmentCount; i++) {
    const a0 = points[i]
    const a1 = points[(i + 1) % points.length]

    for (let j = i + 1; j < segmentCount; j++) {
      if (areAdjacentSegments(i, j, segmentCount, closed)) continue

      const b0 = points[j]
      const b1 = points[(j + 1) % points.length]
      const point = intersectBoundedSegments(a0, a1, b0, b1)
      if (point) {
        return { point, segmentA: i, segmentB: j }
      }
    }
  }

  return null
}

/**
 * Tests whether two segment indices share a vertex and should be skipped
 * during self-intersection search.
 *
 * @param i - Index of the first segment
 * @param j - Index of the second segment
 * @param segmentCount - Total number of segments in the polyline
 * @param closed - Whether the polyline is closed
 * @returns `true` when the segments are identical or share an endpoint
 */
function areAdjacentSegments(
  i: number,
  j: number,
  segmentCount: number,
  closed: boolean
): boolean {
  if (j === i) return true
  if (j === i + 1) return true
  if (closed && i === 0 && j === segmentCount - 1) return true
  return false
}

/**
 * Computes the intersection point of two bounded line segments, if any.
 *
 * Uses parametric line intersection and requires both parameters to lie in
 * `[0, 1]` within {@link DEFAULT_TOL}. Parallel or collinear segments return
 * `null`.
 *
 * @param a0 - Start of the first segment
 * @param a1 - End of the first segment
 * @param b0 - Start of the second segment
 * @param b1 - End of the second segment
 * @returns Intersection point, or `null` when segments do not cross
 */
function intersectBoundedSegments(
  a0: AcGePoint2d,
  a1: AcGePoint2d,
  b0: AcGePoint2d,
  b1: AcGePoint2d
): AcGePoint2d | null {
  const dx1 = a1.x - a0.x
  const dy1 = a1.y - a0.y
  const dx2 = b1.x - b0.x
  const dy2 = b1.y - b0.y
  const det = dx1 * dy2 - dy1 * dx2
  if (AcGeTol.equalToZero(det)) return null

  const qpx = b0.x - a0.x
  const qpy = b0.y - a0.y
  const t = (qpx * dy2 - qpy * dx2) / det
  const u = (qpx * dy1 - qpy * dx1) / det

  const tol = DEFAULT_TOL.equalPointTol
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) {
    return null
  }

  return new AcGePoint2d(a0.x + t * dx1, a0.y + t * dy1)
}

/**
 * Removes consecutive duplicate samples while keeping tangents aligned.
 *
 * When `tangents` is provided with the same length as `points`, tangents
 * corresponding to dropped duplicates are removed as well.
 *
 * @param points - Input sample chain, possibly containing consecutive duplicates
 * @param tangents - Optional unit tangents aligned with `points`
 * @returns Deduplicated points and, when supplied, matching tangents
 */
function dedupeConsecutiveSamples(
  points: AcGePoint2d[],
  tangents?: AcGePoint2d[]
): { points: AcGePoint2d[]; tangents?: AcGePoint2d[] } {
  const resultPoints: AcGePoint2d[] = []
  const resultTangents: AcGePoint2d[] = []
  const keepTangents = tangents != null && tangents.length === points.length

  points.forEach((point, index) => {
    const last = resultPoints[resultPoints.length - 1]
    if (
      !last ||
      AcGeTol.isPositive(Math.hypot(last.x - point.x, last.y - point.y))
    ) {
      resultPoints.push(new AcGePoint2d(point.x, point.y))
      if (keepTangents) {
        const tangent = tangents![index]
        resultTangents.push(new AcGePoint2d(tangent.x, tangent.y))
      }
    }
  })

  return {
    points: resultPoints,
    tangents: keepTangents ? resultTangents : undefined
  }
}

/**
 * Removes consecutive duplicate vertices from a point chain.
 *
 * @param points - Input vertex chain
 * @returns New array with only distinct consecutive points
 */
function dedupeConsecutivePoints(points: AcGePoint2d[]): AcGePoint2d[] {
  return dedupeConsecutiveSamples(points).points
}

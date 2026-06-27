import { AcGePoint2d } from '../math/AcGePoint2d'
import { AcGeMathUtil, AcGeTol, TAU } from '../util'
import { AcGeCircArc2d } from './AcGeCircArc2d'
import { AcGePolyline2d } from './AcGePolyline2d'

/** Epsilon for circle–circle intersection and tangency tests during arc joins. */
const ROUND_JOIN_POINT_EPSILON = 1e-6

/** Parallel offset of a straight polyline edge, retaining the original edge direction. */
type PolylineOffsetSegment = {
  start: AcGePoint2d
  end: AcGePoint2d
  dx: number
  dy: number
}

/** A single edge of a polyline in the XY plane, either a line chord or a bulge arc. */
type PlanarSegment =
  | { kind: 'line'; start: AcGePoint2d; end: AcGePoint2d }
  | { kind: 'arc'; arc: AcGeCircArc2d }

/** Offset geometry for one planar segment, preserving segment kind. */
type OffsetSegment =
  | {
      kind: 'line'
      start: AcGePoint2d
      end: AcGePoint2d
      dx: number
      dy: number
    }
  | { kind: 'arc'; arc: AcGeCircArc2d }

/** Connection data at a vertex between two consecutive offset segments. */
type SegmentJoinInfo = {
  /** Point where the previous offset segment meets the join */
  point: AcGePoint2d
  /** Round-join samples between mixed line/arc offsets (excludes endpoints) */
  filletPoints?: AcGePoint2d[]
  /** Where the next offset segment should start when it differs from `point` */
  nextSegmentStart?: AcGePoint2d
}

/**
 * Creates offset curves for a 2D polyline in the XY plane.
 *
 * Routing depends on polyline content:
 * - Polylines with bulge (arc) segments use analytic line/arc offset and custom joins.
 * - Vertex-only polylines (open or closed) use parallel edge offset with miter intersections.
 *
 * Sign convention: positive `offsetDist` offsets to the left of the travel direction
 * along each segment (consistent with AutoCAD-style polyline offset).
 *
 * @param polyline - Source polyline; may be open or closed, with or without bulge arcs
 * @param offsetDist - Signed offset distance in drawing units (left = positive)
 * @returns One or more offset polylines; empty array when offsetting fails or input is degenerate
 */
export function offsetAcGePolyline2d(
  polyline: AcGePolyline2d,
  offsetDist: number
): AcGePolyline2d[] {
  if (hasArcSegments(polyline)) {
    const result = offsetPolylineWithArcSegments(polyline, offsetDist)
    return result ? [result] : []
  }

  const source = normalizeVertexPolyline(polyline)
  const n = source.numberOfVertices
  if (n < 2) return []

  const result = createVertexOnlyPolylineOffset(source, offsetDist)
  return result ? [result] : []
}

/**
 * Normalizes a vertex-only polyline before offset or other geometric processing.
 *
 * Removes consecutive duplicate vertices and, for closed paths, drops a closing
 * vertex that coincides with the first vertex so downstream algorithms see a
 * minimal vertex ring.
 *
 * @param polyline - Input polyline (typically straight segments only)
 * @returns The same instance if already normalized, otherwise a new polyline with cleaned vertices
 */
export function preparePolylineForOffset(
  polyline: AcGePolyline2d
): AcGePolyline2d {
  return normalizeVertexPolyline(polyline)
}

/**
 * Offsets a polyline that contains one or more bulge-defined arc segments.
 *
 * Each segment is offset individually (parallel line or concentric arc), then
 * segment ends are joined at original vertices with miter, tangent, or round
 * fallbacks as appropriate.
 *
 * @param polyline - Source polyline with at least one non-zero bulge
 * @param offsetDist - Signed offset distance in drawing units
 * @returns A single closed or open offset polyline, or `null` if any segment offset or join fails
 */
function offsetPolylineWithArcSegments(
  polyline: AcGePolyline2d,
  offsetDist: number
): AcGePolyline2d | null {
  const segments = collectPlanarSegments(polyline)
  if (segments.length === 0) return null

  const offsetSegments: OffsetSegment[] = []
  for (const segment of segments) {
    const offsetSegment = offsetPlanarSegment(segment, offsetDist)
    if (!offsetSegment) return null
    offsetSegments.push(offsetSegment)
  }

  const joinVertices = collectJoinVertices(polyline)
  const points = buildJoinedOffsetPath(
    offsetSegments,
    joinVertices,
    polyline.closed,
    offsetDist
  )
  if (points.length < 2) return null

  const result = new AcGePolyline2d()
  points.forEach((point, index) => {
    result.addVertexAt(index, { x: point.x, y: point.y })
  })
  result.closed = polyline.closed
  return result
}

/**
 * Decomposes a polyline into ordered planar segments in traversal order.
 *
 * Each edge from vertex `i` to `(i + 1) % n` becomes either a line chord (zero bulge)
 * or a circular arc constructed from start vertex, end vertex, and bulge.
 *
 * @param polyline - Source polyline
 * @returns Array of line and arc segments; empty when the polyline has fewer than two vertices (open) or one vertex (closed)
 */
function collectPlanarSegments(polyline: AcGePolyline2d): PlanarSegment[] {
  const segments: PlanarSegment[] = []
  const count = polyline.numberOfVertices
  const segmentCount = polyline.closed ? count : count - 1

  for (let i = 0; i < segmentCount; i++) {
    const start = polyline.vertices[i]
    const end = polyline.vertices[(i + 1) % count]
    if (AcGeTol.isPositive(Math.abs(start.bulge ?? 0))) {
      segments.push({
        kind: 'arc',
        arc: new AcGeCircArc2d(start, end, start.bulge!)
      })
    } else {
      segments.push({
        kind: 'line',
        start: new AcGePoint2d(start.x, start.y),
        end: new AcGePoint2d(end.x, end.y)
      })
    }
  }

  return segments
}

/**
 * Collects the 2D positions of all polyline vertices in index order.
 *
 * Used as join anchors when connecting offset segments at original corners.
 *
 * @param polyline - Source polyline
 * @returns Clone-free point list matching `polyline.numberOfVertices` entries
 */
function collectJoinVertices(polyline: AcGePolyline2d): AcGePoint2d[] {
  const vertices: AcGePoint2d[] = []
  for (let i = 0; i < polyline.numberOfVertices; i++) {
    vertices.push(polyline.getPointAt(i))
  }
  return vertices
}

/**
 * Offsets a single planar segment by the signed distance.
 *
 * @param segment - Line chord or bulge arc segment
 * @param offsetDist - Signed offset distance (left of travel = positive)
 * @returns Offset line (with direction vector) or offset arc, or `null` if degenerate
 */
function offsetPlanarSegment(
  segment: PlanarSegment,
  offsetDist: number
): OffsetSegment | null {
  if (segment.kind === 'line') {
    const offsetLine = offsetLineSegment(segment.start, segment.end, offsetDist)
    if (!offsetLine) return null
    return { kind: 'line', ...offsetLine }
  }

  const offsetArc = offsetCircArc2d(
    segment.arc,
    segment.arc.startPoint,
    segment.arc.endPoint,
    offsetDist
  )
  if (!offsetArc) return null
  return { kind: 'arc', arc: offsetArc }
}

/**
 * Builds a concentric circular arc at the requested offset from a source arc.
 *
 * Radius change follows the same left-hand rule as line offset via {@link getArcRadiusDelta}.
 *
 * @param arc - Source circular arc
 * @param start - Start point of the arc segment (chord start)
 * @param end - End point of the arc segment (chord end)
 * @param offsetDist - Signed offset distance
 * @returns New arc sharing center and angles, or `null` if the offset radius is non-positive
 */
function offsetCircArc2d(
  arc: AcGeCircArc2d,
  start: AcGePoint2d,
  end: AcGePoint2d,
  offsetDist: number
): AcGeCircArc2d | null {
  const radiusDelta = getArcRadiusDelta(arc, start, end, offsetDist)
  const radius = arc.radius + radiusDelta
  if (AcGeTol.isNonPositive(radius)) return null
  return new AcGeCircArc2d(
    arc.center,
    radius,
    arc.startAngle,
    arc.endAngle,
    arc.clockwise
  )
}

/**
 * Computes the signed radius change for a concentric arc offset.
 *
 * Applies the same left-hand offset rule used for line segments: positive
 * `offsetDist` shifts the arc to the left of its travel direction.
 *
 * Concentric offset direction depends on which side of the chord the center
 * lies: when the center is on the left, shrink the radius; when on the right,
 * expand it. Degenerate zero-length chords fall back to clockwise flag only.
 *
 * @param arc - Source circular arc
 * @param start - Chord start point
 * @param end - Chord end point
 * @param offsetDist - Signed offset distance
 * @returns Signed delta to add to `arc.radius` (not the new radius itself)
 */
function getArcRadiusDelta(
  arc: AcGeCircArc2d,
  start: AcGePoint2d,
  end: AcGePoint2d,
  offsetDist: number
): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (AcGeTol.isNonPositive(len)) {
    return arc.clockwise ? -offsetDist : offsetDist
  }

  const leftNx = -dy / len
  const leftNy = dx / len
  const toCenterX = arc.center.x - (start.x + end.x) / 2
  const toCenterY = arc.center.y - (start.y + end.y) / 2
  const centerOnLeft = toCenterX * leftNx + toCenterY * leftNy > 0

  return centerOnLeft ? -offsetDist : offsetDist
}

/**
 * Offsets a finite line segment parallel to itself.
 *
 * The offset direction is the left normal scaled by `offsetDist`. The returned
 * `dx`/`dy` match the original edge direction for use in later miter joins.
 *
 * @param start - Segment start
 * @param end - Segment end
 * @param offsetDist - Signed offset distance
 * @returns Offset endpoints plus original direction components, or `null` if the segment length is zero
 */
function offsetLineSegment(
  start: AcGePoint2d,
  end: AcGePoint2d,
  offsetDist: number
): { start: AcGePoint2d; end: AcGePoint2d; dx: number; dy: number } | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy)
  if (AcGeTol.isNonPositive(len)) return null

  const nx = (-dy / len) * offsetDist
  const ny = (dx / len) * offsetDist
  return {
    start: new AcGePoint2d(start.x + nx, start.y + ny),
    end: new AcGePoint2d(end.x + nx, end.y + ny),
    dx,
    dy
  }
}

/**
 * Assembles a continuous polyline path from offset segments and per-vertex join data.
 *
 * Walks segments in order, emitting join points, optional round fillet samples,
 * and interior samples along offset arcs between join limits.
 *
 * @param offsetSegments - Per-edge offset geometry in path order
 * @param joinVertices - Original polyline vertices used as join anchors
 * @param closed - Whether the path wraps from last segment back to first
 * @param offsetDist - Signed offset distance (used for round-join radius)
 * @returns Ordered vertex chain with consecutive duplicates removed
 */
function buildJoinedOffsetPath(
  offsetSegments: OffsetSegment[],
  joinVertices: AcGePoint2d[],
  closed: boolean,
  offsetDist: number
): AcGePoint2d[] {
  const count = offsetSegments.length
  if (count === 0) return []

  const joins = computeSegmentJoins(
    offsetSegments,
    joinVertices,
    closed,
    offsetDist
  )
  const points: AcGePoint2d[] = [
    joins[0].nextSegmentStart?.clone() ?? joins[0].point.clone()
  ]

  for (let i = 0; i < count; i++) {
    const segment = offsetSegments[i]
    const joinAtEnd =
      i === count - 1 && !closed
        ? {
            point: getOffsetSegmentEnd(segment)
          }
        : joins[(i + 1) % count]

    if (i > 0 && joins[i].filletPoints) {
      joins[i].filletPoints!.forEach(point => points.push(point.clone()))
    }

    if (segment.kind === 'arc') {
      const arcStart = joins[i].nextSegmentStart ?? joins[i].point
      const arcEnd = joinAtEnd.point
      const arcSamples = sampleArcBetweenPoints(
        segment.arc,
        arcStart,
        arcEnd,
        Math.max(16, 32)
      )
      for (let j = 1; j < arcSamples.length; j++) {
        points.push(arcSamples[j])
      }
    } else {
      points.push(joinAtEnd.point.clone())
    }
  }

  return dedupeConsecutivePoints(points)
}

/**
 * Computes join information at every vertex between consecutive offset segments.
 *
 * For closed polylines, index `0` joins the last and first offset segments at
 * `joinVertices[0]`. For open polylines, the start uses the first segment's
 * offset start without a prior join.
 *
 * @param offsetSegments - Offset segments in path order
 * @param joinVertices - Original corner vertices
 * @param closed - Whether the polyline is closed
 * @param offsetDist - Signed offset distance for round joins
 * @returns One {@link SegmentJoinInfo} per segment, aligned with segment indices
 */
function computeSegmentJoins(
  offsetSegments: OffsetSegment[],
  joinVertices: AcGePoint2d[],
  closed: boolean,
  offsetDist: number
): SegmentJoinInfo[] {
  const count = offsetSegments.length
  const joins: SegmentJoinInfo[] = []

  for (let i = 0; i < count; i++) {
    if (i === 0) {
      joins.push(
        closed
          ? joinOffsetSegments(
              offsetSegments[count - 1],
              offsetSegments[0],
              joinVertices[0],
              offsetDist
            )
          : { point: getOffsetSegmentStart(offsetSegments[0]) }
      )
    } else {
      joins.push(
        joinOffsetSegments(
          offsetSegments[i - 1],
          offsetSegments[i],
          joinVertices[i],
          offsetDist
        )
      )
    }
  }

  return joins
}

/**
 * Samples points along a circular arc between two arbitrary points on the arc.
 *
 * Projects `start` and `end` onto the arc, measures sweep in internal angle
 * space, and interpolates at uniform parameter steps. Endpoints are included.
 *
 * @param arc - Circular arc to sample
 * @param start - Approximate start of the sampled span (need not lie exactly on the arc)
 * @param end - Approximate end of the sampled span
 * @param numPoints - Number of interior divisions (total samples = `numPoints + 1`)
 * @returns Polyline of sampled points from start to end along the arc
 */
function sampleArcBetweenPoints(
  arc: AcGeCircArc2d,
  start: AcGePoint2d,
  end: AcGePoint2d,
  numPoints: number
): AcGePoint2d[] {
  const startOnArc = arc.nearestPoint(start)
  const endOnArc = arc.nearestPoint(end)
  const startInternal = internalAngleAtPoint(arc, startOnArc)
  const endInternal = internalAngleAtPoint(arc, endOnArc)
  const sweep = sweepAlongArc(arc, startInternal, endInternal)
  const points: AcGePoint2d[] = []

  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints
    const internalAngle = arc.clockwise
      ? startInternal - sweep * t
      : startInternal + sweep * t
    points.push(
      arc.getPointAtAngle(publicAngleFromInternal(arc, internalAngle))
    )
  }

  return points
}

/**
 * Returns the mathematical polar angle from the arc center to a point.
 *
 * @param arc - Circular arc providing the center
 * @param point - Point in the arc plane
 * @returns Angle in radians in `[-π, π]`, consistent with `Math.atan2`
 */
function internalAngleAtPoint(arc: AcGeCircArc2d, point: AcGePoint2d): number {
  return Math.atan2(point.y - arc.center.y, point.x - arc.center.x)
}

/**
 * Converts an internal (mathematical) angle to the public angle used by {@link AcGeCircArc2d}.
 *
 * Counterclockwise arcs use normalized mathematical angles; clockwise arcs apply
 * the arc's mirrored angle convention.
 *
 * @param arc - Circular arc defining clockwise vs counterclockwise storage
 * @param internalAngle - Angle in internal/mathematical space
 * @returns Angle suitable for `arc.getPointAtAngle`
 */
function publicAngleFromInternal(
  arc: AcGeCircArc2d,
  internalAngle: number
): number {
  const normalized = AcGeMathUtil.normalizeAngle(internalAngle)
  return arc.clockwise ? mirrorAngle(normalized) : normalized
}

/**
 * Mirrors a mathematical angle into the clockwise arc angle convention.
 *
 * @param angle - Angle in radians (mathematical convention)
 * @returns Mirrored angle in radians for clockwise arc parameterization
 */
function mirrorAngle(angle: number): number {
  const degrees = (angle * 180) / Math.PI
  return ((360 - degrees) % 360) * (Math.PI / 180)
}

/**
 * Computes the positive sweep from one internal angle to another along the arc.
 *
 * @param arc - Circular arc (direction from `clockwise`)
 * @param fromInternal - Start internal angle
 * @param toInternal - End internal angle
 * @returns Positive sweep magnitude in radians along the arc direction
 */
function sweepAlongArc(
  arc: AcGeCircArc2d,
  fromInternal: number,
  toInternal: number
): number {
  if (arc.clockwise) {
    let sweep = fromInternal - toInternal
    if (AcGeTol.isNonPositive(sweep)) {
      sweep += TAU
    }
    return sweep
  }

  let sweep = toInternal - fromInternal
  if (AcGeTol.isNonPositive(sweep)) {
    sweep += TAU
  }
  return sweep
}

/**
 * Returns the start point of an offset segment in path order.
 *
 * @param segment - Line or arc offset segment
 * @returns Cloned start point of the offset geometry
 */
function getOffsetSegmentStart(segment: OffsetSegment): AcGePoint2d {
  return segment.kind === 'line'
    ? segment.start.clone()
    : segment.arc.startPoint.clone()
}

/**
 * Returns the end point of an offset segment in path order.
 *
 * @param segment - Line or arc offset segment
 * @returns Cloned end point of the offset geometry
 */
function getOffsetSegmentEnd(segment: OffsetSegment): AcGePoint2d {
  return segment.kind === 'line'
    ? segment.end.clone()
    : segment.arc.endPoint.clone()
}

/**
 * Resolves the connection between two consecutive offset segments at a corner vertex.
 *
 * Dispatches to line–line miter, line–arc, arc–line, or arc–arc join logic.
 * Falls back to the original vertex when segment kinds are unexpected.
 *
 * @param previous - Offset segment entering the vertex
 * @param next - Offset segment leaving the vertex
 * @param vertex - Original polyline corner
 * @param offsetDist - Signed offset distance (magnitude used for round joins)
 * @returns Join point and optional fillet bridging to the next segment
 */
function joinOffsetSegments(
  previous: OffsetSegment,
  next: OffsetSegment,
  vertex: AcGePoint2d,
  offsetDist: number
): SegmentJoinInfo {
  if (previous.kind === 'line' && next.kind === 'line') {
    return {
      point: intersectPolylineOffsetSegments(
        {
          start: previous.start,
          end: previous.end,
          dx: previous.dx,
          dy: previous.dy
        },
        {
          start: next.start,
          end: next.end,
          dx: next.dx,
          dy: next.dy
        }
      )
    }
  }

  if (previous.kind === 'line' && next.kind === 'arc') {
    return joinLineWithArcOffset(previous, next.arc, vertex, offsetDist, true)
  }

  if (previous.kind === 'arc' && next.kind === 'line') {
    return joinLineWithArcOffset(next, previous.arc, vertex, offsetDist, false)
  }

  if (previous.kind === 'arc' && next.kind === 'arc') {
    return joinArcWithArcOffset(previous.arc, next.arc, vertex, offsetDist)
  }

  return { point: vertex.clone() }
}

/**
 * Joins two offset circular arcs meeting at a common vertex.
 *
 * Prefers a point on both offset arcs near the gap midpoint (circle–circle
 * intersection). If none exists, inserts a round join sampled around the vertex.
 *
 * @param previous - Offset arc ending at the vertex
 * @param next - Offset arc starting at the vertex
 * @param vertex - Original corner vertex
 * @param offsetDist - Signed offset distance (absolute value = fillet radius)
 * @returns Miter point on both arcs, or round join with separate segment endpoints
 */
function joinArcWithArcOffset(
  previous: AcGeCircArc2d,
  next: AcGeCircArc2d,
  vertex: AcGePoint2d,
  offsetDist: number
): SegmentJoinInfo {
  const near = midpoint(previous.endPoint, next.startPoint)
  const candidates = intersectOffsetCircles(previous, next)
  const onBoth = candidates.filter(
    candidate =>
      isPointOnArc(previous, candidate) && isPointOnArc(next, candidate)
  )

  if (onBoth.length > 0) {
    return { point: pickClosestPoint(onBoth, near) }
  }

  const from = previous.endPoint.clone()
  const to = next.startPoint.clone()
  const filletPoints = sampleVertexRoundJoin(
    vertex,
    Math.abs(offsetDist),
    from,
    to
  )

  return {
    point: from,
    filletPoints,
    nextSegmentStart: to
  }
}

/**
 * Joins an offset line segment with an offset arc at a shared vertex.
 *
 * @param line - Offset line segment (includes direction `dx`/`dy`)
 * @param arc - Offset circular arc on the other side of the vertex
 * @param vertex - Original corner vertex
 * @param offsetDist - Signed offset distance
 * @param lineBeforeArc - `true` if `line` is the incoming segment and `arc` is outgoing
 * @returns Intersection on both primitives, or round join with optional `nextSegmentStart`
 */
function joinLineWithArcOffset(
  line: {
    start: AcGePoint2d
    end: AcGePoint2d
    dx: number
    dy: number
  },
  arc: AcGeCircArc2d,
  vertex: AcGePoint2d,
  offsetDist: number,
  lineBeforeArc: boolean
): SegmentJoinInfo {
  const near = midpoint(
    lineBeforeArc ? line.end : line.start,
    lineBeforeArc ? arc.startPoint : arc.endPoint
  )
  const intersection = intersectLineWithCircle(line, arc, near)

  if (
    isPointOnOffsetLine(line, intersection) &&
    isPointOnArc(arc, intersection)
  ) {
    return { point: intersection }
  }

  const lineSide = getLineOffsetPointAtVertex(line, vertex, offsetDist)
  const arcSide = lineBeforeArc ? arc.startPoint.clone() : arc.endPoint.clone()
  const filletPoints = sampleVertexRoundJoin(
    vertex,
    Math.abs(offsetDist),
    lineBeforeArc ? lineSide : arcSide,
    lineBeforeArc ? arcSide : lineSide
  )

  if (lineBeforeArc) {
    return {
      point: lineSide,
      filletPoints,
      nextSegmentStart: arcSide
    }
  }

  return {
    point: arcSide,
    filletPoints,
    nextSegmentStart: lineSide
  }
}

/**
 * Computes the offset line point closest to a vertex along the left normal.
 *
 * @param line - Offset line with original edge direction `dx`/`dy`
 * @param vertex - Corner on the source polyline
 * @param offsetDist - Signed offset distance
 * @returns Point on the infinite offset line through the vertex
 */
function getLineOffsetPointAtVertex(
  line: { dx: number; dy: number },
  vertex: AcGePoint2d,
  offsetDist: number
): AcGePoint2d {
  const len = Math.hypot(line.dx, line.dy)
  const nx = (-line.dy / len) * offsetDist
  const ny = (line.dx / len) * offsetDist
  return new AcGePoint2d(vertex.x + nx, vertex.y + ny)
}

/**
 * Tests whether a point lies on the infinite line supporting an offset segment.
 *
 * @param line - Offset line with start and direction
 * @param point - Candidate point
 * @returns `true` if perpendicular distance to the line is within tolerance
 */
function isPointOnOffsetLine(
  line: { start: AcGePoint2d; dx: number; dy: number },
  point: AcGePoint2d
): boolean {
  const len = Math.hypot(line.dx, line.dy)
  if (AcGeTol.isNonPositive(len)) return false
  const ux = line.dx / len
  const uy = line.dy / len
  const px = point.x - line.start.x
  const py = point.y - line.start.y
  const perp = Math.abs(px * uy - py * ux)
  return AcGeTol.equalToZero(perp)
}

/**
 * Samples interior points of a circular round join at a vertex.
 *
 * Arc spans the shorter rotation from `from` to `to` about `vertex` at `radius`.
 * Endpoints are excluded from the returned list.
 *
 * @param vertex - Center of the round join
 * @param radius - Fillet radius (positive)
 * @param from - Start direction point on the fillet circle
 * @param to - End direction point on the fillet circle
 * @returns Interior fillet samples; empty when start and end directions coincide
 */
function sampleVertexRoundJoin(
  vertex: AcGePoint2d,
  radius: number,
  from: AcGePoint2d,
  to: AcGePoint2d
): AcGePoint2d[] {
  const a1 = Math.atan2(from.y - vertex.y, from.x - vertex.x)
  const a2 = Math.atan2(to.y - vertex.y, to.x - vertex.x)
  const sweep = shortestAngleSweep(a1, a2)
  if (AcGeTol.equalToZero(Math.abs(sweep))) {
    return []
  }

  const points: AcGePoint2d[] = []
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) / Math.PI) * 16))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const angle = a1 + sweep * t
    points.push(
      new AcGePoint2d(
        vertex.x + radius * Math.cos(angle),
        vertex.y + radius * Math.sin(angle)
      )
    )
  }
  return points
}

/**
 * Returns the shortest signed angular sweep from one direction to another.
 *
 * @param from - Start angle in radians
 * @param to - End angle in radians
 * @returns Signed sweep in `(-π, π]`
 */
function shortestAngleSweep(from: number, to: number): number {
  let sweep = to - from
  while (sweep > Math.PI) {
    sweep -= TAU
  }
  while (sweep <= -Math.PI) {
    sweep += TAU
  }
  return sweep
}

/**
 * Intersects an infinite offset line with a circle (offset arc boundary).
 *
 * @param line - Offset line segment defining origin and direction
 * @param arc - Circular arc whose radius and center define the circle
 * @param near - Preference point when choosing among multiple intersections
 * @returns Closest valid intersection to `near`, or `near` when no real roots exist
 */
function intersectLineWithCircle(
  line: { start: AcGePoint2d; end: AcGePoint2d; dx: number; dy: number },
  arc: AcGeCircArc2d,
  near: AcGePoint2d
): AcGePoint2d {
  const dirLen = Math.hypot(line.dx, line.dy)
  if (AcGeTol.isNonPositive(dirLen)) {
    return near.clone()
  }

  const ux = line.dx / dirLen
  const uy = line.dy / dirLen
  const fx = line.start.x - arc.center.x
  const fy = line.start.y - arc.center.y
  const b = 2 * (fx * ux + fy * uy)
  const c = fx * fx + fy * fy - arc.radius * arc.radius
  const discriminant = b * b - 4 * c

  if (discriminant < 0) {
    return near.clone()
  }

  const sqrtDisc = Math.sqrt(discriminant)
  const candidates = [(-b - sqrtDisc) / 2, (-b + sqrtDisc) / 2].map(
    t => new AcGePoint2d(line.start.x + ux * t, line.start.y + uy * t)
  )

  const onArc = candidates.filter(candidate => isPointOnArc(arc, candidate))
  return pickClosestPoint(onArc.length > 0 ? onArc : candidates, near)
}

/**
 * Tests whether a point lies on a circular arc segment (not merely on the full circle).
 *
 * @param arc - Circular arc with defined start/end and clockwise flag
 * @param point - Candidate point
 * @returns `true` if distance to center matches radius and angle is within the arc span
 */
function isPointOnArc(arc: AcGeCircArc2d, point: AcGePoint2d): boolean {
  const radiusDelta = Math.abs(
    Math.hypot(point.x - arc.center.x, point.y - arc.center.y) - arc.radius
  )
  if (AcGeTol.isPositive(radiusDelta)) {
    return false
  }

  const internalAngle = internalAngleAtPoint(arc, point)
  const internalStart = arc.clockwise
    ? mirrorAngle(AcGeMathUtil.normalizeAngle(arc.startAngle))
    : AcGeMathUtil.normalizeAngle(arc.startAngle)
  const internalEnd = arc.clockwise
    ? mirrorAngle(AcGeMathUtil.normalizeAngle(arc.endAngle))
    : AcGeMathUtil.normalizeAngle(arc.endAngle)

  return AcGeMathUtil.isBetweenAngle(
    internalAngle,
    internalStart,
    internalEnd,
    arc.clockwise
  )
}

/**
 * Intersects two circles defined by offset arc centers and radii.
 *
 * @param a - First offset arc (circle at `a.center` with radius `a.radius`)
 * @param b - Second offset arc
 * @returns Zero, one (tangent), or two intersection points; empty when circles are separated or nested beyond tolerance
 */
function intersectOffsetCircles(
  a: AcGeCircArc2d,
  b: AcGeCircArc2d
): AcGePoint2d[] {
  const dx = b.center.x - a.center.x
  const dy = b.center.y - a.center.y
  const dist = Math.hypot(dx, dy)
  if (AcGeTol.isNonPositive(dist)) {
    return []
  }

  const radiusSum = a.radius + b.radius
  const radiusDiff = Math.abs(a.radius - b.radius)
  if (dist > radiusSum + ROUND_JOIN_POINT_EPSILON) {
    return []
  }
  if (dist < radiusDiff - ROUND_JOIN_POINT_EPSILON) {
    return []
  }

  const aTerm =
    (a.radius * a.radius - b.radius * b.radius + dist * dist) / (2 * dist)
  const hSquared = a.radius * a.radius - aTerm * aTerm
  if (hSquared < -ROUND_JOIN_POINT_EPSILON) {
    return []
  }

  const mx = a.center.x + (aTerm * dx) / dist
  const my = a.center.y + (aTerm * dy) / dist
  if (hSquared <= ROUND_JOIN_POINT_EPSILON) {
    return [new AcGePoint2d(mx, my)]
  }

  const h = Math.sqrt(hSquared)
  const rx = (-dy * h) / dist
  const ry = (dx * h) / dist

  return [new AcGePoint2d(mx + rx, my + ry), new AcGePoint2d(mx - rx, my - ry)]
}

/**
 * Selects the candidate point closest to a reference location.
 *
 * @param points - Non-empty list of candidates
 * @param near - Reference point for distance comparison
 * @returns Clone of the closest candidate
 */
function pickClosestPoint(
  points: AcGePoint2d[],
  near: AcGePoint2d
): AcGePoint2d {
  let best = points[0]
  let bestDist = best.distanceToSquared(near)
  for (let i = 1; i < points.length; i++) {
    const dist = points[i].distanceToSquared(near)
    if (dist < bestDist) {
      best = points[i]
      bestDist = dist
    }
  }
  return best.clone()
}

/**
 * Computes the component-wise midpoint between two points.
 *
 * @param a - First point
 * @param b - Second point
 * @returns New point at `(a + b) / 2`
 */
function midpoint(a: AcGePoint2d, b: AcGePoint2d): AcGePoint2d {
  return new AcGePoint2d((a.x + b.x) / 2, (a.y + b.y) / 2)
}

/**
 * Determines whether a polyline contains any bulge-defined arc segments.
 *
 * @param polyline - Polyline to inspect
 * @returns `true` if any edge has a non-zero bulge within tolerance
 */
function hasArcSegments(polyline: AcGePolyline2d): boolean {
  const count = polyline.numberOfVertices
  const segmentCount = polyline.closed ? count : count - 1
  for (let i = 0; i < segmentCount; i++) {
    const vertex = polyline.vertices[i]
    if (AcGeTol.isPositive(Math.abs(vertex.bulge ?? 0))) {
      return true
    }
  }
  return false
}

/**
 * Returns a vertex-only polyline with normalized path points.
 *
 * @param polyline - Input polyline
 * @returns `polyline` unchanged when already normalized, else a new instance
 */
function normalizeVertexPolyline(polyline: AcGePolyline2d): AcGePolyline2d {
  const points = normalizePathPoints(
    polyline.vertices.map(vertex => new AcGePoint2d(vertex.x, vertex.y)),
    polyline.closed
  )
  if (points.length === polyline.numberOfVertices) {
    return polyline
  }
  return new AcGePolyline2d(
    points.map(point => ({ x: point.x, y: point.y })),
    polyline.closed
  )
}

/**
 * Deduplicates consecutive vertices and removes redundant closure for closed paths.
 *
 * @param points - Vertex chain in order
 * @param closed - Whether the path is closed
 * @returns Cleaned vertex list
 */
function normalizePathPoints(
  points: AcGePoint2d[],
  closed: boolean
): AcGePoint2d[] {
  const deduped = dedupeConsecutivePoints(points)
  if (!closed || deduped.length < 2) return deduped

  const first = deduped[0]
  const last = deduped[deduped.length - 1]
  if (AcGeTol.isNonPositive(Math.hypot(first.x - last.x, first.y - last.y))) {
    deduped.pop()
  }
  return deduped
}

/**
 * Removes consecutive vertices that coincide within geometric tolerance.
 *
 * @param points - Input vertex chain (may contain duplicates)
 * @returns New array with only distinct consecutive points
 */
function dedupeConsecutivePoints(points: AcGePoint2d[]): AcGePoint2d[] {
  const result: AcGePoint2d[] = []
  points.forEach(point => {
    const last = result[result.length - 1]
    if (
      !last ||
      AcGeTol.isPositive(Math.hypot(last.x - point.x, last.y - point.y))
    ) {
      result.push(new AcGePoint2d(point.x, point.y))
    }
  })
  return result
}

/**
 * Offsets a vertex-only polyline (open or closed) composed of straight segments.
 *
 * Each edge is offset parallel to itself; consecutive offset lines are joined with
 * miter intersections. Open paths keep raw offset starts/ends; closed paths join
 * cyclically at every corner.
 *
 * @param polyline - Vertex-only polyline with at least two vertices
 * @param offsetDist - Signed offset distance
 * @returns Offset polyline, or `null` if no valid edges remain after skipping zero-length segments
 */
function createVertexOnlyPolylineOffset(
  polyline: AcGePolyline2d,
  offsetDist: number
): AcGePolyline2d | null {
  const sourcePoints: AcGePoint2d[] = []
  for (let i = 0; i < polyline.numberOfVertices; i++) {
    sourcePoints.push(polyline.getPointAt(i))
  }

  const offsetSegments = buildPolylineOffsetSegments(
    sourcePoints,
    polyline.closed,
    offsetDist
  )
  if (offsetSegments.length === 0) return null

  const resultPoints: AcGePoint2d[] = []
  if (polyline.closed) {
    if (offsetSegments.length < 2) return null
    const count = offsetSegments.length
    for (let i = 0; i < count; i++) {
      const prev = offsetSegments[(i - 1 + count) % count]
      const curr = offsetSegments[i]
      resultPoints.push(intersectPolylineOffsetSegments(prev, curr))
    }
  } else {
    resultPoints.push(offsetSegments[0].start)
    for (let i = 1; i < offsetSegments.length; i++) {
      resultPoints.push(
        intersectPolylineOffsetSegments(
          offsetSegments[i - 1],
          offsetSegments[i]
        )
      )
    }
    resultPoints.push(offsetSegments[offsetSegments.length - 1].end)
  }

  const result = new AcGePolyline2d()
  resultPoints.forEach((point, index) => {
    result.addVertexAt(index, { x: point.x, y: point.y })
  })
  result.closed = polyline.closed
  return result
}

/**
 * Builds parallel offset segments for each non-degenerate edge of a vertex path.
 *
 * @param sourcePoints - Vertices in path order
 * @param closed - Whether edges wrap from the last vertex back to the first
 * @param offsetDist - Signed offset distance (left of travel = positive)
 * @returns One offset segment per valid edge, in path order
 */
function buildPolylineOffsetSegments(
  sourcePoints: AcGePoint2d[],
  closed: boolean,
  offsetDist: number
): PolylineOffsetSegment[] {
  const offsetSegments: PolylineOffsetSegment[] = []
  const edgeCount = closed ? sourcePoints.length : sourcePoints.length - 1
  for (let i = 0; i < edgeCount; i++) {
    const start = sourcePoints[i]
    const end = sourcePoints[closed ? (i + 1) % sourcePoints.length : i + 1]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const len = Math.hypot(dx, dy)
    if (AcGeTol.isNonPositive(len)) continue

    const nx = (-dy / len) * offsetDist
    const ny = (dx / len) * offsetDist
    offsetSegments.push({
      start: new AcGePoint2d(start.x + nx, start.y + ny),
      end: new AcGePoint2d(end.x + nx, end.y + ny),
      dx,
      dy
    })
  }
  return offsetSegments
}

/**
 * Computes the intersection of two infinite offset lines from consecutive polyline edges.
 *
 * Each segment supplies a point on the line (`start`) and direction (`dx`, `dy`).
 * Parallel edges return the midpoint of the gap between segment ends as a fallback.
 *
 * @param a - First offset edge
 * @param b - Second offset edge
 * @returns Intersection point (miter) of the two supporting lines
 */
function intersectPolylineOffsetSegments(
  a: PolylineOffsetSegment,
  b: PolylineOffsetSegment
): AcGePoint2d {
  const det = a.dx * b.dy - a.dy * b.dx
  if (AcGeTol.equalToZero(det)) {
    return new AcGePoint2d((a.end.x + b.start.x) / 2, (a.end.y + b.start.y) / 2)
  }

  const qpx = b.start.x - a.start.x
  const qpy = b.start.y - a.start.y
  const t = (qpx * b.dy - qpy * b.dx) / det
  return new AcGePoint2d(a.start.x + t * a.dx, a.start.y + t * a.dy)
}

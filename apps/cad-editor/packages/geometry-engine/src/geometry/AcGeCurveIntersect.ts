import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePlane,
  AcGePoint3d,
  AcGeVector3d
} from '../math'
import { AcGeMathUtil, AcGeTol, DEFAULT_TOL, FLOAT_TOL, TAU } from '../util'
import { AcGeCircArc3d } from './AcGeCircArc3d'
import { AcGeEllipseArc3d } from './AcGeEllipseArc3d'
import { AcGeLine3d } from './AcGeLine3d'
import { AcGeSpline3d } from './AcGeSpline3d'

/** Natural parameter interval of a linear primitive. */
export type AcGeCurveExtent = 'bounded' | 'ray' | 'unbounded'

type AcGeIntersectPrimitiveBase = {
  /**
   * When false, `extend` flags passed to {@link acgeIntersectCurves} do not
   * change this primitive. Open polyline interior segments and closed-loop
   * edges set this false. Default true.
   */
  extendable?: boolean
}

/**
 * A WCS curve primitive used by {@link acgeIntersectCurves}.
 *
 * Linear primitives carry an {@link AcGeCurveExtent}. Arcs and ellipses use
 * their stored start/end angles; when extended they are treated as the full
 * circle or ellipse.
 */
export type AcGeIntersectPrimitive =
  | (AcGeIntersectPrimitiveBase & {
      kind: 'line'
      line: AcGeLine3d
      extent: AcGeCurveExtent
    })
  | (AcGeIntersectPrimitiveBase & {
      kind: 'circArc'
      arc: AcGeCircArc3d
    })
  | (AcGeIntersectPrimitiveBase & {
      kind: 'ellipseArc'
      arc: AcGeEllipseArc3d
    })
  | (AcGeIntersectPrimitiveBase & {
      kind: 'spline'
      spline: AcGeSpline3d
    })

const SPLINE_SAMPLE_COUNT = 128
const PLANAR_SAMPLE_COUNT = 96
const POINT_TOL = DEFAULT_TOL.equalPointTol
const REFINE_TOL = POINT_TOL * 8

/**
 * Finds intersection points between two sets of curve primitives.
 *
 * `extendA` / `extendB` correspond to ObjectARX `AcDb::Intersect` flags for
 * the two operands. A primitive is only extended when `extendable` is not
 * `false`. Overlapping coincident curves do not produce a continuum of points.
 *
 * When `projPlane` is provided, both operands are projected onto that plane
 * first (apparent intersection). Result points lie on the plane.
 *
 * @param a - Primitives from the first operand
 * @param b - Primitives from the second operand
 * @param extendA - Extend the first operand when its primitives allow it
 * @param extendB - Extend the second operand when its primitives allow it
 * @param projPlane - Optional projection plane for apparent intersection
 * @returns Intersection points in WCS, de-duplicated by the equal-point tolerance
 */
export function acgeIntersectCurves(
  a: readonly AcGeIntersectPrimitive[],
  b: readonly AcGeIntersectPrimitive[],
  extendA = false,
  extendB = false,
  projPlane?: AcGePlane
): AcGePoint3d[] {
  const left = flattenPrimitives(a, extendA, projPlane)
  const right = flattenPrimitives(b, extendB, projPlane)
  const points: AcGePoint3d[] = []
  for (const pa of left) {
    for (const pb of right) {
      if (!boxesMayIntersect(pa, pb)) continue
      appendPoints(points, intersectPrepared(pa, pb))
    }
  }
  return dedupePoints(points)
}

/**
 * Returns a transformed copy of a curve primitive.
 */
export function acgeTransformIntersectPrimitive(
  primitive: AcGeIntersectPrimitive,
  matrix: AcGeMatrix3d
): AcGeIntersectPrimitive {
  const cloned = acgeCloneIntersectPrimitive(primitive)
  switch (cloned.kind) {
    case 'line':
      cloned.line.transform(matrix)
      return cloned
    case 'circArc':
      cloned.arc.transform(matrix)
      return cloned
    case 'ellipseArc':
      cloned.arc.transform(matrix)
      return cloned
    case 'spline':
      cloned.spline.transform(matrix)
      return cloned
  }
}

/**
 * Returns a deep-cloned curve primitive.
 */
export function acgeCloneIntersectPrimitive(
  primitive: AcGeIntersectPrimitive
): AcGeIntersectPrimitive {
  switch (primitive.kind) {
    case 'line':
      return {
        kind: 'line',
        line: primitive.line.clone(),
        extent: primitive.extent,
        extendable: primitive.extendable
      }
    case 'circArc':
      return {
        kind: 'circArc',
        arc: primitive.arc.clone(),
        extendable: primitive.extendable
      }
    case 'ellipseArc':
      return {
        kind: 'ellipseArc',
        arc: primitive.arc.clone(),
        extendable: primitive.extendable
      }
    case 'spline':
      return {
        kind: 'spline',
        spline: primitive.spline.clone(),
        extendable: primitive.extendable
      }
  }
}

type PreparedLine = {
  kind: 'line'
  start: AcGePoint3d
  dir: AcGeVector3d
  extent: AcGeCurveExtent
  box?: AcGeBox3d
}

type PreparedPrimitive =
  | PreparedLine
  | {
      kind: 'circArc'
      arc: AcGeCircArc3d
      full: boolean
      box: AcGeBox3d
    }
  | {
      kind: 'ellipseArc'
      arc: AcGeEllipseArc3d
      full: boolean
      box: AcGeBox3d
    }
  | {
      kind: 'spline'
      spline: AcGeSpline3d
      samples: PreparedLine[]
      box?: AcGeBox3d
    }

function flattenPrimitives(
  primitives: readonly AcGeIntersectPrimitive[],
  extend: boolean,
  projPlane?: AcGePlane
): PreparedPrimitive[] {
  const result: PreparedPrimitive[] = []
  for (const primitive of primitives) {
    const shouldExtend = extend && primitive.extendable !== false
    switch (primitive.kind) {
      case 'line': {
        const line = projectLine(primitive.line, projPlane)
        if (!line) break
        const extent = shouldExtend ? 'unbounded' : primitive.extent
        result.push(prepareLine(line.start, line.end, extent))
        break
      }
      case 'circArc': {
        const expanded = expandCircArc(primitive.arc, shouldExtend)
        if (projPlane && !planesParallel(expanded.normal, projPlane.normal)) {
          const projected = projectCircleOntoPlane(expanded, projPlane)
          if (projected?.kind === 'circArc') {
            result.push(
              prepareCircArc(projected.arc, isFullCircArc(projected.arc))
            )
          } else if (projected?.kind === 'ellipseArc') {
            result.push(
              prepareEllipseArc(projected.arc, isFullEllipseArc(projected.arc))
            )
          } else {
            appendSampledCurve(
              result,
              sampleCircArc(expanded, isFullCircArc(expanded)),
              isFullCircArc(expanded),
              projPlane
            )
          }
        } else {
          const projected = projectCircArc(expanded, projPlane)
          if (projected) {
            result.push(prepareCircArc(projected, isFullCircArc(projected)))
          }
        }
        break
      }
      case 'ellipseArc': {
        const expanded = expandEllipseArc(primitive.arc, shouldExtend)
        if (projPlane && !planesParallel(expanded.normal, projPlane.normal)) {
          appendSampledCurve(
            result,
            sampleEllipseArc(expanded, isFullEllipseArc(expanded)),
            isFullEllipseArc(expanded),
            projPlane
          )
        } else {
          const projected = projectEllipseArc(expanded, projPlane)
          if (projected) {
            result.push(
              prepareEllipseArc(projected, isFullEllipseArc(projected))
            )
          }
        }
        break
      }
      case 'spline': {
        if (projPlane) {
          appendSampledCurve(
            result,
            primitive.spline.getPoints(SPLINE_SAMPLE_COUNT),
            primitive.spline.closed,
            projPlane
          )
        } else {
          result.push(prepareSpline(primitive.spline))
        }
        break
      }
    }
  }
  return result
}

function prepareLine(
  start: AcGePoint3d,
  end: AcGePoint3d,
  extent: AcGeCurveExtent
): PreparedLine {
  const dir = new AcGeVector3d().subVectors(end, start)
  return {
    kind: 'line',
    start,
    dir,
    extent,
    box:
      extent === 'bounded'
        ? new AcGeBox3d().setFromPoints([start, end])
        : undefined
  }
}

function prepareCircArc(arc: AcGeCircArc3d, full: boolean): PreparedPrimitive {
  return {
    kind: 'circArc',
    arc,
    full: full || isFullCircArc(arc),
    box: arc.box
  }
}

function prepareEllipseArc(
  arc: AcGeEllipseArc3d,
  full: boolean
): PreparedPrimitive {
  return {
    kind: 'ellipseArc',
    arc,
    full: full || isFullEllipseArc(arc),
    box: arc.box
  }
}

function prepareSpline(spline: AcGeSpline3d): PreparedPrimitive {
  const samples: PreparedLine[] = []
  const points = spline.getPoints(SPLINE_SAMPLE_COUNT)
  if (points.length >= 2) {
    const count = spline.closed ? points.length : points.length - 1
    for (let i = 0; i < count; i++) {
      const start = points[i]
      const end = points[(i + 1) % points.length]
      if (start.distanceToSquared(end) < POINT_TOL * POINT_TOL) continue
      samples.push(prepareLine(start.clone(), end.clone(), 'bounded'))
    }
  }
  const box = new AcGeBox3d()
  for (const sample of samples) {
    if (sample.box) box.union(sample.box)
  }
  return {
    kind: 'spline',
    spline,
    samples,
    box: samples.length > 0 ? box : undefined
  }
}

function expandCircArc(arc: AcGeCircArc3d, extend: boolean): AcGeCircArc3d {
  if (!extend || isFullCircArc(arc)) return arc
  return new AcGeCircArc3d(
    arc.center,
    arc.radius,
    0,
    TAU,
    arc.normal,
    arc.refVec
  )
}

function expandEllipseArc(
  arc: AcGeEllipseArc3d,
  extend: boolean
): AcGeEllipseArc3d {
  if (!extend || isFullEllipseArc(arc)) return arc
  return new AcGeEllipseArc3d(
    arc.center,
    arc.normal,
    arc.majorAxis,
    arc.majorAxisRadius,
    arc.minorAxisRadius,
    0,
    TAU
  )
}

function projectLine(
  line: AcGeLine3d,
  plane?: AcGePlane
): { start: AcGePoint3d; end: AcGePoint3d } | null {
  if (!plane) {
    return { start: line.startPoint.clone(), end: line.endPoint.clone() }
  }
  const start = projectPointToPlane(line.startPoint, plane)
  const end = projectPointToPlane(line.endPoint, plane)
  if (start.distanceToSquared(end) < POINT_TOL * POINT_TOL) return null
  return { start, end }
}

function projectCircArc(
  arc: AcGeCircArc3d,
  plane?: AcGePlane
): AcGeCircArc3d | null {
  if (!plane) return arc
  const center = projectPointToPlane(arc.center, plane)
  return new AcGeCircArc3d(
    center,
    arc.radius,
    arc.startAngle,
    arc.endAngle,
    plane.normal.clone(),
    projectDirectionToPlane(arc.refVec, plane.normal)
  )
}

/**
 * Orthogonal projection of a circular arc onto `plane`. Parallel planes keep a
 * circle; a tilted circle becomes an ellipse. A circle whose plane is
 * perpendicular to `plane` degenerates to a segment and returns null so the
 * caller can sample.
 */
function projectCircleOntoPlane(
  arc: AcGeCircArc3d,
  plane: AcGePlane
):
  | { kind: 'circArc'; arc: AcGeCircArc3d }
  | { kind: 'ellipseArc'; arc: AcGeEllipseArc3d }
  | null {
  const center = projectPointToPlane(arc.center, plane)
  const n = arc.normal.clone()
  if (n.lengthSq() < POINT_TOL * POINT_TOL) return null
  n.normalize()
  const p = plane.normal.clone()
  if (p.lengthSq() < POINT_TOL * POINT_TOL) return null
  p.normalize()
  const cos = n.dot(p)
  const absCos = Math.abs(cos)

  if (absCos > 1 - 1e-8) {
    return {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        center,
        arc.radius,
        arc.startAngle,
        arc.endAngle,
        p,
        projectDirectionToPlane(arc.refVec, p)
      )
    }
  }
  if (absCos < 1e-8) return null

  const hinge = new AcGeVector3d().crossVectors(n, p)
  if (hinge.lengthSq() < POINT_TOL * POINT_TOL) return null
  hinge.normalize()

  const ellipse = new AcGeEllipseArc3d(
    center,
    p,
    hinge,
    arc.radius,
    arc.radius * absCos,
    0,
    TAU
  )
  if (isFullCircArc(arc)) {
    return { kind: 'ellipseArc', arc: ellipse }
  }

  const start = projectPointToPlane(arc.startPoint, plane)
  const end = projectPointToPlane(arc.endPoint, plane)
  const mid = projectPointToPlane(arc.midPoint, plane)
  const startAngle = ellipseArcAngle(ellipse, start)
  const endAngle = ellipseArcAngle(ellipse, end)
  const midAngle = ellipseArcAngle(ellipse, mid)
  const tMid = AcGeMathUtil.normalizeAngle(midAngle - startAngle)
  const tEnd = AcGeMathUtil.normalizeAngle(endAngle - startAngle)
  const sweepEnd =
    tMid <= tEnd || tEnd < 1e-8 ? startAngle + tEnd : startAngle + tEnd + TAU
  return {
    kind: 'ellipseArc',
    arc: new AcGeEllipseArc3d(
      center,
      p,
      hinge,
      arc.radius,
      arc.radius * absCos,
      startAngle,
      sweepEnd
    )
  }
}

function projectEllipseArc(
  arc: AcGeEllipseArc3d,
  plane?: AcGePlane
): AcGeEllipseArc3d | null {
  if (!plane) return arc
  const center = projectPointToPlane(arc.center, plane)
  const major = projectDirectionToPlane(arc.majorAxis, plane.normal)
  if (major.lengthSq() < POINT_TOL * POINT_TOL) return null
  return new AcGeEllipseArc3d(
    center,
    plane.normal.clone(),
    major,
    arc.majorAxisRadius,
    arc.minorAxisRadius,
    arc.startAngle,
    arc.endAngle
  )
}

function appendSampledCurve(
  result: PreparedPrimitive[],
  samples: AcGePoint3d[],
  closed: boolean,
  projPlane?: AcGePlane
) {
  if (samples.length < 2) return
  const points = projPlane
    ? samples.map(point => projectPointToPlane(point, projPlane))
    : samples
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i++) {
    const start = points[i]
    const end = points[(i + 1) % points.length]
    if (start.distanceToSquared(end) < POINT_TOL * POINT_TOL) continue
    result.push(prepareLine(start.clone(), end.clone(), 'bounded'))
  }
}

function sampleCircArc(arc: AcGeCircArc3d, full: boolean): AcGePoint3d[] {
  if (full || isFullCircArc(arc)) {
    return new AcGeCircArc3d(
      arc.center,
      arc.radius,
      0,
      TAU,
      arc.normal,
      arc.refVec
    ).getPoints(PLANAR_SAMPLE_COUNT)
  }
  return arc.getPoints(PLANAR_SAMPLE_COUNT)
}

function sampleEllipseArc(arc: AcGeEllipseArc3d, full: boolean): AcGePoint3d[] {
  if (full || isFullEllipseArc(arc)) {
    return new AcGeEllipseArc3d(
      arc.center,
      arc.normal,
      arc.majorAxis,
      arc.majorAxisRadius,
      arc.minorAxisRadius,
      0,
      TAU
    ).getPoints(PLANAR_SAMPLE_COUNT)
  }
  return arc.getPoints(PLANAR_SAMPLE_COUNT)
}

function boxesMayIntersect(a: PreparedPrimitive, b: PreparedPrimitive) {
  if (!a.box || !b.box) return true
  return a.box.intersectsBox(b.box)
}

function intersectPrepared(
  a: PreparedPrimitive,
  b: PreparedPrimitive
): AcGePoint3d[] {
  if (a.kind === 'spline' && b.kind === 'spline') {
    return intersectSplineSpline(a, b)
  }
  if (a.kind === 'spline') return intersectSplineOther(a, b)
  if (b.kind === 'spline') return intersectSplineOther(b, a)
  if (a.kind === 'line' && b.kind === 'line') return intersectLineLine(a, b)
  if (a.kind === 'line' && b.kind === 'circArc') {
    return intersectLineCircArc(a, b.arc, b.full)
  }
  if (b.kind === 'line' && a.kind === 'circArc') {
    return intersectLineCircArc(b, a.arc, a.full)
  }
  if (a.kind === 'line' && b.kind === 'ellipseArc') {
    return intersectLineEllipseArc(a, b.arc, b.full)
  }
  if (b.kind === 'line' && a.kind === 'ellipseArc') {
    return intersectLineEllipseArc(b, a.arc, a.full)
  }
  if (a.kind === 'circArc' && b.kind === 'circArc') {
    return intersectCircCirc(a.arc, a.full, b.arc, b.full)
  }
  if (a.kind === 'circArc' && b.kind === 'ellipseArc') {
    return intersectCircEllipse(a.arc, a.full, b.arc, b.full)
  }
  if (a.kind === 'ellipseArc' && b.kind === 'circArc') {
    return intersectCircEllipse(b.arc, b.full, a.arc, a.full)
  }
  if (a.kind === 'ellipseArc' && b.kind === 'ellipseArc') {
    return intersectEllipseEllipse(a.arc, a.full, b.arc, b.full)
  }
  return []
}

function intersectSplineOther(
  spline: Extract<PreparedPrimitive, { kind: 'spline' }>,
  other: PreparedPrimitive
): AcGePoint3d[] {
  const hits: AcGePoint3d[] = []
  for (const sample of spline.samples) {
    if (!boxesMayIntersect(sample, other)) continue
    appendPoints(hits, intersectPrepared(sample, other))
  }
  return refineSplineHits(spline.spline, hits, other)
}

function intersectSplineSpline(
  a: Extract<PreparedPrimitive, { kind: 'spline' }>,
  b: Extract<PreparedPrimitive, { kind: 'spline' }>
): AcGePoint3d[] {
  const hits: AcGePoint3d[] = []
  for (const sa of a.samples) {
    for (const sb of b.samples) {
      if (!boxesMayIntersect(sa, sb)) continue
      appendPoints(hits, intersectLineLine(sa, sb))
    }
  }
  const points: AcGePoint3d[] = []
  for (const hit of hits) {
    const pa = a.spline.nearestPoint(hit, SPLINE_SAMPLE_COUNT)
    const pb = b.spline.nearestPoint(hit, SPLINE_SAMPLE_COUNT)
    if (pa.distanceTo(pb) <= REFINE_TOL) points.push(pa)
  }
  return points
}

function refineSplineHits(
  spline: AcGeSpline3d,
  hits: AcGePoint3d[],
  other: PreparedPrimitive
): AcGePoint3d[] {
  const points: AcGePoint3d[] = []
  for (const hit of hits) {
    const refined = spline.nearestPoint(hit, SPLINE_SAMPLE_COUNT)
    if (distanceToPrepared(other, refined) <= REFINE_TOL) {
      points.push(refined)
    }
  }
  return points
}

function distanceToPrepared(
  primitive: PreparedPrimitive,
  point: AcGePoint3d
): number {
  if (primitive.kind === 'line') {
    const dirLenSq = primitive.dir.lengthSq()
    if (dirLenSq < POINT_TOL * POINT_TOL) return Number.POSITIVE_INFINITY
    const t =
      new AcGeVector3d().subVectors(point, primitive.start).dot(primitive.dir) /
      dirLenSq
    if (!isParamOnExtent(t, primitive.extent)) return Number.POSITIVE_INFINITY
    return pointOnLine(primitive.start, primitive.dir, t).distanceTo(point)
  }
  if (primitive.kind === 'circArc') {
    if (!isPointOnCircle(point, primitive.arc)) {
      const plane = planeFromNormalAndPoint(
        primitive.arc.normal,
        primitive.arc.center
      )
      const planar = Math.abs(plane.distanceToPoint(point))
      const radial = Math.abs(
        point.distanceTo(primitive.arc.center) - primitive.arc.radius
      )
      const off = Math.hypot(planar, radial)
      if (off > REFINE_TOL) return off
    }
    return isAngleOnCircArc(
      primitive.arc,
      circArcAngle(primitive.arc, point),
      primitive.full
    )
      ? 0
      : Number.POSITIVE_INFINITY
  }
  if (primitive.kind === 'ellipseArc') {
    return isPointOnEllipse(point, primitive.arc, primitive.full)
      ? 0
      : Math.abs(ellipseImplicit(primitive.arc, point))
  }
  return Number.POSITIVE_INFINITY
}

function intersectLineLine(a: PreparedLine, b: PreparedLine): AcGePoint3d[] {
  const d1 = a.dir
  const d2 = b.dir
  const len1Sq = d1.lengthSq()
  const len2Sq = d2.lengthSq()
  if (len1Sq < POINT_TOL * POINT_TOL || len2Sq < POINT_TOL * POINT_TOL) {
    return []
  }

  const w0 = new AcGeVector3d().subVectors(a.start, b.start)
  const aa = d1.dot(d1)
  const bb = d1.dot(d2)
  const cc = d2.dot(d2)
  const dd = d1.dot(w0)
  const ee = d2.dot(w0)
  const denom = aa * cc - bb * bb
  if (Math.abs(denom) < FLOAT_TOL * FLOAT_TOL * aa * cc) {
    return []
  }

  const t = (bb * ee - cc * dd) / denom
  const s = (aa * ee - bb * dd) / denom
  if (!isParamOnExtent(t, a.extent) || !isParamOnExtent(s, b.extent)) {
    return []
  }

  const p = pointOnLine(a.start, d1, t)
  const q = pointOnLine(b.start, d2, s)
  if (p.distanceTo(q) > POINT_TOL) return []
  return [p]
}

function intersectLineCircArc(
  line: PreparedLine,
  arc: AcGeCircArc3d,
  full: boolean
): AcGePoint3d[] {
  const plane = planeFromNormalAndPoint(arc.normal, arc.center)
  const hit = intersectLineWithPlane(line, plane)
  if (hit === 'coplanar') {
    return intersectCoplanarLineCircle(line, arc, full)
  }
  if (!hit) return []
  if (!isPointOnCircle(hit, arc)) return []
  if (!isAngleOnCircArc(arc, circArcAngle(arc, hit), full)) return []
  return [hit]
}

function intersectCoplanarLineCircle(
  line: PreparedLine,
  arc: AcGeCircArc3d,
  full: boolean
): AcGePoint3d[] {
  const f = new AcGeVector3d().subVectors(line.start, arc.center)
  const a = line.dir.dot(line.dir)
  if (a < POINT_TOL * POINT_TOL) return []
  const b = 2 * line.dir.dot(f)
  const c = f.dot(f) - arc.radius * arc.radius
  const points: AcGePoint3d[] = []
  for (const t of solveQuadratic(a, b, c)) {
    if (!isParamOnExtent(t, line.extent)) continue
    const point = pointOnLine(line.start, line.dir, t)
    if (!isAngleOnCircArc(arc, circArcAngle(arc, point), full)) continue
    points.push(point)
  }
  return points
}

function intersectLineEllipseArc(
  line: PreparedLine,
  arc: AcGeEllipseArc3d,
  full: boolean
): AcGePoint3d[] {
  const plane = planeFromNormalAndPoint(arc.normal, arc.center)
  const hit = intersectLineWithPlane(line, plane)
  if (hit === 'coplanar') {
    return intersectCoplanarLineEllipse(line, arc, full)
  }
  if (!hit) return []
  if (!isPointOnEllipse(hit, arc, full)) return []
  return [hit]
}

function intersectCoplanarLineEllipse(
  line: PreparedLine,
  arc: AcGeEllipseArc3d,
  full: boolean
): AcGePoint3d[] {
  const u = arc.majorAxis
  const v = arc.minorAxis
  const a = arc.majorAxisRadius
  const b = arc.minorAxisRadius
  if (a < POINT_TOL || b < POINT_TOL) return []

  const startOffset = new AcGeVector3d().subVectors(line.start, arc.center)
  const x0 = startOffset.dot(u)
  const y0 = startOffset.dot(v)
  const dx = line.dir.dot(u)
  const dy = line.dir.dot(v)
  const A = (dx * dx) / (a * a) + (dy * dy) / (b * b)
  const B = (2 * x0 * dx) / (a * a) + (2 * y0 * dy) / (b * b)
  const C = (x0 * x0) / (a * a) + (y0 * y0) / (b * b) - 1
  const points: AcGePoint3d[] = []
  for (const t of solveQuadratic(A, B, C)) {
    if (!isParamOnExtent(t, line.extent)) continue
    const point = pointOnLine(line.start, line.dir, t)
    if (!isAngleOnEllipseArc(arc, ellipseArcAngle(arc, point), full)) continue
    points.push(point)
  }
  return points
}

function intersectCircCirc(
  a: AcGeCircArc3d,
  fullA: boolean,
  b: AcGeCircArc3d,
  fullB: boolean
): AcGePoint3d[] {
  if (planesParallel(a.normal, b.normal)) {
    const planeA = planeFromNormalAndPoint(a.normal, a.center)
    if (Math.abs(planeA.distanceToPoint(b.center)) > POINT_TOL) return []
    return filterCircPoints(intersectCoplanarCircles(a, b), a, fullA, b, fullB)
  }

  const line = planePlaneIntersectionLine(
    planeFromNormalAndPoint(a.normal, a.center),
    planeFromNormalAndPoint(b.normal, b.center)
  )
  if (!line) return []
  const prepared = prepareLine(
    line.point.clone(),
    new AcGePoint3d().addVectors(line.point, line.dir),
    'unbounded'
  )
  const onA = intersectLineCircArc(prepared, a, fullA)
  return onA.filter(point => {
    if (!isPointOnCircle(point, b)) return false
    return isAngleOnCircArc(b, circArcAngle(b, point), fullB)
  })
}

function intersectCoplanarCircles(
  a: AcGeCircArc3d,
  b: AcGeCircArc3d
): AcGePoint3d[] {
  const offset = new AcGeVector3d().subVectors(b.center, a.center)
  const dist = offset.length()
  const r1 = a.radius
  const r2 = b.radius
  if (dist < POINT_TOL && AcGeTol.equal(r1, r2, POINT_TOL)) return []
  if (dist > r1 + r2 + POINT_TOL) return []
  if (dist + Math.min(r1, r2) + POINT_TOL < Math.max(r1, r2)) return []

  const dir =
    dist < POINT_TOL ? perpInPlane(a.normal) : offset.clone().normalize()
  const x = (r1 * r1 - r2 * r2 + dist * dist) / (2 * Math.max(dist, POINT_TOL))
  const hSq = r1 * r1 - x * x
  const p = new AcGePoint3d().copy(a.center).addScaledVector(dir, x)
  if (hSq < -POINT_TOL * POINT_TOL) return []
  if (hSq < POINT_TOL * POINT_TOL) return [p]

  const h = Math.sqrt(Math.max(0, hSq))
  const perp = new AcGeVector3d().crossVectors(a.normal, dir).normalize()
  return [
    new AcGePoint3d().copy(p).addScaledVector(perp, h),
    new AcGePoint3d().copy(p).addScaledVector(perp, -h)
  ]
}

function intersectCircEllipse(
  circle: AcGeCircArc3d,
  fullCircle: boolean,
  ellipse: AcGeEllipseArc3d,
  fullEllipse: boolean
): AcGePoint3d[] {
  if (!planesParallel(circle.normal, ellipse.normal)) {
    const line = planePlaneIntersectionLine(
      planeFromNormalAndPoint(circle.normal, circle.center),
      planeFromNormalAndPoint(ellipse.normal, ellipse.center)
    )
    if (!line) return []
    const prepared = prepareLine(
      line.point.clone(),
      new AcGePoint3d().addVectors(line.point, line.dir),
      'unbounded'
    )
    return intersectLineCircArc(prepared, circle, fullCircle).filter(point =>
      isPointOnEllipse(point, ellipse, fullEllipse)
    )
  }
  return intersectPlanarImplicit(
    sampleCircArc(circle, fullCircle),
    isFullCircArc(circle) || fullCircle,
    point => ellipseImplicit(ellipse, point),
    point =>
      isAngleOnCircArc(circle, circArcAngle(circle, point), fullCircle) &&
      isPointOnEllipse(point, ellipse, fullEllipse)
  )
}

function intersectEllipseEllipse(
  a: AcGeEllipseArc3d,
  fullA: boolean,
  b: AcGeEllipseArc3d,
  fullB: boolean
): AcGePoint3d[] {
  if (!planesParallel(a.normal, b.normal)) {
    const line = planePlaneIntersectionLine(
      planeFromNormalAndPoint(a.normal, a.center),
      planeFromNormalAndPoint(b.normal, b.center)
    )
    if (!line) return []
    const prepared = prepareLine(
      line.point.clone(),
      new AcGePoint3d().addVectors(line.point, line.dir),
      'unbounded'
    )
    return intersectLineEllipseArc(prepared, a, fullA).filter(point =>
      isPointOnEllipse(point, b, fullB)
    )
  }
  return intersectPlanarImplicit(
    sampleEllipseArc(a, fullA),
    isFullEllipseArc(a) || fullA,
    point => ellipseImplicit(b, point),
    point =>
      isAngleOnEllipseArc(a, ellipseArcAngle(a, point), fullA) &&
      isPointOnEllipse(point, b, fullB)
  )
}

function intersectPlanarImplicit(
  samples: AcGePoint3d[],
  closed: boolean,
  implicit: (point: AcGePoint3d) => number,
  accept: (point: AcGePoint3d) => boolean
): AcGePoint3d[] {
  const points: AcGePoint3d[] = []
  const count = closed ? samples.length : samples.length - 1
  for (let i = 0; i < count; i++) {
    const p0 = samples[i]
    const p1 = samples[(i + 1) % samples.length]
    const e0 = implicit(p0)
    const e1 = implicit(p1)
    if (Math.abs(e0) <= POINT_TOL) {
      if (accept(p0)) points.push(p0.clone())
      continue
    }
    if (e0 * e1 > 0) continue
    let lo = 0
    let hi = 1
    let loVal = e0
    for (let step = 0; step < 40; step++) {
      const mid = (lo + hi) / 2
      const midPoint = new AcGePoint3d().lerpVectors(p0, p1, mid)
      const midVal = implicit(midPoint)
      if (loVal * midVal <= 0) {
        hi = mid
      } else {
        lo = mid
        loVal = midVal
      }
    }
    const hit = new AcGePoint3d().lerpVectors(p0, p1, (lo + hi) / 2)
    if (accept(hit)) points.push(hit)
  }
  return points
}

function intersectLineWithPlane(
  line: PreparedLine,
  plane: AcGePlane
): AcGePoint3d | 'coplanar' | null {
  const denom = plane.normal.dot(line.dir)
  const dist = plane.distanceToPoint(line.start)
  if (AcGeTol.equalToZero(denom, POINT_TOL * Math.max(1, line.dir.length()))) {
    return AcGeTol.equalToZero(dist, POINT_TOL) ? 'coplanar' : null
  }
  const t = -dist / denom
  if (!isParamOnExtent(t, line.extent)) return null
  return pointOnLine(line.start, line.dir, t)
}

function planePlaneIntersectionLine(
  a: AcGePlane,
  b: AcGePlane
): { point: AcGePoint3d; dir: AcGeVector3d } | null {
  const dir = new AcGeVector3d().crossVectors(a.normal, b.normal)
  if (dir.lengthSq() < POINT_TOL * POINT_TOL) return null
  dir.normalize()

  const n1 = a.normal
  const n2 = b.normal
  const det = n1.dot(n1) * n2.dot(n2) - n1.dot(n2) ** 2
  if (Math.abs(det) < FLOAT_TOL) return null
  const c1 = -a.constant
  const c2 = -b.constant
  const x = (n2.dot(n2) * c1 - n1.dot(n2) * c2) / det
  const y = (n1.dot(n1) * c2 - n1.dot(n2) * c1) / det
  const point = new AcGePoint3d().addScaledVector(n1, x).addScaledVector(n2, y)
  return { point, dir }
}

function isParamOnExtent(t: number, extent: AcGeCurveExtent) {
  if (extent === 'unbounded') return true
  if (extent === 'ray') return t >= -POINT_TOL
  return t >= -POINT_TOL && t <= 1 + POINT_TOL
}

function pointOnLine(start: AcGePoint3d, dir: AcGeVector3d, t: number) {
  return new AcGePoint3d().copy(start).addScaledVector(dir, t)
}

function projectPointToPlane(point: AcGePoint3d, plane: AcGePlane) {
  const target = new AcGePoint3d()
  plane.projectPoint(point, target)
  return target
}

function projectDirectionToPlane(dir: AcGeVector3d, planeNormal: AcGeVector3d) {
  const projected = dir
    .clone()
    .addScaledVector(planeNormal, -dir.dot(planeNormal))
  if (projected.lengthSq() < POINT_TOL * POINT_TOL) {
    return perpInPlane(planeNormal)
  }
  return projected.normalize()
}

function planeFromNormalAndPoint(normal: AcGeVector3d, point: AcGePoint3d) {
  return new AcGePlane().setFromNormalAndCoplanarPoint(normal, point)
}

function planesParallel(a: AcGeVector3d, b: AcGeVector3d) {
  return (
    new AcGeVector3d().crossVectors(a, b).lengthSq() < POINT_TOL * POINT_TOL
  )
}

function circArcAngle(arc: AcGeCircArc3d, point: AcGePoint3d) {
  const vec = new AcGeVector3d().subVectors(point, arc.center)
  const ortho = new AcGeVector3d().crossVectors(arc.normal, arc.refVec)
  return Math.atan2(vec.dot(ortho), vec.dot(arc.refVec))
}

function ellipseArcAngle(arc: AcGeEllipseArc3d, point: AcGePoint3d) {
  const offset = new AcGeVector3d().subVectors(point, arc.center)
  const x = offset.dot(arc.majorAxis) / arc.majorAxisRadius
  const y = offset.dot(arc.minorAxis) / arc.minorAxisRadius
  return Math.atan2(y, x)
}

function isFullCircArc(arc: AcGeCircArc3d) {
  return arc.closed || Math.abs(arc.deltaAngle - TAU) < 1e-10
}

function isFullEllipseArc(arc: AcGeEllipseArc3d) {
  return (
    arc.closed ||
    Math.abs(arc.endAngle - arc.startAngle) < 1e-10 ||
    Math.abs(arc.deltaAngle - TAU) < 1e-10
  )
}

function isAngleOnCircArc(arc: AcGeCircArc3d, angle: number, full: boolean) {
  if (full || isFullCircArc(arc)) return true
  const t = AcGeMathUtil.normalizeAngle(angle - arc.startAngle)
  return t <= arc.deltaAngle + 1e-8
}

function isAngleOnEllipseArc(
  arc: AcGeEllipseArc3d,
  angle: number,
  full: boolean
) {
  if (full || isFullEllipseArc(arc)) return true
  const t = AcGeMathUtil.normalizeAngle(angle - arc.startAngle)
  return t <= arc.deltaAngle + 1e-8
}

function isPointOnCircle(point: AcGePoint3d, arc: AcGeCircArc3d) {
  const plane = planeFromNormalAndPoint(arc.normal, arc.center)
  if (Math.abs(plane.distanceToPoint(point)) > POINT_TOL) return false
  return Math.abs(point.distanceTo(arc.center) - arc.radius) <= POINT_TOL
}

function ellipseImplicit(arc: AcGeEllipseArc3d, point: AcGePoint3d) {
  const offset = new AcGeVector3d().subVectors(point, arc.center)
  const x = offset.dot(arc.majorAxis) / arc.majorAxisRadius
  const y = offset.dot(arc.minorAxis) / arc.minorAxisRadius
  return x * x + y * y - 1
}

function isPointOnEllipse(
  point: AcGePoint3d,
  arc: AcGeEllipseArc3d,
  full: boolean
) {
  const plane = planeFromNormalAndPoint(arc.normal, arc.center)
  if (Math.abs(plane.distanceToPoint(point)) > POINT_TOL) return false
  if (Math.abs(ellipseImplicit(arc, point)) > 1e-4) return false
  return isAngleOnEllipseArc(arc, ellipseArcAngle(arc, point), full)
}

function filterCircPoints(
  points: AcGePoint3d[],
  a: AcGeCircArc3d,
  fullA: boolean,
  b: AcGeCircArc3d,
  fullB: boolean
) {
  return points.filter(
    point =>
      isAngleOnCircArc(a, circArcAngle(a, point), fullA) &&
      isAngleOnCircArc(b, circArcAngle(b, point), fullB)
  )
}

function perpInPlane(normal: AcGeVector3d) {
  const axis =
    Math.abs(normal.x) < 0.9 ? AcGeVector3d.X_AXIS : AcGeVector3d.Y_AXIS
  const perp = new AcGeVector3d().crossVectors(normal, axis)
  if (perp.lengthSq() < POINT_TOL * POINT_TOL) {
    perp.crossVectors(normal, AcGeVector3d.Z_AXIS)
  }
  return perp.normalize()
}

function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < FLOAT_TOL) {
    if (Math.abs(b) < FLOAT_TOL) return []
    return [-c / b]
  }
  const disc = b * b - 4 * a * c
  if (disc < -POINT_TOL) return []
  if (disc < POINT_TOL) return [-b / (2 * a)]
  const sqrtDisc = Math.sqrt(Math.max(0, disc))
  return [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)]
}

function appendPoints(target: AcGePoint3d[], points: AcGePoint3d[]) {
  for (const point of points) target.push(point)
}

function dedupePoints(points: AcGePoint3d[]): AcGePoint3d[] {
  const unique: AcGePoint3d[] = []
  for (const point of points) {
    if (unique.some(existing => existing.distanceTo(point) <= POINT_TOL)) {
      continue
    }
    unique.push(point)
  }
  return unique
}

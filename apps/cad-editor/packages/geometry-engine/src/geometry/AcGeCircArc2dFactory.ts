import { AcGePoint2dLike } from '../math'
import { AcGeMathUtil, AcGeTol, FLOAT_TOL, TAU } from '../util'
import { AcGeCircArc2d } from './AcGeCircArc2d'
import {
  acgeAngleAtCenter2d,
  acgeComputeCircumcircle2d,
  acgeDistance2d,
  acgeProjectPointOntoCircle2d
} from './AcGeCircArcUtil'

/**
 * Create the unique circular arc from `start` through `through` to `end`.
 *
 * When `reverseDirection` is true, the complementary sweep between the same
 * endpoints is returned (AutoCAD Ctrl-toggle).
 */
export function acgeTryCreateArcByThreePoints(
  start: AcGePoint2dLike,
  through: AcGePoint2dLike,
  end: AcGePoint2dLike,
  reverseDirection: boolean = false
): AcGeCircArc2d | null {
  const circle = acgeComputeCircumcircle2d(start, through, end)
  if (!circle) return null
  const startAngle = acgeAngleAtCenter2d(circle.center, start)
  const throughAngle = acgeAngleAtCenter2d(circle.center, through)
  const endAngle = acgeAngleAtCenter2d(circle.center, end)
  let clockwise = !AcGeMathUtil.isAngleOnCcwSweep(
    startAngle,
    throughAngle,
    endAngle
  )
  if (reverseDirection) clockwise = !clockwise
  return AcGeCircArc2d.fromMathAngles(
    circle.center,
    circle.radius,
    startAngle,
    endAngle,
    clockwise
  )
}

/**
 * Create a full circle from center and radius.
 */
export function acgeTryCreateCircle(
  center: AcGePoint2dLike,
  radius: number
): AcGeCircArc2d | null {
  if (!Number.isFinite(radius) || AcGeTol.isNonPositive(radius)) return null
  return new AcGeCircArc2d(center, radius, 0, TAU, false)
}

/**
 * Create a full circle whose diameter is the segment `p1`–`p2`.
 */
export function acgeTryCreateCircleByDiameter(
  p1: AcGePoint2dLike,
  p2: AcGePoint2dLike
): AcGeCircArc2d | null {
  const diameter = acgeDistance2d(p1, p2)
  if (AcGeTol.isNonPositive(diameter)) return null
  return acgeTryCreateCircle(
    { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    diameter / 2
  )
}

/**
 * Create a full circle through three non-collinear points.
 */
export function acgeTryCreateCircleByThreePoints(
  p1: AcGePoint2dLike,
  p2: AcGePoint2dLike,
  p3: AcGePoint2dLike
): AcGeCircArc2d | null {
  const circle = acgeComputeCircumcircle2d(p1, p2, p3)
  if (!circle) return null
  return acgeTryCreateCircle(circle.center, circle.radius)
}

/**
 * Create the shorter arc from `start` to `end` on the circle at `center`.
 */
export function acgeTryCreateShorterArc(
  start: AcGePoint2dLike,
  end: AcGePoint2dLike,
  center: AcGePoint2dLike
): AcGeCircArc2d | null {
  const radius = acgeDistance2d(center, start)
  if (AcGeTol.isNonPositive(radius)) return null
  const startAngle = acgeAngleAtCenter2d(center, start)
  const endAngle = acgeAngleAtCenter2d(center, end)
  const ccwSpan = AcGeMathUtil.normalizeAngle(endAngle - startAngle)
  return AcGeCircArc2d.fromMathAngles(
    center,
    radius,
    startAngle,
    endAngle,
    ccwSpan > Math.PI
  )
}

/**
 * Create an arc from center, start, and end with an explicit orientation.
 */
export function acgeTryCreateArcByCenterStartEnd(
  center: AcGePoint2dLike,
  start: AcGePoint2dLike,
  end: AcGePoint2dLike,
  clockwise: boolean
): AcGeCircArc2d | null {
  const radiusFromStart = acgeDistance2d(center, start)
  const radiusFromEnd = acgeDistance2d(center, end)
  if (
    AcGeTol.isNonPositive(radiusFromStart) ||
    AcGeTol.isNonPositive(radiusFromEnd)
  ) {
    return null
  }
  const tolerance = Math.max(FLOAT_TOL, radiusFromStart * FLOAT_TOL)
  if (Math.abs(radiusFromStart - radiusFromEnd) > tolerance) return null
  return AcGeCircArc2d.fromMathAngles(
    center,
    radiusFromStart,
    acgeAngleAtCenter2d(center, start),
    acgeAngleAtCenter2d(center, end),
    clockwise
  )
}

/**
 * Create a center-start arc whose end is the radial projection of `rawEnd`.
 */
export function acgeTryCreateArcByCenterStartProjectedEnd(
  center: AcGePoint2dLike,
  start: AcGePoint2dLike,
  rawEnd: AcGePoint2dLike,
  clockwise: boolean
): AcGeCircArc2d | null {
  const radius = acgeDistance2d(center, start)
  if (AcGeTol.isNonPositive(radius)) return null
  const end = acgeProjectPointOntoCircle2d(center, radius, rawEnd)
  if (!end) return null
  return acgeTryCreateArcByCenterStartEnd(center, start, end, clockwise)
}

/**
 * Create a center-start arc from a signed included angle.
 * Positive sweep is counterclockwise.
 */
export function acgeTryCreateArcByCenterStartSweep(
  center: AcGePoint2dLike,
  start: AcGePoint2dLike,
  sweepRad: number
): AcGeCircArc2d | null {
  const radius = acgeDistance2d(center, start)
  const sweep = Math.abs(sweepRad)
  if (
    AcGeTol.isNonPositive(radius) ||
    AcGeTol.isNonPositive(sweep) ||
    !AcGeTol.great(TAU - sweep, 0)
  ) {
    return null
  }
  const clockwise = sweepRad < 0
  const startAngle = acgeAngleAtCenter2d(center, start)
  const endAngle = clockwise ? startAngle - sweep : startAngle + sweep
  return AcGeCircArc2d.fromMathAngles(
    center,
    radius,
    startAngle,
    endAngle,
    clockwise
  )
}

/**
 * Create a center-start arc from a signed chord length.
 */
export function acgeTryCreateArcByCenterStartChord(
  center: AcGePoint2dLike,
  start: AcGePoint2dLike,
  chordLength: number
): AcGeCircArc2d | null {
  const radius = acgeDistance2d(center, start)
  const chord = Math.abs(chordLength)
  if (
    AcGeTol.isNonPositive(radius) ||
    AcGeTol.isNonPositive(chord) ||
    AcGeTol.great(chord, 2 * radius)
  ) {
    return null
  }
  const ratio = Math.max(-1, Math.min(1, chord / (2 * radius)))
  const sweep = 2 * Math.asin(ratio)
  return acgeTryCreateArcByCenterStartSweep(
    center,
    start,
    chordLength >= 0 ? sweep : -sweep
  )
}

/**
 * Create a start-end arc from a signed included angle.
 * Positive sweep is counterclockwise.
 */
export function acgeTryCreateArcByStartEndAngle(
  start: AcGePoint2dLike,
  end: AcGePoint2dLike,
  sweepRad: number
): AcGeCircArc2d | null {
  const chord = acgeDistance2d(start, end)
  const sweep = Math.abs(sweepRad)
  if (
    AcGeTol.isNonPositive(chord) ||
    AcGeTol.isNonPositive(sweep) ||
    !AcGeTol.great(TAU - sweep, 0)
  ) {
    return null
  }

  const sinHalf = Math.sin(sweep / 2)
  if (AcGeTol.equalToZero(sinHalf)) return null

  const radius = chord / (2 * sinHalf)
  const offsetSquared = radius * radius - (chord * chord) / 4
  if (AcGeTol.less(offsetSquared, 0)) return null

  const offset = Math.sqrt(Math.max(0, offsetSquared))
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const dx = end.x - start.x
  const dy = end.y - start.y
  const ux = -dy / chord
  const uy = dx / chord

  const isCounterClockwise = sweepRad >= 0
  const useLeft =
    (isCounterClockwise && sweep <= Math.PI) ||
    (!isCounterClockwise && sweep > Math.PI)
  const side = useLeft ? 1 : -1
  const center = {
    x: midX + ux * offset * side,
    y: midY + uy * offset * side
  }
  return acgeTryCreateArcByCenterStartEnd(
    center,
    start,
    end,
    !isCounterClockwise
  )
}

/**
 * Create a start-end arc from a tangent direction at the start point.
 */
export function acgeTryCreateArcByStartEndDirection(
  start: AcGePoint2dLike,
  end: AcGePoint2dLike,
  directionRad: number
): AcGeCircArc2d | null {
  const tx = Math.cos(directionRad)
  const ty = Math.sin(directionRad)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const nx = -ty
  const ny = tx
  const denominator = 2 * (dx * nx + dy * ny)
  if (AcGeTol.equalToZero(denominator)) return null

  const lambda = (dx * dx + dy * dy) / denominator
  if (!Number.isFinite(lambda)) return null

  const center = {
    x: start.x + nx * lambda,
    y: start.y + ny * lambda
  }
  const radiusVectorX = start.x - center.x
  const radiusVectorY = start.y - center.y
  const cross = radiusVectorX * ty - radiusVectorY * tx
  if (AcGeTol.equalToZero(cross)) return null

  return acgeTryCreateArcByCenterStartEnd(center, start, end, cross < 0)
}

/**
 * Create a start-end arc from a signed radius.
 * Positive radius is counterclockwise (+Z).
 */
export function acgeTryCreateArcByStartEndRadius(
  start: AcGePoint2dLike,
  end: AcGePoint2dLike,
  radiusInput: number
): AcGeCircArc2d | null {
  const radius = Math.abs(radiusInput)
  const chord = acgeDistance2d(start, end)
  if (
    AcGeTol.isNonPositive(radius) ||
    AcGeTol.isNonPositive(chord) ||
    AcGeTol.great(chord, 2 * radius)
  ) {
    return null
  }

  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2
  const dx = end.x - start.x
  const dy = end.y - start.y
  const ux = -dy / chord
  const uy = dx / chord
  const offset = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4))
  const side = radiusInput >= 0 ? 1 : -1
  const center = {
    x: midX + ux * offset * side,
    y: midY + uy * offset * side
  }
  return acgeTryCreateArcByCenterStartEnd(center, start, end, radiusInput < 0)
}

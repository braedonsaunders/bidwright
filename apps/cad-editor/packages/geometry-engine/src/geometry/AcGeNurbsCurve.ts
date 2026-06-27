import { AcGePoint3d, AcGePoint3dLike } from '../math'

/**
 * Squared distance from a geometry point to a numeric `[x, y, z]` tuple.
 *
 * @param a - Query point
 * @param b - Target coordinates as `[x, y, z]`
 * @returns Squared Euclidean distance
 */
function distSq3d(a: AcGePoint3dLike, b: number[]): number {
  const dx = a.x - b[0]!
  const dy = a.y - b[1]!
  const dz = (a.z ?? 0) - (b[2] ?? 0)
  return dx * dx + dy * dy + dz * dz
}
import { AcGePoint2d } from '../math/AcGePoint2d'
import {
  calculateCurveLength,
  evaluateNurbsDerivatives,
  interpolateNurbsCurve,
  signedPlanarCurvature
} from '../util'
import { AcGeCatmullRomCurve3d } from './AcGeCatmullRomCurve3d'

/**
 * Type for NURBS knot parameterization
 */
export type AcGeKnotParameterizationType = 'Uniform' | 'Chord' | 'SqrtChord'

/**
 * A NURBS curve implementation that can be used by other curve classes
 */
export class AcGeNurbsCurve {
  private _degree: number
  private _knots: number[]
  private _controlPoints: AcGePoint3dLike[]
  private _weights: number[]

  /**
   * Creates a NURBS curve from degree, knots, control points, and optional weights.
   *
   * When `weights` is omitted, all control points receive a weight of `1.0`
   * (non-rational B-spline).
   *
   * @param degree - Polynomial degree `p` of the basis functions
   * @param knots - Non-decreasing knot vector of length `n + p + 1`
   * @param controlPoints - Control points in curve order
   * @param weights - Optional rational weights aligned with control points
   */
  constructor(
    degree: number,
    knots: number[],
    controlPoints: AcGePoint3dLike[],
    weights?: number[]
  ) {
    this._degree = degree
    this._knots = [...knots]
    this._controlPoints = controlPoints.map(p => ({ x: p.x, y: p.y, z: p.z }))
    this._weights = weights
      ? [...weights]
      : new Array(controlPoints.length).fill(1.0)
  }

  /**
   * Get the degree of the NURBS curve
   */
  degree(): number {
    return this._degree
  }

  /**
   * Get the knot vector
   */
  knots(): number[] {
    return [...this._knots]
  }

  /**
   * Get the control points
   */
  controlPoints(): AcGePoint3dLike[] {
    return this._controlPoints.map(p => ({ x: p.x, y: p.y, z: p.z }))
  }

  /**
   * Get the weights
   */
  weights(): number[] {
    return [...this._weights]
  }

  /**
   * Return a deep-cloned copy of this NURBS curve.
   */
  clone() {
    return new AcGeNurbsCurve(
      this._degree,
      this._knots,
      this._controlPoints,
      this._weights
    )
  }

  /**
   * Calculates a point on the curve at parameter `u`.
   *
   * Delegates to {@link evaluate} and returns only the position component.
   *
   * @param u - Curve parameter in the valid knot span
   * @returns Evaluated point as `[x, y, z]`
   */
  point(u: number): number[] {
    return this.evaluate(u).point
  }

  /**
   * Evaluates position and parametric derivatives at parameter `u`.
   *
   * Returns the rational NURBS point together with first- and second-order
   * parametric derivatives computed analytically from the basis functions.
   *
   * @param u - Curve parameter in the valid knot span
   * @returns Position `point`, first derivative `deriv1`, and second derivative `deriv2`
   */
  evaluate(u: number) {
    const controlPointsArray = this._controlPoints.map(p => [p.x, p.y, p.z])
    return evaluateNurbsDerivatives(
      u,
      this._degree,
      this._knots,
      controlPointsArray,
      this._weights
    )
  }

  /**
   * Signed curvature in the XY plane at parameter `u`.
   *
   * Uses the standard planar formula
   * `(x'y'' - y'x'') / (x'^2 + y'^2)^(3/2)` applied to the parametric
   * derivatives from {@link evaluate}.
   *
   * @param u - Curve parameter in the valid knot span
   * @returns Signed curvature; positive indicates counterclockwise bending
   */
  signedPlanarCurvatureAt(u: number): number {
    const evaluation = this.evaluate(u)
    return signedPlanarCurvature(evaluation.deriv1, evaluation.deriv2)
  }

  /**
   * Samples a 2D path with analytic tangents for planar offset.
   *
   * Builds an initial uniform parameter list scaled by curve length and offset
   * distance, then refines intervals where `|offsetDist| * |curvature|` exceeds
   * `0.85` (potential cusp region). Each final sample includes a unit tangent
   * derived from the analytic first derivative.
   *
   * @param offsetDist - Signed offset distance used to choose sample density
   * @param maxSamples - Upper bound on the number of returned samples (default 512)
   * @returns XY samples and matching unit tangents in parameter order
   */
  getOffsetSamplePath2d(
    offsetDist: number,
    maxSamples = 512
  ): { points: AcGePoint2d[]; tangents: AcGePoint2d[] } {
    const absOffset = Math.abs(offsetDist)
    const { start, end } = this.getParameterRange()
    const length = this.length()
    const minSamples = Math.max(
      64,
      Math.ceil(length / Math.max(absOffset * 0.2, 1e-6))
    )
    let params = uniformNurbsParameters(
      start,
      end,
      Math.min(minSamples, maxSamples)
    )

    for (let pass = 0; pass < 8 && params.length < maxSamples; pass++) {
      const insertions: number[] = []
      for (let i = 0; i < params.length - 1; i++) {
        const t0 = params[i]
        const t1 = params[i + 1]
        const mid = (t0 + t1) / 2
        const curvature = Math.max(
          Math.abs(this.signedPlanarCurvatureAt(t0)),
          Math.abs(this.signedPlanarCurvatureAt(t1)),
          Math.abs(this.signedPlanarCurvatureAt(mid))
        )
        if (absOffset * curvature > 0.85) {
          insertions.push(mid)
        }
      }
      if (insertions.length === 0) break
      params = mergeSortedParameters(params, insertions)
      if (params.length > maxSamples) {
        params = params.slice(0, maxSamples)
        break
      }
    }

    const points: AcGePoint2d[] = []
    const tangents: AcGePoint2d[] = []
    params.forEach(param => {
      const evaluation = this.evaluate(param)
      points.push(new AcGePoint2d(evaluation.point[0], evaluation.point[1]))
      const dx = evaluation.deriv1[0]
      const dy = evaluation.deriv1[1]
      const len = Math.hypot(dx, dy)
      tangents.push(
        len > 1e-10
          ? new AcGePoint2d(dx / len, dy / len)
          : new AcGePoint2d(1, 0)
      )
    })

    return { points, tangents }
  }

  /**
   * Calculate curve length using numerical integration
   */
  length(): number {
    // Convert AcGePoint3dLike[] to number[][] for utility functions
    const controlPointsArray = this._controlPoints.map(p => [p.x, p.y, p.z])
    return calculateCurveLength(
      this._degree,
      this._knots,
      controlPointsArray,
      this._weights
    )
  }

  /**
   * Create a NURBS curve from control points and knots
   */
  static byKnotsControlPointsWeights(
    degree: number,
    knots: number[],
    controlPoints: AcGePoint3dLike[],
    weights?: number[]
  ): AcGeNurbsCurve {
    return new AcGeNurbsCurve(degree, knots, controlPoints, weights)
  }

  /**
   * Create a NURBS curve from fit points using interpolation
   */
  static byPoints(
    points: number[][],
    degree: number,
    parameterization: AcGeKnotParameterizationType = 'Uniform',
    startTangent?: number[],
    endTangent?: number[]
  ): AcGeNurbsCurve {
    const result = interpolateNurbsCurve(
      points,
      degree,
      parameterization,
      startTangent,
      endTangent
    )

    const controlPoints = result.controlPoints.map(p => ({
      x: p[0],
      y: p[1],
      z: p[2]
    }))

    return new AcGeNurbsCurve(
      degree,
      result.knots,
      controlPoints,
      result.weights
    )
  }

  /**
   * Get the valid parameter range for this curve
   */
  getParameterRange(): { start: number; end: number } {
    const startParam = this._knots[this._degree]
    const endParam = this._knots[this._knots.length - this._degree - 1]
    return { start: startParam, end: endParam }
  }

  /**
   * Get points along the curve
   * @param divisions - Number of divisions to create
   * @returns Array of points along the curve
   */
  getPoints(divisions: number): number[][] {
    const points: number[][] = []
    const { start, end } = this.getParameterRange()

    for (let i = 0; i <= divisions; i++) {
      const t = start + (end - start) * (i / divisions)
      points.push(this.point(t))
    }

    return points
  }

  /**
   * Check if the curve is closed by comparing start and end points
   */
  isClosed(tolerance: number = 1e-6): boolean {
    const { start, end } = this.getParameterRange()
    const startPoint = this.point(start)
    const endPoint = this.point(end)

    const dx = startPoint[0] - endPoint[0]
    const dy = startPoint[1] - endPoint[1]
    const dz = startPoint[2] - endPoint[2]

    return Math.sqrt(dx * dx + dy * dy + dz * dz) < tolerance
  }

  /**
   * Create fit points for a closed NURBS curve using Catmull-Rom interpolation
   */
  static createFitPointsForClosedCurve(
    points: AcGePoint3dLike[]
  ): AcGePoint3d[] {
    if (points.length < 4) {
      throw new Error('At least 4 points are required for a closed NURBS curve')
    }

    // Create a closed Catmull-Rom curve
    const catmullRomCurve = new AcGeCatmullRomCurve3d(
      points,
      true,
      'centripetal'
    )

    // Get points along the curve for NURBS interpolation
    // Use more divisions for smoother curve
    const divisions = Math.max(50, points.length * 2)
    return catmullRomCurve.getPoints(divisions)
  }

  /**
   * Returns the nearest point on this NURBS curve to the given point.
   *
   * Evaluates the curve at uniform steps in parameter space over the valid knot span.
   *
   * @param point - Query point.
   * @param samples - Number of interior samples (default 64).
   */
  nearestPoint(point: AcGePoint3dLike, samples = 64): AcGePoint3dLike {
    const { start, end } = this.getParameterRange()
    let best = this.point(start)
    let bestDistSq = distSq3d(point, best)
    for (let i = 0; i <= samples; i++) {
      const t = start + ((end - start) * i) / samples
      const candidate = this.point(t)
      const d = distSq3d(point, candidate)
      if (d < bestDistSq) {
        bestDistSq = d
        best = candidate
      }
    }
    return { x: best[0]!, y: best[1]!, z: best[2] ?? 0 }
  }

  /**
   * Create a closed NURBS curve using Catmull-Rom interpolation for smooth closure
   */
  static createClosedCurve(
    points: AcGePoint3dLike[],
    degree: number,
    parameterization: AcGeKnotParameterizationType = 'Chord'
  ): AcGeNurbsCurve {
    const curvePoints = this.createFitPointsForClosedCurve(points)

    // Convert AcGePoint3d[] back to number[][]
    const nurbsPoints = curvePoints.map(point => [point.x, point.y, point.z])

    // Create NURBS curve from the interpolated points
    return AcGeNurbsCurve.byPoints(nurbsPoints, degree, parameterization)
  }
}

/**
 * Builds a uniform parameter list between two knot-span endpoints.
 *
 * The last parameter is pinned exactly to `end` to avoid floating-point drift.
 *
 * @param start - First parameter value
 * @param end - Last parameter value
 * @param count - Number of parameters to generate (minimum 2)
 * @returns Sorted parameter values from `start` to `end` inclusive
 */
function uniformNurbsParameters(
  start: number,
  end: number,
  count: number
): number[] {
  if (count < 2) return [start, end]
  const params: number[] = []
  for (let i = 0; i < count; i++) {
    params.push(
      i === count - 1 ? end : start + ((end - start) * i) / (count - 1)
    )
  }
  return params
}

/**
 * Merges a sorted parameter list with additional insertion values.
 *
 * Duplicate values closer than `1e-10` are collapsed so refinement passes do
 * not create redundant evaluations.
 *
 * @param base - Existing sorted parameter values
 * @param insertions - Additional parameters to insert
 * @returns Combined sorted parameter list without near-duplicates
 */
function mergeSortedParameters(base: number[], insertions: number[]): number[] {
  const merged = [...base, ...insertions].sort((a, b) => a - b)
  const result: number[] = []
  merged.forEach(value => {
    const last = result[result.length - 1]
    if (last === undefined || Math.abs(last - value) > 1e-10) {
      result.push(value)
    }
  })
  return result
}

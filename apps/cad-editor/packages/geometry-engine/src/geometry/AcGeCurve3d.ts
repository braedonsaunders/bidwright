import { AcGePoint3d } from '../math/AcGePoint3d'
import { acgeClamp, FLOAT_TOL } from '../util'
import { AcGeShape3d } from './AcGeShape3d'

/**
 * Abstract base class for all 3d curves. Any class that is derived from this class represents
 * a 3d curve.
 */
export abstract class AcGeCurve3d extends AcGeShape3d {
  /**
   * Return true if its start point is identical to its end point. Otherwise, return false.
   */
  abstract get closed(): boolean

  /**
   * Start point of this curve. If the curve is closed, coordinates of start point will be equal to coordinates
   * of end point.
   */
  abstract get startPoint(): AcGePoint3d

  /**
   * End point of this curve. If the curve is closed, coordinates of start point will be equal to coordinates
   * of end point.
   */
  abstract get endPoint(): AcGePoint3d

  /**
   * Length of this curve.
   */
  abstract get length(): number

  /**
   * Return a deep-cloned copy of this curve.
   */
  abstract clone(): AcGeCurve3d

  /**
   * Sample a parametric 3d curve by coarse uniform samples plus chord-height
   * refinement, with a hard evaluation budget of `maxSegments`.
   *
   * Midpoints that already meet the deviation still consume the budget so a
   * highly curved curve cannot exceed the historical `getPoints(100)` cost.
   */
  protected static tessellateParametricCurve(
    startParam: number,
    endParam: number,
    evaluate: (t: number) => AcGePoint3d,
    options: {
      deviation: number
      minSegments: number
      maxSegments: number
    }
  ): AcGePoint3d[] {
    const maxEvals = Math.max(2, Math.round(options.maxSegments))
    const minSegments = Math.max(1, Math.round(options.minSegments))
    const deviationSq =
      Math.max(0, options.deviation) * Math.max(0, options.deviation)

    if (!Number.isFinite(startParam) || !Number.isFinite(endParam)) {
      return [evaluate(0)]
    }
    if (Math.abs(endParam - startParam) <= FLOAT_TOL) {
      return [evaluate(startParam)]
    }

    const minPoints = Math.min(maxEvals, Math.max(2, minSegments + 1))
    const coarseCount = Math.min(maxEvals, Math.max(minPoints, 8))
    let params = uniformParameters(startParam, endParam, coarseCount)
    const points: AcGePoint3d[] = []
    for (let i = 0; i < params.length; i++) {
      points.push(evaluate(params[i]))
    }
    let evalCount = points.length

    for (let pass = 0; pass < 8 && evalCount < maxEvals; pass++) {
      const insertions: { index: number; t: number; point: AcGePoint3d }[] = []
      for (let i = 0; i < params.length - 1; i++) {
        if (evalCount >= maxEvals) {
          break
        }
        const midT = (params[i] + params[i + 1]) / 2
        const mid = evaluate(midT)
        evalCount++
        if (distSqPointToSegment3d(mid, points[i], points[i + 1]) > deviationSq) {
          insertions.push({ index: i, t: midT, point: mid })
        }
      }
      if (insertions.length === 0) {
        break
      }
      const merged = mergeParametricInsertions(params, points, insertions)
      params = merged.params
      points.length = 0
      for (let i = 0; i < merged.points.length; i++) {
        points.push(merged.points[i])
      }
    }

    return points
  }
}

function distSqPointToSegment3d(
  point: AcGePoint3d,
  a: AcGePoint3d,
  b: AcGePoint3d
): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const apx = point.x - a.x
  const apy = point.y - a.y
  const apz = point.z - a.z
  const abLenSq = abx * abx + aby * aby + abz * abz
  if (abLenSq <= FLOAT_TOL * FLOAT_TOL) {
    return apx * apx + apy * apy + apz * apz
  }
  const t = acgeClamp((apx * abx + apy * aby + apz * abz) / abLenSq, 0, 1)
  const dx = apx - abx * t
  const dy = apy - aby * t
  const dz = apz - abz * t
  return dx * dx + dy * dy + dz * dz
}

function uniformParameters(
  start: number,
  end: number,
  count: number
): number[] {
  if (count <= 1) {
    return [start]
  }
  const params: number[] = []
  for (let i = 0; i < count; i++) {
    params.push(
      i === count - 1 ? end : start + ((end - start) * i) / (count - 1)
    )
  }
  return params
}

function mergeParametricInsertions(
  params: number[],
  points: AcGePoint3d[],
  insertions: { index: number; t: number; point: AcGePoint3d }[]
): { params: number[]; points: AcGePoint3d[] } {
  const nextParams: number[] = []
  const nextPoints: AcGePoint3d[] = []
  let ins = 0
  for (let i = 0; i < params.length; i++) {
    nextParams.push(params[i])
    nextPoints.push(points[i])
    while (ins < insertions.length && insertions[ins].index === i) {
      nextParams.push(insertions[ins].t)
      nextPoints.push(insertions[ins].point)
      ins++
    }
  }
  return { params: nextParams, points: nextPoints }
}

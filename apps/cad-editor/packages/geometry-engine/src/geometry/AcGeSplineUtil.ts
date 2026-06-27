import { AcGePoint3dLike } from '../math'

export function isNonZeroDirection(vector?: AcGePoint3dLike | null): boolean {
  if (!vector) return false
  const x = vector.x ?? 0
  const y = vector.y ?? 0
  const z = vector.z ?? 0
  return x * x + y * y + z * z > 1e-20
}

export function resolveControlPointSplineDegree(
  declaredDegree: number | undefined,
  controlPointCount: number,
  knotCount: number
): number {
  let degree = declaredDegree ?? 0
  if (degree < 1 && knotCount > 0 && controlPointCount > 0) {
    degree = knotCount - controlPointCount - 1
  }
  if (degree < 1) {
    degree = 3
  }
  degree = Math.min(degree, controlPointCount - 1)
  return Math.max(1, degree)
}

export function resolveFitPointSplineDegree(
  declaredDegree: number | undefined,
  fitPointCount: number,
  tangentCount: number
): number {
  let degree = declaredDegree ?? 0
  if (degree < 1) {
    degree = 3
  }
  const maxDegree = fitPointCount + tangentCount - 1
  degree = Math.min(degree, maxDegree)
  return Math.max(1, degree)
}

export function normalizeSplineWeights(
  weights: number[] | undefined,
  controlPointCount: number
): number[] | undefined {
  if (!weights || weights.length !== controlPointCount) {
    return undefined
  }
  return weights
}

/**
 * NURBS utility functions for spline calculations
 */

type KnotParameterizationType = 'Uniform' | 'Chord' | 'SqrtChord'

/**
 * Generate uniform knot vector
 */
export function generateUniformKnots(
  degree: number,
  numControlPoints: number
): number[] {
  const knots: number[] = []
  const n = numControlPoints - 1
  const p = degree

  // First p+1 knots are 0
  for (let i = 0; i <= p; i++) {
    knots.push(0)
  }

  // Middle knots are uniform
  for (let i = 1; i <= n - p; i++) {
    knots.push(i)
  }

  // Last p+1 knots are n-p+1
  for (let i = 0; i <= p; i++) {
    knots.push(n - p + 1)
  }

  return knots
}

/**
 * Generate chord-length parameterized knots
 */
export function generateChordKnots(
  degree: number,
  points: number[][]
): number[] {
  const n = points.length - 1
  const p = degree

  // Calculate chord lengths
  const chordLengths: number[] = [0]
  let totalLength = 0

  for (let i = 1; i <= n; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dy = points[i][1] - points[i - 1][1]
    const dz = points[i][2] - points[i - 1][2]
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    totalLength += length
    chordLengths.push(totalLength)
  }

  // Generate knots based on chord lengths
  const knots: number[] = []

  // First p+1 knots are 0
  for (let i = 0; i <= p; i++) {
    knots.push(0)
  }

  // Middle knots based on chord lengths
  for (let i = 1; i <= n - p; i++) {
    const t = chordLengths[i] / totalLength
    knots.push(t * (n - p + 1))
  }

  // Last p+1 knots are n-p+1
  for (let i = 0; i <= p; i++) {
    knots.push(n - p + 1)
  }

  return knots
}

/**
 * Compute parameter values for fit points
 */
export function computeParameterValues(
  points: number[][],
  parameterization: KnotParameterizationType = 'Uniform'
): number[] {
  const count = points.length
  if (count === 0) {
    return []
  }
  if (count === 1) {
    return [0]
  }

  const m = count - 1
  if (parameterization === 'Uniform') {
    return new Array(count).fill(0).map((_, i) => i / m)
  }

  const params: number[] = [0]
  let total = 0
  for (let i = 1; i <= m; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dy = points[i][1] - points[i - 1][1]
    const dz = points[i][2] - points[i - 1][2]
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const segment =
      parameterization === 'SqrtChord' ? Math.sqrt(length) : length
    total += segment
    params.push(total)
  }

  if (total < 1e-12) {
    return new Array(count).fill(0).map((_, i) => i / m)
  }

  return params.map(value => value / total)
}

/**
 * Generate a clamped knot vector using averaging method
 */
export function generateAveragedKnots(
  degree: number,
  parameters: number[]
): number[] {
  const n = parameters.length - 1
  const p = degree
  const m = n + p + 1

  const knots = new Array(m + 1).fill(0)
  const endValue = parameters[parameters.length - 1]

  for (let i = m - p; i <= m; i++) {
    knots[i] = endValue
  }

  for (let j = 1; j <= n - p; j++) {
    let sum = 0
    for (let i = j; i < j + p; i++) {
      sum += parameters[i]
    }
    knots[j + p] = sum / p
  }

  return knots
}

/**
 * Generate sqrt-chord parameterized knots
 */
export function generateSqrtChordKnots(
  degree: number,
  points: number[][]
): number[] {
  const n = points.length - 1
  const p = degree

  // Calculate sqrt chord lengths
  const sqrtChordLengths: number[] = [0]
  let totalSqrtLength = 0

  for (let i = 1; i <= n; i++) {
    const dx = points[i][0] - points[i - 1][0]
    const dy = points[i][1] - points[i - 1][1]
    const dz = points[i][2] - points[i - 1][2]
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const sqrtLength = Math.sqrt(length)
    totalSqrtLength += sqrtLength
    sqrtChordLengths.push(totalSqrtLength)
  }

  // Generate knots based on sqrt chord lengths
  const knots: number[] = []

  // First p+1 knots are 0
  for (let i = 0; i <= p; i++) {
    knots.push(0)
  }

  // Middle knots based on sqrt chord lengths
  for (let i = 1; i <= n - p; i++) {
    const t = sqrtChordLengths[i] / totalSqrtLength
    knots.push(t * (n - p + 1))
  }

  // Last p+1 knots are n-p+1
  for (let i = 0; i <= p; i++) {
    knots.push(n - p + 1)
  }

  return knots
}

function solveLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = matrix.length
  const a = matrix.map(row => row.slice())
  const b = rhs.slice()

  for (let k = 0; k < n; k++) {
    let pivotRow = k
    let pivotValue = Math.abs(a[k][k])
    for (let i = k + 1; i < n; i++) {
      const value = Math.abs(a[i][k])
      if (value > pivotValue) {
        pivotValue = value
        pivotRow = i
      }
    }

    if (pivotValue < 1e-12) {
      throw new Error('Interpolation matrix is singular.')
    }

    if (pivotRow !== k) {
      const tmpRow = a[k]
      a[k] = a[pivotRow]
      a[pivotRow] = tmpRow

      const tmpValue = b[k]
      b[k] = b[pivotRow]
      b[pivotRow] = tmpValue
    }

    for (let i = k + 1; i < n; i++) {
      const factor = a[i][k] / a[k][k]
      if (Math.abs(factor) < 1e-14) {
        continue
      }
      for (let j = k; j < n; j++) {
        a[i][j] -= factor * a[k][j]
      }
      b[i] -= factor * b[k]
    }
  }

  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i]
    for (let j = i + 1; j < n; j++) {
      sum -= a[i][j] * x[j]
    }
    x[i] = sum / a[i][i]
  }

  return x
}

/**
 * Interpolate a NURBS curve from fit points with optional end tangents
 */
export function interpolateNurbsCurve(
  fitPoints: number[][],
  degree: number,
  parameterization: KnotParameterizationType = 'Uniform',
  startTangent?: number[],
  endTangent?: number[]
): { controlPoints: number[][]; knots: number[]; weights: number[] } {
  if (fitPoints.length === 0) {
    return { controlPoints: [], knots: [], weights: [] }
  }

  const safePoints = fitPoints.map(point => [point[0], point[1], point[2] ?? 0])

  // Tangents are interpreted as first derivatives in the parameter domain.
  const hasStartTangent = !!startTangent
  const hasEndTangent = !!endTangent
  const tangentCount = (hasStartTangent ? 1 : 0) + (hasEndTangent ? 1 : 0)

  const m = safePoints.length - 1
  const n = m + tangentCount

  if (n < degree) {
    throw new Error('Not enough points to interpolate a curve of this degree.')
  }

  const params = computeParameterValues(safePoints, parameterization)
  const extendedParams = params.slice()
  if (hasStartTangent) {
    extendedParams.unshift(params[0])
  }
  if (hasEndTangent) {
    extendedParams.push(params[params.length - 1])
  }

  const knots = generateAveragedKnots(degree, extendedParams)
  const size = n + 1

  const matrix = new Array(size)
  const rhsX = new Array(size)
  const rhsY = new Array(size)
  const rhsZ = new Array(size)

  let row = 0
  matrix[row] = new Array(size).fill(0)
  matrix[row][0] = 1
  rhsX[row] = safePoints[0][0]
  rhsY[row] = safePoints[0][1]
  rhsZ[row] = safePoints[0][2]
  row++

  for (let i = 1; i <= m - 1; i++) {
    const u = params[i]
    matrix[row] = new Array(size).fill(0)
    for (let j = 0; j <= n; j++) {
      matrix[row][j] = basisFunction(j, degree, u, knots)
    }
    rhsX[row] = safePoints[i][0]
    rhsY[row] = safePoints[i][1]
    rhsZ[row] = safePoints[i][2]
    row++
  }

  matrix[row] = new Array(size).fill(0)
  matrix[row][n] = 1
  rhsX[row] = safePoints[m][0]
  rhsY[row] = safePoints[m][1]
  rhsZ[row] = safePoints[m][2]
  row++

  if (hasStartTangent) {
    const denom = knots[degree + 1] - knots[0]
    const coeff = denom !== 0 ? degree / denom : 0
    matrix[row] = new Array(size).fill(0)
    matrix[row][0] = -coeff
    matrix[row][1] = coeff
    rhsX[row] = startTangent?.[0] ?? 0
    rhsY[row] = startTangent?.[1] ?? 0
    rhsZ[row] = startTangent?.[2] ?? 0
    row++
  }

  if (hasEndTangent) {
    const denom = knots[n + degree + 1] - knots[n]
    const coeff = denom !== 0 ? degree / denom : 0
    matrix[row] = new Array(size).fill(0)
    matrix[row][n - 1] = -coeff
    matrix[row][n] = coeff
    rhsX[row] = endTangent?.[0] ?? 0
    rhsY[row] = endTangent?.[1] ?? 0
    rhsZ[row] = endTangent?.[2] ?? 0
    row++
  }

  const solutionX = solveLinearSystem(matrix, rhsX)
  const solutionY = solveLinearSystem(matrix, rhsY)
  const solutionZ = solveLinearSystem(matrix, rhsZ)

  const controlPoints = new Array(size)
  for (let i = 0; i < size; i++) {
    controlPoints[i] = [solutionX[i], solutionY[i], solutionZ[i]]
  }

  const weights = new Array(size).fill(1.0)

  return { controlPoints, knots, weights }
}

/**
 * Calculate basis function value for NURBS
 */
export function basisFunction(
  i: number,
  k: number,
  u: number,
  knots: number[]
): number {
  if (k === 0) {
    return u >= knots[i] && u < knots[i + 1] ? 1.0 : 0.0
  }

  const d1 = knots[i + k] - knots[i]
  const d2 = knots[i + k + 1] - knots[i + 1]

  const c1 = d1 > 1e-10 ? (u - knots[i]) / d1 : 0.0
  const c2 = d2 > 1e-10 ? (knots[i + k + 1] - u) / d2 : 0.0

  return (
    c1 * basisFunction(i, k - 1, u, knots) +
    c2 * basisFunction(i + 1, k - 1, u, knots)
  )
}

/**
 * Calculate point on NURBS curve
 */
export function evaluateNurbsPoint(
  u: number,
  degree: number,
  knots: number[],
  controlPoints: number[][],
  weights: number[]
): number[] {
  const n = controlPoints.length - 1
  const p = degree

  // Clamp parameter to valid range
  u = Math.max(knots[p], Math.min(knots[n + 1], u))

  // If u is very close to the end, return the last control point
  if (Math.abs(u - knots[n + 1]) < 1e-8) {
    return [...controlPoints[n]]
  }

  // If u is very close to the start, return the first control point
  if (Math.abs(u - knots[p]) < 1e-8) {
    return [...controlPoints[0]]
  }

  const point = [0, 0, 0]
  let weight = 0

  for (let i = 0; i <= n; i++) {
    const basis = basisFunction(i, p, u, knots)
    const w = weights[i] * basis

    point[0] += controlPoints[i][0] * w
    point[1] += controlPoints[i][1] * w
    point[2] += controlPoints[i][2] * w
    weight += w
  }

  // If the homogeneous weight sum is close to zero,
  // check if we're at the end and return the last control point
  if (Math.abs(weight) < 1e-10) {
    // Check if we're at the end of the domain
    const endParam = knots[knots.length - p - 1]
    if (Math.abs(u - endParam) < 1e-8) {
      return [...controlPoints[n]]
    }
    // Check if we're at the start of the domain
    if (Math.abs(u - knots[p]) < 1e-8) {
      return [...controlPoints[0]]
    }
  }

  if (Math.abs(weight) >= 1e-10) {
    point[0] /= weight
    point[1] /= weight
    point[2] /= weight
  }

  return point
}

export type AcGeNurbsEvaluation = {
  point: number[]
  deriv1: number[]
  deriv2: number[]
}

/**
 * First derivative of a B-spline basis function N_{i,p}(u).
 */
function basisFunctionDeriv1(
  i: number,
  k: number,
  u: number,
  knots: number[]
): number {
  if (k === 0) return 0

  const denomA = knots[i + k] - knots[i]
  const denomB = knots[i + k + 1] - knots[i + 1]
  let value = 0

  if (denomA > 1e-10) {
    value += (k / denomA) * basisFunction(i, k - 1, u, knots)
  }
  if (denomB > 1e-10) {
    value -= (k / denomB) * basisFunction(i + 1, k - 1, u, knots)
  }

  return value
}

/**
 * Second derivative of a B-spline basis function N_{i,p}(u).
 */
function basisFunctionDeriv2(
  i: number,
  k: number,
  u: number,
  knots: number[]
): number {
  if (k <= 1) return 0

  const denomA = knots[i + k] - knots[i]
  const denomB = knots[i + k + 1] - knots[i + 1]
  let value = 0

  if (denomA > 1e-10) {
    value += (k / denomA) * basisFunctionDeriv1(i, k - 1, u, knots)
  }
  if (denomB > 1e-10) {
    value -= (k / denomB) * basisFunctionDeriv1(i + 1, k - 1, u, knots)
  }

  return value
}

/**
 * Evaluates a rational NURBS curve and its first two parametric derivatives.
 */
export function evaluateNurbsDerivatives(
  u: number,
  degree: number,
  knots: number[],
  controlPoints: number[][],
  weights: number[]
): AcGeNurbsEvaluation {
  const n = controlPoints.length - 1
  const p = degree
  const startParam = knots[p]
  const endParam = knots[n + 1]
  u = Math.max(startParam, Math.min(endParam, u))

  const aw = [0, 0, 0]
  const daw = [0, 0, 0]
  const d2aw = [0, 0, 0]
  let w = 0
  let dw = 0
  let d2w = 0

  for (let i = 0; i <= n; i++) {
    const basis = basisFunction(i, p, u, knots)
    const dbasis = basisFunctionDeriv1(i, p, u, knots)
    const d2basis = basisFunctionDeriv2(i, p, u, knots)
    const weight = weights[i]
    const wBasis = weight * basis
    const wDBasis = weight * dbasis
    const wD2Basis = weight * d2basis
    const cp = controlPoints[i]

    aw[0] += wBasis * cp[0]
    aw[1] += wBasis * cp[1]
    aw[2] += wBasis * cp[2]
    daw[0] += wDBasis * cp[0]
    daw[1] += wDBasis * cp[1]
    daw[2] += wDBasis * cp[2]
    d2aw[0] += wD2Basis * cp[0]
    d2aw[1] += wD2Basis * cp[1]
    d2aw[2] += wD2Basis * cp[2]
    w += wBasis
    dw += wDBasis
    d2w += wD2Basis
  }

  if (Math.abs(w) < 1e-10) {
    const point = evaluateNurbsPoint(u, degree, knots, controlPoints, weights)
    return { point, deriv1: [0, 0, 0], deriv2: [0, 0, 0] }
  }

  const w2 = w * w
  const point = [aw[0] / w, aw[1] / w, aw[2] / w]
  const deriv1 = [
    (daw[0] * w - aw[0] * dw) / w2,
    (daw[1] * w - aw[1] * dw) / w2,
    (daw[2] * w - aw[2] * dw) / w2
  ]
  const num2x = d2aw[0] * w - aw[0] * d2w
  const num2y = d2aw[1] * w - aw[1] * d2w
  const num2z = d2aw[2] * w - aw[2] * d2w
  const deriv2 = [
    num2x / w2 - (2 * dw * deriv1[0]) / w,
    num2y / w2 - (2 * dw * deriv1[1]) / w,
    num2z / w2 - (2 * dw * deriv1[2]) / w
  ]

  return { point, deriv1, deriv2 }
}

/**
 * Signed planar curvature from parametric derivatives in XY.
 */
export function signedPlanarCurvature(
  deriv1: number[],
  deriv2: number[]
): number {
  const dx = deriv1[0]
  const dy = deriv1[1]
  const ddx = deriv2[0]
  const ddy = deriv2[1]
  const speed2 = dx * dx + dy * dy
  if (speed2 < 1e-20) return 0
  return (dx * ddy - dy * ddx) / Math.pow(speed2, 1.5)
}

/**
 * Calculate curve length using numerical integration
 */
export function calculateCurveLength(
  degree: number,
  knots: number[],
  controlPoints: number[][],
  weights: number[]
): number {
  const p = degree
  const startParam = knots[p]
  const endParam = knots[knots.length - p - 1]

  let length = 0
  const steps = 1000
  const step = (endParam - startParam) / steps

  let prevPoint = evaluateNurbsPoint(
    startParam,
    degree,
    knots,
    controlPoints,
    weights
  )

  for (let i = 1; i <= steps; i++) {
    const u = startParam + i * step
    const point = evaluateNurbsPoint(u, degree, knots, controlPoints, weights)

    const dx = point[0] - prevPoint[0]
    const dy = point[1] - prevPoint[1]
    const dz = point[2] - prevPoint[2]

    length += Math.sqrt(dx * dx + dy * dy + dz * dz)
    prevPoint = point
  }

  // Add the final segment to the end point
  const finalPoint = evaluateNurbsPoint(
    endParam,
    degree,
    knots,
    controlPoints,
    weights
  )
  const dx = finalPoint[0] - prevPoint[0]
  const dy = finalPoint[1] - prevPoint[1]
  const dz = finalPoint[2] - prevPoint[2]
  length += Math.sqrt(dx * dx + dy * dy + dz * dz)

  return length
}

/**
 * Generate control points from fit points using interpolation
 */
export function interpolateControlPoints(
  fitPoints: number[][],
  degree: number = 3,
  parameterization: KnotParameterizationType = 'Uniform',
  startTangent?: number[],
  endTangent?: number[]
): number[][] {
  if (fitPoints.length === 0) {
    return []
  }

  return interpolateNurbsCurve(
    fitPoints,
    degree,
    parameterization,
    startTangent,
    endTangent
  ).controlPoints
}

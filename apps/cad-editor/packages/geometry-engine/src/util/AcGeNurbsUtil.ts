/**
 * NURBS utility functions for spline calculations
 */

type KnotParameterizationType = 'Uniform' | 'Chord' | 'SqrtChord'

/**
 * Generate uniform knot vector
 */
export function acgeGenerateUniformKnots(
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
export function acgeGenerateChordKnots(
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
export function acgeComputeParameterValues(
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
export function acgeGenerateAveragedKnots(
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
export function acgeGenerateSqrtChordKnots(
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

interface SparseRowEntry {
  col: number
  value: number
}

/**
 * Returns the value of the entry in `row` for `col`, or `0` when absent.
 *
 * Rows are short (bounded by the system bandwidth), so a linear scan is
 * cheaper than binary search.
 */
function findRowEntry(row: SparseRowEntry[], col: number): number {
  for (const entry of row) {
    if (entry.col === col) {
      return entry.value
    }
  }
  return 0
}

/**
 * Returns the index of the entry in `row` for `col`, or `-1` when absent.
 */
function findRowEntryIndex(row: SparseRowEntry[], col: number): number {
  for (let i = 0; i < row.length; i++) {
    if (row[i].col === col) {
      return i
    }
  }
  return -1
}

/**
 * Solves one banded linear system with multiple right-hand sides.
 *
 * Gaussian elimination with partial pivoting over the sparse rows. Only rows
 * whose band window contains column `k` carry a `k` entry, so both the pivot
 * search and the elimination step touch at most `band + 1` non-empty rows per
 * column — the full-row loops below degrade to O(n² · band) instead of the
 * dense solver's O(n³). A single factorization serves every RHS, so the X/Y/Z
 * coordinate systems share one elimination pass.
 *
 * Note the pivot search scans every remaining row rather than a window of
 * `band`: row swaps displace band rows downward, so a column's live entries
 * can end up arbitrarily far below the diagonal.
 *
 * @param rows - Sparse matrix rows; every non-zero entry must satisfy
 *   `|col - rowIndex| <= band` before pivoting.
 * @param rhsList - One right-hand-side vector per output solution.
 * @returns One solution vector per RHS.
 * @throws {Error} When a pivot falls below `1e-12` (singular).
 */
function solveBandedLinearSystem(
  rows: SparseRowEntry[][],
  rhsList: number[][]
): number[][] {
  const n = rows.length
  const a = rows.map(row => row.map(entry => ({ col: entry.col, value: entry.value })))
  const bList = rhsList.map(rhs => rhs.slice())

  for (let k = 0; k < n; k++) {
    // Partial pivot over all remaining rows that carry a `k` entry.
    let pivotRow = -1
    let pivotAbs = 1e-12
    for (let i = k; i < n; i++) {
      const abs = Math.abs(findRowEntry(a[i], k))
      if (abs > pivotAbs) {
        pivotAbs = abs
        pivotRow = i
      }
    }

    if (pivotRow < 0) {
      throw new Error('Interpolation matrix is singular.')
    }

    if (pivotRow !== k) {
      const tmpRow = a[k]
      a[k] = a[pivotRow]
      a[pivotRow] = tmpRow
      for (const b of bList) {
        const tmpValue = b[k]
        b[k] = b[pivotRow]
        b[pivotRow] = tmpValue
      }
    }

    const pivotValue = findRowEntry(a[k], k)
    for (let i = k + 1; i < n; i++) {
      const entryIndex = findRowEntryIndex(a[i], k)
      if (entryIndex < 0) {
        continue
      }
      const factor = a[i][entryIndex].value / pivotValue
      if (Math.abs(factor) < 1e-14) {
        continue
      }
      for (const entry of a[i]) {
        if (entry.col > k) {
          entry.value -= factor * findRowEntry(a[k], entry.col)
        }
      }
      // Fill-in: the dense elimination subtracts the scaled pivot row from
      // every column, so row `i` gains entries wherever the pivot row has a
      // non-zero beyond the diagonal and row `i` has none. Missing these
      // entries drops columns from later pivots and can make a well-posed
      // system look singular.
      for (const pivotEntry of a[k]) {
        if (pivotEntry.col <= k || pivotEntry.value === 0) {
          continue
        }
        if (findRowEntryIndex(a[i], pivotEntry.col) < 0) {
          a[i].push({
            col: pivotEntry.col,
            value: -factor * pivotEntry.value
          })
        }
      }
      a[i][entryIndex].value = 0
      for (const b of bList) {
        b[i] -= factor * b[k]
      }
    }
  }

  const solutions = bList.map(() => new Array<number>(n).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    const diagonal = findRowEntry(a[i], i)
    for (let s = 0; s < bList.length; s++) {
      let sum = bList[s][i]
      for (const entry of a[i]) {
        if (entry.col > i) {
          sum -= entry.value * solutions[s][entry.col]
        }
      }
      solutions[s][i] = sum / diagonal
    }
  }

  return solutions
}

/**
 * Finds the knot span index such that `knots[span] <= u < knots[span + 1]`.
 *
 * @param u - Parameter value inside the valid knot domain.
 * @param degree - Curve degree.
 * @param knots - Clamped knot vector.
 * @returns The span index in `[degree, knots.length - degree - 2]`.
 */
function findKnotSpan(u: number, degree: number, knots: number[]): number {
  const lastIndex = knots.length - degree - 2
  if (u >= knots[lastIndex + 1]) {
    return lastIndex
  }
  let lo = degree
  let hi = knots.length - degree - 2
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (u < knots[mid]) {
      hi = mid - 1
    } else if (u >= knots[mid + 1]) {
      lo = mid + 1
    } else {
      return mid
    }
  }
  return degree
}

/**
 * Interpolate a NURBS curve from fit points with optional end tangents
 */
export function acgeInterpolateNurbsCurve(
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

  const params = acgeComputeParameterValues(safePoints, parameterization)
  const extendedParams = params.slice()
  if (hasStartTangent) {
    extendedParams.unshift(params[0])
  }
  if (hasEndTangent) {
    extendedParams.push(params[params.length - 1])
  }

  const knots = acgeGenerateAveragedKnots(degree, extendedParams)
  const size = n + 1

  // The collocation matrix is banded (B-spline support is local). Rows are
  // ordered so every non-zero entry stays within `degree + 1` of the diagonal:
  // start tangent first (columns 0/1), then the interpolation rows in
  // parameter order, then the end tangent (columns n-1/n).
  const rows: SparseRowEntry[][] = []
  const rhsX: number[] = []
  const rhsY: number[] = []
  const rhsZ: number[] = []

  if (hasStartTangent) {
    const denom = knots[degree + 1] - knots[0]
    const coeff = denom !== 0 ? degree / denom : 0
    rows.push([
      { col: 0, value: -coeff },
      { col: 1, value: coeff }
    ])
    rhsX.push(startTangent?.[0] ?? 0)
    rhsY.push(startTangent?.[1] ?? 0)
    rhsZ.push(startTangent?.[2] ?? 0)
  }

  rows.push([{ col: 0, value: 1 }])
  rhsX.push(safePoints[0][0])
  rhsY.push(safePoints[0][1])
  rhsZ.push(safePoints[0][2])

  for (let i = 1; i <= m - 1; i++) {
    const u = params[i]
    const row: SparseRowEntry[] = []
    const span = findKnotSpan(u, degree, knots)
    const first = Math.max(0, span - degree)
    const last = Math.min(n, span)
    for (let j = first; j <= last; j++) {
      const value = acgeBasisFunction(j, degree, u, knots)
      if (value !== 0) {
        row.push({ col: j, value })
      }
    }
    rows.push(row)
    rhsX.push(safePoints[i][0])
    rhsY.push(safePoints[i][1])
    rhsZ.push(safePoints[i][2])
  }

  rows.push([{ col: n, value: 1 }])
  rhsX.push(safePoints[m][0])
  rhsY.push(safePoints[m][1])
  rhsZ.push(safePoints[m][2])

  if (hasEndTangent) {
    const denom = knots[n + degree + 1] - knots[n]
    const coeff = denom !== 0 ? degree / denom : 0
    rows.push([
      { col: n - 1, value: -coeff },
      { col: n, value: coeff }
    ])
    rhsX.push(endTangent?.[0] ?? 0)
    rhsY.push(endTangent?.[1] ?? 0)
    rhsZ.push(endTangent?.[2] ?? 0)
  }

  const [solutionX, solutionY, solutionZ] = solveBandedLinearSystem(rows, [
    rhsX,
    rhsY,
    rhsZ
  ])

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
export function acgeBasisFunction(
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
    c1 * acgeBasisFunction(i, k - 1, u, knots) +
    c2 * acgeBasisFunction(i + 1, k - 1, u, knots)
  )
}

/**
 * Calculate point on NURBS curve
 */
export function acgeEvaluateNurbsPoint(
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
    const basis = acgeBasisFunction(i, p, u, knots)
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
    value += (k / denomA) * acgeBasisFunction(i, k - 1, u, knots)
  }
  if (denomB > 1e-10) {
    value -= (k / denomB) * acgeBasisFunction(i + 1, k - 1, u, knots)
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
export function acgeEvaluateNurbsDerivatives(
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
    const basis = acgeBasisFunction(i, p, u, knots)
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
    const point = acgeEvaluateNurbsPoint(u, degree, knots, controlPoints, weights)
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
export function acgeSignedPlanarCurvature(
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
export function acgeCalculateCurveLength(
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

  let prevPoint = acgeEvaluateNurbsPoint(
    startParam,
    degree,
    knots,
    controlPoints,
    weights
  )

  for (let i = 1; i <= steps; i++) {
    const u = startParam + i * step
    const point = acgeEvaluateNurbsPoint(u, degree, knots, controlPoints, weights)

    const dx = point[0] - prevPoint[0]
    const dy = point[1] - prevPoint[1]
    const dz = point[2] - prevPoint[2]

    length += Math.sqrt(dx * dx + dy * dy + dz * dz)
    prevPoint = point
  }

  // Add the final segment to the end point
  const finalPoint = acgeEvaluateNurbsPoint(
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
export function acgeInterpolateControlPoints(
  fitPoints: number[][],
  degree: number = 3,
  parameterization: KnotParameterizationType = 'Uniform',
  startTangent?: number[],
  endTangent?: number[]
): number[][] {
  if (fitPoints.length === 0) {
    return []
  }

  return acgeInterpolateNurbsCurve(
    fitPoints,
    degree,
    parameterization,
    startTangent,
    endTangent
  ).controlPoints
}

import {
  computeParameterValues,
  generateUniformKnots,
  generateChordKnots,
  generateSqrtChordKnots,
  basisFunction,
  evaluateNurbsPoint,
  evaluateNurbsDerivatives,
  signedPlanarCurvature,
  calculateCurveLength,
  interpolateControlPoints,
  interpolateNurbsCurve
} from '../src/util/AcGeNurbsUtil'

describe('AcGeNurbsUtil', () => {
  describe('generateUniformKnots', () => {
    it('should generate uniform knots for degree 3 with 4 control points', () => {
      const knots = generateUniformKnots(3, 4)
      expect(knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    })

    it('should generate uniform knots for degree 2 with 5 control points', () => {
      const knots = generateUniformKnots(2, 5)
      expect(knots).toEqual([0, 0, 0, 1, 2, 3, 3, 3])
    })

    it('should generate uniform knots for degree 1 with 3 control points', () => {
      const knots = generateUniformKnots(1, 3)
      expect(knots).toEqual([0, 0, 1, 2, 2])
    })
  })

  describe('generateChordKnots', () => {
    it('should generate chord parameterized knots', () => {
      const points = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const knots = generateChordKnots(3, points)

      expect(knots).toHaveLength(8)
      expect(knots[0]).toBe(0)
      expect(knots[1]).toBe(0)
      expect(knots[2]).toBe(0)
      expect(knots[3]).toBe(0)
      expect(knots[4]).toBeGreaterThan(0)
      expect(knots[5]).toBeGreaterThan(0)
      expect(knots[6]).toBe(1)
      expect(knots[7]).toBe(1)
    })

    it('should handle points with different distances', () => {
      const points = [
        [0, 0, 0],
        [1, 0, 0], // distance 1
        [3, 0, 0], // distance 2
        [6, 0, 0] // distance 3
      ]
      const knots = generateChordKnots(3, points)

      // Total length is 6, so middle knots should be proportional
      expect(knots[4]).toBeGreaterThan(0)
      expect(knots[5]).toBeGreaterThan(0)
    })

    it('should create interior chord knots when control points exceed degree + 1', () => {
      const points = [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
        [6, 0, 0],
        [10, 0, 0]
      ]
      const knots = generateChordKnots(2, points)
      expect(knots[3]).toBeGreaterThan(0)
      expect(knots[4]).toBeGreaterThan(knots[3])
    })
  })

  describe('generateSqrtChordKnots', () => {
    it('should generate sqrt chord parameterized knots', () => {
      const points = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const knots = generateSqrtChordKnots(3, points)

      expect(knots).toHaveLength(8)
      expect(knots[0]).toBe(0)
      expect(knots[1]).toBe(0)
      expect(knots[2]).toBe(0)
      expect(knots[3]).toBe(0)
      expect(knots[4]).toBeGreaterThan(0)
      expect(knots[5]).toBeGreaterThan(0)
      expect(knots[6]).toBe(1)
      expect(knots[7]).toBe(1)
    })

    it('should create interior sqrt-chord knots when control points exceed degree + 1', () => {
      const points = [
        [0, 0, 0],
        [1, 0, 0],
        [3, 0, 0],
        [6, 0, 0],
        [10, 0, 0]
      ]
      const knots = generateSqrtChordKnots(2, points)
      expect(knots[3]).toBeGreaterThan(0)
      expect(knots[4]).toBeGreaterThan(knots[3])
    })
  })

  describe('computeParameterValues', () => {
    it('handles empty/single/degenerate distance inputs', () => {
      expect(computeParameterValues([], 'Chord')).toEqual([])
      expect(computeParameterValues([[1, 2, 3]], 'Chord')).toEqual([0])
      expect(
        computeParameterValues(
          [
            [1, 1, 1],
            [1, 1, 1],
            [1, 1, 1]
          ],
          'Chord'
        )
      ).toEqual([0, 0.5, 1])
    })
  })

  describe('basisFunction', () => {
    it('should return 1 for degree 0 when parameter is in range', () => {
      const knots = [0, 1, 2, 3]
      expect(basisFunction(0, 0, 0.5, knots)).toBe(1)
      expect(basisFunction(1, 0, 1.5, knots)).toBe(1)
    })

    it('should return 0 for degree 0 when parameter is out of range', () => {
      const knots = [0, 1, 2, 3]
      expect(basisFunction(0, 0, 1.5, knots)).toBe(0)
      expect(basisFunction(1, 0, 0.5, knots)).toBe(0)
    })

    it('should calculate degree 1 basis function correctly', () => {
      const knots = [0, 0, 1, 1]
      const result = basisFunction(0, 1, 0.5, knots)
      expect(result).toBeGreaterThan(0)
      expect(result).toBeLessThan(1)
    })

    it('should handle edge cases with zero knot differences', () => {
      const knots = [0, 0, 0, 0]
      const result = basisFunction(0, 1, 0, knots)
      expect(result).toBe(0)
    })
  })

  describe('evaluateNurbsPoint', () => {
    it('should evaluate point on NURBS curve', () => {
      const degree = 3
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const controlPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const weights = [1, 1, 1, 1]

      const point = evaluateNurbsPoint(
        0.5,
        degree,
        knots,
        controlPoints,
        weights
      )

      expect(point).toHaveLength(3)
      expect(point[0]).toBeGreaterThan(0)
      expect(point[0]).toBeLessThan(3)
      expect(point[1]).toBeGreaterThan(0)
      expect(point[1]).toBeLessThan(1)
      expect(point[2]).toBe(0)
    })

    it('should clamp parameter to valid range', () => {
      const degree = 3
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const controlPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const weights = [1, 1, 1, 1]

      const point1 = evaluateNurbsPoint(
        -1,
        degree,
        knots,
        controlPoints,
        weights
      )
      const point2 = evaluateNurbsPoint(
        2,
        degree,
        knots,
        controlPoints,
        weights
      )

      expect(point1).toEqual(
        evaluateNurbsPoint(0, degree, knots, controlPoints, weights)
      )
      expect(point2).toEqual(
        evaluateNurbsPoint(1, degree, knots, controlPoints, weights)
      )
    })

    it('should handle weighted control points', () => {
      const degree = 3
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const controlPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const weights = [1, 2, 1, 1] // Second control point has weight 2

      const point = evaluateNurbsPoint(
        0.5,
        degree,
        knots,
        controlPoints,
        weights
      )

      expect(point).toHaveLength(3)
      // The weighted point should be influenced more by the second control point
      expect(point[0]).toBeGreaterThan(1)
    })

    it('should treat uniform negative weights the same as uniform positive weights', () => {
      const degree = 3
      const knots = [3, 3, 3, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9]
      const controlPoints = [
        [400.6139274363574, 122.2912929922276, 0],
        [386.4614997325278, 116.6743761603575, 0],
        [352.3194562446899, 127.4676673274804, 0],
        [341.7464363258755, 147.6224865477202, 0],
        [351.658642499764, 177.6895119418484, 0],
        [389.32502596054, 183.3064287737185, 0],
        [437.2340224676673, 161.1691683187011, 0],
        [414.766355140187, 127.9082098240977, 0],
        [400.6139274363574, 122.2912929922276, 0]
      ]
      const positiveWeights = new Array(controlPoints.length).fill(1)
      const negativeWeights = new Array(controlPoints.length).fill(-1)

      const positivePoint = evaluateNurbsPoint(
        6,
        degree,
        knots,
        controlPoints,
        positiveWeights
      )
      const negativePoint = evaluateNurbsPoint(
        6,
        degree,
        knots,
        controlPoints,
        negativeWeights
      )

      expect(negativePoint[0]).toBeCloseTo(positivePoint[0], 10)
      expect(negativePoint[1]).toBeCloseTo(positivePoint[1], 10)
      expect(negativePoint[2]).toBeCloseTo(positivePoint[2], 10)
    })
  })

  describe('evaluateNurbsDerivatives', () => {
    it('returns a constant tangent for a straight degree-1 segment', () => {
      const degree = 1
      const knots = [0, 0, 1, 1]
      const controlPoints = [
        [0, 0, 0],
        [4, 0, 0]
      ]
      const weights = [1, 1]

      const evaluation = evaluateNurbsDerivatives(
        0.5,
        degree,
        knots,
        controlPoints,
        weights
      )

      expect(evaluation.point[0]).toBeCloseTo(2, 6)
      expect(evaluation.point[1]).toBeCloseTo(0, 6)
      expect(evaluation.deriv1[0]).toBeCloseTo(4, 4)
      expect(evaluation.deriv1[1]).toBeCloseTo(0, 4)
      expect(
        signedPlanarCurvature(evaluation.deriv1, evaluation.deriv2)
      ).toBeCloseTo(0, 4)
    })
  })

  describe('calculateCurveLength', () => {
    it('should calculate length of a straight line', () => {
      const degree = 3
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const controlPoints = [
        [0, 0, 0],
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 0]
      ]
      const weights = [1, 1, 1, 1]

      const length = calculateCurveLength(degree, knots, controlPoints, weights)

      expect(length).toBeCloseTo(1, 2)
    })

    it('should calculate length of a curved spline', () => {
      const degree = 3
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const controlPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const weights = [1, 1, 1, 1]

      const length = calculateCurveLength(degree, knots, controlPoints, weights)

      expect(length).toBeGreaterThan(3) // Should be longer than straight line distance
      expect(length).toBeLessThan(7) // Should be reasonable
    })
  })

  describe('interpolateControlPoints', () => {
    it('should interpolate control points', () => {
      const fitPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]

      const controlPoints = interpolateControlPoints(fitPoints)

      expect(controlPoints).toHaveLength(4)
      expect(controlPoints[0]).toEqual([0, 0, 0])
      expect(controlPoints[3]).toEqual([3, 1, 0])

      // Should be different arrays (copies)
      expect(controlPoints).not.toBe(fitPoints)
      expect(controlPoints[0]).not.toBe(fitPoints[0])
      expect(controlPoints[1]).not.toEqual(fitPoints[1])
    })

    it('should handle empty array', () => {
      const controlPoints = interpolateControlPoints([])
      expect(controlPoints).toEqual([])
    })
  })

  describe('interpolateNurbsCurve', () => {
    it('should return empty result for empty fit points', () => {
      expect(interpolateNurbsCurve([], 3)).toEqual({
        controlPoints: [],
        knots: [],
        weights: []
      })
    })

    it('should throw when not enough points for degree', () => {
      expect(() =>
        interpolateNurbsCurve(
          [
            [0, 0, 0],
            [1, 0, 0]
          ],
          4
        )
      ).toThrow('Not enough points to interpolate a curve of this degree.')
    })

    it('should interpolate fit points with uniform parameterization', () => {
      const fitPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const degree = 3

      const result = interpolateNurbsCurve(fitPoints, degree, 'Uniform')
      const params = computeParameterValues(fitPoints, 'Uniform')

      params.forEach((u, index) => {
        const point = evaluateNurbsPoint(
          u,
          degree,
          result.knots,
          result.controlPoints,
          result.weights
        )
        expect(point[0]).toBeCloseTo(fitPoints[index][0], 6)
        expect(point[1]).toBeCloseTo(fitPoints[index][1], 6)
        expect(point[2]).toBeCloseTo(fitPoints[index][2], 6)
      })
    })

    it('should respect start and end tangents', () => {
      const fitPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0]
      ]
      const degree = 3
      const startTangent = [1, 0, 0]
      const endTangent = [1, 0, 0]

      const result = interpolateNurbsCurve(
        fitPoints,
        degree,
        'Uniform',
        startTangent,
        endTangent
      )
      const n = result.controlPoints.length - 1
      const startDenom = result.knots[degree + 1] - result.knots[0]
      const endDenom = result.knots[n + degree + 1] - result.knots[n]

      const startScale = startDenom !== 0 ? degree / startDenom : 0
      const endScale = endDenom !== 0 ? degree / endDenom : 0

      const startDerivative = [
        startScale * (result.controlPoints[1][0] - result.controlPoints[0][0]),
        startScale * (result.controlPoints[1][1] - result.controlPoints[0][1]),
        startScale * (result.controlPoints[1][2] - result.controlPoints[0][2])
      ]

      const endDerivative = [
        endScale *
          (result.controlPoints[n][0] - result.controlPoints[n - 1][0]),
        endScale *
          (result.controlPoints[n][1] - result.controlPoints[n - 1][1]),
        endScale * (result.controlPoints[n][2] - result.controlPoints[n - 1][2])
      ]

      expect(startDerivative[0]).toBeCloseTo(startTangent[0], 6)
      expect(startDerivative[1]).toBeCloseTo(startTangent[1], 6)
      expect(startDerivative[2]).toBeCloseTo(startTangent[2], 6)
      expect(endDerivative[0]).toBeCloseTo(endTangent[0], 6)
      expect(endDerivative[1]).toBeCloseTo(endTangent[1], 6)
      expect(endDerivative[2]).toBeCloseTo(endTangent[2], 6)
    })
  })

  describe('Edge Cases', () => {
    it('should handle very small knot differences', () => {
      const knots = [0, 0, 0, 0, 1e-10, 1, 1, 1]
      const result = basisFunction(0, 1, 0, knots)
      expect(result).toBe(0)
    })

    it('should handle zero weights', () => {
      const degree = 3
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const controlPoints = [
        [0, 0, 0],
        [1, 1, 0],
        [2, 0, 0],
        [3, 1, 0]
      ]
      const weights = [0, 0, 0, 0]

      const point = evaluateNurbsPoint(
        0.5,
        degree,
        knots,
        controlPoints,
        weights
      )

      expect(point).toEqual([0, 0, 0])
    })

    it('should handle zero weights at custom end parameter', () => {
      const degree = 1
      const knots = [0, 0, 1, 1, 0.5, 0.5]
      const controlPoints = [
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0]
      ]
      const weights = [0, 0, 0]

      const point = evaluateNurbsPoint(
        0.5,
        degree,
        knots,
        controlPoints,
        weights
      )

      expect(point).toEqual([3, 0, 0])
    })

    it('should handle single control point', () => {
      const degree = 3
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const controlPoints = [[1, 2, 3]]
      const weights = [1]

      const point = evaluateNurbsPoint(
        0.5,
        degree,
        knots,
        controlPoints,
        weights
      )

      expect(point).toEqual([1, 2, 3])
    })
  })
})

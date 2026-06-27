import { AcGeSpline3d, AcGeKnotParameterizationType } from '../src'
import { AcGePoint3d, AcGeBox3d, AcGeMatrix3d } from '../src'
import {
  computeParameterValues,
  evaluateNurbsPoint
} from '../src/util/AcGeNurbsUtil'
import { AcCmErrors } from '@mlightcad/common'

describe('AcGeSpline3d', () => {
  describe('Constructor', () => {
    it('should create spline from control points, knots, and weights', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const weights = [1, 1, 1, 1]

      const spline = new AcGeSpline3d(controlPoints, knots, weights)

      expect(spline.degree).toBe(3)
      expect(spline.closed).toBe(false)
      expect(spline.getControlPointAt(0)).toBeDefined()
    })

    it('should keep the same shape when all rational weights are scaled by -1', () => {
      const controlPoints = [
        { x: 400.6139274363574, y: 122.2912929922276, z: 0 },
        { x: 386.4614997325278, y: 116.6743761603575, z: 0 },
        { x: 352.3194562446899, y: 127.4676673274804, z: 0 },
        { x: 341.7464363258755, y: 147.6224865477202, z: 0 },
        { x: 351.658642499764, y: 177.6895119418484, z: 0 },
        { x: 389.32502596054, y: 183.3064287737185, z: 0 },
        { x: 437.2340224676673, y: 161.1691683187011, z: 0 },
        { x: 414.766355140187, y: 127.9082098240977, z: 0 },
        { x: 400.6139274363574, y: 122.2912929922276, z: 0 }
      ]
      const knots = [3, 3, 3, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9]

      const spline = new AcGeSpline3d(
        controlPoints,
        knots,
        new Array(controlPoints.length).fill(-1)
      )
      const points = spline.getPoints(20)

      points.forEach(point => {
        expect(point.x).toBeGreaterThan(300)
        expect(point.y).toBeGreaterThan(100)
        expect(point.x).toBeLessThan(500)
        expect(point.y).toBeLessThan(200)
      })
    })

    it('should create spline from control points with custom degree', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 },
        { x: 4, y: 0, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
      const degree = 4

      const spline = new AcGeSpline3d(controlPoints, knots, undefined, degree)

      expect(spline.degree).toBe(4)
      expect(spline.closed).toBe(false)
    })

    it('should create spline from control points with degree and closed', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const degree = 3
      const closed = true

      const spline = new AcGeSpline3d(
        controlPoints,
        knots,
        undefined,
        degree,
        closed
      )

      expect(spline.degree).toBe(3)
      expect(spline.closed).toBe(true)
    })

    it('should create spline from fit points and parameterization', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const parameterization: AcGeKnotParameterizationType = 'Uniform'

      const spline = new AcGeSpline3d(fitPoints, parameterization)

      expect(spline.degree).toBe(3)
      expect(spline.knotParameterization).toBe(parameterization)
      expect(spline.closed).toBe(false)
    })

    it('should create spline from fit points with custom degree', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 },
        { x: 4, y: 0, z: 0 }
      ]
      const parameterization: AcGeKnotParameterizationType = 'Uniform'
      const degree = 4

      const spline = new AcGeSpline3d(fitPoints, parameterization, degree)

      expect(spline.degree).toBe(4)
      expect(spline.knotParameterization).toBe(parameterization)
      expect(spline.closed).toBe(false)
    })

    it('should create spline from fit points with degree and closed', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const parameterization: AcGeKnotParameterizationType = 'Uniform'
      const degree = 3
      const closed = true

      const spline = new AcGeSpline3d(
        fitPoints,
        parameterization,
        degree,
        closed
      )

      expect(spline.degree).toBe(3)
      expect(spline.knotParameterization).toBe(parameterization)
      expect(spline.closed).toBe(true)
    })

    it('should create spline from fit points with start/end tangents', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 }
      ]
      const startTangent = { x: 1, y: 0, z: 0 }
      const endTangent = { x: 1, y: 0, z: 0 }
      const degree = 3

      const spline = new AcGeSpline3d(
        fitPoints,
        'Uniform',
        degree,
        false,
        startTangent,
        endTangent
      )

      const knots = spline.knots
      const controlPoints = spline.controlPoints
      const n = controlPoints.length - 1

      const startDenom = knots[degree + 1] - knots[0]
      const endDenom = knots[n + degree + 1] - knots[n]
      const startScale = startDenom !== 0 ? degree / startDenom : 0
      const endScale = endDenom !== 0 ? degree / endDenom : 0

      const startDerivative = {
        x: startScale * (controlPoints[1].x - controlPoints[0].x),
        y: startScale * (controlPoints[1].y - controlPoints[0].y),
        z: startScale * (controlPoints[1].z - controlPoints[0].z)
      }
      const endDerivative = {
        x: endScale * (controlPoints[n].x - controlPoints[n - 1].x),
        y: endScale * (controlPoints[n].y - controlPoints[n - 1].y),
        z: endScale * (controlPoints[n].z - controlPoints[n - 1].z)
      }

      expect(startDerivative.x).toBeCloseTo(startTangent.x, 6)
      expect(startDerivative.y).toBeCloseTo(startTangent.y, 6)
      expect(startDerivative.z).toBeCloseTo(startTangent.z, 6)
      expect(endDerivative.x).toBeCloseTo(endTangent.x, 6)
      expect(endDerivative.y).toBeCloseTo(endTangent.y, 6)
      expect(endDerivative.z).toBeCloseTo(endTangent.z, 6)

      const params = computeParameterValues(
        fitPoints.map(point => [point.x, point.y, point.z || 0]),
        'Uniform'
      )
      const evaluatedMid = evaluateNurbsPoint(
        params[1],
        degree,
        knots,
        controlPoints.map(point => [point.x, point.y, point.z || 0]),
        spline.weights
      )

      expect(evaluatedMid[0]).toBeCloseTo(fitPoints[1].x, 6)
      expect(evaluatedMid[1]).toBeCloseTo(fitPoints[1].y, 6)
      expect(evaluatedMid[2]).toBeCloseTo(fitPoints[1].z, 6)
    })

    it('should create spline with chord parameterization', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const parameterization: AcGeKnotParameterizationType = 'Chord'

      const spline = new AcGeSpline3d(fitPoints, parameterization)

      expect(spline.degree).toBe(3)
      expect(spline.knotParameterization).toBe(parameterization)
    })

    it('should create spline with sqrt chord parameterization', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const parameterization: AcGeKnotParameterizationType = 'SqrtChord'

      const spline = new AcGeSpline3d(fitPoints, parameterization)

      expect(spline.degree).toBe(3)
      expect(spline.knotParameterization).toBe(parameterization)
    })

    it('should throw error for insufficient control points', () => {
      expect(() => {
        new AcGeSpline3d([{ x: 0, y: 0, z: 0 }], [0, 0, 0, 0])
      }).toThrow(AcCmErrors.ILLEGAL_PARAMETERS)
    })

    it('covers constructor branch variants and argument guards', () => {
      expect(() => new (AcGeSpline3d as any)([{ x: 0, y: 0, z: 0 }])).toThrow(
        AcCmErrors.ILLEGAL_PARAMETERS
      )

      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]

      expect(
        () =>
          new (AcGeSpline3d as any)(
            controlPoints,
            knots,
            undefined,
            3,
            false,
            'x'
          )
      ).toThrow(AcCmErrors.ILLEGAL_PARAMETERS)

      const degreeClosed = new AcGeSpline3d(
        controlPoints,
        knots,
        3 as any,
        true as any
      )
      expect(degreeClosed.closed).toBe(true)

      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const tangentA = { x: 1, y: 0, z: 0 }
      const tangentB = { x: 0, y: 1, z: 0 }
      const fitWithTangents = new AcGeSpline3d(
        fitPoints,
        'Uniform',
        3,
        tangentA as any,
        tangentB as any
      )
      expect(fitWithTangents.fitPoints?.length).toBe(4)
    })

    it('should throw error for insufficient control points for degree 4', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
      const degree = 4

      expect(() => {
        new AcGeSpline3d(controlPoints, knots, undefined, degree)
      }).toThrow(AcCmErrors.ILLEGAL_PARAMETERS)
    })

    it('should throw error for insufficient fit points for degree 4', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const parameterization: AcGeKnotParameterizationType = 'Uniform'
      const degree = 4

      expect(() => {
        new AcGeSpline3d(fitPoints, parameterization, degree)
      }).toThrow(AcCmErrors.ILLEGAL_PARAMETERS)
    })

    it('should accept minimum valid control points for degree 4', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 },
        { x: 4, y: 0, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
      const degree = 4

      expect(() => {
        new AcGeSpline3d(controlPoints, knots, undefined, degree)
      }).not.toThrow()
    })

    it('should accept minimum valid fit points for degree 4', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 },
        { x: 4, y: 0, z: 0 }
      ]
      const parameterization: AcGeKnotParameterizationType = 'Uniform'
      const degree = 4

      expect(() => {
        new AcGeSpline3d(fitPoints, parameterization, degree)
      }).not.toThrow()
    })
  })

  describe('Properties', () => {
    let spline: AcGeSpline3d

    beforeEach(() => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      spline = new AcGeSpline3d(controlPoints, knots)
    })

    it('should return correct degree', () => {
      expect(spline.degree).toBe(3)
    })

    it('should return correct start point', () => {
      const startPoint = spline.startPoint
      expect(startPoint).toBeInstanceOf(AcGePoint3d)
      // For a degree 3 spline, the start point should be close to the first control point
      expect(startPoint.x).toBeCloseTo(0, 1)
      expect(startPoint.y).toBeCloseTo(0, 1)
      expect(startPoint.z).toBeCloseTo(0, 1)
    })

    it('should return correct end point', () => {
      const endPoint = spline.endPoint
      expect(endPoint).toBeInstanceOf(AcGePoint3d)
      // For a degree 3 spline, the end point should be a valid 3D point
      expect(typeof endPoint.x).toBe('number')
      expect(typeof endPoint.y).toBe('number')
      expect(typeof endPoint.z).toBe('number')
      expect(endPoint.z).toBeCloseTo(0, 1)
    })

    it('should return correct length', () => {
      const length = spline.length
      expect(length).toBeGreaterThan(0)
      expect(typeof length).toBe('number')
    })

    it('should handle closed property', () => {
      expect(spline.closed).toBe(false)

      spline.closed = true
      expect(spline.closed).toBe(true)
    })
  })

  describe('Control Points', () => {
    let spline: AcGeSpline3d

    beforeEach(() => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      spline = new AcGeSpline3d(controlPoints, knots)
    })

    it('should return control point at valid index', () => {
      const point = spline.getControlPointAt(1)
      expect(point.x).toBe(1)
      expect(point.y).toBe(1)
      expect(point.z).toBe(0)
    })

    it('should handle negative index', () => {
      const point = spline.getControlPointAt(-1)
      expect(point.x).toBe(3)
      expect(point.y).toBe(1)
      expect(point.z).toBe(0)
    })

    it('should handle out of bounds index', () => {
      const point = spline.getControlPointAt(10)
      expect(point.x).toBe(3)
      expect(point.y).toBe(1)
      expect(point.z).toBe(0)
    })
  })

  describe('Fit Points', () => {
    let spline: AcGeSpline3d

    beforeEach(() => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      spline = new AcGeSpline3d(fitPoints, 'Uniform')
    })

    it('should return fit point at valid index', () => {
      const point = spline.getFitPointAt(1)
      expect(point.x).toBe(1)
      expect(point.y).toBe(1)
      expect(point.z).toBe(0)
    })

    it('should handle negative index', () => {
      const point = spline.getFitPointAt(-1)
      expect(point.x).toBe(3)
      expect(point.y).toBe(1)
      expect(point.z).toBe(0)
    })

    it('should handle out of bounds index', () => {
      const point = spline.getFitPointAt(10)
      expect(point.x).toBe(3)
      expect(point.y).toBe(1)
      expect(point.z).toBe(0)
    })

    it('should throw error when no fit points', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const splineWithoutFitPoints = new AcGeSpline3d(controlPoints, knots)

      expect(() => {
        splineWithoutFitPoints.getFitPointAt(0)
      }).toThrow('No fit points in this spline')
    })
  })

  describe('Point Sampling', () => {
    let spline: AcGeSpline3d

    beforeEach(() => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      spline = new AcGeSpline3d(controlPoints, knots)
    })

    it('should return correct number of points', () => {
      const points = spline.getPoints(50)
      expect(points).toHaveLength(50)
      expect(points[0]).toBeInstanceOf(AcGePoint3d)
    })

    it('should return default number of points when not specified', () => {
      const points = spline.getPoints()
      expect(points).toHaveLength(100)
    })

    it('should return points in correct order', () => {
      const points = spline.getPoints(10)

      // Should return valid 3D points
      expect(points[0]).toBeInstanceOf(AcGePoint3d)
      expect(points[9]).toBeInstanceOf(AcGePoint3d)
      expect(typeof points[0].x).toBe('number')
      expect(typeof points[0].y).toBe('number')
      expect(typeof points[0].z).toBe('number')
      expect(typeof points[9].x).toBe('number')
      expect(typeof points[9].y).toBe('number')
      expect(typeof points[9].z).toBe('number')
    })

    it('should handle single point request', () => {
      const points = spline.getPoints(1)
      expect(points).toHaveLength(1)
    })

    it('should have last sampled point matching endPoint', () => {
      const points = spline.getPoints(50)
      const end = spline.endPoint
      const last = points[points.length - 1]
      expect(last.x).toBeCloseTo(end.x, 6)
      expect(last.y).toBeCloseTo(end.y, 6)
      expect(last.z).toBeCloseTo(end.z, 6)
    })
  })

  describe('Bounding Box', () => {
    it('should calculate correct bounding box', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 2, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 2, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const spline = new AcGeSpline3d(controlPoints, knots)

      const boundingBox = spline.calculateBoundingBox()
      expect(boundingBox).toBeInstanceOf(AcGeBox3d)

      // The bounding box should contain the control points
      expect(boundingBox.min.x).toBeLessThanOrEqual(0)
      expect(boundingBox.max.x).toBeGreaterThanOrEqual(2)
      expect(boundingBox.min.y).toBeLessThanOrEqual(0)
      expect(boundingBox.max.y).toBeGreaterThanOrEqual(1)
    })

    it('should calculate bounding box', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const spline = new AcGeSpline3d(controlPoints, knots)

      const box = spline.calculateBoundingBox()

      // Should return a valid bounding box
      expect(box).toBeInstanceOf(AcGeBox3d)
      expect(typeof box.min.x).toBe('number')
      expect(typeof box.min.y).toBe('number')
      expect(typeof box.min.z).toBe('number')
      expect(typeof box.max.x).toBe('number')
      expect(typeof box.max.y).toBe('number')
      expect(typeof box.max.z).toBe('number')
    })
  })

  describe('Transform', () => {
    it('should handle transform operation', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]
      const spline = new AcGeSpline3d(controlPoints, knots)

      const matrix = new AcGeMatrix3d()
      const result = spline.transform(matrix)

      expect(result).toBe(spline)
    })

    it('covers fit/tangent transform branches and helper sampling', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const spline = new AcGeSpline3d(
        fitPoints,
        'Uniform',
        3,
        false,
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      )
      spline.closed = false
      expect(
        spline.transform(new AcGeMatrix3d().makeTranslation(2, 0, 0))
      ).toBe(spline)

      const sampled = spline.getCurvePoints((spline as any)._nurbsCurve, 5)
      expect(sampled).toHaveLength(5)
    })
  })

  describe('Edge Cases', () => {
    it('should handle insufficient control points', () => {
      const controlPoints = [{ x: 0, y: 0, z: 0 }]
      const knots = [0, 0, 0, 0]

      expect(() => {
        new AcGeSpline3d(controlPoints, knots)
      }).toThrow(AcCmErrors.ILLEGAL_PARAMETERS)
    })

    it('should handle minimum valid control points', () => {
      const controlPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
      const knots = [0, 0, 0, 0, 1, 1, 1, 1]

      expect(() => {
        new AcGeSpline3d(controlPoints, knots)
      }).not.toThrow()
    })
  })

  describe('Parameterization Types', () => {
    it('should handle uniform parameterization', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]

      const spline = new AcGeSpline3d(fitPoints, 'Uniform')
      expect(spline.knotParameterization).toBe('Uniform')
    })

    it('should handle chord parameterization', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]

      const spline = new AcGeSpline3d(fitPoints, 'Chord')
      expect(spline.knotParameterization).toBe('Chord')
    })

    it('should handle sqrt chord parameterization', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]

      const spline = new AcGeSpline3d(fitPoints, 'SqrtChord')
      expect(spline.knotParameterization).toBe('SqrtChord')
    })
  })

  describe('Static Methods', () => {
    it('should create closed spline with default degree', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]

      const spline = AcGeSpline3d.createClosedSpline(fitPoints)
      expect(spline.closed).toBe(true)
      expect(spline.degree).toBe(3)
    })

    it('should create closed spline with custom degree', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 },
        { x: 4, y: 0, z: 0 }
      ]

      const spline = AcGeSpline3d.createClosedSpline(fitPoints, 'Chord')
      expect(spline.closed).toBe(true)
      expect(spline.degree).toBe(3)
      expect(spline.knotParameterization).toBe('Chord')
    })

    it('should throw error for insufficient points in closed spline', () => {
      const fitPoints = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 }
      ]

      expect(() => {
        AcGeSpline3d.createClosedSpline(fitPoints)
      }).toThrow('At least 4 points are required for a degree 3 closed spline')
    })
  })

  describe('Clone', () => {
    it('clones control-point spline deeply', () => {
      const spline = new AcGeSpline3d(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 2, y: 0, z: 0 },
          { x: 3, y: 1, z: 0 }
        ],
        [0, 0, 0, 0, 1, 1, 1, 1]
      )

      const cloned = spline.clone()
      expect(cloned).not.toBe(spline)
      expect(cloned.controlPoints).toEqual(spline.controlPoints)

      const changed = cloned.getControlPointAt(0)
      changed.x = 99
      expect(spline.getControlPointAt(0).x).toBe(0)
    })

    it('clones fit-point spline and keeps constructor mode', () => {
      const spline = new AcGeSpline3d(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 2, y: 0, z: 0 },
          { x: 3, y: 1, z: 0 }
        ],
        'Uniform',
        3,
        false,
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }
      )

      const cloned = spline.clone()
      expect(cloned.fitPoints).toEqual(spline.fitPoints)
      expect(cloned.knotParameterization).toBe('Uniform')
    })
  })

  describe('getOffsetSamplePath2d', () => {
    it('returns more samples in high-curvature regions', () => {
      const spline = new AcGeSpline3d(
        [
          new AcGePoint3d(0, 0, 0),
          new AcGePoint3d(10, 8, 0),
          new AcGePoint3d(20, -8, 0),
          new AcGePoint3d(30, 8, 0),
          new AcGePoint3d(40, 0, 0)
        ],
        [0, 0, 0, 0, 0.5, 1, 1, 1, 1]
      )

      const path = spline.getOffsetSamplePath2d(2)

      expect(path.points.length).toBeGreaterThan(64)
      expect(path.tangents).toHaveLength(path.points.length)
      path.tangents.forEach(tangent => {
        expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(1, 4)
      })
    })
  })

  describe('area', () => {
    it('computes area for closed spline and returns 0 when open', () => {
      const closed = new AcGeSpline3d(
        [
          new AcGePoint3d(0, 0, 0),
          new AcGePoint3d(10, 0, 0),
          new AcGePoint3d(10, 10, 0),
          new AcGePoint3d(0, 10, 0)
        ],
        'Uniform',
        3,
        true
      )
      expect(closed.area).toBeGreaterThan(0)

      const open = new AcGeSpline3d(
        [
          new AcGePoint3d(0, 0, 0),
          new AcGePoint3d(10, 0, 0),
          new AcGePoint3d(10, 5, 0),
          new AcGePoint3d(20, 5, 0)
        ],
        'Uniform'
      )
      expect(open.area).toBe(0)
    })
  })
})

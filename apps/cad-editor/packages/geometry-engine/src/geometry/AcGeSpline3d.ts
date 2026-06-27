import { AcCmErrors } from '@mlightcad/common'

import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePointLike,
  AcGeVector3dLike
} from '../math'
import { AcGeGeometryUtil } from '../util/AcGeGeometryUtil'
import { acGeClosedPolygonArea3d } from '../util/AcGePolygonAreaUtil'
import { AcGeCurve3d } from './AcGeCurve3d'
import { AcGeKnotParameterizationType, AcGeNurbsCurve } from './AcGeNurbsCurve'
import {
  isNonZeroDirection,
  normalizeSplineWeights,
  resolveControlPointSplineDegree,
  resolveFitPointSplineDegree
} from './AcGeSplineUtil'

export class AcGeSpline3d extends AcGeCurve3d {
  private _nurbsCurve: AcGeNurbsCurve
  private _fitPoints?: AcGePoint3dLike[]
  private _knotParameterization?: AcGeKnotParameterizationType
  private _controlPoints: AcGePoint3dLike[]
  private _closed: boolean
  private _degree: number
  private _startTangent?: AcGePointLike
  private _endTangent?: AcGePointLike

  constructor(
    controlPoints: AcGePoint3dLike[],
    knots: number[],
    weights?: number[],
    degree?: number,
    closed?: boolean
  )
  constructor(
    fitPoints: AcGePointLike[],
    knotParam: AcGeKnotParameterizationType,
    degree?: number,
    closed?: boolean,
    startTangent?: AcGePointLike,
    endTangent?: AcGePointLike
  )
  constructor(
    a?: unknown,
    b?: unknown,
    c?: unknown,
    d?: unknown,
    e?: unknown,
    f?: unknown
  ) {
    super()
    // Count the number of arguments passed (including undefined)
    const argsLength = arguments.length

    // Default degree is 3
    this._degree = 3
    this._closed = false

    if (!Array.isArray(b)) {
      if (argsLength < 2 || argsLength > 6) {
        throw AcCmErrors.ILLEGAL_PARAMETERS
      }

      // Constructor with fit points
      this._fitPoints = a as AcGePoint3dLike[]
      this._knotParameterization = b as AcGeKnotParameterizationType

      // Handle degree and closed parameters for fit points constructor
      if (argsLength >= 3) {
        this._degree = (c as number) || 3
      }
      const hasClosedArg = typeof d === 'boolean'
      if (argsLength >= 4 && hasClosedArg) {
        this._closed = d as boolean
      }

      if (hasClosedArg) {
        if (argsLength >= 5) {
          this._startTangent = e as AcGePointLike
        }
        if (argsLength >= 6) {
          this._endTangent = f as AcGePointLike
        }
      } else {
        if (argsLength >= 4) {
          this._startTangent = d as AcGePointLike
        }
        if (argsLength >= 5) {
          this._endTangent = e as AcGePointLike
        }
      }

      if (this._closed) {
        this._startTangent = undefined
        this._endTangent = undefined
      }

      // Validate minimum number of fit points for the specified degree
      const tangentCount =
        (this._startTangent ? 1 : 0) + (this._endTangent ? 1 : 0)
      if (this._fitPoints.length + tangentCount < this._degree + 1) {
        throw AcCmErrors.ILLEGAL_PARAMETERS
      }

      if (this._closed) {
        this._nurbsCurve = AcGeNurbsCurve.createClosedCurve(
          this._fitPoints,
          this._degree,
          this._knotParameterization
        )
      } else {
        const points = this.toNurbsPoints(this._fitPoints)
        this._nurbsCurve = AcGeNurbsCurve.byPoints(
          points,
          this._degree,
          this._knotParameterization,
          this._startTangent
            ? this.toNurbsPoint(this._startTangent)
            : undefined,
          this._endTangent ? this.toNurbsPoint(this._endTangent) : undefined
        )
      }
      this._controlPoints = this.toGePoints(
        this._nurbsCurve.controlPoints().map(p => [p.x, p.y, p.z || 0])
      )
    } else {
      if (argsLength < 2 || argsLength > 5) {
        throw AcCmErrors.ILLEGAL_PARAMETERS
      }

      // Constructor with control points
      this._controlPoints = a as AcGePoint3dLike[]

      // Determine if c is weights or degree based on type
      let weights: number[] | undefined
      let degree: number = 3
      let closed: boolean = false

      if (argsLength >= 3) {
        if (Array.isArray(c)) {
          // c is weights array
          weights = c as number[]
          if (argsLength >= 4) {
            degree = (d as number) || 3
          }
          if (argsLength >= 5) {
            closed = e as boolean
          }
        } else if (c !== undefined) {
          // c is degree (not undefined)
          degree = (c as number) || 3
          if (argsLength >= 4) {
            closed = d as boolean
          }
        }
      }

      // Handle case where c is undefined but d might be degree
      if (c === undefined && argsLength >= 4) {
        degree = (d as number) || 3
        if (argsLength >= 5) {
          closed = e as boolean
        }
      }

      this._degree = degree
      this._closed = closed

      // Validate minimum number of control points for the specified degree
      if (this._controlPoints.length < this._degree + 1) {
        throw AcCmErrors.ILLEGAL_PARAMETERS
      }

      this._nurbsCurve = AcGeNurbsCurve.byKnotsControlPointsWeights(
        this._degree,
        b as number[],
        this._controlPoints,
        weights
      )
    }

    // Apply closed state if specified
    // if (this._closed) {
    //   this.buildCurve()
    // }
  }

  /**
   * Build the NURBS curve using stored data
   */
  private buildCurve() {
    if (this._fitPoints && this._knotParameterization) {
      // Build from fit points
      if (this._closed) {
        const newFitPoints = AcGeNurbsCurve.createFitPointsForClosedCurve(
          this._fitPoints
        )
        const points = this.toNurbsPoints(newFitPoints)
        this._nurbsCurve = AcGeNurbsCurve.byPoints(
          points,
          this._degree,
          this._knotParameterization
        )
      } else {
        // Create open curve from fit points
        const points = this.toNurbsPoints(this._fitPoints)
        this._nurbsCurve = AcGeNurbsCurve.byPoints(
          points,
          this._degree,
          this._knotParameterization,
          this._startTangent
            ? this.toNurbsPoint(this._startTangent)
            : undefined,
          this._endTangent ? this.toNurbsPoint(this._endTangent) : undefined
        )
      }
      this._controlPoints = this.toGePoints(
        this._nurbsCurve.controlPoints().map(p => [p.x, p.y, p.z || 0])
      )
    } else if (this._controlPoints) {
      // Build from control points
      if (this._closed) {
        // Create closed curve from control points
        const newFitPoints = AcGeNurbsCurve.createFitPointsForClosedCurve(
          this._controlPoints
        )
        const points = this.toNurbsPoints(newFitPoints)
        this._nurbsCurve = AcGeNurbsCurve.byPoints(
          points,
          this._degree,
          this._knotParameterization
        )
        this._controlPoints = this.toGePoints(
          this._nurbsCurve.controlPoints().map(p => [p.x, p.y, p.z || 0])
        )
      } else {
        // Create open curve from control points
        // Get knots and weights from the current NURBS curve
        const knots = this._nurbsCurve.knots()
        const weights = this._nurbsCurve.weights()
        this._nurbsCurve = AcGeNurbsCurve.byKnotsControlPointsWeights(
          this._degree,
          knots,
          this._controlPoints,
          weights
        )
      }
    }
  }

  /**
   * Set the closed property and rebuild the curve if necessary
   */
  private setClosed(closed: boolean) {
    if (this._closed === closed) {
      return
    }

    this._closed = closed
    this._boundingBoxNeedsUpdate = true
    this.buildCurve()
  }

  /**
   * Degree of the spline to be created.
   */
  get degree() {
    return this._degree
  }

  get knotParameterization() {
    return this._knotParameterization
  }

  get controlPoints() {
    return this._controlPoints.map(AcGeGeometryUtil.point2dToPoint3d)
  }

  get fitPoints() {
    return this._fitPoints?.map(AcGeGeometryUtil.point2dToPoint3d)
  }

  get knots() {
    return [...this._nurbsCurve.knots()]
  }

  get weights() {
    return [...this._nurbsCurve.weights()]
  }

  /**
   * The start point of this spline
   */
  get startPoint(): AcGePoint3d {
    const knots = this._nurbsCurve.knots()
    const degree = this._nurbsCurve.degree()
    const startParam = knots[degree]
    const startPoint = this._nurbsCurve.point(startParam)
    return new AcGePoint3d(startPoint[0], startPoint[1], startPoint[2])
  }

  /**
   * The end point of this spline
   */
  get endPoint(): AcGePoint3d {
    const knots = this._nurbsCurve.knots()
    const degree = this._nurbsCurve.degree()
    const endParam = knots[knots.length - degree - 1]
    const endPoint = this._nurbsCurve.point(endParam)
    return new AcGePoint3d(endPoint[0], endPoint[1], endPoint[2])
  }

  /**
   * @inheritdoc
   */
  get length() {
    return this._nurbsCurve.length()
  }

  /**
   * Returns the nearest point on this spline to the given point.
   *
   * @param point - Query point in WCS.
   * @param samples - Number of interior samples used by the underlying NURBS curve.
   */
  nearestPoint(point: AcGePoint3dLike, samples = 64): AcGePoint3d {
    const nearest = this._nurbsCurve.nearestPoint(point, samples)
    return new AcGePoint3d(nearest.x, nearest.y, nearest.z || 0)
  }

  /**
   * Evaluates this spline at the given parameter value.
   *
   * @param t - Parameter along the knot vector.
   */
  evaluateAt(t: number): AcGePoint3d {
    const point = this._nurbsCurve.point(t)
    return new AcGePoint3d(point[0]!, point[1]!, point[2]!)
  }

  /**
   * Return the value of the control point at position index in the list of control points.
   * If index is negative or more than the number of control points in the spline, then point
   * is set to the last control point.
   * @param index Input index (0 based) of point to get
   * @returns
   */
  getFitPointAt(index: number): AcGePoint3dLike {
    if (!this._fitPoints) {
      throw new Error('No fit points in this spline')
    }
    const length = this._fitPoints.length
    const newIndex = index < 0 || index >= length ? length - 1 : index
    const point = this._fitPoints[newIndex]
    return AcGeGeometryUtil.point2dToPoint3d(point)
  }

  /**
   * Return the value of the control point at position index in the list of control points.
   * If index is negative or more than the number of control points in the spline, then point
   * is set to the last control point.
   * @param index Input index (0 based) of point to get
   * @returns
   */
  getControlPointAt(index: number) {
    const length = this._controlPoints.length
    const newIndex = index < 0 || index >= length ? length - 1 : index
    return this._controlPoints[newIndex]
  }

  /**
   * Whether this spline is still driven by fit-point metadata.
   */
  get isFitPointSpline(): boolean {
    return !!(
      this._fitPoints &&
      this._fitPoints.length > 0 &&
      this._knotParameterization
    )
  }

  /**
   * Whether this spline is driven by explicit control-point metadata.
   */
  get isControlPointSpline(): boolean {
    return !this.isFitPointSpline
  }

  /**
   * Returns grip points for editing: fit points for fit splines, CVs otherwise.
   */
  getGripPoints(): AcGePoint3d[] {
    if (this.isFitPointSpline) {
      return this._fitPoints!.map(
        point => new AcGePoint3d(point.x, point.y, point.z ?? 0)
      )
    }

    return this._controlPoints.map(
      point => new AcGePoint3d(point.x, point.y, point.z ?? 0)
    )
  }

  /**
   * Moves grip points by offset and rebuilds the underlying NURBS curve.
   *
   * Fit-point splines move fit points; control-point splines move CVs.
   */
  moveGripPointsAt(indices: readonly number[], offset: AcGeVector3dLike) {
    if (this.isFitPointSpline) {
      this.moveFitPointsAt(indices, offset)
      return this
    }

    this.moveControlPointsAt(indices, offset)
    return this
  }

  /**
   * Applies an offset to the fit points at the given indices and rebuilds the
   * NURBS curve from the updated fit data.
   *
   * @param indices - Grip indices to move; non-integer and negative values are skipped.
   * @param offset - Translation applied in WCS.
   */
  private moveFitPointsAt(
    indices: readonly number[],
    offset: AcGeVector3dLike
  ) {
    if (!this._fitPoints) {
      return
    }

    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0) {
        continue
      }
      const point = this._fitPoints[index]
      if (point) {
        AcGeGeometryUtil.applyOffsetToPoint3d(point, offset)
      }
    }

    this._boundingBoxNeedsUpdate = true
    this.buildCurve()
  }

  /**
   * Applies an offset to the control points at the given indices and rebuilds
   * the underlying NURBS representation.
   *
   * @param indices - Grip indices to move; non-integer and negative values are skipped.
   * @param offset - Translation applied in WCS.
   */
  private moveControlPointsAt(
    indices: readonly number[],
    offset: AcGeVector3dLike
  ) {
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0) {
        continue
      }
      const point = this.getControlPointAt(index)
      if (point) {
        AcGeGeometryUtil.applyOffsetToPoint3d(point, offset)
      }
    }

    this.rebuildAfterControlPointMutation()
  }

  /**
   * Rebuilds the NURBS curve from the current control points while preserving
   * knots and weights.
   *
   * When the spline was fit-point driven, fit-point metadata is cleared so the
   * curve is represented purely by control vertices after the edit.
   */
  private rebuildAfterControlPointMutation() {
    const knots = this._nurbsCurve.knots()
    const weights = this._nurbsCurve.weights()

    if (this.isFitPointSpline) {
      this._fitPoints = undefined
      this._knotParameterization = undefined
      this._startTangent = undefined
      this._endTangent = undefined
    }

    this._nurbsCurve = AcGeNurbsCurve.byKnotsControlPointsWeights(
      this._degree,
      knots,
      this._controlPoints,
      weights.length > 0 ? weights : undefined
    )
    this._boundingBoxNeedsUpdate = true
  }

  /**
   * Samples the spline for planar offset using analytic NURBS tangents and
   * curvature-adaptive parameter refinement.
   */
  getOffsetSamplePath2d(offsetDist: number): {
    points: AcGePoint2d[]
    tangents: AcGePoint2d[]
  } {
    return this._nurbsCurve.getOffsetSamplePath2d(offsetDist)
  }

  /**
   * Divide this spline into the specified nubmer of points
   * those points as an array of points.
   * @param numPoints Input the nubmer of points returned
   * @returns Return an array of point
   */
  getPoints(numPoints: number = 100): AcGePoint3d[] {
    const curve = this._nurbsCurve
    const points: AcGePoint3d[] = []
    // Get the knot vector from the curve
    const knots = curve.knots()

    // The valid parameter range is between knots[degree] and knots[knots.length - degree - 1]
    const degree = this._nurbsCurve.degree()
    const startParam = knots[degree]
    const endParam = knots[knots.length - degree - 1]

    // Adjust step size for correct range
    const step = (endParam - startParam) / (numPoints - 1)
    for (let i = 0; i < numPoints; i++) {
      // For the last point, use endParam exactly to avoid floating-point issues
      const t = i === numPoints - 1 ? endParam : startParam + i * step
      const point = curve.point(t)
      points.push(new AcGePoint3d(point[0], point[1], point[2]))
    }
    return points
  }

  getCurvePoints(curve: AcGeNurbsCurve, count: number) {
    const points = []
    const knots = curve.knots() // Get the knot vector from the curve
    const degree = curve.degree()

    // The valid parameter range is between knots[degree] and knots[knots.length - degree - 1]
    const startParam = knots[degree]
    const endParam = knots[knots.length - degree - 1]

    const step = (endParam - startParam) / (count - 1) // Adjust step size for correct range

    for (let i = 0; i < count; i++) {
      const t = startParam + i * step // Map t to the correct parameter space
      points.push(curve.point(t)) // Sample the curve at the mapped parameter t
    }

    return points
  }

  /**
   * @inheritdoc
   */
  calculateBoundingBox() {
    const points = this.getPoints(100)
    return new AcGeBox3d().setFromPoints(points)
  }

  get closed() {
    return this._closed
  }
  set closed(value: boolean) {
    this.setClosed(value)
  }

  /**
   * The area enclosed by this spline. Open splines return `0`.
   */
  get area(): number {
    if (!this._closed) return 0
    const points = this.getPoints(128)
    return acGeClosedPolygonArea3d(points)
  }

  /**
   * @inheritdoc
   */
  transform(matrix: AcGeMatrix3d) {
    if (this._fitPoints && this._knotParameterization) {
      this._fitPoints = this._fitPoints.map(point =>
        new AcGePoint3d(point).applyMatrix4(matrix)
      )

      if (this._startTangent) {
        this._startTangent = new AcGePoint3d(
          this._startTangent
        ).transformDirection(matrix)
      }
      if (this._endTangent) {
        this._endTangent = new AcGePoint3d(this._endTangent).transformDirection(
          matrix
        )
      }

      this.buildCurve()
    } else {
      const knots = this._nurbsCurve.knots()
      const weights = this._nurbsCurve.weights()

      this._controlPoints = this._controlPoints.map(point =>
        new AcGePoint3d(point).applyMatrix4(matrix)
      )
      this._nurbsCurve = AcGeNurbsCurve.byKnotsControlPointsWeights(
        this._degree,
        knots,
        this._controlPoints,
        weights.length > 0 ? weights : undefined
      )
    }

    this._boundingBoxNeedsUpdate = true
    return this
  }

  /**
   * Return a deep-cloned copy of this spline.
   */
  clone() {
    if (this._fitPoints && this._knotParameterization) {
      return new AcGeSpline3d(
        this._fitPoints.map(AcGeGeometryUtil.point2dToPoint3d),
        this._knotParameterization,
        this._degree,
        this._closed,
        this._startTangent
          ? AcGeGeometryUtil.point2dToPoint3d(this._startTangent)
          : undefined,
        this._endTangent
          ? AcGeGeometryUtil.point2dToPoint3d(this._endTangent)
          : undefined
      )
    }

    return new AcGeSpline3d(
      this._controlPoints.map(AcGeGeometryUtil.point2dToPoint3d),
      this._nurbsCurve.knots(),
      this._nurbsCurve.weights(),
      this._degree,
      this._closed
    )
  }

  /**
   * Convert input points to points in NURBS format
   * @param points Input points to convert
   * @returns Return converted points
   */
  private toNurbsPoints(points: AcGePoint3dLike[]): number[][] {
    const nurbsPoints = new Array(points.length)
    points.forEach((point, index) => {
      nurbsPoints[index] = [point.x, point.y, point.z || 0]
    })
    return nurbsPoints
  }

  /**
   * Convert input points to points in geometry engine format
   * @param points Input points to convert
   * @returns Return converted points
   */
  private toGePoints(points: number[][]): AcGePoint3dLike[] {
    const gePoints = new Array<AcGePoint3dLike>(points.length)
    points.forEach((point, index) => {
      gePoints[index] = { x: point[0], y: point[1], z: point[2] }
    })
    return gePoints
  }

  private toNurbsPoint(point: AcGePointLike): number[] {
    return [point.x, point.y, point.z || 0]
  }

  /**
   * Create a closed spline from fit points using AcGeNurbsCurve.createClosedCurve
   * @param fitPoints - Array of fit points defining the curve
   * @param parameterization - Knot parameterization type for NURBS
   * @param degree - Optional degree of the spline (default: 3)
   * @returns A closed spline
   */
  static createClosedSpline(
    fitPoints: AcGePoint3dLike[],
    parameterization: AcGeKnotParameterizationType = 'Uniform',
    degree: number = 3
  ): AcGeSpline3d {
    if (fitPoints.length < degree + 1) {
      throw new Error(
        `At least ${degree + 1} points are required for a degree ${degree} closed spline`
      )
    }

    // Create spline using the constructor with fit points, degree, and closed=true
    return new AcGeSpline3d(fitPoints, parameterization, degree, true)
  }

  /**
   * Creates a 3D spline geometry from control points, knots, and optional weights.
   *
   * This factory is intended for robust deserialization: it normalizes degree and
   * weights from imperfect source data and returns `null` instead of throwing when
   * the NURBS definition is invalid.
   *
   * @param controlPoints - Control vertices defining the curve shape
   * @param knots - Full knot vector for the spline
   * @param weights - Optional per-control-point weights; ignored when the array length
   *   does not match `controlPoints.length`
   * @param declaredDegree - Degree from the source file; when less than 1, derived from
   *   `knots.length - controlPoints.length - 1`, then clamped to `[1, controlPoints.length - 1]`
   * @param closed - Whether the spline forms a closed loop
   * @returns A spline geometry, or `null` if construction fails
   */
  static fromControlPoints(
    controlPoints: AcGePoint3dLike[],
    knots: number[],
    weights: number[] | undefined,
    declaredDegree: number | undefined,
    closed: boolean
  ): AcGeSpline3d | null {
    if (controlPoints.length < 2 || knots.length < 2) {
      return null
    }

    const degree = resolveControlPointSplineDegree(
      declaredDegree,
      controlPoints.length,
      knots.length
    )
    if (controlPoints.length < degree + 1) {
      return null
    }

    try {
      return new AcGeSpline3d(
        controlPoints,
        knots,
        normalizeSplineWeights(weights, controlPoints.length),
        degree,
        closed
      )
    } catch {
      return null
    }
  }

  /**
   * Creates a 3D spline geometry that interpolates fit points.
   *
   * Knots and control points are generated from the fit data. Non-zero start/end
   * tangents constrain the curve ends; zero-length tangents are ignored. Degree is
   * clamped so that `fitPoints.length + tangentCount >= degree + 1`.
   *
   * @param fitPoints - Points the spline should pass through
   * @param knotParam - Knot parameterization (`'Uniform'`, `'Chord'`, or `'SqrtChord'`)
   * @param declaredDegree - Requested degree from the source file; defaults to 3 when
   *   missing or less than 1, then clamped to fit the available fit/tangent data
   * @param closed - Whether the spline forms a closed loop
   * @param startTangent - Optional start tangent direction; ignored when zero-length
   * @param endTangent - Optional end tangent direction; ignored when zero-length
   * @returns A spline geometry, or `null` if construction fails
   */
  static fromFitPoints(
    fitPoints: AcGePoint3dLike[],
    knotParam: AcGeKnotParameterizationType,
    declaredDegree: number | undefined,
    closed: boolean,
    startTangent?: AcGePoint3dLike | null,
    endTangent?: AcGePoint3dLike | null
  ): AcGeSpline3d | null {
    if (fitPoints.length < 2) {
      return null
    }

    const hasStartTangent = isNonZeroDirection(startTangent)
    const hasEndTangent = isNonZeroDirection(endTangent)
    const tangentCount = (hasStartTangent ? 1 : 0) + (hasEndTangent ? 1 : 0)
    const degree = resolveFitPointSplineDegree(
      declaredDegree,
      fitPoints.length,
      tangentCount
    )

    if (fitPoints.length + tangentCount < degree + 1) {
      return null
    }

    try {
      if (hasStartTangent || hasEndTangent) {
        return new AcGeSpline3d(
          fitPoints,
          knotParam,
          degree,
          closed,
          hasStartTangent ? startTangent! : undefined,
          hasEndTangent ? endTangent! : undefined
        )
      }

      return new AcGeSpline3d(fitPoints, knotParam, degree, closed)
    } catch {
      return null
    }
  }

  /**
   * Creates a 3D spline geometry from parsed DWG/DXF spline-edge data.
   *
   * Used for hatch boundary paths, proxy-graphics edges, and similar structures where
   * spline data is embedded as a lightweight edge record rather than a full SPLINE
   * entity. Control-point data is preferred; fit data is used when control points are
   * absent. Fit-point edges always use `'Uniform'` knot parameterization and are
   * treated as open curves.
   *
   * @param spline - Parsed spline-edge payload from a DWG/DXF reader
   * @param spline.numberOfControlPoints - Count of control points in the edge record
   * @param spline.numberOfKnots - Count of knots in the edge record
   * @param spline.numberOfFitData - Count of fit points in the edge record
   * @param spline.degree - Optional declared degree
   * @param spline.controlPoints - Control vertices, optionally with per-point `weight`
   * @param spline.knots - Knot values for the control-point representation
   * @param spline.fitDatum - Fit points when the edge is defined by fit data
   * @param spline.startTangent - Optional start tangent for fit-data edges
   * @param spline.endTangent - Optional end tangent for fit-data edges
   * @returns A spline geometry, or `null` when neither representation can be built
   */
  static fromDwgSplineEdge(spline: {
    numberOfControlPoints: number
    numberOfKnots: number
    numberOfFitData: number
    degree?: number
    controlPoints: Array<{
      x: number
      y: number
      z?: number
      weight?: number | null
    }>
    knots: number[]
    fitDatum: Array<{ x: number; y: number; z?: number }>
    startTangent?: { x: number; y: number; z?: number } | null
    endTangent?: { x: number; y: number; z?: number } | null
  }): AcGeSpline3d | null {
    if (spline.numberOfControlPoints > 0 && spline.numberOfKnots > 0) {
      const controlPoints = spline.controlPoints.map(
        AcGeGeometryUtil.point2dToPoint3d
      )
      let hasWeights = true
      const weights = spline.controlPoints.map(item => {
        if (item.weight == null) hasWeights = false
        return item.weight || 1
      })
      return AcGeSpline3d.fromControlPoints(
        controlPoints,
        spline.knots,
        hasWeights ? weights : undefined,
        spline.degree,
        false
      )
    }

    if (spline.numberOfFitData > 0) {
      const fitPoints = spline.fitDatum.map(AcGeGeometryUtil.point2dToPoint3d)
      return AcGeSpline3d.fromFitPoints(
        fitPoints,
        'Uniform',
        spline.degree,
        false,
        spline.startTangent
          ? AcGeGeometryUtil.point2dToPoint3d(spline.startTangent)
          : undefined,
        spline.endTangent
          ? AcGeGeometryUtil.point2dToPoint3d(spline.endTangent)
          : undefined
      )
    }

    return null
  }
}
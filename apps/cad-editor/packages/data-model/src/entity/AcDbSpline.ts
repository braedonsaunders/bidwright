import { AcCmErrors } from '@mlightcad/common'
import {
  AcGeKnotParameterizationType,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3dLike,
  AcGeSpline3d,
  AcGeVector3dLike,
  offsetSmoothedSampledPath
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { AcDbPolyline } from './AcDbPolyline'

function resolveSplineKnotParameterization(
  flag: number
): AcGeKnotParameterizationType {
  if (flag & 2048) return 'SqrtChord'
  if (flag & 1024) return 'Chord'
  return 'Uniform'
}

function createAcDbSplineFromGeo(
  geo: AcGeSpline3d,
  closed: boolean
): AcDbSpline | null {
  try {
    return new AcDbSpline(
      geo.controlPoints,
      geo.knots,
      normalizeSplineWeights(geo.weights, geo.controlPoints.length),
      geo.degree,
      closed
    )
  } catch {
    return null
  }
}

function normalizeSplineWeights(
  weights: number[] | undefined,
  controlPointCount: number
): number[] | undefined {
  if (!weights || weights.length !== controlPointCount) {
    return undefined
  }
  return weights
}

/**
 * Represents a spline entity in AutoCAD.
 *
 * A spline is a 3D geometric object defined by control points or fit points.
 * Splines are smooth curves that can be used to create complex curved shapes
 * in drawings. They can be either open or closed curves.
 *
 * @example
 * ```typescript
 * // Create a spline from control points
 * const controlPoints = [
 *   new AcGePoint3d(0, 0, 0),
 *   new AcGePoint3d(5, 5, 0),
 *   new AcGePoint3d(10, 0, 0)
 * ];
 * const knots = [0, 0, 0, 1, 1, 1];
 * const spline = new AcDbSpline(controlPoints, knots);
 *
 * // Create a spline from fit points
 * const fitPoints = [
 *   new AcGePoint3d(0, 0, 0),
 *   new AcGePoint3d(5, 5, 0),
 *   new AcGePoint3d(10, 0, 0)
 * ];
 * const spline2 = new AcDbSpline(fitPoints, AcGeKnotParameterizationType.Uniform);
 * ```
 */
export class AcDbSpline extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = 'Spline'

  override get dxfTypeName() {
    return 'SPLINE'
  }

  /**
   * Creates a spline entity from control points, knots, and optional weights.
   *
   * Unlike the constructor, this factory tolerates imperfect DWG/DXF data: it derives
   * a valid degree when `declaredDegree` is missing or zero, clamps degree to the
   * available control points, and returns `null` instead of throwing when the input
   * cannot produce a valid NURBS curve.
   *
   * @param controlPoints - Control vertices in World Coordinate System (WCS) coordinates
   * @param knots - Full knot vector for the spline
   * @param weights - Optional per-control-point weights; ignored when the array length
   *   does not match `controlPoints.length`
   * @param declaredDegree - Degree from the source file; when less than 1, derived from
   *   `knots.length - controlPoints.length - 1`, then clamped to `[1, controlPoints.length - 1]`
   * @param closed - Whether the spline forms a closed loop
   * @returns A new spline entity, or `null` if construction fails
   *
   * @example
   * ```typescript
   * const spline = AcDbSpline.fromControlPoints(
   *   [
   *     { x: 0, y: 0, z: 0 },
   *     { x: 1, y: 1, z: 0 },
   *     { x: 2, y: 0, z: 0 },
   *     { x: 3, y: 1, z: 0 }
   *   ],
   *   [0, 0, 0, 0, 1, 1, 1, 1],
   *   undefined,
   *   0,
   *   false
   * );
   * ```
   */
  static fromControlPoints(
    controlPoints: AcGePoint3dLike[],
    knots: number[],
    weights: number[] | undefined,
    declaredDegree: number | undefined,
    closed: boolean
  ): AcDbSpline | null {
    const geo = AcGeSpline3d.fromControlPoints(
      controlPoints,
      knots,
      weights,
      declaredDegree,
      closed
    )
    return geo ? createAcDbSplineFromGeo(geo, closed) : null
  }

  /**
   * Creates a spline entity that interpolates fit points.
   *
   * Knots and control points are computed internally from the fit data. Start and end
   * tangents are applied only when they are non-zero direction vectors. Degree is
   * clamped so that `fitPoints.length + tangentCount >= degree + 1`.
   *
   * @param fitPoints - Points the spline should pass through, in WCS coordinates
   * @param knotParam - Knot parameterization (`'Uniform'`, `'Chord'`, or `'SqrtChord'`)
   * @param declaredDegree - Requested degree from the source file; defaults to 3 when
   *   missing or less than 1, then clamped to fit the available fit/tangent data
   * @param closed - Whether the spline forms a closed loop
   * @param startTangent - Optional start tangent direction; ignored when zero-length
   * @param endTangent - Optional end tangent direction; ignored when zero-length
   * @returns A new spline entity, or `null` if construction fails
   *
   * @example
   * ```typescript
   * const spline = AcDbSpline.fromFitPoints(
   *   [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }],
   *   'Uniform',
   *   3,
   *   false,
   *   { x: 1, y: 0, z: 0 },
   *   { x: 1, y: 0, z: 0 }
   * );
   * ```
   */
  static fromFitPoints(
    fitPoints: AcGePoint3dLike[],
    knotParam: AcGeKnotParameterizationType,
    declaredDegree: number | undefined,
    closed: boolean,
    startTangent?: AcGePoint3dLike | null,
    endTangent?: AcGePoint3dLike | null
  ): AcDbSpline | null {
    const geo = AcGeSpline3d.fromFitPoints(
      fitPoints,
      knotParam,
      declaredDegree,
      closed,
      startTangent,
      endTangent
    )
    return geo ? createAcDbSplineFromGeo(geo, closed) : null
  }

  /**
   * Creates a spline entity from parsed DWG/DXF SPLINE fields.
   *
   * This is the preferred entry point for file converters. Control-point data is tried
   * first; when that fails (for example, too few control points for the knot vector),
   * fit-point data is used as a fallback.
   *
   * The `flag` field encodes spline properties from group code 70:
   * - bit 0 (`0x01`): closed spline
   * - bit 1 (`0x02`): periodic
   * - bit 2 (`0x04`): rational (weights are passed separately via `weights`)
   * - bit 10 (`1024`): Chord knot parameterization for fit splines
   * - bit 11 (`2048`): SqrtChord knot parameterization for fit splines
   * - when neither Chord nor SqrtChord is set: Uniform knot parameterization
   *
   * @param spline - Parsed SPLINE entity payload from a DWG/DXF reader
   * @param spline.flag - SPLINE flags (group code 70)
   * @param spline.degree - Declared degree (group code 71)
   * @param spline.numberOfControlPoints - Count of control points (group code 73)
   * @param spline.numberOfKnots - Count of knots (group code 72)
   * @param spline.numberOfFitPoints - Count of fit points (group code 74)
   * @param spline.controlPoints - Control vertices (group codes 10/20/30)
   * @param spline.knots - Knot values (group code 40)
   * @param spline.weights - Optional weights (group code 41)
   * @param spline.fitPoints - Fit points (group codes 11/21/31)
   * @param spline.startTangent - Optional start tangent (group codes 12/22/32)
   * @param spline.endTangent - Optional end tangent (group codes 13/23/33)
   * @returns A new spline entity, or `null` when neither control nor fit data can be used
   */
  static fromDwgSpline(spline: {
    flag: number
    degree?: number
    numberOfControlPoints: number
    numberOfKnots: number
    numberOfFitPoints: number
    controlPoints: AcGePoint3dLike[]
    knots: number[]
    weights?: number[]
    fitPoints: AcGePoint3dLike[]
    startTangent?: AcGePoint3dLike | null
    endTangent?: AcGePoint3dLike | null
  }): AcDbSpline | null {
    const closed = !!(spline.flag & 0x01)
    const knotParam = resolveSplineKnotParameterization(spline.flag)

    if (spline.numberOfControlPoints > 0 && spline.numberOfKnots > 0) {
      const fromControlPoints = AcDbSpline.fromControlPoints(
        spline.controlPoints,
        spline.knots,
        spline.weights,
        spline.degree,
        closed
      )
      if (fromControlPoints) {
        return fromControlPoints
      }
    }

    if (spline.numberOfFitPoints > 0) {
      return AcDbSpline.fromFitPoints(
        spline.fitPoints,
        knotParam,
        spline.degree,
        closed,
        spline.startTangent,
        spline.endTangent
      )
    }

    return null
  }

  /** The underlying geometric spline object */
  private _geo!: AcGeSpline3d

  /**
   * Creates a new spline entity from control points.
   *
   * This constructor creates a spline using the specified control points, knots,
   * and optional weights. The control points must be in World Coordinate System (WCS) coordinates.
   *
   * @param controlPoints - Array of control points in WCS coordinates
   * @param knots - Array of knot values that define the spline's parameterization
   * @param weights - Optional array of weights for each control point (default: 1 for all)
   * @param degree - Optional degree of the spline (default: 3)
   * @param closed - Whether the spline should be closed (default: false)
   *
   * @example
   * ```typescript
   * const controlPoints = [
   *   new AcGePoint3d(0, 0, 0),
   *   new AcGePoint3d(5, 5, 0),
   *   new AcGePoint3d(10, 0, 0)
   * ];
   * const knots = [0, 0, 0, 1, 1, 1];
   * const spline = new AcDbSpline(controlPoints, knots);
   * ```
   */
  constructor(
    controlPoints: AcGePoint3dLike[],
    knots: number[],
    weights?: number[],
    degree?: number,
    closed?: boolean
  )
  /**
   * Creates a new spline entity from fit points.
   *
   * This constructor creates a spline that passes through the specified fit points.
   * The fit points must be in World Coordinate System (WCS) coordinates.
   *
   * @param fitPoints - Array of fit points in WCS coordinates
   * @param knotParam - Knot parameterization type that defines how knots are generated
   * @param degree - Optional degree of the spline (default: 3)
   * @param closed - Whether the spline should be closed (default: false)
   *
   * @example
   * ```typescript
   * const fitPoints = [
   *   new AcGePoint3d(0, 0, 0),
   *   new AcGePoint3d(5, 5, 0),
   *   new AcGePoint3d(10, 0, 0)
   * ];
   * const spline = new AcDbSpline(fitPoints, AcGeKnotParameterizationType.Uniform);
   * ```
   */
  constructor(
    fitPoints: AcGePoint3dLike[],
    knotParam: AcGeKnotParameterizationType,
    degree?: number,
    closed?: boolean
  )
  constructor(a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown) {
    super()
    this.rebuild(
      a as AcGePoint3dLike[],
      b as number[],
      c as number[],
      d as number | undefined,
      e as boolean
    )
  }

  /**
   * Rebuilds the spline geometry with new parameters.
   *
   * This method recreates the underlying geometric spline object with the specified parameters.
   * It supports the same parameter combinations as the constructor.
   *
   * @param controlPoints - Array of control points in WCS coordinates
   * @param knots - Array of knot values that define the spline's parameterization
   * @param weights - Optional array of weights for each control point (default: 1 for all)
   * @param degree - Optional degree of the spline (default: 3)
   * @param closed - Whether the spline should be closed (default: false)
   *
   * @example
   * ```typescript
   * const controlPoints = [
   *   new AcGePoint3d(0, 0, 0),
   *   new AcGePoint3d(5, 5, 0),
   *   new AcGePoint3d(10, 0, 0)
   * ];
   * const knots = [0, 0, 0, 1, 1, 1];
   * spline.rebuild(controlPoints, knots);
   * ```
   */
  rebuild(
    controlPoints: AcGePoint3dLike[],
    knots: number[],
    weights?: number[],
    degree?: number,
    closed?: boolean
  ): void
  /**
   * Rebuilds the spline geometry with new parameters.
   *
   * This method recreates the underlying geometric spline object with the specified parameters.
   * It supports the same parameter combinations as the constructor.
   *
   * @param fitPoints - Array of fit points in WCS coordinates
   * @param knotParam - Knot parameterization type that defines how knots are generated
   * @param degree - Optional degree of the spline (default: 3)
   * @param closed - Whether the spline should be closed (default: false)
   *
   * @example
   * ```typescript
   * const fitPoints = [
   *   new AcGePoint3d(0, 0, 0),
   *   new AcGePoint3d(5, 5, 0),
   *   new AcGePoint3d(10, 0, 0)
   * ];
   * spline.rebuild(fitPoints, AcGeKnotParameterizationType.Uniform);
   * ```
   */
  rebuild(
    fitPoints: AcGePoint3dLike[],
    knotParam: AcGeKnotParameterizationType,
    degree?: number,
    closed?: boolean
  ): void
  rebuild(a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown) {
    const argsLength =
      +(a !== undefined) +
      +(b !== undefined) +
      +(c !== undefined) +
      +(d !== undefined) +
      +(e !== undefined)

    if (argsLength < 2 || argsLength > 5) {
      throw AcCmErrors.ILLEGAL_PARAMETERS
    }

    const isFitPointsConstructor = !Array.isArray(b)

    if (isFitPointsConstructor) {
      this._geo = new AcGeSpline3d(
        a as AcGePoint3dLike[],
        b as AcGeKnotParameterizationType,
        c as number | undefined,
        d as boolean | undefined
      )
    } else {
      this._geo = new AcGeSpline3d(
        a as AcGePoint3dLike[],
        b as number[],
        c as number[] | undefined,
        d as number | undefined,
        e as boolean | undefined
      )
    }
  }

  /**
   * Gets the geometric extents (bounding box) of this spline.
   *
   * @returns The bounding box that encompasses the entire spline
   *
   * @example
   * ```typescript
   * const extents = spline.geometricExtents;
   * console.log(`Spline bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents() {
    return this._geo.box
  }

  /**
   * Gets whether this spline is closed.
   *
   * A closed spline forms a complete loop where the end point connects to the start point.
   *
   * @returns True if the spline is closed, false otherwise
   *
   * @example
   * ```typescript
   * const isClosed = spline.closed;
   * console.log(`Spline is closed: ${isClosed}`);
   * ```
   */
  get closed(): boolean {
    return this._geo.closed
  }

  /** @inheritdoc */
  get area(): number {
    return this._geo.area
  }

  /**
   * Sets whether this spline is closed.
   *
   * @param value - True to close the spline, false to open it
   *
   * @example
   * ```typescript
   * spline.closed = true; // Close the spline
   * ```
   */
  set closed(value: boolean) {
    this._geo.closed = value
  }

  /**
   * Gets the grip points for this spline.
   *
   * Grip points follow the spline definition mode: fit points for fit splines,
   * control vertices for control-point splines.
   *
   * @returns Array of grip points for editing
   */
  subGetGripPoints() {
    return this._geo.getGripPoints()
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    this._geo.moveGripPointsAt(indices, offset)
    return this
  }

  /**
   * Gets the object snap points for this spline.
   *
   * Object snap points are precise points that can be used for positioning
   * when drawing or editing. This method provides snap points based on the
   * specified snap mode.
   *
   * @param osnapMode - The object snap mode
   * @param _pickPoint - The point where the user picked
   * @param _lastPoint - The last point
   * @param snapPoints - Array to populate with snap points
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    switch (osnapMode) {
      case AcDbOsnapMode.EndPoint:
        snapPoints.push(this._geo.startPoint)
        snapPoints.push(this._geo.endPoint)
        break
      case AcDbOsnapMode.Node: {
        const seen = new Set<number>()
        for (const knot of this._geo.knots) {
          if (seen.has(knot)) continue
          seen.add(knot)
          snapPoints.push(this._geo.evaluateAt(knot))
        }
        break
      }
      case AcDbOsnapMode.Nearest:
        snapPoints.push(this._geo.nearestPoint(pickPoint))
        break
      default:
        break
    }
  }

  /**
   * Transforms this spline by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._geo.transform(matrix)
    return this
  }

  /**
   * Draws this spline using the specified renderer.
   *
   * This method renders the spline as a series of connected line segments
   * using the spline's current style properties.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered spline entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const points = this._geo.getPoints(100)
    return renderer.lines(points)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    const spline = this._geo as unknown as {
      degree: number
      knots: number[]
      weights: number[]
      controlPoints: AcGePoint3dLike[]
      fitPoints?: AcGePoint3dLike[]
    }
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbSpline')
    filer.writeInt16(70, this.closed ? 1 : 0)
    filer.writeInt16(71, spline.degree)
    filer.writeInt16(72, spline.knots.length)
    filer.writeInt16(73, spline.controlPoints.length)
    filer.writeInt16(74, spline.fitPoints?.length ?? 0)
    for (const knot of spline.knots) {
      filer.writeDouble(40, knot)
    }
    for (const weight of spline.weights) {
      filer.writeDouble(41, weight)
    }
    for (const point of spline.controlPoints) {
      filer.writePoint3d(10, point)
    }
    for (const point of spline.fitPoints ?? []) {
      filer.writePoint3d(11, point)
    }
    return this
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetCurves}
   *
   * Approximates the spline with a densely sampled path in XY, offsets each sample
   * along its local normal, and trims self-intersecting loops at tight bends.
   * The result is an {@link AcDbPolyline}, not a spline entity.
   */
  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const curve = this.createOffsetCurve(offsetDist)
    return curve ? [curve] : []
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetSideAtPoint}
   *
   * Evaluates side relative to the sampled 2D approximation of the spline.
   */
  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const path = this.collectPath2d(1)
    if (path.length < 2) return 1
    return AcDbPolyline.from2dPoints(path, this.closed).getOffsetSideAtPoint(
      point
    )
  }

  /**
   * @param offsetDist - Signed offset distance in drawing units
   * @returns Offset polyline approximating this spline, or `null` on failure
   */
  private createOffsetCurve(offsetDist: number): AcDbCurve | null {
    const { points, tangents } = this._geo.getOffsetSamplePath2d(offsetDist)
    const geo = offsetSmoothedSampledPath(
      points,
      this.closed,
      offsetDist,
      tangents
    )
    return geo ? AcDbPolyline.fromGePolyline(geo) : null
  }

  /**
   * Samples {@link AcGeSpline3d} for side tests (uniform parameter density).
   *
   * @param offsetDist - Used only to choose sample spacing
   * @returns XY points along the spline
   */
  private collectPath2d(offsetDist: number): AcGePoint2d[] {
    return this._geo.getOffsetSamplePath2d(offsetDist).points
  }
}
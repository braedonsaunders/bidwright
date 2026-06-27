import {
  AcGeEllipseArc3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePointLike,
  AcGeVector3dLike,
  getOcsAngle,
  TAU
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbForEachGripIndex } from './AcDbGripHelpers'
import { acdbPickNearestOsnapPoint } from './AcDbOsnapHelpers'

/** Quadrant grip angles in radians: 0?, 90?, 180?, 270?. */
const ELLIPSE_QUADRANT_GRIP_ANGLES = [
  0,
  Math.PI / 2,
  Math.PI,
  (Math.PI / 2) * 3
]

/**
 * Represents an ellipse entity in AutoCAD.
 *
 * An ellipse is a 2D geometric object defined by its center point, major and minor axes,
 * and optional start and end angles. Ellipses are curved shapes that can be used to
 * create elliptical shapes in drawings. The ellipse is always drawn in the plane
 * defined by its normal vector.
 *
 * @example
 * ```typescript
 * // Create a full ellipse
 * const ellipse = new AcDbEllipse(
 *   new AcGePoint3d(0, 0, 0),
 *   AcGeVector3d.Z_AXIS,
 *   AcGeVector3d.X_AXIS,
 *   10, // major axis radius
 *   5,  // minor axis radius
 *   0,  // start angle
 *   2 * Math.PI // end angle (full ellipse)
 * );
 *
 * // Access ellipse properties
 * console.log(`Center: ${ellipse.center}`);
 * console.log(`Major radius: ${ellipse.majorAxisRadius}`);
 * console.log(`Minor radius: ${ellipse.minorAxisRadius}`);
 * ```
 */
export class AcDbEllipse extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = 'Ellipse'

  override get dxfTypeName() {
    return 'ELLIPSE'
  }

  /** The underlying geometric ellipse arc object */
  private _geo: AcGeEllipseArc3d

  /**
   * Creates a new ellipse entity.
   *
   * This constructor creates an ellipse using the specified center point, normal vector,
   * major axis, and radii. The center point must be in World Coordinate System (WCS) coordinates.
   *
   * @param center - The center point of the ellipse in WCS coordinates
   * @param normal - The normal vector defining the plane of the ellipse
   * @param majorAxis - The major axis vector in WCS coordinates
   * @param majorAxisRadius - The radius of the major axis (must be positive)
   * @param minorAxisRadius - The radius of the minor axis (must be positive)
   * @param startAngle - The starting angle in radians (0 to 2?)
   * @param endAngle - The ending angle in radians (0 to 2?)
   *
   * @example
   * ```typescript
   * // Create a full ellipse in the XY plane
   * const fullEllipse = new AcDbEllipse(
   *   new AcGePoint3d(0, 0, 0),
   *   AcGeVector3d.Z_AXIS,
   *   AcGeVector3d.X_AXIS,
   *   20, // major radius
   *   10, // minor radius
   *   0,
   *   2 * Math.PI
   * );
   *
   * // Create a quarter ellipse
   * const quarterEllipse = new AcDbEllipse(
   *   new AcGePoint3d(10, 20, 0),
   *   AcGeVector3d.Z_AXIS,
   *   AcGeVector3d.X_AXIS,
   *   15,
   *   8,
   *   0,
   *   Math.PI / 2
   * );
   * ```
   */
  constructor(
    center: AcGePointLike,
    normal: AcGeVector3dLike,
    majorAxis: AcGeVector3dLike,
    majorAxisRadius: number,
    minorAxisRadius: number,
    startAngle: number,
    endAngle: number
  ) {
    super()
    this._geo = new AcGeEllipseArc3d(
      center,
      normal,
      majorAxis,
      majorAxisRadius,
      minorAxisRadius,
      startAngle,
      endAngle
    )
  }

  /**
   * Gets the center point of this ellipse.
   *
   * @returns The center point as a 3D point
   *
   * @example
   * ```typescript
   * const centerPoint = ellipse.center;
   * console.log(`Ellipse center: ${centerPoint.x}, ${centerPoint.y}, ${centerPoint.z}`);
   * ```
   */
  get center(): AcGePoint3d {
    return this._geo.center
  }

  /**
   * Sets the center point of this ellipse.
   *
   * @param value - The new center point
   *
   * @example
   * ```typescript
   * ellipse.center = new AcGePoint3d(5, 5, 0);
   * ```
   */
  set center(value: AcGePoint3dLike) {
    this._geo.center = value
  }

  /**
   * Gets the major axis radius of this ellipse.
   *
   * @returns The major axis radius value
   *
   * @example
   * ```typescript
   * const majorRadius = ellipse.majorAxisRadius;
   * console.log(`Major radius: ${majorRadius}`);
   * ```
   */
  get majorAxis(): AcGeVector3dLike {
    return this._geo.majorAxis
  }

  get majorAxisRadius(): number {
    return this._geo.majorAxisRadius
  }

  /**
   * Sets the major axis radius of this ellipse.
   *
   * @param value - The new major axis radius value (must be positive)
   *
   * @example
   * ```typescript
   * ellipse.majorAxisRadius = 25;
   * ```
   */
  set majorAxisRadius(value: number) {
    this._geo.majorAxisRadius = value
  }

  /**
   * Gets the minor axis radius of this ellipse.
   *
   * @returns The minor axis radius value
   *
   * @example
   * ```typescript
   * const minorRadius = ellipse.minorAxisRadius;
   * console.log(`Minor radius: ${minorRadius}`);
   * ```
   */
  get minorAxisRadius(): number {
    return this._geo.minorAxisRadius
  }

  /**
   * Sets the minor axis radius of this ellipse.
   *
   * @param value - The new minor axis radius value (must be positive)
   *
   * @example
   * ```typescript
   * ellipse.minorAxisRadius = 12;
   * ```
   */
  set minorAxisRadius(value: number) {
    this._geo.minorAxisRadius = value
  }

  /**
   * Gets the start angle of this ellipse.
   *
   * @returns The start angle in radians
   *
   * @example
   * ```typescript
   * const startAngle = ellipse.startAngle;
   * console.log(`ellipse start angle: ${startAngle} radians (${startAngle * 180 / Math.PI} degrees)`);
   * ```
   */
  get startAngle(): number {
    return this._geo.startAngle
  }

  /**
   * Sets the start angle of this ellipse.
   *
   * @param value - The new start angle in radians (0 to 2?)
   *
   * @example
   * ```typescript
   * ellipse.startAngle = Math.PI / 4; // 45 degrees
   * ```
   */
  set startAngle(value: number) {
    this._geo.startAngle = value
  }

  /**
   * Gets the end angle of this ellipse.
   *
   * @returns The end angle in radians
   *
   * @example
   * ```typescript
   * const endAngle = ellipse.endAngle;
   * console.log(`ellipse end angle: ${endAngle} radians (${endAngle * 180 / Math.PI} degrees)`);
   * ```
   */
  get endAngle(): number {
    return this._geo.endAngle
  }

  /**
   * Sets the end angle of this ellipse.
   *
   * @param value - The new end angle in radians (0 to 2?)
   *
   * @example
   * ```typescript
   * ellipse.endAngle = Math.PI; // 180 degrees
   * ```
   */
  set endAngle(value: number) {
    this._geo.endAngle = value
  }

  /**
   * Gets the normal vector of this ellipse.
   *
   * The normal vector defines the plane in which the ellipse lies.
   *
   * @returns The unit normal vector in WCS coordinates
   *
   * @example
   * ```typescript
   * const normal = ellipse.normal;
   * console.log(`Ellipse normal: ${normal.x}, ${normal.y}, ${normal.z}`);
   * ```
   */
  get normal() {
    return this._geo.normal
  }

  /**
   * Sets the normal vector of this ellipse.
   *
   * @param value - The new normal vector
   *
   * @example
   * ```typescript
   * ellipse.normal = AcGeVector3d.Y_AXIS;
   * ```
   */
  set normal(value: AcGeVector3dLike) {
    this._geo.normal = value
  }

  /**
   * Gets the geometric extents (bounding box) of this ellipse.
   *
   * @returns The bounding box that encompasses the entire ellipse
   *
   * @example
   * ```typescript
   * const extents = ellipse.geometricExtents;
   * console.log(`Ellipse bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents() {
    return this._geo.box
  }

  /**
   * Gets whether this ellipse is closed.
   *
   * A full ellipse may be stored either with identical start/end angles (AutoCAD
   * convention) or with a 0??? parameter span. Both represent a closed curve.
   *
   * @returns True if the ellipse is closed (forms a complete ellipse), false otherwise
   */
  get closed(): boolean {
    return this._geo.closed || Math.abs(this._geo.deltaAngle - TAU) < 1e-10
  }

  /** @inheritdoc */
  get area(): number {
    return this._geo.area
  }

  /**
   * Gets the grip points for this ellipse.
   *
   * Closed ellipses return the center and four quadrant points.
   * Open ellipse arcs return the center, start point, and end point.
   *
   * @returns Array of grip points
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    gripPoints.push(this._geo.center)
    if (this.closed) {
      for (const angle of ELLIPSE_QUADRANT_GRIP_ANGLES) {
        gripPoints.push(this._geo.getPointAtAngle(angle))
      }
    } else {
      gripPoints.push(this._geo.startPoint)
      gripPoints.push(this._geo.endPoint)
    }
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbForEachGripIndex(indices, index => {
      this.moveGripAt(index, offset)
    })
    return this
  }

  /**
   * Gets the object snap points for this ellipse or ellipse arc.
   *
   * Object snap points are precise points that can be used for positioning
   * when drawing or editing. This method provides snap points based on the
   * specified snap mode.
   *
   * @param osnapMode - The object snap mode
   * @param pickPoint - The point where the user picked
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
        if (!this.closed) {
          snapPoints.push(this._geo.startPoint)
          snapPoints.push(this._geo.endPoint)
        }
        break
      case AcDbOsnapMode.MidPoint:
        if (!this.closed) {
          snapPoints.push(this._geo.midPoint)
        }
        break
      case AcDbOsnapMode.Center:
      case AcDbOsnapMode.Centroid:
        snapPoints.push(this._geo.center)
        break
      case AcDbOsnapMode.Quadrant:
        if (this.closed) {
          for (const angle of ELLIPSE_QUADRANT_GRIP_ANGLES) {
            snapPoints.push(this._geo.getPointAtAngle(angle))
          }
        }
        break
      case AcDbOsnapMode.Nearest:
        snapPoints.push(this._geo.nearestPoint(pickPoint))
        break
      case AcDbOsnapMode.Tangent:
        snapPoints.push(...this._geo.tangentPoints(pickPoint))
        break
      case AcDbOsnapMode.Perpendicular: {
        const candidates = this._geo.perpendicularPoints(pickPoint)
        const nearest = acdbPickNearestOsnapPoint(pickPoint, candidates)
        if (nearest) snapPoints.push(nearest)
        break
      }
      default:
        break
    }
  }

  /**
   * Transforms this ellipse by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._geo.transform(matrix)
    return this
  }

  /**
   * Returns the full property definition for this ellipse entity, including
   * general group and geometry group.
   *
   * The geometry group exposes editable properties via {@link AcDbPropertyAccessor}
   * so the property palette can update the ellipse in real-time.
   *
   * Each property is an {@link AcDbEntityRuntimeProperty}.
   */
  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'centerX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.center.x,
                set: (v: number) => {
                  this.center.x = v
                }
              }
            },
            {
              name: 'centerY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.center.y,
                set: (v: number) => {
                  this.center.y = v
                }
              }
            },
            {
              name: 'centerZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.center.z,
                set: (v: number) => {
                  this.center.z = v
                }
              }
            },
            {
              name: 'majorAxisRadius',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.majorAxisRadius,
                set: (v: number) => {
                  this.center.x = v
                }
              }
            },
            {
              name: 'minorAxisRadius',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.minorAxisRadius,
                set: (v: number) => {
                  this.minorAxisRadius = v
                }
              }
            },
            {
              name: 'startAngle',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.startAngle,
                set: (v: number) => {
                  this.startAngle = v
                }
              }
            },
            {
              name: 'endAngle',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.endAngle,
                set: (v: number) => {
                  this.endAngle = v
                }
              }
            },
            {
              name: 'normalX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.normal.x,
                set: (v: number) => {
                  this.normal.x = v
                }
              }
            },
            {
              name: 'normalY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.normal.y,
                set: (v: number) => {
                  this.normal.y = v
                }
              }
            },
            {
              name: 'normalZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.normal.z,
                set: (v: number) => {
                  this.normal.z = v
                }
              }
            },
            {
              name: 'length',
              type: 'float',
              editable: false,
              accessor: {
                get: () => this._geo.length
              }
            },
            {
              name: 'area',
              type: 'float',
              editable: false,
              accessor: {
                get: () => this.area
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Draws this ellipse using the specified renderer.
   *
   * This method renders the ellipse as an elliptical arc using the ellipse's
   * current style properties.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered ellipse entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    return renderer.ellipticalArc(this._geo)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbEllipse')
    filer.writePoint3d(10, this.center)
    const u = this._geo.majorAxis
    const r = this.majorAxisRadius
    filer.writePoint3d(11, {
      x: u.x * r,
      y: u.y * r,
      z: u.z * r
    })
    filer.writeVector3d(210, this.normal)
    filer.writeDouble(40, this.minorAxisRadius / this.majorAxisRadius)
    filer.writeDouble(41, this.startAngle)
    filer.writeDouble(42, this.endAngle)
    return this
  }

  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const curve = this.createOffsetCurve(offsetDist)
    return curve ? [curve] : []
  }

  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const c = this.center
    const dx = point.x - c.x
    const dy = point.y - c.y
    const major = this.majorAxis
    const majorLen = Math.hypot(major.x, major.y) || 1
    const minorLen =
      (this.minorAxisRadius / this.majorAxisRadius) * majorLen || 1
    const ux = major.x / majorLen
    const uy = major.y / majorLen
    const vx = -uy
    const vy = ux
    const u = dx * ux + dy * uy
    const v = dx * vx + dy * vy
    return (u / majorLen) ** 2 + (v / minorLen) ** 2 >= 1 ? 1 : -1
  }

  private moveGripAt(gripIndex: number, offset: AcGeVector3dLike) {
    switch (gripIndex) {
      case 0:
        this.transformBy(AcGeMatrix3d.makeTranslation(offset))
        break
      case 1:
        if (this.closed) {
          this.moveQuadrantGripAt(ELLIPSE_QUADRANT_GRIP_ANGLES[0], offset)
        } else {
          const point = this._geo.startPoint
          this._geo.startAngle = getOcsAngle(
            this._geo.center,
            {
              x: point.x + offset.x,
              y: point.y + offset.y,
              z: (point.z ?? 0) + (offset.z ?? 0)
            },
            this._geo.normal
          )
        }
        break
      case 2:
        if (this.closed) {
          this.moveQuadrantGripAt(ELLIPSE_QUADRANT_GRIP_ANGLES[1], offset)
        } else {
          const point = this._geo.endPoint
          this._geo.endAngle = getOcsAngle(
            this._geo.center,
            {
              x: point.x + offset.x,
              y: point.y + offset.y,
              z: (point.z ?? 0) + (offset.z ?? 0)
            },
            this._geo.normal
          )
        }
        break
      case 3:
      case 4:
        if (this.closed) {
          this.moveQuadrantGripAt(
            ELLIPSE_QUADRANT_GRIP_ANGLES[gripIndex - 1],
            offset
          )
        }
        break
      default:
        break
    }
  }

  /**
   * Moves a quadrant grip on a closed ellipse by updating the corresponding axis radius.
   *
   * Grips at 0? and 180? adjust {@link majorAxisRadius}; grips at 90? and 270? adjust
   * {@link minorAxisRadius}. The new radius is the absolute projection of the dragged
   * point onto the relevant axis from the ellipse center.
   *
   * @param angle - Quadrant angle in radians (0, ?/2, ?, or 3?/2).
   * @param offset - Translation applied to the grip point before recomputing the radius.
   * @private
   */
  private moveQuadrantGripAt(angle: number, offset: AcGeVector3dLike) {
    const point = this._geo.getPointAtAngle(angle)
    const newPoint = new AcGePoint3d(
      point.x + offset.x,
      point.y + offset.y,
      (point.z ?? 0) + (offset.z ?? 0)
    )
    const c = this._geo.center
    const dx = newPoint.x - c.x
    const dy = newPoint.y - c.y
    const dz = (newPoint.z ?? 0) - (c.z ?? 0)
    const axis =
      angle === 0 || angle === Math.PI
        ? this._geo.majorAxis
        : this._geo.minorAxis
    const projected = dx * axis.x + dy * axis.y + dz * axis.z
    const newRadius = Math.abs(projected)
    if (newRadius <= 0) return
    if (angle === 0 || angle === Math.PI) {
      this.majorAxisRadius = newRadius
    } else {
      this.minorAxisRadius = newRadius
    }
  }

  private createOffsetCurve(offsetDist: number): AcDbEllipse | null {
    const geo = this._geo.offset(offsetDist)
    if (!geo) return null
    return new AcDbEllipse(
      geo.center,
      geo.normal,
      geo.majorAxis,
      geo.majorAxisRadius,
      geo.minorAxisRadius,
      geo.startAngle,
      geo.endAngle
    )
  }
}
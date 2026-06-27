import {
  AcGeBox3d,
  AcGeLine3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike,
  offsetPointByDirectionInXY
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbMovePrimaryGripPointAt } from './AcDbGripHelpers'

/**
 * Represents an xline entity in AutoCAD.
 *
 * An xline is a 3D geometric object that extends infinitely in both directions from a base point.
 * Xlines are commonly used for construction lines, reference lines, and temporary geometry.
 * Unlike lines, xlines have no end points and extend to infinity in both directions.
 *
 * @example
 * ```typescript
 * // Create an xline from origin in the positive X direction
 * const xline = new AcDbXline();
 * xline.basePoint = new AcGePoint3d(0, 0, 0);
 * xline.unitDir = new AcGeVector3d(1, 0, 0);
 *
 * // Access xline properties
 * console.log(`Base point: ${xline.basePoint}`);
 * console.log(`Unit direction: ${xline.unitDir}`);
 * ```
 */
export class AcDbXline extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = 'Xline'

  override get dxfTypeName() {
    return 'XLINE'
  }

  /** The base point of the xline */
  private _basePoint: AcGePoint3d
  /** The unit direction vector of the xline */
  private _unitDir: AcGeVector3d

  /**
   * Creates a new xline entity.
   *
   * This constructor initializes an xline with default values.
   * The base point is at the origin and the unit direction is undefined.
   *
   * @example
   * ```typescript
   * const xline = new AcDbXline();
   * xline.basePoint = new AcGePoint3d(5, 10, 0);
   * xline.unitDir = new AcGeVector3d(0, 1, 0); // Positive Y direction
   * ```
   */
  constructor() {
    super()
    this._basePoint = new AcGePoint3d()
    this._unitDir = new AcGeVector3d()
  }

  /**
   * Gets the base point of this xline.
   *
   * The base point is the center point from which the xline extends infinitely
   * in both directions.
   *
   * @returns The base point as a 3D point
   *
   * @example
   * ```typescript
   * const basePoint = xline.basePoint;
   * console.log(`Xline base point: ${basePoint.x}, ${basePoint.y}, ${basePoint.z}`);
   * ```
   */
  get basePoint() {
    return this._basePoint
  }

  /**
   * Sets the base point of this xline.
   *
   * @param value - The new base point
   *
   * @example
   * ```typescript
   * xline.basePoint = new AcGePoint3d(10, 20, 0);
   * ```
   */
  set basePoint(value: AcGePoint3d) {
    this._basePoint.copy(value)
  }

  /**
   * Gets the unit direction vector of this xline.
   *
   * The unit direction vector defines the direction in which the xline extends
   * infinitely in both directions from the base point.
   *
   * @returns The unit direction vector
   *
   * @example
   * ```typescript
   * const unitDir = xline.unitDir;
   * console.log(`Xline direction: ${unitDir.x}, ${unitDir.y}, ${unitDir.z}`);
   * ```
   */
  get unitDir() {
    return this._unitDir
  }

  /**
   * Sets the unit direction vector of this xline.
   *
   * @param value - The new unit direction vector
   *
   * @example
   * ```typescript
   * xline.unitDir = new AcGeVector3d(0, 0, 1); // Positive Z direction
   * ```
   */
  set unitDir(value: AcGePoint3d) {
    this._unitDir.copy(value)
  }

  /**
   * Gets whether this xline is closed.
   *
   * Xlines are always open entities, so this always returns false.
   *
   * @returns Always false for xlines
   */
  get closed(): boolean {
    return false
  }

  /** @inheritdoc */
  get area(): number {
    return 0
  }

  /**
   * Gets the geometric extents (bounding box) of this xline.
   *
   * Since xlines extend infinitely in both directions, this method returns a
   * bounding box that encompasses a finite portion of the xline for practical purposes.
   *
   * @returns The bounding box that encompasses a portion of the xline
   *
   * @example
   * ```typescript
   * const extents = xline.geometricExtents;
   * console.log(`Xline bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents(): AcGeBox3d {
    const extents = new AcGeBox3d()
    extents.expandByPoint(
      this._unitDir.clone().multiplyScalar(10).add(this._basePoint)
    )
    extents.expandByPoint(
      this._unitDir.clone().multiplyScalar(-10).add(this._basePoint)
    )
    return extents
  }

  /**
   * Returns the full property definition for this xline entity, including
   * general group and geometry group.
   *
   * The geometry group exposes editable start/end coordinates via
   * {@link AcDbPropertyAccessor} so the property palette can update
   * the xline in real-time.
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
              name: 'basePointX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.basePoint.x,
                set: (v: number) => {
                  this.basePoint.x = v
                }
              }
            },
            {
              name: 'basePointY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.basePoint.y,
                set: (v: number) => {
                  this.basePoint.y = v
                }
              }
            },
            {
              name: 'basePointZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.basePoint.z,
                set: (v: number) => {
                  this.basePoint.z = v
                }
              }
            },
            {
              name: 'unitDirX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.unitDir.x,
                set: (v: number) => {
                  this.unitDir.x = v
                }
              }
            },
            {
              name: 'unitDirY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.unitDir.y,
                set: (v: number) => {
                  this.unitDir.y = v
                }
              }
            },
            {
              name: 'unitDirZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.unitDir.z,
                set: (v: number) => {
                  this.unitDir.z = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Gets the grip points for this xline.
   *
   * Grip points are control points that can be used to modify the xline.
   * For an xline, the grip point is the base point.
   *
   * @returns Array of grip points (base point)
   *
   * @example
   * ```typescript
   * const gripPoints = xline.subGetGripPoints();
   * // gripPoints contains: [basePoint]
   * ```
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    gripPoints.push(this.basePoint)
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbMovePrimaryGripPointAt(indices, offset, this.basePoint)
    return this
  }

  /**
   * Gets the object snap points for this xline.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    const origin = this.basePoint

    if (osnapMode === AcDbOsnapMode.EndPoint) {
      snapPoints.push(origin)
      return
    }

    const direction = this.unitDir.clone()
    if (direction.lengthSq() === 0) return

    direction.normalize()
    const line = new AcGeLine3d(origin, origin.clone().add(direction))

    switch (osnapMode) {
      case AcDbOsnapMode.Nearest:
        snapPoints.push(line.project(pickPoint))
        break
      case AcDbOsnapMode.Perpendicular:
        snapPoints.push(line.perpPoint(pickPoint))
        break
      default:
        break
    }
  }

  /**
   * Transforms this xline by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._basePoint.applyMatrix4(matrix)
    this._unitDir.transformDirection(matrix)
    return this
  }

  /**
   * Draws this xline using the specified renderer.
   *
   * This method renders the xline as a line segment extending from the base point
   * in both directions along the unit vector. For practical purposes, the xline is
   * drawn with a finite length.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered xline entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const points: AcGePoint3d[] = []
    points.push(
      this._unitDir.clone().multiplyScalar(-1000000).add(this._basePoint)
    )
    points.push(
      this._unitDir.clone().multiplyScalar(1000000).add(this._basePoint)
    )
    return renderer.lines(points)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbXline')
    filer.writePoint3d(10, this.basePoint)
    filer.writeVector3d(11, this.unitDir)
    return this
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetCurves}
   *
   * Returns a parallel construction line: {@link basePoint} moves perpendicular to the
   * XY projection of {@link unitDir} by `offsetDist`; direction is unchanged. Returns an
   * empty array when the XY direction is degenerate.
   */
  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const curve = this.createOffsetCurve(offsetDist)
    return curve ? [curve] : []
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetSideAtPoint}
   *
   * Same planar left/right test as {@link AcDbRay.getOffsetSideAtPoint}.
   */
  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const bp = this.basePoint
    const dir = this.unitDir
    const len = Math.hypot(dir.x, dir.y)
    if (len <= 1e-9) return 1
    return (dir.x * (point.y - bp.y) - dir.y * (point.x - bp.x)) / len >= 0
      ? 1
      : -1
  }

  /**
   * @param offsetDist - Signed offset distance in drawing units (perpendicular in XY)
   * @returns Parallel xline, or `null` when {@link unitDir} has negligible XY component
   */
  private createOffsetCurve(offsetDist: number): AcDbXline | null {
    const offsetPoint = offsetPointByDirectionInXY(
      this.basePoint,
      this.unitDir,
      offsetDist
    )
    if (!offsetPoint) return null
    const xline = new AcDbXline()
    xline.basePoint = offsetPoint
    xline.unitDir = this.unitDir.clone()
    return xline
  }
}

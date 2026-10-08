import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePointLike,
  acgeTransformOcsPointToWcs,
  acgeTransformWcsPointToOcs,
  AcGeVector3d,
  AcGeVector3dLike} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbMovePrimaryGripPointAt } from './AcDbGripHelpers'

/**
 * Represents a point entity in AutoCAD.
 *
 * A point is a 0-dimensional geometric object defined by its position in 3D space.
 * Points are fundamental drawing entities that can be used to mark specific
 * locations in drawings or as reference points for other entities.
 *
 * @example
 * ```typescript
 * // Create a point at the origin
 * const point = new AcDbPoint();
 * point.position = new AcGePoint3d(0, 0, 0);
 *
 * // Create a point at a specific location
 * const point2 = new AcDbPoint();
 * point2.position = new AcGePoint3d(10, 20, 5);
 *
 * // Access point properties
 * console.log(`Point position: ${point.position}`);
 * ```
 */
export class AcDbPoint extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Point'

  override get dxfTypeName() {
    return 'POINT'
  }

  /** The underlying geometric point object */
  private _geo: AcGePoint3d
  /** Thickness along the normal (DXF group 39) */
  private _thickness = 0
  /** Extrusion / plane normal (DXF group 210) */
  private _normal = new AcGeVector3d(0, 0, 1)
  /**
   * Angle of the X axis for the UCS in effect when the point was drawn
   * (DXF group 50). Used when PDMODE is nonzero.
   */
  private _ecsRotation = 0

  /**
   * Creates a new point entity.
   *
   * This constructor initializes a point object at the origin (0,0,0).
   * The position can be set after creation using the position property.
   *
   * @example
   * ```typescript
   * const point = new AcDbPoint();
   * point.position = new AcGePoint3d(5, 10, 0);
   * ```
   */
  constructor() {
    super()
    this._geo = new AcGePoint3d()
  }

  /**
   * Gets the position of this point in WCS coordinates.
   *
   * @returns The position as a 3D point
   *
   * @example
   * ```typescript
   * const position = point.position;
   * console.log(`Point at: ${position.x}, ${position.y}, ${position.z}`);
   * ```
   */
  get position(): AcGePoint3d {
    return this._geo
  }

  /**
   * Sets the position of this point in WCS coordinates.
   *
   * @param value - The new position
   *
   * @example
   * ```typescript
   * point.position = new AcGePoint3d(15, 25, 0);
   * ```
   */
  set position(value: AcGePointLike) {
    this._geo.set(value.x, value.y, value.z || 0)
  }

  /**
   * Thickness along the entity normal (DXF group 39).
   */
  get thickness() {
    return this._thickness
  }
  set thickness(value: number) {
    this._thickness = value
  }

  /**
   * Extrusion direction / plane normal (DXF group 210).
   */
  get normal(): AcGeVector3d {
    return this._normal
  }
  set normal(value: AcGeVector3dLike) {
    this._normal.copy(value)
  }

  /**
   * Angle of the X axis for the UCS in effect when the point was drawn
   * (DXF group 50), in radians.
   */
  get ecsRotation() {
    return this._ecsRotation
  }
  set ecsRotation(value: number) {
    this._ecsRotation = value
  }

  /**
   * Gets the geometric extents (bounding box) of this point.
   *
   * For a point, the bounding box is a minimal box that contains just the point.
   *
   * @returns The bounding box that encompasses the point
   *
   * @example
   * ```typescript
   * const extents = point.geometricExtents;
   * console.log(`Point bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents(): AcGeBox3d {
    return new AcGeBox3d().expandByPoint(this._geo)
  }

  /**
   * Gets the object snap points for this point.
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
  /**
   * Gets the grip points for this point entity.
   *
   * @returns Array containing the point position.
   */
  subGetGripPoints() {
    return [this._geo]
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbMovePrimaryGripPointAt(indices, offset, this._geo)
    return this
  }

  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    _pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    if (osnapMode === AcDbOsnapMode.Node) {
      snapPoints.push(this._geo)
    }
  }

  /**
   * Returns the full property definition for this point entity, including
   * general group and geometry group.
   *
   * The geometry group exposes editable start/end coordinates via
   * {@link AcDbPropertyAccessor} so the property palette can update
   * the point in real-time.
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
              name: 'positionX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.x,
                set: (v: number) => {
                  this.position.x = v
                }
              }
            },
            {
              name: 'positionY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.y,
                set: (v: number) => {
                  this.position.y = v
                }
              }
            },
            {
              name: 'positionZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.z,
                set: (v: number) => {
                  this.position.z = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Transforms this point by the specified matrix.
   *
   * This method applies a geometric transformation to the point, updating
   * its position according to the transformation matrix.
   *
   * @param matrix - The transformation matrix to apply
   * @returns This point after transformation
   *
   * @example
   * ```typescript
   * const translationMatrix = AcGeMatrix3d.translation(10, 0, 0);
   * point.transformBy(translationMatrix);
   * // Point is now translated 10 units in the X direction
   * ```
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._geo.applyMatrix4(matrix)
    return this
  }

  /**
   * Only the simple PDMODE dot (0) is a single `THREE.Points` drawable.
   * Other modes emit symbol LineSegments and stay on the legacy path.
   *
   * @internal
   */
  override get directBatchPrimitive() {
    const mode = this.database?.pdmode ?? 0
    return mode === 0 ? ('point' as const) : null
  }

  /**
   * Draws this point using the specified renderer.
   *
   * This method renders the point using the point's current style properties,
   * including the display mode and size from the database.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered point entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    return renderer.point(this._geo, {
      displayMode: this.database.pdmode,
      displaySize: this.database.pdsize
    })
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbPoint')
    if (this.thickness !== 0) {
      filer.writeDouble(39, this.thickness)
    }
    filer.writePoint3d(10, acgeTransformWcsPointToOcs(this.position, this.normal))
    if (this.ecsRotation !== 0) {
      filer.writeAngle(50, this.ecsRotation)
    }
    filer.writeVector3d(210, this.normal)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbPoint')

    let x = this.position.x
    let y = this.position.y
    let z = this.position.z
    let thickness = this.thickness
    let angleDeg = (this.ecsRotation * 180) / Math.PI
    let nx = this.normal.x
    let ny = this.normal.y
    let nz = this.normal.z

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 10:
          x = n
          break
        case 20:
          y = n
          break
        case 30:
          z = n
          break
        case 39:
          thickness = n
          break
        case 50:
          angleDeg = n
          break
        case 210:
          nx = n
          break
        case 220:
          ny = n
          break
        case 230:
          nz = n
          break
        default:
          break
      }
    }

    const normal = new AcGeVector3d(nx, ny, nz)
    if (normal.lengthSq() > 0) {
      this.normal.copy(normal.normalize())
    }
    this.thickness = thickness
    this.ecsRotation = (angleDeg * Math.PI) / 180
    this.position = acgeTransformOcsPointToWcs({ x, y, z }, this.normal)
    return this
  }
}

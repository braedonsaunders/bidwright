import {
  AcGeBox3d,
  AcGeIntersectPrimitive,
  AcGeLine3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  acgeTransformOcsPointToWcsInto,
  acgeTransformWcsPointToOcs,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbForEachGripIndex } from './AcDbGripHelpers'

/** Reused across dxfIn to avoid per-entity temporaries (parse is sequential). */
const _dxfInPointA = /*@__PURE__*/ new AcGePoint3d()
const _dxfInPointB = /*@__PURE__*/ new AcGePoint3d()
/** Scratch holding the OCS coordinates before they are transformed to WCS. */
const _dxfInOcsPoint = /*@__PURE__*/ new AcGePoint3d()

/**
 * Represents a line entity in AutoCAD.
 *
 * A line is a 3D geometric object defined by its start point and end point.
 * Lines are fundamental drawing entities that can be used to create straight
 * line segments in 2D or 3D space.
 *
 * @example
 * ```typescript
 * // Create a line from point (0,0,0) to point (10,10,0)
 * const line = new AcDbLine(
 *   new AcGePoint3d(0, 0, 0),
 *   new AcGePoint3d(10, 10, 0)
 * );
 *
 * // Access line properties
 * console.log(`Start point: ${line.startPoint}`);
 * console.log(`End point: ${line.endPoint}`);
 * console.log(`Mid point: ${line.midPoint}`);
 * ```
 */
export class AcDbLine extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = 'Line'

  override get dxfTypeName() {
    return 'LINE'
  }

  /** Backing for the lazily materialized geometric line object. */
  private _geoData: AcGeLine3d | null = null
  /**
   * Backing for the lazily materialized extrusion / OCS normal (DXF group
   * 210). `null` means "not yet materialized"; the default `+Z` vector is
   * created on first access.
   */
  private _normal: AcGeVector3d | null = null

  /**
   * The underlying geometric line object. Materialized lazily so that
   * factory-created entities (dxfIn path) never allocate a default line
   * that dxfIn would immediately replace.
   */
  private get _geo(): AcGeLine3d {
    if (this._geoData == null) {
      this._geoData = new AcGeLine3d(new AcGePoint3d(), new AcGePoint3d())
    }
    return this._geoData
  }

  private set _geo(value: AcGeLine3d) {
    this._geoData = value
  }
  /** Thickness along the normal (DXF group 39) */
  private _thickness = 0

  /**
   * Creates a new line entity.
   *
   * This constructor initializes the line object with the specified start and end points.
   * Both points must be in World Coordinate System (WCS) coordinates.
   *
   * @param start - The starting point of the line in WCS coordinates
   * @param end - The ending point of the line in WCS coordinates
   *
   * @example
   * ```typescript
   * const line = new AcDbLine(
   *   new AcGePoint3d(0, 0, 0),
   *   new AcGePoint3d(100, 50, 0)
   * );
   * ```
   */
  constructor()
  constructor(start: AcGePoint3dLike, end: AcGePoint3dLike)
  constructor(start?: AcGePoint3dLike, end?: AcGePoint3dLike) {
    super()
    if (start !== undefined && end !== undefined) {
      this._geo = new AcGeLine3d(start, end)
    }
  }

  /**
   * Gets the starting point of this line.
   *
   * @returns The starting point as a 3D point
   *
   * @example
   * ```typescript
   * const startPoint = line.startPoint;
   * console.log(`Line starts at: ${startPoint.x}, ${startPoint.y}, ${startPoint.z}`);
   * ```
   */
  get startPoint(): AcGePoint3d {
    return this._geo.startPoint
  }

  /**
   * Sets the starting point of this line.
   *
   * @param value - The new starting point
   *
   * @example
   * ```typescript
   * line.startPoint = new AcGePoint3d(5, 5, 0);
   * ```
   */
  set startPoint(value: AcGePoint3dLike) {
    this._geo.startPoint = value
  }

  /**
   * Gets the ending point of this line.
   *
   * @returns The ending point as a 3D point
   *
   * @example
   * ```typescript
   * const endPoint = line.endPoint;
   * console.log(`Line ends at: ${endPoint.x}, ${endPoint.y}, ${endPoint.z}`);
   * ```
   */
  get endPoint(): AcGePoint3d {
    return this._geo.endPoint
  }

  /**
   * Sets the ending point of this line.
   *
   * @param value - The new ending point
   *
   * @example
   * ```typescript
   * line.endPoint = new AcGePoint3d(15, 15, 0);
   * ```
   */
  set endPoint(value: AcGePoint3dLike) {
    this._geo.endPoint = value
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
   * Extrusion direction / OCS normal (DXF group 210).
   *
   * The default `+Z` vector is materialized on first access. A DXF import only
   * assigns a normal for the rare records that carry a 210/220/230 group, so
   * the LINE/SOLID/TRACE entities of a large drawing never allocate the
   * default vector at all.
   */
  get normal(): AcGeVector3d {
    let normal = this._normal
    if (normal == null) {
      normal = new AcGeVector3d(0, 0, 1)
      this._normal = normal
    }
    return normal
  }
  set normal(value: AcGeVector3dLike) {
    this.normal.copy(value).normalize()
  }

  /**
   * Gets the middle point of this line.
   *
   * The middle point is calculated as the midpoint between the start and end points.
   *
   * @returns The middle point as a 3D point
   *
   * @example
   * ```typescript
   * const midPoint = line.midPoint;
   * console.log(`Line midpoint: ${midPoint.x}, ${midPoint.y}, ${midPoint.z}`);
   * ```
   */
  get midPoint(): AcGePoint3d {
    return this._geo.midPoint
  }

  /**
   * Gets the geometric extents (bounding box) of this line.
   *
   * @returns The bounding box that encompasses the entire line
   *
   * @example
   * ```typescript
   * const extents = line.geometricExtents;
   * console.log(`Line bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents(): AcGeBox3d {
    return this._geo.box
  }

  /** @inheritdoc */
  override subGetIntersectCurves(): AcGeIntersectPrimitive[] {
    return [
      {
        kind: 'line',
        line: this._geo.clone(),
        extent: 'bounded'
      }
    ]
  }

  /**
   * Gets whether this line is closed.
   *
   * Lines are always open entities, so this always returns false.
   *
   * @returns Always false for lines
   */
  get closed(): boolean {
    return false
  }

  /** @inheritdoc */
  get area(): number {
    return 0
  }

  /**
   * Returns the full property definition for this line entity, including
   * general group and geometry group.
   *
   * The geometry group exposes editable start/end coordinates via
   * {@link AcDbPropertyAccessor} so the property palette can update
   * the line in real-time.
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
              name: 'startX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.startPoint.x,
                set: (v: number) => {
                  this.startPoint.x = v
                }
              }
            },
            {
              name: 'startY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.startPoint.y,
                set: (v: number) => {
                  this.startPoint.y = v
                }
              }
            },
            {
              name: 'startZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.startPoint.z,
                set: (v: number) => {
                  this.startPoint.z = v
                }
              }
            },
            {
              name: 'endX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.endPoint.x,
                set: (v: number) => {
                  this.endPoint.x = v
                }
              }
            },
            {
              name: 'endY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.endPoint.y,
                set: (v: number) => {
                  this.endPoint.y = v
                }
              }
            },
            {
              name: 'endZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.endPoint.z,
                set: (v: number) => {
                  this.endPoint.z = v
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
            }
          ]
        }
      ]
    }
  }

  /**
   * Gets the grip points for this line.
   *
   * Grip points are control points that can be used to modify the line.
   * For a line, the grip points are the midpoint, start point, and end point.
   *
   * @returns Array of grip points (midpoint, start point, end point)
   *
   * @example
   * ```typescript
   * const gripPoints = line.subGetGripPoints();
   * // gripPoints contains: [midPoint, startPoint, endPoint]
   * ```
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    gripPoints.push(this.midPoint)
    gripPoints.push(this.startPoint)
    gripPoints.push(this.endPoint)
    return gripPoints
  }

  /**
   * Moves grip points for this line.
   *
   * Index 0 moves the midpoint and translates the whole line. Indices 1 and 2
   * move the start and end points respectively.
   */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbForEachGripIndex(indices, index => {
      switch (index) {
        case 0:
          this.transformBy(AcGeMatrix3d.makeTranslation(offset))
          break
        case 1:
          this.startPoint.add(offset)
          break
        case 2:
          this.endPoint.add(offset)
          break
        default:
          break
      }
    })
    return this
  }

  /**
   * Gets the object snap points for this line.
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
    const startPoint = this.startPoint
    const endPoint = this.endPoint

    switch (osnapMode) {
      case AcDbOsnapMode.EndPoint:
        snapPoints.push(startPoint)
        snapPoints.push(endPoint)
        break
      case AcDbOsnapMode.MidPoint:
        snapPoints.push(this.midPoint)
        break
      case AcDbOsnapMode.Nearest:
        // Nearest snap: project the pick point onto the line and return that point
        {
          const projectedPoint = this._geo.project(pickPoint)
          snapPoints.push(projectedPoint)
        }
        break
      case AcDbOsnapMode.Perpendicular:
        // Perpendicular snap: find a perpendicular point from the pick point to the line
        {
          const perpPoint = this._geo.perpPoint(pickPoint)
          snapPoints.push(perpPoint)
        }
        break
      case AcDbOsnapMode.Tangent:
        // N/A for tangent snap
        break
      default:
        break
    }
  }

  /**
   * Transforms this line by the specified matrix.
   *
   * This method applies a geometric transformation to the line, updating
   * both the start and end points according to the transformation matrix.
   *
   * @param matrix - The transformation matrix to apply
   * @returns This line after transformation
   *
   * @example
   * ```typescript
   * const translationMatrix = AcGeMatrix3d.translation(10, 0, 0);
   * line.transformBy(translationMatrix);
   * // Line is now translated 10 units in the X direction
   * ```
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._geo.transform(matrix)
    return this
  }

  /**
   * This line always draws as a single `lineStrip` primitive.
   *
   * @internal
   */
  override get directBatchPrimitive() {
    return 'lineStrip' as const
  }

  /**
   * Draws this line using the specified renderer.
   *
   * This method renders the line as a series of connected line segments
   * using the line's current style properties.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered line entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const start = this.startPoint
    const end = this.endPoint
    const points = [
      new AcGePoint3d(start.x, start.y, 0),
      new AcGePoint3d(end.x, end.y, 0)
    ]
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
    filer.writeSubclassMarker('AcDbLine')
    if (this.thickness !== 0) {
      filer.writeDouble(39, this.thickness)
    }
    const startOcs = acgeTransformWcsPointToOcs(this.startPoint, this.normal)
    const endOcs = acgeTransformWcsPointToOcs(this.endPoint, this.normal)
    filer.writePoint3d(10, startOcs)
    filer.writePoint3d(11, endOcs)
    filer.writeVector3d(210, this.normal)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbLine')

    // Literal defaults instead of reading `this.startPoint`/`endPoint`/`normal`:
    // those getters materialize the lazy `_geo` (an `AcGeLine3d` plus two
    // points) that the assignment at the end of this method replaces
    // immediately, allocating one throwaway geometry per LINE (~390k on a
    // large drawing). The defaults below are the values a freshly constructed
    // line exposes.
    let x1 = 0
    let y1 = 0
    let z1 = 0
    let x2 = 0
    let y2 = 0
    let z2 = 0
    let thickness = this.thickness
    let nx = 0
    let ny = 0
    let nz = 1

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 10:
          x1 = n
          break
        case 20:
          y1 = n
          break
        case 30:
          z1 = n
          break
        case 11:
          x2 = n
          break
        case 21:
          y2 = n
          break
        case 31:
          z2 = n
          break
        case 39:
          thickness = n
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

    // Skip the (dominant) identity normal: `normalize()` on the already unit
    // +Z vector is a no-op, and DXF group 210 is +Z for the vast majority of
    // lines. Only a non-identity normal materializes `_normal`; the identity
    // case hands the frozen `Z_AXIS` to the read-only OCS transform below so
    // no vector is allocated for the entity at all.
    let normal: AcGeVector3dLike = AcGeVector3d.Z_AXIS
    if (nx !== 0 || ny !== 0 || nz !== 1) {
      if (nx * nx + ny * ny + nz * nz > 0) {
        normal = this.normal.set(nx, ny, nz).normalize()
      }
    }
    this.thickness = thickness
    _dxfInOcsPoint.set(x1, y1, z1)
    acgeTransformOcsPointToWcsInto(_dxfInPointA, _dxfInOcsPoint, normal)
    _dxfInOcsPoint.set(x2, y2, z2)
    acgeTransformOcsPointToWcsInto(_dxfInPointB, _dxfInOcsPoint, normal)
    this._geo = new AcGeLine3d(_dxfInPointA, _dxfInPointB)
    return this
  }

  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const geo = this._geo.offset(offsetDist)
    return [new AcDbLine(geo.startPoint, geo.endPoint)]
  }

  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const s = this.startPoint
    const e = this.endPoint
    return (e.x - s.x) * (point.y - s.y) - (e.y - s.y) * (point.x - s.x) >= 0
      ? 1
      : -1
  }
}

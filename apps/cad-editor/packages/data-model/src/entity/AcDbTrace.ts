import {
  AcGeArea2d,
  AcGeBox3d,
  AcGeIntersectPrimitive,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePointLike,
  AcGePolyline2d,
  acgeTransformOcsPointToWcs,
  acgeTransformWcsPointToOcs,
  AcGeVector3d,
  AcGeVector3dLike} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { acdbMovePointArrayGripAt } from './AcDbGripHelpers'
import { acdbIntersectPrimitivesFromPointPath } from './AcDbIntersectHelpers'
import { acdbCollectVertexPathOsnapPoints } from './AcDbOsnapHelpers'
import { acdbOffsetVertexPathAsPolyline,AcDbPolyline } from './AcDbPolyline'

/**
 * Represents a trace entity in AutoCAD.
 *
 * A trace is a 3D geometric object that represents a filled four-sided polygon.
 * It is typically used to create trace-like shapes and can be visualized as a
 * "filled polyline" with four vertices, where each edge connects two consecutive points.
 *
 * This entity was more commonly used in earlier versions of AutoCAD, especially before
 * the introduction of more advanced entities like solid and hatches. Today, it's not
 * as commonly used since solid provides similar capabilities with more flexibility.
 *
 * @example
 * ```typescript
 * // Create a trace entity
 * const trace = new AcDbTrace();
 * trace.setPointAt(0, new AcGePoint3d(0, 0, 0));
 * trace.setPointAt(1, new AcGePoint3d(10, 0, 0));
 * trace.setPointAt(2, new AcGePoint3d(10, 5, 0));
 * trace.setPointAt(3, new AcGePoint3d(0, 5, 0));
 *
 * // Access trace properties
 * console.log(`Elevation: ${trace.elevation}`);
 * console.log(`Thickness: ${trace.thickness}`);
 * ```
 */
export class AcDbTrace extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = 'Trace'

  override get dxfTypeName() {
    return 'TRACE'
  }

  /** The elevation (Z-coordinate) of the trace plane */
  private _elevation: number
  /** The four vertices of the trace */
  private _vertices: [AcGePoint3d, AcGePoint3d, AcGePoint3d, AcGePoint3d]
  /** The thickness (extrusion) of the trace */
  private _thickness: number
  /** Extrusion / plane normal (DXF group 210) */
  private _normal = new AcGeVector3d(0, 0, 1)

  /**
   * Creates a new trace entity.
   *
   * This constructor initializes a trace with default values.
   * All vertices are set to the origin, elevation is 0, and thickness is 0.
   *
   * @example
   * ```typescript
   * const trace = new AcDbTrace();
   * // Set the four vertices to create a rectangle
   * trace.setPointAt(0, new AcGePoint3d(0, 0, 0));
   * trace.setPointAt(1, new AcGePoint3d(10, 0, 0));
   * trace.setPointAt(2, new AcGePoint3d(10, 5, 0));
   * trace.setPointAt(3, new AcGePoint3d(0, 5, 0));
   * ```
   */
  constructor() {
    super()
    this._elevation = 0
    this._thickness = 0
    this._vertices = [
      new AcGePoint3d(),
      new AcGePoint3d(),
      new AcGePoint3d(),
      new AcGePoint3d()
    ]
  }

  /**
   * Gets the elevation of this trace.
   *
   * The elevation is the distance of the trace's plane from the WCS origin
   * along the Z-axis.
   *
   * @returns The elevation value
   *
   * @example
   * ```typescript
   * const elevation = trace.elevation;
   * console.log(`Trace elevation: ${elevation}`);
   * ```
   */
  get elevation(): number {
    return this._elevation
  }

  /**
   * Sets the elevation of this trace.
   *
   * @param value - The new elevation value
   *
   * @example
   * ```typescript
   * trace.elevation = 10;
   * ```
   */
  set elevation(value: number) {
    this._elevation = value
  }

  /**
   * Gets whether this trace is closed.
   *
   * Traces are always closed entities, so this always returns true.
   *
   * @returns Always true for traces
   */
  get closed(): boolean {
    return true
  }

  /** @inheritdoc */
  override get area(): number {
    const polyline = new AcGePolyline2d(
      AcDbTrace.boundaryPointsFromVertices(this._vertices),
      true
    )
    return polyline.area
  }

  /**
   * Gets the thickness of this trace.
   *
   * The thickness is the trace's dimension along its normal vector direction
   * (sometimes called the extrusion direction).
   *
   * @returns The thickness value
   *
   * @example
   * ```typescript
   * const thickness = trace.thickness;
   * console.log(`Trace thickness: ${thickness}`);
   * ```
   */
  get thickness() {
    return this._thickness
  }

  /**
   * Sets the thickness of this trace.
   *
   * @param value - The new thickness value
   *
   * @example
   * ```typescript
   * trace.thickness = 2.0;
   * ```
   */
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
   * Gets the point at the specified index in this trace.
   *
   * The index can be 0, 1, 2, or 3, representing the four vertices of the trace.
   * If the index is out of range, it returns the first or last vertex accordingly.
   *
   * @param index - The index (0-3) of the vertex to get
   * @returns The point at the specified index in WCS coordinates
   *
   * @example
   * ```typescript
   * const point0 = trace.getPointAt(0);
   * const point1 = trace.getPointAt(1);
   * console.log(`Vertex 0: ${point0.x}, ${point0.y}, ${point0.z}`);
   * ```
   */
  getPointAt(index: number): AcGePoint3d {
    if (index < 0) return this._vertices[0]
    if (index > 3) return this._vertices[3]
    return this._vertices[index]
  }

  /**
   * Sets the point at the specified index in this trace.
   *
   * The index must be 0, 1, 2, or 3, representing the four vertices of the trace.
   * If the index is out of range, it sets the first or last vertex accordingly.
   *
   * @param index - The index (0-3) of the vertex to set
   * @param point - The new point in WCS coordinates
   *
   * @example
   * ```typescript
   * trace.setPointAt(0, new AcGePoint3d(0, 0, 0));
   * trace.setPointAt(1, new AcGePoint3d(10, 0, 0));
   * trace.setPointAt(2, new AcGePoint3d(10, 5, 0));
   * trace.setPointAt(3, new AcGePoint3d(0, 5, 0));
   * ```
   */
  setPointAt(index: number, point: AcGePointLike) {
    if (index < 0) this._vertices[0].copy(point)
    if (index > 3) return this._vertices[3].copy(point)
    this._vertices[index].copy(point)
  }

  /**
   * Gets the geometric extents (bounding box) of this trace.
   *
   * @returns The bounding box that encompasses the entire trace
   *
   * @example
   * ```typescript
   * const extents = trace.geometricExtents;
   * console.log(`Trace bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents(): AcGeBox3d {
    return new AcGeBox3d().setFromPoints(this._vertices)
  }

  /** @inheritdoc */
  override subGetIntersectCurves(): AcGeIntersectPrimitive[] {
    const v0 = this._vertices[0]
    const v1 = this._vertices[1]
    const v2 = this._vertices[2]
    const v3 = this._vertices[3]
    return acdbIntersectPrimitivesFromPointPath([v0, v1, v3, v2], true)
  }

  /**
   * Gets the grip points for this trace.
   *
   * Grip points are control points that can be used to modify the trace.
   * For a trace, the grip points are all four vertices.
   *
   * @returns Array of grip points (all four vertices)
   *
   * @example
   * ```typescript
   * const gripPoints = trace.subGetGripPoints();
   * // gripPoints contains all four vertices of the trace
   * ```
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    gripPoints.push(...this._vertices)
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbMovePointArrayGripAt(indices, offset, this._vertices)
    return this
  }

  /**
   * Gets the object snap points for this trace.
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
    const perimeter = [
      this._vertices[0],
      this._vertices[1],
      this._vertices[3],
      this._vertices[2]
    ]
    acdbCollectVertexPathOsnapPoints(
      perimeter,
      true,
      osnapMode,
      pickPoint,
      snapPoints
    )
  }

  /**
   * Transforms this trace by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._vertices.forEach(vertex => vertex.applyMatrix4(matrix))
    this._elevation = this._vertices[0].z
    return this
  }

  /**
   * This trace always draws as a single `area` primitive.
   *
   * @internal
   */
  override get directBatchPrimitive() {
    return 'area' as const
  }

  /**
   * Draws this trace using the specified renderer.
   *
   * This method renders the trace as a filled area using the trace's
   * current style properties.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered trace entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const polyline = new AcGePolyline2d(
      AcDbTrace.boundaryPointsFromVertices(this._vertices),
      true
    )
    const area = new AcGeArea2d()
    area.add(polyline)

    const traits = renderer.subEntityTraits
    traits.fillType = {
      solidFill: true,
      patternAngle: 0,
      definitionLines: []
    }
    return renderer.area(area)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbTrace')
    // SOLID/TRACE have no group 38 in the DXF reference; Z lives on corner
    // points (10–13). Writing 38 aborts parsers that stop on unknown codes
    // (e.g. @mlightcad/dxf-json), leaving `points` unset.
    if (this.thickness !== 0) {
      filer.writeDouble(39, this.thickness)
    }
    filer.writePoint3d(10, acgeTransformWcsPointToOcs(this.getPointAt(0), this.normal))
    filer.writePoint3d(11, acgeTransformWcsPointToOcs(this.getPointAt(1), this.normal))
    filer.writePoint3d(12, acgeTransformWcsPointToOcs(this.getPointAt(2), this.normal))
    filer.writePoint3d(13, acgeTransformWcsPointToOcs(this.getPointAt(3), this.normal))
    filer.writeVector3d(210, this.normal)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbTrace')

    const pts = [
      { x: this.getPointAt(0).x, y: this.getPointAt(0).y, z: this.getPointAt(0).z },
      { x: this.getPointAt(1).x, y: this.getPointAt(1).y, z: this.getPointAt(1).z },
      { x: this.getPointAt(2).x, y: this.getPointAt(2).y, z: this.getPointAt(2).z },
      { x: this.getPointAt(3).x, y: this.getPointAt(3).y, z: this.getPointAt(3).z }
    ]
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
        case 11:
        case 12:
        case 13:
          pts[code - 10].x = n
          break
        case 20:
        case 21:
        case 22:
        case 23:
          pts[code - 20].y = n
          break
        case 30:
        case 31:
        case 32:
        case 33:
          pts[code - 30].z = n
          break
        case 39:
          this.thickness = n
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
    pts.forEach((p, i) =>
      this.setPointAt(i, acgeTransformOcsPointToWcs(p, this.normal))
    )
    return this
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetCurves}
   *
   * Offsets the quadrilateral boundary (four corners in vertex order) as a closed
   * {@link AcDbPolyline} in the XY plane.
   */
  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const curve = this.createOffsetCurve(offsetDist)
    return curve ? [curve] : []
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetSideAtPoint}
   *
   * Treats the trace outline as a closed polygon in XY.
   */
  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const path = this.collectBoundary2d()
    if (path.length < 2) return 1
    return AcDbPolyline.from2dPoints(path, true).getOffsetSideAtPoint(point)
  }

  /**
   * @param offsetDist - Signed offset distance in drawing units
   * @returns Offset polyline around the trace boundary, or `null` on failure
   */
  private createOffsetCurve(offsetDist: number): AcDbCurve | null {
    return acdbOffsetVertexPathAsPolyline(
      this.collectBoundary2d(),
      true,
      offsetDist
    )
  }

  /**
   * Projects the four trace corners to a closed 2D loop (codes 10–13 order).
   *
   * @returns XY boundary vertices
   */
  private collectBoundary2d(): AcGePoint2d[] {
    return AcDbTrace.boundaryPointsFromVertices(this._vertices)
  }

  /**
   * Builds the closed 2D boundary for TRACE/SOLID entities.
   *
   * DXF stores corners 10–13 as two opposite edges (1–2 and 3–4), not as a
   * sequential perimeter. The filled outline follows 1 → 2 → 4 → 3.
   */
  static boundaryPointsFromVertices(
    vertices: ReadonlyArray<AcGePoint3dLike>
  ): AcGePoint2d[] {
    const v0 = vertices[0]
    const v1 = vertices[1]
    const v2 = vertices[2]
    const v3 = vertices[3]
    return [
      new AcGePoint2d(v0.x, v0.y),
      new AcGePoint2d(v1.x, v1.y),
      new AcGePoint2d(v3.x, v3.y),
      new AcGePoint2d(v2.x, v2.y)
    ]
  }
}

import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGePolyline2dVertex,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbForEachGripIndex } from './AcDbGripHelpers'
import {
  acdbCollectLineSegmentOsnapPoints,
  acdbPickNearestOsnapPoint
} from './AcDbOsnapHelpers'
import { AcDbPolyline } from './AcDbPolyline'

/**
 * Represents the spline-fit type for this 3D polyline.
 */
export enum AcDbPoly3dType {
  /**
   * A standard polyline with no spline fitting.
   */
  SimplePoly,
  /**
   * A spline-fit polyline that has a Quadratic B-spline path.
   */
  QuadSplinePoly,
  /**
   * A spline-fit polyline that has a Cubic B-spline path.
   */
  CubicSplinePoly
}

/**
 * Represents a 3d polyline entity in AutoCAD.
 */
export class AcDb3dPolyline extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = '3dPolyline'

  override get dxfTypeName() {
    return 'POLYLINE'
  }

  /** The spline-fit type for this 3D polyline */
  private _polyType: AcDbPoly3dType
  /** The underlying geometric polyline object */
  private _geo: AcGePolyline2d<AcGePolyline2dVertex>

  /**
   * Creates a new empty 2d polyline entity.
   */
  constructor(
    type: AcDbPoly3dType,
    vertices: AcGePoint3dLike[],
    closed = false
  ) {
    super()
    this._polyType = type
    this._geo = new AcGePolyline2d(vertices, closed)
  }

  /**
   * Gets the spline-fit type for this 3D polyline.
   *
   * @returns The spline-fit type for this 3D polyline.
   */
  get polyType(): AcDbPoly3dType {
    return this._polyType
  }

  /**
   * Sets the spline-fit type for this 3D polyline.
   *
   * @param value - The spline-fit type for this 3D polyline.
   */
  set polyType(value: AcDbPoly3dType) {
    this._polyType = value
  }

  /**
   * Gets whether this polyline is closed.
   *
   * A closed polyline has a segment drawn from the last vertex to the first vertex,
   * forming a complete loop.
   *
   * @returns True if the polyline is closed, false otherwise
   *
   * @example
   * ```typescript
   * const isClosed = polyline.closed;
   * console.log(`Polyline is closed: ${isClosed}`);
   * ```
   */
  get closed(): boolean {
    return this._geo.closed
  }

  /** @inheritdoc */
  get area(): number {
    return 0
  }

  /**
   * Sets whether this polyline is closed.
   *
   * @param value - True to close the polyline, false to open it
   *
   * @example
   * ```typescript
   * polyline.closed = true; // Close the polyline
   * ```
   */
  set closed(value: boolean) {
    this._geo.closed = value
  }

  get numberOfVertices() {
    return this._geo.numberOfVertices
  }

  getPointAt(index: number) {
    const vertex = this._geo.vertices[index] as AcGePolyline2dVertex &
      AcGePoint3dLike
    return new AcGePoint3d(vertex.x, vertex.y, vertex.z || 0)
  }

  /**
   * Gets the geometric extents (bounding box) of this polyline.
   *
   * @returns The bounding box that encompasses the entire polyline
   *
   * @example
   * ```typescript
   * const extents = polyline.geometricExtents;
   * console.log(`Polyline bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents(): AcGeBox3d {
    const points = this._geo.vertices.map(
      vertex =>
        new AcGePoint3d(vertex.x, vertex.y, (vertex as AcGePoint3dLike).z || 0)
    )
    return new AcGeBox3d().setFromPoints(points)
  }

  /**
   * Gets the grip points for this polyline.
   *
   * Grip points are control points that can be used to modify the polyline.
   * For a polyline, the grip points are all the vertices.
   *
   * @returns Array of grip points (all vertices)
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    for (let i = 0; i < this._geo.numberOfVertices; ++i) {
      gripPoints.push(this.getPointAt(i))
    }
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbForEachGripIndex(indices, index => {
      this.moveVertexAt(index, offset)
    })
    return this
  }

  /**
   * Gets the object snap points for this polyline.
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
    const vertices = Array.from(
      { length: this._geo.numberOfVertices },
      (_, i) => this.getPointAt(i)
    )
    if (vertices.length === 0) return

    switch (osnapMode) {
      case AcDbOsnapMode.EndPoint:
        snapPoints.push(...vertices)
        break
      case AcDbOsnapMode.MidPoint:
      case AcDbOsnapMode.Nearest:
      case AcDbOsnapMode.Perpendicular: {
        const candidates: AcGePoint3d[] = []
        for (let index = 0; index < vertices.length - 1; index++) {
          const segmentSnaps: AcGePoint3d[] = []
          acdbCollectLineSegmentOsnapPoints(
            vertices[index],
            vertices[index + 1],
            osnapMode,
            pickPoint,
            segmentSnaps
          )
          candidates.push(...segmentSnaps)
        }
        if (osnapMode === AcDbOsnapMode.MidPoint) {
          snapPoints.push(...candidates)
        } else {
          const nearest = acdbPickNearestOsnapPoint(pickPoint, candidates)
          if (nearest) snapPoints.push(nearest)
        }
        break
      }
      default:
        break
    }
  }

  /**
   * Transforms this 3D polyline by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._geo.vertices.forEach(vertex => {
      const transformedPoint = new AcGePoint3d(
        vertex.x,
        vertex.y,
        (vertex as AcGePoint3dLike).z || 0
      ).applyMatrix4(matrix)
      vertex.x = transformedPoint.x
      vertex.y = transformedPoint.y
      ;(vertex as AcGePoint3dLike).z = transformedPoint.z
    })
    ;(
      this._geo as AcGePolyline2d<AcGePolyline2dVertex> & {
        _boundingBoxNeedsUpdate: boolean
      }
    )._boundingBoxNeedsUpdate = true
    return this
  }

  /**
   * Returns the full property definition for this polyline entity, including
   * general group and geometry group.
   *
   * The geometry group exposes properties via {@link AcDbPropertyAccessor} so
   * the property palette can update the polyline in real-time.
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
              name: 'vertices',
              type: 'array',
              editable: false,
              itemSchema: {
                properties: [
                  {
                    name: 'x',
                    type: 'float',
                    editable: true
                  },
                  {
                    name: 'y',
                    type: 'float',
                    editable: true
                  },
                  {
                    name: 'z',
                    type: 'float',
                    editable: true
                  }
                ]
              },
              accessor: {
                get: () => this._geo.vertices
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
        },
        {
          groupName: 'others',
          properties: [
            {
              name: 'closed',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.closed,
                set: (v: boolean) => {
                  this.closed = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Draws this polyline using the specified renderer.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered polyline entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const points = this._geo.vertices.map(
      vertex =>
        new AcGePoint3d(vertex.x, vertex.y, (vertex as AcGePoint3dLike).z || 0)
    )
    return renderer.lines(points)
  }

  /**
   * Writes the DXF record for the polyline, plus VERTEX/SEQEND records.
   *
   * The extra records are required by the legacy POLYLINE entity format.
   *
   * @param filer - DXF output writer.
   * @param allXdata - When true, emits all XData attached to this entity.
   * @returns The entity instance (for chaining).
   */
  /**
   * Writes this object to the DXF output.
   *
   * @param filer - DXF output writer.
   * @param allXdata - When true, emits all XData attached to this object.
   * @returns The instance (for chaining).
   */
  override dxfOut(filer: AcDbDxfFiler, allXdata = false) {
    super.dxfOut(filer, allXdata)
    for (let i = 0; i < this.numberOfVertices; ++i) {
      const point = this.getPointAt(i)
      filer.writeStart('VERTEX')
      filer.writeHandle(5, this.database.generateHandle())
      filer.writeObjectId(330, this.objectId)
      filer.writeSubclassMarker('AcDbEntity')
      filer.writeSubclassMarker('AcDbVertex')
      filer.writeSubclassMarker('AcDb3dPolylineVertex')
      filer.writePoint3d(10, {
        x: point.x,
        y: point.y,
        z: point.z
      })
      filer.writeInt16(70, 32)
    }
    filer.writeStart('SEQEND')
    filer.writeHandle(5, this.database.generateHandle())
    filer.writeObjectId(330, this.objectId)
    filer.writeSubclassMarker('AcDbEntity')
    return this
  }

  /**
   * Writes the POLYLINE entity fields (header) for a 3D polyline.
   *
   * @param filer - DXF output writer.
   * @returns The entity instance (for chaining).
   */
  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDb3dPolyline')
    let flag = this.closed ? 1 : 0
    flag |= 8
    if (this.polyType === AcDbPoly3dType.QuadSplinePoly) flag |= 16
    if (this.polyType === AcDbPoly3dType.CubicSplinePoly) flag |= 32
    filer.writeInt16(66, this.numberOfVertices > 0 ? 1 : 0)
    filer.writeInt16(70, flag)
    return this
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetCurves}
   *
   * Offsets the XY projection of the 3D path, then restores elevation on each result
   * vertex by interpolating Z from the original polyline segments.
   */
  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const curve = this.createOffsetCurve(offsetDist)
    return curve ? [curve] : []
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetSideAtPoint}
   *
   * Uses the sampled 2D projection of this polyline for the side test.
   */
  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const path = this.collectPath2d()
    if (path.length < 2) return 1
    return AcDbPolyline.from2dPoints(path, this.closed).getOffsetSideAtPoint(
      point
    )
  }

  /**
   * Offsets in XY and lifts vertices back to 3D with {@link interpolateZ}.
   *
   * @param offsetDist - Signed offset distance in drawing units
   * @returns A new 3D polyline with the same spline-fit type and closed flag, or `null`
   * when offsetting fails
   */
  private createOffsetCurve(offsetDist: number): AcDb3dPolyline | null {
    const results = this._geo.offset(offsetDist)
    if (results.length === 0) return null

    const offsetPolyline = results[0]
    const vertices: AcGePoint3dLike[] = []
    for (let i = 0; i < offsetPolyline.numberOfVertices; i++) {
      const point2d = offsetPolyline.getPointAt(i)
      vertices.push(
        new AcGePoint3d(
          point2d.x,
          point2d.y,
          this.interpolateZ(point2d.x, point2d.y)
        )
      )
    }
    return new AcDb3dPolyline(this.polyType, vertices, this.closed)
  }

  /**
   * Samples the underlying geometry into a 2D path used for planar offset.
   *
   * @returns XY points along the 3D polyline projection
   */
  private collectPath2d(): AcGePoint2d[] {
    const sampleCount = Math.max(32, this.numberOfVertices * 4)
    return this._geo.getPoints(sampleCount)
  }

  /**
   * Estimates the Z coordinate at a planar point by projecting onto the original segments.
   *
   * For each segment (respecting {@link closed}), finds the closest point in XY and
   * linearly interpolates Z between the segment endpoints. Used when promoting a 2D
   * offset polyline back to {@link AcDb3dPolyline}.
   *
   * @param x - X coordinate in WCS
   * @param y - Y coordinate in WCS
   * @returns Interpolated elevation, or `0` when the polyline has no vertices
   */
  private interpolateZ(x: number, y: number): number {
    const count = this.numberOfVertices
    if (count <= 0) return 0

    let bestDist = Infinity
    let bestZ = this.getPointAt(0).z
    const segCount = this.closed ? count : count - 1
    for (let i = 0; i < segCount; i++) {
      const a = this.getPointAt(i)
      const b = this.getPointAt((i + 1) % count)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      const t = Math.max(
        0,
        Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)
      )
      const px = a.x + dx * t
      const py = a.y + dy * t
      const dist = (x - px) ** 2 + (y - py) ** 2
      if (dist < bestDist) {
        bestDist = dist
        bestZ = a.z + (b.z - a.z) * t
      }
    }
    return bestZ
  }

  private moveVertexAt(index: number, offset: AcGeVector3dLike) {
    const vertex = this._geo.vertices[index]
    if (!vertex) return
    vertex.x += offset.x
    vertex.y += offset.y
    const point = vertex as AcGePoint3dLike
    point.z = (point.z ?? 0) + (offset.z ?? 0)
  }
}

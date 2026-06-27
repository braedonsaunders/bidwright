import {
  AcGeArea2d,
  AcGeBox3d,
  AcGeCircArc2d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGePolyline2dVertex,
  AcGeVector3dLike,
  offsetVertexPath
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbSystemVariables } from '../database/AcDbSystemVariables'
import { AcDbSysVarManager } from '../database/AcDbSysVarManager'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import {
  acdbForEachGripIndex,
  acdbMovePolyline2dVertexAt
} from './AcDbGripHelpers'
import {
  acdbCollectPolyline2dSegmentOsnapPoints,
  acdbPickNearestOsnapPoint
} from './AcDbOsnapHelpers'

/**
 * Represents one vertex of a polyline entity in AutoCAD.
 *
 * A polyline vertex extends the basic vertex with additional properties
 * for width control and bulge (arc segments).
 */
interface AcDbPolylineVertex extends AcGePolyline2dVertex {
  /** The starting width at this vertex */
  startWidth?: number
  /** The ending width at this vertex */
  endWidth?: number
}

/**
 * Represents a polyline entity in AutoCAD.
 *
 * A polyline is a complex geometric object composed of connected line segments
 * and/or arc segments. Polylines can have:
 * - Straight line segments
 * - Bulge (arc segments) between vertices
 * - Constant and variable width
 * - Thickness
 * - Multiple vertices
 *
 * Polylines are commonly used for creating complex shapes, paths, and boundaries
 * in drawings.
 *
 * @example
 * ```typescript
 * // Create a polyline
 * const polyline = new AcDbPolyline();
 *
 * // Add vertices to create a rectangle
 * polyline.addVertexAt(0, new AcGePoint2d(0, 0));
 * polyline.addVertexAt(1, new AcGePoint2d(10, 0));
 * polyline.addVertexAt(2, new AcGePoint2d(10, 5));
 * polyline.addVertexAt(3, new AcGePoint2d(0, 5));
 * polyline.closed = true; // Close the polyline
 *
 * // Access polyline properties
 * console.log(`Number of vertices: ${polyline.numberOfVertices}`);
 * console.log(`Is closed: ${polyline.closed}`);
 * ```
 */
export class AcDbPolyline extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = 'Polyline'

  override get dxfTypeName() {
    return 'LWPOLYLINE'
  }

  /** The elevation (Z-coordinate) of the polyline plane */
  private _elevation: number
  /** The underlying geometric polyline object */
  private _geo: AcGePolyline2d<AcDbPolylineVertex>

  /**
   * Creates a new empty polyline entity.
   *
   * This constructor initializes an empty polyline with no vertices.
   * Vertices can be added using the addVertexAt method.
   *
   * @example
   * ```typescript
   * const polyline = new AcDbPolyline();
   * // Add vertices as needed
   * polyline.addVertexAt(0, new AcGePoint2d(0, 0));
   * ```
   */
  constructor() {
    super()
    this._elevation = 0
    this._geo = new AcGePolyline2d()
  }

  /**
   * Gets the number of vertices in this polyline.
   *
   * @returns The number of vertices
   *
   * @example
   * ```typescript
   * const vertexCount = polyline.numberOfVertices;
   * console.log(`Polyline has ${vertexCount} vertices`);
   * ```
   */
  get numberOfVertices(): number {
    return this._geo.numberOfVertices
  }

  /**
   * Gets the elevation of this polyline.
   *
   * The elevation is the distance of the polyline's plane from the WCS origin
   * along the Z-axis.
   *
   * @returns The elevation value
   *
   * @example
   * ```typescript
   * const elevation = polyline.elevation;
   * console.log(`Polyline elevation: ${elevation}`);
   * ```
   */
  get elevation(): number {
    return this._elevation
  }

  /**
   * Sets the elevation of this polyline.
   *
   * @param value - The new elevation value
   *
   * @example
   * ```typescript
   * polyline.elevation = 10;
   * ```
   */
  set elevation(value: number) {
    this._elevation = value
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
    return this._geo.area
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

  /**
   * Adds a vertex to this polyline at the specified index.
   *
   * This method inserts a vertex at the specified position. If the index is 0,
   * the vertex becomes the first vertex. If the index equals the number of vertices,
   * the vertex becomes the last vertex. Otherwise, the vertex is inserted before
   * the specified index.
   *
   * @param index - The index (0-based) before which to insert the vertex
   * @param pt - The vertex location point
   * @param bulge - The bulge value for the vertex (0 for straight line, >0 for arc)
   * @param startWidth - The starting width for the vertex (-1 for default)
   * @param endWidth - The ending width for the vertex (-1 for default)
   *
   * @example
   * ```typescript
   * // Add a straight line vertex
   * polyline.addVertexAt(0, new AcGePoint2d(0, 0));
   *
   * // Add a vertex with arc bulge
   * polyline.addVertexAt(1, new AcGePoint2d(5, 0), 0.5);
   *
   * // Add a vertex with custom width
   * polyline.addVertexAt(2, new AcGePoint2d(10, 0), 0, 2, 1);
   * ```
   */
  addVertexAt(
    index: number,
    pt: AcGePoint2d,
    bulge: number = 0,
    startWidth: number = -1,
    endWidth: number = -1
  ) {
    const newStartWidth = startWidth < 0 ? undefined : startWidth
    const newEndWidth = endWidth < 0 ? undefined : endWidth
    const vertex: AcDbPolylineVertex = {
      x: pt.x,
      y: pt.y,
      bulge: bulge,
      startWidth: newStartWidth,
      endWidth: newEndWidth
    }
    this._geo.addVertexAt(index, vertex)
  }

  /**
   * This function removes a vertex from the polyline at the specified index.
   *
   * @param index Input index (0 based) of the vertex to remove
   * @throws Error if the index is out of bounds
   */
  removeVertexAt(index: number) {
    this._geo.removeVertexAt(index)
  }

  /**
   * This function resets the polyline by optionally retaining some vertices.
   * If reuse is true, the numVerts number of vertices are left intact and all vertices
   * beyond that number are deleted. If reuse is false, numVerts is ignored and all
   * existing vertex information will be deleted.
   *
   * @param reuse Input Boolean indicating whether or not to retain some vertices
   * @param numVerts Input number of vertices to retain (only used when reuse is true)
   */
  reset(reuse: boolean, numVerts?: number) {
    this._geo.reset(reuse, numVerts)
  }

  /**
   * Gets the 2D location of a vertex at the specified index.
   *
   * The point is returned in the polyline's own object coordinate system (OCS).
   *
   * @param index - The index (0-based) of the vertex
   * @returns The 2D point location of the vertex
   *
   * @example
   * ```typescript
   * const point2d = polyline.getPoint2dAt(0);
   * console.log(`Vertex 0: ${point2d.x}, ${point2d.y}`);
   * ```
   */
  getPoint2dAt(index: number): AcGePoint2d {
    return this._geo.getPointAt(index)
  }

  /**
   * Gets the 3D location of a vertex at the specified index.
   *
   * The point is returned in World Coordinates, with the Z-coordinate
   * set to the polyline's elevation.
   *
   * @param index - The index (0-based) of the vertex
   * @returns The 3D point location of the vertex
   *
   * @example
   * ```typescript
   * const point3d = polyline.getPoint3dAt(0);
   * console.log(`Vertex 0: ${point3d.x}, ${point3d.y}, ${point3d.z}`);
   * ```
   */
  getPoint3dAt(index: number): AcGePoint3d {
    const vertex = this.getPoint2dAt(index)
    return new AcGePoint3d(vertex.x, vertex.y, this._elevation)
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
    const box = this._geo.box
    return new AcGeBox3d(
      { x: box.min.x, y: box.min.y, z: this._elevation },
      { x: box.max.x, y: box.max.y, z: this._elevation }
    )
  }

  /**
   * Gets the grip points for this polyline.
   *
   * Grip points are control points that can be used to modify the polyline.
   * For a polyline, the grip points are all the vertices. When the **GRIPS**
   * system variable is `2`, midpoint grips are also returned for each segment.
   *
   * @returns Array of grip points (vertices, then optional segment midpoints)
   *
   * @example
   * ```typescript
   * const gripPoints = polyline.subGetGripPoints();
   * // gripPoints contains all vertices of the polyline
   * ```
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    for (let index = 0; index < this.numberOfVertices; ++index) {
      gripPoints.push(this.getPoint3dAt(index))
    }
    if (this.shouldIncludeSegmentMidpointGrips()) {
      this.appendSegmentMidpointGrips(gripPoints)
    }
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    const vertexCount = this.numberOfVertices
    const includeMidpoints = this.shouldIncludeSegmentMidpointGrips()
    const segmentCount = includeMidpoints ? this.getSegmentCount() : 0

    acdbForEachGripIndex(indices, index => {
      if (index < vertexCount) {
        acdbMovePolyline2dVertexAt(this._geo.vertices, index, offset)
        return
      }
      if (!includeMidpoints || index >= vertexCount + segmentCount) {
        return
      }
      const segmentIndex = index - vertexCount
      acdbMovePolyline2dVertexAt(this._geo.vertices, segmentIndex, offset)
      acdbMovePolyline2dVertexAt(
        this._geo.vertices,
        (segmentIndex + 1) % vertexCount,
        offset
      )
    })
    return this
  }

  /**
   * Returns whether segment midpoint grips should be included.
   *
   * Matches AutoCAD **GRIPS** = `2`.
   */
  private shouldIncludeSegmentMidpointGrips() {
    return this.getGripsMode() >= 2
  }

  /**
   * Reads the current **GRIPS** system variable value.
   */
  private getGripsMode() {
    try {
      const value = AcDbSysVarManager.instance().getVar(
        AcDbSystemVariables.GRIPS,
        this.database
      )
      return typeof value === 'number' ? value : 2
    } catch {
      return 2
    }
  }

  /**
   * Returns the number of editable polyline segments.
   */
  private getSegmentCount() {
    const vertexCount = this.numberOfVertices
    if (vertexCount < 2) {
      return 0
    }
    return this.closed ? vertexCount : vertexCount - 1
  }

  /**
   * Appends one midpoint grip for each polyline segment.
   */
  private appendSegmentMidpointGrips(gripPoints: AcGePoint3d[]) {
    const geo = this._geo
    const elevation = this._elevation
    const segmentCount = this.getSegmentCount()
    const vertexCount = geo.numberOfVertices

    for (let index = 0; index < segmentCount; index++) {
      const segmentSnaps: AcGePoint3d[] = []
      acdbCollectPolyline2dSegmentOsnapPoints(
        geo.getPointAt(index),
        geo.getPointAt((index + 1) % vertexCount),
        geo.vertices[index]?.bulge,
        elevation,
        AcDbOsnapMode.MidPoint,
        { x: 0, y: 0, z: 0 },
        segmentSnaps
      )
      gripPoints.push(...segmentSnaps)
    }
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
    const geo = this._geo
    const elevation = this._elevation
    const vertexCount = geo.numberOfVertices
    if (vertexCount === 0) return

    switch (osnapMode) {
      case AcDbOsnapMode.EndPoint:
        for (let index = 0; index < vertexCount; index++) {
          const vertex = geo.getPointAt(index)
          snapPoints.push(new AcGePoint3d(vertex.x, vertex.y, elevation))
        }
        break
      case AcDbOsnapMode.MidPoint:
      case AcDbOsnapMode.Nearest:
      case AcDbOsnapMode.Perpendicular:
      case AcDbOsnapMode.Tangent: {
        const segmentCount = this.closed ? vertexCount : vertexCount - 1
        const candidates: AcGePoint3d[] = []
        for (let index = 0; index < segmentCount; index++) {
          const segmentSnaps: AcGePoint3d[] = []
          acdbCollectPolyline2dSegmentOsnapPoints(
            geo.getPointAt(index),
            geo.getPointAt((index + 1) % vertexCount),
            geo.vertices[index]?.bulge,
            elevation,
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
   * Transforms this polyline by the specified matrix.
   *
   * The lightweight polyline stores 2D vertices plus a shared elevation, so we
   * transform each vertex in 3D and then write the projected XY values back.
   */
  transformBy(matrix: AcGeMatrix3d) {
    const flipBulge = matrix.determinant() < 0
    let elevation = this._elevation

    this._geo.vertices.forEach(vertex => {
      const transformedPoint = new AcGePoint3d(
        vertex.x,
        vertex.y,
        this._elevation
      ).applyMatrix4(matrix)
      vertex.x = transformedPoint.x
      vertex.y = transformedPoint.y
      elevation = transformedPoint.z
      if (flipBulge && vertex.bulge != null) {
        vertex.bulge = -vertex.bulge
      }
    })

    this._elevation = elevation
    ;(
      this._geo as AcGePolyline2d<AcDbPolylineVertex> & {
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
                  }
                ]
              },
              accessor: {
                get: () => this._geo.vertices
              }
            },
            {
              name: 'elevation',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.elevation,
                set: (v: number) => {
                  this.elevation = v
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
   * This method renders the polyline as a series of connected line segments
   * using the polyline's current style properties.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered polyline entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const centerline = this._geo.getPoints(100)
    const widthProfile = this.createWidthProfile()
    if (widthProfile != null) {
      const area = createWidePolylineArea(widthProfile, this.closed)
      if (area != null) {
        const traits = renderer.subEntityTraits
        traits.fillType = {
          solidFill: true,
          patternAngle: 0,
          definitionLines: []
        }
        return renderer.area(area)
      }
    }

    const points: AcGePoint3d[] = []
    centerline.forEach(point =>
      points.push(new AcGePoint3d().set(point.x, point.y, this.elevation))
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
    filer.writeSubclassMarker('AcDbPolyline')
    filer.writeInt32(90, this.numberOfVertices)
    filer.writeInt16(70, this.closed ? 1 : 0)
    filer.writeDouble(38, this.elevation)
    for (let i = 0; i < this.numberOfVertices; ++i) {
      filer.writePoint2d(10, this.getPoint2dAt(i))
    }
    return this
  }

  /**
   * Builds a sampled centerline profile carrying interpolated width values.
   *
   * This method converts polyline vertices (including bulge-based arc segments)
   * into a point list where each sampled point stores:
   * - 2D position on the centerline
   * - Effective width at that position
   *
   * For each segment:
   * - Width starts from the segment start vertex `startWidth`
   * - Width ends at the segment start vertex `endWidth`
   * - Width transitions linearly along sampled points
   *
   * Closed polylines avoid duplicating the seam point; open polylines include
   * full start/end coverage.
   *
   * @returns A width profile suitable for wide-line loop construction, or `null`
   * if the polyline has insufficient geometry or no renderable width.
   */
  private createWidthProfile(): WidePolylinePoint[] | null {
    const vertices = this._geo.vertices
    const count = vertices.length
    if (count < 2) return null

    const segmentCount = this.closed ? count : count - 1
    const points: WidePolylinePoint[] = []
    let hasRenderableWidth = false

    for (let i = 0; i < segmentCount; i++) {
      const startVertex = vertices[i]
      const endVertex = vertices[(i + 1) % count]
      const startWidth = Math.max(0, startVertex.startWidth ?? 0)
      const endWidth = Math.max(0, startVertex.endWidth ?? 0)
      if (startWidth > WIDTH_EPSILON || endWidth > WIDTH_EPSILON) {
        hasRenderableWidth = true
      }

      const sampled = this.sampleSegment(startVertex, endVertex)
      const lastIndex = sampled.length - 1
      for (let j = 0; j <= lastIndex; j++) {
        if (j === 0 && points.length > 0) {
          continue
        }
        if (this.closed && i === segmentCount - 1 && j === lastIndex) {
          continue
        }
        const t = lastIndex > 0 ? j / lastIndex : 0
        points.push({
          x: sampled[j].x,
          y: sampled[j].y,
          width: lerp(startWidth, endWidth, t)
        })
      }
    }

    return hasRenderableWidth && points.length >= 2 ? points : null
  }

  /**
   * Samples one polyline segment into a point sequence.
   *
   * If the start vertex contains a non-zero bulge, this segment is treated as an
   * arc and sampled via {@link AcGeCircArc2d}. Otherwise, the method returns the
   * two segment endpoints as a straight segment.
   *
   * @param startVertex - Segment start vertex. Its `bulge` controls whether arc
   * sampling is used.
   * @param endVertex - Segment end vertex.
   * @returns Sampled points in segment order (start to end), always at least two
   * points for the straight fallback path.
   */
  private sampleSegment(
    startVertex: AcDbPolylineVertex,
    endVertex: AcDbPolylineVertex
  ): AcGePoint2d[] {
    if (startVertex.bulge && Math.abs(startVertex.bulge) > WIDTH_EPSILON) {
      const arc = new AcGeCircArc2d(startVertex, endVertex, startVertex.bulge)
      const sampled = arc.getPoints(32)
      if (sampled.length > 1) {
        return sampled.map(point => new AcGePoint2d(point.x, point.y))
      }
    }
    return [
      new AcGePoint2d(startVertex.x, startVertex.y),
      new AcGePoint2d(endVertex.x, endVertex.y)
    ]
  }

  /**
   * Constructs a temporary {@link AcDbPolyline} from a planar vertex list.
   *
   * Other curve types use this factory when they need polyline offset or side-test
   * behavior without persisting an intermediate entity in the database. Vertices are
   * added in list order with zero bulge; arc segments are not represented.
   *
   * @param points - 2D vertices in WCS (XY), at least one point
   * @param closed - Whether the path forms a closed loop for offset and side tests
   * @returns A new lightweight polyline with the given topology
   */
  static from2dPoints(points: AcGePoint2d[], closed: boolean): AcDbPolyline {
    const polyline = new AcDbPolyline()
    points.forEach((point, index) => polyline.addVertexAt(index, point))
    polyline.closed = closed
    return polyline
  }

  /**
   * Creates a polyline entity from {@link AcGePolyline2d} geometry.
   *
   * @param geo - Source polyline geometry
   * @returns Polyline entity with matching vertices and closed flag
   */
  static fromGePolyline(geo: AcGePolyline2d): AcDbPolyline {
    const polyline = new AcDbPolyline()
    geo.vertices.forEach((vertex, index) => {
      polyline.addVertexAt(
        index,
        new AcGePoint2d(vertex.x, vertex.y),
        vertex.bulge ?? 0
      )
    })
    polyline.closed = geo.closed
    return polyline
  }

  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const curve = this.createOffsetCurve(offsetDist)
    return curve ? [curve] : []
  }

  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const n = this.numberOfVertices
    let bestDist = Infinity
    let bestSide: 1 | -1 = 1
    const segCount = this.closed ? n : n - 1
    for (let i = 0; i < segCount; i++) {
      const a = this.getPoint2dAt(i)
      const b = this.getPoint2dAt((i + 1) % n)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      const t = Math.max(
        0,
        Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)
      )
      const d = (point.x - a.x - t * dx) ** 2 + (point.y - a.y - t * dy) ** 2
      if (d < bestDist) {
        bestDist = d
        bestSide = dx * (point.y - a.y) - dy * (point.x - a.x) >= 0 ? 1 : -1
      }
    }
    return bestSide
  }

  private createOffsetCurve(offsetDist: number): AcDbPolyline | null {
    const results = this._geo.offset(offsetDist)
    if (results.length === 0) return null
    return AcDbPolyline.fromGePolyline(results[0])
  }
}

/**
 * Offsets a planar vertex path using {@link offsetVertexPath} and wraps the
 * result as an {@link AcDbPolyline}.
 *
 * @param points - Sampled or vertex-derived 2D path in WCS (XY)
 * @param closed - Whether the path is treated as a closed polygon for offsetting
 * @param offsetDist - Signed offset distance in drawing units (see {@link AcDbCurve#getOffsetCurves})
 * @returns The first offset polyline, or `null` when the path has fewer than two points
 * or offsetting fails
 */
export function offsetVertexPathAsPolyline(
  points: AcGePoint2d[],
  closed: boolean,
  offsetDist: number
): AcDbPolyline | null {
  const geo = offsetVertexPath(points, closed, offsetDist)
  return geo ? AcDbPolyline.fromGePolyline(geo) : null
}

const WIDTH_EPSILON = 1e-6
const MITER_LIMIT = 4

/**
 * A sampled centerline point with local width used for wide polyline rendering.
 */
interface WidePolylinePoint {
  x: number
  y: number
  width: number
}

/**
 * Builds a renderable filled area for a wide polyline.
 *
 * Open wide polylines are represented as a single stitched shell loop. Closed
 * wide polylines are represented as two loops (outer + inner hole) so the
 * stroke ring does not degenerate into a self-intersecting polygon.
 *
 * @param points - Centerline samples with per-point widths.
 * @param closed - Whether the source polyline is topologically closed.
 * @returns An area ready for fill rendering, or `null` when no valid area can
 * be constructed.
 */
function createWidePolylineArea(points: WidePolylinePoint[], closed: boolean) {
  if (points.length < 2) return null
  const centerline = normalizeCenterline(points, closed)
  if (centerline.length < 2) return null

  const { left, right } = createWidePolylineBoundaries(centerline, closed)
  if (left.length < 2 || right.length < 2) return null

  const area = new AcGeArea2d()
  if (closed) {
    if (!isRenderableLoop(left) || !isRenderableLoop(right)) {
      return null
    }
    const leftArea = Math.abs(calculateSignedArea(left))
    const rightArea = Math.abs(calculateSignedArea(right))
    const [outer, inner] = leftArea >= rightArea ? [left, right] : [right, left]
    area.add(new AcGePolyline2d(outer, true))
    area.add(new AcGePolyline2d(inner, true))
    return area
  }

  const loop = [...left, ...right.reverse()]
  if (!isRenderableLoop(loop)) return null
  area.add(new AcGePolyline2d(loop, true))
  return area
}

/**
 * Computes offset boundaries on the left and right sides of a sampled
 * centerline.
 *
 * @param centerline - Normalized centerline samples with local widths.
 * @param closed - Whether the polyline is topologically closed.
 * @returns Left and right boundary vertices.
 */
function createWidePolylineBoundaries(
  centerline: WidePolylinePoint[],
  closed: boolean
) {
  const left: AcGePolyline2dVertex[] = []
  const right: AcGePolyline2dVertex[] = []
  for (let i = 0; i < centerline.length; i++) {
    const point = centerline[i]
    const halfWidth = Math.max(0, point.width) / 2
    if (halfWidth <= WIDTH_EPSILON) {
      continue
    }
    const offset = computeOffsetDirection(centerline, i, closed)
    if (offset == null) {
      continue
    }
    left.push({
      x: point.x + offset.x * halfWidth,
      y: point.y + offset.y * halfWidth
    })
    right.push({
      x: point.x - offset.x * halfWidth,
      y: point.y - offset.y * halfWidth
    })
  }

  return { left, right }
}

/**
 * Removes redundant centerline samples and normalizes closed-end duplication.
 *
 * Adjacent points that are effectively identical (position and width within
 * epsilon) are collapsed. For closed polylines, a duplicated final point equal
 * to the first point is removed to avoid seam artifacts in offset generation.
 *
 * @param points - Raw sampled centerline points.
 * @param closed - Whether the source polyline is closed.
 * @returns A normalized centerline sample array.
 */
function normalizeCenterline(points: WidePolylinePoint[], closed: boolean) {
  const deduped: WidePolylinePoint[] = []
  points.forEach(point => {
    const last = deduped[deduped.length - 1]
    if (
      !last ||
      Math.abs(last.x - point.x) > WIDTH_EPSILON ||
      Math.abs(last.y - point.y) > WIDTH_EPSILON ||
      Math.abs(last.width - point.width) > WIDTH_EPSILON
    ) {
      deduped.push(point)
    }
  })

  if (closed && deduped.length > 1) {
    const first = deduped[0]
    const last = deduped[deduped.length - 1]
    if (
      Math.abs(first.x - last.x) <= WIDTH_EPSILON &&
      Math.abs(first.y - last.y) <= WIDTH_EPSILON
    ) {
      deduped.pop()
    }
  }
  return deduped
}

/**
 * Computes the lateral offset direction at a centerline point.
 *
 * The direction is based on adjacent segment directions:
 * - Endpoints of open polylines reuse the only available segment direction.
 * - Interior points use a mitered join derived from neighboring left normals.
 * - Miter length is clamped by `MITER_LIMIT` to avoid excessive spikes.
 *
 * @param points - Normalized centerline samples.
 * @param index - Current sample index.
 * @param closed - Whether the polyline is closed.
 * @returns Scaled left-side offset direction, or `null` when direction cannot be
 * determined (for example, fully degenerate local geometry).
 */
function computeOffsetDirection(
  points: WidePolylinePoint[],
  index: number,
  closed: boolean
) {
  const count = points.length
  const point = points[index]
  const prev = points[(index - 1 + count) % count]
  const next = points[(index + 1) % count]
  let prevDir = normalizeDirection(point.x - prev.x, point.y - prev.y)
  let nextDir = normalizeDirection(next.x - point.x, next.y - point.y)

  if (!closed) {
    if (index === 0) prevDir = nextDir
    if (index === count - 1) nextDir = prevDir
  }

  if (prevDir == null && nextDir == null) return null
  if (prevDir == null) return leftNormal(nextDir!)
  if (nextDir == null) return leftNormal(prevDir)

  const prevNormal = leftNormal(prevDir)
  const nextNormal = leftNormal(nextDir)
  const sumX = prevNormal.x + nextNormal.x
  const sumY = prevNormal.y + nextNormal.y
  const sumLength = Math.hypot(sumX, sumY)
  if (sumLength <= WIDTH_EPSILON) {
    return nextNormal
  }

  const miter = { x: sumX / sumLength, y: sumY / sumLength }
  const projection = Math.abs(miter.x * nextNormal.x + miter.y * nextNormal.y)
  const scale =
    projection <= WIDTH_EPSILON
      ? MITER_LIMIT
      : Math.min(1 / projection, MITER_LIMIT)
  return { x: miter.x * scale, y: miter.y * scale }
}

/**
 * Converts a vector into a unit direction.
 *
 * @param dx - X component of the vector.
 * @param dy - Y component of the vector.
 * @returns A normalized vector, or `null` when the input length is too small.
 */
function normalizeDirection(dx: number, dy: number) {
  const length = Math.hypot(dx, dy)
  if (length <= WIDTH_EPSILON) return null
  return { x: dx / length, y: dy / length }
}

/**
 * Computes the left-hand normal of a 2D unit direction.
 *
 * @param direction - Input direction vector.
 * @returns A 90-degree counterclockwise normal.
 */
function leftNormal(direction: { x: number; y: number }) {
  return { x: -direction.y, y: direction.x }
}

/**
 * Calculates signed polygon area using the shoelace formula.
 *
 * Positive sign indicates counterclockwise winding, negative indicates
 * clockwise winding.
 *
 * @param points - Polygon vertices in order.
 * @returns Signed area value.
 */
function calculateSignedArea(points: AcGePolyline2dVertex[]) {
  let area = 0
  const count = points.length
  for (let i = 0; i < count; i++) {
    const p1 = points[i]
    const p2 = points[(i + 1) % count]
    area += p1.x * p2.y - p2.x * p1.y
  }
  return area / 2
}

/**
 * Checks whether a loop can represent a non-degenerate filled polygon.
 *
 * @param points - Loop vertices in order.
 * @returns `true` when the loop encloses non-zero area.
 */
function isRenderableLoop(points: AcGePolyline2dVertex[]) {
  return (
    points.length >= 3 && Math.abs(calculateSignedArea(points)) > WIDTH_EPSILON
  )
}

/**
 * Performs linear interpolation between two scalar values.
 *
 * @param start - Start value at `t = 0`.
 * @param end - End value at `t = 1`.
 * @param t - Interpolation factor in `[0, 1]` (not clamped by this function).
 * @returns Interpolated value.
 */
function lerp(start: number, end: number, t: number) {
  return start + (end - start) * t
}

import {
  AcGeBox3d,
  acgeClosedPolygonArea3d,
  AcGeIntersectPrimitive,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePointLike,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbEntity } from './AcDbEntity'
import { acdbMovePointArrayGripAt } from './AcDbGripHelpers'
import { acdbIntersectPrimitivesFromPointPath } from './AcDbIntersectHelpers'
import { acdbCollectVertexPathOsnapPoints } from './AcDbOsnapHelpers'

/**
 * Represents a three-dimensional surface patch — specifically, a flat polygon that
 * can have three or four vertices (triangular or quadrilateral). It's one of the
 * simplest types of 3D geometry in AutoCAD — used mainly for visual representation
 * of 3D models, not for solid modeling.
 */
export class AcDbFace extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Face'

  override get dxfTypeName() {
    return '3DFACE'
  }

  /** The three or four vertices of the face */
  private _vertices: AcGePoint3d[]
  /** The invisibility of the edges of the face */
  private _edgeInvisibilities: number

  /**
   * Creates a new face entity.
   *
   * This constructor initializes a face with default values.
   * All vertices are set to the origin.
   */
  constructor() {
    super()
    this._vertices = [new AcGePoint3d(), new AcGePoint3d(), new AcGePoint3d()]
    this._edgeInvisibilities = 0
  }

  /**
   * Gets the point at the specified index in this face.
   *
   * The index can be 0, 1, 2, or 3, representing the four vertices of the face.
   * If the index is out of range, it returns the first or last vertex accordingly.
   *
   * @param index - The index (0-3) of the vertex to get
   * @returns The point at the specified index in WCS coordinates
   *
   * @example
   * ```typescript
   * const point0 = face.getVertexAt(0);
   * const point1 = face.getVertexAt(1);
   * console.log(`Vertex 0: ${point0.x}, ${point0.y}, ${point0.z}`);
   * ```
   */
  getVertexAt(index: number): AcGePoint3d {
    if (index < 0) return this._vertices[0]
    if (index >= this._vertices.length) {
      return this._vertices[this._vertices.length - 1]
    }
    return this._vertices[index]
  }

  /**
   * Sets the point at the specified index in this face.
   *
   * The index must be 0, 1, 2, or 3, representing the four vertices of the face.
   * If the index is out of range, it sets the first or last vertex accordingly.
   *
   * @param index - The index (0-3) of the vertex to set
   * @param point - The new point in WCS coordinates
   *
   * @example
   * ```typescript
   * face.setVertexAt(0, new AcGePoint3d(0, 0, 0));
   * face.setVertexAt(1, new AcGePoint3d(10, 0, 0));
   * face.setVertexAt(2, new AcGePoint3d(10, 5, 0));
   * face.setVertexAt(3, new AcGePoint3d(0, 5, 0));
   * ```
   */
  setVertexAt(index: number, point: AcGePointLike) {
    if (index < 0) this._vertices[0].copy(point)
    if (index >= 3) {
      if (this._vertices.length === 3) {
        this._vertices.push(new AcGePoint3d())
      }
      return this._vertices[3].copy(point)
    }
    this._vertices[index].copy(point)
  }

  /**
   * Sets the invisibilities of the edges of the face.
   *
   * The invisibilities are represented as a bitmask, where each bit corresponds to an edge.
   * If the bit is set, the edge is invisible, otherwise it is visible.
   *
   * @param invisibilities - The bitmask representing the invisibilities of the edges
   *
   * @example
   * ```typescript
   * face.setEdgeInvisibilities(0b1111); // All edges are visible
   * face.setEdgeInvisibilities(0b0000); // All edges are invisible
   * face.setEdgeInvisibilities(0b1010); // Edge 0 and 2 are visible, edge 1 and 3 are invisible
   * ```
   */
  setEdgeInvisibilities(invisibilities: number) {
    this._edgeInvisibilities = invisibilities
  }

  /**
   * Checks if the edge at the specified index is visible.
   *
   * The index must be 0, 1, 2, or 3, representing the four edges of the face.
   * If the index is out of range, it throws an error.
   *
   * @param index - The index (0-3) of the edge to check
   * @returns True if the edge is visible, false otherwise
   *
   * @example
   * ```typescript
   * const isVisible = face.isEdgeVisibleAt(0);
   * console.log(`Edge 0 is visible: ${isVisible}`);
   * ```
   */
  isEdgeVisibleAt(index: number): boolean {
    if (index < 0 || index > 3) {
      throw new Error('Index out of range')
    }
    return (this._edgeInvisibilities & (1 << index)) === 0
  }

  /**
   * Makes the edge at the specified index invisible.
   *
   * The index must be 0, 1, 2, or 3, representing the four edges of the face.
   * If the index is out of range, it throws an error.
   *
   * @param index - The index (0-3) of the edge to make invisible
   *
   * @example
   * ```typescript
   * face.makeEdgeInvisibleAt(0);
   * face.makeEdgeInvisibleAt(1);
   * face.makeEdgeInvisibleAt(2);
   * face.makeEdgeInvisibleAt(3);
   * ```
   */
  makeEdgeInvisibleAt(index: number) {
    if (index < 0 || index > 3) {
      throw new Error('Index out of range')
    }
    this._edgeInvisibilities = this._edgeInvisibilities | (1 << index)
  }

  /**
   * Gets the geometric extents (bounding box) of this face.
   *
   * @returns The bounding box that encompasses the entire face
   *
   * @example
   * ```typescript
   * const extents = face.geometricExtents;
   * console.log(`Trace bounds: ${extents.minPoint} to ${extents.maxPoint}`);
   * ```
   */
  get geometricExtents(): AcGeBox3d {
    return new AcGeBox3d().setFromPoints(this._vertices)
  }

  /** @inheritdoc */
  override subGetIntersectCurves(): AcGeIntersectPrimitive[] {
    return acdbIntersectPrimitivesFromPointPath(this._vertices, true)
  }

  /**
   * The area of this planar face. Degenerate faces return `0`.
   */
  get area(): number {
    const points = [
      this.getVertexAt(0),
      this.getVertexAt(1),
      this.getVertexAt(2)
    ]
    const fourth = this.getVertexAt(3)
    if (
      fourth.x !== points[2].x ||
      fourth.y !== points[2].y ||
      fourth.z !== points[2].z
    ) {
      points.push(fourth)
    }
    return acgeClosedPolygonArea3d(points)
  }

  /**
   * Gets the grip points for this face.
   *
   * Grip points are control points that can be used to modify the face.
   * For a face, the grip points are all four vertices.
   *
   * @returns Array of grip points (all four vertices)
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
   * Gets the object snap points for this face.
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
    acdbCollectVertexPathOsnapPoints(
      this._vertices,
      true,
      osnapMode,
      pickPoint,
      snapPoints
    )
  }

  /**
   * Transforms this face by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._vertices.forEach(vertex => vertex.applyMatrix4(matrix))
    return this
  }

  /**
   * This face always draws as a single `lineSegments` primitive.
   *
   * @internal
   */
  override get directBatchPrimitive() {
    return 'lineSegments' as const
  }

  /**
   * Draws this face using the specified renderer.
   *
   * This method renders the face as a filled area using the face's
   * current style properties.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered face entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const num = this._vertices.length
    const buffer = new Float32Array(num * 3)
    const indices: Uint16Array = new Uint16Array(num * 2)
    for (let i = 0; i < num; i++) {
      buffer[i * 3] = this._vertices[i].x
      buffer[i * 3 + 1] = this._vertices[i].y
      buffer[i * 3 + 2] = this._vertices[i].z

      if (this.isEdgeVisibleAt(i)) {
        indices[i * 2] = i
        indices[i * 2 + 1] = (i + 1) % 4
      }
    }
    return renderer.lineSegments(buffer, 3, indices)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    const p0 = this.getVertexAt(0)
    const p1 = this.getVertexAt(1)
    const p2 = this.getVertexAt(2)
    const p3 = this.getVertexAt(3)
    filer.writeSubclassMarker('AcDbFace')
    filer.writePoint3d(10, p0)
    filer.writePoint3d(11, p1)
    filer.writePoint3d(12, p2)
    filer.writePoint3d(13, p3)
    let mask = 0
    for (let i = 0; i < 4; ++i) {
      if (!this.isEdgeVisibleAt(i)) {
        mask |= 1 << i
      }
    }
    filer.writeInt16(70, mask)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbFace')

    // Constructor starts with 3 verts; seed local copies without requiring index 3.
    const pts = [0, 1, 2, 3].map(i => {
      const v = this._vertices[i]
      return v
        ? { x: v.x, y: v.y, z: v.z }
        : { x: 0, y: 0, z: 0 }
    })
    let edgeMask = this._edgeInvisibilities

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
        case 70:
          edgeMask = n
          break
        default:
          break
      }
    }

    pts.forEach((p, i) => this.setVertexAt(i, p))
    this._edgeInvisibilities = edgeMask
    return this
  }
}

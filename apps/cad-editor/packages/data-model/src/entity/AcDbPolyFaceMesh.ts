import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbCurve } from './AcDbCurve'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbForEachGripIndex } from './AcDbGripHelpers'
import { AcDbPolyline, offsetVertexPathAsPolyline } from './AcDbPolyline'

/**
 * Represents a polyface mesh vertex in AutoCAD.
 */
export class AcDbPolyFaceMeshVertex {
  /** The 3D position of the vertex */
  position: AcGePoint3d

  /**
   * Creates a new polyface mesh vertex.
   * @param position The 3D position of the vertex
   */
  constructor(position: AcGePoint3dLike) {
    this.position = new AcGePoint3d(position.x, position.y, position.z || 0)
  }
}

/**
 * Represents a polyface mesh face in AutoCAD.
 */
export class AcDbPolyFaceMeshFace {
  /** The vertex indices for the face */
  vertexIndices: number[]

  /**
   * Creates a new polyface mesh face.
   * @param vertexIndices The vertex indices for the face
   */
  constructor(vertexIndices: number[]) {
    this.vertexIndices = vertexIndices
  }
}

/**
 * Represents a polyface mesh entity in AutoCAD.
 */
export class AcDbPolyFaceMesh extends AcDbCurve {
  /** The entity type name */
  static override typeName: string = 'PolyFaceMesh'

  override get dxfTypeName() {
    return 'POLYLINE'
  }

  /** The vertices of the mesh */
  private _vertices: AcDbPolyFaceMeshVertex[]
  /** The faces of the mesh */
  private _faces: AcDbPolyFaceMeshFace[]

  /**
   * Creates a new polyface mesh entity.
   * @param vertices The vertices of the mesh
   * @param faces The faces of the mesh
   */
  constructor(vertices: AcGePoint3dLike[], faces: number[][]) {
    super()
    this._vertices = vertices.map(v => new AcDbPolyFaceMeshVertex(v))
    this._faces = faces.map(f => new AcDbPolyFaceMeshFace(f))
  }

  /**
   * Gets the number of vertices in the mesh.
   */
  get numberOfVertices(): number {
    return this._vertices.length
  }

  /**
   * Gets the number of faces in the mesh.
   */
  get numberOfFaces(): number {
    return this._faces.length
  }

  /**
   * Gets whether this mesh is closed.
   */
  get closed(): boolean {
    return false
  }

  /** @inheritdoc */
  get area(): number {
    return 0
  }

  /**
   * Sets whether this mesh is closed.
   */
  set closed(_value: boolean) {
    // Polyface mesh doesn't support closed property
  }

  /**
   * Gets the vertex at the specified index.
   * @param index The index of the vertex
   */
  getVertexAt(index: number): AcDbPolyFaceMeshVertex {
    if (index < 0 || index >= this._vertices.length) {
      throw new Error('Vertex index out of bounds')
    }
    return this._vertices[index]
  }

  /**
   * Gets the face at the specified index.
   * @param index The index of the face
   */
  getFaceAt(index: number): AcDbPolyFaceMeshFace {
    if (index < 0 || index >= this._faces.length) {
      throw new Error('Face index out of bounds')
    }
    return this._faces[index]
  }

  /**
   * Gets the geometric extents (bounding box) of this mesh.
   */
  get geometricExtents(): AcGeBox3d {
    if (this._vertices.length === 0) {
      return new AcGeBox3d(new AcGePoint3d(0, 0, 0), new AcGePoint3d(0, 0, 0))
    }

    let minX = Number.MAX_VALUE
    let minY = Number.MAX_VALUE
    let minZ = Number.MAX_VALUE
    let maxX = -Number.MAX_VALUE
    let maxY = -Number.MAX_VALUE
    let maxZ = -Number.MAX_VALUE

    this._vertices.forEach(vertex => {
      minX = Math.min(minX, vertex.position.x)
      minY = Math.min(minY, vertex.position.y)
      minZ = Math.min(minZ, vertex.position.z)
      maxX = Math.max(maxX, vertex.position.x)
      maxY = Math.max(maxY, vertex.position.y)
      maxZ = Math.max(maxZ, vertex.position.z)
    })

    return new AcGeBox3d(
      new AcGePoint3d(minX, minY, minZ),
      new AcGePoint3d(maxX, maxY, maxZ)
    )
  }

  /**
   * Gets the grip points for this mesh.
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    this._vertices.forEach(vertex => {
      gripPoints.push(vertex.position)
    })
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbForEachGripIndex(indices, index => {
      const vertex = this._vertices[index]
      if (vertex) {
        vertex.position.add(offset)
      }
    })
    return this
  }

  /**
   * Gets the object snap points for this mesh.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    _pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    switch (osnapMode) {
      case AcDbOsnapMode.EndPoint:
        this._vertices.forEach(vertex => {
          snapPoints.push(vertex.position)
        })
        break
      default:
        break
    }
  }

  /**
   * Transforms this polyface mesh by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._vertices.forEach(vertex => {
      vertex.position.applyMatrix4(matrix)
    })
    return this
  }

  /**
   * Returns the full property definition for this mesh entity.
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
                get: () =>
                  this._vertices.map(v => ({
                    x: v.position.x,
                    y: v.position.y,
                    z: v.position.z
                  }))
              }
            },
            {
              name: 'faces',
              type: 'array',
              editable: false,
              itemSchema: {
                properties: [
                  {
                    name: 'vertexIndices',
                    type: 'array',
                    editable: false,
                    itemSchema: {
                      properties: [
                        {
                          name: 'index',
                          type: 'int',
                          editable: false
                        }
                      ]
                    }
                  }
                ]
              },
              accessor: {
                get: () =>
                  this._faces.map(f => ({
                    vertexIndices: f.vertexIndices
                  }))
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Draws this mesh using the specified renderer.
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const lines: AcGePoint3d[] = []

    this._faces.forEach(face => {
      const faceVertices: AcGePoint3d[] = []
      face.vertexIndices.forEach(index => {
        // Convert 1-based index to 0-based, ignoring negative indices (which indicate edge visibility)
        const absIndex = Math.abs(index) - 1
        if (absIndex >= 0 && absIndex < this._vertices.length) {
          faceVertices.push(this._vertices[absIndex].position)
        }
      })

      // Draw the face as a closed polygon
      if (faceVertices.length >= 3) {
        for (let i = 0; i < faceVertices.length; i++) {
          const current = faceVertices[i]
          const next = faceVertices[(i + 1) % faceVertices.length]
          lines.push(current)
          lines.push(next)
        }
      }
    })

    return renderer.lines(lines)
  }

  /**
   * Writes DXF fields for this object.
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbPolyFaceMesh')

    const flag = 64 // Polyface mesh flag

    filer.writeInt16(66, 1) // Has vertices
    filer.writeInt16(70, flag)

    return this
  }

  /**
   * Writes this object to the DXF output.
   */
  override dxfOut(filer: AcDbDxfFiler, allXdata = false) {
    super.dxfOut(filer, allXdata)

    // Write vertices
    for (let i = 0; i < this.numberOfVertices; i++) {
      const vertex = this.getVertexAt(i)
      filer.writeStart('VERTEX')
      filer.writeHandle(5, this.database.generateHandle())
      filer.writeObjectId(330, this.objectId)
      filer.writeSubclassMarker('AcDbEntity')
      filer.writeSubclassMarker('AcDbVertex')
      filer.writeSubclassMarker('AcDbPolyFaceMeshVertex')
      filer.writePoint3d(10, vertex.position)
      filer.writeInt16(70, 64) // Polyface mesh vertex flag
    }

    // Write faces
    for (let i = 0; i < this.numberOfFaces; i++) {
      const face = this.getFaceAt(i)
      filer.writeStart('VERTEX')
      filer.writeHandle(5, this.database.generateHandle())
      filer.writeObjectId(330, this.objectId)
      filer.writeSubclassMarker('AcDbEntity')
      filer.writeSubclassMarker('AcDbVertex')
      filer.writeSubclassMarker('AcDbPolyFaceMeshVertex')
      filer.writeInt16(70, 128) // Polyface mesh face flag

      // Write vertex indices
      face.vertexIndices.forEach((index, j) => {
        filer.writeInt32(10 + j, index)
      })
    }

    filer.writeStart('SEQEND')
    filer.writeHandle(5, this.database.generateHandle())
    filer.writeObjectId(330, this.objectId)
    filer.writeSubclassMarker('AcDbEntity')
    return this
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetCurves}
   *
   * Offsets the XY boundary of the largest face in the mesh as a closed
   * {@link AcDbPolyline}. When no face records exist, falls back to all mesh vertices
   * in storage order.
   */
  override getOffsetCurves(offsetDist: number): AcDbCurve[] {
    const curve = this.createOffsetCurve(offsetDist)
    return curve ? [curve] : []
  }

  /**
   * {@inheritDoc AcDbCurve.getOffsetSideAtPoint}
   *
   * Side test uses the same largest-face boundary as {@link getOffsetCurves}.
   */
  override getOffsetSideAtPoint(point: AcGePoint3dLike): 1 | -1 {
    const path = this.collectLargestFaceBoundary2d()
    if (path.length < 2) return 1
    return AcDbPolyline.from2dPoints(path, true).getOffsetSideAtPoint(point)
  }

  /**
   * @param offsetDist - Signed offset distance in drawing units
   * @returns Offset polyline around the dominant face boundary, or `null` on failure
   */
  private createOffsetCurve(offsetDist: number): AcDbCurve | null {
    return offsetVertexPathAsPolyline(
      this.collectLargestFaceBoundary2d(),
      true,
      offsetDist
    )
  }

  /**
   * Selects the face with the most referenced vertices and returns its XY outline.
   *
   * Face vertex indices follow mesh face records; negative indices are ignored. If no
   * suitable face is found, every mesh vertex position is projected to XY in index order.
   *
   * @returns Closed or open 2D loop used for offset approximation
   */
  private collectLargestFaceBoundary2d(): AcGePoint2d[] {
    let bestIndices: number[] = []
    for (const face of this._faces) {
      const indices = face.vertexIndices.filter(index => index >= 0)
      if (indices.length > bestIndices.length) {
        bestIndices = indices
      }
    }
    if (bestIndices.length < 2) {
      return this._vertices.map(
        vertex => new AcGePoint2d(vertex.position.x, vertex.position.y)
      )
    }
    return bestIndices.map(index => {
      const position = this.getVertexAt(index).position
      return new AcGePoint2d(position.x, position.y)
    })
  }
}

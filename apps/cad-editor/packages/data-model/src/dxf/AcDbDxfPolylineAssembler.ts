import type { AcGePoint3dLike } from '@mlightcad/geometry-engine'

import type { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDb2dPolyline, AcDbPoly2dType } from '../entity/AcDb2dPolyline'
import { AcDb3dPolyline, AcDbPoly3dType } from '../entity/AcDb3dPolyline'
import type { AcDbEntity } from '../entity/AcDbEntity'
import { AcDbPolyFaceMesh } from '../entity/AcDbPolyFaceMesh'
import { AcDbPolygonMesh } from '../entity/AcDbPolygonMesh'

/** DXF VERTEX flag: spline frame control point (skip when assembling path). */
const VERTEX_SPLINE_CONTROL_POINT = 16
/** DXF VERTEX flag: polyface mesh vertex/face bit. */
const VERTEX_POLYFACE = 128
/** DXF VERTEX flag: polyface mesh coordinate vertex (with POLYFACE). */
const VERTEX_POLYFACE_MESH_VERTEX = 64

/** DXF POLYLINE smooth surface type (group 75). */
const SMOOTH_QUADRATIC = 5
const SMOOTH_CUBIC = 6

interface PolylineVertexScratch {
  x: number
  y: number
  z: number
  bulge: number
  flag: number
  faces: number[]
}

interface PolylineHeaderScratch {
  objectId?: string
  ownerId?: string
  layer: string
  lineType: string
  colorIndex?: number
  trueColor?: number
  flag: number
  elevation: number
  startWidth: number
  endWidth: number
  meshM: number
  meshN: number
  smoothType: number
}

/**
 * Reads a POLYLINE header + following VERTEX entities until SEQEND and builds
 * the matching AcDb 2d/3d/mesh/polyface polyline (parity with
 * `AcDbEntityConverter.convertPolyline`).
 *
 * Expects the filer positioned just after the `(0, POLYLINE)` pair.
 */
export function acdbDxfInPolyline(filer: AcDbDxfFiler): AcDbEntity | null {
  const header = readPolylineHeader(filer)
  const vertices = readPolylineVertices(filer)
  return assemblePolyline(header, vertices)
}

function readPolylineHeader(filer: AcDbDxfFiler): PolylineHeaderScratch {
  const header: PolylineHeaderScratch = {
    layer: '0',
    lineType: 'ByLayer',
    flag: 0,
    elevation: 0,
    startWidth: 0,
    endWidth: 0,
    meshM: 0,
    meshN: 0,
    smoothType: 0
  }

  while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
    const item = filer.readItem()
    if (!item) break
    const code = Number(item.code)
    const n = Number(item.value)
    switch (code) {
      case 5:
        header.objectId = String(item.value)
        break
      case 330:
        header.ownerId = String(item.value)
        break
      case 8:
        header.layer = String(item.value)
        break
      case 6:
        header.lineType = String(item.value)
        break
      case 62:
        header.colorIndex = n
        break
      case 420:
        header.trueColor = n
        break
      case 70:
        header.flag = n
        break
      case 10:
      case 20:
        // Dummy XY for legacy 2d polyline elevation plane.
        break
      case 30:
        header.elevation = n
        break
      case 40:
        header.startWidth = n
        break
      case 41:
        header.endWidth = n
        break
      case 71:
        header.meshM = n
        break
      case 72:
        header.meshN = n
        break
      case 75:
        header.smoothType = n
        break
      case 100:
        // AcDbEntity / AcDb2dPolyline / AcDb3dPolyline / mesh markers
        break
      default:
        // Tolerate unknown POLYLINE fields until the next object.
        break
    }
  }

  return header
}

function readPolylineVertices(filer: AcDbDxfFiler): PolylineVertexScratch[] {
  const vertices: PolylineVertexScratch[] = []

  while (!filer.atEof) {
    const peek = filer.peekItem()
    if (!peek) break
    if (Number(peek.code) !== 0) {
      filer.readItem()
      continue
    }

    const name = String(peek.value).toUpperCase()
    if (name === 'SEQEND') {
      filer.readItem()
      filer.skipToEndOfObject()
      break
    }
    if (name === 'ENDSEC' || name === 'ENDBLK' || name === 'EOF') {
      break
    }
    if (name !== 'VERTEX') {
      // Unexpected sibling — leave for the caller.
      break
    }

    filer.readItem() // consume (0, VERTEX)
    vertices.push(readOneVertex(filer))
  }

  return vertices
}

function readOneVertex(filer: AcDbDxfFiler): PolylineVertexScratch {
  const vertex: PolylineVertexScratch = {
    x: 0,
    y: 0,
    z: 0,
    bulge: 0,
    flag: 0,
    faces: []
  }
  // Face indices may arrive as 71–74 (AutoCAD) or 10–13 ints (our dxfOut).
  const faceFrom71: number[] = []
  const faceFrom10: number[] = []

  while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
    const item = filer.readItem()
    if (!item) break
    const code = Number(item.code)
    const n = Number(item.value)
    switch (code) {
      case 10:
        vertex.x = n
        faceFrom10[0] = Math.trunc(n)
        break
      case 20:
        vertex.y = n
        break
      case 30:
        vertex.z = n
        break
      case 11:
        faceFrom10[1] = Math.trunc(n)
        break
      case 12:
        faceFrom10[2] = Math.trunc(n)
        break
      case 13:
        faceFrom10[3] = Math.trunc(n)
        break
      case 42:
        vertex.bulge = n
        break
      case 70:
        vertex.flag = n
        break
      case 71:
        faceFrom71[0] = Math.trunc(n)
        break
      case 72:
        faceFrom71[1] = Math.trunc(n)
        break
      case 73:
        faceFrom71[2] = Math.trunc(n)
        break
      case 74:
        faceFrom71[3] = Math.trunc(n)
        break
      default:
        break
    }
  }

  const isFace =
    !!(vertex.flag & VERTEX_POLYFACE) &&
    !(vertex.flag & VERTEX_POLYFACE_MESH_VERTEX)
  if (isFace) {
    const source = faceFrom71.length > 0 ? faceFrom71 : faceFrom10
    vertex.faces = source.filter(v => v !== 0 && v != null)
  }

  return vertex
}

function assemblePolyline(
  header: PolylineHeaderScratch,
  rawVertices: PolylineVertexScratch[]
): AcDbEntity {
  const isClosed = !!(header.flag & 0x01)
  const is3dPolyline = !!(header.flag & 0x08)
  const isPolygonMesh = !!(header.flag & 0x10)
  const isPolyfaceMesh = !!(header.flag & 0x40)
  const isClosedN = !!(header.flag & 0x20)

  const vertices: AcGePoint3dLike[] = []
  const bulges: number[] = []
  const faces: number[][] = []

  for (const vertex of rawVertices) {
    if (vertex.flag & VERTEX_SPLINE_CONTROL_POINT) continue

    if (isPolyfaceMesh && vertex.flag & VERTEX_POLYFACE) {
      if (!(vertex.flag & VERTEX_POLYFACE_MESH_VERTEX)) {
        if (vertex.faces.length >= 3) {
          faces.push([...vertex.faces])
        }
      } else {
        vertices.push({ x: vertex.x, y: vertex.y, z: vertex.z })
        bulges.push(vertex.bulge)
      }
    } else {
      vertices.push({ x: vertex.x, y: vertex.y, z: vertex.z })
      bulges.push(vertex.bulge)
    }
  }

  let entity: AcDbEntity

  if (isPolygonMesh) {
    entity = new AcDbPolygonMesh(
      header.meshM,
      header.meshN,
      vertices,
      isClosed,
      isClosedN
    )
  } else if (isPolyfaceMesh) {
    entity = new AcDbPolyFaceMesh(vertices, faces)
  } else if (is3dPolyline) {
    let polyType = AcDbPoly3dType.SimplePoly
    if (header.flag & 0x04) {
      if (header.smoothType === SMOOTH_CUBIC) {
        polyType = AcDbPoly3dType.CubicSplinePoly
      } else if (header.smoothType === SMOOTH_QUADRATIC) {
        polyType = AcDbPoly3dType.QuadSplinePoly
      }
    }
    entity = new AcDb3dPolyline(polyType, vertices, isClosed)
  } else {
    let polyType = AcDbPoly2dType.SimplePoly
    if (header.flag & 0x02) {
      polyType = AcDbPoly2dType.FitCurvePoly
    } else if (header.flag & 0x04) {
      if (header.smoothType === SMOOTH_CUBIC) {
        polyType = AcDbPoly2dType.CubicSplinePoly
      } else if (header.smoothType === SMOOTH_QUADRATIC) {
        polyType = AcDbPoly2dType.QuadSplinePoly
      }
    }
    entity = new AcDb2dPolyline(
      polyType,
      vertices,
      header.elevation,
      isClosed,
      header.startWidth,
      header.endWidth,
      bulges
    )
  }

  applyCommon(entity, header)
  return entity
}

function applyCommon(entity: AcDbEntity, header: PolylineHeaderScratch) {
  if (header.objectId) entity.objectId = header.objectId
  if (header.ownerId) entity.ownerId = header.ownerId
  entity.layer = header.layer
  entity.lineType = header.lineType
  if (header.colorIndex != null) entity.color.colorIndex = header.colorIndex
  if (header.trueColor != null) entity.color.setRGBValue(header.trueColor)
}

import { AcCmColor, AcCmColorMethod } from '@mlightcad/common'
import {
  AcGeArea2d,
  AcGeCircArc3d,
  AcGeEllipseArc3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGeVector3d,
  AcGeVector3dLike,
  getOcsAngle,
  getOcsReferenceVector,
  TAU,
  transformOcsPointToWcs,
  transformWcsPointToOcs
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiLineWeight,
  AcGiMTextAttachmentPoint,
  AcGiMTextData,
  AcGiMTextFlowDirection,
  AcGiRenderer,
  AcGiStyleType,
  AcGiTextStyle
} from '@mlightcad/graphic-interface'

import type { AcDbDatabase } from '../../database/AcDbDatabase'
import { ByBlock, ByLayer, DEFAULT_TEXT_STYLE } from '../AcDbConstants'
import {
  RAW_COLOR_TYPE_ACI,
  RAW_COLOR_TYPE_BY_BLOCK,
  RAW_COLOR_TYPE_BY_LAYER,
  RAW_COLOR_TYPE_RGB
} from '../AcDbMLeaderStyleColorCodec'
import {
  AcDbProxyGraphicBitStream,
  AcDbProxyGraphicByteStream
} from './AcDbProxyGraphicBinaryStream'

/**
 * Maximum number of bytes written to each DXF group code **310** chunk when
 * exporting proxy graphics.
 *
 * AutoCAD splits large binary payloads into 127-byte hexadecimal records.
 */
export const ACDB_PROXY_GRAPHIC_CHUNK_SIZE = 127

/**
 * Proxy-graphic command type codes defined by ODA and used by ezdxf.
 *
 * Each record in a proxy-graphic stream begins with an 8-byte header
 * `(size, type)` followed by a type-specific payload. Attribute commands affect
 * subsequent geometry; matrix commands push and pop a transform stack.
 */
export enum AcDbProxyGraphicType {
  /** Axis-aligned bounding box extents (type code 1). */
  Extents = 1,
  /** Circle defined by center, radius, and normal (type code 2). */
  Circle = 2,
  /** Circle defined by three points (type code 3). */
  Circle3P = 3,
  /** Circular arc defined by center, radius, normal, start vector, and sweep (type code 4). */
  CircularArc = 4,
  /** Circular arc defined by three points (type code 5). */
  CircularArc3P = 5,
  /** Open polyline or single-point entity (type code 6). */
  Polyline = 6,
  /** Closed polygon, optionally filled (type code 7). */
  Polygon = 7,
  /** Triangle mesh (type code 8). Not currently rendered. */
  Mesh = 8,
  /** Faceted shell rendered as edge segments (type code 9). */
  Shell = 9,
  /** Single-byte text primitive (type code 10). */
  Text = 10,
  /** Extended single-byte text primitive (type code 11). */
  Text2 = 11,
  /** Construction line through two points (type code 12). */
  Xline = 12,
  /** Ray from a base point through a second point (type code 13). */
  Ray = 13,
  /** Sets the ACI color index for subsequent geometry (type code 14). */
  AttributeColor = 14,
  /** Sets the layer by table index for subsequent geometry (type code 16). */
  AttributeLayer = 16,
  /** Sets the linetype by table index for subsequent geometry (type code 18). */
  AttributeLinetype = 18,
  /** Marker attribute reserved by the format (type code 19). */
  AttributeMarker = 19,
  /** Enables or disables solid fill for the next polygon (type code 20). */
  AttributeFill = 20,
  /** Sets true-color or special color encoding (type code 22). */
  AttributeTrueColor = 22,
  /** Sets lineweight for subsequent geometry (type code 23). */
  AttributeLineweight = 23,
  /** Sets linetype scale for subsequent geometry (type code 24). */
  AttributeLtscale = 24,
  /** Sets thickness for subsequent geometry (type code 25). */
  AttributeThickness = 25,
  /** Pushes a 4×4 transform matrix onto the matrix stack (type code 29). */
  PushMatrix = 29,
  /** Pops the top transform matrix off the matrix stack (type code 31). */
  PopMatrix = 31,
  /** Polyline with an appended normal vector (type code 32). */
  PolylineWithNormals = 32,
  /** Lightweight polyline encoded with DWG bit fields (type code 33). */
  LwPolyline = 33,
  /** Unicode text primitive (type code 36). */
  UnicodeText = 36,
  /** Extended Unicode text primitive (type code 38). */
  UnicodeText2 = 38,
  /** Elliptical arc primitive (type code 44). */
  EllipticArc = 44
}

/** World Z axis used as the default entity normal. */
const Z_AXIS = AcGeVector3d.Z_AXIS

/** Maximum raw lineweight value before sign extension is applied. */
const MAX_VALID_LINEWEIGHT = 0x211

/**
 * Options that configure proxy-graphic decoding and rendering context.
 */
interface AcDbProxyGraphicOptions {
  /**
   * Database used to resolve layer and linetype indices and to obtain point
   * display settings (`pdmode`, `pdsize`).
   */
  database?: AcDbDatabase
  /**
   * Drawing version string that selects version-specific field layouts.
   *
   * Example: `'AC1015'`, `'AC1024'`.
   */
  dxfversion?: string
  /**
   * Character encoding for embedded single-byte text commands.
   *
   * When omitted, `'windows-1252'` is used for versions before `'AC1024'`,
   * otherwise `'utf-8'`.
   */
  encoding?: string
  /** Default layer name applied before any {@link AcDbProxyGraphicType.AttributeLayer} command. */
  defaultLayer?: string
}

/**
 * Decodes a packed 32-bit proxy-graphic color value into ACI or RGB parts.
 *
 * @param raw - Packed color dword from an {@link AcDbProxyGraphicType.AttributeTrueColor} chunk.
 * @returns Decoded color index and/or 24-bit RGB value.
 */
function decodeProxyGraphicRawColor(raw: number): {
  colorIndex?: number
  rgb?: number
} {
  const type = (raw >> 24) & 0xff
  if (type === RAW_COLOR_TYPE_RGB) {
    return { rgb: raw & 0xffffff }
  }
  if (type === RAW_COLOR_TYPE_BY_LAYER) {
    return { colorIndex: 256 }
  }
  if (type === RAW_COLOR_TYPE_BY_BLOCK) {
    return { colorIndex: 0 }
  }
  if (type === RAW_COLOR_TYPE_ACI) {
    return { colorIndex: raw & 0xff }
  }
  return { colorIndex: raw & 0xff }
}

/**
 * Converts a {@link AcGeVector3dLike} object to an {@link AcGeVector3d}.
 *
 * @param v - Input vector-like value.
 * @returns A concrete 3D vector with `z` defaulting to `0` when omitted.
 */
function vectorFromLike(v: AcGeVector3dLike) {
  return new AcGeVector3d(v.x, v.y, v.z ?? 0)
}

/**
 * Converts a {@link AcGePoint3dLike} object to an {@link AcGePoint3d}.
 *
 * @param p - Input point-like value.
 * @returns A concrete 3D point with `z` defaulting to `0` when omitted.
 */
function pointFromLike(p: AcGePoint3dLike) {
  return new AcGePoint3d(p.x, p.y, p.z ?? 0)
}

/**
 * Converts a numeric vertex tuple to a {@link AcGePoint3dLike} object.
 *
 * @param v - Vertex as `[x, y, z]`.
 * @returns A point-like object suitable for geometry helpers.
 */
function vertexTuple(v: [number, number, number]): AcGePoint3dLike {
  return { x: v[0], y: v[1], z: v[2] }
}

/**
 * Decodes AutoCAD proxy-entity graphics binary data and renders primitives
 * through {@link AcGiRenderer}.
 *
 * A proxy-graphic buffer is a sequence of length-prefixed chunks. Each chunk
 * begins with a little-endian header `(size, type)` where `size` includes the
 * 8-byte header itself. Geometry commands emit drawable entities; attribute
 * commands update a lightweight graphics-state machine (color, layer, linetype,
 * fill, and so on).
 *
 * The implementation follows the ODA proxy-graphic format used by ezdxf's
 * `ProxyGraphic` module.
 *
 * @see {@link AcDbProxyEntity.subWorldDraw}
 */
export class AcDbProxyGraphic {
  /** Full proxy-graphic byte stream including the 8-byte stream prefix. */
  private readonly _buffer: Uint8Array

  /** Index of the first chunk header. Skips the 8-byte stream prefix. */
  private _index = 8

  /** Optional drawing database used for symbol-table lookups. */
  private readonly _database?: AcDbDatabase

  /** Drawing version string passed to bit-stream readers. */
  private readonly _dxfversion: string

  /** Text encoding used for single-byte text commands. */
  private _encoding: string

  /** Current ACI color index for subsequent geometry. `256` means ByLayer. */
  private _colorIndex = 256

  /** Current 24-bit RGB color when set by a true-color attribute. */
  private _rgbColor?: number

  /** Current layer name for subsequent geometry. */
  private _layer = '0'

  /** Current linetype name for subsequent geometry. */
  private _linetype = ByLayer

  /** Current lineweight for subsequent geometry. */
  private _lineweight: AcGiLineWeight = AcGiLineWeight.ByLineWeightDefault

  /** Current linetype scale for subsequent geometry. */
  private _ltscale = 1

  /** Current thickness for subsequent geometry. */
  private _thickness = 0

  /** When `true`, the next {@link AcDbProxyGraphicType.Polygon} is filled. */
  private _fill = false

  /** Layer names indexed by {@link AcDbProxyGraphicType.AttributeLayer} values. */
  private readonly _layers: string[] = []

  /** Linetype names indexed by {@link AcDbProxyGraphicType.AttributeLinetype} values. */
  private readonly _linetypes: string[] = []

  /** Active transform stack applied to decoded points and vectors. */
  private readonly _matrices: AcGeMatrix3d[] = []

  /** Most recently parsed extents corners, when an EXTENTS chunk was seen. */
  private _extents?: AcGePoint3d[]

  /**
   * Creates a proxy-graphic parser over the given byte stream.
   *
   * When a {@link AcDbDatabase} is supplied, layer and linetype tables are
   * cached so attribute commands can resolve table indices to names.
   *
   * @param data - Raw proxy-graphic bytes from a proxy entity.
   * @param options - Optional decoding and rendering context.
   */
  constructor(data: Uint8Array, options: AcDbProxyGraphicOptions = {}) {
    this._buffer = data
    this._database = options.database
    this._dxfversion = options.dxfversion ?? 'AC1015'
    this._encoding =
      options.encoding ??
      (this._dxfversion < 'AC1024' ? 'windows-1252' : 'utf-8')
    this._layer = options.defaultLayer ?? '0'

    if (this._database) {
      this._database.tables.layerTable
        .newIterator()
        .toArray()
        .forEach(layer => this._layers.push(layer.name))
      this._database.tables.linetypeTable
        .newIterator()
        .toArray()
        .forEach(linetype => this._linetypes.push(linetype.name))
    }
  }

  /**
   * Gets the most recently parsed extents corners.
   *
   * @returns Minimum and maximum corners from the last EXTENTS chunk, or
   *   `undefined` when no extents chunk has been read.
   */
  get extents() {
    return this._extents
  }

  /**
   * Scans the buffer for an {@link AcDbProxyGraphicType.Extents} chunk without
   * rendering geometry.
   *
   * @returns The minimum and maximum corners when an EXTENTS chunk is found,
   *   otherwise `undefined`.
   */
  scanExtents(): [AcGePoint3d, AcGePoint3d] | undefined {
    const buffer = this._buffer
    let index = this._index
    while (index < buffer.length) {
      const headerView = new DataView(
        buffer.buffer,
        buffer.byteOffset + index,
        8
      )
      const size = headerView.getUint32(0, true)
      const type = headerView.getUint32(4, true)
      if (size < 8) {
        break
      }
      if (type === AcDbProxyGraphicType.Extents) {
        const chunk = buffer.subarray(index + 8, index + size)
        this.readExtents(chunk)
        if (this._extents?.length === 2) {
          return [this._extents[0], this._extents[1]]
        }
        return undefined
      }
      index += size
    }
    return undefined
  }

  /**
   * Parses the full proxy-graphic stream and renders drawable primitives.
   *
   * Renderer sub-entity traits are saved before parsing and restored afterward
   * so attribute commands do not leak state to the caller.
   *
   * @param renderer - Target graphics renderer.
   * @returns A grouped {@link AcGiEntity} when at least one primitive was
   *   emitted, otherwise `undefined`.
   */
  worldDraw(renderer: AcGiRenderer): AcGiEntity | undefined {
    const entities: AcGiEntity[] = []
    const traits = renderer.subEntityTraits
    const previousTraits = {
      color: traits.color.clone(),
      lineType: traits.lineType,
      lineTypeScale: traits.lineTypeScale,
      lineWeight: traits.lineWeight,
      layer: traits.layer,
      thickness: traits.thickness
    }

    const buffer = this._buffer
    let index = this._index

    while (index < buffer.length) {
      const headerView = new DataView(
        buffer.buffer,
        buffer.byteOffset + index,
        8
      )
      const size = headerView.getUint32(0, true)
      const type = headerView.getUint32(4, true)
      if (size < 8) {
        break
      }
      const chunk = buffer.subarray(index + 8, index + size)
      this.dispatchChunk(renderer, entities, type, chunk)
      if (type !== AcDbProxyGraphicType.AttributeFill) {
        this._fill = false
      }
      index += size
    }

    traits.color = previousTraits.color
    traits.lineType = previousTraits.lineType
    traits.lineTypeScale = previousTraits.lineTypeScale
    traits.lineWeight = previousTraits.lineWeight
    traits.layer = previousTraits.layer
    traits.thickness = previousTraits.thickness

    if (entities.length === 0) {
      return undefined
    }
    return renderer.group(entities)
  }

  /**
   * Dispatches a single proxy-graphic chunk to the appropriate handler.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param type - Chunk type code from {@link AcDbProxyGraphicType}.
   * @param data - Chunk payload bytes excluding the 8-byte header.
   */
  private dispatchChunk(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    type: number,
    data: Uint8Array
  ) {
    switch (type) {
      case AcDbProxyGraphicType.Extents:
        this.readExtents(data)
        break
      case AcDbProxyGraphicType.Circle:
        this.drawCircle(renderer, entities, data)
        break
      case AcDbProxyGraphicType.Circle3P:
        this.drawCircle3P(renderer, entities, data)
        break
      case AcDbProxyGraphicType.CircularArc:
        this.drawCircularArc(renderer, entities, data)
        break
      case AcDbProxyGraphicType.CircularArc3P:
        this.drawCircularArc3P(renderer, entities, data)
        break
      case AcDbProxyGraphicType.EllipticArc:
        this.drawEllipticArc(renderer, entities, data)
        break
      case AcDbProxyGraphicType.Polyline:
        this.drawPolyline(renderer, entities, data, false)
        break
      case AcDbProxyGraphicType.PolylineWithNormals:
        this.drawPolyline(renderer, entities, data, true)
        break
      case AcDbProxyGraphicType.Polygon:
        this.drawPolygon(renderer, entities, data)
        break
      case AcDbProxyGraphicType.LwPolyline:
        this.drawLwPolyline(renderer, entities, data)
        break
      case AcDbProxyGraphicType.Shell:
        this.drawShell(renderer, entities, data)
        break
      case AcDbProxyGraphicType.Text:
        this.drawText(renderer, entities, data, false)
        break
      case AcDbProxyGraphicType.UnicodeText:
        this.drawText(renderer, entities, data, true)
        break
      case AcDbProxyGraphicType.Text2:
        this.drawText2(renderer, entities, data, false)
        break
      case AcDbProxyGraphicType.UnicodeText2:
        this.drawText2(renderer, entities, data, true)
        break
      case AcDbProxyGraphicType.Xline:
        this.drawXline(renderer, entities, data, false)
        break
      case AcDbProxyGraphicType.Ray:
        this.drawXline(renderer, entities, data, true)
        break
      case AcDbProxyGraphicType.AttributeColor:
        this.readAttributeColor(data)
        break
      case AcDbProxyGraphicType.AttributeLayer:
        this.readAttributeLayer(data)
        break
      case AcDbProxyGraphicType.AttributeLinetype:
        this.readAttributeLinetype(data)
        break
      case AcDbProxyGraphicType.AttributeFill:
        this.readAttributeFill(data)
        break
      case AcDbProxyGraphicType.AttributeTrueColor:
        this.readAttributeTrueColor(data)
        break
      case AcDbProxyGraphicType.AttributeLineweight:
        this.readAttributeLineweight(data)
        break
      case AcDbProxyGraphicType.AttributeLtscale:
        this.readAttributeLtscale(data)
        break
      case AcDbProxyGraphicType.AttributeThickness:
        this.readAttributeThickness(data)
        break
      case AcDbProxyGraphicType.PushMatrix:
        this.pushMatrix(data)
        break
      case AcDbProxyGraphicType.PopMatrix:
        this.popMatrix()
        break
      default:
        break
    }
  }

  /**
   * Applies the current proxy-graphic graphics state to renderer traits.
   *
   * @param renderer - Target graphics renderer whose {@link AcGiRenderer.subEntityTraits}
   *   are updated in place.
   */
  private applyTraits(renderer: AcGiRenderer) {
    const traits = renderer.subEntityTraits
    traits.layer = this._layer
    traits.lineTypeScale = this._ltscale
    traits.thickness = this._thickness
    traits.lineWeight = this._lineweight

    if (this._rgbColor != null) {
      traits.color = new AcCmColor(AcCmColorMethod.ByColor, this._rgbColor)
    } else if (this._colorIndex === 256) {
      traits.color = new AcCmColor(AcCmColorMethod.ByLayer)
    } else if (this._colorIndex === 0) {
      traits.color = new AcCmColor(AcCmColorMethod.ByBlock)
    } else if (this._colorIndex === 7) {
      traits.color = new AcCmColor(AcCmColorMethod.ByACI, 7)
    } else {
      traits.color = new AcCmColor(AcCmColorMethod.ByACI, this._colorIndex)
    }

    traits.lineType = {
      name: this._linetype,
      type: this.resolveLineStyleType(),
      standardFlag: 0,
      description: '',
      totalPatternLength: 0
    }
  }

  /**
   * Maps the current linetype name to a renderer style-type enum value.
   *
   * @returns `'ByLayer'`, `'ByBlock'`, or `'UserSpecified'`.
   */
  private resolveLineStyleType(): AcGiStyleType {
    if (this._linetype === ByLayer) return 'ByLayer'
    if (this._linetype === ByBlock) return 'ByBlock'
    return 'UserSpecified'
  }

  /**
   * Applies the active matrix stack to a point.
   *
   * @param point - Source point in proxy-graphic coordinates.
   * @returns The transformed {@link AcGePoint3d}.
   */
  private transformPoint(point: AcGePoint3dLike | [number, number, number]) {
    const like = Array.isArray(point) ? vertexTuple(point) : point
    const transformed = pointFromLike(like)
    if (this._matrices.length > 0) {
      transformed.applyMatrix4(this._matrices[this._matrices.length - 1])
    }
    return transformed
  }

  /**
   * Applies the active matrix stack to a direction vector and normalizes it.
   *
   * @param vector - Source vector in proxy-graphic coordinates.
   * @returns The transformed unit vector.
   */
  private transformVector(vector: AcGeVector3dLike | [number, number, number]) {
    const like = Array.isArray(vector) ? vertexTuple(vector) : vector
    const transformed = vectorFromLike(like)
    if (this._matrices.length > 0) {
      transformed.transformDirection(this._matrices[this._matrices.length - 1])
    }
    if (
      !Number.isFinite(transformed.lengthSq()) ||
      transformed.lengthSq() < 1e-24
    ) {
      return Z_AXIS.clone()
    }
    return transformed.normalize()
  }

  /**
   * Appends a drawable entity to the output list when defined.
   *
   * @param entities - Accumulator for emitted drawable entities.
   * @param entity - Entity returned by the renderer, if any.
   */
  private pushEntity(entities: AcGiEntity[], entity?: AcGiEntity) {
    if (entity) {
      entities.push(entity)
    }
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.Extents} chunk.
   *
   * @param data - Chunk payload containing minimum and maximum vertices.
   */
  private readExtents(data: Uint8Array) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const min = bs.readVertex()
    const max = bs.readVertex()
    this._extents = [
      new AcGePoint3d(min[0], min[1], min[2]),
      new AcGePoint3d(max[0], max[1], max[2])
    ]
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeColor} chunk.
   *
   * @param data - Chunk payload containing a 32-bit ACI color index.
   */
  private readAttributeColor(data: Uint8Array) {
    const value = new DataView(data.buffer, data.byteOffset, 4).getUint32(
      0,
      true
    )
    this._rgbColor = undefined
    this._colorIndex = value > 256 || value < 0 ? 256 : value
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeLayer} chunk.
   *
   * @param data - Chunk payload containing a layer-table index.
   */
  private readAttributeLayer(data: Uint8Array) {
    const index = new DataView(data.buffer, data.byteOffset, 4).getUint32(
      0,
      true
    )
    if (index < this._layers.length) {
      this._layer = this._layers[index]
    }
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeLinetype} chunk.
   *
   * @param data - Chunk payload containing a linetype-table index.
   */
  private readAttributeLinetype(data: Uint8Array) {
    const index = new DataView(data.buffer, data.byteOffset, 4).getUint32(
      0,
      true
    )
    if (index + 2 < this._linetypes.length) {
      this._linetype = this._linetypes[index + 2]
    } else if (index === 32766) {
      this._linetype = ByBlock
    } else {
      this._linetype = ByLayer
    }
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeFill} chunk.
   *
   * @param data - Chunk payload where any non-zero value enables fill.
   */
  private readAttributeFill(data: Uint8Array) {
    this._fill =
      new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true) !== 0
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeTrueColor} chunk.
   *
   * @param data - Chunk payload containing a packed true-color dword.
   */
  private readAttributeTrueColor(data: Uint8Array) {
    const raw = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true)
    const decoded = decodeProxyGraphicRawColor(raw)
    this._rgbColor = decoded.rgb
    if (decoded.colorIndex != null) {
      this._colorIndex = decoded.colorIndex
    }
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeLineweight} chunk.
   *
   * @param data - Chunk payload containing a raw lineweight value.
   */
  private readAttributeLineweight(data: Uint8Array) {
    const lw = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, true)
    if (lw > MAX_VALID_LINEWEIGHT) {
      this._lineweight = (lw - 0x100000000) as AcGiLineWeight
    } else {
      this._lineweight = lw as AcGiLineWeight
    }
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeLtscale} chunk.
   *
   * @param data - Chunk payload containing a little-endian double.
   */
  private readAttributeLtscale(data: Uint8Array) {
    this._ltscale = new DataView(data.buffer, data.byteOffset, 8).getFloat64(
      0,
      true
    )
  }

  /**
   * Parses an {@link AcDbProxyGraphicType.AttributeThickness} chunk.
   *
   * @param data - Chunk payload containing a little-endian double.
   */
  private readAttributeThickness(data: Uint8Array) {
    this._thickness = new DataView(data.buffer, data.byteOffset, 8).getFloat64(
      0,
      true
    )
  }

  /**
   * Parses a {@link AcDbProxyGraphicType.PushMatrix} chunk and pushes the
   * decoded matrix onto the transform stack.
   *
   * @param data - Chunk payload containing 16 little-endian doubles.
   */
  private pushMatrix(data: Uint8Array) {
    const values = new Float64Array(data.buffer, data.byteOffset, 16)
    const matrix = new AcGeMatrix3d().fromArray(Array.from(values))
    matrix.transpose()
    this._matrices.push(matrix)
  }

  /**
   * Pops the top matrix from the transform stack when the stack is non-empty.
   */
  private popMatrix() {
    if (this._matrices.length > 0) {
      this._matrices.pop()
    }
  }

  /**
   * Reads a vertex list from a polyline-style chunk.
   *
   * @param data - Chunk payload beginning with a vertex count.
   * @param loadNormal - When `true`, the final vertex is interpreted as a normal vector.
   * @returns Decoded vertices and the extracted normal (defaults to Z axis).
   */
  private loadVertices(data: Uint8Array, loadNormal: boolean) {
    const bs = new AcDbProxyGraphicByteStream(data)
    let count = bs.readLong()
    if (loadNormal) {
      count += 1
    }
    const vertices: AcGePoint3d[] = []
    while (count > 0) {
      const [x, y, z] = bs.readVertex()
      vertices.push(this.transformPoint({ x, y, z }))
      count -= 1
    }
    let normal = Z_AXIS
    if (loadNormal && vertices.length > 0) {
      normal = vectorFromLike(vertices.pop()!)
    }
    return { vertices, normal }
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Circle} chunk.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload.
   */
  private drawCircle(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const center = bs.readVertex()
    const radius = bs.readFloat()
    const normalVec = this.transformVector(bs.readVertex())
    let centerPoint = pointFromLike({
      x: center[0],
      y: center[1],
      z: center[2]
    })
    if (!normalVec.equals(Z_AXIS)) {
      centerPoint = transformWcsPointToOcs(centerPoint, normalVec)
    }
    centerPoint = this.transformPoint(centerPoint)
    const refVec = getOcsReferenceVector(normalVec)
    const arc = new AcGeCircArc3d(
      transformOcsPointToWcs(centerPoint, normalVec),
      radius,
      0,
      TAU,
      normalVec,
      refVec
    )
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.circularArc(arc))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Circle3P} chunk.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload containing three perimeter points.
   */
  private drawCircle3P(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const p1 = this.transformPoint(bs.readVertex())
    const p2 = this.transformPoint(bs.readVertex())
    const p3 = this.transformPoint(bs.readVertex())
    const center = AcGeCircArc3d.computeCenterPoint(p1, p2, p3)
    if (!center) return
    const radius = center.distanceTo(p1)
    const arc = new AcGeCircArc3d(center, radius, 0, TAU, Z_AXIS)
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.circularArc(arc))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.CircularArc} chunk.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload.
   */
  private drawCircularArc(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const center = bs.readVertex()
    const radius = bs.readFloat()
    const normal = bs.readVertex()
    const startVec = bs.readVertex()
    const sweepAngle = bs.readFloat()
    const normalVec = this.transformVector(normal)
    const centerWcs = pointFromLike({
      x: center[0],
      y: center[1],
      z: center[2]
    })
    const rawStart = vectorFromLike({
      x: startVec[0],
      y: startVec[1],
      z: startVec[2]
    })
    if (this._matrices.length > 0) {
      rawStart.transformDirection(this._matrices[this._matrices.length - 1])
    }
    const refVec =
      Number.isFinite(rawStart.lengthSq()) && rawStart.lengthSq() >= 1e-24
        ? rawStart.normalize()
        : getOcsReferenceVector(normalVec)
    const startAngle = 0
    const endAngle = sweepAngle
    const arc = new AcGeCircArc3d(
      this.transformPoint(centerWcs),
      radius,
      startAngle,
      endAngle,
      normalVec,
      refVec
    )
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.circularArc(arc))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.CircularArc3P} chunk.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload containing start, middle, and end points.
   */
  private drawCircularArc3P(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const p1 = this.transformPoint(bs.readVertex())
    const p2 = this.transformPoint(bs.readVertex())
    const p3 = this.transformPoint(bs.readVertex())
    const center = AcGeCircArc3d.computeCenterPoint(p1, p3, p2)
    if (!center) return
    const radius = center.distanceTo(p1)
    const startAngle = getOcsAngle(center, p1, Z_AXIS)
    const endAngle = getOcsAngle(center, p3, Z_AXIS)
    const arc = new AcGeCircArc3d(center, radius, startAngle, endAngle, Z_AXIS)
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.circularArc(arc))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.EllipticArc} chunk.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload.
   */
  private drawEllipticArc(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const center = this.transformPoint(bs.readVertex())
    const extrusion = this.transformVector(bs.readVertex())
    const majorAxisLength = bs.readFloat()
    const minorAxisLength = bs.readFloat()
    const startParam = bs.readFloat()
    const endParam = bs.readFloat()
    const majorAxisAngle = bs.readFloat()
    const majorAxis = transformOcsPointToWcs(
      {
        x: Math.cos(majorAxisAngle) * majorAxisLength,
        y: Math.sin(majorAxisAngle) * majorAxisLength,
        z: 0
      },
      extrusion
    )
    const ellipse = new AcGeEllipseArc3d(
      center,
      extrusion,
      majorAxis,
      majorAxisLength,
      minorAxisLength,
      startParam,
      endParam
    )
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.ellipticalArc(ellipse))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Polyline} or
   * {@link AcDbProxyGraphicType.PolylineWithNormals} chunk.
   *
   * A single vertex is rendered as a point entity using database `pdmode` and
   * `pdsize` settings when available.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload.
   * @param _loadNormal - When `true`, the final vertex stores the polyline normal.
   */
  private drawPolyline(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array,
    _loadNormal: boolean
  ) {
    const { vertices } = this.loadVertices(data, _loadNormal)
    if (vertices.length === 0) return
    if (vertices.length === 1) {
      this.applyTraits(renderer)
      const pdmode = this._database?.pdmode ?? 0
      const pdsize = this._database?.pdsize ?? 0
      this.pushEntity(
        entities,
        renderer.point(vertices[0], {
          displayMode: pdmode,
          displaySize: pdsize
        })
      )
      return
    }
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.lines(vertices))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Polygon} chunk.
   *
   * When {@link AcDbProxyGraphicType.AttributeFill} was set for this polygon, a
   * solid filled area is emitted; otherwise the polygon outline is drawn as a
   * closed polyline.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload.
   */
  private drawPolygon(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const { vertices } = this.loadVertices(data, false)
    if (vertices.length < 2) return
    if (this._fill) {
      const polyline = new AcGePolyline2d(
        vertices.map(vertex => ({ x: vertex.x, y: vertex.y })),
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
      traits.drawOrder = -1
      this.applyTraits(renderer)
      this.pushEntity(entities, renderer.area(area))
      return
    }
    const closed = [...vertices, vertices[0]]
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.lines(closed))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.LwPolyline} chunk.
   *
   * Bulge values are consumed but arc segments are not yet expanded; the result
   * is a vertex polyline in the current transform stack.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Bit-packed chunk payload.
   */
  private drawLwPolyline(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const bs = new AcDbProxyGraphicBitStream(
      data,
      this._dxfversion,
      this._encoding
    )
    let elevation = 0
    let isClosed = false
    bs.readUnsignedLong()
    const flag = bs.readBitShort() as number
    if (flag & 8) {
      elevation = bs.readBitDouble() as number
    }
    if (flag & 512) {
      isClosed = true
    }
    const numPoints = bs.readBitLong() as number
    if (numPoints <= 0) return

    const numBulges = flag & 16 ? (bs.readBitLong() as number) : 0
    if (this._dxfversion >= 'AC1024') {
      if (flag & 1024) {
        bs.readBitLong()
      }
      if (flag & 32) {
        bs.readBitLong()
      }
    }

    const rawVertices = bs.readRawDouble(2) as [number, number]
    const vertices: AcGePoint3d[] = [
      this.transformPoint({
        x: rawVertices[0],
        y: rawVertices[1],
        z: elevation
      })
    ]
    let prev = rawVertices
    for (let i = 1; i < numPoints; i++) {
      const x = bs.readBitDoubleDefault(1, prev[0]) as number
      const y = bs.readBitDoubleDefault(1, prev[1]) as number
      prev = [x, y]
      vertices.push(this.transformPoint({ x, y, z: elevation }))
    }
    for (let i = 0; i < numBulges; i++) {
      bs.readBitDouble()
    }

    if (isClosed && vertices.length > 1) {
      vertices.push(vertices[0].clone())
    }
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.lines(vertices))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Shell} chunk as face edge segments.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload containing vertices and face index lists.
   */
  private drawShell(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const totalVertexCount = bs.readLong()
    const vertices: AcGePoint3d[] = []
    for (let i = 0; i < totalVertexCount; i++) {
      const [x, y, z] = bs.readVertex()
      vertices.push(this.transformPoint({ x, y, z }))
    }
    const faceEntryCount = bs.readLong()
    const lines: AcGePoint3d[] = []
    let readCount = 0
    while (readCount < faceEntryCount) {
      const edgeCount = Math.abs(bs.readSignedLong())
      readCount += 1 + edgeCount
      const faceIndices: number[] = []
      for (let i = 0; i < edgeCount; i++) {
        faceIndices.push(bs.readLong())
      }
      const faceVertices = faceIndices
        .map(index => vertices[index])
        .filter(Boolean)
      if (faceVertices.length >= 3) {
        for (let i = 0; i < faceVertices.length; i++) {
          lines.push(faceVertices[i])
          lines.push(faceVertices[(i + 1) % faceVertices.length])
        }
      }
    }
    if (lines.length === 0) return
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.lines(lines))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Text} or
   * {@link AcDbProxyGraphicType.UnicodeText} chunk.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload.
   * @param unicode - When `true`, text is decoded as UTF-16LE.
   */
  private drawText(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array,
    unicode: boolean
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const insert = this.transformPoint(bs.readVertex())
    const normal = this.transformVector(bs.readVertex())
    const textDirection = this.transformVector(bs.readVertex())
    const [height, widthFactor, obliqueAngle] = bs.readStruct<
      [number, number, number]
    >([8, 8, 8])
    const text = unicode
      ? bs.readPaddedUnicodeString()
      : bs.readPaddedString(this._encoding)
    this.drawTextPrimitive(renderer, entities, {
      insert,
      normal,
      textDirection,
      text,
      height,
      widthFactor,
      obliqueAngle
    })
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Text2} or
   * {@link AcDbProxyGraphicType.UnicodeText2} chunk.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload with extended text header fields.
   * @param unicode - When `true`, text is decoded as UTF-16LE.
   */
  private drawText2(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array,
    unicode: boolean
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const insert = this.transformPoint(bs.readVertex())
    const normal = this.transformVector(bs.readVertex())
    const textDirection = this.transformVector(bs.readVertex())
    const text = unicode
      ? bs.readPaddedUnicodeString()
      : bs.readPaddedString(this._encoding)
    bs.readSignedLong()
    bs.readSignedLong()
    const [height, widthFactor, obliqueAngle] = bs.readStruct<
      [number, number, number]
    >([8, 8, 8])
    bs.readFloat()
    this.drawTextPrimitive(renderer, entities, {
      insert,
      normal,
      textDirection,
      text,
      height,
      widthFactor,
      obliqueAngle
    })
  }

  /**
   * Emits a proxy-graphic text command as an {@link AcGiRenderer.mtext} entity.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param options - Parsed text placement and formatting values.
   */
  private drawTextPrimitive(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    options: {
      /** Text insertion point in WCS coordinates. */
      insert: AcGePoint3d
      /** Text plane normal in WCS coordinates. */
      normal: AcGeVector3d
      /** Text baseline direction in WCS coordinates. */
      textDirection: AcGeVector3d
      /** Literal text content. */
      text: string
      /** Text height in drawing units. */
      height: number
      /** Relative X scale factor. */
      widthFactor: number
      /** Oblique angle in radians. */
      obliqueAngle: number
    }
  ) {
    const rotation = Math.atan2(
      options.textDirection.y,
      options.textDirection.x
    )
    const mtextData: AcGiMTextData = {
      text: options.text,
      height: options.height,
      width: Infinity,
      widthFactor: options.widthFactor,
      position: options.insert,
      rotation: (rotation * 180) / Math.PI,
      drawingDirection: AcGiMTextFlowDirection.BOTTOM_TO_TOP,
      attachmentPoint: AcGiMTextAttachmentPoint.BaselineLeft
    }
    const style: AcGiTextStyle = {
      name: DEFAULT_TEXT_STYLE,
      standardFlag: 0,
      fixedTextHeight: 0,
      widthFactor: options.widthFactor,
      obliqueAngle: (options.obliqueAngle * 180) / Math.PI,
      textGenerationFlag: 0,
      lastHeight: options.height,
      font: 'txt',
      bigFont: ''
    }
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.mtext(mtextData, style))
  }

  /**
   * Renders an {@link AcDbProxyGraphicType.Xline} or
   * {@link AcDbProxyGraphicType.Ray} chunk as a long screen-space segment.
   *
   * @param renderer - Target graphics renderer.
   * @param entities - Accumulator for emitted drawable entities.
   * @param data - Chunk payload containing two defining points.
   * @param isRay - When `true`, the line starts at the first point; otherwise it
   *   extends infinitely in both directions.
   */
  private drawXline(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    data: Uint8Array,
    isRay: boolean
  ) {
    const bs = new AcDbProxyGraphicByteStream(data)
    const start = this.transformPoint(bs.readVertex())
    const other = this.transformPoint(bs.readVertex())
    const direction = new AcGeVector3d().subVectors(other, start)
    if (direction.lengthSq() === 0) return
    const far = 1e6
    const end = isRay
      ? start.clone().add(direction.normalize().multiplyScalar(far))
      : start.clone().sub(direction.normalize().multiplyScalar(far))
    const farEnd = other.clone().add(direction.normalize().multiplyScalar(far))
    this.applyTraits(renderer)
    this.pushEntity(entities, renderer.lines([end, farEnd]))
  }
}

/**
 * Loads proxy-graphic bytes from DXF group codes **160** and **310**.
 *
 * Hex chunks are concatenated in order and optionally truncated to the declared
 * byte length from group code **160**.
 *
 * @param length - Expected byte length from group code **160**.
 * @param hexChunks - One or more hexadecimal strings from group code **310**.
 * @returns Decoded bytes, or `undefined` when no hex chunks are supplied.
 */
export function loadAcDbProxyGraphicFromDxf(
  length?: number,
  hexChunks?: string[]
): Uint8Array | undefined {
  if (!hexChunks?.length) {
    return undefined
  }
  const bytes = new Uint8Array(
    hexChunks.reduce((sum, chunk) => sum + Math.floor(chunk.length / 2), 0)
  )
  let offset = 0
  for (const chunk of hexChunks) {
    for (let i = 0; i < chunk.length; i += 2) {
      bytes[offset++] = parseInt(chunk.slice(i, i + 2), 16)
    }
  }
  if (length != null && length > 0 && bytes.length >= length) {
    return bytes.subarray(0, length)
  }
  return bytes
}

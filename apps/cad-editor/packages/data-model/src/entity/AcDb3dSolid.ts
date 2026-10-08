import {
  AcGeBox3d,
  AcGeIntersectPrimitive,
  AcGeLine3d,
  AcGeMatrix3d,
  AcGePoint3d
} from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import {
  acdbAcisWireframeSegmentsFromSab,
  acdbAcisWireframeSegmentsFromSatText,
  acdbAppendAcisPayloadFragment,
  acdbJoinAcisPayloadLines
} from '../acis'
import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbEntity } from './AcDbEntity'

/**
 * Construction options for {@link AcDb3dSolid} when geometry is supplied as
 * binary SAB and/or plain SAT/ASM text rather than a single string argument.
 */
export interface AcDb3dSolidOptions {
  /** Binary SAB payload from ACDSDATA or inline modeler geometry. */
  sabBytes?: Uint8Array
  /** Plain SAT/ASM text from inline groups 1/3 or ACSH BREP. */
  satText?: string
  /** Legacy alias for {@link satText}. */
  acisData?: string
  /** DXF group 70 ACIS version number, when present. */
  version?: number
}

/**
 * Matches classic SAT `point` records (`point $-1 x y z`) and ASM-style records
 * with additional pointer fields (`point $-1 -1 $-1 x y z`).
 */
const ACIS_POINT_RECORD =
  /\bpoint\s+(?:\$-?\d+\s+){1,4}([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g

/** Splits SAT text into individual `#`-delimited entity records. */
function splitAcisRecords(acisData: string): string[] {
  return acisData
    .split('#')
    .map(record => record.trim())
    .filter(record => record.length > 0)
}

/**
 * Reads numeric tokens from one SAT record, skipping pointer and sentinel tokens.
 *
 * @param record - One SAT entity record line.
 * @param skip - Number of leading tokens to skip before scanning (default 1).
 */
function readNumericTokens(record: string, skip = 1): number[] {
  const parts = record.split(/\s+/)
  const values: number[] = []
  for (let i = skip; i < parts.length; i++) {
    const token = parts[i]!
    if (token.startsWith('$') || token === 'I' || token === 'F') {
      continue
    }
    const value = Number.parseFloat(token)
    if (Number.isFinite(value)) {
      values.push(value)
    }
  }
  return values
}

/**
 * Extracts every vertex position referenced by `point` records in an ACIS
 * SAT text stream.
 *
 * @param acisData - Raw ACIS SAT text (the concatenated group 1/3 lines of a
 * DXF `3DSOLID`/`REGION`/`BODY` entity).
 * @returns Every point found, in file order. Empty when `acisData` doesn't
 * contain any recognizable `point` records.
 */
function extractAcisPointCloud(acisData: string): AcGePoint3d[] {
  const points: AcGePoint3d[] = []
  for (const match of acisData.matchAll(ACIS_POINT_RECORD)) {
    const x = Number.parseFloat(match[1]!)
    const y = Number.parseFloat(match[2]!)
    const z = Number.parseFloat(match[3]!)
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      points.push(new AcGePoint3d(x, y, z))
    }
  }

  if (points.length > 0) {
    return points
  }

  for (const record of splitAcisRecords(acisData)) {
    if (!record.startsWith('point ')) {
      continue
    }
    const values = readNumericTokens(record)
    if (values.length >= 3) {
      const x = values[values.length - 3]!
      const y = values[values.length - 2]!
      const z = values[values.length - 1]!
      points.push(new AcGePoint3d(x, y, z))
    }
  }
  return points
}

/** Collects unique segment endpoints from a wireframe buffer (`[x,y,z,...]`). */
function pointsFromWireframe(wireframe: Float32Array): AcGePoint3d[] {
  const points: AcGePoint3d[] = []
  for (let i = 0; i < wireframe.length; i += 3) {
    const x = wireframe[i]!
    const y = wireframe[i + 1]!
    const z = wireframe[i + 2]!
    points.push(new AcGePoint3d(x, y, z))
  }
  return points
}

/**
 * Normalizes constructor input into SAB bytes, SAT text, and version fields.
 *
 * @param input - Raw SAT string or {@link AcDb3dSolidOptions}.
 * @param version - DXF group 70 version used when `input` is a string.
 */
function resolveSolidPayload(
  input: string | AcDb3dSolidOptions,
  version?: number,
): {
  sabBytes?: Uint8Array
  satText: string
  version?: number
} {
  if (typeof input === 'string') {
    return { satText: input, version }
  }
  return {
    sabBytes: input.sabBytes,
    satText: input.satText ?? input.acisData ?? '',
    version: input.version ?? version,
  }
}

/**
 * Represents a 3D solid (ACIS/ASM B-rep) entity, such as those created by
 * AutoCAD's BOX, WEDGE, EXTRUDE, or boolean solid-modeling commands.
 *
 * Full B-rep tessellation is not yet supported. When binary SAB or SAT text is
 * available, this entity renders a best-effort wireframe derived from decoded
 * edges and curves; otherwise it falls back to a bounding-box wireframe built
 * from embedded `point` records in the SAT stream.
 */
export class AcDb3dSolid extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = '3dSolid'

  override get dxfTypeName() {
    return '3DSOLID'
  }

  /** Raw ACIS SAT text preserved for DXF round-trip and future B-rep parsing. */
  private _acisData: string
  /** Binary SAB/ASM payload from ACDSDATA, when present. */
  private _sabBytes?: Uint8Array
  /** DXF group 70 ACIS version number, when present. */
  private _version?: number
  /** Soft-pointer to ACSH history object (DXF group 350). */
  private _historyObjectSoftId?: string
  /** Revision GUID for the modeler geometry, when present (DXF group 2). */
  private _guid?: string
  /** Whether the ASM/ACIS payload uses SAT text caching (DXF group 290). */
  private _satCache?: boolean
  /** Vertex positions used for extents and fallback bounding-box rendering. */
  private _points: AcGePoint3d[] = []
  /** Line-segment endpoint pairs for wireframe rendering (`[x,y,z,...]`). */
  private _wireframe: Float32Array = new Float32Array(0)

  /**
   * Creates a new 3D solid entity from raw ACIS data.
   *
   * @param acisData - Raw ACIS SAT text (group 1/3 lines).
   * @param version - DXF group 70 ACIS version number, when present.
   */
  constructor(acisData: string, version?: number)
  /**
   * Creates a new 3D solid entity from binary SAB and/or SAT text payloads.
   *
   * @param options - Construction options with optional SAB bytes and SAT text.
   */
  constructor(options: AcDb3dSolidOptions)
  constructor(
    acisDataOrOptions: string | AcDb3dSolidOptions,
    version?: number,
  ) {
    super()
    const payload = resolveSolidPayload(acisDataOrOptions, version)
    this._acisData = payload.satText
    this._sabBytes = payload.sabBytes
    this._version = payload.version
    this.rebuildGeometryCaches()
  }

  /**
   * Raw ACIS SAT text for this solid, preserved for future full B-rep parsing.
   */
  get acisData(): string {
    return this._acisData
  }

  /** DXF group 70 ACIS version number, when present. */
  get version(): number | undefined {
    return this._version
  }

  /**
   * Soft-pointer handle to `ACSH_HISTORY_CLASS` (DXF group 350), when present.
   * Resolved later when OBJECTS-section data is available.
   */
  get historyObjectSoftId(): string | undefined {
    return this._historyObjectSoftId
  }

  set historyObjectSoftId(value: string | undefined) {
    this._historyObjectSoftId = value
  }

  /**
   * Revision GUID for the modeler geometry, when present (DXF group 2).
   */
  get guid(): string | undefined {
    return this._guid
  }

  set guid(value: string | undefined) {
    this._guid = value
  }

  /**
   * Whether the ASM/ACIS payload uses SAT text caching (DXF group 290).
   */
  get satCache(): boolean | undefined {
    return this._satCache
  }

  set satCache(value: boolean | undefined) {
    this._satCache = value
  }

  /**
   * Replaces the SAT/ACIS payload and rebuilds wireframe / point caches.
   * Used by DXF import after constructing an empty solid.
   */
  setAcisData(satText: string, version?: number) {
    this._acisData = satText ?? ''
    if (version != null) {
      this._version = version
    }
    this.rebuildGeometryCaches()
  }

  /**
   * Attaches binary SAB/ASM bytes (typically from ACDSDATA) and rebuilds
   * wireframe / point caches. Preferred over SAT text when both are present.
   *
   * @param sabBytes - Raw ASM_Data payload for this solid.
   */
  setSabBytes(sabBytes: Uint8Array | undefined) {
    this._sabBytes =
      sabBytes && sabBytes.length > 0 ? sabBytes : undefined
    this.rebuildGeometryCaches()
  }

  /** Binary SAB/ASM payload attached via ACDSDATA or construction options. */
  get sabBytes(): Uint8Array | undefined {
    return this._sabBytes
  }

  /**
   * Rebuilds `_wireframe` / `_points` from SAB bytes (preferred) or SAT text.
   */
  private rebuildGeometryCaches() {
    let wireframe: Float32Array = new Float32Array(0)
    if (this._sabBytes && this._sabBytes.length > 0) {
      wireframe =
        acdbAcisWireframeSegmentsFromSab(this._sabBytes) ?? new Float32Array(0)
    }
    if (wireframe.length === 0 && this._acisData) {
      wireframe = acdbAcisWireframeSegmentsFromSatText(this._acisData)
    }
    this._wireframe = wireframe
    this._points =
      wireframe.length > 0
        ? pointsFromWireframe(wireframe)
        : extractAcisPointCloud(this._acisData)
  }

  /**
   * Whether wireframe segments or fallback point data could be extracted from
   * the supplied SAB/SAT payload.
   */
  get hasRenderableGeometry(): boolean {
    return this._wireframe.length > 0 || this._points.length > 0
  }

  /** @inheritdoc */
  get geometricExtents(): AcGeBox3d {
    if (this._points.length === 0) {
      return new AcGeBox3d(new AcGePoint3d(0, 0, 0), new AcGePoint3d(0, 0, 0))
    }
    return new AcGeBox3d().setFromPoints(this._points)
  }

  /** @inheritdoc */
  override subGetIntersectCurves(): AcGeIntersectPrimitive[] {
    const primitives: AcGeIntersectPrimitive[] = []
    for (let i = 0; i + 5 < this._wireframe.length; i += 6) {
      primitives.push({
        kind: 'line',
        line: new AcGeLine3d(
          {
            x: this._wireframe[i]!,
            y: this._wireframe[i + 1]!,
            z: this._wireframe[i + 2]!
          },
          {
            x: this._wireframe[i + 3]!,
            y: this._wireframe[i + 4]!,
            z: this._wireframe[i + 5]!
          }
        ),
        extent: 'bounded',
        extendable: false
      })
    }
    return primitives
  }

  /**
   * Transforms the extracted wireframe and point cloud by the specified matrix.
   *
   * {@link acisData} itself is left untouched since it isn't fully parsed.
   *
   * @param matrix - 4×4 transformation matrix.
   * @returns This instance (for chaining).
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._points.forEach(point => point.applyMatrix4(matrix))
    if (this._wireframe.length > 0) {
      const transformed = new Float32Array(this._wireframe.length)
      for (let i = 0; i < this._wireframe.length; i += 3) {
        const point = new AcGePoint3d(
          this._wireframe[i]!,
          this._wireframe[i + 1]!,
          this._wireframe[i + 2]!,
        )
        point.applyMatrix4(matrix)
        transformed[i] = point.x
        transformed[i + 1] = point.y
        transformed[i + 2] = point.z
      }
      this._wireframe = transformed
    }
    return this
  }

  /**
   * Draws decoded wireframe segments when available; otherwise draws a bounding
   * box around extracted `point` records.
   *
   * @param renderer - The renderer to use for drawing.
   * @returns The rendered wireframe entity, or `undefined` when no geometry
   * could be extracted.
   */
  subWorldDraw(renderer: AcGiRenderer) {
    if (this._wireframe.length >= 6) {
      const vertexCount = this._wireframe.length / 3
      const indices = new Uint16Array(vertexCount)
      for (let i = 0; i < vertexCount; i++) {
        indices[i] = i
      }
      return renderer.lineSegments(this._wireframe, 3, indices)
    }

    if (this._points.length === 0) {
      return undefined
    }

    const box = this.geometricExtents
    const min = box.min
    const max = box.max
    const corners = [
      new AcGePoint3d(min.x, min.y, min.z),
      new AcGePoint3d(max.x, min.y, min.z),
      new AcGePoint3d(max.x, max.y, min.z),
      new AcGePoint3d(min.x, max.y, min.z),
      new AcGePoint3d(min.x, min.y, max.z),
      new AcGePoint3d(max.x, min.y, max.z),
      new AcGePoint3d(max.x, max.y, max.z),
      new AcGePoint3d(min.x, max.y, max.z)
    ]
    const buffer = new Float32Array(corners.length * 3)
    corners.forEach((corner, i) => {
      buffer[i * 3] = corner.x
      buffer[i * 3 + 1] = corner.y
      buffer[i * 3 + 2] = corner.z
    })
    const indices = new Uint16Array([
      0, 1, 1, 2, 2, 3, 3, 0,
      4, 5, 5, 6, 6, 7, 7, 4,
      0, 4, 1, 5, 2, 6, 3, 7
    ])
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
    filer.writeSubclassMarker('AcDb3dSolid')
    if (this._version != null) {
      filer.writeInt16(70, this._version)
    }
    if (this._guid != null) {
      filer.writeString(2, this._guid)
    }
    if (this._satCache != null) {
      filer.writeInt16(290, this._satCache ? 1 : 0)
    }
    const maxChunkLength = 255
    const lines = this._acisData.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const isLast = i === lines.length - 1
      let line = lines[i]!
      while (line.length > maxChunkLength) {
        filer.writeString(3, line.slice(0, maxChunkLength))
        line = line.slice(maxChunkLength)
      }
      filer.writeString(isLast ? 1 : 3, line)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)

    // DXF order: AcDbModelerGeometry (version + SAT chunks) then AcDb3dSolid
    // (history / guid / satCache). Consume both subclass markers when present.
    filer.atSubclassData('AcDbModelerGeometry')

    const lines: string[] = []
    let version = this._version

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.peekItem()
      if (!item) break
      const code = Number(item.code)

      // Nested subclass marker for AcDb3dSolid — consume and continue.
      if (code === 100) {
        filer.readItem()
        const marker = String(item.value)
        if (marker === 'AcDb3dSolid') {
          continue
        }
        // Unknown subclass — push back and stop so callers can handle it.
        filer.pushBackItem(item)
        break
      }

      filer.readItem()
      const n = Number(item.value)
      switch (code) {
        case 1:
          acdbAppendAcisPayloadFragment(lines, 1, String(item.value))
          break
        case 3:
          acdbAppendAcisPayloadFragment(lines, 3, String(item.value))
          break
        case 70:
          version = n
          break
        case 350:
          this._historyObjectSoftId = String(item.value)
          break
        case 2:
          this._guid = String(item.value)
          break
        case 290:
          this._satCache = n !== 0
          break
        default:
          break
      }
    }

    // Decrypt obfuscated SAT fragments (DXF groups 1/3) the same way dxf-json does.
    this.setAcisData(acdbJoinAcisPayloadLines(lines), version)
    return this
  }
}

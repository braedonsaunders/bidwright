import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  acdbBytesToHexString,
  acdbLoadProxyGraphicFromDxf,
  AcDbProxyGraphic
} from '../misc/proxyGraphic'
import { AcDbEntity } from './AcDbEntity'
import {
  acdbForEachGripIndex,
  acdbMovePointArrayGripAt
} from './AcDbGripHelpers'

/**
 * Represents a proxy entity for custom objects not natively supported by the
 * host application.
 *
 * When AutoCAD loads a drawing that contains custom ObjectARX entities whose
 * class definitions are unavailable, those objects are stored as
 * `ACAD_PROXY_ENTITY` records. Each proxy entity carries metadata about the
 * original class and a binary **proxy graphic** stream that encodes drawable
 * primitives (lines, arcs, text, and so on).
 *
 * {@link subWorldDraw} decodes that stream through {@link AcDbProxyGraphic}
 * and renders the contained primitives via {@link AcGiRenderer}, allowing
 * viewers such as cad-viewer to display third-party objects without the
 * original ARX module.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbProxyEntity
 *
 * @example
 * ```typescript
 * const proxy = new AcDbProxyEntity()
 * proxy.originalDxfName = 'AECC_TIN_SURFACE'
 * proxy.setProxyGraphic(binaryData)
 * const drawable = proxy.subWorldDraw(renderer)
 * ```
 */
export class AcDbProxyEntity extends AcDbEntity {
  /**
   * The runtime entity type name used by {@link AcDbEntity.type}.
   *
   * Always `'ProxyEntity'`.
   */
  static override typeName: string = 'ProxyEntity'

  /**
   * Gets the DXF entity type name written to and read from drawing files.
   *
   * @returns The literal `'ACAD_PROXY_ENTITY'`.
   */
  override get dxfTypeName() {
    return 'ACAD_PROXY_ENTITY'
  }

  /**
   * Original DXF entity name of the proxied class.
   *
   * Stored in DXF group code **1**. Example: `'AECC_TIN_SURFACE'`.
   */
  private _originalDxfName = ''

  /**
   * Original ObjectARX class name of the proxied object.
   *
   * Stored in DXF group code **3** when present.
   */
  private _originalClassName = ''

  /**
   * Registered application name that created the proxied object.
   *
   * Stored in DXF extended-data group code **1001** when present.
   */
  private _applicationName = ''

  /**
   * Proxy-entity class identifier assigned by the creating application.
   *
   * Stored in DXF group code **90**. Always `498` for `AcDbProxyEntity`.
   */
  private _proxyEntityClassId = 498

  /**
   * Application entity class ID from the CLASSES section order (500+).
   *
   * Stored in DXF group code **91**.
   */
  private _applicationEntityClassId = 0

  /**
   * Object drawing format when the custom object became a proxy.
   *
   * Stored in DXF group code **95**. Low word is AcDbDwgVersion; high word is
   * MaintenanceReleaseVersion.
   */
  private _objectDrawingFormat = 0

  /**
   * Original custom object data format.
   *
   * Stored in DXF group code **70**: `0` = DWG, `1` = DXF.
   */
  private _originalDataFormat = 0

  /**
   * Raw binary proxy-graphics payload.
   *
   * Length is stored in DXF group code **160**; the bytes themselves are
   * serialized as hexadecimal strings in group code **310** chunks.
   */
  private _proxyGraphic?: Uint8Array

  /**
   * Optional entity-origin anchor points associated with the proxy entity.
   *
   * Used at draw time for grips; not written with group code **92** (that code
   * is reserved for graphics-data size in classic DXF).
   */
  private _entityOrigins: AcGePoint3d[] = []
  /**
   * Cumulative world-space transform applied at draw time.
   *
   * The proxy-graphic byte stream is left unchanged; editor operations such as
   * MOVE, COPY, and ROTATE update this matrix instead of rewriting the stream.
   */
  private _worldTransform = new AcGeMatrix3d()

  /**
   * Gets the original DXF name of the proxied entity class.
   *
   * Mirrors the ObjectARX original-class DXF name and corresponds to DXF
   * group code **1**.
   *
   * @returns The proxied class DXF name, or an empty string when unset.
   */
  get originalDxfName() {
    return this._originalDxfName
  }

  /**
   * Sets the original DXF name of the proxied entity class.
   *
   * @param value - Proxied class DXF name (DXF group code **1**).
   */
  set originalDxfName(value: string) {
    this._originalDxfName = value
  }

  /**
   * Gets the original ObjectARX class name of the proxied object.
   *
   * Corresponds to DXF group code **3** when exported.
   *
   * @returns The ObjectARX class name, or an empty string when unset.
   */
  get originalClassName() {
    return this._originalClassName
  }

  /**
   * Sets the original ObjectARX class name of the proxied object.
   *
   * @param value - ObjectARX class name (DXF group code **3**).
   */
  set originalClassName(value: string) {
    this._originalClassName = value
  }

  /**
   * Gets the registered application name that created the proxied object.
   *
   * Corresponds to DXF extended-data group code **1001** when exported.
   *
   * @returns The creating application name, or an empty string when unset.
   */
  get applicationName() {
    return this._applicationName
  }

  /**
   * Sets the registered application name that created the proxied object.
   *
   * @param value - Application name (DXF group code **1001**).
   */
  set applicationName(value: string) {
    this._applicationName = value
  }

  /**
   * Gets the proxy-entity class identifier.
   *
   * Corresponds to DXF group code **90**.
   *
   * @returns The class identifier assigned by the creating application.
   */
  get proxyEntityClassId() {
    return this._proxyEntityClassId
  }

  /**
   * Sets the proxy-entity class identifier.
   *
   * @param value - Class identifier (DXF group code **90**).
   */
  set proxyEntityClassId(value: number) {
    this._proxyEntityClassId = value
  }

  /**
   * Gets the application entity class ID (CLASSES section order, 500+).
   *
   * Corresponds to DXF group code **91**.
   */
  get applicationEntityClassId() {
    return this._applicationEntityClassId
  }

  /**
   * Sets the application entity class ID.
   *
   * @param value - Class ID from CLASSES section order (DXF group code **91**).
   */
  set applicationEntityClassId(value: number) {
    this._applicationEntityClassId = value
  }

  /**
   * Gets the object drawing format (DXF group code **95**).
   */
  get objectDrawingFormat() {
    return this._objectDrawingFormat
  }

  /**
   * Sets the object drawing format (DXF group code **95**).
   *
   * @param value - Packed AcDbDwgVersion / MaintenanceReleaseVersion.
   */
  set objectDrawingFormat(value: number) {
    this._objectDrawingFormat = value
  }

  /**
   * Alias of {@link objectDrawingFormat} for older callers.
   *
   * @deprecated Use {@link objectDrawingFormat}.
   */
  get graphicsMetafileType() {
    return this._objectDrawingFormat
  }

  /**
   * Alias of {@link objectDrawingFormat} for older callers.
   *
   * @deprecated Use {@link objectDrawingFormat}.
   */
  set graphicsMetafileType(value: number) {
    this._objectDrawingFormat = value
  }

  /**
   * Gets the original custom object data format (DXF group code **70**).
   *
   * @returns `0` for DWG format, `1` for DXF format.
   */
  get originalDataFormat() {
    return this._originalDataFormat
  }

  /**
   * Sets the original custom object data format (DXF group code **70**).
   *
   * @param value - `0` = DWG, `1` = DXF.
   */
  set originalDataFormat(value: number) {
    this._originalDataFormat = value
  }
  /**
   * Gets the decoded proxy-graphics binary payload.
   *
   * @returns A copy of the stored bytes, or `undefined` when no graphics are
   *   attached.
   */
  get proxyGraphic() {
    return this._proxyGraphic
  }

  /**
   * Sets the proxy-graphics binary payload.
   *
   * The supplied buffer is copied so subsequent mutations of the caller's array
   * do not affect this entity.
   *
   * @param data - Raw proxy-graphic bytes, or `null`/`undefined` to clear.
   */
  setProxyGraphic(data?: Uint8Array | null) {
    this._proxyGraphic = data ? new Uint8Array(data) : undefined
  }

  /**
   * Gets the entity-origin anchor points stored on this proxy entity.
   *
   * @returns A read-only view of the origin points. Mutate through
   *   {@link setEntityOrigins}.
   */
  get entityOrigins() {
    return this._entityOrigins
  }

  /**
   * Replaces the entity-origin anchor points stored on this proxy entity.
   *
   * Each input point is cloned into an {@link AcGePoint3d} instance.
   *
   * @param origins - New origin points (DXF group codes **92** / **10**).
   */
  setEntityOrigins(origins: AcGePoint3d[]) {
    this._entityOrigins = origins.map(
      origin => new AcGePoint3d(origin.x, origin.y, origin.z)
    )
  }

  /**
   * Gets the geometric extents of this proxy entity.
   *
   * When the proxy-graphic stream contains an {@link AcDbProxyGraphicType.Extents}
   * chunk, the returned box is built from its minimum and maximum corners.
   * Otherwise an empty {@link AcGeBox3d} is returned.
   *
   * @returns The axis-aligned bounding box derived from proxy graphics.
   */
  get geometricExtents(): AcGeBox3d {
    const graphic = this._proxyGraphic
    if (!graphic?.length) {
      return new AcGeBox3d()
    }
    const parser = new AcDbProxyGraphic(graphic, {
      database: this.database,
      defaultLayer: this.layer
    })
    const extents = parser.scanExtents()
    if (extents) {
      const box = new AcGeBox3d().setFromPoints(extents)
      if (!this._worldTransform.equals(new AcGeMatrix3d())) {
        box.applyMatrix4(this._worldTransform)
      }
      return box
    }
    return new AcGeBox3d()
  }

  /**
   * Gets the grip points for this proxy entity.
   *
   * When entity origins are stored on the proxy, they are returned as grips.
   * Otherwise the axis-aligned extents corners are used when available.
   *
   * @returns Array of grip points as 3D points
   */
  subGetGripPoints() {
    if (this._entityOrigins.length > 0) {
      return [...this._entityOrigins]
    }

    const extents = this.geometricExtents
    if (!extents.isEmpty()) {
      return [
        new AcGePoint3d(extents.min.x, extents.min.y, extents.min.z),
        new AcGePoint3d(extents.max.x, extents.max.y, extents.max.z)
      ]
    }

    return []
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    if (this._entityOrigins.length > 0) {
      acdbMovePointArrayGripAt(indices, offset, this._entityOrigins)
      return this
    }

    const extents = this.geometricExtents
    if (extents.isEmpty()) {
      return this
    }

    acdbForEachGripIndex(indices, index => {
      if (index === 0) {
        this.transformBy(AcGeMatrix3d.makeTranslation(offset))
      }
    })
    return this
  }

  /**
   * Transforms this proxy entity by the specified matrix.
   *
   * {@link entityOrigins} and the cumulative {@link _worldTransform} are
   * updated. The proxy-graphic byte stream is left unchanged; stream-local
   * transforms remain encoded as {@link AcDbProxyGraphicType.PushMatrix} /
   * {@link AcDbProxyGraphicType.PopMatrix} commands and are applied by
   * {@link AcDbProxyGraphic} before {@link _worldTransform}.
   *
   * @param matrix - World-space transformation matrix to apply.
   * @returns This entity for chaining.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._entityOrigins.forEach(origin => origin.applyMatrix4(matrix))
    this._worldTransform.premultiply(matrix)
    return this
  }

  /**
   * Draws proxy graphics by decoding the binary stream and emitting primitives
   * through the renderer.
   *
   * This is the primary world-space draw entry point for proxy entities. It
   * delegates to {@link AcDbProxyGraphic.worldDraw} using the entity database
   * and layer as rendering context.
   *
   * @param renderer - Target graphics renderer.
   * @returns A grouped {@link AcGiEntity} when geometry was emitted, otherwise
   *   `undefined`.
   */
  subWorldDraw(renderer: AcGiRenderer): AcGiEntity | undefined {
    const graphic = this._proxyGraphic
    if (!graphic?.length) {
      return undefined
    }

    const parser = new AcDbProxyGraphic(graphic, {
      database: this.database,
      defaultLayer: this.layer
    })
    const drawable = parser.worldDraw(renderer)
    if (drawable && !this._worldTransform.equals(new AcGeMatrix3d())) {
      drawable.applyMatrix(this._worldTransform)
    }
    return drawable
  }

  /**
   * Writes DXF subclass fields for this proxy entity.
   *
   * Emits the `AcDbProxyEntity` subclass marker followed by Autodesk group
   * codes **90**, **91**, **95**, **70**, **160**, and **310**, plus optional
   * **1** / **3** when original class metadata is available.
   *
   * @param filer - DXF output filer.
   * @returns This entity for chaining.
   * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-89A690F9-E859-4D57-89EA-750F3FB76C6B
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbProxyEntity')
    if (this._originalDxfName) {
      filer.writeString(1, this._originalDxfName)
    }
    if (this._originalClassName) {
      filer.writeString(3, this._originalClassName)
    }
    filer.writeInt32(90, this._proxyEntityClassId || 498)
    if (this._applicationEntityClassId) {
      filer.writeInt32(91, this._applicationEntityClassId)
    }
    if (this._objectDrawingFormat) {
      filer.writeInt32(95, this._objectDrawingFormat)
    }
    filer.writeInt16(70, this._originalDataFormat)
    if (this._proxyGraphic?.length) {
      filer.writeInt32(160, this._proxyGraphic.length)
      let index = 0
      while (index < this._proxyGraphic.length) {
        const chunk = this._proxyGraphic.subarray(index, index + 127)
        filer.writeString(310, acdbBytesToHexString(chunk))
        index += 127
      }
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbProxyEntity')

    // ASCII readers may leave hex as string; typed binary pairs yield Uint8Array.
    const dataChunks: Array<string | Uint8Array> = []
    let graphicLength: number | undefined

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 1:
          this.originalDxfName = String(item.value)
          break
        case 3:
          this.originalClassName = String(item.value)
          break
        case 70:
          this.originalDataFormat = n
          break
        case 90:
          this.proxyEntityClassId = n
          break
        case 91:
          this.applicationEntityClassId = n
          break
        case 95:
          this.objectDrawingFormat = n
          break
        case 160:
          graphicLength = n
          break
        case 310:
          if (item.value instanceof Uint8Array) {
            dataChunks.push(item.value)
          } else {
            dataChunks.push(String(item.value))
          }
          break
        default:
          break
      }
    }

    if (dataChunks.length > 0) {
      this.loadProxyGraphicFromDxf(graphicLength, dataChunks)
    }
    return this
  }

  /**
   * Loads proxy-graphic bytes from DXF group codes **160** and **310**.
   *
   * @param length - Expected byte length from group code **160**. When provided
   *   and positive, the result is truncated to this length.
   * @param chunks - One or more hexadecimal strings or binary chunks from
   *   group code **310**.
   */
  loadProxyGraphicFromDxf(length?: number, chunks?: Array<string | Uint8Array>) {
    const data = acdbLoadProxyGraphicFromDxf(length, chunks)
    if (data) {
      this.setProxyGraphic(data)
    }
  }
}

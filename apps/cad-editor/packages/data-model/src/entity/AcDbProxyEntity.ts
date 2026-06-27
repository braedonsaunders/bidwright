import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  AcDbProxyGraphic,
  bytesToHexString,
  loadAcDbProxyGraphicFromDxf
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
   * Stored in DXF group code **90**.
   */
  private _proxyEntityClassId = 0

  /**
   * Graphics metafile type flag describing how proxy graphics were captured.
   *
   * Stored in DXF group code **91**. Also referred to as the object drawing
   * format in some DXF parsers.
   */
  private _graphicsMetafileType = 0

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
   * Count is stored in DXF group code **92**; each point uses group code **10**.
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
   * Gets the graphics metafile type flag.
   *
   * Corresponds to DXF group code **91**.
   *
   * @returns The metafile / object-drawing-format flag.
   */
  get graphicsMetafileType() {
    return this._graphicsMetafileType
  }

  /**
   * Sets the graphics metafile type flag.
   *
   * @param value - Metafile type (DXF group code **91**).
   */
  set graphicsMetafileType(value: number) {
    this._graphicsMetafileType = value
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
   * Emits the `AcDbProxyEntity` subclass marker followed by group codes **1**,
   * **3**, **1001**, **90**, **91**, **92**, **10**, **160**, and **310** as
   * appropriate.
   *
   * @param filer - DXF output filer.
   * @returns This entity for chaining.
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbProxyEntity')
    filer.writeString(1, this._originalDxfName)
    if (this._originalClassName) {
      filer.writeString(3, this._originalClassName)
    }
    if (this._applicationName) {
      filer.writeString(1001, this._applicationName)
    }
    filer.writeInt32(90, this._proxyEntityClassId)
    filer.writeInt32(91, this._graphicsMetafileType)
    if (this._entityOrigins.length > 0) {
      filer.writeInt32(92, this._entityOrigins.length)
      this._entityOrigins.forEach(origin => {
        filer.writePoint3d(10, origin)
      })
    }
    if (this._proxyGraphic?.length) {
      filer.writeInt32(160, this._proxyGraphic.length)
      let index = 0
      while (index < this._proxyGraphic.length) {
        const chunk = this._proxyGraphic.subarray(index, index + 127)
        filer.writeString(310, bytesToHexString(chunk))
        index += 127
      }
    }
    return this
  }

  /**
   * Loads proxy-graphic bytes from DXF group codes **160** and **310**.
   *
   * @param length - Expected byte length from group code **160**. When provided
   *   and positive, the result is truncated to this length.
   * @param hexChunks - One or more hexadecimal strings from group code **310**.
   */
  loadProxyGraphicFromDxf(length?: number, hexChunks?: string[]) {
    const data = loadAcDbProxyGraphicFromDxf(length, hexChunks)
    if (data) {
      this.setProxyGraphic(data)
    }
  }
}

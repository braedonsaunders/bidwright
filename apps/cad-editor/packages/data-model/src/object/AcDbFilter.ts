import { AcGePoint2d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject } from '../base/AcDbObject'

/**
 * Abstract base class for filter objects used with the AutoCAD index/filter
 * scheme.
 *
 * An {@link AcDbFilter} defines a query used when iterating block data through
 * filtered block iterators. The corresponding index class is obtained through
 * {@link AcDbFilter.indexClass}.
 *
 * @remarks
 * Mirrors the ObjectARX `AcDbFilter` class. Applications that provide a custom
 * indexing scheme typically also implement matching
 * {@link AcDbIndex} and filtered-block-iterator types.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=OARX-RefGuide-AcDbFilter
 *
 * @example
 * ```typescript
 * class MyFilter extends AcDbFilter {
 *   indexClass(): string {
 *     return 'MyIndex';
 *   }
 * }
 * ```
 */
export abstract class AcDbFilter extends AcDbObject {
  /**
   * Clip boundary vertices in OCS (SPATIAL_FILTER DXF groups 10/20).
   *
   * @remarks
   * These fields represent the generic clip-boundary data used by
   * `AcDbSpatialFilter` (DXF type `SPATIAL_FILTER`). No concrete spatial
   * filter class exists in this port yet (no `SPATIAL_FILTER` DXF reader
   * wiring), so this data is captured here for forward compatibility;
   * subclasses like {@link AcDbLayerFilter} simply never populate it.
   */
  private _boundaryVertices: AcGePoint2d[] = []
  /** Normal to the plane containing the clip boundary (DXF group 210). */
  private _clipBoundaryNormal?: AcGePoint3d
  /** Origin of the clip boundary's local coordinate system (DXF group 11). */
  private _clipBoundaryOrigin?: AcGePoint3d
  /** Whether the clip boundary is displayed (DXF group 71). */
  private _clipBoundaryDisplayEnabled = false
  /** Whether front clipping is enabled (DXF group 72). */
  private _frontClippingEnabled = false
  /** Front clipping plane distance, when enabled (DXF group 40). */
  private _frontClippingDistance?: number
  /** Whether back clipping is enabled (DXF group 73). */
  private _backClippingEnabled = false
  /** Back clipping plane distance, when enabled (DXF group 41). */
  private _backClippingDistance?: number

  /**
   * Creates a new {@link AcDbFilter} instance.
   */
  constructor() {
    super()
  }

  /**
   * Gets the clip boundary vertices in OCS (SPATIAL_FILTER DXF groups 10/20).
   */
  get boundaryVertices(): readonly AcGePoint2d[] {
    return this._boundaryVertices
  }

  /**
   * Sets the clip boundary vertices in OCS (SPATIAL_FILTER DXF groups 10/20).
   */
  set boundaryVertices(value: readonly AcGePoint2d[]) {
    this._boundaryVertices = value.map(vertex => vertex.clone())
  }

  /**
   * Gets the normal to the plane containing the clip boundary
   * (DXF group 210).
   */
  get clipBoundaryNormal() {
    return this._clipBoundaryNormal
  }

  /**
   * Sets the normal to the plane containing the clip boundary
   * (DXF group 210).
   */
  set clipBoundaryNormal(value: AcGePoint3d | undefined) {
    this._clipBoundaryNormal = value?.clone()
  }

  /**
   * Gets the origin of the clip boundary's local coordinate system
   * (DXF group 11).
   */
  get clipBoundaryOrigin() {
    return this._clipBoundaryOrigin
  }

  /**
   * Sets the origin of the clip boundary's local coordinate system
   * (DXF group 11).
   */
  set clipBoundaryOrigin(value: AcGePoint3d | undefined) {
    this._clipBoundaryOrigin = value?.clone()
  }

  /**
   * Gets whether the clip boundary is displayed (DXF group 71).
   */
  get clipBoundaryDisplayEnabled() {
    return this._clipBoundaryDisplayEnabled
  }

  /**
   * Sets whether the clip boundary is displayed (DXF group 71).
   */
  set clipBoundaryDisplayEnabled(value: boolean) {
    this._clipBoundaryDisplayEnabled = value
  }

  /**
   * Gets whether front clipping is enabled (DXF group 72).
   */
  get frontClippingEnabled() {
    return this._frontClippingEnabled
  }

  /**
   * Sets whether front clipping is enabled (DXF group 72).
   */
  set frontClippingEnabled(value: boolean) {
    this._frontClippingEnabled = value
  }

  /**
   * Gets the front clipping plane distance (DXF group 40).
   */
  get frontClippingDistance() {
    return this._frontClippingDistance
  }

  /**
   * Sets the front clipping plane distance (DXF group 40).
   */
  set frontClippingDistance(value: number | undefined) {
    this._frontClippingDistance = value
  }

  /**
   * Gets whether back clipping is enabled (DXF group 73).
   */
  get backClippingEnabled() {
    return this._backClippingEnabled
  }

  /**
   * Sets whether back clipping is enabled (DXF group 73).
   */
  set backClippingEnabled(value: boolean) {
    this._backClippingEnabled = value
  }

  /**
   * Gets the back clipping plane distance (DXF group 41).
   */
  get backClippingDistance() {
    return this._backClippingDistance
  }

  /**
   * Sets the back clipping plane distance (DXF group 41).
   */
  set backClippingDistance(value: number | undefined) {
    this._backClippingDistance = value
  }

  /**
   * Returns the class name of the {@link AcDbIndex}-derived type required to
   * process this filter.
   *
   * @remarks
   * In ObjectARX this method returns an `AcRxClass*`. This TypeScript port
   * returns the class name string instead.
   *
   * @returns The index class name associated with this filter.
   */
  abstract indexClass(): string

  /**
   * Writes DXF fields for this filter object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbFilter')
    // Only emit spatial-filter-style clip boundary data when present so
    // subclasses that don't use it (e.g. AcDbLayerFilter) are unaffected.
    if (this._boundaryVertices.length > 0) {
      filer.writeInt16(70, this._boundaryVertices.length)
      this._boundaryVertices.forEach(vertex => filer.writePoint2d(10, vertex))
      filer.writeVector3d(210, this._clipBoundaryNormal)
      filer.writePoint3d(11, this._clipBoundaryOrigin)
      filer.writeInt16(71, this._clipBoundaryDisplayEnabled ? 1 : 0)
      filer.writeInt16(72, this._frontClippingEnabled ? 1 : 0)
      if (this._frontClippingEnabled && this._frontClippingDistance != null) {
        filer.writeDouble(40, this._frontClippingDistance)
      }
      filer.writeInt16(73, this._backClippingEnabled ? 1 : 0)
      if (this._backClippingEnabled && this._backClippingDistance != null) {
        filer.writeDouble(41, this._backClippingDistance)
      }
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    // Empty subclass marker; derived classes continue with their own marker.
    filer.atSubclassData('AcDbFilter')

    let pendingVertex: { x: number; y: number } | null = null
    // Group 40 is overloaded on SPATIAL_FILTER: the first occurrence (right
    // after the front-clip flag) is the front clipping distance; any further
    // occurrences are 4x3 transform matrix entries that this generic base
    // class doesn't model.
    let frontDistanceConsumed = false

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      if (code === 100) {
        filer.pushBackItem(item)
        break
      }
      const n = Number(item.value)
      switch (code) {
        case 70:
          // Number of clip boundary points; informational (array length
          // below reflects the actual vertices read).
          break
        case 10:
          if (pendingVertex) {
            this._boundaryVertices.push(
              new AcGePoint2d(pendingVertex.x, pendingVertex.y)
            )
          }
          pendingVertex = { x: n, y: 0 }
          break
        case 20:
          if (pendingVertex) pendingVertex.y = n
          break
        case 210:
          this._clipBoundaryNormal = this._clipBoundaryNormal ?? new AcGePoint3d()
          this._clipBoundaryNormal.x = n
          break
        case 220:
          if (this._clipBoundaryNormal) this._clipBoundaryNormal.y = n
          break
        case 230:
          if (this._clipBoundaryNormal) this._clipBoundaryNormal.z = n
          break
        case 11:
          this._clipBoundaryOrigin = this._clipBoundaryOrigin ?? new AcGePoint3d()
          this._clipBoundaryOrigin.x = n
          break
        case 21:
          if (this._clipBoundaryOrigin) this._clipBoundaryOrigin.y = n
          break
        case 31:
          if (this._clipBoundaryOrigin) this._clipBoundaryOrigin.z = n
          break
        case 71:
          this._clipBoundaryDisplayEnabled = n !== 0
          break
        case 72:
          this._frontClippingEnabled = n !== 0
          break
        case 73:
          this._backClippingEnabled = n !== 0
          break
        case 40:
          if (!frontDistanceConsumed) {
            this._frontClippingDistance = n
            frontDistanceConsumed = true
          }
          break
        case 41:
          this._backClippingDistance = n
          break
        default:
          break
      }
    }

    if (pendingVertex) {
      this._boundaryVertices.push(
        new AcGePoint2d(pendingVertex.x, pendingVertex.y)
      )
    }
    return this
  }
}

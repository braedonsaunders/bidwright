import {
  AcGeBox2d,
  AcGeBox3d,
  AcGePoint3d,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../../base/AcDbDxfFiler'
import { AcDbPlotSettings } from './AcDbPlotSettings'

/**
 * Represents the stored characteristics of each paperspace layout.
 *
 * Layout objects are stored in an AcDbDictionary object with an ACAD_LAYOUT key,
 * allowing easy iteration and indexing. Each layout represents a paperspace
 * configuration that can be used for printing or plotting.
 *
 * @example
 * ```typescript
 * const layout = new AcDbLayout();
 * layout.layoutName = 'A4 Landscape';
 * layout.tabOrder = 1;
 * layout.limits = new AcGeBox2d();
 * ```
 */
export class AcDbLayout extends AcDbPlotSettings {
  /** The user-friendly layout name displayed in the tab control */
  private _layoutName: string
  /** The tab order field controlling the display order */
  private _tabOrder: number
  /** Flag indicating whether the layout tab is selected */
  private _tabSelected: boolean
  /** The associated block table record ID of this layout */
  private _blockTableRecordId: string
  /** Limits for this layout (defined by LIMMAX while this layout is current) */
  private _limits: AcGeBox2d
  /** The current extents setting of the layout */
  private _extents: AcGeBox3d
  /** Object IDs for viewports in this layout (paperspace). */
  private _viewportArray: string[]
  /**
   * ID/handle of the named `AcDbUCSTableRecord` for this layout, used when
   * `UCSORTHO` is 0 (DXF group 345).
   */
  private _namedUcsId?: string
  /**
   * ID/handle of the base `AcDbUCSTableRecord` when the layout's UCS is
   * orthographic (DXF group 346).
   */
  private _orthographicUcsId?: string
  /** Layout insertion base point (DXF group 12). */
  private _insertionPoint = new AcGePoint3d()
  /** UCS origin for this layout (DXF group 13). */
  private _ucsOrigin = new AcGePoint3d()
  /** UCS X axis (DXF group 16). */
  private _ucsXAxis = new AcGeVector3d(1, 0, 0)
  /** UCS Y axis (DXF group 17). */
  private _ucsYAxis = new AcGeVector3d(0, 1, 0)
  /** Elevation (DXF group 146). */
  private _elevation = 0
  /** Orthographic type of UCS (DXF group 76). */
  private _orthographicType = 0

  /**
   * Creates a new AcDbLayout instance.
   *
   * @example
   * ```typescript
   * const layout = new AcDbLayout();
   * ```
   */
  constructor() {
    super()
    this._tabOrder = -1
    this._tabSelected = false
    this._blockTableRecordId = ''
    this._layoutName = ''
    this._limits = new AcGeBox2d()
    this._extents = new AcGeBox3d()
    this._viewportArray = []
  }

  /**
   * Gets the user-friendly layout name that is displayed in the tab control.
   *
   * Currently there is no restriction on the name except that the length
   * is limited to 256 characters.
   *
   * @returns The layout name
   *
   * @example
   * ```typescript
   * const name = layout.layoutName;
   * console.log('Layout name:', name);
   * ```
   */
  get layoutName() {
    return this._layoutName
  }

  /**
   * Sets the user-friendly layout name that is displayed in the tab control.
   *
   * @param value - The new layout name (limited to 256 characters)
   *
   * @example
   * ```typescript
   * layout.layoutName = 'A4 Landscape';
   * ```
   */
  set layoutName(value: string) {
    this._layoutName = value.length > 256 ? value.slice(0, 256) : value
  }

  /**
   * Gets the tab order field, which controls the order in which layouts are displayed.
   *
   * The tab order should be unique and sequential for each layout in the database.
   *
   * @returns The tab order value
   *
   * @example
   * ```typescript
   * const order = layout.tabOrder;
   * ```
   */
  get tabOrder() {
    return this._tabOrder
  }

  /**
   * Sets the tab order field, which controls the order in which layouts are displayed.
   *
   * @param value - The new tab order value
   *
   * @example
   * ```typescript
   * layout.tabOrder = 1;
   * ```
   */
  set tabOrder(value: number) {
    this._tabOrder = value
  }

  /**
   * Gets whether the layout tab is included in the selection set for operations.
   *
   * This flag indicates whether the layout tab is included in the selection set
   * for operations that affect multiple tabs. The user can perform multiple
   * selection via the user interface using shift-click.
   *
   * @returns True if the tab is selected, false otherwise
   *
   * @example
   * ```typescript
   * const isSelected = layout.tabSelected;
   * ```
   */
  get tabSelected() {
    return this._tabSelected
  }

  /**
   * Sets whether the layout tab is included in the selection set for operations.
   *
   * @param value - True to select the tab, false to deselect it
   *
   * @example
   * ```typescript
   * layout.tabSelected = true;
   * ```
   */
  set tabSelected(value: boolean) {
    this._tabSelected = value
  }

  /**
   * Gets the associated block table record ID of this layout.
   *
   * @returns The block table record ID
   *
   * @example
   * ```typescript
   * const blockId = layout.blockTableRecordId;
   * ```
   */
  get blockTableRecordId() {
    return this._blockTableRecordId
  }

  /**
   * Sets the associated block table record ID of this layout.
   *
   * @param value - The new block table record ID
   *
   * @example
   * ```typescript
   * layout.blockTableRecordId = 'some-block-id';
   * ```
   */
  set blockTableRecordId(value: string) {
    this._blockTableRecordId = value
  }

  /**
   * Gets the limits for this layout.
   *
   * Limits are defined by LIMMAX while this layout is current.
   *
   * @returns The layout limits as a 2D bounding box
   *
   * @example
   * ```typescript
   * const limits = layout.limits;
   * console.log('Layout limits:', limits);
   * ```
   */
  get limits() {
    return this._limits
  }

  /**
   * Sets the limits for this layout.
   *
   * @param value - The new layout limits as a 2D bounding box
   *
   * @example
   * ```typescript
   * layout.limits = new AcGeBox2d();
   * ```
   */
  set limits(value: AcGeBox2d) {
    this._limits.copy(value)
  }

  /**
   * Gets the current extents setting of the layout.
   *
   * This value may not be the actual extents of the geometry in the layout,
   * it is just the value last saved in the layout.
   *
   * @returns The layout extents as a 3D bounding box
   *
   * @example
   * ```typescript
   * const extents = layout.extents;
   * console.log('Layout extents:', extents);
   * ```
   */
  get extents() {
    return this._extents
  }

  /**
   * Sets the current extents setting of the layout.
   *
   * @param value - The new layout extents as a 3D bounding box
   *
   * @example
   * ```typescript
   * layout.extents = new AcGeBox3d();
   * ```
   */
  set extents(value: AcGeBox3d) {
    this._extents.copy(value)
  }

  /**
   * Gets the paperspace viewport object IDs for this layout.
   */
  get viewportArray() {
    return this._viewportArray
  }

  /**
   * Sets the paperspace viewport object IDs for this layout.
   */
  set viewportArray(value: string[]) {
    this._viewportArray = value.slice()
  }

  /**
   * Gets the named UCS object ID used when `UCSORTHO` is 0 (DXF group 345).
   */
  get namedUcsId() {
    return this._namedUcsId
  }

  /**
   * Sets the named UCS object ID used when `UCSORTHO` is 0 (DXF group 345).
   */
  set namedUcsId(value: string | undefined) {
    this._namedUcsId = value
  }

  /**
   * Gets the base UCS object ID used when the layout's UCS is orthographic
   * (DXF group 346).
   */
  get orthographicUcsId() {
    return this._orthographicUcsId
  }

  /**
   * Sets the base UCS object ID used when the layout's UCS is orthographic
   * (DXF group 346).
   */
  set orthographicUcsId(value: string | undefined) {
    this._orthographicUcsId = value
  }

  /** Layout insertion base point (DXF group 12). */
  get insertionPoint() {
    return this._insertionPoint
  }
  set insertionPoint(value: AcGePoint3d) {
    this._insertionPoint.copy(value)
  }

  /** UCS origin for this layout (DXF group 13). */
  get ucsOrigin() {
    return this._ucsOrigin
  }
  set ucsOrigin(value: AcGePoint3d) {
    this._ucsOrigin.copy(value)
  }

  /** UCS X axis (DXF group 16). */
  get ucsXAxis() {
    return this._ucsXAxis
  }
  set ucsXAxis(value: AcGeVector3dLike) {
    this._ucsXAxis.copy(value)
  }

  /** UCS Y axis (DXF group 17). */
  get ucsYAxis() {
    return this._ucsYAxis
  }
  set ucsYAxis(value: AcGeVector3dLike) {
    this._ucsYAxis.copy(value)
  }

  /** Elevation (DXF group 146). */
  get elevation() {
    return this._elevation
  }
  set elevation(value: number) {
    this._elevation = value
  }

  /** Orthographic type of UCS (DXF group 76). */
  get orthographicType() {
    return this._orthographicType
  }
  set orthographicType(value: number) {
    this._orthographicType = value
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbLayout')
    filer.writeString(1, this.layoutName)
    filer.writeInt16(70, this.tabSelected ? 1 : 0)
    filer.writeInt16(71, this.tabOrder)
    // 330 - ID/handle to this layout's associated paper space block table record
    filer.writeObjectId(330, this.blockTableRecordId)
    // 331 - ID/handle to the viewport that was last active in this layout when the layout was current
    // TODO: Not sure passing 0 is the correct behavior if viewport array is empty
    filer.writeObjectId(
      331,
      this._viewportArray.length > 0 ? this._viewportArray[0] : '0'
    )
    filer.writePoint2d(10, this.limits.min)
    filer.writePoint2d(11, this.limits.max)
    filer.writePoint3d(14, this.extents.min)
    filer.writePoint3d(15, this.extents.max)
    filer.writePoint3d(12, this.insertionPoint)
    filer.writePoint3d(13, this.ucsOrigin)
    filer.writeVector3d(16, this.ucsXAxis)
    filer.writeVector3d(17, this.ucsYAxis)
    filer.writeDouble(146, this.elevation)
    filer.writeInt16(76, this.orthographicType)
    filer.writeObjectId(345, this._namedUcsId)
    filer.writeObjectId(346, this._orthographicUcsId)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbLayout')

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 1:
          this.layoutName = String(item.value)
          break
        case 70:
          this.tabSelected = n !== 0
          break
        case 71:
          this.tabOrder = n
          break
        case 330:
          this.blockTableRecordId = String(item.value)
          break
        case 331: {
          const vpId = String(item.value)
          if (vpId && vpId !== '0') {
            this.viewportArray = [vpId]
          }
          break
        }
        case 10:
          this.limits.min.x = n
          break
        case 20:
          this.limits.min.y = n
          break
        case 11:
          this.limits.max.x = n
          break
        case 21:
          this.limits.max.y = n
          break
        case 14:
          this.extents.min.x = n
          break
        case 24:
          this.extents.min.y = n
          break
        case 34:
          this.extents.min.z = n
          break
        case 15:
          this.extents.max.x = n
          break
        case 25:
          this.extents.max.y = n
          break
        case 35:
          this.extents.max.z = n
          break
        case 345:
          this.namedUcsId = String(item.value)
          break
        case 346:
          this.orthographicUcsId = String(item.value)
          break
        case 12:
          this.insertionPoint.x = n
          break
        case 22:
          this.insertionPoint.y = n
          break
        case 32:
          this.insertionPoint.z = n
          break
        case 13:
          this.ucsOrigin.x = n
          break
        case 23:
          this.ucsOrigin.y = n
          break
        case 33:
          this.ucsOrigin.z = n
          break
        case 16:
          this.ucsXAxis.x = n
          break
        case 26:
          this.ucsXAxis.y = n
          break
        case 36:
          this.ucsXAxis.z = n
          break
        case 17:
          this.ucsYAxis.x = n
          break
        case 27:
          this.ucsYAxis.y = n
          break
        case 37:
          this.ucsYAxis.z = n
          break
        case 76:
          this.orthographicType = n
          break
        case 146:
          this.elevation = n
          break
        case 100:
          filer.pushBackItem(item)
          return this
        default:
          break
      }
    }
    return this
  }
}

import { defaults } from '@mlightcad/common'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  AcDbAbstractViewTableRecord,
  AcDbAbstractViewTableRecordAttrs
} from './AcDbAbstractViewTableRecord'

/**
 * Interface defining the attributes for view table records.
 */
export interface AcDbViewTableRecordAttrs
  extends AcDbAbstractViewTableRecordAttrs {
  /** Standard flags for the view record */
  standardFlags: number
  /** View width in DCS */
  viewWidth: number
  /** Whether a UCS is associated with this view */
  ucsAssociated: boolean
  /** Whether the camera is plottable */
  cameraPlottable: boolean
  /** UCS elevation when a UCS is associated */
  ucsElevation: number
  /** Named UCS object ID (optional) */
  ucsObjectId?: string
  /** Base UCS object ID (optional) */
  ucsBaseObjectId?: string
  /** Background object ID for the view */
  backgroundObjectId?: string
  /** Live section object ID for the view */
  liveSectionObjectId?: string
  /** Hard-pointer ID to the sun object bound to this view (DXF group 361) */
  sunObjectId?: string
}

/**
 * Represents a view table record in AutoCAD.
 *
 * This class represents named views in AutoCAD, which store a camera-like
 * configuration including view direction, target, and display settings.
 *
 * @example
 * ```typescript
 * const viewRecord = new AcDbViewTableRecord();
 * viewRecord.name = 'Front';
 * viewRecord.viewWidth = 2000;
 * viewRecord.gsView.viewHeight = 1000;
 * ```
 */
export class AcDbViewTableRecord extends AcDbAbstractViewTableRecord<AcDbViewTableRecordAttrs> {
  /**
   * Creates a new AcDbViewTableRecord instance.
   *
   * @param attrs - Input attribute values for this view table record
   * @param defaultAttrs - Default values for attributes of this view table record
   */
  constructor(
    attrs?: Partial<AcDbViewTableRecordAttrs>,
    defaultAttrs?: Partial<AcDbViewTableRecordAttrs>
  ) {
    attrs = attrs || {}
    const viewWidthProvided = attrs.viewWidth !== undefined
    defaults(attrs, {
      standardFlags: 0,
      ucsAssociated: false,
      cameraPlottable: false,
      ucsElevation: 0
    })
    super(attrs, defaultAttrs)
    if (!viewWidthProvided) {
      this.viewWidth = this.viewHeight
    }
  }

  /**
   * Gets or sets the standard flags for this view record.
   */
  get standardFlags() {
    return this.getAttr('standardFlags')
  }
  set standardFlags(value: number) {
    this.setAttr('standardFlags', value)
  }

  /**
   * Gets or sets the view width in DCS.
   */
  get viewWidth() {
    return this.getAttr('viewWidth')
  }
  set viewWidth(value: number) {
    this.setAttr('viewWidth', value)
  }

  /**
   * Gets or sets whether a UCS is associated to this view.
   */
  get ucsAssociated() {
    return this.getAttr('ucsAssociated')
  }
  set ucsAssociated(value: boolean) {
    this.setAttr('ucsAssociated', value)
  }

  /**
   * Gets or sets whether the camera is plottable.
   */
  get cameraPlottable() {
    return this.getAttr('cameraPlottable')
  }
  set cameraPlottable(value: boolean) {
    this.setAttr('cameraPlottable', value)
  }

  /**
   * Gets or sets the UCS elevation when UCS is associated.
   */
  get ucsElevation() {
    return this.getAttr('ucsElevation')
  }
  set ucsElevation(value: number) {
    this.setAttr('ucsElevation', value)
  }

  /**
   * Gets or sets the named UCS object ID (optional).
   */
  get ucsObjectId() {
    return this.getAttrWithoutException('ucsObjectId')
  }
  set ucsObjectId(value: string | undefined) {
    this.setAttr('ucsObjectId', value)
  }

  /**
   * Gets or sets the base UCS object ID (optional).
   */
  get ucsBaseObjectId() {
    return this.getAttrWithoutException('ucsBaseObjectId')
  }
  set ucsBaseObjectId(value: string | undefined) {
    this.setAttr('ucsBaseObjectId', value)
  }

  /**
   * Gets or sets the background object ID (optional).
   */
  get backgroundObjectId() {
    return this.getAttrWithoutException('backgroundObjectId')
  }
  set backgroundObjectId(value: string | undefined) {
    this.setAttr('backgroundObjectId', value)
  }

  /**
   * Gets or sets the live section object ID (optional).
   */
  get liveSectionObjectId() {
    return this.getAttrWithoutException('liveSectionObjectId')
  }
  set liveSectionObjectId(value: string | undefined) {
    this.setAttr('liveSectionObjectId', value)
  }

  /**
   * Gets or sets the hard-pointer object ID to the sun bound to this view
   * (DXF group 361).
   */
  get sunObjectId() {
    return this.getAttrWithoutException('sunObjectId')
  }
  set sunObjectId(value: string | undefined) {
    this.setAttr('sunObjectId', value)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbViewTableRecord')
    filer.writeString(2, this.name)
    filer.writeInt16(70, this.standardFlags)
    filer.writeDouble(40, this.gsView.viewHeight)
    filer.writePoint2d(10, this.centerPoint)
    filer.writeDouble(41, this.viewWidth)
    filer.writePoint3d(11, this.gsView.viewDirectionFromTarget)
    filer.writePoint3d(12, this.gsView.viewTarget)
    filer.writeDouble(42, this.gsView.lensLength)
    filer.writeDouble(43, this.gsView.frontClippingPlane)
    filer.writeDouble(44, this.gsView.backClippingPlane)
    filer.writeAngle(50, this.gsView.viewTwistAngle)
    filer.writeInt16(71, this.gsView.viewMode)
    filer.writeInt16(281, this.gsView.renderMode)
    filer.writeInt16(72, this.ucsAssociated ? 1 : 0)
    filer.writeInt16(73, this.cameraPlottable ? 1 : 0)
    filer.writeObjectId(332, this.backgroundObjectId)
    filer.writeObjectId(334, this.liveSectionObjectId)
    filer.writeObjectId(348, this.gsView.visualStyleObjectId)
    filer.writeObjectId(361, this.sunObjectId)

    if (this.ucsAssociated) {
      filer.writePoint3d(110, this.gsView.ucsOrigin)
      filer.writePoint3d(111, this.gsView.ucsXAxis)
      filer.writePoint3d(112, this.gsView.ucsYAxis)
      filer.writeInt16(79, this.gsView.orthographicType)
      filer.writeDouble(146, this.ucsElevation)
      filer.writeObjectId(345, this.ucsObjectId)
      filer.writeObjectId(346, this.ucsBaseObjectId)
    }

    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbSymbolTableRecord')
    filer.atSubclassData('AcDbAbstractViewTableRecord')
    filer.atSubclassData('AcDbViewTableRecord')

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
        case 2:
          this.name = String(item.value)
          break
        case 70:
          this.standardFlags = n
          break
        case 40:
          this.gsView.viewHeight = n
          break
        case 10:
          this.centerPoint.x = n
          break
        case 20:
          this.centerPoint.y = n
          break
        case 41:
          this.viewWidth = n
          break
        case 11:
          this.gsView.viewDirectionFromTarget.x = n
          break
        case 21:
          this.gsView.viewDirectionFromTarget.y = n
          break
        case 31:
          this.gsView.viewDirectionFromTarget.z = n
          break
        case 12:
          this.gsView.viewTarget.x = n
          break
        case 22:
          this.gsView.viewTarget.y = n
          break
        case 32:
          this.gsView.viewTarget.z = n
          break
        case 42:
          this.gsView.lensLength = n
          break
        case 43:
          this.gsView.frontClippingPlane = n
          break
        case 44:
          this.gsView.backClippingPlane = n
          break
        case 50:
          this.gsView.viewTwistAngle = (n * Math.PI) / 180
          break
        case 71:
          this.gsView.viewMode = n
          break
        case 281:
          this.gsView.renderMode = n
          break
        case 72:
          this.ucsAssociated = n !== 0
          break
        case 73:
          this.cameraPlottable = n !== 0
          break
        case 332:
          this.backgroundObjectId = String(item.value)
          break
        case 334:
          this.liveSectionObjectId = String(item.value)
          break
        case 348:
          this.gsView.visualStyleObjectId = String(item.value)
          break
        case 361:
          this.sunObjectId = String(item.value)
          break
        case 110:
          this.gsView.ucsOrigin.x = n
          break
        case 120:
          this.gsView.ucsOrigin.y = n
          break
        case 130:
          this.gsView.ucsOrigin.z = n
          break
        case 111:
          this.gsView.ucsXAxis.x = n
          break
        case 121:
          this.gsView.ucsXAxis.y = n
          break
        case 131:
          this.gsView.ucsXAxis.z = n
          break
        case 112:
          this.gsView.ucsYAxis.x = n
          break
        case 122:
          this.gsView.ucsYAxis.y = n
          break
        case 132:
          this.gsView.ucsYAxis.z = n
          break
        case 79:
          this.gsView.orthographicType = n
          break
        case 146:
          this.ucsElevation = n
          break
        case 345:
          this.ucsObjectId = String(item.value)
          break
        case 346:
          this.ucsBaseObjectId = String(item.value)
          break
        default:
          break
      }
    }
    return this
  }
}

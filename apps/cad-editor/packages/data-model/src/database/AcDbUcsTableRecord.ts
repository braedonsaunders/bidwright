import { defaults } from '@mlightcad/common'
import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  AcDbSymbolTableRecord,
  AcDbSymbolTableRecordAttrs
} from './AcDbSymbolTableRecord'

/**
 * Attributes for a UCS table record.
 */
export interface AcDbUcsTableRecordAttrs extends AcDbSymbolTableRecordAttrs {
  /** Standard flags (group 70) */
  standardFlags: number
  /** UCS origin */
  origin: AcGePoint3d
  /** UCS X axis direction */
  xAxis: AcGePoint3d
  /** UCS Y axis direction */
  yAxis: AcGePoint3d
  /** Whether this UCS is orthographic (DXF group 79) */
  isOrthographic: boolean
  /** Elevation of this UCS (DXF group 146) */
  elevation: number
  /**
   * ID/handle of the base UCS when this UCS is orthographic; assumed to be
   * WORLD if absent (DXF group 346)
   */
  baseUcsId?: string
  /**
   * Orthographic type paired with {@link orthographicOrigin}: 1=Top,
   * 2=Bottom, 3=Front, 4=Back, 5=Left, 6=Right (DXF group 71)
   */
  orthographicType?: number
  /**
   * Origin for {@link orthographicType} relative to this UCS
   * (DXF groups 13/23/33)
   */
  orthographicOrigin?: AcGePoint3d
}

/**
 * Named User Coordinate System table record (DXF UCS table).
 */
export class AcDbUcsTableRecord extends AcDbSymbolTableRecord<AcDbUcsTableRecordAttrs> {
  constructor(
    attrs?: Partial<AcDbUcsTableRecordAttrs>,
    defaultAttrs?: Partial<AcDbUcsTableRecordAttrs>
  ) {
    attrs = attrs || {}
    defaults(attrs, {
      standardFlags: 0,
      origin: new AcGePoint3d(0, 0, 0),
      xAxis: new AcGePoint3d(1, 0, 0),
      yAxis: new AcGePoint3d(0, 1, 0),
      isOrthographic: false,
      elevation: 0
    })
    super(attrs, defaultAttrs)
  }

  get standardFlags() {
    return this.getAttr('standardFlags')
  }
  set standardFlags(value: number) {
    this.setAttr('standardFlags', value)
  }

  get origin() {
    return this.getAttr('origin')
  }
  set origin(value: AcGePoint3d) {
    this.setAttr('origin', value.clone())
  }

  get xAxis() {
    return this.getAttr('xAxis')
  }
  set xAxis(value: AcGePoint3d) {
    this.setAttr('xAxis', value.clone())
  }

  get yAxis() {
    return this.getAttr('yAxis')
  }
  set yAxis(value: AcGePoint3d) {
    this.setAttr('yAxis', value.clone())
  }

  /** Whether this UCS is orthographic (DXF group 79). */
  get isOrthographic() {
    return this.getAttr('isOrthographic')
  }
  set isOrthographic(value: boolean) {
    this.setAttr('isOrthographic', value)
  }

  /** Elevation of this UCS (DXF group 146). */
  get elevation() {
    return this.getAttr('elevation')
  }
  set elevation(value: number) {
    this.setAttr('elevation', value)
  }

  /**
   * ID/handle of the base UCS when this UCS is orthographic (DXF group 346).
   */
  get baseUcsId() {
    return this.getAttrWithoutException('baseUcsId')
  }
  set baseUcsId(value: string | undefined) {
    this.setAttr('baseUcsId', value)
  }

  /**
   * Orthographic type paired with {@link orthographicOrigin}
   * (DXF group 71).
   */
  get orthographicType() {
    return this.getAttrWithoutException('orthographicType')
  }
  set orthographicType(value: number | undefined) {
    this.setAttr('orthographicType', value)
  }

  /**
   * Origin for {@link orthographicType} relative to this UCS
   * (DXF groups 13/23/33).
   */
  get orthographicOrigin() {
    return this.getAttrWithoutException('orthographicOrigin')
  }
  set orthographicOrigin(value: AcGePoint3d | undefined) {
    this.setAttr('orthographicOrigin', value?.clone())
  }

  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbUCSTableRecord')
    filer.writeString(2, this.name)
    filer.writeInt16(70, this.standardFlags)
    filer.writePoint3d(10, this.origin)
    filer.writePoint3d(11, this.xAxis)
    filer.writePoint3d(12, this.yAxis)
    filer.writeDouble(146, this.elevation)
    filer.writeInt16(79, this.isOrthographic ? 1 : 0)
    if (this.isOrthographic) {
      filer.writeObjectId(346, this.baseUcsId)
    }
    if (this.orthographicType != null && this.orthographicOrigin) {
      filer.writeInt16(71, this.orthographicType)
      filer.writePoint3d(13, this.orthographicOrigin)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbSymbolTableRecord')
    filer.atSubclassData('AcDbUCSTableRecord')

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
        case 10:
          this.origin.x = n
          break
        case 20:
          this.origin.y = n
          break
        case 30:
          this.origin.z = n
          break
        case 11:
          this.xAxis.x = n
          break
        case 21:
          this.xAxis.y = n
          break
        case 31:
          this.xAxis.z = n
          break
        case 12:
          this.yAxis.x = n
          break
        case 22:
          this.yAxis.y = n
          break
        case 32:
          this.yAxis.z = n
          break
        case 79:
          this.isOrthographic = n !== 0
          break
        case 146:
          this.elevation = n
          break
        case 346:
          this.baseUcsId = String(item.value)
          break
        case 71:
          this.orthographicType = n
          break
        case 13:
          this.orthographicOrigin = this.orthographicOrigin ?? new AcGePoint3d()
          this.orthographicOrigin.x = n
          break
        case 23:
          if (this.orthographicOrigin) this.orthographicOrigin.y = n
          break
        case 33:
          if (this.orthographicOrigin) this.orthographicOrigin.z = n
          break
        default:
          break
      }
    }
    return this
  }
}

import { AcCmColor } from '@mlightcad/common'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject } from '../base/AcDbObject'

/**
 * One element definition in an MLINE style.
 */
export interface AcDbMlineStyleElement {
  /**
   * Offset from the MLINE reference axis.
   */
  offset: number
  /**
   * Color definition for this element.
   */
  color: AcCmColor
  /**
   * Linetype name for this element.
   */
  lineType: string
}

/**
 * Represents the nongraphical MLINESTYLE object.
 */
export class AcDbMlineStyle extends AcDbObject {
  private _styleName: string
  private _flags: number
  private _description: string
  private _fillColor: AcCmColor
  private _startAngle: number
  private _endAngle: number
  private _elements: AcDbMlineStyleElement[]

  constructor() {
    super()
    this._styleName = 'STANDARD'
    this._flags = 0
    this._description = ''
    this._fillColor = new AcCmColor()
    this._startAngle = 90
    this._endAngle = 90
    this._elements = []
  }

  get styleName() {
    return this._styleName
  }
  set styleName(value: string) {
    this._styleName = value
  }

  get flags() {
    return this._flags
  }
  set flags(value: number) {
    this._flags = value
  }

  get description() {
    return this._description
  }
  set description(value: string) {
    this._description = value
  }

  get fillColor() {
    return this._fillColor
  }
  set fillColor(value: AcCmColor) {
    this._fillColor.copy(value)
  }

  /**
   * Gets/sets start angle in DXF degree units.
   */
  get startAngle() {
    return this._startAngle
  }
  set startAngle(value: number) {
    this._startAngle = value
  }

  /**
   * Gets/sets end angle in DXF degree units.
   */
  get endAngle() {
    return this._endAngle
  }
  set endAngle(value: number) {
    this._endAngle = value
  }

  get elementCount() {
    return this._elements.length
  }

  get elements() {
    return this._elements.map(element => ({
      offset: element.offset,
      color: element.color.clone(),
      lineType: element.lineType
    }))
  }
  set elements(value: AcDbMlineStyleElement[]) {
    this._elements = value.map(element => ({
      offset: element.offset,
      color: element.color.clone(),
      lineType: element.lineType
    }))
  }

  addElement(element: AcDbMlineStyleElement) {
    this._elements.push({
      offset: element.offset,
      color: element.color.clone(),
      lineType: element.lineType
    })
  }

  removeElementAt(index: number) {
    if (index < 0 || index >= this._elements.length) {
      throw new Error('The element index is out of range!')
    }
    this._elements.splice(index, 1)
  }

  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbMlineStyle')
    filer.writeString(2, this.styleName)
    filer.writeInt16(70, this.flags)
    filer.writeString(3, this.description)
    filer.writeCmColor(this.fillColor)
    filer.writeDouble(51, this.startAngle)
    filer.writeDouble(52, this.endAngle)
    filer.writeInt16(71, this.elementCount)
    this._elements.forEach(element => {
      filer.writeDouble(49, element.offset)
      filer.writeCmColor(element.color)
      filer.writeString(6, element.lineType)
    })
    return this
  }
}

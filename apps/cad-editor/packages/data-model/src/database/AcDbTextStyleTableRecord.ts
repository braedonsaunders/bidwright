import { defaults } from '@mlightcad/common'
import { AcGiTextStyle } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  AcDbSymbolTableRecord,
  AcDbSymbolTableRecordAttrs
} from './AcDbSymbolTableRecord'

/**
 * Interface defining the attributes for text style table records.
 *
 * Merges {@link AcDbSymbolTableRecordAttrs} with {@link AcGiTextStyle} fields
 * (excluding the duplicate `name` property).
 */
export interface AcDbTextStyleTableRecordAttrs
  extends AcDbSymbolTableRecordAttrs,
    Omit<AcGiTextStyle, 'name'> {}

/**
 * Represents a record in the text style table.
 *
 * This class represents the records that are found in the text style table (known as the "style"
 * table in DXF). Each of these records represents a specific set of text parameters such as font,
 * default size, relative x scaling, vertical or horizontal orientation, etc.
 *
 * @example
 * ```typescript
 * const record = new AcDbTextStyleTableRecord({
 *   name: 'MyStyle',
 *   font: 'Arial'
 * });
 * ```
 */
export class AcDbTextStyleTableRecord extends AcDbSymbolTableRecord<AcDbTextStyleTableRecordAttrs> {
  /**
   * Creates a new AcDbTextStyleTableRecord instance.
   *
   * Property `font` may be empty. When it contains a file extension, the extension is removed
   * during construction.
   *
   * @param attrs - Input attribute values for this text style table record
   * @param defaultAttrs - Default values for attributes of this text style table record
   *
   * @example
   * ```typescript
   * const record = new AcDbTextStyleTableRecord({
   *   name: 'MyStyle',
   *   font: 'Arial'
   * });
   * ```
   */
  constructor(
    attrs?: Partial<AcDbTextStyleTableRecordAttrs>,
    defaultAttrs?: Partial<AcDbTextStyleTableRecordAttrs>
  ) {
    attrs = attrs || {}
    defaults(attrs, {
      standardFlag: 0,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0,
      font: '',
      bigFont: ''
    })
    super(attrs, defaultAttrs)

    this.setAttr(
      'font',
      this.getFileNameWithoutExtension(
        this.getAttr('font') ||
          this.getAttrWithoutException('extendedFont') ||
          this.name
      )
    )
  }

  /**
   * Gets or sets the obliquing angle.
   *
   * The obliquing angle is the angle from the text's vertical; that is, the
   * top of the text "slants" relative to the bottom. Positive angles slant
   * characters forward at their tops.
   *
   * @returns The obliquing angle in radians
   *
   * @example
   * ```typescript
   * record.obliquingAngle = Math.PI / 6; // 30 degrees
   * ```
   */
  get obliquingAngle() {
    return this.getAttr('obliqueAngle')
  }
  set obliquingAngle(value: number) {
    this.setAttr('obliqueAngle', value)
  }

  /**
   * Gets or sets the text height used for the last text created using this text style.
   *
   * This value is updated automatically by AutoCAD after the creation of any text object
   * that references this text style table record. If {@link textSize} is 0, then priorSize
   * is used as the default text height for the next text created using this text style.
   *
   * @returns The prior text size
   *
   * @example
   * ```typescript
   * record.priorSize = 12.0;
   * ```
   */
  get priorSize() {
    return this.getAttr('lastHeight')
  }
  set priorSize(value: number) {
    this.setAttr('lastHeight', value)
  }

  /**
   * Gets or sets the default size of the text drawn with this text style.
   *
   * If the text size is set to 0, AutoCAD prompts for a text height when creating text.
   * If textSize is non-zero, that fixed height is used instead.
   *
   * @returns The default text size
   *
   * @example
   * ```typescript
   * record.textSize = 10.0; // Fixed text height
   * ```
   */
  get textSize() {
    return this.getAttr('fixedTextHeight')
  }
  set textSize(value: number) {
    this.setAttr('fixedTextHeight', value)
  }

  /**
   * Gets or sets the width factor (also referred to as the relative X-scale factor) for the text style.
   *
   * The width factor is applied to the text's width independently of the height. For example,
   * a value of 0.8 draws text at 80% of its normal width.
   *
   * @returns The width factor
   *
   * @example
   * ```typescript
   * record.xScale = 0.8; // 80% width
   * ```
   */
  get xScale() {
    return this.getAttr('widthFactor')
  }
  set xScale(value: number) {
    this.setAttr('widthFactor', value)
  }

  /**
   * Gets or sets whether text drawn with this text style is drawn vertically.
   *
   * Maps to standard flag bit 4 in group code 70.
   *
   * @returns True if text is drawn vertically, false otherwise
   *
   * @example
   * ```typescript
   * record.isVertical = true;
   * ```
   */
  get isVertical() {
    return (this.getAttr('standardFlag') & 4) === 4
  }
  set isVertical(value: boolean) {
    const standardFlag = this.getAttr('standardFlag')
    this.setAttr('standardFlag', value ? standardFlag | 4 : standardFlag & ~4)
  }

  /**
   * Gets or sets whether this entry describes a shape file definition rather than a text style.
   *
   * When true, the record represents a shape file definition in the STYLE table
   * (standard flag bit 1) and typically has an empty name.
   *
   * @returns True if this entry is a shape file definition, false otherwise
   *
   * @example
   * ```typescript
   * if (record.isShapeFile) {
   *   console.log('Shape file definition:', record.fileName);
   * }
   * ```
   */
  get isShapeFile() {
    return (this.getAttr('standardFlag') & 1) === 1
  }
  set isShapeFile(value: boolean) {
    const standardFlag = this.getAttr('standardFlag')
    this.setAttr('standardFlag', value ? standardFlag | 1 : standardFlag & ~1)
  }

  /**
   * Gets or sets the name of the font file for this text style.
   *
   * @returns The font file name
   *
   * @example
   * ```typescript
   * record.fileName = 'Arial';
   * ```
   */
  get fileName() {
    return this.getAttr('font')
  }
  set fileName(value: string) {
    this.setAttr('font', value)
  }

  /**
   * Gets or sets the name of the big font file for this text style.
   *
   * Big font files are used for languages that require more than 256 characters,
   * such as Chinese, Japanese, and Korean.
   *
   * @returns The big font file name
   *
   * @example
   * ```typescript
   * record.bigFontFileName = 'bigfont.shx';
   * ```
   */
  get bigFontFileName() {
    return this.getAttr('bigFont')
  }
  set bigFontFileName(value: string) {
    this.setAttr('bigFont', value)
  }

  /**
   * Gets the text style information used by the renderer.
   *
   * Returns a snapshot assembled from stored attributes. Mutating the returned object
   * does not update this table record; use the dedicated setters instead.
   *
   * @returns The text style configuration assembled from stored attributes
   *
   * @example
   * ```typescript
   * const textStyle = record.textStyle;
   * console.log('Font:', textStyle.font);
   * ```
   */
  get textStyle(): AcGiTextStyle {
    return {
      name: this.name,
      standardFlag: this.getAttr('standardFlag'),
      fixedTextHeight: this.getAttr('fixedTextHeight'),
      widthFactor: this.getAttr('widthFactor'),
      obliqueAngle: this.getAttr('obliqueAngle'),
      textGenerationFlag: this.getAttr('textGenerationFlag'),
      lastHeight: this.getAttr('lastHeight'),
      font: this.getAttr('font'),
      bigFont: this.getAttr('bigFont'),
      extendedFont: this.getAttrWithoutException('extendedFont')
    }
  }

  /**
   * Removes the file extension from a file name.
   *
   * @param pathName - The file path or name
   * @returns The file name without extension
   */
  private getFileNameWithoutExtension(pathName: string) {
    const fileName = pathName.split('/').pop()
    if (fileName) {
      const dotIndex = fileName.lastIndexOf('.')
      if (dotIndex === -1) {
        return fileName
      }
      return fileName.substring(0, dotIndex)
    }
    return pathName
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbTextStyleTableRecord')
    filer.writeString(2, this.name)
    filer.writeInt16(70, this.getAttr('standardFlag'))
    filer.writeDouble(40, this.textSize)
    filer.writeDouble(41, this.xScale)
    filer.writeAngle(50, this.obliquingAngle)
    filer.writeInt16(71, this.getAttr('textGenerationFlag'))
    filer.writeDouble(42, this.priorSize)
    filer.writeString(3, this.fileName)
    filer.writeString(4, this.bigFontFileName)
    return this
  }
}
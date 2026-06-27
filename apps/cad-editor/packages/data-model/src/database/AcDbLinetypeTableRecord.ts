import { defaults } from '@mlightcad/common'
import {
  AcGiBaseLineStyle,
  AcGiLineTypePatternElement
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  AcDbSymbolTableRecord,
  AcDbSymbolTableRecordAttrs
} from './AcDbSymbolTableRecord'

export interface AcDbLinetypePreviewSvgOptions {
  /**
   * Width of preview SVG.
   * @default 220
   */
  width?: number
  /**
   * Height of preview SVG.
   * @default 36
   */
  height?: number
  /**
   * Left/right horizontal padding in pixels.
   * @default 8
   */
  padding?: number
  /**
   * Stroke width in pixels.
   * @default 2
   */
  strokeWidth?: number
  /**
   * Stroke color.
   * @default 'currentColor'
   */
  stroke?: string
  /**
   * How many pattern cycles to display in preview width.
   * @default 4
   */
  repeats?: number
}

/**
 * Interface defining the attributes for linetype table records.
 *
 * Merges {@link AcDbSymbolTableRecordAttrs} with {@link AcGiBaseLineStyle} fields
 * (excluding the duplicate `name` property).
 */
export interface AcDbLinetypeTableRecordAttrs
  extends AcDbSymbolTableRecordAttrs,
    Omit<AcGiBaseLineStyle, 'name'> {}

/**
 * Represents a record in the line type table within the AutoCAD drawing database.
 *
 * Each line type table record contains the information necessary to define a specific line type,
 * including its pattern, description, and rendering characteristics. Line types define how lines
 * are drawn, including patterns of dashes, dots, and spaces.
 *
 * Within the line type table record, the dashes (line segments that make up characteristics of the
 * linetype) are stored in a list with an index that is zero based. If the linetype is complex, then
 * embedded shapes or text strings are stored in the list at the same index as the dash that preceded
 * them in the linetype definition. So there will always be a dashLength for any valid index in the
 * list, even if there is a shape or text string sharing the same index. When the linetype is elaborated,
 * a shape's insertion point will coincide with the end of the dash that it shares an index with.
 */
export class AcDbLinetypeTableRecord extends AcDbSymbolTableRecord<AcDbLinetypeTableRecordAttrs> {
  /**
   * Creates a new line type table record.
   *
   * @param attrs - Input attribute values for this linetype table record
   * @param defaultAttrs - Default values for attributes of this linetype table record
   *
   * @example
   * ```typescript
   * const record = new AcDbLinetypeTableRecord({
   *   name: 'DASHED',
   *   description: 'Dashed',
   *   totalPatternLength: 1,
   *   pattern: [{ elementLength: 0.5, elementTypeFlag: 0 }]
   * });
   * ```
   */
  constructor(
    attrs?: Partial<AcDbLinetypeTableRecordAttrs>,
    defaultAttrs?: Partial<AcDbLinetypeTableRecordAttrs>
  ) {
    attrs = attrs || {}
    defaults(attrs, {
      standardFlag: 0,
      description: '',
      totalPatternLength: 0
    })
    super(attrs, defaultAttrs)
  }

  /**
   * Gets the number of dash elements in the line type pattern.
   *
   * This value represents the total count of dashes, spaces, dots, and other pattern elements
   * that make up the line type. It corresponds to DXF group code 73 in the AutoCAD file format.
   *
   * @returns The number of pattern elements in the line type
   */
  get numDashes() {
    const pattern = this.getAttrWithoutException('pattern')
    return pattern ? pattern.length : 0
  }

  /**
   * Gets the total pattern length in AutoCAD drawing units.
   *
   * The pattern length represents the total length of all dashes and spaces when the line type
   * scale is 1.0. This value is used to calculate how the pattern repeats along a line.
   *
   * Note: Embedded shapes or text strings do not add to the pattern length because they are
   * overlaid and do not interrupt the actual dash pattern.
   *
   * @returns The total length of the line type pattern in drawing units
   */
  get patternLength() {
    return this.getAttr('totalPatternLength')
  }

  /**
   * Gets the description or comments associated with this line type.
   *
   * This property provides additional information about the line type, such as its intended
   * use or any special characteristics.
   *
   * @returns The description text for the line type
   */
  get comments() {
    return this.getAttr('description')
  }

  /**
   * Gets the line type style object used by the renderer.
   *
   * Returns a snapshot assembled from stored attributes. Mutating the returned object
   * does not update this table record; use the dedicated setters instead.
   *
   * @returns The line type style object assembled from stored attributes
   */
  get linetype(): AcGiBaseLineStyle {
    return {
      name: this.name,
      standardFlag: this.getAttr('standardFlag'),
      description: this.getAttr('description'),
      totalPatternLength: this.getAttr('totalPatternLength'),
      pattern: this.getAttrWithoutException('pattern')
    }
  }

  /**
   * Gets the length of a specific dash element in the line type pattern.
   *
   * Each dash element in the pattern has a specific length that determines how it appears
   * when the line type is rendered. Positive values represent visible dashes, while negative
   * values represent spaces (pen up).
   *
   * @param index - Zero-based index of the dash element. Must be greater than or equal to zero,
   *                but less than the value of property 'numDashes'
   * @returns The length of the specified dash element in drawing units
   * @throws {Error} When the index is out of range
   */
  dashLengthAt(index: number) {
    if (index < 0 || index >= this.numDashes) {
      throw new Error(
        'Index must be greater than or equal to zero, but less than the value of property "numDashes".'
      )
    }
    return this.getAttr('pattern')![index].elementLength
  }

  /**
   * Converts this linetype preview to an SVG string.
   *
   * The preview is rendered as a horizontal line centered in the SVG viewport.
   * Positive pattern elements are drawn as visible strokes, negative elements
   * are treated as gaps, and zero-length elements are rendered as dots.
   *
   * @param options - Preview rendering options
   * @returns SVG string for linetype preview
   */
  toPreviewSvgString(options?: AcDbLinetypePreviewSvgOptions) {
    const width = Math.max(options?.width ?? 220, 1)
    const height = Math.max(options?.height ?? 36, 1)
    const padding = Math.min(
      Math.max(options?.padding ?? 8, 0),
      Math.floor(width / 2)
    )
    const strokeWidth = Math.max(options?.strokeWidth ?? 2, 0.5)
    const stroke = this.escapeSvgAttribute(options?.stroke ?? 'currentColor')
    const repeats = Math.max(options?.repeats ?? 4, 1)
    const y = height / 2
    const startX = padding
    const endX = Math.max(width - padding, startX + 1)
    const previewWidth = endX - startX
    const pattern = this.getAttrWithoutException('pattern') ?? []

    if (
      pattern.length === 0 ||
      this.patternLength <= 0 ||
      !pattern.some(
        (item: AcGiLineTypePatternElement) => item.elementLength !== 0
      )
    ) {
      return this.buildSvgString({
        width,
        height,
        stroke,
        strokeWidth,
        lineSegments: [[startX, endX]],
        dots: [],
        y
      })
    }

    const lineSegments: Array<[number, number]> = []
    const dots: number[] = []
    const unitToPx = previewWidth / (this.patternLength * repeats)
    const minSegmentPx = 0.5
    const dotStep = Math.max(strokeWidth * 2, 2)
    let currentX = startX

    while (currentX < endX) {
      for (const item of pattern) {
        if (currentX >= endX) break

        const length = item.elementLength
        if (length === 0) {
          dots.push(currentX)
          currentX = Math.min(currentX + dotStep, endX)
          continue
        }

        const segmentLengthPx = Math.max(
          Math.abs(length) * unitToPx,
          minSegmentPx
        )
        const nextX = Math.min(currentX + segmentLengthPx, endX)
        if (length > 0 && nextX > currentX) {
          lineSegments.push([currentX, nextX])
        }
        currentX = nextX
      }
    }

    return this.buildSvgString({
      width,
      height,
      stroke,
      strokeWidth,
      lineSegments,
      dots,
      y
    })
  }

  private buildSvgString(input: {
    width: number
    height: number
    stroke: string
    strokeWidth: number
    lineSegments: Array<[number, number]>
    dots: number[]
    y: number
  }) {
    const { width, height, stroke, strokeWidth, lineSegments, dots, y } = input
    const lines = lineSegments
      .map(
        ([x1, x2]) =>
          `<line x1="${x1.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x2.toFixed(
            2
          )}" y2="${y.toFixed(2)}" stroke="${stroke}" stroke-width="${strokeWidth.toFixed(
            2
          )}" stroke-linecap="round" />`
      )
      .join('')
    const circles = dots
      .map(
        x =>
          `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(
            2
          )}" r="${(strokeWidth / 2).toFixed(2)}" fill="${stroke}" />`
      )
      .join('')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.escapeSvgAttribute(this.name)} linetype preview">${lines}${circles}</svg>`
  }

  private escapeSvgAttribute(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;')
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbLinetypeTableRecord')
    filer.writeString(2, this.name)
    filer.writeInt16(70, this.getAttr('standardFlag'))
    filer.writeString(3, this.comments)
    filer.writeInt16(72, 65)
    filer.writeInt16(73, this.numDashes)
    filer.writeDouble(40, this.patternLength)
    for (const item of this.getAttrWithoutException('pattern') ?? []) {
      filer.writeDouble(49, item.elementLength)
      filer.writeInt16(74, item.elementTypeFlag)
    }
    return this
  }
}
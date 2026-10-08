import { AcCmColor } from '@mlightcad/common'
import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiMTextAttachmentPoint,
  AcGiMTextData,
  AcGiMTextFlowDirection,
  AcGiRenderer,
  AcGiTextStyle
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { DEFAULT_TEXT_STYLE } from '../misc/AcDbConstants'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbEstimatePlainTextWidth } from './AcDbTextExtentsHelpers'

/**
 * How characters are distributed between the arc's left and right offsets.
 *
 * Values match DXF group 72 / LibreDWG `alignment`:
 * 1 fit, 2 left, 3 right, 4 center.
 */
export enum AcDbArcTextAlignment {
  Fit = 1,
  Left = 2,
  Right = 3,
  Center = 4
}

/**
 * Which way the glyph "up" direction points relative to the arc center.
 *
 * Values match DXF group 71: 1 outward from center, 2 inward to the center.
 */
export enum AcDbArcTextDirection {
  OutwardFromCenter = 1,
  InwardToTheCenter = 2
}

/**
 * Which side of the reference arc the text sits on.
 *
 * Values match DXF group 73: 1 convex (outside), 2 concave (inside).
 */
export enum AcDbArcTextPosition {
  OnConvexSide = 1,
  OnConcaveSide = 2
}

/** One character of an {@link AcDbArcAlignedText}, placed on the arc. */
export interface AcDbArcAlignedTextGlyph {
  text: string
  position: AcGePoint3d
  rotation: number
}

const TWO_PI = Math.PI * 2

function parseFinite(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Arc-aligned text created by the AutoCAD Express Tools `ARCTEXT` command.
 *
 * This is not `AcDbText`. The string is laid out along an arc
 * (center, radius, start angle, end angle), one glyph at a time, with its
 * baseline following the arc tangent.
 */
export class AcDbArcAlignedText extends AcDbEntity {
  static override typeName: string = 'ArcAlignedText'

  override get dxfTypeName() {
    return 'ARCALIGNEDTEXT'
  }

  private _textString = ''
  private _textSize = 0
  private _xScale = 1
  private _characterSpacing = 0
  private _styleName = ''
  private _fontName = ''
  private _bigFontName = ''
  private _offsetFromArc = 0
  private _rightOffset = 0
  private _leftOffset = 0
  private _center = new AcGePoint3d()
  private _radius = 0
  private _startAngle = 0
  private _endAngle = 0
  private _normal = new AcGeVector3d(0, 0, 1)
  private _characterSet = 0
  private _pitchAndFamily = 0
  private _isShx = false
  private _isBold = false
  private _isItalic = false
  private _isUnderlined = false
  private _alignment = AcDbArcTextAlignment.Fit
  private _isReverse = false
  private _wizardFlag = 0
  private _textPosition = AcDbArcTextPosition.OnConvexSide
  private _textDirection = AcDbArcTextDirection.OutwardFromCenter
  private _arcId = ''
  /** Last DXF group 90 / LibreDWG raw color, when known. */
  private _rawTextColor: number | undefined

  get textString() {
    return this._textString
  }
  set textString(value: string) {
    this._textString = value ?? ''
  }

  /** Text height (DXF group 42). */
  get textSize() {
    return this._textSize
  }
  set textSize(value: number) {
    this._textSize = value
  }

  /** Width factor (DXF group 41). */
  get xScale() {
    return this._xScale
  }
  set xScale(value: number) {
    this._xScale = value
  }

  /** Extra distance inserted between characters, in drawing units. */
  get characterSpacing() {
    return this._characterSpacing
  }
  set characterSpacing(value: number) {
    this._characterSpacing = value
  }

  get styleName() {
    return this._styleName
  }
  set styleName(value: string) {
    this._styleName = value ?? ''
  }

  get fontName() {
    return this._fontName
  }
  set fontName(value: string) {
    this._fontName = value ?? ''
  }

  get bigFontName() {
    return this._bigFontName
  }
  set bigFontName(value: string) {
    this._bigFontName = value ?? ''
  }

  /** Radial distance from the reference arc to the text baseline. */
  get offsetFromArc() {
    return this._offsetFromArc
  }
  set offsetFromArc(value: number) {
    this._offsetFromArc = value
  }

  get rightOffset() {
    return this._rightOffset
  }
  set rightOffset(value: number) {
    this._rightOffset = value
  }

  get leftOffset() {
    return this._leftOffset
  }
  set leftOffset(value: number) {
    this._leftOffset = value
  }

  /** Arc center in OCS (DXF group 10). */
  get center(): AcGePoint3d {
    return this._center
  }
  set center(value: AcGePoint3dLike) {
    this._center.copy(value)
  }

  get radius() {
    return this._radius
  }
  set radius(value: number) {
    this._radius = value
  }

  get startAngle() {
    return this._startAngle
  }
  set startAngle(value: number) {
    this._startAngle = value
  }

  get endAngle() {
    return this._endAngle
  }
  set endAngle(value: number) {
    this._endAngle = value
  }

  get normal(): AcGeVector3d {
    return this._normal
  }
  set normal(value: AcGeVector3dLike) {
    this._normal.copy(value)
  }

  get characterSet() {
    return this._characterSet
  }
  set characterSet(value: number) {
    this._characterSet = value
  }

  get pitchAndFamily() {
    return this._pitchAndFamily
  }
  set pitchAndFamily(value: number) {
    this._pitchAndFamily = value
  }

  get isShx() {
    return this._isShx
  }
  set isShx(value: boolean) {
    this._isShx = value
  }

  get isBold() {
    return this._isBold
  }
  set isBold(value: boolean) {
    this._isBold = value
  }

  get isItalic() {
    return this._isItalic
  }
  set isItalic(value: boolean) {
    this._isItalic = value
  }

  get isUnderlined() {
    return this._isUnderlined
  }
  set isUnderlined(value: boolean) {
    this._isUnderlined = value
  }

  get alignment() {
    return this._alignment
  }
  set alignment(value: AcDbArcTextAlignment) {
    this._alignment = value
  }

  get isReverse() {
    return this._isReverse
  }
  set isReverse(value: boolean) {
    this._isReverse = value
  }

  get wizardFlag() {
    return this._wizardFlag
  }
  set wizardFlag(value: number) {
    this._wizardFlag = value
  }

  get textPosition() {
    return this._textPosition
  }
  set textPosition(value: AcDbArcTextPosition) {
    this._textPosition = value
  }

  get textDirection() {
    return this._textDirection
  }
  set textDirection(value: AcDbArcTextDirection) {
    this._textDirection = value
  }

  /** Handle of the arc this text was created from (DXF group 330). */
  get arcId() {
    return this._arcId
  }
  set arcId(value: string) {
    this._arcId = value ?? ''
  }

  /**
   * Applies the arc-text color (DXF group 90 / LibreDWG `color`).
   *
   * `0` is ByBlock, `256` is ByLayer, `1..255` is an ACI index. Larger values
   * are treated as a CMC color whose high byte is the method.
   */
  applyRawTextColor(raw: number) {
    if (!Number.isFinite(raw)) return
    const color = new AcCmColor()
    const method = (raw >>> 24) & 0xff
    if (raw === 0 || method === 0xc1) {
      color.setByBlock()
    } else if (raw === 256 || method === 0xc0 || method === 0xc8) {
      color.setByLayer()
    } else if (raw > 0 && raw < 256) {
      color.colorIndex = raw
    } else if (method === 0xc2 || method === 0xc3 || method === 0xc5) {
      color.setRGBValue(raw & 0xffffff)
    } else {
      return
    }
    this._rawTextColor = raw
    this.color = color
  }

  /**
   * Encodes the entity color as DXF group 90 / LibreDWG `rawTextColor`.
   *
   * Prefers the last value passed to {@link applyRawTextColor} so DWG→DXF
   * round-trips keep the original packed form.
   */
  rawTextColor(): number {
    if (this._rawTextColor != null && Number.isFinite(this._rawTextColor)) {
      return this._rawTextColor
    }
    if (this.color.isByBlock) return 0
    if (this.color.isByLayer) return 256
    const aci = this.color.colorIndex
    if (aci != null && aci > 0 && aci < 256) return aci
    const rgb = this.color.RGB
    if (rgb != null) return ((0xc2 << 24) | (rgb & 0xffffff)) >> 0
    return 256
  }

  /**
   * Places each character on the reference arc.
   *
   * The arc runs counter-clockwise from {@link startAngle} to {@link endAngle}.
   * {@link offsetFromArc} is the gap to the nearest text edge. Inward text
   * sits with its baseline one text height farther from the center.
   */
  glyphPlacements(): AcDbArcAlignedTextGlyph[] {
    const chars = Array.from(this._textString).filter(ch => ch !== '\r')
    if (this._isReverse) chars.reverse()
    if (chars.length === 0) return []

    const height = this._textSize > 0 ? this._textSize : 1
    const widthFactor = this._xScale > 0 ? this._xScale : 1
    const widths = chars.map(ch =>
      ch === ' ' || ch === '\n'
        ? height * 0.5 * widthFactor
        : acdbEstimatePlainTextWidth(ch, height, widthFactor)
    )
    const widthsSum = widths.reduce((sum, width) => sum + width, 0)

    const convex = this._textPosition !== AcDbArcTextPosition.OnConcaveSide
    const outward =
      this._textDirection === AcDbArcTextDirection.OutwardFromCenter
    // Offset is the gap between the arc and the nearest edge of the text,
    // not the baseline. Inward text has its baseline on the outer edge.
    const arcEdge =
      Math.abs(this._radius) + (convex ? 1 : -1) * this._offsetFromArc
    const heightShift = convex === outward ? 0 : convex ? height : -height
    const radius = Math.max(1e-6, arcEdge + heightShift)

    let sweep = this._endAngle - this._startAngle
    while (sweep <= 1e-9) sweep += TWO_PI
    while (sweep > TWO_PI) sweep -= TWO_PI

    const arcLength = sweep * radius
    const usable = Math.max(0, arcLength - this._leftOffset - this._rightOffset)
    const gaps = Math.max(0, chars.length - 1)
    let gap = this._characterSpacing
    if (this._alignment === AcDbArcTextAlignment.Fit && gaps > 0) {
      gap = (usable - widthsSum) / gaps
    }
    const natural = widthsSum + gap * gaps

    let distance = this._leftOffset
    if (this._alignment === AcDbArcTextAlignment.Right) {
      distance = arcLength - this._rightOffset - natural
    } else if (
      this._alignment === AcDbArcTextAlignment.Center ||
      this._alignment === (0 as AcDbArcTextAlignment)
    ) {
      distance = this._leftOffset + (usable - natural) / 2
    }

    const extrusion = this.extrusionMatrix()
    const glyphs: AcDbArcAlignedTextGlyph[] = []
    for (let i = 0; i < chars.length; i++) {
      const width = widths[i] ?? 0
      const char = chars[i] ?? ''
      if (char === '\n') continue
      const mid = distance + width / 2
      const angle = this._startAngle + mid / radius
      const local = new AcGePoint3d(
        this._center.x + radius * Math.cos(angle),
        this._center.y + radius * Math.sin(angle),
        this._center.z
      )
      // Group 71 = 1 points glyph tops away from the center. Group 71 = 2
      // points them toward the center, which keeps text upright along the
      // bottom of a counter-clockwise arc.
      let rotation = angle + Math.PI / 2
      if (this._textDirection === AcDbArcTextDirection.OutwardFromCenter) {
        rotation += Math.PI
      }
      glyphs.push({
        text: char,
        position: local.applyMatrix4(extrusion),
        rotation: this.rotationInWcs(rotation, extrusion)
      })
      distance += width + gap
    }
    return glyphs
  }

  get geometricExtents(): AcGeBox3d {
    const box = new AcGeBox3d()
    const glyphs = this.glyphPlacements()
    if (glyphs.length === 0) {
      box.expandByPoint(this._center)
      return box
    }
    const height = this._textSize > 0 ? this._textSize : 1
    for (const glyph of glyphs) {
      const width = acdbEstimatePlainTextWidth(
        glyph.text,
        height,
        this._xScale > 0 ? this._xScale : 1
      )
      const half = Math.max(width, height) / 2
      box.expandByPoint(
        new AcGePoint3d(
          glyph.position.x - half,
          glyph.position.y - half,
          glyph.position.z
        )
      )
      box.expandByPoint(
        new AcGePoint3d(
          glyph.position.x + half,
          glyph.position.y + half,
          glyph.position.z
        )
      )
    }
    return box
  }

  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'text',
          properties: [
            {
              name: 'contents',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.textString,
                set: (v: string) => {
                  this.textString = v
                }
              }
            },
            {
              name: 'styleName',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.styleName,
                set: (v: string) => {
                  this.styleName = v
                }
              }
            },
            {
              name: 'textHeight',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.textSize,
                set: (v: number) => {
                  this.textSize = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  subWorldDraw(
    renderer: AcGiRenderer,
    delay?: boolean
  ): AcGiEntity | undefined {
    const glyphs = this.glyphPlacements()
    if (glyphs.length === 0) return undefined
    const style = this.getTextStyle()
    const height = this._textSize > 0 ? this._textSize : 1
    const entities: AcGiEntity[] = []
    for (const glyph of glyphs) {
      const text = this._isUnderlined ? `\\L${glyph.text}` : glyph.text
      const mtextData: AcGiMTextData = {
        text,
        height,
        width: Infinity,
        widthFactor: this._xScale > 0 ? this._xScale : 1,
        position: glyph.position,
        rotation: glyph.rotation,
        drawingDirection: AcGiMTextFlowDirection.BOTTOM_TO_TOP,
        attachmentPoint: AcGiMTextAttachmentPoint.BaselineCenter
      }
      entities.push(renderer.mtext(mtextData, style, delay))
    }
    if (entities.length === 1) return entities[0]
    return renderer.group(entities)
  }

  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbArcAlignedText')
    filer.writeString(1, this._textString)
    filer.writeString(2, this._fontName)
    filer.writeString(3, this._bigFontName)
    filer.writeString(7, this._styleName)
    filer.writePoint3d(10, this._center)
    filer.writeDouble(40, this._radius)
    filer.writeDouble(41, this._xScale)
    filer.writeDouble(42, this._textSize)
    filer.writeDouble(43, this._characterSpacing)
    filer.writeDouble(44, this._offsetFromArc)
    filer.writeDouble(45, this._rightOffset)
    filer.writeDouble(46, this._leftOffset)
    filer.writeAngle(50, this._startAngle)
    filer.writeAngle(51, this._endAngle)
    filer.writeInt16(70, this._isReverse ? 1 : 0)
    filer.writeInt16(71, this._textDirection)
    filer.writeInt16(72, this._alignment)
    filer.writeInt16(73, this._textPosition)
    filer.writeInt16(74, this._isBold ? 1 : 0)
    filer.writeInt16(75, this._isItalic ? 1 : 0)
    filer.writeInt16(76, this._isUnderlined ? 1 : 0)
    filer.writeInt16(77, this._characterSet)
    filer.writeInt16(78, this._pitchAndFamily)
    filer.writeInt16(79, this._isShx ? 1 : 0)
    filer.writeInt32(90, this.rawTextColor())
    filer.writeVector3d(210, this._normal)
    filer.writeInt16(280, this._wizardFlag)
    if (this._arcId) filer.writeHandle(330, this._arcId)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbArcAlignedText')

    let cx = this._center.x
    let cy = this._center.y
    let cz = this._center.z
    let nx = this._normal.x
    let ny = this._normal.y
    let nz = this._normal.z

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      const text = item.value == null ? '' : String(item.value)
      switch (code) {
        case 1:
          this._textString = text
          break
        case 2:
          this._fontName = text
          break
        case 3:
          this._bigFontName = text
          break
        case 7:
          this._styleName = text
          break
        case 10:
          cx = n
          break
        case 20:
          cy = n
          break
        case 30:
          cz = n
          break
        case 40:
          this._radius = n
          break
        case 41:
          this._xScale = n
          break
        case 42:
          this._textSize = n
          break
        case 43:
          this._characterSpacing = n
          break
        case 44:
          this._offsetFromArc = n
          break
        case 45:
          this._rightOffset = n
          break
        case 46:
          this._leftOffset = n
          break
        case 50:
          this._startAngle = n
          break
        case 51:
          this._endAngle = n
          break
        case 70:
          this._isReverse = n !== 0
          break
        case 71:
          this._textDirection = n as AcDbArcTextDirection
          break
        case 72:
          this._alignment = n as AcDbArcTextAlignment
          break
        case 73:
          this._textPosition = n as AcDbArcTextPosition
          break
        case 74:
          this._isBold = n !== 0
          break
        case 75:
          this._isItalic = n !== 0
          break
        case 76:
          this._isUnderlined = n !== 0
          break
        case 77:
          this._characterSet = n
          break
        case 78:
          this._pitchAndFamily = n
          break
        case 79:
          this._isShx = n !== 0
          break
        case 90:
          this.applyRawTextColor(n)
          break
        case 210:
          nx = n
          break
        case 220:
          ny = n
          break
        case 230:
          nz = n
          break
        case 280:
          this._wizardFlag = n
          break
        case 330:
          this._arcId = text
          break
        default:
          break
      }
    }

    this._center.set(cx, cy, cz)
    this._normal.set(nx, ny, nz)
    return this
  }

  private getTextStyle(): AcGiTextStyle {
    const table = this.database?.tables?.textStyleTable
    const record =
      table?.resolveAt(this._styleName) ?? table?.resolveAt(DEFAULT_TEXT_STYLE)
    const style: AcGiTextStyle = record
      ? { ...record.textStyle }
      : {
          name: this._styleName || DEFAULT_TEXT_STYLE,
          standardFlag: 0,
          fixedTextHeight: 0,
          widthFactor: this._xScale > 0 ? this._xScale : 1,
          obliqueAngle: 0,
          textGenerationFlag: 0,
          lastHeight: this._textSize,
          font: this._fontName || 'txt',
          bigFont: this._bigFontName
        }
    if (this._fontName) style.font = this._fontName
    if (this._bigFontName) style.bigFont = this._bigFontName
    if (this._xScale > 0) style.widthFactor = this._xScale
    return style
  }

  private isPlanarInWcs(): boolean {
    return (
      Math.abs(this._normal.x) < 1e-10 &&
      Math.abs(this._normal.y) < 1e-10 &&
      this._normal.z > 0
    )
  }

  private extrusionMatrix(): AcGeMatrix3d {
    if (this.isPlanarInWcs()) return new AcGeMatrix3d()
    return new AcGeMatrix3d().setFromExtrusionDirection(this._normal)
  }

  private rotationInWcs(rotation: number, extrusion: AcGeMatrix3d): number {
    if (this.isPlanarInWcs()) return rotation
    const axis = new AcGeVector3d(Math.cos(rotation), Math.sin(rotation), 0)
    axis.transformDirection(extrusion)
    return Math.atan2(axis.y, axis.x)
  }
}

export function acdbParseArcAlignedNumber(
  value: unknown,
  fallback = 0
): number {
  return parseFinite(value, fallback)
}

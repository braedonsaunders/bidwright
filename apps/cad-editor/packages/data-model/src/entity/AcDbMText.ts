import {
  AcGeBox3d,
  AcGeMathUtil,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiRenderer, AcGiTextStyle } from '@mlightcad/graphic-interface'
import {
  AcGiMTextAttachmentPoint,
  AcGiMTextData,
  AcGiMTextFlowDirection
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbMovePrimaryGripPointAt } from './AcDbGripHelpers'
import {
  acdbCountMTextLines,
  acdbEstimateMTextHeight,
  acdbEstimatePlainTextWidth,
  acdbExpandBoxByOrientedTextRect
} from './AcDbTextExtentsHelpers'

/**
 * Represents a multiline text (mtext) entity in AutoCAD.
 *
 * A multiline text entity is a 2D geometric object that displays formatted text
 * with support for multiple lines, word wrapping, and rich text formatting.
 * MText entities are more advanced than regular text entities and support
 * features like background fills, line spacing, and attachment points.
 *
 * @example
 * ```typescript
 * // Create a multiline text entity
 * const mtext = new AcDbMText();
 * mtext.contents = "This is a\nmultiline text\nwith formatting";
 * mtext.height = 2.5;
 * mtext.width = 20;
 * mtext.location = new AcGePoint3d(0, 0, 0);
 * mtext.attachmentPoint = AcGiMTextAttachmentPoint.TopLeft;
 *
 * // Access mtext properties
 * console.log(`Contents: ${mtext.contents}`);
 * console.log(`Height: ${mtext.height}`);
 * console.log(`Width: ${mtext.width}`);
 * ```
 */
export class AcDbMText extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'MText'

  override get dxfTypeName() {
    return 'MTEXT'
  }

  /** The height of the text */
  private _height: number
  /** The maximum width for word wrap formatting */
  private _width: number
  /** Cached actual text extents width from the source drawing, when available */
  private _extentsWidth: number
  /** The text contents */
  private _contents: string
  /** The line spacing style */
  private _lineSpacingStyle: number
  /** The line spacing factor */
  private _lineSpacingFactor: number
  /** Whether background fill is enabled */
  private _backgroundFill: boolean
  /** The background fill color */
  private _backgroundFillColor: number
  /** The background scale factor */
  private _backgroundScaleFactor: number
  /** The background fill transparency */
  private _backgroundFillTransparency: number
  /** The rotation angle in radians */
  private _rotation: number
  /** The text style name */
  private _styleName: string
  /** The location point of the text */
  private _location: AcGePoint3d
  /** The attachment point for the text */
  private _attachmentPoint: AcGiMTextAttachmentPoint
  /** The direction vector of the text */
  private _direction: AcGeVector3d
  /** The drawing direction of the text */
  private _drawingDirection: AcGiMTextFlowDirection
  /** Extrusion / plane normal (DXF group 210). */
  private _normal = new AcGeVector3d(0, 0, 1)
  /** Annotation height when embedded in ATTRIB (DXF group 46). */
  private _annotationHeight = 0
  /** Column type (DXF group 75). */
  private _columnType = 0
  /** Column count (DXF group 76). */
  private _columnCount = 0
  /** Column flow reversed (DXF group 78). */
  private _columnFlowReversed = false
  /** Column auto height (DXF group 79). */
  private _columnAutoHeight = false
  /** Column width (DXF group 48). */
  private _columnWidth = 0
  /** Column gutter (DXF group 49). */
  private _columnGutter = 0

  /**
   * Creates a new multiline text entity.
   *
   * This constructor initializes an mtext entity with default values.
   * The contents are empty, height and width are 0, and the location is at the origin.
   *
   * @example
   * ```typescript
   * const mtext = new AcDbMText();
   * mtext.contents = "Sample multiline text";
   * mtext.height = 3.0;
   * mtext.width = 15;
   * ```
   */
  constructor() {
    super()
    this._contents = ''
    this._height = 0
    this._width = 0
    this._extentsWidth = 0
    this._lineSpacingFactor = 1.0
    this._lineSpacingStyle = 0
    this._backgroundFill = false
    this._backgroundFillColor = 0xc8c8c8
    this._backgroundFillTransparency = 1
    this._backgroundScaleFactor = 1
    this._rotation = 0
    this._styleName = ''
    this._location = new AcGePoint3d()
    this._attachmentPoint = AcGiMTextAttachmentPoint.TopLeft
    this._direction = new AcGeVector3d(1, 0, 0)
    this._drawingDirection = AcGiMTextFlowDirection.LEFT_TO_RIGHT
  }

  /**
   * Gets the contents of the mtext object.
   *
   * This returns a string that contains the contents of the mtext object.
   * Formatting data used for word wrap calculations is removed.
   *
   * @returns The text contents
   *
   * @example
   * ```typescript
   * const contents = mtext.contents;
   * console.log(`Text contents: ${contents}`);
   * ```
   */
  get contents() {
    return this._contents
  }

  /**
   * Sets the contents of the mtext object.
   *
   * @param value - The new text contents
   *
   * @example
   * ```typescript
   * mtext.contents = "New multiline\ntext content";
   * ```
   */
  set contents(value: string) {
    this._contents = value
  }

  /**
   * Gets the height of the text.
   *
   * @returns The text height
   *
   * @example
   * ```typescript
   * const height = mtext.height;
   * console.log(`Text height: ${height}`);
   * ```
   */
  get height() {
    return this._height
  }

  /**
   * Sets the height of the text.
   *
   * @param value - The new text height
   *
   * @example
   * ```typescript
   * mtext.height = 5.0;
   * ```
   */
  set height(value: number) {
    this._height = value
  }

  /**
   * Gets the maximum width setting used by the MText object for word wrap formatting.
   *
   * It is possible that none of the lines resulting from word wrap formatting will
   * reach this width value. Words which exceed this width value will not be broken,
   * but will extend beyond the given width.
   *
   * @returns The maximum width for word wrap
   *
   * @example
   * ```typescript
   * const width = mtext.width;
   * console.log(`Text width: ${width}`);
   * ```
   */
  get width() {
    return this._width
  }

  /**
   * Sets the maximum width setting used by the MText object for word wrap formatting.
   *
   * @param value - The new maximum width for word wrap
   *
   * @example
   * ```typescript
   * mtext.width = 25;
   * ```
   */
  set width(value: number) {
    this._width = value
  }

  /**
   * Gets the cached actual text extents width from the source file.
   *
   * When present, this reflects the rendered width of the MTEXT content and is
   * preferred over {@link width} (reference/wrap width) for layout calculations.
   */
  get extentsWidth() {
    return this._extentsWidth
  }

  set extentsWidth(value: number) {
    this._extentsWidth = value
  }

  /**
   * Gets the rotation angle of the text.
   *
   * The rotation angle is relative to the X axis of the text's OCS, with positive
   * angles going counterclockwise when looking down the Z axis toward the origin.
   *
   * @returns The rotation angle in radians
   *
   * @example
   * ```typescript
   * const rotation = mtext.rotation;
   * console.log(`Rotation: ${rotation} radians (${rotation * 180 / Math.PI} degrees)`);
   * ```
   */
  get rotation() {
    return this._rotation
  }
  set rotation(value: number) {
    this._rotation = value
  }

  /**
   * The line spacing factor (DXF group 44).
   *
   * Ratio of actual baseline spacing to AutoCAD single spacing
   * (`5/3` of text height). Valid range is typically 0.25–4.00; default is 1.0.
   */
  get lineSpacingFactor() {
    return this._lineSpacingFactor
  }
  set lineSpacingFactor(value: number) {
    this._lineSpacingFactor = value
  }

  /**
   * The line spacing style.
   */
  get lineSpacingStyle() {
    return this._lineSpacingStyle
  }
  set lineSpacingStyle(value: number) {
    this._lineSpacingStyle = value
  }

  /**
   * Toggle the background fill on or off. If it is true, background color is turned off, and no
   * background fill color has been specified, this function sets the background fill color to
   * an RGB value of 200,200,200.
   */
  get backgroundFill() {
    return this._backgroundFill
  }
  set backgroundFill(value: boolean) {
    this._backgroundFill = value
    this._backgroundFillColor = 0xc8c8c8
  }

  /**
   * The background fill color. This property is valid only if background fill is enable.
   */
  get backgroundFillColor() {
    return this._backgroundFillColor
  }
  set backgroundFillColor(value: number) {
    this._backgroundFillColor = value
  }

  /**
   * The background fill transparency. This property is valid only if background fill is enable.
   */
  get backgroundFillTransparency() {
    return this._backgroundFillTransparency
  }
  set backgroundFillTransparency(value: number) {
    this._backgroundFillTransparency = value
  }

  /**
   * The background scale factor.
   */
  get backgroundScaleFactor() {
    return this._backgroundScaleFactor
  }
  set backgroundScaleFactor(value: number) {
    this._backgroundScaleFactor = value
  }

  /**
   * The style name stored in text ttyle table record and used by this text entity
   */
  get styleName() {
    return this._styleName
  }
  set styleName(value: string) {
    this._styleName = value
  }

  /**
   * The insertion point of this mtext entity.
   */
  get location() {
    return this._location
  }
  set location(value: AcGePoint3dLike) {
    this._location.copy(value)
  }

  /**
   * The attachment point value which determines how the text will be oriented around the insertion point
   * of the mtext object. For example, if the attachment point is AcGiAttachmentPoint.MiddleCenter, then
   * the text body will be displayed such that the insertion point appears at the geometric center of the
   * text body.
   */
  get attachmentPoint() {
    return this._attachmentPoint
  }
  set attachmentPoint(value: AcGiMTextAttachmentPoint) {
    this._attachmentPoint = value
  }

  /**
   * Represent the X axis ("horizontal") for the text. This direction vector is used to determine the text
   * flow direction.
   */
  get direction(): AcGeVector3d {
    return this._direction
  }
  set direction(value: AcGeVector3dLike) {
    this._direction.copy(value)
  }

  get drawingDirection() {
    return this._drawingDirection
  }
  set drawingDirection(value: AcGiMTextFlowDirection) {
    this._drawingDirection = value
  }

  /** Extrusion / plane normal (DXF group 210). */
  get normal(): AcGeVector3d {
    return this._normal
  }
  set normal(value: AcGeVector3dLike) {
    this._normal.copy(value)
  }

  /** Annotation height when MTEXT is embedded in ATTRIB (DXF group 46). */
  get annotationHeight() {
    return this._annotationHeight
  }
  set annotationHeight(value: number) {
    this._annotationHeight = value
  }

  /** Column type (DXF group 75). */
  get columnType() {
    return this._columnType
  }
  set columnType(value: number) {
    this._columnType = value
  }

  /** Column count (DXF group 76). */
  get columnCount() {
    return this._columnCount
  }
  set columnCount(value: number) {
    this._columnCount = value
  }

  /** Whether column flow is reversed (DXF group 78). */
  get columnFlowReversed() {
    return this._columnFlowReversed
  }
  set columnFlowReversed(value: boolean) {
    this._columnFlowReversed = value
  }

  /** Whether columns use auto height (DXF group 79). */
  get columnAutoHeight() {
    return this._columnAutoHeight
  }
  set columnAutoHeight(value: boolean) {
    this._columnAutoHeight = value
  }

  /** Column width (DXF group 48). */
  get columnWidth() {
    return this._columnWidth
  }
  set columnWidth(value: number) {
    this._columnWidth = value
  }

  /** Column gutter (DXF group 49). */
  get columnGutter() {
    return this._columnGutter
  }
  set columnGutter(value: number) {
    this._columnGutter = value
  }

  /**
   * @inheritdoc
   */
  get geometricExtents(): AcGeBox3d {
    const box = new AcGeBox3d()
    const width =
      this.extentsWidth > 0
        ? this.extentsWidth
        : this.width > 0
          ? this.width
          : acdbEstimatePlainTextWidth(this.contents, this.height)
    const lineCount = acdbCountMTextLines(this.contents)
    const height = acdbEstimateMTextHeight(
      lineCount,
      this.height,
      this.lineSpacingFactor,
      this.lineSpacingStyle
    )

    return acdbExpandBoxByOrientedTextRect(
      box,
      this._location,
      width,
      height,
      this.attachmentPoint,
      this.rotation,
      this.direction
    )
  }

  /**
   * Gets the grip points for this mtext entity.
   *
   * @returns Array containing the mtext location (insertion point).
   */
  subGetGripPoints() {
    return [this._location]
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbMovePrimaryGripPointAt(indices, offset, this._location)
    return this
  }

  /**
   * Gets the object snap points for this mtext.
   *
   * Object snap points are precise points that can be used for positioning
   * when drawing or editing. This method provides snap points based on the
   * specified snap mode.
   *
   * @param osnapMode - The object snap mode
   * @param _pickPoint - The point where the user picked
   * @param _lastPoint - The last point
   * @param snapPoints - Array to populate with snap points
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    _pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    if (AcDbOsnapMode.Insertion === osnapMode) {
      snapPoints.push(this._location)
    }
  }

  /**
   * Transforms this mtext by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    const origin = this._location.clone()
    const xDir =
      this._direction.lengthSq() > 0
        ? this._direction.clone().normalize()
        : new AcGeVector3d(
            Math.cos(this._rotation),
            Math.sin(this._rotation),
            0
          )
    const yDir = new AcGeVector3d(-xDir.y, xDir.x, xDir.z)
    if (yDir.lengthSq() === 0) {
      yDir.set(0, 1, 0)
    }
    yDir.normalize()

    const xAxisPoint = origin.clone().add(xDir)
    const yAxisPoint = origin.clone().add(yDir)

    origin.applyMatrix4(matrix)
    xAxisPoint.applyMatrix4(matrix)
    yAxisPoint.applyMatrix4(matrix)

    const xAxis = new AcGeVector3d(xAxisPoint).sub(origin)
    const yAxis = new AcGeVector3d(yAxisPoint).sub(origin)
    const xScale = xAxis.length()
    const yScale = yAxis.length()

    this._location.copy(origin)
    if (xScale > 0) {
      this._direction.copy(xAxis).normalize()
      this._rotation = Math.atan2(this._direction.y, this._direction.x)
      this._width *= xScale
      if (this._extentsWidth > 0) {
        this._extentsWidth *= xScale
      }
    }
    if (yScale > 0) {
      this._height *= yScale
    }
    return this
  }

  /**
   * Returns the full property definition for this mtext entity, including
   * general group and geometry group.
   *
   * The geometry group exposes editable start/end coordinates via
   * {@link AcDbPropertyAccessor} so the property palette can update
   * the mtext in real-time.
   *
   * Each property is an {@link AcDbEntityRuntimeProperty}.
   */
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
                get: () => this.contents,
                set: (v: string) => {
                  this.contents = v
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
              name: 'attachmentPoint',
              type: 'enum',
              editable: true,
              options: [
                { label: AcGiMTextAttachmentPoint[1], value: 1 },
                { label: AcGiMTextAttachmentPoint[2], value: 2 },
                { label: AcGiMTextAttachmentPoint[3], value: 3 },
                { label: AcGiMTextAttachmentPoint[4], value: 4 },
                { label: AcGiMTextAttachmentPoint[5], value: 5 },
                { label: AcGiMTextAttachmentPoint[6], value: 6 },
                { label: AcGiMTextAttachmentPoint[7], value: 7 },
                { label: AcGiMTextAttachmentPoint[8], value: 8 },
                { label: AcGiMTextAttachmentPoint[9], value: 9 }
              ],
              accessor: {
                get: () => this.attachmentPoint,
                set: (v: AcGiMTextAttachmentPoint) => {
                  this.attachmentPoint = v
                }
              }
            },
            {
              name: 'drawingDirection',
              type: 'enum',
              editable: true,
              options: [
                { label: AcGiMTextFlowDirection[1], value: 1 },
                { label: AcGiMTextFlowDirection[2], value: 2 },
                { label: AcGiMTextFlowDirection[3], value: 3 },
                { label: AcGiMTextFlowDirection[4], value: 4 },
                { label: AcGiMTextFlowDirection[5], value: 5 }
              ],
              accessor: {
                get: () => this.drawingDirection,
                set: (v: number) => {
                  this.drawingDirection = v
                }
              }
            },
            {
              name: 'textHeight',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.height,
                set: (v: number) => {
                  this.height = v
                }
              }
            },
            {
              name: 'rotation',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.rotation,
                set: (v: number) => {
                  this.rotation = v
                }
              }
            },
            {
              name: 'lineSpacingFactor',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.lineSpacingFactor,
                set: (v: number) => {
                  this.lineSpacingFactor = v
                }
              }
            },
            {
              name: 'definedWidth',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.width,
                set: (v: number) => {
                  this.width = v
                }
              }
            },
            {
              name: 'directionX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.direction.x,
                set: (v: number) => {
                  this.direction.x = v
                }
              }
            },
            {
              name: 'directionY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.direction.y,
                set: (v: number) => {
                  this.direction.y = v
                }
              }
            },
            {
              name: 'directionZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.direction.z,
                set: (v: number) => {
                  this.direction.z = v
                }
              }
            }
          ]
        },
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'locationX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.location.x,
                set: (v: number) => {
                  this.location.x = v
                }
              }
            },
            {
              name: 'locationY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.location.y,
                set: (v: number) => {
                  this.location.y = v
                }
              }
            },
            {
              name: 'locationZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.location.z,
                set: (v: number) => {
                  this.location.z = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  private getTextStyle(): AcGiTextStyle {
    const style = this.database.tables.textStyleTable.resolveAt(this.styleName)

    if (!style) {
      throw new Error('No valid text style found in text style table.')
    }
    return style.textStyle
  }

  /**
   * Draws this entity using the specified renderer.
   *
   * @param renderer - The renderer to use for drawing
   * @param delay - The flag to delay creating one rendered entity and just create one dummy
   * entity. Renderer can delay heavy calculation operation to avoid blocking UI when this flag
   * is true.
   * @returns The rendered entity, or undefined if drawing failed
   */
  subWorldDraw(renderer: AcGiRenderer, delay?: boolean) {
    const mtextData: AcGiMTextData = {
      text: this.contents,
      height: this.height,
      width: this.width,
      position: this.location,
      rotation: this.rotation,
      directionVector: this.direction,
      attachmentPoint: this.attachmentPoint,
      drawingDirection: this.drawingDirection,
      lineSpaceFactor: this.lineSpacingFactor,
      lineSpaceStyle: this.lineSpacingStyle
    }
    return renderer.mtext(mtextData, this.getTextStyle(), delay)
  }

  private encodeMTextContentsForDxf(contents: string): string {
    return (contents ?? '').replace(/\r\n|\r|\n/g, '\\P')
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbMText')
    filer.writePoint3d(10, this.location)
    filer.writeDouble(40, this.height)
    filer.writeDouble(41, this.width)
    if (this.extentsWidth > 0) {
      filer.writeDouble(42, this.extentsWidth)
    }
    // MTEXT contents use \P for paragraph breaks; raw newlines must not appear in DXF.
    // AutoCAD splits strings longer than 250 chars into group-3 chunks, with the
    // final remainder in group 1.
    filer.writeMTextContents(this.encodeMTextContentsForDxf(this.contents ?? ''))
    filer.writeString(7, this.styleName)
    filer.writeAngle(50, this.rotation)
    filer.writeVector3d(11, this.direction)
    filer.writeInt16(71, this.attachmentPoint)
    filer.writeInt16(72, this.drawingDirection)
    filer.writeInt16(73, this.lineSpacingStyle)
    filer.writeDouble(44, this.lineSpacingFactor)
    if (this.backgroundFill) {
      filer.writeInt16(90, 1)
      filer.writeInt32(63, this.backgroundFillColor)
      filer.writeInt32(441, this.backgroundFillTransparency)
      filer.writeDouble(45, this.backgroundScaleFactor)
    }
    if (this.annotationHeight !== 0) {
      filer.writeDouble(46, this.annotationHeight)
    }
    if (this.columnType !== 0) {
      filer.writeInt16(75, this.columnType)
      filer.writeInt16(76, this.columnCount)
      filer.writeInt16(78, this.columnFlowReversed ? 1 : 0)
      filer.writeInt16(79, this.columnAutoHeight ? 1 : 0)
      filer.writeDouble(48, this.columnWidth)
      filer.writeDouble(49, this.columnGutter)
    }
    filer.writeVector3d(210, this.normal)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbMText')

    let lx = this.location.x
    let ly = this.location.y
    let lz = this.location.z
    let dx = this.direction.x
    let dy = this.direction.y
    let dz = this.direction.z
    let nx = this.normal.x
    let ny = this.normal.y
    let nz = this.normal.z
    let hasDirection = false
    const contentParts: string[] = []

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 10:
          lx = n
          break
        case 20:
          ly = n
          break
        case 30:
          lz = n
          break
        case 11:
          dx = n
          hasDirection = true
          break
        case 21:
          dy = n
          hasDirection = true
          break
        case 31:
          dz = n
          hasDirection = true
          break
        case 1:
        case 3:
          contentParts.push(String(item.value))
          break
        case 7:
          this.styleName = String(item.value)
          break
        case 40:
          this.height = n
          break
        case 41:
          this.width = n
          break
        case 42:
          if (n > 0) this.extentsWidth = n
          break
        case 43:
          // Vertical character height — documented as unused by AutoCAD; skip.
          break
        case 44:
          this.lineSpacingFactor = n
          break
        case 45:
          this.backgroundScaleFactor = n
          break
        case 46:
          this.annotationHeight = n
          break
        case 48:
          this.columnWidth = n
          break
        case 49:
          this.columnGutter = n
          break
        case 50:
          this.rotation = AcGeMathUtil.degToRad(n)
          break
        case 71:
          this.attachmentPoint = n as AcGiMTextAttachmentPoint
          break
        case 72:
          this.drawingDirection = n as AcGiMTextFlowDirection
          break
        case 73:
          this.lineSpacingStyle = n
          break
        case 75:
          this.columnType = n
          break
        case 76:
          this.columnCount = n
          break
        case 78:
          this.columnFlowReversed = n !== 0
          break
        case 79:
          this.columnAutoHeight = n !== 0
          break
        case 90:
          this.backgroundFill = n !== 0
          break
        case 63:
          this.backgroundFillColor = n
          break
        case 441:
          this.backgroundFillTransparency = n
          break
        case 101:
          // Embedded object marker — drain remaining pairs until end of entity
          // (AutoCAD DXF / dxf-json skipEmbeddedObject behavior).
          while (!filer.atEndOfObject && !filer.atEof) {
            if (!filer.readItem()) break
          }
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
        case 100:
          // Unexpected further subclass — hand off.
          filer.pushBackItem(item)
          this.finishMTextDxfIn(
            contentParts,
            lx,
            ly,
            lz,
            dx,
            dy,
            dz,
            hasDirection,
            nx,
            ny,
            nz
          )
          return this
        default:
          // Unknown optional MTEXT codes — keep scanning (do not abort).
          break
      }
    }

    this.finishMTextDxfIn(
      contentParts,
      lx,
      ly,
      lz,
      dx,
      dy,
      dz,
      hasDirection,
      nx,
      ny,
      nz
    )
    return this
  }

  private finishMTextDxfIn(
    contentParts: string[],
    lx: number,
    ly: number,
    lz: number,
    dx: number,
    dy: number,
    dz: number,
    hasDirection: boolean,
    nx: number,
    ny: number,
    nz: number
  ) {
    if (contentParts.length > 0) {
      this.contents = contentParts.join('')
    }
    this.location = { x: lx, y: ly, z: lz }
    if (hasDirection) {
      this.direction = { x: dx, y: dy, z: dz }
    }
    const normal = new AcGeVector3d(nx, ny, nz)
    if (normal.lengthSq() > 0) {
      this.normal.copy(normal.normalize())
    }
  }
}

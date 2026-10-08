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
import { AcDbDimStyleTableRecord } from '../database'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbMovePrimaryGripPointAt } from './AcDbGripHelpers'
import { acdbEstimateToleranceCellWidth } from './AcDbTextExtentsHelpers'

interface ToleranceFrameRow {
  cells: string[]
}

interface ToleranceFrameLayout {
  width: number
  totalHeight: number
  rowHeight: number
  columnWidths: number[]
  columnDivisions: number[]
  rowCount: number
  cellPadding: number
  columnGap: number
}

const TOLERANCE_SLOT_COUNT = 6

/**
 * Represents a feature control frame (FCF) entity in AutoCAD.
 *
 * Feature control frames are used for geometric dimensioning and tolerancing
 * (GD&T). They are created by the TOLERANCE command and controlled by dimension
 * styles, mirroring {@link https://help.autodesk.com/view/OARX/2023/ENU/?guid=OARX-RefGuide-AcDbFcf AcDbFcf}
 * in ObjectARX.
 *
 * @example
 * ```typescript
 * const fcf = new AcDbFcf();
 * fcf.location = new AcGePoint3d(10, 20, 0);
 * fcf.text = '{\\Fgdt.shx|b0|i0|c134|p6;j}|0.05|A|';
 * fcf.dimensionStyle = 'Standard';
 * ```
 */
export class AcDbFcf extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Fcf'

  override get dxfTypeName() {
    return 'TOLERANCE'
  }

  /**
   * The insertion point of the feature control frame in WCS coordinates.
   *
   * This is the center of the left edge for the first row in the entity-local
   * frame. Geometry uses +localX along {@link direction}; when direction points
   * left (e.g. leader on the right), this insertion point coincides with the
   * right-edge center in WCS.
   */
  private _location: AcGePoint3d
  /** The encoded tolerance text string (symbol and format codes). */
  private _text: string
  /** The dimension style name applied to this feature control frame. */
  private _dimensionStyle: string
  /** The plane normal vector in WCS coordinates. */
  private _normal: AcGeVector3d
  /** The X-axis direction vector for the feature control frame in WCS coordinates. */
  private _direction: AcGeVector3d

  /**
   * Creates a new feature control frame entity at the origin with default orientation.
   */
  constructor() {
    super()
    this._location = new AcGePoint3d()
    this._text = ''
    this._dimensionStyle = ''
    this._normal = new AcGeVector3d(0, 0, 1)
    this._direction = new AcGeVector3d(1, 0, 0)
  }

  /**
   * Gets the insertion point of this feature control frame.
   *
   * Mirrors `AcDbFcf::location()` in ObjectARX.
   */
  get location(): AcGePoint3d {
    return this._location
  }

  /**
   * Sets the insertion point of this feature control frame.
   *
   * Mirrors `AcDbFcf::setLocation()` in ObjectARX.
   */
  set location(value: AcGePoint3dLike) {
    this._location.set(value.x, value.y, value.z ?? 0)
  }

  /**
   * Gets the encoded tolerance text string.
   *
   * Mirrors `AcDbFcf::text()` in ObjectARX.
   */
  get text(): string {
    return this._text
  }

  /**
   * Sets the encoded tolerance text string.
   *
   * Mirrors `AcDbFcf::setText()` in ObjectARX.
   */
  set text(value: string) {
    this._text = value
  }

  /**
   * Gets the dimension style name applied to this feature control frame.
   */
  get dimensionStyle(): string {
    return this._dimensionStyle
  }

  /**
   * Sets the dimension style name applied to this feature control frame.
   */
  set dimensionStyle(value: string) {
    this._dimensionStyle = value
  }

  /**
   * Gets the plane normal vector in WCS coordinates.
   *
   * Mirrors `AcDbFcf::normal()` in ObjectARX.
   */
  get normal(): AcGeVector3d {
    return this._normal
  }

  /**
   * Sets the plane normal vector in WCS coordinates.
   */
  set normal(value: AcGeVector3dLike) {
    this._normal.set(value.x, value.y, value.z ?? 0)
    if (this._normal.lengthSq() > 0) {
      this._normal.normalize()
    }
  }

  /**
   * Gets the X-axis direction vector in WCS coordinates.
   *
   * Mirrors `AcDbFcf::direction()` in ObjectARX.
   */
  get direction(): AcGeVector3d {
    return this._direction
  }

  /**
   * Sets the X-axis direction vector in WCS coordinates.
   */
  set direction(value: AcGeVector3dLike) {
    this._direction.set(value.x, value.y, value.z ?? 0)
    if (this._direction.lengthSq() > 0) {
      this._direction.normalize()
    }
  }

  /**
   * Sets the plane normal and X-axis direction for this feature control frame.
   *
   * Mirrors `AcDbFcf::setOrientation()` in ObjectARX.
   */
  setOrientation(normal: AcGeVector3dLike, direction: AcGeVector3dLike) {
    this.normal = normal
    this.direction = direction
    return this
  }

  /**
   * Returns the consecutive distinct corner points of the feature control frame.
   *
   * Mirrors `AcDbFcf::getBoundingPoints()` in ObjectARX.
   */
  getBoundingPoints(): AcGePoint3d[] {
    return this.getBoundingPolyline().slice(0, 4)
  }

  /**
   * Returns the closed bounding polyline of the feature control frame.
   *
   * Mirrors `AcDbFcf::getBoundingPolyline()` in ObjectARX.
   */
  getBoundingPolyline(): AcGePoint3d[] {
    const { width, rowHeight, rowCount } = this.resolveFrameLayout()
    const frameTop = rowHeight / 2
    const frameBottom = frameTop - rowHeight * rowCount
    const corners = [
      new AcGePoint3d(0, frameTop, 0),
      new AcGePoint3d(width, frameTop, 0),
      new AcGePoint3d(width, frameBottom, 0),
      new AcGePoint3d(0, frameBottom, 0),
      new AcGePoint3d(0, frameTop, 0)
    ]

    return corners.map(corner => this.toFrameWcs(corner.x, corner.y))
  }

  get geometricExtents(): AcGeBox3d {
    const box = new AcGeBox3d()
    for (const point of this.getBoundingPoints()) {
      box.expandByPoint(point)
    }
    if (box.isEmpty()) {
      box.expandByPoint(this._location)
    }
    return box
  }

  subGetGripPoints() {
    return [this._location]
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbMovePrimaryGripPointAt(indices, offset, this._location)
    return this
  }

  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    _pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    if (osnapMode === AcDbOsnapMode.Insertion) {
      snapPoints.push(this._location)
    }
  }

  transformBy(matrix: AcGeMatrix3d) {
    const basis = this.resolveLocalBasis()
    const origin = this._location.clone()
    const xAxisPoint = origin.clone().add(basis.xAxis)
    const yAxisPoint = origin.clone().add(basis.yAxis)

    origin.applyMatrix4(matrix)
    xAxisPoint.applyMatrix4(matrix)
    yAxisPoint.applyMatrix4(matrix)

    const xAxis = new AcGeVector3d(xAxisPoint).sub(origin)
    const yAxis = new AcGeVector3d(yAxisPoint).sub(origin)

    let normal = new AcGeVector3d().crossVectors(xAxis, yAxis)
    if (normal.lengthSq() === 0) {
      normal = this._normal.clone().transformDirection(matrix)
    } else {
      normal.normalize()
    }

    let direction = xAxis.clone()
    if (direction.lengthSq() === 0) {
      direction = this._direction.clone().transformDirection(matrix)
    } else {
      direction.normalize()
    }

    this._location.copy(origin)
    this._normal.copy(normal)
    this._direction.copy(direction)
    return this
  }

  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'tolerance',
          properties: [
            {
              name: 'text',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.text,
                set: (v: string) => {
                  this.text = v
                }
              }
            },
            {
              name: 'dimensionStyle',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.dimensionStyle,
                set: (v: string) => {
                  this.dimensionStyle = v
                }
              }
            },
            {
              name: 'textHeight',
              type: 'float',
              editable: false,
              accessor: {
                get: () => this.textHeight
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

  subWorldDraw(
    renderer: AcGiRenderer,
    delay?: boolean
  ): AcGiEntity | undefined {
    const frameSegments = this.collectFrameLineSegments()
    const frameEntities = frameSegments.map(([start, end]) =>
      renderer.lines([start, end])
    )
    const textEntity = this.drawToleranceText(renderer, delay)
    if (frameEntities.length > 0 && textEntity) {
      return renderer.group([...frameEntities, textEntity])
    }
    if (frameEntities.length === 1) {
      return frameEntities[0]
    }
    if (frameEntities.length > 1) {
      return renderer.group(frameEntities)
    }
    return textEntity
  }

  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbFcf')
    if (this._dimensionStyle) {
      filer.writeString(3, this._dimensionStyle)
    }
    filer.writePoint3d(10, this._location)
    filer.writeString(1, this._text)
    if (!this._normal.equals(AcGeVector3d.Z_AXIS)) {
      filer.writeVector3d(210, this._normal)
    }
    if (!this._direction.equals(AcGeVector3d.X_AXIS)) {
      filer.writeVector3d(11, this._direction)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbFcf')

    let lx = this.location.x
    let ly = this.location.y
    let lz = this.location.z
    let nx = this.normal.x
    let ny = this.normal.y
    let nz = this.normal.z
    let dx = this.direction.x
    let dy = this.direction.y
    let dz = this.direction.z
    let hasNormal = false
    let hasDirection = false

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 1:
          this.text = String(item.value)
          break
        case 3:
          this.dimensionStyle = String(item.value)
          break
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
        case 210:
          nx = n
          hasNormal = true
          break
        case 220:
          ny = n
          hasNormal = true
          break
        case 230:
          nz = n
          hasNormal = true
          break
        default:
          break
      }
    }

    this.location = { x: lx, y: ly, z: lz }
    if (hasNormal) this.normal = { x: nx, y: ny, z: nz }
    if (hasDirection) this.direction = { x: dx, y: dy, z: dz }
    return this
  }

  /**
   * Gets the rendered text height derived from the associated dimension style.
   */
  get textHeight(): number {
    const dimStyle = this.resolveDimensionStyle()
    const dimtxt =
      dimStyle?.dimtxt ?? AcDbDimStyleTableRecord.DEFAULT_DIM_VALUES.dimtxt
    const dimscale =
      dimStyle?.dimscale ??
      AcDbDimStyleTableRecord.DEFAULT_DIM_VALUES.dimscale
    return dimtxt * dimscale
  }

  private drawToleranceText(
    renderer: AcGiRenderer,
    delay?: boolean
  ): AcGiEntity | undefined {
    const rows = this.parseToleranceFrame(this._text)
    if (rows.length === 0) {
      return undefined
    }

    const layout = this.resolveFrameLayout(rows)
    const textStyle = this.getTextStyle()
    const entities: AcGiEntity[] = []

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]
      let cellOffset = layout.cellPadding
      const rowCenterY = -layout.rowHeight * rowIndex

      for (let columnIndex = 0; columnIndex < row.cells.length; columnIndex++) {
        const cellText = row.cells[columnIndex]
        const cellWidth = layout.columnWidths[columnIndex] ?? this.textHeight
        if (cellText.trim()) {
          const position = this.toFrameWcs(
            cellOffset + cellWidth / 2,
            rowCenterY
          )

          const mtextData: AcGiMTextData = {
            text: cellText,
            height: this.textHeight,
            width: Infinity,
            position,
            directionVector: this._direction,
            attachmentPoint: AcGiMTextAttachmentPoint.MiddleCenter,
            drawingDirection: AcGiMTextFlowDirection.LEFT_TO_RIGHT
          }
          entities.push(renderer.mtext(mtextData, textStyle, delay))
        }
        cellOffset += cellWidth + layout.columnGap
      }
    }

    if (entities.length === 0) {
      return undefined
    }
    if (entities.length === 1) {
      return entities[0]
    }
    return renderer.group(entities)
  }

  private collectFrameLineSegments(): [AcGePoint3d, AcGePoint3d][] {
    const rows = this.parseToleranceFrame(this._text)
    const layout = this.resolveFrameLayout(rows)
    const { width, rowHeight, rowCount, columnDivisions } = layout
    if (width <= 0 || rowHeight <= 0 || rowCount <= 0) {
      return []
    }

    const frameTop = rowHeight / 2
    const frameBottom = frameTop - rowHeight * rowCount
    const segments: [AcGePoint3d, AcGePoint3d][] = []
    const pushSegment = (start: AcGePoint3d, end: AcGePoint3d) => {
      segments.push([start, end])
    }

    pushSegment(
      this.toFrameWcs(0, frameTop),
      this.toFrameWcs(width, frameTop)
    )
    pushSegment(
      this.toFrameWcs(width, frameTop),
      this.toFrameWcs(width, frameBottom)
    )
    pushSegment(
      this.toFrameWcs(width, frameBottom),
      this.toFrameWcs(0, frameBottom)
    )
    pushSegment(
      this.toFrameWcs(0, frameBottom),
      this.toFrameWcs(0, frameTop)
    )

    for (const division of columnDivisions) {
      pushSegment(
        this.toFrameWcs(division, frameTop),
        this.toFrameWcs(division, frameBottom)
      )
    }

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
      const y = frameTop - rowHeight * rowIndex
      pushSegment(this.toFrameWcs(0, y), this.toFrameWcs(width, y))
    }

    return segments
  }

  private toFrameWcs(localX: number, localY: number): AcGePoint3d {
    const basis = this.resolveLocalBasis()
    return this._location
      .clone()
      .addScaledVector(basis.xAxis, localX)
      .addScaledVector(basis.yAxis, localY)
  }

  private resolveFrameLayout(rows?: ToleranceFrameRow[]): ToleranceFrameLayout {
    const frameRows = rows ?? this.parseToleranceFrame(this._text)
    const textHeight = this.textHeight
    const rowHeight = textHeight * 2
    const cellPadding = textHeight / 2
    const columnGap = textHeight

    if (textHeight <= 0 || frameRows.length === 0) {
      return {
        width: 0,
        totalHeight: 0,
        rowHeight: 0,
        columnWidths: [],
        columnDivisions: [],
        rowCount: 0,
        cellPadding: 0,
        columnGap: 0
      }
    }

    const columnCount = Math.max(...frameRows.map(row => row.cells.length), 0)
    const columnWidths: number[] = []

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      let maxWidth = textHeight
      for (const row of frameRows) {
        const cell = row.cells[columnIndex] ?? ''
        if (!cell.trim()) {
          continue
        }
        const estimatedWidth = acdbEstimateToleranceCellWidth(cell, textHeight)
        maxWidth = Math.max(maxWidth, estimatedWidth)
      }
      columnWidths.push(maxWidth)
    }

    const columnDivisions: number[] = [0]
    let cursorX = cellPadding
    for (let columnIndex = 0; columnIndex < columnWidths.length; columnIndex++) {
      cursorX += columnWidths[columnIndex]
      cursorX += columnGap
      columnDivisions.push(cursorX - cellPadding)
    }

    const width = columnDivisions[columnDivisions.length - 1] ?? 0
    return {
      width,
      totalHeight: rowHeight * frameRows.length,
      rowHeight,
      columnWidths,
      columnDivisions,
      rowCount: frameRows.length,
      cellPadding,
      columnGap
    }
  }

  private parseToleranceFrame(text: string): ToleranceFrameRow[] {
    if (!text) {
      return []
    }

    const rowTexts = this.splitToleranceRows(text)
    if (rowTexts.length === 0) {
      return []
    }

    if (!text.includes('%%v')) {
      return rowTexts.map(row => ({
        cells: this.parsePipeSeparatedCells(row)
      }))
    }

    const slotRows = rowTexts.map(row => {
      const slots = this.splitToleranceTokens(row, '%%v')
      const padded = slots.slice(0, TOLERANCE_SLOT_COUNT)
      while (padded.length < TOLERANCE_SLOT_COUNT) {
        padded.push('')
      }
      return padded
    })

    const columnIndices = [0, 1]
    if (slotRows.some(slots => slots[2]?.trim())) {
      columnIndices.push(2)
    }
    for (let slotIndex = 3; slotIndex < TOLERANCE_SLOT_COUNT; slotIndex++) {
      if (slotRows.some(slots => slots[slotIndex]?.trim())) {
        columnIndices.push(slotIndex)
      }
    }

    return slotRows.map(slots => ({
      cells: columnIndices.map(index => slots[index] ?? '')
    }))
  }

  private splitToleranceRows(text: string): string[] {
    const normalized = text.replace(/\^J/g, '\n')
    return normalized
      .split(/\r\n|\r|\n|\\P/i)
      .map(row => row.trim())
      .filter(row => row.length > 0)
  }

  private splitToleranceTokens(text: string, delimiter: string): string[] {
    if (!text) {
      return []
    }

    const tokens: string[] = []
    let current = ''
    let braceDepth = 0

    for (let index = 0; index < text.length; ) {
      if (text.startsWith(delimiter, index) && braceDepth === 0) {
        tokens.push(current)
        current = ''
        index += delimiter.length
        continue
      }

      const char = text[index]
      if (char === '{') {
        braceDepth++
      } else if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1)
      }
      current += char
      index++
    }

    tokens.push(current)
    return tokens
  }

  private parsePipeSeparatedCells(text: string): string[] {
    if (!text) {
      return []
    }

    const cells = this.splitToleranceTokens(text, '|')
    return cells.filter(cell => cell.length > 0)
  }

  private resolveLocalBasis(): {
    xAxis: AcGeVector3d
    yAxis: AcGeVector3d
    zAxis: AcGeVector3d
  } {
    const zAxis = this._normal.clone()
    if (zAxis.lengthSq() === 0) {
      zAxis.set(0, 0, 1)
    } else {
      zAxis.normalize()
    }

    let xAxis = this._direction.clone()
    if (xAxis.lengthSq() === 0) {
      xAxis.set(1, 0, 0)
    } else {
      xAxis.normalize()
    }

    let yAxis = new AcGeVector3d().crossVectors(zAxis, xAxis)
    if (yAxis.lengthSq() === 0) {
      xAxis = AcGeVector3d.X_AXIS.clone()
      yAxis = new AcGeVector3d().crossVectors(zAxis, xAxis)
    }
    yAxis.normalize()
    xAxis = new AcGeVector3d().crossVectors(yAxis, zAxis).normalize()

    return { xAxis, yAxis, zAxis }
  }

  private resolveDimensionStyle(): AcDbDimStyleTableRecord | undefined {
    const styleName = this._dimensionStyle.trim()
    const database = this.tryGetDatabase()
    if (!styleName || !database) {
      return undefined
    }
    return database.tables.dimStyleTable.getAt(styleName)
  }

  private tryGetDatabase() {
    try {
      return this.database
    } catch {
      return undefined
    }
  }

  private getTextStyle(): AcGiTextStyle {
    const dimStyle = this.resolveDimensionStyle()
    const styleName =
      dimStyle?.dimtxsty ??
      AcDbDimStyleTableRecord.DEFAULT_DIM_VALUES.dimtxsty ??
      'Standard'
    const style = this.database.tables.textStyleTable.resolveAt(styleName)
    if (!style) {
      throw new Error('No valid text style found in text style table.')
    }
    return style.textStyle
  }
}

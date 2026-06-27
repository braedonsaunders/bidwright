import { AcCmColor } from '@mlightcad/common'
import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeQuaternion,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiMTextAttachmentPoint,
  AcGiMTextData,
  AcGiRenderer,
  AcGiTextStyle
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import type { AcDbBlockTableRecord } from '../database/AcDbBlockTableRecord'
import { AcDbBlockReference } from './AcDbBlockReference'
import { AcDbEntityProperties } from './AcDbEntityProperties'

/**
 * Interface defining the properties of a table cell within an AcDbTable entity.
 *
 * Table cells can contain various types of content including text, blocks, and other
 * entities. Each cell has properties that control its appearance, content, and behavior.
 */
export interface AcDbTableCell {
  /** The text content displayed in the cell */
  text: string
  /** The attachment point for text positioning within the cell */
  attachmentPoint: AcGiMTextAttachmentPoint
  /** Optional text style name for the cell content */
  textStyle?: string
  /** Optional rotation angle for the cell content in radians */
  rotation?: number
  /** The type of cell (text, block, etc.) */
  cellType: number
  /** Optional flag value for cell behavior */
  flagValue?: number
  /** Optional value indicating merged cell information */
  mergedValue?: number
  /** Optional auto-fit behavior setting */
  autoFit?: boolean
  /** Optional border width for merged cells */
  borderWidth?: number
  /** Optional border height for merged cells */
  borderHeight?: number // applicable for merged cells
  /** Optional override flag for cell properties */
  overrideFlag?: number
  /** Optional virtual edge flag for cell borders */
  virtualEdgeFlag?: number
  /** Optional border visibility overrides (cell-level) */
  topBorderVisibility?: boolean
  rightBorderVisibility?: boolean
  bottomBorderVisibility?: boolean
  leftBorderVisibility?: boolean
  /** Optional field object ID for text type cells */
  fieldObjetId?: string // only for text type cell
  /** Optional block table record ID for block type cells */
  blockTableRecordId?: string
  /** Optional scale factor for block type cells */
  blockScale?: number
  /** Optional number of block attributes */
  blockAttrNum?: number
  /** Optional array of attribute definition IDs */
  attrDefineId?: string[]
  /** Optional attribute text content */
  attrText?: string | string[]
  /** The height of text in the cell */
  textHeight: number
  /** Extended cell flags from AutoCAD 2007 and later */
  extendedCellFlags?: number // from AutoCAD 2007
  /** Cell value block begin marker (from AutoCAD 2007) */
  cellValueBlockBegin?: string
}

export interface AcDbTableBorderColors {
  left?: number
  top?: number
  insideHorizontal?: number
  bottom?: number
  insideVertical?: number
  right?: number
}

export interface AcDbTableCellTypeOverride {
  textStyle?: string
  textHeight?: number
  alignment?: number
  backgroundColor?: number
  contentColor?: number
  backgroundColorEnabled?: boolean
  borderLineweights?: {
    top?: number
    right?: number
    bottom?: number
    left?: number
    insideHorizontal?: number
    insideVertical?: number
  }
  borderVisibility?: {
    top?: boolean
    right?: boolean
    bottom?: boolean
    left?: boolean
    insideHorizontal?: boolean
    insideVertical?: boolean
  }
}

const tempVector = /*@__PURE__*/ new AcGeVector3d()

/**
 * Represents a table entity in AutoCAD.
 *
 * A table is generally thought of as an n x m rectangular array of cells whose contents
 * consist of annotation objects, primarily text. Tables often contain a title row, a
 * header row, and multiple data rows.
 *
 * After creating a new table object using the constructor, applications usually need to
 * set the table style, number of rows and columns, column width, row height, insert
 * position, width direction, and normal vector. Applications can also enter text or
 * block contents into each cell using methods of this class.
 *
 * Tables are commonly used for bills of materials, schedules, data sheets, and other
 * tabular information in technical drawings and documentation.
 */
export class AcDbTable extends AcDbBlockReference {
  /** The entity type name */
  static override typeName: string = 'Table'

  override get dxfTypeName() {
    return 'ACAD_TABLE'
  }

  private _attachmentPoint: AcGiMTextAttachmentPoint
  private _numRows: number
  private _numColumns: number
  private _rowHeight: number[]
  private _columnWidth: number[]
  private _cells: AcDbTableCell[]

  /** Table data version number (DXF group code 280) */
  tableDataVersion?: number
  /** Hard pointer ID of the TABLESTYLE object (DXF group code 342) */
  tableStyleId?: string
  /** Hard pointer ID of the owning BLOCK record (DXF group code 343) */
  owningBlockRecordId?: string
  /** Horizontal direction vector (DXF group code 11,21,31) */
  horizontalDirection?: AcGeVector3d
  /** Flag for table value (DXF group code 90) */
  tableValueFlag?: number
  /** Flag for an override (DXF group code 93) */
  tableOverrideFlag?: number
  /** Flag for an override of border color (DXF group code 94) */
  borderColorOverrideFlag?: number
  /** Flag for an override of border lineweight (DXF group code 95) */
  borderLineweightOverrideFlag?: number
  /** Flag for an override of border visibility (DXF group code 96) */
  borderVisibilityOverrideFlag?: number
  /** Flow direction; table-level override (DXF group code 70) */
  flowDirection?: number
  /** Horizontal cell margin; table-level override (DXF group code 40) */
  horizontalCellMargin?: number
  /** Vertical cell margin; table-level override (DXF group code 41) */
  verticalCellMargin?: number
  /** Flag for whether the title is suppressed; table-level override (DXF group code 280) */
  suppressTitle?: boolean
  /** Flag for whether the header row is suppressed; table-level override (DXF group code 281) */
  suppressHeader?: boolean
  /** Table-level border colors (DXF group codes 63/64/65/66/68/69) */
  tableBorderColors?: AcDbTableBorderColors
  /** Table-level cell-type overrides (one entry per cell type) */
  cellTypeOverrides?: AcDbTableCellTypeOverride[]
  /** Standard/title/header row data type (DXF group code 97) */
  rowDataTypes?: number[]
  /** Standard/title/header row unit type (DXF group code 98) */
  rowUnitTypes?: number[]
  /** Standard/title/header row format string (DXF group code 4) */
  rowFormats?: string[]

  /**
   * Creates a new table entity.
   *
   * @param name - The name of the table block reference
   * @param numRows - The number of rows in the table
   * @param numColumns - The number of columns in the table
   */
  constructor(name: string, numRows: number, numColumns: number) {
    super(name)
    this._attachmentPoint = AcGiMTextAttachmentPoint.TopLeft
    this._numColumns = numColumns
    this._numRows = numRows
    this._columnWidth = new Array<number>(numColumns)
    this._rowHeight = new Array<number>(numRows)
    this._cells = new Array<AcDbTableCell>(numRows * numColumns)
  }

  /**
   * Gets or sets the cell alignment value for this table.
   *
   * This property controls how text is positioned within table cells by default.
   * Individual cells can override this setting with their own attachment point.
   *
   * @returns The default attachment point for table cells
   */
  get attachmentPoint() {
    return this._attachmentPoint
  }
  set attachmentPoint(value: AcGiMTextAttachmentPoint) {
    this._attachmentPoint = value
  }

  /**
   * Gets or sets the number of rows in the table.
   *
   * Changing this value will resize the table and may affect existing cell data.
   *
   * @returns The current number of rows in the table
   */
  get numRows() {
    return this._numRows
  }
  set numRows(value: number) {
    this._numRows = value
  }

  /**
   * Gets or sets the number of columns in the table.
   *
   * Changing this value will resize the table and may affect existing cell data.
   *
   * @returns The current number of columns in the table
   */
  get numColumns() {
    return this._numColumns
  }
  set numColumns(value: number) {
    this._numColumns = value
  }

  /**
   * Gets the number of contents in the specified cell.
   *
   * @param row - Row index. Must be greater than or equal to 0 and less than the number of rows
   * @param col - Column index. Must be greater than or equal to 0 and less than the number of columns
   * @returns The number of contents in the specified cell
   */
  // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
  numContents(row: number, col: number) {
    // TODO: Implement it
    return 1
  }

  /**
   * Gets the row height of the specified row in the table.
   *
   * @param index - Zero-based row index
   * @returns The row height of the specified row in the table
   */
  rowHeight(index: number) {
    return this._rowHeight[index]
  }

  /**
   * Sets the row height for the specified row index in the table.
   *
   * @param index - Zero-based row index
   * @param height - Height to be used for the specified row
   */
  setRowHeight(index: number, height: number) {
    this._rowHeight[index] = height
  }

  /**
   * Sets a uniform row height for all the rows in the table.
   *
   * @param height - Height to be used for all the rows in the table
   */
  setUniformRowHeight(height: number) {
    this._rowHeight.fill(height)
  }

  /**
   * Gets the column width at the specified column index in the table.
   *
   * @param index - Zero-based column index
   * @returns The width of the specified column
   */
  columnWidth(index: number) {
    return this._columnWidth[index]
  }

  /**
   * Sets a uniform column width for all the columns in the table.
   *
   * @param width - Uniform width to be used for all the columns in the table
   */
  setUniformColumnWidth(width: number) {
    this._columnWidth.fill(width)
  }

  /**
   * Sets the column width at the specified column index in the table.
   *
   * @param index - Zero-based column index
   * @param width - Width to be used for the specified column
   */
  setColumnWidth(index: number, width: number) {
    this._columnWidth[index] = width
  }

  /**
   * Gets the cell at the specified index.
   *
   * @param index - Cell index (calculated as row * numColumns + column)
   * @returns The specified cell by index, or undefined if index is out of range
   */
  cell(index: number) {
    if (index < 0 || index >= this._cells.length) return undefined
    return this._cells[index]
  }

  /**
   * Sets the cell at the specified index.
   *
   * @param index - Cell index (calculated as row * numColumns + column)
   * @param cell - The cell data to set
   */
  setCell(index: number, cell: AcDbTableCell) {
    this._cells[index] = cell
  }

  /**
   * Gets the text string in the specified cell.
   *
   * @param row - Integer specifying the zero-based row index for the cell
   * @param col - Integer specifying the zero-based column index for the cell
   * @param content - Content index. Should be greater than or equal to 0 and less than the number of contents
   * @returns The text string in the specified cell
   */
  // @ts-expect-error not use '_' prefix so that typedoc can the correct parameter to generate doc
  textString(row: number, col: number, content?: number) {
    const index = row * this._numColumns + col
    return this._cells[index]?.text
  }

  /**
   * Sets the text for the first content at the specified content index.
   *
   * @param row - Integer specifying the zero-based row index for the cell
   * @param col - Integer specifying the zero-based column index for the cell
   * @param text - Text string to set
   */
  setTextString(row: number, col: number, text: string) {
    const index = row * this._numColumns + col
    if (!this._cells[index]) {
      this._cells[index] = {
        text,
        attachmentPoint: this._attachmentPoint,
        cellType: 1,
        textHeight: 0
      }
      return
    }
    this._cells[index].text = text
  }

  /**
   * Checks if the content of the specified cell is empty.
   *
   * @param row - Integer specifying the zero-based row index for the cell
   * @param col - Integer specifying the zero-based column index for the cell
   * @returns True if the content of the specified cell is empty, false otherwise
   */
  isEmpty(row: number, col: number) {
    const index = row * this._numColumns + col
    return !this._cells[index]?.text
  }

  /**
   * Gets the geometric extents (bounding box) of this table entity.
   *
   * The geometric extents define the minimum bounding box that completely contains
   * the table entity, including all its cells, borders, and content.
   *
   * @returns A 3D bounding box containing the table entity
   * @inheritdoc
   */
  get geometricExtents(): AcGeBox3d {
    let blockTableRecord
    try {
      blockTableRecord = this.blockTableRecord
    } catch {
      blockTableRecord = undefined
    }

    if (blockTableRecord && blockTableRecord.newIterator().count > 0) {
      const box = new AcGeBox3d()
      for (const entity of blockTableRecord.newIterator()) {
        box.union(entity.geometricExtents)
      }
      box.applyMatrix4(this.blockTransform)
      return box
    }

    const totalWidth = this._columnWidth.reduce((sum, value) => sum + value, 0)
    const totalHeight = this._rowHeight.reduce((sum, value) => sum + value, 0)
    const box = new AcGeBox3d()

    if (totalWidth === 0 && totalHeight === 0) {
      box.expandByPoint(this.position)
      return box
    }

    const quaternion = new AcGeQuaternion()
    quaternion.setFromAxisAngle(AcGeVector3d.Z_AXIS, this.rotation)
    _tmpMatrix.compose(this.position, quaternion, this.scaleFactors)

    const localCorners = [
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(totalWidth, 0, 0),
      new AcGePoint3d(totalWidth, -totalHeight, 0),
      new AcGePoint3d(0, -totalHeight, 0)
    ]

    for (const corner of localCorners) {
      box.expandByPoint(corner.applyMatrix4(_tmpMatrix))
    }

    return box
  }

  /**
   * Returns the full property definition for this table entity, including
   * general group, table group, and geometry group.
   *
   * The geometry group exposes editable properties via {@link AcDbPropertyAccessor}
   * so the property palette can update the table in real-time.
   *
   * Each property is an {@link AcDbEntityRuntimeProperty}.
   */
  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'table',
          properties: [
            {
              name: 'numRows',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.numRows,
                set: (v: number) => {
                  this.numRows = v
                }
              }
            },
            {
              name: 'numColumns',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.numColumns,
                set: (v: number) => {
                  this.numColumns = v
                }
              }
            },
            {
              name: 'tableWidth',
              type: 'float',
              editable: false,
              accessor: {
                get: () =>
                  this._columnWidth.reduce((total, value) => total + value, 0)
              }
            },
            {
              name: 'tableHeight',
              type: 'float',
              editable: false,
              accessor: {
                get: () =>
                  this._rowHeight.reduce((total, value) => total + value, 0)
              }
            }
          ]
        },
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'positionX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.x,
                set: (v: number) => {
                  this.position.x = v
                }
              }
            },
            {
              name: 'positionY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.y,
                set: (v: number) => {
                  this.position.y = v
                }
              }
            },
            {
              name: 'positionZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.z,
                set: (v: number) => {
                  this.position.z = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Renders the table entity using the specified graphics renderer.
   *
   * This method draws the table structure including borders, cell content, and text.
   * It handles the rendering of individual cells, merged cells, and applies the
   * appropriate transformations and styling.
   *
   * @param renderer - The graphics renderer used to draw the table
   * @returns The rendered graphics entity representing the table
   */
  subWorldDraw(renderer: AcGiRenderer): AcGiEntity {
    const blockTableRecord = this.blockTableRecord
    if (blockTableRecord && blockTableRecord.newIterator().count > 0) {
      const block = this.drawAnonymousTableBlock(renderer, blockTableRecord)
      if (block) return block
    }

    let allRowHeights = 0,
      allColumnWidths = 0
    const indices = new Uint16Array(this.numColumns * this.numRows * 8)
    const points = new Float32Array(
      (this.numColumns + 1) * (this.numRows + 1) * 3
    )
    let index = 0
    for (let i = 0; i <= this.numRows; i++) {
      allRowHeights -= i > 0 ? this.rowHeight(i - 1) : 0
      allColumnWidths = 0
      for (let j = 0; j <= this.numColumns; j++) {
        allColumnWidths += j > 0 ? this.columnWidth(j - 1) : 0
        points[index++] = allColumnWidths
        points[index++] = allRowHeights
        points[index++] = 0
      }
    }

    const results: AcGiEntity[] = []
    const visited: boolean[] = new Array(this.numRows * this.numColumns).fill(
      false
    )
    allColumnWidths = 0
    index = 0
    let cellIndex = 0
    for (let i = 0; i < this.numColumns; i++) {
      allColumnWidths += i > 0 ? this.columnWidth(i - 1) : 0
      allRowHeights = 0
      for (let j = 0; j < this.numRows; j++) {
        allRowHeights += j > 0 ? this.rowHeight(j - 1) : 0
        const cell = this.cell(j * this.numColumns + i)
        cellIndex = j * this.numColumns + i
        if (cell && !visited[cellIndex]) {
          const columnSpan = cell.borderWidth ?? 1
          const rowSpan = cell.borderHeight ?? 1
          this.fillVisited(
            visited,
            cellIndex,
            this.numColumns,
            columnSpan,
            rowSpan
          )

          // Draw top border line of the current cell by considering merged cell
          indices[index++] = i + j * (this.numColumns + 1)
          indices[index++] = i + j * (this.numColumns + 1) + columnSpan

          // Calcuate width of the cell by considering merged cell
          const width = points[indices[index - 1] * 3] - allColumnWidths

          // Draw right border line of the current cell by considering merged cell
          const tmp = i + (j + rowSpan) * (this.numColumns + 1) + columnSpan
          if (i + columnSpan == this.numColumns) {
            indices[index++] = i + j * (this.numColumns + 1) + columnSpan
            indices[index++] = tmp
          }

          // Calcuate height of the cell by considering merged cell
          const height = -points[tmp * 3 + 1] - allRowHeights

          // Draw bottom border line of the current cell by considering merged cell
          if (j + rowSpan == this.numRows) {
            indices[index++] =
              i + (j + rowSpan) * (this.numColumns + 1) + rowSpan
            indices[index++] = i + (j + rowSpan) * (this.numColumns + 1)
          }

          // Draw left border line of the current cell by considering merged cell
          indices[index++] = i + (j + rowSpan) * (this.numColumns + 1)
          indices[index++] = i + j * (this.numColumns + 1)

          // Draw text
          if (cell.text) {
            const attachmentPoint =
              cell.attachmentPoint ||
              this.attachmentPoint ||
              AcGiMTextAttachmentPoint.MiddleCenter
            const offset = this.getTableTextOffset(
              attachmentPoint,
              width,
              height
            )
            const mtextData: AcGiMTextData = {
              text: cell.text,
              height: this.getCellTextHeight(cell, height),
              width: width,
              position: tempVector
                .set(allColumnWidths, -allRowHeights, 0)
                .clone()
                .add(offset),
              rotation: this.rotation,
              attachmentPoint: attachmentPoint
            }
            const textStyle: AcGiTextStyle = this.getTextStyle(cell)
            results.push(renderer.mtext(mtextData, textStyle))
          }
        }
      }
    }
    results.push(renderer.lineSegments(points, 3, indices))

    const group = renderer.group(results)
    const quaternion = new AcGeQuaternion()
    quaternion.setFromAxisAngle(AcGeVector3d.Z_AXIS, this.rotation)
    _tmpMatrix.compose(this.position, quaternion, this.scaleFactors)
    group.applyMatrix(_tmpMatrix)
    return group
  }

  private drawAnonymousTableBlock(
    renderer: AcGiRenderer,
    blockTableRecord: AcDbBlockTableRecord
  ) {
    const results: AcGiEntity[] = []
    const entities = blockTableRecord.newIterator()
    for (const entity of entities) {
      let object: AcGiEntity | undefined
      if (entity.color.isByBlock) {
        _tmpColor.copy(entity.color)
        const tableColor = this.resolvedColor
        if (tableColor.isForeground) {
          entity.color.setForeground()
        } else if (tableColor.RGB != null) {
          entity.color.setRGBValue(tableColor.RGB)
        }
        object = entity.worldDraw(renderer)
        entity.color.copy(_tmpColor)
      } else {
        object = entity.worldDraw(renderer)
      }

      if (object) {
        object.objectId = this.objectId
        object.ownerId = this.ownerId
        object.layerName = this.layer
        object.visible = this.visibility && entity.visibility
        results.push(object)
      }
    }

    const group = renderer.group(results)
    group.applyMatrix(this.blockTransform)

    const normal = this.normal
    if (normal && (normal.x !== 0 || normal.y !== 0 || normal.z !== 1)) {
      _tmpMatrix.setFromExtrusionDirection(normal)
      group.applyMatrix(_tmpMatrix)
    }

    return group
  }

  /**
   * Marks cells as visited to handle merged cell rendering.
   *
   * This method prevents duplicate rendering of merged cells by marking all
   * constituent cells as visited.
   *
   * @param visited - Array tracking which cells have been processed
   * @param currentIndex - Index of the current cell being processed
   * @param columnCount - Total number of columns in the table
   * @param columnSpan - Number of columns this cell spans
   * @param rowSpan - Number of rows this cell spans
   * @private
   */
  private fillVisited(
    visited: boolean[],
    currentIndex: number,
    columnCount: number,
    columnSpan: number,
    rowSpan: number
  ) {
    if (rowSpan == 1 && columnSpan == 1) {
      visited[currentIndex] = true
    } else {
      for (let i = 0; i < columnSpan; ++i) {
        for (let j = 0; j < rowSpan; ++j) {
          visited[currentIndex + i + j * columnCount] = true
        }
      }
    }
  }

  /**
   * Gets the text style for a specific cell.
   *
   * This method retrieves the appropriate text style for the cell, falling back
   * to the standard style if no specific style is specified.
   *
   * @param cell - The cell for which to get the text style
   * @returns The text style configuration for the cell
   * @private
   */
  private getTextStyle(cell: AcDbTableCell): AcGiTextStyle {
    const style = this.database.tables.textStyleTable.resolveAt(cell.textStyle)
    if (!style) {
      throw new Error('No valid text style found in text style table.')
    }
    return style.textStyle
  }

  /**
   * Calculates the text offset within a table cell based on attachment point.
   *
   * This method determines the appropriate positioning offset for text within
   * a cell based on the specified attachment point and cell dimensions.
   *
   * @param textAlign - The text alignment/attachment point value
   * @param width - The width of the cell
   * @param height - The height of the cell
   * @returns A vector representing the text offset from the cell corner
   * @private
   */
  private getTableTextOffset(textAlign: number, width: number, height: number) {
    const offset = new AcGeVector3d()
    switch (textAlign) {
      case 1:
        break
      case 2:
        // Top Center
        offset.setX(width / 2)
        break
      case 3:
        // Top Right
        offset.setX(width)
        break
      case 4:
        // Middle Left
        offset.setY(-height / 2)
        break
      case 5:
        // Middle Center
        offset.set(width / 2, -height / 2, 0)
        break
      case 6:
        // Middle Right
        offset.set(width, -height / 2, 0)
        break
      case 7:
        // Bottom Left
        offset.setY(-height)
        break
      case 8:
        // Bottom Center
        offset.set(width / 2, -height, 0)
        break
      case 9:
        // Bottom Right
        offset.set(width, -height, 0)
        break
    }
    return offset
  }

  /**
   * Resolves a usable text height for table cells.
   *
   * Some DXF tables omit per-cell text height because their anonymous table block
   * carries the final MTEXT geometry. When that block is unavailable, fall back to
   * a conservative half-row height so the table text still has visible geometry.
   */
  private getCellTextHeight(cell: AcDbTableCell, rowHeight: number) {
    if (cell.textHeight && cell.textHeight > 0) {
      return cell.textHeight
    }
    return Math.max(rowHeight / 2, 1)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbTable')

    const version =
      filer.version ?? filer.database?.version ?? this.database?.version
    const is2007OrLater = version?.value != null ? version.value >= 27 : false

    filer.writeInt16(280, this.tableDataVersion)
    filer.writeObjectId(342, this.tableStyleId)
    filer.writeObjectId(343, this.owningBlockRecordId)
    filer.writeVector3d(11, this.horizontalDirection)
    filer.writeUInt32(90, this.tableValueFlag)
    filer.writeUInt32(93, this.tableOverrideFlag)
    filer.writeUInt32(94, this.borderColorOverrideFlag)
    filer.writeUInt32(95, this.borderLineweightOverrideFlag)
    filer.writeUInt32(96, this.borderVisibilityOverrideFlag)

    filer.writeInt16(71, this.attachmentPoint)
    filer.writeInt32(91, this.numRows)
    filer.writeInt32(92, this.numColumns)
    for (let i = 0; i < this.numRows; ++i) {
      filer.writeDouble(141, this.rowHeight(i))
    }
    for (let i = 0; i < this.numColumns; ++i) {
      filer.writeDouble(142, this.columnWidth(i))
    }

    const totalCells =
      this._cells.length > 0
        ? this._cells.length
        : this.numRows * this.numColumns
    for (let i = 0; i < totalCells; i++) {
      const cell = this._cells[i]
      const cellType = cell?.cellType ?? (cell?.blockTableRecordId ? 2 : 1)
      filer.writeInt16(171, cellType)
      filer.writeInt16(172, cell?.flagValue ?? 0)
      filer.writeInt16(173, cell?.mergedValue ?? 0)
      filer.writeBoolean(174, cell?.autoFit)
      filer.writeInt16(175, cell?.borderWidth)
      filer.writeInt16(176, cell?.borderHeight)
      if (cell?.overrideFlag != null) {
        if (is2007OrLater) {
          filer.writeInt32(91, cell.overrideFlag)
        } else {
          filer.writeInt16(177, cell.overrideFlag)
        }
      }
      filer.writeInt16(178, cell?.virtualEdgeFlag)
      filer.writeAngle(145, cell?.rotation)
      if (is2007OrLater) {
        filer.writeInt16(92, cell?.extendedCellFlags)
      }

      if (cellType === 1) {
        if (cell?.fieldObjetId) {
          filer.writeObjectId(344, cell.fieldObjetId)
        } else {
          this.writeCellText(
            filer,
            cell?.text ?? '',
            is2007OrLater,
            cell?.cellValueBlockBegin
          )
        }
      } else if (cellType === 2) {
        filer.writeObjectId(340, cell?.blockTableRecordId)
        filer.writeDouble(144, cell?.blockScale)
        filer.writeInt16(179, cell?.blockAttrNum)
        if (cell?.attrDefineId?.length) {
          for (const attrId of cell.attrDefineId) {
            filer.writeObjectId(331, attrId)
          }
        }
        if (cell?.attrText != null) {
          if (Array.isArray(cell.attrText)) {
            for (const text of cell.attrText) {
              filer.writeString(300, text)
            }
          } else {
            filer.writeString(300, cell.attrText)
          }
        }
      }

      if (cell?.textStyle) {
        filer.writeString(7, cell.textStyle)
      }
      if (cell?.textHeight != null) {
        filer.writeDouble(140, cell.textHeight)
      }
      if (cell?.attachmentPoint != null) {
        filer.writeInt16(170, cell.attachmentPoint)
      }
      if (cell?.topBorderVisibility != null) {
        filer.writeInt16(289, cell.topBorderVisibility ? 1 : 0)
      }
      if (cell?.rightBorderVisibility != null) {
        filer.writeInt16(285, cell.rightBorderVisibility ? 1 : 0)
      }
      if (cell?.bottomBorderVisibility != null) {
        filer.writeInt16(286, cell.bottomBorderVisibility ? 1 : 0)
      }
      if (cell?.leftBorderVisibility != null) {
        filer.writeInt16(288, cell.leftBorderVisibility ? 1 : 0)
      }
    }

    filer.writeInt16(70, this.flowDirection)
    filer.writeDouble(40, this.horizontalCellMargin)
    filer.writeDouble(41, this.verticalCellMargin)
    if (this.suppressTitle != null) {
      filer.writeInt16(280, this.suppressTitle ? 1 : 0)
    }
    if (this.suppressHeader != null) {
      filer.writeInt16(281, this.suppressHeader ? 1 : 0)
    }

    if (this.cellTypeOverrides?.length) {
      for (const override of this.cellTypeOverrides) {
        filer.writeString(7, override.textStyle)
        filer.writeDouble(140, override.textHeight)
        filer.writeInt16(170, override.alignment)
        filer.writeInt16(63, override.backgroundColor)
        filer.writeInt16(64, override.contentColor)
        if (override.backgroundColorEnabled != null) {
          filer.writeInt16(283, override.backgroundColorEnabled ? 1 : 0)
        }
        const lw = override.borderLineweights
        if (lw) {
          filer.writeInt16(274, lw.top)
          filer.writeInt16(275, lw.right)
          filer.writeInt16(276, lw.bottom)
          filer.writeInt16(277, lw.left)
          filer.writeInt16(278, lw.insideHorizontal)
          filer.writeInt16(279, lw.insideVertical)
        }
        const vis = override.borderVisibility
        if (vis) {
          filer.writeInt16(284, vis.top ? 1 : 0)
          filer.writeInt16(285, vis.right ? 1 : 0)
          filer.writeInt16(286, vis.bottom ? 1 : 0)
          filer.writeInt16(287, vis.left ? 1 : 0)
          filer.writeInt16(288, vis.insideHorizontal ? 1 : 0)
          filer.writeInt16(289, vis.insideVertical ? 1 : 0)
        }
      }
    }

    if (this.tableBorderColors) {
      filer.writeInt16(63, this.tableBorderColors.left)
      filer.writeInt16(64, this.tableBorderColors.top)
      filer.writeInt16(65, this.tableBorderColors.insideHorizontal)
      filer.writeInt16(66, this.tableBorderColors.bottom)
      filer.writeInt16(68, this.tableBorderColors.insideVertical)
      filer.writeInt16(69, this.tableBorderColors.right)
    }

    if (this.rowDataTypes?.length) {
      for (const dataType of this.rowDataTypes) {
        filer.writeInt16(97, dataType)
      }
    }
    if (this.rowUnitTypes?.length) {
      for (const unitType of this.rowUnitTypes) {
        filer.writeInt16(98, unitType)
      }
    }
    if (this.rowFormats?.length) {
      for (const format of this.rowFormats) {
        filer.writeString(4, format)
      }
    }
    return this
  }

  private writeCellText(
    filer: AcDbDxfFiler,
    text: string,
    is2007OrLater: boolean,
    cellValueBlockBegin?: string
  ) {
    const chunkSize = 250
    if (!is2007OrLater) {
      if (text.length <= chunkSize) {
        filer.writeString(1, text)
        return
      }
      const chunks = Math.ceil(text.length / chunkSize)
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize
        const end = start + chunkSize
        const chunk = text.slice(start, end)
        if (i === chunks - 1) {
          filer.writeString(1, chunk)
        } else {
          filer.writeString(2, chunk)
        }
      }
      return
    }

    filer.writeString(301, cellValueBlockBegin ?? 'CELL_VALUE')
    if (text.length <= chunkSize) {
      filer.writeString(302, text)
      filer.writeString(304, 'ACVALUE_END')
      return
    }
    const chunks = Math.ceil(text.length / chunkSize)
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize
      const end = start + chunkSize
      const chunk = text.slice(start, end)
      if (i === chunks - 1) {
        filer.writeString(302, chunk)
      } else {
        filer.writeString(303, chunk)
      }
    }
    filer.writeString(304, 'ACVALUE_END')
  }
}

const _tmpMatrix = /*@__PURE__*/ new AcGeMatrix3d()
const _tmpColor = /*@__PURE__*/ new AcCmColor()

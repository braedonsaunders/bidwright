import { AcGeBox3d, AcGePoint3d } from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiContext,
  AcGiMTextAttachmentPoint,
  AcGiRenderer,
  DEFAULT_ACGI_CONTEXT
} from '@mlightcad/graphic-interface'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbBlockTableRecord, AcDbDatabase } from '../src/database'
import { AcDbMText, AcDbTable } from '../src/entity'
import { AcDbRenderingCache } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createGiEntity = () => {
  const entity = {
    objectId: '',
    ownerId: '',
    layerName: '',
    visible: true,
    applyMatrix: jest.fn(),
    addChild: jest.fn(),
    fastDeepClone: jest.fn()
  }
  entity.fastDeepClone.mockImplementation(() => createGiEntity())
  return entity
}

const createRenderer = () => {
  const traits: Record<string, unknown> = {}
  return {
    context: new AcGiContext({ ...DEFAULT_ACGI_CONTEXT }),
    subEntityTraits: traits,
    lines: jest.fn(() => createGiEntity()),
    circularArc: jest.fn(() => createGiEntity()),
    ellipticalArc: jest.fn(() => createGiEntity()),
    lineSegments: jest.fn(() => createGiEntity()),
    area: jest.fn(() => createGiEntity()),
    point: jest.fn(() => createGiEntity()),
    image: jest.fn(() => createGiEntity()),
    mtext: jest.fn(() => createGiEntity()),
    setFontMapping: jest.fn(),
    group: jest.fn((children: unknown[] = []) => {
      const group = createGiEntity() as Record<string, unknown>
      group.children = children
      return group
    })
  }
}

const setWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbTable', () => {
  beforeEach(() => {
    AcDbRenderingCache.instance.clear()
  })

  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbTable('TEST', 1, 1))
  })
  it('supports all core table getters/setters and cell APIs', () => {
    const table = new AcDbTable('TABLE_METHODS', 2, 3)
    expect(AcDbTable.typeName).toBe('Table')
    expect(table.dxfTypeName).toBe('ACAD_TABLE')

    table.attachmentPoint = AcGiMTextAttachmentPoint.BottomCenter
    table.numRows = 4
    table.numColumns = 5
    expect(table.attachmentPoint).toBe(AcGiMTextAttachmentPoint.BottomCenter)
    expect(table.numRows).toBe(4)
    expect(table.numColumns).toBe(5)

    table.setRowHeight(0, 8)
    table.setUniformRowHeight(6)
    table.setRowHeight(1, 9)
    expect(table.rowHeight(0)).toBe(6)
    expect(table.rowHeight(1)).toBe(9)

    table.setColumnWidth(0, 20)
    table.setUniformColumnWidth(12)
    table.setColumnWidth(2, 18)
    expect(table.columnWidth(0)).toBe(12)
    expect(table.columnWidth(2)).toBe(18)

    expect(table.cell(-1)).toBeUndefined()
    expect(table.cell(999)).toBeUndefined()
    table.setTextString(0, 0, 'A00')
    expect(table.numContents(0, 0)).toBe(1)
    expect(table.textString(0, 0)).toBe('A00')
    expect(table.isEmpty(0, 0)).toBe(false)
    expect(table.isEmpty(1, 1)).toBe(true)
    expect(table.textString(99, 99, 0)).toBeUndefined()

    const firstCell = table.cell(0)
    expect(firstCell).toMatchObject({
      text: 'A00',
      attachmentPoint: AcGiMTextAttachmentPoint.BottomCenter,
      cellType: 1,
      textHeight: 0
    })

    table.setCell(0, {
      text: 'A00-EDITED',
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleCenter,
      cellType: 1,
      textHeight: 2
    })
    expect(table.textString(0, 0)).toBe('A00-EDITED')

    table.setTextString(0, 0, 'A00-UPDATED')
    expect(table.textString(0, 0)).toBe('A00-UPDATED')
    expect(table.cell(0)?.attachmentPoint).toBe(
      AcGiMTextAttachmentPoint.MiddleCenter
    )

    expect(table.geometricExtents).toBeInstanceOf(AcGeBox3d)
  })

  it('returns geometricExtents and recomputes when position changes', () => {
    const table = new AcDbTable('TABLE_EXTENTS', 2, 2)
    table.position = new AcGePoint3d(0, 0, 0)
    table.setUniformRowHeight(10)
    table.setUniformColumnWidth(20)

    expect(table.geometricExtents.min).toMatchObject({ x: 0, y: -20, z: 0 })
    expect(table.geometricExtents.max).toMatchObject({ x: 40, y: 0, z: 0 })

    table.position = new AcGePoint3d(5, 5, 0)

    expect(table.geometricExtents.min).toMatchObject({ x: 5, y: -15, z: 0 })
    expect(table.geometricExtents.max).toMatchObject({ x: 45, y: 5, z: 0 })
  })

  it('exposes editable runtime properties for table and geometry groups', () => {
    const table = new AcDbTable('TABLE_PROPERTIES', 2, 2)
    table.position = new AcGePoint3d(1, 2, 3)
    table.setUniformRowHeight(10)
    table.setUniformColumnWidth(20)

    const props = table.properties
    const tableGroup = props.groups.find(group => group.groupName === 'table')
    const geometryGroup = props.groups.find(
      group => group.groupName === 'geometry'
    )
    expect(tableGroup).toBeDefined()
    expect(geometryGroup).toBeDefined()

    const numRowsProp = tableGroup?.properties.find(p => p.name === 'numRows')
    const numColumnsProp = tableGroup?.properties.find(
      p => p.name === 'numColumns'
    )
    const tableWidthProp = tableGroup?.properties.find(
      p => p.name === 'tableWidth'
    )
    const tableHeightProp = tableGroup?.properties.find(
      p => p.name === 'tableHeight'
    )
    expect(numRowsProp?.accessor.get()).toBe(2)
    numRowsProp?.accessor.set?.(3)
    expect(numRowsProp?.accessor.get()).toBe(3)
    expect(numColumnsProp?.accessor.get()).toBe(2)
    numColumnsProp?.accessor.set?.(4)
    expect(numColumnsProp?.accessor.get()).toBe(4)
    expect(tableWidthProp?.accessor.get()).toBe(40)
    expect(tableHeightProp?.accessor.get()).toBe(20)

    const positionXProp = geometryGroup?.properties.find(
      p => p.name === 'positionX'
    )
    const positionYProp = geometryGroup?.properties.find(
      p => p.name === 'positionY'
    )
    const positionZProp = geometryGroup?.properties.find(
      p => p.name === 'positionZ'
    )
    positionXProp?.accessor.set?.(11)
    positionYProp?.accessor.set?.(22)
    positionZProp?.accessor.set?.(33)
    expect(positionXProp?.accessor.get()).toBe(11)
    expect(positionYProp?.accessor.get()).toBe(22)
    expect(positionZProp?.accessor.get()).toBe(33)
  })

  it('renders texts and merged-cell borders via subWorldDraw', () => {
    const db = setWorkingDb()
    const renderer = createRenderer()
    const table = new AcDbTable('TABLE_DRAW', 3, 3)
    db.tables.blockTable.modelSpace.appendEntity(table)

    table.position = new AcGePoint3d(4, 5, 0)
    table.rotation = Math.PI / 6
    table.scaleFactors = new AcGePoint3d(2, 2, 1)
    table.attachmentPoint = 0 as AcGiMTextAttachmentPoint
    table.setUniformRowHeight(10)
    table.setUniformColumnWidth(20)

    const alignments = [1, 2, 3, 4, 5, 6, 7, 8, 9] as AcGiMTextAttachmentPoint[]
    for (let i = 0; i < 9; i++) {
      table.setCell(i, {
        text: `R${i}`,
        attachmentPoint: alignments[i],
        textStyle: 'Standard',
        cellType: 1,
        textHeight: 2
      })
    }
    table.setCell(0, {
      text: 'MERGED-2X2',
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleCenter,
      textStyle: 'Standard',
      cellType: 1,
      textHeight: 2,
      borderWidth: 2,
      borderHeight: 2
    })
    table.setCell(8, {
      text: 'FALLBACK_ALIGN',
      attachmentPoint: 0 as AcGiMTextAttachmentPoint,
      cellType: 1,
      textHeight: 2
    })

    const drawn = table.subWorldDraw(
      renderer as unknown as AcGiRenderer<AcGiEntity>
    )
    expect(drawn).toBeDefined()
    expect(renderer.mtext).toHaveBeenCalled()
    expect(renderer.lineSegments).toHaveBeenCalledTimes(1)
    const grouped = renderer.group.mock.results[0]?.value
    expect(grouped.applyMatrix).toHaveBeenCalledTimes(1)
  })

  it('uses the anonymous table block when available even if cells are populated', () => {
    const db = setWorkingDb()
    const renderer = createRenderer()
    const block = new AcDbBlockTableRecord()
    block.name = '*T_TABLE_TEST'
    db.tables.blockTable.add(block)

    const mtext = new AcDbMText()
    mtext.contents = 'BLOCK_TABLE_TEXT'
    mtext.height = 4.5
    block.appendEntity(mtext)

    const table = new AcDbTable('*T_TABLE_TEST', 1, 1)
    db.tables.blockTable.modelSpace.appendEntity(table)
    table.setUniformRowHeight(9)
    table.setUniformColumnWidth(20)
    table.setCell(0, {
      text: 'CELL_TEXT_WITHOUT_HEIGHT',
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleCenter,
      cellType: 1,
      textHeight: undefined as unknown as number
    })

    table.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)

    expect(renderer.mtext).toHaveBeenCalledTimes(1)
    const mtextCall = renderer.mtext.mock.calls[0] as unknown[]
    expect((mtextCall[0] as { text: string }).text).toBe('BLOCK_TABLE_TEXT')
    expect((mtextCall[0] as { height: number }).height).toBe(4.5)
    expect(renderer.lineSegments).not.toHaveBeenCalled()
  })

  it('renders an anonymous table block when cell content is unavailable', () => {
    const db = setWorkingDb()
    const renderer = createRenderer()
    const block = new AcDbBlockTableRecord()
    block.name = '*T_TABLE_TEST'
    db.tables.blockTable.add(block)

    const mtext = new AcDbMText()
    mtext.contents = 'BLOCK_TABLE_TEXT'
    mtext.height = 4.5
    block.appendEntity(mtext)

    const table = new AcDbTable('*T_TABLE_TEST', 1, 1)
    db.tables.blockTable.modelSpace.appendEntity(table)
    table.setUniformRowHeight(9)
    table.setUniformColumnWidth(20)

    table.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)

    expect(renderer.mtext).toHaveBeenCalledTimes(1)
    const mtextCall = renderer.mtext.mock.calls[0] as unknown[]
    expect((mtextCall[0] as { text: string }).text).toBe('BLOCK_TABLE_TEXT')
    const groupedChildren = renderer.group.mock.calls[0][0] as Array<{
      objectId: string
      layerName: string
    }>
    expect(groupedChildren[0].objectId).toBe(table.objectId)
    expect(groupedChildren[0].layerName).toBe(table.layer)
    expect(renderer.lineSegments).not.toHaveBeenCalled()
  })

  it('uses a visible fallback text height when rebuilding cells without one', () => {
    const db = setWorkingDb()
    const renderer = createRenderer()
    const table = new AcDbTable('TABLE_WITHOUT_BLOCK', 1, 1)
    db.tables.blockTable.modelSpace.appendEntity(table)
    table.setUniformRowHeight(9)
    table.setUniformColumnWidth(20)
    table.setCell(0, {
      text: 'VISIBLE_FALLBACK_TEXT',
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleCenter,
      cellType: 1,
      textHeight: undefined as unknown as number
    })

    table.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)

    expect(renderer.mtext).toHaveBeenCalledTimes(1)
    const mtextCall = renderer.mtext.mock.calls[0] as unknown[]
    expect((mtextCall[0] as { height: number }).height).toBe(4.5)
    expect(renderer.lineSegments).toHaveBeenCalledTimes(1)
  })

  it('uses text style fallback order and throws if no style can be resolved', () => {
    const db = setWorkingDb()
    const renderer = createRenderer()

    const first = new AcDbTable('STYLE_1', 1, 1)
    db.tables.blockTable.modelSpace.appendEntity(first)
    first.setUniformRowHeight(10)
    first.setUniformColumnWidth(10)
    first.setCell(0, {
      text: 'A',
      textStyle: 'Standard',
      attachmentPoint: AcGiMTextAttachmentPoint.TopLeft,
      cellType: 1,
      textHeight: 1
    })
    expect(() =>
      first.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)
    ).not.toThrow()

    const second = new AcDbTable('STYLE_2', 1, 1)
    db.tables.blockTable.modelSpace.appendEntity(second)
    second.setUniformRowHeight(10)
    second.setUniformColumnWidth(10)
    second.setCell(0, {
      text: 'B',
      attachmentPoint: AcGiMTextAttachmentPoint.TopLeft,
      cellType: 1,
      textHeight: 1
    })
    db.textstyle = 'Standard'
    expect(() =>
      second.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)
    ).not.toThrow()

    const third = new AcDbTable('STYLE_3', 1, 1)
    db.tables.blockTable.modelSpace.appendEntity(third)
    third.setUniformRowHeight(10)
    third.setUniformColumnWidth(10)
    third.setCell(0, {
      text: 'C',
      attachmentPoint: AcGiMTextAttachmentPoint.TopLeft,
      cellType: 1,
      textHeight: 1
    })
    db.textstyle = 'NOT_EXIST'
    expect(() =>
      third.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)
    ).not.toThrow()

    const styleTable = third.database.tables.textStyleTable
    const resolveAtSpy = jest
      .spyOn(styleTable, 'resolveAt')
      .mockReturnValue(undefined)
    expect(() =>
      third.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)
    ).toThrow('No valid text style found in text style table.')
    resolveAtSpy.mockRestore()
  })

  it('covers remaining text alignment branches in subWorldDraw', () => {
    const db = setWorkingDb()
    const renderer = createRenderer()
    const table = new AcDbTable('TABLE_ALIGN', 1, 3)
    db.tables.blockTable.modelSpace.appendEntity(table)
    table.setUniformRowHeight(10)
    table.setUniformColumnWidth(10)

    table.setCell(0, {
      text: 'TOP_CENTER',
      attachmentPoint: AcGiMTextAttachmentPoint.TopCenter,
      textStyle: 'Standard',
      cellType: 1,
      textHeight: 1
    })
    table.setCell(1, {
      text: 'MIDDLE_LEFT',
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleLeft,
      textStyle: 'Standard',
      cellType: 1,
      textHeight: 1
    })
    table.setCell(2, {
      text: 'BOTTOM_RIGHT',
      attachmentPoint: AcGiMTextAttachmentPoint.BottomRight,
      textStyle: 'Standard',
      cellType: 1,
      textHeight: 1
    })

    table.subWorldDraw(renderer as unknown as AcGiRenderer<AcGiEntity>)
    expect(renderer.mtext).toHaveBeenCalledTimes(3)
  })

  it('writes expected DXF fields for pre-2007 text serialization', () => {
    const db = setWorkingDb()
    const table = new AcDbTable('TABLE_DXF_OLD', 1, 2)
    db.tables.blockTable.modelSpace.appendEntity(table)
    table.attachmentPoint = AcGiMTextAttachmentPoint.TopCenter
    table.setUniformRowHeight(10)
    table.setUniformColumnWidth(20)
    table.tableDataVersion = 1
    table.tableValueFlag = 123
    table.setCell(0, {
      text: 'SHORT_TEXT',
      attachmentPoint: AcGiMTextAttachmentPoint.TopLeft,
      cellType: 1,
      textHeight: 2
    })
    table.setCell(1, {
      text: 'X'.repeat(600),
      attachmentPoint: AcGiMTextAttachmentPoint.TopLeft,
      cellType: 1,
      textHeight: 2,
      overrideFlag: 7
    })

    const filer = new AcDbDxfFiler().setVersion(26)
    const result = table.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(table)
    expect(dxf).toContain('AcDbTable')
    expect(dxf).toContain('\n177\n7\n')
    expect(dxf).toContain('\n2\n')
    expect(dxf).toContain('\n1\n')
    expect(dxf).not.toContain('\n301\n')
  })

  it('writes expected DXF fields for 2007+ table options and cell variants', () => {
    const db = setWorkingDb()
    const table = new AcDbTable('TABLE_DXF_NEW', 2, 2)
    db.tables.blockTable.modelSpace.appendEntity(table)
    table.setUniformRowHeight(5)
    table.setUniformColumnWidth(10)

    table.tableDataVersion = 9
    table.tableStyleId = 'TS_1'
    table.owningBlockRecordId = 'BTR_OWNER'
    table.tableOverrideFlag = 22
    table.borderColorOverrideFlag = 33
    table.borderLineweightOverrideFlag = 44
    table.borderVisibilityOverrideFlag = 55
    table.flowDirection = 1
    table.horizontalCellMargin = 2
    table.verticalCellMargin = 3
    table.suppressTitle = true
    table.suppressHeader = false
    table.tableBorderColors = {
      left: 1,
      top: 2,
      insideHorizontal: 3,
      bottom: 4,
      insideVertical: 5,
      right: 6
    }
    table.cellTypeOverrides = [
      {
        textStyle: 'Standard',
        textHeight: 2.5,
        alignment: 5,
        backgroundColor: 7,
        contentColor: 8,
        backgroundColorEnabled: true,
        borderLineweights: {
          top: 0,
          right: 5,
          bottom: 9,
          left: 13,
          insideHorizontal: 15,
          insideVertical: 18
        },
        borderVisibility: {
          top: true,
          right: true,
          bottom: false,
          left: false,
          insideHorizontal: true,
          insideVertical: false
        }
      }
    ]
    table.rowDataTypes = [1, 2, 3]
    table.rowUnitTypes = [4, 5, 6]
    table.rowFormats = ['%g', '%f']

    table.setCell(0, {
      text: 'FIELD_TEXT',
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleLeft,
      cellType: 1,
      textHeight: 2,
      fieldObjetId: 'FIELD_1',
      topBorderVisibility: true,
      rightBorderVisibility: false,
      bottomBorderVisibility: true,
      leftBorderVisibility: false
    })
    table.setCell(1, {
      text: 'Y'.repeat(700),
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleCenter,
      cellType: 1,
      textHeight: 2,
      overrideFlag: 88,
      extendedCellFlags: 3,
      textStyle: 'Standard',
      cellValueBlockBegin: 'MY_CELL'
    })
    table.setCell(2, {
      text: 'BLOCK_CONTENT',
      attachmentPoint: AcGiMTextAttachmentPoint.BottomRight,
      cellType: 2,
      textHeight: 2,
      blockTableRecordId: 'BLOCK_1',
      blockScale: 1.5,
      blockAttrNum: 2,
      attrDefineId: ['A1', 'A2'],
      attrText: ['T1', 'T2']
    })
    table.setCell(3, {
      text: 'BLOCK_CONTENT_SINGLE_ATTR',
      attachmentPoint: AcGiMTextAttachmentPoint.BottomLeft,
      cellType: 2,
      textHeight: 2,
      blockTableRecordId: 'BLOCK_2',
      blockScale: 1.2,
      blockAttrNum: 1,
      attrText: 'ONLY_ONE'
    })

    const filer = new AcDbDxfFiler().setVersion(27)
    const result = table.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(table)
    expect(dxf).toContain('AcDbTable')
    expect(dxf).toContain('\n301\nMY_CELL\n')
    expect(dxf).toContain('\n303\n')
    expect(dxf).toContain('\n302\n')
    expect(dxf).toContain('ACVALUE_END')
    expect(dxf).toContain('\n91\n88\n')
    expect(dxf).toContain('\n92\n3\n')
    expect(dxf).toContain('\n340\n')
    expect(dxf).toContain('\n331\nA1\n')
    expect(dxf).toContain('\n300\nT1\n')
    expect(dxf).toContain('\n300\nONLY_ONE\n')
    expect(dxf).toContain('\n344\n')
    expect(dxf).toContain('\n280\n1\n')
    expect(dxf).toContain('\n281\n0\n')
    expect(dxf).toContain('\n97\n1\n')
    expect(dxf).toContain('\n98\n4\n')
    expect(dxf).toContain('\n4\n%g\n')
  })

  it('writes short text cell blocks in 2007+ DXF with default cell block marker', () => {
    const db = setWorkingDb()
    const table = new AcDbTable('TABLE_DXF_NEW_SHORT', 1, 1)
    db.tables.blockTable.modelSpace.appendEntity(table)
    table.setUniformRowHeight(5)
    table.setUniformColumnWidth(10)
    table.setCell(0, {
      text: 'SHORT_2007',
      attachmentPoint: AcGiMTextAttachmentPoint.TopLeft,
      cellType: 1,
      textHeight: 1
    })

    const filer = new AcDbDxfFiler().setVersion(27)
    table.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain('\n301\nCELL_VALUE\n')
    expect(dxf).toContain('\n302\nSHORT_2007\n')
    expect(dxf).toContain('\n304\nACVALUE_END\n')
  })
})

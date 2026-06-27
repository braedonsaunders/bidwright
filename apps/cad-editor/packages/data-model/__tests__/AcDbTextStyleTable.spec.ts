import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbTextStyleTable } from '../src/database/AcDbTextStyleTable'
import { AcDbTextStyleTableRecord } from '../src/database/AcDbTextStyleTableRecord'
import type { AcDbTextStyleTableRecordAttrs } from '../src/database/AcDbTextStyleTableRecord'
import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbTextStyleTable', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbTextStyleTable(new AcDbDatabase()))
  })

  it('collects normalized unique font names from file and big-font fields', () => {
    const db = new AcDbDatabase()
    const table = db.tables.textStyleTable
    const makeStyle = (
      name: string,
      font: string,
      standardFlag = 0
    ): AcDbTextStyleTableRecordAttrs => ({
      name,
      standardFlag,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0,
      font,
      bigFont: '',
      extendedFont: ''
    })

    const style1 = new AcDbTextStyleTableRecord(makeStyle('S1', 'Arial.ttf'))
    style1.bigFontFileName = 'Gbcbig.SHX'
    const style2 = new AcDbTextStyleTableRecord(makeStyle('S2', 'simhei'))
    style2.bigFontFileName = ''
    const style3 = new AcDbTextStyleTableRecord(makeStyle('S3', 'ARIAL.TTF'))
    style3.fileName = ''
    style3.bigFontFileName = 'SIMHEI'

    table.add(style1)
    table.add(style2)
    table.add(style3)

    const fonts = table.fonts
    expect(fonts).toEqual(expect.arrayContaining(['arial', 'gbcbig', 'simhei']))
    expect(fonts).toHaveLength(3)
  })

  it('returns empty fonts when no styles exist', () => {
    const db = new AcDbDatabase()
    const table = db.tables.textStyleTable
    expect(table.fonts).toEqual([])
  })

  it('returns shape file definition records separately from text styles', () => {
    const db = new AcDbDatabase()
    const table = db.tables.textStyleTable
    const makeStyle = (
      name: string,
      font: string,
      standardFlag = 0
    ): AcDbTextStyleTableRecordAttrs => ({
      name,
      standardFlag,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0,
      font,
      bigFont: '',
      extendedFont: ''
    })

    const textStyle = new AcDbTextStyleTableRecord(makeStyle('Standard', 'txt'))
    const shapeDef = new AcDbTextStyleTableRecord(makeStyle('', 'ltypeshp', 1))

    table.add(textStyle)
    table.add(shapeDef)

    expect(table.shapeFiles).toEqual([shapeDef])
    expect(table.shapeFiles[0]?.fileName).toBe('ltypeshp')
    expect(table.fonts).toEqual(['txt'])
    expect(table.getAt('')).toBeUndefined()
  })

  it('resolveAt creates and returns the default style when the table is empty', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    const table = db.tables.textStyleTable

    const resolved = table.resolveAt('STANDARD')
    expect(resolved?.name).toBe('Standard')
    expect(table.getAt('Standard')).toBeDefined()
  })
})
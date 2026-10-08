import { AcDbDxfFiler, acdbHostApplicationServices } from '../src/base'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbTextStyleTableRecord } from '../src/database/AcDbTextStyleTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbTextStyleTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDbTextStyleTableRecord({
          name: 'Standard',
          standardFlag: 0,
          fixedTextHeight: 0,
          widthFactor: 1,
          obliqueAngle: 0,
          textGenerationFlag: 0,
          lastHeight: 0.2,
          font: 'SimKai',
          bigFont: '',
          extendedFont: 'SimKai'
        })
    )
  })

  it('tracks shape file definitions via standard flag bit 1', () => {
    const record = new AcDbTextStyleTableRecord({
      name: '',
      standardFlag: 0,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0,
      font: 'ltypeshp',
      bigFont: ''
    })

    expect(record.isShapeFile).toBe(false)

    record.isShapeFile = true
    expect(record.isShapeFile).toBe(true)
    expect(record.textStyle.standardFlag).toBe(1)

    record.isShapeFile = false
    expect(record.isShapeFile).toBe(false)
    expect(record.textStyle.standardFlag).toBe(0)
  })

  it('tracks vertical text via standard flag bit 4', () => {
    const record = new AcDbTextStyleTableRecord({
      name: 'Vertical',
      standardFlag: 0,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0,
      font: 'txt',
      bigFont: ''
    })

    expect(record.isVertical).toBe(false)

    record.isVertical = true
    expect(record.isVertical).toBe(true)
    expect(record.textStyle.standardFlag).toBe(4)

    record.isVertical = false
    expect(record.isVertical).toBe(false)
    expect(record.textStyle.standardFlag).toBe(0)
  })

  it('appends .shx to shape-file font names when writing DXF', () => {
    const record = new AcDbTextStyleTableRecord({
      name: 'TECOGISSHAPE0',
      standardFlag: 1,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0,
      font: 'tecosymbol',
      bigFont: ''
    })
    record.ownerId = '0'
    const filer = new AcDbDxfFiler()

    record.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain('3\ntecosymbol.shx\n')
  })

  it('reads TrueType extendedFont from ACAD XData when group 3 is empty', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db

    const dxf = [
      '0',
      'STYLE',
      '5',
      '61',
      '100',
      'AcDbSymbolTableRecord',
      '100',
      'AcDbTextStyleTableRecord',
      '2',
      '标准',
      '70',
      '0',
      '40',
      '0.0',
      '41',
      '0.667',
      '50',
      '0.0',
      '71',
      '0',
      '42',
      '0.2',
      '3',
      '',
      '4',
      '',
      '1001',
      'ACAD',
      '1000',
      'SimSun',
      '1071',
      '0',
      '0',
      'ENDTAB'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(dxf, { database: db })
    expect(filer.readItem()?.value).toBe('STYLE')

    const record = new AcDbTextStyleTableRecord()
    record.dxfIn(filer)

    expect(record.name).toBe('标准')
    expect(record.textStyle.extendedFont).toBe('SimSun')
    expect(record.fileName).toBe('SimSun')
  })
})

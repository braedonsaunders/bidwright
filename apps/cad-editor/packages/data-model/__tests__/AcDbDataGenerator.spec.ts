import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbDataGenerator } from '../src/misc/AcDbDataGenerator'
import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'

describe('AcDbDataGenerator', () => {
  it('creates default records and arrow block', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    const generator = new AcDbDataGenerator(db)

    generator.createDefaultLayer()
    expect(db.tables.layerTable.getAt('0')?.name).toBe('0')

    generator.createDefaultLineType()
    expect(db.tables.linetypeTable.getAt('ByBlock')).toBeDefined()
    expect(db.tables.linetypeTable.getAt('ByLayer')).toBeDefined()
    expect(db.tables.linetypeTable.getAt('Continuous')).toBeDefined()

    generator.createDefaultTextStyle()
    expect(db.tables.textStyleTable.getAt('Standard')).toBeDefined()

    generator.createDefaultDimStyle()
    expect(db.tables.dimStyleTable.getAt('Standard')).toBeDefined()

    generator.createDefaultLayout()
    expect(db.objects.layout.getAt('Model')).toBeDefined()

    generator.createArrowBlock()
    generator.createArrowBlock()
    expect(db.tables.blockTable.getAt('_CAXARROW')).toBeDefined()
  })
})

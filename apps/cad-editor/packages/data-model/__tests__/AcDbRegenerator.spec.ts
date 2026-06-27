import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbRegenerator } from '../src/converter/AcDbRegenerator'
import { AcDbLine } from '../src/entity/AcDbLine'
import { AcDbRasterImageDef } from '../src/object/AcDbRasterImageDef'
import { AcDbDataGenerator } from '../src/misc/AcDbDataGenerator'

class TestRegenerator extends AcDbRegenerator {
  parsePublic() {
    return this.parse()
  }
  getFontsPublic() {
    return this.getFonts()
  }
  processEntitiesPublic(
    source: AcDbDatabase,
    target: AcDbDatabase,
    minimumChunkSize: number,
    startPercentage: { value: number },
    progress?: (p: number, stage: string, status: string) => Promise<void>
  ) {
    return this.processEntities(
      source,
      target,
      minimumChunkSize,
      startPercentage,
      progress as any
    )
  }
  processBlocksPublic() {
    return this.processBlocks()
  }
  processHeaderPublic() {
    return this.processHeader()
  }
  processBlockTablesPublic() {
    return this.processBlockTables()
  }
  processObjectsPublic() {
    return this.processObjects()
  }
  processViewportsPublic() {
    return this.processViewports()
  }
  processLayersPublic() {
    return this.processLayers()
  }
  processLineTypesPublic() {
    return this.processLineTypes()
  }
  processTextStylesPublic() {
    return this.processTextStyles()
  }
  processDimStylesPublic() {
    return this.processDimStyles()
  }
}

describe('AcDbRegenerator', () => {
  it('exposes parse/fonts and processes entity/object/layer events', async () => {
    const db = new AcDbDatabase()
    new AcDbDataGenerator(db).createDefaultLayer()
    const lineA = new AcDbLine({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
    const lineB = new AcDbLine({ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 })
    db.tables.blockTable.modelSpace.appendEntity([lineA, lineB])

    const imageDef = new AcDbRasterImageDef()
    db.objects.imageDefinition.setAt(imageDef.objectId, imageDef)

    const reg = new TestRegenerator(db)

    const parsed = await reg.parsePublic()
    expect(parsed.model).toBe(db)
    expect(parsed.data.unknownEntityCount).toBe(0)
    expect(reg.getFontsPublic()).toEqual([])

    const entityEvents: unknown[] = []
    const objectEvents: unknown[] = []
    const layerEvents: unknown[] = []
    db.events.entityAppended.addEventListener(e => entityEvents.push(e))
    db.events.dictObjetSet.addEventListener(e => objectEvents.push(e))
    db.events.layerAppended.addEventListener(e => layerEvents.push(e))

    const progressValues: number[] = []
    await reg.processEntitiesPublic(db, db, 1, { value: 10 }, async p => {
      progressValues.push(p)
    })

    reg.processBlocksPublic()
    reg.processObjectsPublic()
    reg.processLayersPublic()

    reg.processHeaderPublic()
    reg.processBlockTablesPublic()
    reg.processViewportsPublic()
    reg.processLineTypesPublic()
    reg.processTextStylesPublic()
    reg.processDimStylesPublic()

    expect(entityEvents.length).toBeGreaterThan(0)
    expect(objectEvents.length).toBeGreaterThan(0)
    expect(layerEvents.length).toBeGreaterThan(0)
    expect(progressValues.length).toBeGreaterThan(0)
  })
})

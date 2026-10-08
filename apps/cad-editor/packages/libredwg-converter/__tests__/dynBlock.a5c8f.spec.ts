import {
  AcDbBlockReference,
  AcDbDatabase,
  AcDbDynBlockReference,
  acdbHostApplicationServices
} from '@mlightcad/data-model'

import { AcDbEntityConverter } from '../src/AcDbEntitiyConverter'
import { AcDbLibreDwgConverter } from '../src/AcDbLibreDwgConverter'

class TestLibreDwgConverter extends AcDbLibreDwgConverter {
  processBlockTablesPublic(model: any, db: AcDbDatabase) {
    return this.processBlockTables(model, db)
  }

  processDynBlockMetadataPublic(model: any, db: AcDbDatabase) {
    return (this as any).processDynBlockMetadata(model, db)
  }
}

describe('libredwg dyn-block metadata import', () => {
  it('wires INSERT xdict + dictionaries so A5C8F-like insert is dynamic and draws *U60', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db

    const model = {
      tables: {
        BLOCK_RECORD: {
          entries: [
            {
              name: '*U60',
              handle: 'A4240',
              ownerHandle: '1',
              flags: 0,
              basePoint: { x: 0, y: 0, z: 0 },
              entities: [],
              ownerDictionaryHardId: 'A4241'
            },
            {
              name: 'Light_Building_Mounted',
              handle: 'A4232',
              ownerHandle: '1',
              flags: 0,
              basePoint: { x: 0, y: 0, z: 0 },
              entities: [],
              ownerDictionaryHardId: 'A4233'
            }
          ]
        }
      },
      objects: {
        DICTIONARY: [
          {
            handle: 'A5C90',
            ownerHandle: 'A5C8F',
            entries: {
              AcDbBlockRepresentation: 'A5C92'
            }
          },
          {
            handle: 'A5C92',
            ownerHandle: 'A5C90',
            entries: {
              AcDbRepData: 'A5C93'
            }
          },
          {
            handle: 'A4233',
            ownerHandle: 'A4232',
            entries: {
              ACAD_ENHANCEDBLOCK: 'A4234'
            }
          }
        ]
      }
    }

    const converter = new TestLibreDwgConverter({ useWorker: false })
    converter.processBlockTablesPublic(model, db)
    converter.processDynBlockMetadataPublic(model, db)

    const entityConverter = new AcDbEntityConverter()
    const insert = entityConverter.convert({
      type: 'INSERT',
      handle: 'A5C8F',
      ownerBlockRecordSoftId: db.tables.blockTable.modelSpace.objectId,
      name: '*U60',
      insertionPoint: { x: 0, y: 0, z: 0 },
      xScale: 1,
      yScale: 1,
      zScale: 1,
      rotation: 0,
      extrusionDirection: { x: 0, y: 0, z: 1 },
      ownerDictionaryHardId: 'A5C90',
      layer: '0',
      attribs: []
    } as never)

    expect(insert).toBeInstanceOf(AcDbBlockReference)
    db.tables.blockTable.modelSpace.appendEntity(insert!)

    const blockRef = insert as AcDbBlockReference
    expect(blockRef.blockName).toBe('*U60')
    expect(blockRef.extensionDictionary?.toUpperCase()).toBe('A5C90')

    const dyn = new AcDbDynBlockReference(blockRef)
    expect(dyn.isDynamicBlock()).toBe(true)
    expect(blockRef.drawableBlockTableRecord?.name).toBe('*U60')
    expect(dyn.anonymousBlockTableRecord()?.toUpperCase()).toBe('A4240')
  })
})

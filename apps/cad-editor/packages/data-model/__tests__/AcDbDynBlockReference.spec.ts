import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices } from '../src/base'
import { AcDbDxfCode } from '../src/base/AcDbDxfCode'
import { AcDbObject } from '../src/base/AcDbObject'
import { AcDbResultBuffer } from '../src/base/AcDbResultBuffer'
import { AcDbBlockTableRecord, AcDbDatabase } from '../src/database'
import { AcDbBlockReference, AcDbLine } from '../src/entity'
import {
  ACDB_DYN_BLOCK_ENHANCED_BLOCK,
  ACDB_DYN_BLOCK_REP_BTAG_APP,
  ACDB_DYN_BLOCK_REP_DATA,
  ACDB_DYN_BLOCK_REPRESENTATION_DICT,
  acdbImportDynBlockMetadata
} from '../src/misc'
import {
  AcDbDictionary,
  AcDbDynBlockReference,
  AcDbDynBlockTableRecord
} from '../src/object'

const createDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbDynBlockReference', () => {
  it('resolves anonymous and dynamic definition from extension dictionary', () => {
    const db = createDb()

    const def = new AcDbBlockTableRecord()
    def.name = 'Light_Building_Mounted'
    def.objectId = 'A4232'
    db.tables.blockTable.add(def)

    const defExt = new AcDbDictionary(db)
    defExt.objectId = 'A4233'
    db.commitObjectHandle(defExt)
    def.extensionDictionary = defExt.objectId
    const enhanced = new AcDbObject()
    enhanced.objectId = 'A4234'
    enhanced.database = db
    db.commitObjectHandle(enhanced)
    defExt.setAt(ACDB_DYN_BLOCK_ENHANCED_BLOCK, enhanced)

    const anon = new AcDbBlockTableRecord()
    anon.name = '*U60'
    anon.objectId = 'A4240'
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(2, 0, 0)
    )
    anon.appendEntity(line)
    db.tables.blockTable.add(anon)

    const insert = new AcDbBlockReference('*U60')
    insert.objectId = 'A5C8F'
    db.tables.blockTable.modelSpace.appendEntity(insert)

    acdbImportDynBlockMetadata(db, {
      dictionaries: [
        {
          handle: 'A5C90',
          ownerHandle: 'A5C8F',
          entries: [
            { name: ACDB_DYN_BLOCK_REPRESENTATION_DICT, handle: 'A5C92' }
          ]
        },
        {
          handle: 'A5C92',
          ownerHandle: 'A5C90',
          entries: [{ name: ACDB_DYN_BLOCK_REP_DATA, handle: 'A5C93' }]
        }
      ],
      representationData: [
        { handle: 'A5C93', ownerHandle: 'A5C92', blockHandle: 'A4232' }
      ]
    })
    insert.extensionDictionary = 'A5C90'

    const dyn = new AcDbDynBlockReference(insert)
    expect(dyn.isDynamicBlock()).toBe(true)
    expect(dyn.anonymousBlockTableRecord()?.toUpperCase()).toBe('A4240')
    expect(dyn.dynamicBlockTableRecord()?.toUpperCase()).toBe('A4232')
    expect(insert.drawableBlockTableRecord?.name).toBe('*U60')

    const dynBtr = new AcDbDynBlockTableRecord(def)
    expect(dynBtr.isDynamicBlock()).toBe(true)
    expect(
      dynBtr.getAnonymousBlockIds().map(id => id.toUpperCase())
    ).toContain('A4240')
  })

  it('resolves dynamic definition from AcDbBlockRepBTag on anonymous BTR', () => {
    const db = createDb()

    const def = new AcDbBlockTableRecord()
    def.name = 'MyDoor'
    def.objectId = 'ABCD'
    db.tables.blockTable.add(def)

    const anon = new AcDbBlockTableRecord()
    anon.name = '*U101'
    anon.objectId = 'U101'
    db.tables.blockTable.add(anon)
    anon.setXData(
      new AcDbResultBuffer([
        {
          code: AcDbDxfCode.ExtendedDataRegAppName,
          value: ACDB_DYN_BLOCK_REP_BTAG_APP
        },
        { code: AcDbDxfCode.ExtendedDataHandle, value: 'ABCD' }
      ])
    )

    const insert = new AcDbBlockReference('*U101')
    insert.objectId = 'INS1'
    db.tables.blockTable.modelSpace.appendEntity(insert)

    const dyn = new AcDbDynBlockReference(insert)
    expect(dyn.isDynamicBlock()).toBe(true)
    expect(dyn.anonymousBlockTableRecord()?.toUpperCase()).toBe('U101')
    expect(dyn.dynamicBlockTableRecord()?.toUpperCase()).toBe('ABCD')
  })
})

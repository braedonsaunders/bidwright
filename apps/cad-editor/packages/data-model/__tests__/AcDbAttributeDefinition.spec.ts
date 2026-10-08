import { AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler, acdbHostApplicationServices } from '../src/base'
import { AcDbBlockTableRecord, AcDbDatabase } from '../src/database'
import {
  AcDbAttributeDefinition,
  AcDbMText,
  AcDbTextVerticalMode
} from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const setWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbAttributeDefinition', () => {
  it('exposes correct type names', () => {
    const attDef = new AcDbAttributeDefinition()
    expect(AcDbAttributeDefinition.typeName).toBe('AttDef')
    expect(attDef.dxfTypeName).toBe('ATTDEF')
  })

  it('supports attribute flag toggles through public getters/setters', () => {
    const attDef = new AcDbAttributeDefinition()

    expect(attDef.isInvisible).toBe(false)
    expect(attDef.isConst).toBe(false)
    expect(attDef.isVerifiable).toBe(false)
    expect(attDef.isPreset).toBe(false)
    expect(attDef.isMTextAttribute).toBe(false)
    expect(attDef.isConstMTextAttribute).toBe(false)

    attDef.isInvisible = true
    attDef.isConst = true
    attDef.isVerifiable = true
    attDef.isPreset = true
    attDef.isMTextAttribute = true
    attDef.isConstMTextAttribute = true

    expect(attDef.isInvisible).toBe(true)
    expect(attDef.isConst).toBe(true)
    expect(attDef.isVerifiable).toBe(true)
    expect(attDef.isPreset).toBe(true)
    expect(attDef.isMTextAttribute).toBe(true)
    expect(attDef.isConstMTextAttribute).toBe(true)

    attDef.isInvisible = false
    attDef.isConst = false
    attDef.isVerifiable = false
    attDef.isPreset = false
    attDef.isMTextAttribute = false
    attDef.isConstMTextAttribute = false

    expect(attDef.isInvisible).toBe(false)
    expect(attDef.isConst).toBe(false)
    expect(attDef.isVerifiable).toBe(false)
    expect(attDef.isPreset).toBe(false)
    expect(attDef.isMTextAttribute).toBe(false)
    expect(attDef.isConstMTextAttribute).toBe(false)
  })

  it('supports basic scalar properties', () => {
    const attDef = new AcDbAttributeDefinition()

    expect(attDef.prompt).toBe('')
    expect(attDef.tag).toBe('')
    expect(attDef.fieldLength).toBe(0)
    expect(attDef.lockPositionInBlock).toBe(false)
    expect(attDef.isReallyLocked).toBe(false)

    attDef.prompt = 'Please input tag value'
    attDef.tag = 'TAG_01'
    attDef.fieldLength = 123
    attDef.lockPositionInBlock = true
    attDef.isReallyLocked = true

    expect(attDef.prompt).toBe('Please input tag value')
    expect(attDef.tag).toBe('TAG_01')
    expect(attDef.fieldLength).toBe(123)
    expect(attDef.lockPositionInBlock).toBe(true)
    expect(attDef.isReallyLocked).toBe(true)
  })

  it('keeps mtext and isMTextAttribute in sync', () => {
    const attDef = new AcDbAttributeDefinition()
    const mtext = new AcDbMText()

    expect(attDef.mtext).toBeUndefined()
    expect(attDef.isMTextAttribute).toBe(false)

    attDef.mtext = mtext
    expect(attDef.mtext).toBe(mtext)
    expect(attDef.isMTextAttribute).toBe(true)

    attDef.mtext = undefined
    expect(attDef.mtext).toBeUndefined()
    expect(attDef.isMTextAttribute).toBe(false)
  })

  it('draws the tag for loose ATTDEFs and skips invisible ones', () => {
    const db = setWorkingDb()
    const attDef = new AcDbAttributeDefinition()
    db.tables.blockTable.modelSpace.appendEntity(attDef)
    attDef.tag = 'TAG_01'
    attDef.textString = 'default value'
    attDef.height = 2.5

    const giEntity = { objectId: 'ATTDEF' }
    const renderer = {
      mtext: jest.fn(() => giEntity)
    } as unknown as {
      mtext: jest.Mock
    }

    expect(attDef.subWorldDraw(renderer as never, true)).toBe(giEntity)
    expect(renderer.mtext).toHaveBeenCalledTimes(1)
    expect(renderer.mtext.mock.calls[0][0]).toMatchObject({ text: 'TAG_01' })
    expect(attDef.textString).toBe('default value')

    attDef.isInvisible = true
    expect(attDef.subWorldDraw(renderer as never)).toBeUndefined()
    expect(renderer.mtext).toHaveBeenCalledTimes(1)
  })

  it('skips non-constant ATTDEFs inside a block definition (INSERT ATTRIB draws)', () => {
    const db = setWorkingDb()
    const blockRecord = new AcDbBlockTableRecord()
    blockRecord.name = 'ATTDEF_BLOCK'
    db.tables.blockTable.add(blockRecord)

    const attDef = new AcDbAttributeDefinition()
    attDef.tag = 'TAG_01'
    attDef.textString = 'default value'
    attDef.height = 2.5
    blockRecord.appendEntity(attDef)

    const renderer = {
      mtext: jest.fn(() => ({ objectId: 'ATTDEF' }))
    } as unknown as {
      mtext: jest.Mock
    }

    expect(attDef.isConst).toBe(false)
    expect(attDef.subWorldDraw(renderer as never)).toBeUndefined()
    expect(renderer.mtext).not.toHaveBeenCalled()
  })

  it('does not draw tags when ownerId does not resolve to a block table record', () => {
    const db = setWorkingDb()
    const blockRecord = new AcDbBlockTableRecord()
    blockRecord.name = 'STALE_OWNER_BLOCK'
    db.tables.blockTable.add(blockRecord)

    const attDef = new AcDbAttributeDefinition()
    attDef.tag = '设计日期'
    attDef.textString = ''
    attDef.height = 2.5
    blockRecord.appendEntity(attDef)
    // Simulate BTR handle displacement leaving a stale soft-pointer ownerId
    // that no longer names a block table record (common after DWG import).
    attDef.ownerId = 'DEADBEEF'

    const renderer = {
      mtext: jest.fn(() => ({ objectId: 'ATTDEF' }))
    } as unknown as {
      mtext: jest.Mock
    }

    expect(attDef.subWorldDraw(renderer as never)).toBeUndefined()
    expect(renderer.mtext).not.toHaveBeenCalled()
  })

  it('draws constant default values inside a block and still hides invisible ones', () => {
    const db = setWorkingDb()
    const blockRecord = new AcDbBlockTableRecord()
    blockRecord.name = 'CONST_BLOCK'
    db.tables.blockTable.add(blockRecord)

    const attDef = new AcDbAttributeDefinition()
    attDef.tag = 'TAG_01'
    attDef.textString = 'fixed value'
    attDef.isConst = true
    attDef.height = 2.5
    blockRecord.appendEntity(attDef)

    const renderer = {
      mtext: jest.fn(() => ({ objectId: 'ATTDEF' }))
    } as unknown as {
      mtext: jest.Mock
    }

    expect(attDef.subWorldDraw(renderer as never)).toBeDefined()
    expect(renderer.mtext.mock.calls[0][0]).toMatchObject({
      text: 'fixed value'
    })

    attDef.isInvisible = true
    expect(attDef.subWorldDraw(renderer as never)).toBeUndefined()
    expect(renderer.mtext).toHaveBeenCalledTimes(1)
  })

  it('draws constant MText ATTDEFs inside a block', () => {
    const db = setWorkingDb()
    const blockRecord = new AcDbBlockTableRecord()
    blockRecord.name = 'CONST_MTEXT_BLOCK'
    db.tables.blockTable.add(blockRecord)

    const attDef = new AcDbAttributeDefinition()
    attDef.tag = 'TAG_01'
    attDef.textString = 'mtext fixed'
    attDef.isConstMTextAttribute = true
    attDef.height = 2.5
    blockRecord.appendEntity(attDef)

    const renderer = {
      mtext: jest.fn(() => ({ objectId: 'ATTDEF' }))
    } as unknown as {
      mtext: jest.Mock
    }

    expect(attDef.subWorldDraw(renderer as never)).toBeDefined()
    expect(renderer.mtext.mock.calls[0][0]).toMatchObject({
      text: 'mtext fixed'
    })
  })

  it('does not mutate group 70 when skipping non-constant block ATTDEFs', () => {
    const db = setWorkingDb()
    const blockRecord = new AcDbBlockTableRecord()
    blockRecord.name = 'FLAGS_BLOCK'
    db.tables.blockTable.add(blockRecord)

    const attDef = new AcDbAttributeDefinition()
    attDef.tag = 'TAG_01'
    attDef.textString = 'ghost'
    attDef.height = 2.5
    blockRecord.appendEntity(attDef)

    const renderer = {
      mtext: jest.fn(() => ({ objectId: 'ATTDEF' }))
    } as unknown as {
      mtext: jest.Mock
    }

    expect(attDef.isInvisible).toBe(false)
    expect(attDef.subWorldDraw(renderer as never)).toBeUndefined()
    expect(attDef.isInvisible).toBe(false)

    const filer = new AcDbDxfFiler()
    attDef.ownerId = blockRecord.objectId
    attDef.layer = '0'
    attDef.lineWeight = 0
    attDef.linetypeScale = 1
    attDef.dxfOutFields(filer)
    expect(filer.toString()).toContain('\n70\n0\n')
  })

  it('writes expected ATTDEF-specific fields in dxfOutFields', () => {
    const db = setWorkingDb()
    const attDef = new AcDbAttributeDefinition()
    const filer = new AcDbDxfFiler()

    attDef.ownerId = db.tables.blockTable.modelSpace.objectId
    attDef.layer = '0'
    attDef.lineWeight = 0
    attDef.linetypeScale = 1
    attDef.prompt = 'Prompt text'
    attDef.tag = 'A_TAG'
    attDef.isInvisible = true
    attDef.isConst = true
    attDef.isVerifiable = true
    attDef.isPreset = true
    attDef.fieldLength = 42
    attDef.lockPositionInBlock = true
    attDef.isReallyLocked = false

    const result = attDef.dxfOutFields(filer)
    const out = filer.toString()

    expect(result).toBe(attDef)
    expect(out).toContain('AcDbAttributeDefinition')
    expect(out).toContain('\n3\nPrompt text\n')
    expect(out).toContain('\n2\nA_TAG\n')
    // Invisible(1) | Const(2) | Verifiable(4) | Preset(8) = 15
    expect(out).toContain('\n70\n15\n')
    expect(out).toContain('\n73\n42\n')
    expect(out).toContain('\n74\n1\n')
  })

  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbAttributeDefinition())
  })

  it('returns geometricExtents and recomputes when position changes', () => {
    setWorkingDb()
    const attDef = new AcDbAttributeDefinition()
    attDef.textString = 'TAG'
    attDef.height = 2
    attDef.verticalMode = AcDbTextVerticalMode.BASELINE
    attDef.position = new AcGePoint3d(2, 3, 4)

    expect(attDef.geometricExtents.min).toMatchObject({ x: 2, y: 3, z: 4 })
    expect(attDef.geometricExtents.max.x).toBeCloseTo(8)

    attDef.position = new AcGePoint3d(11, 12, 13)

    expect(attDef.geometricExtents.min).toMatchObject({ x: 11, y: 12, z: 13 })
    expect(attDef.geometricExtents.max.x).toBeCloseTo(17)
  })
})

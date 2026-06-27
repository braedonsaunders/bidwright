import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { AcDbDxfFiler, acdbHostApplicationServices } from '../src/base'
import { AcDbDatabase } from '../src/database'
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

  it('returns undefined in subWorldDraw', () => {
    const attDef = new AcDbAttributeDefinition()
    expect(attDef.subWorldDraw({} as never)).toBeUndefined()
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
    attDef.fieldLength = 42
    attDef.isReallyLocked = true

    const result = attDef.dxfOutFields(filer)
    const out = filer.toString()

    expect(result).toBe(attDef)
    expect(out).toContain('AcDbAttributeDefinition')
    expect(out).toContain('\n3\nPrompt text\n')
    expect(out).toContain('\n2\nA_TAG\n')
    expect(out).toContain('\n70\n1\n')
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

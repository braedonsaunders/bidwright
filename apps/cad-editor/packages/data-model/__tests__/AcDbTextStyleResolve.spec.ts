import { acdbHostApplicationServices } from '../src/base/AcDbHostApplicationServices'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import type { AcDbTextStyleTableRecordAttrs } from '../src/database/AcDbTextStyleTableRecord'
import { AcDbTextStyleTableRecord } from '../src/database/AcDbTextStyleTableRecord'
import { AcDbText } from '../src/entity/AcDbText'

function makeTextStyle(
  name: string,
  font = 'Arial'
): AcDbTextStyleTableRecordAttrs {
  return {
    name,
    standardFlag: 0,
    fixedTextHeight: 0,
    widthFactor: 1,
    obliqueAngle: 0,
    textGenerationFlag: 0,
    lastHeight: 0.2,
    font,
    bigFont: '',
    extendedFont: font
  }
}

describe('text style resolution', () => {
  it('resolves text styles before database defaults run at end of read', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db

    const text = new AcDbText()
    text.textString = 'Hello'
    text.styleName = 'STANDARD'
    db.tables.blockTable.modelSpace.appendEntity(text)

    const renderer = { mtext: jest.fn(() => ({})) }
    expect(() => text.subWorldDraw(renderer as never)).not.toThrow()
    expect(renderer.mtext).toHaveBeenCalled()
    expect(db.tables.textStyleTable.getAt('Standard')).toBeDefined()
  })

  it('matches text styles case-insensitively', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    db.tables.textStyleTable.add(
      new AcDbTextStyleTableRecord(makeTextStyle('STANDARD', 'Arial'))
    )

    const resolved = db.tables.textStyleTable.resolveAt('standard')
    expect(resolved?.name).toBe('STANDARD')
  })
})
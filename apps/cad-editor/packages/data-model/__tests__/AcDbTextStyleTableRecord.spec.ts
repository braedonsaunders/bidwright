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
})
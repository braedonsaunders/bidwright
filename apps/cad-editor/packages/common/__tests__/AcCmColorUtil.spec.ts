import { AcCmColorUtil } from '../src'

describe('AcCmColorUtil', () => {
  it('converts index/color/name in both directions', () => {
    expect(AcCmColorUtil.getColorByIndex(1)).toBe(0xff0000)
    expect(AcCmColorUtil.getIndexByColor(0xff0000)).toBe(1)
    expect(AcCmColorUtil.getColorByName('Red')).toBe(0xff0000)
    expect(AcCmColorUtil.getNameByColor(0xff0000)).toBe('red')
    expect(AcCmColorUtil.getNameByIndex(1)).toBe('red')
  })

  it('returns undefined when no mapping exists', () => {
    expect(AcCmColorUtil.getColorByIndex(9999)).toBeUndefined()
    expect(AcCmColorUtil.getIndexByColor(0x123456)).toBeUndefined()
    expect(AcCmColorUtil.getColorByName('not-a-color')).toBeUndefined()
    expect(AcCmColorUtil.getNameByColor(0x123456)).toBeUndefined()
    expect(AcCmColorUtil.getNameByIndex(9999)).toBeUndefined()
  })
})

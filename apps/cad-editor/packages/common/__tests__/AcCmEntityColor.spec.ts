import { AcCmColorMethod, AcCmEntityColor } from '../src'

describe('AcCmEntityColor', () => {
  it('switches among color modes', () => {
    const entityColor = new AcCmEntityColor()
    entityColor.setRGB(10, 20, 30)
    expect(entityColor.isByColor()).toBe(true)
    expect(entityColor.rawValue).toBe((10 << 16) | (20 << 8) | 30)

    entityColor.colorIndex = 7
    expect(entityColor.isByACI()).toBe(true)
    expect(entityColor.colorIndex).toBe(7)

    entityColor.layerIndex = 2
    expect(entityColor.isByLayer()).toBe(true)
    expect(entityColor.layerIndex).toBe(2)
  })

  it('covers RGB channel setters/getters and method helpers', () => {
    const entityColor = new AcCmEntityColor(AcCmColorMethod.None, 0x112233)

    expect(entityColor.colorMethd).toBe(AcCmColorMethod.None)
    expect(entityColor.isNone()).toBe(true)

    entityColor.red = 0xaa
    entityColor.green = 0xbb
    entityColor.blue = 0xcc

    expect(entityColor.red).toBe(0xaa)
    expect(entityColor.green).toBe(0xbb)
    expect(entityColor.blue).toBe(0xcc)
    expect(entityColor.isByColor()).toBe(true)

    entityColor.rawValue = 1234
    expect(entityColor.rawValue).toBe(1234)

    entityColor['_colorMethod'] = AcCmColorMethod.ByBlock
    expect(entityColor.isByBlock()).toBe(true)
  })
})

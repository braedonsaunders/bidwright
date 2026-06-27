import { AcDbFontNameCollector } from '../src/converter/AcDbFontNameCollector'

describe('AcDbFontNameCollector', () => {
  it('normalizes font file names', () => {
    expect(AcDbFontNameCollector.normalizeFontFileName('Arial.ttf')).toBe(
      'arial'
    )
    expect(AcDbFontNameCollector.normalizeFontFileName('SIMHEI')).toBe('simhei')
    expect(AcDbFontNameCollector.normalizeFontFileName('')).toBeUndefined()
    expect(
      AcDbFontNameCollector.normalizeFontFileName(undefined)
    ).toBeUndefined()
  })

  it('collects fonts from styles, inline mtext, and nested blocks', () => {
    const fonts = new AcDbFontNameCollector({
      styles: [
        {
          name: 'A',
          font: 'Arial.ttf',
          bigFont: 'Bigfont.shx',
          extendedFont: 'Ext.ttf'
        }
      ],
      textStyleVar: 'A'
    }).collect(
      [
        { type: 'TEXT', styleName: 'A' },
        { type: 'MTEXT', styleName: 'A', text: '{\\fCustom|b0|i0;Hello}' },
        { type: 'INSERT', name: 'B1' }
      ],
      {
        getEntityFontInfo: entity => {
          if (entity.type === 'TEXT') {
            return { styleName: entity.styleName, resolveStyle: true }
          }
          if (entity.type === 'MTEXT') {
            return {
              styleName: entity.styleName,
              formattedText: entity.text,
              resolveStyle: true
            }
          }
          if (entity.type === 'INSERT') {
            return { blockName: entity.name }
          }
          return null
        },
        getBlockEntities: blockName =>
          blockName === 'B1' ? [{ type: 'TEXT', styleName: 'A' }] : undefined
      }
    )

    expect(fonts).toEqual(
      expect.arrayContaining(['arial', 'bigfont', 'ext', 'custom'])
    )
  })

  it('resolves style font names with TEXTSTYLE fallback', () => {
    const fonts = new AcDbFontNameCollector({
      styles: [
        { name: 'Standard', font: 'txt.shx' },
        { name: 'Named', font: 'simplex.shx' }
      ],
      textStyleVar: 'Standard'
    }).collect(
      [
        { type: 'MTEXT', text: 'Hello' },
        { type: 'TEXT', styleName: 'Named' }
      ],
      {
        getEntityFontInfo: entity => {
          if (entity.type === 'MTEXT') {
            return { formattedText: entity.text, resolveStyle: true }
          }
          if (entity.type === 'TEXT') {
            return { styleName: entity.styleName, resolveStyle: true }
          }
          return null
        }
      }
    )

    expect(fonts).toEqual(expect.arrayContaining(['txt', 'simplex']))
  })

  it('collects shape-definition fonts from the style table', () => {
    const fonts = new AcDbFontNameCollector({
      styles: [
        { name: '', font: 'tecosymbol.shx', standardFlag: 1 },
        { name: 'pipe', font: 'romans.shx', standardFlag: 0 }
      ]
    }).collect([], {
      getEntityFontInfo: () => null
    })

    expect(fonts).toEqual(['tecosymbol'])
  })
})
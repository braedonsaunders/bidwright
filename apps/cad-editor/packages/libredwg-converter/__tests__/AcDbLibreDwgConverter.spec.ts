import { AcDbLibreDwgConverter } from '../src/AcDbLibreDwgConverter'

class TestLibreDwgConverter extends AcDbLibreDwgConverter {
  getFontsPublic(dwg: any) {
    return this.getFonts(dwg)
  }
}

describe('AcDbLibreDwgConverter', () => {
  it('collects fonts from style table, mtext and nested inserts', () => {
    const converter = new TestLibreDwgConverter({ useWorker: false })
    const fonts = converter.getFontsPublic({
      header: { TEXTSTYLE: 'A' },
      tables: {
        STYLE: {
          entries: [
            {
              name: 'A',
              font: 'Arial.ttf',
              bigFont: 'Bigfont.shx',
              standardFlag: 0
            }
          ]
        },
        BLOCK_RECORD: {
          entries: [
            {
              name: 'B1',
              entities: [{ type: 'TEXT', styleName: 'A' }]
            }
          ]
        }
      },
      entities: [
        { type: 'TEXT', styleName: 'A' },
        { type: 'MTEXT', styleName: 'A', text: '{\\fCustom|b0|i0;Hello}' },
        { type: 'INSERT', name: 'B1' }
      ]
    })

    expect(fonts).toEqual(
      expect.arrayContaining(['arial', 'bigfont', 'custom'])
    )
  })

  it('collects fonts for entities with missing style via TEXTSTYLE fallback', () => {
    const converter = new TestLibreDwgConverter({ useWorker: false })
    const fonts = converter.getFontsPublic({
      header: { TEXTSTYLE: 'Standard' },
      tables: {
        STYLE: {
          entries: [
            {
              name: 'Standard',
              font: 'txt.shx',
              standardFlag: 0
            },
            {
              name: 'Named',
              font: 'simplex.shx',
              standardFlag: 0
            }
          ]
        },
        BLOCK_RECORD: { entries: [] }
      },
      entities: [
        { type: 'MTEXT', text: 'Hello' },
        { type: 'TEXT', styleName: 'Named' },
        { type: 'ATTRIB', styleName: 'Named' }
      ]
    })

    expect(fonts).toEqual(expect.arrayContaining(['txt', 'simplex']))
  })

  it('collects shape-definition fonts and resolves MLeader text styles', () => {
    const converter = new TestLibreDwgConverter({ useWorker: false })
    const fonts = converter.getFontsPublic({
      header: { TEXTSTYLE: 'Standard' },
      tables: {
        STYLE: {
          entries: [
            {
              name: '',
              font: 'tecosymbol.shx',
              standardFlag: 1
            },
            {
              name: 'LeaderStyle',
              font: 'romans.shx',
              standardFlag: 0
            }
          ]
        },
        BLOCK_RECORD: { entries: [] }
      },
      entities: [
        {
          type: 'MULTILEADER',
          textContent: '{\\fInline|b0;Note}',
          textStyleName: 'LeaderStyle'
        }
      ]
    })

    expect(fonts).toEqual(
      expect.arrayContaining(['tecosymbol', 'romans', 'inline'])
    )
  })
})

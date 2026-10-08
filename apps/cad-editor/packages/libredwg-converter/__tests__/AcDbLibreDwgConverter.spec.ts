import { AcCmColorMethod, AcDbDatabase } from '@mlightcad/data-model'

import { AcDbLibreDwgConverter } from '../src/AcDbLibreDwgConverter'

class TestLibreDwgConverter extends AcDbLibreDwgConverter {
  processHeaderPublic(model: any, db: AcDbDatabase) {
    return this.processHeader(model, db)
  }

  processLayersPublic(model: any, db: AcDbDatabase) {
    return this.processLayers(model, db)
  }
}

describe('AcDbLibreDwgConverter', () => {
  it('sets thumbnailImage from model thumbnailImage bytes', () => {
    const db = new AcDbDatabase()
    const converter = new TestLibreDwgConverter({ useWorker: false })
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

    converter.processHeaderPublic(
      {
        header: {},
        thumbnailImage: bytes
      },
      db
    )

    expect(db.thumbnailImage).toEqual(bytes)
  })

  it('keeps CMC RGB for layers when libredwg leaves colorIndex at 256', () => {
    // libredwg-web convertLayer leaves colorIndex=256 for method 0xC2 and puts
    // the CMC RGB in `color`. Mapping 256 to ByLayer made legend fills white.
    const db = new AcDbDatabase()
    const converter = new TestLibreDwgConverter({ useWorker: false })

    converter.processLayersPublic(
      {
        tables: {
          LAYER: {
            entries: [
              {
                name: '0道路填充',
                handle: '1',
                ownerHandle: '0',
                standardFlag: 0,
                colorIndex: 256,
                color: 0xff7fbf,
                lineType: 'Continuous',
                lineweight: -1,
                frozen: false,
                off: false,
                frozenInNew: false,
                locked: false,
                plotFlag: 1
              },
              {
                name: '0草地填充',
                handle: '2',
                ownerHandle: '0',
                standardFlag: 0,
                colorIndex: 70,
                color: 0xffffff,
                lineType: 'Continuous',
                lineweight: -1,
                frozen: false,
                off: false,
                frozenInNew: false,
                locked: false,
                plotFlag: 1
              }
            ]
          }
        }
      },
      db
    )

    const road = db.tables.layerTable.getAt('0道路填充')
    expect(road).toBeTruthy()
    expect(road!.color.colorMethod).toBe(AcCmColorMethod.ByColor)
    expect(road!.color.RGB).toBe(0xff7fbf)
    expect(road!.color.isByLayer).toBe(false)

    const grass = db.tables.layerTable.getAt('0草地填充')
    expect(grass).toBeTruthy()
    expect(grass!.color.colorIndex).toBe(70)
  })

  it('keeps ByBlock when colorIndex is 0 even if color defaults to white', () => {
    // libredwg convertLayer defaults color to 0xffffff; the 0xc3/ByBlock path
    // only sets colorIndex=0 and leaves that default rgb in place.
    const db = new AcDbDatabase()
    const converter = new TestLibreDwgConverter({ useWorker: false })

    converter.processLayersPublic(
      {
        tables: {
          LAYER: {
            entries: [
              {
                name: 'ByBlockLayer',
                handle: '1',
                ownerHandle: '0',
                standardFlag: 0,
                colorIndex: 0,
                color: 0xffffff,
                lineType: 'Continuous',
                lineweight: -1,
                frozen: false,
                off: false,
                frozenInNew: false,
                locked: false,
                plotFlag: 1
              }
            ]
          }
        }
      },
      db
    )

    const layer = db.tables.layerTable.getAt('ByBlockLayer')
    expect(layer).toBeTruthy()
    expect(layer!.color.isByBlock).toBe(true)
    expect(layer!.color.colorIndex).toBe(0)
  })
})

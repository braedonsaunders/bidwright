import {
  AcCmColor,
  AcCmColorMethod,
  AcDbDatabase,
  AcDbDxfFiler,
  AcDbMLeaderStyle,
  acdbHostApplicationServices
} from '@mlightcad/data-model'

import { AcDbObjectConverter } from '../src/AcDbObjectConverter'

const createAciColor = (index: number) => {
  const color = new AcCmColor()
  color.colorIndex = index
  return color
}

describe('AcDbObjectConverter', () => {
  it('converts image definition and model layout', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbObjectConverter()

    const image = converter.convertImageDef({
      fileName: 'a.png',
      handle: '10',
      ownerObjectId: '2'
    } as any)
    expect(image.sourceFileName).toBe('a.png')
    expect(image.objectId).toBe('10')
    expect(image.ownerId).toBe('2')

    const model = {
      tables: {
        BLOCK_RECORD: {
          entries: [{ name: '*Model_Space', handle: '1A' }]
        }
      }
    } as any

    const layout = converter.convertLayout(
      {
        layoutName: 'Model',
        tabOrder: 0,
        pageSetupName: 'setup',
        configName: 'cfg',
        paperSize: 'A4',
        plotViewName: 'view',
        currentStyleSheet: 'style.ctb',
        marginLeft: 1,
        marginRight: 2,
        marginTop: 3,
        marginBottom: 4,
        paperWidth: 210,
        paperHeight: 297,
        plotOriginX: 0,
        plotOriginY: 0,
        windowAreaXMin: 0,
        windowAreaYMin: 0,
        windowAreaXMax: 10,
        windowAreaYMax: 10,
        printScaleNumerator: 1,
        printScaleDenominator: 1,
        plotPaperUnit: 0,
        plotRotation: 0,
        plotType: 0,
        standardScaleType: 0,
        shadePlotMode: 2,
        shadePlotResolution: 5,
        shadePlotCustomDPI: 300,
        shadePlotId: 'sid',
        layoutFlag: 1024,
        viewportId: 'vp-id',
        handle: '20',
        ownerObjectId: '3'
      } as any,
      model
    )

    expect(layout.layoutName).toBe('Model')
    expect(layout.blockTableRecordId).toBe('1A')
    expect(layout.modelType).toBe(true)
    expect(layout.viewportArray).toContain('vp-id')
    expect(layout.shadePlotId).toBe('sid')
    expect(layout.ownerId).toBe('3')
  })

  it('converts paper layout with block fallback', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbObjectConverter()
    const model = {
      tables: {
        BLOCK_RECORD: {
          entries: [
            { name: '*Paper_Space0', handle: '2A', layoutObjects: 'L1' }
          ]
        }
      }
    } as any

    const layout = converter.convertLayout(
      {
        layoutName: 'Layout1',
        tabOrder: 1,
        pageSetupName: '',
        configName: '',
        paperSize: '',
        plotViewName: '',
        currentStyleSheet: '',
        marginLeft: 0,
        marginRight: 0,
        marginTop: 0,
        marginBottom: 0,
        paperWidth: 0,
        paperHeight: 0,
        plotOriginX: 0,
        plotOriginY: 0,
        windowAreaXMin: 0,
        windowAreaYMin: 0,
        windowAreaXMax: 0,
        windowAreaYMax: 0,
        printScaleNumerator: 1,
        printScaleDenominator: 1,
        plotPaperUnit: 0,
        plotRotation: 0,
        plotType: 0,
        standardScaleType: 0,
        shadePlotMode: 0,
        shadePlotResolution: 0,
        handle: 'L1',
        ownerObjectId: '3',
        paperSpaceTableId: 'fallback-btr'
      } as any,
      model
    )

    expect(layout.blockTableRecordId).toBe('2A')

    const layoutFallback = converter.convertLayout(
      {
        ...(layout as any),
        handle: 'L2',
        layoutName: 'Layout2',
        paperSpaceTableId: 'fallback-btr'
      } as any,
      model
    )
    expect(layoutFallback.blockTableRecordId).toBe('fallback-btr')
  })

  it('preserves default ownership when DXF object metadata omits owner id', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbObjectConverter()

    const image = converter.convertImageDef({
      fileName: 'b.png',
      handle: '30'
    } as any)

    expect(image.objectId).toBe('30')
    expect(image.getAttrWithoutException('ownerId')).toBeUndefined()
  })

  it('decodes MLEADERSTYLE raw colors (ACI/true color/ByLayer) to AcCmColor', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbObjectConverter()

    const style = converter.convertMLeaderStyle({
      handle: 'MLS-1',
      ownerObjectId: 'OWNER-1',
      leaderLineColor: ((0xc3 << 24) | 1) >> 0,
      textColor: ((0xc2 << 24) | 0x112233) >> 0,
      blockContentColor: (0xc0 << 24) >> 0
    } as any)

    expect(style.leaderLineColor.isByACI).toBe(true)
    expect(style.leaderLineColor.colorIndex).toBe(1)
    expect(style.textColor.isByColor).toBe(true)
    expect(style.textColor.RGB).toBe(0x112233)
    expect(style.blockContentColor.isByLayer).toBe(true)
  })

  it('encodes MLEADERSTYLE AcCmColor as DXF raw-color values for 91/93/94', () => {
    const style = new AcDbMLeaderStyle()
    style.leaderLineColor = new AcCmColor(AcCmColorMethod.ByACI, 5)
    style.textColor = new AcCmColor(AcCmColorMethod.ByColor, 0xffaa33)
    style.blockColor = new AcCmColor(AcCmColorMethod.ByLayer)

    const filer = new AcDbDxfFiler()
    style.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain(`91\n${((0xc3 << 24) | 5) >> 0}\n`)
    expect(dxf).toContain(`93\n${((0xc2 << 24) | 0xffaa33) >> 0}\n`)
    expect(dxf).toContain(`94\n${(0xc0 << 24) >> 0}\n`)
  })

  it('converts MLINESTYLE elements from nested element definitions and prefers color over colorIndex', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbObjectConverter()

    const style = converter.convertMLineStyle({
      handle: 'MLS-2',
      ownerObjectId: 'OWNER-2',
      styleName: 'WALL',
      fillColor: 0x112233,
      fillColorIndex: 3,
      elementCount: 3,
      elements: [
        { offset: 0.5, color: 0xaabbcc, colorIndex: 1, lineType: 'BYLAYER' },
        { offset: -0.5, colorIndex: 5, lineType: 'DASHED' }
      ]
    } as any)

    expect(style.fillColor.RGB).toBe(0x112233)
    expect(style.fillColor.isByColor).toBe(true)
    expect(style.elements).toEqual([
      {
        offset: 0.5,
        color: new AcCmColor(AcCmColorMethod.ByColor, 0xaabbcc),
        lineType: 'BYLAYER'
      },
      {
        offset: -0.5,
        color: createAciColor(5),
        lineType: 'DASHED'
      },
      {
        offset: 0,
        color: new AcCmColor(AcCmColorMethod.ByLayer),
        lineType: 'BYLAYER'
      }
    ])
    expect(style.objectId).toBe('MLS-2')
    expect(style.ownerId).toBe('OWNER-2')
  })
})

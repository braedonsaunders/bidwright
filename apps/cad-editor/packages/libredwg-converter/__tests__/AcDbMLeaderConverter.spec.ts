import {
  AcDbDatabase,
  AcDbMLeader,
  AcGiMTextAttachmentPoint,
  acdbHostApplicationServices
} from '@mlightcad/data-model'

import { AcDbEntityConverter } from '../src/AcDbEntitiyConverter'
import { AcDbObjectConverter } from '../src/AcDbObjectConverter'

describe('libredwg AcDbObjectConverter', () => {
  it('decodes MLEADERSTYLE raw colors (ACI/true color/ByLayer) to AcCmColor', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbObjectConverter()

    const style = converter.convertMLeaderStyle({
      handle: 'MLS-1',
      ownerHandle: 'OWNER-1',
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
})

describe('libredwg AcDbEntityConverter MLEADER', () => {
  it('converts MULTILEADER with text content and leader sections', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()

    const result = converter.convert({
      type: 'MULTILEADER',
      subclassMarker: 'AcDbMLeader',
      handle: 'ML-1',
      layer: '0',
      leaderStyleId: 'STYLE-1',
      contentType: 2,
      textContent: 'Note text',
      textAnchor: { x: 10, y: 20, z: 0 },
      textHeight: 2.5,
      textWidth: 40,
      leaderSections: [
        {
          lastLeaderLinePoint: { x: 10, y: 20, z: 0 },
          lastLeaderLinePointSet: true,
          doglegLength: 8,
          leaderLines: [
            {
              vertices: [
                { x: 0, y: 0, z: 0 },
                { x: 5, y: 10, z: 0 }
              ]
            }
          ]
        }
      ]
    } as any)

    expect(result).toBeInstanceOf(AcDbMLeader)
    const mleader = result as AcDbMLeader
    expect(mleader.mleaderStyleId).toBe('STYLE-1')
    expect(mleader.mtextContent?.text).toBe('Note text')
    expect(mleader.mtextContent?.anchorPoint).toMatchObject({
      x: 10,
      y: 20,
      z: 0
    })
    expect(mleader.textHeight).toBe(2.5)
    expect(mleader.textWidth).toBe(40)
    expect(mleader.numberOfLeaders).toBe(1)
    expect(mleader.leaders[0].leaderLines[0].vertices).toHaveLength(2)
  })

  it('ignores zero text attachment point from libredwg justification field', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()

    const result = converter.convert({
      type: 'MULTILEADER',
      subclassMarker: 'AcDbMLeader',
      handle: 'ML-2',
      layer: '0',
      contentType: 2,
      textContent: 'Note text',
      textAnchor: { x: 10, y: 20, z: 0 },
      textAttachmentPoint: 0,
      leaderSections: [
        {
          leaderLines: [
            {
              vertices: [
                { x: 0, y: 0, z: 0 },
                { x: 5, y: 10, z: 0 }
              ]
            }
          ]
        }
      ]
    } as any)

    expect(result).toBeInstanceOf(AcDbMLeader)
    expect((result as AcDbMLeader).textAttachmentPoint).toBe(
      AcGiMTextAttachmentPoint.MiddleLeft
    )
  })

  it('keeps MText contentType when blockContentId is the null handle "0"', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()

    const result = converter.convert({
      type: 'MULTILEADER',
      subclassMarker: 'AcDbMLeader',
      handle: 'ML-3',
      layer: '0',
      contentType: 2,
      textContent: 'yellow non-standard line',
      textAnchor: { x: 1848.17, y: 1891.26, z: 0 },
      blockContentId: '0',
      leaderSections: [
        {
          leaderLines: [{ vertices: [{ x: 0, y: 0, z: 0 }] }]
        }
      ]
    } as any)

    expect(result).toBeInstanceOf(AcDbMLeader)
    const mleader = result as AcDbMLeader
    expect(mleader.contentType).toBe(2)
    expect(mleader.mtextContent?.text).toBe('yellow non-standard line')
    expect(mleader.blockContent).toBeUndefined()
  })

  it('converts MLeader raw int32 component colors to AcCmColor', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()

    const result = converter.convert({
      type: 'MULTILEADER',
      subclassMarker: 'AcDbMLeader',
      handle: 'ML-4',
      layer: '0',
      contentType: 2,
      textContent: 'yellow non-standard line',
      textColor: -1023410174,
      leaderLineColor: -1056964608,
      leaderSections: [
        {
          leaderLines: [{ vertices: [{ x: 0, y: 0, z: 0 }] }]
        }
      ]
    } as any)

    expect(result).toBeInstanceOf(AcDbMLeader)
    const mleader = result as AcDbMLeader
    expect(mleader.textColor?.isByACI).toBe(true)
    expect(mleader.textColor?.colorIndex).toBe(2)
    expect(mleader.leaderLineColor?.isByBlock).toBe(true)
  })
})
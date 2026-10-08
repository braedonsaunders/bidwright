import { AcCmColor, AcCmColorMethod } from '@mlightcad/common'
import { AcGePoint3d, AcGeVector3d } from '@mlightcad/geometry-engine'
import {
  AcGiLineWeight,
  AcGiSubEntityTraits,
  DEFAULT_ACGI_CONTEXT
} from '@mlightcad/graphic-interface'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import {
  AcDbBlockTableRecord,
  AcDbDatabase,
  AcDbLinetypeTableRecord
} from '../src/database'
import {
  AcDbLine,
  AcDbMLeader,
  AcDbMLeaderContentType
} from '../src/entity'
import {
  AcDbOsnapMode,
  AcDbRenderingCache,
  acdbDecodeMLeaderStyleRawColor
} from '../src/misc'
import { AcDbMLeaderStyle } from '../src/object'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

const createRenderer = () => {
  const renderer = {
    context: DEFAULT_ACGI_CONTEXT,
    subEntityTraits: {
      color: new AcCmColor(),
      lineType: {
        type: 'UserSpecified',
        name: 'CONTINUOUS',
        standardFlag: 0,
        description: '',
        totalPatternLength: 0
      },
      lineTypeScale: 1,
      lineWeight: undefined,
      fillType: undefined,
      transparency: undefined,
      thickness: 0,
      layer: '0',
      drawOrder: 0
    },
    lines: jest.fn((points: unknown[]) => {
      return { kind: 'lines', points }
    }),
    group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities })),
    point: jest.fn(),
    circularArc: jest.fn(),
    ellipticalArc: jest.fn(),
    lineSegments: jest.fn(),
    area: jest.fn(),
    mtext: jest.fn(),
    image: jest.fn(),
    setFontMapping: jest.fn()
  }
  return renderer
}

const createSimpleLeader = (db: AcDbDatabase) => {
  const mleader = new AcDbMLeader()
  const leaderIndex = mleader.addLeader()
  mleader.addLeaderLine(leaderIndex, [
    new AcGePoint3d(0, 0, 0),
    new AcGePoint3d(5, 0, 0)
  ])
  db.tables.blockTable.modelSpace.appendEntity(mleader)
  return mleader
}

describe('AcDbMLeader arrowhead rendering', () => {
  it('ensures database default mleader style exists when appending a new MLEADER', () => {
    const db = createWorkingDb()
    db.cmleaderstyle = 'AUTO_MLEADER_STYLE'

    const mleader = createSimpleLeader(db)
    const style = db.objects.mleaderStyle.getAt('AUTO_MLEADER_STYLE')

    expect(style).toBeDefined()
    expect(mleader.mleaderStyleId).toBe(style?.objectId)
    expect(style?.maxLeaderSegmentsPoints).toBe(2)
    expect(style?.leaderLineColor.isByBlock).toBe(true)
    expect(style?.textColor.isByBlock).toBe(true)
    expect(style?.blockColor.isByBlock).toBe(true)
    expect(style?.alignSpace).toBe(4)
    expect(style?.breakSize).toBe(3.75)
    expect(style?.enableBlockRotation).toBe(true)
    expect(style?.unknown1).toBe(2)
    expect(style?.unknown2).toBe(false)
  })

  it('uses CMLEADERSTYLE as default style for newly appended MLeader entities', () => {
    const db = createWorkingDb()
    const baseStyle = new AcDbMLeaderStyle()
    db.objects.mleaderStyle.setAt('BASE', baseStyle)
    const activeStyle = new AcDbMLeaderStyle()
    db.objects.mleaderStyle.setAt('ACTIVE', activeStyle)
    db.cmleaderstyle = 'ACTIVE'

    const mleader = createSimpleLeader(db)
    expect(mleader.mleaderStyleId).toBe(activeStyle.objectId)
  })

  it('renders closed-filled arrows when style arrowhead id is default 0', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)

    const style = new AcDbMLeaderStyle()
    style.arrowheadId = '0'
    db.objects.mleaderStyle.setAt(style.objectId, style)
    mleader.mleaderStyleId = style.objectId

    const renderer = createRenderer()
    mleader.worldDraw(renderer as never)

    expect(renderer.lines).toHaveBeenCalledTimes(1)
    expect(renderer.area).toHaveBeenCalledTimes(1)
  })

  it('renders arrowhead from referenced block record handle', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)

    const arrowBlock = new AcDbBlockTableRecord()
    arrowBlock.name = 'ARROW_BLOCK'
    db.tables.blockTable.add(arrowBlock)
    mleader.arrowheadId = arrowBlock.objectId

    const renderer = createRenderer()
    const cacheResult = { kind: 'arrow-block' }
    const drawSpy = jest
      .spyOn(AcDbRenderingCache.instance, 'draw')
      .mockReturnValue(cacheResult as never)

    mleader.worldDraw(renderer as never)

    expect(drawSpy).toHaveBeenCalledTimes(1)
    expect(drawSpy.mock.calls[0][1]).toBe(arrowBlock)
    expect(renderer.lines).toHaveBeenCalledTimes(1)
    expect(renderer.area).not.toHaveBeenCalled()

    drawSpy.mockRestore()
  })

  it('trims leader line start when block arrow occupies the tip area', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)

    const arrowBlock = new AcDbBlockTableRecord()
    arrowBlock.name = 'TRIM_ARROW_BLOCK'
    arrowBlock.origin = new AcGePoint3d(0, 0, 0)
    arrowBlock.appendEntity(
      new AcDbLine(new AcGePoint3d(-0.5, 0, 0), new AcGePoint3d(0.5, 0, 0))
    )
    db.tables.blockTable.add(arrowBlock)
    mleader.arrowheadId = arrowBlock.objectId

    const renderer = createRenderer()
    const drawSpy = jest
      .spyOn(AcDbRenderingCache.instance, 'draw')
      .mockReturnValue({ kind: 'arrow-block' } as never)

    mleader.worldDraw(renderer as never)

    const linePoints = renderer.lines.mock.calls[0][0] as AcGePoint3d[]
    expect(linePoints[0].x).toBeCloseTo(2)
    expect(linePoints[0].y).toBeCloseTo(0)
    expect(linePoints[1].x).toBeCloseTo(5)
    expect(drawSpy).toHaveBeenCalledTimes(1)

    drawSpy.mockRestore()
  })

  it('does not render arrows when arrowhead type resolves to _NONE', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)
    mleader.arrowheadId = '_NONE'

    const renderer = createRenderer()
    mleader.worldDraw(renderer as never)

    expect(renderer.lines).toHaveBeenCalledTimes(1)
    expect(renderer.area).not.toHaveBeenCalled()
  })

  it('prefers explicit entity text ACI color over style when override bit is clear', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)
    mleader.contents = 'yellow non-standard line'
    mleader.textLocation = new AcGePoint3d(5, 2, 0)
    mleader.contentType = AcDbMLeaderContentType.MTextContent

    // Real AutoCAD files (e.g. mleader-sytle.dxf) write ACI text color in
    // CONTEXT_DATA / common section while leaving the text-color override bit
    // unset in propertyOverrideFlag (0x44400).
    mleader.textColor = acdbDecodeMLeaderStyleRawColor(-1023410174) // ACI 2
    mleader.propertyOverrideFlag = 279552

    const style = new AcDbMLeaderStyle()
    style.textColor = new AcCmColor().setByBlock()
    db.objects.mleaderStyle.setAt(style.objectId, style)
    mleader.mleaderStyleId = style.objectId

    const renderer = createRenderer()
    let mtextRgb = -1
    renderer.mtext.mockImplementation(() => {
      mtextRgb = renderer.context.resolveSubEntityTraitsRgb(
        renderer.subEntityTraits as unknown as AcGiSubEntityTraits
      )
      return { kind: 'mtext' }
    })

    mleader.worldDraw(renderer as never)

    // ACI 2 = yellow
    expect(mtextRgb).toBe(0xffff00)
  })

  it('applies style leader/text color when entity raw color is unresolved ByBlock', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)
    mleader.contents = 'Color by style'
    mleader.textLocation = new AcGePoint3d(5, 2, 0)

    // Simulate DXF payload that writes entity raw color fields as ByBlock.
    mleader.leaderLineColor = new AcCmColor().setByBlock()
    mleader.textColor = new AcCmColor().setByBlock()

    const style = new AcDbMLeaderStyle()
    style.leaderLineColor = new AcCmColor(AcCmColorMethod.ByColor, 0xff0000)
    style.textColor = new AcCmColor(AcCmColorMethod.ByColor, 0x00aa00)
    db.objects.mleaderStyle.setAt(style.objectId, style)
    mleader.mleaderStyleId = style.objectId

    const renderer = createRenderer()
    const lineRgbLog: number[] = []
    let mtextRgb = -1
    renderer.lines.mockImplementation((points: unknown[]) => {
      lineRgbLog.push(
        renderer.context.resolveSubEntityTraitsRgb(
          renderer.subEntityTraits as unknown as AcGiSubEntityTraits
        )
      )
      return { kind: 'lines', points }
    })
    renderer.mtext.mockImplementation(() => {
      mtextRgb = renderer.context.resolveSubEntityTraitsRgb(
        renderer.subEntityTraits as unknown as AcGiSubEntityTraits
      )
      return { kind: 'mtext' }
    })

    mleader.worldDraw(renderer as never)

    expect(lineRgbLog[0]).toBe(0xff0000)
    expect(mtextRgb).toBe(0x00aa00)
  })

  it('forwards the delay flag to nested MText rendering', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)
    mleader.contents = 'Delayed text'
    mleader.textLocation = new AcGePoint3d(5, 2, 0)

    const renderer = createRenderer()
    mleader.worldDraw(renderer as never, true)

    expect(renderer.mtext).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Delayed text' }),
      expect.anything(),
      true
    )
  })

  it('applies style leader linetype id and lineweight to rendered leader line', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)

    const customLinetype = new AcDbLinetypeTableRecord({
      name: 'ML_TEST_DASHED',
      standardFlag: 0,
      description: 'test',
      totalPatternLength: 0.6,
      pattern: [
        { elementLength: 0.3, elementTypeFlag: 0 },
        { elementLength: -0.3, elementTypeFlag: 0 }
      ]
    })
    db.tables.linetypeTable.add(customLinetype)

    const style = new AcDbMLeaderStyle()
    style.leaderLineTypeId = customLinetype.objectId
    style.leaderLineWeight = AcGiLineWeight.LineWeight040
    db.objects.mleaderStyle.setAt(style.objectId, style)
    mleader.mleaderStyleId = style.objectId

    const renderer = createRenderer()
    let lineTypeName = ''
    let lineWeight: AcGiLineWeight | undefined
    renderer.lines.mockImplementation((points: unknown[]) => {
      lineTypeName = renderer.subEntityTraits.lineType.name
      lineWeight = renderer.subEntityTraits.lineWeight
      return { kind: 'lines', points }
    })

    mleader.worldDraw(renderer as never)

    expect(lineTypeName).toBe('ML_TEST_DASHED')
    expect(lineWeight).toBe(AcGiLineWeight.LineWeight040)
  })

  it('uses style dogleg settings when entity has no dogleg override', () => {
    const db = createWorkingDb()
    const mleader = new AcDbMLeader()
    const leaderIndex = mleader.addLeader({
      lastLeaderLinePoint: new AcGePoint3d(5, 0, 0),
      lastLeaderLinePointSet: true
    })
    mleader.addLeaderLine(leaderIndex, [
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(5, 0, 0)
    ])
    db.tables.blockTable.modelSpace.appendEntity(mleader)

    const style = new AcDbMLeaderStyle()
    style.doglegEnabled = true
    style.doglegLength = 3
    db.objects.mleaderStyle.setAt(style.objectId, style)
    mleader.mleaderStyleId = style.objectId

    const renderer = createRenderer()
    mleader.worldDraw(renderer as never)

    expect(renderer.lines).toHaveBeenCalledTimes(2)
  })

  it('computes osnap points on leader lines and content insertion', () => {
    const mleader = new AcDbMLeader()
    mleader.contentBasePosition = new AcGePoint3d(10, 5, 0)
    const leaderIndex = mleader.addLeader({
      lastLeaderLinePoint: new AcGePoint3d(5, 0, 0),
      lastLeaderLinePointSet: true
    })
    mleader.addLeaderLine(leaderIndex, [
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(5, 0, 0)
    ])

    const endPoints: AcGePoint3d[] = []
    mleader.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints.length).toBeGreaterThanOrEqual(2)

    const insertionSnaps: AcGePoint3d[] = []
    mleader.subGetOsnapPoints(
      AcDbOsnapMode.Insertion,
      new AcGePoint3d(),
      new AcGePoint3d(),
      insertionSnaps
    )
    expect(insertionSnaps).toHaveLength(1)
    expect(insertionSnaps[0]).toMatchObject({ x: 10, y: 5, z: 0 })

    const midPoints: AcGePoint3d[] = []
    mleader.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(2, 1, 0),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(1)
    expect(midPoints[0]).toMatchObject({ x: 2.5, y: 0, z: 0 })

    const nearestPoints: AcGePoint3d[] = []
    mleader.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(2, 1, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toMatchObject({ x: 2, y: 0, z: 0 })

    const perpendicularPoints: AcGePoint3d[] = []
    mleader.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(2, 1, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 2, y: 0, z: 0 })
  })
})

describe('AcDbMLeader geometricExtents', () => {
  it('returns geometricExtents and updates when leader vertices change', () => {
    const db = createWorkingDb()
    const mleader = createSimpleLeader(db)

    const before = mleader.geometricExtents
    expect(before.isEmpty()).toBe(false)
    expect(before.min.x).toBeCloseTo(0)
    expect(before.max.x).toBeCloseTo(5)

    mleader.addLeaderLine(0, [
      new AcGePoint3d(5, 0, 0),
      new AcGePoint3d(5, 12, 0)
    ])

    const after = mleader.geometricExtents
    expect(after.max.y).toBeCloseTo(12)
    expect(after.max.y).toBeGreaterThan(before.max.y)
  })
})

describe('AcDbMLeader dxfInFields CONTEXT_DATA', () => {
  it('parses native CONTEXT_DATA leaders and MText like dxf-json', () => {
    const db = createWorkingDb()
    const mleader = new AcDbMLeader()
    db.tables.blockTable.modelSpace.appendEntity(mleader)

    const dxf = [
      '0',
      'MULTILEADER',
      '5',
      '168',
      '330',
      '1F',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbMLeader',
      '270',
      '2',
      '300',
      'CONTEXT_DATA{',
      '40',
      '1.0',
      '10',
      '314.11285266458',
      '20',
      '159.24939045629',
      '30',
      '0.0',
      '41',
      '4.0',
      '290',
      '1',
      '304',
      'yellow non-standard line',
      '11',
      '0.0',
      '21',
      '0.0',
      '31',
      '1.0',
      '12',
      '326.9709699906373',
      '22',
      '161.2821326118152',
      '32',
      '0.0',
      '170',
      '1',
      '302',
      'LEADER{',
      '290',
      '1',
      '10',
      '306.11285266458',
      '20',
      '159.24939045629',
      '30',
      '0.0',
      '11',
      '1.0',
      '21',
      '0.0',
      '31',
      '0.0',
      '40',
      '8.0',
      '304',
      'LEADER_LINE{',
      '10',
      '291.78857540927',
      '20',
      '137.91536050157',
      '30',
      '0.0',
      '305',
      '}',
      '303',
      '}',
      '301',
      '}',
      '172',
      '2',
      '291',
      '1',
      '41',
      '8.0',
      '0',
      'ENDSEC'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(dxf, { database: db })
    expect(filer.readItem()?.value).toBe('MULTILEADER')
    mleader.dxfIn(filer)

    expect(mleader.version).toBe(2)
    expect(mleader.contentType).toBe(AcDbMLeaderContentType.MTextContent)
    expect(mleader.hasMText).toBe(true)
    expect(mleader.textHeight).toBe(4)
    expect(mleader.contentBasePosition).toMatchObject({
      x: 314.11285266458,
      y: 159.24939045629,
      z: 0
    })
    expect(mleader.mtextContent?.text).toBe('yellow non-standard line')
    expect(mleader.mtextContent?.anchorPoint).toMatchObject({
      x: 326.9709699906373,
      y: 161.2821326118152,
      z: 0
    })
    expect(mleader.numberOfLeaders).toBe(1)
    expect(mleader.leaders[0].lastLeaderLinePoint).toMatchObject({
      x: 306.11285266458,
      y: 159.24939045629,
      z: 0
    })
    expect(mleader.leaders[0].doglegLength).toBe(8)
    expect(mleader.leaders[0].leaderLines).toHaveLength(1)
    expect(mleader.leaders[0].leaderLines[0].vertices[0]).toMatchObject({
      x: 291.78857540927,
      y: 137.91536050157,
      z: 0
    })
    expect(mleader.doglegEnabled).toBe(true)
    expect(mleader.doglegLength).toBe(8)
  })

  it('still reads legacy flat dxfOutFields leader format', () => {
    const db = createWorkingDb()
    const written = new AcDbMLeader()
    written.contentType = AcDbMLeaderContentType.MTextContent
    written.doglegEnabled = true
    written.doglegLength = 5
    written.mtextContent = {
      text: 'legacy',
      anchorPoint: new AcGePoint3d(10, 20, 0)
    }
    written.addLeader({
      landingPoint: new AcGePoint3d(8, 20, 0),
      doglegVector: new AcGeVector3d(1, 0, 0),
      doglegLength: 5,
      leaderLines: [
        {
          vertices: [new AcGePoint3d(0, 0, 0), new AcGePoint3d(5, 10, 0)]
        }
      ]
    })
    db.tables.blockTable.modelSpace.appendEntity(written)

    const out = new AcDbDxfFiler()
    written.dxfOut(out)
    const dxf = ['0', 'MULTILEADER', out.toString()].join('\n')

    const readBack = new AcDbMLeader()
    db.tables.blockTable.modelSpace.appendEntity(readBack)
    const filer = AcDbDxfFiler.fromString(dxf, { database: db })
    expect(filer.readItem()?.value).toBe('MULTILEADER')
    readBack.dxfIn(filer)

    expect(readBack.mtextContent?.text).toBe('legacy')
    expect(readBack.numberOfLeaders).toBe(1)
    expect(readBack.leaders[0].leaderLines[0].vertices).toHaveLength(2)
  })

  it('parses real AutoCAD mleader-sytle CONTEXT_DATA with zeroed code 44 height', () => {
    const db = createWorkingDb()
    const mleader = new AcDbMLeader()
    db.tables.blockTable.modelSpace.appendEntity(mleader)

    // Minimal reproduction of C:\Users\MI\Downloads\mleader-sytle.dxf yellow entity:
    // CONTEXT code 41=4, then code 44=0 (must not wipe height), common 172=2.
    const dxf = [
      '0',
      'MULTILEADER',
      '5',
      '2A2',
      '330',
      '1F',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbMLeader',
      '270',
      '2',
      '300',
      'CONTEXT_DATA{',
      '40',
      '1.0',
      '10',
      '1846.178406316028',
      '20',
      '1888.681276467012',
      '30',
      '0.0',
      '41',
      '4.0',
      '140',
      '4.0',
      '145',
      '2.0',
      '290',
      '1',
      '304',
      'yellow non-standard line',
      '11',
      '0.0',
      '21',
      '0.0',
      '31',
      '1.0',
      '340',
      '11',
      '12',
      '1848.178406316028',
      '22',
      '1891.269271009986',
      '32',
      '0.0',
      '13',
      '1.0',
      '23',
      '0.0',
      '33',
      '0.0',
      '42',
      '0.0',
      '43',
      '0.0',
      '44',
      '0.0',
      '45',
      '1.0',
      '170',
      '1',
      '90',
      '-1023410174',
      '172',
      '5',
      '296',
      '0',
      '302',
      'LEADER{',
      '290',
      '1',
      '291',
      '1',
      '10',
      '1838.178406316028',
      '20',
      '1888.681276467012',
      '30',
      '0.0',
      '11',
      '1.0',
      '21',
      '0.0',
      '31',
      '0.0',
      '40',
      '8.0',
      '304',
      'LEADER_LINE{',
      '10',
      '1825.318691156017',
      '20',
      '1875.438882374751',
      '30',
      '0.0',
      '91',
      '0',
      '305',
      '}',
      '303',
      '}',
      '301',
      '}',
      '340',
      '28F',
      '170',
      '1',
      '291',
      '1',
      '41',
      '8.0',
      '172',
      '2',
      '92',
      '-1023410174',
      '179',
      '1',
      '0',
      'ENDSEC'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(dxf, { database: db })
    expect(filer.readItem()?.value).toBe('MULTILEADER')
    mleader.dxfIn(filer)

    expect(mleader.contentType).toBe(AcDbMLeaderContentType.MTextContent)
    expect(mleader.hasMText).toBe(true)
    expect(mleader.mtextContent?.text).toBe('yellow non-standard line')
    expect(mleader.mtextContent?.anchorPoint).toMatchObject({
      x: 1848.178406316028,
      y: 1891.269271009986,
      z: 0
    })
    // Code 44=0 must not destroy the real height from code 41.
    expect(mleader.textHeight).toBe(4)
    expect(mleader.textColor?.colorIndex).toBe(2)
    expect(mleader.numberOfLeaders).toBe(1)

    const renderer = createRenderer()
    const drawn = mleader.subWorldDraw(renderer as any, false)
    expect(drawn).toBeDefined()
    expect(renderer.mtext).toHaveBeenCalled()
    const mtextArg = (renderer.mtext as jest.Mock).mock.calls[0][0]
    expect(mtextArg.text).toBe('yellow non-standard line')
    expect(mtextArg.height).toBe(4)
  })
})

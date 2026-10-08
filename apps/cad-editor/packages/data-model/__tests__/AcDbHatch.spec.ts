import { AcCmColor } from '@mlightcad/common'
import {
  AcGeCircArc2d,
  AcGeEllipseArc2d,
  AcGeLine2d,
  AcGeLoop2d,
  AcGeMatrix3d,
  AcGePolyline2d,
  AcGeSpline3d
} from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import {
  AcDbDatabase,
  AcDbSysVarManager,
  AcDbSystemVariables
} from '../src/database'
import {
  AcDbHatch,
  AcDbHatchObjectType,
  AcDbHatchPatternType,
  AcDbHatchStyle
} from '../src/entity'
import {
  DEFAULT_HATCH_PATTERN_IMPERIAL,
  HATCH_PATTERN_SOLID
} from '../src/misc'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

const createRectLoop = (x: number, y: number, w: number, h: number) =>
  new AcGePolyline2d(
    [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h }
    ],
    true
  )

describe('AcDbHatch', () => {
  it('treats LibreDWG _SOLID pattern name as solid fill', () => {
    createWorkingDb()
    const hatch = new AcDbHatch()
    hatch.patternName = '_SOLID'
    expect(hatch.isSolidFill).toBe(true)
    hatch.patternName = 'solid'
    expect(hatch.isSolidFill).toBe(true)
    hatch.patternName = HATCH_PATTERN_SOLID
    expect(hatch.isSolidFill).toBe(true)
    hatch.patternName = 'ANSI31'
    expect(hatch.isSolidFill).toBe(false)
  })

  it('exposes type names and public getters/setters', () => {
    createWorkingDb()
    const hatch = new AcDbHatch()

    expect(AcDbHatch.typeName).toBe('Hatch')
    expect(hatch.dxfTypeName).toBe('HATCH')

    expect(hatch.patternType).toBe(AcDbHatchPatternType.Predefined)
    expect(hatch.patternName).toBe('')
    expect(hatch.patternAngle).toBe(0)
    expect(hatch.patternScale).toBe(1)
    expect(hatch.hatchStyle).toBe(AcDbHatchStyle.Normal)
    expect(hatch.elevation).toBe(0)
    expect(hatch.definitionLines).toEqual([])
    expect(hatch.isSolidFill).toBe(false)

    hatch.patternType = AcDbHatchPatternType.Custom
    hatch.patternName = DEFAULT_HATCH_PATTERN_IMPERIAL
    hatch.patternAngle = Math.PI / 3
    hatch.patternScale = 2.5
    hatch.hatchStyle = AcDbHatchStyle.Outer
    hatch.elevation = 8
    hatch.isSolidFill = false
    hatch.definitionLines.push({
      angle: 0,
      base: { x: 0, y: 0 },
      offset: { x: 1, y: 1 },
      dashLengths: [1]
    })

    expect(hatch.patternType).toBe(AcDbHatchPatternType.Custom)
    expect(hatch.patternName).toBe(DEFAULT_HATCH_PATTERN_IMPERIAL)
    expect(hatch.patternAngle).toBeCloseTo(Math.PI / 3)
    expect(hatch.patternScale).toBeCloseTo(2.5)
    expect(hatch.hatchStyle).toBe(AcDbHatchStyle.Outer)
    expect(hatch.elevation).toBe(8)
    expect(hatch.definitionLines).toHaveLength(1)
    expect(hatch.isSolidFill).toBe(false)

    hatch.patternName = 'solid'
    expect(hatch.isSolidFill).toBe(true)

    hatch.patternName = DEFAULT_HATCH_PATTERN_IMPERIAL
    expect(hatch.isSolidFill).toBe(false)
  })

  it('expands predefined pattern names into scaled definition lines', () => {
    createWorkingDb()
    const hatch = new AcDbHatch()

    hatch.patternName = 'ansi31'
    expect(hatch.patternName).toBe('ansi31')
    expect(hatch.isSolidFill).toBe(false)
    expect(hatch.definitionLines).toHaveLength(1)
    expect(hatch.definitionLines[0].angle).toBeCloseTo(Math.PI / 4)
    expect(hatch.definitionLines[0].offset.y).toBeCloseTo(3.175)

    hatch.patternScale = 2
    expect(hatch.definitionLines).toHaveLength(1)
    expect(hatch.definitionLines[0].offset.y).toBeCloseTo(3.175 * 2)
  })

  it('applies hatch system variables when a new hatch is added to a database', () => {
    const db = createWorkingDb()
    const manager = AcDbSysVarManager.instance()
    const previousHpName = manager.getVar(AcDbSystemVariables.HPNAME, db)
    const previousHpAng = manager.getVar(AcDbSystemVariables.HPANG, db)
    const previousHpScale = manager.getVar(AcDbSystemVariables.HPSCALE, db)
    const previousHpAssoc = manager.getVar(AcDbSystemVariables.HPASSOC, db)
    const previousHpColor = manager.getVar(AcDbSystemVariables.HPCOLOR, db)
    const previousHpBackgroundColor = manager.getVar(
      AcDbSystemVariables.HPBACKGROUNDCOLOR,
      db
    )
    const previousHpLayer = manager.getVar(AcDbSystemVariables.HPLAYER, db)
    const previousHpTransparency = manager.getVar(
      AcDbSystemVariables.HPTRANSPARENCY,
      db
    )
    const previousHpIslandDetection = manager.getVar(
      AcDbSystemVariables.HPISLANDDETECTION,
      db
    )
    const previousHpDouble = manager.getVar(AcDbSystemVariables.HPDOUBLE, db)

    try {
      manager.setVar(
        AcDbSystemVariables.HPNAME,
        DEFAULT_HATCH_PATTERN_IMPERIAL,
        db
      )
      manager.setVar(AcDbSystemVariables.HPANG, Math.PI / 6, db)
      manager.setVar(AcDbSystemVariables.HPSCALE, 2, db)
      manager.setVar(AcDbSystemVariables.HPASSOC, 0, db)
      manager.setVar(AcDbSystemVariables.HPCOLOR, 'RGB:10,20,30', db)
      manager.setVar(AcDbSystemVariables.HPBACKGROUNDCOLOR, 'RGB:40,50,60', db)
      manager.setVar(AcDbSystemVariables.HPLAYER, 'HATCH_LAYER', db)
      manager.setVar(AcDbSystemVariables.HPTRANSPARENCY, '25', db)
      manager.setVar(AcDbSystemVariables.HPISLANDDETECTION, 2, db)
      manager.setVar(AcDbSystemVariables.HPDOUBLE, 1, db)

      const hatch = new AcDbHatch()
      db.tables.blockTable.modelSpace.appendEntity(hatch)

      expect(hatch.layer).toBe('HATCH_LAYER')
      expect(hatch.color.RGB).toBe(0x0a141e)
      expect(hatch.transparency.percentage).toBe(25)
      expect(hatch.backgroundColor).toBeInstanceOf(AcCmColor)
      expect(hatch.backgroundColor?.RGB).toBe(0x28323c)
      expect(hatch.patternName).toBe(DEFAULT_HATCH_PATTERN_IMPERIAL)
      expect(hatch.patternAngle).toBeCloseTo(Math.PI / 6)
      expect(hatch.patternScale).toBe(2)
      expect(hatch.associative).toBe(false)
      expect(hatch.hatchStyle).toBe(AcDbHatchStyle.Ignore)
      expect(hatch.patternDouble).toBe(true)
      expect(hatch.definitionLines).toHaveLength(1)
      expect(hatch.definitionLines[0].offset.y).toBeCloseTo(3.175 * 2)
    } finally {
      manager.setVar(AcDbSystemVariables.HPNAME, previousHpName as string, db)
      manager.setVar(AcDbSystemVariables.HPANG, previousHpAng as number, db)
      manager.setVar(AcDbSystemVariables.HPSCALE, previousHpScale as number, db)
      manager.setVar(AcDbSystemVariables.HPASSOC, previousHpAssoc as number, db)
      manager.setVar(AcDbSystemVariables.HPCOLOR, previousHpColor as string, db)
      manager.setVar(
        AcDbSystemVariables.HPBACKGROUNDCOLOR,
        previousHpBackgroundColor as string,
        db
      )
      manager.setVar(AcDbSystemVariables.HPLAYER, previousHpLayer as string, db)
      manager.setVar(
        AcDbSystemVariables.HPTRANSPARENCY,
        previousHpTransparency as string,
        db
      )
      manager.setVar(
        AcDbSystemVariables.HPISLANDDETECTION,
        previousHpIslandDetection as number,
        db
      )
      manager.setVar(
        AcDbSystemVariables.HPDOUBLE,
        previousHpDouble as number,
        db
      )
    }
  })

  it('resolves color from HPCOLOR before CECOLOR until color is explicitly set', () => {
    const db = createWorkingDb()
    const manager = AcDbSysVarManager.instance()
    const previousHpColor = manager.getVar(AcDbSystemVariables.HPCOLOR, db)

    try {
      db.cecolor = new AcCmColor().setRGBValue(0x112233)
      manager.setVar(AcDbSystemVariables.HPCOLOR, 'RGB:10,20,30', db)

      const hatch = new AcDbHatch()
      db.tables.blockTable.modelSpace.appendEntity(hatch)

      expect(hatch.color.RGB).toBe(0x0a141e)
      expect(hatch.resolvedColor.RGB).toBe(0x0a141e)

      manager.setVar(AcDbSystemVariables.HPCOLOR, 'RGB:40,50,60', db)
      expect(hatch.color.RGB).toBe(0x28323c)

      manager.setVar(AcDbSystemVariables.HPCOLOR, 'None', db)
      expect(hatch.color.RGB).toBe(0x112233)

      db.cecolor = new AcCmColor().setRGBValue(0x445566)
      expect(hatch.color.RGB).toBe(0x445566)

      hatch.color = new AcCmColor().setRGBValue(0x778899)
      manager.setVar(AcDbSystemVariables.HPCOLOR, 'RGB:1,2,3', db)
      db.cecolor = new AcCmColor().setRGBValue(0xaabbcc)

      expect(hatch.color.RGB).toBe(0x778899)
      expect(hatch.resolvedColor.RGB).toBe(0x778899)
    } finally {
      manager.setVar(
        AcDbSystemVariables.HPCOLOR,
        previousHpColor as AcCmColor,
        db
      )
    }
  })

  it('uses hatch system variables while rendering hatches without explicit pattern metadata', () => {
    const db = createWorkingDb()
    const manager = AcDbSysVarManager.instance()
    const previousHpName = manager.getVar(AcDbSystemVariables.HPNAME, db)
    const previousHpAng = manager.getVar(AcDbSystemVariables.HPANG, db)
    const previousHpScale = manager.getVar(AcDbSystemVariables.HPSCALE, db)

    try {
      manager.setVar(
        AcDbSystemVariables.HPNAME,
        DEFAULT_HATCH_PATTERN_IMPERIAL,
        db
      )
      manager.setVar(AcDbSystemVariables.HPANG, Math.PI / 8, db)
      manager.setVar(AcDbSystemVariables.HPSCALE, 3, db)

      const hatch = new AcDbHatch()
      hatch.add(createRectLoop(0, 0, 1, 1))
      const renderer = {
        subEntityTraits: {} as Record<string, unknown>,
        area: jest.fn((area: unknown) => ({ kind: 'area', area })),
        group: jest.fn()
      }

      hatch.subWorldDraw(renderer as never)

      expect(renderer.subEntityTraits.fillType).toMatchObject({
        solidFill: false,
        patternAngle: Math.PI / 8,
        definitionLines: hatch.definitionLines
      })
      expect(hatch.definitionLines).toHaveLength(1)
      expect(hatch.definitionLines[0].offset.y).toBeCloseTo(3.175 * 3)
    } finally {
      manager.setVar(AcDbSystemVariables.HPNAME, previousHpName as string, db)
      manager.setVar(AcDbSystemVariables.HPANG, previousHpAng as number, db)
      manager.setVar(AcDbSystemVariables.HPSCALE, previousHpScale as number, db)
    }
  })

  it('keeps imported explicit definition lines when pattern metadata is assigned', () => {
    const hatch = new AcDbHatch()
    hatch.definitionLines.push({
      angle: 0.25,
      base: { x: 1, y: 2 },
      offset: { x: 3, y: 4 },
      dashLengths: [5, -6]
    })

    hatch.patternName = DEFAULT_HATCH_PATTERN_IMPERIAL
    hatch.patternScale = 3

    expect(hatch.definitionLines).toEqual([
      {
        angle: 0.25,
        base: { x: 1, y: 2 },
        offset: { x: 3, y: 4 },
        dashLengths: [5, -6]
      }
    ])
  })

  it('does not apply entity pattern angle when explicit definition lines exist', () => {
    createWorkingDb()
    const hatch = new AcDbHatch()
    hatch.patternAngle = Math.PI / 4
    hatch.definitionLines.push({
      angle: Math.PI / 4,
      base: { x: 8812.5093594135, y: 10309.08680448488 },
      offset: { x: -1.4142135624, y: 1.4142135624 },
      dashLengths: []
    })
    hatch.add(createRectLoop(0, 0, 1, 1))

    const renderer = {
      subEntityTraits: {} as Record<string, unknown>,
      area: jest.fn((area: unknown) => ({ kind: 'area', area })),
      group: jest.fn()
    }

    hatch.subWorldDraw(renderer as never)

    expect(hatch.patternAngle).toBeCloseTo(Math.PI / 4)
    expect(renderer.subEntityTraits.fillType).toMatchObject({
      patternAngle: 0,
      definitionLines: hatch.definitionLines
    })
  })

  it('supports add(), geometricExtents and properties accessors', () => {
    const hatch = new AcDbHatch()
    const emptyExtents = hatch.geometricExtents
    expect(emptyExtents.isEmpty()).toBe(true)

    hatch.add(createRectLoop(0, 0, 10, 5))
    hatch.add(createRectLoop(2, 1, 2, 2))
    hatch.add(createRectLoop(20, 2, 2, 3))
    hatch.elevation = 4

    const extents = hatch.geometricExtents
    expect(extents.min).toMatchObject({ x: 0, y: 0, z: 4 })
    expect(extents.max).toMatchObject({ x: 22, y: 5, z: 4 })

    const properties = hatch.properties
    expect(properties.type).toBe('Hatch')

    const patternGroup = properties.groups.find(g => g.groupName === 'pattern')
    const geometryGroup = properties.groups.find(
      g => g.groupName === 'geometry'
    )
    expect(patternGroup).toBeDefined()
    expect(geometryGroup).toBeDefined()

    const propertyValues: Record<string, unknown> = {
      patternType: AcDbHatchPatternType.UserDefined,
      patternName: 'TEST_PATTERN',
      patternAngle: Math.PI / 6,
      patternScale: 3.25,
      elevation: 6
    }

    for (const group of [patternGroup!, geometryGroup!]) {
      for (const prop of group.properties) {
        prop.accessor.get()
        if (prop.editable && prop.accessor.set) {
          prop.accessor.set(propertyValues[prop.name] as never)
        }
        prop.accessor.get()
      }
    }

    const patternTypeProp = patternGroup!.properties.find(
      p => p.name === 'patternType'
    )
    expect(patternTypeProp?.options).toHaveLength(3)

    const areaProp = geometryGroup!.properties.find(p => p.name === 'area')
    expect(areaProp?.editable).toBe(false)
    expect((areaProp?.accessor.get() as number) > 0).toBe(true)

    expect(hatch.patternType).toBe(AcDbHatchPatternType.UserDefined)
    expect(hatch.patternName).toBe('TEST_PATTERN')
    expect(hatch.patternAngle).toBeCloseTo(Math.PI / 6)
    expect(hatch.patternScale).toBeCloseTo(3.25)
    expect(hatch.elevation).toBe(6)
  })

  it('updates geometricExtents when elevation changes', () => {
    const hatch = new AcDbHatch()
    hatch.add(createRectLoop(0, 0, 10, 5))

    expect(hatch.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })

    hatch.elevation = 12

    expect(hatch.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 12 })
    expect(hatch.geometricExtents.max).toMatchObject({ x: 10, y: 5, z: 12 })
  })

  it('computes osnap points on hatch boundary loops', () => {
    const hatch = new AcDbHatch()
    hatch.add(createRectLoop(0, 0, 10, 5))
    hatch.elevation = 2

    const endPoints: Array<{ x: number; y: number; z: number }> = []
    hatch.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      endPoints
    )
    expect(endPoints.length).toBeGreaterThanOrEqual(4)

    const nearestPoints: Array<{ x: number; y: number; z: number }> = []
    hatch.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      { x: 5, y: 6, z: 0 },
      { x: 0, y: 0, z: 0 },
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toMatchObject({ x: 5, y: 5, z: 2 })

    const midPoints: Array<{ x: number; y: number; z: number }> = []
    hatch.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      { x: 5, y: 6, z: 0 },
      { x: 0, y: 0, z: 0 },
      midPoints
    )
    expect(midPoints.length).toBeGreaterThanOrEqual(4)

    const perpendicularPoints: Array<{ x: number; y: number; z: number }> = []
    hatch.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      { x: 5, y: 6, z: 0 },
      { x: 0, y: 0, z: 0 },
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 5, y: 5, z: 2 })
  })

  it('draws empty/single/multi hatch areas and applies fill traits', () => {
    const makeRenderer = () => ({
      subEntityTraits: {} as Record<string, unknown>,
      area: jest.fn((area: unknown) => ({ kind: 'area', area })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    })

    const emptyHatch = new AcDbHatch()
    const emptyRenderer = makeRenderer()
    const emptyDraw = emptyHatch.subWorldDraw(emptyRenderer as never)
    expect(emptyRenderer.area).toHaveBeenCalledTimes(1)
    expect(emptyRenderer.group).not.toHaveBeenCalled()
    expect(emptyDraw).toMatchObject({ kind: 'area' })
    expect(
      (emptyRenderer.subEntityTraits.fillType as { solidFill: boolean })
        .solidFill
    ).toBe(false)

    const singleHatch = new AcDbHatch()
    singleHatch.patternName = HATCH_PATTERN_SOLID
    singleHatch.definitionLines.push({
      angle: Math.PI / 4,
      base: { x: 0, y: 0 },
      offset: { x: 1, y: 0 },
      dashLengths: []
    })
    singleHatch.add(createRectLoop(0, 0, 3, 2))

    const singleRenderer = makeRenderer()
    const singleDraw = singleHatch.subWorldDraw(singleRenderer as never)
    expect(singleRenderer.area).toHaveBeenCalledTimes(1)
    expect(singleRenderer.group).not.toHaveBeenCalled()
    expect(singleDraw).toMatchObject({ kind: 'area' })
    expect(
      singleRenderer.subEntityTraits.fillType as {
        solidFill: boolean
        definitionLines: unknown[]
      }
    ).toMatchObject({
      solidFill: true,
      definitionLines: singleHatch.definitionLines
    })

    const multiHatch = new AcDbHatch()
    multiHatch.add(createRectLoop(0, 0, 2, 2))
    multiHatch.add(createRectLoop(5, 0, 2, 2))

    const multiRenderer = makeRenderer()
    const multiDraw = multiHatch.subWorldDraw(
      multiRenderer as never
    ) as unknown as {
      entities: unknown[]
      kind: string
    }
    expect(multiRenderer.area).toHaveBeenCalledTimes(2)
    expect(multiRenderer.group).toHaveBeenCalledTimes(1)
    expect(multiDraw.kind).toBe('group')
    expect(multiDraw.entities).toHaveLength(2)
  })

  it('reuses and invalidates cached areasFromLoops across draw and mutations', () => {
    const hatch = new AcDbHatch()
    hatch.patternName = HATCH_PATTERN_SOLID
    hatch.add(createRectLoop(0, 0, 3, 2))

    expect(hatch.directBatchPrimitive).toBe('area')
    expect(hatch.area).toBeCloseTo(6, 8)
    expect(hatch.directBatchPrimitive).toBe('area')

    const renderer = {
      subEntityTraits: {} as Record<string, unknown>,
      area: jest.fn((area: unknown) => ({ kind: 'area', area })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }
    expect(hatch.subWorldDraw(renderer as never)).toMatchObject({
      kind: 'area'
    })
    expect(renderer.area).toHaveBeenCalledTimes(1)
    expect(renderer.group).not.toHaveBeenCalled()

    hatch.add(createRectLoop(5, 0, 2, 2))
    expect(hatch.directBatchPrimitive).toBe(null)

    const multiRenderer = {
      subEntityTraits: {} as Record<string, unknown>,
      area: jest.fn((area: unknown) => ({ kind: 'area', area })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }
    const multiDraw = hatch.subWorldDraw(
      multiRenderer as never
    ) as unknown as {
      kind: string
      entities: unknown[]
    }
    expect(multiRenderer.area).toHaveBeenCalledTimes(2)
    expect(multiRenderer.group).toHaveBeenCalledTimes(1)
    expect(multiDraw.kind).toBe('group')

    const before = hatch.geometricExtents.clone()
    hatch.transformBy(new AcGeMatrix3d().makeTranslation(10, 0, 0))
    const after = hatch.geometricExtents
    expect(after.min.x).toBeCloseTo(before.min.x + 10, 8)
    expect(after.max.x).toBeCloseTo(before.max.x + 10, 8)
    expect(hatch.directBatchPrimitive).toBe(null)
  })

  it('passes gradient hatch settings to graphics traits', () => {
    const hatch = new AcDbHatch()
    hatch.hatchObjectType = AcDbHatchObjectType.GradientObject
    hatch.gradientName = 'SPHERICAL'
    hatch.gradientAngle = Math.PI / 3
    hatch.gradientShift = 0.2
    hatch.gradientOneColorMode = true
    hatch.shadeTintValue = 0.6
    hatch.gradientStartColor = 0x112233
    hatch.gradientEndColor = 0x445566
    hatch.add(createRectLoop(0, 0, 3, 2))

    const renderer = {
      subEntityTraits: {} as Record<string, unknown>,
      area: jest.fn((area: unknown) => ({ kind: 'area', area })),
      group: jest.fn()
    }
    hatch.subWorldDraw(renderer as never)

    expect(renderer.subEntityTraits.fillType).toMatchObject({
      gradient: {
        name: 'SPHERICAL',
        angle: Math.PI / 3,
        shift: 0.2,
        oneColorMode: true,
        shadeTintValue: 0.6,
        startColor: 0x112233,
        endColor: 0x445566
      }
    })
  })

  it('transformBy updates loops, elevation, pattern angle/scale and handles zero-length x-axis', () => {
    const hatch = new AcDbHatch()
    hatch.add(createRectLoop(0, 0, 1, 1))
    hatch.elevation = 2
    hatch.patternAngle = 0.2
    hatch.patternScale = 1.5

    const matrix = new AcGeMatrix3d()
      .makeRotationZ(Math.PI / 2)
      .setPosition(0, 0, 5)
    expect(hatch.transformBy(matrix)).toBe(hatch)
    expect(hatch.elevation).toBeCloseTo(7)
    expect(hatch.patternAngle).toBeCloseTo(0.2 + Math.PI / 2)
    expect(hatch.patternScale).toBeCloseTo(1.5)

    const previousAngle = hatch.patternAngle
    const previousScale = hatch.patternScale
    hatch.transformBy(new AcGeMatrix3d().makeScale(0, 0, 1))
    expect(hatch.patternAngle).toBeCloseTo(previousAngle)
    expect(hatch.patternScale).toBeCloseTo(previousScale)
  })

  it('writes DXF fields for polyline/edge loops and hatch pattern data', () => {
    const db = createWorkingDb()
    const hatch = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(hatch)

    hatch.patternType = AcDbHatchPatternType.Custom
    hatch.patternName = ''
    hatch.patternAngle = Math.PI / 6
    hatch.patternScale = 2.5
    hatch.hatchStyle = AcDbHatchStyle.Outer
    hatch.elevation = 5
    hatch.isSolidFill = false
    hatch.definitionLines.push({
      angle: Math.PI / 4,
      base: { x: 0, y: 0 },
      offset: { x: 1, y: 1 },
      dashLengths: [1, -0.5]
    })

    hatch.add(
      new AcGePolyline2d(
        [
          { x: 0, y: 0, bulge: 0.5 },
          { x: 4, y: 0, bulge: 0 },
          { x: 4, y: 4, bulge: -0.2 },
          { x: 0, y: 4, bulge: 0 }
        ],
        true
      )
    )
    hatch.add(createRectLoop(6, 0, 2, 2))

    const edgeLoop = new AcGeLoop2d([
      new AcGeLine2d({ x: 10, y: 0 }, { x: 12, y: 0 }),
      new AcGeSpline3d(
        [
          { x: 12, y: 0, z: 0 },
          { x: 12.5, y: 1, z: 0 },
          { x: 13.5, y: 1, z: 0 },
          { x: 14, y: 0, z: 0 }
        ],
        [0, 0, 0, 0, 1, 1, 1, 1],
        [1, 1.5, 1, 1],
        3,
        false
      )
    ])
    edgeLoop.add(
      new AcGeCircArc2d({ x: 13, y: 2 }, 1, -Math.PI / 2, Math.PI / 2, false)
    )
    edgeLoop.add(
      new AcGeEllipseArc2d({ x: 11, y: 2, z: 0 }, 1.5, 1, 0, Math.PI, false, 0)
    )
    hatch.add(edgeLoop)

    const filer = new AcDbDxfFiler().setVersion(27)
    expect(hatch.dxfOutFields(filer)).toBe(hatch)

    const dxf = filer.toString()
    expect(dxf).toContain('100\nAcDbHatch\n')
    expect(dxf).toContain('\n2\nUSER\n')
    expect(dxf).toContain('\n70\n0\n')
    expect(dxf).toContain('\n91\n3\n')
    expect(dxf).toContain('\n72\n4\n')
    expect(dxf).toContain('\n94\n3\n')
    expect(dxf).toContain('\n95\n8\n')
    expect(dxf).toContain('\n96\n4\n')
    expect(dxf).toContain('\n75\n1\n')
    expect(dxf).toContain('\n76\n2\n')
    expect(dxf).toContain('\n52\n')
    expect(dxf).toContain('\n41\n2.5\n')
    expect(dxf).toContain('\n78\n1\n')
    // Pattern line base/offset use codes 43/44 and 45/46 (not 43/53, 45/55).
    expect(dxf).toContain('\n53\n45\n43\n0\n44\n0\n45\n1\n46\n1\n79\n2\n')
    expect(dxf).toContain('\n79\n2\n')
    expect(dxf).toContain('\n98\n0\n')
  })

  it('writes SOLID fallback when solid fill is enabled and patternName is empty', () => {
    const db = createWorkingDb()
    const hatch = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(hatch)
    hatch.patternName = ''
    hatch.isSolidFill = true
    hatch.add(createRectLoop(0, 0, 1, 1))

    const filer = new AcDbDxfFiler()
    hatch.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain('\n2\nSOLID\n')
    expect(dxf).toContain('\n70\n1\n')
  })

  it('writes a 360-degree span for full-circle arc boundary edges', () => {
    const db = createWorkingDb()
    const hatch = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(hatch)
    hatch.patternName = HATCH_PATTERN_SOLID
    hatch.isSolidFill = true

    // A full-circle arc edge (0..2π) collapses to start == end under
    // AcGeCircArc2d's angle normalization. dxfOut must restore the 0°..360°
    // span: writing both angles verbatim produces a degenerate zero-length
    // arc, and strict DXF readers (ezdxf, AutoCAD) then treat the boundary
    // as open and silently drop the fill.
    hatch.add(
      new AcGeLoop2d([
        new AcGeCircArc2d({ x: 5, y: 5 }, 3, 0, Math.PI * 2, false)
      ])
    )
    // A genuine partial arc right next to it must stay untouched.
    hatch.add(
      new AcGeLoop2d([
        new AcGeCircArc2d({ x: 20, y: 5 }, 3, 0, Math.PI / 2, false),
        new AcGeLine2d({ x: 23, y: 5 }, { x: 20, y: 5 }),
        new AcGeLine2d({ x: 20, y: 5 }, { x: 20, y: 8 })
      ])
    )

    const filer = new AcDbDxfFiler()
    hatch.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain('\n72\n2\n')
    expect(dxf).toContain('\n50\n0\n51\n360\n')
    expect(dxf).toContain('\n50\n0\n51\n90\n')
  })

  it('writes a 360-degree span for full-ellipse arc boundary edges', () => {
    const db = createWorkingDb()
    const hatch = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(hatch)
    hatch.patternName = HATCH_PATTERN_SOLID
    hatch.isSolidFill = true

    // Constructor full-ellipse (0..2π) keeps end=TAU, but closed is still
    // true because deltaAngle normalizes to 0 — dxfOut must emit 0°..360°.
    hatch.add(
      new AcGeLoop2d([
        new AcGeEllipseArc2d({ x: 5, y: 5 }, 4, 2, 0, Math.PI * 2, false, 0)
      ])
    )

    // Collapsed closed edge (start ≡ end after normalize/transform): without
    // the span restore this would write a degenerate 45°..45° edge.
    const collapsed = new AcGeEllipseArc2d(
      { x: 20, y: 5 },
      4,
      2,
      0,
      Math.PI / 2,
      false,
      0
    )
    collapsed.startAngle = Math.PI / 4
    collapsed.endAngle = Math.PI / 4
    expect(collapsed.closed).toBe(true)
    hatch.add(new AcGeLoop2d([collapsed]))

    // Genuine partial ellipse must stay untouched.
    hatch.add(
      new AcGeLoop2d([
        new AcGeEllipseArc2d(
          { x: 35, y: 5 },
          4,
          2,
          0,
          Math.PI / 2,
          false,
          0
        )
      ])
    )

    const filer = new AcDbDxfFiler()
    hatch.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain('\n72\n3\n')
    expect(dxf).toContain('\n50\n0\n51\n360\n')
    expect(dxf).toContain('\n50\n0\n51\n90\n')
    // Collapsed closed edge: start° + 360°. Allow float noise on the end angle
    // (e.g. 404.999… from π/4 + 2π → degrees).
    const collapsedAngles = dxf.match(/\n50\n45\n51\n([^\n]+)\n/)
    expect(collapsedAngles).not.toBeNull()
    expect(Number(collapsedAngles![1])).toBeCloseTo(405, 6)
  })

  it('dxfInFields reads gradient colors, name, angle (radians), and tint', () => {
    const db = createWorkingDb()
    const hatch = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(hatch)

    const dxf = [
      '0',
      'HATCH',
      '5',
      '1A',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbHatch',
      '10',
      '0.0',
      '20',
      '0.0',
      '30',
      '0.0',
      '2',
      'SOLID',
      '70',
      '1',
      '71',
      '0',
      '91',
      '1',
      '92',
      '2',
      '72',
      '0',
      '73',
      '1',
      '93',
      '4',
      '10',
      '0.0',
      '20',
      '0.0',
      '10',
      '10.0',
      '20',
      '0.0',
      '10',
      '10.0',
      '20',
      '5.0',
      '10',
      '0.0',
      '20',
      '5.0',
      '97',
      '0',
      '75',
      '0',
      '76',
      '1',
      '98',
      '0',
      '450',
      '1',
      '451',
      '0',
      '460',
      '1.5707963267948966',
      '461',
      '0.25',
      '452',
      '0',
      '462',
      '0.0',
      '453',
      '2',
      '463',
      '0.0',
      '63',
      '5',
      '421',
      '255',
      '463',
      '1.0',
      '63',
      '2',
      '421',
      '16776960',
      '470',
      'LINEAR',
      '0',
      'ENDSEC'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(dxf, { database: db })
    expect(filer.readItem()?.value).toBe('HATCH')
    hatch.dxfIn(filer)

    expect(hatch.hatchObjectType).toBe(AcDbHatchObjectType.GradientObject)
    expect(hatch.isGradient).toBe(true)
    expect(hatch.gradientName).toBe('LINEAR')
    expect(hatch.gradientAngle).toBeCloseTo(Math.PI / 2)
    expect(hatch.gradientShift).toBeCloseTo(0.25)
    expect(hatch.gradientOneColorMode).toBe(false)
    expect(hatch.gradientStartColor).toBe(255)
    expect(hatch.gradientEndColor).toBe(16776960)
  })

  it('dxfOutFields writes gradient colors and round-trips through dxfInFields', () => {
    const db = createWorkingDb()
    const hatch = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(hatch)
    hatch.isSolidFill = true
    hatch.patternName = HATCH_PATTERN_SOLID
    hatch.hatchObjectType = AcDbHatchObjectType.GradientObject
    hatch.gradientName = 'CYLINDER'
    hatch.gradientAngle = Math.PI / 3
    hatch.gradientShift = 0.4
    hatch.gradientOneColorMode = false
    hatch.shadeTintValue = 0.1
    hatch.gradientStartColor = 0x0000ff
    hatch.gradientEndColor = 0xffff00
    hatch.add(createRectLoop(0, 0, 2, 1))

    const outFiler = new AcDbDxfFiler().setVersion(27)
    hatch.dxfOutFields(outFiler)
    const body = outFiler.toString()

    expect(body).toContain('\n450\n1\n')
    expect(body).toContain('\n421\n255\n')
    expect(body).toContain('\n421\n16776960\n')
    expect(body).toContain('\n470\nCYLINDER\n')
    // Group 460 must be radians, not degrees.
    expect(body).toMatch(/\n460\n1\.047\d*\n/)

    const dxf = ['0', 'HATCH', '5', '2B', body, '0', 'ENDSEC'].join('\n')
    const roundTrip = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(roundTrip)
    const inFiler = AcDbDxfFiler.fromString(dxf, { database: db })
    expect(inFiler.readItem()?.value).toBe('HATCH')
    roundTrip.dxfIn(inFiler)

    expect(roundTrip.gradientName).toBe('CYLINDER')
    expect(roundTrip.gradientAngle).toBeCloseTo(Math.PI / 3)
    expect(roundTrip.gradientShift).toBeCloseTo(0.4)
    expect(roundTrip.gradientStartColor).toBe(0x0000ff)
    expect(roundTrip.gradientEndColor).toBe(0xffff00)
  })

  it('clone creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbHatch())
  })

  it('computes area with holes', () => {
    const hatch = new AcDbHatch()
    hatch.add(createRectLoop(0, 0, 10, 10))
    hatch.add(createRectLoop(2, 2, 6, 6))
    expect(hatch.area).toBeCloseTo(64, 8)
  })

  it('returns boundary grip points for non-associative hatches', () => {
    const hatch = new AcDbHatch()
    hatch.associative = false
    hatch.add(createRectLoop(0, 0, 10, 5))

    const grips = hatch.subGetGripPoints()

    expect(grips).toHaveLength(4)
    expect(grips[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(grips[1]).toMatchObject({ x: 10, y: 0, z: 0 })
    expect(grips[2]).toMatchObject({ x: 10, y: 5, z: 0 })
    expect(grips[3]).toMatchObject({ x: 0, y: 5, z: 0 })
  })

  it('returns no grip points for associative hatches', () => {
    const hatch = new AcDbHatch()
    hatch.associative = true
    hatch.add(createRectLoop(0, 0, 10, 5))

    expect(hatch.subGetGripPoints()).toEqual([])
  })

  it('dxfInFields keeps single-spline paths when fit-count and source-count are both 0', () => {
    // LOGO hatches use edge paths with one spline each, terminated by
    // `97=0` (fit count) then `97=0` (source boundary objects). The native
    // reader must not treat the first 97 as ending the path.
    const db = createWorkingDb()
    const hatch = new AcDbHatch()
    db.tables.blockTable.modelSpace.appendEntity(hatch)

    const dxf = [
      '0',
      'HATCH',
      '5',
      '35B',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbHatch',
      '10',
      '0.0',
      '20',
      '0.0',
      '30',
      '0.0',
      '2',
      'SOLID',
      '70',
      '1',
      '71',
      '0',
      '91',
      '2',
      // Path 1: single closed-ish cubic spline, 0 fit points
      '92',
      '0',
      '93',
      '1',
      '72',
      '4',
      '94',
      '3',
      '73',
      '0',
      '74',
      '1',
      '95',
      '8',
      '96',
      '4',
      '40',
      '0',
      '40',
      '0',
      '40',
      '0',
      '40',
      '0',
      '40',
      '1',
      '40',
      '1',
      '40',
      '1',
      '40',
      '1',
      '10',
      '0',
      '20',
      '0',
      '10',
      '1',
      '20',
      '0',
      '10',
      '1',
      '20',
      '1',
      '10',
      '0',
      '20',
      '1',
      '97',
      '0',
      '97',
      '0',
      // Path 2: another single spline (must not drop path 1 when seeing 92)
      '92',
      '0',
      '93',
      '1',
      '72',
      '4',
      '94',
      '3',
      '73',
      '0',
      '74',
      '1',
      '95',
      '8',
      '96',
      '4',
      '40',
      '0',
      '40',
      '0',
      '40',
      '0',
      '40',
      '0',
      '40',
      '1',
      '40',
      '1',
      '40',
      '1',
      '40',
      '1',
      '10',
      '2',
      '20',
      '2',
      '10',
      '3',
      '20',
      '2',
      '10',
      '3',
      '20',
      '3',
      '10',
      '2',
      '20',
      '3',
      '97',
      '0',
      '97',
      '0',
      '75',
      '0',
      '76',
      '1',
      '0',
      'ENDSEC'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(dxf, { database: db })
    expect(filer.readItem()?.value).toBe('HATCH')
    hatch.dxfIn(filer)

    expect(hatch.associative).toBe(false)
    expect(hatch.isSolidFill).toBe(true)
    expect(hatch.area).toBeGreaterThan(0)
    expect(hatch.geometricExtents.isEmpty()).toBe(false)

    // Two single-spline paths must both survive the dual group-97 trailer.
    // Before the fix, path 1 was dropped when the next `92` arrived.
    const out = new AcDbDxfFiler()
    hatch.dxfOutFields(out)
    expect(out.toString()).toContain('\n91\n2\n')
  })
})

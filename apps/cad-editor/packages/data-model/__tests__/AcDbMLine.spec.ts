import { AcCmColor } from '@mlightcad/common'

import { acdbHostApplicationServices } from '../src/base'
import { AcDbDatabase, AcDbLinetypeTableRecord } from '../src/database'
import { AcGeVector3d } from '@mlightcad/geometry-engine'

import { AcDbMLine, AcDbMLineJustification } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { AcDbMlineStyle } from '../src/object'

const createAciColor = (index: number) => {
  const color = new AcCmColor()
  color.colorIndex = index
  return color
}

const createDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

const createBasicMline = (style: AcDbMlineStyle) => {
  const mline = new AcDbMLine()
  mline.styleName = style.styleName
  mline.styleObjectHandle = style.objectId
  mline.styleCount = 2
  mline.startPosition = { x: 0, y: 0, z: 0 }
  mline.segments = [
    {
      position: { x: 10, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      miterDirection: { x: 0, y: 1, z: 0 },
      elements: [
        {
          parameterCount: 1,
          parameters: [0.5],
          fillCount: 0,
          fillParameters: []
        },
        {
          parameterCount: 1,
          parameters: [-0.5],
          fillCount: 0,
          fillParameters: []
        }
      ]
    },
    {
      position: { x: 20, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
      miterDirection: { x: 0, y: 1, z: 0 },
      elements: [
        {
          parameterCount: 1,
          parameters: [0.5],
          fillCount: 0,
          fillParameters: []
        },
        {
          parameterCount: 1,
          parameters: [-0.5],
          fillCount: 0,
          fillParameters: []
        }
      ]
    }
  ]
  return mline
}

describe('AcDbMLine', () => {
  it('computes osnap points on the reference path', () => {
    const db = createDb()
    const style = new AcDbMlineStyle()
    style.styleName = 'OSNAP_STYLE'
    style.elements = [
      { offset: 0.5, color: createAciColor(3), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(5), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)
    mline.startPosition = { x: 0, y: 0, z: 0 }

    const endPoints: Array<{ x: number; y: number; z: number }> = []
    mline.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      endPoints
    )
    expect(endPoints).toHaveLength(3)
    expect(endPoints[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(endPoints[1]).toMatchObject({ x: 10, y: 0, z: 0 })
    expect(endPoints[2]).toMatchObject({ x: 20, y: 0, z: 0 })

    const midPoints: Array<{ x: number; y: number; z: number }> = []
    mline.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      midPoints
    )
    expect(midPoints).toHaveLength(2)
    expect(midPoints[0]).toMatchObject({ x: 5, y: 0, z: 0 })
    expect(midPoints[1]).toMatchObject({ x: 15, y: 0, z: 0 })

    const nearestPoints: Array<{ x: number; y: number; z: number }> = []
    mline.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      { x: 5, y: 2, z: 0 },
      { x: 0, y: 0, z: 0 },
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0]).toMatchObject({ x: 5, y: 0, z: 0 })

    const perpendicularPoints: Array<{ x: number; y: number; z: number }> = []
    mline.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      { x: 5, y: 2, z: 0 },
      { x: 0, y: 0, z: 0 },
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
    expect(perpendicularPoints[0]).toMatchObject({ x: 5, y: 0, z: 0 })
  })

  it('ensures database default mline style exists when appending a new MLINE', () => {
    const db = createDb()
    db.cmlstyle = 'AUTO_MLINE_STYLE'

    const mline = new AcDbMLine()
    mline.startPosition = { x: 0, y: 0, z: 0 }
    mline.segments = [
      {
        position: { x: 10, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        miterDirection: { x: 0, y: 1, z: 0 },
        elements: []
      }
    ]
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const style = db.objects.mlineStyle.getAt('AUTO_MLINE_STYLE')
    expect(style).toBeDefined()
    expect(style?.styleName).toBe('AUTO_MLINE_STYLE')
    expect(
      style?.elements.map(element => ({
        offset: element.offset,
        colorIndex: element.color.colorIndex,
        lineType: element.lineType
      }))
    ).toEqual([
      { offset: 0.5, colorIndex: 256, lineType: 'ByLayer' },
      { offset: -0.5, colorIndex: 256, lineType: 'ByLayer' }
    ])
    expect(mline.styleName).toBe('AUTO_MLINE_STYLE')
  })

  it('renders fill area when mline style fill is enabled and restores traits', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'FILL_STYLE'
    style.flags = 1
    style.fillColor = createAciColor(1)
    style.elements = [
      { offset: 0.5, color: createAciColor(3), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(5), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const baseColor = new AcCmColor()
    baseColor.colorIndex = 2
    const traits = {
      color: baseColor,
      fillType: {
        solidFill: false,
        patternAngle: 0,
        definitionLines: []
      },
      drawOrder: 0
    }

    const fillTraitSnapshots: Array<{
      colorIndex: number | undefined
      drawOrder: number
      fillTypeSolid: boolean
    }> = []
    const renderer = {
      subEntityTraits: traits,
      area: jest.fn(() => {
        fillTraitSnapshots.push({
          colorIndex: traits.color.colorIndex,
          drawOrder: traits.drawOrder,
          fillTypeSolid: traits.fillType.solidFill
        })
        return { kind: 'area' }
      }),
      lines: jest.fn(() => ({ kind: 'line' })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    const result = mline.subWorldDraw(renderer as never) as unknown as {
      kind: string
      entities: unknown[]
    }

    expect(renderer.area).toHaveBeenCalledTimes(1)
    expect(renderer.lines).toHaveBeenCalledTimes(2)
    expect(renderer.group).toHaveBeenCalledTimes(1)
    expect(result.kind).toBe('group')
    expect(result.entities).toHaveLength(3)

    expect(fillTraitSnapshots).toEqual([
      {
        colorIndex: 1,
        drawOrder: -1,
        fillTypeSolid: true
      }
    ])
    expect(traits.color).toBe(baseColor)
    expect(traits.fillType).toMatchObject({
      solidFill: false,
      patternAngle: 0
    })
    expect(traits.drawOrder).toBe(0)
  })

  it('does not render fill area when fill flag is disabled', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'NO_FILL_STYLE'
    style.flags = 0
    style.fillColor = createAciColor(1)
    style.elements = [
      { offset: 0.5, color: createAciColor(3), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(5), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      lines: jest.fn(() => ({ kind: 'line' })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    const result = mline.subWorldDraw(renderer as never) as unknown as {
      kind: string
      entities: unknown[]
    }

    expect(renderer.area).not.toHaveBeenCalled()
    expect(renderer.lines).toHaveBeenCalledTimes(2)
    expect(result.kind).toBe('group')
    expect(result.entities).toHaveLength(2)
  })

  it('applies per-element linetype from mline style during draw', () => {
    const db = createDb()

    db.tables.linetypeTable.add(
      new AcDbLinetypeTableRecord({
        name: 'CENTER_TEST',
        standardFlag: 0,
        description: 'center test',
        totalPatternLength: 0
      })
    )

    const style = new AcDbMlineStyle()
    style.styleName = 'LINE_TYPE_STYLE'
    style.elements = [
      { offset: 0.5, color: createAciColor(256), lineType: 'CENTER_TEST' },
      { offset: -0.5, color: createAciColor(256), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const originalLineType = {
      type: 'UserSpecified' as const,
      name: 'Continuous',
      standardFlag: 0,
      description: 'Solid line',
      totalPatternLength: 0
    }
    const lineTypeSnapshots: Array<{
      type: string
      name: string
    }> = []
    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        lineType: originalLineType,
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      lines: jest.fn(() => {
        lineTypeSnapshots.push({
          type: renderer.subEntityTraits.lineType.type,
          name: renderer.subEntityTraits.lineType.name
        })
        return { kind: 'line' }
      }),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    mline.subWorldDraw(renderer as never)

    expect(lineTypeSnapshots).toEqual([
      { type: 'UserSpecified', name: 'CENTER_TEST' },
      { type: 'ByLayer', name: 'Continuous' }
    ])
    expect(renderer.subEntityTraits.lineType).toBe(originalLineType)
  })

  it('draws style-driven miter joints and square caps with cap angles', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'MITER_AND_CAP_STYLE'
    style.flags = 2 | 16 | 256
    style.startAngle = 45
    style.endAngle = 45
    style.elements = [
      { offset: 0.5, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(256), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const captured: Array<Array<{ x: number; y: number; z: number }>> = []
    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        lineType: {
          type: 'UserSpecified' as const,
          name: 'Continuous',
          standardFlag: 0,
          description: '',
          totalPatternLength: 0
        },
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      circularArc: jest.fn(() => ({ kind: 'arc' })),
      lines: jest.fn((points: Array<{ x: number; y: number; z: number }>) => {
        captured.push(points.map(point => ({ ...point })))
        return { kind: 'line' }
      }),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    mline.subWorldDraw(renderer as never)

    const normalize = (path: Array<{ x: number; y: number; z: number }>) =>
      path.map(point => ({
        x: Number(point.x.toFixed(6)),
        y: Number(point.y.toFixed(6)),
        z: Number(point.z.toFixed(6))
      }))

    expect(renderer.circularArc).not.toHaveBeenCalled()
    expect(captured).toHaveLength(5)
    expect(normalize(captured[0])).toEqual([
      { x: 0.5, y: 0.5, z: 0 },
      { x: 10, y: 0.5, z: 0 },
      { x: 20.5, y: 0.5, z: 0 }
    ])
    expect(normalize(captured[1])).toEqual([
      { x: -0.5, y: -0.5, z: 0 },
      { x: 10, y: -0.5, z: 0 },
      { x: 19.5, y: -0.5, z: 0 }
    ])
    expect(normalize(captured[2])).toEqual([
      { x: 10, y: 0.5, z: 0 },
      { x: 10, y: -0.5, z: 0 }
    ])
    expect(normalize(captured[3])).toEqual([
      { x: 0.5, y: 0.5, z: 0 },
      { x: -0.5, y: -0.5, z: 0 }
    ])
    expect(normalize(captured[4])).toEqual([
      { x: 20.5, y: 0.5, z: 0 },
      { x: 19.5, y: -0.5, z: 0 }
    ])
  })

  it('draws outer and inner cap arcs from style flags', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'ARC_CAP_STYLE'
    style.flags = 64 | 32 | 1024 | 512
    style.startAngle = 90
    style.endAngle = 90
    style.elements = [
      { offset: 1, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: 0.5, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: -1, color: createAciColor(256), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = new AcDbMLine()
    mline.styleName = style.styleName
    mline.styleObjectHandle = style.objectId
    mline.styleCount = 4
    mline.startPosition = { x: 0, y: 0, z: 0 }
    mline.segments = [
      {
        position: { x: 10, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        miterDirection: { x: 0, y: 1, z: 0 },
        elements: []
      }
    ]
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        lineType: {
          type: 'UserSpecified' as const,
          name: 'Continuous',
          standardFlag: 0,
          description: '',
          totalPatternLength: 0
        },
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      circularArc: jest.fn(() => ({ kind: 'arc' })),
      lines: jest.fn(() => ({ kind: 'line' })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    mline.subWorldDraw(renderer as never)

    expect(renderer.lines).toHaveBeenCalledTimes(4)
    expect(renderer.circularArc).toHaveBeenCalledTimes(4)
  })

  it('respects suppress start caps flag while keeping end caps', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'SUPPRESS_CAP_STYLE'
    style.flags = 16 | 256
    style.elements = [
      { offset: 0.5, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(256), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = new AcDbMLine()
    mline.styleName = style.styleName
    mline.styleObjectHandle = style.objectId
    mline.styleCount = 2
    mline.suppressStartCaps = true
    mline.startPosition = { x: 0, y: 0, z: 0 }
    mline.segments = [
      {
        position: { x: 10, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        miterDirection: { x: 0, y: 1, z: 0 },
        elements: []
      }
    ]
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const captured: Array<Array<{ x: number; y: number; z: number }>> = []
    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        lineType: {
          type: 'UserSpecified' as const,
          name: 'Continuous',
          standardFlag: 0,
          description: '',
          totalPatternLength: 0
        },
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      circularArc: jest.fn(() => ({ kind: 'arc' })),
      lines: jest.fn((points: Array<{ x: number; y: number; z: number }>) => {
        captured.push(points.map(point => ({ ...point })))
        return { kind: 'line' }
      }),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    mline.subWorldDraw(renderer as never)

    expect(renderer.circularArc).not.toHaveBeenCalled()
    expect(captured).toHaveLength(3)
  })

  it('uses style fallback offset with scale when segment element parameters are missing', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'SCALE_FALLBACK_STYLE'
    style.elements = [
      { offset: 0.5, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(256), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = new AcDbMLine()
    mline.styleName = style.styleName
    mline.styleObjectHandle = style.objectId
    mline.styleCount = 2
    mline.scale = 20
    mline.startPosition = { x: 0, y: 0, z: 0 }
    mline.segments = [
      {
        position: { x: 10, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        miterDirection: { x: 0, y: 1, z: 0 },
        elements: []
      }
    ]
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const capturedPaths: Array<Array<{ x: number; y: number; z: number }>> = []
    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      lines: jest.fn((points: Array<{ x: number; y: number; z: number }>) => {
        capturedPaths.push(points.map(point => ({ ...point })))
        return { kind: 'line' }
      }),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    mline.subWorldDraw(renderer as never)

    expect(capturedPaths).toHaveLength(2)
    expect(capturedPaths[0]).toEqual([
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 10, z: 0 }
    ])
    expect(capturedPaths[1]).toEqual([
      { x: 0, y: -10, z: 0 },
      { x: 10, y: -10, z: 0 }
    ])
  })

  it('uses style fallback offset with top justification when segment element parameters are missing', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'TOP_FALLBACK_STYLE'
    style.elements = [
      { offset: 0.5, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(256), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = new AcDbMLine()
    mline.styleName = style.styleName
    mline.styleObjectHandle = style.objectId
    mline.styleCount = 2
    mline.scale = 20
    mline.justification = AcDbMLineJustification.Top
    mline.startPosition = { x: 0, y: 0, z: 0 }
    mline.segments = [
      {
        position: { x: 10, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        miterDirection: { x: 0, y: 1, z: 0 },
        elements: []
      }
    ]
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const capturedPaths: Array<Array<{ x: number; y: number; z: number }>> = []
    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      lines: jest.fn((points: Array<{ x: number; y: number; z: number }>) => {
        capturedPaths.push(points.map(point => ({ ...point })))
        return { kind: 'line' }
      }),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    mline.subWorldDraw(renderer as never)

    expect(capturedPaths).toHaveLength(2)
    expect(capturedPaths[0]).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    ])
    expect(capturedPaths[1]).toEqual([
      { x: 0, y: -20, z: 0 },
      { x: 10, y: -20, z: 0 }
    ])
  })

  it('resolves mline style by styleName even when dictionary key differs', () => {
    const db = createDb()

    const style = new AcDbMlineStyle()
    style.styleName = 'STYLE_THREE_LINES'
    style.elements = [
      { offset: 1, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: 0, color: createAciColor(256), lineType: 'BYLAYER' },
      { offset: -1, color: createAciColor(256), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt('STYLE_KEY_ONLY', style)

    const mline = new AcDbMLine()
    mline.styleName = 'STYLE_THREE_LINES'
    mline.styleObjectHandle = ''
    mline.styleCount = 0
    mline.scale = 1
    mline.startPosition = { x: 0, y: 0, z: 0 }
    mline.segments = [
      {
        position: { x: 10, y: 0, z: 0 },
        direction: { x: 1, y: 0, z: 0 },
        miterDirection: { x: 0, y: 1, z: 0 },
        elements: []
      }
    ]
    db.tables.blockTable.modelSpace.appendEntity(mline)

    const renderer = {
      subEntityTraits: {
        color: new AcCmColor(),
        fillType: {
          solidFill: false,
          patternAngle: 0,
          definitionLines: []
        },
        drawOrder: 0
      },
      area: jest.fn(() => ({ kind: 'area' })),
      lines: jest.fn(() => ({ kind: 'line' })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    mline.subWorldDraw(renderer as never)

    expect(renderer.lines).toHaveBeenCalledTimes(3)
  })

  it('returns geometricExtents and updates when segment positions change', () => {
    const db = createDb()
    const style = new AcDbMlineStyle()
    style.styleName = 'EXTENTS_STYLE'
    style.elements = [
      { offset: 0.5, color: createAciColor(3), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(5), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)
    const before = mline.geometricExtents
    expect(before.isEmpty()).toBe(false)
    expect(before.max.x).toBeCloseTo(20)

    const updatedSegments = mline.segments
    updatedSegments[1].position = { x: 40, y: 10, z: 0 }
    mline.segments = updatedSegments

    const after = mline.geometricExtents
    expect(after.max.x).toBeCloseTo(40)
    expect(after.max.y).toBeGreaterThan(before.max.y)
  })

  it('returns grip points on the reference path', () => {
    const db = createDb()
    const style = new AcDbMlineStyle()
    style.styleName = 'GRIP_STYLE'
    style.elements = [
      { offset: 0.5, color: createAciColor(3), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(5), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)
    const grips = mline.subGetGripPoints()

    expect(grips).toHaveLength(3)
    expect(grips[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(grips[1]).toMatchObject({ x: 10, y: 0, z: 0 })
    expect(grips[2]).toMatchObject({ x: 20, y: 0, z: 0 })
  })

  it('moves only the selected reference-path grip via subMoveGripPointsAt', () => {
    const db = createDb()
    const style = new AcDbMlineStyle()
    style.styleName = 'GRIP_MOVE_STYLE'
    style.elements = [
      { offset: 0.5, color: createAciColor(3), lineType: 'BYLAYER' },
      { offset: -0.5, color: createAciColor(5), lineType: 'BYLAYER' }
    ]
    db.objects.mlineStyle.setAt(style.styleName, style)

    const mline = createBasicMline(style)

    mline.subMoveGripPointsAt([1], new AcGeVector3d(0, 5, 0))

    expect(mline.startPosition).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(mline.segments[0].position).toMatchObject({ x: 10, y: 5, z: 0 })
    expect(mline.segments[1].position).toMatchObject({ x: 20, y: 0, z: 0 })

    mline.subMoveGripPointsAt([0], new AcGeVector3d(2, 0, 0))

    expect(mline.startPosition).toMatchObject({ x: 2, y: 0, z: 0 })
    expect(mline.segments[0].position).toMatchObject({ x: 10, y: 5, z: 0 })
    expect(mline.segments[1].position).toMatchObject({ x: 20, y: 0, z: 0 })
  })
})

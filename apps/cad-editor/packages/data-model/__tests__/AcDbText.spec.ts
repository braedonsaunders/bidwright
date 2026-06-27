import {
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbOsnapMode } from '../src/misc'
import {
  AcDbText,
  AcDbTextHorizontalMode,
  AcDbTextVerticalMode
} from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbText', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbText())
  })
  it('provides default values and dxf type', () => {
    const text = new AcDbText()

    expect(AcDbText.typeName).toBe('Text')
    expect(text.dxfTypeName).toBe('TEXT')
    expect(text.textString).toBe('')
    expect(text.thickness).toBe(1)
    expect(text.height).toBe(0)
    expect(text.position).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(text.rotation).toBe(0)
    expect(text.oblique).toBe(0)
    expect(text.horizontalMode).toBe(AcDbTextHorizontalMode.LEFT)
    expect(text.verticalMode).toBe(AcDbTextVerticalMode.MIDDLE)
    expect(text.styleName).toBe('')
    expect(text.widthFactor).toBe(1)
  })

  it('supports all property getters and setters', () => {
    const text = new AcDbText()
    const sourcePos = new AcGePoint3d(1, 2, 3)
    text.textString = 'Hello'
    text.thickness = 2
    text.height = 3.5
    text.position = sourcePos
    text.rotation = Math.PI / 6
    text.oblique = Math.PI / 12
    text.horizontalMode = AcDbTextHorizontalMode.CENTER
    text.verticalMode = AcDbTextVerticalMode.TOP
    text.styleName = 'Standard'
    text.widthFactor = 0.8

    sourcePos.x = 99

    expect(text.textString).toBe('Hello')
    expect(text.thickness).toBe(2)
    expect(text.height).toBe(3.5)
    expect(text.position).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(text.rotation).toBeCloseTo(Math.PI / 6, 8)
    expect(text.oblique).toBeCloseTo(Math.PI / 12, 8)
    expect(text.horizontalMode).toBe(AcDbTextHorizontalMode.CENTER)
    expect(text.verticalMode).toBe(AcDbTextVerticalMode.TOP)
    expect(text.styleName).toBe('Standard')
    expect(text.widthFactor).toBe(0.8)
  })

  it('returns an AcGeBox3d from geometricExtents', () => {
    const text = new AcDbText()

    expect(text.geometricExtents).toBeInstanceOf(AcGeBox3d)
  })

  it('returns geometricExtents and recomputes when position changes', () => {
    const text = new AcDbText()
    text.textString = 'AB'
    text.height = 2
    text.verticalMode = AcDbTextVerticalMode.BASELINE
    text.position = new AcGePoint3d(10, 20, 0)

    expect(text.geometricExtents.min).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(text.geometricExtents.max.x).toBeCloseTo(14)
    expect(text.geometricExtents.max.y).toBeCloseTo(22)

    text.position = new AcGePoint3d(0, 0, 0)

    expect(text.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(text.geometricExtents.max.x).toBeCloseTo(4)
    expect(text.geometricExtents.max.y).toBeCloseTo(2)
  })

  it('uses baseline-left extents when center alignment lacks alignment point', () => {
    const text = new AcDbText()
    text.textString = 'AB'
    text.height = 2
    text.horizontalMode = AcDbTextHorizontalMode.CENTER
    text.verticalMode = AcDbTextVerticalMode.BASELINE
    text.position = new AcGePoint3d(10, 20, 0)

    expect(text.geometricExtents.min).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(text.geometricExtents.max.x).toBeCloseTo(14)
    expect(text.geometricExtents.max.y).toBeCloseTo(22)
  })

  it('returns insertion osnap point only for insertion mode', () => {
    const text = new AcDbText()
    text.position = new AcGePoint3d(3, 4, 5)
    const snapPoints: AcGePoint3d[] = []

    text.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      snapPoints
    )
    expect(snapPoints).toHaveLength(0)

    text.subGetOsnapPoints(
      AcDbOsnapMode.Insertion,
      new AcGePoint3d(),
      new AcGePoint3d(),
      snapPoints
    )
    expect(snapPoints).toHaveLength(1)
    expect(snapPoints[0]).toMatchObject({ x: 3, y: 4, z: 5 })
  })

  it('returns insertion point as grip point', () => {
    const text = new AcDbText()
    text.position = new AcGePoint3d(3, 4, 5)
    const grips = text.subGetGripPoints()
    expect(grips).toHaveLength(1)
    expect(grips[0]).toBe(text.position)
  })

  it('transforms text with normal scale and rotation updates', () => {
    const text = new AcDbText()
    text.position = new AcGePoint3d(1, 0, 0)
    text.rotation = 0
    text.height = 2
    text.widthFactor = 1
    text.thickness = 4

    const result = text.transformBy(
      new AcGeMatrix3d()
        .makeRotationZ(Math.PI / 2)
        .multiply(new AcGeMatrix3d().makeScale(2, 3, 5))
    )

    expect(result).toBe(text)
    expect(text.position.x).toBeCloseTo(0, 8)
    expect(text.position.y).toBeCloseTo(2, 8)
    expect(text.position.z).toBeCloseTo(0, 8)
    expect(text.rotation).toBeCloseTo(Math.PI / 2, 8)
    expect(text.height).toBeCloseTo(6, 8)
    expect(text.widthFactor).toBeCloseTo(2 / 3, 8)
    expect(text.thickness).toBeCloseTo(20, 8)
  })

  it('moves alignment point together with position via transformBy', () => {
    const text = new AcDbText()
    text.horizontalMode = AcDbTextHorizontalMode.CENTER
    text.verticalMode = AcDbTextVerticalMode.TOP
    text.position = new AcGePoint3d(417.4074308462113, 141.1597540414588, 0)
    text.alignmentPoint = new AcGePoint3d(
      437.6794664300651,
      156.1597540414587,
      0
    )
    const alignmentBefore = text.alignmentPoint.clone()

    text.transformBy(new AcGeMatrix3d().makeTranslation(10, 20, 0))

    expect(text.position.x).toBeCloseTo(427.4074308462113, 6)
    expect(text.position.y).toBeCloseTo(161.1597540414588, 6)
    expect(text.alignmentPoint.x).toBeCloseTo(alignmentBefore.x + 10, 6)
    expect(text.alignmentPoint.y).toBeCloseTo(alignmentBefore.y + 20, 6)
  })

  it('moves alignment point together with position via subMoveGripPointsAt', () => {
    const text = new AcDbText()
    text.horizontalMode = AcDbTextHorizontalMode.CENTER
    text.verticalMode = AcDbTextVerticalMode.TOP
    text.position = new AcGePoint3d(417.4074308462113, 141.1597540414588, 0)
    text.alignmentPoint = new AcGePoint3d(
      437.6794664300651,
      156.1597540414587,
      0
    )
    const alignmentBefore = text.alignmentPoint.clone()

    text.subMoveGripPointsAt([0], new AcGeVector3d(5, -3, 0))

    expect(text.position.x).toBeCloseTo(422.4074308462113, 6)
    expect(text.position.y).toBeCloseTo(138.1597540414588, 6)
    expect(text.alignmentPoint.x).toBeCloseTo(alignmentBefore.x + 5, 6)
    expect(text.alignmentPoint.y).toBeCloseTo(alignmentBefore.y - 3, 6)
  })

  it('keeps rotation and thickness when corresponding transformed axes collapse', () => {
    const text = new AcDbText()
    text.position = new AcGePoint3d(1, 2, 3)
    text.rotation = 0
    text.height = 5
    text.widthFactor = 0.5
    text.thickness = 7

    text.transformBy(new AcGeMatrix3d().makeScale(0, 2, 0))

    expect(text.rotation).toBeCloseTo(0, 8)
    expect(text.height).toBeCloseTo(10, 8)
    expect(text.widthFactor).toBeCloseTo(0.5, 8)
    expect(text.thickness).toBeCloseTo(7, 8)
  })

  it('exposes mutable runtime properties', () => {
    const text = new AcDbText()
    const props = text.properties

    expect(props.type).toBe(text.type)
    const textGroup = props.groups.find(group => group.groupName === 'text')
    const geometryGroup = props.groups.find(
      group => group.groupName === 'geometry'
    )
    expect(textGroup).toBeDefined()
    expect(geometryGroup).toBeDefined()

    const byName = Object.fromEntries(
      [
        ...(textGroup?.properties ?? []),
        ...(geometryGroup?.properties ?? [])
      ].map(p => [p.name, p])
    )

    byName.contents.accessor.set?.('A')
    byName.styleName.accessor.set?.('Standard')
    byName.textHeight.accessor.set?.(9)
    byName.rotation.accessor.set?.(1.25)
    byName.widthFactor.accessor.set?.(0.7)
    byName.oblique.accessor.set?.(0.2)
    byName.positionX.accessor.set?.(10)
    byName.positionY.accessor.set?.(20)
    byName.positionZ.accessor.set?.(30)

    expect(byName.contents.accessor.get()).toBe('A')
    expect(byName.styleName.accessor.get()).toBe('Standard')
    expect(byName.textHeight.accessor.get()).toBe(9)
    expect(byName.rotation.accessor.get()).toBe(1.25)
    expect(byName.widthFactor.accessor.get()).toBe(0.7)
    expect(byName.oblique.accessor.get()).toBe(0.2)
    expect(byName.positionX.accessor.get()).toBe(10)
    expect(byName.positionY.accessor.get()).toBe(20)
    expect(byName.positionZ.accessor.get()).toBe(30)
    expect(text.position).toMatchObject({ x: 10, y: 20, z: 30 })
  })

  it('renders by forwarding MText data and resolved text style', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db
    const text = new AcDbText()
    text.database = db
    text.textString = 'render'
    text.height = 2.2
    text.widthFactor = 0.6
    text.position = new AcGePoint3d(7, 8, 9)
    text.rotation = 1.2
    text.styleName = 'NotExists'

    const giEntity = { objectId: 'R' }
    const renderer = {
      mtext: jest.fn(() => giEntity)
    } as unknown as {
      mtext: jest.Mock
    }

    const result = text.subWorldDraw(renderer as never, true)

    expect(result).toBe(giEntity)
    expect(renderer.mtext).toHaveBeenCalledTimes(1)
    const [mtextData, textStyle, delay] = renderer.mtext.mock.calls[0]
    expect(mtextData).toMatchObject({
      text: 'render',
      height: 2.2,
      width: Infinity,
      widthFactor: 0.6,
      position: text.position,
      rotation: 1.2
    })
    expect(textStyle).toBeDefined()
    expect(delay).toBe(true)
  })

  it('creates a default text style when subWorldDraw runs against an empty table', () => {
    const text = new AcDbText()
    text.database = new AcDbDatabase()
    text.textString = 'fallback'
    const renderer = {
      mtext: jest.fn(() => ({}))
    } as unknown as {
      mtext: jest.Mock
    }

    expect(() => text.subWorldDraw(renderer as never)).not.toThrow()
    expect(renderer.mtext).toHaveBeenCalled()
    expect(text.database.tables.textStyleTable.getAt('Standard')).toBeDefined()
  })

  it('writes expected DXF fields for text entity', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db

    const text = new AcDbText()
    text.database = db
    text.position = new AcGePoint3d(1, 2, 3)
    // Group 11 (alignmentPoint) is now an independent property — set it to
    // a distinct point so the assertion below proves group 11 is sourced
    // from `alignmentPoint`, not echoed from `position`.
    text.alignmentPoint = new AcGePoint3d(7, 8, 9)
    text.thickness = 4
    text.height = 5
    text.textString = 'DXF_TEXT'
    text.rotation = Math.PI / 2
    text.widthFactor = 0.75
    text.oblique = Math.PI / 6
    text.styleName = 'Standard'
    text.horizontalMode = AcDbTextHorizontalMode.RIGHT
    text.verticalMode = AcDbTextVerticalMode.TOP
    db.tables.blockTable.modelSpace.appendEntity(text)

    const filer = new AcDbDxfFiler({ precision: 6 })
    const result = text.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(text)
    expect(dxf).toContain('100\nAcDbText\n')
    expect(dxf).toContain('10\n1\n20\n2\n30\n3\n')
    expect(dxf).toContain('39\n4\n')
    expect(dxf).toContain('40\n5\n')
    expect(dxf).toContain('1\nDXF_TEXT\n')
    expect(dxf).toContain('50\n90\n')
    expect(dxf).toContain('41\n0.75\n')
    expect(dxf).toContain('51\n30\n')
    expect(dxf).toContain('7\nStandard\n')
    expect(dxf).toContain('72\n2\n')
    expect(dxf).toContain('73\n3\n')
    expect(dxf).toContain('11\n7\n21\n8\n31\n9\n')
  })
})

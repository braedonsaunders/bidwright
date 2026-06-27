import { AcCmColor } from '@mlightcad/common'
import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbBlockTableRecord, AcDbDatabase } from '../src/database'
import {
  AcDbAttribute,
  AcDbBlockReference,
  AcDbLine,
  AcDbPoint
} from '../src/entity'
import { AcDbOsnapMode, AcDbRenderingCache } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

const createNamedBlock = (db: AcDbDatabase, name: string) => {
  const block = new AcDbBlockTableRecord()
  block.name = name
  db.tables.blockTable.add(block)
  return block
}

describe('AcDbBlockReference', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbBlockReference('TEST'))
  })

  it('supports public getters/setters and block table record lookup', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'TEST_BLOCK')
    block.origin = new AcGePoint3d(1, 2, 3)

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    expect(AcDbBlockReference.typeName).toBe('BlockReference')
    expect(blockRef.dxfTypeName).toBe('INSERT')

    blockRef.position = { x: 10, y: 20, z: 30 }
    blockRef.rotation = Math.PI / 3
    blockRef.scaleFactors = { x: 2, y: 3, z: 4 }
    blockRef.normal = { x: 0, y: 0, z: 5 }

    expect(blockRef.position).toMatchObject({ x: 10, y: 20, z: 30 })
    expect(blockRef.rotation).toBeCloseTo(Math.PI / 3)
    expect(blockRef.scaleFactors).toMatchObject({ x: 2, y: 3, z: 4 })
    expect(blockRef.normal).toMatchObject({ x: 0, y: 0, z: 1 })
    expect(blockRef.blockName).toBe('TEST_BLOCK')
    expect(blockRef.blockTableRecord).toBe(block)
  })

  it('appends attributes and iterates attributes', () => {
    const db = createDb()
    createNamedBlock(db, 'TEST_BLOCK')

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const attr1 = new AcDbAttribute()
    attr1.tag = 'A1'
    attr1.textString = 'v1'

    const attr2 = new AcDbAttribute()
    attr2.tag = 'A2'
    attr2.textString = 'v2'

    blockRef.appendAttributes(attr1)
    blockRef.appendAttributes(attr2)

    const attrs = [...blockRef.attributeIterator()]
    expect(attrs).toHaveLength(2)
    expect(attrs.map(a => a.tag)).toEqual(['A1', 'A2'])
    expect(attr1.ownerId).toBe(blockRef.objectId)
    expect(attr2.ownerId).toBe(blockRef.objectId)
    expect(attr1.database).toBe(db)
    expect(attr2.database).toBe(db)
  })

  it('propagates database to attributes appended before INSERT is committed', () => {
    const db = createDb()
    createNamedBlock(db, 'TEST_BLOCK')

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    const attr = new AcDbAttribute()
    attr.tag = 'A1'
    blockRef.appendAttributes(attr)

    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    expect(attr.database).toBe(db)
    expect(attr.ownerId).toBe(blockRef.objectId)
  })

  it('computes blockTransform with base-point compensation', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'TEST_BLOCK')
    block.origin = new AcGePoint3d(1, 2, 0)

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    blockRef.position = new AcGePoint3d(10, 20, 0)
    blockRef.scaleFactors = new AcGePoint3d(2, 3, 1)
    blockRef.rotation = Math.PI / 2
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const matrix = blockRef.blockTransform
    const basePointInBlock = new AcGePoint3d(1, 2, 0).applyMatrix4(matrix)
    const plusXFromBase = new AcGePoint3d(2, 2, 0).applyMatrix4(matrix)

    expect(basePointInBlock).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(plusXFromBase.x).toBeCloseTo(10)
    expect(plusXFromBase.y).toBeCloseTo(22)
  })

  it('returns insertion osnap and delegates to sub-entity osnap by gsMark', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'TEST_BLOCK')
    const point = new AcDbPoint()
    point.position = new AcGePoint3d(2, 3, 0)
    block.appendEntity(point)

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    blockRef.position = new AcGePoint3d(10, 20, 0)
    blockRef.scaleFactors = new AcGePoint3d(2, 3, 1)
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const insertionSnaps: AcGePoint3d[] = []
    blockRef.subGetOsnapPoints(
      AcDbOsnapMode.Insertion,
      new AcGePoint3d(),
      new AcGePoint3d(),
      insertionSnaps
    )
    expect(insertionSnaps).toEqual([blockRef.position])

    const subEntitySnaps: AcGePoint3d[] = []
    blockRef.subGetOsnapPoints(
      AcDbOsnapMode.Node,
      new AcGePoint3d(),
      new AcGePoint3d(),
      subEntitySnaps,
      point.objectId
    )
    expect(subEntitySnaps).toHaveLength(1)
    expect(subEntitySnaps[0]).toMatchObject({ x: 14, y: 29, z: 0 })

    const infiniteLoopGuardSnaps: AcGePoint3d[] = []
    blockRef.subGetOsnapPoints(
      AcDbOsnapMode.Node,
      new AcGePoint3d(),
      new AcGePoint3d(),
      infiniteLoopGuardSnaps,
      blockRef.objectId
    )
    expect(infiniteLoopGuardSnaps).toHaveLength(0)
  })

  it('returns insertion point as grip point', () => {
    createDb()
    const insert = new AcDbBlockReference('*Model_Space')
    insert.position = new AcGePoint3d(11, 12, 13)
    const grips = insert.subGetGripPoints()
    expect(grips).toHaveLength(1)
    expect(grips[0]).toBe(insert.position)
  })

  it('transforms pick point to block space before querying sub-entity osnap', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'TEST_BLOCK')
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    block.appendEntity(line)

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    blockRef.position = new AcGePoint3d(10, 0, 0)
    blockRef.rotation = Math.PI / 2
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const nearestSnaps: AcGePoint3d[] = []
    blockRef.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(11, 3, 0),
      new AcGePoint3d(),
      nearestSnaps,
      line.objectId
    )

    expect(nearestSnaps).toHaveLength(1)
    expect(nearestSnaps[0].x).toBeCloseTo(10)
    expect(nearestSnaps[0].y).toBeCloseTo(3)
    expect(nearestSnaps[0].z).toBeCloseTo(0)
  })

  it('collects nearest osnap from block geometry without gsMark', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'TEST_BLOCK')
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    block.appendEntity(line)

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    blockRef.position = new AcGePoint3d(10, 0, 0)
    blockRef.rotation = Math.PI / 2
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const nearestSnaps: AcGePoint3d[] = []
    blockRef.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(11, 3, 0),
      new AcGePoint3d(),
      nearestSnaps
    )

    expect(nearestSnaps).toHaveLength(1)
    expect(nearestSnaps[0].x).toBeCloseTo(10)
    expect(nearestSnaps[0].y).toBeCloseTo(3)
    expect(nearestSnaps[0].z).toBeCloseTo(0)
  })

  it('resolves osnap points through nested block references', () => {
    const db = createDb()
    const leafBlock = createNamedBlock(db, 'LEAF_BLOCK')
    const parentBlock = createNamedBlock(db, 'PARENT_BLOCK')

    const nestedLine = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    leafBlock.appendEntity(nestedLine)

    const nestedRef = new AcDbBlockReference('LEAF_BLOCK')
    nestedRef.position = new AcGePoint3d(2, 0, 0)
    parentBlock.appendEntity(nestedRef)

    const topRef = new AcDbBlockReference('PARENT_BLOCK')
    topRef.position = new AcGePoint3d(10, 0, 0)
    topRef.rotation = Math.PI / 2
    db.tables.blockTable.modelSpace.appendEntity(topRef)

    const nestedSnaps: AcGePoint3d[] = []
    topRef.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      nestedSnaps,
      nestedLine.objectId
    )

    expect(nestedSnaps).toHaveLength(2)
    expect(nestedSnaps[0].x).toBeCloseTo(10)
    expect(nestedSnaps[0].y).toBeCloseTo(2)
    expect(nestedSnaps[1].x).toBeCloseTo(10)
    expect(nestedSnaps[1].y).toBeCloseTo(12)
  })

  it('transforms insertion, scale, rotation, normal and attribute geometry', () => {
    const db = createDb()
    createNamedBlock(db, 'TEST_BLOCK')

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    blockRef.position = new AcGePoint3d(1, 0, 0)
    blockRef.rotation = 0
    blockRef.scaleFactors = new AcGePoint3d(2, 3, 4)

    const attr = new AcDbAttribute()
    attr.database = db
    attr.position = new AcGePoint3d(2, 0, 0)
    blockRef.appendAttributes(attr)
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    expect(
      blockRef.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))
    ).toBe(blockRef)
    expect(blockRef.position.x).toBeCloseTo(0)
    expect(blockRef.position.y).toBeCloseTo(1)
    expect(blockRef.rotation).toBeCloseTo(Math.PI / 2)
    expect(blockRef.scaleFactors.x).toBeCloseTo(2)
    expect(blockRef.scaleFactors.y).toBeCloseTo(3)
    expect(blockRef.scaleFactors.z).toBeCloseTo(4)
    expect(attr.position.x).toBeCloseTo(0)
    expect(attr.position.y).toBeCloseTo(2)
  })

  it('exposes geometry and attribute properties with working accessors', () => {
    const db = createDb()
    createNamedBlock(db, 'TEST_BLOCK')
    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const attr = new AcDbAttribute()
    attr.database = db
    attr.tag = 'TAG_A'
    attr.textString = 'OLD'
    attr.isConst = false
    blockRef.appendAttributes(attr)

    const props = blockRef.properties
    expect(props.type).toBe('BlockReference')

    const geometry = props.groups.find(g => g.groupName === 'geometry')
    const attribute = props.groups.find(g => g.groupName === 'attribute')

    expect(geometry).toBeDefined()
    expect(attribute).toBeDefined()

    const posX = geometry?.properties.find(p => p.name === 'positionX')
    const scaleY = geometry?.properties.find(p => p.name === 'scaleFactorsY')
    const normalZ = geometry?.properties.find(p => p.name === 'normalZ')

    posX?.accessor.set?.(11)
    scaleY?.accessor.set?.(2.5)
    normalZ?.accessor.set?.(3)

    expect(posX?.accessor.get()).toBe(11)
    expect(scaleY?.accessor.get()).toBe(2.5)
    expect(normalZ?.accessor.get()).toBe(3)

    const attrProp = attribute?.properties.find(p => p.name === 'TAG_A')
    expect(attrProp?.editable).toBe(true)
    attrProp?.accessor.set?.('NEW')
    expect(attrProp?.accessor.get()).toBe('NEW')
    expect(attr.textString).toBe('NEW')
  })

  it('computes geometric extents from referenced block geometry and transform', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'TEST_BLOCK')
    block.appendEntity(new AcDbLine({ x: 0, y: 0, z: 0 }, { x: 2, y: 3, z: 0 }))

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    blockRef.position = new AcGePoint3d(5, 6, 0)
    blockRef.scaleFactors = new AcGePoint3d(1, 1, 1)
    blockRef.rotation = 0
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const extents = blockRef.geometricExtents
    expect(extents.min).toMatchObject({ x: 5, y: 6, z: 0 })
    expect(extents.max).toMatchObject({ x: 7, y: 9, z: 0 })
  })

  it('updates geometricExtents when block reference position changes', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'MOVE_BLOCK')
    block.appendEntity(new AcDbLine({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }))

    const blockRef = new AcDbBlockReference('MOVE_BLOCK')
    blockRef.position = new AcGePoint3d(0, 0, 0)
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    expect(blockRef.geometricExtents.max).toMatchObject({ x: 1, y: 1, z: 0 })

    blockRef.position = new AcGePoint3d(5, 10, 0)

    expect(blockRef.geometricExtents.min).toMatchObject({ x: 5, y: 10, z: 0 })
    expect(blockRef.geometricExtents.max).toMatchObject({ x: 6, y: 11, z: 0 })
  })

  it('skips invisible entities inside block definitions when drawing through cache', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'INV_BLK')
    const visibleLine = new AcDbLine(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    )
    const invisibleLine = new AcDbLine(
      { x: 0, y: 5, z: 0 },
      { x: 10, y: 5, z: 0 }
    )
    invisibleLine.visibility = false
    block.appendEntity(visibleLine)
    block.appendEntity(invisibleLine)

    const visibleDrawn = { id: 'visible-line' }
    jest.spyOn(visibleLine, 'worldDraw').mockReturnValue(visibleDrawn as never)
    const invisibleSpy = jest.spyOn(invisibleLine, 'worldDraw')

    AcDbRenderingCache.instance.clear()
    const renderer = {
      group: (items: unknown[]) => ({ items })
    }

    const drawn = AcDbRenderingCache.instance.draw(
      renderer as never,
      block,
      new AcCmColor(),
      [],
      false
    )

    expect(invisibleSpy).not.toHaveBeenCalled()
    expect(drawn).toEqual({ items: [visibleDrawn] })
  })

  it('applies black block color to ByBlock entities inside block definitions', () => {
    const db = createDb()
    const block = createNamedBlock(db, 'BYBLOCK_BLK')
    const line = new AcDbLine({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 })
    line.color.setByBlock()
    block.appendEntity(line)

    const colorsDuringDraw: number[] = []
    jest.spyOn(line, 'worldDraw').mockImplementation(() => {
      colorsDuringDraw.push(line.color.RGB ?? -1)
      return { id: 'line' } as never
    })

    AcDbRenderingCache.instance.clear()
    const renderer = {
      group: (items: unknown[]) => ({ items })
    }

    AcDbRenderingCache.instance.draw(
      renderer as never,
      block,
      new AcCmColor().setRGBValue(0x000000),
      [],
      false
    )

    expect(colorsDuringDraw).toEqual([0x000000])
    expect(line.color.isByBlock).toBe(true)
  })

  it('draws through cache for existing block and empty group for missing block', () => {
    const db = createDb()
    createNamedBlock(db, 'TEST_BLOCK')

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const visibleAttr = new AcDbAttribute()
    visibleAttr.database = db
    visibleAttr.isInvisible = false
    const hiddenAttr = new AcDbAttribute()
    hiddenAttr.database = db
    hiddenAttr.isInvisible = true

    const visibleDrawn = { id: 'visible-attr' }
    jest.spyOn(visibleAttr, 'worldDraw').mockReturnValue(visibleDrawn as never)
    jest
      .spyOn(hiddenAttr, 'worldDraw')
      .mockReturnValue({ id: 'hidden-attr' } as never)

    blockRef.appendAttributes(visibleAttr)
    blockRef.appendAttributes(hiddenAttr)

    const cacheResult = { id: 'block-rendered' }
    const drawSpy = jest
      .spyOn(AcDbRenderingCache.instance, 'draw')
      .mockReturnValue(cacheResult as never)

    const renderer = {
      group: jest.fn((children: unknown[]) => ({ children }))
    }

    expect(blockRef.subWorldDraw(renderer as never)).toBe(cacheResult)
    expect(drawSpy).toHaveBeenCalledTimes(1)
    expect(drawSpy.mock.calls[0][3]).toEqual([visibleDrawn])

    drawSpy.mockRestore()

    const missing = new AcDbBlockReference('NOT_EXIST')
    db.tables.blockTable.modelSpace.appendEntity(missing)
    const empty = missing.subWorldDraw(renderer as never)
    expect(renderer.group).toHaveBeenCalledWith([])
    expect(empty).toEqual({ children: [] })
  })

  it('writes INSERT fields and ATTRIB/SEQEND records in DXF output', () => {
    const db = createDb()
    createNamedBlock(db, 'TEST_BLOCK')

    const blockRef = new AcDbBlockReference('TEST_BLOCK')
    blockRef.position = new AcGePoint3d(1, 2, 3)
    blockRef.rotation = Math.PI / 6
    blockRef.scaleFactors = new AcGePoint3d(2, 3, 4)
    db.tables.blockTable.modelSpace.appendEntity(blockRef)

    const attr = new AcDbAttribute()
    attr.database = db
    attr.tag = 'TAG1'
    attr.textString = 'VALUE1'
    blockRef.appendAttributes(attr)

    const filerFields = new AcDbDxfFiler()
    expect(blockRef.dxfOutFields(filerFields)).toBe(blockRef)
    const fields = filerFields.toString()
    expect(fields).toContain('100\nAcDbBlockReference\n')
    expect(fields).toContain('10\n1\n20\n2\n30\n3\n')
    expect(fields).toContain('2\nTEST_BLOCK\n')
    expect(fields).toContain('41\n2\n')
    expect(fields).toContain('42\n3\n')
    expect(fields).toContain('43\n4\n')
    expect(fields).toContain('50\n29.9999999999999964\n')
    expect(fields).toContain('210\n0\n220\n0\n230\n1\n')

    const filerOut = new AcDbDxfFiler()
    expect(blockRef.dxfOut(filerOut)).toBe(blockRef)
    const out = filerOut.toString()
    expect(out).toContain('\n0\nATTRIB\n')
    expect(out).toContain('\n2\nTAG1\n')
    expect(out).toContain('\n1\nVALUE1\n')
    expect(out).toContain('\n0\nSEQEND\n')

    const withoutAttributes = new AcDbBlockReference('TEST_BLOCK')
    db.tables.blockTable.modelSpace.appendEntity(withoutAttributes)
    const filerWithoutAttrs = new AcDbDxfFiler()
    expect(withoutAttributes.dxfOut(filerWithoutAttrs, true)).toBe(
      withoutAttributes
    )
    expect(filerWithoutAttrs.toString()).not.toContain('\n0\nATTRIB\n')
    expect(filerWithoutAttrs.toString()).not.toContain('\n0\nSEQEND\n')
  })
})

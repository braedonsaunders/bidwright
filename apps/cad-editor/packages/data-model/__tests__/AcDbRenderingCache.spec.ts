jest.mock('../src/database', () => ({
  AcDbBlockTableRecord: class MockBlockTableRecord {}
}))

jest.mock('../src/entity', () => ({
  AcDbEntity: class MockEntity {}
}))

import { AcCmColor } from '@mlightcad/common'
import {
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'

import { AcDbRenderingCache } from '../src/misc/AcDbRenderingCache'

describe('AcDbRenderingCache', () => {
  it('manages cached values and draw fallback', () => {
    const cache = new AcDbRenderingCache()
    expect(AcDbRenderingCache.instance).toBeInstanceOf(AcDbRenderingCache)

    const color = new AcCmColor().setRGBValue(0xff0000)
    const key = cache.createKey('B1', color)
    expect(key).toBe('B1_RGB:255,0,0')

    const foreground = new AcCmColor().setForeground()
    expect(cache.createKey('B1', foreground)).toBe('B1_7')

    const black = new AcCmColor().setRGBValue(0x000000)
    expect(cache.createKey('B1', black)).toBe('B1_RGB:0,0,0')

    const group = {
      fastDeepClone() {
        return { ...this }
      }
    } as any

    const stored = cache.set(key, group)
    expect(stored).not.toBe(group)
    expect(cache.has(key)).toBe(true)
    expect(cache.get(key)).toBeDefined()

    const renderer = {
      group: (items: unknown[]) => ({ items, fastDeepClone: () => ({ items }) })
    } as any

    const drawn = cache.draw(renderer, null as any, new AcCmColor())
    expect(drawn).toBeDefined()

    cache.clear()
    expect(cache.has(key)).toBe(false)
  })

  it('converts WCS attributes to block-local space instead of baking block transform', () => {
    const cache = new AcDbRenderingCache()
    const blockTransform = new AcGeMatrix3d().makeTranslation(10, 20, 0)
    const normal = new AcGeVector3d(0, 0, 1)
    const blockGeometry = { id: 'line' }
    const attribute = {
      id: 'attr',
      applyMatrix: jest.fn(),
      addChild: jest.fn(),
      fastDeepClone: jest.fn()
    }

    const blockGroup = {
      applyMatrix: jest.fn(),
      addChild: jest.fn(),
      fastDeepClone() {
        return { ...this }
      }
    }

    const renderer = {
      group: jest.fn((items: unknown[]) => {
        expect(items).toEqual([blockGeometry])
        return blockGroup
      })
    }

    const blockRecord = {
      name: 'ATTR_BLOCK',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setRGBValue(0xffffff),
          worldDraw: () => blockGeometry
        }
      }
    }

    cache.draw(
      renderer as never,
      blockRecord as never,
      new AcCmColor().setRGBValue(0xffffff),
      [attribute as never],
      false,
      blockTransform,
      normal
    )

    expect(blockGroup.applyMatrix).toHaveBeenCalledTimes(1)
    const appliedTransform = blockGroup.applyMatrix.mock
      .calls[0][0] as AcGeMatrix3d
    expect(appliedTransform.elements).toEqual(blockTransform.elements)
    expect(attribute.applyMatrix).toHaveBeenCalledTimes(1)

    const inverse = attribute.applyMatrix.mock.calls[0][0] as AcGeMatrix3d
    const localPoint = new AcGePoint3d(15, 25, 0).applyMatrix4(inverse)
    expect(localPoint).toMatchObject({ x: 5, y: 5, z: 0 })
    expect(blockGroup.addChild).toHaveBeenCalledWith(attribute)
  })
})
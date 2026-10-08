jest.mock('../src/database', () => ({
  AcDbBlockTableRecord: class MockBlockTableRecord {
    static MODEL_SPACE_NAME = '*Model_Space'
    static PAPER_SPACE_NAME_PREFIX = '*Paper_Space'
    static isModelSapceName(name: string) {
      return name.toLowerCase() === '*model_space'
    }
    static isPaperSapceName(name: string) {
      return name.toLowerCase().startsWith('*paper_space')
    }
  }
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

function createMockGroup(overrides: Record<string, unknown> = {}) {
  const group = {
    applyMatrix: jest.fn(),
    addChild: jest.fn(),
    isCompacted: false,
    compactForInstancing: jest.fn(function (this: {
      isCompacted: boolean
    }) {
      this.isCompacted = true
    }),
    prepareCacheTemplate: jest.fn(),
    dispose: jest.fn(),
    fastDeepClone() {
      return createMockGroup({
        ...overrides,
        isCompacted: group.isCompacted
      })
    },
    ...overrides
  }
  return group
}

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

    const group = createMockGroup()

    const stored = cache.set(key, group as never)
    expect(stored).toBe(group)
    expect(cache.has(key)).toBe(true)
    expect(cache.get(key)).toBeDefined()

    const renderer = {
      group: (items: unknown[]) => ({
        items,
        compactForInstancing: jest.fn(),
        fastDeepClone: () => ({ items })
      })
    } as any

    const drawn = cache.draw(renderer, null as any, new AcCmColor())
    expect(drawn).toBeDefined()

    cache.clear()
    expect(cache.has(key)).toBe(false)
  })

  it('uses color-independent keys when the block has no ByBlock entities', () => {
    const cache = new AcDbRenderingCache()
    const color = new AcCmColor().setRGBValue(0xff0000)
    expect(cache.createCacheKey('Door', color, false)).toBe('Door')
    expect(cache.createCacheKey('Door', color, true)).toBe('Door_RGB:255,0,0')
  })

  it('defers mid-size compact until the first cache hit', () => {
    const cache = new AcDbRenderingCache()
    const blockGroup = createMockGroup({ childCount: 10 })
    const compact = blockGroup.compactForInstancing as jest.Mock

    const renderer = {
      group: jest.fn(() => blockGroup)
    }

    let iterations = 0
    const blockRecord = {
      name: 'WALL',
      newIterator: function* () {
        iterations++
        yield {
          visibility: true,
          color: new AcCmColor().setRGBValue(0xffffff),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }

    cache.draw(
      renderer as never,
      blockRecord as never,
      new AcCmColor().setRGBValue(0xff0000),
      [],
      true
    )

    expect(compact).not.toHaveBeenCalled()
    expect(cache.has('WALL')).toBe(true)
    expect(iterations).toBe(1)

    // Second INSERT hits the template and triggers lazy compact.
    cache.draw(
      renderer as never,
      blockRecord as never,
      new AcCmColor().setRGBValue(0x00ff00),
      [],
      true
    )
    expect(compact).toHaveBeenCalledTimes(1)
    expect(renderer.group).toHaveBeenCalledTimes(1)
    expect(iterations).toBe(1)
  })

  it('compacts huge templates eagerly on cache miss', () => {
    const cache = new AcDbRenderingCache()
    const blockGroup = createMockGroup({ childCount: 40 })
    const compact = blockGroup.compactForInstancing as jest.Mock

    const renderer = {
      group: jest.fn(() => blockGroup)
    }

    const blockRecord = {
      name: 'HUGE',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setRGBValue(0xffffff),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }

    cache.draw(
      renderer as never,
      blockRecord as never,
      new AcCmColor().setRGBValue(0xff0000),
      [],
      true
    )

    expect(compact).toHaveBeenCalledTimes(1)
    expect(cache.has('HUGE')).toBe(true)
  })

  it('skips compactForInstancing for tiny block templates', () => {
    const cache = new AcDbRenderingCache()
    const blockGroup = createMockGroup({ childCount: 1 })
    const compact = blockGroup.compactForInstancing as jest.Mock
    const renderer = {
      group: jest.fn(() => blockGroup)
    }
    const blockRecord = {
      name: 'TINY',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setRGBValue(0xffffff),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }

    cache.draw(
      renderer as never,
      blockRecord as never,
      new AcCmColor().setRGBValue(0xffffff),
      [],
      true
    )
    cache.draw(
      renderer as never,
      blockRecord as never,
      new AcCmColor().setRGBValue(0xffffff),
      [],
      true
    )

    expect(compact).not.toHaveBeenCalled()
    expect(cache.has('TINY')).toBe(true)
  })

  it('keys ByBlock blocks by color and does not share templates', () => {
    const cache = new AcDbRenderingCache()
    const renderer = {
      group: jest.fn(() => createMockGroup())
    }

    const blockRecord = {
      name: 'TITLE',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setByBlock(),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }

    const red = new AcCmColor().setRGBValue(0xff0000)
    const green = new AcCmColor().setRGBValue(0x00ff00)
    cache.draw(renderer as never, blockRecord as never, red, [], true)
    cache.draw(renderer as never, blockRecord as never, green, [], true)

    expect(renderer.group).toHaveBeenCalledTimes(2)
    expect(cache.has(cache.createKey('TITLE', red))).toBe(true)
    expect(cache.has(cache.createKey('TITLE', green))).toBe(true)
    expect(cache.has('TITLE')).toBe(false)
  })

  it('does not cache anonymous *U blocks', () => {
    const cache = new AcDbRenderingCache()
    const renderer = {
      group: jest.fn(() => createMockGroup())
    }
    const blockRecord = {
      name: '*U12',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setRGBValue(0xffffff),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }

    cache.draw(
      renderer as never,
      blockRecord as never,
      new AcCmColor().setRGBValue(0xffffff),
      [],
      true
    )
    expect(cache.has('*U12')).toBe(false)
  })

  it('disposes cached templates on clear', () => {
    const cache = new AcDbRenderingCache()
    const dispose = jest.fn()
    const group = createMockGroup({
      dispose,
      fastDeepClone() {
        return createMockGroup({ dispose })
      }
    })
    cache.set('B1', group as never)
    cache.clear()
    expect(dispose).toHaveBeenCalled()
    expect(cache.has('B1')).toBe(false)
  })

  it('prebuildAll builds color-independent blocks and reports progress', async () => {
    const cache = new AcDbRenderingCache()
    const renderer = {
      group: jest.fn(() => createMockGroup())
    }
    const progress = jest.fn()

    const wall = {
      name: 'WALL',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setRGBValue(0xffffff),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }
    const modelSpace = {
      name: '*Model_Space',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setRGBValue(0xffffff),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }
    const byBlock = {
      name: 'TITLE',
      newIterator: function* () {
        yield {
          visibility: true,
          color: new AcCmColor().setByBlock(),
          worldDraw: () => ({ id: 'line' })
        }
      }
    }
    const empty = {
      name: 'EMPTY',
      newIterator: function* () {
        /* empty */
      }
    }

    await cache.prebuildAll(
      renderer as never,
      [wall, modelSpace, byBlock, empty] as never,
      progress
    )

    expect(cache.has('WALL')).toBe(true)
    expect(cache.has('*Model_Space')).toBe(false)
    expect(cache.has('TITLE')).toBe(false)
    expect(cache.has('EMPTY')).toBe(false)
    expect(progress).toHaveBeenCalledWith(1, 1, 'WALL')
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

    const blockGroup = createMockGroup()

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

  it('evicts least-recently-used entries beyond the entry cap', () => {
    AcDbRenderingCache.lruEnabled = true
    AcDbRenderingCache.lruMaxEntries = 2
    AcDbRenderingCache.lruMaxEstimatedBytes = 0
    const cache = new AcDbRenderingCache()

    const a = createMockGroup()
    const b = createMockGroup()
    cache.set('A', a as never)
    cache.set('B', b as never)
    expect(cache.has('A')).toBe(true)

    cache.set('C', createMockGroup() as never)
    expect(cache.has('A')).toBe(false)
    expect(cache.has('B')).toBe(true)
    expect(a.dispose).toHaveBeenCalled()

    // Touching B makes it most-recent, so C is evicted next instead of B.
    cache.get('B')
    cache.set('D', createMockGroup() as never)
    expect(cache.has('B')).toBe(true)
    expect(cache.has('C')).toBe(false)

    AcDbRenderingCache.lruMaxEntries = 512
  })

  it('evicts by estimated byte budget', () => {
    AcDbRenderingCache.lruMaxEntries = 0
    AcDbRenderingCache.lruMaxEstimatedBytes = 1000
    const cache = new AcDbRenderingCache()

    const big = createMockGroup({
      geometry: { attributes: { position: { array: new Float32Array(1000) } } }
    })
    const small = createMockGroup({
      geometry: { attributes: { position: { array: new Float32Array(10) } } }
    })
    cache.set('big', big as never)
    cache.set('small', small as never)

    expect(cache.has('big')).toBe(false)
    expect(cache.has('small')).toBe(true)

    AcDbRenderingCache.lruMaxEstimatedBytes = 64 * 1024 * 1024
  })

  it('retires compacted templates instead of disposing at eviction', () => {
    AcDbRenderingCache.lruMaxEntries = 1
    AcDbRenderingCache.lruMaxEstimatedBytes = 0
    const cache = new AcDbRenderingCache()

    const compacted = createMockGroup({ isCompacted: true })
    cache.set('C', compacted as never)
    cache.set('X', createMockGroup() as never) // evicts C

    expect(compacted.dispose).not.toHaveBeenCalled()
    expect(cache.has('C')).toBe(false)

    cache.clear() // disposes retired + remaining entries
    expect(compacted.dispose).toHaveBeenCalled()

    AcDbRenderingCache.lruMaxEntries = 512
  })

  it('never evicts while LRU is disabled', () => {
    AcDbRenderingCache.lruEnabled = false
    AcDbRenderingCache.lruMaxEntries = 1
    AcDbRenderingCache.lruMaxEstimatedBytes = 0
    const cache = new AcDbRenderingCache()

    cache.set('A', createMockGroup() as never)
    cache.set('B', createMockGroup() as never)
    expect(cache.has('A')).toBe(true)
    expect(cache.has('B')).toBe(true)

    AcDbRenderingCache.lruEnabled = true
    AcDbRenderingCache.lruMaxEntries = 512
  })
})

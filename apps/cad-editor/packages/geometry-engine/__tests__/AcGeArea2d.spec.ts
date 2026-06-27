import {
  AcGeArea2d,
  AcGeLine2d,
  AcGeLoop2d,
  AcGeMatrix2d,
  AcGePolyline2d
} from '../src'

describe('AcGeArea2d', () => {
  it('computes polygon area', () => {
    const loop = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 2, y: 0 }),
      new AcGeLine2d({ x: 2, y: 0 }, { x: 2, y: 2 }),
      new AcGeLine2d({ x: 2, y: 2 }, { x: 0, y: 2 }),
      new AcGeLine2d({ x: 0, y: 2 }, { x: 0, y: 0 })
    ])

    const area = new AcGeArea2d()
    area.add(loop)

    expect(area.area).toBeCloseTo(4, 6)
  })

  it('covers empty-area and hierarchy branches', () => {
    const empty = new AcGeArea2d()
    expect(empty.outter).toBeUndefined()
    expect(empty.calculateBoundingBox().isEmpty()).toBe(true)

    const outer = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 4, y: 0 }),
      new AcGeLine2d({ x: 4, y: 0 }, { x: 4, y: 4 }),
      new AcGeLine2d({ x: 4, y: 4 }, { x: 0, y: 4 }),
      new AcGeLine2d({ x: 0, y: 4 }, { x: 0, y: 0 })
    ])
    const inner = new AcGePolyline2d(
      [
        { x: 1, y: 1 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 1, y: 2 }
      ],
      true
    )
    const area = new AcGeArea2d()
    area.add(outer)
    area.add(inner)

    const tree = area.buildHierarchy()
    expect(tree.children.length).toBe(1)
    expect(tree.children[0].children.length).toBe(1)
  })

  it('covers area edge paths for empty and degenerate loops', () => {
    const empty = new AcGeArea2d()
    expect(empty.area).toBe(0)

    const area = new AcGeArea2d()
    const degenerate = new AcGePolyline2d(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 }
      ],
      false
    )
    area.add(degenerate)
    expect(area.area).toBe(0)
  })

  it('clones area with independent loops', () => {
    const sourceLoop = new AcGeLoop2d([
      new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 }),
      new AcGeLine2d({ x: 1, y: 0 }, { x: 1, y: 1 }),
      new AcGeLine2d({ x: 1, y: 1 }, { x: 0, y: 1 }),
      new AcGeLine2d({ x: 0, y: 1 }, { x: 0, y: 0 })
    ])
    const area = new AcGeArea2d()
    area.add(sourceLoop)

    const cloned = area.clone()
    expect(cloned).not.toBe(area)
    expect(cloned.loops.length).toBe(1)

    cloned.transform(new AcGeMatrix2d().makeTranslation(5, 0))
    expect((area.loops[0] as AcGeLoop2d).startPoint.x).toBeCloseTo(0, 8)
  })
})

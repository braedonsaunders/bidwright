import { AcGeBox2d } from '../src'

describe('AcGeBox2d', () => {
  it('includes points and computes size', () => {
    const box2 = new AcGeBox2d().setFromPoints([
      { x: 0, y: 0 },
      { x: 2, y: 3 }
    ])

    expect(box2.containsPoint({ x: 1, y: 1 })).toBe(true)
    expect(box2.size.toArray()).toEqual([2, 3])
  })
})

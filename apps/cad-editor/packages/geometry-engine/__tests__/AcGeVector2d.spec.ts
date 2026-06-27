import { AcGePoint2d, AcGeVector2d } from '../src'

describe('AcGeVector2d', () => {
  it('supports basic vector ops', () => {
    const v = new AcGeVector2d(3, 4)
    expect(v.length()).toBe(5)

    const rotated = new AcGeVector2d(1, 0).rotateAround(
      { x: 0, y: 0 },
      Math.PI / 2
    )
    expect(rotated.x).toBeCloseTo(0, 8)
    expect(rotated.y).toBeCloseTo(1, 8)
  })

  it('covers constructor/index guards and iterator', () => {
    expect(new AcGeVector2d([7, 8]).toArray()).toEqual([7, 8])

    const v = new AcGeVector2d(1, 2)
    expect(() => v.setComponent(2, 1)).toThrow('index is out of range: 2')
    expect(() => v.getComponent(2)).toThrow('index is out of range: 2')
    expect([...v]).toEqual([1, 2])
  })

  it('AcGePoint2d flattens points', () => {
    const points = AcGePoint2d.pointArrayToNumberArray([
      new AcGePoint2d(1, 2),
      new AcGePoint2d(3, 4)
    ])
    expect(points).toEqual([1, 2, 3, 4])
  })

  it('AcGePoint2d clone keeps point type and value', () => {
    const point = new AcGePoint2d(3, 5)
    const cloned = point.clone()

    expect(cloned).toBeInstanceOf(AcGePoint2d)
    expect(cloned).not.toBe(point)
    expect(cloned.toArray()).toEqual([3, 5])
  })
})

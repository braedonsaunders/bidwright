import { AcGeLine2d } from '../src'

describe('AcGeLine2d', () => {
  it('computes length', () => {
    const line = new AcGeLine2d({ x: 0, y: 0 }, { x: 3, y: 4 })
    expect(line.length).toBe(5)
  })

  it('nearestPoint projects onto segment', () => {
    const line = new AcGeLine2d({ x: 0, y: 0 }, { x: 10, y: 0 })
    const near = line.nearestPoint({ x: 4, y: 3 })
    expect(near.x).toBeCloseTo(4, 6)
    expect(near.y).toBeCloseTo(0, 6)
  })
})

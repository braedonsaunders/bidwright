import { AcGeLine3d } from '../src'

describe('Test AcGeLine3d', () => {
  it('computes length correctly', () => {
    const line1 = new AcGeLine3d({ x: 1, y: 1, z: 1 }, { x: 1, y: 0, z: 1 })
    expect(line1.length).toBe(1)
  })

  it('covers atLength(true) and extend(inversed=true) branches', () => {
    const line = new AcGeLine3d({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 })
    const p = line.atLength(1, true)
    expect(p.x).toBeCloseTo(1, 8)

    line.extend(1, true)
    expect(line.startPoint.x).toBeCloseTo(-1, 8)
  })
})

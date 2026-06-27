import { AcGeTol } from '../src'

describe('AcGeTol', () => {
  it('compares values and points with tolerance', () => {
    const tol = new AcGeTol()
    expect(tol.equalPoint2d({ x: 1, y: 1 }, { x: 1 + 1e-9, y: 1 })).toBe(true)
    expect(AcGeTol.equal(1, 1 + 1e-9)).toBe(true)
    expect(AcGeTol.equalToZero(1e-12)).toBe(true)
    expect(AcGeTol.great(2, 1)).toBe(true)
    expect(AcGeTol.great(1, 2)).toBe(false)
    expect(AcGeTol.less(1, 2)).toBe(true)
    expect(AcGeTol.less(2, 1)).toBe(false)
    expect(AcGeTol.isPositive(1e-5)).toBe(true)
    expect(AcGeTol.isPositive(1e-7)).toBe(false)
    expect(AcGeTol.isNonPositive(1e-7)).toBe(true)
    expect(AcGeTol.isNonPositive(1e-5)).toBe(false)
  })

  it('clones tolerance values', () => {
    const tol = new AcGeTol()
    tol.equalPointTol = 1e-3
    tol.equalVectorTol = 1e-4

    const cloned = tol.clone()
    cloned.equalPointTol = 2e-3

    expect(cloned).not.toBe(tol)
    expect(cloned.equalVectorTol).toBe(1e-4)
    expect(tol.equalPointTol).toBe(1e-3)
  })
})

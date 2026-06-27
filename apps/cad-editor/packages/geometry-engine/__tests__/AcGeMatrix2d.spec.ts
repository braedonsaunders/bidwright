import { AcGeMatrix2d, AcGePoint2d } from '../src'

describe('AcGeMatrix2d', () => {
  it('translates points', () => {
    const m2 = new AcGeMatrix2d().makeTranslation(2, 5)
    const p2 = new AcGePoint2d(1, 1).applyMatrix2d(m2)

    expect(p2.toArray()).toEqual([3, 6])
  })

  it('supports constructor with explicit elements', () => {
    const m2 = new AcGeMatrix2d(1, 2, 3, 4, 5, 6, 7, 8, 9)
    expect(m2.toArray()).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9])
  })
})

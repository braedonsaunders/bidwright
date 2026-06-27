import { AcDbObjectIterator } from '../src/misc/AcDbObjectIterator'

describe('AcDbObjectIterator', () => {
  it('iterates map values and reports completion', () => {
    const records = new Map<string, number>([
      ['a', 1],
      ['b', 2]
    ])
    const iterator = new AcDbObjectIterator(records)

    expect(iterator.count).toBe(2)
    expect(iterator.toArray()).toEqual([1, 2])
    expect(iterator[Symbol.iterator]()).toBe(iterator)

    expect(iterator.next()).toEqual({ value: 1, done: false })
    expect(iterator.next()).toEqual({ value: 2, done: false })
    expect(iterator.next()).toEqual({ value: null, done: true })
  })
})

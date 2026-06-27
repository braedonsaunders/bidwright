import { clone, deepClone, defaults, has, isEmpty, isEqual } from '../src'

describe('AcCmLodashUtils', () => {
  it('clone handles primitives, arrays and objects', () => {
    expect(clone(1)).toBe(1)
    const arr = [1, 2]
    const clonedArr = clone(arr)
    expect(clonedArr).toEqual(arr)
    expect(clonedArr).not.toBe(arr)

    const obj = { a: 1 }
    const clonedObj = clone(obj)
    expect(clonedObj).toEqual(obj)
    expect(clonedObj).not.toBe(obj)
  })

  it('deepClone handles Date, RegExp, arrays and nested objects', () => {
    const value = {
      d: new Date('2020-01-01T00:00:00.000Z'),
      r: /ab/gi,
      a: [{ x: 1 }]
    }

    const copied = deepClone(value)
    expect(copied).toEqual(value)
    expect(copied).not.toBe(value)
    expect(copied.d).not.toBe(value.d)
    expect(copied.r).not.toBe(value.r)
    expect(copied.a[0]).not.toBe(value.a[0])
  })

  it('defaults/has/isEmpty/isEqual cover major branches', () => {
    const target: Record<string, unknown> = { a: 1, b: undefined }
    defaults(target, { b: 2 }, { c: 3 })
    expect(target).toEqual({ a: 1, b: 2, c: 3 })

    expect(has(target, 'a')).toBe(true)
    expect(has(target, 'x')).toBe(false)

    expect(isEmpty(null)).toBe(true)
    expect(isEmpty('')).toBe(true)
    expect(isEmpty([])).toBe(true)
    expect(isEmpty(new Map())).toBe(true)
    expect(isEmpty(new Set())).toBe(true)
    expect(isEmpty({})).toBe(true)
    expect(isEmpty('x')).toBe(false)
    expect(isEmpty([1])).toBe(false)
    expect(isEmpty({ x: 1 })).toBe(false)
    expect(isEmpty(1)).toBe(false)

    expect(isEqual(1, 1)).toBe(true)
    expect(isEqual(null, undefined)).toBe(false)
    expect(isEqual(1, '1')).toBe(false)
    expect(isEqual([1, 2], [1, 2])).toBe(true)
    expect(isEqual([1], [1, 2])).toBe(false)
    expect(isEqual([1, 2], [1, 3])).toBe(false)
    expect(isEqual([1], { 0: 1 })).toBe(false)
    expect(isEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(isEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(isEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

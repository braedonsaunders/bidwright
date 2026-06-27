import { AcDbResultBuffer } from '../src/base/AcDbResultBuffer'

describe('AcDbResultBuffer', () => {
  it('supports collection operations and clone isolation', () => {
    const initial = [
      { code: 1, value: 'a' },
      { code: 70, value: 2 }
    ]
    const buffer = new AcDbResultBuffer(initial)

    expect(buffer.length).toBe(2)
    expect(buffer.at(0)).toEqual({ code: 1, value: 'a' })
    expect(buffer.at(99)).toBeUndefined()

    buffer.add({ code: 2, value: 'b' })
    buffer.addRange([{ code: 3, value: true }])
    expect(buffer.length).toBe(4)

    const arr = buffer.toArray()
    arr[0].value = 'changed'
    expect(buffer.at(0)?.value).toBe('a')

    const cloned = buffer.clone()
    cloned.add({ code: 4, value: 'c' })
    expect(cloned.length).toBe(5)
    expect(buffer.length).toBe(4)

    const iterated = [...buffer]
    expect(iterated.length).toBe(4)

    buffer.clear()
    expect(buffer.length).toBe(0)
  })
})

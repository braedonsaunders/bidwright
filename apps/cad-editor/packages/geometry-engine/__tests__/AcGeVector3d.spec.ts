import { AcGeMatrix3d, AcGePoint3d, AcGeQuaternion, AcGeVector3d } from '../src'

describe('AcGeVector3d', () => {
  it('supports matrix and quaternion operations', () => {
    const vec = new AcGeVector3d(1, 0, 0)
    const q = new AcGeQuaternion().setFromAxisAngle(
      AcGeVector3d.Z_AXIS,
      Math.PI / 2
    )
    vec.applyQuaternion(q)

    expect(vec.x).toBeCloseTo(0, 8)
    expect(vec.y).toBeCloseTo(1, 8)

    const matrix = new AcGeMatrix3d().makeTranslation(2, 3, 4)
    const p = new AcGePoint3d(1, 1, 1).applyMatrix4(matrix)
    expect(p.toArray()).toEqual([3, 4, 5])

    const flattened = AcGePoint3d.pointArrayToNumberArray([
      new AcGePoint3d(1, 2, 3),
      new AcGePoint3d(4, 5, 6)
    ])
    expect(flattened).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('covers constructor/index guards, angle edge cases and iterator', () => {
    expect(new AcGeVector3d([1, 2, 3]).toArray()).toEqual([1, 2, 3])
    expect(() => new (AcGeVector3d as any)(1, 2)).toThrow()

    const v = new AcGeVector3d(1, 2, 3)
    expect(() => v.setComponent(3, 1)).toThrow('index is out of range: 3')
    expect(() => v.getComponent(3)).toThrow('index is out of range: 3')

    expect(
      new AcGeVector3d(0, 0, 0).angleTo(new AcGeVector3d(1, 0, 0))
    ).toBeCloseTo(Math.PI / 2, 8)

    const a = new AcGeVector3d(1, 0, 0)
    const dotSpy = jest.spyOn(a, 'dot').mockReturnValue(2)
    expect(a.angleTo(new AcGeVector3d(1, 0, 0))).toBeCloseTo(0, 8)
    dotSpy.mockRestore()

    expect([...new AcGeVector3d(4, 5, 6)]).toEqual([4, 5, 6])
  })

  it('AcGePoint3d clone keeps point type and value', () => {
    const point = new AcGePoint3d(7, 8, 9)
    const cloned = point.clone()

    expect(cloned).toBeInstanceOf(AcGePoint3d)
    expect(cloned).not.toBe(point)
    expect(cloned.toArray()).toEqual([7, 8, 9])
  })
})

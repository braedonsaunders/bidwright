import { AcGeEuler, AcGeMatrix3d, AcGeQuaternion } from '../src'

describe('AcGeEuler', () => {
  it('round-trips via quaternion', () => {
    const euler = new AcGeEuler(Math.PI / 2, 0, 0, 'XYZ')
    const q = new AcGeQuaternion().setFromEuler(euler)
    const roundtrip = new AcGeEuler().setFromQuaternion(q, 'XYZ')

    expect(roundtrip.x).toBeCloseTo(Math.PI / 2, 6)
  })

  it('covers matrix-order branches and iterator', () => {
    const orders = ['XYZ', 'YXZ', 'ZXY', 'ZYX', 'YZX', 'XZY']
    const e = new AcGeEuler()
    for (const order of orders) {
      const q = new AcGeQuaternion().setFromEuler(
        new AcGeEuler(0.3, -0.2, 0.1, order)
      )
      expect(e.setFromQuaternion(q, order)).toBe(e)
      expect(e.order).toBe(order)
    }

    // singular branches for each order
    expect(
      e.setFromRotationMatrix(
        new AcGeMatrix3d().makeRotationY(Math.PI / 2),
        'XYZ'
      )
    ).toBe(e)
    expect(
      e.setFromRotationMatrix(
        new AcGeMatrix3d().makeRotationX(Math.PI / 2),
        'YXZ'
      )
    ).toBe(e)
    expect(
      e.setFromRotationMatrix(
        new AcGeMatrix3d().makeRotationX(Math.PI / 2),
        'ZXY'
      )
    ).toBe(e)
    expect(
      e.setFromRotationMatrix(
        new AcGeMatrix3d().makeRotationY(Math.PI / 2),
        'ZYX'
      )
    ).toBe(e)
    expect(
      e.setFromRotationMatrix(
        new AcGeMatrix3d().makeRotationZ(Math.PI / 2),
        'YZX'
      )
    ).toBe(e)
    expect(
      e.setFromRotationMatrix(
        new AcGeMatrix3d().makeRotationZ(Math.PI / 2),
        'XZY'
      )
    ).toBe(e)

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    e.setFromRotationMatrix(new AcGeMatrix3d().identity(), 'BAD')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()

    let changed = 0
    e._onChange(() => {
      changed++
    })
    e.setFromRotationMatrix(new AcGeMatrix3d().identity(), 'XYZ', false)
    expect(changed).toBe(0)

    const values = [...e]
    expect(values).toHaveLength(4)
  })
})

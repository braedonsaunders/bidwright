import { AcGeEuler, AcGeMatrix3d, AcGeQuaternion, AcGeVector3d } from '../src'

describe('AcGeQuaternion', () => {
  it('slerp result remains normalized', () => {
    const q = new AcGeQuaternion(0, 0, 0, 1)
    const target = new AcGeQuaternion().set(0.5, 0.5, 0.5, 0.5).normalize()

    const midway = q.slerp(target, 0.5)
    expect(midway.length()).toBeCloseTo(1, 8)
  })

  it('covers static helpers and branchy quaternion operations', () => {
    const out = [0, 0, 0, 0]
    AcGeQuaternion.slerpFlat(out, 0, [1, 2, 3, 4], 0, [5, 6, 7, 8], 0, 0)
    expect(out).toEqual([1, 2, 3, 4])

    AcGeQuaternion.slerpFlat(out, 0, [1, 2, 3, 4], 0, [5, 6, 7, 8], 0, 1)
    expect(out).toEqual([5, 6, 7, 8])

    // tiny-angle path that falls back to lerp and normalization
    AcGeQuaternion.slerpFlat(out, 0, [0, 0, 0, 1], 0, [1e-12, 0, 0, 1], 0, 0.5)
    expect(out[3]).toBeGreaterThan(0)

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    new AcGeQuaternion().setFromEuler(new AcGeEuler(0.1, 0.2, 0.3, 'BAD'))
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()

    // setFromRotationMatrix branches
    expect(
      new AcGeQuaternion().setFromRotationMatrix(
        new AcGeMatrix3d().set(2, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)
      )
    ).toBeInstanceOf(AcGeQuaternion)
    expect(
      new AcGeQuaternion().setFromRotationMatrix(
        new AcGeMatrix3d().set(-1, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)
      )
    ).toBeInstanceOf(AcGeQuaternion)
    expect(
      new AcGeQuaternion().setFromRotationMatrix(
        new AcGeMatrix3d().set(-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1)
      )
    ).toBeInstanceOf(AcGeQuaternion)

    // opposite-direction branches in setFromUnitVectors
    expect(
      new AcGeQuaternion().setFromUnitVectors(
        new AcGeVector3d(1, 0, 0),
        new AcGeVector3d(-1, 0, 0)
      )
    ).toBeInstanceOf(AcGeQuaternion)
    expect(
      new AcGeQuaternion().setFromUnitVectors(
        new AcGeVector3d(0, 0, 1),
        new AcGeVector3d(0, 0, -1)
      )
    ).toBeInstanceOf(AcGeQuaternion)

    // zero-length normalize branch
    const normalizedZero = new AcGeQuaternion(0, 0, 0, 0).normalize()
    expect(normalizedZero.w).toBe(1)

    const qa = new AcGeQuaternion(0, 0, 0, 1)
    const qbNeg = new AcGeQuaternion(0, 0, 0, -1)
    expect(qa.clone().slerp(qbNeg, 0.3).w).toBeCloseTo(1, 8) // cosHalfTheta < 0 then >=1

    const qbNear = new AcGeQuaternion(0, 0, 0, 0.9999999999999999)
    const qNear = qa.clone()
    const normalizeSpy = jest.spyOn(qNear, 'normalize')
    qNear.slerp(qbNear, 0.5) // sqrSin<=EPS branch calls normalize()
    expect(normalizeSpy).toHaveBeenCalled()
    normalizeSpy.mockRestore()

    const iterValues = [...new AcGeQuaternion(1, 2, 3, 4)]
    expect(iterValues).toEqual([1, 2, 3, 4])
  })
})

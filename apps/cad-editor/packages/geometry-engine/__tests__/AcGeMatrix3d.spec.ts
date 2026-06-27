import { AcGeMatrix3d, AcGeQuaternion, AcGeVector3d } from '../src'

describe('AcGeMatrix3d', () => {
  it('composes and decomposes transforms', () => {
    const q = new AcGeQuaternion().setFromAxisAngle(
      AcGeVector3d.Z_AXIS,
      Math.PI / 2
    )
    const composed = new AcGeMatrix3d().compose(
      new AcGeVector3d(10, 0, 0),
      q,
      new AcGeVector3d(2, 2, 2)
    )

    const position = new AcGeVector3d()
    const rotation = new AcGeQuaternion()
    const scale = new AcGeVector3d()
    composed.decompose(position, rotation, scale)

    expect(position.x).toBeCloseTo(10, 8)
    expect(scale.x).toBeCloseTo(2, 8)
    expect(rotation.length()).toBeCloseTo(1, 8)
  })

  it('creates translation matrices from vectors and numbers', () => {
    const fromVector = AcGeMatrix3d.makeTranslation({ x: 1, y: 2, z: 0 })
    expect(fromVector.elements[12]).toBe(1)
    expect(fromVector.elements[13]).toBe(2)
    expect(fromVector.elements[14]).toBe(0)

    const fromNumbers = AcGeMatrix3d.makeTranslation(3, -2, 5)
    expect(fromNumbers.elements[12]).toBe(3)
    expect(fromNumbers.elements[13]).toBe(-2)
    expect(fromNumbers.elements[14]).toBe(5)
  })

  it('covers constructor and branch-heavy helpers', () => {
    const constructed = new AcGeMatrix3d(
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      9,
      10,
      11,
      12,
      13,
      14,
      15,
      16
    )
    expect(constructed.elements[0]).toBe(1)

    const fromExtrusionA = new AcGeMatrix3d().setFromExtrusionDirection(
      new AcGeVector3d(0, 0, -1)
    )
    expect(fromExtrusionA.elements[10]).toBeCloseTo(-1, 8)

    const fromExtrusionB = new AcGeMatrix3d().setFromExtrusionDirection(
      new AcGeVector3d(0.2, 0.2, 0.95).normalize()
    )
    expect(fromExtrusionB.determinant()).not.toBe(0)

    const lookAtDegenerate = new AcGeMatrix3d().lookAt(
      new AcGeVector3d(1, 1, 1),
      new AcGeVector3d(1, 1, 1),
      new AcGeVector3d(0, 0, 1)
    )
    expect(lookAtDegenerate.elements[0]).toBeDefined()

    const positioned = new AcGeMatrix3d().setPosition(
      new AcGeVector3d(7, 8, 9),
      0,
      0
    )
    expect(positioned.elements[12]).toBe(7)
    expect(positioned.elements[13]).toBe(8)
    expect(positioned.elements[14]).toBe(9)

    const singular = new AcGeMatrix3d().makeScale(1, 0, 1).invert()
    expect(singular.elements.every(v => v === 0)).toBe(true)
  })
})

import { AcGeBox3d, AcGeMatrix3d, AcGePlane, AcGeVector3d } from '../src'

describe('AcGeBox3d', () => {
  it('supports setFromPoints and transform', () => {
    const box3 = new AcGeBox3d().setFromPoints([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 2, z: 2 }
    ])

    const shifted = box3
      .clone()
      .applyMatrix4(new AcGeMatrix3d().makeTranslation(1, 0, 0))
    expect(shifted.min.x).toBe(1)
    expect(shifted.max.x).toBe(3)
  })

  it('covers intersectsPlane positive normal branches', () => {
    const box = new AcGeBox3d({ x: -1, y: -2, z: -3 }, { x: 3, y: 4, z: 5 })
    const plane = new AcGePlane(new AcGeVector3d(1, 2, 3).normalize(), -1)
    expect(box.intersectsPlane(plane)).toBe(true)
  })
})

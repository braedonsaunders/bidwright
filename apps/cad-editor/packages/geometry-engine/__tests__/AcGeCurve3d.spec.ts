import { AcGeBox3d, AcGeMatrix3d, AcGePoint3d } from '../src'
import { AcGeCurve3d } from '../src/geometry/AcGeCurve3d'

class TestCurve3d extends AcGeCurve3d {
  get closed() {
    return false
  }

  get startPoint() {
    return new AcGePoint3d(0, 0, 0)
  }

  get endPoint() {
    return new AcGePoint3d(1, 0, 0)
  }

  get length() {
    return 1
  }

  transform(_matrix: AcGeMatrix3d) {
    return this
  }

  clone(): this {
    return new TestCurve3d() as this
  }

  protected calculateBoundingBox() {
    return new AcGeBox3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })
  }
}

describe('AcGeCurve3d', () => {
  it('exposes abstract curve contract through subclass', () => {
    const curve3d = new TestCurve3d()
    expect(curve3d.startPoint.x).toBe(0)
    expect(curve3d.endPoint.x).toBe(1)
    expect(curve3d.length).toBe(1)
  })
})

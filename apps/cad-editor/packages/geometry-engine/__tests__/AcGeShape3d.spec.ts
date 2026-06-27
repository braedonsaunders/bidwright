import { AcGeBox3d, AcGeMatrix3d } from '../src'
import { AcGeShape3d } from '../src/geometry/AcGeShape3d'

class TestShape3d extends AcGeShape3d {
  clone(): this {
    return new TestShape3d() as this
  }

  transform(_matrix: AcGeMatrix3d) {
    return this
  }

  protected calculateBoundingBox() {
    return new AcGeBox3d({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 })
  }
}

describe('AcGeShape3d', () => {
  it('exposes shared shape behavior through subclass', () => {
    const shape3d = new TestShape3d()
    expect(shape3d.box.max.z).toBe(1)
    shape3d.translate({ x: 1, y: 2, z: 3 })
    expect(shape3d.boundingBoxNeedUpdate).toBe(false)
  })
})

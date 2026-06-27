import { AcGeBox2d, AcGeMatrix2d, AcGePoint2d } from '../src'
import { AcGeCurve2d } from '../src/geometry/AcGeCurve2d'

class TestCurve2d extends AcGeCurve2d {
  get closed() {
    return false
  }

  getPoint(t: number) {
    return new AcGePoint2d(t, 0)
  }

  transform(_matrix: AcGeMatrix2d) {
    return this
  }

  clone(): this {
    return new TestCurve2d() as this
  }

  protected calculateBoundingBox() {
    return new AcGeBox2d({ x: 0, y: 0 }, { x: 1, y: 0 })
  }
}

describe('AcGeCurve2d', () => {
  it('exposes shared curve behavior through subclass', () => {
    const curve2d = new TestCurve2d()
    expect(curve2d.length).toBeCloseTo(1, 8)
    expect(curve2d.getTangentAt(0.5).x).toBeCloseTo(1, 8)
    expect(curve2d.box.min.x).toBe(0)
    expect(curve2d.boundingBoxNeedUpdate).toBe(false)
  })

  it('covers base-class helpers and edge branches', () => {
    const baseLike = Object.create(AcGeCurve2d.prototype) as AcGeCurve2d
    expect(() => baseLike.getPoint(0.5)).toThrow(
      'AcGeCurve2d: .getPoint() not implemented.'
    )

    const curve2d = new TestCurve2d()
    expect(curve2d.getPointAt(0.3).x).toBeCloseTo(0.3, 8)
    expect(curve2d.getPoints(2).map(p => p.x)).toEqual([0, 0.5, 1])
    expect(curve2d.getSpacedPoints(2).map(p => p.x)).toEqual([0, 0.5, 1])
    expect(curve2d.getLengths(4)).toEqual([0, 0.25, 0.5, 0.75, 1])

    // distance branch
    expect(curve2d.getUtoTmapping(0, 0.75)).toBeCloseTo(0.75, 8)
    // binary-search exact hit branch
    expect(curve2d.getUtoTmapping(0.5)).toBeCloseTo(0.5, 8)
    // interpolation branch
    expect(curve2d.getUtoTmapping(0.1234)).toBeCloseTo(0.1234, 4)

    // t-clamping branches near start/end
    expect(curve2d.getTangent(0).x).toBeCloseTo(1, 8)
    expect(curve2d.getTangent(1).x).toBeCloseTo(1, 8)
  })
})

import {
  acGeClosedPolygonArea2d,
  acGeClosedPolygonArea3d,
  acGePolygonArea2d,
  acGePolygonArea3d
} from '../src/util/AcGePolygonAreaUtil'

describe('AcGePolygonAreaUtil', () => {
  it('computes 2D polygon area', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 }
    ]
    expect(acGePolygonArea2d(square)).toBeCloseTo(4, 8)
    expect(acGeClosedPolygonArea2d(square)).toBeCloseTo(4, 8)
  })

  it('returns 0 for open or degenerate loops', () => {
    expect(acGeClosedPolygonArea2d([])).toBe(0)
    expect(
      acGeClosedPolygonArea2d([
        { x: 0, y: 0 },
        { x: 1, y: 0 }
      ])
    ).toBe(0)
  })

  it('computes 3D planar polygon area', () => {
    const triangle = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 0, y: 3, z: 0 }
    ]
    expect(acGePolygonArea3d(triangle)).toBeCloseTo(6, 8)
    expect(acGeClosedPolygonArea3d(triangle)).toBeCloseTo(6, 8)
  })
})

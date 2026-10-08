import {
  acgeClosedPolygonArea2d,
  acgeClosedPolygonArea3d,
  acgePolygonArea2d,
  acgePolygonArea3d
} from '../src/util/AcGePolygonAreaUtil'

describe('AcGePolygonAreaUtil', () => {
  it('computes 2D polygon area', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 }
    ]
    expect(acgePolygonArea2d(square)).toBeCloseTo(4, 8)
    expect(acgeClosedPolygonArea2d(square)).toBeCloseTo(4, 8)
  })

  it('returns 0 for open or degenerate loops', () => {
    expect(acgeClosedPolygonArea2d([])).toBe(0)
    expect(
      acgeClosedPolygonArea2d([
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
    expect(acgePolygonArea3d(triangle)).toBeCloseTo(6, 8)
    expect(acgeClosedPolygonArea3d(triangle)).toBeCloseTo(6, 8)
  })
})

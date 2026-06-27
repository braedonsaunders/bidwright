import { AcGeGeometryUtil, AcGePoint3dLike } from '../src'

describe('AcGeGeometryUtil', () => {
  it('converts 2d points to 3d points with default or preserved z', () => {
    expect(AcGeGeometryUtil.point2dToPoint3d({ x: 1, y: 2 })).toEqual({
      x: 1,
      y: 2,
      z: 0
    })
    expect(
      AcGeGeometryUtil.point2dToPoint3d({ x: 3, y: 4, z: 5 } as AcGePoint3dLike)
    ).toEqual({
      x: 3,
      y: 4,
      z: 5
    })
  })

  it('handles empty, disjoint and duplicate-point polygons', () => {
    expect(AcGeGeometryUtil.isPolygonIntersect([], [])).toBe(false)

    const squareA = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ]
    const squareFar = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 11, y: 11 },
      { x: 10, y: 11 }
    ]
    expect(AcGeGeometryUtil.isPolygonIntersect(squareA, squareFar)).toBe(false)

    const withDuplicate = [
      { x: -1, y: -1 },
      { x: -1, y: -1 },
      { x: 2, y: -1 },
      { x: 2, y: 2 },
      { x: -1, y: 2 }
    ]
    expect(AcGeGeometryUtil.isPolygonIntersect(withDuplicate, squareA)).toBe(
      false
    )

    const sameBoxNoContainmentA = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 }
    ]
    const sameBoxNoContainmentB = [
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 2 }
    ]
    expect(
      AcGeGeometryUtil.isPolygonIntersect(
        sameBoxNoContainmentA,
        sameBoxNoContainmentB
      )
    ).toBe(false)
  })
})

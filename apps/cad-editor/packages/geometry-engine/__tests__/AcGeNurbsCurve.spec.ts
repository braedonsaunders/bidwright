import { AcGeNurbsCurve } from '../src'

describe('AcGeNurbsCurve', () => {
  it('samples points along curve', () => {
    const nurbs = AcGeNurbsCurve.byKnotsControlPointsWeights(
      3,
      [0, 0, 0, 0, 1, 1, 1, 1],
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 2, y: 0, z: 0 },
        { x: 3, y: 1, z: 0 }
      ]
    )

    expect(nurbs.degree()).toBe(3)
    expect(nurbs.getPoints(10)).toHaveLength(11)
  })

  it('clones curve with independent internal arrays', () => {
    const nurbs = AcGeNurbsCurve.byKnotsControlPointsWeights(
      2,
      [0, 0, 0, 1, 1, 1],
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 }
      ],
      [1, 2, 3]
    )

    const cloned = nurbs.clone()
    expect(cloned).not.toBe(nurbs)
    expect(cloned.degree()).toBe(2)
    expect(cloned.knots()).toEqual([0, 0, 0, 1, 1, 1])
    expect(cloned.weights()).toEqual([1, 2, 3])
  })
})

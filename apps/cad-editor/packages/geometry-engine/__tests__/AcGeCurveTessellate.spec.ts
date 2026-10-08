import {
  AcGeArea2d,
  AcGeCircArc2d,
  AcGeCircArc3d,
  AcGeEllipseArc2d,
  AcGeEllipseArc3d,
  AcGeLine2d,
  AcGeLoop2d,
  AcGePolyline2d,
  AcGeSpline3d,
  AcGeVector3d,
  ORIGIN_POINT_2D,
  ORIGIN_POINT_3D,
  TAU
} from '../src'

describe('AcGeCurveTessellate', () => {
  describe('AcGeCircArc2d.segmentCount', () => {
    it('uses circleSides segments for a full circle at the default deviation', () => {
      expect(AcGeCircArc2d.segmentCount(1, TAU)).toBe(100)
      expect(AcGeCircArc2d.segmentCount(10, TAU)).toBe(100)
    })

    it('uses fewer segments for a short sweep than for a full circle', () => {
      const quarter = AcGeCircArc2d.segmentCount(1, Math.PI / 2)
      const full = AcGeCircArc2d.segmentCount(1, TAU)
      expect(quarter).toBeLessThan(full)
      expect(quarter).toBeGreaterThanOrEqual(25)
      expect(quarter).toBeLessThanOrEqual(26)
    })

    it('gives a larger radius more segments at a fixed absolute deviation', () => {
      const options = { deviation: 0.01, maxSegments: 100, minSegments: 3 }
      const small = AcGeCircArc2d.segmentCount(1, TAU, options)
      const large = AcGeCircArc2d.segmentCount(100, TAU, options)
      expect(small).toBeLessThan(large)
      expect(large).toBeLessThanOrEqual(100)
    })

    it('respects maxSegments', () => {
      expect(
        AcGeCircArc2d.segmentCount(1000, TAU, {
          deviation: 1e-9,
          maxSegments: 16
        })
      ).toBe(16)
    })

    it('falls back to minSegments when the radius is degenerate', () => {
      expect(
        AcGeCircArc2d.segmentCount(0, TAU, { minSegments: 4, maxSegments: 20 })
      ).toBe(4)
    })
  })

  describe('AcGeCircArc2d.chordDeviationFromRadius', () => {
    it('returns a positive deviation that shrinks as circleSides grows', () => {
      const coarse = AcGeCircArc2d.chordDeviationFromRadius(10, 8)
      const fine = AcGeCircArc2d.chordDeviationFromRadius(10, 100)
      expect(coarse).toBeGreaterThan(fine)
      expect(fine).toBeGreaterThan(0)
    })
  })

  describe('circular arc tessellate', () => {
    it('samples a full 2d circle with 101 points by default', () => {
      const circle = new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, TAU, false)
      const points = circle.tessellate()
      expect(points).toHaveLength(101)
      expect(circle.getPoints(100)).toHaveLength(101)
    })

    it('samples a short 2d arc with far fewer than 101 points', () => {
      const arc = new AcGeCircArc2d(
        ORIGIN_POINT_2D,
        1,
        0,
        Math.PI / 18,
        false
      )
      const points = arc.tessellate()
      expect(points.length).toBeGreaterThan(1)
      expect(points.length).toBeLessThan(20)
    })

    it('samples a 3d quarter arc with fewer points than a full circle', () => {
      const arc = new AcGeCircArc3d(
        ORIGIN_POINT_3D,
        2,
        0,
        Math.PI / 2,
        AcGeVector3d.Z_AXIS,
        AcGeVector3d.X_AXIS
      )
      const circle = new AcGeCircArc3d(
        ORIGIN_POINT_3D,
        2,
        0,
        TAU,
        AcGeVector3d.Z_AXIS,
        AcGeVector3d.X_AXIS
      )
      expect(arc.tessellate().length).toBeLessThan(circle.tessellate().length)
      expect(AcGeCircArc3d.segmentCount(2, Math.PI / 2)).toBe(
        AcGeCircArc2d.segmentCount(2, Math.PI / 2)
      )
    })
  })

  describe('ellipse tessellate', () => {
    it('uses the circular closed-form path when the radii are equal', () => {
      const ellipse = new AcGeEllipseArc3d(
        ORIGIN_POINT_3D,
        AcGeVector3d.Z_AXIS,
        AcGeVector3d.X_AXIS,
        3,
        3,
        0,
        TAU
      )
      expect(ellipse.tessellate()).toHaveLength(101)
    })

    it('keeps an eccentric ellipse within the evaluation budget', () => {
      const ellipse = new AcGeEllipseArc3d(
        ORIGIN_POINT_3D,
        AcGeVector3d.Z_AXIS,
        AcGeVector3d.X_AXIS,
        10,
        1,
        0,
        TAU
      )
      const points = ellipse.tessellate({ maxSegments: 40 })
      expect(points.length).toBeGreaterThan(2)
      expect(points.length).toBeLessThanOrEqual(40)
    })
  })

  describe('spline tessellate', () => {
    it('uses fewer than 100 points for a nearly linear spline', () => {
      const spline = new AcGeSpline3d(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 }
        ],
        [0, 0, 0, 0, 1, 1, 1, 1]
      )
      const points = spline.tessellate()
      expect(points.length).toBeGreaterThan(1)
      expect(points.length).toBeLessThan(100)
      expect(spline.getPoints(50)).toHaveLength(50)
    })

    it('caps output at maxSegments', () => {
      const spline = new AcGeSpline3d(
        [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 4, z: 0 },
          { x: 2, y: -4, z: 0 },
          { x: 3, y: 0, z: 0 }
        ],
        [0, 0, 0, 0, 1, 1, 1, 1]
      )
      const points = spline.tessellate({
        deviation: 1e-9,
        maxSegments: 12
      })
      expect(points.length).toBeLessThanOrEqual(12)
    })
  })

  describe('polyline tessellate', () => {
    it('emits only vertices for a straight polyline', () => {
      const polyline = new AcGePolyline2d([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 3 }
      ])
      expect(polyline.tessellate()).toHaveLength(3)
    })

    it('samples a tiny bulge with far fewer than 101 points', () => {
      const polyline = new AcGePolyline2d([
        { x: 0, y: 0, bulge: 0.02 },
        { x: 1, y: 0 }
      ])
      const points = polyline.tessellate()
      expect(points.length).toBeGreaterThan(1)
      expect(points.length).toBeLessThan(20)
      expect(polyline.getPoints(100).length).toBeGreaterThan(100)
    })
  })

  describe('loop and area tessellate', () => {
    it('emits vertices only for a square of straight edges', () => {
      const loop = new AcGeLoop2d([
        new AcGeLine2d({ x: 0, y: 0 }, { x: 1, y: 0 }),
        new AcGeLine2d({ x: 1, y: 0 }, { x: 1, y: 1 }),
        new AcGeLine2d({ x: 1, y: 1 }, { x: 0, y: 1 }),
        new AcGeLine2d({ x: 0, y: 1 }, { x: 0, y: 0 })
      ])
      const points = loop.tessellate()
      expect(points.length).toBeLessThanOrEqual(5)
      expect(points.length).toBeGreaterThanOrEqual(4)
    })

    it('samples a short circular edge with far fewer than 101 points', () => {
      const loop = new AcGeLoop2d([
        new AcGeCircArc2d(ORIGIN_POINT_2D, 1, 0, Math.PI / 18, false),
        new AcGeLine2d({ x: 1, y: 0 }, ORIGIN_POINT_2D)
      ])
      const points = loop.tessellate()
      expect(points.length).toBeGreaterThan(2)
      expect(points.length).toBeLessThan(25)
    })

    it('samples an elliptical edge without using a fixed 100-point grid', () => {
      const ellipse = new AcGeEllipseArc2d(
        ORIGIN_POINT_2D,
        2,
        1,
        0,
        Math.PI / 18
      )
      const loop = new AcGeLoop2d([ellipse])
      const points = loop.tessellate()
      expect(points.length).toBeGreaterThan(1)
      expect(points.length).toBeLessThan(ellipse.getPoints(100).length)
    })

    it('tessellates every area loop', () => {
      const area = new AcGeArea2d()
      area.add(
        new AcGePolyline2d(
          [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 0, y: 2 }
          ],
          true
        )
      )
      const loops = area.tessellate()
      expect(loops).toHaveLength(1)
      expect(loops[0].length).toBeGreaterThanOrEqual(4)
    })
  })
})

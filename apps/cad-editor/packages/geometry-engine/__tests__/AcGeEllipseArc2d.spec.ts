import { AcGeEllipseArc2d } from '../src'

describe('AcGeEllipseArc2d', () => {
  it('evaluates points on arc', () => {
    const ellipse = new AcGeEllipseArc2d({ x: 0, y: 0 }, 3, 2, 0, Math.PI)
    const mid = ellipse.getPoint(0.5)
    expect(mid.y).toBeCloseTo(2, 6)
  })

  it('covers full-ellipse and clockwise branches', () => {
    const full = new AcGeEllipseArc2d(
      { x: 0, y: 0 },
      3,
      2,
      0.3,
      0.3 + Math.PI * 2
    )
    expect(full.startAngle).toBe(0)
    expect(full.endAngle).toBeCloseTo(Math.PI * 2, 8)

    const cwFull = new AcGeEllipseArc2d(
      { x: 0, y: 0 },
      4,
      1,
      0,
      Math.PI * 2,
      true
    )
    const p0 = cwFull.getPoint(0)
    const p1 = cwFull.getPoint(0.25)
    expect(p0.distanceTo(p1)).toBeGreaterThan(0)

    const cwArc = new AcGeEllipseArc2d(
      { x: 0, y: 0 },
      4,
      2,
      0,
      Math.PI,
      true,
      0.2
    )
    expect(cwArc.isLargeArc).toBe(0)
    expect(cwArc.getPoint(0.5)).toBeDefined()

    const largeArc = new AcGeEllipseArc2d(
      { x: 0, y: 0 },
      4,
      2,
      0,
      Math.PI * 1.5
    )
    expect(largeArc.isLargeArc).toBe(1)

    const wrapped = new AcGeEllipseArc2d({ x: 0, y: 0 }, 3, 2, 0.3, 1.1)
    ;(wrapped as any)._startAngle = 0.3
    ;(wrapped as any)._endAngle = 0.3 - Math.PI * 2
    expect(wrapped.getPoint(0.5)).toBeInstanceOf(Object)

    const same = new AcGeEllipseArc2d({ x: 0, y: 0 }, 2, 1, 0.5, 1.2)
    ;(same as any)._startAngle = 0.5
    ;(same as any)._endAngle = 0.5 + Number.EPSILON / 2
    expect(same.getPoint(0.25)).toBeInstanceOf(Object)
  })
})

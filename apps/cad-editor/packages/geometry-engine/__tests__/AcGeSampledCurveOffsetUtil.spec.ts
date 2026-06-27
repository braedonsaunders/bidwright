import { AcGePoint2d, offsetSmoothedSampledPath } from '../src'

function hasSelfIntersection(points: AcGePoint2d[], closed = false): boolean {
  const segmentCount = closed ? points.length : points.length - 1
  for (let i = 0; i < segmentCount; i++) {
    const a0 = points[i]
    const a1 = points[(i + 1) % points.length]
    for (let j = i + 1; j < segmentCount; j++) {
      if (j === i + 1) continue
      if (closed && i === 0 && j === segmentCount - 1) continue
      const b0 = points[j]
      const b1 = points[(j + 1) % points.length]
      const dx1 = a1.x - a0.x
      const dy1 = a1.y - a0.y
      const dx2 = b1.x - b0.x
      const dy2 = b1.y - b0.y
      const det = dx1 * dy2 - dy1 * dx2
      if (Math.abs(det) <= 1e-9) continue
      const qpx = b0.x - a0.x
      const qpy = b0.y - a0.y
      const t = (qpx * dy2 - qpy * dx2) / det
      const u = (qpx * dy1 - qpy * dx1) / det
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return true
      }
    }
  }
  return false
}

describe('offsetSmoothedSampledPath', () => {
  it('offsets a gentle open curve without self-intersections', () => {
    const points = [
      new AcGePoint2d(0, 0),
      new AcGePoint2d(1, 1),
      new AcGePoint2d(2, -1),
      new AcGePoint2d(3, 0)
    ]
    const result = offsetSmoothedSampledPath(points, false, 0.5)
    expect(result).not.toBeNull()
    const offsetPoints = Array.from(
      { length: result!.numberOfVertices },
      (_, i) => result!.getPointAt(i)
    )
    expect(hasSelfIntersection(offsetPoints)).toBe(false)
  })

  it('trims loops when offset distance exceeds local curvature on a serpentine path', () => {
    const points: AcGePoint2d[] = []
    for (let i = 0; i <= 80; i++) {
      const t = i / 80
      points.push(
        new AcGePoint2d(
          t * 40,
          4 * Math.sin(t * Math.PI * 2.5) + 2 * Math.sin(t * Math.PI * 5)
        )
      )
    }

    const result = offsetSmoothedSampledPath(points, false, 2)
    expect(result).not.toBeNull()
    const offsetPoints = Array.from(
      { length: result!.numberOfVertices },
      (_, i) => result!.getPointAt(i)
    )
    expect(offsetPoints.length).toBeGreaterThan(2)
    expect(hasSelfIntersection(offsetPoints)).toBe(false)
  })

  it('returns null for degenerate input', () => {
    expect(offsetSmoothedSampledPath([], false, 1)).toBeNull()
    expect(
      offsetSmoothedSampledPath([new AcGePoint2d(0, 0)], false, 1)
    ).toBeNull()
  })
})

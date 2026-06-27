import {
  AcGeBox2d,
  AcGeMatrix2d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d
} from '../math'
import { AcGeCircArc2d } from './AcGeCircArc2d'
import { AcGeCurve2d } from './AcGeCurve2d'
import { AcGeEllipseArc2d } from './AcGeEllipseArc2d'
import { AcGeLine2d } from './AcGeLine2d'
import { AcGeSpline3d } from './AcGeSpline3d'

export type AcGeBoundaryEdgeType =
  | AcGeLine2d
  | AcGeCircArc2d
  | AcGeSpline3d
  | AcGeEllipseArc2d

/**
 * The class representing one closed loop created by connected edges, which can be line, circular arc,
 * ellipse arc, or spline.
 */
export class AcGeLoop2d extends AcGeCurve2d {
  private _curves: Array<AcGeBoundaryEdgeType>

  /**
   * Create one loop by connected curves
   * @param curves Input one array of connected curves
   */
  constructor(curves: Array<AcGeBoundaryEdgeType> = []) {
    super()
    this._curves = curves
  }

  get curves() {
    return this._curves as ReadonlyArray<AcGeBoundaryEdgeType>
  }

  /**
   * Build loops from a list of boundary edges.
   *
   * This method greedily connects the nearest edge endpoints to form one or more
   * closed loops. If a loop cannot be closed within the given tolerance, it will
   * still return the best-effort loop with the collected edges.
   *
   * @param edges Input edges
   * @param tolerance Distance tolerance to treat two points as connected
   * @returns Loops constructed from the input edges
   */
  static buildFromEdges(
    edges: ReadonlyArray<AcGeBoundaryEdgeType>,
    tolerance = 1e-3
  ): AcGeLoop2d[] {
    if (edges.length === 0) return []

    // Work on a mutable copy so we can consume edges as we form loops.
    const remaining = [...edges]
    const loops: AcGeLoop2d[] = []
    const toleranceSq = tolerance * tolerance

    // Squared-distance check to avoid repeated sqrt calls.
    const isClose = (a: AcGePoint2d, b: AcGePoint2d) => {
      const dx = a.x - b.x
      const dy = a.y - b.y
      return dx * dx + dy * dy <= toleranceSq
    }

    while (remaining.length > 0) {
      const loopEdges: AcGeBoundaryEdgeType[] = []
      const current = remaining.shift() as AcGeBoundaryEdgeType
      loopEdges.push(current)

      const start = AcGeLoop2d.getEdgeStartPoint(current)
      let end = AcGeLoop2d.getEdgeEndPoint(current)

      // If the first edge is already closed, keep it as a single-edge loop.
      if (!isClose(start, end)) {
        while (remaining.length > 0) {
          // Find the closest edge endpoint to the current end point.
          const match = AcGeLoop2d.findConnectingEdge(
            remaining,
            end,
            toleranceSq
          )
          if (match.index < 0) break

          let next = remaining.splice(match.index, 1)[0]
          // Reverse the edge direction if its end is closer than its start.
          if (match.reverse) {
            next = AcGeLoop2d.reverseEdge(next)
          }
          loopEdges.push(next)
          end = AcGeLoop2d.getEdgeEndPoint(next)

          // Stop once we close the loop back to the original start.
          if (isClose(end, start)) break
        }
      }

      loops.push(new AcGeLoop2d(loopEdges))
    }

    return loops
  }

  /**
   * Append an edge to this loop
   * @param curve
   */
  add(curve: AcGeBoundaryEdgeType) {
    this._curves.push(curve)
    this._boundingBoxNeedsUpdate = true
  }

  /**
   * The number of edges in this loop
   */
  get numberOfEdges() {
    return this._curves.length
  }

  /**
   * Start point of this polyline
   */
  get startPoint(): AcGePoint2d {
    if (this._curves.length > 0) {
      const temp = this._curves[0].startPoint
      return new AcGePoint2d(temp.x, temp.y)
    }
    throw new Error('Start point does not exist in an empty loop.')
  }

  /**
   * End point of this polyline
   */
  get endPoint(): AcGePoint2d {
    return this.startPoint
  }

  /**
   * @inheritdoc
   */
  get length() {
    let length = 0
    this._curves.forEach(curve => {
      length += curve.length
    })
    return length
  }

  /**
   * @inheritdoc
   */
  calculateBoundingBox(): AcGeBox2d {
    const points = this.getPoints(100)
    const box2d = new AcGeBox2d()
    box2d.setFromPoints(points)
    return box2d
  }

  /**
   * @inheritdoc
   */
  transform(matrix: AcGeMatrix2d) {
    const matrix3d = new AcGeMatrix3d().set(
      matrix.elements[0],
      matrix.elements[3],
      0,
      matrix.elements[6],
      matrix.elements[1],
      matrix.elements[4],
      0,
      matrix.elements[7],
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    )

    this._curves.forEach(curve => {
      if (curve instanceof AcGeSpline3d) {
        curve.transform(matrix3d)
      } else {
        curve.transform(matrix)
      }
    })

    this._boundingBoxNeedsUpdate = true
    return this
  }

  /**
   * Return a deep-cloned copy of this loop.
   */
  clone() {
    return new AcGeLoop2d(this._curves.map(curve => curve.clone()))
  }

  /**
   * @inheritdoc
   */
  get closed(): boolean {
    return true
  }

  /**
   * Return boundary points of this area
   * @param numPoints Input the nubmer of points returned for arc segmentation
   * @returns Return points
   */
  getPoints(numPoints: number): AcGePoint2d[] {
    const points: AcGePoint2d[] = []
    this.curves.forEach(curve => {
      curve.getPoints(numPoints).forEach((point: AcGePoint2d | AcGePoint3d) => {
        points.push(new AcGePoint2d(point.x, point.y))
      })
    })
    return points
  }

  private static findConnectingEdge(
    edges: AcGeBoundaryEdgeType[],
    target: AcGePoint2d,
    toleranceSq: number
  ) {
    let bestIndex = -1
    let bestReverse = false
    let bestDistance = Number.POSITIVE_INFINITY

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i]
      const start = AcGeLoop2d.getEdgeStartPoint(edge)
      const end = AcGeLoop2d.getEdgeEndPoint(edge)

      // Distance from target to edge start.
      const dxStart = target.x - start.x
      const dyStart = target.y - start.y
      const distStart = dxStart * dxStart + dyStart * dyStart

      if (distStart < bestDistance) {
        bestDistance = distStart
        bestIndex = i
        bestReverse = false
      }

      // Distance from target to edge end.
      const dxEnd = target.x - end.x
      const dyEnd = target.y - end.y
      const distEnd = dxEnd * dxEnd + dyEnd * dyEnd

      if (distEnd < bestDistance) {
        bestDistance = distEnd
        bestIndex = i
        bestReverse = true
      }
    }

    // If the closest edge is still too far away, report no match.
    if (bestDistance > toleranceSq) {
      return { index: -1, reverse: false }
    }
    return { index: bestIndex, reverse: bestReverse }
  }

  /**
   * Get the start point of an edge as a 2D point.
   * @param edge Input edge
   * @returns Start point
   */
  private static getEdgeStartPoint(edge: AcGeBoundaryEdgeType) {
    const start = edge.startPoint as AcGePoint2d
    return new AcGePoint2d(start.x, start.y)
  }

  /**
   * Get the end point of an edge as a 2D point.
   * @param edge Input edge
   * @returns End point
   */
  private static getEdgeEndPoint(edge: AcGeBoundaryEdgeType) {
    const end = edge.endPoint as AcGePoint2d
    return new AcGePoint2d(end.x, end.y)
  }

  /**
   * Reverse an edge so its start/end direction is flipped.
   * @param edge Input edge
   * @returns Reversed edge
   */
  private static reverseEdge(edge: AcGeBoundaryEdgeType): AcGeBoundaryEdgeType {
    if (edge instanceof AcGeLine2d) {
      return new AcGeLine2d(edge.endPoint, edge.startPoint)
    }
    if (edge instanceof AcGeCircArc2d) {
      return new AcGeCircArc2d(
        edge.center,
        edge.radius,
        edge.endAngle,
        edge.startAngle,
        !edge.clockwise
      )
    }
    if (edge instanceof AcGeEllipseArc2d) {
      return new AcGeEllipseArc2d(
        edge.center,
        edge.majorAxisRadius,
        edge.minorAxisRadius,
        edge.endAngle,
        edge.startAngle,
        !edge.clockwise,
        edge.rotation
      )
    }
    if (edge instanceof AcGeSpline3d) {
      // Reverse spline by reversing control points and knot vector.
      return AcGeLoop2d.reverseSplineEdge(edge)
    }
    return edge
  }

  /**
   * Reverse a spline edge by mirroring its knots and control points.
   * @param edge Input spline edge
   * @returns Reversed spline edge
   */
  private static reverseSplineEdge(edge: AcGeSpline3d) {
    // Mirror knot values around the midpoint and reverse the order.
    const controlPoints = [...edge.controlPoints].reverse()
    const knots = edge.knots
    const knotStart = knots[0]
    const knotEnd = knots[knots.length - 1]
    const reversedKnots = knots
      .map(knot => knotStart + knotEnd - knot)
      .reverse()
    const weights = edge.weights
    const reversedWeights =
      weights.length > 0 ? [...weights].reverse() : undefined
    return new AcGeSpline3d(
      controlPoints,
      reversedKnots,
      reversedWeights,
      edge.degree,
      edge.closed
    )
  }
}

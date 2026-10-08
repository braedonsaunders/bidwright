import {
  AcGeBoundaryEdgeType,
  AcGeCircArc2d,
  AcGeCircArc3d,
  AcGeEllipseArc2d,
  AcGeEllipseArc3d,
  acgeGetOcsReferenceVector,
  AcGeIntersectPrimitive,
  AcGeLine2d,
  AcGeLine3d,
  AcGeLoop2d,
  AcGeLoop2dType,
  AcGeMatrix3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGePolyline2dVertex,
  AcGeSpline3d,
  acgeTransformIntersectPrimitive,
  acgeTransformOcsPointToWcs,
  AcGeVector3d,
  AcGeVector3dLike,
  TAU
} from '@mlightcad/geometry-engine'

const BULGE_EPS = 1e-10

/**
 * Builds bounded line primitives from a 3D point path.
 *
 * Open paths mark the first and last segments as extendable; closed paths
 * mark every segment as not extendable. Pass `extendable` to override that
 * default for every segment (for example mesh edges).
 */
export function acdbIntersectPrimitivesFromPointPath(
  points: readonly AcGePoint3dLike[],
  closed: boolean,
  extendable?: boolean
): AcGeIntersectPrimitive[] {
  const count = closed ? points.length : points.length - 1
  if (count < 1 || points.length < 2) return []

  const primitives: AcGeIntersectPrimitive[] = []
  for (let i = 0; i < count; i++) {
    const start = points[i]
    const end = points[(i + 1) % points.length]
    if (isDegenerateSegment(start, end)) continue
    const isEndSegment = !closed && (i === 0 || i === count - 1)
    primitives.push({
      kind: 'line',
      line: new AcGeLine3d(start, end),
      extent: 'bounded',
      extendable: extendable ?? isEndSegment
    })
  }
  return primitives
}

/**
 * Converts a 2D polyline (including bulge arcs) into WCS intersection primitives.
 */
export function acdbIntersectPrimitivesFromPolyline2d(
  vertices: readonly AcGePolyline2dVertex[],
  closed: boolean,
  elevation: number,
  normal: AcGeVector3dLike
): AcGeIntersectPrimitive[] {
  const count = closed ? vertices.length : vertices.length - 1
  if (count < 1 || vertices.length < 2) return []

  const primitives: AcGeIntersectPrimitive[] = []
  for (let i = 0; i < count; i++) {
    const start = vertices[i]
    const end = vertices[(i + 1) % vertices.length]
    const isEndSegment = !closed && (i === 0 || i === count - 1)
    const extendable = isEndSegment
    const bulge = start.bulge ?? 0
    if (Math.abs(bulge) > BULGE_EPS) {
      const primitive = circArc2dToPrimitive(
        new AcGeCircArc2d(start, end, bulge),
        elevation,
        normal,
        extendable
      )
      if (primitive) primitives.push(primitive)
      continue
    }
    const startWcs = toWcs(start.x, start.y, elevation, normal)
    const endWcs = toWcs(end.x, end.y, elevation, normal)
    if (isDegenerateSegment(startWcs, endWcs)) continue
    primitives.push({
      kind: 'line',
      line: new AcGeLine3d(startWcs, endWcs),
      extent: 'bounded',
      extendable
    })
  }
  return primitives
}

/**
 * Converts hatch / area loops into WCS intersection primitives.
 */
export function acdbIntersectPrimitivesFromAreaLoops(
  loops: readonly AcGeLoop2dType[],
  elevation: number,
  normal: AcGeVector3dLike
): AcGeIntersectPrimitive[] {
  const primitives: AcGeIntersectPrimitive[] = []
  for (const loop of loops) {
    if (loop instanceof AcGePolyline2d) {
      primitives.push(
        ...acdbIntersectPrimitivesFromPolyline2d(
          loop.vertices,
          loop.closed,
          elevation,
          normal
        )
      )
      continue
    }
    if (loop instanceof AcGeLoop2d) {
      for (const edge of loop.curves) {
        const converted = boundaryEdgeToPrimitive(edge, elevation, normal)
        if (converted) primitives.push(...converted)
      }
    }
  }
  return primitives
}

/**
 * Transforms a list of intersection primitives by a WCS matrix.
 */
export function acdbTransformIntersectPrimitives(
  primitives: readonly AcGeIntersectPrimitive[],
  matrix: AcGeMatrix3d
): AcGeIntersectPrimitive[] {
  return primitives.map(primitive =>
    acgeTransformIntersectPrimitive(primitive, matrix)
  )
}

function boundaryEdgeToPrimitive(
  edge: AcGeBoundaryEdgeType,
  elevation: number,
  normal: AcGeVector3dLike
): AcGeIntersectPrimitive[] {
  if (edge instanceof AcGeLine2d) {
    const start = toWcs(edge.startPoint.x, edge.startPoint.y, elevation, normal)
    const end = toWcs(edge.endPoint.x, edge.endPoint.y, elevation, normal)
    if (isDegenerateSegment(start, end)) return []
    return [
      {
        kind: 'line',
        line: new AcGeLine3d(start, end),
        extent: 'bounded',
        extendable: false
      }
    ]
  }
  if (edge instanceof AcGeCircArc2d) {
    const primitive = circArc2dToPrimitive(edge, elevation, normal, false)
    return primitive ? [primitive] : []
  }
  if (edge instanceof AcGeEllipseArc2d) {
    const primitive = ellipseArc2dToPrimitive(edge, elevation, normal, false)
    return primitive ? [primitive] : []
  }
  if (edge instanceof AcGeSpline3d) {
    const spline = edge.clone()
    const matrix = ocsElevationMatrix(elevation, normal)
    if (matrix) spline.transform(matrix)
    return [{ kind: 'spline', spline, extendable: false }]
  }
  return []
}

function circArc2dToPrimitive(
  arc: AcGeCircArc2d,
  elevation: number,
  normal: AcGeVector3dLike,
  extendable: boolean
): AcGeIntersectPrimitive | null {
  if (arc.closed || Math.abs(arc.deltaAngle - TAU) < 1e-10) {
    const center = toWcs(arc.center.x, arc.center.y, elevation, normal)
    return {
      kind: 'circArc',
      arc: new AcGeCircArc3d(
        center,
        arc.radius,
        0,
        TAU,
        normal,
        acgeGetOcsReferenceVector(normal)
      ),
      extendable: false
    }
  }

  const start = toWcs(arc.startPoint.x, arc.startPoint.y, elevation, normal)
  const end = toWcs(arc.endPoint.x, arc.endPoint.y, elevation, normal)
  const mid = toWcs(arc.midPoint.x, arc.midPoint.y, elevation, normal)
  const arc3d = AcGeCircArc3d.tryCreateByThreePoints(start, end, mid)
  if (!arc3d) {
    if (isDegenerateSegment(start, end)) return null
    return {
      kind: 'line',
      line: new AcGeLine3d(start, end),
      extent: 'bounded',
      extendable
    }
  }
  return {
    kind: 'circArc',
    arc: arc3d,
    extendable: extendable && !arc3d.closed
  }
}

function ellipseArc2dToPrimitive(
  arc: AcGeEllipseArc2d,
  elevation: number,
  normal: AcGeVector3dLike,
  extendable: boolean
): AcGeIntersectPrimitive | null {
  const center = toWcs(arc.center.x, arc.center.y, elevation, normal)
  const extrusion = new AcGeMatrix3d().setFromExtrusionDirection(
    new AcGeVector3d(normal.x, normal.y, normal.z)
  )
  const majorAxis = new AcGeVector3d(
    Math.cos(arc.rotation),
    Math.sin(arc.rotation),
    0
  ).transformDirection(extrusion)
  if (majorAxis.lengthSq() === 0) return null

  const startAngle = arc.clockwise ? arc.endAngle : arc.startAngle
  const endAngle = arc.clockwise ? arc.startAngle : arc.endAngle
  const ellipse = new AcGeEllipseArc3d(
    center,
    normal,
    majorAxis,
    arc.majorAxisRadius,
    arc.minorAxisRadius,
    startAngle,
    endAngle
  )
  return {
    kind: 'ellipseArc',
    arc: ellipse,
    extendable:
      extendable &&
      !ellipse.closed &&
      Math.abs(ellipse.deltaAngle - TAU) > 1e-10
  }
}

function toWcs(
  x: number,
  y: number,
  elevation: number,
  normal: AcGeVector3dLike
) {
  return acgeTransformOcsPointToWcs({ x, y, z: elevation }, normal)
}

function ocsElevationMatrix(elevation: number, normal: AcGeVector3dLike) {
  const isDefaultNormal =
    Math.abs(normal.x) < 1e-10 &&
    Math.abs(normal.y) < 1e-10 &&
    Math.abs(normal.z - 1) < 1e-10
  if (isDefaultNormal && Math.abs(elevation) < 1e-10) return null
  const extrusion = new AcGeMatrix3d().setFromExtrusionDirection(
    new AcGeVector3d(normal.x, normal.y, normal.z)
  )
  if (Math.abs(elevation) < 1e-10) return extrusion
  return extrusion.multiply(new AcGeMatrix3d().makeTranslation(0, 0, elevation))
}

function isDegenerateSegment(start: AcGePoint3dLike, end: AcGePoint3dLike) {
  const dx = start.x - end.x
  const dy = start.y - end.y
  const dz = (start.z ?? 0) - (end.z ?? 0)
  return dx * dx + dy * dy + dz * dz < 1e-20
}

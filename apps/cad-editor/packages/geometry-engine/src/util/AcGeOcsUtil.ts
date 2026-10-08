import { AcGeMatrix3d } from '../math/AcGeMatrix3d'
import { AcGePoint3d, AcGePoint3dLike } from '../math/AcGePoint3d'
import { AcGeVector3d, AcGeVector3dLike } from '../math/AcGeVector3d'
import { AcGeMathUtil } from './AcGeMathUtil'

const _ocsMatrix = /*@__PURE__*/ new AcGeMatrix3d()
const _ocsXAxis = /*@__PURE__*/ new AcGeVector3d()
const _ocsYAxis = /*@__PURE__*/ new AcGeVector3d()
const _ocsZAxis = /*@__PURE__*/ new AcGeVector3d()
const _ocsPoint = /*@__PURE__*/ new AcGePoint3d()
const _ocsNormal = /*@__PURE__*/ new AcGeVector3d()

function createExtrusionMatrix(normal: AcGeVector3dLike) {
  return new AcGeMatrix3d().setFromExtrusionDirection(
    new AcGeVector3d(normal.x, normal.y, normal.z)
  )
}

export function acgeGetOcsReferenceVector(normal: AcGeVector3dLike) {
  return acgeGetOcsReferenceVectorInto(new AcGeVector3d(), normal)
}

/**
 * Writes the OCS reference vector for `normal` into `out` without allocating.
 * Uses the module-level matrix/axis scratch, so like
 * {@link acgeGetOcsReferenceVector} it is single-threaded sequential.
 */
export function acgeGetOcsReferenceVectorInto(
  out: AcGeVector3d,
  normal: AcGeVector3dLike
) {
  _ocsMatrix.setFromExtrusionDirection(
    _ocsNormal.set(normal.x, normal.y, normal.z)
  )
  _ocsMatrix.extractBasis(_ocsXAxis, _ocsYAxis, _ocsZAxis)
  out.copy(_ocsXAxis)
  return out
}

export function acgeTransformOcsPointToWcs(
  point: AcGePoint3dLike,
  normal: AcGeVector3dLike
) {
  return acgeTransformOcsPointToWcsInto(new AcGePoint3d(), point, normal)
}

/**
 * Transforms an OCS point into WCS, writing into `out` without allocating.
 * The +Z extrusion shortcut skips the matrix entirely (the extrusion matrix
 * is identity there, see {@link AcGeMatrix3d.setFromExtrusionDirection}),
 * which is the dominant case for DXF entities.
 */
export function acgeTransformOcsPointToWcsInto(
  out: AcGePoint3d,
  point: AcGePoint3dLike,
  normal: AcGeVector3dLike
) {
  if (normal.x === 0 && normal.y === 0 && normal.z === 1) {
    out.set(point.x, point.y, point.z ?? 0)
    return out
  }
  _ocsMatrix.setFromExtrusionDirection(
    _ocsNormal.set(normal.x, normal.y, normal.z)
  )
  out.set(point.x, point.y, point.z ?? 0)
  out.applyMatrix4(_ocsMatrix)
  return out
}

export function acgeTransformWcsPointToOcs(
  point: AcGePoint3dLike,
  normal: AcGeVector3dLike
) {
  return new AcGePoint3d(point.x, point.y, point.z ?? 0).applyMatrix4(
    createExtrusionMatrix(normal).invert()
  )
}

export function acgeGetOcsAngle(
  center: AcGePoint3dLike,
  point: AcGePoint3dLike,
  normal: AcGeVector3dLike
) {
  const centerOcs = acgeTransformWcsPointToOcs(center, normal)
  const pointOcs = acgeTransformWcsPointToOcs(point, normal)
  _ocsPoint.set(
    pointOcs.x - centerOcs.x,
    pointOcs.y - centerOcs.y,
    (pointOcs.z ?? 0) - (centerOcs.z ?? 0)
  )
  return AcGeMathUtil.normalizeAngle(Math.atan2(_ocsPoint.y, _ocsPoint.x))
}

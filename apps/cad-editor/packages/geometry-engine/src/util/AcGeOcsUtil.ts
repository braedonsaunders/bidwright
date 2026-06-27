import { AcGeMatrix3d } from '../math/AcGeMatrix3d'
import { AcGePoint3d, AcGePoint3dLike } from '../math/AcGePoint3d'
import { AcGeVector3d, AcGeVector3dLike } from '../math/AcGeVector3d'
import { AcGeMathUtil } from './AcGeMathUtil'

const _ocsMatrix = /*@__PURE__*/ new AcGeMatrix3d()
const _ocsXAxis = /*@__PURE__*/ new AcGeVector3d()
const _ocsYAxis = /*@__PURE__*/ new AcGeVector3d()
const _ocsZAxis = /*@__PURE__*/ new AcGeVector3d()
const _ocsPoint = /*@__PURE__*/ new AcGePoint3d()

function createExtrusionMatrix(normal: AcGeVector3dLike) {
  return new AcGeMatrix3d().setFromExtrusionDirection(
    new AcGeVector3d(normal.x, normal.y, normal.z)
  )
}

export function getOcsReferenceVector(normal: AcGeVector3dLike) {
  _ocsMatrix.setFromExtrusionDirection(
    new AcGeVector3d(normal.x, normal.y, normal.z)
  )
  _ocsMatrix.extractBasis(_ocsXAxis, _ocsYAxis, _ocsZAxis)
  return _ocsXAxis.clone()
}

export function transformOcsPointToWcs(
  point: AcGePoint3dLike,
  normal: AcGeVector3dLike
) {
  return new AcGePoint3d(point.x, point.y, point.z ?? 0).applyMatrix4(
    createExtrusionMatrix(normal)
  )
}

export function transformWcsPointToOcs(
  point: AcGePoint3dLike,
  normal: AcGeVector3dLike
) {
  return new AcGePoint3d(point.x, point.y, point.z ?? 0).applyMatrix4(
    createExtrusionMatrix(normal).invert()
  )
}

export function getOcsAngle(
  center: AcGePoint3dLike,
  point: AcGePoint3dLike,
  normal: AcGeVector3dLike
) {
  const centerOcs = transformWcsPointToOcs(center, normal)
  const pointOcs = transformWcsPointToOcs(point, normal)
  _ocsPoint.set(
    pointOcs.x - centerOcs.x,
    pointOcs.y - centerOcs.y,
    (pointOcs.z ?? 0) - (centerOcs.z ?? 0)
  )
  return AcGeMathUtil.normalizeAngle(Math.atan2(_ocsPoint.y, _ocsPoint.x))
}

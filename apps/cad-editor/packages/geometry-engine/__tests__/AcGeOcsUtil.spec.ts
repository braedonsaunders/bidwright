import {
  getOcsAngle,
  getOcsReferenceVector,
  transformOcsPointToWcs,
  transformWcsPointToOcs
} from '../src'

describe('AcGeOcsUtil', () => {
  it('converts OCS points to WCS and back for negative Z extrusion', () => {
    const normal = { x: 0, y: 0, z: -1 }

    const wcs = transformOcsPointToWcs({ x: 1, y: 2, z: 3 }, normal)
    expect(wcs).toMatchObject({ x: -1, y: 2, z: -3 })

    const ocs = transformWcsPointToOcs(wcs, normal)
    expect(ocs).toMatchObject({ x: 1, y: 2, z: 3 })
  })

  it('returns the OCS reference vector and angles in WCS coordinates', () => {
    const normal = { x: 0, y: 0, z: -1 }
    const refVec = getOcsReferenceVector(normal)

    expect(refVec).toMatchObject({ x: -1, y: 0, z: 0 })

    const center = transformOcsPointToWcs({ x: 1, y: 2, z: 0 }, normal)
    const start = transformOcsPointToWcs({ x: 2, y: 2, z: 0 }, normal)
    const end = transformOcsPointToWcs({ x: 1, y: 3, z: 0 }, normal)

    expect(getOcsAngle(center, start, normal)).toBeCloseTo(0, 8)
    expect(getOcsAngle(center, end, normal)).toBeCloseTo(Math.PI / 2, 8)
  })
})

import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDb3PointAngularDimension } from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDb3PointAngularDimension', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDb3PointAngularDimension(
          new AcGePoint3d(),
          new AcGePoint3d(1, 0, 0),
          new AcGePoint3d(0, 1, 0),
          new AcGePoint3d(1, 1, 0)
        )
    )
  })

  it('returns geometricExtents and recomputes when center point changes', () => {
    const dim = new AcDb3PointAngularDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0),
      new AcGePoint3d(0, 1, 0),
      new AcGePoint3d(1, 1, 0)
    )

    expect(dim.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(dim.geometricExtents.max).toMatchObject({ x: 1, y: 1, z: 0 })

    dim.centerPoint = new AcGePoint3d(10, 20, 0)
    dim.arcPoint = new AcGePoint3d(12, 22, 0)

    expect(dim.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(dim.geometricExtents.max).toMatchObject({ x: 12, y: 22, z: 0 })
  })

  it('maps AcDb2LineAngularDimension endpoints via line intersection', () => {
    createWorkingDb()
    // Horizontal line (0,0)-(10,0) and vertical line (5,-5)-(5,5) → center (5,0).
    const dxf = [
      '5',
      'D1',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbDimension',
      '10',
      '8',
      '20',
      '2',
      '30',
      '0',
      '70',
      '2',
      '100',
      'AcDb2LineAngularDimension',
      '13',
      '0',
      '23',
      '0',
      '33',
      '0',
      '14',
      '10',
      '24',
      '0',
      '34',
      '0',
      '15',
      '5',
      '25',
      '-5',
      '35',
      '0',
      '16',
      '5',
      '26',
      '5',
      '36',
      '0'
    ].join('\n')

    const dim = new AcDb3PointAngularDimension(
      new AcGePoint3d(),
      new AcGePoint3d(),
      new AcGePoint3d(),
      new AcGePoint3d()
    )
    dim.dxfIn(AcDbDxfFiler.fromString(dxf))

    expect(dim.centerPoint.x).toBeCloseTo(5)
    expect(dim.centerPoint.y).toBeCloseTo(0)
    expect(dim.xLine1Point).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(dim.xLine2Point).toMatchObject({ x: 5, y: -5, z: 0 })
    expect(dim.arcPoint).toMatchObject({ x: 8, y: 2, z: 0 })
  })
})

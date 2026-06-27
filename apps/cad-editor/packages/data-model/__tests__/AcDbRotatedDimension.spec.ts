import { AcGePoint3d } from '@mlightcad/geometry-engine'
import { acdbHostApplicationServices } from '../src/base'
import { AcDbBlockTableRecord, AcDbDatabase } from '../src/database'
import { AcDbLine, AcDbRotatedDimension } from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbRotatedDimension', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDbRotatedDimension(
          new AcGePoint3d(),
          new AcGePoint3d(1, 0, 0),
          new AcGePoint3d(0, 1, 0)
        )
    )
  })

  it('writes AcDbRotatedDimension subclass marker in DXF output', () => {
    const db = createDb()

    const rotated = new AcDbRotatedDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(10, 0, 0),
      new AcGePoint3d(5, 2, 0)
    )
    db.tables.blockTable.modelSpace.appendEntity(rotated)

    const dxf = db.dxfOut(undefined, 6)
    expect(dxf).toContain('100\nAcDbRotatedDimension\n')
  })

  it('returns geometricExtents and updates when dimBlockPosition changes', () => {
    const db = createDb()

    const dimBlock = new AcDbBlockTableRecord()
    dimBlock.name = '*D_ROTATED'
    dimBlock.appendEntity(
      new AcDbLine(new AcGePoint3d(0, 0, 0), new AcGePoint3d(3, 0, 0))
    )
    db.tables.blockTable.add(dimBlock)

    const dim = new AcDbRotatedDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(5, 0, 0),
      new AcGePoint3d(5, 1, 0)
    )
    dim.dimBlockId = '*D_ROTATED'
    dim.dimBlockPosition = new AcGePoint3d(0, 0, 0)
    db.tables.blockTable.modelSpace.appendEntity(dim)

    expect(dim.geometricExtents.max.x).toBeCloseTo(3)

    dim.dimBlockPosition = new AcGePoint3d(10, 20, 0)

    expect(dim.geometricExtents.min).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(dim.geometricExtents.max.x).toBeCloseTo(13)
  })
})

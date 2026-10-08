import {
  AcGePoint2d,
  AcGePoint3d,
  AcGePolyline2d,
  acgeTransformOcsPointToWcs,
  AcGeVector3d
} from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices } from '../src/base'
import { AcDbBlockTableRecord, AcDbDatabase } from '../src/database'
import {
  AcDb2dPolyline,
  AcDbAlignedDimension,
  AcDbBlockReference,
  AcDbCircle,
  AcDbHatch,
  AcDbLine,
  AcDbPoly2dType,
  AcDbPolyline,
  AcDbRay,
  AcDbText,
  AcDbXline
} from '../src/entity'
import { AcDbIntersect } from '../src/misc'

const createDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

function expectPoint(
  points: AcGePoint3d[],
  expected: { x: number; y: number; z: number },
  digits = 5
) {
  const match = points.find(
    point =>
      Math.abs(point.x - expected.x) < 10 ** -digits &&
      Math.abs(point.y - expected.y) < 10 ** -digits &&
      Math.abs(point.z - expected.z) < 10 ** -digits
  )
  expect(match).toBeDefined()
}

describe('AcDbEntity.intersectWith', () => {
  it('intersects two crossing line segments', () => {
    const a = new AcDbLine(new AcGePoint3d(0, 0, 0), new AcGePoint3d(10, 0, 0))
    const b = new AcDbLine(new AcGePoint3d(5, -5, 0), new AcGePoint3d(5, 5, 0))

    const points = a.intersectWith(b)
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 5, y: 0, z: 0 })
  })

  it('intersects a line with a circle', () => {
    const line = new AcDbLine(
      new AcGePoint3d(-10, 0, 0),
      new AcGePoint3d(10, 0, 0)
    )
    const circle = new AcDbCircle(new AcGePoint3d(0, 0, 0), 5)

    const points = line.intersectWith(circle)
    expect(points).toHaveLength(2)
    expectPoint(points, { x: -5, y: 0, z: 0 })
    expectPoint(points, { x: 5, y: 0, z: 0 })
  })

  it('intersects a line with a bulged polyline segment', () => {
    const polyline = new AcDbPolyline()
    polyline.addVertexAt(0, new AcGePoint2d(0, 0), 1)
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))
    const line = new AcDbLine(
      new AcGePoint3d(1, -2, 0),
      new AcGePoint3d(1, 2, 0)
    )

    const points = polyline.intersectWith(line)
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 1, y: -1, z: 0 })
  })

  it('does not extend a closed or middle polyline segment', () => {
    const polyline = new AcDbPolyline()
    polyline.addVertexAt(0, new AcGePoint2d(0, 0))
    polyline.addVertexAt(1, new AcGePoint2d(2, 0))
    polyline.addVertexAt(2, new AcGePoint2d(2, 2))
    polyline.addVertexAt(3, new AcGePoint2d(4, 2))
    const line = new AcDbLine(
      new AcGePoint3d(1, 5, 0),
      new AcGePoint3d(3, 5, 0)
    )

    expect(polyline.intersectWith(line, AcDbIntersect.ExtendThis)).toEqual([])
  })

  it('extends a bounded line when ExtendThis is set', () => {
    const shortLine = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(4, 0, 0)
    )
    const vertical = new AcDbLine(
      new AcGePoint3d(8, -1, 0),
      new AcGePoint3d(8, 1, 0)
    )

    expect(shortLine.intersectWith(vertical)).toEqual([])
    const extended = shortLine.intersectWith(vertical, AcDbIntersect.ExtendThis)
    expect(extended).toHaveLength(1)
    expectPoint(extended, { x: 8, y: 0, z: 0 })
  })

  it('intersects a ray ahead of its origin but not behind it', () => {
    const ray = new AcDbRay()
    ray.basePoint = new AcGePoint3d(0, 0, 0)
    ray.unitDir = new AcGeVector3d(1, 0, 0)

    const ahead = new AcDbLine(
      new AcGePoint3d(5, -1, 0),
      new AcGePoint3d(5, 1, 0)
    )
    const behind = new AcDbLine(
      new AcGePoint3d(-5, -1, 0),
      new AcGePoint3d(-5, 1, 0)
    )

    const aheadPoints = ray.intersectWith(ahead)
    expect(aheadPoints).toHaveLength(1)
    expectPoint(aheadPoints, { x: 5, y: 0, z: 0 })
    expect(ray.intersectWith(behind)).toEqual([])
  })

  it('intersects an xline on both sides of its base point', () => {
    const xline = new AcDbXline()
    xline.basePoint = new AcGePoint3d(0, 0, 0)
    xline.unitDir = new AcGeVector3d(1, 0, 0)

    const behind = new AcDbLine(
      new AcGePoint3d(-5, -1, 0),
      new AcGePoint3d(-5, 1, 0)
    )
    const points = xline.intersectWith(behind)
    expect(points).toHaveLength(1)
    expectPoint(points, { x: -5, y: 0, z: 0 })
  })

  it('intersects a hatch boundary', () => {
    const hatch = new AcDbHatch()
    hatch.add(
      new AcGePolyline2d(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 }
        ],
        true
      )
    )
    const line = new AcDbLine(
      new AcGePoint3d(-1, 5, 0),
      new AcGePoint3d(11, 5, 0)
    )

    const points = hatch.intersectWith(line)
    expect(points).toHaveLength(2)
    expectPoint(points, { x: 0, y: 5, z: 0 })
    expectPoint(points, { x: 10, y: 5, z: 0 })
  })

  it('intersects a line inside a block reference after insertion transform', () => {
    const db = createDb()
    const block = new AcDbBlockTableRecord()
    block.name = 'LINE_BLOCK'
    block.appendEntity(
      new AcDbLine(new AcGePoint3d(0, 0, 0), new AcGePoint3d(10, 0, 0))
    )
    db.tables.blockTable.add(block)

    const insert = new AcDbBlockReference('LINE_BLOCK')
    insert.position = new AcGePoint3d(0, 10, 0)
    db.tables.blockTable.modelSpace.appendEntity(insert)

    const cutter = new AcDbLine(
      new AcGePoint3d(5, 5, 0),
      new AcGePoint3d(5, 15, 0)
    )
    const points = insert.intersectWith(cutter)
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 5, y: 10, z: 0 })
  })

  it('intersects a line inside a dimension anonymous block', () => {
    const db = createDb()
    const dimBlock = new AcDbBlockTableRecord()
    dimBlock.name = '*D_INTERSECT'
    dimBlock.appendEntity(
      new AcDbLine(new AcGePoint3d(1, 2, 0), new AcGePoint3d(4, 2, 0))
    )
    db.tables.blockTable.add(dimBlock)

    const dim = new AcDbAlignedDimension(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(5, 0, 0),
      new AcGePoint3d(5, 1, 0)
    )
    dim.dimBlockId = '*D_INTERSECT'
    dim.dimBlockPosition = new AcGePoint3d(10, 20, 0)
    db.tables.blockTable.modelSpace.appendEntity(dim)

    const cutter = new AcDbLine(
      new AcGePoint3d(12.5, 20, 0),
      new AcGePoint3d(12.5, 24, 0)
    )
    const points = dim.intersectWith(cutter)
    expect(points).toHaveLength(1)
    expectPoint(points, { x: 12.5, y: 22, z: 0 })
  })

  it('returns an empty array when a text entity is one operand', () => {
    const text = new AcDbText()
    text.position = new AcGePoint3d(0, 0, 0)
    text.height = 2
    text.textString = 'A'
    const line = new AcDbLine(
      new AcGePoint3d(-1, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )

    expect(text.intersectWith(line)).toEqual([])
    expect(line.intersectWith(text)).toEqual([])
  })

  it('intersects a 2d polyline using its extrusion normal', () => {
    const polyline = new AcDb2dPolyline(AcDbPoly2dType.SimplePoly, [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 }
    ])
    polyline.normal = { x: 0, y: 1, z: 0 }
    const start = acgeTransformOcsPointToWcs(
      { x: 0, y: 0, z: 0 },
      polyline.normal
    )
    const end = acgeTransformOcsPointToWcs(
      { x: 10, y: 0, z: 0 },
      polyline.normal
    )
    const mid = new AcGePoint3d().addVectors(start, end).multiplyScalar(0.5)
    const dir = new AcGeVector3d().subVectors(end, start)
    const perp = new AcGeVector3d(-dir.y, dir.x, dir.z)
    if (perp.lengthSq() < 1e-20) {
      perp.set(0, 0, 1)
    }
    perp.normalize()
    const cutter = new AcDbLine(
      mid.clone().add(perp),
      mid.clone().addScaledVector(perp, -1)
    )

    const points = polyline.intersectWith(cutter)
    expect(points).toHaveLength(1)
    expectPoint(points, mid)
  })

  it('intersects a hatch using its extrusion normal', () => {
    const hatch = new AcDbHatch()
    hatch.normal = { x: 0, y: 1, z: 0 }
    hatch.add(
      new AcGePolyline2d(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 }
        ],
        true
      )
    )
    const a = acgeTransformOcsPointToWcs({ x: 0, y: 0, z: 0 }, hatch.normal)
    const b = acgeTransformOcsPointToWcs({ x: 10, y: 0, z: 0 }, hatch.normal)
    const mid = new AcGePoint3d().addVectors(a, b).multiplyScalar(0.5)
    const dir = new AcGeVector3d().subVectors(b, a)
    const perp = new AcGeVector3d(-dir.y, dir.x, dir.z)
    if (perp.lengthSq() < 1e-20) perp.set(0, 0, 1)
    perp.normalize()
    const cutter = new AcDbLine(
      mid.clone().add(perp),
      mid.clone().addScaledVector(perp, -1)
    )

    const points = hatch.intersectWith(cutter)
    expect(points).toHaveLength(1)
    expectPoint(points, mid)
  })
})

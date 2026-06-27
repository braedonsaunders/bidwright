import { AcGePoint2d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbWipeout } from '../src/entity'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbWipeout', () => {
  it('exposes static and DXF type names', () => {
    const wipeout = new AcDbWipeout()

    expect(AcDbWipeout.typeName).toBe('Wipeout')
    expect(wipeout.dxfTypeName).toBe('WIPEOUT')
  })

  it('draws an area from the rectangular boundary path when not clipped', () => {
    const wipeout = new AcDbWipeout()
    wipeout.position = new AcGePoint3d(10, 20, 3)
    wipeout.width = 4
    wipeout.height = 3

    const rendered = { id: 'wipeout-rendered' }
    const renderer = {
      area: jest.fn(() => rendered)
    }

    const result = wipeout.subWorldDraw(renderer as never)
    const areaArg = (renderer.area as jest.Mock).mock.calls[0][0] as {
      loops: Array<{
        getPoints: (numPoints: number) => Array<{ x: number; y: number }>
      }>
    }
    const boundary = areaArg.loops[0].getPoints(4)

    expect(result).toBe(rendered)
    expect(renderer.area).toHaveBeenCalledTimes(1)
    expect(boundary).toHaveLength(5)
    expect(boundary[0]).toMatchObject({ x: 10, y: 20 })
    expect(boundary[1]).toMatchObject({ x: 14, y: 20 })
    expect(boundary[2]).toMatchObject({ x: 14, y: 23 })
    expect(boundary[3]).toMatchObject({ x: 10, y: 23 })
    expect(boundary[4]).toMatchObject({ x: 10, y: 20 })
  })

  it('draws an area from clip boundary vertices when clipped', () => {
    const wipeout = new AcDbWipeout()
    wipeout.position = new AcGePoint3d(100, 200, 0)
    wipeout.width = 10
    wipeout.height = 20
    wipeout.isClipped = true
    wipeout.clipBoundary = [
      new AcGePoint2d(2, 3),
      new AcGePoint2d(4, 3),
      new AcGePoint2d(4, 5),
      new AcGePoint2d(2, 5)
    ]

    const renderer = {
      area: jest.fn(() => 'ok')
    }

    wipeout.subWorldDraw(renderer as never)
    const areaArg = (renderer.area as jest.Mock).mock.calls[0][0] as {
      loops: Array<{
        getPoints: (numPoints: number) => Array<{ x: number; y: number }>
      }>
    }
    const boundary = areaArg.loops[0].getPoints(4)

    expect(boundary).toHaveLength(4)
    expect(boundary[0]).toMatchObject({ x: 100, y: 200 })
    expect(boundary[1]).toMatchObject({ x: 120, y: 200 })
    expect(boundary[2]).toMatchObject({ x: 120, y: 240 })
    expect(boundary[3]).toMatchObject({ x: 100, y: 240 })
  })

  it('writes wipeout DXF fields using raster-image subclass marker', () => {
    createWorkingDb()
    const wipeout = new AcDbWipeout()
    wipeout.ownerId = 'ABC'
    wipeout.position = new AcGePoint3d(1, 2, 3)
    wipeout.width = 5
    wipeout.height = 6
    wipeout.imageSize = new AcGePoint2d(5, 6)

    const filer = new AcDbDxfFiler()
    const result = wipeout.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(result).toBe(wipeout)
    expect(dxf).toContain('100\nAcDbEntity\n')
    expect(dxf).toContain('100\nAcDbRasterImage\n')
    expect(dxf).not.toContain('AcDbWipeout')
    expect(dxf).toContain('10\n1\n20\n2\n30\n3\n')
    expect(dxf).toContain('13\n5\n23\n6\n')
  })
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbWipeout())
  })

  it('returns geometricExtents and updates when position and size change', () => {
    createWorkingDb()
    const wipeout = new AcDbWipeout()
    wipeout.position = new AcGePoint3d(0, 0, 0)
    wipeout.width = 10
    wipeout.height = 10

    expect(wipeout.geometricExtents.max).toMatchObject({ x: 10, y: 10 })

    wipeout.position = new AcGePoint3d(5, 5, 0)
    wipeout.width = 20
    wipeout.height = 30

    expect(wipeout.geometricExtents.min).toMatchObject({ x: 5, y: 5 })
    expect(wipeout.geometricExtents.max).toMatchObject({ x: 25, y: 35 })
  })
})

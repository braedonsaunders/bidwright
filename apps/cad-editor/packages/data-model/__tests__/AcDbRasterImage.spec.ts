import {
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGeVector2d
} from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbRasterImage, AcDbRasterImageClipBoundaryType } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { AcDbRasterImageDef } from '../src/object/AcDbRasterImageDef'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbRasterImage', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbRasterImage())
  })
  const createRenderer = () => ({
    lines: jest.fn(() => ({ kind: 'lines' })),
    image: jest.fn(() => ({ kind: 'image' }))
  })

  const parsePairs = (text: string) => {
    const lines = text.trim().split('\n')
    const pairs: Array<{ code: string; value: string }> = []
    for (let i = 0; i < lines.length; i += 2) {
      pairs.push({ code: lines[i], value: lines[i + 1] })
    }
    return pairs
  }

  const valuesByCode = (
    pairs: Array<{ code: string; value: string }>,
    code: string
  ) => pairs.filter(pair => pair.code === code).map(pair => pair.value)

  const setupInDatabase = () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    acdbHostApplicationServices().workingDatabase = db
    const image = new AcDbRasterImage()
    db.tables.blockTable.modelSpace.appendEntity(image)
    return { db, image }
  }

  it('exposes dxf type name and all property getter/setters', () => {
    const { image } = setupInDatabase()

    expect(image.dxfTypeName).toBe('IMAGE')

    image.brightness = 80
    image.contrast = 70
    image.fade = 10
    image.width = 120
    image.height = 90
    image.position = new AcGePoint3d(5, 6, 0)
    image.rotation = Math.PI / 3
    image.scale = new AcGeVector2d(2, 3)
    image.imageSize = new AcGePoint2d(400, 300)
    image.clipBoundaryType = AcDbRasterImageClipBoundaryType.Poly
    image.clipBoundary = [
      new AcGePoint2d(0.1, 0.1),
      new AcGePoint2d(0.9, 0.1),
      new AcGePoint2d(0.9, 0.9),
      new AcGePoint2d(0.1, 0.9)
    ]
    image.isClipped = true
    image.isShownClipped = true
    image.isImageShown = false
    image.isImageTransparent = true
    const blob = new Blob(['a'], { type: 'text/plain' })
    image.image = blob
    image.imageDefId = 'ABC'

    expect(image.brightness).toBe(80)
    expect(image.contrast).toBe(70)
    expect(image.fade).toBe(10)
    expect(image.width).toBe(120)
    expect(image.height).toBe(90)
    expect(image.position.x).toBe(5)
    expect(image.position.y).toBe(6)
    expect(image.rotation).toBeCloseTo(Math.PI / 3)
    expect(image.scale.x).toBe(2)
    expect(image.scale.y).toBe(3)
    expect(image.imageSize.x).toBe(400)
    expect(image.imageSize.y).toBe(300)
    expect(image.clipBoundaryType).toBe(AcDbRasterImageClipBoundaryType.Poly)
    expect(image.clipBoundary.length).toBe(4)
    expect(image.isClipped).toBe(true)
    expect(image.isShownClipped).toBe(true)
    expect(image.isImageShown).toBe(false)
    expect(image.isImageTransparent).toBe(true)
    expect(image.image).toBe(blob)
    expect(image.imageDefId).toBe('ABC')
  })

  it('resolves image file name from image definition dictionary', () => {
    const { db, image } = setupInDatabase()

    expect(image.imageFileName).toBe('')

    image.imageDefId = 'NOT_EXIST'
    expect(image.imageFileName).toBe('')

    const imageDef = new AcDbRasterImageDef()
    imageDef.sourceFileName = 'textures/test.png'
    db.objects.imageDefinition.setAt('TEST_IMG_DEF', imageDef)
    image.imageDefId = imageDef.objectId
    expect(image.imageFileName).toBe('textures/test.png')
  })

  it('calculates geometric extents', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(10, 20, 0)
    image.width = 30
    image.height = 40

    const extents = image.geometricExtents
    expect(extents.min.x).toBe(10)
    expect(extents.min.y).toBe(20)
    expect(extents.max.x).toBe(40)
    expect(extents.max.y).toBe(60)
  })

  it('updates geometricExtents when position and size change', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(0, 0, 0)
    image.width = 10
    image.height = 10

    expect(image.geometricExtents.max).toMatchObject({ x: 10, y: 10 })

    image.position = new AcGePoint3d(5, 5, 0)
    image.width = 20
    image.height = 30

    expect(image.geometricExtents.min).toMatchObject({ x: 5, y: 5 })
    expect(image.geometricExtents.max).toMatchObject({ x: 25, y: 35 })
  })

  it('returns grip points with rectangular boundary and clipping boundary', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(1, 2, 0)
    image.width = 10
    image.height = 8
    image.rotation = Math.PI / 4

    const rectangular = image.subGetGripPoints()
    expect(rectangular.length).toBe(5)
    expect(rectangular[0].x).toBeCloseTo(1)
    expect(rectangular[0].y).toBeCloseTo(2)
    expect(rectangular[4].x).toBeCloseTo(rectangular[0].x)
    expect(rectangular[4].y).toBeCloseTo(rectangular[0].y)

    image.clipBoundary = [
      new AcGePoint2d(0.2, 0.2),
      new AcGePoint2d(0.8, 0.2),
      new AcGePoint2d(0.8, 0.8),
      new AcGePoint2d(0.2, 0.8)
    ]
    image.isClipped = true

    const clipped = image.subGetGripPoints()
    expect(clipped.length).toBe(4)
    expect(clipped[0].z).toBe(0)
  })

  it('computes insertion and endpoint osnap points', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(3, 4, 0)
    image.width = 10
    image.height = 8

    const insertionSnaps: AcGePoint3d[] = []
    image.subGetOsnapPoints(
      AcDbOsnapMode.Insertion,
      new AcGePoint3d(),
      new AcGePoint3d(),
      insertionSnaps
    )
    expect(insertionSnaps).toHaveLength(1)
    expect(insertionSnaps[0]).toMatchObject({ x: 3, y: 4, z: 0 })

    const endPoints: AcGePoint3d[] = []
    image.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endPoints
    )
    expect(endPoints.length).toBeGreaterThanOrEqual(4)

    const midPoints: AcGePoint3d[] = []
    image.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(4)

    const nearestPoints: AcGePoint3d[] = []
    image.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(8, 4, 0),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0].x).toBeCloseTo(8)
    expect(nearestPoints[0].y).toBeCloseTo(4)

    const perpendicularPoints: AcGePoint3d[] = []
    image.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(8, 10, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
  })

  it('draws via renderer.lines when image data is absent and renderer.image when present', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(0, 0, 0)
    image.width = 12
    image.height = 6

    const renderer = createRenderer()
    const lineDrawable = image.subWorldDraw(renderer as never)
    expect(lineDrawable).toEqual({ kind: 'lines' })
    expect(renderer.lines).toHaveBeenCalledTimes(1)
    expect(renderer.image).not.toHaveBeenCalled()

    image.image = new Blob(['raw'], { type: 'application/octet-stream' })
    const imageDrawable = image.subWorldDraw(renderer as never)
    expect(imageDrawable).toEqual({ kind: 'image' })
    expect(renderer.image).toHaveBeenCalledTimes(1)
  })

  it('transforms geometry and resets scale', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(0, 0, 0)
    image.width = 10
    image.height = 5
    image.scale = new AcGeVector2d(2, 3)
    image.rotation = 0

    const result = image.transformBy(new AcGeMatrix3d().makeScale(2, 2, 1))
    expect(result).toBe(image)
    expect(image.position.x).toBeCloseTo(0)
    expect(image.position.y).toBeCloseTo(0)
    expect(image.rotation).toBeCloseTo(0)
    expect(image.width).toBeCloseTo(40)
    expect(image.height).toBeCloseTo(30)
    expect(image.scale.x).toBe(1)
    expect(image.scale.y).toBe(1)
  })

  it('writes dxf fields with fallback imageSize and without clipping vertices', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(3, 4, 0)
    image.width = 20
    image.height = 10
    image.scale = new AcGeVector2d(2, 3)
    image.rotation = 0
    image.imageSize = new AcGePoint2d(0, 0)
    image.isImageShown = true
    image.isShownClipped = false
    image.isImageTransparent = false
    image.isClipped = false
    image.brightness = 55
    image.contrast = 44
    image.fade = 33
    image.imageDefId = ''

    const filer = new AcDbDxfFiler()
    const result = image.dxfOutFields(filer)
    expect(result).toBe(image)

    const pairs = parsePairs(filer.toString())
    expect(valuesByCode(pairs, '100')).toContain('AcDbRasterImage')
    expect(valuesByCode(pairs, '10')).toContain('3')
    expect(valuesByCode(pairs, '20')).toContain('4')
    expect(valuesByCode(pairs, '13')).toContain('40')
    expect(valuesByCode(pairs, '23')).toContain('30')
    expect(valuesByCode(pairs, '70')).toContain('1')
    expect(valuesByCode(pairs, '280')).toContain('0')
    expect(valuesByCode(pairs, '281')).toContain('55')
    expect(valuesByCode(pairs, '282')).toContain('44')
    expect(valuesByCode(pairs, '283')).toContain('33')
    expect(valuesByCode(pairs, '91')).toHaveLength(0)
  })

  it('writes dxf fields with explicit imageSize and clipping vertices', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(0, 0, 0)
    image.width = 10
    image.height = 20
    image.scale = new AcGeVector2d(1, 1)
    image.rotation = Math.PI / 2
    image.imageSize = new AcGePoint2d(5, 10)
    image.isImageShown = false
    image.isShownClipped = true
    image.isImageTransparent = true
    image.isClipped = true
    image.clipBoundaryType = AcDbRasterImageClipBoundaryType.Poly
    image.clipBoundary = [
      new AcGePoint2d(0, 0),
      new AcGePoint2d(1, 0),
      new AcGePoint2d(1, 1),
      new AcGePoint2d(0, 1)
    ]

    const filer = new AcDbDxfFiler()
    image.dxfOutFields(filer)
    const pairs = parsePairs(filer.toString())
    expect(valuesByCode(pairs, '13')).toContain('5')
    expect(valuesByCode(pairs, '23')).toContain('10')
    expect(valuesByCode(pairs, '70')).toContain('12')
    expect(valuesByCode(pairs, '71')).toContain(
      String(AcDbRasterImageClipBoundaryType.Poly)
    )
    expect(valuesByCode(pairs, '280')).toContain('1')
    expect(valuesByCode(pairs, '91')).toContain('4')
    expect(valuesByCode(pairs, '14')).toEqual(['0', '1', '1', '0'])
    expect(valuesByCode(pairs, '24')).toEqual(['0', '0', '1', '1'])
  })

  it('writes zero pixel vectors when width and height are zero', () => {
    const { image } = setupInDatabase()
    image.position = new AcGePoint3d(0, 0, 0)
    image.width = 0
    image.height = 0
    image.scale = new AcGeVector2d(1, 1)
    image.imageSize = new AcGePoint2d(0, 0)

    const filer = new AcDbDxfFiler()
    image.dxfOutFields(filer)
    const pairs = parsePairs(filer.toString())

    expect(valuesByCode(pairs, '11')).toContain('0')
    expect(valuesByCode(pairs, '21')).toContain('0')
    expect(valuesByCode(pairs, '12')).toContain('0')
    expect(valuesByCode(pairs, '22')).toContain('0')
  })
})

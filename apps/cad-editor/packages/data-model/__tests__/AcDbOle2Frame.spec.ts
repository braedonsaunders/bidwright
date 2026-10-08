import fs from 'node:fs'
import path from 'node:path'

import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler, acdbHostApplicationServices } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { acdbDxfInEntity } from '../src/dxf/AcDbDxfEntityFactory'
import {
  AcDbOle2Frame,
  AcDbOleObjectType,
  AcDbOleTileMode
} from '../src/entity'
import { acdbParseOle2FrameGeometryHeader } from '../src/misc/AcDbOle2FrameGeometry'
import { acdbExtractOleImageBlob } from '../src/misc/AcDbOleImageExtractor'
import { acdbReassembleEmfFromWmfEscapes } from '../src/misc/AcDbOleMetafileDetect'
import {
  acdbBytesToHexString,
  acdbCombineDxfBinaryChunks
} from '../src/misc/proxyGraphic'

/**
 * Builds a minimal 1x1 24-bit BMP (white pixel).
 */
function createMinimalBmp() {
  // BITMAPFILEHEADER (14) + BITMAPINFOHEADER (40) + pixel row (4 bytes padded)
  const bmp = new Uint8Array(58)
  const view = new DataView(bmp.buffer)
  bmp[0] = 0x42 // B
  bmp[1] = 0x4d // M
  view.setUint32(2, 58, true) // bfSize
  view.setUint32(10, 54, true) // bfOffBits
  view.setUint32(14, 40, true) // biSize
  view.setInt32(18, 1, true) // biWidth
  view.setInt32(22, 1, true) // biHeight
  view.setUint16(26, 1, true) // biPlanes
  view.setUint16(28, 24, true) // biBitCount
  view.setUint32(34, 4, true) // biSizeImage
  // Pixel BGR + pad
  bmp[54] = 0xff
  bmp[55] = 0xff
  bmp[56] = 0xff
  bmp[57] = 0x00
  return bmp
}

describe('acdbExtractOleImageBlob', () => {
  it('extracts a BMP embedded directly in the OLE payload', () => {
    const bmp = createMinimalBmp()
    const padded = new Uint8Array(32 + bmp.length)
    padded.set([0x01, 0x55, 0x80], 0)
    padded.set(bmp, 32)

    const blob = acdbExtractOleImageBlob(padded)
    expect(blob).toBeDefined()
    expect(blob?.type).toBe('image/bmp')
    expect(blob?.size).toBe(bmp.length)
  })

  it('extracts a packed DIB by wrapping it as BMP', () => {
    const dib = new Uint8Array(44)
    const view = new DataView(dib.buffer)
    view.setUint32(0, 40, true) // biSize
    view.setInt32(4, 1, true) // width
    view.setInt32(8, 1, true) // height
    view.setUint16(12, 1, true) // planes
    view.setUint16(14, 24, true) // bitCount
    view.setUint32(20, 4, true) // sizeImage
    dib[40] = 0x11
    dib[41] = 0x22
    dib[42] = 0x33
    dib[43] = 0x00

    const blob = acdbExtractOleImageBlob(dib)
    expect(blob).toBeDefined()
    expect(blob?.type).toBe('image/bmp')
    expect(blob?.size).toBe(14 + dib.length)
  })

  it('returns undefined for non-image payloads', () => {
    expect(
      acdbExtractOleImageBlob(new Uint8Array([1, 2, 3, 4]))
    ).toBeUndefined()
    expect(acdbExtractOleImageBlob(undefined)).toBeUndefined()
  })

  it('extracts a standalone WMF payload as image/wmf', () => {
    // Minimal standard WMF: header (9 words) + META_EOF (3 words).
    const wmf = new Uint8Array(24)
    const wmfView = new DataView(wmf.buffer)
    wmfView.setUint16(0, 1, true) // mtType memory
    wmfView.setUint16(2, 9, true) // mtHeaderSize
    wmfView.setUint16(4, 0x0300, true) // mtVersion
    wmfView.setUint32(6, 12, true) // mtSize in words
    // META_EOF at offset 18
    wmfView.setUint32(18, 3, true)
    wmfView.setUint16(22, 0, true)

    const blob = acdbExtractOleImageBlob(wmf)
    expect(blob).toBeDefined()
    expect(blob?.type).toBe('image/wmf')
    expect(blob?.size).toBe(wmf.length)
  })

  it('extracts the Excel OLE preview metafile from a real OLE2FRAME payload', () => {
    const fixture = path.join(__dirname, 'fixtures', 'excel-ole2frame.bin')
    expect(fs.existsSync(fixture)).toBe(true)
    const data = new Uint8Array(fs.readFileSync(fixture))
    const blob = acdbExtractOleImageBlob(data)
    expect(blob).toBeDefined()
    // Excel CF_ENHMETAFILE is a WMF that embeds EMF via WMFC escapes; we
    // reassemble a contiguous EMF so the full table (not only ~8 rows) converts.
    expect(blob?.type).toBe('image/emf')
    expect(blob?.size || 0).toBe(76788)
  })

  it('prefers Ole10Native BMP over OlePres WMF for Paintbrush OLE', () => {
    // From ole-image.dxf handle 28D: `\2OlePres000` is CF_METAFILEPICT (WMF)
    // while `\1Ole10Native` holds the real BMP (white + CJK glyph). Preferring
    // the metafile preview yields a blank white texture after rasterization.
    const fixture = path.join(__dirname, 'fixtures', 'paintbrush-ole2frame.bin')
    expect(fs.existsSync(fixture)).toBe(true)
    const data = new Uint8Array(fs.readFileSync(fixture))
    const blob = acdbExtractOleImageBlob(data)
    expect(blob).toBeDefined()
    expect(blob?.type).toBe('image/bmp')
    expect(blob?.size || 0).toBe(107406)
  })

  it('reassembles a contiguous EMF from WMF WMFC escape chunks', () => {
    const fixture = path.join(__dirname, 'fixtures', 'excel-ole-pres.wmf')
    expect(fs.existsSync(fixture)).toBe(true)
    const wmf = new Uint8Array(fs.readFileSync(fixture))
    const emf = acdbReassembleEmfFromWmfEscapes(wmf)
    expect(emf).toBeInstanceOf(Uint8Array)

    const view = new DataView(emf!.buffer, emf!.byteOffset, emf!.byteLength)
    expect(view.getUint32(0, true)).toBe(1)
    const nBytes = view.getUint32(48, true)
    const nRecords = view.getUint32(52, true)
    expect(nBytes).toBe(emf!.length)

    let offset = 0
    let walked = 0
    let reachedEof = false
    for (let r = 0; r < nRecords; r++) {
      const type = view.getUint32(offset, true)
      const size = view.getUint32(offset + 4, true)
      expect(size).toBeGreaterThanOrEqual(8)
      expect(offset + size).toBeLessThanOrEqual(nBytes)
      walked++
      offset += size
      if (type === 14) {
        reachedEof = true
        break
      }
    }
    expect(reachedEof).toBe(true)
    expect(walked).toBe(nRecords)
    expect(nRecords).toBeGreaterThan(1000)
  })
})

/**
 * Builds a minimal OLE2FRAME payload: geometry header + MS-CFB signature stub.
 * Corner values match the first OLE2FRAME in ole-image.dxf.
 */
function createOle2FramePayloadWithGeometry() {
  const data = new Uint8Array(0x80 + 8)
  const view = new DataView(data.buffer)
  view.setUint16(0, 0x5580, true)
  const corners = [
    [-3680.787802750127, 5561.435617040696, 0],
    [-472.4008522669919, 5561.435617040696, 0],
    [-472.4008522669919, 4997.020213510076, 0],
    [-3680.787802750127, 4997.020213510076, 0]
  ]
  for (let i = 0; i < corners.length; i++) {
    const offset = 2 + i * 24
    view.setFloat64(offset, corners[i][0], true)
    view.setFloat64(offset + 8, corners[i][1], true)
    view.setFloat64(offset + 16, corners[i][2], true)
  }
  // MS-CFB signature at 0x80 (compound body intentionally empty for this test)
  data.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0x80)
  return data
}

describe('acdbParseOle2FrameGeometryHeader', () => {
  it('reads WCS corners from the OLE2FRAME geometry header', () => {
    const header = acdbParseOle2FrameGeometryHeader(
      createOle2FramePayloadWithGeometry()
    )
    expect(header).toBeDefined()
    if (!header) {
      return
    }
    expect(header.upperLeft.x).toBeCloseTo(-3680.787802750127)
    expect(header.upperLeft.y).toBeCloseTo(5561.435617040696)
    expect(header.lowerRight.x).toBeCloseTo(-472.4008522669919)
    expect(header.lowerRight.y).toBeCloseTo(4997.020213510076)
  })

  it('returns undefined for payloads without a CFB geometry header', () => {
    expect(acdbParseOle2FrameGeometryHeader(createMinimalBmp())).toBeUndefined()
  })
})

describe('AcDbOle2Frame image drawing', () => {
  it('applies frame corners from the OLE binary geometry header', () => {
    const ole = new AcDbOle2Frame()
    // Simulate DWG conversion: payload only, no DXF group 10/11 corners.
    ole.loadOleObjectFromDxf(undefined, createOle2FramePayloadWithGeometry())

    expect(ole.upperLeftCorner.x).toBeCloseTo(-3680.787802750127)
    expect(ole.upperLeftCorner.y).toBeCloseTo(5561.435617040696)
    expect(ole.lowerRightCorner.x).toBeCloseTo(-472.4008522669919)
    expect(ole.lowerRightCorner.y).toBeCloseTo(4997.020213510076)
    expect(ole.wcsWidth()).toBeGreaterThan(0)
    expect(ole.wcsHeight()).toBeGreaterThan(0)
  })

  it('draws extracted image through renderer.image', () => {
    const ole = new AcDbOle2Frame()
    ole.upperLeftCorner = new AcGePoint3d(0, 10, 0)
    ole.lowerRightCorner = new AcGePoint3d(20, 0, 0)
    ole.setOleObject(createMinimalBmp())

    expect(ole.image).toBeDefined()
    expect(ole.image?.type).toBe('image/bmp')

    const renderer = {
      lines: jest.fn((_points: AcGePoint3d[]) => ({ kind: 'lines' })),
      image: jest.fn(
        (
          _blob: Blob,
          _style: { boundary: AcGePoint3d[]; roation: number }
        ) => ({
          kind: 'image'
        })
      )
    }
    const drawable = ole.subWorldDraw(renderer as never)
    expect(drawable).toEqual({ kind: 'image' })
    expect(renderer.image).toHaveBeenCalledTimes(1)
    expect(renderer.lines).not.toHaveBeenCalled()

    const [blob, style] = renderer.image.mock.calls[0]
    expect(blob).toBe(ole.image)
    expect(style.boundary).toHaveLength(5)
    expect(style.boundary[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(style.boundary[1]).toMatchObject({ x: 20, y: 0, z: 0 })
    expect(style.boundary[2]).toMatchObject({ x: 20, y: 10, z: 0 })
    expect(style.boundary[3]).toMatchObject({ x: 0, y: 10, z: 0 })
  })

  it('falls back to a pickable frame when no image is present', () => {
    const ole = new AcDbOle2Frame()
    ole.upperLeftCorner = new AcGePoint3d(0, 5, 0)
    ole.lowerRightCorner = new AcGePoint3d(5, 0, 0)

    const renderer = {
      lines: jest.fn((_points: AcGePoint3d[]) => ({ kind: 'lines' })),
      image: jest.fn(
        (
          _blob: Blob,
          _style: { boundary: AcGePoint3d[]; roation: number }
        ) => ({
          kind: 'image'
        })
      ),
      area: jest.fn(() => ({ kind: 'area' })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities })),
      subEntityTraits: {
        fillType: undefined as unknown,
        transparency: undefined as unknown
      }
    }
    const drawable = ole.subWorldDraw(renderer as never)
    expect(drawable).toEqual({
      kind: 'group',
      entities: [{ kind: 'area' }, { kind: 'lines' }]
    })
    expect(renderer.image).not.toHaveBeenCalled()
    expect(renderer.area).toHaveBeenCalledTimes(1)
    expect(renderer.lines).toHaveBeenCalledTimes(1)
  })

  it('dxfInFields keeps OLE binary when group 310 is Uint8Array', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()

    const bmp = createMinimalBmp()
    const hex = acdbBytesToHexString(bmp)
    // Native ASCII pair reader yields Uint8Array for group 310. Calling
    // String(Uint8Array) would corrupt the CFB/image payload.
    const dxf = [
      '0',
      'OLE2FRAME',
      '5',
      '1A',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbOle2Frame',
      '70',
      '1',
      '3',
      'Paintbrush Picture',
      '10',
      '0.0',
      '20',
      '10.0',
      '30',
      '0.0',
      '11',
      '20.0',
      '21',
      '0.0',
      '31',
      '0.0',
      '71',
      '2',
      '72',
      '1',
      '90',
      String(bmp.length),
      '310',
      hex,
      '1',
      'OLE',
      '0',
      'ENDSEC'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(dxf)
    const entity = acdbDxfInEntity(filer)
    expect(entity).toBeInstanceOf(AcDbOle2Frame)
    const ole = entity as AcDbOle2Frame

    const payload = ole.getOleObject()
    expect(payload).toBeDefined()
    expect(Array.from(payload!)).toEqual(Array.from(bmp))
    expect(ole.image).toBeDefined()
    expect(ole.image?.type).toBe('image/bmp')
  })

  it('acdbCombineDxfBinaryChunks accepts mixed hex and Uint8Array chunks', () => {
    const a = new Uint8Array([0xd0, 0xcf])
    const b = '11E0'
    const combined = acdbCombineDxfBinaryChunks([a, b])
    expect(Array.from(combined)).toEqual([0xd0, 0xcf, 0x11, 0xe0])
  })

  it('keeps transformed image and frame boundaries aligned', () => {
    const ole = new AcDbOle2Frame()
    ole.upperLeftCorner = new AcGePoint3d(0, 10, 0)
    ole.lowerRightCorner = new AcGePoint3d(20, 0, 0)
    ole.setOleObject(createMinimalBmp())
    ole.transformBy(new AcGeMatrix3d().makeRotationZ(Math.PI / 2))

    const imageRenderer = {
      lines: jest.fn(),
      image: jest.fn(
        (
          _blob: Blob,
          _style: { boundary: AcGePoint3d[]; roation: number }
        ) => ({
          kind: 'image'
        })
      )
    }
    ole.subWorldDraw(imageRenderer as never)

    const outlineRenderer = {
      lines: jest.fn((_points: AcGePoint3d[]) => ({ kind: 'lines' })),
      image: jest.fn(),
      area: jest.fn(() => ({ kind: 'area' })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities })),
      subEntityTraits: {
        fillType: undefined as unknown,
        transparency: undefined as unknown
      }
    }
    ole.setOleObject(new Uint8Array([0, 1, 2, 3]))
    ole.subWorldDraw(outlineRenderer as never)

    const imageBoundary = imageRenderer.image.mock.calls[0][1].boundary
    const frameBoundary = outlineRenderer.lines.mock.calls[0][0]
    const expectedImageBoundary = [
      frameBoundary[3],
      frameBoundary[2],
      frameBoundary[1],
      frameBoundary[0],
      frameBoundary[3]
    ]

    expectedImageBoundary.forEach((point, index) => {
      expect(imageBoundary[index].x).toBeCloseTo(point.x)
      expect(imageBoundary[index].y).toBeCloseTo(point.y)
      expect(imageBoundary[index].z).toBeCloseTo(point.z)
    })
  })

  it('invalidates cached image when OLE payload changes', () => {
    const ole = new AcDbOle2Frame()
    ole.setOleObject(createMinimalBmp())
    const first = ole.image
    expect(first).toBeDefined()

    ole.setOleObject(new Uint8Array([0, 1, 2, 3]))
    expect(ole.image).toBeUndefined()
  })

  it('exposes geometry and OLE properties with editable accessors', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const ole = new AcDbOle2Frame()
    ole.setLocation(new AcGePoint3d(10, 20, 5))
    ole.setWcsWidth(40)
    ole.setWcsHeight(30)
    ole.setRotation(0.5)
    ole.setScaleWidth(1.2)
    ole.setScaleHeight(0.8)
    ole.setLockAspect(true)
    ole.oleVersion = 2
    ole.userType = 'Paintbrush Picture'
    ole.oleObjectType = AcDbOleObjectType.Embedded
    ole.tileMode = AcDbOleTileMode.ModelSpace
    ole.setLinkName('chart')
    ole.setLinkPath('C:\\docs\\chart.xls')
    ole.setOutputQuality(3)
    ole.setAutoOutputQuality(1)

    const props = ole.properties
    expect(props.type).toBe('Ole2Frame')
    const geometry = props.groups.find(g => g.groupName === 'geometry')
    const oleGroup = props.groups.find(g => g.groupName === 'ole')
    expect(geometry).toBeDefined()
    expect(oleGroup).toBeDefined()

    const byName = Object.fromEntries(
      [...(geometry?.properties ?? []), ...(oleGroup?.properties ?? [])].map(
        p => [p.name, p]
      )
    )

    expect(byName.positionX.accessor.get()).toBe(10)
    expect(byName.positionY.accessor.get()).toBe(20)
    expect(byName.positionZ.accessor.get()).toBe(5)
    expect(byName.width.accessor.get()).toBe(40)
    expect(byName.height.accessor.get()).toBe(30)
    expect(byName.rotation.accessor.get()).toBe(0.5)
    expect(byName.scaleWidth.accessor.get()).toBe(1.2)
    expect(byName.scaleHeight.accessor.get()).toBe(0.8)
    expect(byName.lockAspect.accessor.get()).toBe(true)
    expect(byName.oleVersion.accessor.get()).toBe(2)
    expect(byName.userType.accessor.get()).toBe('Paintbrush Picture')
    expect(byName.oleObjectType.accessor.get()).toBe(AcDbOleObjectType.Embedded)
    expect(byName.tileMode.accessor.get()).toBe(AcDbOleTileMode.ModelSpace)
    expect(byName.linkName.accessor.get()).toBe('chart')
    expect(byName.linkPath.accessor.get()).toBe('C:\\docs\\chart.xls')
    expect(byName.outputQuality.accessor.get()).toBe(3)
    expect(byName.autoOutputQuality.accessor.get()).toBe(1)

    byName.positionX.accessor.set?.(15)
    byName.width.accessor.set?.(50)
    byName.userType.accessor.set?.('Excel Worksheet')
    byName.oleObjectType.accessor.set?.(AcDbOleObjectType.Link)
    byName.lockAspect.accessor.set?.(false)

    expect(ole.upperLeftCorner.x).toBe(15)
    expect(ole.wcsWidth()).toBe(50)
    expect(ole.userType).toBe('Excel Worksheet')
    expect(ole.oleObjectType).toBe(AcDbOleObjectType.Link)
    expect(ole.lockAspect()).toBe(false)
  })
})

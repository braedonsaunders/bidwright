import { AcCmColor, AcCmTransparency } from '@mlightcad/common'

import { AcDbDwgVersion } from '../src/database/AcDbDwgVersion'
import {
  AcDbDxfFiler,
  AcDbDxfFilerStatus
} from '../src/base/AcDbDxfFiler'
import { AcDbResultBuffer } from '../src/base/AcDbResultBuffer'
import {
  acdbCreateDxfPairReader,
  acdbMakeAsciiDxfPairReader,
  acdbMakeUtf8AsciiDxfPairReader
} from '../src/base/AcDbDxfPairReader'

describe('AcDbDxfFiler', () => {
  it('writes and formats DXF groups through helper methods', () => {
    const filer = new AcDbDxfFiler({ precision: 20, version: 'AC1015' })

    expect(filer.precision).toBe(16)
    expect(filer.version?.name).toBe('AC1015')
    expect(filer.nextHandle).toBe(1)

    filer.setPrecision(-1)
    expect(filer.precision).toBe(0)

    filer.setVersion(33)
    expect(filer.version).toBeInstanceOf(AcDbDwgVersion)

    expect(filer.registerHandle('abc')).toBe('ABC')
    expect(filer.resolveHandle('abc')).toBe('ABC')
    expect(filer.registerHandle('custom-id')).toBe('1')
    expect(filer.nextHandle).toBe(2)
    expect(filer.resolveHandle()).toBeUndefined()

    filer
      .startSection('HEADER')
      .writeSubclassMarker('AcDbTest')
      .writeString(1, 'line\r\nvalue')
      .writeInt8(70, 3.9)
      .writeInt16(71, 4.2)
      .writeInt32(72, 5.8)
      .writeInt64(73, 6.1)
      .writeUInt16(74, -3)
      .writeUInt32(75, -4)
      .writeBoolean(290, true)
      .writeBool(291, false)
      .writeDouble(40, 1.23456789)
      .writeDouble(41, Number.NaN)
      .writeAngle(50, Math.PI)
      .writeHandle(5, 'abc')
      .writeObjectId(330, 'custom-id')
      .writePoint2d(10, { x: 1.5, y: 2.5 })
      .writePoint3d(20, { x: 3, y: 4, z: 5 })
      .writeVector3d(30, { x: 6, y: 7, z: 8 })
      .startTable('LAYER')
      .endTable()
      .endSection()

    const aciColor = new AcCmColor()
    aciColor.colorIndex = 7
    filer.writeCmColor(aciColor)

    const trueColor = new AcCmColor()
    trueColor.setRGB(255, 0, 0)
    filer.writeCmColor(trueColor)

    const transparency = new AcCmTransparency(128)
    filer.writeTransparency(transparency)

    filer.writeResultBuffer(
      new AcDbResultBuffer([
        { code: 1000, value: 'x' },
        { code: 1070, value: 1 }
      ])
    )

    const out = filer.toString()
    expect(out).toContain('SECTION')
    expect(out).toContain('HEADER')
    expect(out).toContain('AcDbTest')
    expect(out).toContain('line value')
    expect(out).toContain('ENDSEC')
    expect(out).toContain('ENDTAB')
    expect(out).toContain('180')
    expect(out).toContain('ABC')
    expect(out).toContain('1000')
    expect(out).toContain('\n0\n')
  })

  it('supports database getter and setter', () => {
    const filer = new AcDbDxfFiler()
    expect(filer.database).toBeUndefined()
    filer.database = undefined
    expect(filer.database).toBeUndefined()
  })

  it('writes transparency with the default group code and skips invalid values', () => {
    const filer = new AcDbDxfFiler()

    filer.writeTransparency(new AcCmTransparency(128))
    expect(filer.toString()).toBe('440\n33554560\n')

    const invalidFiler = new AcDbDxfFiler()
    invalidFiler.writeTransparency(AcCmTransparency.fromString('invalid'))
    expect(invalidFiler.toString()).not.toContain('440')
  })

  it('reads ASCII DXF pairs via AcDbDxfFiler without splitting into a line array', () => {
    const dxf = [
      '0',
      'LINE',
      '5',
      '1A',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbLine',
      '10',
      '1.5',
      '20',
      '2.5',
      '30',
      '0',
      '11',
      '10',
      '21',
      '20',
      '31',
      '0',
      '0',
      'ENDSEC'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(dxf)
    expect(filer.mode).toBe('read')

    expect(filer.readItem()).toEqual({ code: 0, value: 'LINE' })
    expect(filer.readHandle(5)).toBe('1A')
    expect(filer.atSubclassData('AcDbEntity')).toBe(true)
    expect(filer.readString(8)).toBe('0')
    expect(filer.atSubclassData('AcDbLine')).toBe(true)

    const start = filer.readPoint3d(10)
    expect(start?.x).toBe(1.5)
    expect(start?.y).toBe(2.5)
    expect(start?.z).toBe(0)

    const end = filer.readPoint3d(11)
    expect(end?.x).toBe(10)
    expect(end?.y).toBe(20)
    expect(end?.z).toBe(0)

    expect(filer.atEndOfObject).toBe(true)
    expect(filer.readItem()).toEqual({ code: 0, value: 'ENDSEC' })
    expect(filer.atEof).toBe(true)
    expect(filer.filerStatus).toBe(AcDbDxfFilerStatus.Ok)
  })

  it('supports pushBackItem and order-independent field reading', () => {
    const dxf = ['100', 'AcDbLine', '11', '3', '21', '4', '10', '1', '20', '2'].join(
      '\n'
    )
    const filer = AcDbDxfFiler.fromString(dxf)
    expect(filer.atSubclassData('AcDbLine')).toBe(true)

    let x1 = 0
    let y1 = 0
    let x2 = 0
    let y2 = 0
    while (!filer.atEndOfObject && !filer.atEof) {
      const item = filer.readItem()
      if (!item) break
      switch (Number(item.code)) {
        case 10:
          x1 = Number(item.value)
          break
        case 20:
          y1 = Number(item.value)
          break
        case 11:
          x2 = Number(item.value)
          break
        case 21:
          y2 = Number(item.value)
          break
        default:
          filer.pushBackItem(item)
          return
      }
    }
    expect(x1).toBe(1)
    expect(y1).toBe(2)
    expect(x2).toBe(3)
    expect(y2).toBe(4)
  })

  it('supports nested pushBackItem without overwriting prior push', () => {
    const dxf = ['10', '1', '20', '2', '30', '3'].join('\n')
    const filer = AcDbDxfFiler.fromString(dxf)

    const a = filer.readItem()!
    const b = filer.readItem()!
    filer.pushBackItem(a)
    filer.pushBackItem(b)
    // LIFO: last pushed (b) is returned first.
    expect(filer.readItem()).toEqual(b)
    expect(filer.readItem()).toEqual(a)
    expect(filer.readItem()).toEqual({ code: 30, value: 3 })
    expect(filer.atEof).toBe(true)
  })

  it('creates a pair reader from an ArrayBuffer for ASCII DXF', () => {
    const text = '0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1032\n0\nENDSEC\n'
    const buffer = new TextEncoder().encode(text).buffer
    const reader = acdbCreateDxfPairReader(buffer)
    expect(reader.kind).toBe('ascii')
    expect(reader.next()).toEqual({ code: 0, type: 'string', value: 'SECTION' })
    expect(reader.next()).toEqual({ code: 2, type: 'string', value: 'HEADER' })

    const ascii = acdbMakeAsciiDxfPairReader(text)
    expect(ascii.peek()?.value).toBe('SECTION')
    expect(ascii.next()?.value).toBe('SECTION')
  })

  it('scans UTF-8 ASCII DXF from bytes without a full-file string decode', () => {
    const text = '0\nLINE\n8\n0\n10\n1\n20\n2\n'
    const bytes = new TextEncoder().encode(text)
    const reader = acdbMakeUtf8AsciiDxfPairReader(bytes)
    expect(reader.next()).toEqual({ code: 0, type: 'string', value: 'LINE' })
    expect(reader.next()).toEqual({ code: 8, type: 'string', value: '0' })
    expect(reader.next()).toEqual({ code: 10, type: 'double', value: 1 })
    expect(reader.next()).toEqual({ code: 20, type: 'double', value: 2 })
    expect(reader.next()).toBeUndefined()
  })
})

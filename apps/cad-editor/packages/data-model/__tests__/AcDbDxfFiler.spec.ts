import { AcCmColor, AcCmTransparency } from '@mlightcad/common'

import { AcDbDwgVersion } from '../src/database/AcDbDwgVersion'
import { AcDbDxfFiler } from '../src/base/AcDbDxfFiler'
import { AcDbResultBuffer } from '../src/base/AcDbResultBuffer'

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
})

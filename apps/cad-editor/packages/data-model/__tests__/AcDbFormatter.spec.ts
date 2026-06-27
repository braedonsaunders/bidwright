import { AcGePoint2d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbAngleUnits } from '../src/misc/AcDbAngleUnits'
import { AcDbFormatter } from '../src/misc/AcDbFormatter'
import { AcDbLinearUnits } from '../src/misc/AcDbLinearUnits'
import { AcDbUnitsValue } from '../src/misc/AcDbUnitsValue'

describe('AcDbFormatter', () => {
  let db: AcDbDatabase
  let formatter: AcDbFormatter

  beforeEach(() => {
    db = new AcDbDatabase()
    formatter = new AcDbFormatter(db)
  })

  it('exposes the same formatter via AcDbDatabase.formatter', () => {
    expect(db.formatter).toBeInstanceOf(AcDbFormatter)
    expect(db.formatter).toBe(db.formatter)
    expect(db.formatter.formatLength(1)).toBe(formatter.formatLength(1))
  })

  describe('formatLength', () => {
    it('formats decimal lengths with LUPREC', () => {
      db.lunits = AcDbLinearUnits.Decimal
      db.luprec = 2
      db.insunits = AcDbUnitsValue.Millimeters

      expect(formatter.formatLength(12.3456)).toBe('12.35')
      expect(formatter.formatLength(12.3456, { showUnits: true })).toBe(
        '12.35 mm'
      )
    })

    it('prefixes approximate decimal lengths when showApproximate is true', () => {
      db.lunits = AcDbLinearUnits.Decimal
      db.luprec = 2

      expect(formatter.formatLength(12.3456, { showApproximate: true })).toBe(
        '~ 12.35'
      )
      expect(formatter.formatLength(12.35, { showApproximate: true })).toBe(
        '12.35'
      )
      expect(
        formatter.formatLength(12.3456, {
          showApproximate: true,
          showUnits: true
        })
      ).toBe('~ 12.35 mm')
    })

    it('formats scientific lengths', () => {
      db.lunits = AcDbLinearUnits.Scientific
      db.luprec = 2

      expect(formatter.formatLength(123.456)).toBe('1.23E+02')
    })

    it('formats engineering lengths in feet and inches', () => {
      db.lunits = AcDbLinearUnits.Engineering
      db.luprec = 2

      expect(formatter.formatLength(15.5)).toBe("1'-3.5")
      expect(formatter.formatLength(15.5, { showUnits: true })).toBe('1\'-3.5"')
    })

    it('formats architectural lengths with fractional inches', () => {
      db.lunits = AcDbLinearUnits.Architectural
      db.luprec = 2

      expect(formatter.formatLength(15.5)).toBe("1'-3 1/2")
    })

    it('formats fractional linear lengths', () => {
      db.lunits = AcDbLinearUnits.Fractional
      db.luprec = 1

      expect(formatter.formatLength(15.5)).toBe('15 1/2')
    })
  })

  describe('formatPoint', () => {
    it('formats 2d and 3d points from coordinates', () => {
      db.lunits = AcDbLinearUnits.Decimal
      db.luprec = 1

      expect(formatter.formatPoint2d(new AcGePoint2d(1.23, 4.56))).toBe(
        '1.2, 4.6'
      )
      expect(formatter.formatPoint3d(new AcGePoint3d(1.23, 4.56, 7.89))).toBe(
        '1.2, 4.6, 7.9'
      )
    })

    it('prefixes approximate coordinates independently when showApproximate is true', () => {
      db.lunits = AcDbLinearUnits.Decimal
      db.luprec = 1

      expect(
        formatter.formatPoint2d(new AcGePoint2d(1.23, 4), {
          showApproximate: true
        })
      ).toBe('~ 1.2, 4')
    })
  })

  describe('formatAngle', () => {
    it('formats decimal degrees', () => {
      db.aunits = AcDbAngleUnits.DecimalDegrees
      db.auprec = 2

      expect(formatter.formatAngle(Math.PI / 4)).toBe('45')
      expect(formatter.formatAngle(Math.PI / 4, { showUnits: true })).toBe(
        '45°'
      )
    })

    it('prefixes approximate angles when showApproximate is true', () => {
      db.aunits = AcDbAngleUnits.DecimalDegrees
      db.auprec = 0

      const radians = (45.4 * Math.PI) / 180
      expect(formatter.formatAngle(radians, { showApproximate: true })).toBe(
        '~ 45'
      )
      expect(
        formatter.formatAngle(Math.PI / 4, { showApproximate: true })
      ).toBe('45')
    })

    it('formats degrees minutes seconds', () => {
      db.aunits = AcDbAngleUnits.DegreesMinutesSeconds
      db.auprec = 0

      expect(formatter.formatAngle(Math.PI / 2)).toBe("90d0'0")
    })

    it('formats radians and gradians', () => {
      db.aunits = AcDbAngleUnits.Radians
      db.auprec = 3
      expect(formatter.formatAngle(Math.PI / 2)).toBe('1.571')

      db.aunits = AcDbAngleUnits.Gradians
      db.auprec = 1
      expect(formatter.formatAngle(Math.PI / 2)).toBe('100')
    })

    it('applies ANGBASE and ANGDIR before formatting', () => {
      db.aunits = AcDbAngleUnits.DecimalDegrees
      db.auprec = 0
      db.angbase = 0
      db.angdir = 0

      expect(formatter.formatAngle(Math.PI / 4)).toBe('45')

      db.angdir = 1
      expect(formatter.formatAngle(Math.PI / 4)).toBe('315')

      db.angbase = Math.PI / 2
      db.angdir = 0
      expect(formatter.formatAngle(Math.PI / 2)).toBe('0')
    })

    it('skips ANGBASE and ANGDIR when applyAngbaseAngdir is false', () => {
      db.aunits = AcDbAngleUnits.DecimalDegrees
      db.auprec = 0
      db.angbase = Math.PI / 2
      db.angdir = 0

      expect(formatter.formatAngle(Math.PI / 4)).toBe('315')
      expect(
        formatter.formatAngle(Math.PI / 4, { applyAngbaseAngdir: false })
      ).toBe('45')
    })
  })

  describe('UNITMODE and MEASUREMENT', () => {
    it('uses UNITMODE input delimiters for architectural lengths', () => {
      db.lunits = AcDbLinearUnits.Architectural
      db.luprec = 2
      db.unitmode = 1

      expect(formatter.formatLength(15.5)).toBe("1'3-1/2")
    })

    it('uses MEASUREMENT when INSUNITS is unitless', () => {
      db.lunits = AcDbLinearUnits.Decimal
      db.luprec = 0
      db.insunits = AcDbUnitsValue.Undefined
      db.measurement = 1

      expect(formatter.formatLength(10, { showUnits: true })).toBe('10 mm')

      db.measurement = 0
      expect(formatter.formatLength(10, { showUnits: true })).toBe('10"')
    })
  })
})

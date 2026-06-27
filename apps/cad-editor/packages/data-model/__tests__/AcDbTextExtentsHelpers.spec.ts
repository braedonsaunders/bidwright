import {
  AcGeBox3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import { AcGiMTextAttachmentPoint } from '@mlightcad/graphic-interface'

import {
  acdbCountMTextLines,
  acdbEstimateMTextHeight,
  acdbEstimatePlainTextWidth,
  acdbExpandBoxByOrientedTextRect,
  acdbGetLocalBoundsFromAttachment,
  acdbStripMTextControlCodes
} from '../src/entity/AcDbTextExtentsHelpers'

describe('AcDbTextExtentsHelpers', () => {
  describe('acdbStripMTextControlCodes', () => {
    it('converts paragraph breaks and removes formatting codes', () => {
      expect(acdbStripMTextControlCodes('A\\PB')).toBe('A\nB')
      expect(acdbStripMTextControlCodes('{\\C1;Red}')).toBe('Red')
    })
  })

  describe('acdbEstimatePlainTextWidth', () => {
    it('returns zero for empty or zero-height text', () => {
      expect(acdbEstimatePlainTextWidth('', 2)).toBe(0)
      expect(acdbEstimatePlainTextWidth('AB', 0)).toBe(0)
    })

    it('uses the longest line and width factor', () => {
      expect(acdbEstimatePlainTextWidth('AB\nC', 2, 0.5)).toBeCloseTo(2)
      expect(acdbEstimatePlainTextWidth('ABCD', 2)).toBeCloseTo(8)
    })
  })

  describe('acdbCountMTextLines', () => {
    it('counts lines after control-code normalization', () => {
      expect(acdbCountMTextLines('one')).toBe(1)
      expect(acdbCountMTextLines('one\\Ptwo')).toBe(2)
    })
  })

  describe('acdbEstimateMTextHeight', () => {
    it('returns single-line height unchanged', () => {
      expect(acdbEstimateMTextHeight(1, 2, 0.25)).toBe(2)
    })

    it('adds inter-line spacing for multiple lines', () => {
      expect(acdbEstimateMTextHeight(2, 2, 1)).toBeCloseTo(4)
      expect(acdbEstimateMTextHeight(2, 2, 0.25)).toBeCloseTo(2.5)
      expect(acdbEstimateMTextHeight(3, 2, 1.5)).toBeCloseTo(8)
    })
  })

  describe('acdbGetLocalBoundsFromAttachment', () => {
    it('returns top-left bounds relative to the anchor', () => {
      expect(
        acdbGetLocalBoundsFromAttachment(
          10,
          4,
          AcGiMTextAttachmentPoint.TopLeft
        )
      ).toEqual({ minX: 0, minY: -4, maxX: 10, maxY: 0 })
    })

    it('returns middle-center bounds relative to the anchor', () => {
      expect(
        acdbGetLocalBoundsFromAttachment(
          10,
          4,
          AcGiMTextAttachmentPoint.MiddleCenter
        )
      ).toEqual({ minX: -5, minY: -2, maxX: 5, maxY: 2 })
    })
  })

  describe('acdbExpandBoxByOrientedTextRect', () => {
    it('expands only the anchor when width and height are zero', () => {
      const box = new AcGeBox3d()
      acdbExpandBoxByOrientedTextRect(
        box,
        new AcGePoint3d(3, 4, 5),
        0,
        0,
        AcGiMTextAttachmentPoint.TopLeft
      )

      expect(box.min).toMatchObject({ x: 3, y: 4, z: 5 })
      expect(box.max).toMatchObject({ x: 3, y: 4, z: 5 })
    })

    it('rotates local bounds around the anchor', () => {
      const box = new AcGeBox3d()
      acdbExpandBoxByOrientedTextRect(
        box,
        new AcGePoint3d(0, 0, 0),
        4,
        2,
        AcGiMTextAttachmentPoint.BaselineLeft,
        Math.PI / 2
      )

      expect(box.min.x).toBeCloseTo(-2)
      expect(box.min.y).toBeCloseTo(0)
      expect(box.max.x).toBeCloseTo(0)
      expect(box.max.y).toBeCloseTo(4)
    })

    it('uses direction vector when provided', () => {
      const box = new AcGeBox3d()
      acdbExpandBoxByOrientedTextRect(
        box,
        new AcGePoint3d(0, 0, 0),
        4,
        2,
        AcGiMTextAttachmentPoint.BaselineLeft,
        0,
        new AcGeVector3d(0, 1, 0)
      )

      expect(box.min.x).toBeCloseTo(-2)
      expect(box.max.x).toBeCloseTo(0)
      expect(box.max.y).toBeCloseTo(4)
    })
  })
})

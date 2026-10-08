import {
  AcGeBox3d,
  AcGePoint3d,
  AcGeVector3d
} from '@mlightcad/geometry-engine'
import { AcGiMTextAttachmentPoint } from '@mlightcad/graphic-interface'

import {
  acdbCollectMTextOrientedCorners,
  acdbCountMTextLines,
  acdbEscapePlainTextForMText,
  acdbEstimateMTextHeight,
  acdbEstimatePlainTextWidth,
  acdbEstimateToleranceCellWidth,
  acdbExpandBoxByOrientedTextRect,
  acdbGetLocalBoundsFromAttachment,
  acdbResolveMTextLayoutMetrics,
  acdbScorePointAgainstMTextLayout,
  acdbStripMTextControlCodes,
  acdbStripToleranceCellTextForWidth,
  acdbWorldPointToMTextLocal
} from '../src/entity/AcDbTextExtentsHelpers'

describe('AcDbTextExtentsHelpers', () => {
  describe('acdbStripMTextControlCodes', () => {
    it('converts paragraph breaks and removes formatting codes', () => {
      expect(acdbStripMTextControlCodes('A\\PB')).toBe('A\nB')
      expect(acdbStripMTextControlCodes('{\\C1;Red}')).toBe('Red')
    })
  })

  describe('acdbEscapePlainTextForMText', () => {
    it('escapes backslashes and braces so Windows paths stay literal', () => {
      expect(acdbEscapePlainTextForMText('A\\PB')).toBe('A\\\\PB')
      expect(
        acdbEscapePlainTextForMText(
          '..\\..\\..\\Pictures\\Screenshots\\file.png'
        )
      ).toBe('..\\\\..\\\\..\\\\Pictures\\\\Screenshots\\\\file.png')
      expect(acdbEscapePlainTextForMText('a{b}c')).toBe('a\\{b\\}c')
    })
  })

  describe('acdbStripToleranceCellTextForWidth', () => {
    it('removes GDT font codes and symbol characters from tolerance cells', () => {
      expect(acdbStripToleranceCellTextForWidth('{\\Fgdt;r}')).toBe('')
      expect(acdbStripToleranceCellTextForWidth('{\\Fgdt;n}0.05')).toBe('0.05')
      expect(
        acdbStripToleranceCellTextForWidth('{\\Fgdt.shx|b0|i0|c134|p6;j}')
      ).toBe('')
    })
  })

  describe('acdbEstimateToleranceCellWidth', () => {
    it('uses text height for symbol-only GDT cells', () => {
      expect(acdbEstimateToleranceCellWidth('{\\Fgdt;r}', 3.5)).toBeCloseTo(3.5)
    })

    it('measures numeric text without the GDT symbol character width', () => {
      expect(acdbEstimateToleranceCellWidth('{\\Fgdt;n}0.05', 3.5)).toBeCloseTo(
        14
      )
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
      // Baseline distance = factor × (5/3) × textHeight when that is at least
      // one text height. Factors below 0.6 are tighter than the text height.
      expect(acdbEstimateMTextHeight(2, 2, 1)).toBeCloseTo(2 + (5 / 3) * 2)
      expect(acdbEstimateMTextHeight(2, 2, 0.8)).toBeCloseTo(
        2 + 0.8 * (5 / 3) * 2
      )
      // At Least (default, style 0/1): do not pack closer than the text height.
      expect(acdbEstimateMTextHeight(2, 2, 0.25)).toBeCloseTo(2 + 2)
      expect(acdbEstimateMTextHeight(2, 2, 0.25, 0)).toBeCloseTo(2 + 2)
      expect(acdbEstimateMTextHeight(2, 2, 0.25, 1)).toBeCloseTo(2 + 2)
      // Exact style keeps the compact factor spacing.
      expect(acdbEstimateMTextHeight(2, 2, 0.25, 2)).toBeCloseTo(
        2 + 0.25 * (5 / 3) * 2
      )
      expect(acdbEstimateMTextHeight(3, 2, 1.5)).toBeCloseTo(
        2 + 2 * 1.5 * (5 / 3) * 2
      )
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

  describe('oriented MTEXT association helpers', () => {
    const createRotatedLayout = () =>
      acdbResolveMTextLayoutMetrics({
        contents: 'Rotated',
        height: 4,
        width: 0,
        extentsWidth: 20,
        lineSpacingFactor: 0.25,
        attachmentPoint: AcGiMTextAttachmentPoint.TopLeft,
        rotation: Math.PI / 2,
        direction: new AcGeVector3d(0, 1, 0),
        location: new AcGePoint3d(10, 10, 0)
      })

    it('maps world points into MTEXT-local coordinates using rotation/direction', () => {
      const layout = createRotatedLayout()
      const local = acdbWorldPointToMTextLocal(
        new AcGePoint3d(12, 20, 0),
        layout
      )

      expect(local.x).toBeCloseTo(10)
      expect(local.y).toBeCloseTo(-2)
    })

    it('scores landing points against oriented bounds instead of world-axis padding', () => {
      const layout = createRotatedLayout()
      const padding = { padX: 8, padYAbove: 4, padYBelow: 10 }

      expect(
        acdbScorePointAgainstMTextLayout(
          new AcGePoint3d(12, 20, 0),
          layout,
          padding
        )
      ).toBe(0)

      expect(
        acdbScorePointAgainstMTextLayout(
          new AcGePoint3d(16, 40, 0),
          layout,
          padding
        )
      ).toBeNull()
    })

    it('collects oriented corners for hook-line span calculations', () => {
      const layout = createRotatedLayout()
      const corners = acdbCollectMTextOrientedCorners(layout)

      expect(corners).toHaveLength(4)
      expect(corners.some(corner => corner.x === 14 && corner.y === 10)).toBe(
        true
      )
      expect(corners.some(corner => corner.x === 14 && corner.y === 30)).toBe(
        true
      )
    })
  })
})

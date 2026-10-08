import { AcGePoint3d } from '@mlightcad/geometry-engine'

import {
  AcDbArcAlignedText,
  AcDbArcTextAlignment,
  AcDbArcTextDirection,
  AcDbArcTextPosition
} from '../src/entity'

describe('AcDbArcAlignedText', () => {
  function hydrantLabel() {
    const text = new AcDbArcAlignedText()
    text.textString = 'HYD'
    text.textSize = 0.7
    text.xScale = 1
    text.characterSpacing = 0.5
    text.offsetFromArc = 0.2
    text.center = new AcGePoint3d(0, 0.4256743291778875, 0)
    text.radius = 0.9506306524048814
    text.startAngle = -2.677310584020677
    text.endAngle = -0.46428206956911633
    text.alignment = AcDbArcTextAlignment.Center
    text.textDirection = AcDbArcTextDirection.InwardToTheCenter
    text.textPosition = AcDbArcTextPosition.OnConvexSide
    return text
  }

  it('lays HYD out along the bottom of the reference arc', () => {
    const text = hydrantLabel()
    const glyphs = text.glyphPlacements()

    expect(glyphs.map(glyph => glyph.text)).toEqual(['H', 'Y', 'D'])
    const middle = glyphs[1]!
    const dx = middle.position.x - text.center.x
    const dy = middle.position.y - text.center.y
    const baseline = text.radius + text.offsetFromArc + text.textSize
    expect(Math.hypot(dx, dy)).toBeCloseTo(baseline, 1)
    expect(middle.position.y).toBeLessThan(text.center.y)
    expect(Math.abs(middle.position.x)).toBeLessThan(0.3)
    expect(Math.abs(middle.rotation)).toBeLessThan(0.5)
  })

  it('exposes the DXF type name', () => {
    expect(new AcDbArcAlignedText().dxfTypeName).toBe('ARCALIGNEDTEXT')
  })

  it('applies and preserves DXF group 90 raw text color', () => {
    const text = new AcDbArcAlignedText()
    text.applyRawTextColor(1)
    expect(text.color.colorIndex).toBe(1)
    expect(text.rawTextColor()).toBe(1)

    text.applyRawTextColor(256)
    expect(text.color.isByLayer).toBe(true)
    expect(text.rawTextColor()).toBe(256)
  })
})

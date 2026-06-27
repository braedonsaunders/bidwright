import type { AcDbGradientName } from '../src/entity/AcDbHatch'
import { HATCH_PATTERN_SOLID } from '../src/misc'
import {
  AcDbPatSvgRenderer,
  AcDbPredefinedAcadIsoPat,
  AcDbPredefinedAcadPat
} from '../src/misc/pat'

describe('AcDbPat predefined patterns', () => {
  it('defines SOLID without PAT line descriptors', () => {
    const acadSolid = AcDbPredefinedAcadPat.patterns.find(
      pattern => pattern.name === HATCH_PATTERN_SOLID
    )
    const acadIsoSolid = AcDbPredefinedAcadIsoPat.patterns.find(
      pattern => pattern.name === HATCH_PATTERN_SOLID
    )

    expect(acadSolid?.lines).toEqual([])
    expect(acadIsoSolid?.lines).toEqual([])
  })
})

describe('AcDbPatSvgRenderer', () => {
  const gradientNames: AcDbGradientName[] = [
    'LINEAR',
    'CYLINDER',
    'INVCYLINDER',
    'SPHERICAL',
    'INVSPHERICAL',
    'HEMISPHERICAL',
    'INVHEMISPHERICAL',
    'CURVED',
    'INVCURVED'
  ]

  it('renders SOLID as an area fill', () => {
    const solid = AcDbPredefinedAcadPat.patterns.find(
      pattern => pattern.name === HATCH_PATTERN_SOLID
    )
    expect(solid).toBeDefined()

    const svg = new AcDbPatSvgRenderer().renderPattern(solid!, {
      width: 20,
      height: 10,
      stroke: '#123456',
      background: '#abcdef'
    })

    expect(svg).toContain('fill="#abcdef"')
    expect(svg).toContain('fill="#123456"')
    expect(svg).not.toContain('<path')
  })

  it('keeps non-SOLID empty patterns visually empty', () => {
    const svg = new AcDbPatSvgRenderer().renderPattern(
      {
        name: 'EMPTY',
        lines: []
      },
      {
        width: 20,
        height: 10,
        stroke: '#123456',
        background: '#abcdef'
      }
    )

    expect(svg).toContain('fill="#abcdef"')
    expect(svg).not.toContain('fill="#123456"')
    expect(svg).not.toContain('<path')
  })

  it.each(gradientNames)('renders %s gradient previews', name => {
    const svg = new AcDbPatSvgRenderer().renderGradient(name, {
      width: 24,
      height: 16,
      startColor: 0x112233,
      endColor: 0x445566,
      angle: Math.PI / 4,
      shift: 0.2,
      background: '#abcdef'
    })

    expect(svg).toContain('<defs>')
    expect(svg).toContain('fill="#abcdef"')
    expect(svg).toContain('fill="url(#acdb-pat-gradient-')
    expect(svg).toContain('#112233')
    expect(svg).toContain('#445566')
    expect(svg).not.toContain('undefined')
  })

  it('supports one-color gradient shade and tint previews', () => {
    const svg = new AcDbPatSvgRenderer().renderGradient('LINEAR', {
      startColor: 0x336699,
      oneColorMode: true,
      shadeTintValue: 1
    })

    expect(svg).toContain('#336699')
    expect(svg).toContain('#ffffff')
  })
})

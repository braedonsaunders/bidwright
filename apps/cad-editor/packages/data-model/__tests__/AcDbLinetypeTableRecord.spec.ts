import { AcDbLinetypeTableRecord } from '../src/database/AcDbLinetypeTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbLinetypeTableRecord', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(
      () =>
        new AcDbLinetypeTableRecord({
          name: 'CONTINUOUS',
          standardFlag: 0,
          description: '',
          totalPatternLength: 0
        })
    )
  })

  it('renders solid linetype preview as a single SVG line', () => {
    const record = new AcDbLinetypeTableRecord({
      name: 'CONTINUOUS',
      standardFlag: 0,
      description: 'Solid line',
      totalPatternLength: 0
    })

    const svg = record.toPreviewSvgString({
      width: 120,
      height: 24,
      padding: 6,
      stroke: '#000000'
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('width="120"')
    expect(svg).toContain('height="24"')
    expect((svg.match(/<line /g) ?? []).length).toBe(1)
    expect((svg.match(/<circle /g) ?? []).length).toBe(0)
  })

  it('renders dashed and dotted linetype preview with multiple segments', () => {
    const record = new AcDbLinetypeTableRecord({
      name: 'CENTER',
      standardFlag: 0,
      description: 'Center line',
      totalPatternLength: 0.9,
      pattern: [
        { elementLength: 0.5, elementTypeFlag: 0 },
        { elementLength: -0.3, elementTypeFlag: 0 },
        { elementLength: 0, elementTypeFlag: 0 },
        { elementLength: -0.1, elementTypeFlag: 0 }
      ]
    })

    const svg = record.toPreviewSvgString({
      width: 180,
      height: 30,
      padding: 10,
      repeats: 3
    })

    expect((svg.match(/<line /g) ?? []).length).toBeGreaterThan(1)
    expect((svg.match(/<circle /g) ?? []).length).toBeGreaterThan(0)
  })
})
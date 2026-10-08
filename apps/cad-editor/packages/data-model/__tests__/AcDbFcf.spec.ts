import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbFcf } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createWorkingDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbFcf', () => {
  it('exposes static and DXF type names', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()

    expect(AcDbFcf.typeName).toBe('Fcf')
    expect(fcf.dxfTypeName).toBe('TOLERANCE')
  })

  it('initializes defaults and supports property accessors', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()

    expect(fcf.location).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(fcf.text).toBe('')
    expect(fcf.dimensionStyle).toBe('')
    expect(fcf.normal).toMatchObject({ x: 0, y: 0, z: 1 })
    expect(fcf.direction).toMatchObject({ x: 1, y: 0, z: 0 })

    fcf.location = new AcGePoint3d(10, 20, 0)
    fcf.text = '{\\Fgdt.shx|b0|i0|c134|p6;j}|0.05|A|'
    fcf.dimensionStyle = 'Standard'
    fcf.normal = { x: 0, y: 0, z: 1 }
    fcf.direction = { x: 0, y: 1, z: 0 }

    expect(fcf.location).toMatchObject({ x: 10, y: 20, z: 0 })
    expect(fcf.text).toContain('gdt')
    expect(fcf.dimensionStyle).toBe('Standard')
    expect(fcf.direction).toMatchObject({ x: 0, y: 1, z: 0 })
  })

  it('computes bounding points from tolerance cells', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(0, 0, 0)
    fcf.text = 'A|B|C'
    fcf.dimensionStyle = 'Standard'

    const points = fcf.getBoundingPoints()
    const textHeight = fcf.textHeight
    expect(points).toHaveLength(4)
    expect(points[0]).toMatchObject({ x: 0, y: textHeight, z: 0 })
    expect(points[1].x).toBeGreaterThan(points[0].x)
    expect(points[2].y).toBeLessThan(points[0].y)
  })

  it('parses DXF %%v tolerance text into three compartments', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.dimensionStyle = 'Standard'

    fcf.text = '{\\Fgdt;b}%%v0.1%%v%%vA%%v%%v%%v^J'
    const perpendicularity = fcf.getBoundingPoints()
    expect(perpendicularity[1].x - perpendicularity[0].x).toBeGreaterThan(
      perpendicularity[1].y - perpendicularity[3].y
    )

    fcf.text = '{\\Fgdt;r}%%v{\\Fgdt;n}0.05%%v%%vA%%v%%v%%v^J'
    const runout = fcf.getBoundingPoints()
    expect(runout[1].x - runout[0].x).toBeGreaterThan(
      runout[1].y - runout[3].y
    )
  })

  it('keeps pipe-delimited tolerance text compatible', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(0, 0, 0)
    fcf.text = '{\\Fgdt.shx|b0|i0|c134|p6;j}|0.05|A|'
    fcf.dimensionStyle = 'Standard'

    const points = fcf.getBoundingPoints()
    expect(points[2].x).toBeGreaterThan(points[0].x * 2)
  })

  it('returns geometricExtents and grip/osnap points', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(5, 5, 0)
    fcf.text = 'Position|0.1'
    fcf.dimensionStyle = 'Standard'

    expect(fcf.geometricExtents.isEmpty()).toBe(false)
    expect(fcf.subGetGripPoints()).toEqual([fcf.location])

    const snapPoints: AcGePoint3d[] = []
    fcf.subGetOsnapPoints(
      AcDbOsnapMode.Insertion,
      new AcGePoint3d(),
      new AcGePoint3d(),
      snapPoints
    )
    expect(snapPoints[0]).toMatchObject({ x: 5, y: 5, z: 0 })
  })

  it('supports setOrientation and transformBy', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(1, 2, 0)
    fcf.setOrientation({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 })

    expect(fcf.normal).toMatchObject({ x: 0, y: 0, z: 1 })
    expect(fcf.direction).toMatchObject({ x: 0, y: 1, z: 0 })

    fcf.transformBy(new AcGeMatrix3d().makeTranslation(3, 4, 0))
    expect(fcf.location).toMatchObject({ x: 4, y: 6, z: 0 })
  })

  it('writes DXF fields for TOLERANCE entity', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(10, 20, 0)
    fcf.text = '{\\Fgdt.shx|b0|i0|c134|p6;j}|0.05|A|'
    fcf.dimensionStyle = 'Standard'
    fcf.direction = { x: 0, y: 1, z: 0 }
    fcf.ownerId = '0'

    const filer = new AcDbDxfFiler()
    fcf.dxfOutFields(filer)
    const dxf = filer.toString()

    expect(dxf).toContain('100\nAcDbFcf\n')
    expect(dxf).toContain('3\nStandard\n')
    expect(dxf).toContain('1\n')
    expect(dxf).toContain('11\n0\n21\n1\n31\n0\n')
  })

  it('deep-clones as a detached object', () => {
    expectDetachedClone(() => new AcDbFcf())
  })

  it('anchors the frame at the left-edge center insertion point', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(100, 200, 0)
    fcf.text = '{\\Fgdt;r}%%v{\\Fgdt;n}0.05%%v%%vA%%v%%v%%v^J'
    fcf.dimensionStyle = 'Standard'

    const points = fcf.getBoundingPoints()
    const leftCenterY = (points[0].y + points[3].y) / 2
    const rightCenterY = (points[1].y + points[2].y) / 2

    expect(points[0]).toMatchObject({ x: 100, z: 0 })
    expect(points[1].x).toBeGreaterThan(100)
    expect(leftCenterY).toBeCloseTo(200, 6)
    expect(rightCenterY).toBeCloseTo(200, 6)
  })

  it('places the insertion point on the right edge when direction points left', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(344, 270, 0)
    fcf.direction = { x: -1, y: 0, z: 0 }
    fcf.text = '{\\Fgdt;r}%%v{\\Fgdt;n}0.05%%v%%vA%%v%%v%%v^J'
    fcf.dimensionStyle = 'Standard'

    const points = fcf.getBoundingPoints()
    const rightCenterY = (points[0].y + points[3].y) / 2

    expect(points[0]).toMatchObject({ x: 344, z: 0 })
    expect(points[3]).toMatchObject({ x: 344, z: 0 })
    expect(points[1].x).toBeLessThan(344)
    expect(rightCenterY).toBeCloseTo(270, 6)
  })

  it('aligns the right edge with leader attachment for GDT tolerance text', () => {
    const db = createWorkingDb()
    const dimStyle = db.tables.dimStyleTable.getAt('Standard')
    if (dimStyle) {
      dimStyle.dimtxt = 3.5
      dimStyle.dimscale = 1
    }

    const fcf = new AcDbFcf()
    fcf.location = new AcGePoint3d(312.1120452047875, 270.2900270575117, 0)
    fcf.text = '{\\Fgdt;r}%%v{\\Fgdt;n}0.05%%v%%vA%%v%%v%%v^J'
    fcf.dimensionStyle = 'Standard'

    const points = fcf.getBoundingPoints()
    const rightEdgeCenterX = (points[1].x + points[2].x) / 2
    const leaderAttachX = 343.9410452047876

    expect(rightEdgeCenterX).toBeCloseTo(leaderAttachX, 0)
    expect(points[0].x).toBeCloseTo(fcf.location.x, 6)
    expect((points[0].y + points[3].y) / 2).toBeCloseTo(fcf.location.y, 6)
  })

  it('draws frame borders and dividers as separate axis-aligned segments', () => {
    createWorkingDb()
    const fcf = new AcDbFcf()
    fcf.text = '{\\Fgdt;r}%%v{\\Fgdt;n}0.05%%v%%vA%%v%%v%%v^J'
    fcf.dimensionStyle = 'Standard'

    const renderer = {
      lines: jest.fn((points: unknown[]) => ({ kind: 'lines', points })),
      mtext: jest.fn(() => ({ kind: 'mtext' })),
      group: jest.fn((entities: unknown[]) => ({ kind: 'group', entities }))
    }

    fcf.subWorldDraw(renderer as never)

    expect(renderer.lines).toHaveBeenCalled()
    for (const [points] of renderer.lines.mock.calls as [AcGePoint3d[]][]) {
      expect(points).toHaveLength(2)
      const [start, end] = points
      const dx = Math.abs(end.x - start.x)
      const dy = Math.abs(end.y - start.y)
      expect(dx === 0 || dy === 0).toBe(true)
    }
  })
})

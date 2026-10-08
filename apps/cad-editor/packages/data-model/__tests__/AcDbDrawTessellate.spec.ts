import { AcGeCircArc2d, ORIGIN_POINT_2D, TAU } from '@mlightcad/geometry-engine'

import { AcDbDatabase } from '../src/database'
import { AcDbViewportTableRecord } from '../src/database/AcDbViewportTableRecord'
import { ACTIVE_VPORT_NAME } from '../src/misc/AcDbConstants'
import {
  ACDB_DRAW_CIRCLE_SIDES_DRAFT,
  ACDB_DRAW_CIRCLE_SIDES_HIGH,
  ACDB_DRAW_CIRCLE_SIDES_STANDARD,
  acdbDrawCircleSides,
  acdbDrawTessellateOptions,
  acdbResolveCircleSides
} from '../src/misc/AcDbDrawTessellate'

describe('acdbDrawTessellateOptions', () => {
  it('falls back to the geometry default without a database', () => {
    expect(acdbResolveCircleSides(undefined)).toBe(
      AcGeCircArc2d.DEFAULT_CIRCLE_SIDES
    )
    expect(acdbDrawTessellateOptions().circleSides).toBe(
      ACDB_DRAW_CIRCLE_SIDES_STANDARD
    )
    expect(acdbDrawTessellateOptions().maxSegments).toBe(
      ACDB_DRAW_CIRCLE_SIDES_STANDARD
    )
  })

  it('defaults a new database to draft quality', () => {
    const db = new AcDbDatabase()

    expect(db.drawCircleSides).toBe(ACDB_DRAW_CIRCLE_SIDES_DRAFT)
    expect(acdbDrawCircleSides(db)).toBe(ACDB_DRAW_CIRCLE_SIDES_DRAFT)
    expect(
      acdbDrawTessellateOptions({ context: { database: db } }).circleSides
    ).toBe(ACDB_DRAW_CIRCLE_SIDES_DRAFT)
    expect(
      new AcGeCircArc2d(ORIGIN_POINT_2D, 10, 0, TAU, false).tessellate(
        acdbDrawTessellateOptions({ context: { database: db } })
      )
    ).toHaveLength(ACDB_DRAW_CIRCLE_SIDES_DRAFT + 1)
  })

  it('uses the open-time drawCircleSides on the database', () => {
    const db = new AcDbDatabase()
    db.drawCircleSides = ACDB_DRAW_CIRCLE_SIDES_STANDARD

    expect(acdbDrawCircleSides(db)).toBe(ACDB_DRAW_CIRCLE_SIDES_STANDARD)
    expect(
      acdbDrawTessellateOptions({ context: { database: db } }).circleSides
    ).toBe(ACDB_DRAW_CIRCLE_SIDES_STANDARD)
    expect(
      acdbDrawTessellateOptions({ context: { database: db } }).maxSegments
    ).toBe(ACDB_DRAW_CIRCLE_SIDES_STANDARD)
  })

  it('does not follow AutoCAD VIEWRES 1000 unless the user asked for it', () => {
    const db = new AcDbDatabase()
    const vport = new AcDbViewportTableRecord()
    vport.name = ACTIVE_VPORT_NAME
    vport.circleSides = 1000
    db.tables.viewportTable.add(vport)

    expect(acdbResolveCircleSides(db)).toBe(1000)
    expect(acdbDrawCircleSides(db)).toBe(ACDB_DRAW_CIRCLE_SIDES_DRAFT)

    const options = acdbDrawTessellateOptions({ context: { database: db } })
    expect(options.circleSides).toBe(ACDB_DRAW_CIRCLE_SIDES_DRAFT)
    expect(
      new AcGeCircArc2d(ORIGIN_POINT_2D, 10, 0, TAU, false).tessellate(options)
    ).toHaveLength(ACDB_DRAW_CIRCLE_SIDES_DRAFT + 1)
  })

  it('honours an explicit high-quality open-time side count', () => {
    const db = new AcDbDatabase()
    db.drawCircleSides = ACDB_DRAW_CIRCLE_SIDES_HIGH

    const options = acdbDrawTessellateOptions({ context: { database: db } })
    expect(options.circleSides).toBe(ACDB_DRAW_CIRCLE_SIDES_HIGH)
    expect(options.maxSegments).toBe(ACDB_DRAW_CIRCLE_SIDES_HIGH)
    expect(
      new AcGeCircArc2d(ORIGIN_POINT_2D, 10, 0, TAU, false).tessellate(options)
    ).toHaveLength(ACDB_DRAW_CIRCLE_SIDES_HIGH + 1)
  })
})

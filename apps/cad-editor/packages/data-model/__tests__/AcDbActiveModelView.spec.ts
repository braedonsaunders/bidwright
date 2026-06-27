import { AcGeBox2d, AcGePoint2d } from '@mlightcad/geometry-engine'

import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbViewportTableRecord } from '../src/database/AcDbViewportTableRecord'

function setVportAspectRatio(
  record: AcDbViewportTableRecord,
  aspectRatio: number
) {
  ;(record.gsView as { aspectRatio?: number }).aspectRatio = aspectRatio
}

function createDatabaseWithActiveVport(
  name: string,
  options: {
    centerX: number
    centerY: number
    viewHeight: number
    aspectRatio?: number
  }
) {
  const database = new AcDbDatabase()
  const record = new AcDbViewportTableRecord()
  record.name = name
  record.centerPoint = new AcGePoint2d(options.centerX, options.centerY)
  record.viewHeight = options.viewHeight
  if (options.aspectRatio != null) {
    setVportAspectRatio(record, options.aspectRatio)
  }
  database.tables.viewportTable.add(record)
  return database
}

describe('AcDbActiveModelView', () => {
  it('resolves *ACTIVE case-insensitively', () => {
    const database = createDatabaseWithActiveVport('*Active', {
      centerX: 10,
      centerY: 20,
      viewHeight: 100
    })

    expect(database.tables.viewportTable.getActiveVport()?.centerPoint).toEqual(
      {
        x: 10,
        y: 20
      }
    )
  })

  it('builds the view box from center, height, and canvas aspect ratio', () => {
    const record = new AcDbViewportTableRecord()
    record.centerPoint = new AcGePoint2d(100, 50)
    record.viewHeight = 40
    setVportAspectRatio(record, 2)

    const box = record.modelViewBox(1.5)
    expect(box).toBeInstanceOf(AcGeBox2d)
    expect(box!.min).toEqual({ x: 70, y: 30 })
    expect(box!.max).toEqual({ x: 130, y: 70 })
  })

  it('falls back to stored VPORT aspect ratio when canvas aspect is invalid', () => {
    const record = new AcDbViewportTableRecord()
    record.centerPoint = new AcGePoint2d(100, 50)
    record.viewHeight = 40
    setVportAspectRatio(record, 2)

    const box = record.modelViewBox(0)
    expect(box!.min).toEqual({ x: 60, y: 30 })
    expect(box!.max).toEqual({ x: 140, y: 70 })
  })

  it('uses canvas aspect ratio when VPORT aspect ratio is missing', () => {
    const record = new AcDbViewportTableRecord()
    record.centerPoint = new AcGePoint2d(0, 0)
    record.viewHeight = 10

    const box = record.modelViewBox(2)
    expect(box!.min).toEqual({ x: -10, y: -5 })
    expect(box!.max).toEqual({ x: 10, y: 5 })
  })

  it('returns undefined when view height is invalid', () => {
    const record = new AcDbViewportTableRecord()
    record.centerPoint = new AcGePoint2d(0, 0)
    record.viewHeight = 0

    expect(record.modelViewBox(1)).toBeUndefined()
  })

  it('resolves the saved model view box from the database', () => {
    const database = createDatabaseWithActiveVport('*ACTIVE', {
      centerX: 200,
      centerY: 100,
      viewHeight: 50,
      aspectRatio: 1.5
    })

    const box = database.tables.viewportTable.getActiveVportBox(1)
    expect(box!.min).toEqual({ x: 175, y: 75 })
    expect(box!.max).toEqual({ x: 225, y: 125 })
  })

  it('rejects a saved view zoomed far beyond drawing extents', () => {
    const database = createDatabaseWithActiveVport('*ACTIVE', {
      centerX: 58782,
      centerY: 8501,
      viewHeight: 62111,
      aspectRatio: 2.315
    })
    const drawingExtents = new AcGeBox2d(
      { x: -3500, y: -11024 },
      { x: 60760, y: 34416 }
    )
    const viewBox = database.tables.viewportTable.getActiveVportBox(
      1.778,
      drawingExtents
    )
    expect(viewBox).toBeUndefined()
  })

  it('uses the same view box for DWG and DXF aspect ratios at equal canvas size', () => {
    const drawingExtents = new AcGeBox2d(
      { x: -3500, y: -11024 },
      { x: 60760, y: 34416 }
    )
    const canvasAspect = 1.778
    const shared = {
      centerX: 58782.02699488195,
      centerY: 8501.312323181883,
      viewHeight: 62111.14484121096
    }

    for (const aspectRatio of [2.31511839708561, 1.7690802348336594]) {
      const database = createDatabaseWithActiveVport('*ACTIVE', {
        ...shared,
        aspectRatio
      })
      expect(
        database.tables.viewportTable.getActiveVportBox(
          canvasAspect,
          drawingExtents
        )
      ).toBeUndefined()
    }

    const dxfBox = createDatabaseWithActiveVport('*ACTIVE', {
      ...shared,
      aspectRatio: 2.31511839708561
    })
      .tables.viewportTable.getAt('*ACTIVE')!
      .modelViewBox(canvasAspect)
    const dwgBox = createDatabaseWithActiveVport('*ACTIVE', {
      ...shared,
      aspectRatio: 1.7690802348336594
    })
      .tables.viewportTable.getAt('*ACTIVE')!
      .modelViewBox(canvasAspect)

    expect(dxfBox!.min).toEqual(dwgBox!.min)
    expect(dxfBox!.max).toEqual(dwgBox!.max)
  })

  it('rejects a saved view panned away from the drawing', () => {
    const database = createDatabaseWithActiveVport('*ACTIVE', {
      centerX: 58782,
      centerY: 8501,
      viewHeight: 1000,
      aspectRatio: 1.778
    })
    const drawingExtents = new AcGeBox2d(
      { x: -3500, y: -11024 },
      { x: 60760, y: 34416 }
    )
    const viewBox = database.tables.viewportTable.getActiveVportBox(
      1.778,
      drawingExtents
    )
    expect(viewBox).toBeUndefined()
  })

  it('accepts a saved view that reasonably frames the drawing', () => {
    const database = createDatabaseWithActiveVport('*ACTIVE', {
      centerX: 23000,
      centerY: 24000,
      viewHeight: 9000,
      aspectRatio: 1.778
    })
    const drawingExtents = new AcGeBox2d(
      { x: -3500, y: -11024 },
      { x: 60760, y: 34416 }
    )
    const viewBox = database.tables.viewportTable.getActiveVportBox(
      1.778,
      drawingExtents
    )
    expect(viewBox).toBeDefined()
    expect(
      AcDbViewportTableRecord.isModelViewBoxUsable(viewBox!, drawingExtents)
    ).toBe(true)
  })

  it('rejects an oversized saved view when drawing extents are unavailable', () => {
    const database = createDatabaseWithActiveVport('*ACTIVE', {
      centerX: 58782,
      centerY: 8501,
      viewHeight: 62111,
      aspectRatio: 2.315
    })

    expect(
      database.tables.viewportTable.getActiveVportBox(1.778)
    ).toBeUndefined()
  })

  it('accepts a saved view when EXTMIN/EXTMAX are degenerate', () => {
    const database = createDatabaseWithActiveVport('*ACTIVE', {
      centerX: 38429942.5,
      centerY: 4067599.5,
      viewHeight: 3199,
      aspectRatio: 3647 / 3199
    })
    database.extmin = { x: 0, y: 0, z: 0 }
    database.extmax = { x: 0, y: 0, z: 0 }

    const viewBox = database.tables.viewportTable.getActiveVportBox(0)
    expect(viewBox).toBeDefined()
    expect(viewBox!.min.x).toBeCloseTo(38428119, 0)
    expect(viewBox!.max.x).toBeCloseTo(38431766, 0)
    expect(viewBox!.min.y).toBeCloseTo(4066000, 0)
    expect(viewBox!.max.y).toBeCloseTo(4069199, 0)
  })
})
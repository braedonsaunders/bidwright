import {
  AcGeArea2d,
  AcGeMatrix3d,
  AcGePoint3d
} from '@mlightcad/geometry-engine'

import { acdbHostApplicationServices, AcDbDxfFiler } from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbTrace } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

const createDb = () => {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('AcDbTrace', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbTrace())
  })

  it('exposes type names and default values', () => {
    const trace = new AcDbTrace()

    expect(AcDbTrace.typeName).toBe('Trace')
    expect(trace.dxfTypeName).toBe('TRACE')
    expect(trace.elevation).toBe(0)
    expect(trace.thickness).toBe(1)
    expect(trace.closed).toBe(true)
  })

  it('supports elevation/thickness and point accessors', () => {
    const trace = new AcDbTrace()
    trace.elevation = 12
    trace.thickness = 2.5

    trace.setPointAt(0, { x: 1, y: 2, z: 3 })
    trace.setPointAt(1, { x: 4, y: 5, z: 6 })
    trace.setPointAt(2, { x: 7, y: 8, z: 9 })
    trace.setPointAt(3, { x: 10, y: 11, z: 12 })

    expect(trace.elevation).toBe(12)
    expect(trace.thickness).toBe(2.5)
    expect(trace.getPointAt(0)).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(trace.getPointAt(3)).toMatchObject({ x: 10, y: 11, z: 12 })
    expect(trace.getPointAt(-100)).toBe(trace.getPointAt(0))
    expect(trace.getPointAt(100)).toBe(trace.getPointAt(3))
  })

  it('handles setPointAt out-of-range branches', () => {
    const trace = new AcDbTrace()

    trace.setPointAt(3, { x: 3, y: 3, z: 3 })
    trace.setPointAt(10, { x: 9, y: 9, z: 9 })
    expect(trace.getPointAt(3)).toMatchObject({ x: 9, y: 9, z: 9 })

    expect(() => trace.setPointAt(-1, { x: 1, y: 1, z: 1 })).toThrow()
  })

  it('computes geometric extents, grip points and osnap points', () => {
    const trace = new AcDbTrace()
    trace.setPointAt(0, { x: -2, y: -1, z: 0 })
    trace.setPointAt(1, { x: 3, y: -1, z: 1 })
    trace.setPointAt(2, { x: 4, y: 5, z: 2 })
    trace.setPointAt(3, { x: -1, y: 6, z: 3 })

    const extents = trace.geometricExtents
    expect(extents.min).toMatchObject({ x: -2, y: -1, z: 0 })
    expect(extents.max).toMatchObject({ x: 4, y: 6, z: 3 })

    const grips = trace.subGetGripPoints()
    expect(grips).toHaveLength(4)
    expect(grips[0]).toBe(trace.getPointAt(0))

    const endpointSnaps: AcGePoint3d[] = []
    trace.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endpointSnaps
    )
    expect(endpointSnaps).toHaveLength(4)

    const otherSnaps: AcGePoint3d[] = []
    trace.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      otherSnaps
    )
    expect(otherSnaps).toHaveLength(0)

    const midPoints: AcGePoint3d[] = []
    trace.subGetOsnapPoints(
      AcDbOsnapMode.MidPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      midPoints
    )
    expect(midPoints).toHaveLength(4)

    const nearestPoints: AcGePoint3d[] = []
    trace.subGetOsnapPoints(
      AcDbOsnapMode.Nearest,
      new AcGePoint3d(0.5, -1, 0.5),
      new AcGePoint3d(),
      nearestPoints
    )
    expect(nearestPoints).toHaveLength(1)
    expect(nearestPoints[0].x).toBeCloseTo(0.5)
    expect(nearestPoints[0].y).toBeCloseTo(-1)
    expect(nearestPoints[0].z).toBeCloseTo(0.5)

    const perpendicularPoints: AcGePoint3d[] = []
    trace.subGetOsnapPoints(
      AcDbOsnapMode.Perpendicular,
      new AcGePoint3d(0.5, 10, 0),
      new AcGePoint3d(),
      perpendicularPoints
    )
    expect(perpendicularPoints).toHaveLength(1)
  })

  it('updates geometricExtents when a corner point changes', () => {
    const trace = new AcDbTrace()
    trace.setPointAt(0, { x: 0, y: 0, z: 0 })
    trace.setPointAt(1, { x: 4, y: 0, z: 0 })
    trace.setPointAt(2, { x: 4, y: 3, z: 0 })
    trace.setPointAt(3, { x: 0, y: 3, z: 0 })

    expect(trace.geometricExtents.max).toMatchObject({ x: 4, y: 3, z: 0 })

    trace.setPointAt(1, { x: 10, y: 0, z: 0 })

    expect(trace.geometricExtents.max).toMatchObject({ x: 10, y: 3, z: 0 })
  })

  it('orders DXF solid corners as a perimeter loop when drawing', () => {
    const trace = new AcDbTrace()
    trace.setPointAt(0, { x: 0, y: 0, z: 0 })
    trace.setPointAt(1, { x: 10, y: 0, z: 0 })
    trace.setPointAt(2, { x: 0, y: 5, z: 0 })
    trace.setPointAt(3, { x: 10, y: 5, z: 0 })

    let capturedArea: AcGeArea2d | undefined
    const renderer = {
      subEntityTraits: { fillType: undefined as unknown },
      area: jest.fn((area: AcGeArea2d) => {
        capturedArea = area
        return { id: 'trace-area' }
      })
    }

    trace.subWorldDraw(renderer as never)

    expect(renderer.area).toHaveBeenCalledTimes(1)
    const boundary = capturedArea!.getPoints(4)[0]
    expect(boundary).toHaveLength(5)
    expect(boundary.map(point => [point.x, point.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [0, 5],
      [0, 0]
    ])
  })

  it('transforms itself and draws as filled area', () => {
    const trace = new AcDbTrace()
    trace.setPointAt(0, { x: 0, y: 0, z: 1 })
    trace.setPointAt(1, { x: 2, y: 0, z: 1 })
    trace.setPointAt(2, { x: 2, y: 1, z: 1 })
    trace.setPointAt(3, { x: 0, y: 1, z: 1 })

    expect(
      trace.transformBy(new AcGeMatrix3d().makeTranslation(5, -2, 3))
    ).toBe(trace)
    expect(trace.getPointAt(0)).toMatchObject({ x: 5, y: -2, z: 4 })
    expect(trace.elevation).toBe(4)

    const traits = { fillType: undefined as unknown }
    const rendered = { id: 'trace-area' }
    const renderer = {
      subEntityTraits: traits,
      area: jest.fn(() => rendered)
    }

    expect(trace.subWorldDraw(renderer as never)).toBe(rendered)
    expect(renderer.area).toHaveBeenCalledTimes(1)
    expect(traits.fillType).toMatchObject({ solidFill: true, patternAngle: 0 })
  })

  it('writes DXF fields for trace geometry and returns self', () => {
    const db = createDb()
    const trace = new AcDbTrace()
    trace.elevation = 8
    trace.thickness = 0.75
    trace.setPointAt(0, { x: 1, y: 2, z: 3 })
    trace.setPointAt(1, { x: 4, y: 5, z: 6 })
    trace.setPointAt(2, { x: 7, y: 8, z: 9 })
    trace.setPointAt(3, { x: 10, y: 11, z: 12 })
    db.tables.blockTable.modelSpace.appendEntity(trace)

    const filer = new AcDbDxfFiler()
    expect(trace.dxfOutFields(filer)).toBe(trace)

    const out = filer.toString()
    expect(out).toContain('100\nAcDbTrace\n')
    expect(out).toContain('38\n8\n')
    expect(out).toContain('39\n0.75\n')
    expect(out).toContain('10\n1\n20\n2\n30\n3\n')
    expect(out).toContain('11\n4\n21\n5\n31\n6\n')
    expect(out).toContain('12\n7\n22\n8\n32\n9\n')
    expect(out).toContain('13\n10\n23\n11\n33\n12\n')
  })

  it('computes quadrilateral area', () => {
    const trace = new AcDbTrace()
    trace.setPointAt(0, new AcGePoint3d(0, 0, 0))
    trace.setPointAt(1, new AcGePoint3d(10, 0, 0))
    trace.setPointAt(2, new AcGePoint3d(0, 5, 0))
    trace.setPointAt(3, new AcGePoint3d(10, 5, 0))
    expect(trace.area).toBeCloseTo(50, 8)
  })
})

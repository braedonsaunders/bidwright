import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbProxyEntity } from '../src/entity/AcDbProxyEntity'
import {
  AcDbProxyGraphic,
  AcDbProxyGraphicType,
  loadAcDbProxyGraphicFromDxf
} from '../src/misc/proxyGraphic'
import { setupWorkingDatabase } from '../test-utils/entityTestUtils'

function writeUint32LE(buffer: Uint8Array, offset: number, value: number) {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4)
  view.setUint32(0, value, true)
}

function writeDoubleLE(buffer: Uint8Array, offset: number, value: number) {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 8)
  view.setFloat64(0, value, true)
}

function buildPolylineProxyGraphic(
  points: Array<[number, number, number]>
): Uint8Array {
  const dataSize = 4 + points.length * 24
  const chunkSize = 8 + dataSize
  const buffer = new Uint8Array(8 + chunkSize)
  writeUint32LE(buffer, 8, chunkSize)
  writeUint32LE(buffer, 12, AcDbProxyGraphicType.Polyline)
  writeUint32LE(buffer, 16, points.length)
  let offset = 20
  for (const [x, y, z] of points) {
    writeDoubleLE(buffer, offset, x)
    writeDoubleLE(buffer, offset + 8, y)
    writeDoubleLE(buffer, offset + 16, z)
    offset += 24
  }
  return buffer
}

function buildExtentsProxyGraphic(
  min: [number, number, number],
  max: [number, number, number]
): Uint8Array {
  const chunkSize = 8 + 48
  const buffer = new Uint8Array(8 + chunkSize)
  writeUint32LE(buffer, 8, chunkSize)
  writeUint32LE(buffer, 12, AcDbProxyGraphicType.Extents)
  writeDoubleLE(buffer, 16, min[0])
  writeDoubleLE(buffer, 24, min[1])
  writeDoubleLE(buffer, 32, min[2])
  writeDoubleLE(buffer, 40, max[0])
  writeDoubleLE(buffer, 48, max[1])
  writeDoubleLE(buffer, 56, max[2])
  return buffer
}

describe('AcDbProxyGraphic', () => {
  it('renders polyline commands through the renderer', () => {
    const graphic = buildPolylineProxyGraphic([
      [0, 0, 0],
      [10, 0, 0]
    ])
    const parser = new AcDbProxyGraphic(graphic)
    const linesResult = { id: 'lines' }
    const groupResult = { id: 'group' }
    const renderer = {
      subEntityTraits: {
        color: { clone: () => ({}) },
        lineType: { name: 'Continuous', definitionLines: [] },
        lineTypeScale: 1,
        lineWeight: -3,
        layer: '0',
        thickness: 0
      },
      lines: jest.fn(() => linesResult),
      group: jest.fn(() => groupResult)
    }

    const result = parser.worldDraw(renderer as never)
    expect(result).toBe(groupResult)
    expect(renderer.lines).toHaveBeenCalledTimes(1)
    const points = (renderer.lines as jest.Mock).mock
      .calls[0][0] as AcGePoint3d[]
    expect(points).toHaveLength(2)
    expect(points[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(points[1]).toMatchObject({ x: 10, y: 0, z: 0 })
  })

  it('scans extents without rendering', () => {
    const graphic = buildExtentsProxyGraphic([1, 2, 3], [4, 5, 6])
    const parser = new AcDbProxyGraphic(graphic)
    const extents = parser.scanExtents()
    expect(extents?.[0]).toMatchObject({ x: 1, y: 2, z: 3 })
    expect(extents?.[1]).toMatchObject({ x: 4, y: 5, z: 6 })
  })

  it('loads proxy graphic bytes from DXF hex chunks', () => {
    const graphic = buildPolylineProxyGraphic([[0, 0, 0]])
    const hex = Array.from(graphic, byte =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    const loaded = loadAcDbProxyGraphicFromDxf(graphic.length, [hex])
    expect(loaded).toEqual(graphic)
  })
})

describe('AcDbProxyEntity', () => {
  it('draws proxy graphics in subWorldDraw', () => {
    setupWorkingDatabase()
    const entity = new AcDbProxyEntity()
    entity.setProxyGraphic(
      buildPolylineProxyGraphic([
        [0, 0, 0],
        [5, 5, 0]
      ])
    )
    entity.originalDxfName = 'CUSTOM_ENTITY'

    const groupResult = { id: 'proxy-group' }
    const renderer = {
      subEntityTraits: {
        color: { clone: () => ({}) },
        lineType: { name: 'Continuous', definitionLines: [] },
        lineTypeScale: 1,
        lineWeight: -3,
        layer: '0',
        thickness: 0
      },
      lines: jest.fn(() => ({ id: 'line' })),
      group: jest.fn(() => groupResult)
    }

    expect(entity.subWorldDraw(renderer as never)).toBe(groupResult)
    expect(renderer.group).toHaveBeenCalled()
  })

  it('returns geometric extents from EXTENTS chunks', () => {
    setupWorkingDatabase()
    const entity = new AcDbProxyEntity()
    entity.setProxyGraphic(buildExtentsProxyGraphic([0, 0, 0], [10, 20, 0]))
    const extents = entity.geometricExtents
    expect(extents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(extents.max).toMatchObject({ x: 10, y: 20, z: 0 })
  })

  it('returns entity origins or extents corners as grip points', () => {
    setupWorkingDatabase()
    const entity = new AcDbProxyEntity()
    entity.setEntityOrigins([new AcGePoint3d(1, 2, 3)])

    expect(entity.subGetGripPoints()).toEqual([entity.entityOrigins[0]])

    const extentsEntity = new AcDbProxyEntity()
    extentsEntity.setProxyGraphic(
      buildExtentsProxyGraphic([0, 0, 0], [10, 20, 0])
    )
    const grips = extentsEntity.subGetGripPoints()

    expect(grips).toHaveLength(2)
    expect(grips[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(grips[1]).toMatchObject({ x: 10, y: 20, z: 0 })
  })

  it('transformBy applies a world transform when entity origins are absent', () => {
    setupWorkingDatabase()
    const entity = new AcDbProxyEntity()
    entity.setProxyGraphic(
      buildPolylineProxyGraphic([
        [0, 0, 0],
        [10, 0, 0]
      ])
    )

    entity.transformBy(new AcGeMatrix3d().makeTranslation(5, 0, 0))

    const renderer = {
      subEntityTraits: {
        color: { clone: () => ({}) },
        lineType: { name: 'Continuous', definitionLines: [] },
        lineTypeScale: 1,
        lineWeight: -3,
        layer: '0',
        thickness: 0
      },
      lines: jest.fn(() => ({ id: 'line', applyMatrix: jest.fn() })),
      group: jest.fn(entities => ({
        id: 'group',
        applyMatrix: jest.fn(function (
          this: { applyMatrix: jest.Mock },
          matrix
        ) {
          entities.forEach((child: { applyMatrix?: jest.Mock }) =>
            child.applyMatrix?.(matrix)
          )
        })
      }))
    }

    entity.subWorldDraw(renderer as never)
    const points = (renderer.lines as jest.Mock).mock
      .calls[0][0] as AcGePoint3d[]
    expect(points[0]).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(points[1]).toMatchObject({ x: 10, y: 0, z: 0 })
    expect(renderer.group).toHaveBeenCalled()
    const group = (renderer.group as jest.Mock).mock.results[0].value
    expect(group.applyMatrix).toHaveBeenCalledTimes(1)
  })

  it('transformBy updates geometric extents when entity origins are absent', () => {
    setupWorkingDatabase()
    const entity = new AcDbProxyEntity()
    entity.setProxyGraphic(buildExtentsProxyGraphic([0, 0, 0], [10, 20, 0]))

    entity.transformBy(new AcGeMatrix3d().makeTranslation(5, 0, 0))

    const extents = entity.geometricExtents
    expect(extents.min).toMatchObject({ x: 5, y: 0, z: 0 })
    expect(extents.max).toMatchObject({ x: 15, y: 20, z: 0 })
  })
})
import { AcGeMatrix3d, AcGePoint3d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../src/base'
import { AcDbPolygonMesh } from '../src/entity'
import { AcDbOsnapMode } from '../src/misc'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'
import {
  attachEntityToNewModelSpace,
  getDxfGroupValues,
  setupWorkingDatabase
} from '../test-utils/entityTestUtils'

describe('AcDbPolygonMesh', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbPolygonMesh(1, 1, [{ x: 0, y: 0, z: 0 }]))
  })

  it('covers constructor defaults and basic getters/setters', () => {
    setupWorkingDatabase()

    const mesh = new AcDbPolygonMesh(
      2,
      2,
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 1 },
        { x: 1, y: 1, z: 1 }
      ],
      true,
      false
    )

    expect(AcDbPolygonMesh.typeName).toBe('PolygonMesh')
    expect(mesh.dxfTypeName).toBe('POLYLINE')
    expect(mesh.mCount).toBe(2)
    expect(mesh.nCount).toBe(2)
    expect(mesh.closedM).toBe(true)
    expect(mesh.closedN).toBe(false)
    expect(mesh.closed).toBe(true)
    expect(mesh.numberOfVertices).toBe(4)
    expect(mesh.objectId.startsWith('TEMP_')).toBe(false)

    mesh.closed = false
    expect(mesh.closed).toBe(false)
    expect(mesh.closedM).toBe(false)
  })

  it('supports getVertexAt and getVertexAtMN with bounds checks', () => {
    const mesh = new AcDbPolygonMesh(2, 2, [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 1, z: 1 }
    ])

    expect(mesh.getVertexAt(0).position).toEqual(new AcGePoint3d(0, 0, 0))
    expect(mesh.getVertexAtMN(1, 0).position).toEqual(new AcGePoint3d(0, 1, 1))
    expect(mesh.getVertexAtMN(1, 1).position).toEqual(new AcGePoint3d(1, 1, 1))

    expect(() => mesh.getVertexAt(-1)).toThrow('Vertex index out of bounds')
    expect(() => mesh.getVertexAt(4)).toThrow('Vertex index out of bounds')
    expect(() => mesh.getVertexAtMN(3, 0)).toThrow('Vertex index out of bounds')
  })

  it('computes geometric extents for populated and empty meshes', () => {
    const mesh = new AcDbPolygonMesh(2, 2, [
      { x: -2, y: 5, z: 1 },
      { x: 3, y: -4, z: 2 },
      { x: 1, y: 1, z: -6 },
      { x: 2, y: 2, z: 10 }
    ])
    const extents = mesh.geometricExtents
    expect(extents.min).toMatchObject({ x: -2, y: -4, z: -6 })
    expect(extents.max).toMatchObject({ x: 3, y: 5, z: 10 })

    const empty = new AcDbPolygonMesh(0, 0, [])
    expect(empty.geometricExtents.min).toMatchObject({ x: 0, y: 0, z: 0 })
    expect(empty.geometricExtents.max).toMatchObject({ x: 0, y: 0, z: 0 })
  })

  it('updates geometricExtents when a vertex position changes', () => {
    const mesh = new AcDbPolygonMesh(2, 2, [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 0, y: 3, z: 0 },
      { x: 5, y: 3, z: 0 }
    ])

    expect(mesh.geometricExtents.max).toMatchObject({ x: 5, y: 3, z: 0 })

    mesh.getVertexAt(1).position.set(10, 8, 4)

    expect(mesh.geometricExtents.max).toMatchObject({ x: 10, y: 8, z: 4 })
  })

  it('returns grip points and endpoint osnap points only', () => {
    const mesh = new AcDbPolygonMesh(1, 3, [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 1 },
      { x: 2, y: 3, z: 2 }
    ])

    const grips = mesh.subGetGripPoints()
    expect(grips).toEqual([
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(2, 0, 1),
      new AcGePoint3d(2, 3, 2)
    ])

    const endpointSnaps: AcGePoint3d[] = []
    mesh.subGetOsnapPoints(
      AcDbOsnapMode.EndPoint,
      new AcGePoint3d(),
      new AcGePoint3d(),
      endpointSnaps
    )
    expect(endpointSnaps).toEqual(grips)

    const centerSnaps: AcGePoint3d[] = []
    mesh.subGetOsnapPoints(
      AcDbOsnapMode.Center,
      new AcGePoint3d(),
      new AcGePoint3d(),
      centerSnaps
    )
    expect(centerSnaps).toHaveLength(0)
  })

  it('transforms vertices and returns self', () => {
    const mesh = new AcDbPolygonMesh(1, 2, [
      { x: 1, y: 2, z: 3 },
      { x: -1, y: 0, z: 5 }
    ])

    expect(
      mesh.transformBy(new AcGeMatrix3d().makeTranslation(10, -2, 4))
    ).toBe(mesh)
    expect(mesh.getVertexAt(0).position).toEqual(new AcGePoint3d(11, 0, 7))
    expect(mesh.getVertexAt(1).position).toEqual(new AcGePoint3d(9, -2, 9))
  })

  it('exposes properties and supports closedM/closedN accessors', () => {
    const mesh = new AcDbPolygonMesh(
      2,
      2,
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 }
      ],
      false,
      true
    )

    const props = mesh.properties
    expect(props.type).toBe(mesh.type)

    const geometryGroup = props.groups.find(g => g.groupName === 'geometry')
    const othersGroup = props.groups.find(g => g.groupName === 'others')

    expect(geometryGroup).toBeDefined()
    expect(othersGroup).toBeDefined()

    const mCountProp = geometryGroup!.properties.find(p => p.name === 'mCount')
    const nCountProp = geometryGroup!.properties.find(p => p.name === 'nCount')
    const verticesProp = geometryGroup!.properties.find(
      p => p.name === 'vertices'
    )
    const closedMProp = othersGroup!.properties.find(p => p.name === 'closedM')
    const closedNProp = othersGroup!.properties.find(p => p.name === 'closedN')

    expect(mCountProp?.accessor.get()).toBe(2)
    expect(nCountProp?.accessor.get()).toBe(2)
    expect(verticesProp?.accessor.get()).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 }
    ])
    expect(closedMProp?.accessor.get()).toBe(false)
    expect(closedNProp?.accessor.get()).toBe(true)

    closedMProp?.accessor.set?.(true)
    closedNProp?.accessor.set?.(false)

    expect(closedMProp?.accessor.get()).toBe(true)
    expect(closedNProp?.accessor.get()).toBe(false)
    expect(mesh.closedM).toBe(true)
    expect(mesh.closedN).toBe(false)
  })

  it('draws mesh lines for open and closed directions', () => {
    const vertices = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 }
    ]

    const openMesh = new AcDbPolygonMesh(2, 2, vertices, false, false)
    const openRenderer = { lines: jest.fn(() => ({ id: 'open' })) }
    const openResult = openMesh.subWorldDraw(openRenderer as never)
    expect(openResult).toEqual({ id: 'open' })
    expect(openRenderer.lines).toHaveBeenCalledTimes(1)
    const [openLines] = openRenderer.lines.mock.calls[0] as unknown as [
      AcGePoint3d[]
    ]
    expect(openLines).toHaveLength(8)

    const closedMesh = new AcDbPolygonMesh(2, 2, vertices, true, true)
    const closedRenderer = { lines: jest.fn(() => ({ id: 'closed' })) }
    const closedResult = closedMesh.subWorldDraw(closedRenderer as never)
    expect(closedResult).toEqual({ id: 'closed' })
    expect(closedRenderer.lines).toHaveBeenCalledTimes(1)
    const [closedLines] = closedRenderer.lines.mock.calls[0] as unknown as [
      AcGePoint3d[]
    ]
    expect(closedLines).toHaveLength(16)
  })

  it('writes polygon mesh DXF fields and vertex records', () => {
    const mesh = new AcDbPolygonMesh(
      2,
      2,
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 1 },
        { x: 0, y: 1, z: 2 },
        { x: 1, y: 1, z: 3 }
      ],
      true,
      true
    )
    attachEntityToNewModelSpace(mesh)

    const filerFields = new AcDbDxfFiler()
    expect(mesh.dxfOutFields(filerFields)).toBe(mesh)
    const fieldsDxf = filerFields.toString()
    expect(getDxfGroupValues(fieldsDxf, 100)).toContain('AcDbPolygonMesh')
    expect(getDxfGroupValues(fieldsDxf, 66)).toContain('1')
    expect(getDxfGroupValues(fieldsDxf, 70)).toContain('49')
    expect(getDxfGroupValues(fieldsDxf, 71)).toContain('2')
    expect(getDxfGroupValues(fieldsDxf, 72)).toContain('2')

    const filerOut = new AcDbDxfFiler()
    expect(mesh.dxfOut(filerOut, true)).toBe(mesh)
    const outDxf = filerOut.toString()

    expect(
      getDxfGroupValues(outDxf, 0).filter(v => v === 'VERTEX')
    ).toHaveLength(4)
    expect(getDxfGroupValues(outDxf, 0)).toContain('SEQEND')
    expect(getDxfGroupValues(outDxf, 100)).toContain('AcDbPolygonMeshVertex')
    expect(
      getDxfGroupValues(outDxf, 70).filter(v => v === '16').length
    ).toBeGreaterThanOrEqual(4)
    expect(getDxfGroupValues(outDxf, 10).slice(-4)).toEqual([
      '0',
      '1',
      '0',
      '1'
    ])
    expect(getDxfGroupValues(outDxf, 20).slice(-4)).toEqual([
      '0',
      '0',
      '1',
      '1'
    ])
    expect(getDxfGroupValues(outDxf, 30).slice(-4)).toEqual([
      '0',
      '1',
      '2',
      '3'
    ])

    const filerOutWithoutAllXData = new AcDbDxfFiler()
    expect(mesh.dxfOut(filerOutWithoutAllXData)).toBe(mesh)
  })
})

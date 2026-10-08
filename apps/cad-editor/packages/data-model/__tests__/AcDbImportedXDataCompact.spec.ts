import { AcGePoint3d } from '@mlightcad/geometry-engine'

import {
  AcDbDxfCode,
  AcDbDxfFiler,
  acdbHostApplicationServices,
  AcDbResultBuffer
} from '../src/base'
import { AcDbDatabase } from '../src/database'
import { AcDbLine } from '../src/entity'

const imported = () => [
  { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'MYAPP' },
  { code: AcDbDxfCode.ExtendedDataAsciiString, value: 'hello-xdata' },
  { code: AcDbDxfCode.ExtendedDataInteger16, value: 42 }
]

const threeApps = () => [
  { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'APP1' },
  { code: AcDbDxfCode.ExtendedDataAsciiString, value: 'one' },
  { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'APP2' },
  { code: AcDbDxfCode.ExtendedDataAsciiString, value: 'two' },
  { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'APP3' },
  { code: AcDbDxfCode.ExtendedDataAsciiString, value: 'three' }
]

function createBackedLine() {
  const db = new AcDbDatabase()
  db.createDefaultData()
  acdbHostApplicationServices().workingDatabase = db

  const line = new AcDbLine(
    new AcGePoint3d(0, 0, 0),
    new AcGePoint3d(1, 0, 0)
  )
  db.tables.blockTable.modelSpace.appendEntity(line)
  return { db, line }
}

function dxfOf(db: AcDbDatabase, line: AcDbLine): string {
  const filer = new AcDbDxfFiler({ database: db })
  line.dxfOut(filer, true)
  return filer.toString()
}

function appOrder(dxf: string): number[] {
  return ['APP1', 'APP2', 'APP3'].map(app => dxf.indexOf(`1001\n${app}\n`))
}

describe('compact imported XData', () => {
  it('materializes losslessly and preserves mutable getXData semantics', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )
    line.setImportedXData(imported() as never)

    const xdata = line.getXData('MYAPP')
    expect(xdata?.toArray()).toEqual(imported())

    xdata!.at(1)!.value = 'changed'
    expect(line.getXData('MYAPP')?.at(1)?.value).toBe('changed')
  })

  it('lets setXData replace imported data and removeXData remove it', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )
    line.setImportedXData(imported() as never)

    line.setXData(
      new AcDbResultBuffer([
        {
          code: AcDbDxfCode.ExtendedDataRegAppName,
          value: 'MYAPP'
        },
        {
          code: AcDbDxfCode.ExtendedDataAsciiString,
          value: 'replacement'
        }
      ])
    )

    expect(line.getXData('MYAPP')?.at(1)?.value).toBe('replacement')
    line.removeXData('MYAPP')
    expect(line.getXData('MYAPP')).toBeUndefined()
  })

  it('clones/restores compact imported XData without data loss', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )
    line.setImportedXData(imported() as never)

    const snapshot = line.clonePreservingIdentity()
    line.removeXData('MYAPP')
    line.restoreFrom(snapshot)

    expect(line.getXData('MYAPP')?.toArray()).toEqual(imported())
  })

  it('streams compact imported XData to DXF output', () => {
    // AcDbEntity.dxfOutFields reads database-backed entity state.
    // The previous version of this test created a detached line without
    // installing a working database, so it failed before XData output ran.
    const { db, line } = createBackedLine()
    line.setImportedXData(imported() as never)

    const dxf = dxfOf(db, line)

    expect(dxf).toContain('1001\nMYAPP\n')
    expect(dxf).toContain('1000\nhello-xdata\n')
    expect(dxf).toContain('1070\n42\n')
  })

  it('splits one import on each app and keeps DXF order after a read', () => {
    const { db, line } = createBackedLine()
    line.setImportedXData(threeApps() as never)

    line.getXData('APP2')
    const dxf = dxfOf(db, line)
    const order = appOrder(dxf)

    expect(order[0]).toBeGreaterThanOrEqual(0)
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    expect(dxf).toContain('1000\ntwo\n')
  })

  it('keeps DXF order when setXData replaces one imported app', () => {
    const { db, line } = createBackedLine()
    line.setImportedXData(threeApps() as never)
    line.setXData(
      new AcDbResultBuffer([
        { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'APP2' },
        { code: AcDbDxfCode.ExtendedDataAsciiString, value: 'replaced' }
      ])
    )

    const dxf = dxfOf(db, line)
    const order = appOrder(dxf)

    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    expect(dxf).toContain('1000\none\n')
    expect(dxf).toContain('1000\nreplaced\n')
    expect(dxf).toContain('1000\nthree\n')
  })

  it('removes one imported app and leaves the others', () => {
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(1, 0, 0)
    )
    line.setImportedXData(threeApps() as never)

    line.removeXData('APP2')

    expect(line.getXData('APP2')).toBeUndefined()
    expect(line.getXData('APP1')?.at(1)?.value).toBe('one')
    expect(line.getXData('APP3')?.at(1)?.value).toBe('three')
  })

  it('restores app order after one app was materialized', () => {
    const { db, line } = createBackedLine()
    line.setImportedXData(threeApps() as never)
    line.getXData('APP1')

    const snapshot = line.clonePreservingIdentity()
    line.removeXData('APP1')
    line.removeXData('APP2')
    line.removeXData('APP3')
    line.restoreFrom(snapshot)

    const order = appOrder(dxfOf(db, line))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    expect(line.getXData('APP1')?.at(1)?.value).toBe('one')
    expect(line.getXData('APP3')?.at(1)?.value).toBe('three')
  })

  it('chunks compact binary XData on group 1004', () => {
    const { db, line } = createBackedLine()
    const bytes = new Uint8Array(130)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff
    const hex = Array.from(bytes, byte =>
      byte.toString(16).padStart(2, '0').toUpperCase()
    ).join('')

    line.setImportedXData([
      { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'MYAPP' },
      { code: AcDbDxfCode.ExtendedDataBinaryChunk, value: hex }
    ] as never)

    const dxf = dxfOf(db, line)
    expect(dxf.match(/1004\n/g)).toHaveLength(2)
    expect(dxf).toContain(`1004\n${hex.slice(0, 254)}\n`)
    expect(dxf).toContain(`1004\n${hex.slice(254)}\n`)
  })

  it('expands compact imported XData point objects on DXF out', () => {
    const { db, line } = createBackedLine()
    line.setImportedXData([
      { code: AcDbDxfCode.ExtendedDataRegAppName, value: 'MYAPP' },
      {
        code: AcDbDxfCode.ExtendedDataXCoordinate,
        value: { x: 12.5, y: -3, z: 0.25 }
      },
      {
        code: AcDbDxfCode.ExtendedDataBinaryChunk,
        value: new Uint8Array([0xde, 0xad, 0xbe, 0xef])
      }
    ] as never)

    const dxf = dxfOf(db, line)
    expect(dxf).not.toContain('[object Object]')
    expect(dxf).toContain('1010\n12.5\n1020\n-3\n1030\n0.25\n')
    expect(dxf).toContain('1004\nDEADBEEF\n')
  })
})

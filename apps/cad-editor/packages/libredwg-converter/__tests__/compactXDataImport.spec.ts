import {
  AcDbDatabase,
  AcDbDxfFiler,
  acdbHostApplicationServices,
  AcDbLine
} from '@mlightcad/data-model'
import type { DwgEntity } from '@mlightcad/libredwg-web'

import { AcDbEntityConverter } from '../src/AcDbEntitiyConverter'

describe('LibreDWG compact XData import', () => {
  it('preserves both entity XData and extensionDictionary', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()

    const line = converter.convert({
      type: 'LINE',
      handle: 'A1',
      layer: '0',
      ownerBlockRecordSoftId: 'MS',
      ownerDictionaryHardId: 'ABCD',
      startPoint: { x: 0, y: 0, z: 0 },
      endPoint: { x: 1, y: 0, z: 0 },
      xdata: {
        appName: 'MYAPP',
        value: [
          { code: 1000, value: 'hello-xdata' },
          { code: 1070, value: 42 }
        ]
      }
    } as unknown as DwgEntity) as AcDbLine

    expect(line).toBeInstanceOf(AcDbLine)
    expect(line.extensionDictionary).toBe('ABCD')
    expect(line.getXData('MYAPP')?.toArray()).toEqual([
      { code: 1001, value: 'MYAPP' },
      { code: 1000, value: 'hello-xdata' },
      { code: 1070, value: 42 }
    ])
  })

  it('keeps XData points and binary chunks without stringifying objects', () => {
    acdbHostApplicationServices().workingDatabase = new AcDbDatabase()
    const converter = new AcDbEntityConverter()

    const line = converter.convert({
      type: 'LINE',
      handle: 'A2',
      layer: '0',
      ownerBlockRecordSoftId: 'MS',
      startPoint: { x: 0, y: 0, z: 0 },
      endPoint: { x: 1, y: 0, z: 0 },
      xdata: {
        appName: 'GEOAPP',
        value: [
          { code: 1010, value: { x: 1.25, y: 2.5, z: 3.75 } },
          { code: 1004, value: [0x01, 0x02, 0xff] }
        ]
      }
    } as unknown as DwgEntity) as AcDbLine

    const xdata = line.getXData('GEOAPP')?.toArray()
    expect(xdata).toEqual([
      { code: 1001, value: 'GEOAPP' },
      { code: 1010, value: { x: 1.25, y: 2.5, z: 3.75 } },
      { code: 1004, value: new Uint8Array([0x01, 0x02, 0xff]) }
    ])

    const filer = new AcDbDxfFiler({
      database: acdbHostApplicationServices().workingDatabase
    })
    line.dxfOut(filer, true)
    const dxf = filer.toString()
    expect(dxf).not.toContain('[object Object]')
    expect(dxf).toContain('1010\n1.25\n1020\n2.5\n1030\n3.75\n')
    expect(dxf).toContain('1004\n0102FF\n')
  })
})

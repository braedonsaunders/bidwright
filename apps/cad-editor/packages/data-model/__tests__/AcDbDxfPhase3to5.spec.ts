import { AcGePoint3d } from '@mlightcad/geometry-engine'

import {
  AcDbDxfFiler,
  AcDbResultBuffer,
  acdbCreateDxfPairReader,
  acdbHostApplicationServices,
  acdbIsBinaryDxf
} from '../src/base'
import {
  AcDbDatabase,
  AcDbDimStyleTableRecord,
  AcDbLayerTableRecord,
  AcDbRegAppTableRecord,
  AcDbUcsTableRecord,
  AcDbViewTableRecord
} from '../src/database'
import { AcDbDxfDocumentReader } from '../src/dxf'
import { acdbDxfInDimension } from '../src/dxf/AcDbDxfDimensionAssembler'
import { AcDbArcDimension, AcDbLine } from '../src/entity'
import { AcDbGroup } from '../src/object/AcDbGroup'
import { AcDbSortentsTable } from '../src/object/AcDbSortentsTable'

function createWorkingDb() {
  const db = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = db
  return db
}

describe('DXF Phase 3–5 extensions', () => {
  it('round-trips APPID, VIEW, and UCS table snippets', async () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'TABLES',
      '0',
      'TABLE',
      '2',
      'APPID',
      '0',
      'APPID',
      '5',
      'A1',
      '100',
      'AcDbSymbolTableRecord',
      '100',
      'AcDbRegAppTableRecord',
      '2',
      'MYAPP',
      '70',
      '0',
      '0',
      'ENDTAB',
      '0',
      'TABLE',
      '2',
      'VIEW',
      '0',
      'VIEW',
      '5',
      'A2',
      '100',
      'AcDbSymbolTableRecord',
      '100',
      'AcDbViewTableRecord',
      '2',
      'Front',
      '70',
      '0',
      '40',
      '100',
      '10',
      '5',
      '20',
      '6',
      '41',
      '200',
      '0',
      'ENDTAB',
      '0',
      'TABLE',
      '2',
      'UCS',
      '0',
      'UCS',
      '5',
      'A3',
      '100',
      'AcDbSymbolTableRecord',
      '100',
      'AcDbUCSTableRecord',
      '2',
      'MyUcs',
      '70',
      '0',
      '10',
      '1',
      '20',
      '2',
      '30',
      '3',
      '11',
      '1',
      '21',
      '0',
      '31',
      '0',
      '12',
      '0',
      '22',
      '1',
      '32',
      '0',
      '0',
      'ENDTAB',
      '0',
      'ENDSEC',
      '0',
      'EOF'
    ].join('\n')

    const db = createWorkingDb()
    const filer = AcDbDxfFiler.fromString(dxf, { database: db })
    await new AcDbDxfDocumentReader(db).read(filer)

    const app = db.tables.appIdTable.getAt('MYAPP')
    expect(app).toBeInstanceOf(AcDbRegAppTableRecord)
    expect(app?.name).toBe('MYAPP')

    const view = db.tables.viewTable.getAt('Front')
    expect(view).toBeInstanceOf(AcDbViewTableRecord)
    expect(view?.viewWidth).toBe(200)
    expect(view?.gsView.viewHeight).toBe(100)
    expect(view?.centerPoint.x).toBe(5)
    expect(view?.centerPoint.y).toBe(6)

    const ucs = db.tables.ucsTable.getAt('MyUcs')
    expect(ucs).toBeInstanceOf(AcDbUcsTableRecord)
    expect(ucs?.origin.x).toBe(1)
    expect(ucs?.origin.y).toBe(2)
    expect(ucs?.origin.z).toBe(3)
    expect(ucs?.xAxis.x).toBe(1)
    expect(ucs?.yAxis.y).toBe(1)

    db.tables.appIdTable.add(new AcDbRegAppTableRecord('ROUNDTRIP'))
    const out = db.dxfOut(undefined, 16, 'AC1032') as string
    expect(out).toContain('APPID')
    expect(out).toContain('MYAPP')
    expect(out).toContain('ROUNDTRIP')
    expect(out).toContain('VIEW')
    expect(out).toContain('Front')
    expect(out).toContain('UCS')
    expect(out).toContain('MyUcs')
  })

  it('writes DIMSTYLE handles with group 105 and accepts 105 on read', () => {
    const db = createWorkingDb()
    const record = new AcDbDimStyleTableRecord({ name: 'Standard' })
    record.objectId = 'ABC'
    db.tables.dimStyleTable.add(record)

    const out = db.dxfOut(undefined, 16, 'AC1032') as string
    expect(out).toMatch(/\n105\nABC\n/)
    expect(out).not.toMatch(/\n0\nDIMSTYLE\n5\nABC\n/)

    const snippet = [
      '0',
      'DIMSTYLE',
      '105',
      'DEF',
      '100',
      'AcDbSymbolTableRecord',
      '100',
      'AcDbDimStyleTableRecord',
      '2',
      'Alt',
      '70',
      '0'
    ].join('\n')
    const filer = AcDbDxfFiler.fromString(snippet, { database: db })
    // DocumentReader / table walkers consume (0, DIMSTYLE) before dxfIn.
    expect(filer.readItem()?.value).toBe('DIMSTYLE')
    const readRecord = new AcDbDimStyleTableRecord()
    readRecord.dxfIn(filer)
    expect(readRecord.objectId).toBe('DEF')
    expect(readRecord.name).toBe('Alt')
  })

  it('creates AcDbArcDimension from subclass marker 100', () => {
    createWorkingDb()
    const pairs = [
      '0',
      'DIMENSION',
      '5',
      '1',
      '100',
      'AcDbEntity',
      '8',
      '0',
      '100',
      'AcDbDimension',
      '10',
      '0',
      '20',
      '0',
      '30',
      '0',
      '70',
      '8',
      '100',
      'AcDbArcDimension',
      '13',
      '1',
      '23',
      '0',
      '33',
      '0',
      '14',
      '0',
      '24',
      '1',
      '34',
      '0',
      '15',
      '0',
      '25',
      '0',
      '35',
      '0',
      '16',
      '0.7',
      '26',
      '0.7',
      '36',
      '0'
    ].join('\n')

    const filer = AcDbDxfFiler.fromString(pairs)
    // Consume (0, DIMENSION) like the entity factory does.
    filer.readItem()
    const entity = acdbDxfInDimension(filer)
    expect(entity).toBeInstanceOf(AcDbArcDimension)
    const arc = entity as AcDbArcDimension
    expect(arc.xLine1Point.x).toBe(1)
    expect(arc.xLine2Point.y).toBe(1)
    expect(arc.arcPoint.x).toBeCloseTo(0.7)
  })

  it('auto-detects R12 vs modern binary DXF group-code layout', () => {
    const magic = 'AutoCAD Binary DXF\r\n\x1a\0'

    const modern = new Uint8Array(22 + 3)
    for (let i = 0; i < 22; i++) modern[i] = magic.charCodeAt(i)
    modern[22] = 0
    modern[23] = 0
    modern[24] = 0x53 // 'S'
    expect(acdbIsBinaryDxf(modern)).toBe(true)
    const modernReader = acdbCreateDxfPairReader(modern)
    expect(modernReader.kind).toBe('binary')

    const r12 = new Uint8Array(22 + 2)
    for (let i = 0; i < 22; i++) r12[i] = magic.charCodeAt(i)
    r12[22] = 0
    r12[23] = 0x53 // 'S'
    const r12Reader = acdbCreateDxfPairReader(r12)
    expect(r12Reader.kind).toBe('binary')

    // Forced legacy flag still honored when provided.
    const forced = acdbCreateDxfPairReader(modern, { legacyR12: true })
    expect(forced.kind).toBe('binary')
  })

  it('ASCII out → binary out → native read preserves LINE geometry', async () => {
    const db = createWorkingDb()
    const line = new AcDbLine(
      new AcGePoint3d(1, 2, 0),
      new AcGePoint3d(10, 20, 0)
    )
    line.layer = '0'
    db.tables.blockTable.modelSpace.appendEntity(line)

    const ascii = db.dxfOut(undefined, 16, 'AC1032') as string
    expect(typeof ascii).toBe('string')
    expect(ascii).toContain('LINE')

    const binary = db.dxfOut(undefined, 16, 'AC1032', {
      format: 'binary'
    }) as Uint8Array
    expect(binary).toBeInstanceOf(Uint8Array)
    expect(acdbIsBinaryDxf(binary)).toBe(true)

    const db2 = createWorkingDb()
    const filer = AcDbDxfFiler.fromBuffer(binary, { database: db2 })
    await new AcDbDxfDocumentReader(db2).read(filer)

    const entities = [...db2.tables.blockTable.modelSpace.newIterator()]
    expect(entities).toHaveLength(1)
    expect(entities[0]).toBeInstanceOf(AcDbLine)
    const loaded = entities[0] as AcDbLine
    expect(loaded.startPoint.x).toBe(1)
    expect(loaded.startPoint.y).toBe(2)
    expect(loaded.endPoint.x).toBe(10)
    expect(loaded.endPoint.y).toBe(20)
  })

  it('round-trips XDATA and THUMBNAILIMAGE', async () => {
    const db = createWorkingDb()
    db.createDefaultData()
    const line = new AcDbLine(
      new AcGePoint3d(0, 0, 0),
      new AcGePoint3d(5, 5, 0)
    )
    line.layer = '0'
    line.setXData(
      new AcDbResultBuffer([
        { code: 1001, value: 'MYAPP' },
        { code: 1000, value: 'hello-xdata' }
      ])
    )
    db.tables.blockTable.modelSpace.appendEntity(line)
    db.thumbnailImage = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])

    const dxf = db.dxfOut(undefined, 16, 'AC1032', {
      saveThumbnailImage: true
    }) as string
    expect(dxf).toContain('1001\nMYAPP')
    expect(dxf).toContain('1000\nhello-xdata')
    expect(dxf).toContain('0\nSECTION\n2\nTHUMBNAILIMAGE')
    expect(dxf).toContain('\n90\n6\n')
    expect(dxf).toContain('\n310\n')

    const db2 = createWorkingDb()
    await new AcDbDxfDocumentReader(db2).read(
      AcDbDxfFiler.fromString(dxf, { database: db2 })
    )
    const loaded = [...db2.tables.blockTable.modelSpace.newIterator()][0] as AcDbLine
    expect(loaded.getXData('MYAPP')?.toArray()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 1001, value: 'MYAPP' }),
        expect.objectContaining({ code: 1000, value: 'hello-xdata' })
      ])
    )
    expect(db2.thumbnailImage).toBeDefined()
    expect(Array.from(db2.thumbnailImage!)).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a
    ])
  })

  it('reads GROUP and SORTENTSTABLE into object dictionaries', async () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'OBJECTS',
      '0',
      'GROUP',
      '5',
      'G1',
      '100',
      'AcDbGroup',
      '300',
      'MyGroup',
      '70',
      '0',
      '71',
      '1',
      '340',
      'E1',
      '340',
      'E2',
      '0',
      'SORTENTSTABLE',
      '5',
      'S1',
      '100',
      'AcDbSortentsTable',
      '331',
      'E2',
      '331',
      'E1',
      '0',
      'ENDSEC',
      '0',
      'EOF'
    ].join('\n')

    const db = createWorkingDb()
    await new AcDbDxfDocumentReader(db).read(
      AcDbDxfFiler.fromString(dxf, { database: db })
    )

    const group = db.objects.group.getAt('MyGroup')
    expect(group).toBeInstanceOf(AcDbGroup)
    expect(group?.entityIds).toEqual(['E1', 'E2'])

    const sortents = db.objects.sortentsTable.getAt('S1')
    expect(sortents).toBeInstanceOf(AcDbSortentsTable)
    expect(sortents?.entityIds).toEqual(['E2', 'E1'])
  })

  it('reads LAYER records that include ACAD_XDICTIONARY control strings', () => {
    const snippet = [
      '0',
      'LAYER',
      '5',
      '10',
      '102',
      '{ACAD_XDICTIONARY',
      '360',
      '3D03',
      '102',
      '}',
      '330',
      '2',
      '100',
      'AcDbSymbolTableRecord',
      '100',
      'AcDbLayerTableRecord',
      '2',
      '1轮廓实线层',
      '70',
      '0',
      '62',
      '7',
      '6',
      'Continuous',
      '370',
      '-3',
      '390',
      'F',
      '347',
      'EF',
      '0',
      'ENDTAB'
    ].join('\n')
    const db = createWorkingDb()
    const filer = AcDbDxfFiler.fromString(snippet, { database: db })
    expect(filer.readItem()?.value).toBe('LAYER')
    const layer = new AcDbLayerTableRecord()
    layer.dxfIn(filer)
    expect(layer.objectId).toBe('10')
    expect(layer.ownerId).toBe('2')
    expect(layer.extensionDictionary).toBe('3D03')
    expect(layer.name).toBe('1轮廓实线层')
  })

  it('reads entity fields after ACAD_REACTORS control strings', () => {
    const snippet = [
      '0',
      'LINE',
      '5',
      '6EA',
      '102',
      '{ACAD_REACTORS',
      '330',
      '9A4',
      '102',
      '}',
      '330',
      '1F',
      '100',
      'AcDbEntity',
      '8',
      '3中心线层',
      '100',
      'AcDbLine',
      '10',
      '0',
      '20',
      '0',
      '30',
      '0',
      '11',
      '1',
      '21',
      '0',
      '31',
      '0',
      '0',
      'SEQEND'
    ].join('\n')
    const db = createWorkingDb()
    // LibreDWG dwg2dxf often writes $CECOLOR 0 (ByBlock) while omitting
    // group 62 on ByLayer entities. Import must not copy CECOLOR.
    db.cecolor.colorIndex = 0
    const filer = AcDbDxfFiler.fromString(snippet, { database: db })
    expect(filer.readItem()?.value).toBe('LINE')
    const line = new AcDbLine(new AcGePoint3d(), new AcGePoint3d(1, 0, 0))
    line.dxfIn(filer)
    expect(line.objectId).toBe('6EA')
    expect(line.ownerId).toBe('1F')
    expect(line.layer).toBe('3中心线层')
    expect(line.color.isByLayer).toBe(true)
    expect(line.color.colorIndex).toBe(256)
    line.resolveEffectiveProperties()
    expect(line.color.isByLayer).toBe(true)
    expect(line.color.colorIndex).toBe(256)
  })

  it('reads $CLAYER from HEADER', async () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$ACADVER',
      '1',
      'AC1032',
      '9',
      '$CLAYER',
      '8',
      'Walls',
      '0',
      'ENDSEC',
      '0',
      'EOF'
    ].join('\n')
    const db = createWorkingDb()
    await new AcDbDxfDocumentReader(db).read(
      AcDbDxfFiler.fromString(dxf, { database: db })
    )
    expect(db.clayer).toBe('Walls')
  })

  it('round-trips $DIMSTYLE header variable', async () => {
    const db = createWorkingDb()
    db.createDefaultData()
    db.dimstyle = 'Standard'

    const dxf = db.dxfOut(undefined, 16, 'AC1032') as string
    expect(dxf).toMatch(/\$DIMSTYLE\n2\nStandard\n/)

    const db2 = createWorkingDb()
    await new AcDbDxfDocumentReader(db2).read(
      AcDbDxfFiler.fromString(
        [
          '0',
          'SECTION',
          '2',
          'HEADER',
          '9',
          '$ACADVER',
          '1',
          'AC1032',
          '9',
          '$DIMSTYLE',
          '2',
          'AltDim',
          '0',
          'ENDSEC',
          '0',
          'EOF'
        ].join('\n'),
        { database: db2 }
      )
    )
    expect(db2.dimstyle).toBe('AltDim')
  })

  it('reads in-range DWG Compare HEADER values and ignores out-of-range or exported names', async () => {
    const db = createWorkingDb()
    db.createDefaultData()
    db.comparehatch = 1
    db.comparercmargin = 12
    db.comparetext = 0
    db.comparetolerance = 4

    const dxf = db.dxfOut(undefined, 16, 'AC1032') as string
    expect(dxf).not.toMatch(/\$COMPAREHATCH/)
    expect(dxf).not.toMatch(/\$COMPARERCMARGIN/)
    expect(dxf).not.toMatch(/\$COMPARETEXT/)
    expect(dxf).not.toMatch(/\$COMPARETOLERANCE/)

    const db2 = createWorkingDb()
    await new AcDbDxfDocumentReader(db2).read(
      AcDbDxfFiler.fromString(
        [
          '0',
          'SECTION',
          '2',
          'HEADER',
          '9',
          '$ACADVER',
          '1',
          'AC1032',
          '9',
          '$COMPAREHATCH',
          '70',
          '1',
          '9',
          '$COMPARERCMARGIN',
          '70',
          '8',
          '9',
          '$COMPARETEXT',
          '70',
          '0',
          '9',
          '$COMPARETOLERANCE',
          '70',
          '10',
          '0',
          'ENDSEC',
          '0',
          'EOF'
        ].join('\n'),
        { database: db2 }
      )
    )
    expect(db2.comparehatch).toBe(1)
    expect(db2.comparercmargin).toBe(8)
    expect(db2.comparetext).toBe(0)
    expect(db2.comparetolerance).toBe(10)

    const db3 = createWorkingDb()
    await new AcDbDxfDocumentReader(db3).read(
      AcDbDxfFiler.fromString(
        [
          '0',
          'SECTION',
          '2',
          'HEADER',
          '9',
          '$ACADVER',
          '1',
          'AC1032',
          '9',
          '$COMPAREHATCH',
          '70',
          '2',
          '9',
          '$COMPARERCMARGIN',
          '70',
          '0',
          '9',
          '$COMPARETEXT',
          '70',
          '-1',
          '9',
          '$COMPARETOLERANCE',
          '70',
          '15',
          '0',
          'ENDSEC',
          '0',
          'EOF'
        ].join('\n'),
        { database: db3 }
      )
    )
    expect(db3.comparehatch).toBe(0)
    expect(db3.comparercmargin).toBe(5)
    expect(db3.comparetext).toBe(1)
    expect(db3.comparetolerance).toBe(6)
  })
})

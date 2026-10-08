import { AcCmColor, AcCmTransparency } from '@mlightcad/common'
import { AcGePoint2d, AcGePoint3d } from '@mlightcad/geometry-engine'
import { AcGiLineWeight } from '@mlightcad/graphic-interface'

import { acdbHostApplicationServices } from '../src/base'
import { AcDbDxfFiler } from '../src/base/AcDbDxfFiler'
import { AcDbViewportTableRecord } from '../src/database/AcDbViewportTableRecord'
import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbLine } from '../src/entity/AcDbLine'
import { AcDbPolyline } from '../src/entity/AcDbPolyline'

function createDbWithStyledLine() {
  const db = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = db
  db.createDefaultData()
  const line = new AcDbLine(new AcGePoint3d(0, 0, 0), new AcGePoint3d(10, 0, 0))
  line.layer = '0'
  const color = new AcCmColor()
  color.setRGB(255, 0, 0)
  line.color = color
  line.lineWeight = AcGiLineWeight.LineWeight050
  line.transparency = new AcCmTransparency(128)
  db.tables.blockTable.modelSpace.appendEntity(line)
  return db
}

describe('AcDbDxf version write dialect', () => {
  it.each(['ascii', 'binary'] as const)(
    'exports a HANDSEED above every allocated handle (%s)',
    format => {
      const db = createDbWithStyledLine()
      const out = db.dxfOut(undefined, 6, 'AC1015', { format })
      const input =
        typeof out === 'string' ? new TextEncoder().encode(out) : out
      const reader = AcDbDxfFiler.fromBuffer(input)
      let seed = BigInt(0),
        max = BigInt(0),
        isSeed = false
      while (!reader.atEof) {
        const pair = reader.readItem()!
        if (pair.code === 9) isSeed = pair.value === '$HANDSEED'
        else if (pair.code === 5 || Number(pair.code) === 105) {
          const value = BigInt('0x' + String(pair.value))
          if (isSeed) {
            seed = value
            isSeed = false
          } else if (value > max) max = value
        }
      }
      expect(seed > max).toBe(true)
    }
  )

  it('writes legacy viewport fields without post-2000 display settings', () => {
    const viewport = new AcDbViewportTableRecord()
    viewport.gsView.viewMode = 3
    viewport.circleSides = 100
    const legacy = new AcDbDxfFiler({ version: 'AC1015' })
    viewport.dxfOutFields(legacy)
    const text = legacy.toString()
    expect(text).toContain('\n40\n')
    expect(text).not.toContain('\n45\n')
    expect(text).not.toContain('\n170\n')
    expect(text).not.toContain('\n282\n')
    expect(text).toContain('\n71\n3\n')
    expect(text).toContain('\n72\n100\n')
  })

  it('does not write empty EXTMIN/EXTMAX header variables for an unbounded database', () => {
    const db = new AcDbDatabase()
    db.createDefaultData()
    const text = db.dxfOut(undefined, 6, 'AC1015') as string
    expect(text).not.toContain('$EXTMIN')
    expect(text).not.toContain('$EXTMAX')
    expect(text).not.toContain('$CMLEADERSTYLE')
    expect(text).not.toContain('$HPLAYER')
  })

  it('omits post-version entity fields for AC1015', () => {
    const db = createDbWithStyledLine()
    const dxf = db.dxfOut(undefined, 6, 'AC1015') as string
    expect(dxf).toContain('$ACADVER\n1\nAC1015')
    expect(dxf).not.toContain('\n420\n')
    expect(dxf).not.toContain('\n440\n')
    expect(dxf).not.toContain('$DWGCODEPAGE')
    // AC1015 still has lineweight
    expect(dxf).toContain('\n370\n')
  })

  it('emits true color / transparency for AC1018+', () => {
    const db = createDbWithStyledLine()
    const dxf = db.dxfOut(undefined, 6, 'AC1018') as string
    expect(dxf).toContain('\n420\n')
    expect(dxf).toContain('\n440\n')
    expect(dxf).not.toContain('$DWGCODEPAGE')
  })

  it('emits $DWGCODEPAGE for AC1021+', () => {
    const db = createDbWithStyledLine()
    const dxf = db.dxfOut(undefined, 6, 'AC1021') as string
    expect(dxf).toContain('$DWGCODEPAGE\n3\nUTF-8')
  })

  it('skips subclass markers and BLOCK_RECORD for AC1009', () => {
    const db = createDbWithStyledLine()
    const dxf = db.dxfOut(undefined, 6, 'AC1009') as string
    // Avoid matching numeric values like VPORT circle-zoom `71\n100`.
    expect(dxf).not.toMatch(/\n100\nAcDb/)
    expect(dxf).not.toContain('BLOCK_RECORD')
    expect(dxf).not.toContain('0\nSECTION\n2\nCLASSES')
    expect(dxf).not.toContain('0\nSECTION\n2\nOBJECTS')
  })

  it('writeSubclassMarker is a no-op without subclass capability', () => {
    const filer = new AcDbDxfFiler({ version: 'AC1009' })
    filer.writeSubclassMarker('AcDbLine')
    expect(filer.toString()).toBe('\n')
  })

  it('downgrades LWPOLYLINE to POLYLINE+VERTEX for AC1009', () => {
    const db = new AcDbDatabase()
    acdbHostApplicationServices().workingDatabase = db
    db.createDefaultData()
    const pl = new AcDbPolyline()
    pl.addVertexAt(0, new AcGePoint2d(0, 0))
    pl.addVertexAt(1, new AcGePoint2d(1, 0))
    pl.addVertexAt(2, new AcGePoint2d(1, 1))
    pl.closed = true
    db.tables.blockTable.modelSpace.appendEntity(pl)

    const dxf = db.dxfOut(undefined, 6, 'AC1009') as string
    expect(dxf).toContain('0\nPOLYLINE\n')
    expect(dxf).toContain('0\nVERTEX\n')
    expect(dxf).toContain('0\nSEQEND\n')
    expect(dxf).not.toContain('0\nLWPOLYLINE\n')
  })
})

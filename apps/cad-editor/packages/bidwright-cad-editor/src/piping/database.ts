import {
  AcDbCircle,
  AcDbDxfCode,
  AcDbEntity,
  AcDbLayerTableRecord,
  AcDbLine,
  AcDbMText,
  AcDbResultBuffer,
  AcDbXrecord,
  type AcDbDatabase
} from '@mlightcad/data-model'
import {
  AcApDocManager,
  acapRunDatabaseEdit
} from '@mlightcad/cad-simple-viewer'
import { type IsoDocument, parseIsoJson } from './model'
import { createDrawing } from './drawing'
const KEY = 'BIDWRIGHT_PIPING_V1'
const PREFIX = 'BW-ISO-'
export function readPiping(db: AcDbDatabase): IsoDocument | null {
  const record = db.objects.xrecord.getAt(KEY)
  if (!record?.data) return null
  const raw = [...record.data]
    .filter(v => v.code === AcDbDxfCode.Text)
    .map(v => String(v.value))
    .join('')
  return parseIsoJson(decodeURIComponent(raw))
}
/** Geometry and semantic metadata commit atomically in the drawing's undo history. */
export function writePiping(doc: IsoDocument): void {
  const manager = AcApDocManager.instance,
    db = manager.curDocument.database
  const drawing = createDrawing(doc)
  acapRunDatabaseEdit(db, 'Edit piping isometric', () => {
    for (const layer of db.tables.layerTable.newIterator())
      if (layer.name.startsWith(PREFIX))
        db.openObjectForWrite(layer.objectId) && (layer.isLocked = false)
    for (const entity of [...db.tables.blockTable.modelSpace.newIterator()])
      if (entity.layer.startsWith(PREFIX)) {
        db.openEntityForWrite(entity)?.erase()
      }
    for (const p of drawing.primitives) {
      const layerName = PREFIX + p.layer
      if (!db.tables.layerTable.has(layerName)) {
        const layer = new AcDbLayerTableRecord({ name: layerName })
        db.tables.layerTable.add(layer)
      }
      let entity: AcDbEntity
      if (p.type === 'line')
        entity = new AcDbLine(
          { x: p.a[0], y: -p.a[1], z: 0 },
          { x: p.b[0], y: -p.b[1], z: 0 }
        )
      else if (p.type === 'circle')
        entity = new AcDbCircle({ x: p.p[0], y: -p.p[1], z: 0 }, p.r)
      else {
        const t = new AcDbMText()
        t.location = { x: p.p[0], y: -p.p[1] + p.size, z: 0 }
        t.height = p.size
        t.width = Math.max(1, p.text.length * p.size)
        t.contents = p.text.replace(/\\/g, '\\\\').replace(/[{}]/g, '')
        entity = t
      }
      entity.layer = layerName
      db.tables.blockTable.modelSpace.appendEntity(entity)
    }
    const encoded = encodeURIComponent(JSON.stringify(doc))
    const record = new AcDbXrecord()
    record.data = new AcDbResultBuffer(
      Array.from({ length: Math.ceil(encoded.length / 240) }, (_, i) => ({
        code: AcDbDxfCode.Text,
        value: encoded.slice(i * 240, i * 240 + 240)
      }))
    )
    db.objects.xrecord.setAt(KEY, record)
    for (const layer of db.tables.layerTable.newIterator())
      if (layer.name.startsWith(PREFIX)) {
        db.openObjectForWrite(layer.objectId)
        layer.isLocked = true
      }
  })
}

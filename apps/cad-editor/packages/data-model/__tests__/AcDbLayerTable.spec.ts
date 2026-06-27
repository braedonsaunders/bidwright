import { AcDbDatabase } from '../src/database/AcDbDatabase'
import { AcDbLayerTable } from '../src/database/AcDbLayerTable'
import { AcDbLayerTableRecord } from '../src/database/AcDbLayerTableRecord'
import { expectDetachedClone } from '../test-utils/cloneTestUtils'

describe('AcDbLayerTable', () => {
  it('creates a detached clone with a new objectId', () => {
    expectDetachedClone(() => new AcDbLayerTable(new AcDbDatabase()))
  })

  it('dispatches layerAppended and supports inherited table operations', () => {
    const db = new AcDbDatabase()
    const table = db.tables.layerTable
    const appended: string[] = []
    db.events.layerAppended.addEventListener(evt =>
      appended.push(evt.layer.name)
    )

    const layer = new AcDbLayerTableRecord({ name: 'Layer-A' })
    table.add(layer)

    expect(appended).toEqual(['Layer-A'])
    expect(table.has('Layer-A')).toBe(true)
    expect(table.getIdAt(layer.objectId)).toBe(layer)
    expect(table.removeId(layer.objectId)).toBe(true)
    expect(table.remove('Layer-A')).toBe(false)
  })
})

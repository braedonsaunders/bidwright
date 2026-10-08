import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject, type AcDbObjectId } from '../base/AcDbObject'

/**
 * Nongraphical SORTENTSTABLE object (draw-order soft-pointers).
 */
export class AcDbSortentsTable extends AcDbObject {
  private _entityIds: AcDbObjectId[] = []

  get entityIds(): readonly AcDbObjectId[] {
    return this._entityIds
  }
  set entityIds(value: readonly AcDbObjectId[]) {
    this._entityIds = [...value]
  }

  addEntityId(id: AcDbObjectId) {
    this._entityIds.push(id)
  }

  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbSortentsTable')
    for (const id of this._entityIds) {
      filer.writeObjectId(331, id)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbSortentsTable')
    this._entityIds = []

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      if (code === 100) {
        filer.pushBackItem(item)
        break
      }
      switch (code) {
        case 331:
          this._entityIds.push(String(item.value))
          break
        default:
          // Tolerate unknown SORTENTSTABLE fields (e.g. paired handles).
          break
      }
    }
    return this
  }
}

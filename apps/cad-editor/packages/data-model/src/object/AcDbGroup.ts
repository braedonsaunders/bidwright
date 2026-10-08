import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject, type AcDbObjectId } from '../base/AcDbObject'

/**
 * Nongraphical GROUP object (DXF GROUP).
 *
 * Minimal fields: name, unnamed/selectable flags, and soft-pointers to
 * member entity handles.
 */
export class AcDbGroup extends AcDbObject {
  private _name = ''
  private _unnamed = false
  private _selectable = true
  private _entityIds: AcDbObjectId[] = []

  get name() {
    return this._name
  }
  set name(value: string) {
    this._name = value
  }

  get unnamed() {
    return this._unnamed
  }
  set unnamed(value: boolean) {
    this._unnamed = value
  }

  get selectable() {
    return this._selectable
  }
  set selectable(value: boolean) {
    this._selectable = value
  }

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
    filer.writeSubclassMarker('AcDbGroup')
    if (this.name) {
      filer.writeString(300, this.name)
    }
    filer.writeInt16(70, this.unnamed ? 1 : 0)
    filer.writeInt16(71, this.selectable ? 1 : 0)
    for (const id of this._entityIds) {
      filer.writeObjectId(340, id)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbGroup')
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
        case 300:
          this._name = String(item.value)
          break
        case 70:
          this._unnamed = Number(item.value) !== 0
          break
        case 71:
          this._selectable = Number(item.value) !== 0
          break
        case 340:
          this._entityIds.push(String(item.value))
          break
        default:
          break
      }
    }
    return this
  }
}

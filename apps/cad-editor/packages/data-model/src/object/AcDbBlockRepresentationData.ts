import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject, AcDbObjectId } from '../base/AcDbObject'

/**
 * DWG/DXF-resident object (`ACDB_BLOCKREPRESENTATION_DATA`) that stores a soft
 * pointer (group code 340) from an evaluated dynamic-block INSERT back to its
 * original dynamic {@link AcDbBlockTableRecord}.
 *
 * This is **not** a public ObjectARX API class. AutoCAD keeps it as an
 * undocumented database object under the INSERT extension dictionary
 * (`AcDbBlockRepresentation` → `AcDbRepData`). Application code should use
 * {@link AcDbDynBlockReference.dynamicBlockTableRecord} instead.
 *
 * Kept only so converters can materialize the object graph and
 * {@link AcDbDynBlockReference} can resolve the definition handle.
 *
 * @internal
 */
export class AcDbBlockRepresentationData extends AcDbObject {
  private _blockId: AcDbObjectId = ''

  /**
   * Object id of the original dynamic block table record.
   */
  get blockId(): AcDbObjectId {
    return this._blockId
  }
  set blockId(value: AcDbObjectId) {
    this._blockId = value ?? ''
  }

  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeObjectId(340, this._blockId)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbBlockRepresentationData')

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      if (code === 100) {
        filer.pushBackItem(item)
        break
      }
      if (code === 340) {
        this._blockId = String(item.value ?? '')
      }
    }
    return this
  }
}

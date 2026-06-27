import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  AcDbSymbolTableRecord,
  AcDbSymbolTableRecordAttrs
} from './AcDbSymbolTableRecord'

/**
 * Interface defining the attributes for registered application table records.
 */
export type AcDbRegAppTableRecordAttrs = AcDbSymbolTableRecordAttrs

/**
 * Represents records in the AcDbRegAppTable (known as the APPID symbol table in AutoCAD and DXF).
 * Each of these records represents an application ID used to identify a group of Extended Entity
 * Data attached to objects in the drawing database.
 */
export class AcDbRegAppTableRecord extends AcDbSymbolTableRecord<AcDbRegAppTableRecordAttrs> {
  /**
   * Creates a new AcDbRegAppTableRecord instance.
   *
   * @param attrs - Input attribute values, or the application name as a string
   */
  constructor(attrs?: Partial<AcDbRegAppTableRecordAttrs> | string) {
    if (typeof attrs === 'string') {
      attrs = { name: attrs }
    }
    super(attrs)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbRegAppTableRecord')
    filer.writeString(2, this.name)
    filer.writeInt16(70, 0)
    return this
  }
}
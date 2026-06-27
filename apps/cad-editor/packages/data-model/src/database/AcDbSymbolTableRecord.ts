import { AcCmStringKey, defaults } from '@mlightcad/common'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject, AcDbObjectAttrs } from '../base/AcDbObject'

/**
 * Interface defining the attributes for symbol table records.
 *
 * Extends the base AcDbObjectAttrs interface and adds a name property
 * that is required for all symbol table records.
 */
export interface AcDbSymbolTableRecordAttrs extends AcDbObjectAttrs {
  /** The name of the symbol table record */
  name: string
}

/**
 * Base class for all symbol table records.
 *
 * This class provides the fundamental functionality for all symbol table records,
 * including name management and common attributes. Symbol table records represent
 * entries in various symbol tables such as layer tables, linetype tables, text
 * style tables, etc.
 *
 * @template ATTRS - The type of attributes this symbol table record can have
 *
 * @example
 * ```typescript
 * class MySymbolTableRecord extends AcDbSymbolTableRecord<MySymbolTableRecordAttrs> {
 *   constructor(attrs?: Partial<MySymbolTableRecordAttrs>) {
 *     super(attrs);
 *   }
 * }
 * ```
 */
export class AcDbSymbolTableRecord<
  ATTRS extends AcDbSymbolTableRecordAttrs = AcDbSymbolTableRecordAttrs
> extends AcDbObject<ATTRS> {
  /**
   * Creates a new AcDbSymbolTableRecord instance.
   *
   * @param attrs - Input attribute values for this symbol table record
   * @param defaultAttrs - Default values for attributes of this symbol table record
   *
   * @example
   * ```typescript
   * const record = new AcDbSymbolTableRecord({ name: 'MyRecord' });
   * ```
   */
  constructor(attrs?: Partial<ATTRS>, defaultAttrs?: Partial<ATTRS>) {
    attrs = attrs || {}
    defaults(attrs, { name: '' })
    super(attrs, defaultAttrs)
  }

  /**
   * Gets or sets the name of the symbol table record.
   *
   * This property corresponds to DXF group code 2 and is used for
   * identifying and referencing the symbol table record.
   *
   * @returns The name of the symbol table record
   *
   * @example
   * ```typescript
   * const recordName = record.name;
   * record.name = 'NewRecordName';
   * ```
   */
  get name(): string {
    return this.getAttr('name')
  }
  set name(value: string) {
    this.setAttr('name', value)
  }

  /**
   * Sets an attribute after verifying the record is open for write.
   *
   * Symbol table records follow ObjectARX semantics: existing database records
   * must be opened with {@link AcDbDatabase.openObjectForWrite} before mutation.
   */
  override setAttr<A extends AcCmStringKey<ATTRS>>(attrName: A, val?: ATTRS[A]) {
    this.assertOpenForWrite()
    super.setAttr(attrName, val)
  }

  /**
   * Ensures this record may be modified.
   *
   * Temporary records and undo/redo replay are exempt from the open-for-write check.
   *
   * @throws Error when an existing record is modified without being opened for write
   */
  protected assertOpenForWrite(): void {
    if (this.isTemp) {
      return
    }

    const db = this.database
    if (!db) {
      return
    }

    const manager = db.transactionManager
    if (manager.isApplyingUndoRedo()) {
      return
    }

    if (
      manager.strictMode &&
      !manager.isRecording()
    ) {
      throw new Error(
        'Cannot modify symbol table records outside an active transaction.'
      )
    }

    if (!manager.isRecording()) {
      return
    }

    if (!manager.isOpenedForWriteInTransaction(this.objectId)) {
      throw new Error(
        `Symbol table record "${this.name || this.objectId}" is not open for write. Use openObjectForWrite().`
      )
    }
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbSymbolTableRecord')
    return this
  }
}

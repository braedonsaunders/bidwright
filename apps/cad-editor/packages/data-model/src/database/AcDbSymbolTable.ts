import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject, AcDbObjectId } from '../base/AcDbObject'
import { AcDbObjectIterator } from '../misc/AcDbObjectIterator'
import { AcDbDatabase } from './AcDbDatabase'
import { AcDbSymbolTableRecord } from './AcDbSymbolTableRecord'

/**
 * Base class for all symbol tables in AutoCAD.
 *
 * AcDbSymbolTable is the base class for all classes used to manage AutoCAD's
 * built-in symbol tables. Symbol tables organize and store various types of
 * records such as layers, linetypes, text styles, dimension styles, etc.
 *
 * @template RecordType - The type of records this symbol table manages
 *
 * @example
 * ```typescript
 * class MySymbolTable extends AcDbSymbolTable<MySymbolTableRecord> {
 *   constructor(db: AcDbDatabase) {
 *     super(db);
 *   }
 * }
 * ```
 */
export class AcDbSymbolTable<
  RecordType extends AcDbSymbolTableRecord = AcDbSymbolTableRecord
> extends AcDbObject {
  /** Map of records indexed by name */
  protected _recordsByName: Map<string, RecordType>
  /** Map of records indexed by object ID */
  protected _recordsById: Map<string, RecordType>

  /**
   * Creates a new AcDbSymbolTable instance.
   *
   * @param db - The database this symbol table belongs to
   *
   * @example
   * ```typescript
   * const symbolTable = new AcDbSymbolTable(database);
   * ```
   */
  constructor(db: AcDbDatabase) {
    super()
    this.database = db
    this.objectId = db.generateHandle()
    // Symbol tables are owned by the database object (handle "0").
    this.ownerId = db.objectId
    this._recordsByName = new Map<string, RecordType>()
    this._recordsById = new Map<string, RecordType>()
  }

  /**
   * Gets the number of entries in the table.
   *
   * @returns The number of entries in the table
   */
  get numEntries() {
    return this._recordsByName.size
  }

  /**
   * Adds a record to both the database containing the table and the table itself.
   *
   * @param record - The record to add to the table
   *
   * @example
   * ```typescript
   * const record = new AcDbSymbolTableRecord({ name: 'MyRecord' });
   * symbolTable.add(record);
   * ```
   */
  add(record: RecordType) {
    const manager = this.database.transactionManager
    if (
      manager.strictMode &&
      !manager.isRecording() &&
      !manager.isApplyingUndoRedo()
    ) {
      throw new Error(
        'Cannot add symbol table records outside an active transaction.'
      )
    }

    const tableName = manager.resolveSymbolTableName(this)

    record.database = this.database
    record.ownerId = this.objectId

    this.database.commitObjectHandle(record, id => this.hasId(id))

    const normalizedName = this.normalizeName(record.name)
    if (normalizedName) {
      this._recordsByName.set(normalizedName, record)
    }
    this._recordsById.set(record.objectId, record)

    if (manager.isRecording()) {
      manager.recordAppend({ type: 'symbolTable', tableName }, record)
    }
  }

  /**
   * Removes the record with the specified name.
   *
   * @param name - The name of the record to remove
   * @returns True if the record was found and removed, false otherwise
   *
   * @example
   * ```typescript
   * const removed = symbolTable.remove('MyRecord');
   * if (removed) {
   *   console.log('Record removed successfully');
   * }
   * ```
   */
  remove(name: string) {
    const normalizedName = this.normalizeName(name)
    const record = this._recordsByName.get(normalizedName)
    if (record) {
      this.removeRecord(record)
      return true
    }
    return false
  }

  /**
   * Removes the record with the specified ID.
   *
   * @param id - The object ID of the record to remove
   * @returns True if the record was found and removed, false otherwise
   *
   * @example
   * ```typescript
   * const removed = symbolTable.removeId('some-object-id');
   * if (removed) {
   *   console.log('Record removed successfully');
   * }
   * ```
   */
  removeId(id: AcDbObjectId) {
    const record = this._recordsById.get(id)
    if (record) {
      this.removeRecord(record)
      return true
    }
    return false
  }

  /**
   * Removes one symbol table record from internal maps and records the change when needed.
   *
   * Shared by {@link remove} and {@link removeId}. Enforces strict-mode transaction
   * requirements before mutating table membership.
   *
   * @param record - Symbol table record to remove
   */
  private removeRecord(record: RecordType) {
    const manager = this.database.transactionManager
    if (
      manager.strictMode &&
      !manager.isRecording() &&
      !manager.isApplyingUndoRedo()
    ) {
      throw new Error(
        'Cannot remove symbol table records outside an active transaction.'
      )
    }

    if (manager.isRecording()) {
      const tableName = manager.resolveSymbolTableName(this)
      manager.recordRemove({ type: 'symbolTable', tableName }, record)
    }

    this._recordsByName.delete(this.normalizeName(record.name))
    this._recordsById.delete(record.objectId)
  }

  /**
   * Removes all records from the table.
   *
   * @example
   * ```typescript
   * symbolTable.removeAll();
   * console.log('All records removed');
   * ```
   */
  removeAll() {
    this._recordsByName.clear()
    this._recordsById.clear()
  }

  /**
   * Checks if the table contains a record with the specified name.
   *
   * @param name - The name to search for
   * @returns True if a record with the specified name exists, false otherwise
   *
   * @example
   * ```typescript
   * if (symbolTable.has('MyRecord')) {
   *   console.log('Record exists');
   * }
   * ```
   */
  has(name: string) {
    const normalizedName = this.normalizeName(name)
    return this._recordsByName.has(normalizedName)
  }

  /**
   * Checks if the table contains a record with the specified ID.
   *
   * @param id - The ID to search for
   * @returns True if a record with the specified ID exists, false otherwise
   *
   * @example
   * ```typescript
   * if (symbolTable.hasId('some-object-id')) {
   *   console.log('Record exists');
   * }
   * ```
   */
  hasId(id: string) {
    return this._recordsById.has(id)
  }

  /**
   * Searches the table for a record with the specified name.
   *
   * @param name - The name to search for
   * @returns The record with the specified name, or undefined if not found
   *
   * @example
   * ```typescript
   * const record = symbolTable.getAt('MyRecord');
   * if (record) {
   *   console.log('Found record:', record.name);
   * }
   * ```
   */
  getAt(name: string) {
    const normalizedName = this.normalizeName(name)
    return this._recordsByName.get(normalizedName)
  }

  /**
   * Searches the table for a record with the specified ID.
   *
   * @param id - The ID to search for
   * @returns The record with the specified ID, or undefined if not found
   *
   * @example
   * ```typescript
   * const record = symbolTable.getIdAt('some-object-id');
   * if (record) {
   *   console.log('Found record:', record.name);
   * }
   * ```
   */
  getIdAt(id: AcDbObjectId) {
    return this._recordsById.get(id)
  }

  /**
   * Gets the owner ID of a record with the specified ID.
   *
   * @param id - The ID to search for
   * @returns The record with the specified ID, or undefined if not found
   *
   * @example
   * ```typescript
   * const record = symbolTable.getOwnerIdAt('some-object-id');
   * if (record) {
   *   console.log('Owner ID:', record.ownerId);
   * }
   * ```
   */
  getOwnerIdAt(id: AcDbObjectId): RecordType | undefined {
    return this._recordsById.get(id)
  }

  /**
   * Creates an iterator object that can be used to iterate over the records in the table.
   *
   * @param iterateById - When true, iterate all records by object id (includes unnamed entries).
   *   When false (default), iterate named records only.
   * @returns An iterator object that can be used to iterate over the records
   *
   * @example
   * ```typescript
   * const iterator = symbolTable.newIterator();
   * for (const record of iterator) {
   *   console.log('Record:', record.name);
   * }
   * ```
   */
  newIterator(iterateById = false): AcDbObjectIterator<RecordType> {
    return new AcDbObjectIterator(
      iterateById ? this._recordsById : this._recordsByName
    )
  }

  /**
   * Normalizes the name of a symbol table record.
   *
   * Some symbol table records require name normalization. For example, the
   * model space block table record may appear as either `*Model_Space` or
   * `*MODEL_SPACE`, and should be standardized to a consistent form.
   *
   * Subclasses should override this method to implement record-specific
   * normalization rules.
   *
   * @param name - The raw name of the symbol table record.
   * @returns The normalized symbol table record name.
   */
  protected normalizeName(name: string) {
    return name
  }

  /**
   * Entry count written to DXF group code 70 for this symbol table.
   *
   * Defaults to {@link numEntries}. Subclasses may override when unnamed records
   * are stored only in {@link _recordsById}.
   */
  protected get dxfEntryCount() {
    return this.numEntries
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbSymbolTable')
    // DXF common symbol table group code 70: maximum number of entries.
    // We emit the current count, which matches typical DXF output behavior.
    filer.writeInt16(70, this.dxfEntryCount)
    return this
  }
}

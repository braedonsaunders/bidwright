import { AcDbObject, AcDbObjectId } from '../../base'
import { AcDbDatabase } from '../AcDbDatabase'
import { AcDbTransaction } from './AcDbTransaction'

/**
 * Database-bound transaction with object lookup through {@link AcDbDatabase}.
 *
 * Created by {@link AcDbDatabaseTransactionManager.startTransaction} and
 * returned from {@link AcDbDatabaseTransactionManager.runUndoable}.
 */
export class AcDbDatabaseTransaction extends AcDbTransaction {
  /**
   * @param database - Database whose objects are opened and recorded
   */
  constructor(private readonly database: AcDbDatabase) {
    super()
  }

  /**
   * Resolves an object ID through the owning database.
   *
   * @param objectId - Identifier of the object to open
   * @param openErased - Reserved for erased-object support
   * @returns The matching live object
   * @throws Error when the object cannot be found
   */
  protected override lookupObject<T extends AcDbObject>(
    objectId: AcDbObjectId,
    openErased: boolean
  ): T {
    const obj = this.database.getObjectById(objectId, openErased)
    if (!obj) {
      throw new Error(`lookupObject(${objectId}) not found`)
    }
    return obj as T
  }
}

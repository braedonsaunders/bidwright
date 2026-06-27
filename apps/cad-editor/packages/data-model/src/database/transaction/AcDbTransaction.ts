import { AcDbObject, AcDbObjectId, AcDbOpenMode } from '../../base'
import { AcDbChangeRecorder } from './AcDbChangeRecorder'

/**
 * Represents a single database transaction.
 *
 * A transaction records the original state of opened objects so that
 * changes can be committed or rolled back.
 *
 * This class is normally not instantiated directly by users.
 */
export class AcDbTransaction {
  /** Objects opened in this transaction */
  private readonly openedObjects = new Map<AcDbObjectId, AcDbObject>()

  /** Snapshots of objects before modification */
  private readonly originalStates = new Map<AcDbObjectId, AcDbObject>()

  /** Structured changes recorded during this transaction for commit/undo integration */
  readonly recorder = new AcDbChangeRecorder()

  /**
   * Records an object opening.
   *
   * When the object is opened for write, a pre-modification snapshot is stored
   * for abort rollback and a modify entry is added to {@link recorder}.
   *
   * @param objectId - Object identifier
   * @param mode - Open mode
   * @param openErased - Whether erased objects are allowed
   * @returns The opened object, or the cached instance if already opened in this transaction
   */
  getObject<T extends AcDbObject>(
    objectId: AcDbObjectId,
    mode: AcDbOpenMode,
    openErased = false
  ): T | undefined {
    const opened = this.openedObjects.get(objectId)
    if (opened) {
      if (
        mode === AcDbOpenMode.kForWrite &&
        !this.originalStates.has(objectId)
      ) {
        const snapshot = opened.clonePreservingIdentity()
        this.originalStates.set(objectId, snapshot)
        this.recorder.recordModify(opened)
      }
      return opened as T
    }

    const obj = this.lookupObject<T>(objectId, openErased)
    this.openedObjects.set(objectId, obj)

    if (mode === AcDbOpenMode.kForWrite) {
      const snapshot = obj.clonePreservingIdentity()
      this.originalStates.set(obj.objectId, snapshot)
      this.recorder.recordModify(obj)
    }
    return obj
  }

  /**
   * Commits this transaction.
   * After commit, rollback data is discarded.
   */
  commit(): void {
    this.originalStates.clear()
    this.openedObjects.clear()
  }

  /**
   * Aborts this transaction and restores all modified objects.
   */
  abort(): void {
    for (const [id, snapshot] of this.originalStates) {
      const obj = this.openedObjects.get(id)
      if (obj) {
        obj.restoreFrom(snapshot)
      }
    }

    this.originalStates.clear()
    this.openedObjects.clear()
    this.recorder.clear()
  }

  /**
   * Internal object lookup hook.
   *
   * You should connect this to your database or object table.
   */
  protected lookupObject<T extends AcDbObject>(
    objectId: AcDbObjectId,
    _openErased: boolean
  ): T {
    throw new Error(`lookupObject(${objectId}) not implemented`)
  }
}

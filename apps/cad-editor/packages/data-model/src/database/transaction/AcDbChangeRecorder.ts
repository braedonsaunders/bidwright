import { AcDbObject } from '../../base'
import { AcDbDatabase } from '../AcDbDatabase'
import { AcDbSysVarManager } from '../AcDbSysVarManager'
import {
  AcDbChangeContainer,
  AcDbDatabaseChange,
  areChangeContainersEqual
} from './AcDbDatabaseChange'

/**
 * Accumulates structured database changes during an active transaction.
 *
 * Append/remove pairs that cancel within the same transaction are coalesced,
 * and duplicate modify/sysvar entries for the same target are ignored.
 */
export class AcDbChangeRecorder {
  private readonly changes: AcDbDatabaseChange[] = []

  /**
   * Returns the changes recorded so far in this transaction.
   *
   * The returned array is the internal store; callers should treat it as read-only.
   */
  getChanges(): AcDbDatabaseChange[] {
    return this.changes
  }

  /**
   * Discards all recorded changes without applying them.
   */
  clear(): void {
    this.changes.length = 0
  }

  /**
   * Merges changes from a nested transaction into this recorder.
   *
   * Used when an inner transaction commits into its parent without touching
   * the undo stack.
   *
   * @param other - Recorder from a child transaction being committed
   */
  mergeFrom(other: AcDbChangeRecorder): void {
    for (const change of other.getChanges()) {
      this.mergeChange(change)
    }
  }

  /**
   * Records the pre-modification snapshot of an opened-for-write object.
   *
   * Only the first modify entry per {@link AcDbObject.objectId} is kept.
   *
   * @param object - Object whose state should be restorable on abort/undo
   */
  recordModify(object: AcDbObject): void {
    const objectId = object.objectId
    const existing = this.changes.find(
      c => c.kind === 'modify' && c.objectId === objectId
    )
    if (existing) {
      return
    }
    this.changes.push({
      kind: 'modify',
      objectId,
      before: object.clonePreservingIdentity()
    })
  }

  /**
   * Returns true when a modify entry exists for the given object ID.
   *
   * Used by {@link AcDbDatabaseTransactionManager.isOpenedForWriteInTransaction}
   * to determine whether a symbol table record was opened for write within the
   * active transaction stack.
   *
   * @param objectId - Object identifier to look up
   */
  hasModify(objectId: string): boolean {
    return this.changes.some(
      c => c.kind === 'modify' && c.objectId === objectId
    )
  }

  /**
   * Records insertion of an object into a database container.
   *
   * If a matching remove was recorded earlier in the same transaction,
   * the pair cancels and neither change is retained.
   *
   * @param container - Container that received the object
   * @param object - Object that was appended; stored as an identity-preserving clone
   */
  recordAppend(container: AcDbChangeContainer, object: AcDbObject): void {
    this.recordStructuralChange({
      kind: 'append',
      container,
      object: object.clonePreservingIdentity()
    })
  }

  /**
   * Records removal of an object from a database container.
   *
   * If a matching append was recorded earlier in the same transaction,
   * the pair cancels and neither change is retained.
   *
   * @param container - Container that owned the removed object
   * @param object - Object that was removed; stored as an identity-preserving clone
   */
  recordRemove(container: AcDbChangeContainer, object: AcDbObject): void {
    this.recordStructuralChange({
      kind: 'remove',
      container,
      object: object.clonePreservingIdentity()
    })
  }

  /**
   * Records the value of a system variable before mutation.
   *
   * Only the first sysvar entry per normalized name is kept.
   *
   * @param name - System variable name (case-insensitive)
   * @param before - Value observed before the mutation
   */
  recordSysvar(name: string, before: unknown): void {
    const normalizedName = name.toLowerCase()
    const existing = this.changes.find(
      c => c.kind === 'sysvar' && c.name === normalizedName
    )
    if (existing) {
      return
    }
    this.changes.push({
      kind: 'sysvar',
      name: normalizedName,
      before
    })
  }

  /**
   * Captures the post-change state for modify and sysvar entries at commit time.
   *
   * Append/remove entries are complete when recorded and do not require
   * finalization.
   *
   * @param database - Database used to read live post-commit values
   */
  finalize(database: AcDbDatabase): void {
    for (const change of this.changes) {
      if (change.kind === 'modify') {
        const object = database.getObjectById(change.objectId)
        if (object) {
          change.after = object.clonePreservingIdentity()
        }
      } else if (change.kind === 'sysvar') {
        change.after = this.getSysvarValue(database, change.name)
      }
    }
  }

  /**
   * Records or coalesces one append/remove change.
   *
   * When an opposite structural change for the same container and object ID
   * already exists in this transaction, both entries cancel and neither is kept.
   *
   * @param change - Append or remove entry to merge into the recorder
   */
  private recordStructuralChange(
    change: Extract<AcDbDatabaseChange, { kind: 'append' | 'remove' }>
  ): void {
    const oppositeKind = change.kind === 'append' ? 'remove' : 'append'
    const cancelIndex = this.findStructuralChangeIndex(
      oppositeKind,
      change.container,
      change.object.objectId
    )
    if (cancelIndex >= 0) {
      this.changes.splice(cancelIndex, 1)
      return
    }

    this.changes.push(change)
  }

  /**
   * Merges one change from a nested transaction into this recorder.
   *
   * Modify and sysvar entries deduplicate by object ID or variable name;
   * structural entries use the same cancel/coalesce rules as {@link recordAppend}.
   *
   * @param change - Change copied from a child transaction recorder
   */
  private mergeChange(change: AcDbDatabaseChange): void {
    if (change.kind === 'modify') {
      const existing = this.changes.find(
        c => c.kind === 'modify' && c.objectId === change.objectId
      )
      if (!existing) {
        this.changes.push(change)
      }
      return
    }

    if (change.kind === 'sysvar') {
      const existing = this.changes.find(
        c => c.kind === 'sysvar' && c.name === change.name
      )
      if (!existing) {
        this.changes.push(change)
      }
      return
    }

    this.recordStructuralChange(change)
  }

  /**
   * Finds the index of a structural change matching kind, container, and object ID.
   *
   * @param kind - Append or remove kind to search for
   * @param container - Container descriptor that must match exactly
   * @param objectId - Object identifier of the affected record
   * @returns Index in {@link changes}, or `-1` when no match exists
   */
  private findStructuralChangeIndex(
    kind: 'append' | 'remove',
    container: AcDbChangeContainer,
    objectId: string
  ): number {
    return this.changes.findIndex(
      change =>
        change.kind === kind &&
        change.object.objectId === objectId &&
        areChangeContainersEqual(change.container, container)
    )
  }

  /**
   * Reads the current value of a system variable from the database.
   *
   * @param database - Database passed to {@link AcDbSysVarManager.getVar}
   * @param name - Normalized system variable name
   * @returns Live variable value used to populate `after` during {@link finalize}
   */
  private getSysvarValue(database: AcDbDatabase, name: string): unknown {
    return AcDbSysVarManager.instance().getVar(name, database)
  }
}

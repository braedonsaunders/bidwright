import { isEqual } from '@mlightcad/common'

import { AcDbObject } from '../../base'
import { AcDbEntity } from '../../entity/AcDbEntity'
import { AcDbDictionary } from '../../object/AcDbDictionary'
import { AcDbDatabase, AcDbLayerModifiedEventArgs } from '../AcDbDatabase'
import {
  AcDbLayerTableRecord,
  AcDbLayerTableRecordAttrs,
  LAYER_TABLE_RECORD_DIFF_ATTR_KEYS
} from '../AcDbLayerTableRecord'
import { AcDbSymbolTable } from '../AcDbSymbolTable'
import { AcDbSymbolTableRecord } from '../AcDbSymbolTableRecord'
import { AcDbSysVarManager } from '../AcDbSysVarManager'
import { AcDbChangeContainer, AcDbDatabaseChange } from './AcDbDatabaseChange'

/**
 * Applies forward or inverse database changes for undo/redo operations.
 *
 * Structural changes (append/remove) and property snapshots (modify/sysvar)
 * are replayed against a live {@link AcDbDatabase} instance.
 */
export class AcDbChangeApplier {
  /**
   * Creates an applier bound to one database.
   *
   * @param database - Database whose containers and objects receive replayed changes
   */
  constructor(private readonly database: AcDbDatabase) {}

  /**
   * Replays changes in commit order.
   *
   * Used by redo and by applying the forward direction of an undo record.
   *
   * @param changes - Ordered list of changes recorded by {@link AcDbChangeRecorder}
   */
  applyForward(changes: AcDbDatabaseChange[]): void {
    for (const change of changes) {
      this.applyChange(change, true)
    }
  }

  /**
   * Replays the inverse of each change in reverse order.
   *
   * Used by undo and transaction abort to restore the prior database state.
   *
   * @param changes - Ordered list of changes recorded by {@link AcDbChangeRecorder}
   */
  applyInverse(changes: AcDbDatabaseChange[]): void {
    for (let i = changes.length - 1; i >= 0; i--) {
      this.applyChange(changes[i], false)
    }
  }

  /**
   * Dispatches one recorded change in the requested direction.
   *
   * @param change - Single entry from a transaction or undo record
   * @param forward - When true, replay the original mutation; when false, apply its inverse
   */
  private applyChange(change: AcDbDatabaseChange, forward: boolean): void {
    switch (change.kind) {
      case 'modify':
        this.applyModify(change, forward)
        break
      case 'append':
        if (forward) {
          this.applyAppend(change.container, change.object)
        } else {
          this.applyRemove(change.container, change.object)
        }
        break
      case 'remove':
        if (forward) {
          this.applyRemove(change.container, change.object)
        } else {
          this.applyAppend(change.container, change.object)
        }
        break
      case 'sysvar':
        this.applySysvar(change, forward)
        break
    }
  }

  /**
   * Restores object property state from a modify snapshot.
   *
   * @param change - Modify entry with before/after clones
   * @param forward - When true, apply `after`; when false, apply `before`
   */
  private applyModify(
    change: AcDbDatabaseChange & { kind: 'modify' },
    forward: boolean
  ): void {
    const object = this.database.getObjectById(change.objectId)
    if (!object) {
      return
    }

    const snapshot = forward ? change.after : change.before
    if (snapshot) {
      object.restoreFrom(snapshot)
    }
  }

  /**
   * Restores a system variable from a sysvar snapshot.
   *
   * @param change - Sysvar entry with before/after values
   * @param forward - When true, apply `after`; when false, apply `before`
   */
  private applySysvar(
    change: AcDbDatabaseChange & { kind: 'sysvar' },
    forward: boolean
  ): void {
    const value = forward ? change.after : change.before
    if (value === undefined) {
      return
    }
    AcDbSysVarManager.instance().setVar(
      change.name,
      value as Parameters<typeof AcDbSysVarManager.prototype.setVar>[1],
      this.database
    )
  }

  /**
   * Re-inserts an object into the container described by `container`.
   *
   * @param container - Target block table record, symbol table, or dictionary entry
   * @param object - Object snapshot to append
   */
  private applyAppend(
    container: AcDbChangeContainer,
    object: AcDbObject
  ): void {
    switch (container.type) {
      case 'blockTableRecord': {
        const btr = this.database.tables.blockTable.getIdAt(container.ownerId)
        if (btr) {
          btr.appendEntity(object as AcDbEntity)
        }
        break
      }
      case 'symbolTable': {
        const table = this.getSymbolTable(container.tableName)
        if (table) {
          table.add(object as AcDbSymbolTableRecord)
        }
        break
      }
      case 'dictionary': {
        const dictionary = this.database.getObjectById(
          container.dictionaryId
        ) as AcDbDictionary | undefined
        if (dictionary) {
          dictionary.setAt(container.key, object)
        }
        break
      }
    }
  }

  /**
   * Removes an object from the container described by `container`.
   *
   * @param container - Source block table record, symbol table, or dictionary entry
   * @param object - Object whose {@link AcDbObject.objectId} identifies the removal target
   */
  private applyRemove(
    container: AcDbChangeContainer,
    object: AcDbObject
  ): void {
    switch (container.type) {
      case 'blockTableRecord': {
        const btr = this.database.tables.blockTable.getIdAt(container.ownerId)
        if (btr) {
          btr.removeEntity(object.objectId)
        }
        break
      }
      case 'symbolTable': {
        const table = this.getSymbolTable(container.tableName)
        if (table) {
          table.removeId(object.objectId)
        }
        break
      }
      case 'dictionary': {
        const dictionary = this.database.getObjectById(
          container.dictionaryId
        ) as AcDbDictionary | undefined
        if (dictionary) {
          dictionary.removeId(object.objectId)
        }
        break
      }
    }
  }

  /**
   * Resolves a symbol table instance from the stable name stored in undo records.
   *
   * @param tableName - Logical table name (for example, `"layerTable"`) or unknown fallback ID
   * @returns Matching table on this applier's database, or undefined when unrecognized
   */
  private getSymbolTable(tableName: string): AcDbSymbolTable | undefined {
    const tables = this.database.tables
    switch (tableName) {
      case 'appIdTable':
        return tables.appIdTable
      case 'blockTable':
        return tables.blockTable
      case 'dimStyleTable':
        return tables.dimStyleTable
      case 'linetypeTable':
        return tables.linetypeTable
      case 'textStyleTable':
        return tables.textStyleTable
      case 'viewTable':
        return tables.viewTable
      case 'layerTable':
        return tables.layerTable
      case 'viewportTable':
        return tables.viewportTable
      default:
        return undefined
    }
  }
}

/**
 * Collects entities affected by changes for post-commit/undo/redo event dispatch.
 *
 * Only block-table-record append/remove operations contribute to the
 * appended and erased lists; modify entries always resolve through object IDs.
 *
 * @param database - Database used to resolve live entity references
 * @param changes - Changes produced by a transaction or undo record
 * @returns Entity buckets keyed by the kind of structural or property change
 */
export function collectChangeEntities(
  database: AcDbDatabase,
  changes: AcDbDatabaseChange[]
): {
  /** Entities whose properties were modified */
  modified: AcDbEntity[]
  /** Entities appended to a block table record */
  appended: AcDbEntity[]
  /** Entities removed from a block table record */
  erased: AcDbEntity[]
} {
  const modified: AcDbEntity[] = []
  const appended: AcDbEntity[] = []
  const erased: AcDbEntity[] = []

  for (const change of changes) {
    if (change.kind === 'modify') {
      const object = database.getObjectById(change.objectId)
      if (object instanceof AcDbEntity) {
        modified.push(object)
      }
    } else if (change.kind === 'append') {
      if (change.container.type === 'blockTableRecord') {
        const entity =
          database.tables.blockTable.getEntityById(change.object.objectId) ??
          (change.object instanceof AcDbEntity ? change.object : undefined)
        if (entity) {
          appended.push(entity)
        }
      }
    } else if (change.kind === 'remove') {
      if (change.container.type === 'blockTableRecord') {
        if (change.object instanceof AcDbEntity) {
          erased.push(change.object)
        }
      }
    }
  }

  return { modified, appended, erased }
}

/**
 * One dictionary entry referenced by an append or remove change.
 */
export interface AcDbDictionaryChangeEntry {
  /** Dictionary object that was set or erased */
  object: AcDbObject
  /** Dictionary key associated with the object */
  key: string
}

/**
 * Collects dictionary entries affected by changes for post-commit/undo/redo dispatch.
 *
 * @param database - Database used to resolve live object references after replay
 * @param changes - Changes produced by a transaction or undo record
 * @returns Dictionary entries grouped by set and erase operations
 */
export function collectDictionaryChanges(
  database: AcDbDatabase,
  changes: AcDbDatabaseChange[]
): {
  /** Entries inserted or replaced in a dictionary */
  set: AcDbDictionaryChangeEntry[]
  /** Entries removed from a dictionary */
  erased: AcDbDictionaryChangeEntry[]
} {
  const set: AcDbDictionaryChangeEntry[] = []
  const erased: AcDbDictionaryChangeEntry[] = []

  for (const change of changes) {
    if (change.kind !== 'append' && change.kind !== 'remove') {
      continue
    }
    if (change.container.type !== 'dictionary') {
      continue
    }

    const key = change.container.key
    if (change.kind === 'append') {
      const object =
        database.getObjectById(change.object.objectId) ?? change.object
      set.push({ object, key })
    } else if (change.kind === 'remove') {
      erased.push({ object: change.object, key })
    }
  }

  return { set, erased }
}

/**
 * Compares two layer table record snapshots and returns changed attribute values.
 *
 * @param before - State before modification
 * @param after - State after modification
 * @returns Changed attributes mapped to their values in `after`
 */
export function diffLayerTableRecordAttrs(
  before: AcDbLayerTableRecord,
  after: AcDbLayerTableRecord
): Partial<AcDbLayerTableRecordAttrs> {
  const changes: Record<string, unknown> = {}

  for (const key of LAYER_TABLE_RECORD_DIFF_ATTR_KEYS) {
    const beforeVal = before.getAttrWithoutException(
      key as keyof AcDbLayerTableRecordAttrs & string
    )
    const afterVal = after.getAttrWithoutException(
      key as keyof AcDbLayerTableRecordAttrs & string
    )
    if (!isEqual(beforeVal, afterVal)) {
      changes[key] = afterVal
    }
  }

  return changes as Partial<AcDbLayerTableRecordAttrs>
}

/**
 * Collects layer modification events from transaction or undo record changes.
 *
 * @param database - Database used to resolve live layer references
 * @param changes - Changes produced by a transaction or undo record
 * @param inverse - When true, compute diffs for undo replay
 * @returns Layer-modified event payloads for dispatch
 */
export function collectLayerModifications(
  database: AcDbDatabase,
  changes: AcDbDatabaseChange[],
  inverse = false
): AcDbLayerModifiedEventArgs[] {
  const results: AcDbLayerModifiedEventArgs[] = []

  for (const change of changes) {
    if (change.kind !== 'modify') {
      continue
    }

    const layer = database.getObjectById(change.objectId)
    if (!(layer instanceof AcDbLayerTableRecord)) {
      continue
    }

    const before = change.before as AcDbLayerTableRecord | undefined
    const after = change.after as AcDbLayerTableRecord | undefined
    if (!before || !after) {
      continue
    }

    const attrChanges = inverse
      ? diffLayerTableRecordAttrs(after, before)
      : diffLayerTableRecordAttrs(before, after)
    if (Object.keys(attrChanges).length === 0) {
      continue
    }

    results.push({
      database,
      layer,
      changes: attrChanges
    })
  }

  return results
}

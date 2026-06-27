import { AcDbObject } from '../../base'

/**
 * Identifies the container that holds a database object for undo/redo recording.
 *
 * - `blockTableRecord` — entity membership in a block table record
 * - `symbolTable` — symbol table record membership
 * - `dictionary` — named entry in an {@link AcDbDictionary}
 */
export type AcDbChangeContainer =
  | { type: 'blockTableRecord'; ownerId: string }
  | { type: 'symbolTable'; tableName: string }
  | { type: 'dictionary'; dictionaryId: string; key: string }

/**
 * A single recorded change within a transaction or undo record.
 *
 * Each variant stores enough information for {@link AcDbChangeApplier} to
 * replay the change forward or in reverse.
 */
export type AcDbDatabaseChange =
  | {
      /** Property snapshot change for one database-resident object */
      kind: 'modify'
      /** Object whose properties changed */
      objectId: string
      /** State before the transaction or undoable operation */
      before: AcDbObject
      /** State after commit; populated by {@link AcDbChangeRecorder.finalize} */
      after?: AcDbObject
    }
  | {
      /** Object inserted into a container */
      kind: 'append'
      /** Container that received the object */
      container: AcDbChangeContainer
      /** Appended object snapshot */
      object: AcDbObject
    }
  | {
      /** Object removed from a container */
      kind: 'remove'
      /** Container that owned the object */
      container: AcDbChangeContainer
      /** Removed object snapshot */
      object: AcDbObject
    }
  | {
      /** System variable value change */
      kind: 'sysvar'
      /** Normalized system variable name */
      name: string
      /** Value before the mutation */
      before: unknown
      /** Value after commit; populated by {@link AcDbChangeRecorder.finalize} */
      after?: unknown
    }

/**
 * Returns true when two change containers refer to the same storage location.
 *
 * @param a - First container descriptor
 * @param b - Second container descriptor
 * @returns True when both descriptors identify the same append/remove target
 */
export function areChangeContainersEqual(
  a: AcDbChangeContainer,
  b: AcDbChangeContainer
): boolean {
  if (a.type !== b.type) {
    return false
  }

  switch (a.type) {
    case 'blockTableRecord':
      return b.type === 'blockTableRecord' && a.ownerId === b.ownerId
    case 'symbolTable':
      return b.type === 'symbolTable' && a.tableName === b.tableName
    case 'dictionary':
      return (
        b.type === 'dictionary' &&
        a.dictionaryId === b.dictionaryId &&
        a.key === b.key
      )
  }
}

import { AcDbDatabaseChange } from './AcDbDatabaseChange'

/**
 * An immutable group of changes that can be undone or redone as one unit.
 */
export interface AcDbUndoRecord {
  /** Optional label for UI display (for example, "Move", "Delete"). */
  label?: string
  /** Forward changes applied by the original operation. */
  changes: AcDbDatabaseChange[]
}

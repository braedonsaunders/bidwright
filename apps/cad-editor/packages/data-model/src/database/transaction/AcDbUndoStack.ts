import { AcDbUndoRecord } from './AcDbUndoRecord'

/**
 * Manages undo and redo history for database changes.
 *
 * Stores committed {@link AcDbUndoRecord} entries and clears the redo stack
 * whenever a new undo record is pushed.
 */
export class AcDbUndoStack {
  private readonly undoRecords: AcDbUndoRecord[] = []
  private readonly redoRecords: AcDbUndoRecord[] = []

  /** Maximum number of undo records retained. */
  maxDepth = 100

  /**
   * Pushes a new undo record and clears redo history.
   *
   * When {@link maxDepth} is exceeded, the oldest undo record is discarded.
   *
   * @param record - Undo record produced by {@link AcDbDatabaseTransactionManager}
   */
  push(record: AcDbUndoRecord): void {
    this.undoRecords.push(record)
    this.redoRecords.length = 0
    if (this.undoRecords.length > this.maxDepth) {
      this.undoRecords.shift()
    }
  }

  /**
   * Removes and returns the most recent undo record.
   *
   * @returns The record popped from the undo stack, or undefined when empty
   */
  popUndo(): AcDbUndoRecord | undefined {
    return this.undoRecords.pop()
  }

  /**
   * Stores an undo record on the redo stack after {@link popUndo}.
   *
   * @param record - Record that was just undone and may be redone
   */
  pushRedo(record: AcDbUndoRecord): void {
    this.redoRecords.push(record)
  }

  /**
   * Removes and returns the most recent redo record.
   *
   * @returns The record popped from the redo stack, or undefined when empty
   */
  popRedo(): AcDbUndoRecord | undefined {
    return this.redoRecords.pop()
  }

  /**
   * Returns true when at least one undo record is available.
   */
  canUndo(): boolean {
    return this.undoRecords.length > 0
  }

  /**
   * Returns true when at least one redo record is available.
   */
  canRedo(): boolean {
    return this.redoRecords.length > 0
  }

  /**
   * Discards all undo and redo records.
   */
  clear(): void {
    this.undoRecords.length = 0
    this.redoRecords.length = 0
  }
}

import { AcDbTransaction } from './AcDbTransaction'

/**
 * Manages database transactions.
 *
 * @deprecated Use {@link AcDbDatabaseTransactionManager} via
 * {@link AcDbDatabase.transactionManager} for database-bound transactions,
 * undo/redo, and change recording.
 */
export class AcDbTransactionManager {
  /** Stack of active transactions */
  private readonly transactionStack: AcDbTransaction[] = []

  /**
   * Starts a new transaction and pushes it onto the stack.
   *
   * Equivalent to AcDbTransactionManager::startTransaction().
   *
   * @returns The newly created transaction
   */
  startTransaction(): AcDbTransaction {
    const tr = new AcDbTransaction()
    this.transactionStack.push(tr)
    return tr
  }

  /**
   * Returns the top-most active transaction.
   *
   * @returns The current transaction or undefined if none exists
   */
  currentTransaction(): AcDbTransaction | undefined {
    return this.transactionStack[this.transactionStack.length - 1]
  }

  /**
   * Commits the current transaction.
   *
   * Changes made during the transaction become permanent.
   *
   * @throws Error if no transaction is active
   */
  commitTransaction(): void {
    const tr = this.transactionStack.pop()
    if (!tr) {
      throw new Error('No active transaction to commit.')
    }

    tr.commit()
  }

  /**
   * Aborts the current transaction.
   *
   * All changes made during the transaction are rolled back.
   *
   * @throws Error if no transaction is active
   */
  abortTransaction(): void {
    const tr = this.transactionStack.pop()
    if (!tr) {
      throw new Error('No active transaction to abort.')
    }

    tr.abort()
  }

  /**
   * Returns true if at least one transaction is active.
   */
  hasTransaction(): boolean {
    return this.transactionStack.length > 0
  }
}

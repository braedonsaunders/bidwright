import { AcDbTransactionManager } from '../src/database/transaction/AcDbTransactionManager'

describe('AcDbTransactionManager', () => {
  it('starts and tracks current transaction', () => {
    const manager = new AcDbTransactionManager()
    expect(manager.hasTransaction()).toBe(false)

    const tr = manager.startTransaction()
    expect(manager.hasTransaction()).toBe(true)
    expect(manager.currentTransaction()).toBe(tr)
  })

  it('commits and aborts with error paths', () => {
    const manager = new AcDbTransactionManager()

    expect(() => manager.commitTransaction()).toThrow(
      'No active transaction to commit.'
    )
    expect(() => manager.abortTransaction()).toThrow(
      'No active transaction to abort.'
    )

    manager.startTransaction()
    manager.commitTransaction()
    expect(manager.hasTransaction()).toBe(false)

    manager.startTransaction()
    manager.abortTransaction()
    expect(manager.hasTransaction()).toBe(false)
  })
})

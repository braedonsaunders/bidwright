import { AcDbObject, AcDbOpenMode } from '../src/base'
import { AcDbTransaction } from '../src/database/transaction/AcDbTransaction'

class TestTransaction extends AcDbTransaction {
  private readonly store = new Map<string, AcDbObject>()

  register(obj: AcDbObject) {
    this.store.set(obj.objectId, obj)
    return obj
  }

  protected override lookupObject<T extends AcDbObject>(objectId: string): T {
    const obj = this.store.get(objectId)
    if (!obj) {
      throw new Error(`missing ${objectId}`)
    }
    return obj as T
  }
}

describe('AcDbTransaction', () => {
  it('tracks opened object and write rollback', () => {
    const tr = new TestTransaction()
    const obj = tr.register(new AcDbObject())

    obj.ownerId = 'original-owner'
    const opened = tr.getObject<AcDbObject>(
      obj.objectId,
      AcDbOpenMode.kForWrite
    )
    expect(opened).toBe(obj)

    opened!.ownerId = 'changed-owner'
    tr.abort()
    expect(obj.ownerId).toBe('original-owner')
  })

  it('returns the same object when opening twice and clears on commit', () => {
    const tr = new TestTransaction()
    const obj = tr.register(new AcDbObject())

    expect(tr.getObject<AcDbObject>(obj.objectId, AcDbOpenMode.kForRead)).toBe(
      obj
    )
    expect(tr.getObject<AcDbObject>(obj.objectId, AcDbOpenMode.kForRead)).toBe(
      obj
    )

    tr.commit()
    expect(tr.getObject<AcDbObject>(obj.objectId, AcDbOpenMode.kForRead)).toBe(
      obj
    )
  })

  it('throws when lookup is not implemented/found', () => {
    const tr = new TestTransaction()
    expect(() =>
      tr.getObject<AcDbObject>('missing', AcDbOpenMode.kForRead)
    ).toThrow('missing missing')
  })
})
import { AcDbObject, TEMP_OBJECT_ID_PREFIX } from '../src/base/AcDbObject'

export function expectDetachedClone<T extends AcDbObject>(factory: () => T) {
  const source = factory()
  const sourceId = source.objectId

  const cloned = source.clone() as T

  expect(cloned).not.toBe(source)
  expect(cloned.objectId).not.toBe(sourceId)
  expect(cloned.objectId.startsWith(TEMP_OBJECT_ID_PREFIX)).toBe(true)
  expect((cloned as unknown as { _database?: unknown })._database).toBe(
    undefined
  )
}

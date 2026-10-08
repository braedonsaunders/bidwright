/**
 * Iterator used for iterating over database objects.
 *
 * This class provides an iterator interface for traversing collections
 * of database objects. It implements both IterableIterator and provides
 * additional methods for checking if more items are available.
 *
 * @template ResultType - The type of objects being iterated over
 */
export class AcDbObjectIterator<ResultType>
  implements IterableIterator<ResultType>
{
  /** Current index in the iteration */
  private i = 0
  private readonly _records: Map<string, ResultType> | null
  private readonly _array: readonly ResultType[] | null
  private readonly _keys: string[]

  /**
   * Creates a new AcDbObjectIterator instance.
   *
   * @param records - Map or array of objects to iterate over
   *
   * @example
   * ```typescript
   * const entities = [entity1, entity2, entity3];
   * const iterator = new AcDbObjectIterator(entities);
   * ```
   */
  constructor(records: Map<string, ResultType> | readonly ResultType[]) {
    if (records instanceof Map) {
      this._records = records
      this._array = null
      this._keys = Array.from(records.keys())
    } else {
      this._records = null
      this._array = records
      this._keys = []
    }
  }

  /**
   * The number of items
   */
  get count() {
    return this._records?.size ?? this._array!.length
  }

  /**
   * Converts values in the current iterator to one array
   * @returns An array of values in the current iterator
   */
  toArray() {
    if (this._records) {
      return Array.from(this._records.values())
    }
    return [...this._array!]
  }

  /**
   * Returns the iterator itself, allowing it to be used in for...of loops.
   *
   * @returns This iterator instance
   *
   * @example
   * ```typescript
   * for (const entity of iterator) {
   *   console.log('Entity:', entity);
   * }
   * ```
   */
  [Symbol.iterator](): IterableIterator<ResultType> {
    return this
  }

  /**
   * Increments the iterator to the next entry.
   *
   * @returns Iterator result containing the next value or null if done
   *
   * @example
   * ```typescript
   * const result = iterator.next();
   * if (!result.done) {
   *   console.log('Next item:', result.value);
   * }
   * ```
   */
  next(): IteratorResult<ResultType, null> {
    if (this._array) {
      if (this.i < this._array.length) {
        const value = this._array[this.i]
        this.i += 1
        return { value, done: false }
      }
      return { value: null, done: true }
    }

    while (this.i < this._keys.length) {
      const value = this._records!.get(this._keys[this.i]) as ResultType
      this.i += 1
      return { value: value, done: false }
    }
    return { value: null, done: true }
  }
}

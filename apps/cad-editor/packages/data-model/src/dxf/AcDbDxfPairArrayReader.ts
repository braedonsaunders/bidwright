import type { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { acdbDxfValueType } from '../base/AcDbDxfGroupCodeTypes'
import type { AcDbDxfPair } from '../base/AcDbDxfPair'
import type { AcDbDxfPairReader } from '../base/AcDbDxfPairReader'
import type { AcDbTypedValue } from '../base/AcDbTypedValue'

/**
 * In-memory pair reader used to replay one object's tags (e.g. DIMENSION
 * subclass selection) without buffering the whole DXF file.
 */
export class AcDbDxfPairArrayReader implements AcDbDxfPairReader {
  readonly kind: 'ascii' | 'binary' = 'ascii'
  private _index = 0

  constructor(private readonly _pairs: readonly AcDbDxfPair[]) {}

  next(): AcDbDxfPair | undefined {
    if (this._index >= this._pairs.length) return undefined
    return this._pairs[this._index++]
  }

  peek(): AcDbDxfPair | undefined {
    if (this._index >= this._pairs.length) return undefined
    return this._pairs[this._index]
  }

  position() {
    return { byteOffset: this._index }
  }
}

/** Build a typed {@link AcDbDxfPair} from a filer item. */
export function acdbTypedValueToDxfPair(item: AcDbTypedValue): AcDbDxfPair {
  const code = Number(item.code)
  const value = item.value
  const type = acdbDxfValueType(code)
  if (type === 'comment') {
    return { code, type: 'string', value: String(value ?? '') }
  }
  if (type === 'bool') {
    return { code, type: 'bool', value: Boolean(value) }
  }
  if (type === 'binary') {
    if (value instanceof Uint8Array) return { code, type: 'binary', value }
    return { code, type: 'string', value: String(value ?? '') }
  }
  if (type === 'handle') {
    return { code, type: 'handle', value: String(value ?? '') }
  }
  if (type === 'int' || type === 'long') {
    return { code, type: type === 'long' ? 'long' : 'int', value: Number(value) }
  }
  if (type === 'double') {
    return { code, type: 'double', value: Number(value) }
  }
  return { code, type: 'string', value: String(value ?? '') }
}

/**
 * Drain pairs from the current object (until code 0), excluding XData so
 * {@link AcDbObject.dxfIn} can still consume it afterward.
 */
export function acdbDrainDxfObjectPairs(filer: AcDbDxfFiler): AcDbDxfPair[] {
  const pairs: AcDbDxfPair[] = []
  while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
    const item = filer.readItem()
    if (!item) break
    pairs.push(acdbTypedValueToDxfPair(item))
  }
  return pairs
}

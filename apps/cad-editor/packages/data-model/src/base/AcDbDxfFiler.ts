import {
  AcCmColor,
  AcCmTransparency,
  AcCmTransparencyMethod
} from '@mlightcad/common'
import {
  AcGePoint2d,
  AcGePoint2dLike,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'

import type { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbDwgVersion } from '../database/AcDbDwgVersion'
import { acdbDxfIsInt32Code, acdbDxfValueType } from './AcDbDxfGroupCodeTypes'
import type { AcDbDxfPair } from './AcDbDxfPair'
import {
  acdbCreateDxfPairReader,
  type AcDbDxfPairReader,
  acdbMakeAsciiDxfPairReader
} from './AcDbDxfPairReader'
import {
  ACDB_DXF_XDATA_BINARY_MAX_BYTES,
  ACDB_DXF_XDATA_STRING_MAX_BYTES,
  acdbChunkBinaryByMaxBytes,
  acdbChunkDxfMTextContents,
  acdbChunkUtf8ByMaxBytes
} from './AcDbDxfStringChunks'
import { AcDbResultBuffer } from './AcDbResultBuffer'
import type { AcDbTypedValue } from './AcDbTypedValue'

/** Filer direction, mirroring ObjectARX usage of AcDbDxfFiler for in vs out. */
export type AcDbDxfFilerMode = 'read' | 'write'

/** DXF text vs binary output for write-mode filers. */
export type AcDbDxfOutputFormat = 'ascii' | 'binary'

/**
 * Lightweight status codes for DXF filing (ObjectARX-inspired).
 */
export enum AcDbDxfFilerStatus {
  Ok = 0,
  EndOfFile = 1,
  EndOfObject = 2,
  InvalidDxfCode = 3,
  BadDxfSequence = 4,
  NotThatKindOfClass = 5,
  WrongMode = 6
}

export interface AcDbDxfFilerOptions {
  database?: AcDbDatabase
  precision?: number
  version?: string | number | AcDbDwgVersion
  /** When set, constructs a read-mode filer over this pair stream. */
  reader?: AcDbDxfPairReader
  /** Write-mode output format (default ASCII). */
  outputFormat?: AcDbDxfOutputFormat
  /**
   * Read-mode text encoding override for `fromBuffer`.
   *
   * When omitted, the encoding is auto-detected from `$DWGCODEPAGE`.
   * Common aliases such as `'cp949'` are normalized to a supported
   * `TextDecoder` label (`'euc-kr'`). Ignored when `reader` is provided.
   */
  encoding?: string
}

/** Magic prefix for AutoCAD Binary DXF files (22 bytes). */
const BINARY_DXF_MAGIC = (() => {
  const prefix = 'AutoCAD Binary DXF\r\n'
  const bytes = new Uint8Array(22)
  for (let i = 0; i < prefix.length; i++) bytes[i] = prefix.charCodeAt(i)
  bytes[20] = 0x1a
  bytes[21] = 0x00
  return bytes
})()

/**
 * DXF filer that mirrors the ObjectARX {@link AcDbDxfFiler} API.
 *
 * - **Write mode** (default): accumulates classic group-code ASCII DXF text,
 *   or binary DXF bytes when `outputFormat` is `'binary'`.
 * - **Read mode**: pulls typed pairs from an {@link AcDbDxfPairReader} with
 *   `readItem` / `pushBackItem` / `atEndOfObject` / `atSubclassData`.
 */
export class AcDbDxfFiler {
  private _database?: AcDbDatabase
  private _precision: number
  private _version?: AcDbDwgVersion
  private readonly _mode: AcDbDxfFilerMode
  private readonly _outputFormat: AcDbDxfOutputFormat
  private readonly _lines: string[]
  private readonly _binaryChunks: Uint8Array[]
  private _binaryLength = 0
  private readonly _handleMap: Map<string, string>
  private _nextHandle: number
  private _headerHandleSeedIndex?: number

  private _reader?: AcDbDxfPairReader
  /**
   * Pushback stack for read mode (ObjectARX `pushBackItem`).
   * LIFO: nested pushBacks are supported so a second push does not clobber
   * the first.
   */
  private _pushed: AcDbDxfPair[] = []
  private _status: AcDbDxfFilerStatus = AcDbDxfFilerStatus.Ok
  private _errorMessage = ''
  private _lastRead: AcDbDxfPair | undefined

  constructor(options: AcDbDxfFilerOptions = {}) {
    this._database = options.database
    this._precision = Math.max(0, Math.min(16, options.precision ?? 16))
    this._version =
      options.version instanceof AcDbDwgVersion
        ? options.version
        : options.version != null
          ? new AcDbDwgVersion(options.version)
          : undefined
    this._outputFormat = options.outputFormat ?? 'ascii'
    this._lines = []
    this._binaryChunks = []
    this._handleMap = new Map()
    this._nextHandle = 1
    this._mode = options.reader ? 'read' : 'write'
    this._reader = options.reader
    if (this._mode === 'write' && this._outputFormat === 'binary') {
      this.appendBinary(BINARY_DXF_MAGIC)
    }
  }

  /** Create a read-mode filer from an existing pair reader. */
  static forReading(
    reader: AcDbDxfPairReader,
    options: Omit<AcDbDxfFilerOptions, 'reader'> = {}
  ): AcDbDxfFiler {
    return new AcDbDxfFiler({ ...options, reader })
  }

  /** Create a read-mode filer from DXF bytes (ASCII or binary). */
  static fromBuffer(
    data: ArrayBuffer | Uint8Array,
    options: Omit<AcDbDxfFilerOptions, 'reader'> = {}
  ): AcDbDxfFiler {
    return AcDbDxfFiler.forReading(
      acdbCreateDxfPairReader(data, { encoding: options.encoding }),
      options
    )
  }

  /** Create a read-mode filer from an already-decoded ASCII DXF string. */
  static fromString(
    text: string,
    options: Omit<AcDbDxfFilerOptions, 'reader'> = {}
  ): AcDbDxfFiler {
    return AcDbDxfFiler.forReading(acdbMakeAsciiDxfPairReader(text), options)
  }

  get mode(): AcDbDxfFilerMode {
    return this._mode
  }

  get database() {
    return this._database
  }

  set database(value: AcDbDatabase | undefined) {
    this._database = value
  }

  get precision() {
    return this._precision
  }

  setPrecision(value: number) {
    this._precision = Math.max(0, Math.min(16, value))
    return this
  }

  get version() {
    return this._version
  }

  get nextHandle() {
    return this._nextHandle
  }

  get filerStatus() {
    return this._status
  }

  get errorMessage() {
    return this._errorMessage
  }

  setVersion(value: string | number | AcDbDwgVersion) {
    this._version =
      value instanceof AcDbDwgVersion ? value : new AcDbDwgVersion(value)
    return this
  }

  setError(status: AcDbDxfFilerStatus, message = '') {
    this._status = status
    this._errorMessage = message
    return this
  }

  resetStatus() {
    this._status = AcDbDxfFilerStatus.Ok
    this._errorMessage = ''
    return this
  }

  toString() {
    this.assertWriteMode()
    if (this._outputFormat === 'binary') {
      throw new Error('Use toBinary() for binary DXF output')
    }
    return this._lines.join('\n') + '\n'
  }

  /** Finalize binary DXF bytes (includes magic prefix). */
  toBinary(): Uint8Array {
    this.assertWriteMode()
    if (this._outputFormat !== 'binary') {
      throw new Error('Filer is not in binary output mode')
    }
    const out = new Uint8Array(this._binaryLength)
    let offset = 0
    for (const chunk of this._binaryChunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  }

  /** Reserve the HEADER seed until every exported object/reference has been registered. */
  writeHeaderHandleSeed() {
    this.writeString(9, '$HANDSEED')
    this.writeString(5, '0')
    this._headerHandleSeedIndex =
      this._outputFormat === 'binary'
        ? this._binaryChunks.length - 1
        : this._lines.length - 1
    return this
  }

  finalizeHeaderHandleSeed() {
    if (this._headerHandleSeedIndex == null) return this
    let next = BigInt(this._nextHandle)
    for (const handle of this._handleMap.values()) {
      const candidate = BigInt('0x' + handle) + BigInt(1)
      if (candidate > next) next = candidate
    }
    const seed = next.toString(16).toUpperCase()
    if (this._outputFormat === 'binary') {
      const encoded = new TextEncoder().encode(seed + '\0'),
        index = this._headerHandleSeedIndex
      this._binaryLength += encoded.length - this._binaryChunks[index].length
      this._binaryChunks[index] = encoded
    } else this._lines[this._headerHandleSeedIndex] = seed
    return this
  }

  registerHandle(key: string) {
    if (!this._handleMap.has(key)) {
      // If key is already a valid hex handle, preserve it
      if (/^[0-9A-F]+$/i.test(key)) {
        this._handleMap.set(key, key.toUpperCase())
      } else {
        this._handleMap.set(key, this._nextHandle.toString(16).toUpperCase())
        this._nextHandle += 1
      }
    }
    return this._handleMap.get(key)!
  }

  resolveHandle(key?: string) {
    if (!key) return undefined
    return this.registerHandle(key)
  }

  // ---------------------------------------------------------------------------
  // Read API (ObjectARX-inspired)
  // ---------------------------------------------------------------------------

  /** True if no more pairs are available. */
  get atEof(): boolean {
    if (this._mode !== 'read') return false
    if (this._pushed.length > 0) return false
    return this._reader?.peek() === undefined
  }

  /**
   * Current read position in the underlying pair stream.
   * Useful for byte-based parse progress while streaming a DXF.
   */
  position(): { line?: number; byteOffset: number } {
    if (this._mode !== 'read' || !this._reader) {
      return { byteOffset: 0 }
    }
    return this._reader.position()
  }

  /**
   * True if the next pair starts a new object (group code 0) or EOF.
   * Does not consume the pair.
   */
  get atEndOfObject(): boolean {
    if (this._mode !== 'read') return true
    const next = this.peekPair()
    return next === undefined || next.code === 0
  }

  /** True if the next pair is XDATA start (1001) or similar extended data. */
  get atExtendedData(): boolean {
    if (this._mode !== 'read') return false
    const next = this.peekPair()
    if (!next) return false
    return next.code === 1001 || next.code === 1000 || next.code === 1002
  }

  /**
   * Advance past subclass marker (100, name) if present.
   * Returns true when positioned at the named subclass data.
   */
  atSubclassData(name: string): boolean {
    if (this._mode !== 'read') return false
    const next = this.peekPair()
    if (!next || next.code !== 100) return false
    if (typeof next.value !== 'string' || next.value !== name) return false
    this.readPair()
    return true
  }

  /** Peek the next pair without consuming it. */
  peekItem(): AcDbTypedValue | undefined {
    const pair = this.peekPair()
    return pair ? this.pairToTypedValue(pair) : undefined
  }

  /**
   * Read one DXF item into a typed value (ObjectARX `readItem`).
   * Returns undefined at EOF and sets {@link filerStatus} to EndOfFile.
   */
  readItem(): AcDbTypedValue | undefined {
    const pair = this.readPair()
    if (!pair) {
      this._status = AcDbDxfFilerStatus.EndOfFile
      return undefined
    }
    this._status = AcDbDxfFilerStatus.Ok
    return this.pairToTypedValue(pair)
  }

  /**
   * Push the last-read (or provided) pair back so the next read returns it.
   * Multiple pushbacks form a LIFO stack (nested readers can push without
   * overwriting a prior push).
   */
  pushBackItem(item?: AcDbTypedValue | AcDbDxfPair): void {
    if (item && 'type' in item) {
      this._pushed.push(item)
      return
    }
    if (item) {
      this._pushed.push(this.typedValueToPair(item))
      return
    }
    // No-arg form: re-push the last consumed pair.
    if (this._lastRead) {
      this._pushed.push(this._lastRead)
    }
  }

  /** Skip pairs until the next object boundary (code 0) without consuming it. */
  skipToEndOfObject(): void {
    while (!this.atEndOfObject && !this.atEof) {
      this.readPair()
    }
  }

  readString(expectedCode?: number): string | undefined {
    const pair = this.readPair()
    if (!pair) return undefined
    if (expectedCode != null && pair.code !== expectedCode) {
      this.pushBackPair(pair)
      this.setError(
        AcDbDxfFilerStatus.InvalidDxfCode,
        `Expected group code ${expectedCode}, got ${pair.code}`
      )
      return undefined
    }
    if (pair.type === 'string' || pair.type === 'handle') return pair.value
    return String(pair.value)
  }

  readInt16(expectedCode?: number): number | undefined {
    return this.readNumber(expectedCode)
  }

  readInt32(expectedCode?: number): number | undefined {
    return this.readNumber(expectedCode)
  }

  readInt64(expectedCode?: number): number | bigint | undefined {
    const pair = this.readPair()
    if (!pair) return undefined
    if (expectedCode != null && pair.code !== expectedCode) {
      this.pushBackPair(pair)
      this.setError(
        AcDbDxfFilerStatus.InvalidDxfCode,
        `Expected group code ${expectedCode}, got ${pair.code}`
      )
      return undefined
    }
    if (pair.type === 'long' || pair.type === 'int' || pair.type === 'double') {
      return pair.value as number | bigint
    }
    if (pair.type === 'bool') return pair.value ? 1 : 0
    const n = Number(pair.value)
    return Number.isFinite(n) ? n : 0
  }

  readDouble(expectedCode?: number): number | undefined {
    return this.readNumber(expectedCode)
  }

  readBoolean(expectedCode?: number): boolean | undefined {
    const pair = this.readPair()
    if (!pair) return undefined
    if (expectedCode != null && pair.code !== expectedCode) {
      this.pushBackPair(pair)
      this.setError(
        AcDbDxfFilerStatus.InvalidDxfCode,
        `Expected group code ${expectedCode}, got ${pair.code}`
      )
      return undefined
    }
    if (pair.type === 'bool') return pair.value
    if (typeof pair.value === 'number') return pair.value !== 0
    if (typeof pair.value === 'string') {
      return pair.value !== '0' && pair.value !== ''
    }
    return Boolean(pair.value)
  }

  readHandle(expectedCode?: number): string | undefined {
    const pair = this.readPair()
    if (!pair) return undefined
    if (expectedCode != null && pair.code !== expectedCode) {
      this.pushBackPair(pair)
      this.setError(
        AcDbDxfFilerStatus.InvalidDxfCode,
        `Expected group code ${expectedCode}, got ${pair.code}`
      )
      return undefined
    }
    if (pair.type === 'handle' || pair.type === 'string') return pair.value
    return String(pair.value)
  }

  readObjectId(expectedCode?: number): string | undefined {
    return this.readHandle(expectedCode)
  }

  /**
   * Read a 2D point starting at `code` (x), then `code+10` (y).
   * Tolerates missing Y (defaults to 0) when the next code is not code+10.
   */
  readPoint2d(code: number): AcGePoint2d | undefined {
    const x = this.readDouble(code)
    if (x === undefined) return undefined
    const next = this.peekPair()
    let y = 0
    if (next && next.code === code + 10) {
      y = this.readNumber() ?? 0
    }
    return new AcGePoint2d(x, y)
  }

  /**
   * Read a 3D point starting at `code` (x), then `code+10` / `code+20`.
   * Missing Y/Z default to 0 when those group codes are absent.
   */
  readPoint3d(code: number): AcGePoint3d | undefined {
    const x = this.readDouble(code)
    if (x === undefined) return undefined
    let y = 0
    let z = 0
    const n1 = this.peekPair()
    if (n1 && n1.code === code + 10) {
      y = this.readNumber() ?? 0
    }
    const n2 = this.peekPair()
    if (n2 && n2.code === code + 20) {
      z = this.readNumber() ?? 0
    }
    return new AcGePoint3d(x, y, z)
  }

  readVector3d(code: number): AcGeVector3d | undefined {
    const p = this.readPoint3d(code)
    return p ? new AcGeVector3d(p.x, p.y, p.z) : undefined
  }

  /**
   * Apply color group codes (62 ACI / 420 true color) onto `color` when the
   * current pair matches. Returns true if a color code was consumed.
   */
  readCmColorInto(
    color: AcCmColor,
    aciCode = 62,
    trueColorCode = 420
  ): boolean {
    const next = this.peekPair()
    if (!next) return false
    if (next.code === aciCode) {
      const v = this.readNumber()
      if (v != null) color.colorIndex = v
      return true
    }
    if (next.code === trueColorCode) {
      const v = this.readNumber()
      if (v != null) color.setRGBValue(v)
      return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Write API
  // ---------------------------------------------------------------------------

  writeGroup(code: number, value: unknown) {
    this.assertWriteMode()
    if (value == null) return this
    if (this._outputFormat === 'binary') {
      return this.writeBinaryGroup(code, value)
    }
    this._lines.push(String(Math.trunc(code)))
    const text = this.formatValue(value)
    // Never emit an empty value line — it breaks DXF pairing (e.g. "70\n\n4") and
    // strict readers like AutoCAD report a corrupted file.
    this._lines.push(text === '' ? '0' : text)
    return this
  }

  writeStart(value: string) {
    return this.writeString(0, value)
  }

  /**
   * DXF dialect capabilities for the target write version.
   * When version is unset (ad-hoc writers / unit tests), treat as latest.
   */
  get capabilities() {
    return (this._version ?? AcDbDwgVersion.latest).capabilities
  }

  writeSubclassMarker(value: string) {
    if (!this.capabilities.supportsSubclassMarkers) return this
    return this.writeString(100, value)
  }

  writeString(code: number, value?: string) {
    if (!value && value !== '') return this
    return this.writeGroup(code, value)
  }

  /**
   * Write MTEXT (or embedded-MTEXT) contents using AutoCAD's group 3 / group 1
   * 250-character chunking rules.
   */
  writeMTextContents(text: string) {
    for (const chunk of acdbChunkDxfMTextContents(text ?? '')) {
      this.writeString(chunk.code, chunk.value)
    }
    return this
  }

  writeInt8(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeInt16(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeInt32(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeInt64(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeUInt16(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.max(0, value))
  }

  writeUInt32(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.max(0, value))
  }

  writeBoolean(code: number, value?: boolean) {
    return value == null ? this : this.writeGroup(code, value ? 1 : 0)
  }

  writeBool(code: number, value?: boolean) {
    return this.writeBoolean(code, value)
  }

  writeDouble(code: number, value?: number) {
    return value == null || !Number.isFinite(value)
      ? this
      : this.writeGroup(code, value)
  }

  writeAngle(code: number, radians?: number) {
    if (radians == null || !Number.isFinite(radians)) return this
    return this.writeDouble(code, (radians * 180) / Math.PI)
  }

  writeHandle(code: number, key?: string) {
    if (!this.capabilities.supportsHandles) return this
    const handle = this.resolveHandle(key)
    return handle ? this.writeString(code, handle) : this
  }

  writeObjectId(code: number, objectId?: string) {
    return this.writeHandle(code, objectId)
  }

  /** Lineweight (group 370). Omitted for DXF targets before AutoCAD 2000. */
  writeLineWeight(code: number, value?: number) {
    if (value == null || !this.capabilities.supportsLineWeight) return this
    return this.writeInt16(code, value)
  }

  writePoint2d(code: number, point?: AcGePoint2dLike) {
    if (!point) return this
    this.writeDouble(code, point.x)
    this.writeDouble(code + 10, point.y)
    return this
  }

  writePoint3d(code: number, point?: AcGePoint3dLike) {
    if (!point) return this
    this.writeDouble(code, point.x)
    this.writeDouble(code + 10, point.y)
    this.writeDouble(code + 20, point.z ?? 0)
    return this
  }

  writeVector3d(code: number, vector?: AcGeVector3dLike) {
    if (!vector) return this
    this.writeDouble(code, vector.x)
    this.writeDouble(code + 10, vector.y)
    this.writeDouble(code + 20, vector.z ?? 0)
    return this
  }

  writeCmColor(
    color?: AcCmColor,
    aciCode: number = 62,
    trueColorCode: number = 420
  ) {
    if (!color) return this
    const aci = color.colorIndex
    if (aci != null) {
      this.writeInt16(aciCode, aci)
    }
    const rgb = color.RGB
    if (rgb != null && color.colorIndex == null) {
      if (this.capabilities.supportsTrueColor) {
        this.writeInt32(trueColorCode, rgb)
      } else {
        // Pre-2004 DXF has no 420 — fall back to ACI white.
        this.writeInt16(aciCode, 7)
      }
    }
    return this
  }

  writeTransparency(transparency?: AcCmTransparency, code: number = 440) {
    if (
      !transparency ||
      transparency.method === AcCmTransparencyMethod.ErrorValue ||
      !this.capabilities.supportsTransparency
    ) {
      return this
    }
    return this.writeInt32(code, transparency.serialize())
  }

  writeResultBuffer(data?: AcDbResultBuffer | null) {
    return this.writeTypedValues(data)
  }

  /**
   * Writes any typed-value iterable using the same XData chunking rules as
   * ResultBuffer output. This lets compact imported XData stream directly.
   */
  writeTypedValues(data?: Iterable<AcDbTypedValue> | null) {
    if (!data) return this
    for (const item of data) {
      const code = Number(item.code)
      // XData ASCII strings are limited to 255 bytes per group 1000.
      if (code === 1000 && typeof item.value === 'string') {
        for (const chunk of acdbChunkUtf8ByMaxBytes(
          item.value,
          ACDB_DXF_XDATA_STRING_MAX_BYTES
        )) {
          this.writeGroup(1000, chunk)
        }
        continue
      }
      // XData binary chunks are limited to 127 bytes per group 1004.
      // Coerce ArrayBuffer / number[] / hex so we never emit String(bytes).
      if (code === 1004) {
        const bytes = acdbCoerceBinaryBytes(item.value)
        if (bytes) {
          for (const chunk of acdbChunkBinaryByMaxBytes(
            bytes,
            ACDB_DXF_XDATA_BINARY_MAX_BYTES
          )) {
            if (this._outputFormat === 'binary') {
              this.writeGroup(1004, chunk)
            } else {
              this.writeGroup(1004, acdbBytesToHex(chunk))
            }
          }
          continue
        }
      }
      // ObjectARX ResultBuffers store one 1010–1013 entry with a 3D point.
      // DXF requires three doubles (code / code+10 / code+20). Expand here so
      // importers that keep `{x,y,z}` do not stringify to "[object Object]".
      if (code >= 1010 && code <= 1013) {
        const point = acdbCoercePoint3d(item.value)
        if (point) {
          this.writePoint3d(code, point)
          continue
        }
      }
      this.writeGroup(item.code, item.value)
    }
    return this
  }

  startSection(name: string) {
    this.writeStart('SECTION')
    this.writeString(2, name)
    return this
  }

  endSection() {
    this.writeStart('ENDSEC')
    return this
  }

  startTable(name: string) {
    this.writeStart('TABLE')
    this.writeString(2, name)
    return this
  }

  endTable() {
    this.writeStart('ENDTAB')
    return this
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private assertWriteMode() {
    if (this._mode !== 'write') {
      throw new Error('AcDbDxfFiler is in read mode')
    }
  }

  private appendBinary(bytes: Uint8Array) {
    this._binaryChunks.push(bytes)
    this._binaryLength += bytes.length
  }

  private writeBinaryCode(code: number) {
    const truncated = Math.trunc(code) & 0xffff
    // AC1009 binary DXF uses 1-byte codes with 0xFF escape for codes > 255.
    const legacyR12 = !this.capabilities.supportsSubclassMarkers
    if (legacyR12) {
      if (truncated <= 0xff) {
        this.appendBinary(Uint8Array.of(truncated))
      } else {
        this.appendBinary(
          Uint8Array.of(0xff, truncated & 0xff, (truncated >> 8) & 0xff)
        )
      }
      return
    }
    const buf = new Uint8Array(2)
    new DataView(buf.buffer).setUint16(0, truncated, true)
    this.appendBinary(buf)
  }

  private writeBinaryGroup(code: number, value: unknown) {
    const type = acdbDxfValueType(Math.trunc(code))
    this.writeBinaryCode(Math.trunc(code))

    switch (type) {
      case 'string':
      case 'handle': {
        const text =
          typeof value === 'string'
            ? this.sanitizeStringForDxfLine(value)
            : this.formatValue(value)
        const encoded = new TextEncoder().encode(text === '' ? '0' : text)
        const withNul = new Uint8Array(encoded.length + 1)
        withNul.set(encoded)
        withNul[encoded.length] = 0
        this.appendBinary(withNul)
        break
      }
      case 'int': {
        const n = Math.trunc(Number(value)) || 0
        if (acdbDxfIsInt32Code(Math.trunc(code))) {
          const buf = new Uint8Array(4)
          new DataView(buf.buffer).setInt32(0, n, true)
          this.appendBinary(buf)
        } else {
          const buf = new Uint8Array(2)
          new DataView(buf.buffer).setInt16(0, n, true)
          this.appendBinary(buf)
        }
        break
      }
      case 'long': {
        const buf = new Uint8Array(8)
        const view = new DataView(buf.buffer)
        if (typeof value === 'bigint') {
          view.setBigInt64(0, value, true)
        } else {
          view.setBigInt64(0, BigInt(Math.trunc(Number(value)) || 0), true)
        }
        this.appendBinary(buf)
        break
      }
      case 'double': {
        const buf = new Uint8Array(8)
        const n = Number(value)
        new DataView(buf.buffer).setFloat64(0, Number.isFinite(n) ? n : 0, true)
        this.appendBinary(buf)
        break
      }
      case 'bool': {
        const b =
          typeof value === 'boolean'
            ? value
            : Number(value) !== 0 && value !== '' && value != null
        this.appendBinary(Uint8Array.of(b ? 1 : 0))
        break
      }
      case 'binary': {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(0)
        const length = Math.min(255, bytes.length)
        const chunk = new Uint8Array(1 + length)
        chunk[0] = length
        chunk.set(bytes.subarray(0, length), 1)
        this.appendBinary(chunk)
        break
      }
      default: {
        const text = this.formatValue(value)
        const encoded = new TextEncoder().encode(text === '' ? '0' : text)
        const withNul = new Uint8Array(encoded.length + 1)
        withNul.set(encoded)
        withNul[encoded.length] = 0
        this.appendBinary(withNul)
        break
      }
    }
    return this
  }

  private assertReadMode() {
    if (this._mode !== 'read' || !this._reader) {
      throw new Error('AcDbDxfFiler is not in read mode')
    }
  }

  private peekPair(): AcDbDxfPair | undefined {
    this.assertReadMode()
    if (this._pushed.length > 0) {
      return this._pushed[this._pushed.length - 1]
    }
    return this._reader!.peek()
  }

  private readPair(): AcDbDxfPair | undefined {
    this.assertReadMode()
    if (this._pushed.length > 0) {
      const p = this._pushed.pop()!
      this._lastRead = p
      return p
    }
    const p = this._reader!.next()
    this._lastRead = p
    return p
  }

  private pushBackPair(pair: AcDbDxfPair) {
    this._pushed.push(pair)
  }

  private readNumber(expectedCode?: number): number | undefined {
    const pair = this.readPair()
    if (!pair) return undefined
    if (expectedCode != null && pair.code !== expectedCode) {
      this.pushBackPair(pair)
      this.setError(
        AcDbDxfFilerStatus.InvalidDxfCode,
        `Expected group code ${expectedCode}, got ${pair.code}`
      )
      return undefined
    }
    if (pair.type === 'double' || pair.type === 'int' || pair.type === 'long') {
      const v = pair.value
      return typeof v === 'bigint' ? Number(v) : v
    }
    if (pair.type === 'bool') return pair.value ? 1 : 0
    const n = Number(pair.value)
    return Number.isFinite(n) ? n : 0
  }

  private pairToTypedValue(pair: AcDbDxfPair): AcDbTypedValue {
    return { code: pair.code, value: pair.value }
  }

  private typedValueToPair(item: AcDbTypedValue): AcDbDxfPair {
    const code = Number(item.code)
    const value = item.value
    if (typeof value === 'boolean') return { code, type: 'bool', value }
    if (typeof value === 'number') {
      // Prefer double for floats; int for integers — callers rarely push back
      // typed values, so double is a safe default for numbers.
      if (Number.isInteger(value)) return { code, type: 'int', value }
      return { code, type: 'double', value }
    }
    if (typeof value === 'bigint') return { code, type: 'long', value }
    if (value instanceof Uint8Array) return { code, type: 'binary', value }
    return { code, type: 'string', value: String(value ?? '') }
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      // ASCII DXF: one value must occupy a single line. Raw CR/LF inside a value
      // breaks the code/value sequence and strict readers (e.g. AutoCAD) report corruption.
      return this.sanitizeStringForDxfLine(value)
    }
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return '0'
      if (Number.isInteger(value)) return String(value)
      const fixed = value.toFixed(this._precision)
      const trimmed = fixed.replace(/\.?0+$/, '')
      // e.g. 1e-12 with precision 6 -> "0.000000" -> trimmed "" — must not write blank value line
      if (trimmed === '' || trimmed === '-') return '0'
      return trimmed
    }
    if (value instanceof Uint8Array) {
      return acdbBytesToHex(value)
    }
    return String(value)
  }

  /** Removes characters that must not appear on a single DXF value line. */
  private sanitizeStringForDxfLine(s: string): string {
    return (
      s
        .replace(/\r\n|\r|\n/g, ' ')
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    )
  }
}

function acdbBytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0').toUpperCase()
  }
  return out
}

function acdbHexToBytes(hex: string): Uint8Array {
  const trimmed = hex.replace(/\s+/g, '')
  const byteLength = trimmed.length >>> 1
  const bytes = new Uint8Array(byteLength)
  for (let j = 0; j < byteLength; j++) {
    bytes[j] = Number.parseInt(trimmed.slice(j * 2, j * 2 + 2), 16) || 0
  }
  return bytes
}

/** Coerce common binary payloads into bytes for group 1004 / similar. */
function acdbCoerceBinaryBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const view = value as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  if (typeof value === 'string') {
    const trimmed = value.replace(/\s+/g, '')
    if (trimmed.length === 0) return new Uint8Array(0)
    // Accept only hex; other strings would produce invalid DXF binary data.
    if (!/^[0-9A-Fa-f]*$/.test(trimmed) || trimmed.length % 2 !== 0) {
      return undefined
    }
    return acdbHexToBytes(trimmed)
  }
  if (
    Array.isArray(value) &&
    value.every(
      n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 255
    )
  ) {
    return Uint8Array.from(value as number[])
  }
  return undefined
}

/**
 * Coerce a ResultBuffer-style 3D point (object or `[x,y,z]`) for XData codes
 * 1010–1013. Plain numbers are left alone (already expanded DXF pairs).
 */
function acdbCoercePoint3d(value: unknown): AcGePoint3dLike | undefined {
  if (value == null || typeof value === 'number' || typeof value === 'string') {
    return undefined
  }
  if (
    typeof value === 'object' &&
    'x' in value &&
    'y' in value &&
    typeof (value as AcGePoint3dLike).x === 'number' &&
    typeof (value as AcGePoint3dLike).y === 'number'
  ) {
    const p = value as AcGePoint3dLike
    return { x: p.x, y: p.y, z: p.z ?? 0 }
  }
  if (
    Array.isArray(value) &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    return {
      x: value[0],
      y: value[1],
      z: typeof value[2] === 'number' ? value[2] : 0
    }
  }
  return undefined
}

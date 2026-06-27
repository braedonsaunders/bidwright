/**
 * Little-endian binary readers for AutoCAD proxy-entity graphics.
 *
 * Proxy-entity graphics combine aligned byte records and DWG-style bit-packed
 * fields. These stream helpers decode both representations and are based on the
 * format documented by ODA and implemented in ezdxf's `ProxyGraphic`.
 */

/**
 * Error thrown when a proxy-graphic reader reaches the end of its buffer
 * unexpectedly or cannot locate a required terminator.
 */
export class AcDbProxyGraphicEndOfBufferError extends Error {
  /**
   * Creates a new end-of-buffer error.
   *
   * @param message - Human-readable error description.
   */
  constructor(message = 'Unexpected end of buffer.') {
    super(message)
    this.name = 'AcDbProxyGraphicEndOfBufferError'
  }
}

/** Supported input buffer types for proxy-graphic stream readers. */
type Bytes = Uint8Array | ArrayBuffer

/**
 * Normalizes an {@link ArrayBuffer} or {@link Uint8Array} to a byte view.
 *
 * @param buffer - Source buffer.
 * @returns A {@link Uint8Array} view over the input bytes.
 */
function toBufferView(buffer: Bytes): Uint8Array {
  return buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
}

/**
 * Sequential little-endian byte reader for aligned proxy-graphic records.
 *
 * Reads fixed-size numeric fields and null-terminated strings from a chunk
 * payload. After each multi-byte read the cursor is advanced to the next
 * 4-byte-aligned offset, matching the ODA proxy-graphic layout.
 */
export class AcDbProxyGraphicByteStream {
  /** Backing byte buffer. */
  private readonly _buffer: Uint8Array

  /** Current read cursor in bytes. */
  private _index = 0

  /** Alignment boundary applied after each struct read. */
  private readonly _align: number

  /**
   * Creates a byte stream over the given buffer.
   *
   * @param buffer - Chunk payload bytes.
   * @param align - Alignment size in bytes. Defaults to `4`.
   */
  constructor(buffer: Bytes, align = 4) {
    this._buffer = toBufferView(buffer)
    this._align = align
  }

  /**
   * Gets the current read cursor in bytes.
   */
  get index() {
    return this._index
  }

  /**
   * Indicates whether unread bytes remain in the buffer.
   */
  get hasData() {
    return this._index < this._buffer.length
  }

  /**
   * Rounds a byte index up to the configured alignment boundary.
   *
   * @param index - Raw byte index.
   * @returns The aligned index.
   */
  private alignIndex(index: number) {
    const modulo = index % this._align
    return modulo ? index + this._align - modulo : index
  }

  /**
   * Reads a composite struct of little-endian numeric fields.
   *
   * Supported field sizes are `4` (uint32) and `8` (float64).
   *
   * @typeParam T - Tuple type describing the returned numeric array.
   * @param sizes - Byte width of each field in order.
   * @returns The decoded numeric values.
   * @throws {@link AcDbProxyGraphicEndOfBufferError} When the buffer ends
   *   before the struct can be read.
   * @throws {Error} When an unsupported field size is requested.
   */
  readStruct<T extends number[]>(sizes: number[]): T {
    if (!this.hasData) {
      throw new AcDbProxyGraphicEndOfBufferError()
    }
    const values: number[] = []
    let byteSize = 0
    for (const size of sizes) {
      const view = new DataView(
        this._buffer.buffer,
        this._buffer.byteOffset + this._index + byteSize,
        size
      )
      if (size === 8) {
        values.push(view.getFloat64(0, true))
      } else if (size === 4) {
        values.push(view.getUint32(0, true))
      } else {
        throw new Error(`Unsupported struct size: ${size}`)
      }
      byteSize += size
    }
    this._index = this.alignIndex(this._index + byteSize)
    return values as T
  }

  /**
   * Reads one little-endian 64-bit floating-point value.
   *
   * @returns The decoded double.
   */
  readFloat() {
    return this.readStruct<[number]>([8])[0]
  }

  /**
   * Reads one little-endian 32-bit unsigned integer.
   *
   * @returns The decoded unsigned long.
   */
  readLong() {
    return this.readStruct<[number]>([4])[0]
  }

  /**
   * Reads one little-endian 32-bit signed integer.
   *
   * @returns The decoded signed long.
   * @throws {@link AcDbProxyGraphicEndOfBufferError} When the buffer ends
   *   before four bytes are available.
   */
  readSignedLong() {
    if (!this.hasData) {
      throw new AcDbProxyGraphicEndOfBufferError()
    }
    const view = new DataView(
      this._buffer.buffer,
      this._buffer.byteOffset + this._index,
      4
    )
    const value = view.getInt32(0, true)
    this._index = this.alignIndex(this._index + 4)
    return value
  }

  /**
   * Reads one 3D vertex as three little-endian doubles `(x, y, z)`.
   *
   * @returns The decoded vertex tuple in WCS order.
   */
  readVertex(): [number, number, number] {
    return this.readStruct<[number, number, number]>([8, 8, 8])
  }

  /**
   * Reads a null-terminated single-byte string and advances to the next
   * aligned offset.
   *
   * @param encoding - TextDecoder label for the string bytes. Defaults to
   *   `'utf-8'`.
   * @returns The decoded string without the terminating zero byte.
   * @throws {@link AcDbProxyGraphicEndOfBufferError} When no zero terminator
   *   is found.
   */
  readPaddedString(encoding = 'utf-8') {
    const buffer = this._buffer
    for (let endIndex = this._index; endIndex < buffer.length; endIndex++) {
      if (buffer[endIndex] === 0) {
        const startIndex = this._index
        this._index = this.alignIndex(endIndex + 1)
        const slice = buffer.subarray(startIndex, endIndex)
        return new TextDecoder(encoding).decode(slice)
      }
    }
    throw new AcDbProxyGraphicEndOfBufferError(
      'Did not detect terminating zero byte.'
    )
  }

  /**
   * Reads a null-terminated UTF-16LE string and advances to the next aligned
   * offset.
   *
   * @returns The decoded Unicode string without the terminating `0x0000`
   *   code unit pair.
   * @throws {@link AcDbProxyGraphicEndOfBufferError} When no zero terminator
   *   is found.
   */
  readPaddedUnicodeString() {
    const buffer = this._buffer
    for (let endIndex = this._index; endIndex < buffer.length; endIndex += 2) {
      if (
        endIndex + 1 < buffer.length &&
        buffer[endIndex] === 0 &&
        buffer[endIndex + 1] === 0
      ) {
        const startIndex = this._index
        this._index = this.alignIndex(endIndex + 2)
        const slice = buffer.subarray(startIndex, endIndex)
        return new TextDecoder('utf-16le').decode(slice)
      }
    }
    throw new AcDbProxyGraphicEndOfBufferError(
      'Did not detect terminating zero bytes.'
    )
  }
}

/**
 * DWG-style bit-stream reader for compact proxy-graphic payloads.
 *
 * Implements the AutoCAD bit-packing scheme used by lightweight polyline and
 * other compressed proxy-graphic records, including optional default-value
 * doubles and version-dependent fields.
 */
export class AcDbProxyGraphicBitStream {
  /** Backing byte buffer. */
  private readonly _buffer: Uint8Array

  /** Current read cursor in bits. */
  private _bitIndex = 0

  /**
   * Drawing version string used to gate version-specific fields.
   *
   * Example: `'AC1015'`, `'AC1024'`.
   */
  readonly dxfversion: string

  /**
   * Character encoding used when reading embedded single-byte text.
   *
   * Example: `'cp1252'`, `'utf-8'`.
   */
  readonly encoding: string

  /**
   * Creates a bit stream over the given buffer.
   *
   * @param buffer - Chunk payload bytes.
   * @param dxfversion - Drawing version string. Defaults to `'AC1015'`.
   * @param encoding - Single-byte text encoding. Defaults to `'cp1252'`.
   */
  constructor(buffer: Bytes, dxfversion = 'AC1015', encoding = 'cp1252') {
    this._buffer = toBufferView(buffer)
    this.dxfversion = dxfversion
    this.encoding = encoding
  }

  /**
   * Indicates whether unread bits remain in the buffer.
   */
  get hasData() {
    return this._bitIndex >> 3 < this._buffer.length
  }

  /**
   * Reads a single bit from the stream.
   *
   * @returns `1` when the bit is set, otherwise `0`.
   * @throws {@link AcDbProxyGraphicEndOfBufferError} When no byte is available.
   */
  readBit() {
    const index = this._bitIndex
    this._bitIndex += 1
    const byteIndex = index >> 3
    if (byteIndex >= this._buffer.length) {
      throw new AcDbProxyGraphicEndOfBufferError()
    }
    return this._buffer[byteIndex] & (0x80 >> (index & 7)) ? 1 : 0
  }

  /**
   * Reads the next `count` bits as an unsigned integer, MSB first within the
   * field.
   *
   * @param count - Number of bits to read.
   * @returns The assembled unsigned value.
   * @throws {@link AcDbProxyGraphicEndOfBufferError} When the read would pass
   *   the end of the buffer.
   */
  readBits(count: number) {
    const index = this._bitIndex
    const nextBitIndex = index + count
    if ((nextBitIndex - 1) >> 3 >= this._buffer.length) {
      throw new AcDbProxyGraphicEndOfBufferError()
    }
    this._bitIndex = nextBitIndex

    let testBit = 0x80 >> (index & 7)
    let testByteIndex = index >> 3
    let value = 0
    let testByte = this._buffer[testByteIndex]
    while (count > 0) {
      value <<= 1
      if (testByte & testBit) {
        value |= 1
      }
      count -= 1
      testBit >>= 1
      if (!testBit && count) {
        testBit = 0x80
        testByteIndex += 1
        testByte = this._buffer[testByteIndex]
      }
    }
    return value
  }

  /**
   * Reads one unsigned 8-bit value from the bit stream.
   *
   * @returns The decoded byte in the range `0..255`.
   */
  readUnsignedByte() {
    return this.readBits(8)
  }

  /**
   * Reads one signed 8-bit value from the bit stream.
   *
   * @returns The decoded signed byte.
   */
  readSignedByte() {
    const value = this.readBits(8)
    return value & 0x80 ? -((~value & 0xff) + 1) : value
  }

  /**
   * Reads `count` whole bytes from the stream, aligning the bit cursor first
   * when currently mid-byte.
   *
   * @param count - Number of bytes to read.
   * @returns A subarray view over the consumed bytes.
   * @throws {@link AcDbProxyGraphicEndOfBufferError} When the read would pass
   *   the end of the buffer.
   */
  readAlignedBytes(count: number) {
    const startIndex = this._bitIndex >> 3
    const endIndex = startIndex + count
    if (endIndex > this._buffer.length) {
      throw new AcDbProxyGraphicEndOfBufferError()
    }
    this._bitIndex += count << 3
    return this._buffer.subarray(startIndex, endIndex)
  }

  /**
   * Reads one little-endian unsigned 16-bit integer.
   *
   * @returns The decoded unsigned short.
   */
  readUnsignedShort() {
    if (this._bitIndex & 7) {
      const s1 = this.readBits(8)
      const s2 = this.readBits(8)
      return (s2 << 8) + s1
    }
    const bytes = this.readAlignedBytes(2)
    return (bytes[1] << 8) | bytes[0]
  }

  /**
   * Reads one little-endian signed 16-bit integer.
   *
   * @returns The decoded signed short.
   */
  readSignedShort() {
    const value = this.readUnsignedShort()
    return value & 0x8000 ? -((~value & 0xffff) + 1) : value
  }

  /**
   * Reads one little-endian unsigned 32-bit integer.
   *
   * @returns The decoded unsigned long.
   */
  readUnsignedLong() {
    if (this._bitIndex & 7) {
      const l1 = this.readBits(8)
      const l2 = this.readBits(8)
      const l3 = this.readBits(8)
      const l4 = this.readBits(8)
      return (l4 << 24) + (l3 << 16) + (l2 << 8) + l1
    }
    const bytes = this.readAlignedBytes(4)
    return (bytes[3] << 24) + (bytes[2] << 16) + (bytes[1] << 8) + bytes[0]
  }

  /**
   * Reads one little-endian signed 32-bit integer.
   *
   * @returns The decoded signed long.
   */
  readSignedLong() {
    const value = this.readUnsignedLong()
    return value & 0x80000000 ? -((~value & 0xffffffff) + 1) : value
  }

  /**
   * Reads one little-endian 64-bit floating-point value.
   *
   * @returns The decoded double.
   */
  readFloat() {
    if (this._bitIndex & 7) {
      const data = new Uint8Array(8)
      for (let i = 0; i < 8; i++) {
        data[i] = this.readBits(8)
      }
      return new DataView(data.buffer).getFloat64(0, true)
    }
    const bytes = this.readAlignedBytes(8)
    const copy = new Uint8Array(bytes)
    return new DataView(copy.buffer).getFloat64(0, true)
  }

  /**
   * Reads one or more raw little-endian doubles without bit-short compression.
   *
   * @param count - Number of doubles to read. Defaults to `1`.
   * @returns A single number when `count === 1`, otherwise an array of doubles.
   */
  readRawDouble(count = 1): number | number[] {
    if (count === 1) {
      return this.readFloat()
    }
    return Array.from({ length: count }, () => this.readFloat())
  }

  /**
   * Reads one or more DWG **bit-short** values.
   *
   * The 2-bit prefix selects between a full short, a single byte, zero, or the
   * sentinel value `256`.
   *
   * @param count - Number of values to read. Defaults to `1`.
   * @returns A single value or an array of values.
   */
  readBitShort(count = 1): number | number[] {
    const readOne = () => {
      const bits = this.readBits(2)
      if (bits === 0) return this.readSignedShort()
      if (bits === 1) return this.readUnsignedByte()
      if (bits === 2) return 0
      return 256
    }
    if (count === 1) return readOne()
    return Array.from({ length: count }, () => readOne())
  }

  /**
   * Reads one or more DWG **bit-long** values.
   *
   * @param count - Number of values to read. Defaults to `1`.
   * @returns A single value or an array of values.
   */
  readBitLong(count = 1): number | number[] {
    const readOne = () => {
      const bits = this.readBits(2)
      if (bits === 0) return this.readSignedLong()
      if (bits === 1) return this.readUnsignedByte()
      if (bits === 2) return 0
      return 256
    }
    if (count === 1) return readOne()
    return Array.from({ length: count }, () => readOne())
  }

  /**
   * Reads one or more DWG **bit-double** values.
   *
   * @param count - Number of values to read. Defaults to `1`.
   * @returns A single value or an array of values.
   */
  readBitDouble(count = 1): number | number[] {
    const readOne = () => {
      const bits = this.readBits(2)
      if (bits === 0) return this.readFloat()
      if (bits === 1) return 1
      if (bits === 2) return 0
      return 0
    }
    if (count === 1) return readOne()
    return Array.from({ length: count }, () => readOne())
  }

  /**
   * Reads one or more DWG **default bit-double** values.
   *
   * When the prefix indicates "default", `defaultValue` is returned unchanged.
   * Otherwise a partial or full double is reconstructed from the stream.
   *
   * @param count - Number of values to read. Defaults to `1`.
   * @param defaultValue - Fallback double used for default-encoded values.
   * @returns A single value or an array of values.
   */
  readBitDoubleDefault(count = 1, defaultValue = 0): number | number[] {
    const defaultBytes = new Uint8Array(8)
    new DataView(defaultBytes.buffer).setFloat64(0, defaultValue, true)

    const readOne = () => {
      const bits = this.readBits(2)
      if (bits === 0) return defaultValue
      if (bits === 1) {
        const data = new Uint8Array(defaultBytes)
        data[0] = this.readUnsignedByte()
        data[1] = this.readUnsignedByte()
        data[2] = this.readUnsignedByte()
        data[3] = this.readUnsignedByte()
        return new DataView(data.buffer).getFloat64(0, true)
      }
      if (bits === 2) {
        const data = new Uint8Array(defaultBytes)
        data[4] = this.readUnsignedByte()
        data[5] = this.readUnsignedByte()
        data[0] = this.readUnsignedByte()
        data[1] = this.readUnsignedByte()
        data[2] = this.readUnsignedByte()
        data[3] = this.readUnsignedByte()
        return new DataView(data.buffer).getFloat64(0, true)
      }
      return this.readFloat()
    }

    if (count === 1) return readOne()
    return Array.from({ length: count }, () => readOne())
  }
}

/**
 * Converts a byte array to an upper-case hexadecimal string.
 *
 * Used when writing proxy graphics to DXF group code **310** chunks.
 *
 * @param data - Bytes to encode.
 * @returns A contiguous hex string with two digits per byte.
 */
export function bytesToHexString(data: Uint8Array): string {
  return Array.from(data, byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Decodes one or more hexadecimal strings into a single byte array.
 *
 * Non-hex characters are not filtered; each pair of characters is parsed with
 * `parseInt(..., 16)`.
 *
 * @param chunks - Hex strings, typically from DXF group code **310**.
 * @returns Concatenated decoded bytes.
 */
export function hexStringsToBytes(chunks: string[]): Uint8Array {
  const totalLength = chunks.reduce(
    (sum, chunk) => sum + Math.floor(chunk.length / 2),
    0
  )
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 2) {
      result[offset++] = parseInt(chunk.slice(i, i + 2), 16)
    }
  }
  return result
}

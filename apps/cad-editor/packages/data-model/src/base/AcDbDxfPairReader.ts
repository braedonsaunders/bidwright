import { AcDbDwgVersion } from '../database/AcDbDwgVersion'
import {
  AcDbCodePage,
  acdbDwgCodePageToEncoding,
  acdbNormalizeTextEncoding
} from '../misc/AcDbCodePage'
import {
  acdbDxfIsInt32Code,
  acdbDxfValueType
} from './AcDbDxfGroupCodeTypes'
import type { AcDbDxfPair } from './AcDbDxfPair'

/** Magic prefix for AutoCAD Binary DXF files (22 bytes). */
const BINARY_DXF_MAGIC = (() => {
  const prefix = 'AutoCAD Binary DXF\r\n'
  const bytes = new Uint8Array(22)
  for (let i = 0; i < prefix.length; i++) bytes[i] = prefix.charCodeAt(i)
  bytes[20] = 0x1a
  bytes[21] = 0x00
  return bytes
})()

const UTF8_DECODER = new TextDecoder('utf-8')

const HEX_NIBBLE: Int8Array = (() => {
  const t = new Int8Array(128)
  for (let i = 0; i < 10; i++) t[0x30 + i] = i
  for (let i = 0; i < 6; i++) {
    t[0x41 + i] = 10 + i
    t[0x61 + i] = 10 + i
  }
  return t
})()

/**
 * Stream of typed DXF group-code/value pairs.
 *
 * Comment pairs (code 999) are filtered — neither `peek` nor `next` returns them.
 * Implementations must not materialize the whole file as a `string[]` of lines.
 */
export interface AcDbDxfPairReader {
  readonly kind: 'ascii' | 'binary'
  next(): AcDbDxfPair | undefined
  peek(): AcDbDxfPair | undefined
  position(): { line?: number; byteOffset: number }
}

export interface AcDbDxfHeaderInfo {
  version: AcDbDwgVersion | null
  encoding: string | null
}

export function acdbIsBinaryDxf(data: Uint8Array): boolean {
  if (data.length < BINARY_DXF_MAGIC.length) return false
  for (let i = 0; i < BINARY_DXF_MAGIC.length; i++) {
    if (data[i] !== BINARY_DXF_MAGIC[i]) return false
  }
  return true
}

/** ASCII whitespace used around DXF numeric fields (String.trim's ASCII set). */
function acdbIsAsciiWhitespace(c: number): boolean {
  return c === 0x20 || (c >= 0x09 && c <= 0x0d)
}

/** True for every character `String.prototype.trim` strips. */
function acdbIsTrimWhitespace(c: number): boolean {
  return (
    acdbIsAsciiWhitespace(c) ||
    c === 0xa0 ||
    c === 0x1680 ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff ||
    (c >= 0x2000 && c <= 0x200a)
  )
}

/**
 * Decodes a pure-ASCII byte span without constructing a `TextDecoder` call or
 * an intermediate `Uint8Array` copy. DXF keywords, handles and numeric text
 * are overwhelmingly ASCII.
 */
function acdbDecodeAsciiSpan(
  bytes: Uint8Array,
  start: number,
  end: number
): string {
  const length = end - start
  if (length <= 0) return ''
  if (length <= 16) {
    let text = ''
    for (let i = start; i < end; i++) text += String.fromCharCode(bytes[i])
    return text
  }
  const CHUNK = 4096
  let text = ''
  for (let pos = start; pos < end; pos += CHUNK) {
    const chunkEnd = Math.min(pos + CHUNK, end)
    text += String.fromCharCode.apply(
      null,
      bytes.subarray(pos, chunkEnd) as unknown as number[]
    )
  }
  return text
}

/**
 * Decodes a UTF-8 byte span, taking the ASCII fast path when possible.
 *
 * `nonAscii` must be true exactly when the span holds a byte `>= 0x80`. It is
 * produced by the line scanner, so this function never re-scans the span.
 */
function acdbDecodeUtf8Span(
  bytes: Uint8Array,
  start: number,
  end: number,
  nonAscii: boolean
): string {
  if (!nonAscii) {
    return acdbDecodeAsciiSpan(bytes, start, end)
  }
  return UTF8_DECODER.decode(bytes.subarray(start, end))
}

/**
 * Parses an integer group code straight from the bytes of a code line,
 * without allocating the line string or a trimmed copy.
 *
 * Returns NaN for blank or malformed code lines. DXF group code lines are
 * pure ASCII; the rare non-ASCII line falls back to `Number` + `isFinite`.
 */
function acdbReadDxfCodeFromBytes(
  bytes: Uint8Array,
  start: number,
  end: number,
  nonAscii: boolean
): number {
  if (nonAscii) {
    const n = Number(acdbDecodeUtf8Span(bytes, start, end, true).trim())
    return Number.isFinite(n) ? n : NaN
  }

  let i = start
  while (i < end && acdbIsAsciiWhitespace(bytes[i])) i++
  if (i >= end) return NaN

  let sign = 1
  const c0 = bytes[i]
  if (c0 === 0x2d) {
    sign = -1
    i++
  } else if (c0 === 0x2b) {
    i++
  }

  let value = 0
  let digits = 0
  while (i < end) {
    const c = bytes[i]
    if (c >= 0x30 && c <= 0x39) {
      value = value * 10 + (c - 0x30)
      digits++
      i++
    } else {
      break
    }
  }
  if (digits === 0) return NaN

  while (i < end) {
    if (!acdbIsAsciiWhitespace(bytes[i])) return NaN
    i++
  }
  return sign * value
}

/**
 * Largest integer mantissa for which one more accumulation step is still exact
 * as a double: below (2^53 - 9) / 10 we always stay representable.
 */
const MAX_EXACT_DOUBLE_MANTISSA = (Number.MAX_SAFE_INTEGER - 9) / 10

/**
 * Fast path for double value lines: parses `[+-]?digits[.digits][eE[+-]digits]`
 * straight from the byte span, without slicing the line or calling `Number()`.
 * Returns undefined outside its exact domain (caller falls back).
 */
function acdbParseDoubleSpan(
  bytes: Uint8Array,
  start: number,
  end: number
): number | undefined {
  let i = start
  while (i < end && acdbIsAsciiWhitespace(bytes[i])) i++
  if (i >= end) return 0

  let sign = 1
  const c0 = bytes[i]
  if (c0 === 0x2d) {
    sign = -1
    i++
  } else if (c0 === 0x2b) {
    i++
  }

  let mantissa = 0
  let exp10 = 0
  let anyDigit = false
  let tooLong = false

  while (i < end) {
    const c = bytes[i]
    if (c < 0x30 || c > 0x39) break
    anyDigit = true
    i++
    if (mantissa === 0 && c === 0x30) continue
    if (mantissa > MAX_EXACT_DOUBLE_MANTISSA) {
      tooLong = true
      continue
    }
    mantissa = mantissa * 10 + (c - 0x30)
  }

  if (i < end && bytes[i] === 0x2e) {
    i++
    while (i < end) {
      const c = bytes[i]
      if (c < 0x30 || c > 0x39) break
      anyDigit = true
      i++
      if (mantissa === 0 && c === 0x30) {
        exp10--
        continue
      }
      if (mantissa > MAX_EXACT_DOUBLE_MANTISSA) {
        tooLong = true
        continue
      }
      mantissa = mantissa * 10 + (c - 0x30)
      exp10--
    }
  }

  if (i < end && (bytes[i] === 0x65 || bytes[i] === 0x45)) {
    i++
    let expSign = 1
    const sc = bytes[i]
    if (sc === 0x2d) {
      expSign = -1
      i++
    } else if (sc === 0x2b) {
      i++
    }
    let expVal = 0
    let expDigits = 0
    while (i < end) {
      const c = bytes[i]
      if (c < 0x30 || c > 0x39) break
      i++
      expDigits++
      if (expVal <= 10000) expVal = expVal * 10 + (c - 0x30)
    }
    if (expDigits === 0) return undefined
    exp10 += expSign * expVal
  }

  while (i < end) {
    if (!acdbIsAsciiWhitespace(bytes[i])) return undefined
    i++
  }

  if (!anyDigit) return 0
  if (tooLong) return undefined
  if (mantissa === 0) return sign * mantissa
  if (exp10 > 22 || exp10 < -22) return undefined

  let scale = 1
  const k = exp10 < 0 ? -exp10 : exp10
  for (let n = 0; n < k; n++) scale *= 10
  return sign * (exp10 < 0 ? mantissa / scale : mantissa * scale)
}

/**
 * Fast path for int value lines with parseInt semantics: skips leading
 * whitespace, takes the longest digit run, ignores the rest. Returns
 * undefined when non-ASCII whitespace may precede the digits or for digit
 * runs longer than 15 (so the caller falls back).
 */
function acdbParseIntSpan(
  bytes: Uint8Array,
  start: number,
  end: number
): number | undefined {
  let i = start
  for (;;) {
    if (i >= end) break
    const c = bytes[i]
    if (c >= 0x80) return undefined
    if (!acdbIsAsciiWhitespace(c)) break
    i++
  }

  let sign = 1
  const c0 = bytes[i]
  if (c0 === 0x2d) {
    sign = -1
    i++
  } else if (c0 === 0x2b) {
    i++
  }
  if (i < end && bytes[i] >= 0x80) return undefined

  let value = 0
  let digits = 0
  let anyDigit = false
  while (i < end) {
    const c = bytes[i]
    if (c < 0x30 || c > 0x39) break
    i++
    anyDigit = true
    if (value === 0 && c === 0x30) continue
    if (digits >= 15) return undefined
    value = value * 10 + (c - 0x30)
    digits++
  }
  return anyDigit ? sign * value : 0
}

/**
 * Fast path for long value lines with Number semantics (whole line must be
 * numeric, unlike parseInt). Returns the integer when it has at most 15
 * significant digits; otherwise undefined (caller falls back to Number/BigInt).
 */
function acdbParseLongSpan(
  bytes: Uint8Array,
  start: number,
  end: number
): number | undefined {
  let i = start
  while (i < end && acdbIsAsciiWhitespace(bytes[i])) i++

  let sign = 1
  const c0 = bytes[i]
  if (c0 === 0x2d) {
    sign = -1
    i++
  } else if (c0 === 0x2b) {
    i++
  }

  let value = 0
  let digits = 0
  let anyDigit = false
  while (i < end) {
    const c = bytes[i]
    if (c < 0x30 || c > 0x39) break
    i++
    anyDigit = true
    if (value === 0 && c === 0x30) continue
    if (digits >= 15) return undefined
    value = value * 10 + (c - 0x30)
    digits++
  }

  while (i < end) {
    if (!acdbIsAsciiWhitespace(bytes[i])) return undefined
    i++
  }
  return anyDigit ? sign * value : 0
}

/**
 * Equivalent to `trimmed !== '' && trimmed !== '0'` without allocating.
 * nonAscii comes from the line scanner; non-ASCII spans bail out so the caller
 * can use the exact String.prototype.trim semantics.
 */
function acdbDxfRawBoolIsTrue(
  bytes: Uint8Array,
  start: number,
  end: number,
  nonAscii: boolean
): boolean | undefined {
  if (nonAscii) return undefined

  while (start < end && acdbIsAsciiWhitespace(bytes[start])) start++
  while (end > start && acdbIsAsciiWhitespace(bytes[end - 1])) end--
  if (start >= end) return false
  return !(end - start === 1 && bytes[start] === 0x30)
}

/**
 * Decodes a hex pair value straight from a character span. Used only as a rare
 * fallback when a binary value line contains non-ASCII bytes.
 */
function acdbDecodeHexBinaryText(
  text: string,
  start: number,
  end: number
): Uint8Array {
  while (start < end && acdbIsTrimWhitespace(text.charCodeAt(start))) start++
  while (end > start && acdbIsTrimWhitespace(text.charCodeAt(end - 1))) end--
  const byteLength = (end - start) >>> 1
  const bytes = new Uint8Array(byteLength)
  for (let j = 0; j < byteLength; j++) {
    const hi = HEX_NIBBLE[text.charCodeAt(start + j * 2) & 0x7f]
    const lo = HEX_NIBBLE[text.charCodeAt(start + j * 2 + 1) & 0x7f]
    bytes[j] = (hi << 4) | lo
  }
  return bytes
}

/**
 * Decodes a code-310 hex line from bytes, trimming ASCII whitespace.
 */
function acdbDecodeHexBinarySpan(
  bytes: Uint8Array,
  start: number,
  end: number,
  nonAscii: boolean
): Uint8Array {
  while (start < end && acdbIsAsciiWhitespace(bytes[start])) start++
  while (end > start && acdbIsAsciiWhitespace(bytes[end - 1])) end--

  if (nonAscii) {
    const text = acdbDecodeUtf8Span(bytes, start, end, true)
    return acdbDecodeHexBinaryText(text, 0, text.length)
  }

  const byteLength = (end - start) >>> 1
  const out = new Uint8Array(byteLength)
  for (let j = 0; j < byteLength; j++) {
    const hi = HEX_NIBBLE[bytes[start + j * 2] & 0x7f]
    const lo = HEX_NIBBLE[bytes[start + j * 2 + 1] & 0x7f]
    out[j] = (hi << 4) | lo
  }
  return out
}

/**
 * Parses one ASCII value line.
 *
 * nonAscii is the flag produced by the line scanner for this exact span; it
 * is forwarded to every decode helper so no helper has to re-scan the bytes.
 */
function parseAsciiValueSpan(
  code: number,
  bytes: Uint8Array,
  start: number,
  end: number,
  nonAscii: boolean
): AcDbDxfPair | null {
  const type = acdbDxfValueType(code)
  if (type === 'comment') return null

  switch (type) {
    case 'string':
      return {
        code,
        type,
        value: acdbDecodeUtf8Span(bytes, start, end, nonAscii)
      }
    case 'int': {
      const fast = acdbParseIntSpan(bytes, start, end)
      const n =
        fast === undefined
          ? parseInt(acdbDecodeUtf8Span(bytes, start, end, nonAscii), 10)
          : fast
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'long': {
      const fast = acdbParseLongSpan(bytes, start, end)
      if (fast !== undefined) return { code, type, value: fast }
      const raw = acdbDecodeUtf8Span(bytes, start, end, nonAscii)
      const n = Number(raw)
      if (Number.isSafeInteger(n)) return { code, type, value: n }
      try {
        return { code, type, value: BigInt(raw.trim()) }
      } catch {
        return { code, type, value: 0 }
      }
    }
    case 'double': {
      const fast = acdbParseDoubleSpan(bytes, start, end)
      const n =
        fast === undefined
          ? Number(acdbDecodeUtf8Span(bytes, start, end, nonAscii))
          : fast
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'bool': {
      const fast = acdbDxfRawBoolIsTrue(bytes, start, end, nonAscii)
      if (fast !== undefined) return { code, type, value: fast }
      const trimmed = acdbDecodeUtf8Span(bytes, start, end, nonAscii).trim()
      return { code, type, value: trimmed !== '' && trimmed !== '0' }
    }
    case 'handle': {
      const value = acdbDecodeUtf8Span(bytes, start, end, nonAscii)
      if (value.length === 0) return { code, type, value }
      const first = value.charCodeAt(0)
      const last = value.charCodeAt(value.length - 1)
      if (!acdbIsTrimWhitespace(first) && !acdbIsTrimWhitespace(last)) {
        return { code, type, value }
      }
      return { code, type, value: value.trim() }
    }
    case 'binary':
      return {
        code,
        type,
        value: acdbDecodeHexBinarySpan(bytes, start, end, nonAscii)
      }
    default:
      return null
  }
}

/**
 * ASCII/UTF-8 pair reader over raw bytes.
 *
 * Line breaks are single bytes and UTF-8 continuation bytes never equal
 * 0x0A/0x0D, so non-ASCII text values never straddle line boundaries.
 */
function acdbMakeUtf8DxfPairReader(bytes: Uint8Array): AcDbDxfPairReader {
  let pos =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
      ? 3
      : 0
  let lineNumber = 1
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false

  /**
   * Advances past one line and returns its content byte range.
   *
   * The scan also ORs every content byte, so nonAscii ("this line holds a
   * byte >= 0x80") comes for free and the value/code parsers never have to walk
   * the line a second time.
   */
  function readLineSpan():
    | { start: number; end: number; nonAscii: boolean }
    | undefined {
    if (pos >= bytes.length) return undefined
    const start = pos
    let contentEnd = pos
    let flags = 0
    while (contentEnd < bytes.length) {
      const c = bytes[contentEnd]
      if (c === 0x0a || c === 0x0d) break
      flags |= c
      contentEnd++
    }
    let end = contentEnd
    if (end < bytes.length && bytes[end] === 0x0d) end++
    if (end < bytes.length && bytes[end] === 0x0a) end++
    pos = end
    lineNumber++
    return { start, end: contentEnd, nonAscii: flags >= 0x80 }
  }

  function readRaw(): AcDbDxfPair | undefined {
    for (;;) {
      const codeSpan = readLineSpan()
      if (codeSpan === undefined) return undefined
      const code = acdbReadDxfCodeFromBytes(
        bytes,
        codeSpan.start,
        codeSpan.end,
        codeSpan.nonAscii
      )
      if (Number.isNaN(code)) continue
      if (code === 999) {
        if (readLineSpan() === undefined) return undefined
        continue
      }

      const valueSpan = readLineSpan()
      if (valueSpan === undefined) return undefined

      const pair = parseAsciiValueSpan(
        code,
        bytes,
        valueSpan.start,
        valueSpan.end,
        valueSpan.nonAscii
      )
      if (pair) return pair
    }
  }

  return {
    kind: 'ascii',
    next() {
      if (lookaheadValid) {
        const pair = lookahead
        lookahead = undefined
        lookaheadValid = false
        return pair
      }
      return readRaw()
    },
    peek() {
      if (!lookaheadValid) {
        lookahead = readRaw()
        lookaheadValid = true
      }
      return lookahead
    },
    position() {
      return { line: lineNumber, byteOffset: pos }
    }
  }
}

/**
 * Peek `$ACADVER` / `$DWGCODEPAGE` from the HEADER section without decoding
 * the whole file. Uses 64 KiB UTF-8 chunks (same strategy as AcDbDxfParser).
 */
export function acdbPeekDxfHeaderInfo(buffer: ArrayBuffer): AcDbDxfHeaderInfo {
  const chunkSize = 64 * 1024
  const decoder = new TextDecoder('utf-8')
  let offset = 0
  let leftover = ''
  let version: AcDbDwgVersion | null = null
  let encoding: string | null = null
  let inHeader = false

  while (offset < buffer.byteLength) {
    const end = Math.min(offset + chunkSize, buffer.byteLength)
    const chunk = buffer.slice(offset, end)
    offset = end

    const text = leftover + decoder.decode(chunk, { stream: true })
    const lines = text.split(/\r?\n/)
    leftover = lines.pop() ?? ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line === 'SECTION' && lines[i + 2]?.trim() === 'HEADER') {
        inHeader = true
      } else if (line === 'ENDSEC' && inHeader) {
        return { version, encoding }
      }

      if (inHeader && line === '$ACADVER') {
        const value = lines[i + 2]?.trim()
        if (value) version = new AcDbDwgVersion(value)
      } else if (inHeader && line === '$DWGCODEPAGE') {
        const value = lines[i + 2]?.trim()
        if (value) {
          const codePage = AcDbCodePage[value as keyof typeof AcDbCodePage]
          encoding = acdbDwgCodePageToEncoding(codePage)
        }
      }

      if (version && encoding) return { version, encoding }
    }
  }

  return { version, encoding }
}

function decodeHexBinary(hex: string): Uint8Array {
  const trimmed = hex.trim()
  const byteLength = trimmed.length >>> 1
  const bytes = new Uint8Array(byteLength)
  for (let j = 0; j < byteLength; j++) {
    const hi = HEX_NIBBLE[trimmed.charCodeAt(j * 2) & 0x7f]!
    const lo = HEX_NIBBLE[trimmed.charCodeAt(j * 2 + 1) & 0x7f]!
    bytes[j] = (hi << 4) | lo
  }
  return bytes
}

function parseAsciiValue(code: number, valueRaw: string): AcDbDxfPair | null {
  const type = acdbDxfValueType(code)
  if (type === 'comment') return null

  switch (type) {
    case 'string':
      return { code, type, value: valueRaw }
    case 'int': {
      const n = parseInt(valueRaw.trim(), 10)
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'long': {
      const trimmed = valueRaw.trim()
      const n = Number(trimmed)
      if (Number.isSafeInteger(n)) return { code, type, value: n }
      try {
        return { code, type, value: BigInt(trimmed) }
      } catch {
        return { code, type, value: 0 }
      }
    }
    case 'double': {
      const n = Number(valueRaw.trim())
      return { code, type, value: Number.isFinite(n) ? n : 0 }
    }
    case 'bool': {
      const t = valueRaw.trim()
      return { code, type, value: t !== '0' && t !== '' }
    }
    case 'handle':
      return { code, type, value: valueRaw.trim() }
    case 'binary':
      return { code, type, value: decodeHexBinary(valueRaw) }
    default:
      return null
  }
}

/**
 * ASCII pair reader over a decoded DXF string.
 *
 * Scans with a character cursor (no full-file `string[]` of lines).
 */
export function acdbMakeAsciiDxfPairReader(text: string): AcDbDxfPairReader {
  let pos = 0
  let lineNumber = 1
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false

  function readLine(): string | undefined {
    if (pos >= text.length) return undefined
    let end = pos
    while (end < text.length) {
      const c = text.charCodeAt(end)
      if (c === 10 || c === 13) break
      end++
    }
    const line = text.slice(pos, end)
    if (end < text.length && text.charCodeAt(end) === 13) end++
    if (end < text.length && text.charCodeAt(end) === 10) end++
    pos = end
    lineNumber++
    return line
  }

  function readRaw(): AcDbDxfPair | undefined {
    for (;;) {
      const codeRaw = readLine()
      if (codeRaw === undefined) return undefined
      const codeTrimmed = codeRaw.trim()
      if (codeTrimmed === '') continue

      const valueRaw = readLine()
      if (valueRaw === undefined) return undefined

      const code = Number(codeTrimmed)
      if (!Number.isFinite(code)) continue
      if (code === 999) continue

      const pair = parseAsciiValue(code, valueRaw)
      if (pair) return pair
    }
  }

  return {
    kind: 'ascii',
    next() {
      if (lookaheadValid) {
        const p = lookahead
        lookahead = undefined
        lookaheadValid = false
        return p
      }
      return readRaw()
    },
    peek() {
      if (!lookaheadValid) {
        lookahead = readRaw()
        lookaheadValid = true
      }
      return lookahead
    },
    position() {
      return { line: lineNumber, byteOffset: pos }
    }
  }
}

function isUtf8Encoding(encoding: string): boolean {
  const e = encoding.toLowerCase().replace(/_/g, '-')
  return e === 'utf-8' || e === 'utf8' || e === 'unicode-1-1-utf-8'
}

/**
 * Bytes decoded per `TextDecoder` call in {@link acdbMakeUtf8AsciiDxfPairReader}.
 *
 * Sized as a compromise: large enough that a multi-MB DXF costs hundreds of
 * decode calls rather than one per line, small enough that windows still holding
 * a retained value slice do not pin much memory.
 */

/**
 * ASCII pair reader that decodes UTF-8 bytes one line-aligned window at a time,
 * instead of allocating a full-file decoded string (peak memory ≈ input bytes
 * plus one window).
 *
 * Non-UTF-8 code pages still go through {@link acdbMakeAsciiDxfPairReader}
 * after a full `TextDecoder` pass.
 */
export function acdbMakeUtf8AsciiDxfPairReader(
  bytes: Uint8Array
): AcDbDxfPairReader {
  return acdbMakeUtf8DxfPairReader(bytes)
}

function safeBigIntToNumber(v: bigint): number | bigint {
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  const min = -max
  if (v >= min && v <= max) return Number(v)
  return v
}

/**
 * Binary DXF pair reader. Skips the 22-byte magic prefix.
 *
 * @param legacyR12 - AC1009 uses 1-byte group codes (0xFF escape for >255).
 */
export function acdbMakeBinaryDxfPairReader(
  data: Uint8Array,
  options: { encoding?: string; legacyR12?: boolean } = {}
): AcDbDxfPairReader {
  const encoding = options.encoding ?? 'utf-8'
  const legacyR12 = options.legacyR12 ?? false
  const PREFIX = 22
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = data.length >= PREFIX ? PREFIX : data.length
  let lookahead: AcDbDxfPair | undefined
  let lookaheadValid = false

  function readCode(): number | undefined {
    if (offset >= data.length) return undefined
    if (legacyR12) {
      const first = data[offset]
      if (first === undefined) return undefined
      if (first === 0xff) {
        if (offset + 3 > data.length) return undefined
        offset += 1
        const lo = data[offset]!
        const hi = data[offset + 1]!
        offset += 2
        return (hi << 8) | lo
      }
      offset += 1
      return first
    }
    if (offset + 2 > data.length) return undefined
    const code = view.getUint16(offset, true)
    offset += 2
    return code
  }

  function readString(): string | undefined {
    const start = offset
    while (offset < data.length && data[offset] !== 0) offset += 1
    if (offset >= data.length) return undefined
    const bytes = data.subarray(start, offset)
    offset += 1
    return new TextDecoder(encoding).decode(bytes)
  }

  function readInt16(): number | undefined {
    if (offset + 2 > data.length) return undefined
    const v = view.getInt16(offset, true)
    offset += 2
    return v
  }

  function readInt32(): number | undefined {
    if (offset + 4 > data.length) return undefined
    const v = view.getInt32(offset, true)
    offset += 4
    return v
  }

  function readInt64(): number | bigint | undefined {
    if (offset + 8 > data.length) return undefined
    const v = view.getBigInt64(offset, true)
    offset += 8
    return safeBigIntToNumber(v)
  }

  function readDouble(): number | undefined {
    if (offset + 8 > data.length) return undefined
    const v = view.getFloat64(offset, true)
    offset += 8
    return v
  }

  function readBool(): boolean | undefined {
    if (offset >= data.length) return undefined
    const v = data[offset]
    if (v === undefined) return undefined
    offset += 1
    return v !== 0
  }

  function readBinaryChunk(): Uint8Array | undefined {
    if (offset >= data.length) return undefined
    const length = data[offset]
    if (length === undefined) return undefined
    offset += 1
    if (offset + length > data.length) return undefined
    const bytes = data.slice(offset, offset + length)
    offset += length
    return bytes
  }

  function readRaw(): AcDbDxfPair | undefined {
    while (offset < data.length) {
      const code = readCode()
      if (code === undefined) return undefined
      if (code === 999) {
        if (readString() === undefined) return undefined
        continue
      }
      const type = acdbDxfValueType(code)
      switch (type) {
        case 'string': {
          const value = readString()
          if (value === undefined) return undefined
          return { code, type: 'string', value }
        }
        case 'int': {
          const v = acdbDxfIsInt32Code(code) ? readInt32() : readInt16()
          if (v === undefined) return undefined
          return { code, type: 'int', value: v }
        }
        case 'long': {
          const v = readInt64()
          if (v === undefined) return undefined
          return { code, type: 'long', value: v }
        }
        case 'double': {
          const v = readDouble()
          if (v === undefined) return undefined
          return { code, type: 'double', value: v }
        }
        case 'bool': {
          const v = readBool()
          if (v === undefined) return undefined
          return { code, type: 'bool', value: v }
        }
        case 'handle': {
          const raw = readString()
          if (raw === undefined) return undefined
          return { code, type: 'handle', value: raw }
        }
        case 'binary': {
          const bytes = readBinaryChunk()
          if (bytes === undefined) return undefined
          return { code, type: 'binary', value: bytes }
        }
        case 'comment':
          continue
        default:
          readString()
          continue
      }
    }
    return undefined
  }

  return {
    kind: 'binary',
    next() {
      if (lookaheadValid) {
        const p = lookahead
        lookahead = undefined
        lookaheadValid = false
        return p
      }
      return readRaw()
    },
    peek() {
      if (!lookaheadValid) {
        lookahead = readRaw()
        lookaheadValid = true
      }
      return lookahead
    },
    position() {
      return { byteOffset: offset }
    }
  }
}

export interface AcDbCreateDxfPairReaderOptions {
  /**
   * Override text encoding for ASCII DXF.
   *
   * When omitted, the encoding is chosen automatically: bytes that validate
   * as UTF-8 decode as UTF-8; otherwise a declared pre-2007 `$DWGCODEPAGE`
   * is honored (see {@link acdbCreateDxfPairReader}). When provided, it wins
   * over detection — use it to force e.g. `'cp949'` for Korean drawings whose
   * header lies. Common non-WHATWG aliases such as `'cp949'` are normalized
   * to a supported `TextDecoder` label (`'euc-kr'`).
   */
  encoding?: string
  /** Force R12 1-byte group codes for binary DXF. */
  legacyR12?: boolean
}

/**
 * Strict UTF-8 validation (rejects stray continuation bytes, overlong forms,
 * surrogate halves and anything beyond U+10FFFF). Used to tell genuine legacy
 * ANSI bytes apart from UTF-8 content hiding behind a stale pre-2007
 * `$DWGCODEPAGE`: real ANSI multi-byte text essentially never forms valid
 * UTF-8 sequences, while UTF-8 content always validates.
 */
function acdbIsValidUtf8(bytes: Uint8Array): boolean {
  const n = bytes.length
  let i = 0
  while (i < n) {
    const b0 = bytes[i]!
    if (b0 < 0x80) {
      i++
      continue
    }
    if (b0 < 0xc2) return false // stray continuation byte or overlong 2-byte lead
    if (b0 < 0xe0) {
      // 2-byte sequence
      if (i + 1 >= n || (bytes[i + 1]! & 0xc0) !== 0x80) return false
      i += 2
      continue
    }
    if (b0 < 0xf0) {
      // 3-byte sequence
      if (i + 2 >= n) return false
      const b1 = bytes[i + 1]!
      if ((b1 & 0xc0) !== 0x80) return false
      if (b0 === 0xe0 && b1 < 0xa0) return false // overlong encoding
      if (b0 === 0xed && b1 >= 0xa0) return false // surrogate half
      if ((bytes[i + 2]! & 0xc0) !== 0x80) return false
      i += 3
      continue
    }
    if (b0 < 0xf5) {
      // 4-byte sequence
      if (i + 3 >= n) return false
      const b1 = bytes[i + 1]!
      if ((b1 & 0xc0) !== 0x80) return false
      if (b0 === 0xf0 && b1 < 0x90) return false // overlong encoding
      if (b0 === 0xf4 && b1 >= 0x90) return false // beyond U+10FFFF
      if ((bytes[i + 2]! & 0xc0) !== 0x80) return false
      if ((bytes[i + 3]! & 0xc0) !== 0x80) return false
      i += 4
      continue
    }
    return false // 0xf5..0xff are never valid lead bytes
  }
  return true
}

/**
 * Create a pair reader from DXF bytes (ASCII or binary).
 *
 * ASCII path encoding strategy (hybrid of byte-trust and header sniffing):
 *
 * 1. An explicit `options.encoding` always wins — the caller asserts the
 *    encoding, no sniffing contradicts it.
 * 2. Otherwise the bytes are strictly validated as UTF-8. Valid UTF-8
 *    (including pure ASCII) decodes correctly regardless of any stale
 *    `$DWGCODEPAGE`, so the header is never consulted — modern files skip
 *    the header pre-scan entirely and stream straight from bytes.
 * 3. Invalid UTF-8 means the file is not a spec-conformant modern DXF. The
 *    HEADER is then peeked for `$ACADVER`/`$DWGCODEPAGE`: pre-2007 drawings
 *    with a declared code page decode through it (matching AutoCAD), while
 *    R2007+ or headerless files fall back to UTF-8 (replacement chars mark
 *    the broken bytes).
 */
export function acdbCreateDxfPairReader(
  data: ArrayBuffer | Uint8Array,
  options: AcDbCreateDxfPairReaderOptions = {}
): AcDbDxfPairReader {
  const bytes =
    data instanceof Uint8Array ? data : new Uint8Array(data)

  const overrideEncoding = options.encoding
    ? acdbNormalizeTextEncoding(options.encoding)
    : undefined

  if (acdbIsBinaryDxf(bytes)) {
    let encoding = overrideEncoding
    let legacyR12 = options.legacyR12
    if (encoding == null || legacyR12 == null) {
      encoding = encoding ?? 'utf-8'
      if (legacyR12 == null) {
        // After the 22-byte magic: R12 uses 1-byte codes (`0,'S'`), modern
        // uses 2-byte LE codes (`0,0,'S'`) for the first SECTION marker.
        const PREFIX = 22
        const b0 = bytes[PREFIX]
        const b1 = bytes[PREFIX + 1]
        const b2 = bytes[PREFIX + 2]
        if (b0 === 0 && b1 === 0x53 /* 'S' */) {
          legacyR12 = true
        } else if (b0 === 0 && b1 === 0 && b2 === 0x53 /* 'S' */) {
          legacyR12 = false
        } else {
          legacyR12 = false
        }
      }
    }
    return acdbMakeBinaryDxfPairReader(bytes, { encoding, legacyR12 })
  }

  // 1. Explicit override wins: the caller asserts the encoding.
  if (overrideEncoding) {
    if (isUtf8Encoding(overrideEncoding)) {
      return acdbMakeUtf8DxfPairReader(bytes)
    }
    const text = new TextDecoder(overrideEncoding).decode(bytes)
    return acdbMakeAsciiDxfPairReader(text)
  }

  // 2. Trust the bytes first: valid UTF-8 (including pure ASCII) is decoded
  //    correctly no matter what a stale $DWGCODEPAGE claims, so modern files
  //    never pay for a header pre-scan.
  if (acdbIsValidUtf8(bytes)) {
    return acdbMakeUtf8DxfPairReader(bytes)
  }

  // 3. Invalid UTF-8: fall back to the pre-2007 $DWGCODEPAGE when one is
  //    declared (genuine legacy ANSI content). R2007+ or headerless files
  //    stay on UTF-8, where replacement characters mark the broken bytes.
  let legacyEncoding: string | null = null
  try {
    const buffer =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const info = acdbPeekDxfHeaderInfo(new Uint8Array(buffer).slice().buffer)
    if (
      info.version &&
      !info.version.capabilities.supportsUtf8CodePage &&
      info.encoding
    ) {
      legacyEncoding = info.encoding
    }
  } catch {
    // Unrecognized $ACADVER spelling: treat as version-less and stay UTF-8
    // instead of failing the whole read.
  }

  if (legacyEncoding) {
    const text = new TextDecoder(legacyEncoding).decode(bytes)
    return acdbMakeAsciiDxfPairReader(text)
  }

  return acdbMakeUtf8DxfPairReader(bytes)
}

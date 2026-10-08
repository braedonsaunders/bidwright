/**
 * Shared MIME types and byte-signature helpers for OLE metafile payloads.
 */

/** MIME type used when an OLE presentation stores a Windows Metafile (WMF). */
export const ACDB_OLE_METAFILE_WMF_MIME = 'image/wmf'

/** MIME type used when an OLE presentation stores an Enhanced Metafile (EMF). */
export const ACDB_OLE_METAFILE_EMF_MIME = 'image/emf'

/** Aldus placeable WMF key (`0x9AC6CDD7`). */
const ALDUS_PLACEABLE_KEY = 0x9ac6cdd7

/**
 * Returns true when `mime` identifies a WMF/EMF blob produced by the OLE
 * image extractor.
 */
export function acdbIsOleMetafileMimeType(mime?: string | null): boolean {
  return (
    mime === ACDB_OLE_METAFILE_WMF_MIME || mime === ACDB_OLE_METAFILE_EMF_MIME
  )
}

/**
 * Detects a standard or Aldus-placeable WMF header at the start of `data`.
 */
export function acdbLooksLikeWmf(data: Uint8Array): boolean {
  if (data.length < 18) {
    return false
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  // Aldus placeable header (22 bytes) followed by standard WMF header.
  if (data.length >= 40 && view.getUint32(0, true) === ALDUS_PLACEABLE_KEY) {
    return isStandardWmfHeader(data.subarray(22))
  }

  return isStandardWmfHeader(data)
}

/**
 * Detects an EMF (`EMR_HEADER` with the `" EMF"` signature) somewhere near the
 * start of `data` (including after a short WMF / METAFILEPICT preamble).
 */
export function acdbLooksLikeEmf(data: Uint8Array): boolean {
  return findEmfHeaderOffset(data) >= 0
}

/** `META_ESCAPE` record function (WMF). */
const META_ESCAPE = 0x0626
/** `META_ESCAPE_ENHANCED_METAFILE` escape function. */
const META_ESCAPE_ENHANCED_METAFILE = 0x000f
/** Comment identifier `0x43464D57` ("WMFC" as little-endian ASCII). */
const WMFC_COMMENT_IDENTIFIER = 0x43464d57

/**
 * Reassembles a contiguous EMF from a WMF that embeds it via
 * `META_ESCAPE_ENHANCED_METAFILE` ("WMFC") records.
 *
 * Excel OLE `CF_ENHMETAFILE` presentations are frequently stored as such a
 * WMF wrapper. Taking a contiguous `nBytes` slice starting at the first
 * embedded `EMR_HEADER` pulls WMF escape framing into the EMF stream and
 * corrupts later EMR records — converters then only replay the first ~screen
 * of GDI text (e.g. 8 Excel rows) while the canvas stays mostly blank.
 *
 * @returns The concatenated EMF bytes, or `undefined` when no WMFC chunks are found.
 * @see https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-wmf/cfc88064-d86d-4b52-9374-3ce27d456179
 */
export function acdbReassembleEmfFromWmfEscapes(
  data: Uint8Array
): Uint8Array | undefined {
  if (!acdbLooksLikeWmf(data)) {
    return undefined
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0
  if (view.getUint32(0, true) === ALDUS_PLACEABLE_KEY) {
    offset = 22
  }
  // Standard WMF header is `mtHeaderSize` words (typically 9 → 18 bytes).
  if (offset + 18 > data.length) {
    return undefined
  }
  const headerSizeWords = view.getUint16(offset + 2, true)
  if (headerSizeWords < 9) {
    return undefined
  }
  offset += headerSizeWords * 2

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (offset + 6 <= data.length) {
    const recordSizeWords = view.getUint32(offset, true)
    const recordSize = recordSizeWords * 2
    const recordFunction = view.getUint16(offset + 4, true)
    if (
      recordSizeWords < 3 ||
      recordSize < 6 ||
      offset + recordSize > data.length
    ) {
      break
    }

    if (recordFunction === META_ESCAPE && offset + 44 <= offset + recordSize) {
      const escapeFunction = view.getUint16(offset + 6, true)
      if (escapeFunction === META_ESCAPE_ENHANCED_METAFILE) {
        const commentId = view.getUint32(offset + 10, true)
        // CurrentRecordSize / EnhancedMetafileDataSize (must match per MS-WMF).
        const currentRecordSize = view.getUint32(offset + 32, true)
        const emfDataSize = view.getUint32(offset + 40, true)
        const payloadSize =
          currentRecordSize > 0 && currentRecordSize === emfDataSize
            ? currentRecordSize
            : currentRecordSize > 0
              ? currentRecordSize
              : emfDataSize
        const dataStart = offset + 44
        if (
          commentId === WMFC_COMMENT_IDENTIFIER &&
          payloadSize > 0 &&
          dataStart + payloadSize <= offset + recordSize
        ) {
          chunks.push(data.subarray(dataStart, dataStart + payloadSize))
          totalBytes += payloadSize
        }
      }
    }

    // META_EOF
    if (recordFunction === 0) {
      break
    }
    offset += recordSize
  }

  if (chunks.length === 0 || totalBytes < 88) {
    return undefined
  }

  const emf = new Uint8Array(totalBytes)
  let writeAt = 0
  for (const chunk of chunks) {
    emf.set(chunk, writeAt)
    writeAt += chunk.length
  }

  if (!isEmfHeaderAt(emf, 0)) {
    return undefined
  }
  return emf
}

/**
 * Locates the first plausible `EMR_HEADER` in `data`.
 *
 * @returns Byte offset of the header, or `-1` when none is found.
 */
export function findEmfHeaderOffset(data: Uint8Array): number {
  // Search a bounded prefix — Excel OLE streams may prepend a short WMF
  // wrapper before the real EMF, but the header is near the start.
  const limit = Math.min(data.length - 44, 4096)
  for (let i = 0; i <= limit; i++) {
    if (!isEmfHeaderAt(data, i)) continue
    return i
  }
  return -1
}

/**
 * Returns true when `data[offset…]` is a plausible EMF header.
 */
export function isEmfHeaderAt(data: Uint8Array, offset: number): boolean {
  if (offset + 88 > data.length) {
    return false
  }
  const view = new DataView(
    data.buffer,
    data.byteOffset + offset,
    data.length - offset
  )
  if (view.getUint32(0, true) !== 1) {
    return false
  }
  const headerSize = view.getUint32(4, true)
  if (headerSize < 88 || offset + headerSize > data.length) {
    return false
  }
  // Signature " EMF" at offset 40 inside EMR_HEADER.
  if (
    data[offset + 40] !== 0x20 ||
    data[offset + 41] !== 0x45 ||
    data[offset + 42] !== 0x4d ||
    data[offset + 43] !== 0x46
  ) {
    return false
  }
  const nBytes = view.getUint32(48, true)
  const nRecords = view.getUint32(52, true)
  if (nBytes < headerSize || offset + nBytes > data.length) {
    return false
  }
  if (nRecords < 2 || nRecords > 10_000_000) {
    return false
  }
  return true
}

function isStandardWmfHeader(data: Uint8Array): boolean {
  if (data.length < 18) {
    return false
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const type = view.getUint16(0, true)
  const headerSize = view.getUint16(2, true)
  const version = view.getUint16(4, true)
  const sizeWords = view.getUint32(6, true)

  // type: 1 = memory metafile, 2 = disk metafile
  if (type !== 1 && type !== 2) {
    return false
  }
  // headerSize is in WORDS; standard header is 9 words (18 bytes)
  if (headerSize < 9 || headerSize > 100) {
    return false
  }
  // version: 0x0100 or 0x0300
  if (version !== 0x0100 && version !== 0x0300) {
    return false
  }
  if (sizeWords < headerSize || sizeWords * 2 > data.length + 16) {
    // Allow a little slack for truncated streams; still require a plausible size.
    if (sizeWords < headerSize) {
      return false
    }
  }
  return true
}

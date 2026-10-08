/**
 * AutoCAD DXF string / binary chunk limits from the DXF Reference.
 *
 * - MTEXT (and embedded MTEXT in multiline ATTRIB/ATTDEF): content longer than
 *   250 **characters** is split into group-3 chunks of 250, with the remainder
 *   in a final group 1.
 * - XData group 1000: each ASCII string is at most 255 **bytes** (plus NUL).
 * - XData group 1004: each binary chunk is at most 127 **bytes**.
 *
 * Ordinary TEXT / ATTRIB default value / DIMENSION text / TOLERANCE (FCF) do
 * **not** use group-3 continuation — in those entities group 3 already means
 * something else (prompt, dimstyle name, etc.). R2000+ allows longer single
 * group-1 strings (up to 2049 bytes) for those cases.
 */

/** MTEXT content chunk size in characters (AutoCAD DXF Reference). */
export const ACDB_DXF_MTEXT_CHUNK_CHARS = 250

/** XData group-1000 ASCII string max bytes per tag. */
export const ACDB_DXF_XDATA_STRING_MAX_BYTES = 255

/** XData group-1004 binary chunk max bytes. */
export const ACDB_DXF_XDATA_BINARY_MAX_BYTES = 127

export type AcDbDxfMTextContentChunk = { code: 1 | 3; value: string }

/**
 * Split MTEXT (or embedded-MTEXT) contents into DXF group 3 / group 1 pairs.
 *
 * Spec order: full 250-char group-3 chunks first, then a final group 1 with the
 * remainder (or the whole string when length ≤ 250).
 */
export function acdbChunkDxfMTextContents(
  text: string
): AcDbDxfMTextContentChunk[] {
  const value = text ?? ''
  if (value.length <= ACDB_DXF_MTEXT_CHUNK_CHARS) {
    return [{ code: 1, value }]
  }
  const chunks: AcDbDxfMTextContentChunk[] = []
  let offset = 0
  while (value.length - offset > ACDB_DXF_MTEXT_CHUNK_CHARS) {
    chunks.push({
      code: 3,
      value: value.slice(offset, offset + ACDB_DXF_MTEXT_CHUNK_CHARS)
    })
    offset += ACDB_DXF_MTEXT_CHUNK_CHARS
  }
  chunks.push({ code: 1, value: value.slice(offset) })
  return chunks
}

/**
 * Split a Unicode string into pieces whose UTF-8 byte length is ≤ `maxBytes`.
 * Used for XData group 1000 (255-byte limit).
 */
export function acdbChunkUtf8ByMaxBytes(
  text: string,
  maxBytes: number
): string[] {
  if (maxBytes <= 0) return [text ?? '']
  const value = text ?? ''
  if (value.length === 0) return ['']

  const encoder = new TextEncoder()
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0

  for (const char of value) {
    const charBytes = encoder.encode(char).byteLength
    if (charBytes > maxBytes) {
      // Extremely defensive: a single code point larger than the limit cannot
      // be represented; emit it alone rather than looping forever.
      if (current.length > 0) {
        chunks.push(current)
        current = ''
        currentBytes = 0
      }
      chunks.push(char)
      continue
    }
    if (currentBytes + charBytes > maxBytes && current.length > 0) {
      chunks.push(current)
      current = char
      currentBytes = charBytes
    } else {
      current += char
      currentBytes += charBytes
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Split binary payload into ≤ `maxBytes` chunks (XData group 1004 / DXF 310).
 */
export function acdbChunkBinaryByMaxBytes(
  bytes: Uint8Array,
  maxBytes: number
): Uint8Array[] {
  if (maxBytes <= 0) return [bytes]
  if (bytes.byteLength === 0) return [bytes]
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += maxBytes) {
    chunks.push(bytes.subarray(offset, offset + maxBytes))
  }
  return chunks
}

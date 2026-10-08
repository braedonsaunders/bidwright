import type { AcDbAcisModel } from './AcDbAcisEntities'
import { acdbBuildAcisModel } from './AcDbAcisEntities'
import { acdbParseAcisSab } from './AcDbAcisSab'

/** Known ACIS/ASM binary file signature strings searched in raw byte payloads. */
const SAB_SIGNATURES = ['ACIS BinaryFile', 'ASM BinaryFile', 'ASM BinaryFile4'] as const

/**
 * Finds the first byte offset of an ASCII substring within `data`.
 *
 * @param data - Byte buffer to search.
 * @param needle - ASCII string to locate.
 * @returns Zero-based offset, or `-1` when not found.
 */
function findAscii(data: Uint8Array, needle: string): number {
  if (needle.length === 0 || data.length < needle.length) return -1
  const first = needle.charCodeAt(0)
  for (let i = 0; i <= data.length - needle.length; i++) {
    if (data[i] !== first) continue
    let matched = true
    for (let j = 1; j < needle.length; j++) {
      if (data[i + j] !== needle.charCodeAt(j)) {
        matched = false
        break
      }
    }
    if (matched) return i
  }
  return -1
}

/**
 * Finds the byte offset of an ACIS/ASM binary signature within `data`.
 *
 * @param data - Raw SAB/ASM byte payload.
 * @returns Zero-based offset, or `-1` when no known signature is found.
 */
export function acdbFindAcisSabSignatureOffset(data: Uint8Array): number {
  for (const signature of SAB_SIGNATURES) {
    const offset = findAscii(data, signature)
    if (offset >= 0) return offset
  }
  return -1
}

/**
 * Returns true when `data` begins with (or contains) an ACIS/ASM binary signature.
 *
 * @param data - Raw SAB/ASM byte payload.
 */
export function acdbIsAcisSabPayload(data: Uint8Array): boolean {
  return acdbFindAcisSabSignatureOffset(data) >= 0
}

/**
 * Decode an ACIS/ASM SAB byte stream into a resolved B-rep model graph.
 *
 * @param data - Raw SAB/ASM byte payload (may include leading non-ACIS bytes).
 * @returns Resolved model graph, or `null` for empty payloads, missing signatures,
 * or malformed streams.
 */
export function acdbDecodeAcisModel(data: Uint8Array): AcDbAcisModel | null {
  if (data.length === 0) return null
  const offset = acdbFindAcisSabSignatureOffset(data)
  if (offset < 0) return null
  try {
    return acdbBuildAcisModel(acdbParseAcisSab(data.subarray(offset)))
  } catch {
    return null
  }
}

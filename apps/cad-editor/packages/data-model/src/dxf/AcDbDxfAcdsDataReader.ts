import type { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { acdbCombineDxfBinaryChunks } from '../misc/proxyGraphic'

const ASM_DATA_TYPE = 'ASM_Data'

/** Parsed ACDSDATA section (R2013+ binary ASM payloads linked to entities). */
export interface AcDbAcdsDataSection {
  /** ASM_Data payloads keyed by owner entity handle (uppercase, trimmed). */
  byOwnerHandle: Record<string, Uint8Array>
}

/** Normalizes a DXF handle for cross-section lookups (uppercase, trimmed). */
export function acdbNormalizeDxfHandle(handle: string): string {
  return String(handle).trim().toUpperCase()
}

/**
 * Looks up an ASM_Data payload by owner handle with normalized matching.
 *
 * @param section - Parsed ACDSDATA section.
 * @param ownerHandle - Owning entity handle (group 5 / ACDS group 320).
 */
export function acdbGetAcdsDataByOwnerHandle(
  section: AcDbAcdsDataSection,
  ownerHandle: string
): Uint8Array | undefined {
  return section.byOwnerHandle[acdbNormalizeDxfHandle(ownerHandle)]
}

/**
 * Parses one `ACDSRECORD` starting after its `(0, ACDSRECORD)` marker.
 *
 * @param filer - DXF reader positioned at the first field of the record.
 */
function parseAcdsRecord(filer: AcDbDxfFiler): {
  ownerHandle?: string
  hexChunks: Array<string | Uint8Array>
} {
  let ownerHandle: string | undefined
  let currentDataType: string | undefined
  const chunksByType: Record<string, Array<string | Uint8Array>> = {}

  while (!filer.atEndOfObject && !filer.atEof) {
    const item = filer.readItem()
    if (!item) break
    const code = Number(item.code)
    switch (code) {
      case 320:
        ownerHandle = acdbNormalizeDxfHandle(String(item.value))
        break
      case 2:
        currentDataType = String(item.value)
        chunksByType[currentDataType] ??= []
        break
      case 310:
        if (currentDataType) {
          if (item.value instanceof Uint8Array) {
            chunksByType[currentDataType]!.push(item.value)
          } else {
            chunksByType[currentDataType]!.push(String(item.value))
          }
        }
        break
      default:
        break
    }
  }

  return {
    ownerHandle,
    hexChunks: chunksByType[ASM_DATA_TYPE] ?? []
  }
}

/**
 * Parses the DXF `ACDSDATA` section and indexes `ASM_Data` binary payloads by
 * the owning entity handle (group 320).
 *
 * Caller must have already consumed the `(0, SECTION)` / `(2, ACDSDATA)` header.
 *
 * @param filer - DXF reader positioned at the first pair inside ACDSDATA.
 */
export function acdbDxfInAcdsData(filer: AcDbDxfFiler): AcDbAcdsDataSection {
  const byOwnerHandle: Record<string, Uint8Array> = {}

  while (!filer.atEof) {
    const item = filer.peekItem()
    if (!item) break
    if (Number(item.code) !== 0) {
      filer.readItem()
      continue
    }

    const name = String(item.value).toUpperCase()
    if (name === 'ENDSEC' || name === 'EOF') {
      filer.readItem()
      break
    }

    filer.readItem()
    if (name === 'ACDSRECORD') {
      const record = parseAcdsRecord(filer)
      if (record.ownerHandle && record.hexChunks.length > 0) {
        const payload = acdbCombineDxfBinaryChunks(record.hexChunks)
        if (payload.length > 0) {
          byOwnerHandle[record.ownerHandle] = payload
        }
      }
    } else {
      // ACDSSCHEMA / unknown — skip until next code 0.
      filer.skipToEndOfObject()
    }
  }

  return { byOwnerHandle }
}

import { AcDbObject, AcDbObjectId } from '../base/AcDbObject'
import { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbBlockRepresentationData } from '../object/AcDbBlockRepresentationData'
import { AcDbDictionary } from '../object/AcDbDictionary'
import {
  ACDB_DYN_BLOCK_ENHANCED_BLOCK,
  ACDB_DYN_BLOCK_REP_DATA,
  ACDB_DYN_BLOCK_REPRESENTATION_DICT
} from './AcDbDynBlockConstants'

/**
 * Normalized dictionary descriptor shared by DWG converters when importing
 * extension-dictionary graphs used by dynamic blocks.
 */
export interface AcDbDynBlockDictionarySource {
  handle: string
  ownerHandle?: string
  entries: Array<{ name: string; handle: string }>
}

/**
 * Normalized representation-data descriptor (original dynamic definition handle).
 */
export interface AcDbDynBlockRepresentationSource {
  handle: string
  ownerHandle?: string
  /** Object id / handle of the dynamic block table record. */
  blockHandle: string
}

export interface AcDbImportDynBlockMetadataOptions {
  dictionaries?: Iterable<AcDbDynBlockDictionarySource>
  representationData?: Iterable<AcDbDynBlockRepresentationSource>
}

function normalizeHandle(handle: string | undefined | null): string {
  return String(handle ?? '')
    .trim()
    .toUpperCase()
}

/**
 * Imports dynamic-block dictionary / representation objects into `db`.
 *
 * Both `@mlightcad/libredwg-converter` and `@mlightcad/dwg-converter` should
 * call this after entities and block table records exist, and after setting
 * `extensionDictionary` handles on INSERTs / BTRs.
 *
 * Dictionary keys of interest:
 * - {@link ACDB_DYN_BLOCK_REPRESENTATION_DICT}
 * - {@link ACDB_DYN_BLOCK_REP_DATA}
 * - {@link ACDB_DYN_BLOCK_ENHANCED_BLOCK}
 */
export function acdbImportDynBlockMetadata(
  db: AcDbDatabase,
  options: AcDbImportDynBlockMetadataOptions
): void {
  const repSources = [...(options.representationData ?? [])]
  for (const src of repSources) {
    const handle = normalizeHandle(src.handle)
    const blockHandle = normalizeHandle(src.blockHandle)
    if (!handle || !blockHandle) continue

    let rep = db.getObjectById(handle)
    if (!(rep instanceof AcDbBlockRepresentationData)) {
      rep = new AcDbBlockRepresentationData()
      rep.objectId = handle
      if (src.ownerHandle) {
        rep.ownerId = normalizeHandle(src.ownerHandle)
      }
      rep.database = db
      db.commitObjectHandle(rep)
    }
    ;(rep as AcDbBlockRepresentationData).blockId = blockHandle
  }

  const dictSources = [...(options.dictionaries ?? [])]
  // Create empty dictionaries first so setAt can reference children that are
  // also dictionaries.
  const dictByHandle = new Map<string, AcDbDictionary>()
  for (const src of dictSources) {
    const handle = normalizeHandle(src.handle)
    if (!handle) continue

    let dict = db.getObjectById(handle)
    if (!(dict instanceof AcDbDictionary)) {
      dict = new AcDbDictionary(db)
      dict.objectId = handle
      if (src.ownerHandle) {
        dict.ownerId = normalizeHandle(src.ownerHandle)
      }
      db.commitObjectHandle(dict)
    }
    dictByHandle.set(handle, dict as AcDbDictionary)
  }

  for (const src of dictSources) {
    const handle = normalizeHandle(src.handle)
    const dict = dictByHandle.get(handle)
    if (!dict) continue

    for (const entry of src.entries) {
      const name = entry.name
      const targetHandle = normalizeHandle(entry.handle)
      if (!name || !targetHandle) continue

      let target = db.getObjectById(targetHandle)
      if (!target) {
        // Placeholder so has()/getAt succeed for keys like ACAD_ENHANCEDBLOCK
        // when the evaluation-graph object was not fully converted.
        if (
          name === ACDB_DYN_BLOCK_ENHANCED_BLOCK ||
          name === ACDB_DYN_BLOCK_REPRESENTATION_DICT ||
          name === ACDB_DYN_BLOCK_REP_DATA
        ) {
          const placeholder = new AcDbObject()
          placeholder.objectId = targetHandle
          placeholder.database = db
          db.commitObjectHandle(placeholder)
          target = placeholder
        } else {
          continue
        }
      }

      // Avoid re-entry recording issues: setAt expects a typed object; store
      // whatever we resolved (dictionary, representation data, or placeholder).
      dict.setAt(name, target as AcDbObject)
    }
  }
}

/**
 * Resolves a soft/hard dictionary handle field from converter JSON into a
 * normalized object id, or `undefined` when absent.
 */
export function acdbNormalizeExtensionDictionaryId(
  value: unknown
): AcDbObjectId | undefined {
  if (value == null || value === false || value === true) return undefined
  const handle = normalizeHandle(String(value))
  if (!handle || handle === '0') return undefined
  return handle
}

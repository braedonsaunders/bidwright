import { AcDbResultBuffer } from '../base/AcDbResultBuffer'
import type { AcDbTypedValue } from '../base/AcDbTypedValue'
import { AcLyLayerFilter } from './AcLyLayerFilter'
import { AcLyLayerFilterTree } from './AcLyLayerFilterTree'
import { AcLyLayerGroup } from './AcLyLayerGroup'

/**
 * Dictionary name for the legacy (pre-2005) layer-filter store.
 *
 * @remarks
 * Lives in the Layer Table extension dictionary. Typically holds only
 * top-level filter heads; nested filters are stored under
 * {@link ACLY_DICTIONARY_NAME}.
 *
 * @see https://blog.autodesk.io/delete-layer-filters-using-objectarx/
 */
export const ACAD_LAYERFILTERS_NAME = 'ACAD_LAYERFILTERS'

/**
 * Dictionary name for the modern nested layer-filter store (AutoCAD 2005+).
 *
 * @remarks
 * Lives in the Layer Table extension dictionary. Nested filters are reached
 * through child `ACLYDICTIONARY` dictionaries owned by parent filter
 * XRecords (via each XRecord's extension dictionary).
 *
 * @see https://forums.autodesk.com/t5/vba-forum/lost-in-acad-layerfilters-dictionnary/td-p/1841031
 */
export const ACLY_DICTIONARY_NAME = 'ACLYDICTIONARY'

/**
 * A DXF/DWG group-code pair used when reading or writing filter XRecords.
 */
export interface AcDbLayerFilterGroup {
  /** DXF group code. */
  code: number
  /** Group value. */
  value: unknown
}

/**
 * Minimal dictionary shape used when reconstructing the filter tree.
 */
export interface AcDbPersistDictionary {
  /** Object handle. */
  handle: string
  /** Owner object handle, when known. */
  ownerObjectId?: string
  /** Extension dictionary handle, when known. */
  extensionDictionaryId?: string
  /** Named entries mapping to soft/hard-owned object handles. */
  entries: Record<string, string>
}

/**
 * Minimal XRecord shape used when reconstructing the filter tree.
 */
export interface AcDbPersistXRecord {
  /** Object handle. */
  handle: string
  /** Owner object handle, when known. */
  ownerObjectId?: string
  /** Extension dictionary handle, when known. */
  extensionDictionaryId?: string
  /** XRecord payload as DXF group pairs. */
  data: AcDbLayerFilterGroup[]
}

/**
 * Lookup tables used to rebuild an {@link AcLyLayerFilterTree} from drawing
 * objects.
 */
export interface AcDbLayerFilterPersistSource {
  /** Dictionaries keyed by handle. */
  dictionaries: Map<string, AcDbPersistDictionary>
  /** XRecords keyed by handle. */
  xrecords: Map<string, AcDbPersistXRecord>
}

/**
 * One serialized filter node produced by {@link acdbSerializeLayerFilterTree}.
 */
export interface AcDbSerializedFilterNode {
  /** Dictionary entry key / filter identity. */
  key: string
  /** Whether this node is a group (ID) filter. */
  isIdFilter: boolean
  /** XRecord payload groups. */
  data: AcDbLayerFilterGroup[]
  /** Nested child nodes. */
  children: AcDbSerializedFilterNode[]
}

/**
 * Serialized Layer Manager filter tree ready to be written as dictionaries
 * and XRecords under the Layer Table extension dictionary.
 */
export interface AcDbSerializedFilterTree {
  /** Root nested filters (excluding the synthetic `All` root itself). */
  nodes: AcDbSerializedFilterNode[]
}

/**
 * Reads an {@link AcLyLayerFilterTree} from Layer Table extension-dictionary
 * objects (`ACAD_LAYERFILTERS` / `ACLYDICTIONARY` + XRecords).
 *
 * @remarks
 * Prefer {@link ACLY_DICTIONARY_NAME} when present (supports nesting). Fall
 * back to the legacy flat {@link ACAD_LAYERFILTERS_NAME} dictionary.
 *
 * Legacy property-filter XRecord layout (documented VBA samples):
 * `(1 name) (1 expression) (1 colorPat) (1 linetypePat) (70 flags) (1 ...) (1 ...)`
 * Group filters additionally store layer object IDs as soft/hard pointers
 * (group codes 330 / 340 / 350 / 360).
 *
 * @param source - Dictionaries and XRecords from the drawing.
 * @returns The reconstructed filter tree.
 */
export function acdbReadLayerFilterTree(
  source: AcDbLayerFilterPersistSource
): AcLyLayerFilterTree {
  const root = AcLyLayerFilterTree.createDefaultRoot()
  const tree = new AcLyLayerFilterTree(root, root)

  const aclyDict = findNamedDictionary(source, ACLY_DICTIONARY_NAME)
  const legacyDict = findNamedDictionary(source, ACAD_LAYERFILTERS_NAME)

  if (aclyDict) {
    for (const [key, handle] of Object.entries(aclyDict.entries)) {
      const child = readFilterNode(source, handle, key)
      if (child) {
        root.addNested(child)
      }
    }
    return tree
  }

  if (legacyDict) {
    for (const [key, handle] of Object.entries(legacyDict.entries)) {
      const child = readFilterNode(source, handle, key)
      if (child) {
        root.addNested(child)
      }
    }
  }

  return tree
}

/**
 * Serializes an {@link AcLyLayerFilterTree} into dictionary/XRecord payloads.
 *
 * @param tree - Filter tree to serialize.
 * @returns Serialized nodes for `ACAD_LAYERFILTERS` / `ACLYDICTIONARY`.
 */
export function acdbSerializeLayerFilterTree(
  tree: AcLyLayerFilterTree
): AcDbSerializedFilterTree {
  const nodes: AcDbSerializedFilterNode[] = []
  for (const child of tree.root.getNestedFilters()) {
    nodes.push(serializeFilterNode(child))
  }
  return { nodes }
}

/**
 * Converts typed XRecord groups into an {@link AcDbResultBuffer}.
 *
 * @param groups - DXF group pairs.
 * @returns Result buffer suitable for {@link AcDbXrecord.data}.
 */
export function acdbLayerGroupsToResultBuffer(
  groups: readonly AcDbLayerFilterGroup[]
): AcDbResultBuffer {
  const buffer = new AcDbResultBuffer()
  for (const group of groups) {
    buffer.add({
      code: group.code,
      value: group.value
    } as AcDbTypedValue)
  }
  return buffer
}

/**
 * Converts an {@link AcDbResultBuffer} into DXF group pairs.
 *
 * @param buffer - Source result buffer.
 * @returns DXF group pairs.
 */
export function acdbResultBufferToLayerGroups(
  buffer: AcDbResultBuffer | null | undefined
): AcDbLayerFilterGroup[] {
  if (!buffer) return []
  return buffer.toArray().map(item => ({
    code: Number(item.code),
    value: item.value
  }))
}

/**
 * Finds a dictionary that appears as a named entry (`ACAD_LAYERFILTERS` or
 * `ACLYDICTIONARY`) in any parent dictionary.
 *
 * Prefers the Layer Table extension-dictionary entry (parent not owned by an
 * XRecord) over nested per-filter `ACLYDICTIONARY` instances.
 *
 * @param source - Persist source.
 * @param name - Dictionary entry name to find.
 * @returns The named dictionary, or `undefined`.
 */
function findNamedDictionary(
  source: AcDbLayerFilterPersistSource,
  name: string
): AcDbPersistDictionary | undefined {
  let nestedFallback: AcDbPersistDictionary | undefined
  for (const dict of source.dictionaries.values()) {
    const handle = dict.entries[name]
    if (!handle) continue
    const nested = source.dictionaries.get(normalizeHandle(handle))
    if (!nested) continue
    const ownerIsXRecord = dict.ownerObjectId
      ? source.xrecords.has(normalizeHandle(dict.ownerObjectId))
      : false
    if (!ownerIsXRecord) {
      return nested
    }
    nestedFallback = nested
  }
  return nestedFallback
}

/**
 * Reads one filter node (and its nested children) from an XRecord handle.
 *
 * @param source - Persist source.
 * @param handle - XRecord handle.
 * @param fallbackName - Dictionary entry key used when the XRecord omits name.
 * @returns The filter instance, or `undefined` if the handle is missing.
 */
function readFilterNode(
  source: AcDbLayerFilterPersistSource,
  handle: string,
  fallbackName: string
): AcLyLayerFilter | undefined {
  const xrecord = source.xrecords.get(normalizeHandle(handle))
  if (!xrecord) {
    return undefined
  }

  const parsed = acdbParseFilterXRecordData(xrecord.data, fallbackName)
  const filter: AcLyLayerFilter = parsed.isIdFilter
    ? new AcLyLayerGroup()
    : new AcLyLayerFilter()

  filter.setAllowRename(true)
  filter.setName(parsed.name || fallbackName)
  if (!parsed.isIdFilter) {
    filter.setFilterExpression(parsed.filterExpression)
  } else {
    const group = filter as AcLyLayerGroup
    for (const layerId of parsed.layerIds) {
      group.addLayerId(layerId)
    }
  }

  for (const childHandle of findNestedFilterHandles(source, xrecord)) {
    const child = readFilterNode(source, childHandle.handle, childHandle.key)
    if (child) {
      filter.addNested(child)
    }
  }

  return filter
}

/**
 * Locates nested filter XRecord handles under a parent filter XRecord.
 *
 * Nesting is represented as:
 * parent XRecord → extension dictionary → `ACLYDICTIONARY` → child XRecords
 * or any dictionary owned by the parent XRecord / its extension dictionary.
 *
 * @param source - Persist source.
 * @param parent - Parent XRecord.
 * @returns Child dictionary entries.
 */
function findNestedFilterHandles(
  source: AcDbLayerFilterPersistSource,
  parent: AcDbPersistXRecord
): { key: string; handle: string }[] {
  const result: { key: string; handle: string }[] = []
  const seen = new Set<string>()
  const parentHandle = normalizeHandle(parent.handle)
  const extensionId = parent.extensionDictionaryId
    ? normalizeHandle(parent.extensionDictionaryId)
    : undefined

  const pushEntry = (key: string, handle: string) => {
    const normalized = normalizeHandle(handle)
    if (seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    result.push({ key, handle })
  }

  for (const dict of source.dictionaries.values()) {
    const owner = dict.ownerObjectId
      ? normalizeHandle(dict.ownerObjectId)
      : undefined
    // Require an explicit owner — otherwise `undefined === undefined` would
    // treat every unowned dictionary as a child of every XRecord.
    if (!owner) {
      continue
    }
    const ownedByParent = owner === parentHandle || owner === extensionId
    if (!ownedByParent) {
      continue
    }

    const nestedAcly = dict.entries[ACLY_DICTIONARY_NAME]
    if (nestedAcly) {
      const nestedDict = source.dictionaries.get(normalizeHandle(nestedAcly))
      if (nestedDict) {
        for (const [key, handle] of Object.entries(nestedDict.entries)) {
          pushEntry(key, handle)
        }
        continue
      }
    }

    // Direct children listed on a dictionary owned by the parent.
    // Skip ACLYDICTIONARY itself: its entries were already collected above when
    // the parent/extension dictionary pointed at it (avoids duplicate children).
    for (const [key, handle] of Object.entries(dict.entries)) {
      if (key === ACLY_DICTIONARY_NAME || key === ACAD_LAYERFILTERS_NAME) {
        continue
      }
      pushEntry(key, handle)
    }
  }

  return result
}

/**
 * Parsed fields from one filter XRecord payload.
 */
export interface AcDbParsedFilterXRecord {
  name: string
  filterExpression: string
  flags: number
  layerIds: string[]
  isIdFilter: boolean
}

/**
 * Parses legacy / modern filter XRecord group codes into structured fields.
 *
 * @param data - XRecord groups.
 * @param fallbackName - Name used when group code 1 is missing.
 * @returns Parsed filter fields.
 */
export function acdbParseFilterXRecordData(
  data: readonly AcDbLayerFilterGroup[],
  fallbackName = ''
): AcDbParsedFilterXRecord {
  const strings: string[] = []
  const layerIds: string[] = []
  let flags = 0
  let explicitIdFilter: boolean | undefined
  /** Modern ACLYDICTIONARY layout: name in group 300, expression in 301. */
  let nameFrom300: string | undefined
  let expressionFrom301: string | undefined

  for (const group of data) {
    const code = Number(group.code)
    const value = group.value
    if (code === 1 && typeof value === 'string') {
      strings.push(value)
    } else if (code === 300 && typeof value === 'string') {
      nameFrom300 = value
    } else if (code === 301 && typeof value === 'string') {
      expressionFrom301 = value
    } else if (code === 70 || code === 90) {
      flags = Number(value) || 0
    } else if (code === 290 || code === 280) {
      // 290/280 used by some writers as boolean "is group/id filter".
      // Prefer expression / layer-id heuristics when modern 301 is present,
      // because some drawings set 290 even on property filters.
      explicitIdFilter = Number(value) === 1
    } else if (
      (code === 330 || code === 340 || code === 350 || code === 360) &&
      value != null &&
      String(value).length > 0
    ) {
      layerIds.push(normalizeHandle(String(value)))
    }
  }

  const className = strings[0]
  const isClassMarker =
    className === 'AcLyLayerFilter' || className === 'AcLyLayerGroup'
  const name =
    nameFrom300 ||
    (!isClassMarker ? className : undefined) ||
    fallbackName

  const legacySecond = strings[1] ?? ''
  let filterExpression = expressionFrom301 ?? legacySecond
  // Legacy ACAD_LAYERFILTERS often stores a bare name pattern in the second
  // string (for example `圆` or `多*`) instead of a full `NAME=="..."` clause.
  if (
    !expressionFrom301 &&
    filterExpression &&
    filterExpression !== '*' &&
    !/==/.test(filterExpression)
  ) {
    filterExpression = `NAME=="${filterExpression}"`
  }

  const isIdFilter =
    expressionFrom301 != null && expressionFrom301.length > 0
      ? false
      : explicitIdFilter === true && layerIds.length > 0
        ? true
        : layerIds.length > 0 &&
          (filterExpression.length === 0 || filterExpression === '*')

  return {
    name,
    filterExpression: isIdFilter ? '' : filterExpression,
    flags,
    layerIds,
    isIdFilter
  }
}

/**
 * Serializes one filter (and nested children) to XRecord payloads.
 *
 * @param filter - Filter to serialize.
 * @returns Serialized node.
 */
function serializeFilterNode(filter: AcLyLayerFilter): AcDbSerializedFilterNode {
  const isIdFilter = filter.isIdFilter()
  const data = acdbWriteFilterXRecordData(filter)
  const children = filter
    .getNestedFilters()
    .map(child => serializeFilterNode(child))
  const key = filter.name || (isIdFilter ? 'Group' : 'Filter')
  return { key, isIdFilter, data, children }
}

/**
 * Writes filter fields to the legacy-compatible XRecord group layout.
 *
 * @param filter - Filter to write.
 * @returns DXF group pairs.
 */
export function acdbWriteFilterXRecordData(
  filter: AcLyLayerFilter
): AcDbLayerFilterGroup[] {
  const groups: AcDbLayerFilterGroup[] = []
  groups.push({ code: 1, value: filter.name })
  if (filter.isIdFilter()) {
    groups.push({ code: 1, value: '' })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 70, value: 0 })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 290, value: 1 })
    const group = filter as AcLyLayerGroup
    for (const layerId of group.layerIds()) {
      groups.push({ code: 330, value: layerId })
    }
  } else {
    groups.push({ code: 1, value: filter.filterExpression || '*' })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 70, value: 0 })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 1, value: '*' })
    groups.push({ code: 290, value: 0 })
  }
  return groups
}

/**
 * Normalizes a DXF/DWG handle to uppercase hexadecimal text.
 *
 * @param handle - Raw handle.
 * @returns Normalized handle.
 */
function normalizeHandle(handle: string): string {
  return handle.trim().toUpperCase()
}

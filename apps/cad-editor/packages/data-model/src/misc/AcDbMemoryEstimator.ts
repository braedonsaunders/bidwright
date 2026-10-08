/**
 * @fileoverview Heuristic in-memory size estimator for {@link AcDbDatabase}.
 *
 * Walks the ownership graph with a {@link WeakSet} to avoid cycles and estimates
 * bytes using V8-inspired constants. Results are reproducible and useful for
 * comparing drawings; they are not exact Chrome heap retained sizes.
 * Cross-check with `performance.memory` / DevTools heap snapshots when needed.
 *
 * @module AcDbMemoryEstimator
 */

import type { AcDbDatabase } from '../database/AcDbDatabase'
import { AcDbEntity } from '../entity/AcDbEntity'

/**
 * Accumulated byte and object counts for one breakdown key
 * (category name or entity type name).
 */
export interface AcDbMemoryEstimateBucket {
  /** Estimated retained payload size in bytes for this key. */
  bytes: number
  /**
   * Number of JS objects attributed to this key.
   * For entity-type buckets this is the entity instance count;
   * for category buckets it is the visited object count in that category.
   */
  count: number
}

/**
 * Structured result returned by {@link acdbEstimateDatabaseMemory}.
 *
 * Categories typically include `sysvars`, `tables`, `entities`, `objects`,
 * `handleRegistry`, `xdata`, and optionally `transaction` / `events`.
 */
export interface AcDbMemoryEstimate {
  /** Sum of all category bytes. */
  totalBytes: number
  /** Number of distinct JS objects visited (excluding primitives). */
  objectCount: number
  /** Number of {@link AcDbEntity} instances visited. */
  entityCount: number
  /**
   * Breakdown by high-level ownership category
   * (for example `entities`, `tables`, `handleRegistry`).
   */
  byCategory: Record<string, AcDbMemoryEstimateBucket>
  /**
   * Breakdown by entity `type` name
   * (for example `Line`, `Polyline`, `Hatch`).
   */
  byEntityType: Record<string, AcDbMemoryEstimateBucket>
}

/**
 * Options controlling which non-model graphs are included when estimating
 * {@link AcDbDatabase} memory via {@link acdbEstimateDatabaseMemory}.
 */
export interface AcDbMemoryEstimateOptions {
  /**
   * When `true`, include `transactionManager` and undo stacks.
   * Default: `false` (model body only).
   */
  includeTransactionManager?: boolean
  /**
   * When `true`, include `events` / event managers and their listeners.
   * Default: `false`.
   */
  includeEventManagers?: boolean
}

/** Estimated per-object header size in bytes (V8-inspired heuristic). */
const OBJECT_OVERHEAD = 48
/** Estimated pointer / slot size in bytes. */
const POINTER_SIZE = 8
/** Estimated array object header size in bytes. */
const ARRAY_OVERHEAD = 48
/** Estimated `Map` object header size in bytes. */
const MAP_OVERHEAD = 80
/** Estimated cost of one `Map` entry (excluding key/value payloads). */
const MAP_ENTRY_OVERHEAD = 32
/** Estimated `Set` object header size in bytes. */
const SET_OVERHEAD = 80
/** Estimated cost of one `Set` entry (excluding value payload). */
const SET_ENTRY_OVERHEAD = 24
/** Estimated string object header size in bytes (UTF-16 payload billed separately). */
const STRING_OVERHEAD = 40
/** Estimated size of a JavaScript `number`. */
const NUMBER_SIZE = 8
/** Estimated size of a JavaScript `boolean`. */
const BOOLEAN_SIZE = 4
/** Estimated TypedArray / ArrayBuffer object header size in bytes. */
const TYPED_ARRAY_OVERHEAD = 64
/** Estimated `Blob` object header size in bytes (`size` billed separately). */
const BLOB_OVERHEAD = 64

/**
 * High-level ownership category used while walking the database graph.
 *
 * @internal
 */
type Category =
  | 'sysvars'
  | 'tables'
  | 'entities'
  | 'objects'
  | 'handleRegistry'
  | 'xdata'
  | 'other'
  | 'transaction'
  | 'events'

/**
 * {@link AcDbDatabase} own-property names treated as system variables / header
 * state when classifying memory into the `sysvars` category.
 */
const SYSVAR_KEYS = new Set([
  '_version',
  '_angbase',
  '_angdir',
  '_aunits',
  '_auprec',
  '_lunits',
  '_luprec',
  '_celtscale',
  '_cecolor',
  '_celtype',
  '_celweight',
  '_cetransparency',
  '_clayer',
  '_cmlstyle',
  '_cmlscale',
  '_cmleaderstyle',
  '_hpbackgroundcolor',
  '_hpcolor',
  '_hplayer',
  '_hptransparency',
  '_textstyle',
  '_dimstyle',
  '_dimstyle',
  '_dimstyle',
  '_extents',
  '_insunits',
  '_unitmode',
  '_measurement',
  '_ltscale',
  '_lwdisplay',
  '_pdmode',
  '_pdsize',
  '_osmode',
  '_orthomode',
  '_maxHandle',
  '_drawNoPlotLayers',
  '_drawCircleSides',
  '_dwgname',
  '_currentSpace',
  '_formatter',
  '_eventBatchDepth',
  '_pendingEntityAppended',
  '_pendingEntityErased',
  '_pendingDictObjectSet',
  '_pendingDictObjectErased',
  '_lastOpenError'
])

/**
 * Property names that are never walked (prototype / call-stack noise).
 */
const SKIP_ALWAYS = new Set([
  'constructor',
  'prototype',
  '__proto__',
  'caller',
  'callee',
  'arguments'
])

/**
 * Mutable walk state shared across recursive measurement helpers.
 *
 * @internal
 */
interface WalkState {
  /** Objects already visited; used to break ownership cycles. */
  visited: WeakSet<object>
  /** Running count of distinct JS objects visited. */
  objectCount: number
  /** Running count of {@link AcDbEntity} instances visited. */
  entityCount: number
  /** Category → accumulated bytes/counts. */
  byCategory: Map<string, AcDbMemoryEstimateBucket>
  /** Entity type name → accumulated bytes/counts. */
  byEntityType: Map<string, AcDbMemoryEstimateBucket>
  /** Whether transaction / undo graphs are included. */
  includeTransactionManager: boolean
  /** Whether event managers / listeners are included. */
  includeEventManagers: boolean
}

/**
 * Returns the bucket for `key`, creating an empty one when missing.
 *
 * @param map - Category or entity-type bucket map.
 * @param key - Bucket key to look up or create.
 * @returns The existing or newly created bucket.
 * @internal
 */
function ensureBucket(
  map: Map<string, AcDbMemoryEstimateBucket>,
  key: string
): AcDbMemoryEstimateBucket {
  let bucket = map.get(key)
  if (!bucket) {
    bucket = { bytes: 0, count: 0 }
    map.set(key, bucket)
  }
  return bucket
}

/**
 * Adds estimated bytes (and optional object count) to a category bucket.
 *
 * No-op when both `bytes` and `objectDelta` are zero.
 *
 * @param state - Shared walk state.
 * @param category - Category name to update.
 * @param bytes - Bytes to add to the category.
 * @param objectDelta - Object count delta to add (default `0`).
 * @internal
 */
function addBytes(
  state: WalkState,
  category: string,
  bytes: number,
  objectDelta = 0
) {
  if (bytes <= 0 && objectDelta === 0) return
  const bucket = ensureBucket(state.byCategory, category)
  bucket.bytes += bytes
  bucket.count += objectDelta
}

/**
 * Returns whether `value` is a plain object (`Object` prototype or `null`
 * prototype), as opposed to a class instance.
 *
 * @param value - Object to test.
 * @returns `true` when `value` is a plain object.
 * @internal
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Type guard for TypedArray / DataView values (`ArrayBuffer.isView`).
 *
 * @param value - Value to test.
 * @returns `true` when `value` is an {@link ArrayBufferView}.
 * @internal
 */
function isTypedArray(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value)
}

/**
 * Heuristic detection of {@link AcCmEventManager}-like objects so their
 * listener lists can be skipped when event managers are excluded.
 *
 * @param value - Object to test.
 * @returns `true` when `value` looks like an event manager.
 * @internal
 */
function isAcCmEventManager(value: object): boolean {
  return (
    typeof (value as { addEventListener?: unknown }).addEventListener ===
      'function' &&
    typeof (value as { dispatch?: unknown }).dispatch === 'function' &&
    'listeners' in value
  )
}

/**
 * Returns whether a property should be skipped based on walk options and
 * always-skipped names.
 *
 * @param state - Shared walk state (options).
 * @param key - Property name being considered.
 * @param category - Current ownership category of the parent object.
 * @returns `true` when the property must not be walked.
 * @internal
 */
function shouldSkipProperty(
  state: WalkState,
  key: string,
  category: Category
): boolean {
  if (SKIP_ALWAYS.has(key)) return true
  if (
    !state.includeEventManagers &&
    (key === 'events' || category === 'events')
  ) {
    return key === 'events'
  }
  if (
    !state.includeTransactionManager &&
    (key === 'transactionManager' || category === 'transaction')
  ) {
    return key === 'transactionManager'
  }
  return false
}

/**
 * Resolves the ownership category for a child value based on the parent
 * category, property name, and runtime type.
 *
 * @param parentCategory - Category of the owning object.
 * @param key - Child property name (or array index as string).
 * @param value - Child value (used for entity detection).
 * @returns Category to use when measuring the child.
 * @internal
 */
function resolveChildCategory(
  parentCategory: Category,
  key: string,
  value: unknown
): Category {
  if (
    key === '_xDataMap' ||
    key === '_importedXData' ||
    parentCategory === 'xdata'
  ) {
    return 'xdata'
  }
  if (key === '_tables' || parentCategory === 'tables') {
    if (value instanceof AcDbEntity) return 'entities'
    return 'tables'
  }
  if (key === '_entities' || parentCategory === 'entities') {
    return 'entities'
  }
  if (key === '_objects' || parentCategory === 'objects') {
    return 'objects'
  }
  if (key === '_handleRegistry' || parentCategory === 'handleRegistry') {
    return 'handleRegistry'
  }
  if (key === 'transactionManager' || parentCategory === 'transaction') {
    return 'transaction'
  }
  if (key === 'events' || parentCategory === 'events') {
    return 'events'
  }
  if (parentCategory === 'sysvars' || SYSVAR_KEYS.has(key)) {
    return 'sysvars'
  }
  if (value instanceof AcDbEntity) {
    return 'entities'
  }
  return parentCategory === 'other' ? 'other' : parentCategory
}

/**
 * Collects instance data property names from `obj` and its class prototype
 * chain (TypeScript `private` fields are still present as `_foo` on the
 * instance / class field storage).
 *
 * Skips methods, accessors without a data value, and built-in prototypes
 * such as `Array.prototype`.
 *
 * @param obj - Class instance or plain object to inspect.
 * @returns Deduplicated list of instance property names.
 * @internal
 */
function collectInstanceKeys(obj: object): string[] {
  const keys = new Set<string>()
  let current: object | null = obj
  while (current && current !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) {
      if (SKIP_ALWAYS.has(key)) continue
      // Skip prototype methods; we only want instance data fields.
      const desc = Object.getOwnPropertyDescriptor(current, key)
      if (desc && typeof desc.value === 'function') continue
      if (desc && (desc.get || desc.set) && desc.value === undefined) continue
      keys.add(key)
    }
    current = Object.getPrototypeOf(current)
    // Stop before walking built-in prototypes for class instances that store
    // data only on the instance / custom prototypes above Object.
    if (current === Object.prototype || current === null) break
    // For arrays/maps, own keys on the instance are enough; avoid Array.prototype.
    if (
      current === Array.prototype ||
      current === Map.prototype ||
      current === Set.prototype
    ) {
      break
    }
  }
  return [...keys]
}

/**
 * Estimates the size of a primitive value (number, boolean, string, bigint,
 * or symbol). Returns `0` for `null`, `undefined`, and non-primitives.
 *
 * @param value - Value to measure.
 * @returns Estimated size in bytes.
 * @internal
 */
function measurePrimitive(value: unknown): number {
  if (value === null || value === undefined) return 0
  switch (typeof value) {
    case 'number':
      return NUMBER_SIZE
    case 'boolean':
      return BOOLEAN_SIZE
    case 'string':
      return STRING_OVERHEAD + value.length * 2
    case 'bigint':
      return 16
    case 'symbol':
      return STRING_OVERHEAD + String(value.description ?? '').length * 2
    default:
      return 0
  }
}

/**
 * Measures only the structure of the database handle registry `Map`
 * (header, entry slots, and key strings). Registered object values are
 * expected to be counted via the ownership graph instead.
 *
 * @param state - Shared walk state.
 * @param registry - The database `_handleRegistry` map.
 * @returns Estimated registry overhead in bytes, or `0` if already visited.
 * @internal
 */
function measureHandleRegistryOverhead(
  state: WalkState,
  registry: Map<string, object>
): number {
  if (state.visited.has(registry)) return 0
  state.visited.add(registry)
  state.objectCount += 1

  // Objects are counted via the ownership graph; only Map structure + keys.
  let bytes = MAP_OVERHEAD + registry.size * MAP_ENTRY_OVERHEAD
  for (const key of registry.keys()) {
    bytes += measurePrimitive(key)
  }
  addBytes(state, 'handleRegistry', bytes, 1)
  return bytes
}

/**
 * Recursively walks a value, attributing estimated bytes to the current
 * category and optional entity type. Uses {@link WalkState.visited} to avoid
 * recounting shared or cyclic references.
 *
 * @param state - Shared walk state.
 * @param value - Value to measure.
 * @param category - Ownership category for this value.
 * @param entityType - Active entity type name when walking entity payload,
 *   or `null` when outside an entity.
 * @returns Estimated size in bytes for this subtree (also recorded in `state`).
 * @internal
 */
function walkValue(
  state: WalkState,
  value: unknown,
  category: Category,
  entityType: string | null
): number {
  if (value === null || value === undefined) return 0

  const valueType = typeof value
  if (valueType === 'function') return 0
  if (valueType !== 'object') {
    const bytes = measurePrimitive(value)
    addBytes(state, category, bytes)
    if (entityType) {
      const bucket = ensureBucket(state.byEntityType, entityType)
      bucket.bytes += bytes
    }
    return bytes
  }

  const obj = value as object

  // DOM / host objects
  if (typeof (obj as { nodeType?: unknown }).nodeType === 'number') return 0

  if (state.visited.has(obj)) return 0
  state.visited.add(obj)
  state.objectCount += 1

  if (!state.includeEventManagers && isAcCmEventManager(obj)) {
    addBytes(state, category, OBJECT_OVERHEAD, 1)
    return OBJECT_OVERHEAD
  }

  let localEntityType = entityType
  let localCategory = category
  let isEntity = false

  if (obj instanceof AcDbEntity) {
    isEntity = true
    localCategory = 'entities'
    localEntityType = obj.type
    state.entityCount += 1
    const typeBucket = ensureBucket(state.byEntityType, localEntityType)
    typeBucket.count += 1
  }

  // Promise
  if (typeof (obj as Promise<unknown>).then === 'function') {
    addBytes(state, localCategory, OBJECT_OVERHEAD, 1)
    return OBJECT_OVERHEAD
  }

  // ArrayBuffer
  if (obj instanceof ArrayBuffer) {
    const bytes = TYPED_ARRAY_OVERHEAD + obj.byteLength
    addBytes(state, localCategory, bytes, 1)
    if (localEntityType) {
      ensureBucket(state.byEntityType, localEntityType).bytes += bytes
    }
    return bytes
  }

  // TypedArray / DataView
  if (isTypedArray(obj)) {
    const bytes = TYPED_ARRAY_OVERHEAD + obj.byteLength
    // Count underlying buffer only once via visited set when shared.
    if (obj.buffer && !state.visited.has(obj.buffer)) {
      state.visited.add(obj.buffer)
    }
    addBytes(state, localCategory, bytes, 1)
    if (localEntityType) {
      ensureBucket(state.byEntityType, localEntityType).bytes += bytes
    }
    return bytes
  }

  // Blob
  if (typeof Blob !== 'undefined' && obj instanceof Blob) {
    const bytes = BLOB_OVERHEAD + obj.size
    addBytes(state, localCategory, bytes, 1)
    if (localEntityType) {
      ensureBucket(state.byEntityType, localEntityType).bytes += bytes
    }
    return bytes
  }

  // Date
  if (obj instanceof Date) {
    const bytes = OBJECT_OVERHEAD + 8
    addBytes(state, localCategory, bytes, 1)
    return bytes
  }

  // Map — special-case handle registry values (already counted via ownership)
  if (obj instanceof Map) {
    const isHandleRegistry = localCategory === 'handleRegistry'
    const structureBytes = MAP_OVERHEAD + obj.size * MAP_ENTRY_OVERHEAD
    let bytes = structureBytes
    addBytes(state, localCategory, structureBytes, 1)
    if (localEntityType) {
      ensureBucket(state.byEntityType, localEntityType).bytes += structureBytes
    }
    for (const [k, v] of obj) {
      bytes += walkValue(state, k, localCategory, localEntityType)
      if (!isHandleRegistry) {
        bytes += walkValue(state, v, localCategory, localEntityType)
      }
    }
    return bytes
  }

  // Set
  if (obj instanceof Set) {
    let bytes = SET_OVERHEAD + obj.size * SET_ENTRY_OVERHEAD
    for (const item of obj) {
      bytes += walkValue(state, item, localCategory, localEntityType)
    }
    addBytes(
      state,
      localCategory,
      SET_OVERHEAD + obj.size * SET_ENTRY_OVERHEAD,
      1
    )
    if (localEntityType) {
      ensureBucket(state.byEntityType, localEntityType).bytes +=
        SET_OVERHEAD + obj.size * SET_ENTRY_OVERHEAD
    }
    return bytes
  }

  // Array
  if (Array.isArray(obj)) {
    let bytes = ARRAY_OVERHEAD + obj.length * POINTER_SIZE
    addBytes(state, localCategory, bytes, 1)
    if (localEntityType) {
      ensureBucket(state.byEntityType, localEntityType).bytes += bytes
    }
    for (let i = 0; i < obj.length; i++) {
      const child = obj[i]
      const childCategory = resolveChildCategory(
        localCategory,
        String(i),
        child
      )
      bytes += walkValue(state, child, childCategory, localEntityType)
    }
    return bytes
  }

  // Generic object / class instance
  let bytes = OBJECT_OVERHEAD
  const keys = isPlainObject(obj)
    ? Object.getOwnPropertyNames(obj)
    : collectInstanceKeys(obj)

  // Property name strings + pointer slots
  for (const key of keys) {
    bytes += POINTER_SIZE
    // Hidden class / property name cost amortized; count key string once lightly
    bytes += Math.min(STRING_OVERHEAD + key.length * 2, 64)
  }

  addBytes(state, localCategory, bytes, 1)
  if (localEntityType) {
    ensureBucket(state.byEntityType, localEntityType).bytes += bytes
  }
  if (isEntity) {
    // Entity count already incremented; category count for entities tracks objects
  }

  for (const key of keys) {
    if (shouldSkipProperty(state, key, localCategory)) continue

    // Avoid walking back to owning database through private refs (cycle).
    if (key === '_database' || key === 'database') continue

    let child: unknown
    try {
      child = (obj as Record<string, unknown>)[key]
    } catch {
      continue
    }

    if (typeof child === 'function') continue

    // Dedicated handle-registry path: structure only
    if (key === '_handleRegistry' && child instanceof Map) {
      bytes += measureHandleRegistryOverhead(
        state,
        child as Map<string, object>
      )
      continue
    }

    const childCategory = resolveChildCategory(localCategory, key, child)
    if (!state.includeTransactionManager && childCategory === 'transaction') {
      continue
    }
    if (!state.includeEventManagers && childCategory === 'events') {
      continue
    }

    bytes += walkValue(state, child, childCategory, localEntityType)
  }

  return bytes
}

/**
 * Estimates the in-memory footprint of an {@link AcDbDatabase} by walking its
 * ownership graph and applying V8-inspired size heuristics.
 *
 * The estimate is reproducible and suitable for comparing drawings. It is not
 * an exact Chrome / V8 heap retained size; expect roughly ±20–30% versus
 * DevTools heap snapshots. Rendering GPU buffers and converter worker / WASM
 * heaps are not included.
 *
 * @param db - Drawing database to measure (typically after `read` / `openUri`).
 * @param options - Optional inclusion of transaction / event graphs.
 * @returns Structured estimate with category and entity-type breakdowns.
 *
 * @example
 * ```typescript
 * const report = acdbEstimateDatabaseMemory(database)
 * console.log(acdbFormatMemoryEstimate(report))
 * ```
 */
export function acdbEstimateDatabaseMemory(
  db: AcDbDatabase,
  options?: AcDbMemoryEstimateOptions
): AcDbMemoryEstimate {
  const state: WalkState = {
    visited: new WeakSet(),
    objectCount: 0,
    entityCount: 0,
    byCategory: new Map(),
    byEntityType: new Map(),
    includeTransactionManager: options?.includeTransactionManager === true,
    includeEventManagers: options?.includeEventManagers === true
  }

  // Root walk starts as sysvars for db-owned scalars; tables/objects keys
  // reclassify via resolveChildCategory.
  walkValue(state, db, 'sysvars', null)

  let totalBytes = 0
  const byCategory: Record<string, AcDbMemoryEstimateBucket> = {}
  for (const [key, bucket] of state.byCategory) {
    byCategory[key] = { bytes: bucket.bytes, count: bucket.count }
    totalBytes += bucket.bytes
  }

  const byEntityType: Record<string, AcDbMemoryEstimateBucket> = {}
  for (const [key, bucket] of state.byEntityType) {
    byEntityType[key] = { bytes: bucket.bytes, count: bucket.count }
  }

  return {
    totalBytes,
    objectCount: state.objectCount,
    entityCount: state.entityCount,
    byCategory,
    byEntityType
  }
}

/**
 * Formats a byte count as a short human-readable string using binary units
 * (`B`, `KiB`, or `MiB`).
 *
 * @param bytes - Non-negative byte count to format.
 * @returns Formatted size string, for example `"512 B"` or `"2.00 KiB"`.
 *
 * @example
 * ```typescript
 * acdbFormatMemoryBytes(512)    // "512 B"
 * acdbFormatMemoryBytes(2048)   // "2.00 KiB"
 * ```
 */
export function acdbFormatMemoryBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

/**
 * Formats an {@link AcDbMemoryEstimate} as multi-line text for console or UI
 * output, including totals plus category and entity-type breakdowns sorted by
 * descending byte size.
 *
 * @param report - Estimate produced by {@link acdbEstimateDatabaseMemory}.
 * @returns Human-readable multi-line summary string.
 *
 * @example
 * ```typescript
 * const report = acdbEstimateDatabaseMemory(database)
 * console.log(acdbFormatMemoryEstimate(report))
 * ```
 */
export function acdbFormatMemoryEstimate(report: AcDbMemoryEstimate): string {
  const lines: string[] = [
    `AcDbDatabase memory estimate: ${acdbFormatMemoryBytes(report.totalBytes)} (${report.totalBytes} bytes)`,
    `Objects: ${report.objectCount}, Entities: ${report.entityCount}`,
    'By category:'
  ]

  const categories = Object.entries(report.byCategory).sort(
    (a, b) => b[1].bytes - a[1].bytes
  )
  for (const [name, bucket] of categories) {
    lines.push(
      `  ${name}: ${acdbFormatMemoryBytes(bucket.bytes)} (${bucket.bytes} bytes), count=${bucket.count}`
    )
  }

  const entityTypes = Object.entries(report.byEntityType).sort(
    (a, b) => b[1].bytes - a[1].bytes
  )
  if (entityTypes.length > 0) {
    lines.push('By entity type:')
    for (const [name, bucket] of entityTypes) {
      lines.push(
        `  ${name}: ${acdbFormatMemoryBytes(bucket.bytes)} (${bucket.bytes} bytes), count=${bucket.count}`
      )
    }
  }

  return lines.join('\n')
}

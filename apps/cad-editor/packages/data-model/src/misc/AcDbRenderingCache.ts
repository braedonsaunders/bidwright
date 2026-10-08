import {
  AcCmColor,
  AcCmUiYieldGate,
  accmYieldToUi
} from '@mlightcad/common'
import { AcGeMatrix3d, AcGeVector3d } from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbBlockTableRecord } from '../database/AcDbBlockTableRecord'
import { AcDbEntity } from '../entity/AcDbEntity'

/**
 * Optional timing counters for one cache-miss block build during
 * {@link AcDbRenderingCache.draw}. Enable with
 * {@link AcDbRenderingCache.profiling} = true.
 */
export interface AcDbRenderingCacheBlockMissProfile {
  /** Block table record name (or `'(unnamed)'`). */
  blockName: string
  /** Entity `worldDraw` + `group` time in ms (excludes compact). */
  buildMs: number
  /** `compactForInstancing` time in ms. */
  compactMs: number
  /** Time spent cloning the template in {@link AcDbRenderingCache.set}. */
  setCloneMs: number
}

/**
 * Accumulated timing counters for {@link AcDbRenderingCache}.
 * Only updated while {@link AcDbRenderingCache.profiling} is true.
 */
export interface AcDbRenderingCacheProfileStats {
  /** Cache hit count (template already built). */
  hits: number
  /** Cache miss count (template built on this call). */
  misses: number
  /** Total time spent on hit path before apply/attribs (includes clone). */
  hitMs: number
  /** Miss path: entity worldDraw + group, excluding compact. */
  missBuildMs: number
  /** Miss path: compactForInstancing. */
  missCompactMs: number
  /** Time spent in get() → fastDeepClone (hit clones). */
  cloneMs: number
  /** Time spent in set() → fastDeepClone (store template). */
  setCloneMs: number
  /** applyMatrix + attribute attach after template ready. */
  applyMs: number
  /**
   * Same counters as above but only for outermost `draw()` calls
   * (excludes nested INSERT draws while building a parent template).
   */
  topLevel: {
    /** Top-level cache hits. */
    hits: number
    /** Top-level cache misses. */
    misses: number
    /** Top-level hit-path time in ms. */
    hitMs: number
    /** Top-level miss build time in ms. */
    missBuildMs: number
    /** Top-level compact time in ms. */
    missCompactMs: number
    /** Top-level hit-clone time in ms. */
    cloneMs: number
    /** Top-level set-clone time in ms. */
    setCloneMs: number
    /** Top-level apply/attribute time in ms. */
    applyMs: number
  }
  /** Per-block miss breakdown (all depths). */
  blockMisses: AcDbRenderingCacheBlockMissProfile[]
}

/**
 * Creates a zeroed top-level profile counter bag.
 *
 * @returns Fresh top-level stats object.
 */
const emptyTopLevel = () => ({
  hits: 0,
  misses: 0,
  hitMs: 0,
  missBuildMs: 0,
  missCompactMs: 0,
  cloneMs: 0,
  setCloneMs: 0,
  applyMs: 0
})

/**
 * Creates a zeroed {@link AcDbRenderingCacheProfileStats} instance.
 *
 * @returns Fresh profile stats with empty `blockMisses`.
 */
const emptyProfileStats = (): AcDbRenderingCacheProfileStats => ({
  hits: 0,
  misses: 0,
  hitMs: 0,
  missBuildMs: 0,
  missCompactMs: 0,
  cloneMs: 0,
  setCloneMs: 0,
  applyMs: 0,
  topLevel: emptyTopLevel(),
  blockMisses: []
})

/**
 * Internal class used to cache rendered results to avoid duplicated rendering.
 *
 * This class can be used to improve performance when rendering block references.
 * Blocks without ByBlock-colored entities share one color-independent template.
 * Blocks that contain ByBlock entities still key by block name and color because
 * different INSERT colors produce different materials.
 *
 * Templates may be compacted (same-material leaves merged) before or on first
 * reuse so each INSERT clones O(material) geometries instead of O(entity)
 * geometries. Mid-size templates defer compaction until the first cache hit so
 * one-shot blocks skip merge work; tiny templates never compact.
 *
 * @internal
 *
 * @example
 * ```typescript
 * const cache = AcDbRenderingCache.instance;
 * const color = new AcCmColor().setRGBValue(0xFF0000);
 * const key = cache.createKey('MyBlock', color);
 * const renderedEntity = cache.draw(renderer, blockRecord, color);
 * ```
 */
export class AcDbRenderingCache {
  /** Map of cached rendering results indexed by key. */
  private _blocks: Map<string, AcGiEntity>
  /** Estimated bytes per cached key (tracked only while LRU is enabled). */
  private _lruBytes: Map<string, number>
  /** Sum of {@link _lruBytes} values. */
  private _lruTotalBytes = 0
  /**
   * Evicted compacted templates awaiting document-close disposal. Compacted
   * templates share geometry buffers with clones already in the scene, so
   * they cannot be disposed at eviction time.
   */
  private _retiredCompactedTemplates: AcGiEntity[] = []
  /** Singleton instance of the cache. */
  private static _instance?: AcDbRenderingCache
  /**
   * When true, {@link draw} / {@link get} / {@link set} accumulate
   * {@link profileStats}. Off by default (zero overhead when false).
   */
  static profiling = false
  /**
   * LRU master switch. When false, the cache never evicts and behaves like
   * the pre-LRU implementation.
   */
  static lruEnabled = true
  /** Max cached templates before the oldest entries are evicted (0 = unlimited). */
  static lruMaxEntries = 512
  /**
   * Max estimated cached bytes before the oldest entries are evicted
   * (0 = unlimited). Estimates duck-type walk the template tree geometry.
   */
  static lruMaxEstimatedBytes = 64 * 1024 * 1024
  /**
   * Mutable profile accumulator used while {@link profiling} is true.
   */
  private static _profileStats: AcDbRenderingCacheProfileStats =
    emptyProfileStats()
  /** Nesting depth of {@link draw} while profiling (1 = outermost). */
  private static _drawDepth = 0

  /**
   * Accumulated profile counters. Only updated while {@link profiling} is true.
   */
  static get profileStats(): Readonly<AcDbRenderingCacheProfileStats> {
    return this._profileStats
  }

  /**
   * Clears {@link profileStats} and draw nesting depth.
   * Leaves {@link profiling} unchanged.
   */
  static resetProfile() {
    this._profileStats = emptyProfileStats()
    this._drawDepth = 0
  }

  /**
   * Gets the singleton instance of the rendering cache.
   *
   * @returns The singleton instance of AcDbRenderingCache
   *
   * @example
   * ```typescript
   * const cache = AcDbRenderingCache.instance;
   * ```
   */
  static get instance() {
    if (!this._instance) {
      this._instance = new AcDbRenderingCache()
    }
    return this._instance
  }

  /**
   * Creates a new AcDbRenderingCache instance.
   *
   * @example
   * ```typescript
   * const cache = new AcDbRenderingCache();
   * ```
   */
  constructor() {
    this._blocks = new Map()
    this._lruBytes = new Map()
  }

  /**
   * Creates a cache key by combining the block name and color.
   *
   * Prefer {@link createCacheKey} when the block's ByBlock dependency is known,
   * so color-independent blocks can share one template.
   *
   * @param name - The block name
   * @param color - The resolved block color
   * @returns A unique key for the cache entry
   *
   * @example
   * ```typescript
   * const color = new AcCmColor().setRGBValue(0xFF0000);
   * const key = cache.createKey('MyBlock', color);
   * // Returns: "MyBlock_RGB:255,0,0"
   * ```
   */
  createKey(name: string, color: AcCmColor) {
    let colorKey = color.toString()
    if (!colorKey && color.isByColor) {
      colorKey = `RGB:${color.red},${color.green},${color.blue}`
    }
    return `${name}_${colorKey}`
  }

  /**
   * Creates a cache key, omitting color when the block has no ByBlock entities.
   *
   * Color-independent keys let INSERTs that differ only by layer (ByLayer
   * traits remapped at instance time) share one compacted template.
   *
   * @param name - The block name
   * @param color - The resolved INSERT color (used only when `hasByBlockColor`)
   * @param hasByBlockColor - Whether any entity in the block uses ByBlock color
   * @returns Cache key: `name` alone, or `name_color` when ByBlock entities exist
   */
  createCacheKey(name: string, color: AcCmColor, hasByBlockColor: boolean) {
    if (!hasByBlockColor) {
      return name
    }
    return this.createKey(name, color)
  }

  /**
   * Stores rendering results of a block in the cache.
   *
   * Stores `group` by reference as an immutable template. Callers must not
   * mutate the stored object after this call; {@link get} / miss-path draws
   * return {@link AcGiEntity.fastDeepClone} instances for scene use. Compacted
   * templates share geometry buffers across clones (see three-renderer
   * `AcTrGroup.fastDeepClone`).
   *
   * @param key - The key for the rendering results
   * @param group - The rendering results to store
   * @returns The stored rendering results (same reference as `group`)
   *
   * @example
   * ```typescript
   * const renderedEntity = cache.set(key, entity);
   * ```
   */
  set(key: string, group: AcGiEntity) {
    // Templates are immutable after insert. Avoid a deep clone here — miss
    // path returns a per-INSERT clone, and compacted clones share buffers.
    this._blocks.set(key, group)
    if (AcDbRenderingCache.lruEnabled) {
      const prevBytes = this._lruBytes.get(key) ?? 0
      const bytes = this.estimateTemplateBytes(group)
      this._lruBytes.set(key, bytes)
      this._lruTotalBytes += bytes - prevBytes
      this.enforceLruBudget()
    }
    return group
  }

  /**
   * Evicts least-recently-used templates while the cache exceeds its entry or
   * estimated-byte budget.
   */
  private enforceLruBudget() {
    const maxEntries = AcDbRenderingCache.lruMaxEntries
    while (maxEntries > 0 && this._blocks.size > maxEntries) {
      this.evictOldest()
    }
    const maxBytes = AcDbRenderingCache.lruMaxEstimatedBytes
    while (
      maxBytes > 0 &&
      this._lruTotalBytes > maxBytes &&
      this._blocks.size > 1
    ) {
      this.evictOldest()
    }
  }

  /** Evicts the least-recently-used entry, disposing it when safe. */
  private evictOldest() {
    const oldest = this._blocks.keys().next()
    if (oldest.done || oldest.value === undefined) return
    const key = oldest.value
    const template = this._blocks.get(key)
    this._blocks.delete(key)
    this._lruTotalBytes -= this._lruBytes.get(key) ?? 0
    this._lruBytes.delete(key)
    if (!template) return
    if (isTemplateCompacted(template)) {
      // Compacted templates share geometry buffers with clones already handed
      // to the scene (see three-renderer AcTrGroup.fastDeepClone) — disposing
      // now would corrupt live INSERT instances. Retire instead; clear()
      // disposes them when the document closes.
      this._retiredCompactedTemplates.push(template)
    } else {
      template.dispose?.()
    }
  }

  /**
   * Estimates a template's byte footprint by walking its tree and summing
   * geometry attribute/index buffers. Returns 0 for objects that do not
   * expose `children`/`geometry` (non-three implementations).
   */
  private estimateTemplateBytes(template: AcGiEntity) {
    let bytes = 0
    const stack: unknown[] = [template]
    while (stack.length > 0) {
      const node = stack.pop() as
        | {
            children?: unknown[]
            geometry?: {
              attributes?: Record<string, { array?: ArrayBufferView }>
              index?: { array?: ArrayBufferView } | null
            }
          }
        | null
        | undefined
      if (node == null) continue
      if (node.geometry) {
        const attributes = node.geometry.attributes
        if (attributes) {
          for (const key in attributes) {
            const array = attributes[key]?.array
            if (array) bytes += array.byteLength
          }
        }
        const indexArray = node.geometry.index?.array
        if (indexArray) bytes += indexArray.byteLength
      }
      const children = node.children
      if (children) {
        for (let i = 0; i < children.length; i++) {
          stack.push(children[i])
        }
      }
    }
    return bytes
  }

  /**
   * Gets rendering results with the specified key.
   *
   * Returns a deep clone so callers can transform the instance without
   * mutating the cached template. Compacted templates share geometry buffers
   * with the clone (Object3D wrappers are still unique per INSERT).
   *
   * @param name - The key of the rendering results
   * @returns The cloned rendering results, or `undefined` if not found
   *
   * @example
   * ```typescript
   * const cachedEntity = cache.get('MyBlock_16711680');
   * if (cachedEntity) {
   *   // Use cached entity
   * }
   * ```
   */
  get(name: string) {
    const template = this._blocks.get(name)
    if (!template) {
      return undefined
    }
    if (AcDbRenderingCache.lruEnabled) {
      // Map insertion order is the LRU order; re-insert to mark most-recent.
      this._blocks.delete(name)
      this._blocks.set(name, template)
    }
    // Compact mid-size templates on first reuse so one-shot blocks never pay
    // compactForInstancing, while repeated INSERTs still clone O(material) leaves.
    // Uncompacted clones must deep-copy geometry (AcTrGroup.fastDeepClone defaults
    // shareGeometry to isCompacted) so this compact cannot dispose buffers still
    // aliased by earlier INSERT instances.
    if (AcDbRenderingCache.profiling) {
      const tCompact0 = performance.now()
      const compacted = this.maybeCompactTemplate(template, true)
      if (compacted) {
        const dt = performance.now() - tCompact0
        AcDbRenderingCache._profileStats.missCompactMs += dt
        if (AcDbRenderingCache._drawDepth === 1) {
          AcDbRenderingCache._profileStats.topLevel.missCompactMs += dt
        }
      }
      const t0 = performance.now()
      const block = template.fastDeepClone()
      const dt = performance.now() - t0
      AcDbRenderingCache._profileStats.cloneMs += dt
      if (AcDbRenderingCache._drawDepth === 1) {
        AcDbRenderingCache._profileStats.topLevel.cloneMs += dt
      }
      return block
    }
    this.maybeCompactTemplate(template, true)
    return template.fastDeepClone()
  }

  /**
   * Checks if rendering results with the specified key exist in the cache.
   *
   * @param name - The key to check
   * @returns True if the key exists in the cache, false otherwise
   *
   * @example
   * ```typescript
   * if (cache.has('MyBlock_16711680')) {
   *   console.log('Cached result found');
   * }
   * ```
   */
  has(name: string) {
    return this._blocks.has(name)
  }

  /**
   * Clears all cached rendering results and disposes owned geometry.
   *
   * @example
   * ```typescript
   * cache.clear();
   * console.log('Cache cleared');
   * ```
   */
  clear() {
    this._blocks.forEach(block => {
      block.dispose?.()
    })
    this._blocks.clear()
    this._lruBytes.clear()
    this._lruTotalBytes = 0
    this._retiredCompactedTemplates.forEach(template => {
      template.dispose?.()
    })
    this._retiredCompactedTemplates.length = 0
  }

  /**
   * Prebuilds color-independent block templates before entity flush.
   *
   * Skips layout blocks (`*Model_Space` / `*Paper_Space*`), empty blocks,
   * anonymous `*U` blocks, and blocks that contain ByBlock-colored entities
   * (those require the INSERT color and are built on demand).
   *
   * @param renderer - Renderer used to convert block entities
   * @param blocks - Iterator over block table records
   * @param progress - Optional progress callback `(built, total, blockName)`
   */
  async prebuildAll(
    renderer: AcGiRenderer,
    blocks: Iterable<AcDbBlockTableRecord>,
    progress?: (
      built: number,
      total: number,
      blockName: string
    ) => void | Promise<void>
  ) {
    const candidates: AcDbBlockTableRecord[] = []
    for (const block of blocks) {
      if (!block || !block.name) {
        continue
      }
      if (this.shouldSkipPrebuild(block)) {
        continue
      }
      candidates.push(block)
    }

    const total = candidates.length
    let built = 0
    // Color is unused for color-independent templates (no ByBlock entities).
    const prebuildColor = new AcCmColor().setForeground()
    // Time-budgeted rAF yields so progressive open UI can paint between
    // large blocks without stalling on many small ones.
    const yieldGate = new AcCmUiYieldGate()
    for (const block of candidates) {
      const key = this.createCacheKey(block.name, prebuildColor, false)
      if (!this.has(key)) {
        this.draw(renderer, block, prebuildColor, [], true)
      }
      built++
      if (progress) {
        await progress(built, total, block.name)
      }
      await yieldGate.maybeYield(accmYieldToUi)
    }
  }

  /**
   * Draws a block table record and optionally caches the result.
   *
   * This method renders the block table record using the specified renderer
   * and color, and optionally stores the result in the cache for future use.
   *
   * @param renderer - The renderer to use for drawing
   * @param blockTableRecord - The block table record to draw
   * @param blockColor - The resolved color to use for rendering
   * @param attributes - Attribute graphics to attach (WCS); converted to
   *   block-local space when `transform` is provided
   * @param cache - Whether to cache the rendering result (default: true)
   * @param transform - Optional block-reference transformation matrix
   * @param normal - Optional extrusion / normal vector
   * @returns The rendered entity
   *
   * @example
   * ```typescript
   * const renderedEntity = cache.draw(
   *   renderer,
   *   blockRecord,
   *   new AcCmColor().setRGBValue(0xFF0000),
   *   [],
   *   true,
   *   transform,
   *   normal
   * );
   * ```
   */
  draw(
    renderer: AcGiRenderer,
    blockTableRecord: AcDbBlockTableRecord,
    blockColor: AcCmColor,
    attributes: AcGiEntity[] = [],
    cache: boolean = true,
    transform?: AcGeMatrix3d,
    normal?: AcGeVector3d
  ) {
    const profile = AcDbRenderingCache.profiling
    if (profile) {
      AcDbRenderingCache._drawDepth++
    }
    const isTop = profile && AcDbRenderingCache._drawDepth === 1
    const stats = AcDbRenderingCache._profileStats
    const results: AcGiEntity[] = []
    try {
      if (blockTableRecord != null) {
        const blockRgb = blockColor.RGB ?? 0
        const blockName = blockTableRecord.name
        // Resolve cache hits without scanning block entities for ByBlock color.
        // Color-independent templates are keyed by name; ByBlock templates use
        // name+color. Miss path discovers ByBlock while building (one walk).
        let key: string | undefined
        if (blockName && this.has(blockName)) {
          key = blockName
        } else if (blockName) {
          const colorKey = this.createKey(blockName, blockColor)
          if (this.has(colorKey)) {
            key = colorKey
          }
        }

        let block: AcGiEntity | undefined
        if (key !== undefined) {
          const tHit0 = profile ? performance.now() : 0
          block = this.get(key)
          if (profile) {
            const dt = performance.now() - tHit0
            stats.hits++
            stats.hitMs += dt
            if (isTop) {
              stats.topLevel.hits++
              stats.topLevel.hitMs += dt
            }
          }
        } else {
          const tBuild0 = profile ? performance.now() : 0
          let sawByBlockColor = false
          const entities = blockTableRecord.newIterator()
          for (const entity of entities) {
            if (!entity.visibility) {
              continue
            }
            // ByBlock entities temporarily inherit the INSERT color for material
            // creation. Scratch stack is nest-safe across recursive draw().
            if (entity.color.isByBlock) {
              sawByBlockColor = true
              const savedColor = pushByBlockColorScratch(entity.color)
              try {
                if (blockColor.isForeground) {
                  entity.color.setForeground()
                } else {
                  entity.color.setRGBValue(blockRgb)
                }
                this.addEntity(entity, results, renderer)
              } finally {
                entity.color.copy(savedColor)
                popByBlockColorScratch(savedColor)
              }
            } else {
              this.addEntity(entity, results, renderer)
            }
          }
          block = renderer.group(results)
          let buildMs = 0
          if (profile) {
            buildMs = performance.now() - tBuild0
            stats.missBuildMs += buildMs
            if (isTop) {
              stats.topLevel.missBuildMs += buildMs
            }
          }
          // Adaptive compact for cached templates only:
          // - Tiny: never compact.
          // - Huge: compact eagerly on miss (clone cost dominates).
          // - Mid-size: defer until first cache hit so one-shot blocks skip it.
          // Anonymous *U / cache:false draws are one-shot — never compact.
          let compactMs = 0
          const willCache =
            !!cache && !!blockName && !blockName.startsWith('*U')
          if (block && willCache) {
            const tCompact0 = profile ? performance.now() : 0
            const compacted = this.maybeCompactTemplate(block, false)
            if (profile && compacted) {
              compactMs = performance.now() - tCompact0
              stats.missCompactMs += compactMs
              if (isTop) {
                stats.topLevel.missCompactMs += compactMs
              }
            }
          }
          key = this.createCacheKey(blockName, blockColor, sawByBlockColor)
          const setCloneBefore = profile ? stats.setCloneMs : 0
          if (block && willCache) {
            prepareCacheTemplate(block)
            // Store the immutable template by reference, then hand the scene a
            // per-INSERT clone so applyMatrix cannot mutate the cache entry.
            this.set(key, block)
            if (profile) {
              const tClone0 = performance.now()
              block = block.fastDeepClone()
              const dt = performance.now() - tClone0
              stats.setCloneMs += dt
              if (isTop) {
                stats.topLevel.setCloneMs += dt
              }
            } else {
              block = block.fastDeepClone()
            }
          }
          if (profile) {
            stats.misses++
            if (isTop) {
              stats.topLevel.misses++
            }
            stats.blockMisses.push({
              blockName: blockName || '(unnamed)',
              buildMs,
              compactMs,
              setCloneMs: stats.setCloneMs - setCloneBefore
            })
          }
        }

        const tApply0 = profile ? performance.now() : 0
        if (block && transform) {
          _tmpWorldTransform.copy(transform)
          block.applyMatrix(_tmpWorldTransform)
          if (normal && (normal.x != 0 || normal.y != 0 || normal.z != 1)) {
            _tmpExtrusion.setFromExtrusionDirection(normal)
            block.applyMatrix(_tmpExtrusion)
            _tmpWorldTransform.premultiply(_tmpExtrusion)
          }
        }
        if (block && attributes && attributes.length > 0) {
          // Attribute geometry is emitted in WCS. Convert it to block-local space so
          // the block reference transform applied above places it correctly.
          const inverse =
            transform != null
              ? _tmpInverse.copy(_tmpWorldTransform).invert()
              : undefined
          attributes.forEach(attrib => {
            if (inverse) {
              attrib.applyMatrix(inverse)
            }
            block.addChild(attrib)
          })
        }
        if (profile) {
          const dt = performance.now() - tApply0
          stats.applyMs += dt
          if (isTop) {
            stats.topLevel.applyMs += dt
          }
        }
        return block
      } else {
        return renderer.group(results)
      }
    } finally {
      if (profile) {
        AcDbRenderingCache._drawDepth--
      }
    }
  }

  /**
   * Returns whether `block` should be excluded from {@link prebuildAll}.
   *
   * Skips layout blocks, anonymous `*U` blocks, blocks with ByBlock colors
   * (key depends on INSERT color), and blocks with no visible entities.
   *
   * @param block - Block table record to evaluate.
   * @returns `true` when the block should not be prebuilt.
   */
  private shouldSkipPrebuild(block: AcDbBlockTableRecord): boolean {
    const name = block.name
    if (
      AcDbBlockTableRecord.isModelSapceName(name) ||
      AcDbBlockTableRecord.isPaperSapceName(name)
    ) {
      return true
    }
    if (name.startsWith('*U')) {
      return true
    }
    if (this.blockHasByBlockColor(block)) {
      return true
    }
    // Empty blocks produce nothing useful to cache.
    for (const entity of block.newIterator()) {
      if (entity.visibility) {
        return false
      }
    }
    return true
  }

  /**
   * Returns whether any visible entity in the block uses ByBlock color.
   *
   * @param blockTableRecord - Block whose entities are scanned.
   * @returns `true` when at least one visible ByBlock-colored entity exists.
   */
  private blockHasByBlockColor(blockTableRecord: AcDbBlockTableRecord): boolean {
    for (const entity of blockTableRecord.newIterator()) {
      if (entity.visibility && entity.color.isByBlock) {
        return true
      }
    }
    return false
  }

  /**
   * Draws one visible entity and appends its graphic result to `results`.
   *
   * @param entity - Database entity to convert.
   * @param results - Accumulator for graphic-interface entities.
   * @param renderer - Renderer used for `worldDraw`.
   */
  private addEntity(
    entity: AcDbEntity,
    results: AcGiEntity[],
    renderer: AcGiRenderer
  ) {
    if (!entity.visibility) {
      return
    }
    const object = entity.worldDraw(renderer)
    if (object) {
      this.attachEntityInfo(object, entity)
      results.push(object)
    }
  }

  /**
   * Copies database identity/layer/visibility onto a graphic-interface entity.
   *
   * @param target - Graphic entity produced by `worldDraw`.
   * @param source - Source database entity.
   */
  private attachEntityInfo(target: AcGiEntity, source: AcDbEntity) {
    target.objectId = source.objectId
    target.ownerId = source.ownerId
    target.layerName = source.layer
    target.visible = source.visibility
  }

  /**
   * Optionally runs {@link AcGiEntity.compactForInstancing} using the adaptive
   * thresholds in {@link shouldCompactTemplate}.
   *
   * @param entity - Block template group to consider compacting.
   * @param onCacheHit - When true, mid-size templates become eligible (first
   *   reuse). When false, only huge templates compact eagerly on miss.
   * @returns `true` when compaction ran.
   */
  private maybeCompactTemplate(
    entity: AcGiEntity,
    onCacheHit: boolean
  ): boolean {
    if (!entity.compactForInstancing) {
      return false
    }
    if (isTemplateCompacted(entity)) {
      return false
    }
    if (!shouldCompactTemplate(entity, onCacheHit)) {
      return false
    }
    entity.compactForInstancing()
    return true
  }
}

/** Scratch matrix for the INSERT world transform applied in {@link AcDbRenderingCache.draw}. */
const _tmpWorldTransform = /*@__PURE__*/ new AcGeMatrix3d()
/** Scratch matrix for extrusion/normal correction in {@link AcDbRenderingCache.draw}. */
const _tmpExtrusion = /*@__PURE__*/ new AcGeMatrix3d()
/** Scratch inverse of the world transform used to bring ATTRIB geometry into block space. */
const _tmpInverse = /*@__PURE__*/ new AcGeMatrix3d()

/**
 * Minimum direct child count before {@link AcGiEntity.compactForInstancing} is
 * worth running on a block template.
 *
 * Raised above the historical value of 3 so high-block-count drawings with many
 * tiny symbols skip classify/merge work that never pays back on clone.
 */
const MIN_CHILDREN_TO_COMPACT = 8

/**
 * Direct child count at which compaction runs eagerly on cache miss.
 *
 * Below this (but at/above {@link MIN_CHILDREN_TO_COMPACT}), compaction is
 * deferred until the first cache hit so one-shot blocks skip it entirely.
 */
const EAGER_COMPACT_CHILDREN = 32

/**
 * Nest-safe ByBlock color save/restore pool for {@link AcDbRenderingCache.draw}.
 * Avoids allocating a new {@link AcCmColor} per ByBlock entity on cache misses.
 */
const _byBlockColorScratch: AcCmColor[] = []

/**
 * Returns the direct child count of a graphic entity when available.
 *
 * @param entity - Group or entity produced by the renderer.
 * @returns {@link AcGiEntity.childCount}, or a large sentinel when unknown
 *   (favor compacting).
 */
function entityChildCount(entity: AcGiEntity): number {
  const count = entity.childCount
  return typeof count === 'number' ? count : Number.POSITIVE_INFINITY
}

/**
 * Returns whether `entity` has already been compacted for instancing.
 *
 * Duck-types optional `isCompacted` from three-renderer `AcTrGroup`.
 *
 * @param entity - Cached or freshly built block template.
 * @returns `true` when compaction has already run.
 */
function isTemplateCompacted(entity: AcGiEntity): boolean {
  const flag = (entity as AcGiEntity & { isCompacted?: boolean }).isCompacted
  return flag === true
}

/**
 * Decides whether a template should run {@link AcGiEntity.compactForInstancing}.
 *
 * @param entity - Block template to evaluate.
 * @param onCacheHit - When true, mid-size templates are eligible (lazy compact).
 * @returns `true` when compaction should run now.
 */
function shouldCompactTemplate(
  entity: AcGiEntity,
  onCacheHit: boolean
): boolean {
  const count = entityChildCount(entity)
  if (count < MIN_CHILDREN_TO_COMPACT) {
    return false
  }
  if (count >= EAGER_COMPACT_CHILDREN) {
    return true
  }
  // Mid-size: only on first cache hit so one-shot blocks skip merge work.
  return onCacheHit
}

/**
 * Finalizes deferred geometry and drops detached source shells before caching.
 *
 * Duck-types optional `prepareCacheTemplate` from three-renderer `AcTrGroup`.
 *
 * @param entity - Block template about to be stored in the cache.
 */
function prepareCacheTemplate(entity: AcGiEntity): void {
  const prepare = (
    entity as AcGiEntity & { prepareCacheTemplate?: () => void }
  ).prepareCacheTemplate
  if (typeof prepare === 'function') {
    prepare.call(entity)
  }
}

/**
 * Copies `color` into a pooled scratch and returns it.
 *
 * @param color - Entity color to snapshot before temporary ByBlock override.
 * @returns Pooled color holding a copy of `color`.
 */
function pushByBlockColorScratch(color: AcCmColor): AcCmColor {
  const scratch = _byBlockColorScratch.pop() ?? new AcCmColor()
  scratch.copy(color)
  return scratch
}

/**
 * Returns a scratch color from {@link pushByBlockColorScratch} to the pool.
 *
 * @param scratch - Color previously returned by {@link pushByBlockColorScratch}.
 */
function popByBlockColorScratch(scratch: AcCmColor): void {
  _byBlockColorScratch.push(scratch)
}

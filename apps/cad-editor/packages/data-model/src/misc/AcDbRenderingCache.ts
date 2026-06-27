import { AcCmColor } from '@mlightcad/common'
import { AcGeMatrix3d, AcGeVector3d } from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbBlockTableRecord } from '../database/AcDbBlockTableRecord'
import { AcDbEntity } from '../entity/AcDbEntity'

/**
 * Internal class used to cache rendered results to avoid duplicated rendering.
 *
 * This class can be used to improve performance when rendering block references.
 * Because different colors will result in different materials, the block name and
 * color are used together to create the cache key.
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
  /** Map of cached rendering results indexed by key */
  private _blocks: Map<string, AcGiEntity>
  /** Singleton instance of the cache */
  private static _instance?: AcDbRenderingCache

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
  }

  /**
   * Creates a cache key by combining the block name and color.
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
   * Stores rendering results of a block in the cache.
   *
   * @param key - The key for the rendering results
   * @param group - The rendering results to store
   * @returns The stored rendering results (deep cloned)
   *
   * @example
   * ```typescript
   * const renderedEntity = cache.set(key, entity);
   * ```
   */
  set(key: string, group: AcGiEntity) {
    group = group.fastDeepClone()
    this._blocks.set(key, group)
    return group
  }

  /**
   * Gets rendering results with the specified key.
   *
   * @param name - The key of the rendering results
   * @returns The rendering results with the specified key, or undefined if not found
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
    let block = this._blocks.get(name)
    if (block) {
      block = block.fastDeepClone()
    }
    return block
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
   * Clears all cached rendering results.
   *
   * @example
   * ```typescript
   * cache.clear();
   * console.log('Cache cleared');
   * ```
   */
  clear() {
    this._blocks.clear()
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
   * @param cache - Whether to cache the rendering result (default: true)
   * @param transform - Optional transformation matrix to apply
   * @param normal - Optional normal vector
   * @returns The rendered entity
   *
   * @example
   * ```typescript
   * const renderedEntity = cache.draw(
   *   renderer,
   *   blockRecord,
   *   new AcCmColor().setRGBValue(0xFF0000),
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
    const results: AcGiEntity[] = []
    if (blockTableRecord != null) {
      const blockRgb = blockColor.RGB ?? 0
      const key = this.createKey(blockTableRecord.name, blockColor)
      let block: AcGiEntity | undefined
      if (this.has(key)) {
        block = this.get(key)
      } else {
        const entities = blockTableRecord.newIterator()
        for (const entity of entities) {
          if (!entity.visibility) {
            continue
          }
          // If the color of this entity is 'byBlock', then store the original color of this entity color
          // and set the color of this entity to block's color. After renderering this entity, restore
          // its original color
          if (entity.color.isByBlock) {
            _tmpColor.copy(entity.color)
            if (blockColor.isForeground) {
              entity.color.setForeground()
            } else {
              entity.color.setRGBValue(blockRgb)
            }
            this.addEntity(entity, results, renderer)
            entity.color.copy(_tmpColor)
          } else {
            this.addEntity(entity, results, renderer)
          }
        }
        block = renderer.group(results)
        if (block && cache) {
          // If one block is one transient block whose name starts with '*U', don't cache it
          if (
            AcDbBlockTableRecord.name &&
            !AcDbBlockTableRecord.name.startsWith('*U')
          ) {
            this.set(key, block)
          }
        }
      }

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
      return block
    } else {
      return renderer.group(results)
    }
  }

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

  private attachEntityInfo(target: AcGiEntity, source: AcDbEntity) {
    target.objectId = source.objectId
    target.ownerId = source.ownerId
    target.layerName = source.layer
    target.visible = source.visibility
  }
}

const _tmpColor = /*@__PURE__*/ new AcCmColor()
const _tmpWorldTransform = /*@__PURE__*/ new AcGeMatrix3d()
const _tmpExtrusion = /*@__PURE__*/ new AcGeMatrix3d()
const _tmpInverse = /*@__PURE__*/ new AcGeMatrix3d()

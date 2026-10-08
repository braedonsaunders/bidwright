import { AcGeMatrix3d } from '@mlightcad/geometry-engine'

/**
 * Interface that all of display objects need to implement.
 */
export interface AcGiEntity {
  /**
   * Object id of the associated entity in drawing database. When adding this entity into scene,
   * do remember setting the value of this property.
   */
  get objectId(): string
  set objectId(value: string)

  /**
   * The object Id of the owner of the object. When adding this entity into scene, do remember
   * setting the value of this property.
   */
  get ownerId(): string
  set ownerId(value: string)

  /**
   * The name of the layer referenced by this entity
   */
  get layerName(): string
  set layerName(value: string)

  /**
   * Object's visibility
   */
  get visible(): boolean
  set visible(value: boolean)

  /**
   * An object that can be used to store custom data about the entity.
   */
  get userData(): object
  set userData(value: object)

  /**
   * Adds one child entity for the current entity
   * @param child - The child entity to add
   */
  addChild(child: AcGiEntity): void

  /**
   * Direct child count for group-like nodes.
   *
   * Used as a cheap heuristic before {@link compactForInstancing} (skip
   * compaction for tiny templates). Leaf entities may omit this; callers treat
   * a missing value as unknown and favor compacting.
   */
  readonly childCount?: number

  /**
   * Apply the matrix transform to the object and updates the object's position, rotation and scale.
   * @param matrix Input the matrix to apply
   */
  applyMatrix(matrix: AcGeMatrix3d): void

  /**
   * Highlight this entity.
   */
  highlight(): void

  /**
   * Unhighlight this entity
   */
  unhighlight(): void

  /**
   * Return a clone of this object and its direct children (not all descendants).
   * So it means that you need to gurantee the object is flatten by call method
   * 'flatten' before calling this function.
   *
   * Implementations may deep-clone geometry, or (for immutable block-template
   * caches) alias leaf buffers and mark them so instance dispose skips them.
   * Materials are reused and not deeply cloned.
   *
   * @param shareGeometry - When true, leaf drawables may alias source
   *   geometry buffers instead of deep-cloning them.
   * @returns Return a clone of this object and optionally all descendants.
   */
  fastDeepClone(shareGeometry?: boolean): AcGiEntity

  /**
   * Optionally merges same-material drawable leaves so later
   * {@link fastDeepClone} copies far fewer geometries.
   *
   * Used by block-reference template caching. Must be called before the INSERT
   * transform is applied while the entity is still at identity. Implementations
   * that do not support compaction may omit this method.
   *
   * @returns Nothing.
   */
  compactForInstancing?(): void

  /**
   * Optionally prepares this entity as an immutable block-template cache entry.
   *
   * Typical implementations finalize deferred drawables and drop detached
   * source-entity shells without merging leaves. Used by rendering cache miss
   * paths before {@link fastDeepClone} for scene use.
   *
   * @returns Nothing.
   */
  prepareCacheTemplate?(): void

  /**
   * Optionally releases GPU/CPU resources owned by this entity.
   *
   * Used when clearing the block rendering cache. Implementations that do not
   * own disposable resources may omit this method. Shared materials from a
   * style cache should not be disposed here unless the implementation owns them.
   *
   * @returns Nothing.
   */
  dispose?(): void
}

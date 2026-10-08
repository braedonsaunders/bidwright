import { AcDbObjectId } from '../base/AcDbObject'
import { AcDbEntity } from '../entity/AcDbEntity'
import { AcDbBlockTableRecord } from './AcDbBlockTableRecord'
import { AcDbDatabase } from './AcDbDatabase'
import { AcDbSymbolTable } from './AcDbSymbolTable'

/**
 * Symbol table for block table records.
 *
 * This class manages block table records which represent block definitions
 * within a drawing database. Blocks are reusable collections of entities
 * that can be inserted multiple times into a drawing.
 *
 * @example
 * ```typescript
 * const blockTable = new AcDbBlockTable(database);
 * const modelSpace = blockTable.modelSpace;
 * const block = blockTable.getAt('MyBlock');
 * ```
 */
export class AcDbBlockTable extends AcDbSymbolTable<AcDbBlockTableRecord> {
  /**
   * Creates a new AcDbBlockTable instance.
   *
   * @param db - The database this block table belongs to
   *
   * @example
   * ```typescript
   * const blockTable = new AcDbBlockTable(database);
   * ```
   */
  constructor(db: AcDbDatabase) {
    super(db)
  }

  /**
   * Gets the MODEL_SPACE block table record.
   *
   * This method returns the model space block table record, creating it
   * if it doesn't exist. Model space is the primary drawing area where
   * most entities are created and stored.
   *
   * @returns The MODEL_SPACE block table record
   *
   * @example
   * ```typescript
   * const modelSpace = blockTable.modelSpace;
   * const entities = modelSpace.entities;
   * ```
   */
  get modelSpace(): AcDbBlockTableRecord {
    let modelSpace = this.getAt(AcDbBlockTableRecord.MODEL_SPACE_NAME)
    if (!modelSpace) {
      modelSpace = new AcDbBlockTableRecord()
      modelSpace.name = AcDbBlockTableRecord.MODEL_SPACE_NAME
      this.add(modelSpace)
    }
    return modelSpace
  }

  /**
   * Searches for an entity in all of block table records with the specified ID.
   *
   * @param id - The entity ID to search for
   * @returns The entity with the specified ID, or undefined if not found
   */
  getEntityById(id: AcDbObjectId) {
    const object = this.database.getObjectById(id)
    if (object instanceof AcDbEntity) {
      return object
    }
    return undefined
  }

  /**
   * Removes the specified entity or entities from the block table.
   *
   * Notes:
   * Please call method AcDbEntity.erase to remove one entity instead of calling
   * this function.
   *
   * AutoCAD ObjectARX API doesn't provide such one method to remove entities
   * from the block table. I guess it is done by friend class or function
   * feature in C++. However, there are no similar feature in TypeScript. So
   * we have to expose such one public method in AcDbBlockTable.
   *
   * @param objectId - The object id or ids of entities to remove from this block table
   * @returns — true if an entity in the block table existed and has been removed,
   * or false if the entity does not exist.
   */
  removeEntity(objectId: AcDbObjectId | AcDbObjectId[]) {
    let result = false
    for (const btr of this.database.tables.blockTable.newIterator()) {
      if (btr.removeEntity(objectId)) {
        result = true
        break
      }
    }
    return result
  }

  /**
   * Returns all block table records that are external references (or overlays).
   */
  getXrefs(): AcDbBlockTableRecord[] {
    const result: AcDbBlockTableRecord[] = []
    for (const btr of this.newIterator()) {
      if (btr.isXref) {
        result.push(btr)
      }
    }
    return result
  }

  /**
   * Returns xref block table records whose external content has not been loaded.
   */
  getUnresolvedXrefs(): AcDbBlockTableRecord[] {
    return this.getXrefs().filter(btr => btr.isUnresolvedXref)
  }

  /**
   * Normalizes the specified block table record name if it is one paper spacce or model space
   * block table record.
   *
   * @override
   * @param name - The name of the block table record.
   * @returns The normalized block table record name.
   */
  protected normalizeName(name: string) {
    const trimmed = (name ?? '').trim()
    if (!trimmed) {
      return ''
    }
    if (AcDbBlockTableRecord.isModelSapceName(trimmed)) {
      return AcDbBlockTableRecord.MODEL_SPACE_NAME
    }
    if (AcDbBlockTableRecord.isPaperSapceName(trimmed)) {
      const prefix = AcDbBlockTableRecord.PAPER_SPACE_NAME_PREFIX
      const suffix = trimmed.substring(prefix.length)
      return prefix + suffix
    }
    return super.normalizeName(trimmed)
  }
}

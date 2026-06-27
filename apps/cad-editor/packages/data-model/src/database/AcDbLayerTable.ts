import { AcDbDatabase } from './AcDbDatabase'
import { AcDbLayerTableRecord } from './AcDbLayerTableRecord'
import { AcDbSymbolTable } from './AcDbSymbolTable'

/**
 * Symbol table for layer table records.
 *
 * This class manages layer table records which represent layers within a
 * drawing database. Layers are used to organize and control the display
 * of entities in the drawing. Each layer can have its own color, linetype,
 * visibility settings, and other properties.
 *
 * @example
 * ```typescript
 * const layerTable = new AcDbLayerTable(database);
 * const layer = layerTable.getAt('0');
 * const newLayer = new AcDbLayerTableRecord({ name: 'MyLayer' });
 * layerTable.add(newLayer);
 * ```
 */
export class AcDbLayerTable extends AcDbSymbolTable<AcDbLayerTableRecord> {
  /**
   * Creates a new AcDbLayerTable instance.
   *
   * This constructor automatically creates a default layer named '0' with
   * white color and continuous linetype.
   *
   * @param db - The database this layer table belongs to
   *
   * @example
   * ```typescript
   * const layerTable = new AcDbLayerTable(database);
   * ```
   */
  constructor(db: AcDbDatabase) {
    super(db)
  }

  /**
   * Adds a layer table record to this layer table.
   *
   * This method overrides the base class method to dispatch a layerAppended
   * event when a new layer is added to the table.
   *
   * @param record - The layer table record to add
   *
   * @example
   * ```typescript
   * const newLayer = new AcDbLayerTableRecord({ name: 'MyLayer' });
   * layerTable.add(newLayer);
   * ```
   */
  add(record: AcDbLayerTableRecord) {
    super.add(record)
    this.database.events.layerAppended.dispatch({
      database: this.database,
      layer: record
    })
  }
}

import { AcDbDatabase } from './AcDbDatabase'
import { AcDbSymbolTable } from './AcDbSymbolTable'
import { AcDbUcsTableRecord } from './AcDbUcsTableRecord'

/**
 * Symbol table for named User Coordinate Systems (DXF UCS table).
 */
export class AcDbUcsTable extends AcDbSymbolTable<AcDbUcsTableRecord> {
  /**
   * Creates a new AcDbUcsTable instance.
   *
   * @param db - The database this UCS table belongs to
   */
  constructor(db: AcDbDatabase) {
    super(db)
  }
}

import { AcDbTrace } from './AcDbTrace'

/**
 * Represents a solid entity in AutoCAD.
 *
 * A solid is a filled four-sided (or triangular) polygon. Dimension arrowheads
 * are typically authored as `SOLID` entities inside anonymous dimension blocks.
 * Geometry and DXF subclass data are shared with {@link AcDbTrace}
 * (`AcDbTrace`); only the DXF entity type name differs (`SOLID` vs `TRACE`).
 */
export class AcDbSolid extends AcDbTrace {
  /** The entity type name */
  static override typeName: string = 'Solid'

  override get dxfTypeName() {
    return 'SOLID'
  }
}

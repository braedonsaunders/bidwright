import { AcGeBox2d } from '@mlightcad/geometry-engine'

import { ACTIVE_VPORT_NAME } from '../misc/AcDbConstants'
import { AcDbDatabase } from './AcDbDatabase'
import { AcDbSymbolTable } from './AcDbSymbolTable'
import { AcDbViewportTableRecord } from './AcDbViewportTableRecord'

/**
 * Symbol table for viewport table records.
 *
 * This class manages viewport table records which represent viewport configurations
 * within AutoCAD. Viewports define how the drawing is displayed in different
 * areas of the screen or paper space, including zoom levels, pan positions,
 * and other display properties.
 *
 * @example
 * ```typescript
 * const viewportTable = new AcDbViewportTable(database);
 * const viewport = viewportTable.getAt(ACTIVE_VPORT_NAME);
 * ```
 */
export class AcDbViewportTable extends AcDbSymbolTable<AcDbViewportTableRecord> {
  /**
   * Creates a new AcDbViewportTable instance.
   *
   * @param db - The database this viewport table belongs to
   *
   * @example
   * ```typescript
   * const viewportTable = new AcDbViewportTable(database);
   * ```
   */
  constructor(db: AcDbDatabase) {
    super(db)
  }

  /**
   * Normalizes VPORT table record names for AutoCAD-compatible lookup.
   *
   * The reserved active viewport name compares case-insensitively and is stored
   * as `*Active`. All other configuration names also compare case-insensitively.
   *
   * @override
   * @param name - The name of the viewport table record.
   * @returns The normalized viewport table record name.
   */
  protected normalizeName(name: string) {
    if (AcDbViewportTableRecord.isActiveVportName(name)) {
      return ACTIVE_VPORT_NAME
    }
    return name.toUpperCase()
  }

  /**
   * Returns the model-space VPORT table record AutoCAD saves as `*Active`.
   */
  getActiveVport(): AcDbViewportTableRecord | undefined {
    return this.getAt(ACTIVE_VPORT_NAME)
  }

  /**
   * Returns the initial model-space view box from VPORT `*ACTIVE`, if present
   * and usable.
   */
  getActiveVportBox(
    canvasAspectRatio: number,
    drawingExtents?: AcGeBox2d
  ): AcGeBox2d | undefined {
    const vport = this.getActiveVport()
    return vport?.resolveModelViewBox(canvasAspectRatio, drawingExtents)
  }
}

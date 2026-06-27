import { AcGeArea2d, AcGePolyline2d } from '@mlightcad/geometry-engine'
import { AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbRasterImage } from './AcDbRasterImage'

/**
 * Entity that creates a blank area in the drawing.
 *
 * The AcDbWipeout entity creates a blank area that covers other entities
 * in the drawing. It's commonly used to hide parts of the drawing or
 * create clean areas for annotations. The wipeout area is defined by
 * a boundary path and is rendered as a solid black fill.
 *
 * @example
 * ```typescript
 * const wipeout = new AcDbWipeout();
 * // Set up boundary path and other properties
 * wipeout.draw(renderer);
 * ```
 */
export class AcDbWipeout extends AcDbRasterImage {
  /** The entity type name */
  static override typeName: string = 'Wipeout'

  override get dxfTypeName() {
    return 'WIPEOUT'
  }
  /**
   * Draws the wipeout entity.
   *
   * This method creates a solid black area based on the boundary path
   * of the wipeout entity. The area covers all entities behind it,
   * effectively "wiping out" that portion of the drawing.
   *
   * @param renderer - The renderer to use for drawing
   * @returns The rendered entity or undefined if rendering failsenderedEntity = wipeout.draw(renderer);
   * ```
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const points = this.boundaryPath()
    const area = new AcGeArea2d()
    area.add(new AcGePolyline2d(points))
    return renderer.area(area)
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    // WIPEOUT has the same subclassMarker as its parent
    return this
  }
}

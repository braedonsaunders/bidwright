import { AcGePoint3dLike } from '@mlightcad/geometry-engine'

import { AcDbEntity } from './AcDbEntity'

/**
 * Abstract base class for all curve entities.
 *
 * This class provides the fundamental functionality for all curve entities,
 * including the ability to determine if a curve is closed. A curve is
 * considered closed if its start point is identical to its end point.
 *
 * @example
 * ```typescript
 * class MyCurve extends AcDbCurve {
 *   get closed(): boolean {
 *     // Implementation to determine if curve is closed
 *     return this.startPoint.equals(this.endPoint);
 *   }
 * }
 * ```
 */
export abstract class AcDbCurve extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Curve'

  /**
   * Returns true if the curve is closed.
   *
   * A curve is considered closed if its start point is identical to its end point.
   * This property is used by various operations that need to know if a curve
   * forms a complete loop.
   *
   * @returns True if the curve is closed, false otherwise
   *
   * @example
   * ```typescript
   * const curve = new AcDbCircle();
   * console.log('Is circle closed?', curve.closed); // true
   *
   * const line = new AcDbLine();
   * console.log('Is line closed?', line.closed); // false
   * ```
   */
  abstract get closed(): boolean

  /**
   * The area enclosed by this curve. Returns `0` when the curve does not form a
   * closed region.
   */
  abstract get area(): number

  /**
   * Creates offset curves at the given signed distance, similar to ObjectARX
   * `AcDbCurve::getOffsetCurves`.
   *
   * The sign of `offsetDist` determines the offset side relative to the curve
   * direction in the curve plane. Returns an empty array when offsetting fails.
   *
   * @param offsetDist - Signed offset distance in drawing units
   * @returns Offset curve entities (equivalent to `AcDbVoidPtrArray`)
   */
  abstract getOffsetCurves(offsetDist: number): AcDbCurve[]

  /**
   * Determines which side of this curve a point lies on for offset operations.
   *
   * @param point - Test point in WCS
   * @returns `1` for the positive offset side, `-1` for the negative side
   */
  getOffsetSideAtPoint(_point: AcGePoint3dLike): 1 | -1 {
    return 1
  }
}

/**
 * Abstract base class for all kinds of geometries.
 */
export abstract class AcGeShape {
  protected _boundingBoxNeedsUpdate: boolean = false

  /**
   * When this is set, it calculates the bounding box of this shape and resets this property to false.
   * Default is false.
   */
  get boundingBoxNeedUpdate() {
    return this._boundingBoxNeedsUpdate
  }

  /**
   * Return a deep-cloned copy of this shape.
   */
  abstract clone(): AcGeShape
}

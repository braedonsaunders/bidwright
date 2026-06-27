import { AcDbAlignedDimension } from './AcDbAlignedDimension'

/**
 * Represents a rotated linear dimension entity in AutoCAD.
 *
 * A rotated dimension is similar to an aligned dimension, but its dimension line
 * direction is controlled by an explicit rotation angle.
 */
export class AcDbRotatedDimension extends AcDbAlignedDimension {
  /** The entity type name */
  static override typeName: string = 'RotatedDimension'

  /**
   * @inheritdoc
   */
  protected override get dxfSubclassMarker() {
    return 'AcDbRotatedDimension'
  }
}

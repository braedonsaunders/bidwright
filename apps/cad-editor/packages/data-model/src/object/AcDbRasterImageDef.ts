import { AcGePoint2d } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject } from '../base/AcDbObject'

/**
 * The AcDbRasterImageDef object (or "image definition object") works with the AcDbRasterImage entity
 * (or "image entity") to implement raster images inside AutoCAD.
 *
 * The relationship between these two classes is much like the relationship between an AutoCAD block
 * definition object and a block insert entity. The image definition object plays a behind-the-scenes
 * role like the block definition, maintaining links to the source image file and managing low-level
 * image processing operations required to display and plot images. Image definition objects are stored
 * in a special AcDbDictionary named ISM_RASTER_IMAGE_DICT.
 *
 * @example
 * ```typescript
 * const imageDef = new AcDbRasterImageDef();
 * imageDef.sourceFileName = '/path/to/image.jpg';
 * ```
 */
export class AcDbRasterImageDef extends AcDbObject {
  /** The path name of the externally referenced image file */
  private _sourceFileName: string
  /** Class version of this image definition (DXF group 90). */
  private _classVersion: number
  /** Image size in pixels, U and V values (DXF groups 10/20). */
  private _imageSize: AcGePoint2d
  /** Default size of one pixel in drawing units, U and V values (DXF groups 11/12). */
  private _pixelSize: AcGePoint2d
  /** Whether the image file is loaded (DXF group 280). */
  private _isLoaded = true
  /**
   * Resolution units (DXF group 281):
   * 0 = none, 2 = centimeters, 5 = inches.
   */
  private _resolutionUnits = 0

  /**
   * Creates a new AcDbRasterImageDef instance.
   *
   * @example
   * ```typescript
   * const imageDef = new AcDbRasterImageDef();
   * ```
   */
  constructor() {
    super()
    this._sourceFileName = ''
    this._classVersion = 0
    this._imageSize = new AcGePoint2d()
    this._pixelSize = new AcGePoint2d(1, 1)
  }

  /**
   * Gets the path name of the externally referenced image file.
   *
   * @returns The source file name/path
   *
   * @example
   * ```typescript
   * const fileName = imageDef.sourceFileName;
   * console.log('Image file:', fileName);
   * ```
   */
  get sourceFileName() {
    return this._sourceFileName
  }

  /**
   * Sets the path name of the externally referenced image file.
   *
   * @param value - The new source file name/path
   *
   * @example
   * ```typescript
   * imageDef.sourceFileName = '/path/to/image.jpg';
   * ```
   */
  set sourceFileName(value: string) {
    this._sourceFileName = value
  }

  /**
   * Gets the class version of this image definition (DXF group 90).
   */
  get classVersion() {
    return this._classVersion
  }

  /**
   * Sets the class version of this image definition (DXF group 90).
   */
  set classVersion(value: number) {
    this._classVersion = value
  }

  /**
   * Gets the image size in pixels (U/V values, DXF groups 10/20).
   */
  get imageSize() {
    return this._imageSize
  }

  /**
   * Sets the image size in pixels (U/V values, DXF groups 10/20).
   */
  set imageSize(value: AcGePoint2d) {
    this._imageSize.copy(value)
  }

  /**
   * Gets the default size of one pixel in drawing units (U/V values,
   * DXF groups 11/12).
   */
  get pixelSize() {
    return this._pixelSize
  }

  /**
   * Sets the default size of one pixel in drawing units (U/V values,
   * DXF groups 11/12).
   */
  set pixelSize(value: AcGePoint2d) {
    this._pixelSize.copy(value)
  }

  /** Whether the image file is loaded (DXF group 280). */
  get isLoaded() {
    return this._isLoaded
  }
  set isLoaded(value: boolean) {
    this._isLoaded = value
  }

  /**
   * Resolution units (DXF group 281): 0 = none, 2 = centimeters, 5 = inches.
   */
  get resolutionUnits() {
    return this._resolutionUnits
  }
  set resolutionUnits(value: number) {
    this._resolutionUnits = value
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbRasterImageDef')
    filer.writeInt32(90, this.classVersion)
    filer.writeString(1, this.sourceFileName)
    filer.writePoint2d(10, this.imageSize)
    // Pixel size uses groups 11/12 (not the usual 11/21 pairing).
    filer.writeDouble(11, this.pixelSize.x)
    filer.writeDouble(12, this.pixelSize.y)
    filer.writeInt16(280, this.isLoaded ? 1 : 0)
    filer.writeInt16(281, this.resolutionUnits)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbRasterImageDef')

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 1:
          this.sourceFileName = String(item.value)
          break
        case 90:
          this.classVersion = n
          break
        case 10:
          this.imageSize.x = n
          break
        case 20:
          this.imageSize.y = n
          break
        case 11:
          // Pixel size uses groups 11/12 (not the usual 11/21 pairing).
          this.pixelSize.x = n
          break
        case 12:
          this.pixelSize.y = n
          break
        case 280:
          this.isLoaded = n !== 0
          break
        case 281:
          this.resolutionUnits = n
          break
        case 100:
          filer.pushBackItem(item)
          return this
        default:
          break
      }
    }
    return this
  }
}

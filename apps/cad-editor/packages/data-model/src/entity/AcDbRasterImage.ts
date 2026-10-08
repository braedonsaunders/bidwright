import {
  AcGeBox2d,
  AcGeBox3d,
  AcGeIntersectPrimitive,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector2d,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiMTextAttachmentPoint,
  AcGiMTextData,
  AcGiRenderer,
  AcGiTextStyle
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObjectId } from '../base/AcDbObject'
import { DEFAULT_TEXT_STYLE } from '../misc/AcDbConstants'
import { acdbDrawImageFrame } from '../misc/acdbDrawImageFrame'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbForEachGripIndex } from './AcDbGripHelpers'
import { acdbIntersectPrimitivesFromPointPath } from './AcDbIntersectHelpers'
import { acdbCollectVertexPathOsnapPoints } from './AcDbOsnapHelpers'
import {
  acdbEscapePlainTextForMText,
  acdbEstimatePlainTextWidth
} from './AcDbTextExtentsHelpers'

/**
 * Defines the clip boundary type for raster images.
 */
export enum AcDbRasterImageClipBoundaryType {
  /** Undefined state */
  Invalid = 0,
  /** Rectangle aligned with the image pixel coordinate system */
  Rect = 1,
  /** Polygon with points entirely within the image boundary */
  Poly = 2
}

/**
 * Defines the display options for raster images.
 */
export enum AcDbRasterImageImageDisplayOpt {
  /** Show image (or draw frame only) */
  Show = 1,
  /** Show rotates images (or draw frame only) */
  ShowUnAligned = 2,
  /** Clip image */
  Clip = 4,
  /** Use transparent background for bitonal images (or use opaque background color) */
  Transparent = 8
}

/**
 * Represents a raster image entity in AutoCAD.
 *
 * The AcDbRasterImage entity (or "image entity") works with the AcDbRasterImageDef object
 * (or "image definition object") to implement raster images inside AutoCAD. The relationship
 * between these two classes is much like the relationship between an AutoCAD block definition
 * object and a block insert entity.
 *
 * Two or more image entities can be linked to a single image definition object. Since each
 * image entity has its own clip boundary, this is an efficient way to display different
 * regions of a single raster image at different positions in the drawing.
 *
 * @example
 * ```typescript
 * // Create a raster image entity
 * const rasterImage = new AcDbRasterImage();
 * rasterImage.position = new AcGePoint3d(0, 0, 0);
 * rasterImage.width = 100;
 * rasterImage.height = 75;
 * rasterImage.scale = new AcGeVector2d(1, 1);
 * rasterImage.rotation = 0;
 * rasterImage.brightness = 50;
 * rasterImage.contrast = 50;
 *
 * // Access raster image properties
 * console.log(`Position: ${rasterImage.position}`);
 * console.log(`Width: ${rasterImage.width}`);
 * console.log(`Height: ${rasterImage.height}`);
 * ```
 */
export class AcDbRasterImage extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'RasterImage'

  override get dxfTypeName() {
    return 'IMAGE'
  }

  /** The current brightness value of the image (0-100) */
  private _brightness: number
  /** The current contrast value of the image (0-100) */
  private _contrast: number
  /** The current fade value of the image (0-100) */
  private _fade: number
  /** The width of the image */
  private _width: number
  /** The height of the image */
  private _height: number
  /** The position of the image in WCS coordinates */
  private _position: AcGePoint3d
  /** The rotation angle of the image in radians */
  private _rotation: number
  /** The scale factors for the image */
  private _scale: AcGeVector2d
  /** The image size in pixels (U and V values) */
  private _imageSize: AcGePoint2d
  /** The clip boundary type */
  private _clipBoundaryType: AcDbRasterImageClipBoundaryType
  /** The clip boundary points */
  private _clipBoundary: AcGePoint2d[]
  /** The image definition object ID */
  private _imageDefId: AcDbObjectId
  /** Whether the image is clipped */
  private _isClipped: boolean
  /** Whether to use clipping boundary */
  private _isShownClipped: boolean
  /** Whether the image is shown */
  private _isImageShown: boolean
  /** Whether the image is transparent */
  private _isImageTransparent: boolean
  /** Class version (DXF group 90) */
  private _classVersion = 0
  /**
   * Clip mode (DXF group 290): 0 = outside mode, 1 = inside mode.
   */
  private _clipMode = 0
  /** The image data as a Blob */
  private _image?: Blob

  /**
   * Creates a new raster image entity.
   *
   * This constructor initializes a raster image with default values.
   * The brightness and contrast are set to 50, fade to 0, position to origin,
   * scale to (1,1), rotation to 0, and clip boundary type to Rect.
   *
   * @example
   * ```typescript
   * const rasterImage = new AcDbRasterImage();
   * rasterImage.position = new AcGePoint3d(10, 20, 0);
   * rasterImage.width = 200;
   * rasterImage.height = 150;
   * ```
   */
  constructor() {
    super()
    this._brightness = 50
    this._contrast = 50
    this._fade = 0
    this._width = 0
    this._height = 0
    this._position = new AcGePoint3d()
    this._scale = new AcGeVector2d(1, 1)
    this._rotation = 0
    this._imageSize = new AcGePoint2d()
    this._clipBoundaryType = AcDbRasterImageClipBoundaryType.Rect
    this._clipBoundary = []
    this._isClipped = false
    this._isShownClipped = false
    this._isImageShown = true
    this._isImageTransparent = false
    this._imageDefId = ''
  }

  /**
   * Gets the current brightness value of the image.
   *
   * @returns The brightness value (0-100)
   *
   * @example
   * ```typescript
   * const brightness = rasterImage.brightness;
   * console.log(`Image brightness: ${brightness}`);
   * ```
   */
  get brightness() {
    return this._brightness
  }
  set brightness(value: number) {
    this._brightness = value
  }

  /**
   * The current contrast value of the image.
   */
  get contrast() {
    return this._contrast
  }
  set contrast(value: number) {
    this._contrast = value
  }

  /**
   * The current fade value of the image.
   */
  get fade() {
    return this._fade
  }
  set fade(value: number) {
    this._fade = value
  }

  /**
   * The height of the image.
   */
  get height() {
    return this._height
  }
  set height(value: number) {
    this._height = value
  }

  /**
   * The width of the image.
   */
  get width() {
    return this._width
  }
  set width(value: number) {
    this._width = value
  }

  /**
   * The position of the image in wcs.
   */
  get position() {
    return this._position
  }
  set position(value: AcGePoint3d) {
    this._position = value
  }

  /**
   * The rotation of the image.
   */
  get rotation() {
    return this._rotation
  }
  set rotation(value: number) {
    this._rotation = value
  }

  /**
   * The scale of the image.
   */
  get scale() {
    return this._scale
  }
  set scale(value: AcGeVector2d) {
    this._scale.copy(value)
  }

  /**
   * The image size in pixels (U and V values).
   */
  get imageSize() {
    return this._imageSize
  }
  set imageSize(value: AcGePoint2d) {
    this._imageSize.copy(value)
  }

  /**
   * The current clip boundary type.
   */
  get clipBoundaryType() {
    return this._clipBoundaryType
  }
  set clipBoundaryType(value: AcDbRasterImageClipBoundaryType) {
    this._clipBoundaryType = value
  }

  /**
   * An array of clip boundary vertices in image pixel coordinates.
   */
  get clipBoundary() {
    return this._clipBoundary
  }
  set clipBoundary(value: AcGePoint2d[]) {
    this._clipBoundary = []
    this._clipBoundary.push(...value)
  }

  /**
   * The flag whether the image is clipped.
   */
  get isClipped() {
    return this._isClipped
  }
  set isClipped(value: boolean) {
    this._isClipped = value
  }

  /**
   * The flag whether to use clipping boundary.
   */
  get isShownClipped() {
    return this._isShownClipped
  }
  set isShownClipped(value: boolean) {
    this._isShownClipped = value
  }

  /**
   * The flag whether the image is shown.
   */
  get isImageShown() {
    return this._isImageShown
  }
  set isImageShown(value: boolean) {
    this._isImageShown = value
  }

  /**
   * The flag whether the image is transparent.
   */
  get isImageTransparent() {
    return this._isImageTransparent
  }
  set isImageTransparent(value: boolean) {
    this._isImageTransparent = value
  }

  /** Class version (DXF group 90). */
  get classVersion() {
    return this._classVersion
  }
  set classVersion(value: number) {
    this._classVersion = value
  }

  /**
   * Clip mode (DXF group 290): 0 = outside, 1 = inside.
   */
  get clipMode() {
    return this._clipMode
  }
  set clipMode(value: number) {
    this._clipMode = value
  }

  /**
   * The image data of this entity.
   */
  get image() {
    return this._image
  }
  set image(value: Blob | undefined) {
    this._image = value
  }

  /**
   * The object id of an image entity's image definition object.
   */
  get imageDefId() {
    return this._imageDefId
  }
  set imageDefId(value: AcDbObjectId) {
    this._imageDefId = value
  }

  /**
   * The file name of the image.
   */
  get imageFileName() {
    if (this._imageDefId) {
      const dict = this.database.objects.imageDefinition
      // Converters key ISM_RASTER_IMAGE_DICT by the DWG handle, then
      // commitObjectHandle may remint objectId on collision. Soft-pointer
      // imageDefId still matches the dictionary key — fall back to getAt.
      const imageDef =
        dict.getIdAt(this._imageDefId) ?? dict.getAt(this._imageDefId)
      if (imageDef) {
        return imageDef.sourceFileName
      }
    }
    return ''
  }

  /**
   * Basename of {@link imageFileName} (path separators stripped).
   * Used for missing-image labels and the property palette.
   */
  get imageDisplayName() {
    const path = this.imageFileName.trim()
    if (!path) return ''
    const parts = path.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || path
  }

  /**
   * Returns the full property definition for this raster image entity.
   */
  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'geometry',
          properties: [
            {
              name: 'name',
              type: 'string',
              editable: false,
              accessor: {
                // Full path as stored on the image definition (AutoCAD NAME).
                get: () => this.imageFileName || this.imageDisplayName
              }
            },
            {
              name: 'positionX',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.x,
                set: (v: number) => {
                  this.position.x = v
                }
              }
            },
            {
              name: 'positionY',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.y,
                set: (v: number) => {
                  this.position.y = v
                }
              }
            },
            {
              name: 'positionZ',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.position.z,
                set: (v: number) => {
                  this.position.z = v
                }
              }
            },
            {
              name: 'rotation',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.rotation,
                set: (v: number) => {
                  this.rotation = v
                }
              }
            },
            {
              name: 'width',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.width,
                set: (v: number) => {
                  this.width = v
                }
              }
            },
            {
              name: 'height',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.height,
                set: (v: number) => {
                  this.height = v
                }
              }
            }
          ]
        },
        {
          groupName: 'image',
          properties: [
            {
              name: 'brightness',
              type: 'int',
              editable: true,
              accessor: {
                get: () => this.brightness,
                set: (v: number) => {
                  this.brightness = v
                }
              }
            },
            {
              name: 'contrast',
              type: 'int',
              editable: true,
              accessor: {
                get: () => this.contrast,
                set: (v: number) => {
                  this.contrast = v
                }
              }
            },
            {
              name: 'fade',
              type: 'int',
              editable: true,
              accessor: {
                get: () => this.fade,
                set: (v: number) => {
                  this.fade = v
                }
              }
            },
            {
              name: 'isImageShown',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.isImageShown,
                set: (v: boolean) => {
                  this.isImageShown = v
                }
              }
            },
            {
              name: 'isImageTransparent',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.isImageTransparent,
                set: (v: boolean) => {
                  this.isImageTransparent = v
                }
              }
            },
            {
              name: 'isClipped',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.isClipped,
                set: (v: boolean) => {
                  this.isClipped = v
                }
              }
            },
            {
              name: 'isShownClipped',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.isShownClipped,
                set: (v: boolean) => {
                  this.isShownClipped = v
                }
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * @inheritdoc
   */
  get geometricExtents(): AcGeBox3d {
    const extents = new AcGeBox3d()
    extents.min.copy(this._position)
    extents.max.set(
      this._position.x + this._width,
      this._position.y + this._height,
      0
    )
    return extents
  }

  /** @inheritdoc */
  override subGetIntersectCurves(): AcGeIntersectPrimitive[] {
    return acdbIntersectPrimitivesFromPointPath(this.boundaryPath(), true)
  }

  /**
   * @inheritdoc
   */
  subGetGripPoints() {
    return this.boundaryPath()
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbForEachGripIndex(indices, index => {
      if (this.isClipped && this._clipBoundary.length > 3) {
        this.moveClippedBoundaryGripAt(index, offset)
      } else {
        this.moveUnclippedGripAt(index, offset)
      }
    })
    return this
  }

  /**
   * Gets the object snap points for this raster image.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    if (osnapMode === AcDbOsnapMode.Insertion) {
      snapPoints.push(this._position)
      return
    }

    const boundary = this.boundaryPath()
    if (boundary.length === 0) return

    let vertices = boundary
    if (boundary.length > 1) {
      const first = boundary[0]
      const last = boundary[boundary.length - 1]
      if (
        first.x === last.x &&
        first.y === last.y &&
        (first.z || 0) === (last.z || 0)
      ) {
        vertices = boundary.slice(0, -1)
      }
    }

    if (osnapMode === AcDbOsnapMode.EndPoint) {
      snapPoints.push(...vertices)
      return
    }

    acdbCollectVertexPathOsnapPoints(
      vertices,
      true,
      osnapMode,
      pickPoint,
      snapPoints
    )
  }

  /**
   * @inheritdoc
   */
  subWorldDraw(renderer: AcGiRenderer) {
    const points = this.boundaryPath()
    if (this._image && this.isImageShown) {
      return renderer.image(this._image, {
        boundary: points,
        roation: this._rotation
      })
    }
    // Frame-only: transparent fill keeps the interior pickable (AutoCAD IMAGE behavior).
    const frame = acdbDrawImageFrame(renderer, points)
    const label = this.drawMissingImageLabel(renderer, points)
    if (!label) {
      return frame
    }
    if (!frame) {
      return label
    }
    return renderer.group([frame, label])
  }

  /**
   * Draws the external image file path centered in the frame when pixel data
   * is missing, sizing the text so the full path fits inside the boundary.
   */
  private drawMissingImageLabel(
    renderer: AcGiRenderer,
    boundary: AcGePoint3d[]
  ): AcGiEntity | undefined {
    // A loaded blob with display turned off is an empty frame, not a missing file.
    if (this._image || boundary.length < 3) {
      return undefined
    }

    let label = ''
    try {
      label = this.imageFileName.trim()
    } catch {
      // Unbound entities have no image dictionary; still draw the frame.
      return undefined
    }
    if (!label) {
      return undefined
    }

    const center = this.boundaryCenter(boundary)
    const {
      width: boxWidth,
      height: boxHeight,
      rotation
    } = this.boundaryLocalSize(boundary)
    if (boxWidth <= 0 || boxHeight <= 0) {
      return undefined
    }

    // Fit against a slash-normalized copy so path backslashes are not mistaken
    // for MTEXT `\P` / `\S` when estimating width.
    const fitLabel = label.replace(/\\/g, '/')
    const textHeight = this.fitLabelTextHeight(fitLabel, boxWidth, boxHeight)
    if (textHeight <= 0) {
      return undefined
    }

    // Escape so `\Pictures` / `\Screenshots` draw as path text, not MTEXT codes.
    const mtextLabel = acdbEscapePlainTextForMText(label)
    const textWidth = acdbEstimatePlainTextWidth(fitLabel, textHeight)
    const mtextData: AcGiMTextData = {
      text: mtextLabel,
      height: textHeight,
      width: Math.max(textWidth, textHeight),
      position: center,
      rotation,
      attachmentPoint: AcGiMTextAttachmentPoint.MiddleCenter
    }

    try {
      return renderer.mtext(mtextData, this.resolveLabelTextStyle())
    } catch {
      return undefined
    }
  }

  private resolveLabelTextStyle(): AcGiTextStyle {
    const table = this.database.tables.textStyleTable
    const style =
      table.resolveAt(DEFAULT_TEXT_STYLE) ?? table.resolveAt('STANDARD')
    if (style) {
      return style.textStyle
    }
    return {
      name: DEFAULT_TEXT_STYLE,
      standardFlag: 0,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0,
      font: 'txt',
      bigFont: ''
    }
  }

  /**
   * Chooses a text height that keeps the full label inside the image frame.
   */
  private fitLabelTextHeight(
    label: string,
    boxWidth: number,
    boxHeight: number
  ): number {
    const usableWidth = boxWidth * 0.85
    const usableHeight = boxHeight * 0.85
    if (usableWidth <= 0 || usableHeight <= 0 || !label) {
      return 0
    }
    // Binary search so acdbEstimatePlainTextWidth (CHAR_WIDTH_FACTOR=1) fits.
    let low = 0
    let high = usableHeight
    for (let i = 0; i < 24; i++) {
      const mid = (low + high) / 2
      const width = acdbEstimatePlainTextWidth(label, mid)
      if (width <= usableWidth && mid <= usableHeight) {
        low = mid
      } else {
        high = mid
      }
    }
    return low
  }

  private boundaryCenter(boundary: AcGePoint3d[]): AcGePoint3d {
    let count = boundary.length
    if (
      count > 1 &&
      boundary[0].x === boundary[count - 1].x &&
      boundary[0].y === boundary[count - 1].y
    ) {
      count -= 1
    }
    let sx = 0
    let sy = 0
    let sz = 0
    for (let i = 0; i < count; i++) {
      sx += boundary[i].x
      sy += boundary[i].y
      sz += boundary[i].z
    }
    return new AcGePoint3d(sx / count, sy / count, sz / count)
  }

  /**
   * Local width/height along the first edge and its perpendicular, plus
   * rotation of that edge — works for both rectangular and clipped frames.
   */
  private boundaryLocalSize(boundary: AcGePoint3d[]): {
    width: number
    height: number
    rotation: number
  } {
    let count = boundary.length
    if (
      count > 1 &&
      boundary[0].x === boundary[count - 1].x &&
      boundary[0].y === boundary[count - 1].y
    ) {
      count -= 1
    }
    if (count < 2) {
      return {
        width: this._width,
        height: this._height,
        rotation: this._rotation
      }
    }

    const p0 = boundary[0]
    const p1 = boundary[1]
    const edgeX = p1.x - p0.x
    const edgeY = p1.y - p0.y
    const width = Math.hypot(edgeX, edgeY)
    const rotation = Math.atan2(edgeY, edgeX)
    if (width <= 0) {
      return {
        width: this._width,
        height: this._height,
        rotation: this._rotation
      }
    }

    const ux = edgeX / width
    const uy = edgeY / width
    // Perpendicular (CCW): (-uy, ux)
    let minV = 0
    let maxV = 0
    for (let i = 0; i < count; i++) {
      const dx = boundary[i].x - p0.x
      const dy = boundary[i].y - p0.y
      const v = dx * -uy + dy * ux
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }
    const height = Math.max(maxV - minV, 0)
    return {
      width: width > 0 ? width : this._width,
      height: height > 0 ? height : this._height,
      rotation
    }
  }

  /**
   * Transforms this raster image by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    const wcsWidth = this._width * this._scale.x
    const wcsHeight = this._height * this._scale.y
    const uAxis = new AcGeVector3d(
      wcsWidth * Math.cos(this._rotation),
      wcsWidth * Math.sin(this._rotation),
      0
    )
    const vAxis = new AcGeVector3d(
      -wcsHeight * Math.sin(this._rotation),
      wcsHeight * Math.cos(this._rotation),
      0
    )

    const origin = this._position.clone()
    const uPoint = this._position.clone().add(uAxis)
    const vPoint = this._position.clone().add(vAxis)

    origin.applyMatrix4(matrix)
    uPoint.applyMatrix4(matrix)
    vPoint.applyMatrix4(matrix)

    const transformedU = new AcGeVector3d(uPoint).sub(origin)
    const transformedV = new AcGeVector3d(vPoint).sub(origin)

    this._position.copy(origin)
    this._rotation = Math.atan2(transformedU.y, transformedU.x)
    this._width = transformedU.length()
    this._height = transformedV.length()
    this._scale.set(1, 1)
    return this
  }

  private moveUnclippedGripAt(index: number, offset: AcGeVector3dLike) {
    const px = this._position.x
    const py = this._position.y
    const w = this._width
    const h = this._height

    switch (index) {
      case 0:
        this._position.add(offset)
        break
      case 1: {
        const fixedX = px
        const fixedY = py + h
        const movedX = px + w + offset.x
        const movedY = py + offset.y
        this._position.x = fixedX
        this._position.y = movedY
        this._width = movedX - fixedX
        this._height = fixedY - movedY
        break
      }
      case 2: {
        const movedX = px + w + offset.x
        const movedY = py + h + offset.y
        this._width = movedX - px
        this._height = movedY - py
        break
      }
      case 3: {
        const fixedX = px + w
        const fixedY = py
        const movedX = px + offset.x
        const movedY = py + h + offset.y
        this._position.x = movedX
        this._position.y = fixedY
        this._width = fixedX - movedX
        this._height = movedY - fixedY
        break
      }
      default:
        break
    }
  }

  private moveClippedBoundaryGripAt(index: number, offset: AcGeVector3dLike) {
    if (index < 0 || index >= this._clipBoundary.length) {
      return
    }

    const wcsWidth = this._width
    const wcsHeight = this._height
    const ocsBox = new AcGeBox2d()
    ocsBox.setFromPoints(this._clipBoundary)
    const translation = new AcGePoint2d()
    translation.setX(this._position.x - ocsBox.min.x * wcsWidth)
    translation.setY(this._position.y - ocsBox.min.y * wcsHeight)

    const clipPoint = this._clipBoundary[index]
    const wcsX = clipPoint.x * wcsWidth + translation.x + offset.x
    const wcsY = clipPoint.y * wcsHeight + translation.y + offset.y
    clipPoint.x = (wcsX - translation.x) / wcsWidth
    clipPoint.y = (wcsY - translation.y) / wcsHeight
  }

  protected boundaryPath() {
    const points: AcGePoint3d[] = []
    if (this.isClipped && this._clipBoundary.length > 3) {
      const wcsWidth = this._width
      const wcsHeight = this._height

      // The left-bottom corner of the boundary is mapped to the insertion point of the image.
      // So calcuate the translation based on those two points.
      const ocsBox = new AcGeBox2d()
      ocsBox.setFromPoints(this._clipBoundary)
      const translation = new AcGePoint2d()
      translation.setX(this._position.x - ocsBox.min.x * wcsWidth)
      translation.setY(this._position.y - ocsBox.min.y * wcsHeight)

      this._clipBoundary.forEach(point => {
        // Clip boundary vertices are in image pixel coordinates. So we need to convert their coordniates
        // from the image pixel coordinate system to the world coordinate system.
        const x = point.x * wcsWidth + translation.x
        const y = point.y * wcsHeight + translation.y
        points.push(new AcGePoint3d(x, y, this._position.z))
      })
    } else {
      points.push(this._position)
      points.push(this._position.clone().setX(this._position.x + this._width))
      points.push(
        this._position
          .clone()
          .set(
            this._position.x + this._width,
            this._position.y + this._height,
            this._position.z
          )
      )
      points.push(this._position.clone().setY(this._position.y + this._height))

      if (this._rotation > 0) {
        _point1.copy(points[1])
        for (let index = 1; index < 4; index++) {
          _point2.copy(points[index])
          _point2.rotateAround(_point1, this._rotation)
          points[index].setX(_point2.x)
          points[index].setY(_point2.y)
        }
      }
      points.push(points[0])
    }

    return points
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbRasterImage')
    filer.writeInt32(90, this.classVersion)
    filer.writePoint3d(10, this.position)
    const wcsWidth = this.width * this.scale.x
    const wcsHeight = this.height * this.scale.y
    const imageSize =
      this._imageSize.x > 0 && this._imageSize.y > 0
        ? this._imageSize
        : { x: wcsWidth, y: wcsHeight }
    const pixelWidth = imageSize.x > 0 ? wcsWidth / imageSize.x : wcsWidth
    const pixelHeight = imageSize.y > 0 ? wcsHeight / imageSize.y : wcsHeight
    const cos = Math.cos(this._rotation)
    const sin = Math.sin(this._rotation)
    filer.writePoint3d(11, { x: pixelWidth * cos, y: pixelWidth * sin, z: 0 })
    filer.writePoint3d(12, {
      x: -pixelHeight * sin,
      y: pixelHeight * cos,
      z: 0
    })
    filer.writePoint2d(13, imageSize)
    filer.writeObjectId(340, this.imageDefId)
    const displayFlags =
      (this.isImageShown ? AcDbRasterImageImageDisplayOpt.Show : 0) |
      (this.isShownClipped ? AcDbRasterImageImageDisplayOpt.Clip : 0) |
      (this.isImageTransparent ? AcDbRasterImageImageDisplayOpt.Transparent : 0)
    filer.writeInt16(70, displayFlags)
    filer.writeInt16(280, this.isClipped ? 1 : 0)
    filer.writeInt16(281, this.brightness)
    filer.writeInt16(282, this.contrast)
    filer.writeInt16(283, this.fade)
    filer.writeInt16(71, this.clipBoundaryType)
    if (this.isClipped) {
      filer.writeInt16(91, this.clipBoundary.length)
      for (const point of this.clipBoundary) {
        filer.writePoint2d(14, point)
      }
    }
    filer.writeInt16(290, this.clipMode)
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbRasterImage')

    let px = this.position.x
    let py = this.position.y
    let pz = this.position.z
    let ux = 1
    let uy = 0
    let uz = 0
    let vx = 0
    let vy = 1
    let vz = 0
    let sx = this.imageSize.x
    let sy = this.imageSize.y
    const clipPts: AcGePoint2d[] = []
    let pendingClip: { x: number; y: number } | null = null

    const flushClip = () => {
      if (pendingClip) {
        clipPts.push(new AcGePoint2d(pendingClip.x, pendingClip.y))
        pendingClip = null
      }
    }

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 10:
          px = n
          break
        case 20:
          py = n
          break
        case 30:
          pz = n
          break
        case 11:
          ux = n
          break
        case 21:
          uy = n
          break
        case 31:
          uz = n
          break
        case 12:
          vx = n
          break
        case 22:
          vy = n
          break
        case 32:
          vz = n
          break
        case 13:
          sx = n
          break
        case 23:
          sy = n
          break
        case 14:
          flushClip()
          pendingClip = { x: n, y: 0 }
          break
        case 24:
          if (pendingClip) pendingClip.y = n
          break
        case 70: {
          this.isImageShown = (n & 0x0003) !== 0
          this.isShownClipped = (n & AcDbRasterImageImageDisplayOpt.Clip) !== 0
          this.isImageTransparent =
            (n & AcDbRasterImageImageDisplayOpt.Transparent) !== 0
          break
        }
        case 71:
          this.clipBoundaryType = n as AcDbRasterImageClipBoundaryType
          break
        case 90:
          this.classVersion = n
          break
        case 91:
          // Clip vertex count — informational.
          break
        case 280:
          this.isClipped = n !== 0
          break
        case 281:
          this.brightness = n
          break
        case 282:
          this.contrast = n
          break
        case 283:
          this.fade = n
          break
        case 290:
          this.clipMode = n
          break
        case 340:
          this.imageDefId = String(item.value)
          break
        default:
          break
      }
    }

    flushClip()
    this.applyRasterImageDxfIn(
      px,
      py,
      pz,
      ux,
      uy,
      uz,
      vx,
      vy,
      vz,
      sx,
      sy,
      clipPts
    )
    return this
  }

  private applyRasterImageDxfIn(
    px: number,
    py: number,
    pz: number,
    ux: number,
    uy: number,
    uz: number,
    vx: number,
    vy: number,
    vz: number,
    sx: number,
    sy: number,
    clipPts: AcGePoint2d[]
  ) {
    this.position.copy({ x: px, y: py, z: pz })
    this.imageSize.copy({ x: sx, y: sy })
    const uLen = Math.hypot(ux, uy, uz)
    const vLen = Math.hypot(vx, vy, vz)
    this.width = uLen * (sx || 1)
    this.height = vLen * (sy || 1)
    this.rotation = Math.atan2(uy, ux)
    if (clipPts.length > 0) {
      this.clipBoundary = clipPts
    }
  }
}

const _point1 = /*@__PURE__*/ new AcGePoint2d()
const _point2 = /*@__PURE__*/ new AcGePoint2d()

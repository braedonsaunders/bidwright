import {
  AcGeBox3d,
  AcGeIntersectPrimitive,
  AcGeMathUtil,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiRenderer,
  AcGiViewport
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbEntity } from './AcDbEntity'
import { acdbForEachGripIndex } from './AcDbGripHelpers'
import { acdbIntersectPrimitivesFromPointPath } from './AcDbIntersectHelpers'

/**
 * Represents a viewport entity in AutoCAD drawings.
 *
 * A viewport is a rectangular window that displays a portion of the drawing model space
 * within paper space layouts. Viewports allow users to create multiple views of the same
 * drawing at different scales and orientations on a single sheet.
 *
 * Key characteristics:
 * - Viewports exist primarily in paper space layouts
 * - Each viewport has a unique ID number (except the default system viewport with ID 1)
 * - Viewports can be active or inactive
 * - The viewport entity itself is drawn as a rectangular border in paper space
 *
 * @example
 * ```typescript
 * const viewport = new AcDbViewport();
 * viewport.centerPoint = new AcGePoint3d(0, 0, 0);
 * viewport.width = 10;
 * viewport.height = 8;
 * viewport.number = 2;
 * ```
 */
export class AcDbViewport extends AcDbEntity {
  /** The entity type name */
  static override typeName: string = 'Viewport'

  override get dxfTypeName() {
    return 'VIEWPORT'
  }

  private _centerPoint: AcGePoint3d
  private _height: number
  private _width: number
  private _viewCenter: AcGePoint3d
  private _viewTarget: AcGePoint3d
  private _viewDirection: AcGeVector3d
  private _viewTwistAngle: number
  private _viewHeight: number
  private _number: number
  private _snapBase = new AcGePoint3d()
  private _snapSpacing = new AcGePoint3d(1, 1, 0)
  private _gridSpacing = new AcGePoint3d(1, 1, 0)
  private _perspectiveLensLength = 50
  private _frontClipZ = 0
  private _backClipZ = 0
  private _snapAngle = 0
  private _status = 0
  private _ucsPerViewport = 0
  private _circleZoomPercent = 1000
  private _statusBitFlags = 0
  private _ucsOrigin = new AcGePoint3d()
  private _ucsXAxis = new AcGeVector3d(1, 0, 0)
  private _ucsYAxis = new AcGeVector3d(0, 1, 0)
  private _elevation = 0
  private _frozenLayerIds: string[] = []
  private _sheetName = ''
  private _iconFlag = 0
  private _orthographicType = 0
  private _majorGridFrequency = 0
  private _ambientLightColorIndex = 0
  private _brightness = 0
  private _contrast = 0
  private _shadePlotMode = 0
  private _renderMode = 0
  private _defaultLightingType = 0
  private _isDefaultLighting = false
  private _clippingBoundaryId = ''
  private _backgroundId = ''
  private _shadePlotId = ''
  private _ucsId = ''
  private _ucsBaseId = ''
  private _visualStyleId = ''
  private _sunId = ''
  private _ambientLightColorInstance = 0
  private _ambientLightColorName = ''
  private _softPointers: string[] = []

  /**
   * Creates a new AcDbViewport instance.
   *
   * Initializes all properties with default values:
   * - centerPoint: origin (0,0,0)
   * - height: 0
   * - width: 0
   * - viewCenter: origin (0,0,0)
   * - viewTarget: origin (0,0,0)
   * - viewTwistAngle: 0
   * - viewHeight: 0
   * - number: -1 (indicating inactive viewport)
   */
  constructor() {
    super()
    this._centerPoint = new AcGePoint3d()
    this._height = 0
    this._width = 0
    this._viewCenter = new AcGePoint3d()
    this._viewTarget = new AcGePoint3d()
    this._viewDirection = new AcGeVector3d(0, 0, 1)
    this._viewTwistAngle = 0
    this._viewHeight = 0
    this._number = -1
  }

  /**
   * Gets or sets the viewport ID number.
   *
   * This is the number that is reported by the AutoCAD CVPORT system variable
   * when the viewport is the current viewport in the AutoCAD editor. If the viewport is inactive, -1
   * is returned.
   *
   * Important notes:
   * - This value is not saved with the drawing, and changes each time the drawing is opened
   * - Viewport ID 1 is reserved for the system-defined default viewport in paper space
   * - Active viewports have IDs greater than 1
   * - Inactive viewports return -1
   *
   * @returns The viewport ID number
   */
  get number() {
    return this._number
  }
  set number(value: number) {
    this._number = value
  }

  /**
   * Gets or sets the center point of the viewport entity in WCS coordinates (within Paper Space).
   *
   * This point represents the geometric center of the viewport's rectangular boundary
   * in paper space coordinates, not the center of the model space view within the viewport.
   *
   * @returns The center point of the viewport entity
   */
  get centerPoint() {
    return this._centerPoint
  }
  set centerPoint(value: AcGePoint3d) {
    this._centerPoint = value
  }

  /**
   * Gets or sets the height of the viewport entity's window in drawing units.
   *
   * This represents the height of the viewport's rectangular boundary in paper space,
   * measured in the current drawing units. It defines the vertical extent of the
   * viewport border, not the height of the model space view within it.
   *
   * @returns The height of the viewport entity in drawing units
   */
  get height() {
    return this._height
  }
  set height(value: number) {
    this._height = value
  }

  /**
   * Gets or sets the width of the viewport entity's window in drawing units.
   *
   * This represents the width of the viewport's rectangular boundary in paper space,
   * measured in the current drawing units. It defines the horizontal extent of the
   * viewport border, not the width of the model space view within the viewport.
   *
   * Note: This is the width in Paper Space of the viewport itself, not the width
   * of the Model Space view within the viewport.
   *
   * @returns The width of the viewport entity in drawing units
   */
  get width() {
    return this._width
  }
  set width(value: number) {
    this._width = value
  }

  /**
   * Gets or sets the view center in display coordinate system coordinates.
   *
   * This point represents the center of the model space view that is displayed
   * within the viewport. It is specified in the display coordinate system and
   * determines what portion of the model space drawing is visible in the viewport.
   *
   * @returns The center point of the model space view within the viewport
   */
  get viewCenter() {
    return this._viewCenter
  }
  set viewCenter(value: AcGePoint3d) {
    this._viewCenter = value
  }

  /**
   * Gets or sets the view target in WCS coordinates (DXF group 17).
   *
   * The model view center stored in {@link viewCenter} is in DCS; the WCS
   * center shown through the viewport is `viewTarget + rotate(viewCenter,
   * viewTwistAngle)`.
   */
  get viewTarget() {
    return this._viewTarget
  }
  set viewTarget(value: AcGePoint3d) {
    this._viewTarget = value
  }

  /**
   * View direction from target (DXF group 16).
   */
  get viewDirection() {
    return this._viewDirection
  }
  set viewDirection(value: AcGeVector3dLike) {
    this._viewDirection.copy(value)
  }

  /** Snap base point (DXF group 13). */
  get snapBase() {
    return this._snapBase
  }
  set snapBase(value: AcGePoint3d) {
    this._snapBase.copy(value)
  }

  /** Snap spacing (DXF group 14). */
  get snapSpacing() {
    return this._snapSpacing
  }
  set snapSpacing(value: AcGePoint3d) {
    this._snapSpacing.copy(value)
  }

  /** Grid spacing (DXF group 15). */
  get gridSpacing() {
    return this._gridSpacing
  }
  set gridSpacing(value: AcGePoint3d) {
    this._gridSpacing.copy(value)
  }

  /** Perspective lens length (DXF group 42). */
  get perspectiveLensLength() {
    return this._perspectiveLensLength
  }
  set perspectiveLensLength(value: number) {
    this._perspectiveLensLength = value
  }

  /** Front clip plane Z value (DXF group 43). */
  get frontClipZ() {
    return this._frontClipZ
  }
  set frontClipZ(value: number) {
    this._frontClipZ = value
  }

  /** Back clip plane Z value (DXF group 44). */
  get backClipZ() {
    return this._backClipZ
  }
  set backClipZ(value: number) {
    this._backClipZ = value
  }

  /** Snap angle in radians (DXF group 50). */
  get snapAngle() {
    return this._snapAngle
  }
  set snapAngle(value: number) {
    this._snapAngle = value
  }

  /** Viewport status field (DXF group 68). */
  get status() {
    return this._status
  }
  set status(value: number) {
    this._status = value
  }

  /** UCS per-viewport flag (DXF group 71). */
  get ucsPerViewport() {
    return this._ucsPerViewport
  }
  set ucsPerViewport(value: number) {
    this._ucsPerViewport = value
  }

  /** Circle zoom percent (DXF group 72). */
  get circleZoomPercent() {
    return this._circleZoomPercent
  }
  set circleZoomPercent(value: number) {
    this._circleZoomPercent = value
  }

  /** Status bit flags (DXF group 90). */
  get statusBitFlags() {
    return this._statusBitFlags
  }
  set statusBitFlags(value: number) {
    this._statusBitFlags = value
  }

  /** UCS origin (DXF group 110). */
  get ucsOrigin() {
    return this._ucsOrigin
  }
  set ucsOrigin(value: AcGePoint3d) {
    this._ucsOrigin.copy(value)
  }

  /** Elevation (DXF group 146). */
  get elevation() {
    return this._elevation
  }
  set elevation(value: number) {
    this._elevation = value
  }

  /** Frozen layer soft-pointer IDs (DXF group 331). */
  get frozenLayerIds() {
    return this._frozenLayerIds
  }
  set frozenLayerIds(value: string[]) {
    this._frozenLayerIds = [...value]
  }

  /** UCS X axis (DXF group 111). */
  get ucsXAxis() {
    return this._ucsXAxis
  }
  set ucsXAxis(value: AcGeVector3dLike) {
    this._ucsXAxis.copy(value)
  }

  /** UCS Y axis (DXF group 112). */
  get ucsYAxis() {
    return this._ucsYAxis
  }
  set ucsYAxis(value: AcGeVector3dLike) {
    this._ucsYAxis.copy(value)
  }

  /** Paper space sheet name (DXF group 1). */
  get sheetName() {
    return this._sheetName
  }
  set sheetName(value: string) {
    this._sheetName = value
  }

  /** UCSICON display flag (DXF group 74). */
  get iconFlag() {
    return this._iconFlag
  }
  set iconFlag(value: number) {
    this._iconFlag = value
  }

  /** Orthographic type of UCS (DXF group 79). */
  get orthographicType() {
    return this._orthographicType
  }
  set orthographicType(value: number) {
    this._orthographicType = value
  }

  /** Major grid-line frequency (DXF group 61). */
  get majorGridFrequency() {
    return this._majorGridFrequency
  }
  set majorGridFrequency(value: number) {
    this._majorGridFrequency = value
  }

  /** Ambient light color index (DXF group 63). */
  get ambientLightColorIndex() {
    return this._ambientLightColorIndex
  }
  set ambientLightColorIndex(value: number) {
    this._ambientLightColorIndex = value
  }

  /** Brightness (DXF group 141). */
  get viewportBrightness() {
    return this._brightness
  }
  set viewportBrightness(value: number) {
    this._brightness = value
  }

  /** Contrast (DXF group 142). */
  get viewportContrast() {
    return this._contrast
  }
  set viewportContrast(value: number) {
    this._contrast = value
  }

  /** Shade plot mode (DXF group 170). */
  get shadePlotMode() {
    return this._shadePlotMode
  }
  set shadePlotMode(value: number) {
    this._shadePlotMode = value
  }

  /** Render mode (DXF group 281). */
  get renderMode() {
    return this._renderMode
  }
  set renderMode(value: number) {
    this._renderMode = value
  }

  /** Default lighting type (DXF group 282). */
  get defaultLightingType() {
    return this._defaultLightingType
  }
  set defaultLightingType(value: number) {
    this._defaultLightingType = value
  }

  /** Whether default lighting is on (DXF group 292). */
  get isDefaultLighting() {
    return this._isDefaultLighting
  }
  set isDefaultLighting(value: boolean) {
    this._isDefaultLighting = value
  }

  /** Clipping boundary hard-pointer ID (DXF group 340). */
  get clippingBoundaryId() {
    return this._clippingBoundaryId
  }
  set clippingBoundaryId(value: string) {
    this._clippingBoundaryId = value
  }

  /** Background soft-pointer ID (DXF group 332). */
  get backgroundId() {
    return this._backgroundId
  }
  set backgroundId(value: string) {
    this._backgroundId = value
  }

  /** Shade plot soft-pointer ID (DXF group 333). */
  get shadePlotId() {
    return this._shadePlotId
  }
  set shadePlotId(value: string) {
    this._shadePlotId = value
  }

  /** UCS soft-pointer ID (DXF group 345). */
  get ucsId() {
    return this._ucsId
  }
  set ucsId(value: string) {
    this._ucsId = value
  }

  /** UCS base soft-pointer ID (DXF group 346). */
  get ucsBaseId() {
    return this._ucsBaseId
  }
  set ucsBaseId(value: string) {
    this._ucsBaseId = value
  }

  /** Visual style soft-pointer ID (DXF group 348). */
  get visualStyleId() {
    return this._visualStyleId
  }
  set visualStyleId(value: string) {
    this._visualStyleId = value
  }

  /** Sun soft-pointer ID (DXF group 361). */
  get sunId() {
    return this._sunId
  }
  set sunId(value: string) {
    this._sunId = value
  }

  /** Ambient light color (true color, DXF group 421). */
  get ambientLightColorInstance() {
    return this._ambientLightColorInstance
  }
  set ambientLightColorInstance(value: number) {
    this._ambientLightColorInstance = value
  }

  /** Ambient light color name (DXF group 431). */
  get ambientLightColorName() {
    return this._ambientLightColorName
  }
  set ambientLightColorName(value: string) {
    this._ambientLightColorName = value
  }

  /** Soft-pointer IDs from groups 91 / 335 / 343 / 344. */
  get softPointers() {
    return this._softPointers
  }
  set softPointers(value: string[]) {
    this._softPointers = [...value]
  }

  /**
   * Gets or sets the view twist angle in radians (DXF group 51).
   */
  get viewTwistAngle() {
    return this._viewTwistAngle
  }
  set viewTwistAngle(value: number) {
    this._viewTwistAngle = value
  }

  /**
   * Gets or sets the height of the Model Space view within the viewport.
   *
   * This value represents the height of the model space view that is displayed
   * within the viewport, specified in display coordinate system coordinates.
   *
   * Zoom behavior:
   * - Zooming the view out within the viewport increases this value
   * - Zooming the view in within the viewport decreases this value
   *
   * @returns The height of the model space view in display coordinates
   */
  get viewHeight() {
    return this._viewHeight
  }
  set viewHeight(value: number) {
    this._viewHeight = value
  }

  /**
   * Gets the geometric extents of the viewport entity.
   *
   * This method returns a bounding box that encompasses the entire viewport entity
   * in world coordinate system (WCS) coordinates.
   *
   * @returns A bounding box containing the viewport entity
   * @inheritdoc
   */
  get geometricExtents(): AcGeBox3d {
    const halfWidth = this._width / 2
    const halfHeight = this._height / 2
    const box = new AcGeBox3d()
    box.expandByPoint(
      new AcGePoint3d(
        this._centerPoint.x - halfWidth,
        this._centerPoint.y - halfHeight,
        this._centerPoint.z
      )
    )
    box.expandByPoint(
      new AcGePoint3d(
        this._centerPoint.x + halfWidth,
        this._centerPoint.y + halfHeight,
        this._centerPoint.z
      )
    )
    return box
  }

  /** @inheritdoc */
  override subGetIntersectCurves(): AcGeIntersectPrimitive[] {
    const halfWidth = this._width / 2
    const halfHeight = this._height / 2
    const z = this._centerPoint.z
    const corners = [
      new AcGePoint3d(
        this._centerPoint.x - halfWidth,
        this._centerPoint.y - halfHeight,
        z
      ),
      new AcGePoint3d(
        this._centerPoint.x + halfWidth,
        this._centerPoint.y - halfHeight,
        z
      ),
      new AcGePoint3d(
        this._centerPoint.x + halfWidth,
        this._centerPoint.y + halfHeight,
        z
      ),
      new AcGePoint3d(
        this._centerPoint.x - halfWidth,
        this._centerPoint.y + halfHeight,
        z
      )
    ]
    return acdbIntersectPrimitivesFromPointPath(corners, true)
  }

  /**
   * Gets the grip points for this viewport.
   *
   * Grip points are the center point and the four corners of the viewport
   * boundary in paper space, matching AutoCAD viewport grip behavior.
   *
   * @returns Array of grip points as 3D points
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    const halfWidth = this._width / 2
    const halfHeight = this._height / 2
    const z = this._centerPoint.z

    gripPoints.push(this._centerPoint)
    if (halfWidth > 0 || halfHeight > 0) {
      gripPoints.push(
        new AcGePoint3d(
          this._centerPoint.x - halfWidth,
          this._centerPoint.y - halfHeight,
          z
        ),
        new AcGePoint3d(
          this._centerPoint.x + halfWidth,
          this._centerPoint.y - halfHeight,
          z
        ),
        new AcGePoint3d(
          this._centerPoint.x + halfWidth,
          this._centerPoint.y + halfHeight,
          z
        ),
        new AcGePoint3d(
          this._centerPoint.x - halfWidth,
          this._centerPoint.y + halfHeight,
          z
        )
      )
    }
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbForEachGripIndex(indices, index => {
      this.moveGripAt(index, offset)
    })
    return this
  }

  /**
   * Transforms this viewport entity by the specified matrix.
   */
  transformBy(matrix: AcGeMatrix3d) {
    const origin = this._centerPoint.clone()
    const xAxisPoint = this._centerPoint
      .clone()
      .add(new AcGeVector3d(this._width, 0, 0))
    const yAxisPoint = this._centerPoint
      .clone()
      .add(new AcGeVector3d(0, this._height, 0))

    origin.applyMatrix4(matrix)
    xAxisPoint.applyMatrix4(matrix)
    yAxisPoint.applyMatrix4(matrix)

    const xAxis = new AcGeVector3d(xAxisPoint).sub(origin)
    const yAxis = new AcGeVector3d(yAxisPoint).sub(origin)
    const yScale = this._height !== 0 ? yAxis.length() / this._height : 1

    this._centerPoint.copy(origin)
    this._width = xAxis.length()
    this._height = yAxis.length()
    this._viewHeight *= yScale
    return this
  }

  /**
   * Renders the viewport entity using the specified renderer.
   *
   * The viewport is drawn as a rectangular border when the following conditions are met:
   * - The viewport entity is not in model space (i.e., it's in paper space)
   * - The viewport ID number is greater than 1 (not the default system viewport)
   *
   * In paper space layouts, there is always a system-defined "default" viewport that exists as
   * the bottom-most item. This viewport doesn't show any entities and is mainly for internal
   * AutoCAD purposes. The viewport ID number of this system-defined "default" viewport is 1.
   *
   * @param renderer - The renderer to use for drawing the viewport
   * @returns A render group containing the viewport border lines, or undefined if not drawn
   */
  subWorldDraw(renderer: AcGiRenderer) {
    // Draw a rectangle if meeting the following conditions:
    // - viewport entity isn't in model space
    // - viewport id number is greater than 1
    //
    // In paper space layouts, there is always a system-defined "default" viewport that exists as
    // the bottom-most item. This viewport doesn't show any entities and is mainly for internal
    // AutoCAD purposes. The viewport id number of this system-defined "default" viewport is 1.
    if (
      this._number > 1 &&
      this.ownerId != this.database.tables.blockTable.modelSpace.objectId
    ) {
      const viewport = this.toGiViewport()
      const group = renderer.group(this.createViewportRect(viewport, renderer))
      return group
    }
    return undefined
  }

  /**
   * Converts this AcDbViewport to an AcGiViewport for rendering purposes.
   *
   * This method creates a graphic interface viewport object that contains all the
   * necessary properties for rendering the viewport in the graphics system.
   *
   * @returns An AcGiViewport instance with all viewport properties copied
   */
  toGiViewport() {
    const viewport = new AcGiViewport()
    viewport.id = this.objectId
    viewport.groupId = this.ownerId
    viewport.number = this.number
    viewport.centerPoint = this.centerPoint
    viewport.width = this.width
    viewport.height = this.height
    viewport.viewHeight = this.viewHeight
    viewport.viewCenter = this.viewCenter
    viewport.viewTarget = this.viewTarget
    viewport.viewTwistAngle = this.viewTwistAngle
    return viewport
  }

  /**
   * Creates the rectangular border lines for the viewport.
   *
   * This private method generates four line entities that form a rectangle representing
   * the viewport's boundary. The rectangle is centered on the viewport's center point
   * and has dimensions specified by the viewport's width and height.
   *
   * @param viewport - The graphic interface viewport containing rendering properties
   * @param renderer - The renderer to use for creating the line entities
   * @returns An array of line entities forming the viewport border
   * @private
   */
  private createViewportRect(viewport: AcGiViewport, renderer: AcGiRenderer) {
    const lines: AcGiEntity[] = []
    lines.push(
      renderer.lines([
        new AcGePoint3d(
          viewport.centerPoint.x - viewport.width / 2,
          viewport.centerPoint.y - viewport.height / 2,
          0
        ),
        new AcGePoint3d(
          viewport.centerPoint.x + viewport.width / 2,
          viewport.centerPoint.y - viewport.height / 2,
          0
        )
      ])
    )
    lines.push(
      renderer.lines([
        new AcGePoint3d(
          viewport.centerPoint.x + viewport.width / 2,
          viewport.centerPoint.y - viewport.height / 2,
          0
        ),
        new AcGePoint3d(
          viewport.centerPoint.x + viewport.width / 2,
          viewport.centerPoint.y + viewport.height / 2,
          0
        )
      ])
    )
    lines.push(
      renderer.lines([
        new AcGePoint3d(
          viewport.centerPoint.x + viewport.width / 2,
          viewport.centerPoint.y + viewport.height / 2,
          0
        ),
        new AcGePoint3d(
          viewport.centerPoint.x - viewport.width / 2,
          viewport.centerPoint.y + viewport.height / 2,
          0
        )
      ])
    )
    lines.push(
      renderer.lines([
        new AcGePoint3d(
          viewport.centerPoint.x - viewport.width / 2,
          viewport.centerPoint.y + viewport.height / 2,
          0
        ),
        new AcGePoint3d(
          viewport.centerPoint.x - viewport.width / 2,
          viewport.centerPoint.y - viewport.height / 2,
          0
        )
      ])
    )
    return lines
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbViewport')
    filer.writePoint3d(10, this.centerPoint)
    filer.writeDouble(40, this.height)
    filer.writeDouble(41, this.width)
    filer.writePoint3d(12, this.viewCenter)
    filer.writePoint3d(13, this.snapBase)
    filer.writePoint3d(14, this.snapSpacing)
    filer.writePoint3d(15, this.gridSpacing)
    filer.writeVector3d(16, this.viewDirection)
    filer.writePoint3d(17, this.viewTarget)
    filer.writeDouble(42, this.perspectiveLensLength)
    filer.writeDouble(43, this.frontClipZ)
    filer.writeDouble(44, this.backClipZ)
    filer.writeDouble(45, this.viewHeight)
    filer.writeAngle(50, this.snapAngle)
    filer.writeAngle(51, this.viewTwistAngle)
    filer.writeInt16(68, this.status)
    filer.writeInt32(69, this.number)
    filer.writeInt16(71, this.ucsPerViewport)
    filer.writeInt16(72, this.circleZoomPercent)
    filer.writeInt32(90, this.statusBitFlags)
    for (const id of this.frozenLayerIds) {
      filer.writeObjectId(331, id)
    }
    filer.writePoint3d(110, this.ucsOrigin)
    filer.writeVector3d(111, this.ucsXAxis)
    filer.writeVector3d(112, this.ucsYAxis)
    filer.writeDouble(146, this.elevation)
    if (this.sheetName) {
      filer.writeString(1, this.sheetName)
    }
    filer.writeInt16(61, this.majorGridFrequency)
    filer.writeInt16(63, this.ambientLightColorIndex)
    filer.writeInt16(74, this.iconFlag)
    filer.writeInt16(79, this.orthographicType)
    for (const id of this.softPointers) {
      filer.writeObjectId(91, id)
    }
    filer.writeDouble(141, this.viewportBrightness)
    filer.writeDouble(142, this.viewportContrast)
    filer.writeInt16(170, this.shadePlotMode)
    filer.writeInt16(281, this.renderMode)
    filer.writeInt16(282, this.defaultLightingType)
    filer.writeInt16(292, this.isDefaultLighting ? 1 : 0)
    if (this.clippingBoundaryId) {
      filer.writeObjectId(340, this.clippingBoundaryId)
    }
    if (this.backgroundId) {
      filer.writeObjectId(332, this.backgroundId)
    }
    if (this.shadePlotId) {
      filer.writeObjectId(333, this.shadePlotId)
    }
    if (this.ucsId) {
      filer.writeObjectId(345, this.ucsId)
    }
    if (this.ucsBaseId) {
      filer.writeObjectId(346, this.ucsBaseId)
    }
    if (this.visualStyleId) {
      filer.writeObjectId(348, this.visualStyleId)
    }
    if (this.sunId) {
      filer.writeObjectId(361, this.sunId)
    }
    if (this.ambientLightColorInstance) {
      filer.writeInt32(421, this.ambientLightColorInstance)
    }
    if (this.ambientLightColorName) {
      filer.writeString(431, this.ambientLightColorName)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbViewport')

    let cx = this.centerPoint.x
    let cy = this.centerPoint.y
    let cz = this.centerPoint.z
    let vcx = this.viewCenter.x
    let vcy = this.viewCenter.y
    let vcz = this.viewCenter.z
    let vtx = this.viewTarget.x
    let vty = this.viewTarget.y
    let vtz = this.viewTarget.z
    let vdx = this.viewDirection.x
    let vdy = this.viewDirection.y
    let vdz = this.viewDirection.z
    let sbx = this.snapBase.x
    let sby = this.snapBase.y
    let sbz = this.snapBase.z
    let ssx = this.snapSpacing.x
    let ssy = this.snapSpacing.y
    let ssz = this.snapSpacing.z
    let gsx = this.gridSpacing.x
    let gsy = this.gridSpacing.y
    let gsz = this.gridSpacing.z
    let uox = this.ucsOrigin.x
    let uoy = this.ucsOrigin.y
    let uoz = this.ucsOrigin.z
    let uxx = this.ucsXAxis.x
    let uxy = this.ucsXAxis.y
    let uxz = this.ucsXAxis.z
    let uyx = this.ucsYAxis.x
    let uyy = this.ucsYAxis.y
    let uyz = this.ucsYAxis.z
    const frozenLayerIds: string[] = []
    const softPointers: string[] = []

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      const n = Number(item.value)
      switch (code) {
        case 1:
          this.sheetName = String(item.value)
          break
        case 10:
          cx = n
          break
        case 20:
          cy = n
          break
        case 30:
          cz = n
          break
        case 12:
          vcx = n
          break
        case 22:
          vcy = n
          break
        case 32:
          vcz = n
          break
        case 13:
          sbx = n
          break
        case 23:
          sby = n
          break
        case 33:
          sbz = n
          break
        case 14:
          ssx = n
          break
        case 24:
          ssy = n
          break
        case 34:
          ssz = n
          break
        case 15:
          gsx = n
          break
        case 25:
          gsy = n
          break
        case 35:
          gsz = n
          break
        case 16:
          vdx = n
          break
        case 26:
          vdy = n
          break
        case 36:
          vdz = n
          break
        case 17:
          vtx = n
          break
        case 27:
          vty = n
          break
        case 37:
          vtz = n
          break
        case 40:
          this.height = n
          break
        case 41:
          this.width = n
          break
        case 42:
          this.perspectiveLensLength = n
          break
        case 43:
          this.frontClipZ = n
          break
        case 44:
          this.backClipZ = n
          break
        case 45:
          this.viewHeight = n
          break
        case 50:
          this.snapAngle = AcGeMathUtil.degToRad(n)
          break
        case 51:
          this.viewTwistAngle = AcGeMathUtil.degToRad(n)
          break
        case 61:
          this.majorGridFrequency = n
          break
        case 63:
          this.ambientLightColorIndex = n
          break
        case 68:
          this.status = n
          break
        case 69:
          this.number = n
          break
        case 71:
          this.ucsPerViewport = n
          break
        case 72:
          this.circleZoomPercent = n
          break
        case 74:
          this.iconFlag = n
          break
        case 79:
          this.orthographicType = n
          break
        case 90:
          this.statusBitFlags = n
          break
        case 91:
        case 335:
        case 343:
        case 344:
          softPointers.push(String(item.value))
          break
        case 110:
          uox = n
          break
        case 120:
          uoy = n
          break
        case 130:
          uoz = n
          break
        case 111:
          uxx = n
          break
        case 121:
          uxy = n
          break
        case 131:
          uxz = n
          break
        case 112:
          uyx = n
          break
        case 122:
          uyy = n
          break
        case 132:
          uyz = n
          break
        case 141:
          this.viewportBrightness = n
          break
        case 142:
          this.viewportContrast = n
          break
        case 146:
          this.elevation = n
          break
        case 170:
          this.shadePlotMode = n
          break
        case 281:
          this.renderMode = n
          break
        case 282:
          this.defaultLightingType = n
          break
        case 292:
          this.isDefaultLighting = n !== 0
          break
        case 331:
          frozenLayerIds.push(String(item.value))
          break
        case 332:
          this.backgroundId = String(item.value)
          break
        case 333:
          this.shadePlotId = String(item.value)
          break
        case 340:
          this.clippingBoundaryId = String(item.value)
          break
        case 345:
          this.ucsId = String(item.value)
          break
        case 346:
          this.ucsBaseId = String(item.value)
          break
        case 348:
          this.visualStyleId = String(item.value)
          break
        case 361:
          this.sunId = String(item.value)
          break
        case 421:
          this.ambientLightColorInstance = n
          break
        case 431:
          this.ambientLightColorName = String(item.value)
          break
        default:
          break
      }
    }

    this.applyViewportDxfIn(cx, cy, cz, vcx, vcy, vcz, vtx, vty, vtz)
    this._viewDirection.copy({ x: vdx, y: vdy, z: vdz })
    this._snapBase.copy({ x: sbx, y: sby, z: sbz })
    this._snapSpacing.copy({ x: ssx, y: ssy, z: ssz })
    this._gridSpacing.copy({ x: gsx, y: gsy, z: gsz })
    this._ucsOrigin.copy({ x: uox, y: uoy, z: uoz })
    this._ucsXAxis.copy({ x: uxx, y: uxy, z: uxz })
    this._ucsYAxis.copy({ x: uyx, y: uyy, z: uyz })
    this.frozenLayerIds = frozenLayerIds
    this.softPointers = softPointers
    return this
  }

  private applyViewportDxfIn(
    cx: number,
    cy: number,
    cz: number,
    vcx: number,
    vcy: number,
    vcz: number,
    vtx: number,
    vty: number,
    vtz: number
  ) {
    this.centerPoint.copy({ x: cx, y: cy, z: cz })
    this.viewCenter.copy({ x: vcx, y: vcy, z: vcz })
    this.viewTarget.copy({ x: vtx, y: vty, z: vtz })

    // Mirror libredwg-converter: repair collapsed default paper centers.
    const eps = 1e-6
    const centerAtOrigin = Math.abs(cx) < eps && Math.abs(cy) < eps
    const targetAtOrigin = Math.abs(vtx) < eps && Math.abs(vty) < eps
    const oneToOne =
      Number.isFinite(this.height) &&
      Number.isFinite(this.viewHeight) &&
      Math.abs(this.viewHeight - this.height) < eps
    if (centerAtOrigin && targetAtOrigin && oneToOne) {
      this.centerPoint.copy(this.viewCenter)
    }
  }

  private moveGripAt(gripIndex: number, offset: AcGeVector3dLike) {
    switch (gripIndex) {
      case 0:
        this._centerPoint.add(offset)
        break
      case 1:
      case 2:
      case 3:
      case 4: {
        const halfWidth = this.width / 2
        const halfHeight = this.height / 2
        const cx = this._centerPoint.x
        const cy = this._centerPoint.y
        const corners: Record<number, { x: number; y: number }> = {
          1: { x: cx - halfWidth, y: cy - halfHeight },
          2: { x: cx + halfWidth, y: cy - halfHeight },
          3: { x: cx + halfWidth, y: cy + halfHeight },
          4: { x: cx - halfWidth, y: cy + halfHeight }
        }
        const oppositeCornerIndex =
          gripIndex === 1 ? 3 : gripIndex === 2 ? 4 : gripIndex === 3 ? 1 : 2
        const moved = corners[gripIndex]
        const fixed = corners[oppositeCornerIndex]
        moved.x += offset.x
        moved.y += offset.y
        this._centerPoint.x = (moved.x + fixed.x) / 2
        this._centerPoint.y = (moved.y + fixed.y) / 2
        this._centerPoint.z = (this._centerPoint.z ?? 0) + (offset.z ?? 0)
        this.width = Math.abs(fixed.x - moved.x)
        this.height = Math.abs(fixed.y - moved.y)
        break
      }
      default:
        break
    }
  }
}

import { defaults } from '@mlightcad/common'
import { AcGeBox2d, AcGePoint2d } from '@mlightcad/geometry-engine'
import {
  AcGiDefaultLightingType,
  AcGiOrthographicType,
  AcGiRenderMode
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { ACTIVE_VPORT_NAME } from '../misc/AcDbConstants'
import {
  AcDbAbstractViewTableRecord,
  AcDbAbstractViewTableRecordAttrs
} from './AcDbAbstractViewTableRecord'
/** Reject saved views zoomed out more than this factor vs drawing EXTMIN/EXTMAX. */
const MAX_VIEW_TO_EXTENT_RATIO = 2

/** Max distance from drawing-extent center as a fraction of the larger span. */
const MAX_VIEW_CENTER_OFFSET_RATIO = 0.45

/** Max model-space view span when EXTMIN/EXTMAX are unavailable. */
const MAX_VIEW_SPAN_WITHOUT_EXTENTS = 1e5

/**
 * Interface defining the attributes for viewport table records.
 */
export interface AcDbViewportTableRecordAttrs
  extends AcDbAbstractViewTableRecordAttrs {
  /** Number of sides used for circle tessellation */
  circleSides: number
  /** Lower left corner of the viewport window */
  lowerLeftCorner: AcGePoint2d
  /** Upper right corner of the viewport window */
  upperRightCorner: AcGePoint2d
  /** Snap base point for the viewport */
  snapBase: AcGePoint2d
  /** Snap angle for the viewport */
  snapAngle: number
  /** Snap spacing for the viewport */
  snapSpacing: AcGePoint2d
  /** Standard flags for the viewport */
  standardFlag: number
  /** Grid spacing for the viewport */
  gridSpacing: AcGePoint2d
  /** Grid major spacing for the viewport */
  gridMajor: number
  /** Background object ID for the viewport */
  backgroundObjectId?: string
  /** UCS elevation for the viewport (DXF group 146) */
  ucsElevation: number
}

type VportAspectRatioSource = {
  aspectRatio?: number
  gsView?: { aspectRatio?: number }
}

function readVportAspectRatio(
  vport: AcDbViewportTableRecord
): number | undefined {
  const source = vport as AcDbViewportTableRecord & VportAspectRatioSource
  const aspectRatio = source.aspectRatio ?? source.gsView?.aspectRatio
  return Number.isFinite(aspectRatio) ? aspectRatio : undefined
}

function resolveViewAspectRatio(
  vport: AcDbViewportTableRecord,
  canvasAspectRatio: number
): number {
  if (Number.isFinite(canvasAspectRatio) && canvasAspectRatio > 0) {
    return canvasAspectRatio
  }
  const storedAspect = readVportAspectRatio(vport)
  if (storedAspect != null && storedAspect > 0) {
    return storedAspect
  }
  return 1
}

function intersectionArea(
  viewBox: AcGeBox2d,
  drawingExtents: AcGeBox2d
): number {
  const minX = Math.max(viewBox.min.x, drawingExtents.min.x)
  const minY = Math.max(viewBox.min.y, drawingExtents.min.y)
  const maxX = Math.min(viewBox.max.x, drawingExtents.max.x)
  const maxY = Math.min(viewBox.max.y, drawingExtents.max.y)
  if (minX >= maxX || minY >= maxY) {
    return 0
  }
  return (maxX - minX) * (maxY - minY)
}

function viewCenter(viewBox: AcGeBox2d) {
  return {
    x: (viewBox.min.x + viewBox.max.x) / 2,
    y: (viewBox.min.y + viewBox.max.y) / 2
  }
}

function hasMeaningfulDrawingExtents(
  drawingExtents?: AcGeBox2d
): drawingExtents is AcGeBox2d {
  if (!drawingExtents || drawingExtents.isEmpty()) {
    return false
  }
  const spanX = drawingExtents.max.x - drawingExtents.min.x
  const spanY = drawingExtents.max.y - drawingExtents.min.y
  return spanX > 0 && spanY > 0
}

/**
 * Represents a viewport table record in AutoCAD.
 *
 * This class represents viewport arrangements in AutoCAD, which define how
 * the drawing is displayed in different areas of the screen or paper space.
 * Viewports can have their own zoom levels, pan positions, grid settings,
 * and other display properties.
 *
 * @example
 * ```typescript
 * const viewportRecord = new AcDbViewportTableRecord();
 * viewportRecord.name = ACTIVE_VPORT_NAME;
 * viewportRecord.circleSides = 100;
 * viewportRecord.lowerLeftCorner = new AcGePoint2d(0, 0);
 * viewportRecord.upperRightCorner = new AcGePoint2d(1, 1);
 * ```
 */
export class AcDbViewportTableRecord extends AcDbAbstractViewTableRecord<AcDbViewportTableRecordAttrs> {
  /**
   * Returns true if the specified name is the active viewport table record.
   *
   * AutoCAD stores the current model-space viewport configuration as `*Active`.
   * DXF/DWG sources may emit different casing (`*ACTIVE`, `*active`, etc.), but
   * the names compare case-insensitively.
   */
  static isActiveVportName(name: string) {
    return name.toLowerCase() === ACTIVE_VPORT_NAME.toLowerCase()
  }

  /**
   * Creates a new AcDbViewportTableRecord instance.
   *
   * @param attrs - Input attribute values for this viewport table record
   * @param defaultAttrs - Default values for attributes of this viewport table record
   */
  constructor(
    attrs?: Partial<AcDbViewportTableRecordAttrs>,
    defaultAttrs?: Partial<AcDbViewportTableRecordAttrs>
  ) {
    attrs = attrs || {}
    defaults(attrs, {
      circleSides: 100,
      lowerLeftCorner: new AcGePoint2d(0, 0),
      upperRightCorner: new AcGePoint2d(1, 1),
      snapBase: new AcGePoint2d(0, 0),
      snapAngle: 0,
      snapSpacing: new AcGePoint2d(0, 0),
      standardFlag: 0,
      gridSpacing: new AcGePoint2d(),
      gridMajor: 10,
      ucsElevation: 0
    })
    super(attrs, defaultAttrs)
  }

  /**
   * Gets or sets the circle zoom percent.
   *
   * This controls the number of sides to the tessellation used when displaying
   * curves. The value can be between 1 and 20000, with higher settings using
   * more sides in the curve tessellation.
   *
   * @returns The number of sides used for circle tessellation
   *
   * @example
   * ```typescript
   * const sides = viewportRecord.circleSides;
   * viewportRecord.circleSides = 200; // Higher quality circles
   * ```
   */
  get circleSides() {
    return this.getAttr('circleSides')
  }
  set circleSides(value: number) {
    this.setAttr('circleSides', value)
  }

  /**
   * Gets the center point of the viewport.
   *
   * @returns The center point of the viewport
   *
   * @example
   * ```typescript
   * const center = viewportRecord.center;
   * ```
   */
  get center() {
    return this.centerPoint
  }
  set center(value: AcGePoint2d) {
    this.centerPoint = value
  }

  /**
   * Gets or sets the lower left corner of the viewport window.
   *
   * The X and Y values of this point are expressed as a value between (0.0, 0.0)
   * for the lower left corner of the AutoCAD graphics area and (1.0, 1.0) for
   * the upper right corner of the AutoCAD graphics area. For example, a lower
   * left corner value of (0.5, 0.0) indicates that the viewport's lower left
   * corner is along the bottom of the AutoCAD graphics area, midway between
   * the left and right edges of the graphics area.
   *
   * @returns The lower left corner point
   *
   * @example
   * ```typescript
   * const corner = viewportRecord.lowerLeftCorner;
   * viewportRecord.lowerLeftCorner = new AcGePoint2d(0.25, 0.25);
   * ```
   */
  get lowerLeftCorner() {
    return this.getAttr('lowerLeftCorner')
  }
  set lowerLeftCorner(value: AcGePoint2d) {
    this.getAttr('lowerLeftCorner').copy(value)
  }

  /**
   * The upper right corner of the viewport window. The X and Y values of this point are expressed as
   * a value between (0.0, 0.0) for the lower left corner of the AutoCAD graphics area and (1.0, 1.0)
   * for upper right corner of the AutoCAD graphics area. For example, an upper right corner value of
   * (0.5, 1.0) indicates that the viewport's upper right corner is along the top of the AutoCAD
   * graphics area, midway between the left and right edges of the graphics area.
   */
  get upperRightCorner() {
    return this.getAttr('upperRightCorner')
  }
  set upperRightCorner(value: AcGePoint2d) {
    this.getAttr('upperRightCorner').copy(value)
  }

  /**
   * The snap basepoint (in UCS coordinates) for the viewport table record.
   */
  get snapBase() {
    return this.getAttr('snapBase')
  }
  set snapBase(value: AcGePoint2d) {
    this.getAttr('snapBase').copy(value)
  }

  /**
   * The snap angle setting (in radians) for the viewport table record. The snap angle is measured
   * within the UCS XY plane, with zero being the UCS X axis and positive angles going counterclockwise
   * when looking down the UCS Z axis towards the UCS origin.
   */
  get snapAngle() {
    return this.getAttr('snapAngle')
  }
  set snapAngle(value: number) {
    this.setAttr('snapAngle', value)
  }

  /**
   * An AcGePoint2d in which the X value represents the X spacing of the snap grid and the Y value
   * represents the Y spacing of the snap grid. Both values are in drawing units.
   */
  get snapIncrements() {
    return this.getAttr('snapSpacing')
  }
  set snapIncrements(value: AcGePoint2d) {
    this.getAttr('snapSpacing').copy(value)
  }

  /**
   * The number of minor grid lines between each major grid line in the viewport.
   */
  get gridMajor() {
    return this.getAttr('gridMajor')
  }
  set gridMajor(value: number) {
    this.setAttr('gridMajor', value)
  }

  /**
   * An AcGePoint2d in which the X value represents the X spacing (in drawing units) of the grid and
   * the Y value represents the Y spacing of the grid.
   */
  get gridIncrements() {
    return this.getAttr('gridSpacing')
  }
  set gridIncrements(value: AcGePoint2d) {
    this.getAttr('gridSpacing').copy(value)
  }

  /*
   * Viewport status bit-coded flags:
   * - 1 (0x1) = Enables perspective mode
   * - 2 (0x2) = Enables front clipping
   * - 4 (0x4) = Enables back clipping
   * - 8 (0x8) = Enables UCS follow
   * - 16 (0x10) = Enables front clip not at eye
   * - 32 (0x20) = Enables UCS icon visibility
   * - 64 (0x40) = Enables UCS icon at origin
   * - 128 (0x80) = Enables fast zoom
   * - 256 (0x100) = Enables snap mode
   * - 512 (0x200) = Enables grid mode
   * - 1024 (0x400) = Enables isometric snap style
   * - 2048 (0x800) = Enables hide plot mode
   * - 4096 (0x1000) = kIsoPairTop. If set and kIsoPairRight is not set, then isopair top is enabled. If both kIsoPairTop and kIsoPairRight are set, then isopair left is enabled
   * - 8192 (0x2000) = kIsoPairRight. If set and kIsoPairTop is not set, then isopair right is enabled
   * - 16384 (0x4000) = Enables viewport zoom locking
   * - 32768 (0x8000) = Currently always enabled
   * - 65536 (0x10000) = Enables non-rectangular clipping
   * - 131072 (0x20000) = Turns the viewport off
   * - 262144 (0x40000) = Enables the display of the grid beyond the drawing limits
   * - 524288 (0x80000) = Enable adaptive grid display
   * - 1048576 (0x100000) = Enables subdivision of the grid below the set grid spacing when the grid display is adaptive
   * - 2097152 (0x200000) = Enables grid follows workplane switching
   *
   * @internal
   */
  get standardFlag() {
    return this.getAttr('standardFlag')
  }
  set standardFlag(value: number) {
    this.setAttr('standardFlag', value)
  }

  get snapEnabled() {
    return !!(this.standardFlag & 0x100)
  }

  /**
   * The object dD of the new background for the view.
   */
  get backgroundObjectId() {
    return this.getAttrWithoutException('backgroundObjectId')
  }
  set backgroundObjectId(value: string | undefined) {
    this.setAttr('backgroundObjectId', value)
  }

  /**
   * The UCS elevation for this viewport (DXF group 146).
   */
  get ucsElevation() {
    return this.getAttr('ucsElevation')
  }
  set ucsElevation(value: number) {
    this.setAttr('ucsElevation', value)
  }

  /**
   * Builds the model-space WCS view rectangle from this VPORT record.
   *
   * AutoCAD stores:
   * - view center in groups 12/22 (mapped to `centerPoint`) — in DCS
   *   (display coordinate system), i.e. relative to the view target and
   *   rotated by the view twist angle, NOT in WCS
   * - view target in group 17 (`viewTarget`) — in WCS
   * - view twist angle in group 51 (`viewTwistAngle`)
   * - view height in group 40/45 (`viewHeight`)
   * - aspect ratio in group 41 (`gsView.aspectRatio`) ??the AutoCAD graphics
   *   window width/height at save time, not the model-space view on its own
   *
   * The WCS view center is therefore `target + rotate(center, twist)`.
   * Most drawings save a (0,0,0) target so the distinction is invisible,
   * but AutoCAD does persist non-zero targets (e.g. after DVIEW/3D orbit
   * round-trips); ignoring the target restores the view over empty space
   * arbitrarily far from the drawing.
   *
   * View width = view height ? aspect ratio. The viewer uses the current canvas
   * aspect ratio so DWG/DXF exports of the same drawing frame identically even
   * when group 41 differs.
   */
  modelViewBox(canvasAspectRatio: number): AcGeBox2d | undefined {
    const center = this.centerPoint
    const viewHeight = this.viewHeight

    if (
      !Number.isFinite(center.x) ||
      !Number.isFinite(center.y) ||
      !Number.isFinite(viewHeight) ||
      viewHeight <= 0
    ) {
      return undefined
    }

    // DCS -> WCS: rotate the stored center by the twist angle, then
    // translate by the view target. The DCS axes are the WCS axes rotated
    // counterclockwise by the twist angle about the view direction, so DCS
    // coordinates map back to WCS by rotating +twist.
    const twist = this.viewTwistAngle
    let wcsCenterX = center.x
    let wcsCenterY = center.y
    if (Number.isFinite(twist) && twist !== 0) {
      const cos = Math.cos(twist)
      const sin = Math.sin(twist)
      wcsCenterX = center.x * cos - center.y * sin
      wcsCenterY = center.x * sin + center.y * cos
    }
    const target = this.viewTarget
    if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      wcsCenterX += target.x
      wcsCenterY += target.y
    }

    const aspectRatio = resolveViewAspectRatio(this, canvasAspectRatio)

    const viewWidth = viewHeight * aspectRatio
    const halfHeight = viewHeight / 2
    const halfWidth = viewWidth / 2

    return new AcGeBox2d()
      .expandByPoint({
        x: wcsCenterX - halfWidth,
        y: wcsCenterY - halfHeight
      })
      .expandByPoint({
        x: wcsCenterX + halfWidth,
        y: wcsCenterY + halfHeight
      })
  }

  /**
   * Returns whether a VPORT-derived view box is sane enough to frame the drawing
   * on open. Rejects stale saves that are zoomed far beyond the sheet (common
   * when `$EXTMIN`/`$EXTMAX` reflect the title block but `*ACTIVE` still stores
   * a huge `view height`) or panned to a corner with no real geometry.
   */
  static isModelViewBoxUsable(
    viewBox: AcGeBox2d,
    drawingExtents: AcGeBox2d
  ): boolean {
    if (viewBox.isEmpty() || drawingExtents.isEmpty()) {
      return false
    }

    const viewSpanX = viewBox.max.x - viewBox.min.x
    const viewSpanY = viewBox.max.y - viewBox.min.y
    const extSpanX = drawingExtents.max.x - drawingExtents.min.x
    const extSpanY = drawingExtents.max.y - drawingExtents.min.y

    if (viewSpanX <= 0 || viewSpanY <= 0 || extSpanX <= 0 || extSpanY <= 0) {
      return false
    }

    if (
      viewSpanX > extSpanX * MAX_VIEW_TO_EXTENT_RATIO ||
      viewSpanY > extSpanY * MAX_VIEW_TO_EXTENT_RATIO
    ) {
      return false
    }

    const centerOffsetLimit =
      Math.max(extSpanX, extSpanY) * MAX_VIEW_CENTER_OFFSET_RATIO
    const viewCenterPoint = viewCenter(viewBox)
    const extentCenterPoint = viewCenter(drawingExtents)
    const centerDistance = Math.hypot(
      viewCenterPoint.x - extentCenterPoint.x,
      viewCenterPoint.y - extentCenterPoint.y
    )
    if (centerDistance > centerOffsetLimit) {
      return false
    }

    const viewArea = viewSpanX * viewSpanY
    const overlap = intersectionArea(viewBox, drawingExtents)
    if (overlap <= 0 || overlap / viewArea < 0.25) {
      return false
    }

    return true
  }

  /**
   * Returns the model-space view box from this record when structurally valid
   * and plausible for the given drawing extents.
   */
  resolveModelViewBox(
    canvasAspectRatio: number,
    drawingExtents?: AcGeBox2d
  ): AcGeBox2d | undefined {
    const viewBox = this.modelViewBox(canvasAspectRatio)
    if (
      !viewBox ||
      !AcDbViewportTableRecord.isModelViewBoxStructurallyValid(viewBox)
    ) {
      return undefined
    }
    if (hasMeaningfulDrawingExtents(drawingExtents)) {
      if (
        !AcDbViewportTableRecord.isModelViewBoxUsable(viewBox, drawingExtents)
      ) {
        return undefined
      }
    } else if (
      !AcDbViewportTableRecord.isModelViewBoxPlausibleWithoutExtents(viewBox)
    ) {
      return undefined
    }
    return viewBox
  }

  private static isModelViewBoxStructurallyValid(viewBox: AcGeBox2d): boolean {
    if (viewBox.isEmpty()) {
      return false
    }

    const viewSpanX = viewBox.max.x - viewBox.min.x
    const viewSpanY = viewBox.max.y - viewBox.min.y
    return (
      Number.isFinite(viewSpanX) &&
      Number.isFinite(viewSpanY) &&
      viewSpanX > 0 &&
      viewSpanY > 0
    )
  }

  private static isModelViewBoxPlausibleWithoutExtents(
    viewBox: AcGeBox2d
  ): boolean {
    const viewSpanX = viewBox.max.x - viewBox.min.x
    const viewSpanY = viewBox.max.y - viewBox.min.y
    return Math.max(viewSpanX, viewSpanY) <= MAX_VIEW_SPAN_WITHOUT_EXTENTS
  }

  /**
   * Writes DXF fields for this object.
   *
   * @param filer - DXF output writer.
   * @returns The instance (for chaining).
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbViewportTableRecord')
    filer.writeString(2, this.name)
    filer.writeDouble(40, this.gsView.viewHeight)
    if (
      this.gsView.aspectRatio != null &&
      Number.isFinite(this.gsView.aspectRatio)
    ) {
      filer.writeDouble(41, this.gsView.aspectRatio)
    }
    const targetVersion = filer.version?.value ?? 33
    if (targetVersion >= 27) filer.writeDouble(45, this.gsView.viewHeight)
    filer.writePoint2d(10, this.lowerLeftCorner)
    filer.writePoint2d(11, this.upperRightCorner)
    filer.writePoint2d(12, this.center)
    filer.writePoint2d(13, this.snapBase)
    filer.writePoint2d(14, this.snapIncrements)
    filer.writePoint2d(15, this.gridIncrements)
    filer.writeInt16(70, this.standardFlag)
    filer.writeInt16(71, this.gsView.viewMode)
    filer.writeInt16(72, this.circleSides)
    filer.writeDouble(42, this.gsView.lensLength)
    filer.writePoint3d(16, this.gsView.viewDirectionFromTarget)
    filer.writePoint3d(17, this.gsView.viewTarget)
    filer.writeAngle(50, this.snapAngle)
    filer.writeAngle(51, this.gsView.viewTwistAngle)
    filer.writeInt16(61, this.gridMajor)
    filer.writeDouble(146, this.ucsElevation)
    filer.writeInt16(281, this.gsView.renderMode)
    if (targetVersion >= 25) {
      filer.writeInt16(170, this.shadePlotSetting)
      filer.writeObjectId(333, this.shadePlotObjectId)
    }
    if (targetVersion >= 27) {
      filer.writeInt16(282, this.defaultLightingType)
      filer.writeInt16(292, this.isDefaultLightingOn ? 1 : 0)
      filer.writeObjectId(332, this.backgroundObjectId)
      filer.writeObjectId(348, this.gsView.visualStyleObjectId)
    }
    return this
  }

  override dxfInFields(filer: AcDbDxfFiler): this {
    super.dxfInFields(filer)
    filer.atSubclassData('AcDbSymbolTableRecord')
    filer.atSubclassData('AcDbAbstractViewTableRecord')
    filer.atSubclassData('AcDbViewportTableRecord')

    const frozenLayers: string[] = [...(this.gsView.frozenLayers ?? [])]

    while (!filer.atEndOfObject && !filer.atEof && !filer.atExtendedData) {
      const item = filer.readItem()
      if (!item) break
      const code = Number(item.code)
      if (code === 100) {
        filer.pushBackItem(item)
        break
      }
      const n = Number(item.value)
      switch (code) {
        case 2:
          this.name = String(item.value)
          break
        case 1:
          this.gsView.styleSheet = String(item.value)
          break
        case 10:
          this.lowerLeftCorner.x = n
          break
        case 20:
          this.lowerLeftCorner.y = n
          break
        case 11:
          this.upperRightCorner.x = n
          break
        case 21:
          this.upperRightCorner.y = n
          break
        case 12:
          this.center.x = n
          this.gsView.center.x = n
          break
        case 22:
          this.center.y = n
          this.gsView.center.y = n
          break
        case 13:
          this.snapBase.x = n
          break
        case 23:
          this.snapBase.y = n
          break
        case 14:
          this.snapIncrements.x = n
          break
        case 24:
          this.snapIncrements.y = n
          break
        case 15:
          this.gridIncrements.x = n
          break
        case 25:
          this.gridIncrements.y = n
          break
        case 16:
          this.gsView.viewDirectionFromTarget.x = n
          break
        case 26:
          this.gsView.viewDirectionFromTarget.y = n
          break
        case 36:
          this.gsView.viewDirectionFromTarget.z = n
          break
        case 17:
          this.gsView.viewTarget.x = n
          break
        case 27:
          this.gsView.viewTarget.y = n
          break
        case 37:
          this.gsView.viewTarget.z = n
          break
        case 40:
        case 45:
          this.gsView.viewHeight = n
          break
        case 41:
          if (Number.isFinite(n) && n > 0) {
            this.gsView.aspectRatio = n
          }
          break
        case 42:
          this.gsView.lensLength = n
          break
        case 43:
          this.gsView.frontClippingPlane = n
          break
        case 44:
          this.gsView.backClippingPlane = n
          break
        case 50:
          this.snapAngle = n
          break
        case 51:
          this.gsView.viewTwistAngle = n
          break
        case 61:
          this.gridMajor = n
          break
        case 70:
          this.standardFlag = n
          break
        case 71:
          // Project writer stores circleSides here; AutoCAD uses view mode.
          // Prefer circleSides when value looks like a tessellation count.
          if (n >= 1 && n <= 20000) {
            this.circleSides = n
          }
          this.gsView.viewMode = n
          break
        case 72:
          this.circleSides = n
          break
        case 74:
          this.gsView.ucsIconSetting = n
          break
        case 110:
          this.gsView.ucsOrigin.x = n
          break
        case 120:
          this.gsView.ucsOrigin.y = n
          break
        case 130:
          this.gsView.ucsOrigin.z = n
          break
        case 111:
          this.gsView.ucsXAxis.x = n
          break
        case 121:
          this.gsView.ucsXAxis.y = n
          break
        case 131:
          this.gsView.ucsXAxis.z = n
          break
        case 112:
          this.gsView.ucsYAxis.x = n
          break
        case 122:
          this.gsView.ucsYAxis.y = n
          break
        case 132:
          this.gsView.ucsYAxis.z = n
          break
        case 79:
          this.gsView.orthographicType = n as AcGiOrthographicType
          break
        case 281:
          // AutoCAD: render mode. Project writer: background on/off flag.
          if (n === 0 || n === 1) {
            // Keep as render mode when 0/1; background id comes from 332.
          }
          this.gsView.renderMode = n as AcGiRenderMode
          break
        case 331:
        case 441:
          frozenLayers.push(String(item.value))
          break
        case 332:
          this.backgroundObjectId = String(item.value)
          break
        case 146:
          this.ucsElevation = n
          break
        case 170:
          this.shadePlotSetting = n
          break
        case 282:
          this.defaultLightingType = n as AcGiDefaultLightingType
          break
        case 292:
          this.isDefaultLightingOn = n !== 0
          break
        case 333:
          this.shadePlotObjectId = String(item.value)
          break
        case 348:
          this.gsView.visualStyleObjectId = String(item.value)
          break
        // Common VPORT flags we tolerate but do not map yet.
        case 73:
        case 75:
        case 76:
        case 77:
        case 78:
        case 60:
        case 65:
        case 141:
        case 142:
        case 63:
        case 421:
        case 431:
          break
        default:
          break
      }
    }

    this.gsView.frozenLayers = frozenLayers
    return this
  }
}

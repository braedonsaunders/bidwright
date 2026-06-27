import { defaults } from '@mlightcad/common'
import { AcGeBox2d, AcGePoint2d } from '@mlightcad/geometry-engine'

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
      gridMajor: 10
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
   * Builds the model-space WCS view rectangle from this VPORT record.
   *
   * AutoCAD stores:
   * - view center in groups 10/20 (mapped to `centerPoint`)
   * - view height in group 40/45 (`viewHeight`)
   * - aspect ratio in group 41 (`gsView.aspectRatio`) ??the AutoCAD graphics
   *   window width/height at save time, not the model-space view on its own
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

    const aspectRatio = resolveViewAspectRatio(this, canvasAspectRatio)

    const viewWidth = viewHeight * aspectRatio
    const halfHeight = viewHeight / 2
    const halfWidth = viewWidth / 2

    return new AcGeBox2d()
      .expandByPoint({
        x: center.x - halfWidth,
        y: center.y - halfHeight
      })
      .expandByPoint({
        x: center.x + halfWidth,
        y: center.y + halfHeight
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
    filer.writeDouble(45, this.gsView.viewHeight)
    filer.writePoint2d(10, this.lowerLeftCorner)
    filer.writePoint2d(11, this.upperRightCorner)
    filer.writePoint2d(12, this.center)
    filer.writePoint2d(13, this.snapBase)
    filer.writePoint2d(14, this.snapIncrements)
    filer.writePoint2d(15, this.gridIncrements)
    filer.writeInt16(70, this.standardFlag)
    filer.writeInt16(71, this.circleSides)
    filer.writeDouble(42, this.gsView.lensLength)
    filer.writePoint3d(16, this.gsView.viewDirectionFromTarget)
    filer.writePoint3d(17, this.gsView.viewTarget)
    filer.writeAngle(50, this.snapAngle)
    filer.writeAngle(51, this.gsView.viewTwistAngle)
    filer.writeInt16(61, this.gridMajor)
    filer.writeInt16(281, this.backgroundObjectId ? 1 : 0)
    filer.writeObjectId(332, this.backgroundObjectId)
    return this
  }
}
import {
  AcGeArea2d,
  AcGeBox3d,
  AcGeCircArc3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiEntity, AcGiRenderer } from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import {
  ByBlock,
  ByLayer,
  DEFAULT_LINE_TYPE,
  DEFAULT_MLINE_STYLE
} from '../misc/AcDbConstants'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbMlineStyle } from '../object/AcDbMlineStyle'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import {
  acdbForEachGripIndex,
  acdbMovePointArrayGripAt
} from './AcDbGripHelpers'
import {
  acdbCollectLineSegmentOsnapPoints,
  acdbPickNearestOsnapPoint
} from './AcDbOsnapHelpers'

/**
 * Defines MLINE justification relative to the style element offsets.
 */
export enum AcDbMLineJustification {
  /**
   * Places all style elements below or on the reference path.
   */
  Top = 0,
  /**
   * Centers style elements around the reference path.
   */
  Zero = 1,
  /**
   * Places all style elements above or on the reference path.
   */
  Bottom = 2
}

/**
 * Bit flags used by MLINE entities.
 */
export enum AcDbMLineFlags {
  /**
   * Indicates the MLINE currently contains at least one segment vertex.
   */
  HasVertex = 1,
  /**
   * Indicates the MLINE should be treated as a closed loop.
   */
  Closed = 2,
  /**
   * Suppresses cap geometry at the start of the MLINE.
   */
  SuppressStartCaps = 4,
  /**
   * Suppresses cap geometry at the end of the MLINE.
   */
  SuppressEndCaps = 8
}

/**
 * Bit flags used by MLINESTYLE objects.
 */
enum AcDbMLineStyleFlags {
  /**
   * Enables fill rendering between the outer and inner style elements.
   */
  FillOn = 1,
  /**
   * Enables drawing miter connector lines at polyline joints.
   */
  DisplayMiters = 2,
  /**
   * Enables square-line start cap.
   */
  StartSquareCap = 16,
  /**
   * Enables inner-arc start cap pairs.
   */
  StartInnerArcs = 32,
  /**
   * Enables outer-arc start cap.
   */
  StartRoundCap = 64,
  /**
   * Enables square-line end cap.
   */
  EndSquareCap = 256,
  /**
   * Enables inner-arc end cap pairs.
   */
  EndInnerArcs = 512,
  /**
   * Enables outer-arc end cap.
   */
  EndRoundCap = 1024
}

/**
 * Input payload for one MLINE element in a segment.
 */
export interface AcDbMLineElementLike {
  /**
   * Number of line parameters described in {@link parameters}.
   * If omitted, the count is inferred from the array length.
   */
  parameterCount?: number
  /**
   * Element parameters where the first value is treated as the miter offset.
   */
  parameters?: number[]
  /**
   * Number of fill parameters described in {@link fillParameters}.
   * If omitted, the count is inferred from the array length.
   */
  fillCount?: number
  /**
   * Fill parameters used by consumers that need style-specific fill metadata.
   */
  fillParameters?: number[]
}

/**
 * Normalized MLINE element data.
 */
export interface AcDbMLineElement {
  /**
   * Number of values in {@link parameters}.
   */
  parameterCount: number
  /**
   * Resolved element parameter array.
   */
  parameters: number[]
  /**
   * Number of values in {@link fillParameters}.
   */
  fillCount: number
  /**
   * Resolved fill parameter array.
   */
  fillParameters: number[]
}

/**
 * Input payload for one MLINE segment.
 */
export interface AcDbMLineSegmentLike {
  /**
   * Segment vertex in world coordinates.
   */
  position: AcGePoint3dLike
  /**
   * Segment direction vector along the reference path.
   */
  direction: AcGeVector3dLike
  /**
   * Miter direction used to offset each style element.
   */
  miterDirection: AcGeVector3dLike
  /**
   * Optional per-element parameter data for this segment.
   */
  elements?: AcDbMLineElementLike[]
}

/**
 * Normalized MLINE segment data.
 */
export interface AcDbMLineSegment {
  /**
   * Segment vertex in world coordinates.
   */
  position: AcGePoint3d
  /**
   * Segment direction vector along the reference path.
   */
  direction: AcGeVector3d
  /**
   * Miter direction used to offset each style element.
   */
  miterDirection: AcGeVector3d
  /**
   * Resolved per-element parameter data for the segment.
   */
  elements: AcDbMLineElement[]
}

/**
 * Represents the AutoCAD MLINE entity.
 */
export class AcDbMLine extends AcDbEntity {
  /**
   * Runtime type name used by the entity factory and RTTI helpers.
   */
  static override typeName: string = 'MLine'

  /**
   * DXF entity type token written to or read from drawing files.
   */
  override get dxfTypeName() {
    return 'MLINE'
  }

  private _styleName: string
  private _styleObjectHandle: string
  private _scale: number
  private _justification: AcDbMLineJustification
  private _flags: number
  private _styleCount: number
  private _startPosition: AcGePoint3d
  private _normal: AcGeVector3d
  private _segments: AcDbMLineSegment[]

  /**
   * Creates a new MLINE entity initialized with AutoCAD-compatible defaults.
   */
  constructor() {
    super()
    this._styleName = ''
    this._styleObjectHandle = ''
    this._scale = 1
    this._justification = AcDbMLineJustification.Zero
    this._flags = 0
    this._styleCount = 0
    this._startPosition = new AcGePoint3d()
    this._normal = new AcGeVector3d(0, 0, 1)
    this._segments = []
  }

  /**
   * Gets the style name used to resolve the MLINE style object.
   *
   * @returns Current style name.
   */
  get styleName() {
    return this._styleName || this.getDefaultStyleName()
  }
  /**
   * Sets the style name used to resolve the MLINE style object.
   *
   * @param value New style name.
   */
  set styleName(value: string) {
    this._styleName = value
  }

  /**
   * Gets the handle of the referenced MLINESTYLE object.
   *
   * @returns Style object handle.
   */
  get styleObjectHandle() {
    return this._styleObjectHandle
  }
  /**
   * Sets the handle of the referenced MLINESTYLE object.
   *
   * @param value Style object handle.
   */
  set styleObjectHandle(value: string) {
    this._styleObjectHandle = value
  }

  /**
   * Gets the global scale factor applied to style offsets.
   *
   * @returns MLINE scale.
   */
  get scale() {
    return this._scale
  }
  /**
   * Sets the global scale factor applied to style offsets.
   *
   * @param value MLINE scale.
   */
  set scale(value: number) {
    this._scale = value
  }

  /**
   * Gets the current justification mode.
   *
   * @returns Justification enum value.
   */
  get justification() {
    return this._justification
  }
  /**
   * Sets the current justification mode.
   *
   * @param value Justification enum value.
   */
  set justification(value: AcDbMLineJustification) {
    this._justification = value
  }

  /**
   * Gets the raw MLINE bit flags.
   *
   * @returns Bitwise combination of {@link AcDbMLineFlags}.
   */
  get flags() {
    return this._flags
  }
  /**
   * Sets the raw MLINE bit flags.
   *
   * @param value Bitwise combination of {@link AcDbMLineFlags}.
   */
  set flags(value: number) {
    this._flags = value
  }

  /**
   * Gets the number of style elements expected by the entity.
   *
   * @returns Style element count.
   */
  get styleCount() {
    return this._styleCount
  }
  /**
   * Sets the style element count.
   * Negative values are clamped to `0`.
   *
   * @param value Requested style element count.
   */
  set styleCount(value: number) {
    this._styleCount = Math.max(0, value)
  }

  /**
   * Gets the MLINE start point in world coordinates.
   *
   * @returns Start point instance.
   */
  get startPosition() {
    return this._startPosition
  }
  /**
   * Sets the MLINE start point in world coordinates.
   *
   * @param value New start point.
   */
  set startPosition(value: AcGePoint3dLike) {
    this._startPosition.copy(value)
  }

  /**
   * Gets the MLINE plane normal.
   *
   * @returns Normal vector instance.
   */
  get normal() {
    return this._normal
  }
  /**
   * Sets the MLINE plane normal.
   *
   * @param value New normal vector.
   */
  set normal(value: AcGeVector3dLike) {
    this._normal.copy(value)
  }

  /**
   * Gets a deep-cloned snapshot of all segments.
   * Mutating the returned array or objects will not affect internal state.
   *
   * @returns Cloned segment collection.
   */
  get segments() {
    return this._segments.map(segment => this.cloneSegment(segment))
  }
  /**
   * Replaces all segments using normalized internal copies.
   * Also updates the internal `HasVertex` flag.
   *
   * @param value Segment list to normalize and store.
   */
  set segments(value: AcDbMLineSegmentLike[]) {
    this._segments = value.map(segment => this.createSegment(segment))
    this.updateHasVertexFlag()
  }

  /**
   * Gets the number of stored segment vertices.
   *
   * @returns Vertex count.
   */
  get vertexCount() {
    return this._segments.length
  }

  /**
   * Indicates whether the MLINE is closed.
   *
   * @returns `true` when the `Closed` flag is set.
   */
  get closed() {
    return (this._flags & AcDbMLineFlags.Closed) !== 0
  }
  /**
   * Enables or disables closed-loop behavior.
   *
   * @param value `true` to close the path, otherwise `false`.
   */
  set closed(value: boolean) {
    this.setFlag(AcDbMLineFlags.Closed, value)
  }

  /**
   * Indicates whether start caps are suppressed during rendering.
   *
   * @returns `true` when the `SuppressStartCaps` flag is set.
   */
  get suppressStartCaps() {
    return (this._flags & AcDbMLineFlags.SuppressStartCaps) !== 0
  }
  /**
   * Enables or disables start cap suppression.
   *
   * @param value `true` to suppress start caps.
   */
  set suppressStartCaps(value: boolean) {
    this.setFlag(AcDbMLineFlags.SuppressStartCaps, value)
  }

  /**
   * Indicates whether end caps are suppressed during rendering.
   *
   * @returns `true` when the `SuppressEndCaps` flag is set.
   */
  get suppressEndCaps() {
    return (this._flags & AcDbMLineFlags.SuppressEndCaps) !== 0
  }
  /**
   * Enables or disables end cap suppression.
   *
   * @param value `true` to suppress end caps.
   */
  set suppressEndCaps(value: boolean) {
    this.setFlag(AcDbMLineFlags.SuppressEndCaps, value)
  }

  /**
   * Appends one segment to the MLINE.
   * The segment is normalized into internal geometry instances.
   *
   * @param segment Segment payload to append.
   */
  appendSegment(segment: AcDbMLineSegmentLike) {
    this._segments.push(this.createSegment(segment))
    this.updateHasVertexFlag()
  }

  /**
   * Removes all segments and clears the `HasVertex` flag.
   */
  clearSegments() {
    this._segments = []
    this.updateHasVertexFlag()
  }

  /**
   * Computes a bounding box from renderable MLINE geometry.
   *
   * @returns Axis-aligned 3D extents box.
   */
  get geometricExtents() {
    const points = this.collectGeometryPoints()
    const box = new AcGeBox3d()
    return box.setFromPoints(points)
  }

  /**
   * Applies a transformation matrix to the full MLINE geometry.
   * Points are transformed directly, while vectors are transformed without
   * introducing translation components.
   *
   * @param matrix Matrix to apply.
   * @returns The same entity instance for chaining.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._startPosition.applyMatrix4(matrix)
    this._segments.forEach(segment => {
      segment.position.applyMatrix4(matrix)
      this.transformVector(segment.direction, matrix)
      this.transformVector(segment.miterDirection, matrix)
    })
    this.transformVector(this._normal, matrix)
    return this
  }

  /**
   * Exposes editable property metadata for UI/property panels.
   *
   * @returns Entity property definition grouped by category.
   */
  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'mline',
          properties: [
            {
              name: 'styleName',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.styleName,
                set: (value: string) => {
                  this.styleName = value
                }
              }
            },
            {
              name: 'scale',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.scale,
                set: (value: number) => {
                  this.scale = value
                }
              }
            },
            {
              name: 'justification',
              type: 'int',
              editable: true,
              accessor: {
                get: () => this.justification,
                set: (value: number) => {
                  this.justification = value as AcDbMLineJustification
                }
              }
            },
            {
              name: 'closed',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.closed,
                set: (value: boolean) => {
                  this.closed = value
                }
              }
            },
            {
              name: 'vertexCount',
              type: 'int',
              editable: false,
              accessor: {
                get: () => this.vertexCount
              }
            }
          ]
        }
      ]
    }
  }

  /**
   * Gets the grip points for this MLINE reference path.
   *
   * Grip points are placed at the start point and each segment vertex,
   * matching AutoCAD MLINE grip behavior on the reference path.
   *
   * @returns Array of grip points as 3D points
   */
  subGetGripPoints() {
    const gripPoints = new Array<AcGePoint3d>()
    gripPoints.push(this._startPosition.clone())
    this._segments.forEach(segment => gripPoints.push(segment.position.clone()))
    return gripPoints
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    const gripPoints = [
      this._startPosition,
      ...this._segments.map(segment => segment.position)
    ]
    acdbMovePointArrayGripAt(indices, offset, gripPoints)
    acdbForEachGripIndex(indices, index => {
      this.updateReferencePathDirectionsAfterGripMove(index)
    })
    return this
  }

  /**
   * Gets the object snap points for this MLINE reference path.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    const path = [
      this._startPosition,
      ...this._segments.map(segment => segment.position)
    ]
    if (path.length === 0) return

    switch (osnapMode) {
      case AcDbOsnapMode.EndPoint:
        snapPoints.push(...path)
        break
      case AcDbOsnapMode.MidPoint:
      case AcDbOsnapMode.Nearest:
      case AcDbOsnapMode.Perpendicular: {
        const candidates: AcGePoint3d[] = []
        for (let index = 0; index < path.length - 1; index++) {
          const segmentSnaps: AcGePoint3d[] = []
          acdbCollectLineSegmentOsnapPoints(
            path[index],
            path[index + 1],
            osnapMode,
            pickPoint,
            segmentSnaps
          )
          candidates.push(...segmentSnaps)
        }
        if (osnapMode === AcDbOsnapMode.MidPoint) {
          snapPoints.push(...candidates)
        } else {
          const nearest = acdbPickNearestOsnapPoint(pickPoint, candidates)
          if (nearest) snapPoints.push(nearest)
        }
        break
      }
      default:
        break
    }
  }

  /**
   * Renders this MLINE into one or more graphic interface entities.
   * It draws optional fill first and then style element lines.
   *
   * @param renderer Active graphics renderer.
   * @returns A single entity, an entity group, or `undefined` when nothing is drawable.
   */
  subWorldDraw(renderer: AcGiRenderer): AcGiEntity | undefined {
    if (this._segments.length === 0) return undefined

    const entities: AcGiEntity[] = []
    const mlineStyle = this.getMLineStyle()
    const elementCount = this.getRenderableElementCount(mlineStyle)
    const traits = renderer.subEntityTraits
    const originalColor = traits.color
    const originalLineType = traits.lineType
    const originalFillType = traits.fillType
    const originalDrawOrder = traits.drawOrder

    const fillArea = this.createFillArea(mlineStyle, elementCount)
    if (fillArea) {
      traits.color = originalColor
      this.applyFillTraits(mlineStyle, traits)
      traits.fillType = {
        solidFill: true,
        patternAngle: 0,
        definitionLines: []
      }
      traits.drawOrder = -1
      entities.push(renderer.area(fillArea))
      traits.fillType = originalFillType
      traits.drawOrder = originalDrawOrder
    }

    if (elementCount <= 0) {
      const reference = this.getReferencePath()
      if (reference.length >= 2) entities.push(renderer.lines(reference))
    } else {
      for (let elementIndex = 0; elementIndex < elementCount; elementIndex++) {
        traits.color = originalColor
        traits.lineType = originalLineType
        this.applyStyleElementTraits(mlineStyle, elementIndex, traits)
        const points = this.getElementPath(elementIndex, mlineStyle)
        if (points.length >= 2) {
          entities.push(renderer.lines(points))
        }
      }
      this.appendStyleDrivenJointAndCapEntities(
        renderer,
        entities,
        mlineStyle,
        elementCount,
        originalColor,
        originalLineType
      )
    }
    traits.color = originalColor
    traits.lineType = originalLineType
    traits.fillType = originalFillType
    traits.drawOrder = originalDrawOrder

    if (entities.length === 0) return undefined
    return entities.length === 1 ? entities[0] : renderer.group(entities)
  }

  /**
   * Serializes MLINE-specific fields to the DXF filer.
   *
   * @param filer DXF writer context.
   * @returns The current entity instance.
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbMline')
    filer.writeString(2, this.styleName)
    filer.writeHandle(340, this._styleObjectHandle)
    filer.writeDouble(40, this._scale)
    filer.writeInt16(70, this._justification)
    filer.writeInt16(71, this._flags)
    filer.writeInt16(72, this.vertexCount)
    filer.writeInt16(73, this._styleCount)
    filer.writePoint3d(10, this._startPosition)
    filer.writeVector3d(210, this._normal)

    this._segments.forEach(segment => {
      filer.writePoint3d(11, segment.position)
      filer.writeVector3d(12, segment.direction)
      filer.writeVector3d(13, segment.miterDirection)
      segment.elements.forEach(element => {
        filer.writeInt16(74, element.parameterCount)
        element.parameters.forEach(parameter =>
          filer.writeDouble(41, parameter)
        )
        filer.writeInt16(75, element.fillCount)
        element.fillParameters.forEach(parameter =>
          filer.writeDouble(42, parameter)
        )
      })
    })
    return this
  }

  /**
   * Sets or clears a single MLINE bit flag.
   *
   * @param flag Flag bit to update.
   * @param enabled Whether the flag should be set.
   */
  private setFlag(flag: AcDbMLineFlags, enabled: boolean) {
    if (enabled) {
      this._flags |= flag
    } else {
      this._flags &= ~flag
    }
  }

  /**
   * Synchronizes the `HasVertex` flag with current segment count.
   */
  private updateHasVertexFlag() {
    this.setFlag(AcDbMLineFlags.HasVertex, this._segments.length > 0)
  }

  /**
   * Normalizes segment-like input into internal segment storage.
   *
   * @param segment Segment-like payload.
   * @returns Normalized segment.
   */
  /**
   * Recomputes segment direction vectors affected by moving one reference-path grip.
   *
   * @param gripIndex Zero-based index into {@link subGetGripPoints}.
   */
  private updateReferencePathDirectionsAfterGripMove(gripIndex: number) {
    const updateDirectionAtSegment = (segmentIndex: number) => {
      const segment = this._segments[segmentIndex]
      if (!segment) return

      const previousPoint =
        segmentIndex === 0
          ? this._startPosition
          : this._segments[segmentIndex - 1].position
      const direction = new AcGeVector3d().subVectors(
        segment.position,
        previousPoint
      )
      if (direction.lengthSq() > 0) {
        segment.direction.copy(direction.normalize())
      }
    }

    if (gripIndex === 0) {
      if (this._segments.length > 0) {
        updateDirectionAtSegment(0)
      }
      return
    }

    const segmentIndex = gripIndex - 1
    if (segmentIndex < 0 || segmentIndex >= this._segments.length) {
      return
    }

    updateDirectionAtSegment(segmentIndex)
    if (segmentIndex + 1 < this._segments.length) {
      updateDirectionAtSegment(segmentIndex + 1)
    }
  }

  private createSegment(segment: AcDbMLineSegmentLike): AcDbMLineSegment {
    return {
      position: new AcGePoint3d().copy(segment.position),
      direction: new AcGeVector3d().copy(segment.direction),
      miterDirection: new AcGeVector3d().copy(segment.miterDirection),
      elements:
        segment.elements?.map(element => this.createElement(element)) ?? []
    }
  }

  /**
   * Normalizes element-like input and infers count fields when missing.
   *
   * @param element Element-like payload.
   * @returns Normalized element.
   */
  private createElement(element: AcDbMLineElementLike): AcDbMLineElement {
    const parameters = element.parameters ? [...element.parameters] : []
    const fillParameters = element.fillParameters
      ? [...element.fillParameters]
      : []
    return {
      parameterCount: element.parameterCount ?? parameters.length,
      parameters,
      fillCount: element.fillCount ?? fillParameters.length,
      fillParameters
    }
  }

  /**
   * Produces a deep clone of one normalized segment.
   *
   * @param segment Source segment.
   * @returns Deep-cloned segment.
   */
  private cloneSegment(segment: AcDbMLineSegment): AcDbMLineSegment {
    return {
      position: segment.position.clone(),
      direction: segment.direction.clone(),
      miterDirection: segment.miterDirection.clone(),
      elements: segment.elements.map(element => ({
        parameterCount: element.parameterCount,
        parameters: [...element.parameters],
        fillCount: element.fillCount,
        fillParameters: [...element.fillParameters]
      }))
    }
  }

  /**
   * Collects points that represent all drawable geometry for extents calculation.
   *
   * @returns Geometry point list in world coordinates.
   */
  private collectGeometryPoints() {
    const points: AcGePoint3d[] = [this._startPosition]
    if (this._segments.length === 0) return points

    const mlineStyle = this.getMLineStyle()
    const elementCount = this.getRenderableElementCount(mlineStyle)
    if (elementCount <= 0) {
      this._segments.forEach(segment => points.push(segment.position))
      return points
    }

    for (let i = 0; i < elementCount; i++) {
      points.push(...this.getElementPath(i, mlineStyle))
    }
    return points
  }

  /**
   * Calculates how many element paths should be rendered.
   * Uses the max of entity style count, style definition count, and segment data.
   *
   * @param mlineStyle Resolved style object, if available.
   * @returns Renderable element count.
   */
  private getRenderableElementCount(mlineStyle?: AcDbMlineStyle) {
    const styleElementCount = mlineStyle?.elementCount ?? 0
    return Math.max(
      this._styleCount,
      styleElementCount,
      ...this._segments.map(segment => segment.elements.length),
      0
    )
  }

  /**
   * Builds the un-offset reference polyline path from start point and segments.
   *
   * @returns Reference path points, optionally closed when needed.
   */
  private getReferencePath() {
    const points = [
      this._startPosition.clone(),
      ...this._segments.map(segment => segment.position.clone())
    ]
    return this.closePathIfNeeded(points)
  }

  /**
   * Computes one style element path by offsetting every segment along its miter direction.
   *
   * @param elementIndex Style element index to evaluate.
   * @param mlineStyle Resolved style object, if available.
   * @returns Offset path points, optionally closed when needed.
   */
  private getElementPath(elementIndex: number, mlineStyle?: AcDbMlineStyle) {
    const points: AcGePoint3d[] = []
    const first = this._segments[0]
    points.push(
      this.getElementBoundaryPoint('start', first, elementIndex, mlineStyle)
    )
    this._segments.forEach(segment => {
      points.push(
        this.offsetPoint(
          segment.position,
          segment.miterDirection,
          this.getElementMiterOffset(segment, elementIndex, mlineStyle)
        )
      )
    })

    points[points.length - 1] = this.getElementBoundaryPoint(
      'end',
      this._segments[this._segments.length - 1],
      elementIndex,
      mlineStyle
    )
    return this.closePathIfNeeded(points)
  }

  /**
   * Resolves the offset distance for an element at a specific segment.
   * Prefers segment element parameters and falls back to style offsets.
   *
   * @param segment Segment to evaluate.
   * @param elementIndex Style element index.
   * @param mlineStyle Resolved style object, if available.
   * @returns Miter offset distance.
   */
  private getElementMiterOffset(
    segment: AcDbMLineSegment,
    elementIndex: number,
    mlineStyle?: AcDbMlineStyle
  ) {
    const element = segment.elements[elementIndex]
    if (element?.parameters?.length) return element.parameters[0]
    return this.getStyleElementOffset(elementIndex, mlineStyle)
  }

  /**
   * Resolves one element boundary point at the start/end of open MLINE paths.
   *
   * @param side `start` or `end`.
   * @param segment Segment data used to resolve miter offset.
   * @param elementIndex Style element index.
   * @param mlineStyle Resolved style object, if available.
   * @returns Boundary point after cap-angle cut adjustment.
   */
  private getElementBoundaryPoint(
    side: 'start' | 'end',
    segment: AcDbMLineSegment,
    elementIndex: number,
    mlineStyle?: AcDbMlineStyle
  ) {
    const offset = this.getElementMiterOffset(segment, elementIndex, mlineStyle)
    const basePoint = side === 'start' ? this._startPosition : segment.position
    const point = this.offsetPoint(basePoint, segment.miterDirection, offset)

    if (!this.shouldApplyCapCutAtSide(side, mlineStyle)) {
      return point
    }

    const capAngle =
      side === 'start' ? mlineStyle?.startAngle : mlineStyle?.endAngle
    const cutDistance = this.computeCapCutDistance(offset, capAngle, side)
    if (cutDistance === 0) return point

    const direction =
      side === 'start'
        ? this.getStartSegmentDirection()
        : this.getEndSegmentDirection()
    if (direction.lengthSq() === 0) return point

    return point.add(direction.multiplyScalar(cutDistance))
  }

  /**
   * Indicates whether cap-angle cut should be applied at the given side.
   *
   * @param side `start` or `end`.
   * @param mlineStyle Resolved style object, if available.
   * @returns `true` when side has cap components and is not suppressed.
   */
  private shouldApplyCapCutAtSide(
    side: 'start' | 'end',
    mlineStyle?: AcDbMlineStyle
  ) {
    if (!mlineStyle || this.closed) return false
    if (side === 'start') {
      if (this.suppressStartCaps) return false
      return (
        (mlineStyle.flags &
          (AcDbMLineStyleFlags.StartSquareCap |
            AcDbMLineStyleFlags.StartInnerArcs |
            AcDbMLineStyleFlags.StartRoundCap)) !==
        0
      )
    }

    if (this.suppressEndCaps) return false
    return (
      (mlineStyle.flags &
        (AcDbMLineStyleFlags.EndSquareCap |
          AcDbMLineStyleFlags.EndInnerArcs |
          AcDbMLineStyleFlags.EndRoundCap)) !==
      0
    )
  }

  /**
   * Computes longitudinal cut distance based on cap angle and style-element offset.
   *
   * @param offset Element offset along miter direction.
   * @param angleDegrees Cap angle in degree units.
   * @param side `start` or `end`.
   * @returns Signed distance to move along segment direction.
   */
  private computeCapCutDistance(
    offset: number,
    angleDegrees: number | undefined,
    side: 'start' | 'end'
  ) {
    const angle = this.normalizeCapAngle(angleDegrees)
    const tan = Math.tan(angle)
    if (Math.abs(tan) < 1e-6) return 0
    const distance = offset / tan
    return side === 'start' ? distance : distance
  }

  /**
   * Normalizes cap angle from DXF degree units to radians.
   *
   * @param angleDegrees Cap angle in degree units.
   * @returns Safe radian value in `(0, PI)` with 90-degree fallback.
   */
  private normalizeCapAngle(angleDegrees: number | undefined) {
    if (angleDegrees == null || !Number.isFinite(angleDegrees)) {
      return Math.PI / 2
    }

    let degrees = angleDegrees % 180
    if (degrees < 0) degrees += 180
    if (degrees < 1 || degrees > 179) {
      degrees = 90
    }
    return (degrees * Math.PI) / 180
  }

  /**
   * Resolves forward direction at MLINE start.
   *
   * @returns Unit vector along the first segment.
   */
  private getStartSegmentDirection() {
    const first = this._segments[0]
    const direction = new AcGeVector3d()
    if (first) {
      // Prefer actual geometry direction. The serialized first segment direction can be noisy
      // in some files and may not match the true start-edge direction.
      direction.subVectors(first.position, this._startPosition)
      if (direction.lengthSq() === 0) {
        direction.copy(first.direction)
      }
    }
    if (direction.lengthSq() > 0) direction.normalize()
    return direction
  }

  /**
   * Resolves forward direction at MLINE end.
   *
   * @returns Unit vector along the last visible segment.
   */
  private getEndSegmentDirection() {
    const last = this._segments[this._segments.length - 1]
    if (!last) return new AcGeVector3d()

    const direction = new AcGeVector3d()
    const previousPoint =
      this._segments.length > 1
        ? this._segments[this._segments.length - 2].position
        : this._startPosition
    // Prefer actual geometry direction. Some DXF producers write a final segment direction
    // that does not represent the visible last edge, which flips end caps.
    direction.subVectors(last.position, previousPoint)
    if (direction.lengthSq() === 0) {
      direction.copy(last.direction)
    }
    if (direction.lengthSq() > 0) direction.normalize()
    return direction
  }

  /**
   * Creates a fill area between outermost and innermost element paths when style fill is enabled.
   *
   * @param mlineStyle Resolved style object.
   * @param elementCount Total renderable element count.
   * @returns Fill area polygon(s), or `undefined` when fill cannot be formed.
   */
  private createFillArea(
    mlineStyle: AcDbMlineStyle | undefined,
    elementCount: number
  ) {
    if (
      !mlineStyle ||
      (mlineStyle.flags & AcDbMLineStyleFlags.FillOn) === 0 ||
      elementCount < 2
    ) {
      return undefined
    }

    const boundary = this.getFillBoundaryElementIndices(
      elementCount,
      mlineStyle
    )
    if (!boundary) return undefined

    const outerPath = this.getElementPath(boundary.outerIndex, mlineStyle)
    const innerPath = this.getElementPath(boundary.innerIndex, mlineStyle)
    const outerPoints = this.stripClosingPoint(outerPath)
    const innerPoints = this.stripClosingPoint(innerPath)
    if (outerPoints.length < 2 || innerPoints.length < 2) {
      return undefined
    }

    const area = new AcGeArea2d()
    if (this.closed) {
      if (outerPoints.length < 3 || innerPoints.length < 3) return undefined
      area.add(
        new AcGePolyline2d(
          outerPoints.map(point => ({ x: point.x, y: point.y })),
          true
        )
      )
      area.add(
        new AcGePolyline2d(
          innerPoints.map(point => ({ x: point.x, y: point.y })),
          true
        )
      )
    } else {
      const ringPoints = [...outerPoints, ...innerPoints.slice().reverse()].map(
        point => ({ x: point.x, y: point.y })
      )
      if (ringPoints.length < 3) return undefined
      area.add(new AcGePolyline2d(ringPoints, true))
    }
    return area
  }

  /**
   * Finds the element indices that define fill boundaries by minimum and maximum reference offsets.
   *
   * @param elementCount Total renderable element count.
   * @param mlineStyle Resolved style object, if available.
   * @returns Outer/inner boundary indices, or `undefined` when not resolvable.
   */
  private getFillBoundaryElementIndices(
    elementCount: number,
    mlineStyle?: AcDbMlineStyle
  ) {
    let minOffset = Number.POSITIVE_INFINITY
    let maxOffset = Number.NEGATIVE_INFINITY
    let minIndex = -1
    let maxIndex = -1

    for (let i = 0; i < elementCount; i++) {
      const offset = this.getElementReferenceOffset(i, mlineStyle)
      if (offset < minOffset) {
        minOffset = offset
        minIndex = i
      }
      if (offset > maxOffset) {
        maxOffset = offset
        maxIndex = i
      }
    }

    if (minIndex < 0 || maxIndex < 0 || minIndex === maxIndex) {
      return undefined
    }

    return {
      outerIndex: maxIndex,
      innerIndex: minIndex
    }
  }

  /**
   * Resolves an element's reference offset from first-segment data or style defaults.
   *
   * @param elementIndex Style element index.
   * @param mlineStyle Resolved style object, if available.
   * @returns Reference offset used for boundary comparison.
   */
  private getElementReferenceOffset(
    elementIndex: number,
    mlineStyle?: AcDbMlineStyle
  ) {
    const firstSegment = this._segments[0]
    if (firstSegment) {
      const element = firstSegment.elements[elementIndex]
      if (element?.parameters?.length) {
        return element.parameters[0]
      }
    }
    return this.getStyleElementOffset(elementIndex, mlineStyle)
  }

  /**
   * Resolves style-defined element offset to world offset under current
   * justification and entity scale.
   *
   * @param elementIndex Style element index.
   * @param mlineStyle Resolved style object, if available.
   * @returns Final offset distance used for miter displacement.
   */
  private getStyleElementOffset(
    elementIndex: number,
    mlineStyle?: AcDbMlineStyle
  ) {
    const styleElement = mlineStyle?.elements[elementIndex]
    if (!styleElement) return 0
    const shift = this.getStyleJustificationShift(mlineStyle)
    return (styleElement.offset + shift) * this._scale
  }

  /**
   * Calculates justification shift in style-offset space.
   *
   * - `Zero`: shift = 0
   * - `Top`: highest style offset is moved to 0
   * - `Bottom`: lowest style offset is moved to 0
   *
   * @param mlineStyle Resolved style object, if available.
   * @returns Offset shift before scaling.
   */
  private getStyleJustificationShift(mlineStyle?: AcDbMlineStyle) {
    const elements = mlineStyle?.elements ?? []
    if (elements.length <= 0) return 0

    let minOffset = Number.POSITIVE_INFINITY
    let maxOffset = Number.NEGATIVE_INFINITY
    for (const element of elements) {
      const offset = element.offset
      if (offset < minOffset) minOffset = offset
      if (offset > maxOffset) maxOffset = offset
    }

    if (this._justification === AcDbMLineJustification.Top) {
      return -maxOffset
    }
    if (this._justification === AcDbMLineJustification.Bottom) {
      return -minOffset
    }
    return 0
  }

  /**
   * Removes a duplicated closing vertex when the first and last points are numerically equal.
   *
   * @param points Candidate closed path.
   * @returns Path without duplicated terminal point.
   */
  private stripClosingPoint(points: AcGePoint3d[]) {
    if (points.length < 2) return points
    const first = points[0]
    const last = points[points.length - 1]
    const epsilon = 1e-9
    const isClosed =
      Math.abs(first.x - last.x) <= epsilon &&
      Math.abs(first.y - last.y) <= epsilon &&
      Math.abs(first.z - last.z) <= epsilon
    return isClosed ? points.slice(0, -1) : points
  }

  /**
   * Offsets a point along a miter direction by a scalar distance.
   *
   * @param point Base point.
   * @param miterDirection Offset direction.
   * @param distance Offset distance.
   * @returns Offset point clone.
   */
  private offsetPoint(
    point: AcGePoint3d,
    miterDirection: AcGeVector3d,
    distance: number
  ) {
    if (distance === 0 || miterDirection.lengthSq() === 0) {
      return point.clone()
    }
    const direction = miterDirection
      .clone()
      .normalize()
      .multiplyScalar(distance)
    return point.clone().add(direction)
  }

  /**
   * Appends the first point to the end of a path when closed mode requires an explicit closure.
   *
   * @param points Path points to inspect.
   * @returns Original or explicitly closed path array.
   */
  private closePathIfNeeded(points: AcGePoint3d[]) {
    if (!this.closed || points.length < 2) return points
    const first = points[0]
    const last = points[points.length - 1]
    const epsilon = 1e-9
    const isClosed =
      Math.abs(first.x - last.x) <= epsilon &&
      Math.abs(first.y - last.y) <= epsilon &&
      Math.abs(first.z - last.z) <= epsilon
    if (!isClosed) points.push(first.clone())
    return points
  }

  /**
   * Appends style-driven joint/cap entities after element path rendering.
   *
   * @param renderer Active graphics renderer.
   * @param entities Output entity list to append into.
   * @param mlineStyle Resolved style object, if available.
   * @param elementCount Renderable style element count.
   * @param originalColor Original trait color.
   * @param originalLineType Original trait linetype.
   */
  private appendStyleDrivenJointAndCapEntities(
    renderer: AcGiRenderer,
    entities: AcGiEntity[],
    mlineStyle: AcDbMlineStyle | undefined,
    elementCount: number,
    originalColor: AcGiRenderer['subEntityTraits']['color'],
    originalLineType: AcGiRenderer['subEntityTraits']['lineType']
  ) {
    if (!mlineStyle || elementCount < 2) return

    entities.push(
      ...this.drawMiterJointEntities(
        renderer,
        mlineStyle,
        elementCount,
        originalColor,
        originalLineType
      )
    )
    entities.push(
      ...this.drawCapEntities(
        renderer,
        mlineStyle,
        elementCount,
        originalColor,
        originalLineType
      )
    )
  }

  /**
   * Draws miter connector lines at interior joints when style enables it.
   *
   * @param renderer Active graphics renderer.
   * @param mlineStyle Resolved style object.
   * @param elementCount Renderable style element count.
   * @param originalColor Original trait color.
   * @param originalLineType Original trait linetype.
   * @returns Drawn joint entities.
   */
  private drawMiterJointEntities(
    renderer: AcGiRenderer,
    mlineStyle: AcDbMlineStyle,
    elementCount: number,
    originalColor: AcGiRenderer['subEntityTraits']['color'],
    originalLineType: AcGiRenderer['subEntityTraits']['lineType']
  ) {
    if (
      this.closed ||
      this._segments.length < 2 ||
      (mlineStyle.flags & AcDbMLineStyleFlags.DisplayMiters) === 0
    ) {
      return []
    }

    const entities: AcGiEntity[] = []
    const traits = renderer.subEntityTraits

    for (
      let segmentIndex = 0;
      segmentIndex < this._segments.length - 1;
      segmentIndex++
    ) {
      const segment = this._segments[segmentIndex]
      const points = Array.from({ length: elementCount }, (_, elementIndex) => {
        const offset = this.getElementMiterOffset(
          segment,
          elementIndex,
          mlineStyle
        )
        return {
          elementIndex,
          offset,
          point: this.offsetPoint(
            segment.position,
            segment.miterDirection,
            offset
          )
        }
      }).sort((a, b) => b.offset - a.offset)

      for (let i = 0; i < points.length - 1; i++) {
        this.applyElementDrawTraits(
          traits,
          originalColor,
          originalLineType,
          mlineStyle,
          points[i].elementIndex
        )
        entities.push(renderer.lines([points[i].point, points[i + 1].point]))
      }
    }

    return entities
  }

  /**
   * Draws start/end cap entities according to MLINESTYLE cap flags.
   *
   * @param renderer Active graphics renderer.
   * @param mlineStyle Resolved style object.
   * @param elementCount Renderable style element count.
   * @param originalColor Original trait color.
   * @param originalLineType Original trait linetype.
   * @returns Drawn cap entities.
   */
  private drawCapEntities(
    renderer: AcGiRenderer,
    mlineStyle: AcDbMlineStyle,
    elementCount: number,
    originalColor: AcGiRenderer['subEntityTraits']['color'],
    originalLineType: AcGiRenderer['subEntityTraits']['lineType']
  ) {
    if (this.closed || this._segments.length <= 0) return []

    const entities: AcGiEntity[] = []
    entities.push(
      ...this.drawCapEntitiesForSide(
        renderer,
        'start',
        mlineStyle,
        elementCount,
        originalColor,
        originalLineType
      )
    )
    entities.push(
      ...this.drawCapEntitiesForSide(
        renderer,
        'end',
        mlineStyle,
        elementCount,
        originalColor,
        originalLineType
      )
    )
    return entities
  }

  /**
   * Draws one-side cap entities (line/outer-arc/inner-arcs).
   *
   * @param renderer Active graphics renderer.
   * @param side `start` or `end`.
   * @param mlineStyle Resolved style object.
   * @param elementCount Renderable style element count.
   * @param originalColor Original trait color.
   * @param originalLineType Original trait linetype.
   * @returns Drawn one-side cap entities.
   */
  private drawCapEntitiesForSide(
    renderer: AcGiRenderer,
    side: 'start' | 'end',
    mlineStyle: AcDbMlineStyle,
    elementCount: number,
    originalColor: AcGiRenderer['subEntityTraits']['color'],
    originalLineType: AcGiRenderer['subEntityTraits']['lineType']
  ) {
    if (side === 'start' && this.suppressStartCaps) return []
    if (side === 'end' && this.suppressEndCaps) return []

    const flags = mlineStyle.flags
    const isStart = side === 'start'
    const hasSquare = isStart
      ? (flags & AcDbMLineStyleFlags.StartSquareCap) !== 0
      : (flags & AcDbMLineStyleFlags.EndSquareCap) !== 0
    const hasOuterArc = isStart
      ? (flags & AcDbMLineStyleFlags.StartRoundCap) !== 0
      : (flags & AcDbMLineStyleFlags.EndRoundCap) !== 0
    const hasInnerArcs = isStart
      ? (flags & AcDbMLineStyleFlags.StartInnerArcs) !== 0
      : (flags & AcDbMLineStyleFlags.EndInnerArcs) !== 0
    if (!hasSquare && !hasOuterArc && !hasInnerArcs) return []

    const points = this.getCapElementPoints(side, elementCount, mlineStyle)
    if (points.length < 2) return []

    const entities: AcGiEntity[] = []
    const traits = renderer.subEntityTraits

    if (hasSquare) {
      for (let i = 0; i < points.length - 1; i++) {
        this.applyElementDrawTraits(
          traits,
          originalColor,
          originalLineType,
          mlineStyle,
          points[i].elementIndex
        )
        entities.push(renderer.lines([points[i].point, points[i + 1].point]))
      }
    }

    const capDirection = isStart
      ? this.getStartSegmentDirection().multiplyScalar(-1)
      : this.getEndSegmentDirection().clone()

    if (hasOuterArc) {
      const outer = this.drawCapArcBetweenElements(
        renderer,
        side,
        points[0],
        points[points.length - 1],
        capDirection,
        traits,
        originalColor,
        originalLineType,
        mlineStyle
      )
      if (outer) entities.push(outer)
    }

    if (hasInnerArcs) {
      for (let i = 1; i < Math.floor(points.length / 2); i++) {
        const left = points[i]
        const right = points[points.length - 1 - i]
        if (!left || !right || left === right) continue
        const inner = this.drawCapArcBetweenElements(
          renderer,
          side,
          left,
          right,
          capDirection,
          traits,
          originalColor,
          originalLineType,
          mlineStyle
        )
        if (inner) entities.push(inner)
      }
    }

    return entities
  }

  /**
   * Creates sorted element boundary points for one cap side.
   *
   * @param side `start` or `end`.
   * @param elementCount Renderable style element count.
   * @param mlineStyle Resolved style object.
   * @returns Cap points sorted by descending element offset.
   */
  private getCapElementPoints(
    side: 'start' | 'end',
    elementCount: number,
    mlineStyle: AcDbMlineStyle
  ) {
    const segment =
      side === 'start'
        ? this._segments[0]
        : this._segments[this._segments.length - 1]
    if (!segment) return []

    return Array.from({ length: elementCount }, (_, elementIndex) => ({
      elementIndex,
      offset: this.getElementMiterOffset(segment, elementIndex, mlineStyle),
      point: this.getElementBoundaryPoint(
        side,
        segment,
        elementIndex,
        mlineStyle
      )
    })).sort((a, b) => b.offset - a.offset)
  }

  /**
   * Draws one cap arc between two cap element points.
   *
   * @param renderer Active graphics renderer.
   * @param startPointPair Start element point.
   * @param endPointPair End element point.
   * @param capDirection Outward cap direction.
   * @param traits Mutable renderer traits.
   * @param originalColor Original trait color.
   * @param originalLineType Original trait linetype.
   * @param mlineStyle Resolved style object.
   * @returns Arc entity, or `undefined` when arc cannot be constructed.
   */
  private drawCapArcBetweenElements(
    renderer: AcGiRenderer,
    side: 'start' | 'end',
    startPointPair: { elementIndex: number; point: AcGePoint3d },
    endPointPair: { elementIndex: number; point: AcGePoint3d },
    capDirection: AcGeVector3d,
    traits: AcGiRenderer['subEntityTraits'],
    originalColor: AcGiRenderer['subEntityTraits']['color'],
    originalLineType: AcGiRenderer['subEntityTraits']['lineType'],
    mlineStyle: AcDbMlineStyle
  ) {
    // For 180-degree cap arcs, start/end point order determines whether
    // the renderer takes the left or right semicircle. End caps need reverse order.
    const arcStartPoint =
      side === 'end' ? endPointPair.point : startPointPair.point
    const arcEndPoint =
      side === 'end' ? startPointPair.point : endPointPair.point
    const chord = arcStartPoint.distanceTo(arcEndPoint)
    if (chord <= 1e-9 || capDirection.lengthSq() === 0) return undefined

    const midpoint = arcStartPoint
      .clone()
      .add(
        new AcGeVector3d()
          .subVectors(arcEndPoint, arcStartPoint)
          .multiplyScalar(0.5)
      )
    const pointOnArc = midpoint.add(
      capDirection
        .clone()
        .normalize()
        .multiplyScalar(chord / 2)
    )
    const arc = AcGeCircArc3d.createByThreePoints(
      arcStartPoint,
      arcEndPoint,
      pointOnArc
    )
    if (!arc) return undefined

    this.applyElementDrawTraits(
      traits,
      originalColor,
      originalLineType,
      mlineStyle,
      side === 'end' ? endPointPair.elementIndex : startPointPair.elementIndex
    )
    return renderer.circularArc(arc)
  }

  /**
   * Applies per-element traits while restoring baseline traits first.
   *
   * @param traits Mutable renderer traits.
   * @param originalColor Original trait color.
   * @param originalLineType Original trait linetype.
   * @param mlineStyle Resolved style object.
   * @param elementIndex Style element index.
   */
  private applyElementDrawTraits(
    traits: AcGiRenderer['subEntityTraits'],
    originalColor: AcGiRenderer['subEntityTraits']['color'],
    originalLineType: AcGiRenderer['subEntityTraits']['lineType'],
    mlineStyle: AcDbMlineStyle,
    elementIndex: number
  ) {
    traits.color = originalColor
    traits.lineType = originalLineType
    this.applyStyleElementTraits(mlineStyle, elementIndex, traits)
  }

  /**
   * Transforms a vector by matrix rotation/scale only.
   * Translation is canceled by transforming an origin-endpoint pair.
   *
   * @param vector Vector to transform in place.
   * @param matrix Transformation matrix.
   */
  private transformVector(vector: AcGeVector3d, matrix: AcGeMatrix3d) {
    const origin = new AcGePoint3d()
    const endpoint = new AcGePoint3d(vector.x, vector.y, vector.z)
    origin.applyMatrix4(matrix)
    endpoint.applyMatrix4(matrix)
    vector.set(
      endpoint.x - origin.x,
      endpoint.y - origin.y,
      endpoint.z - origin.z
    )
  }

  /**
   * Resolves the effective MLINE style from database dictionary.
   * Lookup order: handle, exact name, then case-insensitive name match.
   *
   * @returns Matching style object, or `undefined` when no style is found.
   */
  private getMLineStyle() {
    const dictionary = this.database.objects.mlineStyle
    const byHandle = this.styleObjectHandle
      ? dictionary.getIdAt(this.styleObjectHandle)
      : undefined
    if (byHandle) return byHandle

    const directByName = this.styleName
      ? dictionary.getAt(this.styleName)
      : undefined
    if (directByName) return directByName

    const normalizedStyleName = this.styleName?.toUpperCase()
    if (normalizedStyleName) {
      for (const [name, style] of dictionary.entries()) {
        const styleName = (style.styleName || name).toUpperCase()
        if (
          name.toUpperCase() === normalizedStyleName ||
          styleName === normalizedStyleName
        ) {
          return style
        }
      }
    }
    return undefined
  }

  /**
   * Applies style-element color and linetype traits to renderer traits.
   * BYBLOCK and BYLAYER colors are ignored.
   *
   * @param mlineStyle Resolved style object.
   * @param elementIndex Style element index.
   * @param traits Mutable renderer trait set.
   */
  private applyStyleElementTraits(
    mlineStyle: AcDbMlineStyle | undefined,
    elementIndex: number,
    traits: AcGiRenderer['subEntityTraits']
  ) {
    const styleElement = mlineStyle?.elements[elementIndex]
    if (!styleElement) return

    const lineType = this.resolveStyleElementLineType(styleElement.lineType)
    if (lineType) {
      traits.lineType = lineType
    }

    if (styleElement.color.isByBlock || styleElement.color.isByLayer) return

    traits.color = styleElement.color.clone()
  }

  /**
   * Applies fill color traits from style definition to the renderer traits object.
   * BYBLOCK and BYLAYER colors are ignored.
   *
   * @param mlineStyle Resolved style object.
   * @param traits Mutable renderer trait set.
   */
  private applyFillTraits(
    mlineStyle: AcDbMlineStyle | undefined,
    traits: AcGiRenderer['subEntityTraits']
  ) {
    const fillColor = mlineStyle?.fillColor
    if (!fillColor || fillColor.isByBlock || fillColor.isByLayer) return

    traits.color = fillColor.clone()
  }

  /**
   * Resolves a style-element linetype token to concrete renderer linetype traits.
   *
   * @param rawLineType Style element linetype token.
   * @returns Resolved linetype traits, or `undefined` when no override is needed.
   */
  private resolveStyleElementLineType(rawLineType: string | undefined) {
    const lineTypeName = rawLineType?.trim()
    if (!lineTypeName) return undefined

    const normalized = lineTypeName.toUpperCase()
    const byLayer = ByLayer.toUpperCase()
    const byBlock = ByBlock.toUpperCase()

    let type: 'ByLayer' | 'ByBlock' | 'UserSpecified' = 'UserSpecified'
    let resolvedName = lineTypeName

    if (normalized === byLayer) {
      type = 'ByLayer'
      const layerLineType = this.database.tables.layerTable.getAt(
        this.layer
      )?.linetype
      resolvedName =
        layerLineType &&
        layerLineType.toUpperCase() !== byLayer &&
        layerLineType.toUpperCase() !== byBlock
          ? layerLineType
          : DEFAULT_LINE_TYPE
    } else if (normalized === byBlock) {
      type = 'ByBlock'
      resolvedName = DEFAULT_LINE_TYPE
    }

    const lineTypeRecord =
      this.database.tables.linetypeTable.getAt(resolvedName)
    if (lineTypeRecord) {
      return {
        type,
        ...lineTypeRecord.linetype
      }
    }

    return {
      type,
      name: resolvedName,
      standardFlag: 0,
      description: '',
      totalPatternLength: 0
    }
  }

  /**
   * @inheritdoc
   */
  override resolveEffectiveProperties() {
    super.resolveEffectiveProperties()
    if (!this._styleName) {
      this._styleName = this.getDefaultStyleName()
    }
  }

  /**
   * Resolves the default style name for newly created MLINE entities.
   */
  private getDefaultStyleName() {
    try {
      return this.database.cmlstyle || DEFAULT_MLINE_STYLE
    } catch {
      return DEFAULT_MLINE_STYLE
    }
  }
}
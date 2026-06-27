import { AcCmColor } from '@mlightcad/common'
import {
  AcGeArea2d,
  AcGeBox3d,
  AcGeMatrix3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGePolyline2d,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import {
  AcGiEntity,
  AcGiLineWeight,
  AcGiMTextAttachmentPoint,
  AcGiMTextData,
  AcGiMTextFlowDirection,
  AcGiRenderer,
  AcGiStyleType,
  AcGiTextStyle
} from '@mlightcad/graphic-interface'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { DEFAULT_MLEADER_STYLE } from '../misc/AcDbConstants'
import { AcDbOsnapMode } from '../misc/AcDbOsnapMode'
import { AcDbRenderingCache } from '../misc/AcDbRenderingCache'
import { AcDbMLeaderStyle } from '../object/AcDbMLeaderStyle'
import { AcDbEntity } from './AcDbEntity'
import { AcDbEntityProperties } from './AcDbEntityProperties'
import { acdbForEachGripIndex } from './AcDbGripHelpers'
import {
  acdbCollectLineSegmentOsnapPoints,
  acdbPickNearestOsnapPoint
} from './AcDbOsnapHelpers'

/**
 * Defines the type of leader line used by a multileader.
 */
export enum AcDbMLeaderLineType {
  /** The leader line is not displayed. */
  InvisibleLeader = 0,
  /** The leader line is drawn using straight segments. */
  StraightLeader = 1,
  /** The leader line is drawn as a spline. */
  SplineLeader = 2
}

/**
 * Defines the annotation content type used by a multileader.
 */
export enum AcDbMLeaderContentType {
  /** No annotation content. */
  NoneContent = 0,
  /** Block annotation content. */
  BlockContent = 1,
  /** MText annotation content. */
  MTextContent = 2,
  /** Tolerance annotation content. */
  ToleranceContent = 3
}

/**
 * Defines the attachment direction of multileader text.
 */
export enum AcDbMLeaderTextAttachmentDirection {
  /** Text is attached horizontally. */
  Horizontal = 0,
  /** Text is attached vertically. */
  Vertical = 1
}

/**
 * Defines the general direction of a leader branch.
 */
export enum AcDbMLeaderDirectionType {
  /** Direction is not known or not applicable. */
  Unknown = 0,
  /** Leader points to the left of the content. */
  Left = 1,
  /** Leader points to the right of the content. */
  Right = 2,
  /** Leader points above the content. */
  Top = 3,
  /** Leader points below the content. */
  Bottom = 4
}

const MLEADER_OVERRIDE_LEADER_LINE_TYPE = 1 << 0
const MLEADER_OVERRIDE_LEADER_LINE_COLOR = 1 << 1
const MLEADER_OVERRIDE_LEADER_LINE_TYPE_ID = 1 << 2
const MLEADER_OVERRIDE_LEADER_LINE_WEIGHT = 1 << 3
const MLEADER_OVERRIDE_DOGLEG_ENABLED = 1 << 6
const MLEADER_OVERRIDE_DOGLEG_LENGTH = 1 << 7
const MLEADER_OVERRIDE_TEXT_COLOR = 1 << 15

/**
 * Represents a leader break segment input using point-like values.
 */
export interface AcDbMLeaderBreakLike {
  index?: number
  start: AcGePoint3dLike
  end: AcGePoint3dLike
}

/**
 * Represents a normalized leader break segment stored with concrete points.
 */
export interface AcDbMLeaderBreak {
  index?: number
  start: AcGePoint3d
  end: AcGePoint3d
}

/**
 * Represents a leader-line input payload before normalization.
 */
export interface AcDbMLeaderLineLike {
  vertices?: AcGePoint3dLike[]
  breakPointIndexes?: number[]
  leaderLineIndex?: number
  breaks?: AcDbMLeaderBreakLike[]
}

/**
 * Represents one normalized leader line.
 */
export interface AcDbMLeaderLine {
  vertices: AcGePoint3d[]
  breakPointIndexes: number[]
  leaderLineIndex?: number
  breaks: AcDbMLeaderBreak[]
}

/**
 * Represents a leader-branch input payload.
 */
export interface AcDbMLeaderLeaderLike {
  lastLeaderLinePoint?: AcGePoint3dLike
  lastLeaderLinePointSet?: boolean
  landingPoint?: AcGePoint3dLike
  doglegVector?: AcGeVector3dLike
  doglegVectorSet?: boolean
  doglegLength?: number
  breaks?: AcDbMLeaderBreakLike[]
  leaderBranchIndex?: number
  directionType?: AcDbMLeaderDirectionType
  leaderLines?: AcDbMLeaderLineLike[]
}

/**
 * Represents one normalized leader branch stored by the entity.
 */
export interface AcDbMLeaderLeader {
  lastLeaderLinePoint?: AcGePoint3d
  lastLeaderLinePointSet?: boolean
  landingPoint?: AcGePoint3d
  doglegVector?: AcGeVector3d
  doglegVectorSet?: boolean
  doglegLength?: number
  breaks: AcDbMLeaderBreak[]
  leaderBranchIndex?: number
  directionType?: AcDbMLeaderDirectionType
  leaderLines: AcDbMLeaderLine[]
}

/**
 * Represents MText content input data for a multileader.
 */
export interface AcDbMLeaderMTextContentLike {
  text: string
  anchorPoint: AcGePoint3dLike
}

/**
 * Represents normalized MText content stored by a multileader.
 */
export interface AcDbMLeaderMTextContent {
  text: string
  anchorPoint: AcGePoint3d
}

/**
 * Represents block content input data for a multileader.
 */
export interface AcDbMLeaderBlockContentLike {
  blockContentId?: string
  blockHandle?: string
  normal?: AcGeVector3dLike
  position?: AcGePoint3dLike
  scale?: AcGeVector3dLike
  rotation?: number
  color?: AcCmColor
  transformationMatrix?: number[]
}

/**
 * Represents normalized block content stored by a multileader.
 */
export interface AcDbMLeaderBlockContent {
  blockContentId?: string
  blockHandle?: string
  normal?: AcGeVector3d
  position?: AcGePoint3d
  scale: AcGeVector3d
  rotation: number
  color?: AcCmColor
  transformationMatrix: number[]
}

/**
 * Represents a handle tied to a specific index in multileader data.
 */
export interface AcDbMLeaderIndexedHandle {
  index: number
  handle?: string
}

/**
 * Represents one block attribute override entry.
 */
export interface AcDbMLeaderBlockAttribute {
  id?: string
  index?: number
  width?: number
  text?: string
}

/**
 * Represents a multileader entity.
 *
 * A multileader contains one or more leader branches, each of which can contain
 * one or more leader lines, plus optional MText or block content.
 */
export class AcDbMLeader extends AcDbEntity {
  /** The entity type name. */
  static override typeName: string = 'MLeader'

  /**
   * Gets the DXF type name used when exporting this entity.
   */
  override get dxfTypeName() {
    return 'MULTILEADER'
  }

  private _leaders: AcDbMLeaderLeader[]
  private _leaderLineType: AcDbMLeaderLineType
  private _contentType: AcDbMLeaderContentType
  private _doglegEnabled: boolean
  private _doglegLength: number
  private _landingPoint?: AcGePoint3d
  private _doglegVector: AcGeVector3d
  private _normal: AcGeVector3d
  private _mleaderStyleId: string
  private _mtextContent?: AcDbMLeaderMTextContent
  private _textHeight: number
  private _textWidth: number
  private _textRotation: number
  private _textDirection: AcGeVector3d
  private _textStyleName: string
  private _textAttachmentPoint: AcGiMTextAttachmentPoint
  private _textDrawingDirection: AcGiMTextFlowDirection
  private _textLineSpacingFactor: number
  private _textAttachmentDirection: AcDbMLeaderTextAttachmentDirection
  private _blockContent?: AcDbMLeaderBlockContent
  private _version?: number
  private _leaderStyleId?: string
  private _propertyOverrideFlag?: number
  private _leaderLineColor?: AcCmColor
  private _leaderLineTypeId?: string
  private _leaderLineWeight?: number
  private _landingEnabled?: boolean
  private _arrowheadId?: string
  private _arrowheadSize?: number
  private _textStyleId?: string
  private _textLeftAttachmentType?: number
  private _textRightAttachmentType?: number
  private _textAngleType?: number
  private _textAlignmentType?: number
  private _textColor?: AcCmColor
  private _textFrameEnabled?: boolean
  private _landingGap?: number
  private _textAttachment?: number
  private _textFlowDirection?: number
  private _blockContentId?: string
  private _blockContentColor?: AcCmColor
  private _blockContentScale?: AcGeVector3d
  private _blockContentRotation?: number
  private _blockContentConnectionType?: number
  private _annotativeScaleEnabled?: boolean
  private _arrowheadOverrides: AcDbMLeaderIndexedHandle[]
  private _blockAttributes: AcDbMLeaderBlockAttribute[]
  private _textDirectionNegative?: boolean
  private _textAlignInIPE?: number
  private _bottomTextAttachmentDirection?: number
  private _topTextAttachmentDirection?: number
  private _contentScale?: number
  private _contentBasePosition?: AcGePoint3d
  private _textAnchor?: AcGePoint3d
  private _textLineSpacingStyle?: number
  private _textBackgroundColor?: AcCmColor
  private _textBackgroundScaleFactor?: number
  private _textBackgroundTransparency?: number
  private _textBackgroundColorOn?: boolean
  private _textFillOn?: boolean
  private _textColumnType?: number
  private _textUseAutoHeight?: boolean
  private _textColumnWidth?: number
  private _textColumnGutterWidth?: number
  private _textColumnFlowReversed?: boolean
  private _textColumnHeight?: number
  private _textUseWordBreak?: boolean
  private _hasMText?: boolean
  private _hasBlock?: boolean
  private _planeOrigin?: AcGePoint3d
  private _planeXAxisDirection?: AcGeVector3d
  private _planeYAxisDirection?: AcGeVector3d
  private _planeNormalReversed?: boolean
  /**
   * Creates an empty multileader entity with default style-related state.
   *
   * @remarks
   * Initializes geometry, text, and block-related members to defaults that
   * are compatible with common MLEADER behavior.
   */
  constructor() {
    super()
    this._leaders = []
    this._leaderLineType = AcDbMLeaderLineType.StraightLeader
    this._contentType = AcDbMLeaderContentType.NoneContent
    this._doglegEnabled = false
    this._doglegLength = 0
    this._doglegVector = new AcGeVector3d(1, 0, 0)
    this._normal = new AcGeVector3d(0, 0, 1)
    this._mleaderStyleId = ''
    this._textHeight = 2.5
    this._textWidth = 0
    this._textRotation = 0
    this._textDirection = new AcGeVector3d(1, 0, 0)
    this._textStyleName = ''
    this._textAttachmentPoint = AcGiMTextAttachmentPoint.MiddleLeft
    this._textDrawingDirection = AcGiMTextFlowDirection.LEFT_TO_RIGHT
    this._textLineSpacingFactor = 1
    this._textAttachmentDirection =
      AcDbMLeaderTextAttachmentDirection.Horizontal
    this._arrowheadOverrides = []
    this._blockAttributes = []
  }

  /**
   * Gets a deep-cloned collection of all leader branches.
   */

  get leaders() {
    return this._leaders.map(leader => this.cloneLeader(leader))
  }

  /**
   * Gets the current number of leader branches.
   */

  get numberOfLeaders() {
    return this._leaders.length
  }

  /**
   * Gets the leader line type.
   */

  get leaderLineType() {
    return this._leaderLineType
  }
  set leaderLineType(value: AcDbMLeaderLineType) {
    this._leaderLineType = value
  }

  /**
   * Gets the content type.
   */

  get contentType() {
    return this._contentType
  }
  set contentType(value: AcDbMLeaderContentType) {
    this._contentType = value
  }

  /**
   * Gets the dogleg enabled.
   */

  get doglegEnabled() {
    return this._doglegEnabled
  }
  set doglegEnabled(value: boolean) {
    this._doglegEnabled = value
  }

  /**
   * Gets the dogleg length.
   */

  get doglegLength() {
    return this._doglegLength
  }
  set doglegLength(value: number) {
    this._doglegLength = value
  }

  /**
   * Gets the dogleg vector.
   */

  get doglegVector() {
    return this._doglegVector
  }
  set doglegVector(value: AcGeVector3dLike) {
    this._doglegVector.copy(value)
  }

  /**
   * Gets the landing point.
   */

  get landingPoint() {
    return this._landingPoint
  }
  set landingPoint(value: AcGePoint3dLike | undefined) {
    this._landingPoint = value ? this.createPoint(value) : undefined
  }

  /**
   * Gets the normal.
   */

  get normal() {
    return this._normal
  }
  set normal(value: AcGeVector3dLike) {
    this._normal.copy(value)
  }

  /**
   * Gets the mleader style id.
   */

  get mleaderStyleId() {
    return this._mleaderStyleId
  }
  set mleaderStyleId(value: string) {
    this._mleaderStyleId = value
  }

  /**
   * Gets or sets the serialized MLeader version code.
   *
   * This value mirrors DXF/internal version metadata and is used to keep
   * compatibility with files saved from different AutoCAD generations.
   */
  get version() {
    return this._version
  }
  set version(value: number | undefined) {
    this._version = value
  }

  /**
   * Gets or sets the MLeader style handle override stored on the entity.
   *
   * When provided, this value is typically used as a fallback in addition to
   * `mleaderStyleId` during style resolution.
   */
  get leaderStyleId() {
    return this._leaderStyleId
  }
  set leaderStyleId(value: string | undefined) {
    this._leaderStyleId = value
  }

  /**
   * Gets or sets the property-override bit flag.
   *
   * The flag indicates which visual/behavioral properties are overridden at the
   * entity level instead of inherited from the referenced MLeader style.
   */
  get propertyOverrideFlag() {
    return this._propertyOverrideFlag
  }
  set propertyOverrideFlag(value: number | undefined) {
    this._propertyOverrideFlag = value
  }

  /**
   * Gets or sets the explicit leader line color override.
   */
  get leaderLineColor() {
    return this._leaderLineColor
  }
  set leaderLineColor(value: AcCmColor | undefined) {
    this._leaderLineColor = value?.clone()
  }

  /**
   * Gets or sets the leader line type handle override.
   */
  get leaderLineTypeId() {
    return this._leaderLineTypeId
  }
  set leaderLineTypeId(value: string | undefined) {
    this._leaderLineTypeId = value
  }

  /**
   * Gets or sets the lineweight override for leader segments.
   */
  get leaderLineWeight() {
    return this._leaderLineWeight
  }
  set leaderLineWeight(value: number | undefined) {
    this._leaderLineWeight = value
  }

  /**
   * Gets or sets whether leader landings are enabled.
   */
  get landingEnabled() {
    return this._landingEnabled
  }
  set landingEnabled(value: boolean | undefined) {
    this._landingEnabled = value
  }

  /**
   * Gets or sets the arrowhead block handle/name override.
   */
  get arrowheadId() {
    return this._arrowheadId
  }
  set arrowheadId(value: string | undefined) {
    this._arrowheadId = value
  }

  /**
   * Gets or sets the arrowhead size override in drawing units.
   */
  get arrowheadSize() {
    return this._arrowheadSize
  }
  set arrowheadSize(value: number | undefined) {
    this._arrowheadSize = value
  }

  /**
   * Gets or sets the text style handle override for MText content.
   */
  get textStyleId() {
    return this._textStyleId
  }
  set textStyleId(value: string | undefined) {
    this._textStyleId = value
  }

  /**
   * Gets or sets left-side text attachment behavior code.
   */
  get textLeftAttachmentType() {
    return this._textLeftAttachmentType
  }
  set textLeftAttachmentType(value: number | undefined) {
    this._textLeftAttachmentType = value
  }

  /**
   * Gets or sets right-side text attachment behavior code.
   */
  get textRightAttachmentType() {
    return this._textRightAttachmentType
  }
  set textRightAttachmentType(value: number | undefined) {
    this._textRightAttachmentType = value
  }

  /**
   * Gets or sets the text angle type code controlling rotation strategy.
   */
  get textAngleType() {
    return this._textAngleType
  }
  set textAngleType(value: number | undefined) {
    this._textAngleType = value
  }

  /**
   * Gets or sets the text alignment type code.
   */
  get textAlignmentType() {
    return this._textAlignmentType
  }
  set textAlignmentType(value: number | undefined) {
    this._textAlignmentType = value
  }

  /**
   * Gets or sets the MText color override.
   */
  get textColor() {
    return this._textColor
  }
  set textColor(value: AcCmColor | undefined) {
    this._textColor = value?.clone()
  }

  /**
   * Gets or sets whether a text frame (border) is enabled.
   */
  get textFrameEnabled() {
    return this._textFrameEnabled
  }
  set textFrameEnabled(value: boolean | undefined) {
    this._textFrameEnabled = value
  }

  /**
   * Gets or sets the gap distance between landing and annotation content.
   */
  get landingGap() {
    return this._landingGap
  }
  set landingGap(value: number | undefined) {
    this._landingGap = value
  }

  /**
   * Gets or sets the legacy text attachment value used in some DXF variants.
   */
  get textAttachment() {
    return this._textAttachment
  }
  set textAttachment(value: number | undefined) {
    this._textAttachment = value
  }

  /**
   * Gets or sets the text flow direction override code.
   */
  get textFlowDirection() {
    return this._textFlowDirection
  }
  set textFlowDirection(value: number | undefined) {
    this._textFlowDirection = value
  }

  /**
   * Gets or sets the referenced block content id/handle for block-based content.
   */
  get blockContentId() {
    return this._blockContentId
  }
  set blockContentId(value: string | undefined) {
    this._blockContentId = value
  }

  /**
   * Gets or sets the block content color override.
   */
  get blockContentColor() {
    return this._blockContentColor
  }
  set blockContentColor(value: AcCmColor | undefined) {
    this._blockContentColor = value?.clone()
  }

  /**
   * Gets or sets the block content scale vector override.
   */
  get blockContentScale() {
    return this._blockContentScale
  }
  set blockContentScale(value: AcGeVector3d | undefined) {
    this._blockContentScale = value
  }

  /**
   * Gets or sets the block content rotation override in radians.
   */
  get blockContentRotation() {
    return this._blockContentRotation
  }
  set blockContentRotation(value: number | undefined) {
    this._blockContentRotation = value
  }

  /**
   * Gets or sets the block content connection type code.
   */
  get blockContentConnectionType() {
    return this._blockContentConnectionType
  }
  set blockContentConnectionType(value: number | undefined) {
    this._blockContentConnectionType = value
  }

  /**
   * Gets or sets whether annotative scaling is enabled for this entity.
   */
  get annotativeScaleEnabled() {
    return this._annotativeScaleEnabled
  }
  set annotativeScaleEnabled(value: boolean | undefined) {
    this._annotativeScaleEnabled = value
  }

  /**
   * Gets or sets per-index arrowhead overrides.
   *
   * Each entry maps a branch/line index to a specific arrowhead handle.
   */
  get arrowheadOverrides() {
    return this._arrowheadOverrides
  }
  set arrowheadOverrides(value: AcDbMLeaderIndexedHandle[]) {
    this._arrowheadOverrides = value
  }

  /**
   * Gets or sets block attribute override values used by block content.
   */
  get blockAttributes() {
    return this._blockAttributes
  }
  set blockAttributes(value: AcDbMLeaderBlockAttribute[]) {
    this._blockAttributes = value
  }

  /**
   * Gets or sets whether text direction is treated as negative.
   */
  get textDirectionNegative() {
    return this._textDirectionNegative
  }
  set textDirectionNegative(value: boolean | undefined) {
    this._textDirectionNegative = value
  }

  /**
   * Gets or sets the in-place editor text alignment code.
   */
  get textAlignInIPE() {
    return this._textAlignInIPE
  }
  set textAlignInIPE(value: number | undefined) {
    this._textAlignInIPE = value
  }

  /**
   * Gets or sets bottom attachment direction code for vertical text behavior.
   */
  get bottomTextAttachmentDirection() {
    return this._bottomTextAttachmentDirection
  }
  set bottomTextAttachmentDirection(value: number | undefined) {
    this._bottomTextAttachmentDirection = value
  }

  /**
   * Gets or sets top attachment direction code for vertical text behavior.
   */
  get topTextAttachmentDirection() {
    return this._topTextAttachmentDirection
  }
  set topTextAttachmentDirection(value: number | undefined) {
    this._topTextAttachmentDirection = value
  }

  /**
   * Gets or sets the overall content scale override.
   */
  get contentScale() {
    return this._contentScale
  }
  set contentScale(value: number | undefined) {
    this._contentScale = value
  }

  /**
   * Gets or sets the base insertion position of annotation content.
   */
  get contentBasePosition() {
    return this._contentBasePosition
  }
  set contentBasePosition(value: AcGePoint3d | undefined) {
    this._contentBasePosition = value
  }

  /**
   * Gets or sets the explicit text anchor position.
   */
  get textAnchor() {
    return this._textAnchor
  }
  set textAnchor(value: AcGePoint3d | undefined) {
    this._textAnchor = value
  }

  /**
   * Gets or sets the text line spacing style code for column/text layout.
   */
  get textLineSpacingStyle() {
    return this._textLineSpacingStyle
  }
  set textLineSpacingStyle(value: number | undefined) {
    this._textLineSpacingStyle = value
  }

  /**
   * Gets or sets text background color override.
   */
  get textBackgroundColor() {
    return this._textBackgroundColor
  }
  set textBackgroundColor(value: AcCmColor | undefined) {
    this._textBackgroundColor = value?.clone()
  }

  /**
   * Gets or sets background-mask scale factor around text.
   */
  get textBackgroundScaleFactor() {
    return this._textBackgroundScaleFactor
  }
  set textBackgroundScaleFactor(value: number | undefined) {
    this._textBackgroundScaleFactor = value
  }

  /**
   * Gets or sets text background transparency value.
   */
  get textBackgroundTransparency() {
    return this._textBackgroundTransparency
  }
  set textBackgroundTransparency(value: number | undefined) {
    this._textBackgroundTransparency = value
  }

  /**
   * Gets or sets whether explicit background color masking is enabled.
   */
  get textBackgroundColorOn() {
    return this._textBackgroundColorOn
  }
  set textBackgroundColorOn(value: boolean | undefined) {
    this._textBackgroundColorOn = value
  }

  /**
   * Gets or sets whether text fill/mask is enabled.
   */
  get textFillOn() {
    return this._textFillOn
  }
  set textFillOn(value: boolean | undefined) {
    this._textFillOn = value
  }

  /**
   * Gets or sets the text column layout type code.
   */
  get textColumnType() {
    return this._textColumnType
  }
  set textColumnType(value: number | undefined) {
    this._textColumnType = value
  }

  /**
   * Gets or sets whether text column height is auto-managed.
   */
  get textUseAutoHeight() {
    return this._textUseAutoHeight
  }
  set textUseAutoHeight(value: boolean | undefined) {
    this._textUseAutoHeight = value
  }

  /**
   * Gets or sets the fixed width for text columns.
   */
  get textColumnWidth() {
    return this._textColumnWidth
  }
  set textColumnWidth(value: number | undefined) {
    this._textColumnWidth = value
  }

  /**
   * Gets or sets the gutter width between text columns.
   */
  get textColumnGutterWidth() {
    return this._textColumnGutterWidth
  }
  set textColumnGutterWidth(value: number | undefined) {
    this._textColumnGutterWidth = value
  }

  /**
   * Gets or sets whether text columns flow in reverse order.
   */
  get textColumnFlowReversed() {
    return this._textColumnFlowReversed
  }
  set textColumnFlowReversed(value: boolean | undefined) {
    this._textColumnFlowReversed = value
  }

  /**
   * Gets or sets the explicit text column height.
   */
  get textColumnHeight() {
    return this._textColumnHeight
  }
  set textColumnHeight(value: number | undefined) {
    this._textColumnHeight = value
  }

  /**
   * Gets or sets whether word breaking is enabled in column layout.
   */
  get textUseWordBreak() {
    return this._textUseWordBreak
  }
  set textUseWordBreak(value: boolean | undefined) {
    this._textUseWordBreak = value
  }

  /**
   * Gets or sets whether MText content exists in the serialized payload.
   */
  get hasMText() {
    return this._hasMText
  }
  set hasMText(value: boolean | undefined) {
    this._hasMText = value
  }

  /**
   * Gets or sets whether block content exists in the serialized payload.
   */
  get hasBlock() {
    return this._hasBlock
  }
  set hasBlock(value: boolean | undefined) {
    this._hasBlock = value
  }

  /**
   * Gets or sets the origin of the MLeader plane definition.
   */
  get planeOrigin() {
    return this._planeOrigin
  }
  set planeOrigin(value: AcGePoint3d | undefined) {
    this._planeOrigin = value
  }

  /**
   * Gets or sets the X-axis direction vector of the MLeader plane.
   */
  get planeXAxisDirection() {
    return this._planeXAxisDirection
  }
  set planeXAxisDirection(value: AcGeVector3d | undefined) {
    this._planeXAxisDirection = value
  }

  /**
   * Gets or sets the Y-axis direction vector of the MLeader plane.
   */
  get planeYAxisDirection() {
    return this._planeYAxisDirection
  }
  set planeYAxisDirection(value: AcGeVector3d | undefined) {
    this._planeYAxisDirection = value
  }

  /**
   * Gets or sets whether the MLeader plane normal is reversed.
   */
  get planeNormalReversed() {
    return this._planeNormalReversed
  }
  set planeNormalReversed(value: boolean | undefined) {
    this._planeNormalReversed = value
  }

  /**
   * Gets the alias of `leaders`.
   */

  get leaderSections() {
    return this.leaders
  }

  /**
   * Gets the alias of `blockContent`.
   */

  get blockContentData() {
    return this.blockContent
  }

  /**
   * Gets the MText content payload if present.
   */

  get mtextContent() {
    return this._mtextContent
      ? {
          text: this._mtextContent.text,
          anchorPoint: this._mtextContent.anchorPoint.clone()
        }
      : undefined
  }
  set mtextContent(value: AcDbMLeaderMTextContentLike | undefined) {
    if (!value) {
      this._mtextContent = undefined
      if (this._contentType === AcDbMLeaderContentType.MTextContent) {
        this._contentType = AcDbMLeaderContentType.NoneContent
      }
      return
    }
    this._mtextContent = {
      text: value.text,
      anchorPoint: this.createPoint(value.anchorPoint)
    }
    this._contentType = AcDbMLeaderContentType.MTextContent
  }

  /**
   * Gets the displayed MText string content.
   */

  get contents() {
    return this._mtextContent?.text ?? ''
  }
  set contents(value: string) {
    if (!this._mtextContent) {
      this._mtextContent = {
        text: value,
        anchorPoint: new AcGePoint3d()
      }
    } else {
      this._mtextContent.text = value
    }
    this._contentType = AcDbMLeaderContentType.MTextContent
  }

  /**
   * Gets the MText anchor point.
   */

  get textLocation() {
    return this._mtextContent?.anchorPoint
  }
  set textLocation(value: AcGePoint3dLike | undefined) {
    if (!value) {
      this._mtextContent = undefined
      return
    }
    if (!this._mtextContent) {
      this._mtextContent = {
        text: '',
        anchorPoint: this.createPoint(value)
      }
    } else {
      this._mtextContent.anchorPoint.copy(value)
    }
    this._contentType = AcDbMLeaderContentType.MTextContent
  }

  /**
   * Gets the text height.
   */

  get textHeight() {
    return this._textHeight
  }
  set textHeight(value: number) {
    this._textHeight = value
  }

  /**
   * Gets the text width.
   */

  get textWidth() {
    return this._textWidth
  }
  set textWidth(value: number) {
    this._textWidth = value
  }

  /**
   * Gets the text rotation.
   */

  get textRotation() {
    return this._textRotation
  }
  set textRotation(value: number) {
    this._textRotation = value
  }

  /**
   * Gets the text direction.
   */

  get textDirection() {
    return this._textDirection
  }
  set textDirection(value: AcGeVector3dLike) {
    this._textDirection.copy(value)
  }

  /**
   * Gets the text style name.
   */

  get textStyleName() {
    return this._textStyleName
  }
  set textStyleName(value: string) {
    this._textStyleName = value
  }

  /**
   * Gets the text attachment point.
   */

  get textAttachmentPoint() {
    return this._textAttachmentPoint
  }
  set textAttachmentPoint(value: AcGiMTextAttachmentPoint) {
    this._textAttachmentPoint = value
  }

  /**
   * Gets the text drawing direction.
   */

  get textDrawingDirection() {
    return this._textDrawingDirection
  }
  set textDrawingDirection(value: AcGiMTextFlowDirection) {
    this._textDrawingDirection = value
  }

  /**
   * Gets the text line spacing factor.
   */

  get textLineSpacingFactor() {
    return this._textLineSpacingFactor
  }
  set textLineSpacingFactor(value: number) {
    this._textLineSpacingFactor = value
  }

  /**
   * Gets the text attachment direction.
   */

  get textAttachmentDirection() {
    return this._textAttachmentDirection
  }
  set textAttachmentDirection(value: AcDbMLeaderTextAttachmentDirection) {
    this._textAttachmentDirection = value
  }

  /**
   * Gets the block content.
   */

  get blockContent() {
    return this._blockContent
      ? {
          blockContentId: this._blockContent.blockContentId,
          blockHandle: this._blockContent.blockHandle,
          normal: this._blockContent.normal?.clone(),
          position: this._blockContent.position?.clone(),
          scale: this._blockContent.scale.clone(),
          rotation: this._blockContent.rotation,
          color: this._blockContent.color?.clone(),
          transformationMatrix: [...this._blockContent.transformationMatrix]
        }
      : undefined
  }
  set blockContent(value: AcDbMLeaderBlockContentLike | undefined) {
    if (!value) {
      this._blockContent = undefined
      if (this._contentType === AcDbMLeaderContentType.BlockContent) {
        this._contentType = AcDbMLeaderContentType.NoneContent
      }
      return
    }
    this._blockContent = {
      blockContentId: value.blockContentId ?? value.blockHandle,
      blockHandle: value.blockHandle,
      normal: value.normal ? new AcGeVector3d(value.normal) : undefined,
      position: value.position ? this.createPoint(value.position) : undefined,
      scale: new AcGeVector3d(value.scale ?? { x: 1, y: 1, z: 1 }),
      rotation: value.rotation ?? 0,
      color: value.color?.clone(),
      transformationMatrix: value.transformationMatrix
        ? [...value.transformationMatrix]
        : []
    }
    this.blockContentId = this._blockContent.blockContentId
    this._contentType = AcDbMLeaderContentType.BlockContent
  }

  /**
   * Adds a leader branch and returns its index.
   *
   * @param leader Optional leader payload used to initialize branch data.
   * @returns Index of the newly added leader branch.
   */
  addLeader(leader: AcDbMLeaderLeaderLike = {}) {
    const dbLeader: AcDbMLeaderLeader = {
      lastLeaderLinePoint: leader.lastLeaderLinePoint
        ? this.createPoint(leader.lastLeaderLinePoint)
        : undefined,
      lastLeaderLinePointSet: leader.lastLeaderLinePointSet,
      landingPoint: leader.landingPoint
        ? this.createPoint(leader.landingPoint)
        : undefined,
      doglegVector: leader.doglegVector
        ? new AcGeVector3d(leader.doglegVector)
        : undefined,
      doglegVectorSet: leader.doglegVectorSet,
      doglegLength: leader.doglegLength,
      breaks:
        leader.breaks?.map(item => ({
          index: item.index,
          start: this.createPoint(item.start),
          end: this.createPoint(item.end)
        })) ?? [],
      leaderBranchIndex: leader.leaderBranchIndex,
      directionType: leader.directionType,
      leaderLines: []
    }
    leader.leaderLines?.forEach(line => {
      dbLeader.leaderLines.push(this.createLeaderLine(line))
    })
    this._leaders.push(dbLeader)
    return this._leaders.length - 1
  }

  /**
   * Removes a leader branch.
   *
   * @param leaderIndex Zero-based index of the leader branch to remove.
   * @returns The current entity instance for chaining.
   */
  removeLeader(leaderIndex: number) {
    this.checkLeaderIndex(leaderIndex)
    this._leaders.splice(leaderIndex, 1)
    return this
  }

  /**
   * Adds a leader line to a leader branch and returns the line index.
   *
   * @param leaderIndex Index of the target leader branch.
   * @param vertices Optional initial vertices for the leader line.
   * @returns Index of the newly added leader line.
   */
  addLeaderLine(leaderIndex: number, vertices: AcGePoint3dLike[] = []): number {
    this.checkLeaderIndex(leaderIndex)
    this._leaders[leaderIndex].leaderLines.push(
      this.createLeaderLine({ vertices })
    )
    return this._leaders[leaderIndex].leaderLines.length - 1
  }

  /**
   * Appends a vertex to one leader line.
   *
   * @param leaderIndex Index of the target leader branch.
   * @param leaderLineIndex Index of the target leader line.
   * @param point Vertex to append.
   * @returns The current entity instance for chaining.
   */
  appendVertex(
    leaderIndex: number,
    leaderLineIndex: number,
    point: AcGePoint3dLike
  ) {
    this.getMutableLeaderLine(leaderIndex, leaderLineIndex).vertices.push(
      this.createPoint(point)
    )
    return this
  }

  /**
   * Replaces the vertices of one leader line.
   *
   * @param leaderIndex Index of the target leader branch.
   * @param leaderLineIndex Index of the target leader line.
   * @param vertices New vertex sequence.
   * @returns The current entity instance for chaining.
   */
  setLeaderLineVertices(
    leaderIndex: number,
    leaderLineIndex: number,
    vertices: AcGePoint3dLike[]
  ) {
    this.getMutableLeaderLine(leaderIndex, leaderLineIndex).vertices =
      vertices.map(point => this.createPoint(point))
    return this
  }

  /**
   * Gets cloned vertices from the specified leader line.
   *
   * @param leaderIndex Index of the leader branch.
   * @param leaderLineIndex Index of the leader line in the branch.
   * @returns A cloned vertex list so callers cannot mutate internal state.
   */
  getLeaderLineVertices(leaderIndex: number, leaderLineIndex: number) {
    return this.getMutableLeaderLine(leaderIndex, leaderLineIndex).vertices.map(
      point => point.clone()
    )
  }

  /**
   * Adds a break segment to a specific leader line.
   *
   * @param leaderIndex Index of the leader branch.
   * @param leaderLineIndex Index of the leader line.
   * @param start Break start point.
   * @param end Break end point.
   * @returns The current entity instance for chaining.
   */
  addBreak(
    leaderIndex: number,
    leaderLineIndex: number,
    start: AcGePoint3dLike,
    end: AcGePoint3dLike
  ) {
    this.getMutableLeaderLine(leaderIndex, leaderLineIndex).breaks.push({
      start: this.createPoint(start),
      end: this.createPoint(end)
    })
    return this
  }

  /**
   * Sets the landing point for one leader branch.
   *
   * @param leaderIndex Index of the leader branch.
   * @param point New landing point, or `undefined` to clear it.
   * @returns The current entity instance for chaining.
   */
  setLandingPoint(leaderIndex: number, point: AcGePoint3dLike | undefined) {
    this.checkLeaderIndex(leaderIndex)
    this._leaders[leaderIndex].landingPoint = point
      ? this.createPoint(point)
      : undefined
    return this
  }

  /**
   * Sets the dogleg direction for one leader branch.
   *
   * @param leaderIndex Index of the leader branch.
   * @param vector New dogleg direction vector.
   * @returns The current entity instance for chaining.
   */
  setDoglegDirection(leaderIndex: number, vector: AcGeVector3dLike) {
    this.checkLeaderIndex(leaderIndex)
    this._leaders[leaderIndex].doglegVector = new AcGeVector3d(vector)
    return this
  }

  /**
   * Sets the dogleg length for one leader branch.
   *
   * @param leaderIndex Index of the leader branch.
   * @param length New dogleg length, or `undefined` to clear the override.
   * @returns The current entity instance for chaining.
   */
  setDoglegLength(leaderIndex: number, length: number | undefined) {
    this.checkLeaderIndex(leaderIndex)
    this._leaders[leaderIndex].doglegLength = length
    return this
  }

  /**
   * Gets the axis-aligned extents computed from all geometry points.
   */

  get geometricExtents() {
    const points = this.collectGeometryPoints()
    return points.length > 0
      ? new AcGeBox3d().setFromPoints(points)
      : new AcGeBox3d()
  }

  /**
   * Gets grip points used for interactive editing.
   *
   * @returns Cloned grip points derived from renderable geometry.
   */
  subGetGripPoints() {
    return this.collectGeometryPoints().map(point => point.clone())
  }

  /** @inheritdoc */
  subMoveGripPointsAt(indices: number[], offset: AcGeVector3dLike) {
    acdbForEachGripIndex(indices, index => {
      this.moveGeometryGripPointAt(index, offset)
    })
    return this
  }

  /**
   * Gets the object snap points for this multileader.
   */
  subGetOsnapPoints(
    osnapMode: AcDbOsnapMode,
    pickPoint: AcGePoint3dLike,
    _lastPoint: AcGePoint3dLike,
    snapPoints: AcGePoint3dLike[]
  ) {
    if (osnapMode === AcDbOsnapMode.Insertion) {
      if (this.contentBasePosition) {
        snapPoints.push(this.contentBasePosition)
      } else if (this._mtextContent) {
        snapPoints.push(this._mtextContent.anchorPoint)
      } else if (this._blockContent?.position) {
        snapPoints.push(this._blockContent.position)
      }
      return
    }

    this._leaders.forEach(leader => {
      leader.leaderLines.forEach(line => {
        const drawPoints = this.getLeaderLineDrawPoints(leader, line)
        if (drawPoints.length === 0) return

        switch (osnapMode) {
          case AcDbOsnapMode.EndPoint:
            snapPoints.push(...drawPoints)
            break
          case AcDbOsnapMode.MidPoint:
          case AcDbOsnapMode.Nearest:
          case AcDbOsnapMode.Perpendicular: {
            const candidates: AcGePoint3d[] = []
            for (let index = 0; index < drawPoints.length - 1; index++) {
              const segmentSnaps: AcGePoint3d[] = []
              acdbCollectLineSegmentOsnapPoints(
                drawPoints[index],
                drawPoints[index + 1],
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
      })
    })
  }

  /**
   * Applies a transformation matrix to this entity.
   *
   * @param matrix Transformation matrix applied to all geometry and vectors.
   * @returns The current entity instance for chaining.
   */
  transformBy(matrix: AcGeMatrix3d) {
    this._leaders.forEach(leader => {
      leader.lastLeaderLinePoint?.applyMatrix4(matrix)
      leader.landingPoint?.applyMatrix4(matrix)
      if (leader.doglegVector) {
        this.transformVector(leader.doglegVector, matrix)
      }
      leader.breaks.forEach(item => {
        item.start.applyMatrix4(matrix)
        item.end.applyMatrix4(matrix)
      })
      leader.leaderLines.forEach(line => {
        line.vertices.forEach(point => point.applyMatrix4(matrix))
        line.breaks.forEach(item => {
          item.start.applyMatrix4(matrix)
          item.end.applyMatrix4(matrix)
        })
      })
    })
    this._landingPoint?.applyMatrix4(matrix)
    this.contentBasePosition?.applyMatrix4(matrix)
    this.transformVector(this._doglegVector, matrix)
    this.transformVector(this._normal, matrix)
    this.textAnchor?.applyMatrix4(matrix)
    this._mtextContent?.anchorPoint.applyMatrix4(matrix)
    this.transformVector(this._textDirection, matrix)
    this._blockContent?.position?.applyMatrix4(matrix)
    if (this._blockContent?.normal) {
      this.transformVector(this._blockContent.normal, matrix)
    }
    if (this.blockContentScale) {
      this.transformVector(this.blockContentScale, matrix)
    }
    this.planeOrigin?.applyMatrix4(matrix)
    if (this.planeXAxisDirection) {
      this.transformVector(this.planeXAxisDirection, matrix)
    }
    if (this.planeYAxisDirection) {
      this.transformVector(this.planeYAxisDirection, matrix)
    }
    return this
  }

  get properties(): AcDbEntityProperties {
    return {
      type: this.type,
      groups: [
        this.getGeneralProperties(),
        {
          groupName: 'leader',
          properties: [
            {
              name: 'contentType',
              type: 'enum',
              editable: true,
              options: [
                {
                  label:
                    AcDbMLeaderContentType[AcDbMLeaderContentType.NoneContent],
                  value: AcDbMLeaderContentType.NoneContent
                },
                {
                  label:
                    AcDbMLeaderContentType[AcDbMLeaderContentType.BlockContent],
                  value: AcDbMLeaderContentType.BlockContent
                },
                {
                  label:
                    AcDbMLeaderContentType[AcDbMLeaderContentType.MTextContent],
                  value: AcDbMLeaderContentType.MTextContent
                },
                {
                  label:
                    AcDbMLeaderContentType[
                      AcDbMLeaderContentType.ToleranceContent
                    ],
                  value: AcDbMLeaderContentType.ToleranceContent
                }
              ],
              accessor: {
                get: () => this.contentType,
                set: (value: AcDbMLeaderContentType) => {
                  this.contentType = value
                }
              }
            },
            {
              name: 'leaderLineType',
              type: 'enum',
              editable: true,
              options: [
                {
                  label:
                    AcDbMLeaderLineType[AcDbMLeaderLineType.InvisibleLeader],
                  value: AcDbMLeaderLineType.InvisibleLeader
                },
                {
                  label:
                    AcDbMLeaderLineType[AcDbMLeaderLineType.StraightLeader],
                  value: AcDbMLeaderLineType.StraightLeader
                },
                {
                  label: AcDbMLeaderLineType[AcDbMLeaderLineType.SplineLeader],
                  value: AcDbMLeaderLineType.SplineLeader
                }
              ],
              accessor: {
                get: () => this.leaderLineType,
                set: (value: AcDbMLeaderLineType) => {
                  this.leaderLineType = value
                }
              }
            },
            {
              name: 'doglegEnabled',
              type: 'boolean',
              editable: true,
              accessor: {
                get: () => this.doglegEnabled,
                set: (value: boolean) => {
                  this.doglegEnabled = value
                }
              }
            },
            {
              name: 'doglegLength',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.doglegLength,
                set: (value: number) => {
                  this.doglegLength = value
                }
              }
            },
            {
              name: 'leaderCount',
              type: 'int',
              editable: false,
              accessor: {
                get: () => this.numberOfLeaders
              }
            }
          ]
        },
        {
          groupName: 'text',
          properties: [
            {
              name: 'contents',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.contents,
                set: (value: string) => {
                  this.contents = value
                }
              }
            },
            {
              name: 'textHeight',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.textHeight,
                set: (value: number) => {
                  this.textHeight = value
                }
              }
            },
            {
              name: 'textWidth',
              type: 'float',
              editable: true,
              accessor: {
                get: () => this.textWidth,
                set: (value: number) => {
                  this.textWidth = value
                }
              }
            },
            {
              name: 'textStyleName',
              type: 'string',
              editable: true,
              accessor: {
                get: () => this.textStyleName,
                set: (value: string) => {
                  this.textStyleName = value
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
   *
   * @returns The current entity instance with effective properties resolved.
   */
  override resolveEffectiveProperties() {
    super.resolveEffectiveProperties()
    if (this._mleaderStyleId) return

    const style = this.getDefaultMLeaderStyle()
    if (style) {
      this._mleaderStyleId = style.objectId
    }
  }
  /**
   * Builds renderable primitives for this multileader entity.
   *
   * @param renderer Graphics renderer used to create draw entities.
   * @returns A single entity, an entity group, or undefined when nothing is drawable.
   */
  subWorldDraw(
    renderer: AcGiRenderer,
    delay?: boolean
  ): AcGiEntity | undefined {
    const entities: AcGiEntity[] = []
    const traits = renderer.subEntityTraits
    const originalColor = traits.color
    const originalLineType = traits.lineType
    const originalLineWeight = traits.lineWeight
    const leaderLineColor = this.getResolvedLeaderLineColor()
    const leaderLineStyle = this.getResolvedLeaderLineStyle()
    const leaderLineWeight = this.getResolvedLeaderLineWeight()
    const textColor = this.getResolvedTextColor()

    if (
      this.getResolvedLeaderLineType() !== AcDbMLeaderLineType.InvisibleLeader
    ) {
      this.applyColorTraits(traits, leaderLineColor, originalColor)
      this.applyLineTraits(traits, leaderLineStyle, leaderLineWeight)
      this._leaders.forEach(leader => {
        leader.leaderLines.forEach(line => {
          const points = this.getLeaderLineDrawPoints(leader, line)
          if (points.length > 0) {
            const leaderEntity = this.drawLeaderLine(renderer, points)
            if (leaderEntity) entities.push(leaderEntity)
          }
        })
        const doglegPoints = this.getDoglegPoints(leader)
        if (doglegPoints) {
          entities.push(renderer.lines(doglegPoints))
        }
      })
    }

    const mtextContent = this.getRenderableMTextContent()
    if (
      this.contentType === AcDbMLeaderContentType.MTextContent &&
      mtextContent
    ) {
      this.applyColorTraits(traits, textColor, originalColor)
      const textHeight = this.getResolvedTextHeight()
      const mtextData: AcGiMTextData = {
        text: mtextContent.text,
        height: textHeight,
        width: this.getMTextRenderWidth(mtextContent.text, textHeight),
        position: mtextContent.anchorPoint,
        rotation: this.textRotation,
        directionVector: this.textDirection,
        attachmentPoint: this.textAttachmentPoint,
        drawingDirection: this.textDrawingDirection,
        lineSpaceFactor: this.textLineSpacingFactor
      }
      // Nested MText must follow the same delay flag as top-level MTEXT so the
      // viewer can finish geometry asynchronously in worker render mode.
      entities.push(renderer.mtext(mtextData, this.getTextStyle(), delay))
    }

    traits.color = originalColor
    traits.lineType = originalLineType
    traits.lineWeight = originalLineWeight
    if (entities.length === 0) return undefined
    return entities.length === 1 ? entities[0] : renderer.group(entities)
  }

  /**
   * Writes this multileader entity to DXF group codes.
   *
   * @param filer DXF filer that receives serialized values.
   * @returns The current entity instance for chaining.
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbMLeader')
    filer.writeInt16(170, this.leaderLineType)
    filer.writeBoolean(290, this.doglegEnabled)
    filer.writeDouble(41, this.doglegLength)
    filer.writeInt16(172, this.contentType)
    filer.writeVector3d(210, this.normal)
    filer.writeHandle(340, this.mleaderStyleId)
    if (this._landingPoint) filer.writePoint3d(10, this._landingPoint)
    filer.writeVector3d(11, this.doglegVector)

    if (this._mtextContent) {
      filer.writeString(1, this._mtextContent.text)
      filer.writePoint3d(12, this._mtextContent.anchorPoint)
      filer.writeDouble(40, this.textHeight)
      filer.writeDouble(42, this.textWidth)
      filer.writeAngle(50, this.textRotation)
      filer.writeString(7, this.textStyleName)
    }
    if (this._blockContent) {
      filer.writeHandle(341, this._blockContent.blockContentId ?? '')
      if (this._blockContent.position) {
        filer.writePoint3d(15, this._blockContent.position)
      }
      filer.writeVector3d(16, this._blockContent.scale)
      filer.writeAngle(52, this._blockContent.rotation)
    }

    this._leaders.forEach(leader => {
      if (leader.landingPoint) filer.writePoint3d(110, leader.landingPoint)
      if (leader.doglegVector) filer.writeVector3d(111, leader.doglegVector)
      filer.writeDouble(140, leader.doglegLength)
      filer.writeInt16(171, leader.leaderLines.length)
      leader.leaderLines.forEach(line => {
        filer.writeInt16(90, line.vertices.length)
        line.vertices.forEach(point => filer.writePoint3d(10, point))
      })
    })
    return this
  }

  /**
   * Creates a concrete point from point-like input.
   *
   * @param point Source point-like value.
   * @returns A newly created point instance.
   */
  private createPoint(point: AcGePoint3dLike) {
    return new AcGePoint3d().copy(point)
  }

  /**
   * Normalizes one leader-line payload into internal storage format.
   *
   * @param line Source leader-line payload.
   * @returns A normalized leader line.
   */
  private createLeaderLine(line: AcDbMLeaderLineLike): AcDbMLeaderLine {
    return {
      vertices: line.vertices?.map(point => this.createPoint(point)) ?? [],
      breakPointIndexes: line.breakPointIndexes
        ? [...line.breakPointIndexes]
        : [],
      leaderLineIndex: line.leaderLineIndex,
      breaks:
        line.breaks?.map(item => ({
          index: item.index,
          start: this.createPoint(item.start),
          end: this.createPoint(item.end)
        })) ?? []
    }
  }

  /**
   * Creates a deep clone of a leader branch.
   *
   * @param leader Leader branch to clone.
   * @returns A deep-cloned leader branch.
   */
  private cloneLeader(leader: AcDbMLeaderLeader): AcDbMLeaderLeader {
    return {
      lastLeaderLinePoint: leader.lastLeaderLinePoint?.clone(),
      lastLeaderLinePointSet: leader.lastLeaderLinePointSet,
      landingPoint: leader.landingPoint?.clone(),
      doglegVector: leader.doglegVector?.clone(),
      doglegVectorSet: leader.doglegVectorSet,
      doglegLength: leader.doglegLength,
      breaks: leader.breaks.map(item => ({
        index: item.index,
        start: item.start.clone(),
        end: item.end.clone()
      })),
      leaderBranchIndex: leader.leaderBranchIndex,
      directionType: leader.directionType,
      leaderLines: leader.leaderLines.map(line => ({
        vertices: line.vertices.map(point => point.clone()),
        breakPointIndexes: [...line.breakPointIndexes],
        leaderLineIndex: line.leaderLineIndex,
        breaks: line.breaks.map(item => ({
          index: item.index,
          start: item.start.clone(),
          end: item.end.clone()
        }))
      }))
    }
  }

  /**
   * Validates that a leader index is in range.
   *
   * @param leaderIndex Leader branch index to validate.
   * @throws {Error} Thrown when `leaderIndex` is outside valid range.
   * @returns `void`.
   */
  private checkLeaderIndex(leaderIndex: number) {
    if (leaderIndex < 0 || leaderIndex >= this._leaders.length) {
      throw new Error('The leader index is out of range!')
    }
  }

  /**
   * Gets a mutable leader line by branch and line index.
   *
   * @param leaderIndex Leader branch index.
   * @param leaderLineIndex Leader-line index in the branch.
   * @returns The mutable leader line reference.
   */
  private getMutableLeaderLine(
    leaderIndex: number,
    leaderLineIndex: number
  ): AcDbMLeaderLine {
    this.checkLeaderIndex(leaderIndex)
    const line = this._leaders[leaderIndex].leaderLines[leaderLineIndex]
    if (!line) {
      throw new Error('The leader line index is out of range!')
    }
    return line
  }

  /**
   * Collects all geometry points contributing to draw/extents calculations.
   *
   * @returns Geometry point collection.
   */
  private collectGeometryPoints() {
    const points: AcGePoint3d[] = []
    this._leaders.forEach(leader => {
      if (leader.lastLeaderLinePoint) points.push(leader.lastLeaderLinePoint)
      if (leader.landingPoint) points.push(leader.landingPoint)
      leader.breaks.forEach(item => points.push(item.start, item.end))
      leader.leaderLines.forEach(line => {
        points.push(...line.vertices)
        line.breaks.forEach(item => points.push(item.start, item.end))
      })
      const doglegPoints = this.getDoglegPoints(leader)
      if (doglegPoints) points.push(...doglegPoints)
      leader.leaderLines.forEach(line => {
        const arrowPoints = this.getArrowheadPoints(
          this.getLeaderLineDrawPoints(leader, line)
        )
        if (arrowPoints) points.push(...arrowPoints)
      })
    })
    if (this._landingPoint) points.push(this._landingPoint)
    if (this.contentBasePosition) points.push(this.contentBasePosition)
    if (this.textAnchor) points.push(this.textAnchor)
    if (this._mtextContent) points.push(this._mtextContent.anchorPoint)
    if (this._blockContent?.position) points.push(this._blockContent.position)
    if (this.planeOrigin) points.push(this.planeOrigin)
    return points
  }

  /**
   * Moves one geometry grip point using the same index order as
   * {@link collectGeometryPoints}.
   */
  private moveGeometryGripPointAt(gripIndex: number, offset: AcGeVector3dLike) {
    let currentIndex = 0

    const visit = (point: AcGePoint3d | undefined, onComputed?: () => void) => {
      if (point) {
        if (currentIndex === gripIndex) {
          point.add(offset)
        }
        currentIndex++
        return
      }
      if (onComputed) {
        if (currentIndex === gripIndex) {
          onComputed()
        }
        currentIndex++
      }
    }

    this._leaders.forEach(leader => {
      visit(leader.lastLeaderLinePoint)
      visit(leader.landingPoint)
      leader.breaks.forEach(item => {
        visit(item.start)
        visit(item.end)
      })
      leader.leaderLines.forEach(line => {
        line.vertices.forEach(vertex => visit(vertex))
        line.breaks.forEach(item => {
          visit(item.start)
          visit(item.end)
        })
      })
      const doglegPoints = this.getDoglegPoints(leader)
      if (doglegPoints) {
        visit(doglegPoints[0])
        visit(undefined, () => {
          const start = doglegPoints[0]
          const end = doglegPoints[1]
          if (!start || !end) return
          const newLength = start.distanceTo({
            x: end.x + offset.x,
            y: end.y + offset.y,
            z: (end.z ?? 0) + (offset.z ?? 0)
          })
          if (leader.doglegLength != null || leader.doglegVectorSet) {
            leader.doglegLength = newLength
          } else {
            this._doglegLength = newLength
          }
        })
      }
      leader.leaderLines.forEach(line => {
        const drawPoints = this.getLeaderLineDrawPoints(leader, line)
        const arrowPoints = this.getArrowheadPoints(drawPoints)
        if (!arrowPoints) return
        arrowPoints.forEach((_, arrowIndex) => {
          if (arrowIndex === 0 || arrowIndex === arrowPoints.length - 1) {
            visit(drawPoints[0])
          } else {
            visit(undefined)
          }
        })
      })
    })
    visit(this._landingPoint)
    visit(this.contentBasePosition)
    visit(this.textAnchor)
    if (this._mtextContent) {
      visit(this._mtextContent.anchorPoint)
    }
    if (this._blockContent?.position) {
      visit(this._blockContent.position)
    }
    visit(this.planeOrigin)
  }

  /**
   * Resolves the final draw points for a leader line.
   *
   * @param leader Owning leader branch.
   * @param line Leader line to resolve.
   * @returns The resolved draw-point sequence.
   */
  private getLeaderLineDrawPoints(
    leader: AcDbMLeaderLeader,
    line: AcDbMLeaderLine
  ) {
    if (line.vertices.length >= 2) return line.vertices
    if (line.vertices.length === 0) return []

    const end =
      leader.lastLeaderLinePoint ??
      leader.landingPoint ??
      this._landingPoint ??
      this.contentBasePosition
    if (!end || line.vertices[0].equals(end)) return line.vertices
    return [line.vertices[0], end]
  }

  /**
   * Computes the dogleg segment points for a leader branch.
   *
   * @param leader Leader branch to evaluate.
   * @returns Dogleg segment points, or `undefined` if not applicable.
   */
  private getDoglegPoints(leader: AcDbMLeaderLeader) {
    if (!this.getResolvedDoglegEnabled()) return undefined
    const start =
      leader.lastLeaderLinePoint ?? leader.landingPoint ?? this._landingPoint
    const vector = leader.doglegVector ?? this._doglegVector
    const length = leader.doglegLength ?? this.getResolvedDoglegLength()
    if (!start || length == null || length === 0 || vector.lengthSq() === 0) {
      return undefined
    }

    const end = start
      .clone()
      .add(vector.clone().normalize().multiplyScalar(length))
    return [start, end]
  }

  /**
   * Builds arrowhead polyline points from leader-line points.
   *
   * @param points Leader-line points where the first point is treated as tip.
   * @returns Arrowhead points, or `undefined` when no arrowhead is drawable.
   */
  private getArrowheadPoints(points: AcGePoint3d[]) {
    if (!this.isArrowheadVisible() || points.length < 2) return undefined

    const frame = this.getArrowheadFrame(points)
    if (!frame) return undefined

    const size = this.getResolvedArrowheadSize()
    const { tip, unit } = frame
    const baseCenter = tip.clone().add(unit.clone().multiplyScalar(size))
    const halfWidth = size / 6
    const perpendicular = new AcGeVector3d(-unit.y, unit.x, 0)

    const left = baseCenter
      .clone()
      .add(perpendicular.clone().multiplyScalar(halfWidth))
    const right = baseCenter
      .clone()
      .add(perpendicular.clone().multiplyScalar(-halfWidth))
    return [tip, left, right, tip]
  }

  /**
   * Checks whether an arrowhead should be rendered.
   *
   * @returns `true` if arrowhead configuration is visible.
   */
  private isArrowheadVisible() {
    const arrowId = this.getResolvedArrowheadId()
    if (arrowId?.toUpperCase() === '_NONE') return false
    return this.getResolvedArrowheadSize() > 0
  }

  /**
   * Draws one leader line and applies arrow style from MLEADER/MLEADERSTYLE.
   *
   * @param renderer Graphics renderer used to create primitives.
   * @param points Leader-line draw points.
   * @returns One entity or an entity group representing the full leader line.
   */
  private drawLeaderLine(renderer: AcGiRenderer, points: AcGePoint3d[]) {
    const entities: AcGiEntity[] = []
    const linePoints = this.getLeaderLinePointsForDraw(points)
    if (linePoints.length >= 2) {
      entities.push(renderer.lines(linePoints))
    }
    const arrow = this.drawArrowhead(renderer, points)
    if (arrow) entities.push(arrow)
    if (entities.length === 0) return undefined
    return entities.length === 1 ? entities[0] : renderer.group(entities)
  }

  /**
   * Resolves leader-line points used for stroke drawing after arrow overlap trim.
   *
   * @param points Original leader polyline points.
   * @returns Trimmed points used to draw the leader stroke.
   */
  private getLeaderLinePointsForDraw(points: AcGePoint3d[]) {
    const trimDistance = this.getArrowheadLeaderLineTrimDistance()
    if (trimDistance <= 0) return points
    return this.trimPolylineStart(points, trimDistance)
  }

  /**
   * Resolves how much of leader start should be trimmed to avoid arrow overlap.
   *
   * @returns Trim distance in drawing units.
   */
  private getArrowheadLeaderLineTrimDistance() {
    if (!this.isArrowheadVisible()) return 0

    const blockTableRecord = this.getResolvedArrowheadBlockTableRecord()
    if (!blockTableRecord) return 0

    const size = this.getResolvedArrowheadSize()
    if (size <= 0) return 0

    const basePoint = blockTableRecord.origin ?? AcGePoint3d.ORIGIN
    let maxX = basePoint.x
    for (const entity of blockTableRecord.newIterator()) {
      const extents = entity.geometricExtents
      if (extents.isEmpty()) continue
      if (extents.max.x > maxX) maxX = extents.max.x
    }
    return Math.max(0, (maxX - basePoint.x) * size)
  }

  /**
   * Trims the start of a polyline by a given distance.
   *
   * @param points Polyline points.
   * @param trimDistance Distance to trim from the start.
   * @returns Trimmed polyline points.
   */
  private trimPolylineStart(points: AcGePoint3d[], trimDistance: number) {
    if (points.length < 2 || trimDistance <= 0) return points

    let remaining = trimDistance
    for (let i = 0; i < points.length - 1; i++) {
      const start = points[i]
      const end = points[i + 1]
      const segment = end.distanceTo(start)
      if (segment <= 0) continue

      if (remaining < segment) {
        const direction = new AcGeVector3d().subVectors(end, start)
        const newStart = start
          .clone()
          .add(direction.multiplyScalar(remaining / segment))
        return [newStart, ...points.slice(i + 1)]
      }

      remaining -= segment
    }
    return [points[points.length - 1]]
  }

  /**
   * Draws one arrowhead primitive from leader-line points.
   *
   * @param renderer Graphics renderer used to create primitives.
   * @param points Leader-line points where the first point is treated as tip.
   * @returns Arrowhead entity, or `undefined` when no arrowhead is drawable.
   */
  private drawArrowhead(renderer: AcGiRenderer, points: AcGePoint3d[]) {
    if (!this.isArrowheadVisible()) return undefined

    const blockArrow = this.drawArrowheadBlock(renderer, points)
    if (blockArrow) return blockArrow

    const arrowPoints = this.getArrowheadPoints(points)
    if (!arrowPoints) return undefined

    const area = new AcGeArea2d()
    area.add(new AcGePolyline2d(arrowPoints, true))
    const traits = renderer.subEntityTraits
    const originalFillType = traits.fillType
    traits.fillType = {
      solidFill: true,
      patternAngle: 0,
      definitionLines: []
    }
    const entity = renderer.area(area)
    traits.fillType = originalFillType
    return entity
  }

  /**
   * Draws arrowhead by rendering entities from referenced arrow block record.
   *
   * @param renderer Graphics renderer used to create primitives.
   * @param points Leader-line points where the first point is treated as tip.
   * @returns Rendered block-based arrowhead entity, or `undefined`.
   */
  private drawArrowheadBlock(renderer: AcGiRenderer, points: AcGePoint3d[]) {
    const blockTableRecord = this.getResolvedArrowheadBlockTableRecord()
    if (!blockTableRecord) return undefined

    const frame = this.getArrowheadFrame(points)
    if (!frame) return undefined

    const { tip, unit } = frame
    const size = this.getResolvedArrowheadSize()
    const angle = Math.atan2(unit.y, unit.x)
    const basePoint = blockTableRecord.origin ?? AcGePoint3d.ORIGIN

    const mBase = new AcGeMatrix3d().makeTranslation(
      -basePoint.x,
      -basePoint.y,
      -basePoint.z
    )
    const mScale = new AcGeMatrix3d().makeScale(size, size, size)
    const mRot = new AcGeMatrix3d().makeRotationZ(angle)
    const mInsert = new AcGeMatrix3d().makeTranslation(tip.x, tip.y, tip.z)
    const transform = new AcGeMatrix3d()
      .multiplyMatrices(mInsert, mRot)
      .multiply(mScale)
      .multiply(mBase)

    return AcDbRenderingCache.instance.draw(
      renderer,
      blockTableRecord,
      this.resolvedColor,
      [],
      true,
      transform,
      new AcGeVector3d(this.normal)
    )
  }

  /**
   * Resolves tip point and direction for arrowhead placement.
   *
   * @param points Leader-line points where the first point is treated as tip.
   * @returns Tip and normalized direction, or `undefined` when unavailable.
   */
  private getArrowheadFrame(points: AcGePoint3d[]) {
    if (points.length < 2) return undefined

    const tip = points[0]
    const next = points.find(point => !point.equals(tip))
    if (!next) return undefined

    const direction = new AcGeVector3d().subVectors(next, tip)
    if (direction.lengthSq() === 0) return undefined

    return {
      tip,
      unit: direction.normalize()
    }
  }

  /**
   * Resolves the effective arrowhead id.
   *
   * @returns Arrowhead id used for rendering.
   */
  private getResolvedArrowheadId() {
    const styleArrowId = this.getMLeaderStyle()?.arrowSymbolId
    return this.arrowheadId ?? styleArrowId
  }

  /**
   * Resolves arrowhead block record by Arrowhead ID handle.
   *
   * @returns Arrowhead block table record, or `undefined` when not found.
   */
  private getResolvedArrowheadBlockTableRecord() {
    const arrowId = this.getResolvedArrowheadId()
    if (!arrowId) return undefined
    return this.database.tables.blockTable.getIdAt(arrowId)
  }

  /**
   * Resolves the effective arrowhead size.
   *
   * @returns Arrowhead size used for rendering.
   */
  private getResolvedArrowheadSize() {
    const style = this.getMLeaderStyle()
    const styleArrowSize = style?.arrowSize ?? style?.scale
    return (
      this.arrowheadSize ??
      this.contentScale ??
      styleArrowSize ??
      this.getResolvedTextHeight()
    )
  }

  /**
   * Resolves effective text height by style and override-flag rules.
   *
   * @returns Effective text height used for rendering.
   */
  private getResolvedTextHeight() {
    const styleTextHeight = this.getMLeaderStyle()?.textHeight
    if (this.textHeight > 0) return this.textHeight
    if (styleTextHeight != null && styleTextHeight > 0) return styleTextHeight
    return 2.5
  }

  /**
   * Resolves renderable MText content using entity content first, with style fallback.
   *
   * @returns Renderable text payload, or `undefined` when unavailable.
   */
  private getRenderableMTextContent() {
    if (this._mtextContent) {
      return {
        text: this._mtextContent.text,
        anchorPoint: this._mtextContent.anchorPoint
      }
    }

    const defaultText = this.getMLeaderStyle()?.defaultMTextContents
    const anchorPoint =
      this.textAnchor ?? this.contentBasePosition ?? this._landingPoint
    if (!defaultText || !anchorPoint) return undefined
    return {
      text: defaultText,
      anchorPoint
    }
  }

  /**
   * Computes render width for current MText content.
   *
   * @param text Source MText content string.
   * @param textHeight Effective text height used for fallback estimation.
   * @returns Explicit width or an estimated width based on plain text length.
   */
  private getMTextRenderWidth(text: string, textHeight: number) {
    if (this._textWidth > 0) return this._textWidth
    if (!text) return this._textWidth

    const plainText = text
      .replace(/\\[PpNn]/g, '\n')
      .replace(/\\[A-Za-z][^;]*;/g, '')
      .replace(/[{}]/g, '')
    const longestLineLength = Math.max(
      ...plainText.split(/\r\n|\r|\n/g).map(line => line.length),
      1
    )
    return Math.max(textHeight, longestLineLength * textHeight)
  }

  /**
   * Transforms a direction vector with an affine matrix.
   *
   * @param vector Vector to mutate.
   * @param matrix Transformation matrix.
   * @returns `void`.
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
   * Resolves the referenced MLeader style object.
   *
   * @returns Resolved style object or `undefined` when not available.
   */
  private getMLeaderStyle(): AcDbMLeaderStyle | undefined {
    const dictionary = this.database.objects.mleaderStyle
    const styleId = this.mleaderStyleId || this.leaderStyleId
    if (styleId) {
      const style = dictionary.getIdAt(styleId)
      if (style) return style
    }

    return this.getDefaultMLeaderStyle()
  }

  /**
   * Resolves the default MLEADER style from CMLEADERSTYLE, with first-entry fallback.
   *
   * @returns Default style object or `undefined` when style dictionary is empty.
   */
  private getDefaultMLeaderStyle() {
    const bySysVar = this.resolveMLeaderStyleByName(
      this.getDefaultMLeaderStyleName()
    )
    if (bySysVar) return bySysVar

    return this.database.objects.mleaderStyle.newIterator().toArray()[0]
  }

  /**
   * Resolves one MLEADER style by style name (dictionary key) or object ID.
   *
   * @param styleName Style name or object id candidate.
   * @returns Matching style object, or `undefined` when not found.
   */
  private resolveMLeaderStyleByName(styleName: string | undefined) {
    const rawName = styleName?.trim()
    if (!rawName) return undefined

    const dictionary = this.database.objects.mleaderStyle
    const directByName = dictionary.getAt(rawName)
    if (directByName) return directByName

    const directById = dictionary.getIdAt(rawName)
    if (directById) return directById

    const normalizedStyleName = rawName.toUpperCase()
    for (const [name, style] of dictionary.entries()) {
      if (name.toUpperCase() === normalizedStyleName) {
        return style
      }
    }

    return undefined
  }

  /**
   * Resolves current CMLEADERSTYLE value with a stable default fallback.
   *
   * @returns Preferred default style name.
   */
  private getDefaultMLeaderStyleName() {
    try {
      return this.database.cmleaderstyle || DEFAULT_MLEADER_STYLE
    } catch {
      return DEFAULT_MLEADER_STYLE
    }
  }

  /**
   * Resolves text style name considering entity values, ids and style fallback.
   *
   * @returns Resolved text style name, or `undefined` when unresolved.
   */
  private getResolvedTextStyleName() {
    const textStyleTable = this.database.tables.textStyleTable
    const styleIdFromStyle = this.getMLeaderStyle()?.textStyleId
    const styleNameFromStyleId = styleIdFromStyle
      ? textStyleTable.getIdAt(styleIdFromStyle)?.name
      : undefined

    const styleNameFromEntityId = this.textStyleId
      ? textStyleTable.getIdAt(this.textStyleId)?.name
      : undefined

    if (this.textStyleName) {
      const byName = textStyleTable.getAt(this.textStyleName)
      if (byName?.name) return byName.name
      const byId = textStyleTable.getIdAt(this.textStyleName)
      if (byId?.name) return byId.name
    }

    if (styleNameFromEntityId) return styleNameFromEntityId

    return styleNameFromStyleId
  }

  /**
   * Resolves the text style used by renderer-side MText drawing.
   *
   * @returns A valid text style object.
   */
  private getTextStyle(): AcGiTextStyle {
    const style = this.database.tables.textStyleTable.resolveAt(
      this.getResolvedTextStyleName()
    )

    if (!style) {
      throw new Error('No valid text style found in text style table.')
    }
    return style.textStyle
  }

  /**
   * Resolves effective leader-line color by override-flag and style rules.
   *
   * @returns Effective leader-line color.
   */
  private getResolvedLeaderLineColor() {
    return this.getResolvedComponentColor(
      this.leaderLineColor,
      this.getMLeaderStyle()?.leaderLineColor,
      MLEADER_OVERRIDE_LEADER_LINE_COLOR
    )
  }

  /**
   * Resolves effective leader-line geometry type.
   *
   * @returns Effective leader-line type.
   */
  private getResolvedLeaderLineType() {
    const styleLineType = this.getMLeaderStyle()?.leaderLineType
    return this.getResolvedStyleDrivenValue(
      this.leaderLineType,
      styleLineType,
      MLEADER_OVERRIDE_LEADER_LINE_TYPE
    ) as AcDbMLeaderLineType
  }

  /**
   * Resolves effective leader-line linetype id/handle.
   *
   * @returns Effective linetype id, or `undefined` when not available.
   */
  private getResolvedLeaderLineTypeId() {
    return this.getResolvedStyleDrivenValue(
      this.leaderLineTypeId,
      this.getMLeaderStyle()?.leaderLineTypeId,
      MLEADER_OVERRIDE_LEADER_LINE_TYPE_ID
    )
  }

  /**
   * Resolves renderer linetype style for leader lines.
   *
   * @returns User-specified renderer linetype style, or `undefined`.
   */
  private getResolvedLeaderLineStyle() {
    const lineTypeId = this.getResolvedLeaderLineTypeId()
    if (!lineTypeId) return undefined

    const lineTypeRecord =
      this.database.tables.linetypeTable.getIdAt(lineTypeId)
    if (!lineTypeRecord) return undefined

    return {
      type: 'UserSpecified' as AcGiStyleType,
      ...lineTypeRecord.linetype
    }
  }

  /**
   * Resolves effective leader-line weight by override-flag and style rules.
   *
   * @returns Effective line weight, or `undefined`.
   */
  private getResolvedLeaderLineWeight() {
    const styleLineWeight = this.getMLeaderStyle()?.leaderLineWeight
    const lineWeight = this.getResolvedStyleDrivenValue(
      this.leaderLineWeight,
      styleLineWeight,
      MLEADER_OVERRIDE_LEADER_LINE_WEIGHT
    )
    if (lineWeight == null) return undefined
    return lineWeight as AcGiLineWeight
  }

  /**
   * Resolves whether dogleg drawing is effectively enabled.
   *
   * @returns Effective dogleg-enabled state.
   */
  private getResolvedDoglegEnabled() {
    const styleEnabled = this.getMLeaderStyle()?.doglegEnabled
    return this.getResolvedStyleDrivenValue(
      this.doglegEnabled,
      styleEnabled,
      MLEADER_OVERRIDE_DOGLEG_ENABLED
    )
  }

  /**
   * Resolves effective dogleg length by override-flag and style rules.
   *
   * @returns Effective dogleg length.
   */
  private getResolvedDoglegLength() {
    const styleLength = this.getMLeaderStyle()?.doglegLength
    return this.getResolvedStyleDrivenValue(
      this.doglegLength,
      styleLength,
      MLEADER_OVERRIDE_DOGLEG_LENGTH
    )
  }

  /**
   * Resolves effective text color by override-flag and style rules.
   *
   * @returns Effective text color.
   */
  private getResolvedTextColor() {
    return this.getResolvedComponentColor(
      this.textColor,
      this.getMLeaderStyle()?.textColor,
      MLEADER_OVERRIDE_TEXT_COLOR
    )
  }

  /**
   * Resolves effective component color from entity raw value and style fallback.
   *
   * @param rawEntityColor Raw DXF color value stored on the entity.
   * @param styleColor Style-level fallback color.
   * @param overrideFlagMask Property-override flag mask for this component.
   * @returns Effective color used for rendering and trait application.
   */
  private getResolvedComponentColor(
    entityColor: AcCmColor | undefined,
    styleColor: AcCmColor | undefined,
    overrideFlagMask: number
  ) {
    if (!entityColor) return styleColor

    const overrideEnabled = this.isPropertyOverrideEnabled(overrideFlagMask)
    if (overrideEnabled === true) return entityColor
    if (overrideEnabled === false) return styleColor ?? entityColor

    // Some DXF producers always write entity color fields as ByBlock/ByLayer even
    // when no override flag is enabled. Prefer style color in that ambiguous case.
    if (!entityColor.isByBlock && !entityColor.isByLayer) {
      return entityColor
    }
    return styleColor ?? entityColor
  }

  /**
   * Resolves effective value using override-flag and style fallback rules.
   *
   * @typeParam T Value type.
   * @param entityValue Value stored on the entity.
   * @param styleValue Value provided by style.
   * @param overrideFlagMask Property-override flag mask for this component.
   * @returns Effective resolved value.
   */
  private getResolvedStyleDrivenValue<T>(
    entityValue: T | undefined,
    styleValue: T | undefined,
    overrideFlagMask: number
  ) {
    const overrideEnabled = this.isPropertyOverrideEnabled(overrideFlagMask)
    if (overrideEnabled === true) return entityValue ?? styleValue
    if (overrideEnabled === false) return styleValue ?? entityValue
    return styleValue ?? entityValue
  }

  /**
   * Checks whether a specific property-override bit is enabled.
   *
   * @param flagMask Bit mask for the property being queried.
   * @returns `true` if enabled, `false` if disabled, or `undefined` when flag is absent.
   */
  private isPropertyOverrideEnabled(flagMask: number) {
    if (this.propertyOverrideFlag == null) return undefined
    return (this.propertyOverrideFlag & flagMask) !== 0
  }

  /**
   * Applies color traits while preserving original values for reset.
   *
   * @param traits Renderer traits object to mutate.
   * @param color Effective component color to apply.
   * @param originalColor Original trait color value.
   * @param originalRgbColor Original trait RGB value.
   * @returns `void`.
   */
  private applyColorTraits(
    traits: AcGiRenderer['subEntityTraits'],
    color: AcCmColor | undefined,
    originalColor: AcGiRenderer['subEntityTraits']['color']
  ) {
    traits.color = originalColor
    if (!color) return

    traits.color = color
  }

  /**
   * Applies line style traits when resolved values are available.
   *
   * @param traits Renderer traits object to mutate.
   * @param lineType Resolved linetype style.
   * @param lineWeight Resolved line weight.
   * @returns `void`.
   */
  private applyLineTraits(
    traits: AcGiRenderer['subEntityTraits'],
    lineType: AcGiRenderer['subEntityTraits']['lineType'] | undefined,
    lineWeight: AcGiLineWeight | undefined
  ) {
    if (lineType) {
      traits.lineType = lineType
    }
    if (lineWeight != null) {
      traits.lineWeight = lineWeight
    }
  }
}
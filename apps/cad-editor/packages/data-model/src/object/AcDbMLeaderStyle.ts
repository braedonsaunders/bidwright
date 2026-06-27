import { AcCmColor, AcCmColorMethod } from '@mlightcad/common'
import { AcGeVector3d, AcGeVector3dLike } from '@mlightcad/geometry-engine'

import { AcDbDxfFiler } from '../base/AcDbDxfFiler'
import { AcDbObject } from '../base/AcDbObject'
import { encodeMLeaderStyleRawColor } from '../misc/AcDbMLeaderStyleColorCodec'

/**
 * Represents the nongraphical MLEADERSTYLE object.
 *
 * This class mirrors the core ObjectARX `AcDbMLeaderStyle` get/set API by
 * exposing equivalent TypeScript properties.
 */
export class AcDbMLeaderStyle extends AcDbObject {
  private _unknown1?: number
  private _contentType: number
  private _drawMLeaderOrderType: number
  private _drawLeaderOrderType: number
  private _bitFlags: number
  private _maxLeaderSegmentsPoints: number
  private _firstSegmentAngleConstraint: number
  private _secondSegmentAngleConstraint: number
  private _leaderLineType: number
  private _leaderLineColor: AcCmColor
  private _leaderLineTypeId?: string
  private _leaderLineWeight: number
  private _enableLanding: boolean
  private _landingGap: number
  private _enableDogleg: boolean
  private _doglegLength: number
  private _description: string
  private _arrowSymbolId?: string
  private _arrowSize: number
  private _defaultMTextContents: string
  private _textStyleId?: string
  private _textLeftAttachmentType: number
  private _textAngleType: number
  private _textAlignmentType: number
  private _textRightAttachmentType: number
  private _textColor: AcCmColor
  private _textHeight: number
  private _enableFrameText: boolean
  private _textAlignAlwaysLeft: boolean
  private _alignSpace: number
  private _blockId?: string
  private _blockColor: AcCmColor
  private _blockScale: AcGeVector3d
  private _enableBlockScale: boolean
  private _blockRotation: number
  private _enableBlockRotation: boolean
  private _blockConnectionType: number
  private _scale: number
  private _overwritePropChanged: boolean
  private _annotative: boolean
  private _breakSize: number
  private _textAttachmentDirection: number
  private _bottomTextAttachmentType: number
  private _topTextAttachmentType: number
  private _unknown2?: boolean
  private _extendLeaderToText: boolean
  /**
   * Creates an MLeader style with ObjectARX-compatible default values.
   */
  constructor() {
    super()
    this._contentType = 2
    this._drawMLeaderOrderType = 1
    this._drawLeaderOrderType = 0
    this._bitFlags = 0
    this._maxLeaderSegmentsPoints = -1
    this._firstSegmentAngleConstraint = 0
    this._secondSegmentAngleConstraint = 0
    this._leaderLineType = 1
    this._leaderLineColor = new AcCmColor(AcCmColorMethod.ByLayer)
    this._leaderLineWeight = -2
    this._enableLanding = true
    this._landingGap = 2
    this._enableDogleg = true
    this._doglegLength = 8
    this._description = ''
    this._arrowSize = 4
    this._defaultMTextContents = ''
    this._textLeftAttachmentType = 1
    this._textAngleType = 1
    this._textAlignmentType = 0
    this._textRightAttachmentType = 1
    this._textColor = new AcCmColor(AcCmColorMethod.ByLayer)
    this._textHeight = 4
    this._enableFrameText = false
    this._textAlignAlwaysLeft = false
    this._alignSpace = 0
    this._blockColor = new AcCmColor(AcCmColorMethod.ByBlock)
    this._blockScale = new AcGeVector3d(1, 1, 1)
    this._enableBlockScale = true
    this._blockRotation = 0
    this._enableBlockRotation = false
    this._blockConnectionType = 0
    this._scale = 1
    this._overwritePropChanged = false
    this._annotative = false
    this._breakSize = 0
    this._textAttachmentDirection = 0
    this._bottomTextAttachmentType = 9
    this._topTextAttachmentType = 9
    this._extendLeaderToText = false
  }

  /**
   * Gets the first undocumented raw style value.
   */

  get unknown1() {
    return this._unknown1
  }
  set unknown1(value: number | undefined) {
    this._unknown1 = value
  }

  /**
   * Gets the content type.
   */

  get contentType() {
    return this._contentType
  }
  set contentType(value: number) {
    this._contentType = value
  }

  /**
   * Gets the draw mleader order type.
   */

  get drawMLeaderOrderType() {
    return this._drawMLeaderOrderType
  }
  set drawMLeaderOrderType(value: number) {
    this._drawMLeaderOrderType = value
  }

  /**
   * Gets the draw leader order type.
   */

  get drawLeaderOrderType() {
    return this._drawLeaderOrderType
  }
  set drawLeaderOrderType(value: number) {
    this._drawLeaderOrderType = value
  }

  /**
   * Gets the bit flags.
   */

  get bitFlags() {
    return this._bitFlags
  }
  set bitFlags(value: number) {
    this._bitFlags = value
  }

  /**
   * Gets the max leader segments points.
   */

  get maxLeaderSegmentsPoints() {
    return this._maxLeaderSegmentsPoints
  }
  set maxLeaderSegmentsPoints(value: number) {
    this._maxLeaderSegmentsPoints = value
  }

  /**
   * Gets the legacy alias of `maxLeaderSegmentsPoints`.
   */

  get maxLeaderSegmentPoints() {
    return this.maxLeaderSegmentsPoints
  }
  set maxLeaderSegmentPoints(value: number) {
    this.maxLeaderSegmentsPoints = value
  }

  /**
   * Gets the first segment angle constraint.
   */

  get firstSegmentAngleConstraint() {
    return this._firstSegmentAngleConstraint
  }
  set firstSegmentAngleConstraint(value: number) {
    this._firstSegmentAngleConstraint = value
  }

  /**
   * Gets the second segment angle constraint.
   */

  get secondSegmentAngleConstraint() {
    return this._secondSegmentAngleConstraint
  }
  set secondSegmentAngleConstraint(value: number) {
    this._secondSegmentAngleConstraint = value
  }

  /**
   * Gets the leader line type.
   */

  get leaderLineType() {
    return this._leaderLineType
  }
  set leaderLineType(value: number) {
    this._leaderLineType = value
  }

  /**
   * Gets the leader line color.
   */

  get leaderLineColor() {
    return this._leaderLineColor
  }
  set leaderLineColor(value: AcCmColor) {
    this._leaderLineColor.copy(value)
  }

  /**
   * Gets the leader line type id.
   */

  get leaderLineTypeId() {
    return this._leaderLineTypeId
  }
  set leaderLineTypeId(value: string | undefined) {
    this._leaderLineTypeId = value
  }

  /**
   * Gets the leader line weight.
   */

  get leaderLineWeight() {
    return this._leaderLineWeight
  }
  set leaderLineWeight(value: number) {
    this._leaderLineWeight = value
  }

  /**
   * Gets the enable landing.
   */

  get enableLanding() {
    return this._enableLanding
  }
  set enableLanding(value: boolean) {
    this._enableLanding = value
  }

  /**
   * Gets the alias of `enableLanding`.
   */

  get landingEnabled() {
    return this.enableLanding
  }
  set landingEnabled(value: boolean) {
    this.enableLanding = value
  }

  /**
   * Gets the landing gap.
   */

  get landingGap() {
    return this._landingGap
  }
  set landingGap(value: number) {
    this._landingGap = value
  }

  /**
   * Gets the enable dogleg.
   */

  get enableDogleg() {
    return this._enableDogleg
  }
  set enableDogleg(value: boolean) {
    this._enableDogleg = value
  }

  /**
   * Gets the alias of `enableDogleg`.
   */

  get doglegEnabled() {
    return this.enableDogleg
  }
  set doglegEnabled(value: boolean) {
    this.enableDogleg = value
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
   * Gets the description.
   */

  get description() {
    return this._description
  }
  set description(value: string) {
    this._description = value
  }

  /**
   * Gets the arrow symbol id.
   */

  get arrowSymbolId() {
    return this._arrowSymbolId
  }
  set arrowSymbolId(value: string | undefined) {
    this._arrowSymbolId = value
  }

  /**
   * Gets the alias of `arrowSymbolId`.
   */

  get arrowheadId() {
    return this.arrowSymbolId
  }
  set arrowheadId(value: string | undefined) {
    this.arrowSymbolId = value
  }

  /**
   * Gets the arrow size.
   */

  get arrowSize() {
    return this._arrowSize
  }
  set arrowSize(value: number) {
    this._arrowSize = value
  }

  /**
   * Gets the alias of `arrowSize`.
   */

  get arrowheadSize() {
    return this.arrowSize
  }
  set arrowheadSize(value: number) {
    this.arrowSize = value
  }

  /**
   * Gets the default mtext contents.
   */

  get defaultMTextContents() {
    return this._defaultMTextContents
  }
  set defaultMTextContents(value: string) {
    this._defaultMTextContents = value
  }

  /**
   * Gets the alias of `defaultMTextContents`.
   */

  get defaultMText() {
    return this.defaultMTextContents
  }
  set defaultMText(value: string) {
    this.defaultMTextContents = value
  }

  /**
   * Gets the alias of `defaultMTextContents`.
   */

  get textString() {
    return this.defaultMTextContents
  }
  set textString(value: string) {
    this.defaultMTextContents = value
  }

  /**
   * Gets the text style id.
   */

  get textStyleId() {
    return this._textStyleId
  }
  set textStyleId(value: string | undefined) {
    this._textStyleId = value
  }

  /**
   * Gets the alias of `textStyleId`.
   */

  get textStyle() {
    return this.textStyleId
  }
  set textStyle(value: string | undefined) {
    this.textStyleId = value
  }

  /**
   * Gets the text left attachment type.
   */

  get textLeftAttachmentType() {
    return this._textLeftAttachmentType
  }
  set textLeftAttachmentType(value: number) {
    this._textLeftAttachmentType = value
  }

  /**
   * Gets the text angle type.
   */

  get textAngleType() {
    return this._textAngleType
  }
  set textAngleType(value: number) {
    this._textAngleType = value
  }

  /**
   * Gets the text alignment type.
   */

  get textAlignmentType() {
    return this._textAlignmentType
  }
  set textAlignmentType(value: number) {
    this._textAlignmentType = value
  }

  /**
   * Gets the text right attachment type.
   */

  get textRightAttachmentType() {
    return this._textRightAttachmentType
  }
  set textRightAttachmentType(value: number) {
    this._textRightAttachmentType = value
  }

  /**
   * Gets the text color.
   */

  get textColor() {
    return this._textColor
  }
  set textColor(value: AcCmColor) {
    this._textColor.copy(value)
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
   * Gets the enable frame text.
   */

  get enableFrameText() {
    return this._enableFrameText
  }
  set enableFrameText(value: boolean) {
    this._enableFrameText = value
  }

  /**
   * Gets the alias of `enableFrameText`.
   */

  get textFrameEnabled() {
    return this.enableFrameText
  }
  set textFrameEnabled(value: boolean) {
    this.enableFrameText = value
  }

  /**
   * Gets the text align always left.
   */

  get textAlignAlwaysLeft() {
    return this._textAlignAlwaysLeft
  }
  set textAlignAlwaysLeft(value: boolean) {
    this._textAlignAlwaysLeft = value
  }

  /**
   * Gets the align space.
   */

  get alignSpace() {
    return this._alignSpace
  }
  set alignSpace(value: number) {
    this._alignSpace = value
  }

  /**
   * Gets the block id.
   */

  get blockId() {
    return this._blockId
  }
  set blockId(value: string | undefined) {
    this._blockId = value
  }

  /**
   * Gets the alias of `blockId`.
   */

  get blockContentId() {
    return this.blockId
  }
  set blockContentId(value: string | undefined) {
    this.blockId = value
  }

  /**
   * Gets the block color.
   */

  get blockColor() {
    return this._blockColor
  }
  set blockColor(value: AcCmColor) {
    this._blockColor.copy(value)
  }

  /**
   * Gets the alias of `blockColor`.
   */

  get blockContentColor() {
    return this.blockColor
  }
  set blockContentColor(value: AcCmColor) {
    this.blockColor = value
  }

  /**
   * Gets the block scale.
   */

  get blockScale() {
    return this._blockScale.clone()
  }
  set blockScale(value: AcGeVector3dLike) {
    this._blockScale.copy(value)
  }

  /**
   * Gets the alias of `blockScale`.
   */

  get blockContentScale() {
    return this.blockScale
  }
  set blockContentScale(value: AcGeVector3dLike) {
    this.blockScale = value
  }

  /**
   * Gets the enable block scale.
   */

  get enableBlockScale() {
    return this._enableBlockScale
  }
  set enableBlockScale(value: boolean) {
    this._enableBlockScale = value
  }

  /**
   * Gets the alias of `enableBlockScale`.
   */

  get blockContentScaleEnabled() {
    return this.enableBlockScale
  }
  set blockContentScaleEnabled(value: boolean) {
    this.enableBlockScale = value
  }

  /**
   * Gets the block rotation.
   */

  get blockRotation() {
    return this._blockRotation
  }
  set blockRotation(value: number) {
    this._blockRotation = value
  }

  /**
   * Gets the alias of `blockRotation`.
   */

  get blockContentRotation() {
    return this.blockRotation
  }
  set blockContentRotation(value: number) {
    this.blockRotation = value
  }

  /**
   * Gets the enable block rotation.
   */

  get enableBlockRotation() {
    return this._enableBlockRotation
  }
  set enableBlockRotation(value: boolean) {
    this._enableBlockRotation = value
  }

  /**
   * Gets the alias of `enableBlockRotation`.
   */

  get blockContentRotationEnabled() {
    return this.enableBlockRotation
  }
  set blockContentRotationEnabled(value: boolean) {
    this.enableBlockRotation = value
  }

  /**
   * Gets the block connection type.
   */

  get blockConnectionType() {
    return this._blockConnectionType
  }
  set blockConnectionType(value: number) {
    this._blockConnectionType = value
  }

  /**
   * Gets the alias of `blockConnectionType`.
   */

  get blockContentConnectionType() {
    return this.blockConnectionType
  }
  set blockContentConnectionType(value: number) {
    this.blockConnectionType = value
  }

  /**
   * Gets the scale.
   */

  get scale() {
    return this._scale
  }
  set scale(value: number) {
    this._scale = value
  }

  /**
   * Gets the alias of `scale`.
   */

  get scaleFactor() {
    return this.scale
  }
  set scaleFactor(value: number) {
    this.scale = value
  }

  /**
   * Gets the overwrite prop changed.
   */

  get overwritePropChanged() {
    return this._overwritePropChanged
  }
  set overwritePropChanged(value: boolean) {
    this._overwritePropChanged = value
  }

  /**
   * Gets the alias of `overwritePropChanged`.
   */

  get overwritePropertyValue() {
    return this.overwritePropChanged
  }
  set overwritePropertyValue(value: boolean) {
    this.overwritePropChanged = value
  }

  /**
   * Gets the annotative.
   */

  get annotative() {
    return this._annotative
  }
  set annotative(value: boolean) {
    this._annotative = value
  }

  /**
   * Gets the break size.
   */

  get breakSize() {
    return this._breakSize
  }
  set breakSize(value: number) {
    this._breakSize = value
  }

  /**
   * Gets the alias of `breakSize`.
   */

  get breakGapSize() {
    return this.breakSize
  }
  set breakGapSize(value: number) {
    this.breakSize = value
  }

  /**
   * Gets the text attachment direction.
   */

  get textAttachmentDirection() {
    return this._textAttachmentDirection
  }
  set textAttachmentDirection(value: number) {
    this._textAttachmentDirection = value
  }

  /**
   * Gets the bottom text attachment type.
   */

  get bottomTextAttachmentType() {
    return this._bottomTextAttachmentType
  }
  set bottomTextAttachmentType(value: number) {
    this._bottomTextAttachmentType = value
  }

  /**
   * Gets the alias of `bottomTextAttachmentType`.
   */

  get bottomTextAttachmentDirection() {
    return this.bottomTextAttachmentType
  }
  set bottomTextAttachmentDirection(value: number) {
    this.bottomTextAttachmentType = value
  }

  /**
   * Gets the top text attachment type.
   */

  get topTextAttachmentType() {
    return this._topTextAttachmentType
  }
  set topTextAttachmentType(value: number) {
    this._topTextAttachmentType = value
  }

  /**
   * Gets the alias of `topTextAttachmentType`.
   */

  get topTextAttachmentDirection() {
    return this.topTextAttachmentType
  }
  set topTextAttachmentDirection(value: number) {
    this.topTextAttachmentType = value
  }

  /**
   * Gets the extend leader to text.
   */

  get extendLeaderToText() {
    return this._extendLeaderToText
  }
  set extendLeaderToText(value: boolean) {
    this._extendLeaderToText = value
  }

  /**
   * Gets the second undocumented raw style value.
   */

  get unknown2() {
    return this._unknown2
  }
  set unknown2(value: boolean | undefined) {
    this._unknown2 = value
  }

  /**
   * Writes this MLeaderStyle object to DXF fields.
   *
   * @param filer DXF filer that receives serialized group codes.
   * @returns The current style instance for chaining.
   */
  override dxfOutFields(filer: AcDbDxfFiler) {
    super.dxfOutFields(filer)
    filer.writeSubclassMarker('AcDbMLeaderStyle')
    filer.writeInt16(179, this.unknown1)
    filer.writeInt16(170, this.contentType)
    filer.writeInt16(171, this.drawMLeaderOrderType)
    filer.writeInt16(172, this.drawLeaderOrderType)
    filer.writeInt32(90, this.maxLeaderSegmentsPoints)
    filer.writeDouble(40, this.firstSegmentAngleConstraint)
    filer.writeDouble(41, this.secondSegmentAngleConstraint)
    filer.writeInt16(173, this.leaderLineType)
    filer.writeInt32(91, encodeMLeaderStyleRawColor(this.leaderLineColor))
    filer.writeHandle(340, this.leaderLineTypeId)
    filer.writeInt32(92, this.leaderLineWeight)
    filer.writeBoolean(290, this.enableLanding)
    filer.writeDouble(42, this.landingGap)
    filer.writeBoolean(291, this.enableDogleg)
    filer.writeDouble(43, this.doglegLength)
    filer.writeString(3, this.description)
    filer.writeHandle(341, this.arrowSymbolId)
    filer.writeDouble(44, this.arrowSize)
    filer.writeString(300, this.defaultMTextContents)
    filer.writeHandle(342, this.textStyleId)
    filer.writeInt16(174, this.textLeftAttachmentType)
    filer.writeInt16(175, this.textAngleType)
    filer.writeInt16(176, this.textAlignmentType)
    filer.writeInt16(178, this.textRightAttachmentType)
    filer.writeInt32(93, encodeMLeaderStyleRawColor(this.textColor))
    filer.writeDouble(45, this.textHeight)
    filer.writeBoolean(292, this.enableFrameText)
    filer.writeBoolean(297, this.textAlignAlwaysLeft)
    filer.writeDouble(46, this.alignSpace)
    filer.writeHandle(343, this.blockId)
    filer.writeInt32(94, encodeMLeaderStyleRawColor(this.blockColor))
    filer.writeDouble(47, this._blockScale.x)
    filer.writeDouble(49, this._blockScale.y)
    filer.writeDouble(140, this._blockScale.z)
    filer.writeBoolean(293, this.enableBlockScale)
    filer.writeDouble(141, this.blockRotation)
    filer.writeBoolean(294, this.enableBlockRotation)
    filer.writeInt16(177, this.blockConnectionType)
    filer.writeDouble(142, this.scale)
    filer.writeBoolean(295, this.overwritePropChanged)
    filer.writeBoolean(296, this.annotative)
    filer.writeDouble(143, this.breakSize)
    filer.writeInt16(271, this.textAttachmentDirection)
    filer.writeInt16(272, this.bottomTextAttachmentType)
    filer.writeInt16(273, this.topTextAttachmentType)
    filer.writeBoolean(298, this.unknown2)
    return this
  }
}

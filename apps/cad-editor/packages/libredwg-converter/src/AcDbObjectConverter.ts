import {
  AcDbMLeaderStyle,
  AcDbObject,
  decodeMLeaderStyleRawColor
} from '@mlightcad/data-model'
import { DwgCommonObject, DwgMLeaderStyleObject } from '@mlightcad/libredwg-web'

/**
 * Converts libredwg object records to AcDbObject instances.
 */
export class AcDbObjectConverter {
  /**
   * Converts a DWG MLEADERSTYLE object to an AcDbMLeaderStyle.
   */
  convertMLeaderStyle(style: DwgMLeaderStyleObject) {
    const dbObject = new AcDbMLeaderStyle()
    dbObject.unknown1 = style.unknown1
    if (style.contentType != null) dbObject.contentType = style.contentType
    if (style.drawMLeaderOrderType != null) {
      dbObject.drawMLeaderOrderType = style.drawMLeaderOrderType
    }
    if (style.drawLeaderOrderType != null) {
      dbObject.drawLeaderOrderType = style.drawLeaderOrderType
    }
    if (style.maxLeaderSegmentPoints != null) {
      dbObject.maxLeaderSegmentPoints = style.maxLeaderSegmentPoints
    }
    if (style.firstSegmentAngleConstraint != null) {
      dbObject.firstSegmentAngleConstraint = style.firstSegmentAngleConstraint
    }
    if (style.secondSegmentAngleConstraint != null) {
      dbObject.secondSegmentAngleConstraint = style.secondSegmentAngleConstraint
    }
    if (style.leaderLineType != null) {
      dbObject.leaderLineType = style.leaderLineType
    }
    if (style.leaderLineColor != null) {
      dbObject.leaderLineColor = decodeMLeaderStyleRawColor(
        style.leaderLineColor
      )
    }
    dbObject.leaderLineTypeId = style.leaderLineTypeId
    if (style.leaderLineWeight != null) {
      dbObject.leaderLineWeight = style.leaderLineWeight
    }
    if (style.landingEnabled != null) {
      dbObject.landingEnabled = style.landingEnabled
    }
    if (style.landingGap != null) dbObject.landingGap = style.landingGap
    if (style.doglegEnabled != null)
      dbObject.doglegEnabled = style.doglegEnabled
    if (style.doglegLength != null) dbObject.doglegLength = style.doglegLength
    if (style.description != null) dbObject.description = style.description
    dbObject.arrowheadId = style.arrowheadId
    if (style.arrowheadSize != null)
      dbObject.arrowheadSize = style.arrowheadSize
    if (style.defaultMTextContents != null) {
      dbObject.defaultMTextContents = style.defaultMTextContents
    }
    dbObject.textStyleId = style.textStyleId
    if (style.textLeftAttachmentType != null) {
      dbObject.textLeftAttachmentType = style.textLeftAttachmentType
    }
    if (style.textAngleType != null)
      dbObject.textAngleType = style.textAngleType
    if (style.textAlignmentType != null) {
      dbObject.textAlignmentType = style.textAlignmentType
    }
    if (style.textRightAttachmentType != null) {
      dbObject.textRightAttachmentType = style.textRightAttachmentType
    }
    if (style.textColor != null) {
      dbObject.textColor = decodeMLeaderStyleRawColor(style.textColor)
    }
    if (style.textHeight != null) dbObject.textHeight = style.textHeight
    if (style.textFrameEnabled != null) {
      dbObject.textFrameEnabled = style.textFrameEnabled
    }
    if (style.textAlignAlwaysLeft != null) {
      dbObject.textAlignAlwaysLeft = style.textAlignAlwaysLeft
    }
    if (style.alignSpace != null) dbObject.alignSpace = style.alignSpace
    dbObject.blockContentId = style.blockContentId
    if (style.blockContentColor != null) {
      dbObject.blockContentColor = decodeMLeaderStyleRawColor(
        style.blockContentColor
      )
    }
    if (style.blockContentScale) {
      dbObject.blockContentScale = {
        x: style.blockContentScale.x,
        y: style.blockContentScale.y,
        z: style.blockContentScale.z ?? 1
      }
    }
    if (style.blockContentScaleEnabled != null) {
      dbObject.blockContentScaleEnabled = style.blockContentScaleEnabled
    }
    if (style.blockContentRotation != null) {
      dbObject.blockContentRotation = style.blockContentRotation
    }
    if (style.blockContentRotationEnabled != null) {
      dbObject.blockContentRotationEnabled = style.blockContentRotationEnabled
    }
    if (style.blockContentConnectionType != null) {
      dbObject.blockContentConnectionType = style.blockContentConnectionType
    }
    if (style.scale != null) dbObject.scale = style.scale
    if (style.overwritePropertyValue != null) {
      dbObject.overwritePropertyValue = style.overwritePropertyValue
    }
    if (style.annotative != null) dbObject.annotative = style.annotative
    if (style.breakGapSize != null) dbObject.breakGapSize = style.breakGapSize
    if (style.textAttachmentDirection != null) {
      dbObject.textAttachmentDirection = style.textAttachmentDirection
    }
    if (style.bottomTextAttachmentDirection != null) {
      dbObject.bottomTextAttachmentDirection =
        style.bottomTextAttachmentDirection
    }
    if (style.topTextAttachmentDirection != null) {
      dbObject.topTextAttachmentDirection = style.topTextAttachmentDirection
    }
    dbObject.unknown2 = style.unknown2
    this.processCommonAttrs(style, dbObject)
    return dbObject
  }

  private processCommonAttrs(object: DwgCommonObject, dbObject: AcDbObject) {
    dbObject.objectId = object.handle
    if (object.ownerHandle != null) {
      dbObject.ownerId = object.ownerHandle
    }
  }
}
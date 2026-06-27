import { AcCmColor } from '@mlightcad/data-model'
import {
  AcDbBlockTableRecord,
  AcDbLayout,
  AcDbMLeaderStyle,
  AcDbMlineStyle,
  AcDbObject,
  AcDbPlotPaperUnits,
  AcDbPlotRotation,
  AcDbPlotShadePlotResLevel,
  AcDbPlotShadePlotType,
  AcDbPlotStdScaleType,
  AcDbPlotType,
  AcDbRasterImageDef,
  decodeMLeaderStyleRawColor
} from '@mlightcad/data-model'
import {
  CommonDXFObject,
  ImageDefDXFObject,
  LayoutDXFObject,
  MLeaderStyleDXFObject,
  MLineStyleDXFObject,
  ParsedDxf
} from '@mlightcad/dxf-json/types'

/**
 * Converts DXF objects to AcDbObject instances.
 *
 * This class provides functionality to convert various DXF object types
 * (such as layouts and image definitions) into their corresponding
 * AcDbObject instances.
 *
 * @example
 * ```typescript
 * const converter = new AcDbObjectConverter();
 * const layout = converter.convertLayout(dxfLayout);
 * const imageDef = converter.convertImageDef(dxfImageDef);
 * ```
 */
export class AcDbObjectConverter {
  /**
   * Converts a DXF layout object to an AcDbLayout.
   *
   * @param layout - The DXF layout object to convert
   * @returns The converted AcDbLayout instance
   *
   * @example
   * ```typescript
   * const dxfLayout = { layoutName: 'Model', tabOrder: 1, ... };
   * const acDbLayout = converter.convertLayout(dxfLayout);
   * ```
   */
  convertLayout(layout: LayoutDXFObject, model: ParsedDxf) {
    const dbObject = new AcDbLayout()
    dbObject.layoutName = layout.layoutName
    dbObject.tabOrder = layout.tabOrder
    dbObject.plotSettingsName = layout.pageSetupName
    dbObject.plotCfgName = layout.configName
    dbObject.canonicalMediaName = layout.paperSize
    dbObject.plotViewName = layout.plotViewName
    dbObject.currentStyleSheet = layout.currentStyleSheet

    dbObject.plotPaperMargins = {
      left: layout.marginLeft,
      right: layout.marginRight,
      top: layout.marginTop,
      bottom: layout.marginBottom
    }
    dbObject.plotPaperSize.copy({
      x: layout.paperWidth,
      y: layout.paperHeight
    })
    dbObject.plotOrigin.copy({
      x: layout.plotOriginX,
      y: layout.plotOriginY
    })
    dbObject.plotWindowArea.min.copy({
      x: layout.windowAreaXMin,
      y: layout.windowAreaYMin
    })
    dbObject.plotWindowArea.max.copy({
      x: layout.windowAreaXMax,
      y: layout.windowAreaYMax
    })
    dbObject.customPrintScale = {
      numerator: layout.printScaleNumerator,
      denominator: layout.printScaleDenominator
    }

    dbObject.plotPaperUnits =
      layout.plotPaperUnit as unknown as AcDbPlotPaperUnits
    dbObject.plotRotation = layout.plotRotation as AcDbPlotRotation
    dbObject.plotType = layout.plotType as unknown as AcDbPlotType
    dbObject.stdScaleType = layout.standardScaleType as AcDbPlotStdScaleType
    dbObject.shadePlot = (() => {
      switch (layout.shadePlotMode) {
        case 1:
          return AcDbPlotShadePlotType.kWireframe
        case 2:
          return AcDbPlotShadePlotType.kHidden
        case 3:
          return AcDbPlotShadePlotType.kRendered
        default:
          return AcDbPlotShadePlotType.kAsDisplayed
      }
    })()
    dbObject.shadePlotResLevel = (() => {
      switch (layout.shadePlotResolution) {
        case 1:
          return AcDbPlotShadePlotResLevel.kPreview
        case 2:
          return AcDbPlotShadePlotResLevel.kNormal
        case 3:
          return AcDbPlotShadePlotResLevel.kPresentation
        case 4:
          return AcDbPlotShadePlotResLevel.kMaximum
        case 5:
          return AcDbPlotShadePlotResLevel.kCustom
        default:
          return AcDbPlotShadePlotResLevel.kDraft
      }
    })()
    if (layout.shadePlotCustomDPI != null) {
      dbObject.shadePlotCustomDPI = layout.shadePlotCustomDPI
    }
    if (layout.shadePlotId) {
      dbObject.shadePlotId = layout.shadePlotId
    }

    const flag = layout.layoutFlag ?? 0
    dbObject.plotViewportBorders = (flag & 1) !== 0
    dbObject.showPlotStyles = (flag & 2) !== 0
    dbObject.plotCentered = (flag & 4) !== 0
    dbObject.plotHidden = (flag & 8) !== 0
    dbObject.useStandardScale = (flag & 16) !== 0
    dbObject.plotPlotStyles = (flag & 32) !== 0
    dbObject.scaleLineweights = (flag & 64) !== 0
    dbObject.printLineweights = (flag & 128) !== 0
    dbObject.drawViewportsFirst = (flag & 512) !== 0
    dbObject.modelType = (flag & 1024) !== 0
    if (layout.viewportId) {
      dbObject.viewportArray.push(layout.viewportId)
    }

    if (layout.layoutName === 'Model') {
      // Upper case model space name
      const modelSpaceName = AcDbBlockTableRecord.MODEL_SPACE_NAME.toUpperCase()
      model.tables.BLOCK_RECORD?.entries.some(btr => {
        if (btr.name.toUpperCase() === modelSpaceName) {
          dbObject.blockTableRecordId = btr.handle
          return true
        }
        return false
      })
    } else {
      // layout.paperSpaceTableId doesn't point to the block table record asscicated with
      // this layout. So let's get the assocated block table record id from block table.
      model.tables.BLOCK_RECORD?.entries.some(btr => {
        if (btr.layoutObjects === layout.handle) {
          dbObject.blockTableRecordId = btr.handle
          return true
        }
        return false
      })

      // If blockTableRecordId value is still invalid, let's try to use
      // layout.paperSpaceTableId finally
      if (!dbObject.blockTableRecordId) {
        dbObject.blockTableRecordId = layout.paperSpaceTableId
      }
    }

    if (layout.minLimit) {
      dbObject.limits.min.copy(layout.minLimit)
    }
    if (layout.maxLimit) {
      dbObject.limits.max.copy(layout.maxLimit)
    }
    if (layout.minExtent) {
      dbObject.extents.min.copy(layout.minExtent)
    }
    if (layout.maxExtent) {
      dbObject.extents.max.copy(layout.maxExtent)
    }
    this.processCommonAttrs(layout, dbObject)
    return dbObject
  }

  /**
   * Converts a DXF image definition object to an AcDbRasterImageDef.
   *
   * @param image - The DXF image definition object to convert
   * @returns The converted AcDbRasterImageDef instance
   *
   * @example
   * ```typescript
   * const dxfImageDef = { fileName: 'image.jpg', ... };
   * const acDbImageDef = converter.convertImageDef(dxfImageDef);
   * ```
   */
  convertImageDef(image: ImageDefDXFObject) {
    const dbObject = new AcDbRasterImageDef()
    dbObject.sourceFileName = image.fileName
    this.processCommonAttrs(image, dbObject)
    return dbObject
  }

  /**
   * Converts a DXF mleader style object to an AcDbMLeaderStyle.
   */
  convertMLeaderStyle(style: MLeaderStyleDXFObject) {
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

  /**
   * Converts a DXF mline style object to an AcDbMlineStyle.
   */
  convertMLineStyle(style: MLineStyleDXFObject) {
    const dbObject = new AcDbMlineStyle()
    if (style.styleName != null) dbObject.styleName = style.styleName
    if (style.flags != null) dbObject.flags = style.flags
    if (style.description != null) dbObject.description = style.description
    if (style.fillColor != null) {
      dbObject.fillColor = new AcCmColor().setRGBValue(style.fillColor)
    } else if (style.fillColorIndex != null) {
      const fillColor = new AcCmColor()
      fillColor.colorIndex = style.fillColorIndex
      dbObject.fillColor = fillColor
    }
    if (style.startAngle != null) dbObject.startAngle = style.startAngle
    if (style.endAngle != null) dbObject.endAngle = style.endAngle

    const elementCount = Math.max(
      style.elementCount ?? 0,
      style.elements?.length ?? 0
    )

    if (elementCount > 0) {
      dbObject.elements = Array.from({ length: elementCount }, (_, index) => ({
        offset: style.elements?.[index]?.offset ?? 0,
        color: (() => {
          const color = new AcCmColor()
          if (style.elements?.[index]?.color != null) {
            color.setRGBValue(style.elements[index]!.color)
          } else {
            color.colorIndex = style.elements?.[index]?.colorIndex ?? 256
          }
          return color
        })(),
        lineType: style.elements?.[index]?.lineType ?? 'BYLAYER'
      }))
    }

    this.processCommonAttrs(style, dbObject)
    return dbObject
  }

  /**
   * Processes common attributes from a DXF object to an AcDbObject.
   *
   * This method copies common properties like object ID and owner ID
   * from the DXF object to the corresponding AcDbObject.
   *
   * @param object - The source DXF object
   * @param dbObject - The target AcDbObject to populate
   *
   * @example
   * ```typescript
   * converter.processCommonAttrs(dxfObject, acDbObject);
   * ```
   */
  private processCommonAttrs(object: CommonDXFObject, dbObject: AcDbObject) {
    dbObject.objectId = object.handle
    if (object.ownerObjectId != null) {
      dbObject.ownerId = object.ownerObjectId
    }
  }
}

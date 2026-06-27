import { AcGePoint3dLike, AcGeVector3dLike } from '@mlightcad/geometry-engine'

export enum AcGiMTextFlowDirection {
  LEFT_TO_RIGHT = 1,
  RIGHT_TO_LEFT = 2,
  TOP_TO_BOTTOM = 3,
  BOTTOM_TO_TOP = 4,
  BY_STYLE = 5
}

/**
 * Anchor position used to align rendered MText/Text relative to its
 * insertion point.
 *
 * Values 1-9 mirror the DXF MText attachment point (group code 71).
 * Values 10-12 are extensions used by AutoCAD TEXT/ATTRIB entities whose
 * vertical alignment is the typographic baseline (DXF group 73 = 0). The
 * baseline sits slightly above the bbox bottom by the descender height;
 * for SHX fonts the descender is negligible, so renderers may treat
 * `Baseline*` and `Bottom*` identically as a first approximation.
 */
export enum AcGiMTextAttachmentPoint {
  TopLeft = 1,
  TopCenter = 2,
  TopRight = 3,
  MiddleLeft = 4,
  MiddleCenter = 5,
  MiddleRight = 6,
  BottomLeft = 7,
  BottomCenter = 8,
  BottomRight = 9,
  /** Baseline-left point (for DXF TEXT/ATTRIB with valign=BASELINE). */
  BaselineLeft = 10,
  /** Baseline-center point. */
  BaselineCenter = 11,
  /** Baseline-right point. */
  BaselineRight = 12
}

export interface AcGiMTextData {
  text: string
  height: number
  width: number
  position: AcGePoint3dLike
  rotation?: number
  directionVector?: AcGeVector3dLike
  attachmentPoint?: AcGiMTextAttachmentPoint
  drawingDirection?: AcGiMTextFlowDirection
  lineSpaceFactor?: number
  widthFactor?: number
}

export interface AcGiTextStyle {
  name: string
  standardFlag: number
  fixedTextHeight: number
  widthFactor: number
  obliqueAngle: number
  textGenerationFlag: number
  lastHeight: number
  font: string
  bigFont: string
  extendedFont?: string
}

import {
  AcGeBox3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiMTextAttachmentPoint } from '@mlightcad/graphic-interface'

const CHAR_WIDTH_FACTOR = 1

/** `\Ffont|params;symbol` tolerance/GDT inline font override including symbol char. */
const TOLERANCE_INLINE_FONT_PATTERN = /\\[fF][^\\|{}]*(?:\|[^;\\|{}]*)*;./i
const TOLERANCE_INLINE_FONT_PATTERN_GLOBAL =
  /\\[fF][^\\|{}]*(?:\|[^;\\|{}]*)*;./gi

/**
 * Strips MTEXT control codes and returns plain text for width/line estimation.
 */
export function acdbStripMTextControlCodes(text: string): string {
  return text
    .replace(/\\[PpNn]/g, '\n')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
}

/**
 * Escapes plain text so it renders literally through MTEXT (no control codes).
 *
 * Windows paths are the common case: `\Pictures` would otherwise become a
 * paragraph break (`\P`) plus `ictures`, and `\Screenshots` would start a
 * stack (`\S`) — exactly the garbled missing-image frame labels.
 */
export function acdbEscapePlainTextForMText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/([{}])/g, '\\$1')
}

/**
 * Strips tolerance cell formatting and returns measurable plain text.
 *
 * GDT font codes such as `{\Fgdt;r}` or `{\Fgdt;n}0.05` embed a single symbol
 * character after the font name. That glyph must not contribute to ASCII width
 * estimation because it is rendered from the GDT SHX font, not the text style.
 */
export function acdbStripToleranceCellTextForWidth(text: string): string {
  return text
    .replace(/\\[PpNn]/g, '\n')
    .replace(TOLERANCE_INLINE_FONT_PATTERN_GLOBAL, '')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

/**
 * Estimates the rendered width of one tolerance frame cell.
 */
export function acdbEstimateToleranceCellWidth(
  cellText: string,
  textHeight: number,
  widthFactor = 1
): number {
  const trimmed = cellText.trim()
  if (!trimmed || textHeight <= 0) {
    return 0
  }

  const measurableText = acdbStripToleranceCellTextForWidth(trimmed)
  const hasInlineFont = TOLERANCE_INLINE_FONT_PATTERN.test(trimmed)

  if (!measurableText) {
    return hasInlineFont ? textHeight : 0
  }

  return Math.max(
    textHeight,
    acdbEstimatePlainTextWidth(measurableText, textHeight, widthFactor)
  )
}

/**
 * Estimates rendered text width from plain text length and height.
 */
export function acdbEstimatePlainTextWidth(
  text: string,
  textHeight: number,
  widthFactor = 1
): number {
  if (!text || textHeight <= 0) return 0

  const plainText = acdbStripMTextControlCodes(text)
  const longestLineLength = Math.max(
    ...plainText.split(/\r\n|\r|\n/g).map(line => line.length),
    0
  )
  if (longestLineLength === 0) return 0

  return Math.max(
    textHeight,
    longestLineLength * textHeight * CHAR_WIDTH_FACTOR * widthFactor
  )
}

/**
 * Counts logical MTEXT lines after control-code normalization.
 */
export function acdbCountMTextLines(text: string): number {
  const plainText = acdbStripMTextControlCodes(text)
  return Math.max(plainText.split(/\r\n|\r|\n/g).length, 1)
}

/**
 * Estimates total MTEXT height from line count and line-spacing factor.
 *
 * Baseline distance starts as `lineSpacingFactor × (5/3) × textHeight`
 * (DXF group 44; single spacing is factor `1`). At Least (DXF group 73 = `0`
 * or `1`, the default) grows that distance when it is tighter than the text
 * height, so nominal glyphs do not overlap. Exact (`2`) keeps the factor
 * spacing. This estimate does not measure per-glyph overflow above the text
 * height.
 */
export function acdbEstimateMTextHeight(
  lineCount: number,
  textHeight: number,
  lineSpacingFactor: number,
  lineSpacingStyle: number = 1
): number {
  if (textHeight <= 0 || lineCount <= 0) return 0
  if (lineCount === 1) return textHeight

  const factorSpacing = Math.max(lineSpacingFactor, 0) * (5 / 3)
  const spacing =
    lineSpacingStyle === 2 ? factorSpacing : Math.max(factorSpacing, 1)
  return textHeight + (lineCount - 1) * textHeight * spacing
}

interface LocalBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Returns axis-aligned bounds in text-local coordinates relative to the attachment anchor.
 */
export function acdbGetLocalBoundsFromAttachment(
  width: number,
  height: number,
  attachment: AcGiMTextAttachmentPoint
): LocalBounds {
  switch (attachment) {
    case AcGiMTextAttachmentPoint.TopCenter:
      return {
        minX: -width / 2,
        minY: -height,
        maxX: width / 2,
        maxY: 0
      }
    case AcGiMTextAttachmentPoint.TopRight:
      return { minX: -width, minY: -height, maxX: 0, maxY: 0 }
    case AcGiMTextAttachmentPoint.MiddleLeft:
      return {
        minX: 0,
        minY: -height / 2,
        maxX: width,
        maxY: height / 2
      }
    case AcGiMTextAttachmentPoint.MiddleCenter:
      return {
        minX: -width / 2,
        minY: -height / 2,
        maxX: width / 2,
        maxY: height / 2
      }
    case AcGiMTextAttachmentPoint.MiddleRight:
      return {
        minX: -width,
        minY: -height / 2,
        maxX: 0,
        maxY: height / 2
      }
    case AcGiMTextAttachmentPoint.BottomLeft:
    case AcGiMTextAttachmentPoint.BaselineLeft:
      return { minX: 0, minY: 0, maxX: width, maxY: height }
    case AcGiMTextAttachmentPoint.BottomCenter:
    case AcGiMTextAttachmentPoint.BaselineCenter:
      return {
        minX: -width / 2,
        minY: 0,
        maxX: width / 2,
        maxY: height
      }
    case AcGiMTextAttachmentPoint.BottomRight:
    case AcGiMTextAttachmentPoint.BaselineRight:
      return { minX: -width, minY: 0, maxX: 0, maxY: height }
    case AcGiMTextAttachmentPoint.TopLeft:
    default:
      return { minX: 0, minY: -height, maxX: width, maxY: 0 }
  }
}

/**
 * Builds orthonormal text axes from rotation and/or direction.
 *
 * When `direction` is provided and non-zero it defines the local X axis;
 * otherwise X is derived from `rotation` in the XY plane. Y is the
 * counter-clockwise perpendicular to X.
 *
 * @param rotation - Text rotation in radians, used when direction is absent.
 * @param direction - Optional direction vector overriding rotation.
 * @returns Normalized local X and Y axis vectors.
 * @internal
 */
function getTextAxes(rotation: number, direction?: AcGeVector3d) {
  let xAxis: AcGeVector3d
  if (direction && direction.lengthSq() > 0) {
    xAxis = direction.clone().normalize()
  } else {
    xAxis = new AcGeVector3d(Math.cos(rotation), Math.sin(rotation), 0)
  }

  const yAxis = new AcGeVector3d(-xAxis.y, xAxis.x, xAxis.z)
  if (yAxis.lengthSq() === 0) {
    yAxis.set(0, 1, 0)
  } else {
    yAxis.normalize()
  }

  return { xAxis, yAxis }
}

/**
 * Expands a box with an oriented text rectangle anchored at `anchor`.
 */
export function acdbExpandBoxByOrientedTextRect(
  box: AcGeBox3d,
  anchor: AcGePoint3dLike,
  width: number,
  height: number,
  attachment: AcGiMTextAttachmentPoint,
  rotation = 0,
  direction?: AcGeVector3dLike
) {
  if (width <= 0 && height <= 0) {
    box.expandByPoint(anchor)
    return box
  }

  const bounds = acdbGetLocalBoundsFromAttachment(width, height, attachment)
  const { xAxis, yAxis } = getTextAxes(
    rotation,
    direction
      ? new AcGeVector3d(direction.x, direction.y, direction.z || 0)
      : undefined
  )

  const corners: Array<[number, number]> = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY]
  ]

  for (const [localX, localY] of corners) {
    box.expandByPoint(
      new AcGePoint3d(
        anchor.x + xAxis.x * localX + yAxis.x * localY,
        anchor.y + xAxis.y * localX + yAxis.y * localY,
        anchor.z + xAxis.z * localX + yAxis.z * localY
      )
    )
  }

  return box
}

/**
 * Resolved layout metrics for an oriented MTEXT rectangle.
 *
 * All width/height values are expressed in drawing units. Local axes follow
 * AutoCAD MTEXT semantics: the X axis aligns with {@link AcDbMTextLayoutMetrics.direction}
 * (or {@link AcDbMTextLayoutMetrics.rotation} when direction is unset), and the Y axis
 * is the 90-degree counter-clockwise perpendicular in the text plane.
 */
export interface AcDbMTextLayoutMetrics {
  /** Effective text width used for layout, preferring actual extents when available. */
  width: number
  /** Estimated total text height from line count and line spacing. */
  height: number
  /** Attachment point that anchors the local bounds to {@link AcDbMTextLayoutMetrics.location}. */
  attachment: AcGiMTextAttachmentPoint
  /** Rotation angle in radians relative to the text OCS X axis. */
  rotation: number
  /** Optional direction vector overriding {@link AcDbMTextLayoutMetrics.rotation}. */
  direction?: AcGeVector3d
  /** Insertion/anchor point of the MTEXT entity in world coordinates. */
  location: AcGePoint3d
}

/**
 * Padding applied in MTEXT-local coordinates when scoring annotation association.
 *
 * Padding extends the oriented text bounds along local axes:
 * `padX` on local X, `padYAbove` toward local +Y, and `padYBelow` toward local -Y.
 */
export interface AcDbMTextAssociationPadding {
  /** Extra tolerance along the local X axis on both sides of the text bounds. */
  padX: number
  /** Extra tolerance toward local +Y (above the oriented top edge). */
  padYAbove: number
  /** Extra tolerance toward local -Y (below the oriented bottom edge). */
  padYBelow: number
}

/**
 * Resolves oriented MTEXT layout metrics used for association and hook-line math.
 *
 * Width resolution order matches {@link AcDbMText.geometricExtents}:
 * `extentsWidth` → `width` → estimated plain-text width.
 *
 * @param input - Raw MTEXT properties used to derive oriented layout metrics.
 * @param input.contents - MTEXT contents, used for line-count and width estimation.
 * @param input.height - Text height in drawing units.
 * @param input.width - Reference/wrap width from the entity.
 * @param input.extentsWidth - Cached actual rendered width from the source file.
 * @param input.lineSpacingFactor - Line spacing factor (DXF group 44 semantics).
 * @param input.lineSpacingStyle - Line spacing style (DXF group 73). `2` is Exact;
 *   omitted, `0`, and `1` are At Least.
 * @param input.attachmentPoint - Attachment point for local bound anchoring.
 * @param input.rotation - Text rotation in radians.
 * @param input.direction - Text direction vector; takes precedence over rotation when non-zero.
 * @param input.location - MTEXT insertion point in world coordinates.
 * @returns Normalized layout metrics with cloned direction/location values.
 */
export function acdbResolveMTextLayoutMetrics(input: {
  contents: string
  height: number
  width: number
  extentsWidth: number
  lineSpacingFactor: number
  lineSpacingStyle?: number
  attachmentPoint: AcGiMTextAttachmentPoint
  rotation: number
  direction: AcGeVector3d
  location: AcGePoint3dLike
}): AcDbMTextLayoutMetrics {
  const width =
    input.extentsWidth > 0
      ? input.extentsWidth
      : input.width > 0
        ? input.width
        : acdbEstimatePlainTextWidth(input.contents, input.height)
  const height = acdbEstimateMTextHeight(
    acdbCountMTextLines(input.contents),
    input.height,
    input.lineSpacingFactor,
    input.lineSpacingStyle ?? 1
  )

  return {
    width,
    height,
    attachment: input.attachmentPoint,
    rotation: input.rotation,
    direction:
      input.direction.lengthSq() > 0 ? input.direction.clone() : undefined,
    location: new AcGePoint3d(
      input.location.x,
      input.location.y,
      input.location.z ?? 0
    )
  }
}

/**
 * Converts a world-space point into MTEXT-local coordinates.
 *
 * Local X/Y are dot-product projections onto the oriented text axes derived
 * from {@link AcDbMTextLayoutMetrics.rotation} and
 * {@link AcDbMTextLayoutMetrics.direction}.
 *
 * @param point - Point to convert, typically a leader landing vertex.
 * @param layout - Resolved MTEXT layout metrics.
 * @returns Local coordinates `{ x, y }` relative to {@link AcDbMTextLayoutMetrics.location}.
 */
export function acdbWorldPointToMTextLocal(
  point: AcGePoint3dLike,
  layout: AcDbMTextLayoutMetrics
): { x: number; y: number } {
  const { xAxis, yAxis } = getTextAxes(layout.rotation, layout.direction)
  const dx = point.x - layout.location.x
  const dy = point.y - layout.location.y
  const dz = (point.z ?? 0) - layout.location.z

  return {
    x: dx * xAxis.x + dy * xAxis.y + dz * xAxis.z,
    y: dx * yAxis.x + dy * yAxis.y + dz * yAxis.z
  }
}

/**
 * Returns the four corners of an oriented MTEXT rectangle in world space.
 *
 * Corners are ordered counter-clockwise starting from
 * `(minX, minY)` in local coordinates.
 *
 * @param layout - Resolved MTEXT layout metrics.
 * @returns World-space corner points of the oriented text bounds.
 */
export function acdbCollectMTextOrientedCorners(
  layout: AcDbMTextLayoutMetrics
): AcGePoint3d[] {
  const bounds = acdbGetLocalBoundsFromAttachment(
    layout.width,
    layout.height,
    layout.attachment
  )
  const { xAxis, yAxis } = getTextAxes(layout.rotation, layout.direction)
  const localCorners: Array<[number, number]> = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY]
  ]

  return localCorners.map(
    ([localX, localY]) =>
      new AcGePoint3d(
        layout.location.x + xAxis.x * localX + yAxis.x * localY,
        layout.location.y + xAxis.y * localX + yAxis.y * localY,
        layout.location.z + xAxis.z * localX + yAxis.z * localY
      )
  )
}

/**
 * Scores how closely one world point matches an oriented MTEXT annotation.
 *
 * The score is the Manhattan distance from the point to the inner text bounds
 * in local coordinates. A score of `0` means the point lies inside the
 * oriented bounds; larger values indicate proximity within the padded region.
 *
 * @param point - Candidate association point, usually a leader landing vertex.
 * @param layout - Resolved MTEXT layout metrics.
 * @param padding - Local-axis padding applied before rejecting a candidate.
 * @returns Association score, or `null` when the point is outside padded bounds.
 */
export function acdbScorePointAgainstMTextLayout(
  point: AcGePoint3dLike,
  layout: AcDbMTextLayoutMetrics,
  padding: AcDbMTextAssociationPadding
): number | null {
  const bounds = acdbGetLocalBoundsFromAttachment(
    layout.width,
    layout.height,
    layout.attachment
  )
  const { x: localX, y: localY } = acdbWorldPointToMTextLocal(point, layout)

  const minX = bounds.minX - padding.padX
  const maxX = bounds.maxX + padding.padX
  const minY = bounds.minY - padding.padYBelow
  const maxY = bounds.maxY + padding.padYAbove

  if (localX < minX || localX > maxX || localY < minY || localY > maxY) {
    return null
  }

  const dx =
    localX < bounds.minX
      ? bounds.minX - localX
      : localX > bounds.maxX
        ? bounds.maxX - localX
        : 0
  const dy =
    localY < bounds.minY
      ? bounds.minY - localY
      : localY > bounds.maxY
        ? localY - bounds.maxY
        : 0

  return dx + dy
}

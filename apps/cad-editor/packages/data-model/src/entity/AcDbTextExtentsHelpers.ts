import {
  AcGeBox3d,
  AcGePoint3d,
  AcGePoint3dLike,
  AcGeVector3d,
  AcGeVector3dLike
} from '@mlightcad/geometry-engine'
import { AcGiMTextAttachmentPoint } from '@mlightcad/graphic-interface'

const CHAR_WIDTH_FACTOR = 1

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
 * Line spacing factor multiplies text height to get the distance between
 * consecutive line baselines (AutoCAD DXF group 44 semantics).
 */
export function acdbEstimateMTextHeight(
  lineCount: number,
  textHeight: number,
  lineSpacingFactor: number
): number {
  if (textHeight <= 0 || lineCount <= 0) return 0
  if (lineCount === 1) return textHeight

  const spacing = Math.max(lineSpacingFactor, 0)
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

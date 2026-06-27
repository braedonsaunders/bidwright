import { AcCmColor } from '@mlightcad/common'
import { AcGePoint2dLike } from '@mlightcad/geometry-engine'

export interface AcGiHatchPatternLine {
  angle: number
  base: AcGePoint2dLike
  offset: AcGePoint2dLike
  dashLengths: number[]
}

export interface AcGiHatchGradientStyle {
  name: string
  angle: number
  shift: number
  oneColorMode: boolean
  shadeTintValue: number
  startColor?: number
  endColor?: number
}

/**
 * Hatch style
 */
export interface AcGiHatchStyle {
  solidFill: boolean
  patternAngle: number
  definitionLines: AcGiHatchPatternLine[]
  backgroundColor?: AcCmColor
  gradient?: AcGiHatchGradientStyle
}

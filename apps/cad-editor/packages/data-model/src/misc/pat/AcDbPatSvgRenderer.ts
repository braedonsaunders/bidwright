import { AcGeMathUtil } from '@mlightcad/geometry-engine'

import type { AcDbGradientName } from '../../entity/AcDbHatch'
import { HATCH_PATTERN_SOLID } from '../AcDbConstants'
import type {
  AcDbPatLine,
  AcDbPatPattern,
  AcDbPatPreviewOptions
} from './AcDbPatDefinition'

/**
 * A concrete drawable segment used as an intermediate representation before
 * serializing linework into SVG path commands.
 */
interface AcDbPatSvgSegment {
  /** Segment start X coordinate in renderer space. */
  x1: number
  /** Segment start Y coordinate in renderer space. */
  y1: number
  /** Segment end X coordinate in renderer space. */
  x2: number
  /** Segment end Y coordinate in renderer space. */
  y2: number
}

export type AcDbPatGradientColor = number | string

/**
 * Optional preview options when rendering an AutoCAD hatch gradient to SVG.
 */
export interface AcDbPatGradientPreviewOptions {
  /**
   * SVG viewport width in pixels.
   */
  width?: number

  /**
   * SVG viewport height in pixels.
   */
  height?: number

  /**
   * First gradient color.
   *
   * A number is treated as packed RGB (`0xRRGGBB`). A string is emitted as a
   * CSS color value.
   */
  startColor?: AcDbPatGradientColor

  /**
   * Second gradient color.
   *
   * A number is treated as packed RGB (`0xRRGGBB`). A string is emitted as a
   * CSS color value.
   */
  endColor?: AcDbPatGradientColor

  /**
   * Background fill color shown behind the gradient rectangle.
   */
  background?: string

  /**
   * Gradient angle in radians, matching {@link AcDbHatch.gradientAngle}.
   */
  angle?: number

  /**
   * Relative shift applied to the gradient focus or midpoint.
   */
  shift?: number

  /**
   * Whether the gradient uses one base color plus a shade/tint variant.
   */
  oneColorMode?: boolean

  /**
   * Shade/tint value used in one-color mode. `0` maps to black, `0.5` keeps the
   * base color, and `1` maps to white.
   */
  shadeTintValue?: number
}

interface AcDbPatSvgGradientColors {
  start: string
  end: string
}

interface AcDbPatSvgGradientStop {
  offset: number
  color: string
}

/**
 * Renders an {@link AcDbPatPattern} into a standalone SVG preview string.
 *
 * The renderer normalizes pattern units to pixels, expands each hatch line
 * family to cover the viewport, resolves dash/gap sequences into explicit
 * segments, and emits a compact `<svg>` document.
 */
export class AcDbPatSvgRenderer {
  /** Numerical tolerance used to avoid division-by-zero and near-zero noise. */
  private static readonly EPSILON = 1e-9
  private static gradientIdCounter = 0

  /**
   * Builds an SVG-local ID that avoids collisions when multiple previews are
   * injected into the same document.
   *
   * @param name - Gradient pattern name.
   * @returns Unique gradient ID.
   */
  private static nextGradientId(name: string) {
    AcDbPatSvgRenderer.gradientIdCounter += 1
    return `acdb-pat-gradient-${name.toLowerCase()}-${AcDbPatSvgRenderer.gradientIdCounter}`
  }

  /**
   * Converts a packed RGB value to a CSS hex color.
   *
   * @param rgb - Packed RGB value.
   * @returns CSS hex color.
   */
  private static packedRgbToCss(rgb: number) {
    return `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`
  }

  /**
   * Converts either packed RGB or CSS color input to a CSS color string.
   *
   * @param color - Source color.
   * @param fallback - Color used when source is undefined.
   * @returns CSS color.
   */
  private static gradientColorToCss(
    color: AcDbPatGradientColor | undefined,
    fallback: string
  ) {
    return typeof color === 'number'
      ? AcDbPatSvgRenderer.packedRgbToCss(color)
      : (color ?? fallback)
  }

  /**
   * Computes the shade/tint variant used by one-color gradient hatches.
   *
   * @param rgb - Packed base RGB value.
   * @param shadeTintValue - Interpolation from black (`0`) through base
   * (`0.5`) to white (`1`).
   * @returns Packed RGB shade/tint value.
   */
  private static applyShadeTint(rgb: number, shadeTintValue: number) {
    const value = AcGeMathUtil.clamp(shadeTintValue, 0, 1)
    const target = value < 0.5 ? 0x000000 : 0xffffff
    const amount = value < 0.5 ? 1 - value * 2 : value * 2 - 1
    const r = (rgb >> 16) & 0xff
    const g = (rgb >> 8) & 0xff
    const b = rgb & 0xff
    const targetR = (target >> 16) & 0xff
    const targetG = (target >> 8) & 0xff
    const targetB = target & 0xff

    return (
      Math.round(r + (targetR - r) * amount) * 0x10000 +
      Math.round(g + (targetG - g) * amount) * 0x100 +
      Math.round(b + (targetB - b) * amount)
    )
  }

  /**
   * Resolves the two CSS colors used by gradient stops.
   *
   * @param options - Gradient preview options.
   * @returns CSS start and end colors.
   */
  private static resolveGradientColors(
    options: AcDbPatGradientPreviewOptions
  ): AcDbPatSvgGradientColors {
    const fallbackStart = '#2563eb'
    const fallbackEnd = '#f8fafc'
    const start = AcDbPatSvgRenderer.gradientColorToCss(
      options.startColor,
      fallbackStart
    )

    if (options.oneColorMode && options.endColor == null) {
      if (typeof options.startColor === 'number') {
        const tinted = AcDbPatSvgRenderer.applyShadeTint(
          options.startColor,
          options.shadeTintValue ?? 0.5
        )
        return {
          start,
          end: AcDbPatSvgRenderer.packedRgbToCss(tinted)
        }
      }

      return {
        start,
        end: (options.shadeTintValue ?? 0.5) < 0.5 ? '#000000' : '#ffffff'
      }
    }

    return {
      start,
      end: AcDbPatSvgRenderer.gradientColorToCss(options.endColor, fallbackEnd)
    }
  }

  /**
   * Converts normalized stop data to SVG `<stop>` elements.
   *
   * @param stops - Gradient stops.
   * @returns SVG stop markup.
   */
  private static renderGradientStops(stops: AcDbPatSvgGradientStop[]) {
    return stops
      .map(stop => {
        const offset = AcGeMathUtil.clamp(stop.offset, 0, 1) * 100
        return `<stop offset="${offset.toFixed(2)}%" stop-color="${stop.color}" />`
      })
      .join('')
  }

  /**
   * Gets the SVG coordinate direction for a gradient angle.
   *
   * @param angle - Angle in radians, measured in CAD coordinates.
   * @returns Unit vector in SVG coordinates.
   */
  private static getGradientVector(angle: number) {
    return {
      x: Math.cos(angle),
      y: -Math.sin(angle)
    }
  }

  /**
   * Checks whether a pattern is the reserved AutoCAD solid-fill pattern.
   *
   * `SOLID` has no PAT line descriptors; its preview is an area fill instead
   * of generated hatch linework.
   *
   * @param pattern - Pattern to inspect.
   * @returns `true` when the pattern name resolves to `SOLID`.
   */
  private static isSolidPattern(pattern: AcDbPatPattern) {
    return pattern.name.trim().toUpperCase() === HATCH_PATTERN_SOLID
  }

  /**
   * Renders an SVG background rectangle.
   *
   * @param width - SVG viewport width in pixels.
   * @param height - SVG viewport height in pixels.
   * @param background - CSS fill for the preview background.
   * @returns SVG `<rect>` markup.
   */
  private static renderBackground(
    width: number,
    height: number,
    background: string
  ) {
    return `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="${background}" />`
  }

  /**
   * Estimates a representative unit length for the pattern.
   *
   * The current strategy samples delta vectors and dash lengths, removes
   * near-zero values, and uses the median as a robust scale anchor.
   *
   * @param pattern - Pattern whose geometric magnitudes are sampled.
   * @returns Estimated pattern unit size. Falls back to `1` if no usable
   * samples exist.
   */
  private static estimateUnitScale(pattern: AcDbPatPattern) {
    const samples: number[] = []
    for (const line of pattern.lines) {
      samples.push(Math.abs(line.deltaX), Math.abs(line.deltaY))
      for (const dash of line.dashes) {
        samples.push(Math.abs(dash))
      }
    }
    const filtered = samples.filter(
      sample => sample > AcDbPatSvgRenderer.EPSILON
    )
    if (filtered.length === 0) return 1
    const sorted = filtered.sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] || 1
  }

  /**
   * Converts a geometric segment into a single SVG `M ... L ...` path command.
   *
   * SVG Y coordinates are inverted to match the pattern coordinate convention.
   *
   * @param segment - Segment to serialize.
   * @returns SVG path fragment for the segment.
   */
  private static segmentToSvgPath(segment: AcDbPatSvgSegment) {
    return `M ${segment.x1.toFixed(2)} ${(-segment.y1).toFixed(2)} L ${segment.x2.toFixed(2)} ${(-segment.y2).toFixed(2)}`
  }

  /**
   * Expands a hatch line and its dash definition into concrete drawable
   * segments within a finite interval.
   *
   * Dash rule:
   * - `> 0`: drawn segment
   * - `< 0`: gap
   * - `= 0`: dot (rendered as a very short segment for visibility)
   *
   * @param line - Hatch line definition containing dash sequence.
   * @param startAlong - Interval start on the line direction axis.
   * @param endAlong - Interval end on the line direction axis.
   * @param originX - Line family origin X coordinate.
   * @param originY - Line family origin Y coordinate.
   * @param dirX - Unit direction vector X component.
   * @param dirY - Unit direction vector Y component.
   * @returns Drawable segments clipped to `[startAlong, endAlong]`.
   */
  private static buildDashSegments(
    line: AcDbPatLine,
    startAlong: number,
    endAlong: number,
    originX: number,
    originY: number,
    dirX: number,
    dirY: number
  ) {
    const dashes = line.dashes
    if (dashes.length === 0) {
      return [
        {
          x1: originX + dirX * startAlong,
          y1: originY + dirY * startAlong,
          x2: originX + dirX * endAlong,
          y2: originY + dirY * endAlong
        }
      ]
    }

    const totalPatternLength = dashes.reduce(
      (sum, value) => sum + Math.abs(value),
      0
    )
    if (totalPatternLength <= AcDbPatSvgRenderer.EPSILON) {
      return [
        {
          x1: originX + dirX * startAlong,
          y1: originY + dirY * startAlong,
          x2: originX + dirX * endAlong,
          y2: originY + dirY * endAlong
        }
      ]
    }

    const segments: AcDbPatSvgSegment[] = []
    const tileCount =
      Math.ceil((endAlong - startAlong) / totalPatternLength) + 2
    let tileStart = startAlong - totalPatternLength

    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      let cursor = tileStart
      for (const dashValue of dashes) {
        const length = Math.abs(dashValue)
        const nextCursor = cursor + length
        if (dashValue > 0 || dashValue === 0) {
          const drawStart = AcGeMathUtil.clamp(cursor, startAlong, endAlong)
          const drawEnd = AcGeMathUtil.clamp(nextCursor, startAlong, endAlong)
          if (drawEnd > drawStart) {
            segments.push({
              x1: originX + dirX * drawStart,
              y1: originY + dirY * drawStart,
              x2: originX + dirX * drawEnd,
              y2: originY + dirY * drawEnd
            })
          } else if (
            dashValue === 0 &&
            drawStart >= startAlong &&
            drawStart <= endAlong
          ) {
            const dotHalf = 0.35
            segments.push({
              x1: originX + dirX * (drawStart - dotHalf),
              y1: originY + dirY * (drawStart - dotHalf),
              x2: originX + dirX * (drawStart + dotHalf),
              y2: originY + dirY * (drawStart + dotHalf)
            })
          }
        }
        cursor = nextCursor
      }
      tileStart += totalPatternLength
    }

    return segments
  }

  /**
   * Renders one hatch line family (parallel repetitions of the same line rule)
   * into a single SVG `<path>` element.
   *
   * @param line - Hatch line rule to expand.
   * @param maxRadius - Coverage radius used to decide repetition count and
   * drawable extent.
   * @returns SVG `<path>` markup containing all generated segments.
   */
  private static renderFamily(line: AcDbPatLine, maxRadius: number) {
    const angle = AcGeMathUtil.degToRad(line.angle)
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    const normalX = -dirY
    const normalY = dirX

    const offsetX = dirX * line.deltaX + normalX * line.deltaY
    const offsetY = dirY * line.deltaX + normalY * line.deltaY
    const offsetLength = Math.hypot(offsetX, offsetY)

    const familyCount =
      offsetLength <= AcDbPatSvgRenderer.EPSILON
        ? 1
        : Math.max(1, Math.ceil((maxRadius * 2) / offsetLength) + 1)
    const half = Math.floor(familyCount / 2)
    const minAlong = -maxRadius * 1.5
    const maxAlong = maxRadius * 1.5
    const paths: string[] = []

    for (let index = -half; index <= half; index++) {
      const familyOriginX = line.originX + offsetX * index
      const familyOriginY = line.originY + offsetY * index
      const segments = AcDbPatSvgRenderer.buildDashSegments(
        line,
        minAlong,
        maxAlong,
        familyOriginX,
        familyOriginY,
        dirX,
        dirY
      )

      for (const segment of segments) {
        paths.push(AcDbPatSvgRenderer.segmentToSvgPath(segment))
      }
    }

    return `<path d="${paths.join(' ')}" fill="none" />`
  }

  /**
   * Renders an SVG `<linearGradient>` definition.
   *
   * @param id - Gradient ID.
   * @param angle - Gradient angle in radians.
   * @param shift - Relative shift applied along the gradient axis.
   * @param extent - Coordinate extent covering the viewport.
   * @param stops - Color stops.
   * @returns SVG gradient definition.
   */
  private static renderLinearGradientDef(
    id: string,
    angle: number,
    shift: number,
    extent: number,
    stops: AcDbPatSvgGradientStop[]
  ) {
    const dir = AcDbPatSvgRenderer.getGradientVector(angle)
    const shiftDistance = AcGeMathUtil.clamp(shift, -1, 1) * extent * 0.5
    const offsetX = dir.x * shiftDistance
    const offsetY = dir.y * shiftDistance

    return [
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse"`,
      ` x1="${(-dir.x * extent + offsetX).toFixed(2)}"`,
      ` y1="${(-dir.y * extent + offsetY).toFixed(2)}"`,
      ` x2="${(dir.x * extent + offsetX).toFixed(2)}"`,
      ` y2="${(dir.y * extent + offsetY).toFixed(2)}">`,
      AcDbPatSvgRenderer.renderGradientStops(stops),
      '</linearGradient>'
    ].join('')
  }

  /**
   * Renders an SVG `<radialGradient>` definition.
   *
   * @param id - Gradient ID.
   * @param cx - Center X coordinate.
   * @param cy - Center Y coordinate.
   * @param radius - Gradient radius.
   * @param stops - Color stops.
   * @returns SVG gradient definition.
   */
  private static renderRadialGradientDef(
    id: string,
    cx: number,
    cy: number,
    radius: number,
    stops: AcDbPatSvgGradientStop[]
  ) {
    return [
      `<radialGradient id="${id}" gradientUnits="userSpaceOnUse"`,
      ` cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}"`,
      ` fx="${cx.toFixed(2)}" fy="${cy.toFixed(2)}">`,
      AcDbPatSvgRenderer.renderGradientStops(stops),
      '</radialGradient>'
    ].join('')
  }

  /**
   * Builds the SVG definition for a hatch gradient pattern.
   *
   * SVG supports linear and radial gradients natively, so AutoCAD-specific
   * shapes such as CYLINDER and CURVED are represented with mirrored stops or
   * offset radial gradients.
   *
   * @param id - Gradient ID.
   * @param name - AutoCAD gradient name.
   * @param colors - Resolved gradient colors.
   * @param angle - Gradient angle in radians.
   * @param shift - Relative shift.
   * @param width - SVG viewport width.
   * @param height - SVG viewport height.
   * @returns SVG gradient definition.
   */
  private static renderGradientDef(
    id: string,
    name: AcDbGradientName,
    colors: AcDbPatSvgGradientColors,
    angle: number,
    shift: number,
    width: number,
    height: number
  ) {
    const gradientName = name.toUpperCase() as AcDbGradientName
    const inverse = gradientName.startsWith('INV')
    const baseName = gradientName.replace(/^INV/, '') as AcDbGradientName
    const first = inverse ? colors.end : colors.start
    const second = inverse ? colors.start : colors.end
    const extent = Math.hypot(width, height) / 2
    const dir = AcDbPatSvgRenderer.getGradientVector(angle)
    const centerShift = AcGeMathUtil.clamp(shift, -1, 1)
    const centerX = dir.x * centerShift * width * 0.25
    const centerY = dir.y * centerShift * height * 0.25

    switch (baseName) {
      case 'CYLINDER': {
        const middle = AcGeMathUtil.clamp(0.5 + centerShift * 0.45, 0.05, 0.95)
        return AcDbPatSvgRenderer.renderLinearGradientDef(
          id,
          angle,
          0,
          extent,
          [
            { offset: 0, color: first },
            { offset: middle, color: second },
            { offset: 1, color: first }
          ]
        )
      }
      case 'SPHERICAL':
        return AcDbPatSvgRenderer.renderRadialGradientDef(
          id,
          centerX,
          centerY,
          extent,
          [
            { offset: 0, color: second },
            { offset: 1, color: first }
          ]
        )
      case 'HEMISPHERICAL':
        return AcDbPatSvgRenderer.renderRadialGradientDef(
          id,
          centerX + dir.x * width * 0.18,
          centerY + dir.y * height * 0.18,
          extent * 0.92,
          [
            { offset: 0, color: second },
            { offset: 0.72, color: first },
            { offset: 1, color: first }
          ]
        )
      case 'CURVED':
        return AcDbPatSvgRenderer.renderRadialGradientDef(
          id,
          -dir.x * width * 0.95 + centerX,
          -dir.y * height * 0.95 + centerY,
          extent * 1.65,
          [
            { offset: 0, color: first },
            { offset: 0.55, color: first },
            { offset: 1, color: second }
          ]
        )
      case 'LINEAR':
      default:
        return AcDbPatSvgRenderer.renderLinearGradientDef(
          id,
          angle,
          shift,
          extent,
          [
            { offset: 0, color: first },
            { offset: 1, color: second }
          ]
        )
    }
  }

  /**
   * Renders a PAT pattern preview as a complete SVG document string.
   *
   * The method applies option defaults, computes an automatic unit-to-pixel
   * scale, transforms the pattern to screen space, and combines all line
   * families into one grouped stroke layer over a background rectangle.
   *
   * @param pattern - Pattern definition to render.
   * @param options - Optional preview style and size settings.
   * @returns Standalone SVG markup that can be injected directly into DOM or
   * saved as a `.svg` asset.
   */
  renderPattern(pattern: AcDbPatPattern, options: AcDbPatPreviewOptions = {}) {
    const width = options.width ?? 260
    const height = options.height ?? 160
    const stroke = options.stroke ?? '#1f2937'
    const strokeWidth = options.strokeWidth ?? 1.3
    const background = options.background ?? '#ffffff'
    const viewBox = `${-width / 2} ${-height / 2} ${width} ${height}`

    if (AcDbPatSvgRenderer.isSolidPattern(pattern)) {
      return [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`,
        AcDbPatSvgRenderer.renderBackground(width, height, background),
        `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="${stroke}" />`,
        '</svg>'
      ].join('')
    }

    const scaleUnit = AcDbPatSvgRenderer.estimateUnitScale(pattern)
    const baseScale = Math.min(width, height) * 0.18
    const unitToPixel =
      baseScale / Math.max(scaleUnit, AcDbPatSvgRenderer.EPSILON)

    const scaledPattern: AcDbPatPattern = {
      ...pattern,
      lines: pattern.lines.map(line => ({
        ...line,
        originX: line.originX * unitToPixel,
        originY: line.originY * unitToPixel,
        deltaX: line.deltaX * unitToPixel,
        deltaY: line.deltaY * unitToPixel,
        dashes: line.dashes.map(dash => dash * unitToPixel)
      }))
    }

    const maxRadius = Math.hypot(width, height) * 0.75
    const content = scaledPattern.lines
      .map(line => AcDbPatSvgRenderer.renderFamily(line, maxRadius))
      .join('')

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`,
      AcDbPatSvgRenderer.renderBackground(width, height, background),
      `<g stroke="${stroke}" stroke-width="${strokeWidth.toFixed(2)}" stroke-linecap="round">`,
      content,
      '</g>',
      '</svg>'
    ].join('')
  }

  /**
   * Renders an AutoCAD hatch gradient preview as a complete SVG document
   * string.
   *
   * The method uses native SVG linear/radial gradients where possible and
   * approximates AutoCAD-only gradient shapes with mirrored stops or offset
   * radial centers.
   *
   * @param name - AutoCAD gradient name.
   * @param options - Optional preview style and size settings.
   * @returns Standalone SVG markup that can be injected directly into DOM or
   * saved as a `.svg` asset.
   */
  renderGradient(
    name: AcDbGradientName,
    options: AcDbPatGradientPreviewOptions = {}
  ) {
    const width = options.width ?? 260
    const height = options.height ?? 160
    const background = options.background ?? '#ffffff'
    const angle = options.angle ?? 0
    const shift = options.shift ?? 0
    const viewBox = `${-width / 2} ${-height / 2} ${width} ${height}`
    const id = AcDbPatSvgRenderer.nextGradientId(name)
    const colors = AcDbPatSvgRenderer.resolveGradientColors(options)
    const gradientDef = AcDbPatSvgRenderer.renderGradientDef(
      id,
      name,
      colors,
      angle,
      shift,
      width,
      height
    )

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">`,
      AcDbPatSvgRenderer.renderBackground(width, height, background),
      '<defs>',
      gradientDef,
      '</defs>',
      `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="url(#${id})" />`,
      '</svg>'
    ].join('')
  }
}

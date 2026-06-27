/**
 * A single PAT line-family descriptor.
 *
 * Matches the PAT syntax:
 * `angle, x-origin, y-origin, delta-x, delta-y, dash-1, dash-2, ...`
 */
export interface AcDbPatLine {
  /**
   * Line-family angle in degrees.
   *
   * Following AutoCAD PAT conventions:
   * `0` points along +X, and positive values rotate counterclockwise.
   */
  angle: number

  /**
   * Base origin X coordinate in pattern units.
   *
   * Represents the X component of the first baseline start point.
   */
  originX: number

  /**
   * Base origin Y coordinate in pattern units.
   *
   * Represents the Y component of the first baseline start point.
   */
  originY: number

  /**
   * X component of the offset to the next parallel line, in pattern units.
   *
   * Combined with {@link deltaY} to define the translation from one family line
   * to the next.
   */
  deltaX: number

  /**
   * Y component of the offset to the next parallel line, in pattern units.
   *
   * Combined with {@link deltaX} to define the translation from one family line
   * to the next.
   */
  deltaY: number

  /**
   * Dash pattern segment array in pattern units.
   *
   * Rules:
   * - positive: draw segment (pen-down)
   * - negative: gap length (pen-up)
   * - `0`: dot
   *
   * An empty array means a continuous solid line.
   */
  dashes: number[]

  /**
   * Source line number in the original PAT text (1-based).
   *
   * Useful for diagnostics and error tracing.
   */
  sourceLine: number
}

/**
 * A complete PAT pattern definition (starts with `*NAME, description`).
 */
export interface AcDbPatPattern {
  /**
   * Pattern name.
   *
   * Examples: `ANSI31`, `SOLID`.
   */
  name: string

  /**
   * Pattern description text.
   *
   * This is the part after the comma in the PAT header; may be empty.
   */
  description?: string

  /**
   * Line-family descriptors included in this pattern.
   *
   * Order is preserved from the source PAT file.
   */
  lines: AcDbPatLine[]
}

/**
 * A single issue captured during PAT parsing.
 */
export interface AcDbPatParseIssue {
  /**
   * Line number where the issue occurred (1-based).
   *
   * Implementations may use `0` when no exact line can be mapped.
   */
  line: number

  /**
   * Developer-facing error or warning message.
   */
  message: string

  /**
   * Raw source line text that triggered the issue.
   *
   * Useful for debugging, logs, and UI error display.
   */
  source: string
}

/**
 * Structured result of parsing a PAT file.
 */
export interface AcDbPatDocument {
  /**
   * Successfully parsed pattern definitions.
   */
  patterns: AcDbPatPattern[]

  /**
   * Issues collected during parsing.
   *
   * Parsers typically use a best-effort strategy, so both `patterns` and
   * `issues` can be present at the same time.
   */
  issues: AcDbPatParseIssue[]
}

/**
 * Optional preview options when rendering a PAT pattern to SVG.
 */
export interface AcDbPatPreviewOptions {
  /**
   * SVG viewport width in pixels.
   */
  width?: number

  /**
   * SVG viewport height in pixels.
   */
  height?: number

  /**
   * Stroke color.
   *
   * Accepts any valid CSS color value (for example `#1f2937`, `rgb(...)`, `red`).
   */
  stroke?: string

  /**
   * Stroke width in pixels.
   */
  strokeWidth?: number

  /**
   * Background fill color.
   *
   * Accepts any valid CSS color value.
   */
  background?: string
}

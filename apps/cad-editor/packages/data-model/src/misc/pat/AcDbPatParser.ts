import type {
  AcDbPatDocument,
  AcDbPatLine,
  AcDbPatParseIssue,
  AcDbPatPattern
} from './AcDbPatDefinition'

/**
 * Internal parse context for a pattern currently being accumulated.
 */
interface AcDbPatCurrentPattern {
  /**
   * Parsed header and line descriptors collected so far.
   */
  pattern: AcDbPatPattern

  /**
   * Source line number where the pattern header (`*NAME,...`) appeared.
   */
  headerLine: number
}

/**
 * Parser for AutoCAD PAT text content.
 *
 * This parser follows a best-effort strategy:
 * - valid patterns are still returned when some rows are malformed;
 * - non-fatal problems are collected into {@link AcDbPatDocument.issues};
 * - PAT line numbers are preserved in parsed descriptors for diagnostics.
 *
 * Typical usage:
 * - instantiate once and call {@link parse} for each PAT payload;
 * - or call the convenience static {@link AcDbPatParser.parse} method.
 */
export class AcDbPatParser {
  /**
   * Parse PAT file text into structured patterns and issues.
   *
   * The method accepts complete PAT file content (including comments, blank
   * lines, and multiple pattern blocks). It normalizes line endings, parses
   * headers and line descriptors, and records any recoverable errors.
   *
   * @param content - Raw PAT file text.
   * @returns Parsed document containing both successful patterns and collected
   * parse issues.
   */
  parse(content: string): AcDbPatDocument {
    const normalized = this.normalizeLineEndings(content)
    const rawLines = normalized.split('\n')
    const patterns: AcDbPatPattern[] = []
    const issues: AcDbPatParseIssue[] = []

    let currentPattern: AcDbPatCurrentPattern | null = null

    rawLines.forEach((rawLine, index) => {
      const lineNumber = index + 1
      const lineWithoutComment = this.stripInlineComment(rawLine).trim()
      if (!lineWithoutComment) return

      if (lineWithoutComment.startsWith('*')) {
        this.flushCurrentPattern(currentPattern, patterns, issues)
        const header = this.parseHeader(lineWithoutComment.slice(1))
        if (!header) {
          issues.push({
            line: lineNumber,
            message: 'Invalid pattern header.',
            source: rawLine
          })
          currentPattern = null
          return
        }
        currentPattern = {
          pattern: {
            name: header.name,
            description: header.description,
            lines: []
          },
          headerLine: lineNumber
        }
        return
      }

      if (!currentPattern) {
        issues.push({
          line: lineNumber,
          message: 'Line descriptor appears before any pattern header.',
          source: rawLine
        })
        return
      }

      const descriptor = this.parseLineDescriptor(
        lineWithoutComment,
        lineNumber
      )
      if (!descriptor) {
        issues.push({
          line: lineNumber,
          message:
            'Invalid line descriptor. Expect: angle,x-origin,y-origin,delta-x,delta-y[,dash-1,...].',
          source: rawLine
        })
        return
      }
      currentPattern.pattern.lines.push(descriptor)
    })

    this.flushCurrentPattern(currentPattern, patterns, issues)
    return { patterns, issues }
  }

  /**
   * Parse PAT text without manually creating a parser instance.
   *
   * @param content - Raw PAT file text.
   * @returns Parsed PAT document.
   */
  static parse(content: string): AcDbPatDocument {
    return new AcDbPatParser().parse(content)
  }

  /**
   * Normalize line endings to Unix `\n` form.
   *
   * @param content - Raw text that may include `\r\n`, `\r`, or `\n`.
   * @returns Text with all line endings converted to `\n`.
   */
  private normalizeLineEndings(content: string) {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  }

  /**
   * Remove inline PAT comments from a source line.
   *
   * PAT comment syntax uses `;` and ignores everything after it.
   *
   * @param rawLine - Unprocessed source line from the PAT file.
   * @returns Source line without trailing comment section.
   */
  private stripInlineComment(rawLine: string) {
    const commentIndex = rawLine.indexOf(';')
    if (commentIndex < 0) return rawLine
    return rawLine.slice(0, commentIndex)
  }

  /**
   * Parse a PAT header body after the leading `*`.
   *
   * Examples:
   * - `ANSI31, 45 degree hatch`
   * - `SOLID`
   *
   * @param body - Header content without the leading `*`.
   * @returns Parsed `{ name, description }`, or `null` when header is invalid.
   */
  private parseHeader(
    body: string
  ): { name: string; description: string } | null {
    const firstComma = body.indexOf(',')
    if (firstComma < 0) {
      const nameOnly = body.trim()
      if (!nameOnly) return null
      return { name: nameOnly, description: '' }
    }

    const name = body.slice(0, firstComma).trim()
    const description = body.slice(firstComma + 1).trim()
    if (!name) return null
    return { name, description }
  }

  /**
   * Parse a numeric token from PAT syntax.
   *
   * @param token - Numeric field text from a PAT row.
   * @returns Finite number value, or `null` when token is not a valid number.
   */
  private parseNumber(token: string) {
    const value = Number(token.trim())
    return Number.isFinite(value) ? value : null
  }

  /**
   * Parse one PAT line descriptor row.
   *
   * Expected format:
   * `angle,x-origin,y-origin,delta-x,delta-y[,dash-1,dash-2,...]`
   *
   * @param raw - Row text without inline comments.
   * @param lineNumber - Original 1-based source line number.
   * @returns Parsed line descriptor with source metadata, or `null` when row
   * does not satisfy the expected numeric schema.
   */
  private parseLineDescriptor(
    raw: string,
    lineNumber: number
  ): AcDbPatLine | null {
    const tokens = raw
      .split(',')
      .map(token => token.trim())
      .filter(token => token.length > 0)

    if (tokens.length < 5) return null

    const angle = this.parseNumber(tokens[0])
    const originX = this.parseNumber(tokens[1])
    const originY = this.parseNumber(tokens[2])
    const deltaX = this.parseNumber(tokens[3])
    const deltaY = this.parseNumber(tokens[4])
    if (
      angle == null ||
      originX == null ||
      originY == null ||
      deltaX == null ||
      deltaY == null
    ) {
      return null
    }

    const dashTokens = tokens.slice(5)
    const dashes: number[] = []
    for (const token of dashTokens) {
      const value = this.parseNumber(token)
      if (value == null) return null
      dashes.push(value)
    }

    return {
      angle,
      originX,
      originY,
      deltaX,
      deltaY,
      dashes,
      sourceLine: lineNumber
    }
  }

  /**
   * Finalize the current pattern and append it to output collections.
   *
   * If a pattern header was parsed but no line descriptor followed, this method
   * records an issue and still emits the empty pattern to preserve source
   * intent and ordering.
   *
   * @param currentPattern - Pattern currently being accumulated.
   * @param patterns - Target array that receives completed patterns.
   * @param issues - Target array that receives parse issues.
   */
  private flushCurrentPattern(
    currentPattern: AcDbPatCurrentPattern | null,
    patterns: AcDbPatPattern[],
    issues: AcDbPatParseIssue[]
  ) {
    if (!currentPattern) return

    if (currentPattern.pattern.lines.length === 0) {
      issues.push({
        line: currentPattern.headerLine,
        message: `Pattern "${currentPattern.pattern.name}" has no line descriptor.`,
        source: ''
      })
    }

    patterns.push(currentPattern.pattern)
  }
}

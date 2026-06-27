import { DEFAULT_TEXT_STYLE } from '../misc/AcDbConstants'

const MTEXT_INLINE_FONT_PATTERN = /\\f(.*?)\|/g

/** STYLE table entry protocol used when collecting fonts before conversion. */
export type AcDbFontNameCollectorStyleEntry = {
  name: string
  font?: string
  bigFont?: string
  extendedFont?: string
  standardFlag?: number
}

/**
 * Font-related fields extracted from one parsed entity.
 *
 * The collector resolves {@link styleName} against the STYLE table and parses
 * inline font overrides from {@link formattedText}.
 */
export type AcDbFontNameCollectorEntityFontInfo = {
  styleName?: string
  formattedText?: string
  blockName?: string
  /** When true, resolve fonts via STYLE table fallbacks. */
  resolveStyle?: boolean
}

/** Callbacks that map a host-specific entity model to collector input. */
export type AcDbFontNameCollectorAdapter<TEntity> = {
  getEntityFontInfo(entity: TEntity): AcDbFontNameCollectorEntityFontInfo | null
  getBlockEntities?(blockName: string): TEntity[] | undefined
}

export type AcDbFontNameCollectorOptions = {
  styles: AcDbFontNameCollectorStyleEntry[]
  textStyleVar?: string
}

/**
 * Collects normalized font names from parsed drawing data before conversion.
 *
 * Host converters supply STYLE table entries plus an adapter that describes
 * each entity's font usage and nested block structure.
 */
export class AcDbFontNameCollector {
  private readonly styles: AcDbFontNameCollectorStyleEntry[]
  private readonly styleMap: Map<string, string[]>
  private readonly textStyleVar: string

  constructor(options: AcDbFontNameCollectorOptions) {
    this.styles = options.styles
    this.styleMap = AcDbFontNameCollector.buildStyleFontMap(this.styles)
    this.textStyleVar = options.textStyleVar ?? DEFAULT_TEXT_STYLE
  }

  /**
   * Walks entities and returns all normalized font names referenced by the drawing.
   */
  collect<TEntity>(
    entities: TEntity[],
    adapter: AcDbFontNameCollectorAdapter<TEntity>
  ): string[] {
    const fonts = new Set<string>()
    for (const fontName of AcDbFontNameCollector.collectShapeDefinitionFonts(
      this.styles
    )) {
      fonts.add(fontName)
    }
    this.collectFromEntities(entities, adapter, fonts)
    return Array.from(fonts)
  }

  /**
   * Normalizes a font file name for font loading: strips the extension and lowercases.
   */
  static normalizeFontFileName(fontFileName?: string): string | undefined {
    if (!fontFileName) {
      return undefined
    }
    const lastDotIndex = fontFileName.lastIndexOf('.')
    if (lastDotIndex >= 0) {
      return fontFileName.substring(0, lastDotIndex).toLowerCase()
    }
    return fontFileName.toLowerCase()
  }

  private collectFromEntities<TEntity>(
    entities: TEntity[],
    adapter: AcDbFontNameCollectorAdapter<TEntity>,
    fonts: Set<string>
  ) {
    for (const entity of entities) {
      const info = adapter.getEntityFontInfo(entity)
      if (!info) {
        continue
      }

      if (info.formattedText) {
        for (const fontName of AcDbFontNameCollector.extractInlineMTextFonts(
          info.formattedText
        )) {
          fonts.add(fontName)
        }
      }

      if (info.resolveStyle) {
        this.addResolvedStyleFonts(info.styleName, fonts)
      }

      if (info.blockName && adapter.getBlockEntities) {
        const blockEntities = adapter.getBlockEntities(info.blockName)
        if (blockEntities) {
          this.collectFromEntities(blockEntities, adapter, fonts)
        }
      }
    }
  }

  /**
   * Resolves font names for a text entity style using the same fallbacks as
   * {@link AcDbTextStyleTable.resolveAt}.
   */
  private resolveStyleFontNames(styleName?: string): string[] | undefined {
    const candidates: string[] = []
    const addCandidate = (value?: string) => {
      const trimmed = value?.trim()
      if (trimmed && !candidates.includes(trimmed)) {
        candidates.push(trimmed)
      }
    }

    addCandidate(styleName)
    addCandidate(this.textStyleVar)
    addCandidate(DEFAULT_TEXT_STYLE)
    addCandidate('STANDARD')

    for (const candidate of candidates) {
      const exact = this.styleMap.get(candidate)
      if (exact) {
        return exact
      }

      const normalizedCandidate = candidate.toUpperCase()
      for (const [key, fontNames] of this.styleMap) {
        if (key.toUpperCase() === normalizedCandidate) {
          return fontNames
        }
      }
    }

    return this.styleMap.values().next().value
  }

  private addResolvedStyleFonts(
    styleName: string | undefined,
    fonts: Set<string>
  ) {
    const fontNames = this.resolveStyleFontNames(styleName)
    fontNames?.forEach(name => fonts.add(name))
  }

  private static buildStyleFontMap(
    styles: AcDbFontNameCollectorStyleEntry[]
  ): Map<string, string[]> {
    const styleMap = new Map<string, string[]>()
    for (const style of styles) {
      styleMap.set(
        style.name,
        AcDbFontNameCollector.collectStyleEntryFontNames(style)
      )
    }
    return styleMap
  }

  private static collectStyleEntryFontNames(
    style: Pick<
      AcDbFontNameCollectorStyleEntry,
      'font' | 'bigFont' | 'extendedFont'
    >
  ): string[] {
    const fontNames: string[] = []
    for (const fileName of [style.font, style.bigFont, style.extendedFont]) {
      const normalized = AcDbFontNameCollector.normalizeFontFileName(fileName)
      if (normalized) {
        fontNames.push(normalized)
      }
    }
    return fontNames
  }

  private static collectShapeDefinitionFonts(
    styles: Array<
      Pick<AcDbFontNameCollectorStyleEntry, 'font' | 'standardFlag'>
    >
  ): string[] {
    const fonts: string[] = []
    for (const style of styles) {
      if (style.standardFlag && style.standardFlag & 1) {
        const normalized = AcDbFontNameCollector.normalizeFontFileName(
          style.font
        )
        if (normalized) {
          fonts.push(normalized)
        }
      }
    }
    return fonts
  }

  private static extractInlineMTextFonts(text: string): string[] {
    const fonts: string[] = []
    for (const match of text.matchAll(MTEXT_INLINE_FONT_PATTERN)) {
      fonts.push(match[1].toLowerCase())
    }
    return fonts
  }
}
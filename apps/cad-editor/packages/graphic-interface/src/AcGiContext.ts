import { AcGiSubEntityTraits } from './AcGiSubEntityTraits'

export interface AcGiContextOptions {
  /**
   * Database being drawn. Runtime type is `AcDbDatabase` (data-model); typed as
   * `unknown` here so graphic-interface does not depend on data-model.
   */
  database?: unknown
  /** RGB used when the resolved color is foreground (ACI 7) on a dark background. */
  foregroundOnDark?: number
  /** RGB used when the resolved color is foreground (ACI 7) on a light background. */
  foregroundOnLight?: number
  /** Whether the current draw background is dark. */
  backgroundIsDark?: boolean
  /** Fallback RGB when the resolved color has no concrete RGB value. */
  fallbackRgb?: number
}

/**
 * Draw-time context used to resolve semantic entity colors into pixel RGB values.
 *
 * ACI 7 (foreground / contrast color) depends on the current background, so RGB
 * resolution must happen in the renderer with this context rather than on traits.
 */
export class AcGiContext {
  /**
   * Database being drawn. Runtime type is `AcDbDatabase` (data-model); typed as
   * `unknown` here so graphic-interface does not depend on data-model.
   */
  database: unknown
  /** RGB used when the resolved color is foreground (ACI 7) on a dark background. */
  foregroundOnDark: number
  /** RGB used when the resolved color is foreground (ACI 7) on a light background. */
  foregroundOnLight: number
  /** Whether the current draw background is dark. */
  backgroundIsDark: boolean
  /** Fallback RGB when the resolved color has no concrete RGB value. */
  fallbackRgb?: number

  constructor(options: AcGiContextOptions = {}) {
    this.database = options.database
    this.foregroundOnDark =
      options.foregroundOnDark ?? ACGI_DARK_THEME_FOREGROUND
    this.foregroundOnLight =
      options.foregroundOnLight ?? ACGI_LIGHT_THEME_FOREGROUND
    this.backgroundIsDark = options.backgroundIsDark ?? true
    this.fallbackRgb = options.fallbackRgb ?? 0xffffff
  }

  /**
   * Resolves {@link AcGiSubEntityTraits.color} to a pixel RGB value.
   */
  resolveSubEntityTraitsRgb(traits: AcGiSubEntityTraits): number {
    const color = traits.color
    if (color.isForeground) {
      return this.backgroundIsDark
        ? this.foregroundOnDark
        : this.foregroundOnLight
    }
    if (color.isByLayer || color.isByBlock) {
      return this.fallbackRgb ?? 0xffffff
    }
    return color.RGB ?? this.fallbackRgb ?? 0xffffff
  }

  /**
   * Creates a draw-time context from the current canvas background colour.
   */
  static fromBackgroundColor(
    backgroundColor: number = ACGI_MODEL_SPACE_BACKGROUND,
    database?: unknown
  ): AcGiContext {
    return new AcGiContext({
      database,
      foregroundOnDark: ACGI_DARK_THEME_FOREGROUND,
      foregroundOnLight: ACGI_LIGHT_THEME_FOREGROUND,
      backgroundIsDark: !acgiIsLightBackground(backgroundColor),
      fallbackRgb: 0xffffff
    })
  }
}

/** AutoCAD model-space default background: RGB(0, 0, 0). */
export const ACGI_MODEL_SPACE_BACKGROUND = 0x000000

/** ACI-7 foreground on a dark canvas background. */
export const ACGI_DARK_THEME_FOREGROUND = 0xffffff

/** ACI-7 foreground on a light canvas background. */
export const ACGI_LIGHT_THEME_FOREGROUND = 0x000000

/** AutoCAD paper-space default background: RGB(255, 255, 255). */
export const ACGI_PAPER_SPACE_BACKGROUND = 0xffffff

/** ITU-R BT.601 luma threshold used by {@link acgiIsLightBackground}. */
const ACGI_LIGHT_BACKGROUND_LUMA_THRESHOLD = 128

/** Default draw context matching a dark AutoCAD model-space background. */
export const DEFAULT_ACGI_CONTEXT = new AcGiContext({
  database: undefined,
  foregroundOnDark: ACGI_DARK_THEME_FOREGROUND,
  foregroundOnLight: ACGI_LIGHT_THEME_FOREGROUND,
  backgroundIsDark: true,
  fallbackRgb: 0xffffff
})

/**
 * Whether a packed RGB colour is perceptually light (paper-like).
 */
export function acgiIsLightBackground(color: number): boolean {
  const r = (color >> 16) & 0xff
  const g = (color >> 8) & 0xff
  const b = color & 0xff
  return (
    0.299 * r + 0.587 * g + 0.114 * b > ACGI_LIGHT_BACKGROUND_LUMA_THRESHOLD
  )
}

/**
 * ACI-7 foreground that contrasts with the canvas background.
 */
export function acgiForegroundColorForBackground(
  backgroundColor: number
): number {
  const context = AcGiContext.fromBackgroundColor(backgroundColor)
  return context.backgroundIsDark
    ? context.foregroundOnDark
    : context.foregroundOnLight
}

/**
 * ACI-7 foreground that contrasts with a light or dark UI theme flag.
 */
export function acgiContrastingForegroundColor(isLight: boolean): number {
  return isLight ? ACGI_LIGHT_THEME_FOREGROUND : ACGI_DARK_THEME_FOREGROUND
}

/**
 * Convenience wrapper when only the canvas background is available.
 */
export function acgiResolveSubEntityTraitsRgbFromBackground(
  traits: AcGiSubEntityTraits,
  backgroundColor: number
): number {
  return AcGiContext.fromBackgroundColor(
    backgroundColor
  ).resolveSubEntityTraitsRgb(traits)
}

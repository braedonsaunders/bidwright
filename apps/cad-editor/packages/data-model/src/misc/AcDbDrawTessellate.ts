import {
  AcGeCircArc2d,
  type AcGeTessellateOptions
} from '@mlightcad/geometry-engine'
import type { AcGiRenderer } from '@mlightcad/graphic-interface'

/** Draft display tessellation: fewer vertices, less memory. Open-time default. */
export const ACDB_DRAW_CIRCLE_SIDES_DRAFT = 50
/** Standard display tessellation, matching historical `getPoints(100)`. */
export const ACDB_DRAW_CIRCLE_SIDES_STANDARD =
  AcGeCircArc2d.DEFAULT_CIRCLE_SIDES
/** High display tessellation: smoother curves, more memory. */
export const ACDB_DRAW_CIRCLE_SIDES_HIGH = 1000

/**
 * Draw-time tessellation options for the current database.
 *
 * Uses {@link AcDbDatabase.drawCircleSides} from {@link AcGiContext.database}
 * (set by {@link AcDbEntity.worldDraw}). When the renderer has no database
 * this falls back to {@link AcGeCircArc2d.DEFAULT_CIRCLE_SIDES}.
 *
 * AutoCAD VIEWRES is not read here. DWG files often store 1000, which would
 * inflate GPU memory and HTML export size unless the user explicitly chooses
 * a high-quality preset. Opening a drawing without
 * {@link AcDbOpenDatabaseOptions.circleSides} uses
 * {@link ACDB_DRAW_CIRCLE_SIDES_DRAFT}.
 *
 * Renderer implementations of `circularArc` / `ellipticalArc` / `area` should
 * use the same helper so Circle, Arc, and Ellipse honour the open-time setting.
 *
 * @param renderer - Current renderer; `context.database` is duck-typed
 */
export function acdbDrawTessellateOptions(
  renderer?: Pick<AcGiRenderer, 'context'> | { context?: { database?: unknown } }
): AcGeTessellateOptions {
  const circleSides = acdbDrawCircleSides(renderer?.context?.database)
  return {
    circleSides,
    maxSegments: circleSides
  }
}

/**
 * Circle-side count used for display tessellation.
 *
 * Prefers {@link AcDbDatabase.drawCircleSides} from the open-time option.
 * Falls back to {@link AcGeCircArc2d.DEFAULT_CIRCLE_SIDES}.
 *
 * @param database - Runtime `AcDbDatabase`; typed as `unknown` so this helper
 * can run against `AcGiContext.database`
 */
export function acdbDrawCircleSides(database: unknown): number {
  if (database != null && typeof database === 'object') {
    const sides = (database as { drawCircleSides?: unknown }).drawCircleSides
    if (typeof sides === 'number' && Number.isFinite(sides)) {
      return AcGeCircArc2d.resolveCircleSides(sides)
    }
  }
  return AcGeCircArc2d.DEFAULT_CIRCLE_SIDES
}

/**
 * Read VPORT `*Active`.circleSides from a database, with a safe default.
 *
 * This is the stored VIEWRES-like value (clamped to the DXF range). Display
 * tessellation uses {@link acdbDrawTessellateOptions} instead.
 *
 * @param database - Runtime `AcDbDatabase`; typed as `unknown` so this helper
 * can run against `AcGiContext.database`
 */
export function acdbResolveCircleSides(database: unknown): number {
  if (database == null || typeof database !== 'object') {
    return AcGeCircArc2d.DEFAULT_CIRCLE_SIDES
  }
  const tables = (
    database as {
      tables?: {
        viewportTable?: {
          getActiveVport?: () => { circleSides?: number } | undefined
        }
      }
    }
  ).tables
  const sides = tables?.viewportTable?.getActiveVport?.()?.circleSides
  if (typeof sides !== 'number' || !Number.isFinite(sides)) {
    return AcGeCircArc2d.DEFAULT_CIRCLE_SIDES
  }
  return AcGeCircArc2d.resolveCircleSides(sides)
}

/**
 * Default line type used when no specific line type is specified.
 *
 * This constant represents the "Continuous" line type, which is the
 * standard solid line type used in AutoCAD drawings.
 */
export const DEFAULT_LINE_TYPE = 'Continuous'

/**
 * Default text style name used when no specific text style is specified.
 *
 * This constant represents the standard text style used in AutoCAD drawings.
 */
export const DEFAULT_TEXT_STYLE = 'Standard'

/**
 * Default multiline style name used when no specific MLINE style is specified.
 *
 * This constant represents the default current style used by the CMLSTYLE
 * system variable for newly created MLINE entities.
 */
export const DEFAULT_MLINE_STYLE = 'Standard'

/**
 * Default multileader style name used when no specific MLEADER style is specified.
 *
 * This constant represents the default current style used by the CMLEADERSTYLE
 * system variable for newly created MLEADER entities.
 */
export const DEFAULT_MLEADER_STYLE = 'Standard'

/**
 * Default hatch pattern name used by AutoCAD for imperial drawings.
 */
export const DEFAULT_HATCH_PATTERN_IMPERIAL = 'ANSI31'

/**
 * Default hatch pattern name used by AutoCAD for metric drawings.
 */
export const DEFAULT_HATCH_PATTERN_METRIC = 'ANGLE'

/**
 * Reserved hatch pattern name used for solid fills.
 */
export const HATCH_PATTERN_SOLID = 'SOLID'

/**
 * Returns true when a hatch pattern name denotes a solid fill.
 *
 * LibreDWG (and some older writers) emit `_SOLID` instead of `SOLID`. Treat
 * both — and any leading-underscore / case variant — as solid so fill is not
 * dropped when `definitionLines` are empty.
 */
export function acdbIsSolidHatchPatternName(
  patternName: string | null | undefined
): boolean {
  if (patternName == null) return false
  const normalized = patternName.trim().toUpperCase().replace(/^_+/, '')
  return normalized === HATCH_PATTERN_SOLID
}

/**
 * Default hatch pattern name used for user-defined hatch patterns in DXF output.
 */
export const HATCH_PATTERN_USER = 'USER'

/**
 * Default gradient hatch name used when a gradient hatch has no explicit name.
 */
export const DEFAULT_GRADIENT_HATCH_NAME = 'LINEAR'

/**
 * Special line type value that indicates the entity should use
 * the line type of its layer.
 *
 * When an entity has this line type, it will inherit the line type
 * from the layer it belongs to.
 */
export const ByLayer = 'ByLayer'

/**
 * Special line type value that indicates the entity should use
 * the line type of its block.
 *
 * When an entity has this line type, it will inherit the line type
 * from the block it belongs to.
 */
export const ByBlock = 'ByBlock'

/**
 * Name of the active viewport table record in AutoCAD.
 *
 * This reserved name identifies the current viewport configuration in the
 * VPORT symbol table.
 */
export const ACTIVE_VPORT_NAME = '*Active'

/**
 * Application ID for MLightCAD used in dictionaries and XData registration.
 */
export const MLIGHTCAD_APPID = 'mlightcad'

/**
 * Built-in AutoCAD application ID used for standard XData registration.
 */
export const ACAD_APPID = 'ACAD'

/**
 * Frozen 2D/3D placeholders when a VPORT table row omits geometry (partial DXF
 * groups, incomplete DWG decode). Used before `AcGePoint2d.copy` / `AcGePoint3d.copy`.
 */
export const VPORT_FALLBACK_CENTER_2D = Object.freeze({ x: 0, y: 0 })
export const VPORT_FALLBACK_LLC = Object.freeze({ x: 0, y: 0 })
export const VPORT_FALLBACK_URC = Object.freeze({ x: 1, y: 1 })
export const VPORT_FALLBACK_VIEW_DIR = Object.freeze({ x: 0, y: 0, z: 1 })
export const VPORT_FALLBACK_VIEW_TARGET = Object.freeze({ x: 0, y: 0, z: 0 })

/** AutoCAD default ACI color index for the GRIPCOLOR system variable. */
export const ACDB_GRIPCOLOR_DEFAULT = 150

/** AutoCAD valid range for the GRIPCOLOR system variable. */
export const ACDB_GRIPCOLOR_MIN = 1
export const ACDB_GRIPCOLOR_MAX = 255

/** AutoCAD default ACI color index for the GRIPHOT system variable. */
export const ACDB_GRIPHOT_DEFAULT = 12

/** AutoCAD valid range for the GRIPHOT system variable. */
export const ACDB_GRIPHOT_MIN = 1
export const ACDB_GRIPHOT_MAX = 255

/** AutoCAD valid range for the GRIPOBJLIMIT system variable. */
export const ACDB_GRIPOBJLIMIT_MIN = 0
export const ACDB_GRIPOBJLIMIT_MAX = 32767

/** AutoCAD valid range for the GRIPS system variable. */
export const ACDB_GRIPS_MIN = 0
export const ACDB_GRIPS_MAX = 2

/** AutoCAD default value for the GRIPSIZE system variable. */
export const ACDB_GRIPSIZE_DEFAULT = 5

/** AutoCAD valid range for the GRIPSIZE system variable. */
export const ACDB_GRIPSIZE_MIN = 1
export const ACDB_GRIPSIZE_MAX = 255

/**
 * COMPAREPROPS bit: include color property changes in drawing comparison.
 *
 * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-FC52193A-3801-42D1-B5C3-873B192B36B2
 */
export const ACDB_COMPAREPROPS_COLOR = 1
/** COMPAREPROPS bit: include layer property changes. */
export const ACDB_COMPAREPROPS_LAYER = 2
/** COMPAREPROPS bit: include linetype property changes. */
export const ACDB_COMPAREPROPS_LINETYPE = 4
/** COMPAREPROPS bit: include linetype scale property changes. */
export const ACDB_COMPAREPROPS_LINETYPESCALE = 8
/** COMPAREPROPS bit: include lineweight property changes. */
export const ACDB_COMPAREPROPS_LINEWEIGHT = 16
/** COMPAREPROPS bit: include transparency property changes. */
export const ACDB_COMPAREPROPS_TRANSPARENCY = 32
/** COMPAREPROPS bit: include thickness property changes. */
export const ACDB_COMPAREPROPS_THICKNESS = 64

/** AutoCAD default for COMPAREPROPS: property changes are not compared. */
export const ACDB_COMPAREPROPS_DEFAULT = 0

/** AutoCAD valid range for the COMPAREPROPS bitcode (sum of defined bits). */
export const ACDB_COMPAREPROPS_MIN = 0
export const ACDB_COMPAREPROPS_MAX =
  ACDB_COMPAREPROPS_COLOR |
  ACDB_COMPAREPROPS_LAYER |
  ACDB_COMPAREPROPS_LINETYPE |
  ACDB_COMPAREPROPS_LINETYPESCALE |
  ACDB_COMPAREPROPS_LINEWEIGHT |
  ACDB_COMPAREPROPS_TRANSPARENCY |
  ACDB_COMPAREPROPS_THICKNESS

/** AutoCAD default for COMPAREHATCH: hatch objects are excluded from comparison. */
export const ACDB_COMPAREHATCH_DEFAULT = 0

/** AutoCAD valid range for the COMPAREHATCH system variable. */
export const ACDB_COMPAREHATCH_MIN = 0
export const ACDB_COMPAREHATCH_MAX = 1

/** AutoCAD default for COMPARERCMARGIN: revision-cloud offset of 5. */
export const ACDB_COMPARERCMARGIN_DEFAULT = 5

/** AutoCAD valid range for the COMPARERCMARGIN system variable. */
export const ACDB_COMPARERCMARGIN_MIN = 1
export const ACDB_COMPARERCMARGIN_MAX = 25

/** AutoCAD default for COMPARETEXT: text objects are included in comparison. */
export const ACDB_COMPARETEXT_DEFAULT = 1

/** AutoCAD valid range for the COMPARETEXT system variable. */
export const ACDB_COMPARETEXT_MIN = 0
export const ACDB_COMPARETEXT_MAX = 1

/** AutoCAD default for COMPARETOLERANCE: 6 decimal places. */
export const ACDB_COMPARETOLERANCE_DEFAULT = 6

/** AutoCAD valid range for the COMPARETOLERANCE system variable. */
export const ACDB_COMPARETOLERANCE_MIN = 0
export const ACDB_COMPARETOLERANCE_MAX = 14

/**
 * Truncates a numeric system-variable value to an integer and rejects values
 * outside AutoCAD's documented valid range.
 */
export function acdbCoerceIntegerSysVar(
  displayName: string,
  value: unknown,
  min: number,
  max: number
): number {
  const intVal = Math.trunc(value as number)
  if (!Number.isFinite(intVal) || intVal < min || intVal > max) {
    throw new Error(
      `Invalid ${displayName} value! Valid range is ${min} to ${max}.`
    )
  }
  return intVal
}

/**
 * Returns a truncated integer when it lies in `[min, max]`; otherwise
 * `undefined`. Used when ingesting untrusted drawing data such as DXF HEADER.
 */
export function acdbIntegerSysVarIfInRange(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  const intVal = Math.trunc(value as number)
  if (!Number.isFinite(intVal) || intVal < min || intVal > max) {
    return undefined
  }
  return intVal
}

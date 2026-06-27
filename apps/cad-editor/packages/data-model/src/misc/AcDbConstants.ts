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

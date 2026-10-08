import {
  AcCmColor,
  AcCmColorMethod,
  AcCmEventManager,
  AcCmTransparency
} from '@mlightcad/common'
import { AcGePointLike } from '@mlightcad/geometry-engine'
import { AcGiLineWeight } from '@mlightcad/graphic-interface'

import { AcDbAngleUnits } from '../misc/AcDbAngleUnits'
import {
  ACDB_COMPAREHATCH_DEFAULT,
  ACDB_COMPAREHATCH_MAX,
  ACDB_COMPAREHATCH_MIN,
  ACDB_COMPAREPROPS_DEFAULT,
  ACDB_COMPAREPROPS_MAX,
  ACDB_COMPAREPROPS_MIN,
  ACDB_COMPARERCMARGIN_DEFAULT,
  ACDB_COMPARERCMARGIN_MAX,
  ACDB_COMPARERCMARGIN_MIN,
  ACDB_COMPARETEXT_DEFAULT,
  ACDB_COMPARETEXT_MAX,
  ACDB_COMPARETEXT_MIN,
  ACDB_COMPARETOLERANCE_DEFAULT,
  ACDB_COMPARETOLERANCE_MAX,
  ACDB_COMPARETOLERANCE_MIN,
  ACDB_GRIPCOLOR_DEFAULT,
  ACDB_GRIPCOLOR_MAX,
  ACDB_GRIPCOLOR_MIN,
  ACDB_GRIPHOT_DEFAULT,
  ACDB_GRIPHOT_MAX,
  ACDB_GRIPHOT_MIN,
  ACDB_GRIPSIZE_DEFAULT,
  ACDB_GRIPSIZE_MAX,
  ACDB_GRIPSIZE_MIN,
  acdbCoerceIntegerSysVar,
  ByLayer,
  DEFAULT_HATCH_PATTERN_METRIC,
  DEFAULT_MLEADER_STYLE,
  DEFAULT_MLINE_STYLE,
  DEFAULT_TEXT_STYLE
} from '../misc/AcDbConstants'
import { AcDbLinearUnits } from '../misc/AcDbLinearUnits'
import { AcDbUnitsValue } from '../misc/AcDbUnitsValue'
import type { AcDbDatabase } from './AcDbDatabase'
import { AcDbSystemVariables } from './AcDbSystemVariables'

/**
 * Best-effort default for {@link AcDbSystemVariables.LOGINNAME}.
 * Prefers common OS environment variables when running under Node.
 */
function detectDefaultLoginName(): string {
  try {
    const env =
      typeof process !== 'undefined' && process.env ? process.env : undefined
    if (!env) return ''
    const name = env.USERNAME || env.USER || env.LOGNAME || ''
    return typeof name === 'string' ? name.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Supported AutoCAD system variable data type name.
 */
export type AcDbSysVarTypeName =
  | 'string'
  | 'color'
  | 'number'
  | 'boolean'
  | 'point'
  | 'transparency'
  | 'unknown'

/**
 * Supported AutoCAD system variable data type name.
 */
export type AcDbSysVarType =
  | string
  | number
  | boolean
  | AcGePointLike
  | AcCmColor
  | AcCmTransparency

/**
 * Definition for a system variable in our registry.
 */
export interface AcDbSysVarDescriptor {
  /** System variable name, e.g., "CLAYER" */
  name: string

  /** Expected variable type */
  type: AcDbSysVarTypeName

  /** The flag to indicate whether it is one database-resident variable. */
  isDbVar: boolean

  /** Optional description (documentation) */
  description?: string

  /** Optional default value */
  defaultValue?: AcDbSysVarType

  /** When true, the variable cannot be changed via setVar. */
  readOnly?: boolean
}

/**
 * Event arguments for system variable related events.
 */
export interface AcDbSysVarEventArgs {
  /** The database that triggered the event */
  database: AcDbDatabase
  /** The system variable name */
  name: string
  /** The new value of system variable */
  newVal: AcDbSysVarType
  /** The old value of system variable */
  oldVal?: AcDbSysVarType
}

/**
 * Main manager responsible for:
 * - registry of known system variables
 * - caching values
 * - invoking backend getVar/setVar
 * - dispatching sysvar change events
 */
export class AcDbSysVarManager {
  private static _instance: AcDbSysVarManager | null = null

  /** Singleton accessor */
  public static instance(): AcDbSysVarManager {
    if (!this._instance) this._instance = new AcDbSysVarManager()
    return this._instance
  }

  /** Registered system variable metadata */
  private registry = new Map<string, AcDbSysVarDescriptor>()

  /** Cached current values for non-database-resident variables. */
  private cache = new Map<string, unknown>()

  /** System variable related events */
  public readonly events = {
    /**
     * Fired after a system variable is changed directly through the SETVAR command or
     * by entering the variable name at the command line.
     */
    sysVarChanged: new AcCmEventManager<AcDbSysVarEventArgs>()
  }

  /** Registers all known system variables in alphabetical order by name. */
  private constructor() {
    /**
     * Base angle for zero direction (**ANGBASE**), in radians.
     */
    this.registerVar({
      name: AcDbSystemVariables.ANGBASE,
      type: 'number',
      isDbVar: true,
      defaultValue: 0
    })
    /**
     * Direction of positive angles (**ANGDIR**).
     * - `0`: Counterclockwise
     * - `1`: Clockwise
     */
    this.registerVar({
      name: AcDbSystemVariables.ANGDIR,
      type: 'number',
      isDbVar: true,
      defaultValue: 0
    })
    /**
     * Sets the angular unit display format for angles (not the geometric angle itself).
     * Integer codes match AutoCAD and {@link AcDbAngleUnits}:
     * - `0`: Decimal degrees
     * - `1`: Degrees/minutes/seconds
     * - `2`: Gradians
     * - `3`: Radians
     * - `4`: Surveyor's units
     *
     * @see https://help.autodesk.com/view/ACD/2027/ENU/?caas=caas/documentation/ACD/2014/ENU/files/GUID-C7C0F6A5-7982-43DB-97F9-5B9B0044E9FA-htm.html
     */
    this.registerVar({
      name: AcDbSystemVariables.AUNITS,
      type: 'number',
      isDbVar: true,
      defaultValue: AcDbAngleUnits.DecimalDegrees
    })
    /**
     * Sets the display precision for angles (number of decimal places or equivalent), used together
     * with {@link AcDbDatabase.aunits | AUNITS}. Typical range in AutoCAD is **0??**; initial value **0**.
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-EE1ED20C-1096-4299-820F-83F1BC9B96F3
     */
    this.registerVar({
      name: AcDbSystemVariables.AUPREC,
      type: 'number',
      isDbVar: true,
      defaultValue: 0
    })
    this.registerVar({
      name: AcDbSystemVariables.CECOLOR,
      type: 'color',
      isDbVar: true,
      defaultValue: new AcCmColor(AcCmColorMethod.ByLayer)
    })
    this.registerVar({
      name: AcDbSystemVariables.CELTSCALE,
      type: 'number',
      isDbVar: true,
      defaultValue: -1
    })
    this.registerVar({
      name: AcDbSystemVariables.CELTYPE,
      type: 'string',
      isDbVar: true,
      defaultValue: ByLayer
    })
    this.registerVar({
      name: AcDbSystemVariables.CELWEIGHT,
      type: 'number',
      isDbVar: true,
      defaultValue: AcGiLineWeight.ByLayer
    })
    this.registerVar({
      name: AcDbSystemVariables.CETRANSPARENCY,
      type: 'transparency',
      isDbVar: true,
      defaultValue: new AcCmTransparency()
    })
    this.registerVar({
      name: AcDbSystemVariables.CLAYER,
      type: 'string',
      isDbVar: true,
      defaultValue: '0'
    })
    /**
     * Sets the name of the current multileader style.
     */
    this.registerVar({
      name: AcDbSystemVariables.CMLEADERSTYLE,
      type: 'string',
      isDbVar: true,
      defaultValue: DEFAULT_MLEADER_STYLE
    })
    /**
     * Controls the overall width of a multiline.
     */
    this.registerVar({
      name: AcDbSystemVariables.CMLSCALE,
      type: 'number',
      isDbVar: true,
      defaultValue: 1
    })
    /**
     * Sets the multiline style that governs the appearance of the multiline.
     */
    this.registerVar({
      name: AcDbSystemVariables.CMLSTYLE,
      type: 'string',
      isDbVar: true,
      defaultValue: DEFAULT_MLINE_STYLE
    })
    /**
     * Color theme of UI elements
     * - 0:	Dark theme
     * - 1:	Light theme
     */
    this.registerVar({
      name: AcDbSystemVariables.COLORTHEME,
      type: 'number',
      isDbVar: false,
      defaultValue: 0
    })
    /**
     * Controls whether hatch objects are included in drawing comparison.
     * - 0: Hatch objects are excluded (AutoCAD default)
     * - 1: Hatch objects are included
     *
     * Saved in the drawing.
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-BBB5E4A0-B607-4898-9A6B-A65C51551EE5
     */
    this.registerVar({
      name: AcDbSystemVariables.COMPAREHATCH,
      type: 'number',
      isDbVar: true,
      defaultValue: ACDB_COMPAREHATCH_DEFAULT
    })
    /**
     * Controls whether a change in an object's non-geometric property is
     * identified as a change between two drawing revisions (bitcode sum):
     * - 0: Property changes are not included (AutoCAD default)
     * - 1: Color
     * - 2: Layer
     * - 4: Linetype
     * - 8: Linetype scale
     * - 16: Lineweight
     * - 32: Transparency
     * - 64: Thickness
     *
     * Saved in the registry (not in the drawing).
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-FC52193A-3801-42D1-B5C3-873B192B36B2
     */
    this.registerVar({
      name: AcDbSystemVariables.COMPAREPROPS,
      type: 'number',
      isDbVar: false,
      defaultValue: ACDB_COMPAREPROPS_DEFAULT
    })
    /**
     * Offset distance between a change-set boundary and the revision cloud.
     * Valid range is **1–25**; higher values produce a larger cloud.
     * Saved in the drawing. AutoCAD initial value is **5**.
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-7A230058-048B-4EE6-949D-105AF6AC8E73
     */
    this.registerVar({
      name: AcDbSystemVariables.COMPARERCMARGIN,
      type: 'number',
      isDbVar: true,
      defaultValue: ACDB_COMPARERCMARGIN_DEFAULT
    })
    /**
     * Controls whether text objects are included in drawing comparison.
     * - 0: Text objects are excluded
     * - 1: Text objects are included (AutoCAD default)
     *
     * Saved in the drawing.
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-1BE58261-FA5F-4914-BAC6-C1DF7E3D1E9C
     */
    this.registerVar({
      name: AcDbSystemVariables.COMPARETEXT,
      type: 'number',
      isDbVar: true,
      defaultValue: ACDB_COMPARETEXT_DEFAULT
    })
    /**
     * Decimal-place tolerance used when comparing two drawings. Objects are
     * considered identical when they differ by at most this precision.
     * Valid range is **0–14**. Saved in the drawing. AutoCAD initial value is **6**.
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-3131F7C8-7199-4EC5-9892-88C2D2A86F78
     */
    this.registerVar({
      name: AcDbSystemVariables.COMPARETOLERANCE,
      type: 'number',
      isDbVar: true,
      defaultValue: ACDB_COMPARETOLERANCE_DEFAULT
    })
    /**
     * - 0: All Dynamic Input features, including dynamic prompts, off
     * - 1: Pointer input on
     * - 2: Dimensional input on
     * - 3: Both pointer input and dimensional input on
     */
    this.registerVar({
      name: AcDbSystemVariables.DYNMODE,
      type: 'number',
      isDbVar: false,
      defaultValue: 3
    })
    this.registerVar({
      name: AcDbSystemVariables.DYNPROMPT,
      type: 'boolean',
      isDbVar: false,
      defaultValue: true
    })
    /**
     * Stores the name of the current drawing, including its file extension.
     * Read-only; synchronized with the active {@link AcDbDatabase} (for example
     * {@link acdbHostApplicationServices | workingDatabase}).
     *
     * @see https://help.autodesk.com/view/ACD/2023/ENU/?caas=caas/documentation/ACD/2014/ENU/files/GUID-A89861EF-5F4F-46C6-A1DB-9D985A3858C9-htm.html
     */
    this.registerVar({
      name: AcDbSystemVariables.DWGNAME,
      type: 'string',
      isDbVar: true,
      readOnly: true,
      defaultValue: 'Drawing1.dwg'
    })
    /**
     * Controls the color of unselected grips as an ACI color index. Valid
     * range is **1??55**. Saved in the registry (not in the drawing).
     *
     * @see https://help.autodesk.com/view/ACD/2024/ENU/?guid=GUID-6D239124-BCB9-430F-91F8-7D7C4DC1A0A4
     */
    this.registerVar({
      name: AcDbSystemVariables.GRIPCOLOR,
      type: 'number',
      isDbVar: false,
      defaultValue: ACDB_GRIPCOLOR_DEFAULT
    })
    /**
     * Controls the color of selected (hot) grips as an ACI color index. Valid
     * range is **1??55**. Saved in the registry (not in the drawing).
     *
     * @see https://help.autodesk.com/view/ACD/2024/ENU/?guid=GUID-96ABB239-7C6F-431B-BB37-672123472EC8
     */
    this.registerVar({
      name: AcDbSystemVariables.GRIPHOT,
      type: 'number',
      isDbVar: false,
      defaultValue: ACDB_GRIPHOT_DEFAULT
    })
    /**
     * Suppresses the display of grips when the initial selection set includes
     * more than the specified number of objects. Valid range is **0??2767**;
     * `0` always displays grips. Saved in the registry (not in the drawing).
     *
     * @see https://help.autodesk.com/view/ACD/2022/ENU/?guid=GUID-705F3A42-4A2F-4B5C-A2A6-0CF8949B8ED5
     */
    this.registerVar({
      name: AcDbSystemVariables.GRIPOBJLIMIT,
      type: 'number',
      isDbVar: false,
      defaultValue: 100
    })
    /**
     * Controls the display of grips on selected objects.
     * - 0: Hides grips
     * - 1: Displays grips
     * - 2: Displays additional midpoint grips on polyline segments
     *
     * Saved in the registry (not in the drawing).
     *
     * @see https://help.autodesk.com/view/ACD/2024/ENU/?caas=caas/documentation/ACDLT/2014/ENU/files/GUID-97AD30F3-A1A3-4027-91B7-49008841A447-htm.html
     */
    this.registerVar({
      name: AcDbSystemVariables.GRIPS,
      type: 'number',
      isDbVar: false,
      defaultValue: 2
    })
    /**
     * Sets the size of the grip box, in device-independent pixels. Valid range
     * is **1??55**. Saved in the registry (not in the drawing).
     *
     * @see https://help.autodesk.com/view/ACD/2024/ENU/?guid=GUID-5F355F5F-0DDE-49B4-B253-C6BA717BAF8B
     */
    this.registerVar({
      name: AcDbSystemVariables.GRIPSIZE,
      type: 'number',
      isDbVar: false,
      defaultValue: ACDB_GRIPSIZE_DEFAULT
    })
    /**
     * Sets the default angle, in radians, for new hatch patterns in this session.
     */
    this.registerVar({
      name: AcDbSystemVariables.HPANG,
      type: 'number',
      isDbVar: false,
      defaultValue: 0
    })
    /**
     * Controls whether newly created hatches and fills are associative.
     * - 0: Not associative
     * - 1: Associative
     */
    this.registerVar({
      name: AcDbSystemVariables.HPASSOC,
      type: 'number',
      isDbVar: false,
      defaultValue: 1
    })
    /**
     * Sets the default background color for new hatch patterns in the current drawing.
     * Use 'None' or '.' for no background color.
     */
    this.registerVar({
      name: AcDbSystemVariables.HPBACKGROUNDCOLOR,
      type: 'color',
      isDbVar: true,
      defaultValue: new AcCmColor(AcCmColorMethod.None)
    })
    /**
     * Sets the default color for new hatches in the current drawing.
     * Use '.' to use the current entity color.
     */
    this.registerVar({
      name: AcDbSystemVariables.HPCOLOR,
      type: 'color',
      isDbVar: true,
      defaultValue: new AcCmColor(AcCmColorMethod.ByLayer)
    })
    /**
     * Controls whether hatch patterns are doubled for user-defined patterns.
     * - 0: Off
     * - 1: On
     */
    this.registerVar({
      name: AcDbSystemVariables.HPDOUBLE,
      type: 'number',
      isDbVar: false,
      defaultValue: 0
    })
    /**
     * Controls how islands within new hatch boundaries are treated.
     * - 0: Normal
     * - 1: Outer
     * - 2: Ignore
     */
    this.registerVar({
      name: AcDbSystemVariables.HPISLANDDETECTION,
      type: 'number',
      isDbVar: false,
      defaultValue: 1
    })
    /**
     * Specifies a default layer for new hatches and fills in the current drawing.
     * Use '.' to use the current layer.
     */
    this.registerVar({
      name: AcDbSystemVariables.HPLAYER,
      type: 'string',
      isDbVar: true,
      defaultValue: '.'
    })
    /**
     * Sets the default hatch pattern name in this session. AutoCAD uses ANSI31
     * for imperial drawings and ANGLE for metric drawings; this database defaults
     * to metric units.
     */
    this.registerVar({
      name: AcDbSystemVariables.HPNAME,
      type: 'string',
      isDbVar: false,
      defaultValue: DEFAULT_HATCH_PATTERN_METRIC
    })
    /**
     * Sets the default scale factor for new hatch patterns in this session.
     */
    this.registerVar({
      name: AcDbSystemVariables.HPSCALE,
      type: 'number',
      isDbVar: false,
      defaultValue: 1
    })
    /**
     * Controls whether one hatch object or separate hatch objects are created
     * when operating on several closed boundaries.
     * - 0: Single hatch object
     * - 1: Separate hatch objects
     */
    this.registerVar({
      name: AcDbSystemVariables.HPSEPARATE,
      type: 'number',
      isDbVar: false,
      defaultValue: 0
    })
    /**
     * Sets the default transparency for new hatches and fills in the current drawing.
     * Use '.' to use the current transparency.
     */
    this.registerVar({
      name: AcDbSystemVariables.HPTRANSPARENCY,
      type: 'transparency',
      isDbVar: true,
      defaultValue: new AcCmTransparency()
    })
    /**
     * Specifies a drawing-units value for automatic scaling of blocks, images, or xrefs
     * inserted or attached into this drawing. Integer codes match AutoCAD (0 = unitless,
     * 1 = inches, 4 = millimeters, etc.); see {@link AcDbUnitsValue}.
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-A58A87BB-482B-4042-A00A-EEF55A2B4FD8
     */
    this.registerVar({
      name: AcDbSystemVariables.INSUNITS,
      type: 'number',
      isDbVar: true,
      defaultValue: AcDbUnitsValue.Millimeters
    })
    /**
     * Displays the user's login name. Read-only through {@link setVar}; host
     * apps initialize it with {@link setLoginName}.
     *
     * @see https://help.autodesk.com/view/ACD/2026/ENU/?caas=caas/documentation/CIV3D/2014/ENU/filesACD/GUID-81446F4E-F6DC-442A-9889-EE777D3D49B9-htm.html
     */
    this.registerVar({
      name: AcDbSystemVariables.LOGINNAME,
      type: 'string',
      isDbVar: false,
      readOnly: true,
      defaultValue: detectDefaultLoginName()
    })
    /**
     * Sets the linear unit display format for coordinates and distances (not insertion scaling).
     * Integer codes match AutoCAD and {@link AcDbLinearUnits}:
     * - `1`: Scientific
     * - `2`: Decimal
     * - `3`: Engineering
     * - `4`: Architectural
     * - `5`: Fractional
     * - `6`: Windows desktop (processing units)
     *
     * @see https://help.autodesk.com/view/ACD/2025/ENU/?guid=GUID-D7C80D1F-B1C0-44A9-898E-B3100FF391CB
     */
    this.registerVar({
      name: AcDbSystemVariables.LUNITS,
      type: 'number',
      isDbVar: true,
      defaultValue: AcDbLinearUnits.Decimal
    })
    /**
     * Sets the display precision for linear distances (decimal places or equivalent), used together
     * with {@link AcDbDatabase.lunits | LUNITS}. Typical range in AutoCAD is **0–8**; common initial value **4**.
     *
     * @see https://help.autodesk.com/view/ACD/2027/ENU/?guid=GUID-5FFF39D6-EFC7-49F5-B56A-6023EB5C0DE7
     */
    this.registerVar({
      name: AcDbSystemVariables.LUPREC,
      type: 'number',
      isDbVar: true,
      defaultValue: 4
    })
    this.registerVar({
      name: AcDbSystemVariables.LWDISPLAY,
      type: 'boolean',
      isDbVar: true,
      defaultValue: false
    })
    /**
     * Legacy metric vs imperial flag (`0` English, `1` metric).
     */
    this.registerVar({
      name: AcDbSystemVariables.MEASUREMENT,
      type: 'number',
      isDbVar: true,
      defaultValue: 1
    })
    /**
     * Color used for measurement tool overlays (distance, area, arc).
     * Default: RGB(96, 165, 250)
     */
    this.registerVar({
      name: AcDbSystemVariables.MEASUREMENTCOLOR,
      type: 'color',
      isDbVar: false,
      defaultValue: (() => {
        const c = new AcCmColor(AcCmColorMethod.ByColor)
        c.setRGB(96, 165, 250)
        return c
      })()
    })
    /**
     * Background color of the model-space drawing area.
     * Default: RGB(0, 0, 0)
     */
    this.registerVar({
      name: AcDbSystemVariables.MODELBKCOLOR,
      type: 'color',
      isDbVar: false,
      defaultValue: (() => {
        const c = new AcCmColor(AcCmColorMethod.ByColor)
        c.setRGB(0, 0, 0)
        return c
      })()
    })
    /**
     * Running Object Snap (OSNAP) modes stored as a bitcode value.
     * Each snap type corresponds to a bit, and the values are added together.
     */
    this.registerVar({
      name: AcDbSystemVariables.OSMODE,
      type: 'number',
      isDbVar: true,
      defaultValue: 0
    })
    /**
     * Constrains cursor movement to the perpendicular (orthogonal locking).
     * - `0`: Turns off Ortho mode
     * - `1`: Turns on Ortho mode
     *
     * @see https://help.autodesk.com/view/ACD/2027/ENU/?caas=caas/documentation/ACD/2014/ENU/files/GUID-CF142B68-675B-452F-B3A8-7831DDB71BD0-htm.html
     */
    this.registerVar({
      name: AcDbSystemVariables.ORTHOMODE,
      type: 'number',
      isDbVar: true,
      defaultValue: 0
    })
    /**
     * Enables open-file performance profiling. When on, stage timings and
     * block-cache stats are printed to the console after the drawing finishes
     * converting. Not stored in the DWG (session/registry style).
     */
    this.registerVar({
      name: AcDbSystemVariables.OPENPROF,
      type: 'boolean',
      isDbVar: false,
      defaultValue: false
    })
    /**
     * Background color of the paper-space (layout) drawing area.
     * Default: RGB(255, 255, 255)
     */
    this.registerVar({
      name: AcDbSystemVariables.PAPERBKCOLOR,
      type: 'color',
      isDbVar: false,
      defaultValue: (() => {
        const c = new AcCmColor(AcCmColorMethod.ByColor)
        c.setRGB(255, 255, 255)
        return c
      })()
    })
    /**
     * Represents the half-size of the pickbox in pixels
     */
    this.registerVar({
      name: AcDbSystemVariables.PICKBOX,
      type: 'number',
      isDbVar: false,
      defaultValue: 10
    })
    /**
     * Stores additional angles for polar tracking and polar snap.
     * Up to 10 angles separated by semicolons (;). Unlike POLARANG, values are
     * absolute angles rather than increments. Only effective when POLARMODE bit 4 is on.
     *
     * @see https://help.autodesk.com/view/ACD/2027/ENU/?guid=GUID-73162BAB-C98D-4159-A653-E4C7D4CB38C3
     */
    this.registerVar({
      name: AcDbSystemVariables.POLARADDANG,
      type: 'string',
      isDbVar: false,
      defaultValue: ''
    })
    /**
     * Controls settings for polar and object snap tracking (bitcode sum):
     * - Bit 0: `0` = measure polar angles from current UCS; `1` = from selected objects
     * - Bit 2: `0` = track orthogonally only; `2` = use polar tracking in object snap tracking
     * - Bit 4: `0` = do not use additional polar angles; `4` = use POLARADDANG angles
     * - Bit 8: `0` = acquire tracking points automatically; `8` = press SHIFT to acquire
     *
     * @see https://help.autodesk.com/view/ACD/2027/ENU/?guid=GUID-D91628CC-9975-4DBF-8D02-10B23A6F3ED5
     */
    this.registerVar({
      name: AcDbSystemVariables.POLARMODE,
      type: 'number',
      isDbVar: false,
      defaultValue: 0
    })
    /**
     * Sets the polar angle increment for polar tracking alignment paths, in degrees.
     * Common values: 90, 45, 30, 22.5, 18, 15, 10, and 5.
     *
     * @see https://help.autodesk.com/view/ACD/2027/ENU/?guid=GUID-0CF67F9E-F953-43D6-9227-0D56E0E693ED
     */
    this.registerVar({
      name: AcDbSystemVariables.POLARANG,
      type: 'number',
      isDbVar: false,
      defaultValue: 90
    })
    /**
     * Controls whether Default, Edit, and Command mode shortcut menus are available in the drawing area.
     * - 0: Disables all Default, Edit, and Command mode shortcut menus.
     * - 1: Enables Default mode shortcut menus.
     * - 2: Enables Edit mode shortcut menus.
     * - 4: Enables Command mode shortcut menus whenever a command is active.
     * - 8: Enables Command mode shortcut menus only when command options are currently available at the Command prompt.
     * - 16: Enables the display of a shortcut menu when the right button on the pointing device is held down long enough
     */
    this.registerVar({
      name: AcDbSystemVariables.SHORTCUTMENU,
      type: 'number',
      isDbVar: false,
      defaultValue: 0
    })
    this.registerVar({
      name: AcDbSystemVariables.TEXTSTYLE,
      type: 'string',
      isDbVar: true,
      defaultValue: DEFAULT_TEXT_STYLE
    })
    /**
     * Feet-inch / fractional delimiter style used with **LUNITS** (`0` report, `1` input).
     */
    this.registerVar({
      name: AcDbSystemVariables.UNITMODE,
      type: 'number',
      isDbVar: true,
      defaultValue: 0
    })
  }

  /**
   * Register one system variable metadata entry.
   */
  public registerVar(desc: AcDbSysVarDescriptor) {
    const name = this.normalizeName(desc.name)
    this.registry.set(name, {
      ...desc,
      name
    })
    if (!desc.isDbVar) {
      this.cache.set(name, desc.defaultValue)
    }
  }

  /**
   * Register many system variables.
   */
  public registerMany(vars: AcDbSysVarDescriptor[]) {
    vars.forEach(v => this.registerVar(v))
  }

  /**
   * Initializes the session {@link AcDbSystemVariables.LOGINNAME} value.
   *
   * {@link setVar} rejects writes because LOGINNAME is read-only for users;
   * host applications call this once at startup (for example after auth).
   *
   * @param value - Login / user display name.
   */
  public setLoginName(value: string): void {
    const name = this.normalizeName(AcDbSystemVariables.LOGINNAME)
    this.cache.set(name, value.trim())
  }

  /**
   * Get system variable value.
   */
  public getVar(name: string, db: AcDbDatabase): AcDbSysVarType | undefined {
    name = this.normalizeName(name)
    const descriptor = this.getDescriptor(name)
    if (!descriptor) {
      throw new Error(`System variable ${name} not found!`)
    }

    if (descriptor.isDbVar) {
      return db[name.toLowerCase() as keyof AcDbDatabase] as AcDbSysVarType
    } else if (this.cache.has(name)) {
      return this.cache.get(name) as AcDbSysVarType
    }

    return undefined
  }

  /**
   * Get system variable default value.
   */
  public getDefaultValue(name: string): AcDbSysVarType | undefined {
    name = this.normalizeName(name)
    const descriptor = this.getDescriptor(name)
    if (!descriptor) {
      throw new Error(`System variable ${name} not found!`)
    }

    return descriptor.defaultValue
  }

  /**
   * Applies one system variable mutation with shared transaction and event rules.
   *
   * Database-backed variables should mutate through {@link AcDbDatabase} property
   * setters or {@link setVar}. Non-database variables mutate through the cache.
   *
   * @param name - System variable name (normalized internally)
   * @param oldVal - Value before mutation; recorded for undo when a transaction is active
   * @param newVal - Value after mutation; used for change detection and event dispatch
   * @param db - Database whose transaction manager governs recording and strict mode
   * @param mutate - Callback that performs the actual value write
   */
  public applyVarMutation<T>(
    name: string,
    oldVal: T,
    newVal: T,
    db: AcDbDatabase,
    mutate: () => void
  ): void {
    const normalizedName = this.normalizeName(name)
    if (
      !this.hasValueChanged(oldVal as AcDbSysVarType, newVal as AcDbSysVarType)
    ) {
      return
    }

    if (db.transactionManager.isRecording()) {
      db.transactionManager.recordSysvar(normalizedName, oldVal)
    } else if (
      db.transactionManager.strictMode &&
      !db.transactionManager.isApplyingUndoRedo()
    ) {
      throw new Error(
        `Cannot change system variable ${normalizedName} outside an active transaction.`
      )
    }

    mutate()

    if (
      !db.transactionManager.isApplyingUndoRedo() &&
      !db.transactionManager.isRecording()
    ) {
      this.events.sysVarChanged.dispatch({
        database: db,
        name: normalizedName,
        newVal: newVal as AcDbSysVarType,
        oldVal: oldVal as AcDbSysVarType
      })
    }
  }

  /**
   * Set system variable value.
   */
  public setVar(name: string, value: AcDbSysVarType, db: AcDbDatabase) {
    name = this.normalizeName(name)
    const descriptor = this.getDescriptor(name)
    if (descriptor) {
      if (descriptor.readOnly) {
        throw new Error(`System variable ${name} is read-only!`)
      }
      const oldVal = this.getVar(name, db)
      if (descriptor.type === 'transparency') {
        const tmp = this.parseTransparency(value)
        if (tmp == null || tmp.isInvalid) {
          throw new Error('Invalid transparency value!')
        }
        value = tmp
      } else if (
        descriptor.type !== 'string' &&
        (typeof value === 'string' || value instanceof String)
      ) {
        if (descriptor.type === 'number') {
          const num = Number(value)
          if (Number.isNaN(num)) {
            throw new Error('Invalid number input!')
          }
          value = num
        } else if (descriptor.type === 'boolean') {
          value = this.parseBoolean(value as string)
        } else if (descriptor.type === 'color') {
          const tmp = this.parseColorSysVar(name, value as string, db)
          if (tmp == null) {
            throw new Error('Invalid color value!')
          }
          value = tmp
        }
      }
      if (name === AcDbSystemVariables.GRIPCOLOR.toLowerCase()) {
        const intVal = Math.trunc(value as number)
        if (
          !Number.isFinite(intVal) ||
          intVal < ACDB_GRIPCOLOR_MIN ||
          intVal > ACDB_GRIPCOLOR_MAX
        ) {
          throw new Error(
            `Invalid GRIPCOLOR value! Valid range is ${ACDB_GRIPCOLOR_MIN} to ${ACDB_GRIPCOLOR_MAX}.`
          )
        }
        value = intVal
      }
      if (name === AcDbSystemVariables.GRIPHOT.toLowerCase()) {
        const intVal = Math.trunc(value as number)
        if (
          !Number.isFinite(intVal) ||
          intVal < ACDB_GRIPHOT_MIN ||
          intVal > ACDB_GRIPHOT_MAX
        ) {
          throw new Error(
            `Invalid GRIPHOT value! Valid range is ${ACDB_GRIPHOT_MIN} to ${ACDB_GRIPHOT_MAX}.`
          )
        }
        value = intVal
      }
      if (name === AcDbSystemVariables.GRIPOBJLIMIT.toLowerCase()) {
        const intVal = Math.trunc(value as number)
        if (!Number.isFinite(intVal) || intVal < 0 || intVal > 32767) {
          throw new Error(
            'Invalid GRIPOBJLIMIT value! Valid range is 0 to 32767.'
          )
        }
        value = intVal
      }
      if (name === AcDbSystemVariables.GRIPS.toLowerCase()) {
        const intVal = Math.trunc(value as number)
        if (!Number.isFinite(intVal) || intVal < 0 || intVal > 2) {
          throw new Error('Invalid GRIPS value! Valid range is 0 to 2.')
        }
        value = intVal
      }
      if (name === AcDbSystemVariables.GRIPSIZE.toLowerCase()) {
        const intVal = Math.trunc(value as number)
        if (
          !Number.isFinite(intVal) ||
          intVal < ACDB_GRIPSIZE_MIN ||
          intVal > ACDB_GRIPSIZE_MAX
        ) {
          throw new Error(
            `Invalid GRIPSIZE value! Valid range is ${ACDB_GRIPSIZE_MIN} to ${ACDB_GRIPSIZE_MAX}.`
          )
        }
        value = intVal
      }
      if (name === AcDbSystemVariables.COMPAREHATCH.toLowerCase()) {
        value = acdbCoerceIntegerSysVar(
          'COMPAREHATCH',
          value,
          ACDB_COMPAREHATCH_MIN,
          ACDB_COMPAREHATCH_MAX
        )
      }
      if (name === AcDbSystemVariables.COMPAREPROPS.toLowerCase()) {
        value = acdbCoerceIntegerSysVar(
          'COMPAREPROPS',
          value,
          ACDB_COMPAREPROPS_MIN,
          ACDB_COMPAREPROPS_MAX
        )
      }
      if (name === AcDbSystemVariables.COMPARERCMARGIN.toLowerCase()) {
        value = acdbCoerceIntegerSysVar(
          'COMPARERCMARGIN',
          value,
          ACDB_COMPARERCMARGIN_MIN,
          ACDB_COMPARERCMARGIN_MAX
        )
      }
      if (name === AcDbSystemVariables.COMPARETEXT.toLowerCase()) {
        value = acdbCoerceIntegerSysVar(
          'COMPARETEXT',
          value,
          ACDB_COMPARETEXT_MIN,
          ACDB_COMPARETEXT_MAX
        )
      }
      if (name === AcDbSystemVariables.COMPARETOLERANCE.toLowerCase()) {
        value = acdbCoerceIntegerSysVar(
          'COMPARETOLERANCE',
          value,
          ACDB_COMPARETOLERANCE_MIN,
          ACDB_COMPARETOLERANCE_MAX
        )
      }
      if (descriptor.isDbVar) {
        this.applyVarMutation(name, oldVal, value, db, () => {
          ;(db as unknown as Record<string, unknown>)[name.toLowerCase()] =
            value
        })
      } else {
        this.applyVarMutation(name, oldVal, value, db, () => {
          this.cache.set(name, value)
        })
      }
    } else {
      throw new Error(`System variable ${name} not found!`)
    }
  }

  /**
   * Get system variable metadata descriptor (if registered).
   */
  public getDescriptor(name: string): AcDbSysVarDescriptor | undefined {
    return this.registry.get(this.normalizeName(name))
  }

  /**
   * Get all registered system variable descriptors.
   */
  public getAllDescriptors(): AcDbSysVarDescriptor[] {
    return [...this.registry.values()]
  }

  /**
   * Parse one string as one boolean value with case-insensitive by ignoring extra spaces
   * - "true" / "false"
   * - "t" / "f"
   * - "1" / "0"
   * - "yes" / "no"
   * - "y" / "n"
   * @param value - One string
   * @returns - The parsed boolean value
   */
  private parseBoolean(value: string | null | undefined) {
    if (value == null) return false

    const v = String(value).trim().toLowerCase()

    const trueValues = new Set(['true', 't', '1', 'yes', 'y'])
    const falseValues = new Set(['false', 'f', '0', 'no', 'n'])

    if (trueValues.has(v)) return true
    if (falseValues.has(v)) return false

    return false
  }

  private parseColorSysVar(name: string, value: string, db: AcDbDatabase) {
    const normalized = value.trim().toLowerCase()
    if (
      name === AcDbSystemVariables.HPCOLOR.toLowerCase() &&
      (normalized === '.' || normalized === 'use current')
    ) {
      return db.cecolor.clone()
    }

    if (
      name === AcDbSystemVariables.HPBACKGROUNDCOLOR.toLowerCase() &&
      (normalized === '' || normalized === '.' || normalized === 'none')
    ) {
      return new AcCmColor(AcCmColorMethod.None)
    }

    return AcCmColor.fromString(value)
  }

  private parseTransparency(value: AcDbSysVarType) {
    if (value instanceof AcCmTransparency) {
      return value
    }
    if (typeof value === 'number') {
      return AcCmTransparency.deserialize(value)
    }
    if (typeof value !== 'string' && !(value instanceof String)) {
      return undefined
    }
    return AcCmTransparency.fromString(String(value))
  }

  /**
   * Check if sysvar value changed.
   */
  private hasValueChanged(
    oldValue: AcDbSysVarType | undefined,
    newValue: AcDbSysVarType | undefined
  ) {
    if (oldValue instanceof AcCmColor && newValue instanceof AcCmColor) {
      return !oldValue.equals(newValue)
    }

    if (
      oldValue instanceof AcCmTransparency &&
      newValue instanceof AcCmTransparency
    ) {
      return !oldValue.equals(newValue)
    }

    return !Object.is(oldValue, newValue)
  }

  /**
   * Normalize system variable name for internal storage and lookup.
   */
  private normalizeName(name: string): string {
    return name.toLowerCase()
  }
}

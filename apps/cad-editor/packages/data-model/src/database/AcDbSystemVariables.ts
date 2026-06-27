/**
 * Supported application color themes exposed through UI-related system variables.
 *
 * - `light`: Light background and panel palette.
 * - `dark`: Dark background and panel palette.
 */
export type AcDbColorTheme = 'light' | 'dark'

/**
 * Canonical names of the system variables currently recognized by the database layer.
 *
 * The value of each field intentionally matches its key so callers can use this object as:
 * - a centralized source of truth for variable names
 * - a type-safe enum-like lookup table
 * - an iterable registry source via `Object.values(...)`
 */
export const AcDbSystemVariables = {
  /** Drawing version identifier, for example `AC1014`. */
  ACADVER: 'ACADVER',
  /** Base angle, in radians, used as the zero direction for angular input/output. */
  ANGBASE: 'ANGBASE',
  /** Positive angle direction flag: `0` for counterclockwise, `1` for clockwise. */
  ANGDIR: 'ANGDIR',
  /** Angular unit display mode, such as decimal degrees or degrees/minutes/seconds. */
  AUNITS: 'AUNITS',
  /** Number of decimal places (or display precision) for angular values; used together with AUNITS. */
  AUPREC: 'AUPREC',
  /** Current color applied to newly created entities. */
  CECOLOR: 'CECOLOR',
  /** Current entity linetype scale multiplier for newly created entities. */
  CELTSCALE: 'CELTSCALE',
  /** Current linetype name used when creating new entities. */
  CELTYPE: 'CELTYPE',
  /** Current lineweight applied to newly created entities. */
  CELWEIGHT: 'CELWEIGHT',
  /** Current transparency level for newly created entities. */
  CETRANSPARENCY: 'CETRANSPARENCY',
  /** Current layer name used when creating new entities. */
  CLAYER: 'CLAYER',
  /** Current multileader style name used when creating new MLEADER entities. */
  CMLEADERSTYLE: 'CMLEADERSTYLE',
  /** Current multiline scale used when creating new MLINE entities. */
  CMLSCALE: 'CMLSCALE',
  /** Current multiline style name used when creating new MLINE entities. */
  CMLSTYLE: 'CMLSTYLE',
  /** UI color theme selector used by the application shell or viewer integration. */
  COLORTHEME: 'COLORTHEME',
  /**
   * Controls the display and behavior of dynamic input at the cursor, enabling or
   * disabling on-screen pointer and dimension input
   */
  DYNMODE: 'DYNMODE',
  /** Controls display of prompts in Dynamic Input tooltips. */
  DYNPROMPT: 'DYNPROMPT',
  /**
   * Name of the current drawing file, including extension (for example `Drawing1.dwg`).
   * Does not include the directory path. Read-only; updated when a drawing is opened or saved.
   *
   * @see https://help.autodesk.com/view/ACD/2023/ENU/?caas=caas/documentation/ACD/2014/ENU/files/GUID-A89861EF-5F4F-46C6-A1DB-9D985A3858C9-htm.html
   */
  DWGNAME: 'DWGNAME',
  /** Upper-right corner of the model-space drawing extents. */
  EXTMAX: 'EXTMAX',
  /** Lower-left corner of the model-space drawing extents. */
  EXTMIN: 'EXTMIN',
  /**
   * ACI color index for unselected grips on selected objects. Valid range is
   * **1–255**. Saved in the registry (not in the drawing).
   *
   * @see https://help.autodesk.com/view/ACD/2024/ENU/?guid=GUID-6D239124-BCB9-430F-91F8-7D7C4DC1A0A4
   */
  GRIPCOLOR: 'GRIPCOLOR',
  /**
   * ACI color index for selected (hot) grips. Valid range is **1–255**. Saved
   * in the registry (not in the drawing).
   *
   * @see https://help.autodesk.com/view/ACD/2024/ENU/?guid=GUID-96ABB239-7C6F-431B-BB37-672123472EC8
   */
  GRIPHOT: 'GRIPHOT',
  /**
   * Maximum number of selected objects that display grips. When the initial
   * selection set exceeds this limit, grips are suppressed to improve
   * performance. `0` disables the limit and always shows grips.
   */
  GRIPOBJLIMIT: 'GRIPOBJLIMIT',
  /**
   * Controls the display of grips on selected objects. `0` hides grips, `1`
   * displays grips, and `2` displays additional midpoint grips on polyline
   * segments. Saved in the registry (not in the drawing).
   *
   * @see https://help.autodesk.com/view/ACD/2024/ENU/?caas=caas/documentation/ACDLT/2014/ENU/files/GUID-97AD30F3-A1A3-4027-91B7-49008841A447-htm.html
   */
  GRIPS: 'GRIPS',
  /**
   * Sets the size of the grip box, in device-independent pixels. Valid range is
   * **1–255**. Saved in the registry (not in the drawing).
   *
   * @see https://help.autodesk.com/view/ACD/2024/ENU/?guid=GUID-5F355F5F-0DDE-49B4-B253-C6BA717BAF8B
   */
  GRIPSIZE: 'GRIPSIZE',
  /** Default angle, in radians, for newly created hatch patterns. */
  HPANG: 'HPANG',
  /** Controls whether newly created hatches are associative. */
  HPASSOC: 'HPASSOC',
  /** Default background color for newly created hatch patterns. */
  HPBACKGROUNDCOLOR: 'HPBACKGROUNDCOLOR',
  /** Default color for newly created hatches. */
  HPCOLOR: 'HPCOLOR',
  /** Controls whether user-defined hatch patterns are doubled. */
  HPDOUBLE: 'HPDOUBLE',
  /** Controls how islands within newly created hatch boundaries are treated. */
  HPISLANDDETECTION: 'HPISLANDDETECTION',
  /** Default layer for newly created hatches and fills. */
  HPLAYER: 'HPLAYER',
  /** Default pattern name for newly created hatches in this session. */
  HPNAME: 'HPNAME',
  /** Default scale factor for newly created hatch patterns. */
  HPSCALE: 'HPSCALE',
  /** Controls whether one or separate hatch objects are created for multiple boundaries. */
  HPSEPARATE: 'HPSEPARATE',
  /** Default transparency for newly created hatches and fills. */
  HPTRANSPARENCY: 'HPTRANSPARENCY',
  /** Insertion units used for automatic scaling of inserted content. */
  INSUNITS: 'INSUNITS',
  /** Global linetype scale multiplier for the drawing database. */
  LTSCALE: 'LTSCALE',
  /** Linear unit display format for coordinates and distances (scientific, decimal, engineering, etc.). */
  LUNITS: 'LUNITS',
  /** Decimal places (or display precision) for linear values; used together with LUNITS. */
  LUPREC: 'LUPREC',
  /** Flag indicating whether lineweights are displayed in the editor/viewer. */
  LWDISPLAY: 'LWDISPLAY',
  /**
   * Legacy drawing measurement system: `0` = English (imperial), `1` = metric.
   * Used with unitless **INSUNITS** to choose default unit labeling.
   */
  MEASUREMENT: 'MEASUREMENT',
  /** Color used for measurement tool overlays (distance, area, arc). */
  MEASUREMENTCOLOR: 'MEASUREMENTCOLOR',
  /** Background color of the model-space drawing area. */
  MODELBKCOLOR: 'MODELBKCOLOR',
  /** Running object snap mode bitmask (OSNAP settings). */
  OSMODE: 'OSMODE',
  /**
   * Orthogonal mode flag: `0` = off, `1` = on. When on, cursor movement is
   * constrained to horizontal or vertical relative to the current UCS.
   */
  ORTHOMODE: 'ORTHOMODE',
  /** Background color of the paper-space (layout) drawing area. */
  PAPERBKCOLOR: 'PAPERBKCOLOR',
  /** Point display style bitmask that controls how POINT entities are drawn. */
  PDMODE: 'PDMODE',
  /** Point display size, expressed as an absolute value or viewport percentage. */
  PDSIZE: 'PDSIZE',
  /** Pickbox half-size, in pixels, used for selection hit testing in the UI. */
  PICKBOX: 'PICKBOX',
  /**
   * Additional polar tracking angles, stored as a semicolon-separated list (up to 10).
   * Only effective when POLARMODE bit 4 is set.
   */
  POLARADDANG: 'POLARADDANG',
  /**
   * Polar and object snap tracking settings stored as a bitcode (sum of bit values).
   */
  POLARMODE: 'POLARMODE',
  /** Polar angle increment, in degrees, for polar tracking alignment paths. */
  POLARANG: 'POLARANG',
  /** Controls whether Default, Edit, and Command mode shortcut menus are available in the drawing area. */
  SHORTCUTMENU: 'SHORTCUTMENU',
  /** Current text style name used when creating new text entities. */
  TEXTSTYLE: 'TEXTSTYLE',
  /**
   * Controls feet-inch and fractional display delimiters together with **LUNITS**
   * (`0` = report format, `1` = input format).
   */
  UNITMODE: 'UNITMODE'
} as const

/**
 * Union of all supported system variable names.
 *
 * Example: `'CLAYER' | 'LTSCALE' | ...`
 */
export type AcDbSystemVariableName =
  (typeof AcDbSystemVariables)[keyof typeof AcDbSystemVariables]

/**
 * Frozen list of all registered system variable names.
 *
 * This is primarily useful for validation, iteration, and building UI selectors.
 */
export const AC_DB_SYSTEM_VARIABLE_NAMES = Object.freeze(
  Object.values(AcDbSystemVariables)
)

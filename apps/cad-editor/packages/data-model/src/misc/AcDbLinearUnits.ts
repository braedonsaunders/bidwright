/**
 * Linear unit **display** formats for coordinates and distances (AutoCAD **LUNITS**).
 *
 * Integer codes match the values stored in the drawing header and system variable **LUNITS**.
 * They describe how lengths are formatted for display and entry, not insertion-unit scaling (**INSUNITS**).
 */
export enum AcDbLinearUnits {
  /** Scientific notation (e.g. `1.5E+01`) */
  Scientific = 1,
  /** Decimal units (e.g. `15.5`) */
  Decimal = 2,
  /** Engineering format: feet as decimal with inches (e.g. `1'-3.5"`) */
  Engineering = 3,
  /** Architectural format: feet and fractional inches */
  Architectural = 4,
  /** Fractional format (e.g. `15-1/2`) */
  Fractional = 5,
  /** Windows desktop / processing format (computational units) */
  WindowsDesktop = 6
}

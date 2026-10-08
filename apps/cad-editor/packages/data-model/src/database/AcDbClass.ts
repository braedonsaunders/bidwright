/**
 * One class definition from a drawing's CLASSES section (DXF) or class table (DWG).
 *
 * Proxy entities (group code **91**) reference classes by 0-based order in this
 * list, with class IDs starting at 500.
 *
 * @see https://help.autodesk.com/view/OARX/2024/ENU/?guid=GUID-A1B647CC-CA99-4AAC-891C-BD138BA425A6
 */
export interface AcDbClass {
  /**
   * DXF record name (group code **1**). Always unique.
   *
   * Example: `'TH_TOLERANCEENT'`.
   */
  name: string
  /**
   * C++ class name (group code **2**). Always unique.
   *
   * Example: `'TH_ToleranceEnt'`.
   */
  cppClassName: string
  /**
   * Application name (group code **3**) shown when the class is not loaded.
   */
  appName: string
  /**
   * Proxy capabilities bit flags (group code **90**).
   */
  proxyFlag: number
  /**
   * Instance count for the custom class (group code **91**).
   */
  instanceCount: number
  /**
   * Whether the class was a proxy when the file was written (group code **280**).
   */
  wasProxy: boolean
  /**
   * Whether instances are entities (group code **281**).
   *
   * `true` when derived from `AcDbEntity` (may appear in BLOCKS/ENTITIES).
   */
  isEntity: boolean
}

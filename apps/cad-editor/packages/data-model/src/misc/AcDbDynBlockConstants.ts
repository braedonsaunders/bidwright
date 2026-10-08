/**
 * Dictionary keys and AppId names used by AutoCAD dynamic blocks.
 *
 * These strings match ObjectARX / DXF conventions so both DWG converters can
 * materialize the same data-model shape for {@link AcDbDynBlockReference}.
 */
export const ACDB_DYN_BLOCK_REPRESENTATION_DICT = 'AcDbBlockRepresentation'
export const ACDB_DYN_BLOCK_REP_DATA = 'AcDbRepData'
export const ACDB_DYN_BLOCK_ENHANCED_BLOCK = 'ACAD_ENHANCEDBLOCK'
export const ACDB_DYN_BLOCK_REP_BTAG_APP = 'AcDbBlockRepBTag'
export const ACDB_DYN_BLOCK_REP_ETAG_APP = 'AcDbBlockRepETag'
export const ACDB_DYN_BLOCK_TRUE_NAME_APP = 'AcDbDynamicBlockTrueName'
export const ACDB_DYN_BLOCK_GUID_APP = 'AcDbDynamicBlockGUID'

/**
 * Returns true when `name` looks like an AutoCAD anonymous user block (`*U…`),
 * which dynamic-block representations use.
 */
export function acdbIsAnonymousUserBlockName(
  name: string | undefined | null
): boolean {
  if (!name) return false
  return name.trim().toUpperCase().startsWith('*U')
}

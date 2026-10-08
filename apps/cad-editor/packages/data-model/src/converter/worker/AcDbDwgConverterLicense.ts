/**
 * Shared helpers for classifying `@mlightcad/dwg-converter` license failures.
 *
 * Markers are kept in sync with the converter's user-facing license messages.
 */

/** Error name thrown by `@mlightcad/dwg-converter` for license failures. */
export const ACDB_DWG_CONVERTER_LICENSE_ERROR_NAME =
  'DwgConverterLicenseError'

/** Machine-readable license failure codes shared by worker and open-database errors. */
export type AcDbDwgConverterLicenseCode =
  | 'license_expired'
  | 'license_invalid'

const LICENSE_EXPIRED_MARKERS = [
  'evaluation of @mlightcad/dwg-converter has expired'
] as const

const LICENSE_INVALID_MARKERS = [
  'invalid @mlightcad/dwg-converter license key'
] as const

/**
 * Returns `true` when {@link code} is a DWG converter license failure code.
 */
export function acdbIsDwgConverterLicenseCode(
  code: unknown
): code is AcDbDwgConverterLicenseCode {
  return code === 'license_expired' || code === 'license_invalid'
}

/**
 * Classifies a license failure message into expired vs invalid.
 *
 * @returns The matching license code, or `undefined` when no marker matches
 */
export function acdbClassifyDwgConverterLicenseMessage(
  message: string
): AcDbDwgConverterLicenseCode | undefined {
  const lower = message.toLowerCase()
  if (LICENSE_EXPIRED_MARKERS.some(marker => lower.includes(marker))) {
    return 'license_expired'
  }
  if (LICENSE_INVALID_MARKERS.some(marker => lower.includes(marker))) {
    return 'license_invalid'
  }
  return undefined
}

/**
 * Classifies a known license error message, defaulting unknown text to invalid.
 */
export function acdbClassifyDwgConverterLicenseMessageOrInvalid(
  message: string
): AcDbDwgConverterLicenseCode {
  return acdbClassifyDwgConverterLicenseMessage(message) ?? 'license_invalid'
}

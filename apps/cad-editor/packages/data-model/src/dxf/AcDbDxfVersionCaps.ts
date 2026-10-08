import {
  AcDbDwgVersion,
  type AcDbDxfVersionCapabilities
} from '../database/AcDbDwgVersion'

export type { AcDbDxfVersionCapabilities }

/**
 * Resolve DXF dialect capabilities for a version name, numeric value,
 * {@link AcDbDwgVersion}, or capabilities object.
 */
export function acdbDxfVersionCaps(
  version?: AcDbDwgVersion | AcDbDxfVersionCapabilities | string | number | null
): AcDbDxfVersionCapabilities {
  if (version == null) {
    return AcDbDwgVersion.latest.capabilities
  }
  if (typeof version === 'object' && 'supportsHandles' in version) {
    return version
  }
  if (version instanceof AcDbDwgVersion) {
    return version.capabilities
  }
  return new AcDbDwgVersion(version).capabilities
}

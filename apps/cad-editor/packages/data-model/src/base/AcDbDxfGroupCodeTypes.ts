/**
 * Maps a DXF group code to the value type it carries.
 *
 * Constant across DXF versions (AC1009 → AC1032+). Reference: AutoCAD DXF
 * Reference "Group Codes in Numerical Order"; ezdxf `lldxf/types.py`.
 */
export type AcDbDxfValueType =
  | 'string'
  | 'int'
  | 'long'
  | 'double'
  | 'bool'
  | 'handle'
  | 'binary'

export type AcDbDxfValueTypeOrComment = AcDbDxfValueType | 'comment'

export function acdbDxfValueType(code: number): AcDbDxfValueTypeOrComment {
  if (code === 999) return 'comment'
  if (code === 5) return 'handle'
  if (code <= 9) return 'string'
  if (code === 100 || code === 102) return 'string'
  if (code === 105) return 'handle'
  if (code >= 101 && code <= 109) return 'string'
  if (code <= 59) return 'double'
  if (code <= 79) return 'int'
  if (code <= 89) return 'string'
  if (code <= 99) return 'int'
  if (code <= 149) return 'double'
  if (code <= 159) return 'string'
  if (code <= 169) return 'long'
  if (code <= 179) return 'int'
  if (code <= 209) return 'string'
  if (code <= 239) return 'double'
  if (code <= 269) return 'long'
  if (code <= 289) return 'int'
  if (code <= 299) return 'bool'
  if (code <= 309) return 'string'
  if (code <= 319) return 'binary'
  if (code <= 369) return 'handle'
  if (code <= 389) return 'int'
  if (code <= 399) return 'handle'
  if (code <= 409) return 'int'
  if (code <= 419) return 'string'
  if (code <= 429) return 'int'
  if (code <= 439) return 'string'
  if (code <= 449) return 'int'
  if (code <= 459) return 'int'
  if (code <= 469) return 'double'
  if (code <= 479) return 'string'
  if (code === 480 || code === 481) return 'handle'

  if (code === 1004) return 'binary'
  if (code === 1005) return 'handle'
  if (code >= 1000 && code <= 1009) return 'string'
  if (code >= 1010 && code <= 1059) return 'double'
  if (code >= 1060 && code <= 1070) return 'int'
  if (code === 1071) return 'int'

  return 'string'
}

/** True iff binary DXF stores this code as int32 (otherwise int16 for `'int'`). */
export function acdbDxfIsInt32Code(code: number): boolean {
  if (code >= 90 && code <= 99) return true
  if (code >= 420 && code <= 429) return true
  if (code >= 440 && code <= 449) return true
  if (code >= 450 && code <= 459) return true
  if (code === 1071) return true
  return false
}

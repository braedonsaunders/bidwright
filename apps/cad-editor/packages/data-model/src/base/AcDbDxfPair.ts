import type { AcDbDxfValueType } from './AcDbDxfGroupCodeTypes'

/**
 * One typed (group code, value) pair from a DXF tag stream.
 *
 * Both ASCII and binary readers produce this shape so consumers stay
 * format-agnostic. Handles stay as hex strings to match {@link AcDbObjectId}.
 */
export type AcDbDxfPair =
  | { code: number; type: 'string'; value: string }
  | { code: number; type: 'int'; value: number }
  | { code: number; type: 'long'; value: number | bigint }
  | { code: number; type: 'double'; value: number }
  | { code: number; type: 'bool'; value: boolean }
  | { code: number; type: 'handle'; value: string }
  | { code: number; type: 'binary'; value: Uint8Array }

export type { AcDbDxfValueType }

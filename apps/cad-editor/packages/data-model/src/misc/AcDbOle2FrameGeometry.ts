/**
 * Parses the AutoCAD OLE2FRAME binary geometry header that precedes the
 * embedded MS-CFB compound document.
 *
 * Layout (little-endian), matching observed DXF group-310 / DWG `data` payloads:
 * - `uint16` marker (commonly `0x5580`)
 * - four `Point3d` corners: upper-left, upper-right, lower-right, lower-left
 * - additional metadata through offset `0x80`
 * - MS-CFB document starting at offset `0x80`
 *
 * @see https://macoy.me/blog/programming/DXFFormat
 * @see LibreDWG `dwg_decode_ole2` notes on `OLE2FRAME.data`
 */

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const
/** Bytes reserved for the OLE2FRAME geometry / metadata header. */
export const ACDB_OLE2FRAME_GEOMETRY_HEADER_SIZE = 0x80
const CORNER_COUNT = 4
const BYTES_PER_COORD = 8
const BYTES_PER_POINT = 3 * BYTES_PER_COORD
const CORNERS_OFFSET = 2
const CORNERS_BYTES = CORNER_COUNT * BYTES_PER_POINT

export interface AcDbOle2FrameGeometryHeader {
  /** Upper-left corner in WCS (DXF group code 10). */
  upperLeft: { x: number; y: number; z: number }
  /** Upper-right corner in WCS. */
  upperRight: { x: number; y: number; z: number }
  /** Lower-right corner in WCS (DXF group code 11). */
  lowerRight: { x: number; y: number; z: number }
  /** Lower-left corner in WCS. */
  lowerLeft: { x: number; y: number; z: number }
}

/**
 * Attempts to read the OLE2FRAME geometry header from an OLE binary payload.
 *
 * @param data - Full OLE2FRAME binary blob (geometry header + CFB).
 * @returns Parsed corners when the header looks valid; otherwise `undefined`.
 */
export function acdbParseOle2FrameGeometryHeader(
  data?: Uint8Array | null
): AcDbOle2FrameGeometryHeader | undefined {
  if (!data || data.length < ACDB_OLE2FRAME_GEOMETRY_HEADER_SIZE) {
    return undefined
  }

  // Real AutoCAD payloads place the MS-CFB compound file at offset 0x80.
  for (let i = 0; i < CFB_SIGNATURE.length; i++) {
    if (data[ACDB_OLE2FRAME_GEOMETRY_HEADER_SIZE + i] !== CFB_SIGNATURE[i]) {
      return undefined
    }
  }

  if (CORNERS_OFFSET + CORNERS_BYTES > ACDB_OLE2FRAME_GEOMETRY_HEADER_SIZE) {
    return undefined
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const readPoint = (offset: number) => {
    const x = view.getFloat64(offset, true)
    const y = view.getFloat64(offset + BYTES_PER_COORD, true)
    const z = view.getFloat64(offset + 2 * BYTES_PER_COORD, true)
    if (![x, y, z].every(Number.isFinite)) {
      return undefined
    }
    return { x, y, z }
  }

  const upperLeft = readPoint(CORNERS_OFFSET)
  const upperRight = readPoint(CORNERS_OFFSET + BYTES_PER_POINT)
  const lowerRight = readPoint(CORNERS_OFFSET + 2 * BYTES_PER_POINT)
  const lowerLeft = readPoint(CORNERS_OFFSET + 3 * BYTES_PER_POINT)
  if (!upperLeft || !upperRight || !lowerRight || !lowerLeft) {
    return undefined
  }

  // Reject degenerate rectangles so raw BMP/test payloads are left alone.
  const width = Math.abs(lowerRight.x - upperLeft.x)
  const height = Math.abs(upperLeft.y - lowerRight.y)
  if (width <= 0 || height <= 0) {
    return undefined
  }

  return { upperLeft, upperRight, lowerRight, lowerLeft }
}

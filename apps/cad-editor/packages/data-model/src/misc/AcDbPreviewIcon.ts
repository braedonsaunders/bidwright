/**
 * Converts AutoCAD block PreviewIcon bytes to a browser-displayable BMP data URL.
 *
 * PreviewIcon data is typically a Device-Independent Bitmap (DIB): a memory copy
 * of {@link https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapinfo | BITMAPINFO}
 * followed by pixel bits (DXF BLOCK_RECORD group 310). A full BMP file also has a
 * 14-byte BITMAPFILEHEADER; this helper prepends that header when needed.
 *
 * @param data - Raw PreviewIcon bytes, or an empty buffer when none exist.
 * @returns A `data:image/bmp;base64,...` URL, or `undefined` when the payload is empty/invalid.
 */
export function acdbPreviewIconToDataUrl(
  data: Uint8Array | undefined | null
): string | undefined {
  if (!data || data.length === 0) return undefined

  const bmpBytes = ensureBmpFileBytes(data)
  if (!bmpBytes) return undefined

  return bytesToDataUrl(bmpBytes, 'image/bmp')
}

/**
 * Converts drawing thumbnail bytes to a browser-displayable data URL.
 *
 * Accepts PNG, JPEG, full BMP files, and DIB payloads (same wrapping as
 * {@link acdbPreviewIconToDataUrl}). Used for DXF `THUMBNAILIMAGE` and DWG
 * preview bitmaps (`Database.ThumbnailBitmap`).
 *
 * @param data - Raw thumbnail bytes, or an empty buffer when none exist.
 * @returns A data URL, or `undefined` when the payload is empty/unsupported.
 */
export function acdbThumbnailImageToDataUrl(
  data: Uint8Array | undefined | null
): string | undefined {
  if (!data || data.length === 0) return undefined

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return bytesToDataUrl(data, 'image/png')
  }

  // JPEG signature: FF D8 FF
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return bytesToDataUrl(data, 'image/jpeg')
  }

  return acdbPreviewIconToDataUrl(data)
}

/**
 * Encodes raw bytes as a `data:` URL for the given MIME type.
 */
function bytesToDataUrl(data: Uint8Array, mime: string): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/**
 * Ensures PreviewIcon bytes are a complete BMP file (with BITMAPFILEHEADER).
 *
 * @param data - DIB or BMP bytes.
 * @returns BMP file bytes, or `undefined` when the input cannot be interpreted.
 */
function ensureBmpFileBytes(data: Uint8Array): Uint8Array | undefined {
  // Already a BMP file ("BM").
  if (data.length >= 14 && data[0] === 0x42 && data[1] === 0x4d) {
    return data
  }

  // Need at least a BITMAPINFOHEADER (biSize + width + height + …).
  if (data.length < 40) return undefined

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const biSize = view.getUint32(0, true)
  if (biSize < 12 || biSize > data.length) return undefined

  const biBitCount = view.getUint16(14, true)
  const biClrUsed = view.getUint32(32, true)
  const paletteEntries =
    biBitCount <= 8
      ? biClrUsed > 0
        ? biClrUsed
        : 1 << biBitCount
      : biClrUsed > 0
        ? biClrUsed
        : 0
  // RGBQUAD is 4 bytes; BITMAPCOREHEADER (12) uses RGBTRIPLE (3 bytes) — rare for previews.
  const paletteBytes = biSize === 12 ? paletteEntries * 3 : paletteEntries * 4
  const pixelOffset = 14 + biSize + paletteBytes
  if (pixelOffset > 14 + data.length) return undefined

  const fileSize = 14 + data.length
  const header = new Uint8Array(14)
  const headerView = new DataView(header.buffer)
  header[0] = 0x42 // 'B'
  header[1] = 0x4d // 'M'
  headerView.setUint32(2, fileSize, true)
  headerView.setUint32(6, 0, true) // reserved
  headerView.setUint32(10, pixelOffset, true)

  const result = new Uint8Array(fileSize)
  result.set(header, 0)
  result.set(data, 14)
  return result
}

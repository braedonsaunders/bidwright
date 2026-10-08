import {
  acdbPreviewIconToDataUrl,
  acdbThumbnailImageToDataUrl
} from '../src/misc/AcDbPreviewIcon'

describe('acdbThumbnailImageToDataUrl', () => {
  it('returns undefined for empty input', () => {
    expect(acdbThumbnailImageToDataUrl(undefined)).toBeUndefined()
    expect(acdbThumbnailImageToDataUrl(new Uint8Array())).toBeUndefined()
  })

  it('detects PNG thumbnails', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
    ])
    expect(acdbThumbnailImageToDataUrl(png)?.startsWith('data:image/png;base64,')).toBe(
      true
    )
  })

  it('detects JPEG thumbnails', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00])
    expect(acdbThumbnailImageToDataUrl(jpeg)?.startsWith('data:image/jpeg;base64,')).toBe(
      true
    )
  })

  it('falls back to BMP/DIB handling', () => {
    const bmp = new Uint8Array([0x42, 0x4d, 0x00, 0x01, 0x00, 0x00])
    expect(acdbThumbnailImageToDataUrl(bmp)).toBe(acdbPreviewIconToDataUrl(bmp))
  })
})

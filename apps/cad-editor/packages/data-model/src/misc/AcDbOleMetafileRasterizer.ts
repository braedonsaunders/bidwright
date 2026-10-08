/**
 * Rasterizes Windows metafile blobs extracted from OLE frames (WMF / EMF)
 * into browser-decodable PNG images via `@mlightcad/emf-converter`.
 *
 * AutoCAD Excel OLE previews are typically stored as CF_ENHMETAFILE / WMF
 * presentation streams. Browsers cannot decode those formats natively, so
 * viewers must convert them to PNG (or similar) before texturing.
 *
 * The converter is a static import so the data-model CJS/Vite bundle inlines
 * the (small) `@mlightcad/emf-converter` implementation.
 */

import { convertEmfToDataUrl, convertWmfToDataUrl } from '@mlightcad/emf-converter'

import {
  ACDB_OLE_METAFILE_EMF_MIME,
  ACDB_OLE_METAFILE_WMF_MIME,
  acdbIsOleMetafileMimeType,
  acdbLooksLikeEmf,
  acdbLooksLikeWmf
} from './AcDbOleMetafileDetect'

/**
 * Default Windows face-name → CSS font-family map for OLE metafile text.
 *
 * Excel table previews frequently embed ExtTextOut runs that name `宋体` /
 * `SimSun`. Without a remapping, browsers that lack that exact face still
 * measure CJK via the default sans fallback in some paths but may fail to
 * paint glyphs inside clipped EMF cells — keep a conservative CJK stack.
 */
const ACDB_OLE_DEFAULT_FONT_FAMILY_MAP: Record<string, string> = {
  宋体: '"SimSun", "NSimSun", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif',
  simsun: '"SimSun", "NSimSun", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  nsimsun: '"NSimSun", "SimSun", "Microsoft YaHei", sans-serif',
  黑体: '"SimHei", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  simhei: '"SimHei", "Microsoft YaHei", sans-serif',
  微软雅黑: '"Microsoft YaHei", "Noto Sans SC", sans-serif',
  'microsoft yahei': '"Microsoft YaHei", "Noto Sans SC", sans-serif'
}

export interface AcDbOleMetafileRasterizeOptions {
  /** Maximum output width in pixels. */
  maxWidth?: number
  /** Maximum output height in pixels. */
  maxHeight?: number
  /**
   * DPI scale factor for higher-resolution output.
   * Defaults to `1` for CAD overlays (sharp enough without huge textures).
   */
  dpiScale?: number
  /** Hard cap on canvas width/height. */
  maxCanvasDimension?: number
  /** Optional Windows face-name → CSS font-family map. */
  fontFamilyMap?: Record<string, string>
}

/**
 * Converts a WMF/EMF {@link Blob} (or raw bytes) to an `image/png` blob.
 *
 * @returns PNG blob, or `undefined` when conversion fails / canvas is unavailable.
 */
export async function acdbRasterizeOleMetafile(
  input: Blob | Uint8Array,
  options: AcDbOleMetafileRasterizeOptions = {}
): Promise<Blob | undefined> {
  const bytes =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(await input.arrayBuffer())
  if (!bytes.length) {
    return undefined
  }

  const mime =
    input instanceof Blob && acdbIsOleMetafileMimeType(input.type)
      ? input.type
      : undefined

  const convertOptions = {
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    dpiScale: options.dpiScale ?? 1,
    maxCanvasDimension: options.maxCanvasDimension,
    // Excel OLE previews commonly use 宋体/SimSun. Map those face names to a
    // CSS stack so Chromium can fall back when the exact Windows face is
    // missing (otherwise ExtTextOut glyphs silently vanish).
    fontFamilyMap: {
      ...ACDB_OLE_DEFAULT_FONT_FAMILY_MAP,
      ...options.fontFamilyMap
    }
  }

  // Fresh ArrayBuffer — converter requires ArrayBuffer (not SharedArrayBuffer).
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

  const tryEmfFirst =
    mime === ACDB_OLE_METAFILE_EMF_MIME ||
    (mime == null && acdbLooksLikeEmf(bytes) && !acdbLooksLikeWmf(bytes))

  let dataUrl: string | null = null

  if (tryEmfFirst) {
    dataUrl = await convertEmfToDataUrl(buffer, convertOptions)
    if (!dataUrl && acdbLooksLikeWmf(bytes)) {
      dataUrl = await convertWmfToDataUrl(buffer, convertOptions)
    }
  } else {
    if (mime === ACDB_OLE_METAFILE_WMF_MIME || acdbLooksLikeWmf(bytes)) {
      dataUrl = await convertWmfToDataUrl(buffer, convertOptions)
    }
    if (!dataUrl && acdbLooksLikeEmf(bytes)) {
      dataUrl = await convertEmfToDataUrl(buffer, convertOptions)
    }
  }

  if (!dataUrl) {
    return undefined
  }

  // Metafile canvases are often transparent; CAD model space is usually dark.
  // Composite onto white so Excel table paper stays readable.
  return compositePngOntoWhite(dataUrl)
}

/**
 * True when `blob` looks like an OLE metafile that needs canvas rasterization
 * before it can be used as a WebGL texture.
 */
export function acdbOleBlobNeedsMetafileRasterization(blob: Blob): boolean {
  return acdbIsOleMetafileMimeType(blob.type)
}

function dataUrlToPngBlob(dataUrl: string): Blob | undefined {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) {
    return undefined
  }
  const meta = dataUrl.slice(5, comma) // after "data:"
  const data = dataUrl.slice(comma + 1)
  const parts = meta.split(';')
  const mime = parts[0] || 'image/png'
  const isBase64 = parts.includes('base64')
  if (isBase64) {
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mime })
  }
  const decoded = decodeURIComponent(data)
  return new Blob([decoded], { type: mime })
}

/**
 * Draws a PNG data-URL onto an opaque white canvas and re-exports PNG.
 * Falls back to the original data-URL blob when no canvas API is available.
 */
async function compositePngOntoWhite(dataUrl: string): Promise<Blob | undefined> {
  const canvasApi = getCanvasFactory()
  if (!canvasApi) {
    return dataUrlToPngBlob(dataUrl)
  }

  try {
    const image = await canvasApi.decodeImage(dataUrl)
    const width = Math.max(1, image.width)
    const height = Math.max(1, image.height)
    const canvas = canvasApi.createCanvas(width, height)
    const ctx = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!ctx) {
      return dataUrlToPngBlob(dataUrl)
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image as CanvasImageSource, 0, 0)

    if (canvas instanceof OffscreenCanvas) {
      return await canvas.convertToBlob({ type: 'image/png' })
    }

    const htmlCanvas = canvas as HTMLCanvasElement
    if (typeof htmlCanvas.toBlob === 'function') {
      return await new Promise<Blob | undefined>(resolve => {
        htmlCanvas.toBlob(
          (blob: Blob | null) => resolve(blob || undefined),
          'image/png'
        )
      })
    }
    if (typeof htmlCanvas.toDataURL === 'function') {
      return dataUrlToPngBlob(htmlCanvas.toDataURL('image/png'))
    }
  } catch {
    // Fall through to the raw converter output.
  }

  return dataUrlToPngBlob(dataUrl)
}

interface AcDbDecodedImage {
  width: number
  height: number
}

interface AcDbCanvasFactory {
  createCanvas: (
    width: number,
    height: number
  ) => HTMLCanvasElement | OffscreenCanvas
  decodeImage: (dataUrl: string) => Promise<AcDbDecodedImage>
}

function getCanvasFactory(): AcDbCanvasFactory | undefined {
  if (typeof OffscreenCanvas !== 'undefined') {
    return {
      createCanvas: (w, h) => new OffscreenCanvas(w, h),
      decodeImage: async dataUrl => {
        const response = await fetch(dataUrl)
        const blob = await response.blob()
        return createImageBitmap(blob)
      }
    }
  }

  if (typeof document !== 'undefined' && document.createElement) {
    return {
      createCanvas: (w, h) => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        return canvas
      },
      decodeImage: dataUrl =>
        new Promise((resolve, reject) => {
          const image = new Image()
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('Failed to decode PNG'))
          image.src = dataUrl
        })
    }
  }

  return undefined
}

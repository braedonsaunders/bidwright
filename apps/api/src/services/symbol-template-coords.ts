// Pure coordinate helpers for the Symbol Library. Split into its own
// module (no workspace deps, no IO) so it can be unit-tested without
// pulling the rest of the service tree.

import type { LegendCellBbox } from "./symbol-legend-service.js";

/** Margin (px at the render DPI) around a legend cell when cropping. */
export const CROP_PADDING_PX = 4;

/**
 * Convert a legend cell's bbox (in PDF inches) to a clipped image-pixel
 * rectangle at the given render DPI. Adds CROP_PADDING_PX on each side to
 * give the matcher a thin border so anti-aliased edges don't trigger
 * false-rejects on slightly-different renderings; clamps to the page
 * bounds so we never overrun the rendered image.
 */
export function bboxInchesToPaddedPixels(
  bbox: LegendCellBbox,
  pageWidthIn: number,
  pageHeightIn: number,
  dpi: number,
): {
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  imageWidth: number;
  imageHeight: number;
} {
  const imageWidth = Math.round(pageWidthIn * dpi);
  const imageHeight = Math.round(pageHeightIn * dpi);
  const rawX = Math.round(bbox.x * dpi);
  const rawY = Math.round(bbox.y * dpi);
  const rawW = Math.round(bbox.width * dpi);
  const rawH = Math.round(bbox.height * dpi);
  const xPx = Math.max(0, rawX - CROP_PADDING_PX);
  const yPx = Math.max(0, rawY - CROP_PADDING_PX);
  const wPx = Math.min(imageWidth - xPx, rawW + CROP_PADDING_PX * 2);
  const hPx = Math.min(imageHeight - yPx, rawH + CROP_PADDING_PX * 2);
  return { xPx, yPx, wPx, hPx, imageWidth, imageHeight };
}

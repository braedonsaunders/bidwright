#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharp = (await import("sharp")).default;

const SOURCE_LOGO = resolve(__dirname, "../../apps/web/public/bidwright-icon.png");
const OUTPUT_ICON = resolve(__dirname, "../../apps/desktop/build/icon.png");

const SIZE = 1024;             // Final icon resolution (down-scaled by OS as needed)
const PADDING = 160;           // White-space ring around the logo
const CORNER_RADIUS = 224;     // Rounded-square corner radius (Apple-ish ~22% of size)
const BG_COLOR = { r: 244, g: 240, b: 230, alpha: 1 }; // Cream — matches Bidwright brand neutral

const innerSize = SIZE - PADDING * 2;

// Rounded-square mask via SVG
const maskSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" rx="${CORNER_RADIUS}" ry="${CORNER_RADIUS}" fill="white"/>
  </svg>`,
);

// Trim transparent padding off the source so the visible logo centers
// inside the rounded square (the original PNG has a lot of whitespace
// pushing the artwork off-center).
const trimmed = await sharp(readFileSync(SOURCE_LOGO))
  .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 10 })
  .toBuffer();

const logoBuffer = await sharp(trimmed)
  .resize(innerSize, innerSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .toBuffer();

const background = await sharp({
  create: {
    width: SIZE,
    height: SIZE,
    channels: 4,
    background: BG_COLOR,
  },
})
  .composite([
    { input: logoBuffer, left: PADDING, top: PADDING },
  ])
  .png()
  .toBuffer();

const rounded = await sharp(background)
  .composite([{ input: maskSvg, blend: "dest-in" }])
  .png()
  .toBuffer();

writeFileSync(OUTPUT_ICON, rounded);
console.log(`Wrote ${OUTPUT_ICON} (${SIZE}x${SIZE}, ${rounded.byteLength} bytes)`);

import { randomInt } from "node:crypto";
import { deflateSync } from "node:zlib";

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function png(width: number, raw: Buffer) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(width, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const digits = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

/** Answers exist only in the pixels and the caller's private scoring record. */
export function imageProbePattern(edge: number, markers = false) {
  if (!Number.isInteger(edge) || edge < 256 || edge > 4096) throw new Error("Probe edge must be 256..4096 pixels");
  const raw = Buffer.alloc(edge * (1 + edge * 3), 255);
  for (let y = 0; y < edge; y++) raw[y * (1 + edge * 3)] = 0;
  const pixel = (x: number, y: number, rgb: number[]) => raw.set(rgb, y * (1 + edge * 3) + 1 + x * 3);
  if (!markers) {
    const palette = [{ name: "red", rgb: [230, 20, 20] }, { name: "green", rgb: [10, 180, 30] },
      { name: "blue", rgb: [20, 40, 230] }, { name: "yellow", rgb: [240, 220, 10] },
      { name: "black", rgb: [0, 0, 0] }, { name: "white", rgb: [255, 255, 255] }];
    for (let i = palette.length - 1; i > 0; i--) { const j = randomInt(i + 1); [palette[i], palette[j]] = [palette[j], palette[i]]; }
    for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) pixel(x, y, palette[(y < edge / 2 ? 0 : 2) + (x < edge / 2 ? 0 : 1)].rgb);
    return { png: png(edge, raw), expected: palette.slice(0, 4).map((color) => color.name), markerScales: [] as number[],
      question: "Return only a JSON array of four lower-case color names in order top-left, top-right, bottom-left, bottom-right." };
  }
  // Nine random 6-digit codes in a 3x3 grid. The top/middle/bottom rows use
  // 1/2/4-pixel strokes, a resolution ladder alongside the readable control row.
  const expected: string[] = [];
  const markerScales = [1, 2, 4];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const scale = markerScales[row];
    const code = Array.from({ length: 6 }, () => String(randomInt(10))).join("");
    expected.push(code);
    const left = Math.floor(edge * (col + 1) / 4) - 12 * scale;
    const top = Math.floor(edge * (row + 1) / 4) - 3 * scale;
    // A light locator square helps find the text without revealing its value.
    for (let d = -12 * scale; d <= 12 * scale; d++) {
      pixel(left - 4 * scale, top + d + 3 * scale, [210, 210, 210]);
      pixel(left + 28 * scale, top + d + 3 * scale, [210, 210, 210]);
    }
    [...code].forEach((digit, index) => {
      for (let y = 0; y < 5 * scale; y++) for (let x = 0; x < 3 * scale; x++) {
        if (digits[Number(digit)][Math.floor(y / scale) * 3 + Math.floor(x / scale)] === "1") pixel(left + index * 4 * scale + x, top + y, [0, 0, 0]);
      }
    });
  }
  return { png: png(edge, raw), expected, markerScales,
    question: "The white image has nine tiny 6-digit codes in a 3 by 3 grid, at quarter/half/three-quarter positions. Top/middle/bottom rows have 1/2/4-pixel strokes. Read all nine codes, preserving leading zeros. Return only a JSON array of nine strings in row-major order; use '?' for unreadable codes." };
}

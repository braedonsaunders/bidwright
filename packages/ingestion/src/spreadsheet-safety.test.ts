import test from "node:test";
import assert from "node:assert/strict";
import {
  assertSafeSpreadsheetArchive,
  inspectSpreadsheetZip,
  neutralizeSpreadsheetFormula,
  SpreadsheetSafetyError,
} from "./spreadsheet-safety.js";

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function makeZipWithDeclaredUncompressedSize(uncompressedSize: number): Uint8Array {
  const filename = new TextEncoder().encode("xl/workbook.xml");
  const localHeaderLength = 30 + filename.byteLength;
  const centralDirectoryOffset = localHeaderLength;
  const centralDirectoryLength = 46 + filename.byteLength;
  const eocdOffset = centralDirectoryOffset + centralDirectoryLength;
  const bytes = new Uint8Array(eocdOffset + 22);

  writeUint32(bytes, 0, 0x04034b50);
  writeUint16(bytes, 26, filename.byteLength);
  bytes.set(filename, 30);

  writeUint32(bytes, centralDirectoryOffset, 0x02014b50);
  writeUint32(bytes, centralDirectoryOffset + 24, uncompressedSize);
  writeUint16(bytes, centralDirectoryOffset + 28, filename.byteLength);
  bytes.set(filename, centralDirectoryOffset + 46);

  writeUint32(bytes, eocdOffset, 0x06054b50);
  writeUint16(bytes, eocdOffset + 8, 1);
  writeUint16(bytes, eocdOffset + 10, 1);
  writeUint32(bytes, eocdOffset + 12, centralDirectoryLength);
  writeUint32(bytes, eocdOffset + 16, centralDirectoryOffset);

  return bytes;
}

test("inspectSpreadsheetZip totals declared uncompressed workbook bytes", () => {
  const zip = makeZipWithDeclaredUncompressedSize(12_345);
  const inspection = inspectSpreadsheetZip(zip);

  assert.equal(inspection.isZip, true);
  assert.equal(inspection.entryCount, 1);
  assert.equal(inspection.totalUncompressedBytes, 12_345);
  assert.equal(inspection.usesZip64, false);
});

test("assertSafeSpreadsheetArchive rejects oversized workbook archives before parsing", () => {
  const zip = makeZipWithDeclaredUncompressedSize(60 * 1024 * 1024);

  assert.throws(
    () => assertSafeSpreadsheetArchive(zip),
    (error) => error instanceof SpreadsheetSafetyError && error.code === "spreadsheet_zip_bomb",
  );
});

test("neutralizeSpreadsheetFormula protects CSV consumers from formula cells", () => {
  assert.equal(neutralizeSpreadsheetFormula("=SUM(A1:A2)"), "'=SUM(A1:A2)");
  assert.equal(neutralizeSpreadsheetFormula("+441234567"), "'+441234567");
  assert.equal(neutralizeSpreadsheetFormula("-10"), "'-10");
  assert.equal(neutralizeSpreadsheetFormula("@IMPORTXML(A1)"), "'@IMPORTXML(A1)");
  assert.equal(neutralizeSpreadsheetFormula("Plain text"), "Plain text");
});

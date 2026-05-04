export const DEFAULT_MAX_UNCOMPRESSED_SPREADSHEET_BYTES = 50 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_SENTINEL = 0xffffffff;
const EOCD_MIN_LENGTH = 22;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export type SpreadsheetSafetyErrorCode =
  | "spreadsheet_zip_bomb"
  | "spreadsheet_zip_malformed";

export class SpreadsheetSafetyError extends Error {
  readonly code: SpreadsheetSafetyErrorCode;
  readonly statusCode: number;

  constructor(message: string, code: SpreadsheetSafetyErrorCode, statusCode = 413) {
    super(message);
    this.name = "SpreadsheetSafetyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface SpreadsheetArchiveInspection {
  isZip: boolean;
  entryCount: number;
  totalUncompressedBytes: number;
  usesZip64: boolean;
}

export interface SpreadsheetArchiveSafetyOptions {
  maxUncompressedBytes?: number;
}

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function hasBytes(bytes: Uint8Array, offset: number, length: number): boolean {
  return offset >= 0 && length >= 0 && offset + length <= bytes.byteLength;
}

function readUint16(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 2)) return 0;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 4)) return 0;
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.byteLength - EOCD_MIN_LENGTH - ZIP_MAX_COMMENT_LENGTH);
  for (let offset = bytes.byteLength - EOCD_MIN_LENGTH; offset >= minOffset; offset--) {
    if (readUint32(bytes, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "more than the supported limit";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} bytes`;
}

export function inspectSpreadsheetZip(input: Uint8Array | ArrayBuffer): SpreadsheetArchiveInspection {
  const bytes = toBytes(input);
  if (bytes.byteLength < EOCD_MIN_LENGTH || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      isZip: false,
      entryCount: 0,
      totalUncompressedBytes: bytes.byteLength,
      usesZip64: false,
    };
  }

  const eocdOffset = findEndOfCentralDirectory(bytes);
  if (eocdOffset < 0) {
    throw new SpreadsheetSafetyError(
      "Spreadsheet archive is malformed and cannot be safely inspected.",
      "spreadsheet_zip_malformed",
      400,
    );
  }

  const totalEntries = readUint16(bytes, eocdOffset + 10);
  const centralDirectorySize = readUint32(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(bytes, eocdOffset + 16);
  let usesZip64 =
    totalEntries === 0xffff ||
    centralDirectorySize === ZIP64_SENTINEL ||
    centralDirectoryOffset === ZIP64_SENTINEL;

  if (usesZip64) {
    return {
      isZip: true,
      entryCount: totalEntries,
      totalUncompressedBytes: Number.POSITIVE_INFINITY,
      usesZip64,
    };
  }

  if (
    !hasBytes(bytes, centralDirectoryOffset, centralDirectorySize) ||
    centralDirectoryOffset + centralDirectorySize > eocdOffset
  ) {
    throw new SpreadsheetSafetyError(
      "Spreadsheet archive has an invalid central directory.",
      "spreadsheet_zip_malformed",
      400,
    );
  }

  let offset = centralDirectoryOffset;
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  while (offset < centralDirectoryEnd && entryCount < totalEntries) {
    if (!hasBytes(bytes, offset, 46) || readUint32(bytes, offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new SpreadsheetSafetyError(
        "Spreadsheet archive has an unreadable central directory entry.",
        "spreadsheet_zip_malformed",
        400,
      );
    }

    const uncompressedSize = readUint32(bytes, offset + 24);
    const fileNameLength = readUint16(bytes, offset + 28);
    const extraFieldLength = readUint16(bytes, offset + 30);
    const fileCommentLength = readUint16(bytes, offset + 32);

    if (uncompressedSize === ZIP64_SENTINEL) {
      usesZip64 = true;
      totalUncompressedBytes = Number.POSITIVE_INFINITY;
      entryCount++;
      break;
    }

    totalUncompressedBytes += uncompressedSize;
    entryCount++;
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return {
    isZip: true,
    entryCount,
    totalUncompressedBytes,
    usesZip64,
  };
}

export function assertSafeSpreadsheetArchive(
  input: Uint8Array | ArrayBuffer,
  options: SpreadsheetArchiveSafetyOptions = {},
): SpreadsheetArchiveInspection {
  const inspection = inspectSpreadsheetZip(input);
  const maxUncompressedBytes =
    options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_SPREADSHEET_BYTES;

  if (inspection.isZip && inspection.totalUncompressedBytes > maxUncompressedBytes) {
    throw new SpreadsheetSafetyError(
      `Spreadsheet expands to ${formatBytes(inspection.totalUncompressedBytes)}, above the ${formatBytes(maxUncompressedBytes)} safety limit.`,
      "spreadsheet_zip_bomb",
      413,
    );
  }

  return inspection;
}

export function neutralizeSpreadsheetFormula(value: string): string;
export function neutralizeSpreadsheetFormula<T>(value: T): T;
export function neutralizeSpreadsheetFormula(value: unknown): unknown {
  if (typeof value !== "string" || value.length === 0) return value;
  return FORMULA_PREFIXES.has(value[0]) ? `'${value}` : value;
}

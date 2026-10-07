import { readFile } from 'node:fs/promises';

import JSZip from 'jszip';

import type { ArchiveEntry } from './types.js';

function getExtension(path: string): string {
  const parts = path.split('.');
  if (parts.length < 2) {
    return '';
  }

  return parts.at(-1)?.toLowerCase() ?? '';
}

function inferMimeType(extension: string): string | undefined {
  switch (extension) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc':
      return 'application/msword';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'xlsm':
      return 'application/vnd.ms-excel.sheet.macroEnabled.12';
    case 'ods':
      return 'application/vnd.oasis.opendocument.spreadsheet';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'csv':
      return 'text/csv';
    case 'tsv':
      return 'text/tab-separated-values';
    case 'rtf':
      return 'application/rtf';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'mhtml':
    case 'mht':
      return 'multipart/related';
    case 'txt':
    case 'md':
      return 'text/plain';
    case 'json':
      return 'application/json';
    case 'xml':
    case 'p6xml':
    case 'pmxml':
      return 'application/xml';
    case 'msg':
      return 'application/vnd.ms-outlook';
    case 'eml':
      return 'message/rfc822';
    case 'mpp':
    case 'mpt':
      return 'application/vnd.ms-project';
    case 'mpx':
      return 'application/x-project';
    case 'xer':
      return 'text/plain';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'bmp':
      return 'image/bmp';
    default:
      return undefined;
  }
}

export async function loadZipInput(input: string | Buffer | Uint8Array | ArrayBuffer): Promise<JSZip> {
  if (typeof input === 'string') {
    const bytes = await readFile(input);
    return JSZip.loadAsync(bytes);
  }

  if (input instanceof ArrayBuffer) {
    return JSZip.loadAsync(input);
  }

  return JSZip.loadAsync(input);
}

const MAX_ARCHIVE_DEPTH = 4;
const MAX_EXPANDED_BYTES = 4 * 1024 * 1024 * 1024;
const NESTED_ARCHIVE_EXTENSIONS = new Set(['zip']);

function isIgnoredArchiveEntry(path: string): boolean {
  const segments = path.split('/');
  const base = segments.at(-1) ?? '';
  return segments.includes('__MACOSX') || base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db';
}

/**
 * Flattens an archive into file entries. ZIPs found inside the archive are
 * expanded in place, so `drawings.zip/A-101.pdf` becomes its own entry; an
 * archive that nobody can read stays a single opaque entry instead of
 * silently swallowing the drawings inside it.
 */
export async function extractArchiveEntries(input: string | Buffer | Uint8Array | ArrayBuffer): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  const budget = { bytes: 0 };
  await collectArchiveEntries(await loadZipInput(input), '', 0, entries, budget);
  return entries;
}

async function collectArchiveEntries(
  zip: JSZip,
  prefix: string,
  depth: number,
  entries: ArchiveEntry[],
  budget: { bytes: number },
): Promise<void> {
  const fileNames = Object.keys(zip.files).sort();
  for (const fileName of fileNames) {
    const file = zip.files[fileName];
    if (!file || file.dir) {
      continue;
    }

    const normalizedPath = `${prefix}${fileName.replace(/^\/+/, '')}`;
    if (isIgnoredArchiveEntry(normalizedPath)) {
      continue;
    }

    const bytes = new Uint8Array(await file.async('uint8array'));
    budget.bytes += bytes.byteLength;
    if (budget.bytes > MAX_EXPANDED_BYTES) {
      throw new Error(`Archive expands past ${MAX_EXPANDED_BYTES} bytes; refusing to continue`);
    }
    const extension = getExtension(normalizedPath);

    if (NESTED_ARCHIVE_EXTENSIONS.has(extension) && depth < MAX_ARCHIVE_DEPTH) {
      const nested = await JSZip.loadAsync(bytes).catch(() => null);
      if (nested) {
        await collectArchiveEntries(nested, `${normalizedPath}/`, depth + 1, entries, budget);
        continue;
      }
    }

    entries.push({
      path: normalizedPath,
      name: normalizedPath.split('/').at(-1) ?? normalizedPath,
      extension,
      size: bytes.byteLength,
      bytes,
      mimeType: inferMimeType(extension),
    });
  }
}

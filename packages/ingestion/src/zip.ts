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
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'csv':
      return 'text/csv';
    case 'txt':
    case 'md':
      return 'text/plain';
    case 'json':
      return 'application/json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
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

export async function extractArchiveEntries(input: string | Buffer | Uint8Array | ArrayBuffer): Promise<ArchiveEntry[]> {
  const zip = await loadZipInput(input);
  const entries: ArchiveEntry[] = [];

  const fileNames = Object.keys(zip.files).sort();
  for (const fileName of fileNames) {
    const file = zip.files[fileName];
    if (!file || file.dir) {
      continue;
    }

    const bytes = new Uint8Array(await file.async('uint8array'));
    const normalizedPath = fileName.replace(/^\/+/, '');
    const extension = getExtension(normalizedPath);

    entries.push({
      path: normalizedPath,
      name: normalizedPath.split('/').at(-1) ?? normalizedPath,
      extension,
      size: bytes.byteLength,
      bytes,
      mimeType: inferMimeType(extension),
    });
  }

  return entries;
}

/**
 * File handlers for non-PDF document types.
 *
 * Each handler implements the `FileHandler` interface and can parse a
 * specific category of files into a `ParsedDocument`. The registry
 * function returns all built-in handlers, and `parseFile()` is a
 * convenience that tries each handler in turn.
 */

import type {
  ExtractedTable,
  FileHandler,
  PageSection,
  ParsedDocument,
  ParsedPage,
} from './pdf-types.js';

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

const EXCEL_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const CSV_MIMES = new Set([
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
]);

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

const TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'application/xml',
  'text/xml',
  'text/yaml',
  'application/x-yaml',
]);

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Excel / CSV Handler
// ---------------------------------------------------------------------------

const excelCsvHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (EXCEL_MIMES.has(mimeType) || CSV_MIMES.has(mimeType)) return true;
    const ext = extOf(filename);
    return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const warnings: string[] = [];
    let XLSX: typeof import('xlsx');

    try {
      XLSX = await import('xlsx');
    } catch {
      throw new Error(
        'Excel/CSV parsing requires the "xlsx" package. Install with: pnpm add xlsx',
      );
    }

    const workbook = XLSX.read(input, { type: 'buffer' });
    const pages: ParsedPage[] = [];
    const tables: ExtractedTable[] = [];
    const contentParts: string[] = [];

    for (let i = 0; i < workbook.SheetNames.length; i++) {
      const sheetName = workbook.SheetNames[i];
      const sheet = workbook.Sheets[sheetName];
      const pageNumber = i + 1;

      // Convert sheet to array of arrays
      const data: string[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        raw: false,
      }) as string[][];

      if (data.length === 0) {
        warnings.push(`Sheet "${sheetName}" is empty.`);
        continue;
      }

      // First row is treated as headers
      const headers = data[0].map(String);
      const rows = data.slice(1).map((row) => row.map(String));

      // Build markdown table
      const mdHeader = `| ${headers.join(' | ')} |`;
      const mdSep = `| ${headers.map(() => '---').join(' | ')} |`;
      const mdRows = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
      const rawMarkdown = `${mdHeader}\n${mdSep}\n${mdRows}`;

      tables.push({
        pageNumber,
        title: sheetName,
        headers,
        rows,
        rawMarkdown,
      });

      // Build text content for the page
      const textContent = `## ${sheetName}\n\n${rawMarkdown}`;
      contentParts.push(textContent);

      const sections: PageSection[] = [
        {
          title: sheetName,
          content: rawMarkdown,
          level: 2,
          pageNumber,
        },
      ];

      pages.push({
        pageNumber,
        content: textContent,
        sections,
      });
    }

    const ext = extOf(filename);
    const mimeType = ['xlsx', 'xls'].includes(ext)
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv';

    return {
      title: filename.replace(/\.[^.]+$/, ''),
      content: contentParts.join('\n\n'),
      pages,
      tables,
      metadata: {
        pageCount: pages.length,
        fileSize: input.byteLength,
        mimeType,
        hasImages: false,
        hasOcr: false,
      },
      warnings,
    };
  },
};

// ---------------------------------------------------------------------------
// Image Handler
// ---------------------------------------------------------------------------

const imageHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (IMAGE_MIMES.has(mimeType)) return true;
    const ext = extOf(filename);
    return ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'webp', 'gif', 'bmp'].includes(ext);
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const ext = extOf(filename);
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      tiff: 'image/tiff',
      tif: 'image/tiff',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
    };

    const mimeType = mimeMap[ext] ?? 'image/png';
    const base64 = input.toString('base64');
    const title = filename.replace(/\.[^.]+$/, '');

    const page: ParsedPage = {
      pageNumber: 1,
      content: `[Image: ${filename}]`,
      sections: [
        {
          content: `[Image: ${filename}]`,
          level: 1,
          pageNumber: 1,
        },
      ],
      images: [
        {
          pageNumber: 1,
          base64,
        },
      ],
    };

    return {
      title,
      content: `[Image: ${filename}]`,
      pages: [page],
      tables: [],
      metadata: {
        pageCount: 1,
        fileSize: input.byteLength,
        mimeType,
        hasImages: true,
        hasOcr: false,
      },
      warnings: [],
    };
  },
};

// ---------------------------------------------------------------------------
// Plain Text / Markdown Handler
// ---------------------------------------------------------------------------

const textMarkdownHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (TEXT_MIMES.has(mimeType)) return true;
    const ext = extOf(filename);
    return ['txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'log', 'cfg', 'ini'].includes(ext);
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const text = input.toString('utf8');
    const ext = extOf(filename);
    const isMarkdown = ['md', 'markdown'].includes(ext);

    // Parse sections from markdown headings
    const sections: PageSection[] = [];

    if (isMarkdown) {
      const headingRe = /^(#{1,6})\s+(.+)$/gm;
      let lastIndex = 0;
      let lastTitle: string | undefined;
      let lastLevel = 0;
      let match: RegExpExecArray | null;

      while ((match = headingRe.exec(text)) !== null) {
        const content = text.slice(lastIndex, match.index).trim();
        if (content || lastTitle) {
          sections.push({
            title: lastTitle,
            content,
            level: lastLevel || 1,
            pageNumber: 1,
          });
        }
        lastTitle = match[2].trim();
        lastLevel = match[1].length;
        lastIndex = match.index + match[0].length;
      }

      const trailing = text.slice(lastIndex).trim();
      if (trailing) {
        sections.push({
          title: lastTitle,
          content: trailing,
          level: lastLevel || 1,
          pageNumber: 1,
        });
      }
    }

    if (sections.length === 0) {
      sections.push({ content: text, level: 1, pageNumber: 1 });
    }

    const mimeMap: Record<string, string> = {
      md: 'text/markdown',
      markdown: 'text/markdown',
      json: 'application/json',
      xml: 'application/xml',
      yaml: 'text/yaml',
      yml: 'text/yaml',
    };

    return {
      title: filename.replace(/\.[^.]+$/, ''),
      content: text,
      pages: [
        {
          pageNumber: 1,
          content: text,
          sections,
        },
      ],
      tables: [],
      metadata: {
        pageCount: 1,
        fileSize: input.byteLength,
        mimeType: mimeMap[ext] ?? 'text/plain',
        hasImages: false,
        hasOcr: false,
      },
      warnings: [],
    };
  },
};

// ---------------------------------------------------------------------------
// Registry & convenience
// ---------------------------------------------------------------------------

/**
 * Create the default file handler registry.
 *
 * Returns handlers in priority order: Excel/CSV, images, text/markdown.
 */
export function createFileHandlerRegistry(): FileHandler[] {
  return [excelCsvHandler, imageHandler, textMarkdownHandler];
}

/**
 * Parse a file using the first matching handler from the registry.
 *
 * @param buffer  Raw file contents
 * @param filename  Original filename (used for extension-based detection)
 * @param mimeType  Optional MIME type hint
 * @returns The parsed document, or a minimal stub if no handler matched
 */
export async function parseFile(
  buffer: Buffer,
  filename: string,
  mimeType?: string,
): Promise<ParsedDocument> {
  const handlers = createFileHandlerRegistry();
  const mime = mimeType ?? '';

  for (const handler of handlers) {
    if (handler.canHandle(mime, filename)) {
      try {
        return await handler.parse(buffer, filename);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Return a partial result instead of crashing
        return {
          title: filename.replace(/\.[^.]+$/, ''),
          content: '',
          pages: [],
          tables: [],
          metadata: {
            pageCount: 0,
            fileSize: buffer.byteLength,
            mimeType: mime,
            hasImages: false,
            hasOcr: false,
          },
          warnings: [`File handler failed: ${msg}`],
        };
      }
    }
  }

  // No handler matched — return stub
  return {
    title: filename.replace(/\.[^.]+$/, ''),
    content: '',
    pages: [],
    tables: [],
    metadata: {
      pageCount: 0,
      fileSize: buffer.byteLength,
      mimeType: mime,
      hasImages: false,
      hasOcr: false,
    },
    warnings: [`No file handler found for "${filename}" (mime: ${mime || 'unknown'}).`],
  };
}

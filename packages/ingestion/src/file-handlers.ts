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
import { assertSafeSpreadsheetArchive } from './spreadsheet-safety.js';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { parse as parseHtml } from 'node-html-parser';
import PostalMime from 'postal-mime';

// ---------------------------------------------------------------------------
// MIME type helpers
// ---------------------------------------------------------------------------

const EXCEL_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const DOCX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const LEGACY_WORD_MIMES = new Set([
  'application/msword',
  'application/vnd.ms-word',
]);

const RTF_MIMES = new Set([
  'application/rtf',
  'text/rtf',
  'application/x-rtf',
]);

const PPTX_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const HTML_MIMES = new Set([
  'text/html',
  'application/xhtml+xml',
]);

const MHTML_MIMES = new Set([
  'multipart/related',
  'message/rfc822',
  'application/x-mimearchive',
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

const WORD_EXTRACTOR_MODULE = 'word-extractor';
const RTF_PARSER_MODULE = 'rtf-parser';

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// DOCX Handler
// ---------------------------------------------------------------------------

type XmlNode = Record<string, unknown>;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
  trimValues: false,
  parseTagValue: false,
  preserveOrder: true,
});

function asXmlArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function isXmlNode(value: unknown): value is XmlNode {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function nodeTag(node: unknown): string | null {
  if (!isXmlNode(node)) return null;
  return Object.keys(node).find((key) => key !== ':@') ?? null;
}

function nodeChildren(node: unknown): unknown[] {
  if (!isXmlNode(node)) return [];
  const tag = nodeTag(node);
  return tag ? asXmlArray(node[tag]) : [];
}

function findFirstChildren(nodes: unknown[], tagName: string): unknown[] | null {
  for (const node of nodes) {
    if (!isXmlNode(node)) continue;
    const tag = nodeTag(node);
    if (tag === tagName) return nodeChildren(node);
    const nested = findFirstChildren(nodeChildren(node), tagName);
    if (nested) return nested;
  }
  return null;
}

function findNodeAttribute(nodes: unknown[], tagName: string, attributeNames: string[]): string | undefined {
  for (const node of nodes) {
    if (!isXmlNode(node)) continue;
    const tag = nodeTag(node);
    if (tag === tagName) {
      const attrs = node[':@'];
      if (isXmlNode(attrs)) {
        for (const attributeName of attributeNames) {
          const value = attrs[attributeName];
          if (typeof value === 'string') return value;
        }
      }
    }
    const nested = findNodeAttribute(nodeChildren(node), tagName, attributeNames);
    if (nested) return nested;
  }
  return undefined;
}

function collectWordText(nodes: unknown[]): string {
  const parts: string[] = [];

  const visit = (value: unknown) => {
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isXmlNode(value)) return;

    for (const [key, child] of Object.entries(value)) {
      if (key === ':@') continue;
      if (key === '#text') {
        visit(child);
      } else if (key === 'tab') {
        parts.push('\t');
      } else if (key === 'br' || key === 'cr') {
        parts.push('\n');
      } else if (key === 'drawing' || key === 'pict' || key === 'object') {
        continue;
      } else {
        visit(child);
      }
    }
  };

  visit(nodes);
  return parts.join('').replace(/\u00a0/g, ' ');
}

function markdownEscapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function paragraphLevel(styleId?: string): number | undefined {
  if (!styleId) return undefined;
  const normalized = styleId.replace(/\s+/g, '').toLowerCase();
  if (normalized === 'title') return 1;
  const match = normalized.match(/^heading([1-6])$/);
  return match ? Number(match[1]) : undefined;
}

function parseDocxParagraph(nodes: unknown[]): { text: string; level?: number; styleId?: string } | null {
  const text = collectWordText(nodes).replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
  if (!text) return null;
  const styleId = findNodeAttribute(nodes, 'pStyle', ['@_val', 'val']);
  return { text, level: paragraphLevel(styleId), styleId };
}

function directChildrenByTag(nodes: unknown[], tagName: string): unknown[] {
  return nodes.filter((node) => nodeTag(node) === tagName);
}

function findNodesByTag(nodes: unknown[], tagName: string): unknown[] {
  const matches: unknown[] = [];
  const visit = (node: unknown) => {
    if (nodeTag(node) === tagName) {
      matches.push(node);
    }
    for (const child of nodeChildren(node)) {
      visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return matches;
}

function tableCellText(nodes: unknown[]): string {
  const paragraphTexts = directChildrenByTag(nodes, 'p')
    .map((node) => parseDocxParagraph(nodeChildren(node))?.text)
    .filter((text): text is string => !!text);

  if (paragraphTexts.length > 0) {
    return paragraphTexts.join(' / ');
  }

  return collectWordText(nodes).replace(/\s+/g, ' ').trim();
}

function parseDocxTable(nodes: unknown[], pageNumber: number, title?: string): ExtractedTable | null {
  const rows = directChildrenByTag(nodes, 'tr')
    .map((rowNode) => directChildrenByTag(nodeChildren(rowNode), 'tc')
      .map((cellNode) => tableCellText(nodeChildren(cellNode))))
    .filter((row) => row.some((cell) => cell.trim()));

  if (rows.length === 0) return null;

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ''));
  const headers = normalizedRows[0].map((header, index) => header.trim() || `Column ${index + 1}`);
  const dataRows = normalizedRows.slice(1);
  const rawMarkdown = [
    `| ${headers.map(markdownEscapeCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...dataRows.map((row) => `| ${row.map(markdownEscapeCell).join(' | ')} |`),
  ].join('\n');

  return {
    pageNumber,
    title,
    headers,
    rows: dataRows,
    rawMarkdown,
  };
}

function parseDocxBlocks(nodes: unknown[], pageNumber: number): {
  contentParts: string[];
  sections: PageSection[];
  tables: ExtractedTable[];
} {
  const contentParts: string[] = [];
  const sections: PageSection[] = [];
  const tables: ExtractedTable[] = [];
  let lastHeading: string | undefined;

  for (const node of nodes) {
    const tag = nodeTag(node);
    const children = nodeChildren(node);

    if (tag === 'p') {
      const paragraph = parseDocxParagraph(children);
      if (!paragraph) continue;

      const level = paragraph.level ?? 1;
      const markdown = paragraph.level
        ? `${'#'.repeat(paragraph.level)} ${paragraph.text}`
        : paragraph.text;
      contentParts.push(markdown);
      sections.push({
        title: paragraph.level ? paragraph.text : lastHeading,
        content: paragraph.text,
        level,
        pageNumber,
      });
      if (paragraph.level) lastHeading = paragraph.text;
    } else if (tag === 'tbl') {
      const table = parseDocxTable(children, pageNumber, lastHeading);
      if (!table) continue;
      tables.push(table);
      contentParts.push(table.rawMarkdown);
      sections.push({
        title: table.title,
        content: table.rawMarkdown,
        level: 2,
        pageNumber,
      });
    }
  }

  return { contentParts, sections, tables };
}

async function parseDocxXmlPart(zip: JSZip, path: string, pageNumber: number): Promise<{
  content: string;
  sections: PageSection[];
  tables: ExtractedTable[];
}> {
  const file = zip.file(path);
  if (!file) return { content: '', sections: [], tables: [] };

  const xml = await file.async('text');
  const parsed = xmlParser.parse(xml);
  const body = findFirstChildren(asXmlArray(parsed), 'body');
  const rootChildren = body ?? findFirstChildren(asXmlArray(parsed), 'hdr') ?? findFirstChildren(asXmlArray(parsed), 'ftr') ?? asXmlArray(parsed);
  const { contentParts, sections, tables } = parseDocxBlocks(rootChildren, pageNumber);

  return {
    content: contentParts.join('\n\n').trim(),
    sections,
    tables,
  };
}

const docxHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (DOCX_MIMES.has(mimeType)) return true;
    return extOf(filename) === 'docx';
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const zip = await JSZip.loadAsync(input);
    const warnings: string[] = [];
    const title = filename.replace(/\.[^.]+$/, '');

    if (!zip.file('word/document.xml')) {
      throw new Error('DOCX package is missing word/document.xml.');
    }

    const main = await parseDocxXmlPart(zip, 'word/document.xml', 1);
    const supplementalParts = Object.keys(zip.files)
      .filter((path) => /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/i.test(path))
      .sort();

    const supplementalContent: string[] = [];
    const supplementalSections: PageSection[] = [];
    const supplementalTables: ExtractedTable[] = [];
    for (const partPath of supplementalParts) {
      const parsed = await parseDocxXmlPart(zip, partPath, 1);
      if (!parsed.content) continue;
      supplementalContent.push(`## ${partPath}\n\n${parsed.content}`);
      supplementalSections.push(...parsed.sections);
      supplementalTables.push(...parsed.tables);
    }

    const content = [main.content, ...supplementalContent].filter(Boolean).join('\n\n');
    if (!content) {
      warnings.push('No readable text was found in the DOCX package.');
    }

    const sections = [...main.sections, ...supplementalSections];
    const tables = [...main.tables, ...supplementalTables];
    const page: ParsedPage = {
      pageNumber: 1,
      content,
      sections: sections.length > 0 ? sections : [{ content, level: 1, pageNumber: 1 }],
    };

    return {
      title,
      content,
      pages: [page],
      tables,
      metadata: {
        pageCount: 1,
        fileSize: input.byteLength,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        hasImages: Object.keys(zip.files).some((path) => path.startsWith('word/media/')),
        hasOcr: false,
      },
      warnings,
    };
  },
};

// ---------------------------------------------------------------------------
// Legacy Word (.doc) Handler
// ---------------------------------------------------------------------------

type WordExtractorDocument = {
  getBody(): string;
  getHeaders?(options?: { includeFooters?: boolean }): string;
  getFooters?(): string;
  getFootnotes?(): string;
  getEndnotes?(): string;
  getAnnotations?(): string;
  getTextboxes?(options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string;
};

type WordExtractorCtor = new () => {
  extract(input: string | Buffer): Promise<WordExtractorDocument>;
};

function wordDocumentPart(
  document: WordExtractorDocument,
  method: keyof WordExtractorDocument,
  options?: Record<string, unknown>,
): string {
  const fn = document[method];
  if (typeof fn !== 'function') return '';
  try {
    return (fn as (options?: Record<string, unknown>) => string)(options).trim();
  } catch {
    return '';
  }
}

const legacyWordHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (LEGACY_WORD_MIMES.has(mimeType)) return true;
    return extOf(filename) === 'doc';
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const mod = await import(WORD_EXTRACTOR_MODULE);
    const WordExtractor = ((mod as any).default ?? mod) as WordExtractorCtor;
    const extractor = new WordExtractor();
    const document = await extractor.extract(input);
    const title = filename.replace(/\.[^.]+$/, '');

    const parts = [
      { title: 'Body', content: wordDocumentPart(document, 'getBody') },
      { title: 'Headers', content: wordDocumentPart(document, 'getHeaders', { includeFooters: false }) },
      { title: 'Footers', content: wordDocumentPart(document, 'getFooters') },
      { title: 'Footnotes', content: wordDocumentPart(document, 'getFootnotes') },
      { title: 'Endnotes', content: wordDocumentPart(document, 'getEndnotes') },
      { title: 'Annotations', content: wordDocumentPart(document, 'getAnnotations') },
      { title: 'Textboxes', content: wordDocumentPart(document, 'getTextboxes') },
    ].filter((part) => part.content);

    const warnings: string[] = [];
    if (parts.length === 0) warnings.push('No readable text was found in the Word document.');

    const content = parts
      .map((part) => part.title === 'Body' ? part.content : `## ${part.title}\n\n${part.content}`)
      .join('\n\n')
      .trim();

    const sections: PageSection[] = parts.length > 0
      ? parts.map((part) => ({
          title: part.title === 'Body' ? undefined : part.title,
          content: part.content,
          level: part.title === 'Body' ? 1 : 2,
          pageNumber: 1,
        }))
      : [{ content, level: 1, pageNumber: 1 }];

    return {
      title,
      content,
      pages: [{ pageNumber: 1, content, sections }],
      tables: [],
      metadata: {
        pageCount: 1,
        fileSize: input.byteLength,
        mimeType: 'application/msword',
        hasImages: false,
        hasOcr: false,
      },
      warnings,
    };
  },
};

// ---------------------------------------------------------------------------
// RTF Handler
// ---------------------------------------------------------------------------

type RtfSpan = { value?: string };
type RtfParagraph = { content?: RtfSpan[] };
type RtfDocument = { content?: RtfParagraph[] };
type RtfParserApi = {
  string(input: string, callback: (err: Error | null, document?: RtfDocument) => void): void;
};

function parseRtfString(input: string): Promise<RtfDocument> {
  return import(RTF_PARSER_MODULE).then((mod) => {
    const parser = ((mod as any).default ?? mod) as RtfParserApi;
    return new Promise<RtfDocument>((resolve, reject) => {
      parser.string(input, (err, document) => {
        if (err) reject(err);
        else resolve(document ?? {});
      });
    });
  });
}

const rtfHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (RTF_MIMES.has(mimeType)) return true;
    return extOf(filename) === 'rtf';
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const warnings: string[] = [];
    const parsed = await parseRtfString(input.toString('utf8'));
    const paragraphs = (parsed.content ?? [])
      .map((paragraph) => (paragraph.content ?? []).map((span) => span.value ?? '').join('').trim())
      .filter(Boolean);
    const content = paragraphs.join('\n\n');
    if (!content) warnings.push('No readable text was found in the RTF document.');

    return {
      title: filename.replace(/\.[^.]+$/, ''),
      content,
      pages: [{
        pageNumber: 1,
        content,
        sections: [{ content, level: 1, pageNumber: 1 }],
      }],
      tables: [],
      metadata: {
        pageCount: 1,
        fileSize: input.byteLength,
        mimeType: 'application/rtf',
        hasImages: false,
        hasOcr: false,
      },
      warnings,
    };
  },
};

// ---------------------------------------------------------------------------
// PPTX Handler
// ---------------------------------------------------------------------------

function slideNumberFromPath(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

const pptxHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (PPTX_MIMES.has(mimeType)) return true;
    return extOf(filename) === 'pptx';
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const zip = await JSZip.loadAsync(input);
    const warnings: string[] = [];
    const title = filename.replace(/\.[^.]+$/, '');
    const slidePaths = Object.keys(zip.files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
      .sort((a, b) => slideNumberFromPath(a) - slideNumberFromPath(b));

    if (slidePaths.length === 0) {
      throw new Error('PPTX package is missing slide XML files.');
    }

    const pages: ParsedPage[] = [];
    const tables: ExtractedTable[] = [];
    const contentParts: string[] = [];

    for (let index = 0; index < slidePaths.length; index++) {
      const path = slidePaths[index];
      const slideNumber = slideNumberFromPath(path) || index + 1;
      const xml = await zip.file(path)!.async('text');
      const parsed = xmlParser.parse(xml);
      const rootNodes = asXmlArray(parsed);
      const paragraphTexts = findNodesByTag(rootNodes, 'p')
        .map((node) => parseDocxParagraph(nodeChildren(node))?.text)
        .filter((text): text is string => !!text);
      const slideTables = findNodesByTag(rootNodes, 'tbl')
        .map((node) => parseDocxTable(nodeChildren(node), slideNumber, `Slide ${slideNumber}`))
        .filter((table): table is ExtractedTable => !!table);
      tables.push(...slideTables);

      const bodyParts = [...paragraphTexts, ...slideTables.map((table) => table.rawMarkdown)].filter(Boolean);
      const content = [`## Slide ${slideNumber}`, ...bodyParts].join('\n\n').trim();
      contentParts.push(content);
      pages.push({
        pageNumber: slideNumber,
        content,
        sections: [{
          title: `Slide ${slideNumber}`,
          content: bodyParts.join('\n\n'),
          level: 2,
          pageNumber: slideNumber,
        }],
      });
    }

    const content = contentParts.join('\n\n---\n\n').trim();
    if (!content) warnings.push('No readable text was found in the PPTX package.');

    return {
      title,
      content,
      pages,
      tables,
      metadata: {
        pageCount: pages.length,
        fileSize: input.byteLength,
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        hasImages: Object.keys(zip.files).some((path) => path.startsWith('ppt/media/')),
        hasOcr: false,
      },
      warnings,
    };
  },
};

// ---------------------------------------------------------------------------
// HTML / MHTML Handler
// ---------------------------------------------------------------------------

type HtmlElementLike = {
  querySelector?(selector: string): HtmlElementLike | null;
  querySelectorAll?(selector: string): HtmlElementLike[];
  remove?(): void;
  structuredText?: string;
  innerText?: string;
  text?: string;
};

function htmlText(node: HtmlElementLike | null | undefined): string {
  if (!node) return '';
  return (node.structuredText ?? node.innerText ?? node.text ?? '').replace(/\u00a0/g, ' ').trim();
}

function removeHtmlNodes(root: HtmlElementLike, selectors: string[]): void {
  for (const selector of selectors) {
    for (const node of root.querySelectorAll?.(selector) ?? []) {
      node.remove?.();
    }
  }
}

function parseHtmlTables(root: HtmlElementLike, pageNumber: number): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const tableNodes = root.querySelectorAll?.('table') ?? [];

  for (let index = 0; index < tableNodes.length; index++) {
    const rows = (tableNodes[index].querySelectorAll?.('tr') ?? [])
      .map((row) => (row.querySelectorAll?.('th,td') ?? []).map((cell) => markdownEscapeCell(htmlText(cell))))
      .filter((row) => row.some(Boolean));
    if (rows.length === 0) continue;

    const columnCount = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, cellIndex) => row[cellIndex] ?? ''));
    const headers = normalizedRows[0].map((header, cellIndex) => header || `Column ${cellIndex + 1}`);
    const dataRows = normalizedRows.slice(1);
    const rawMarkdown = [
      `| ${headers.join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...dataRows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');

    tables.push({
      pageNumber,
      title: `Table ${index + 1}`,
      headers,
      rows: dataRows,
      rawMarkdown,
    });
  }

  return tables;
}

function parseHtmlDocument(
  html: string,
  filename: string,
  fileSize: number,
  mimeType: string,
  pageNumber = 1,
): ParsedDocument {
  const root = parseHtml(html) as unknown as HtmlElementLike;
  removeHtmlNodes(root, ['script', 'style', 'noscript']);
  const title = htmlText(root.querySelector?.('title')) || filename.replace(/\.[^.]+$/, '');
  const body = root.querySelector?.('body') ?? root;
  const bodyText = htmlText(body);
  const tables = parseHtmlTables(body, pageNumber);
  const tableContent = tables.map((table) => table.rawMarkdown).join('\n\n');
  const content = [`# ${title}`, bodyText, tableContent].filter(Boolean).join('\n\n').trim();
  const page: ParsedPage = {
    pageNumber,
    content,
    sections: [{ title, content, level: 1, pageNumber }],
  };

  return {
    title,
    content,
    pages: [page],
    tables,
    metadata: {
      pageCount: 1,
      fileSize,
      mimeType,
      hasImages: /<img\b/i.test(html),
      hasOcr: false,
    },
    warnings: content ? [] : ['No readable text was found in the HTML document.'],
  };
}

const htmlMhtmlHandler: FileHandler = {
  canHandle(mimeType: string, filename: string): boolean {
    if (HTML_MIMES.has(mimeType) || MHTML_MIMES.has(mimeType)) return true;
    return ['html', 'htm', 'mhtml', 'mht'].includes(extOf(filename));
  },

  async parse(input: Buffer, filename: string): Promise<ParsedDocument> {
    const ext = extOf(filename);
    const headerSample = input.toString('utf8', 0, Math.min(input.byteLength, 4096));
    const looksLikeMimeArchive = ext === 'mhtml' || ext === 'mht' || /^MIME-Version:/im.test(headerSample) || /^Content-Type:\s*multipart\//im.test(headerSample);
    if (looksLikeMimeArchive) {
      const email = await PostalMime.parse(input, { attachmentEncoding: 'arraybuffer' });
      const htmlParts = [
        email.html,
        ...email.attachments
          .filter((attachment) => HTML_MIMES.has(attachment.mimeType))
          .map((attachment) => Buffer.from(attachment.content as ArrayBuffer).toString('utf8')),
      ].filter((part): part is string => !!part);

      if (htmlParts.length > 0) {
        const parsedParts = htmlParts.map((html, index) =>
          parseHtmlDocument(html, filename, input.byteLength, 'multipart/related', index + 1));
        const content = parsedParts.map((part) => part.content).filter(Boolean).join('\n\n---\n\n');
        const pages = parsedParts.flatMap((part) => part.pages);
        const tables = parsedParts.flatMap((part) => part.tables);
        return {
          title: email.subject || filename.replace(/\.[^.]+$/, ''),
          content,
          pages,
          tables,
          metadata: {
            pageCount: Math.max(1, pages.length),
            fileSize: input.byteLength,
            mimeType: 'multipart/related',
            hasImages: email.attachments.some((attachment) => attachment.mimeType.startsWith('image/')),
            hasOcr: false,
          },
          warnings: [],
        };
      }

      const text = email.text?.trim() ?? '';
      return {
        title: email.subject || filename.replace(/\.[^.]+$/, ''),
        content: text,
        pages: [{ pageNumber: 1, content: text, sections: [{ content: text, level: 1, pageNumber: 1 }] }],
        tables: [],
        metadata: {
          pageCount: 1,
          fileSize: input.byteLength,
          mimeType: 'multipart/related',
          hasImages: email.attachments.some((attachment) => attachment.mimeType.startsWith('image/')),
          hasOcr: false,
        },
        warnings: text ? [] : ['No readable text was found in the MHTML document.'],
      };
    }

    return parseHtmlDocument(input.toString('utf8'), filename, input.byteLength, 'text/html');
  },
};

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

    assertSafeSpreadsheetArchive(input);
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
 * Returns handlers in priority order, from most-specific formats to generic text.
 */
export function createFileHandlerRegistry(): FileHandler[] {
  return [
    docxHandler,
    pptxHandler,
    legacyWordHandler,
    rtfHandler,
    htmlMhtmlHandler,
    excelCsvHandler,
    imageHandler,
    textMarkdownHandler,
  ];
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

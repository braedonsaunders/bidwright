/**
 * Multi-provider PDF parser factory.
 *
 * Supports three providers:
 * - **llamaparse** — LlamaIndex Cloud API (recommended default)
 * - **local** — Pure JS fallback using `pdf-parse` (zero-cost, no API key)
 * - **vision** — Sends page images to a caller-supplied vision LLM
 *
 * The "docling" provider is accepted by the config type but not yet
 * implemented — it will throw with a clear message.
 */

import type {
  ExtractedTable,
  PageSection,
  ParsedDocument,
  ParsedPage,
  PdfParser,
  PdfParserConfig,
} from './pdf-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate token count — avoids a tiktoken dependency. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Sleep helper for polling loops. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse markdown text into pages, sections, and tables.
 *
 * LlamaParse (and similar services) return a single markdown document.
 * This function extracts structure from that markdown so downstream
 * consumers get page-level and section-level granularity.
 */
function parseMarkdownIntoParts(markdown: string): {
  pages: ParsedPage[];
  tables: ExtractedTable[];
} {
  const pages: ParsedPage[] = [];
  const tables: ExtractedTable[] = [];

  // LlamaParse uses `---` or page markers like `<!-- Page N -->` / `\n\n---\n\n`
  const pageChunks = markdown.split(/(?:^|\n)---\n|<!--\s*Page\s+\d+\s*-->/i);

  for (let i = 0; i < pageChunks.length; i++) {
    const raw = pageChunks[i].trim();
    if (!raw) continue;

    const pageNumber = i + 1;
    const sections = extractSections(raw, pageNumber);
    const pageTables = extractTables(raw, pageNumber);
    tables.push(...pageTables);

    pages.push({
      pageNumber,
      content: raw,
      sections,
    });
  }

  // If splitting produced nothing useful, treat the whole doc as page 1
  if (pages.length === 0 && markdown.trim()) {
    const sections = extractSections(markdown, 1);
    const pageTables = extractTables(markdown, 1);
    tables.push(...pageTables);
    pages.push({ pageNumber: 1, content: markdown.trim(), sections });
  }

  return { pages, tables };
}

/**
 * Extract heading-delimited sections from markdown text.
 */
function extractSections(text: string, pageNumber: number): PageSection[] {
  const sections: PageSection[] = [];
  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  let lastIndex = 0;
  let lastTitle: string | undefined;
  let lastLevel = 0;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(text)) !== null) {
    // Content before this heading belongs to the previous section
    const content = text.slice(lastIndex, match.index).trim();
    if (content || lastTitle) {
      sections.push({
        title: lastTitle,
        content,
        level: lastLevel || 1,
        pageNumber,
      });
    }
    lastTitle = match[2].trim();
    lastLevel = match[1].length;
    lastIndex = match.index + match[0].length;
  }

  // Trailing content
  const trailing = text.slice(lastIndex).trim();
  if (trailing) {
    sections.push({
      title: lastTitle,
      content: trailing,
      level: lastLevel || 1,
      pageNumber,
    });
  }

  // If there were no headings at all, the whole text is one section
  if (sections.length === 0 && text.trim()) {
    sections.push({ content: text.trim(), level: 1, pageNumber });
  }

  return sections;
}

/**
 * Extract markdown tables from text.
 *
 * Matches pipe-delimited tables (`| col | col |`) and converts them
 * into structured `ExtractedTable` objects.
 */
function extractTables(text: string, pageNumber: number): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  // Match a markdown table: header row, separator, then data rows
  const tableRe = /(?:^|\n)(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/g;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(text)) !== null) {
    const headerLine = match[1];
    const dataBlock = match[3];

    const parseCells = (line: string): string[] =>
      line
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);

    const headers = parseCells(headerLine);
    const rows = dataBlock
      .trim()
      .split('\n')
      .map(parseCells)
      .filter((r) => r.length > 0);

    tables.push({
      pageNumber,
      headers,
      rows,
      rawMarkdown: match[0].trim(),
    });
  }

  return tables;
}

/**
 * Heuristic table detection from plain text.
 *
 * Looks for rows of text that have consistent column-like whitespace gaps.
 * This is a best-effort fallback for text-only PDF extraction.
 */
function detectPlainTextTables(text: string, pageNumber: number): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const lines = text.split('\n');
  let tableLines: string[] = [];

  const looksTabular = (line: string): boolean =>
    (line.match(/\s{3,}/g) || []).length >= 2 && line.trim().length > 10;

  const flushTable = (): void => {
    if (tableLines.length < 3) {
      tableLines = [];
      return;
    }

    const rows = tableLines.map((l) => l.split(/\s{3,}/).map((c) => c.trim()).filter(Boolean));
    const headers = rows[0] || [];
    const dataRows = rows.slice(1);
    const rawMarkdown =
      `| ${headers.join(' | ')} |\n` +
      `| ${headers.map(() => '---').join(' | ')} |\n` +
      dataRows.map((r) => `| ${r.join(' | ')} |`).join('\n');

    tables.push({ pageNumber, headers, rows: dataRows, rawMarkdown });
    tableLines = [];
  };

  for (const line of lines) {
    if (looksTabular(line)) {
      tableLines.push(line);
    } else {
      flushTable();
    }
  }
  flushTable();

  return tables;
}

// ---------------------------------------------------------------------------
// LlamaParse Provider
// ---------------------------------------------------------------------------

const LLAMAPARSE_BASE = 'https://api.cloud.llamaindex.ai/api/v1/parsing';

async function llamaParsePdf(
  input: Buffer,
  filename: string,
  config: PdfParserConfig,
): Promise<ParsedDocument> {
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error('LlamaParse provider requires an API key (config.apiKey).');
  }

  const baseUrl = config.baseUrl ?? LLAMAPARSE_BASE;
  const warnings: string[] = [];

  // 1. Upload
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(input)]), filename);

  if (config.options?.language) {
    form.append('language', config.options.language);
  }
  if (config.options?.outputFormat) {
    form.append('result_type', config.options.outputFormat);
  }

  const uploadRes = await fetch(`${baseUrl}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '');
    throw new Error(`LlamaParse upload failed (${uploadRes.status}): ${body}`);
  }

  const { id: jobId } = (await uploadRes.json()) as { id: string };

  // 2. Poll for completion
  const maxWait = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 2000;
  const start = Date.now();
  let status = 'PENDING';

  while (status !== 'SUCCESS' && status !== 'ERROR') {
    if (Date.now() - start > maxWait) {
      throw new Error(`LlamaParse job ${jobId} timed out after 5 minutes.`);
    }
    await sleep(pollInterval);

    const statusRes = await fetch(`${baseUrl}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!statusRes.ok) {
      warnings.push(`Status poll returned ${statusRes.status}`);
      continue;
    }

    const statusBody = (await statusRes.json()) as { status: string };
    status = statusBody.status;
  }

  if (status === 'ERROR') {
    throw new Error(`LlamaParse job ${jobId} failed.`);
  }

  // 3. Fetch result
  const format = config.options?.outputFormat ?? 'markdown';
  const resultRes = await fetch(`${baseUrl}/job/${jobId}/result/${format}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resultRes.ok) {
    throw new Error(`LlamaParse result fetch failed (${resultRes.status}).`);
  }

  const resultBody = (await resultRes.json()) as { markdown?: string; text?: string; [key: string]: unknown };
  const content = resultBody.markdown ?? resultBody.text ?? JSON.stringify(resultBody);

  // 4. Structure the result
  const { pages, tables } = parseMarkdownIntoParts(content);

  return {
    title: filename.replace(/\.[^.]+$/, ''),
    content,
    pages,
    tables,
    metadata: {
      pageCount: pages.length,
      fileSize: input.byteLength,
      mimeType: 'application/pdf',
      hasImages: false,
      hasOcr: false,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Local Provider (pdf-parse)
// ---------------------------------------------------------------------------

async function localParsePdf(
  input: Buffer,
  filename: string,
  config: PdfParserConfig,
): Promise<ParsedDocument> {
  const warnings: string[] = [];

  let pdfParse: (buffer: Buffer) => Promise<{
    numpages: number;
    text: string;
    info?: { Title?: string; Author?: string; CreationDate?: string };
  }>;

  try {
    // Dynamic import — pdf-parse is an optional peer dependency
    // @ts-ignore -- pdf-parse has no type declarations in downstream consumers
    const mod = await import('pdf-parse');
    pdfParse = (mod.default ?? mod) as typeof pdfParse;
  } catch {
    throw new Error(
      'The "local" PDF parser requires the "pdf-parse" package. Install it with: pnpm add pdf-parse',
    );
  }

  const result = await pdfParse(input);
  const fullText = result.text ?? '';

  // Split on form-feed characters which pdf-parse uses as page separators
  const rawPages = fullText.split(/\f/);
  const pages: ParsedPage[] = [];
  const tables: ExtractedTable[] = [];
  const maxPages = config.options?.maxPages ?? Infinity;

  for (let i = 0; i < Math.min(rawPages.length, maxPages); i++) {
    const pageText = rawPages[i].trim();
    if (!pageText) continue;

    const pageNumber = i + 1;
    const sections = extractSections(pageText, pageNumber);
    const pageTables = detectPlainTextTables(pageText, pageNumber);
    tables.push(...pageTables);

    pages.push({ pageNumber, content: pageText, sections });
  }

  // Detect if this might be a scanned PDF (very little text per page)
  const avgCharsPerPage = fullText.length / Math.max(result.numpages, 1);
  const hasOcr = avgCharsPerPage < 100;
  if (hasOcr) {
    warnings.push(
      `Low text density (${Math.round(avgCharsPerPage)} chars/page) — this may be a scanned PDF. ` +
        'Consider using the "vision" provider for better results.',
    );
  }

  return {
    title: result.info?.Title || filename.replace(/\.[^.]+$/, ''),
    content: fullText,
    pages,
    tables,
    metadata: {
      pageCount: result.numpages,
      author: result.info?.Author,
      createdDate: result.info?.CreationDate,
      fileSize: input.byteLength,
      mimeType: 'application/pdf',
      hasImages: false,
      hasOcr,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Vision Provider
// ---------------------------------------------------------------------------

async function visionParsePdf(
  input: Buffer,
  filename: string,
  config: PdfParserConfig,
): Promise<ParsedDocument> {
  const visionLlm = config.visionLlm;
  if (!visionLlm) {
    throw new Error(
      'The "vision" provider requires a visionLlm function in config. ' +
        'Provide: (imageBase64: string, prompt: string) => Promise<string>',
    );
  }

  const warnings: string[] = [];

  // First, try to extract text with pdf-parse to get page count and basic text
  let pageCount = 1;
  let basicText = '';
  try {
    // @ts-ignore -- pdf-parse has no type declarations in downstream consumers
    const mod = await import('pdf-parse');
    const pdfParse = (mod.default ?? mod) as (buf: Buffer) => Promise<{ numpages: number; text: string }>;
    const result = await pdfParse(input);
    pageCount = result.numpages;
    basicText = result.text;
  } catch {
    warnings.push('Could not extract page count via pdf-parse; treating as single page.');
  }

  const maxPages = config.options?.maxPages ?? pageCount;
  const pagesToProcess = Math.min(pageCount, maxPages);

  // Since we can't render PDF pages to images in pure JS without native deps,
  // we send the base64 of the entire PDF and ask the vision LLM to process it.
  // If the caller has a way to render pages to images they should pre-process.
  const base64 = input.toString('base64');

  const pages: ParsedPage[] = [];
  const tables: ExtractedTable[] = [];

  // For single-page or whole-document processing
  if (pagesToProcess <= 5) {
    const prompt =
      `Extract all text content from this PDF document. ` +
      `Format the output as markdown with clear headings and structure. ` +
      `If there are tables, format them as markdown tables. ` +
      `If there are images, describe them briefly. ` +
      `Separate pages with "---" on its own line.`;

    try {
      const content = await visionLlm(base64, prompt);
      const parts = parseMarkdownIntoParts(content);
      pages.push(...parts.pages);
      tables.push(...parts.tables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Vision LLM call failed: ${msg}`);
    }
  } else {
    // For large documents, process conceptually in batches
    // The caller's visionLlm should handle page-level extraction
    const prompt =
      `This is a ${pageCount}-page PDF document. ` +
      `Extract all text content and format as markdown. ` +
      `Use "---" to separate pages. ` +
      `Format tables as markdown tables. ` +
      `Describe any images or diagrams briefly.`;

    try {
      const content = await visionLlm(base64, prompt);
      const parts = parseMarkdownIntoParts(content);
      pages.push(...parts.pages);
      tables.push(...parts.tables);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Vision LLM call failed: ${msg}`);

      // Fall back to basic text if we have it
      if (basicText) {
        warnings.push('Falling back to basic text extraction.');
        const rawPages = basicText.split(/\f/);
        for (let i = 0; i < rawPages.length; i++) {
          const pageText = rawPages[i].trim();
          if (!pageText) continue;
          pages.push({
            pageNumber: i + 1,
            content: pageText,
            sections: extractSections(pageText, i + 1),
          });
        }
      }
    }
  }

  const fullContent = pages.map((p) => p.content).join('\n\n---\n\n');

  return {
    title: filename.replace(/\.[^.]+$/, ''),
    content: fullContent,
    pages,
    tables,
    metadata: {
      pageCount,
      fileSize: input.byteLength,
      mimeType: 'application/pdf',
      hasImages: true,
      hasOcr: true,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Azure Document Intelligence Provider
// ---------------------------------------------------------------------------

/**
 * Parse a PDF using Azure Document Intelligence (formerly Form Recognizer).
 *
 * Uses the REST API directly to avoid heavy SDK dependencies.
 * Supports prebuilt-layout (default), prebuilt-document, prebuilt-invoice, and prebuilt-read.
 */
async function azureParsePdf(
  input: Buffer,
  filename: string,
  config: PdfParserConfig,
): Promise<ParsedDocument> {
  const endpoint = config.azureEndpoint;
  const apiKey = config.azureKey;
  if (!endpoint || !apiKey) {
    throw new Error(
      'The "azure" provider requires azureEndpoint and azureKey in config.',
    );
  }

  const model = config.azureModel ?? 'prebuilt-layout';
  const warnings: string[] = [];

  // 1. Submit document for analysis
  const analyzeUrl = `${endpoint.replace(/\/$/, '')}/documentintelligence/documentModels/${model}:analyze?api-version=2024-11-30`;

  const submitRes = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/pdf',
    },
    body: new Uint8Array(input),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '');
    throw new Error(`Azure DI submit failed (${submitRes.status}): ${body}`);
  }

  const operationLocation = submitRes.headers.get('operation-location');
  if (!operationLocation) {
    throw new Error('Azure DI response missing operation-location header.');
  }

  // 2. Poll for completion
  const maxWait = 5 * 60 * 1000;
  const pollInterval = 2000;
  const start = Date.now();
  let status = 'running';
  let analyzeResult: AzureAnalyzeResult | undefined;

  while (status === 'running' || status === 'notStarted') {
    if (Date.now() - start > maxWait) {
      throw new Error('Azure DI analysis timed out after 5 minutes.');
    }
    await sleep(pollInterval);

    const pollRes = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': apiKey },
    });

    if (!pollRes.ok) {
      warnings.push(`Azure DI poll returned ${pollRes.status}`);
      continue;
    }

    const pollBody = (await pollRes.json()) as {
      status: string;
      analyzeResult?: AzureAnalyzeResult;
      error?: { message: string };
    };
    status = pollBody.status;

    if (status === 'succeeded' && pollBody.analyzeResult) {
      analyzeResult = pollBody.analyzeResult;
    } else if (status === 'failed') {
      throw new Error(`Azure DI analysis failed: ${pollBody.error?.message ?? 'unknown error'}`);
    }
  }

  if (!analyzeResult) {
    throw new Error('Azure DI analysis completed but no result returned.');
  }

  // 3. Map Azure result to ParsedDocument
  return mapAzureResult(analyzeResult, filename, input.byteLength, warnings);
}

// ---------------------------------------------------------------------------
// Azure response types (subset of what the API returns)
// ---------------------------------------------------------------------------

interface AzureAnalyzeResult {
  content: string;
  pages?: AzurePage[];
  tables?: AzureTable[];
  keyValuePairs?: AzureKeyValuePair[];
  paragraphs?: AzureParagraph[];
  documents?: AzureDocument[];
}

interface AzurePage {
  pageNumber: number;
  width: number;
  height: number;
  lines?: Array<{ content: string }>;
  selectionMarks?: Array<{ state: string; confidence: number }>;
}

interface AzureTable {
  rowCount: number;
  columnCount: number;
  cells: Array<{
    rowIndex: number;
    columnIndex: number;
    content: string;
    kind?: 'columnHeader' | 'rowHeader' | 'content' | 'stub';
  }>;
  boundingRegions?: Array<{ pageNumber: number }>;
}

interface AzureKeyValuePair {
  key: { content: string };
  value?: { content: string };
  confidence: number;
}

interface AzureParagraph {
  content: string;
  role?: 'title' | 'sectionHeading' | 'footnote' | 'pageHeader' | 'pageFooter' | 'pageNumber';
  boundingRegions?: Array<{ pageNumber: number }>;
}

interface AzureDocument {
  docType?: string;
  boundingRegions?: Array<{ pageNumber: number }>;
  fields?: Record<string, AzureDocumentField>;
  confidence?: number;
}

interface AzureDocumentField {
  type?: string;
  content?: string;
  valueString?: string;
  valueDate?: string;
  valueTime?: string;
  valuePhoneNumber?: string;
  valueNumber?: number;
  valueInteger?: number;
  valueCurrency?: {
    amount?: number;
    currencyCode?: string;
    currencySymbol?: string;
  };
  valueArray?: AzureDocumentField[];
  valueObject?: Record<string, AzureDocumentField>;
  confidence?: number;
  boundingRegions?: Array<{ pageNumber: number }>;
}

function azureFieldText(field: AzureDocumentField | undefined): string {
  if (!field) return '';
  if (field.valueString) return field.valueString;
  if (field.valueDate) return field.valueDate;
  if (field.valueTime) return field.valueTime;
  if (field.valuePhoneNumber) return field.valuePhoneNumber;
  if (field.valueNumber != null) return String(field.valueNumber);
  if (field.valueInteger != null) return String(field.valueInteger);
  if (field.valueCurrency) {
    const amount = field.valueCurrency.amount;
    const code = field.valueCurrency.currencyCode || field.valueCurrency.currencySymbol || '';
    return [amount != null ? String(amount) : '', code].filter(Boolean).join(' ');
  }
  return field.content ?? '';
}

function azureFieldPageNumber(field: AzureDocumentField | undefined, fallbackPageNumber?: number): number | undefined {
  return field?.boundingRegions?.[0]?.pageNumber ?? fallbackPageNumber;
}

function azureDocumentPageNumber(document: AzureDocument): number | undefined {
  return document.boundingRegions?.[0]?.pageNumber;
}

function buildRawMarkdown(headers: string[], rows: string[][]): string {
  return (
    `| ${headers.join(' | ')} |\n` +
    `| ${headers.map(() => '---').join(' | ')} |\n` +
    rows.map((row) => `| ${row.join(' | ')} |`).join('\n')
  );
}

function mapAzureInvoiceItemTables(documents: AzureDocument[]): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const preferredHeaders = ['ProductCode', 'Description', 'Quantity', 'Unit', 'UnitPrice', 'Amount'];

  for (const document of documents) {
    const items = document.fields?.Items?.valueArray ?? [];
    if (items.length === 0) continue;

    const rowObjects = items
      .map((item) => item.valueObject ?? null)
      .filter((item): item is Record<string, AzureDocumentField> => Boolean(item));
    if (rowObjects.length === 0) continue;

    const discoveredHeaders = Array.from(new Set(rowObjects.flatMap((row) => Object.keys(row))));
    const headers = [
      ...preferredHeaders.filter((header) => discoveredHeaders.includes(header)),
      ...discoveredHeaders.filter((header) => !preferredHeaders.includes(header)).sort((a, b) => a.localeCompare(b)),
    ];
    if (headers.length === 0) continue;

    const rows = rowObjects.map((row) => headers.map((header) => azureFieldText(row[header])));
    const pageNumber = azureFieldPageNumber(items[0], azureDocumentPageNumber(document)) ?? 1;
    tables.push({
      pageNumber,
      title: 'Azure invoice items',
      headers,
      rows,
      rawMarkdown: buildRawMarkdown(headers, rows),
    });
  }

  return tables;
}

function mapAzureDocumentFields(documents: AzureDocument[]) {
  const fields: NonNullable<ParsedDocument['metadata']['documentFields']> = [];

  for (const document of documents) {
    const documentType = document.docType ?? '';
    const documentPageNumber = azureDocumentPageNumber(document);
    for (const [fieldName, field] of Object.entries(document.fields ?? {})) {
      if (field.valueArray || field.valueObject) continue;
      const value = azureFieldText(field).trim();
      if (!value && !field.valueCurrency?.currencyCode) continue;
      fields.push({
        documentType,
        fieldName,
        value,
        confidence: field.confidence ?? document.confidence ?? 0,
        pageNumber: azureFieldPageNumber(field, documentPageNumber),
        currencyCode: field.valueCurrency?.currencyCode,
      });
    }
  }

  return fields;
}

/**
 * Map Azure Document Intelligence result to our ParsedDocument format.
 */
function mapAzureResult(
  result: AzureAnalyzeResult,
  filename: string,
  fileSize: number,
  warnings: string[],
): ParsedDocument {
  const azurePages = result.pages ?? [];
  const pages: ParsedPage[] = [];
  const tables: ExtractedTable[] = [];

  // Build page content from Azure lines
  for (const azurePage of azurePages) {
    const pageNumber = azurePage.pageNumber;
    const lines = azurePage.lines ?? [];
    const pageContent = lines.map((l) => l.content).join('\n');

    // Get paragraphs for this page to extract sections
    const pageParagraphs = (result.paragraphs ?? []).filter(
      (p) => p.boundingRegions?.some((r) => r.pageNumber === pageNumber),
    );
    const sections = extractSectionsFromParagraphs(pageParagraphs, pageNumber);

    pages.push({ pageNumber, content: pageContent, sections });
  }

  // Map Azure tables to ExtractedTable format
  for (const azureTable of result.tables ?? []) {
    const pageNumber = azureTable.boundingRegions?.[0]?.pageNumber ?? 1;

    // Build header and data rows from cell grid
    const headers: string[] = [];
    const rowMap = new Map<number, string[]>();

    for (const cell of azureTable.cells) {
      if (cell.kind === 'columnHeader' || cell.rowIndex === 0) {
        headers[cell.columnIndex] = cell.content;
      } else {
        if (!rowMap.has(cell.rowIndex)) {
          rowMap.set(cell.rowIndex, new Array(azureTable.columnCount).fill(''));
        }
        rowMap.get(cell.rowIndex)![cell.columnIndex] = cell.content;
      }
    }

    // Fill any empty header slots
    for (let i = 0; i < azureTable.columnCount; i++) {
      if (!headers[i]) headers[i] = `Column ${i + 1}`;
    }

    const rows = Array.from(rowMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, cells]) => cells);

    // Build markdown representation
    const rawMarkdown =
      `| ${headers.join(' | ')} |\n` +
      `| ${headers.map(() => '---').join(' | ')} |\n` +
      rows.map((r) => `| ${r.join(' | ')} |`).join('\n');

    tables.push({ pageNumber, headers, rows, rawMarkdown });
  }
  tables.push(...mapAzureInvoiceItemTables(result.documents ?? []));

  // Extract key-value pairs
  const keyValuePairs = (result.keyValuePairs ?? []).map((kv) => ({
    key: kv.key.content,
    value: kv.value?.content ?? '',
    confidence: kv.confidence,
  }));

  const documentFields = mapAzureDocumentFields(result.documents ?? []);

  // Extract selection marks across all pages
  const selectionMarks: Array<{ state: string; pageNumber: number; confidence: number }> = [];
  for (const azurePage of azurePages) {
    for (const mark of azurePage.selectionMarks ?? []) {
      selectionMarks.push({
        state: mark.state,
        pageNumber: azurePage.pageNumber,
        confidence: mark.confidence,
      });
    }
  }

  // Build full content — use Azure's content field which preserves reading order
  const content = result.content || pages.map((p) => p.content).join('\n\n');

  // If no pages were produced from lines, fall back to splitting content
  if (pages.length === 0 && content) {
    const { pages: fallbackPages, tables: fallbackTables } = parseMarkdownIntoParts(content);
    pages.push(...fallbackPages);
    tables.push(...fallbackTables);
  }

  return {
    title: filename.replace(/\.[^.]+$/, ''),
    content,
    pages,
    tables,
    metadata: {
      pageCount: azurePages.length || pages.length,
      fileSize,
      mimeType: 'application/pdf',
      hasImages: false,
      hasOcr: true,
      keyValuePairs: keyValuePairs.length > 0 ? keyValuePairs : undefined,
      documentFields: documentFields.length > 0 ? documentFields : undefined,
      selectionMarks: selectionMarks.length > 0 ? selectionMarks : undefined,
    },
    warnings,
  };
}

/**
 * Convert Azure paragraphs (with heading roles) into PageSection objects.
 */
function extractSectionsFromParagraphs(
  paragraphs: AzureParagraph[],
  pageNumber: number,
): PageSection[] {
  const sections: PageSection[] = [];
  let currentTitle: string | undefined;
  let currentLevel = 1;
  let currentContent: string[] = [];

  for (const para of paragraphs) {
    if (para.role === 'title' || para.role === 'sectionHeading') {
      // Flush previous section
      if (currentContent.length > 0 || currentTitle) {
        sections.push({
          title: currentTitle,
          content: currentContent.join('\n'),
          level: currentLevel,
          pageNumber,
        });
        currentContent = [];
      }
      currentTitle = para.content;
      currentLevel = para.role === 'title' ? 1 : 2;
    } else if (para.role !== 'pageHeader' && para.role !== 'pageFooter' && para.role !== 'pageNumber') {
      currentContent.push(para.content);
    }
  }

  // Flush remaining
  if (currentContent.length > 0 || currentTitle) {
    sections.push({
      title: currentTitle,
      content: currentContent.join('\n'),
      level: currentLevel,
      pageNumber,
    });
  }

  if (sections.length === 0 && paragraphs.length > 0) {
    const bodyContent = paragraphs
      .filter((p) => p.role !== 'pageHeader' && p.role !== 'pageFooter' && p.role !== 'pageNumber')
      .map((p) => p.content)
      .join('\n');
    if (bodyContent) {
      sections.push({ content: bodyContent, level: 1, pageNumber });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Hybrid Provider
// ---------------------------------------------------------------------------

/**
 * Hybrid PDF parser: uses local pdf-parse first, falls back to Azure for
 * scanned PDFs or when richer structure is needed.
 */
async function hybridParsePdf(
  input: Buffer,
  filename: string,
  config: PdfParserConfig,
): Promise<ParsedDocument> {
  const hasAzureConfig = !!(config.azureEndpoint && config.azureKey);

  // Always start with local extraction — it's fast and free
  const localResult = await localParsePdf(input, filename, config);

  // If the PDF has good embedded text, return the local result
  if (!localResult.metadata.hasOcr) {
    // Optionally enrich with Azure tables/KV if enabled
    if (hasAzureConfig && config.options?.tableExtractionEnabled) {
      try {
        const azureResult = await azureParsePdf(input, filename, config);
        // Merge Azure's structured data into the local result
        if (azureResult.tables.length > 0) {
          localResult.tables = azureResult.tables;
        }
        if (azureResult.metadata.keyValuePairs) {
          localResult.metadata.keyValuePairs = azureResult.metadata.keyValuePairs;
        }
        if (azureResult.metadata.documentFields) {
          localResult.metadata.documentFields = azureResult.metadata.documentFields;
        }
        if (azureResult.metadata.selectionMarks) {
          localResult.metadata.selectionMarks = azureResult.metadata.selectionMarks;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        localResult.warnings.push(`Azure enrichment failed (non-fatal): ${msg}`);
      }
    }
    return localResult;
  }

  // Scanned PDF detected — try Azure if available
  if (hasAzureConfig) {
    try {
      const azureResult = await azureParsePdf(input, filename, config);
      azureResult.warnings.unshift(
        'Scanned PDF detected — used Azure Document Intelligence for OCR extraction.',
      );
      return azureResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      localResult.warnings.push(`Azure fallback failed: ${msg}. Returning local (partial) result.`);
      return localResult;
    }
  }

  // No Azure config — return local result with helpful warning
  localResult.warnings.push(
    'Scanned PDF detected but no Azure Document Intelligence credentials configured. ' +
      'Add credentials in Settings > Integrations to enable OCR.',
  );
  return localResult;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a PDF parser for the given provider configuration.
 *
 * @example
 * ```ts
 * const parser = createPdfParser({ provider: 'local' });
 * const doc = await parser.parse(pdfBuffer, 'specs.pdf');
 * ```
 */
export function createPdfParser(config: PdfParserConfig): PdfParser {
  const parseImpl = async (input: Buffer | string, filename: string): Promise<ParsedDocument> => {
    const buffer = typeof input === 'string' ? Buffer.from(input, 'base64') : input;

    switch (config.provider) {
      case 'llamaparse':
        return llamaParsePdf(buffer, filename, config);
      case 'local':
        return localParsePdf(buffer, filename, config);
      case 'vision':
        return visionParsePdf(buffer, filename, config);
      case 'azure':
        return azureParsePdf(buffer, filename, config);
      case 'hybrid':
        return hybridParsePdf(buffer, filename, config);
      case 'docling':
        throw new Error('The "docling" provider is not yet implemented.');
      default:
        throw new Error(`Unknown PDF parser provider: ${config.provider}`);
    }
  };

  return {
    async parse(input: Buffer | string, filename: string): Promise<ParsedDocument> {
      try {
        return await parseImpl(input, filename);
      } catch (err) {
        // Never crash — return a partial result with the error recorded
        const msg = err instanceof Error ? err.message : String(err);
        const buffer = typeof input === 'string' ? Buffer.from(input, 'base64') : input;
        return {
          title: filename.replace(/\.[^.]+$/, ''),
          content: '',
          pages: [],
          tables: [],
          metadata: {
            pageCount: 0,
            fileSize: buffer.byteLength,
            mimeType: 'application/pdf',
            hasImages: false,
            hasOcr: false,
          },
          warnings: [`Parse failed: ${msg}`],
        };
      }
    },

    async parsePages(
      input: Buffer | string,
      filename: string,
      pageRange?: [number, number],
    ): Promise<ParsedPage[]> {
      const doc = await this.parse(input, filename);
      if (!pageRange) return doc.pages;

      const [start, end] = pageRange;
      return doc.pages.filter((p) => p.pageNumber >= start && p.pageNumber <= end);
    },
  };
}

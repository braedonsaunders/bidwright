import { readFile } from "node:fs/promises";
import {
  createPdfParser,
  parseAzureDocumentIntelligenceQueryFields,
  normalizeAzureDocumentIntelligenceFeatures,
  parseFile,
  type ParsedDocument,
} from "@bidwright/ingestion";
import type { CanonicalFileIngestManifest, FileIngestCapability } from "@bidwright/domain";
import type { FileAdapterIngestResult, FileIngestAdapter, FileIngestContext, FileIngestSettings, FileIngestSource } from "../types.js";
import { parseBluebeamMarkups } from "../bluebeam-markups.js";
import {
  makeProvenance,
  normalizeIssues,
  persistFileIngestArtifacts,
  textPreview,
} from "../utils.js";

const ADAPTER_ID = "bidwright-document.universal";
const ADAPTER_VERSION = "1.0.0";

const PDF_FORMATS = new Set(["pdf"]);
const WORD_FORMATS = new Set(["docx", "doc", "rtf"]);
const PRESENTATION_FORMATS = new Set(["pptx"]);
const SPREADSHEET_FORMATS = new Set(["xlsx", "xls", "xlsm", "ods", "csv", "tsv"]);
const WEB_FORMATS = new Set(["html", "htm", "mhtml", "mht"]);
const IMAGE_FORMATS = new Set(["png", "jpg", "jpeg", "tiff", "tif", "bmp", "webp", "gif"]);
const TEXT_FORMATS = new Set(["txt", "md", "markdown", "json", "xml", "yml", "yaml", "log", "ini", "toml", "conf", "cfg"]);

const FORMATS = new Set([
  ...PDF_FORMATS,
  ...WORD_FORMATS,
  ...PRESENTATION_FORMATS,
  ...SPREADSHEET_FORMATS,
  ...WEB_FORMATS,
  ...IMAGE_FORMATS,
  ...TEXT_FORMATS,
]);

function settingString(settings: FileIngestSettings | undefined, key: string) {
  const value = settings?.integrations?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function hasAzureDocumentIntelligence(settings: FileIngestSettings | undefined) {
  return Boolean(settingString(settings, "azureDiEndpoint") && settingString(settings, "azureDiKey"));
}

function familyForFormat(format?: string): FileIngestCapability["family"] {
  if (!format) return "document";
  if (SPREADSHEET_FORMATS.has(format)) return "spreadsheet";
  if (IMAGE_FORMATS.has(format)) return "image";
  if (TEXT_FORMATS.has(format)) return "text";
  return "document";
}

function mimeTypeForFormat(format: string) {
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    rtf: "application/rtf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    html: "text/html",
    htm: "text/html",
    mhtml: "multipart/related",
    mht: "multipart/related",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tiff: "image/tiff",
    tif: "image/tiff",
    bmp: "image/bmp",
    webp: "image/webp",
    gif: "image/gif",
    md: "text/markdown",
    markdown: "text/markdown",
    json: "application/json",
    xml: "application/xml",
    yml: "text/yaml",
    yaml: "text/yaml",
    txt: "text/plain",
  };
  return mimeTypes[format] ?? "application/octet-stream";
}

function capability(format?: string, settings?: FileIngestSettings): FileIngestCapability {
  const normalized = format?.trim().toLowerCase();
  const azureConfigured = hasAzureDocumentIntelligence(settings);
  const imageWithoutOcr = normalized ? IMAGE_FORMATS.has(normalized) && !azureConfigured : false;
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: "bidwright-document",
    family: familyForFormat(normalized),
    formats: Array.from(FORMATS),
    status: imageWithoutOcr ? "degraded" : "available",
    message: imageWithoutOcr
      ? "Image intake is available as a file artifact, but OCR requires Azure Document Intelligence configuration in organization settings."
      : "Document intake is available through embedded parsers, with optional Azure Document Intelligence from organization settings.",
    missingConfigKeys: imageWithoutOcr ? ["azureDiEndpoint", "azureDiKey"] : [],
    features: {
      text: !imageWithoutOcr,
      structuredData: azureConfigured || Boolean(normalized && (SPREADSHEET_FORMATS.has(normalized) || WORD_FORMATS.has(normalized) || WEB_FORMATS.has(normalized))),
      geometry: false,
      quantities: false,
      preview: true,
      rawArtifacts: true,
      requiresCloud: false,
    },
    metadata: {
      azureDocumentIntelligence: azureConfigured ? "configured_from_organization_settings" : "not_configured",
      configScope: "organization_settings_only",
      localHandlers: ["pdf-local", "office-openxml", "spreadsheet", "html", "image-placeholder", "text"],
    },
  };
}

function parsedDocumentHasContent(doc: ParsedDocument) {
  return Boolean(
    doc.content.trim() ||
    doc.pages.some((page) => page.content.trim()) ||
    doc.tables.length > 0 ||
    doc.metadata.keyValuePairs?.length ||
    doc.metadata.documentFields?.length ||
    doc.metadata.selectionMarks?.length,
  );
}

async function parsePdf(buffer: Buffer, fileName: string, settings?: FileIngestSettings) {
  const notes: string[] = [];
  const endpoint = settingString(settings, "azureDiEndpoint");
  const key = settingString(settings, "azureDiKey");
  const provider = settingString(settings, "documentExtractionProvider") || "azure";
  const canUseAzure = provider !== "local" && endpoint && key;

  if (canUseAzure) {
    try {
      const parser = createPdfParser({
        provider: "azure",
        azureEndpoint: endpoint,
        azureKey: key,
        azureModel: (settingString(settings, "azureDiModel") || "prebuilt-layout") as any,
        azureFeatures: normalizeAzureDocumentIntelligenceFeatures(settings?.integrations?.azureDiFeatures as any),
        azureQueryFields: parseAzureDocumentIntelligenceQueryFields(settingString(settings, "azureDiQueryFields")),
        options: { outputFormat: settingString(settings, "azureDiOutputFormat") === "markdown" ? "markdown" : "text" },
      });
      const doc = await parser.parse(buffer, fileName);
      notes.push("azure-di");
      if (doc.warnings.length > 0) notes.push(...doc.warnings.map((warning) => `azure-di-warning: ${warning}`));
      if (parsedDocumentHasContent(doc)) return { doc, notes };
      notes.push("azure-di-empty");
    } catch (error) {
      notes.push(`azure-di-error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    notes.push("azure-di-unconfigured");
  }

  const parser = createPdfParser({ provider: "local" });
  const doc = await parser.parse(buffer, fileName);
  notes.push("pdf-local");
  if (doc.warnings.length > 0) notes.push(...doc.warnings.map((warning) => `pdf-local-warning: ${warning}`));
  return { doc, notes };
}

function structuredSummary(doc: ParsedDocument) {
  const sections = doc.pages.flatMap((page) => page.sections ?? []);
  const images = doc.pages.flatMap((page) => page.images ?? []);
  return {
    tables: doc.tables.length > 0
      ? doc.tables.map((table) => ({
          pageNumber: table.pageNumber,
          title: table.title,
          headers: table.headers,
          rowCount: table.rows.length,
          rawMarkdown: table.rawMarkdown,
        }))
      : undefined,
    keyValuePairCount: doc.metadata.keyValuePairs?.length ?? 0,
    documentFieldCount: doc.metadata.documentFields?.length ?? 0,
    selectionMarkCount: doc.metadata.selectionMarks?.length ?? 0,
    sectionCount: sections.length,
    imageCount: images.length,
  };
}

export const documentFileAdapter: FileIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  family: "document",
  formats: FORMATS,
  priority: 50,
  capability,
  async ingest(source: FileIngestSource, context: FileIngestContext): Promise<FileAdapterIngestResult> {
    const activeCapability = capability(context.format, context.settings);
    const buffer = await readFile(context.absPath);
    const parsed = context.format === "pdf"
      ? await parsePdf(buffer, source.fileName, context.settings)
      : {
          doc: await parseFile(buffer, source.fileName, source.fileType ?? mimeTypeForFormat(context.format)),
          notes: [`${context.format || "file"}-local`],
        };
    const doc = parsed.doc;
    const markups = await parseBluebeamMarkups(buffer, context.format).catch(() => null);
    const notes = [...parsed.notes, ...doc.warnings.map((warning) => `warning: ${warning}`)];
    const issues = doc.warnings.map((warning) => ({
      severity: "warning",
      code: "document_parser_warning",
      message: warning,
    }));
    if (!parsedDocumentHasContent(doc)) {
      issues.push({
        severity: "warning",
        code: "document_no_extracted_content",
        message: "No readable text, tables, or structured fields were extracted from this file.",
      });
    }

    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method: context.format === "pdf" && notes.includes("azure-di") ? "azure_document_intelligence" : "embedded_document_parser",
      confidence: parsedDocumentHasContent(doc) ? 0.85 : 0.35,
    });
    const sections = doc.pages.flatMap((page) => page.sections ?? []);
    const images = doc.pages.flatMap((page) => page.images ?? []);
    const documentManifest = {
      title: doc.title,
      pageCount: doc.metadata.pageCount || doc.pages.length || 1,
      textLength: doc.content.length,
      tableCount: doc.tables.length,
      sectionCount: sections.length,
      imageCount: images.length,
      hasOcr: doc.metadata.hasOcr,
      mimeType: doc.metadata.mimeType || source.fileType || mimeTypeForFormat(context.format),
      extractionNotes: notes,
      textPreview: textPreview(doc.content),
      structuredData: structuredSummary(doc),
      metadata: doc.metadata as Record<string, unknown>,
    };
    const manifest: CanonicalFileIngestManifest = {
      schemaVersion: 1 as const,
      runStatus: parsedDocumentHasContent(doc) ? "indexed" as const : "partial" as const,
      family: familyForFormat(context.format),
      adapter: activeCapability,
      provenance,
      summary: {
        parser: "document-file-adapter",
        title: doc.title,
        pageCount: documentManifest.pageCount,
        textLength: documentManifest.textLength,
        tableCount: documentManifest.tableCount,
        markupQuantityCount: markups?.quantityCount ?? 0,
        extractionNotes: notes,
      },
      artifacts: [],
      document: documentManifest,
      markups: markups ?? undefined,
      issues: normalizeIssues(issues),
    };
    const artifacts = await persistFileIngestArtifacts({
      projectId: source.projectId,
      sourceId: source.id,
      checksum: context.checksum,
      manifest,
      extraArtifacts: [
        {
          kind: "document-text",
          fileName: "document.txt",
          payload: doc.content,
          description: "Extracted document text",
          mediaType: "text/plain",
        },
        {
          kind: "document-pages",
          fileName: "pages.json",
          payload: doc.pages,
          description: "Extracted document pages and sections",
        },
        {
          kind: "document-structured-data",
          fileName: "structured-data.json",
          payload: {
            tables: doc.tables,
            keyValuePairs: doc.metadata.keyValuePairs ?? [],
            documentFields: doc.metadata.documentFields ?? [],
            selectionMarks: doc.metadata.selectionMarks ?? [],
          },
          description: "Extracted tables and document fields",
        },
        ...(markups
          ? [{
              kind: "markup-summary" as const,
              fileName: "bluebeam-markups.json",
              payload: markups,
              description: "Detected Bluebeam markup quantities",
            }]
          : []),
      ],
    });
    const finalManifest = { ...manifest, artifacts };
    return {
      status: finalManifest.runStatus,
      family: finalManifest.family,
      manifest: finalManifest,
      issues,
    };
  },
};

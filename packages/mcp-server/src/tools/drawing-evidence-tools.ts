import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { apiGet, apiPatch, apiPost, getProjectId } from "../api-client.js";

const ENGINE_VERSION = 3;
const DEFAULT_RENDER_DPIS = [72, 150];
const DEFAULT_ATLAS_DPI = 150;
const DEFAULT_INSPECTION_DPI = 300;
const CAD_EVIDENCE_EXTENSIONS = new Set(["dwg", "dxf"]);
const MODEL_EVIDENCE_EXTENSIONS = new Set(["ifc", "rvt", "step", "stp", "iges", "igs", "brep", "stl", "obj", "fbx", "gltf", "glb", "3ds", "dae"]);
const ATLAS_ARTIFACT_DIR = ".bidwright/drawing-evidence";

type JsonRecord = Record<string, any>;

interface DrawingRegion {
  id: string;
  documentId: string;
  fileName: string;
  pageNumber: number;
  regionType: string;
  label: string;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
  };
  text: string;
  source: string;
  confidence: number;
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  discipline?: string | null;
  packageTags: string[];
  visualEmbeddingHash: string;
  imageHash?: string | null;
}

interface DrawingAtlas {
  version: number;
  status: "ready" | "partial";
  builtAt: string;
  fingerprint: string;
  projectId: string;
  renderDpis: number[];
  pageCount: number;
  documentCount: number;
  regionCount: number;
  sheetRegistry: JsonRecord[];
  pages: JsonRecord[];
  regions: DrawingRegion[];
  warnings: string[];
  artifactPath?: string;
  artifactHash?: string;
  artifactBytes?: number;
  persistedAs?: string;
}

interface DrawingEvidenceEngineState {
  version?: number;
  atlas?: DrawingAtlas;
  claims?: JsonRecord[];
  contradictions?: JsonRecord[];
  inspections?: JsonRecord[];
  verifications?: JsonRecord[];
  promotedDocuments?: JsonRecord[];
  atlasDocumentRequests?: JsonRecord[];
  asyncEvidenceNotifications?: JsonRecord[];
}

const drawingEvidenceSummaryRequests = new Set<string>();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizedText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function compactText(value: unknown, maxLength = 700) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, Math.max(0, maxLength - 1))}...` : clean;
}

function hashText(value: unknown, length = 16) {
  return createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex").slice(0, length);
}

function imageHash(dataUrl: unknown) {
  const text = String(dataUrl ?? "");
  const base64 = text.replace(/^data:image\/\w+;base64,/, "");
  return createHash("sha256").update(base64).digest("hex");
}

function atlasArtifactPath(projectId = getProjectId()) {
  return path.join(process.cwd(), ATLAS_ARTIFACT_DIR, `${projectId}-atlas-v${ENGINE_VERSION}.json`);
}

function atlasLooksComplete(atlas: any): atlas is DrawingAtlas {
  return Boolean(
    atlas &&
    Array.isArray(atlas.regions) &&
    Array.isArray(atlas.pages) &&
    Array.isArray(atlas.sheetRegistry) &&
    atlas.regions.length === Number(atlas.regionCount ?? atlas.regions.length) &&
    atlas.pages.length === Number(atlas.pageCount ?? atlas.pages.length),
  );
}

function slimPageForStrategy(page: JsonRecord) {
  return {
    documentId: page.documentId,
    fileName: page.fileName,
    pageNumber: page.pageNumber,
    pageCount: page.pageCount,
    nativePageCount: page.nativePageCount,
    declaredPageCount: page.declaredPageCount,
    imageWidth: page.imageWidth,
    imageHeight: page.imageHeight,
    pageImageHash: page.pageImageHash,
    renders: asArray(page.renders).map((render) => ({
      dpi: render.dpi,
      imageWidth: render.imageWidth,
      imageHeight: render.imageHeight,
      imageHash: render.imageHash,
    })),
    drawingEvidence: page.drawingEvidence ? {
      provider: page.drawingEvidence.provider ?? null,
      status: page.drawingEvidence.status ?? null,
      pending: page.drawingEvidence.pending === true,
      cached: page.drawingEvidence.cached === true,
      chunkCount: page.drawingEvidence.chunkCount ?? 0,
      splitCount: page.drawingEvidence.splitCount ?? 0,
    } : null,
  };
}

function slimSheetForStrategy(sheet: JsonRecord) {
  return {
    documentId: sheet.documentId,
    fileName: sheet.fileName,
    pageNumber: sheet.pageNumber,
    sheetNumber: sheet.sheetNumber,
    sheetTitle: sheet.sheetTitle,
    discipline: sheet.discipline,
    revision: sheet.revision,
    scale: sheet.scale,
    packageTags: sheet.packageTags,
    pageImageHash: sheet.pageImageHash,
    drawingEvidence: sheet.drawingEvidence ? {
      provider: sheet.drawingEvidence.provider ?? null,
      status: sheet.drawingEvidence.status ?? null,
      pending: sheet.drawingEvidence.pending === true,
      cached: sheet.drawingEvidence.cached === true,
      chunkCount: sheet.drawingEvidence.chunkCount ?? 0,
      splitCount: sheet.drawingEvidence.splitCount ?? 0,
    } : null,
  };
}

function slimRegionForStrategy(region: DrawingRegion) {
  return {
    id: region.id,
    documentId: region.documentId,
    fileName: region.fileName,
    pageNumber: region.pageNumber,
    regionType: region.regionType,
    label: region.label,
    bbox: region.bbox,
    source: region.source,
    confidence: region.confidence,
    sheetNumber: region.sheetNumber ?? null,
    sheetTitle: region.sheetTitle ?? null,
    discipline: region.discipline ?? null,
    packageTags: region.packageTags,
    imageHash: region.imageHash ?? null,
    snippet: compactText(region.text, 260),
  };
}

async function persistAtlasArtifact(atlas: DrawingAtlas) {
  const artifactPath = atlasArtifactPath(atlas.projectId);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  const text = JSON.stringify(atlas);
  await writeFile(artifactPath, text, "utf8");
  return {
    artifactPath,
    artifactHash: hashText(text, 24),
    artifactBytes: Buffer.byteLength(text, "utf8"),
  };
}

function atlasForStrategy(atlas: DrawingAtlas, artifact: { artifactPath: string; artifactHash: string; artifactBytes: number }): DrawingAtlas {
  return {
    version: atlas.version,
    status: atlas.status,
    builtAt: atlas.builtAt,
    fingerprint: atlas.fingerprint,
    projectId: atlas.projectId,
    renderDpis: atlas.renderDpis,
    pageCount: atlas.pageCount,
    documentCount: atlas.documentCount,
    regionCount: atlas.regionCount,
    sheetRegistry: atlas.sheetRegistry.slice(0, 80).map(slimSheetForStrategy),
    pages: atlas.pages.slice(0, 80).map(slimPageForStrategy),
    regions: atlas.regions.slice(0, 80).map(slimRegionForStrategy) as any,
    warnings: atlas.warnings.slice(0, 100),
    artifactPath: artifact.artifactPath,
    artifactHash: artifact.artifactHash,
    artifactBytes: artifact.artifactBytes,
    persistedAs: "artifact",
  };
}

async function readAtlasArtifact(atlas: any): Promise<DrawingAtlas | null> {
  const configuredPath = String(atlas?.artifactPath ?? "");
  const candidates = [
    configuredPath,
    atlasArtifactPath(String(atlas?.projectId ?? getProjectId())),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const filePath = path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
    try {
      const text = await readFile(filePath, "utf8");
      const parsed = JSON.parse(text) as DrawingAtlas;
      if (
        parsed?.version === ENGINE_VERSION &&
        String(parsed.projectId ?? "") === String(atlas?.projectId ?? getProjectId()) &&
        (!atlas?.fingerprint || parsed.fingerprint === atlas.fingerprint)
      ) {
        return parsed;
      }
    } catch {
      // Try the next candidate; a missing artifact simply means we rebuild.
    }
  }
  return null;
}

async function atlasForRuntime(atlas: any): Promise<DrawingAtlas | null> {
  if (!atlas) return null;
  if (atlasLooksComplete(atlas)) return atlas;
  return readAtlasArtifact(atlas);
}

async function externalizeEngineState(engine: DrawingEvidenceEngineState): Promise<DrawingEvidenceEngineState> {
  const atlas = asRecord(engine.atlas) as DrawingAtlas;
  if (!atlas || !atlas.fingerprint || !Array.isArray(atlas.regions)) return engine;
  if (!atlasLooksComplete(atlas)) return engine;
  const artifact = await persistAtlasArtifact(atlas);
  return {
    ...engine,
    atlas: atlasForStrategy(atlas, artifact),
  };
}

function isIgnoredSourceDocument(fileName: unknown) {
  const name = String(fileName ?? "").toLowerCase();
  return /(^|\/)__macosx(\/|$)|(^|\/)\._|(^|\/)\.ds_store$|(^|\/)thumbs\.db$/.test(name);
}

function isDrawingLikeSourceDocument(doc: any) {
  if (!doc || isIgnoredSourceDocument(doc.fileName) || isIgnoredSourceDocument(doc.storagePath)) return false;
  const documentType = normalizedText(doc.documentType);
  const fileType = normalizedText(doc.fileType);
  const fileName = normalizedText(doc.fileName);
  if (fileType !== "application/pdf" && fileType !== "pdf" && !fileName.endsWith(".pdf")) return false;
  return documentType === "drawing";
}

function fileExtension(value: unknown) {
  const fileName = normalizedText(value);
  const match = fileName.match(/\.([a-z0-9]+)(?:$|\?)/);
  return match?.[1] ?? "";
}

function isPdfSourceDocument(doc: any) {
  const fileType = normalizedText(doc?.fileType);
  const fileName = normalizedText(doc?.fileName);
  return fileType === "application/pdf" || fileType === "pdf" || fileName.endsWith(".pdf");
}

function isCadSourceDocument(doc: any) {
  if (!doc || isIgnoredSourceDocument(doc.fileName)) return false;
  const ext = fileExtension(doc.fileName || doc.fileType);
  return CAD_EVIDENCE_EXTENSIONS.has(ext);
}

function isEvidenceSourceDocument(doc: any) {
  return isDrawingLikeSourceDocument(doc) || isCadSourceDocument(doc);
}

/**
 * Reads the cached drawing-evidence record produced by any provider (LandingAI or Gemini).
 * The schemaVersion=2 record lives at structuredData.drawingEvidence.
 */
function drawingEvidenceFromDocument(doc: JsonRecord) {
  const cache = asRecord(asRecord(doc.structuredData).drawingEvidence);
  if (Object.keys(cache).length === 0 || cache.schemaVersion !== 2) return null;
  const status = normalizedText(cache.status ?? "completed");
  const meta = asRecord(cache.meta);
  return {
    success: status !== "failed",
    skipped: false,
    cached: true,
    status: cache.status ?? "completed",
    provider: cache.provider ?? meta.provider ?? null,
    pending: ["queued", "running"].includes(status),
    documentId: doc.id,
    fileName: doc.fileName,
    model: meta.model ?? null,
    endpoint: meta.endpoint ?? null,
    job: cache.job ?? null,
    reason: cache.error ?? cache.reason ?? null,
    parse: cache.parse ?? {},
    extract: cache.extract ?? null,
  };
}

function drawingEvidenceResponseSummary(record: JsonRecord | null) {
  if (!record) return null;
  const parse = asRecord(record.parse);
  return {
    success: record.success !== false,
    skipped: record.skipped ?? false,
    cached: record.cached ?? false,
    status: record.status ?? null,
    provider: record.provider ?? null,
    pending: record.pending ?? false,
    reason: record.reason ?? record.message ?? null,
    model: record.model ?? null,
    chunkCount: asArray(parse.chunks).length,
    splitCount: asArray(parse.splits).length,
  };
}

function activeAtlasDocumentRequests(engine: DrawingEvidenceEngineState) {
  return asArray(engine.atlasDocumentRequests)
    .map(asRecord)
    .filter((entry) => String(entry.documentId ?? "").trim() && normalizedText(entry.status ?? "active") === "active");
}

function isNativeModelAsset(asset: JsonRecord) {
  const format = normalizedText(asset.format || fileExtension(asset.fileName));
  return MODEL_EVIDENCE_EXTENSIONS.has(format) && !CAD_EVIDENCE_EXTENSIONS.has(format);
}

function documentPackageTags(fileName: string) {
  const parts = fileName.split(/[\\/]/g).slice(0, -1);
  const tags = parts
    .flatMap((part) => part.split(/[-_\s]+/g))
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3 && part !== "pdf");
  return [...new Set(tags)].slice(0, 12);
}

function fileBaseName(fileName: string) {
  return fileName.split(/[\\/]/g).pop() || fileName;
}

function inferDiscipline(fileName: string, text: string) {
  const haystack = `${fileName} ${text}`.toLowerCase();
  if (/struct|foundation|footing|anchor|base plate|crane|runway|steel|platform/.test(haystack)) return "structural";
  if (/p&id|pid|pipe|tank|pump|valve|process|mechanical/.test(haystack)) return "mechanical";
  if (/electrical|single[- ]line|one[- ]line|mcc|panel/.test(haystack)) return "electrical";
  if (/instrument|control|loop|io\b|i\/o/.test(haystack)) return "controls";
  return "unknown";
}

function inferSheetNumber(fileName: string, text: string) {
  const base = fileBaseName(fileName).replace(/\.[^.]+$/, "");
  const candidates = [
    /\b(?:dwg|drawing|sheet)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Z]?\d{1,6}(?:[-_.][A-Z0-9]+){0,4})/i,
    /\b([A-Z]\d{2,4}(?:[-_.][A-Z0-9]+){0,3})\b/i,
    /\b([A-Z]\d{1,3})\b/i,
  ];
  for (const pattern of candidates) {
    const match = text.match(pattern) || base.match(pattern);
    if (match?.[1]) return match[1].replace(/_/g, "-");
  }
  const baseCode = base.match(/\b([A-Z]?\d{2,6}(?:[-_][A-Z0-9]+){1,5})\b/i)?.[1];
  return baseCode ? baseCode.replace(/_/g, "-") : base.slice(0, 80);
}

function inferSheetTitle(fileName: string, text: string) {
  const base = fileBaseName(fileName)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titleLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => /layout|platform|ladder|foundation|tank|crane|runway|assembly|parts|bom|plan|detail|elevation/i.test(line) && line.length <= 160);
  return titleLine || base;
}

function tableText(table: JsonRecord) {
  const headers = asArray(table.headers).join(" | ");
  const rows = asArray(table.rows)
    .slice(0, 30)
    .map((row) => Array.isArray(row) ? row.join(" | ") : String(row ?? ""))
    .join("\n");
  return [headers, rows, String(table.rawMarkdown ?? "")].filter(Boolean).join("\n");
}

function pageStructuredText(doc: JsonRecord, pageNumber: number) {
  const structured = asRecord(doc.structuredData);
  const tables = asArray(structured.tables)
    .filter((table) => Number(asRecord(table).pageNumber ?? 1) === pageNumber)
    .map((table) => tableText(asRecord(table)));
  const kvs = asArray(structured.keyValuePairs)
    .filter((pair) => {
      const record = asRecord(pair);
      const page = Number(record.pageNumber ?? record.key?.pageNumber ?? record.value?.pageNumber ?? pageNumber);
      return !Number.isFinite(page) || page === pageNumber;
    })
    .map((pair) => JSON.stringify(pair));
  return [doc.extractedText ? compactText(doc.extractedText, 1_500) : "", ...tables, ...kvs].filter(Boolean).join("\n");
}

function clampRegion(
  region: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
) {
  const x = Math.max(0, Math.min(imageWidth - 1, Math.round(region.x)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.round(region.y)));
  const width = Math.max(1, Math.min(imageWidth - x, Math.round(region.width)));
  const height = Math.max(1, Math.min(imageHeight - y, Math.round(region.height)));
  return { x, y, width, height, imageWidth, imageHeight };
}

function proportionalRegion(
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  return clampRegion({
    x: imageWidth * x,
    y: imageHeight * y,
    width: imageWidth * width,
    height: imageHeight * height,
  }, imageWidth, imageHeight);
}

function regionId(region: Omit<DrawingRegion, "id">) {
  return `region-${hashText([
    region.documentId,
    region.pageNumber,
    region.regionType,
    region.label,
    region.bbox,
    compactText(region.text, 400),
  ])}`;
}

function makeRegion(input: Omit<DrawingRegion, "id" | "visualEmbeddingHash">): DrawingRegion {
  const withoutId = {
    ...input,
    visualEmbeddingHash: hashText(`${input.regionType}\n${input.label}\n${input.text}\n${input.sheetNumber ?? ""}\n${input.sheetTitle ?? ""}`, 24),
  };
  return {
    id: regionId(withoutId),
    ...withoutId,
  };
}

function semanticPageRegions(args: {
  doc: JsonRecord;
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  sheetNumber: string | null;
  sheetTitle: string | null;
  discipline: string | null;
  packageTags: string[];
  text: string;
}) {
  const common = {
    documentId: String(args.doc.id),
    fileName: String(args.doc.fileName ?? ""),
    pageNumber: args.pageNumber,
    sheetNumber: args.sheetNumber,
    sheetTitle: args.sheetTitle,
    discipline: args.discipline,
    packageTags: args.packageTags,
    imageHash: null,
  };
  const zones = [
    ["title_block", "title block / revision block", proportionalRegion(args.imageWidth, args.imageHeight, 0.55, 0.68, 0.43, 0.29), 0.62],
    ["legend", "legend / keyed notes / right-side schedules", proportionalRegion(args.imageWidth, args.imageHeight, 0.60, 0.06, 0.38, 0.58), 0.46],
    ["plan_view", "main plan or assembly view", proportionalRegion(args.imageWidth, args.imageHeight, 0.06, 0.08, 0.72, 0.68), 0.42],
    ["detail", "lower detail band", proportionalRegion(args.imageWidth, args.imageHeight, 0.05, 0.56, 0.72, 0.39), 0.42],
    ["notes", "upper notes / callouts", proportionalRegion(args.imageWidth, args.imageHeight, 0.05, 0.03, 0.90, 0.24), 0.38],
  ] as const;

  return zones.map(([regionType, label, bbox, confidence]) => makeRegion({
    ...common,
    regionType,
    label,
    bbox,
    text: compactText(args.text, 900),
    source: "heuristic_page_zone",
    confidence,
  }));
}

function tableRegionType(text: string) {
  const lower = text.toLowerCase();
  if (/find no|part\s*list|parts?\s*list|qty|quantity|bill of material|\bbom\b|description/.test(lower)) return "bom_table";
  if (/rev\.?|drawn|checked|approved|drawing number|scale|plot/.test(lower)) return "title_block";
  if (/note|general notes|keyed notes/.test(lower)) return "notes";
  return "schedule";
}

function tableRegionBBox(regionType: string, imageWidth: number, imageHeight: number) {
  if (regionType === "title_block") return proportionalRegion(imageWidth, imageHeight, 0.50, 0.66, 0.48, 0.31);
  if (regionType === "bom_table" || regionType === "schedule") return proportionalRegion(imageWidth, imageHeight, 0.03, 0.04, 0.94, 0.70);
  return proportionalRegion(imageWidth, imageHeight, 0.04, 0.04, 0.92, 0.42);
}

function tableRegions(args: {
  doc: JsonRecord;
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  sheetNumber: string | null;
  sheetTitle: string | null;
  discipline: string | null;
  packageTags: string[];
}) {
  const structured = asRecord(args.doc.structuredData);
  return asArray(structured.tables)
    .map((table) => asRecord(table))
    .filter((table) => Number(table.pageNumber ?? 1) === args.pageNumber)
    .slice(0, 16)
    .map((table, index) => {
      const text = tableText(table);
      const regionType = tableRegionType(text);
      return makeRegion({
        documentId: String(args.doc.id),
        fileName: String(args.doc.fileName ?? ""),
        pageNumber: args.pageNumber,
        regionType,
        label: `${regionType.replace(/_/g, " ")} ${index + 1}`,
        bbox: tableRegionBBox(regionType, args.imageWidth, args.imageHeight),
        text: compactText(text, 2_500),
        source: "azure_table_text_with_heuristic_bbox",
        confidence: 0.74,
        sheetNumber: args.sheetNumber,
        sheetTitle: args.sheetTitle,
        discipline: args.discipline,
        packageTags: args.packageTags,
        imageHash: null,
      });
    });
}

function flattenObjectLines(value: unknown, prefix = "", limit = 80): string[] {
  if (limit <= 0) return [];
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) {
    const lines: string[] = [];
    value.slice(0, Math.min(value.length, limit)).forEach((item, index) => {
      lines.push(...flattenObjectLines(item, `${prefix}[${index}]`, limit - lines.length));
    });
    return lines.slice(0, limit);
  }
  if (typeof value === "object") {
    const lines: string[] = [];
    for (const [key, child] of Object.entries(value as JsonRecord)) {
      lines.push(...flattenObjectLines(child, prefix ? `${prefix}.${key}` : key, limit - lines.length));
      if (lines.length >= limit) break;
    }
    return lines.slice(0, limit);
  }
  return [`${prefix}: ${String(value)}`];
}

/** Provider-agnostic helpers — used for LandingAI ADE chunks and Gemini-emitted chunks alike. */

function providerChunkText(chunk: JsonRecord) {
  return compactText(chunk.markdown ?? chunk.text ?? chunk.content ?? "", 2_500);
}

function providerChunkPage(chunk: JsonRecord) {
  const grounding = asRecord(asArray(chunk.grounding)[0] ?? chunk.grounding);
  const page = Number(grounding.page ?? chunk.pageNumber ?? chunk.page);
  return Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
}

function providerRegionType(chunkType: unknown) {
  const type = normalizedText(chunkType);
  if (type.includes("table")) return "provider_table";
  if (type.includes("figure") || type.includes("image")) return "provider_figure";
  if (type.includes("logo")) return "provider_logo";
  return "provider_text";
}

function providerChunkBBox(chunk: JsonRecord, imageWidth: number, imageHeight: number) {
  const groundingFirst = asArray(chunk.grounding)[0];
  const groundingObj = groundingFirst ? asRecord(groundingFirst) : asRecord(chunk.grounding);
  const box = asRecord(groundingObj.box ?? chunk.box ?? chunk.bbox);
  const left = Number(box.left ?? box.x);
  const top = Number(box.top ?? box.y);
  const right = Number(box.right ?? (Number.isFinite(left) ? left + Number(box.width ?? 0) : undefined));
  const bottom = Number(box.bottom ?? (Number.isFinite(top) ? top + Number(box.height ?? 0) : undefined));
  if ([left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top) {
    const max = Math.max(Math.abs(left), Math.abs(top), Math.abs(right), Math.abs(bottom));
    const normalized = max <= 1.5;
    return clampRegion({
      x: normalized ? left * imageWidth : left,
      y: normalized ? top * imageHeight : top,
      width: normalized ? (right - left) * imageWidth : right - left,
      height: normalized ? (bottom - top) * imageHeight : bottom - top,
    }, imageWidth, imageHeight);
  }
  return proportionalRegion(imageWidth, imageHeight, 0.05, 0.05, 0.90, 0.50);
}

/** Convert a cached drawing-evidence summary into atlas regions. Provider-agnostic. */
function providerRegions(args: {
  doc: JsonRecord;
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  sheetNumber: string | null;
  sheetTitle: string | null;
  discipline: string | null;
  packageTags: string[];
  pageImageHash: string | null;
  evidenceSummary: JsonRecord | null;
}) {
  const providerId = String(args.evidenceSummary?.provider ?? "");
  const parseSource = providerId ? `${providerId.toLowerCase()}_parse` : "drawing_evidence_parse";
  const extractSource = providerId ? `${providerId.toLowerCase()}_extract` : "drawing_evidence_extract";
  const labelPrefix = providerId === "landingAi" ? "LandingAI"
    : providerId === "geminiPro" ? "Gemini Pro"
    : providerId === "geminiFlash" ? "Gemini Flash"
    : "Drawing evidence";

  const parse = asRecord(args.evidenceSummary?.parse);
  const chunks = asArray(parse.chunks).map(asRecord).filter((chunk) => providerChunkPage(chunk) === args.pageNumber);
  const chunkRegions = chunks.slice(0, 60).map((chunk, index) => makeRegion({
    documentId: String(args.doc.id),
    fileName: String(args.doc.fileName ?? ""),
    pageNumber: args.pageNumber,
    regionType: providerRegionType(chunk.type),
    label: `${labelPrefix} ${String(chunk.type ?? "chunk")} ${index + 1}`,
    bbox: providerChunkBBox(chunk, args.imageWidth, args.imageHeight),
    text: providerChunkText(chunk),
    source: parseSource,
    confidence: 0.86,
    sheetNumber: args.sheetNumber,
    sheetTitle: args.sheetTitle,
    discipline: args.discipline,
    packageTags: args.packageTags,
    imageHash: args.pageImageHash,
  }));

  if (args.pageNumber !== 1) return chunkRegions;
  const extract = asRecord(args.evidenceSummary?.extract);
  const extraction = asRecord(extract.extraction);
  const extractionLines = flattenObjectLines(extraction, "", 120);
  if (extractionLines.length === 0) return chunkRegions;
  return [
    ...chunkRegions,
    makeRegion({
      documentId: String(args.doc.id),
      fileName: String(args.doc.fileName ?? ""),
      pageNumber: args.pageNumber,
      regionType: "provider_extraction",
      label: `${labelPrefix} structured drawing extraction`,
      bbox: proportionalRegion(args.imageWidth, args.imageHeight, 0.02, 0.02, 0.96, 0.30),
      text: compactText(extractionLines.join("\n"), 4_000),
      source: extractSource,
      confidence: 0.88,
      sheetNumber: args.sheetNumber,
      sheetTitle: args.sheetTitle,
      discipline: args.discipline,
      packageTags: args.packageTags,
      imageHash: args.pageImageHash,
    }),
  ];
}

function nativeSummaryText(title: string, value: unknown, maxLength = 3_000) {
  return compactText(`${title}\n${JSON.stringify(value ?? {}, null, 2)}`, maxLength);
}

function cadBBox(boundsValue: unknown, extentsValue: unknown, imageWidth: number, imageHeight: number) {
  const bounds = asRecord(boundsValue);
  const extents = asRecord(extentsValue);
  const minX = Number(bounds.minX);
  const minY = Number(bounds.minY);
  const maxX = Number(bounds.maxX);
  const maxY = Number(bounds.maxY);
  const eMinX = Number(extents.minX);
  const eMinY = Number(extents.minY);
  const eMaxX = Number(extents.maxX);
  const eMaxY = Number(extents.maxY);
  if (![minX, minY, maxX, maxY, eMinX, eMinY, eMaxX, eMaxY].every(Number.isFinite) || eMaxX <= eMinX || eMaxY <= eMinY) {
    return proportionalRegion(imageWidth, imageHeight, 0.05, 0.05, 0.90, 0.90);
  }
  const x = (minX - eMinX) / (eMaxX - eMinX);
  const y = 1 - ((maxY - eMinY) / (eMaxY - eMinY));
  const width = (maxX - minX) / (eMaxX - eMinX);
  const height = (maxY - minY) / (eMaxY - eMinY);
  return proportionalRegion(imageWidth, imageHeight, x, y, Math.max(width, 0.01), Math.max(height, 0.01));
}

async function addCadDocumentToAtlas(args: {
  doc: JsonRecord;
  pages: JsonRecord[];
  sheetRegistry: JsonRecord[];
  regions: DrawingRegion[];
  warnings: string[];
}) {
  const imageWidth = 1600;
  const imageHeight = 1000;
  const packageTags = documentPackageTags(String(args.doc.fileName ?? ""));
  const result = await apiGet<JsonRecord>(`/api/takeoff/${getProjectId()}/documents/${args.doc.id}/dwg-metadata`).catch((error) => {
    args.warnings.push(`CAD adapter unavailable for ${args.doc.fileName}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  const sourceText = nativeSummaryText("CAD/DWG native adapter summary", {
    status: result?.status ?? "unavailable",
    sourceKind: result?.sourceKind ?? fileExtension(args.doc.fileName),
    units: result?.units ?? "",
    extents: result?.extents ?? null,
    entityStats: result?.entityStats ?? {},
    layers: asArray(result?.layers).slice(0, 80),
    layouts: asArray(result?.layouts).slice(0, 20),
    converter: result?.converter ?? null,
  }, 5_000);
  const sheetNumber = inferSheetNumber(String(args.doc.fileName ?? ""), sourceText);
  const sheetTitle = inferSheetTitle(String(args.doc.fileName ?? ""), sourceText);
  const discipline = inferDiscipline(String(args.doc.fileName ?? ""), sourceText);
  const pageImageHash = result?.thumbnailSvg ? hashText(result.thumbnailSvg, 32) : null;

  args.pages.push({
    documentId: args.doc.id,
    fileName: args.doc.fileName,
    pageNumber: 1,
    pageCount: 1,
    sourceKind: "cad",
    imageWidth,
    imageHeight,
    pageWidth: null,
    pageHeight: null,
    pageImageHash,
    renders: [],
    cadNative: {
      status: result?.status ?? "unavailable",
      sourceKind: result?.sourceKind ?? fileExtension(args.doc.fileName),
      units: result?.units ?? "",
      layerCount: asArray(result?.layers).length,
      layoutCount: asArray(result?.layouts).length,
      entityStats: result?.entityStats ?? {},
      converter: result?.converter ?? null,
    },
  });
  args.sheetRegistry.push({
    documentId: args.doc.id,
    fileName: args.doc.fileName,
    pageNumber: 1,
    sourceKind: "cad",
    sheetNumber,
    sheetTitle,
    discipline,
    revision: null,
    scale: null,
    packageTags,
    pageImageHash,
    cadNative: {
      status: result?.status ?? "unavailable",
      units: result?.units ?? "",
      extents: result?.extents ?? null,
      entityStats: result?.entityStats ?? {},
    },
  });

  const common = {
    documentId: String(args.doc.id),
    fileName: String(args.doc.fileName ?? ""),
    pageNumber: 1,
    sheetNumber,
    sheetTitle,
    discipline,
    packageTags,
    imageHash: pageImageHash,
  };
  args.regions.push(makeRegion({
    ...common,
    regionType: "cad_native_summary",
    label: "CAD native layer/entity/layout summary",
    bbox: proportionalRegion(imageWidth, imageHeight, 0.02, 0.02, 0.96, 0.22),
    text: sourceText,
    source: "dwg_dxf_native_adapter",
    confidence: result?.status === "processed" ? 0.92 : 0.45,
  }));

  for (const [index, layer] of asArray(result?.layers).map(asRecord).slice(0, 80).entries()) {
    args.regions.push(makeRegion({
      ...common,
      regionType: "cad_layer",
      label: `CAD layer ${String(layer.name ?? index + 1)}`,
      bbox: proportionalRegion(imageWidth, imageHeight, 0.02, 0.25 + (index % 10) * 0.055, 0.46, 0.05),
      text: nativeSummaryText("CAD layer", layer, 1_200),
      source: "dwg_dxf_native_adapter",
      confidence: 0.84,
    }));
  }
  for (const [index, layout] of asArray(result?.layouts).map(asRecord).slice(0, 20).entries()) {
    args.regions.push(makeRegion({
      ...common,
      regionType: "cad_layout",
      label: `CAD layout ${String(layout.name ?? index + 1)}`,
      bbox: cadBBox(layout.bounds, result?.extents, imageWidth, imageHeight),
      text: nativeSummaryText("CAD layout", layout, 1_400),
      source: "dwg_dxf_native_adapter",
      confidence: 0.84,
    }));
  }
  for (const [index, entity] of asArray(result?.entities).map(asRecord).slice(0, 250).entries()) {
    args.regions.push(makeRegion({
      ...common,
      regionType: "cad_entity",
      label: `CAD ${String(entity.type ?? "entity")} ${index + 1}`,
      bbox: cadBBox(entity.bounds, result?.extents, imageWidth, imageHeight),
      text: nativeSummaryText("CAD entity", {
        type: entity.type,
        layer: entity.layer,
        layoutName: entity.layoutName,
        text: entity.text ?? "",
        bounds: entity.bounds,
        radius: entity.radius,
        closed: entity.closed,
      }, 1_500),
      source: "dwg_dxf_native_adapter",
      confidence: 0.78,
    }));
  }
}

function modelPseudoBBox(index: number, imageWidth: number, imageHeight: number) {
  const column = index % 3;
  const row = Math.floor(index / 3) % 8;
  return proportionalRegion(imageWidth, imageHeight, 0.03 + column * 0.32, 0.28 + row * 0.08, 0.28, 0.065);
}

async function addModelAssetToAtlas(args: {
  asset: JsonRecord;
  pages: JsonRecord[];
  sheetRegistry: JsonRecord[];
  regions: DrawingRegion[];
  warnings: string[];
}) {
  const detail = await apiGet<JsonRecord>(`/api/models/${getProjectId()}/assets/${args.asset.id}`).catch((error) => {
    args.warnings.push(`Model adapter detail unavailable for ${args.asset.fileName}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  const asset = asRecord(detail?.asset ?? args.asset);
  const imageWidth = 1600;
  const imageHeight = 1000;
  const documentId = String(asset.sourceDocumentId ?? asset.fileNodeId ?? asset.id);
  const fileName = String(asset.fileName ?? "model");
  const packageTags = documentPackageTags(fileName);
  const summaryText = nativeSummaryText("BIM/3D model native adapter summary", {
    status: asset.status,
    format: asset.format,
    units: asset.units,
    manifest: asset.manifest ?? {},
    elementStats: asset.elementStats ?? {},
    counts: asset._count ?? {},
    issues: asArray(asset.issues).slice(0, 30),
  }, 5_000);
  const sheetNumber = inferSheetNumber(fileName, summaryText);
  const sheetTitle = inferSheetTitle(fileName, summaryText);
  const discipline = inferDiscipline(fileName, summaryText);
  const pageImageHash = hashText([asset.id, asset.checksum, asset.manifest], 32);
  const bomRows = asArray(asRecord(asArray(asset.boms)[0]).rows ?? asset.bom);
  const quantities = asArray(asset.quantities).map(asRecord);
  const elements = asArray(asset.elements).map(asRecord);

  args.pages.push({
    documentId,
    fileName,
    pageNumber: 1,
    pageCount: 1,
    sourceKind: "model",
    imageWidth,
    imageHeight,
    pageWidth: null,
    pageHeight: null,
    pageImageHash,
    renders: [],
    modelNative: {
      modelId: asset.id,
      status: asset.status,
      format: asset.format,
      units: asset.units,
      manifest: asset.manifest ?? {},
      elementStats: asset.elementStats ?? {},
      counts: asset._count ?? {},
    },
  });
  args.sheetRegistry.push({
    documentId,
    modelId: asset.id,
    fileName,
    pageNumber: 1,
    sourceKind: "model",
    sheetNumber,
    sheetTitle,
    discipline,
    revision: null,
    scale: null,
    packageTags,
    pageImageHash,
    modelNative: {
      status: asset.status,
      format: asset.format,
      units: asset.units,
      manifest: asset.manifest ?? {},
      elementStats: asset.elementStats ?? {},
    },
  });

  const common = {
    documentId,
    fileName,
    pageNumber: 1,
    sheetNumber,
    sheetTitle,
    discipline,
    packageTags,
    imageHash: pageImageHash,
  };
  args.regions.push(makeRegion({
    ...common,
    regionType: "model_native_summary",
    label: "BIM/3D model manifest and quantity summary",
    bbox: proportionalRegion(imageWidth, imageHeight, 0.02, 0.02, 0.96, 0.22),
    text: summaryText,
    source: "model_asset_adapter",
    confidence: asset.status === "indexed" ? 0.90 : 0.55,
  }));
  if (bomRows.length > 0) {
    args.regions.push(makeRegion({
      ...common,
      regionType: "model_bom",
      label: "Model-derived BOM rows",
      bbox: proportionalRegion(imageWidth, imageHeight, 0.02, 0.25, 0.46, 0.34),
      text: compactText(bomRows.slice(0, 120).map((row) => JSON.stringify(row)).join("\n"), 4_000),
      source: "model_asset_adapter",
      confidence: 0.88,
    }));
  }
  for (const [index, quantity] of quantities.slice(0, 250).entries()) {
    const confidence = Number(quantity.confidence ?? 0.82);
    args.regions.push(makeRegion({
      ...common,
      regionType: "model_quantity",
      label: `Model quantity ${String(quantity.quantityType ?? index + 1)}`,
      bbox: modelPseudoBBox(index, imageWidth, imageHeight),
      text: nativeSummaryText("Model quantity", quantity, 1_500),
      source: "model_asset_adapter",
      confidence: Number.isFinite(confidence) ? confidence : 0.82,
    }));
  }
  for (const [index, element] of elements.slice(0, 250).entries()) {
    args.regions.push(makeRegion({
      ...common,
      regionType: "model_element",
      label: `Model ${String(element.elementClass ?? "element")} ${String(element.name ?? index + 1)}`,
      bbox: modelPseudoBBox(index + quantities.length, imageWidth, imageHeight),
      text: nativeSummaryText("Model element", {
        externalId: element.externalId,
        name: element.name,
        elementClass: element.elementClass,
        elementType: element.elementType,
        system: element.system,
        level: element.level,
        material: element.material,
        bbox: element.bbox,
        properties: element.properties,
        quantities: asArray(element.quantities).slice(0, 20),
      }, 1_800),
      source: "model_asset_adapter",
      confidence: 0.78,
    }));
  }
}

function atlasFingerprint(docs: JsonRecord[], modelAssets: JsonRecord[] = [], settingsFingerprint: JsonRecord = {}) {
  return hashText({
    docs: docs.map((doc) => ({
      id: doc.id,
      fileName: doc.fileName,
      fileType: doc.fileType,
      documentType: doc.documentType,
      pageCount: doc.pageCount,
      checksum: doc.checksum,
      structuredDataHash: hashText(doc.structuredData ?? null, 16),
    })),
    modelAssets: modelAssets.map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      format: asset.format,
      status: asset.status,
      checksum: asset.checksum,
      sourceDocumentId: asset.sourceDocumentId,
      fileNodeId: asset.fileNodeId,
      count: asRecord(asset._count),
    })),
    settingsFingerprint,
  }, 32);
}

async function getWorkspace() {
  const raw = await apiGet(`/projects/${getProjectId()}/workspace`);
  return asRecord((raw as any).workspace) || raw;
}

async function getSettingsFingerprint() {
  const settings = await apiGet<JsonRecord>("/settings").catch(() => null);
  const integrations = asRecord(settings?.integrations);
  const provider = String(integrations.drawingExtractionProvider ?? (integrations.landingAiDrawingExtractionEnabled === true ? "landingAi" : "none"));
  const landingAiKey = String(integrations.landingAiApiKey ?? "");
  const geminiKey = String(integrations.geminiApiKey ?? "");
  return {
    drawingExtractionProvider: provider,
    drawingExtractionEnabled: integrations.drawingExtractionEnabled === true || integrations.landingAiDrawingExtractionEnabled === true,
    landingAiEndpoint: integrations.landingAiEndpoint || "",
    landingAiParseModel: integrations.landingAiParseModel || "",
    landingAiExtractModel: integrations.landingAiExtractModel || "",
    landingAiKeyHash: landingAiKey ? hashText(landingAiKey, 10) : "",
    geminiProModel: integrations.geminiProModel || "",
    geminiFlashModel: integrations.geminiFlashModel || "",
    geminiThinkingEnabled: integrations.geminiThinkingEnabled !== false,
    geminiKeyHash: geminiKey ? hashText(geminiKey, 10) : "",
  };
}

async function listModelAssetsForFingerprint() {
  const data = await apiGet<JsonRecord>(`/api/models/${getProjectId()}/assets`).catch(() => null);
  return asArray(data?.assets).map(asRecord).filter(isNativeModelAsset);
}

async function syncModelAssetsForAtlas(warnings: string[]) {
  const data = await apiPost<JsonRecord>(`/api/models/${getProjectId()}/assets/scan`).catch((error) => {
    warnings.push(`Model asset scan unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  return asArray(data?.assets).map(asRecord).filter(isNativeModelAsset);
}

async function findWorkspaceDocument(documentId: string) {
  const ws = await getWorkspace();
  return asArray(ws.sourceDocuments).map(asRecord).find((doc) => String(doc.id ?? "") === documentId) ?? null;
}

async function getStrategy() {
  const data = await apiGet<{ strategy: JsonRecord | null }>(`/api/estimate/${getProjectId()}/strategy`);
  return data.strategy ? asRecord(data.strategy) : null;
}

async function saveEngineState(mutator: (state: DrawingEvidenceEngineState, summary: JsonRecord) => DrawingEvidenceEngineState) {
  const strategy = await getStrategy();
  const summary = asRecord(strategy?.summary);
  const current = asRecord(summary.drawingEvidenceEngine) as DrawingEvidenceEngineState;
  const nextEngine = {
    version: ENGINE_VERSION,
    claims: asArray(current.claims),
    contradictions: asArray(current.contradictions),
    inspections: asArray(current.inspections),
    verifications: asArray(current.verifications),
    promotedDocuments: asArray(current.promotedDocuments),
    atlasDocumentRequests: asArray(current.atlasDocumentRequests),
    asyncEvidenceNotifications: asArray(current.asyncEvidenceNotifications),
    atlas: current.atlas,
    ...mutator(current, summary),
  };
  const persistedEngine = await externalizeEngineState(nextEngine);
  const nextSummary = { ...summary, drawingEvidenceEngine: persistedEngine };
  await apiPost(`/api/estimate/${getProjectId()}/strategy/section`, { section: "summary", data: nextSummary });
  return persistedEngine;
}

function engineFromStrategy(strategy: JsonRecord | null): DrawingEvidenceEngineState {
  const summary = asRecord(strategy?.summary);
  return asRecord(summary.drawingEvidenceEngine) as DrawingEvidenceEngineState;
}

function queueDrawingEvidenceSummary(args: {
  documentId: string;
  fileName: string;
  includeExtraction?: boolean;
  force?: boolean;
  allowNonDrawing?: boolean;
  atlasInclusionReason?: string;
  updateAtlasDocumentRequest?: boolean;
}) {
  const projectId = getProjectId();
  const requestKey = `${projectId}:${args.documentId}:${args.force === true}:${args.includeExtraction !== false}:${args.allowNonDrawing === true}:${hashText(args.atlasInclusionReason ?? "", 8)}`;
  const queuedAt = new Date().toISOString();
  const alreadyQueued = drawingEvidenceSummaryRequests.has(requestKey);
  if (!alreadyQueued) {
    drawingEvidenceSummaryRequests.add(requestKey);
    void apiPost<JsonRecord>("/api/vision/drawing-extraction-summary", {
      projectId,
      documentId: args.documentId,
      includeExtraction: args.includeExtraction !== false,
      force: args.force === true,
      background: true,
      allowNonDrawing: args.allowNonDrawing === true,
      atlasInclusionReason: args.atlasInclusionReason,
    }).then(async (summary) => {
      const record = asRecord(summary);
      const responseSummary = drawingEvidenceResponseSummary(record);
      const status = normalizedText(record.status ?? (record.pending === true ? "running" : "completed"));
      const provider = String(record.provider ?? "drawing_evidence");
      const notificationType = record.success === false
        ? "drawing_evidence_start_failed"
        : record.skipped === true
          ? "drawing_evidence_skipped"
          : ["queued", "running"].includes(status)
            ? "drawing_evidence_queued"
            : "drawing_evidence_ready";
      await saveEngineState((state) => ({
        ...state,
        atlasDocumentRequests: args.updateAtlasDocumentRequest
          ? asArray(state.atlasDocumentRequests).map((entry) => {
              const r = asRecord(entry);
              return String(r.documentId ?? "") === args.documentId
                ? {
                    ...r,
                    drawingEvidence: responseSummary,
                    drawingEvidenceQueuedAt: r.drawingEvidenceQueuedAt ?? queuedAt,
                    drawingEvidenceUpdatedAt: new Date().toISOString(),
                  }
                : r;
            })
          : asArray(state.atlasDocumentRequests),
        asyncEvidenceNotifications: [
          {
            id: `${notificationType}-${hashText({ documentId: args.documentId, queuedAt, status }, 12)}`,
            type: notificationType,
            provider,
            status: record.status ?? (record.pending === true ? "running" : "completed"),
            documentId: args.documentId,
            fileName: args.fileName,
            message: record.message
              ?? (record.skipped === true
                ? `Drawing evidence (${provider}) skipped for ${args.fileName}: ${record.reason ?? "not available"}.`
                : `Drawing evidence (${provider}) ${record.pending === true ? "queued" : "ready"} for ${args.fileName}.`),
            createdAt: new Date().toISOString(),
          },
          ...asArray(state.asyncEvidenceNotifications),
        ].slice(0, 80),
      })).catch(() => null);
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await saveEngineState((state) => ({
        ...state,
        atlasDocumentRequests: args.updateAtlasDocumentRequest
          ? asArray(state.atlasDocumentRequests).map((entry) => {
              const r = asRecord(entry);
              return String(r.documentId ?? "") === args.documentId
                ? {
                    ...r,
                    drawingEvidence: {
                      success: false,
                      skipped: false,
                      cached: false,
                      status: "failed",
                      pending: false,
                      reason: message,
                      chunkCount: 0,
                      splitCount: 0,
                    },
                    drawingEvidenceQueuedAt: r.drawingEvidenceQueuedAt ?? queuedAt,
                    drawingEvidenceUpdatedAt: new Date().toISOString(),
                  }
                : r;
            })
          : asArray(state.atlasDocumentRequests),
        asyncEvidenceNotifications: [
          {
            id: `drawing-evidence-start-error-${hashText({ documentId: args.documentId, queuedAt }, 12)}`,
            type: "drawing_evidence_start_failed",
            status: "failed",
            documentId: args.documentId,
            fileName: args.fileName,
            message: `Drawing evidence could not be queued for ${args.fileName}: ${message}`,
            createdAt: new Date().toISOString(),
          },
          ...asArray(state.asyncEvidenceNotifications),
        ].slice(0, 80),
      })).catch(() => null);
    }).finally(() => {
      drawingEvidenceSummaryRequests.delete(requestKey);
    });
  }

  return {
    success: true,
    skipped: false,
    cached: false,
    status: alreadyQueued ? "running" : "queued",
    pending: true,
    documentId: args.documentId,
    fileName: args.fileName,
    provider: null,
    model: null,
    job: null,
    reason: alreadyQueued ? "already_queued_by_mcp" : "queued_non_blocking",
    queuedAt,
    parse: {},
    extract: null,
  };
}

async function buildAtlas(options: { force?: boolean; renderDpis?: number[]; maxPagesPerDocument?: number }) {
  const ws = await getWorkspace();
  const strategy = await getStrategy();
  const currentEngine = engineFromStrategy(strategy);
  const atlasRequests = activeAtlasDocumentRequests(currentEngine);
  const atlasRequestByDocumentId = new Map(atlasRequests.map((entry) => [String(entry.documentId), entry]));
  const requestedDocIds = new Set(atlasRequestByDocumentId.keys());
  const sourceDocs = asArray(ws.sourceDocuments)
    .map(asRecord)
    .filter((doc) => !isIgnoredSourceDocument(doc.fileName) && !isIgnoredSourceDocument(doc.storagePath));
  const docs = sourceDocs.filter((doc) => {
    const documentId = String(doc.id ?? "");
    return isEvidenceSourceDocument(doc) || (requestedDocIds.has(documentId) && (isPdfSourceDocument(doc) || isCadSourceDocument(doc)));
  });
  const fingerprintDocs = sourceDocs.filter((doc) => isPdfSourceDocument(doc) || isCadSourceDocument(doc));
  const includedDocIds = new Set(docs.map((doc) => String(doc.id ?? "")));
  const excludedPdfs = sourceDocs.filter((doc) => isPdfSourceDocument(doc) && !includedDocIds.has(String(doc.id ?? "")));
  const modelAssetsForFingerprint = await listModelAssetsForFingerprint();
  const settingsFingerprint = await getSettingsFingerprint();
  const fingerprint = atlasFingerprint(fingerprintDocs, modelAssetsForFingerprint, {
    settingsFingerprint,
    atlasDocumentRequests: atlasRequests.map((entry) => ({
      documentId: entry.documentId,
      status: entry.status ?? "active",
      sourceRole: entry.sourceRole ?? null,
      drawingEvidenceEnabled: entry.drawingEvidenceEnabled !== false && entry.landingAiEnabled !== false,
    })),
  });
  if (!options.force && currentEngine.atlas?.fingerprint === fingerprint && currentEngine.atlas?.version === ENGINE_VERSION) {
    const runtimeAtlas = await atlasForRuntime(currentEngine.atlas);
    if (runtimeAtlas) return { atlas: runtimeAtlas, reused: true };
  }

  const renderDpis = [...new Set((options.renderDpis?.length ? options.renderDpis : DEFAULT_RENDER_DPIS)
    .map((dpi) => Math.max(72, Math.min(300, Math.round(dpi))))
  )].sort((a, b) => a - b);
  const pages: JsonRecord[] = [];
  const sheetRegistry: JsonRecord[] = [];
  const regions: DrawingRegion[] = [];
  const warnings: string[] = [];
  if (excludedPdfs.length > 0) {
    warnings.push([
      `${excludedPdfs.length} PDFs are not in the drawing atlas because they are not classified as drawing evidence.`,
      "If estimating context shows one belongs in visual evidence, call addSourceToDrawingAtlas with a rationale and then searchDrawingRegions again.",
      `Sample: ${excludedPdfs.slice(0, 8).map((doc) => `${doc.id}:${fileBaseName(String(doc.fileName ?? ""))}`).join("; ")}`,
    ].join(" "));
  }
  const pdfDocs = docs.filter(isPdfSourceDocument);
  const cadDocs = docs.filter(isCadSourceDocument);
  const modelAssets = await syncModelAssetsForAtlas(warnings);

  for (const doc of pdfDocs) {
    const declaredPageCount = Math.max(1, Number(doc.pageCount ?? 1) || 1);
    const nativeSummaryMaxPages = Math.max(1, Math.min(
      25,
      options.maxPagesPerDocument ?? Math.max(declaredPageCount, 5),
    ));

    const nativeSummary = await apiPost<JsonRecord>("/api/vision/pdf-native-summary", {
      projectId: getProjectId(),
      documentId: doc.id,
      maxPages: nativeSummaryMaxPages,
    }).catch((error) => {
      warnings.push(`PDF-native summary unavailable for ${doc.fileName}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    const nativePages = asArray(nativeSummary?.pages).map(asRecord);
    const nativeReportedPageCount = Number(nativeSummary?.pageCount ?? nativeSummary?.pdfPageCount ?? nativeSummary?.actualPageCount);
    const nativePageCount = Number.isFinite(nativeReportedPageCount) && nativeReportedPageCount > 0
      ? Math.round(nativeReportedPageCount)
      : null;
    const effectivePageCount = nativePageCount ?? declaredPageCount;
    const atlasPageCount = options.maxPagesPerDocument
      ? Math.min(effectivePageCount, Math.max(1, options.maxPagesPerDocument))
      : effectivePageCount;
    if (nativePageCount && nativePageCount !== declaredPageCount) {
      warnings.push(`Atlas page count for ${doc.fileName} uses the PDF-native reader (${nativePageCount} pages); extraction metadata declared ${declaredPageCount}.`);
    }
    if (atlasPageCount < effectivePageCount) {
      warnings.push(`Atlas capped ${doc.fileName} at ${atlasPageCount}/${effectivePageCount} native pages for this build.`);
    }

    const nativeLayers = asArray(nativeSummary?.layers).map(asRecord);
    const nativeLayerNames = nativeLayers.map((layer) => String(layer.name ?? "")).filter(Boolean);
    const nativePagesByNumber = new Map(nativePages.map((page) => [Number(page.pageNumber), page]));
    const atlasRequest = atlasRequestByDocumentId.get(String(doc.id ?? ""));
    const shouldQueueDrawingEvidence = !atlasRequest
      || (atlasRequest.drawingEvidenceEnabled !== false && atlasRequest.landingAiEnabled !== false);
    const cachedEvidenceSummary = drawingEvidenceFromDocument(doc);
    const queuedEvidenceSummary = shouldQueueDrawingEvidence && (!cachedEvidenceSummary || cachedEvidenceSummary.pending)
      ? queueDrawingEvidenceSummary({
          documentId: String(doc.id ?? ""),
          fileName: String(doc.fileName ?? ""),
          includeExtraction: true,
          allowNonDrawing: Boolean(atlasRequest),
          atlasInclusionReason: String(atlasRequest?.reason ?? ""),
          updateAtlasDocumentRequest: Boolean(atlasRequest),
        })
      : null;
    const evidenceSummary = cachedEvidenceSummary ?? queuedEvidenceSummary;
    const evidenceStatus = normalizedText(evidenceSummary?.status ?? (evidenceSummary?.pending === true ? "running" : "completed"));
    const evidencePending = evidenceSummary ? evidenceSummary.pending === true || ["queued", "running"].includes(evidenceStatus) : false;
    if (evidencePending) {
      const provider = String((evidenceSummary as any)?.provider ?? "drawing extraction");
      warnings.push(`${provider} enrichment is running asynchronously for ${doc.fileName}; atlas currently uses Azure/local/PDF-native evidence and will gain ${provider} regions after the background job completes.`);
    }
    const evidenceParse = asRecord(evidenceSummary?.parse);
    const evidenceExtract = asRecord(evidenceSummary?.extract);

    for (let pageNumber = 1; pageNumber <= atlasPageCount; pageNumber += 1) {
      const renders: JsonRecord[] = [];
      let imageWidth = 0;
      let imageHeight = 0;
      let pageWidth: number | null = null;
      let pageHeight: number | null = null;
      for (const dpi of renderDpis) {
        try {
          const result = await apiPost<JsonRecord>("/api/vision/render-page", {
            projectId: getProjectId(),
            documentId: doc.id,
            pageNumber,
            dpi,
          });
          if (result.success && result.image) {
            renders.push({
              dpi,
              imageWidth: result.width,
              imageHeight: result.height,
              pageWidth: result.pageWidth ?? null,
              pageHeight: result.pageHeight ?? null,
              imageHash: imageHash(result.image),
            });
            if (dpi === DEFAULT_ATLAS_DPI || imageWidth === 0) {
              imageWidth = Number(result.width ?? imageWidth);
              imageHeight = Number(result.height ?? imageHeight);
              pageWidth = Number(result.pageWidth ?? pageWidth);
              pageHeight = Number(result.pageHeight ?? pageHeight);
            }
          } else {
            warnings.push(`Render failed for ${doc.fileName} page ${pageNumber} at ${dpi} DPI: ${result.error ?? result.message ?? "unknown"}`);
          }
        } catch (error) {
          warnings.push(`Render error for ${doc.fileName} page ${pageNumber} at ${dpi} DPI: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!imageWidth || !imageHeight) {
        imageWidth = pageWidth ? Math.round(pageWidth * DEFAULT_ATLAS_DPI / 72) : 1650;
        imageHeight = pageHeight ? Math.round(pageHeight * DEFAULT_ATLAS_DPI / 72) : 1275;
      }

      const nativePage = nativePagesByNumber.get(pageNumber) ?? {};
      const nativeTextSample = asArray(nativePage.textItemsSample)
        .map((item) => String(asRecord(item).text ?? "").trim())
        .filter(Boolean)
        .slice(0, 60)
        .join("\n");
      const nativeText = [
        nativeLayerNames.length ? `PDF layers: ${nativeLayerNames.join(", ")}` : "",
        nativeTextSample ? `PDF native text sample:\n${nativeTextSample}` : "",
      ].filter(Boolean).join("\n");
      const structuredText = [pageStructuredText(doc, pageNumber), nativeText].filter(Boolean).join("\n");
      const sheetNumber = inferSheetNumber(String(doc.fileName ?? ""), structuredText);
      const sheetTitle = inferSheetTitle(String(doc.fileName ?? ""), structuredText);
      const discipline = inferDiscipline(String(doc.fileName ?? ""), structuredText);
      const packageTags = documentPackageTags(String(doc.fileName ?? ""));
      const pageImageHash = renders.find((render) => render.dpi === DEFAULT_ATLAS_DPI)?.imageHash ?? renders[0]?.imageHash ?? null;

      pages.push({
        documentId: doc.id,
        fileName: doc.fileName,
        pageNumber,
        pageCount: atlasPageCount,
        nativePageCount,
        declaredPageCount,
        imageWidth,
        imageHeight,
        pageWidth,
        pageHeight,
        pageImageHash,
        renders,
        pdfNative: {
          hasOptionalContentLayers: nativeLayerNames.length > 0,
          layerCount: nativeLayerNames.length,
          layerNames: nativeLayerNames.slice(0, 80),
          layerClassCounts: nativeSummary?.layerClassCounts ?? {},
          textItemCount: nativePage.textItemCount ?? null,
          vectorSignals: nativePage.vectorSignals ?? null,
          operatorCount: nativePage.operatorCount ?? null,
        },
        drawingEvidence: evidenceSummary ? {
          provider: (evidenceSummary as any).provider ?? null,
          skipped: evidenceSummary.skipped === true,
          status: evidenceSummary.status ?? null,
          pending: evidencePending,
          cached: evidenceSummary.cached === true,
          reason: evidenceSummary.reason ?? null,
          model: (evidenceSummary as any).model ?? null,
          chunkCount: asArray(evidenceParse.chunks).length,
          splitCount: asArray(evidenceParse.splits).length,
          metadata: evidenceParse.metadata ?? {},
          extractMetadata: evidenceExtract.metadata ?? {},
        } : null,
      });
      sheetRegistry.push({
        documentId: doc.id,
        fileName: doc.fileName,
        pageNumber,
        sheetNumber,
        sheetTitle,
        discipline,
        revision: inferRevision(structuredText),
        scale: inferScale(structuredText),
        packageTags,
        pageImageHash,
        pdfNative: {
          hasOptionalContentLayers: nativeLayerNames.length > 0,
          layerCount: nativeLayerNames.length,
          layerNames: nativeLayerNames.slice(0, 40),
          layerClassCounts: nativeSummary?.layerClassCounts ?? {},
          vectorSignals: nativePage.vectorSignals ?? null,
        },
        drawingEvidence: evidenceSummary ? {
          provider: (evidenceSummary as any).provider ?? null,
          skipped: evidenceSummary.skipped === true,
          status: evidenceSummary.status ?? null,
          pending: evidencePending,
          cached: evidenceSummary.cached === true,
          reason: evidenceSummary.reason ?? null,
          chunkCount: asArray(evidenceParse.chunks).length,
          splitCount: asArray(evidenceParse.splits).length,
          metadata: evidenceParse.metadata ?? {},
        } : null,
      });

      regions.push(...semanticPageRegions({
        doc,
        pageNumber,
        imageWidth,
        imageHeight,
        sheetNumber,
        sheetTitle,
        discipline,
        packageTags,
        text: structuredText,
      }));
      regions.push(...tableRegions({
        doc,
        pageNumber,
        imageWidth,
        imageHeight,
        sheetNumber,
        sheetTitle,
        discipline,
        packageTags,
      }));
      if (nativeLayerNames.length > 0) {
        regions.push(makeRegion({
          documentId: String(doc.id),
          fileName: String(doc.fileName ?? ""),
          pageNumber,
          regionType: "pdf_layers",
          label: "PDF optional-content layers / CAD layer index",
          bbox: proportionalRegion(imageWidth, imageHeight, 0.02, 0.02, 0.96, 0.18),
          text: compactText([
            `Layer names: ${nativeLayerNames.join(", ")}`,
            `Layer classes: ${JSON.stringify(nativeSummary?.layerClassCounts ?? {})}`,
            `Vector signals: ${JSON.stringify(nativePage.vectorSignals ?? {})}`,
          ].join("\n"), 2_500),
          source: "pdf_native_optional_content",
          confidence: 0.88,
          sheetNumber,
          sheetTitle,
          discipline,
          packageTags,
          imageHash: pageImageHash,
        }));
      }
      if (evidenceSummary && evidenceSummary.skipped !== true && !evidencePending) {
        regions.push(...providerRegions({
          doc,
          pageNumber,
          imageWidth,
          imageHeight,
          sheetNumber,
          sheetTitle,
          discipline,
          packageTags,
          pageImageHash,
          evidenceSummary: evidenceSummary as JsonRecord,
        }));
      }
    }
  }

  for (const doc of cadDocs) {
    await addCadDocumentToAtlas({ doc, pages, sheetRegistry, regions, warnings });
  }

  for (const asset of modelAssets) {
    await addModelAssetToAtlas({ asset, pages, sheetRegistry, regions, warnings });
  }

  const atlas: DrawingAtlas = {
    version: ENGINE_VERSION,
    status: warnings.some((warning) => /render (?:failed|error)|unavailable|failed/i.test(warning)) ? "partial" : "ready",
    builtAt: new Date().toISOString(),
    fingerprint,
    projectId: getProjectId(),
    renderDpis,
    pageCount: pages.length,
    documentCount: pdfDocs.length + cadDocs.length + modelAssets.length,
    regionCount: regions.length,
    sheetRegistry,
    pages,
    regions,
    warnings,
  };

  await saveEngineState((state) => ({
    ...state,
    atlas,
  }));

  return { atlas, reused: false };
}

function inferRevision(text: string) {
  return text.match(/\brev(?:ision)?\.?\s*[:#-]?\s*([A-Z0-9.-]{1,12})/i)?.[1] ?? null;
}

function inferScale(text: string) {
  return text.match(/\bscale\s*[:#-]?\s*([A-Z0-9./"' =:-]{1,30})/i)?.[1]?.trim() ?? null;
}

function expandQueryTerms(query: string) {
  const terms = normalizedText(query)
    .split(/[^a-z0-9'"]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  const extra: string[] = [];
  const lower = terms.join(" ");
  if (/lug|hold/.test(lower)) extra.push("hold", "down", "lug", "lugs", "anchor", "anchors", "base", "plate");
  if (/anchor/.test(lower)) extra.push("bolt", "bolts", "base", "plate", "embed", "footing");
  if (/bom|bill|material|spreadsheet|parts?|schedule|accessor/.test(lower)) {
    extra.push("parts", "list", "find", "qty", "quantity", "description", "schedule", "accessories");
  }
  if (/cool|tower|platform|ladder/.test(lower)) extra.push("cooling", "tower", "platform", "ladder", "guardrail", "grating");
  if (/foot|foundation|base/.test(lower)) extra.push("footing", "foundation", "concrete", "base", "plate", "anchor");
  if (/crane|runway/.test(lower)) extra.push("crane", "runway", "column", "base", "plate", "anchor");
  return [...new Set([...terms, ...extra])];
}

function regionAuthority(region: DrawingRegion) {
  const haystack = normalizedText(`${region.regionType} ${region.label} ${region.fileName} ${region.text}`);
  if (
    ["bom_table", "schedule", "provider_table", "provider_extraction", "model_bom", "model_quantity"].includes(region.regionType) ||
    haystack.includes("bill of material") ||
    haystack.includes("parts list") ||
    haystack.includes("specification sheet") ||
    haystack.includes("accessories quantity description") ||
    haystack.includes("quantity description")
  ) {
    return "high";
  }
  return "normal";
}

function regionTypeMatches(regionType: string, filters?: string[]) {
  if (!filters?.length) return true;
  if (filters.includes(regionType)) return true;
  const aliases: Record<string, string[]> = {
    bom_table: ["provider_table", "model_bom"],
    schedule: ["provider_table", "model_bom"],
    plan_view: ["provider_figure", "cad_layout", "cad_entity"],
    detail: ["provider_figure", "cad_entity", "model_element"],
    notes: ["provider_text", "provider_extraction"],
  };
  return filters.some((filter) => aliases[filter]?.includes(regionType));
}

function scoreRegion(region: DrawingRegion, query: string, regionTypes?: string[]) {
  if (!regionTypeMatches(region.regionType, regionTypes)) return { score: 0, why: [] as string[] };
  const terms = expandQueryTerms(query);
  const haystack = normalizedText([
    region.regionType,
    region.label,
    region.fileName,
    region.sheetNumber,
    region.sheetTitle,
    region.discipline,
    region.packageTags.join(" "),
    region.text,
  ].join("\n"));
  const why: string[] = [];
  let score = 0;
  if (haystack.includes(normalizedText(query))) {
    score += 12;
    why.push("exact query phrase appears in region text/metadata");
  }
  for (const term of terms) {
    const matches = haystack.split(term).length - 1;
    if (matches > 0) {
      score += Math.min(8, matches * 1.4);
      why.push(`matched '${term}'`);
    }
  }
  const highAuthority = regionAuthority(region) === "high";
  const quantityQuery = /bom|bill|parts|qty|quantity|material|schedule|accessor|count|how many|lug|anchor|footing|base plate/i.test(query);
  if (/bom|bill|parts|qty|quantity|material|schedule|accessor/i.test(query) && highAuthority) {
    score += 18;
    why.push("high-authority table/spec/schedule region for quantity query");
  }
  if (/lug|hold|anchor/i.test(query) && highAuthority && /hold\s*down\s*lugs?|anchor/i.test(haystack)) {
    score += 16;
    why.push("high-authority lug/anchor quantity source");
  }
  if (/title|revision|scale|sheet/i.test(query) && region.regionType === "title_block") score += 6;
  if (/cad|dxf|dwg|layer|entity/i.test(query) && region.regionType.startsWith("cad_")) score += 8;
  if (/model|bim|ifc|3d|mesh|volume|surface|element/i.test(query) && region.regionType.startsWith("model_")) score += 8;
  if (/count|how many|lug|anchor|footing|base plate/i.test(query) && ["plan_view", "detail", "bom_table", "provider_figure", "provider_table", "provider_extraction", "schedule", "cad_entity", "cad_layout", "model_quantity", "model_bom"].includes(region.regionType)) score += highAuthority && quantityQuery ? 10 : 5;
  score += region.confidence;
  return { score, why: [...new Set(why)].slice(0, 6) };
}

function snippetFor(region: DrawingRegion, query: string) {
  const text = region.text.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const terms = expandQueryTerms(query);
  const lower = text.toLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term))
    .filter((value) => value >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  return compactText(text.slice(Math.max(0, index - 180), index + 520), 700);
}

function extractRepeatedMarkHints(textValue: unknown, queryValue: unknown = "") {
  const text = String(textValue ?? "");
  if (!text.trim()) return [];
  const query = normalizedText(queryValue);
  const groups = new Map<string, { label: string; marks: string[] }>();
  const markRegex = /\b(beam|column|col|anchor|footing|pier|lug|plate|brace|joist|member)\s*#?\s*([a-z]?\d+[a-z]?)/gi;
  for (const match of text.matchAll(markRegex)) {
    const rawType = String(match[1] ?? "").toLowerCase();
    const label = rawType === "col" ? "column" : rawType;
    if (query && !query.includes(label) && label === "plate" && !query.includes("base")) {
      continue;
    }
    const mark = `#${String(match[2] ?? "").toUpperCase()}`;
    const group = groups.get(label) ?? { label, marks: [] };
    group.marks.push(mark);
    groups.set(label, group);
  }
  return [...groups.values()]
    .filter((group) => group.marks.length >= 2)
    .map((group) => {
      const counts = new Map<string, number>();
      for (const mark of group.marks) counts.set(mark, (counts.get(mark) ?? 0) + 1);
      const repeatedMarks = [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([mark, occurrences]) => ({ mark, occurrences }));
      return {
        objectType: group.label,
        occurrenceCount: group.marks.length,
        uniqueMarkCount: counts.size,
        marksInOrder: group.marks,
        repeatedMarks,
        estimatorNote: repeatedMarks.length > 0
          ? "Repeated mark IDs are not the same as physical quantity. Count physical occurrences/placements unless the source explicitly says the repeated mark is typical or already included elsewhere."
          : "These are physical mark occurrences. Verify whether the source uses mark IDs as unique fabrication types or physical placements before pricing.",
      };
    })
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    .slice(0, 6);
}

function findRegion(atlas: DrawingAtlas, regionId: string) {
  return atlas.regions.find((region) => region.id === regionId) ?? null;
}

function normalizeQuantityName(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(number|qty|quantity|count|total|each|ea|of|the|drawing|source|visual|bom|spec|table|ocr|text|governing|alternate|older|newer|orientation|plan|sheet|shop|schedule|quote|vendor|manufacturer|revision|rev|issued|production|baseline|primary|per|as|built|actual|fabrication|detail|order|line|dated|date|model|document|doc|reference|superseded|supersedes)\b/g, " ")
    .replace(/\b(?:[a-z]+\d+[a-z0-9]*|\d+[a-z]+[a-z0-9]*)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableClaimValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
    if (match) {
      const parsed = Number(String(match[0]).replace(/,/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function claimKey(claim: JsonRecord) {
  return [
    String(claim.packageId ?? claim.packageName ?? "unknown").toLowerCase(),
    normalizeQuantityName(claim.quantityName ?? claim.claim),
    String(claim.unit ?? "").toLowerCase(),
  ].join("|");
}

const HIGH_AUTHORITY_SOURCE_TERMS = [
  "bill of material",
  "bill of materials",
  "bom",
  "line list",
  "bid sheet",
  "quote sheet",
  "quotation sheet",
  "scope breakdown",
  "takeoff table",
  "take-off table",
  "spreadsheet",
  "csv",
  "parts list",
  "part list",
  "schedule",
  "spec sheet",
  "specification sheet",
  "accessories quantity description",
  "vendor quote",
  "vendor quotation",
  "model bom",
  "model quantity",
  "quantity table",
  "material table",
];

function hasHighAuthoritySourceLanguage(text: string) {
  const normalized = ` ${normalizedText(text)} `;
  return HIGH_AUTHORITY_SOURCE_TERMS.some((term) => normalized.includes(` ${term} `));
}

function isHighAuthorityClaim(claim: JsonRecord) {
  const method = normalizedText(claim.method);
  const evidenceText = claimEvidenceText(claim);
  if (method === "vendor_quote") return true;
  return hasHighAuthoritySourceLanguage(evidenceText);
}

function claimEvidenceText(claim: JsonRecord) {
  const evidenceText = asArray(claim.evidence).flatMap((entryValue) => {
    const entry = asRecord(entryValue);
    return [
      entry.result,
      entry.sourceText,
      entry.quotedText,
      entry.quote,
      entry.ocrText,
      entry.rawText,
      entry.tool,
      entry.regionType,
      entry.fileName,
      entry.documentTitle,
    ];
  });
  return normalizedText([
    claim.quantityName,
    claim.claim,
    claim.rationale,
    claim.assumption,
    claim.method,
    claim.packageName,
    ...evidenceText,
  ].join(" "));
}

function hasExplicitOverrideEvidence(entries: JsonRecord[]) {
  const sourceText = normalizedText(entries.flatMap((claim) =>
    asArray(claim.evidence).flatMap((entryValue) => {
      const entry = asRecord(entryValue);
      return [entry.sourceText, entry.quotedText, entry.quote, entry.ocrText, entry.rawText];
    })
  ).join(" "));
  return [
    "supersedes",
    "superseded by",
    "replaces",
    "replaced by",
    "obsolete",
    "void",
    "addendum",
    "revision history",
    "order of precedence",
    "client confirmed",
    "vendor confirmed",
    "approved submittal",
    "change order",
    "rfi response",
    "field directive",
  ].some((term) => sourceText.includes(term));
}

function textReferencesClaimValue(text: string, claim: JsonRecord) {
  const value = comparableClaimValue(claim.value);
  if (value === null) return false;
  return new RegExp(`(^|[^0-9.])${String(value).replace(".", "\\.")}([^0-9.]|$)`).test(text);
}

function resolutionSelectsHighAuthority(entries: JsonRecord[]) {
  const resolutionText = normalizedText(entries.map((claim) =>
    asRecord(claim.reconciliation).resolution ?? ""
  ).join(" "));
  if (!resolutionText) return false;

  const highAuthorityEntries = entries.filter(isHighAuthorityClaim);
  const lowerAuthorityEntries = entries.filter((claim) => !isHighAuthorityClaim(claim));
  const mentionsHighValue = highAuthorityEntries.some((claim) => textReferencesClaimValue(resolutionText, claim));
  const mentionsLowerValue = lowerAuthorityEntries.some((claim) => textReferencesClaimValue(resolutionText, claim));
  const mentionsHighAuthoritySource = [
    "bom",
    "bill of material",
    "parts list",
    "schedule",
    "spec sheet",
    "vendor quote",
    "table",
  ].some((term) => resolutionText.includes(term));
  const lowerSourceGoverns = [
    "drawing governs",
    "shop drawing governs",
    "new drawing governs",
    "newer drawing",
    "visual governs",
    "visual count governs",
    "shop drawing supersedes",
    "drawing supersedes",
    "superseded by shop drawing",
    "superseded by drawing",
  ].some((term) => resolutionText.includes(term)) ||
    [/drawing.{0,90}supersed/, /supersed.{0,90}drawing/, /as\s*built\s+drawing/].some((pattern) => pattern.test(resolutionText));

  if (lowerSourceGoverns || (mentionsLowerValue && !mentionsHighValue)) return false;
  if (mentionsHighValue && mentionsHighAuthoritySource) return true;
  return mentionsHighAuthoritySource && [
    "governing",
    "governs",
    "baseline",
    "use",
    "carry",
    "prevail",
    "selected",
  ].some((term) => resolutionText.includes(term));
}

function resolutionKeepsHighAuthority(entries: JsonRecord[]) {
  return resolutionSelectsHighAuthority(entries);
}

function contradictionIsResolved(entries: JsonRecord[]) {
  const hasCarriedAssumption = entries.some((claim) => normalizedText(asRecord(claim.reconciliation).status) === "carried_assumption");
  if (hasCarriedAssumption) {
    const hasHighAuthority = entries.some(isHighAuthorityClaim);
    const hasLowerAuthority = entries.some((claim) => !isHighAuthorityClaim(claim));
    if (!hasHighAuthority || !hasLowerAuthority) return true;
    return resolutionKeepsHighAuthority(entries) || hasExplicitOverrideEvidence(entries);
  }

  const hasResolved = entries.some((claim) => normalizedText(asRecord(claim.reconciliation).status) === "resolved");
  if (!hasResolved) return false;

  const hasHighAuthority = entries.some(isHighAuthorityClaim);
  const hasLowerAuthority = entries.some((claim) => !isHighAuthorityClaim(claim));
  if (!hasHighAuthority || !hasLowerAuthority) return true;

  return resolutionKeepsHighAuthority(entries) || hasExplicitOverrideEvidence(entries);
}

function detectContradictions(claimsValue: unknown) {
  const claims = asArray(claimsValue).map(asRecord);
  const groups = new Map<string, JsonRecord[]>();
  for (const claim of claims) {
    const key = claimKey(claim);
    if (!normalizeQuantityName(claim.quantityName ?? claim.claim)) continue;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }

  const contradictions: JsonRecord[] = [];
  for (const [key, entries] of groups.entries()) {
    const numeric = entries
      .map((claim) => ({ claim, value: comparableClaimValue(claim.value) }))
      .filter((entry): entry is { claim: JsonRecord; value: number } => entry.value !== null);
    const distinct = [...new Set(numeric.map((entry) => entry.value))];
    if (distinct.length <= 1) continue;
    if (contradictionIsResolved(entries)) continue;
    const authorityConflict = entries.some(isHighAuthorityClaim) && entries.some((claim) => !isHighAuthorityClaim(claim));
    contradictions.push({
      id: `contradiction-${hashText(key + JSON.stringify(distinct), 12)}`,
      key,
      status: "unresolved",
      packageId: entries[0]?.packageId ?? null,
      packageName: entries[0]?.packageName ?? null,
      quantityName: entries[0]?.quantityName ?? null,
      values: distinct,
      claimIds: entries.map((claim) => claim.claimId ?? claim.id).filter(Boolean),
      message: authorityConflict
        ? `Conflicting values for ${entries[0]?.quantityName ?? key}: ${distinct.join(" vs ")}. A BOM/spec/schedule/vendor table is in conflict with lower-context evidence. Do not resolve this by drawing date alone; either use the high-authority table or attach explicit supersession/order-of-precedence evidence before pricing. A carried assumption cannot price the lower-context drawing value unless an explicit override is cited.`
        : `Conflicting values for ${entries[0]?.quantityName ?? key}: ${distinct.join(" vs ")}. Reconcile sources or carry an explicit assumption before pricing.`,
    });
  }
  return contradictions;
}

function numericMatchesWithPositions(value: unknown) {
  const text = String(value ?? "");
  return [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map((match) => ({
      value: Number(String(match[0]).replace(/,/g, "")),
      token: match[0],
      index: match.index ?? 0,
    }))
    .filter((match) => Number.isFinite(match.value));
}

function claimSearchTerms(claim: JsonRecord) {
  const raw = normalizedText([
    claim.quantityName,
    claim.claim,
    claim.unit,
  ].join(" "));
  const generic = new Set([
    "count", "quantity", "qty", "number", "total", "drawing", "visual", "source", "claim",
    "ea", "each", "physical", "placements", "package", "replacement", "installation", "project",
    "supply", "supplied", "install", "installed", "includes",
    "included", "scope", "work", "item", "items",
    "per", "as", "built", "actual", "fabrication", "detail", "order", "line", "dated", "date",
    "model", "document", "doc", "reference", "new", "old", "latest", "existing",
  ]);
  return [...new Set(raw
    .split(/[^a-z0-9]+/g)
    .filter((term) => term.length >= 3 && !generic.has(term)))];
}

function termMatchesText(text: string, term: string) {
  if (text.includes(term)) return true;
  if (term.endsWith("s") && text.includes(term.slice(0, -1))) return true;
  return !term.endsWith("s") && text.includes(`${term}s`);
}

function termWeight(term: string) {
  if (/\d/.test(term)) return 3;
  if (term.length >= 8) return 2;
  return 1;
}

function regionMatchesClaimSubject(region: DrawingRegion, claim: JsonRecord) {
  const terms = claimSearchTerms(claim);
  if (terms.length === 0) return false;
  const haystack = normalizedText(`${region.fileName} ${region.label} ${region.text}`);
  const matches = terms.filter((term) => termMatchesText(haystack, term));
  if (matches.length === 0) return false;
  const weightedTotal = terms.reduce((sum, term) => sum + termWeight(term), 0);
  const weightedMatches = matches.reduce((sum, term) => sum + termWeight(term), 0);
  const coverage = weightedTotal > 0 ? weightedMatches / weightedTotal : 0;
  const anchorTerms = terms.filter((term) => /\d/.test(term) || term.length >= 8);
  const anchorMatched = anchorTerms.length === 0 || anchorTerms.some((term) => termMatchesText(haystack, term));
  const strongPhrase = [
    "hold down lug",
    "hold down lugs",
    "lifting lug",
    "estimated weight",
    "accessories",
    "parts list",
    "bill of material",
  ].some((phrase) => haystack.includes(phrase) && terms.some((term) => phrase.includes(term)));
  return (anchorMatched && coverage >= 0.45) || (matches.length >= 2 && strongPhrase);
}

function claimPackageTerms(claim: JsonRecord) {
  const raw = normalizedText([claim.packageId, claim.packageName, claim.scopeRef].join(" "));
  const generic = new Set(["pkg", "package", "scope", "work", "project", "replacement", "installation"]);
  return [...new Set(raw
    .split(/[^a-z0-9]+/g)
    .filter((term) => term.length >= 3 && !generic.has(term)))];
}

function regionMatchesClaimPackageContext(region: DrawingRegion, claim: JsonRecord) {
  const evidenceDocIds = new Set(asArray(claim.evidence)
    .map((entryValue) => String(asRecord(entryValue).documentId ?? "").trim())
    .filter(Boolean));
  if (evidenceDocIds.has(region.documentId)) return true;

  const terms = claimPackageTerms(claim);
  if (terms.length === 0) return true;
  const context = normalizedText([
    region.fileName,
    region.sheetTitle,
    region.sheetNumber,
    region.discipline,
    region.packageTags.join(" "),
  ].join(" "));
  const matches = terms.filter((term) => termMatchesText(context, term));
  if (matches.length >= Math.min(2, terms.length)) return true;

  const distinctiveTerms = terms.filter((term) => term.length >= 6);
  return distinctiveTerms.length > 0 && distinctiveTerms.some((term) => termMatchesText(context, term));
}

function looksLikeDimensionToken(text: string, token: string, index: number) {
  const before = text.slice(Math.max(0, index - 4), index).toLowerCase();
  const after = text.slice(index + token.length, index + token.length + 4).toLowerCase();
  if (/^\s*["'°]/.test(after)) return true;
  if (/[øØ#]\s*$/.test(before)) return true;
  if (/(^|[^a-z])x\s*$/.test(before)) return true;
  return false;
}

function numericValuesNearClaimSubject(region: DrawingRegion, claim: JsonRecord) {
  const subjectTerms = claimSearchTerms(claim)
    .filter((term) => !/\d/.test(term))
    .filter((term) => term.length >= 4);
  if (subjectTerms.length === 0) return [];

  const values = new Set<number>();
  const chunks = String(region.text ?? "")
    .split(/\r?\n|[;•]+/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const normalizedChunk = normalizedText(chunk);
    const matchedTerms = subjectTerms.filter((term) => termMatchesText(normalizedChunk, term));
    if (matchedTerms.length === 0) continue;

    const explicitQuantity = chunk.match(/\b(?:qty|quantity|count)\.?\s*[:#-]?\s*(-?\d[\d,]*(?:\.\d+)?)/i);
    if (explicitQuantity) {
      const value = Number(explicitQuantity[1].replace(/,/g, ""));
      if (Number.isFinite(value)) values.add(value);
    }

    const leadingQuantity = chunk.match(/^\s*(-?\d[\d,]*(?:\.\d+)?)\s+(?!["'°]|(?:ft|in|mm|cm|m)\b)/i);
    if (leadingQuantity) {
      const value = Number(leadingQuantity[1].replace(/,/g, ""));
      if (Number.isFinite(value)) values.add(value);
    }

    for (const match of numericMatchesWithPositions(chunk)) {
      if (looksLikeDimensionToken(chunk, match.token, match.index)) continue;
      const forwardWindow = normalizedText(chunk.slice(match.index, match.index + 120));
      const backwardWindow = normalizedText(chunk.slice(Math.max(0, match.index - 40), match.index + match.token.length));
      const nearSubject = matchedTerms.some((term) =>
        termMatchesText(forwardWindow, term) ||
        /\b(qty|quantity|count)\b/.test(backwardWindow)
      );
      if (nearSubject) values.add(match.value);
    }
  }

  return [...values];
}

function detectUnclaimedHighAuthorityEvidence(claims: JsonRecord[], atlas: DrawingAtlas) {
  const issues: string[] = [];
  const claimsByKey = new Map<string, JsonRecord[]>();
  for (const claim of claims) {
    const key = claimKey(claim);
    claimsByKey.set(key, [...(claimsByKey.get(key) ?? []), claim]);
  }

  for (const claim of claims) {
    const method = normalizedText(claim.method);
    if (!["visual_count", "takeoff", "drawing_table", "ocr_text", "assumption"].includes(method)) continue;
    const claimValue = comparableClaimValue(claim.value);
    if (claimValue === null) continue;
    const siblingClaims = claimsByKey.get(claimKey(claim)) ?? [];
    if (siblingClaims.some(isHighAuthorityClaim)) continue;

    const candidates = atlas.regions
      .filter((region) => regionAuthority(region) === "high")
      .filter((region) => regionMatchesClaimPackageContext(region, claim))
      .filter((region) => regionMatchesClaimSubject(region, claim))
      .map((region) => ({
        region,
        values: numericValuesNearClaimSubject(region, claim)
          .filter((value) => Math.abs(value - claimValue) > 0.0001),
      }))
      .filter((entry) => entry.values.length > 0)
      .slice(0, 4);

    for (const entry of candidates) {
      issues.push([
        `${claim.quantityName ?? claim.claim ?? "drawing claim"} = ${claim.value} is based on ${method},`,
        `but high-authority ${entry.region.regionType} evidence in ${entry.region.fileName} page ${entry.region.pageNumber}`,
        `also matches this subject and contains different numeric value(s): ${[...new Set(entry.values)].slice(0, 8).join(", ")}.`,
        `Save a separate BOM/spec/table claim or document explicit supersession/order-of-precedence evidence before pricing.`,
        `Region ${entry.region.id}: ${compactText(entry.region.text, 260)}`,
      ].join(" "));
    }
  }

  return issues;
}

function drawingEvidencePackageKey(value: unknown) {
  return normalizedText(value)
    .split("-")
    .filter((token) => token && !["pkg", "package", "scope", "drawing", "visual", "takeoff"].includes(token))
    .join("-");
}

function drawingEvidencePackageKeysMatch(left: string, right: string) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = left.split("-").filter((token) => token.length >= 3);
  const rightTokens = right.split("-").filter((token) => token.length >= 3);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const shared = leftTokens.filter((token) => rightTokens.includes(token)).length;
  const required = Math.min(2, Math.min(leftTokens.length, rightTokens.length));
  return shared >= required && shared / Math.min(leftTokens.length, rightTokens.length) >= 0.67;
}

function drawingEvidencePackageMatches(entry: JsonRecord, claim: JsonRecord) {
  const packageKeys = [entry.packageId, entry.packageName].map(drawingEvidencePackageKey).filter(Boolean);
  const claimKeys = [claim.packageId, claim.packageName].map(drawingEvidencePackageKey).filter(Boolean);
  return packageKeys.some((left) => claimKeys.some((right) => drawingEvidencePackageKeysMatch(left, right)));
}

function mergeExistingClaim(existing: JsonRecord, next: JsonRecord): JsonRecord {
  const seenEvidence = new Set<string>();
  const mergedEvidence = [...asArray(next.evidence), ...asArray(existing.evidence)].filter((entryValue) => {
    const entry = asRecord(entryValue);
    const key = JSON.stringify({
      documentId: entry.documentId ?? null,
      pageNumber: entry.pageNumber ?? null,
      regionId: entry.regionId ?? null,
      imageHash: entry.imageHash ?? null,
      tool: entry.tool ?? null,
      sourceText: compactText(entry.sourceText, 160),
      result: compactText(entry.result, 160),
    });
    if (seenEvidence.has(key)) return false;
    seenEvidence.add(key);
    return true;
  });

  return {
    ...existing,
    ...next,
    packageId: String(next.packageId ?? "").trim() ? next.packageId : existing.packageId,
    packageName: String(next.packageName ?? "").trim() ? next.packageName : existing.packageName,
    scopeRef: String(next.scopeRef ?? "").trim() ? next.scopeRef : existing.scopeRef,
    rationale: String(next.rationale ?? "").trim() ? next.rationale : existing.rationale,
    evidence: mergedEvidence.length > 0 ? mergedEvidence : asArray(existing.evidence),
    reconciliation: next.reconciliation ?? existing.reconciliation,
    savedAt: new Date().toISOString(),
  };
}

function validateClaimEvidence(claim: JsonRecord, atlas?: DrawingAtlas) {
  const failures: string[] = [];
  const method = normalizedText(claim.method);
  const evidence = asArray(claim.evidence).map(asRecord);
  if (!claim.quantityName && !claim.claim) failures.push("quantityName is required.");
  if (claim.value === undefined || claim.value === null || claim.value === "") failures.push("value is required.");
  if (!method) failures.push("method is required.");
  if (evidence.length === 0 && method !== "assumption") failures.push("at least one evidence entry is required.");

  for (const [index, entry] of evidence.entries()) {
    if (!entry.documentId) failures.push(`evidence[${index}] is missing documentId.`);
    if (!entry.pageNumber) failures.push(`evidence[${index}] is missing pageNumber.`);
    if (entry.regionId && atlas && !findRegion(atlas, String(entry.regionId))) failures.push(`evidence[${index}] regionId is not in the current atlas.`);
    if (["visual_count", "takeoff"].includes(method)) {
      if (!entry.regionId && !entry.bbox) failures.push(`visual evidence[${index}] needs regionId or bbox.`);
      if (!entry.imageHash) failures.push(`visual evidence[${index}] needs imageHash from inspectDrawingRegion.`);
      const tool = normalizedText(entry.tool);
      const inspectedCropTool = ["inspectdrawingregion", "zoomdrawingregion", "scandrawingsymbols"].some((name) => tool.includes(name));
      if (!inspectedCropTool) {
        failures.push(`visual evidence[${index}] must come from a targeted inspected crop tool such as inspectDrawingRegion, not search-only metadata.`);
      }
    }
    if (["bom_table", "drawing_table", "ocr_text"].includes(method) && !entry.sourceText && !entry.regionId) {
      failures.push(`text evidence[${index}] needs sourceText or regionId.`);
    }
  }

  if (method === "bom_table" && !isHighAuthorityClaim(claim)) {
    failures.push("bom_table claims must cite an actual BOM, parts list, schedule, spec sheet, vendor quote, model BOM, or comparable quantity table. Use ocr_text for ordinary drawing notes.");
  }

  if (method === "assumption" && String(claim.assumption ?? claim.rationale ?? "").trim().length < 20) {
    failures.push("assumption claims require a substantive assumption/rationale.");
  }

  return failures;
}

function claimMutationRejection(existing: JsonRecord, next: JsonRecord) {
  const existingMethod = normalizedText(existing.method);
  const nextMethod = normalizedText(next.method);
  const existingValue = comparableClaimValue(existing.value);
  const nextValue = comparableClaimValue(next.value);
  const existingAuthority = isHighAuthorityClaim(existing) ? "high" : "lower";
  const nextAuthority = isHighAuthorityClaim(next) ? "high" : "lower";
  const valueChanged = existingValue !== null && nextValue !== null
    ? Math.abs(existingValue - nextValue) > 0.0001
    : String(existing.value ?? "") !== String(next.value ?? "");
  const methodChanged = existingMethod !== nextMethod;

  if (!valueChanged && !methodChanged) return null;

  return [
    `Existing evidence claim ${existing.claimId ?? existing.id} is immutable for value and method.`,
    `Existing: value=${String(existing.value ?? "")}, method=${String(existing.method ?? "")}, authority=${existingAuthority}.`,
    `Attempted: value=${String(next.value ?? "")}, method=${String(next.method ?? "")}, authority=${nextAuthority}.`,
    "Save a separate competing claim for a different source value, or re-save this claim only with the same value/method plus reconciliation text.",
  ].join(" ");
}

function highRiskClaim(claim: JsonRecord) {
  const haystack = normalizedText(`${claim.quantityName ?? claim.claim ?? ""} ${claim.packageName ?? ""} ${claim.method ?? ""}`);
  return /visual|count|lug|anchor|base plate|footing|foundation|crane|platform|steel|tower|pipe|valve|tank|rigging/.test(haystack);
}

function engineSummary(engine: DrawingEvidenceEngineState) {
  return {
    version: engine.version ?? ENGINE_VERSION,
    atlas: engine.atlas ? {
      status: engine.atlas.status,
      builtAt: engine.atlas.builtAt,
      documentCount: engine.atlas.documentCount,
      pageCount: engine.atlas.pageCount,
      regionCount: engine.atlas.regionCount,
      renderDpis: engine.atlas.renderDpis,
      persistedAs: engine.atlas.persistedAs ?? "strategy",
      artifactPath: engine.atlas.artifactPath ?? null,
      artifactBytes: engine.atlas.artifactBytes ?? null,
      warnings: engine.atlas.warnings.slice(0, 10),
    } : null,
    claimCount: asArray(engine.claims).length,
    unresolvedContradictions: asArray(engine.contradictions).filter((entry) => !["resolved", "carried_assumption"].includes(normalizedText(asRecord(entry).status))).length,
    inspectionCount: asArray(engine.inspections).length,
    verificationCount: asArray(engine.verifications).length,
    promotedDocumentCount: asArray(engine.promotedDocuments).length,
    atlasDocumentRequestCount: activeAtlasDocumentRequests(engine).length,
    asyncEvidenceNotificationCount: asArray(engine.asyncEvidenceNotifications).length,
    latestAsyncEvidenceNotification: asArray(engine.asyncEvidenceNotifications)[0] ?? null,
  };
}

export function registerDrawingEvidenceTools(server: McpServer) {
  server.tool(
    "addSourceToDrawingAtlas",
    [
      "Request that a source document be included in the Drawing Evidence Engine atlas during live estimating.",
      "Use this when the agent decides a PDF belongs in visual/source-native evidence even if it was not pre-classified as a drawing. The request is persisted with a rationale, can optionally promote the documentType to drawing, and starts the configured drawing-extraction provider (LandingAI / Gemini) asynchronously when enabled. By default it returns quickly; batch related source additions, then call buildDrawingAtlas once or let searchDrawingRegions perform one lazy rebuild.",
      "For DWG/DXF, this routes through the existing CAD adapter. For BIM/3D model files, use the model asset adapter/tools; buildDrawingAtlas indexes model assets separately.",
    ].join(" "),
    {
      documentId: z.string().describe("Source document id to add to the atlas."),
      reason: z.string().min(12).describe("Estimator rationale for why this source belongs in the drawing evidence atlas."),
      sourceRole: z.enum(["drawing", "plan", "layout", "detail", "schedule", "bom", "parts_list", "lift_plan", "spec_drawing", "cad", "other"]).default("other"),
      promoteToDrawing: z.boolean().default(false).describe("If true, also persist documentType='drawing'. Leave false for one-off atlas inclusion without changing the document classification."),
      runDrawingExtraction: z.boolean().default(true).describe("For PDFs, start optional drawing-extraction provider (LandingAI / Gemini Pro / Gemini Flash) enrichment in the background if enabled in settings."),
      forceDrawingExtraction: z.boolean().default(false).describe("For PDFs, ignore any existing drawing-extraction cache for this document."),
      rebuildAtlas: z.boolean().default(false).describe("Rebuild the Drawing Evidence Engine atlas immediately after recording the request. Prefer false during live estimating; batch source additions, then call buildDrawingAtlas once or let searchDrawingRegions rebuild lazily."),
      maxPagesPerDocument: z.coerce.number().int().positive().optional().describe("Optional safety cap for the immediate atlas rebuild."),
    },
    async (input) => {
      const documentId = input.documentId.trim();
      const doc = await findWorkspaceDocument(documentId);
      if (!doc) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: `Document ${documentId} was not found in this project.` }, null, 2) }] };
      }
      if (isIgnoredSourceDocument(doc.fileName) || isIgnoredSourceDocument(doc.storagePath)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: "Ignored archive metadata files cannot be added to the drawing atlas.", documentId, fileName: doc.fileName }, null, 2) }] };
      }
      if (!isPdfSourceDocument(doc) && !isCadSourceDocument(doc)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: "Only PDFs and DWG/DXF source documents can be added directly to the drawing atlas. BIM/3D models are indexed through the existing model asset adapter.", documentId, fileName: doc.fileName, fileType: doc.fileType }, null, 2) }] };
      }

      const beforeType = String(doc.documentType ?? "");
      const updatedDocument = input.promoteToDrawing && beforeType !== "drawing" && isPdfSourceDocument(doc)
        ? await apiPatch<JsonRecord>(`/projects/${getProjectId()}/documents/${encodeURIComponent(documentId)}`, { documentType: "drawing" })
        : doc;
      const requestRecord = {
        id: `atlas-source-${hashText({ documentId, reason: input.reason, sourceRole: input.sourceRole }, 12)}`,
        documentId,
        fileName: updatedDocument.fileName ?? doc.fileName,
        sourceRole: input.sourceRole,
        reason: input.reason,
        status: "active",
        drawingEvidenceEnabled: input.runDrawingExtraction,
        promotedToDrawing: Boolean(input.promoteToDrawing && isPdfSourceDocument(doc)),
        fromDocumentType: beforeType || null,
        documentType: updatedDocument.documentType ?? doc.documentType ?? null,
        requestedAt: new Date().toISOString(),
      };

      await saveEngineState((state) => ({
        ...state,
        atlasDocumentRequests: [
          requestRecord,
          ...activeAtlasDocumentRequests(state).filter((entry) => String(entry.documentId ?? "") !== documentId).slice(0, 49),
        ],
      }));

      const evidenceSummary = input.runDrawingExtraction && isPdfSourceDocument(doc)
        ? queueDrawingEvidenceSummary({
            documentId,
            fileName: String(updatedDocument.fileName ?? doc.fileName ?? ""),
            includeExtraction: true,
            force: input.forceDrawingExtraction,
            allowNonDrawing: true,
            atlasInclusionReason: input.reason,
            updateAtlasDocumentRequest: true,
          })
        : null;
      const evidenceRecord = evidenceSummary ? asRecord(evidenceSummary) : null;
      const evidenceResponse = drawingEvidenceResponseSummary(evidenceRecord);

      const atlasResult = input.rebuildAtlas
        ? await buildAtlas({ force: true, maxPagesPerDocument: input.maxPagesPerDocument }).catch((error) => ({
            error: error instanceof Error ? error.message : String(error),
          }))
        : null;
      const atlas = atlasResult && "atlas" in atlasResult ? atlasResult.atlas : null;

      const engine = await saveEngineState((state) => ({
        ...state,
        atlasDocumentRequests: asArray(state.atlasDocumentRequests).map((entry) => {
          const record = asRecord(entry);
          return String(record.documentId ?? "") === documentId
            ? {
                ...record,
                drawingEvidence: evidenceResponse,
                drawingEvidenceQueuedAt: evidenceResponse?.pending ? evidenceRecord?.queuedAt ?? new Date().toISOString() : record.drawingEvidenceQueuedAt,
                atlasRebuiltAt: atlas ? atlas.builtAt : null,
              }
            : record;
        }),
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: true,
          request: {
            ...requestRecord,
            drawingEvidence: evidenceResponse,
          },
          atlas: atlas ? {
            documentCount: atlas.documentCount,
            pageCount: atlas.pageCount,
            regionCount: atlas.regionCount,
            regionTypeCounts: countBy(atlas.regions.map((region) => region.regionType)),
          } : atlasResult,
          activeAtlasDocumentRequestCount: activeAtlasDocumentRequests(engine).length,
          next: input.rebuildAtlas
            ? "Call searchDrawingRegions with this documentId or the relevant scope query, then inspectDrawingRegion before saving drawing-driven quantity claims."
            : "Source request recorded without blocking on a rebuild. If adding several sources, finish the batch, then call buildDrawingAtlas({ force: true }) once or call searchDrawingRegions to trigger a single lazy rebuild.",
        }, null, 2) }],
      };
    },
  );

  server.tool(
    "promotePdfToDrawingEvidence",
    [
      "Promote a project PDF to drawing evidence during the live estimating process.",
      "Use this when a PDF was uploaded/classified as reference/spec/vendor but the agent determines from workspace context, extracted text, a rendered preview, or the estimating task that it should be treated as a construction drawing, plan, layout, detail, schedule, BOM, parts list, lift plan, or other drawing-derived evidence.",
      "This persists documentType='drawing', optionally starts the configured drawing-extraction provider (LandingAI / Gemini) for that one PDF in the background, and rebuilds the atlas so searchDrawingRegions can retrieve the Azure/local/PDF-native evidence immediately.",
    ].join(" "),
    {
      documentId: z.string().describe("Source document id for the PDF to promote."),
      reason: z.string().min(12).describe("Estimator rationale for changing the classification. This becomes part of the audit trace."),
      runDrawingExtraction: z.boolean().default(true).describe("Start optional drawing-extraction provider (LandingAI / Gemini) enrichment for this document in the background if enabled in settings."),
      forceDrawingExtraction: z.boolean().default(false).describe("Ignore any existing drawing-extraction cache for this document."),
      rebuildAtlas: z.boolean().default(true).describe("Rebuild the Drawing Evidence Engine atlas immediately after promotion."),
      maxPagesPerDocument: z.coerce.number().int().positive().optional().describe("Optional safety cap for the immediate atlas rebuild."),
    },
    async (input) => {
      const documentId = input.documentId.trim();
      const doc = await findWorkspaceDocument(documentId);
      if (!doc) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: `Document ${documentId} was not found in this project.` }, null, 2) }] };
      }
      if (isIgnoredSourceDocument(doc.fileName) || isIgnoredSourceDocument(doc.storagePath)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: "Ignored archive metadata files cannot be promoted to drawing evidence.", documentId, fileName: doc.fileName }, null, 2) }] };
      }
      if (!isPdfSourceDocument(doc)) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, message: "Only PDF source documents can be promoted with this tool. Use CAD/BIM native adapters for DWG/DXF/3D model files.", documentId, fileName: doc.fileName, fileType: doc.fileType }, null, 2) }] };
      }

      const beforeType = String(doc.documentType ?? "");
      const updatedDocument = beforeType === "drawing"
        ? doc
        : await apiPatch<JsonRecord>(`/projects/${getProjectId()}/documents/${encodeURIComponent(documentId)}`, { documentType: "drawing" });

      const evidenceSummary = input.runDrawingExtraction
        ? queueDrawingEvidenceSummary({
            documentId,
            fileName: String(updatedDocument.fileName ?? doc.fileName ?? ""),
            includeExtraction: true,
            force: input.forceDrawingExtraction,
            allowNonDrawing: true,
            atlasInclusionReason: input.reason,
          })
        : null;
      const evidenceRecord = evidenceSummary ? asRecord(evidenceSummary) : null;
      const evidenceResponse = drawingEvidenceResponseSummary(evidenceRecord);

      const atlasResult = input.rebuildAtlas
        ? await buildAtlas({ force: true, maxPagesPerDocument: input.maxPagesPerDocument }).catch((error) => ({
            error: error instanceof Error ? error.message : String(error),
          }))
        : null;
      const atlas = atlasResult && "atlas" in atlasResult ? atlasResult.atlas : null;

      const engine = await saveEngineState((state) => ({
        ...state,
        promotedDocuments: [
          {
            documentId,
            fileName: updatedDocument.fileName ?? doc.fileName,
            fromDocumentType: beforeType || null,
            toDocumentType: "drawing",
            reason: input.reason,
            promotedAt: new Date().toISOString(),
            drawingEvidence: evidenceResponse,
          },
          ...asArray(state.promotedDocuments).slice(0, 49),
        ],
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: true,
          document: {
            id: documentId,
            fileName: updatedDocument.fileName ?? doc.fileName,
            previousDocumentType: beforeType || null,
            documentType: "drawing",
          },
          drawingEvidence: evidenceResponse,
          atlas: atlas ? {
            documentCount: atlas.documentCount,
            pageCount: atlas.pageCount,
            regionCount: atlas.regionCount,
            regionTypeCounts: countBy(atlas.regions.map((region) => region.regionType)),
          } : atlasResult,
          promotedDocumentCount: asArray((engine as JsonRecord).promotedDocuments).length,
          next: "Now call searchDrawingRegions with this documentId or a scope query, then inspectDrawingRegion before saving any drawing-driven quantity claim.",
        }, null, 2) }],
      };
    },
  );

  server.tool(
    "buildDrawingAtlas",
    [
      "Precompute the Drawing Evidence Engine atlas for this project once per package.",
      "It renders every PDF already classified/promoted/requested as drawing evidence at multiple resolutions, starts the configured drawing-extraction provider (LandingAI / Gemini) enrichment in the background, indexes completed provider regions when ready, indexes CAD/DWG/DXF via the native takeoff adapter, indexes BIM/3D models via the model asset adapter, builds a sheet/source registry, and creates semantic regions for title blocks, schedules/BOMs, notes, plans, details, legends, native layers, entities, model quantities, and source-native evidence.",
      "Call this before searching or inspecting drawing evidence. Reuse the atlas unless documents changed. If a relevant PDF is missing because it was classified as reference/spec/vendor, call addSourceToDrawingAtlas with a rationale, then search again.",
    ].join(" "),
    {
      force: z.boolean().default(false).describe("Rebuild even if the current document fingerprint already has a persisted atlas."),
      renderDpis: z.array(z.coerce.number().int().min(72).max(300)).default(DEFAULT_RENDER_DPIS).describe("Overview render DPIs to hash/cache. Default builds 72 and 150 DPI page render metadata."),
      maxPagesPerDocument: z.coerce.number().int().positive().optional().describe("Optional safety cap for smoke tests. Omit for full atlas coverage."),
    },
    async (input) => {
      const { atlas, reused } = await buildAtlas(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: true,
          reused,
          atlas: {
            status: atlas.status,
            builtAt: atlas.builtAt,
            documentCount: atlas.documentCount,
            pageCount: atlas.pageCount,
            regionCount: atlas.regionCount,
            renderDpis: atlas.renderDpis,
            sheetRegistrySample: atlas.sheetRegistry.slice(0, 12),
            regionTypeCounts: countBy(atlas.regions.map((region) => region.regionType)),
            warnings: atlas.warnings.slice(0, 20),
          },
          next: "Use searchDrawingRegions(query) to retrieve candidate regions, inspectDrawingRegion(regionId) for high-res crop evidence, then saveDrawingEvidenceClaim for every drawing-driven quantity claim.",
        }, null, 2) }],
      };
    },
  );

  server.tool(
    "searchDrawingRegions",
    [
      "Retrieve semantic drawing regions before visual inspection.",
      "Use this instead of guessing page crops. Query by scope, object, symbol, count, BOM, sheet title, footing, anchor, platform, etc.",
      "The result gives candidate region IDs, coordinates, OCR/table snippets, sheet metadata, and why they matched. Inspect selected regions with inspectDrawingRegion before making quantity claims.",
    ].join(" "),
    {
      query: z.string().min(2),
      regionTypes: z.array(z.string()).optional().describe("Optional region type filter, e.g. bom_table, plan_view, detail, title_block, notes, legend, schedule, provider_table, provider_figure, provider_text, provider_extraction, cad_entity, cad_layer, model_quantity, model_bom."),
      documentIds: z.array(z.string()).optional(),
      pageNumbers: z.array(z.coerce.number().int().positive()).optional(),
      limit: z.coerce.number().int().positive().max(12).default(8),
      includeThumbnails: z.boolean().default(false).describe("If true, include up to three low-res crop thumbnails. Keep false during broad search to avoid image bloat."),
    },
    async (input) => {
      const { atlas } = await buildAtlas({ force: false });
      const docFilter = new Set(input.documentIds ?? []);
      const pageFilter = new Set(input.pageNumbers ?? []);
      const candidates = atlas.regions
        .filter((region) => docFilter.size === 0 || docFilter.has(region.documentId))
        .filter((region) => pageFilter.size === 0 || pageFilter.has(region.pageNumber))
        .map((region) => ({ region, ...scoreRegion(region, input.query, input.regionTypes) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit);

      const response = {
        success: true,
        query: input.query,
        resultCount: candidates.length,
        candidates: candidates.map((entry) => ({
          regionId: entry.region.id,
          score: Math.round(entry.score * 10) / 10,
          whyMatched: entry.why,
          sourceAuthority: regionAuthority(entry.region),
          regionType: entry.region.regionType,
          label: entry.region.label,
          documentId: entry.region.documentId,
          fileName: entry.region.fileName,
          pageNumber: entry.region.pageNumber,
          bbox: entry.region.bbox,
          sheet: {
            sheetNumber: entry.region.sheetNumber,
            sheetTitle: entry.region.sheetTitle,
            discipline: entry.region.discipline,
            packageTags: entry.region.packageTags,
          },
          snippet: snippetFor(entry.region, input.query),
          quantityHints: extractRepeatedMarkHints(entry.region.text, input.query),
          estimatorNote: regionAuthority(entry.region) === "high"
            ? "High-authority table/spec/schedule evidence. Inspect before accepting a lower-context drawing-only count."
            : undefined,
          thumbnailAvailableViaInspectDrawingRegion: true,
        })),
        documentsNotInAtlas: input.documentIds?.filter((documentId) => !atlas.regions.some((region) => region.documentId === documentId)) ?? [],
        next: "Call inspectDrawingRegion with the best 1-4 regionIds, prioritizing any high-authority table/spec/schedule matches before lower-context visual counts. State the claim/question you are checking, then saveDrawingEvidenceClaim with the returned imageHash and bbox.",
      };

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }> = [
        { type: "text" as const, text: JSON.stringify(response, null, 2) },
      ];

      if (input.includeThumbnails) {
        for (const entry of candidates.slice(0, 3)) {
          const render = await apiPost<JsonRecord>("/api/vision/render-page", {
            projectId: getProjectId(),
            documentId: entry.region.documentId,
            pageNumber: entry.region.pageNumber,
            dpi: 150,
            region: entry.region.bbox,
          }).catch(() => null);
          const base64Match = String(render?.image ?? "").match(/^data:image\/png;base64,(.+)$/);
          if (base64Match) content.push({ type: "image" as const, data: base64Match[1], mimeType: "image/png" as const });
        }
      }

      return { content };
    },
  );

  server.tool(
    "inspectDrawingRegion",
    [
      "Render a selected atlas region as a targeted high-resolution crop.",
      "Use this after searchDrawingRegions and before any drawing-driven quantity claim. This is the visual evidence primitive for the ledger.",
      "The returned metadata includes bbox, regionId, imageHash, and cropPath. Put those into saveDrawingEvidenceClaim only after the crop itself proves the value.",
    ].join(" "),
    {
      regionId: z.string().optional().describe("Region ID returned by searchDrawingRegions. Preferred."),
      documentId: z.string().optional().describe("Fallback if manually specifying a region."),
      pageNumber: z.coerce.number().int().positive().optional(),
      region: z.object({
        x: z.coerce.number(),
        y: z.coerce.number(),
        width: z.coerce.number(),
        height: z.coerce.number(),
        imageWidth: z.coerce.number(),
        imageHeight: z.coerce.number(),
      }).passthrough().optional(),
      dpi: z.coerce.number().int().min(150).max(300).default(DEFAULT_INSPECTION_DPI),
      question: z.string().optional().describe("The exact estimator question this crop should answer."),
      claim: z.string().optional().describe("Optional hypothesis to prove or falsify. Do not phrase unverified counts as facts; use 'verify whether...' until the returned crop supports the value."),
    },
    async (input) => {
      const { atlas } = await buildAtlas({ force: false });
      const atlasRegion = input.regionId ? findRegion(atlas, input.regionId) : null;
      const documentId = atlasRegion?.documentId ?? input.documentId;
      const pageNumber = atlasRegion?.pageNumber ?? input.pageNumber;
      const bbox = atlasRegion?.bbox ?? input.region;
      if (!documentId || !pageNumber || !bbox) {
        return { content: [{ type: "text" as const, text: "inspectDrawingRegion requires either a valid regionId or documentId/pageNumber/region." }] };
      }

      const result = await apiPost<JsonRecord>("/api/vision/render-page", {
        projectId: getProjectId(),
        documentId,
        pageNumber,
        dpi: input.dpi,
        region: bbox,
      });
      if (!result.success || !result.image) {
        return { content: [{ type: "text" as const, text: `Failed to inspect region: ${result.error ?? result.message ?? "unknown error"}` }] };
      }

      const hash = imageHash(result.image);
      const filename = `drawing-evidence-${input.regionId ?? hashText({ documentId, pageNumber, bbox }, 10)}-${Date.now()}.png`;
      const saved = await apiPost<JsonRecord>("/api/vision/save-crop", {
        projectId: getProjectId(),
        image: result.image,
        filename,
      }).catch(() => null);

      const inspection = {
        inspectedAt: new Date().toISOString(),
        regionId: atlasRegion?.id ?? null,
        documentId,
        pageNumber,
        bbox,
        dpi: input.dpi,
        imageHash: hash,
        cropPath: saved?.filePath ?? null,
        question: input.question ?? null,
        claim: input.claim ?? null,
        regionType: atlasRegion?.regionType ?? null,
        label: atlasRegion?.label ?? null,
        sheetNumber: atlasRegion?.sheetNumber ?? null,
        sheetTitle: atlasRegion?.sheetTitle ?? null,
      };
      await saveEngineState((state) => ({
        ...state,
        inspections: [inspection, ...asArray(state.inspections)].slice(0, 300),
      }));

      const base64Match = String(result.image).match(/^data:image\/png;base64,(.+)$/);
      return {
        content: [
          ...(base64Match ? [{
            type: "image" as const,
            data: base64Match[1],
            mimeType: "image/png" as const,
          }] : []),
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              evidenceRef: inspection,
              region: atlasRegion ? {
                regionId: atlasRegion.id,
                regionType: atlasRegion.regionType,
                label: atlasRegion.label,
                fileName: atlasRegion.fileName,
                pageNumber: atlasRegion.pageNumber,
                bbox: atlasRegion.bbox,
                snippet: compactText(atlasRegion.text, 900),
                quantityHints: extractRepeatedMarkHints(atlasRegion.text, `${input.question ?? ""} ${input.claim ?? ""}`),
              } : null,
              note: "Inspect the returned crop visually. If the crop proves a quantity, call saveDrawingEvidenceClaim with evidence containing documentId, pageNumber, regionId, bbox, tool:'inspectDrawingRegion', imageHash, and cropPath. For repeated structural marks, count physical occurrences/placements; unique mark IDs are not a quantity when the same mark appears more than once. Do not save the pre-crop hypothesis as fact unless the image supports it.",
            }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "saveDrawingEvidenceClaim",
    [
      "Persist an evidence-ledger claim for a drawing-driven quantity or scope fact.",
      "Every drawing-driven worksheet quantity needs one of these before pricing: visual_count, bom_table, drawing_table, ocr_text, takeoff, assumption, library, or vendor_quote.",
      "Use method bom_table for formal quantity sources including BOMs, line lists, bid sheets, quote sheets, takeoff tables, parts lists, schedules, spec sheets, vendor quotes, model BOMs, spreadsheets, or CSVs.",
      "If another source gives a conflicting value, save a separate claim for each source using the same packageId/quantityName/unit so the ledger can detect the conflict.",
      "BOMs, schedules, vendor specs, and revision-controlled submittals may carry more authority than a general drawing note; do not mark them superseded by drawing date alone. Resolve in favor of the high-authority table, attach explicit supersession/order-of-precedence evidence, or use reconciliation.status='carried_assumption' while pricing the high-authority baseline/asking the user.",
    ].join(" "),
    {
      claimId: z.string().optional(),
      packageId: z.string().optional(),
      packageName: z.string().optional(),
      scopeRef: z.string().optional(),
      quantityName: z.string(),
      value: z.union([z.coerce.number(), z.string(), z.boolean()]),
      unit: z.string().default(""),
      method: z.enum(["visual_count", "bom_table", "drawing_table", "ocr_text", "assumption", "library", "takeoff", "vendor_quote"]),
      confidence: z.enum(["high", "medium", "low"]).default("medium"),
      rationale: z.string().default(""),
      assumption: z.string().optional(),
      evidence: z.array(z.object({
        documentId: z.string().nullish(),
        pageNumber: z.coerce.number().int().positive().nullish(),
        regionId: z.string().nullish(),
        bbox: z.record(z.unknown()).nullish(),
        tool: z.string().nullish(),
        result: z.string().nullish(),
        imageHash: z.string().nullish(),
        cropPath: z.string().nullish(),
        sourceText: z.string().nullish(),
        imageHashVerifiedAt: z.string().nullish(),
      }).passthrough()).default([]),
      reconciliation: z.object({
        status: z.enum(["resolved", "carried_assumption"]).optional(),
        resolution: z.string().optional(),
      }).passthrough().optional(),
    },
    async (input) => {
      const { atlas } = await buildAtlas({ force: false });
      const claim = {
        ...input,
        claimId: input.claimId || `claim-${hashText({
          packageId: input.packageId,
          packageName: input.packageName,
          quantityName: input.quantityName,
          value: input.value,
          evidence: input.evidence,
        }, 12)}`,
        savedAt: new Date().toISOString(),
      };
      const currentEngine = engineFromStrategy(await getStrategy());
      const currentClaims = asArray(currentEngine.claims).map(asRecord);
      const existingClaim = currentClaims.find((entry) => String(entry.claimId ?? entry.id) === claim.claimId);
      const mutationRejection = existingClaim ? claimMutationRejection(existingClaim, claim) : null;
      if (mutationRejection) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            success: false,
            claim: existingClaim,
            rejectedClaim: claim,
            validationFailures: [mutationRejection],
            unresolvedContradictions: asArray(currentEngine.contradictions),
            next: "Do not overwrite an evidence claim to make a contradiction disappear. Save the competing source as a separate claim, or keep the high-authority source as baseline and carry the lower-context source as an alternate/clarification.",
          }, null, 2) }],
        };
      }
      const claimToSave = existingClaim ? mergeExistingClaim(existingClaim, claim) : claim;
      const validationFailures = validateClaimEvidence(claimToSave, atlas);
      if (validationFailures.length > 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            success: false,
            rejectedClaim: claimToSave,
            validationFailures,
            unresolvedContradictions: asArray(currentEngine.contradictions),
            next: "This claim was not saved. Repair the method/evidence and resubmit it as a new valid claim before pricing.",
          }, null, 2) }],
        };
      }
      const engine = await saveEngineState((state) => {
        const claims = asArray(state.claims).map(asRecord);
        const savedClaim = claimToSave as JsonRecord;
        const savedClaimId = String(savedClaim.claimId ?? savedClaim.id);
        const withoutExisting = claims.filter((entry) => String(entry.claimId ?? entry.id) !== savedClaimId);
        const nextClaims = [claimToSave, ...withoutExisting];
        return {
          ...state,
          claims: nextClaims,
          contradictions: detectContradictions(nextClaims),
        };
      });
      const contradictions = asArray(engine.contradictions);
      const highAuthorityReviewWarnings = detectUnclaimedHighAuthorityEvidence(asArray(engine.claims).map(asRecord), atlas);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: true,
          claim: claimToSave,
          updatedExistingClaim: !!existingClaim,
          validationFailures,
          highAuthorityReviewWarnings,
          pricingBlocked: contradictions.length > 0,
          unresolvedContradictions: contradictions,
          next: validationFailures.length > 0
            ? "Repair the claim evidence before using this quantity for pricing."
            : contradictions.length > 0
              ? "Reconcile contradictions or carry an explicit assumption before pricing/finalize."
            : highAuthorityReviewWarnings.length > 0
              ? "Claim saved with high-authority review warnings. Inspect the suggested sources and save a competing claim if they govern the same quantity field."
              : "Claim saved. Use getDrawingEvidenceLedger or verifyDrawingEvidenceLedger before pricing/finalize.",
        }, null, 2) }],
      };
    },
  );

  server.tool(
    "getDrawingEvidenceLedger",
    "Read the persisted drawing atlas summary, evidence claims, inspections, contradictions, and latest verifier status without dumping the full atlas.",
    {
      includeClaims: z.boolean().default(true),
      includeRecentInspections: z.boolean().default(true),
      includeAtlasSample: z.boolean().default(false),
    },
    async (input) => {
      const strategy = await getStrategy();
      const engine = engineFromStrategy(strategy);
      const atlas = input.includeAtlasSample
        ? (await atlasForRuntime(engine.atlas).catch(() => null))
        : null;
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: true,
          summary: engineSummary(engine),
          promotedDocuments: asArray(engine.promotedDocuments).slice(0, 20),
          atlasDocumentRequests: activeAtlasDocumentRequests(engine).slice(0, 20),
          claims: input.includeClaims ? asArray(engine.claims).slice(0, 80) : undefined,
          contradictions: asArray(engine.contradictions),
          recentInspections: input.includeRecentInspections ? asArray(engine.inspections).slice(0, 20) : undefined,
          latestVerification: asArray(engine.verifications)[0] ?? null,
          atlasSample: input.includeAtlasSample && atlas ? {
            sheets: atlas.sheetRegistry.slice(0, 20),
            regions: atlas.regions.slice(0, 20).map((region) => ({
              regionId: region.id,
              regionType: region.regionType,
              label: region.label,
              fileName: region.fileName,
              pageNumber: region.pageNumber,
              bbox: region.bbox,
              snippet: compactText(region.text, 260),
            })),
          } : undefined,
        }, null, 2) }],
      };
    },
  );

  server.tool(
    "verifyDrawingEvidenceLedger",
    [
      "Run the independent drawing evidence verifier.",
      "It samples high-risk claims, checks that visual claims point to targeted inspected crops with image hashes, checks region IDs against the atlas, and detects unresolved contradictions.",
      "Use this after saveDrawingEvidenceClaim and before pricing/finalize.",
    ].join(" "),
    {
      sampleLimit: z.coerce.number().int().positive().max(25).default(12),
      requireClaimsForDrawingPackages: z.boolean().default(true),
    },
    async (input) => {
      const { atlas } = await buildAtlas({ force: false });
      const ws = await getWorkspace();
      const strategy = asRecord(ws.estimateStrategy);
      const scopeGraph = asRecord(strategy.scopeGraph);
      const audit = asRecord(scopeGraph.visualTakeoffAudit);
      const drawingPackages = asArray(audit.drawingDrivenPackages).map(asRecord);
      const engine = engineFromStrategy(await getStrategy());
      const claims = asArray(engine.claims).map(asRecord);
      const failures: string[] = [];
      const warnings: string[] = [];
      const sampledClaims = claims.filter(highRiskClaim).slice(0, input.sampleLimit);

      if (input.requireClaimsForDrawingPackages) {
        for (const drawingPackage of drawingPackages) {
          const id = drawingEvidencePackageKey(drawingPackage.packageId ?? drawingPackage.packageName ?? "");
          if (id && !claims.some((claim) => drawingEvidencePackageMatches(drawingPackage, claim))) {
            failures.push(`Drawing-driven package ${id} has no saved drawing evidence claim.`);
          }
        }
      }

      const validationByClaim = claims.map((claim) => ({
        claimId: claim.claimId ?? claim.id,
        quantityName: claim.quantityName,
        value: claim.value,
        failures: validateClaimEvidence(claim, atlas),
      }));
      for (const entry of validationByClaim) {
        for (const failure of entry.failures) failures.push(`${entry.claimId}: ${failure}`);
      }

      const contradictions = detectContradictions(claims);
      for (const contradiction of contradictions) failures.push(contradiction.message);
      const unclaimedHighAuthorityEvidence = detectUnclaimedHighAuthorityEvidence(claims, atlas);
      warnings.push(...unclaimedHighAuthorityEvidence.map((issue) => `High-authority source review: ${issue}`));
      if (sampledClaims.length === 0 && claims.length > 0) warnings.push("No high-risk drawing claims were sampled; claim naming may be too vague.");

      const verification = {
        id: `drawing-verification-${hashText(Date.now(), 8)}`,
        verifiedAt: new Date().toISOString(),
        status: failures.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
        sampleLimit: input.sampleLimit,
        sampledClaims: sampledClaims.map((claim) => ({
          claimId: claim.claimId ?? claim.id,
          packageId: claim.packageId ?? null,
          quantityName: claim.quantityName ?? claim.claim ?? null,
          value: claim.value ?? null,
          method: claim.method ?? null,
          falsificationPrompt: `Show the crop(s) that prove '${claim.quantityName ?? claim.claim}' = ${claim.value}. Verify the crop visually matches the claim and look for conflicting regions before accepting it.`,
        })),
        failures,
        warnings,
        atlas: {
          documentCount: atlas.documentCount,
          pageCount: atlas.pageCount,
          regionCount: atlas.regionCount,
          status: atlas.status,
        },
      };

      await saveEngineState((state) => ({
        ...state,
        contradictions,
        verifications: [verification, ...asArray(state.verifications)].slice(0, 50),
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          success: failures.length === 0,
          verification,
          next: failures.length > 0
            ? "Fix missing evidence, unresolved contradictions, or uninspected visual claims before creating/pricing drawing-driven worksheet rows."
            : "Verifier pass saved. Continue with pricing, keeping claim IDs in worksheet sourceEvidence/sourceNotes.",
        }, null, 2) }],
      };
    },
  );
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

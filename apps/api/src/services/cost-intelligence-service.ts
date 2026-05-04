import type { PrismaClient } from "@bidwright/db";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPdfParser, type ExtractedTable, type ParsedDocument } from "@bidwright/ingestion";
import * as XLSX from "xlsx";
import {
  deriveEffectiveCostFromObservations,
  normalizeCostObservation,
  normalizeResourceName,
  type CostObservation,
  type EffectiveCostDraft,
  type ResourceCatalogItem,
  type EffectiveCost,
} from "@bidwright/domain";
import { prisma as sharedPrisma } from "@bidwright/db";
import { createId } from "../calc-utils.js";
import { resolveApiPath, sanitizeFileName } from "../paths.js";

export interface CreateResourceCatalogItemInput {
  catalogItemId?: string | null;
  resourceType?: string;
  category?: string;
  code?: string;
  name: string;
  description?: string;
  manufacturer?: string;
  manufacturerPartNumber?: string;
  defaultUom?: string;
  aliases?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  active?: boolean;
}

export interface CreateCostObservationInput {
  resourceId?: string | null;
  vendorId?: string | null;
  vendorProductId?: string | null;
  projectId?: string | null;
  sourceDocumentId?: string | null;
  vendorName?: string;
  vendorSku?: string;
  documentType?: string;
  observedAt?: string | Date | null;
  effectiveDate?: string | null;
  quantity?: number;
  observedUom?: string;
  unitCost: number;
  unitPrice?: number | null;
  currency?: string;
  freight?: number;
  tax?: number;
  discount?: number;
  confidence?: number;
  fingerprint?: string;
  sourceRef?: Record<string, unknown>;
  rawText?: string;
  metadata?: Record<string, unknown>;
}

export interface EffectiveCostRecomputeInput {
  resourceId: string;
  projectId?: string | null;
  vendorName?: string | null;
  region?: string | null;
  targetUom?: string | null;
  currency?: string | null;
  method?: "latest_observation" | "weighted_average";
  asOf?: string | Date | null;
  lookbackDays?: number | null;
  minConfidence?: number | null;
}

export interface EffectiveCostManualInput {
  resourceId?: string | null;
  resourceName?: string;
  resourceType?: string;
  category?: string;
  code?: string;
  defaultUom?: string;
  projectId?: string | null;
  vendorName?: string;
  region?: string;
  uom?: string;
  unitCost: number;
  unitPrice?: number | null;
  currency?: string;
  effectiveDate?: string | null;
  expiresAt?: string | null;
  method?: "manual" | "contract";
  sampleSize?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface EffectiveCostPatchInput {
  resourceId?: string | null;
  resourceName?: string;
  resourceType?: string;
  category?: string;
  code?: string;
  defaultUom?: string;
  projectId?: string | null;
  vendorName?: string;
  region?: string;
  uom?: string;
  unitCost?: number;
  unitPrice?: number | null;
  currency?: string;
  effectiveDate?: string | null;
  expiresAt?: string | null;
  method?: "latest_observation" | "weighted_average" | "manual" | "contract";
  sampleSize?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface CostIntelligenceListFilters {
  query?: string;
  resourceId?: string;
  projectId?: string;
  sourceDocumentId?: string;
  vendorName?: string;
  limit?: number;
  scope?: "aggregate" | "per_vendor" | "all";
}

export interface VendorPdfIngestFile {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
}

export interface VendorPdfIngestOptions {
  azureConfig?: { endpoint?: string; key?: string };
  defaultCurrency?: string;
  entrySurface?: string;
}

export interface VendorEvidenceLineCandidate {
  description: string;
  vendorSku: string;
  quantity: number;
  uom: string;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  lineTotal: number | null;
  pageNumber?: number;
  source: "table" | "text" | "spreadsheet";
  rawText: string;
  confidence: number;
  vendorName?: string;
  documentNumber?: string;
  documentDate?: string | null;
  documentType?: string;
  category?: string;
  resourceType?: string;
}

interface VendorEvidencePageContext {
  pageNumber: number | null;
  vendorName: string;
  documentNumber: string;
  documentDate: string | null;
  documentType: string;
  currency: string;
}

export interface VendorPdfFileResult {
  fileName: string;
  status: "processed" | "skipped" | "failed";
  vendorName: string;
  documentNumber: string;
  documentDate: string | null;
  lineCount: number;
  observationsCreated: number;
  duplicatesSkipped: number;
  resourcesCreated: number;
  resourcesReused: number;
  warnings: string[];
}

export interface VendorPdfIngestResult {
  batchId: string;
  files: VendorPdfFileResult[];
  fileCount: number;
  parsedFileCount: number;
  lineCount: number;
  observationsCreated: number;
  duplicatesSkipped: number;
  resourcesCreated: number;
  resourcesReused: number;
  effectiveCostsUpdated: number;
  warnings: string[];
}

export type VendorPdfCandidateDecision = "pending" | "approved" | "discarded";
export type VendorPdfCandidateRecommendation = "new_cost_item" | "update_cost_basis" | "duplicate" | "discard";

export interface VendorPdfReviewCandidate {
  id: string;
  batchId: string;
  fileName: string;
  lineIndex: number;
  pageNumber: number | null;
  decision: VendorPdfCandidateDecision;
  recommendation: VendorPdfCandidateRecommendation;
  recommendationReason: string;
  confidence: number;
  vendorName: string;
  vendorSku: string;
  documentType: string;
  documentNumber: string;
  documentDate: string | null;
  resourceId: string | null;
  resourceName: string;
  resourceType: string;
  category: string;
  description: string;
  quantity: number;
  uom: string;
  unitCost: number;
  unitPrice: number | null;
  currency: string;
  lineTotal: number | null;
  rawText: string;
  source: "table" | "text" | "spreadsheet";
  fingerprint: string;
  duplicateObservationId: string | null;
  existingCostBasisId: string | null;
  existingUnitCost: number | null;
  groupKey: string;
  groupLabel: string;
  sourceRef: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface VendorPdfAnalyzeResult {
  batchId: string;
  files: VendorPdfFileResult[];
  fileCount: number;
  parsedFileCount: number;
  lineCount: number;
  candidateCount: number;
  newCandidateCount: number;
  updateCandidateCount: number;
  duplicateCandidateCount: number;
  discardCandidateCount: number;
  candidates: VendorPdfReviewCandidate[];
  reviewFolder: string | null;
  runtime: {
    workDir: string | null;
    originalsDir: string | null;
    extractionsDir: string | null;
    instructionsFile: string | null;
    expectedOutputFile: string | null;
  };
  pipeline: {
    extractionProvider: "azure_document_intelligence" | "local_pdf_parser" | "spreadsheet_file";
    reviewStage: "agent_packet_prepared";
    commitMode: "approval_required";
  };
  warnings: string[];
}

export type VendorPdfReviewRunStatus = "reviewed" | "analyzed" | "uploaded";

export interface VendorPdfReviewRunSummary {
  batchId: string;
  status: VendorPdfReviewRunStatus;
  fileNames: string[];
  fileCount: number;
  candidateCount: number;
  pendingCount: number;
  approvedCount: number;
  discardedCount: number;
  newCandidateCount: number;
  updateCandidateCount: number;
  duplicateCandidateCount: number;
  discardCandidateCount: number;
  extractionProvider: VendorPdfAnalyzeResult["pipeline"]["extractionProvider"] | null;
  hasAgentReviewOutput: boolean;
  reviewFolder: string;
  updatedAt: string;
  warnings: string[];
}

export interface VendorPdfReviewRunDetail {
  summary: VendorPdfReviewRunSummary;
  analysis: VendorPdfAnalyzeResult;
  reviewedCandidates: VendorPdfReviewCandidate[] | null;
  reviewedAt: string | null;
}

function countVendorPdfRecommendation(result: VendorPdfAnalyzeResult, recommendation: VendorPdfCandidateRecommendation) {
  switch (recommendation) {
    case "duplicate":
      result.duplicateCandidateCount += 1;
      break;
    case "update_cost_basis":
      result.updateCandidateCount += 1;
      break;
    case "discard":
      result.discardCandidateCount += 1;
      break;
    case "new_cost_item":
      result.newCandidateCount += 1;
      break;
  }
}

export interface VendorPdfApprovalResult {
  batchId: string;
  candidatesReceived: number;
  approvedCandidates: number;
  discardedCandidates: number;
  observationsCreated: number;
  duplicatesSkipped: number;
  resourcesCreated: number;
  resourcesReused: number;
  costBasisUpdated: number;
  warnings: string[];
}

export interface CostVendorProductRecord {
  key: string;
  vendorSku: string;
  name: string;
  resourceId: string | null;
  resourceName: string;
  uom: string;
  currency: string;
  latestUnitCost: number;
  latestObservedAt: string;
  observationCount: number;
  costBasisCount: number;
}

export interface CostVendorRecord {
  vendorName: string;
  productCount: number;
  observationCount: number;
  costBasisCount: number;
  currencies: string[];
  latestObservedAt: string | null;
  products: CostVendorProductRecord[];
}

function toISO(value: Date): string {
  return value.toISOString();
}

function mapResource(row: any): ResourceCatalogItem {
  return {
    id: row.id,
    organizationId: row.organizationId,
    catalogItemId: row.catalogItemId ?? null,
    resourceType: row.resourceType,
    category: row.category,
    code: row.code,
    name: row.name,
    normalizedName: row.normalizedName,
    description: row.description,
    manufacturer: row.manufacturer,
    manufacturerPartNumber: row.manufacturerPartNumber,
    defaultUom: row.defaultUom,
    aliases: row.aliases ?? [],
    tags: row.tags ?? [],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    active: row.active,
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

function mapObservation(row: any): CostObservation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    resourceId: row.resourceId ?? null,
    projectId: row.projectId ?? null,
    sourceDocumentId: row.sourceDocumentId ?? null,
    vendorName: row.vendorName,
    vendorSku: row.vendorSku,
    documentType: row.documentType,
    observedAt: toISO(row.observedAt),
    effectiveDate: row.effectiveDate ?? null,
    quantity: row.quantity,
    observedUom: row.observedUom,
    unitCost: row.unitCost,
    unitPrice: row.unitPrice ?? null,
    currency: row.currency,
    freight: row.freight,
    tax: row.tax,
    discount: row.discount,
    confidence: row.confidence,
    fingerprint: row.fingerprint,
    sourceRef: (row.sourceRef as Record<string, unknown>) ?? {},
    rawText: row.rawText,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

function mapEffectiveCost(row: any): EffectiveCost {
  return {
    id: row.id,
    organizationId: row.organizationId,
    resourceId: row.resourceId ?? null,
    resource: row.resource ? mapResource(row.resource) : null,
    projectId: row.projectId ?? null,
    vendorName: row.vendorName,
    region: row.region,
    uom: row.uom,
    unitCost: row.unitCost,
    unitPrice: row.unitPrice ?? null,
    currency: row.currency,
    effectiveDate: row.effectiveDate ?? null,
    expiresAt: row.expiresAt ?? null,
    sourceObservationId: row.sourceObservationId ?? null,
    sourceObservation: row.sourceObservation ? mapObservation(row.sourceObservation) : null,
    method: row.method,
    sampleSize: row.sampleSize,
    confidence: row.confidence,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: toISO(row.createdAt),
    updatedAt: toISO(row.updatedAt),
  };
}

function clampText(value: string, max = 30000) {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function cleanMoney(value: string | null | undefined): number | null {
  if (!value) return null;
  const negative = /\([\s$€£CADUSD]*[\d,.]+\)/.test(value) || value.trim().startsWith("-");
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function cleanQuantity(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const nonCostLinePattern = /^(?:sub\s*total|subtotal|total|tax|sales\s+tax|freight|shipping|handling|balance|amount\s+due|payment|deposit|discount)(?:\s+(?:charge|fee|cost|amount|total|due))?$/i;
const identifierLabelPattern = /^(?:upc|ean|gtin|barcode|sku|item|item\s*#|item\s*no\.?|part|part\s*#|part\s*no\.?|mfr\s*part|manufacturer\s*part|catalog|stock|code)\s*[:#-]?\s*/i;
const identifierStopWords = new Set([
  "UPC",
  "EAN",
  "GTIN",
  "BARCODE",
  "SKU",
  "ITEM",
  "PART",
  "NO",
  "NUMBER",
  "CATALOG",
  "STOCK",
  "CODE",
  "QTY",
  "UOM",
  "UNIT",
  "EA",
  "EACH",
  "FT",
  "LF",
  "SF",
  "SY",
  "CY",
  "HR",
  "LB",
  "KG",
  "PKG",
  "BOX",
  "SET",
  "LOT",
]);

function stripIdentifierLabel(value: string) {
  return value.trim().replace(identifierLabelPattern, "").trim();
}

function compactIdentifier(value: string) {
  return stripIdentifierLabel(value).replace(/[\s._/-]+/g, "").toUpperCase();
}

function isReadableWord(word: string) {
  const normalized = word.toUpperCase();
  if (identifierStopWords.has(normalized)) return false;
  return /^[A-Z]{3,}$/.test(normalized);
}

function looksLikeIdentifierOnly(value: string) {
  const stripped = stripIdentifierLabel(value);
  const compact = compactIdentifier(stripped);
  if (!compact) return true;
  if (/^\d{6,14}$/.test(compact)) return true;
  if (/^[A-Z0-9]{6,}$/.test(compact) && /\d/.test(compact) && !/\s/.test(stripped)) return true;
  const tokens = stripped.toUpperCase().match(/[A-Z0-9#._/-]+/g) ?? [];
  if (tokens.length === 0) return true;
  const readableWords = stripped.match(/[A-Za-z]{3,}/g)?.filter(isReadableWord) ?? [];
  if (readableWords.length > 0) return false;
  return tokens.every((token) => {
    const normalized = token.replace(/^#/, "");
    if (identifierStopWords.has(normalized)) return true;
    if (/^\d{4,}$/.test(normalized)) return true;
    if (/^[A-Z]{0,5}\d[A-Z0-9._/-]{2,}$/.test(normalized)) return true;
    return /^[A-Z0-9]{8,}$/.test(normalized);
  });
}

function hasHumanReadableResourceText(value: string) {
  const stripped = stripIdentifierLabel(value);
  if (!stripped || looksLikeIdentifierOnly(stripped)) return false;
  const readableWords = stripped.match(/[A-Za-z]{2,}/g)?.filter((word) => {
    const normalized = word.toUpperCase();
    return !identifierStopWords.has(normalized) && (word.length >= 3 || /\s/.test(stripped));
  }) ?? [];
  return readableWords.length > 0;
}

function costEvidenceQualityIssue(input: {
  resourceName?: string | null;
  description?: string | null;
  vendorSku?: string | null;
  uom?: string | null;
  unitCost?: number | null;
  currency?: string | null;
}) {
  const resourceText = (input.resourceName || input.description || "").trim();
  if (!resourceText) return "No readable product or service description was found.";
  if (nonCostLinePattern.test(resourceText)) return "Summary, tax, freight, shipping, payment, or other non-cost-resource row.";
  const vendorSku = (input.vendorSku ?? "").trim();
  if (vendorSku && compactIdentifier(resourceText) === compactIdentifier(vendorSku)) {
    return "Resource name is only the vendor SKU/UPC; keep identifiers in vendorSku and use a readable product or service name.";
  }
  if (looksLikeIdentifierOnly(resourceText)) {
    return "Resource name is only a UPC, barcode, SKU, part number, or other non-human-readable identifier.";
  }
  if (!hasHumanReadableResourceText(resourceText)) {
    return "Resource name is not human-readable enough to approve without a clearer product or service description.";
  }
  if (!Number.isFinite(input.unitCost) || (input.unitCost ?? 0) <= 0) return "Unit cost must be a positive finite number.";
  if (!normalizeUom(input.uom).trim()) return "Unit of measure is missing.";
  if (!normalizeCurrencyCode(input.currency).trim()) return "Currency is missing.";
  return null;
}

function applyCostEvidenceQualityGate(candidate: VendorPdfReviewCandidate): VendorPdfReviewCandidate {
  const qualityIssue = costEvidenceQualityIssue(candidate);
  if (!qualityIssue) return candidate;
  if (candidate.decision !== "approved") return candidate;
  return {
    ...candidate,
    decision: "discarded",
    recommendation: "discard",
    recommendationReason: qualityIssue,
    confidence: Math.min(candidate.confidence, 0.35),
    metadata: {
      ...candidate.metadata,
      qualityGate: {
        status: "blocked",
        reason: qualityIssue,
        source: "server_quality_gate",
      },
    },
  };
}

function normalizeUom(value: string | null | undefined): string {
  const raw = (value ?? "").trim().toUpperCase();
  if (!raw) return "EA";
  const normalized = raw
    .replace(/\bEACH\b/g, "EA")
    .replace(/\bPCS?\b/g, "EA")
    .replace(/\bPIECES?\b/g, "EA")
    .replace(/\bHOURS?\b/g, "HR")
    .replace(/\bFEET\b/g, "FT")
    .replace(/\bFOOT\b/g, "FT")
    .replace(/\bLINEAR\s*FEET\b/g, "LF")
    .replace(/\bPOUNDS?\b/g, "LB")
    .replace(/\bPACKAGES?\b/g, "PKG");
  const token = normalized.match(/[A-Z][A-Z0-9/-]{0,8}/)?.[0];
  return token || "EA";
}

function normalizeCurrencyCode(value: string | null | undefined, fallback = "USD") {
  const normalized = (value ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  if (normalized.length === 3) return normalized;
  const fallbackNormalized = fallback.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return fallbackNormalized.length === 3 ? fallbackNormalized : "USD";
}

function normalizeDuplicateText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeDuplicateObservationInput(input: { uom: string; unitCost: number; currency: string }) {
  const normalized = normalizeCostObservation({
    id: "duplicate-check",
    observedUom: input.uom,
    unitCost: input.unitCost,
    unitPrice: null,
    currency: input.currency,
    confidence: 1,
  });
  return {
    observedUom: normalized.observedUom,
    unitCost: normalized.unitCost,
    currency: normalized.currency,
  };
}

function semanticObservationDuplicateKey(input: {
  resourceId?: string | null;
  vendorName: string;
  vendorSku?: string | null;
  documentDate?: string | null;
  uom: string;
  unitCost: number;
  currency: string;
}) {
  if (!input.resourceId) return null;
  const normalized = normalizeDuplicateObservationInput(input);
  return [
    input.resourceId,
    normalizeDuplicateText(input.vendorName),
    normalizeDuplicateText(input.vendorSku),
    input.documentDate ?? "",
    normalized.observedUom,
    normalized.unitCost.toFixed(4),
    normalized.currency,
  ].join("\u0000");
}

function extractKv(doc: ParsedDocument, patterns: RegExp[]): string {
  for (const kv of doc.metadata.keyValuePairs ?? []) {
    const key = kv.key.toLowerCase();
    if (patterns.some((pattern) => pattern.test(key)) && kv.value.trim()) {
      return kv.value.trim();
    }
  }
  return "";
}

function fieldMatches(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value.toLowerCase()));
}

function extractDocumentField(doc: ParsedDocument, patterns: RegExp[], pageNumber?: number | null): string {
  const fields = doc.metadata.documentFields ?? [];
  const candidates = fields
    .filter((field) => fieldMatches(field.fieldName, patterns))
    .filter((field) => pageNumber == null || field.pageNumber === pageNumber)
    .sort((a, b) => b.confidence - a.confidence);
  return candidates[0]?.value.trim() ?? "";
}

function extractCurrencyField(doc: ParsedDocument, pageNumber: number | null | undefined, fallback: string): string {
  const fields = doc.metadata.documentFields ?? [];
  const candidates = fields
    .filter((field) => field.currencyCode || /\b(total|amount|balance|due|subtotal|tax)\b/i.test(field.fieldName))
    .filter((field) => pageNumber == null || field.pageNumber === pageNumber)
    .sort((a, b) => b.confidence - a.confidence);
  for (const field of candidates) {
    if (field.currencyCode) return normalizeCurrencyCode(field.currencyCode, fallback);
    const inferred = inferCurrency(field.value, "");
    if (inferred) return inferred;
  }
  return normalizeCurrencyCode(fallback);
}

function extractDocumentTypeField(doc: ParsedDocument, pageNumber?: number | null): string {
  const fields = doc.metadata.documentFields ?? [];
  const candidates = fields
    .filter((field) => field.documentType.trim())
    .filter((field) => pageNumber == null || field.pageNumber === pageNumber)
    .sort((a, b) => b.confidence - a.confidence);
  const docType = candidates[0]?.documentType.replace(/^prebuilt:/, "").replace(/^custom:/, "").trim();
  return docType ? docType.replace(/[^a-z0-9_-]/gi, "_").toLowerCase() : "";
}

function extractLabeledValue(text: string, patterns: RegExp[]): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const pattern of patterns) {
    for (const line of lines) {
      const match = line.match(pattern);
      const value = match?.[1]?.trim();
      if (value) return value.replace(/^[:#\-\s]+/, "").trim();
    }
  }
  return "";
}

function inferVendorNameFromText(text: string) {
  const labeled = extractLabeledValue(text, [
    /\b(?:vendor|supplier|merchant|remit\s+to|sold\s+by|from)\b\s*[:#-]?\s*(.{3,120})$/i,
  ]);
  if (labeled) return labeled.split(/\s{2,}|\|/)[0]!.trim();

  const firstUsefulLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => (
      line.length >= 3 &&
      !/invoice|receipt|statement|credit\s+memo|purchase\s+order|page\s+\d+|date|qty|quantity|description|subtotal|total/i.test(line)
    ));
  return firstUsefulLine ?? "";
}

function inferVendorName(doc: ParsedDocument) {
  const docFieldVendor = extractDocumentField(doc, [/^vendor(name)?$/, /supplier/, /merchant/, /remit/], null);
  if (docFieldVendor) return docFieldVendor.split("\n")[0]!.trim();
  const kvVendor = extractKv(doc, [/vendor/, /supplier/, /remit/, /from/, /merchant/]);
  if (kvVendor) return kvVendor.split("\n")[0]!.trim();
  return inferVendorNameFromText(doc.content);
}

function inferDocumentNumber(doc: ParsedDocument) {
  const docFieldNumber = extractDocumentField(doc, [/invoice(id|number|no)?/, /receipt(id|number|no)?/, /document(id|number|no)?/], null);
  if (docFieldNumber) return docFieldNumber;
  const kvNumber = extractKv(doc, [/invoice.*(no|number|#)/, /\binv\b/, /receipt.*(no|number|#)/]);
  if (kvNumber) return kvNumber;
  return inferDocumentNumberFromText(doc.content);
}

function inferDocumentNumberFromText(text: string) {
  const labeled = extractLabeledValue(text, [
    /\b(?:invoice|receipt|statement|document)\s*(?:no\.?|number|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,})\b/i,
    /\b(?:invoice|receipt|statement|document)\s*[:#-]\s*([A-Z0-9][A-Z0-9-]{1,})\b/i,
    /\b(?:inv|rcpt)\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,})/i,
  ]);
  if (/^(date|total|subtotal|amount|due)$/i.test(labeled)) return "";
  return labeled;
}

function inferDocumentDate(doc: ParsedDocument) {
  const docFieldDate = extractDocumentField(doc, [/invoice.*date/, /receipt.*date/, /^date$/, /transaction.*date/, /document.*date/], null);
  if (docFieldDate) return normalizeDateValue(docFieldDate);
  const kvDate = extractKv(doc, [/invoice.*date/, /receipt.*date/, /^date$/, /transaction.*date/]);
  if (kvDate) return normalizeDateValue(kvDate);
  return inferDocumentDateFromText(doc.content);
}

function normalizeDateValue(source: string) {
  if (!source) return null;
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : source;
}

function observationDateFromDocumentDate(source: string | null | undefined) {
  if (!source) return undefined;
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function inferDocumentDateFromText(text: string) {
  const source = text.match(/\b(?:invoice|receipt|transaction|document)?\s*date\s*[:#-]?\s*([A-Z]?[a-z]{2,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})/i)?.[1] || "";
  return normalizeDateValue(source);
}

function inferDocumentTypeFromText(text: string): string {
  if (/\bcredit\s+memo\b|\bcredit\s+note\b/i.test(text)) return "credit_memo";
  if (/\bpurchase\s+order\b|\bpo\s*#/i.test(text)) return "purchase_order";
  if (/\breceipt\b|\btransaction\b/i.test(text)) return "receipt";
  if (/\bstatement\b/i.test(text)) return "statement";
  if (/\binvoice\b|\binv\s*#/i.test(text)) return "invoice";
  return "vendor_pdf";
}

function inferCurrency(text: string, fallback = "USD") {
  if (/\bCAD\b|C\$/.test(text)) return "CAD";
  if (/\bUSD\b|US\$/.test(text)) return "USD";
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  return fallback ? normalizeCurrencyCode(fallback) : "";
}

function buildPageContexts(doc: ParsedDocument, fallbackCurrency: string): Map<number | null, VendorEvidencePageContext> {
  const contexts = new Map<number | null, VendorEvidencePageContext>();
  const singlePageDocument = (doc.metadata.pageCount || doc.pages.length || 1) <= 1;
  const documentFallback: VendorEvidencePageContext = {
    pageNumber: null,
    vendorName: singlePageDocument ? inferVendorName(doc) : "",
    documentNumber: singlePageDocument ? inferDocumentNumber(doc) : "",
    documentDate: singlePageDocument ? inferDocumentDate(doc) : null,
    documentType: extractDocumentTypeField(doc, null) || inferDocumentTypeFromText(doc.content),
    currency: extractCurrencyField(doc, null, inferCurrency(doc.content, fallbackCurrency)),
  };
  contexts.set(null, documentFallback);

  for (const page of doc.pages) {
    const pageNumber = page.pageNumber;
    const pageText = page.content;
    contexts.set(pageNumber, {
      pageNumber,
      vendorName:
        extractDocumentField(doc, [/^vendor(name)?$/, /supplier/, /merchant/, /remit/], pageNumber) ||
        inferVendorNameFromText(pageText) ||
        (singlePageDocument ? documentFallback.vendorName : ""),
      documentNumber:
        extractDocumentField(doc, [/invoice(id|number|no)?/, /receipt(id|number|no)?/, /document(id|number|no)?/], pageNumber) ||
        inferDocumentNumberFromText(pageText) ||
        (singlePageDocument ? documentFallback.documentNumber : ""),
      documentDate:
        normalizeDateValue(extractDocumentField(doc, [/invoice.*date/, /receipt.*date/, /^date$/, /transaction.*date/, /document.*date/], pageNumber)) ||
        inferDocumentDateFromText(pageText) ||
        (singlePageDocument ? documentFallback.documentDate : null),
      documentType:
        extractDocumentTypeField(doc, pageNumber) ||
        inferDocumentTypeFromText(pageText) ||
        documentFallback.documentType,
      currency: extractCurrencyField(doc, pageNumber, inferCurrency(pageText, fallbackCurrency)),
    });
  }

  return contexts;
}

function contextForLine(contexts: Map<number | null, VendorEvidencePageContext>, line: VendorEvidenceLineCandidate) {
  const base = contexts.get(line.pageNumber ?? null) ?? contexts.get(null)!;
  return {
    ...base,
    vendorName: line.vendorName || base.vendorName,
    documentNumber: line.documentNumber || base.documentNumber,
    documentDate: line.documentDate || base.documentDate,
    documentType: line.documentType || base.documentType,
    currency: line.currency || base.currency,
  };
}

function columnIndex(headers: string[], patterns: RegExp[]) {
  return headers.findIndex((header) => patterns.some((pattern) => pattern.test(header.toLowerCase())));
}

function extractLinesFromTables(
  tables: ExtractedTable[],
  currencyForPage: (pageNumber: number) => string,
): VendorEvidenceLineCandidate[] {
  const lines: VendorEvidenceLineCandidate[] = [];
  for (const table of tables) {
    const headers = table.headers.map((header) => header.trim());
    const descIdx = columnIndex(headers, [/description/, /\bitem\b/, /product/, /material/, /service/, /details?/]);
    const skuIdx = columnIndex(headers, [/sku/, /part/, /item\s*#/, /catalog/, /product\s*code/, /\bcode\b/, /stock/]);
    const qtyIdx = columnIndex(headers, [/^qty\b/, /quantity/, /\bqnty\b/]);
    const uomIdx = columnIndex(headers, [/^uom$/, /unit of measure/, /\bunit\b/, /\bum\b/]);
    const unitIdx = columnIndex(headers, [/unit\s*(price|cost|rate)/, /price\s*each/, /cost\s*each/, /\brate\b/]);
    const totalIdx = columnIndex(headers, [/extended/, /line\s*total/, /\btotal\b/, /amount/, /net/]);
    const currency = currencyForPage(table.pageNumber);

    if (descIdx < 0 || (unitIdx < 0 && totalIdx < 0)) continue;

    for (const row of table.rows) {
      const description = (row[descIdx] ?? "").trim();
      if (!description || /subtotal|total|tax|freight|shipping|balance|amount due/i.test(description)) continue;
      const quantity = cleanQuantity(qtyIdx >= 0 ? row[qtyIdx] : "") ?? 1;
      const unitCostFromColumn = cleanMoney(unitIdx >= 0 ? row[unitIdx] : "");
      const lineTotal = cleanMoney(totalIdx >= 0 ? row[totalIdx] : "");
      const unitCost = unitCostFromColumn ?? (lineTotal != null && quantity > 0 ? lineTotal / quantity : null);
      if (unitCost == null || unitCost < 0) continue;
      lines.push({
        description,
        vendorSku: skuIdx >= 0 ? (row[skuIdx] ?? "").trim() : "",
        quantity,
        uom: normalizeUom(uomIdx >= 0 ? row[uomIdx] : ""),
        unitCost,
        unitPrice: null,
        currency,
        lineTotal,
        pageNumber: table.pageNumber,
        source: "table",
        rawText: `${headers.join(" | ")}\n${row.join(" | ")}`,
        confidence: 0.82,
      });
    }
  }
  return lines;
}

function extractLinesFromText(text: string, currency: string, pageNumber?: number): VendorEvidenceLineCandidate[] {
  const lines: VendorEvidenceLineCandidate[] = [];
  const money = String.raw`(?:C\$|US\$|[$€£])?\s*\d[\d,]*(?:\.\d{2})?`;
  const qty = String.raw`\d+(?:\.\d+)?`;
  const uom = String.raw`EA|EACH|FT|LF|SF|SY|CY|HR|DAY|WK|MO|LB|KG|TON|GAL|LOT|LS|PKG|BOX|BX|PAIR|PR|SET`;
  const pattern = new RegExp(String.raw`^(.{4,120}?)\s+(${qty})\s+(${uom})\s+(${money})\s+(${money})(?:\s|$)`, "i");
  const runningContext: Partial<VendorEvidencePageContext> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line || /subtotal|total|tax|freight|shipping|amount due/i.test(line)) continue;
    const vendorName = extractLabeledValue(line, [
      /\b(?:vendor|supplier|merchant|remit\s+to|sold\s+by|from)\b\s*[:#-]?\s*(.{3,120})$/i,
    ]);
    if (vendorName) runningContext.vendorName = vendorName;
    const documentNumber = inferDocumentNumberFromText(line);
    if (documentNumber) runningContext.documentNumber = documentNumber;
    const documentDate = inferDocumentDateFromText(line);
    if (documentDate) runningContext.documentDate = documentDate;
    const documentType = inferDocumentTypeFromText(line);
    if (documentType !== "vendor_pdf") runningContext.documentType = documentType;

    const match = line.match(pattern);
    if (!match) continue;
    const quantity = cleanQuantity(match[2]) ?? 1;
    const unitCost = cleanMoney(match[4]);
    const lineTotal = cleanMoney(match[5]);
    if (unitCost == null || unitCost < 0) continue;
    lines.push({
      description: match[1]!.trim(),
      vendorSku: "",
      quantity,
      uom: normalizeUom(match[3]),
      unitCost,
      unitPrice: null,
      currency: inferCurrency(line, currency),
      lineTotal,
      pageNumber,
      source: "text",
      rawText: line,
      confidence: 0.62,
      vendorName: runningContext.vendorName,
      documentNumber: runningContext.documentNumber,
      documentDate: runningContext.documentDate ?? null,
      documentType: runningContext.documentType,
    });
  }
  return lines;
}

interface SpreadsheetEvidenceLine {
  line: VendorEvidenceLineCandidate;
  sheetName: string;
  rowNumber: number;
}

interface SpreadsheetParseResult {
  lines: SpreadsheetEvidenceLine[];
  sheets: Array<{ name: string; rowCount: number; lineCount: number; headers: string[] }>;
  warnings: string[];
}

function cellText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, " ").trim();
}

function spreadsheetColumnIndex(headers: string[], patterns: RegExp[]) {
  return columnIndex(headers.map((header) => header.toLowerCase()), patterns);
}

function headerScore(headers: string[]) {
  let score = 0;
  if (spreadsheetColumnIndex(headers, [/description/, /\bitem\b/, /product/, /material/, /service/, /\bname\b/]) >= 0) score += 3;
  if (spreadsheetColumnIndex(headers, [/unit\s*(price|cost|rate)/, /price\s*each/, /cost\s*each/, /\brate\b/]) >= 0) score += 3;
  if (spreadsheetColumnIndex(headers, [/extended/, /line\s*total/, /\btotal\b/, /amount/, /net/]) >= 0) score += 2;
  if (spreadsheetColumnIndex(headers, [/vendor/, /supplier/, /merchant/, /company/]) >= 0) score += 2;
  if (spreadsheetColumnIndex(headers, [/date/, /invoice/, /document/]) >= 0) score += 1;
  return score;
}

function findSpreadsheetHeaderRow(rows: unknown[][]) {
  let bestIndex = 0;
  let bestScore = -1;
  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const headers = (rows[index] ?? []).map(cellText);
    const score = headerScore(headers);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore >= 3 ? bestIndex : 0;
}

function parseSpreadsheetEvidenceFile(file: VendorPdfIngestFile, fallbackCurrency: string): SpreadsheetParseResult {
  const warnings: string[] = [];
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true, raw: false });
  } catch (err) {
    return {
      lines: [],
      sheets: [],
      warnings: [`Could not read spreadsheet: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const lines: SpreadsheetEvidenceLine[] = [];
  const sheets: SpreadsheetParseResult["sheets"] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
    if (rows.length === 0) continue;

    const headerRowIndex = findSpreadsheetHeaderRow(rows);
    const headers = (rows[headerRowIndex] ?? []).map(cellText);
    const dataRows = rows.slice(headerRowIndex + 1);
    const descIdx = spreadsheetColumnIndex(headers, [/description/, /\bitem\b/, /product/, /material/, /service/, /details?/, /\bname\b/]);
    const skuIdx = spreadsheetColumnIndex(headers, [/sku/, /part/, /item\s*#/, /catalog/, /product\s*code/, /\bcode\b/, /stock/]);
    const vendorIdx = spreadsheetColumnIndex(headers, [/vendor/, /supplier/, /merchant/, /company/, /source/]);
    const qtyIdx = spreadsheetColumnIndex(headers, [/^qty\b/, /quantity/, /\bqnty\b/]);
    const uomIdx = spreadsheetColumnIndex(headers, [/^uom$/, /unit of measure/, /\bunit\b/, /\bum\b/]);
    const unitIdx = spreadsheetColumnIndex(headers, [/unit\s*(price|cost|rate)/, /price\s*each/, /cost\s*each/, /\brate\b/]);
    const totalIdx = spreadsheetColumnIndex(headers, [/extended/, /line\s*total/, /\btotal\b/, /amount/, /net/]);
    const currencyIdx = spreadsheetColumnIndex(headers, [/currency/, /\bccy\b/]);
    const dateIdx = spreadsheetColumnIndex(headers, [/invoice.*date/, /document.*date/, /effective.*date/, /^date$/, /observed.*date/, /price.*date/]);
    const documentIdx = spreadsheetColumnIndex(headers, [/invoice.*(no|number|#)/, /document.*(no|number|#)/, /\binv\b/, /receipt.*(no|number|#)/]);
    const documentTypeIdx = spreadsheetColumnIndex(headers, [/document.*type/, /invoice.*type/, /\btype\b/]);
    const categoryIdx = spreadsheetColumnIndex(headers, [/category/, /class/, /group/]);
    const resourceTypeIdx = spreadsheetColumnIndex(headers, [/resource.*type/, /item.*type/, /material.*type/]);

    if (descIdx < 0 || (unitIdx < 0 && totalIdx < 0)) {
      warnings.push(`${file.filename}/${sheetName}: skipped because no item/description and cost columns were detected.`);
      sheets.push({ name: sheetName, rowCount: dataRows.length, lineCount: 0, headers });
      continue;
    }

    let lineCount = 0;
    for (const [rowOffset, row] of dataRows.entries()) {
      const rowNumber = headerRowIndex + rowOffset + 2;
      const values = headers.map((_, index) => cellText(row[index]));
      const description = cellText(row[descIdx]) || (skuIdx >= 0 ? cellText(row[skuIdx]) : "");
      if (!description || /subtotal|total|tax|freight|shipping|balance|amount due/i.test(description)) continue;

      const quantity = cleanQuantity(qtyIdx >= 0 ? cellText(row[qtyIdx]) : "") ?? 1;
      const lineTotal = cleanMoney(totalIdx >= 0 ? cellText(row[totalIdx]) : "");
      const unitCostFromColumn = cleanMoney(unitIdx >= 0 ? cellText(row[unitIdx]) : "");
      const unitCost = unitCostFromColumn ?? (lineTotal != null && quantity > 0 ? lineTotal / quantity : null);
      if (unitCost == null || unitCost < 0) continue;

      const documentDate = dateIdx >= 0 ? normalizeDateValue(cellText(row[dateIdx])) : null;
      const documentType = documentTypeIdx >= 0 ? cellText(row[documentTypeIdx]) || "spreadsheet" : "spreadsheet";
      const rawText = headers
        .map((header, index) => `${header || `Column ${index + 1}`}: ${values[index] ?? ""}`)
        .filter((value) => !/:\s*$/.test(value))
        .join(" | ");

      lines.push({
        sheetName,
        rowNumber,
        line: {
          description,
          vendorSku: skuIdx >= 0 ? cellText(row[skuIdx]) : "",
          quantity,
          uom: normalizeUom(uomIdx >= 0 ? cellText(row[uomIdx]) : ""),
          unitCost,
          unitPrice: null,
          currency: normalizeCurrencyCode(currencyIdx >= 0 ? cellText(row[currencyIdx]) : "", fallbackCurrency),
          lineTotal,
          source: "spreadsheet",
          rawText,
          confidence: 0.78,
          vendorName: vendorIdx >= 0 ? cellText(row[vendorIdx]) : "",
          documentNumber: documentIdx >= 0 ? cellText(row[documentIdx]) : "",
          documentDate,
          documentType,
          ...(categoryIdx >= 0 ? { category: cellText(row[categoryIdx]) } : {}),
          ...(resourceTypeIdx >= 0 ? { resourceType: cellText(row[resourceTypeIdx]) } : {}),
        } as VendorEvidenceLineCandidate,
      });
      lineCount += 1;
    }
    sheets.push({ name: sheetName, rowCount: dataRows.length, lineCount, headers });
  }

  return { lines, sheets, warnings };
}

function dedupeLineCandidates(lines: VendorEvidenceLineCandidate[]) {
  const seen = new Set<string>();
  const deduped: VendorEvidenceLineCandidate[] = [];
  for (const line of lines) {
    const key = [
      normalizeResourceName(line.description),
      line.vendorSku.toLowerCase(),
      line.quantity,
      line.uom,
      line.unitCost.toFixed(4),
      line.lineTotal?.toFixed(2) ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }
  return deduped;
}

function makeFingerprint(organizationId: string, fileName: string, vendorName: string, documentNumber: string, line: VendorEvidenceLineCandidate) {
  return createHash("sha256")
    .update([
      organizationId,
      fileName,
      vendorName,
      documentNumber,
      normalizeResourceName(line.description),
      line.vendorSku,
      line.quantity,
      line.uom,
      line.unitCost.toFixed(4),
      line.rawText,
    ].join("|"))
    .digest("hex");
}

function candidateGroupKey(vendorName: string, resourceName: string, uom: string, currency: string) {
  return [
    normalizeResourceName(vendorName || "unknown vendor"),
    normalizeResourceName(resourceName),
    normalizeUom(uom),
    normalizeCurrencyCode(currency),
  ].join("|");
}

function candidateId(batchId: string, fingerprint: string, lineIndex: number) {
  return `vcand-${batchId}-${fingerprint.slice(0, 12)}-${lineIndex}`;
}

function summarizeDistinct(values: string[], emptyLabel: string, multipleLabel: string): string;
function summarizeDistinct(values: string[], emptyLabel: null, multipleLabel: string): string | null;
function summarizeDistinct(values: string[], emptyLabel: string | null, multipleLabel: string) {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (unique.length === 0) return emptyLabel;
  if (unique.length === 1) return unique[0]!;
  return `${multipleLabel} (${unique.length})`;
}

export class CostIntelligenceService {
  constructor(private readonly db: PrismaClient = sharedPrisma) {}

  private createParser(options: VendorPdfIngestOptions) {
    const hasAzure = Boolean(options.azureConfig?.endpoint && options.azureConfig?.key);
    return {
      provider: hasAzure ? "azure_document_intelligence" as const : "local_pdf_parser" as const,
      parser: createPdfParser({
        provider: hasAzure ? "hybrid" : "local",
        azureEndpoint: options.azureConfig?.endpoint,
        azureKey: options.azureConfig?.key,
        azureModel: "prebuilt-invoice",
        options: { tableExtractionEnabled: true, outputFormat: "text" },
      }),
    };
  }

  private async findResourceForEvidenceLine(organizationId: string, line: Pick<VendorEvidenceLineCandidate, "description" | "vendorSku">) {
    const normalizedName = normalizeResourceName(line.description);
    const existing = await (this.db as any).resourceCatalogItem.findFirst({
      where: {
        organizationId,
        OR: [
          { normalizedName },
          ...(line.vendorSku ? [{ code: line.vendorSku }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    return existing ? mapResource(existing) : null;
  }

  private async findExistingCostBasis(organizationId: string, resourceId: string | null, currency: string, vendorName?: string) {
    if (!resourceId) return null;
    const row = await (this.db as any).effectiveCost.findFirst({
      where: {
        organizationId,
        resourceId,
        currency: normalizeCurrencyCode(currency),
        OR: [
          { vendorName: vendorName ?? "" },
          { vendorName: "" },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    return row ? mapEffectiveCost(row) : null;
  }

  private async findDuplicateObservation(
    organizationId: string,
    input: {
      fingerprint: string;
      resourceId?: string | null;
      vendorName: string;
      vendorSku?: string | null;
      documentDate?: string | null;
      uom: string;
      unitCost: number;
      currency: string;
      rawText?: string | null;
    },
  ) {
    const normalized = normalizeDuplicateObservationInput(input);
    const vendorSku = input.vendorSku?.trim() ?? "";
    const semanticDuplicate = input.resourceId && input.documentDate
      ? [{
          resourceId: input.resourceId,
          vendorName: { equals: input.vendorName, mode: "insensitive" },
          vendorSku: { equals: vendorSku, mode: "insensitive" },
          effectiveDate: input.documentDate,
          observedUom: normalized.observedUom,
          unitCost: normalized.unitCost,
          currency: normalized.currency,
        }]
      : [];
    const rawTextDuplicate = input.resourceId && input.rawText?.trim()
      ? [{
          resourceId: input.resourceId,
          vendorName: { equals: input.vendorName, mode: "insensitive" },
          vendorSku: { equals: vendorSku, mode: "insensitive" },
          observedUom: normalized.observedUom,
          unitCost: normalized.unitCost,
          currency: normalized.currency,
          rawText: input.rawText,
        }]
      : [];
    const duplicateChecks = [
      ...(input.fingerprint ? [{ fingerprint: input.fingerprint }] : []),
      ...semanticDuplicate,
      ...rawTextDuplicate,
    ];
    if (duplicateChecks.length === 0) return null;
    return (this.db as any).priceObservation.findFirst({
      where: {
        organizationId,
        OR: duplicateChecks,
      },
      select: { id: true },
    });
  }

  private async writeReviewPacket(result: VendorPdfAnalyzeResult) {
    const folder = result.reviewFolder ?? resolveApiPath("cost-intelligence", "review-runs", result.batchId);
    const packetCandidates = result.candidates.map((candidate) => ({
      ...candidate,
      metadata: {
        ...candidate.metadata,
        agentReview: {
          status: "packet_prepared",
          folder,
        },
      },
    }));
    await mkdir(folder, { recursive: true });
    await writeFile(
      resolve(folder, "candidate-review.json"),
      JSON.stringify({
        batchId: result.batchId,
        pipeline: result.pipeline,
        runtime: result.runtime,
        reviewPolicy: {
          approvalRequires: [
            "A human-readable product, material, equipment, labour, or service description.",
            "A positive unit cost, currency, and usable unit of measure.",
            "Enough source context to connect the price to the product or service being approved.",
          ],
          neverApprove: [
            "UPC, EAN, GTIN, barcode, SKU, stock code, part number, or other identifier-only resource names.",
            "Rows where the only meaningful value is a code and the product/service name is missing.",
            "Summary, subtotal, tax, freight, shipping, handling, balance, payment, discount, or document metadata rows.",
          ],
          identifierRule: "Identifiers may remain in vendorSku only when resourceName/description is a readable product or service name.",
        },
        candidates: packetCandidates,
        files: result.files,
        warnings: result.warnings,
      }, null, 2),
      "utf-8",
    );
    const instructions = [
      "# Cost Intelligence Candidate Review",
      "",
      "You are running inside a cost intelligence review folder prepared by Bidwright.",
      "",
      "Inputs:",
      "- `originals/` contains the uploaded vendor PDF, CSV, or Excel source files. PDFs may be merged batches with unrelated bills on different pages.",
      "- `extractions/` contains provider extraction output from Azure Document Intelligence, the local parser, or spreadsheet row parsing.",
      "- `candidate-review.json` contains the first-pass candidate rows, source context, duplicate hints, existing cost basis hints, and source references.",
      "",
      "Expected runthrough:",
      "1. Inspect the extraction output and, when needed, the original source files.",
      "2. Group line items by vendor, product/SKU, resource, unit, currency, source document, page context, sheet, and row context.",
      "3. Generalize noisy vendor descriptions into reusable cost resources only when the evidence supports it.",
      "4. Mark true duplicates, non-cost rows, summaries, taxes, freight-only rows, and ambiguous junk for discard.",
      "5. Prefer updating an existing cost basis row when the resource/unit/currency already exists.",
      "6. Leave genuinely ambiguous candidates pending instead of inventing certainty.",
      "",
      "Approval quality bar:",
      "- Approve only rows that name a human-readable purchasable product, material, equipment, labour, or service.",
      "- Do not approve candidates where `resourceName` or `description` is only a UPC, EAN, GTIN, barcode, SKU, stock code, part number, catalog number, or other identifier.",
      "- A UPC/SKU/part number is useful only in `vendorSku`; it is not enough to create or update a resource by itself.",
      "- Do not approve subtotal, total, tax, freight, shipping, handling, payment, balance, discount, invoice metadata, account-code, or document-number rows.",
      "- If the source row has a price but no readable product/service name, mark it `discarded` when it is clearly junk or `pending` when a human might recover it from the original.",
      "",
      "Output:",
      "- Write `agent-reviewed-candidates.json` in this folder.",
      "- Preserve the candidate object shape from `candidate-review.json`.",
      "- You may edit `decision`, `recommendation`, `recommendationReason`, `vendorName`, `vendorSku`, `resourceName`, `resourceType`, `category`, `description`, `quantity`, `uom`, `unitCost`, `unitPrice`, `currency`, `lineTotal`, `groupKey`, and `groupLabel`.",
      "- Do not call the Bidwright API to create observations or cost basis rows. The UI approval step is the only commit gate.",
      "",
    ].join("\n");
    await Promise.all(["AGENTS.md", "CLAUDE.md", "codex.md", "GEMINI.md"].map((fileName) => (
      writeFile(resolve(folder, fileName), instructions, "utf-8")
    )));
    return folder;
  }

  private async listOriginalPdfFileNames(reviewFolder: string) {
    try {
      const entries = await readdir(resolve(reviewFolder, "originals"), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name.replace(/^\d{3}-/, ""));
    } catch {
      return [];
    }
  }

  private async readCandidateReviewPacket(reviewFolder: string): Promise<{ packet: Record<string, unknown>; updatedAt: Date } | null> {
    const packetPath = resolve(reviewFolder, "candidate-review.json");
    try {
      const [fileStat, raw] = await Promise.all([stat(packetPath), readFile(packetPath, "utf-8")]);
      const parsed = JSON.parse(raw);
      return {
        packet: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {},
        updatedAt: fileStat.mtime,
      };
    } catch {
      return null;
    }
  }

  private async readAgentReviewedCandidates(reviewFolder: string): Promise<{ candidates: VendorPdfReviewCandidate[]; updatedAt: Date } | null> {
    const outputPath = resolve(reviewFolder, "agent-reviewed-candidates.json");
    try {
      const [fileStat, raw] = await Promise.all([stat(outputPath), readFile(outputPath, "utf-8")]);
      const parsed = JSON.parse(raw);
      const candidates = Array.isArray(parsed) ? parsed : (parsed as { candidates?: unknown })?.candidates;
      if (!Array.isArray(candidates)) return null;
      return {
        candidates: this.sanitizeVendorPdfReviewCandidates(candidates as VendorPdfReviewCandidate[]),
        updatedAt: fileStat.mtime,
      };
    } catch {
      return null;
    }
  }

  sanitizeVendorPdfReviewCandidates(candidates: VendorPdfReviewCandidate[]) {
    return candidates.map(applyCostEvidenceQualityGate);
  }

  private normalizeReviewPacket(batchId: string, reviewFolder: string, packet: Record<string, unknown>, originalFileNames: string[]): VendorPdfAnalyzeResult {
    const candidates = Array.isArray(packet.candidates) ? packet.candidates as VendorPdfReviewCandidate[] : [];
    const packetFiles = Array.isArray(packet.files) ? packet.files as VendorPdfFileResult[] : [];
    const files = packetFiles.length > 0
      ? packetFiles
      : originalFileNames.map((fileName) => ({
          fileName,
          status: "failed" as const,
          vendorName: "",
          documentNumber: "",
          documentDate: null,
          lineCount: 0,
          observationsCreated: 0,
          duplicatesSkipped: 0,
          resourcesCreated: 0,
          resourcesReused: 0,
          warnings: ["Candidate review packet was not written for this upload."],
        }));
    const packetPipeline = typeof packet.pipeline === "object" && packet.pipeline !== null ? packet.pipeline as Record<string, unknown> : {};
    const extractionProvider = packetPipeline.extractionProvider === "local_pdf_parser" ? "local_pdf_parser" : "azure_document_intelligence";
    const packetRuntime = typeof packet.runtime === "object" && packet.runtime !== null ? packet.runtime as Record<string, unknown> : {};
    const warnings = Array.isArray(packet.warnings) ? packet.warnings.map(String) : [];
    const result: VendorPdfAnalyzeResult = {
      batchId,
      files,
      fileCount: files.length,
      parsedFileCount: files.filter((file) => file.status === "processed").length,
      lineCount: files.reduce((total, file) => total + (Number(file.lineCount) || 0), 0),
      candidateCount: candidates.length,
      newCandidateCount: 0,
      updateCandidateCount: 0,
      duplicateCandidateCount: 0,
      discardCandidateCount: 0,
      candidates,
      reviewFolder,
      runtime: {
        workDir: typeof packetRuntime.workDir === "string" ? packetRuntime.workDir : reviewFolder,
        originalsDir: typeof packetRuntime.originalsDir === "string" ? packetRuntime.originalsDir : resolve(reviewFolder, "originals"),
        extractionsDir: typeof packetRuntime.extractionsDir === "string" ? packetRuntime.extractionsDir : resolve(reviewFolder, "extractions"),
        instructionsFile: typeof packetRuntime.instructionsFile === "string" ? packetRuntime.instructionsFile : resolve(reviewFolder, "AGENTS.md"),
        expectedOutputFile: typeof packetRuntime.expectedOutputFile === "string" ? packetRuntime.expectedOutputFile : resolve(reviewFolder, "agent-reviewed-candidates.json"),
      },
      pipeline: {
        extractionProvider,
        reviewStage: "agent_packet_prepared",
        commitMode: "approval_required",
      },
      warnings,
    };

    for (const candidate of candidates) {
      countVendorPdfRecommendation(result, candidate.recommendation);
    }
    if (result.lineCount === 0) result.lineCount = candidates.length;
    return result;
  }

  private buildReviewRunSummary(
    analysis: VendorPdfAnalyzeResult,
    reviewedCandidates: VendorPdfReviewCandidate[] | null,
    updatedAt: Date,
  ): VendorPdfReviewRunSummary {
    const candidates = reviewedCandidates ?? analysis.candidates;
    const decisionCounts = candidates.reduce(
      (counts, candidate) => {
        if (candidate.decision === "approved") counts.approved += 1;
        else if (candidate.decision === "discarded") counts.discarded += 1;
        else counts.pending += 1;
        return counts;
      },
      { pending: 0, approved: 0, discarded: 0 },
    );
    const recommendationCounts = candidates.reduce(
      (counts, candidate) => {
        if (candidate.recommendation === "update_cost_basis") counts.update += 1;
        else if (candidate.recommendation === "duplicate") counts.duplicate += 1;
        else if (candidate.recommendation === "discard") counts.discard += 1;
        else counts.new += 1;
        return counts;
      },
      { new: 0, update: 0, duplicate: 0, discard: 0 },
    );
    const fileNames = Array.from(new Set(analysis.files.map((file) => file.fileName).filter(Boolean)));
    return {
      batchId: analysis.batchId,
      status: reviewedCandidates ? "reviewed" : analysis.candidateCount > 0 ? "analyzed" : "uploaded",
      fileNames,
      fileCount: analysis.fileCount || fileNames.length,
      candidateCount: candidates.length || analysis.candidateCount,
      pendingCount: decisionCounts.pending,
      approvedCount: decisionCounts.approved,
      discardedCount: decisionCounts.discarded,
      newCandidateCount: recommendationCounts.new,
      updateCandidateCount: recommendationCounts.update,
      duplicateCandidateCount: recommendationCounts.duplicate,
      discardCandidateCount: recommendationCounts.discard,
      extractionProvider: analysis.candidateCount > 0 ? analysis.pipeline.extractionProvider : null,
      hasAgentReviewOutput: Boolean(reviewedCandidates),
      reviewFolder: analysis.reviewFolder ?? resolveApiPath("cost-intelligence", "review-runs", analysis.batchId),
      updatedAt: updatedAt.toISOString(),
      warnings: analysis.warnings,
    };
  }

  private async readReviewRunDetail(batchId: string, reviewFolder: string): Promise<VendorPdfReviewRunDetail | null> {
    const originalFileNames = await this.listOriginalPdfFileNames(reviewFolder);
    const [packet, reviewedOutput, folderStat] = await Promise.all([
      this.readCandidateReviewPacket(reviewFolder),
      this.readAgentReviewedCandidates(reviewFolder),
      stat(reviewFolder).catch(() => null),
    ]);

    if (!packet && originalFileNames.length === 0) return null;

    const analysis = packet
      ? this.normalizeReviewPacket(batchId, reviewFolder, packet.packet, originalFileNames)
      : this.normalizeReviewPacket(batchId, reviewFolder, {}, originalFileNames);
    const updatedAt = new Date(Math.max(
      folderStat?.mtime.getTime() ?? 0,
      packet?.updatedAt.getTime() ?? 0,
      reviewedOutput?.updatedAt.getTime() ?? 0,
    ));
    const summary = this.buildReviewRunSummary(analysis, reviewedOutput?.candidates ?? null, updatedAt);
    return {
      summary,
      analysis,
      reviewedCandidates: reviewedOutput?.candidates ?? null,
      reviewedAt: reviewedOutput?.updatedAt.toISOString() ?? null,
    };
  }

  async listVendorPdfReviewRuns(
    organizationId: string,
    options: { limit?: number } = {},
  ): Promise<VendorPdfReviewRunSummary[]> {
    void organizationId;
    const reviewRoot = resolveApiPath("cost-intelligence", "review-runs");
    const entries = await readdir(reviewRoot, { withFileTypes: true }).catch(() => []);
    const details = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && /^pcana-[A-Za-z0-9-]+$/.test(entry.name))
      .map((entry) => this.readReviewRunDetail(entry.name, resolve(reviewRoot, entry.name))));
    return details
      .filter((detail): detail is VendorPdfReviewRunDetail => Boolean(detail))
      .map((detail) => detail.summary)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, options.limit ?? 25);
  }

  async getVendorPdfReviewRun(
    organizationId: string,
    batchId: string,
  ): Promise<VendorPdfReviewRunDetail> {
    void organizationId;
    if (!/^pcana-[A-Za-z0-9-]+$/.test(batchId)) {
      throw new Error(`Review run ${batchId} not found`);
    }
    const reviewFolder = resolveApiPath("cost-intelligence", "review-runs", batchId);
    const detail = await this.readReviewRunDetail(batchId, reviewFolder);
    if (!detail) throw new Error(`Review run ${batchId} not found`);
    return detail;
  }

  async deleteVendorPdfReviewRun(
    organizationId: string,
    batchId: string,
  ): Promise<{ deleted: boolean; archived: boolean; batchId: string }> {
    void organizationId;
    if (!/^pcana-[A-Za-z0-9-]+$/.test(batchId)) {
      throw new Error(`Review run ${batchId} not found`);
    }
    const reviewFolder = resolveApiPath("cost-intelligence", "review-runs", batchId);
    const detail = await this.readReviewRunDetail(batchId, reviewFolder);
    if (!detail) throw new Error(`Review run ${batchId} not found`);
    const deletedRoot = resolveApiPath("cost-intelligence", "review-runs", ".deleted");
    await mkdir(deletedRoot, { recursive: true });
    const archivedFolder = resolve(
      deletedRoot,
      `${batchId}-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    );
    await rename(reviewFolder, archivedFolder);
    return { deleted: true, archived: true, batchId };
  }

  private async upsertVendorProductForCandidate(
    organizationId: string,
    candidate: VendorPdfReviewCandidate,
    resourceId: string,
  ): Promise<{ vendorId: string; vendorProductId: string } | null> {
    const db = this.db as any;
    if (!db.costVendor?.upsert || !db.costVendorProduct?.upsert) return null;

    const vendorName = candidate.vendorName.trim() || "Unknown vendor";
    const normalizedVendorName = normalizeResourceName(vendorName);
    const productName = (candidate.resourceName || candidate.description || "Vendor product").trim();
    const normalizedProductName = normalizeResourceName(productName);
    const sku = candidate.vendorSku.trim();
    const defaultUom = normalizeUom(candidate.uom);

    const vendor = await db.costVendor.upsert({
      where: {
        organizationId_normalizedName: { organizationId, normalizedName: normalizedVendorName },
      },
      update: {
        name: vendorName,
        active: true,
        metadata: {
          source: "vendor_pdf_review",
          lastBatchId: candidate.batchId,
        },
      },
      create: {
        id: createId("cvnd"),
        organizationId,
        name: vendorName,
        normalizedName: normalizedVendorName,
        aliases: [],
        metadata: {
          source: "vendor_pdf_review",
          firstBatchId: candidate.batchId,
        },
      },
    });

    const product = await db.costVendorProduct.upsert({
      where: {
        vendorId_sku_normalizedName_defaultUom: {
          vendorId: vendor.id,
          sku,
          normalizedName: normalizedProductName,
          defaultUom,
        },
      },
      update: {
        organizationId,
        resourceId,
        name: productName,
        description: candidate.description || productName,
        active: true,
        metadata: {
          source: "vendor_pdf_review",
          lastBatchId: candidate.batchId,
          documentType: candidate.documentType,
          documentNumber: candidate.documentNumber,
        },
      },
      create: {
        id: createId("cvprod"),
        organizationId,
        vendorId: vendor.id,
        resourceId,
        sku,
        name: productName,
        normalizedName: normalizedProductName,
        description: candidate.description || productName,
        defaultUom,
        metadata: {
          source: "vendor_pdf_review",
          firstBatchId: candidate.batchId,
          documentType: candidate.documentType,
          documentNumber: candidate.documentNumber,
        },
      },
    });

    return { vendorId: vendor.id, vendorProductId: product.id };
  }

  private async linkCostBasisToVendorProduct(
    costBasisId: string,
    links: { vendorId: string; vendorProductId: string },
  ) {
    const db = this.db as any;
    if (!db.effectiveCost?.update) return;
    await db.effectiveCost.update({
      where: { id: costBasisId },
      data: {
        vendorId: links.vendorId,
        vendorProductId: links.vendorProductId,
      },
    });
  }

  async analyzeVendorPdfEvidence(
    organizationId: string,
    files: VendorPdfIngestFile[],
    options: VendorPdfIngestOptions = {},
  ): Promise<VendorPdfAnalyzeResult> {
    const batchId = createId("pcana");
    const fallbackCurrency = normalizeCurrencyCode(options.defaultCurrency);
    const { parser, provider } = this.createParser(options);
    const reviewFolder = resolveApiPath("cost-intelligence", "review-runs", batchId);
    const originalsDir = resolve(reviewFolder, "originals");
    const extractionsDir = resolve(reviewFolder, "extractions");
    const result: VendorPdfAnalyzeResult = {
      batchId,
      files: [],
      fileCount: files.length,
      parsedFileCount: 0,
      lineCount: 0,
      candidateCount: 0,
      newCandidateCount: 0,
      updateCandidateCount: 0,
      duplicateCandidateCount: 0,
      discardCandidateCount: 0,
      candidates: [],
      reviewFolder,
      runtime: {
        workDir: reviewFolder,
        originalsDir,
        extractionsDir,
        instructionsFile: resolve(reviewFolder, "AGENTS.md"),
        expectedOutputFile: resolve(reviewFolder, "agent-reviewed-candidates.json"),
      },
      pipeline: {
        extractionProvider: provider,
        reviewStage: "agent_packet_prepared",
        commitMode: "approval_required",
      },
      warnings: [],
    };

    await mkdir(originalsDir, { recursive: true }).catch((err) => {
      result.reviewFolder = null;
      result.runtime = {
        workDir: null,
        originalsDir: null,
        extractionsDir: null,
        instructionsFile: null,
        expectedOutputFile: null,
      };
      result.warnings.push(`Agent runtime folder was not prepared: ${err instanceof Error ? err.message : String(err)}`);
    });
    await mkdir(extractionsDir, { recursive: true }).catch((err) => {
      result.warnings.push(`Extraction artifact folder was not prepared: ${err instanceof Error ? err.message : String(err)}`);
    });

    for (const file of files) {
      const lower = file.filename.toLowerCase();
      const isPdf = lower.endsWith(".pdf") || file.mimeType === "application/pdf";
      const safeFileName = `${String(result.files.length + 1).padStart(3, "0")}-${sanitizeFileName(file.filename || "vendor-evidence.pdf")}`;
      const originalPath = resolve(originalsDir, safeFileName);
      const extractionPath = resolve(extractionsDir, `${safeFileName}.parsed-document.json`);
      const fileResult: VendorPdfFileResult = {
        fileName: file.filename,
        status: "processed",
        vendorName: "",
        documentNumber: "",
        documentDate: null,
        lineCount: 0,
        observationsCreated: 0,
        duplicatesSkipped: 0,
        resourcesCreated: 0,
        resourcesReused: 0,
        warnings: [],
      };

      if (!isPdf) {
        fileResult.status = "skipped";
        fileResult.warnings.push("Only vendor PDF files are supported by this analysis path.");
        result.files.push(fileResult);
        result.warnings.push(`${file.filename}: skipped non-PDF file.`);
        continue;
      }

      try {
        if (result.reviewFolder) {
          await writeFile(originalPath, file.buffer).catch((err) => {
            fileResult.warnings.push(`Original PDF was not saved for agent review: ${err instanceof Error ? err.message : String(err)}`);
          });
          (fileResult as any).originalPdfPath = originalPath;
          (fileResult as any).extractionPath = extractionPath;
        }
        const doc = await parser.parse(file.buffer, file.filename);
        if (result.reviewFolder) {
          await writeFile(
            extractionPath,
            JSON.stringify({
              provider,
              fileName: file.filename,
              batchId,
              parsedDocument: doc,
            }, null, 2),
            "utf-8",
          ).catch((err) => {
            fileResult.warnings.push(`Provider extraction output was not saved for agent review: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
        fileResult.warnings.push(...doc.warnings);
        if (!doc.content.trim() && doc.tables.length === 0) {
          fileResult.status = "failed";
          fileResult.warnings.push("No readable text or vendor evidence tables were extracted.");
          result.files.push(fileResult);
          result.warnings.push(`${file.filename}: no readable vendor evidence content.`);
          continue;
        }

        const pageContexts = buildPageContexts(doc, fallbackCurrency);
        const lines = dedupeLineCandidates([
          ...extractLinesFromTables(doc.tables, (pageNumber) => pageContexts.get(pageNumber)?.currency ?? fallbackCurrency),
          ...(doc.pages.length > 0
            ? doc.pages.flatMap((page) => extractLinesFromText(
                page.content,
                pageContexts.get(page.pageNumber)?.currency ?? fallbackCurrency,
                page.pageNumber,
              ))
            : extractLinesFromText(doc.content, pageContexts.get(null)?.currency ?? fallbackCurrency)),
        ]);
        const lineContexts = lines.map((line) => contextForLine(pageContexts, line));

        fileResult.vendorName = summarizeDistinct(lineContexts.map((context) => context.vendorName), "Unknown vendor", "Multiple vendors");
        fileResult.documentNumber = summarizeDistinct(lineContexts.map((context) => context.documentNumber), "", "Multiple documents");
        fileResult.documentDate = summarizeDistinct(lineContexts.map((context) => context.documentDate ?? ""), null, "Multiple dates");
        fileResult.lineCount = lines.length;
        result.lineCount += lines.length;
        result.parsedFileCount += 1;

        if (lines.length === 0) {
          fileResult.status = "failed";
          fileResult.warnings.push("No cost lines with unit costs were detected.");
          result.files.push(fileResult);
          result.warnings.push(`${file.filename}: no cost lines detected.`);
          continue;
        }

        for (const [lineIndex, line] of lines.entries()) {
          const lineContext = lineContexts[lineIndex] ?? contextForLine(pageContexts, line);
          const vendorName = lineContext.vendorName || "Unknown vendor";
          const resource = await this.findResourceForEvidenceLine(organizationId, line);
          const existingCost = await this.findExistingCostBasis(organizationId, resource?.id ?? null, line.currency, vendorName);
          const fingerprint = makeFingerprint(organizationId, file.filename, vendorName, lineContext.documentNumber, line);
          const duplicate = await this.findDuplicateObservation(organizationId, {
            fingerprint,
            resourceId: resource?.id ?? null,
            vendorName,
            vendorSku: line.vendorSku,
            documentDate: lineContext.documentDate,
            uom: line.uom,
            unitCost: line.unitCost,
            currency: line.currency,
            rawText: line.rawText,
          });
          const resourceName = resource?.name ?? line.description;
          const qualityIssue = costEvidenceQualityIssue({
            resourceName,
            description: line.description,
            vendorSku: line.vendorSku,
            uom: line.uom,
            unitCost: line.unitCost,
            currency: line.currency,
          });
          const recommendation: VendorPdfCandidateRecommendation = duplicate
            ? "duplicate"
            : qualityIssue
              ? "discard"
              : existingCost ? "update_cost_basis" : "new_cost_item";
          const decision: VendorPdfCandidateDecision = duplicate || qualityIssue ? "discarded" : "pending";
          const recommendationReason = duplicate
            ? "Same vendor/document/item/cost evidence already exists."
            : qualityIssue
              ? qualityIssue
              : existingCost
                ? "Matches an existing resource and can update the cost basis after review."
                : "No matching cost resource was found; review before creating a new item.";
          const groupKey = candidateGroupKey(vendorName, resourceName, line.uom, line.currency);
          const sourceRef = {
            fileName: file.filename,
            batchId,
            documentNumber: lineContext.documentNumber,
            documentDate: lineContext.documentDate,
            pageNumber: line.pageNumber ?? null,
            lineIndex,
            source: line.source,
            documentType: lineContext.documentType,
          };

          result.candidates.push({
            id: candidateId(batchId, fingerprint, lineIndex),
            batchId,
            fileName: file.filename,
            lineIndex,
            pageNumber: line.pageNumber ?? null,
            decision,
            recommendation,
            recommendationReason,
            confidence: qualityIssue ? Math.min(line.confidence, 0.35) : line.confidence,
            vendorName,
            vendorSku: line.vendorSku,
            documentType: lineContext.documentType,
            documentNumber: lineContext.documentNumber,
            documentDate: lineContext.documentDate,
            resourceId: resource?.id ?? null,
            resourceName,
            resourceType: resource?.resourceType ?? "material",
            category: resource?.category || "Material",
            description: line.description,
            quantity: line.quantity,
            uom: line.uom,
            unitCost: line.unitCost,
            unitPrice: line.unitPrice,
            currency: line.currency,
            lineTotal: line.lineTotal,
            rawText: line.rawText,
            source: line.source,
            fingerprint,
            duplicateObservationId: duplicate?.id ?? null,
            existingCostBasisId: existingCost?.id ?? null,
            existingUnitCost: existingCost?.unitCost ?? null,
            groupKey,
            groupLabel: `${vendorName} / ${resourceName} / ${line.uom} / ${line.currency}`,
            sourceRef,
            metadata: {
              entrySurface: options.entrySurface ?? "library.cost_intelligence.vendor_pdf_review",
              analysisBatchId: batchId,
              lineTotal: line.lineTotal,
              originalFileName: file.filename,
              detectedCurrency: line.currency,
              qualityGate: qualityIssue
                ? { status: "blocked", reason: qualityIssue }
                : { status: "passed" },
              agentReview: {
                status: "packet_prepared",
                folder: null,
              },
            },
          });

          countVendorPdfRecommendation(result, recommendation);
        }

        result.files.push(fileResult);
      } catch (err) {
        fileResult.status = "failed";
        fileResult.warnings.push(err instanceof Error ? err.message : String(err));
        result.files.push(fileResult);
        result.warnings.push(`${file.filename}: ${fileResult.warnings.at(-1)}`);
      }
    }

    result.candidateCount = result.candidates.length;
    if (result.candidateCount > 0) {
      result.reviewFolder = await this.writeReviewPacket(result).catch((err) => {
        result.warnings.push(`Agent review packet was not written: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (result.reviewFolder) {
        result.candidates = result.candidates.map((candidate) => ({
          ...candidate,
          metadata: {
            ...candidate.metadata,
            agentReview: {
              status: "packet_prepared",
              folder: result.reviewFolder,
            },
          },
        }));
      }
    }

    return result;
  }

  async analyzeSpreadsheetEvidence(
    organizationId: string,
    files: VendorPdfIngestFile[],
    options: VendorPdfIngestOptions = {},
  ): Promise<VendorPdfAnalyzeResult> {
    const batchId = createId("pcana");
    const fallbackCurrency = normalizeCurrencyCode(options.defaultCurrency);
    const reviewFolder = resolveApiPath("cost-intelligence", "review-runs", batchId);
    const originalsDir = resolve(reviewFolder, "originals");
    const extractionsDir = resolve(reviewFolder, "extractions");
    const result: VendorPdfAnalyzeResult = {
      batchId,
      files: [],
      fileCount: files.length,
      parsedFileCount: 0,
      lineCount: 0,
      candidateCount: 0,
      newCandidateCount: 0,
      updateCandidateCount: 0,
      duplicateCandidateCount: 0,
      discardCandidateCount: 0,
      candidates: [],
      reviewFolder,
      runtime: {
        workDir: reviewFolder,
        originalsDir,
        extractionsDir,
        instructionsFile: resolve(reviewFolder, "AGENTS.md"),
        expectedOutputFile: resolve(reviewFolder, "agent-reviewed-candidates.json"),
      },
      pipeline: {
        extractionProvider: "spreadsheet_file",
        reviewStage: "agent_packet_prepared",
        commitMode: "approval_required",
      },
      warnings: [],
    };

    await mkdir(originalsDir, { recursive: true }).catch((err) => {
      result.reviewFolder = null;
      result.runtime = {
        workDir: null,
        originalsDir: null,
        extractionsDir: null,
        instructionsFile: null,
        expectedOutputFile: null,
      };
      result.warnings.push(`Agent runtime folder was not prepared: ${err instanceof Error ? err.message : String(err)}`);
    });
    await mkdir(extractionsDir, { recursive: true }).catch((err) => {
      result.warnings.push(`Extraction artifact folder was not prepared: ${err instanceof Error ? err.message : String(err)}`);
    });

    for (const file of files) {
      const lower = file.filename.toLowerCase();
      const isSpreadsheet =
        lower.endsWith(".csv") ||
        lower.endsWith(".xlsx") ||
        lower.endsWith(".xls") ||
        file.mimeType === "text/csv" ||
        file.mimeType === "application/vnd.ms-excel" ||
        file.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      const safeFileName = `${String(result.files.length + 1).padStart(3, "0")}-${sanitizeFileName(file.filename || "cost-evidence.xlsx")}`;
      const originalPath = resolve(originalsDir, safeFileName);
      const extractionPath = resolve(extractionsDir, `${safeFileName}.parsed-spreadsheet.json`);
      const fileResult: VendorPdfFileResult = {
        fileName: file.filename,
        status: "processed",
        vendorName: "",
        documentNumber: "",
        documentDate: null,
        lineCount: 0,
        observationsCreated: 0,
        duplicatesSkipped: 0,
        resourcesCreated: 0,
        resourcesReused: 0,
        warnings: [],
      };

      if (!isSpreadsheet) {
        fileResult.status = "skipped";
        fileResult.warnings.push("Only CSV, XLS, and XLSX cost files are supported by this analysis path.");
        result.files.push(fileResult);
        result.warnings.push(`${file.filename}: skipped unsupported file.`);
        continue;
      }

      try {
        if (result.reviewFolder) {
          await writeFile(originalPath, file.buffer).catch((err) => {
            fileResult.warnings.push(`Source file was not saved for agent review: ${err instanceof Error ? err.message : String(err)}`);
          });
          (fileResult as any).originalFilePath = originalPath;
          (fileResult as any).extractionPath = extractionPath;
        }

        const parsed = parseSpreadsheetEvidenceFile(file, fallbackCurrency);
        fileResult.warnings.push(...parsed.warnings);
        if (result.reviewFolder) {
          await writeFile(
            extractionPath,
            JSON.stringify({
              provider: "spreadsheet_file",
              fileName: file.filename,
              batchId,
              sheets: parsed.sheets,
              lines: parsed.lines.map((entry) => ({
                sheetName: entry.sheetName,
                rowNumber: entry.rowNumber,
                line: entry.line,
              })),
            }, null, 2),
            "utf-8",
          ).catch((err) => {
            fileResult.warnings.push(`Spreadsheet extraction output was not saved for agent review: ${err instanceof Error ? err.message : String(err)}`);
          });
        }

        const lines = parsed.lines;
        fileResult.vendorName = summarizeDistinct(lines.map((entry) => entry.line.vendorName ?? ""), "Unknown vendor", "Multiple vendors");
        fileResult.documentNumber = summarizeDistinct(lines.map((entry) => entry.line.documentNumber ?? ""), "", "Multiple documents");
        fileResult.documentDate = summarizeDistinct(lines.map((entry) => entry.line.documentDate ?? ""), null, "Multiple dates");
        fileResult.lineCount = lines.length;
        result.lineCount += lines.length;
        result.parsedFileCount += 1;

        if (lines.length === 0) {
          fileResult.status = "failed";
          fileResult.warnings.push("No cost rows with item descriptions and unit costs were detected.");
          result.files.push(fileResult);
          result.warnings.push(`${file.filename}: no cost rows detected.`);
          continue;
        }

        for (const [lineIndex, entry] of lines.entries()) {
          const line = entry.line;
          const vendorName = line.vendorName?.trim() || "Unknown vendor";
          const documentNumber = line.documentNumber?.trim() || "";
          const documentDate = line.documentDate ?? null;
          const documentType = line.documentType || "spreadsheet";
          const resource = await this.findResourceForEvidenceLine(organizationId, line);
          const existingCost = await this.findExistingCostBasis(organizationId, resource?.id ?? null, line.currency, vendorName);
          const fingerprint = makeFingerprint(organizationId, file.filename, vendorName, documentNumber, line);
          const duplicate = await this.findDuplicateObservation(organizationId, {
            fingerprint,
            resourceId: resource?.id ?? null,
            vendorName,
            vendorSku: line.vendorSku,
            documentDate,
            uom: line.uom,
            unitCost: line.unitCost,
            currency: line.currency,
            rawText: line.rawText,
          });
          const resourceName = resource?.name ?? line.description;
          const qualityIssue = costEvidenceQualityIssue({
            resourceName,
            description: line.description,
            vendorSku: line.vendorSku,
            uom: line.uom,
            unitCost: line.unitCost,
            currency: line.currency,
          });
          const recommendation: VendorPdfCandidateRecommendation = duplicate
            ? "duplicate"
            : qualityIssue
              ? "discard"
              : existingCost ? "update_cost_basis" : "new_cost_item";
          const decision: VendorPdfCandidateDecision = duplicate || qualityIssue ? "discarded" : "pending";
          const recommendationReason = duplicate
            ? "Same vendor/date/document/item/cost signal already exists."
            : qualityIssue
              ? qualityIssue
              : existingCost
                ? "Matches an existing product or vendor cost basis; approval records a new dated price signal."
                : "No matching cost resource was found; review before creating a new item.";
          const groupKey = candidateGroupKey(vendorName, resourceName, line.uom, line.currency);
          const sourceRef = {
            fileName: file.filename,
            batchId,
            sheetName: entry.sheetName,
            rowNumber: entry.rowNumber,
            documentNumber,
            documentDate,
            pageNumber: null,
            lineIndex,
            source: line.source,
            documentType,
          };

          result.candidates.push({
            id: candidateId(batchId, fingerprint, lineIndex),
            batchId,
            fileName: file.filename,
            lineIndex,
            pageNumber: null,
            decision,
            recommendation,
            recommendationReason,
            confidence: qualityIssue ? Math.min(line.confidence, 0.35) : line.confidence,
            vendorName,
            vendorSku: line.vendorSku,
            documentType,
            documentNumber,
            documentDate,
            resourceId: resource?.id ?? null,
            resourceName,
            resourceType: resource?.resourceType ?? line.resourceType ?? "material",
            category: resource?.category || line.category || "Material",
            description: line.description,
            quantity: line.quantity,
            uom: line.uom,
            unitCost: line.unitCost,
            unitPrice: line.unitPrice,
            currency: line.currency,
            lineTotal: line.lineTotal,
            rawText: line.rawText,
            source: line.source,
            fingerprint,
            duplicateObservationId: duplicate?.id ?? null,
            existingCostBasisId: existingCost?.id ?? null,
            existingUnitCost: existingCost?.unitCost ?? null,
            groupKey,
            groupLabel: `${vendorName} / ${resourceName} / ${line.uom} / ${line.currency}`,
            sourceRef,
            metadata: {
              entrySurface: options.entrySurface ?? "library.cost_intelligence.spreadsheet_review",
              analysisBatchId: batchId,
              lineTotal: line.lineTotal,
              originalFileName: file.filename,
              sheetName: entry.sheetName,
              rowNumber: entry.rowNumber,
              detectedCurrency: line.currency,
              qualityGate: qualityIssue
                ? { status: "blocked", reason: qualityIssue }
                : { status: "passed" },
              agentReview: {
                status: "packet_prepared",
                folder: null,
              },
            },
          });

          countVendorPdfRecommendation(result, recommendation);
        }

        result.files.push(fileResult);
      } catch (err) {
        fileResult.status = "failed";
        fileResult.warnings.push(err instanceof Error ? err.message : String(err));
        result.files.push(fileResult);
        result.warnings.push(`${file.filename}: ${fileResult.warnings.at(-1)}`);
      }
    }

    result.candidateCount = result.candidates.length;
    if (result.candidateCount > 0) {
      result.reviewFolder = await this.writeReviewPacket(result).catch((err) => {
        result.warnings.push(`Agent review packet was not written: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (result.reviewFolder) {
        result.candidates = result.candidates.map((candidate) => ({
          ...candidate,
          metadata: {
            ...candidate.metadata,
            agentReview: {
              status: "packet_prepared",
              folder: result.reviewFolder,
            },
          },
        }));
      }
    }

    return result;
  }

  async approveVendorPdfCandidates(
    organizationId: string,
    batchId: string,
    candidates: VendorPdfReviewCandidate[],
    options: { entrySurface?: string } = {},
  ): Promise<VendorPdfApprovalResult> {
    const result: VendorPdfApprovalResult = {
      batchId,
      candidatesReceived: candidates.length,
      approvedCandidates: 0,
      discardedCandidates: 0,
      observationsCreated: 0,
      duplicatesSkipped: 0,
      resourcesCreated: 0,
      resourcesReused: 0,
      costBasisUpdated: 0,
      warnings: [],
    };
    const touchedAggregateCostKeys = new Set<string>();
    const touchedVendorCostKeys = new Set<string>();
    const vendorLinksByVendorCostKey = new Map<string, { vendorId: string; vendorProductId: string }>();
    const seenObservationKeys = new Set<string>();

    for (const candidate of candidates) {
      if (candidate.decision === "discarded") {
        result.discardedCandidates += 1;
        continue;
      }
      if (candidate.decision !== "approved") continue;

      const qualityIssue = costEvidenceQualityIssue(candidate);
      if (qualityIssue) {
        result.discardedCandidates += 1;
        result.warnings.push(`Skipped approved candidate ${candidate.id}: ${qualityIssue}`);
        continue;
      }

      result.approvedCandidates += 1;

      const duplicate = await this.findDuplicateObservation(organizationId, {
        fingerprint: candidate.fingerprint,
        resourceId: candidate.resourceId,
        vendorName: candidate.vendorName.trim() || "Unknown vendor",
        vendorSku: candidate.vendorSku,
        documentDate: candidate.documentDate,
        uom: candidate.uom,
        unitCost: candidate.unitCost,
        currency: candidate.currency,
        rawText: candidate.rawText,
      });
      if (duplicate) {
        result.duplicatesSkipped += 1;
        continue;
      }

      let resource: ResourceCatalogItem | null = null;
      let created = false;
      if (candidate.resourceId) {
        resource = await this.requireResource(organizationId, candidate.resourceId);
      } else {
        resource = await this.findResourceForEvidenceLine(organizationId, {
          description: candidate.resourceName || candidate.description,
          vendorSku: candidate.vendorSku,
        });
        if (!resource) {
          resource = await this.createResource(organizationId, {
            resourceType: candidate.resourceType || "material",
            category: candidate.category || "Material",
            code: candidate.vendorSku,
            name: candidate.resourceName || candidate.description,
            defaultUom: candidate.uom,
            aliases: candidate.vendorSku ? [candidate.vendorSku] : [],
            tags: ["vendor-pdf-reviewed", candidate.source],
            metadata: {
              source: "vendor_pdf_review",
              vendorName: candidate.vendorName,
              confidence: candidate.confidence,
            },
          });
          created = true;
        }
      }

      const currency = normalizeCurrencyCode(candidate.currency);
      const vendorName = candidate.vendorName.trim() || "Unknown vendor";
      const semanticDuplicate = await this.findDuplicateObservation(organizationId, {
        fingerprint: candidate.fingerprint,
        resourceId: resource.id,
        vendorName,
        vendorSku: candidate.vendorSku,
        documentDate: candidate.documentDate,
        uom: candidate.uom,
        unitCost: candidate.unitCost,
        currency,
        rawText: candidate.rawText,
      });
      if (semanticDuplicate) {
        result.duplicatesSkipped += 1;
        continue;
      }
      const duplicateKey = semanticObservationDuplicateKey({
        resourceId: resource.id,
        vendorName,
        vendorSku: candidate.vendorSku,
        documentDate: candidate.documentDate,
        uom: candidate.uom,
        unitCost: candidate.unitCost,
        currency,
      });
      if (duplicateKey && seenObservationKeys.has(duplicateKey)) {
        result.duplicatesSkipped += 1;
        continue;
      }
      if (duplicateKey) seenObservationKeys.add(duplicateKey);

      if (created) result.resourcesCreated += 1;
      else result.resourcesReused += 1;

      const aggregateCostKey = `${resource.id}\u0000${currency}`;
      const vendorCostKey = `${resource.id}\u0000${currency}\u0000${vendorName}`;
      const vendorLinks = await this.upsertVendorProductForCandidate(organizationId, candidate, resource.id).catch((err) => {
        result.warnings.push(`Could not update vendor product registry for ${candidate.vendorName || "Unknown vendor"}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (vendorLinks) vendorLinksByVendorCostKey.set(vendorCostKey, vendorLinks);

      await this.createObservation(organizationId, {
        resourceId: resource.id,
        vendorId: vendorLinks?.vendorId,
        vendorProductId: vendorLinks?.vendorProductId,
        vendorName,
        vendorSku: candidate.vendorSku,
        documentType: candidate.documentType,
        observedAt: observationDateFromDocumentDate(candidate.documentDate),
        effectiveDate: candidate.documentDate,
        quantity: candidate.quantity,
        observedUom: candidate.uom,
        unitCost: candidate.unitCost,
        unitPrice: candidate.unitPrice,
        currency: candidate.currency,
        confidence: candidate.confidence,
        fingerprint: candidate.fingerprint,
        rawText: clampText(candidate.rawText, 4000),
        sourceRef: candidate.sourceRef,
        metadata: {
          ...candidate.metadata,
          entrySurface: options.entrySurface ?? "library.cost_intelligence.vendor_pdf_approval",
          approvedFromBatchId: batchId,
          reviewedCandidateId: candidate.id,
        },
      });
      result.observationsCreated += 1;
      touchedAggregateCostKeys.add(aggregateCostKey);
      touchedVendorCostKeys.add(vendorCostKey);
    }

    for (const key of touchedAggregateCostKeys) {
      const [resourceId, currency] = key.split("\u0000");
      if (!resourceId) continue;
      const costBasis = await this.recomputeEffectiveCost(organizationId, {
        resourceId,
        currency,
        vendorName: "",
        method: "weighted_average",
      }).catch((err) => {
        result.warnings.push(`Could not recompute aggregate cost basis for ${resourceId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (costBasis) result.costBasisUpdated += 1;
    }

    for (const key of touchedVendorCostKeys) {
      const [resourceId, currency, vendorName] = key.split("\u0000");
      if (!resourceId || !vendorName) continue;
      const costBasis = await this.recomputeEffectiveCost(organizationId, {
        resourceId,
        currency,
        vendorName,
        method: "weighted_average",
      }).catch((err) => {
        result.warnings.push(`Could not recompute vendor cost basis for ${resourceId}/${vendorName}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      });
      if (costBasis) result.costBasisUpdated += 1;
      const vendorLinks = vendorLinksByVendorCostKey.get(key);
      if (costBasis && vendorLinks) {
        await this.linkCostBasisToVendorProduct(costBasis.id, vendorLinks).catch((err) => {
          result.warnings.push(`Could not link cost basis ${costBasis.id} to vendor product: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }

    return result;
  }

  async ingestVendorPdfEvidence(
    organizationId: string,
    files: VendorPdfIngestFile[],
    options: VendorPdfIngestOptions = {},
  ): Promise<VendorPdfIngestResult> {
    const batchId = createId("pcing");
    const result: VendorPdfIngestResult = {
      batchId,
      files: [],
      fileCount: files.length,
      parsedFileCount: 0,
      lineCount: 0,
      observationsCreated: 0,
      duplicatesSkipped: 0,
      resourcesCreated: 0,
      resourcesReused: 0,
      effectiveCostsUpdated: 0,
      warnings: [],
    };

    const touchedResourceCostKeys = new Set<string>();
    const fallbackCurrency = normalizeCurrencyCode(options.defaultCurrency);
    const { parser } = this.createParser(options);

    for (const file of files) {
      const lower = file.filename.toLowerCase();
      const isPdf = lower.endsWith(".pdf") || file.mimeType === "application/pdf";
      const fileResult: VendorPdfFileResult = {
        fileName: file.filename,
        status: "processed",
        vendorName: "",
        documentNumber: "",
        documentDate: null,
        lineCount: 0,
        observationsCreated: 0,
        duplicatesSkipped: 0,
        resourcesCreated: 0,
        resourcesReused: 0,
        warnings: [],
      };

      if (!isPdf) {
        fileResult.status = "skipped";
        fileResult.warnings.push("Only vendor PDF files are supported by this ingestion path.");
        result.files.push(fileResult);
        result.warnings.push(`${file.filename}: skipped non-PDF file.`);
        continue;
      }

      try {
        const doc = await parser.parse(file.buffer, file.filename);
        fileResult.warnings.push(...doc.warnings);
        if (!doc.content.trim() && doc.tables.length === 0) {
          fileResult.status = "failed";
          fileResult.warnings.push("No readable text or vendor evidence tables were extracted.");
          result.files.push(fileResult);
          result.warnings.push(`${file.filename}: no readable vendor evidence content.`);
          continue;
        }

        const pageContexts = buildPageContexts(doc, fallbackCurrency);
        const lines = dedupeLineCandidates([
          ...extractLinesFromTables(doc.tables, (pageNumber) => pageContexts.get(pageNumber)?.currency ?? fallbackCurrency),
          ...(doc.pages.length > 0
            ? doc.pages.flatMap((page) => extractLinesFromText(
                page.content,
                pageContexts.get(page.pageNumber)?.currency ?? fallbackCurrency,
                page.pageNumber,
              ))
            : extractLinesFromText(doc.content, pageContexts.get(null)?.currency ?? fallbackCurrency)),
        ]);
        const lineContexts = lines.map((line) => contextForLine(pageContexts, line));

        fileResult.vendorName = summarizeDistinct(lineContexts.map((context) => context.vendorName), "Unknown vendor", "Multiple vendors");
        fileResult.documentNumber = summarizeDistinct(lineContexts.map((context) => context.documentNumber), "", "Multiple documents");
        fileResult.documentDate = summarizeDistinct(
          lineContexts.map((context) => context.documentDate ?? ""),
          null,
          "Multiple dates",
        );
        fileResult.lineCount = lines.length;
        result.lineCount += lines.length;
        result.parsedFileCount += 1;

        if (lines.length === 0) {
          fileResult.status = "failed";
          fileResult.warnings.push("No cost lines with unit costs were detected.");
          result.files.push(fileResult);
          result.warnings.push(`${file.filename}: no cost lines detected.`);
          continue;
        }

        for (const [lineIndex, line] of lines.entries()) {
          const lineContext = lineContexts[lineIndex] ?? contextForLine(pageContexts, line);
          const resourceResult = await this.findOrCreateResourceFromEvidenceLine(organizationId, line);
          if (resourceResult.created) {
            fileResult.resourcesCreated += 1;
            result.resourcesCreated += 1;
          } else {
            fileResult.resourcesReused += 1;
            result.resourcesReused += 1;
          }

          const fingerprint = makeFingerprint(organizationId, file.filename, lineContext.vendorName, lineContext.documentNumber, line);
          const duplicate = await this.findDuplicateObservation(organizationId, {
            fingerprint,
            resourceId: resourceResult.resource.id,
            vendorName: lineContext.vendorName || "Unknown vendor",
            vendorSku: line.vendorSku,
            documentDate: lineContext.documentDate,
            uom: line.uom,
            unitCost: line.unitCost,
            currency: line.currency,
            rawText: line.rawText,
          });
          if (duplicate) {
            fileResult.duplicatesSkipped += 1;
            result.duplicatesSkipped += 1;
            continue;
          }

          await this.createObservation(organizationId, {
            resourceId: resourceResult.resource.id,
            vendorName: lineContext.vendorName,
            vendorSku: line.vendorSku,
            documentType: lineContext.documentType,
            observedAt: observationDateFromDocumentDate(lineContext.documentDate),
            effectiveDate: lineContext.documentDate,
            quantity: line.quantity,
            observedUom: line.uom,
            unitCost: line.unitCost,
            unitPrice: line.unitPrice,
            currency: line.currency,
            confidence: line.confidence,
            fingerprint,
            rawText: clampText(line.rawText, 4000),
            sourceRef: {
              fileName: file.filename,
              batchId,
              documentNumber: lineContext.documentNumber,
              documentDate: lineContext.documentDate,
              pageNumber: line.pageNumber ?? null,
              lineIndex,
              source: line.source,
              documentType: lineContext.documentType,
            },
            metadata: {
              entrySurface: options.entrySurface ?? "library.cost_intelligence.vendor_pdf_ingest",
              ingestionBatchId: batchId,
              lineTotal: line.lineTotal,
              originalFileName: file.filename,
              detectedCurrency: line.currency,
            },
          });
          fileResult.observationsCreated += 1;
          result.observationsCreated += 1;
          touchedResourceCostKeys.add(`${resourceResult.resource.id}\u0000${line.currency}`);
        }

        result.files.push(fileResult);
      } catch (err) {
        fileResult.status = "failed";
        fileResult.warnings.push(err instanceof Error ? err.message : String(err));
        result.files.push(fileResult);
        result.warnings.push(`${file.filename}: ${fileResult.warnings.at(-1)}`);
      }
    }

    for (const key of touchedResourceCostKeys) {
      const [resourceId, currency] = key.split("\u0000");
      if (!resourceId) continue;
      const effectiveCost = await this.recomputeEffectiveCost(organizationId, {
        resourceId,
        currency,
        vendorName: "",
        method: "weighted_average",
      }).catch(() => null);
      if (effectiveCost) result.effectiveCostsUpdated += 1;
    }

    return result;
  }

  private async listPersistedVendors(
    organizationId: string,
    filters: CostIntelligenceListFilters = {},
  ): Promise<CostVendorRecord[] | null> {
    const db = this.db as any;
    if (!db.costVendor?.findMany) return null;
    const query = filters.query?.trim().toLowerCase();
    const productTake = filters.vendorName ? clampLimit(filters.limit ?? 5000) : 25;
    const rows = await db.costVendor.findMany({
      where: {
        organizationId,
        ...(filters.vendorName ? { name: { contains: filters.vendorName, mode: "insensitive" } } : {}),
      },
      include: {
        products: {
          include: {
            resource: true,
            priceObservations: {
              orderBy: { observedAt: "desc" },
              take: 1,
            },
            effectiveCosts: {
              orderBy: { updatedAt: "desc" },
              take: 1,
            },
            _count: {
              select: { priceObservations: true, effectiveCosts: true },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: productTake,
        },
        _count: {
          select: { products: true, priceObservations: true, effectiveCosts: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: clampLimit(filters.limit ?? 5000),
    });

    return rows
      .map((vendor: any): CostVendorRecord => {
        const products = (vendor.products ?? [])
          .map((product: any): CostVendorProductRecord => {
            const latestObservation = product.priceObservations?.[0] ?? null;
            const latestCostBasis = product.effectiveCosts?.[0] ?? null;
            const latestObservedAt = latestObservation?.observedAt
              ? toISO(latestObservation.observedAt)
              : latestCostBasis?.updatedAt ? toISO(latestCostBasis.updatedAt) : toISO(product.updatedAt);
            return {
              key: product.id,
              vendorSku: product.sku ?? "",
              name: product.name,
              resourceId: product.resourceId ?? null,
              resourceName: product.resource?.name ?? "",
              uom: latestObservation?.observedUom ?? latestCostBasis?.uom ?? product.defaultUom,
              currency: latestObservation?.currency ?? latestCostBasis?.currency ?? "USD",
              latestUnitCost: latestObservation?.unitCost ?? latestCostBasis?.unitCost ?? 0,
              latestObservedAt,
              observationCount: product._count?.priceObservations ?? 0,
              costBasisCount: product._count?.effectiveCosts ?? 0,
            };
          })
          .filter((product: CostVendorProductRecord) => !query || [
            vendor.name,
            product.name,
            product.vendorSku,
            product.resourceName,
            product.currency,
          ].some((value) => String(value ?? "").toLowerCase().includes(query)))
          .sort((a: CostVendorProductRecord, b: CostVendorProductRecord) => new Date(b.latestObservedAt).getTime() - new Date(a.latestObservedAt).getTime());
        const currencies: string[] = Array.from(
          new Set<string>(
            products
              .map((product: CostVendorProductRecord) => product.currency)
              .filter((currency: string | null | undefined): currency is string => Boolean(currency)),
          ),
        ).sort();
        const observationCount = products.reduce((total: number, product: CostVendorProductRecord) => total + product.observationCount, 0);
        const fallbackObservationCount = vendor._count?.priceObservations ?? 0;
        return {
          vendorName: vendor.name,
          productCount: vendor._count?.products ?? products.length,
          observationCount: Math.max(observationCount, fallbackObservationCount),
          costBasisCount: vendor._count?.effectiveCosts ?? 0,
          currencies,
          latestObservedAt: products[0]?.latestObservedAt ?? (vendor.updatedAt ? toISO(vendor.updatedAt) : null),
          products,
        };
      })
      .filter((vendor: CostVendorRecord) => !query || vendor.productCount > 0 || vendor.vendorName.toLowerCase().includes(query))
      .sort((a: CostVendorRecord, b: CostVendorRecord) => new Date(b.latestObservedAt ?? 0).getTime() - new Date(a.latestObservedAt ?? 0).getTime())
      .slice(0, clampLimit(filters.limit));
  }

  async listVendors(organizationId: string, filters: CostIntelligenceListFilters = {}): Promise<CostVendorRecord[]> {
    const persisted = await this.listPersistedVendors(organizationId, filters).catch(() => null);
    if (persisted?.length) return persisted;

    const query = filters.query?.trim().toLowerCase();
    const observations = await (this.db as any).priceObservation.findMany({
      where: {
        organizationId,
        ...(filters.vendorName ? { vendorName: { contains: filters.vendorName, mode: "insensitive" } } : {}),
      },
      orderBy: { observedAt: "desc" },
      include: { resource: true },
      take: clampLimit(filters.limit ?? 5000),
    });
    const costBasisCounts = new Map<string, number>();
    const costBasisGroups = await (this.db as any).effectiveCost.groupBy({
      by: ["vendorName"],
      where: { organizationId },
      _count: { _all: true },
    });
    for (const row of costBasisGroups) {
      const vendorName = String(row.vendorName || "All vendors").trim() || "All vendors";
      costBasisCounts.set(vendorName, row._count?._all ?? 0);
    }

    const vendors = new Map<string, CostVendorRecord>();
    const productMaps = new Map<string, Map<string, CostVendorProductRecord>>();
    for (const row of observations) {
      const vendorName = String(row.vendorName || "Unknown vendor").trim() || "Unknown vendor";
      const resource = row.resource ? mapResource(row.resource) : null;
      const rawName = String(row.rawText || "").split("|").at(-1)?.trim() || String(row.rawText || "").trim();
      const productName = resource?.name || rawName || row.vendorSku || "Vendor product";
      if (query && ![
        vendorName,
        productName,
        row.vendorSku,
        resource?.code,
        resource?.category,
      ].some((value) => String(value ?? "").toLowerCase().includes(query))) {
        continue;
      }

      const vendor = vendors.get(vendorName) ?? {
        vendorName,
        productCount: 0,
        observationCount: 0,
        costBasisCount: costBasisCounts.get(vendorName) ?? 0,
        currencies: [],
        latestObservedAt: null,
        products: [],
      };
      vendor.observationCount += 1;
      const observedAt = toISO(row.observedAt);
      if (!vendor.latestObservedAt || new Date(observedAt).getTime() > new Date(vendor.latestObservedAt).getTime()) {
        vendor.latestObservedAt = observedAt;
      }
      if (!vendor.currencies.includes(row.currency)) vendor.currencies.push(row.currency);
      vendors.set(vendorName, vendor);

      const products = productMaps.get(vendorName) ?? new Map<string, CostVendorProductRecord>();
      const productKey = [vendorName, row.vendorSku || "", resource?.id ?? normalizeResourceName(productName), row.observedUom, row.currency].join("|");
      const existing = products.get(productKey);
      if (existing) {
        existing.observationCount += 1;
        if (new Date(observedAt).getTime() > new Date(existing.latestObservedAt).getTime()) {
          existing.latestObservedAt = observedAt;
          existing.latestUnitCost = row.unitCost;
        }
      } else {
        products.set(productKey, {
          key: productKey,
          vendorSku: row.vendorSku ?? "",
          name: productName,
          resourceId: resource?.id ?? null,
          resourceName: resource?.name ?? "",
          uom: row.observedUom,
          currency: row.currency,
          latestUnitCost: row.unitCost,
          latestObservedAt: observedAt,
          observationCount: 1,
          costBasisCount: 0,
        });
      }
      productMaps.set(vendorName, products);
    }

    for (const [vendorName, vendor] of vendors) {
      vendor.products = Array.from(productMaps.get(vendorName)?.values() ?? [])
        .sort((a, b) => new Date(b.latestObservedAt).getTime() - new Date(a.latestObservedAt).getTime())
        .slice(0, filters.vendorName ? clampLimit(filters.limit ?? 5000) : 25);
      vendor.productCount = productMaps.get(vendorName)?.size ?? 0;
      vendor.currencies.sort();
    }

    return Array.from(vendors.values())
      .sort((a, b) => new Date(b.latestObservedAt ?? 0).getTime() - new Date(a.latestObservedAt ?? 0).getTime())
      .slice(0, clampLimit(filters.limit));
  }

  async listResources(organizationId: string, filters: CostIntelligenceListFilters = {}) {
    const where: any = { organizationId };
    const query = filters.query?.trim();
    if (query) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { code: { contains: query, mode: "insensitive" } },
        { manufacturer: { contains: query, mode: "insensitive" } },
        { manufacturerPartNumber: { contains: query, mode: "insensitive" } },
        { aliases: { has: query } },
        { tags: { has: query } },
      ];
    }

    const rows = await (this.db as any).resourceCatalogItem.findMany({
      where,
      orderBy: [{ active: "desc" }, { name: "asc" }],
      take: clampLimit(filters.limit),
    });
    return rows.map(mapResource);
  }

  async getSummary(organizationId: string) {
    const db = this.db as any;
    const [
      resourceCount,
      observationCount,
      effectiveCostCount,
      persistedVendorCount,
      observedVendors,
    ] = await Promise.all([
      db.resourceCatalogItem.count({ where: { organizationId } }),
      db.priceObservation.count({ where: { organizationId } }),
      db.effectiveCost.count({ where: { organizationId } }),
      db.costVendor?.count ? db.costVendor.count({ where: { organizationId } }) : Promise.resolve(0),
      db.priceObservation.groupBy({
        by: ["vendorName"],
        where: { organizationId, vendorName: { not: "" } },
      }),
    ]);

    return {
      resources: resourceCount,
      observations: observationCount,
      effectiveCosts: effectiveCostCount,
      vendors: Math.max(persistedVendorCount, observedVendors.length),
    };
  }

  async getResource(organizationId: string, resourceId: string) {
    const row = await (this.db as any).resourceCatalogItem.findFirst({
      where: { id: resourceId, organizationId },
    });
    return row ? mapResource(row) : null;
  }

  async createResource(organizationId: string, input: CreateResourceCatalogItemInput) {
    if (input.catalogItemId) {
      const catalogItem = await this.db.catalogItem.findFirst({
        where: { id: input.catalogItemId, catalog: { organizationId } },
      });
      if (!catalogItem) throw new Error(`Catalog item ${input.catalogItemId} not found`);
    }

    const row = await (this.db as any).resourceCatalogItem.create({
      data: {
        id: createId("rci"),
        organizationId,
        catalogItemId: input.catalogItemId ?? null,
        resourceType: input.resourceType ?? "material",
        category: input.category ?? "",
        code: input.code ?? "",
        name: input.name.trim(),
        normalizedName: normalizeResourceName(input.name),
        description: input.description ?? "",
        manufacturer: input.manufacturer ?? "",
        manufacturerPartNumber: input.manufacturerPartNumber ?? "",
        defaultUom: input.defaultUom ?? "EA",
        aliases: input.aliases ?? [],
        tags: input.tags ?? [],
        metadata: input.metadata ?? {},
        active: input.active ?? true,
      },
    });
    return mapResource(row);
  }

  private async findOrCreateResourceFromEvidenceLine(
    organizationId: string,
    line: VendorEvidenceLineCandidate,
  ): Promise<{ resource: ResourceCatalogItem; created: boolean }> {
    const normalizedName = normalizeResourceName(line.description);
    const existing = await (this.db as any).resourceCatalogItem.findFirst({
      where: {
        organizationId,
        OR: [
          { normalizedName },
          ...(line.vendorSku ? [{ code: line.vendorSku }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return { resource: mapResource(existing), created: false };

    const resource = await this.createResource(organizationId, {
      resourceType: "material",
      category: "Material",
      code: line.vendorSku,
      name: line.description,
      defaultUom: line.uom,
      aliases: line.vendorSku ? [line.vendorSku] : [],
      tags: ["vendor-pdf-ingested", line.source],
      metadata: {
        source: "vendor_pdf_ingestion",
        confidence: line.confidence,
      },
    });
    return { resource, created: true };
  }

  async listObservations(organizationId: string, filters: CostIntelligenceListFilters = {}) {
    const where: any = { organizationId };
    if (filters.resourceId) where.resourceId = filters.resourceId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.sourceDocumentId) where.sourceDocumentId = filters.sourceDocumentId;
    if (filters.vendorName) where.vendorName = { contains: filters.vendorName, mode: "insensitive" };

    const rows = await (this.db as any).priceObservation.findMany({
      where,
      orderBy: { observedAt: "desc" },
      take: clampLimit(filters.limit),
    });
    return rows.map(mapObservation);
  }

  async createObservation(organizationId: string, input: CreateCostObservationInput) {
    if (input.resourceId) {
      await this.requireResource(organizationId, input.resourceId);
    }
    if (input.projectId) {
      await this.requireProject(organizationId, input.projectId);
    }
    if (input.sourceDocumentId) {
      await this.requireSourceDocument(organizationId, input.sourceDocumentId);
    }

    const normalized = normalizeCostObservation({
      id: "draft",
      observedUom: input.observedUom ?? "EA",
      unitCost: input.unitCost,
      unitPrice: input.unitPrice ?? null,
      currency: input.currency ?? "USD",
      confidence: input.confidence ?? 0,
    });

    const row = await (this.db as any).priceObservation.create({
      data: {
        id: createId("pobs"),
        organizationId,
        resourceId: input.resourceId ?? null,
        ...(input.vendorId ? { vendorId: input.vendorId } : {}),
        ...(input.vendorProductId ? { vendorProductId: input.vendorProductId } : {}),
        projectId: input.projectId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        vendorName: input.vendorName ?? "",
        vendorSku: input.vendorSku ?? "",
        documentType: input.documentType ?? "manual",
        observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
        effectiveDate: input.effectiveDate ?? null,
        quantity: input.quantity ?? 1,
        observedUom: normalized.observedUom,
        unitCost: normalized.unitCost,
        unitPrice: normalized.unitPrice,
        currency: normalized.currency,
        freight: input.freight ?? 0,
        tax: input.tax ?? 0,
        discount: input.discount ?? 0,
        confidence: normalized.confidence,
        fingerprint: input.fingerprint ?? "",
        sourceRef: input.sourceRef ?? {},
        rawText: input.rawText ?? "",
        metadata: input.metadata ?? {},
      },
    });
    return mapObservation(row);
  }

  async listEffectiveCosts(organizationId: string, filters: CostIntelligenceListFilters = {}) {
    const where: any = { organizationId };
    if (filters.resourceId) where.resourceId = filters.resourceId;
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.vendorName) where.vendorName = { contains: filters.vendorName, mode: "insensitive" };

    const scope = filters.scope ?? "all";
    const scopeAnd: any[] = [];
    if (scope === "aggregate") {
      scopeAnd.push({ vendorName: "" }, { vendorProductId: null });
    } else if (scope === "per_vendor") {
      scopeAnd.push({ OR: [{ vendorName: { not: "" } }, { vendorProductId: { not: null } }] });
    }
    if (scopeAnd.length > 0) where.AND = scopeAnd;

    if (filters.query?.trim()) {
      const query = filters.query.trim();
      where.OR = [
        { vendorName: { contains: query, mode: "insensitive" } },
        { method: { contains: query, mode: "insensitive" } },
        {
          resource: {
            is: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { category: { contains: query, mode: "insensitive" } },
                { resourceType: { contains: query, mode: "insensitive" } },
                { code: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        },
        {
          sourceObservation: {
            is: {
              OR: [
                { vendorName: { contains: query, mode: "insensitive" } },
                { documentType: { contains: query, mode: "insensitive" } },
                { rawText: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }

    const rows = await (this.db as any).effectiveCost.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      include: {
        resource: true,
        sourceObservation: true,
      },
      take: clampLimit(filters.limit),
    });
    return rows.map(mapEffectiveCost);
  }

  async recomputeEffectiveCost(organizationId: string, input: EffectiveCostRecomputeInput) {
    const resource = await this.requireResource(organizationId, input.resourceId);
    if (input.projectId) {
      await this.requireProject(organizationId, input.projectId);
    }

    const observations = await this.listObservations(organizationId, {
      resourceId: resource.id,
      projectId: input.projectId ?? undefined,
      vendorName: input.vendorName ?? undefined,
      limit: 500,
    });
    const draft = deriveEffectiveCostFromObservations(resource, observations, input);
    if (!draft) return null;
    return this.upsertEffectiveCost(organizationId, draft);
  }

  async createEffectiveCost(organizationId: string, input: EffectiveCostManualInput) {
    const resource = await this.resolveManualEffectiveCostResource(organizationId, input);
    if (input.projectId) {
      await this.requireProject(organizationId, input.projectId);
    }

    const row = await (this.db as any).effectiveCost.create({
      data: {
        id: createId("ecost"),
        organizationId,
        resourceId: resource.id,
        projectId: input.projectId ?? null,
        vendorName: input.vendorName ?? "",
        region: input.region ?? "",
        uom: normalizeUom(input.uom ?? input.defaultUom ?? resource.defaultUom),
        unitCost: input.unitCost,
        unitPrice: input.unitPrice ?? null,
        currency: (input.currency ?? "USD").trim().toUpperCase(),
        effectiveDate: input.effectiveDate ?? null,
        expiresAt: input.expiresAt ?? null,
        sourceObservationId: null,
        method: input.method ?? "manual",
        sampleSize: input.sampleSize ?? 1,
        confidence: input.confidence ?? 0.75,
        metadata: {
          source: "manual_effective_cost",
          ...(input.metadata ?? {}),
        },
      },
      include: {
        resource: true,
        sourceObservation: true,
      },
    });
    return mapEffectiveCost(row);
  }

  async updateEffectiveCost(organizationId: string, effectiveCostId: string, patch: EffectiveCostPatchInput) {
    const existing = await (this.db as any).effectiveCost.findFirst({
      where: { id: effectiveCostId, organizationId },
    });
    if (!existing) throw new Error(`Effective cost ${effectiveCostId} not found`);

    const data: any = {};
    if (patch.resourceId !== undefined || patch.resourceName !== undefined) {
      const resource = await this.resolveManualEffectiveCostResource(organizationId, patch);
      data.resourceId = resource.id;
    }
    if (patch.projectId !== undefined) {
      if (patch.projectId) await this.requireProject(organizationId, patch.projectId);
      data.projectId = patch.projectId ?? null;
    }
    if (patch.vendorName !== undefined) data.vendorName = patch.vendorName;
    if (patch.region !== undefined) data.region = patch.region;
    if (patch.uom !== undefined) data.uom = normalizeUom(patch.uom);
    if (patch.unitCost !== undefined) data.unitCost = patch.unitCost;
    if (patch.unitPrice !== undefined) data.unitPrice = patch.unitPrice ?? null;
    if (patch.currency !== undefined) data.currency = patch.currency.trim().toUpperCase() || existing.currency;
    if (patch.effectiveDate !== undefined) data.effectiveDate = patch.effectiveDate ?? null;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt ?? null;
    if (patch.method !== undefined) data.method = patch.method;
    if (patch.sampleSize !== undefined) data.sampleSize = patch.sampleSize;
    if (patch.confidence !== undefined) data.confidence = patch.confidence;
    if (patch.metadata !== undefined) data.metadata = patch.metadata;

    const row = await (this.db as any).effectiveCost.update({
      where: { id: existing.id },
      data,
      include: {
        resource: true,
        sourceObservation: true,
      },
    });
    return mapEffectiveCost(row);
  }

  async deleteEffectiveCost(organizationId: string, effectiveCostId: string) {
    const existing = await (this.db as any).effectiveCost.findFirst({
      where: { id: effectiveCostId, organizationId },
      select: { id: true },
    });
    if (!existing) throw new Error(`Effective cost ${effectiveCostId} not found`);
    await (this.db as any).effectiveCost.delete({ where: { id: effectiveCostId } });
    return { deleted: true as const };
  }

  async deleteEffectiveCosts(organizationId: string, effectiveCostIds: string[]) {
    const uniqueIds = Array.from(new Set(effectiveCostIds.map((id) => id.trim()).filter(Boolean)));
    if (uniqueIds.length === 0) return { deleted: true as const, deletedCount: 0 };
    const result = await (this.db as any).effectiveCost.deleteMany({
      where: {
        organizationId,
        id: { in: uniqueIds },
      },
    });
    return { deleted: true as const, deletedCount: result.count };
  }

  private async upsertEffectiveCost(organizationId: string, draft: EffectiveCostDraft) {
    const existing = await (this.db as any).effectiveCost.findFirst({
      where: {
        organizationId,
        resourceId: draft.resourceId,
        projectId: draft.projectId,
        vendorName: draft.vendorName,
        region: draft.region,
        uom: draft.uom,
        currency: draft.currency,
      },
      orderBy: { updatedAt: "desc" },
    });

    const data = {
      organizationId,
      resourceId: draft.resourceId,
      projectId: draft.projectId,
      vendorName: draft.vendorName,
      region: draft.region,
      uom: draft.uom,
      unitCost: draft.unitCost,
      unitPrice: draft.unitPrice,
      currency: draft.currency,
      effectiveDate: draft.effectiveDate,
      sourceObservationId: draft.sourceObservationId,
      method: draft.method,
      sampleSize: draft.sampleSize,
      confidence: draft.confidence,
      metadata: draft.metadata,
    };

    const row = existing
      ? await (this.db as any).effectiveCost.update({ where: { id: existing.id }, data })
      : await (this.db as any).effectiveCost.create({
          data: {
            id: createId("ecost"),
            ...data,
          },
    });
    return mapEffectiveCost(row);
  }

  private async resolveManualEffectiveCostResource(
    organizationId: string,
    input: Pick<EffectiveCostManualInput, "resourceId" | "resourceName" | "resourceType" | "category" | "code" | "defaultUom">,
  ): Promise<ResourceCatalogItem> {
    if (input.resourceId) {
      return this.requireResource(organizationId, input.resourceId);
    }

    const name = input.resourceName?.trim();
    if (!name) throw new Error("resourceId or resourceName is required");
    const normalizedName = normalizeResourceName(name);
    const existing = await (this.db as any).resourceCatalogItem.findFirst({
      where: {
        organizationId,
        OR: [
          { normalizedName },
          ...(input.code?.trim() ? [{ code: input.code.trim() }] : []),
        ],
      },
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return mapResource(existing);

    return this.createResource(organizationId, {
      resourceType: input.resourceType ?? "material",
      category: input.category ?? "Material",
      code: input.code ?? "",
      name,
      defaultUom: input.defaultUom ?? "EA",
      metadata: { source: "manual_effective_cost" },
    });
  }

  private async requireResource(organizationId: string, resourceId: string): Promise<ResourceCatalogItem> {
    const resource = await this.getResource(organizationId, resourceId);
    if (!resource) throw new Error(`Resource ${resourceId} not found`);
    return resource;
  }

  private async requireProject(organizationId: string, projectId: string) {
    const project = await this.db.project.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new Error(`Project ${projectId} not found`);
    return project;
  }

  private async requireSourceDocument(organizationId: string, sourceDocumentId: string) {
    const sourceDocument = await this.db.sourceDocument.findFirst({
      where: { id: sourceDocumentId, project: { organizationId } },
    });
    if (!sourceDocument) throw new Error(`Source document ${sourceDocumentId} not found`);
    return sourceDocument;
  }
}

function clampLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(50000, Math.floor(value)));
}

export const costIntelligenceService = new CostIntelligenceService();

export const ESTIMATE_EVIDENCE_KINDS = [
  "document_page",
  "document_chunk",
  "knowledge_book",
  "knowledge_table",
  "knowledge_page",
  "dataset_row",
  "web_url",
  "takeoff_annotation",
  "takeoff_link",
  "model_quantity",
  "model_link",
  "assumption",
  "correction_factor",
  "rate_schedule_item",
  "catalog_item",
  "manual_note",
] as const;

export type EstimateEvidenceKind = (typeof ESTIMATE_EVIDENCE_KINDS)[number];

export type EstimateEvidenceCoverageFacet = "scope" | "quantity" | "rate" | "adjustment";

export type EstimateEvidenceValidationSeverity = "error" | "warning";

export interface EstimateEvidenceValidationIssue {
  severity: EstimateEvidenceValidationSeverity;
  code: string;
  message: string;
  evidenceId?: string;
  worksheetItemId?: string;
  kind?: EstimateEvidenceKind;
}

export interface EstimateEvidenceBase {
  id?: string | null;
  kind: EstimateEvidenceKind;
  worksheetItemId?: string | null;
  worksheetId?: string | null;
  revisionId?: string | null;
  projectId?: string | null;
  label?: string | null;
  excerpt?: string | null;
  note?: string | null;
  confidence?: number | null;
  weight?: number | null;
  facets?: EstimateEvidenceCoverageFacet[] | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
}

export interface DocumentPageEstimateEvidence extends EstimateEvidenceBase {
  kind: "document_page";
  sourceDocumentId?: string | null;
  documentId?: string | null;
  documentName?: string | null;
  fileName?: string | null;
  pageNumber?: number | null;
  pageEnd?: number | null;
  sectionTitle?: string | null;
}

export interface DocumentChunkEstimateEvidence extends EstimateEvidenceBase {
  kind: "document_chunk";
  sourceDocumentId?: string | null;
  documentId?: string | null;
  chunkId?: string | null;
  documentName?: string | null;
  fileName?: string | null;
  pageNumber?: number | null;
  pageEnd?: number | null;
  sectionTitle?: string | null;
}

export interface KnowledgeBookEstimateEvidence extends EstimateEvidenceBase {
  kind: "knowledge_book";
  bookId?: string | null;
  bookName?: string | null;
  pageNumber?: number | null;
  sectionTitle?: string | null;
}

export interface KnowledgeTableEstimateEvidence extends EstimateEvidenceBase {
  kind: "knowledge_table";
  bookId?: string | null;
  bookName?: string | null;
  tableId?: string | null;
  tableName?: string | null;
  pageNumber?: number | null;
  rowKey?: string | null;
  rowLabel?: string | null;
}

export interface KnowledgePageEstimateEvidence extends EstimateEvidenceBase {
  kind: "knowledge_page";
  bookId?: string | null;
  bookName?: string | null;
  documentId?: string | null;
  documentTitle?: string | null;
  pageId?: string | null;
  pageTitle?: string | null;
  pageNumber?: number | null;
  sectionTitle?: string | null;
}

export interface DatasetRowEstimateEvidence extends EstimateEvidenceBase {
  kind: "dataset_row";
  datasetId?: string | null;
  datasetName?: string | null;
  rowId?: string | null;
  rowLabel?: string | null;
  fieldKey?: string | null;
  fieldLabel?: string | null;
}

export interface WebUrlEstimateEvidence extends EstimateEvidenceBase {
  kind: "web_url";
  url?: string | null;
  title?: string | null;
  publisher?: string | null;
  accessedAt?: string | null;
}

export interface EstimateEvidenceMeasurement {
  value?: number | null;
  unit?: string | null;
  area?: number | null;
  volume?: number | null;
  count?: number | null;
}

export interface TakeoffAnnotationEstimateEvidence extends EstimateEvidenceBase {
  kind: "takeoff_annotation";
  annotationId?: string | null;
  documentId?: string | null;
  documentName?: string | null;
  pageNumber?: number | null;
  annotationLabel?: string | null;
  quantityField?: string | null;
  measurement?: EstimateEvidenceMeasurement | null;
}

export interface TakeoffLinkEstimateEvidence extends EstimateEvidenceBase {
  kind: "takeoff_link";
  takeoffLinkId?: string | null;
  annotationId?: string | null;
  annotationLabel?: string | null;
  quantityField?: string | null;
  multiplier?: number | null;
  derivedQuantity?: number | null;
  uom?: string | null;
}

export interface ModelQuantityEstimateEvidence extends EstimateEvidenceBase {
  kind: "model_quantity";
  aiRunId?: string | null;
  model?: string | null;
  quantity?: number | null;
  uom?: string | null;
  expression?: string | null;
  rationale?: string | null;
}

export interface ModelLinkEstimateEvidence extends EstimateEvidenceBase {
  kind: "model_link";
  aiRunId?: string | null;
  model?: string | null;
  linkId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  title?: string | null;
  url?: string | null;
  rationale?: string | null;
}

export interface AssumptionEstimateEvidence extends EstimateEvidenceBase {
  kind: "assumption";
  statement?: string | null;
  status?: string | null;
  owner?: string | null;
}

export interface CorrectionFactorEstimateEvidence extends EstimateEvidenceBase {
  kind: "correction_factor";
  factorName?: string | null;
  factorValue?: number | null;
  operation?: string | null;
  basis?: string | null;
}

export interface RateScheduleItemEstimateEvidence extends EstimateEvidenceBase {
  kind: "rate_schedule_item";
  rateScheduleId?: string | null;
  rateScheduleName?: string | null;
  rateScheduleItemId?: string | null;
  itemCode?: string | null;
  itemName?: string | null;
  tierId?: string | null;
  tierName?: string | null;
  rate?: number | null;
  costRate?: number | null;
  unit?: string | null;
}

export interface CatalogItemEstimateEvidence extends EstimateEvidenceBase {
  kind: "catalog_item";
  catalogId?: string | null;
  catalogName?: string | null;
  catalogItemId?: string | null;
  itemCode?: string | null;
  itemName?: string | null;
  unit?: string | null;
  unitCost?: number | null;
  unitPrice?: number | null;
}

export interface ManualNoteEstimateEvidence extends EstimateEvidenceBase {
  kind: "manual_note";
  text?: string | null;
  author?: string | null;
}

export type EstimateEvidence =
  | DocumentPageEstimateEvidence
  | DocumentChunkEstimateEvidence
  | KnowledgeBookEstimateEvidence
  | KnowledgeTableEstimateEvidence
  | KnowledgePageEstimateEvidence
  | DatasetRowEstimateEvidence
  | WebUrlEstimateEvidence
  | TakeoffAnnotationEstimateEvidence
  | TakeoffLinkEstimateEvidence
  | ModelQuantityEstimateEvidence
  | ModelLinkEstimateEvidence
  | AssumptionEstimateEvidence
  | CorrectionFactorEstimateEvidence
  | RateScheduleItemEstimateEvidence
  | CatalogItemEstimateEvidence
  | ManualNoteEstimateEvidence;

export type NormalizedEstimateEvidence = EstimateEvidence;

export type EstimateEvidenceRowStatus = "empty" | "weak" | "supporting" | "strong";

export interface EstimateEvidenceRowScore {
  score: number;
  status: EstimateEvidenceRowStatus;
  facets: EstimateEvidenceCoverageFacet[];
  issues: EstimateEvidenceValidationIssue[];
}

export type EstimateEvidenceCoverageStatus = "empty" | "weak" | "partial" | "covered" | "strong";

export interface EstimateEvidenceCoverageScore {
  score: number;
  status: EstimateEvidenceCoverageStatus;
  expectedFacets: EstimateEvidenceCoverageFacet[];
  presentFacets: EstimateEvidenceCoverageFacet[];
  missingFacets: EstimateEvidenceCoverageFacet[];
  facetScores: Partial<Record<EstimateEvidenceCoverageFacet, number>>;
  evidenceCount: number;
  strongEvidenceCount: number;
  directEvidenceCount: number;
  weakEvidenceCount: number;
  emptyEvidenceCount: number;
  byKind: Record<EstimateEvidenceKind, number>;
  issues: EstimateEvidenceValidationIssue[];
}

export interface EstimateEvidenceCoverageOptions {
  expectedFacets?: EstimateEvidenceCoverageFacet[];
  unassignedKey?: string;
}

export interface RenderEstimateEvidenceSourceNotesOptions {
  separator?: string;
  maxNotes?: number;
}

export const UNASSIGNED_WORKSHEET_ITEM_ID = "__unassigned__";

export const DEFAULT_ESTIMATE_EVIDENCE_EXPECTED_FACETS: EstimateEvidenceCoverageFacet[] = [
  "scope",
  "quantity",
  "rate",
];

export const ESTIMATE_EVIDENCE_KIND_FACETS: Record<EstimateEvidenceKind, EstimateEvidenceCoverageFacet[]> = {
  document_page: ["scope"],
  document_chunk: ["scope"],
  knowledge_book: ["scope"],
  knowledge_table: ["scope", "rate"],
  knowledge_page: ["scope"],
  dataset_row: ["rate"],
  web_url: ["scope"],
  takeoff_annotation: ["quantity"],
  takeoff_link: ["quantity"],
  model_quantity: ["quantity"],
  model_link: ["quantity"],
  assumption: ["adjustment"],
  correction_factor: ["adjustment"],
  rate_schedule_item: ["rate"],
  catalog_item: ["rate"],
  manual_note: ["scope"],
};

export const ESTIMATE_EVIDENCE_KIND_BASE_SCORES: Record<EstimateEvidenceKind, number> = {
  document_page: 0.86,
  document_chunk: 0.92,
  knowledge_book: 0.66,
  knowledge_table: 0.84,
  knowledge_page: 0.78,
  dataset_row: 0.86,
  web_url: 0.62,
  takeoff_annotation: 0.9,
  takeoff_link: 0.96,
  model_quantity: 0.7,
  model_link: 0.64,
  assumption: 0.42,
  correction_factor: 0.62,
  rate_schedule_item: 0.94,
  catalog_item: 0.88,
  manual_note: 0.34,
};

const VALID_FACETS = new Set<EstimateEvidenceCoverageFacet>(["scope", "quantity", "rate", "adjustment"]);

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = typeof value === "string" ? Number(value.replace(/,/g, "")) : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanPositiveNumber(value: unknown): number | undefined {
  const parsed = cleanNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function cleanPageNumber(value: unknown): number | undefined {
  const parsed = cleanPositiveNumber(value);
  return parsed === undefined ? undefined : Math.trunc(parsed);
}

function cleanConfidence(value: unknown): number | undefined {
  const parsed = cleanNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return clamp(normalized, 0, 1);
}

function cleanWeight(value: unknown): number | undefined {
  const parsed = cleanPositiveNumber(value);
  if (parsed === undefined) {
    return undefined;
  }
  return clamp(parsed, 0, 2);
}

function cleanMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function cleanFacets(value: unknown): EstimateEvidenceCoverageFacet[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const facets = value.filter((facet): facet is EstimateEvidenceCoverageFacet => VALID_FACETS.has(facet));
  return unique(facets);
}

function cleanPageEnd(rawPageEnd: unknown, pageNumber: number | undefined): number | undefined {
  const pageEnd = cleanPageNumber(rawPageEnd);
  if (pageEnd === undefined) {
    return undefined;
  }
  if (pageNumber !== undefined && pageEnd < pageNumber) {
    return pageNumber;
  }
  return pageEnd;
}

function cleanMeasurement(value: unknown): EstimateEvidenceMeasurement | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const measurement = value as EstimateEvidenceMeasurement;
  return pruneUndefined({
    value: cleanNumber(measurement.value),
    unit: cleanString(measurement.unit),
    area: cleanNumber(measurement.area),
    volume: cleanNumber(measurement.volume),
    count: cleanNumber(measurement.count),
  });
}

function normalizeCommon(row: EstimateEvidence): EstimateEvidenceBase {
  return pruneUndefined({
    kind: row.kind,
    id: cleanString(row.id),
    worksheetItemId: cleanString(row.worksheetItemId),
    worksheetId: cleanString(row.worksheetId),
    revisionId: cleanString(row.revisionId),
    projectId: cleanString(row.projectId),
    label: cleanString(row.label),
    excerpt: cleanString(row.excerpt),
    note: cleanString(row.note),
    confidence: cleanConfidence(row.confidence),
    weight: cleanWeight(row.weight),
    facets: cleanFacets(row.facets),
    metadata: cleanMetadata(row.metadata),
    createdAt: cleanString(row.createdAt),
  });
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  const pruned = Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => {
      if (entryValue === undefined || entryValue === null) {
        return false;
      }
      if (Array.isArray(entryValue)) {
        return entryValue.length > 0;
      }
      if (typeof entryValue === "object") {
        return Object.keys(entryValue).length > 0;
      }
      return true;
    }),
  );
  return pruned as T;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compact(parts: Array<string | undefined | null | false>, separator: string): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(separator);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) {
      return cleaned;
    }
  }
  return undefined;
}

function hasAnyString(...values: unknown[]): boolean {
  return values.some((value) => cleanString(value) !== undefined);
}

function formatPages(pageNumber?: number | null, pageEnd?: number | null): string | undefined {
  if (!pageNumber) {
    return undefined;
  }
  if (pageEnd && pageEnd > pageNumber) {
    return `pp. ${pageNumber}-${pageEnd}`;
  }
  return `p. ${pageNumber}`;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatQuantity(value?: number | null, unit?: string | null): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return compact([formatNumber(value), cleanString(unit)], " ");
}

function formatRate(value?: number | null, unit?: string | null): string | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return undefined;
  }
  return unit ? `${formatNumber(value)}/${unit}` : formatNumber(value);
}

function appendDetail(source: string | undefined, ...details: Array<string | undefined>): string {
  const detail = firstString(...details);
  if (!source) {
    return detail ?? "";
  }
  return detail ? `${source} - ${detail}` : source;
}

function appendLabeled(label: string, body: string | undefined, ...details: Array<string | undefined>): string {
  const detail = firstString(...details);
  if (!body && !detail) {
    return "";
  }
  if (!body) {
    return `${label} ${detail}`;
  }
  return detail ? `${label} ${body} - ${detail}` : `${label} ${body}`;
}

function idSuffix(id?: string | null): string | undefined {
  return id ? `#${id}` : undefined;
}

function createKindCounter(): Record<EstimateEvidenceKind, number> {
  return Object.fromEntries(ESTIMATE_EVIDENCE_KINDS.map((kind) => [kind, 0])) as Record<EstimateEvidenceKind, number>;
}

export function normalizeEstimateEvidence(row: EstimateEvidence): NormalizedEstimateEvidence {
  const common = normalizeCommon(row);

  switch (row.kind) {
    case "document_page": {
      const pageNumber = cleanPageNumber(row.pageNumber);
      return pruneUndefined({
        ...common,
        kind: row.kind,
        sourceDocumentId: cleanString(row.sourceDocumentId),
        documentId: cleanString(row.documentId),
        documentName: cleanString(row.documentName),
        fileName: cleanString(row.fileName),
        pageNumber,
        pageEnd: cleanPageEnd(row.pageEnd, pageNumber),
        sectionTitle: cleanString(row.sectionTitle),
      }) as DocumentPageEstimateEvidence;
    }
    case "document_chunk": {
      const pageNumber = cleanPageNumber(row.pageNumber);
      return pruneUndefined({
        ...common,
        kind: row.kind,
        sourceDocumentId: cleanString(row.sourceDocumentId),
        documentId: cleanString(row.documentId),
        chunkId: cleanString(row.chunkId),
        documentName: cleanString(row.documentName),
        fileName: cleanString(row.fileName),
        pageNumber,
        pageEnd: cleanPageEnd(row.pageEnd, pageNumber),
        sectionTitle: cleanString(row.sectionTitle),
      }) as DocumentChunkEstimateEvidence;
    }
    case "knowledge_book":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        bookId: cleanString(row.bookId),
        bookName: cleanString(row.bookName),
        pageNumber: cleanPageNumber(row.pageNumber),
        sectionTitle: cleanString(row.sectionTitle),
      }) as KnowledgeBookEstimateEvidence;
    case "knowledge_table":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        bookId: cleanString(row.bookId),
        bookName: cleanString(row.bookName),
        tableId: cleanString(row.tableId),
        tableName: cleanString(row.tableName),
        pageNumber: cleanPageNumber(row.pageNumber),
        rowKey: cleanString(row.rowKey),
        rowLabel: cleanString(row.rowLabel),
      }) as KnowledgeTableEstimateEvidence;
    case "knowledge_page":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        bookId: cleanString(row.bookId),
        bookName: cleanString(row.bookName),
        documentId: cleanString(row.documentId),
        documentTitle: cleanString(row.documentTitle),
        pageId: cleanString(row.pageId),
        pageTitle: cleanString(row.pageTitle),
        pageNumber: cleanPageNumber(row.pageNumber),
        sectionTitle: cleanString(row.sectionTitle),
      }) as KnowledgePageEstimateEvidence;
    case "dataset_row":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        datasetId: cleanString(row.datasetId),
        datasetName: cleanString(row.datasetName),
        rowId: cleanString(row.rowId),
        rowLabel: cleanString(row.rowLabel),
        fieldKey: cleanString(row.fieldKey),
        fieldLabel: cleanString(row.fieldLabel),
      }) as DatasetRowEstimateEvidence;
    case "web_url":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        url: cleanString(row.url),
        title: cleanString(row.title),
        publisher: cleanString(row.publisher),
        accessedAt: cleanString(row.accessedAt),
      }) as WebUrlEstimateEvidence;
    case "takeoff_annotation":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        annotationId: cleanString(row.annotationId),
        documentId: cleanString(row.documentId),
        documentName: cleanString(row.documentName),
        pageNumber: cleanPageNumber(row.pageNumber),
        annotationLabel: cleanString(row.annotationLabel),
        quantityField: cleanString(row.quantityField),
        measurement: cleanMeasurement(row.measurement),
      }) as TakeoffAnnotationEstimateEvidence;
    case "takeoff_link":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        takeoffLinkId: cleanString(row.takeoffLinkId),
        annotationId: cleanString(row.annotationId),
        annotationLabel: cleanString(row.annotationLabel),
        quantityField: cleanString(row.quantityField),
        multiplier: cleanNumber(row.multiplier),
        derivedQuantity: cleanNumber(row.derivedQuantity),
        uom: cleanString(row.uom),
      }) as TakeoffLinkEstimateEvidence;
    case "model_quantity":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        aiRunId: cleanString(row.aiRunId),
        model: cleanString(row.model),
        quantity: cleanNumber(row.quantity),
        uom: cleanString(row.uom),
        expression: cleanString(row.expression),
        rationale: cleanString(row.rationale),
      }) as ModelQuantityEstimateEvidence;
    case "model_link":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        aiRunId: cleanString(row.aiRunId),
        model: cleanString(row.model),
        linkId: cleanString(row.linkId),
        targetType: cleanString(row.targetType),
        targetId: cleanString(row.targetId),
        title: cleanString(row.title),
        url: cleanString(row.url),
        rationale: cleanString(row.rationale),
      }) as ModelLinkEstimateEvidence;
    case "assumption":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        statement: cleanString(row.statement),
        status: cleanString(row.status),
        owner: cleanString(row.owner),
      }) as AssumptionEstimateEvidence;
    case "correction_factor":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        factorName: cleanString(row.factorName),
        factorValue: cleanNumber(row.factorValue),
        operation: cleanString(row.operation),
        basis: cleanString(row.basis),
      }) as CorrectionFactorEstimateEvidence;
    case "rate_schedule_item":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        rateScheduleId: cleanString(row.rateScheduleId),
        rateScheduleName: cleanString(row.rateScheduleName),
        rateScheduleItemId: cleanString(row.rateScheduleItemId),
        itemCode: cleanString(row.itemCode),
        itemName: cleanString(row.itemName),
        tierId: cleanString(row.tierId),
        tierName: cleanString(row.tierName),
        rate: cleanNumber(row.rate),
        costRate: cleanNumber(row.costRate),
        unit: cleanString(row.unit),
      }) as RateScheduleItemEstimateEvidence;
    case "catalog_item":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        catalogId: cleanString(row.catalogId),
        catalogName: cleanString(row.catalogName),
        catalogItemId: cleanString(row.catalogItemId),
        itemCode: cleanString(row.itemCode),
        itemName: cleanString(row.itemName),
        unit: cleanString(row.unit),
        unitCost: cleanNumber(row.unitCost),
        unitPrice: cleanNumber(row.unitPrice),
      }) as CatalogItemEstimateEvidence;
    case "manual_note":
      return pruneUndefined({
        ...common,
        kind: row.kind,
        text: cleanString(row.text),
        author: cleanString(row.author),
      }) as ManualNoteEstimateEvidence;
  }
}

export function normalizeEstimateEvidenceRows(rows: readonly EstimateEvidence[]): NormalizedEstimateEvidence[] {
  return rows.map((row) => normalizeEstimateEvidence(row));
}

export function getEstimateEvidenceFacets(row: EstimateEvidence): EstimateEvidenceCoverageFacet[] {
  const normalized = normalizeEstimateEvidence(row);
  return normalized.facets?.length ? normalized.facets : ESTIMATE_EVIDENCE_KIND_FACETS[normalized.kind];
}

export function renderEstimateEvidenceSourceNote(row: EstimateEvidence): string {
  const evidence = normalizeEstimateEvidence(row);
  const generalDetail = firstString(evidence.excerpt, evidence.note);

  switch (evidence.kind) {
    case "document_page": {
      const source = firstString(evidence.fileName, evidence.documentName, evidence.sourceDocumentId, evidence.documentId);
      const location = compact([formatPages(evidence.pageNumber, evidence.pageEnd), evidence.sectionTitle], ", ");
      return appendDetail(compact([source, location], " "), generalDetail);
    }
    case "document_chunk": {
      const source = firstString(evidence.fileName, evidence.documentName, evidence.sourceDocumentId, evidence.documentId);
      const location = compact([formatPages(evidence.pageNumber, evidence.pageEnd), evidence.sectionTitle, idSuffix(evidence.chunkId)], ", ");
      return appendDetail(compact([source, location], " "), generalDetail);
    }
    case "knowledge_book": {
      const source = firstString(evidence.bookName, evidence.bookId);
      const location = compact([formatPages(evidence.pageNumber), evidence.sectionTitle], ", ");
      return appendLabeled("Knowledge book:", compact([source, location], " "), generalDetail);
    }
    case "knowledge_table": {
      const source = firstString(evidence.tableName, evidence.tableId);
      const book = firstString(evidence.bookName, evidence.bookId);
      const row = firstString(evidence.rowLabel, evidence.rowKey);
      const location = compact([book, formatPages(evidence.pageNumber), row ? `row ${row}` : undefined], ", ");
      return appendLabeled("Knowledge table:", compact([source, location], " "), generalDetail);
    }
    case "knowledge_page": {
      const source = firstString(evidence.pageTitle, evidence.documentTitle, evidence.bookName, evidence.pageId, evidence.documentId, evidence.bookId);
      const location = compact([formatPages(evidence.pageNumber), evidence.sectionTitle], ", ");
      return appendLabeled("Knowledge page:", compact([source, location], " "), generalDetail);
    }
    case "dataset_row": {
      const source = firstString(evidence.datasetName, evidence.datasetId);
      const rowLabel = firstString(evidence.rowLabel, evidence.rowId);
      const field = firstString(evidence.fieldLabel, evidence.fieldKey);
      const location = compact([rowLabel ? `row ${rowLabel}` : undefined, field], ", ");
      return appendLabeled("Dataset:", compact([source, location], " "), generalDetail);
    }
    case "web_url": {
      const source = firstString(evidence.title, evidence.url);
      const publisher = evidence.publisher ? `${evidence.publisher}` : undefined;
      const url = evidence.title && evidence.url ? `(${evidence.url})` : undefined;
      const accessed = evidence.accessedAt ? `accessed ${evidence.accessedAt}` : undefined;
      return appendLabeled("Web:", compact([source, publisher, url, accessed], " "), generalDetail);
    }
    case "takeoff_annotation": {
      const source = firstString(evidence.annotationLabel, evidence.annotationId);
      const document = firstString(evidence.documentName, evidence.documentId);
      const measurement = formatTakeoffMeasurement(evidence.measurement, evidence.quantityField);
      const location = compact([document, formatPages(evidence.pageNumber), measurement], ", ");
      return appendLabeled("Takeoff:", compact([source, location], " "), generalDetail);
    }
    case "takeoff_link": {
      const source = firstString(evidence.annotationLabel, evidence.annotationId, evidence.takeoffLinkId);
      const multiplier = evidence.multiplier != null ? `x ${formatNumber(evidence.multiplier)}` : undefined;
      const derived = formatQuantity(evidence.derivedQuantity, evidence.uom);
      const quantity = derived ? `= ${derived}` : undefined;
      const detail = compact([evidence.quantityField, multiplier, quantity], " ");
      return appendLabeled("Takeoff link:", compact([source, detail], " "), generalDetail);
    }
    case "model_quantity": {
      const quantity = formatQuantity(evidence.quantity, evidence.uom);
      const run = firstString(evidence.model, evidence.aiRunId);
      const source = compact([quantity, run ? `from ${run}` : undefined], " ");
      return appendLabeled("Model quantity:", source, firstString(evidence.rationale, evidence.expression, generalDetail));
    }
    case "model_link": {
      const target = compact([evidence.targetType, evidence.targetId], " ");
      const source = firstString(evidence.title, target, evidence.linkId, evidence.url, evidence.aiRunId, evidence.model);
      return appendLabeled("Model link:", source, firstString(evidence.rationale, generalDetail));
    }
    case "assumption": {
      const status = evidence.status ? `(${evidence.status})` : undefined;
      return appendLabeled("Assumption:", compact([firstString(evidence.statement, evidence.label), status], " "), generalDetail);
    }
    case "correction_factor": {
      const factor = evidence.factorValue != null ? formatNumber(evidence.factorValue) : undefined;
      const operation = evidence.operation ? `${evidence.operation} ${factor ?? ""}`.trim() : factor;
      return appendLabeled("Correction factor:", compact([firstString(evidence.factorName, evidence.label), operation], " "), firstString(evidence.basis, generalDetail));
    }
    case "rate_schedule_item": {
      const schedule = firstString(evidence.rateScheduleName, evidence.rateScheduleId);
      const item = firstString(evidence.itemName, evidence.itemCode, evidence.rateScheduleItemId);
      const tier = firstString(evidence.tierName, evidence.tierId);
      const rate = formatRate(evidence.rate, evidence.unit);
      return appendLabeled("Rate schedule:", compact([schedule, item, tier, rate ? `rate ${rate}` : undefined], ", "), generalDetail);
    }
    case "catalog_item": {
      const catalog = firstString(evidence.catalogName, evidence.catalogId);
      const item = firstString(evidence.itemName, evidence.itemCode, evidence.catalogItemId);
      const cost = formatRate(evidence.unitCost, evidence.unit);
      const price = formatRate(evidence.unitPrice, evidence.unit);
      return appendLabeled("Catalog:", compact([catalog, item, cost ? `cost ${cost}` : undefined, price ? `price ${price}` : undefined], ", "), generalDetail);
    }
    case "manual_note": {
      const text = firstString(evidence.text, evidence.note, evidence.excerpt, evidence.label);
      const author = evidence.author ? `(${evidence.author})` : undefined;
      return appendLabeled("Manual note:", compact([text, author], " "));
    }
  }
}

export function renderEstimateEvidenceSourceNotes(
  rows: readonly EstimateEvidence[],
  options: RenderEstimateEvidenceSourceNotesOptions = {},
): string {
  const separator = options.separator ?? "; ";
  const maxNotes = options.maxNotes ?? Number.POSITIVE_INFINITY;
  const notes = unique(rows.map((row) => renderEstimateEvidenceSourceNote(row)).filter(Boolean));
  return notes.slice(0, maxNotes).join(separator);
}

function formatTakeoffMeasurement(
  measurement: EstimateEvidenceMeasurement | null | undefined,
  quantityField?: string | null,
): string | undefined {
  if (!measurement) {
    return undefined;
  }

  const field = quantityField ?? "value";
  const rawValue =
    field === "area"
      ? measurement.area
      : field === "volume"
        ? measurement.volume
        : field === "count"
          ? measurement.count
          : measurement.value;

  return formatQuantity(rawValue, measurement.unit);
}

export function isEmptyEstimateEvidence(row: EstimateEvidence): boolean {
  return renderEstimateEvidenceSourceNote(row).length === 0;
}

export function validateEstimateEvidence(row: EstimateEvidence): EstimateEvidenceValidationIssue[] {
  const evidence = normalizeEstimateEvidence(row);
  const issues: EstimateEvidenceValidationIssue[] = [];

  const addIssue = (severity: EstimateEvidenceValidationSeverity, code: string, message: string) => {
    issues.push({
      severity,
      code,
      message,
      evidenceId: evidence.id ?? undefined,
      worksheetItemId: evidence.worksheetItemId ?? undefined,
      kind: evidence.kind,
    });
  };

  if (isEmptyEstimateEvidence(evidence)) {
    addIssue("error", "empty_evidence", "Evidence row has no source detail to render.");
    return issues;
  }

  if (evidence.confidence != null && evidence.confidence < 0.35) {
    addIssue("warning", "low_confidence", "Evidence confidence is below 0.35.");
  }

  switch (evidence.kind) {
    case "document_page":
      if (!hasAnyString(evidence.sourceDocumentId, evidence.documentId, evidence.fileName, evidence.documentName)) {
        addIssue("warning", "missing_document_reference", "Document page evidence should include a document id or name.");
      }
      if (!evidence.pageNumber) {
        addIssue("warning", "missing_page", "Document page evidence should include a page number.");
      }
      break;
    case "document_chunk":
      if (!hasAnyString(evidence.chunkId, evidence.excerpt)) {
        addIssue("warning", "missing_chunk_reference", "Document chunk evidence should include a chunk id or excerpt.");
      }
      if (!hasAnyString(evidence.sourceDocumentId, evidence.documentId, evidence.fileName, evidence.documentName)) {
        addIssue("warning", "missing_document_reference", "Document chunk evidence should include a document id or name.");
      }
      break;
    case "knowledge_book":
      if (!hasAnyString(evidence.bookId, evidence.bookName)) {
        addIssue("warning", "missing_book_reference", "Knowledge book evidence should include a book id or name.");
      }
      if (!hasAnyString(evidence.sectionTitle, evidence.excerpt) && !evidence.pageNumber) {
        addIssue("warning", "broad_knowledge_reference", "Knowledge book evidence is broad; add a page, section, or excerpt when possible.");
      }
      break;
    case "knowledge_table":
      if (!hasAnyString(evidence.tableId, evidence.tableName)) {
        addIssue("warning", "missing_table_reference", "Knowledge table evidence should include a table id or name.");
      }
      if (!hasAnyString(evidence.rowKey, evidence.rowLabel, evidence.excerpt)) {
        addIssue("warning", "missing_table_row", "Knowledge table evidence should include a row key, row label, or excerpt.");
      }
      break;
    case "knowledge_page":
      if (!hasAnyString(evidence.pageId, evidence.pageTitle, evidence.documentTitle, evidence.bookName)) {
        addIssue("warning", "missing_knowledge_page_reference", "Knowledge page evidence should include a page, document, or book reference.");
      }
      break;
    case "dataset_row":
      if (!hasAnyString(evidence.datasetId, evidence.datasetName)) {
        addIssue("warning", "missing_dataset_reference", "Dataset row evidence should include a dataset id or name.");
      }
      if (!hasAnyString(evidence.rowId, evidence.rowLabel, evidence.excerpt)) {
        addIssue("warning", "missing_dataset_row", "Dataset row evidence should include a row id, row label, or excerpt.");
      }
      break;
    case "web_url":
      if (!evidence.url) {
        addIssue("error", "missing_url", "Web evidence must include a URL.");
      } else if (!isHttpUrl(evidence.url)) {
        addIssue("warning", "non_http_url", "Web evidence URL should be an absolute http or https URL.");
      }
      if (!hasAnyString(evidence.title, evidence.excerpt, evidence.note)) {
        addIssue("warning", "missing_web_context", "Web evidence should include a title, note, or excerpt.");
      }
      break;
    case "takeoff_annotation":
      if (!evidence.annotationId) {
        addIssue("warning", "missing_annotation_reference", "Takeoff annotation evidence should include an annotation id.");
      }
      if (!evidence.measurement && !hasAnyString(evidence.excerpt, evidence.note)) {
        addIssue("warning", "missing_measurement", "Takeoff annotation evidence should include a measurement or explanatory note.");
      }
      break;
    case "takeoff_link":
      if (!hasAnyString(evidence.takeoffLinkId, evidence.annotationId)) {
        addIssue("warning", "missing_takeoff_link_reference", "Takeoff link evidence should include a link id or annotation id.");
      }
      if (!evidence.worksheetItemId) {
        addIssue("warning", "missing_worksheet_item", "Takeoff link evidence should include the worksheet item it supports.");
      }
      if (evidence.derivedQuantity === undefined) {
        addIssue("warning", "missing_derived_quantity", "Takeoff link evidence should include the derived quantity.");
      }
      break;
    case "model_quantity":
      if (evidence.quantity === undefined && !evidence.expression) {
        addIssue("warning", "missing_model_quantity", "Model quantity evidence should include a numeric quantity or expression.");
      }
      if (!hasAnyString(evidence.aiRunId, evidence.model)) {
        addIssue("warning", "missing_model_reference", "Model quantity evidence should include a model or AI run id.");
      }
      break;
    case "model_link":
      if (!hasAnyString(evidence.linkId, evidence.targetId, evidence.url, evidence.aiRunId)) {
        addIssue("warning", "missing_model_link_reference", "Model link evidence should include a link, target, URL, or AI run id.");
      }
      break;
    case "assumption":
      if (!hasAnyString(evidence.statement, evidence.note, evidence.excerpt, evidence.label)) {
        addIssue("error", "missing_assumption", "Assumption evidence must include the assumption text.");
      }
      if (!evidence.status) {
        addIssue("warning", "missing_assumption_status", "Assumption evidence should include review status.");
      }
      break;
    case "correction_factor":
      if (!hasAnyString(evidence.factorName, evidence.label)) {
        addIssue("warning", "missing_factor_name", "Correction factor evidence should include a factor name.");
      }
      if (evidence.factorValue === undefined) {
        addIssue("warning", "missing_factor_value", "Correction factor evidence should include a numeric factor value.");
      }
      if (!hasAnyString(evidence.basis, evidence.note, evidence.excerpt)) {
        addIssue("warning", "missing_factor_basis", "Correction factor evidence should include a basis, note, or excerpt.");
      }
      break;
    case "rate_schedule_item":
      if (!hasAnyString(evidence.rateScheduleItemId, evidence.itemName, evidence.itemCode)) {
        addIssue("warning", "missing_rate_item", "Rate schedule evidence should include an item id, code, or name.");
      }
      if (evidence.rate === undefined && evidence.costRate === undefined) {
        addIssue("warning", "missing_rate_value", "Rate schedule evidence should include a rate or cost rate.");
      }
      break;
    case "catalog_item":
      if (!hasAnyString(evidence.catalogItemId, evidence.itemName, evidence.itemCode)) {
        addIssue("warning", "missing_catalog_item", "Catalog evidence should include an item id, code, or name.");
      }
      if (evidence.unitCost === undefined && evidence.unitPrice === undefined) {
        addIssue("warning", "missing_catalog_price", "Catalog evidence should include unit cost or unit price.");
      }
      break;
    case "manual_note":
      if (!hasAnyString(evidence.text, evidence.note, evidence.excerpt, evidence.label)) {
        addIssue("error", "missing_manual_note", "Manual note evidence must include note text.");
      }
      break;
  }

  return issues;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function scoreEstimateEvidenceRow(row: EstimateEvidence): EstimateEvidenceRowScore {
  const evidence = normalizeEstimateEvidence(row);
  const issues = validateEstimateEvidence(evidence);
  const hasError = issues.some((issue) => issue.severity === "error");
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  if (hasError || isEmptyEstimateEvidence(evidence)) {
    return {
      score: 0,
      status: "empty",
      facets: getEstimateEvidenceFacets(evidence),
      issues,
    };
  }

  const baseScore = ESTIMATE_EVIDENCE_KIND_BASE_SCORES[evidence.kind];
  const confidenceFactor = evidence.confidence == null ? 1 : 0.65 + evidence.confidence * 0.35;
  const warningPenalty = Math.max(0.55, 1 - warningCount * 0.15);
  const weight = evidence.weight ?? 1;
  const score = roundScore(clamp(baseScore * confidenceFactor * warningPenalty * weight, 0, 1));

  return {
    score,
    status: score >= 0.8 ? "strong" : score >= 0.55 ? "supporting" : "weak",
    facets: getEstimateEvidenceFacets(evidence),
    issues,
  };
}

export function isWeakEstimateEvidence(row: EstimateEvidence, threshold = 0.55): boolean {
  return scoreEstimateEvidenceRow(row).score < threshold;
}

export function scoreEstimateEvidenceCoverage(
  rows: readonly EstimateEvidence[],
  options: EstimateEvidenceCoverageOptions = {},
): EstimateEvidenceCoverageScore {
  const expectedFacets = options.expectedFacets?.length
    ? unique(options.expectedFacets.filter((facet) => VALID_FACETS.has(facet)))
    : DEFAULT_ESTIMATE_EVIDENCE_EXPECTED_FACETS;
  const normalizedRows = normalizeEstimateEvidenceRows(rows);
  const rowScores = normalizedRows.map((row) => ({
    row,
    rowScore: scoreEstimateEvidenceRow(row),
  }));
  const byKind = createKindCounter();
  const issues = rowScores.flatMap((entry) => entry.rowScore.issues);
  const facetScores: Partial<Record<EstimateEvidenceCoverageFacet, number>> = {};

  for (const row of normalizedRows) {
    byKind[row.kind] += 1;
  }

  for (const facet of expectedFacets) {
    const supportingScores = rowScores
      .filter((entry) => entry.rowScore.score > 0 && entry.rowScore.facets.includes(facet))
      .map((entry) => entry.rowScore.score)
      .sort((left, right) => right - left);
    const best = supportingScores[0] ?? 0;
    const corroborationBonus = Math.min(0.12, Math.max(0, supportingScores.length - 1) * 0.04);
    facetScores[facet] = roundScore(clamp(best + corroborationBonus, 0, 1));
  }

  const presentFacets = expectedFacets.filter((facet) => (facetScores[facet] ?? 0) > 0);
  const missingFacets = expectedFacets.filter((facet) => (facetScores[facet] ?? 0) === 0);
  const expectedScore = expectedFacets.length
    ? expectedFacets.reduce((sum, facet) => sum + (facetScores[facet] ?? 0), 0) / expectedFacets.length
    : 0;
  const extraFacetBonus = countExtraFacetBonus(rowScores, expectedFacets);
  const score = normalizedRows.length === 0 ? 0 : roundScore(clamp(expectedScore + extraFacetBonus, 0, 1));

  for (const facet of missingFacets) {
    issues.push({
      severity: "warning",
      code: "missing_evidence_facet",
      message: `Missing ${facet} evidence.`,
    });
  }

  if (normalizedRows.length === 0) {
    issues.push({
      severity: "error",
      code: "empty_evidence_set",
      message: "No evidence rows were provided.",
    });
  }

  return {
    score,
    status: coverageStatus(score, normalizedRows.length),
    expectedFacets,
    presentFacets,
    missingFacets,
    facetScores,
    evidenceCount: normalizedRows.length,
    strongEvidenceCount: rowScores.filter((entry) => entry.rowScore.status === "strong").length,
    directEvidenceCount: rowScores.filter((entry) => entry.rowScore.score >= 0.8).length,
    weakEvidenceCount: rowScores.filter((entry) => entry.rowScore.status === "weak").length,
    emptyEvidenceCount: rowScores.filter((entry) => entry.rowScore.status === "empty").length,
    byKind,
    issues,
  };
}

function countExtraFacetBonus(
  rowScores: Array<{ row: EstimateEvidence; rowScore: EstimateEvidenceRowScore }>,
  expectedFacets: EstimateEvidenceCoverageFacet[],
): number {
  const expected = new Set(expectedFacets);
  const extraFacets = new Set<EstimateEvidenceCoverageFacet>();

  for (const entry of rowScores) {
    if (entry.rowScore.score <= 0) {
      continue;
    }
    for (const facet of entry.rowScore.facets) {
      if (!expected.has(facet)) {
        extraFacets.add(facet);
      }
    }
  }

  return Math.min(0.08, extraFacets.size * 0.04);
}

function coverageStatus(score: number, rowCount: number): EstimateEvidenceCoverageStatus {
  if (rowCount === 0 || score === 0) {
    return "empty";
  }
  if (score < 0.35) {
    return "weak";
  }
  if (score < 0.7) {
    return "partial";
  }
  if (score < 0.85) {
    return "covered";
  }
  return "strong";
}

export function groupEstimateEvidenceByWorksheetItemId(
  rows: readonly EstimateEvidence[],
  options: Pick<EstimateEvidenceCoverageOptions, "unassignedKey"> = {},
): Record<string, NormalizedEstimateEvidence[]> {
  const unassignedKey = options.unassignedKey ?? UNASSIGNED_WORKSHEET_ITEM_ID;
  const groups: Record<string, NormalizedEstimateEvidence[]> = {};

  for (const row of normalizeEstimateEvidenceRows(rows)) {
    const key = row.worksheetItemId ?? unassignedKey;
    groups[key] ??= [];
    groups[key].push(row);
  }

  return groups;
}

export function scoreEstimateEvidenceCoverageByWorksheetItemId(
  rows: readonly EstimateEvidence[],
  options: EstimateEvidenceCoverageOptions = {},
): Record<string, EstimateEvidenceCoverageScore> {
  const grouped = groupEstimateEvidenceByWorksheetItemId(rows, options);
  return Object.fromEntries(
    Object.entries(grouped).map(([worksheetItemId, evidenceRows]) => [
      worksheetItemId,
      scoreEstimateEvidenceCoverage(evidenceRows, options),
    ]),
  );
}

export function validateEstimateEvidenceRows(
  rows: readonly EstimateEvidence[],
  options: EstimateEvidenceCoverageOptions = {},
): EstimateEvidenceValidationIssue[] {
  return scoreEstimateEvidenceCoverage(rows, options).issues;
}

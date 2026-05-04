export enum SmartImportSourceType {
  Csv = "csv",
  Excel = "excel",
  Clipboard = "clipboard",
  Manual = "manual",
  Unknown = "unknown",
}

export type SmartImportCellValue = string | number | boolean | Date | null;
export type SmartImportRawRow = Record<string, unknown> | readonly unknown[];
export type SmartImportReviewStatus = "pending" | "accepted" | "rejected";
export type SmartImportReviewAction = "accept" | "reject" | "reset";
export type SmartImportIssueSeverity = "error" | "warning" | "info";
export type SmartImportFieldMappingStatus =
  | "mapped"
  | "missing"
  | "defaulted"
  | "coerced"
  | "invalid"
  | "unmapped";

export type SmartImportEstimateField =
  | "phase"
  | "category"
  | "entityType"
  | "entityName"
  | "description"
  | "quantity"
  | "uom"
  | "unitCost"
  | "markup"
  | "unitPrice"
  | "sourceNotes";

export interface SmartImportRawRowReference {
  sourceType: SmartImportSourceType;
  sourceId?: string;
  fileName?: string;
  sheetName?: string;
  rowIndex: number;
  rowNumber: number;
}

export interface SmartImportNormalizedCell {
  header: string;
  columnIndex: number;
  rawValue: unknown;
  value: SmartImportCellValue;
}

export interface SmartImportNormalizedRow {
  source: SmartImportRawRowReference;
  rawRow: SmartImportRawRow;
  headers: string[];
  cells: SmartImportNormalizedCell[];
  valuesByHeader: Record<string, SmartImportCellValue>;
}

export interface NormalizeSmartImportRowsOptions {
  sourceType?: SmartImportSourceType;
  sourceId?: string;
  fileName?: string;
  sheetName?: string;
  headers?: readonly string[];
  headerRowIndex?: number;
  firstDataRowIndex?: number;
  includeBlankRows?: boolean;
}

export interface SmartImportEstimateFields {
  phase: string;
  category: string;
  entityType: string;
  entityName: string;
  description: string;
  quantity: number;
  uom: string;
  unitCost: number;
  markup: number;
  unitPrice: number;
  sourceNotes: string;
}

export interface SmartImportSourceColumnRef {
  header?: string;
  columnIndex?: number;
}

export type SmartImportFieldMap = Partial<
  Record<SmartImportEstimateField, string | number | SmartImportSourceColumnRef>
>;

export type SmartImportFieldAliases = Partial<Record<SmartImportEstimateField, readonly string[]>>;

export interface SmartImportFieldMappingDiagnostic {
  targetField: SmartImportEstimateField;
  sourceHeader?: string;
  sourceColumnIndex?: number;
  rawValue?: unknown;
  normalizedValue?: SmartImportCellValue;
  confidence: number;
  status: SmartImportFieldMappingStatus;
  messages: string[];
}

export interface SmartImportValidationIssue {
  severity: SmartImportIssueSeverity;
  code: string;
  message: string;
  field?: SmartImportEstimateField;
  sourceHeader?: string;
  sourceColumnIndex?: number;
  blocking: boolean;
}

export interface SmartImportDedupSignature {
  key: string;
  parts: Record<string, string>;
}

export interface SmartImportDuplicateInfo {
  signature: string;
  groupId: string;
  groupSize: number;
  duplicateOf?: string;
  duplicateRowIds: string[];
}

export interface SmartImportReviewTransition {
  action: SmartImportReviewAction;
  from: SmartImportReviewStatus;
  to: SmartImportReviewStatus;
  at?: string;
  by?: string;
  reason?: string;
}

export interface SmartImportReviewState {
  status: SmartImportReviewStatus;
  reason?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  history: SmartImportReviewTransition[];
}

export interface StagedEstimateRow {
  id: string;
  importBatchId?: string;
  fields: SmartImportEstimateFields;
  source: SmartImportRawRowReference;
  rawRow: SmartImportRawRow;
  diagnostics: SmartImportFieldMappingDiagnostic[];
  issues: SmartImportValidationIssue[];
  confidence: number;
  duplicateSignature: SmartImportDedupSignature;
  duplicate?: SmartImportDuplicateInfo;
  review: SmartImportReviewState;
}

export interface CreateStagedEstimateRowOptions {
  id?: string;
  importBatchId?: string;
  fieldMap?: SmartImportFieldMap;
  aliases?: SmartImportFieldAliases;
  defaults?: Partial<SmartImportEstimateFields>;
}

export interface SmartImportTransitionOptions {
  at?: string;
  by?: string;
  reason?: string;
  allowAcceptWithErrors?: boolean;
}

export interface SmartImportIssueCounts {
  error: number;
  warning: number;
  info: number;
}

export interface SmartImportBatchSummary {
  totalRows: number;
  statusCounts: Record<SmartImportReviewStatus, number>;
  issueCounts: SmartImportIssueCounts;
  rowsWithErrors: number;
  rowsWithWarnings: number;
  duplicateGroups: number;
  duplicateRows: number;
  averageConfidence: number;
  minConfidence: number;
  maxConfidence: number;
  sourceCounts: Partial<Record<SmartImportSourceType, number>>;
  importableRows: number;
}

const ESTIMATE_FIELDS: SmartImportEstimateField[] = [
  "phase",
  "category",
  "entityType",
  "entityName",
  "description",
  "quantity",
  "uom",
  "unitCost",
  "markup",
  "unitPrice",
  "sourceNotes",
];

const NUMERIC_FIELDS = new Set<SmartImportEstimateField>([
  "quantity",
  "unitCost",
  "markup",
  "unitPrice",
]);

const DEFAULT_ALIASES: Record<SmartImportEstimateField, readonly string[]> = {
  phase: ["phase", "phase name", "area", "location"],
  category: ["category", "cost type", "type", "item type", "class"],
  entityType: ["entity type", "item type", "line type", "resource type"],
  entityName: ["item", "item name", "name", "entity", "entity name", "material", "labour", "labor"],
  description: ["description", "item description", "scope", "work description"],
  quantity: ["quantity", "qty", "amount", "count"],
  uom: ["uom", "unit", "unit of measure", "units"],
  unitCost: ["unit cost", "cost", "cost each", "each cost", "unit rate"],
  markup: ["markup", "markup percent", "markup %", "margin", "margin %"],
  unitPrice: ["unit price", "price", "sell price", "sell", "rate"],
  sourceNotes: ["notes", "source notes", "comment", "comments"],
};

const DEFAULT_FIELDS: SmartImportEstimateFields = {
  phase: "",
  category: "Material",
  entityType: "Material",
  entityName: "",
  description: "",
  quantity: 1,
  uom: "EA",
  unitCost: 0,
  markup: 0,
  unitPrice: 0,
  sourceNotes: "",
};

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function roundConfidence(value: number): number {
  return Math.round(clampConfidence(value) * 1000) / 1000;
}

function normalizeText(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeIdentifier(value: unknown): string {
  return normalizeText(value)
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[%]/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeSignaturePart(value: unknown): string {
  return normalizeIdentifier(value).replace(/\s+/g, "");
}

function normalizeCellValue(value: unknown): SmartImportCellValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function makeUniqueHeaders(headers: readonly unknown[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = normalizeText(header).replace(/^\uFEFF/, "") || `Column ${index + 1}`;
    const key = normalizeIdentifier(base) || `column ${index + 1}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    return count === 0 ? base : `${base} ${count + 1}`;
  });
}

function getRecordHeaders(rows: readonly SmartImportRawRow[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row)) {
      continue;
    }
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return makeUniqueHeaders(headers);
}

function buildSourceReference(
  rowIndex: number,
  options: NormalizeSmartImportRowsOptions,
): SmartImportRawRowReference {
  return {
    sourceType: options.sourceType ?? SmartImportSourceType.Unknown,
    sourceId: options.sourceId,
    fileName: options.fileName,
    sheetName: options.sheetName,
    rowIndex,
    rowNumber: rowIndex + 1,
  };
}

function getRawCell(row: SmartImportRawRow, header: string, columnIndex: number): unknown {
  if (Array.isArray(row)) {
    return row[columnIndex];
  }
  return (row as Record<string, unknown>)[header];
}

function isBlankNormalizedRow(row: SmartImportNormalizedRow): boolean {
  return row.cells.every((cell) => cell.value === null);
}

export function normalizeSmartImportRows(
  rows: readonly SmartImportRawRow[],
  options: NormalizeSmartImportRowsOptions = {},
): SmartImportNormalizedRow[] {
  if (rows.length === 0) {
    return [];
  }

  const rowsAreArrays = rows.every((row) => Array.isArray(row));
  const headers = options.headers
    ? makeUniqueHeaders(options.headers)
    : rowsAreArrays
      ? makeUniqueHeaders(rows[options.headerRowIndex ?? 0] ?? [])
      : getRecordHeaders(rows);

  const firstDataRowIndex = rowsAreArrays
    ? options.firstDataRowIndex ?? (options.headers ? 0 : (options.headerRowIndex ?? 0) + 1)
    : 0;

  const normalized: SmartImportNormalizedRow[] = [];
  for (let rowIndex = firstDataRowIndex; rowIndex < rows.length; rowIndex++) {
    const rawRow = rows[rowIndex];
    if (!rawRow) {
      continue;
    }

    const cells = headers.map((header, columnIndex) => {
      const rawValue = getRawCell(rawRow, header, columnIndex);
      return {
        header,
        columnIndex,
        rawValue,
        value: normalizeCellValue(rawValue),
      };
    });

    const valuesByHeader: Record<string, SmartImportCellValue> = {};
    for (const cell of cells) {
      valuesByHeader[cell.header] = cell.value;
    }

    const row: SmartImportNormalizedRow = {
      source: buildSourceReference(rowIndex, options),
      rawRow,
      headers,
      cells,
      valuesByHeader,
    };

    if (options.includeBlankRows || !isBlankNormalizedRow(row)) {
      normalized.push(row);
    }
  }

  return normalized;
}

function getMergedAliases(aliases?: SmartImportFieldAliases): Record<SmartImportEstimateField, readonly string[]> {
  const merged = { ...DEFAULT_ALIASES };
  for (const field of ESTIMATE_FIELDS) {
    const customAliases = aliases?.[field];
    if (customAliases?.length) {
      merged[field] = [...customAliases, ...DEFAULT_ALIASES[field]];
    }
  }
  return merged;
}

function toColumnRef(ref: string | number | SmartImportSourceColumnRef | undefined): SmartImportSourceColumnRef | null {
  if (ref === undefined) {
    return null;
  }
  if (typeof ref === "number") {
    return { columnIndex: ref };
  }
  if (typeof ref === "string") {
    return { header: ref };
  }
  return ref;
}

function scoreHeaderMatch(requested: string, candidate: string): number {
  const normalizedRequested = normalizeIdentifier(requested);
  const normalizedCandidate = normalizeIdentifier(candidate);
  if (!normalizedRequested || !normalizedCandidate) {
    return 0;
  }
  if (normalizedRequested === normalizedCandidate) {
    return 1;
  }
  const requestedParts = normalizedRequested.split(" ");
  const candidateParts = normalizedCandidate.split(" ");
  const candidatePartSet = new Set(candidateParts);
  if (requestedParts.every((part) => candidatePartSet.has(part))) {
    return 0.86;
  }
  if (
    normalizedCandidate.startsWith(normalizedRequested) ||
    normalizedCandidate.endsWith(normalizedRequested)
  ) {
    return 0.72;
  }
  return 0;
}

function resolveMappedCell(
  row: SmartImportNormalizedRow,
  field: SmartImportEstimateField,
  fieldMap: SmartImportFieldMap | undefined,
  aliases: Record<SmartImportEstimateField, readonly string[]>,
): { cell: SmartImportNormalizedCell; confidence: number; explicit: boolean } | null {
  const explicitRef = toColumnRef(fieldMap?.[field]);
  if (explicitRef) {
    const explicitCell = explicitRef.columnIndex !== undefined
      ? row.cells.find((cell) => cell.columnIndex === explicitRef.columnIndex)
      : row.cells.find((cell) => normalizeIdentifier(cell.header) === normalizeIdentifier(explicitRef.header));

    return explicitCell ? { cell: explicitCell, confidence: 1, explicit: true } : null;
  }

  const candidates = aliases[field]
    .flatMap((alias) =>
      row.cells.map((cell) => ({
        cell,
        score: scoreHeaderMatch(alias, cell.header),
      })),
    )
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best) {
    return null;
  }

  return {
    cell: best.cell,
    confidence: best.score,
    explicit: false,
  };
}

function coerceNumber(value: SmartImportCellValue): { value: number; valid: boolean; coerced: boolean } {
  if (typeof value === "number") {
    return { value, valid: Number.isFinite(value), coerced: false };
  }
  if (value === null || typeof value === "boolean" || value instanceof Date) {
    return { value: 0, valid: false, coerced: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { value: 0, valid: false, coerced: false };
  }

  const negative = /^\(.+\)$/.test(trimmed);
  const cleaned = trimmed.replace(/[,$%\s]/g, "").replace(/[()]/g, "");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return { value: 0, valid: false, coerced: false };
  }

  return {
    value: negative ? -parsed : parsed,
    valid: true,
    coerced: true,
  };
}

function cellValueToString(value: SmartImportCellValue): string {
  if (value === null) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value).trim();
}

function fieldDefault(
  field: SmartImportEstimateField,
  defaults: Partial<SmartImportEstimateFields>,
  partialFields: Partial<SmartImportEstimateFields>,
): string | number {
  if (defaults[field] !== undefined) {
    return defaults[field]!;
  }
  if (field === "entityType" && partialFields.category) {
    return partialFields.category;
  }
  return DEFAULT_FIELDS[field];
}

function mapField(
  row: SmartImportNormalizedRow,
  field: SmartImportEstimateField,
  options: CreateStagedEstimateRowOptions,
  aliases: Record<SmartImportEstimateField, readonly string[]>,
  partialFields: Partial<SmartImportEstimateFields>,
): { value: string | number; diagnostic: SmartImportFieldMappingDiagnostic } {
  const mapped = resolveMappedCell(row, field, options.fieldMap, aliases);
  const defaultValue = fieldDefault(field, options.defaults ?? {}, partialFields);

  if (!mapped || mapped.cell.value === null) {
    return {
      value: defaultValue,
      diagnostic: {
        targetField: field,
        sourceHeader: mapped?.cell.header,
        sourceColumnIndex: mapped?.cell.columnIndex,
        rawValue: mapped?.cell.rawValue,
        normalizedValue: mapped?.cell.value,
        confidence: 0,
        status: defaultValue === "" ? "missing" : "defaulted",
        messages: [`No source value found for ${field}`],
      },
    };
  }

  if (NUMERIC_FIELDS.has(field)) {
    const coerced = coerceNumber(mapped.cell.value);
    if (!coerced.valid) {
      return {
        value: defaultValue,
        diagnostic: {
          targetField: field,
          sourceHeader: mapped.cell.header,
          sourceColumnIndex: mapped.cell.columnIndex,
          rawValue: mapped.cell.rawValue,
          normalizedValue: mapped.cell.value,
          confidence: 0,
          status: "invalid",
          messages: [`Could not parse ${field} as a number`],
        },
      };
    }

    return {
      value: coerced.value,
      diagnostic: {
        targetField: field,
        sourceHeader: mapped.cell.header,
        sourceColumnIndex: mapped.cell.columnIndex,
        rawValue: mapped.cell.rawValue,
        normalizedValue: mapped.cell.value,
        confidence: roundConfidence(mapped.confidence),
        status: coerced.coerced ? "coerced" : "mapped",
        messages: coerced.coerced ? [`Parsed ${field} from text`] : [],
      },
    };
  }

  return {
    value: cellValueToString(mapped.cell.value),
    diagnostic: {
      targetField: field,
      sourceHeader: mapped.cell.header,
      sourceColumnIndex: mapped.cell.columnIndex,
      rawValue: mapped.cell.rawValue,
      normalizedValue: mapped.cell.value,
      confidence: roundConfidence(mapped.confidence),
      status: mapped.explicit ? "mapped" : "mapped",
      messages: [],
    },
  };
}

function buildValidationIssues(
  fields: SmartImportEstimateFields,
  diagnostics: SmartImportFieldMappingDiagnostic[],
): SmartImportValidationIssue[] {
  const issues: SmartImportValidationIssue[] = [];
  const diagnosticByField = new Map(diagnostics.map((diagnostic) => [diagnostic.targetField, diagnostic]));

  const addIssue = (
    severity: SmartImportIssueSeverity,
    code: string,
    message: string,
    field: SmartImportEstimateField,
  ) => {
    const diagnostic = diagnosticByField.get(field);
    issues.push({
      severity,
      code,
      message,
      field,
      sourceHeader: diagnostic?.sourceHeader,
      sourceColumnIndex: diagnostic?.sourceColumnIndex,
      blocking: severity === "error",
    });
  };

  if (!fields.entityName.trim() && !fields.description.trim()) {
    addIssue("error", "missing_item_identity", "Item name or description is required.", "entityName");
  }
  if (!Number.isFinite(fields.quantity) || fields.quantity <= 0) {
    addIssue("error", "invalid_quantity", "Quantity must be greater than zero.", "quantity");
  }
  if (!fields.uom.trim()) {
    addIssue("warning", "missing_uom", "Unit of measure is missing.", "uom");
  }
  if (fields.unitCost < 0) {
    addIssue("warning", "negative_unit_cost", "Unit cost is negative.", "unitCost");
  }
  if (fields.unitPrice < 0) {
    addIssue("warning", "negative_unit_price", "Unit price is negative.", "unitPrice");
  }

  for (const diagnostic of diagnostics) {
    if (diagnostic.status === "invalid") {
      issues.push({
        severity: NUMERIC_FIELDS.has(diagnostic.targetField) ? "error" : "warning",
        code: `invalid_${diagnostic.targetField}`,
        message: diagnostic.messages[0] ?? `Invalid value for ${diagnostic.targetField}.`,
        field: diagnostic.targetField,
        sourceHeader: diagnostic.sourceHeader,
        sourceColumnIndex: diagnostic.sourceColumnIndex,
        blocking: NUMERIC_FIELDS.has(diagnostic.targetField),
      });
    }
  }

  return issues;
}

export function countSmartImportIssues(issues: readonly SmartImportValidationIssue[]): SmartImportIssueCounts {
  return issues.reduce<SmartImportIssueCounts>(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

export function calculateSmartImportConfidence(
  diagnostics: readonly SmartImportFieldMappingDiagnostic[],
  issues: readonly SmartImportValidationIssue[] = [],
): number {
  const meaningfulDiagnostics = diagnostics.filter((diagnostic) =>
    diagnostic.status === "mapped" ||
    diagnostic.status === "coerced" ||
    diagnostic.status === "defaulted" ||
    diagnostic.status === "invalid"
  );

  const base = meaningfulDiagnostics.length > 0
    ? meaningfulDiagnostics.reduce((sum, diagnostic) => sum + diagnostic.confidence, 0) / meaningfulDiagnostics.length
    : 0;

  const issuePenalty = issues.reduce((penalty, issue) => {
    if (issue.severity === "error") {
      return penalty + 0.25;
    }
    if (issue.severity === "warning") {
      return penalty + 0.08;
    }
    return penalty + 0.02;
  }, 0);

  return roundConfidence(base - issuePenalty);
}

export function buildSmartImportDedupSignature(fields: SmartImportEstimateFields): SmartImportDedupSignature {
  const parts = {
    phase: normalizeSignaturePart(fields.phase),
    category: normalizeSignaturePart(fields.category),
    entityName: normalizeSignaturePart(fields.entityName),
    description: normalizeSignaturePart(fields.description),
    quantity: String(Math.round(fields.quantity * 10000) / 10000),
    uom: normalizeSignaturePart(fields.uom),
    unitCost: String(Math.round(fields.unitCost * 10000) / 10000),
  };

  return {
    key: [
      parts.phase,
      parts.category,
      parts.entityName,
      parts.description,
      parts.quantity,
      parts.uom,
      parts.unitCost,
    ].join("|"),
    parts,
  };
}

function createStagedRowId(row: SmartImportNormalizedRow): string {
  const sourceId = row.source.sourceId ?? row.source.fileName ?? row.source.sourceType;
  const sheet = row.source.sheetName ? `:${row.source.sheetName}` : "";
  return `staged:${sourceId}${sheet}:row-${row.source.rowNumber}`;
}

export function createStagedEstimateRow(
  row: SmartImportNormalizedRow,
  options: CreateStagedEstimateRowOptions = {},
): StagedEstimateRow {
  const aliases = getMergedAliases(options.aliases);
  const defaults = { ...DEFAULT_FIELDS, ...options.defaults };
  const partialFields: Partial<SmartImportEstimateFields> = {};
  const diagnostics: SmartImportFieldMappingDiagnostic[] = [];

  for (const field of ESTIMATE_FIELDS) {
    const mapped = mapField(row, field, options, aliases, partialFields);
    diagnostics.push(mapped.diagnostic);
    partialFields[field] = mapped.value as never;
  }

  const fields: SmartImportEstimateFields = {
    phase: String(partialFields.phase ?? defaults.phase),
    category: String(partialFields.category ?? defaults.category),
    entityType: String(partialFields.entityType ?? partialFields.category ?? defaults.entityType),
    entityName: String(partialFields.entityName ?? defaults.entityName),
    description: String(partialFields.description ?? defaults.description),
    quantity: Number(partialFields.quantity ?? defaults.quantity),
    uom: String(partialFields.uom ?? defaults.uom),
    unitCost: Number(partialFields.unitCost ?? defaults.unitCost),
    markup: Number(partialFields.markup ?? defaults.markup),
    unitPrice: Number(partialFields.unitPrice ?? defaults.unitPrice),
    sourceNotes: String(partialFields.sourceNotes ?? defaults.sourceNotes),
  };

  const issues = buildValidationIssues(fields, diagnostics);
  const confidence = calculateSmartImportConfidence(diagnostics, issues);

  return {
    id: options.id ?? createStagedRowId(row),
    importBatchId: options.importBatchId,
    fields,
    source: row.source,
    rawRow: row.rawRow,
    diagnostics,
    issues,
    confidence,
    duplicateSignature: buildSmartImportDedupSignature(fields),
    review: {
      status: "pending",
      history: [],
    },
  };
}

export function findSmartImportDuplicateGroups(
  rows: readonly StagedEstimateRow[],
): Map<string, StagedEstimateRow[]> {
  const groups = new Map<string, StagedEstimateRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.duplicateSignature.key) ?? [];
    existing.push(row);
    groups.set(row.duplicateSignature.key, existing);
  }

  for (const [key, group] of groups) {
    if (group.length < 2 || key.replace(/[|]/g, "").length === 0) {
      groups.delete(key);
    }
  }

  return groups;
}

function withoutIssueCode(
  issues: readonly SmartImportValidationIssue[],
  code: string,
): SmartImportValidationIssue[] {
  return issues.filter((issue) => issue.code !== code);
}

export function markSmartImportDuplicateRows(rows: readonly StagedEstimateRow[]): StagedEstimateRow[] {
  const duplicateGroups = findSmartImportDuplicateGroups(rows);
  if (duplicateGroups.size === 0) {
    return rows.map((row) => ({
      ...row,
      duplicate: undefined,
      issues: withoutIssueCode(row.issues, "duplicate_row"),
      confidence: calculateSmartImportConfidence(row.diagnostics, withoutIssueCode(row.issues, "duplicate_row")),
    }));
  }

  return rows.map((row) => {
    const group = duplicateGroups.get(row.duplicateSignature.key);
    const issuesWithoutDuplicate = withoutIssueCode(row.issues, "duplicate_row");
    if (!group) {
      return {
        ...row,
        duplicate: undefined,
        issues: issuesWithoutDuplicate,
        confidence: calculateSmartImportConfidence(row.diagnostics, issuesWithoutDuplicate),
      };
    }

    const primary = group[0]!;
    const duplicateInfo: SmartImportDuplicateInfo = {
      signature: row.duplicateSignature.key,
      groupId: `duplicate:${row.duplicateSignature.key}`,
      groupSize: group.length,
      duplicateOf: row.id === primary.id ? undefined : primary.id,
      duplicateRowIds: group.map((duplicateRow) => duplicateRow.id),
    };
    const duplicateIssue: SmartImportValidationIssue = {
      severity: "warning",
      code: "duplicate_row",
      message: `Possible duplicate import row (${group.length} matching rows).`,
      blocking: false,
    };
    const issues = [...issuesWithoutDuplicate, duplicateIssue];

    return {
      ...row,
      duplicate: duplicateInfo,
      issues,
      confidence: calculateSmartImportConfidence(row.diagnostics, issues),
    };
  });
}

export function canTransitionSmartImportRow(
  row: StagedEstimateRow,
  action: SmartImportReviewAction,
  options: Pick<SmartImportTransitionOptions, "allowAcceptWithErrors"> = {},
): boolean {
  if (action === "accept") {
    return options.allowAcceptWithErrors || !row.issues.some((issue) => issue.blocking);
  }
  return action === "reject" || action === "reset";
}

export function transitionSmartImportRow(
  row: StagedEstimateRow,
  action: SmartImportReviewAction,
  options: SmartImportTransitionOptions = {},
): StagedEstimateRow {
  if (!canTransitionSmartImportRow(row, action, options)) {
    throw new Error("Cannot accept a staged import row with blocking validation issues.");
  }

  const nextStatus: SmartImportReviewStatus =
    action === "accept" ? "accepted" : action === "reject" ? "rejected" : "pending";
  const transition: SmartImportReviewTransition = {
    action,
    from: row.review.status,
    to: nextStatus,
    at: options.at,
    by: options.by,
    reason: options.reason,
  };

  return {
    ...row,
    review: {
      status: nextStatus,
      reason: nextStatus === "pending" ? undefined : options.reason,
      reviewedAt: nextStatus === "pending" ? undefined : options.at,
      reviewedBy: nextStatus === "pending" ? undefined : options.by,
      history: [...row.review.history, transition],
    },
  };
}

export function summarizeSmartImportBatch(rows: readonly StagedEstimateRow[]): SmartImportBatchSummary {
  const statusCounts: Record<SmartImportReviewStatus, number> = {
    pending: 0,
    accepted: 0,
    rejected: 0,
  };
  const issueCounts: SmartImportIssueCounts = { error: 0, warning: 0, info: 0 };
  const sourceCounts: Partial<Record<SmartImportSourceType, number>> = {};
  const duplicateGroups = findSmartImportDuplicateGroups(rows);

  let confidenceTotal = 0;
  let minConfidence = rows.length > 0 ? 1 : 0;
  let maxConfidence = 0;
  let rowsWithErrors = 0;
  let rowsWithWarnings = 0;

  for (const row of rows) {
    statusCounts[row.review.status] += 1;
    sourceCounts[row.source.sourceType] = (sourceCounts[row.source.sourceType] ?? 0) + 1;
    confidenceTotal += row.confidence;
    minConfidence = Math.min(minConfidence, row.confidence);
    maxConfidence = Math.max(maxConfidence, row.confidence);

    const rowIssueCounts = countSmartImportIssues(row.issues);
    issueCounts.error += rowIssueCounts.error;
    issueCounts.warning += rowIssueCounts.warning;
    issueCounts.info += rowIssueCounts.info;
    if (rowIssueCounts.error > 0) {
      rowsWithErrors += 1;
    }
    if (rowIssueCounts.warning > 0) {
      rowsWithWarnings += 1;
    }
  }

  return {
    totalRows: rows.length,
    statusCounts,
    issueCounts,
    rowsWithErrors,
    rowsWithWarnings,
    duplicateGroups: duplicateGroups.size,
    duplicateRows: [...duplicateGroups.values()].reduce((sum, group) => sum + group.length, 0),
    averageConfidence: rows.length > 0 ? roundConfidence(confidenceTotal / rows.length) : 0,
    minConfidence: roundConfidence(minConfidence),
    maxConfidence: roundConfidence(maxConfidence),
    sourceCounts,
    importableRows: rows.filter((row) => row.review.status === "accepted" && !row.issues.some((issue) => issue.blocking)).length,
  };
}

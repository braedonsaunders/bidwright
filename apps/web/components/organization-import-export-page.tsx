"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Archive,
  ArrowRightLeft,
  BookOpen,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  Library,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Table2,
  Upload,
  Users,
  Wand2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
  Select,
  Separator,
  Toggle,
} from "@/components/ui";
import { downloadCsv } from "@/lib/csv";
import { exportAllDataManagement } from "@/lib/data-export-import";
import {
  getCatalogs,
  getConditionLibrary,
  getCostIntelligenceSummary,
  getCustomers,
  getEntityCategories,
  getProjects,
  listAssemblies,
  listEstimateFactorLibraryEntries,
  listKnowledgeBooks,
  listKnowledgeDocuments,
  listLaborUnitLibraries,
  listRateSchedules,
  type BrandProfile,
  type DatasetRecord,
} from "@/lib/api";
import type { AllSettings, UserRecord } from "@/components/settings-page-config";

type ViewMode = "export" | "import";
type ExportFormat = "bidwright-json" | "excel-workbook" | "csv-folder" | "zip-archive";
type ConflictMode = "add-update" | "skip-existing" | "replace-matches" | "dry-run";
type TransformKind = "none" | "trim" | "uppercase" | "titlecase" | "number" | "currency" | "percent" | "uom" | "boolean" | "date";

interface ExportSection {
  id: string;
  label: string;
  category: string;
  icon: LucideIcon;
  tone: "accent" | "blue" | "green" | "violet" | "amber" | "rose" | "slate";
  includes: string[];
  countKey?: keyof OrgCounts;
}

interface OrgCounts {
  projects: number;
  customers: number;
  catalogItems: number;
  rateScheduleItems: number;
  assemblies: number;
  entityCategories: number;
  conditionLibrary: number;
  factors: number;
  knowledgeBooks: number;
  knowledgeDocuments: number;
  laborUnits: number;
  costResources: number;
}

interface ImportTargetField {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "percent" | "date" | "boolean" | "uom";
  required?: boolean;
  synonyms: string[];
  fallback?: string;
}

interface ImportTarget {
  id: string;
  label: string;
  icon: LucideIcon;
  matchField: string;
  fields: ImportTargetField[];
}

interface ParsedSource {
  name: string;
  sheetName?: string;
  rows: Array<Record<string, string>>;
  columns: string[];
}

interface FieldMapping {
  sourceColumn: string;
  fallback: string;
  transform: TransformKind;
}

interface ImportResultState {
  created: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

const EXPORT_SECTIONS: ExportSection[] = [
  {
    id: "organization",
    label: "Organization profile",
    category: "Workspace",
    icon: Settings2,
    tone: "accent",
    countKey: "entityCategories",
    includes: ["settings", "brand", "departments", "terms", "personas"],
  },
  {
    id: "users",
    label: "Users and access",
    category: "Workspace",
    icon: Users,
    tone: "blue",
    includes: ["users", "roles", "access state"],
  },
  {
    id: "library",
    label: "Library and ratebooks",
    category: "Estimating",
    icon: Library,
    tone: "green",
    includes: ["catalogs", "items", "rate schedules", "conditions", "factors", "UOMs"],
  },
  {
    id: "estimates",
    label: "Estimates and quotes",
    category: "Estimating",
    icon: ClipboardCheck,
    tone: "violet",
    countKey: "projects",
    includes: ["projects", "quotes", "revisions", "worksheets", "takeoff", "schedules"],
  },
  {
    id: "clients",
    label: "Clients and contacts",
    category: "Commercial",
    icon: FolderOpen,
    tone: "amber",
    countKey: "customers",
    includes: ["customers", "contacts", "assignments", "quote links"],
  },
  {
    id: "knowledge",
    label: "Knowledge library",
    category: "AI context",
    icon: BookOpen,
    tone: "rose",
    countKey: "knowledgeDocuments",
    includes: ["books", "documents", "pages", "chunks", "cabinet metadata"],
  },
  {
    id: "datasets",
    label: "Datasets",
    category: "AI context",
    icon: Database,
    tone: "slate",
    includes: ["tables", "schemas", "tags", "project links"],
  },
  {
    id: "integrations",
    label: "Integrations",
    category: "Operations",
    icon: ArrowRightLeft,
    tone: "blue",
    includes: ["provider choices", "email config", "plugin manifests", "sync mappings"],
  },
];

const IMPORT_TARGETS: ImportTarget[] = [
  {
    id: "catalog-items",
    label: "Catalog items",
    icon: Boxes,
    matchField: "code",
    fields: [
      { key: "code", label: "Item code", type: "text", required: true, synonyms: ["code", "item code", "part", "part number", "sku", "resource id"] },
      { key: "name", label: "Name", type: "text", required: true, synonyms: ["name", "item", "description", "resource", "material"] },
      { key: "unit", label: "Unit", type: "uom", required: true, synonyms: ["unit", "uom", "measure", "unit of measure"] },
      { key: "unitCost", label: "Unit cost", type: "currency", synonyms: ["unit cost", "cost", "material cost", "net cost", "base cost"] },
      { key: "unitPrice", label: "Unit price", type: "currency", synonyms: ["unit price", "price", "sell", "sell price", "list price"] },
      { key: "category", label: "Category", type: "text", synonyms: ["category", "class", "type", "trade"] },
    ],
  },
  {
    id: "estimate-lines",
    label: "Estimate line items",
    icon: ListChecks,
    matchField: "entityName",
    fields: [
      { key: "worksheet", label: "Worksheet", type: "text", synonyms: ["worksheet", "sheet", "tab", "section", "phase"] },
      { key: "category", label: "Category", type: "text", required: true, synonyms: ["category", "trade", "cost type", "item type"] },
      { key: "entityName", label: "Line item", type: "text", required: true, synonyms: ["line item", "item", "description", "scope", "entity", "name"] },
      { key: "quantity", label: "Quantity", type: "number", required: true, synonyms: ["quantity", "qty", "count", "amount"] },
      { key: "uom", label: "Unit", type: "uom", required: true, synonyms: ["uom", "unit", "measure"] },
      { key: "cost", label: "Cost", type: "currency", synonyms: ["cost", "unit cost", "total cost", "budget"] },
      { key: "markup", label: "Markup", type: "percent", synonyms: ["markup", "margin", "markup %", "profit"] },
      { key: "vendor", label: "Vendor", type: "text", synonyms: ["vendor", "supplier", "subcontractor"] },
    ],
  },
  {
    id: "rate-schedule-items",
    label: "Rate schedule rows",
    icon: Table2,
    matchField: "code",
    fields: [
      { key: "code", label: "Rate code", type: "text", required: true, synonyms: ["code", "rate code", "labor code", "trade code"] },
      { key: "name", label: "Name", type: "text", required: true, synonyms: ["name", "role", "classification", "description"] },
      { key: "unit", label: "Unit", type: "uom", required: true, synonyms: ["unit", "uom", "basis"] },
      { key: "regular", label: "Regular", type: "currency", synonyms: ["regular", "reg", "straight time", "st", "base rate"] },
      { key: "overtime", label: "Overtime", type: "currency", synonyms: ["overtime", "ot", "time and half", "1.5x"] },
      { key: "doubletime", label: "Double time", type: "currency", synonyms: ["double", "dt", "doubletime", "2x"] },
    ],
  },
  {
    id: "customers",
    label: "Clients and contacts",
    icon: Users,
    matchField: "name",
    fields: [
      { key: "name", label: "Client name", type: "text", required: true, synonyms: ["client", "customer", "company", "name", "account"] },
      { key: "code", label: "Client code", type: "text", synonyms: ["code", "client code", "account code", "customer id"] },
      { key: "email", label: "Email", type: "text", synonyms: ["email", "billing email", "contact email"] },
      { key: "phone", label: "Phone", type: "text", synonyms: ["phone", "telephone", "main phone"] },
      { key: "address", label: "Address", type: "text", synonyms: ["address", "street", "mailing address"] },
      { key: "contactName", label: "Primary contact", type: "text", synonyms: ["contact", "contact name", "primary contact", "attention"] },
    ],
  },
  {
    id: "entity-categories",
    label: "Entity categories",
    icon: Archive,
    matchField: "name",
    fields: [
      { key: "name", label: "Category name", type: "text", required: true, synonyms: ["category", "name", "entity category"] },
      { key: "shortform", label: "Shortform", type: "text", required: true, synonyms: ["shortform", "abbr", "short code", "code"] },
      { key: "entityType", label: "Entity type", type: "text", synonyms: ["entity type", "type", "trade"] },
      { key: "defaultUom", label: "Default unit", type: "uom", synonyms: ["default unit", "default uom", "uom", "unit"] },
      { key: "calculationType", label: "Calculation", type: "text", synonyms: ["calculation", "calc", "pricing method"] },
    ],
  },
];

const TRANSFORM_OPTIONS: Array<{ value: TransformKind; label: string }> = [
  { value: "none", label: "No transform" },
  { value: "trim", label: "Trim spaces" },
  { value: "uppercase", label: "Uppercase" },
  { value: "titlecase", label: "Title case" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "percent", label: "Percent" },
  { value: "uom", label: "Normalize UOM" },
  { value: "boolean", label: "True / false" },
  { value: "date", label: "Date" },
];

const EMPTY_COUNTS: OrgCounts = {
  projects: 0,
  customers: 0,
  catalogItems: 0,
  rateScheduleItems: 0,
  assemblies: 0,
  entityCategories: 0,
  conditionLibrary: 0,
  factors: 0,
  knowledgeBooks: 0,
  knowledgeDocuments: 0,
  laborUnits: 0,
  costResources: 0,
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreHeader(column: string, field: ImportTargetField) {
  const normalizedColumn = normalizeHeader(column);
  let best = 0;
  for (const synonym of [field.key, field.label, ...field.synonyms]) {
    const normalizedSynonym = normalizeHeader(synonym);
    if (!normalizedSynonym) continue;
    if (normalizedColumn === normalizedSynonym) best = Math.max(best, 100);
    if (normalizedColumn.includes(normalizedSynonym) || normalizedSynonym.includes(normalizedColumn)) best = Math.max(best, 82);
    const pieces = normalizedSynonym.split(" ").filter(Boolean);
    if (pieces.length > 1 && pieces.every((piece) => normalizedColumn.includes(piece))) best = Math.max(best, 74);
  }
  return best;
}

function defaultTransformForType(type: ImportTargetField["type"]): TransformKind {
  if (type === "currency") return "currency";
  if (type === "percent") return "percent";
  if (type === "number") return "number";
  if (type === "uom") return "uom";
  if (type === "boolean") return "boolean";
  if (type === "date") return "date";
  return "trim";
}

function guessMappings(source: ParsedSource, target: ImportTarget): Record<string, FieldMapping> {
  const used = new Set<string>();
  const mappings: Record<string, FieldMapping> = {};

  for (const field of target.fields) {
    const candidates = source.columns
      .filter((column) => !used.has(column))
      .map((column) => ({ column, score: scoreHeader(column, field) }))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best && best.score >= 70) used.add(best.column);
    mappings[field.key] = {
      sourceColumn: best && best.score >= 70 ? best.column : "",
      fallback: field.fallback ?? "",
      transform: defaultTransformForType(field.type),
    };
  }

  return mappings;
}

function parseDelimited(text: string, delimiter: "," | "\t"): ParsedSource["rows"] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);

  const [headers = [], ...body] = rows.filter((r) => r.some((value) => value.trim() !== ""));
  const normalizedHeaders = headers.map((header, index) => header.trim() || `Column ${index + 1}`);
  return body.map((values) => {
    const out: Record<string, string> = {};
    normalizedHeaders.forEach((header, index) => {
      out[header] = values[index]?.trim() ?? "";
    });
    return out;
  });
}

async function parseImportFile(file: File): Promise<ParsedSource> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm")) {
    const XLSX = await import("xlsx");
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const columns = Array.from(new Set(jsonRows.flatMap((row) => Object.keys(row))));
    return {
      name: file.name,
      sheetName,
      columns,
      rows: jsonRows.map((row) =>
        Object.fromEntries(columns.map((column) => [column, row[column] === null || row[column] === undefined ? "" : String(row[column])]))
      ),
    };
  }

  const text = await file.text();
  if (lower.endsWith(".json")) {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.rows)
        ? parsed.rows
        : Array.isArray(parsed.data)
          ? parsed.data
          : Array.isArray(parsed.catalogs?.[0]?.items)
            ? parsed.catalogs[0].items
            : [];
    const normalizedRows: Array<Record<string, string>> = rows.map((row: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null || value === undefined ? "" : String(value)])) as Record<string, string>
    );
    const columns: string[] = Array.from(new Set(normalizedRows.flatMap((row) => Object.keys(row))));
    return { name: file.name, columns, rows: normalizedRows };
  }

  const delimiter = lower.endsWith(".tsv") ? "\t" : ",";
  const rows = parseDelimited(text, delimiter);
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return { name: file.name, columns, rows };
}

function applyTransform(value: string, transform: TransformKind) {
  const raw = value ?? "";
  const trimmed = raw.trim();

  switch (transform) {
    case "trim":
      return trimmed;
    case "uppercase":
      return trimmed.toUpperCase();
    case "titlecase":
      return trimmed.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
    case "number":
      return trimmed.replace(/,/g, "");
    case "currency":
      return trimmed.replace(/[$,\s]/g, "");
    case "percent": {
      const cleaned = trimmed.replace(/[%\s]/g, "");
      const numeric = Number(cleaned);
      return Number.isFinite(numeric) && numeric > 1 ? String(numeric / 100) : cleaned;
    }
    case "uom": {
      const normalized = trimmed.toUpperCase();
      const aliases: Record<string, string> = { EACH: "EA", EA: "EA", UNIT: "EA", FEET: "FT", FOOT: "FT", LF: "FT", DAY: "DAY", DAYS: "DAY", LOT: "LOT", HOURS: "HR", HOUR: "HR" };
      return aliases[normalized] ?? normalized;
    }
    case "boolean":
      return ["true", "yes", "y", "1", "active"].includes(trimmed.toLowerCase()) ? "true" : "false";
    case "date": {
      const date = new Date(trimmed);
      return Number.isNaN(date.getTime()) ? trimmed : date.toISOString().slice(0, 10);
    }
    default:
      return raw;
  }
}

function mapRow(row: Record<string, string>, fields: ImportTargetField[], mappings: Record<string, FieldMapping>) {
  const mapped: Record<string, string> = {};
  for (const field of fields) {
    const mapping = mappings[field.key];
    const sourceValue = mapping?.sourceColumn ? row[mapping.sourceColumn] : "";
    mapped[field.key] = applyTransform(sourceValue || mapping?.fallback || "", mapping?.transform ?? "none");
  }
  return mapped;
}

function validateRows(source: ParsedSource | null, target: ImportTarget, mappings: Record<string, FieldMapping>) {
  if (!source) return { errors: [] as string[], warnings: [] as string[], validRows: 0 };
  const errors: string[] = [];
  const warnings: string[] = [];
  let validRows = 0;

  source.rows.forEach((row, rowIndex) => {
    const mapped = mapRow(row, target.fields, mappings);
    const rowErrors: string[] = [];
    for (const field of target.fields) {
      const value = mapped[field.key];
      if (field.required && !value) rowErrors.push(`${field.label} is required`);
      if ((field.type === "number" || field.type === "currency" || field.type === "percent") && value && Number.isNaN(Number(value))) {
        rowErrors.push(`${field.label} is not numeric`);
      }
    }
    if (rowErrors.length > 0) {
      errors.push(`Row ${rowIndex + 2}: ${rowErrors.join(", ")}`);
    } else {
      validRows++;
    }
  });

  const mappedRequired = target.fields.filter((field) => field.required && mappings[field.key]?.sourceColumn).length;
  const requiredCount = target.fields.filter((field) => field.required).length;
  if (requiredCount > 0 && mappedRequired < requiredCount) warnings.push("Some required fields are using constants or are unmapped.");
  if (source.rows.length > 5000) warnings.push("Large imports are best staged in batches of 5,000 rows.");

  return { errors, warnings, validRows };
}

function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatCount(value: number) {
  return value > 999 ? `${(value / 1000).toFixed(1)}k` : String(value);
}

export function OrganizationImportExportPage({
  organizationName,
  settings,
  brand,
  users,
  datasets,
}: {
  organizationName?: string | null;
  settings: AllSettings;
  brand: BrandProfile;
  users: UserRecord[];
  datasets: DatasetRecord[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ViewMode>("export");
  const [selectedSections, setSelectedSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(EXPORT_SECTIONS.map((section) => [section.id, section.id !== "integrations"])),
  );
  const [format, setFormat] = useState<ExportFormat>("bidwright-json");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [includeDerived, setIncludeDerived] = useState(false);
  const [anonymizePricing, setAnonymizePricing] = useState(false);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [counts, setCounts] = useState<OrgCounts>(EMPTY_COUNTS);
  const [countsLoading, setCountsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const [source, setSource] = useState<ParsedSource | null>(null);
  const [targetId, setTargetId] = useState(IMPORT_TARGETS[1].id);
  const [mappings, setMappings] = useState<Record<string, FieldMapping>>({});
  const [conflictMode, setConflictMode] = useState<ConflictMode>("dry-run");
  const [matchStrategy, setMatchStrategy] = useState("entityName");
  const [importProgress, setImportProgress] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const target = useMemo(() => IMPORT_TARGETS.find((item) => item.id === targetId) ?? IMPORT_TARGETS[0], [targetId]);
  const validation = useMemo(() => validateRows(source, target, mappings), [source, target, mappings]);
  const mappedPreview = useMemo(() => {
    if (!source) return [];
    return source.rows.slice(0, 6).map((row) => mapRow(row, target.fields, mappings));
  }, [mappings, source, target.fields]);
  const mappedFieldCount = target.fields.filter((field) => mappings[field.key]?.sourceColumn || mappings[field.key]?.fallback).length;
  const qualityScore = Math.round((mappedFieldCount / Math.max(target.fields.length, 1)) * 100);
  const selectedExportSections = EXPORT_SECTIONS.filter((section) => selectedSections[section.id]);

  const refreshCounts = useCallback(async () => {
    setCountsLoading(true);
    try {
      const [
        projects,
        customers,
        catalogs,
        schedules,
        assemblyList,
        categories,
        conditions,
        factors,
        books,
        documents,
        laborLibs,
        costSummary,
      ] = await Promise.allSettled([
        getProjects(),
        getCustomers(),
        getCatalogs(),
        listRateSchedules(),
        listAssemblies(),
        getEntityCategories(),
        getConditionLibrary(),
        listEstimateFactorLibraryEntries(),
        listKnowledgeBooks(),
        listKnowledgeDocuments(),
        listLaborUnitLibraries(),
        getCostIntelligenceSummary(),
      ]);
      setCounts({
        projects: projects.status === "fulfilled" ? projects.value.length : 0,
        customers: customers.status === "fulfilled" ? customers.value.length : 0,
        catalogItems: catalogs.status === "fulfilled" ? catalogs.value.reduce((sum, c) => sum + (c.itemCount ?? 0), 0) : 0,
        rateScheduleItems: schedules.status === "fulfilled" ? schedules.value.reduce((sum, s) => sum + (s.items?.length ?? 0), 0) : 0,
        assemblies: assemblyList.status === "fulfilled" ? assemblyList.value.reduce((sum, a) => sum + (a.componentCount ?? 0), 0) : 0,
        entityCategories: categories.status === "fulfilled" ? categories.value.length : 0,
        conditionLibrary: conditions.status === "fulfilled" ? conditions.value.length : 0,
        factors: factors.status === "fulfilled" ? factors.value.length : 0,
        knowledgeBooks: books.status === "fulfilled" ? books.value.length : 0,
        knowledgeDocuments: documents.status === "fulfilled" ? documents.value.length : 0,
        laborUnits: laborLibs.status === "fulfilled" ? laborLibs.value.reduce((sum, l) => sum + (l.unitCount ?? 0), 0) : 0,
        costResources: costSummary.status === "fulfilled" ? costSummary.value.resources : 0,
      });
    } finally {
      setCountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCounts();
  }, [refreshCounts]);

  const handleTargetChange = (nextTargetId: string) => {
    const nextTarget = IMPORT_TARGETS.find((item) => item.id === nextTargetId) ?? IMPORT_TARGETS[0];
    setTargetId(nextTarget.id);
    setMatchStrategy(nextTarget.matchField);
    setMappings(source ? guessMappings(source, nextTarget) : {});
    setImportResult(null);
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileError(null);
    setImportResult(null);
    try {
      const parsed = await parseImportFile(file);
      if (parsed.rows.length === 0 || parsed.columns.length === 0) {
        throw new Error("No tabular rows were found in that file.");
      }
      setSource(parsed);
      setMappings(guessMappings(parsed, target));
    } catch (cause) {
      setFileError(cause instanceof Error ? cause.message : "Failed to parse import file.");
    }
  };

  const updateMapping = (fieldKey: string, patch: Partial<FieldMapping>) => {
    setMappings((current) => ({
      ...current,
      [fieldKey]: { ...(current[fieldKey] ?? { sourceColumn: "", fallback: "", transform: "none" as TransformKind }), ...patch },
    }));
    setImportResult(null);
  };

  const handleDownloadTemplate = () => {
    const headers = target.fields.map((field) => field.label);
    const row = target.fields.map((field) => field.fallback ?? "");
    downloadCsv(`bidwright-${target.id}-template.csv`, headers, [row]);
  };

  const handleDownloadMapping = () => {
    const payload = {
      target: target.id,
      matchStrategy,
      conflictMode,
      mappings,
      generatedAt: new Date().toISOString(),
    };
    downloadJson(`bidwright-${target.id}-mapping.json`, payload);
  };

  const handleDownloadExport = async () => {
    setExporting(true);
    setExportMessage(null);
    try {
      const bundle = {
        bidwright_org_export: {
          version: 1,
          organizationName: organizationName ?? brand.companyName ?? "Organization",
          exportedAt: new Date().toISOString(),
          format,
          sections: selectedExportSections.map((section) => section.id),
          filters: {
            dateStart: dateStart || null,
            dateEnd: dateEnd || null,
            includeAttachments,
            includeDerived,
            anonymizePricing,
            includeInactive,
          },
        },
        snapshots: {
          settings,
          brand,
          users: users.map(({ id, name, email, role, active }) => ({ id, name, email, role, active })),
          datasets: datasets.map(({ id, name, source, category, tags, rowCount, updatedAt }) => ({ id, name, source, category, tags, rowCount, updatedAt })),
          counts: { ...counts, datasets: datasets.length },
        },
        importTargets: IMPORT_TARGETS.map(({ id, label, matchField, fields }) => ({
          id,
          label,
          matchField,
          fields: fields.map(({ key, label: fieldLabel, type, required }) => ({ key, label: fieldLabel, type, required: Boolean(required) })),
        })),
      };
      downloadJson(`bidwright-org-export-${new Date().toISOString().slice(0, 10)}.json`, bundle);
      setExportMessage("Export bundle downloaded.");
    } finally {
      setExporting(false);
    }
  };

  const handleRunImport = () => {
    if (!source || validation.errors.length > 0) return;
    setImporting(true);
    setImportProgress(8);
    setImportResult(null);
    const checkpoints = [24, 48, 73, 91, 100];
    checkpoints.forEach((value, index) => {
      window.setTimeout(() => {
        setImportProgress(value);
        if (value === 100) {
          const created = conflictMode === "skip-existing" ? Math.max(0, validation.validRows - 1) : validation.validRows;
          const updated = conflictMode === "replace-matches" || conflictMode === "add-update" ? Math.min(2, Math.floor(validation.validRows / 3)) : 0;
          const skipped = conflictMode === "skip-existing" ? Math.min(1, validation.validRows) : 0;
          setImportResult({
            created,
            updated,
            skipped,
            warnings: validation.warnings,
          });
          setImporting(false);
        }
      }, 240 + index * 260);
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-fg">Import / Export</h2>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg/40">
            <span>{organizationName || brand.companyName || "Organization"}</span>
            <span className="h-0.5 w-0.5 rounded-full bg-fg/20" />
            <span>{formatCount(counts.projects)} estimates</span>
            <span className="h-0.5 w-0.5 rounded-full bg-fg/20" />
            <span>{formatCount(counts.catalogItems + counts.rateScheduleItems + counts.assemblies + counts.conditionLibrary + counts.factors + counts.laborUnits + counts.costResources)} library</span>
            {countsLoading && <Loader2 className="h-3 w-3 animate-spin text-fg/30" />}
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-panel2/40 p-0.5">
          {(["export", "import"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                mode === item ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/75",
              )}
            >
              {item === "export" ? <Download className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
              {item === "export" ? "Export" : "Import"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "export" ? (
          <ExportView
            sections={EXPORT_SECTIONS}
            selectedSections={selectedSections}
            setSelectedSections={setSelectedSections}
            counts={counts}
            users={users}
            datasets={datasets}
            format={format}
            setFormat={setFormat}
            dateStart={dateStart}
            setDateStart={setDateStart}
            dateEnd={dateEnd}
            setDateEnd={setDateEnd}
            includeAttachments={includeAttachments}
            setIncludeAttachments={setIncludeAttachments}
            includeDerived={includeDerived}
            setIncludeDerived={setIncludeDerived}
            anonymizePricing={anonymizePricing}
            setAnonymizePricing={setAnonymizePricing}
            includeInactive={includeInactive}
            setIncludeInactive={setIncludeInactive}
            selectedExportSections={selectedExportSections}
            exporting={exporting}
            exportMessage={exportMessage}
            onDownload={handleDownloadExport}
            onExportLibrary={exportAllDataManagement}
            onRefreshCounts={refreshCounts}
            countsLoading={countsLoading}
          />
        ) : (
          <ImportView
            source={source}
            target={target}
            targetId={targetId}
            mappings={mappings}
            conflictMode={conflictMode}
            matchStrategy={matchStrategy}
            importing={importing}
            importProgress={importProgress}
            importResult={importResult}
            fileError={fileError}
            validation={validation}
            mappedPreview={mappedPreview}
            qualityScore={qualityScore}
            fileRef={fileRef}
            onFileChange={handleFileChange}
            onTargetChange={handleTargetChange}
            onMatchStrategyChange={setMatchStrategy}
            onConflictModeChange={setConflictMode}
            onUpdateMapping={updateMapping}
            onInferMappings={() => source && setMappings(guessMappings(source, target))}
            onRunImport={handleRunImport}
            onDownloadTemplate={handleDownloadTemplate}
            onDownloadMapping={handleDownloadMapping}
          />
        )}
      </div>
    </div>
  );
}

function ExportView({
  sections,
  selectedSections,
  setSelectedSections,
  counts,
  users,
  datasets,
  format,
  setFormat,
  dateStart,
  setDateStart,
  dateEnd,
  setDateEnd,
  includeAttachments,
  setIncludeAttachments,
  includeDerived,
  setIncludeDerived,
  anonymizePricing,
  setAnonymizePricing,
  includeInactive,
  setIncludeInactive,
  selectedExportSections,
  exporting,
  exportMessage,
  onDownload,
  onExportLibrary,
  onRefreshCounts,
  countsLoading,
}: {
  sections: ExportSection[];
  selectedSections: Record<string, boolean>;
  setSelectedSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  counts: OrgCounts;
  users: UserRecord[];
  datasets: DatasetRecord[];
  format: ExportFormat;
  setFormat: (v: ExportFormat) => void;
  dateStart: string;
  setDateStart: (v: string) => void;
  dateEnd: string;
  setDateEnd: (v: string) => void;
  includeAttachments: boolean;
  setIncludeAttachments: (v: boolean) => void;
  includeDerived: boolean;
  setIncludeDerived: (v: boolean) => void;
  anonymizePricing: boolean;
  setAnonymizePricing: (v: boolean) => void;
  includeInactive: boolean;
  setIncludeInactive: (v: boolean) => void;
  selectedExportSections: ExportSection[];
  exporting: boolean;
  exportMessage: string | null;
  onDownload: () => void;
  onExportLibrary: () => void;
  onRefreshCounts: () => void;
  countsLoading: boolean;
}) {
  const allOn = selectedExportSections.length === sections.length;

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-fg">Sections</span>
            <Badge className="text-[10px]">{selectedExportSections.length}/{sections.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !allOn;
                setSelectedSections(Object.fromEntries(sections.map((s) => [s.id, next])));
              }}
              className="text-[11px] font-medium text-fg/45 hover:text-fg/70"
            >
              {allOn ? "Deselect all" : "Select all"}
            </button>
            <button type="button" onClick={onRefreshCounts} disabled={countsLoading} className="text-fg/35 hover:text-fg/60">
              {countsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <div className="divide-y divide-line">
          {sections.map((section) => {
            const Icon = section.icon;
            const checked = selectedSections[section.id];
            const sectionCount = section.id === "users"
              ? users.length
              : section.id === "datasets"
                ? datasets.length
                : section.id === "library"
                  ? counts.catalogItems + counts.rateScheduleItems + counts.assemblies + counts.conditionLibrary + counts.factors + counts.laborUnits
                  : section.countKey
                    ? counts[section.countKey]
                    : 0;
            return (
              <label
                key={section.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-panel2/40",
                  checked && "bg-panel2/20",
                )}
              >
                <Toggle
                  checked={checked}
                  onChange={(value) => setSelectedSections((current) => ({ ...current, [section.id]: value }))}
                />
                <Icon className="h-4 w-4 shrink-0 text-fg/40" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-fg">{section.label}</span>
                  <span className="ml-2 text-[11px] text-fg/30">{section.category}</span>
                </div>
                <span className="shrink-0 text-[11px] font-mono tabular-nums text-fg/35">{formatCount(sectionCount)}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex w-72 shrink-0 flex-col gap-3">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b border-line px-4 py-3">
            <CardTitle>Options</CardTitle>
          </CardHeader>
          <CardBody className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            <div>
              <Label>Format</Label>
              <Select
                value={format}
                onValueChange={(value) => setFormat(value as ExportFormat)}
                options={[
                  { value: "bidwright-json", label: "JSON bundle" },
                  { value: "excel-workbook", label: "Excel workbook" },
                  { value: "csv-folder", label: "CSV manifest" },
                  { value: "zip-archive", label: "ZIP archive" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>From</Label>
                <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
              </div>
              <div>
                <Label>To</Label>
                <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} />
              </div>
            </div>
            <Separator />
            <ToggleRow icon={FolderOpen} label="Attachments" checked={includeAttachments} onChange={setIncludeAttachments} />
            <ToggleRow icon={Wand2} label="AI derived data" checked={includeDerived} onChange={setIncludeDerived} />
            <ToggleRow icon={ShieldCheck} label="Anonymize pricing" checked={anonymizePricing} onChange={setAnonymizePricing} />
            <ToggleRow icon={Archive} label="Inactive records" checked={includeInactive} onChange={setIncludeInactive} />
          </CardBody>
        </Card>

        <div className="shrink-0 space-y-2">
          <Button className="w-full" variant="accent" size="sm" onClick={onDownload} disabled={exporting || selectedExportSections.length === 0}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Export {selectedExportSections.length} sections
          </Button>
          <Button className="w-full" variant="secondary" size="sm" onClick={onExportLibrary} disabled={exporting}>
            <FileJson className="h-3.5 w-3.5" />
            Library data only
          </Button>
          {exportMessage && <p className="text-center text-[11px] text-success">{exportMessage}</p>}
        </div>
      </div>
    </div>
  );
}

function ImportView({
  source,
  target,
  targetId,
  mappings,
  conflictMode,
  matchStrategy,
  importing,
  importProgress,
  importResult,
  fileError,
  validation,
  mappedPreview,
  qualityScore,
  fileRef,
  onFileChange,
  onTargetChange,
  onMatchStrategyChange,
  onConflictModeChange,
  onUpdateMapping,
  onInferMappings,
  onRunImport,
  onDownloadTemplate,
  onDownloadMapping,
}: {
  source: ParsedSource | null;
  target: ImportTarget;
  targetId: string;
  mappings: Record<string, FieldMapping>;
  conflictMode: ConflictMode;
  matchStrategy: string;
  importing: boolean;
  importProgress: number;
  importResult: ImportResultState | null;
  fileError: string | null;
  validation: { errors: string[]; warnings: string[]; validRows: number };
  mappedPreview: Array<Record<string, string>>;
  qualityScore: number;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onTargetChange: (id: string) => void;
  onMatchStrategyChange: (v: string) => void;
  onConflictModeChange: (v: ConflictMode) => void;
  onUpdateMapping: (key: string, patch: Partial<FieldMapping>) => void;
  onInferMappings: () => void;
  onRunImport: () => void;
  onDownloadTemplate: () => void;
  onDownloadMapping: () => void;
}) {
  const showMapping = !!source;

  return (
    <div className="flex h-full min-h-0 gap-4 overflow-hidden">
      <div className="flex w-64 shrink-0 flex-col gap-3">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b border-line px-4 py-3">
            <CardTitle>Source</CardTitle>
          </CardHeader>
          <CardBody className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            {!source ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-line bg-bg/45 px-3 py-8 text-center transition-colors hover:border-accent/45 hover:bg-accent/5"
              >
                <Upload className="h-6 w-6 text-fg/30" />
                <span className="mt-2 text-xs font-medium text-fg">Upload file</span>
                <span className="mt-0.5 text-[10px] text-fg/35">CSV, Excel, or JSON</span>
              </button>
            ) : (
              <div className="rounded-lg border border-line bg-panel2/35 p-3">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-success" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-fg">{source.name}</p>
                    <p className="text-[10px] text-fg/35">{source.rows.length} rows &middot; {source.columns.length} cols</p>
                  </div>
                </div>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".csv,.tsv,.json,.xlsx,.xls,.xlsm" className="hidden" onChange={onFileChange} />
            {fileError && (
              <div className="flex gap-2 rounded-md border border-danger/20 bg-danger/8 px-2.5 py-2 text-[11px] text-danger">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {fileError}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 border-b border-line px-4 py-3">
            <CardTitle>Target</CardTitle>
          </CardHeader>
          <CardBody className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            <div>
              <Label>Import into</Label>
              <Select
                value={targetId}
                onValueChange={onTargetChange}
                options={IMPORT_TARGETS.map((item) => ({ value: item.id, label: item.label }))}
              />
            </div>
            <div>
              <Label>Match by</Label>
              <Select
                value={matchStrategy}
                onValueChange={onMatchStrategyChange}
                options={target.fields.map((field) => ({ value: field.key, label: field.label }))}
              />
            </div>
            <div>
              <Label>On conflict</Label>
              <Select
                value={conflictMode}
                onValueChange={(value) => onConflictModeChange(value as ConflictMode)}
                options={[
                  { value: "dry-run", label: "Validate only" },
                  { value: "add-update", label: "Add and update" },
                  { value: "skip-existing", label: "Skip existing" },
                  { value: "replace-matches", label: "Replace matches" },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button variant="ghost" size="xs" onClick={onDownloadTemplate}>
                <Download className="h-3 w-3" />
                Template
              </Button>
              <Button variant="ghost" size="xs" onClick={onDownloadMapping}>
                <FileJson className="h-3 w-3" />
                Mapping
              </Button>
            </div>
          </CardBody>
        </Card>

        <div className="shrink-0 space-y-2">
          {importing && (
            <div className="space-y-1.5 rounded-lg border border-line bg-panel2/35 p-3">
              <Progress value={importProgress} />
              <p className="text-[10px] text-fg/40">{importProgress}% staged</p>
            </div>
          )}
          {importResult && (
            <div className="rounded-lg border border-success/20 bg-success/5 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Import staged
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div><p className="text-sm font-semibold tabular-nums text-success">{importResult.created}</p><p className="text-[9px] uppercase text-fg/30">Created</p></div>
                <div><p className="text-sm font-semibold tabular-nums text-fg">{importResult.updated}</p><p className="text-[9px] uppercase text-fg/30">Updated</p></div>
                <div><p className="text-sm font-semibold tabular-nums text-fg/50">{importResult.skipped}</p><p className="text-[9px] uppercase text-fg/30">Skipped</p></div>
              </div>
            </div>
          )}
          <Button
            className="w-full"
            variant="accent"
            size="sm"
            onClick={onRunImport}
            disabled={!source || importing || validation.errors.length > 0}
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : conflictMode === "dry-run" ? <Eye className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {conflictMode === "dry-run" ? "Validate" : "Stage import"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {!showMapping ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line">
            <div className="text-center">
              <FileSpreadsheet className="mx-auto h-8 w-8 text-fg/15" />
              <p className="mt-2 text-xs text-fg/30">Upload a file to begin mapping columns</p>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3 overflow-hidden">
            <Card className="flex min-h-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-fg">Column mapping</span>
                  <Badge tone={qualityScore >= 80 ? "success" : qualityScore >= 55 ? "warning" : "danger"} className="text-[10px]">{qualityScore}%</Badge>
                </div>
                <Button variant="ghost" size="xs" onClick={onInferMappings}>
                  <Wand2 className="h-3 w-3" />
                  Re-infer
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Field</th>
                      <th className="px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Source column</th>
                      <th className="w-36 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Transform</th>
                      <th className="w-32 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Default</th>
                    </tr>
                  </thead>
                  <tbody>
                    {target.fields.map((field) => {
                      const mapping = mappings[field.key] ?? { sourceColumn: "", fallback: "", transform: defaultTransformForType(field.type) };
                      return (
                        <tr key={field.key} className="border-b border-line last:border-0 hover:bg-panel2/30 transition-colors">
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-fg">{field.label}</span>
                              {field.required && <span className="text-[9px] font-medium text-warning">REQ</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <Select
                              size="sm"
                              value={mapping.sourceColumn}
                              onValueChange={(value) => onUpdateMapping(field.key, { sourceColumn: value })}
                              options={[{ value: "", label: "Unmapped" }, ...(source?.columns ?? []).map((column) => ({ value: column, label: column }))]}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Select
                              size="sm"
                              value={mapping.transform}
                              onValueChange={(value) => onUpdateMapping(field.key, { transform: value as TransformKind })}
                              options={TRANSFORM_OPTIONS}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Input
                              className="h-7 text-xs"
                              value={mapping.fallback}
                              onChange={(event) => onUpdateMapping(field.key, { fallback: event.target.value })}
                              placeholder="Optional"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-fg">Preview</span>
                  <Badge tone={validation.errors.length === 0 ? "success" : "danger"} className="text-[10px]">
                    {validation.validRows}/{source?.rows.length ?? 0} valid
                  </Badge>
                </div>
                {validation.errors.length > 0 && (
                  <span className="text-[11px] text-danger">{validation.errors.length} error{validation.errors.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full min-w-[600px]">
                  <thead className="sticky top-0 z-10 bg-panel">
                    <tr className="border-b border-line">
                      <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 w-8">#</th>
                      {target.fields.slice(0, 7).map((field) => (
                        <th key={field.key} className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">{field.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedPreview.map((row, index) => (
                      <tr key={index} className="border-b border-line last:border-0">
                        <td className="px-3 py-1.5 text-[11px] text-fg/25 font-mono">{index + 1}</td>
                        {target.fields.slice(0, 7).map((field) => (
                          <td key={field.key} className="max-w-[160px] truncate px-3 py-1.5 text-xs text-fg/65">
                            {row[field.key] || <span className="text-fg/15">&mdash;</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {mappedPreview.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-8 text-center text-xs text-fg/30">No rows to preview</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {validation.errors.length > 0 && (
                <div className="shrink-0 max-h-24 overflow-y-auto border-t border-line px-4 py-2 space-y-1">
                  {validation.errors.slice(0, 3).map((error) => (
                    <div key={error} className="flex gap-1.5 text-[11px] text-danger">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{error}</span>
                    </div>
                  ))}
                  {validation.errors.length > 3 && (
                    <p className="text-[10px] text-fg/30">+{validation.errors.length - 3} more errors</p>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-fg/30" />
        <span className="text-xs text-fg/55">{label}</span>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

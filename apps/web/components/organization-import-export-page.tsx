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
  Columns3,
  Database,
  Download,
  Eye,
  FileJson,
  FileSpreadsheet,
  Filter,
  FolderOpen,
  Library,
  ListChecks,
  Loader2,
  Play,
  RefreshCw,
  Search,
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
  getCustomers,
  getEntityCategories,
  getProjects,
  listEstimateFactorLibraryEntries,
  listKnowledgeBooks,
  listKnowledgeDocuments,
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
  catalogs: number;
  rateSchedules: number;
  entityCategories: number;
  conditionLibrary: number;
  factors: number;
  knowledgeBooks: number;
  knowledgeDocuments: number;
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
    countKey: "catalogs",
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

const SAMPLE_SOURCE: ParsedSource = {
  name: "Legacy estimate sample.csv",
  rows: [
    { "Cost Type": "labour", "Item Description": "Install chilled water valves", Qty: "18", UM: "ea", "Unit Cost": "$74.50", "Markup %": "18%", Supplier: "Field crew" },
    { "Cost Type": "material", "Item Description": "6 in. grooved elbow", Qty: "42", UM: "each", "Unit Cost": "$31.20", "Markup %": "22%", Supplier: "Northline Supply" },
    { "Cost Type": "equipment", "Item Description": "Scissor lift", Qty: "3", UM: "day", "Unit Cost": "$185", "Markup %": "15%", Supplier: "Rental Desk" },
    { "Cost Type": "subcontractor", "Item Description": "Controls termination allowance", Qty: "1", UM: "lot", "Unit Cost": "$4,800", "Markup %": "12%", Supplier: "Summit Controls" },
  ],
  columns: ["Cost Type", "Item Description", "Qty", "UM", "Unit Cost", "Markup %", "Supplier"],
};

const EMPTY_COUNTS: OrgCounts = {
  projects: 0,
  customers: 0,
  catalogs: 0,
  rateSchedules: 0,
  entityCategories: 0,
  conditionLibrary: 0,
  factors: 0,
  knowledgeBooks: 0,
  knowledgeDocuments: 0,
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

function toneClass(tone: ExportSection["tone"]) {
  return {
    accent: "border-accent/25 bg-accent/8 text-accent",
    blue: "border-blue-500/20 bg-blue-500/8 text-blue-500",
    green: "border-success/20 bg-success/8 text-success",
    violet: "border-violet-500/20 bg-violet-500/8 text-violet-500",
    amber: "border-warning/20 bg-warning/8 text-warning",
    rose: "border-rose-500/20 bg-rose-500/8 text-rose-500",
    slate: "border-fg/15 bg-fg/6 text-fg/60",
  }[tone];
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

  const [source, setSource] = useState<ParsedSource | null>(SAMPLE_SOURCE);
  const [targetId, setTargetId] = useState(IMPORT_TARGETS[1].id);
  const [mappings, setMappings] = useState<Record<string, FieldMapping>>(() => guessMappings(SAMPLE_SOURCE, IMPORT_TARGETS[1]));
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
        categories,
        conditions,
        factors,
        books,
        documents,
      ] = await Promise.allSettled([
        getProjects(),
        getCustomers(),
        getCatalogs(),
        listRateSchedules(),
        getEntityCategories(),
        getConditionLibrary(),
        listEstimateFactorLibraryEntries(),
        listKnowledgeBooks(),
        listKnowledgeDocuments(),
      ]);
      setCounts({
        projects: projects.status === "fulfilled" ? projects.value.length : 0,
        customers: customers.status === "fulfilled" ? customers.value.length : 0,
        catalogs: catalogs.status === "fulfilled" ? catalogs.value.length : 0,
        rateSchedules: schedules.status === "fulfilled" ? schedules.value.length : 0,
        entityCategories: categories.status === "fulfilled" ? categories.value.length : 0,
        conditionLibrary: conditions.status === "fulfilled" ? conditions.value.length : 0,
        factors: factors.status === "fulfilled" ? factors.value.length : 0,
        knowledgeBooks: books.status === "fulfilled" ? books.value.length : 0,
        knowledgeDocuments: documents.status === "fulfilled" ? documents.value.length : 0,
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-fg">Organization Import / Export</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-fg/45">
            <span>{organizationName || brand.companyName || "Current organization"}</span>
            <span className="h-1 w-1 rounded-full bg-fg/25" />
            <span>{formatCount(counts.projects)} estimates</span>
            <span className="h-1 w-1 rounded-full bg-fg/25" />
            <span>{formatCount(counts.catalogs + counts.rateSchedules + counts.factors)} library records</span>
            {countsLoading && <Loader2 className="h-3 w-3 animate-spin text-fg/30" />}
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-panel2/40 p-1">
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

      {mode === "export" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Export scope</CardTitle>
                <p className="mt-0.5 text-xs text-fg/45">Select the organizational data to package.</p>
              </div>
              <Button variant="ghost" size="xs" onClick={refreshCounts} disabled={countsLoading}>
                {countsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Refresh
              </Button>
            </CardHeader>
            <div className="grid gap-px bg-line md:grid-cols-2">
              {EXPORT_SECTIONS.map((section) => {
                const Icon = section.icon;
                const checked = selectedSections[section.id];
                const sectionCount = section.id === "users"
                  ? users.length
                  : section.id === "datasets"
                    ? datasets.length
                    : section.countKey
                      ? counts[section.countKey]
                      : 0;
                const toggleSection = () => setSelectedSections((current) => ({ ...current, [section.id]: !current[section.id] }));
                return (
                  <div
                    key={section.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={checked}
                    onClick={toggleSection}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleSection();
                      }
                    }}
                    className={cn(
                      "group flex min-h-[132px] cursor-pointer flex-col bg-panel p-4 text-left transition-colors hover:bg-panel2/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35",
                      checked && "bg-panel2/30",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-lg border", toneClass(section.tone))}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-fg">{section.label}</span>
                          <Badge className="shrink-0 text-[10px]">{formatCount(sectionCount)}</Badge>
                        </div>
                        <p className="mt-0.5 text-[10px] font-medium uppercase text-fg/35">{section.category}</p>
                      </div>
                      <span onClick={(event) => event.stopPropagation()}>
                        <Toggle checked={checked} onChange={(value) => setSelectedSections((current) => ({ ...current, [section.id]: value }))} />
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {section.includes.map((item) => (
                        <span key={item} className="rounded-md border border-line bg-bg/45 px-1.5 py-0.5 text-[10px] text-fg/45">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Package options</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <Label>Format</Label>
                  <Select
                    value={format}
                    onValueChange={(value) => setFormat(value as ExportFormat)}
                    options={[
                      { value: "bidwright-json", label: "Bidwright JSON bundle" },
                      { value: "excel-workbook", label: "Excel workbook" },
                      { value: "csv-folder", label: "CSV folder manifest" },
                      { value: "zip-archive", label: "ZIP archive" },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>From</Label>
                    <Input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} />
                  </div>
                  <div>
                    <Label>To</Label>
                    <Input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} />
                  </div>
                </div>
                <Separator />
                <OptionRow icon={FolderOpen} label="Attachments" checked={includeAttachments} onChange={setIncludeAttachments} />
                <OptionRow icon={Wand2} label="AI derived data" checked={includeDerived} onChange={setIncludeDerived} />
                <OptionRow icon={ShieldCheck} label="Anonymize pricing" checked={anonymizePricing} onChange={setAnonymizePricing} />
                <OptionRow icon={Archive} label="Inactive records" checked={includeInactive} onChange={setIncludeInactive} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Export run</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                <div className="rounded-lg border border-line bg-bg/45 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg/55">Selected sections</span>
                    <span className="font-semibold text-fg">{selectedExportSections.length}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedExportSections.map((section) => (
                      <Badge key={section.id} tone="default" className="text-[10px]">{section.label}</Badge>
                    ))}
                  </div>
                </div>
                <Button className="w-full" variant="accent" onClick={handleDownloadExport} disabled={exporting || selectedExportSections.length === 0}>
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
                  Download Org Bundle
                </Button>
                <Button className="w-full" variant="secondary" onClick={exportAllDataManagement} disabled={exporting}>
                  <Download className="h-3.5 w-3.5" />
                  Export Library Data
                </Button>
                {exportMessage && <p className="text-[11px] text-success">{exportMessage}</p>}
              </CardBody>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Source file</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex min-h-[138px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-line bg-bg/45 px-4 text-center transition-colors hover:border-accent/45 hover:bg-accent/5"
                >
                  <Upload className="h-7 w-7 text-fg/35" />
                  <span className="mt-3 text-sm font-semibold text-fg">Upload CSV, Excel, or JSON</span>
                  <span className="mt-1 text-xs text-fg/40">Mapping starts after parsing the first sheet or table.</span>
                </button>
                <input ref={fileRef} type="file" accept=".csv,.tsv,.json,.xlsx,.xls,.xlsm" className="hidden" onChange={handleFileChange} />
                {fileError && (
                  <div className="flex gap-2 rounded-lg border border-danger/25 bg-danger/8 p-3 text-xs text-danger">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {fileError}
                  </div>
                )}
                {source && (
                  <div className="rounded-lg border border-line bg-panel2/35 p-3">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet className="h-4 w-4 text-success" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-fg">{source.name}</p>
                        <p className="text-[10px] text-fg/40">{source.rows.length} rows · {source.columns.length} columns{source.sheetName ? ` · ${source.sheetName}` : ""}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Import target</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <Label>Object</Label>
                  <Select
                    value={target.id}
                    onValueChange={handleTargetChange}
                    options={IMPORT_TARGETS.map((item) => ({ value: item.id, label: item.label }))}
                  />
                </div>
                <div>
                  <Label>Match records by</Label>
                  <Select
                    value={matchStrategy}
                    onValueChange={setMatchStrategy}
                    options={target.fields.map((field) => ({ value: field.key, label: field.label }))}
                  />
                </div>
                <div>
                  <Label>Conflict handling</Label>
                  <Select
                    value={conflictMode}
                    onValueChange={(value) => setConflictMode(value as ConflictMode)}
                    options={[
                      { value: "dry-run", label: "Validate only" },
                      { value: "add-update", label: "Add and update" },
                      { value: "skip-existing", label: "Skip existing" },
                      { value: "replace-matches", label: "Replace matches" },
                    ]}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" onClick={handleDownloadTemplate}>
                    <Download className="h-3.5 w-3.5" />
                    Template
                  </Button>
                  <Button variant="secondary" size="sm" onClick={handleDownloadMapping}>
                    <FileJson className="h-3.5 w-3.5" />
                    Mapping
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div>
                  <CardTitle>Column mapping</CardTitle>
                  <p className="mt-0.5 text-xs text-fg/45">Transform source columns into Bidwright fields.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={qualityScore >= 80 ? "success" : qualityScore >= 55 ? "warning" : "danger"}>{qualityScore}% mapped</Badge>
                  <Button variant="ghost" size="xs" onClick={() => source && setMappings(guessMappings(source, target))}>
                    <Wand2 className="h-3 w-3" />
                    Infer
                  </Button>
                </div>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line bg-bg/35">
                      <th className="w-48 px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-fg/40">Bidwright field</th>
                      <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-fg/40">Source column</th>
                      <th className="w-44 px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-fg/40">Transform</th>
                      <th className="w-40 px-4 py-2.5 text-left text-[10px] font-semibold uppercase text-fg/40">Constant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {target.fields.map((field) => {
                      const mapping = mappings[field.key] ?? { sourceColumn: "", fallback: "", transform: defaultTransformForType(field.type) };
                      return (
                        <tr key={field.key} className="border-b border-line last:border-0">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-fg">{field.label}</span>
                              {field.required && <Badge tone="warning" className="text-[9px]">Required</Badge>}
                            </div>
                            <p className="text-[10px] text-fg/35">{field.type}</p>
                          </td>
                          <td className="px-4 py-2.5">
                            <Select
                              size="sm"
                              value={mapping.sourceColumn}
                              onValueChange={(value) => updateMapping(field.key, { sourceColumn: value })}
                              options={[{ value: "", label: "Unmapped" }, ...(source?.columns ?? []).map((column) => ({ value: column, label: column }))]}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <Select
                              size="sm"
                              value={mapping.transform}
                              onValueChange={(value) => updateMapping(field.key, { transform: value as TransformKind })}
                              options={TRANSFORM_OPTIONS}
                            />
                          </td>
                          <td className="px-4 py-2.5">
                            <Input
                              className="h-8 text-xs"
                              value={mapping.fallback}
                              onChange={(event) => updateMapping(field.key, { fallback: event.target.value })}
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

            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_300px]">
              <Card className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Transformed preview</CardTitle>
                    <p className="mt-0.5 text-xs text-fg/45">First rows after mapping and transforms.</p>
                  </div>
                  <Badge tone={validation.errors.length === 0 ? "success" : "danger"}>
                    {validation.validRows}/{source?.rows.length ?? 0} valid
                  </Badge>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-xs">
                    <thead>
                      <tr className="border-b border-line bg-bg/35">
                        {target.fields.slice(0, 7).map((field) => (
                          <th key={field.key} className="px-3 py-2 text-left text-[10px] font-semibold uppercase text-fg/40">{field.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mappedPreview.map((row, index) => (
                        <tr key={index} className="border-b border-line last:border-0">
                          {target.fields.slice(0, 7).map((field) => (
                            <td key={field.key} className="max-w-[180px] truncate px-3 py-2 text-fg/65">{row[field.key] || <span className="text-fg/20">Empty</span>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Validation</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <Metric label="Rows" value={source?.rows.length ?? 0} />
                    <Metric label="Errors" value={validation.errors.length} tone={validation.errors.length ? "danger" : "success"} />
                    <Metric label="Warn" value={validation.warnings.length} tone={validation.warnings.length ? "warning" : "default"} />
                  </div>
                  <div className="space-y-2">
                    {validation.errors.slice(0, 4).map((error) => (
                      <div key={error} className="flex gap-2 rounded-md border border-danger/20 bg-danger/8 px-2 py-1.5 text-[11px] text-danger">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>{error}</span>
                      </div>
                    ))}
                    {validation.errors.length === 0 && (
                      <div className="flex gap-2 rounded-md border border-success/20 bg-success/8 px-2 py-1.5 text-[11px] text-success">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                        <span>Mapping validates against required fields.</span>
                      </div>
                    )}
                  </div>
                  {importing && (
                    <div className="space-y-2">
                      <Progress value={importProgress} />
                      <p className="text-[11px] text-fg/40">{importProgress}% staged</p>
                    </div>
                  )}
                  {importResult && (
                    <div className="rounded-lg border border-line bg-bg/45 p-3 text-xs">
                      <div className="flex items-center gap-2 font-semibold text-fg">
                        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        Import run staged
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <Metric label="Create" value={importResult.created} tone="success" />
                        <Metric label="Update" value={importResult.updated} tone="default" />
                        <Metric label="Skip" value={importResult.skipped} tone="warning" />
                      </div>
                    </div>
                  )}
                  <Button className="w-full" variant="accent" onClick={handleRunImport} disabled={!source || importing || validation.errors.length > 0}>
                    {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : conflictMode === "dry-run" ? <Eye className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {conflictMode === "dry-run" ? "Run Validation" : "Stage Import"}
                  </Button>
                </CardBody>
              </Card>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardBody className="grid gap-3 md:grid-cols-4">
          <StatusPill icon={Columns3} label="Column mapping" value={`${mappedFieldCount}/${target.fields.length}`} />
          <StatusPill icon={Search} label="Match key" value={matchStrategy} />
          <StatusPill icon={Filter} label="Conflict mode" value={conflictMode.replace("-", " ")} />
          <StatusPill icon={FileJson} label="Export format" value={format.replace("-", " ")} />
        </CardBody>
      </Card>
    </div>
  );
}

function OptionRow({
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
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-fg/35" />
        <span className="truncate text-xs font-medium text-fg/60">{label}</span>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClassName = {
    default: "text-fg",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
  }[tone];
  return (
    <div className="rounded-md border border-line bg-panel px-2 py-1.5">
      <div className={cn("text-sm font-semibold tabular-nums", toneClassName)}>{value}</div>
      <div className="text-[9px] font-medium uppercase text-fg/35">{label}</div>
    </div>
  );
}

function StatusPill({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-bg/45 px-3 py-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-fg/35" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase text-fg/35">{label}</p>
        <p className="truncate text-xs font-semibold capitalize text-fg/70">{value}</p>
      </div>
    </div>
  );
}

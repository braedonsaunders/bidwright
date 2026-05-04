"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  History,
  Loader2,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { SearchablePicker, type SearchablePickerOption } from "@/components/shared/searchable-picker";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  analyzeCostSpreadsheetEvidence,
  analyzeVendorPdfEvidence,
  approveVendorPdfCandidates,
  createEffectiveCost,
  deleteEffectiveCost,
  deleteEffectiveCosts,
  deleteVendorPdfReviewRun,
  getVendorPdfReviewRun,
  getVendorPdfAgentReviewOutput,
  getSettings,
  listEffectiveCosts,
  listCostObservations,
  listCostResources,
  listCostVendors,
  listVendorPdfReviewRuns,
  runVendorPdfAgentReview,
  updateEffectiveCost,
  type EffectiveCostRecord,
  type EffectiveCostManualInput,
  type EffectiveCostPatchInput,
  type VendorPdfAnalyzeResult,
  type VendorPdfAgentReviewRunResult,
  type VendorPdfApprovalResult,
  type VendorPdfReviewRunSummary,
  type VendorPdfReviewCandidate,
  type CostVendorRecord,
  type CostVendorProductRecord,
  type CostObservationRecord,
  type CostResourceRecord,
} from "@/lib/api";

const COST_INTELLIGENCE_SUBTABS = [
  { id: "costs", label: "Cost Basis", description: "Approved current costs" },
  { id: "ingest", label: "Import", description: "Bring in cost evidence" },
  { id: "vendors", label: "Vendors", description: "Vendor products and evidence" },
] as const;

const COST_CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF", "JPY"] as const;
const COST_BASIS_COUNT_LIMIT = 50000;
const VENDOR_DETAIL_SUBTABS = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "products", label: "Products", icon: PackageSearch },
  { id: "evidence", label: "Evidence", icon: History },
] as const;

type CostIntelligenceSubtab = typeof COST_INTELLIGENCE_SUBTABS[number]["id"];
type VendorDetailTab = typeof VENDOR_DETAIL_SUBTABS[number]["id"];
type CostImportSource = "csv" | "excel" | "estimate" | "pdf";
type CostConfidenceFilter = "all" | "high" | "review" | "low";
type EvidenceFilter = "all" | "multi" | "single" | "stale";
type CostSort = "updated" | "name" | "cost_desc" | "confidence_desc" | "sample_desc";
type VendorRegistrySort = "latest_desc" | "name_asc" | "products_desc" | "evidence_desc" | "cost_basis_desc";
type VendorProductSort = "latest_desc" | "name_asc" | "cost_desc" | "cost_asc" | "trend_desc" | "evidence_desc";
type EffectiveCostDrawerMode = "create" | "edit";
type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

const COST_IMPORT_OPTIONS: Array<{
  id: CostImportSource;
  label: string;
  description: string;
  badge: string;
  icon: typeof FileText;
}> = [
  { id: "csv", label: "CSV", description: "Import mapped cost rows from a flat file.", badge: "Next", icon: FileText },
  { id: "excel", label: "Excel", description: "Import workbook cost sheets with column mapping.", badge: "Next", icon: FileSpreadsheet },
  { id: "estimate", label: "Existing Estimate", description: "Promote estimate items into the cost review queue.", badge: "Next", icon: Database },
  { id: "pdf", label: "PDF Intake", description: "Extract vendor PDFs into an editable AI review queue.", badge: "Ready", icon: UploadCloud },
];

type VendorPdfImportSessionState = {
  ingesting: boolean;
  ingestError: string | null;
  vendorPdfFiles: File[];
  analysisResult: VendorPdfAnalyzeResult | null;
  reviewCandidates: VendorPdfReviewCandidate[];
  approvalResult: VendorPdfApprovalResult | null;
  agentReviewRun: VendorPdfAgentReviewRunResult | null;
  agentReviewLoading: boolean;
  agentReviewError: string | null;
  activeImportSource: CostImportSource | null;
};

type VendorPdfImportSessionPatch =
  | Partial<VendorPdfImportSessionState>
  | ((state: VendorPdfImportSessionState) => Partial<VendorPdfImportSessionState>);

const emptyVendorPdfImportSession: VendorPdfImportSessionState = {
  ingesting: false,
  ingestError: null,
  vendorPdfFiles: [],
  analysisResult: null,
  reviewCandidates: [],
  approvalResult: null,
  agentReviewRun: null,
  agentReviewLoading: false,
  agentReviewError: null,
  activeImportSource: null,
};

function isDiscardableDuplicateCandidate(candidate: VendorPdfReviewCandidate) {
  return (
    candidate.recommendation === "duplicate" ||
    candidate.recommendation === "discard" ||
    Boolean(candidate.duplicateObservationId)
  );
}

function acceptsCostImportFile(file: File, source: CostImportSource | null) {
  const name = file.name.toLowerCase();
  if (source === "pdf") return file.type === "application/pdf" || name.endsWith(".pdf");
  if (source === "csv") return file.type === "text/csv" || name.endsWith(".csv");
  if (source === "excel") return (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    file.type === "application/vnd.ms-excel" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  return false;
}

function importSourceForAnalysis(result: VendorPdfAnalyzeResult): CostImportSource {
  if (result.pipeline.extractionProvider === "spreadsheet_file") {
    return result.files.some((file) => /\.csv$/i.test(file.fileName)) ? "csv" : "excel";
  }
  return "pdf";
}

let vendorPdfImportSession: VendorPdfImportSessionState = emptyVendorPdfImportSession;
const vendorPdfImportSessionListeners = new Set<() => void>();

function getVendorPdfImportSession() {
  return vendorPdfImportSession;
}

function subscribeVendorPdfImportSession(listener: () => void) {
  vendorPdfImportSessionListeners.add(listener);
  return () => vendorPdfImportSessionListeners.delete(listener);
}

function updateVendorPdfImportSession(patch: VendorPdfImportSessionPatch) {
  const nextPatch = typeof patch === "function" ? patch(vendorPdfImportSession) : patch;
  vendorPdfImportSession = { ...vendorPdfImportSession, ...nextPatch };
  vendorPdfImportSessionListeners.forEach((listener) => listener());
}

function hasActiveVendorPdfImportSession() {
  return (
    vendorPdfImportSession.activeImportSource !== null ||
    vendorPdfImportSession.ingesting ||
    vendorPdfImportSession.agentReviewLoading ||
    vendorPdfImportSession.vendorPdfFiles.length > 0 ||
    vendorPdfImportSession.analysisResult !== null ||
    vendorPdfImportSession.reviewCandidates.length > 0
  );
}

type EffectiveCostFormState = {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  category: string;
  code: string;
  vendorName: string;
  region: string;
  uom: string;
  unitCost: string;
  unitPrice: string;
  currency: string;
  effectiveDate: string;
  expiresAt: string;
  method: "manual" | "contract";
  sampleSize: string;
  confidence: string;
  notes: string;
};

const emptyEffectiveCostForm: EffectiveCostFormState = {
  resourceId: "",
  resourceName: "",
  resourceType: "material",
  category: "Material",
  code: "",
  vendorName: "",
  region: "",
  uom: "EA",
  unitCost: "",
  unitPrice: "",
  currency: "USD",
  effectiveDate: "",
  expiresAt: "",
  method: "manual",
  sampleSize: "1",
  confidence: "75",
  notes: "",
};

function formatMoney(value: number | null | undefined, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "No date";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : value;
}

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const direct = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function compactCount(value: number) {
  return new Intl.NumberFormat("en-US", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function average(values: number[]) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function formatNumberInput(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : String(value);
}

function formatPercentInput(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : String(Math.round(value * 1000) / 10);
}

function parseOptionalNumber(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRequiredNumber(value: string): number | undefined {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseConfidence(value: string): number | undefined {
  const parsed = parseRequiredNumber(value);
  return parsed === undefined ? undefined : Math.max(0, Math.min(1, parsed / 100));
}

function normalizeCurrency(value: string) {
  return (value.trim().toUpperCase() || "USD").slice(0, 3);
}

function methodLabel(value: string) {
  return value.replace(/_/g, " ");
}

function confidenceTone(confidence: number): "success" | "warning" | "danger" {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.65) return "warning";
  return "danger";
}

function documentTypeLabel(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/^legacy_/, "").replace(/_/g, " ").trim();
  if (!normalized) return "Evidence";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function reviewRunStatusLabel(status: VendorPdfReviewRunSummary["status"]) {
  if (status === "reviewed") return "AI reviewed";
  if (status === "analyzed") return "Analyzed";
  return "Uploaded";
}

function looksGeneratedIdentifier(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return /^rci-adminapp2-[a-f0-9]{16,}$/i.test(text) || /^price-[a-f0-9]{16,}$/i.test(text);
}

function displayToken(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return text && !looksGeneratedIdentifier(text) ? text : "";
}

function metadataObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function metadataText(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? displayToken(value) : "";
}

function costItemMetadata(cost: EffectiveCostRecord) {
  const item = metadataObject(cost.metadata?.costItem);
  return {
    name: metadataText(item ?? undefined, "name") || metadataText(cost.metadata, "resourceName") || metadataText(cost.metadata, "name"),
    code: metadataText(item ?? undefined, "code"),
    category: metadataText(item ?? undefined, "category"),
    resourceType: metadataText(item ?? undefined, "resourceType"),
    defaultUom: metadataText(item ?? undefined, "defaultUom"),
  };
}

function costResourceName(cost: EffectiveCostRecord) {
  const resourceName = displayToken(cost.resource?.name);
  if (resourceName) return resourceName;
  const metadataName = costItemMetadata(cost).name;
  if (metadataName) return metadataName;
  const rawText = cost.sourceObservation?.rawText?.split("|")[0]?.trim();
  if (rawText && !looksGeneratedIdentifier(rawText)) return rawText;
  const metadataTitle = typeof cost.metadata?.title === "string" ? cost.metadata.title : "";
  return displayToken(metadataTitle) || "Unnamed cost basis row";
}

function costResourceCode(cost: EffectiveCostRecord) {
  return displayToken(cost.resource?.code) || costItemMetadata(cost).code;
}

function costResourceCategory(cost: EffectiveCostRecord) {
  return displayToken(cost.resource?.category) || costItemMetadata(cost).category || "Uncategorized";
}

function costResourceType(cost: EffectiveCostRecord) {
  return displayToken(cost.resource?.resourceType) || costItemMetadata(cost).resourceType || "other";
}

function costVendor(cost: EffectiveCostRecord) {
  return cost.vendorName?.trim() || cost.sourceObservation?.vendorName?.trim() || "All vendors";
}

function costEvidenceDate(cost: EffectiveCostRecord) {
  return cost.effectiveDate || cost.sourceObservation?.effectiveDate || cost.sourceObservation?.observedAt || cost.updatedAt;
}

function costSourceLabel(cost: EffectiveCostRecord) {
  return documentTypeLabel(cost.sourceObservation?.documentType || String(cost.metadata?.source ?? ""));
}

function costEvidenceText(cost: EffectiveCostRecord) {
  return cost.sourceObservation?.rawText || String(cost.metadata?.rawText ?? "");
}

function costItemSecondaryLabel(cost: EffectiveCostRecord) {
  return (
    displayToken(cost.resource?.manufacturerPartNumber) ||
    displayToken(cost.resource?.code) ||
    displayToken(cost.sourceObservation?.vendorSku) ||
    costSourceLabel(cost)
  );
}

function ageDays(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

function dateMillis(value: string | null | undefined) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function isStale(cost: EffectiveCostRecord) {
  return ageDays(costEvidenceDate(cost)) > 180;
}

function normalizeVendorToken(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function vendorNamesMatch(candidate: string | null | undefined, selected: string) {
  const normalizedCandidate = normalizeVendorToken(candidate) || "all vendors";
  const normalizedSelected = normalizeVendorToken(selected) || "all vendors";
  return normalizedCandidate === normalizedSelected;
}

function normalizeProductToken(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function observationProductName(observation: CostObservationRecord, resourceById: Map<string, CostResourceRecord>) {
  const resource = observation.resourceId ? resourceById.get(observation.resourceId) : null;
  if (resource?.name) return resource.name;
  const rawText = observation.rawText?.split("|")[0]?.trim();
  if (rawText && !looksGeneratedIdentifier(rawText)) return rawText;
  return displayToken(observation.vendorSku) || "Vendor product";
}

function observationProductKey(observation: CostObservationRecord, resourceById: Map<string, CostResourceRecord>) {
  return [
    normalizeProductToken(observation.vendorSku),
    observation.resourceId ?? normalizeProductToken(observationProductName(observation, resourceById)),
    normalizeProductToken(observation.observedUom),
    normalizeProductToken(observation.currency),
  ].join("|");
}

function vendorProductRecordKey(product: CostVendorProductRecord) {
  return [
    normalizeProductToken(product.vendorSku),
    product.resourceId ?? normalizeProductToken(product.name),
    normalizeProductToken(product.uom),
    normalizeProductToken(product.currency),
  ].join("|");
}

function productTrendPercent(product: Pick<VendorProductTableRow, "latestUnitCost" | "previousUnitCost">) {
  if (!product.previousUnitCost || product.previousUnitCost <= 0) return null;
  return ((product.latestUnitCost - product.previousUnitCost) / product.previousUnitCost) * 100;
}

type ChartPoint = {
  label: string;
  value: number;
};

type VendorProductTableRow = {
  key: string;
  vendorSku: string;
  name: string;
  resourceName: string;
  uom: string;
  currency: string;
  latestUnitCost: number;
  previousUnitCost: number | null;
  averageUnitCost: number;
  minUnitCost: number;
  maxUnitCost: number;
  observationCount: number;
  costBasisCount: number;
  firstObservedAt: string | null;
  latestObservedAt: string | null;
  points: ChartPoint[];
};

function formatChartMonth(value: string) {
  const date = new Date(`${value}-01T00:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function chartPath(points: ChartPoint[], width: number, height: number, padding = 14) {
  const values = points.map((point) => point.value).filter(Number.isFinite);
  if (points.length === 0 || values.length === 0) return { line: "", area: "", scaled: [] as Array<{ x: number; y: number; value: number; label: string }> };
  const minRaw = Math.min(...values);
  const maxRaw = Math.max(...values);
  const spread = maxRaw - minRaw;
  const min = spread === 0 ? minRaw - 1 : minRaw - spread * 0.12;
  const max = spread === 0 ? maxRaw + 1 : maxRaw + spread * 0.12;
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const scaled = points.map((point, index) => {
    const x = padding + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const y = height - padding - ((point.value - min) / Math.max(1, max - min)) * innerHeight;
    return { x, y, value: point.value, label: point.label };
  });
  const line = scaled.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const first = scaled[0];
  const last = scaled[scaled.length - 1];
  const area = first && last ? `${line} L ${last.x.toFixed(2)} ${height - padding} L ${first.x.toFixed(2)} ${height - padding} Z` : "";
  return { line, area, scaled };
}

function PriceIndexChart({
  emptyLabel = "No price history yet",
  points,
  suffix = "",
}: {
  emptyLabel?: string;
  points: ChartPoint[];
  suffix?: string;
}) {
  const width = 640;
  const height = 190;
  const { line, area, scaled } = chartPath(points, width, height, 18);
  const latest = points.at(-1);
  const first = points[0];
  const delta = latest && first ? latest.value - first.value : 0;

  if (points.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-line bg-bg/35 text-xs text-fg/35">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="relative h-48 overflow-hidden rounded-lg border border-line bg-bg/35 p-3">
      <div className="absolute left-3 top-3 z-10">
        <div className="text-[10px] uppercase text-fg/35">Price over time</div>
        <div className="mt-0.5 flex items-baseline gap-2">
          <span className="text-lg font-semibold tabular-nums text-fg">{latest?.value.toFixed(suffix ? 0 : 2)}{suffix}</span>
          <span className={cn("text-[11px] tabular-nums", delta >= 0 ? "text-warning" : "text-success")}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(suffix ? 0 : 2)}{suffix}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible text-accent" role="img" aria-label="Vendor price over time chart">
        <defs>
          <linearGradient id="vendor-price-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1="18" x2={width - 18} y1={height * ratio} y2={height * ratio} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
        ))}
        <motion.path initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} d={area} fill="url(#vendor-price-area)" />
        <motion.path
          initial={{ pathLength: 0, opacity: 0.3 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.75, ease: "easeOut" }}
          d={line}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3"
        />
        {scaled.map((point, index) => (
          <circle key={`${point.label}-${index}`} cx={point.x} cy={point.y} r={index === scaled.length - 1 ? 4 : 2.5} fill="currentColor" opacity={index === scaled.length - 1 ? 1 : 0.38} />
        ))}
        <text x="18" y={height - 2} fill="currentColor" opacity="0.42" fontSize="16">{formatChartMonth(points[0]?.label ?? "")}</text>
        <text x={width - 18} y={height - 2} fill="currentColor" opacity="0.42" fontSize="16" textAnchor="end">{formatChartMonth(points.at(-1)?.label ?? "")}</text>
      </svg>
    </div>
  );
}

function EvidenceBars({ points }: { points: ChartPoint[] }) {
  const max = Math.max(1, ...points.map((point) => point.value));

  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-line bg-bg/35 text-xs text-fg/35">
        No evidence volume yet
      </div>
    );
  }

  return (
    <div className="h-48 rounded-lg border border-line bg-bg/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase text-fg/35">Evidence volume</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{points.reduce((sum, point) => sum + point.value, 0).toLocaleString()}</div>
        </div>
        <Badge tone="info">{points.length} periods</Badge>
      </div>
      <div className="flex h-28 items-end gap-1.5">
        {points.slice(-18).map((point, index) => (
          <div key={`${point.label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(8, (point.value / max) * 100)}%` }}
              transition={{ duration: 0.35, delay: index * 0.015 }}
              className="w-full rounded-t bg-success/70"
              title={`${formatChartMonth(point.label)}: ${point.value}`}
            />
            {index === 0 || index === points.slice(-18).length - 1 ? (
              <span className="w-12 truncate text-center text-[9px] text-fg/35">{formatChartMonth(point.label)}</span>
            ) : (
              <span className="h-3 text-[9px] text-transparent">.</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProductSparkline({ points }: { points: ChartPoint[] }) {
  const width = 96;
  const height = 28;
  const sorted = points.slice(-16);
  const { line } = chartPath(sorted, width, height, 3);
  if (sorted.length < 2) return <div className="h-7 w-24 rounded bg-panel2/65" />;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-7 w-24 text-accent" aria-hidden="true">
      <path d={line} fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function formFromEffectiveCost(cost: EffectiveCostRecord): EffectiveCostFormState {
  const metadata = costItemMetadata(cost);
  return {
    resourceId: cost.resourceId ?? "",
    resourceName: costResourceName(cost),
    resourceType: costResourceType(cost),
    category: costResourceCategory(cost),
    code: costResourceCode(cost),
    vendorName: cost.vendorName ?? "",
    region: cost.region ?? "",
    uom: cost.uom || cost.resource?.defaultUom || metadata.defaultUom || "EA",
    unitCost: formatNumberInput(cost.unitCost),
    unitPrice: formatNumberInput(cost.unitPrice),
    currency: cost.currency || "USD",
    effectiveDate: dateInputValue(cost.effectiveDate),
    expiresAt: dateInputValue(cost.expiresAt),
    method: cost.method === "contract" ? "contract" : "manual",
    sampleSize: String(cost.sampleSize ?? 1),
    confidence: formatPercentInput(cost.confidence),
    notes: typeof cost.metadata?.notes === "string" ? cost.metadata.notes : "",
  };
}

function buildEffectiveCostPayload(form: EffectiveCostFormState): EffectiveCostManualInput | null {
  const unitCost = parseRequiredNumber(form.unitCost);
  const unitPrice = parseOptionalNumber(form.unitPrice);
  const sampleSize = parseRequiredNumber(form.sampleSize);
  const confidence = parseConfidence(form.confidence);
  if (unitCost === undefined || unitCost < 0) return null;
  if (unitPrice === undefined || (unitPrice !== null && unitPrice < 0)) return null;
  if (sampleSize === undefined || sampleSize < 0) return null;
  if (confidence === undefined) return null;
  const resourceId = form.resourceId.trim();
  const resourceName = form.resourceName.trim();
  if (!resourceId && !resourceName) return null;
  return {
    resourceId: resourceId || null,
    resourceName: resourceId ? undefined : resourceName,
    resourceType: form.resourceType.trim() || "material",
    category: form.category.trim(),
    code: form.code.trim(),
    defaultUom: form.uom.trim().toUpperCase() || "EA",
    vendorName: form.vendorName.trim(),
    region: form.region.trim(),
    uom: form.uom.trim().toUpperCase() || "EA",
    unitCost,
    unitPrice,
    currency: normalizeCurrency(form.currency),
    effectiveDate: form.effectiveDate.trim() || null,
    expiresAt: form.expiresAt.trim() || null,
    method: form.method,
    sampleSize: Math.round(sampleSize),
    confidence,
    metadata: {
      source: "manual_cost_basis",
      notes: form.notes.trim(),
    },
  };
}

function PanelPagination({
  label,
  onPageChange,
  page,
  pageSize,
  total,
}: {
  label: string;
  onPageChange: (page: number) => void;
  page: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-t border-line px-3 text-[11px] text-fg/45">
      <span className="tabular-nums">{start}-{end} of {total} {label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page <= 0}
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg/45 transition-colors hover:bg-panel2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-14 text-center tabular-nums">{page + 1} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg/45 transition-colors hover:bg-panel2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function VendorVisibilityFilter({
  excluded,
  onChange,
  vendors,
}: {
  excluded: string[];
  onChange: (vendors: string[]) => void;
  vendors: string[];
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const hidden = useMemo(() => new Set(excluded), [excluded]);
  const visibleCount = Math.max(0, vendors.length - hidden.size);
  const filteredVendors = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return vendors;
    return vendors.filter((vendor) => vendor.toLowerCase().includes(query));
  }, [search, vendors]);

  function toggleVendor(vendor: string) {
    if (hidden.has(vendor)) {
      onChange(excluded.filter((candidate) => candidate !== vendor));
    } else {
      onChange([...excluded, vendor]);
    }
  }

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-label="Vendors"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-panel px-2 text-left text-xs text-fg outline-none transition-colors hover:border-accent/30"
      >
        <span className="truncate">
          {excluded.length === 0 ? "All vendors" : `${compactCount(visibleCount)} / ${compactCount(vendors.length)} vendors`}
        </span>
        {excluded.length > 0 && <span className="shrink-0 text-[10px] text-fg/35">{compactCount(excluded.length)} hidden</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-line bg-panel shadow-xl">
          <div className="border-b border-line p-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search vendors"
              className="h-8 text-xs"
            />
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange([])}
                disabled={vendors.length === 0 || excluded.length === 0}
                className="h-7 justify-center text-xs"
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(vendors)}
                disabled={vendors.length === 0 || excluded.length === vendors.length}
                className="h-7 justify-center text-xs"
              >
                None
              </Button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {filteredVendors.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-fg/35">No vendors match.</div>
            ) : (
              filteredVendors.map((vendor) => {
                const checked = !hidden.has(vendor);
                return (
                  <button
                    key={vendor}
                    type="button"
                    onClick={() => toggleVendor(vendor)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-fg/70 hover:bg-panel2 hover:text-fg"
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        checked ? "border-accent bg-accent text-white" : "border-line bg-bg",
                      )}
                      aria-hidden="true"
                    >
                      {checked && (
                        <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{vendor}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CostIntelligencePanel({
  embedded = false,
  entrySurface = "settings.cost_database",
}: {
  embedded?: boolean;
  entrySurface?: string;
} = {}) {
  const [observations, setObservations] = useState<CostObservationRecord[]>([]);
  const [effectiveCosts, setEffectiveCosts] = useState<EffectiveCostRecord[]>([]);
  const [activeCostTab, setActiveCostTab] = useState<CostIntelligenceSubtab>(() => (
    hasActiveVendorPdfImportSession() ? "ingest" : "costs"
  ));
  const [query, setQuery] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [excludedVendors, setExcludedVendors] = useState<string[]>([]);
  const [confidenceFilter, setConfidenceFilter] = useState<CostConfidenceFilter>("all");
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>("all");
  const [sortBy, setSortBy] = useState<CostSort>("updated");
  const [costPage, setCostPage] = useState(0);
  const [evidencePage, setEvidencePage] = useState(0);
  const [resources, setResources] = useState<CostResourceRecord[]>([]);
  const [vendorRecords, setVendorRecords] = useState<CostVendorRecord[]>([]);
  const [selectedVendorName, setSelectedVendorName] = useState<string | null>(null);
  const [vendorDetail, setVendorDetail] = useState<CostVendorRecord | null>(null);
  const [vendorDetailObservations, setVendorDetailObservations] = useState<CostObservationRecord[]>([]);
  const [vendorDetailCosts, setVendorDetailCosts] = useState<EffectiveCostRecord[]>([]);
  const [vendorDetailLoading, setVendorDetailLoading] = useState(false);
  const [vendorDetailError, setVendorDetailError] = useState<string | null>(null);
  const [vendorDetailTab, setVendorDetailTab] = useState<VendorDetailTab>("overview");
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorSortBy, setVendorSortBy] = useState<VendorRegistrySort>("latest_desc");
  const [vendorProductQuery, setVendorProductQuery] = useState("");
  const [vendorProductSortBy, setVendorProductSortBy] = useState<VendorProductSort>("latest_desc");
  const [vendorProductPage, setVendorProductPage] = useState(0);
  const [drawerMode, setDrawerMode] = useState<EffectiveCostDrawerMode | null>(null);
  const [selectedCostId, setSelectedCostId] = useState<string | null>(null);
  const [costForm, setCostForm] = useState<EffectiveCostFormState>(() => ({ ...emptyEffectiveCostForm }));
  const [costSaving, setCostSaving] = useState(false);
  const [costDeleting, setCostDeleting] = useState(false);
  const [costFormError, setCostFormError] = useState<string | null>(null);
  const [selectedCostIds, setSelectedCostIds] = useState<Set<string>>(() => new Set());
  const [bulkDeletingCosts, setBulkDeletingCosts] = useState(false);
  const [bulkDeleteCostError, setBulkDeleteCostError] = useState<string | null>(null);
  const [bulkDeleteCostConfirmOpen, setBulkDeleteCostConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const {
    ingesting,
    ingestError,
    vendorPdfFiles,
    analysisResult,
    reviewCandidates,
    approvalResult,
    agentReviewRun,
    agentReviewLoading,
    agentReviewError,
    activeImportSource,
  } = useSyncExternalStore(
    subscribeVendorPdfImportSession,
    getVendorPdfImportSession,
    getVendorPdfImportSession,
  );
  const [organizationCurrency, setOrganizationCurrency] = useState("USD");
  const vendorPdfInputRef = useRef<HTMLInputElement | null>(null);
  const setIngesting = useCallback((value: boolean) => updateVendorPdfImportSession({ ingesting: value }), []);
  const setIngestError = useCallback((value: string | null) => updateVendorPdfImportSession({ ingestError: value }), []);
  const setVendorPdfFiles = useCallback((value: File[] | ((current: File[]) => File[])) => {
    updateVendorPdfImportSession((current) => ({
      vendorPdfFiles: typeof value === "function" ? value(current.vendorPdfFiles) : value,
    }));
  }, []);
  const setAnalysisResult = useCallback((value: VendorPdfAnalyzeResult | null) => updateVendorPdfImportSession({ analysisResult: value }), []);
  const setReviewCandidates = useCallback((value: VendorPdfReviewCandidate[] | ((current: VendorPdfReviewCandidate[]) => VendorPdfReviewCandidate[])) => {
    updateVendorPdfImportSession((current) => ({
      reviewCandidates: typeof value === "function" ? value(current.reviewCandidates) : value,
    }));
  }, []);
  const setApprovalResult = useCallback((value: VendorPdfApprovalResult | null) => updateVendorPdfImportSession({ approvalResult: value }), []);
  const setAgentReviewRun = useCallback((value: VendorPdfAgentReviewRunResult | null) => updateVendorPdfImportSession({ agentReviewRun: value }), []);
  const setAgentReviewLoading = useCallback((value: boolean) => updateVendorPdfImportSession({ agentReviewLoading: value }), []);
  const setAgentReviewError = useCallback((value: string | null) => updateVendorPdfImportSession({ agentReviewError: value }), []);
  const setActiveImportSource = useCallback((value: CostImportSource | null) => updateVendorPdfImportSession({ activeImportSource: value }), []);
  const [reviewRuns, setReviewRuns] = useState<VendorPdfReviewRunSummary[]>([]);
  const [reviewRunsLoading, setReviewRunsLoading] = useState(false);
  const [reviewRunsError, setReviewRunsError] = useState<string | null>(null);
  const [openingReviewRunId, setOpeningReviewRunId] = useState<string | null>(null);
  const [deleteReviewRunTarget, setDeleteReviewRunTarget] = useState<VendorPdfReviewRunSummary | null>(null);
  const [deleteReviewRunError, setDeleteReviewRunError] = useState<string | null>(null);
  const [deletingReviewRunId, setDeletingReviewRunId] = useState<string | null>(null);
  const agentReviewStartedBatchesRef = useRef<Set<string>>(new Set());
  const agentReviewPollTimerRef = useRef<number | null>(null);
  const agentReviewPollBatchRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextObservations, nextCosts, nextResources, nextVendors] = await Promise.all([
        listCostObservations({ limit: 1000 }),
        listEffectiveCosts({ q: query || undefined, limit: COST_BASIS_COUNT_LIMIT }),
        listCostResources({ limit: 5000 }),
        listCostVendors({ q: query || undefined, limit: 5000 }),
      ]);
      setObservations(nextObservations);
      setEffectiveCosts(nextCosts);
      setResources(nextResources);
      setVendorRecords(nextVendors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cost intelligence");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const refreshReviewRuns = useCallback(async () => {
    setReviewRunsLoading(true);
    setReviewRunsError(null);
    try {
      const runs = await listVendorPdfReviewRuns({ limit: 25 });
      setReviewRuns(runs);
    } catch (err) {
      setReviewRunsError(err instanceof Error ? err.message : "Failed to load prior PDF reviews");
    } finally {
      setReviewRunsLoading(false);
    }
  }, []);

  const loadVendorDetail = useCallback(async (vendorName: string) => {
    setVendorDetailLoading(true);
    setVendorDetailError(null);
    try {
      const [nextVendors, nextObservations, nextCosts] = await Promise.all([
        listCostVendors({ vendorName, limit: 5000 }),
        listCostObservations({ vendorName, limit: 5000 }),
        listEffectiveCosts({ vendorName, limit: COST_BASIS_COUNT_LIMIT }),
      ]);
      const exactVendor = nextVendors.find((vendor) => vendorNamesMatch(vendor.vendorName, vendorName)) ?? nextVendors[0] ?? null;
      const exactObservations = nextObservations.filter((observation) => vendorNamesMatch(observation.vendorName, vendorName));
      const exactCosts = nextCosts.filter((cost) => vendorNamesMatch(costVendor(cost), vendorName));
      setVendorDetail(exactVendor);
      setVendorDetailObservations(exactObservations.length > 0 ? exactObservations : nextObservations);
      setVendorDetailCosts(exactCosts.length > 0 ? exactCosts : nextCosts);
    } catch (err) {
      setVendorDetailError(err instanceof Error ? err.message : "Vendor detail could not be loaded");
      setVendorDetailObservations([]);
      setVendorDetailCosts([]);
    } finally {
      setVendorDetailLoading(false);
    }
  }, []);

  const clearAgentReviewPoll = useCallback(() => {
    if (agentReviewPollTimerRef.current !== null) {
      window.clearTimeout(agentReviewPollTimerRef.current);
      agentReviewPollTimerRef.current = null;
    }
    agentReviewPollBatchRef.current = null;
  }, []);

  const pollAgentReviewOutput = useCallback((batchId: string, attempt = 0) => {
    clearAgentReviewPoll();
    agentReviewPollBatchRef.current = batchId;

    const poll = async () => {
      if (agentReviewPollBatchRef.current !== batchId) return;
      try {
        const output = await getVendorPdfAgentReviewOutput({ batchId });
        if (agentReviewPollBatchRef.current !== batchId) return;
        if (output.found) {
          const current = getVendorPdfImportSession();
          if (current.analysisResult?.batchId === batchId) {
            setReviewCandidates(output.candidates);
            setApprovalResult(null);
            setEvidencePage(0);
          }
          setAgentReviewLoading(false);
          void refreshReviewRuns();
          clearAgentReviewPoll();
          return;
        }
        const nextAttempt = attempt + 1;
        agentReviewPollTimerRef.current = window.setTimeout(() => pollAgentReviewOutput(batchId, nextAttempt), nextAttempt < 6 ? 2500 : 5000);
      } catch (err) {
        if (agentReviewPollBatchRef.current !== batchId) return;
        setAgentReviewError(err instanceof Error ? err.message : "AI review output could not be loaded");
        setAgentReviewLoading(false);
        clearAgentReviewPoll();
      }
    };

    void poll();
  }, [clearAgentReviewPoll, refreshReviewRuns, setAgentReviewError, setAgentReviewLoading, setApprovalResult, setReviewCandidates]);

  const startAutomaticAgentReview = useCallback(async (result: VendorPdfAnalyzeResult, options: { force?: boolean } = {}) => {
    if (!result.reviewFolder || result.candidateCount === 0) return;
    if (options.force) {
      clearAgentReviewPoll();
      agentReviewStartedBatchesRef.current.delete(result.batchId);
      setReviewCandidates(result.candidates);
      setApprovalResult(null);
      setEvidencePage(0);
    }
    setAgentReviewError(null);
    setAgentReviewLoading(true);
    try {
      if (!options.force) {
        const existing = await getVendorPdfAgentReviewOutput({ batchId: result.batchId });
        if (existing.found) {
          setReviewCandidates(existing.candidates);
          setApprovalResult(null);
          setEvidencePage(0);
          setAgentReviewLoading(false);
          void refreshReviewRuns();
          return;
        }
      }
      if (!agentReviewStartedBatchesRef.current.has(result.batchId)) {
        agentReviewStartedBatchesRef.current.add(result.batchId);
        const run = await runVendorPdfAgentReview({ batchId: result.batchId, force: options.force });
        setAgentReviewRun(run);
      }
      pollAgentReviewOutput(result.batchId);
    } catch (err) {
      agentReviewStartedBatchesRef.current.delete(result.batchId);
      setAgentReviewError(err instanceof Error ? err.message : "AI review could not be started");
      setAgentReviewLoading(false);
    }
  }, [
    clearAgentReviewPoll,
    pollAgentReviewOutput,
    refreshReviewRuns,
    setAgentReviewError,
    setAgentReviewLoading,
    setAgentReviewRun,
    setApprovalResult,
    setReviewCandidates,
  ]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  useEffect(() => {
    if (activeCostTab !== "ingest") return;
    void refreshReviewRuns();
  }, [activeCostTab, refreshReviewRuns]);

  useEffect(() => {
    if (!selectedVendorName) return;
    void loadVendorDetail(selectedVendorName);
  }, [loadVendorDetail, selectedVendorName]);

  useEffect(() => clearAgentReviewPoll, [clearAgentReviewPoll]);

  useEffect(() => {
    let active = true;
    void getSettings()
      .then((settings) => {
        if (active) setOrganizationCurrency(normalizeCurrency(settings.defaults.currency || "USD"));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const resourceTypes = useMemo(() => {
    return Array.from(new Set(effectiveCosts.map(costResourceType).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [effectiveCosts]);

  const categories = useMemo(() => {
    return Array.from(new Set(effectiveCosts.map(costResourceCategory).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [effectiveCosts]);

  const vendorFilterOptions = useMemo(() => {
    return Array.from(new Set(effectiveCosts.map(costVendor).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [effectiveCosts]);

  const filteredVendorRecords = useMemo(() => {
    const loweredQuery = vendorQuery.trim().toLowerCase();
    const rows = vendorRecords.filter((vendor) => {
      if (!loweredQuery) return true;
      return [
        vendor.vendorName,
        ...vendor.currencies,
        ...vendor.products.flatMap((product) => [
          product.name,
          product.vendorSku,
          product.resourceName,
          product.uom,
          product.currency,
        ]),
      ].some((value) => value.toLowerCase().includes(loweredQuery));
    });

    return rows.sort((a, b) => {
      if (vendorSortBy === "name_asc") return a.vendorName.localeCompare(b.vendorName);
      if (vendorSortBy === "products_desc") return b.productCount - a.productCount || a.vendorName.localeCompare(b.vendorName);
      if (vendorSortBy === "evidence_desc") return b.observationCount - a.observationCount || a.vendorName.localeCompare(b.vendorName);
      if (vendorSortBy === "cost_basis_desc") return b.costBasisCount - a.costBasisCount || a.vendorName.localeCompare(b.vendorName);
      return dateMillis(b.latestObservedAt) - dateMillis(a.latestObservedAt) || a.vendorName.localeCompare(b.vendorName);
    });
  }, [vendorQuery, vendorRecords, vendorSortBy]);

  const filteredCosts = useMemo(() => {
    const loweredQuery = query.trim().toLowerCase();
    const rows = effectiveCosts.filter((cost) => {
      if (resourceTypeFilter !== "all" && costResourceType(cost) !== resourceTypeFilter) return false;
      if (categoryFilter !== "all" && costResourceCategory(cost) !== categoryFilter) return false;
      if (excludedVendors.includes(costVendor(cost))) return false;
      if (confidenceFilter === "high" && cost.confidence < 0.8) return false;
      if (confidenceFilter === "review" && (cost.confidence < 0.65 || cost.confidence >= 0.8)) return false;
      if (confidenceFilter === "low" && cost.confidence >= 0.65) return false;
      if (evidenceFilter === "multi" && cost.sampleSize < 2) return false;
      if (evidenceFilter === "single" && cost.sampleSize !== 1) return false;
      if (evidenceFilter === "stale" && !isStale(cost)) return false;
      if (!loweredQuery) return true;
      return [
        costResourceName(cost),
        costResourceType(cost),
        costResourceCategory(cost),
        costVendor(cost),
        costSourceLabel(cost),
        costEvidenceText(cost),
      ].some((value) => value.toLowerCase().includes(loweredQuery));
    });

    return rows.sort((a, b) => {
      if (sortBy === "name") return costResourceName(a).localeCompare(costResourceName(b));
      if (sortBy === "cost_desc") return b.unitCost - a.unitCost;
      if (sortBy === "confidence_desc") return b.confidence - a.confidence;
      if (sortBy === "sample_desc") return b.sampleSize - a.sampleSize;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [categoryFilter, confidenceFilter, effectiveCosts, evidenceFilter, excludedVendors, query, resourceTypeFilter, sortBy]);

  const pageSize = 25;
  const costPages = Math.max(1, Math.ceil(filteredCosts.length / pageSize));
  const visibleCosts = filteredCosts.slice(costPage * pageSize, (costPage + 1) * pageSize);
  const selectedCostCount = selectedCostIds.size;
  const allVisibleCostsSelected = visibleCosts.length > 0 && visibleCosts.every((cost) => selectedCostIds.has(cost.id));
  const someVisibleCostsSelected = visibleCosts.some((cost) => selectedCostIds.has(cost.id));
  const candidatePageSize = 12;
  const candidatePages = Math.max(1, Math.ceil(reviewCandidates.length / candidatePageSize));
  const visibleCandidates = reviewCandidates.slice(evidencePage * candidatePageSize, (evidencePage + 1) * candidatePageSize);
  const selectedCost = useMemo(
    () => effectiveCosts.find((cost) => cost.id === selectedCostId) ?? null,
    [effectiveCosts, selectedCostId],
  );
  const resourceOptions: SearchablePickerOption[] = useMemo(
    () => resources.map((resource) => ({
      id: resource.id,
      label: resource.name,
      code: resource.code || undefined,
      secondary: resource.defaultUom || undefined,
      group: resource.category || resource.resourceType || "Resources",
    })),
    [resources],
  );
  const resourceById = useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources]);
  const selectedVendor = useMemo(() => {
    if (!selectedVendorName) return null;
    return vendorDetail ?? vendorRecords.find((vendor) => vendorNamesMatch(vendor.vendorName, selectedVendorName)) ?? null;
  }, [selectedVendorName, vendorDetail, vendorRecords]);
  const vendorProductRows = useMemo(() => {
    if (!selectedVendor) return [];
    const rows = new Map<string, VendorProductTableRow & { fallbackObservationCount: number; fallbackCostBasisCount: number }>();

    const ensureRow = (key: string, seed: Partial<VendorProductTableRow> = {}) => {
      const existing = rows.get(key);
      if (existing) return existing;
      const row: VendorProductTableRow & { fallbackObservationCount: number; fallbackCostBasisCount: number } = {
        key,
        vendorSku: seed.vendorSku ?? "",
        name: seed.name ?? "Vendor product",
        resourceName: seed.resourceName ?? "",
        uom: seed.uom ?? "EA",
        currency: seed.currency ?? "USD",
        latestUnitCost: seed.latestUnitCost ?? 0,
        previousUnitCost: null,
        averageUnitCost: seed.averageUnitCost ?? seed.latestUnitCost ?? 0,
        minUnitCost: seed.minUnitCost ?? seed.latestUnitCost ?? 0,
        maxUnitCost: seed.maxUnitCost ?? seed.latestUnitCost ?? 0,
        observationCount: seed.observationCount ?? 0,
        fallbackObservationCount: seed.observationCount ?? 0,
        costBasisCount: 0,
        fallbackCostBasisCount: seed.costBasisCount ?? 0,
        firstObservedAt: seed.firstObservedAt ?? null,
        latestObservedAt: seed.latestObservedAt ?? null,
        points: seed.points ?? [],
      };
      rows.set(key, row);
      return row;
    };

    for (const product of selectedVendor.products) {
      const row = ensureRow(vendorProductRecordKey(product), {
        vendorSku: displayToken(product.vendorSku),
        name: product.name,
        resourceName: product.resourceName,
        uom: product.uom,
        currency: product.currency,
        latestUnitCost: product.latestUnitCost,
        observationCount: product.observationCount,
        costBasisCount: product.costBasisCount,
        latestObservedAt: product.latestObservedAt,
        firstObservedAt: product.latestObservedAt,
        points: Number.isFinite(product.latestUnitCost) ? [{ label: product.latestObservedAt, value: product.latestUnitCost }] : [],
      });
      row.fallbackObservationCount = Math.max(row.fallbackObservationCount, product.observationCount);
      row.fallbackCostBasisCount = Math.max(row.fallbackCostBasisCount, product.costBasisCount);
    }

    for (const observation of vendorDetailObservations) {
      const name = observationProductName(observation, resourceById);
      const resource = observation.resourceId ? resourceById.get(observation.resourceId) : null;
      const key = observationProductKey(observation, resourceById);
      const observedAt = observation.effectiveDate || observation.observedAt;
      const row = ensureRow(key, {
        vendorSku: displayToken(observation.vendorSku),
        name,
        resourceName: resource?.name ?? "",
        uom: observation.observedUom,
        currency: observation.currency,
      });
      row.vendorSku ||= displayToken(observation.vendorSku);
      row.name = row.name === "Vendor product" ? name : row.name;
      row.resourceName ||= resource?.name ?? "";
      row.uom = observation.observedUom || row.uom;
      row.currency = observation.currency || row.currency;
      row.observationCount += 1;
      if (Number.isFinite(observation.unitCost)) {
        row.points.push({ label: observedAt, value: observation.unitCost });
      }
      if (!row.firstObservedAt || new Date(observedAt).getTime() < new Date(row.firstObservedAt).getTime()) {
        row.firstObservedAt = observedAt;
      }
      if (!row.latestObservedAt || new Date(observedAt).getTime() > new Date(row.latestObservedAt).getTime()) {
        row.latestObservedAt = observedAt;
        row.latestUnitCost = observation.unitCost;
      }
    }

    for (const cost of vendorDetailCosts) {
      const sourceObservation = cost.sourceObservation;
      const sourceKey = sourceObservation ? observationProductKey(sourceObservation, resourceById) : null;
      const key = sourceKey ?? [
        normalizeProductToken(cost.sourceObservation?.vendorSku),
        cost.resourceId ?? normalizeProductToken(costResourceName(cost)),
        normalizeProductToken(cost.uom),
        normalizeProductToken(cost.currency),
      ].join("|");
      const row = ensureRow(key, {
        vendorSku: displayToken(sourceObservation?.vendorSku),
        name: costResourceName(cost),
        resourceName: displayToken(cost.resource?.name),
        uom: cost.uom,
        currency: cost.currency,
        latestUnitCost: cost.unitCost,
        latestObservedAt: costEvidenceDate(cost),
        firstObservedAt: costEvidenceDate(cost),
      });
      row.costBasisCount += 1;
      row.vendorSku ||= displayToken(sourceObservation?.vendorSku);
      row.name = row.name === "Vendor product" ? costResourceName(cost) : row.name;
      row.resourceName ||= displayToken(cost.resource?.name);
      if (row.points.length === 0 && Number.isFinite(cost.unitCost)) {
        row.points.push({ label: costEvidenceDate(cost), value: cost.unitCost });
      }
      if (!row.latestObservedAt || new Date(costEvidenceDate(cost)).getTime() > new Date(row.latestObservedAt).getTime()) {
        row.latestObservedAt = costEvidenceDate(cost);
        row.latestUnitCost = cost.unitCost;
      }
    }

    return Array.from(rows.values())
      .map((row) => {
        const uniquePoints = Array.from(
          new Map(
            row.points
              .filter((point) => point.label && Number.isFinite(point.value))
              .sort((a, b) => new Date(a.label).getTime() - new Date(b.label).getTime())
              .map((point) => [`${point.label}-${point.value}`, point] as const),
          ).values(),
        );
        const values = uniquePoints.map((point) => point.value);
        const latest = uniquePoints.at(-1)?.value ?? row.latestUnitCost;
        const previous = uniquePoints.length > 1 ? uniquePoints.at(-2)?.value ?? null : null;
        const { fallbackObservationCount, fallbackCostBasisCount, ...cleanRow } = row;
        return {
          ...cleanRow,
          latestUnitCost: latest,
          previousUnitCost: previous,
          averageUnitCost: average(values),
          minUnitCost: values.length > 0 ? Math.min(...values) : latest,
          maxUnitCost: values.length > 0 ? Math.max(...values) : latest,
          observationCount: Math.max(row.observationCount, fallbackObservationCount),
          costBasisCount: Math.max(row.costBasisCount, fallbackCostBasisCount),
          points: uniquePoints,
        };
      })
      .sort((a, b) => new Date(b.latestObservedAt ?? 0).getTime() - new Date(a.latestObservedAt ?? 0).getTime());
  }, [resourceById, selectedVendor, vendorDetailCosts, vendorDetailObservations]);
  const filteredVendorProductRows = useMemo(() => {
    const loweredQuery = vendorProductQuery.trim().toLowerCase();
    const rows = vendorProductRows.filter((row) => {
      if (!loweredQuery) return true;
      return [
        row.name,
        row.vendorSku,
        row.resourceName,
        row.uom,
        row.currency,
      ].some((value) => value.toLowerCase().includes(loweredQuery));
    });

    return rows.sort((a, b) => {
      if (vendorProductSortBy === "name_asc") return a.name.localeCompare(b.name);
      if (vendorProductSortBy === "cost_desc") return b.latestUnitCost - a.latestUnitCost || a.name.localeCompare(b.name);
      if (vendorProductSortBy === "cost_asc") return a.latestUnitCost - b.latestUnitCost || a.name.localeCompare(b.name);
      if (vendorProductSortBy === "trend_desc") return (productTrendPercent(b) ?? Number.NEGATIVE_INFINITY) - (productTrendPercent(a) ?? Number.NEGATIVE_INFINITY) || a.name.localeCompare(b.name);
      if (vendorProductSortBy === "evidence_desc") return b.observationCount - a.observationCount || a.name.localeCompare(b.name);
      return dateMillis(b.latestObservedAt) - dateMillis(a.latestObservedAt) || a.name.localeCompare(b.name);
    });
  }, [vendorProductQuery, vendorProductRows, vendorProductSortBy]);
  const vendorProductPageSize = 12;
  const vendorProductPages = Math.max(1, Math.ceil(filteredVendorProductRows.length / vendorProductPageSize));
  const visibleVendorProducts = filteredVendorProductRows.slice(
    vendorProductPage * vendorProductPageSize,
    (vendorProductPage + 1) * vendorProductPageSize,
  );
  const vendorPriceIndexPoints = useMemo(() => {
    const byProduct = new Map<string, CostObservationRecord[]>();
    for (const observation of vendorDetailObservations) {
      if (!Number.isFinite(observation.unitCost) || observation.unitCost <= 0) continue;
      const key = observationProductKey(observation, resourceById);
      byProduct.set(key, [...(byProduct.get(key) ?? []), observation]);
    }
    const byMonth = new Map<string, { sum: number; count: number }>();
    for (const observationsForProduct of byProduct.values()) {
      const sorted = observationsForProduct
        .slice()
        .sort((a, b) => new Date(a.effectiveDate || a.observedAt).getTime() - new Date(b.effectiveDate || b.observedAt).getTime());
      const base = sorted.find((observation) => observation.unitCost > 0)?.unitCost;
      if (!base) continue;
      for (const observation of sorted) {
        const month = (observation.effectiveDate || observation.observedAt).slice(0, 7);
        const current = byMonth.get(month) ?? { sum: 0, count: 0 };
        current.sum += (observation.unitCost / base) * 100;
        current.count += 1;
        byMonth.set(month, current);
      }
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label, value: value.sum / Math.max(1, value.count) }));
  }, [resourceById, vendorDetailObservations]);
  const vendorEvidenceVolumePoints = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const observation of vendorDetailObservations) {
      const month = (observation.effectiveDate || observation.observedAt).slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label, value }));
  }, [vendorDetailObservations]);
  const vendorMetrics = useMemo(() => {
    if (!selectedVendor) return null;
    const currencies = Array.from(new Set([
      ...selectedVendor.currencies,
      ...vendorProductRows.map((row) => row.currency).filter(Boolean),
    ])).sort();
    return {
      productCount: Math.max(selectedVendor.productCount, vendorProductRows.length),
      observationCount: Math.max(selectedVendor.observationCount, vendorDetailObservations.length),
      costBasisCount: Math.max(selectedVendor.costBasisCount, vendorDetailCosts.length),
      currencies,
      latestObservedAt: vendorProductRows[0]?.latestObservedAt ?? selectedVendor.latestObservedAt,
      averageConfidence: average([
        ...vendorDetailCosts.map((cost) => cost.confidence),
        ...vendorDetailObservations.map((observation) => observation.confidence),
      ]),
    };
  }, [selectedVendor, vendorDetailCosts, vendorDetailObservations, vendorProductRows]);
  const queuedFileBytes = useMemo(
    () => vendorPdfFiles.reduce((total, file) => total + file.size, 0),
    [vendorPdfFiles],
  );
  const pdfBatchFileCount = vendorPdfFiles.length > 0 ? vendorPdfFiles.length : (analysisResult?.fileCount ?? 0);
  const pdfBatchSizeLabel = vendorPdfFiles.length > 0
    ? formatBytes(queuedFileBytes)
    : analysisResult ? `${analysisResult.candidateCount.toLocaleString()} rows` : formatBytes(queuedFileBytes);
  const pdfBatchFileChips = vendorPdfFiles.length > 0
    ? vendorPdfFiles.map((file, index) => ({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        detail: formatBytes(file.size),
        removable: true,
        index,
      }))
    : (analysisResult?.files ?? []).map((file, index) => ({
        key: `${file.fileName}-${index}`,
        name: file.fileName,
        detail: `${file.lineCount.toLocaleString()} rows`,
        removable: false,
        index,
      }));
  const selectedImportOption = useMemo(
    () => COST_IMPORT_OPTIONS.find((option) => option.id === activeImportSource) ?? null,
    [activeImportSource],
  );
  const SelectedImportIcon = selectedImportOption?.icon ?? UploadCloud;
  const activeFileImport = activeImportSource === "pdf" || activeImportSource === "csv" || activeImportSource === "excel";
  const importFileKindLabel = activeImportSource === "pdf" ? "PDF" : activeImportSource === "csv" ? "CSV" : activeImportSource === "excel" ? "Excel" : "File";
  const importFileAccept = activeImportSource === "pdf"
    ? ".pdf,application/pdf"
    : activeImportSource === "csv"
      ? ".csv,text/csv"
      : activeImportSource === "excel"
        ? ".xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "";
  const importIntakeTitle = activeImportSource === "pdf" ? "PDF Intake" : `${selectedImportOption?.label ?? "File"} Import`;

  const ingestMetrics = useMemo(() => {
    if (!analysisResult) return [];
    const approved = reviewCandidates.filter((candidate) => candidate.decision === "approved").length;
    const discarded = reviewCandidates.filter((candidate) => candidate.decision === "discarded").length;
    return [
      { label: "Files Parsed", value: `${analysisResult.parsedFileCount}/${analysisResult.fileCount}` },
      { label: "Candidates", value: analysisResult.candidateCount.toLocaleString() },
      { label: "New Items", value: analysisResult.newCandidateCount.toLocaleString() },
      { label: "Updates", value: analysisResult.updateCandidateCount.toLocaleString() },
      { label: "Approved", value: approved.toLocaleString() },
      { label: "Discarded", value: discarded.toLocaleString() },
    ];
  }, [analysisResult, reviewCandidates]);
  const approvedReviewCount = reviewCandidates.filter((candidate) => candidate.decision === "approved").length;
  const pendingReviewCount = reviewCandidates.filter((candidate) => candidate.decision === "pending").length;
  const discardableDuplicateCount = reviewCandidates.filter((candidate) => (
    candidate.decision !== "discarded" && isDiscardableDuplicateCandidate(candidate)
  )).length;
  const pdfFlowStatus = useMemo<{ label: string; tone: BadgeTone }>(() => {
    if (ingesting) return { label: "Analyzing", tone: "info" };
    if (agentReviewLoading) return { label: "AI reviewing", tone: "info" };
    if (agentReviewError) return { label: "Review attention", tone: "warning" };
    if (!analysisResult) {
      if (vendorPdfFiles.length > 0) return { label: "Ready to analyze", tone: "info" };
      return reviewRuns.length > 0 ? { label: "Open saved review", tone: "default" } : { label: "Select PDFs", tone: "default" };
    }
    if (approvedReviewCount > 0) return { label: "Ready to commit", tone: "success" };
    if (pendingReviewCount > 0) return { label: "Review candidates", tone: "warning" };
    return { label: "No approved rows", tone: "warning" };
  }, [agentReviewError, agentReviewLoading, analysisResult, approvedReviewCount, ingesting, pendingReviewCount, reviewRuns.length, vendorPdfFiles.length]);

  useEffect(() => {
    setCostPage(0);
  }, [query, resourceTypeFilter, categoryFilter, excludedVendors, confidenceFilter, evidenceFilter, sortBy]);

  useEffect(() => {
    setCostPage((page) => Math.min(page, costPages - 1));
  }, [costPages]);

  useEffect(() => {
    setEvidencePage((page) => Math.min(page, candidatePages - 1));
  }, [candidatePages]);

  useEffect(() => {
    setVendorProductPage(0);
  }, [selectedVendorName, vendorProductQuery, vendorProductSortBy]);

  useEffect(() => {
    setVendorProductPage((page) => Math.min(page, vendorProductPages - 1));
  }, [vendorProductPages]);

  useEffect(() => {
    const existingIds = new Set(effectiveCosts.map((cost) => cost.id));
    setSelectedCostIds((current) => {
      const next = new Set(Array.from(current).filter((id) => existingIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [effectiveCosts]);

  function clearFilters() {
    setResourceTypeFilter("all");
    setCategoryFilter("all");
    setExcludedVendors([]);
    setConfidenceFilter("all");
    setEvidenceFilter("all");
    setSortBy("updated");
  }

  function openVendorPage(vendor: CostVendorRecord) {
    setSelectedVendorName(vendor.vendorName);
    setVendorDetail(vendor);
    setVendorDetailError(null);
    setVendorDetailTab("overview");
    setVendorProductQuery("");
    setVendorProductSortBy("latest_desc");
    setVendorProductPage(0);
  }

  function closeVendorPage() {
    setSelectedVendorName(null);
    setVendorDetail(null);
    setVendorDetailObservations([]);
    setVendorDetailCosts([]);
    setVendorDetailError(null);
    setVendorDetailTab("overview");
    setVendorProductQuery("");
    setVendorProductSortBy("latest_desc");
    setVendorProductPage(0);
  }

  function openCreateCostDrawer() {
    setCostForm({ ...emptyEffectiveCostForm });
    setSelectedCostId(null);
    setDrawerMode("create");
    setCostFormError(null);
  }

  function openEditCostDrawer(cost: EffectiveCostRecord) {
    setCostForm(formFromEffectiveCost(cost));
    setSelectedCostId(cost.id);
    setDrawerMode("edit");
    setCostFormError(null);
  }

  function closeCostDrawer() {
    setDrawerMode(null);
    setSelectedCostId(null);
    setCostFormError(null);
  }

  async function handleSaveEffectiveCost() {
    const payload = buildEffectiveCostPayload(costForm);
    if (!payload) {
      setCostFormError("Choose or name an item, then enter valid cost, confidence, and sample values.");
      return;
    }

    setCostSaving(true);
    setCostFormError(null);
    try {
      if (drawerMode === "create") {
        const created = await createEffectiveCost(payload);
        await refresh();
        setSelectedCostId(created.id);
        setCostForm(formFromEffectiveCost(created));
        setDrawerMode("edit");
      } else if (drawerMode === "edit" && selectedCostId) {
        const updated = await updateEffectiveCost(selectedCostId, payload as EffectiveCostPatchInput);
        setEffectiveCosts((current) => current.map((cost) => cost.id === updated.id ? updated : cost));
        setCostForm(formFromEffectiveCost(updated));
      }
    } catch (err) {
      setCostFormError(err instanceof Error ? err.message : "Failed to save cost basis row");
    } finally {
      setCostSaving(false);
    }
  }

  async function handleDeleteEffectiveCost() {
    if (!selectedCostId) return;
    if (!window.confirm("Delete this cost basis row? This does not delete the resource or source observations.")) return;

    setCostDeleting(true);
    setCostFormError(null);
    try {
      await deleteEffectiveCost(selectedCostId);
      setEffectiveCosts((current) => current.filter((cost) => cost.id !== selectedCostId));
      closeCostDrawer();
    } catch (err) {
      setCostFormError(err instanceof Error ? err.message : "Failed to delete cost basis row");
    } finally {
      setCostDeleting(false);
    }
  }

  function toggleCostSelection(costId: string, selected: boolean) {
    setSelectedCostIds((current) => {
      const next = new Set(current);
      if (selected) next.add(costId);
      else next.delete(costId);
      return next;
    });
  }

  function toggleVisibleCostSelection(selected: boolean) {
    setSelectedCostIds((current) => {
      const next = new Set(current);
      for (const cost of visibleCosts) {
        if (selected) next.add(cost.id);
        else next.delete(cost.id);
      }
      return next;
    });
  }

  function clearCostSelection() {
    setSelectedCostIds(new Set());
    setBulkDeleteCostError(null);
  }

  async function confirmBulkDeleteCosts() {
    const ids = Array.from(selectedCostIds);
    if (ids.length === 0) return;
    setBulkDeletingCosts(true);
    setBulkDeleteCostError(null);
    try {
      await deleteEffectiveCosts(ids);
      const deletedIds = new Set(ids);
      setEffectiveCosts((current) => current.filter((cost) => !deletedIds.has(cost.id)));
      if (selectedCostId && deletedIds.has(selectedCostId)) closeCostDrawer();
      setSelectedCostIds(new Set());
      setBulkDeleteCostConfirmOpen(false);
    } catch (err) {
      setBulkDeleteCostError(err instanceof Error ? err.message : "Failed to delete selected cost basis rows");
    } finally {
      setBulkDeletingCosts(false);
    }
  }

  useEffect(() => {
    if (!drawerMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCostDrawer();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerMode]);

  function handleVendorPdfFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []).filter((file) => acceptsCostImportFile(file, activeImportSource));
    setVendorPdfFiles((prev) => {
      const next = [...prev];
      const keys = new Set(next.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      for (const file of selected) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!keys.has(key)) {
          keys.add(key);
          next.push(file);
        }
      }
      return next;
    });
    event.target.value = "";
    clearAgentReviewPoll();
    setAnalysisResult(null);
    setReviewCandidates([]);
    setApprovalResult(null);
    setAgentReviewRun(null);
    setAgentReviewLoading(false);
    setAgentReviewError(null);
    setIngestError(null);
  }

  function removeVendorPdfFile(index: number) {
    setVendorPdfFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
    clearAgentReviewPoll();
    setAnalysisResult(null);
    setReviewCandidates([]);
    setApprovalResult(null);
    setAgentReviewRun(null);
    setAgentReviewLoading(false);
    setAgentReviewError(null);
    setIngestError(null);
  }

  function clearVendorPdfIntake() {
    setVendorPdfFiles([]);
    clearAgentReviewPoll();
    setAnalysisResult(null);
    setReviewCandidates([]);
    setApprovalResult(null);
    setAgentReviewRun(null);
    setAgentReviewLoading(false);
    setAgentReviewError(null);
    setIngestError(null);
  }

  async function openPriorReviewRun(batchId: string) {
    setOpeningReviewRunId(batchId);
    setIngestError(null);
    setAgentReviewError(null);
    try {
      const detail = await getVendorPdfReviewRun({ batchId });
      clearAgentReviewPoll();
      setActiveImportSource(importSourceForAnalysis(detail.analysis));
      setVendorPdfFiles([]);
      setAnalysisResult(detail.analysis);
      setReviewCandidates(detail.reviewedCandidates ?? detail.analysis.candidates);
      setApprovalResult(null);
      setAgentReviewRun(null);
      setAgentReviewLoading(false);
      setEvidencePage(0);
      if (!detail.reviewedCandidates) {
        void startAutomaticAgentReview(detail.analysis);
      }
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : "Failed to reopen prior PDF review");
    } finally {
      setOpeningReviewRunId(null);
    }
  }

  function updateReviewCandidate(candidateId: string, patch: Partial<VendorPdfReviewCandidate>) {
    setReviewCandidates((current) => current.map((candidate) => (
      candidate.id === candidateId ? { ...candidate, ...patch } : candidate
    )));
  }

  function approvePendingCandidates() {
    setReviewCandidates((current) => current.map((candidate) => (
      candidate.decision === "pending" ? { ...candidate, decision: "approved" } : candidate
    )));
  }

  function discardDuplicateCandidates() {
    setIngestError(null);
    setReviewCandidates((current) => current.map((candidate) => (
      isDiscardableDuplicateCandidate(candidate) ? { ...candidate, decision: "discarded" } : candidate
    )));
  }

  function rerunAgentReview() {
    if (!analysisResult) return;
    setAgentReviewRun(null);
    void startAutomaticAgentReview(analysisResult, { force: true });
  }

  async function handleVendorPdfAnalyze() {
    if (vendorPdfFiles.length === 0) return;
    setIngesting(true);
    setIngestError(null);
    setApprovalResult(null);
    setAgentReviewRun(null);
    setAgentReviewError(null);
    try {
      const result = activeImportSource === "csv" || activeImportSource === "excel"
        ? await analyzeCostSpreadsheetEvidence({
            files: vendorPdfFiles,
            entrySurface,
          })
        : await analyzeVendorPdfEvidence({
            files: vendorPdfFiles,
            entrySurface,
          });
      setAnalysisResult(result);
      setReviewCandidates(result.candidates);
      setEvidencePage(0);
      void refreshReviewRuns();
      void startAutomaticAgentReview(result);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : `Failed to analyze ${importFileKindLabel.toLowerCase()} files`);
    } finally {
      setIngesting(false);
    }
  }

  async function handleApproveCandidates() {
    if (!analysisResult) return;
    const approvedCount = reviewCandidates.filter((candidate) => candidate.decision === "approved").length;
    if (approvedCount === 0) {
      setIngestError("Approve at least one candidate before committing to the cost basis.");
      return;
    }
    setIngesting(true);
    setIngestError(null);
    try {
      const result = await approveVendorPdfCandidates({
        batchId: analysisResult.batchId,
        candidates: reviewCandidates,
        entrySurface,
      });
      setApprovalResult(result);
      await refresh();
      void refreshReviewRuns();
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : "Failed to approve reviewed candidates");
    } finally {
      setIngesting(false);
    }
  }

  async function confirmDeleteReviewRun() {
    if (!deleteReviewRunTarget) return;
    setDeletingReviewRunId(deleteReviewRunTarget.batchId);
    setDeleteReviewRunError(null);
    try {
      await deleteVendorPdfReviewRun({ batchId: deleteReviewRunTarget.batchId });
      setReviewRuns((current) => current.filter((run) => run.batchId !== deleteReviewRunTarget.batchId));
      agentReviewStartedBatchesRef.current.delete(deleteReviewRunTarget.batchId);
      if (analysisResult?.batchId === deleteReviewRunTarget.batchId) {
        clearVendorPdfIntake();
      }
      setDeleteReviewRunTarget(null);
    } catch (err) {
      setDeleteReviewRunError(err instanceof Error ? err.message : "Failed to archive PDF review run");
    } finally {
      setDeletingReviewRunId(null);
    }
  }

  const pdfReviewHistory = (
    <div className="border-t border-line bg-bg/25">
      <div className="flex h-9 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-fg/70">
          <History className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate">Previous Imports</span>
          <Badge>{reviewRuns.length.toLocaleString()}</Badge>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void refreshReviewRuns()}
          disabled={reviewRunsLoading}
          className="h-7 w-7 shrink-0 px-0"
          title="Refresh import history"
          aria-label="Refresh import history"
        >
          {reviewRunsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {reviewRunsError && (
        <div className="border-t border-warning/20 px-3 py-2 text-[11px] text-warning">{reviewRunsError}</div>
      )}
      {!reviewRunsLoading && reviewRuns.length === 0 ? (
        <div className="border-t border-line px-3 py-4 text-center text-xs text-fg/35">No reviewed imports have been saved yet.</div>
      ) : (
        <div className="max-h-64 overflow-y-auto border-t border-line">
          {reviewRuns.map((run) => {
            const active = analysisResult?.batchId === run.batchId;
            return (
              <div
                key={run.batchId}
                className={cn(
                  "grid grid-cols-[minmax(0,1.7fr)_84px_84px_88px_74px_32px] items-center gap-2 border-b border-line/60 px-3 py-2 text-xs last:border-b-0",
                  active && "bg-accent/8",
                )}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg/75">{run.fileNames.join(", ") || run.batchId}</div>
                  <div className="truncate text-[10px] text-fg/35">{run.batchId}</div>
                </div>
                <Badge tone={run.status === "reviewed" ? "success" : run.status === "analyzed" ? "info" : "warning"} className="justify-center">
                  {reviewRunStatusLabel(run.status)}
                </Badge>
                <div className="text-right tabular-nums text-fg/60">{run.candidateCount.toLocaleString()} rows</div>
                <div className="truncate text-right text-fg/40">{formatDate(run.updatedAt)}</div>
                <Button
                  type="button"
                  size="sm"
                  variant={active ? "ghost" : "secondary"}
                  onClick={() => void openPriorReviewRun(run.batchId)}
                  disabled={openingReviewRunId === run.batchId}
                  className="h-7 px-2"
                  aria-label={`Open import review ${run.batchId}`}
                >
                  {openingReviewRunId === run.batchId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                  <span className="hidden xl:inline">Open</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDeleteReviewRunError(null);
                    setDeleteReviewRunTarget(run);
                  }}
                  disabled={deletingReviewRunId === run.batchId}
                  className="h-7 w-7 px-0 text-danger hover:bg-danger/10 hover:text-danger"
                  title="Archive import review"
                  aria-label={`Archive import review ${run.batchId}`}
                >
                  {deletingReviewRunId === run.batchId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <>
    <Card className={cn("rounded-lg", embedded && "flex h-full min-h-0 flex-col rounded-none border-0 shadow-none hover:shadow-none")}>
      {!embedded && (
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-success" />
              <CardTitle>Cost Intelligence</CardTitle>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg/50">
              Current evidence-backed cost basis from vendor documents, historical quotes, receipts, and purchase data.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </CardHeader>
      )}

      <CardBody className={cn(embedded ? "flex min-h-0 flex-1 flex-col gap-3 px-3 py-3" : "flex min-h-[720px] flex-col gap-3")}>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel2/45 p-1">
          <div role="tablist" aria-label="Cost intelligence views" className="flex min-w-0 flex-wrap gap-1">
            {COST_INTELLIGENCE_SUBTABS.map((tab) => {
              const active = activeCostTab === tab.id;
              const count = tab.id === "ingest"
                ? (analysisResult?.candidateCount ?? vendorPdfFiles.length)
                : tab.id === "vendors" ? vendorRecords.length : filteredCosts.length;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveCostTab(tab.id)}
                  className={cn(
                    "flex h-9 min-w-0 items-center gap-2 rounded-md px-3 text-left text-xs transition-colors",
                    active ? "bg-panel text-fg shadow-sm" : "text-fg/55 hover:bg-panel/70 hover:text-fg",
                  )}
                >
                  {tab.id === "ingest" ? <UploadCloud className="h-3.5 w-3.5 shrink-0" /> : <Database className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate font-medium">{tab.label}</span>
                  <Badge tone={active ? "info" : "default"}>{compactCount(count)}</Badge>
                </button>
              );
            })}
          </div>
          {embedded && (
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          )}
        </div>

        {activeCostTab === "costs" && (
          <section className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="shrink-0 rounded-lg border border-line bg-bg/40 p-2">
              <div className="grid grid-cols-[minmax(170px,2fr)_repeat(6,minmax(0,1fr))_32px_32px] items-center gap-2">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search costs, vendors, evidence"
                    className="h-8 min-w-0 pl-7 text-xs"
                  />
                </div>
                <select
                  aria-label="Type"
                  value={resourceTypeFilter}
                  onChange={(event) => setResourceTypeFilter(event.target.value)}
                  className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none"
                >
                  <option value="all">All types</option>
                  {resourceTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
                <select
                  aria-label="Category"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none"
                >
                  <option value="all">All categories</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <VendorVisibilityFilter vendors={vendorFilterOptions} excluded={excludedVendors} onChange={setExcludedVendors} />
                <select
                  aria-label="Confidence"
                  value={confidenceFilter}
                  onChange={(event) => setConfidenceFilter(event.target.value as CostConfidenceFilter)}
                  className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none"
                >
                  <option value="all">Any conf.</option>
                  <option value="high">High 80%+</option>
                  <option value="review">Review</option>
                  <option value="low">Low</option>
                </select>
                <select
                  aria-label="Evidence"
                  value={evidenceFilter}
                  onChange={(event) => setEvidenceFilter(event.target.value as EvidenceFilter)}
                  className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none"
                >
                  <option value="all">All evidence</option>
                  <option value="multi">Multi-sample</option>
                  <option value="single">Single</option>
                  <option value="stale">Stale</option>
                </select>
                <select
                  aria-label="Sort"
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as CostSort)}
                  className="h-8 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none"
                >
                  <option value="updated">Recent</option>
                  <option value="name">Name</option>
                  <option value="cost_desc">Cost high</option>
                  <option value="confidence_desc">Conf. high</option>
                  <option value="sample_desc">Most samples</option>
                </select>
                <Button type="button" size="sm" variant="ghost" onClick={clearFilters} className="h-8 w-8 px-0" title="Clear filters" aria-label="Clear filters">
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="sm" variant="accent" onClick={openCreateCostDrawer} className="h-8 w-8 px-0" title="Add cost" aria-label="Add cost">
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-fg">
                  <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="truncate">Cost Basis Register</span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedCostCount > 0 && (
                    <>
                      <Badge tone="info">{selectedCostCount.toLocaleString()} selected</Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={clearCostSelection}
                        disabled={bulkDeletingCosts}
                        className="h-7 px-2"
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          setBulkDeleteCostError(null);
                          setBulkDeleteCostConfirmOpen(true);
                        }}
                        disabled={bulkDeletingCosts}
                        className="h-7 px-2"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </>
                  )}
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-fg/40" />}
                  <Badge tone="success">{compactCount(filteredCosts.length)}</Badge>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {filteredCosts.length === 0 ? (
                  <div className="flex h-full min-h-64 items-center justify-center px-3 text-center text-xs text-fg/35">
                    No cost basis rows match the current filters.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-20 bg-panel2/95 shadow-[0_1px_0_0_var(--line)]">
                      <tr className="border-b border-line text-[10px] uppercase text-fg/35">
                        <th className="w-10 px-3 py-2 text-left font-medium">
                          <input
                            type="checkbox"
                            checked={allVisibleCostsSelected}
                            aria-checked={allVisibleCostsSelected ? "true" : someVisibleCostsSelected ? "mixed" : "false"}
                            onChange={(event) => toggleVisibleCostSelection(event.target.checked)}
                            className="h-3.5 w-3.5 rounded border-line accent-accent"
                            aria-label="Select visible cost basis rows"
                          />
                        </th>
                        <th className="min-w-[280px] px-3 py-2 text-left font-medium">Item</th>
                        <th className="w-40 px-3 py-2 text-left font-medium">Scope</th>
                        <th className="w-36 px-3 py-2 text-right font-medium">Cost Basis</th>
                        <th className="w-48 px-3 py-2 text-left font-medium">Evidence</th>
                        <th className="w-32 px-3 py-2 text-left font-medium">Confidence</th>
                        <th className="w-32 px-3 py-2 text-left font-medium">Freshness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCosts.map((cost) => {
                        const stale = isStale(cost);
                        const selected = selectedCostIds.has(cost.id);
                        return (
                          <tr
                            key={cost.id}
                            className={cn(
                              "cursor-pointer border-b border-line/70 transition-colors hover:bg-panel2/65",
                              (selectedCostId === cost.id || selected) && "bg-panel2/70",
                            )}
                            onClick={() => openEditCostDrawer(cost)}
                          >
                            <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(event) => toggleCostSelection(cost.id, event.target.checked)}
                                className="h-3.5 w-3.5 rounded border-line accent-accent"
                                aria-label={`Select ${costResourceName(cost)}`}
                              />
                            </td>
                            <td className="max-w-0 px-3 py-2">
                              <div className="truncate font-semibold text-fg">{costResourceName(cost)}</div>
                              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-fg/40">
                                <span className="truncate">{costItemSecondaryLabel(cost)}</span>
                                {displayToken(cost.sourceObservation?.vendorSku) && <span className="truncate">SKU {displayToken(cost.sourceObservation?.vendorSku)}</span>}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                <Badge>{costResourceType(cost)}</Badge>
                                <Badge tone="info" className="max-w-28 truncate">{costResourceCategory(cost)}</Badge>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="font-semibold tabular-nums text-fg">{formatMoney(cost.unitCost, cost.currency)}</div>
                              <div className="text-[10px] text-fg/40">per {cost.uom}</div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="truncate font-medium text-fg/70">{costVendor(cost)}</div>
                              <div className="truncate text-[10px] text-fg/40">
                                {costSourceLabel(cost)} · {cost.sampleSize} sample{cost.sampleSize === 1 ? "" : "s"}
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Badge tone={confidenceTone(cost.confidence)}>{Math.round(cost.confidence * 100)}%</Badge>
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-panel2">
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all",
                                      cost.confidence >= 0.8 ? "bg-success" : cost.confidence >= 0.65 ? "bg-warning" : "bg-danger",
                                    )}
                                    style={{ width: `${Math.max(5, Math.round(cost.confidence * 100))}%` }}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className={cn("font-medium text-fg/65", stale && "text-warning")}>{formatDate(costEvidenceDate(cost))}</div>
                              <div className="text-[10px] text-fg/35">{methodLabel(cost.method)}</div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <PanelPagination label="cost basis rows" onPageChange={setCostPage} page={costPage} pageSize={pageSize} total={filteredCosts.length} />
            </div>
          </section>
        )}

        {activeCostTab === "ingest" && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
            {activeImportSource === null ? (
              <>
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
                  <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-fg">
                    <UploadCloud className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate">Import</span>
                  </div>
                  <Badge tone="info">4 sources</Badge>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-3">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {COST_IMPORT_OPTIONS.map((option) => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            if (activeImportSource !== option.id) clearVendorPdfIntake();
                            setActiveImportSource(option.id);
                          }}
                          className="flex min-h-32 flex-col items-start justify-between rounded-lg border border-line bg-bg/40 p-3 text-left transition-colors hover:border-accent/45 hover:bg-panel2/55"
                        >
                          <div className="flex w-full items-start justify-between gap-2">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-panel">
                              <Icon className="h-4 w-4 text-accent" />
                            </div>
                            <Badge tone={option.id === "pdf" ? "success" : "default"}>{option.badge}</Badge>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-fg">{option.label}</div>
                            <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-fg/45">{option.description}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : !activeFileImport ? (
              <>
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setActiveImportSource(null)} className="h-7 px-2">
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Import
                    </Button>
                    <SelectedImportIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate text-xs font-semibold text-fg">{selectedImportOption?.label}</span>
                  </div>
                  <Badge>{selectedImportOption?.badge ?? "Next"}</Badge>
                </div>
                <div className="flex min-h-40 flex-1 items-center justify-center px-3 text-center text-xs text-fg/35">
                  {selectedImportOption?.label} import will stage candidates into this review queue before anything is committed.
                </div>
              </>
            ) : (
              <>
                <input
                  ref={vendorPdfInputRef}
                  type="file"
                  multiple
                  accept={importFileAccept}
                  className="hidden"
                  onChange={handleVendorPdfFileChange}
                />

                <div className="shrink-0 border-b border-line">
                  <div className="flex h-9 items-center gap-1 overflow-x-auto overflow-y-hidden px-2">
                    <div className="flex min-w-0 flex-1 shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setActiveImportSource(null)}
                        className="h-7 shrink-0 px-2"
                        title="Back to import sources"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        <span className="hidden lg:inline">Import</span>
                      </Button>
                      <SelectedImportIcon className="h-4 w-4 shrink-0 text-accent" />
                      <span className="shrink-0 text-xs font-semibold text-fg">{importIntakeTitle}</span>
                      <Badge tone={pdfBatchFileCount > 0 ? "info" : "default"} className="shrink-0">{pdfBatchFileCount} {importFileKindLabel}{activeImportSource === "excel" ? " file" : ""}{pdfBatchFileCount === 1 ? "" : activeImportSource === "excel" ? "s" : "s"}</Badge>
                      <Badge className="shrink-0">{pdfBatchSizeLabel}</Badge>
                      <Badge className="shrink-0">{organizationCurrency}</Badge>
                      <Badge tone={pdfFlowStatus.tone} className="shrink-0">{pdfFlowStatus.label}</Badge>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => vendorPdfInputRef.current?.click()}
                        disabled={ingesting || agentReviewLoading}
                        className="h-7 w-7 shrink-0 px-0"
                        title={`Select ${importFileKindLabel} files`}
                        aria-label={`Select ${importFileKindLabel} files`}
                      >
                        <UploadCloud className="h-3.5 w-3.5" />
                      </Button>
                      {vendorPdfFiles.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={clearVendorPdfIntake}
                          disabled={ingesting || agentReviewLoading}
                          className="h-7 w-7 shrink-0 px-0"
                          title={`Clear queued ${importFileKindLabel} files`}
                          aria-label={`Clear queued ${importFileKindLabel} files`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleVendorPdfAnalyze}
                        disabled={ingesting || agentReviewLoading || vendorPdfFiles.length === 0}
                        className="h-7 w-7 shrink-0 px-0"
                        title={`Analyze ${importFileKindLabel} files`}
                        aria-label={`Analyze ${importFileKindLabel} files`}
                      >
                        {ingesting && !analysisResult ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                      </Button>
                      {analysisResult && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={rerunAgentReview}
                            disabled={ingesting || agentReviewLoading || !analysisResult.reviewFolder || analysisResult.candidateCount === 0}
                            className="h-7 w-7 shrink-0 px-0"
                            title="Rerun AI processing"
                            aria-label="Rerun AI processing"
                          >
                            {agentReviewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={approvePendingCandidates}
                            disabled={ingesting || pendingReviewCount === 0}
                            className="h-7 w-7 shrink-0 px-0"
                            title="Approve pending candidates"
                            aria-label="Approve pending candidates"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={discardDuplicateCandidates}
                            disabled={ingesting || agentReviewLoading || discardableDuplicateCount === 0}
                            className="h-7 w-7 shrink-0 px-0"
                            title={`Discard duplicate candidates${discardableDuplicateCount > 0 ? ` (${discardableDuplicateCount})` : ""}`}
                            aria-label="Discard duplicate candidates"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="accent"
                            onClick={handleApproveCandidates}
                            disabled={ingesting || agentReviewLoading || approvedReviewCount === 0}
                            className="h-7 w-7 shrink-0 px-0"
                            title="Commit approved candidates"
                            aria-label="Commit approved candidates"
                          >
                            {ingesting && analysisResult ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex h-7 items-center gap-1 overflow-x-auto overflow-y-hidden border-t border-line/60 px-2">
                    {pdfBatchFileChips.length === 0 ? (
                      <span className="shrink-0 text-[11px] text-fg/35">No PDFs queued.</span>
                    ) : (
                      pdfBatchFileChips.map((file) => (
                        <span
                          key={file.key}
                          className="flex h-5 max-w-[260px] shrink-0 items-center gap-1 rounded-md border border-line bg-bg/45 px-1.5 text-[10px] text-fg/55"
                        >
                          <FileText className="h-3 w-3 shrink-0 text-fg/35" />
                          <span className="min-w-0 truncate">{file.name}</span>
                          <span className="shrink-0 tabular-nums text-fg/35">{file.detail}</span>
                          {file.removable && (
                            <button
                              type="button"
                              onClick={() => removeVendorPdfFile(file.index)}
                              disabled={ingesting || agentReviewLoading}
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-fg/35 transition-colors hover:bg-panel2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                              aria-label={`Remove ${file.name}`}
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                  {ingestError && (
                    <div className="flex items-start gap-2 border-b border-danger/20 bg-danger/8 px-3 py-2 text-xs text-danger">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{ingestError}</span>
                    </div>
                  )}
                  {agentReviewError && (
                    <div className="flex items-start gap-2 border-b border-warning/20 bg-warning/8 px-3 py-2 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{agentReviewError}</span>
                    </div>
                  )}

                  {!analysisResult ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="flex min-h-24 shrink-0 items-center justify-center px-3 text-center text-xs text-fg/35">
                        Select {importFileKindLabel} files, then analyze to stage editable cost candidates. No rows are written until approved candidates are committed.
                      </div>
                      <div className="min-h-0 flex-1 overflow-hidden">
                        {pdfReviewHistory}
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="shrink-0 border-b border-line bg-panel2/35 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {ingestMetrics.map((metric) => (
                            <Badge key={metric.label} tone={metric.label === "Approved" ? "success" : metric.label === "Discarded" ? "warning" : "default"}>
                              {metric.label}: {metric.value}
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-fg/45">
                          <Bot className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <span className="shrink-0">{analysisResult.pipeline.extractionProvider.replace(/_/g, " ")}</span>
                          <span className="shrink-0">to</span>
                          <span className="min-w-0 truncate" title={analysisResult.runtime.workDir ?? analysisResult.reviewFolder ?? undefined}>
                            {analysisResult.runtime.workDir ?? analysisResult.reviewFolder ?? "review workspace not written"}
                          </span>
                          {agentReviewRun && <Badge tone="info">{agentReviewRun.runtime} session {agentReviewRun.status}</Badge>}
                        </div>
                      </div>

                      {approvalResult && (
                        <div className="shrink-0 border-b border-success/25 bg-success/8 px-3 py-2 text-[11px] text-success">
                          Committed {approvalResult.observationsCreated} observations and updated {approvalResult.costBasisUpdated} cost basis rows.
                        </div>
                      )}
                      {analysisResult.warnings.length > 0 && (
                        <div className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2 text-[11px] text-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="line-clamp-2">{analysisResult.warnings.slice(0, 3).join(" ")}</span>
                        </div>
                      )}

                      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                        {reviewCandidates.length === 0 ? (
                          <div className="flex h-full min-h-32 items-center justify-center px-3 text-center text-xs text-fg/35">
                            No cost candidates were extracted from this batch.
                          </div>
                        ) : (
                          <table className="w-full table-fixed text-xs">
                            <colgroup>
                              <col style={{ width: "13%" }} />
                              <col style={{ width: "21%" }} />
                              <col style={{ width: "35%" }} />
                              <col style={{ width: "14%" }} />
                              <col style={{ width: "17%" }} />
                            </colgroup>
                            <thead className="sticky top-0 z-10 bg-panel2/95">
                              <tr className="border-b border-line text-[10px] uppercase text-fg/35">
                                <th className="px-2 py-2 text-left font-medium">Decision</th>
                                <th className="px-2 py-2 text-left font-medium">Vendor / Doc</th>
                                <th className="px-2 py-2 text-left font-medium">Cost Item / Product</th>
                                <th className="px-2 py-2 text-right font-medium">Cost</th>
                                <th className="px-2 py-2 text-left font-medium">Review</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleCandidates.map((candidate) => (
                                <tr key={candidate.id} className="border-b border-line/70 last:border-b-0">
                                  <td className="px-2 py-2 align-top">
                                    <select
                                      value={candidate.decision}
                                      onChange={(event) => updateReviewCandidate(candidate.id, { decision: event.target.value as VendorPdfReviewCandidate["decision"] })}
                                      className="h-7 w-full min-w-0 rounded-md border border-line bg-panel px-1.5 text-[11px] text-fg outline-none"
                                    >
                                      <option value="pending">Pending</option>
                                      <option value="approved">Approve</option>
                                      <option value="discarded">Discard</option>
                                    </select>
                                  </td>
                                  <td className="max-w-0 px-2 py-2 align-top">
                                    <Input
                                      value={candidate.vendorName}
                                      onChange={(event) => updateReviewCandidate(candidate.id, { vendorName: event.target.value })}
                                      className="h-7 min-w-0 text-xs"
                                    />
                                    <div className="mt-1 min-w-0 truncate text-[10px] text-fg/35">
                                      {documentTypeLabel(candidate.documentType)} {candidate.documentNumber || ""}{candidate.pageNumber ? ` · p.${candidate.pageNumber}` : ""}
                                    </div>
                                  </td>
                                  <td className="max-w-0 px-2 py-2 align-top">
                                    <Input
                                      value={candidate.resourceName}
                                      onChange={(event) => updateReviewCandidate(candidate.id, { resourceName: event.target.value, description: event.target.value })}
                                      className="h-7 min-w-0 text-xs"
                                    />
                                    <div className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(64px,0.42fr)] gap-1">
                                      <Input
                                        value={candidate.category}
                                        onChange={(event) => updateReviewCandidate(candidate.id, { category: event.target.value })}
                                        className="h-7 min-w-0 text-[11px]"
                                      />
                                      <Input
                                        value={candidate.vendorSku}
                                        onChange={(event) => updateReviewCandidate(candidate.id, { vendorSku: event.target.value })}
                                        placeholder="SKU"
                                        className="h-7 min-w-0 text-[11px]"
                                      />
                                    </div>
                                    <div className="mt-1 min-w-0 truncate text-[10px] text-fg/35">{candidate.rawText}</div>
                                  </td>
                                  <td className="px-2 py-2 align-top">
                                    <Input
                                      value={formatNumberInput(candidate.unitCost)}
                                      onChange={(event) => updateReviewCandidate(candidate.id, { unitCost: Number(event.target.value) || 0 })}
                                      type="number"
                                      step="0.01"
                                      className="h-7 min-w-0 text-right text-xs tabular-nums"
                                    />
                                    <div className="mt-1 grid grid-cols-2 gap-1">
                                      <Input
                                        value={candidate.uom}
                                        onChange={(event) => updateReviewCandidate(candidate.id, { uom: event.target.value.toUpperCase() })}
                                        className="h-7 min-w-0 text-[11px] uppercase"
                                      />
                                      <Input
                                        value={candidate.currency}
                                        onChange={(event) => updateReviewCandidate(candidate.id, { currency: event.target.value.toUpperCase().slice(0, 3) })}
                                        className="h-7 min-w-0 text-[11px] uppercase"
                                      />
                                    </div>
                                    {candidate.existingUnitCost != null && (
                                      <div className="mt-1 truncate text-right text-[10px] text-fg/35">was {formatMoney(candidate.existingUnitCost, candidate.currency)}</div>
                                    )}
                                  </td>
                                  <td className="max-w-0 px-2 py-2 align-top">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                                      <Badge tone={candidate.recommendation === "duplicate" ? "warning" : candidate.recommendation === "update_cost_basis" ? "info" : "success"}>
                                        {candidate.recommendation.replace(/_/g, " ")}
                                      </Badge>
                                      <Badge>{Math.round(candidate.confidence * 100)}%</Badge>
                                    </div>
                                    <div className="mt-1 line-clamp-2 text-[10px] text-fg/40">{candidate.recommendationReason}</div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                      <PanelPagination label="candidates" onPageChange={setEvidencePage} page={evidencePage} pageSize={candidatePageSize} total={reviewCandidates.length} />
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {activeCostTab === "vendors" && (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel">
            <AnimatePresence mode="wait" initial={false}>
              {selectedVendorName ? (
                <motion.div
                  key="vendor-detail"
                  initial={{ opacity: 0, x: 18 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={closeVendorPage} className="h-8 w-8 px-0" aria-label="Back to vendors" title="Back to vendors">
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </Button>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Database className="h-3.5 w-3.5 shrink-0 text-accent" />
                          <h3 className="truncate text-sm font-semibold text-fg">{selectedVendor?.vendorName ?? selectedVendorName}</h3>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-fg/40">
                          Vendor cost intelligence, price history, and approved product coverage
                        </div>
                      </div>
                    </div>
                    <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
                      <div className="hidden min-w-0 items-center gap-1.5 xl:flex">
                        <div className="min-w-20 rounded-md border border-line bg-bg/35 px-2 py-1">
                          <div className="text-[9px] uppercase leading-none text-fg/35">Products</div>
                          <div className="mt-0.5 flex items-baseline gap-1">
                            <span className="text-sm font-semibold tabular-nums text-fg">{compactCount(vendorMetrics?.productCount ?? vendorProductRows.length)}</span>
                            <span className="text-[10px] text-fg/35">{compactCount(filteredVendorProductRows.length)} table</span>
                          </div>
                        </div>
                        <div className="min-w-20 rounded-md border border-line bg-bg/35 px-2 py-1">
                          <div className="text-[9px] uppercase leading-none text-fg/35">Evidence</div>
                          <div className="mt-0.5 flex items-baseline gap-1">
                            <span className="text-sm font-semibold tabular-nums text-fg">{compactCount(vendorMetrics?.observationCount ?? vendorDetailObservations.length)}</span>
                            <span className="text-[10px] text-fg/35">{compactCount(vendorMetrics?.costBasisCount ?? vendorDetailCosts.length)} basis</span>
                          </div>
                        </div>
                        <div className="min-w-20 rounded-md border border-line bg-bg/35 px-2 py-1">
                          <div className="text-[9px] uppercase leading-none text-fg/35">Confidence</div>
                          <div className="mt-0.5 text-sm font-semibold tabular-nums text-fg">
                            {vendorMetrics?.averageConfidence ? `${Math.round(vendorMetrics.averageConfidence * 100)}%` : "-"}
                          </div>
                        </div>
                        <div className="min-w-24 rounded-md border border-line bg-bg/35 px-2 py-1">
                          <div className="text-[9px] uppercase leading-none text-fg/35">Latest</div>
                          <div className="mt-0.5 flex min-w-0 items-center gap-1">
                            <span className="truncate text-xs font-semibold text-fg">{formatDate(vendorMetrics?.latestObservedAt)}</span>
                            {(vendorMetrics?.currencies ?? []).slice(0, 1).map((currency) => <Badge key={currency} className="px-1 py-0 text-[9px]">{currency}</Badge>)}
                          </div>
                        </div>
                      </div>
                      {vendorDetailLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-fg/40" />}
                      <Button type="button" variant="ghost" size="sm" onClick={() => void loadVendorDetail(selectedVendorName)} disabled={vendorDetailLoading} className="h-8 px-2">
                        <RefreshCw className="h-3.5 w-3.5" />
                        Refresh
                      </Button>
                    </div>
                  </div>

                  {vendorDetailError && (
                    <div className="shrink-0 border-b border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
                      {vendorDetailError}
                    </div>
                  )}

                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-panel2/35 px-3 py-2">
                    <div role="tablist" aria-label="Vendor detail views" className="flex min-w-0 flex-wrap gap-1 rounded-lg bg-bg/45 p-1">
                      {VENDOR_DETAIL_SUBTABS.map((tab) => {
                        const active = vendorDetailTab === tab.id;
                        const Icon = tab.icon;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setVendorDetailTab(tab.id)}
                            className={cn(
                              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                              active ? "bg-panel text-fg shadow-sm" : "text-fg/50 hover:bg-panel/70 hover:text-fg",
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                    <Badge tone="info">{compactCount(filteredVendorProductRows.length)} products</Badge>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden bg-bg/15 p-3">
                    <AnimatePresence mode="wait" initial={false}>
                      {vendorDetailTab === "overview" && (
                        <motion.div
                          key="vendor-overview"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.18 }}
                          className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]"
                        >
                          <div className="grid min-h-0 gap-3">
                            <PriceIndexChart points={vendorPriceIndexPoints} suffix="%" emptyLabel="No multi-point price history for this vendor yet" />
                            <EvidenceBars points={vendorEvidenceVolumePoints} />
                          </div>
                          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-bg/30">
                            <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
                              <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-fg">
                                <PackageSearch className="h-3.5 w-3.5 text-accent" />
                                <span className="truncate">Recent Products</span>
                              </div>
                              <Badge>{compactCount(filteredVendorProductRows.length)}</Badge>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto p-2">
                              {filteredVendorProductRows.length === 0 ? (
                                <div className="flex h-full min-h-36 items-center justify-center text-center text-xs text-fg/35">No products to show.</div>
                              ) : (
                                <div className="grid gap-1.5">
                                  {filteredVendorProductRows.slice(0, 18).map((product) => {
                                    const trendPct = productTrendPercent(product);
                                    return (
                                      <div key={product.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-line/60 bg-panel/55 px-2 py-1.5">
                                        <div className="min-w-0">
                                          <div className="truncate text-xs font-medium text-fg">{product.name}</div>
                                          <div className="truncate text-[10px] text-fg/35">{product.vendorSku || "No SKU"} · {product.resourceName || "Unlinked"}</div>
                                        </div>
                                        <div className="text-right">
                                          <div className="text-xs font-semibold tabular-nums text-fg">{formatMoney(product.latestUnitCost, product.currency)}</div>
                                          <div className={cn("text-[10px] tabular-nums", trendPct == null ? "text-fg/35" : trendPct >= 0 ? "text-warning" : "text-success")}>
                                            {trendPct == null ? "flat" : `${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%`}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}

                      {vendorDetailTab === "products" && (
                        <motion.div
                          key="vendor-products"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.18 }}
                          className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-bg/30"
                        >
                          <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <PackageSearch className="h-3.5 w-3.5 shrink-0 text-accent" />
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold text-fg">Products</div>
                                <div className="truncate text-[10px] text-fg/35">Full vendor product table with price movement and evidence counts</div>
                              </div>
                            </div>
                            <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-2">
                              <div className="relative w-full max-w-xs min-w-40">
                                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
                                <Input
                                  value={vendorProductQuery}
                                  onChange={(event) => setVendorProductQuery(event.target.value)}
                                  placeholder="Search products"
                                  className="h-8 pl-7 text-xs"
                                />
                              </div>
                              <select
                                aria-label="Sort products"
                                value={vendorProductSortBy}
                                onChange={(event) => setVendorProductSortBy(event.target.value as VendorProductSort)}
                                className="h-8 min-w-40 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none transition-colors hover:border-accent/30"
                              >
                                <option value="latest_desc">Latest first</option>
                                <option value="name_asc">Name A-Z</option>
                                <option value="cost_desc">Cost high</option>
                                <option value="cost_asc">Cost low</option>
                                <option value="trend_desc">Trend high</option>
                                <option value="evidence_desc">Most evidence</option>
                              </select>
                            </div>
                          </div>

                          <div className="min-h-0 flex-1 overflow-auto">
                            {filteredVendorProductRows.length === 0 ? (
                              <div className="flex h-full min-h-64 items-center justify-center px-3 text-center text-xs text-fg/35">
                                No vendor products match the current search.
                              </div>
                            ) : (
                              <table className="w-full min-w-[980px] table-fixed text-xs">
                                <thead className="sticky top-0 z-20 bg-panel2/95 shadow-[0_1px_0_0_var(--line)]">
                                  <tr className="border-b border-line text-[10px] uppercase text-fg/35">
                                    <th className="w-[30%] px-3 py-2 text-left font-medium">Product</th>
                                    <th className="w-[12%] px-3 py-2 text-left font-medium">SKU</th>
                                    <th className="w-[13%] px-3 py-2 text-right font-medium">Latest Cost</th>
                                    <th className="w-[13%] px-3 py-2 text-left font-medium">Trend</th>
                                    <th className="w-[16%] px-3 py-2 text-left font-medium">Range</th>
                                    <th className="w-[8%] px-3 py-2 text-left font-medium">Evidence</th>
                                    <th className="w-[8%] px-3 py-2 text-left font-medium">Latest</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visibleVendorProducts.map((product, index) => {
                                    const trendPct = productTrendPercent(product);
                                    return (
                                      <motion.tr
                                        key={product.key}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.18, delay: index * 0.015 }}
                                        className="h-14 border-b border-line/70 last:border-b-0"
                                      >
                                        <td className="px-3 py-2">
                                          <div className="truncate font-semibold text-fg">{product.name}</div>
                                          <div className="mt-0.5 truncate text-[10px] text-fg/35">{product.resourceName || "Unlinked cost item"} · per {product.uom}</div>
                                        </td>
                                        <td className="px-3 py-2 text-fg/55">
                                          <span className="block truncate">{product.vendorSku || "No SKU"}</span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <div className="font-semibold tabular-nums text-fg">{formatMoney(product.latestUnitCost, product.currency)}</div>
                                          <div className="text-[10px] text-fg/35">{product.currency}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="flex items-center gap-2">
                                            <ProductSparkline points={product.points} />
                                            <span className={cn("min-w-12 text-right text-[11px] tabular-nums", trendPct == null ? "text-fg/35" : trendPct >= 0 ? "text-warning" : "text-success")}>
                                              {trendPct == null ? "-" : `${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%`}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="truncate tabular-nums text-fg/65">
                                            {formatMoney(product.minUnitCost, product.currency)} - {formatMoney(product.maxUnitCost, product.currency)}
                                          </div>
                                          <div className="text-[10px] text-fg/35">avg {formatMoney(product.averageUnitCost, product.currency)}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="font-medium tabular-nums text-fg/70">{compactCount(product.observationCount)}</div>
                                          <div className="text-[10px] text-fg/35">{compactCount(product.costBasisCount)} basis</div>
                                        </td>
                                        <td className="px-3 py-2 text-fg/55">
                                          <div className="truncate">{formatDate(product.latestObservedAt)}</div>
                                        </td>
                                      </motion.tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                          <PanelPagination label="products" onPageChange={setVendorProductPage} page={vendorProductPage} pageSize={vendorProductPageSize} total={filteredVendorProductRows.length} />
                        </motion.div>
                      )}

                      {vendorDetailTab === "evidence" && (
                        <motion.div
                          key="vendor-evidence"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.18 }}
                          className="grid h-full min-h-0 gap-3 xl:grid-cols-2"
                        >
                          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-bg/30">
                            <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
                              <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-fg">
                                <History className="h-3.5 w-3.5 text-success" />
                                <span className="truncate">Observations</span>
                              </div>
                              <Badge>{compactCount(vendorDetailObservations.length)}</Badge>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                              {vendorDetailObservations.length === 0 ? (
                                <div className="flex h-full min-h-48 items-center justify-center text-center text-xs text-fg/35">No observations for this vendor.</div>
                              ) : (
                                <table className="w-full min-w-[640px] table-fixed text-xs">
                                  <thead className="sticky top-0 z-20 bg-panel2/95 shadow-[0_1px_0_0_var(--line)]">
                                    <tr className="border-b border-line text-[10px] uppercase text-fg/35">
                                      <th className="w-[34%] px-3 py-2 text-left font-medium">Product</th>
                                      <th className="w-[18%] px-3 py-2 text-right font-medium">Unit Cost</th>
                                      <th className="w-[16%] px-3 py-2 text-left font-medium">Evidence</th>
                                      <th className="w-[16%] px-3 py-2 text-left font-medium">Confidence</th>
                                      <th className="w-[16%] px-3 py-2 text-left font-medium">Date</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {vendorDetailObservations.map((observation) => (
                                      <tr key={observation.id} className="h-12 border-b border-line/70 last:border-b-0">
                                        <td className="px-3 py-2">
                                          <div className="truncate font-medium text-fg">{observationProductName(observation, resourceById)}</div>
                                          <div className="truncate text-[10px] text-fg/35">{observation.vendorSku || "No SKU"} · {observation.observedUom}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <div className="font-semibold tabular-nums text-fg">{formatMoney(observation.unitCost, observation.currency)}</div>
                                          <div className="text-[10px] text-fg/35">qty {observation.quantity}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="truncate text-fg/60">{documentTypeLabel(observation.documentType)}</div>
                                          <div className="truncate text-[10px] text-fg/35">{observation.rawText}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <Badge tone={confidenceTone(observation.confidence)}>{Math.round(observation.confidence * 100)}%</Badge>
                                        </td>
                                        <td className="px-3 py-2 text-fg/55">{formatDate(observation.effectiveDate || observation.observedAt)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>

                          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-bg/30">
                            <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
                              <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-fg">
                                <Database className="h-3.5 w-3.5 text-accent" />
                                <span className="truncate">Cost Basis</span>
                              </div>
                              <Badge>{compactCount(vendorDetailCosts.length)}</Badge>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto">
                              {vendorDetailCosts.length === 0 ? (
                                <div className="flex h-full min-h-48 items-center justify-center text-center text-xs text-fg/35">No cost basis rows for this vendor.</div>
                              ) : (
                                <table className="w-full min-w-[640px] table-fixed text-xs">
                                  <thead className="sticky top-0 z-20 bg-panel2/95 shadow-[0_1px_0_0_var(--line)]">
                                    <tr className="border-b border-line text-[10px] uppercase text-fg/35">
                                      <th className="w-[38%] px-3 py-2 text-left font-medium">Resource</th>
                                      <th className="w-[18%] px-3 py-2 text-right font-medium">Cost</th>
                                      <th className="w-[18%] px-3 py-2 text-left font-medium">Method</th>
                                      <th className="w-[13%] px-3 py-2 text-left font-medium">Confidence</th>
                                      <th className="w-[13%] px-3 py-2 text-left font-medium">Date</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {vendorDetailCosts.map((cost) => (
                                      <tr key={cost.id} className="h-12 border-b border-line/70 last:border-b-0">
                                        <td className="px-3 py-2">
                                          <div className="truncate font-medium text-fg">{costResourceName(cost)}</div>
                                          <div className="truncate text-[10px] text-fg/35">{costResourceCategory(cost)} · {cost.uom}</div>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <div className="font-semibold tabular-nums text-fg">{formatMoney(cost.unitCost, cost.currency)}</div>
                                          <div className="text-[10px] text-fg/35">{cost.sampleSize} sample{cost.sampleSize === 1 ? "" : "s"}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <div className="truncate text-fg/60">{methodLabel(cost.method)}</div>
                                          <div className="truncate text-[10px] text-fg/35">{costSourceLabel(cost)}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                          <Badge tone={confidenceTone(cost.confidence)}>{Math.round(cost.confidence * 100)}%</Badge>
                                        </td>
                                        <td className="px-3 py-2 text-fg/55">{formatDate(costEvidenceDate(cost))}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="vendor-list"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="flex min-h-0 flex-1 flex-col"
                >
                  <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-fg">
                      <Database className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <span className="truncate">Vendor Product Registry</span>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                      <div className="relative w-full max-w-xs min-w-40">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
                        <Input
                          value={vendorQuery}
                          onChange={(event) => setVendorQuery(event.target.value)}
                          placeholder="Search vendors"
                          className="h-8 pl-7 text-xs"
                        />
                      </div>
                      <select
                        aria-label="Sort vendors"
                        value={vendorSortBy}
                        onChange={(event) => setVendorSortBy(event.target.value as VendorRegistrySort)}
                        className="h-8 min-w-40 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none transition-colors hover:border-accent/30"
                      >
                        <option value="latest_desc">Latest first</option>
                        <option value="name_asc">Name A-Z</option>
                        <option value="products_desc">Most products</option>
                        <option value="evidence_desc">Most evidence</option>
                        <option value="cost_basis_desc">Most cost basis</option>
                      </select>
                      <Badge tone="info">{compactCount(filteredVendorRecords.length)} / {compactCount(vendorRecords.length)}</Badge>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto">
                    {vendorRecords.length === 0 ? (
                      <div className="flex h-full min-h-64 items-center justify-center px-3 text-center text-xs text-fg/35">
                        No vendor products have been approved yet.
                      </div>
                    ) : filteredVendorRecords.length === 0 ? (
                      <div className="flex h-full min-h-64 items-center justify-center px-3 text-center text-xs text-fg/35">
                        No vendors match the current search.
                      </div>
                    ) : (
                      <table className="w-full min-w-[820px] table-fixed text-xs">
                        <thead className="sticky top-0 z-20 bg-panel2/95 shadow-[0_1px_0_0_var(--line)]">
                          <tr className="border-b border-line text-[10px] uppercase text-fg/35">
                            <th className="w-[27%] px-3 py-2 text-left font-medium">Vendor</th>
                            <th className="w-[35%] px-3 py-2 text-left font-medium">Product Coverage</th>
                            <th className="w-[13%] px-3 py-2 text-left font-medium">Evidence</th>
                            <th className="w-[13%] px-3 py-2 text-left font-medium">Currencies</th>
                            <th className="w-[12%] px-3 py-2 text-left font-medium">Latest</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredVendorRecords.map((vendor, index) => {
                            const primaryProduct = vendor.products[0];
                            return (
                              <motion.tr
                                key={vendor.vendorName}
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.16, delay: index * 0.01 }}
                                tabIndex={0}
                                role="button"
                                onClick={() => openVendorPage(vendor)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    openVendorPage(vendor);
                                  }
                                }}
                                className="h-16 cursor-pointer border-b border-line/70 outline-none transition-colors last:border-b-0 hover:bg-panel2/65 focus:bg-panel2/65"
                              >
                                <td className="px-3 py-2">
                                  <div className="truncate font-semibold text-fg">{vendor.vendorName}</div>
                                  <div className="mt-0.5 text-[10px] text-fg/40">
                                    {compactCount(vendor.productCount)} product{vendor.productCount === 1 ? "" : "s"} linked
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="truncate font-medium text-fg/75">{primaryProduct?.name ?? "No approved products yet"}</div>
                                  <div className="mt-0.5 truncate text-[10px] text-fg/35">
                                    {primaryProduct
                                      ? `${primaryProduct.vendorSku ? `SKU ${primaryProduct.vendorSku}` : "No SKU"} · ${primaryProduct.resourceName || "Unlinked cost item"}`
                                      : "Open the vendor page to review evidence and imported rows"}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="font-medium tabular-nums text-fg/70">{compactCount(vendor.observationCount)}</div>
                                  <div className="text-[10px] text-fg/35">{compactCount(vendor.costBasisCount)} cost basis rows</div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {vendor.currencies.length > 0
                                      ? vendor.currencies.slice(0, 3).map((currency) => <Badge key={currency}>{currency}</Badge>)
                                      : <Badge>None</Badge>}
                                    {vendor.currencies.length > 3 && <Badge>+{vendor.currencies.length - 3}</Badge>}
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate text-fg/60">{formatDate(vendor.latestObservedAt)}</span>
                                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg/30" />
                                  </div>
                                </td>
                              </motion.tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}
      </CardBody>
    </Card>
    {typeof document !== "undefined" && createPortal(
      <AnimatePresence>
        {drawerMode && (
          <>
            <motion.div
              key="effective-cost-drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/20"
              onClick={closeCostDrawer}
            />
            <EffectiveCostDrawer
              key={drawerMode === "edit" ? selectedCostId ?? "edit" : "create"}
              mode={drawerMode}
              cost={selectedCost}
              form={costForm}
              resourceOptions={resourceOptions}
              resourceRecords={resources}
              saving={costSaving}
              deleting={costDeleting}
              error={costFormError}
              onChange={(patch) => setCostForm((current) => ({ ...current, ...patch }))}
              onClose={closeCostDrawer}
              onSave={() => void handleSaveEffectiveCost()}
              onDelete={() => void handleDeleteEffectiveCost()}
            />
          </>
        )}
        {bulkDeleteCostConfirmOpen && (
          <>
            <motion.div
              key="bulk-delete-cost-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/30"
              onClick={() => {
                if (!bulkDeletingCosts) setBulkDeleteCostConfirmOpen(false);
              }}
            />
            <div
              key="bulk-delete-cost-modal-frame"
              className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4"
            >
              <motion.div
                key="bulk-delete-cost-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="bulk-delete-cost-title"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="pointer-events-auto w-full max-w-[440px] rounded-lg border border-line bg-panel p-4 shadow-2xl"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-danger/25 bg-danger/10 text-danger">
                    <Trash2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div id="bulk-delete-cost-title" className="text-sm font-semibold text-fg">Delete selected cost basis rows?</div>
                    <div className="mt-1 text-xs leading-relaxed text-fg/50">
                      This deletes {selectedCostCount.toLocaleString()} current cost basis row{selectedCostCount === 1 ? "" : "s"}. Price observations, vendor products, and PDF review evidence stay in history.
                    </div>
                    {bulkDeleteCostError && (
                      <div className="mt-2 text-[11px] text-danger">{bulkDeleteCostError}</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setBulkDeleteCostConfirmOpen(false)}
                    disabled={bulkDeletingCosts}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void confirmBulkDeleteCosts()}
                    disabled={bulkDeletingCosts || selectedCostCount === 0}
                  >
                    {bulkDeletingCosts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete
                  </Button>
                </div>
              </motion.div>
            </div>
          </>
        )}
        {deleteReviewRunTarget && (
          <>
            <motion.div
              key="delete-review-run-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/30"
              onClick={() => {
                if (!deletingReviewRunId) setDeleteReviewRunTarget(null);
              }}
            />
            <div
              key="delete-review-run-modal-frame"
              className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center p-4"
            >
              <motion.div
                key="delete-review-run-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-review-run-title"
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="pointer-events-auto w-full max-w-[440px] rounded-lg border border-line bg-panel p-4 shadow-2xl"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-danger/25 bg-danger/10 text-danger">
                    <Trash2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div id="delete-review-run-title" className="text-sm font-semibold text-fg">Archive PDF review?</div>
                    <div className="mt-1 text-xs leading-relaxed text-fg/50">
                      This removes {deleteReviewRunTarget.fileNames.join(", ") || deleteReviewRunTarget.batchId} from active PDF Intake history and keeps the review workspace in the archive. It does not delete committed cost basis rows.
                    </div>
                    <div className="mt-2 truncate rounded-md border border-line bg-bg/45 px-2 py-1.5 text-[11px] text-fg/45">
                      {deleteReviewRunTarget.batchId}
                    </div>
                    {deleteReviewRunError && (
                      <div className="mt-2 text-[11px] text-danger">{deleteReviewRunError}</div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteReviewRunTarget(null)}
                    disabled={Boolean(deletingReviewRunId)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void confirmDeleteReviewRun()}
                    disabled={Boolean(deletingReviewRunId)}
                  >
                    {deletingReviewRunId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Archive
                  </Button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>,
      document.body,
    )}
    </>
  );
}

function EffectiveCostDrawer({
  cost,
  deleting,
  error,
  form,
  mode,
  onChange,
  onClose,
  onDelete,
  onSave,
  resourceOptions,
  resourceRecords,
  saving,
}: {
  cost: EffectiveCostRecord | null;
  deleting: boolean;
  error: string | null;
  form: EffectiveCostFormState;
  mode: EffectiveCostDrawerMode;
  onChange: (patch: Partial<EffectiveCostFormState>) => void;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
  resourceOptions: SearchablePickerOption[];
  resourceRecords: CostResourceRecord[];
  saving: boolean;
}) {
  const selectedResource = form.resourceId
    ? resourceRecords.find((resource) => resource.id === form.resourceId) ?? null
    : null;
  const evidenceText = cost ? costEvidenceText(cost) : "";
  const title = mode === "create" ? "Add Cost Basis Row" : costResourceName(cost!);
  const currencyValue = normalizeCurrency(form.currency);
  const currencyOptions = [
    ...COST_CURRENCIES.map((currency) => ({ value: currency, label: currency })),
    ...(COST_CURRENCIES.includes(currencyValue as typeof COST_CURRENCIES[number])
      ? []
      : [{ value: currencyValue, label: currencyValue }]),
  ];

  function handleResourceSelect(resourceId: string) {
    const resource = resourceRecords.find((candidate) => candidate.id === resourceId);
    onChange({
      resourceId,
      resourceName: resource?.name ?? form.resourceName,
      resourceType: resource?.resourceType ?? form.resourceType,
      category: resource?.category ?? form.category,
      code: resource?.code ?? form.code,
      uom: form.uom || resource?.defaultUom || "EA",
    });
  }

  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 z-50 flex w-[min(760px,calc(100vw-24px))] flex-col border-l border-line bg-panel shadow-2xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel2/35 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-success" />
            <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-fg/45">
            {mode === "create" ? "Manual entry for the cost basis register." : `${methodLabel(cost?.method ?? "manual")} · updated ${formatDate(cost?.updatedAt)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1.5 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="grid gap-4">
          <section className="rounded-lg border border-line bg-panel2/35 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-fg">Cost Item</div>
              {mode === "create" && form.resourceId && (
                <button
                  type="button"
                  onClick={() => onChange({ resourceId: "" })}
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  Use new item
                </button>
              )}
            </div>
            <div className="grid gap-3">
              {mode === "create" && (
                <div>
                  <Label>Existing Item</Label>
                  <SearchablePicker
                    value={form.resourceId || null}
                    options={resourceOptions}
                    onSelect={handleResourceSelect}
                    placeholder="Search cost items..."
                    searchPlaceholder="Search by item, code, category..."
                    triggerClassName="h-9 rounded-lg text-xs"
                    width={460}
                    emptyMessage="No cost items available"
                  />
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <div>
                  <Label>{selectedResource ? "Selected Item" : "Item Name"}</Label>
                  <Input
                    value={form.resourceName}
                    onChange={(event) => onChange({ resourceName: event.target.value })}
                    disabled={Boolean(selectedResource)}
                    placeholder="Material, labour, equipment, subcontract, etc."
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label>Code</Label>
                  <Input
                    value={form.code}
                    onChange={(event) => onChange({ code: event.target.value })}
                    disabled={Boolean(selectedResource)}
                    className="text-sm"
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Type</Label>
                  <Input
                    value={form.resourceType}
                    onChange={(event) => onChange({ resourceType: event.target.value })}
                    disabled={Boolean(selectedResource)}
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label>Category</Label>
                  <Input
                    value={form.category}
                    onChange={(event) => onChange({ category: event.target.value })}
                    disabled={Boolean(selectedResource)}
                    className="text-sm"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-panel2/35 p-4">
            <div className="mb-3 text-xs font-semibold text-fg">Cost Values</div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label>Unit Cost</Label>
                <Input
                  value={form.unitCost}
                  onChange={(event) => onChange({ unitCost: event.target.value })}
                  type="number"
                  step="0.01"
                  className="text-sm tabular-nums"
                />
              </div>
              <div>
                <Label>Unit Price</Label>
                <Input
                  value={form.unitPrice}
                  onChange={(event) => onChange({ unitPrice: event.target.value })}
                  type="number"
                  step="0.01"
                  placeholder="Optional"
                  className="text-sm tabular-nums"
                />
              </div>
              <div>
                <Label>UOM</Label>
                <Input
                  value={form.uom}
                  onChange={(event) => onChange({ uom: event.target.value.toUpperCase() })}
                  className="text-sm uppercase"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Select
                  value={currencyValue}
                  onValueChange={(currency) => onChange({ currency })}
                  options={currencyOptions}
                  triggerClassName="text-sm uppercase"
                />
              </div>
              <div>
                <Label>Confidence %</Label>
                <Input
                  value={form.confidence}
                  onChange={(event) => onChange({ confidence: event.target.value })}
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  className="text-sm tabular-nums"
                />
              </div>
              <div>
                <Label>Sample Size</Label>
                <Input
                  value={form.sampleSize}
                  onChange={(event) => onChange({ sampleSize: event.target.value })}
                  type="number"
                  min="0"
                  step="1"
                  className="text-sm tabular-nums"
                />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-panel2/35 p-4">
            <div className="mb-3 text-xs font-semibold text-fg">Scope</div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Vendor</Label>
                <Input
                  value={form.vendorName}
                  onChange={(event) => onChange({ vendorName: event.target.value })}
                  placeholder="Optional"
                  className="text-sm"
                />
              </div>
              <div>
                <Label>Region</Label>
                <Input
                  value={form.region}
                  onChange={(event) => onChange({ region: event.target.value })}
                  placeholder="Optional"
                  className="text-sm"
                />
              </div>
              <div>
                <Label>Effective Date</Label>
                <Input
                  value={form.effectiveDate}
                  onChange={(event) => onChange({ effectiveDate: event.target.value })}
                  type="date"
                  className="text-sm"
                />
              </div>
              <div>
                <Label>Expires</Label>
                <Input
                  value={form.expiresAt}
                  onChange={(event) => onChange({ expiresAt: event.target.value })}
                  type="date"
                  className="text-sm"
                />
              </div>
              <div>
                <Label>Method</Label>
                <select
                  value={form.method}
                  onChange={(event) => onChange({ method: event.target.value === "contract" ? "contract" : "manual" })}
                  className="h-9 w-full rounded-lg border border-line bg-bg/50 px-3 text-sm text-fg outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                >
                  <option value="manual">Manual</option>
                  <option value="contract">Contract</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={form.notes}
                  onChange={(event) => onChange({ notes: event.target.value })}
                  placeholder="Source, assumptions, price expiry, estimator comments."
                  className="min-h-20 text-sm"
                />
              </div>
            </div>
          </section>

          {mode === "edit" && (
            <section className="rounded-lg border border-line bg-panel2/35 p-4">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-fg">
                <FileText className="h-3.5 w-3.5 text-accent" />
                Evidence Snapshot
              </div>
              <div className="rounded-md border border-line bg-bg/45 px-3 py-2 text-[11px] leading-relaxed text-fg/55">
                {evidenceText || "No raw source evidence is attached. This row can still be maintained manually."}
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel2/35 px-5 py-3">
        <div>
          {mode === "edit" && (
            <Button variant="danger" size="sm" onClick={onDelete} disabled={saving || deleting}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving || deleting}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" onClick={onSave} disabled={saving || deleting}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
      </div>
    </motion.aside>
  );
}

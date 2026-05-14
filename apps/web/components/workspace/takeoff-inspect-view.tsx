"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleDashed, Eye, EyeOff, GitBranch, Link2, Loader2, LocateFixed, Pencil, Plus, RefreshCw, ScanSearch, Settings2, Sigma, Trash2, Wand2, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { TakeoffAnnotation } from "@/components/workspace/takeoff/annotation-canvas";
import type {
  DrawingAnalysisPreset,
  DrawingGeometryAnalysisResult,
  DrawingGeometrySource,
  TakeoffLinkRecord,
} from "@/lib/api";

/** `bim` is element-aware (IFC/Revit/Navisworks) and uses the BIM-specific
 *  inspect surface; `model` is geometry-only (STEP/glTF/OBJ/STL) and degrades
 *  to a metric summary without element semantics; `spreadsheet` treats each
 *  row as an entity that can be imported into a worksheet one click at a
 *  time, using a column-mapping heuristic. */
export type InspectMode = "pdf" | "dwg" | "bim" | "model" | "spreadsheet" | "photo-bom" | "empty";

export type InspectDrawingDetectionKind = "system" | "line" | "symbol" | "circle" | "text";

export interface InspectDrawingAnalysisSettings {
  preset: DrawingAnalysisPreset;
  geometrySource: DrawingGeometrySource;
  includeSymbols: boolean;
  includeTextRegions: boolean;
  includeCircles: boolean;
  traceSystems: boolean;
  maxLines: number;
  maxRegions: number;
  minLineLength: number;
  snapTolerance: number;
  lineSensitivity: number;
  noiseRejection: number;
}

export interface InspectDrawingAnalysisSnapshot {
  documentId: string;
  fileName: string;
  pageNumber: number;
  analysis: DrawingGeometryAnalysisResult | null;
  settings: InspectDrawingAnalysisSettings;
  overlay: {
    lines: boolean;
    systems: boolean;
    symbols: boolean;
    circles: boolean;
    text: boolean;
  };
  running: boolean;
  savingId: string | null;
  error: string | null;
  selectedDetectionId: string | null;
  calibration: {
    unit: string;
    pixelsPerUnit: number;
    analysisToPaperScaleX: number;
    analysisToPaperScaleY: number;
  } | null;
}

export interface InspectVisionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

export interface InspectSmartCountItem {
  id: string;
  label: string;
  count: number;
  confidence: "high" | "medium" | "low";
  notes: string;
  included: boolean;
  isSaved: boolean;
  isLinked: boolean;
  annotationId: string | null;
  bbox: InspectVisionBoundingBox | null;
}

export interface InspectSmartCountSnapshot {
  documentId: string;
  fileName: string;
  pageNumber: number;
  running: boolean;
  savingId: string | null;
  error: string | null;
  cropImage: string | null;
  bbox: InspectVisionBoundingBox | null;
  items: InspectSmartCountItem[];
  selectedItemId: string | null;
}

export interface InspectDwgLayerSummary {
  name: string;
  color: string;
  count: number;
  visible: boolean;
}

export interface InspectDwgLayoutSummary {
  name: string;
  entityCount: number;
}

export interface InspectDwgEntityRow {
  id: string;
  type: string;
  layer: string;
  layoutName: string;
  label: string;
  color: string;
  measurementLabel: string;
  quantity: number;
  uom: string;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
}

export interface InspectDwgAutoCountRow {
  id: string;
  label: string;
  type: string;
  layer: string;
  count: number;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
}

export interface InspectDwgSystemRow {
  id: string;
  label: string;
  layer: string;
  segmentCount: number;
  quantity: number;
  uom: string;
  sourceEntityIds: string[];
  isLinked: boolean;
  linkCount: number;
}

export interface InspectDwgIntelligenceSnapshot {
  documentId: string;
  fileName: string;
  selectedLayout: string;
  selectedEntityId: string | null;
  savingEntityId: string | null;
  entityCount: number;
  visibleEntityCount: number;
  layerCount: number;
  annotationCount: number;
  layouts: InspectDwgLayoutSummary[];
  layers: InspectDwgLayerSummary[];
  entities: InspectDwgEntityRow[];
  autoCounts: InspectDwgAutoCountRow[];
  systems: InspectDwgSystemRow[];
  status: string | null;
  processedAt: string | null;
}

export interface InspectPhotoBomRow {
  id: string;
  description: string;
  quantity: number;
  uom: string;
  /** AI-suggested category id from the org's EntityCategory taxonomy.
   *  Empty string when the model couldn't pick one. The estimator can
   *  still pick any category via the + Add popover. */
  suggestedCategoryId: string;
  /** Model confidence in [0, 1]. Surfaced as a chip + sort hint. */
  confidence: number;
  /** Notes the model attached to the row, e.g. "approximate scale based
   *  on the orange marker". */
  notes: string;
  /** Filenames of the source photos this row came from. */
  sourcePhotoNames: string[];
  /** Whether this row has already been turned into a worksheet line item.
   *  Currently never true on first surface; the local Inspect view flips
   *  this after + Add to dim the row. */
  isLinked: boolean;
}

export interface InspectPhotoBom {
  /** Total photos that contributed to this batch. */
  photoCount: number;
  /** AI's one-paragraph summary of what it found. */
  summary: string;
  /** Warnings from the model (low confidence, ambiguous photos, etc). */
  warnings: string[];
  rows: InspectPhotoBomRow[];
}
export type InspectModelBasis = "count" | "area" | "volume";

/** A single spreadsheet row surfaced to the Entities tab. Carries enough
 *  context that the per-row "+ Add" handler can build a worksheet line
 *  item without re-fetching the source file. */
export interface InspectSpreadsheetRow {
  kind?: "raw" | "pivot";
  /** Stable id keyed off the source file + row index. Used to dedupe and
   *  drive selection. */
  id: string;
  /** Numeric index into the active raw row list or active pivot row list. */
  index: number;
  /** Display values keyed by header name. Strings only — the column profile
   *  + mapping figure out which ones are numeric on the way to a line item. */
  values: Record<string, string>;
  pivot?: {
    groupBy: string;
    measure: string;
    measureLabel: string;
    sourceRowCount: number;
    total: number;
    average: number;
  };
}

export interface InspectSpreadsheet {
  sourceName: string;
  mode?: "raw" | "pivot";
  rowCount: number;
  columnCount: number;
  headers: string[];
  rows: InspectSpreadsheetRow[];
  pivot?: {
    groupBy: string;
    measure: string;
    measureLabel: string;
    groupCount: number;
    sourceRowCount: number;
  } | null;
  /** Heuristic column → line-item field mapping derived from the header
   *  names. Used by createLineItemFromSpreadsheetRow on the takeoff-tab
   *  side; surfaced here so the Entities tab can render the row's preview
   *  consistently with what's about to be created. */
  mapping: {
    name: string | null;
    quantity: string | null;
    uom: string | null;
    cost: string | null;
  };
}

export interface InspectModelElement {
  id: string;
  name: string;
  externalId: string;
  elementClass?: string | null;
  material?: string | null;
  level?: string | null;
  /** Construction classification keyed by standard. Same shape and keys as
   *  WorksheetItem.classification. UI surfaces Uniformat first (most common
   *  estimating reporting axis), then MasterFormat. */
  classification?: Record<string, string> | null;
  /** Level of Development: "" | "100" | "200" | "300" | "350" | "400" | "500". */
  lod?: string | null;
  /** Provenance of LOD: "manual" | "pset" | "". Used by the UI to badge how
   *  the LOD was determined and warn before re-ingest could clobber it. */
  lodSource?: string | null;
  quantitySummary: string;
  isLinked: boolean;
}

/** Trimmed shape of an EntityCategory the side panel needs for its
 *  takeoff-category picker. Avoids dragging the full EntityCategory dep
 *  into takeoff-inspect-view. */
export interface InspectCategoryOption {
  id: string;
  name: string;
  itemSource: "rate_schedule" | "catalog" | "freeform";
  enabled: boolean;
  order: number;
  rateScheduleItems?: InspectRateScheduleItemOption[];
}

export interface InspectRateScheduleItemOption {
  id: string;
  scheduleId: string;
  scheduleName: string;
  code: string;
  name: string;
  unit: string;
  tierUnits: Record<string, number>;
  rate: number | null;
  tierName: string | null;
}

export interface InspectCategoryPick {
  categoryId: string;
  rateScheduleItemId?: string;
  rateScheduleItemName?: string;
  rateScheduleItemUnit?: string;
  tierUnits?: Record<string, number>;
}

export interface InspectAssetSummary {
  id: string;
  fileName: string;
  status: string;
  parser: string;
  isEditable: boolean;
  counts: { elements: number; quantities: number; links: number; issues: number };
}

export interface InspectSnapshot {
  mode: InspectMode;
  // PDF / DWG annotations
  annotations: TakeoffAnnotation[];
  takeoffLinks: TakeoffLinkRecord[];
  selectedAnnotationId: string | null;
  editingAnnotationId: string | null;
  drawingAnalysis: InspectDrawingAnalysisSnapshot | null;
  smartCount: InspectSmartCountSnapshot | null;
  dwgIntelligence: InspectDwgIntelligenceSnapshot | null;
  // 3D model
  modelElements: InspectModelElement[];
  modelElementsLoading: boolean;
  modelError: string | null;
  modelSyncing: boolean;
  modelSearch: string;
  modelBasis: InspectModelBasis;
  modelAsset: InspectAssetSummary | null;
  selectedModelElementId: string | null;
  // Spreadsheet — populated only when mode === "spreadsheet"
  spreadsheet: InspectSpreadsheet | null;
  // Photo-derived BOM — populated when the photo intake just finished an
  // analysis. Lives in the side panel regardless of which doc is currently
  // open in the takeoff surface so the estimator can review/+add without
  // losing what they were looking at.
  photoBom: InspectPhotoBom | null;
  /** Available enabled categories for the takeoff-category picker; carried
   *  here so the side panel can render the picker without dragging the
   *  full workspace object in. */
  availableCategories: InspectCategoryOption[];
  /** Currently-selected takeoff category id (the bucket every + Add lands
   *  in). null = the user hasn't picked one yet AND no heuristic match
   *  exists; the side panel should surface a "pick a category" prompt and
   *  disable + Add buttons. */
  takeoffCategoryId: string | null;
}

export interface InspectActions {
  selectAnnotation: (id: string | null) => void;
  toggleAnnotationVisibility: (id: string) => void;
  deleteAnnotation: (id: string) => void;
  editAnnotation: (id: string) => void;
  cancelAnnotationEdit: () => void;
  saveAnnotationEdit: (id: string, updates: { label?: string; color?: string; groupName?: string }) => void;
  runDrawingAnalysis: () => Promise<void> | void;
  updateDrawingAnalysisSettings: (patch: Partial<InspectDrawingAnalysisSettings>) => void;
  setDrawingAnalysisOverlay: (patch: Partial<InspectDrawingAnalysisSnapshot["overlay"]>) => void;
  selectDrawingDetection: (id: string | null, kind?: InspectDrawingDetectionKind) => void;
  selectDrawingDetectionGroup: (ids: string[]) => void;
  saveDrawingDetection: (id: string, kind: "system" | "symbol" | "circle" | "line") => Promise<void> | void;
  createLineItemFromDrawingDetection: (id: string, kind: "system" | "symbol" | "circle" | "line", pick: InspectCategoryPick) => Promise<void> | void;
  createLineItemFromDrawingSymbolGroup: (ids: string[], label: string, pick: InspectCategoryPick) => Promise<void> | void;
  deleteDrawingDetection: (id: string, kind: InspectDrawingDetectionKind) => void;
  deleteDrawingDetectionGroup: (ids: string[], kind: InspectDrawingDetectionKind) => void;
  selectSmartCountItem: (id: string | null) => void;
  toggleSmartCountItem: (id: string) => void;
  saveSmartCountItem: (id: string) => Promise<void> | void;
  createLineItemFromSmartCountItem: (id: string, pick: InspectCategoryPick) => Promise<void> | void;
  saveSelectedSmartCountItems: () => Promise<void> | void;
  deleteSmartCountItem: (id: string) => void;
  clearSmartCountResults: () => void;
  selectDwgEntity: (id: string | null) => void;
  selectDwgEntities: (ids: string[]) => void;
  createLineItemFromDwgEntity: (id: string, pick: InspectCategoryPick) => Promise<void> | void;
  createLineItemFromDwgAutoCount: (id: string, pick: InspectCategoryPick) => Promise<void> | void;
  createLineItemFromDwgSystem: (id: string, pick: InspectCategoryPick) => Promise<void> | void;
  deleteDwgEntity: (id: string) => void;
  deleteDwgAutoCount: (id: string) => void;
  deleteDwgSystem: (id: string) => void;
  setModelSearch: (s: string) => void;
  setModelBasis: (b: InspectModelBasis) => void;
  selectModelElement: (id: string | null) => void;
  /** "+ Add" for a model element. The categoryId comes from the popover
   *  the user just clicked — each + Add fires its own picker so the
   *  estimator can switch categories every row without leaving the
   *  context. The takeoff-tab side persists `categoryId` to localStorage
   *  as the last-used, which the popover pre-highlights next time. */
  createLineItemFromElement: (id: string, pick: InspectCategoryPick) => Promise<void> | void;
  /** "Σ Add" — one summed line item from N model elements, with each
   *  element bound to it via a ModelTakeoffLink for revision-diff sync. */
  createLineItemFromElementGroup: (ids: string[], groupLabel: string, pick: InspectCategoryPick) => Promise<void> | void;
  /** "+ Add" for a PDF / DWG annotation. Picks the right primary quantity
   *  from the measurement (area > volume > length > count). */
  createLineItemFromAnnotation: (id: string, pick: InspectCategoryPick) => Promise<void> | void;
  /** "Σ Add" — one summed line item from N annotations. */
  createLineItemFromAnnotationGroup: (ids: string[], groupLabel: string, pick: InspectCategoryPick) => Promise<void> | void;
  /** "+ Add" for a single spreadsheet row using the heuristic column
   *  mapping for everything except the category. */
  createLineItemFromSpreadsheetRow: (rowIndex: number, pick: InspectCategoryPick) => Promise<void> | void;
  /** "Σ Add" — in raw mode, import rows; in pivot mode, import one line per rollup group. */
  createLineItemsFromAllSpreadsheetRows: (pick: InspectCategoryPick) => Promise<void> | void;
  /** "+ Add" for a single AI-derived photo BOM row. Carries description /
   *  quantity / uom / sourceNotes straight from the model output. */
  createLineItemFromPhotoBomRow: (rowId: string, pick: InspectCategoryPick) => Promise<void> | void;
  /** "Σ Add" — add every photo-BOM row at once. Each row lands in the
   *  same category bucket. */
  createLineItemsFromAllPhotoBomRows: (pick: InspectCategoryPick) => Promise<void> | void;
  /** Clear the photo-BOM result set (e.g. after batch add or "Discard"). */
  clearPhotoBomResults: () => void;
  /** Remember a category as the new "last used" so the next + Add popover
   *  pre-highlights it. Persisted per-project on the takeoff-tab side. */
  setTakeoffCategoryId: (categoryId: string | null) => void;
  refreshModel: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  distance: "Distance",
  "area-rectangle": "Rectangle area",
  "area-polygon": "Polygon area",
  count: "Count",
  text: "Note",
};

const EDIT_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

export function TakeoffInspectView({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot | null;
  actions: InspectActions | null;
}) {
  // Photo-derived BOM has its own priority — when an analysis just landed,
  // it stays visible in the panel even if the takeoff surface is on
  // another document. The estimator can dismiss it from the panel header.
  if (snapshot?.photoBom && snapshot.photoBom.rows.length > 0) {
    return <PhotoBomInspect snapshot={snapshot} actions={actions} />;
  }

  if (!snapshot || snapshot.mode === "empty") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <p className="text-[11px] leading-relaxed text-fg/45">
          Open a takeoff document to browse its annotations or model objects here.
        </p>
      </div>
    );
  }

  if (snapshot.mode === "bim" || snapshot.mode === "model") {
    return <ModelInspect snapshot={snapshot} actions={actions} />;
  }

  if (snapshot.mode === "spreadsheet") {
    return <SpreadsheetInspect snapshot={snapshot} actions={actions} />;
  }

  if (snapshot.mode === "pdf" && snapshot.drawingAnalysis) {
    return <PdfEntitiesInspect snapshot={snapshot} actions={actions} />;
  }

  if (snapshot.mode === "dwg" && snapshot.dwgIntelligence) {
    return <DwgEntitiesInspect snapshot={snapshot} actions={actions} />;
  }

  return <AnnotationsInspect snapshot={snapshot} actions={actions} />;
}

const DRAWING_PRESETS: Array<{ value: DrawingAnalysisPreset; label: string }> = [
  { value: "generic", label: "General" },
  { value: "mechanical_piping", label: "Piping" },
  { value: "plumbing", label: "Plumbing" },
  { value: "fire_protection", label: "Fire protection" },
  { value: "ductwork", label: "Ductwork" },
  { value: "electrical", label: "Electrical" },
  { value: "civil_linear", label: "Civil linear" },
  { value: "structural", label: "Structural" },
];

const DRAWING_SOURCES: Array<{ value: DrawingGeometrySource; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "pdf_vector", label: "PDF vector" },
  { value: "raster_cv", label: "Raster CV" },
];

function PdfEntitiesInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const analysis = snapshot.drawingAnalysis?.analysis;
  const detectedCount = analysis
    ? analysis.systems.length + analysis.symbolCandidates.length + analysis.circles.length + analysis.lines.length
    : 0;
  const smartCount = snapshot.smartCount?.items.length ?? 0;
  const manualCount = snapshot.annotations.length;
  const annotationIds = new Set(snapshot.annotations.map((annotation) => annotation.id));
  const linkedCount = snapshot.takeoffLinks.filter((link) => annotationIds.has(link.annotationId)).length;
  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <CandidateQueueHeader
        title="Potential line items"
        count={smartCount + detectedCount + manualCount}
        linkedCount={linkedCount}
        detail="PDF review queue"
      />
      <SmartCountInspect snapshot={snapshot} actions={actions} />
      <DrawingAnalysisInspect
        snapshot={snapshot}
        actions={actions}
        showSettings={showSettings}
        onToggleSettings={() => setShowSettings((value) => !value)}
      />
      <div className="min-h-0 flex-1 border-t border-line/70 pt-2">
        <AnnotationsInspect snapshot={snapshot} actions={actions} />
      </div>
    </div>
  );
}

function CandidateQueueHeader({
  title,
  count,
  linkedCount,
  detail,
}: {
  title: string;
  count: number;
  linkedCount: number;
  detail: string;
}) {
  return (
    <div className="shrink-0 rounded-md border border-line bg-panel/50 px-2.5 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-fg/40">{title}</p>
      <p className="mt-0.5 text-[11px] text-fg/60">
        {count.toLocaleString()} candidate{count === 1 ? "" : "s"} · {linkedCount.toLocaleString()} linked · {detail}
      </p>
    </div>
  );
}

function drawingSourceLabel(value: string | null | undefined) {
  if (value === "pdf-vector" || value === "pdf_vector") return "PDF vector";
  if (value === "raster-cv" || value === "raster_cv") return "Raster CV";
  if (value === "cad-native" || value === "cad_native") return "CAD native";
  return "Auto";
}

type PdfCountGroup = {
  id: string;
  label: string;
  symbolIds: string[];
  count: number;
  avgWidth: number;
  avgHeight: number;
  avgConfidence: number;
  source: string;
};

function pdfCountGroupsFromSymbols(symbols: DrawingGeometryAnalysisResult["symbolCandidates"]): PdfCountGroup[] {
  const buckets = new Map<string, DrawingGeometryAnalysisResult["symbolCandidates"]>();
  for (const symbol of symbols) {
    const widthBucket = Math.max(4, Math.round(symbol.w / 8) * 8);
    const heightBucket = Math.max(4, Math.round(symbol.h / 8) * 8);
    const aspectBucket = Math.round(symbol.aspect * 4) / 4;
    const key = `${symbol.source}:${widthBucket}:${heightBucket}:${aspectBucket}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(symbol);
    buckets.set(key, bucket);
  }
  return Array.from(buckets.entries())
    .map(([key, bucket], index) => {
      const count = bucket.length;
      return {
        id: `pdf-count-${index + 1}-${key.replace(/[^a-z0-9]+/gi, "-")}`,
        label: count > 1 ? `Similar symbol group ${index + 1}` : `Symbol candidate ${index + 1}`,
        symbolIds: bucket.map((symbol) => symbol.id),
        count,
        avgWidth: bucket.reduce((sum, symbol) => sum + symbol.w, 0) / Math.max(count, 1),
        avgHeight: bucket.reduce((sum, symbol) => sum + symbol.h, 0) / Math.max(count, 1),
        avgConfidence: bucket.reduce((sum, symbol) => sum + symbol.confidence, 0) / Math.max(count, 1),
        source: bucket[0]?.source ?? "symbol-candidate",
      };
    })
    .sort((a, b) => b.count - a.count || b.avgConfidence - a.avgConfidence);
}

function SmartCountInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const smart = snapshot.smartCount;
  if (!smart) return null;

  const totalSelected = smart.items.reduce((sum, item) => sum + (item.included ? item.count : 0), 0);
  const confidenceClass = (confidence: InspectSmartCountItem["confidence"]) =>
    confidence === "high"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
      : confidence === "medium"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
        : "border-rose-500/30 bg-rose-500/10 text-rose-600";

  return (
    <div className="shrink-0 rounded-md border border-line bg-panel/50 p-2">
      <div className="flex items-start gap-2">
        <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="flex max-w-full items-center gap-1 text-left"
          >
            {collapsed ? <ChevronRight className="h-3 w-3 text-fg/40" /> : <ChevronDown className="h-3 w-3 text-fg/40" />}
            <span className="truncate text-[11px] font-semibold text-fg">Smart Count candidates</span>
          </button>
          <p className="mt-0.5 truncate text-[10px] text-fg/40" title={smart.fileName}>
            Page {smart.pageNumber} · {smart.items.length} row{smart.items.length === 1 ? "" : "s"} · {totalSelected.toLocaleString()} selected
          </p>
        </div>
        {smart.running && <Loader2 className="mt-1 h-3.5 w-3.5 shrink-0 animate-spin text-emerald-500" />}
        <button
          type="button"
          onClick={() => actions?.clearSmartCountResults()}
          title="Clear count candidates"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-bg/40 text-fg/40 transition-colors hover:border-danger/30 hover:text-danger"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {!collapsed && (
        <>
          {(smart.cropImage || smart.error) && (
            <div className="mt-2 flex gap-2">
              {smart.cropImage && (
                <div className="shrink-0 rounded-md border border-line bg-white p-1">
                  <img src={smart.cropImage} alt="Count candidate region" className="h-16 w-16 object-contain" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                {smart.error && (
                  <p className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
                    {smart.error}
                  </p>
                )}
                {smart.running && (
                  <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 text-[10px] text-emerald-600">
                    Counting distinct symbols in the selected region.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="mt-2 max-h-[34vh] space-y-1 overflow-auto pr-1">
            {smart.items.length === 0 && !smart.running ? (
              <p className="rounded-md border border-line bg-bg/30 px-3 py-3 text-center text-[11px] text-fg/40">
                Draw a count region to populate candidates here.
              </p>
            ) : smart.items.map((item) => (
              <div
                key={item.id}
                onClick={() => actions?.selectSmartCountItem(item.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-md border px-1.5 py-1.5 transition-colors",
                  smart.selectedItemId === item.id
                    ? "border-accent/40 bg-accent/10 ring-1 ring-accent/30"
                    : item.isLinked
                      ? "border-success/25 bg-success/5 hover:bg-panel2/35"
                      : "border-transparent hover:border-line hover:bg-panel2/35",
                  !item.included && "opacity-55",
                )}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    actions?.toggleSmartCountItem(item.id);
                  }}
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    item.included ? "border-emerald-500 bg-emerald-500 text-white" : "border-line bg-bg/40 text-transparent",
                  )}
                  title={item.included ? "Exclude from selected batch" : "Include in selected batch"}
                >
                  <Check className="h-3 w-3" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <p className="truncate text-[11px] font-medium text-fg/80">{item.label}</p>
                    {item.isLinked ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1 py-0.5 text-[9px] font-medium text-accent">
                        <Link2 className="h-2 w-2" />
                        Linked
                      </span>
                    ) : item.isSaved ? (
                      <span className="shrink-0 rounded-full bg-success/12 px-1 py-0.5 text-[9px] font-medium text-success">
                        Saved
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[10px] text-fg/40">{item.notes || "AI-derived count row"}</p>
                </div>
                <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium capitalize", confidenceClass(item.confidence))}>
                  {item.confidence}
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold tabular-nums text-emerald-500">
                  x{item.count.toLocaleString()}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  {!item.isLinked && (
                    <AddToCategoryPopover
                      snapshot={snapshot}
                      actions={actions}
                      onPick={(pick) => void actions?.createLineItemFromSmartCountItem(item.id, pick)}
                      triggerLabel="Add"
                      triggerClassName="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                      triggerTitle="Add this count candidate to a worksheet and link it automatically"
                      triggerIcon={<Plus className="h-3 w-3" />}
                    />
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      actions?.deleteSmartCountItem(item.id);
                    }}
                    title="Delete count candidate"
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg/35 transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  <LocateFixed className="h-3 w-3 shrink-0 text-fg/25 group-hover:text-accent" />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DwgEntitiesInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const intel = snapshot.dwgIntelligence;
  const [query, setQuery] = useState("");
  if (!intel) return <AnnotationsInspect snapshot={snapshot} actions={actions} />;
  const q = query.trim().toLowerCase();
  const matches = (values: Array<string | number | null | undefined>) => {
    if (!q) return true;
    return values.some((value) => String(value ?? "").toLowerCase().includes(q));
  };
  const systems = intel.systems.filter((row) => matches([row.label, row.layer, row.uom, row.segmentCount]));
  const autoCounts = intel.autoCounts.filter((row) => matches([row.label, row.type, row.layer, row.count]));
  const entities = intel.entities.filter((row) => matches([row.label, row.type, row.layer, row.layoutName, row.measurementLabel]));
  const shownEntities = entities.slice(0, 500);

  const RowShell = ({
    id,
    selected,
    color,
    title,
    subtitle,
    value,
    linked,
    linkCount,
    onSelect,
    onAdd,
    onDelete,
  }: {
    id: string;
    selected: boolean;
    color?: string;
    title: string;
    subtitle: string;
    value: string;
    linked: boolean;
    linkCount: number;
    onSelect: () => void;
    onAdd: (pick: InspectCategoryPick) => void;
    onDelete: () => void;
  }) => (
    <div
      key={id}
      onClick={onSelect}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md border px-1.5 py-1.5 transition-colors",
        selected
          ? "border-accent/40 bg-accent/10 ring-1 ring-accent/30"
          : linked
            ? "border-success/25 bg-success/5 hover:bg-panel2/35"
            : "border-transparent hover:border-line hover:bg-panel2/35",
      )}
    >
      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color || "#38bdf8" }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="truncate text-[11px] font-medium text-fg/80">{title}</p>
          {linked && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1 py-0.5 text-[9px] font-medium text-accent">
              <Link2 className="h-2 w-2" />
              {linkCount}
            </span>
          )}
        </div>
        <p className="truncate text-[10px] text-fg/40">{subtitle}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-fg/50">{value}</span>
      <div className="flex shrink-0 items-center gap-0.5">
        {!linked && (
          <AddToCategoryPopover
            snapshot={snapshot}
            actions={actions}
            onPick={onAdd}
            triggerLabel="Add"
            triggerClassName="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
            triggerTitle="Add this DWG/DXF entity to a worksheet — pick a category"
            triggerIcon={<Plus className="h-3 w-3" />}
          />
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          title="Delete entity row"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg/35 transition-colors hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        <LocateFixed className="h-3 w-3 shrink-0 text-fg/25 group-hover:text-accent" />
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <div className="shrink-0 rounded-md border border-line bg-panel/50 p-2">
        <div className="flex items-start gap-2">
          <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-fg">Potential line items</p>
            <p className="mt-0.5 truncate text-[10px] text-fg/40" title={intel.fileName}>
              {intel.selectedLayout === "__all__" ? "All layouts" : intel.selectedLayout}
              {intel.processedAt ? ` · processed ${new Date(intel.processedAt).toLocaleDateString()}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-2 grid grid-cols-4 gap-1">
          <AnalysisStat label="CAD" value={intel.entityCount} />
          <AnalysisStat label="Linear" value={intel.systems.length} />
          <AnalysisStat label="Counts" value={intel.autoCounts.length} />
          <AnalysisStat label="Manual" value={intel.annotationCount} />
        </div>

        <Input
          className="mt-2 h-7 text-xs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter candidate line items..."
        />
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
        <DetectionGroup
          title="Linear candidates"
          count={intel.systems.length}
          rows={systems.map((system) => ({
            id: system.id,
            kind: "line" as const,
            title: system.label,
            subtitle: `${system.segmentCount} segments · layer ${system.layer}`,
            detail: `${system.quantity.toFixed(system.quantity >= 100 ? 0 : 2)} ${system.uom}`,
            selected: Boolean(system.sourceEntityIds.includes(intel.selectedEntityId ?? "")),
            saving: intel.savingEntityId === system.id,
            savedCount: system.linkCount,
            linkCount: system.linkCount,
            color: "#0ea5e9",
          }))}
          snapshot={snapshot}
          actions={actions}
          onSelect={(id) => {
            const targets = intel.systems.find((system) => system.id === id)?.sourceEntityIds ?? [];
            actions?.selectDwgEntities(targets);
          }}
          onAdd={(id, _kind, pick) => void actions?.createLineItemFromDwgSystem(id, pick)}
          onDelete={(id) => actions?.deleteDwgSystem(id)}
        />

        <DetectionGroup
          title="Count candidates"
          count={intel.autoCounts.length}
          icon={<CircleDashed className="h-3 w-3 text-emerald-500" />}
          rows={autoCounts.map((row) => ({
            id: row.id,
            kind: "symbol" as const,
            title: row.label,
            subtitle: `${row.count.toLocaleString()} found · ${row.type} · layer ${row.layer}`,
            selected: Boolean(row.sourceEntityIds.includes(intel.selectedEntityId ?? "")),
            saving: intel.savingEntityId === row.id,
            savedCount: row.linkCount,
            linkCount: row.linkCount,
            color: "#10b981",
          }))}
          snapshot={snapshot}
          actions={actions}
          onSelect={(id) => {
            const targets = intel.autoCounts.find((row) => row.id === id)?.sourceEntityIds ?? [];
            actions?.selectDwgEntities(targets);
          }}
          onAdd={(id, _kind, pick) => void actions?.createLineItemFromDwgAutoCount(id, pick)}
          onDelete={(id) => actions?.deleteDwgAutoCount(id)}
        />

        <section>
          <div className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-medium text-fg/60">
            <ChevronDown className="h-3 w-3" />
            <span className="min-w-0 flex-1 truncate">CAD entity candidates</span>
            <span className="font-mono text-[10px] text-fg/35">
              {entities.length === intel.entities.length ? intel.entities.length.toLocaleString() : `${entities.length.toLocaleString()}/${intel.entities.length.toLocaleString()}`}
            </span>
          </div>
          <div className="ml-2 space-y-0.5">
            {shownEntities.length === 0 ? (
              <p className="rounded-md border border-line bg-bg/25 px-2 py-2 text-center text-[10px] text-fg/35">No entities match</p>
            ) : shownEntities.map((entity) => (
              <RowShell
                key={entity.id}
                id={entity.id}
                selected={intel.selectedEntityId === entity.id}
                color={entity.color}
                title={entity.label}
                subtitle={`${entity.type} · layer ${entity.layer} · ${entity.layoutName}`}
                value={entity.measurementLabel}
                linked={entity.isLinked}
                linkCount={entity.linkCount}
                onSelect={() => actions?.selectDwgEntity(intel.selectedEntityId === entity.id ? null : entity.id)}
                onAdd={(pick) => void actions?.createLineItemFromDwgEntity(entity.id, pick)}
                onDelete={() => actions?.deleteDwgEntity(entity.id)}
              />
            ))}
            {entities.length > shownEntities.length && (
              <p className="rounded-md border border-line/70 bg-bg/25 px-2 py-1.5 text-center text-[10px] text-fg/35">
                Showing first {shownEntities.length.toLocaleString()} matches. Filter to narrow the native entity list.
              </p>
            )}
          </div>
        </section>

        <div className="border-t border-line/70 pt-2">
          <AnnotationsInspect snapshot={snapshot} actions={actions} />
        </div>
      </div>
    </div>
  );
}

function DrawingAnalysisInspect({
  snapshot,
  actions,
  showSettings,
  onToggleSettings,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
  showSettings: boolean;
  onToggleSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const linkedAnnotationIds = useMemo(
    () => new Set(snapshot.takeoffLinks.map((link) => link.annotationId)),
    [snapshot.takeoffLinks],
  );

  const detectionAnnotationIndex = useMemo(() => {
    const map = new Map<string, TakeoffAnnotation[]>();
    for (const ann of snapshot.annotations) {
      const metadata = (ann.opts ?? {}) as Record<string, unknown>;
      const keys = [
        typeof metadata.detectionId === "string" ? metadata.detectionId : "",
        typeof metadata.systemId === "string" ? metadata.systemId : "",
      ].filter(Boolean);
      for (const key of keys) {
        const arr = map.get(key) ?? [];
        arr.push(ann);
        map.set(key, arr);
      }
    }
    return map;
  }, [snapshot.annotations]);

  const drawing = snapshot.drawingAnalysis;
  if (!drawing) return null;
  const { analysis, settings, overlay, running, savingId, selectedDetectionId } = drawing;
  const sourceLabel = analysis ? drawingSourceLabel(analysis.geometrySource) : drawingSourceLabel(settings.geometrySource);
  const systems = analysis?.systems ?? [];
  const symbols = analysis?.symbolCandidates ?? [];
  const countGroups = pdfCountGroupsFromSymbols(symbols);
  const circles = analysis?.circles ?? [];
  const lines = analysis?.lines ?? [];
  const texts = analysis?.textRegions ?? [];
  const formatDetectedLength = (lengthPx: number) => {
    if (!drawing.calibration || drawing.calibration.pixelsPerUnit <= 0) {
      return "Scale needed";
    }
    const paperPx = lengthPx * ((drawing.calibration.analysisToPaperScaleX + drawing.calibration.analysisToPaperScaleY) / 2);
    const value = paperPx / drawing.calibration.pixelsPerUnit;
    return `${value.toFixed(value >= 100 ? 0 : 2)} ${drawing.calibration.unit}`;
  };

  const linkedStateFor = (id: string) => {
    const savedAnnotations = detectionAnnotationIndex.get(id) ?? [];
    return {
      savedCount: savedAnnotations.length,
      linkCount: savedAnnotations.filter((ann) => linkedAnnotationIds.has(ann.id)).length,
    };
  };

  const matchesQuery = (row: DetectionRow) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [row.title, row.subtitle, row.detail, row.kind].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
  };

  return (
    <div className="shrink-0 rounded-md border border-line bg-panel/50 p-2">
      <div className="flex items-start gap-2">
        <GitBranch className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <p className="truncate text-[11px] font-semibold text-fg">Drawing intelligence</p>
            <span className="shrink-0 rounded-full border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-medium text-sky-600">
              {sourceLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-fg/40" title={drawing.fileName}>
            Page {drawing.pageNumber} · {analysis ? `${analysis.duration_ms.toFixed(0)} ms` : "No run yet"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void actions?.runDrawingAnalysis()}
          disabled={running}
          title="Analyze geometry and trace connected systems"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-line bg-bg/40 px-2 text-[10px] font-medium text-fg/70 transition-colors hover:border-sky-500/35 hover:text-sky-500 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
          Analyze
        </button>
        <button
          type="button"
          onClick={onToggleSettings}
          title="Analysis parameters"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors",
            showSettings ? "border-sky-500/35 bg-sky-500/10 text-sky-500" : "border-line bg-bg/40 text-fg/50 hover:text-fg/75",
          )}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {showSettings && (
        <div className="mt-2 grid gap-2 rounded-md border border-line/70 bg-bg/35 p-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-fg/40">Preset</span>
              <select
                value={settings.preset}
                onChange={(event) => actions?.updateDrawingAnalysisSettings({ preset: event.target.value as DrawingAnalysisPreset })}
                className="h-7 rounded-md border border-line bg-panel px-2 text-[11px] text-fg outline-none"
              >
                {DRAWING_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-fg/40">Source</span>
              <select
                value={settings.geometrySource}
                onChange={(event) => actions?.updateDrawingAnalysisSettings({ geometrySource: event.target.value as DrawingGeometrySource })}
                className="h-7 rounded-md border border-line bg-panel px-2 text-[11px] text-fg outline-none"
              >
                {DRAWING_SOURCES.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
              </select>
            </label>
          </div>
          <RangeSetting
            label="Line sensitivity"
            value={settings.lineSensitivity}
            min={0.1}
            max={1}
            step={0.01}
            onChange={(lineSensitivity) => actions?.updateDrawingAnalysisSettings({ lineSensitivity })}
          />
          <RangeSetting
            label="Noise rejection"
            value={settings.noiseRejection}
            min={0}
            max={1}
            step={0.01}
            onChange={(noiseRejection) => actions?.updateDrawingAnalysisSettings({ noiseRejection })}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberSetting
              label="Line budget"
              title="0 means full output"
              value={settings.maxLines}
              onChange={(maxLines) => actions?.updateDrawingAnalysisSettings({ maxLines })}
            />
            <NumberSetting
              label="Region budget"
              value={settings.maxRegions}
              onChange={(maxRegions) => actions?.updateDrawingAnalysisSettings({ maxRegions })}
            />
            <NumberSetting
              label="Min line px"
              title="0 means automatic"
              value={settings.minLineLength}
              onChange={(minLineLength) => actions?.updateDrawingAnalysisSettings({ minLineLength })}
            />
            <NumberSetting
              label="Snap px"
              title="0 means automatic"
              value={settings.snapTolerance}
              onChange={(snapTolerance) => actions?.updateDrawingAnalysisSettings({ snapTolerance })}
            />
          </div>
          <div className="grid grid-cols-3 gap-1">
            <ToggleChip active={settings.includeSymbols} label="Symbols" onClick={() => actions?.updateDrawingAnalysisSettings({ includeSymbols: !settings.includeSymbols })} />
            <ToggleChip active={settings.includeCircles} label="Circles" onClick={() => actions?.updateDrawingAnalysisSettings({ includeCircles: !settings.includeCircles })} />
            <ToggleChip active={settings.includeTextRegions} label="Text" onClick={() => actions?.updateDrawingAnalysisSettings({ includeTextRegions: !settings.includeTextRegions })} />
          </div>
        </div>
      )}

      <div className="mt-2 grid grid-cols-4 gap-1">
        <AnalysisStat label="Systems" value={analysis?.summary.systemCount ?? 0} />
        <AnalysisStat label="Lines" value={analysis?.summary.lineCount ?? 0} />
        <AnalysisStat label="Symbols" value={analysis?.summary.symbolCandidateCount ?? 0} />
        <AnalysisStat label="Circles" value={analysis?.summary.circleCount ?? 0} />
      </div>

      <div className="mt-2 grid grid-cols-5 gap-1">
        {([
          ["systems", "Systems"],
          ["lines", "Lines"],
          ["symbols", "Symbols"],
          ["circles", "Circles"],
          ["text", "Text"],
        ] as const).map(([key, label]) => (
          <ToggleChip
            key={key}
            active={overlay[key]}
            label={label}
            onClick={() => actions?.setDrawingAnalysisOverlay({ [key]: !overlay[key] })}
          />
        ))}
      </div>

      {drawing.error && (
        <p className="mt-2 rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
          {drawing.error}
        </p>
      )}

      {analysis ? (
        <div className="mt-2">
          <Input
            className="h-7 text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter detected entities..."
          />
        </div>
      ) : null}

      {analysis ? (
        <div className="mt-2 max-h-[42vh] space-y-2 overflow-auto pr-1">
          <DetectionGroup
            title="Linear candidates"
            count={systems.length}
            rows={systems.map((system) => {
              const state = linkedStateFor(system.id);
              return {
                id: system.id,
                kind: "system" as const,
                title: system.label,
                subtitle: `${system.segmentCount} segments · ${formatDetectedLength(system.lengthPx)} · ${Math.round(system.confidence * 100)}%`,
                detail: [
                  `${system.counts.openEnds} ends`,
                  `${system.counts.tees} tees`,
                  `${system.counts.elbows45 + system.counts.elbows90} elbows`,
                  system.layers?.length ? `layer ${system.layers.slice(0, 2).join(", ")}` : "",
                  system.warnings?.length ? system.warnings.slice(0, 2).join(", ") : "",
                ].filter(Boolean).join(" · "),
                selected: selectedDetectionId === system.id,
                saving: savingId === system.id,
                color: "#0ea5e9",
                requiresCalibration: !drawing.calibration,
                ...state,
              };
            }).filter(matchesQuery)}
            snapshot={snapshot}
            actions={actions}
            onSelect={(id) => actions?.selectDrawingDetection(id, "system")}
            onAdd={(id, _kind, pick) => void actions?.createLineItemFromDrawingDetection(id, "system", pick)}
            onDelete={(id) => actions?.deleteDrawingDetection(id, "system")}
          />
          <DetectionGroup
            title="Count candidates"
            count={countGroups.length}
            icon={<CircleDashed className="h-3 w-3 text-emerald-500" />}
            rows={countGroups.map((group) => {
              const states = group.symbolIds.map((id) => linkedStateFor(id));
              const savedCount = states.reduce((sum, state) => sum + state.savedCount, 0);
              const linkCount = states.reduce((sum, state) => sum + state.linkCount, 0);
              return {
                id: group.id,
                kind: "symbol" as const,
                title: group.label,
                subtitle: `${group.count.toLocaleString()} found · ${Math.round(group.avgWidth)} x ${Math.round(group.avgHeight)} px · ${Math.round(group.avgConfidence * 100)}%`,
                detail: group.source,
                value: `x${group.count.toLocaleString()}`,
                selected: group.symbolIds.includes(selectedDetectionId ?? ""),
                saving: group.symbolIds.some((id) => savingId === id),
                savedCount,
                linkCount,
                color: "#10b981",
                symbolIds: group.symbolIds,
              };
            }).filter(matchesQuery)}
            snapshot={snapshot}
            actions={actions}
            onSelect={(id) => {
              const group = countGroups.find((item) => item.id === id);
              if (group) actions?.selectDrawingDetectionGroup(group.symbolIds);
            }}
            onAdd={(id, _kind, pick) => {
              const group = countGroups.find((item) => item.id === id);
              if (group) void actions?.createLineItemFromDrawingSymbolGroup(group.symbolIds, group.label, pick);
            }}
            onDelete={(id) => {
              const group = countGroups.find((item) => item.id === id);
              if (group) actions?.deleteDrawingDetectionGroup(group.symbolIds, "symbol");
            }}
          />
          {circles.length > 0 && (
            <DetectionGroup
              title="Circle candidates"
              count={circles.length}
              rows={circles.map((circle) => {
                const state = linkedStateFor(circle.id);
                return {
                  id: circle.id,
                  kind: "circle" as const,
                  title: circle.id,
                  subtitle: `R ${Math.round(circle.radius)} px · ${Math.round(circle.confidence * 100)}%`,
                  selected: selectedDetectionId === circle.id,
                  saving: savingId === circle.id,
                  color: "#ec4899",
                  ...state,
                };
              }).filter(matchesQuery)}
              snapshot={snapshot}
              actions={actions}
              onSelect={(id) => actions?.selectDrawingDetection(id, "circle")}
              onAdd={(id, _kind, pick) => void actions?.createLineItemFromDrawingDetection(id, "circle", pick)}
              onDelete={(id) => actions?.deleteDrawingDetection(id, "circle")}
            />
          )}
          {lines.length > 0 && (
            <DetectionGroup
              title="Linework candidates"
              count={lines.length}
              rows={lines.map((line) => {
                const state = linkedStateFor(line.id);
                return {
                  id: line.id,
                  kind: "line" as const,
                  title: line.id,
                  subtitle: `${formatDetectedLength(line.lengthPx)} · ${Math.round(line.confidence * 100)}%`,
                  selected: selectedDetectionId === line.id,
                  saving: savingId === line.id,
                  color: "#38bdf8",
                  requiresCalibration: !drawing.calibration,
                  ...state,
                };
              }).filter(matchesQuery)}
              snapshot={snapshot}
              actions={actions}
              onSelect={(id) => actions?.selectDrawingDetection(id, "line")}
              onAdd={(id, _kind, pick) => void actions?.createLineItemFromDrawingDetection(id, "line", pick)}
              onDelete={(id) => actions?.deleteDrawingDetection(id, "line")}
            />
          )}
          {texts.length > 0 && (
            <DetectionGroup
              title="Text candidates"
              count={texts.length}
              rows={texts.map((region) => ({
                id: region.id,
                kind: "text" as const,
                title: region.id,
                subtitle: `${Math.round(region.w)} x ${Math.round(region.h)} px`,
                selected: selectedDetectionId === region.id,
                saving: false,
                savedCount: 0,
                linkCount: 0,
                color: "#64748b",
              })).filter(matchesQuery)}
              snapshot={snapshot}
              actions={actions}
              onSelect={(id) => actions?.selectDrawingDetection(id, "text")}
              onDelete={(id) => actions?.deleteDrawingDetection(id, "text")}
            />
          )}
        </div>
      ) : (
        <p className="mt-2 rounded-md border border-line bg-bg/30 px-3 py-3 text-center text-[11px] text-fg/40">
          Run Analyze to populate reviewable geometry entities.
        </p>
      )}
    </div>
  );
}

function AnalysisStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line/70 bg-bg/35 px-1.5 py-1 text-center">
      <p className="text-[11px] font-semibold tabular-nums text-fg">{value.toLocaleString()}</p>
      <p className="text-[9px] text-fg/40">{label}</p>
    </div>
  );
}

function RangeSetting({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1">
      <span className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wider text-fg/40">
        {label}
        <span className="font-mono text-fg/55">{Math.round(value * 100)}%</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-sky-500"
      />
    </label>
  );
}

function NumberSetting({ label, value, title, onChange }: { label: string; value: number; title?: string; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1" title={title}>
      <span className="text-[10px] font-medium uppercase tracking-wider text-fg/40">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="h-7 rounded-md border border-line bg-panel px-2 text-[11px] text-fg outline-none"
      />
    </label>
  );
}

function ToggleChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-md border px-1 text-[10px] font-medium transition-colors",
        active ? "border-sky-500/35 bg-sky-500/10 text-sky-500" : "border-line bg-bg/35 text-fg/45 hover:text-fg/70",
      )}
    >
      {label}
    </button>
  );
}

type DetectionRow = {
  id: string;
  kind: InspectDrawingDetectionKind;
  title: string;
  subtitle: string;
  detail?: string;
  selected: boolean;
  saving: boolean;
  savedCount: number;
  linkCount: number;
  color: string;
  value?: string;
  symbolIds?: string[];
  requiresCalibration?: boolean;
};

function DetectionGroup({
  title,
  count,
  rows,
  icon,
  snapshot,
  actions,
  onSelect,
  onAdd,
  onDelete,
}: {
  title: string;
  count: number;
  rows: DetectionRow[];
  icon?: React.ReactNode;
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
  onSelect: (id: string) => void;
  onAdd?: (id: string, kind: Exclude<InspectDrawingDetectionKind, "text">, pick: InspectCategoryPick) => void;
  onDelete?: (id: string, kind: InspectDrawingDetectionKind) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const shownCount = rows.length;
  return (
    <section>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-fg/60 hover:bg-panel2/50"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="font-mono text-[10px] text-fg/35">
          {shownCount === count ? count.toLocaleString() : `${shownCount.toLocaleString()}/${count.toLocaleString()}`}
        </span>
      </button>
      {!collapsed && (
        <div className="ml-2 space-y-0.5">
          {rows.length === 0 ? (
            <p className="rounded-md border border-line bg-bg/25 px-2 py-2 text-center text-[10px] text-fg/35">None found</p>
          ) : rows.map((row) => (
            <div
              key={row.id}
              onClick={() => onSelect(row.id)}
              className={cn(
                "group flex cursor-pointer items-center gap-2 rounded-md border px-1.5 py-1.5 transition-colors",
                row.selected
                  ? "border-accent/40 bg-accent/10 ring-1 ring-accent/30"
                  : row.linkCount > 0
                    ? "border-success/25 bg-success/5 hover:bg-panel2/35"
                    : "border-transparent hover:border-line hover:bg-panel2/35",
              )}
            >
              <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="truncate text-[11px] font-medium text-fg/80">{row.title}</p>
                  {row.linkCount > 0 ? (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1 py-0.5 text-[9px] font-medium text-accent">
                      <Link2 className="h-2 w-2" />
                      {row.linkCount}
                    </span>
                  ) : row.savedCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-success/12 px-1 py-0.5 text-[9px] font-medium text-success">
                      Saved
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-[10px] text-fg/40">{row.subtitle}</p>
                {row.detail && <p className="truncate text-[10px] text-fg/35">{row.detail}</p>}
              </div>
              {row.value && <span className="shrink-0 font-mono text-[10px] text-fg/50">{row.value}</span>}
              <div className="flex items-center gap-0.5">
                {onAdd && row.kind !== "text" && row.linkCount === 0 && (
                  row.requiresCalibration ? (
                    <button
                      type="button"
                      disabled
                      title="Set drawing scale before adding linear detections to a worksheet"
                      className="inline-flex h-6 items-center gap-1 rounded-md border border-warning/25 bg-warning/10 px-1.5 text-[10px] font-medium text-warning/70 disabled:cursor-not-allowed"
                    >
                      <Plus className="h-3 w-3" />
                      Add
                    </button>
                  ) : (
                    <AddToCategoryPopover
                      snapshot={snapshot}
                      actions={actions}
                      onPick={(pick) => onAdd(row.id, row.kind as Exclude<InspectDrawingDetectionKind, "text">, pick)}
                      triggerLabel="Add"
                      triggerClassName="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                      triggerTitle="Add this detected entity to a worksheet and link it automatically"
                      triggerIcon={<Plus className="h-3 w-3" />}
                    />
                  )
                )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDelete(row.id, row.kind);
                  }}
                  title="Delete entity row"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg/35 transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              <LocateFixed className="h-3 w-3 shrink-0 text-fg/25 group-hover:text-accent" />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Per-click category picker — wraps a "+ Add"-style trigger and opens a
 *  small popover listing every enabled category. Picking a freeform/catalog
 *  chip immediately fires onPick({ categoryId }), closes the popover, and remembers that
 *  category as the last-used (pre-highlighted on the next open) via
 *  setTakeoffCategoryId. Ratebook-backed categories expand in place so the
 *  estimator can pick the imported schedule item before the row is created.
 *
 *  This is the right shape when the estimator may switch categories on
 *  every row — a sticky chip strip at the top would force them to traverse
 *  back-and-forth between the strip and the row.
 */
function AddToCategoryPopover({
  snapshot,
  actions,
  onPick,
  triggerLabel,
  triggerClassName,
  triggerTitle,
  triggerIcon,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
  onPick: (pick: InspectCategoryPick) => void;
  triggerLabel: React.ReactNode;
  triggerClassName: string;
  triggerTitle: string;
  triggerIcon: React.ReactNode;
}) {
  const { availableCategories, takeoffCategoryId } = snapshot;
  const [open, setOpen] = useState(false);
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  // Every enabled category is pickable — itemSource only changes the
  // downstream entity-picker flow. Rate-schedule categories used to be
  // greyed out here, but that broke the labor flow once the user
  // imported a schedule (they need to be able to pick Labor → then pick
  // a rate-schedule item from the entity dropdown). It also surfaced
  // any mis-configured `itemSource: "rate_schedule"` setting as a flat
  // disabled state with no recourse.
  const pickable = availableCategories;
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    const current = availableCategories.find((c) => c.id === takeoffCategoryId);
    setExpandedCategoryId(current?.itemSource === "rate_schedule" ? current.id : null);
  };
  const handlePick = (pick: InspectCategoryPick) => {
    onPick(pick);
    actions?.setTakeoffCategoryId(pick.categoryId);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={triggerClassName}
          title={triggerTitle}
        >
          {triggerIcon}
          {triggerLabel}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          className="z-[100] w-56 rounded-md border border-line bg-panel p-1.5 shadow-xl outline-none"
          onClick={(e) => e.stopPropagation()}
        >
          {availableCategories.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-warning">
              Enable an estimate category in Settings first.
            </p>
          ) : (
            <>
              <p className="px-1 pb-1 text-[9px] font-medium uppercase tracking-wider text-fg/40">
                Add to category
              </p>
              <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                {pickable.map((c) => {
                  const isLast = c.id === takeoffCategoryId;
                  const needsSchedule = c.itemSource === "rate_schedule";
                  const items = c.rateScheduleItems ?? [];
                  const expanded = expandedCategoryId === c.id;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        autoFocus={isLast}
                        onClick={() => {
                          if (needsSchedule) {
                            setExpandedCategoryId(expanded ? null : c.id);
                            return;
                          }
                          handlePick({ categoryId: c.id });
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-accent/10 focus:bg-accent/10 focus:outline-none",
                          isLast ? "text-accent" : "text-fg/75",
                        )}
                        title={needsSchedule ? `${c.name} resolves cost from imported ratebook items.` : undefined}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="ml-2 flex shrink-0 items-center gap-1">
                          {isLast ? (
                            <span className="text-[9px] uppercase text-accent/70">last used</span>
                          ) : needsSchedule ? (
                            <span className="text-[9px] uppercase text-fg/35">ratebook</span>
                          ) : null}
                          {needsSchedule ? (
                            <ChevronRight className={cn("h-3 w-3 text-fg/30 transition-transform", expanded && "rotate-90")} />
                          ) : null}
                        </span>
                      </button>
                      {needsSchedule && expanded ? (
                        <div className="ml-2 mt-0.5 border-l border-line/70 pl-1">
                          {items.length === 0 ? (
                            <p className="px-2 py-1 text-[10px] text-warning">
                              Import a {c.name} ratebook before adding this category.
                            </p>
                          ) : (
                            items.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] text-fg/70 transition-colors hover:bg-accent/10 focus:bg-accent/10 focus:outline-none"
                                onClick={() =>
                                  handlePick({
                                    categoryId: c.id,
                                    rateScheduleItemId: item.id,
                                    rateScheduleItemName: item.name,
                                    rateScheduleItemUnit: item.unit,
                                    tierUnits: item.tierUnits,
                                  })
                                }
                                title={`${item.scheduleName}${item.code ? ` · ${item.code}` : ""}`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate">{item.name}</span>
                                  <span className="block truncate text-[9px] text-fg/35">
                                    {item.scheduleName}
                                    {item.code ? ` · ${item.code}` : ""}
                                  </span>
                                </span>
                                <span className="shrink-0 text-[10px] text-fg/35">
                                  {item.rate != null ? `$${item.rate.toFixed(2)}` : item.unit}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AnnotationsInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const { annotations, takeoffLinks, selectedAnnotationId, editingAnnotationId, mode } = snapshot;
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const linkCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of takeoffLinks) {
      map.set(link.annotationId, (map.get(link.annotationId) ?? 0) + 1);
    }
    return map;
  }, [takeoffLinks]);

  const groups = useMemo(() => {
    const map = new Map<string, TakeoffAnnotation[]>();
    for (const ann of annotations) {
      const key = ann.groupName || ann.type;
      const arr = map.get(key) ?? [];
      arr.push(ann);
      map.set(key, arr);
    }
    return map;
  }, [annotations]);

  const totalCount = annotations.length;
  const visibleCount = annotations.filter((a) => a.visible).length;
  const supportsInlineEdit = mode === "pdf";

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <div className="shrink-0 rounded-md border border-line bg-panel/50 px-2.5 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-fg/40">
          {mode === "dwg" ? "Manual CAD candidates" : "Manual takeoff candidates"}
        </p>
        <p className="mt-0.5 text-[11px] text-fg/60">
          {totalCount} item{totalCount === 1 ? "" : "s"} · {visibleCount} visible
        </p>
      </div>

      {totalCount === 0 ? (
        <p className="rounded-md border border-line bg-panel/40 px-3 py-4 text-center text-[11px] text-fg/40">
          {mode === "dwg"
            ? "No manual CAD candidates yet."
            : "Use a tool and click on the drawing to start measuring."}
        </p>
      ) : (
        <div className="flex flex-1 flex-col gap-1 overflow-auto pr-1">
          {Array.from(groups.entries()).map(([groupKey, items]) => {
            const collapsed = collapsedGroups.has(groupKey);
            const groupLabel = TYPE_LABELS[groupKey] ?? groupKey;
            const linkedInGroup = items.filter((ann) => (linkCountMap.get(ann.id) ?? 0) > 0).length;
            const groupSummary = summarizeAnnotationGroup(items);
            return (
              <div key={groupKey}>
                <div className="group/grouphdr flex items-stretch gap-1 rounded-md transition-colors hover:bg-panel2/60">
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    className="flex flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-[11px] font-medium text-fg/60"
                  >
                    {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span className="min-w-0 flex-1 truncate">{groupLabel}</span>
                    <span className="shrink-0 text-[10px] text-fg/40">
                      {items.length}
                      {linkedInGroup > 0 && (
                        <span className="ml-1 text-success/80">· {linkedInGroup} linked</span>
                      )}
                      {groupSummary && (
                        <span className="ml-1 font-mono text-fg/50">Σ {groupSummary}</span>
                      )}
                    </span>
                  </button>
                  <AddToCategoryPopover
                    snapshot={snapshot}
                    actions={actions}
                    onPick={(pick) =>
                      void actions?.createLineItemFromAnnotationGroup(
                        items.map((it) => it.id),
                        groupLabel,
                        pick,
                      )
                    }
                    triggerLabel="Add"
                    triggerClassName="inline-flex shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-fg/55 transition-colors hover:bg-accent/10 hover:text-accent focus:bg-accent/10 focus:text-accent"
                    triggerTitle={`Add one summed worksheet line item from ${items.length} ${groupLabel} candidates`}
                    triggerIcon={<Sigma className="h-3 w-3" />}
                  />
                </div>
                {!collapsed && (
                  <div className="ml-2 mt-0.5 space-y-0.5">
                    {items.map((ann) =>
                      supportsInlineEdit && editingAnnotationId === ann.id && actions ? (
                        <EditAnnotationRow
                          key={ann.id}
                          ann={ann}
                          onSave={(updates) => actions.saveAnnotationEdit(ann.id, updates)}
                          onCancel={() => actions.cancelAnnotationEdit()}
                        />
                      ) : (
                        <AnnotationRow
                          key={ann.id}
                          ann={ann}
                          isSelected={selectedAnnotationId === ann.id}
                          linkCount={linkCountMap.get(ann.id) ?? 0}
                          actions={actions}
                          supportsInlineEdit={supportsInlineEdit}
                          snapshot={snapshot}
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnnotationRow({
  ann,
  isSelected,
  linkCount,
  actions,
  supportsInlineEdit,
  snapshot,
}: {
  ann: TakeoffAnnotation;
  isSelected: boolean;
  linkCount: number;
  actions: InspectActions | null;
  supportsInlineEdit: boolean;
  snapshot: InspectSnapshot;
}) {
  return (
    <div
      onClick={() => actions?.selectAnnotation(isSelected ? null : ann.id)}
      className={cn(
        "group flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-[11px] transition-colors",
        isSelected ? "bg-accent/10 ring-1 ring-accent/30" : "hover:bg-panel2/40",
      )}
    >
      <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ann.color || EDIT_COLORS[0] }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className="truncate font-medium text-fg/80">
            {ann.label || TYPE_LABELS[ann.type] || ann.type}
          </p>
          {linkCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-accent/10 px-1 py-0.5 text-[9px] font-medium text-accent">
              <Link2 className="h-2 w-2" />
              {linkCount}
            </span>
          )}
        </div>
        <p className="text-[10px] text-fg/40">{formatMeasurement(ann)}</p>
      </div>
      <div className="flex items-center gap-0.5">
        {linkCount === 0 && snapshot && (
          <AddToCategoryPopover
            snapshot={snapshot}
            actions={actions}
            onPick={(pick) => void actions?.createLineItemFromAnnotation(ann.id, pick)}
            triggerLabel="Add"
            triggerClassName="inline-flex items-center gap-0.5 rounded-md border border-line bg-bg/50 px-1.5 py-0.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
            triggerTitle="Add this candidate to a worksheet and link it automatically"
            triggerIcon={<Plus className="h-3 w-3" />}
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions?.toggleAnnotationVisibility(ann.id);
          }}
          className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
          title={ann.visible ? "Hide" : "Show"}
        >
          {ann.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </button>
        {supportsInlineEdit && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              actions?.editAnnotation(ann.id);
            }}
            className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
            title="Edit"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions?.deleteAnnotation(ann.id);
          }}
          className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function EditAnnotationRow({
  ann,
  onSave,
  onCancel,
}: {
  ann: TakeoffAnnotation;
  onSave: (updates: { label?: string; color?: string; groupName?: string }) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(ann.label ?? "");
  const [color, setColor] = useState(ann.color || EDIT_COLORS[0]);
  const [group, setGroup] = useState(ann.groupName ?? "");

  return (
    <div className="rounded-md border border-accent/30 bg-accent/5 p-1.5">
      <Input
        className="h-6 text-xs"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label..."
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave({ label, color, groupName: group || undefined });
          if (e.key === "Escape") onCancel();
        }}
      />
      <Input
        className="mt-1 h-6 text-xs"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        placeholder="Group name..."
      />
      <div className="mt-1.5 flex items-center gap-1">
        {EDIT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn(
              "h-4 w-4 rounded-full border-2 transition-all",
              color === c ? "border-fg scale-110" : "border-transparent hover:border-fg/20",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-end gap-1">
        <button onClick={onCancel} className="rounded p-1 text-fg/40 hover:text-fg/60" title="Cancel">
          <X className="h-3 w-3" />
        </button>
        <button
          onClick={() => onSave({ label, color, groupName: group || undefined })}
          className="rounded p-1 text-accent hover:text-accent/80"
          title="Save"
        >
          <Check className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/** Grouping axes for the BIM element list. Reuses the same construction-
 *  classification primitive that powers the estimate summary rollups, so the
 *  element grouping is consistent with how the line items those elements
 *  back will appear in the quote summary. */
type InspectGroupBy = "none" | "uniformat" | "masterformat" | "elementClass" | "level" | "material";

const GROUP_BY_OPTIONS: { id: InspectGroupBy; label: string }[] = [
  { id: "none",         label: "Flat" },
  { id: "uniformat",    label: "Uniformat" },
  { id: "masterformat", label: "MasterFormat" },
  { id: "elementClass", label: "Class" },
  { id: "level",        label: "Level" },
  { id: "material",     label: "Material" },
];

function ModelInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const { modelElements, modelElementsLoading, modelError, modelSyncing, modelSearch, modelBasis, modelAsset, selectedModelElementId } = snapshot;
  const [groupBy, setGroupBy] = useState<InspectGroupBy>("none");
  const [collapsedElementGroups, setCollapsedElementGroups] = useState<Set<string>>(new Set());

  // Group elements by the selected axis. For classification axes (Uniformat,
  // MasterFormat) we read the code straight off element.classification[key]
  // — same shape as WorksheetItem.classification, so the grouping is
  // consistent with the by_uniformat_division / by_masterformat_division
  // summary rollups (no separate mapping needed). For class/level/material
  // we fall back to the element's typed columns. Elements with no value
  // bucket into "Unclassified" / "Untagged" so they're still discoverable.
  const groupedElements = useMemo(() => {
    if (groupBy === "none") return null;
    const groups = new Map<string, { key: string; label: string; elements: InspectModelElement[] }>();
    for (const element of modelElements) {
      let code = "";
      let label = "";
      if (groupBy === "uniformat" || groupBy === "masterformat") {
        code = element.classification?.[groupBy]?.trim() ?? "";
        label = code || (groupBy === "uniformat" ? "Unclassified — Uniformat" : "Unclassified — MasterFormat");
      } else if (groupBy === "elementClass") {
        code = element.elementClass?.trim() ?? "";
        label = code || "No class";
      } else if (groupBy === "level") {
        code = element.level?.trim() ?? "";
        label = code || "No level";
      } else if (groupBy === "material") {
        code = element.material?.trim() ?? "";
        label = code || "No material";
      }
      const key = code || `__unclassified__${groupBy}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, label, elements: [] };
        groups.set(key, group);
      }
      group.elements.push(element);
    }
    // Sort: unclassified bucket(s) last; everything else alphabetical by key.
    return Array.from(groups.values()).sort((a, b) => {
      const aUn = a.key.startsWith("__unclassified__") ? 1 : 0;
      const bUn = b.key.startsWith("__unclassified__") ? 1 : 0;
      if (aUn !== bUn) return aUn - bUn;
      return a.key.localeCompare(b.key);
    });
  }, [modelElements, groupBy]);

  const toggleGroup = (key: string) => {
    setCollapsedElementGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      {/* Document-level summary lives in the Inspect tab now; this list keeps
          just the controls that drive what's shown and gives the rows the
          rest of the vertical space. */}
      <div className="shrink-0 space-y-1.5">
        <div className="flex items-center gap-1">
          <Input
            className="h-7 flex-1 text-xs"
            value={modelSearch}
            onChange={(e) => actions?.setModelSearch(e.target.value)}
            placeholder="Search objects, classes, materials..."
          />
          <button
            type="button"
            disabled={modelSyncing}
            onClick={() => actions?.refreshModel()}
            title="Sync the model index from disk"
            className={cn(
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-fg/55 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50",
            )}
          >
            {modelSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="flex items-center gap-0.5 rounded-md border border-line bg-panel p-0.5">
          {(["count", "area", "volume"] as InspectModelBasis[]).map((basis) => (
            <button
              key={basis}
              type="button"
              onClick={() => actions?.setModelBasis(basis)}
              className={cn(
                "flex-1 rounded px-1.5 py-1 text-[10px] font-medium capitalize transition-colors",
                modelBasis === basis ? "bg-accent/15 text-accent" : "text-fg/45 hover:text-fg/70",
              )}
            >
              {basis}
            </button>
          ))}
        </div>
        {/* Group-by selector. Reuses the same classification keys as the
            estimate summary rollups (Uniformat / MasterFormat) so the
            element grouping shown here aligns with how the resulting line
            items will appear in the quote summary. Class/level/material
            fall back to the typed columns for non-classification axes. */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-md border border-line bg-panel p-0.5">
          <span className="shrink-0 px-1 text-[9px] font-medium uppercase tracking-wider text-fg/35">
            Group
          </span>
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setGroupBy(opt.id);
                setCollapsedElementGroups(new Set());
              }}
              className={cn(
                "shrink-0 rounded px-1.5 py-1 text-[10px] font-medium transition-colors",
                groupBy === opt.id ? "bg-accent/15 text-accent" : "text-fg/45 hover:text-fg/70",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-auto pr-1">
        {modelElementsLoading && modelElements.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-4 text-fg/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : modelElements.length === 0 ? (
          <p className="rounded-md border border-line bg-panel/40 px-3 py-4 text-center text-[11px] text-fg/40">
            {modelAsset ? "No model objects match this search." : "Sync the model index to list model objects."}
          </p>
        ) : groupedElements ? (
          // Grouped rendering: each axis bucket gets a sticky-ish header with
          // a count and a collapse toggle. Element rows inside reuse the same
          // markup as the flat list.
          groupedElements.map((group) => {
            const collapsed = collapsedElementGroups.has(group.key);
            const linkedCount = group.elements.filter((e) => e.isLinked).length;
            return (
              <div key={group.key} className="flex flex-col gap-1">
                <div className="group/grouphdr flex items-stretch gap-1 rounded-md border border-line bg-panel/80 transition-colors hover:bg-panel2/40">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex flex-1 items-center gap-1.5 px-2 py-1 text-left text-[10px] font-medium text-fg/70"
                  >
                    {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    <span className="min-w-0 flex-1 truncate">{group.label}</span>
                    <span className="shrink-0 text-fg/40">
                      {group.elements.length}
                      {linkedCount > 0 && (
                        <span className="ml-1 text-success/80">· {linkedCount} linked</span>
                      )}
                    </span>
                  </button>
                  <AddToCategoryPopover
                    snapshot={snapshot}
                    actions={actions}
                    onPick={(pick) =>
                      void actions?.createLineItemFromElementGroup(
                        group.elements.map((el) => el.id),
                        group.label,
                        pick,
                      )
                    }
                    triggerLabel="Add"
                    triggerClassName="inline-flex shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-fg/55 opacity-0 transition-opacity hover:bg-accent/10 hover:text-accent group-hover/grouphdr:opacity-100 focus:opacity-100"
                    triggerTitle={`Add one summed line item from all ${group.elements.length} elements in ${group.label} — pick a category`}
                    triggerIcon={<Sigma className="h-3 w-3" />}
                  />
                </div>
                {!collapsed && group.elements.map((element) => renderElementRow(
                  element,
                  selectedModelElementId,
                  actions,
                  snapshot,
                ))}
              </div>
            );
          })
        ) : (
          modelElements.map((element) => renderElementRow(element, selectedModelElementId, actions, snapshot))
        )}
      </div>

      {modelError && (
        <div className="shrink-0 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[10px] text-danger">
          {modelError}
        </div>
      )}
    </div>
  );
}

/** Shared element-row renderer for the BIM Inspect list. Lives outside the
 *  ModelInspect component so the flat-list and grouped-list branches don't
 *  duplicate ~80 lines of JSX. */
function renderElementRow(
  element: InspectModelElement,
  selectedModelElementId: string | null,
  actions: InspectActions | null,
  snapshot: InspectSnapshot,
) {
  const isSelected = selectedModelElementId === element.id;
  const uniformat = element.classification?.uniformat?.trim();
  const masterformat = element.classification?.masterformat?.trim();
  const lod = element.lod?.trim();
  const lodFromPset = element.lodSource === "pset";
  return (
    <div
      key={element.id}
      onClick={() => actions?.selectModelElement(isSelected ? null : element.id)}
      className={cn(
        "cursor-pointer rounded-md border px-2 py-1.5 transition-colors",
        isSelected
          ? "border-accent/40 bg-accent/10"
          : element.isLinked
            ? "border-success/25 bg-success/5"
            : "border-line bg-panel/60 hover:bg-panel2/40",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-fg/80">{element.name || element.externalId}</p>
          <p className="mt-0.5 truncate text-[10px] text-fg/40">
            {[element.elementClass, element.material, element.level].filter(Boolean).join(" · ") || "Model element"}
          </p>
          {(uniformat || masterformat || lod) && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {uniformat && (
                <span
                  className="rounded bg-violet-500/12 px-1 py-px text-[9px] font-medium text-violet-500"
                  title={`Uniformat: ${uniformat}`}
                >
                  UF · {uniformat}
                </span>
              )}
              {masterformat && (
                <span
                  className="rounded bg-amber-500/12 px-1 py-px text-[9px] font-medium text-amber-600"
                  title={`MasterFormat: ${masterformat}`}
                >
                  MF · {masterformat}
                </span>
              )}
              {lod && (
                <span
                  className={cn(
                    "rounded px-1 py-px text-[9px] font-medium",
                    lodFromPset
                      ? "bg-sky-500/12 text-sky-500"
                      : "bg-fg/10 text-fg/70",
                  )}
                  title={`Level of Development${lodFromPset ? " (from model property set)" : " (manual)"}`}
                >
                  LOD {lod}
                </span>
              )}
            </div>
          )}
          <p className="mt-1 text-[10px] font-medium text-fg/60">{element.quantitySummary}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {element.isLinked ? (
            <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success">
              Linked
            </span>
          ) : (
            <AddToCategoryPopover
              snapshot={snapshot}
              actions={actions}
              onPick={(pick) => void actions?.createLineItemFromElement(element.id, pick)}
              triggerLabel="Add"
              triggerClassName="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
              triggerTitle="Add this element to a worksheet — pick a category"
              triggerIcon={<Plus className="h-3 w-3" />}
            />
          )}
        </div>
      </div>
    </div>
  );
}


function formatMeasurement(ann: TakeoffAnnotation): string {
  if (!ann.measurement) return "—";
  const { value, unit } = ann.measurement;
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (unit === "count") return `${value}`;
  return `${value.toFixed(2)} ${unit || ""}`.trim();
}

function numericFormat(value: number) {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }).format(value);
}

/** Spreadsheet rows as entities. Each row gets a "+ Add" that creates a
 *  worksheet line item using the heuristic column mapping; the group header
 *  has a "Σ Add" that imports every row in one batch. The mapping is shown
 *  inline so the estimator can see at a glance which columns are being read
 *  as name / qty / uom / cost before they commit. */
function SpreadsheetInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const ss = snapshot.spreadsheet;
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    if (!ss) return [];
    const q = search.trim().toLowerCase();
    if (!q) return ss.rows;
    return ss.rows.filter((row) =>
      Object.values(row.values).some((v) => v.toLowerCase().includes(q)),
    );
  }, [ss, search]);

  if (!ss) {
    return (
      <p className="rounded-md border border-line bg-panel/40 px-3 py-4 text-center text-[11px] text-fg/40">
        Open a spreadsheet to list its rows here.
      </p>
    );
  }

  const { mapping } = ss;
  const isPivotMode = ss.mode === "pivot";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-xs">
      <div className="shrink-0 space-y-1.5">
        <Input
          className="h-7 text-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter rows…"
        />
        {ss.pivot && (
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-700">
            <div className="font-medium">
              Pivoted by {ss.pivot.groupBy} / {ss.pivot.measureLabel}
            </div>
            <div className="mt-0.5 text-emerald-700/70">
              {ss.pivot.groupCount.toLocaleString()} groups from {ss.pivot.sourceRowCount.toLocaleString()} source rows
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-panel/40 p-1 text-[10px]">
          <span className="font-medium uppercase tracking-wider text-fg/35">Mapped</span>
          {(["name", "quantity", "uom", "cost"] as const).map((field) => {
            const header = mapping[field];
            return (
              <span
                key={field}
                className={cn(
                  "rounded px-1 py-px text-[9px] font-medium",
                  header ? "bg-emerald-500/12 text-emerald-600" : "bg-fg/5 text-fg/35",
                )}
                title={header ? `${field} ← ${header}` : `${field}: no column matched`}
              >
                {field}{header ? `: ${header}` : ""}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto pr-1">
        {/* Σ Add header — raw mode imports rows; pivot mode imports one summarized item per group. */}
        <div className="group/grouphdr sticky top-0 z-10 flex items-stretch gap-1 rounded-md border border-line bg-panel/90 backdrop-blur">
          <div className="flex flex-1 items-center gap-1.5 px-2 py-1 text-[10px] font-medium text-fg/70">
            <span className="min-w-0 flex-1 truncate">{isPivotMode ? "All pivot groups" : "All rows"}</span>
            <span className="shrink-0 text-fg/40">{filteredRows.length}</span>
          </div>
          <AddToCategoryPopover
            snapshot={snapshot}
            actions={actions}
            onPick={(pick) => void actions?.createLineItemsFromAllSpreadsheetRows(pick)}
            triggerLabel={isPivotMode ? "Add groups" : "Add all"}
            triggerClassName="inline-flex shrink-0 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-fg/55 transition-colors hover:bg-accent/10 hover:text-accent disabled:opacity-40"
            triggerTitle={isPivotMode ? "Create one worksheet line item per pivot group" : "Import every row as its own worksheet line item — pick a category"}
            triggerIcon={<Sigma className="h-3 w-3" />}
          />
        </div>

        {filteredRows.length === 0 ? (
          <p className="rounded-md border border-line bg-panel/40 px-3 py-4 text-center text-[11px] text-fg/40">
            {ss.rows.length === 0 ? "No rows in this spreadsheet yet." : "No rows match the filter."}
          </p>
        ) : (
          filteredRows.map((row) => {
            const displayName = mapping.name ? row.values[mapping.name] : "";
            const qtyVal = mapping.quantity ? row.values[mapping.quantity] : "";
            const uomVal = mapping.uom ? row.values[mapping.uom] : "";
            const costVal = mapping.cost ? row.values[mapping.cost] : "";
            const pivot = row.pivot;
            return (
              <div
                key={row.id}
                className="group flex items-start gap-2 rounded-md border border-line bg-panel/60 px-2 py-1.5 transition-colors hover:bg-panel2/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-fg/80">
                    {(displayName || "Row " + (row.index + 1)).toString().trim()}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-fg/45">
                    {pivot
                      ? [
                          qtyVal && `${qtyVal}`,
                          `${pivot.sourceRowCount.toLocaleString()} rows`,
                          `avg ${numericFormat(pivot.average)}`,
                        ].filter(Boolean).join(" · ")
                      : [
                          qtyVal && `${qtyVal}${uomVal ? ` ${uomVal}` : ""}`,
                          costVal && `@ ${costVal}`,
                        ].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <AddToCategoryPopover
                  snapshot={snapshot}
                  actions={actions}
                  onPick={(pick) => void actions?.createLineItemFromSpreadsheetRow(row.index, pick)}
                  triggerLabel="Add"
                  triggerClassName="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 opacity-0 transition-all hover:border-accent/40 hover:bg-accent/10 hover:text-accent group-hover:opacity-100 focus:opacity-100"
                  triggerTitle={pivot ? "Create one worksheet line item for this pivot group" : "Import this row as a worksheet line item — pick a category"}
                  triggerIcon={<Plus className="h-3 w-3" />}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** AI-derived photo-BOM rows surfaced as entities — one per scope item the
 *  vision model called out. The estimator reviews them here and uses the
 *  same + Add popover the other entity sources do; the row dims once it's
 *  been + Added so it's obvious what's left. */
function PhotoBomInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const bom = snapshot.photoBom;
  const [search, setSearch] = useState("");
  if (!bom) return null;

  const filteredRows = bom.rows.filter((row) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      row.description.toLowerCase().includes(q) ||
      row.notes.toLowerCase().includes(q) ||
      row.uom.toLowerCase().includes(q)
    );
  });

  // Always show the row list — header content is height-capped and
  // internally scrolling so a long summary or warning stack can't push the
  // rows off-screen the way it did in the first cut.
  const [showSummary, setShowSummary] = useState(true);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-xs">
      {/* Header: source photo count + collapsible AI summary / warnings.
          shrink-0 + max-h so the row list below is always visible. */}
      <div className="shrink-0 rounded-md border border-line bg-panel/60 px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-[10px] font-medium uppercase tracking-wider text-fg/45">
            Photo BOM · {bom.photoCount} photo{bom.photoCount === 1 ? "" : "s"} · {bom.rows.length} item
            {bom.rows.length === 1 ? "" : "s"}
            {bom.warnings.length > 0 && (
              <span className="ml-1 normal-case text-warning">· {bom.warnings.length} warning{bom.warnings.length === 1 ? "" : "s"}</span>
            )}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {(bom.summary || bom.warnings.length > 0) && (
              <button
                type="button"
                onClick={() => setShowSummary((s) => !s)}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-fg/45 hover:bg-panel2 hover:text-fg/70"
                title="Show or hide the AI summary"
              >
                {showSummary ? "Hide details" : "Show details"}
              </button>
            )}
            {confirmingDiscard ? (
              <>
                <button
                  type="button"
                  onClick={() => actions?.clearPhotoBomResults()}
                  className="rounded bg-danger/15 px-1.5 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/25"
                >
                  Confirm discard
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDiscard(false)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-fg/45 hover:text-fg/70"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDiscard(true)}
                className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger"
                title="Discard these results"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        {showSummary && (bom.summary || bom.warnings.length > 0) && (
          <div className="mt-1.5 max-h-32 space-y-1.5 overflow-auto pr-1">
            {bom.summary && (
              <p className="text-[11px] leading-relaxed text-fg/70">{bom.summary}</p>
            )}
            {bom.warnings.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1 text-[10px] text-warning">
                {bom.warnings.map((w, i) => (
                  <p key={i}>· {w}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-1">
        <div className="relative flex-1">
          <Input
            className="h-7 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter rows…"
          />
        </div>
        <AddToCategoryPopover
          snapshot={snapshot}
          actions={actions}
          onPick={(pick) => void actions?.createLineItemsFromAllPhotoBomRows(pick)}
          triggerLabel={`Add all (${bom.rows.filter((r) => !r.isLinked).length})`}
          triggerClassName="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-bg/50 px-2 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent disabled:opacity-40"
          triggerTitle="Add every unlinked row to the worksheet under one category"
          triggerIcon={<Sigma className="h-3 w-3" />}
        />
      </div>

      {/* Row list */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto pr-1">
        {filteredRows.length === 0 ? (
          <p className="rounded-md border border-dashed border-line bg-panel/40 px-3 py-4 text-center text-[11px] text-fg/40">
            {bom.rows.length === 0
              ? "No items returned."
              : `No items match "${search}".`}
          </p>
        ) : (
          filteredRows.map((row) => {
            const confTone =
              row.confidence >= 0.75
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
                : row.confidence >= 0.5
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-600";
            return (
              <div
                key={row.id}
                className={cn(
                  "group relative rounded-md border px-2 py-1.5 transition-colors",
                  row.isLinked
                    ? "border-success/30 bg-success/5 opacity-70"
                    : "border-line bg-panel/60 hover:bg-panel2/40",
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-fg/85">{row.description}</p>
                    <p className="mt-0.5 truncate text-[10px] text-fg/50">
                      {[
                        `${row.quantity} ${row.uom}`,
                        row.sourcePhotoNames.length > 0
                          ? `from ${row.sourcePhotoNames.join(", ")}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {row.notes && (
                      <p
                        className="mt-1 text-[10px] italic text-fg/45"
                        title={row.notes}
                      >
                        {row.notes.length > 110 ? `${row.notes.slice(0, 108)}…` : row.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium tabular-nums",
                        confTone,
                      )}
                      title={`Model confidence ${(row.confidence * 100).toFixed(0)}%`}
                    >
                      {(row.confidence * 100).toFixed(0)}%
                    </span>
                    {row.isLinked ? (
                      <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success">
                        Linked
                      </span>
                    ) : (
                      <AddToCategoryPopover
                        snapshot={snapshot}
                        actions={actions}
                        onPick={(pick) =>
                          void actions?.createLineItemFromPhotoBomRow(row.id, pick)
                        }
                        triggerLabel="Add"
                        triggerClassName="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                        triggerTitle="Add this AI-suggested item to the worksheet under a category"
                        triggerIcon={<Plus className="h-3 w-3" />}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Pivot-style summary for a group of annotations — surfaces the dominant
 *  dimension's total alongside the row count in the group header. Returns
 *  null when the group is mixed (no useful sum) or empty. */
function summarizeAnnotationGroup(items: TakeoffAnnotation[]): string | null {
  if (items.length === 0) return null;
  // Detect the dominant dimension in the group. If most annotations agree on
  // a single dimension we sum it; mixed groups fall back to count.
  const counts = { area: 0, volume: 0, length: 0, count: 0 };
  for (const ann of items) {
    const m = ann.measurement;
    if (m?.area != null && m.area > 0) counts.area += 1;
    else if (m?.volume != null && m.volume > 0) counts.volume += 1;
    else if (typeof m?.value === "number") counts.length += 1;
    else counts.count += 1;
  }
  const dominant = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "count") as
    | "area" | "volume" | "length" | "count";
  if (dominant === "count") return null;

  let total = 0;
  let unit = "";
  for (const ann of items) {
    const m = ann.measurement;
    if (dominant === "area" && m?.area != null) {
      total += m.area;
      unit = m.unit ? `${m.unit}²` : "SF";
    } else if (dominant === "volume" && m?.volume != null) {
      total += m.volume;
      unit = m.unit ? `${m.unit}³` : "CF";
    } else if (dominant === "length" && typeof m?.value === "number" && m.unit !== "count") {
      total += m.value;
      unit = m.unit || "";
    }
  }
  if (total <= 0) return null;
  return `${total.toFixed(total >= 100 ? 0 : 1)}${unit ? ` ${unit}` : ""}`;
}

"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, GitBranch, Link2, Loader2, LocateFixed, Pencil, Plus, RefreshCw, ScanSearch, Settings2, Sigma, Trash2, X } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Input } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Pickup } from "@/components/workspace/takeoff/annotation-canvas";
import type {
  DrawingAnalysisPreset,
  DrawingGeometryAnalysisResult,
  DrawingGeometrySource,
  DrawingPrimitive,
  PickupLinkRecord,
} from "@/lib/api";
import { isRasterCircleCoveredByVector, measurePdfPrimitive, type PixelCircle } from "@bidwright/domain";

/** `bim` is element-aware (IFC/Revit/Navisworks) and uses the BIM-specific
 *  inspect surface; `model` is geometry-only (STEP/glTF/OBJ/STL) and degrades
 *  to a metric summary without element semantics; `spreadsheet` treats each
 *  row as an entity that can be imported into a worksheet one click at a
 *  time, using a column-mapping heuristic. */
export type InspectMode = "pdf" | "dwg" | "bim" | "model" | "spreadsheet" | "photo-bom" | "empty";

/** Detection kinds the right-hand inspect panel renders as candidate rows.
 *  `system` / `line` / `symbol` / `circle` / `text` are the legacy raster +
 *  trace outputs. `arc` and `curve` are the canonical-primitive kinds from
 *  the PDF vector pipeline (post Phase-2 rebuild):
 *
 *    - `arc` covers arc / circle / ellipse primitives (curved
 *      area-or-arc-length shapes, all of which have a center + radius).
 *      Saving an `arc`-kind row produces a polyline annotation sampled
 *      from the arc / circle / ellipse with the proper measurement
 *      (arc length for arcs, area for closed circles / ellipses).
 *    - `curve` covers cubic / quad bezier primitives that didn't fit a
 *      circular arc. Saving samples the bezier to a polyline annotation
 *      with a chord-and-control-polygon length estimate. */
export type InspectDrawingDetectionKind =
  | "system"
  | "line"
  | "symbol"
  | "circle"
  | "text"
  | "arc"
  | "curve";

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
    /** Vector arc / circle / ellipse primitives layered over the canvas.
     *  Separate toggle from `circles` (which is the raster Hough output)
     *  so the estimator can visually compare the two sources. */
    arcs: boolean;
    /** Cubic + quad bezier primitives layered over the canvas. */
    curves: boolean;
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
  pickupId: string | null;
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
  /** Optional thumbnail data URI for the first source photo. Surfaced as
   *  the row's left-hand preview in the Pickups panel so the estimator
   *  can visually confirm what the AI was looking at without navigating
   *  back to the photo intake screen. */
  sourcePhotoThumbnail?: string | null;
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
  annotations: Pickup[];
  pickupLinks: PickupLinkRecord[];
  selectedPickupId: string | null;
  editingPickupId: string | null;
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
  /** Remove EVERY pickup attached to the active document — Auto Count
   *  bundles, Smart Count items, manual annotations, the lot. Used when
   *  the estimator wants a clean slate (legacy multi-row bundles from
   *  pre-refactor runs, mis-scoped Auto Count results, etc). Does not
   *  touch CAD entities, model elements, spreadsheet rows, or other
   *  sources that don't live in the Pickup table. */
  clearAllAnnotationsForCurrentDocument: () => void;
  /** Toggle inclusion of a single match inside an Auto Count bundle. The
   *  index is into `annotation.metadata.matches`. Updates the annotation's
   *  `points` + `measurement.value` so the per-row count + worksheet line
   *  item promotion reflect the current selection. Implements the
   *  per-match deselection feature the floating Auto Count modal used to
   *  provide — now inline on the Pickups row. */
  toggleAutoCountMatch: (pickupId: string, matchIndex: number) => void;
  editAnnotation: (id: string) => void;
  cancelAnnotationEdit: () => void;
  saveAnnotationEdit: (id: string, updates: { label?: string; color?: string; groupName?: string }) => void;
  runDrawingAnalysis: () => Promise<void> | void;
  updateDrawingAnalysisSettings: (patch: Partial<InspectDrawingAnalysisSettings>) => void;
  setDrawingAnalysisOverlay: (patch: Partial<InspectDrawingAnalysisSnapshot["overlay"]>) => void;
  selectDrawingDetection: (id: string | null, kind?: InspectDrawingDetectionKind) => void;
  selectDrawingDetectionGroup: (ids: string[]) => void;
  saveDrawingDetection: (id: string, kind: "system" | "symbol" | "circle" | "line") => Promise<void> | void;
  /** Save a detection as a Pickup (when needed) and convert it
   *  to a worksheet line item via the category picker. `arc` covers
   *  arc / circle / ellipse PDF primitives; `curve` covers cubic / quad
   *  bezier primitives. `system` / `line` / `arc` / `curve` require a
   *  drawing calibration before they can produce real-world quantities. */
  createLineItemFromDrawingDetection: (
    id: string,
    kind: "system" | "symbol" | "circle" | "line" | "arc" | "curve",
    pick: InspectCategoryPick,
  ) => Promise<void> | void;
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

  // PDF / DWG: every line-item source (drawing intelligence, smart count,
  // manual annotations) flows through their unified EntitiesPanel. Both
  // require the per-mode state object to be populated (drawingAnalysis /
  // dwgIntelligence) — if it isn't, no document is loaded and the panel
  // shows the empty state.
  if (snapshot.mode === "pdf" && snapshot.drawingAnalysis) {
    return <PdfEntitiesInspect snapshot={snapshot} actions={actions} />;
  }
  if (snapshot.mode === "dwg" && snapshot.dwgIntelligence) {
    return <DwgEntitiesInspect snapshot={snapshot} actions={actions} />;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-[11px] leading-relaxed text-fg/45">
        Open a takeoff document to browse its line items here.
      </p>
    </div>
  );
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
  // ONE panel. ONE list. Every source — analyzer output, manual annotations,
  // smart count results — feeds in as a group inside DrawingAnalysisInspect.
  // The user's "potential line items = anything in this tab" mental model is
  // now what the UI literally shows: SmartCountGroup and ManualAnnotationsGroup
  // render INSIDE the EntitiesPanel alongside the analyzer groups, not as
  // separate stacked panels.
  return (
    <DrawingAnalysisInspect
      snapshot={snapshot}
      actions={actions}
      showSettings={showSettings}
      onToggleSettings={() => setShowSettings((value) => !value)}
    />
  );
}

/** Bulk "clear every pickup on this file" action — destructive, behind a
 *  two-click confirm. Lives inside each surface's settings expansion so
 *  it's discoverable but never one fat-finger away. Scopes to the active
 *  document only; doesn't touch CAD entities / model elements / Photo BOM
 *  results that live outside the Pickup table. */
function ClearPickupsDangerZone({
  count,
  onClear,
}: {
  count: number;
  onClear: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (count === 0) {
    return (
      <div className="rounded-md border border-line/60 bg-bg/35 px-2 py-1.5 text-[10px] text-fg/40">
        No pickups on this file yet.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-danger/70">Danger zone</p>
        <span className="font-mono text-[10px] tabular-nums text-fg/40">{count.toLocaleString()} pickup{count === 1 ? "" : "s"}</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-fg/55">
        Removes every Auto Count, Smart Count, and manual pickup on this file. Cannot be undone.
      </p>
      {confirming ? (
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              onClear();
              setConfirming(false);
            }}
            className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-danger/15 px-2 text-[10px] font-medium text-danger transition-colors hover:bg-danger/25"
          >
            <Trash2 className="h-3 w-3" />
            Confirm — clear all {count}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2 text-[10px] font-medium text-fg/55 hover:bg-panel2 hover:text-fg/75"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-2 inline-flex h-7 w-full items-center justify-center gap-1 rounded-md border border-danger/30 bg-bg/40 px-2 text-[10px] font-medium text-danger/80 transition-colors hover:bg-danger/10"
        >
          <Trash2 className="h-3 w-3" />
          Clear all pickups
        </button>
      )}
    </div>
  );
}

/** Manual annotations as a group inside the unified Line items panel.
 *  Each annotation becomes a row with source="manual"; this is what the
 *  user sees regardless of takeoff type (PDF or DXF). No separate panel
 *  chrome — the group lives inside the same `EntitiesPanel` as the
 *  analyzer-derived rows. */
/** Split the snapshot's annotations into auto-count bundles vs truly-manual
 *  annotations. Auto Count uses the same Pickup table, tagged via
 *  `metadata.source === "auto-count"` — bundling that flag is what lets us
 *  surface one Auto Count run as ONE pickup row (with the template
 *  thumbnail + match count) instead of N rows. */
function partitionAnnotations(annotations: Pickup[]) {
  const autoCount: Pickup[] = [];
  const manual: Pickup[] = [];
  for (const ann of annotations) {
    if (ann.metadata && ann.metadata.source === "auto-count") {
      autoCount.push(ann);
    } else {
      manual.push(ann);
    }
  }
  return { autoCount, manual };
}

function AutoCountGroup({
  snapshot,
  actions,
  matchesQuery,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
  matchesQuery?: (row: DetectionRow) => boolean;
}) {
  const { annotations, pickupLinks, selectedPickupId } = snapshot;
  const { autoCount } = useMemo(() => partitionAnnotations(annotations), [annotations]);
  const linkCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of pickupLinks) {
      map.set(link.pickupId, (map.get(link.pickupId) ?? 0) + 1);
    }
    return map;
  }, [pickupLinks]);
  if (autoCount.length === 0) return null;
  const rows = autoCount.map<DetectionRow>((ann) => {
    const linkCount = linkCountMap.get(ann.id) ?? 0;
    const meta = ann.metadata ?? {};
    const allMatches = Array.isArray(meta.matches)
      ? (meta.matches as Array<{ image?: string | null; confidence?: number }>)
      : [];
    const excludedSet = new Set<number>(
      Array.isArray(meta.excludedMatchIndexes) ? (meta.excludedMatchIndexes as number[]) : [],
    );
    const effectiveCount = allMatches.length > 0
      ? allMatches.length - excludedSet.size
      : (typeof ann.measurement?.value === "number" ? ann.measurement.value : ann.points.length);
    const templateImage = typeof meta.templateImage === "string"
      ? meta.templateImage
      : null;
    return {
      id: ann.id,
      kind: "manual" as const,
      source: "auto-count" as const,
      title: ann.label || "Auto Count",
      subtitle: `${effectiveCount.toLocaleString()} match${effectiveCount === 1 ? "" : "es"}${
        excludedSet.size > 0 ? ` · ${excludedSet.size} excluded` : ""
      }`,
      value: `×${effectiveCount.toLocaleString()}`,
      selected: selectedPickupId === ann.id,
      saving: false,
      savedCount: linkCount,
      linkCount,
      color: ann.color || "#22c55e",
      thumbnail: templateImage,
      // Only surface the expansion panel when we actually have per-match
      // thumbnails to show (page-scope runs). Document/all scope runs
      // don't carry per-match images, so the row stays unexpandable.
      matchExpansion: allMatches.length > 0 && allMatches.some((m) => m.image)
        ? {
            pickupId: ann.id,
            matches: allMatches.map((m, idx) => ({
              image: m.image ?? null,
              confidence: typeof m.confidence === "number" ? m.confidence : 0,
              included: !excludedSet.has(idx),
            })),
          }
        : undefined,
    };
  });
  const filteredRows = matchesQuery ? rows.filter(matchesQuery) : rows;
  return (
    <DetectionGroup
      title="Auto count"
      accentColor="#22c55e"
      count={autoCount.length}
      rows={filteredRows}
      snapshot={snapshot}
      actions={actions}
      onSelect={(id) => actions?.selectAnnotation(selectedPickupId === id ? null : id)}
      onAdd={(id, _kind, pick) => void actions?.createLineItemFromAnnotation(id, pick)}
      onDelete={(id) => actions?.deleteAnnotation(id)}
    />
  );
}

function ManualAnnotationsGroup({
  snapshot,
  actions,
  matchesQuery,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
  matchesQuery?: (row: DetectionRow) => boolean;
}) {
  const { annotations, pickupLinks, selectedPickupId } = snapshot;
  const { manual } = useMemo(() => partitionAnnotations(annotations), [annotations]);
  const linkCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of pickupLinks) {
      map.set(link.pickupId, (map.get(link.pickupId) ?? 0) + 1);
    }
    return map;
  }, [pickupLinks]);
  if (manual.length === 0) return null;
  const rows = manual.map<DetectionRow>((ann) => {
    const linkCount = linkCountMap.get(ann.id) ?? 0;
    const typeLabel = TYPE_LABELS[ann.groupName || ann.type] ?? (ann.groupName || ann.type);
    return {
      id: ann.id,
      kind: "manual" as const,
      source: "manual" as const,
      title: ann.label || typeLabel,
      subtitle: typeLabel + (ann.measurement?.value ? ` · ${ann.measurement.value} ${ann.measurement.unit ?? ""}` : ""),
      selected: selectedPickupId === ann.id,
      saving: false,
      savedCount: linkCount,
      linkCount,
      color: ann.color || "#64748b",
    };
  });
  const filteredRows = matchesQuery ? rows.filter(matchesQuery) : rows;
  return (
    <DetectionGroup
      title="Manual"
      accentColor="#94a3b8"
      count={manual.length}
      rows={filteredRows}
      snapshot={snapshot}
      actions={actions}
      onSelect={(id) => actions?.selectAnnotation(selectedPickupId === id ? null : id)}
      onAdd={(id, _kind, pick) => void actions?.createLineItemFromAnnotation(id, pick)}
      onDelete={(id) => actions?.deleteAnnotation(id)}
    />
  );
}

/** Smart count items as a group inside the unified Line items panel.
 *  Each count item becomes a row with source="smart-count". */
function SmartCountGroup({
  snapshot,
  actions,
  matchesQuery,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
  matchesQuery?: (row: DetectionRow) => boolean;
}) {
  const smart = snapshot.smartCount;
  if (!smart) return null;
  // Show a running-state pill or error pill even when no items have come
  // back yet — so the user sees feedback the moment they draw a region.
  // Without this, "Smart count doesn't add anything to Pickups" appears
  // identical to "Smart count finished with 0 items" from the user's POV.
  if (smart.items.length === 0) {
    if (!smart.running && !smart.error) return null;
    return (
      <section>
        <div className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-[9px] font-medium uppercase tracking-wider text-fg/45">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Smart count</span>
        </div>
        <div className="ml-2">
          {smart.running ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-700">
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              <span>Analyzing region…</span>
            </div>
          ) : smart.error ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
              {smart.error}
            </div>
          ) : null}
        </div>
      </section>
    );
  }
  const rows = smart.items.map<DetectionRow>((item) => ({
    id: item.id,
    kind: "smart" as const,
    source: "smart-count" as const,
    title: item.label || "Count candidate",
    subtitle: `${item.count.toLocaleString()} found · confidence ${item.confidence}${item.included ? "" : " · excluded"}`,
    value: `×${item.count.toLocaleString()}`,
    selected: smart.selectedItemId === item.id,
    saving: false,
    savedCount: 0,
    linkCount: 0,
    color: "#10b981",
    // Surface the AI's crop region as the row thumbnail so the estimator
    // can confirm what was counted without having to navigate the canvas.
    thumbnail: smart.cropImage ?? null,
  }));
  const filteredRows = matchesQuery ? rows.filter(matchesQuery) : rows;
  return (
    <DetectionGroup
      title="Smart count"
      accentColor="#10b981"
      count={smart.items.length}
      rows={filteredRows}
      snapshot={snapshot}
      actions={actions}
      onSelect={(id) => actions?.selectSmartCountItem(smart.selectedItemId === id ? null : id)}
      onAdd={(id, _kind, pick) => void actions?.createLineItemFromSmartCountItem(id, pick)}
      onDelete={(id) => actions?.deleteSmartCountItem(id)}
    />
  );
}

/** Normalise a traced-system label for display. Strips the legacy
 *  "{preset} run {N}" prefix Python used to emit (e.g. "Detected run 1",
 *  "Plumbing run 1", "Mechanical piping run 1") — that prefix repeated the
 *  section heading and was the user-flagged redundant UI. Cached analyses
 *  produced before the Python label change still carry it; this defensive
 *  cleanup keeps the row title meaningful for those docs too. */
function cleanSystemLabel(
  rawLabel: string | undefined,
  layers: string[] | undefined,
  index: number,
): string {
  const fallback = layers && layers.length > 0 ? `${layers[0]} · ${index}` : `#${index}`;
  if (!rawLabel) return fallback;
  // Match: any prefix + " run " + digits. Drop the prefix; if a layer is
  // available we prefer that, otherwise we keep just the run number.
  const match = /^(.+?)\s+run\s+(\d+)$/i.exec(rawLabel.trim());
  if (match) {
    return layers && layers.length > 0 ? `${layers[0]} · ${match[2]}` : `#${match[2]}`;
  }
  return rawLabel;
}

function drawingSourceLabel(value: string | null | undefined) {
  if (value === "pdf-vector" || value === "pdf_vector") return "PDF vector";
  if (value === "raster-cv" || value === "raster_cv") return "Raster CV";
  if (value === "cad-native" || value === "cad_native") return "CAD native";
  return "Auto";
}

// ── PDF primitive candidate formatters ────────────────────────────────────
// Primitives come from analysis.primitives in PDF-point coordinates. The
// inspect panel renders them next to raster-derived rows, so the formatters
// here translate the geometry into the same "title / subtitle / detail"
// shape every DetectionRow uses.

/** Coerce a primitive params field into a finite number. Returns 0 for
 *  malformed input — the title/subtitle path is best-effort. */
function primitiveNum(value: number | number[] | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function primitiveTitle(primitive: DrawingPrimitive): string {
  const { params } = primitive;
  switch (primitive.kind) {
    case "arc": {
      const r = primitiveNum(params.r);
      const startDeg = (primitiveNum(params.startAngleRad) * 180) / Math.PI;
      const endDeg = (primitiveNum(params.endAngleRad) * 180) / Math.PI;
      const sweepDeg = Math.round(((endDeg - startDeg) % 360 + 360) % 360);
      return `Arc r ${r.toFixed(2)} pt · ${sweepDeg}°`;
    }
    case "circle":
      return `Circle r ${primitiveNum(params.r).toFixed(2)} pt`;
    case "ellipse":
      return `Ellipse ${primitiveNum(params.rx).toFixed(2)}×${primitiveNum(params.ry).toFixed(2)} pt`;
    case "cubic_bezier":
      return "Cubic bezier";
    case "quad_bezier":
      return "Quadratic bezier";
    case "rect":
      return `Rect ${primitiveNum(params.width).toFixed(1)}×${primitiveNum(params.height).toFixed(1)} pt`;
    case "line":
      return "Line";
    default:
      return primitive.kind;
  }
}

/** Format the takeoff measurement preview for a primitive. When a
 *  calibration is set we show real-world units (LF, SF) so the estimator
 *  can sanity-check the bid number; otherwise we fall back to canvas
 *  pixels using the coordinateSpace conversion. */
function primitiveSubtitle(
  primitive: DrawingPrimitive,
  coordinateSpace: DrawingGeometryAnalysisResult["coordinateSpace"] | undefined,
  calibration: InspectDrawingAnalysisSnapshot["calibration"],
): string {
  const measurement = measurePdfPrimitive(primitive);
  if (measurement.basis === "none") return primitive.paint ?? "";

  // Convert from PDF-point coords to canvas pixel coords. Both axes are
  // averaged so non-square pages still produce a sensible scalar (the
  // pipeline normalizes the canvas to the page aspect anyway).
  const pixelsPerPoint = coordinateSpace
    ? (coordinateSpace.imagePixelPerPdfPointX + coordinateSpace.imagePixelPerPdfPointY) / 2
    : 1;

  if (calibration && calibration.pixelsPerUnit > 0) {
    // Calibration expresses paper-pixels per real-world-unit. Combine the
    // pt → canvas-px factor with the analysisToPaperScale to land in
    // paper-pixels, then divide by pixelsPerUnit to land in real-world.
    const paperFactor =
      (calibration.analysisToPaperScaleX + calibration.analysisToPaperScaleY) / 2;
    if (measurement.area > 0) {
      const areaPaperPx = measurement.area * (pixelsPerPoint * paperFactor) ** 2;
      const realArea = areaPaperPx / (calibration.pixelsPerUnit * calibration.pixelsPerUnit);
      return `${realArea.toFixed(realArea >= 100 ? 0 : 2)} ${calibration.unit}²`;
    }
    const lenPaperPx = measurement.length * pixelsPerPoint * paperFactor;
    const realLen = lenPaperPx / calibration.pixelsPerUnit;
    return `${realLen.toFixed(realLen >= 100 ? 0 : 2)} ${calibration.unit}`;
  }

  // No calibration: report in canvas pixels so it lines up with the
  // other "needs calibration" rows.
  if (measurement.area > 0) {
    const areaPx = measurement.area * pixelsPerPoint * pixelsPerPoint;
    return `${Math.round(areaPx).toLocaleString()} px² · scale needed`;
  }
  const lenPx = measurement.length * pixelsPerPoint;
  return `${Math.round(lenPx).toLocaleString()} px · scale needed`;
}

function primitiveDetail(primitive: DrawingPrimitive): string | undefined {
  const parts: string[] = [];
  if (primitive.layer) parts.push(`layer ${primitive.layer}`);
  if (primitive.paint && primitive.paint !== "stroke") parts.push(primitive.paint);
  if (primitive.subpath > 0) parts.push(`subpath ${primitive.subpath}`);
  return parts.length > 0 ? parts.join(" · ") : undefined;
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


function DwgEntitiesInspect({
  snapshot,
  actions,
}: {
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
}) {
  const intel = snapshot.dwgIntelligence;
  const [query, setQuery] = useState("");
  // Precondition: TakeoffInspectView only routes here when intel is populated,
  // so this is purely a TS narrow.
  if (!intel) return null;
  const q = query.trim().toLowerCase();
  const matches = (values: Array<string | number | null | undefined>) => {
    if (!q) return true;
    return values.some((value) => String(value ?? "").toLowerCase().includes(q));
  };
  const systems = intel.systems.filter((row) => matches([row.label, row.layer, row.uom, row.segmentCount]));
  const autoCounts = intel.autoCounts.filter((row) => matches([row.label, row.type, row.layer, row.count]));
  const entities = intel.entities.filter((row) => matches([row.label, row.type, row.layer, row.layoutName, row.measurementLabel]));
  const shownEntities = entities.slice(0, 500);

  // Total candidate count for the header. Mirrors what the PDF panel does so
  // both surfaces present a consistent header chrome. Counts everything the
  // user can flip into a worksheet row: CAD entities, traced systems,
  // count groups, plus the manual annotation rows that show up below.
  const totalCandidates = intel.entities.length + intel.systems.length
    + intel.autoCounts.length + intel.annotationCount;
  const pickupIds = new Set(snapshot.annotations.map((annotation) => annotation.id));
  const linkedCount = snapshot.pickupLinks.filter((link) => pickupIds.has(link.pickupId)).length;
  const layoutLabel = intel.selectedLayout === "__all__" ? "All layouts" : intel.selectedLayout;
  const processedDetail = intel.processedAt
    ? ` · processed ${new Date(intel.processedAt).toLocaleDateString()}`
    : "";

  const [showSettings, setShowSettings] = useState(false);
  const settingsBody = (
    <div className="grid gap-2">
      <ClearPickupsDangerZone
        count={snapshot.annotations.length}
        onClear={() => actions?.clearAllAnnotationsForCurrentDocument()}
      />
    </div>
  );

  return (
    <EntitiesPanel
      statusTooltip={`${intel.fileName} · ${layoutLabel}${processedDetail} · ${totalCandidates.toLocaleString()} item${totalCandidates === 1 ? "" : "s"}${linkedCount > 0 ? ` · ${linkedCount.toLocaleString()} linked` : ""}`}
      query={query}
      onQueryChange={setQuery}
      queryPlaceholder="Filter line items..."
      settingsContent={settingsBody}
      settingsOpen={showSettings}
      onToggleSettings={() => setShowSettings((v) => !v)}
    >
      <div className="space-y-1.5">
        <DetectionGroup
          title="Linear"
          accentColor="#0ea5e9"
          count={intel.systems.length}
          rows={systems.map((system, idx) => ({
            id: system.id,
            kind: "line" as const,
            source: "drawing-intelligence" as const,
            // Same cleanup we did for PDF — drop the redundant "Detected
            // run N" / "Linear run N" prefix from cached labels.
            title: cleanSystemLabel(system.label, [system.layer], idx + 1),
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
          title="Counts"
          accentColor="#10b981"
          count={intel.autoCounts.length}
          rows={autoCounts.map((row) => ({
            id: row.id,
            kind: "symbol" as const,
            source: "auto-count" as const,
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

        <DetectionGroup
          title="CAD entities"
          accentColor="#94a3b8"
          count={entities.length}
          rows={shownEntities.map((entity) => ({
            id: entity.id,
            kind: "cad-entity" as const,
            source: "cad" as const,
            title: entity.label,
            subtitle: `${entity.type} · layer ${entity.layer} · ${entity.layoutName}`,
            value: entity.measurementLabel,
            selected: intel.selectedEntityId === entity.id,
            saving: false,
            savedCount: entity.linkCount,
            linkCount: entity.linkCount,
            color: entity.color,
          }))}
          snapshot={snapshot}
          actions={actions}
          onSelect={(id) => actions?.selectDwgEntity(intel.selectedEntityId === id ? null : id)}
          onAdd={(id, _kind, pick) => void actions?.createLineItemFromDwgEntity(id, pick)}
          onDelete={(id) => actions?.deleteDwgEntity(id)}
        />
        {entities.length > shownEntities.length && (
          <p className="rounded-md border border-line/70 bg-bg/25 px-2 py-1.5 text-center text-[10px] text-fg/35">
            Showing first {shownEntities.length.toLocaleString()} pickups. Filter to narrow the list.
          </p>
        )}

        {/* Auto/manual annotations live in the SAME panel as the
            analysis-derived rows — every potential line item, regardless of
            source, flows through one list. AutoCountGroup partitions
            auto-count bundles into their own group with a thumbnail of the
            user-drawn template; ManualAnnotationsGroup carries the rest. */}
        <AutoCountGroup snapshot={snapshot} actions={actions} />
        <ManualAnnotationsGroup snapshot={snapshot} actions={actions} />
      </div>
    </EntitiesPanel>
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
    () => new Set(snapshot.pickupLinks.map((link) => link.pickupId)),
    [snapshot.pickupLinks],
  );

  const detectionAnnotationIndex = useMemo(() => {
    const map = new Map<string, Pickup[]>();
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
  const rawCircles = analysis?.circles ?? [];
  const lines = analysis?.lines ?? [];
  const texts = analysis?.textRegions ?? [];

  // Project vector circle primitives into image-pixel space so we can
  // dedupe them against the Hough raster output below. Same coord system =
  // same tolerance check; the conversion goes through coordinateSpace
  // when present, falls back to the identity transform otherwise (raster
  // sources don't emit a coordinateSpace, so this is a no-op there).
  const vectorCirclesPx: PixelCircle[] = (analysis?.primitives ?? [])
    .filter((p) => p.kind === "circle")
    .map((p) => {
      const cs = analysis?.coordinateSpace;
      const px = cs?.imagePixelPerPdfPointX ?? 1;
      const py = cs?.imagePixelPerPdfPointY ?? 1;
      const avg = (px + py) / 2;
      const cx = typeof p.params.cx === "number" ? p.params.cx : 0;
      const cy = typeof p.params.cy === "number" ? p.params.cy : 0;
      const r = typeof p.params.r === "number" ? p.params.r : 0;
      return { cxPx: cx * px, cyPx: cy * py, rPx: r * avg };
    });
  // Hough circles already covered by a vector-primitive circle drop out
  // here — the vector source is canonically truthful, so showing both
  // duplicates the candidate without adding information. Independent
  // overlay toggles still let the estimator visually compare sources on
  // the canvas; this is purely the row-build dedupe rule the user asked
  // for.
  const circles = vectorCirclesPx.length > 0
    ? rawCircles.filter((c) => !isRasterCircleCoveredByVector(c.cx, c.cy, c.radius, vectorCirclesPx))
    : rawCircles;
  // Canonical primitives from the PDF vector pipeline (Phase 2). Split
  // into the two takeoff-meaningful buckets:
  //   - arc-like: arc / circle / ellipse (closed curves with area, or
  //     open arcs with arc-length). These map to `arc`-kind candidates.
  //   - bezier curves: cubic / quad bezier that didn't fit a circular arc.
  //     These map to `curve`-kind candidates.
  // Line + rect primitives are intentionally NOT surfaced here — they're
  // already represented by `analysis.lines` (line-sampled vector geometry)
  // and the closed-polyline detections, so duplicating them would inflate
  // candidate counts.
  //
  // We also drop text-category primitives: those are glyph strokes from
  // dense label regions identified by the Python pipeline's density grid.
  // Without this filter a single text-heavy P&ID surfaces 150k+ candidates
  // that are all character outlines — the reason the user previously saw
  // "159,992 candidates · 95% trash".
  const allPrimitives = analysis?.primitives ?? [];
  const primitives = allPrimitives.filter((p) => (p.category ?? "drawing") !== "text");
  const arcPrimitives = primitives.filter(
    (p) => p.kind === "arc" || p.kind === "circle" || p.kind === "ellipse",
  );
  const curvePrimitives = primitives.filter(
    (p) => p.kind === "cubic_bezier" || p.kind === "quad_bezier",
  );
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

  // Total candidate count uses the same drawing-only filter the section
  // lists use below, so the header number and the list contents agree.
  // (Without this, a text-heavy P&ID's header read "159,992 candidates"
  // while the sections totalled ~6k — the source of the user's
  // "95% trash" complaint.)
  const drawingPrimitiveCount = analysis
    ? (analysis.drawingPrimitiveCount
       ?? (analysis.primitives?.filter((p) => (p.category ?? "drawing") !== "text").length ?? 0))
    : 0;
  const totalCount = analysis
    ? systems.length + lines.length + symbols.length + circles.length
      + arcPrimitives.length + curvePrimitives.length + texts.length
    : 0;

  // Compact settings panel — everything that was previously stacked rows
  // (overlay-toggle chips, pipeline parameters) now lives behind the
  // gear icon. Settings open ≈ "I'm tuning the analysis"; the default
  // collapsed state hands the panel back to the list.
  const settingsBody = (
    <div className="grid gap-2">
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
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg/40">Canvas overlay</p>
        <div className="grid grid-cols-4 gap-1">
          {([
            ["systems", "Systems"],
            ["lines", "Lines"],
            ["symbols", "Symbols"],
            ["circles", "Hough"],
            ["arcs", "Vec arc"],
            ["curves", "Vec curve"],
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
      </div>
      <ClearPickupsDangerZone
        count={snapshot.annotations.length}
        onClear={() => actions?.clearAllAnnotationsForCurrentDocument()}
      />
    </div>
  );

  return (
    <EntitiesPanel
      statusTooltip={analysis
        ? `${drawing.fileName} · ${sourceLabel} · Page ${drawing.pageNumber} · ${analysis.duration_ms.toFixed(0)} ms · ${totalCount.toLocaleString()} item${totalCount === 1 ? "" : "s"}`
        : `${drawing.fileName} · ${sourceLabel} · Page ${drawing.pageNumber} · No run yet`}
      query={query}
      onQueryChange={setQuery}
      queryPlaceholder="Filter line items..."
      primaryAction={{
        label: "Analyze",
        onClick: () => void actions?.runDrawingAnalysis(),
        busy: running,
        title: "Analyze geometry and trace connected systems",
        icon: <ScanSearch className="h-3 w-3" />,
      }}
      settingsContent={settingsBody}
      settingsOpen={showSettings}
      onToggleSettings={onToggleSettings}
      belowSearchContent={drawing.error
        ? (
          <p className="mt-2 rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
            {drawing.error}
          </p>
        )
        : null}
      emptyState={(
        <p className="rounded-md border border-line bg-bg/30 px-3 py-3 text-center text-[11px] text-fg/40">
          Run Analyze to populate pickups from this drawing.
        </p>
      )}
    >
      {analysis ? (
        <div className="space-y-1.5">
          <DetectionGroup
            title="Linear"
            accentColor="#0ea5e9"
            count={systems.length}
            rows={systems.map((system) => {
              const state = linkedStateFor(system.id);
              const idx = systems.indexOf(system) + 1;
              return {
                id: system.id,
                kind: "system" as const,
                source: "drawing-intelligence" as const,
                // Strip the legacy "Detected run N" / "Plumbing run N" /
                // "Mechanical piping run N" prefix that older cached
                // analyses still carry — that label repeats the section
                // name ("Linear") for every row and was the redundant UI
                // the user flagged. Use the first layer name if present,
                // otherwise just the run number.
                title: cleanSystemLabel(system.label, system.layers, idx),
                subtitle: `${system.segmentCount} segments · ${formatDetectedLength(system.lengthPx)} · ${Math.round(system.confidence * 100)}%`,
                detail: [
                  `${system.counts.openEnds} ends`,
                  `${system.counts.tees} tees`,
                  `${system.counts.elbows45 + system.counts.elbows90} elbows`,
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
            title="Counts"
            accentColor="#10b981"
            count={countGroups.length}
            rows={countGroups.map((group) => {
              const states = group.symbolIds.map((id) => linkedStateFor(id));
              const savedCount = states.reduce((sum, state) => sum + state.savedCount, 0);
              const linkCount = states.reduce((sum, state) => sum + state.linkCount, 0);
              return {
                id: group.id,
                kind: "symbol" as const,
                source: "auto-count" as const,
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
              title="Circles"
              accentColor="#ec4899"
              count={circles.length}
              rows={circles.map((circle) => {
                const state = linkedStateFor(circle.id);
                return {
                  id: circle.id,
                  kind: "circle" as const,
                  source: "drawing-intelligence" as const,
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
              title="Lines"
              accentColor="#38bdf8"
              count={lines.length}
              rows={lines.map((line) => {
                const state = linkedStateFor(line.id);
                return {
                  id: line.id,
                  kind: "line" as const,
                  source: "drawing-intelligence" as const,
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
          {arcPrimitives.length > 0 && (
            <DetectionGroup
              title="Arcs"
              accentColor="#f59e0b"
              count={arcPrimitives.length}
              rows={arcPrimitives.map((primitive) => {
                const state = linkedStateFor(primitive.id);
                return {
                  id: primitive.id,
                  kind: "arc" as const,
                  source: "drawing-intelligence" as const,
                  title: primitiveTitle(primitive),
                  subtitle: primitiveSubtitle(primitive, analysis?.coordinateSpace, drawing.calibration),
                  detail: primitiveDetail(primitive),
                  selected: selectedDetectionId === primitive.id,
                  saving: savingId === primitive.id,
                  color: "#f59e0b",
                  // The save handler in takeoff-tab gates ALL arc-bucket
                  // primitives (arc / circle / ellipse) on calibration —
                  // arcs need LF, closed shapes need SF, both require the
                  // drawing scale. Show the visual indicator uniformly.
                  requiresCalibration: !drawing.calibration,
                  ...state,
                };
              }).filter(matchesQuery)}
              snapshot={snapshot}
              actions={actions}
              onSelect={(id) => actions?.selectDrawingDetection(id, "arc")}
              onAdd={(id, _kind, pick) => void actions?.createLineItemFromDrawingDetection(id, "arc", pick)}
              onDelete={(id) => actions?.deleteDrawingDetection(id, "arc")}
            />
          )}
          {curvePrimitives.length > 0 && (
            <DetectionGroup
              title="Curves"
              accentColor="#a855f7"
              count={curvePrimitives.length}
              rows={curvePrimitives.map((primitive) => {
                const state = linkedStateFor(primitive.id);
                return {
                  id: primitive.id,
                  kind: "curve" as const,
                  source: "drawing-intelligence" as const,
                  title: primitiveTitle(primitive),
                  subtitle: primitiveSubtitle(primitive, analysis?.coordinateSpace, drawing.calibration),
                  detail: primitiveDetail(primitive),
                  selected: selectedDetectionId === primitive.id,
                  saving: savingId === primitive.id,
                  color: "#a855f7",
                  requiresCalibration: !drawing.calibration,
                  ...state,
                };
              }).filter(matchesQuery)}
              snapshot={snapshot}
              actions={actions}
              onSelect={(id) => actions?.selectDrawingDetection(id, "curve")}
              onAdd={(id, _kind, pick) => void actions?.createLineItemFromDrawingDetection(id, "curve", pick)}
              onDelete={(id) => actions?.deleteDrawingDetection(id, "curve")}
            />
          )}
          {texts.length > 0 && (
            <DetectionGroup
              title="Text"
              accentColor="#64748b"
              count={texts.length}
              rows={texts.map((region) => ({
                id: region.id,
                kind: "text" as const,
                source: "drawing-intelligence" as const,
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
          {/* Smart count + Manual annotations are not analyzer output, but
              they're the same _concept_ — potential line items. Folding them
              into the same panel as their own groups (rather than separate
              chrome above / below) is the "one unified list" the user
              asked for. Each row carries a source pill so the origin is
              still legible. */}
        </div>
      ) : null}
      {/* Auto/Smart/Manual groups live OUTSIDE the {analysis ? …} guard
          so they show as soon as the user runs Auto Count or Smart Count,
          or draws a manual annotation — without requiring Drawing
          Intelligence to have been triggered first. Each group self-hides
          when its source has no data. */}
      <div className="space-y-1.5">
        <AutoCountGroup snapshot={snapshot} actions={actions} matchesQuery={matchesQuery} />
        <SmartCountGroup snapshot={snapshot} actions={actions} matchesQuery={matchesQuery} />
        <ManualAnnotationsGroup snapshot={snapshot} actions={actions} matchesQuery={matchesQuery} />
      </div>
    </EntitiesPanel>
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

interface EntitiesPanelProps {
  /** Optional plain-language status string surfaced as a tooltip on a small
   *  info dot. Replaces the old in-panel title + detail rows the user asked
   *  us to drop in favour of more list room. Example values:
   *  "PDF vector · Page 1 · 3085 ms" / "All layouts · processed Mar 14". */
  statusTooltip?: string;
  query: string;
  onQueryChange: (next: string) => void;
  queryPlaceholder?: string;
  /** Optional primary action button (e.g. Analyze) shown on the toolbar. */
  primaryAction?: {
    label: string;
    onClick: () => void;
    busy?: boolean;
    title?: string;
    icon?: ReactNode;
  };
  /** Optional settings toggle. Render the settings body as `settingsContent`
   *  and the parent owns the open/closed state. */
  settingsContent?: ReactNode;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  /** Optional inline content rendered between the search row and the list,
   *  e.g. an error banner or status pill. */
  belowSearchContent?: ReactNode;
  /** The list area. Renders inside the same panel chrome as the toolbar so
   *  the surface reads as one component. */
  children?: ReactNode;
  /** Shown when `children` is empty/absent — e.g. a "Run Analyze"
   *  placeholder. Lives inside the same panel chrome as the toolbar. */
  emptyState?: ReactNode;
}

/** Slim opaque panel with a one-line toolbar (search + primary action +
 *  settings) on top of the list area. The "Potential line items" title and
 *  total-count chips that used to live here moved to the tab label ("Line
 *  items") — the user explicitly asked for the inner header to be dropped
 *  so the list dominates the column. PDF and DXF surfaces render through
 *  this so the chrome is consistent. */
function EntitiesPanel({
  statusTooltip,
  query,
  onQueryChange,
  queryPlaceholder = "Filter line items...",
  primaryAction,
  settingsContent,
  settingsOpen,
  onToggleSettings,
  belowSearchContent,
  children,
  emptyState,
}: EntitiesPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-line bg-panel">
      <div className="shrink-0 border-b border-line/40 p-1.5">
        <div className="flex items-center gap-1.5">
          {statusTooltip && (
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-fg/35 hover:text-fg/60"
              title={statusTooltip}
              aria-label={statusTooltip}
            >
              <GitBranch className="h-3 w-3" />
            </span>
          )}
          <Input
            className="h-7 flex-1 text-xs"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={queryPlaceholder}
          />
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              disabled={primaryAction.busy}
              title={primaryAction.title ?? primaryAction.label}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-line bg-bg/40 px-2 text-[10px] font-medium text-fg/70 transition-colors hover:border-sky-500/35 hover:text-sky-500 disabled:opacity-50"
            >
              {primaryAction.busy
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : primaryAction.icon ?? <ScanSearch className="h-3 w-3" />}
              {primaryAction.label}
            </button>
          )}
          {settingsContent && onToggleSettings && (
            <button
              type="button"
              onClick={onToggleSettings}
              title="Settings"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-colors",
                settingsOpen
                  ? "border-sky-500/35 bg-sky-500/10 text-sky-500"
                  : "border-line bg-bg/40 text-fg/50 hover:text-fg/75",
              )}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {settingsContent && settingsOpen && (
          /* Cap height + scroll internally so the toolbar doesn't push the
             list off-screen when the settings panel has lots of controls
             (overlay toggles, sliders, classification axis grids, etc).
             Previously this expanded indefinitely and overflowed the
             column. */
          <div className="mt-1.5 max-h-[50vh] overflow-auto rounded-md border border-line/70 bg-bg/35 p-2">
            {settingsContent}
          </div>
        )}
        {belowSearchContent}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {children ?? emptyState}
      </div>
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

/** Where a candidate line-item came from. Surfaced as a pill on every row
 *  so the estimator can tell at a glance whether the row was inferred by
 *  the analyzer, auto-counted from repeated symbols, hand-drawn, or
 *  read directly from a CAD layer. The pill is the user's "source"
 *  vocabulary; the group header above it tells them the geometric TYPE
 *  (Linear / Counts / Arcs / etc.). */
type LineItemSource =
  | "drawing-intelligence"
  | "auto-count"
  | "smart-count"
  | "manual"
  | "cad"
  | "bim"
  | "spreadsheet"
  | "photo-bom";

const SOURCE_PILL_TEXT: Record<LineItemSource, string> = {
  "drawing-intelligence": "Drawing intelligence",
  "auto-count": "Auto count",
  "smart-count": "Smart count",
  manual: "Manual",
  cad: "CAD",
  bim: "BIM",
  spreadsheet: "Spreadsheet",
  "photo-bom": "Photo BOM",
};

/** Row "kind" is intentionally widened beyond DrawingDetectionKind because
 *  Manual + Smart count rows ride through the same shape now. The kind
 *  only matters for actions that genuinely need it — the row renderer
 *  itself just trusts the caller-bound `onAdd` / `onDelete`. */
type DetectionRow = {
  id: string;
  kind: InspectDrawingDetectionKind | "manual" | "smart" | "cad-entity" | "model" | "spreadsheet-row" | "photo-bom-row";
  source: LineItemSource;
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
  /** Optional preview image (data URI or remote URL) rendered as a small
   *  thumbnail on the left of the row. Used today by Auto Count rows to
   *  surface the user-drawn template, by Smart Count rows for the AI's
   *  crop, and by Photo BOM rows for the source photo. */
  thumbnail?: string | null;
  /** Optional per-match panel rendered when the row is expanded — used by
   *  Auto Count rows to show every match's thumbnail + a checkbox so the
   *  estimator can deselect false positives before promoting the bundle
   *  to a worksheet line item. The N indexes here align with the bundled
   *  annotation's `metadata.matches`; toggling fires
   *  `actions.toggleAutoCountMatch(pickupId, matchIndex)`. */
  matchExpansion?: {
    /** Annotation id passed back through the toggle callback. */
    pickupId: string;
    matches: Array<{
      image: string | null;
      confidence: number;
      included: boolean;
    }>;
  };
};

function DetectionGroup({
  title,
  count,
  rows,
  icon,
  accentColor,
  snapshot,
  actions,
  onSelect,
  onAdd,
  onDelete,
  groupAction,
}: {
  /** Short type label — "Linear", "Counts", "Arcs", etc. NOT "X candidates"
   *  — every row across every section is already a potential line item per
   *  the panel header, so the section label is just the source type. */
  title: string;
  count: number;
  rows: DetectionRow[];
  icon?: React.ReactNode;
  /** Type-color dot rendered in the section header so the grouping reads at a
   *  glance and lines up with the row dots beneath it. Match the row color. */
  accentColor?: string;
  snapshot: InspectSnapshot;
  actions: InspectActions | null;
  onSelect: (id: string) => void;
  /** kind passed to onAdd / onDelete is the row's own — callers can ignore
   *  it when their data source has a single fixed action. Widened to
   *  string so manual / smart / cad-entity row kinds flow through. */
  onAdd?: (id: string, kind: DetectionRow["kind"], pick: InspectCategoryPick) => void;
  onDelete?: (id: string, kind: DetectionRow["kind"]) => void;
  /** Optional "Σ Add" on the section header — adds one summed line item
   *  from ALL rows in the group. Used by the BIM model classification
   *  groups (Uniformat / MasterFormat / etc.) so the estimator can roll
   *  up an entire bucket in one click. */
  groupAction?: {
    triggerTitle: string;
    onPick: (pick: InspectCategoryPick) => void;
  };
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Per-row expansion state for the match-detail panel (Auto Count). Stored
  // here so toggling an expand chevron only affects that one row — multiple
  // rows can be expanded simultaneously which is what an estimator wants
  // when comparing matches across symbols.
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(new Set());
  const toggleRowExpansion = (id: string) => {
    setExpandedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const shownCount = rows.length;
  return (
    <section>
      {/* Section header reads as a TYPE LABEL inside the panel's "Potential
          line items" identity, not as a competing heading. Uppercase tiny
          caps + low-contrast color keep the panel header dominant; the
          colored dot lines up with each row's dot below. */}
      <div className="group/grouphdr flex items-stretch">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-[9px] font-medium uppercase tracking-wider text-fg/45 hover:bg-panel2/50"
        >
          {collapsed ? <ChevronRight className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
          {accentColor && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: accentColor }}
              aria-hidden
            />
          )}
          {icon}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span className="font-mono text-[9px] tabular-nums text-fg/30">
            {shownCount === count ? count.toLocaleString() : `${shownCount.toLocaleString()}/${count.toLocaleString()}`}
          </span>
        </button>
        {groupAction && (
          <AddToCategoryPopover
            snapshot={snapshot}
            actions={actions}
            onPick={groupAction.onPick}
            triggerLabel="Σ Add"
            triggerClassName="ml-1 inline-flex shrink-0 items-center gap-1 rounded-sm px-1 text-[9px] font-medium uppercase tracking-wider text-fg/40 opacity-0 transition-opacity hover:bg-accent/10 hover:text-accent group-hover/grouphdr:opacity-100 focus:opacity-100"
            triggerTitle={groupAction.triggerTitle}
            triggerIcon={<Sigma className="h-2.5 w-2.5" />}
          />
        )}
      </div>
      {!collapsed && (
        <div className="ml-2 space-y-0.5">
          {rows.length === 0 ? (
            <p className="rounded-md border border-line bg-bg/25 px-2 py-2 text-center text-[10px] text-fg/35">None found</p>
          ) : rows.map((row) => {
            const expanded = expandedRowIds.has(row.id);
            return (
            <Fragment key={row.id}>
            <div
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
              {row.thumbnail ? (
                /* Tiny preview thumbnail — used by Auto Count rows
                   (user-drawn template), Smart Count rows (AI crop), Photo
                   BOM rows (source photo). White bg + thin border so a
                   transparent PNG / line-drawing crop stays legible against
                   the panel background. */
                <div
                  className="h-8 w-8 shrink-0 rounded border border-line/60 bg-white p-0.5"
                  title={row.title}
                >
                  <img
                    src={row.thumbnail}
                    alt={row.title}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : (
                <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="truncate text-[11px] font-medium text-fg/80">{row.title}</p>
                  {/* Source pill — tells the estimator whether the row was
                      derived from analyzer, auto-counted, smart-counted,
                      hand-drawn, or read from a CAD layer. */}
                  <span
                    className="inline-flex shrink-0 items-center rounded-full border border-line/60 bg-bg/40 px-1 py-0.5 text-[8.5px] font-medium uppercase tracking-wide text-fg/45"
                    title={`Source: ${SOURCE_PILL_TEXT[row.source]}`}
                  >
                    {SOURCE_PILL_TEXT[row.source]}
                  </span>
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
                {row.matchExpansion && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleRowExpansion(row.id);
                    }}
                    title={expanded ? "Hide individual matches" : "Show individual matches"}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg/40 transition-colors hover:bg-accent/10 hover:text-accent"
                  >
                    {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                )}
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
                      onPick={(pick) => onAdd(row.id, row.kind, pick)}
                      triggerLabel="Add"
                      triggerClassName="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-bg/50 px-1.5 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent"
                      triggerTitle="Add this line item to a worksheet"
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
                  title="Delete this pickup"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg/35 transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
              <LocateFixed className="h-3 w-3 shrink-0 text-fg/25 group-hover:text-accent" />
              </div>
            </div>
            {row.matchExpansion && expanded && (
              /* Per-match panel — grid of thumbnails the user can deselect.
                 Clicking a thumbnail toggles its inclusion via
                 actions.toggleAutoCountMatch; the parent row's count +
                 worksheet promotion update accordingly. */
              <div className="ml-6 rounded-md border border-line/70 bg-bg/30 p-1.5">
                <div className="mb-1 flex items-center justify-between text-[9px] uppercase tracking-wider text-fg/40">
                  <span>Matches</span>
                  <span className="font-mono normal-case tracking-normal text-fg/35">
                    {row.matchExpansion.matches.filter((m) => m.included).length} / {row.matchExpansion.matches.length} included
                  </span>
                </div>
                <div className="grid grid-cols-6 gap-1 sm:grid-cols-8">
                  {row.matchExpansion.matches.map((match, idx) => {
                    const annId = row.matchExpansion!.pickupId;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          actions?.toggleAutoCountMatch(annId, idx);
                        }}
                        className={cn(
                          "relative aspect-square overflow-hidden rounded border bg-white p-0.5 transition-all",
                          match.included
                            ? "border-emerald-500/40 hover:border-emerald-500/70"
                            : "border-line/40 opacity-30 hover:opacity-60",
                        )}
                        title={`Match #${idx + 1} · ${(match.confidence * 100).toFixed(0)}% · click to ${match.included ? "exclude" : "include"}`}
                      >
                        {match.image ? (
                          <img src={match.image} alt={`Match ${idx + 1}`} className="h-full w-full object-contain" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-[9px] text-fg/30">
                            #{idx + 1}
                          </span>
                        )}
                        {!match.included && (
                          <span className="absolute inset-0 flex items-center justify-center bg-bg/40">
                            <X className="h-3 w-3 text-fg/60" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            </Fragment>
            );
          })}
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
  const [showSettings, setShowSettings] = useState(false);

  // Group elements by the selected axis. Same logic as before — only the
  // rendering changed: grouped output goes through DetectionGroup so the
  // BIM panel reads identically to the PDF/DXF panels (one EntitiesPanel
  // wrapper, type-labelled DetectionGroup sections, source pill per row).
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
    return Array.from(groups.values()).sort((a, b) => {
      const aUn = a.key.startsWith("__unclassified__") ? 1 : 0;
      const bUn = b.key.startsWith("__unclassified__") ? 1 : 0;
      if (aUn !== bUn) return aUn - bUn;
      return a.key.localeCompare(b.key);
    });
  }, [modelElements, groupBy]);

  const settingsBody = (
    <div className="grid gap-2">
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg/40">Basis</p>
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
      </div>
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg/40">Group by</p>
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-panel p-1">
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setGroupBy(opt.id)}
              className={cn(
                "rounded px-1.5 py-1 text-[10px] font-medium transition-colors",
                groupBy === opt.id ? "bg-accent/15 text-accent" : "text-fg/45 hover:text-fg/70",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const rowFor = (element: InspectModelElement): DetectionRow => {
    const uniformat = element.classification?.uniformat?.trim();
    const masterformat = element.classification?.masterformat?.trim();
    const lod = element.lod?.trim();
    const classification = [
      uniformat ? `UF ${uniformat}` : "",
      masterformat ? `MF ${masterformat}` : "",
      lod ? `LOD ${lod}` : "",
    ].filter(Boolean).join(" · ");
    return {
      id: element.id,
      kind: "model" as const,
      source: "bim" as const,
      title: element.name || element.externalId,
      subtitle: [element.elementClass, element.material, element.level].filter(Boolean).join(" · ") || "Model element",
      detail: classification || undefined,
      value: element.quantitySummary,
      selected: selectedModelElementId === element.id,
      saving: false,
      savedCount: element.isLinked ? 1 : 0,
      linkCount: element.isLinked ? 1 : 0,
      color: "#a78bfa",
    };
  };

  const onSelect = (id: string) => actions?.selectModelElement(selectedModelElementId === id ? null : id);
  const onAdd = (id: string, _kind: DetectionRow["kind"], pick: InspectCategoryPick) =>
    void actions?.createLineItemFromElement(id, pick);

  const totalCount = modelElements.length;
  const linkedCount = modelElements.filter((e) => e.isLinked).length;

  return (
    <EntitiesPanel
      statusTooltip={`${modelAsset?.fileName || "Model"} · ${totalCount.toLocaleString()} element${totalCount === 1 ? "" : "s"}${linkedCount > 0 ? ` · ${linkedCount.toLocaleString()} linked` : ""}`}
      query={modelSearch}
      onQueryChange={(value) => actions?.setModelSearch(value)}
      queryPlaceholder="Search objects, classes, materials..."
      primaryAction={{
        label: "Sync",
        onClick: () => actions?.refreshModel(),
        busy: modelSyncing,
        title: "Sync the model index from disk",
        icon: <RefreshCw className="h-3 w-3" />,
      }}
      settingsContent={settingsBody}
      settingsOpen={showSettings}
      onToggleSettings={() => setShowSettings((value) => !value)}
      belowSearchContent={modelError
        ? (
          <p className="mt-2 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[10px] text-danger">
            {modelError}
          </p>
        )
        : null}
      emptyState={
        modelElementsLoading && modelElements.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-4 text-[11px] text-fg/40">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : (
          <p className="rounded-md border border-line bg-bg/30 px-3 py-4 text-center text-[11px] text-fg/40">
            {modelAsset ? "No model objects match this search." : "Sync the model index to list model objects."}
          </p>
        )
      }
    >
      {modelElements.length === 0 ? null : groupedElements ? (
        <div className="space-y-1.5">
          {groupedElements.map((group) => (
            <DetectionGroup
              key={group.key}
              title={group.label}
              accentColor="#a78bfa"
              count={group.elements.length}
              rows={group.elements.map(rowFor)}
              snapshot={snapshot}
              actions={actions}
              onSelect={onSelect}
              onAdd={onAdd}
              groupAction={{
                triggerTitle: `Add one summed line item from all ${group.elements.length} elements in ${group.label}`,
                onPick: (pick) => void actions?.createLineItemFromElementGroup(
                  group.elements.map((el) => el.id),
                  group.label,
                  pick,
                ),
              }}
            />
          ))}
        </div>
      ) : (
        <DetectionGroup
          title="Model elements"
          accentColor="#a78bfa"
          count={modelElements.length}
          rows={modelElements.map(rowFor)}
          snapshot={snapshot}
          actions={actions}
          onSelect={onSelect}
          onAdd={onAdd}
        />
      )}
    </EntitiesPanel>
  );
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
  const [query, setQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // Filter is done by haystack-substring on every value cell. Same shape as
  // the other surfaces (the EntitiesPanel toolbar owns the input).
  const filteredRows = useMemo(() => {
    if (!ss) return [];
    const q = query.trim().toLowerCase();
    if (!q) return ss.rows;
    return ss.rows.filter((row) =>
      Object.values(row.values).some((v) => v.toLowerCase().includes(q)),
    );
  }, [ss, query]);

  if (!ss) {
    return (
      <EntitiesPanel
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="Filter rows…"
        emptyState={(
          <p className="rounded-md border border-line bg-bg/30 px-3 py-4 text-center text-[11px] text-fg/40">
            Open a spreadsheet to list its rows here.
          </p>
        )}
      />
    );
  }

  const { mapping } = ss;
  const isPivotMode = ss.mode === "pivot";
  const totalRows = ss.rows.length;
  const linkedNote = ss.pivot
    ? `pivoted by ${ss.pivot.groupBy}/${ss.pivot.measureLabel}, ${ss.pivot.groupCount.toLocaleString()} groups from ${ss.pivot.sourceRowCount.toLocaleString()} rows`
    : "";

  const settingsBody = (
    <div className="grid gap-2">
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-fg/40">Column mapping</p>
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
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
      {ss.pivot && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-700">
          <div className="font-medium">Pivoted by {ss.pivot.groupBy} / {ss.pivot.measureLabel}</div>
          <div className="mt-0.5 text-emerald-700/70">
            {ss.pivot.groupCount.toLocaleString()} groups from {ss.pivot.sourceRowCount.toLocaleString()} source rows
          </div>
        </div>
      )}
    </div>
  );

  const rows: DetectionRow[] = filteredRows.map((row) => {
    const displayName = mapping.name ? row.values[mapping.name] : "";
    const qtyVal = mapping.quantity ? row.values[mapping.quantity] : "";
    const uomVal = mapping.uom ? row.values[mapping.uom] : "";
    const costVal = mapping.cost ? row.values[mapping.cost] : "";
    const pivot = row.pivot;
    const subtitle = pivot
      ? [
          qtyVal && `${qtyVal}`,
          `${pivot.sourceRowCount.toLocaleString()} rows`,
          `avg ${numericFormat(pivot.average)}`,
        ].filter(Boolean).join(" · ")
      : [
          qtyVal && `${qtyVal}${uomVal ? ` ${uomVal}` : ""}`,
          costVal && `@ ${costVal}`,
        ].filter(Boolean).join(" · ") || "—";
    return {
      id: row.id,
      kind: "spreadsheet-row" as const,
      source: "spreadsheet" as const,
      title: (displayName || `Row ${row.index + 1}`).toString().trim(),
      subtitle,
      value: qtyVal && uomVal ? `${qtyVal} ${uomVal}` : (qtyVal || undefined),
      selected: false,
      saving: false,
      savedCount: 0,
      linkCount: 0,
      color: "#10b981",
    };
  });

  return (
    <EntitiesPanel
      statusTooltip={`${ss.sourceName} · ${totalRows.toLocaleString()} row${totalRows === 1 ? "" : "s"}${linkedNote ? ` · ${linkedNote}` : ""}`}
      query={query}
      onQueryChange={setQuery}
      queryPlaceholder="Filter rows…"
      settingsContent={settingsBody}
      settingsOpen={showSettings}
      onToggleSettings={() => setShowSettings((v) => !v)}
      emptyState={(
        <p className="rounded-md border border-line bg-bg/30 px-3 py-4 text-center text-[11px] text-fg/40">
          {ss.rows.length === 0 ? "No rows in this spreadsheet yet." : "No rows match the filter."}
        </p>
      )}
    >
      {rows.length > 0 && (
        <DetectionGroup
          title={isPivotMode ? "Pivot groups" : "Rows"}
          accentColor="#10b981"
          count={totalRows}
          rows={rows}
          snapshot={snapshot}
          actions={actions}
          onSelect={() => {}}
          onAdd={(id, _kind, pick) => {
            const row = ss.rows.find((r) => r.id === id);
            if (row) void actions?.createLineItemFromSpreadsheetRow(row.index, pick);
          }}
          groupAction={{
            triggerTitle: isPivotMode
              ? "Create one worksheet line item per pivot group"
              : "Import every row as its own worksheet line item",
            onPick: (pick) => void actions?.createLineItemsFromAllSpreadsheetRows(pick),
          }}
        />
      )}
    </EntitiesPanel>
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
  const [query, setQuery] = useState("");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  if (!bom) return null;

  const filteredRows = bom.rows.filter((row) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      row.description.toLowerCase().includes(q) ||
      row.notes.toLowerCase().includes(q) ||
      row.uom.toLowerCase().includes(q)
    );
  });

  const rows: DetectionRow[] = filteredRows.map((row) => {
    const confPct = Math.round(row.confidence * 100);
    return {
      id: row.id,
      kind: "photo-bom-row" as const,
      source: "photo-bom" as const,
      title: row.description,
      subtitle: [
        `${row.quantity} ${row.uom}`,
        row.sourcePhotoNames.length > 0 ? `from ${row.sourcePhotoNames.join(", ")}` : "",
        `confidence ${confPct}%`,
      ].filter(Boolean).join(" · "),
      detail: row.notes
        ? (row.notes.length > 110 ? `${row.notes.slice(0, 108)}…` : row.notes)
        : undefined,
      value: `${row.quantity} ${row.uom}`,
      selected: false,
      saving: false,
      savedCount: row.isLinked ? 1 : 0,
      linkCount: row.isLinked ? 1 : 0,
      // Source photo as the row preview — confirms what the AI was looking
      // at when it inferred this BOM row.
      thumbnail: row.sourcePhotoThumbnail ?? null,
      color: row.confidence >= 0.75
        ? "#10b981"
        : row.confidence >= 0.5
          ? "#f59e0b"
          : "#f43f5e",
    };
  });

  const unlinkedCount = bom.rows.filter((r) => !r.isLinked).length;
  const status = [
    `${bom.photoCount} photo${bom.photoCount === 1 ? "" : "s"}`,
    `${bom.rows.length} item${bom.rows.length === 1 ? "" : "s"}`,
    bom.warnings.length > 0 ? `${bom.warnings.length} warning${bom.warnings.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <EntitiesPanel
      statusTooltip={`Photo BOM · ${status}${bom.summary ? ` · ${bom.summary}` : ""}`}
      query={query}
      onQueryChange={setQuery}
      queryPlaceholder="Filter rows…"
      primaryAction={confirmingDiscard
        ? {
            label: "Confirm discard",
            onClick: () => { actions?.clearPhotoBomResults(); setConfirmingDiscard(false); },
            title: "Confirm discarding these AI results",
            icon: <Trash2 className="h-3 w-3" />,
          }
        : {
            label: "Discard",
            onClick: () => setConfirmingDiscard(true),
            title: "Discard these AI results",
            icon: <X className="h-3 w-3" />,
          }}
      belowSearchContent={
        (bom.summary || bom.warnings.length > 0) ? (
          <div className="mt-2 max-h-28 space-y-1 overflow-auto rounded-md border border-line/70 bg-bg/35 px-2 py-1.5 pr-1">
            {bom.summary && (
              <p className="text-[10px] leading-relaxed text-fg/70">{bom.summary}</p>
            )}
            {bom.warnings.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5 px-1.5 py-1 text-[10px] text-warning">
                {bom.warnings.map((w, i) => (
                  <p key={i}>· {w}</p>
                ))}
              </div>
            )}
          </div>
        ) : null
      }
      emptyState={(
        <p className="rounded-md border border-line bg-bg/30 px-3 py-4 text-center text-[11px] text-fg/40">
          {bom.rows.length === 0 ? "No items returned." : `No items match "${query}".`}
        </p>
      )}
    >
      {rows.length > 0 && (
        <DetectionGroup
          title="Photo BOM"
          accentColor="#f59e0b"
          count={bom.rows.length}
          rows={rows}
          snapshot={snapshot}
          actions={actions}
          onSelect={() => {}}
          onAdd={(id, _kind, pick) => void actions?.createLineItemFromPhotoBomRow(id, pick)}
          groupAction={{
            triggerTitle: `Add all ${unlinkedCount} unlinked rows under one category`,
            onPick: (pick) => void actions?.createLineItemsFromAllPhotoBomRows(pick),
          }}
        />
      )}
    </EntitiesPanel>
  );
}

/** Pivot-style summary for a group of annotations — surfaces the dominant
 *  dimension's total alongside the row count in the group header. Returns
 *  null when the group is mixed (no useful sum) or empty. */

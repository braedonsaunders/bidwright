"use client";

import { useState, useRef, useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  Expand,
  Shrink,
  ExternalLink,
  RefreshCw,
  Scan,
  Minus,
  MousePointer2,
  Plus,
  Ruler,
  Square,
  Target,
  Triangle,
  Spline,
  Scaling,
  Sparkles,
  ArrowDownToLine,
  ScanSearch,
  Loader2,
  X,
  Crosshair,
  RotateCcw,
  BookOpen,
  BrainCircuit,
  Wand2,
  FileJson,
  FileSpreadsheet,
  Files,
  FolderOpen,
  GitCompare,
  Search,
  AlertCircle,
  Pentagon,
  CircleDashed,
  RectangleVertical,
  Tally5,
  MessageSquarePlus,
  Cloud,
  MoveRight,
  Highlighter,
  StretchHorizontal,
  Trash2,
  Box,
  Boxes,
  Camera,
  Undo2,
  Redo2,
  GitBranch,
  Save,
} from "lucide-react";
import type {
  CreateWorksheetItemInput,
  FileNode,
  ImportPreviewResponse,
  ProjectWorkspaceData,
  VisionMatch,
  VisionBoundingBox,
  TakeoffLinkRecord,
  ModelAsset,
  ModelElement,
  ModelQuantity,
  ModelTakeoffLinkRecord,
  DrawingAnalysisPreset,
  DrawingGeometryAnalysisResult,
  DrawingLineSegment,
  DrawingSymbolCandidate,
  DrawingTracedSystem,
} from "@/lib/api";
import {
  listTakeoffAnnotations,
  createTakeoffAnnotation,
  updateTakeoffAnnotation,
  deleteTakeoffAnnotation,
  getDocumentDownloadUrl,
  getFileDownloadUrl,
  getBookFileUrl,
  listKnowledgeBooks,
  runVisionCountSymbols,
  runVisionCropRegion,
  runVisionCountAllPages,
  saveVisionCrop,
  askAi,
  listTakeoffLinks,
  createTakeoffLink,
  createModelTakeoffLink,
  deleteModelTakeoffLink,
  deleteWorksheetItem,
  createWorksheetItem,
  createWorksheet,
  getEntityCategories,
  listModelTakeoffLinks,
  queryModelElements,
  listModelAssets,
  syncModelAssets,
  updateWorksheetItem,
  updateWorkspaceState,
  apiRequest,
  analyzeDrawingGeometry,
  saveDrawingDetectionsAsAnnotations,
  traceDrawingSystems,
  detectTitleBlockScale,
  extractLegendFromPage,
  getFileTree,
  importPreview,
  type DetectedDisciplineRecord,
  type DetectedScaleRecord,
  type EntityCategory,
  type LegendEntryRecord,
  type WorkspaceStateRecord,
  type PhotoTakeoffResult,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Separator,
} from "@/components/ui";
import * as RadixSelect from "@radix-ui/react-select";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { postWorkspaceMutation } from "@/lib/workspace-sync";
import type { Calibration, Point } from "@/lib/takeoff-math";
import { isBidwrightEditableModel } from "./editors/bidwright-model-editor";
import type {
  BidwrightModelLineItemDraft,
  BidwrightModelLinkedLineItem,
  BidwrightModelSelectionMessage,
} from "./editors/bidwright-model-editor";
const PdfCanvasViewer = dynamic(
  () => import("./takeoff/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false }
);
const CadViewer = dynamic(
  () => import("./editors/cad-viewer").then((m) => ({ default: m.CadViewer })),
  { ssr: false }
);
const DwgTakeoffSurface = dynamic(
  () => import("./dwg-takeoff-surface").then((m) => ({ default: m.DwgTakeoffSurface })),
  { ssr: false }
);
const BidwrightModelEditor = dynamic(
  () => import("./editors/bidwright-model-editor").then((m) => ({ default: m.BidwrightModelEditor })),
  { ssr: false }
);
import {
  AnnotationCanvas,
  type TakeoffAnnotation,
} from "./takeoff/annotation-canvas";
import { AnnotationSidebar } from "./takeoff/annotation-sidebar";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  CreateAnnotationModal,
  type AnnotationConfig,
} from "./takeoff/create-annotation-modal";

const DWG_EXTENSIONS = new Set(["dwg", "dxf"]);
/** Semantic, element-aware building information formats. These carry typed
 *  schema (IFC properties, Revit families, Navisworks federation) and drive
 *  the BIM-takeoff workflow (element table, Pset filtering, classification). */
const BIM_EXTENSIONS = new Set(["ifc", "rvt", "nwd", "nwf", "nwc", "rfa"]);
/** Geometry-only formats: parametric solids (STEP/IGES/BREP) plus visualization
 *  meshes (STL/OBJ/FBX/glTF/etc). No element semantics — visualization and
 *  bbox/area/volume metrics only. STEP/BREP can be edited in the parametric model editor. */
const MESH_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl", "obj", "fbx", "gltf", "glb", "3ds", "dae"]);
/** Union — kept for backwards compatibility with helpers/registries that ask
 *  "is this any kind of 3D model file?". New code should branch on BIM vs MESH. */
const MODEL_EXTENSIONS = new Set([...BIM_EXTENSIONS, ...MESH_EXTENSIONS]);
const CAD_EXTENSIONS = new Set([...MODEL_EXTENSIONS, ...DWG_EXTENSIONS]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "tsv", "xls", "xlsx", "xlsm"]);
/** Image file extensions usable for the Site Photos intake. Mirrors what
 *  the photo-takeoff service accepts (JPG / PNG / WebP / HEIC / HEIF / TIFF)
 *  so the count on the intake card matches the number of photos a user could
 *  actually feed into a BOM run. */
const PHOTO_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "tif", "tiff"]);

const DRAWING_ANALYSIS_PRESETS: Array<{ value: DrawingAnalysisPreset; label: string }> = [
  { value: "generic", label: "General" },
  { value: "mechanical_piping", label: "Piping" },
  { value: "plumbing", label: "Plumbing" },
  { value: "fire_protection", label: "Fire protection" },
  { value: "ductwork", label: "Ductwork" },
  { value: "electrical", label: "Electrical" },
  { value: "civil_linear", label: "Civil linear" },
  { value: "structural", label: "Structural" },
];

type DrawingAnalysisOverlayState = {
  lines: boolean;
  systems: boolean;
  symbols: boolean;
  circles: boolean;
  text: boolean;
};

type TakeoffHistoryCommand =
  | { kind: "create"; annotation: TakeoffAnnotation }
  | { kind: "delete"; annotation: TakeoffAnnotation }
  | { kind: "clear"; annotations: TakeoffAnnotation[] };

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function isDwgFile(fileName: string): boolean {
  return DWG_EXTENSIONS.has(getFileExtension(fileName));
}

function isBimFile(fileName: string): boolean {
  return BIM_EXTENSIONS.has(getFileExtension(fileName));
}

function isMeshFile(fileName: string): boolean {
  return MESH_EXTENSIONS.has(getFileExtension(fileName));
}

function isCadFile(fileName: string): boolean {
  return CAD_EXTENSIONS.has(getFileExtension(fileName));
}

function isPdfSource(fileName: string, fileType?: string | null): boolean {
  return fileName.toLowerCase().endsWith(".pdf") || fileType === "pdf" || fileType === "application/pdf";
}

function isSpreadsheetFile(fileName: string): boolean {
  return SPREADSHEET_EXTENSIONS.has(getFileExtension(fileName));
}

function isPhotoFile(fileName: string): boolean {
  return PHOTO_EXTENSIONS.has(getFileExtension(fileName));
}

/* ─── Tool definitions ─── */

type ToolId =
  | "select"
  | "calibrate"
  | "linear"
  | "linear-polyline"
  | "linear-drop"
  | "area-rectangle"
  | "area-polygon"
  | "area-triangle"
  | "area-ellipse"
  | "area-vertical-wall"
  | "count"
  | "count-by-distance"
  | "auto-count"
  | "markup-note"
  | "markup-cloud"
  | "markup-arrow"
  | "markup-highlight"
  | "ask-ai"
  | "smart-count";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: typeof Ruler;
  group: "nav" | "setup" | "measure" | "area" | "count" | "markup" | "ai";
}

const TOOLS: ToolDef[] = [
  /* Navigate */
  { id: "select",             label: "Select",            icon: MousePointer2,    group: "nav" },
  /* Setup */
  { id: "calibrate",          label: "Calibrate",         icon: Scaling,          group: "setup" },
  /* Measure */
  { id: "linear",             label: "Linear",            icon: Ruler,            group: "measure" },
  { id: "linear-polyline",    label: "Polyline",          icon: Spline,           group: "measure" },
  { id: "linear-drop",        label: "Linear Drop",       icon: ArrowDownToLine,  group: "measure" },
  /* Area */
  { id: "area-rectangle",     label: "Rectangle",         icon: Square,           group: "area" },
  { id: "area-polygon",       label: "Polygon",           icon: Pentagon,         group: "area" },
  { id: "area-triangle",      label: "Triangle",          icon: Triangle,         group: "area" },
  { id: "area-ellipse",       label: "Ellipse",           icon: CircleDashed,     group: "area" },
  { id: "area-vertical-wall", label: "Vertical Wall",     icon: RectangleVertical, group: "area" },
  /* Count */
  { id: "count",              label: "Count",             icon: Target,           group: "count" },
  { id: "count-by-distance",  label: "Count by Distance", icon: Tally5,           group: "count" },
  { id: "auto-count",         label: "Auto Count",        icon: ScanSearch,       group: "count" },
  /* Markup */
  { id: "markup-note",        label: "Note",              icon: MessageSquarePlus, group: "markup" },
  { id: "markup-cloud",       label: "Cloud",             icon: Cloud,            group: "markup" },
  { id: "markup-arrow",       label: "Arrow",             icon: MoveRight,        group: "markup" },
  { id: "markup-highlight",   label: "Highlight",         icon: Highlighter,      group: "markup" },
  /* AI */
  { id: "ask-ai",             label: "Ask AI",            icon: BrainCircuit,     group: "ai" },
  { id: "smart-count",        label: "Smart Count",       icon: Wand2,            group: "ai" },
];

const TOOL_GROUPS = [
  { key: "nav",     label: "Navigate" },
  { key: "setup",   label: "Setup" },
  { key: "measure", label: "Measure" },
  { key: "area",    label: "Area" },
  { key: "count",   label: "Count" },
  { key: "markup",  label: "Markup" },
  { key: "ai",      label: "AI" },
] as const;

/* ─── Status bar text for each tool ─── */

const TOOL_STATUS_TEXT: Record<string, string> = {
  select: "Click to select takeoff marks. Press Escape to deselect.",
  calibrate: "Click two points on a known distance, then enter the real measurement.",
  linear: "Click two points to measure distance.",
  "linear-polyline": "Click to add points. Double-click to finish.",
  "linear-drop": "Click to add points with drops. Double-click to finish.",
  "area-rectangle": "Click and drag to draw a rectangle.",
  "area-polygon": "Click to add vertices. Double-click to close polygon.",
  "area-triangle": "Click three points to define a triangle.",
  "area-ellipse": "Click and drag to draw an ellipse.",
  "area-vertical-wall": "Click to add wall vertices. Double-click to finish.",
  count: "Click to place count markers.",
  "count-by-distance": "Click to add points. Double-click to finish counting.",
  "auto-count": "Draw a rectangle around a symbol to find all occurrences.",
  "markup-note": "Click to place a note. Edit text in the sidebar.",
  "markup-cloud": "Click to add cloud vertices. Double-click to close.",
  "markup-arrow": "Click and drag to draw an arrow.",
  "markup-highlight": "Click and drag to highlight a region.",
  "ask-ai": "Draw a rectangle to select a region for AI analysis.",
  "smart-count": "Draw a rectangle around a room or zone — AI counts every distinct symbol inside.",
};

/* ─── Unified document entry for the takeoff selector ─── */

interface TakeoffDocument {
  id: string;
  label: string;
  source: "project" | "knowledge";
  kind: "pdf" | "bim" | "model" | "dwg" | "spreadsheet";
  fileName: string;
  /** For project docs – use getDocumentDownloadUrl */
  projectId?: string;
  fileNodeId?: string;
  modelAssetId?: string;
  /** For knowledge books – use getBookFileUrl */
  bookId?: string;
}

import type { TakeoffSelection } from "./takeoff-link-view";
import type {
  InspectActions,
  InspectCategoryPick,
  InspectModelElement,
  InspectRateScheduleItemOption,
  InspectSnapshot,
} from "./takeoff-inspect-view";
// BimFederationSwitcher + ModelFederation schema/API ship dormant — the
// federation concept is over-scoped for the everyday estimator workflow.
// Schema, API endpoints, and the switcher component stay in the codebase
// for future "advanced" surface; we just don't mount it in the BIM picker.
import { SitePhotoIntake, type PhotoSource } from "./site-photo-intake";
import { CreateWorksheetModal } from "./modals";

const MIN_PDF_ZOOM = 0.25;
const MAX_PDF_ZOOM = 5;

function roundPdfZoom(value: number) {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.max(MIN_PDF_ZOOM, Math.min(MAX_PDF_ZOOM, value));
  return Math.round(clamped * 100) / 100;
}

type WebKitGestureEvent = Event & {
  scale?: number;
  clientX?: number;
  clientY?: number;
};

interface TakeoffTabProps {
  workspace: ProjectWorkspaceData;
  onOpenAgentChat?: (prefill?: string) => void;
  onOpenRevisionDiff?: () => void;
  onWorkspaceMutated?: () => void;
  initialDocumentId?: string | null;
  initialPage?: number;
  detached?: boolean;
  workspaceSyncOriginId?: string;
  selectedWorksheetId?: string | null;
  /** Externally-controlled selection (e.g. when a parent renders the link UI). */
  selection?: TakeoffSelection | null;
  onSelectionChange?: (selection: TakeoffSelection | null) => void;
  /** Mirror of the current annotations array, for parents that need to render them. */
  onAnnotationsChange?: (annotations: TakeoffAnnotation[]) => void;
  /** Incrementing counter — when it changes, takeoff reloads its links from the server. */
  linksReloadSignal?: number;
  /** Called whenever this tab mutates links so the parent can re-fetch its own copy. */
  onLinksMutated?: () => void;
  /** A ref the parent provides; this tab populates it with its model
   *  send-to-estimate handler so a sibling component (the side-panel link view)
   *  can trigger the flow without lifting all of TakeoffTab's state. */
  modelSendToEstimateRef?: React.MutableRefObject<
    ((selection: BidwrightModelSelectionMessage) => Promise<void> | void) | null
  >;
  /** A ref this tab populates with the per-element line-item creation flow. */
  modelElementCreateLineItemRef?: React.MutableRefObject<
    ((elementId: string) => Promise<void> | void) | null
  >;
  /** A ref the parent owns; this tab populates it with action callbacks the
   *  side-panel Inspect tab can drive (toggle visibility, delete, edit, etc.). */
  inspectActionsRef?: React.MutableRefObject<InspectActions | null>;
  /** Called whenever the inspect-relevant state changes so the parent can
   *  re-render the Inspect tab. */
  onInspectSnapshotChange?: (snapshot: InspectSnapshot) => void;
}

interface TakeoffSyncBase {
  originId: string;
  projectId: string;
}

type TakeoffSyncMessage =
  | (TakeoffSyncBase & { type: "view-change"; docId: string; page: number; zoom: number })
  | (TakeoffSyncBase & { type: "annotations-mutated"; docId: string; page: number; annotations?: TakeoffAnnotation[] })
  | (TakeoffSyncBase & { type: "takeoff-links-mutated" })
  | (TakeoffSyncBase & { type: "workspace-mutated" })
  | (TakeoffSyncBase & { type: "files-mutated" })
  | (TakeoffSyncBase & { type: "calibration-change"; calibration: Calibration | null });

type TakeoffSyncPayload =
  | { type: "view-change"; docId: string; page: number; zoom: number }
  | { type: "annotations-mutated"; docId: string; page: number; annotations?: TakeoffAnnotation[] }
  | { type: "takeoff-links-mutated" }
  | { type: "workspace-mutated" }
  | { type: "files-mutated" }
  | { type: "calibration-change"; calibration: Calibration | null };

function takeoffChannelName(projectId: string): string {
  return `bw-takeoff-${projectId}`;
}

function getTakeoffDocumentKind(fileName: string): TakeoffDocument["kind"] {
  if (isDwgFile(fileName)) return "dwg";
  if (isBimFile(fileName)) return "bim";
  if (isMeshFile(fileName)) return "model";
  if (isSpreadsheetFile(fileName)) return "spreadsheet";
  return "pdf";
}

function takeoffDisplayFileName(fileName: string) {
  return fileName.split(/[\\/]/).filter(Boolean).pop() ?? fileName;
}

function fileNodeToTakeoffDocument(projectId: string, node: FileNode): TakeoffDocument | null {
  if (
    node.type !== "file" ||
    (!node.name.toLowerCase().endsWith(".pdf") && !isCadFile(node.name) && !isSpreadsheetFile(node.name))
  ) {
    return null;
  }
  return {
    id: `file-${node.id}`,
    label: node.name,
    fileName: node.name,
    kind: getTakeoffDocumentKind(node.name),
    source: "project",
    projectId,
    fileNodeId: node.id,
  };
}

function takeoffKindLabel(kind: TakeoffDocument["kind"]) {
  if (kind === "dwg") return "DWG/DXF";
  if (kind === "bim") return "BIM";
  if (kind === "model") return "3D";
  if (kind === "spreadsheet") return "Spreadsheet";
  return "PDF";
}

function sourceCountText(count: number, singular: string, plural = `${singular}s`) {
  return count ? `${count} ${count === 1 ? singular : plural}` : null;
}

type SpreadsheetPanelView = "preview" | "pivot";

/** Extract a human-readable error message from an apiRequest failure. The
 *  thrown Error.message embeds the response body as `"...: { ... }"`, so we
 *  pull out the JSON tail and return its `message` field when present. Used
 *  by the takeoff-line-item creators so the toast surfaces the real reason
 *  (e.g. "Category Labour requires rate schedule items…") instead of a
 *  generic fallback. */
function takeoffApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const tail = /:\s*(\{[\s\S]*\})\s*$/.exec(error.message);
  if (tail) {
    try {
      const body = JSON.parse(tail[1]) as { message?: unknown };
      if (typeof body.message === "string" && body.message.length > 0) return body.message;
    } catch {
      // fall through to fallback
    }
  }
  return error.message || fallback;
}

/** Best-effort column mapping from header names → line-item fields. Drives
 *  the per-row "+ Add" in the Entities tab so the resulting line item gets
 *  reasonable defaults without the user having to do mapping setup. */
function deriveSpreadsheetMapping(headers: string[]): {
  name: string | null;
  quantity: string | null;
  uom: string | null;
  cost: string | null;
} {
  const lowercase = headers.map((h) => h.toLowerCase().trim());
  // Pick the first header whose normalized form matches any pattern.
  // Longer / more-specific patterns first so "unit cost" wins over "cost".
  const find = (patterns: string[]) => {
    for (const pattern of patterns) {
      const idx = lowercase.findIndex((h) => h === pattern || h.includes(pattern));
      if (idx >= 0) return headers[idx];
    }
    return null;
  };
  return {
    name: find(["description", "item", "scope", "name", "entity"]),
    quantity: find(["quantity", "qty", "count", "amount"]),
    uom: find(["uom", "unit of measure", "unit"]),
    cost: find(["unit cost", "unit price", "cost", "price", "rate"]),
  };
}

function numericFormat(value: number) {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }).format(value);
}

function mergeFileNodes(current: FileNode[], nextNodes: FileNode[]) {
  const byId = new Map(current.map((node) => [node.id, node]));
  for (const node of nextNodes) byId.set(node.id, node);
  return Array.from(byId.values());
}

function formatModelSelectionQuantity(value: number, unit: string): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.000001) return `0 ${unit}`;
  return `${Intl.NumberFormat(undefined, { maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value)} ${unit}`;
}

function primaryModelSelectionQuantity(selection: BidwrightModelSelectionMessage) {
  if (selection.quantityBasis === "area" && selection.totals.surfaceArea > 0) {
    return { quantity: selection.totals.surfaceArea, uom: "model^2", label: "3D surface area" };
  }
  if (selection.quantityBasis === "volume" && selection.totals.volume > 0) {
    return { quantity: selection.totals.volume, uom: "model^3", label: "3D volume" };
  }
  return { quantity: Math.max(1, selection.selectedCount), uom: "EA", label: "3D selected elements" };
}

function buildModelSelectionLineItem(
  selection: BidwrightModelSelectionMessage,
  options: {
    fileName?: string;
    markup: number;
    category?: EntityCategory | null;
  },
): CreateWorksheetItemInput {
  const primary = primaryModelSelectionQuantity(selection);
  const selectedNames = selection.nodes.map((node) => node.name).filter(Boolean).slice(0, 8);

  return {
    categoryId: options.category?.id ?? null,
    category: options.category?.name ?? "Model Takeoff",
    entityType: options.category?.entityType ?? "Model Quantity",
    entityName: selectedNames[0] || `${selection.selectedCount} model elements`,
    description: options.fileName ?? "",
    quantity: primary.quantity,
    uom: primary.uom,
    cost: 0,
    markup: options.markup,
    price: 0,
    sourceNotes: [
      `From 3D model selection: ${options.fileName ?? "selected model"}`,
      `${primary.label}: ${formatModelSelectionQuantity(primary.quantity, primary.uom)}`,
      `Surface area: ${formatModelSelectionQuantity(selection.totals.surfaceArea, "model^2")}`,
      `Volume: ${formatModelSelectionQuantity(selection.totals.volume, "model^3")}`,
      selectedNames.length > 0 ? `Selected: ${selectedNames.join(", ")}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function finiteSelectionMetric(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function selectionFromDraft(
  selection: BidwrightModelSelectionMessage,
  draft?: BidwrightModelLineItemDraft,
): BidwrightModelSelectionMessage {
  const ids = new Set(draft?.source?.selectedNodeIds ?? []);
  if (ids.size === 0) return selection;
  const nodes = selection.nodes.filter((node) => ids.has(node.id));
  if (nodes.length === 0) return selection;
  return {
    ...selection,
    selectedCount: nodes.length,
    nodes,
    totals: {
      surfaceArea: nodes.reduce((total, node) => total + finiteSelectionMetric(node.surfaceArea), 0),
      volume: nodes.reduce((total, node) => total + finiteSelectionMetric(node.volume), 0),
      faceCount: nodes.reduce((total, node) => total + finiteSelectionMetric(node.faceCount), 0),
      solidCount: nodes.reduce((total, node) => total + finiteSelectionMetric(node.solidCount), 0),
    },
  };
}

function buildModelSelectionObjectDrafts(
  selection: BidwrightModelSelectionMessage,
  options: { fileName?: string; markup: number; category?: EntityCategory | null },
): BidwrightModelLineItemDraft[] {
  const basis = selection.quantityBasis ?? "count";
  const sourceFile = selection.documentName ?? selection.fileName ?? options.fileName ?? "selected model";
  return selection.nodes.slice(0, 250).map((node) => {
    const nodeSelection = selectionFromDraft(selection, {
      source: { kind: "model-selection", selectedNodeIds: [node.id] },
    } as BidwrightModelLineItemDraft);
    const payload = buildModelSelectionLineItem(nodeSelection, options);
    return {
      ...payload,
      entityType: payload.entityType || node.kind,
      entityName: node.name || payload.entityName,
      sourceNotes: payload.sourceNotes ?? "",
      worksheetId: undefined,
      worksheetName: undefined,
      source: {
        kind: "model-selection",
        projectId: selection.projectId,
        modelId: selection.modelId,
        modelElementId: node.modelElementId,
        modelDocumentId: selection.modelDocumentId,
        fileName: selection.fileName,
        documentId: selection.documentId,
        quantityBasis: basis,
        quantityType: payload.uom === "model^2" ? "surface_area" : payload.uom === "model^3" ? "volume" : "count",
        selectedNodeIds: [node.id],
      },
    };
  });
}

function normalizeModelLineItemDraft(
  draft: BidwrightModelLineItemDraft | undefined,
  fallback: CreateWorksheetItemInput,
): CreateWorksheetItemInput {
  if (!draft) return fallback;

  return {
    phaseId: null,
    categoryId: draft.categoryId === undefined ? fallback.categoryId : draft.categoryId,
    category: draft.category || fallback.category,
    entityType: draft.entityType || fallback.entityType,
    entityName: draft.entityName || fallback.entityName,
    description: draft.description ?? fallback.description,
    quantity: Number.isFinite(draft.quantity) && draft.quantity > 0 ? draft.quantity : fallback.quantity,
    uom: draft.uom || fallback.uom,
    cost: Number.isFinite(draft.cost) ? draft.cost : fallback.cost,
    markup: Number.isFinite(draft.markup) ? draft.markup : fallback.markup,
    price: Number.isFinite(draft.price) ? draft.price : fallback.price,
    tierUnits: draft.tierUnits ?? fallback.tierUnits,
    sourceNotes: draft.sourceNotes || fallback.sourceNotes,
  };
}

function toLinkedModelLineItem(link: ModelTakeoffLinkRecord): BidwrightModelLinkedLineItem | null {
  const item = link.worksheetItem;
  if (!item) return null;

  return {
    linkId: link.id,
    worksheetItemId: link.worksheetItemId,
    worksheetId: item.worksheetId,
    worksheetName: item.worksheet?.name ?? null,
    entityName: item.entityName,
    description: item.description,
    quantity: item.quantity,
    uom: item.uom,
    cost: item.cost,
    markup: item.markup,
    price: item.price,
    sourceNotes: item.sourceNotes,
    derivedQuantity: link.derivedQuantity,
    selection: link.selection,
  };
}

type ModelQuantityBasis = "count" | "area" | "volume";
type ModelElementWithQuantities = ModelElement & { quantities?: ModelQuantity[] };
type WorkspaceRateSchedule = ProjectWorkspaceData["rateSchedules"][number];
type WorkspaceRateScheduleItem = WorkspaceRateSchedule["items"][number];

function normalizeTakeoffCategoryPick(pick: string | InspectCategoryPick): InspectCategoryPick {
  return typeof pick === "string" ? { categoryId: pick } : pick;
}

function normalizeCategoryLookup(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function rateScheduleMatchesCategory(schedule: WorkspaceRateSchedule, category: EntityCategory) {
  const scheduleKey = normalizeCategoryLookup(schedule.category);
  if (!scheduleKey) return false;
  return [category.entityType, category.name, category.id]
    .map(normalizeCategoryLookup)
    .filter(Boolean)
    .includes(scheduleKey);
}

function defaultRateTier(schedule: WorkspaceRateSchedule, item?: WorkspaceRateScheduleItem) {
  const sortedTiers = [...(schedule.tiers ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const tier = sortedTiers.find((candidate) => Number(candidate.multiplier) === 1) ?? sortedTiers[0] ?? null;
  const rateKey = tier?.id ?? Object.keys(item?.rates ?? {})[0] ?? Object.keys(item?.costRates ?? {})[0] ?? "__unit";
  const rateValue = rateKey ? Number(item?.rates?.[rateKey]) : Number.NaN;
  return {
    tier,
    tierUnits: { [rateKey]: 1 },
    rate: Number.isFinite(rateValue) ? rateValue : null,
  };
}

function hasPositiveTierUnits(tierUnits: Record<string, number> | undefined) {
  return Object.values(tierUnits ?? {}).some((value) => Number(value) > 0);
}

function findModelElementQuantity(element: ModelElementWithQuantities, types: string[]) {
  return (element.quantities ?? []).find((quantity) => types.includes(quantity.quantityType) && quantity.value > 0);
}

function getModelElementTakeoffQuantity(element: ModelElementWithQuantities, basis: ModelQuantityBasis) {
  if (basis === "area") {
    const area = findModelElementQuantity(element, ["surface_area", "area"]);
    if (area) return { quantity: area.value, uom: area.unit || "model^2", label: "Surface area", quantityType: area.quantityType, quantityId: area.id };
  }
  if (basis === "volume") {
    const volume = findModelElementQuantity(element, ["volume"]);
    if (volume) return { quantity: volume.value, uom: volume.unit || "model^3", label: "Volume", quantityType: volume.quantityType, quantityId: volume.id };
  }
  return { quantity: 1, uom: "EA", label: "Count", quantityType: "count", quantityId: null as string | null };
}

function formatElementQuantity(element: ModelElementWithQuantities, basis: ModelQuantityBasis) {
  const primary = getModelElementTakeoffQuantity(element, basis);
  return formatModelSelectionQuantity(primary.quantity, primary.uom);
}

function buildModelElementLineItem(
  element: ModelElementWithQuantities,
  primary: ReturnType<typeof getModelElementTakeoffQuantity>,
  options: { fileName?: string; markup: number; category?: EntityCategory | null },
): CreateWorksheetItemInput {
  const allQuantities = (element.quantities ?? [])
    .map((quantity) => `${quantity.quantityType}: ${formatModelSelectionQuantity(quantity.value, quantity.unit || "")}`)
    .join("\n");
  // Carry the element's BIM classification straight through to the new
  // worksheet item. The shape on both sides is identical (see
  // classification-utils.ts) so codes seeded by the IFC heuristic propagate
  // into the existing by_uniformat / by_masterformat rollups without any
  // mapping table here. Empty classifications fall through as undefined.
  const classification: Record<string, unknown> | undefined =
    element.classification && Object.keys(element.classification).length > 0
      ? { ...element.classification }
      : undefined;
  const lod = element.lod?.trim();
  return {
    categoryId: options.category?.id ?? null,
    category: options.category?.name ?? "Model Takeoff",
    entityType: options.category?.entityType ?? element.elementClass ?? "Model Element",
    entityName: element.name || element.externalId || element.id,
    classification,
    description: options.fileName ?? "",
    quantity: primary.quantity,
    uom: primary.uom,
    cost: 0,
    markup: options.markup,
    price: 0,
    sourceNotes: [
      `From 3D model element: ${options.fileName ?? "selected model"}`,
      `${primary.label}: ${formatModelSelectionQuantity(primary.quantity, primary.uom)}`,
      `Element class: ${element.elementClass || "Model Element"}`,
      element.material ? `Material: ${element.material}` : "",
      element.level ? `Level: ${element.level}` : "",
      lod ? `LOD: ${lod}${element.lodSource === "pset" ? " (from model)" : ""}` : "",
      classification?.uniformat ? `Uniformat: ${classification.uniformat}` : "",
      classification?.masterformat ? `MasterFormat: ${classification.masterformat}` : "",
      `External id: ${element.externalId || element.id}`,
      allQuantities ? `Available quantities:\n${allQuantities}` : "",
    ].filter(Boolean).join("\n"),
  };
}

function sameCalibration(a: Calibration | null, b: Calibration | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.unit === b.unit && a.pixelsPerUnit === b.pixelsPerUnit;
}

function buildPdfUrl(doc: TakeoffDocument): string {
  if (doc.source === "knowledge" && doc.bookId) {
    return getBookFileUrl(doc.bookId);
  }
  if (doc.source === "project" && doc.projectId) {
    if (doc.fileNodeId) {
      return getFileDownloadUrl(doc.projectId, doc.fileNodeId, true);
    }
    return getDocumentDownloadUrl(doc.projectId, doc.id, true);
  }
  return "";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteNumberValue(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeAnnotationPoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      const record = objectRecord(point);
      const x = finiteNumberValue(record.x);
      const y = finiteNumberValue(record.y);
      return x === undefined || y === undefined ? null : { x, y };
    })
    .filter((point): point is Point => Boolean(point));
}

function normalizeAnnotationMeasurement(value: unknown): TakeoffAnnotation["measurement"] | undefined {
  const record = objectRecord(value);
  const measurement: NonNullable<TakeoffAnnotation["measurement"]> = {
    value: finiteNumberValue(record.value) ?? 0,
    unit: typeof record.unit === "string" && record.unit.length > 0 ? record.unit : "",
  };
  const area = finiteNumberValue(record.area);
  const volume = finiteNumberValue(record.volume);
  if (area !== undefined) measurement.area = area;
  if (volume !== undefined) measurement.volume = volume;
  if (measurement.value === 0 && !measurement.unit && area === undefined && volume === undefined) {
    return undefined;
  }
  return measurement;
}

function canvasDimensionFromMetadata(metadata: Record<string, unknown>, key: "canvasWidth" | "canvasHeight") {
  const value = finiteNumberValue(metadata[key]);
  return value && value > 0 ? value : undefined;
}

function annotationOptsFromMetadata(metadata: Record<string, unknown>): TakeoffAnnotation["opts"] | undefined {
  const { canvasWidth: _canvasWidth, canvasHeight: _canvasHeight, ...opts } = metadata;
  return Object.keys(opts).length > 0 ? opts as TakeoffAnnotation["opts"] : undefined;
}

/* ─── JSON Export Helper ─── */

function exportAnnotationsJson(annotations: TakeoffAnnotation[], calibration: Calibration | null) {
  const payload = {
    exportedAt: new Date().toISOString(),
    calibration: calibration ?? null,
    annotations: annotations.map((ann) => ({
      id: ann.id,
      type: ann.type,
      label: ann.label,
      color: ann.color,
      thickness: ann.thickness,
      groupName: ann.groupName ?? null,
      opts: ann.opts ?? null,
      measurement: ann.measurement ?? null,
      points: ann.points,
      visible: ann.visible,
    })),
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "takeoff-marks.json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Component ─── */

export function TakeoffTab({
  workspace,
  onOpenAgentChat,
  onOpenRevisionDiff,
  onWorkspaceMutated,
  initialDocumentId,
  initialPage = 1,
  detached = false,
  workspaceSyncOriginId,
  selectedWorksheetId,
  selection,
  onSelectionChange,
  onAnnotationsChange,
  linksReloadSignal,
  onLinksMutated,
  modelSendToEstimateRef,
  modelElementCreateLineItemRef,
  inspectActionsRef,
  onInspectSnapshotChange,
}: TakeoffTabProps) {
  const projectId = workspace.project.id;
  const selectedWorksheet =
    (selectedWorksheetId ? workspace.worksheets.find((worksheet) => worksheet.id === selectedWorksheetId) : null) ??
    workspace.worksheets[0] ??
    null;
  const safeInitialPage = Number.isFinite(initialPage) ? Math.max(1, Math.floor(initialPage)) : 1;

  // Org-configured categories. Used to pick a sensible default when creating
  // line items from takeoff annotations / agent suggestions, instead of
  // hardcoding "Material" or "Labour" — those names belong to the org.
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);
  useEffect(() => {
    let cancelled = false;
    getEntityCategories()
      .then((cats) => { if (!cancelled) setEntityCategories(cats); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const rateScheduleItemsByCategoryId = useMemo(() => {
    const map = new Map<string, InspectRateScheduleItemOption[]>();
    for (const category of entityCategories.filter((c) => c.enabled && c.itemSource === "rate_schedule")) {
      const items: InspectRateScheduleItemOption[] = [];
      for (const schedule of workspace.rateSchedules ?? []) {
        if (!rateScheduleMatchesCategory(schedule, category)) continue;
        for (const item of schedule.items ?? []) {
          const fallback = defaultRateTier(schedule, item);
          items.push({
            id: item.id,
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            code: item.code ?? "",
            name: item.name,
            unit: item.unit || category.defaultUom || "EA",
            tierUnits: fallback.tierUnits,
            rate: fallback.rate,
            tierName: fallback.tier?.name ?? null,
          });
        }
      }
      items.sort((a, b) => a.name.localeCompare(b.name) || a.scheduleName.localeCompare(b.scheduleName));
      map.set(category.id, items);
    }
    return map;
  }, [entityCategories, workspace.rateSchedules]);

  /** User-controlled override for which category takeoff-derived line items
   *  land in. Persisted per-project in localStorage so the estimator only
   *  picks it once. Resolution priority:
   *    1. Saved choice in localStorage (if still enabled in this project)
   *    2. Enabled freeform / catalog category whose name suggests it's a
   *       takeoff bucket — `material(s)`, `direct`, `subcontract`,
   *       `equipment` — in that order
   *    3. First enabled non-rate-schedule category
   *    4. null → blocks + Add and prompts the user via the picker
   *
   *  Rate-schedule categories are excluded because takeoff entities don't
   *  carry a rateScheduleItemId; the API rejects rate-schedule items
   *  without one. */
  const takeoffCategoryStorageKey = `bw-takeoff-category-${projectId}`;
  const [takeoffCategoryOverrideId, setTakeoffCategoryOverrideId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(takeoffCategoryStorageKey);
    if (stored) setTakeoffCategoryOverrideId(stored);
  }, [takeoffCategoryStorageKey]);
  const takeoffCategory = useMemo<EntityCategory | null>(() => {
    const enabled = entityCategories.filter((c) => c.enabled);
    if (enabled.length === 0) return null;
    if (takeoffCategoryOverrideId) {
      const saved = enabled.find((c) => c.id === takeoffCategoryOverrideId);
      if (saved) return saved;
    }
    const nonRateSchedule = enabled
      .filter((c) => c.itemSource !== "rate_schedule")
      .slice()
      .sort((a, b) => a.order - b.order);
    // Name-based heuristic — most estimating shops drop takeoff into a
    // generically-named bucket like "Material" or "Materials" first.
    const namePriority = ["material", "direct", "subcontract", "equipment"];
    for (const needle of namePriority) {
      const match = nonRateSchedule.find((c) => c.name.toLowerCase().includes(needle));
      if (match) return match;
    }
    return nonRateSchedule[0] ?? null;
  }, [entityCategories, takeoffCategoryOverrideId]);
  const setTakeoffCategoryId = useCallback((categoryId: string | null) => {
    setTakeoffCategoryOverrideId(categoryId);
    if (typeof window === "undefined") return;
    if (categoryId) {
      window.localStorage.setItem(takeoffCategoryStorageKey, categoryId);
    } else {
      window.localStorage.removeItem(takeoffCategoryStorageKey);
    }
  }, [takeoffCategoryStorageKey]);

  function findRateScheduleSelection(pick: InspectCategoryPick) {
    if (!pick.rateScheduleItemId) return null;
    for (const schedule of workspace.rateSchedules ?? []) {
      const item = (schedule.items ?? []).find((candidate) => candidate.id === pick.rateScheduleItemId);
      if (item) return { schedule, item };
    }
    return null;
  }

  function applyCategoryPickToPayload(
    payload: CreateWorksheetItemInput,
    category: EntityCategory,
    pickInput: string | InspectCategoryPick,
  ): CreateWorksheetItemInput | null {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (category.itemSource !== "rate_schedule") return payload;

    const selection = findRateScheduleSelection(pick);
    if (!selection) {
      setToastType("error");
      setToastMessage(`Choose an imported ${category.name} ratebook item before adding this row.`);
      return null;
    }

    const fallback = defaultRateTier(selection.schedule, selection.item);
    const tierUnits = hasPositiveTierUnits(pick.tierUnits) && pick.tierUnits
      ? pick.tierUnits
      : fallback.tierUnits;
    return {
      ...payload,
      entityName: pick.rateScheduleItemName || selection.item.name || payload.entityName,
      uom: pick.rateScheduleItemUnit || selection.item.unit || payload.uom,
      cost: 0,
      markup: 0,
      price: 0,
      rateScheduleItemId: selection.item.id,
      tierUnits,
    };
  }

  /* Project source documents that are PDFs or CAD files.
   * Memoized: without this, .map() returned fresh objects every render, which
   * cascaded through `drawings` → `takeoffDocuments` (useMemo) → `selectedDoc`
   * being a new reference each render. That made the snapshot-publishing effect
   * downstream re-fire every render, calling parent setState and looping. */
  const projectPdfs: TakeoffDocument[] = useMemo(
    () => (workspace.sourceDocuments ?? [])
      .filter((d) => isPdfSource(d.fileName, d.fileType) || isCadFile(d.fileName))
      .map((d) => ({
        id: d.id,
        label: takeoffDisplayFileName(d.fileName),
        fileName: d.fileName,
        kind: getTakeoffDocumentKind(d.fileName),
        source: "project" as const,
        projectId,
      })),
    [workspace.sourceDocuments, projectId],
  );

  /* Knowledge books (loaded async) */
  const [knowledgePdfs, setKnowledgePdfs] = useState<TakeoffDocument[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const books = await listKnowledgeBooks(projectId);
        if (cancelled) return;
        setKnowledgePdfs(
          books
            .filter((b) => b.scope === "project" && b.status === "indexed" && (b.sourceFileName?.toLowerCase().endsWith(".pdf") || isCadFile(b.sourceFileName ?? "")))
            .map((b) => ({
              id: `kb-${b.id}`,
              label: b.name || b.sourceFileName,
              fileName: b.sourceFileName ?? b.name ?? "",
              kind: getTakeoffDocumentKind(b.sourceFileName ?? b.name ?? ""),
              source: "knowledge" as const,
              bookId: b.id,
            }))
        );
      } catch {
        /* Knowledge API may not be available */
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const drawings = useMemo(() => [...projectPdfs, ...knowledgePdfs], [projectPdfs, knowledgePdfs]);

  /* Core state */
  const [selectedDocId, setSelectedDocId] = useState(initialDocumentId ?? projectPdfs[0]?.id ?? "");
  const [showLanding, setShowLanding] = useState(!detached && !initialDocumentId);
  type IntakeOptionId = "spreadsheet" | "pdf" | "dwg" | "bim" | "model" | "photo";
  const [activeIntakeOption, setActiveIntakeOption] = useState<IntakeOptionId | null>(null);
  const [fileTreeNodes, setFileTreeNodes] = useState<FileNode[]>([]);
  const [spreadsheetPreviewLoading, setSpreadsheetPreviewLoading] = useState(false);
  const [selectedSpreadsheetNodeId, setSelectedSpreadsheetNodeId] = useState<string | null>(null);
  const [spreadsheetPreview, setSpreadsheetPreview] = useState<(ImportPreviewResponse & { sourceName: string; sourceNodeId?: string }) | null>(null);
  const [spreadsheetPanelView, setSpreadsheetPanelView] = useState<SpreadsheetPanelView>("preview");
  const [pivotGroupBy, setPivotGroupBy] = useState("");
  const [pivotMeasure, setPivotMeasure] = useState("__count");

  // Photo-derived BOM result set surfaced into the side panel as entities.
  // Tracks both the latest vision-API response and which row indexes the
  // estimator has already + Added so the row dims in the panel.
  const [photoBomResult, setPhotoBomResult] = useState<PhotoTakeoffResult | null>(null);
  const [photoBomSourcePhotoNames, setPhotoBomSourcePhotoNames] = useState<string[]>([]);
  const [photoBomLinkedRowIds, setPhotoBomLinkedRowIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedDocId && drawings.length > 0) {
      setSelectedDocId(drawings[0].id);
    }
  }, [drawings.length, selectedDocId]);
  useEffect(() => {
    if (detached || initialDocumentId) {
      setShowLanding(false);
    }
  }, [detached, initialDocumentId]);
  const [page, setPage] = useState(safeInitialPage);
  const [zoom, setZoom] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [activeTool, setActiveTool] = useState<ToolId>("select");

  /* Annotation state */
  const [annotations, setAnnotations] = useState<TakeoffAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [dwgAnnotationsCache, setDwgAnnotationsCache] = useState<TakeoffAnnotation[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AnnotationConfig | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const undoStackRef = useRef<TakeoffHistoryCommand[]>([]);
  const redoStackRef = useRef<TakeoffHistoryCommand[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const externalAnnotationSelectionId = selection?.kind === "annotation" ? selection.annotationId : null;
  const updateAnnotationSelection = useCallback((id: string | null) => {
    setSelectedAnnotationId((prev) => (prev === id ? prev : id));
    if (!onSelectionChange) return;
    if (id) {
      if (externalAnnotationSelectionId !== id) {
        onSelectionChange({ kind: "annotation", annotationId: id });
      }
      return;
    }
    if (externalAnnotationSelectionId) {
      onSelectionChange(null);
    }
  }, [externalAnnotationSelectionId, onSelectionChange]);

  /* ─── Takeoff Link state ─── */
  const [takeoffLinks, setTakeoffLinks] = useState<TakeoffLinkRecord[]>([]);

  /* Calibration state */
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibrationPromptOpen, setCalibrationPromptOpen] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<[Point, Point] | null>(null);
  const [calibrationInput, setCalibrationInput] = useState("");
  const [calibrationUnit, setCalibrationUnit] = useState("ft");
  const [calibrationApplyToAllPages, setCalibrationApplyToAllPages] = useState(false);

  /* Title-block OCR scale detection */
  const [detectingScale, setDetectingScale] = useState(false);
  const [detectedScales, setDetectedScales] = useState<DetectedScaleRecord[] | null>(null);
  const [detectedDiscipline, setDetectedDiscipline] = useState<DetectedDisciplineRecord | null>(null);

  /* Symbol legend reader state */
  const [legendOpen, setLegendOpen] = useState(false);
  const [legendLoading, setLegendLoading] = useState(false);
  const [legendEntries, setLegendEntries] = useState<LegendEntryRecord[] | null>(null);
  const [legendWarnings, setLegendWarnings] = useState<string[]>([]);

  /* Drawing intelligence state */
  const [drawingAnalysisOpen, setDrawingAnalysisOpen] = useState(false);
  const [drawingAnalysisPreset, setDrawingAnalysisPreset] = useState<DrawingAnalysisPreset>("generic");
  const [drawingAnalysisResult, setDrawingAnalysisResult] = useState<DrawingGeometryAnalysisResult | null>(null);
  const [drawingAnalysisRunning, setDrawingAnalysisRunning] = useState(false);
  const [drawingAnalysisSavingId, setDrawingAnalysisSavingId] = useState<string | null>(null);
  const [drawingAnalysisError, setDrawingAnalysisError] = useState<string | null>(null);
  const [drawingAnalysisOverlay, setDrawingAnalysisOverlay] = useState<DrawingAnalysisOverlayState>({
    lines: true,
    systems: true,
    symbols: true,
    circles: false,
    text: false,
  });

  /* Verify-scale flow: when user clicks "Verify" they re-enter the calibrate
     two-point flow but with verifyMode set, so the completion handler shows
     a measurement-vs-expected panel instead of a calibration setter. */
  const [verifyMode, setVerifyMode] = useState(false);
  const [verifyPoints, setVerifyPoints] = useState<[Point, Point] | null>(null);
  const [verifyExpected, setVerifyExpected] = useState("");

  // Clear verifyMode the moment the user leaves calibrate (cancel via tool
  // switch, Escape key, etc) so the next time they pick Calibrate they get
  // the normal Set drawing scale prompt — not a stale verify routing.
  useEffect(() => {
    if (activeTool !== "calibrate" && verifyMode) {
      setVerifyMode(false);
    }
  }, [activeTool, verifyMode]);

  /* Persistent calibration cache. For each documentId we keep:
     - numeric pageNumber keys for page-specific calibrations
     - a special "__default" key for a document-wide default
     The lookup falls back to the default when no page-specific value exists. */
  type CalibrationDocCache = { [pageNumber: number]: Calibration } & { __default?: Calibration };
  const calibrationCacheRef = useRef<Record<string, CalibrationDocCache>>({});

  function lookupCalibrationFromCache(docId: string, pageNumber: number): Calibration | null {
    const docCache = calibrationCacheRef.current[docId];
    if (!docCache) return null;
    return docCache[pageNumber] ?? docCache.__default ?? null;
  }

  /* Drawing config (from modal or defaults) */
  const COLOR_CYCLE = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];
  const colorIndexRef = useRef(0);
  const [activeColor, setActiveColor] = useState(COLOR_CYCLE[0]);
  const [activeThickness, setActiveThickness] = useState(3);
  const [activeOpts, setActiveOpts] = useState<TakeoffAnnotation["opts"]>({});
  const [activeGroupName, setActiveGroupName] = useState<string | undefined>();
  const [activeLabel, setActiveLabel] = useState<string>("");

  /* Auto-count state */
  const [autoCountRunning, setAutoCountRunning] = useState(false);
  const [autoCountResults, setAutoCountResults] = useState<VisionMatch[] | null>(null);
  const [autoCountSnippet, setAutoCountSnippet] = useState<string | null>(null);
  const [autoCountThreshold, setAutoCountThreshold] = useState(0.65);
  const [autoCountScope, setAutoCountScope] = useState<"page" | "document" | "all">("page");
  const [autoCountModalOpen, setAutoCountModalOpen] = useState(false);
  const [autoCountPending, setAutoCountPending] = useState<{
    matches: VisionMatch[];
    matchPoints: Point[];
    totalCount: number;
    snippetImage: string | null;
    /** Per-match inclusion — user can toggle individual matches on/off */
    included: boolean[];
  } | null>(null);

  /* Ask AI state */
  const [askAiRunning, setAskAiRunning] = useState(false);
  const [askAiModalOpen, setAskAiModalOpen] = useState(false);
  const [askAiCropImage, setAskAiCropImage] = useState<string | null>(null);
  const [askAiBbox, setAskAiBbox] = useState<VisionBoundingBox | null>(null);
  const [askAiCountRunning, setAskAiCountRunning] = useState(false);
  const [askAiResponse, setAskAiResponse] = useState<string | null>(null);
  const askAiStreamRef = useRef<EventSource | null>(null);

  /* Smart count-by-region state */
  interface SmartCountItem {
    label: string;
    count: number;
    confidence: "high" | "medium" | "low";
    notes?: string;
  }
  const [smartCountRunning, setSmartCountRunning] = useState(false);
  const [smartCountModalOpen, setSmartCountModalOpen] = useState(false);
  const [smartCountBbox, setSmartCountBbox] = useState<VisionBoundingBox | null>(null);
  const [smartCountCropImage, setSmartCountCropImage] = useState<string | null>(null);
  const [smartCountItems, setSmartCountItems] = useState<SmartCountItem[] | null>(null);
  const [smartCountIncluded, setSmartCountIncluded] = useState<boolean[]>([]);
  const [smartCountError, setSmartCountError] = useState<string | null>(null);

  /* Cross-page / cross-document search state */
  const [crossPageRunning, setCrossPageRunning] = useState(false);
  const [crossPageResults, setCrossPageResults] = useState<{ page: number; count: number }[] | null>(null);
  const [crossPageLastBbox, setCrossPageLastBbox] = useState<VisionBoundingBox | null>(null);
  const [crossScaleEnabled, setCrossScaleEnabled] = useState(false);
  const [multiDocRunning, setMultiDocRunning] = useState(false);
  const [multiDocResults, setMultiDocResults] = useState<{ docId: string; docLabel: string; total: number }[] | null>(null);

  /* Toast state */
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error">("success");

  /* Canvas dimensions */
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  /* Unified card / fullscreen / detach */
  const cardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** True on first render of a new document so we auto-fit to page */
  const fitOnLoadRef = useRef(true);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const syncOriginRef = useRef(`takeoff-${Math.random().toString(36).slice(2)}`);
  const selectedDocIdRef = useRef(selectedDocId);
  const pageRef = useRef(page);
  const zoomRef = useRef(zoom);
  const zoomScrollSerialRef = useRef(0);
  const loadAnnotationsRef = useRef<() => Promise<void>>(async () => {});
  const loadTakeoffLinksRef = useRef<() => Promise<void>>(async () => {});
  const onWorkspaceMutatedRef = useRef(onWorkspaceMutated);
  const calibrationRef = useRef(calibration);
  const initialDocumentAppliedRef = useRef(!initialDocumentId);
  const prevInitialDocumentIdRef = useRef(initialDocumentId);
  if (prevInitialDocumentIdRef.current !== initialDocumentId) {
    prevInitialDocumentIdRef.current = initialDocumentId;
    initialDocumentAppliedRef.current = false;
  }

  const [modelAssets, setModelAssets] = useState<ModelAsset[]>([]);
  const [modelSelection, setModelSelection] = useState<BidwrightModelSelectionMessage | null>(null);
  const [modelTakeoffLinks, setModelTakeoffLinks] = useState<ModelTakeoffLinkRecord[]>([]);
  const [modelElements, setModelElements] = useState<ModelElementWithQuantities[]>([]);
  const [modelElementSearch, setModelElementSearch] = useState("");
  const [modelElementsLoading, setModelElementsLoading] = useState(false);
  const [modelLedgerBasis, setModelLedgerBasis] = useState<ModelQuantityBasis>("count");
  const [selectedModelElementIds, setSelectedModelElementIds] = useState<Set<string>>(() => new Set());
  const [modelSyncing, setModelSyncing] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  // Discriminated union: the picker carries enough context to resume the
  // original action once a worksheet exists. Covers every entity-to-line-item
  // path in the side panel — per-row Adds and per-group summed Adds for both
  // annotations (PDF / DWG) and model elements (BIM / 3D).
  type WorksheetPickerAction =
    | { kind: "send-selection" }
    | { kind: "create-elements" }
    | { kind: "create-single-element"; elementId: string; pick: InspectCategoryPick }
    | { kind: "create-element-group"; elementIds: string[]; groupLabel: string; pick: InspectCategoryPick }
    | { kind: "create-single-annotation"; annotationId: string; pick: InspectCategoryPick }
    | { kind: "create-annotation-group"; annotationIds: string[]; groupLabel: string; pick: InspectCategoryPick }
    | { kind: "create-spreadsheet-row"; rowIndex: number; pick: InspectCategoryPick }
    | { kind: "create-spreadsheet-all"; pick: InspectCategoryPick };
  const [worksheetPickerAction, setWorksheetPickerAction] = useState<WorksheetPickerAction | null>(null);
  const [newWorksheetName, setNewWorksheetName] = useState("");
  const fileManagerModelDocuments = useMemo<TakeoffDocument[]>(
    () =>
      modelAssets
        .filter((asset) => asset.fileNodeId && !projectPdfs.some((doc) => doc.id === asset.sourceDocumentId))
        .map((asset) => ({
          id: `model-asset-${asset.id}`,
          label: asset.fileName,
          fileName: asset.fileName,
          kind: getTakeoffDocumentKind(asset.fileName),
          source: "project" as const,
          projectId,
          fileNodeId: asset.fileNodeId ?? undefined,
          modelAssetId: asset.id,
        })),
    [modelAssets, projectId, projectPdfs],
  );
  const projectFileTakeoffDocuments = useMemo<TakeoffDocument[]>(
    () =>
      fileTreeNodes
        .map((node) => fileNodeToTakeoffDocument(projectId, node))
        .filter((doc): doc is TakeoffDocument => Boolean(doc)),
    [fileTreeNodes, projectId],
  );
  const takeoffDocuments = useMemo(
    () => {
      // Same physical file can surface both as a FileNode (file tree) and as
      // a ModelAsset (because ingest creates a ModelAsset pointing back at
      // the FileNode). They use different ids — fn-... vs model-asset-... —
      // so a plain id-based dedupe lets both into the dropdown. Track which
      // FileNode ids are already covered by a ModelAsset and skip the raw
      // FileNode version. The ModelAsset version carries `modelAssetId`,
      // which the BIM inspect surface needs.
      const modelAssetFileNodeIds = new Set<string>();
      for (const doc of fileManagerModelDocuments) {
        if (doc.fileNodeId) modelAssetFileNodeIds.add(doc.fileNodeId);
      }
      const byId = new Map<string, TakeoffDocument>();
      const push = (doc: TakeoffDocument) => byId.set(doc.id, doc);
      for (const doc of drawings) push(doc);
      for (const doc of projectFileTakeoffDocuments) {
        if (doc.fileNodeId && modelAssetFileNodeIds.has(doc.fileNodeId)) continue;
        push(doc);
      }
      for (const doc of fileManagerModelDocuments) push(doc);
      return Array.from(byId.values());
    },
    [drawings, fileManagerModelDocuments, projectFileTakeoffDocuments],
  );
  const selectedDoc = takeoffDocuments.find((d) => d.id === selectedDocId);
  const pdfDocuments = takeoffDocuments.filter((d) => d.kind === "pdf");
  const dwgDocuments = takeoffDocuments.filter((d) => d.kind === "dwg");
  const spreadsheetDocuments = takeoffDocuments.filter((d) => d.kind === "spreadsheet");
  const selectedDocumentKind = selectedDoc?.kind ?? "pdf";
  const isPdfDocument = selectedDocumentKind === "pdf";
  const isBimDocument = selectedDocumentKind === "bim";
  const isSpreadsheetDocument = selectedDocumentKind === "spreadsheet";
  // `isCadDocument` retains its historical "any 3D file" semantic so all the
  // PDF-only-UI guards (`!isCadDocument && !isDwgDocument && …`) keep working
  // for both BIM and mesh files. Branch on `isBimDocument` for BIM-specific UI.
  const isCadDocument = selectedDocumentKind === "model" || selectedDocumentKind === "bim";
  const isDwgDocument = selectedDocumentKind === "dwg";
  const selectedModelIsEditable = isCadDocument && isBidwrightEditableModel(selectedDoc?.fileName);
  const selectedModelAsset = isCadDocument
    ? modelAssets.find((asset) =>
        (selectedDoc?.modelAssetId && asset.id === selectedDoc.modelAssetId) ||
        (selectedDoc?.fileNodeId && asset.fileNodeId === selectedDoc.fileNodeId) ||
        (selectedDoc?.source === "project" && asset.sourceDocumentId === selectedDoc.id) ||
        asset.fileName.toLowerCase() === (selectedDoc?.fileName ?? "").toLowerCase()
      )
    : undefined;
  const linkedModelLineItems = modelTakeoffLinks
    .map(toLinkedModelLineItem)
    .filter((item): item is BidwrightModelLinkedLineItem => Boolean(item));

  const refreshModelAssets = useCallback(async (forceSync = false) => {
    if (!projectId) return;
    setModelSyncing(true);
    setModelError(null);
    try {
      const result = forceSync ? await syncModelAssets(projectId) : await listModelAssets(projectId);
      setModelAssets(result.assets ?? []);
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "Model indexing failed.");
    } finally {
      setModelSyncing(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshModelAssets(false);
  }, [refreshModelAssets]);

  const refreshFileTree = useCallback(async () => {
    try {
      setFileTreeNodes(await getFileTree(projectId));
    } catch (error) {
      console.error("[takeoff] Failed to load project files:", error);
      setFileTreeNodes([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshFileTree();
  }, [refreshFileTree]);

  useEffect(() => {
    if (!selectedDocId && takeoffDocuments.length > 0) {
      setSelectedDocId(takeoffDocuments[0].id);
    }
  }, [selectedDocId, takeoffDocuments]);

  // When the user opens a spreadsheet document in the main viewer, auto-load
  // its preview the same way the old landing list did. Goes through a ref
  // because the preview function is defined further down the component body.
  const previewSpreadsheetNodeRef = useRef<((node: FileNode) => Promise<void>) | null>(null);
  useEffect(() => {
    if (!isSpreadsheetDocument || !selectedDoc?.fileNodeId) return;
    if (selectedSpreadsheetNodeId === selectedDoc.fileNodeId) return;
    const node = fileTreeNodes.find((n) => n.id === selectedDoc.fileNodeId);
    if (!node) return;
    void previewSpreadsheetNodeRef.current?.(node);
  }, [isSpreadsheetDocument, selectedDoc?.fileNodeId, selectedSpreadsheetNodeId, fileTreeNodes]);

  const refreshModelTakeoffLinks = useCallback(async (modelId = selectedModelAsset?.id) => {
    if (!projectId || !modelId) {
      setModelTakeoffLinks([]);
      return;
    }
    try {
      const result = await listModelTakeoffLinks(projectId, modelId);
      setModelTakeoffLinks(result.links ?? []);
    } catch (error) {
      console.error("[takeoff] Failed to load model takeoff links:", error);
      setModelTakeoffLinks([]);
    }
  }, [projectId, selectedModelAsset?.id]);

  useEffect(() => {
    void refreshModelTakeoffLinks();
  }, [refreshModelTakeoffLinks]);

  const refreshModelElements = useCallback(async () => {
    if (!projectId || !selectedModelAsset?.id) {
      setModelElements([]);
      return;
    }
    setModelElementsLoading(true);
    try {
      const result = await queryModelElements(projectId, selectedModelAsset.id, {
        text: modelElementSearch.trim() || undefined,
        limit: 400,
      });
      setModelElements(result.elements ?? []);
    } catch (error) {
      console.error("[takeoff] Failed to load model elements:", error);
      setModelElements([]);
    } finally {
      setModelElementsLoading(false);
    }
  }, [modelElementSearch, projectId, selectedModelAsset?.id]);

  useEffect(() => {
    if (!selectedModelAsset?.id) {
      setModelElements([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      void refreshModelElements();
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [refreshModelElements, selectedModelAsset?.id]);

  useEffect(() => {
    setModelSelection(null);
    setModelTakeoffLinks([]);
    setModelElements([]);
    setSelectedModelElementIds(new Set());
  }, [selectedDocId]);

  const linkedModelElementIds = useMemo(
    () => new Set(modelTakeoffLinks.map((link) => link.modelElementId).filter((id): id is string => Boolean(id))),
    [modelTakeoffLinks],
  );

  const selectedModelElements = useMemo(
    () => modelElements.filter((element) => selectedModelElementIds.has(element.id)),
    [modelElements, selectedModelElementIds],
  );

  // Map an IFC raycast hit (expressID) back to a ModelElement and publish a
  // model-element selection so the side-panel Link view populates.
  const handleIfcElementSelect = useCallback(
    (sel: { expressID: number; elementClass: string }) => {
      if (!onSelectionChange || !selectedModelAsset) return;
      if (sel.expressID < 0) {
        if (selection?.kind === "model-element") onSelectionChange(null);
        return;
      }
      const wanted = `#${sel.expressID}`;
      const element = modelElements.find((e) => {
        const props = (e.properties as Record<string, unknown> | null) ?? {};
        return props.expressId === wanted;
      });
      if (!element) return;
      onSelectionChange({
        kind: "model-element",
        assetId: selectedModelAsset.id,
        elementId: element.id,
        elementName: element.name || element.externalId,
        elementClass: element.elementClass ?? undefined,
        material: element.material ?? undefined,
        level: element.level ?? undefined,
        quantitySummary: formatElementQuantity(element, modelLedgerBasis),
      });
    },
    [onSelectionChange, selectedModelAsset, modelElements, modelLedgerBasis, selection],
  );

  useEffect(() => {
    selectedDocIdRef.current = selectedDocId;
  }, [selectedDocId]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const applyPdfZoom = useCallback((
    nextZoomValue: number | ((currentZoom: number) => number),
    focusPoint?: { clientX: number; clientY: number },
  ) => {
    const currentZoom = Number.isFinite(zoomRef.current) && zoomRef.current > 0 ? zoomRef.current : 1;
    const nextZoom = roundPdfZoom(
      typeof nextZoomValue === "function" ? nextZoomValue(currentZoom) : nextZoomValue,
    );
    if (Math.abs(nextZoom - currentZoom) < 0.005) return;

    const container = viewerContainerRef.current;
    let restoreScroll: (() => void) | null = null;

    if (container && focusPoint) {
      const rect = container.getBoundingClientRect();
      const offsetX = focusPoint.clientX - rect.left;
      const offsetY = focusPoint.clientY - rect.top;
      const contentX = container.scrollLeft + offsetX;
      const contentY = container.scrollTop + offsetY;
      const ratio = nextZoom / currentZoom;
      const serial = ++zoomScrollSerialRef.current;

      restoreScroll = () => {
        if (zoomScrollSerialRef.current !== serial) return;
        container.scrollLeft = contentX * ratio - offsetX;
        container.scrollTop = contentY * ratio - offsetY;
      };
    } else {
      zoomScrollSerialRef.current += 1;
    }

    zoomRef.current = nextZoom;
    setZoom(nextZoom);

    if (restoreScroll) {
      requestAnimationFrame(restoreScroll);
      window.setTimeout(restoreScroll, 50);
      window.setTimeout(restoreScroll, 150);
    }
  }, []);

  useEffect(() => {
    onWorkspaceMutatedRef.current = onWorkspaceMutated;
  }, [onWorkspaceMutated]);

  useEffect(() => {
    calibrationRef.current = calibration;
  }, [calibration]);

  useEffect(() => {
    if (!initialDocumentId || initialDocumentAppliedRef.current) return;
    if (!takeoffDocuments.some((d) => d.id === initialDocumentId)) return;
    initialDocumentAppliedRef.current = true;
    setSelectedDocId(initialDocumentId);
    setPage(safeInitialPage);
    fitOnLoadRef.current = true;
  }, [takeoffDocuments, initialDocumentId, safeInitialPage]);

  const postTakeoffMessage = useCallback((payload: TakeoffSyncPayload) => {
    if (!broadcastRef.current || !projectId) return;
    broadcastRef.current.postMessage({
      ...payload,
      originId: syncOriginRef.current,
      projectId,
    });
  }, [projectId]);

  /* ─── Load annotations from API ─── */

  const loadAnnotations = useCallback(async () => {
    if (!projectId || !selectedDocId) return;
    const annotationDocumentId = selectedDoc?.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDocId;
    try {
      const data = await listTakeoffAnnotations(projectId, annotationDocumentId, page);
      if (Array.isArray(data)) {
        setAnnotations(
          data.map((a: Record<string, unknown>) => {
            const metadata = objectRecord(a.metadata);
            return {
              id: String(a.id),
              type: String(a.annotationType ?? a.type ?? "linear"),
              label: typeof a.label === "string" ? a.label : "",
              color: typeof a.color === "string" && a.color.length > 0 ? a.color : "#3b82f6",
              thickness: finiteNumberValue(a.lineThickness ?? a.thickness) ?? 3,
              points: normalizeAnnotationPoints(a.points),
              visible: a.visible !== false,
              groupName: typeof a.groupName === "string" && a.groupName.length > 0 ? a.groupName : undefined,
              opts: annotationOptsFromMetadata(metadata),
              measurement: normalizeAnnotationMeasurement(a.measurement),
              canvasWidth: canvasDimensionFromMetadata(metadata, "canvasWidth"),
              canvasHeight: canvasDimensionFromMetadata(metadata, "canvasHeight"),
            };
          })
        );
      }
    } catch {
      /* API may not be available yet; use local state */
    }
  }, [projectId, selectedDoc?.bookId, selectedDoc?.source, selectedDocId, page]);

  useEffect(() => {
    loadAnnotationsRef.current = loadAnnotations;
  }, [loadAnnotations]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  /* ─── Load takeoff links ─── */
  const loadTakeoffLinks = useCallback(async () => {
    if (!projectId) return;
    try {
      const links = await listTakeoffLinks(projectId);
      if (Array.isArray(links)) setTakeoffLinks(links);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    loadTakeoffLinksRef.current = loadTakeoffLinks;
  }, [loadTakeoffLinks]);

  useEffect(() => {
    loadTakeoffLinks();
  }, [loadTakeoffLinks]);

  // Reload links when the parent signals a mutation happened outside this tab
  // (e.g. from the side-panel link UI). Skip the first run so we don't double-fetch.
  const reloadSignalSeenRef = useRef(false);
  useEffect(() => {
    if (linksReloadSignal === undefined) return;
    if (!reloadSignalSeenRef.current) {
      reloadSignalSeenRef.current = true;
      return;
    }
    void loadTakeoffLinks();
  }, [linksReloadSignal, loadTakeoffLinks]);

  // Publish annotations (PDF + DWG merged) to the parent so the side panel can
  // look them up by id regardless of which viewer drew them.
  useEffect(() => {
    onAnnotationsChange?.([...annotations, ...dwgAnnotationsCache]);
  }, [annotations, dwgAnnotationsCache, onAnnotationsChange]);

  // Mirror externally-controlled annotation selection into local state. Clearing
  // is done by updateAnnotationSelection so local clicks cannot race a stale
  // parent null and bounce forever.
  useEffect(() => {
    if (externalAnnotationSelectionId) {
      setSelectedAnnotationId((prev) => (
        prev === externalAnnotationSelectionId ? prev : externalAnnotationSelectionId
      ));
    }
  }, [externalAnnotationSelectionId]);

  // Bridge for dispatching DWG annotation actions (delete) from the side panel.
  // Populated by DwgTakeoffSurface, consumed by inspectActionsRef below.
  const dwgActionsRef = useRef<{ deleteAnnotation: (id: string) => Promise<void> | void } | null>(null);

  // Expose action handlers to the parent via mutable refs. Runs on every render
  // so refs always point at the latest closure.
  useEffect(() => {
    if (modelSendToEstimateRef) {
      modelSendToEstimateRef.current = handleSendModelSelectionToEstimate;
    }
    if (modelElementCreateLineItemRef) {
      modelElementCreateLineItemRef.current = async (elementId: string) => {
        const element = modelElements.find((e) => e.id === elementId);
        if (!element) throw new Error("Model element not found");
        // This ref is driven by BidwrightModelEditor's in-canvas action,
        // which doesn't show the AddToCategoryPopover. Fall back to the
        // sticky / heuristic takeoffCategory the side-panel uses.
        const categoryId = takeoffCategory?.id;
        if (!categoryId) {
          setToastType("error");
          setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
          return;
        }
        await handleCreateModelElementLineItem(element, categoryId);
      };
    }
    if (inspectActionsRef) {
      const isDwg = isDwgDocument;
      inspectActionsRef.current = {
        selectAnnotation: (id) => {
          // For DWG, route through onSelectionChange so DwgTakeoffSurface picks
          // it up via the `selection` prop; for PDF, mutate local state directly.
          if (isDwg) {
            if (id) onSelectionChange?.({ kind: "annotation", annotationId: id });
            else if (selection?.kind === "annotation") onSelectionChange?.(null);
          } else {
            updateAnnotationSelection(id);
          }
        },
        toggleAnnotationVisibility: (id) => {
          // Visibility toggle is a PDF-only feature today (DWG annotations are
          // always visible). Silently no-op for DWG ids.
          if (annotations.some((a) => a.id === id)) {
            handleToggleVisibility(id);
          }
        },
        deleteAnnotation: (id) => {
          if (annotations.some((a) => a.id === id)) {
            void handleDeleteAnnotation(id);
          } else {
            void dwgActionsRef.current?.deleteAnnotation(id);
          }
        },
        editAnnotation: (id) => {
          if (annotations.some((a) => a.id === id)) {
            handleEditAnnotation(id);
          }
        },
        cancelAnnotationEdit: () => {
          setEditingAnnotationId(null);
        },
        saveAnnotationEdit: (id, updates) => {
          handleSaveAnnotationEdit(id, updates);
        },
        setModelSearch: (s) => setModelElementSearch(s),
        setModelBasis: (b) => setModelLedgerBasis(b),
        selectModelElement: (id) => {
          if (!onSelectionChange) return;
          if (!id || !selectedModelAsset) {
            if (selection?.kind === "model-element") onSelectionChange(null);
            return;
          }
          const element = modelElements.find((e) => e.id === id);
          if (!element) return;
          onSelectionChange({
            kind: "model-element",
            assetId: selectedModelAsset.id,
            elementId: element.id,
            elementName: element.name || element.externalId,
            elementClass: element.elementClass ?? undefined,
            material: element.material ?? undefined,
            level: element.level ?? undefined,
            quantitySummary: formatElementQuantity(element, modelLedgerBasis),
          });
        },
        createLineItemFromElement: async (id, pick) => {
          // The pick is selected in the per-click popover that wraps each
          // + Add button — see AddToCategoryPopover. We don't fall back to
          // the sticky here; the popover always presents a choice.
          const element = modelElements.find((e) => e.id === id);
          if (!element) return;
          await handleCreateModelElementLineItem(element, pick);
        },
        createLineItemFromElementGroup: async (ids, groupLabel, pick) => {
          const targets = ids
            .map((id) => modelElements.find((e) => e.id === id))
            .filter((e): e is ModelElementWithQuantities => Boolean(e));
          if (targets.length === 0) return;
          await handleCreateElementGroupLineItem(targets, groupLabel, pick);
        },
        createLineItemFromAnnotation: async (id, pick) => {
          const allAnnotations = [...annotations, ...dwgAnnotationsCache];
          const annotation = allAnnotations.find((a) => a.id === id);
          if (!annotation) return;
          await handleCreateAnnotationLineItem(annotation, pick);
        },
        createLineItemFromAnnotationGroup: async (ids, groupLabel, pick) => {
          const allAnnotations = [...annotations, ...dwgAnnotationsCache];
          const targets = ids
            .map((id) => allAnnotations.find((a) => a.id === id))
            .filter((a): a is TakeoffAnnotation => Boolean(a));
          if (targets.length === 0) return;
          await handleCreateAnnotationGroupLineItem(targets, groupLabel, pick);
        },
        createLineItemFromSpreadsheetRow: async (rowIndex, pick) => {
          await handleCreateSpreadsheetRowLineItem(rowIndex, pick);
        },
        createLineItemsFromAllSpreadsheetRows: async (pick) => {
          await handleCreateAllSpreadsheetLineItems(pick);
        },
        createLineItemFromPhotoBomRow: async (rowId, pick) => {
          // The row id surfaced to the side panel is "photo-bom-<index>"
          // — peel the index back off before looking up the source row.
          const rowIndex = Number(rowId.startsWith("photo-bom-") ? rowId.slice("photo-bom-".length) : NaN);
          if (!Number.isFinite(rowIndex)) return;
          await createLineItemFromPhotoBomRow(rowIndex, pick);
        },
        createLineItemsFromAllPhotoBomRows: async (pick) => {
          await createLineItemsFromAllPhotoBomRows(pick);
        },
        clearPhotoBomResults: () => {
          setPhotoBomResult(null);
          setPhotoBomSourcePhotoNames([]);
          setPhotoBomLinkedRowIds(new Set());
        },
        setTakeoffCategoryId: (categoryId) => {
          setTakeoffCategoryId(categoryId);
        },
        refreshModel: () => void refreshModelAssets(true),
      };
    }
  });

  // Publish 3D model-editor selection up to the parent so the side-panel
  // link view can render it. The parent's onSelectionChange triggers a
  // setState upstream; that re-renders us with a new `selection` prop. If
  // `selection` is in the effect's dep array, the effect re-fires, builds a
  // brand-new object literal, and we publish again — infinite loop the moment
  // the user clicks anything in the model editor.
  //
  // Fix: dedupe via a last-emitted-signature ref and keep `selection` out of
  // the dep array. The clear-on-loss branch checks the same ref instead of
  // the bouncy `selection` prop.
  const lastModelSelectionSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onSelectionChange) return;
    if (modelSelection && modelSelection.modelId) {
      const selectedNodeIds = modelSelection.nodes.map((node) => node.id);
      const signature = JSON.stringify({
        modelId: modelSelection.modelId,
        modelDocumentId: modelSelection.modelDocumentId,
        selectedNodeIds,
        selectedCount: modelSelection.selectedCount,
      });
      if (signature === lastModelSelectionSignatureRef.current) return;
      lastModelSelectionSignatureRef.current = signature;
      onSelectionChange({
        kind: "model-selection",
        modelId: modelSelection.modelId,
        modelDocumentId: modelSelection.modelDocumentId,
        fileName: modelSelection.fileName,
        selectedCount: modelSelection.selectedCount,
        selectedNodeIds,
        totals: modelSelection.totals,
      });
    } else if (lastModelSelectionSignatureRef.current !== null) {
      lastModelSelectionSignatureRef.current = null;
      onSelectionChange(null);
    }
  }, [modelSelection, onSelectionChange]);

  useEffect(() => {
    if (!projectId || typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(takeoffChannelName(projectId));
    broadcastRef.current = channel;

    channel.onmessage = (event: MessageEvent<TakeoffSyncMessage>) => {
      const msg = event.data;
      if (!msg || msg.projectId !== projectId || msg.originId === syncOriginRef.current) return;

      if (msg.type === "view-change") {
        if (msg.docId && msg.docId !== selectedDocIdRef.current) {
          setSelectedDocId(msg.docId);
          setAnnotations([]);
          fitOnLoadRef.current = true;
        }
        if (Number.isFinite(msg.page) && msg.page !== pageRef.current) {
          setPage(Math.max(1, Math.floor(msg.page)));
        }
        if (Number.isFinite(msg.zoom) && msg.zoom > 0 && msg.zoom !== zoomRef.current) {
          const nextZoom = roundPdfZoom(msg.zoom);
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
        }
        return;
      }

      if (msg.type === "annotations-mutated") {
        if (msg.docId !== selectedDocIdRef.current || msg.page !== pageRef.current) return;
        if (msg.annotations) {
          setAnnotations(msg.annotations);
        } else {
          void loadAnnotationsRef.current();
        }
        return;
      }

      if (msg.type === "takeoff-links-mutated") {
        void loadTakeoffLinksRef.current();
        return;
      }

      if (msg.type === "workspace-mutated") {
        onWorkspaceMutatedRef.current?.();
        return;
      }

      if (msg.type === "files-mutated") {
        // A sibling component (file browser, etc.) added/renamed/deleted a
        // file. Refresh our copy of the project tree so the intake-card
        // counts and source dropdowns reflect it.
        void refreshFileTree();
        return;
      }

      if (msg.type === "calibration-change") {
        if (!sameCalibration(msg.calibration, calibrationRef.current)) {
          setCalibration(msg.calibration);
        }
      }
    };

    return () => {
      if (broadcastRef.current === channel) {
        broadcastRef.current = null;
      }
      channel.close();
    };
  }, [projectId]);

  /* ─── PDF page count callback ─── */

  const handlePageCount = useCallback((count: number) => {
    setTotalPages(count);
  }, []);

  const handleCanvasResize = useCallback((w: number, h: number) => {
    setCanvasSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    /* Auto-fit to page the first time a document renders */
    if (fitOnLoadRef.current && w > 0 && h > 0) {
      fitOnLoadRef.current = false;
      requestAnimationFrame(() => {
        const container = viewerContainerRef.current;
        if (!container) return;
        const cw = container.clientWidth - 32;
        const ch = container.clientHeight - 32;
        if (cw <= 0 || ch <= 0) return;
        /* w/h are base dimensions (canvas renders at zoom=1 after doc change resets zoom) */
        applyPdfZoom(Math.min(cw / w, ch / h));
      });
    }
  }, [applyPdfZoom]);

  /* Toast auto-dismiss */
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  /* Fullscreen change tracking */
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  /* BroadcastChannel sync — broadcast annotation/page changes to detached window */
  useEffect(() => {
    if (!selectedDocId) return;
    postTakeoffMessage({ type: "view-change", docId: selectedDocId, page, zoom });
  }, [page, postTakeoffMessage, selectedDocId, zoom]);

  useEffect(() => {
    postTakeoffMessage({ type: "calibration-change", calibration });
  }, [calibration, postTakeoffMessage]);

  /* Escape key: cancel drawing and return to Select */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActiveTool("select");
        setAutoCountResults(null);
        setAutoCountSnippet(null);
        setCrossPageResults(null);
        setMultiDocResults(null);
        setAskAiModalOpen(false);
        setAskAiCropImage(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* Sync annotation canvas size with PDF canvas.
     Poll briefly after mount/doc-change since PdfCanvasViewer is dynamically
     imported and the ref may be null when the effect first runs. */
  useEffect(() => {
    let cancelled = false;
    let resObs: ResizeObserver | null = null;
    let mutObs: MutationObserver | null = null;

    function syncSize() {
      const canvas = pdfCanvasRef.current;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        setCanvasSize((prev) =>
          prev.width === canvas.width && prev.height === canvas.height
            ? prev
            : { width: canvas.width, height: canvas.height }
        );
      }
    }

    function setup() {
      const canvas = pdfCanvasRef.current;
      if (!canvas) return false;

      syncSize();

      resObs = new ResizeObserver(syncSize);
      resObs.observe(canvas);

      mutObs = new MutationObserver(syncSize);
      mutObs.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });
      return true;
    }

    /* Try immediately; if ref isn't ready yet, retry a few times */
    if (!setup()) {
      let attempts = 0;
      const interval = setInterval(() => {
        if (cancelled || setup() || ++attempts > 20) clearInterval(interval);
      }, 100);
    }

    return () => {
      cancelled = true;
      resObs?.disconnect();
      mutObs?.disconnect();
    };
  }, [selectedDocId, page, zoom]);

  /* Load any persisted calibrations from WorkspaceState on mount, then apply
     the one for the current document/page if present. */
  useEffect(() => {
    apiRequest<WorkspaceStateRecord>(`/projects/${projectId}/workspace-state`)
      .then((ws) => {
        const map = ws.state?.takeoffCalibrations as Record<string, Record<number, Calibration>> | undefined;
        if (map) calibrationCacheRef.current = map;
      })
      .catch(() => {});
  }, [projectId]);

  // Whenever the user switches doc or page, restore the matching calibration.
  useEffect(() => {
    if (!selectedDocId) return;
    const cached = lookupCalibrationFromCache(selectedDocId, page);
    setCalibration(cached);
  }, [selectedDocId, page]);

  /* Wheel and pinch zoom while the cursor is inside the 2D PDF viewer.
     Chromium reports macOS trackpad pinches as ctrl+wheel; Safari reports
     gesture* events. Native passive:false listeners let us keep browser/page
     zoom out of the takeoff canvas and zoom around the pointer instead. */
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;
    if (isCadDocument || isDwgDocument) return;

    const hasRenderedPdfCanvas = () => {
      const canvas = pdfCanvasRef.current;
      return Boolean(canvas && canvas.width > 0 && canvas.height > 0);
    };

    const normalizeWheelDelta = (e: WheelEvent) => {
      if (e.deltaMode === 1) return e.deltaY * 16;
      if (e.deltaMode === 2) return e.deltaY * Math.max(container.clientHeight, 1);
      return e.deltaY;
    };

    function onWheel(e: WheelEvent) {
      if (!hasRenderedPdfCanvas()) return;
      if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      e.preventDefault();
      e.stopPropagation();

      const delta = normalizeWheelDelta(e);
      if (!Number.isFinite(delta) || delta === 0) return;
      const sensitivity = e.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.exp(-delta * sensitivity);
      applyPdfZoom((currentZoom) => currentZoom * factor, { clientX: e.clientX, clientY: e.clientY });
    }

    let gestureStartZoom = zoomRef.current;
    const gestureFocusPoint = (e: WebKitGestureEvent) => {
      const rect = container.getBoundingClientRect();
      return {
        clientX: typeof e.clientX === "number" ? e.clientX : rect.left + rect.width / 2,
        clientY: typeof e.clientY === "number" ? e.clientY : rect.top + rect.height / 2,
      };
    };

    function onGestureStart(event: Event) {
      if (!hasRenderedPdfCanvas()) return;
      event.preventDefault();
      gestureStartZoom = zoomRef.current;
    }

    function onGestureChange(event: Event) {
      if (!hasRenderedPdfCanvas()) return;
      const e = event as WebKitGestureEvent;
      if (!Number.isFinite(e.scale) || !e.scale || e.scale <= 0) return;
      event.preventDefault();
      applyPdfZoom(gestureStartZoom * e.scale, gestureFocusPoint(e));
    }

    function onGestureEnd(event: Event) {
      if (!hasRenderedPdfCanvas()) return;
      event.preventDefault();
      gestureStartZoom = zoomRef.current;
    }

    const listenerOptions = { passive: false } as AddEventListenerOptions;
    container.addEventListener("wheel", onWheel, listenerOptions);
    container.addEventListener("gesturestart", onGestureStart, listenerOptions);
    container.addEventListener("gesturechange", onGestureChange, listenerOptions);
    container.addEventListener("gestureend", onGestureEnd, listenerOptions);
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("gesturestart", onGestureStart);
      container.removeEventListener("gesturechange", onGestureChange);
      container.removeEventListener("gestureend", onGestureEnd);
    };
  }, [applyPdfZoom, isCadDocument, isDwgDocument, selectedDocId]);

  /* ─── Handlers ─── */

  function handlePrevPage() {
    setPage((p) => Math.max(1, p - 1));
  }

  function handleNextPage() {
    setPage((p) => Math.min(totalPages, p + 1));
  }

  function handleZoomIn() {
    applyPdfZoom((z) => z + 0.25);
  }

  function handleZoomOut() {
    applyPdfZoom((z) => z - 0.25);
  }

  function handleFitToWidth() {
    const container = viewerContainerRef.current;
    const canvas = pdfCanvasRef.current;
    if (!container || !canvas || canvas.width === 0) {
      applyPdfZoom(1);
      return;
    }
    /* Container inner width minus the m-4 (16px) padding on each side of the inline-block wrapper */
    const containerWidth = container.clientWidth - 32;
    /* PDF page width at zoom=1 */
    const baseWidth = canvas.width / zoom;
    const fitZoom = Math.round((containerWidth / baseWidth) * 100) / 100;
    applyPdfZoom(fitZoom);
    /* Scroll to top-left after fitting */
    container.scrollTo({ top: 0, left: 0 });
  }

  function handleFitToPage() {
    const container = viewerContainerRef.current;
    const canvas = pdfCanvasRef.current;
    if (!container || !canvas || canvas.width === 0) {
      applyPdfZoom(1);
      return;
    }
    const containerWidth = container.clientWidth - 32;
    const containerHeight = container.clientHeight - 32;
    const baseWidth = canvas.width / zoom;
    const baseHeight = canvas.height / zoom;
    const fitZoom = Math.round(Math.min(containerWidth / baseWidth, containerHeight / baseHeight) * 100) / 100;
    applyPdfZoom(fitZoom);
    container.scrollTo({ top: 0, left: 0 });
  }

  function handleFullscreen() {
    if (!document.fullscreenElement) {
      cardRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  function handleDetach() {
    if (!selectedDocId || !projectId) return;
    const src = selectedDoc?.source ?? "project";
    const url = `/takeoff-viewer?projectId=${encodeURIComponent(projectId)}&docId=${encodeURIComponent(selectedDocId)}&source=${encodeURIComponent(src)}&page=${page}`;
    window.open(url, `bw-takeoff-${projectId}`, "width=1400,height=900,resizable=yes");
  }

  function notifyAnnotationsMutated(nextAnnotations?: TakeoffAnnotation[]) {
    if (!selectedDocId) return;
    postTakeoffMessage({
      type: "annotations-mutated",
      docId: selectedDocId,
      page,
      annotations: nextAnnotations,
    });
  }

  function notifyTakeoffLinksMutated() {
    postTakeoffMessage({ type: "takeoff-links-mutated" });
  }

  function notifyWorkspaceMutated() {
    onWorkspaceMutated?.();
    postTakeoffMessage({ type: "workspace-mutated" });
    postWorkspaceMutation(projectId, {
      originId: workspaceSyncOriginId,
      reason: "takeoff",
    });
  }

  function handleToolSelect(tool: ToolId) {
    // Clear auto-count results when switching tools
    if (tool !== "auto-count") {
      setAutoCountResults(null);
      setAutoCountSnippet(null);
    }
    if (tool === "select") {
      setActiveTool("select");
      return;
    }

    if (tool === "auto-count") {
      setActiveTool("auto-count");
      return;
    }

    if (tool === "ask-ai") {
      setActiveTool("ask-ai");
      return;
    }

    if (tool === "smart-count") {
      setActiveTool("smart-count");
      return;
    }

    /* Calibrate is its own first-class flow — straight to drawing mode
       (with the magnifier loupe), then the dedicated calibration prompt
       panel opens once both points are placed. No annotation config modal. */
    if (tool === "calibrate") {
      setActiveTool("calibrate");
      return;
    }

    /* Markup tools go straight to drawing mode */
    if (tool.startsWith("markup-")) {
      setActiveTool(tool);
      return;
    }

    /* For any drawing tool, open the config modal first */
    setActiveTool(tool);
    setPendingConfig(null);
    setShowCreateModal(true);
  }

  /* When user confirms annotation config in modal */
  function handleAnnotationConfigConfirm(config: AnnotationConfig) {
    setActiveTool(config.type as ToolId);
    setActiveColor(config.color);
    setActiveThickness(config.thickness);
    setActiveOpts(config.opts);
    setActiveGroupName(config.groupName);
    setActiveLabel(config.label);
    setShowCreateModal(false);
  }

  function updateTakeoffHistoryVersion() {
    setHistoryVersion((value) => value + 1);
  }

  function pushTakeoffHistory(command: TakeoffHistoryCommand) {
    undoStackRef.current = [...undoStackRef.current.slice(-49), command];
    redoStackRef.current = [];
    updateTakeoffHistoryVersion();
  }

  function annotationToApiPayload(annotation: TakeoffAnnotation) {
    const metadata: Record<string, unknown> = { ...(annotation.opts ?? {}) };
    if (Number.isFinite(annotation.canvasWidth)) metadata.canvasWidth = annotation.canvasWidth;
    if (Number.isFinite(annotation.canvasHeight)) metadata.canvasHeight = annotation.canvasHeight;
    const annotationDocumentId = selectedDoc?.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDocId;
    return {
      documentId: annotationDocumentId,
      pageNumber: page,
      annotationType: annotation.type || activeTool || "unknown",
      label: annotation.label || "",
      color: annotation.color || "#3b82f6",
      lineThickness: annotation.thickness ?? 4,
      visible: annotation.visible ?? true,
      groupName: annotation.groupName || "",
      points: annotation.points || [],
      measurement: annotation.measurement ?? {},
      metadata,
    };
  }

  function mapSavedAnnotation(saved: any, fallback: TakeoffAnnotation): TakeoffAnnotation {
    const metadata = objectRecord(saved?.metadata);
    return {
      ...fallback,
      id: String(saved?.id ?? fallback.id),
      type: String(saved?.annotationType ?? saved?.type ?? fallback.type),
      label: String(saved?.label ?? fallback.label ?? ""),
      color: String(saved?.color ?? fallback.color ?? "#3b82f6"),
      thickness: Number(saved?.lineThickness ?? saved?.thickness ?? fallback.thickness ?? 4),
      visible: saved?.visible !== false,
      groupName: String(saved?.groupName ?? fallback.groupName ?? ""),
      points: Array.isArray(saved?.points) ? normalizeAnnotationPoints(saved.points) : fallback.points,
      measurement: normalizeAnnotationMeasurement(saved?.measurement) ?? fallback.measurement,
      opts: annotationOptsFromMetadata(metadata) ?? fallback.opts,
      canvasWidth: canvasDimensionFromMetadata(metadata, "canvasWidth") ?? fallback.canvasWidth,
      canvasHeight: canvasDimensionFromMetadata(metadata, "canvasHeight") ?? fallback.canvasHeight,
    };
  }

  async function recreateTakeoffAnnotation(annotation: TakeoffAnnotation): Promise<TakeoffAnnotation> {
    const local = { ...annotation, id: crypto.randomUUID() };
    try {
      const saved = await createTakeoffAnnotation(projectId, annotationToApiPayload(local));
      const next = mapSavedAnnotation(saved, local);
      setAnnotations((prev) => [...prev, next]);
      notifyAnnotationsMutated();
      return next;
    } catch {
      setAnnotations((prev) => [...prev, local]);
      notifyAnnotationsMutated();
      return local;
    }
  }

  async function deleteTakeoffAnnotationLocal(id: string) {
    setAnnotations((prev) => prev.filter((annotation) => annotation.id !== id));
    try {
      await deleteTakeoffAnnotation(projectId, id);
    } catch {
      /* Ignore optimistic local delete failures. */
    }
    notifyAnnotationsMutated();
  }

  async function undoTakeoffAction() {
    const command = undoStackRef.current.pop();
    if (!command) return;
    try {
      if (command.kind === "create") {
        await deleteTakeoffAnnotationLocal(command.annotation.id);
        redoStackRef.current.push(command);
      } else if (command.kind === "delete") {
        const restored = await recreateTakeoffAnnotation(command.annotation);
        redoStackRef.current.push({ kind: "delete", annotation: restored });
      } else {
        const restored: TakeoffAnnotation[] = [];
        for (const annotation of command.annotations) {
          restored.push(await recreateTakeoffAnnotation(annotation));
        }
        redoStackRef.current.push({ kind: "clear", annotations: restored });
      }
    } finally {
      updateTakeoffHistoryVersion();
    }
  }

  async function redoTakeoffAction() {
    const command = redoStackRef.current.pop();
    if (!command) return;
    try {
      if (command.kind === "create") {
        const recreated = await recreateTakeoffAnnotation(command.annotation);
        undoStackRef.current.push({ kind: "create", annotation: recreated });
      } else if (command.kind === "delete") {
        await deleteTakeoffAnnotationLocal(command.annotation.id);
        undoStackRef.current.push(command);
      } else {
        for (const annotation of command.annotations) {
          await deleteTakeoffAnnotationLocal(annotation.id);
        }
        undoStackRef.current.push(command);
      }
    } finally {
      updateTakeoffHistoryVersion();
    }
  }

  /* When annotation drawing is complete */
  async function handleAnnotationComplete(data: Partial<TakeoffAnnotation>) {
    const newAnnotation: TakeoffAnnotation = {
      id: crypto.randomUUID(),
      type: data.type ?? activeTool,
      label: activeLabel || data.type || activeTool,
      color: data.color ?? activeColor,
      thickness: data.thickness ?? activeThickness,
      points: data.points ?? [],
      visible: true,
      groupName: activeGroupName,
      opts: activeOpts,
      measurement: data.measurement,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
    };

    setAnnotations((prev) => [...prev, newAnnotation]);

    /* Auto-open edit panel for notes so user can type text */
    if (newAnnotation.type === "markup-note") {
      updateAnnotationSelection(newAnnotation.id);
      setEditingAnnotationId(newAnnotation.id);
    }

    /* Cycle to next color for the next annotation */
    colorIndexRef.current = (colorIndexRef.current + 1) % COLOR_CYCLE.length;
    setActiveColor(COLOR_CYCLE[colorIndexRef.current]);

    /* Persist to API */
    try {
      const saved = await createTakeoffAnnotation(projectId, annotationToApiPayload(newAnnotation));
      const savedAnnotation = mapSavedAnnotation(saved, newAnnotation);
      setAnnotations((prev) =>
        prev.map((a) => (a.id === newAnnotation.id ? savedAnnotation : a))
      );
      pushTakeoffHistory({ kind: "create", annotation: savedAnnotation });
      notifyAnnotationsMutated();
    } catch {
      /* Keep local annotation even if API fails */
      pushTakeoffHistory({ kind: "create", annotation: newAnnotation });
    }
  }

  /* ─── Auto-Count: when user finishes drawing a selection rectangle ─── */

  async function handleAutoCountSelection(data: Partial<TakeoffAnnotation>) {
    if (!selectedDoc || !data.points || data.points.length < 2) return;

    const [p1, p2] = data.points;
    /* Capture canvas size at draw time — this is what we send as imageWidth/imageHeight
       and must also use when mapping results back. */
    const capturedW = canvasSize.width;
    const capturedH = canvasSize.height;
    const bbox = {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      width: Math.abs(p2.x - p1.x),
      height: Math.abs(p2.y - p1.y),
      imageWidth: capturedW,
      imageHeight: capturedH,
    };

    if (bbox.width < 5 || bbox.height < 5) return;

    const realDocId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;

    setAutoCountRunning(true);
    setAutoCountResults(null);
    setAutoCountSnippet(null);
    setCrossPageLastBbox(bbox);

    // If user picked a wider scope, route through the existing
    // cross-page / multi-doc handlers instead of running a single-page count.
    // Pass `bbox` directly so we don't race on the just-queued
    // setCrossPageLastBbox state update.
    if (autoCountScope === "document" && totalPages > 1) {
      setAutoCountRunning(false);
      void handleCrossPageSearch(bbox);
      return;
    }
    if (autoCountScope === "all" && pdfDocuments.length > 1) {
      setAutoCountRunning(false);
      void handleMultiDocSearch(bbox);
      return;
    }

    try {
      const result = await runVisionCountSymbols({
        projectId,
        documentId: realDocId,
        pageNumber: page,
        boundingBox: bbox,
        threshold: autoCountThreshold,
      });

      setAutoCountResults(result.matches);
      setAutoCountSnippet(result.snippetImage ?? null);

      if (result.matches.length > 0) {
        const imgW = result.imageWidth ?? capturedW;
        const imgH = result.imageHeight ?? capturedH;
        const sx = capturedW / imgW;
        const sy = capturedH / imgH;

        const matchPoints: Point[] = result.matches.map((m) => {
          const centerX = m.rect.x + m.rect.width / 2;
          const centerY = m.rect.y + m.rect.height / 2;
          return { x: centerX * sx, y: centerY * sy };
        });

        // Show modal for user to accept/reject individual matches
        setAutoCountPending({
          matches: result.matches,
          matchPoints,
          totalCount: result.totalCount,
          snippetImage: result.snippetImage ?? null,
          included: result.matches.map(() => true),
        });
        setAutoCountModalOpen(true);
      } else {
        setToastMessage("No matching symbols found. Try adjusting the selection area.");
        setToastType("error");
      }
    } catch (err) {
      console.error("Auto-count failed:", err);
      const message = err instanceof Error ? err.message : "Auto-count failed";
      setToastMessage(`Auto-count failed: ${message}`);
      setToastType("error");
    } finally {
      setAutoCountRunning(false);
    }
  }

  /* ─── Ask AI: when user finishes drawing a selection rectangle ─── */

  async function handleAskAiSelection(data: Partial<TakeoffAnnotation>) {
    if (!selectedDoc || !data.points || data.points.length < 2) return;

    const [p1, p2] = data.points;
    const bbox: VisionBoundingBox = {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      width: Math.abs(p2.x - p1.x),
      height: Math.abs(p2.y - p1.y),
      imageWidth: canvasSize.width,
      imageHeight: canvasSize.height,
    };

    if (bbox.width < 5 || bbox.height < 5) return;

    const realDocId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;

    setAskAiRunning(true);
    setAskAiBbox(bbox);
    setAskAiResponse(null);

    try {
      const result = await runVisionCropRegion({
        projectId,
        documentId: realDocId,
        pageNumber: page,
        boundingBox: bbox,
      });

      if (result.image) {
        setAskAiCropImage(result.image);
        setAskAiModalOpen(true);
        // Auto-start analysis immediately
        startAskAiAnalysis(result.image);
      } else {
        setToastMessage("Could not crop the selected region.");
        setToastType("error");
      }
    } catch (err) {
      console.error("Ask AI crop failed:", err);
      setToastMessage("Failed to crop region. Please try again.");
      setToastType("error");
    } finally {
      setAskAiRunning(false);
    }
  }

  /* ─── Smart count: AI-driven region inventory ─── */

  async function handleSmartCountSelection(data: Partial<TakeoffAnnotation>) {
    if (!selectedDoc || !data.points || data.points.length < 2) return;
    const [p1, p2] = data.points;
    const bbox: VisionBoundingBox = {
      x: Math.min(p1.x, p2.x),
      y: Math.min(p1.y, p2.y),
      width: Math.abs(p2.x - p1.x),
      height: Math.abs(p2.y - p1.y),
      imageWidth: canvasSize.width,
      imageHeight: canvasSize.height,
    };
    if (bbox.width < 20 || bbox.height < 20) {
      setToastMessage("Drag a larger region — Smart Count needs enough drawing to analyze.");
      setToastType("error");
      return;
    }

    const realDocId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;

    setSmartCountRunning(true);
    setSmartCountBbox(bbox);
    setSmartCountItems(null);
    setSmartCountError(null);
    setSmartCountModalOpen(true);

    try {
      const cropResult = await runVisionCropRegion({
        projectId,
        documentId: realDocId,
        pageNumber: page,
        boundingBox: bbox,
      });
      if (!cropResult.image) {
        setSmartCountError("Could not crop the selected region.");
        return;
      }
      setSmartCountCropImage(cropResult.image);

      const saved = await saveVisionCrop({ projectId, image: cropResult.image });
      if (!saved.success) {
        setSmartCountError("Failed to save the cropped image for AI analysis.");
        return;
      }

      const docName = selectedDoc?.fileName ?? "the drawing";
      const prompt =
        `This is a cropped region from "${docName}" (page ${page}). ` +
        `Identify and count every distinct construction symbol, fixture, or component visible in this region. ` +
        `Return ONLY a JSON object with this exact shape — no prose, no markdown fence:\n` +
        `{ "items": [ { "label": "<short symbol name>", "count": <integer>, "confidence": "high|medium|low", "notes": "<optional 1-line note>" } ] }\n` +
        `Group similar symbols under one label. Use plain trade names (e.g. "duplex receptacle", "ceiling light", "door"). ` +
        `If the region is unclear or empty, return { "items": [] }.`;

      const result = await askAi(projectId, prompt, saved.filePath);
      const text = result.response ?? "";
      let parsed: { items?: SmartCountItem[] } | null = null;
      try {
        const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonText = codeBlock ? codeBlock[1] : text;
        parsed = JSON.parse(jsonText.trim());
      } catch {
        // Fall back: try to find a JSON object anywhere in the text.
        const m = text.match(/\{[\s\S]*"items"[\s\S]*\}/);
        if (m) {
          try { parsed = JSON.parse(m[0]); } catch { /* give up */ }
        }
      }
      if (!parsed || !Array.isArray(parsed.items)) {
        setSmartCountError("AI returned an unrecognized response. Try a tighter region or check the API key.");
        return;
      }
      const cleanItems = parsed.items
        .filter((i) => i && typeof i.label === "string" && Number.isFinite(i.count) && i.count > 0)
        .map((i) => ({
          label: i.label.trim(),
          count: Math.round(i.count),
          confidence: (i.confidence as SmartCountItem["confidence"]) ?? "medium",
          notes: typeof i.notes === "string" ? i.notes : undefined,
        }));
      setSmartCountItems(cleanItems);
      setSmartCountIncluded(cleanItems.map(() => true));
      if (cleanItems.length === 0) {
        setSmartCountError("AI didn't find any countable items in this region.");
      }
    } catch (err) {
      console.error("Smart count failed:", err);
      setSmartCountError(err instanceof Error ? err.message : "Smart count failed.");
    } finally {
      setSmartCountRunning(false);
    }
  }

  async function handleAcceptSmartCount() {
    if (!smartCountItems || !smartCountBbox || !selectedDoc) return;
    const center: Point = {
      x: smartCountBbox.x + smartCountBbox.width / 2,
      y: smartCountBbox.y + smartCountBbox.height / 2,
    };
    let placedOffset = 0;
    for (let i = 0; i < smartCountItems.length; i++) {
      if (!smartCountIncluded[i]) continue;
      const item = smartCountItems[i]!;
      const color = COLOR_CYCLE[(colorIndexRef.current + i) % COLOR_CYCLE.length];
      // Stagger the visual marker around the bbox centre so multiple
      // smart-count summaries don't overlap perfectly.
      const offsetPoint: Point = {
        x: center.x + (placedOffset % 4) * 18 - 27,
        y: center.y + Math.floor(placedOffset / 4) * 18 - 18,
      };
      const annotation: TakeoffAnnotation = {
        id: crypto.randomUUID(),
        type: "count",
        label: `${item.label} (×${item.count})`,
        color,
        thickness: 5,
        points: [offsetPoint],
        visible: true,
        groupName: "Smart Count",
        canvasWidth: canvasSize.width,
        canvasHeight: canvasSize.height,
        measurement: { value: item.count, unit: "count" },
      };
      setAnnotations((prev) => [...prev, annotation]);
      try {
        // The takeoff create endpoint expects API-contract field names
        // (annotationType / pageNumber / lineThickness), not the local
        // canvas field names (type / page / thickness). Spreading the
        // raw annotation here previously dropped annotationType entirely
        // and the server silently rejected each row, so accepted smart-
        // count entries vanished on reload.
        const saved = await createTakeoffAnnotation(projectId, {
          documentId:
            selectedDoc.source === "knowledge" && selectedDoc.bookId
              ? selectedDoc.bookId
              : selectedDoc.id,
          pageNumber: page,
          annotationType: annotation.type,
          label: annotation.label,
          color: annotation.color,
          lineThickness: annotation.thickness,
          visible: annotation.visible,
          groupName: annotation.groupName ?? "",
          points: annotation.points,
          measurement: annotation.measurement ?? {},
          metadata: {
            canvasWidth: annotation.canvasWidth,
            canvasHeight: annotation.canvasHeight,
          },
        });
        if (saved?.id) {
          setAnnotations((prev) =>
            prev.map((a) => (a.id === annotation.id ? { ...a, id: saved.id } : a)),
          );
        }
      } catch (err) {
        console.error("[smart-count] Failed to persist annotation:", err);
        /* keep local */
      }
      placedOffset++;
    }
    colorIndexRef.current += smartCountItems.length;
    notifyAnnotationsMutated();
    setSmartCountModalOpen(false);
    setSmartCountItems(null);
    setSmartCountBbox(null);
    setSmartCountCropImage(null);
    setActiveTool("select");
    setToastMessage(`Added ${placedOffset} smart-count entries to "Smart Count" group.`);
    setToastType("success");
  }

  function handleRejectSmartCount() {
    setSmartCountModalOpen(false);
    setSmartCountItems(null);
    setSmartCountBbox(null);
    setSmartCountCropImage(null);
    setSmartCountError(null);
  }

  /* ─── Ask AI: send cropped image to Claude API for analysis ─── */

  async function startAskAiAnalysis(image: string) {
    setAskAiCountRunning(true);
    setAskAiResponse(null);

    try {
      const saved = await saveVisionCrop({ projectId, image });

      if (!saved.success) {
        setAskAiResponse("Failed to save crop image.");
        setAskAiCountRunning(false);
        return;
      }

      const docName = selectedDoc?.fileName ?? "the drawing";
      const prompt = `This is a cropped region from "${docName}" (page ${page}). Identify what this symbol, component, or text is. Describe it and explain its significance in the context of this construction/engineering project. Be concise but thorough.`;

      const result = await askAi(projectId, prompt, saved.filePath);
      setAskAiResponse(result.response || "No response returned.");
    } catch (err) {
      console.error("Ask AI failed:", err);
      setAskAiResponse("Failed to get AI analysis. Check that an Anthropic API key is configured in Settings.");
    } finally {
      setAskAiCountRunning(false);
    }
  }

  async function handleAcceptAutoCount() {
    if (!autoCountPending) return;
    const { included, matchPoints, matches } = autoCountPending;
    const acceptedPoints = matchPoints.filter((_, i) => included[i]);
    const acceptedCount = acceptedPoints.length;
    if (acceptedCount === 0) { handleRejectAutoCount(); return; }

    const groupId = crypto.randomUUID().slice(0, 8);
    const groupName = `Auto Count ${groupId}`;

    // Create individual annotations for each accepted match
    const newAnnotations: TakeoffAnnotation[] = acceptedPoints.map((pt, i) => ({
      id: crypto.randomUUID(),
      type: "count",
      label: `#${i + 1}`,
      color: "#22c55e",
      thickness: 4,
      points: [pt],
      visible: true,
      groupName,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      measurement: { value: 1, unit: "count" },
    }));

    setAnnotations((prev) => [...prev, ...newAnnotations]);
    setAutoCountModalOpen(false);
    setAutoCountPending(null);

    // Persist each individually
    for (const ann of newAnnotations) {
      try {
        const saved = await createTakeoffAnnotation(projectId, {
          documentId: selectedDocId,
          pageNumber: page,
          annotationType: "count",
          label: ann.label,
          color: ann.color,
          lineThickness: ann.thickness,
          visible: true,
          groupName,
          points: ann.points,
          measurement: ann.measurement ?? {},
          metadata: {
            canvasWidth: ann.canvasWidth,
            canvasHeight: ann.canvasHeight,
          },
        });
        if (saved?.id) {
          setAnnotations((prev) =>
            prev.map((a) => (a.id === ann.id ? { ...a, id: saved.id } : a))
          );
        }
      } catch { /* local is fine */ }
    }
    notifyAnnotationsMutated();
  }

  function handleRejectAutoCount() {
    setAutoCountModalOpen(false);
    setAutoCountPending(null);
    setAutoCountResults(null);
  }

  function handleCloseAskAiModal() {
    setAskAiModalOpen(false);
    setAskAiCropImage(null);
    setAskAiBbox(null);
    setAskAiResponse(null);
    setAskAiCountRunning(false);
  }

  /* ─── Cross-Page Search (server-side, uses count-symbols-all-pages) ─── */

  async function handleCrossPageSearch(overrideBbox?: VisionBoundingBox) {
    // Allow callers to pass a freshly-drawn bbox so we don't race on the
    // setCrossPageLastBbox state update (the closed-over crossPageLastBbox
    // here is from the previous render).
    const bbox = overrideBbox ?? crossPageLastBbox;
    if (!selectedDoc || !bbox) return;

    const realDocId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;

    setCrossPageRunning(true);
    setCrossPageResults([]);

    try {
      const result = await runVisionCountAllPages({
        projectId,
        documentId: realDocId,
        boundingBox: bbox,
        threshold: autoCountThreshold,
        crossScale: crossScaleEnabled,
      });

      const results = result.pages.map((p) => ({ page: p.pageNumber, count: p.totalCount }));
      setCrossPageResults(results);
      setToastMessage(`Cross-page search: ${result.grandTotal} total across ${result.pageCount} pages`);
      setToastType("success");
    } catch (err) {
      console.error("Cross-page search failed:", err);
      setToastMessage("Cross-page search failed.");
      setToastType("error");
    } finally {
      setCrossPageRunning(false);
    }
  }

  /* ─── Multi-Document Search (same symbol across all project drawings) ─── */

  async function handleMultiDocSearch(overrideBbox?: VisionBoundingBox) {
    const bbox = overrideBbox ?? crossPageLastBbox;
    if (!bbox) return;
    const searchableDocs = pdfDocuments;
    if (searchableDocs.length === 0) return;

    setMultiDocRunning(true);
    setMultiDocResults([]);

    try {
      const results: { docId: string; docLabel: string; total: number }[] = [];

      for (const doc of searchableDocs) {
        const realDocId = doc.source === "knowledge" && doc.bookId ? doc.bookId : doc.id;

        try {
          const result = await runVisionCountAllPages({
            projectId,
            documentId: realDocId,
            boundingBox: bbox,
            threshold: autoCountThreshold,
            crossScale: true, // Always use cross-scale for multi-document
          });
          results.push({ docId: doc.id, docLabel: doc.label, total: result.grandTotal });
          setMultiDocResults([...results]);
        } catch {
          results.push({ docId: doc.id, docLabel: doc.label, total: -1 });
          setMultiDocResults([...results]);
        }
      }

      const total = results.filter((r) => r.total >= 0).reduce((s, r) => s + r.total, 0);
      setToastMessage(`Multi-document search: ${total} total across ${searchableDocs.length} PDFs`);
      setToastType("success");
    } catch (err) {
      console.error("Multi-document search failed:", err);
      setToastMessage("Multi-document search failed.");
      setToastType("error");
    } finally {
      setMultiDocRunning(false);
    }
  }

  /* Calibration flow */
  function handleCalibrationRequest(points: [Point, Point]) {
    if (verifyMode) {
      setVerifyPoints(points);
      setVerifyExpected("");
      setVerifyMode(false);
      setActiveTool("select");
      return;
    }
    setCalibrationPoints(points);
    setCalibrationApplyToAllPages(false);
    setDetectedScales(null);
    setCalibrationPromptOpen(true);
  }

  async function handleDetectScale() {
    if (!selectedDoc) return;
    const docId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;
    setDetectingScale(true);
    try {
      const result = await detectTitleBlockScale(projectId, docId, page);
      setDetectedScales(result.detectedScales);
      setDetectedDiscipline(result.detectedDiscipline);
      if (result.detectedScales.length === 0 && result.warnings.length > 0) {
        setToastMessage(result.warnings[0]);
        setToastType("error");
      }
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : "Detect failed");
      setToastType("error");
    } finally {
      setDetectingScale(false);
    }
  }

  async function handleReadLegend() {
    if (!selectedDoc) return;
    const docId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;
    setLegendOpen(true);
    setLegendLoading(true);
    setLegendEntries(null);
    setLegendWarnings([]);
    try {
      const result = await extractLegendFromPage(projectId, docId, page);
      setLegendEntries(result.entries);
      setLegendWarnings(result.warnings);
    } catch (err) {
      setLegendWarnings([err instanceof Error ? err.message : "Legend extraction failed"]);
    } finally {
      setLegendLoading(false);
    }
  }

  function selectedVisionDocumentId() {
    if (!selectedDoc) return "";
    return selectedDoc.source === "knowledge" && selectedDoc.bookId ? selectedDoc.bookId : selectedDoc.id;
  }

  async function handleRunDrawingAnalysis(mode: "geometry" | "systems" = "geometry") {
    if (!selectedDoc || !isPdfDocument) return;
    const docId = selectedVisionDocumentId();
    if (!docId) return;

    setDrawingAnalysisOpen(true);
    setDrawingAnalysisRunning(true);
    setDrawingAnalysisError(null);

    try {
      const result = mode === "systems"
        ? await traceDrawingSystems({
            projectId,
            documentId: docId,
            pageNumber: page,
            preset: drawingAnalysisPreset,
            maxLines: 1600,
          })
        : await analyzeDrawingGeometry({
            projectId,
            documentId: docId,
            pageNumber: page,
            preset: drawingAnalysisPreset,
            traceSystems: true,
            includeSymbols: true,
            includeTextRegions: true,
            includeCircles: true,
            maxLines: 1600,
            maxRegions: 180,
          });

      setDrawingAnalysisResult(result);
      if (result.warnings.length > 0) {
        setDrawingAnalysisError(result.warnings[0]);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Drawing analysis failed";
      setDrawingAnalysisError(message);
      setToastMessage(message);
      setToastType("error");
    } finally {
      setDrawingAnalysisRunning(false);
    }
  }

  function drawingSystemSegments(system: DrawingTracedSystem, result = drawingAnalysisResult): DrawingLineSegment[] {
    if (!result) return [];
    const ids = new Set(system.segmentIds);
    return result.lines.filter((line) => ids.has(line.id));
  }

  async function handleSaveDrawingSystem(system: DrawingTracedSystem) {
    if (!drawingAnalysisResult || !selectedDoc) return;
    const docId = selectedVisionDocumentId();
    const segments = drawingSystemSegments(system).slice(0, 750);
    if (segments.length === 0) return;

    setDrawingAnalysisSavingId(system.id);
    try {
      const groupName = `${system.label} (${drawingAnalysisPreset})`;
      const result = await saveDrawingDetectionsAsAnnotations({
        projectId,
        documentId: docId,
        pageNumber: page,
        imageWidth: drawingAnalysisResult.imageWidth,
        imageHeight: drawingAnalysisResult.imageHeight,
        analysisId: drawingAnalysisResult.analysisId,
        groupName,
        color: "#0ea5e9",
        detections: segments.map((segment) => ({
          id: segment.id,
          kind: "line_segment",
          label: system.label,
          annotationType: "linear",
          groupName,
          color: "#0ea5e9",
          lineThickness: 3,
          points: [
            { x: segment.x1, y: segment.y1 },
            { x: segment.x2, y: segment.y2 },
          ],
          confidence: Math.min(system.confidence, segment.confidence),
          source: "drawing-intelligence",
          measurement: { value: segment.lengthPx, unit: "px" },
          metadata: {
            sourceTool: "drawing-intelligence",
            analysisId: drawingAnalysisResult.analysisId,
            preset: drawingAnalysisPreset,
            systemId: system.id,
            systemLengthPx: system.lengthPx,
            systemCounts: system.counts,
            savedSegmentCount: segments.length,
          },
        })),
      });
      await loadAnnotationsRef.current();
      notifyAnnotationsMutated();
      setToastMessage(`Saved ${result.savedCount} traced line segments to takeoff.`);
      setToastType("success");
      if (segments.length < drawingSystemSegments(system).length) {
        setDrawingAnalysisError("Saved the first 750 segments from this system to keep the takeoff responsive.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save traced system";
      setToastMessage(message);
      setToastType("error");
    } finally {
      setDrawingAnalysisSavingId(null);
    }
  }

  async function handleSaveDrawingSymbol(candidate: DrawingSymbolCandidate) {
    if (!drawingAnalysisResult || !selectedDoc) return;
    const docId = selectedVisionDocumentId();

    setDrawingAnalysisSavingId(candidate.id);
    try {
      const result = await saveDrawingDetectionsAsAnnotations({
        projectId,
        documentId: docId,
        pageNumber: page,
        imageWidth: drawingAnalysisResult.imageWidth,
        imageHeight: drawingAnalysisResult.imageHeight,
        analysisId: drawingAnalysisResult.analysisId,
        groupName: "Drawing Intelligence Symbols",
        color: "#f59e0b",
        detections: [{
          id: candidate.id,
          kind: "symbol_candidate",
          label: "Symbol candidate",
          annotationType: "count",
          groupName: "Drawing Intelligence Symbols",
          color: "#f59e0b",
          points: [{ x: candidate.cx, y: candidate.cy }],
          count: 1,
          confidence: candidate.confidence,
          source: "drawing-intelligence",
          measurement: { value: 1, unit: "count" },
          metadata: {
            sourceTool: "drawing-intelligence",
            analysisId: drawingAnalysisResult.analysisId,
            preset: drawingAnalysisPreset,
            bounds: { x: candidate.x, y: candidate.y, width: candidate.w, height: candidate.h },
          },
        }],
      });
      await loadAnnotationsRef.current();
      notifyAnnotationsMutated();
      setToastMessage(`Saved ${result.savedCount} symbol mark to takeoff.`);
      setToastType("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save symbol candidate";
      setToastMessage(message);
      setToastType("error");
    } finally {
      setDrawingAnalysisSavingId(null);
    }
  }

  // Reset legend when the user switches doc or page — entries are page-specific.
  useEffect(() => {
    setLegendOpen(false);
    setLegendEntries(null);
    setLegendWarnings([]);
  }, [selectedDocId, page]);

  useEffect(() => {
    setDrawingAnalysisResult(null);
    setDrawingAnalysisError(null);
    setDrawingAnalysisSavingId(null);
  }, [selectedDocId, page]);

  function handleCalibrationConfirm() {
    if (!calibrationPoints || !calibrationInput) return;
    const knownDist = parseFloat(calibrationInput);
    if (knownDist <= 0 || isNaN(knownDist)) return;

    const [a, b] = calibrationPoints;
    const pixelDist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    // Normalise pixelsPerUnit to zoom 1 (paper-pixels per unit) so
    // measurements stay correct at any later zoom level.
    const pixelsPerUnit = (pixelDist / knownDist) / Math.max(zoom, 0.0001);

    const next: Calibration = { pixelsPerUnit, unit: calibrationUnit };
    setCalibration(next);
    setCalibrationPromptOpen(false);
    setCalibrationInput("");
    setCalibrationPoints(null);

    // Persist on WorkspaceState so the calibration survives reloads and
    // syncs to other open tabs / devices.
    if (selectedDocId) {
      const cache = calibrationCacheRef.current;
      const docCache = { ...(cache[selectedDocId] ?? {}) };
      if (calibrationApplyToAllPages) {
        // Mark this calibration as the document-wide default and clear any
        // page-specific overrides so every page picks it up.
        docCache.__default = next;
      } else {
        docCache[page] = next;
      }
      cache[selectedDocId] = docCache;
      void updateWorkspaceState(projectId, { takeoffCalibrations: cache }).catch(() => {});
    }
    setActiveTool("select");
  }

  /* Annotation CRUD */
  function handleToggleVisibility(id: string) {
    const nextAnnotations = annotations.map((a) => (a.id === id ? { ...a, visible: !a.visible } : a));
    setAnnotations(nextAnnotations);
    notifyAnnotationsMutated(nextAnnotations);
  }

  async function handleDeleteAnnotation(id: string) {
    const annotation = annotations.find((a) => a.id === id);
    const nextAnnotations = annotations.filter((a) => a.id !== id);
    setAnnotations(nextAnnotations);
    if (selectedAnnotationId === id) {
      updateAnnotationSelection(null);
    }
    try {
      await deleteTakeoffAnnotation(projectId, id);
    } catch {
      /* Ignore */
    }
    if (annotation) pushTakeoffHistory({ kind: "delete", annotation });
    notifyAnnotationsMutated();
  }

  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);

  function handleEditAnnotation(id: string) {
    updateAnnotationSelection(id);
    setEditingAnnotationId(id);
  }

  function handleSaveAnnotationEdit(id: string, updates: { label?: string; color?: string; groupName?: string }) {
    const nextAnnotations = annotations.map((a) => (a.id === id ? { ...a, ...updates } : a));
    setAnnotations(nextAnnotations);
    updateTakeoffAnnotation(projectId, id, updates)
      .then(() => notifyAnnotationsMutated())
      .catch(() => notifyAnnotationsMutated(nextAnnotations));
    setEditingAnnotationId(null);
  }

  /* Clear all annotations */
  function handleClearAll() {
    const removed = [...annotations];
    const deletions = annotations.map((ann) => deleteTakeoffAnnotation(projectId, ann.id).catch(() => {}));
    setAnnotations([]);
    if (removed.length > 0) pushTakeoffHistory({ kind: "clear", annotations: removed });
    Promise.allSettled(deletions).then(() => notifyAnnotationsMutated());
  }

  // Publish a snapshot of inspect-relevant state to the parent so the
  // side-panel Inspect tab can render the appropriate browse view.
  // Idempotent: skip the parent setState if the rendered snapshot is byte-equal
  // to the last one we published. Without this guard, a fresh object literal
  // each call defeated React's bailout and looped through parent re-renders.
  const lastPublishedSnapshotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!onInspectSnapshotChange) return;
    // selectedDocId defaults to the first project PDF on mount so the
    // viewer has something to open when the user clicks into a takeoff.
    // BUT while we're on the intake landing page (`showLanding && !detached`),
    // the user hasn't actually opened anything — surfacing the auto-selected
    // doc's elements in the right-hand Inspect panel is wrong. Force mode
    // "empty" in that case so the Inspect tab shows its empty state and
    // doesn't preview a model the estimator hasn't asked to see yet.
    const isLandingShown = showLanding && !detached;
    const mode: InspectSnapshot["mode"] = isLandingShown || !selectedDoc
      ? "empty"
      : isDwgDocument
        ? "dwg"
        : isBimDocument
          ? "bim"
          : isCadDocument
            ? "model"
            : isSpreadsheetDocument
              ? "spreadsheet"
              : "pdf";
    const inspectAnnotations =
      mode === "dwg" ? dwgAnnotationsCache : mode === "pdf" ? annotations : [];
    const inspectSelectedAnnotationId =
      mode === "dwg"
        ? selection?.kind === "annotation"
          ? selection.annotationId
          : null
        : selectedAnnotationId;
    // Both BIM and 3D-geometry modes carry model elements; PDF/DWG don't.
    const isModelMode = mode === "bim" || mode === "model";
    const inspectModelElements: InspectModelElement[] =
      isModelMode
        ? modelElements.map((element) => ({
            id: element.id,
            name: element.name || element.externalId,
            externalId: element.externalId,
            elementClass: element.elementClass ?? null,
            material: element.material ?? null,
            level: element.level ?? null,
            // Phase 2 BIM fields. classification is the typed record; lod/lodSource
            // come from the per-element schema columns. Use ?? to surface "" as null
            // so the UI can `lod ?? null` without falsy-vs-empty confusion.
            classification: (element as { classification?: Record<string, string> }).classification ?? null,
            lod: (element as { lod?: string }).lod ?? null,
            lodSource: (element as { lodSource?: string }).lodSource ?? null,
            quantitySummary: formatElementQuantity(element, modelLedgerBasis),
            isLinked: linkedModelElementIds.has(element.id),
          }))
        : [];
    // Spreadsheet rows surfaced as entities. Only populated when the active
    // doc is a spreadsheet AND its preview has loaded; otherwise null so the
    // side panel falls back to its empty state.
    const inspectSpreadsheet =
      mode === "spreadsheet" && spreadsheetPreview
        ? {
            sourceName: spreadsheetPreview.sourceName,
            rowCount: spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length,
            columnCount: spreadsheetPreview.headers.length,
            headers: spreadsheetPreview.headers,
            rows: spreadsheetPreview.sampleRows.map((row, index) => {
              const values: Record<string, string> = {};
              spreadsheetPreview.headers.forEach((header, colIdx) => {
                const raw = row[colIdx];
                values[header] = raw == null ? "" : String(raw);
              });
              return {
                id: `${spreadsheetPreview.sourceNodeId ?? spreadsheetPreview.sourceName}::${index}`,
                index,
                values,
              };
            }),
            mapping: deriveSpreadsheetMapping(spreadsheetPreview.headers),
          }
        : null;

    const nextSnapshot: InspectSnapshot = {
      mode,
      annotations: inspectAnnotations,
      takeoffLinks,
      selectedAnnotationId: inspectSelectedAnnotationId,
      editingAnnotationId,
      modelElements: inspectModelElements,
      modelElementsLoading,
      modelError,
      modelSyncing,
      modelSearch: modelElementSearch,
      modelBasis: modelLedgerBasis,
      modelAsset:
        isModelMode && selectedModelAsset
          ? {
              id: selectedModelAsset.id,
              fileName: selectedDoc?.fileName ?? selectedModelAsset.fileName,
              status: selectedModelAsset.status ?? "pending",
              parser: String(selectedModelAsset.manifest?.parser ?? selectedModelAsset.format ?? "Not indexed"),
              isEditable: selectedModelIsEditable,
              counts: {
                elements: selectedModelAsset._count?.elements ?? 0,
                quantities: selectedModelAsset._count?.quantities ?? 0,
                links: linkedModelLineItems.length,
                issues: selectedModelAsset._count?.issues ?? 0,
              },
            }
          : null,
      selectedModelElementId:
        selection?.kind === "model-element" ? selection.elementId : null,
      spreadsheet: inspectSpreadsheet,
      photoBom: photoBomResult
        ? {
            photoCount: photoBomSourcePhotoNames.length,
            summary: photoBomResult.summary,
            warnings: photoBomResult.warnings,
            rows: photoBomResult.items.map((row, idx) => {
              const rowId = `photo-bom-${idx}`;
              return {
                id: rowId,
                description: row.description,
                quantity: row.quantity,
                uom: row.uom,
                suggestedCategoryId: row.categoryId,
                confidence: row.confidence,
                notes: row.notes,
                sourcePhotoNames: row.sourceImageIndexes
                  .map((i) => photoBomSourcePhotoNames[i])
                  .filter((name): name is string => Boolean(name)),
                isLinked: photoBomLinkedRowIds.has(rowId),
              };
            }),
          }
        : null,
      availableCategories: entityCategories
        .filter((c) => c.enabled)
        .map((c) => ({
          id: c.id,
          name: c.name,
          itemSource: c.itemSource,
          enabled: c.enabled,
          order: c.order,
          rateScheduleItems: rateScheduleItemsByCategoryId.get(c.id) ?? [],
        }))
        .sort((a, b) => a.order - b.order),
      takeoffCategoryId: takeoffCategory?.id ?? null,
    };
    const serialized = JSON.stringify(nextSnapshot);
    if (serialized === lastPublishedSnapshotRef.current) return;
    lastPublishedSnapshotRef.current = serialized;
    onInspectSnapshotChange(nextSnapshot);
  }, [
    onInspectSnapshotChange,
    showLanding,
    detached,
    selectedDoc,
    isDwgDocument,
    isBimDocument,
    isCadDocument,
    isSpreadsheetDocument,
    annotations,
    dwgAnnotationsCache,
    selection,
    selectedAnnotationId,
    editingAnnotationId,
    takeoffLinks,
    modelElements,
    modelElementsLoading,
    modelError,
    modelSyncing,
    modelElementSearch,
    modelLedgerBasis,
    selectedModelAsset,
    selectedModelIsEditable,
    linkedModelElementIds,
    linkedModelLineItems.length,
    spreadsheetPreview,
    entityCategories,
    rateScheduleItemsByCategoryId,
    takeoffCategory,
    photoBomResult,
    photoBomSourcePhotoNames,
    photoBomLinkedRowIds,
  ]);

  async function resolveSelectedModelAsset() {
    if (selectedModelAsset) return selectedModelAsset;
    if (!isCadDocument || !selectedDoc) return undefined;

    const result = await syncModelAssets(projectId);
    const assets = result.assets ?? [];
    setModelAssets(assets);
    return assets.find((asset) =>
      (selectedDoc.modelAssetId && asset.id === selectedDoc.modelAssetId) ||
      (selectedDoc.fileNodeId && asset.fileNodeId === selectedDoc.fileNodeId) ||
      (selectedDoc.source === "project" && asset.sourceDocumentId === selectedDoc.id) ||
      asset.fileName.toLowerCase() === selectedDoc.fileName.toLowerCase()
    );
  }

  async function handleSendModelSelectionToEstimate(
    selection: BidwrightModelSelectionMessage,
    lineItemDraft?: BidwrightModelLineItemDraft,
    lineItemDrafts?: BidwrightModelLineItemDraft[],
    explicitWs?: { id: string; name: string },
  ) {
    try {
      const draftList = (lineItemDrafts?.length
        ? lineItemDrafts
        : lineItemDraft
          ? [lineItemDraft]
          : buildModelSelectionObjectDrafts(selection, {
              fileName: selectedDoc?.fileName,
              markup: workspace.currentRevision.defaultMarkup ?? 0.2,
              category: takeoffCategory,
            })
      ).slice(0, 250);
      const modelAsset = await resolveSelectedModelAsset();
      let previousItemIds = new Set(workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
      let createdCount = 0;
      let targetWorksheetName = explicitWs?.name ?? selectedWorksheet?.name ?? "worksheet";

      for (const draft of draftList) {
        const targetWs =
          (draft?.worksheetId
            ? workspace.worksheets.find((worksheet) => worksheet.id === draft.worksheetId)
            : null) ?? explicitWs ?? selectedWorksheet;
        if (!targetWs) {
          setWorksheetPickerAction({ kind: "send-selection" });
          return;
        }
        targetWorksheetName = targetWs.name;

        const draftSelection = selectionFromDraft(selection, draft);
        const fallbackPayload = buildModelSelectionLineItem(draftSelection, {
          fileName: selectedDoc?.fileName,
          markup: workspace.currentRevision.defaultMarkup ?? 0.2,
          category: takeoffCategory,
        });
        const payload = normalizeModelLineItemDraft(draft, fallbackPayload);
        const result = await createWorksheetItem(projectId, targetWs.id, payload);
        const createdItem = result.workspace.worksheets
          .flatMap((worksheet) => worksheet.items)
          .find((item) => !previousItemIds.has(item.id));

        if (modelAsset && createdItem) {
          await createModelTakeoffLink(projectId, modelAsset.id, {
            worksheetItemId: createdItem.id,
            modelElementId: draft.source?.modelElementId ?? null,
            modelQuantityId: draft.source?.modelQuantityId ?? null,
            quantityField: "quantity",
            multiplier: 1,
            derivedQuantity: payload.quantity,
            selection: {
              fileName: selectedDoc?.fileName ?? selection.fileName ?? null,
              documentId: draftSelection.documentId ?? null,
              documentName: draftSelection.documentName ?? null,
              selectedCount: draftSelection.selectedCount,
              nodes: draftSelection.nodes,
              totals: draftSelection.totals,
              quantityBasis: draft.source?.quantityBasis ?? selection.quantityBasis ?? "count",
              quantityType: draft.source?.quantityType ?? null,
              source: draft.source ?? null,
              lineItemDraft: payload,
            },
          });
          createdCount += 1;
        }

        previousItemIds = new Set(result.workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
      }

      if (modelAsset) {
        await refreshModelTakeoffLinks(modelAsset.id);
      }

      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Created ${createdCount || draftList.length} model line item${(createdCount || draftList.length) === 1 ? "" : "s"} in ${targetWorksheetName}.`);
    } catch (err) {
      console.error("[takeoff] Failed to send model selection to estimate:", err);
      setToastType("error");
      setToastMessage("Could not send model quantity to the estimate.");
    }
  }

  async function createLineItemFromModelElement(
    element: ModelElementWithQuantities,
    pickInput: string | InspectCategoryPick,
    previousItemIds = new Set(workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id)),
    explicitWs?: { id: string; name: string },
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-single-element", elementId: element.id, pick });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
      return null;
    }
    const modelAsset = await resolveSelectedModelAsset();
    if (!modelAsset) {
      setToastType("error");
      setToastMessage("Sync the model index before creating model line items.");
      return null;
    }

    const primary = getModelElementTakeoffQuantity(element, modelLedgerBasis);
    const basePayload = buildModelElementLineItem(element, primary, {
      fileName: selectedDoc?.fileName,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      category: takeoffCategory,
    });
    const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
    if (!payload) return null;
    const result = await createWorksheetItem(projectId, ws.id, payload);
    const createdItem = result.workspace.worksheets
      .flatMap((worksheet) => worksheet.items)
      .find((item) => !previousItemIds.has(item.id));
    if (!createdItem) return null;

    await createModelTakeoffLink(projectId, modelAsset.id, {
      worksheetItemId: createdItem.id,
      modelElementId: element.id,
      modelQuantityId: primary.quantityId,
      quantityField: "quantity",
      multiplier: 1,
      derivedQuantity: payload.quantity,
      selection: {
        mode: "model-element",
        fileName: selectedDoc?.fileName ?? modelAsset.fileName,
        modelElementId: element.id,
        externalId: element.externalId,
        elementName: element.name,
        elementClass: element.elementClass,
        material: element.material,
        quantityBasis: modelLedgerBasis,
        quantityType: primary.quantityType,
        quantities: element.quantities ?? [],
        lineItemDraft: payload,
      },
    });
    return { createdItem, result };
  }

  /** Pick the right primary quantity off an annotation's measurement.
   *  Areas / volumes win over linear value when present; pure count
   *  annotations fall back to qty=1. */
  function annotationToQuantity(annotation: TakeoffAnnotation): { quantity: number; uom: string } {
    const m = annotation.measurement;
    if (m?.area != null && m.area > 0) {
      const baseUnit = m.unit ?? "";
      return { quantity: m.area, uom: baseUnit ? `${baseUnit}²` : "SF" };
    }
    if (m?.volume != null && m.volume > 0) {
      const baseUnit = m.unit ?? "";
      return { quantity: m.volume, uom: baseUnit ? `${baseUnit}³` : "CF" };
    }
    if (typeof m?.value === "number" && Number.isFinite(m.value)) {
      return { quantity: m.value, uom: m.unit || "EA" };
    }
    return { quantity: 1, uom: "EA" };
  }

  async function createLineItemFromAnnotation(
    annotation: TakeoffAnnotation,
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-single-annotation", annotationId: annotation.id, pick });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
      return null;
    }

    const { quantity, uom } = annotationToQuantity(annotation);
    const previousItemIds = new Set(workspace.worksheets.flatMap((w) => w.items).map((i) => i.id));
    const basePayload: CreateWorksheetItemInput = {
      categoryId: takeoffCategory.id,
      category: takeoffCategory.name,
      entityType: takeoffCategory.entityType,
      entityName: annotation.label || `${annotation.type} mark`,
      description: "",
      quantity,
      uom,
      cost: 0,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: 0,
      sourceNotes: [
        `From takeoff (${annotation.type})`,
        annotation.groupName ? `group: ${annotation.groupName}` : "",
        selectedDoc?.fileName ? `doc: ${selectedDoc.fileName}` : "",
      ].filter(Boolean).join(" · "),
    };
    const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
    if (!payload) return null;
    const result = await createWorksheetItem(projectId, ws.id, payload);
    const createdItem = result.workspace.worksheets
      .flatMap((w) => w.items)
      .find((i) => !previousItemIds.has(i.id));
    if (!createdItem) return null;
    await createTakeoffLink(projectId, {
      annotationId: annotation.id,
      worksheetItemId: createdItem.id,
    });
    return { createdItem };
  }

  async function handleCreateAnnotationLineItem(annotation: TakeoffAnnotation, pick: string | InspectCategoryPick) {
    try {
      const created = await createLineItemFromAnnotation(annotation, pick);
      if (!created) return;
      await loadTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Created line item from annotation.");
    } catch (error) {
      console.error("[takeoff] Failed to create annotation line item:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a line item from that annotation."));
    }
  }

  /** Group-sum: one summed line item from N annotations. Each underlying
   *  annotation gets a TakeoffLink with multiplier set so the line item's
   *  quantity stays in sync with the sum on revision diff. */
  async function createLineItemFromAnnotationGroup(
    annotations: TakeoffAnnotation[],
    groupLabel: string,
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (annotations.length === 0) return null;
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({
        kind: "create-annotation-group",
        annotationIds: annotations.map((a) => a.id),
        groupLabel,
        pick,
      });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
      return null;
    }

    // Sum quantities. Prefer a consistent dimension across the group; if mixed
    // (some areas + some lengths) fall back to count so we never silently add
    // square feet to linear feet.
    const dims = new Set(annotations.map((a) => {
      const m = a.measurement;
      if (m?.area && m.area > 0) return "area";
      if (m?.volume && m.volume > 0) return "volume";
      if (typeof m?.value === "number") return "length";
      return "count";
    }));
    const homogeneous = dims.size === 1;
    let totalQty = 0;
    let uom = "EA";
    if (homogeneous) {
      const first = annotationToQuantity(annotations[0]);
      uom = first.uom;
      for (const ann of annotations) totalQty += annotationToQuantity(ann).quantity;
    } else {
      totalQty = annotations.length;
      uom = "EA";
    }

    const previousItemIds = new Set(workspace.worksheets.flatMap((w) => w.items).map((i) => i.id));
    const basePayload: CreateWorksheetItemInput = {
      categoryId: takeoffCategory.id,
      category: takeoffCategory.name,
      entityType: takeoffCategory.entityType,
      entityName: groupLabel || `${annotations.length} takeoff marks`,
      description: "",
      quantity: totalQty,
      uom,
      cost: 0,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: 0,
      sourceNotes: [
        `Sum of ${annotations.length} takeoff marks`,
        homogeneous ? "" : "mixed dimensions — falling back to count",
        selectedDoc?.fileName ? `doc: ${selectedDoc.fileName}` : "",
      ].filter(Boolean).join(" · "),
    };
    const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
    if (!payload) return null;
    const result = await createWorksheetItem(projectId, ws.id, payload);
    const createdItem = result.workspace.worksheets
      .flatMap((w) => w.items)
      .find((i) => !previousItemIds.has(i.id));
    if (!createdItem) return null;
    // Link each annotation to the summed line item so revision diff can
    // reconcile additions/removals against the same worksheet row.
    await Promise.all(
      annotations.map((ann) =>
        createTakeoffLink(projectId, {
          annotationId: ann.id,
          worksheetItemId: createdItem.id,
        }).catch((err) => {
          console.warn(`[takeoff] Could not link annotation ${ann.id} to summed line item:`, err);
        }),
      ),
    );
    return { createdItem };
  }

  async function handleCreateAnnotationGroupLineItem(annotations: TakeoffAnnotation[], groupLabel: string, pick: string | InspectCategoryPick) {
    try {
      const created = await createLineItemFromAnnotationGroup(annotations, groupLabel, pick);
      if (!created) return;
      await loadTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Created summed line item from ${annotations.length} mark${annotations.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("[takeoff] Failed to create annotation group line item:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a summed line item."));
    }
  }

  /** Group-sum for model elements. Sums the primary takeoff quantity (based on
   *  the current ledger basis) across N elements and creates one line item. */
  async function createLineItemFromElementGroup(
    elements: ModelElementWithQuantities[],
    groupLabel: string,
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (elements.length === 0) return null;
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({
        kind: "create-element-group",
        elementIds: elements.map((e) => e.id),
        groupLabel,
        pick,
      });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
      return null;
    }
    const modelAsset = await resolveSelectedModelAsset();
    if (!modelAsset) {
      setToastType("error");
      setToastMessage("Sync the model index before creating model line items.");
      return null;
    }

    let totalQty = 0;
    let uom = "EA";
    let primaryQuantityType: string | undefined;
    const uomCounts = new Map<string, number>();
    for (const element of elements) {
      const primary = getModelElementTakeoffQuantity(element, modelLedgerBasis);
      if (!primary) continue;
      totalQty += primary.quantity;
      if (!primaryQuantityType) primaryQuantityType = primary.quantityType;
      const elementUom = primary.uom || "EA";
      uomCounts.set(elementUom, (uomCounts.get(elementUom) ?? 0) + 1);
    }
    // Pick the mode UOM. If mixed, fall back to count semantics.
    const sortedUoms = Array.from(uomCounts.entries()).sort((a, b) => b[1] - a[1]);
    if (sortedUoms.length === 1) {
      uom = sortedUoms[0][0];
    } else if (sortedUoms.length > 1) {
      totalQty = elements.length;
      uom = "EA";
    }

    const previousItemIds = new Set(workspace.worksheets.flatMap((w) => w.items).map((i) => i.id));
    const basePayload: CreateWorksheetItemInput = {
      categoryId: takeoffCategory.id,
      category: takeoffCategory.name,
      entityType: takeoffCategory.entityType,
      entityName: groupLabel || `${elements.length} model elements`,
      description: "",
      quantity: totalQty,
      uom,
      cost: 0,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: 0,
      sourceNotes: [
        `Sum of ${elements.length} model element${elements.length === 1 ? "" : "s"}`,
        sortedUoms.length > 1 ? "mixed UOMs — falling back to count" : "",
        selectedDoc?.fileName ? `doc: ${selectedDoc.fileName}` : "",
      ].filter(Boolean).join(" · "),
    };
    const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
    if (!payload) return null;
    const result = await createWorksheetItem(projectId, ws.id, payload);
    const createdItem = result.workspace.worksheets
      .flatMap((w) => w.items)
      .find((i) => !previousItemIds.has(i.id));
    if (!createdItem) return null;
    // Bind every element to the summed line item via a ModelTakeoffLink so
    // revision diff against the underlying model still tracks the rollup.
    await Promise.all(
      elements.map((element) => {
        const primary = getModelElementTakeoffQuantity(element, modelLedgerBasis);
        return createModelTakeoffLink(projectId, modelAsset.id, {
          worksheetItemId: createdItem.id,
          modelElementId: element.id,
          modelQuantityId: primary?.quantityId,
          quantityField: "quantity",
          multiplier: 1,
          derivedQuantity: primary?.quantity ?? 0,
          selection: {
            mode: "model-element",
            fileName: selectedDoc?.fileName ?? modelAsset.fileName,
            modelElementId: element.id,
            externalId: element.externalId,
            elementName: element.name,
            elementClass: element.elementClass,
            material: element.material,
            quantityBasis: modelLedgerBasis,
            quantityType: primary?.quantityType ?? primaryQuantityType,
            quantities: element.quantities ?? [],
            lineItemDraft: payload,
          },
        }).catch((err) => {
          console.warn(`[takeoff] Could not link element ${element.id} to summed line item:`, err);
        });
      }),
    );
    return { createdItem };
  }

  async function handleCreateElementGroupLineItem(elements: ModelElementWithQuantities[], groupLabel: string, pick: string | InspectCategoryPick) {
    try {
      const created = await createLineItemFromElementGroup(elements, groupLabel, pick);
      if (!created) return;
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Created summed line item from ${elements.length} model element${elements.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("[takeoff] Failed to create element group line item:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a summed line item."));
    }
  }

  /** Build a line-item payload from a single spreadsheet row using the
   *  heuristic column mapping. Numeric fields are best-effort parsed; non-
   *  numeric values fall through to sensible defaults so the row still
   *  creates something the estimator can refine inline. */
  function buildLineItemFromRow(
    row: string[],
    headers: string[],
    mapping: ReturnType<typeof deriveSpreadsheetMapping>,
    category: EntityCategory,
  ) {
    const col = (header: string | null) => (header ? headers.indexOf(header) : -1);
    const readNum = (header: string | null) => {
      const idx = col(header);
      if (idx < 0) return null;
      const raw = String(row[idx] ?? "").replace(/[$,%\s,]/g, "");
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const readStr = (header: string | null) => {
      const idx = col(header);
      if (idx < 0) return "";
      const raw = row[idx];
      return raw == null ? "" : String(raw);
    };

    const entityName = readStr(mapping.name).trim() || "Imported row";
    const quantity = readNum(mapping.quantity) ?? 1;
    const uom = readStr(mapping.uom).trim().toUpperCase() || category.defaultUom || "EA";
    const cost = readNum(mapping.cost) ?? 0;

    return {
      categoryId: category.id,
      category: category.name,
      entityType: category.entityType,
      entityName,
      description: "",
      quantity,
      uom,
      cost,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: cost * quantity * (1 + (workspace.currentRevision.defaultMarkup ?? 0.2)),
      sourceNotes: `From spreadsheet ${spreadsheetPreview?.sourceName ?? selectedDoc?.fileName ?? ""}`.trim(),
    };
  }

  async function createLineItemFromSpreadsheetRow(
    rowIndex: number,
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (!spreadsheetPreview) return null;
    const row = spreadsheetPreview.sampleRows[rowIndex];
    if (!row) return null;
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-spreadsheet-row", rowIndex, pick });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before importing rows.");
      return null;
    }
    const mapping = deriveSpreadsheetMapping(spreadsheetPreview.headers);
    const basePayload = buildLineItemFromRow(row, spreadsheetPreview.headers, mapping, takeoffCategory);
    const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
    if (!payload) return null;
    await createWorksheetItem(projectId, ws.id, payload);
    return { ok: true as const };
  }

  async function handleCreateSpreadsheetRowLineItem(rowIndex: number, pick: string | InspectCategoryPick) {
    try {
      const result = await createLineItemFromSpreadsheetRow(rowIndex, pick);
      if (!result) return;
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Imported row to worksheet.");
    } catch (error) {
      console.error("[takeoff] Failed to import spreadsheet row:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not import that row."));
    }
  }

  async function createLineItemsFromAllSpreadsheetRows(
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (!spreadsheetPreview || spreadsheetPreview.sampleRows.length === 0) return null;
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-spreadsheet-all", pick });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before importing rows.");
      return null;
    }
    const mapping = deriveSpreadsheetMapping(spreadsheetPreview.headers);
    let imported = 0;
    for (const row of spreadsheetPreview.sampleRows) {
      const basePayload = buildLineItemFromRow(row, spreadsheetPreview.headers, mapping, takeoffCategory);
      const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
      if (!payload) return null;
      await createWorksheetItem(projectId, ws.id, payload);
      imported += 1;
    }
    return { imported };
  }

  async function handleCreateAllSpreadsheetLineItems(pick: string | InspectCategoryPick) {
    try {
      const result = await createLineItemsFromAllSpreadsheetRows(pick);
      if (!result) return;
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Imported ${result.imported} row${result.imported === 1 ? "" : "s"} to worksheet.`);
    } catch (error) {
      console.error("[takeoff] Failed to import all spreadsheet rows:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not import all rows."));
    }
  }

  /** Build a CreateWorksheetItemInput from one AI-suggested photo BOM row.
   *  The category is whatever the user picked in the + Add popover; the
   *  rest of the fields come straight off the model output. SourceNotes
   *  cite the photos so the line stays traceable after creation. */
  async function createLineItemFromPhotoBomRow(rowIndex: number, pickInput: string | InspectCategoryPick) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (!photoBomResult) return;
    const row = photoBomResult.items[rowIndex];
    if (!row) return;
    const ws = selectedWorksheet;
    if (!ws) {
      setToastType("error");
      setToastMessage("Pick an active worksheet before adding photo-BOM rows.");
      return;
    }
    const category = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!category) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
      return;
    }
    const sourcePhotoNames = row.sourceImageIndexes
      .map((i) => photoBomSourcePhotoNames[i])
      .filter((name): name is string => Boolean(name));
    const sourceNotes = [
      "From site-photo BOM (AI vision)",
      row.notes,
      sourcePhotoNames.length > 0 ? `Sourced from: ${sourcePhotoNames.join(", ")}` : "",
      `Confidence: ${(row.confidence * 100).toFixed(0)}%`,
    ]
      .filter(Boolean)
      .join("\n");
    const basePayload: CreateWorksheetItemInput = {
      categoryId: category.id,
      category: category.name,
      entityType: category.entityType,
      entityName: row.description,
      description: "",
      quantity: row.quantity,
      uom: row.uom || category.defaultUom || "EA",
      cost: 0,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: 0,
      sourceNotes,
    };
    const payload = applyCategoryPickToPayload(basePayload, category, pick);
    if (!payload) return;
    try {
      await createWorksheetItem(projectId, ws.id, payload);
      setPhotoBomLinkedRowIds((prev) => {
        const next = new Set(prev);
        next.add(`photo-bom-${rowIndex}`);
        return next;
      });
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Imported photo BOM row to worksheet.");
    } catch (error) {
      console.error("[takeoff] Failed to add photo BOM row:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not add that photo BOM row."));
    }
  }

  async function createLineItemsFromAllPhotoBomRows(pick: string | InspectCategoryPick) {
    if (!photoBomResult) return;
    const unlinked = photoBomResult.items
      .map((row, idx) => ({ row, idx }))
      .filter(({ idx }) => !photoBomLinkedRowIds.has(`photo-bom-${idx}`));
    if (unlinked.length === 0) {
      setToastType("error");
      setToastMessage("No unlinked photo BOM rows to add.");
      return;
    }
    for (const { idx } of unlinked) {
      // Each call surfaces its own error toast; bail on the first failure
      // so we don't fill the toast queue with the same complaint.
      await createLineItemFromPhotoBomRow(idx, pick);
    }
  }

  async function handleCreateModelElementLineItem(element: ModelElementWithQuantities, pick: string | InspectCategoryPick) {
    try {
      const created = await createLineItemFromModelElement(element, pick);
      // null = the call short-circuited (e.g. no worksheet → picker opened).
      // Don't celebrate; the resumed flow after the picker emits its own toast.
      if (!created) return;
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Created model line item.");
    } catch (error) {
      console.error("[takeoff] Failed to create model element line item:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a line item from that model element."));
    }
  }

  async function handleCreateSelectedModelElements(explicitWs?: { id: string; name: string }) {
    const candidates = selectedModelElements.filter((element) => !linkedModelElementIds.has(element.id));
    if (candidates.length === 0) {
      setToastType("error");
      setToastMessage("Select unlinked model elements first.");
      return;
    }
    // The legacy multi-select Send-to-Estimate flow (driven by the
    // BidwrightModelEditor toolbar) doesn't go through the AddToCategoryPopover.
    // Use the global takeoffCategory memo (the last-used / heuristic default)
    // as a sensible fallback so the action still works from that surface.
    const categoryId = takeoffCategory?.id;
    if (!categoryId) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
      return;
    }

    try {
      let created = 0;
      let previousItemIds = new Set(workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
      for (const element of candidates.slice(0, 250)) {
        const createdResult = await createLineItemFromModelElement(element, categoryId, previousItemIds, explicitWs);
        if (createdResult?.createdItem) created += 1;
        if (createdResult?.result) {
          previousItemIds = new Set(createdResult.result.workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
        }
      }
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setSelectedModelElementIds(new Set());
      setToastType("success");
      setToastMessage(`Created ${created} model line item${created === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("[takeoff] Failed to create selected model line items:", error);
      setToastType("error");
      setToastMessage("Could not create model line items.");
    }
  }

  async function handleUpdateModelLinkedLineItem(payload: {
    linkId: string;
    worksheetItemId: string;
    patch: { entityName?: string; description?: string; quantity?: number; uom?: string };
  }) {
    const patch = {
      ...(typeof payload.patch.entityName === "string" ? { entityName: payload.patch.entityName } : {}),
      ...(typeof payload.patch.description === "string" ? { description: payload.patch.description } : {}),
      ...(typeof payload.patch.quantity === "number" && Number.isFinite(payload.patch.quantity)
        ? { quantity: payload.patch.quantity }
        : {}),
      ...(typeof payload.patch.uom === "string" ? { uom: payload.patch.uom } : {}),
    };

    try {
      await updateWorksheetItem(projectId, payload.worksheetItemId, patch);
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Updated linked worksheet line item.");
    } catch (error) {
      console.error("[takeoff] Failed to update linked model line item:", error);
      setToastType("error");
      setToastMessage("Could not update linked line item.");
    }
  }

  async function handleDeleteModelLinkedLineItem(payload: { linkId: string; worksheetItemId: string }) {
    try {
      if (selectedModelAsset?.id) {
        await deleteModelTakeoffLink(projectId, selectedModelAsset.id, payload.linkId).catch(() => null);
      }
      await deleteWorksheetItem(projectId, payload.worksheetItemId);
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Deleted linked worksheet line item.");
    } catch (error) {
      console.error("[takeoff] Failed to delete linked model line item:", error);
      setToastType("error");
      setToastMessage("Could not delete linked line item.");
    }
  }

  /* Build document URL */
  const documentUrl = selectedDoc ? buildPdfUrl(selectedDoc) : "";

  async function runPendingPickerAction(action: WorksheetPickerAction, ws: { id: string; name: string }) {
    if (action.kind === "send-selection" && modelSelection) {
      await handleSendModelSelectionToEstimate(modelSelection, undefined, undefined, ws);
    } else if (action.kind === "create-elements") {
      await handleCreateSelectedModelElements(ws);
    } else if (action.kind === "create-single-element") {
      const element = modelElements.find((e) => e.id === action.elementId);
      if (!element) {
        setToastType("error");
        setToastMessage("That model element is no longer available.");
        return;
      }
      await createLineItemFromModelElement(element, action.pick, undefined, ws);
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Created model line item.");
    } else if (action.kind === "create-element-group") {
      const elements = action.elementIds
        .map((id) => modelElements.find((e) => e.id === id))
        .filter((e): e is ModelElementWithQuantities => Boolean(e));
      if (elements.length === 0) {
        setToastType("error");
        setToastMessage("Those model elements are no longer available.");
        return;
      }
      await createLineItemFromElementGroup(elements, action.groupLabel, action.pick, ws);
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Created summed line item from ${elements.length} model element${elements.length === 1 ? "" : "s"}.`);
    } else if (action.kind === "create-single-annotation") {
      const allAnnotations = [...annotations, ...dwgAnnotationsCache];
      const annotation = allAnnotations.find((a) => a.id === action.annotationId);
      if (!annotation) {
        setToastType("error");
        setToastMessage("That annotation is no longer available.");
        return;
      }
      await createLineItemFromAnnotation(annotation, action.pick, ws);
      await loadTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Created line item from annotation.");
    } else if (action.kind === "create-annotation-group") {
      const allAnnotations = [...annotations, ...dwgAnnotationsCache];
      const targets = action.annotationIds
        .map((id) => allAnnotations.find((a) => a.id === id))
        .filter((a): a is TakeoffAnnotation => Boolean(a));
      if (targets.length === 0) {
        setToastType("error");
        setToastMessage("Those annotations are no longer available.");
        return;
      }
      await createLineItemFromAnnotationGroup(targets, action.groupLabel, action.pick, ws);
      await loadTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Created summed line item from ${targets.length} mark${targets.length === 1 ? "" : "s"}.`);
    } else if (action.kind === "create-spreadsheet-row") {
      await createLineItemFromSpreadsheetRow(action.rowIndex, action.pick, ws);
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Imported row to worksheet.");
    } else if (action.kind === "create-spreadsheet-all") {
      const result = await createLineItemsFromAllSpreadsheetRows(action.pick, ws);
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Imported ${result?.imported ?? 0} row${result?.imported === 1 ? "" : "s"} to worksheet.`);
    }
  }

  async function handleWorksheetPickerSelect(wsId: string) {
    const ws = workspace.worksheets.find((w) => w.id === wsId);
    if (!ws || !worksheetPickerAction) return;
    await runPendingPickerAction(worksheetPickerAction, ws);
    setWorksheetPickerAction(null);
    setNewWorksheetName("");
  }

  async function handleCreateWorksheetAndProceed(nameOverride?: string) {
    const name = (nameOverride ?? newWorksheetName).trim();
    if (!name || !worksheetPickerAction) return;
    const action = worksheetPickerAction;
    try {
      const result = await createWorksheet(projectId, { name });
      const ws = result.workspace.worksheets.at(-1);
      notifyWorkspaceMutated();
      if (ws) {
        await runPendingPickerAction(action, ws);
      }
      setWorksheetPickerAction(null);
      setNewWorksheetName("");
    } catch (err) {
      console.error("[takeoff] Failed to create worksheet:", err);
      setToastType("error");
      setToastMessage("Could not create worksheet.");
    }
  }

  const zoomPercent = Math.round(zoom * 100);

  /* Determine if special tools are active */
  const isAutoCountActive = activeTool === "auto-count";

  function isMeasurementTool(tool: string | null): boolean {
    if (!tool) return false;
    return (
      tool === "linear" ||
      tool === "linear-polyline" ||
      tool === "linear-drop" ||
      tool === "count-by-distance" ||
      tool.startsWith("area-")
    );
  }
  const isAskAiActive = activeTool === "ask-ai";
  const isSmartCountActive = activeTool === "smart-count";
  const isRectSelectTool = isAutoCountActive || isAskAiActive || isSmartCountActive;
  const activeToolDef = TOOLS.find((tool) => tool.id === activeTool) ?? TOOLS[0];
  const canUndoTakeoff = historyVersion >= 0 && undoStackRef.current.length > 0;
  const canRedoTakeoff = historyVersion >= 0 && redoStackRef.current.length > 0;
  const bimDocuments = takeoffDocuments.filter((doc) => doc.kind === "bim");
  const modelDocuments = takeoffDocuments.filter((doc) => doc.kind === "model");
  const dwgDocumentCount = dwgDocuments.length;
  const spreadsheetSources = fileTreeNodes.filter((node) => node.type === "file" && isSpreadsheetFile(node.name));
  // Site Photos draws from both upload paths: FileNodes (Documents tab
  // "Upload into folder" flow) AND SourceDocuments (project intake or a
  // Documents-tab drop at the root, which becomes a `reference`-typed
  // source doc). Without surfacing both, JPEGs dropped at the root were
  // showing zero on the intake card.
  const photoSources: PhotoSource[] = useMemo(() => {
    const fromFileTree: PhotoSource[] = fileTreeNodes
      .filter((node) => node.type === "file" && isPhotoFile(node.name))
      .map((node) => ({
        id: `fn-${node.id}`,
        rawId: node.id,
        name: node.name,
        size: node.size,
        origin: "fileNode" as const,
      }));
    const fromSourceDocs: PhotoSource[] = (workspace.sourceDocuments ?? [])
      .filter((doc) => isPhotoFile(doc.fileName))
      .map((doc) => ({
        id: `src-${doc.id}`,
        rawId: doc.id,
        name: doc.fileName,
        origin: "sourceDocument" as const,
      }));
    return [...fromFileTree, ...fromSourceDocs];
  }, [fileTreeNodes, workspace.sourceDocuments]);
  const spreadsheetProfiles = spreadsheetPreview?.columnProfiles?.length
    ? spreadsheetPreview.columnProfiles
    : (spreadsheetPreview?.headers ?? []).map((header, index) => {
        const values = spreadsheetPreview?.sampleRows.map((row) => row[index] ?? "").filter(Boolean) ?? [];
        const numericValues = values
          .map((value) => Number(String(value).replace(/[$,%\s,]/g, "")))
          .filter((value) => Number.isFinite(value));
        return {
          header,
          nonEmptyCount: values.length,
          numericCount: numericValues.length,
          distinctCount: new Set(values.map((value) => String(value).toLowerCase())).size,
          sampleValues: Array.from(new Set(values.map(String))).slice(0, 5),
          sum: numericValues.length ? numericValues.reduce((sum, value) => sum + value, 0) : undefined,
          min: numericValues.length ? Math.min(...numericValues) : undefined,
          max: numericValues.length ? Math.max(...numericValues) : undefined,
        };
      });
  const spreadsheetGroupOptions = spreadsheetProfiles
    .filter((profile) => profile.nonEmptyCount > 0 && profile.numericCount < profile.nonEmptyCount)
    .map((profile) => ({ value: profile.header, label: profile.header }));
  const spreadsheetMeasureOptions = [
    { value: "__count", label: "Row count" },
    ...spreadsheetProfiles
      .filter((profile) => profile.numericCount > 0)
      .map((profile) => ({ value: profile.header, label: profile.header })),
  ];
  const activePivotSummary =
    spreadsheetPreview?.pivotSummaries?.find((summary) => summary.groupBy === pivotGroupBy && summary.measure === pivotMeasure) ??
    spreadsheetPreview?.pivotSummaries?.find((summary) => summary.groupBy === pivotGroupBy) ??
    spreadsheetPreview?.pivotSummaries?.[0];
  const maxPivotTotal = Math.max(...(activePivotSummary?.rows.map((row) => row.total) ?? [0]), 1);

  async function previewSpreadsheetFile(file: File, source: { nodeId?: string; name: string }) {
    setSpreadsheetPreviewLoading(true);
    setSelectedSpreadsheetNodeId(source.nodeId ?? null);
    try {
      const preview = await importPreview(projectId, file);
      const nextPreview = { ...preview, sourceName: source.name, sourceNodeId: source.nodeId };
      setSpreadsheetPreview(nextPreview);
      setSpreadsheetPanelView("preview");
      const firstPivot = preview.pivotSummaries?.[0];
      setPivotGroupBy(firstPivot?.groupBy ?? preview.headers[0] ?? "");
      setPivotMeasure(firstPivot?.measure ?? "__count");
    } catch (error) {
      console.error("[takeoff] Spreadsheet preview failed:", error);
      setToastType("error");
      setToastMessage("Could not preview that spreadsheet or CSV.");
    } finally {
      setSpreadsheetPreviewLoading(false);
    }
  }

  async function previewSpreadsheetNode(node: FileNode) {
    try {
      setSpreadsheetPreviewLoading(true);
      setSelectedSpreadsheetNodeId(node.id);
      const response = await fetch(getFileDownloadUrl(projectId, node.id, true), {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      const blob = await response.blob();
      const file = new File([blob], node.name, { type: blob.type || node.fileType || "application/octet-stream" });
      await previewSpreadsheetFile(file, { nodeId: node.id, name: node.name });
    } catch (error) {
      console.error("[takeoff] Spreadsheet source load failed:", error);
      setToastType("error");
      setToastMessage("Could not open that spreadsheet source.");
    } finally {
      setSpreadsheetPreviewLoading(false);
    }
  }
  // Refresh the ref every render so the auto-preview effect sees the latest
  // closure (projectId, setters, toast helpers).
  previewSpreadsheetNodeRef.current = previewSpreadsheetNode;

  function openTakeoffSurface(docId?: string) {
    const nextDocId = docId ?? selectedDocId ?? takeoffDocuments[0]?.id;
    if (nextDocId) {
      setSelectedDocId(nextDocId);
    }
    if (!nextDocId) {
      setToastType("error");
      setToastMessage("No takeoff source selected.");
      return;
    }
    setShowLanding(false);
  }

  type IntakeOptionTone = "spreadsheet" | "pdf" | "dwg" | "bim" | "model" | "photo";
  const intakeToneClasses: Record<
    IntakeOptionTone,
    { accent: string; active: string; hover: string; icon: string; rail: string; wash: string; ghost: string }
  > = {
    spreadsheet: {
      accent: "text-emerald-600",
      active: "border-emerald-600/45 ring-2 ring-emerald-600/10",
      hover: "hover:border-emerald-600/45",
      icon: "border-emerald-600/25 bg-emerald-600/10 text-emerald-600",
      rail: "bg-emerald-600",
      wash: "bg-emerald-600/5",
      ghost: "text-emerald-600/[0.06] group-hover/card:text-emerald-600/[0.10]",
    },
    pdf: {
      accent: "text-sky-500",
      active: "border-sky-500/45 ring-2 ring-sky-500/10",
      hover: "hover:border-sky-500/45",
      icon: "border-sky-500/25 bg-sky-500/10 text-sky-500",
      rail: "bg-sky-500",
      wash: "bg-sky-500/5",
      ghost: "text-sky-500/[0.06] group-hover/card:text-sky-500/[0.10]",
    },
    dwg: {
      accent: "text-amber-500",
      active: "border-amber-500/45 ring-2 ring-amber-500/10",
      hover: "hover:border-amber-500/45",
      icon: "border-amber-500/25 bg-amber-500/10 text-amber-500",
      rail: "bg-amber-500",
      wash: "bg-amber-500/5",
      ghost: "text-amber-500/[0.06] group-hover/card:text-amber-500/[0.10]",
    },
    bim: {
      accent: "text-violet-500",
      active: "border-violet-500/45 ring-2 ring-violet-500/10",
      hover: "hover:border-violet-500/45",
      icon: "border-violet-500/25 bg-violet-500/10 text-violet-500",
      rail: "bg-violet-500",
      wash: "bg-violet-500/5",
      ghost: "text-violet-500/[0.06] group-hover/card:text-violet-500/[0.10]",
    },
    model: {
      accent: "text-rose-500",
      active: "border-rose-500/45 ring-2 ring-rose-500/10",
      hover: "hover:border-rose-500/45",
      icon: "border-rose-500/25 bg-rose-500/10 text-rose-500",
      rail: "bg-rose-500",
      wash: "bg-rose-500/5",
      ghost: "text-rose-500/[0.06] group-hover/card:text-rose-500/[0.10]",
    },
    photo: {
      accent: "text-cyan-500",
      active: "border-cyan-500/45 ring-2 ring-cyan-500/10",
      hover: "hover:border-cyan-500/45",
      icon: "border-cyan-500/25 bg-cyan-500/10 text-cyan-500",
      rail: "bg-cyan-500",
      wash: "bg-cyan-500/5",
      ghost: "text-cyan-500/[0.06] group-hover/card:text-cyan-500/[0.10]",
    },
  };

  const intakeOptions = [
    {
      id: "spreadsheet",
      title: "Spreadsheet / CSV",
      detail: "Preview tabular quantity and cost sources.",
      metric: spreadsheetSources.length.toLocaleString(),
      metricLabel: "sources",
      icon: FileSpreadsheet,
      tone: "spreadsheet",
      disabled: false,
    },
    {
      id: "pdf",
      title: "PDF",
      detail: "Measure drawings, calibrate scale, and count symbols.",
      metric: pdfDocuments.length.toLocaleString(),
      metricLabel: "drawings",
      icon: Files,
      tone: "pdf",
      disabled: false,
    },
    {
      id: "dwg",
      title: "DWG",
      detail: "Open CAD sheets on the dedicated takeoff surface.",
      metric: dwgDocumentCount.toLocaleString(),
      metricLabel: "CAD files",
      icon: FileJson,
      tone: "dwg",
      disabled: false,
    },
    {
      id: "bim",
      title: "BIM",
      detail: "Building models with element schema, properties, and quantities (IFC, Revit, Navisworks).",
      metric: bimDocuments.length.toLocaleString(),
      metricLabel: "models",
      icon: Box,
      tone: "bim",
      disabled: false,
    },
    {
      id: "model",
      title: "3D Geometry",
      detail: "Geometry-only models for visualization and metrics (STEP, glTF, OBJ, STL).",
      metric: modelDocuments.length.toLocaleString(),
      metricLabel: "files",
      icon: Boxes,
      tone: "model",
      disabled: false,
    },
    {
      id: "photo",
      title: "Site Photos",
      detail: "Drop photos from the field — AI scaffolds a Bill of Materials grouped by your category taxonomy.",
      metric: photoSources.length.toLocaleString(),
      metricLabel: "photos",
      icon: Camera,
      tone: "photo",
      disabled: false,
    },
  ] satisfies Array<{
    id: IntakeOptionId;
    title: string;
    detail: string;
    metric: string;
    metricLabel: string;
    icon: typeof Ruler;
    tone: IntakeOptionTone;
    disabled: boolean;
  }>;

  const activeSourcePanel =
    activeIntakeOption === "pdf"
      ? {
          title: "PDF sources",
          detail: sourceCountText(pdfDocuments.length, "PDF", "PDFs") || "Drawing sheets ready for takeoff",
          emptyLabel: "No PDF sources",
          docs: pdfDocuments,
          icon: Files,
        }
      : activeIntakeOption === "dwg"
        ? {
            title: "DWG sources",
            detail: sourceCountText(dwgDocumentCount, "DWG/DXF", "DWG/DXF files") || "CAD drawings ready for takeoff",
            emptyLabel: "No DWG sources",
            docs: dwgDocuments,
            icon: FileJson,
          }
        : activeIntakeOption === "bim"
          ? {
              title: "BIM models",
              detail: sourceCountText(bimDocuments.length, "BIM model", "BIM models") || "IFC, Revit, and Navisworks files ready for takeoff",
              emptyLabel: "No BIM models",
              docs: bimDocuments,
              icon: Box,
            }
          : activeIntakeOption === "model"
            ? {
                title: "3D geometry",
                detail: sourceCountText(modelDocuments.length, "geometry file", "geometry files") || "Visualization-only models (STEP, glTF, OBJ, STL)",
                emptyLabel: "No 3D geometry files",
                docs: modelDocuments,
                icon: Boxes,
              }
            : activeIntakeOption === "spreadsheet"
              ? {
                  title: "Spreadsheet sources",
                  detail: sourceCountText(spreadsheetDocuments.length, "spreadsheet", "spreadsheets") || "CSV, XLS, and workbook files ready to preview and import",
                  emptyLabel: "No spreadsheet sources",
                  docs: spreadsheetDocuments,
                  icon: FileSpreadsheet,
                }
              : null;

  /* ─── Render ─── */

  if (showLanding && !detached) {
    return (
      <div
        ref={cardRef}
        className="relative flex h-full flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
          <AnimatePresence mode="wait" initial={false}>
            {activeIntakeOption === null ? (
              <motion.div
                key="cards"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="grid min-h-0 flex-1 grid-cols-2 auto-rows-fr gap-2.5 lg:grid-cols-3"
              >
                {intakeOptions.map((option) => {
                  const Icon = option.icon;
                  const tone = intakeToneClasses[option.tone];
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={option.disabled}
                      onClick={() => setActiveIntakeOption(option.id)}
                      className={cn(
                        "group/card relative z-0 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel p-5 text-left shadow-sm transition-all duration-200 hover:z-20 hover:-translate-y-0.5 hover:shadow-[0_18px_48px_hsl(var(--fg)/0.10)] focus-visible:z-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35",
                        tone.hover,
                        "disabled:cursor-not-allowed disabled:opacity-50"
                      )}
                    >
                      <span className={cn("pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-200 group-hover/card:opacity-100", tone.wash)} />
                      <Icon
                        aria-hidden
                        strokeWidth={1.25}
                        className={cn(
                          "pointer-events-none absolute -bottom-10 -right-10 h-56 w-56 transition-all duration-300 group-hover/card:scale-[1.04] group-hover/card:rotate-[-2deg]",
                          tone.ghost
                        )}
                      />
                      <motion.span
                        layoutId={`takeoff-intake-rail-${option.id}`}
                        className={cn("absolute inset-x-0 top-0 h-1 rounded-t-lg", tone.rail)}
                        transition={{ type: "spring", stiffness: 500, damping: 35 }}
                      />
                      <span className="relative flex items-start justify-between gap-3">
                        <span className="flex min-w-0 items-start gap-2.5">
                          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border shadow-[inset_0_1px_0_hsl(var(--fg)/0.08)]", tone.icon)}>
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 pt-0.5">
                            <span className="block truncate text-sm font-semibold text-fg">{option.title}</span>
                            <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg/50">{option.detail}</span>
                          </span>
                        </span>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-fg/25 transition-all group-hover/card:translate-x-0.5 group-hover/card:text-fg/60" />
                      </span>
                      <span className="relative mt-auto pt-3">
                        <span className={cn("block text-[10px] font-semibold uppercase", tone.accent)}>{option.metricLabel}</span>
                        <span className="mt-1 block truncate text-3xl font-semibold leading-none tabular-nums text-fg">{option.metric}</span>
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div
                key={`source-${activeIntakeOption}`}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <div className="mb-3 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setActiveIntakeOption(null)}
                    title="Back to intake options"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-bg/35 shadow-sm">
              {activeIntakeOption === "photo" && (
                <SitePhotoIntake
                  projectId={projectId}
                  activeWorksheetId={selectedWorksheet?.id ?? null}
                  projectContextText={[
                    workspace.project.name,
                    workspace.currentRevision.title,
                    workspace.currentRevision.description,
                  ].filter(Boolean).join("\n")}
                  photoFiles={photoSources}
                  onResults={(result, sourceNames) => {
                    setPhotoBomResult(result);
                    setPhotoBomSourcePhotoNames(result ? sourceNames : []);
                    setPhotoBomLinkedRowIds(new Set());
                  }}
                />
              )}

              {activeSourcePanel && (
                <div className="flex h-full min-h-0 flex-1 flex-col p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-fg/75">{activeSourcePanel.title}</p>
                      <p className="mt-1 text-xs text-fg/40">{activeSourcePanel.detail}</p>
                    </div>
                  </div>

                  <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border border-line bg-panel/60 p-2">
                    {activeSourcePanel.docs.length > 0 ? (
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {activeSourcePanel.docs.map((doc) => {
                          const Icon = activeSourcePanel.icon;
                          return (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => openTakeoffSurface(doc.id)}
                              className="flex min-w-0 items-center gap-2 rounded-md border border-transparent bg-bg/40 px-3 py-2.5 text-left text-xs text-fg/65 transition-colors hover:border-accent/30 hover:bg-accent/5 hover:text-accent"
                            >
                              <Icon className="h-3.5 w-3.5 shrink-0 text-fg/45" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{doc.label}</span>
                                <span className="mt-0.5 block truncate text-[10px] text-fg/35">{takeoffKindLabel(doc.kind)}</span>
                              </span>
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg/30" />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-56 items-center justify-center rounded-md border border-dashed border-line bg-bg/30 p-6 text-center">
                        <div>
                          {(() => {
                            const Icon = activeSourcePanel.icon;
                            return <Icon className="mx-auto h-8 w-8 text-fg/30" />;
                          })()}
                          <p className="mt-3 text-sm font-semibold text-fg/65">{activeSourcePanel.emptyLabel}</p>
                          <p className="mt-1 text-xs text-fg/35">No matching project files yet.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "relative flex h-full flex-1 min-h-0 flex-col bg-panel overflow-hidden",
        detached ? "rounded-none border-0" : "rounded-lg border border-line"
      )}
    >
      {/* ─── Top Toolbar ─── */}
      <div className="flex min-w-0 items-center gap-1 overflow-hidden border-b border-line bg-panel px-1.5 py-1.5 shrink-0">
        {!detached && (
          <>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowLanding(true)}
              title="Back to takeoff intake"
              aria-label="Back to takeoff intake"
              className="h-7 w-7 shrink-0 px-0"
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
            <Separator className="hidden !h-6 !w-px shrink-0 md:block" />
          </>
        )}
        {/* Document selector */}
        <div className="flex min-w-0 shrink items-center gap-1">
          <RadixSelect.Root
            value={selectedDocId}
            onValueChange={(v) => {
              setSelectedDocId(v);
              setPage(1);
              setZoom(1);
              fitOnLoadRef.current = true;
              setAnnotations([]);
              setAutoCountResults(null);
              setAutoCountSnippet(null);
            }}
          >
            <RadixSelect.Trigger className="inline-flex h-8 w-32 min-w-0 shrink items-center gap-1.5 truncate rounded-lg border border-line bg-bg/50 px-2 text-xs text-fg outline-none transition-colors hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 sm:w-40 xl:w-48 2xl:w-56">
              <RadixSelect.Value placeholder="No drawings available" />
              <RadixSelect.Icon className="ml-auto shrink-0">
                <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
              </RadixSelect.Icon>
            </RadixSelect.Trigger>
            <RadixSelect.Portal>
              <RadixSelect.Content
                className="z-[100] overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
                position="popper"
                sideOffset={4}
              >
                <RadixSelect.Viewport className="p-1 max-h-64">
                  {takeoffDocuments.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-fg/40">No drawings available</div>
                  )}
                  {projectPdfs.length > 0 && (
                    <RadixSelect.Group>
                      <RadixSelect.Label className="px-2 py-1 text-[10px] font-medium text-fg/40 uppercase tracking-wider">
                        Project Documents
                      </RadixSelect.Label>
                      {projectPdfs.map((d) => (
                        <RadixSelect.Item
                          key={d.id}
                          value={d.id}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none data-[highlighted]:bg-accent/10 text-fg truncate"
                        >
                          <RadixSelect.ItemIndicator className="shrink-0">
                            <Check className="h-3 w-3 text-accent" />
                          </RadixSelect.ItemIndicator>
                          <RadixSelect.ItemText>{d.label}</RadixSelect.ItemText>
                        </RadixSelect.Item>
                      ))}
                    </RadixSelect.Group>
                  )}
                  {(() => {
                    // Render from the deduped `takeoffDocuments` so the ids
                    // shown here match what `selectedDoc.find()` looks up.
                    // Filter out anything already shown in the PDF + knowledge
                    // groups so each doc appears exactly once.
                    const projectPdfIds = new Set(projectPdfs.map((d) => d.id));
                    const knowledgeIds = new Set(knowledgePdfs.map((d) => d.id));
                    const projectFiles = takeoffDocuments.filter(
                      (d) => d.source === "project" && !projectPdfIds.has(d.id) && !knowledgeIds.has(d.id),
                    );
                    if (projectFiles.length === 0) return null;
                    return (
                      <RadixSelect.Group>
                        <RadixSelect.Label className="px-2 py-1 text-[10px] font-medium text-fg/40 uppercase tracking-wider">
                          Project Files
                        </RadixSelect.Label>
                        {projectFiles.map((d) => (
                          <RadixSelect.Item
                            key={d.id}
                            value={d.id}
                            className="flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none data-[highlighted]:bg-accent/10 text-fg truncate"
                          >
                            <RadixSelect.ItemIndicator className="shrink-0">
                              <Check className="h-3 w-3 text-accent" />
                            </RadixSelect.ItemIndicator>
                            <RadixSelect.ItemText>{d.label}</RadixSelect.ItemText>
                          </RadixSelect.Item>
                        ))}
                      </RadixSelect.Group>
                    );
                  })()}
                  {knowledgePdfs.length > 0 && (
                    <RadixSelect.Group>
                      <RadixSelect.Label className="px-2 py-1 text-[10px] font-medium text-fg/40 uppercase tracking-wider">
                        Knowledge Books
                      </RadixSelect.Label>
                      {knowledgePdfs.map((d) => (
                        <RadixSelect.Item
                          key={d.id}
                          value={d.id}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none data-[highlighted]:bg-accent/10 text-fg truncate"
                        >
                          <RadixSelect.ItemIndicator className="shrink-0">
                            <Check className="h-3 w-3 text-accent" />
                          </RadixSelect.ItemIndicator>
                          <RadixSelect.ItemText>{d.label}</RadixSelect.ItemText>
                        </RadixSelect.Item>
                      ))}
                    </RadixSelect.Group>
                  )}
                </RadixSelect.Viewport>
              </RadixSelect.Content>
            </RadixSelect.Portal>
          </RadixSelect.Root>
        </div>

        {!isCadDocument && !isDwgDocument && (
          <>
            <Separator className="hidden !h-6 !w-px shrink-0 md:block" />

            {/* Page navigation */}
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={handlePrevPage}
                disabled={page <= 1}
                className="h-7 w-7 px-0"
                aria-label="Previous page"
                title="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <div className="flex items-center gap-0.5">
                <Input
                  className="h-7 w-10 px-1 text-center text-xs"
                  type="number"
                  min={1}
                  max={totalPages}
                  value={page}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= totalPages) setPage(v);
                  }}
                />
                <span className="text-xs text-fg/40">/ {totalPages}</span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleNextPage}
                disabled={page >= totalPages}
                className="h-7 w-7 px-0"
                aria-label="Next page"
                title="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Separator className="hidden !h-6 !w-px shrink-0 md:block" />

            {/* Zoom controls */}
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={handleZoomOut}
                className="h-7 w-7 px-0"
                aria-label="Zoom out"
                title="Zoom out"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-10 text-center text-xs text-fg/60">{zoomPercent}%</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleZoomIn}
                className="h-7 w-7 px-0"
                aria-label="Zoom in"
                title="Zoom in"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleFitToWidth}
                title="Fit to width"
                aria-label="Fit to width"
                className="h-7 w-7 px-0"
              >
                <StretchHorizontal className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleFitToPage}
                title="Fit to page"
                aria-label="Fit to page"
                className="h-7 w-7 px-0"
              >
                <Scan className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Separator className="hidden !h-6 !w-px shrink-0 md:block" />

            {/* Calibration indicator — click to set/reset scale */}
            {calibration ? (
              <div className="inline-flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleToolSelect("calibrate")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500 transition-colors hover:bg-emerald-500/20"
                  title={`Recalibrate: 1 ${calibration.unit} = ${calibration.pixelsPerUnit.toFixed(1)}px`}
                  aria-label="Recalibrate drawing scale"
                >
                  <Scaling className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVerifyMode(true);
                    setActiveTool("calibrate");
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-500/20 text-emerald-500/80 transition-colors hover:bg-emerald-500/10"
                  title="Draw a line of known length to verify the calibration"
                  aria-label="Verify drawing calibration"
                >
                  <Check className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleToolSelect("calibrate")}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500 transition-colors hover:bg-amber-500/20"
                title="Click to set the drawing scale"
                aria-label="Set drawing scale"
              >
                <Scaling className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={handleReadLegend}
              disabled={legendLoading || !selectedDoc}
              className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-line bg-panel2/40 px-1.5 text-fg/70 transition-colors hover:bg-panel2 disabled:opacity-50"
              title="Read the legend / symbol schedule on this page (uses Azure DI OCR)"
              aria-label="Read legend or symbol schedule"
            >
              <BookOpen className="h-3 w-3" />
              {legendLoading && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
              {legendEntries && legendEntries.length > 0 && (
                <span className="text-[10px] text-fg/45 ml-0.5">{legendEntries.length}</span>
              )}
            </button>
            {isPdfDocument && (
              <button
                type="button"
                onClick={() => {
                  const nextOpen = !drawingAnalysisOpen;
                  setDrawingAnalysisOpen(nextOpen);
                  if (nextOpen && !drawingAnalysisResult && !drawingAnalysisRunning) {
                    void handleRunDrawingAnalysis("geometry");
                  }
                }}
                disabled={drawingAnalysisRunning || !selectedDoc}
                className={cn(
                  "inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border px-1.5 transition-colors disabled:opacity-50",
                  drawingAnalysisOpen
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-500"
                    : "border-line bg-panel2/40 text-fg/70 hover:bg-panel2"
                )}
                title="Analyze drawing geometry, trace connected systems, and save reviewed detections"
                aria-label="Drawing intelligence"
              >
                <GitBranch className="h-3 w-3" />
                {drawingAnalysisRunning && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
                {drawingAnalysisResult && !drawingAnalysisRunning && (
                  <span className="text-[10px] text-fg/45 ml-0.5">{drawingAnalysisResult.summary.systemCount}</span>
                )}
              </button>
            )}
          </>
        )}

        <div className="min-w-2 flex-1" />

        {!isCadDocument && !isDwgDocument && (
          <>
            {/* Active tool indicator */}
            <Badge tone="info" className="h-7 min-w-7 shrink-0 gap-1 px-1.5 text-[11px] 2xl:px-2" title={`${activeToolDef?.label ?? "Select"} tool`}>
              {activeToolDef && <activeToolDef.icon className="h-3 w-3" />}
              <span className="hidden 2xl:inline">{activeToolDef?.label ?? "Select"}</span>
            </Badge>

            <Button
              variant={snapEnabled ? "secondary" : "ghost"}
              size="xs"
              onClick={() => setSnapEnabled((value) => !value)}
              title="Toggle PDF edge and vertex snap"
              aria-label="Toggle PDF edge and vertex snap"
              className="h-7 w-7 shrink-0 px-0"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void undoTakeoffAction()}
              disabled={!canUndoTakeoff}
              title="Undo takeoff edit"
              aria-label="Undo takeoff edit"
              className="h-7 w-7 shrink-0 px-0"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void redoTakeoffAction()}
              disabled={!canRedoTakeoff}
              title="Redo takeoff edit"
              aria-label="Redo takeoff edit"
              className="h-7 w-7 shrink-0 px-0"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>

            {/* Clear all */}
            {annotations.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={handleClearAll}
                title="Clear all takeoff marks"
                aria-label="Clear all takeoff marks"
                className="h-7 w-7 shrink-0 px-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="xs"
              onClick={() => exportAnnotationsJson(annotations, calibration)}
              disabled={annotations.length === 0}
              title={
                annotations.length === 0
                  ? "No takeoff marks to export"
                  : `Export ${annotations.length} takeoff mark${annotations.length === 1 ? "" : "s"} as JSON`
              }
              aria-label="Export takeoff marks as JSON"
              className="h-7 w-7 shrink-0 px-0"
            >
              <FileJson className="h-3.5 w-3.5" />
            </Button>

            {onOpenRevisionDiff && !detached && (
              <Button
                variant="secondary"
                size="xs"
                onClick={onOpenRevisionDiff}
                title="Compare drawing revisions and re-takeoff"
                aria-label="Compare drawing revisions and re-takeoff"
                className="h-7 w-7 shrink-0 px-0"
              >
                <GitCompare className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        )}

        {/* ─── Fullscreen / Detach ─── */}
        <Separator className="hidden !h-6 !w-px shrink-0 md:block" />
        <Button
          variant="ghost"
          size="xs"
          onClick={handleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          className="h-7 w-7 shrink-0 px-0"
        >
          {isFullscreen ? (
            <Shrink className="h-3.5 w-3.5" />
          ) : (
            <Expand className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={handleDetach}
          title="Open in new window"
          aria-label="Open in new window"
          disabled={!selectedDocId}
          className="h-7 w-7 shrink-0 px-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ─── No-Calibration Warning ─── */}
      {!isCadDocument && !isDwgDocument && !calibration && activeTool && isMeasurementTool(activeTool) && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2.5 shrink-0">
          <Scaling className="h-4 w-4 text-amber-500 shrink-0 animate-pulse" />
          <div className="flex-1">
            <p className="text-xs font-medium text-fg/85">
              Drawing scale isn't set — measurements will be in pixels until you calibrate.
            </p>
            <p className="text-[11px] text-fg/50 mt-0.5">
              Click below to set the scale, or pick the Calibrate tool from the side palette.
            </p>
          </div>
          <Button size="xs" variant="accent" onClick={() => handleToolSelect("calibrate")}>
            <Scaling className="h-3 w-3" />
            Set scale
          </Button>
        </div>
      )}

      {/* ─── Auto-Count Banner ─── */}
      {!isCadDocument && !isDwgDocument && (isAutoCountActive || autoCountRunning) && (
        <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/5 px-4 py-2.5 shrink-0">
          <ScanSearch className="h-4 w-4 text-accent shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-fg/80">
              {autoCountRunning
                ? "Analyzing drawing for matches… (this can take 5-15 seconds)"
                : "Draw a rectangle around a symbol to auto-count all occurrences on this page"}
            </p>
            {!autoCountRunning && (
              <p className="text-[11px] text-fg/40 mt-0.5">
                Click and drag a tight box around one example. The CV pipeline finds all visual matches and shows them in a review modal.
              </p>
            )}
          </div>

          {autoCountRunning && (
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          )}

          {/* Scope selector — pick where to search BEFORE drawing the bbox */}
          <div className="flex items-center gap-1 rounded-md bg-panel2/45 p-0.5">
            <button
              type="button"
              onClick={() => setAutoCountScope("page")}
              disabled={autoCountRunning}
              className={cn(
                "px-2 py-0.5 text-[11px] rounded transition-colors",
                autoCountScope === "page" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/75",
              )}
              title="Search only the current page"
            >
              This page
            </button>
            <button
              type="button"
              onClick={() => setAutoCountScope("document")}
              disabled={autoCountRunning || totalPages <= 1}
              className={cn(
                "px-2 py-0.5 text-[11px] rounded transition-colors",
                autoCountScope === "document" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/75",
                totalPages <= 1 && "opacity-40 cursor-not-allowed",
              )}
              title={totalPages <= 1 ? "Only one page in this document" : `Search all ${totalPages} pages`}
            >
              This doc{totalPages > 1 ? ` (${totalPages})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setAutoCountScope("all")}
              disabled={autoCountRunning || pdfDocuments.length <= 1}
              className={cn(
                "px-2 py-0.5 text-[11px] rounded transition-colors",
                autoCountScope === "all" ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg/75",
                pdfDocuments.length <= 1 && "opacity-40 cursor-not-allowed",
              )}
              title={pdfDocuments.length <= 1 ? "Only one drawing in the project" : `Search all ${pdfDocuments.length} drawings`}
            >
              All drawings{pdfDocuments.length > 1 ? ` (${pdfDocuments.length})` : ""}
            </button>
          </div>

          {/* Threshold control */}
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] text-fg/40">Sensitivity:</label>
            <input
              type="range"
              min={30}
              max={95}
              value={Math.round(autoCountThreshold * 100)}
              onChange={(e) => setAutoCountThreshold(parseInt(e.target.value) / 100)}
              className="w-16 accent-accent"
              title={`Threshold: ${Math.round(autoCountThreshold * 100)}%`}
            />
            <span className="text-[11px] text-fg/50 w-7">{Math.round(autoCountThreshold * 100)}%</span>
          </div>

          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setActiveTool("select");
              setAutoCountResults(null);
              setAutoCountSnippet(null);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* ─── Auto Count Results Panel (unified: this page + all pages + all docs) ─── */}
      {autoCountResults && !isAutoCountActive && (
        <div className="border-b border-green-500/30 bg-green-500/5 px-4 py-2.5 space-y-2 shrink-0">
          {/* Header row */}
          <div className="flex items-center gap-3">
            {autoCountSnippet && (
              <img src={autoCountSnippet} alt="Template" className="h-8 w-8 rounded border border-line object-contain bg-white shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-fg/80">
                This page: <span className="font-semibold text-green-600">{autoCountResults.length}</span> match{autoCountResults.length !== 1 ? "es" : ""}
              </p>
            </div>

            {/* Sensitivity */}
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[11px] text-fg/40">Sensitivity:</label>
              <input type="range" min={30} max={95} value={Math.round(autoCountThreshold * 100)}
                onChange={(e) => setAutoCountThreshold(parseInt(e.target.value) / 100)}
                className="w-14 accent-green-500" title={`${Math.round(autoCountThreshold * 100)}%`} />
              <span className="text-[11px] text-fg/50 w-6">{Math.round(autoCountThreshold * 100)}%</span>
            </div>

            <Button variant="ghost" size="xs" onClick={() => { setAutoCountResults(null); setAutoCountSnippet(null); setCrossPageResults(null); setMultiDocResults(null); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Search scope buttons */}
          {crossPageLastBbox && (
            <div className="flex items-center gap-2 pt-1 border-t border-green-500/10">
              {totalPages > 1 && (
                <Button variant="secondary" size="xs" onClick={() => handleCrossPageSearch()} disabled={crossPageRunning}>
                  {crossPageRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                  All Pages ({totalPages})
                </Button>
              )}
              {pdfDocuments.length > 1 && (
                <Button variant="secondary" size="xs" onClick={() => handleMultiDocSearch()} disabled={multiDocRunning}>
                  {multiDocRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                  All PDFs ({pdfDocuments.length})
                </Button>
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-fg/50 cursor-pointer ml-auto">
                <input type="checkbox" checked={crossScaleEnabled} onChange={(e) => setCrossScaleEnabled(e.target.checked)} className="accent-green-500" />
                Cross-scale
              </label>
            </div>
          )}

          {/* Cross-page results (inline) */}
          {crossPageResults && crossPageResults.length > 0 && (
            <div className="pt-1 border-t border-green-500/10">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[11px] font-medium text-fg/60">
                  All pages{!crossPageRunning && `: ${crossPageResults.reduce((s, r) => s + Math.max(0, r.count), 0)} total`}
                  {crossPageRunning && <span className="text-fg/40 ml-1">(scanning {crossPageResults.length}/{totalPages}...)</span>}
                </p>
                {crossPageRunning && <Loader2 className="h-3 w-3 animate-spin text-green-500" />}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {crossPageResults.map((r) => (
                  <button key={r.page} onClick={() => r.count >= 0 && setPage(r.page)}
                    className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] border transition-colors",
                      r.count < 0 ? "border-red-300/30 bg-red-500/5 text-red-500"
                        : r.count > 0 ? "border-green-300/30 bg-green-500/10 text-green-600 hover:bg-green-500/20 cursor-pointer"
                        : "border-line bg-panel2/30 text-fg/40"
                    )}>
                    <span className="font-medium">P{r.page}</span>
                    <span>{r.count < 0 ? "err" : r.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Multi-doc results (inline) */}
          {multiDocResults && multiDocResults.length > 0 && (
            <div className="pt-1 border-t border-green-500/10">
              <div className="flex items-center gap-2 mb-1.5">
                <p className="text-[11px] font-medium text-fg/60">
                  All PDFs{!multiDocRunning && `: ${multiDocResults.filter((r) => r.total >= 0).reduce((s, r) => s + r.total, 0)} total`}
                  {multiDocRunning && <span className="text-fg/40 ml-1">(scanning {multiDocResults.length}/{pdfDocuments.length}...)</span>}
                </p>
                {multiDocRunning && <Loader2 className="h-3 w-3 animate-spin text-green-500" />}
              </div>
              <div className="space-y-0.5">
                {multiDocResults.map((r) => (
                  <button key={r.docId} onClick={() => { setSelectedDocId(r.docId); setPage(1); }}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-colors text-left",
                      r.total < 0 ? "text-red-500" : r.total > 0 ? "hover:bg-green-500/10 text-fg/80" : "text-fg/30"
                    )}>
                    <span className="truncate flex-1">{r.docLabel}</span>
                    <Badge tone={r.total > 0 ? "info" : "default"} className="text-[10px]">{r.total < 0 ? "err" : r.total}</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Ask AI Banner ─── */}
      {!isCadDocument && !isDwgDocument && isAskAiActive && (
        <div className="flex items-center gap-3 border-b border-violet-500/30 bg-violet-500/5 px-4 py-2.5 shrink-0">
          <BrainCircuit className="h-4 w-4 text-violet-500 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-fg/80">
              {askAiRunning
                ? "Cropping selected region..."
                : "Draw a rectangle to select a region for AI analysis"}
            </p>
          </div>

          {askAiRunning && (
            <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
          )}

          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setActiveTool("select");
              setAskAiCropImage(null);
              setAskAiModalOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* ─── Main Area ─── */}
      <div className="relative flex flex-1 overflow-hidden min-h-0">
        {isSpreadsheetDocument ? (
          <div className="relative flex h-full w-full min-h-0 flex-col bg-bg/50">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-fg">{spreadsheetPreview?.sourceName ?? selectedDoc?.fileName ?? "Spreadsheet"}</p>
                <p className="mt-1 text-xs text-fg/40">
                  {spreadsheetPreview
                    ? `${spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length} rows · ${spreadsheetPreview.headers.length} columns`
                    : "Preview, pivot, and summarize the selected source."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {spreadsheetPreview && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenAgentChat?.(
                      `Summarize spreadsheet source ${spreadsheetPreview.sourceName}. Identify estimate-ready line items, quantity columns, cost/price columns, likely category/vendor fields, and any data quality risks.`
                    )}
                  >
                    <BrainCircuit className="h-3.5 w-3.5" />
                    Summarize
                  </Button>
                )}
              </div>
            </div>

            {spreadsheetPreview ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-bg/40 p-1 w-fit">
                  {(["preview", "pivot"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setSpreadsheetPanelView(view)}
                      className={cn(
                        "rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
                        spreadsheetPanelView === view ? "bg-panel2 text-fg shadow-sm" : "text-fg/45 hover:text-fg/70"
                      )}
                    >
                      {view}
                    </button>
                  ))}
                </div>

                {spreadsheetPanelView === "preview" && (
                  <div className="mt-4 flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
                      <table className="min-w-full text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-panel2 text-[10px] uppercase tracking-wide text-fg/40">
                          <tr>
                            {spreadsheetPreview.headers.map((header) => (
                              <th key={header} className="whitespace-nowrap border-b border-line px-3 py-2 font-semibold">{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {spreadsheetPreview.sampleRows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="odd:bg-bg/25">
                              {spreadsheetPreview.headers.map((header, colIndex) => (
                                <td key={`${rowIndex}-${header}`} className="max-w-56 truncate border-b border-line/60 px-3 py-2 text-fg/65">
                                  {row[colIndex] ?? ""}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {spreadsheetPanelView === "pivot" && (
                  <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-md border border-line bg-bg/35 p-3">
                      <div>
                        <Label>Group by</Label>
                        <Select
                          value={pivotGroupBy || activePivotSummary?.groupBy || ""}
                          onValueChange={setPivotGroupBy}
                          options={spreadsheetGroupOptions.length ? spreadsheetGroupOptions : [{ value: "none", label: "No text fields", disabled: true }]}
                          size="sm"
                        />
                      </div>
                      <div>
                        <Label>Measure</Label>
                        <Select
                          value={pivotMeasure}
                          onValueChange={setPivotMeasure}
                          options={spreadsheetMeasureOptions}
                          size="sm"
                        />
                      </div>
                      <p className="text-xs text-fg/40">Pivot is built from the parsed file, not just the visible sample rows.</p>
                    </div>

                    <div className="min-h-0 overflow-y-auto rounded-md border border-line bg-bg/35 p-2">
                      {activePivotSummary?.rows.length ? activePivotSummary.rows.map((row) => (
                        <div key={row.label} className="mb-1.5 rounded-md bg-panel/70 p-2 last:mb-0">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="min-w-0 flex-1 truncate font-medium text-fg/75">{row.label}</span>
                            <span className="font-mono text-fg/50">{numericFormat(row.total)}</span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.min(100, (row.total / maxPivotTotal) * 100))}%` }} />
                          </div>
                          <div className="mt-1 flex justify-between text-[10px] text-fg/35">
                            <span>{row.count} rows</span>
                            <span>Avg {numericFormat(row.average)}</span>
                          </div>
                        </div>
                      )) : (
                        <div className="flex h-40 items-center justify-center text-xs text-fg/40">No pivotable fields were detected.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                <div className="max-w-sm text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-bg/45 text-fg/45">
                    <FileSpreadsheet className="h-6 w-6" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-fg/75">
                    {spreadsheetPreviewLoading ? "Reading source…" : "No spreadsheet selected"}
                  </p>
                  <p className="mt-1 text-xs text-fg/40">
                    {spreadsheetPreviewLoading
                      ? "Parsing rows and computing pivot summaries."
                      : "Choose a source from the intake list to preview and pivot."}
                  </p>
                </div>
              </div>
            )}

            {spreadsheetPreviewLoading && spreadsheetPreview && (
              <div className="absolute inset-x-0 top-0 flex justify-center pt-3">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-xs text-fg/60 shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  Reading source
                </div>
              </div>
            )}
          </div>
        ) : isDwgDocument ? (
          <DwgTakeoffSurface
            projectId={projectId}
            // The DWG processing API keys off FileNode / SourceDocument ids,
            // not the prefixed TakeoffDocument wrapper id ("file-…" /
            // "model-asset-…"). Hand it the underlying backend id explicitly
            // — fall back to doc.id when neither prefix applies (those are
            // already raw SourceDocument ids).
            documents={dwgDocuments.map((doc) => ({
              id: doc.fileNodeId ?? doc.id,
              label: doc.label,
              fileName: doc.fileName,
              fileUrl: buildPdfUrl(doc),
              sourceKind: doc.fileNodeId ? "file_node" as const : undefined,
            }))}
            selectedDocumentId={
              selectedDoc?.kind === "dwg" ? (selectedDoc.fileNodeId ?? selectedDoc.id) : undefined
            }
            workspace={workspace}
            selectedWorksheetId={selectedWorksheet?.id}
            defaultEstimateCategory={takeoffCategory ? { id: takeoffCategory.id, name: takeoffCategory.name, entityType: takeoffCategory.entityType } : null}
            onSelectedDocumentChange={(apiDocId) => {
              // Map the backend id back to the takeoff doc's wrapper id so
              // the rest of TakeoffTab keeps working with its `selectedDocId`
              // contract (which is the prefixed id).
              const matched = dwgDocuments.find((d) => (d.fileNodeId ?? d.id) === apiDocId);
              if (!matched) return;
              setSelectedDocId(matched.id);
              setPage(1);
              setZoom(1);
              fitOnLoadRef.current = true;
              setAnnotations([]);
              updateAnnotationSelection(null);
              setAutoCountResults(null);
              setAutoCountSnippet(null);
            }}
            onWorkspaceMutated={notifyWorkspaceMutated}
            onSelectedEntityChange={(entitySelection) => {
              if (!onSelectionChange) return;
              if (entitySelection) {
                onSelectionChange({
                  kind: "cad-entity",
                  documentId: entitySelection.documentId,
                  entityId: entitySelection.entityId,
                  entityType: entitySelection.entityType,
                  layer: entitySelection.layer,
                  label: entitySelection.label,
                  summary: entitySelection.summary,
                });
              } else if (selection?.kind === "cad-entity") {
                onSelectionChange(null);
              }
            }}
            onSelectedAnnotationChange={(annotationId) => {
              if (!onSelectionChange) return;
              if (annotationId) {
                onSelectionChange({ kind: "annotation", annotationId });
              } else if (selection?.kind === "annotation") {
                onSelectionChange(null);
              }
            }}
            onAnnotationsChange={setDwgAnnotationsCache}
            actionsRef={dwgActionsRef}
          />
        ) : (
          <>

        {/* Left: Tool palette */}
        {!isCadDocument && (
        <div className="flex w-9 shrink-0 flex-col overflow-y-auto overflow-x-hidden border-r border-line bg-panel p-0.5">
          {TOOL_GROUPS.map((group) => {
            const groupTools = TOOLS.filter((t) => t.group === group.key);
            return (
              <div key={group.key}>
                {group.key !== "nav" && (
                  <div className="my-px h-px w-full bg-line/50" />
                )}
                {groupTools.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => handleToolSelect(id)}
                    title={label}
                    className={cn(
                      "flex h-6 w-full items-center justify-center rounded-md transition-colors",
                      activeTool === id
                        ? "bg-accent/15 text-accent"
                        : "text-fg/40 hover:bg-panel2 hover:text-fg/70"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        )}

        {/* Center: Document viewer area */}
        <div
          ref={viewerContainerRef}
          className={cn(
            "flex flex-1 bg-bg/50",
            isCadDocument ? "items-stretch justify-stretch overflow-hidden" : "items-start justify-center overflow-auto"
          )}
        >
          {!selectedDoc ? (
            <div className="flex flex-1 items-center justify-center h-full">
              <EmptyState className="border-none">
                <Ruler className="mx-auto mb-3 h-10 w-10 text-fg/20" />
                <p className="text-sm font-medium text-fg/50">
                  Select a drawing to begin takeoff
                </p>
                <p className="mt-1 text-xs text-fg/30">
                  Add drawings in Documents, then select one here to start measuring.
                </p>
              </EmptyState>
            </div>
          ) : isCadDocument ? (
            <div className="h-full w-full">
              {selectedModelIsEditable ? (
                <BidwrightModelEditor
                  fileUrl={documentUrl}
                  fileName={selectedDoc?.fileName}
                  projectId={projectId}
                  modelAssetId={selectedModelAsset?.id}
                  modelDocumentId={selectedDoc?.fileNodeId ?? selectedDoc?.id}
                  syncChannelName={takeoffChannelName(projectId)}
                  estimateTargetWorksheetId={selectedWorksheet?.id}
                  estimateTargetWorksheetName={selectedWorksheet?.name}
                  estimateDefaultMarkup={workspace.currentRevision.defaultMarkup ?? 0.2}
                  estimateQuoteLabel={workspace.quote?.quoteNumber ?? workspace.project.name}
                  title="3D Takeoff Model"
                  variant="takeoff"
                  linkedLineItems={linkedModelLineItems}
                  onModelSelection={setModelSelection}
                  onSendSelectionToEstimate={handleSendModelSelectionToEstimate}
                  onUpdateLinkedLineItem={handleUpdateModelLinkedLineItem}
                  onDeleteLinkedLineItem={handleDeleteModelLinkedLineItem}
                />
              ) : (
                <CadViewer
                  fileUrl={documentUrl}
                  fileName={selectedDoc?.fileName}
                  onIfcElementSelect={handleIfcElementSelect}
                />
              )}
            </div>
          ) : (
            <div className="relative inline-block m-4">
                  {/* PDF canvas */}
                  <PdfCanvasViewer
                    documentUrl={documentUrl}
                    pageNumber={page}
                    zoom={zoom}
                    onPageCount={handlePageCount}
                    onCanvasResize={handleCanvasResize}
                    canvasRef={pdfCanvasRef}
                  />
                  {/* Annotation overlay */}
                  <AnnotationCanvas
                    width={canvasSize.width}
                    height={canvasSize.height}
                    annotations={annotations.filter((a) => a.visible)}
                    activeTool={
                      isRectSelectTool
                        ? "area-rectangle"    /* Re-use rectangle drawing for region selection */
                        : activeTool === "select"
                          ? null
                          : activeTool
                    }
                    calibration={calibration}
                    activeColor={
                      isAutoCountActive ? "#f59e0b"
                        : isAskAiActive ? "#8b5cf6"
                        : isSmartCountActive ? "#10b981"
                        : activeColor
                    }
                    activeThickness={isRectSelectTool ? 2 : activeThickness}
                    onAnnotationComplete={
                      isAutoCountActive
                        ? handleAutoCountSelection
                        : isAskAiActive
                          ? handleAskAiSelection
                          : isSmartCountActive
                            ? handleSmartCountSelection
                            : handleAnnotationComplete
                    }
                    onCalibrationRequest={handleCalibrationRequest}
                    pdfCanvas={pdfCanvasRef.current}
                    snapEnabled={snapEnabled}
                    zoom={zoom}
                  />
                  <DrawingIntelligenceOverlay
                    analysis={drawingAnalysisResult}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    visible={drawingAnalysisOverlay}
                  />

                  {/* Processing overlay */}
                  {(autoCountRunning || askAiRunning || drawingAnalysisRunning) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg backdrop-blur-sm z-10">
                      <div className="flex items-center gap-3 rounded-xl bg-panel px-5 py-3 shadow-xl border border-line">
                        <Loader2 className="h-5 w-5 animate-spin text-accent" />
                        <div>
                          <p className="text-sm font-medium text-fg">
                            {drawingAnalysisRunning
                              ? "Analyzing drawing geometry..."
                              : autoCountRunning
                                ? "Running symbol detection..."
                                : "Cropping region for AI analysis..."}
                          </p>
                          <p className="text-xs text-fg/40">
                            {drawingAnalysisRunning
                              ? "Tracing linework, symbols, text zones, and connected systems"
                              : autoCountRunning
                                ? "OpenCV template matching + feature detection"
                                : "Preparing image crop"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
            </div>
          )}
        </div>

        {drawingAnalysisOpen && isPdfDocument && (
          <DrawingIntelligencePanel
            preset={drawingAnalysisPreset}
            onPresetChange={setDrawingAnalysisPreset}
            analysis={drawingAnalysisResult}
            running={drawingAnalysisRunning}
            savingId={drawingAnalysisSavingId}
            error={drawingAnalysisError}
            overlay={drawingAnalysisOverlay}
            onOverlayChange={setDrawingAnalysisOverlay}
            onAnalyze={() => void handleRunDrawingAnalysis("geometry")}
            onTrace={() => void handleRunDrawingAnalysis("systems")}
            onClose={() => setDrawingAnalysisOpen(false)}
            onSaveSystem={(system) => void handleSaveDrawingSystem(system)}
            onSaveSymbol={(candidate) => void handleSaveDrawingSymbol(candidate)}
          />
        )}

          </>
        )}
      </div>

      {/* ─── Create Annotation Modal ─── */}
      <CreateAnnotationModal
        open={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setActiveTool("select");
        }}
        onConfirm={handleAnnotationConfigConfirm}
        initialType={activeTool}
        lockType={activeTool !== "select"}
      />

      {/* ─── Calibration Prompt ─── */}
      {/* ─── Verify-scale Modal ─── */}
      {verifyPoints && calibration && (() => {
        const [va, vb] = verifyPoints;
        const vPixelDist = Math.sqrt((vb.x - va.x) ** 2 + (vb.y - va.y) ** 2);
        // Same math as live measurements: cal stored at zoom 1, multiply by current zoom.
        const measured = vPixelDist / Math.max(calibration.pixelsPerUnit * zoom, 0.0001);
        const expected = parseFloat(verifyExpected);
        const errorPct =
          expected > 0 && Number.isFinite(expected) ? ((measured - expected) / expected) * 100 : null;
        const errorAbs = errorPct !== null ? Math.abs(errorPct) : null;
        const errorTone =
          errorAbs === null ? "neutral" :
          errorAbs < 1 ? "good" :
          errorAbs < 3 ? "warn" :
          "bad";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => {
                setVerifyPoints(null);
                setVerifyExpected("");
              }}
            />
            <Card className="relative z-10 w-full max-w-md border-emerald-500/30 shadow-2xl">
              <div className="border-b border-line px-5 py-4 flex items-center gap-3">
                <div className="rounded-full bg-emerald-500/15 p-2">
                  <Ruler className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-fg">Verify drawing scale</h3>
                  <p className="mt-0.5 text-[11px] text-fg/55">
                    Compare a measurement against a known dimension to spot calibration drift.
                  </p>
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="rounded-md border border-line bg-panel2/40 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-fg/40">Measured length</div>
                  <div className="text-base font-mono font-semibold text-fg">
                    {measured.toFixed(3)} {calibration.unit}
                  </div>
                  <div className="text-[10px] text-fg/35 mt-0.5">{vPixelDist.toFixed(1)} px on canvas</div>
                </div>

                <div>
                  <Label className="text-[10px]">Expected length (what should this be?)</Label>
                  <div className="grid grid-cols-[1fr_80px] gap-2">
                    <Input
                      className="text-base h-10"
                      type="number"
                      min={0.001}
                      step={0.001}
                      placeholder="Enter known dimension"
                      value={verifyExpected}
                      onChange={(e) => setVerifyExpected(e.target.value)}
                      autoFocus
                    />
                    <Select
                      className="h-10"
                      value={calibration.unit}
                      onValueChange={() => {}}
                      options={[{ value: calibration.unit, label: calibration.unit }]}
                      disabled
                    />
                  </div>
                </div>

                {errorPct !== null && (
                  <div
                    className={cn(
                      "rounded-md px-3 py-2 text-xs",
                      errorTone === "good" && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
                      errorTone === "warn"  && "bg-amber-500/10  text-amber-400  border border-amber-500/20",
                      errorTone === "bad"   && "bg-red-500/10    text-red-400    border border-red-500/20",
                    )}
                  >
                    <div className="font-mono font-semibold">
                      Error: {errorPct >= 0 ? "+" : ""}{errorPct.toFixed(2)}%
                    </div>
                    <div className="text-[11px] opacity-80 mt-0.5">
                      {errorTone === "good" && "✓ Within ±1% — calibration looks accurate."}
                      {errorTone === "warn" && "⚠ Within 3% — minor drift, usually acceptable for estimating."}
                      {errorTone === "bad"  && "✗ More than 3% off — recalibrate before measuring further."}
                    </div>
                  </div>
                )}

                <div className="flex justify-between gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setVerifyPoints(null);
                      setVerifyExpected("");
                      handleToolSelect("calibrate");
                    }}
                    disabled={errorTone !== "bad"}
                    className={cn(errorTone === "bad" ? "text-red-400" : "")}
                  >
                    Recalibrate
                  </Button>
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={() => {
                      setVerifyPoints(null);
                      setVerifyExpected("");
                    }}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        );
      })()}

      {calibrationPromptOpen && calibrationPoints && (() => {
        const [a, b] = calibrationPoints;
        const pixelDist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
        const distNum = parseFloat(calibrationInput);
        const livePerUnit = distNum > 0 ? (pixelDist / distNum) : null;
        // pdfjs renders at 72 DPI × zoom, so 1 page-inch = 72 × zoom canvas px.
        const paperInches = pixelDist / (72 * zoom);
        // Sanity warnings: surface common calibration mistakes.
        const lineDx = Math.abs(b.x - a.x);
        const lineDy = Math.abs(b.y - a.y);
        const isLineHorizontal = lineDx > lineDy * 2;
        const isLineVertical = lineDy > lineDx * 2;
        const canvas = pdfCanvasRef.current;
        const pageIsPortrait = canvas ? canvas.height > canvas.width * 1.05 : false;
        const pageIsLandscape = canvas ? canvas.width > canvas.height * 1.05 : false;
        const orientationMismatch =
          (isLineHorizontal && pageIsPortrait) || (isLineVertical && pageIsLandscape);
        const lineTooShort = pixelDist < 50;
        const distancePresets: Array<{ value: number; unit: string; label: string }> = [
          { value: 1, unit: "ft", label: "1 ft" },
          { value: 5, unit: "ft", label: "5 ft" },
          { value: 10, unit: "ft", label: "10 ft" },
          { value: 25, unit: "ft", label: "25 ft" },
          { value: 50, unit: "ft", label: "50 ft" },
          { value: 100, unit: "ft", label: "100 ft" },
          { value: 1, unit: "m", label: "1 m" },
          { value: 5, unit: "m", label: "5 m" },
          { value: 10, unit: "m", label: "10 m" },
        ];
        // Architectural / engineering scale presets. Each one converts the
        // drawn paper distance into a real-world value via the formula:
        //   paperInches × multiplier = realValue
        const scalePresets: Array<{
          label: string;
          group: "metric" | "imperial";
          multiplier: number;
          unit: string;
        }> = [
          { label: "1:50",      group: "metric",   multiplier: 50  * 0.0254, unit: "m"  },
          { label: "1:100",     group: "metric",   multiplier: 100 * 0.0254, unit: "m"  },
          { label: "1:200",     group: "metric",   multiplier: 200 * 0.0254, unit: "m"  },
          { label: "1:500",     group: "metric",   multiplier: 500 * 0.0254, unit: "m"  },
          { label: "1:1000",    group: "metric",   multiplier: 1000 * 0.0254, unit: "m" },
          { label: '1/8"=1\'',  group: "imperial", multiplier: 8,  unit: "ft" },
          { label: '1/4"=1\'',  group: "imperial", multiplier: 4,  unit: "ft" },
          { label: '1/2"=1\'',  group: "imperial", multiplier: 2,  unit: "ft" },
          { label: '1"=1\'',    group: "imperial", multiplier: 1,  unit: "ft" },
          { label: '1"=10\'',   group: "imperial", multiplier: 10, unit: "ft" },
          { label: '1"=20\'',   group: "imperial", multiplier: 20, unit: "ft" },
          { label: '1"=50\'',   group: "imperial", multiplier: 50, unit: "ft" },
        ];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => {
                setCalibrationPromptOpen(false);
                setCalibrationPoints(null);
              }}
            />
            <Card className="relative z-10 w-full max-w-md border-amber-500/30 shadow-2xl">
              <div className="border-b border-line px-5 py-4 flex items-center gap-3">
                <div className="rounded-full bg-amber-500/15 p-2">
                  <Scaling className="h-4 w-4 text-amber-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-fg">Set drawing scale</h3>
                  <p className="mt-0.5 text-[11px] text-fg/55">
                    The line you drew measures{" "}
                    <span className="font-mono text-fg">{pixelDist.toFixed(1)} px</span>.
                    Enter what that distance represents in real life.
                  </p>
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <Input
                    className="text-base h-10"
                    type="number"
                    min={0.01}
                    step={0.01}
                    placeholder="Distance the line represents"
                    value={calibrationInput}
                    onChange={(e) => setCalibrationInput(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCalibrationConfirm();
                    }}
                  />
                  <Select
                    className="h-10"
                    value={calibrationUnit}
                    onValueChange={setCalibrationUnit}
                    options={[
                      { value: "ft", label: "ft" },
                      { value: "in", label: "in" },
                      { value: "m",  label: "m"  },
                      { value: "cm", label: "cm" },
                      { value: "mm", label: "mm" },
                      { value: "yd", label: "yd" },
                    ]}
                  />
                </div>

                {/* Auto-detected scales from OCR'ing the title block */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-fg/40">Detected from drawing</div>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={handleDetectScale}
                      disabled={detectingScale}
                      className="text-xs"
                      title="Run OCR on the title block to find a scale notation"
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      {detectingScale ? "Reading title block…" : detectedScales ? "Re-detect" : "Auto-detect"}
                    </Button>
                  </div>
                  {detectedScales && detectedScales.length === 0 && (
                    <div className="text-[11px] text-fg/40">
                      No scale notation found on this page. Use the manual presets below.
                    </div>
                  )}
                  {detectedDiscipline && (
                    <div className="text-[11px] text-fg/55 mt-1.5">
                      <Sparkles className="inline h-2.5 w-2.5 text-emerald-500 mr-1" />
                      Looks like a{" "}
                      <span className="font-medium text-fg/85 capitalize">
                        {detectedDiscipline.key.replace("-", " ")}
                      </span>{" "}
                      sheet
                      <span className="text-fg/35 ml-1">
                        (matched "{detectedDiscipline.raw}", {(detectedDiscipline.confidence * 100).toFixed(0)}%)
                      </span>
                    </div>
                  )}
                  {detectedScales && detectedScales.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {detectedScales.map((s, i) => {
                        const realValue = paperInches * s.multiplier;
                        return (
                          <button
                            key={`${s.label}-${i}`}
                            onClick={() => {
                              setCalibrationInput(realValue.toFixed(s.unit === "ft" ? 2 : 3));
                              setCalibrationUnit(s.unit);
                            }}
                            title={`From "${s.raw}" — at ${s.label}, this line ≈ ${realValue.toFixed(2)} ${s.unit} (confidence ${(s.confidence * 100).toFixed(0)}%)`}
                            className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Sparkles className="inline h-2.5 w-2.5 mr-1" />
                            {s.label}
                            {s.confidence >= 0.9 && <span className="ml-1 text-[9px] opacity-60">SCALE:</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Drawing scale presets — auto-fill the input from the line's
                    paper-distance using zoom-aware DPI math. */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1.5">Drawing scale</div>
                  <div className="flex flex-wrap gap-1.5">
                    {scalePresets.map((p) => {
                      const realValue = paperInches * p.multiplier;
                      return (
                        <button
                          key={p.label}
                          onClick={() => {
                            setCalibrationInput(realValue.toFixed(p.unit === "ft" ? 2 : 3));
                            setCalibrationUnit(p.unit);
                          }}
                          title={`At ${p.label}, this line ≈ ${realValue.toFixed(2)} ${p.unit}`}
                          className="rounded-md border border-line bg-panel2/30 px-2 py-1 text-[11px] text-fg/60 hover:border-amber-500/40 hover:text-fg transition-colors"
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Common distances — manual values the user already knows */}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1.5">Or known distance</div>
                  <div className="flex flex-wrap gap-1.5">
                    {distancePresets.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => {
                          setCalibrationInput(String(p.value));
                          setCalibrationUnit(p.unit);
                        }}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] transition-colors",
                          parseFloat(calibrationInput) === p.value && calibrationUnit === p.unit
                            ? "border-amber-500/50 bg-amber-500/10 text-amber-500"
                            : "border-line text-fg/60 hover:border-amber-500/30 hover:text-fg",
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live preview */}
                <div
                  className={cn(
                    "rounded-md px-3 py-2 text-xs font-mono transition-colors",
                    livePerUnit
                      ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                      : "bg-panel2/40 text-fg/35 border border-line",
                  )}
                >
                  {livePerUnit ? (
                    <>
                      Resulting scale:{" "}
                      <span className="font-semibold">
                        1 {calibrationUnit} = {(livePerUnit / Math.max(zoom, 0.0001)).toFixed(2)} px
                      </span>
                      <span className="text-fg/40 text-[10px] ml-2">(at 100% zoom)</span>
                    </>
                  ) : (
                    "Enter a distance to see the resulting scale"
                  )}
                </div>

                {/* Sanity warnings */}
                {(orientationMismatch || lineTooShort) && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-500 space-y-0.5">
                    {orientationMismatch && (
                      <div>
                        ⚠ The calibration line runs {isLineHorizontal ? "horizontally" : "vertically"} but
                        the page is {pageIsPortrait ? "portrait" : "landscape"}.
                        Some drawings use different scales for each axis — confirm this scale is correct
                        for the line's direction.
                      </div>
                    )}
                    {lineTooShort && (
                      <div>
                        ⚠ The calibration line is only {pixelDist.toFixed(0)} px. Short reference lines
                        amplify error — for best accuracy, use a labelled dimension at least 100 px long.
                      </div>
                    )}
                  </div>
                )}

                {/* Apply to all pages toggle */}
                {totalPages > 1 && (
                  <label className="flex items-center gap-2 text-xs text-fg/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={calibrationApplyToAllPages}
                      onChange={(e) => setCalibrationApplyToAllPages(e.target.checked)}
                      className="accent-amber-500"
                    />
                    Apply this scale to all {totalPages} pages of this drawing
                    <span className="text-fg/35 text-[10px] ml-1">(individual pages can override later)</span>
                  </label>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCalibrationPromptOpen(false);
                      setCalibrationPoints(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="accent"
                    size="sm"
                    onClick={handleCalibrationConfirm}
                    disabled={!livePerUnit}
                  >
                    Apply scale
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        );
      })()}

      {/* ─── Ask AI Slide-Up Panel ─── */}
      {/* ─── Auto Count Results Modal ─── */}
      {autoCountModalOpen && autoCountPending && (
        <div className="absolute bottom-12 left-16 right-[19rem] z-30 animate-in slide-in-from-bottom-4 duration-200">
          <Card className="border border-emerald-400/30 shadow-xl max-h-[50vh] flex flex-col">
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line shrink-0">
              <ScanSearch className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-xs font-semibold text-fg flex-1">
                Auto Count — {autoCountPending.included.filter(Boolean).length} of {autoCountPending.totalCount} selected (this page)
              </span>
              <button
                onClick={() => {
                  const allOn = autoCountPending.included.every(Boolean);
                  setAutoCountPending({ ...autoCountPending, included: autoCountPending.included.map(() => !allOn) });
                }}
                className="text-[10px] text-accent hover:underline mr-2"
              >
                {autoCountPending.included.every(Boolean) ? "Deselect All" : "Select All"}
              </button>
              <button onClick={handleRejectAutoCount} className="text-fg/30 hover:text-fg/60 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Scope row — re-run the search at a wider scope without first
                accepting/rejecting the per-page matches. */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-line bg-emerald-500/5 shrink-0">
              <span className="text-[10px] text-fg/45">Search scope:</span>
              <Button size="xs" variant="ghost" disabled className="text-emerald-500 cursor-default">
                <ScanSearch className="h-3 w-3 mr-1" /> This page
              </Button>
              {totalPages > 1 && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    setAutoCountModalOpen(false);
                    void handleCrossPageSearch();
                  }}
                  disabled={crossPageRunning}
                >
                  {crossPageRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                  This document ({totalPages} pages)
                </Button>
              )}
              {pdfDocuments.length > 1 && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    setAutoCountModalOpen(false);
                    void handleMultiDocSearch();
                  }}
                  disabled={multiDocRunning}
                >
                  {multiDocRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                  All drawings ({pdfDocuments.length})
                </Button>
              )}
            </div>
            <div className="overflow-y-auto flex-1 min-h-0 divide-y divide-line">
              {autoCountPending.matches.map((match, i) => {
                const previewSrc = match.image ?? autoCountPending.snippetImage ?? undefined;
                return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-xs cursor-pointer transition-colors",
                    autoCountPending.included[i] ? "bg-emerald-500/5" : "bg-panel opacity-50"
                  )}
                  onClick={() => {
                    const next = [...autoCountPending.included];
                    next[i] = !next[i];
                    setAutoCountPending({ ...autoCountPending, included: next });
                  }}
                >
                  <input
                    type="checkbox"
                    checked={autoCountPending.included[i]}
                    onChange={() => {}}
                    className="h-3.5 w-3.5 rounded border-line accent-emerald-500 shrink-0"
                  />
                  {previewSrc && (
                    <div className="shrink-0 rounded border border-line bg-white p-0.5">
                      <img
                        src={previewSrc}
                        alt={`Match #${i + 1}`}
                        className="h-10 w-10 object-contain"
                      />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-fg">Match #{i + 1}</span>
                    <span className="text-fg/40 ml-2">{(match.confidence * 100).toFixed(0)}% confidence</span>
                  </div>
                  <span className="text-[10px] text-fg/30 tabular-nums shrink-0">
                    ({Math.round(match.rect.x)}, {Math.round(match.rect.y)})
                  </span>
                </div>
              )})}
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-line shrink-0">
              <span className="text-[10px] text-fg/40">
                {autoCountPending.included.filter(Boolean).length} matches selected
              </span>
              <div className="flex gap-2">
                <Button size="xs" variant="secondary" onClick={handleRejectAutoCount}>Reject All</Button>
                <Button size="xs" variant="accent" onClick={handleAcceptAutoCount} disabled={!autoCountPending.included.some(Boolean)}>
                  Accept ({autoCountPending.included.filter(Boolean).length})
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ─── Smart Count Results Modal ─── */}
      {smartCountModalOpen && (
        <div className="absolute bottom-12 left-16 right-[19rem] z-30 animate-in slide-in-from-bottom-4 duration-200">
          <Card className="border border-emerald-400/30 shadow-xl max-h-[55vh] flex flex-col">
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line shrink-0">
              <Wand2 className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-xs font-semibold text-fg flex-1">
                Smart Count
                {smartCountItems && smartCountItems.length > 0 && (
                  <span className="ml-2 text-fg/45 font-normal">
                    {smartCountIncluded.filter(Boolean).length} of {smartCountItems.length} selected
                  </span>
                )}
              </span>
              {smartCountItems && smartCountItems.length > 0 && (
                <button
                  onClick={() => {
                    const allOn = smartCountIncluded.every(Boolean);
                    setSmartCountIncluded(smartCountItems.map(() => !allOn));
                  }}
                  className="text-[10px] text-accent hover:underline mr-2"
                >
                  {smartCountIncluded.every(Boolean) ? "Deselect All" : "Select All"}
                </button>
              )}
              <button onClick={handleRejectSmartCount} className="text-fg/30 hover:text-fg/60 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex gap-3 p-4 overflow-y-auto flex-1 min-h-0">
              {smartCountCropImage && (
                <div className="shrink-0 flex items-start">
                  <div className="rounded-md border border-line bg-white p-1.5">
                    <img src={smartCountCropImage} alt="Region" className="h-32 w-32 object-contain" />
                  </div>
                </div>
              )}
              <div className="flex-1 min-w-0">
                {smartCountRunning && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500 shrink-0" />
                    <span className="text-xs text-fg/60">Counting symbols in the region…</span>
                  </div>
                )}
                {smartCountError && !smartCountRunning && (
                  <div className="text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded-md px-2.5 py-1.5">
                    {smartCountError}
                  </div>
                )}
                {smartCountItems && smartCountItems.length > 0 && (
                  <div className="space-y-1">
                    {smartCountItems.map((item, i) => (
                      <div
                        key={i}
                        onClick={() => {
                          const next = [...smartCountIncluded];
                          next[i] = !next[i];
                          setSmartCountIncluded(next);
                        }}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
                          smartCountIncluded[i]
                            ? "bg-emerald-500/8 border border-emerald-500/20"
                            : "bg-panel2/30 border border-line opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={smartCountIncluded[i]}
                          onChange={() => {}}
                          className="h-3.5 w-3.5 rounded border-line accent-emerald-500 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-fg truncate">{item.label}</div>
                          {item.notes && (
                            <div className="text-[10px] text-fg/45 truncate">{item.notes}</div>
                          )}
                        </div>
                        <Badge
                          tone={item.confidence === "high" ? "success" : item.confidence === "medium" ? "warning" : "default"}
                          className="text-[9px] shrink-0"
                        >
                          {item.confidence}
                        </Badge>
                        <span className="text-base font-mono font-semibold text-emerald-500 tabular-nums shrink-0">
                          ×{item.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {smartCountItems && smartCountItems.length > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-line shrink-0">
                <span className="text-[10px] text-fg/40">
                  Total selected:{" "}
                  <span className="font-mono text-fg/70">
                    {smartCountItems.reduce(
                      (s, it, i) => s + (smartCountIncluded[i] ? it.count : 0),
                      0,
                    )}
                  </span>
                </span>
                <div className="flex gap-2">
                  <Button size="xs" variant="secondary" onClick={handleRejectSmartCount}>
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    variant="accent"
                    onClick={handleAcceptSmartCount}
                    disabled={!smartCountIncluded.some(Boolean)}
                  >
                    Add to drawing
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─── Legend Reader Panel ─── */}
      {legendOpen && (
        <div className="absolute top-16 right-4 z-30 w-[340px] max-h-[70vh] flex flex-col rounded-lg border border-amber-500/30 bg-panel shadow-2xl animate-in slide-in-from-right-4 duration-200">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line shrink-0">
            <BookOpen className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-xs font-semibold text-fg flex-1">
              Page legend
              {legendEntries && legendEntries.length > 0 && (
                <span className="ml-2 text-fg/45 font-normal">{legendEntries.length} entries</span>
              )}
            </span>
            <button onClick={() => setLegendOpen(false)} className="text-fg/30 hover:text-fg/60 transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {legendLoading && (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500 shrink-0" />
                <span className="text-xs text-fg/60">Reading legend table on this page…</span>
              </div>
            )}
            {!legendLoading && legendEntries && legendEntries.length === 0 && (
              <div className="text-[11px] text-fg/50 py-2">
                {legendWarnings[0] ?? "No legend table or symbol list found on this page."}
              </div>
            )}
            {legendEntries?.map((entry, i) => (
              <div
                key={`${entry.symbol}-${i}`}
                className="flex items-start gap-3 rounded-md border border-line bg-panel2/30 px-2.5 py-2"
              >
                <div className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-md border border-amber-500/40 bg-amber-500/10 font-mono text-[11px] font-semibold text-amber-400">
                  {entry.symbol}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-fg/85 leading-snug">{entry.label}</div>
                  {entry.confidence < 0.7 && (
                    <div className="text-[10px] text-fg/35 mt-0.5">low confidence</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {legendEntries && legendEntries.length > 0 && (
            <div className="px-3 py-2 border-t border-line text-[10px] text-fg/40">
              Tip: drop the AI-detected names into Smart Count or Auto Count to enrich your tally.
            </div>
          )}
        </div>
      )}

      {askAiModalOpen && askAiCropImage && (
        <div className="absolute bottom-12 left-16 right-[19rem] z-30 animate-in slide-in-from-bottom-4 duration-200">
          <Card className="border border-violet-300/30 shadow-xl max-h-[50vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line shrink-0">
              <BrainCircuit className="h-4 w-4 text-violet-500 shrink-0" />
              <span className="text-xs font-semibold text-fg flex-1">Ask AI</span>
              {askAiCountRunning && (
                <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
              )}
              {askAiResponse && !askAiCountRunning && (
                <button
                  onClick={() => { onOpenAgentChat?.(); handleCloseAskAiModal(); }}
                  className="text-[11px] text-accent hover:underline"
                >
                  Open in Chat
                </button>
              )}
              <button onClick={handleCloseAskAiModal} className="text-fg/30 hover:text-fg/60 transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Body */}
            <div className="flex gap-3 px-4 py-3 overflow-y-auto flex-1 min-h-0">
              {/* Snippet thumbnail */}
              <div className="shrink-0 flex items-start">
                <div className="rounded-md border border-line bg-white p-1.5">
                  <img
                    src={askAiCropImage}
                    alt="Selected region"
                    className="h-16 w-16 object-contain"
                  />
                </div>
              </div>

              {/* Response */}
              <div className="flex-1 min-w-0">
                {askAiCountRunning && !askAiResponse && (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500 shrink-0" />
                    <span className="text-xs text-fg/50">Analyzing region...</span>
                  </div>
                )}

                {askAiResponse && (
                  <div className="overflow-y-auto">
                    <MarkdownRenderer content={askAiResponse} />
                  </div>
                )}

                {!askAiResponse && !askAiCountRunning && (
                  <p className="text-xs text-fg/40 py-2">Preparing analysis...</p>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ─── Status Bar ─── */}
      <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-1.5 shrink-0">
        <p className="text-[11px] text-fg/40">
          {isDwgDocument
            ? "DWG takeoff surface active."
            : isCadDocument
            ? selectedModelIsEditable
              ? "Model editor active."
              : "3D model preview active."
            : TOOL_STATUS_TEXT[activeTool] ?? "Select a tool to begin."}
        </p>
        <div className="flex-1" />
        {!isCadDocument && !isDwgDocument && calibration && (
          <span className="text-[11px] text-fg/30">
            Scale: 1 {calibration.unit} = {calibration.pixelsPerUnit.toFixed(1)}px
          </span>
        )}
        {!isCadDocument && !isDwgDocument && (
          <>
            <span className="text-[11px] text-fg/30">
              Page {page}/{totalPages}
            </span>
            <span className="text-[11px] text-fg/30">
              {zoomPercent}%
            </span>
          </>
        )}
      </div>

      {/* ─── No-active-worksheet prompt ─── */}
      {/* Mounted whenever a model-element / model-selection action is queued
          against a non-existent worksheet. The user creates one inline; once
          they confirm, handleCreateWorksheetAndProceed resumes the queued
          action with the new worksheet. */}
      <CreateWorksheetModal
        open={worksheetPickerAction !== null}
        onClose={() => {
          setWorksheetPickerAction(null);
          setNewWorksheetName("");
        }}
        onConfirm={(name) => {
          setNewWorksheetName(name);
          void handleCreateWorksheetAndProceed(name);
        }}
      />

      {/* ─── Toast Notification ─── */}
      {toastMessage && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-[100] flex items-center gap-2.5 rounded-lg border px-4 py-2.5 shadow-xl transition-all animate-in slide-in-from-bottom-4 fade-in",
            toastType === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-700"
              : "border-red-500/30 bg-red-500/10 text-red-700"
          )}
        >
          {toastType === "success" ? (
            <Check className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <p className="text-xs font-medium">{toastMessage}</p>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 rounded p-0.5 hover:bg-black/10"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function DrawingIntelligenceOverlay({
  analysis,
  width,
  height,
  visible,
}: {
  analysis: DrawingGeometryAnalysisResult | null;
  width: number;
  height: number;
  visible: DrawingAnalysisOverlayState;
}) {
  if (!analysis || width <= 0 || height <= 0) return null;

  const sx = width / Math.max(analysis.imageWidth, 1);
  const sy = height / Math.max(analysis.imageHeight, 1);
  const lineById = new Map(analysis.lines.map((line) => [line.id, line]));
  const systemColors = ["#0ea5e9", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6"];

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[3]"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {visible.lines && analysis.lines.slice(0, 700).map((line) => (
        <line
          key={`line-${line.id}`}
          x1={line.x1 * sx}
          y1={line.y1 * sy}
          x2={line.x2 * sx}
          y2={line.y2 * sy}
          stroke="#38bdf8"
          strokeWidth={1.2}
          opacity={0.32}
          strokeLinecap="round"
        />
      ))}

      {visible.systems && analysis.systems.slice(0, 10).map((system, systemIndex) => {
        const color = systemColors[systemIndex % systemColors.length];
        return system.segmentIds.slice(0, 450).map((segmentId) => {
          const line = lineById.get(segmentId);
          if (!line) return null;
          return (
            <line
              key={`system-${system.id}-${segmentId}`}
              x1={line.x1 * sx}
              y1={line.y1 * sy}
              x2={line.x2 * sx}
              y2={line.y2 * sy}
              stroke={color}
              strokeWidth={2.6}
              opacity={0.72}
              strokeLinecap="round"
            />
          );
        });
      })}

      {visible.symbols && analysis.symbolCandidates.slice(0, 120).map((candidate) => (
        <rect
          key={`symbol-${candidate.id}`}
          x={candidate.x * sx}
          y={candidate.y * sy}
          width={candidate.w * sx}
          height={candidate.h * sy}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={1.5}
          opacity={0.8}
          rx={3}
        />
      ))}

      {visible.circles && analysis.circles.slice(0, 120).map((circle) => (
        <circle
          key={`circle-${circle.id}`}
          cx={circle.cx * sx}
          cy={circle.cy * sy}
          r={Math.max(circle.radius * ((sx + sy) / 2), 2)}
          fill="none"
          stroke="#ec4899"
          strokeWidth={1.5}
          opacity={0.75}
        />
      ))}

      {visible.text && analysis.textRegions.slice(0, 80).map((region) => (
        <rect
          key={`text-${region.id}`}
          x={region.x * sx}
          y={region.y * sy}
          width={region.w * sx}
          height={region.h * sy}
          fill="#111827"
          fillOpacity={0.05}
          stroke="#64748b"
          strokeDasharray="4 3"
          strokeWidth={1}
          opacity={0.65}
        />
      ))}
    </svg>
  );
}

function DrawingIntelligencePanel({
  preset,
  onPresetChange,
  analysis,
  running,
  savingId,
  error,
  overlay,
  onOverlayChange,
  onAnalyze,
  onTrace,
  onClose,
  onSaveSystem,
  onSaveSymbol,
}: {
  preset: DrawingAnalysisPreset;
  onPresetChange: (preset: DrawingAnalysisPreset) => void;
  analysis: DrawingGeometryAnalysisResult | null;
  running: boolean;
  savingId: string | null;
  error: string | null;
  overlay: DrawingAnalysisOverlayState;
  onOverlayChange: Dispatch<SetStateAction<DrawingAnalysisOverlayState>>;
  onAnalyze: () => void;
  onTrace: () => void;
  onClose: () => void;
  onSaveSystem: (system: DrawingTracedSystem) => void;
  onSaveSymbol: (candidate: DrawingSymbolCandidate) => void;
}) {
  const overlayOptions: Array<{ key: keyof DrawingAnalysisOverlayState; label: string }> = [
    { key: "systems", label: "Systems" },
    { key: "lines", label: "Lines" },
    { key: "symbols", label: "Symbols" },
    { key: "circles", label: "Circles" },
    { key: "text", label: "Text" },
  ];

  const stats = analysis
    ? [
        { label: "Lines", value: analysis.summary.lineCount },
        { label: "Systems", value: analysis.summary.systemCount },
        { label: "Symbols", value: analysis.summary.symbolCandidateCount },
        { label: "Circles", value: analysis.summary.circleCount },
      ]
    : [];

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <GitBranch className="h-4 w-4 shrink-0 text-sky-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-fg">Drawing intelligence</div>
          {analysis && (
            <div className="text-[11px] text-fg/40">
              Page {analysis.pageNumber} / {Math.round(analysis.duration_ms)} ms
            </div>
          )}
        </div>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />}
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
          aria-label="Close drawing intelligence"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-[1fr_auto_auto] gap-2">
          <Select
            value={preset}
            onValueChange={(value) => onPresetChange(value as DrawingAnalysisPreset)}
            options={DRAWING_ANALYSIS_PRESETS}
            size="xs"
            ariaLabel="Drawing analysis preset"
            triggerClassName="h-7"
          />
          <Button size="xs" variant="secondary" onClick={onAnalyze} disabled={running}>
            {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
            Analyze
          </Button>
          <Button size="xs" variant="secondary" onClick={onTrace} disabled={running}>
            <GitBranch className="h-3 w-3" />
            Trace
          </Button>
        </div>

        <div className="grid grid-cols-5 gap-1">
          {overlayOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onOverlayChange((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
              className={cn(
                "h-7 rounded-md border text-[10px] transition-colors",
                overlay[item.key]
                  ? "border-sky-500/35 bg-sky-500/10 text-sky-600"
                  : "border-line bg-panel2/30 text-fg/45 hover:text-fg/70"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700">
            {error}
          </div>
        )}

        {analysis ? (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-md border border-line bg-panel2/35 px-2 py-1.5">
                  <div className="text-[11px] font-semibold text-fg">{stat.value.toLocaleString()}</div>
                  <div className="text-[10px] text-fg/40">{stat.label}</div>
                </div>
              ))}
            </div>

            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-fg/60">Traced systems</span>
                <span className="text-[10px] text-fg/35">{Math.round(analysis.summary.totalSystemLengthPx).toLocaleString()} px</span>
              </div>
              {analysis.systems.length === 0 ? (
                <div className="rounded-md border border-line bg-panel2/25 px-3 py-2 text-[11px] text-fg/45">
                  No connected systems found on this page.
                </div>
              ) : (
                analysis.systems.slice(0, 8).map((system) => (
                  <div key={system.id} className="rounded-md border border-line bg-panel2/25 px-2.5 py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-fg">{system.label}</div>
                        <div className="mt-0.5 text-[10px] text-fg/40">
                          {system.segmentCount} segments / {Math.round(system.lengthPx).toLocaleString()} px / {Math.round(system.confidence * 100)}%
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-fg/45">
                          <span>{system.counts.openEnds} ends</span>
                          <span>{system.counts.tees} tees</span>
                          <span>{system.counts.elbows90 + system.counts.elbows45} elbows</span>
                          <span>{system.counts.crosses} crosses</span>
                        </div>
                      </div>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="h-7 w-7 px-0"
                        onClick={() => onSaveSystem(system)}
                        disabled={savingId === system.id}
                        aria-label={`Save ${system.label}`}
                        title="Save traced system as takeoff marks"
                      >
                        {savingId === system.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-fg/60">Symbol candidates</span>
                <span className="text-[10px] text-fg/35">{analysis.symbolCandidates.length.toLocaleString()}</span>
              </div>
              {analysis.symbolCandidates.length === 0 ? (
                <div className="rounded-md border border-line bg-panel2/25 px-3 py-2 text-[11px] text-fg/45">
                  No symbol-like marks found on this page.
                </div>
              ) : (
                analysis.symbolCandidates.slice(0, 10).map((candidate, index) => (
                  <div key={candidate.id} className="flex items-center gap-2 rounded-md border border-line bg-panel2/25 px-2.5 py-1.5">
                    <CircleDashed className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-fg">Candidate {index + 1}</div>
                      <div className="text-[10px] text-fg/40">
                        {Math.round(candidate.w)} x {Math.round(candidate.h)} px / {Math.round(candidate.confidence * 100)}%
                      </div>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="h-7 w-7 px-0"
                      onClick={() => onSaveSymbol(candidate)}
                      disabled={savingId === candidate.id}
                      aria-label={`Save symbol candidate ${index + 1}`}
                      title="Save symbol candidate as a count mark"
                    >
                      {savingId === candidate.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    </Button>
                  </div>
                ))
              )}
            </section>
          </>
        ) : (
          <div className="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed border-line bg-panel2/20 px-5 py-8 text-center">
            <ScanSearch className="mb-2 h-7 w-7 text-fg/25" />
            <div className="text-xs font-medium text-fg/65">No analysis for this page</div>
          </div>
        )}
      </div>
    </aside>
  );
}

"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Download,
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
  Puzzle,
  UploadCloud,
  Undo2,
  Redo2,
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
  getEntityCategories,
  listModelTakeoffLinks,
  queryModelElements,
  listModelAssets,
  syncModelAssets,
  updateWorksheetItem,
  updateWorkspaceState,
  apiRequest,
  detectTitleBlockScale,
  extractLegendFromPage,
  suggestLineItemsForAnnotation,
  getFileTree,
  importPreview,
  importProcess,
  uploadFile,
  type DetectedDisciplineRecord,
  type DetectedScaleRecord,
  type EntityCategory,
  type LegendEntryRecord,
  type LineItemSuggestionRecord,
  type WorkspaceStateRecord,
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
import { buildCsv } from "@/lib/csv";
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
import { LinkToLineItemModal } from "./takeoff/link-to-item-modal";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import {
  CreateAnnotationModal,
  type AnnotationConfig,
} from "./takeoff/create-annotation-modal";

const DWG_EXTENSIONS = new Set(["dwg", "dxf"]);
const MODEL_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl", "obj", "fbx", "gltf", "glb", "3ds", "dae", "ifc", "rvt"]);
const CAD_EXTENSIONS = new Set([...MODEL_EXTENSIONS, ...DWG_EXTENSIONS]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "tsv", "xls", "xlsx", "xlsm"]);

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

function isCadFile(fileName: string): boolean {
  return CAD_EXTENSIONS.has(getFileExtension(fileName));
}

function isPdfSource(fileName: string, fileType?: string | null): boolean {
  return fileName.toLowerCase().endsWith(".pdf") || fileType === "pdf" || fileType === "application/pdf";
}

function isSpreadsheetFile(fileName: string): boolean {
  return SPREADSHEET_EXTENSIONS.has(getFileExtension(fileName));
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
  kind: "pdf" | "model" | "dwg";
  fileName: string;
  /** For project docs – use getDocumentDownloadUrl */
  projectId?: string;
  fileNodeId?: string;
  modelAssetId?: string;
  /** For knowledge books – use getBookFileUrl */
  bookId?: string;
}

interface TakeoffTabProps {
  workspace: ProjectWorkspaceData;
  onOpenAgentChat?: (prefill?: string) => void;
  onOpenImportLineItems?: () => void;
  onOpenDocuments?: () => void;
  onOpenPluginTools?: () => void;
  onOpenRevisionDiff?: () => void;
  onWorkspaceMutated?: () => void;
  initialDocumentId?: string | null;
  initialPage?: number;
  detached?: boolean;
  workspaceSyncOriginId?: string;
  selectedWorksheetId?: string | null;
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
  | (TakeoffSyncBase & { type: "calibration-change"; calibration: Calibration | null });

type TakeoffSyncPayload =
  | { type: "view-change"; docId: string; page: number; zoom: number }
  | { type: "annotations-mutated"; docId: string; page: number; annotations?: TakeoffAnnotation[] }
  | { type: "takeoff-links-mutated" }
  | { type: "workspace-mutated" }
  | { type: "calibration-change"; calibration: Calibration | null };

function takeoffChannelName(projectId: string): string {
  return `bw-takeoff-${projectId}`;
}

function getTakeoffDocumentKind(fileName: string): TakeoffDocument["kind"] {
  if (isDwgFile(fileName)) return "dwg";
  return isCadFile(fileName) ? "model" : "pdf";
}

function fileNodeToTakeoffDocument(projectId: string, node: FileNode): TakeoffDocument | null {
  if (!node.name.toLowerCase().endsWith(".pdf") && !isCadFile(node.name)) {
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
  if (kind === "model") return "Model";
  return "PDF";
}

function sourceCountText(count: number, singular: string, plural = `${singular}s`) {
  return count ? `${count} ${count === 1 ? singular : plural}` : null;
}

const SPREADSHEET_IMPORT_TARGETS = [
  { value: "skip", label: "Skip" },
  { value: "entityName", label: "Item name" },
  { value: "description", label: "Description" },
  { value: "quantity", label: "Quantity" },
  { value: "uom", label: "UOM" },
  { value: "cost", label: "Unit cost" },
  { value: "markup", label: "Markup" },
  { value: "price", label: "Unit price" },
  { value: "category", label: "Category" },
  { value: "entityType", label: "Type" },
  { value: "vendor", label: "Vendor" },
  { value: "lineOrder", label: "Line order" },
] as const;

type SpreadsheetImportTarget = typeof SPREADSHEET_IMPORT_TARGETS[number]["value"];
type SpreadsheetPanelView = "preview" | "pivot" | "map";

function inferSpreadsheetImportTarget(header: string): SpreadsheetImportTarget {
  const normalized = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (!normalized) return "skip";
  if (/(^|\s)(item|item name|name|material|part|line item|scope)(\s|$)/.test(normalized)) return "entityName";
  if (/desc|scope|notes|work description/.test(normalized)) return "description";
  if (/(^|\s)(qty|quantity|count|hours|hrs)(\s|$)/.test(normalized)) return "quantity";
  if (/(^|\s)(uom|unit of measure|unit)(\s|$)/.test(normalized)) return "uom";
  if (/unit cost|cost each|cost|material cost|labou?r cost/.test(normalized)) return "cost";
  if (/markup|margin|gross margin/.test(normalized)) return "markup";
  if (/unit price|sell|price|extension|amount|total/.test(normalized)) return "price";
  if (/category|class|division/.test(normalized)) return "category";
  if (/type|resource/.test(normalized)) return "entityType";
  if (/vendor|supplier|manufacturer/.test(normalized)) return "vendor";
  if (/order|line no|line number|sequence/.test(normalized)) return "lineOrder";
  return "skip";
}

function buildInitialSpreadsheetMapping(headers: string[]) {
  return Object.fromEntries(headers.map((header) => [header, inferSpreadsheetImportTarget(header)]));
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
  return {
    categoryId: options.category?.id ?? null,
    category: options.category?.name ?? "Model Takeoff",
    entityType: options.category?.entityType ?? element.elementClass ?? "Model Element",
    entityName: element.name || element.externalId || element.id,
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

/* ─── CSV Export Helper ─── */

function exportAnnotationsCsv(annotations: TakeoffAnnotation[], calibration: Calibration | null) {
  const rows: string[][] = [
    ["Label", "Type", "Group", "Value", "Unit", "Area", "Volume", "Color", "Points"],
  ];

  for (const ann of annotations) {
    const m = ann.measurement;
    rows.push([
      ann.label || "",
      ann.type,
      ann.groupName || "",
      m?.value?.toString() ?? "",
      m?.unit ?? "",
      m?.area?.toString() ?? "",
      m?.volume?.toString() ?? "",
      ann.color,
      ann.points.map((p) => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(" "),
    ]);
  }

  if (calibration) {
    rows.push([]);
    rows.push(["Calibration", `1 ${calibration.unit} = ${calibration.pixelsPerUnit.toFixed(2)} px`]);
  }

  const csv = buildCsv(rows[0] ?? [], rows.slice(1));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "takeoff-marks.csv";
  a.click();
  URL.revokeObjectURL(url);
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
  onOpenDocuments,
  onOpenPluginTools,
  onOpenRevisionDiff,
  onWorkspaceMutated,
  initialDocumentId,
  initialPage = 1,
  detached = false,
  workspaceSyncOriginId,
  selectedWorksheetId,
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
  const defaultCategory = useMemo(() => {
    return entityCategories.filter((c) => c.enabled).slice().sort((a, b) => a.order - b.order)[0];
  }, [entityCategories]);
  const rateScheduleCategory = useMemo(() => {
    return entityCategories.filter((c) => c.enabled && c.itemSource === "rate_schedule").slice().sort((a, b) => a.order - b.order)[0];
  }, [entityCategories]);

  /* Project source documents that are PDFs or CAD files */
  const projectPdfs: TakeoffDocument[] = (workspace.sourceDocuments ?? [])
    .filter((d) => isPdfSource(d.fileName, d.fileType) || isCadFile(d.fileName))
    .map((d) => ({
      id: d.id,
      label: d.fileName,
      fileName: d.fileName,
      kind: getTakeoffDocumentKind(d.fileName),
      source: "project" as const,
      projectId,
    }));

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

  const drawings = [...projectPdfs, ...knowledgePdfs];

  /* Core state */
  const [selectedDocId, setSelectedDocId] = useState(initialDocumentId ?? projectPdfs[0]?.id ?? "");
  const [showLanding, setShowLanding] = useState(!detached && !initialDocumentId);
  type IntakeOptionId = "spreadsheet" | "source" | "extract" | "tools";
  const [activeIntakeOption, setActiveIntakeOption] = useState<IntakeOptionId>("source");
  const sourceUploadInputRef = useRef<HTMLInputElement>(null);
  const spreadsheetUploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadedTakeoffDocuments, setUploadedTakeoffDocuments] = useState<TakeoffDocument[]>([]);
  const [fileTreeNodes, setFileTreeNodes] = useState<FileNode[]>([]);
  const [uploadingTakeoffSource, setUploadingTakeoffSource] = useState(false);
  const [uploadingSpreadsheetSource, setUploadingSpreadsheetSource] = useState(false);
  const [spreadsheetPreviewLoading, setSpreadsheetPreviewLoading] = useState(false);
  const [spreadsheetImporting, setSpreadsheetImporting] = useState(false);
  const [selectedSpreadsheetNodeId, setSelectedSpreadsheetNodeId] = useState<string | null>(null);
  const [spreadsheetPreview, setSpreadsheetPreview] = useState<(ImportPreviewResponse & { sourceName: string; sourceNodeId?: string }) | null>(null);
  const [spreadsheetMapping, setSpreadsheetMapping] = useState<Record<string, SpreadsheetImportTarget>>({});
  const [spreadsheetPanelView, setSpreadsheetPanelView] = useState<SpreadsheetPanelView>("preview");
  const [pivotGroupBy, setPivotGroupBy] = useState("");
  const [pivotMeasure, setPivotMeasure] = useState("__count");

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AnnotationConfig | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const undoStackRef = useRef<TakeoffHistoryCommand[]>([]);
  const redoStackRef = useRef<TakeoffHistoryCommand[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);

  /* ─── Takeoff Link state ─── */
  const [takeoffLinks, setTakeoffLinks] = useState<TakeoffLinkRecord[]>([]);
  const [linkModalAnnotationId, setLinkModalAnnotationId] = useState<string | null>(null);

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

  /* Export dropdown */
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

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
  const loadAnnotationsRef = useRef<() => Promise<void>>(async () => {});
  const loadTakeoffLinksRef = useRef<() => Promise<void>>(async () => {});
  const onWorkspaceMutatedRef = useRef(onWorkspaceMutated);
  const calibrationRef = useRef(calibration);
  const initialDocumentAppliedRef = useRef(!initialDocumentId);

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
  const fileManagerModelDocuments = useMemo<TakeoffDocument[]>(
    () =>
      modelAssets
        .filter((asset) => asset.fileNodeId && !projectPdfs.some((doc) => doc.id === asset.sourceDocumentId))
        .map((asset) => ({
          id: `model-asset-${asset.id}`,
          label: asset.fileName,
          fileName: asset.fileName,
          kind: "model" as const,
          source: "project" as const,
          projectId,
          fileNodeId: asset.fileNodeId ?? undefined,
          modelAssetId: asset.id,
        })),
    [modelAssets, projectId, projectPdfs],
  );
  const takeoffDocuments = useMemo(
    () => [...drawings, ...fileManagerModelDocuments, ...uploadedTakeoffDocuments],
    [drawings, fileManagerModelDocuments, uploadedTakeoffDocuments],
  );
  const selectedDoc = takeoffDocuments.find((d) => d.id === selectedDocId);
  const pdfDocuments = takeoffDocuments.filter((d) => d.kind === "pdf");
  const dwgDocuments = takeoffDocuments.filter((d) => d.kind === "dwg");
  const selectedDocumentKind = selectedDoc?.kind ?? "pdf";
  const isCadDocument = selectedDocumentKind === "model";
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

  useEffect(() => {
    selectedDocIdRef.current = selectedDocId;
  }, [selectedDocId]);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

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
    try {
      const data = await listTakeoffAnnotations(projectId, selectedDocId, page);
      if (Array.isArray(data)) {
        setAnnotations(
          data.map((a: Record<string, unknown>) => ({
            id: a.id as string,
            type: a.type as string,
            label: (a.label as string) ?? "",
            color: (a.color as string) ?? "#3b82f6",
            thickness: (a.thickness as number) ?? 3,
            points: (a.points as Point[]) ?? [],
            visible: a.visible !== false,
            groupName: a.groupName as string | undefined,
            opts: a.opts as TakeoffAnnotation["opts"],
            measurement: a.measurement as TakeoffAnnotation["measurement"],
          }))
        );
      }
    } catch {
      /* API may not be available yet; use local state */
    }
  }, [projectId, selectedDocId, page]);

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
          setZoom(Math.max(0.25, Math.min(msg.zoom, 5)));
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
        const fitZ = Math.round(Math.min(cw / w, ch / h) * 100) / 100;
        setZoom(Math.max(0.25, Math.min(fitZ, 5)));
      });
    }
  }, []);

  /* Close export dropdown on outside click */
  useEffect(() => {
    if (!exportDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setExportDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [exportDropdownOpen]);

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

  /* Mouse-wheel zoom while the cursor is inside the 2D PDF viewer.
     Native listener (passive: false) so we can preventDefault and stop the
     page from scrolling. CAD documents have their own zoom controls so we
     skip them. */
  useEffect(() => {
    const container = viewerContainerRef.current;
    if (!container) return;
    if (isCadDocument || isDwgDocument) return;

    function onWheel(e: WheelEvent) {
      // Ignore horizontal-wheel devices and keep ctrl-zoom intact (browser default).
      if (e.ctrlKey) return;
      // Ignore if no PDF is rendered (avoid intercepting on the empty state).
      const canvas = pdfCanvasRef.current;
      if (!canvas || canvas.width === 0) return;
      e.preventDefault();
      // deltaY positive = scroll down = zoom out. Step ~10% per notch.
      const direction = e.deltaY > 0 ? -1 : 1;
      const factor = 1 + direction * 0.1;
      setZoom((z) => {
        const next = Math.max(0.25, Math.min(5, z * factor));
        return Math.round(next * 100) / 100;
      });
    }

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [isCadDocument, isDwgDocument, selectedDocId]);

  /* ─── Handlers ─── */

  function handlePrevPage() {
    setPage((p) => Math.max(1, p - 1));
  }

  function handleNextPage() {
    setPage((p) => Math.min(totalPages, p + 1));
  }

  function handleZoomIn() {
    setZoom((z) => Math.min(4, z + 0.25));
  }

  function handleZoomOut() {
    setZoom((z) => Math.max(0.25, z - 0.25));
  }

  function handleFitToWidth() {
    const container = viewerContainerRef.current;
    const canvas = pdfCanvasRef.current;
    if (!container || !canvas || canvas.width === 0) {
      setZoom(1);
      return;
    }
    /* Container inner width minus the m-4 (16px) padding on each side of the inline-block wrapper */
    const containerWidth = container.clientWidth - 32;
    /* PDF page width at zoom=1 */
    const baseWidth = canvas.width / zoom;
    const fitZoom = Math.round((containerWidth / baseWidth) * 100) / 100;
    setZoom(Math.max(0.25, Math.min(fitZoom, 5)));
    /* Scroll to top-left after fitting */
    container.scrollTo({ top: 0, left: 0 });
  }

  function handleFitToPage() {
    const container = viewerContainerRef.current;
    const canvas = pdfCanvasRef.current;
    if (!container || !canvas || canvas.width === 0) {
      setZoom(1);
      return;
    }
    const containerWidth = container.clientWidth - 32;
    const containerHeight = container.clientHeight - 32;
    const baseWidth = canvas.width / zoom;
    const baseHeight = canvas.height / zoom;
    const fitZoom = Math.round(Math.min(containerWidth / baseWidth, containerHeight / baseHeight) * 100) / 100;
    setZoom(Math.max(0.25, Math.min(fitZoom, 5)));
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
    setShowCreateModal(true);
    setPendingConfig(null);
    setActiveTool(tool);
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
    return {
      documentId: selectedDocId,
      pageNumber: page,
      annotationType: annotation.type || activeTool || "unknown",
      label: annotation.label || "",
      color: annotation.color || "#3b82f6",
      lineThickness: annotation.thickness ?? 4,
      visible: annotation.visible ?? true,
      groupName: annotation.groupName || "",
      points: annotation.points || [],
      measurement: annotation.measurement ?? {},
      metadata: annotation.opts ?? {},
    };
  }

  function mapSavedAnnotation(saved: any, fallback: TakeoffAnnotation): TakeoffAnnotation {
    return {
      ...fallback,
      id: String(saved?.id ?? fallback.id),
      type: String(saved?.annotationType ?? saved?.type ?? fallback.type),
      label: String(saved?.label ?? fallback.label ?? ""),
      color: String(saved?.color ?? fallback.color ?? "#3b82f6"),
      thickness: Number(saved?.lineThickness ?? saved?.thickness ?? fallback.thickness ?? 4),
      visible: saved?.visible !== false,
      groupName: String(saved?.groupName ?? fallback.groupName ?? ""),
      points: Array.isArray(saved?.points) ? saved.points : fallback.points,
      measurement: saved?.measurement ?? fallback.measurement,
      opts: saved?.metadata ?? fallback.opts,
      canvasWidth: fallback.canvasWidth,
      canvasHeight: fallback.canvasHeight,
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
      setSelectedAnnotationId(newAnnotation.id);
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

  // Reset legend when the user switches doc or page — entries are page-specific.
  useEffect(() => {
    setLegendOpen(false);
    setLegendEntries(null);
    setLegendWarnings([]);
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
    setSelectedAnnotationId(id);
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

  /* ─── Takeoff Link handlers ─── */

  function handleLinkToLineItem(annotationId: string) {
    setLinkModalAnnotationId(annotationId);
  }

  async function handleLinkConfirm(data: { worksheetItemId: string; quantityField: string; multiplier: number }) {
    if (!linkModalAnnotationId) return;
    try {
      await createTakeoffLink(projectId, {
        annotationId: linkModalAnnotationId,
        worksheetItemId: data.worksheetItemId,
        quantityField: data.quantityField,
        multiplier: data.multiplier,
      });
      await loadTakeoffLinks();
      notifyTakeoffLinksMutated();
    } catch (err) {
      console.error("[takeoff-link] Failed to create link:", err);
    }
    setLinkModalAnnotationId(null);
  }

  async function handleSendToEstimate(annotationId: string) {
    const ann = annotations.find((a) => a.id === annotationId);
    if (!ann?.measurement) return;

    const targetWs = selectedWorksheet;
    if (!targetWs) return;

    try {
      // Determine UOM from annotation measurement
      const unit = ann.measurement.unit ?? "EA";
      const uomMap: Record<string, string> = { ft: "LF", "ft\u00B2": "SF", "ft\u00B3": "CF", m: "M", "m\u00B2": "SM", count: "EA" };
      const uom = uomMap[unit] ?? unit;

      const qty = ann.measurement.value ?? 0;
      if (!defaultCategory) {
        setToastType("error");
        setToastMessage("Configure at least one entity category in Settings before adding takeoff lines.");
        return;
      }
      const result = await createWorksheetItem(projectId, targetWs.id, {
        categoryId: defaultCategory.id,
        category: defaultCategory.name,
        entityType: defaultCategory.entityType,
        entityName: ann.label || `${ann.type} Measurement`,
        description: "",
        quantity: qty,
        uom,
        cost: 0,
        markup: workspace.currentRevision.defaultMarkup ?? 0.2,
        price: 0,
        sourceNotes: `From takeoff: ${ann.label || ann.type}`,
      });

      // Extract new item ID from workspace response and create link
      const newItems = result?.workspace?.worksheets
        ?.flatMap((ws: { items?: { id: string }[] }) => ws.items ?? []) ?? [];
      const newItem = newItems.find((i: { id: string }) =>
        !workspace.worksheets.flatMap((ws) => ws.items).some((existing) => existing.id === i.id)
      );

      if (newItem) {
        await createTakeoffLink(projectId, {
          annotationId,
          worksheetItemId: newItem.id,
        });
        await loadTakeoffLinks();
        notifyTakeoffLinksMutated();
      }
      notifyWorkspaceMutated();
    } catch (err) {
      console.error("[takeoff] Failed to send to estimate:", err);
    }
  }

  /* ─── AI line-item suggestions for an annotation ─── */

  async function handleSuggestLineItems(annotationId: string) {
    return suggestLineItemsForAnnotation(projectId, annotationId);
  }

  /* Apply one of the AI's suggestions: create a worksheet item using the
     suggestion's name/code/unit (instead of the raw annotation label) and
     the annotation's measured quantity, then link the new line item back
     to the annotation. Same shape as handleSendToEstimate, just sourced
     from the catalog/rate-schedule match. */
  async function handleApplySuggestion(
    annotationId: string,
    suggestion: LineItemSuggestionRecord,
  ) {
    const ann = annotations.find((a) => a.id === annotationId);
    if (!ann?.measurement) return;
    const targetWs = selectedWorksheet;
    if (!targetWs) {
      console.warn("[takeoff:suggest] No worksheet selected; cannot apply suggestion");
      return;
    }

    const quantity =
      suggestion.recommendedQuantity > 0
        ? suggestion.recommendedQuantity
        : ann.measurement.value ?? 0;
    const uom = suggestion.unit || ann.measurement.unit || "EA";
    // Suggestions tagged "rateScheduleItem" map to whichever org category sources from rate schedules; everything else falls through to the first enabled category.
    const targetCat = suggestion.kind === "rateScheduleItem"
      ? rateScheduleCategory ?? defaultCategory
      : defaultCategory;
    if (!targetCat) {
      setToastType("error");
      setToastMessage("Configure at least one entity category in Settings before adding suggestions.");
      return;
    }
    const category = targetCat.name;
    const entityName = suggestion.code
      ? `[${suggestion.code}] ${suggestion.name}`
      : suggestion.name;

    try {
      // Forward the catalog or rate-schedule reference so server-side
      // validation passes — rate-schedule-backed categories (Labour by
      // default) require rateScheduleItemId, and catalog-backed
      // categories require itemId. Without these the create-item
      // endpoint rejects with 400 and the Add action silently fails.
      const result = await createWorksheetItem(projectId, targetWs.id, {
        categoryId: targetCat.id,
        category,
        entityType: targetCat.entityType,
        entityName,
        description: suggestion.reasoning ?? "",
        quantity,
        uom,
        cost: 0,
        markup: workspace.currentRevision.defaultMarkup ?? 0.2,
        price: 0,
        sourceNotes: `AI-suggested from takeoff: ${ann.label || ann.type}`,
        ...(suggestion.kind === "rateScheduleItem"
          ? { rateScheduleItemId: suggestion.id }
          : { itemId: suggestion.id }),
      });

      const newItems = result?.workspace?.worksheets
        ?.flatMap((ws: { items?: { id: string }[] }) => ws.items ?? []) ?? [];
      const newItem = newItems.find((i: { id: string }) =>
        !workspace.worksheets.flatMap((ws) => ws.items).some((existing) => existing.id === i.id),
      );

      if (newItem) {
        await createTakeoffLink(projectId, {
          annotationId,
          worksheetItemId: newItem.id,
        });
        await loadTakeoffLinks();
        notifyTakeoffLinksMutated();
      }
      notifyWorkspaceMutated();
    } catch (err) {
      console.error("[takeoff:suggest] Failed to apply suggestion:", err);
    }
  }

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
  ) {
    try {
      const draftList = (lineItemDrafts?.length
        ? lineItemDrafts
        : lineItemDraft
          ? [lineItemDraft]
          : buildModelSelectionObjectDrafts(selection, {
              fileName: selectedDoc?.fileName,
              markup: workspace.currentRevision.defaultMarkup ?? 0.2,
              category: defaultCategory,
            })
      ).slice(0, 250);
      const modelAsset = await resolveSelectedModelAsset();
      let previousItemIds = new Set(workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
      let createdCount = 0;
      let targetWorksheetName = selectedWorksheet?.name ?? "worksheet";

      for (const draft of draftList) {
        const targetWs =
          (draft?.worksheetId
            ? workspace.worksheets.find((worksheet) => worksheet.id === draft.worksheetId)
            : null) ?? selectedWorksheet;
        if (!targetWs) {
          setToastType("error");
          setToastMessage("Create a worksheet before sending model quantities.");
          return;
        }
        targetWorksheetName = targetWs.name;

        const draftSelection = selectionFromDraft(selection, draft);
        const fallbackPayload = buildModelSelectionLineItem(draftSelection, {
          fileName: selectedDoc?.fileName,
          markup: workspace.currentRevision.defaultMarkup ?? 0.2,
          category: defaultCategory,
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
    previousItemIds = new Set(workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id)),
  ) {
    if (!selectedWorksheet) {
      setToastType("error");
      setToastMessage("Create a worksheet before sending model quantities.");
      return null;
    }
    if (!defaultCategory) {
      setToastType("error");
      setToastMessage("Configure at least one entity category in Settings before creating model line items.");
      return null;
    }
    const modelAsset = await resolveSelectedModelAsset();
    if (!modelAsset) {
      setToastType("error");
      setToastMessage("Sync the model index before creating model line items.");
      return null;
    }

    const primary = getModelElementTakeoffQuantity(element, modelLedgerBasis);
    const payload = buildModelElementLineItem(element, primary, {
      fileName: selectedDoc?.fileName,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      category: defaultCategory,
    });
    const result = await createWorksheetItem(projectId, selectedWorksheet.id, payload);
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

  async function handleCreateModelElementLineItem(element: ModelElementWithQuantities) {
    try {
      await createLineItemFromModelElement(element);
      await refreshModelTakeoffLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Created model line item.");
    } catch (error) {
      console.error("[takeoff] Failed to create model element line item:", error);
      setToastType("error");
      setToastMessage("Could not create a line item from that model element.");
    }
  }

  async function handleCreateSelectedModelElements() {
    const candidates = selectedModelElements.filter((element) => !linkedModelElementIds.has(element.id));
    if (candidates.length === 0) {
      setToastType("error");
      setToastMessage("Select unlinked model elements first.");
      return;
    }

    try {
      let created = 0;
      let previousItemIds = new Set(workspace.worksheets.flatMap((worksheet) => worksheet.items).map((item) => item.id));
      for (const element of candidates.slice(0, 250)) {
        const createdResult = await createLineItemFromModelElement(element, previousItemIds);
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
  const modelDocuments = takeoffDocuments.filter((doc) => doc.kind === "model");
  const dwgDocumentCount = dwgDocuments.length;
  const sourceCountLabel = [
    sourceCountText(pdfDocuments.length, "PDF", "PDFs"),
    sourceCountText(dwgDocumentCount, "DWG/DXF", "DWG/DXF files"),
    sourceCountText(modelDocuments.length, "model", "models"),
  ].filter(Boolean).join(" · ");
  const selectedSourceLabel = selectedDoc?.label ?? takeoffDocuments[0]?.label ?? "";
  const spreadsheetSources = fileTreeNodes.filter((node) => node.type === "file" && isSpreadsheetFile(node.name));
  const extractableDocuments = (workspace.sourceDocuments ?? [])
    .filter((doc) => !isCadFile(doc.fileName))
    .slice(0, 8);
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
  const mappedTargetCount = Object.values(spreadsheetMapping).filter((target) => target !== "skip").length;

  async function previewSpreadsheetFile(file: File, source: { nodeId?: string; name: string }) {
    setSpreadsheetPreviewLoading(true);
    setSelectedSpreadsheetNodeId(source.nodeId ?? null);
    try {
      const preview = await importPreview(projectId, file);
      const nextPreview = { ...preview, sourceName: source.name, sourceNodeId: source.nodeId };
      setSpreadsheetPreview(nextPreview);
      setSpreadsheetMapping(buildInitialSpreadsheetMapping(preview.headers));
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

  async function handleSpreadsheetSourceUpload(files: FileList | null) {
    const spreadsheetFiles = Array.from(files ?? []).filter((file) => isSpreadsheetFile(file.name));
    if (spreadsheetUploadInputRef.current) spreadsheetUploadInputRef.current.value = "";
    if (spreadsheetFiles.length === 0) {
      setToastType("error");
      setToastMessage("Choose a CSV, XLS, or XLSX file.");
      return;
    }

    setUploadingSpreadsheetSource(true);
    try {
      const nodes = await Promise.all(spreadsheetFiles.map((file) => uploadFile(projectId, file)));
      setFileTreeNodes((current) => mergeFileNodes(current, nodes));
      setToastType("success");
      setToastMessage(`Uploaded ${nodes.length} spreadsheet source${nodes.length === 1 ? "" : "s"} to Documents.`);
      const firstNode = nodes.find((node) => isSpreadsheetFile(node.name));
      if (firstNode) {
        await previewSpreadsheetNode(firstNode);
      }
      void refreshFileTree();
    } catch (error) {
      console.error("[takeoff] Spreadsheet upload failed:", error);
      setToastType("error");
      setToastMessage("Could not upload that spreadsheet or CSV.");
    } finally {
      setUploadingSpreadsheetSource(false);
    }
  }

  async function handleImportSpreadsheetPreview() {
    if (!spreadsheetPreview || !selectedWorksheet) return;
    const fieldMapping = Object.fromEntries(
      Object.entries(spreadsheetMapping)
        .filter(([, target]) => target && target !== "skip")
        .map(([header, target]) => [target, header])
    );
    if (!fieldMapping.entityName && !fieldMapping.description) {
      setToastType("error");
      setToastMessage("Map at least an item name or description column before importing.");
      setSpreadsheetPanelView("map");
      return;
    }

    setSpreadsheetImporting(true);
    try {
      await importProcess(projectId, {
        fileId: spreadsheetPreview.fileId,
        worksheetId: selectedWorksheet.id,
        mapping: fieldMapping,
      });
      setToastType("success");
      setToastMessage(`Imported ${spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length} rows into ${selectedWorksheet.name}.`);
      notifyWorkspaceMutated();
    } catch (error) {
      console.error("[takeoff] Spreadsheet import failed:", error);
      setToastType("error");
      setToastMessage("Could not import that spreadsheet.");
    } finally {
      setSpreadsheetImporting(false);
    }
  }

  function openTakeoffSurface(docId?: string) {
    const nextDocId = docId ?? selectedDocId ?? takeoffDocuments[0]?.id;
    if (nextDocId) {
      setSelectedDocId(nextDocId);
    }
    if (!nextDocId) {
      onOpenDocuments?.();
      return;
    }
    setShowLanding(false);
  }

  function openDocumentExtractor(sourceName?: string) {
    onOpenAgentChat?.(
      [
        sourceName ? `Use ${sourceName} as the starting source.` : "Review the project documents.",
        "Extract estimate-ready line items, quantities, vendor BOM rows, equipment schedules, alternates, and allowances.",
        "Stage the results by worksheet with source references before applying anything.",
      ].join(" ")
    );
  }

  async function handleTakeoffSourceUpload(files: FileList | null) {
    const sourceFiles = Array.from(files ?? []).filter((file) => file.name.toLowerCase().endsWith(".pdf") || isCadFile(file.name));
    if (sourceUploadInputRef.current) sourceUploadInputRef.current.value = "";
    if (sourceFiles.length === 0) {
      setToastType("error");
      setToastMessage("Choose a PDF, DWG/DXF, or model file.");
      return;
    }

    setUploadingTakeoffSource(true);
    try {
      const nodes = await Promise.all(sourceFiles.map((file) => uploadFile(projectId, file)));
      const docs = nodes
        .map((node) => fileNodeToTakeoffDocument(projectId, node))
        .filter((doc): doc is TakeoffDocument => Boolean(doc));
      if (docs.length === 0) {
        setToastType("error");
        setToastMessage("No takeoff-ready source was uploaded.");
        return;
      }
      setUploadedTakeoffDocuments((current) => [...current, ...docs]);
      setSelectedDocId(docs[0]!.id);
      setShowLanding(false);
      setToastType("success");
      setToastMessage(`Uploaded ${docs.length} takeoff source${docs.length === 1 ? "" : "s"}.`);
      if (docs.some((doc) => doc.kind === "model")) {
        void refreshModelAssets(true);
      }
    } catch (error) {
      console.error("[takeoff] Source upload failed:", error);
      setToastType("error");
      setToastMessage("Could not upload that takeoff source.");
    } finally {
      setUploadingTakeoffSource(false);
    }
  }

  const intakeOptions = [
    {
      id: "spreadsheet",
      title: "Import Spreadsheet/CSV",
      detail: spreadsheetSources.length ? `${spreadsheetSources.length} file${spreadsheetSources.length === 1 ? "" : "s"} found` : "CSV, XLSX, XLS",
      icon: FileSpreadsheet,
      disabled: false,
    },
    {
      id: "source",
      title: "Use Drawing or Model",
      detail: sourceCountLabel || "PDF, DWG/DXF, 3D model",
      icon: Files,
      disabled: false,
    },
    {
      id: "extract",
      title: "Extract From Document",
      detail: extractableDocuments.length ? `${extractableDocuments.length} source${extractableDocuments.length === 1 ? "" : "s"} available` : "Specs, RFQs, quotes",
      icon: FolderOpen,
      disabled: !onOpenAgentChat,
    },
    {
      id: "tools",
      title: "Use Trade Tool",
      detail: "Configured calculators and plugins",
      icon: Puzzle,
      disabled: !onOpenPluginTools,
    },
  ] satisfies Array<{
    id: IntakeOptionId;
    title: string;
    detail: string;
    icon: typeof Ruler;
    disabled: boolean;
  }>;

  /* ─── Render ─── */

  if (showLanding && !detached) {
    return (
      <div
        ref={cardRef}
        className="relative flex h-full flex-1 min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel"
      >
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/35">Takeoff</p>
              <h2 className="mt-1 text-lg font-semibold text-fg">Choose intake source</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenRevisionDiff && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onOpenRevisionDiff}
                  title="Compare drawing revisions and re-takeoff"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare Drawings
                </Button>
              )}
              {selectedSourceLabel && (
                <Button variant="secondary" size="sm" onClick={() => openTakeoffSurface()}>
                  <Ruler className="h-3.5 w-3.5" />
                  Open Current Source
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <input
            ref={sourceUploadInputRef}
            type="file"
            multiple
            accept=".pdf,.dwg,.dxf,.ifc,.rvt,.step,.stp,.iges,.igs,.brep,.stl,.obj,.fbx,.gltf,.glb,.3ds,.dae"
            className="hidden"
            onChange={(event) => void handleTakeoffSourceUpload(event.target.files)}
          />
          <input
            ref={spreadsheetUploadInputRef}
            type="file"
            multiple
            accept=".csv,.tsv,.xls,.xlsx,.xlsm"
            className="hidden"
            onChange={(event) => void handleSpreadsheetSourceUpload(event.target.files)}
          />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {intakeOptions.map((option) => {
              const Icon = option.icon;
              const active = activeIntakeOption === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => setActiveIntakeOption(option.id)}
                  className={cn(
                    "group relative flex min-h-20 items-center gap-3 overflow-hidden rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-accent/45 bg-accent/8"
                      : "border-line bg-bg/45 hover:border-accent/40 hover:bg-accent/5",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="takeoff-intake-card"
                      className="absolute inset-x-0 top-0 h-0.5 bg-accent"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-panel2 transition-colors",
                    active ? "border-accent/35 text-accent" : "border-line text-fg/60 group-hover:border-accent/30 group-hover:text-accent"
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-fg">{option.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-fg/45">{option.detail}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeIntakeOption}
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="mt-4 overflow-hidden rounded-lg border border-line bg-bg/35 shadow-sm"
            >
              {activeIntakeOption === "spreadsheet" && (
                <div className="grid gap-4 p-4 xl:grid-cols-[310px_minmax(0,1fr)]">
                  <div className="min-w-0 rounded-md border border-line bg-panel/65 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-fg/75">Spreadsheet/CSV sources</p>
                        <p className="mt-1 text-xs text-fg/40">Persisted in Documents.</p>
                      </div>
                      <Button variant="accent" size="sm" onClick={() => spreadsheetUploadInputRef.current?.click()} disabled={uploadingSpreadsheetSource}>
                        {uploadingSpreadsheetSource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                        Upload
                      </Button>
                    </div>

                    <div className="mt-3 max-h-80 space-y-1.5 overflow-y-auto pr-1">
                      {spreadsheetSources.length > 0 ? spreadsheetSources.map((node) => {
                        const active = selectedSpreadsheetNodeId === node.id;
                        return (
                          <button
                            key={node.id}
                            type="button"
                            onClick={() => void previewSpreadsheetNode(node)}
                            className={cn(
                              "flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
                              active
                                ? "border-accent/40 bg-accent/8 text-accent"
                                : "border-transparent bg-bg/45 text-fg/65 hover:border-accent/30 hover:bg-accent/5 hover:text-accent"
                            )}
                          >
                            <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{node.name}</span>
                              <span className="mt-0.5 block truncate text-[10px] text-fg/35">{node.fileType || getFileExtension(node.name).toUpperCase() || "file"}</span>
                            </span>
                            {spreadsheetPreviewLoading && active ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                            ) : (
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg/30" />
                            )}
                          </button>
                        );
                      }) : (
                        <button
                          type="button"
                          onClick={() => spreadsheetUploadInputRef.current?.click()}
                          className="flex w-full flex-col items-center justify-center rounded-md border border-dashed border-line bg-bg/35 px-3 py-8 text-center text-xs text-fg/40 transition-colors hover:border-accent/30 hover:text-accent"
                        >
                          <UploadCloud className="mb-2 h-5 w-5" />
                          Add a CSV, XLS, or XLSX file
                        </button>
                      )}
                    </div>

                    <Button variant="ghost" size="sm" className="mt-3 w-full justify-center" onClick={onOpenDocuments}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      Open Documents
                    </Button>
                  </div>

                  <div className="relative min-w-0 overflow-hidden rounded-md border border-line bg-panel/70">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-fg">{spreadsheetPreview?.sourceName ?? "Select a spreadsheet or CSV"}</p>
                        <p className="mt-1 text-xs text-fg/40">
                          {spreadsheetPreview
                            ? `${spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length} rows · ${spreadsheetPreview.headers.length} columns`
                            : "Preview, pivot, summarize, then import into the active worksheet."}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {spreadsheetPreview && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenAgentChat?.(
                              `Summarize spreadsheet source ${spreadsheetPreview.sourceName}. Identify estimate-ready line items, quantity columns, cost/price columns, likely category/vendor fields, and any data quality risks before import.`
                            )}
                          >
                            <BrainCircuit className="h-3.5 w-3.5" />
                            Summarize
                          </Button>
                        )}
                        <Button variant="accent" size="sm" onClick={() => void handleImportSpreadsheetPreview()} disabled={!spreadsheetPreview || spreadsheetImporting}>
                          {spreadsheetImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                          Import
                        </Button>
                      </div>
                    </div>

                    {spreadsheetPreview ? (
                      <div className="p-4">
                        <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-bg/40 p-1">
                          {(["preview", "pivot", "map"] as const).map((view) => (
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
                          <div className="ml-auto px-2 text-[10px] text-fg/35">
                            Target: {selectedWorksheet?.name ?? "first worksheet"}
                          </div>
                        </div>

                        {spreadsheetPanelView === "preview" && (
                          <div className="mt-4 space-y-4">
                            <div className="grid gap-2 md:grid-cols-3">
                              <div className="rounded-md border border-line bg-bg/35 px-3 py-2">
                                <p className="text-[10px] uppercase tracking-wide text-fg/35">Rows</p>
                                <p className="mt-1 text-lg font-semibold text-fg">{spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length}</p>
                              </div>
                              <div className="rounded-md border border-line bg-bg/35 px-3 py-2">
                                <p className="text-[10px] uppercase tracking-wide text-fg/35">Numeric Fields</p>
                                <p className="mt-1 text-lg font-semibold text-fg">{spreadsheetProfiles.filter((profile) => profile.numericCount > 0).length}</p>
                              </div>
                              <div className="rounded-md border border-line bg-bg/35 px-3 py-2">
                                <p className="text-[10px] uppercase tracking-wide text-fg/35">Mapped Fields</p>
                                <p className="mt-1 text-lg font-semibold text-fg">{mappedTargetCount}</p>
                              </div>
                            </div>

                            <div className="max-h-56 overflow-auto rounded-md border border-line">
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
                          <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
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

                            <div className="max-h-72 overflow-y-auto rounded-md border border-line bg-bg/35 p-2">
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

                        {spreadsheetPanelView === "map" && (
                          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                            <div className="max-h-72 overflow-y-auto rounded-md border border-line bg-bg/35 p-2">
                              {spreadsheetPreview.headers.map((header) => (
                                <div key={header} className="grid gap-2 border-b border-line/60 px-2 py-2 last:border-b-0 md:grid-cols-[minmax(0,1fr)_210px]">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-medium text-fg/75">{header}</p>
                                    <p className="mt-0.5 truncate text-[10px] text-fg/35">
                                      {spreadsheetProfiles.find((profile) => profile.header === header)?.sampleValues.join(", ") || "No sample values"}
                                    </p>
                                  </div>
                                  <Select
                                    value={spreadsheetMapping[header] ?? "skip"}
                                    onValueChange={(value) => setSpreadsheetMapping((current) => ({ ...current, [header]: value as SpreadsheetImportTarget }))}
                                    options={[...SPREADSHEET_IMPORT_TARGETS]}
                                    size="sm"
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="rounded-md border border-line bg-bg/35 p-3">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-fg/35">Import Target</p>
                              <p className="mt-2 text-sm font-semibold text-fg/80">{selectedWorksheet?.name ?? "First worksheet"}</p>
                              <p className="mt-1 text-xs text-fg/40">{mappedTargetCount} mapped column{mappedTargetCount === 1 ? "" : "s"}</p>
                              <Button variant="accent" size="sm" className="mt-4 w-full justify-center" onClick={() => void handleImportSpreadsheetPreview()} disabled={spreadsheetImporting}>
                                {spreadsheetImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                                Import Rows
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex min-h-80 items-center justify-center p-6">
                        <div className="max-w-sm text-center">
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-bg/45 text-fg/45">
                            <FileSpreadsheet className="h-6 w-6" />
                          </div>
                          <p className="mt-4 text-sm font-semibold text-fg/75">No spreadsheet selected</p>
                          <p className="mt-1 text-xs text-fg/40">Upload a CSV/XLSX or choose a persisted source to preview, pivot, map, and import.</p>
                          <Button variant="accent" size="sm" className="mt-4" onClick={() => spreadsheetUploadInputRef.current?.click()}>
                            <UploadCloud className="h-3.5 w-3.5" />
                            Upload CSV/XLSX
                          </Button>
                        </div>
                      </div>
                    )}

                    {spreadsheetPreviewLoading && (
                      <div className="absolute inset-0 flex items-center justify-center bg-panel/70 backdrop-blur-sm">
                        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg px-3 py-2 text-xs text-fg/60 shadow-sm">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                          Reading source
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeIntakeOption === "source" && (
                <div className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-fg/75">Drawing and model sources</p>
                      <p className="mt-1 text-xs text-fg/40">{sourceCountLabel || "Upload or add a source."}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" onClick={() => sourceUploadInputRef.current?.click()} disabled={uploadingTakeoffSource}>
                        {uploadingTakeoffSource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
                        Upload Source
                      </Button>
                      <Button variant="ghost" size="sm" onClick={onOpenDocuments}>
                        <FolderOpen className="h-3.5 w-3.5" />
                        Documents
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    {[
                      { label: "PDF", docs: pdfDocuments },
                      { label: "DWG/DXF", docs: dwgDocuments },
                      { label: "Model", docs: modelDocuments },
                    ].map((group) => (
                      <div key={group.label} className="rounded-md border border-line bg-panel/60 p-2">
                        <div className="flex items-center justify-between px-1 pb-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-fg/35">{group.label}</p>
                          <span className="text-[10px] text-fg/30">{group.docs.length}</span>
                        </div>
                        <div className={cn("space-y-1.5", group.docs.length > 0 && "max-h-72 overflow-y-auto pr-1")}>
                          {group.docs.length > 0 ? group.docs.map((doc) => (
                            <button
                              key={doc.id}
                              type="button"
                              onClick={() => openTakeoffSurface(doc.id)}
                              className="flex w-full min-w-0 items-center gap-2 rounded-md border border-transparent bg-bg/40 px-2 py-2 text-left text-xs text-fg/65 transition-colors hover:border-accent/30 hover:bg-accent/5 hover:text-accent"
                            >
                              <Badge tone="default" className="text-[9px]">{takeoffKindLabel(doc.kind)}</Badge>
                              <span className="min-w-0 flex-1 truncate">{doc.label}</span>
                              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg/30" />
                            </button>
                          )) : (
                            <button
                              type="button"
                              onClick={() => sourceUploadInputRef.current?.click()}
                              className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-line bg-bg/30 px-3 py-6 text-xs text-fg/35 transition-colors hover:border-accent/30 hover:text-accent"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add {group.label}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeIntakeOption === "extract" && (
                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-fg/75">Document extraction</p>
                        <p className="mt-1 text-xs text-fg/40">Use tables, schedules, quotes, and written scope.</p>
                      </div>
                      <Button variant="accent" size="sm" onClick={() => openDocumentExtractor()}>
                        <BrainCircuit className="h-3.5 w-3.5" />
                        Extract
                      </Button>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {extractableDocuments.length > 0 ? extractableDocuments.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => openDocumentExtractor(doc.fileName)}
                          className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-panel/70 px-3 py-2 text-left text-xs transition-colors hover:border-accent/35 hover:text-accent"
                        >
                          <Files className="h-3.5 w-3.5 shrink-0 text-fg/45" />
                          <span className="min-w-0 flex-1 truncate">{doc.fileName}</span>
                          <Badge tone="info" className="text-[9px]">{doc.documentType || "file"}</Badge>
                        </button>
                      )) : (
                        <div className="rounded-md border border-dashed border-line bg-panel/50 px-3 py-5 text-center text-xs text-fg/40 md:col-span-2">
                          No extractable project documents yet.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-panel/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-fg/35">Add sources</p>
                    <Button variant="secondary" size="sm" className="mt-3 w-full justify-center" onClick={onOpenDocuments}>
                      <FolderOpen className="h-3.5 w-3.5" />
                      Open Documents
                    </Button>
                  </div>
                </div>
              )}

              {activeIntakeOption === "tools" && (
                <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div>
                    <p className="text-xs font-semibold text-fg/75">Trade tools</p>
                    <p className="mt-1 text-xs text-fg/40">Open the configured tool catalog for this workspace.</p>
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      <Button variant="accent" size="sm" className="justify-center" onClick={onOpenPluginTools}>
                        <Puzzle className="h-3.5 w-3.5" />
                        Open Tool Library
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="justify-center"
                        onClick={() => onOpenAgentChat?.("Choose an appropriate configured estimating tool for this scope, explain why, and stage any line items for review before applying them.")}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Ask AI
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-md border border-line bg-panel/70 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-fg/35">Applies to</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {["Labor", "Material", "Equipment", "Subcontract", "Travel"].map((label) => (
                        <Badge key={label} tone="default" className="text-[10px]">{label}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
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
      <div className="flex min-w-0 items-center gap-2 overflow-hidden border-b border-line bg-panel px-2 py-1.5 shrink-0">
        {!detached && (
          <>
            <Button variant="ghost" size="xs" onClick={() => setShowLanding(true)} title="Back to takeoff intake">
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Intake</span>
            </Button>
            <Separator className="!h-6 !w-px" />
          </>
        )}
        {onOpenRevisionDiff && !detached && (
          <>
            <Button
              variant="secondary"
              size="xs"
              onClick={onOpenRevisionDiff}
              title="Compare drawing revisions and re-takeoff"
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span className="hidden 2xl:inline">Compare</span>
            </Button>
            <Separator className="!h-6 !w-px" />
          </>
        )}
        {/* Document selector */}
        <div className="flex min-w-0 items-center gap-2">
          <label className="hidden text-xs font-medium text-fg/50 xl:inline">Source:</label>
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
            <RadixSelect.Trigger className="inline-flex h-8 w-44 min-w-0 items-center gap-1.5 truncate rounded-lg border border-line bg-bg/50 px-2.5 text-xs text-fg outline-none transition-colors hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 2xl:w-56">
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
                  {fileManagerModelDocuments.length > 0 && (
                    <RadixSelect.Group>
                      <RadixSelect.Label className="px-2 py-1 text-[10px] font-medium text-fg/40 uppercase tracking-wider">
                        Project Files
                      </RadixSelect.Label>
                      {fileManagerModelDocuments.map((d) => (
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
            <Separator className="!h-6 !w-px" />

            {/* Page navigation */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={handlePrevPage} disabled={page <= 1}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <div className="flex items-center gap-1">
                <Input
                  className="h-7 w-12 px-1 text-center text-xs"
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
              <Button variant="ghost" size="xs" onClick={handleNextPage} disabled={page >= totalPages}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Separator className="!h-6 !w-px" />

            {/* Zoom controls */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={handleZoomOut}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-12 text-center text-xs text-fg/60">{zoomPercent}%</span>
              <Button variant="ghost" size="xs" onClick={handleZoomIn}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="xs" onClick={handleFitToWidth} title="Fit to width">
                <StretchHorizontal className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleFitToPage}
                title="Fit to page"
              >
                <Scan className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Separator className="!h-6 !w-px" />

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
          </>
        )}

        <div className="flex-1" />

        {!isCadDocument && !isDwgDocument && (
          <>
            {/* Active tool indicator */}
            <Badge tone="info" className="h-7 gap-1 px-2 text-[11px]" title={`${activeToolDef?.label ?? "Select"} tool`}>
              {activeToolDef && <activeToolDef.icon className="h-3 w-3" />}
              <span className="hidden 2xl:inline">{activeToolDef?.label ?? "Select"}</span>
            </Badge>

            <Button
              variant={snapEnabled ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setSnapEnabled((value) => !value)}
              title="Toggle PDF edge and vertex snap"
            >
              <Crosshair className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void undoTakeoffAction()}
              disabled={!canUndoTakeoff}
              title="Undo takeoff edit"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void redoTakeoffAction()}
              disabled={!canRedoTakeoff}
              title="Redo takeoff edit"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>

            {/* Clear all */}
            {annotations.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClearAll} title="Clear all takeoff marks">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* Export with dropdown */}
            <div className="relative" ref={exportDropdownRef}>
              <div className="flex items-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => exportAnnotationsCsv(annotations, calibration)}
                  disabled={annotations.length === 0}
                  className="rounded-r-none"
                  title={
                    annotations.length === 0
                      ? "No takeoff marks to export"
                      : `Export ${annotations.length} takeoff mark${annotations.length === 1 ? "" : "s"} as CSV`
                  }
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setExportDropdownOpen((v) => !v)}
                  disabled={annotations.length === 0}
                  className="rounded-l-none border-l border-line/50 px-1.5"
                  title={annotations.length === 0 ? "No takeoff marks to export" : "Export options"}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
              {exportDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-line bg-panel shadow-xl p-1 min-w-[120px]">
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-fg/70 hover:bg-panel2 transition-colors"
                    onClick={() => {
                      exportAnnotationsCsv(annotations, calibration);
                      setExportDropdownOpen(false);
                    }}
                  >
                    <Download className="h-3 w-3" />
                    Export CSV
                  </button>
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-fg/70 hover:bg-panel2 transition-colors"
                    onClick={() => {
                      exportAnnotationsJson(annotations, calibration);
                      setExportDropdownOpen(false);
                    }}
                  >
                    <FileJson className="h-3 w-3" />
                    Export JSON
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ─── Fullscreen / Detach ─── */}
        <Separator className="!h-6 !w-px" />
        <Button
          variant="ghost"
          size="xs"
          onClick={handleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
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
          disabled={!selectedDocId}
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
        {isDwgDocument ? (
          <DwgTakeoffSurface
            projectId={projectId}
            documents={dwgDocuments.map((doc) => ({
              id: doc.id,
              label: doc.label,
              fileName: doc.fileName,
              fileUrl: buildPdfUrl(doc),
            }))}
            selectedDocumentId={selectedDoc?.kind === "dwg" ? selectedDoc.id : undefined}
            workspace={workspace}
            selectedWorksheetId={selectedWorksheet?.id}
            defaultEstimateCategory={defaultCategory ? { id: defaultCategory.id, name: defaultCategory.name, entityType: defaultCategory.entityType } : null}
            onSelectedDocumentChange={(docId) => {
              setSelectedDocId(docId);
              setPage(1);
              setZoom(1);
              fitOnLoadRef.current = true;
              setAnnotations([]);
              setSelectedAnnotationId(null);
              setAutoCountResults(null);
              setAutoCountSnippet(null);
            }}
            onWorkspaceMutated={notifyWorkspaceMutated}
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
                  Upload drawings via the Documents tab, then select one here to start measuring.
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
                <CadViewer fileUrl={documentUrl} fileName={selectedDoc?.fileName} />
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

                  {/* Processing overlay */}
                  {(autoCountRunning || askAiRunning) && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg backdrop-blur-sm z-10">
                      <div className="flex items-center gap-3 rounded-xl bg-panel px-5 py-3 shadow-xl border border-line">
                        <Loader2 className="h-5 w-5 animate-spin text-accent" />
                        <div>
                          <p className="text-sm font-medium text-fg">
                            {autoCountRunning ? "Running symbol detection..." : "Cropping region for AI analysis..."}
                          </p>
                          <p className="text-xs text-fg/40">
                            {autoCountRunning ? "OpenCV template matching + feature detection" : "Preparing image crop"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
            </div>
          )}
        </div>

        {/* Right: Annotation sidebar (embedded — border provided by wrapper) */}
        {!isCadDocument ? (
          <div className="flex w-72 shrink-0 flex-col border-l border-line overflow-hidden">
            <AnnotationSidebar
              embedded
              annotations={annotations}
              onToggleVisibility={handleToggleVisibility}
              onDelete={handleDeleteAnnotation}
              onEdit={handleEditAnnotation}
              onSaveEdit={handleSaveAnnotationEdit}
              onSelectAnnotation={setSelectedAnnotationId}
              selectedAnnotationId={selectedAnnotationId}
              editingAnnotationId={editingAnnotationId}
              takeoffLinks={takeoffLinks}
              onLinkToLineItem={handleLinkToLineItem}
              onSendToEstimate={handleSendToEstimate}
              onSuggestLineItems={handleSuggestLineItems}
              onApplySuggestion={handleApplySuggestion}
            />
          </div>
        ) : (
          <div className="flex w-96 shrink-0 flex-col border-l border-line bg-panel overflow-hidden">
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs font-semibold text-fg">{selectedDoc?.fileName}</p>
                <Badge tone={selectedModelIsEditable ? "success" : "warning"} className="text-[10px]">
                  {selectedModelIsEditable ? "Editable" : "Preview"}
                </Badge>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
                {[
                  ["Objects", selectedModelAsset?._count?.elements ?? 0],
                  ["Qty", selectedModelAsset?._count?.quantities ?? 0],
                  ["Links", linkedModelLineItems.length],
                  ["Issues", selectedModelAsset?._count?.issues ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-line bg-bg/50 px-2 py-1.5">
                    <p className="text-[10px] text-fg/40">{label}</p>
                    <p className="text-xs font-semibold text-fg/80">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs text-fg/60">
              <div className="rounded-md border border-line bg-bg/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg/45">Index</span>
                  <Badge
                    tone={selectedModelAsset?.status === "indexed" ? "success" : selectedModelAsset ? "warning" : "info"}
                    className="text-[10px]"
                  >
                    {modelSyncing ? "Syncing" : selectedModelAsset?.status ?? "Pending"}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-fg/45">Parser</span>
                  <span className="truncate text-fg/70">{String(selectedModelAsset?.manifest?.parser ?? selectedModelAsset?.format ?? "Not indexed")}</span>
                </div>
              </div>

              {modelSelection && modelSelection.selectedCount > 0 && (
                <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-fg/45">Selected in view</span>
                    <span className="font-medium text-fg/80">{modelSelection.selectedCount}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded border border-accent/20 bg-bg/30 p-2">
                      <p className="text-[10px] text-fg/40">Area</p>
                      <p className="mt-0.5 truncate font-semibold text-fg/80">{formatModelSelectionQuantity(modelSelection.totals.surfaceArea, "model^2")}</p>
                    </div>
                    <div className="rounded border border-accent/20 bg-bg/30 p-2">
                      <p className="text-[10px] text-fg/40">Volume</p>
                      <p className="mt-0.5 truncate font-semibold text-fg/80">{formatModelSelectionQuantity(modelSelection.totals.volume, "model^3")}</p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3 w-full justify-center"
                    onClick={() => void handleSendModelSelectionToEstimate(modelSelection)}
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    Create Object Rows
                  </Button>
                </div>
              )}

              <div className="rounded-md border border-line bg-bg/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-fg/40">Model Objects</p>
                  {modelElementsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                </div>
                <Input
                  className="mt-2 h-8 text-xs"
                  value={modelElementSearch}
                  onChange={(event) => setModelElementSearch(event.target.value)}
                  placeholder="Search objects, classes, materials..."
                />
                <div className="mt-2 flex items-center gap-1 rounded-md border border-line bg-panel p-0.5">
                  {(["count", "area", "volume"] as ModelQuantityBasis[]).map((basis) => (
                    <button
                      key={basis}
                      type="button"
                      onClick={() => setModelLedgerBasis(basis)}
                      className={cn(
                        "flex-1 rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                        modelLedgerBasis === basis ? "bg-accent/15 text-accent" : "text-fg/45 hover:text-fg/70",
                      )}
                    >
                      {basis}
                    </button>
                  ))}
                </div>
                {selectedModelElementIds.size > 0 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2 w-full justify-center"
                    onClick={() => void handleCreateSelectedModelElements()}
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                    Create {selectedModelElementIds.size} Selected
                  </Button>
                )}
                <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto pr-1">
                  {modelElements.length === 0 && (
                    <p className="rounded-md border border-line bg-panel/60 px-3 py-4 text-center text-[11px] text-fg/40">
                      {selectedModelAsset ? "No model objects match this search." : "Sync the model index to list model objects."}
                    </p>
                  )}
                  {modelElements.map((element) => {
                    const linked = linkedModelElementIds.has(element.id);
                    const selected = selectedModelElementIds.has(element.id);
                    return (
                      <div
                        key={element.id}
                        className={cn(
                          "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-2",
                          linked ? "border-success/25 bg-success/5" : selected ? "border-accent/35 bg-accent/5" : "border-line bg-panel/60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={linked}
                          onChange={(event) => {
                            const next = new Set(selectedModelElementIds);
                            if (event.target.checked) next.add(element.id);
                            else next.delete(element.id);
                            setSelectedModelElementIds(next);
                          }}
                          className="h-3.5 w-3.5 rounded border-line accent-sky-500 disabled:opacity-30"
                          aria-label={`Select ${element.name || element.externalId}`}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-fg/80">{element.name || element.externalId}</p>
                          <p className="mt-0.5 truncate text-[10px] text-fg/40">
                            {[element.elementClass, element.material, element.level].filter(Boolean).join(" · ") || "Model element"}
                          </p>
                          <p className="mt-1 text-[10px] font-medium text-fg/60">{formatElementQuantity(element, modelLedgerBasis)}</p>
                        </div>
                        {linked ? (
                          <Badge tone="success" className="text-[10px]">Linked</Badge>
                        ) : (
                          <Button
                            variant="ghost"
                            size="xs"
                            title="Create line item"
                            onClick={() => void handleCreateModelElementLineItem(element)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {linkedModelLineItems.length > 0 && (
                <div className="rounded-md border border-line bg-bg/50 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-fg/40">Linked Line Items</p>
                  <div className="mt-2 space-y-1.5">
                    {linkedModelLineItems.slice(0, 8).map((item) => (
                      <div key={item.linkId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-line bg-panel/60 px-2 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-fg/80">{item.entityName}</p>
                          <p className="text-[10px] text-fg/45">{formatModelSelectionQuantity(item.quantity, item.uom)}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="xs"
                          title="Delete linked line item"
                          onClick={() => void handleDeleteModelLinkedLineItem({ linkId: item.linkId, worksheetItemId: item.worksheetItemId })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {modelError && (
                <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-[11px] text-danger">
                  {modelError}
                </div>
              )}

              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center"
                disabled={modelSyncing}
                onClick={() => void refreshModelAssets(true)}
              >
                {modelSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Sync Model Index
              </Button>

              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-center"
                onClick={() => onOpenAgentChat?.(
                  `Inspect the 3D model ${selectedDoc?.fileName ?? "the selected model"} using BidWright's model tools. Query model elements, quantities, linked worksheet items, and any unlinked scope, then prepare 5D takeoff recommendations for this estimate.`
                )}
              >
                <BrainCircuit className="h-3.5 w-3.5" />
                Ask AI
              </Button>
            </div>
          </div>
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
      />

      {/* ─── Link to Line Item Modal ─── */}
      <LinkToLineItemModal
        open={linkModalAnnotationId !== null}
        onClose={() => setLinkModalAnnotationId(null)}
        onConfirm={handleLinkConfirm}
        measurement={
          linkModalAnnotationId
            ? annotations.find((a) => a.id === linkModalAnnotationId)?.measurement
            : undefined
        }
        worksheets={workspace.worksheets}
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

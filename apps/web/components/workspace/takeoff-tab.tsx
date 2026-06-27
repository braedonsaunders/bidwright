"use client";

import { useState, useRef, useCallback, useEffect, useMemo, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
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
  Table2,
  Sigma,
  SlidersHorizontal,
  Edit3,
  Eye,
  Library,
} from "lucide-react";
import type {
  CreateWorksheetItemInput,
  FileNode,
  ImportPreviewResponse,
  ProjectWorkspaceData,
  VisionMatch,
  VisionBoundingBox,
  PickupLinkRecord,
  ModelAsset,
  ModelElement,
  ModelQuantity,
  ModelPickupLinkRecord,
  DrawingAnalysisPreset,
  DrawingGeometryAnalysisResult,
  DrawingPrimitive,
  DrawingLineSegment,
  DrawingSymbolCandidate,
  DrawingTracedSystem,
  DwgEntityLinkRecord,
} from "@/lib/api";
import {
  listPickups,
  createPickup,
  updatePickup,
  deletePickup,
  getDocumentDownloadUrl,
  getFileDownloadUrl,
  getBookFileUrl,
  listKnowledgeBooks,
  runVisionCountSymbols,
  runVisionCropRegion,
  runVisionCountAllPages,
  saveVisionCrop,
  askAi,
  listPickupLinks,
  createPickupLink,
  listDwgEntityLinks,
  createDwgEntityLink,
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
  detectTitleBlockScale,
  extractLegendFromPage,
  createSymbolTemplateFromLegendEntry,
  listSymbolTemplates,
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
import * as Popover from "@radix-ui/react-popover";
import dynamic from "next/dynamic";
import { isPrimitiveClosed, samplePdfPrimitive } from "@bidwright/domain";
import { cn } from "@/lib/utils";
import { modelEditorChannelName, postWorkspaceMutation } from "@/lib/workspace-sync";
import type { Calibration, Point } from "@/lib/takeoff-math";
import { parseConstructionDimensionToUnit } from "@/lib/construction-dimension";
import {
  TAKEOFF_SHORTCUT_PRESET_OPTIONS,
  resolveTakeoffShortcut,
  takeoffShortcutLabel,
  type TakeoffShortcutPreset,
} from "@/lib/takeoff-shortcuts";
import { buildModelEditorUrl, isBidwrightEditableModel } from "./editors/bidwright-model-editor";
import type {
  BidwrightModelLineItemDraft,
  BidwrightModelLinkedLineItem,
  BidwrightModelSelectionMessage,
} from "./editors/bidwright-model-editor";
import type {
  CadViewerActions,
  CadViewerDisplayMode,
  CadViewerStandardView,
} from "./editors/cad-viewer";
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
import {
  AnnotationCanvas,
  type Pickup,
} from "./takeoff/annotation-canvas";
import { AnnotationSidebar } from "./takeoff/annotation-sidebar";
import { SymbolLibraryPanel } from "./takeoff/symbol-library-panel";
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
  /** Vector arc / circle / ellipse primitives rendered on the overlay.
   *  Separate toggle from `circles` (which is the raster Hough output) so
   *  the estimator can compare the two sources visually. */
  arcs: boolean;
  /** Cubic + quad bezier primitives rendered on the overlay. */
  curves: boolean;
};

function lineSegmentBounds(lines: DrawingLineSegment[]): DrawingLineSegment["bbox"] {
  if (lines.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const xs = lines.flatMap((line) => [line.x1, line.x2]);
  const ys = lines.flatMap((line) => [line.y1, line.y2]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function updateDrawingAnalysisSummary(result: DrawingGeometryAnalysisResult): DrawingGeometryAnalysisResult {
  return {
    ...result,
    summary: {
      ...result.summary,
      lineCount: result.lines.length,
      circleCount: result.circles.length,
      symbolCandidateCount: result.symbolCandidates.length,
      textRegionCount: result.textRegions.length,
      systemCount: result.systems.length,
      totalSystemLengthPx: result.systems.reduce((sum, system) => sum + system.lengthPx, 0),
    },
  };
}

function removeDrawingAnalysisEntity(
  result: DrawingGeometryAnalysisResult | null,
  id: string,
  kind: InspectDrawingDetectionKind,
): DrawingGeometryAnalysisResult | null {
  if (!result) return result;
  if (kind === "system") {
    const systems = result.systems.filter((system) => system.id !== id);
    return systems.length === result.systems.length ? result : updateDrawingAnalysisSummary({ ...result, systems });
  }
  if (kind === "line") {
    const lines = result.lines.filter((line) => line.id !== id);
    if (lines.length === result.lines.length) return result;
    const lineById = new Map(lines.map((line) => [line.id, line]));
    const systems = result.systems
      .map((system) => {
        if (!system.segmentIds.includes(id)) return system;
        const segmentIds = system.segmentIds.filter((segmentId) => segmentId !== id);
        const segments = segmentIds
          .map((segmentId) => lineById.get(segmentId))
          .filter((line): line is DrawingLineSegment => Boolean(line));
        return {
          ...system,
          segmentIds,
          segmentCount: segments.length,
          lengthPx: segments.reduce((sum, segment) => sum + segment.lengthPx, 0),
          bbox: lineSegmentBounds(segments),
        };
      })
      .filter((system) => system.segmentIds.length > 0);
    return updateDrawingAnalysisSummary({ ...result, lines, systems });
  }
  if (kind === "symbol") {
    const symbolCandidates = result.symbolCandidates.filter((candidate) => candidate.id !== id);
    return symbolCandidates.length === result.symbolCandidates.length
      ? result
      : updateDrawingAnalysisSummary({ ...result, symbolCandidates });
  }
  if (kind === "circle") {
    const circles = result.circles.filter((circle) => circle.id !== id);
    return circles.length === result.circles.length ? result : updateDrawingAnalysisSummary({ ...result, circles });
  }
  if (kind === "arc" || kind === "curve") {
    // Phase-2 vector primitives. The primitives array carries arc /
    // circle / ellipse (kind="arc" in the panel) and cubic/quad bezier
    // (kind="curve" in the panel). Match by id; the row's kind only
    // tells us which bucket the user clicked.
    const primitives = result.primitives ?? [];
    const filtered = primitives.filter((primitive) => primitive.id !== id);
    if (filtered.length === primitives.length) return result;
    const byKindNext: Record<string, number> = {};
    for (const primitive of filtered) {
      byKindNext[primitive.kind] = (byKindNext[primitive.kind] ?? 0) + 1;
    }
    return updateDrawingAnalysisSummary({
      ...result,
      primitives: filtered,
      primitivesByKind: byKindNext,
    });
  }
  const textRegions = result.textRegions.filter((region) => region.id !== id);
  return textRegions.length === result.textRegions.length ? result : updateDrawingAnalysisSummary({ ...result, textRegions });
}

type TakeoffHistoryCommand =
  | { kind: "create"; annotation: Pickup }
  | { kind: "delete"; annotation: Pickup }
  | { kind: "clear"; annotations: Pickup[] }
  | { kind: "update"; before: Pickup; after: Pickup }
  | {
      kind: "calibration";
      docId: string;
      page: number;
      applyToAllPages: boolean;
      before: Calibration | null;
      after: Calibration | null;
      beforeDocCache: Record<string, Calibration> | null;
      afterDocCache: Record<string, Calibration> | null;
    };

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

function isTakeoffShortcutPreset(value: string | null): value is TakeoffShortcutPreset {
  return value === "bidwright" || value === "planswift";
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const editable = target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']");
  return Boolean(editable);
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
  group: "nav" | "setup" | "measure" | "count" | "markup" | "ai";
  section?: string;
}

const TOOLS: ToolDef[] = [
  /* Navigate */
  { id: "select",             label: "Select",            icon: MousePointer2,    group: "nav" },
  /* Setup */
  { id: "calibrate",          label: "Set Scale",         icon: Scaling,          group: "measure", section: "Scale" },
  /* Measure */
  { id: "linear",             label: "Linear",            icon: Ruler,            group: "measure", section: "Length" },
  { id: "linear-polyline",    label: "Polyline",          icon: Spline,           group: "measure", section: "Length" },
  { id: "linear-drop",        label: "Linear Drop",       icon: ArrowDownToLine,  group: "measure", section: "Length" },
  /* Area */
  { id: "area-rectangle",     label: "Rectangle",         icon: Square,           group: "measure", section: "Area" },
  { id: "area-polygon",       label: "Polygon",           icon: Pentagon,         group: "measure", section: "Area" },
  { id: "area-triangle",      label: "Triangle",          icon: Triangle,         group: "measure", section: "Area" },
  { id: "area-ellipse",       label: "Ellipse",           icon: CircleDashed,     group: "measure", section: "Area" },
  { id: "area-vertical-wall", label: "Vertical Wall",     icon: RectangleVertical, group: "measure", section: "Area" },
  /* Count */
  { id: "count",              label: "Count",             icon: Target,           group: "count", section: "Manual" },
  { id: "count-by-distance",  label: "Count by Distance", icon: Tally5,           group: "count", section: "Manual" },
  { id: "smart-count",        label: "Smart Count",       icon: Wand2,            group: "count", section: "Assisted" },
  /* Markup */
  { id: "markup-note",        label: "Note",              icon: MessageSquarePlus, group: "markup" },
  { id: "markup-cloud",       label: "Cloud",             icon: Cloud,            group: "markup" },
  { id: "markup-arrow",       label: "Arrow",             icon: MoveRight,        group: "markup" },
  { id: "markup-highlight",   label: "Highlight",         icon: Highlighter,      group: "markup" },
  /* AI */
  { id: "auto-count",         label: "Auto Count",        icon: ScanSearch,       group: "ai" },
  { id: "ask-ai",             label: "Ask AI",            icon: BrainCircuit,     group: "ai" },
];

const PDF_TOOL_MENU_GROUPS: ReadonlyArray<{
  key: ToolDef["group"];
  label: string;
  icon: typeof Ruler;
}> = [
  { key: "measure", label: "Measure", icon: Ruler },
  { key: "count",   label: "Count",   icon: Target },
  { key: "markup",  label: "Markup",  icon: MessageSquarePlus },
  { key: "ai",      label: "AI",      icon: Sparkles },
];

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

function PdfToolGroupMenus({
  activeTool,
  onSelect,
  onReadLegend,
  onOpenDrawingIntelligence,
  legendOpen,
  legendLoading,
  legendEntries,
  legendWarnings,
  legendCount,
  onCloseLegend,
  drawingAnalysisRunning,
  drawingAnalysisCount,
  canRunDocumentAi,
  canRunDrawingIntelligence,
  onSaveLegendEntryToLibrary,
  savingLegendKey,
  savedLegendKeys,
  libraryOpen,
  libraryCount,
  onOpenLibrary,
  onCloseLibrary,
  libraryProjectId,
  libraryDocumentId,
  libraryPageNumber,
  libraryCanRun,
  onLibraryRefresh,
  shortcutPreset,
}: {
  activeTool: ToolId;
  onSelect: (tool: ToolId) => void;
  onReadLegend: () => void;
  onOpenDrawingIntelligence: () => void;
  legendOpen: boolean;
  legendLoading: boolean;
  legendEntries: LegendEntryRecord[] | null;
  legendWarnings: string[];
  legendCount: number;
  onCloseLegend: () => void;
  drawingAnalysisRunning: boolean;
  drawingAnalysisCount: number | null;
  canRunDocumentAi: boolean;
  canRunDrawingIntelligence: boolean;
  onSaveLegendEntryToLibrary: (entry: LegendEntryRecord, index: number) => void;
  savingLegendKey: string | null;
  savedLegendKeys: Set<string>;
  libraryOpen: boolean;
  libraryCount: number | null;
  onOpenLibrary: () => void;
  onCloseLibrary: () => void;
  libraryProjectId: string;
  libraryDocumentId: string | null;
  libraryPageNumber: number;
  libraryCanRun: boolean;
  onLibraryRefresh: () => void;
  shortcutPreset: TakeoffShortcutPreset;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-line bg-bg/35 p-0.5">
      {PDF_TOOL_MENU_GROUPS.map((group) => {
        const tools = TOOLS.filter((tool) => tool.group === group.key);
        const activeInGroup = tools.some((tool) => tool.id === activeTool) || (group.key === "ai" && (legendLoading || drawingAnalysisRunning));
        const GroupIcon = group.icon;
        return (
          <Popover.Root key={group.key}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
                  activeInGroup
                    ? "bg-accent/15 text-accent"
                    : "text-fg/55 hover:bg-panel2 hover:text-fg/80",
                )}
                title={`${group.label} tools`}
              >
                <GroupIcon className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">{group.label}</span>
                <ChevronDown className="h-3 w-3 opacity-55" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="start"
                side="bottom"
                avoidCollisions
                collisionPadding={12}
                sideOffset={6}
                className={cn(
                  "z-[1000] max-h-[min(78vh,34rem)] overflow-y-auto rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none",
                  group.key === "ai" ? "w-72" : "w-60",
                )}
              >
                <div className="grid gap-1">
                  {Array.from(new Set(tools.map((tool) => tool.section ?? group.label))).map((section) => {
                    const sectionTools = tools.filter((tool) => (tool.section ?? group.label) === section);
                    return (
                      <div key={section} className="grid gap-0.5">
                        {tools.length > 1 && (
                          <div className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wider text-fg/35">
                            {section}
                          </div>
                        )}
                        {sectionTools.map((tool) => {
                          const Icon = tool.icon;
                          const active = tool.id === activeTool;
                          const shortcut = takeoffShortcutLabel({ kind: "tool", toolId: tool.id }, shortcutPreset);
                          return (
                            <Popover.Close asChild key={tool.id}>
                              <button
                                type="button"
                                onClick={() => onSelect(tool.id)}
                                className={cn(
                                  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] transition-colors",
                                  active
                                    ? "bg-accent/15 text-accent"
                                    : "text-fg/70 hover:bg-panel2 hover:text-fg",
                                )}
                                title={`${TOOL_STATUS_TEXT[tool.id] ?? tool.label}${shortcut ? ` (${shortcut})` : ""}`}
                              >
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                <span className="min-w-0 flex-1 truncate font-medium">{tool.label}</span>
                                {shortcut && <span className="shrink-0 rounded border border-line/70 px-1 py-0.5 font-mono text-[9px] text-fg/35">{shortcut}</span>}
                                {active && <Check className="h-3 w-3 shrink-0" />}
                              </button>
                            </Popover.Close>
                          );
                        })}
                      </div>
                    );
                  })}
                  {group.key === "ai" && (
                    <>
                      <div className="my-1 h-px bg-line/70" />
                      <button
                        type="button"
                        onClick={onReadLegend}
                        disabled={!canRunDocumentAi || legendLoading}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
                        title="Read legend or symbol schedule"
                      >
                        {legendLoading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <BookOpen className="h-3.5 w-3.5 shrink-0" />}
                        <span className="min-w-0 flex-1 truncate font-medium">Page Legend</span>
                        {legendCount > 0 && <span className="text-[10px] text-fg/45">{legendCount}</span>}
                      </button>
                      <Popover.Close asChild>
                        <button
                          type="button"
                          onClick={onOpenDrawingIntelligence}
                          disabled={!canRunDrawingIntelligence || drawingAnalysisRunning}
                          className={cn(
                            "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                            drawingAnalysisCount != null
                              ? "bg-sky-500/10 text-sky-500 hover:bg-sky-500/15"
                              : "text-fg/70 hover:bg-panel2 hover:text-fg",
                          )}
                          title="Analyze drawing geometry and review detected entities"
                        >
                          {drawingAnalysisRunning ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <GitBranch className="h-3.5 w-3.5 shrink-0" />}
                          <span className="min-w-0 flex-1 truncate font-medium">Drawing Intelligence</span>
                          {drawingAnalysisCount != null && <span className="text-[10px] text-fg/45">{drawingAnalysisCount}</span>}
                        </button>
                      </Popover.Close>
                      {legendOpen && (
                        <div className="mt-1.5 rounded-md border border-amber-500/20 bg-amber-500/5">
                          <div className="flex items-center gap-2 border-b border-amber-500/15 px-2.5 py-2">
                            <BookOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-fg">
                              Page legend
                              {legendCount > 0 && <span className="ml-1.5 font-normal text-fg/45">{legendCount}</span>}
                            </span>
                            <button
                              type="button"
                              onClick={onCloseLegend}
                              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg/35 transition-colors hover:bg-panel2 hover:text-fg"
                              aria-label="Close page legend"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="max-h-72 space-y-1 overflow-y-auto p-2">
                            {legendLoading && (
                              <div className="flex items-center gap-2 py-1 text-[11px] text-fg/60">
                                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-500" />
                                Reading legend table on this page...
                              </div>
                            )}
                            {!legendLoading && legendEntries && legendEntries.length === 0 && (
                              <div className="py-1 text-[11px] leading-relaxed text-fg/50">
                                {legendWarnings[0] ?? "No legend table or symbol list found on this page."}
                              </div>
                            )}
                            {legendEntries?.map((entry, i) => {
                              const key = `${entry.symbol}-${i}`;
                              const canSave = Boolean(entry.symbolBbox);
                              const saving = savingLegendKey === key;
                              const saved = savedLegendKeys.has(key);
                              return (
                                <div
                                  key={key}
                                  className="flex items-start gap-2 rounded border border-line/70 bg-panel/80 px-2 py-1.5"
                                >
                                  <div className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-amber-500/35 bg-amber-500/10 font-mono text-[10px] font-semibold text-amber-500">
                                    {entry.symbol}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="break-words text-[11px] leading-snug text-fg/80">{entry.label}</div>
                                    {entry.confidence < 0.7 && (
                                      <div className="mt-0.5 text-[10px] text-fg/35">low confidence</div>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => onSaveLegendEntryToLibrary(entry, i)}
                                    disabled={!canSave || saving || saved}
                                    title={
                                      !canSave
                                        ? "Glyph bbox missing — Azure couldn't isolate the symbol cell"
                                        : saved
                                        ? "Saved to project library"
                                        : "Save this glyph to the project Symbol Library"
                                    }
                                    className={cn(
                                      "inline-flex h-6 shrink-0 items-center gap-1 rounded border px-1.5 text-[10px] font-medium transition-colors",
                                      saved
                                        ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-500"
                                        : "border-line/70 text-fg/55 hover:bg-panel2 hover:text-fg",
                                      "disabled:cursor-not-allowed disabled:opacity-50",
                                    )}
                                  >
                                    {saving ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : saved ? (
                                      <Check className="h-3 w-3" />
                                    ) : (
                                      <Library className="h-3 w-3" />
                                    )}
                                    {saved ? "Saved" : "Save"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        );
      })}

      {/* Symbol Library — sibling popover at toolbar level. Separated from the
          AI menu so users don't have to reopen the menu to view their saved
          symbols and run the batch matcher. */}
      <Popover.Root
        open={libraryOpen}
        onOpenChange={(open) => (open ? onOpenLibrary() : onCloseLibrary())}
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors",
              libraryOpen
                ? "bg-accent/15 text-accent"
                : "text-fg/55 hover:bg-panel2 hover:text-fg/80",
            )}
            title="Project Symbol Library — saved few-shot templates"
          >
            <Library className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Library</span>
            {libraryCount != null && libraryCount > 0 && (
              <span className="text-[10px] text-fg/45">{libraryCount}</span>
            )}
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            side="bottom"
            avoidCollisions
            collisionPadding={12}
            sideOffset={6}
            className="z-[1000] outline-none"
          >
            <SymbolLibraryPanel
              projectId={libraryProjectId}
              documentId={libraryDocumentId}
              pageNumber={libraryPageNumber}
              canRun={libraryCanRun}
              onLibraryChanged={onLibraryRefresh}
              onClose={onCloseLibrary}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

function SpreadsheetTransformMenu({
  view,
  onViewChange,
  groupBy,
  onGroupByChange,
  measure,
  onMeasureChange,
  groupOptions,
  measureOptions,
  disabled,
}: {
  view: SpreadsheetPanelView;
  onViewChange: (view: SpreadsheetPanelView) => void;
  groupBy: string;
  onGroupByChange: (value: string) => void;
  measure: string;
  onMeasureChange: (value: string) => void;
  groupOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  measureOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled: boolean;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          variant={view === "pivot" ? "secondary" : "ghost"}
          size="xs"
          disabled={disabled}
          className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
          title="Transform spreadsheet view"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Transform</span>
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-[1000] w-72 rounded-lg border border-line bg-panel p-2 shadow-xl outline-none"
        >
          <div className="grid gap-1">
            {([
              { id: "preview" as const, label: "Table Preview", icon: Table2, detail: "Inspect parsed rows and columns" },
              { id: "pivot" as const, label: "Pivot Summary", icon: Sigma, detail: "Group rows and summarize a measure" },
            ]).map((option) => {
              const Icon = option.icon;
              return (
                <Popover.Close asChild key={option.id}>
                  <button
                    type="button"
                    onClick={() => onViewChange(option.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
                      view === option.id ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2 hover:text-fg",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      <span className="block truncate text-[10px] text-fg/40">{option.detail}</span>
                    </span>
                    {view === option.id && <Check className="h-3 w-3" />}
                  </button>
                </Popover.Close>
              );
            })}
          </div>
          <div className="my-2 h-px bg-line/70" />
          <div className="grid gap-2 px-1 pb-1">
            <div>
              <Label>Group by</Label>
              <Select
                value={groupBy}
                onValueChange={(value) => {
                  onGroupByChange(value);
                  onViewChange("pivot");
                }}
                options={groupOptions.length ? groupOptions : [{ value: "none", label: "No text fields", disabled: true }]}
                size="sm"
                contentClassName="z-[1100]"
              />
            </div>
            <div>
              <Label>Measure</Label>
              <Select
                value={measure}
                onValueChange={(value) => {
                  onMeasureChange(value);
                  onViewChange("pivot");
                }}
                options={measureOptions}
                size="sm"
                contentClassName="z-[1100]"
              />
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SpreadsheetDataMenu({
  disabled,
  rowCount,
  columnCount,
  onOpenEntities,
  onImportAll,
}: {
  disabled: boolean;
  rowCount: number;
  columnCount: number;
  onOpenEntities: () => void;
  onImportAll: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="xs" disabled={disabled} className="h-7 shrink-0 gap-1.5 px-2 text-[11px]" title="Spreadsheet row actions">
          <Table2 className="h-3.5 w-3.5" />
          <span>Rows</span>
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[1000] w-64 rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none">
          <div className="px-2 py-1.5">
            <p className="text-[11px] font-semibold text-fg">Parsed source</p>
            <p className="mt-0.5 text-[10px] text-fg/40">{rowCount.toLocaleString()} rows · {columnCount.toLocaleString()} columns</p>
          </div>
          <div className="my-1 h-px bg-line/70" />
          <Popover.Close asChild>
            <button type="button" onClick={onOpenEntities} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg">
              <Boxes className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">Review Rows In Entities</span>
            </button>
          </Popover.Close>
          <Popover.Close asChild>
            <button type="button" onClick={onImportAll} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg">
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">Import All Rows</span>
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SpreadsheetAiMenu({
  disabled,
  onSummarize,
}: {
  disabled: boolean;
  onSummarize: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="xs" disabled={disabled} className="h-7 shrink-0 gap-1.5 px-2 text-[11px]" title="Spreadsheet AI">
          <Sparkles className="h-3.5 w-3.5" />
          <span>AI</span>
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[1000] w-72 rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none">
          <Popover.Close asChild>
            <button type="button" onClick={onSummarize} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg">
              <BrainCircuit className="h-3.5 w-3.5 shrink-0 text-violet-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">Summarize For Estimate</span>
                <span className="block truncate text-[10px] text-fg/40">Find line items, quantity columns, cost fields, and risks</span>
              </span>
            </button>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelViewMenu({
  currentView,
  onView,
}: {
  currentView: CadViewerStandardView;
  onView: (view: CadViewerStandardView) => void;
}) {
  const views: Array<{ id: CadViewerStandardView; label: string }> = [
    { id: "iso", label: "Isometric" },
    { id: "top", label: "Top" },
    { id: "front", label: "Front" },
    { id: "right", label: "Right" },
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="xs" className="h-7 shrink-0 gap-1.5 px-2 text-[11px]" title="Model view">
          <Box className="h-3.5 w-3.5" />
          <span>View</span>
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[1000] w-48 rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none">
          {views.map((view) => (
            <Popover.Close asChild key={view.id}>
              <button
                type="button"
                onClick={() => onView(view.id)}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] transition-colors",
                  currentView === view.id ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2 hover:text-fg",
                )}
              >
                <Scan className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{view.label}</span>
                {currentView === view.id && <Check className="h-3 w-3" />}
              </button>
            </Popover.Close>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ModelDisplayMenu({
  mode,
  gridVisible,
  autoRotate,
  onMode,
  onGrid,
  onAutoRotate,
}: {
  mode: CadViewerDisplayMode;
  gridVisible: boolean;
  autoRotate: boolean;
  onMode: (mode: CadViewerDisplayMode) => void;
  onGrid: () => void;
  onAutoRotate: () => void;
}) {
  const modes: Array<{ id: CadViewerDisplayMode; label: string; icon: typeof Eye }> = [
    { id: "shaded", label: "Shaded", icon: Eye },
    { id: "wireframe", label: "Wireframe", icon: GitBranch },
    { id: "xray", label: "X-Ray", icon: Sparkles },
  ];
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant={mode !== "shaded" || !gridVisible || autoRotate ? "secondary" : "ghost"} size="xs" className="h-7 shrink-0 gap-1.5 px-2 text-[11px]" title="Model display">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Display</span>
          <ChevronDown className="h-3 w-3 text-fg/40" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[1000] w-56 rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none">
          {modes.map((item) => {
            const Icon = item.icon;
            return (
              <Popover.Close asChild key={item.id}>
                <button
                  type="button"
                  onClick={() => onMode(item.id)}
                  className={cn(
                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] transition-colors",
                    mode === item.id ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2 hover:text-fg",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {mode === item.id && <Check className="h-3 w-3" />}
                </button>
              </Popover.Close>
            );
          })}
          <div className="my-1 h-px bg-line/70" />
          <button type="button" onClick={onGrid} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg">
            <Table2 className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">Reference Grid</span>
            {gridVisible && <Check className="h-3 w-3 text-accent" />}
          </button>
          <button type="button" onClick={onAutoRotate} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg">
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">Auto Rotate</span>
            {autoRotate && <Check className="h-3 w-3 text-accent" />}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

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
  InspectDwgIntelligenceSnapshot,
  InspectDrawingAnalysisSettings,
  InspectDrawingDetectionKind,
  InspectModelElement,
  InspectRateScheduleItemOption,
  InspectSpreadsheetRow,
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
  initialZoom?: number;
  detached?: boolean;
  workspaceSyncOriginId?: string;
  selectedWorksheetId?: string | null;
  /** Externally-controlled selection (e.g. when a parent renders the link UI). */
  selection?: TakeoffSelection | null;
  onSelectionChange?: (selection: TakeoffSelection | null) => void;
  /** Publishes the active takeoff surface so detached/merged layouts remount
   *  into the same drawing instead of falling back to the first document. */
  onViewStateChange?: (state: { documentId: string; page: number; zoom: number }) => void;
  /** Mirror of the current annotations array, for parents that need to render them. */
  onAnnotationsChange?: (annotations: Pickup[]) => void;
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
  /** Ask the parent shell to open the right-side Entities tab. */
  onOpenInspectEntities?: () => void;
  /** Called whenever the inspect-relevant state changes so the parent can
   *  re-render the Inspect tab. */
  onInspectSnapshotChange?: (snapshot: InspectSnapshot) => void;
  /** Signals the combo shell that this takeoff surface is currently popped out. */
  onDetachedWindowChange?: (open: boolean, win?: Window | null) => void;
}

interface TakeoffSyncBase {
  originId: string;
  projectId: string;
}

type TakeoffSyncMessage =
  | (TakeoffSyncBase & { type: "view-change"; docId: string; page: number; zoom: number })
  | (TakeoffSyncBase & { type: "selection-change"; selection: TakeoffSelection | null })
  | (TakeoffSyncBase & { type: "annotations-mutated"; docId: string; page: number; annotations?: Pickup[] })
  | (TakeoffSyncBase & { type: "pickup-links-mutated" })
  | (TakeoffSyncBase & { type: "workspace-mutated" })
  | (TakeoffSyncBase & { type: "files-mutated" })
  | (TakeoffSyncBase & { type: "calibration-change"; calibration: Calibration | null })
  | (TakeoffSyncBase & { type: "open-inspect-entities" })
  | (TakeoffSyncBase & { type: "drawing-analysis-result"; docId: string; page: number; analysis: DrawingGeometryAnalysisResult | null })
  | (TakeoffSyncBase & { type: "drawing-detection-selection"; docId: string; page: number; detectionId: string | null });

type TakeoffSyncPayload =
  | { type: "view-change"; docId: string; page: number; zoom: number }
  | { type: "selection-change"; selection: TakeoffSelection | null }
  | { type: "annotations-mutated"; docId: string; page: number; annotations?: Pickup[] }
  | { type: "pickup-links-mutated" }
  | { type: "workspace-mutated" }
  | { type: "files-mutated" }
  | { type: "calibration-change"; calibration: Calibration | null }
  | { type: "open-inspect-entities" }
  | { type: "drawing-analysis-result"; docId: string; page: number; analysis: DrawingGeometryAnalysisResult | null }
  | { type: "drawing-detection-selection"; docId: string; page: number; detectionId: string | null };

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

type SpreadsheetPreviewState = ImportPreviewResponse & { sourceName: string; sourceNodeId?: string };
type SpreadsheetPivotSummary = NonNullable<ImportPreviewResponse["pivotSummaries"]>[number];
type SpreadsheetPivotSummaryRow = SpreadsheetPivotSummary["rows"][number];

function parseSpreadsheetNumber(value: unknown): number | null {
  const raw = String(value ?? "").replace(/[$,%\s,]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function spreadsheetMeasureLabel(measure: string | null | undefined) {
  return measure === "__count" ? "Row count" : (measure || "Quantity");
}

function activeSpreadsheetPivotSummary(
  preview: SpreadsheetPreviewState | null,
  groupBy: string,
  measure: string,
): SpreadsheetPivotSummary | null {
  if (!preview?.pivotSummaries?.length) return null;
  return (
    preview.pivotSummaries.find((summary) => summary.groupBy === groupBy && summary.measure === measure) ??
    preview.pivotSummaries.find((summary) => summary.groupBy === groupBy) ??
    preview.pivotSummaries[0] ??
    null
  );
}

function spreadsheetPivotInspectRows(
  preview: SpreadsheetPreviewState,
  summary: SpreadsheetPivotSummary,
): InspectSpreadsheetRow[] {
  const measureLabel = spreadsheetMeasureLabel(summary.measure);
  return summary.rows.map((row, index) => {
    const label = row.label || "(blank)";
    return {
      kind: "pivot" as const,
      id: `${preview.sourceNodeId ?? preview.sourceName}::pivot::${summary.groupBy}::${summary.measure}::${index}`,
      index,
      values: {
        [summary.groupBy]: label,
        [measureLabel]: numericFormat(row.total),
        Rows: row.count.toLocaleString(),
        Average: numericFormat(row.average),
      },
      pivot: {
        groupBy: summary.groupBy,
        measure: summary.measure,
        measureLabel,
        sourceRowCount: row.count,
        total: row.total,
        average: row.average,
      },
    };
  });
}

function spreadsheetRawInspectRows(preview: SpreadsheetPreviewState): InspectSpreadsheetRow[] {
  return preview.sampleRows.map((row, index) => {
    const values: Record<string, string> = {};
    preview.headers.forEach((header, colIdx) => {
      const raw = row[colIdx];
      values[header] = raw == null ? "" : String(raw);
    });
    return {
      kind: "raw" as const,
      id: `${preview.sourceNodeId ?? preview.sourceName}::${index}`,
      index,
      values,
    };
  });
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

function toLinkedModelLineItem(link: ModelPickupLinkRecord): BidwrightModelLinkedLineItem | null {
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

function normalizeAnnotationMeasurement(value: unknown): Pickup["measurement"] | undefined {
  const record = objectRecord(value);
  const measurement: NonNullable<Pickup["measurement"]> = {
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

function annotationOptsFromMetadata(metadata: Record<string, unknown>): Pickup["opts"] | undefined {
  const { canvasWidth: _canvasWidth, canvasHeight: _canvasHeight, ...opts } = metadata;
  return Object.keys(opts).length > 0 ? opts as Pickup["opts"] : undefined;
}

/* ─── JSON Export Helper ─── */

function exportAnnotationsJson(annotations: Pickup[], calibration: Calibration | null) {
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
  initialZoom = 1,
  detached = false,
  workspaceSyncOriginId,
  selectedWorksheetId,
  selection,
  onSelectionChange,
  onViewStateChange,
  onAnnotationsChange,
  linksReloadSignal,
  onLinksMutated,
  modelSendToEstimateRef,
  modelElementCreateLineItemRef,
  inspectActionsRef,
  onOpenInspectEntities,
  onInspectSnapshotChange,
  onDetachedWindowChange,
}: TakeoffTabProps) {
  const projectId = workspace.project.id;
  const isDetachedMirror = detached && Boolean(onDetachedWindowChange);
  const selectedWorksheet =
    (selectedWorksheetId ? workspace.worksheets.find((worksheet) => worksheet.id === selectedWorksheetId) : null) ??
    workspace.worksheets[0] ??
    null;
  const safeInitialPage = Number.isFinite(initialPage) ? Math.max(1, Math.floor(initialPage)) : 1;
  const safeInitialZoom = roundPdfZoom(initialZoom);

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
  const [spreadsheetPreview, setSpreadsheetPreview] = useState<SpreadsheetPreviewState | null>(null);
  const [spreadsheetPanelView, setSpreadsheetPanelView] = useState<SpreadsheetPanelView>("preview");
  const [pivotGroupBy, setPivotGroupBy] = useState("");
  const [pivotMeasure, setPivotMeasure] = useState("__count");

  // Photo-derived BOM result set surfaced into the side panel as entities.
  // Tracks both the latest vision-API response and which row indexes the
  // estimator has already + Added so the row dims in the panel.
  const [photoBomResult, setPhotoBomResult] = useState<PhotoTakeoffResult | null>(null);
  const [photoBomSourcePhotoNames, setPhotoBomSourcePhotoNames] = useState<string[]>([]);
  // Parallel array of base64 data URIs for each uploaded photo. Stored in
  // state so the Pickups panel can render each Photo BOM row's source photo
  // as a thumbnail without re-downloading from the API. Zero-aligned with
  // photoBomSourcePhotoNames — indexed by `row.sourceImageIndexes[0]`.
  const [photoBomSourcePhotoDataUris, setPhotoBomSourcePhotoDataUris] = useState<string[]>([]);
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
  const [zoom, setZoom] = useState(safeInitialZoom);
  const [totalPages, setTotalPages] = useState(1);
  const [activeTool, setActiveTool] = useState<ToolId>("select");
  const [shortcutPreset, setShortcutPreset] = useState<TakeoffShortcutPreset>("bidwright");

  useEffect(() => {
    const saved = window.localStorage.getItem("bidwright.takeoff.shortcutPreset");
    if (isTakeoffShortcutPreset(saved)) setShortcutPreset(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("bidwright.takeoff.shortcutPreset", shortcutPreset);
  }, [shortcutPreset]);

  /* Annotation state */
  const [annotations, setAnnotations] = useState<Pickup[]>([]);
  const [selectedPickupId, setSelectedPickupId] = useState<string | null>(null);
  const [dwgAnnotationsCache, setDwgAnnotationsCache] = useState<Pickup[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AnnotationConfig | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const undoStackRef = useRef<TakeoffHistoryCommand[]>([]);
  const redoStackRef = useRef<TakeoffHistoryCommand[]>([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const externalPickupSelectionId = selection?.kind === "annotation" ? selection.pickupId : null;
  const lastPublishedSelectionSignatureRef = useRef<string | null>(null);

  function publishTakeoffSelection(next: TakeoffSelection | null) {
    const signature = next ? JSON.stringify(next) : "null";
    if (signature === lastPublishedSelectionSignatureRef.current) return;
    lastPublishedSelectionSignatureRef.current = signature;
    onSelectionChange?.(next);
    postTakeoffMessage({ type: "selection-change", selection: next });
  }

  const updateAnnotationSelection = useCallback((id: string | null) => {
    setSelectedPickupId((prev) => (prev === id ? prev : id));
    if (id) {
      if (externalPickupSelectionId !== id || !onSelectionChange) {
        publishTakeoffSelection({ kind: "annotation", pickupId: id });
      }
      return;
    }
    if (externalPickupSelectionId || !onSelectionChange) {
      publishTakeoffSelection(null);
    }
  }, [externalPickupSelectionId, onSelectionChange]);

  /* ─── Takeoff Link state ─── */
  const [pickupLinks, setTakeoffLinks] = useState<PickupLinkRecord[]>([]);

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
  /* Tracks which legend entries are mid-save to /from-legend, keyed by `${symbol}-${idx}`. */
  const [savingLegendKey, setSavingLegendKey] = useState<string | null>(null);
  /* Set of legend keys already added to the library this session — for inline UI feedback. */
  const [savedLegendKeys, setSavedLegendKeys] = useState<Set<string>>(() => new Set());

  /* Symbol Library state */
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryCount, setLibraryCount] = useState<number | null>(null);

  /* Drawing intelligence state */
  const [drawingAnalysisSettings, setDrawingAnalysisSettings] = useState<InspectDrawingAnalysisSettings>({
    preset: "generic",
    geometrySource: "auto",
    includeSymbols: true,
    includeTextRegions: true,
    includeCircles: true,
    traceSystems: true,
    maxLines: 0,
    maxRegions: 500,
    minLineLength: 0,
    snapTolerance: 0,
    lineSensitivity: 0.62,
    noiseRejection: 0.42,
  });
  const drawingAnalysisPreset = drawingAnalysisSettings.preset;
  const [drawingAnalysisResult, setDrawingAnalysisResult] = useState<DrawingGeometryAnalysisResult | null>(null);
  const [drawingAnalysisRunning, setDrawingAnalysisRunning] = useState(false);
  const [drawingAnalysisSavingId, setDrawingAnalysisSavingId] = useState<string | null>(null);
  const [drawingAnalysisError, setDrawingAnalysisError] = useState<string | null>(null);
  const [selectedDrawingDetectionId, setSelectedDrawingDetectionId] = useState<string | null>(null);
  const pendingDrawingFocusRef = useRef<string | null>(null);
  const pendingDrawingFocusBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [drawingAnalysisOverlay, setDrawingAnalysisOverlay] = useState<DrawingAnalysisOverlayState>({
    lines: true,
    systems: true,
    symbols: true,
    circles: false,
    text: false,
    // Default-on: vector primitives are high-confidence CAD truth — the
    // estimator wants to see them by default. The raster Hough `circles`
    // overlay stays off by default because it's noisy on dense pages.
    arcs: true,
    curves: true,
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

  function cloneCalibrationDocCache(docId: string): Record<string, Calibration> | null {
    const docCache = calibrationCacheRef.current[docId];
    if (!docCache) return null;
    const entries = Object.entries(docCache)
      .filter((entry): entry is [string, Calibration] => Boolean(entry[1]))
      .map(([key, value]) => [key, { ...value }] as const);
    return entries.length > 0 ? Object.fromEntries(entries) : null;
  }

  function applyCalibrationDocCacheSnapshot(docId: string, snapshot: Record<string, Calibration> | null) {
    const nextCache = { ...calibrationCacheRef.current };
    if (snapshot && Object.keys(snapshot).length > 0) {
      nextCache[docId] = { ...(snapshot as CalibrationDocCache) };
    } else {
      delete nextCache[docId];
    }
    calibrationCacheRef.current = nextCache;
    if (docId === selectedDocId) {
      setCalibration(lookupCalibrationFromCache(docId, page));
    }
    void updateWorkspaceState(projectId, { takeoffCalibrations: nextCache }).catch(() => {});
  }

  function applyCalibrationSnapshot(
    docId: string,
    pageNumber: number,
    next: Calibration | null,
    applyToAllPages: boolean,
  ) {
    const docCache = { ...(calibrationCacheRef.current[docId] ?? {}) };
    if (applyToAllPages) {
      for (const key of Object.keys(docCache)) {
        if (key !== "__default") delete docCache[Number(key)];
      }
      if (next) {
        docCache.__default = next;
      } else {
        delete docCache.__default;
      }
    } else if (next) {
      docCache[pageNumber] = next;
    } else {
      delete docCache[pageNumber];
    }

    const nextCache = { ...calibrationCacheRef.current };
    if (Object.keys(docCache).length > 0) {
      nextCache[docId] = docCache;
    } else {
      delete nextCache[docId];
    }
    calibrationCacheRef.current = nextCache;

    if (docId === selectedDocId) {
      setCalibration(lookupCalibrationFromCache(docId, page));
    }
    void updateWorkspaceState(projectId, { takeoffCalibrations: nextCache }).catch(() => {});
  }

  /* Drawing config (from modal or defaults) */
  const COLOR_CYCLE = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];
  const colorIndexRef = useRef(0);
  const [activeColor, setActiveColor] = useState(COLOR_CYCLE[0]);
  const [activeThickness, setActiveThickness] = useState(3);
  const [activeOpts, setActiveOpts] = useState<Pickup["opts"]>({});
  const [activeGroupName, setActiveGroupName] = useState<string | undefined>();
  const [activeLabel, setActiveLabel] = useState<string>("");

  /* Auto-count state */
  const [autoCountRunning, setAutoCountRunning] = useState(false);
  const [autoCountResults, setAutoCountResults] = useState<VisionMatch[] | null>(null);
  const [autoCountSnippet, setAutoCountSnippet] = useState<string | null>(null);
  const [autoCountThreshold, setAutoCountThreshold] = useState(0.65);
  const [autoCountScope, setAutoCountScope] = useState<"page" | "document" | "all">("page");
  // The previous floating confirm modal was replaced by direct-to-Pickups
  // bundling — see bundleAndSaveAutoCount. No `autoCountPending` /
  // `autoCountModalOpen` state needed.

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
    id: string;
    label: string;
    count: number;
    confidence: "high" | "medium" | "low";
    notes: string;
    pickupId?: string | null;
  }
  const [smartCountRunning, setSmartCountRunning] = useState(false);
  const [smartCountBbox, setSmartCountBbox] = useState<VisionBoundingBox | null>(null);
  const [smartCountCropImage, setSmartCountCropImage] = useState<string | null>(null);
  const [smartCountItems, setSmartCountItems] = useState<SmartCountItem[] | null>(null);
  const [smartCountIncluded, setSmartCountIncluded] = useState<boolean[]>([]);
  const [smartCountError, setSmartCountError] = useState<string | null>(null);
  const [smartCountSavingId, setSmartCountSavingId] = useState<string | null>(null);
  const [selectedSmartCountItemId, setSelectedSmartCountItemId] = useState<string | null>(null);

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
  const detachedWindowRef = useRef<Window | null>(null);
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
  const loadPickupLinksRef = useRef<() => Promise<void>>(async () => {});
  const loadDwgEntityLinksRef = useRef<() => Promise<void>>(async () => {});
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
  const [modelTakeoffLinks, setModelTakeoffLinks] = useState<ModelPickupLinkRecord[]>([]);
  const [modelElements, setModelElements] = useState<ModelElementWithQuantities[]>([]);
  const [modelElementSearch, setModelElementSearch] = useState("");
  const [modelElementsLoading, setModelElementsLoading] = useState(false);
  const [modelLedgerBasis, setModelLedgerBasis] = useState<ModelQuantityBasis>("count");
  const [selectedModelElementIds, setSelectedModelElementIds] = useState<Set<string>>(() => new Set());
  const [modelSyncing, setModelSyncing] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const modelViewerActionsRef = useRef<CadViewerActions | null>(null);
  const [modelDisplayMode, setModelDisplayMode] = useState<CadViewerDisplayMode>("shaded");
  const [modelGridVisible, setModelGridVisible] = useState(true);
  const [modelAutoRotate, setModelAutoRotate] = useState(false);
  const [modelStandardView, setModelStandardView] = useState<CadViewerStandardView>("iso");
  // Discriminated union: the picker carries enough context to resume the
  // original action once a worksheet exists. Covers every entity-to-line-item
  // path in the side panel — per-row Adds and per-group summed Adds for both
  // annotations (PDF / DWG) and model elements (BIM / 3D).
  type WorksheetPickerAction =
    | { kind: "send-selection" }
    | { kind: "create-elements" }
    | { kind: "create-single-element"; elementId: string; pick: InspectCategoryPick }
    | { kind: "create-element-group"; elementIds: string[]; groupLabel: string; pick: InspectCategoryPick }
    | { kind: "create-single-annotation"; pickupId: string; pick: InspectCategoryPick }
    | { kind: "create-annotation-group"; pickupIds: string[]; groupLabel: string; pick: InspectCategoryPick }
    | { kind: "create-dwg-row"; rowId: string; rowType: "entity" | "autoCount" | "system"; pick: InspectCategoryPick }
    | { kind: "create-spreadsheet-row"; rowIndex: number; mode: SpreadsheetPanelView; pick: InspectCategoryPick }
    | { kind: "create-spreadsheet-all"; mode: SpreadsheetPanelView; pick: InspectCategoryPick };
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
      if (!selectedModelAsset) return;
      if (sel.expressID < 0) {
        if (selection?.kind === "model-element" || !onSelectionChange) publishTakeoffSelection(null);
        return;
      }
      const wanted = `#${sel.expressID}`;
      const element = modelElements.find((e) => {
        const props = (e.properties as Record<string, unknown> | null) ?? {};
        return props.expressId === wanted;
      });
      if (!element) return;
      publishTakeoffSelection({
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
    setModelDisplayMode("shaded");
    setModelGridVisible(true);
    setModelAutoRotate(false);
    setModelStandardView("iso");
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
    zoomRef.current = safeInitialZoom;
    setZoom(safeInitialZoom);
    fitOnLoadRef.current = true;
  }, [takeoffDocuments, initialDocumentId, safeInitialPage, safeInitialZoom]);

  // Reset selection + force fit-to-page whenever the document changes. Without
  // this, opening a PDF that already had a selected detection persisted in
  // state caused the canvas to auto-zoom onto that detection — but the row
  // wasn't highlighted (selection state and detection state were out of sync)
  // and the zoom was locked. User TEST A: "loading a pdf always should be fit
  // to page no entities highlighted". This effect is the single source of
  // truth for "new doc opened → clean slate"; the per-action paths above
  // already do this, but centralising it catches the doc-list-click /
  // BroadcastChannel-sync paths that previously skipped the reset.
  const lastResetDocIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedDocId) return;
    if (lastResetDocIdRef.current === selectedDocId) return;
    lastResetDocIdRef.current = selectedDocId;
    setSelectedPickupId(null);
    setSelectedDrawingDetectionId(null);
    setSelectedSmartCountItemId(null);
    setSelectedModelElementIds(new Set());
    setDwgIntelligence((current) => (current ? { ...current, selectedEntityId: null } : current));
    dwgActionsRef.current?.selectEntity(null);
    fitOnLoadRef.current = true;
  }, [selectedDocId]);

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
      const data = await listPickups(projectId, annotationDocumentId, page);
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
              // Round-trip the full metadata blob so source-tagged rows
              // (auto-count, smart-count, future ones) stay segregated after
              // any reload. Previously we silently dropped this — that's
              // why a freshly created Auto Count row disappeared from the
              // Pickups panel: loadAnnotations clobbered local state with
              // a metadata-less copy, partitionAnnotations no longer saw
              // `source: "auto-count"`, and the row routed to the Manual
              // group (or got swallowed if filtered out).
              metadata,
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
  const loadPickupLinks = useCallback(async () => {
    if (!projectId) return;
    try {
      const links = await listPickupLinks(projectId);
      if (Array.isArray(links)) setTakeoffLinks(links);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    loadPickupLinksRef.current = loadPickupLinks;
  }, [loadPickupLinks]);

  useEffect(() => {
    loadPickupLinks();
  }, [loadPickupLinks]);

  // Reload links when the parent signals a mutation happened outside this tab
  // (e.g. from the side-panel link UI). Skip the first run so we don't double-fetch.
  const reloadSignalSeenRef = useRef(false);
  useEffect(() => {
    if (linksReloadSignal === undefined) return;
    if (!reloadSignalSeenRef.current) {
      reloadSignalSeenRef.current = true;
      return;
    }
    void loadPickupLinks();
  }, [linksReloadSignal, loadPickupLinks]);

  // Publish annotations (PDF + DWG merged) to the parent so the side panel can
  // look them up by id regardless of which viewer drew them.
  useEffect(() => {
    onAnnotationsChange?.([...annotations, ...dwgAnnotationsCache]);
  }, [annotations, dwgAnnotationsCache, onAnnotationsChange]);

  // Mirror externally-controlled annotation selection into local state. Clearing
  // is done by updateAnnotationSelection so local clicks cannot race a stale
  // parent null and bounce forever.
  useEffect(() => {
    if (externalPickupSelectionId) {
      setSelectedPickupId((prev) => (
        prev === externalPickupSelectionId ? prev : externalPickupSelectionId
      ));
    }
  }, [externalPickupSelectionId]);

  // Bridge for dispatching DWG annotation actions (delete) from the side panel.
  // Populated by DwgTakeoffSurface, consumed by inspectActionsRef below.
  const dwgActionsRef = useRef<{
    deleteAnnotation: (id: string) => Promise<void> | void;
    selectEntity: (id: string | null) => void;
    selectEntities: (ids: string[]) => void;
  } | null>(null);
  const [dwgIntelligence, setDwgIntelligence] = useState<InspectDwgIntelligenceSnapshot | null>(null);
  const [dwgEntityLinks, setDwgEntityLinks] = useState<DwgEntityLinkRecord[]>([]);
  const [dwgEntitySavingId, setDwgEntitySavingId] = useState<string | null>(null);

  const loadDwgEntityLinks = useCallback(async (documentId = dwgIntelligence?.documentId) => {
    if (!projectId || !documentId) {
      setDwgEntityLinks([]);
      return;
    }
    try {
      const links = await listDwgEntityLinks(projectId, { documentId });
      setDwgEntityLinks(Array.isArray(links) ? links : []);
    } catch (error) {
      console.error("[takeoff] Failed to load DWG entity links:", error);
      setDwgEntityLinks([]);
    }
  }, [dwgIntelligence?.documentId, projectId]);

  useEffect(() => {
    loadDwgEntityLinksRef.current = () => loadDwgEntityLinks();
  }, [loadDwgEntityLinks]);

  useEffect(() => {
    void loadDwgEntityLinks();
  }, [loadDwgEntityLinks]);

  const enrichedDwgIntelligence = useMemo<InspectDwgIntelligenceSnapshot | null>(() => {
    if (!dwgIntelligence) return null;
    const linkCountByEntity = new Map<string, number>();
    for (const link of dwgEntityLinks) {
      linkCountByEntity.set(link.entityId, (linkCountByEntity.get(link.entityId) ?? 0) + 1);
    }
    const rollupLinkCount = (ids: string[]) =>
      ids.reduce((total, id) => total + (linkCountByEntity.get(id) ?? 0), 0);
    return {
      ...dwgIntelligence,
      savingEntityId: dwgEntitySavingId,
      entities: dwgIntelligence.entities.map((row) => {
        const linkCount = linkCountByEntity.get(row.id) ?? 0;
        return { ...row, linkCount, isLinked: linkCount > 0 };
      }),
      autoCounts: dwgIntelligence.autoCounts.map((row) => {
        const linkCount = rollupLinkCount(row.sourceEntityIds);
        return { ...row, linkCount, isLinked: linkCount > 0 };
      }),
      systems: dwgIntelligence.systems.map((row) => {
        const linkCount = rollupLinkCount(row.sourceEntityIds);
        return { ...row, linkCount, isLinked: linkCount > 0 };
      }),
    };
  }, [dwgEntityLinks, dwgEntitySavingId, dwgIntelligence]);

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
        // This ref is driven by model-editor actions outside the Entities
        // panel, so it doesn't show the AddToCategoryPopover. Fall back to
        // the sticky / heuristic takeoffCategory the side-panel uses.
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
            if (id) publishTakeoffSelection({ kind: "annotation", pickupId: id });
            else if (selection?.kind === "annotation" || !onSelectionChange) publishTakeoffSelection(null);
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
        toggleAutoCountMatch: (pickupId, matchIndex) => {
          void handleToggleAutoCountMatch(pickupId, matchIndex);
        },
        clearAllAnnotationsForCurrentDocument: () => {
          void handleClearAllAnnotations();
        },
        editAnnotation: (id) => {
          if (annotations.some((a) => a.id === id)) {
            handleEditAnnotation(id);
          }
        },
        cancelAnnotationEdit: () => {
          setEditingPickupId(null);
        },
        saveAnnotationEdit: (id, updates) => {
          handleSaveAnnotationEdit(id, updates);
        },
        runDrawingAnalysis: async () => {
          await handleRunDrawingAnalysis();
        },
        updateDrawingAnalysisSettings: (patch) => {
          setDrawingAnalysisSettings((current) => ({ ...current, ...patch }));
        },
        setDrawingAnalysisOverlay: (patch) => {
          setDrawingAnalysisOverlay((current) => ({ ...current, ...patch }));
        },
        selectDrawingDetection: (id) => {
          handleSelectDrawingDetection(id);
        },
        selectDrawingDetectionGroup: (ids) => {
          handleSelectDrawingDetectionGroup(ids);
        },
        saveDrawingDetection: async (id, kind) => {
          await handleSaveDrawingDetection(id, kind);
        },
        createLineItemFromDrawingDetection: async (id, kind, pick) => {
          await handleCreateDrawingDetectionLineItem(id, kind, pick);
        },
        createLineItemFromDrawingSymbolGroup: async (ids, label, pick) => {
          await handleCreateDrawingSymbolGroupLineItem(ids, label, pick);
        },
        deleteDrawingDetection: (id, kind) => {
          handleDeleteDrawingDetection(id, kind);
        },
        deleteDrawingDetectionGroup: (ids, kind) => {
          handleDeleteDrawingDetectionGroup(ids, kind);
        },
        selectSmartCountItem: (id) => {
          handleSelectSmartCountItem(id);
        },
        toggleSmartCountItem: (id) => {
          handleToggleSmartCountItem(id);
        },
        saveSmartCountItem: async (id) => {
          await saveSmartCountItemAsAnnotation(id);
        },
        createLineItemFromSmartCountItem: async (id, pick) => {
          await handleCreateSmartCountItemLineItem(id, pick);
        },
        saveSelectedSmartCountItems: async () => {
          await handleSaveSelectedSmartCountItems();
        },
        deleteSmartCountItem: (id) => {
          handleDeleteSmartCountItem(id);
        },
        clearSmartCountResults: () => {
          handleClearSmartCountResults();
        },
        setModelSearch: (s) => setModelElementSearch(s),
        setModelBasis: (b) => setModelLedgerBasis(b),
        selectModelElement: (id) => {
          if (!id || !selectedModelAsset) {
            if (selection?.kind === "model-element" || !onSelectionChange) publishTakeoffSelection(null);
            return;
          }
          const element = modelElements.find((e) => e.id === id);
          if (!element) return;
          publishTakeoffSelection({
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
            .filter((a): a is Pickup => Boolean(a));
          if (targets.length === 0) return;
          await handleCreateAnnotationGroupLineItem(targets, groupLabel, pick);
        },
        selectDwgEntity: (id) => {
          dwgActionsRef.current?.selectEntity(id);
          if (!id) {
            if (selection?.kind === "cad-entity" || !onSelectionChange) publishTakeoffSelection(null);
            return;
          }
          const intel = enrichedDwgIntelligence ?? dwgIntelligence;
          const row = intel?.entities.find((candidate) => candidate.id === id);
          if (!intel || !row) return;
          publishTakeoffSelection({
            kind: "cad-entity",
            documentId: intel.documentId,
            entityId: row.id,
            entityType: row.type,
            layer: row.layer,
            label: row.label,
            summary: row.measurementLabel,
          });
        },
        selectDwgEntities: (ids) => {
          dwgActionsRef.current?.selectEntities(ids);
          const firstId = ids.find(Boolean);
          if (!firstId) {
            if (selection?.kind === "cad-entity" || !onSelectionChange) publishTakeoffSelection(null);
            return;
          }
          const intel = enrichedDwgIntelligence ?? dwgIntelligence;
          const row = intel?.entities.find((candidate) => candidate.id === firstId);
          if (!intel || !row) return;
          publishTakeoffSelection({
            kind: "cad-entity",
            documentId: intel.documentId,
            entityId: row.id,
            entityType: row.type,
            layer: row.layer,
            label: row.label,
            summary: row.measurementLabel,
          });
        },
        createLineItemFromDwgEntity: async (id, pick) => {
          await handleCreateDwgRowLineItem("entity", id, pick);
        },
        createLineItemFromDwgAutoCount: async (id, pick) => {
          await handleCreateDwgRowLineItem("autoCount", id, pick);
        },
        createLineItemFromDwgSystem: async (id, pick) => {
          await handleCreateDwgRowLineItem("system", id, pick);
        },
        deleteDwgEntity: (id) => {
          handleDeleteDwgEntityRow(id);
        },
        deleteDwgAutoCount: (id) => {
          handleDeleteDwgAutoCountRow(id);
        },
        deleteDwgSystem: (id) => {
          handleDeleteDwgSystemRow(id);
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
          setPhotoBomSourcePhotoDataUris([]);
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
      publishTakeoffSelection({
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
      publishTakeoffSelection(null);
    }
  }, [modelSelection, onSelectionChange]);

  const applyExternalTakeoffSelectionRef = useRef<(next: TakeoffSelection | null) => void>(() => {});

  function applyExternalTakeoffSelection(next: TakeoffSelection | null) {
    lastPublishedSelectionSignatureRef.current = next ? JSON.stringify(next) : "null";
    onSelectionChange?.(next);

    if (!next) {
      setSelectedPickupId(null);
      setSelectedDrawingDetectionId(null);
      setSelectedSmartCountItemId(null);
      setSelectedModelElementIds(new Set());
      setDwgIntelligence((current) => (current ? { ...current, selectedEntityId: null } : current));
      dwgActionsRef.current?.selectEntity(null);
      return;
    }

    if (next.kind === "annotation") {
      setSelectedPickupId((prev) => (prev === next.pickupId ? prev : next.pickupId));
      setSelectedDrawingDetectionId(null);
      setSelectedSmartCountItemId(null);
      setSelectedModelElementIds(new Set());
      return;
    }

    if (next.kind === "cad-entity") {
      const matched = dwgDocuments.find((doc) => (doc.fileNodeId ?? doc.id) === next.documentId);
      if (matched && matched.id !== selectedDocIdRef.current) {
        selectedDocIdRef.current = matched.id;
        pageRef.current = 1;
        setSelectedDocId(matched.id);
        setPage(1);
        setAnnotations([]);
        fitOnLoadRef.current = true;
      }
      setSelectedPickupId(null);
      setSelectedDrawingDetectionId(null);
      setSelectedSmartCountItemId(null);
      setSelectedModelElementIds(new Set());
      setDwgIntelligence((current) => (
        current && current.documentId === next.documentId
          ? { ...current, selectedEntityId: next.entityId }
          : current
      ));
      dwgActionsRef.current?.selectEntity(next.entityId);
      return;
    }

    if (next.kind === "model-element") {
      const matched = takeoffDocuments.find((doc) => doc.modelAssetId === next.assetId);
      if (matched && matched.id !== selectedDocIdRef.current) {
        selectedDocIdRef.current = matched.id;
        pageRef.current = 1;
        setSelectedDocId(matched.id);
        setPage(1);
        fitOnLoadRef.current = true;
      }
      setSelectedPickupId(null);
      setSelectedDrawingDetectionId(null);
      setSelectedSmartCountItemId(null);
      setDwgIntelligence((current) => (current ? { ...current, selectedEntityId: null } : current));
      dwgActionsRef.current?.selectEntity(null);
      setSelectedModelElementIds(new Set([next.elementId]));
      return;
    }

    if (next.kind === "model-selection") {
      const matched = next.modelDocumentId
        ? takeoffDocuments.find((doc) => doc.id === next.modelDocumentId || doc.modelAssetId === next.modelId)
        : takeoffDocuments.find((doc) => doc.modelAssetId === next.modelId);
      if (matched && matched.id !== selectedDocIdRef.current) {
        selectedDocIdRef.current = matched.id;
        pageRef.current = 1;
        setSelectedDocId(matched.id);
        setPage(1);
        fitOnLoadRef.current = true;
      }
      setSelectedPickupId(null);
      setSelectedDrawingDetectionId(null);
      setSelectedSmartCountItemId(null);
      setDwgIntelligence((current) => (current ? { ...current, selectedEntityId: null } : current));
      dwgActionsRef.current?.selectEntity(null);
      setSelectedModelElementIds(new Set());
    }
  }

  useEffect(() => {
    applyExternalTakeoffSelectionRef.current = applyExternalTakeoffSelection;
  });

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

      if (msg.type === "selection-change") {
        applyExternalTakeoffSelectionRef.current(msg.selection);
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

      if (msg.type === "pickup-links-mutated") {
        void loadPickupLinksRef.current();
        void loadDwgEntityLinksRef.current();
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
        return;
      }

      if (msg.type === "open-inspect-entities") {
        onOpenInspectEntities?.();
        return;
      }

      if (msg.type === "drawing-analysis-result") {
        if (msg.docId !== selectedDocIdRef.current || msg.page !== pageRef.current) return;
        setDrawingAnalysisResult(msg.analysis);
        setDrawingAnalysisError(msg.analysis?.warnings?.[0] ?? null);
        return;
      }

      if (msg.type === "drawing-detection-selection") {
        if (msg.docId !== selectedDocIdRef.current || msg.page !== pageRef.current) return;
        pendingDrawingFocusRef.current = msg.detectionId;
        setSelectedDrawingDetectionId(msg.detectionId);
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
    onViewStateChange?.({ documentId: selectedDocId, page, zoom });
    if (isDetachedMirror) return;
    postTakeoffMessage({ type: "view-change", docId: selectedDocId, page, zoom });
  }, [isDetachedMirror, onViewStateChange, page, postTakeoffMessage, selectedDocId, zoom]);

  useEffect(() => {
    postTakeoffMessage({ type: "calibration-change", calibration });
  }, [calibration, postTakeoffMessage]);

  useEffect(() => {
    if (detached || !onDetachedWindowChange) return;
    const interval = window.setInterval(() => {
      const win = detachedWindowRef.current;
      if (win && win.closed) {
        detachedWindowRef.current = null;
        onDetachedWindowChange(false);
      }
    }, 900);
    return () => window.clearInterval(interval);
  }, [detached, onDetachedWindowChange]);

  /* Takeoff keyboard shortcuts: tool presets, undo/redo, page nav, zoom. */
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
        return;
      }

      if (isTextEditingTarget(e.target)) return;

      const action = resolveTakeoffShortcut(
        {
          key: e.key,
          altKey: e.altKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
        },
        shortcutPreset,
      );
      if (!action) return;

      e.preventDefault();
      if (action.kind === "tool") {
        const tool = TOOLS.find((candidate) => candidate.id === action.toolId)?.id;
        if (tool && isPdfDocument) handleToolSelect(tool);
        return;
      }
      if (action.kind === "undo") {
        void undoTakeoffAction();
        return;
      }
      if (action.kind === "redo") {
        void redoTakeoffAction();
        return;
      }
      if (action.kind === "next-page") {
        setPage((current) => Math.min(totalPages, current + 1));
        return;
      }
      if (action.kind === "previous-page") {
        setPage((current) => Math.max(1, current - 1));
        return;
      }
      if (action.kind === "zoom-in") {
        applyPdfZoom(zoom * 1.1);
        return;
      }
      if (action.kind === "zoom-out") {
        applyPdfZoom(zoom / 1.1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [applyPdfZoom, isPdfDocument, shortcutPreset, totalPages, zoom]);

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
        if (!map) return;
        calibrationCacheRef.current = map;
        const currentDocId = selectedDocIdRef.current;
        if (currentDocId) {
          setCalibration(lookupCalibrationFromCache(currentDocId, pageRef.current));
        }
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
    if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
      detachedWindowRef.current.focus();
      onDetachedWindowChange?.(true, detachedWindowRef.current);
      return;
    }
    const src = selectedDoc?.source ?? "project";
    const url = `/takeoff-viewer?projectId=${encodeURIComponent(projectId)}&docId=${encodeURIComponent(selectedDocId)}&source=${encodeURIComponent(src)}&page=${page}&zoom=${zoom}`;
    const nextWindow = window.open(url, `bw-takeoff-${projectId}`, "width=1400,height=900,resizable=yes");
    if (!nextWindow) {
      setToastType("error");
      setToastMessage("The browser blocked the detached takeoff window.");
      return;
    }
    detachedWindowRef.current = nextWindow;
    onDetachedWindowChange?.(true, nextWindow);
  }

  function handleSpreadsheetSummarize() {
    if (!spreadsheetPreview) return;
    onOpenAgentChat?.(
      `Summarize spreadsheet source ${spreadsheetPreview.sourceName}. Identify estimate-ready line items, quantity columns, cost/price columns, likely category/vendor fields, and any data quality risks.`,
    );
  }

  function handleSpreadsheetImportAllFromToolbar() {
    const categoryId = takeoffCategory?.id;
    if (!categoryId) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before importing rows.");
      return;
    }
    void handleCreateAllSpreadsheetLineItems(categoryId);
  }

  function handleModelFitView() {
    modelViewerActionsRef.current?.fitToContent();
  }

  function handleModelResetView() {
    setModelStandardView("iso");
    modelViewerActionsRef.current?.resetView();
  }

  function handleModelStandardView(view: CadViewerStandardView) {
    setModelStandardView(view);
    modelViewerActionsRef.current?.setStandardView(view);
  }

  function handleModelDisplayMode(mode: CadViewerDisplayMode) {
    setModelDisplayMode(mode);
    modelViewerActionsRef.current?.setDisplayMode(mode);
  }

  function handleModelGridToggle() {
    setModelGridVisible((current) => {
      const next = !current;
      modelViewerActionsRef.current?.setGridVisible(next);
      return next;
    });
  }

  function handleModelAutoRotateToggle() {
    setModelAutoRotate((current) => {
      const next = !current;
      modelViewerActionsRef.current?.setAutoRotate(next);
      return next;
    });
  }

  function handleOpenModelEditor() {
    if (!selectedModelIsEditable || !selectedDoc) return;
    const editorUrl = buildModelEditorUrl(documentUrl, selectedDoc.fileName, 0, {
      projectId,
      modelAssetId: selectedModelAsset?.id,
      modelDocumentId: selectedDoc.fileNodeId ?? selectedDoc.id,
      syncChannelName: modelEditorChannelName(projectId),
      estimateEnabled: Boolean(selectedWorksheet),
      estimateTargetWorksheetId: selectedWorksheet?.id,
      estimateTargetWorksheetName: selectedWorksheet?.name,
      estimateDefaultMarkup: workspace.currentRevision.defaultMarkup ?? 0.2,
      estimateQuoteLabel: workspace.quote?.quoteNumber ?? workspace.project.name,
    });
    window.open(editorUrl, "_blank", "width=1400,height=900,resizable=yes");
  }

  function notifyAnnotationsMutated(nextAnnotations?: Pickup[]) {
    if (!selectedDocId) return;
    postTakeoffMessage({
      type: "annotations-mutated",
      docId: selectedDocId,
      page,
      annotations: nextAnnotations,
    });
  }

  function notifyPickupLinksMutated() {
    postTakeoffMessage({ type: "pickup-links-mutated" });
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

  function annotationToApiPayload(annotation: Pickup) {
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

  function mapSavedAnnotation(saved: any, fallback: Pickup): Pickup {
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

  async function recreatePickup(annotation: Pickup): Promise<Pickup> {
    const local = { ...annotation, id: crypto.randomUUID() };
    try {
      const saved = await createPickup(projectId, annotationToApiPayload(local));
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

  async function deletePickupLocal(id: string) {
    setAnnotations((prev) => prev.filter((annotation) => annotation.id !== id));
    try {
      await deletePickup(projectId, id);
    } catch {
      /* Ignore optimistic local delete failures. */
    }
    notifyAnnotationsMutated();
  }

  async function updatePickupLocal(annotation: Pickup) {
    const payload = annotationToApiPayload(annotation);
    setAnnotations((prev) => prev.map((candidate) => (candidate.id === annotation.id ? annotation : candidate)));
    try {
      await updatePickup(projectId, annotation.id, {
        label: annotation.label,
        color: annotation.color,
        groupName: annotation.groupName,
        points: annotation.points,
        measurement: annotation.measurement,
        metadata: payload.metadata,
        lineThickness: annotation.thickness,
        visible: annotation.visible,
      });
    } catch {
      /* Keep the in-session update; a later reload will reconcile server state. */
    }
    notifyAnnotationsMutated();
  }

  async function undoTakeoffAction() {
    const command = undoStackRef.current.pop();
    if (!command) return;
    try {
      if (command.kind === "create") {
        await deletePickupLocal(command.annotation.id);
        redoStackRef.current.push(command);
      } else if (command.kind === "delete") {
        const restored = await recreatePickup(command.annotation);
        redoStackRef.current.push({ kind: "delete", annotation: restored });
      } else if (command.kind === "clear") {
        const restored: Pickup[] = [];
        for (const annotation of command.annotations) {
          restored.push(await recreatePickup(annotation));
        }
        redoStackRef.current.push({ kind: "clear", annotations: restored });
      } else if (command.kind === "update") {
        await updatePickupLocal(command.before);
        redoStackRef.current.push(command);
      } else if (command.kind === "calibration") {
        applyCalibrationDocCacheSnapshot(command.docId, command.beforeDocCache);
        redoStackRef.current.push(command);
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
        const recreated = await recreatePickup(command.annotation);
        undoStackRef.current.push({ kind: "create", annotation: recreated });
      } else if (command.kind === "delete") {
        await deletePickupLocal(command.annotation.id);
        undoStackRef.current.push(command);
      } else if (command.kind === "clear") {
        for (const annotation of command.annotations) {
          await deletePickupLocal(annotation.id);
        }
        undoStackRef.current.push(command);
      } else if (command.kind === "update") {
        await updatePickupLocal(command.after);
        undoStackRef.current.push(command);
      } else if (command.kind === "calibration") {
        applyCalibrationDocCacheSnapshot(command.docId, command.afterDocCache);
        undoStackRef.current.push(command);
      }
    } finally {
      updateTakeoffHistoryVersion();
    }
  }

  /* When annotation drawing is complete */
  async function handleAnnotationComplete(data: Partial<Pickup>) {
    const newAnnotation: Pickup = {
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
      setEditingPickupId(newAnnotation.id);
    }

    /* Cycle to next color for the next annotation */
    colorIndexRef.current = (colorIndexRef.current + 1) % COLOR_CYCLE.length;
    setActiveColor(COLOR_CYCLE[colorIndexRef.current]);

    /* Persist to API */
    try {
      const saved = await createPickup(projectId, annotationToApiPayload(newAnnotation));
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

  async function handleAutoCountSelection(data: Partial<Pickup>) {
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

        // Land the result directly in the Pickups panel as ONE row (one
        // bundled annotation with N points). The user reviews + promotes
        // to a worksheet line item from there — no floating confirm modal
        // blocking the canvas. If the matches are bad, delete the row and
        // redraw with a different template / threshold.
        await bundleAndSaveAutoCount({
          matches: result.matches,
          matchPoints,
          totalCount: result.totalCount,
          snippetImage: result.snippetImage ?? null,
        });
        setToastMessage(`Auto Count: ${result.totalCount} match${result.totalCount === 1 ? "" : "es"} added to Pickups.`);
        setToastType("success");
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

  async function handleAskAiSelection(data: Partial<Pickup>) {
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

  async function handleSmartCountSelection(data: Partial<Pickup>) {
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
    setSelectedSmartCountItemId(null);
    onOpenInspectEntities?.();
    postTakeoffMessage({ type: "open-inspect-entities" });

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
        .map((i, index) => ({
          id: crypto.randomUUID?.() ?? `smart-count-${Date.now()}-${index}`,
          label: i.label.trim(),
          count: Math.round(i.count),
          confidence: (i.confidence as SmartCountItem["confidence"]) ?? "medium",
          notes: typeof i.notes === "string" ? i.notes : "",
          pickupId: null,
        }));
      setSmartCountItems(cleanItems);
      setSmartCountIncluded(cleanItems.map(() => true));
      setSelectedSmartCountItemId(cleanItems[0]?.id ?? null);
      if (cleanItems.length === 0) {
        setSmartCountError("AI didn't find any countable items in this region.");
      }
    } catch (err) {
      console.error("Smart count failed:", err);
      setSmartCountError(err instanceof Error ? err.message : "Smart count failed.");
    } finally {
      setSmartCountRunning(false);
      setActiveTool("select");
    }
  }

  function focusVisionBoundingBox(bbox: VisionBoundingBox) {
    const container = viewerContainerRef.current;
    if (!container || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const scaleX = canvasSize.width / Math.max(1, bbox.imageWidth);
    const scaleY = canvasSize.height / Math.max(1, bbox.imageHeight);
    const box = {
      x: bbox.x * scaleX,
      y: bbox.y * scaleY,
      width: Math.max(28, bbox.width * scaleX),
      height: Math.max(28, bbox.height * scaleY),
    };
    const currentZoom = Math.max(zoomRef.current, 0.01);
    const targetZoom = roundPdfZoom(
      Math.min(
        6,
        Math.max(
          0.35,
          currentZoom * Math.min(
            (container.clientWidth * 0.62) / Math.max(box.width, 1),
            (container.clientHeight * 0.62) / Math.max(box.height, 1),
          ),
        ),
      ),
    );
    const ratio = targetZoom / currentZoom;
    const scroll = () => {
      container.scrollTo({
        left: Math.max(0, (box.x + box.width / 2) * ratio - container.clientWidth / 2),
        top: Math.max(0, (box.y + box.height / 2) * ratio - container.clientHeight / 2),
        behavior: "smooth",
      });
    };
    applyPdfZoom(targetZoom);
    requestAnimationFrame(scroll);
    window.setTimeout(scroll, 120);
  }

  function smartCountItemPoint(itemIndex: number, placedOffset = itemIndex): Point | null {
    if (!smartCountBbox) return null;
    const center: Point = {
      x: smartCountBbox.x + smartCountBbox.width / 2,
      y: smartCountBbox.y + smartCountBbox.height / 2,
    };
    return {
      x: center.x + (placedOffset % 4) * 18 - 27,
      y: center.y + Math.floor(placedOffset / 4) * 18 - 18,
    };
  }

  function handleSelectSmartCountItem(id: string | null) {
    setSelectedSmartCountItemId(id);
    if (id && smartCountBbox) focusVisionBoundingBox(smartCountBbox);
  }

  function handleToggleSmartCountItem(id: string) {
    if (!smartCountItems) return;
    const index = smartCountItems.findIndex((item) => item.id === id);
    if (index < 0) return;
    setSmartCountIncluded((current) => {
      const next = [...current];
      next[index] = !next[index];
      return next;
    });
  }

  async function saveSmartCountItemAsAnnotation(id: string): Promise<Pickup | null> {
    if (!smartCountItems || !smartCountBbox || !selectedDoc) return null;
    const index = smartCountItems.findIndex((item) => item.id === id);
    const item = index >= 0 ? smartCountItems[index] : null;
    if (!item) return null;
    if (item.pickupId) {
      const existing = annotations.find((annotation) => annotation.id === item.pickupId);
      if (existing) return existing;
    }
    const point = smartCountItemPoint(index, index);
    if (!point) return null;

    const color = COLOR_CYCLE[colorIndexRef.current % COLOR_CYCLE.length];
    colorIndexRef.current += 1;
    const localAnnotation: Pickup = {
      id: crypto.randomUUID(),
      type: "count",
      label: `${item.label} (x${item.count})`,
      color,
      thickness: 5,
      points: [point],
      visible: true,
      groupName: "Smart Count",
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      measurement: { value: item.count, unit: "count" },
      opts: {
        smartCountItemId: item.id,
        smartCountLabel: item.label,
        smartCountConfidence: item.confidence,
        smartCountBbox,
      } as unknown as Pickup["opts"],
    };

    setSmartCountSavingId(id);
    setAnnotations((prev) => [...prev, localAnnotation]);
    let finalAnnotation = localAnnotation;
    try {
      const saved = await createPickup(projectId, annotationToApiPayload(localAnnotation));
      finalAnnotation = mapSavedAnnotation(saved, localAnnotation);
      setAnnotations((prev) =>
        prev.map((annotation) => (annotation.id === localAnnotation.id ? finalAnnotation : annotation)),
      );
    } catch (err) {
      console.error("[smart-count] Failed to persist annotation:", err);
    } finally {
      pushTakeoffHistory({ kind: "create", annotation: finalAnnotation });
      setSmartCountItems((current) =>
        current?.map((candidate) =>
          candidate.id === id ? { ...candidate, pickupId: finalAnnotation.id } : candidate,
        ) ?? null,
      );
      setSmartCountSavingId(null);
      notifyAnnotationsMutated();
    }
    return finalAnnotation;
  }

  async function handleSaveSelectedSmartCountItems() {
    if (!smartCountItems) return;
    let savedCount = 0;
    for (let i = 0; i < smartCountItems.length; i++) {
      if (!smartCountIncluded[i]) continue;
      const annotation = await saveSmartCountItemAsAnnotation(smartCountItems[i]!.id);
      if (annotation) savedCount += 1;
    }
    if (savedCount > 0) {
      setToastMessage(`Saved ${savedCount} Smart Count row${savedCount === 1 ? "" : "s"} as takeoff marks.`);
      setToastType("success");
    }
  }

  async function handleCreateSmartCountItemLineItem(id: string, pick: InspectCategoryPick) {
    try {
      const annotation = await saveSmartCountItemAsAnnotation(id);
      if (!annotation) return;
      const created = await createLineItemFromAnnotation(annotation, pick);
      if (!created) return;
      await loadPickupLinks();
      notifyWorkspaceMutated();
      notifyPickupLinksMutated();
      setToastType("success");
      setToastMessage("Created line item from Smart Count row.");
    } catch (error) {
      console.error("[smart-count] Failed to create line item:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a line item from that Smart Count row."));
    }
  }

  function handleClearSmartCountResults() {
    setSmartCountItems(null);
    setSmartCountBbox(null);
    setSmartCountCropImage(null);
    setSmartCountError(null);
    setSelectedSmartCountItemId(null);
    setSmartCountSavingId(null);
  }

  function handleDeleteSmartCountItem(id: string) {
    const index = smartCountItems?.findIndex((item) => item.id === id) ?? -1;
    if (index < 0) return;
    setSmartCountItems((current) => current?.filter((item) => item.id !== id) ?? null);
    setSmartCountIncluded((included) => included.filter((_, includedIndex) => includedIndex !== index));
    if (selectedSmartCountItemId === id) setSelectedSmartCountItemId(null);
    if (smartCountSavingId === id) setSmartCountSavingId(null);
    setToastType("success");
    setToastMessage("Deleted Smart Count row from the review list.");
  }

  function smartCountSnapshotItems() {
    if (!smartCountItems) return [];
    return smartCountItems.map((item, index) => {
      const pickupId = item.pickupId ?? null;
      const isLinked = pickupId ? pickupLinks.some((link) => link.pickupId === pickupId) : false;
      return {
        id: item.id,
        label: item.label,
        count: item.count,
        confidence: item.confidence,
        notes: item.notes,
        included: smartCountIncluded[index] ?? true,
        isSaved: Boolean(pickupId),
        isLinked,
        pickupId,
        bbox: smartCountBbox,
      };
    });
  }

  function shouldPublishSmartCountSnapshot(mode: InspectSnapshot["mode"]): boolean {
    return Boolean(mode === "pdf" && selectedDoc && (smartCountRunning || smartCountError || smartCountBbox || smartCountItems || smartCountCropImage));
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

  /** Bundle an Auto Count run into ONE Pickup with all match
   *  positions as `points` and the per-match bboxes / confidences in
   *  metadata. Replaces the previous N-annotations-per-run approach that
   *  exploded the Pickups list — the user explicitly asked for one row per
   *  unique symbol with a quantity, not one row per match. The Pickups
   *  panel renders the row with the template thumbnail + count badge; the
   *  worksheet line item created from this row carries quantity = count.
   *
   *  Scope-aware: page-level runs include per-match coords (so the canvas
   *  can highlight each instance + the user can deselect false positives).
   *  Document- or all-document runs only carry aggregate counts since the
   *  underlying batch API returns per-page totals, not per-match coords —
   *  we still produce ONE bundled Pickup row so the unified-flow promise
   *  holds. */
  async function bundleAndSaveAutoCount(payload: {
    matches: VisionMatch[];
    matchPoints: Point[];
    totalCount: number;
    snippetImage: string | null;
    /** "page" (default) = matches are on the current page; "document" =
     *  per-page rollup with no per-match coords; "all" = per-document
     *  rollup with no per-match coords. */
    scope?: "page" | "document" | "all";
    /** Per-page counts when scope === "document" (multi-page rollup). */
    perPage?: Array<{ page: number; count: number }>;
    /** Per-document counts when scope === "all" (multi-doc rollup). */
    perDoc?: Array<{ docId: string; docLabel: string; total: number }>;
  }) {
    if (payload.totalCount === 0 || !selectedDocId) return;
    const scope = payload.scope ?? "page";
    const groupId = crypto.randomUUID().slice(0, 8);
    const groupName =
      scope === "document" ? `Auto Count (doc) ${groupId}` :
      scope === "all" ? `Auto Count (all) ${groupId}` :
      `Auto Count ${groupId}`;
    const matchRecords = payload.matches.map((m, idx) => ({
      rect: m.rect,
      confidence: m.confidence,
      image: m.image ?? null,
      pointIndex: idx,
    }));
    const localAnn: Pickup = {
      id: crypto.randomUUID(),
      type: "count",
      label: groupName,
      color: "#22c55e",
      thickness: 4,
      points: payload.matchPoints,
      visible: true,
      groupName,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      measurement: { value: payload.totalCount, unit: "count" },
      metadata: {
        source: "auto-count",
        scope,
        templateImage: payload.snippetImage ?? undefined,
        matches: matchRecords,
        matchCount: payload.totalCount,
        perPage: payload.perPage,
        perDoc: payload.perDoc,
      },
    };
    setAnnotations((prev) => [...prev, localAnn]);
    try {
      const saved = await createPickup(projectId, {
        documentId: selectedDocId,
        pageNumber: page,
        annotationType: "count",
        label: localAnn.label,
        color: localAnn.color,
        lineThickness: localAnn.thickness,
        visible: true,
        groupName,
        points: localAnn.points,
        measurement: localAnn.measurement ?? {},
        metadata: {
          canvasWidth: localAnn.canvasWidth,
          canvasHeight: localAnn.canvasHeight,
          source: "auto-count",
          scope,
          templateImage: payload.snippetImage ?? undefined,
          matches: matchRecords,
          matchCount: payload.totalCount,
          perPage: payload.perPage,
          perDoc: payload.perDoc,
        },
      });
      if (saved?.id) {
        setAnnotations((prev) =>
          prev.map((a) => (a.id === localAnn.id ? { ...a, id: saved.id } : a)),
        );
      }
    } catch {
      /* local-only is OK; user can retry */
    }
    notifyAnnotationsMutated();
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
      await bundleAndSaveAutoCount({
        matches: [],
        matchPoints: [],
        totalCount: result.grandTotal,
        snippetImage: autoCountSnippet ?? null,
        scope: "document",
        perPage: results,
      });
      setToastMessage(`Auto Count (all pages): ${result.grandTotal} added to Pickups.`);
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
      await bundleAndSaveAutoCount({
        matches: [],
        matchPoints: [],
        totalCount: total,
        snippetImage: autoCountSnippet ?? null,
        scope: "all",
        perDoc: results,
      });
      setToastMessage(`Auto Count (all drawings): ${total} added to Pickups.`);
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
    setActiveTool("select");
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
    setSavedLegendKeys(new Set());
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

  /** Refresh the Symbol Library badge count from the server. */
  const refreshLibraryCount = useCallback(async () => {
    if (!projectId) return;
    try {
      const result = await listSymbolTemplates(projectId);
      setLibraryCount(result.templates.length);
    } catch {
      // Non-fatal — the badge just won't update.
    }
  }, [projectId]);

  useEffect(() => {
    void refreshLibraryCount();
  }, [refreshLibraryCount]);

  /**
   * Crop a legend entry's glyph and persist it as a SymbolTemplate. Idempotent
   * from the UI's perspective — clicking twice creates two rows server-side,
   * so the inline "saved" indicator suppresses the second click.
   */
  async function handleSaveLegendEntryToLibrary(entry: LegendEntryRecord, index: number) {
    if (!selectedDoc) return;
    if (!entry.symbolBbox) {
      setToastType("error");
      setToastMessage("This legend entry has no glyph bbox — open the page in the takeoff canvas and capture the symbol manually.");
      return;
    }
    const docId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;
    const key = `${entry.symbol}-${index}`;
    setSavingLegendKey(key);
    try {
      const template = await createSymbolTemplateFromLegendEntry(projectId, {
        documentId: docId,
        pageNumber: entry.pageNumber,
        entry,
      });
      setSavedLegendKeys((cur) => {
        const next = new Set(cur);
        next.add(key);
        return next;
      });
      setLibraryCount((cur) => (cur ?? 0) + 1);
      setToastType("success");
      setToastMessage(`Saved "${template.symbol || template.label}" to the project Symbol Library.`);
    } catch (err) {
      setToastType("error");
      setToastMessage(err instanceof Error ? err.message : "Save to library failed");
    } finally {
      setSavingLegendKey(null);
    }
  }

  function selectedVisionDocumentId() {
    if (!selectedDoc) return "";
    return selectedDoc.source === "knowledge" && selectedDoc.bookId ? selectedDoc.bookId : selectedDoc.id;
  }

  async function handleRunDrawingAnalysis() {
    if (!selectedDoc || !isPdfDocument) return;
    const docId = selectedVisionDocumentId();
    if (!docId) return;

    onOpenInspectEntities?.();
    postTakeoffMessage({ type: "open-inspect-entities" });
    setDrawingAnalysisRunning(true);
    setDrawingAnalysisError(null);
    setSelectedDrawingDetectionId(null);

    try {
      const result = await analyzeDrawingGeometry({
        projectId,
        documentId: docId,
        pageNumber: page,
        preset: drawingAnalysisSettings.preset,
        geometrySource: drawingAnalysisSettings.geometrySource,
        traceSystems: drawingAnalysisSettings.traceSystems,
        includeSymbols: drawingAnalysisSettings.includeSymbols,
        includeTextRegions: drawingAnalysisSettings.includeTextRegions,
        includeCircles: drawingAnalysisSettings.includeCircles,
        maxLines: drawingAnalysisSettings.maxLines,
        maxRegions: drawingAnalysisSettings.maxRegions,
        minLineLength: drawingAnalysisSettings.minLineLength > 0 ? drawingAnalysisSettings.minLineLength : undefined,
        snapTolerance: drawingAnalysisSettings.snapTolerance > 0 ? drawingAnalysisSettings.snapTolerance : undefined,
        lineSensitivity: drawingAnalysisSettings.lineSensitivity,
        noiseRejection: drawingAnalysisSettings.noiseRejection,
      });

      setDrawingAnalysisResult(result);
      postTakeoffMessage({ type: "drawing-analysis-result", docId, page, analysis: result });
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

  function drawingDetectionBounds(id: string): { x: number; y: number; width: number; height: number } | null {
    const result = drawingAnalysisResult;
    if (!result) return null;
    const system = result.systems.find((item) => item.id === id);
    if (system?.bbox) return system.bbox;
    const line = result.lines.find((item) => item.id === id);
    if (line?.bbox) return line.bbox;
    const symbol = result.symbolCandidates.find((item) => item.id === id);
    if (symbol) return { x: symbol.x, y: symbol.y, width: symbol.w, height: symbol.h };
    const circle = result.circles.find((item) => item.id === id);
    if (circle?.bbox) return circle.bbox;
    const text = result.textRegions.find((item) => item.id === id);
    if (text) return { x: text.x, y: text.y, width: text.w, height: text.h };
    // Phase-2 vector primitives. Their params are in PDF-point coords;
    // project to image-pixel space (the bounds-return contract) via the
    // analysis's coordinateSpace so focusDrawingBounds scrolls correctly.
    const primitive = result.primitives?.find((item) => item.id === id);
    if (primitive) {
      const cs = result.coordinateSpace;
      const px = cs?.imagePixelPerPdfPointX ?? 1;
      const py = cs?.imagePixelPerPdfPointY ?? 1;
      const bounds = primitiveScaledBounds(primitive, px, py);
      if (bounds) return bounds;
    }
    return null;
  }

  function drawingDetectionAnnotations(id: string): Pickup[] {
    return annotations.filter((annotation) => {
      const metadata = (annotation.opts ?? {}) as Record<string, unknown>;
      return metadata.detectionId === id || metadata.systemId === id;
    });
  }

  function drawingDetectionGroupBounds(ids: string[]): { x: number; y: number; width: number; height: number } | null {
    const boxes = ids
      .map((id) => drawingDetectionBounds(id))
      .filter((box): box is { x: number; y: number; width: number; height: number } => Boolean(box));
    if (boxes.length === 0) return null;
    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  function drawingAnalysisPaperScale() {
    const result = drawingAnalysisResult;
    if (!result) return { x: 1, y: 1 };
    const currentZoom = Math.max(zoomRef.current, 0.0001);
    const baseWidth = canvasSize.width > 0 ? canvasSize.width / currentZoom : result.imageWidth;
    const baseHeight = canvasSize.height > 0 ? canvasSize.height / currentZoom : result.imageHeight;
    return {
      x: baseWidth / Math.max(result.imageWidth, 1),
      y: baseHeight / Math.max(result.imageHeight, 1),
    };
  }

  function drawingAnalysisCalibrationSnapshot() {
    if (!calibration || calibration.pixelsPerUnit <= 0) return null;
    const scale = drawingAnalysisPaperScale();
    return {
      unit: calibration.unit,
      pixelsPerUnit: calibration.pixelsPerUnit,
      analysisToPaperScaleX: scale.x,
      analysisToPaperScaleY: scale.y,
    };
  }

  function drawingAnalysisPaperLength(points: Point[]) {
    const scale = drawingAnalysisPaperScale();
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const prev = points[index - 1]!;
      const point = points[index]!;
      total += Math.hypot((point.x - prev.x) * scale.x, (point.y - prev.y) * scale.y);
    }
    return total;
  }

  function calibratedDrawingMeasurement(points: Point[], analysisLengthPx?: number) {
    const paperLengthPx = drawingAnalysisPaperLength(points);
    if (calibration && calibration.pixelsPerUnit > 0) {
      const value = Math.round((paperLengthPx / calibration.pixelsPerUnit) * 100) / 100;
      return {
        measurement: { value, unit: calibration.unit } satisfies Pickup["measurement"],
        metadata: {
          measurementBasis: "calibrated_pdf_scale",
          analysisLengthPx,
          paperLengthPx: Math.round(paperLengthPx * 100) / 100,
          calibrationUnit: calibration.unit,
          pixelsPerUnit: calibration.pixelsPerUnit,
        },
      };
    }
    return {
      measurement: undefined,
      metadata: {
        measurementBasis: "requires_pdf_scale",
        requiresCalibration: true,
        analysisLengthPx,
        paperLengthPx: Math.round(paperLengthPx * 100) / 100,
      },
    };
  }

  /**
   * Area-domain sibling of calibratedDrawingMeasurement. Closed primitives
   * (circle / ellipse / full-sweep arc / rect) save as `area-polygon`
   * annotations — the schema's invariant is that area-polygon's
   * measurement.value carries the AREA (in squared units), not the
   * perimeter. Without this helper, handleSaveDrawingPrimitive would put
   * the polyline length into an area-polygon annotation, and the
   * downstream WorksheetItem would receive perimeter where the user
   * expects area.
   *
   * Conversion pipeline mirrors calibratedDrawingMeasurement but quadratic:
   *   image-pixel² → paper-pixel² (×scale.x × scale.y)
   *                → real-world² (÷ pixelsPerUnit²).
   */
  function calibratedDrawingAreaMeasurement(points: Point[]) {
    if (points.length < 3) {
      return {
        measurement: undefined,
        metadata: { measurementBasis: "polygon_too_few_points" as const },
      };
    }
    // Shoelace area in image-pixel² space. Same formula used by
    // dwg-takeoff-surface.tsx's polygonArea and apps/web/lib/takeoff-math.ts
    // — kept inline to avoid a cross-package round-trip just for one
    // determinant.
    let canvasAreaPx2 = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      canvasAreaPx2 += a.x * b.y - b.x * a.y;
    }
    canvasAreaPx2 = Math.abs(canvasAreaPx2) / 2;
    const scale = drawingAnalysisPaperScale();
    const paperAreaPx2 = canvasAreaPx2 * scale.x * scale.y;
    if (calibration && calibration.pixelsPerUnit > 0) {
      const realArea = paperAreaPx2 / (calibration.pixelsPerUnit * calibration.pixelsPerUnit);
      const value = Math.round(realArea * 100) / 100;
      return {
        measurement: {
          // value + area both carry the area number — matches the
          // user-drawn `area-polygon` convention in apps/web/lib/takeoff-math.ts:
          // computeMeasurement returns { value, unit, area } where value === area.
          value,
          unit: `${calibration.unit}²`,
          area: value,
        } satisfies Pickup["measurement"],
        metadata: {
          measurementBasis: "calibrated_pdf_area" as const,
          canvasAreaPx2: Math.round(canvasAreaPx2 * 100) / 100,
          paperAreaPx2: Math.round(paperAreaPx2 * 100) / 100,
          calibrationUnit: calibration.unit,
          pixelsPerUnit: calibration.pixelsPerUnit,
        },
      };
    }
    return {
      measurement: undefined,
      metadata: {
        measurementBasis: "requires_pdf_scale" as const,
        requiresCalibration: true,
        canvasAreaPx2: Math.round(canvasAreaPx2 * 100) / 100,
      },
    };
  }

  function scrollDrawingBoundsIntoView(
    bounds: { x: number; y: number; width: number; height: number },
    behavior: ScrollBehavior = "smooth",
  ) {
    if (!drawingAnalysisResult) return;
    const container = viewerContainerRef.current;
    if (!container || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const canvas = pdfCanvasRef.current;
    const renderedWidth = canvas?.width && canvas.width > 0 ? canvas.width : canvasSize.width;
    const renderedHeight = canvas?.height && canvas.height > 0 ? canvas.height : canvasSize.height;
    const scaleX = renderedWidth / Math.max(1, drawingAnalysisResult.imageWidth);
    const scaleY = renderedHeight / Math.max(1, drawingAnalysisResult.imageHeight);
    const box = {
      x: bounds.x * scaleX,
      y: bounds.y * scaleY,
      width: Math.max(24, bounds.width * scaleX),
      height: Math.max(24, bounds.height * scaleY),
    };
    container.scrollTo({
      left: Math.max(0, box.x + box.width / 2 - container.clientWidth / 2),
      top: Math.max(0, box.y + box.height / 2 - container.clientHeight / 2),
      behavior,
    });
  }

  function focusDrawingBounds(bounds: { x: number; y: number; width: number; height: number }) {
    if (!drawingAnalysisResult) return;
    const container = viewerContainerRef.current;
    if (!container || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const canvas = pdfCanvasRef.current;
    const renderedWidth = canvas?.width && canvas.width > 0 ? canvas.width : canvasSize.width;
    const renderedHeight = canvas?.height && canvas.height > 0 ? canvas.height : canvasSize.height;
    const currentZoom = Math.max(zoomRef.current, 0.01);
    const baseWidth = renderedWidth / currentZoom;
    const baseHeight = renderedHeight / currentZoom;
    const baseScaleX = baseWidth / Math.max(1, drawingAnalysisResult.imageWidth);
    const baseScaleY = baseHeight / Math.max(1, drawingAnalysisResult.imageHeight);
    const baseBox = {
      width: Math.max(24, bounds.width * baseScaleX),
      height: Math.max(24, bounds.height * baseScaleY),
    };
    // Skip the zoom change when the bounds are already comfortably visible at
    // the current zoom. The PDF.js rasterise pass that follows applyPdfZoom is
    // expensive (5400x3600 image rebake) — user TEST A: "performance
    // switching between entities where pdf zooms and moves is not
    // acceptable". By keeping current zoom when it's "fine", we only pay the
    // scroll cost on most clicks.
    const renderedBoxW = baseBox.width * currentZoom;
    const renderedBoxH = baseBox.height * currentZoom;
    const viewportW = container.clientWidth;
    const viewportH = container.clientHeight;
    const viewportFractionW = renderedBoxW / Math.max(viewportW, 1);
    const viewportFractionH = renderedBoxH / Math.max(viewportH, 1);
    const fits = viewportFractionW >= 0.08 && viewportFractionW <= 0.85
              && viewportFractionH >= 0.08 && viewportFractionH <= 0.85;
    let zoomChanged = false;
    if (!fits) {
      const targetZoom = roundPdfZoom(
        Math.min(
          6,
          Math.max(
            0.35,
            Math.min(
              (viewportW * 0.58) / Math.max(baseBox.width, 1),
              (viewportH * 0.58) / Math.max(baseBox.height, 1),
            ),
          ),
        ),
      );
      if (Math.abs(targetZoom - currentZoom) >= 0.05) {
        applyPdfZoom(targetZoom);
        zoomChanged = true;
      }
    }
    pendingDrawingFocusBoundsRef.current = bounds;
    // After a zoom change PDF.js needs ~one frame to repaint; do a follow-up
    // scroll. Without zoom change, the immediate scroll is enough.
    scrollDrawingBoundsIntoView(bounds);
    if (zoomChanged) {
      requestAnimationFrame(() => scrollDrawingBoundsIntoView(bounds));
    }
  }

  useEffect(() => {
    const bounds = pendingDrawingFocusBoundsRef.current;
    if (!bounds || !drawingAnalysisResult || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const frame = requestAnimationFrame(() => {
      scrollDrawingBoundsIntoView(bounds);
      pendingDrawingFocusBoundsRef.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [canvasSize.width, canvasSize.height, drawingAnalysisResult]);

  function focusAnnotationSelection(id: string) {
    const annotation = annotations.find((item) => item.id === id);
    const container = viewerContainerRef.current;
    if (!annotation || !container || canvasSize.width <= 0 || canvasSize.height <= 0) return;
    const scaleX = annotation.canvasWidth ? canvasSize.width / annotation.canvasWidth : 1;
    const scaleY = annotation.canvasHeight ? canvasSize.height / annotation.canvasHeight : 1;
    const points = annotation.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
    if (points.length === 0) return;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const box = {
      x: minX,
      y: minY,
      width: Math.max(28, maxX - minX),
      height: Math.max(28, maxY - minY),
    };
    const currentZoom = Math.max(zoomRef.current, 0.01);
    const targetZoom = roundPdfZoom(
      Math.min(
        6,
        Math.max(
          0.35,
          currentZoom * Math.min(
            (container.clientWidth * 0.58) / Math.max(box.width, 1),
            (container.clientHeight * 0.58) / Math.max(box.height, 1),
          ),
        ),
      ),
    );
    const ratio = targetZoom / currentZoom;
    // Skip the zoom rebake if the annotation is already comfortably visible
    // (same motivation as focusDrawingBounds — PDF.js rasterise is the
    // expensive part of switching entities). Also use instant scroll instead
    // of smooth, because the prior 150ms smooth-scroll animation stacked on
    // top of the rasterise cost made every click feel laggy.
    const viewportFractionW = (box.width * currentZoom) / Math.max(container.clientWidth, 1);
    const viewportFractionH = (box.height * currentZoom) / Math.max(container.clientHeight, 1);
    const fits = viewportFractionW >= 0.08 && viewportFractionW <= 0.85
              && viewportFractionH >= 0.08 && viewportFractionH <= 0.85;
    const effectiveRatio = fits ? 1 : ratio;
    const scroll = () => {
      container.scrollTo({
        left: Math.max(0, (box.x + box.width / 2) * effectiveRatio - container.clientWidth / 2),
        top: Math.max(0, (box.y + box.height / 2) * effectiveRatio - container.clientHeight / 2),
        behavior: "auto",
      });
    };
    if (!fits && Math.abs(targetZoom - currentZoom) >= 0.05) {
      applyPdfZoom(targetZoom);
      requestAnimationFrame(scroll);
    } else {
      scroll();
    }
  }

  useEffect(() => {
    if (!selectedPickupId || !isPdfDocument) return;
    focusAnnotationSelection(selectedPickupId);
  }, [selectedPickupId, annotations, isPdfDocument, canvasSize.width, canvasSize.height]);

  function handleSelectDrawingDetection(id: string | null) {
    setSelectedDrawingDetectionId(id);
    if (selectedDocId) {
      postTakeoffMessage({ type: "drawing-detection-selection", docId: selectedDocId, page, detectionId: id });
    }
    if (!id) return;
    const bounds = drawingDetectionBounds(id);
    if (bounds) focusDrawingBounds(bounds);
  }

  function handleSelectDrawingDetectionGroup(ids: string[]) {
    const firstId = ids[0] ?? null;
    setSelectedDrawingDetectionId(firstId);
    if (selectedDocId) {
      postTakeoffMessage({ type: "drawing-detection-selection", docId: selectedDocId, page, detectionId: firstId });
    }
    const bounds = drawingDetectionGroupBounds(ids);
    if (bounds) focusDrawingBounds(bounds);
  }

  function handleDeleteDrawingDetection(id: string, kind: InspectDrawingDetectionKind) {
    const next = removeDrawingAnalysisEntity(drawingAnalysisResult, id, kind);
    if (next === drawingAnalysisResult) return;
    setDrawingAnalysisResult(next);
    if (selectedDrawingDetectionId === id) {
      setSelectedDrawingDetectionId(null);
      if (selectedDocId) {
        postTakeoffMessage({ type: "drawing-detection-selection", docId: selectedDocId, page, detectionId: null });
      }
    }
    if (selectedDocId) {
      postTakeoffMessage({ type: "drawing-analysis-result", docId: selectedDocId, page, analysis: next });
    }
    setToastType("success");
    setToastMessage("Deleted detected entity from this analysis run.");
  }

  function handleDeleteDrawingDetectionGroup(ids: string[], kind: InspectDrawingDetectionKind) {
    const idSet = new Set(ids);
    if (idSet.size === 0 || !drawingAnalysisResult) return;
    const next = updateDrawingAnalysisSummary({
      ...drawingAnalysisResult,
      symbolCandidates: kind === "symbol"
        ? drawingAnalysisResult.symbolCandidates.filter((candidate) => !idSet.has(candidate.id))
        : drawingAnalysisResult.symbolCandidates,
      textRegions: kind === "text"
        ? drawingAnalysisResult.textRegions.filter((region) => !idSet.has(region.id))
        : drawingAnalysisResult.textRegions,
    });
    setDrawingAnalysisResult(next);
    if (selectedDrawingDetectionId && idSet.has(selectedDrawingDetectionId)) {
      setSelectedDrawingDetectionId(null);
      if (selectedDocId) {
        postTakeoffMessage({ type: "drawing-detection-selection", docId: selectedDocId, page, detectionId: null });
      }
    }
    if (selectedDocId) {
      postTakeoffMessage({ type: "drawing-analysis-result", docId: selectedDocId, page, analysis: next });
    }
    setToastType("success");
    setToastMessage(`Deleted ${idSet.size} detected ${kind === "symbol" ? "count candidates" : "entities"} from this analysis run.`);
  }

  useEffect(() => {
    const id = pendingDrawingFocusRef.current;
    if (!id || selectedDrawingDetectionId !== id || !drawingAnalysisResult) return;
    const bounds = drawingDetectionBounds(id);
    if (!bounds) return;
    pendingDrawingFocusRef.current = null;
    focusDrawingBounds(bounds);
  }, [selectedDrawingDetectionId, drawingAnalysisResult, canvasSize.width, canvasSize.height, zoom]);

  function makeDrawingFallbackAnnotation(input: {
    id: string;
    type: string;
    label: string;
    color: string;
    thickness?: number;
    groupName?: string;
    points: Point[];
    measurement?: Pickup["measurement"];
    opts?: Record<string, unknown>;
  }): Pickup {
    return {
      id: input.id,
      type: input.type,
      label: input.label,
      color: input.color,
      thickness: input.thickness ?? 3,
      points: input.points,
      visible: true,
      groupName: input.groupName,
      measurement: input.measurement,
      canvasWidth: drawingAnalysisResult?.imageWidth,
      canvasHeight: drawingAnalysisResult?.imageHeight,
      opts: input.opts as Pickup["opts"],
    };
  }

  function mapSavedDrawingAnnotations(saved: unknown[], fallbacks: Pickup[]) {
    return saved.map((annotation, index) => mapSavedAnnotation(annotation, fallbacks[index] ?? fallbacks[0]));
  }

  async function handleSaveDrawingDetection(
    id: string,
    kind: "system" | "symbol" | "circle" | "line" | "arc" | "curve",
    options: { toast?: boolean } = {},
  ): Promise<Pickup[]> {
    const result = drawingAnalysisResult;
    if (!result) return [];
    if (kind === "system") {
      const system = result.systems.find((item) => item.id === id);
      return system ? handleSaveDrawingSystem(system, options) : [];
    }
    if (kind === "symbol") {
      const symbol = result.symbolCandidates.find((item) => item.id === id);
      return symbol ? handleSaveDrawingSymbol(symbol, options) : [];
    }
    if (kind === "circle") {
      const circle = result.circles.find((item) => item.id === id);
      return circle ? handleSaveDrawingCircle(circle, options) : [];
    }
    if (kind === "arc" || kind === "curve") {
      // Phase-2 primitive: arcs / circles / ellipses (kind=arc) and cubic /
      // quad beziers (kind=curve) come from analysis.primitives, get
      // sampled to polylines, and ride the same Pickup pipeline
      // as the other detections.
      const primitive = (result.primitives ?? []).find((item) => item.id === id);
      return primitive ? handleSaveDrawingPrimitive(primitive, kind, options) : [];
    }
    const line = result.lines.find((item) => item.id === id);
    return line ? handleSaveDrawingLine(line, options) : [];
  }

  /**
   * Persist a canonical PDF primitive (arc / circle / ellipse / bezier) as
   * a Pickup. Coordinate flow:
   *   1. Sample the primitive in PDF-point space via samplePdfPrimitive
   *   2. Project each sample to image-pixel space using coordinateSpace
   *      (the same coord space every other detection lives in)
   *   3. Wrap as a `linear-polyline` or `area-polygon` annotation
   *   4. Compute the calibrated real-world measurement via
   *      calibratedDrawingMeasurement (same path as systems/lines).
   * The annotation persists with full primitive provenance in metadata so
   * downstream consumers can tell a saved annotation came from a canonical
   * primitive vs a sampled-line detection.
   */
  async function handleSaveDrawingPrimitive(
    primitive: NonNullable<DrawingGeometryAnalysisResult["primitives"]>[number],
    kind: "arc" | "curve",
    options: { toast?: boolean } = {},
  ): Promise<Pickup[]> {
    if (!drawingAnalysisResult || !selectedDoc) return [];
    const docId = selectedVisionDocumentId();
    setDrawingAnalysisSavingId(primitive.id);
    try {
      const cs = drawingAnalysisResult.coordinateSpace;
      const sx = cs?.imagePixelPerPdfPointX ?? 1;
      const sy = cs?.imagePixelPerPdfPointY ?? 1;
      const pdfPoints = samplePdfPrimitive(primitive);
      if (pdfPoints.length < 2) return [];
      const points: Point[] = pdfPoints.map((p) => ({ x: p.x * sx, y: p.y * sy }));
      const closed = isPrimitiveClosed(primitive);
      // Closed primitives become area-polygon annotations so estimators
      // can drop them into SF/SM line items; open primitives stay as
      // linear-polylines for LF takeoff.
      const annotationType = closed ? "area-polygon" : "linear-polyline";
      const groupName = kind === "arc"
        ? "Drawing Intelligence Vector Arcs"
        : "Drawing Intelligence Vector Curves";
      const color = kind === "arc" ? "#f59e0b" : "#a855f7";
      const label = kind === "arc"
        ? primitive.kind === "circle"
          ? "Detected vector circle"
          : primitive.kind === "ellipse"
            ? "Detected vector ellipse"
            : "Detected vector arc"
        : primitive.kind === "quad_bezier"
          ? "Detected quadratic curve"
          : "Detected cubic curve";

      // Use the area-domain calibration helper for closed primitives so
      // the area-polygon annotation actually carries an AREA in
      // measurement.value (matching the convention used by every
      // user-drawn area-polygon). Open primitives (arcs, beziers) stay on
      // the length-domain helper — for them the polyline length IS the
      // takeoff quantity. Both helpers return identical
      // { measurement, metadata } shape so the rest of this function
      // doesn't care which one ran.
      const calibrated = closed
        ? calibratedDrawingAreaMeasurement(points)
        : calibratedDrawingMeasurement(points);
      const fallback = makeDrawingFallbackAnnotation({
        id: primitive.id,
        type: annotationType,
        label,
        color,
        thickness: 3,
        groupName,
        points,
        measurement: calibrated.measurement,
        opts: {
          sourceTool: "drawing-intelligence",
          analysisId: drawingAnalysisResult.analysisId,
          preset: drawingAnalysisPreset,
          detectionId: primitive.id,
          primitiveKind: primitive.kind,
          primitiveLayer: primitive.layer,
          primitivePaint: primitive.paint,
          ...calibrated.metadata,
        },
      });
      const result = await saveDrawingDetectionsAsAnnotations({
        projectId,
        documentId: docId,
        pageNumber: page,
        imageWidth: drawingAnalysisResult.imageWidth,
        imageHeight: drawingAnalysisResult.imageHeight,
        analysisId: drawingAnalysisResult.analysisId,
        groupName,
        color,
        detections: [{
          id: primitive.id,
          kind: kind === "arc" ? "vector_arc" : "vector_curve",
          label,
          annotationType,
          groupName,
          color,
          lineThickness: 3,
          points,
          source: "drawing-intelligence",
          measurement: calibrated.measurement,
          metadata: {
            sourceTool: "drawing-intelligence",
            analysisId: drawingAnalysisResult.analysisId,
            preset: drawingAnalysisPreset,
            detectionId: primitive.id,
            primitiveKind: primitive.kind,
            primitiveParams: primitive.params,
            primitiveLayer: primitive.layer,
            primitivePaint: primitive.paint,
            ...calibrated.metadata,
          },
        }],
      });
      const saved = mapSavedDrawingAnnotations(result.annotations, [fallback]);
      await loadAnnotationsRef.current();
      notifyAnnotationsMutated();
      if (options.toast !== false) {
        setToastMessage(`Saved ${result.savedCount} ${kind === "arc" ? "vector arc" : "vector curve"} to takeoff.`);
        setToastType("success");
      }
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : `Could not save ${kind}`;
      setToastMessage(message);
      setToastType("error");
      return [];
    } finally {
      setDrawingAnalysisSavingId(null);
    }
  }

  async function handleSaveDrawingSystem(
    system: DrawingTracedSystem,
    options: { toast?: boolean } = {},
  ): Promise<Pickup[]> {
    if (!drawingAnalysisResult || !selectedDoc) return [];
    const docId = selectedVisionDocumentId();
    const segments = drawingSystemSegments(system);
    if (segments.length === 0) return [];

    setDrawingAnalysisSavingId(system.id);
    try {
      const groupName = `${system.label} (${drawingAnalysisPreset})`;
      const detections = segments.map((segment) => {
        const points = [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }];
        const calibrated = calibratedDrawingMeasurement(points, segment.lengthPx);
        return {
          id: segment.id,
          kind: "line_segment",
          label: system.label,
          annotationType: "linear",
          groupName,
          color: "#0ea5e9",
          lineThickness: 3,
          points,
          confidence: Math.min(system.confidence, segment.confidence),
          source: "drawing-intelligence",
          measurement: calibrated.measurement,
          metadata: {
            sourceTool: "drawing-intelligence",
            analysisId: drawingAnalysisResult.analysisId,
            preset: drawingAnalysisPreset,
            detectionId: segment.id,
            systemId: system.id,
            systemLengthPx: system.lengthPx,
            systemCounts: system.counts,
            savedSegmentCount: segments.length,
            ...calibrated.metadata,
          },
        };
      });
      const fallbacks = segments.map((segment) => {
        const points = [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }];
        const calibrated = calibratedDrawingMeasurement(points, segment.lengthPx);
        return makeDrawingFallbackAnnotation({
          id: segment.id,
          type: "linear",
          label: system.label,
          color: "#0ea5e9",
          thickness: 3,
          groupName,
          points,
          measurement: calibrated.measurement,
          opts: {
            sourceTool: "drawing-intelligence",
            analysisId: drawingAnalysisResult.analysisId,
            preset: drawingAnalysisPreset,
            detectionId: segment.id,
            systemId: system.id,
            ...calibrated.metadata,
          },
        });
      });
      const result = await saveDrawingDetectionsAsAnnotations({
        projectId,
        documentId: docId,
        pageNumber: page,
        imageWidth: drawingAnalysisResult.imageWidth,
        imageHeight: drawingAnalysisResult.imageHeight,
        analysisId: drawingAnalysisResult.analysisId,
        groupName,
        color: "#0ea5e9",
        detections,
      });
      const saved = mapSavedDrawingAnnotations(result.annotations, fallbacks);
      await loadAnnotationsRef.current();
      notifyAnnotationsMutated();
      if (options.toast !== false) {
        setToastMessage(`Saved ${result.savedCount} traced line segments to takeoff.`);
        setToastType("success");
      }
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save traced system";
      setToastMessage(message);
      setToastType("error");
      return [];
    } finally {
      setDrawingAnalysisSavingId(null);
    }
  }

  async function handleSaveDrawingLine(
    segment: DrawingLineSegment,
    options: { toast?: boolean } = {},
  ): Promise<Pickup[]> {
    if (!drawingAnalysisResult || !selectedDoc) return [];
    const docId = selectedVisionDocumentId();
    setDrawingAnalysisSavingId(segment.id);
    try {
      const groupName = "Drawing Intelligence Linework";
      const points = [{ x: segment.x1, y: segment.y1 }, { x: segment.x2, y: segment.y2 }];
      const calibrated = calibratedDrawingMeasurement(points, segment.lengthPx);
      const fallback = makeDrawingFallbackAnnotation({
        id: segment.id,
        type: "linear",
        label: "Detected line",
        color: "#38bdf8",
        thickness: 3,
        groupName,
        points,
        measurement: calibrated.measurement,
        opts: {
          sourceTool: "drawing-intelligence",
          analysisId: drawingAnalysisResult.analysisId,
          preset: drawingAnalysisPreset,
          detectionId: segment.id,
          ...calibrated.metadata,
        },
      });
      const result = await saveDrawingDetectionsAsAnnotations({
        projectId,
        documentId: docId,
        pageNumber: page,
        imageWidth: drawingAnalysisResult.imageWidth,
        imageHeight: drawingAnalysisResult.imageHeight,
        analysisId: drawingAnalysisResult.analysisId,
        groupName,
        color: "#38bdf8",
        detections: [{
          id: segment.id,
          kind: "line_segment",
          label: "Detected line",
          annotationType: "linear",
          groupName,
          color: "#38bdf8",
          lineThickness: 3,
          points,
          confidence: segment.confidence,
          source: "drawing-intelligence",
          measurement: calibrated.measurement,
          metadata: {
            sourceTool: "drawing-intelligence",
            analysisId: drawingAnalysisResult.analysisId,
            preset: drawingAnalysisPreset,
            detectionId: segment.id,
            ...calibrated.metadata,
          },
        }],
      });
      const saved = mapSavedDrawingAnnotations(result.annotations, [fallback]);
      await loadAnnotationsRef.current();
      notifyAnnotationsMutated();
      if (options.toast !== false) {
        setToastMessage(`Saved ${result.savedCount} detected line to takeoff.`);
        setToastType("success");
      }
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save detected line";
      setToastMessage(message);
      setToastType("error");
      return [];
    } finally {
      setDrawingAnalysisSavingId(null);
    }
  }

  async function handleSaveDrawingCircle(
    circle: DrawingGeometryAnalysisResult["circles"][number],
    options: { toast?: boolean } = {},
  ): Promise<Pickup[]> {
    if (!drawingAnalysisResult || !selectedDoc) return [];
    const docId = selectedVisionDocumentId();
    setDrawingAnalysisSavingId(circle.id);
    try {
      const groupName = "Drawing Intelligence Circles";
      const fallback = makeDrawingFallbackAnnotation({
        id: circle.id,
        type: "count",
        label: "Detected circle",
        color: "#a855f7",
        groupName,
        points: [{ x: circle.cx, y: circle.cy }],
        measurement: { value: 1, unit: "count" },
        opts: {
          sourceTool: "drawing-intelligence",
          analysisId: drawingAnalysisResult.analysisId,
          preset: drawingAnalysisPreset,
          detectionId: circle.id,
          radius: circle.radius,
          bounds: circle.bbox,
        },
      });
      const result = await saveDrawingDetectionsAsAnnotations({
        projectId,
        documentId: docId,
        pageNumber: page,
        imageWidth: drawingAnalysisResult.imageWidth,
        imageHeight: drawingAnalysisResult.imageHeight,
        analysisId: drawingAnalysisResult.analysisId,
        groupName,
        color: "#a855f7",
        detections: [{
          id: circle.id,
          kind: "circle",
          label: "Detected circle",
          annotationType: "count",
          groupName,
          color: "#a855f7",
          points: [{ x: circle.cx, y: circle.cy }],
          count: 1,
          confidence: circle.confidence,
          source: "drawing-intelligence",
          measurement: { value: 1, unit: "count" },
          metadata: {
            sourceTool: "drawing-intelligence",
            analysisId: drawingAnalysisResult.analysisId,
            preset: drawingAnalysisPreset,
            detectionId: circle.id,
            radius: circle.radius,
            bounds: circle.bbox,
          },
        }],
      });
      const saved = mapSavedDrawingAnnotations(result.annotations, [fallback]);
      await loadAnnotationsRef.current();
      notifyAnnotationsMutated();
      if (options.toast !== false) {
        setToastMessage(`Saved ${result.savedCount} circle mark to takeoff.`);
        setToastType("success");
      }
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save circle";
      setToastMessage(message);
      setToastType("error");
      return [];
    } finally {
      setDrawingAnalysisSavingId(null);
    }
  }

  async function handleSaveDrawingSymbol(
    candidate: DrawingSymbolCandidate,
    options: { toast?: boolean } = {},
  ): Promise<Pickup[]> {
    if (!drawingAnalysisResult || !selectedDoc) return [];
    const docId = selectedVisionDocumentId();

    setDrawingAnalysisSavingId(candidate.id);
    try {
      const groupName = "Drawing Intelligence Symbols";
      const fallback = makeDrawingFallbackAnnotation({
        id: candidate.id,
        type: "count",
        label: "Symbol candidate",
        color: "#f59e0b",
        groupName,
        points: [{ x: candidate.cx, y: candidate.cy }],
        measurement: { value: 1, unit: "count" },
        opts: {
          sourceTool: "drawing-intelligence",
          analysisId: drawingAnalysisResult.analysisId,
          preset: drawingAnalysisPreset,
          detectionId: candidate.id,
          bounds: { x: candidate.x, y: candidate.y, width: candidate.w, height: candidate.h },
        },
      });
      const result = await saveDrawingDetectionsAsAnnotations({
        projectId,
        documentId: docId,
        pageNumber: page,
        imageWidth: drawingAnalysisResult.imageWidth,
        imageHeight: drawingAnalysisResult.imageHeight,
        analysisId: drawingAnalysisResult.analysisId,
        groupName,
        color: "#f59e0b",
        detections: [{
          id: candidate.id,
          kind: "symbol_candidate",
          label: "Symbol candidate",
          annotationType: "count",
          groupName,
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
            detectionId: candidate.id,
            bounds: { x: candidate.x, y: candidate.y, width: candidate.w, height: candidate.h },
          },
        }],
      });
      const saved = mapSavedDrawingAnnotations(result.annotations, [fallback]);
      await loadAnnotationsRef.current();
      notifyAnnotationsMutated();
      if (options.toast !== false) {
        setToastMessage(`Saved ${result.savedCount} symbol mark to takeoff.`);
        setToastType("success");
      }
      return saved;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save symbol candidate";
      setToastMessage(message);
      setToastType("error");
      return [];
    } finally {
      setDrawingAnalysisSavingId(null);
    }
  }

  async function handleCreateDrawingDetectionLineItem(
    id: string,
    kind: "system" | "symbol" | "circle" | "line" | "arc" | "curve",
    pick: InspectCategoryPick,
  ) {
    try {
      // arc + curve primitives carry real geometry but the polyline they
      // sample to needs the drawing scale before it produces an LF / SF
      // value. Symbol + circle (which is a Hough-detected count mark) are
      // count-only, so they don't gate on calibration.
      if (
        (kind === "system" || kind === "line" || kind === "arc" || kind === "curve")
        && (!calibration || calibration.pixelsPerUnit <= 0)
      ) {
        setToastType("error");
        setToastMessage("Set the drawing scale before adding detected linework to a worksheet.");
        return;
      }
      let targets = drawingDetectionAnnotations(id);
      if (targets.length === 0) {
        targets = await handleSaveDrawingDetection(id, kind, { toast: false });
      }
      if (targets.length === 0) {
        setToastType("error");
        setToastMessage("Could not save and link that detected entity automatically.");
        return;
      }

      const created = targets.length === 1
        ? await createLineItemFromAnnotation(targets[0], pick)
        : await createLineItemFromAnnotationGroup(
            targets,
            targets[0]?.groupName || targets[0]?.label || "Detected drawing system",
            pick,
          );
      if (!created) return;

      await loadAnnotationsRef.current();
      await loadPickupLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(
        kind === "system"
          ? `Created line item from detected system (${targets.length} segments).`
          : kind === "arc"
            ? "Created line item from vector arc primitive."
            : kind === "curve"
              ? "Created line item from vector curve primitive."
              : "Created line item from detected entity.",
      );
    } catch (error) {
      console.error("[takeoff] Failed to create line item from drawing detection:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a line item from that detected entity."));
    }
  }

  async function handleCreateDrawingSymbolGroupLineItem(ids: string[], label: string, pick: InspectCategoryPick) {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return;
    try {
      const targets: Pickup[] = [];
      for (const id of uniqueIds) {
        const existing = drawingDetectionAnnotations(id);
        if (existing.length > 0) {
          targets.push(...existing);
          continue;
        }
        const saved = await handleSaveDrawingDetection(id, "symbol", { toast: false });
        targets.push(...saved);
      }
      if (targets.length === 0) {
        setToastType("error");
        setToastMessage("Could not save and link those count candidates automatically.");
        return;
      }
      const created = await createLineItemFromAnnotationGroup(targets, label || "PDF count candidates", pick);
      if (!created) return;
      await loadAnnotationsRef.current();
      await loadPickupLinks();
      notifyWorkspaceMutated();
      notifyPickupLinksMutated();
      setToastType("success");
      setToastMessage(`Created count line item from ${targets.length} PDF candidate${targets.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("[takeoff] Failed to create line item from PDF count group:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a line item from those count candidates."));
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
    setSelectedDrawingDetectionId(null);
  }, [selectedDocId, page]);

  function handleCalibrationConfirm() {
    if (!calibrationPoints || !calibrationInput) return;
    const knownDist = parseConstructionDimensionToUnit(calibrationInput, calibrationUnit);
    if (knownDist === null || knownDist <= 0 || !Number.isFinite(knownDist)) return;

    const [a, b] = calibrationPoints;
    const pixelDist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    // Normalise pixelsPerUnit to zoom 1 (paper-pixels per unit) so
    // measurements stay correct at any later zoom level.
    const pixelsPerUnit = (pixelDist / knownDist) / Math.max(zoom, 0.0001);

    const previous = selectedDocId ? lookupCalibrationFromCache(selectedDocId, page) : calibration;
    const next: Calibration = { pixelsPerUnit, unit: calibrationUnit };
    const beforeDocCache = selectedDocId ? cloneCalibrationDocCache(selectedDocId) : null;
    setCalibration(next);
    setCalibrationPromptOpen(false);
    setCalibrationInput("");
    setCalibrationPoints(null);

    // Persist on WorkspaceState so the calibration survives reloads and
    // syncs to other open tabs / devices.
    if (selectedDocId) {
      applyCalibrationSnapshot(selectedDocId, page, next, calibrationApplyToAllPages);
      if (!sameCalibration(previous, next)) {
        const afterDocCache = cloneCalibrationDocCache(selectedDocId);
        pushTakeoffHistory({
          kind: "calibration",
          docId: selectedDocId,
          page,
          applyToAllPages: calibrationApplyToAllPages,
          before: previous,
          after: next,
          beforeDocCache,
          afterDocCache,
        });
      }
    }
    setActiveTool("select");
  }

  /* Annotation CRUD */
  function handleToggleVisibility(id: string) {
    const nextAnnotations = annotations.map((a) => (a.id === id ? { ...a, visible: !a.visible } : a));
    setAnnotations(nextAnnotations);
    notifyAnnotationsMutated(nextAnnotations);
  }

  /** Toggle inclusion of a single match inside an Auto Count bundle. The
   *  user clicks a thumbnail in the expanded Pickup row; we flip whether
   *  that match index is in `metadata.excludedMatchIndexes`, then
   *  recompute `points` + `measurement.value` so the canvas drops the
   *  bbox marker and the worksheet line item promotion uses the new
   *  count. Reversible — re-checking puts the match back. */
  async function handleToggleAutoCountMatch(pickupId: string, matchIndex: number) {
    const annotation = annotations.find((a) => a.id === pickupId);
    if (!annotation) return;
    const meta = (annotation.metadata ?? {}) as Record<string, unknown>;
    const allMatches = Array.isArray(meta.matches)
      ? (meta.matches as Array<{ rect?: { x: number; y: number; width: number; height: number } }>)
      : [];
    if (matchIndex < 0 || matchIndex >= allMatches.length) return;
    const currentExcluded = new Set<number>(
      Array.isArray(meta.excludedMatchIndexes) ? (meta.excludedMatchIndexes as number[]) : [],
    );
    if (currentExcluded.has(matchIndex)) {
      currentExcluded.delete(matchIndex);
    } else {
      currentExcluded.add(matchIndex);
    }
    const excludedArr = Array.from(currentExcluded).sort((a, b) => a - b);
    // Re-derive points from the included matches' bbox centers. We keep
    // metadata.matches intact (all originals) so un-excluding restores
    // the point without a re-run.
    const baseWidth = annotation.canvasWidth ?? canvasSize.width;
    const baseHeight = annotation.canvasHeight ?? canvasSize.height;
    const imgW = typeof meta.imageWidth === "number" ? (meta.imageWidth as number) : baseWidth;
    const imgH = typeof meta.imageHeight === "number" ? (meta.imageHeight as number) : baseHeight;
    const sx = baseWidth / Math.max(imgW, 1);
    const sy = baseHeight / Math.max(imgH, 1);
    const newPoints = allMatches
      .map((m, idx) => {
        if (currentExcluded.has(idx) || !m.rect) return null;
        return {
          x: (m.rect.x + m.rect.width / 2) * sx,
          y: (m.rect.y + m.rect.height / 2) * sy,
        };
      })
      .filter((p): p is { x: number; y: number } => p != null);
    const newCount = allMatches.length - currentExcluded.size;
    const updated: Pickup = {
      ...annotation,
      points: newPoints,
      measurement: { value: newCount, unit: "count" },
      metadata: { ...meta, excludedMatchIndexes: excludedArr },
    };
    setAnnotations((prev) => prev.map((a) => (a.id === pickupId ? updated : a)));
    pushTakeoffHistory({ kind: "update", before: annotation, after: updated });
    try {
      await updatePickup(projectId, pickupId, {
        points: updated.points,
        measurement: updated.measurement,
        metadata: { ...meta, excludedMatchIndexes: excludedArr },
      });
    } catch {
      /* Local change persists in-session; server resync on next reload. */
    }
    notifyAnnotationsMutated();
  }

  /** Wipe every Pickup for the active document — Auto Count
   *  bundles, Smart Count items, manual markups, the lot. The estimator
   *  invokes this from the Pickups panel settings when they want a clean
   *  slate (e.g. a partial / mis-scoped Auto Count run, or legacy
   *  pre-refactor per-match rows). Confirmation lives in the UI so this
   *  fires only after the user opts in. */
  async function handleClearAllAnnotations() {
    if (!projectId || !selectedDocId) return;
    const annotationDocumentId = selectedDoc?.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDocId;
    // Local optimistic clear so the UI feels instant; if any DELETE call
    // fails the next loadAnnotations refresh will surface the survivors.
    const previous = annotations;
    setAnnotations([]);
    updateAnnotationSelection(null);
    if (previous.length > 0) pushTakeoffHistory({ kind: "clear", annotations: previous });
    const results = await Promise.allSettled(
      previous.map((ann) => deletePickup(projectId, ann.id)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      setToastType("error");
      setToastMessage(`Cleared ${previous.length - failed} pickups; ${failed} failed (refresh to retry).`);
    } else {
      setToastType("success");
      setToastMessage(`Cleared ${previous.length} pickup${previous.length === 1 ? "" : "s"} from this file.`);
    }
    notifyAnnotationsMutated();
    void annotationDocumentId;
  }

  async function handleDeleteAnnotation(id: string) {
    const annotation = annotations.find((a) => a.id === id);
    const nextAnnotations = annotations.filter((a) => a.id !== id);
    setAnnotations(nextAnnotations);
    if (selectedPickupId === id) {
      updateAnnotationSelection(null);
    }
    try {
      await deletePickup(projectId, id);
    } catch {
      /* Ignore */
    }
    if (annotation) pushTakeoffHistory({ kind: "delete", annotation });
    notifyAnnotationsMutated();
  }

  const [editingPickupId, setEditingPickupId] = useState<string | null>(null);

  function handleEditAnnotation(id: string) {
    updateAnnotationSelection(id);
    setEditingPickupId(id);
  }

  function handleSaveAnnotationEdit(id: string, updates: { label?: string; color?: string; groupName?: string }) {
    const before = annotations.find((a) => a.id === id) ?? null;
    const after = before ? { ...before, ...updates } : null;
    const nextAnnotations = annotations.map((a) => (a.id === id && after ? after : a));
    setAnnotations(nextAnnotations);
    if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
      pushTakeoffHistory({ kind: "update", before, after });
    }
    updatePickup(projectId, id, updates)
      .then(() => notifyAnnotationsMutated())
      .catch(() => notifyAnnotationsMutated(nextAnnotations));
    setEditingPickupId(null);
  }

  /* Clear all annotations */
  function handleClearAll() {
    const removed = [...annotations];
    const deletions = annotations.map((ann) => deletePickup(projectId, ann.id).catch(() => {}));
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
    // BUT while we're on the intake landing page,
    // the user hasn't actually opened anything — surfacing the auto-selected
    // doc's elements in the right-hand Inspect panel is wrong. Force mode
    // "empty" in that case so the Inspect tab shows its empty state and
    // doesn't preview a model the estimator hasn't asked to see yet.
    const isLandingShown = showLanding;
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
    const inspectSelectedPickupId =
      mode === "dwg"
        ? selection?.kind === "annotation"
          ? selection.pickupId
          : null
        : selectedPickupId;
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
        ? (() => {
            const summary = activeSpreadsheetPivotSummary(spreadsheetPreview, pivotGroupBy, pivotMeasure);
            const pivotMode = spreadsheetPanelView === "pivot" && Boolean(summary);
            const measureLabel = spreadsheetMeasureLabel(summary?.measure ?? pivotMeasure);
            return {
              sourceName: spreadsheetPreview.sourceName,
              mode: pivotMode ? "pivot" as const : "raw" as const,
              rowCount: spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length,
              columnCount: spreadsheetPreview.headers.length,
              headers: pivotMode && summary
                ? [summary.groupBy, measureLabel, "Rows", "Average"]
                : spreadsheetPreview.headers,
              rows: pivotMode && summary
                ? spreadsheetPivotInspectRows(spreadsheetPreview, summary)
                : spreadsheetRawInspectRows(spreadsheetPreview),
              pivot: pivotMode && summary
                ? {
                    groupBy: summary.groupBy,
                    measure: summary.measure,
                    measureLabel,
                    groupCount: summary.rows.length,
                    sourceRowCount: summary.rows.reduce((sum, row) => sum + row.count, 0),
                  }
                : null,
              mapping: pivotMode && summary
                ? { name: summary.groupBy, quantity: measureLabel, uom: null, cost: null }
                : deriveSpreadsheetMapping(spreadsheetPreview.headers),
            };
          })()
        : null;

    const nextSnapshot: InspectSnapshot = {
      mode,
      annotations: inspectAnnotations,
      pickupLinks,
      selectedPickupId: inspectSelectedPickupId,
      editingPickupId,
      drawingAnalysis: mode === "pdf" && selectedDoc
        ? {
            documentId: selectedVisionDocumentId(),
            fileName: selectedDoc.fileName,
            pageNumber: page,
            analysis: drawingAnalysisResult,
            settings: drawingAnalysisSettings,
            overlay: drawingAnalysisOverlay,
            running: drawingAnalysisRunning,
            savingId: drawingAnalysisSavingId,
            error: drawingAnalysisError,
            selectedDetectionId: selectedDrawingDetectionId,
            calibration: drawingAnalysisCalibrationSnapshot(),
          }
        : null,
      smartCount: shouldPublishSmartCountSnapshot(mode) && selectedDoc
        ? {
            documentId: selectedVisionDocumentId(),
            fileName: selectedDoc.fileName,
            pageNumber: page,
            running: smartCountRunning,
            savingId: smartCountSavingId,
            error: smartCountError,
            cropImage: smartCountCropImage,
            bbox: smartCountBbox,
            items: smartCountSnapshotItems(),
            selectedItemId: selectedSmartCountItemId,
          }
        : null,
      dwgIntelligence: mode === "dwg" ? enrichedDwgIntelligence : null,
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
              const firstSourceIdx = row.sourceImageIndexes[0];
              const sourcePhotoThumbnail = typeof firstSourceIdx === "number"
                ? photoBomSourcePhotoDataUris[firstSourceIdx] ?? null
                : null;
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
                sourcePhotoThumbnail,
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
    page,
    selectedPickupId,
    editingPickupId,
    pickupLinks,
    drawingAnalysisResult,
    drawingAnalysisSettings,
    drawingAnalysisOverlay,
    drawingAnalysisRunning,
    drawingAnalysisSavingId,
    drawingAnalysisError,
    selectedDrawingDetectionId,
    smartCountRunning,
    smartCountSavingId,
    smartCountBbox,
    smartCountCropImage,
    smartCountItems,
    smartCountIncluded,
    smartCountError,
    selectedSmartCountItemId,
    enrichedDwgIntelligence,
    calibration,
    canvasSize.width,
    canvasSize.height,
    zoom,
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
    spreadsheetPanelView,
    pivotGroupBy,
    pivotMeasure,
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
   *  annotations fall back to qty=1.
   *
   *  Note on `measurement.unit`: the area-polygon producer convention in
   *  apps/web/lib/takeoff-math.ts (`computeMeasurement`) already returns
   *  the unit in squared form for area annotations (e.g. "ft²"). Earlier
   *  versions of this function unconditionally appended "²" on top, which
   *  produced "ft²²" on the worksheet row. The helpers below preserve the
   *  unit as-is when it already carries the dimension suffix and only
   *  append when it doesn't (so a producer that stores `unit: "ft"` + a
   *  separate area field still gets a correct "ft²" out the other side). */
  function annotationToQuantity(annotation: Pickup): { quantity: number; uom: string } {
    const m = annotation.measurement;
    if (m?.area != null && m.area > 0) {
      return { quantity: m.area, uom: areaUomFromUnit(m.unit) };
    }
    if (m?.volume != null && m.volume > 0) {
      return { quantity: m.volume, uom: volumeUomFromUnit(m.unit) };
    }
    if (typeof m?.value === "number" && Number.isFinite(m.value)) {
      return { quantity: m.value, uom: m.unit || "EA" };
    }
    return { quantity: 1, uom: "EA" };
  }

  /** Given a producer-supplied `measurement.unit`, return the appropriate
   *  area uom string. Handles both the "base unit" convention ("ft" →
   *  "ft²") and the "already-squared" convention ("ft²" → "ft²"). */
  function areaUomFromUnit(unit: string | undefined): string {
    if (!unit) return "SF";
    return unit.endsWith("²") || unit.endsWith("2") ? unit : `${unit}²`;
  }

  /** Volume sibling of areaUomFromUnit. */
  function volumeUomFromUnit(unit: string | undefined): string {
    if (!unit) return "CF";
    return unit.endsWith("³") || unit.endsWith("3") ? unit : `${unit}³`;
  }

  async function createLineItemFromAnnotation(
    annotation: Pickup,
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
  ) {
    const annotationMetadata = (annotation.opts ?? {}) as Record<string, unknown>;
    if (annotationMetadata.requiresCalibration === true) {
      setToastType("error");
      setToastMessage("Set the drawing scale before adding this detected linework to a worksheet.");
      return null;
    }
    const pick = normalizeTakeoffCategoryPick(pickInput);
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-single-annotation", pickupId: annotation.id, pick });
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
    await createPickupLink(projectId, {
      pickupId: annotation.id,
      worksheetItemId: createdItem.id,
    });
    return { createdItem };
  }

  type DwgInspectableRowType = "entity" | "autoCount" | "system";

  function findDwgLineItemDraft(
    rowType: DwgInspectableRowType,
    rowId: string,
    intel: InspectDwgIntelligenceSnapshot | null = enrichedDwgIntelligence ?? dwgIntelligence,
  ) {
    if (!intel) return null;
    if (rowType === "entity") {
      const row = intel.entities.find((candidate) => candidate.id === rowId);
      if (!row) return null;
      return {
        rowType,
        id: row.id,
        label: row.label,
        entityType: row.type,
        layer: row.layer,
        quantity: row.quantity,
        uom: row.uom,
        sourceEntityIds: row.sourceEntityIds,
      };
    }
    if (rowType === "autoCount") {
      const row = intel.autoCounts.find((candidate) => candidate.id === rowId);
      if (!row) return null;
      return {
        rowType,
        id: row.id,
        label: row.label,
        entityType: row.type,
        layer: row.layer,
        quantity: row.count,
        uom: "EA",
        sourceEntityIds: row.sourceEntityIds,
      };
    }
    const row = intel.systems.find((candidate) => candidate.id === rowId);
    if (!row) return null;
    return {
      rowType,
      id: row.id,
      label: row.label,
      entityType: "LINEAR_SYSTEM",
      layer: row.layer,
      quantity: row.quantity,
      uom: row.uom,
      sourceEntityIds: row.sourceEntityIds,
    };
  }

  async function createLineItemFromDwgRow(
    rowType: DwgInspectableRowType,
    rowId: string,
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    const intel = enrichedDwgIntelligence ?? dwgIntelligence;
    const draft = findDwgLineItemDraft(rowType, rowId, intel);
    if (!intel || !draft) {
      setToastType("error");
      setToastMessage("That DWG/DXF entity is no longer available.");
      return null;
    }
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-dwg-row", rowId, rowType, pick });
      return null;
    }
    const normalizedUom = draft.uom.toLowerCase();
    if (normalizedUom === "du" || normalizedUom === "du2") {
      setToastType("error");
      setToastMessage("Set the DWG/DXF scale before adding measured vector entities to a worksheet.");
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before adding line items.");
      return null;
    }

    const previousItemIds = new Set(workspace.worksheets.flatMap((w) => w.items).map((i) => i.id));
    const basePayload: CreateWorksheetItemInput = {
      categoryId: takeoffCategory.id,
      category: takeoffCategory.name,
      entityType: takeoffCategory.entityType,
      entityName: draft.label,
      description: "",
      quantity: draft.quantity,
      uom: draft.uom,
      cost: 0,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: 0,
      sourceNotes: [
        `From DWG/DXF ${rowType === "autoCount" ? "Auto Count" : rowType === "system" ? "system trace" : "native entity"}`,
        selectedDoc?.fileName ? `doc: ${selectedDoc.fileName}` : "",
        `layer: ${draft.layer}`,
        draft.sourceEntityIds.length > 1 ? `${draft.sourceEntityIds.length} source entities` : "",
      ].filter(Boolean).join(" · "),
    };
    const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
    if (!payload) return null;

    setDwgEntitySavingId(rowId);
    try {
      const result = await createWorksheetItem(projectId, ws.id, payload);
      const createdItem = result.workspace.worksheets
        .flatMap((w) => w.items)
        .find((i) => !previousItemIds.has(i.id));
      if (!createdItem) return null;

      const entityLookup = new Map((intel.entities ?? []).map((row) => [row.id, row]));
      const perEntityFallback = draft.sourceEntityIds.length > 0
        ? draft.quantity / draft.sourceEntityIds.length
        : draft.quantity;
      for (const entityId of draft.sourceEntityIds) {
        const source = entityLookup.get(entityId);
        const quantity =
          rowType === "autoCount"
            ? 1
            : source && source.uom === draft.uom && Number.isFinite(source.quantity) && source.quantity > 0
              ? source.quantity
              : perEntityFallback;
        await createDwgEntityLink(projectId, {
          documentId: intel.documentId,
          entityId,
          entityType: source?.type ?? draft.entityType,
          layer: source?.layer ?? draft.layer,
          worksheetItemId: createdItem.id,
          quantity,
          multiplier: 1,
          selection: {
            mode: rowType,
            rowId,
            label: draft.label,
            fileName: intel.fileName,
            selectedLayout: intel.selectedLayout,
            sourceEntityCount: draft.sourceEntityIds.length,
            lineItemDraft: payload,
          },
        });
      }

      return { createdItem };
    } finally {
      setDwgEntitySavingId(null);
    }
  }

  async function handleCreateDwgRowLineItem(rowType: DwgInspectableRowType, rowId: string, pick: string | InspectCategoryPick) {
    try {
      const created = await createLineItemFromDwgRow(rowType, rowId, pick);
      if (!created) return;
      await loadDwgEntityLinks();
      notifyWorkspaceMutated();
      notifyPickupLinksMutated();
      setToastType("success");
      setToastMessage("Created line item from DWG/DXF entity.");
    } catch (error) {
      console.error("[takeoff] Failed to create DWG/DXF line item:", error);
      setDwgEntitySavingId(null);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not create a line item from that DWG/DXF entity."));
    }
  }

  function clearDwgSelectionIf(sourceEntityIds: string[]) {
    const selectedEntityId = (enrichedDwgIntelligence ?? dwgIntelligence)?.selectedEntityId;
    if (!selectedEntityId || !sourceEntityIds.includes(selectedEntityId)) return;
    dwgActionsRef.current?.selectEntity(null);
    if (selection?.kind === "cad-entity" || !onSelectionChange) publishTakeoffSelection(null);
  }

  function handleDeleteDwgEntityRow(id: string) {
    const row = dwgIntelligence?.entities.find((candidate) => candidate.id === id);
    if (!row) return;
    clearDwgSelectionIf([id]);
    setDwgIntelligence((current) => {
      if (!current) return current;
      const entities = current.entities.filter((candidate) => candidate.id !== id);
      return {
        ...current,
        selectedEntityId: current.selectedEntityId === id ? null : current.selectedEntityId,
        entityCount: entities.length,
        visibleEntityCount: entities.length,
        entities,
      };
    });
    setToastType("success");
    setToastMessage("Deleted DWG/DXF entity row from the review list.");
  }

  function handleDeleteDwgAutoCountRow(id: string) {
    const row = dwgIntelligence?.autoCounts.find((candidate) => candidate.id === id);
    if (!row) return;
    clearDwgSelectionIf(row.sourceEntityIds);
    setDwgIntelligence((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedEntityId: row.sourceEntityIds.includes(current.selectedEntityId ?? "") ? null : current.selectedEntityId,
        autoCounts: current.autoCounts.filter((candidate) => candidate.id !== id),
      };
    });
    setToastType("success");
    setToastMessage("Deleted DWG/DXF Auto Count row from the review list.");
  }

  function handleDeleteDwgSystemRow(id: string) {
    const row = dwgIntelligence?.systems.find((candidate) => candidate.id === id);
    if (!row) return;
    clearDwgSelectionIf(row.sourceEntityIds);
    setDwgIntelligence((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedEntityId: row.sourceEntityIds.includes(current.selectedEntityId ?? "") ? null : current.selectedEntityId,
        systems: current.systems.filter((candidate) => candidate.id !== id),
      };
    });
    setToastType("success");
    setToastMessage("Deleted DWG/DXF traced system from the review list.");
  }

  async function handleCreateAnnotationLineItem(annotation: Pickup, pick: string | InspectCategoryPick) {
    try {
      const created = await createLineItemFromAnnotation(annotation, pick);
      if (!created) return;
      await loadPickupLinks();
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
    annotations: Pickup[],
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
        pickupIds: annotations.map((a) => a.id),
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
        createPickupLink(projectId, {
          pickupId: ann.id,
          worksheetItemId: createdItem.id,
        }).catch((err) => {
          console.warn(`[takeoff] Could not link annotation ${ann.id} to summed line item:`, err);
        }),
      ),
    );
    return { createdItem };
  }

  async function handleCreateAnnotationGroupLineItem(annotations: Pickup[], groupLabel: string, pick: string | InspectCategoryPick) {
    try {
      const created = await createLineItemFromAnnotationGroup(annotations, groupLabel, pick);
      if (!created) return;
      await loadPickupLinks();
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
      return parseSpreadsheetNumber(row[idx]);
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

  function buildLineItemFromPivotRow(
    row: SpreadsheetPivotSummaryRow,
    summary: SpreadsheetPivotSummary,
    category: EntityCategory,
  ): CreateWorksheetItemInput {
    const mapping = deriveSpreadsheetMapping(spreadsheetPreview?.headers ?? []);
    const groupIndex = spreadsheetPreview?.headers.indexOf(summary.groupBy) ?? -1;
    const uomIndex = mapping.uom && spreadsheetPreview ? spreadsheetPreview.headers.indexOf(mapping.uom) : -1;
    const costIndex = mapping.cost && spreadsheetPreview ? spreadsheetPreview.headers.indexOf(mapping.cost) : -1;
    const sourceRows =
      groupIndex >= 0 && spreadsheetPreview
        ? spreadsheetPreview.sampleRows.filter((sourceRow) => String(sourceRow[groupIndex] ?? "").trim() === row.label)
        : [];
    const uomCounts = new Map<string, number>();
    for (const sourceRow of sourceRows) {
      const uom = uomIndex >= 0 ? String(sourceRow[uomIndex] ?? "").trim().toUpperCase() : "";
      if (uom) uomCounts.set(uom, (uomCounts.get(uom) ?? 0) + 1);
    }
    const inferredUom = Array.from(uomCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    const costValues = sourceRows
      .map((sourceRow) => (costIndex >= 0 ? parseSpreadsheetNumber(sourceRow[costIndex]) : null))
      .filter((value): value is number => value !== null);
    const cost = costValues.length > 0
      ? costValues.reduce((sum, value) => sum + value, 0) / costValues.length
      : 0;
    const quantity = summary.measure === "__count" ? row.count : row.total;
    const uom = summary.measure === "__count"
      ? category.defaultUom || "EA"
      : inferredUom || category.defaultUom || "EA";
    const markup = workspace.currentRevision.defaultMarkup ?? 0.2;
    const sourceName = spreadsheetPreview?.sourceName ?? selectedDoc?.fileName ?? "";
    return {
      categoryId: category.id,
      category: category.name,
      entityType: category.entityType,
      entityName: row.label || `${summary.groupBy} group`,
      description: `Pivoted by ${summary.groupBy}`,
      quantity,
      uom,
      cost,
      markup,
      price: cost * quantity * (1 + markup),
      sourceNotes: [
        `From spreadsheet pivot ${sourceName}`.trim(),
        `Grouped by: ${summary.groupBy}`,
        `Measure: ${spreadsheetMeasureLabel(summary.measure)}`,
        `Source rows: ${row.count.toLocaleString()}`,
        `Pivot total: ${numericFormat(row.total)}`,
        sourceRows.length > 0 ? `Unit/cost inferred from ${sourceRows.length} preview row${sourceRows.length === 1 ? "" : "s"}.` : "",
      ].filter(Boolean).join("\n"),
    };
  }

  async function createLineItemFromSpreadsheetRow(
    rowIndex: number,
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
    modeOverride: SpreadsheetPanelView = spreadsheetPanelView,
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (!spreadsheetPreview) return null;
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-spreadsheet-row", rowIndex, mode: modeOverride, pick });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before importing rows.");
      return null;
    }
    const summary = activeSpreadsheetPivotSummary(spreadsheetPreview, pivotGroupBy, pivotMeasure);
    const pivotMode = modeOverride === "pivot" && Boolean(summary);
    const row = pivotMode ? summary?.rows[rowIndex] : spreadsheetPreview.sampleRows[rowIndex];
    if (!row) return null;
    const mapping = deriveSpreadsheetMapping(spreadsheetPreview.headers);
    const basePayload = pivotMode && summary
      ? buildLineItemFromPivotRow(row as SpreadsheetPivotSummaryRow, summary, takeoffCategory)
      : buildLineItemFromRow(row as string[], spreadsheetPreview.headers, mapping, takeoffCategory);
    const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
    if (!payload) return null;
    await createWorksheetItem(projectId, ws.id, payload);
    return { ok: true as const, mode: pivotMode ? "pivot" as const : "raw" as const };
  }

  async function handleCreateSpreadsheetRowLineItem(rowIndex: number, pick: string | InspectCategoryPick) {
    try {
      const result = await createLineItemFromSpreadsheetRow(rowIndex, pick);
      if (!result) return;
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(result.mode === "pivot" ? "Imported pivot group to worksheet." : "Imported row to worksheet.");
    } catch (error) {
      console.error("[takeoff] Failed to import spreadsheet row:", error);
      setToastType("error");
      setToastMessage(takeoffApiErrorMessage(error, "Could not import that row."));
    }
  }

  async function createLineItemsFromAllSpreadsheetRows(
    pickInput: string | InspectCategoryPick,
    explicitWs?: { id: string; name: string },
    modeOverride: SpreadsheetPanelView = spreadsheetPanelView,
  ) {
    const pick = normalizeTakeoffCategoryPick(pickInput);
    if (!spreadsheetPreview) return null;
    const ws = explicitWs ?? selectedWorksheet;
    if (!ws) {
      setWorksheetPickerAction({ kind: "create-spreadsheet-all", mode: modeOverride, pick });
      return null;
    }
    const takeoffCategory = entityCategories.find((c) => c.id === pick.categoryId && c.enabled);
    if (!takeoffCategory) {
      setToastType("error");
      setToastMessage("Pick a takeoff category in the Entities panel before importing rows.");
      return null;
    }
    const mapping = deriveSpreadsheetMapping(spreadsheetPreview.headers);
    const summary = activeSpreadsheetPivotSummary(spreadsheetPreview, pivotGroupBy, pivotMeasure);
    const pivotMode = modeOverride === "pivot" && Boolean(summary);
    let imported = 0;
    const rows = pivotMode && summary ? summary.rows : spreadsheetPreview.sampleRows;
    if (rows.length === 0) return null;
    for (const row of rows) {
      const basePayload = pivotMode && summary
        ? buildLineItemFromPivotRow(row as SpreadsheetPivotSummaryRow, summary, takeoffCategory)
        : buildLineItemFromRow(row as string[], spreadsheetPreview.headers, mapping, takeoffCategory);
      const payload = applyCategoryPickToPayload(basePayload, takeoffCategory, pick);
      if (!payload) return null;
      await createWorksheetItem(projectId, ws.id, payload);
      imported += 1;
    }
    return { imported, mode: pivotMode ? "pivot" as const : "raw" as const };
  }

  async function handleCreateAllSpreadsheetLineItems(pick: string | InspectCategoryPick) {
    try {
      const result = await createLineItemsFromAllSpreadsheetRows(pick);
      if (!result) return;
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(
        result.mode === "pivot"
          ? `Imported ${result.imported} pivot group${result.imported === 1 ? "" : "s"} to worksheet.`
          : `Imported ${result.imported} row${result.imported === 1 ? "" : "s"} to worksheet.`,
      );
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
    // The legacy multi-select Send-to-Estimate flow (driven by model-editor
    // actions) doesn't go through the AddToCategoryPopover.
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
      const annotation = allAnnotations.find((a) => a.id === action.pickupId);
      if (!annotation) {
        setToastType("error");
        setToastMessage("That annotation is no longer available.");
        return;
      }
      await createLineItemFromAnnotation(annotation, action.pick, ws);
      await loadPickupLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage("Created line item from annotation.");
    } else if (action.kind === "create-annotation-group") {
      const allAnnotations = [...annotations, ...dwgAnnotationsCache];
      const targets = action.pickupIds
        .map((id) => allAnnotations.find((a) => a.id === id))
        .filter((a): a is Pickup => Boolean(a));
      if (targets.length === 0) {
        setToastType("error");
        setToastMessage("Those annotations are no longer available.");
        return;
      }
      await createLineItemFromAnnotationGroup(targets, action.groupLabel, action.pick, ws);
      await loadPickupLinks();
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(`Created summed line item from ${targets.length} mark${targets.length === 1 ? "" : "s"}.`);
    } else if (action.kind === "create-dwg-row") {
      const created = await createLineItemFromDwgRow(action.rowType, action.rowId, action.pick, ws);
      if (!created) return;
      await loadDwgEntityLinks();
      notifyWorkspaceMutated();
      notifyPickupLinksMutated();
      setToastType("success");
      setToastMessage("Created line item from DWG/DXF entity.");
    } else if (action.kind === "create-spreadsheet-row") {
      const result = await createLineItemFromSpreadsheetRow(action.rowIndex, action.pick, ws, action.mode);
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(result?.mode === "pivot" ? "Imported pivot group to worksheet." : "Imported row to worksheet.");
    } else if (action.kind === "create-spreadsheet-all") {
      const result = await createLineItemsFromAllSpreadsheetRows(action.pick, ws, action.mode);
      notifyWorkspaceMutated();
      setToastType("success");
      setToastMessage(
        result?.mode === "pivot"
          ? `Imported ${result?.imported ?? 0} pivot group${result?.imported === 1 ? "" : "s"} to worksheet.`
          : `Imported ${result?.imported ?? 0} row${result?.imported === 1 ? "" : "s"} to worksheet.`,
      );
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
  const activePivotSummary = activeSpreadsheetPivotSummary(spreadsheetPreview, pivotGroupBy, pivotMeasure);
  const maxPivotTotal = Math.max(...(activePivotSummary?.rows.map((row) => row.total) ?? [0]), 1);
  const pdfSpotlightActive = Boolean(selectedPickupId || selectedDrawingDetectionId || selectedSmartCountItemId);

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

  if (showLanding) {
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
                  onResults={(result, sourceNames, sourceDataUris) => {
                    setPhotoBomResult(result);
                    setPhotoBomSourcePhotoNames(result ? sourceNames : []);
                    setPhotoBomSourcePhotoDataUris(result ? sourceDataUris : []);
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
      {!isDwgDocument && (
      /* ─── Top Toolbar ─── */
      <div className="flex min-w-0 items-center gap-1 overflow-hidden border-b border-line bg-panel px-1.5 py-1.5 shrink-0">
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

        {isPdfDocument && (
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

            <PdfToolGroupMenus
              activeTool={activeTool}
              onSelect={handleToolSelect}
              onReadLegend={handleReadLegend}
              onOpenDrawingIntelligence={() => {
                onOpenInspectEntities?.();
                postTakeoffMessage({ type: "open-inspect-entities" });
                if (!drawingAnalysisResult && !drawingAnalysisRunning) {
                  void handleRunDrawingAnalysis();
                }
              }}
              legendOpen={legendOpen}
              legendLoading={legendLoading}
              legendEntries={legendEntries}
              legendWarnings={legendWarnings}
              legendCount={legendEntries?.length ?? 0}
              onCloseLegend={() => setLegendOpen(false)}
              drawingAnalysisRunning={drawingAnalysisRunning}
              drawingAnalysisCount={drawingAnalysisResult?.summary.systemCount ?? null}
              canRunDocumentAi={Boolean(selectedDoc)}
              canRunDrawingIntelligence={Boolean(isPdfDocument && selectedDoc)}
              onSaveLegendEntryToLibrary={handleSaveLegendEntryToLibrary}
              savingLegendKey={savingLegendKey}
              savedLegendKeys={savedLegendKeys}
              libraryOpen={libraryOpen}
              libraryCount={libraryCount}
              onOpenLibrary={() => setLibraryOpen(true)}
              onCloseLibrary={() => setLibraryOpen(false)}
              libraryProjectId={projectId}
              libraryDocumentId={selectedDoc ? (selectedDoc.source === "knowledge" && selectedDoc.bookId ? selectedDoc.bookId : selectedDoc.id) : null}
              libraryPageNumber={page}
              libraryCanRun={Boolean(isPdfDocument && selectedDoc)}
              onLibraryRefresh={refreshLibraryCount}
              shortcutPreset={shortcutPreset}
            />

          </>
        )}

        {isSpreadsheetDocument && (
          <>
            <Separator className="hidden !h-6 !w-px shrink-0 md:block" />
            <div className="hidden min-w-0 max-w-72 flex-col px-1 md:flex">
              <span className="truncate text-[11px] font-medium text-fg/65">{spreadsheetPreview?.sourceName ?? selectedDoc?.fileName ?? "Spreadsheet"}</span>
              <span className="truncate text-[10px] text-fg/35">
                {spreadsheetPreview
                  ? `${(spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length).toLocaleString()} rows · ${spreadsheetPreview.headers.length.toLocaleString()} columns`
                  : "Select a spreadsheet source"}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-1 rounded-md border border-line bg-bg/35 p-0.5">
              <SpreadsheetTransformMenu
                view={spreadsheetPanelView}
                onViewChange={setSpreadsheetPanelView}
                groupBy={pivotGroupBy || activePivotSummary?.groupBy || ""}
                onGroupByChange={setPivotGroupBy}
                measure={pivotMeasure}
                onMeasureChange={setPivotMeasure}
                groupOptions={spreadsheetGroupOptions.length ? spreadsheetGroupOptions : [{ value: "none", label: "No text fields", disabled: true }]}
                measureOptions={spreadsheetMeasureOptions}
                disabled={!spreadsheetPreview}
              />
              <SpreadsheetDataMenu
                disabled={!spreadsheetPreview}
                rowCount={spreadsheetPreview?.rowCount ?? spreadsheetPreview?.sampleRows.length ?? 0}
                columnCount={spreadsheetPreview?.headers.length ?? 0}
                onOpenEntities={() => {
                  onOpenInspectEntities?.();
                  postTakeoffMessage({ type: "open-inspect-entities" });
                }}
                onImportAll={handleSpreadsheetImportAllFromToolbar}
              />
              <SpreadsheetAiMenu
                disabled={!spreadsheetPreview}
                onSummarize={handleSpreadsheetSummarize}
              />
            </div>
          </>
        )}

        {isCadDocument && (
          <>
            <Separator className="hidden !h-6 !w-px shrink-0 md:block" />
            <div className="hidden min-w-0 max-w-72 flex-col px-1 md:flex">
              <span className="truncate text-[11px] font-medium text-fg/65">{selectedDoc?.fileName ?? "3D model"}</span>
              <span className="truncate text-[10px] text-fg/35">
                {isBimDocument ? "BIM takeoff surface" : "3D takeoff surface"}
              </span>
            </div>
            <div className="flex min-w-0 items-center gap-1 rounded-md border border-line bg-bg/35 p-0.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={handleModelFitView}
                title="Fit model"
                aria-label="Fit model"
                className="h-7 w-7 shrink-0 px-0"
              >
                <Scan className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={handleModelResetView}
                title="Reset model view"
                aria-label="Reset model view"
                className="h-7 w-7 shrink-0 px-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <ModelViewMenu currentView={modelStandardView} onView={handleModelStandardView} />
              <ModelDisplayMenu
                mode={modelDisplayMode}
                gridVisible={modelGridVisible}
                autoRotate={modelAutoRotate}
                onMode={handleModelDisplayMode}
                onGrid={handleModelGridToggle}
                onAutoRotate={handleModelAutoRotateToggle}
              />
              <Popover.Root>
                <Popover.Trigger asChild>
                  <Button variant="ghost" size="xs" className="h-7 shrink-0 gap-1.5 px-2 text-[11px]" title="Model takeoff">
                    <Boxes className="h-3.5 w-3.5" />
                    <span>Takeoff</span>
                    <ChevronDown className="h-3 w-3 text-fg/40" />
                  </Button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content align="start" sideOffset={6} className="z-[1000] w-64 rounded-lg border border-line bg-panel p-1.5 shadow-xl outline-none">
                    <Popover.Close asChild>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenInspectEntities?.();
                          postTakeoffMessage({ type: "open-inspect-entities" });
                        }}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg"
                      >
                        <Boxes className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate font-medium">Review Entities</span>
                      </button>
                    </Popover.Close>
                    <Popover.Close asChild>
                      <button
                        type="button"
                        onClick={() => void refreshModelAssets(true)}
                        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] text-fg/70 transition-colors hover:bg-panel2 hover:text-fg"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", modelSyncing && "animate-spin")} />
                        <span className="min-w-0 flex-1 truncate font-medium">Sync Model Index</span>
                      </button>
                    </Popover.Close>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              {selectedModelIsEditable && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={handleOpenModelEditor}
                  title="Open compatible model in editor"
                  aria-label="Open compatible model in editor"
                  className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Edit</span>
                  <ExternalLink className="h-3 w-3 text-fg/45" />
                </Button>
              )}
            </div>
          </>
        )}

        <div className="min-w-2 flex-1" />

        {isPdfDocument && (
          <>
            <Select
              value={shortcutPreset}
              onValueChange={(value) => {
                if (isTakeoffShortcutPreset(value)) setShortcutPreset(value);
              }}
              options={TAKEOFF_SHORTCUT_PRESET_OPTIONS}
              className="h-7 w-[112px] shrink-0 text-[11px]"
            />
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
        {!detached && (
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
        )}
      </div>
      )}

      {/* ─── No-Calibration Warning ─── */}
      {isPdfDocument && !calibration && activeTool && isMeasurementTool(activeTool) && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2.5 shrink-0">
          <Scaling className="h-4 w-4 text-amber-500 shrink-0 animate-pulse" />
          <div className="flex-1">
            <p className="text-xs font-medium text-fg/85">
              Drawing scale isn't set — measurements will be in pixels until you calibrate.
            </p>
            <p className="text-[11px] text-fg/50 mt-0.5">
              Use Measure &gt; Set Scale before creating real measurements.
            </p>
          </div>
        </div>
      )}

      {/* ─── Auto-Count Banner ─── */}
      {isPdfDocument && (isAutoCountActive || autoCountRunning) && (
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
                Click and drag a tight box around one example. The CV pipeline finds all visual matches and adds one Pickup row with the count.
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

      {/* ─── Ask AI Banner ─── */}
      {isPdfDocument && isAskAiActive && (
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
            {spreadsheetPreview ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                {spreadsheetPanelView === "preview" && (
                  <div className="flex min-h-0 flex-1 flex-col">
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
                  <div className="grid min-h-0 flex-1 gap-3">
                    <div className="flex min-h-0 items-center gap-2 rounded-md border border-line bg-bg/35 px-3 py-2 text-[11px] text-fg/50">
                      <Sigma className="h-3.5 w-3.5 text-accent" />
                      <span className="min-w-0 flex-1 truncate">
                        Grouped by <span className="font-medium text-fg/70">{(activePivotSummary?.groupBy ?? pivotGroupBy) || "field"}</span>
                        {" · "}
                        Measure <span className="font-medium text-fg/70">{activePivotSummary?.measure === "__count" ? "Row count" : activePivotSummary?.measure ?? pivotMeasure}</span>
                      </span>
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
                      : "Choose a source from the intake list to preview or transform."}
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
              setDwgIntelligence(null);
              setDwgEntityLinks([]);
              updateAnnotationSelection(null);
              setAutoCountResults(null);
              setAutoCountSnippet(null);
            }}
            onWorkspaceMutated={notifyWorkspaceMutated}
            onSelectedEntityChange={(entitySelection) => {
              if (entitySelection) {
                publishTakeoffSelection({
                  kind: "cad-entity",
                  documentId: entitySelection.documentId,
                  entityId: entitySelection.entityId,
                  entityType: entitySelection.entityType,
                  layer: entitySelection.layer,
                  label: entitySelection.label,
                  summary: entitySelection.summary,
                });
              } else if (selection?.kind === "cad-entity" || !onSelectionChange) {
                publishTakeoffSelection(null);
              }
            }}
            onSelectedAnnotationChange={(pickupId) => {
              if (pickupId) {
                publishTakeoffSelection({ kind: "annotation", pickupId });
              } else if (selection?.kind === "annotation" || !onSelectionChange) {
                publishTakeoffSelection(null);
              }
            }}
            onAnnotationsChange={setDwgAnnotationsCache}
            actionsRef={dwgActionsRef}
            onOpenDrawingIntelligence={() => {
              onOpenInspectEntities?.();
              postTakeoffMessage({ type: "open-inspect-entities" });
            }}
            onIntelligenceChange={setDwgIntelligence}
            toolbarStart={
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
            }
            toolbarEnd={
              <>
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
                {!detached && (
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
                )}
              </>
            }
          />
        ) : (
          <>

        {/* Left: Quick controls */}
        {isPdfDocument && (
          <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden border-r border-line bg-panel p-0.5">
            {(["select"] as ToolId[]).map((id) => {
              const tool = TOOLS.find((item) => item.id === id);
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleToolSelect(id)}
                  title={tool.label}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                    activeTool === id
                      ? "bg-accent/15 text-accent"
                      : "text-fg/45 hover:bg-panel2 hover:text-fg/75",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
            <div className="my-0.5 h-px w-full bg-line/60" />
            <button
              type="button"
              onClick={() => setSnapEnabled((value) => !value)}
              title="Toggle PDF snap"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                snapEnabled ? "bg-sky-500/10 text-sky-500" : "text-fg/40 hover:bg-panel2 hover:text-fg/70",
              )}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {isCadDocument && (
          <div className="flex w-9 shrink-0 flex-col items-center gap-0.5 overflow-y-auto overflow-x-hidden border-r border-line bg-panel p-0.5">
            <button
              type="button"
              title={isBimDocument ? "Select BIM elements" : "Inspect model"}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent transition-colors"
              onClick={() => {
                onOpenInspectEntities?.();
                postTakeoffMessage({ type: "open-inspect-entities" });
              }}
            >
              <MousePointer2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleModelFitView}
              title="Fit model"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg/45 transition-colors hover:bg-panel2 hover:text-fg/75"
            >
              <Scan className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleModelDisplayMode(modelDisplayMode === "xray" ? "shaded" : "xray")}
              title="Toggle X-Ray"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                modelDisplayMode === "xray" ? "bg-violet-500/10 text-violet-500" : "text-fg/45 hover:bg-panel2 hover:text-fg/75",
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleModelGridToggle}
              title="Toggle reference grid"
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                modelGridVisible ? "bg-sky-500/10 text-sky-500" : "text-fg/45 hover:bg-panel2 hover:text-fg/75",
              )}
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
            <div className="my-0.5 h-px w-full bg-line/60" />
            <button
              type="button"
              onClick={() => void refreshModelAssets(true)}
              title="Sync model index"
              className="flex h-7 w-7 items-center justify-center rounded-md text-fg/45 transition-colors hover:bg-panel2 hover:text-fg/75"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", modelSyncing && "animate-spin")} />
            </button>
            {selectedModelIsEditable && (
              <button
                type="button"
                onClick={handleOpenModelEditor}
                title="Open model editor in new tab"
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg/45 transition-colors hover:bg-panel2 hover:text-fg/75"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Center: Document viewer area. The outer `relative` wrapper hosts
            the processing overlay so it stays viewport-fixed regardless of
            how the PDF inside is panned or zoomed — previously the overlay
            sat inside the scrolling content area and slid off-screen as
            soon as the user zoomed in. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={viewerContainerRef}
          className={cn(
            "flex flex-1 bg-bg/50",
            isCadDocument ? "items-stretch justify-stretch overflow-hidden" : "items-start justify-start overflow-auto"
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
              <CadViewer
                fileUrl={documentUrl}
                fileName={selectedDoc?.fileName}
                onIfcElementSelect={handleIfcElementSelect}
                actionsRef={modelViewerActionsRef}
                displayMode={modelDisplayMode}
                showGrid={modelGridVisible}
                autoRotate={modelAutoRotate}
                showOverlayToolbar={false}
              />
            </div>
          ) : (
            <div className="relative mx-auto my-4 inline-block shrink-0">
                  {/* PDF canvas */}
                  <div className={cn("relative transition-[filter] duration-150", pdfSpotlightActive && "grayscale contrast-125 brightness-75")}>
                    <PdfCanvasViewer
                      documentUrl={documentUrl}
                      pageNumber={page}
                      zoom={zoom}
                      onPageCount={handlePageCount}
                      onCanvasResize={handleCanvasResize}
                      canvasRef={pdfCanvasRef}
                    />
                  </div>
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
                    selectedPickupId={selectedPickupId}
                    spotlightActive={pdfSpotlightActive}
                  />
                  <DrawingIntelligenceOverlay
                    analysis={drawingAnalysisResult}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    visible={drawingAnalysisOverlay}
                    selectedId={selectedDrawingDetectionId}
                    spotlightActive={pdfSpotlightActive}
                    onSelectDetection={(id, kind) => {
                      // Canvas → panel sync. The kind hint lets the
                      // controller scroll to the right row group when the
                      // user clicks a detection on the overlay.
                      handleSelectDrawingDetection(id);
                      void kind;
                    }}
                  />
                  <SmartCountOverlay
                    bbox={smartCountBbox}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    active={Boolean(selectedSmartCountItemId)}
                    muted={pdfSpotlightActive && !selectedSmartCountItemId}
                  />

            </div>
          )}
        </div>
        {/* Processing overlay — sits in the OUTER `relative` wrapper, NOT
            inside the scrolling PDF content. That's the whole reason for
            the wrapper: at any zoom level, the overlay covers the viewport
            and the loader card stays centered. */}
        {(autoCountRunning || askAiRunning || smartCountRunning || drawingAnalysisRunning) && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-sm">
            <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-panel px-5 py-3 shadow-xl">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
              <div>
                <p className="text-sm font-medium text-fg">
                  {drawingAnalysisRunning
                    ? "Analyzing drawing geometry..."
                    : autoCountRunning
                      ? "Running symbol detection..."
                      : smartCountRunning
                        ? "Running Smart Count..."
                        : "Cropping region for AI analysis..."}
                </p>
                <p className="text-xs text-fg/40">
                  {drawingAnalysisRunning
                    ? "Tracing linework, symbols, text zones, and connected systems"
                    : autoCountRunning
                      ? "OpenCV template matching + feature detection"
                      : smartCountRunning
                        ? "Cropping the region and extracting count rows into Pickups"
                        : "Preparing image crop"}
                </p>
              </div>
            </div>
          </div>
        )}
        </div>

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
        const expected = parseConstructionDimensionToUnit(verifyExpected, calibration.unit);
        const errorPct =
          expected !== null && expected > 0 && Number.isFinite(expected) ? ((measured - expected) / expected) * 100 : null;
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
                      type="text"
                      inputMode="decimal"
                      placeholder={`10, 10' 6", or 126 in`}
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
        const distNum = parseConstructionDimensionToUnit(calibrationInput, calibrationUnit);
        const livePerUnit = distNum !== null && distNum > 0 ? (pixelDist / distNum) : null;
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
                    type="text"
                    inputMode="decimal"
                    placeholder={`10, 10' 6", 10-6, or 3 m`}
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
                          distNum !== null && Math.abs(distNum - p.value) < 0.000001 && calibrationUnit === p.unit
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
      {/* Auto Count no longer has a floating confirm modal — its results
          flow directly into the Pickups panel as a single row with the
          template thumbnail, match count, and an Add-to-worksheet button.
          User refines via the panel (delete + redraw with better template
          / threshold), not via a modal blocking the canvas. */}

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

      {!isDwgDocument && (
      /* ─── Status Bar ─── */
      <div className="flex items-center gap-3 border-t border-line bg-panel px-3 py-1.5 shrink-0">
        <p className="text-[11px] text-fg/40">
          {isCadDocument
            ? isBimDocument
              ? "BIM takeoff active. Select IFC elements to inspect and create worksheet items."
              : "3D model takeoff active. Use View and Display to inspect geometry."
            : TOOL_STATUS_TEXT[activeTool] ?? "Select a tool to begin."}
        </p>
        <div className="flex-1" />
        {isPdfDocument && calibration && (
          <span className="text-[11px] text-fg/30">
            Scale: 1 {calibration.unit} = {calibration.pixelsPerUnit.toFixed(1)}px
          </span>
        )}
        {isPdfDocument && (
          <>
            <span className="text-[11px] text-fg/30">
              Page {page}/{totalPages}
            </span>
            <span className="text-[11px] text-fg/30">
              {zoomPercent}%
            </span>
          </>
        )}
        {isSpreadsheetDocument && spreadsheetPreview && (
          <span className="text-[11px] text-fg/30">
            {spreadsheetPanelView === "pivot" && activePivotSummary
              ? `Pivot Summary · ${activePivotSummary.rows.length.toLocaleString()} groups · ${(spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length).toLocaleString()} rows`
              : `Table Preview · ${(spreadsheetPreview.rowCount ?? spreadsheetPreview.sampleRows.length).toLocaleString()} rows`}
          </span>
        )}
        {isCadDocument && selectedModelIsEditable && (
          <span className="text-[11px] text-fg/30">
            Editor available from toolbar
          </span>
        )}
      </div>
      )}

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

function SmartCountOverlay({
  bbox,
  width,
  height,
  active,
  muted = false,
}: {
  bbox: VisionBoundingBox | null;
  width: number;
  height: number;
  active: boolean;
  muted?: boolean;
}) {
  if (!bbox || width <= 0 || height <= 0) return null;
  const sx = width / Math.max(1, bbox.imageWidth);
  const sy = height / Math.max(1, bbox.imageHeight);
  const box = {
    x: bbox.x * sx,
    y: bbox.y * sy,
    width: bbox.width * sx,
    height: bbox.height * sy,
  };
  const corner = Math.min(24, Math.max(10, Math.min(box.width, box.height) * 0.18));

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[4]"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={muted ? "#64748b" : "#10b981"}
        fillOpacity={active ? 0.08 : muted ? 0.025 : 0.04}
        stroke={active ? "#f97316" : muted ? "#64748b" : "#10b981"}
        strokeWidth={active ? 2.5 : 1.5}
        strokeDasharray="8 4"
        rx={5}
        opacity={active ? 0.96 : muted ? 0.2 : 0.72}
      />
      {active && [
        [box.x, box.y, box.x + corner, box.y],
        [box.x, box.y, box.x, box.y + corner],
        [box.x + box.width, box.y, box.x + box.width - corner, box.y],
        [box.x + box.width, box.y, box.x + box.width, box.y + corner],
        [box.x, box.y + box.height, box.x + corner, box.y + box.height],
        [box.x, box.y + box.height, box.x, box.y + box.height - corner],
        [box.x + box.width, box.y + box.height, box.x + box.width - corner, box.y + box.height],
        [box.x + box.width, box.y + box.height, box.x + box.width, box.y + box.height - corner],
      ].map(([x1, y1, x2, y2], index) => (
        <g key={`smart-count-corner-${index}`}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffffff" strokeWidth={5} strokeLinecap="round" opacity={0.82} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f97316" strokeWidth={2.4} strokeLinecap="round" />
        </g>
      ))}
    </svg>
  );
}

// ── Primitive → SVG path helpers ─────────────────────────────────────────
// Used by DrawingIntelligenceOverlay to render canonical primitives over
// the rendered PDF canvas. All inputs are in PDF-point space; outputs in
// canvas-pixel space via the caller-supplied scale factors.

function primitiveParam(value: number | number[] | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** SVG path "d" for an arc primitive. Uses the standard `A` command with
 *  the correct large-arc / sweep flags derived from the angular sweep. */
function arcPathDescription(
  primitive: DrawingPrimitive,
  scaleX: number,
  scaleY: number,
): string {
  const cx = primitiveParam(primitive.params.cx) * scaleX;
  const cy = primitiveParam(primitive.params.cy) * scaleY;
  const rx = primitiveParam(primitive.params.r) * scaleX;
  const ry = primitiveParam(primitive.params.r) * scaleY;
  const start = primitiveParam(primitive.params.startAngleRad);
  const end = primitiveParam(primitive.params.endAngleRad);
  const startX = cx + rx * Math.cos(start);
  const startY = cy + ry * Math.sin(start);
  const endX = cx + rx * Math.cos(end);
  const endY = cy + ry * Math.sin(end);
  // Use directed sweep to pick the right large-arc flag. CCW direction
  // maps to SVG sweep-flag 1.
  const twoPi = Math.PI * 2;
  let directedSweep = (end - start) % twoPi;
  if (directedSweep < 0) directedSweep += twoPi;
  const largeArc = directedSweep > Math.PI ? 1 : 0;
  const sweepFlag = 1;
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${rx.toFixed(2)} ${ry.toFixed(2)} 0 ${largeArc} ${sweepFlag} ${endX.toFixed(2)} ${endY.toFixed(2)}`;
}

function cubicPathDescription(
  primitive: DrawingPrimitive,
  scaleX: number,
  scaleY: number,
): string {
  const pts = Array.isArray(primitive.params.points) ? primitive.params.points : [];
  if (pts.length < 8) return "";
  const [x0, y0, x1, y1, x2, y2, x3, y3] = pts;
  return `M ${(x0! * scaleX).toFixed(2)} ${(y0! * scaleY).toFixed(2)} `
    + `C ${(x1! * scaleX).toFixed(2)} ${(y1! * scaleY).toFixed(2)},`
    + ` ${(x2! * scaleX).toFixed(2)} ${(y2! * scaleY).toFixed(2)},`
    + ` ${(x3! * scaleX).toFixed(2)} ${(y3! * scaleY).toFixed(2)}`;
}

function quadPathDescription(
  primitive: DrawingPrimitive,
  scaleX: number,
  scaleY: number,
): string {
  const pts = Array.isArray(primitive.params.points) ? primitive.params.points : [];
  if (pts.length < 6) return "";
  const [x0, y0, x1, y1, x2, y2] = pts;
  return `M ${(x0! * scaleX).toFixed(2)} ${(y0! * scaleY).toFixed(2)} `
    + `Q ${(x1! * scaleX).toFixed(2)} ${(y1! * scaleY).toFixed(2)},`
    + ` ${(x2! * scaleX).toFixed(2)} ${(y2! * scaleY).toFixed(2)}`;
}

/** Axis-aligned bounds of a primitive after multiplying its coordinates
 *  by the supplied (scaleX, scaleY). Same routine serves two callers:
 *
 *    - Canvas overlay: scale = `coordinateSpace.imagePixelPerPdfPoint{X,Y}
 *      × analysis-to-canvas` → bounds in canvas-pixel space.
 *    - drawingDetectionBounds: scale = `coordinateSpace.imagePixelPerPdfPoint{X,Y}`
 *      → bounds in image-pixel space (the contract that
 *      focusDrawingBounds expects).
 *
 *  Returns null when the primitive has no usable geometry. */
function primitiveScaledBounds(
  primitive: DrawingPrimitive,
  scaleX: number,
  scaleY: number,
): { x: number; y: number; width: number; height: number } | null {
  const { params } = primitive;
  switch (primitive.kind) {
    case "line": {
      const x1 = primitiveParam(params.x1) * scaleX;
      const y1 = primitiveParam(params.y1) * scaleY;
      const x2 = primitiveParam(params.x2) * scaleX;
      const y2 = primitiveParam(params.y2) * scaleY;
      return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
      };
    }
    case "rect":
      return {
        x: primitiveParam(params.x) * scaleX,
        y: primitiveParam(params.y) * scaleY,
        width: primitiveParam(params.width) * scaleX,
        height: primitiveParam(params.height) * scaleY,
      };
    case "circle": {
      const cx = primitiveParam(params.cx) * scaleX;
      const cy = primitiveParam(params.cy) * scaleY;
      const r = primitiveParam(params.r) * ((scaleX + scaleY) / 2);
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    case "arc": {
      // Tight bounds would require checking which cardinal points the
      // sweep crosses; the full-circle envelope is a safe overestimate and
      // matches what the system tracer does for ARC entities elsewhere.
      const cx = primitiveParam(params.cx) * scaleX;
      const cy = primitiveParam(params.cy) * scaleY;
      const r = primitiveParam(params.r) * ((scaleX + scaleY) / 2);
      return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
    }
    case "ellipse": {
      const cx = primitiveParam(params.cx) * scaleX;
      const cy = primitiveParam(params.cy) * scaleY;
      const rx = primitiveParam(params.rx) * scaleX;
      const ry = primitiveParam(params.ry) * scaleY;
      // The bounds widen under rotation; approximate with the major axis
      // on both axes so the selection halo always contains the shape.
      const radius = Math.max(rx, ry);
      return { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 };
    }
    case "cubic_bezier":
    case "quad_bezier": {
      const pts = Array.isArray(params.points) ? params.points : [];
      if (pts.length < 4) return null;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        xs.push(pts[i]! * scaleX);
        ys.push(pts[i + 1]! * scaleY);
      }
      if (xs.length === 0) return null;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    default:
      return null;
  }
}

function DrawingIntelligenceOverlay({
  analysis,
  width,
  height,
  visible,
  selectedId,
  spotlightActive = false,
  onSelectDetection,
}: {
  analysis: DrawingGeometryAnalysisResult | null;
  width: number;
  height: number;
  visible: DrawingAnalysisOverlayState;
  selectedId?: string | null;
  spotlightActive?: boolean;
  /** Optional canvas-side click handler. When supplied, individual
   *  detections become pointer-interactive: clicking a line / system /
   *  symbol / circle / arc / curve on the overlay fires this callback so
   *  the right-hand panel can highlight the matching row. Leaves the
   *  overlay non-blocking when omitted (the legacy behavior). */
  onSelectDetection?: (id: string, kind: "system" | "line" | "symbol" | "circle" | "text" | "arc" | "curve") => void;
}) {
  if (!analysis || width <= 0 || height <= 0) return null;

  const sx = width / Math.max(analysis.imageWidth, 1);
  const sy = height / Math.max(analysis.imageHeight, 1);
  // Combined factor from PDF-point (primitive native units) to canvas-pixel.
  // Falls back to `sx` / `sy` (image-pixel→canvas) when coordinateSpace is
  // missing — that case shouldn't fire for any pipeline that emitted
  // primitives, but we degrade gracefully rather than NaN.
  const cs = analysis.coordinateSpace;
  const ptToCanvasX = cs ? cs.imagePixelPerPdfPointX * sx : sx;
  const ptToCanvasY = cs ? cs.imagePixelPerPdfPointY * sy : sy;
  const ptToCanvasAvg = (ptToCanvasX + ptToCanvasY) / 2;

  const lineById = new Map(analysis.lines.map((line) => [line.id, line]));
  const systemColors = ["#0ea5e9", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6"];
  // Drop text-category primitives entirely from the canvas overlay. The
  // density grid in analyze_geometry.py flagged these as glyph strokes /
  // decorative ticks — rendering thousands of them tanks SVG perf and
  // adds visual noise on top of the (already rasterized) PDF page. The
  // candidate list also filters them out, so the two views stay consistent.
  const primitives = (analysis.primitives ?? []).filter(
    (p) => (p.category ?? "drawing") !== "text",
  );
  const arcPrimitives = primitives.filter(
    (p) => p.kind === "arc" || p.kind === "circle" || p.kind === "ellipse",
  );
  const curvePrimitives = primitives.filter(
    (p) => p.kind === "cubic_bezier" || p.kind === "quad_bezier",
  );
  const selectedSystem = selectedId ? analysis.systems.find((system) => system.id === selectedId) : null;
  const selectedLine = selectedId ? analysis.lines.find((line) => line.id === selectedId) : null;
  const selectedSymbol = selectedId ? analysis.symbolCandidates.find((candidate) => candidate.id === selectedId) : null;
  const selectedCircle = selectedId ? analysis.circles.find((circle) => circle.id === selectedId) : null;
  const selectedText = selectedId ? analysis.textRegions.find((region) => region.id === selectedId) : null;
  const selectedPrimitive = selectedId
    ? primitives.find((primitive) => primitive.id === selectedId) ?? null
    : null;
  const selectedPrimitiveBounds = selectedPrimitive
    ? primitiveScaledBounds(selectedPrimitive, ptToCanvasX, ptToCanvasY)
    : null;
  const muted = (id: string) => spotlightActive && selectedId !== id;
  const selectedBounds = selectedSystem?.bbox
    ?? selectedLine?.bbox
    ?? (selectedSymbol ? { x: selectedSymbol.x, y: selectedSymbol.y, width: selectedSymbol.w, height: selectedSymbol.h } : null)
    ?? selectedCircle?.bbox
    ?? (selectedText ? { x: selectedText.x, y: selectedText.y, width: selectedText.w, height: selectedText.h } : null)
    ?? (selectedPrimitiveBounds
        ? {
            x: selectedPrimitiveBounds.x / sx,
            y: selectedPrimitiveBounds.y / sy,
            width: selectedPrimitiveBounds.width / sx,
            height: selectedPrimitiveBounds.height / sy,
          }
        : null);

  // Each interactive shape uses `pointer-events: stroke` (lines / open
  // arcs / curves) or `pointer-events: visible` (filled / closed shapes)
  // so the overlay is click-through everywhere EXCEPT on a real
  // detection. Without this, the whole SVG would swallow canvas pan
  // / annotation interactions.
  const interactive = Boolean(onSelectDetection);
  const interactiveProps = (id: string, kind: Parameters<NonNullable<typeof onSelectDetection>>[1]) => interactive
    ? {
        onPointerDown: (event: ReactPointerEvent<SVGElement>) => {
          event.stopPropagation();
          onSelectDetection?.(id, kind);
        },
        style: { cursor: "pointer" as const, pointerEvents: "stroke" as const },
      }
    : { style: { pointerEvents: "none" as const } };
  const interactiveFilledProps = (id: string, kind: Parameters<NonNullable<typeof onSelectDetection>>[1]) => interactive
    ? {
        onPointerDown: (event: ReactPointerEvent<SVGElement>) => {
          event.stopPropagation();
          onSelectDetection?.(id, kind);
        },
        style: { cursor: "pointer" as const, pointerEvents: "all" as const },
      }
    : { style: { pointerEvents: "none" as const } };
  const selectedBox = selectedBounds
    ? {
        x: selectedBounds.x * sx,
        y: selectedBounds.y * sy,
        width: selectedBounds.width * sx,
        height: selectedBounds.height * sy,
      }
    : null;
  const selectedCorner = selectedBox ? Math.min(22, Math.max(8, Math.min(selectedBox.width, selectedBox.height) * 0.22)) : 0;

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[3]"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {visible.lines && analysis.lines.map((line) => (
        <line
          key={`line-${line.id}`}
          x1={line.x1 * sx}
          y1={line.y1 * sy}
          x2={line.x2 * sx}
          y2={line.y2 * sy}
          stroke={selectedId === line.id ? "#f97316" : muted(line.id) ? "#64748b" : "#38bdf8"}
          strokeWidth={selectedId === line.id ? 4 : 1.2}
          opacity={selectedId === line.id ? 0.95 : muted(line.id) ? 0.14 : 0.32}
          strokeLinecap="round"
          {...interactiveProps(line.id, "line")}
        />
      ))}

      {visible.systems && analysis.systems.map((system, systemIndex) => {
        const color = systemColors[systemIndex % systemColors.length];
        return system.segmentIds.map((segmentId) => {
          const line = lineById.get(segmentId);
          if (!line) return null;
          return (
            <line
              key={`system-${system.id}-${segmentId}`}
              x1={line.x1 * sx}
              y1={line.y1 * sy}
              x2={line.x2 * sx}
              y2={line.y2 * sy}
              stroke={selectedId === system.id ? "#f97316" : muted(system.id) ? "#64748b" : color}
              strokeWidth={selectedId === system.id ? 4.5 : 2.6}
              opacity={selectedId === system.id ? 0.95 : muted(system.id) ? 0.18 : 0.72}
              strokeLinecap="round"
              {...interactiveProps(system.id, "system")}
            />
          );
        });
      })}

      {visible.symbols && analysis.symbolCandidates.map((candidate) => (
        <rect
          key={`symbol-${candidate.id}`}
          x={candidate.x * sx}
          y={candidate.y * sy}
          width={candidate.w * sx}
          height={candidate.h * sy}
          fill="none"
          stroke={selectedId === candidate.id ? "#f97316" : muted(candidate.id) ? "#64748b" : "#f59e0b"}
          strokeWidth={selectedId === candidate.id ? 3 : 1.5}
          opacity={selectedId === candidate.id ? 0.98 : muted(candidate.id) ? 0.18 : 0.8}
          rx={3}
          {...interactiveFilledProps(candidate.id, "symbol")}
        />
      ))}

      {visible.circles && analysis.circles.map((circle) => (
        <circle
          key={`circle-${circle.id}`}
          cx={circle.cx * sx}
          cy={circle.cy * sy}
          r={Math.max(circle.radius * ((sx + sy) / 2), 2)}
          fill="none"
          stroke={selectedId === circle.id ? "#f97316" : muted(circle.id) ? "#64748b" : "#ec4899"}
          strokeWidth={selectedId === circle.id ? 3 : 1.5}
          opacity={selectedId === circle.id ? 0.98 : muted(circle.id) ? 0.18 : 0.75}
          {...interactiveProps(circle.id, "circle")}
        />
      ))}

      {visible.text && analysis.textRegions.map((region) => (
        <rect
          key={`text-${region.id}`}
          x={region.x * sx}
          y={region.y * sy}
          width={region.w * sx}
          height={region.h * sy}
          fill="#111827"
          fillOpacity={muted(region.id) ? 0.02 : 0.05}
          stroke={selectedId === region.id ? "#f97316" : "#64748b"}
          strokeDasharray="4 3"
          strokeWidth={selectedId === region.id ? 2.5 : 1}
          opacity={selectedId === region.id ? 0.95 : muted(region.id) ? 0.16 : 0.65}
          {...interactiveFilledProps(region.id, "text")}
        />
      ))}

      {visible.arcs && arcPrimitives.map((primitive) => {
        const stroke = selectedId === primitive.id
          ? "#f97316"
          : muted(primitive.id) ? "#64748b" : "#f59e0b";
        const strokeWidth = selectedId === primitive.id ? 3.5 : 1.8;
        const opacity = selectedId === primitive.id
          ? 0.97
          : muted(primitive.id) ? 0.18 : 0.78;
        const filled = primitive.paint === "fill" || primitive.paint === "stroke+fill";
        if (primitive.kind === "circle") {
          const cx = primitiveParam(primitive.params.cx) * ptToCanvasX;
          const cy = primitiveParam(primitive.params.cy) * ptToCanvasY;
          const r = Math.max(primitiveParam(primitive.params.r) * ptToCanvasAvg, 2);
          return (
            <circle
              key={`prim-circle-${primitive.id}`}
              cx={cx}
              cy={cy}
              r={r}
              fill={filled ? stroke : "none"}
              fillOpacity={filled ? 0.12 : undefined}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              {...(filled ? interactiveFilledProps(primitive.id, "arc") : interactiveProps(primitive.id, "arc"))}
            />
          );
        }
        if (primitive.kind === "ellipse") {
          const cx = primitiveParam(primitive.params.cx) * ptToCanvasX;
          const cy = primitiveParam(primitive.params.cy) * ptToCanvasY;
          const rx = Math.max(primitiveParam(primitive.params.rx) * ptToCanvasX, 1);
          const ry = Math.max(primitiveParam(primitive.params.ry) * ptToCanvasY, 1);
          const rotDeg = (primitiveParam(primitive.params.rotationRad) * 180) / Math.PI;
          return (
            <ellipse
              key={`prim-ellipse-${primitive.id}`}
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              transform={`rotate(${rotDeg.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})`}
              fill={filled ? stroke : "none"}
              fillOpacity={filled ? 0.12 : undefined}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
              {...(filled ? interactiveFilledProps(primitive.id, "arc") : interactiveProps(primitive.id, "arc"))}
            />
          );
        }
        // kind === "arc": use a <path> with the SVG A command so the
        // partial-sweep shape renders correctly. Stroke-only (arcs aren't
        // closed unless they're full 2π, in which case they hit the
        // circle branch via the parser's normalizer — but we still handle
        // the 2π-as-arc case visually).
        const d = arcPathDescription(primitive, ptToCanvasX, ptToCanvasY);
        return (
          <path
            key={`prim-arc-${primitive.id}`}
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
            strokeLinecap="round"
            {...interactiveProps(primitive.id, "arc")}
          />
        );
      })}

      {visible.curves && curvePrimitives.map((primitive) => {
        const stroke = selectedId === primitive.id
          ? "#f97316"
          : muted(primitive.id) ? "#64748b" : "#a855f7";
        const strokeWidth = selectedId === primitive.id ? 3.5 : 1.8;
        const opacity = selectedId === primitive.id
          ? 0.97
          : muted(primitive.id) ? 0.18 : 0.78;
        const d = primitive.kind === "cubic_bezier"
          ? cubicPathDescription(primitive, ptToCanvasX, ptToCanvasY)
          : quadPathDescription(primitive, ptToCanvasX, ptToCanvasY);
        if (!d) return null;
        return (
          <path
            key={`prim-curve-${primitive.id}`}
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={opacity}
            strokeLinecap="round"
            {...interactiveProps(primitive.id, "curve")}
          />
        );
      })}

      {selectedPrimitive && selectedPrimitiveBounds && (
        // Toggle off the layer → toggle off the halo too. Without this
        // gate, hiding `visible.arcs` would leave an orphaned orange
        // halo over an invisible shape (the bulk shape disappears, the
        // halo stays). isBezierKind decides which toggle the primitive
        // belongs to; arc/circle/ellipse live under `arcs`, both bezier
        // kinds live under `curves`.
        (
          selectedPrimitive.kind === "cubic_bezier" || selectedPrimitive.kind === "quad_bezier"
            ? visible.curves
            : visible.arcs
        ) && (
        // Filled highlight that traces the same shape twice — once thick
        // and white for contrast on busy drawings, once tinted accent on
        // top. Matches the existing pattern for selected systems / lines.
        <g pointerEvents="none">
          {selectedPrimitive.kind === "circle" ? (
            <circle
              cx={primitiveParam(selectedPrimitive.params.cx) * ptToCanvasX}
              cy={primitiveParam(selectedPrimitive.params.cy) * ptToCanvasY}
              r={Math.max(primitiveParam(selectedPrimitive.params.r) * ptToCanvasAvg, 3)}
              fill="#f97316"
              fillOpacity={0.1}
              stroke="#f97316"
              strokeWidth={3}
            />
          ) : selectedPrimitive.kind === "ellipse" ? (
            <ellipse
              cx={primitiveParam(selectedPrimitive.params.cx) * ptToCanvasX}
              cy={primitiveParam(selectedPrimitive.params.cy) * ptToCanvasY}
              rx={Math.max(primitiveParam(selectedPrimitive.params.rx) * ptToCanvasX, 2)}
              ry={Math.max(primitiveParam(selectedPrimitive.params.ry) * ptToCanvasY, 2)}
              transform={`rotate(${((primitiveParam(selectedPrimitive.params.rotationRad) * 180) / Math.PI).toFixed(2)} ${(primitiveParam(selectedPrimitive.params.cx) * ptToCanvasX).toFixed(2)} ${(primitiveParam(selectedPrimitive.params.cy) * ptToCanvasY).toFixed(2)})`}
              fill="#f97316"
              fillOpacity={0.1}
              stroke="#f97316"
              strokeWidth={3}
            />
          ) : (
            // Arcs + beziers: redraw the path with a white halo then an
            // orange accent. Reuses the same path-d builder so the halo
            // traces the exact rendered shape.
            <>
              <path
                d={selectedPrimitive.kind === "arc"
                  ? arcPathDescription(selectedPrimitive, ptToCanvasX, ptToCanvasY)
                  : selectedPrimitive.kind === "cubic_bezier"
                    ? cubicPathDescription(selectedPrimitive, ptToCanvasX, ptToCanvasY)
                    : selectedPrimitive.kind === "quad_bezier"
                      ? quadPathDescription(selectedPrimitive, ptToCanvasX, ptToCanvasY)
                      : ""}
                fill="none"
                stroke="#ffffff"
                strokeWidth={7}
                opacity={0.75}
                strokeLinecap="round"
              />
              <path
                d={selectedPrimitive.kind === "arc"
                  ? arcPathDescription(selectedPrimitive, ptToCanvasX, ptToCanvasY)
                  : selectedPrimitive.kind === "cubic_bezier"
                    ? cubicPathDescription(selectedPrimitive, ptToCanvasX, ptToCanvasY)
                    : selectedPrimitive.kind === "quad_bezier"
                      ? quadPathDescription(selectedPrimitive, ptToCanvasX, ptToCanvasY)
                      : ""}
                fill="none"
                stroke="#f97316"
                strokeWidth={4}
                opacity={0.98}
                strokeLinecap="round"
              />
            </>
          )}
        </g>
        )
      )}

      {selectedSystem && selectedSystem.segmentIds.map((segmentId) => {
        const line = lineById.get(segmentId);
        if (!line) return null;
        return (
          <g key={`selected-system-${selectedSystem.id}-${segmentId}`}>
            <line
              x1={line.x1 * sx}
              y1={line.y1 * sy}
              x2={line.x2 * sx}
              y2={line.y2 * sy}
              stroke="#ffffff"
              strokeWidth={8}
              opacity={0.72}
              strokeLinecap="round"
            />
            <line
              x1={line.x1 * sx}
              y1={line.y1 * sy}
              x2={line.x2 * sx}
              y2={line.y2 * sy}
              stroke="#f97316"
              strokeWidth={4.6}
              opacity={0.98}
              strokeLinecap="round"
            />
          </g>
        );
      })}

      {selectedLine && (
        <g>
          <line
            x1={selectedLine.x1 * sx}
            y1={selectedLine.y1 * sy}
            x2={selectedLine.x2 * sx}
            y2={selectedLine.y2 * sy}
            stroke="#ffffff"
            strokeWidth={7}
            opacity={0.78}
            strokeLinecap="round"
          />
          <line
            x1={selectedLine.x1 * sx}
            y1={selectedLine.y1 * sy}
            x2={selectedLine.x2 * sx}
            y2={selectedLine.y2 * sy}
            stroke="#f97316"
            strokeWidth={4}
            opacity={0.98}
            strokeLinecap="round"
          />
        </g>
      )}

      {selectedSymbol && (
        <rect
          x={selectedSymbol.x * sx}
          y={selectedSymbol.y * sy}
          width={selectedSymbol.w * sx}
          height={selectedSymbol.h * sy}
          fill="#f97316"
          fillOpacity={0.12}
          stroke="#f97316"
          strokeWidth={3}
          rx={4}
        />
      )}

      {selectedCircle && (
        <circle
          cx={selectedCircle.cx * sx}
          cy={selectedCircle.cy * sy}
          r={Math.max(selectedCircle.radius * ((sx + sy) / 2), 3)}
          fill="#f97316"
          fillOpacity={0.12}
          stroke="#f97316"
          strokeWidth={3}
        />
      )}

      {selectedText && (
        <rect
          x={selectedText.x * sx}
          y={selectedText.y * sy}
          width={selectedText.w * sx}
          height={selectedText.h * sy}
          fill="#f97316"
          fillOpacity={0.08}
          stroke="#f97316"
          strokeWidth={2.5}
          strokeDasharray="6 3"
          rx={3}
        />
      )}

      {selectedBox && (
        <g>
          <rect
            x={selectedBox.x}
            y={selectedBox.y}
            width={selectedBox.width}
            height={selectedBox.height}
            fill="#f97316"
            fillOpacity={0.07}
            stroke="#f97316"
            strokeWidth={2}
            strokeDasharray="7 4"
            rx={4}
          />
          {[
            [selectedBox.x, selectedBox.y, selectedBox.x + selectedCorner, selectedBox.y],
            [selectedBox.x, selectedBox.y, selectedBox.x, selectedBox.y + selectedCorner],
            [selectedBox.x + selectedBox.width, selectedBox.y, selectedBox.x + selectedBox.width - selectedCorner, selectedBox.y],
            [selectedBox.x + selectedBox.width, selectedBox.y, selectedBox.x + selectedBox.width, selectedBox.y + selectedCorner],
            [selectedBox.x, selectedBox.y + selectedBox.height, selectedBox.x + selectedCorner, selectedBox.y + selectedBox.height],
            [selectedBox.x, selectedBox.y + selectedBox.height, selectedBox.x, selectedBox.y + selectedBox.height - selectedCorner],
            [selectedBox.x + selectedBox.width, selectedBox.y + selectedBox.height, selectedBox.x + selectedBox.width - selectedCorner, selectedBox.y + selectedBox.height],
            [selectedBox.x + selectedBox.width, selectedBox.y + selectedBox.height, selectedBox.x + selectedBox.width, selectedBox.y + selectedBox.height - selectedCorner],
          ].map(([x1, y1, x2, y2], index) => (
            <line
              key={`selected-corner-${index}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#ffffff"
              strokeWidth={5}
              strokeLinecap="round"
              opacity={0.82}
            />
          ))}
          {[
            [selectedBox.x, selectedBox.y, selectedBox.x + selectedCorner, selectedBox.y],
            [selectedBox.x, selectedBox.y, selectedBox.x, selectedBox.y + selectedCorner],
            [selectedBox.x + selectedBox.width, selectedBox.y, selectedBox.x + selectedBox.width - selectedCorner, selectedBox.y],
            [selectedBox.x + selectedBox.width, selectedBox.y, selectedBox.x + selectedBox.width, selectedBox.y + selectedCorner],
            [selectedBox.x, selectedBox.y + selectedBox.height, selectedBox.x + selectedCorner, selectedBox.y + selectedBox.height],
            [selectedBox.x, selectedBox.y + selectedBox.height, selectedBox.x, selectedBox.y + selectedBox.height - selectedCorner],
            [selectedBox.x + selectedBox.width, selectedBox.y + selectedBox.height, selectedBox.x + selectedBox.width - selectedCorner, selectedBox.y + selectedBox.height],
            [selectedBox.x + selectedBox.width, selectedBox.y + selectedBox.height, selectedBox.x + selectedBox.width, selectedBox.y + selectedBox.height - selectedCorner],
          ].map(([x1, y1, x2, y2], index) => (
            <line
              key={`selected-corner-accent-${index}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#f97316"
              strokeWidth={2.4}
              strokeLinecap="round"
            />
          ))}
        </g>
      )}
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
    { key: "circles", label: "Hough" },
    { key: "arcs", label: "Vec arc" },
    { key: "curves", label: "Vec curve" },
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

        <div className="grid grid-cols-4 gap-1">
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

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minus,
  MousePointer2,
  Plus,
  Ruler,
  Square,
  Target,
  Triangle,
  Spline,
  Scaling,
  ArrowDownToLine,
  ScanSearch,
  Loader2,
  X,
  Crosshair,
  RotateCcw,
  BrainCircuit,
  FileJson,
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
} from "lucide-react";
import type { ProjectWorkspaceData, KnowledgeBookRecord, VisionMatch, VisionBoundingBox } from "@/lib/api";
import {
  listTakeoffAnnotations,
  createTakeoffAnnotation,
  updateTakeoffAnnotation,
  deleteTakeoffAnnotation,
  getDocumentDownloadUrl,
  getBookFileUrl,
  listKnowledgeBooks,
  runVisionCountSymbols,
  runVisionCropRegion,
  runVisionCountAllPages,
  saveVisionCrop,
  askAi,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  Separator,
} from "@/components/ui";
import * as RadixSelect from "@radix-ui/react-select";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { Calibration, Point } from "@/lib/takeoff-math";
const PdfCanvasViewer = dynamic(
  () => import("./takeoff/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false }
);
const CadViewer = dynamic(
  () => import("./editors/cad-viewer").then((m) => ({ default: m.CadViewer })),
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

const CAD_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "stl", "obj", "fbx", "gltf", "glb", "3ds", "dae", "ifc", "dwg", "dxf", "rvt"]);

function isCadFile(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return CAD_EXTENSIONS.has(ext);
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
  | "ask-ai";

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
  select: "Click to select annotations. Press Escape to deselect.",
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
};

/* ─── Unified document entry for the takeoff selector ─── */

interface TakeoffDocument {
  id: string;
  label: string;
  source: "project" | "knowledge";
  fileName: string;
  /** For project docs – use getDocumentDownloadUrl */
  projectId?: string;
  /** For knowledge books – use getBookFileUrl */
  bookId?: string;
}

function buildPdfUrl(doc: TakeoffDocument): string {
  if (doc.source === "knowledge" && doc.bookId) {
    return getBookFileUrl(doc.bookId);
  }
  if (doc.source === "project" && doc.projectId) {
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

  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "takeoff-annotations.csv";
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
  a.download = "takeoff-annotations.json";
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Component ─── */

export function TakeoffTab({ workspace, onOpenAgentChat }: { workspace: ProjectWorkspaceData; onOpenAgentChat?: (prefill?: string) => void }) {
  const projectId = workspace.project.id;

  /* Project source documents that are PDFs or CAD files */
  const projectPdfs: TakeoffDocument[] = (workspace.sourceDocuments ?? [])
    .filter((d) => d.documentType === "drawing" || d.fileType === "application/pdf" || isCadFile(d.fileName))
    .map((d) => ({
      id: d.id,
      label: d.fileName,
      fileName: d.fileName,
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
  const [selectedDocId, setSelectedDocId] = useState(projectPdfs[0]?.id ?? "");

  useEffect(() => {
    if (!selectedDocId && drawings.length > 0) {
      setSelectedDocId(drawings[0].id);
    }
  }, [drawings.length, selectedDocId]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [activeTool, setActiveTool] = useState<ToolId>("select");

  /* Annotation state */
  const [annotations, setAnnotations] = useState<TakeoffAnnotation[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [pendingConfig, setPendingConfig] = useState<AnnotationConfig | null>(null);

  /* Calibration state */
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [calibrationPromptOpen, setCalibrationPromptOpen] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<[Point, Point] | null>(null);
  const [calibrationInput, setCalibrationInput] = useState("");
  const [calibrationUnit, setCalibrationUnit] = useState("ft");

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

  const selectedDoc = drawings.find((d) => d.id === selectedDocId);
  const isCadDocument = selectedDoc ? isCadFile(selectedDoc.fileName) : false;

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
    loadAnnotations();
  }, [loadAnnotations]);

  /* ─── PDF page count callback ─── */

  const handlePageCount = useCallback((count: number) => {
    setTotalPages(count);
  }, []);

  const handleCanvasResize = useCallback((w: number, h: number) => {
    setCanvasSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
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

  /* Escape key: cancel drawing and return to Select */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setActiveTool("select");
        setAutoCountResults(null);
        setAutoCountSnippet(null);
        setQuickCountResults(null);
        setCrossPageResults(null);
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
      const payload = {
        documentId: selectedDocId,
        pageNumber: page,
        annotationType: newAnnotation.type || activeTool || "unknown",
        label: newAnnotation.label || "",
        color: newAnnotation.color || "#3b82f6",
        lineThickness: newAnnotation.thickness ?? 4,
        visible: newAnnotation.visible ?? true,
        groupName: newAnnotation.groupName || "",
        points: newAnnotation.points || [],
        measurement: newAnnotation.measurement ?? {},
        metadata: newAnnotation.opts ?? {},
      };
      const saved = await createTakeoffAnnotation(projectId, payload);
      if (saved?.id) {
        setAnnotations((prev) =>
          prev.map((a) => (a.id === newAnnotation.id ? { ...a, id: saved.id } : a))
        );
      }
    } catch {
      /* Keep local annotation even if API fails */
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

    try {
      const result = await runVisionCountSymbols({
        projectId,
        documentId: realDocId,
        pageNumber: page,
        boundingBox: bbox,
        threshold: autoCountThreshold,
      });

      console.log("[autocount] result:", { totalCount: result.totalCount, matchCount: result.matches.length, hasSnippet: !!result.snippetImage, firstMatchHasImage: !!result.matches[0]?.image });
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

  async function handleCrossPageSearch() {
    if (!selectedDoc || !crossPageLastBbox) return;

    const realDocId = selectedDoc.source === "knowledge" && selectedDoc.bookId
      ? selectedDoc.bookId
      : selectedDoc.id;

    setCrossPageRunning(true);
    setCrossPageResults([]);

    try {
      const result = await runVisionCountAllPages({
        projectId,
        documentId: realDocId,
        boundingBox: crossPageLastBbox,
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

  async function handleMultiDocSearch() {
    if (!crossPageLastBbox) return;

    setMultiDocRunning(true);
    setMultiDocResults([]);

    try {
      const results: { docId: string; docLabel: string; total: number }[] = [];

      for (const doc of drawings) {
        const realDocId = doc.source === "knowledge" && doc.bookId ? doc.bookId : doc.id;

        try {
          const result = await runVisionCountAllPages({
            projectId,
            documentId: realDocId,
            boundingBox: crossPageLastBbox,
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
      setToastMessage(`Multi-document search: ${total} total across ${drawings.length} documents`);
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
    setCalibrationPoints(points);
    setCalibrationPromptOpen(true);
  }

  function handleCalibrationConfirm() {
    if (!calibrationPoints || !calibrationInput) return;
    const knownDist = parseFloat(calibrationInput);
    if (knownDist <= 0 || isNaN(knownDist)) return;

    const [a, b] = calibrationPoints;
    const pixelDist = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    const pixelsPerUnit = pixelDist / knownDist;

    setCalibration({ pixelsPerUnit, unit: calibrationUnit });
    setCalibrationPromptOpen(false);
    setCalibrationInput("");
    setCalibrationPoints(null);
    setActiveTool("select");
  }

  /* Annotation CRUD */
  function handleToggleVisibility(id: string) {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, visible: !a.visible } : a))
    );
  }

  async function handleDeleteAnnotation(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    try {
      await deleteTakeoffAnnotation(projectId, id);
    } catch {
      /* Ignore */
    }
  }

  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);

  function handleEditAnnotation(id: string) {
    setSelectedAnnotationId(id);
    setEditingAnnotationId(id);
  }

  function handleSaveAnnotationEdit(id: string, updates: { label?: string; color?: string; groupName?: string }) {
    setAnnotations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
    updateTakeoffAnnotation(projectId, id, updates).catch(() => {});
    setEditingAnnotationId(null);
  }

  /* Clear all annotations */
  function handleClearAll() {
    for (const ann of annotations) {
      deleteTakeoffAnnotation(projectId, ann.id).catch(() => {});
    }
    setAnnotations([]);
  }

  /* Build document URL */
  const documentUrl = selectedDoc ? buildPdfUrl(selectedDoc) : "";

  const zoomPercent = Math.round(zoom * 100);

  /* Determine if special tools are active */
  const isAutoCountActive = activeTool === "auto-count";
  const isAskAiActive = activeTool === "ask-ai";
  const isRectSelectTool = isAutoCountActive || isAskAiActive;

  /* ─── Render ─── */

  return (
    <div className="flex h-full flex-1 min-h-0 flex-col gap-3">
      {/* ─── Top Toolbar ─── */}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
        {/* Document selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-fg/50">Drawing:</label>
          <RadixSelect.Root
            value={selectedDocId}
            onValueChange={(v) => {
              setSelectedDocId(v);
              setPage(1);
              setAnnotations([]);
              setAutoCountResults(null);
              setAutoCountSnippet(null);
            }}
          >
            <RadixSelect.Trigger className="inline-flex items-center gap-1.5 h-8 w-56 px-2.5 text-xs rounded-lg border border-line bg-bg/50 text-fg outline-none hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors truncate">
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
                  {drawings.length === 0 && (
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

        {!isCadDocument && (
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
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Separator className="!h-6 !w-px" />

            {/* Calibration indicator */}
            {calibration ? (
              <Badge tone="success" className="text-[11px]">
                Calibrated: 1 {calibration.unit} = {calibration.pixelsPerUnit.toFixed(1)}px
              </Badge>
            ) : (
              <Badge tone="warning" className="text-[11px]">
                Not calibrated
              </Badge>
            )}
          </>
        )}

        <div className="flex-1" />

        {/* Active tool indicator */}
        <Badge tone="info" className="text-[11px]">
          {TOOLS.find((t) => t.id === activeTool)?.label ?? "Select"} tool
        </Badge>

        {/* Clear all */}
        {annotations.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClearAll} title="Clear all annotations">
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
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setExportDropdownOpen((v) => !v)}
              disabled={annotations.length === 0}
              className="rounded-l-none border-l border-line/50 px-1.5"
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
      </div>

      {/* ─── Auto-Count Banner ─── */}
      {isAutoCountActive && (
        <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-4 py-2.5">
          <ScanSearch className="h-4 w-4 text-accent shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-medium text-fg/80">
              {autoCountRunning
                ? "Analyzing drawing for matches..."
                : "Draw a rectangle around a symbol to auto-count all occurrences on this page"}
            </p>
            {!autoCountRunning && (
              <p className="text-[11px] text-fg/40 mt-0.5">
                Select a symbol by clicking and dragging. The CV pipeline will find all matching symbols.
              </p>
            )}
          </div>

          {autoCountRunning && (
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          )}

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
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-2.5 space-y-2">
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
                <Button variant="secondary" size="xs" onClick={handleCrossPageSearch} disabled={crossPageRunning}>
                  {crossPageRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                  All Pages ({totalPages})
                </Button>
              )}
              {drawings.length > 1 && (
                <Button variant="secondary" size="xs" onClick={handleMultiDocSearch} disabled={multiDocRunning}>
                  {multiDocRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Search className="h-3 w-3 mr-1" />}
                  All Documents ({drawings.length})
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
                  All documents{!multiDocRunning && `: ${multiDocResults.filter((r) => r.total >= 0).reduce((s, r) => s + r.total, 0)} total`}
                  {multiDocRunning && <span className="text-fg/40 ml-1">(scanning {multiDocResults.length}/{drawings.length}...)</span>}
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
      {isAskAiActive && (
        <div className="flex items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-2.5">
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
      <div className="flex flex-1 gap-3 overflow-hidden">
        {/* Left: Tool palette */}
        <div className="flex w-12 flex-col gap-0.5 rounded-lg border border-line bg-panel p-1.5 overflow-y-auto">
          {TOOL_GROUPS.map((group) => {
            const groupTools = TOOLS.filter((t) => t.group === group.key);
            return (
              <div key={group.key}>
                {group.key !== "nav" && (
                  <div className="my-1 h-px w-full bg-line/50" />
                )}
                {groupTools.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => handleToolSelect(id)}
                    title={label}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                      activeTool === id
                        ? "bg-accent/15 text-accent"
                        : "text-fg/40 hover:bg-panel2 hover:text-fg/70"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>
            );
          })}
        </div>

        {/* Center: Document viewer area */}
        <div ref={viewerContainerRef} className="flex flex-1 items-start justify-center overflow-auto rounded-lg border border-line bg-bg/50">
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
          ) : (
            <div className="relative inline-block m-4">
              {isCadDocument ? (
                <div className="w-[800px] h-[600px]">
                  <CadViewer fileUrl={documentUrl} fileName={selectedDoc?.fileName} />
                </div>
              ) : (
                <>
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
                        : activeColor
                    }
                    activeThickness={isRectSelectTool ? 2 : activeThickness}
                    onAnnotationComplete={
                      isAutoCountActive
                        ? handleAutoCountSelection
                        : isAskAiActive
                          ? handleAskAiSelection
                          : handleAnnotationComplete
                    }
                    onCalibrationRequest={handleCalibrationRequest}
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
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: Annotation sidebar */}
        <AnnotationSidebar
          annotations={annotations}
          onToggleVisibility={handleToggleVisibility}
          onDelete={handleDeleteAnnotation}
          onEdit={handleEditAnnotation}
          onSaveEdit={handleSaveAnnotationEdit}
          onSelectAnnotation={setSelectedAnnotationId}
          selectedAnnotationId={selectedAnnotationId}
          editingAnnotationId={editingAnnotationId}
        />
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

      {/* ─── Calibration Prompt ─── */}
      {calibrationPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              setCalibrationPromptOpen(false);
              setCalibrationPoints(null);
            }}
          />
          <Card className="relative z-10 w-full max-w-sm">
            <div className="border-b border-line px-5 py-4">
              <h3 className="text-sm font-semibold text-fg">Set Calibration</h3>
              <p className="mt-0.5 text-xs text-fg/50">
                Enter the real-world distance for the line you just drew.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  type="number"
                  min={0.01}
                  step={0.01}
                  placeholder="Distance..."
                  value={calibrationInput}
                  onChange={(e) => setCalibrationInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCalibrationConfirm();
                  }}
                />
                <Select
                  className="w-24"
                  value={calibrationUnit}
                  onChange={(e) => setCalibrationUnit(e.target.value)}
                >
                  <option value="ft">ft</option>
                  <option value="in">in</option>
                  <option value="m">m</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                  <option value="yd">yd</option>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
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
                <Button variant="accent" size="sm" onClick={handleCalibrationConfirm}>
                  Apply
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ─── Ask AI Slide-Up Panel ─── */}
      {/* ─── Auto Count Results Modal ─── */}
      {autoCountModalOpen && autoCountPending && (
        <div className="absolute bottom-12 left-16 right-[19rem] z-30 animate-in slide-in-from-bottom-4 duration-200">
          <Card className="border border-emerald-400/30 shadow-xl max-h-[50vh] flex flex-col">
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-line shrink-0">
              <ScanSearch className="h-4 w-4 text-emerald-500 shrink-0" />
              <span className="text-xs font-semibold text-fg flex-1">
                Auto Count — {autoCountPending.included.filter(Boolean).length} of {autoCountPending.totalCount} selected
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
            <div className="overflow-y-auto flex-1 min-h-0 divide-y divide-line">
              {autoCountPending.matches.map((match, i) => (
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
                  <div className="shrink-0 rounded border border-line bg-white p-0.5">
                    <img
                      src={match.image || autoCountPending.snippetImage || ""}
                      alt={`Match #${i + 1}`}
                      className="h-10 w-10 object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-fg">Match #{i + 1}</span>
                    <span className="text-fg/40 ml-2">{(match.confidence * 100).toFixed(0)}% confidence</span>
                  </div>
                  <span className="text-[10px] text-fg/30 tabular-nums shrink-0">
                    ({Math.round(match.rect.x)}, {Math.round(match.rect.y)})
                  </span>
                </div>
              ))}
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
      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-1.5">
        <p className="text-[11px] text-fg/40">
          {TOOL_STATUS_TEXT[activeTool] ?? "Select a tool to begin."}
        </p>
        <div className="flex-1" />
        {calibration && (
          <span className="text-[11px] text-fg/30">
            Scale: 1 {calibration.unit} = {calibration.pixelsPerUnit.toFixed(1)}px
          </span>
        )}
        <span className="text-[11px] text-fg/30">
          Page {page}/{totalPages}
        </span>
        <span className="text-[11px] text-fg/30">
          {zoomPercent}%
        </span>
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

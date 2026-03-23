"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
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
  Circle,
  Triangle,
  Spline,
  Scaling,
  Layers,
  ArrowDownToLine,
  Hash,
  LayoutGrid,
} from "lucide-react";
import type { ProjectWorkspaceData, KnowledgeBookRecord } from "@/lib/api";
import {
  listTakeoffAnnotations,
  createTakeoffAnnotation,
  updateTakeoffAnnotation,
  deleteTakeoffAnnotation,
  getDocumentDownloadUrl,
  getBookFileUrl,
  listKnowledgeBooks,
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
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { Calibration, Point } from "@/lib/takeoff-math";
const PdfCanvasViewer = dynamic(
  () => import("./takeoff/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false }
);
import {
  AnnotationCanvas,
  type TakeoffAnnotation,
} from "./takeoff/annotation-canvas";
import { AnnotationSidebar } from "./takeoff/annotation-sidebar";
import {
  CreateAnnotationModal,
  type AnnotationConfig,
} from "./takeoff/create-annotation-modal";

/* ─── Tool definitions ─── */

type ToolId =
  | "select"
  | "linear"
  | "linear-polyline"
  | "linear-drop"
  | "count"
  | "count-by-distance"
  | "area-rectangle"
  | "area-polygon"
  | "area-triangle"
  | "area-ellipse"
  | "area-vertical-wall"
  | "calibrate";

interface ToolDef {
  id: ToolId;
  label: string;
  icon: typeof Ruler;
  group: "nav" | "linear" | "count" | "area" | "util";
}

const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", icon: MousePointer2, group: "nav" },
  { id: "linear", label: "Linear", icon: Ruler, group: "linear" },
  { id: "linear-polyline", label: "Polyline", icon: Spline, group: "linear" },
  { id: "linear-drop", label: "Linear Drop", icon: ArrowDownToLine, group: "linear" },
  { id: "count", label: "Count", icon: Target, group: "count" },
  { id: "count-by-distance", label: "Count by Distance", icon: Hash, group: "count" },
  { id: "area-rectangle", label: "Rectangle", icon: Square, group: "area" },
  { id: "area-polygon", label: "Polygon", icon: Layers, group: "area" },
  { id: "area-triangle", label: "Triangle", icon: Triangle, group: "area" },
  { id: "area-ellipse", label: "Ellipse", icon: Circle, group: "area" },
  { id: "area-vertical-wall", label: "Vertical Wall", icon: LayoutGrid, group: "area" },
  { id: "calibrate", label: "Calibrate", icon: Scaling, group: "util" },
];

const TOOL_GROUPS = [
  { key: "nav", label: "Navigate" },
  { key: "linear", label: "Linear" },
  { key: "count", label: "Count" },
  { key: "area", label: "Area" },
  { key: "util", label: "Utility" },
] as const;

/* ─── Unified document entry for the takeoff selector ─── */

interface TakeoffDocument {
  id: string;
  label: string;
  source: "project" | "knowledge";
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

/* ─── Component ─── */

export function TakeoffTab({ workspace }: { workspace: ProjectWorkspaceData }) {
  const projectId = workspace.project.id;

  /* Project source documents that are PDFs */
  const projectPdfs: TakeoffDocument[] = (workspace.sourceDocuments ?? [])
    .filter((d) => d.documentType === "drawing" || d.fileType === "application/pdf")
    .map((d) => ({
      id: d.id,
      label: d.fileName,
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
        // Also fetch global books (no projectId filter)
        const globalBooks = await listKnowledgeBooks();
        const allBooks = new Map<string, KnowledgeBookRecord>();
        for (const b of [...books, ...globalBooks]) allBooks.set(b.id, b);
        if (cancelled) return;
        setKnowledgePdfs(
          Array.from(allBooks.values())
            .filter((b) => b.status === "indexed" && b.sourceFileName?.toLowerCase().endsWith(".pdf"))
            .map((b) => ({
              id: `kb-${b.id}`,
              label: `📚 ${b.name || b.sourceFileName}`,
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

  /* Auto-select first doc when knowledge books load and nothing is selected */
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
  const [activeColor, setActiveColor] = useState("#3b82f6");
  const [activeThickness, setActiveThickness] = useState(3);
  const [activeOpts, setActiveOpts] = useState<TakeoffAnnotation["opts"]>({});
  const [activeGroupName, setActiveGroupName] = useState<string | undefined>();
  const [activeLabel, setActiveLabel] = useState<string>("");

  /* Canvas dimensions */
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);

  const selectedDoc = drawings.find((d) => d.id === selectedDocId);

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

  /* Watch PDF canvas size changes */
  useEffect(() => {
    const canvas = pdfCanvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      if (canvas.width > 0 && canvas.height > 0) {
        setCanvasSize({ width: canvas.width, height: canvas.height });
      }
    });

    /* Also check via MutationObserver for attribute changes (width/height) */
    const mutObs = new MutationObserver(() => {
      if (canvas.width > 0 && canvas.height > 0) {
        setCanvasSize({ width: canvas.width, height: canvas.height });
      }
    });

    observer.observe(canvas);
    mutObs.observe(canvas, { attributes: true, attributeFilter: ["width", "height"] });

    return () => {
      observer.disconnect();
      mutObs.disconnect();
    };
  }, [selectedDocId]);

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
    setZoom(1);
  }

  function handleToolSelect(tool: ToolId) {
    if (tool === "select") {
      setActiveTool("select");
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
    };

    setAnnotations((prev) => [...prev, newAnnotation]);

    /* Persist to API */
    try {
      const saved = await createTakeoffAnnotation(projectId, {
        ...newAnnotation,
        documentId: selectedDocId,
        page,
      });
      if (saved?.id) {
        /* Update local id with server id */
        setAnnotations((prev) =>
          prev.map((a) => (a.id === newAnnotation.id ? { ...a, id: saved.id } : a))
        );
      }
    } catch {
      /* Keep local annotation even if API fails */
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

  function handleEditAnnotation(id: string) {
    /* Select the annotation for now; full edit modal is a future enhancement */
    setSelectedAnnotationId(id);
  }

  /* Build document URL */
  const documentUrl = selectedDoc ? buildPdfUrl(selectedDoc) : "";

  const zoomPercent = Math.round(zoom * 100);

  /* ─── Render ─── */

  return (
    <div className="flex h-full flex-1 min-h-0 flex-col gap-3">
      {/* ─── Top Toolbar ─── */}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2">
        {/* Document selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-fg/50">Drawing:</label>
          <Select
            className="h-8 w-56 text-xs"
            value={selectedDocId}
            onChange={(e) => {
              setSelectedDocId(e.target.value);
              setPage(1);
              setAnnotations([]);
            }}
          >
            {drawings.length === 0 && (
              <option value="">No drawings available</option>
            )}
            {drawings.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>

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

        <div className="flex-1" />

        {/* Active tool indicator */}
        <Badge tone="info" className="text-[11px]">
          {TOOLS.find((t) => t.id === activeTool)?.label ?? "Select"} tool
        </Badge>

        {/* Export */}
        <Button variant="secondary" size="sm">
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
      </div>

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
        <div className="flex flex-1 items-start justify-center overflow-auto rounded-lg border border-line bg-bg/50">
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
              {/* PDF canvas */}
              <PdfCanvasViewer
                documentUrl={documentUrl}
                pageNumber={page}
                zoom={zoom}
                onPageCount={handlePageCount}
                canvasRef={pdfCanvasRef}
              />
              {/* Annotation overlay */}
              <AnnotationCanvas
                width={canvasSize.width}
                height={canvasSize.height}
                annotations={annotations.filter((a) => a.visible)}
                activeTool={activeTool === "select" ? null : activeTool}
                calibration={calibration}
                activeColor={activeColor}
                activeThickness={activeThickness}
                onAnnotationComplete={handleAnnotationComplete}
                onCalibrationRequest={handleCalibrationRequest}
              />
            </div>
          )}
        </div>

        {/* Right: Annotation sidebar */}
        <AnnotationSidebar
          annotations={annotations}
          onToggleVisibility={handleToggleVisibility}
          onDelete={handleDeleteAnnotation}
          onEdit={handleEditAnnotation}
          onSelectAnnotation={setSelectedAnnotationId}
          selectedAnnotationId={selectedAnnotationId}
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
    </div>
  );
}

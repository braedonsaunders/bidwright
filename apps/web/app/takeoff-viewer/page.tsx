"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize2,
  Minimize2,
  Scan,
  X,
  Ruler,
} from "lucide-react";
import dynamic from "next/dynamic";
import { getDocumentDownloadUrl, getBookFileUrl, listTakeoffAnnotations } from "@/lib/api";
import type { TakeoffAnnotation } from "@/components/workspace/takeoff/annotation-canvas";
import type { Point } from "@/lib/takeoff-math";
import { Button, Input } from "@/components/ui";

const PdfCanvasViewer = dynamic(
  () => import("@/components/workspace/takeoff/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false }
);
const AnnotationCanvas = dynamic(
  () => import("@/components/workspace/takeoff/annotation-canvas").then((m) => ({ default: m.AnnotationCanvas })),
  { ssr: false }
);

/* ─── BroadcastChannel message types ─── */
interface BwTakeoffMessage {
  type: "page-change" | "annotation-update" | "zoom-change";
  projectId: string;
  docId: string;
  page?: number;
  zoom?: number;
  annotations?: TakeoffAnnotation[];
}

function TakeoffViewerInner() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";
  const docId = searchParams.get("docId") ?? "";
  const source = searchParams.get("source") ?? "project"; // "project" | "knowledge"
  const initialPage = parseInt(searchParams.get("page") ?? "1", 10);

  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [annotations, setAnnotations] = useState<TakeoffAnnotation[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fitOnLoadRef = useRef(true);
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  /* Build document URL from params */
  const documentUrl = (() => {
    if (source === "knowledge" && docId.startsWith("kb-")) {
      const bookId = docId.replace("kb-", "");
      return getBookFileUrl(bookId);
    }
    if (projectId && docId) {
      return getDocumentDownloadUrl(projectId, docId, true);
    }
    return "";
  })();

  /* Load annotations from API */
  const loadAnnotations = useCallback(async () => {
    if (!projectId || !docId) return;
    try {
      const cleanDocId = docId.startsWith("kb-") ? docId.replace("kb-", "") : docId;
      const data = await listTakeoffAnnotations(projectId, cleanDocId, page);
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
      /* API may not be available yet */
    }
  }, [projectId, docId, page]);

  useEffect(() => {
    loadAnnotations();
  }, [loadAnnotations]);

  /* BroadcastChannel: receive sync from main window */
  useEffect(() => {
    broadcastRef.current = new BroadcastChannel("bw-takeoff");
    broadcastRef.current.onmessage = (event: MessageEvent<BwTakeoffMessage>) => {
      const msg = event.data;
      if (!msg || msg.projectId !== projectId || msg.docId !== docId) return;
      if (msg.type === "page-change" && msg.page !== undefined) {
        setPage(msg.page);
      }
      if (msg.type === "zoom-change" && msg.zoom !== undefined) {
        setZoom(msg.zoom);
      }
      if (msg.type === "annotation-update" && msg.annotations) {
        setAnnotations(msg.annotations);
      }
    };
    return () => {
      broadcastRef.current?.close();
    };
  }, [projectId, docId]);

  /* Fullscreen tracking */
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  /* Callbacks */
  const handlePageCount = useCallback((count: number) => {
    setTotalPages(count);
  }, []);

  const handleCanvasResize = useCallback((w: number, h: number) => {
    setCanvasSize((prev) =>
      prev.width === w && prev.height === h ? prev : { width: w, height: h }
    );
    if (fitOnLoadRef.current && w > 0 && h > 0) {
      fitOnLoadRef.current = false;
      requestAnimationFrame(() => {
        const container = viewerContainerRef.current;
        if (!container) return;
        const cw = container.clientWidth - 32;
        const ch = container.clientHeight - 32;
        if (cw <= 0 || ch <= 0) return;
        const fitZ = Math.round(Math.min(cw / w, ch / h) * 100) / 100;
        setZoom(Math.max(0.25, Math.min(fitZ, 5)));
      });
    }
  }, []);

  function handleFitToPage() {
    const container = viewerContainerRef.current;
    const canvas = pdfCanvasRef.current;
    if (!container || !canvas || canvas.width === 0) {
      setZoom(1);
      return;
    }
    const cw = container.clientWidth - 32;
    const ch = container.clientHeight - 32;
    const baseWidth = canvas.width / zoom;
    const baseHeight = canvas.height / zoom;
    const fitZ = Math.round(Math.min(cw / baseWidth, ch / baseHeight) * 100) / 100;
    setZoom(Math.max(0.25, Math.min(fitZ, 5)));
    container.scrollTo({ top: 0, left: 0 });
  }

  function handleFullscreen() {
    if (!document.fullscreenElement) {
      cardRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  const zoomPercent = Math.round(zoom * 100);
  const hasDoc = !!documentUrl;

  return (
    <div
      ref={cardRef}
      className="flex h-screen flex-col bg-bg text-fg"
      style={{ fontFamily: "var(--font-sans, sans-serif)" }}
    >
      {/* ─── Toolbar ─── */}
      <div className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2 shrink-0">
        {/* Title */}
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-fg/40" />
          <span className="text-sm font-semibold text-fg/80">Takeoff Viewer</span>
          {docId && (
            <span className="text-xs text-fg/40">— detached window</span>
          )}
        </div>

        {hasDoc && (
          <>
            <div className="h-5 w-px bg-line" />

            {/* Page navigation */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
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
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="h-5 w-px bg-line" />

            {/* Zoom controls */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <span className="w-12 text-center text-xs text-fg/60">{zoomPercent}%</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="xs" onClick={handleFitToPage} title="Fit to page">
                <Scan className="h-3.5 w-3.5" />
              </Button>
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* Fullscreen */}
        <Button
          variant="ghost"
          size="xs"
          onClick={handleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </Button>

        {/* Close window */}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => window.close()}
          title="Close window"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ─── Main content ─── */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* PDF Viewer */}
        <div
          ref={viewerContainerRef}
          className="flex flex-1 items-start justify-center overflow-auto bg-bg/80"
        >
          {!hasDoc ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <Ruler className="mx-auto mb-3 h-10 w-10 text-fg/20" />
                <p className="text-sm text-fg/50">No document selected</p>
              </div>
            </div>
          ) : (
            <div className="relative inline-block m-4">
              <PdfCanvasViewer
                documentUrl={documentUrl}
                pageNumber={page}
                zoom={zoom}
                onPageCount={handlePageCount}
                onCanvasResize={handleCanvasResize}
                canvasRef={pdfCanvasRef}
              />
              {canvasSize.width > 0 && (
                <AnnotationCanvas
                  width={canvasSize.width}
                  height={canvasSize.height}
                  annotations={annotations.filter((a) => a.visible)}
                  activeTool={null}
                  calibration={null}
                  activeColor="#3b82f6"
                  activeThickness={3}
                  onAnnotationComplete={() => {}}
                  onCalibrationRequest={() => {}}
                />
              )}
            </div>
          )}
        </div>

        {/* Annotations list (read-only) */}
        <div className="flex w-64 shrink-0 flex-col border-l border-line overflow-hidden">
          <div className="shrink-0 border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-fg">Annotations</p>
            <p className="mt-0.5 text-[11px] text-fg/40">
              {annotations.length} item{annotations.length !== 1 ? "s" : ""} &middot; read-only
            </p>
          </div>
          <div className="flex-1 overflow-auto py-2 px-2 space-y-0.5">
            {annotations.length === 0 ? (
              <p className="py-8 text-center text-xs text-fg/30">No annotations on this page</p>
            ) : (
              annotations.map((ann) => (
                <div
                  key={ann.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5"
                >
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: ann.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-fg/80">
                      {ann.label || ann.type}
                    </p>
                    {ann.measurement && (
                      <p className="text-[11px] text-fg/40">
                        {ann.measurement.value.toFixed(2)} {ann.measurement.unit}
                      </p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ─── Status bar ─── */}
      <div className="flex items-center gap-3 border-t border-line bg-panel px-4 py-1.5 shrink-0">
        <span className="text-[11px] text-fg/40">Detached viewer — annotations sync from main window</span>
        <div className="flex-1" />
        <span className="text-[11px] text-fg/30">Page {page}/{totalPages}</span>
        <span className="text-[11px] text-fg/30">{zoomPercent}%</span>
      </div>
    </div>
  );
}

export default function TakeoffViewerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-bg text-fg">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      }
    >
      <TakeoffViewerInner />
    </Suspense>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjs from "pdfjs-dist";

/* Set up the PDF.js worker — webpack resolves new URL() to a static asset */
if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
}

interface PdfCanvasViewerProps {
  documentUrl: string;
  pageNumber?: number;
  zoom: number;
  mode?: "single" | "continuous";
  onPageCount?: (count: number) => void;
  onPageChange?: (pageNumber: number) => void;
  onCanvasResize?: (width: number, height: number) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export function PdfCanvasViewer({
  documentUrl,
  pageNumber = 1,
  zoom,
  mode = "single",
  onPageCount,
  onPageChange,
  onCanvasResize,
  canvasRef,
}: PdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [basePageSize, setBasePageSize] = useState<{ width: number; height: number } | null>(null);
  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const continuousRenderTasksRef = useRef(new Map<number, pdfjs.RenderTask>());
  const renderedZoomRef = useRef(new Map<number, number>());
  const pageCanvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const pageHostRefs = useRef(new Map<number, HTMLDivElement>());
  const visibilityRatiosRef = useRef(new Map<number, number>());
  const currentVisiblePageRef = useRef(1);

  /* Load the PDF document */
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);

        if (pdfDocRef.current) {
          pdfDocRef.current.destroy();
          pdfDocRef.current = null;
        }

        const loadingTask = pdfjs.getDocument({ url: documentUrl, withCredentials: true });
        const doc = await loadingTask.promise;

        if (cancelled) {
          doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        setPageCount(doc.numPages);
        currentVisiblePageRef.current = 1;
        visibilityRatiosRef.current.clear();
        onPageCount?.(doc.numPages);

        if (mode === "continuous") {
          const firstPage = await doc.getPage(1);
          const viewport = firstPage.getViewport({ scale: 1 });
          if (!cancelled) {
            setBasePageSize({ width: viewport.width, height: viewport.height });
            setVisiblePages(Array.from({ length: Math.min(doc.numPages, 3) }, (_, index) => index + 1));
            renderedZoomRef.current.clear();
          }
        } else {
          setBasePageSize(null);
          setVisiblePages([]);
          renderedZoomRef.current.clear();
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF");
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [documentUrl, mode, onPageCount]);

  /* Render the current page */
  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef?.current;
    if (!doc || !canvas) return;

    const clampedPage = Math.max(1, Math.min(pageNumber, doc.numPages));

    try {
      /* Cancel any in-flight render */
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      const page = await doc.getPage(clampedPage);
      const scale = zoom;
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      onCanvasResize?.(viewport.width, viewport.height);

      const renderTask = page.render({
        canvas,
        viewport,
      });
      renderTaskRef.current = renderTask;

      await renderTask.promise;
      renderTaskRef.current = null;
    } catch (err: unknown) {
      /* Ignore cancellation errors */
      if (err instanceof Error && err.message?.includes("Rendering cancelled")) return;
    }
  }, [pageNumber, zoom, canvasRef, onCanvasResize]);

  const renderContinuousPage = useCallback(async (targetPageNumber: number) => {
    const doc = pdfDocRef.current;
    const canvas = pageCanvasRefs.current.get(targetPageNumber);
    if (!doc || !canvas) return;

    if (renderedZoomRef.current.get(targetPageNumber) === zoom) {
      return;
    }

    try {
      const existingTask = continuousRenderTasksRef.current.get(targetPageNumber);
      if (existingTask) {
        existingTask.cancel();
        continuousRenderTasksRef.current.delete(targetPageNumber);
      }

      const page = await doc.getPage(targetPageNumber);
      const viewport = page.getViewport({ scale: zoom });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const renderTask = page.render({
        canvas,
        viewport,
      });
      continuousRenderTasksRef.current.set(targetPageNumber, renderTask);

      await renderTask.promise;
      continuousRenderTasksRef.current.delete(targetPageNumber);
      renderedZoomRef.current.set(targetPageNumber, zoom);
    } catch (err: unknown) {
      if (err instanceof Error && err.message?.includes("Rendering cancelled")) return;
    }
  }, [zoom]);

  useEffect(() => {
    if (mode === "single" && !loading && !error && canvasRef?.current) {
      renderPage();
    }
  }, [canvasRef, error, loading, mode, renderPage]);

  useEffect(() => {
    if (mode !== "continuous" || loading || error || pageCount === 0 || !containerRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const intersectingPages = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number((entry.target as HTMLElement).dataset.pageNumber))
          .filter((value) => Number.isFinite(value));

        if (intersectingPages.length === 0) {
          // Keep current-page tracking up to date even when this batch only exits pages.
        }

        setVisiblePages((previous) => {
          const next = new Set(previous);
          for (const visiblePage of intersectingPages) {
            next.add(visiblePage);
          }
          return Array.from(next).sort((left, right) => left - right);
        });

        for (const entry of entries) {
          const visiblePage = Number((entry.target as HTMLElement).dataset.pageNumber);
          if (!Number.isFinite(visiblePage)) {
            continue;
          }
          if (entry.isIntersecting) {
            visibilityRatiosRef.current.set(visiblePage, entry.intersectionRatio);
          } else {
            visibilityRatiosRef.current.delete(visiblePage);
          }
        }

        const nextCurrentPage = Array.from(visibilityRatiosRef.current.entries())
          .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0];

        if (nextCurrentPage && nextCurrentPage !== currentVisiblePageRef.current) {
          currentVisiblePageRef.current = nextCurrentPage;
          onPageChange?.(nextCurrentPage);
        }
      },
      {
        root: containerRef.current,
        rootMargin: "150% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const host of pageHostRefs.current.values()) {
      observer.observe(host);
    }

    return () => observer.disconnect();
  }, [error, loading, mode, onPageChange, pageCount]);

  useEffect(() => {
    if (mode !== "continuous" || loading || error) {
      return;
    }

    for (const visiblePage of visiblePages) {
      void renderContinuousPage(visiblePage);
    }
  }, [error, loading, mode, renderContinuousPage, visiblePages]);

  useEffect(() => {
    if (mode !== "continuous" || loading || error || pageCount === 0 || !containerRef.current) {
      return;
    }

    const targetPage = Math.max(1, Math.min(pageNumber, pageCount));
    if (targetPage === currentVisiblePageRef.current) {
      return;
    }

    const targetHost = pageHostRefs.current.get(targetPage);
    if (!targetHost) {
      return;
    }

    containerRef.current.scrollTo({
      top: Math.max(targetHost.offsetTop - 16, 0),
      behavior: "smooth",
    });
  }, [error, loading, mode, pageCount, pageNumber]);

  /* Cleanup */
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      for (const renderTask of continuousRenderTasksRef.current.values()) {
        renderTask.cancel();
      }
      continuousRenderTasksRef.current.clear();
      if (pdfDocRef.current) {
        pdfDocRef.current.destroy();
        pdfDocRef.current = null;
      }
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-danger">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="ml-2 text-sm text-fg/50">Loading PDF...</span>
      </div>
    );
  }

  if (mode === "continuous") {
    const fallbackWidth = (basePageSize?.width ?? 612) * zoom;
    const fallbackHeight = (basePageSize?.height ?? 792) * zoom;

    return (
      <div ref={containerRef} className="flex flex-col gap-4">
        {Array.from({ length: pageCount }, (_, index) => {
          const currentPage = index + 1;
          return (
            <div
              key={currentPage}
              ref={(node) => {
                if (node) {
                  pageHostRefs.current.set(currentPage, node);
                } else {
                  pageHostRefs.current.delete(currentPage);
                }
              }}
              data-page-number={currentPage}
              className="mx-auto overflow-hidden rounded-md bg-white shadow-sm"
              style={{
                width: fallbackWidth,
                minHeight: fallbackHeight,
              }}
            >
              <canvas
                ref={(node) => {
                  if (node) {
                    pageCanvasRefs.current.set(currentPage, node);
                  } else {
                    pageCanvasRefs.current.delete(currentPage);
                  }
                }}
                className="block"
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="inline-block">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

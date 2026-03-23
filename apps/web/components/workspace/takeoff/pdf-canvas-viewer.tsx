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
  pageNumber: number;
  zoom: number;
  onPageCount?: (count: number) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function PdfCanvasViewer({
  documentUrl,
  pageNumber,
  zoom,
  onPageCount,
  canvasRef,
}: PdfCanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfDocRef = useRef<pdfjs.PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);

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

        const loadingTask = pdfjs.getDocument(documentUrl);
        const doc = await loadingTask.promise;

        if (cancelled) {
          doc.destroy();
          return;
        }

        pdfDocRef.current = doc;
        onPageCount?.(doc.numPages);
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
  }, [documentUrl, onPageCount]);

  /* Render the current page */
  const renderPage = useCallback(async () => {
    const doc = pdfDocRef.current;
    const canvas = canvasRef.current;
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
  }, [pageNumber, zoom, canvasRef]);

  useEffect(() => {
    if (!loading && !error) {
      renderPage();
    }
  }, [loading, error, renderPage]);

  /* Cleanup */
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
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

  return (
    <div ref={containerRef} className="inline-block">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

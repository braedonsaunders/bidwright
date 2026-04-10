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

interface PdfFocusTarget {
  key: string;
  pageNumber: number;
  text: string;
  query: string;
}

interface HighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface PageTextLayoutEntry {
  normalizedText: string;
  start: number;
  end: number;
  rect: HighlightRect;
}

interface PageTextLayout {
  normalizedText: string;
  entries: PageTextLayoutEntry[];
}

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

function isPdfTextItem(item: unknown): item is PdfTextItem {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Partial<PdfTextItem>;
  return (
    typeof candidate.str === "string" &&
    Array.isArray(candidate.transform) &&
    typeof candidate.width === "number" &&
    typeof candidate.height === "number"
  );
}

function normalizePdfSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchCandidates(text: string, query: string) {
  const candidates: string[] = [];
  const normalizedText = normalizePdfSearchText(text);
  const normalizedQuery = normalizePdfSearchText(query);

  if (normalizedText) {
    candidates.push(normalizedText);

    const words = normalizedText.split(" ").filter(Boolean);
    for (const windowSize of [24, 18, 12, 8, 6, 4]) {
      if (words.length < windowSize) continue;
      const step = Math.max(1, Math.floor(windowSize / 2));
      for (let index = 0; index <= words.length - windowSize; index += step) {
        candidates.push(words.slice(index, index + windowSize).join(" "));
      }
    }
  }

  if (normalizedQuery) {
    candidates.push(normalizedQuery);
  }

  return Array.from(new Set(candidates.filter((candidate) => candidate.length >= 3))).sort(
    (left, right) => right.length - left.length,
  );
}

function mergeHighlightRects(rects: HighlightRect[]) {
  if (rects.length === 0) return [];

  const sortedRects = [...rects].sort((left, right) => left.top - right.top || left.left - right.left);
  const merged: HighlightRect[] = [];

  for (const rect of sortedRects) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...rect });
      continue;
    }

    const sameLine = Math.abs(last.top - rect.top) <= Math.max(4, Math.min(last.height, rect.height) * 0.5);
    const touching = rect.left <= last.left + last.width + 12;

    if (sameLine && touching) {
      const rightEdge = Math.max(last.left + last.width, rect.left + rect.width);
      last.top = Math.min(last.top, rect.top);
      last.height = Math.max(last.height, rect.height);
      last.width = rightEdge - last.left;
      continue;
    }

    merged.push({ ...rect });
  }

  return merged;
}

function findTextMatch(layout: PageTextLayout, focusTarget: PdfFocusTarget) {
  for (const candidate of buildSearchCandidates(focusTarget.text, focusTarget.query)) {
    const matchStart = layout.normalizedText.indexOf(candidate);
    if (matchStart === -1) {
      continue;
    }

    const matchEnd = matchStart + candidate.length;
    const rects = mergeHighlightRects(
      layout.entries
        .filter((entry) => entry.end > matchStart && entry.start < matchEnd)
        .map((entry) => entry.rect),
    );

    if (rects.length > 0) {
      return {
        rects,
        top: rects[0].top,
      };
    }
  }

  const terms = Array.from(
    new Set(
      `${focusTarget.query} ${focusTarget.text}`
        .split(/\s+/)
        .map((term) => normalizePdfSearchText(term))
        .filter((term) => term.length >= 3),
    ),
  );

  let bestIndex = -1;
  let bestScore = 0;

  layout.entries.forEach((entry, index) => {
    let score = 0;
    for (const term of terms) {
      if (entry.normalizedText.includes(term)) {
        score += term.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  if (bestIndex === -1) {
    return null;
  }

  const rects = mergeHighlightRects(
    layout.entries
      .slice(Math.max(0, bestIndex - 1), Math.min(layout.entries.length, bestIndex + 2))
      .map((entry) => entry.rect),
  );

  if (rects.length === 0) {
    return null;
  }

  return {
    rects,
    top: rects[0].top,
  };
}

interface PdfCanvasViewerProps {
  documentUrl: string;
  pageNumber?: number;
  zoom: number;
  mode?: "single" | "continuous";
  focusTarget?: PdfFocusTarget | null;
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
  focusTarget,
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
  const [focusHighlight, setFocusHighlight] = useState<{ pageNumber: number; rects: HighlightRect[] } | null>(null);
  const renderTaskRef = useRef<pdfjs.RenderTask | null>(null);
  const continuousRenderTasksRef = useRef(new Map<number, pdfjs.RenderTask>());
  const renderedZoomRef = useRef(new Map<number, number>());
  const pageCanvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const pageHostRefs = useRef(new Map<number, HTMLDivElement>());
  const visibilityRatiosRef = useRef(new Map<number, number>());
  const currentVisiblePageRef = useRef(1);

  const buildPageTextLayout = useCallback(async (targetPageNumber: number) => {
    const doc = pdfDocRef.current;
    if (!doc) return null;

    const page = await doc.getPage(targetPageNumber);
    const viewport = page.getViewport({ scale: zoom });
    const textContent = await page.getTextContent();
    let normalizedText = "";
    const entries: PageTextLayoutEntry[] = [];

    for (const item of textContent.items) {
      if (!isPdfTextItem(item)) continue;

      const normalizedItemText = normalizePdfSearchText(item.str);
      if (!normalizedItemText) continue;

      if (normalizedText.length > 0) {
        normalizedText += " ";
      }
      const start = normalizedText.length;
      normalizedText += normalizedItemText;
      const end = normalizedText.length;

      const transform = pdfjs.Util.transform(viewport.transform, item.transform);
      const left = transform[4];
      const width = Math.max(item.width * viewport.scale, 1);
      const height = Math.max(Math.abs(item.height * viewport.scale), Math.abs(transform[3]), 1);
      const top = transform[5] - height;

      entries.push({
        normalizedText: normalizedItemText,
        start,
        end,
        rect: {
          left,
          top,
          width,
          height,
        },
      });
    }

    return {
      normalizedText,
      entries,
    } satisfies PageTextLayout;
  }, [zoom]);

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

  useEffect(() => {
    setFocusHighlight(null);
  }, [documentUrl]);

  useEffect(() => {
    if (!focusTarget || mode !== "continuous" || loading || error || pageCount === 0 || !containerRef.current) {
      if (!focusTarget) {
        setFocusHighlight(null);
      }
      return;
    }

    let cancelled = false;
    const targetPage = Math.max(1, Math.min(focusTarget.pageNumber, pageCount));

    setVisiblePages((previous) => {
      if (previous.includes(targetPage)) {
        return previous;
      }
      return [...previous, targetPage].sort((left, right) => left - right);
    });

    const focusPage = async () => {
      const layout = await buildPageTextLayout(targetPage);
      if (cancelled || !layout) return;

      const match = findTextMatch(layout, focusTarget);
      if (cancelled) return;

      setFocusHighlight({
        pageNumber: targetPage,
        rects: match?.rects ?? [],
      });

      const targetHost = pageHostRefs.current.get(targetPage);
      if (!targetHost || !containerRef.current) {
        return;
      }

      const topOffset = match ? Math.max(match.top - 32, 0) : 0;
      containerRef.current.scrollTo({
        top: Math.max(targetHost.offsetTop + topOffset - 16, 0),
        behavior: "smooth",
      });
    };

    void focusPage();

    return () => {
      cancelled = true;
    };
  }, [buildPageTextLayout, error, focusTarget, loading, mode, pageCount]);

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
              className="relative mx-auto overflow-hidden rounded-md bg-white shadow-sm"
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
              {focusHighlight?.pageNumber === currentPage && focusHighlight.rects.length > 0 && (
                <div className="pointer-events-none absolute inset-0">
                  {focusHighlight.rects.map((rect, index) => (
                    <div
                      key={`${currentPage}-${index}`}
                      className="absolute rounded-sm bg-amber-300/35 ring-1 ring-amber-500/30"
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  ))}
                </div>
              )}
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

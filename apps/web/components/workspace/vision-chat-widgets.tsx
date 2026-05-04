"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Eye,
  Hash,
  Loader2,
  X,
  XCircle,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────

export interface DrawingViewerProps {
  /** Base64 data URL or URL of the rendered page image */
  imageUrl: string;
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  pageWidth?: number;
  pageHeight?: number;
  dpi?: number;
  pageCount?: number;
}

export interface MatchResult {
  rect: { x: number; y: number; width?: number; height?: number };
  confidence: number;
  text?: string;
  method?: string;
}

export interface MatchOverlayProps {
  totalCount: number;
  matches: MatchResult[];
  documentId: string;
  pageNumber: number;
  threshold: number;
  duration_ms?: number;
  /** Optional base64 template image */
  templateImage?: string;
  errors?: string[];
}

export interface ProgressIndicatorProps {
  /** e.g. "Scanning page 3 of 11..." */
  message: string;
  /** 0–100 if known */
  progress?: number;
  onCancel?: () => void;
}

// ─── DrawingViewer ────────────────────────────────────────────────────────

export function DrawingViewer({
  imageUrl,
  pageNumber,
  imageWidth,
  imageHeight,
  pageWidth,
  pageHeight,
  dpi,
  pageCount,
}: DrawingViewerProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="rounded-lg border border-line/60 bg-bg/30 overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line/40 bg-panel2/30">
          <Eye className="h-3 w-3 text-accent shrink-0" />
          <span className="text-[11px] font-medium text-fg/60">
            Drawing Page {pageNumber}
            {pageCount ? ` of ${pageCount}` : ""}
          </span>
          <span className="ml-auto text-[9px] text-fg/25">
            {imageWidth} x {imageHeight}px
            {dpi ? ` @ ${dpi}dpi` : ""}
          </span>
        </div>

        {/* Inline image preview */}
        <button
          onClick={() => setExpanded(true)}
          className="relative w-full cursor-zoom-in group"
        >
          <img
            src={imageUrl}
            alt={`Drawing page ${pageNumber}`}
            className="w-full h-auto max-h-48 object-contain bg-white"
          />
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/10">
            <ZoomIn className="h-6 w-6 text-white drop-shadow-md" />
          </div>
        </button>

        {/* Page dimensions footer */}
        {(pageWidth || pageHeight) && (
          <div className="px-2.5 py-1 border-t border-line/30 text-[9px] text-fg/25">
            Page: {pageWidth?.toFixed(1)}" x {pageHeight?.toFixed(1)}"
          </div>
        )}
      </div>

      {/* Expanded modal overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] overflow-auto rounded-lg bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setExpanded(false)}
              className="absolute top-2 right-2 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={imageUrl}
              alt={`Drawing page ${pageNumber}`}
              className="max-w-[90vw] max-h-[90vh] object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}

// ─── MatchOverlay ─────────────────────────────────────────────────────────

export function MatchOverlay({
  totalCount,
  matches,
  documentId,
  pageNumber,
  threshold,
  duration_ms,
  templateImage,
  errors,
}: MatchOverlayProps) {
  const [showAll, setShowAll] = useState(false);
  const hasMatches = totalCount > 0;
  const visibleMatches = showAll ? matches : matches.slice(0, 5);

  return (
    <div className="rounded-lg border border-line/60 bg-bg/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-line/40 bg-panel2/30">
        <Hash className="h-3 w-3 text-accent shrink-0" />
        <span className="text-[11px] font-medium text-fg/60">
          Symbol Count
        </span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            hasMatches
              ? "bg-success/15 text-success"
              : "bg-amber-500/15 text-amber-600"
          )}
        >
          {hasMatches ? (
            <CheckCircle2 className="h-2.5 w-2.5" />
          ) : (
            <XCircle className="h-2.5 w-2.5" />
          )}
          {hasMatches ? `${totalCount} found` : "No matches"}
        </span>
      </div>

      {/* Count display + template */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Template thumbnail */}
        {templateImage && (
          <div className="shrink-0 rounded border border-line/40 bg-white overflow-hidden">
            <img
              src={templateImage}
              alt="Template"
              className="h-10 w-10 object-contain"
            />
          </div>
        )}

        {/* Big count number */}
        <div className="flex-1">
          <div
            className={cn(
              "text-2xl font-bold tabular-nums",
              hasMatches ? "text-success" : "text-fg/30"
            )}
          >
            {totalCount}
          </div>
          <div className="text-[10px] text-fg/35">
            Page {pageNumber} · threshold {(threshold * 100).toFixed(0)}%
            {duration_ms ? ` · ${(duration_ms / 1000).toFixed(1)}s` : ""}
          </div>
        </div>
      </div>

      {/* Match list with confidence bars */}
      {matches.length > 0 && (
        <div className="border-t border-line/30 px-3 py-2 space-y-1">
          <div className="text-[9px] text-fg/25 uppercase tracking-wider font-medium mb-1">
            Top Matches
          </div>
          {visibleMatches.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              <span className="w-4 text-fg/25 text-right shrink-0">
                {i + 1}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-fg/5 overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    m.confidence >= 0.8
                      ? "bg-success"
                      : m.confidence >= 0.6
                        ? "bg-amber-400"
                        : "bg-orange-400"
                  )}
                  style={{ width: `${Math.round(m.confidence * 100)}%` }}
                />
              </div>
              <span className="w-8 text-fg/40 text-right shrink-0 tabular-nums">
                {(m.confidence * 100).toFixed(0)}%
              </span>
              {m.text && (
                <span className="text-fg/30 truncate max-w-[60px]">
                  {m.text}
                </span>
              )}
              {m.method && (
                <span className="text-fg/15 text-[8px]">{m.method}</span>
              )}
            </div>
          ))}
          {matches.length > 5 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="text-[10px] text-accent hover:underline mt-1"
            >
              {showAll
                ? "Show fewer"
                : `Show all ${matches.length} matches`}
            </button>
          )}
        </div>
      )}

      {/* Errors */}
      {errors && errors.length > 0 && (
        <div className="border-t border-line/30 px-3 py-1.5">
          {errors.map((err, i) => (
            <div key={i} className="text-[9px] text-danger/60">
              {err}
            </div>
          ))}
        </div>
      )}

      {/* View on drawing CTA */}
      {hasMatches && (
        <div className="border-t border-line/30 px-3 py-1.5">
          <button className="text-[10px] text-accent hover:underline font-medium">
            View on Drawing
          </button>
        </div>
      )}
    </div>
  );
}

// ─── ProgressIndicator ────────────────────────────────────────────────────

export function ProgressIndicator({
  message,
  progress,
  onCancel,
}: ProgressIndicatorProps) {
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent shrink-0" />
        <span className="flex-1 text-[11px] text-fg/60">{message}</span>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded p-0.5 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors"
            title="Cancel"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-1.5 h-1 rounded-full bg-accent/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Tool Result Parser ───────────────────────────────────────────────────

/** Vision tool IDs that we render rich widgets for */
const VISION_TOOL_IDS = new Set([
  "renderDrawingPage",
  "zoomDrawingRegion",
  "countSymbols",
  "detectScale",
  "saveCountAsAnnotations",
]);

export function isVisionTool(toolId: string): boolean {
  // Handle both plain tool IDs and prefixed ones (e.g. "vision.renderDrawingPage")
  const baseName = toolId.includes(".") ? toolId.split(".").pop()! : toolId;
  return VISION_TOOL_IDS.has(baseName);
}

/**
 * Parse tool call data and return the appropriate widget, or null if not a vision tool.
 * `tc` follows the ToolCallEntry shape from agent-chat.tsx.
 */
export function VisionToolWidget({
  toolId,
  input,
  result,
}: {
  toolId: string;
  input: unknown;
  result: { success: boolean; data?: unknown; error?: string; duration_ms?: number };
}) {
  const baseName = toolId.includes(".") ? toolId.split(".").pop()! : toolId;

  // Show progress indicator while tool is still running (no result yet)
  const isPending = !result.data && !result.error && result.duration_ms === 0;
  if (isPending) {
    const progressMessages: Record<string, string> = {
      renderDrawingPage: "Rendering drawing page...",
      zoomDrawingRegion: "Zooming into region...",
      countSymbols: "Counting symbols on page...",
      detectScale: "Detecting drawing scale...",
      saveCountAsAnnotations: "Saving takeoff marks...",
      measureLinear: "Measuring distance...",
      listDrawingPages: "Listing drawing pages...",
    };
    return (
      <ProgressIndicator message={progressMessages[baseName] ?? `Running ${baseName}...`} />
    );
  }

  // Parse result data — it could be a JSON string or already an object
  let data: any = result.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      // Not JSON, leave as string
    }
  }

  if (!result.success || !data) return null;

  switch (baseName) {
    case "renderDrawingPage":
    case "zoomDrawingRegion":
    case "detectScale": {
      // These tools return an image + metadata text.
      // The result.data from the SSE stream may contain the image data URL
      // or we parse the metadata JSON for page info.
      const meta =
        typeof data === "object" ? data : {};
      const imgInput = input as any;

      // If the data contains an imageUrl (injected by the SSE handler), show it
      if (meta.imageUrl || meta.image) {
        return (
          <DrawingViewer
            imageUrl={meta.imageUrl || meta.image}
            pageNumber={meta.pageNumber ?? imgInput?.pageNumber ?? 1}
            imageWidth={meta.imageWidth ?? meta.zoomedWidth ?? 0}
            imageHeight={meta.imageHeight ?? meta.zoomedHeight ?? 0}
            pageWidth={meta.pageWidth}
            pageHeight={meta.pageHeight}
            dpi={meta.dpi ?? imgInput?.dpi}
            pageCount={meta.pageCount}
          />
        );
      }

      // Fallback: just show page metadata without image
      return (
        <div className="rounded-lg border border-line/60 bg-bg/30 px-3 py-2">
          <div className="flex items-center gap-2">
            <Eye className="h-3 w-3 text-accent shrink-0" />
            <span className="text-[11px] font-medium text-fg/60">
              {baseName === "zoomDrawingRegion"
                ? "Zoomed Region"
                : baseName === "detectScale"
                  ? "Scale Detection"
                  : `Page ${meta.pageNumber ?? imgInput?.pageNumber ?? "?"}`}
            </span>
            {meta.imageWidth && (
              <span className="ml-auto text-[9px] text-fg/25">
                {meta.imageWidth} x {meta.imageHeight}px
              </span>
            )}
          </div>
        </div>
      );
    }

    case "countSymbols": {
      return (
        <MatchOverlay
          totalCount={data.totalCount ?? 0}
          matches={data.matches ?? []}
          documentId={data.documentId ?? (input as any)?.documentId ?? ""}
          pageNumber={data.pageNumber ?? (input as any)?.pageNumber ?? 1}
          threshold={data.threshold ?? (input as any)?.threshold ?? 0.65}
          duration_ms={data.duration_ms}
          errors={data.errors}
        />
      );
    }

    case "saveCountAsAnnotations": {
      const saved = data.savedCount ?? data.created ?? 0;
      return (
        <div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-success shrink-0" />
            <span className="text-[11px] font-medium text-fg/60">
              Saved {saved} takeoff mark{saved !== 1 ? "s" : ""} to takeoff
            </span>
          </div>
        </div>
      );
    }

    default:
      return null;
  }
}

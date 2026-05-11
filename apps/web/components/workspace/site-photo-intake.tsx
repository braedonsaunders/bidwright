"use client";

import { useCallback, useMemo, useState } from "react";
import { Camera, Check, Loader2, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Input, Textarea } from "@/components/ui";
import {
  generatePhotoBom,
  getDocumentDownloadUrl,
  getFileDownloadUrl,
  type PhotoTakeoffResult,
} from "@/lib/api";

/**
 * Photos can come into a project two ways: as a SourceDocument (uploaded
 * through the project intake or dropped at the Documents tab root) or as
 * a FileNode (uploaded into a user-created folder). Site Photos picks up
 * both — we just need the origin so we can resolve the right download
 * URL when fetching bytes for the vision call.
 */
export interface PhotoSource {
  id: string;       // unique within the picker — origin-prefixed
  rawId: string;    // underlying FileNode.id or SourceDocument.id
  name: string;
  size?: number;
  origin: "fileNode" | "sourceDocument";
}

/**
 * Site-Photo Intake
 *
 * Picks photos from the project's file tree, runs them through the LLM
 * vision adapter, and hands the resulting BOM rows up to the Takeoff tab
 * which exposes them as entities in the right side-panel — same per-row
 * "+ Add" + category-picker popover used by every other entity source
 * (PDF / DWG / BIM / 3D / spreadsheet). The intake itself doesn't render
 * a review table any more; the side panel is the unified review surface.
 *
 * Photos are NOT uploaded here — they come from the project Documents
 * tab. Selection cap exists to keep the vision call within reasonable
 * token budgets.
 */

const MAX_SELECTED = 8;

export interface SitePhotoIntakeProps {
  projectId: string;
  /** Active worksheet ID — surfaced for context and for downstream + Add
   *  in the side panel. Not required for the analysis itself. */
  activeWorksheetId: string | null;
  /** Free-text project blurb to pass as system context. */
  projectContextText?: string;
  /** Image-typed entries from the project, drawn from both the file tree
   *  and from source documents so both upload paths surface here. */
  photoFiles: PhotoSource[];
  /** Hand results back to TakeoffTab so it can surface them as entities
   *  in the right side panel. Called on every successful analysis;
   *  passing null clears any previous results. */
  onResults: (result: PhotoTakeoffResult | null, sourcePhotoNames: string[]) => void;
}

function formatBytes(bytes: number | undefined) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pull a project photo from the inline-download endpoint and base64-encode
 *  it for the vision API. The vision payload sends raw base64 (no data:
 *  prefix), matching the shape the @bidwright/agent adapters expect. */
async function fetchPhotoAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load photo (${response.status})`);
  }
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") return reject(new Error("Unexpected reader result"));
      resolve(value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read photo"));
    reader.readAsDataURL(blob);
  });
  const commaIdx = dataUrl.indexOf(",");
  const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return { data, mimeType: blob.type || "image/jpeg" };
}

export function SitePhotoIntake({
  projectId,
  activeWorksheetId,
  projectContextText,
  photoFiles,
  onResults,
}: SitePhotoIntakeProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusPrompt, setFocusPrompt] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResultCount, setLastResultCount] = useState<number | null>(null);

  const filteredPhotos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return photoFiles;
    return photoFiles.filter((p) => p.name.toLowerCase().includes(q));
  }, [photoFiles, search]);

  // Photos the user has marked for analysis. Stable order matches photoFiles
  // (project tree order) so the API payload + per-row sourceImageIndexes
  // mapping stay deterministic across re-renders.
  const selectedPhotos = useMemo(
    () => photoFiles.filter((p) => selectedIds.has(p.id)),
    [photoFiles, selectedIds],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_SELECTED) return prev;
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (analyzing || selectedPhotos.length === 0) return;
    setError(null);
    setLastResultCount(null);
    setAnalyzing(true);
    try {
      const context = projectContextText
        ? projectContextText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .slice(0, 20)
        : [];
      const images = await Promise.all(
        selectedPhotos.map(async (photo, idx) => {
          const url = photo.origin === "sourceDocument"
            ? getDocumentDownloadUrl(projectId, photo.rawId, true)
            : getFileDownloadUrl(projectId, photo.rawId, true);
          const { data, mimeType } = await fetchPhotoAsBase64(url);
          return {
            data,
            mimeType,
            caption: `Photo ${idx + 1}: ${photo.name}`,
          };
        }),
      );
      const response = await generatePhotoBom(projectId, {
        images,
        focusPrompt: focusPrompt.trim() || undefined,
        projectContext: context.length > 0 ? context : undefined,
      });
      onResults(response, selectedPhotos.map((p) => p.name));
      setLastResultCount(response.items.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, selectedPhotos, focusPrompt, projectContextText, projectId, onResults]);

  const selectionFull = selectedPhotos.length >= MAX_SELECTED;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 p-4">
      <div className="grid min-h-0 w-full flex-1 gap-3 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* ── Filter + Focus + Generate column ───────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-fg/45">
              Filter photos
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-fg/30" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by filename"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>

          <div className="shrink-0 rounded-md border border-line bg-panel/60 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-fg/40">Selected</p>
            <p className="mt-0.5 text-sm font-semibold text-fg">
              {selectedPhotos.length} / {MAX_SELECTED}
            </p>
            <p className="mt-0.5 text-[10px] text-fg/40">
              Pick up to {MAX_SELECTED} photos. Upload more in the Documents tab.
            </p>
            {!activeWorksheetId && (
              <p className="mt-1 text-[10px] text-warning">
                No active worksheet picked yet — rows will be ready to + Add once you pick one.
              </p>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-fg/45">
              Focus prompt (optional)
            </label>
            <Textarea
              value={focusPrompt}
              onChange={(e) => setFocusPrompt(e.target.value)}
              placeholder="e.g. Focus on demolition and finishes. The orange marker is 1 m for scale. Ignore the existing HVAC."
              className="min-h-0 flex-1 resize-none text-xs"
            />
          </div>

          <Button
            size="sm"
            disabled={analyzing || selectedPhotos.length === 0}
            onClick={handleAnalyze}
            className="shrink-0 justify-center"
          >
            {analyzing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Generate BOM from {selectedPhotos.length || "—"} photo{selectedPhotos.length === 1 ? "" : "s"}
              </>
            )}
          </Button>

          {lastResultCount !== null && !analyzing && (
            <div className="shrink-0 rounded-md border border-success/30 bg-success/5 px-2 py-1.5 text-[11px] text-success">
              {lastResultCount} item{lastResultCount === 1 ? "" : "s"} ready in the Entities panel →
              Review and + Add the ones you want.
            </div>
          )}

          {error && (
            <div className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-500">
              {error}
            </div>
          )}
        </div>

        {/* ── Photo grid column ──────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-line bg-panel/40">
          {photoFiles.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-fg/40">
              <Camera className="h-6 w-6 text-fg/25" />
              <p>No project photos yet.</p>
              <p className="text-[10px] text-fg/30">
                Add JPG / PNG / WebP / HEIC / TIFF files in Documents — they'll appear here for analysis.
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-bg/20 px-3 py-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg/50">
                  {filteredPhotos.length} of {photoFiles.length} photo{photoFiles.length === 1 ? "" : "s"}
                  {selectedPhotos.length > 0 && ` · ${selectedPhotos.length} selected`}
                </p>
                {selectedPhotos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="text-[10px] font-medium uppercase tracking-wider text-fg/45 hover:text-fg/70"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {filteredPhotos.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line bg-bg/30 px-3 py-8 text-center text-xs text-fg/40">
                    No photos match this filter.
                  </p>
                ) : (
                  <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
                    {filteredPhotos.map((photo) => {
                      const selected = selectedIds.has(photo.id);
                      const disabled = !selected && selectionFull;
                      const url = photo.origin === "sourceDocument"
                        ? getDocumentDownloadUrl(projectId, photo.rawId, true)
                        : getFileDownloadUrl(projectId, photo.rawId, true);
                      return (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => toggleSelect(photo.id)}
                          disabled={disabled}
                          title={disabled ? `Up to ${MAX_SELECTED} photos can be analyzed at once.` : photo.name}
                          className={cn(
                            "group/thumb relative overflow-hidden rounded-md border bg-panel/60 text-left shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-40",
                            selected
                              ? "border-cyan-500 ring-2 ring-cyan-500/30"
                              : "border-line hover:border-cyan-500/40",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={photo.name}
                            loading="lazy"
                            className="aspect-square h-full w-full object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[9px] text-white/90">
                            <span className="truncate" title={photo.name}>
                              {photo.name}
                            </span>
                            {photo.size != null && (
                              <span className="shrink-0 opacity-70">{formatBytes(photo.size)}</span>
                            )}
                          </div>
                          {selected && (
                            <div className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 text-white shadow">
                              <Check className="h-3 w-3" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

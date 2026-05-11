"use client";

import { useCallback, useMemo, useState } from "react";
import { Camera, Check, Loader2, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Input, Textarea } from "@/components/ui";
import {
  generatePhotoBom,
  getFileDownloadUrl,
  type EntityCategory,
  type FileNode,
} from "@/lib/api";

/**
 * Site-Photo Intake
 *
 * Selects photos from the project's file tree, then hands them to the
 * project's configured agent runtime (claude-code / opencode CLI) so the
 * agent does the vision + line-item creation directly via its existing
 * MCP tools. No separate direct-LLM vision call, no separate API key
 * contract — the agent already runs every other AI workflow in the
 * estimate and we just inject a photo-analysis prompt into the running
 * session.
 *
 * If the agent isn't running yet, the photos are still uploaded to disk
 * and we tell the estimator to start the agent and re-run. They don't
 * lose their selection.
 *
 * Selection cap exists to keep the agent prompt + token cost reasonable.
 */

const MAX_SELECTED = 8;

export interface SitePhotoIntakeProps {
  projectId: string;
  /** Worksheet the agent should drop line items into. Required — the
   *  estimator picks one before running the BOM. */
  activeWorksheetId: string | null;
  /** Enabled categories for the takeoff-category picker. Drives which
   *  bucket the agent's new line items land in. */
  categories: EntityCategory[];
  /** Free-text project blurb passed through as context to the agent. */
  projectContextText?: string;
  /** Project file nodes the caller has already filtered to image files. */
  photoFiles: FileNode[];
  /** Currently-selected takeoff category id, sourced from the side-panel
   *  picker so this surface shares its sticky bucket with + Add. May be
   *  null if the estimator hasn't picked one yet. */
  takeoffCategoryId: string | null;
  /** Open the agent chat panel so the user can watch the hand-off run.
   *  Optional — the toast is enough if this isn't wired. */
  onOpenAgentChat?: (prefill?: string) => void;
  /** Hook the parent can use to refresh worksheet data after the agent
   *  may have mutated worksheets. */
  onWorkspaceMaybeMutated?: () => void;
}

function formatBytes(bytes: number | undefined) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pull a project photo from the inline-download endpoint and base64-encode
 *  it so we can ship it to the server in JSON. The server writes the bytes
 *  back out under the project working dir before the agent reads them. */
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
  categories,
  projectContextText,
  photoFiles,
  takeoffCategoryId,
  onOpenAgentChat,
  onWorkspaceMaybeMutated,
}: SitePhotoIntakeProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusPrompt, setFocusPrompt] = useState("");
  const [handingOff, setHandingOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<{
    kind: "handed-off" | "needs-agent-session";
    message: string;
  } | null>(null);

  // The intake-surface picker is independent of the side-panel popover —
  // estimators may be in the entities chrome with a different sticky
  // category. Use a local override here, falling back to whatever the
  // side panel last picked.
  const [localCategoryId, setLocalCategoryId] = useState<string | null>(null);
  const effectiveCategoryId = localCategoryId ?? takeoffCategoryId;
  const pickableCategories = useMemo(
    () => categories.filter((c) => c.enabled && c.itemSource !== "rate_schedule"),
    [categories],
  );

  const filteredPhotos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return photoFiles;
    return photoFiles.filter((p) => p.name.toLowerCase().includes(q));
  }, [photoFiles, search]);

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

  const canRun =
    !handingOff &&
    selectedPhotos.length > 0 &&
    Boolean(activeWorksheetId) &&
    Boolean(effectiveCategoryId);

  const handleHandOff = useCallback(async () => {
    if (!canRun || !activeWorksheetId || !effectiveCategoryId) return;
    setError(null);
    setLastStatus(null);
    setHandingOff(true);
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
          const url = getFileDownloadUrl(projectId, photo.id, true);
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
        worksheetId: activeWorksheetId,
        categoryId: effectiveCategoryId,
      });
      setLastStatus({ kind: response.status, message: response.message });
      if (response.status === "handed-off") {
        // Pop open the agent chat so the user can watch the analysis +
        // line-item creation as the agent runs.
        onOpenAgentChat?.("Site photo BOM in progress — watch the agent's progress here.");
        onWorkspaceMaybeMutated?.();
        // Reset the picker state so a second batch is clean.
        setSelectedIds(new Set());
        setFocusPrompt("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo hand-off failed");
    } finally {
      setHandingOff(false);
    }
  }, [
    activeWorksheetId,
    canRun,
    effectiveCategoryId,
    focusPrompt,
    onOpenAgentChat,
    onWorkspaceMaybeMutated,
    projectContextText,
    projectId,
    selectedPhotos,
  ]);

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
          </div>

          <div className="shrink-0 flex flex-col gap-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-fg/45">
              Drop new items into
            </label>
            <select
              value={effectiveCategoryId ?? ""}
              onChange={(e) => setLocalCategoryId(e.target.value || null)}
              className={cn(
                "h-7 rounded border border-line bg-bg/50 px-1.5 text-xs outline-none focus:border-accent/50",
                effectiveCategoryId ? "text-fg" : "text-fg/45",
              )}
            >
              {!effectiveCategoryId && <option value="">Pick a category…</option>}
              {pickableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!activeWorksheetId && (
              <p className="text-[10px] text-warning">
                No active worksheet — open one in the estimate grid first.
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
            disabled={!canRun}
            onClick={handleHandOff}
            className="shrink-0 justify-center"
            title={
              !activeWorksheetId
                ? "Pick an active worksheet first."
                : !effectiveCategoryId
                  ? "Pick a category first."
                  : selectedPhotos.length === 0
                    ? "Select at least one photo."
                    : undefined
            }
          >
            {handingOff ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Handing off…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Send {selectedPhotos.length || "—"} photo{selectedPhotos.length === 1 ? "" : "s"} to agent
              </>
            )}
          </Button>

          {lastStatus && (
            <div
              className={cn(
                "shrink-0 rounded-md border px-2 py-1.5 text-[11px]",
                lastStatus.kind === "handed-off"
                  ? "border-success/30 bg-success/5 text-success"
                  : "border-warning/30 bg-warning/10 text-warning",
              )}
            >
              {lastStatus.message}
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
                Add JPG / PNG / WebP / HEIC / TIFF files in Documents — they'll appear here.
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
                      const url = getFileDownloadUrl(projectId, photo.id, true);
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

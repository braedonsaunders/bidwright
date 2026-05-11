"use client";

import { useCallback, useMemo, useState } from "react";
import { Camera, Check, FileImage, Loader2, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Input, Textarea } from "@/components/ui";
import {
  generatePhotoBom,
  getFileDownloadUrl,
  type CreateWorksheetItemInput,
  type EntityCategory,
  type FileNode,
  type PhotoTakeoffLineItem,
  type PhotoTakeoffResult,
} from "@/lib/api";

/**
 * Site-Photo Intake
 *
 * Multi-photo selector backed by the project's existing file tree → AI
 * vision → editable BOM table → one-click apply to the active worksheet as
 * line items. Runs through the user's configured LLM runtime (Anthropic /
 * OpenAI / Gemini / OpenRouter / LMStudio — server enforces vision-capable).
 * Tags rows with the org's EntityCategory taxonomy, not Uniformat.
 *
 * The component does NOT do its own uploads — photos are added through the
 * normal Documents intake, and this surface just points at the ones that
 * already exist on the project. Selection cap exists to keep the vision
 * call within reasonable token budgets.
 */

const MAX_SELECTED = 8;

export interface SitePhotoIntakeProps {
  projectId: string;
  /** Active worksheet ID — required for apply. If null, apply is disabled
   *  with a tooltip prompting the user to pick a worksheet first. */
  activeWorksheetId: string | null;
  /** Default markup applied to created items. */
  defaultMarkup: number;
  /** Organization category taxonomy. Used for the per-row category picker
   *  and to look up shortform/uom for newly created items. */
  categories: EntityCategory[];
  /** Free-text project blurb to pass as system context (residential vs
   *  commercial, scope summary, etc). Trimmed and split per line. */
  projectContextText?: string;
  /** Project file nodes that the caller has already filtered to image
   *  files (jpg/png/webp/heic/tiff). The component renders them as a
   *  selectable thumbnail grid. */
  photoFiles: FileNode[];
  /** Called once for each row the user chooses to apply. Implementation
   *  lives in the parent (TakeoffTab) so it reuses the existing
   *  createWorksheetItem path with all its provenance plumbing. */
  onApplyItem: (input: CreateWorksheetItemInput) => Promise<void>;
  /** Called when the apply batch completes (all items, or some errored).
   *  Used by the parent to refresh worksheets, toast success, etc. */
  onApplyComplete?: (count: number) => void;
}

function findCategoryById(categories: EntityCategory[], id: string): EntityCategory | undefined {
  return categories.find((c) => c.id === id);
}

function formatBytes(bytes: number | undefined) {
  if (!bytes && bytes !== 0) return "";
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
  defaultMarkup,
  categories,
  projectContextText,
  photoFiles,
  onApplyItem,
  onApplyComplete,
}: SitePhotoIntakeProps) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusPrompt, setFocusPrompt] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<PhotoTakeoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());

  const filteredPhotos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return photoFiles;
    return photoFiles.filter((p) => p.name.toLowerCase().includes(q));
  }, [photoFiles, search]);

  // Photos the user has marked for analysis. Stable order matches photoFiles
  // (project tree order) so the API payload + per-row sourceImageIndexes
  // mapping below stays deterministic across re-renders.
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
    setAnalyzing(true);
    setResult(null);
    setSelectedRowIndexes(new Set());
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
      });
      setResult(response);
      // Pre-select rows with confidence ≥ 0.6 so the user can apply the
      // high-confidence subset with one click and review the low-confidence
      // ones inline.
      const initialSelection = new Set<number>();
      response.items.forEach((row, idx) => {
        if (row.confidence >= 0.6) initialSelection.add(idx);
      });
      setSelectedRowIndexes(initialSelection);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, selectedPhotos, focusPrompt, projectContextText, projectId]);

  const updateRow = useCallback((idx: number, patch: Partial<PhotoTakeoffLineItem>) => {
    setResult((prev) => {
      if (!prev) return prev;
      const next = [...prev.items];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, items: next };
    });
  }, []);

  const toggleRow = useCallback((idx: number) => {
    setSelectedRowIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleApply = useCallback(async () => {
    if (!result || applying || !activeWorksheetId || selectedRowIndexes.size === 0) return;
    setApplying(true);
    setError(null);
    let created = 0;
    try {
      for (const idx of selectedRowIndexes) {
        const row = result.items[idx];
        if (!row) continue;
        const category = findCategoryById(categories, row.categoryId);
        const sourceImages = row.sourceImageIndexes
          .map((i) => selectedPhotos[i]?.name)
          .filter(Boolean)
          .join(", ");
        const sourceNotes = [
          "From site-photo BOM (AI vision)",
          row.notes,
          sourceImages ? `Sourced from: ${sourceImages}` : "",
          `Confidence: ${(row.confidence * 100).toFixed(0)}%`,
          focusPrompt.trim() ? `Focus prompt: ${focusPrompt.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const payload: CreateWorksheetItemInput = {
          categoryId: category?.id ?? null,
          category: category?.name ?? "Material",
          entityType: category?.entityType ?? "Material",
          entityName: row.description,
          description: "",
          quantity: row.quantity,
          uom: row.uom || category?.defaultUom || "EA",
          cost: 0,
          markup: defaultMarkup,
          price: 0,
          sourceNotes,
        };
        await onApplyItem(payload);
        created += 1;
      }
      onApplyComplete?.(created);
      setResult(null);
      setSelectedRowIndexes(new Set());
      setSelectedIds(new Set());
      setFocusPrompt("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply line items");
    } finally {
      setApplying(false);
    }
  }, [
    activeWorksheetId,
    applying,
    categories,
    defaultMarkup,
    focusPrompt,
    selectedPhotos,
    onApplyComplete,
    onApplyItem,
    result,
    selectedRowIndexes,
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

          {error && (
            <div className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-500">
              {error}
            </div>
          )}
        </div>

        {/* ── Photo grid / Result column ───────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-line bg-panel/40">
          {!result ? (
            photoFiles.length === 0 ? (
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
                    <div className="grid w-full grid-cols-[repeat(auto-fill,160px)] justify-start gap-2">
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
            )
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              {result.summary && (
                <div className="shrink-0 border-b border-line bg-bg/30 px-3 py-2 text-[11px] text-fg/65">
                  {result.summary}
                </div>
              )}
              {result.warnings.length > 0 && (
                <div className="shrink-0 border-b border-line bg-amber-500/5 px-3 py-1.5 text-[10px] text-amber-700">
                  {result.warnings.map((w, i) => (
                    <p key={i}>· {w}</p>
                  ))}
                </div>
              )}

              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-bg/20 px-3 py-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-fg/50">
                  {result.items.length} {result.items.length === 1 ? "item" : "items"} ·{" "}
                  {selectedRowIndexes.size} selected
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setResult(null);
                      setSelectedRowIndexes(new Set());
                    }}
                  >
                    Back to photos
                  </Button>
                  <Button
                    size="xs"
                    disabled={applying || !activeWorksheetId || selectedRowIndexes.size === 0}
                    onClick={handleApply}
                    title={!activeWorksheetId ? "Pick an active worksheet first." : undefined}
                  >
                    {applying ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      <>
                        <FileImage className="h-3 w-3" />
                        Add {selectedRowIndexes.size} to worksheet
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-panel/95 text-[10px] uppercase tracking-wider text-fg/45 backdrop-blur">
                    <tr className="border-b border-line">
                      <th className="w-7 px-2 py-1.5 text-left">
                        <input
                          type="checkbox"
                          checked={
                            result.items.length > 0 &&
                            selectedRowIndexes.size === result.items.length
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRowIndexes(new Set(result.items.map((_, i) => i)));
                            } else {
                              setSelectedRowIndexes(new Set());
                            }
                          }}
                          className="h-3 w-3"
                        />
                      </th>
                      <th className="px-2 py-1.5 text-left font-medium">Item</th>
                      <th className="w-16 px-2 py-1.5 text-right font-medium">Qty</th>
                      <th className="w-12 px-2 py-1.5 text-left font-medium">UOM</th>
                      <th className="w-40 px-2 py-1.5 text-left font-medium">Category</th>
                      <th className="w-14 px-2 py-1.5 text-right font-medium">Conf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((row, idx) => {
                      const selected = selectedRowIndexes.has(idx);
                      const confTone =
                        row.confidence >= 0.75
                          ? "text-emerald-600 bg-emerald-500/10"
                          : row.confidence >= 0.5
                            ? "text-amber-600 bg-amber-500/10"
                            : "text-rose-500 bg-rose-500/10";
                      return (
                        <tr
                          key={idx}
                          className={cn(
                            "border-b border-line/60 text-fg/80 transition-colors",
                            selected ? "bg-cyan-500/5" : "hover:bg-panel2/30",
                          )}
                        >
                          <td className="px-2 py-1.5 align-top">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleRow(idx)}
                              className="h-3 w-3"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <Input
                              value={row.description}
                              onChange={(e) => updateRow(idx, { description: e.target.value })}
                              className="h-7 text-xs"
                            />
                            {row.notes && (
                              <p className="mt-0.5 text-[10px] text-fg/45" title={row.notes}>
                                {row.notes.length > 90 ? `${row.notes.slice(0, 88)}…` : row.notes}
                              </p>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <Input
                              type="number"
                              value={row.quantity}
                              onChange={(e) => updateRow(idx, { quantity: Number(e.target.value) })}
                              className="h-7 w-full text-right text-xs"
                              step="0.01"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <Input
                              value={row.uom}
                              onChange={(e) => updateRow(idx, { uom: e.target.value.toUpperCase() })}
                              className="h-7 w-full uppercase text-xs"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <select
                              value={row.categoryId}
                              onChange={(e) => updateRow(idx, { categoryId: e.target.value })}
                              className="h-7 w-full rounded border border-line bg-bg/50 px-1 text-xs text-fg outline-none focus:border-accent/50"
                            >
                              <option value="">— Uncategorized —</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 align-top text-right">
                            <span
                              className={cn(
                                "inline-block rounded px-1 py-0.5 text-[10px] font-medium tabular-nums",
                                confTone,
                              )}
                              title={`Model confidence ${(row.confidence * 100).toFixed(0)}%`}
                            >
                              {(row.confidence * 100).toFixed(0)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

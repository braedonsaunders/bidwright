"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FileImage, Loader2, Sparkles, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, Input, Textarea } from "@/components/ui";
import {
  generatePhotoBom,
  type CreateWorksheetItemInput,
  type EntityCategory,
  type PhotoTakeoffLineItem,
  type PhotoTakeoffResult,
} from "@/lib/api";

/**
 * Site-Photo Intake
 *
 * Drag-and-drop multi-photo uploader → AI vision → editable BOM table →
 * one-click apply to the active worksheet as line items. Runs through the
 * user's configured LLM runtime (Anthropic / OpenAI / OpenRouter — server
 * enforces vision-capable). Tags rows with the org's EntityCategory
 * taxonomy, not Uniformat.
 *
 * Self-contained: owns its own upload / analysis / review / apply state.
 * The parent passes in the project + active worksheet + category list and
 * an apply callback that creates the worksheet items.
 */

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB per image; matches typical phone photo size after JPEG compression.
const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/tif",
]);

interface PendingImage {
  id: string;
  /** Object URL for preview. Revoked on remove + on unmount. */
  previewUrl: string;
  /** Base64 payload (no data: prefix). */
  data: string;
  mimeType: string;
  fileName: string;
  caption: string;
  /** Original byte size — surfaced in the thumbnail tooltip. */
  bytes: number;
}

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
  /** Called once for each row the user chooses to apply. Implementation
   *  lives in the parent (TakeoffTab) so it reuses the existing
   *  createWorksheetItem path with all its provenance plumbing. */
  onApplyItem: (input: CreateWorksheetItemInput) => Promise<void>;
  /** Called when the apply batch completes (all items, or some errored).
   *  Used by the parent to refresh worksheets, toast success, etc. */
  onApplyComplete?: (count: number) => void;
}

function readFileAsBase64(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Unexpected reader result"));
      const commaIdx = result.indexOf(",");
      const data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({ data, mimeType: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function findCategoryById(categories: EntityCategory[], id: string): EntityCategory | undefined {
  return categories.find((c) => c.id === id);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SitePhotoIntake({
  projectId,
  activeWorksheetId,
  defaultMarkup,
  categories,
  projectContextText,
  onApplyItem,
  onApplyComplete,
}: SitePhotoIntakeProps) {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [focusPrompt, setFocusPrompt] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<PhotoTakeoffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowIndexes, setSelectedRowIndexes] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke any pending object URLs on unmount so we don't leak browser memory
  // for selected-but-not-uploaded images.
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
    // We intentionally don't re-run on `images` change; the helper below
    // revokes individually when an image is removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const remainingSlots = MAX_IMAGES - images.length;
      if (remainingSlots <= 0) {
        setError(`At most ${MAX_IMAGES} photos per analysis. Remove one before adding another.`);
        return;
      }
      const accepted: PendingImage[] = [];
      for (const file of files.slice(0, remainingSlots)) {
        if (!ACCEPTED_TYPES.has(file.type)) {
          setError(`"${file.name}" isn't a supported image type. Use JPG, PNG, WebP, HEIC, or TIFF.`);
          continue;
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setError(`"${file.name}" is ${formatBytes(file.size)} — over the ${formatBytes(MAX_IMAGE_BYTES)} per-image limit.`);
          continue;
        }
        try {
          const { data, mimeType } = await readFileAsBase64(file);
          accepted.push({
            id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            previewUrl: URL.createObjectURL(file),
            data,
            mimeType,
            fileName: file.name,
            caption: "",
            bytes: file.size,
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to read image");
        }
      }
      if (accepted.length > 0) {
        setImages((prev) => [...prev, ...accepted]);
      }
    },
    [images.length],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
      if (files.length > 0) await addFiles(files);
    },
    [addFiles],
  );

  const handleAnalyze = useCallback(async () => {
    if (analyzing || images.length === 0) return;
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
      const response = await generatePhotoBom(projectId, {
        images: images.map((img, idx) => ({
          data: img.data,
          mimeType: img.mimeType,
          caption: img.caption.trim() || `Photo ${idx + 1}: ${img.fileName}`,
        })),
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
  }, [analyzing, images, focusPrompt, projectContextText, projectId]);

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
          .map((i) => images[i]?.fileName)
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
      // Reset state so the user can run another batch without stale UI.
      setResult(null);
      setSelectedRowIndexes(new Set());
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setImages([]);
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
    images,
    onApplyComplete,
    onApplyItem,
    result,
    selectedRowIndexes,
  ]);

  // Drag-and-drop visual state. Tracked with a counter to handle nested
  // dragenter/dragleave events (the standard React DnD quirk).
  const [dragCounter, setDragCounter] = useState(0);
  const isDragOver = dragCounter > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      {/* ── Upload + Focus column ─────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-2">
          {/* Drop zone */}
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragCounter((c) => c + 1);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragCounter((c) => Math.max(0, c - 1));
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              setDragCounter(0);
              void handleDrop(e);
            }}
            className={cn(
              "flex shrink-0 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-5 text-center transition-colors",
              isDragOver
                ? "border-cyan-500 bg-cyan-500/8 text-cyan-500"
                : "border-line bg-panel/40 text-fg/55 hover:border-cyan-500/40 hover:bg-cyan-500/5",
            )}
          >
            <Upload className="h-5 w-5" />
            <p className="text-xs font-medium text-fg/70">Drop site photos here</p>
            <p className="text-[10px] text-fg/40">
              or
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="ml-1 font-medium text-cyan-500 underline-offset-2 hover:underline"
              >
                browse files
              </button>
            </p>
            <p className="text-[10px] text-fg/35">
            Up to {MAX_IMAGES} · {formatBytes(MAX_IMAGE_BYTES)} each · JPG / PNG / WebP / HEIC / TIFF
          </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) void addFiles(files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Focus prompt — grows to fill the column so it dominates the
              attention budget over the drop zone and the still-small Generate
              button. */}
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

          {/* Analyze button */}
          <Button
            size="sm"
            disabled={analyzing || images.length === 0}
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
                Generate BOM from {images.length || "—"} photo{images.length === 1 ? "" : "s"}
              </>
            )}
          </Button>

          {error && (
            <div className="shrink-0 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-500">
              {error}
            </div>
          )}
        </div>

        {/* ── Result column ─────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-col rounded-md border border-line bg-panel/40">
          {!result ? (
            images.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-fg/40">
                <Camera className="h-6 w-6 text-fg/25" />
                <p>Add photos, then generate a BOM.</p>
                <p className="text-[10px] text-fg/30">
                  Runs against your selected AI runtime — see Settings &gt; Integrations.
                </p>
              </div>
            ) : (
              // Pre-generate preview: thumbnails of the photos the user has
              // queued up. Keeps the focus prompt to the left undisturbed and
              // gives the photos the spatial real estate they deserve.
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-bg/20 px-3 py-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-fg/50">
                    {images.length} photo{images.length === 1 ? "" : "s"} queued · {MAX_IMAGES - images.length} more allowed
                  </p>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={images.length >= MAX_IMAGES}
                  >
                    <Upload className="h-3 w-3" />
                    Add more
                  </Button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {images.map((img) => (
                      <div
                        key={img.id}
                        className="group/thumb relative overflow-hidden rounded-md border border-line bg-panel/60 shadow-sm"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.previewUrl}
                          alt={img.fileName}
                          className="aspect-square h-full w-full object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1 text-[9px] text-white/90">
                          <span className="truncate" title={`${img.fileName} · ${formatBytes(img.bytes)}`}>
                            {img.fileName}
                          </span>
                          <span className="shrink-0 opacity-70">{formatBytes(img.bytes)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeImage(img.id)}
                          className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg/90 text-fg/75 opacity-0 shadow transition-opacity hover:text-rose-500 group-hover/thumb:opacity-100"
                          title="Remove"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
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

"use client";

import { useState, useMemo } from "react";
import { Eye, EyeOff, Pencil, Trash2, ChevronDown, ChevronRight, Check, X, Link2, ArrowRight, Sparkles, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Separator,
} from "@/components/ui";
import type { TakeoffAnnotation } from "./annotation-canvas";
import type { LineItemSuggestionRecord, SuggestLineItemsResultRecord, TakeoffLinkRecord } from "@/lib/api";

const EDIT_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316"];

interface AnnotationSidebarProps {
  annotations: TakeoffAnnotation[];
  onToggleVisibility: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
  onSaveEdit?: (id: string, updates: { label?: string; color?: string; groupName?: string }) => void;
  onSelectAnnotation: (id: string) => void;
  selectedAnnotationId: string | null;
  editingAnnotationId?: string | null;
  /** Takeoff links for showing link badges */
  takeoffLinks?: TakeoffLinkRecord[];
  /** Called to open the link-to-line-item modal for an annotation */
  onLinkToLineItem?: (annotationId: string) => void;
  /** Called to send annotation measurement directly as a new line item */
  onSendToEstimate?: (annotationId: string) => void;
  /** Called to ask the LLM for matching catalog / rate-schedule line items.
   *  Returns the result; the sidebar manages presentation. */
  onSuggestLineItems?: (annotationId: string) => Promise<SuggestLineItemsResultRecord>;
  /** Called when the user clicks "Add" on one of the AI suggestions. The
   *  parent decides which worksheet to put it in. */
  onApplySuggestion?: (
    annotationId: string,
    suggestion: LineItemSuggestionRecord,
  ) => Promise<void> | void;
  /** When true, renders without the outer Card wrapper (for embedding in a unified card layout) */
  embedded?: boolean;
}

/* Group annotations by groupName or type */
function groupAnnotations(
  annotations: TakeoffAnnotation[]
): Map<string, TakeoffAnnotation[]> {
  const groups = new Map<string, TakeoffAnnotation[]>();
  for (const ann of annotations) {
    const key = ann.groupName || ann.type;
    const arr = groups.get(key) ?? [];
    arr.push(ann);
    groups.set(key, arr);
  }
  return groups;
}

/* Format measurement for display */
function formatMeasurement(ann: TakeoffAnnotation): string {
  if (!ann.measurement) return "--";
  const { value, unit } = ann.measurement;
  if (unit === "count") return `${value}`;
  return `${value.toFixed(2)} ${unit}`;
}

/* Roll up a list of annotations into a single summary string. Linear ones
   sum into a single distance, area-* into a single area, counts into a
   total, and mixed groups fall back to "N items". */
function formatGroupTotal(items: TakeoffAnnotation[]): string {
  if (items.length === 0) return "";
  const measurements = items.filter((a) => a.measurement && a.measurement.value > 0);
  if (measurements.length === 0) return `${items.length} items`;
  const units = new Set(measurements.map((a) => a.measurement!.unit));
  if (units.size === 1) {
    const unit = measurements[0]!.measurement!.unit;
    if (unit === "count") {
      // For count tools, sum the points (each annotation is a single click for "count" tool;
      // count-by-distance produces a value per annotation).
      const total = items.reduce((s, a) => {
        if (a.measurement?.unit === "count") return s + (a.measurement.value || 0);
        if (a.type === "count") return s + (a.points?.length ?? 0);
        return s;
      }, 0);
      return `${total} count`;
    }
    const total = measurements.reduce((s, a) => s + (a.measurement!.value || 0), 0);
    const fmt = total >= 1000 ? total.toFixed(0) : total.toFixed(2);
    return `${fmt} ${unit}`;
  }
  return `${items.length} items`;
}

/* Pretty label for annotation type */
const TYPE_LABELS: Record<string, string> = {
  calibrate: "Calibration",
  linear: "Linear",
  "linear-polyline": "Polyline",
  "linear-drop": "Linear Drop",
  "area-rectangle": "Rectangle",
  "area-polygon": "Polygon",
  "area-triangle": "Triangle",
  "area-ellipse": "Ellipse",
  "area-vertical-wall": "Vertical Wall",
  count: "Count",
  "count-by-distance": "Count by Distance",
  "auto-count": "Auto Count",
  "markup-note": "Note",
  "markup-cloud": "Cloud",
  "markup-arrow": "Arrow",
  "markup-highlight": "Highlight",
  "ask-ai": "Ask AI",
};

/* Inline edit row */
function EditRow({ ann, onSave, onCancel }: { ann: TakeoffAnnotation; onSave: (updates: { label?: string; color?: string; groupName?: string }) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(ann.label);
  const [color, setColor] = useState(ann.color);
  const [group, setGroup] = useState(ann.groupName ?? "");

  return (
    <div className="space-y-1.5 rounded-md border border-accent/30 bg-accent/5 p-2">
      <Input
        className="h-6 text-xs"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label..."
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") onSave({ label, color, groupName: group || undefined }); if (e.key === "Escape") onCancel(); }}
      />
      <Input
        className="h-6 text-xs"
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        placeholder="Group name..."
      />
      <div className="flex items-center gap-1">
        {EDIT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={cn(
              "h-5 w-5 rounded-full border-2 transition-all",
              color === c ? "border-fg scale-110" : "border-transparent hover:border-fg/20"
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-1 pt-0.5">
        <button onClick={onCancel} className="rounded p-1 text-fg/40 hover:text-fg/60">
          <X className="h-3 w-3" />
        </button>
        <button onClick={() => onSave({ label, color, groupName: group || undefined })} className="rounded p-1 text-accent hover:text-accent/80">
          <Check className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* Inline AI suggestion panel — shown directly below an annotation row.
   Renders the LLM's ranked list of catalog/rate-schedule items with a one-
   click "Add" per item. The state is owned by the parent sidebar so the
   panel survives re-renders without losing the loaded suggestions. */
function SuggestionPanel({
  annotationId,
  state,
  onApply,
  onClose,
}: {
  annotationId: string;
  state: SuggestionState;
  onApply: (annId: string, suggestion: LineItemSuggestionRecord) => Promise<void> | void;
  onClose: () => void;
}) {
  if (state.loading) {
    return (
      <div className="ml-3 mt-1 flex items-center gap-2 rounded-md border border-accent/20 bg-accent/5 px-2 py-1.5 text-[11px] text-fg/60">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Asking AI for matching line items…</span>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="ml-3 mt-1 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-[11px] text-danger">
        <span className="flex-1">{state.error}</span>
        <button onClick={onClose} className="text-danger/70 hover:text-danger">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }
  if (!state.result) return null;

  const { suggestions, warnings } = state.result;
  if (suggestions.length === 0) {
    return (
      <div className="ml-3 mt-1 flex items-center gap-2 rounded-md border border-line bg-panel2/40 px-2 py-1.5 text-[11px] text-fg/50">
        <Sparkles className="h-3 w-3 text-fg/40" />
        <span className="flex-1">{warnings[0] ?? "No matching items found."}</span>
        <button onClick={onClose} className="text-fg/40 hover:text-fg/60">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="ml-3 mt-1 space-y-1 rounded-md border border-accent/20 bg-accent/5 p-1.5">
      <div className="flex items-center gap-1.5 px-1 pb-0.5">
        <Sparkles className="h-3 w-3 text-accent" />
        <p className="flex-1 text-[11px] font-medium text-accent">
          AI suggestions ({suggestions.length})
        </p>
        <button onClick={onClose} className="text-fg/40 hover:text-fg/60">
          <X className="h-3 w-3" />
        </button>
      </div>
      {suggestions.map((s) => {
        const applying = state.applying.has(s.id);
        const confidencePct = Math.round(s.confidence * 100);
        return (
          <div
            key={`${s.kind}:${s.id}`}
            className="flex items-start gap-2 rounded bg-panel/40 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium text-fg/80">
                  {s.code ? `[${s.code}] ` : ""}
                  {s.name}
                </span>
                <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0 text-[9px] font-medium text-accent">
                  {confidencePct}%
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-fg/30">
                  {s.kind === "catalog" ? "Cat" : "Rate"}
                </span>
              </div>
              {s.reasoning && (
                <p className="mt-0.5 text-[10px] leading-snug text-fg/45">
                  {s.reasoning}
                </p>
              )}
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                void onApply(annotationId, s);
              }}
              disabled={applying}
              className="shrink-0 rounded bg-accent/15 px-1.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
              title="Add to active worksheet"
            >
              {applying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className="inline-flex items-center gap-0.5">
                  <Plus className="h-2.5 w-2.5" />
                  Add
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface SuggestionState {
  loading: boolean;
  applying: Set<string>;
  result: SuggestLineItemsResultRecord | null;
  error: string | null;
}

const EMPTY_SUGGESTION_STATE: SuggestionState = {
  loading: false,
  applying: new Set(),
  result: null,
  error: null,
};

export function AnnotationSidebar({
  annotations,
  onToggleVisibility,
  onDelete,
  onEdit,
  onSaveEdit,
  onSelectAnnotation,
  selectedAnnotationId,
  editingAnnotationId,
  takeoffLinks,
  onLinkToLineItem,
  onSendToEstimate,
  onSuggestLineItems,
  onApplySuggestion,
  embedded,
}: AnnotationSidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [suggestionStates, setSuggestionStates] = useState<Map<string, SuggestionState>>(new Map());
  const groups = groupAnnotations(annotations);

  function getSuggestionState(annId: string): SuggestionState {
    return suggestionStates.get(annId) ?? EMPTY_SUGGESTION_STATE;
  }

  function updateSuggestionState(annId: string, patch: Partial<SuggestionState>) {
    setSuggestionStates((prev) => {
      const next = new Map(prev);
      const current = next.get(annId) ?? EMPTY_SUGGESTION_STATE;
      next.set(annId, { ...current, ...patch });
      return next;
    });
  }

  async function handleSuggestClick(annId: string) {
    if (!onSuggestLineItems) return;
    const existing = suggestionStates.get(annId);
    // Toggle: if a result is already shown, hide it.
    if (existing?.result) {
      setSuggestionStates((prev) => {
        const next = new Map(prev);
        next.delete(annId);
        return next;
      });
      return;
    }
    updateSuggestionState(annId, { loading: true, error: null, result: null });
    try {
      const result = await onSuggestLineItems(annId);
      updateSuggestionState(annId, { loading: false, result });
    } catch (err) {
      updateSuggestionState(annId, {
        loading: false,
        error: err instanceof Error ? err.message : "Suggestion failed",
      });
    }
  }

  async function handleApplyClick(annId: string, suggestion: LineItemSuggestionRecord) {
    if (!onApplySuggestion) return;
    const current = getSuggestionState(annId);
    const applying = new Set(current.applying);
    applying.add(suggestion.id);
    updateSuggestionState(annId, { applying });
    try {
      await onApplySuggestion(annId, suggestion);
    } finally {
      const next = new Set(applying);
      next.delete(suggestion.id);
      updateSuggestionState(annId, { applying: next });
    }
  }

  /* Link count per annotation */
  const linkCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const link of takeoffLinks ?? []) {
      map.set(link.annotationId, (map.get(link.annotationId) ?? 0) + 1);
    }
    return map;
  }, [takeoffLinks]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /* Summary stats */
  const totalCount = annotations.length;
  const visibleCount = annotations.filter((a) => a.visible).length;

  const content = (
    <>
      {totalCount === 0 ? (
        <EmptyState className="py-6 border-none">
          <p className="text-xs">No annotations yet</p>
          <p className="mt-1 text-[11px] text-fg/30">
            Select a tool and click on the drawing to start measuring
          </p>
        </EmptyState>
      ) : (
        Array.from(groups.entries()).map(([groupKey, items]) => {
            const collapsed = collapsedGroups.has(groupKey);
            const groupLabel = TYPE_LABELS[groupKey] ?? groupKey;

            return (
              <div key={groupKey} className="mb-1">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-fg/60 hover:bg-panel2/60 transition-colors"
                >
                  {collapsed ? (
                    <ChevronRight className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  <span className="truncate">{groupLabel}</span>
                  <span className="ml-auto text-[11px] font-mono text-emerald-400/85">
                    {formatGroupTotal(items)}
                  </span>
                  <span className="text-[10px] text-fg/30 ml-2">×{items.length}</span>
                </button>

                {/* Group items */}
                {!collapsed && (
                  <div className="ml-2 space-y-0.5">
                    {items.map((ann) =>
                      editingAnnotationId === ann.id && onSaveEdit ? (
                        <EditRow
                          key={ann.id}
                          ann={ann}
                          onSave={(updates) => onSaveEdit(ann.id, updates)}
                          onCancel={() => onEdit(ann.id)} /* toggle off */
                        />
                      ) : (
                        <div key={ann.id}>
                        <div
                          onClick={() => onSelectAnnotation(ann.id)}
                          className={cn(
                            "group flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors",
                            selectedAnnotationId === ann.id
                              ? "bg-accent/10 border border-accent/20"
                              : "hover:bg-panel2/40 border border-transparent"
                          )}
                        >
                          {/* Color indicator */}
                          <div
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: ann.color }}
                          />

                          {/* Label and measurement */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <p className="truncate text-xs font-medium text-fg/80">
                                {ann.label || `${TYPE_LABELS[ann.type] ?? ann.type}`}
                              </p>
                              {(linkCountMap.get(ann.id) ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                                  <Link2 className="h-2.5 w-2.5" />
                                  {linkCountMap.get(ann.id)}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-fg/40">
                              {formatMeasurement(ann)}
                            </p>
                          </div>

                          {/* Action buttons (show on hover) */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {onSuggestLineItems && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleSuggestClick(ann.id);
                                }}
                                className={cn(
                                  "rounded p-1 hover:bg-accent/10",
                                  getSuggestionState(ann.id).result
                                    ? "text-accent"
                                    : "text-fg/30 hover:text-accent",
                                )}
                                title="Suggest line items (AI)"
                                disabled={getSuggestionState(ann.id).loading}
                              >
                                {getSuggestionState(ann.id).loading ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3" />
                                )}
                              </button>
                            )}
                            {onSendToEstimate && ann.measurement && ann.measurement.value > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSendToEstimate(ann.id);
                                }}
                                className="rounded p-1 text-fg/30 hover:bg-accent/10 hover:text-accent"
                                title="Send to Estimate"
                              >
                                <ArrowRight className="h-3 w-3" />
                              </button>
                            )}
                            {onLinkToLineItem && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onLinkToLineItem(ann.id);
                                }}
                                className="rounded p-1 text-fg/30 hover:bg-accent/10 hover:text-accent"
                                title="Link to Line Item"
                              >
                                <Link2 className="h-3 w-3" />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleVisibility(ann.id);
                              }}
                              className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
                              title={ann.visible ? "Hide" : "Show"}
                            >
                              {ann.visible ? (
                                <Eye className="h-3 w-3" />
                              ) : (
                                <EyeOff className="h-3 w-3" />
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onEdit(ann.id);
                              }}
                              className="rounded p-1 text-fg/30 hover:bg-panel2 hover:text-fg/60"
                              title="Edit"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDelete(ann.id);
                              }}
                              className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                        <SuggestionPanel
                          annotationId={ann.id}
                          state={getSuggestionState(ann.id)}
                          onApply={handleApplyClick}
                          onClose={() =>
                            setSuggestionStates((prev) => {
                              const next = new Map(prev);
                              next.delete(ann.id);
                              return next;
                            })
                          }
                        />
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Summary footer */}
        {totalCount > 0 && (
          <>
            <Separator className="mt-auto" />
            <div className="rounded-md bg-panel2/50 px-3 py-2 mt-1">
              <p className="text-xs font-medium text-fg/60">
                {totalCount} annotation{totalCount !== 1 ? "s" : ""}
              </p>
            </div>
          </>
        )}
    </>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-line px-4 py-3">
          <p className="text-sm font-semibold text-fg">Annotations</p>
          <p className="mt-0.5 text-[11px] text-fg/40">
            {totalCount} item{totalCount !== 1 ? "s" : ""} &middot; {visibleCount} visible
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-1 overflow-auto py-2 px-2">
          {content}
        </div>
      </div>
    );
  }

  return (
    <Card className="flex h-full w-72 shrink-0 flex-col overflow-hidden">
      <CardHeader className="py-3">
        <CardTitle>Annotations</CardTitle>
        <p className="mt-0.5 text-[11px] text-fg/40">
          {totalCount} item{totalCount !== 1 ? "s" : ""} &middot; {visibleCount} visible
        </p>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col gap-1 overflow-auto py-2 px-2">
        {content}
      </CardBody>
    </Card>
  );
}

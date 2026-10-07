"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Button, Input, Textarea } from "@braedonsaunders/appkit-ui";
import { Badge } from "@/components/legacy-controls";
import {
  getEstimateStrategy,
  reviewEstimateFeedback,
  type CalibrationLesson,
  type EstimateCalibrationFeedback,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Calibration review: the human side of reviewed-only learning.
 *
 * Captured corrections (human edits to agent rows, review resolutions, manual
 * feedback) land here as "pending". An estimator reads what changed, edits
 * the lesson text into something a future agent can act on, and approves or
 * rejects. Only approved lessons are ever retrieved for later estimates.
 */

export interface CalibrationReviewPanelProps {
  projectId: string;
  onError?: (message: string) => void;
  /** Injectable for tests. Defaults to the API client. */
  loadFeedback?: (projectId: string) => Promise<EstimateCalibrationFeedback[]>;
  submitReview?: typeof reviewEstimateFeedback;
}

type DraftLesson = CalibrationLesson & { key: string };

function makeKey() {
  return `lesson-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDraftLessons(value: unknown): DraftLesson[] {
  if (!Array.isArray(value)) return [];
  const drafts: DraftLesson[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      if (entry.trim()) drafts.push({ key: makeKey(), lesson: entry.trim(), tags: [] });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const lesson = String(raw.lesson ?? raw.text ?? raw.statement ?? "").trim();
    if (!lesson) continue;
    drafts.push({
      key: makeKey(),
      lesson,
      tags: Array.isArray(raw.tags) ? raw.tags.map((tag) => String(tag)) : [],
      context: raw.context ? String(raw.context) : null,
      evidence: raw.evidence ? String(raw.evidence) : null,
    });
  }
  return drafts;
}

/** One readable line per captured correction. */
export function describeCorrection(correction: Record<string, unknown>): string {
  const action = String(correction.action ?? "change");
  const name = String(correction.entityName ?? correction.name ?? correction.itemId ?? "").trim();
  const changes = Array.isArray(correction.changes) ? (correction.changes as Array<Record<string, unknown>>) : [];
  if (changes.length > 0) {
    const parts = changes.slice(0, 4).map((change) => {
      const field = String(change.field ?? "");
      const before = change.before === undefined ? "∅" : typeof change.before === "object" ? "{…}" : String(change.before);
      const after = change.after === undefined ? "∅" : typeof change.after === "object" ? "{…}" : String(change.after);
      return `${field}: ${before} → ${after}`;
    });
    return `${action}${name ? ` · ${name}` : ""} — ${parts.join("; ")}${changes.length > 4 ? ` (+${changes.length - 4} more)` : ""}`;
  }
  const fields = Array.isArray(correction.fields) ? (correction.fields as unknown[]).map(String).join(", ") : "";
  return `${action}${name ? ` · ${name}` : ""}${fields ? ` — ${fields}` : ""}`;
}

/** A starting lesson drafted from a correction so the reviewer edits rather than starts blank. */
export function suggestLessonFromCorrection(correction: Record<string, unknown>): string | null {
  const name = String(correction.entityName ?? "").trim();
  const changes = Array.isArray(correction.changes) ? (correction.changes as Array<Record<string, unknown>>) : [];
  const quantityChange = changes.find((change) => change.field === "quantity");
  const derivation = correction.aiDerivation as Record<string, unknown> | null | undefined;
  if (quantityChange && name) {
    const formula = derivation?.formula ? ` (AI formula was "${String(derivation.formula)}")` : "";
    return `For "${name}", the AI quantity ${String(quantityChange.before)} was corrected to ${String(quantityChange.after)}${formula}. Verify the per-instance factor against the drawing note before multiplying.`;
  }
  if (correction.action === "delete_item" && name) {
    return `"${name}" was removed by the estimator; do not add this scope unless the documents explicitly require it.`;
  }
  return null;
}

function statusTone(status: string | undefined) {
  if (status === "approved") return "bg-emerald-500/15 text-emerald-600";
  if (status === "rejected") return "bg-fg/10 text-fg/50";
  return "bg-amber-500/15 text-amber-600";
}

export function CalibrationReviewPanel({
  projectId,
  onError,
  loadFeedback,
  submitReview,
}: CalibrationReviewPanelProps) {
  const load = useMemo(
    () => loadFeedback ?? (async (id: string) => (await getEstimateStrategy(id)).feedback ?? []),
    [loadFeedback],
  );
  const submit = submitReview ?? reviewEstimateFeedback;

  const [rows, setRows] = useState<EstimateCalibrationFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftLesson[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await load(projectId);
      setRows(next);
      setDrafts((current) => {
        const merged = { ...current };
        for (const row of next) {
          if (!merged[row.id]) {
            const seeded = normalizeDraftLessons(row.reviewStatus === "approved" ? row.approvedLessons : row.lessons);
            if (seeded.length === 0 && row.reviewStatus !== "approved") {
              for (const correction of row.corrections ?? []) {
                const suggestion = suggestLessonFromCorrection(correction);
                if (suggestion) seeded.push({ key: makeKey(), lesson: suggestion, tags: [] });
              }
            }
            merged[row.id] = seeded;
          }
        }
        return merged;
      });
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not load calibration feedback");
    } finally {
      setLoading(false);
    }
  }, [load, projectId, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = rows.filter((row) => filter === "all" || (row.reviewStatus ?? "pending") === filter);
  const pendingCount = rows.filter((row) => (row.reviewStatus ?? "pending") === "pending").length;

  const updateDraft = (rowId: string, key: string, patch: Partial<DraftLesson>) => {
    setDrafts((current) => ({
      ...current,
      [rowId]: (current[rowId] ?? []).map((lesson) => (lesson.key === key ? { ...lesson, ...patch } : lesson)),
    }));
  };
  const addDraft = (rowId: string) => {
    setDrafts((current) => ({ ...current, [rowId]: [...(current[rowId] ?? []), { key: makeKey(), lesson: "", tags: [] }] }));
  };
  const removeDraft = (rowId: string, key: string) => {
    setDrafts((current) => ({ ...current, [rowId]: (current[rowId] ?? []).filter((lesson) => lesson.key !== key) }));
  };

  const decide = async (row: EstimateCalibrationFeedback, status: "approved" | "rejected" | "pending") => {
    const lessons = (drafts[row.id] ?? [])
      .map(({ key: _key, ...lesson }) => ({ ...lesson, lesson: lesson.lesson.trim(), tags: (lesson.tags ?? []).map((tag) => tag.trim()).filter(Boolean) }))
      .filter((lesson) => lesson.lesson.length > 0);
    if (status === "approved" && lessons.length === 0) {
      onError?.("Write at least one lesson before approving.");
      return;
    }
    setBusyId(row.id);
    try {
      const { feedback } = await submit(projectId, row.id, {
        status,
        approvedLessons: status === "approved" ? lessons : undefined,
        reviewNotes: notes[row.id] ?? "",
      });
      setRows((current) => current.map((entry) => (entry.id === feedback.id ? feedback : entry)));
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "Could not save review");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="calibration-review-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-fg/60">
          Corrections captured from human edits and reviews. Approve a lesson to make it reusable by future estimates; nothing unreviewed is ever shown to the agent.
        </div>
        <div className="flex items-center gap-1">
          {(["pending", "approved", "rejected", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn("rounded-md px-2 py-1 text-[11px] font-medium", filter === value ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}
            >
              {value}
              {value === "pending" && pendingCount > 0 ? <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[9px] text-amber-600">{pendingCount}</span> : null}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh"><RotateCcw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-fg/50"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading calibration feedback…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-[12px] text-fg/50">
          {filter === "pending" ? "Nothing waiting for review." : `No ${filter} feedback.`}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {visible.map((row) => {
            const status = row.reviewStatus ?? "pending";
            const rowDrafts = drafts[row.id] ?? [];
            const busy = busyId === row.id;
            const editable = status !== "approved";
            return (
              <div key={row.id} className="rounded-lg border border-border/60 bg-panel p-3" data-testid={`calibration-row-${row.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge className={statusTone(status)}>{status}</Badge>
                    <span className="text-[12px] font-medium text-fg">{row.sourceLabel || row.feedbackType}</span>
                    <span className="text-[11px] text-fg/40">{new Date(row.createdAt).toLocaleString()}</span>
                  </div>
                  {row.reviewedBy ? <span className="text-[11px] text-fg/40">reviewed by {row.reviewedBy}</span> : null}
                </div>

                {row.corrections.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {row.corrections.slice(0, 8).map((correction, index) => (
                      <li key={index} className="rounded bg-panel2/60 px-2 py-1 font-mono text-[11px] text-fg/70">{describeCorrection(correction)}</li>
                    ))}
                    {row.corrections.length > 8 ? <li className="text-[11px] text-fg/40">+{row.corrections.length - 8} more corrections</li> : null}
                  </ul>
                ) : (
                  <div className="mt-2 text-[11px] text-fg/40">No field-level corrections recorded; delta summary only.</div>
                )}

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-fg/50">{editable ? "Lessons to approve" : "Approved lessons"}</span>
                    {editable ? <Button variant="ghost" size="sm" onClick={() => addDraft(row.id)}><Plus className="mr-1 h-3.5 w-3.5" /> Add lesson</Button> : null}
                  </div>
                  {rowDrafts.length === 0 ? <div className="text-[11px] text-fg/40">No lessons yet.</div> : null}
                  {rowDrafts.map((lesson) => (
                    <div key={lesson.key} className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <Textarea
                          value={lesson.lesson}
                          readOnly={!editable}
                          onChange={(event) => updateDraft(row.id, lesson.key, { lesson: event.target.value })}
                          placeholder="Imperative, reusable: e.g. Read anchors-per-plate from the base plate note; count plates from the plan view."
                          rows={2}
                          aria-label="Lesson"
                        />
                        <Input
                          value={(lesson.tags ?? []).join(", ")}
                          readOnly={!editable}
                          onChange={(event) => updateDraft(row.id, lesson.key, { tags: event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) })}
                          placeholder="tags, comma separated (structural, anchors)"
                          aria-label="Lesson tags"
                        />
                      </div>
                      {editable ? <Button variant="ghost" size="sm" onClick={() => removeDraft(row.id, lesson.key)} aria-label="Remove lesson"><Trash2 className="h-3.5 w-3.5" /></Button> : null}
                    </div>
                  ))}
                </div>

                {editable ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Input
                      value={notes[row.id] ?? row.reviewNotes ?? ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                      placeholder="Review note (optional)"
                      aria-label="Review note"
                      className="min-w-[220px] flex-1"
                    />
                    <Button size="sm" disabled={busy} onClick={() => void decide(row, "approved")} data-testid={`approve-${row.id}`}>
                      {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />} Approve lessons
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(row, "rejected")} data-testid={`reject-${row.id}`}>
                      <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(row, "pending")}>Reopen</Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

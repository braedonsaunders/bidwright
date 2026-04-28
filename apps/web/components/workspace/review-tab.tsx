"use client";

import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  PencilLine,
  Play,
  ShieldAlert,
  Square,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge, Button, Input, Select, Textarea } from "@/components/ui";
import {
  connectReviewStream,
  dismissRecommendation,
  getLatestReview,
  resolveRecommendation,
  startReview,
  stopReview,
  updateManualReview,
  type ProjectWorkspaceData,
  type QuoteReview,
  type ReviewCompetitiveness,
  type ReviewCoverageItem,
  type ReviewFinding,
  type ReviewItemState,
  type ReviewRecommendation,
  type ReviewSummary,
  type WorkspaceResponse,
} from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type ReviewSubTab = "coverage" | "gaps" | "competitiveness" | "productivity" | "recommendations";

interface ReviewTabProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
}

function makeLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function severityTone(severity: string) {
  switch (severity) {
    case "CRITICAL":
      return "danger";
    case "WARNING":
      return "warning";
    case "INFO":
      return "info";
    default:
      return "default";
  }
}

function priorityTone(priority: string) {
  switch (priority) {
    case "HIGH":
      return "danger";
    case "MEDIUM":
      return "warning";
    case "LOW":
      return "info";
    default:
      return "default";
  }
}

function coverageTone(status: string) {
  switch (status) {
    case "YES":
      return "success";
    case "VERIFY":
      return "warning";
    case "NO":
      return "danger";
    default:
      return "default";
  }
}

function reviewStateTone(review: QuoteReview | null) {
  if (!review) return "default";
  if (review.isOutdated) return "warning";
  return review.reviewState === "resolved" ? "success" : "default";
}

function itemStateTone(state?: ReviewItemState) {
  switch (state) {
    case "resolved":
      return "success";
    case "dismissed":
      return "default";
    case "open":
      return "warning";
    default:
      return "default";
  }
}

function formatOptionalInteger(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return value.toLocaleString();
}

function parseNumber(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateAtIndex<T>(items: T[], index: number, patch: Partial<T>) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
}

function removeAtIndex<T>(items: T[], index: number) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function CommitInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  function commit(nextValue: string) {
    setEditing(false);
    setDraft(nextValue);
    if (nextValue !== value) onCommit(nextValue);
  }

  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(draft);
          event.currentTarget.blur();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setEditing(false);
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function CommitTextarea({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  function commit(nextValue: string) {
    setEditing(false);
    setDraft(nextValue);
    if (nextValue !== value) onCommit(nextValue);
  }

  return (
    <Textarea
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          commit(draft);
          event.currentTarget.blur();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setEditing(false);
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function SectionToolbar({
  title,
  description,
  editable,
  busy,
  addLabel,
  onAdd,
}: {
  title: string;
  description?: string;
  editable: boolean;
  busy?: boolean;
  addLabel?: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/45">{title}</div>
        {description ? <p className="mt-1 text-[11px] text-fg/45">{description}</p> : null}
      </div>
      {editable && onAdd && addLabel ? (
        <Button type="button" size="sm" variant="secondary" onClick={onAdd} disabled={busy}>
          <Zap className="h-3 w-3" />
          {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

function SummaryCard({
  review,
  editable,
  busy,
  onPatchSummary,
}: {
  review: QuoteReview | null;
  editable: boolean;
  busy: boolean;
  onPatchSummary: (patch: Partial<ReviewSummary>) => void;
}) {
  if (!review) return null;
  const summary = review.summary;
  if (!summary || !summary.quoteTotal) return null;

  return (
    <div className="rounded-lg border border-line bg-panel2/20 px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] text-fg/35 uppercase tracking-wider">Quote Total</div>
            <div className="text-lg font-bold tabular-nums">{formatMoney(summary.quoteTotal)}</div>
          </div>
          <div className="h-8 border-l border-line" />
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-fg/50">{summary.worksheetCount} worksheets</span>
            <span className="text-fg/50">{summary.itemCount} items</span>
            {summary.totalHours ? <span className="text-fg/50">{summary.totalHours.toLocaleString()} hrs</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Badge tone={review.status === "completed" ? "success" : review.status === "running" ? "warning" : "danger"}>
            {review.status === "running" ? "AI Running" : review.status === "completed" ? "AI Complete" : "AI Failed"}
          </Badge>
          <Badge tone={reviewStateTone(review)}>
            {review.isOutdated ? "Outdated" : review.reviewState === "resolved" ? "Resolved" : "Open"}
          </Badge>
          <span className="text-fg/40">
            Coverage: <span className="font-medium text-fg/70">{summary.coverageScore || "—"}</span>
          </span>
          {summary.riskCount.critical > 0 ? <Badge tone="danger">{summary.riskCount.critical} Critical</Badge> : null}
          {summary.riskCount.warning > 0 ? <Badge tone="warning">{summary.riskCount.warning} Warnings</Badge> : null}
          {summary.potentialSavings ? <span className="text-success font-medium">Savings: {summary.potentialSavings}</span> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-t border-line/30 pt-3 text-[11px] text-fg/45">
        <span>Reviewed against quote: {review.reviewedQuoteUpdatedAt ? new Date(review.reviewedQuoteUpdatedAt).toLocaleString() : "—"}</span>
        <span>Current quote state: {review.quoteUpdatedAt ? new Date(review.quoteUpdatedAt).toLocaleString() : "—"}</span>
        {review.outdatedReason ? <span className="text-warning">{review.outdatedReason}</span> : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[180px_180px_minmax(0,1fr)]">
        {editable ? (
          <>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-fg/40">Coverage Score</div>
              <CommitInput
                value={summary.coverageScore || ""}
                onCommit={(value) => onPatchSummary({ coverageScore: value })}
                disabled={busy}
                className="h-8 text-xs"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-fg/40">Potential Savings</div>
              <CommitInput
                value={summary.potentialSavings || ""}
                onCommit={(value) => onPatchSummary({ potentialSavings: value })}
                disabled={busy}
                className="h-8 text-xs"
              />
            </div>
          </>
        ) : null}
        <div className={cn("min-w-0", !editable && "lg:col-span-3")}>
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-fg/40">Overall Assessment</div>
          {editable ? (
            <CommitTextarea
              value={summary.overallAssessment || ""}
              onCommit={(value) => onPatchSummary({ overallAssessment: value })}
              disabled={busy}
              className="min-h-[84px] text-xs"
            />
          ) : (
            <p className="text-xs text-fg/55 whitespace-pre-wrap">{summary.overallAssessment || "No executive assessment yet."}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CoverageSubTab({
  items,
  editable,
  busy,
  onChange,
}: {
  items: ReviewCoverageItem[];
  editable: boolean;
  busy: boolean;
  onChange: (items: ReviewCoverageItem[]) => void;
}) {
  const yesCount = items.filter((item) => item.status === "YES").length;
  const verifyCount = items.filter((item) => item.status === "VERIFY").length;
  const noCount = items.filter((item) => item.status === "NO").length;
  const total = items.length;
  const pct = total > 0 ? Math.round((yesCount / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-lg border border-line bg-panel2/30 px-4 py-3">
        <div className="text-2xl font-bold tabular-nums">{pct}%</div>
        <div className="flex-1">
          <div className="mb-1 text-xs text-fg/50">Scope Coverage</div>
          <div className="flex h-2 overflow-hidden rounded-full bg-bg">
            {total > 0 ? (
              <>
                <div className="h-full bg-success" style={{ width: `${(yesCount / total) * 100}%` }} />
                <div className="h-full bg-warning" style={{ width: `${(verifyCount / total) * 100}%` }} />
                <div className="h-full bg-danger" style={{ width: `${(noCount / total) * 100}%` }} />
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> {yesCount} Covered</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> {verifyCount} Verify</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" /> {noCount} Missing</span>
        </div>
      </div>

      <SectionToolbar
        title="Coverage Checklist"
        description="Override coverage calls and annotate the exact spec or scope note that matters."
        editable={editable}
        busy={busy}
        addLabel="Add Coverage Item"
        onAdd={() =>
          onChange([
            ...items,
            { id: makeLocalId("coverage"), specRef: "", requirement: "", status: "VERIFY", worksheetName: "", notes: "" },
          ])
        }
      />

      {items.length === 0 ? (
        <div className="text-center py-12 text-fg/30 text-sm">No coverage data yet</div>
      ) : (
        <div className="rounded-lg border border-line overflow-x-auto">
          <table className="w-full min-w-[880px] text-xs">
            <thead>
              <tr className="bg-panel2/50 border-b border-line">
                <th className="px-3 py-2 text-left font-medium text-fg/50 w-24">Ref</th>
                <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[260px]">Requirement</th>
                <th className="px-3 py-2 text-left font-medium text-fg/50 w-28">Status</th>
                <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[280px]">Notes</th>
                {editable ? <th className="px-3 py-2 w-12" /> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id || index} className={cn("border-b border-line/50 last:border-0 align-top", item.status === "NO" && "bg-danger/[0.03]")}>
                  <td className="px-3 py-2">
                    {editable ? (
                      <CommitInput
                        value={item.specRef || ""}
                        onCommit={(value) => onChange(updateAtIndex(items, index, { specRef: value }))}
                        disabled={busy}
                        className="h-8 text-xs"
                      />
                    ) : (
                      <span className="font-mono text-fg/60">{item.specRef || "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <CommitTextarea
                        value={item.requirement || ""}
                        onCommit={(value) => onChange(updateAtIndex(items, index, { requirement: value }))}
                        disabled={busy}
                        className="min-h-[64px] text-xs"
                      />
                    ) : (
                      <span className="text-fg/80 whitespace-pre-wrap">{item.requirement}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <Select
                        value={item.status}
                        onValueChange={(v) => onChange(updateAtIndex(items, index, { status: v as ReviewCoverageItem["status"] }))}
                        disabled={busy}
                        size="sm"
                        options={[
                          { value: "YES", label: "Covered" },
                          { value: "VERIFY", label: "Verify" },
                          { value: "NO", label: "Missing" },
                        ]}
                      />
                    ) : (
                      <Badge tone={coverageTone(item.status)} className="text-[10px]">{item.status}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <CommitTextarea
                        value={item.notes || item.worksheetName || ""}
                        onCommit={(value) => onChange(updateAtIndex(items, index, { notes: value }))}
                        disabled={busy}
                        className="min-h-[64px] text-xs"
                      />
                    ) : (
                      <span className="text-fg/50 whitespace-pre-wrap">{item.notes || item.worksheetName || "—"}</span>
                    )}
                  </td>
                  {editable ? (
                    <td className="px-3 py-2 text-right">
                      <Button type="button" size="xs" variant="ghost" onClick={() => onChange(removeAtIndex(items, index))} disabled={busy}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GapsRisksSubTab({
  findings,
  editable,
  busy,
  onChange,
}: {
  findings: ReviewFinding[];
  editable: boolean;
  busy: boolean;
  onChange: (items: ReviewFinding[]) => void;
}) {
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "WARNING" | "INFO">("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = filter === "ALL" ? findings : findings.filter((finding) => finding.severity === filter);
  const critCount = findings.filter((finding) => finding.severity === "CRITICAL").length;
  const warnCount = findings.filter((finding) => finding.severity === "WARNING").length;
  const infoCount = findings.filter((finding) => finding.severity === "INFO").length;

  return (
    <div className="space-y-3">
      <SectionToolbar
        title="Gaps & Risks"
        description="Adjust severity, close findings as they are addressed, and keep a clean reviewer note trail."
        editable={editable}
        busy={busy}
        addLabel="Add Finding"
        onAdd={() =>
          onChange([
            ...findings,
            {
              id: makeLocalId("finding"),
              severity: "WARNING",
              title: "",
              description: "",
              estimatedImpact: "",
              specRef: "",
              status: "open",
              resolutionNote: "",
            },
          ])
        }
      />

      <div className="flex items-center gap-2">
        {(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              filter === value ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60",
            )}
          >
            {value === "ALL"
              ? `All (${findings.length})`
              : value === "CRITICAL"
                ? `Critical (${critCount})`
                : value === "WARNING"
                  ? `Warnings (${warnCount})`
                  : `Info (${infoCount})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-fg/30 text-sm">
          {findings.length === 0 ? "No findings yet" : "No findings match this filter"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((finding) => {
            const sourceIndex = findings.findIndex((entry) => entry.id === finding.id);
            const expanded = expandedId === finding.id;
            const state = finding.status || "open";

            return (
              <div
                key={finding.id}
                className={cn(
                  "overflow-hidden rounded-lg border transition-colors",
                  finding.severity === "CRITICAL"
                    ? "border-danger/30 bg-danger/[0.02]"
                    : finding.severity === "WARNING"
                      ? "border-warning/30 bg-warning/[0.02]"
                      : "border-line bg-panel2/20",
                  state !== "open" && "opacity-70",
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  onClick={() => setExpandedId(expanded ? null : finding.id)}
                >
                  {finding.severity === "CRITICAL" ? (
                    <ShieldAlert className="h-4 w-4 shrink-0 text-danger" />
                  ) : finding.severity === "WARNING" ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  ) : (
                    <Info className="h-4 w-4 shrink-0 text-accent" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={severityTone(finding.severity)} className="text-[9px]">{finding.severity}</Badge>
                      <Badge tone={itemStateTone(state)} className="text-[9px] capitalize">{state}</Badge>
                      <span className="truncate text-xs font-medium text-fg/80">{finding.title || "Untitled finding"}</span>
                    </div>
                  </div>
                  {finding.estimatedImpact ? <span className="shrink-0 text-[11px] font-mono text-fg/40">{finding.estimatedImpact}</span> : null}
                  {finding.specRef ? <span className="shrink-0 text-[10px] text-fg/30">{finding.specRef}</span> : null}
                  {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/25" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/25" />}
                </button>

                {expanded ? (
                  <div className="space-y-3 border-t border-line/30 px-4 pb-4 pt-3">
                    {editable ? (
                      <>
                        <div className="grid gap-3 md:grid-cols-[140px_140px_160px_1fr]">
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Severity</div>
                            <Select
                              value={finding.severity}
                              onValueChange={(v) => onChange(updateAtIndex(findings, sourceIndex, { severity: v as ReviewFinding["severity"] }))}
                              disabled={busy}
                              size="sm"
                              options={[
                                { value: "CRITICAL", label: "Critical" },
                                { value: "WARNING", label: "Warning" },
                                { value: "INFO", label: "Info" },
                              ]}
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">State</div>
                            <Select
                              value={state}
                              onValueChange={(v) => onChange(updateAtIndex(findings, sourceIndex, { status: v as ReviewItemState }))}
                              disabled={busy}
                              size="sm"
                              options={[
                                { value: "open", label: "Open" },
                                { value: "resolved", label: "Resolved" },
                                { value: "dismissed", label: "Dismissed" },
                              ]}
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Spec Ref</div>
                            <CommitInput
                              value={finding.specRef || ""}
                              onCommit={(value) => onChange(updateAtIndex(findings, sourceIndex, { specRef: value }))}
                              disabled={busy}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Impact</div>
                            <CommitInput
                              value={finding.estimatedImpact || ""}
                              onCommit={(value) => onChange(updateAtIndex(findings, sourceIndex, { estimatedImpact: value }))}
                              disabled={busy}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Title</div>
                          <CommitInput
                            value={finding.title}
                            onCommit={(value) => onChange(updateAtIndex(findings, sourceIndex, { title: value }))}
                            disabled={busy}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Description</div>
                          <CommitTextarea
                            value={finding.description}
                            onCommit={(value) => onChange(updateAtIndex(findings, sourceIndex, { description: value }))}
                            disabled={busy}
                            className="min-h-[92px] text-xs"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Resolution Note</div>
                          <CommitTextarea
                            value={finding.resolutionNote || ""}
                            onCommit={(value) => onChange(updateAtIndex(findings, sourceIndex, { resolutionNote: value }))}
                            disabled={busy}
                            className="min-h-[72px] text-xs"
                          />
                        </div>
                        <div className="flex justify-end">
                          <Button type="button" size="sm" variant="danger" onClick={() => onChange(removeAtIndex(findings, sourceIndex))} disabled={busy}>
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-xs text-fg/60">{finding.description}</p>
                        {finding.resolutionNote ? (
                          <div className="rounded-md border border-line/40 bg-bg/30 px-3 py-2">
                            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/35">Resolution Note</div>
                            <p className="whitespace-pre-wrap text-xs text-fg/50">{finding.resolutionNote}</p>
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompetitivenessSubTab({
  data,
  editable,
  busy,
  onChange,
}: {
  data: ReviewCompetitiveness;
  editable: boolean;
  busy: boolean;
  onChange: (next: ReviewCompetitiveness) => void;
}) {
  const overestimates = data.overestimates || [];
  const underestimates = data.underestimates || [];

  return (
    <div className="space-y-6">
      <SectionToolbar
        title="Competitiveness"
        description="Manually tune cost pressure calls without rerunning the AI review."
        editable={false}
      />

      <div className="rounded-lg border border-success/20 bg-success/[0.04] px-4 py-3">
        <div className="mb-1 text-xs font-medium text-success">Total Potential Savings</div>
        {editable ? (
          <CommitInput
            value={data.totalSavingsRange || ""}
            onCommit={(value) => onChange({ ...data, totalSavingsRange: value })}
            disabled={busy}
            className="h-9 max-w-[240px] text-sm font-semibold text-success"
          />
        ) : (
          <div className="text-lg font-bold tabular-nums text-success">{data.totalSavingsRange || "—"}</div>
        )}
      </div>

      <div className="space-y-3">
        <SectionToolbar
          title="Potential Overestimates"
          editable={editable}
          busy={busy}
          addLabel="Add Overestimate"
          onAdd={() =>
            onChange({
              ...data,
              overestimates: [
                ...overestimates,
                { id: makeLocalId("over"), impact: "MEDIUM", area: "", analysis: "", savingsRange: "", status: "open", currentValue: "", benchmarkValue: "", resolutionNote: "" },
              ],
            })
          }
        />
        {overestimates.length > 0 ? (
          <div className="rounded-lg border border-line overflow-x-auto">
            <table className="w-full min-w-[980px] text-xs">
              <thead>
                <tr className="bg-panel2/50 border-b border-line">
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-24">Impact</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-24">State</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-44">Area</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[320px]">Analysis</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-32">Savings</th>
                  {editable ? <th className="px-3 py-2 w-12" /> : null}
                </tr>
              </thead>
              <tbody>
                {overestimates.map((entry, index) => (
                  <tr key={entry.id} className={cn("border-b border-line/50 last:border-0 align-top", entry.status && entry.status !== "open" && "opacity-70")}>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Select
                          value={entry.impact}
                          onValueChange={(v) => onChange({ ...data, overestimates: updateAtIndex(overestimates, index, { impact: v as typeof entry.impact }) })}
                          disabled={busy}
                          size="sm"
                          options={[
                            { value: "HIGH", label: "High" },
                            { value: "MEDIUM", label: "Medium" },
                            { value: "LOW", label: "Low" },
                          ]}
                        />
                      ) : (
                        <Badge tone={priorityTone(entry.impact)} className="text-[9px]">{entry.impact}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Select
                          value={entry.status || "open"}
                          onValueChange={(v) => onChange({ ...data, overestimates: updateAtIndex(overestimates, index, { status: v as ReviewItemState }) })}
                          disabled={busy}
                          size="sm"
                          options={[
                            { value: "open", label: "Open" },
                            { value: "resolved", label: "Resolved" },
                            { value: "dismissed", label: "Dismissed" },
                          ]}
                        />
                      ) : (
                        <Badge tone={itemStateTone(entry.status)} className="text-[9px] capitalize">{entry.status || "open"}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <CommitInput value={entry.area} onCommit={(value) => onChange({ ...data, overestimates: updateAtIndex(overestimates, index, { area: value }) })} disabled={busy} className="h-8 text-xs" />
                      ) : (
                        <span className="font-medium text-fg/70">{entry.area}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <CommitTextarea value={entry.analysis} onCommit={(value) => onChange({ ...data, overestimates: updateAtIndex(overestimates, index, { analysis: value }) })} disabled={busy} className="min-h-[72px] text-xs" />
                      ) : (
                        <span className="whitespace-pre-wrap text-fg/55">{entry.analysis}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <CommitInput value={entry.savingsRange} onCommit={(value) => onChange({ ...data, overestimates: updateAtIndex(overestimates, index, { savingsRange: value }) })} disabled={busy} className="h-8 text-xs" />
                      ) : (
                        <span className="font-mono font-medium text-success">{entry.savingsRange}</span>
                      )}
                    </td>
                    {editable ? (
                      <td className="px-3 py-2 text-right">
                        <Button type="button" size="xs" variant="ghost" onClick={() => onChange({ ...data, overestimates: removeAtIndex(overestimates, index) })} disabled={busy}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-fg/30 text-sm">No overestimate entries yet</div>
        )}
      </div>

      <div className="space-y-3">
        <SectionToolbar
          title="Potential Underestimates"
          editable={editable}
          busy={busy}
          addLabel="Add Underestimate"
          onAdd={() =>
            onChange({
              ...data,
              underestimates: [
                ...underestimates,
                { id: makeLocalId("under"), impact: "MEDIUM", area: "", analysis: "", riskRange: "", status: "open", resolutionNote: "" },
              ],
            })
          }
        />
        {underestimates.length > 0 ? (
          <div className="rounded-lg border border-line overflow-x-auto">
            <table className="w-full min-w-[980px] text-xs">
              <thead>
                <tr className="bg-panel2/50 border-b border-line">
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-24">Impact</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-24">State</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-44">Area</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[320px]">Analysis</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-32">Risk</th>
                  {editable ? <th className="px-3 py-2 w-12" /> : null}
                </tr>
              </thead>
              <tbody>
                {underestimates.map((entry, index) => (
                  <tr key={entry.id} className={cn("border-b border-line/50 last:border-0 align-top", entry.status && entry.status !== "open" && "opacity-70")}>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Select
                          value={entry.impact}
                          onValueChange={(v) => onChange({ ...data, underestimates: updateAtIndex(underestimates, index, { impact: v as typeof entry.impact }) })}
                          disabled={busy}
                          size="sm"
                          options={[
                            { value: "HIGH", label: "High" },
                            { value: "MEDIUM", label: "Medium" },
                            { value: "LOW", label: "Low" },
                          ]}
                        />
                      ) : (
                        <Badge tone={priorityTone(entry.impact)} className="text-[9px]">{entry.impact}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Select
                          value={entry.status || "open"}
                          onValueChange={(v) => onChange({ ...data, underestimates: updateAtIndex(underestimates, index, { status: v as ReviewItemState }) })}
                          disabled={busy}
                          size="sm"
                          options={[
                            { value: "open", label: "Open" },
                            { value: "resolved", label: "Resolved" },
                            { value: "dismissed", label: "Dismissed" },
                          ]}
                        />
                      ) : (
                        <Badge tone={itemStateTone(entry.status)} className="text-[9px] capitalize">{entry.status || "open"}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <CommitInput value={entry.area} onCommit={(value) => onChange({ ...data, underestimates: updateAtIndex(underestimates, index, { area: value }) })} disabled={busy} className="h-8 text-xs" />
                      ) : (
                        <span className="font-medium text-fg/70">{entry.area}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <CommitTextarea value={entry.analysis} onCommit={(value) => onChange({ ...data, underestimates: updateAtIndex(underestimates, index, { analysis: value }) })} disabled={busy} className="min-h-[72px] text-xs" />
                      ) : (
                        <span className="whitespace-pre-wrap text-fg/55">{entry.analysis}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <CommitInput value={entry.riskRange} onCommit={(value) => onChange({ ...data, underestimates: updateAtIndex(underestimates, index, { riskRange: value }) })} disabled={busy} className="h-8 text-xs" />
                      ) : (
                        <span className="font-mono font-medium text-danger">{entry.riskRange}</span>
                      )}
                    </td>
                    {editable ? (
                      <td className="px-3 py-2 text-right">
                        <Button type="button" size="xs" variant="ghost" onClick={() => onChange({ ...data, underestimates: removeAtIndex(underestimates, index) })} disabled={busy}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-fg/30 text-sm">No underestimate entries yet</div>
        )}
      </div>
    </div>
  );
}

function ProductivitySubTab({
  data,
  editable,
  busy,
  onChange,
}: {
  data: ReviewCompetitiveness;
  editable: boolean;
  busy: boolean;
  onChange: (next: ReviewCompetitiveness) => void;
}) {
  const benchmarking = data.benchmarking || { description: "", streams: [] };
  const streams = benchmarking.streams || [];
  const streamsWithHours = streams.filter((stream) => Number.isFinite(stream.hours) && stream.hours > 0).length;
  const streamsWithRates = streams.filter((stream) => typeof stream.productionRate === "number" && Number.isFinite(stream.productionRate) && stream.productionRate > 0).length;
  const streamsWithFmTl = streams.filter((stream) => typeof stream.fmTlRatio === "number" && Number.isFinite(stream.fmTlRatio) && stream.fmTlRatio > 0).length;

  if (streams.length === 0 && !editable) {
    return <div className="text-center py-12 text-fg/30 text-sm">No productivity data yet</div>;
  }

  return (
    <div className="space-y-4">
      <SectionToolbar
        title="Productivity"
        description="Review and override benchmark assumptions used to judge field productivity."
        editable={editable}
        busy={busy}
        addLabel="Add Benchmark Stream"
        onAdd={() =>
          onChange({
            ...data,
            benchmarking: {
              description: benchmarking.description || "",
              streams: [
                ...streams,
                { id: makeLocalId("stream"), name: "", footage: undefined, hours: 0, productionRate: undefined, unit: "LF/hr", fmTlRatio: undefined, assessment: "" },
              ],
            },
          })
        }
      />

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">Streams</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">{streams.length}</div>
        </div>
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">Quantified Hours</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">{streamsWithHours}/{streams.length || 0}</div>
        </div>
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">Benchmark Rates</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">{streamsWithRates}/{streams.length || 0}</div>
        </div>
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">FM:TL Ratios</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">{streamsWithFmTl}/{streams.length || 0}</div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-panel2/20 px-4 py-3">
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-fg/40">Benchmark Notes</div>
        {editable ? (
          <CommitTextarea
            value={benchmarking.description || ""}
            onCommit={(value) => onChange({ ...data, benchmarking: { description: value, streams } })}
            disabled={busy}
            className="min-h-[84px] text-xs"
          />
        ) : (
          <p className="text-xs text-fg/55 whitespace-pre-wrap">{benchmarking.description || "No benchmark note yet."}</p>
        )}
      </div>

      <div className="rounded-lg border border-line overflow-x-auto">
        <table className="w-full min-w-[1100px] text-xs">
          <thead>
            <tr className="bg-panel2/50 border-b border-line">
              <th className="px-3 py-2 text-left font-medium text-fg/50 w-56">Stream</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-28">Footage</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-24">Hours</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-28">Prod. Rate</th>
              <th className="px-3 py-2 text-left font-medium text-fg/50 w-24">Unit</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-24">FM:TL</th>
              <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[280px]">Assessment</th>
              {editable ? <th className="px-3 py-2 w-12" /> : null}
            </tr>
          </thead>
          <tbody>
            {streams.map((stream, index) => (
              <tr key={stream.id || index} className="border-b border-line/50 last:border-0 align-top">
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitInput value={stream.name} onCommit={(value) => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: updateAtIndex(streams, index, { name: value }) } })} disabled={busy} className="h-8 text-xs" />
                  ) : (
                    <span className="font-medium text-fg/70">{stream.name}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitInput value={stream.footage == null ? "" : String(stream.footage)} onCommit={(value) => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: updateAtIndex(streams, index, { footage: value === "" ? undefined : parseNumber(value) }) } })} disabled={busy} className="h-8 text-right text-xs" />
                  ) : (
                    <span className="font-mono text-fg/60">{formatOptionalInteger(stream.footage)}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitInput value={String(stream.hours ?? 0)} onCommit={(value) => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: updateAtIndex(streams, index, { hours: parseNumber(value) }) } })} disabled={busy} className="h-8 text-right text-xs" />
                  ) : (
                    <span className="font-mono text-fg/60">{formatOptionalInteger(stream.hours)}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitInput value={stream.productionRate == null ? "" : String(stream.productionRate)} onCommit={(value) => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: updateAtIndex(streams, index, { productionRate: value === "" ? undefined : parseNumber(value) }) } })} disabled={busy} className="h-8 text-right text-xs" />
                  ) : (
                    <span className="font-mono text-fg/60">{typeof stream.productionRate === "number" ? stream.productionRate.toFixed(1) : "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitInput value={stream.unit || ""} onCommit={(value) => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: updateAtIndex(streams, index, { unit: value }) } })} disabled={busy} className="h-8 text-xs" />
                  ) : (
                    <span className="text-fg/60">{stream.unit || "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitInput value={stream.fmTlRatio == null ? "" : String(stream.fmTlRatio)} onCommit={(value) => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: updateAtIndex(streams, index, { fmTlRatio: value === "" ? undefined : parseNumber(value) }) } })} disabled={busy} className="h-8 text-right text-xs" />
                  ) : (
                    <span className="font-mono text-fg/60">{typeof stream.fmTlRatio === "number" ? stream.fmTlRatio.toFixed(2) : "—"}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitTextarea value={stream.assessment} onCommit={(value) => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: updateAtIndex(streams, index, { assessment: value }) } })} disabled={busy} className="min-h-[72px] text-xs" />
                  ) : (
                    <span className="whitespace-pre-wrap text-fg/55">{stream.assessment}</span>
                  )}
                </td>
                {editable ? (
                  <td className="px-3 py-2 text-right">
                    <Button type="button" size="xs" variant="ghost" onClick={() => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: removeAtIndex(streams, index) } })} disabled={busy}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecommendationsSubTab({
  recommendations,
  editable,
  busy,
  projectId,
  onApply,
  onError,
  onRefreshReview,
  onChange,
}: {
  recommendations: ReviewRecommendation[];
  editable: boolean;
  busy: boolean;
  projectId: string;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
  onRefreshReview: () => Promise<void>;
  onChange: (next: ReviewRecommendation[]) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openItems = recommendations.filter((item) => item.status === "open");
  const closedItems = recommendations.filter((item) => item.status !== "open");

  function handleResolve(recId: string) {
    setResolvingId(recId);
    startTransition(async () => {
      try {
        const result = await resolveRecommendation(projectId, recId);
        onApply(result);
        await onRefreshReview();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Failed to resolve recommendation");
      } finally {
        setResolvingId(null);
      }
    });
  }

  function handleDismiss(recId: string) {
    startTransition(async () => {
      try {
        await dismissRecommendation(projectId, recId);
        await onRefreshReview();
      } catch (error) {
        onError(error instanceof Error ? error.message : "Failed to dismiss recommendation");
      }
    });
  }

  function RecCard({ recommendation, index }: { recommendation: ReviewRecommendation; index: number }) {
    const expanded = expandedId === recommendation.id;
    const status = recommendation.status || "open";
    const resolving = resolvingId === recommendation.id;

    return (
      <div className={cn("overflow-hidden rounded-lg border transition-all", status === "open" ? "border-line bg-panel2/20" : "border-line/50 bg-panel2/10 opacity-70")}>
        <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setExpandedId(expanded ? null : recommendation.id)}>
          {status === "resolved" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : status === "dismissed" ? <XCircle className="h-4 w-4 shrink-0 text-fg/30" /> : <Zap className={cn("h-4 w-4 shrink-0", recommendation.priority === "HIGH" ? "text-danger" : recommendation.priority === "MEDIUM" ? "text-warning" : "text-accent")} />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge tone={priorityTone(recommendation.priority)} className="text-[9px]">{recommendation.priority}</Badge>
              <Badge tone={itemStateTone(status)} className="text-[9px] capitalize">{status}</Badge>
              {recommendation.category ? <span className="text-[10px] text-fg/30">{recommendation.category}</span> : null}
              <span className={cn("truncate text-xs font-medium", status !== "open" ? "text-fg/45 line-through" : "text-fg/80")}>{recommendation.title || "Untitled recommendation"}</span>
            </div>
          </div>
          <span className="shrink-0 text-[11px] font-mono text-fg/40">{recommendation.impact || "—"}</span>
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/25" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg/25" />}
        </button>

        {expanded ? (
          <div className="space-y-3 border-t border-line/30 px-4 pb-4 pt-3">
            {editable ? (
              <>
                <div className="grid gap-3 md:grid-cols-[140px_140px_180px_minmax(0,1fr)]">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Priority</div>
                    <Select
                      value={recommendation.priority}
                      onValueChange={(v) => onChange(updateAtIndex(recommendations, index, { priority: v as ReviewRecommendation["priority"] }))}
                      disabled={busy || isPending}
                      className="h-8 text-xs"
                      size="sm"
                      options={[
                        { value: "HIGH", label: "High" },
                        { value: "MEDIUM", label: "Medium" },
                        { value: "LOW", label: "Low" },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">State</div>
                    <Select
                      value={status}
                      onValueChange={(v) => onChange(updateAtIndex(recommendations, index, { status: v as ReviewItemState }))}
                      disabled={busy || isPending}
                      className="h-8 text-xs"
                      size="sm"
                      options={[
                        { value: "open", label: "Open" },
                        { value: "resolved", label: "Resolved" },
                        { value: "dismissed", label: "Dismissed" },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Category</div>
                    <CommitInput value={recommendation.category || ""} onCommit={(value) => onChange(updateAtIndex(recommendations, index, { category: value }))} disabled={busy || isPending} className="h-8 text-xs" />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Impact</div>
                    <CommitInput value={recommendation.impact || ""} onCommit={(value) => onChange(updateAtIndex(recommendations, index, { impact: value }))} disabled={busy || isPending} className="h-8 text-xs" />
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Title</div>
                  <CommitInput value={recommendation.title} onCommit={(value) => onChange(updateAtIndex(recommendations, index, { title: value }))} disabled={busy || isPending} className="h-8 text-xs" />
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Description</div>
                  <CommitTextarea value={recommendation.description} onCommit={(value) => onChange(updateAtIndex(recommendations, index, { description: value }))} disabled={busy || isPending} className="min-h-[96px] text-xs" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Reviewer Note</div>
                    <CommitTextarea
                      value={recommendation.reviewerNote || ""}
                      onCommit={(value) => onChange(updateAtIndex(recommendations, index, { reviewerNote: value }))}
                      disabled={busy || isPending}
                      className="min-h-[84px] text-xs"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Resolution Summary</div>
                    <CommitTextarea
                      value={recommendation.resolution?.summary || ""}
                      onCommit={(value) =>
                        onChange(
                          updateAtIndex(recommendations, index, {
                            resolution: {
                              ...(recommendation.resolution || { actions: [] }),
                              summary: value,
                            },
                          }),
                        )
                      }
                      disabled={busy || isPending}
                      className="min-h-[84px] text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {status === "open" && (recommendation.resolution?.actions || []).length > 0 ? (
                      <Button type="button" size="sm" variant="accent" onClick={() => handleResolve(recommendation.id)} disabled={busy || isPending}>
                        {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        Apply Resolution
                      </Button>
                    ) : null}
                    {status === "open" ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => handleDismiss(recommendation.id)} disabled={busy || isPending}>
                        Dismiss
                      </Button>
                    ) : null}
                  </div>
                  <Button type="button" size="sm" variant="danger" onClick={() => onChange(removeAtIndex(recommendations, index))} disabled={busy || isPending}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="whitespace-pre-wrap text-xs text-fg/60">{recommendation.description}</p>
                {recommendation.reviewerNote ? (
                  <div className="rounded-md border border-line/40 bg-bg/30 px-3 py-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/35">Reviewer Note</div>
                    <p className="whitespace-pre-wrap text-xs text-fg/50">{recommendation.reviewerNote}</p>
                  </div>
                ) : null}
                {recommendation.resolution?.summary ? (
                  <div className="rounded-md border border-line/40 bg-bg/30 px-3 py-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/35">Resolution Summary</div>
                    <p className="whitespace-pre-wrap text-xs text-fg/50">{recommendation.resolution.summary}</p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SectionToolbar
        title="Recommendations"
        description="Refine priority and wording, then either apply the proposed actions or resolve the recommendation manually."
        editable={editable}
        busy={busy || isPending}
        addLabel="Add Recommendation"
        onAdd={() =>
          onChange([
            ...recommendations,
            {
              id: makeLocalId("recommendation"),
              title: "",
              description: "",
              priority: "MEDIUM",
              impact: "",
              category: "",
              status: "open",
              reviewerNote: "",
              resolution: { summary: "", actions: [] },
            },
          ])
        }
      />

      {recommendations.length === 0 ? (
        <div className="text-center py-12 text-fg/30 text-sm">No recommendations yet</div>
      ) : (
        <>
          {openItems.length > 0 ? <div className="space-y-2">{openItems.map((item) => <RecCard key={item.id} recommendation={item} index={recommendations.findIndex((entry) => entry.id === item.id)} />)}</div> : null}
          {closedItems.length > 0 ? (
            <div>
              <div className="mb-2 text-[10px] uppercase tracking-wider text-fg/30">Resolved / Dismissed ({closedItems.length})</div>
              <div className="space-y-1.5">{closedItems.map((item) => <RecCard key={item.id} recommendation={item} index={recommendations.findIndex((entry) => entry.id === item.id)} />)}</div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function AgentActivityLog({ events, isRunning }: { events: any[]; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && expanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, expanded]);

  const meaningful = events.filter((event) => event.type === "tool_call" || event.type === "assistant_message" || event.type === "tool_result").slice(-30);

  return (
    <div className="overflow-hidden rounded-lg border border-accent/20 bg-accent/[0.02]">
      <button type="button" className="flex w-full items-center gap-2 border-b border-accent/10 px-3 py-2 text-left" onClick={() => setExpanded((value) => !value)}>
        {isRunning ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
        <span className="text-[11px] font-medium text-accent/70">{isRunning ? "Review agent working..." : "Review agent completed"}</span>
        <span className="ml-auto text-[10px] text-fg/25">{events.length} events</span>
        {expanded ? <ChevronDown className="h-3 w-3 text-fg/25" /> : <ChevronRight className="h-3 w-3 text-fg/25" />}
      </button>
      {expanded ? (
        <div ref={scrollRef} className="max-h-48 space-y-1 overflow-y-auto px-3 py-2">
          {meaningful.map((event, index) => {
            const data = event.data || {};
            if (event.type === "assistant_message" && data.content) {
              return (
                <div key={index} className="truncate text-[10px] text-fg/40">
                  {typeof data.content === "string" ? data.content.substring(0, 240) : "..."}
                </div>
              );
            }
            if (event.type === "tool_call") {
              return (
                <div key={index} className="flex items-center gap-1 text-[10px] text-fg/30">
                  <span className="font-mono text-accent/60">{data.tool_name || data.toolId || "tool"}</span>
                </div>
              );
            }
            return null;
          })}
          {isRunning ? (
            <div className="flex items-center gap-1.5 text-[10px] text-fg/25 animate-pulse">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Working...
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReviewTab({ workspace, onApply, onError }: ReviewTabProps) {
  const [subTab, setSubTab] = useState<ReviewSubTab>("coverage");
  const [review, setReview] = useState<QuoteReview | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [isPending, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const projectId = workspace.project.id;

  const currentRevisionUpdatedAt = workspace.currentRevision?.updatedAt;
  const currentQuoteUpdatedAt = workspace.quote?.updatedAt;

  const loadReview = useCallback(async () => {
    try {
      const { review: nextReview } = await getLatestReview(projectId);
      setReview(nextReview);
      setIsRunning(nextReview?.status === "running");
    } catch {
      setReview(null);
      setIsRunning(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadReview();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [loadReview]);

  useEffect(() => {
    if (!review || isRunning) return;
    loadReview();
  }, [currentRevisionUpdatedAt, currentQuoteUpdatedAt, isRunning, review?.id, loadReview]);

  function connectStream() {
    if (eventSourceRef.current) eventSourceRef.current.close();
    try {
      const source = connectReviewStream(projectId);
      eventSourceRef.current = source;

      source.addEventListener("tool_call", (event) => {
        try {
          setEvents((prev) => [...prev, { type: "tool_call", data: JSON.parse(event.data) }]);
        } catch {}
      });
      source.addEventListener("assistant_message", (event) => {
        try {
          setEvents((prev) => [...prev, { type: "assistant_message", data: JSON.parse(event.data) }]);
        } catch {}
      });
      source.addEventListener("tool_result", (event) => {
        try {
          setEvents((prev) => [...prev, { type: "tool_result", data: JSON.parse(event.data) }]);
        } catch {}
      });
      source.onerror = () => {
        source.close();
      };
    } catch {}
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { review: nextReview } = await getLatestReview(projectId);
        setReview(nextReview);
        if (!nextReview || nextReview.status !== "running") {
          setIsRunning(false);
          if (pollRef.current) clearInterval(pollRef.current);
          if (eventSourceRef.current) eventSourceRef.current.close();
        }
      } catch {}
    }, 5000);
  }

  useEffect(() => {
    if (!review || review.status !== "running") return;
    connectStream();
    startPolling();
  }, [review?.id, review?.status]);

  async function handleStartReview() {
    setIsStarting(true);
    try {
      await startReview(projectId);
      setIsRunning(true);
      setEvents([]);
      setEditMode(false);
      await loadReview();
      connectStream();
      startPolling();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to start review");
    } finally {
      setIsStarting(false);
    }
  }

  async function handleStopReview() {
    try {
      await stopReview(projectId);
      setIsRunning(false);
      if (pollRef.current) clearInterval(pollRef.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
      await loadReview();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to stop review");
    }
  }

  function saveReviewPatch(patch: Parameters<typeof updateManualReview>[1]) {
    startTransition(async () => {
      try {
        const { review: nextReview } = await updateManualReview(projectId, patch);
        setReview(nextReview);
      } catch (error) {
        onError(error instanceof Error ? error.message : "Failed to update review");
      }
    });
  }

  function handleApply(next: WorkspaceResponse) {
    onApply(next);
    loadReview();
  }

  const summary = review?.summary ?? null;
  const coverage = review?.coverage ?? [];
  const findings = review?.findings ?? [];
  const competitiveness = review?.competitiveness ?? {};
  const recommendations = review?.recommendations ?? [];
  const productivityBenchmarks = competitiveness.benchmarking?.streams || [];

  const subTabs = useMemo<Array<{ id: ReviewSubTab; label: string; count?: number }>>(
    () => [
      { id: "coverage", label: "Coverage", count: coverage.length },
      { id: "gaps", label: "Gaps & Risks", count: findings.length },
      { id: "competitiveness", label: "Competitiveness", count: (competitiveness.overestimates?.length || 0) + (competitiveness.underestimates?.length || 0) },
      { id: "productivity", label: "Productivity", count: productivityBenchmarks.length },
      { id: "recommendations", label: "Recommendations", count: recommendations.filter((item) => item.status === "open").length },
    ],
    [coverage.length, findings.length, competitiveness.overestimates?.length, competitiveness.underestimates?.length, productivityBenchmarks.length, recommendations],
  );

  const canMarkCurrent = !!review && !isRunning && !!review.currentRevisionId && review.currentRevisionId === review.revisionId;
  const reviewActionLabel = review?.isOutdated ? "Mark Current" : review?.reviewState === "resolved" ? "Reopen Review" : "Resolve Review";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {review ? (
            <>
              <Badge tone={review.status === "completed" ? "success" : review.status === "running" ? "warning" : "danger"}>
                {review.status === "running" ? "Running" : review.status === "completed" ? "Complete" : "Failed"}
              </Badge>
              <Badge tone={reviewStateTone(review)}>
                {review.isOutdated ? "Outdated" : review.reviewState === "resolved" ? "Resolved" : "Open"}
              </Badge>
              {review.createdAt ? <span className="text-[10px] text-fg/30">{new Date(review.createdAt).toLocaleString()}</span> : null}
            </>
          ) : (
            <Badge tone="default">Not Run</Badge>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {review && !isRunning ? (
            <Button size="sm" variant={editMode ? "secondary" : "ghost"} onClick={() => setEditMode((value) => !value)}>
              <PencilLine className="h-3 w-3" />
              {editMode ? "Done Editing" : "Edit Review"}
            </Button>
          ) : null}

          {review && !isRunning ? (
            <Button
              size="sm"
              variant={review.reviewState === "resolved" && !review.isOutdated ? "secondary" : "accent"}
              onClick={() => saveReviewPatch(review.reviewState === "resolved" && !review.isOutdated ? { reviewState: "open", refreshQuoteSnapshot: false } : { reviewState: "resolved", refreshQuoteSnapshot: true })}
              disabled={isPending || (review.isOutdated && !canMarkCurrent)}
              title={review.isOutdated && !canMarkCurrent ? "Re-run the review for the current revision instead." : undefined}
            >
              {review.reviewState === "resolved" && !review.isOutdated ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {reviewActionLabel}
            </Button>
          ) : null}

          {isRunning ? (
            <Button size="sm" variant="secondary" onClick={handleStopReview}>
              <Square className="h-3 w-3" />
              Stop Review
            </Button>
          ) : (
            <Button size="sm" variant="accent" onClick={handleStartReview} disabled={isStarting}>
              {isStarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {review ? "Re-run Review" : "Start Review"}
            </Button>
          )}
        </div>
      </div>

      <SummaryCard review={review} editable={editMode && !isRunning} busy={isPending} onPatchSummary={(patch) => saveReviewPatch({ summary: patch })} />

      {review?.isOutdated ? (
        <div className="rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 text-xs text-warning">
          {review.outdatedReason || "This review is no longer current for the quote."}
        </div>
      ) : null}

      {(isRunning || events.length > 0) ? <AgentActivityLog events={events} isRunning={isRunning} /> : null}

      <div className="flex items-center gap-1 shrink-0 overflow-x-auto">
        {subTabs.map((tab) => (
          <button key={tab.id} type="button" onClick={() => setSubTab(tab.id)} className={cn("flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", subTab === tab.id ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}>
            {tab.label}
            {tab.count != null && tab.count > 0 ? <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none", subTab === tab.id ? "bg-accent/20 text-accent" : "bg-fg/10 text-fg/40")}>{tab.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!review ? (
          <div className="flex h-full items-center justify-center text-sm text-fg/35">
            Run a quote review to inspect scope coverage, gaps, competitiveness, and recommendations.
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {subTab === "coverage" ? <motion.div key="coverage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}><CoverageSubTab items={coverage} editable={editMode && !isRunning} busy={isPending} onChange={(items) => saveReviewPatch({ coverage: items })} /></motion.div> : null}
            {subTab === "gaps" ? <motion.div key="gaps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}><GapsRisksSubTab findings={findings} editable={editMode && !isRunning} busy={isPending} onChange={(items) => saveReviewPatch({ findings: items })} /></motion.div> : null}
            {subTab === "competitiveness" ? <motion.div key="competitiveness" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}><CompetitivenessSubTab data={competitiveness} editable={editMode && !isRunning} busy={isPending} onChange={(next) => saveReviewPatch({ competitiveness: next })} /></motion.div> : null}
            {subTab === "productivity" ? <motion.div key="productivity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}><ProductivitySubTab data={competitiveness} editable={editMode && !isRunning} busy={isPending} onChange={(next) => saveReviewPatch({ competitiveness: next })} /></motion.div> : null}
            {subTab === "recommendations" ? <motion.div key="recommendations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}><RecommendationsSubTab recommendations={recommendations} editable={editMode && !isRunning} busy={isPending} projectId={projectId} onApply={handleApply} onError={onError} onRefreshReview={loadReview} onChange={(next) => saveReviewPatch({ recommendations: next })} /></motion.div> : null}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

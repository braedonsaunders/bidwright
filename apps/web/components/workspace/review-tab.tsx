"use client";

import type { ComponentProps, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Loader2,
  Maximize2,
  PencilLine,
  Play,
  ShieldAlert,
  Square,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Button,
  Drawer,
  Input,
  Textarea,
} from "@appkit/ui";
import {
  Badge,
  Select,
} from "@/components/legacy-controls";
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
import { listDatasets, listKnowledgeBooks } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { buildReviewLabelIndex, segmentReviewText, type ReviewLabel } from "@/lib/review-labels";
import { cn } from "@/lib/utils";
import type { QualityFinding, QualityPanelSummary } from "./quality-panel";
import type { ResourceSummaryRow } from "./resource-summary-panel";

type ReviewSubTab = "quality" | "coverage" | "gaps" | "competitiveness" | "productivity" | "recommendations";

interface ReviewTabProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
  qualitySummary?: QualityPanelSummary | null;
  qualityFindings?: QualityFinding[];
  resourceSummaryRows?: ResourceSummaryRow[];
  onQualityFindingAction?: (finding: QualityFinding) => void;
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

function formatRange(page: number, pageSize: number, total: number) {
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  return `${start}-${end} of ${total}`;
}

function usePagedItems<T>(items: T[], pageSize: number, resetKey?: string | number) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(0);
  }, [pageSize, resetKey]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

  const pageItems = useMemo(() => {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  return {
    page,
    pageItems,
    pageSize,
    setPage,
    startIndex: page * pageSize,
    total: items.length,
    totalPages,
  };
}

function PaginationBar({
  label,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
}: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-t border-line px-3 text-[11px] text-fg/45">
      <span className="tabular-nums">{formatRange(page, pageSize, total)} {label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, page - 1))}
          disabled={page <= 0}
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg/45 transition-colors hover:bg-panel2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-14 text-center tabular-nums">{page + 1} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg/45 transition-colors hover:bg-panel2 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
          aria-label="Next page"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function EmptyReviewState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center rounded-lg border border-dashed border-line bg-panel2/10 px-4 text-center text-sm text-fg/30">
      {children}
    </div>
  );
}

function TablePanel({
  children,
  footer,
  className,
}: {
  children: ReactNode;
  footer: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-panel", className)}>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer}
    </div>
  );
}

/* Master/detail split used by the Gaps, Recommendations and Quality sub-tabs.
   Below xl the two panes stack into a fixed-height container, so the grid
   itself has to scroll — otherwise the rows are squeezed to fractions of
   their content and visibly overlap. At xl each pane scrolls internally. */
const SPLIT_GRID_CLASS = "grid min-h-0 flex-1 gap-3 overflow-y-auto xl:overflow-hidden";
const SPLIT_PANE_CLASS = "flex min-h-[320px] flex-col overflow-hidden rounded-lg border border-line bg-panel xl:min-h-0";
const SPLIT_DETAIL_CLASS = "min-h-[320px] overflow-y-auto rounded-lg border border-line bg-panel2/15 p-4 xl:min-h-0";

/* The review agent cites records by their raw id ("carried on li-2830cf0b").
   Resolving those to record names at render time keeps saved reviews readable
   without rewriting stored text. */
const ReviewLabelContext = createContext<Map<string, ReviewLabel>>(new Map());

function ReviewText({ value, fallback = "" }: { value?: string | null; fallback?: string }) {
  const index = useContext(ReviewLabelContext);
  const text = value ?? "";
  const segments = useMemo(() => segmentReviewText(text, index), [text, index]);
  if (!text) return <>{fallback}</>;
  return (
    <>
      {segments.map((segment, position) => (
        segment.type === "text" ? (
          <span key={position}>{segment.value}</span>
        ) : (
          <span
            key={position}
            title={segment.label.id}
            className="rounded bg-accent/10 px-1 py-px font-medium text-accent/90"
          >
            {segment.label.label}
          </span>
        )
      ))}
    </>
  );
}

/** Labelled block inside a detail Drawer. Text wraps and is never truncated. */
function DrawerField({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">{label}</div>
      <div className={cn("whitespace-pre-wrap break-words text-xs leading-5 text-fg/75", mono && "font-mono")}>
        {children}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass =
    tone === "success"
      ? "border-success/20 bg-success/[0.04] text-success"
      : tone === "warning"
        ? "border-warning/20 bg-warning/[0.05] text-warning"
        : tone === "danger"
          ? "border-danger/20 bg-danger/[0.04] text-danger"
          : tone === "info"
            ? "border-accent/20 bg-accent/[0.04] text-accent"
            : "border-line bg-panel2/25 text-fg";

  return (
    <div className={cn("rounded-lg border px-3 py-2", toneClass)}>
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] opacity-65">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
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
    <div className="shrink-0 rounded-lg border border-line bg-panel2/20 px-3 py-2">
      <div className="grid gap-3 xl:grid-cols-[minmax(520px,0.9fr)_minmax(0,1.1fr)]">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <MetricTile label="Quote Total" value={formatMoney(summary.quoteTotal)} />
          <MetricTile label="Worksheets" value={summary.worksheetCount} />
          <MetricTile label="Items" value={summary.itemCount} />
          <MetricTile label="Hours" value={summary.totalHours ? summary.totalHours.toLocaleString() : "—"} />
          <MetricTile label="Coverage" value={summary.coverageScore || "—"} tone={summary.riskCount.critical > 0 ? "danger" : summary.riskCount.warning > 0 ? "warning" : "success"} />
        </div>

        <div className="min-w-0 rounded-lg border border-line/50 bg-bg/25 px-3 py-2">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={review.status === "completed" ? "success" : review.status === "running" ? "warning" : "danger"}>
              {review.status === "running" ? "AI Running" : review.status === "completed" ? "AI Complete" : "AI Failed"}
            </Badge>
            <Badge tone={reviewStateTone(review)}>
              {review.isOutdated ? "Outdated" : review.reviewState === "resolved" ? "Resolved" : "Open"}
            </Badge>
            {summary.riskCount.critical > 0 ? <Badge tone="danger">{summary.riskCount.critical} Critical</Badge> : null}
            {summary.riskCount.warning > 0 ? <Badge tone="warning">{summary.riskCount.warning} Warnings</Badge> : null}
            {summary.potentialSavings ? <span className="text-[11px] font-medium text-success">Savings: {summary.potentialSavings}</span> : null}
          </div>
          {editable ? null : (
            <p className="line-clamp-2 text-xs leading-5 text-fg/55">
              <ReviewText value={summary.overallAssessment} fallback="No executive assessment yet." />
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-fg/35">
            <span>Reviewed {review.reviewedQuoteUpdatedAt ? new Date(review.reviewedQuoteUpdatedAt).toLocaleString() : "—"}</span>
            <span>Quote {review.quoteUpdatedAt ? new Date(review.quoteUpdatedAt).toLocaleString() : "—"}</span>
          </div>
        </div>
      </div>

      {editable ? (
        <div className="mt-2 grid gap-2 lg:grid-cols-[160px_160px_minmax(0,1fr)]">
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
          <div className="min-w-0">
            <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-fg/40">Overall Assessment</div>
            <CommitTextarea
              value={summary.overallAssessment || ""}
              onCommit={(value) => onPatchSummary({ overallAssessment: value })}
              disabled={busy}
              className="min-h-[60px] text-xs"
            />
          </div>
        </div>
      ) : null}
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
  const paged = usePagedItems(items, 7);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex items-center gap-4 rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-2xl font-bold tabular-nums">{pct}%</div>
          <div className="min-w-0 flex-1">
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
          onAdd={() => {
            paged.setPage(Math.floor(items.length / paged.pageSize));
            onChange([
              ...items,
              { id: makeLocalId("coverage"), specRef: "", requirement: "", status: "VERIFY", worksheetName: "", notes: "" },
            ]);
          }}
        />
      </div>

      {items.length === 0 ? (
        <EmptyReviewState>No coverage data yet</EmptyReviewState>
      ) : (
        <TablePanel
          footer={
            <PaginationBar
              label="coverage items"
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              totalPages={paged.totalPages}
              onPageChange={paged.setPage}
            />
          }
        >
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
              {paged.pageItems.map((item, pageIndex) => {
                const index = paged.startIndex + pageIndex;
                return (
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
                      <span className="text-fg/80 whitespace-pre-wrap"><ReviewText value={item.requirement} /></span>
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
                      <span className="text-fg/50 whitespace-pre-wrap"><ReviewText value={item.notes || item.worksheetName} fallback="—" /></span>
                    )}
                  </td>
                  {editable ? (
                    <td className="px-3 py-2 text-right">
                      <Button type="button" size="sm" variant="ghost" onClick={() => onChange(removeAtIndex(items, index))} disabled={busy}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  ) : null}
                </tr>
                );
              })}
            </tbody>
          </table>
        </TablePanel>
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
  const filtered = filter === "ALL" ? findings : findings.filter((finding) => finding.severity === filter);
  const critCount = findings.filter((finding) => finding.severity === "CRITICAL").length;
  const warnCount = findings.filter((finding) => finding.severity === "WARNING").length;
  const infoCount = findings.filter((finding) => finding.severity === "INFO").length;
  const paged = usePagedItems(filtered, 6, filter);
  const [selectedId, setSelectedId] = useState<string | null>(filtered[0]?.id ?? null);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((finding) => finding.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  const selectedFinding = filtered.find((finding) => finding.id === selectedId) ?? null;
  const selectedIndex = selectedFinding ? findings.findIndex((entry) => entry.id === selectedFinding.id) : -1;

  function addFinding() {
    const nextFinding: ReviewFinding = {
      id: makeLocalId("finding"),
      severity: "WARNING",
      title: "",
      description: "",
      estimatedImpact: "",
      specRef: "",
      status: "open",
      resolutionNote: "",
    };
    setSelectedId(nextFinding.id);
    paged.setPage(Math.floor(filtered.length / paged.pageSize));
    onChange([...findings, nextFinding]);
  }

  function patchSelected(patch: Partial<ReviewFinding>) {
    if (selectedIndex < 0) return;
    onChange(updateAtIndex(findings, selectedIndex, patch));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-wrap items-center gap-2">
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

        <SectionToolbar
          title="Gaps & Risks"
          description="Adjust severity, state, and reviewer notes."
          editable={editable}
          busy={busy}
          addLabel="Add Finding"
          onAdd={addFinding}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyReviewState>{findings.length === 0 ? "No findings yet" : "No findings match this filter"}</EmptyReviewState>
      ) : (
        <div className={SPLIT_GRID_CLASS + " xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]"}>
          <div className={SPLIT_PANE_CLASS}>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {paged.pageItems.map((finding) => {
                const selected = selectedFinding?.id === finding.id;
                const state = finding.status || "open";
                return (
                  <button
                    key={finding.id}
                    type="button"
                    onClick={() => setSelectedId(finding.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                      selected ? "border-accent/40 bg-accent/[0.06]" : "border-transparent bg-panel2/20 hover:bg-panel2/45",
                      state !== "open" && "opacity-70",
                    )}
                  >
                    {finding.severity === "CRITICAL" ? (
                      <ShieldAlert className="h-4 w-4 shrink-0 text-danger" />
                    ) : finding.severity === "WARNING" ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                    ) : (
                      <Info className="h-4 w-4 shrink-0 text-accent" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge tone={severityTone(finding.severity)} className="text-[9px]">{finding.severity}</Badge>
                        <Badge tone={itemStateTone(state)} className="text-[9px] capitalize">{state}</Badge>
                        <span className="truncate text-xs font-medium text-fg/80"><ReviewText value={finding.title} fallback="Untitled finding" /></span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-[11px] text-fg/40"><ReviewText value={finding.description || finding.specRef} fallback="No description" /></p>
                    </div>
                    {finding.estimatedImpact ? <span className="shrink-0 text-[10px] font-mono text-fg/35">{finding.estimatedImpact}</span> : null}
                  </button>
                );
              })}
            </div>
            <PaginationBar
              label="findings"
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              totalPages={paged.totalPages}
              onPageChange={paged.setPage}
            />
          </div>

          <div className={SPLIT_DETAIL_CLASS}>
            {!selectedFinding ? (
              <EmptyReviewState>Select a finding to inspect it.</EmptyReviewState>
            ) : editable ? (
              <div className="grid min-h-0 content-start gap-3">
                <div className="grid gap-3 md:grid-cols-[140px_140px_160px_1fr]">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Severity</div>
                    <Select
                      value={selectedFinding.severity}
                      onValueChange={(v) => patchSelected({ severity: v as ReviewFinding["severity"] })}
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
                      value={selectedFinding.status || "open"}
                      onValueChange={(v) => patchSelected({ status: v as ReviewItemState })}
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
                    <CommitInput value={selectedFinding.specRef || ""} onCommit={(value) => patchSelected({ specRef: value })} disabled={busy} className="h-8 text-xs" />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Impact</div>
                    <CommitInput value={selectedFinding.estimatedImpact || ""} onCommit={(value) => patchSelected({ estimatedImpact: value })} disabled={busy} className="h-8 text-xs" />
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Title</div>
                  <CommitInput value={selectedFinding.title} onCommit={(value) => patchSelected({ title: value })} disabled={busy} className="h-8 text-xs" />
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Description</div>
                  <CommitTextarea value={selectedFinding.description} onCommit={(value) => patchSelected({ description: value })} disabled={busy} className="min-h-[92px] text-xs" />
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Resolution Note</div>
                  <CommitTextarea value={selectedFinding.resolutionNote || ""} onCommit={(value) => patchSelected({ resolutionNote: value })} disabled={busy} className="min-h-[72px] text-xs" />
                </div>
                <div className="flex justify-end">
                  <Button type="button" size="sm" variant="destructive" onClick={() => onChange(removeAtIndex(findings, selectedIndex))} disabled={busy || selectedIndex < 0}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid content-start gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={severityTone(selectedFinding.severity)}>{selectedFinding.severity}</Badge>
                  <Badge tone={itemStateTone(selectedFinding.status || "open")} className="capitalize">{selectedFinding.status || "open"}</Badge>
                  {selectedFinding.specRef ? <span className="text-[11px] text-fg/35"><ReviewText value={selectedFinding.specRef} /></span> : null}
                  {selectedFinding.estimatedImpact ? <span className="ml-auto font-mono text-xs text-fg/45">{selectedFinding.estimatedImpact}</span> : null}
                </div>
                <div>
                  <div className="text-sm font-semibold text-fg"><ReviewText value={selectedFinding.title} fallback="Untitled finding" /></div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-fg/60"><ReviewText value={selectedFinding.description} fallback="No description." /></p>
                </div>
                {selectedFinding.resolutionNote ? (
                  <div className="rounded-md border border-line/40 bg-bg/30 px-3 py-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/35">Resolution Note</div>
                    <p className="whitespace-pre-wrap break-words text-xs text-fg/50"><ReviewText value={selectedFinding.resolutionNote} /></p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type CompetitivenessKind = "over" | "under";

type CompetitivenessEntry = {
  id: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  area: string;
  analysis: string;
  status?: ReviewItemState;
  resolutionNote?: string;
  currentValue?: string;
  benchmarkValue?: string;
  savingsRange?: string;
  riskRange?: string;
};

function CompetitivenessTable({
  kind,
  editable,
  busy,
  paged,
  onPatch,
  onRemove,
  onOpenDetail,
}: {
  kind: CompetitivenessKind;
  editable: boolean;
  busy: boolean;
  paged: ReturnType<typeof usePagedItems<CompetitivenessEntry>>;
  onPatch: (index: number, patch: Partial<CompetitivenessEntry>) => void;
  onRemove: (index: number) => void;
  onOpenDetail: (entry: CompetitivenessEntry) => void;
}) {
  const isOver = kind === "over";
  const valueKey = isOver ? "savingsRange" : "riskRange";

  return (
    <TablePanel
      footer={
        <PaginationBar
          label={isOver ? "overestimates" : "underestimates"}
          page={paged.page}
          pageSize={paged.pageSize}
          total={paged.total}
          totalPages={paged.totalPages}
          onPageChange={paged.setPage}
        />
      }
    >
      <table className="w-full min-w-[560px] text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-line bg-panel2/90">
            <th className="w-20 px-3 py-2 text-left font-medium text-fg/50">Impact</th>
            <th className="w-24 px-3 py-2 text-left font-medium text-fg/50">State</th>
            <th className="w-36 px-3 py-2 text-left font-medium text-fg/50">Area</th>
            <th className="min-w-[200px] px-3 py-2 text-left font-medium text-fg/50">Analysis</th>
            <th className="w-28 px-3 py-2 text-left font-medium text-fg/50">{isOver ? "Savings" : "Risk"}</th>
            <th className="w-9 px-2 py-2" />
            {editable ? <th className="w-12 px-3 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {paged.pageItems.map((entry, pageIndex) => {
            const index = paged.startIndex + pageIndex;
            return (
              <tr
                key={entry.id}
                // The analysis column is necessarily truncated to keep the two
                // tables side by side; the row opens the full record instead of
                // letting long prose either overflow or stay unreadable.
                onClick={editable ? undefined : () => onOpenDetail(entry)}
                className={cn(
                  "border-b border-line/50 align-top last:border-0",
                  entry.status && entry.status !== "open" && "opacity-70",
                  !editable && "cursor-pointer transition-colors hover:bg-panel2/35",
                )}
              >
                <td className="px-3 py-2">
                  {editable ? (
                    <Select
                      value={entry.impact}
                      onValueChange={(v) => onPatch(index, { impact: v as CompetitivenessEntry["impact"] })}
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
                      onValueChange={(v) => onPatch(index, { status: v as ReviewItemState })}
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
                    <CommitInput value={entry.area} onCommit={(value) => onPatch(index, { area: value })} disabled={busy} className="h-8 text-xs" />
                  ) : (
                    <span className="block break-words font-medium text-fg/70"><ReviewText value={entry.area} /></span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitTextarea value={entry.analysis} onCommit={(value) => onPatch(index, { analysis: value })} disabled={busy} className="min-h-[60px] text-xs" />
                  ) : (
                    <span className="line-clamp-3 whitespace-pre-wrap break-words text-fg/55"><ReviewText value={entry.analysis} /></span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {editable ? (
                    <CommitInput
                      value={(entry[valueKey] as string) || ""}
                      onCommit={(value) => onPatch(index, { [valueKey]: value } as Partial<CompetitivenessEntry>)}
                      disabled={busy}
                      className="h-8 text-xs"
                    />
                  ) : (
                    <span className={cn("block break-words font-mono font-medium", isOver ? "text-success" : "text-danger")}>
                      {(entry[valueKey] as string) || "—"}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDetail(entry);
                    }}
                    className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
                    aria-label="Open full analysis"
                    title="Open full analysis"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </td>
                {editable ? (
                  <td className="px-3 py-2 text-right">
                    <Button type="button" size="sm" variant="ghost" onClick={() => onRemove(index)} disabled={busy}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TablePanel>
  );
}

export function CompetitivenessSubTab({
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
  const overestimates = (data.overestimates || []) as CompetitivenessEntry[];
  const underestimates = (data.underestimates || []) as CompetitivenessEntry[];
  const overPaged = usePagedItems(overestimates, 5);
  const underPaged = usePagedItems(underestimates, 5);
  const [detail, setDetail] = useState<{ kind: CompetitivenessKind; id: string } | null>(null);

  // Resolve from current props so the drawer reflects live edits (and closes
  // itself if the entry is deleted while open).
  const detailEntry = detail
    ? (detail.kind === "over" ? overestimates : underestimates).find((entry) => entry.id === detail.id) ?? null
    : null;
  const detailIsOver = detail?.kind === "over";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      {/* Single row: the savings figure is one number, so it sits inline with
          the heading instead of claiming a stacked card's worth of height. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <SectionToolbar
          title="Competitiveness"
          description="Tune over/under calls without rerunning the AI review."
          editable={false}
        />
        <div className="flex items-center gap-2 rounded-md border border-success/20 bg-success/[0.04] px-2.5 py-1">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-success/70">Potential Savings</span>
          {editable ? (
            <CommitInput
              value={data.totalSavingsRange || ""}
              onCommit={(value) => onChange({ ...data, totalSavingsRange: value })}
              disabled={busy}
              className="h-7 w-36 text-xs font-semibold text-success"
            />
          ) : (
            <span className="text-sm font-bold tabular-nums text-success">{data.totalSavingsRange || "—"}</span>
          )}
        </div>
      </div>

      <div className={SPLIT_GRID_CLASS + " xl:grid-cols-2"}>
        <div className="flex min-h-[320px] flex-col gap-2 xl:min-h-0">
          <SectionToolbar
            title="Potential Overestimates"
            editable={editable}
            busy={busy}
            addLabel="Add Overestimate"
            onAdd={() => {
              overPaged.setPage(Math.floor(overestimates.length / overPaged.pageSize));
              onChange({
                ...data,
                overestimates: [
                  ...(data.overestimates || []),
                  { id: makeLocalId("over"), impact: "MEDIUM", area: "", analysis: "", savingsRange: "", status: "open", currentValue: "", benchmarkValue: "", resolutionNote: "" },
                ],
              });
            }}
          />
          {overestimates.length > 0 ? (
            <CompetitivenessTable
              kind="over"
              editable={editable}
              busy={busy}
              paged={overPaged}
              onPatch={(index, patch) => onChange({ ...data, overestimates: updateAtIndex(data.overestimates || [], index, patch as any) })}
              onRemove={(index) => onChange({ ...data, overestimates: removeAtIndex(data.overestimates || [], index) })}
              onOpenDetail={(entry) => setDetail({ kind: "over", id: entry.id })}
            />
          ) : (
            <EmptyReviewState>No overestimate entries yet</EmptyReviewState>
          )}
        </div>

        <div className="flex min-h-[320px] flex-col gap-2 xl:min-h-0">
          <SectionToolbar
            title="Potential Underestimates"
            editable={editable}
            busy={busy}
            addLabel="Add Underestimate"
            onAdd={() => {
              underPaged.setPage(Math.floor(underestimates.length / underPaged.pageSize));
              onChange({
                ...data,
                underestimates: [
                  ...(data.underestimates || []),
                  { id: makeLocalId("under"), impact: "MEDIUM", area: "", analysis: "", riskRange: "", status: "open", resolutionNote: "" },
                ],
              });
            }}
          />
          {underestimates.length > 0 ? (
            <CompetitivenessTable
              kind="under"
              editable={editable}
              busy={busy}
              paged={underPaged}
              onPatch={(index, patch) => onChange({ ...data, underestimates: updateAtIndex(data.underestimates || [], index, patch as any) })}
              onRemove={(index) => onChange({ ...data, underestimates: removeAtIndex(data.underestimates || [], index) })}
              onOpenDetail={(entry) => setDetail({ kind: "under", id: entry.id })}
            />
          ) : (
            <EmptyReviewState>No underestimate entries yet</EmptyReviewState>
          )}
        </div>
      </div>

      <Drawer
        open={!!detailEntry}
        onClose={() => setDetail(null)}
        title={detailEntry?.area || (detailIsOver ? "Potential overestimate" : "Potential underestimate")}
        description={detailIsOver ? "Potential overestimate" : "Potential underestimate"}
        size="md"
      >
        {detailEntry ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={priorityTone(detailEntry.impact)}>{detailEntry.impact}</Badge>
              <Badge tone={itemStateTone(detailEntry.status)} className="capitalize">{detailEntry.status || "open"}</Badge>
              {(detailIsOver ? detailEntry.savingsRange : detailEntry.riskRange) ? (
                <span className={cn("font-mono text-xs font-medium", detailIsOver ? "text-success" : "text-danger")}>
                  {detailIsOver ? detailEntry.savingsRange : detailEntry.riskRange}
                </span>
              ) : null}
            </div>
            <DrawerField label="Analysis">
              <ReviewText value={detailEntry.analysis} fallback="No analysis recorded." />
            </DrawerField>
            {detailIsOver && (detailEntry.currentValue || detailEntry.benchmarkValue) ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {detailEntry.currentValue ? (
                  <DrawerField label="Current Value" mono>{detailEntry.currentValue}</DrawerField>
                ) : null}
                {detailEntry.benchmarkValue ? (
                  <DrawerField label="Benchmark Value" mono>{detailEntry.benchmarkValue}</DrawerField>
                ) : null}
              </div>
            ) : null}
            <DrawerField label={detailIsOver ? "Savings Range" : "Risk Range"} mono>
              {(detailIsOver ? detailEntry.savingsRange : detailEntry.riskRange) || "—"}
            </DrawerField>
            {detailEntry.resolutionNote ? (
              <DrawerField label="Resolution Note"><ReviewText value={detailEntry.resolutionNote} /></DrawerField>
            ) : null}
          </div>
        ) : null}
      </Drawer>
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
  const paged = usePagedItems(streams, 7);

  if (streams.length === 0 && !editable) {
    return <EmptyReviewState>No productivity data yet</EmptyReviewState>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <SectionToolbar
          title="Productivity"
          description="Review and override benchmark assumptions used to judge field productivity."
          editable={editable}
          busy={busy}
          addLabel="Add Benchmark Stream"
          onAdd={() => {
            paged.setPage(Math.floor(streams.length / paged.pageSize));
            onChange({
              ...data,
              benchmarking: {
                description: benchmarking.description || "",
                streams: [
                  ...streams,
                  { id: makeLocalId("stream"), name: "", footage: undefined, hours: 0, productionRate: undefined, unit: "LF/hr", fmTlRatio: undefined, assessment: "" },
                ],
              },
            });
          }}
        />

        <div className="grid grid-cols-4 gap-2">
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
      </div>

      <div className="shrink-0 rounded-lg border border-line bg-panel2/20 px-4 py-3">
        <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-fg/40">Benchmark Notes</div>
        {editable ? (
          <CommitTextarea
            value={benchmarking.description || ""}
            onCommit={(value) => onChange({ ...data, benchmarking: { description: value, streams } })}
            disabled={busy}
            className="min-h-[56px] text-xs"
          />
        ) : (
          <p className="line-clamp-2 text-xs text-fg/55">{benchmarking.description || "No benchmark note yet."}</p>
        )}
      </div>

      <TablePanel
        footer={
          <PaginationBar
            label="streams"
            page={paged.page}
            pageSize={paged.pageSize}
            total={paged.total}
            totalPages={paged.totalPages}
            onPageChange={paged.setPage}
          />
        }
      >
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-panel2/90 border-b border-line">
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
            {paged.pageItems.map((stream, pageIndex) => {
              const index = paged.startIndex + pageIndex;
              return (
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
                    <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...data, benchmarking: { description: benchmarking.description, streams: removeAtIndex(streams, index) } })} disabled={busy}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                ) : null}
              </tr>
              );
            })}
          </tbody>
        </table>
      </TablePanel>
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
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openItems = recommendations.filter((item) => item.status === "open");
  const closedItems = recommendations.filter((item) => item.status !== "open");
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("open");
  const visibleRecommendations =
    statusFilter === "open" ? openItems : statusFilter === "closed" ? closedItems : recommendations;
  const paged = usePagedItems(visibleRecommendations, 6, statusFilter);
  const [selectedId, setSelectedId] = useState<string | null>(visibleRecommendations[0]?.id ?? null);

  useEffect(() => {
    if (visibleRecommendations.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleRecommendations.some((recommendation) => recommendation.id === selectedId)) {
      setSelectedId(visibleRecommendations[0]?.id ?? null);
    }
  }, [selectedId, visibleRecommendations]);

  const selectedRecommendation = visibleRecommendations.find((recommendation) => recommendation.id === selectedId) ?? null;
  const selectedIndex = selectedRecommendation ? recommendations.findIndex((entry) => entry.id === selectedRecommendation.id) : -1;

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

  function addRecommendation() {
    const nextRecommendation: ReviewRecommendation = {
      id: makeLocalId("recommendation"),
      title: "",
      description: "",
      priority: "MEDIUM",
      impact: "",
      category: "",
      status: "open",
      reviewerNote: "",
      resolution: { summary: "", actions: [] },
    };
    setStatusFilter("open");
    setSelectedId(nextRecommendation.id);
    paged.setPage(Math.floor(openItems.length / paged.pageSize));
    onChange([...recommendations, nextRecommendation]);
  }

  function patchSelected(patch: Partial<ReviewRecommendation>) {
    if (selectedIndex < 0) return;
    onChange(updateAtIndex(recommendations, selectedIndex, patch));
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex flex-wrap items-center gap-2">
          {([
            ["open", `Open (${openItems.length})`],
            ["closed", `Closed (${closedItems.length})`],
            ["all", `All (${recommendations.length})`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                statusFilter === value ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <SectionToolbar
          title="Recommendations"
          description="Refine priority and wording, then apply or close items."
          editable={editable}
          busy={busy || isPending}
          addLabel="Add Recommendation"
          onAdd={addRecommendation}
        />
      </div>

      {recommendations.length === 0 ? (
        <EmptyReviewState>No recommendations yet</EmptyReviewState>
      ) : visibleRecommendations.length === 0 ? (
        <EmptyReviewState>No recommendations match this view</EmptyReviewState>
      ) : (
        <div className={SPLIT_GRID_CLASS + " xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]"}>
          <div className={SPLIT_PANE_CLASS}>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {paged.pageItems.map((recommendation) => {
                const status = recommendation.status || "open";
                const selected = selectedRecommendation?.id === recommendation.id;
                return (
                  <button
                    key={recommendation.id}
                    type="button"
                    onClick={() => setSelectedId(recommendation.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                      selected ? "border-accent/40 bg-accent/[0.06]" : "border-transparent bg-panel2/20 hover:bg-panel2/45",
                      status !== "open" && "opacity-70",
                    )}
                  >
                    {status === "resolved" ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    ) : status === "dismissed" ? (
                      <XCircle className="h-4 w-4 shrink-0 text-fg/30" />
                    ) : (
                      <Zap className={cn("h-4 w-4 shrink-0", recommendation.priority === "HIGH" ? "text-danger" : recommendation.priority === "MEDIUM" ? "text-warning" : "text-accent")} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Badge tone={priorityTone(recommendation.priority)} className="text-[9px]">{recommendation.priority}</Badge>
                        <Badge tone={itemStateTone(status)} className="text-[9px] capitalize">{status}</Badge>
                        {recommendation.category ? <span className="truncate text-[10px] text-fg/30">{recommendation.category}</span> : null}
                        <span className={cn("truncate text-xs font-medium", status !== "open" ? "text-fg/45 line-through" : "text-fg/80")}><ReviewText value={recommendation.title} fallback="Untitled recommendation" /></span>
                      </div>
                      <p className="mt-1 line-clamp-1 text-[11px] text-fg/40"><ReviewText value={recommendation.description || recommendation.impact} fallback="No description" /></p>
                    </div>
                    <span className="shrink-0 text-[10px] font-mono text-fg/35">{recommendation.impact || "—"}</span>
                  </button>
                );
              })}
            </div>
            <PaginationBar
              label="recommendations"
              page={paged.page}
              pageSize={paged.pageSize}
              total={paged.total}
              totalPages={paged.totalPages}
              onPageChange={paged.setPage}
            />
          </div>

          <div className={SPLIT_DETAIL_CLASS}>
            {!selectedRecommendation ? (
              <EmptyReviewState>Select a recommendation to inspect it.</EmptyReviewState>
            ) : editable ? (
              <div className="grid min-h-0 content-start gap-3">
                <div className="grid gap-3 md:grid-cols-[140px_140px_180px_minmax(0,1fr)]">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Priority</div>
                    <Select
                      value={selectedRecommendation.priority}
                      onValueChange={(v) => patchSelected({ priority: v as ReviewRecommendation["priority"] })}
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
                      value={selectedRecommendation.status || "open"}
                      onValueChange={(v) => patchSelected({ status: v as ReviewItemState })}
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
                    <CommitInput value={selectedRecommendation.category || ""} onCommit={(value) => patchSelected({ category: value })} disabled={busy || isPending} className="h-8 text-xs" />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Impact</div>
                    <CommitInput value={selectedRecommendation.impact || ""} onCommit={(value) => patchSelected({ impact: value })} disabled={busy || isPending} className="h-8 text-xs" />
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Title</div>
                  <CommitInput value={selectedRecommendation.title} onCommit={(value) => patchSelected({ title: value })} disabled={busy || isPending} className="h-8 text-xs" />
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Description</div>
                  <CommitTextarea value={selectedRecommendation.description} onCommit={(value) => patchSelected({ description: value })} disabled={busy || isPending} className="min-h-[88px] text-xs" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Reviewer Note</div>
                    <CommitTextarea value={selectedRecommendation.reviewerNote || ""} onCommit={(value) => patchSelected({ reviewerNote: value })} disabled={busy || isPending} className="min-h-[72px] text-xs" />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/40">Resolution Summary</div>
                    <CommitTextarea
                      value={selectedRecommendation.resolution?.summary || ""}
                      onCommit={(value) =>
                        patchSelected({
                          resolution: {
                            ...(selectedRecommendation.resolution || { actions: [] }),
                            summary: value,
                          },
                        })
                      }
                      disabled={busy || isPending}
                      className="min-h-[72px] text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {(selectedRecommendation.status || "open") === "open" && (selectedRecommendation.resolution?.actions || []).length > 0 ? (
                      <Button type="button" size="sm" variant="default" onClick={() => handleResolve(selectedRecommendation.id)} disabled={busy || isPending}>
                        {resolvingId === selectedRecommendation.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        Apply Resolution
                      </Button>
                    ) : null}
                    {(selectedRecommendation.status || "open") === "open" ? (
                      <Button type="button" size="sm" variant="secondary" onClick={() => handleDismiss(selectedRecommendation.id)} disabled={busy || isPending}>
                        Dismiss
                      </Button>
                    ) : null}
                  </div>
                  <Button type="button" size="sm" variant="destructive" onClick={() => onChange(removeAtIndex(recommendations, selectedIndex))} disabled={busy || isPending || selectedIndex < 0}>
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid content-start gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={priorityTone(selectedRecommendation.priority)}>{selectedRecommendation.priority}</Badge>
                  <Badge tone={itemStateTone(selectedRecommendation.status || "open")} className="capitalize">{selectedRecommendation.status || "open"}</Badge>
                  {selectedRecommendation.category ? <span className="text-[11px] text-fg/35">{selectedRecommendation.category}</span> : null}
                  {selectedRecommendation.impact ? <span className="ml-auto font-mono text-xs text-fg/45">{selectedRecommendation.impact}</span> : null}
                </div>
                <div>
                  <div className="text-sm font-semibold text-fg"><ReviewText value={selectedRecommendation.title} fallback="Untitled recommendation" /></div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-fg/60"><ReviewText value={selectedRecommendation.description} fallback="No description." /></p>
                </div>
                {selectedRecommendation.reviewerNote ? (
                  <div className="rounded-md border border-line/40 bg-bg/30 px-3 py-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/35">Reviewer Note</div>
                    <p className="whitespace-pre-wrap break-words text-xs text-fg/50"><ReviewText value={selectedRecommendation.reviewerNote} /></p>
                  </div>
                ) : null}
                {selectedRecommendation.resolution?.summary ? (
                  <div className="rounded-md border border-line/40 bg-bg/30 px-3 py-2">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg/35">Resolution Summary</div>
                    <p className="whitespace-pre-wrap break-words text-xs text-fg/50"><ReviewText value={selectedRecommendation.resolution.summary} /></p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentActivityLog({ events, isRunning }: { events: any[]; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const meaningful = events.filter((event) => event.type === "tool_call" || event.type === "assistant_message" || event.type === "tool_result").slice(-4);

  return (
    <div className="shrink-0 overflow-hidden rounded-lg border border-accent/20 bg-accent/[0.02]">
      <button type="button" className="flex w-full items-center gap-2 border-b border-accent/10 px-3 py-2 text-left" onClick={() => setExpanded((value) => !value)}>
        {isRunning ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
        <span className="text-[11px] font-medium text-accent/70">{isRunning ? "Review agent working..." : "Review agent completed"}</span>
        <span className="ml-auto text-[10px] text-fg/25">{events.length} events</span>
        {expanded ? <ChevronDown className="h-3 w-3 text-fg/25" /> : <ChevronRight className="h-3 w-3 text-fg/25" />}
      </button>
      {expanded ? (
        <div className="space-y-1 px-3 py-2">
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

function scorePercent(score: number | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0;
  const normalized = score > 1 ? score : score * 100;
  return Math.max(0, Math.min(100, normalized));
}

function qualityFindingTone(severity: QualityFinding["severity"]) {
  if (severity === "error") return "danger";
  if (severity === "warning") return "warning";
  if (severity === "info") return "info";
  return "success";
}

function QualityReviewSubTab({
  summary,
  findings,
  resources,
  onFindingAction,
}: {
  summary: QualityPanelSummary | null;
  findings: QualityFinding[];
  resources: ResourceSummaryRow[];
  onFindingAction?: (finding: QualityFinding) => void;
}) {
  const findingPaged = usePagedItems(findings, 5);
  const resourcePaged = usePagedItems(resources, 5);
  const pct = scorePercent(summary?.score);
  const totalResourceCost = resources.reduce((sum, resource) => sum + (Number(resource.totalCost) || 0), 0);
  const referencedPositions = resources.reduce((sum, resource) => sum + (resource.positionCount ?? 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
      <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-5">
        <MetricTile label="Quality Score" value={summary ? `${Math.round(pct)}%` : "—"} tone={pct >= 90 ? "success" : pct >= 55 ? "warning" : "danger"} />
        <MetricTile label="Errors" value={summary?.errorCount ?? findings.filter((finding) => finding.severity === "error").length} tone="danger" />
        <MetricTile label="Warnings" value={summary?.warningCount ?? findings.filter((finding) => finding.severity === "warning").length} tone="warning" />
        <MetricTile label="Resources" value={resources.length} tone="info" />
        <MetricTile label="Resource Cost" value={formatMoney(totalResourceCost, 2)} />
      </div>

      <div className={SPLIT_GRID_CLASS + " xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]"}>
        <div className={SPLIT_PANE_CLASS}>
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/45">Estimate Quality</div>
              <p className="mt-1 text-[11px] text-fg/45">Validation, evidence coverage, and pricing readiness.</p>
            </div>
            <Badge tone={summary?.status === "passed" ? "success" : summary?.status === "errors" ? "danger" : summary?.status === "warnings" ? "warning" : "default"}>
              {summary?.status ?? "Not checked"}
            </Badge>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {findings.length === 0 ? (
              <EmptyReviewState>No validation findings yet.</EmptyReviewState>
            ) : (
              findingPaged.pageItems.map((finding) => (
                <div key={finding.id} className="rounded-lg border border-line bg-panel2/25 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-fg">{finding.title}</span>
                        <Badge tone={qualityFindingTone(finding.severity)}>{finding.severity}</Badge>
                        {finding.category ? <Badge>{finding.category}</Badge> : null}
                        <span className="font-mono text-[10px] text-fg/35">{finding.ruleId}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg/65">{finding.message}</p>
                    </div>
                    {finding.elementRef ? (
                      <span className="max-w-28 shrink-0 truncate rounded-md bg-bg/45 px-1.5 py-0.5 font-mono text-[10px] text-fg/45">
                        {finding.elementRef}
                      </span>
                    ) : null}
                  </div>
                  {(finding.suggestion || finding.actionLabel) ? (
                    <div className="mt-2 flex items-center justify-between gap-2">
                      {finding.suggestion ? <p className="line-clamp-1 text-[11px] text-fg/50">{finding.suggestion}</p> : <span />}
                      {finding.actionLabel && onFindingAction ? (
                        <button
                          type="button"
                          onClick={() => onFindingAction(finding)}
                          className="shrink-0 rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-medium text-fg/70 transition-colors hover:bg-panel2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
                        >
                          {finding.actionLabel}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <PaginationBar
            label="findings"
            page={findingPaged.page}
            pageSize={findingPaged.pageSize}
            total={findingPaged.total}
            totalPages={findingPaged.totalPages}
            onPageChange={findingPaged.setPage}
          />
        </div>

        <div className={SPLIT_PANE_CLASS}>
          <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-fg/45">Resource Summary</div>
              <p className="mt-1 text-[11px] text-fg/45">Composition by configured estimate category.</p>
            </div>
            <Badge tone="info">{referencedPositions.toLocaleString()} positions</Badge>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {resources.length === 0 ? (
              <EmptyReviewState>No resource composition has been captured yet.</EmptyReviewState>
            ) : (
              resourcePaged.pageItems.map((resource) => (
                <div key={resource.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg border border-line bg-panel2/25 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-fg">{resource.name}</span>
                      {resource.code ? <span className="font-mono text-[10px] text-fg/35">{resource.code}</span> : null}
                      <Badge>{resource.type}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg/50">
                      <span>
                        Qty <span className="font-mono text-fg/65">{resource.totalQuantity.toLocaleString()}</span>
                        {resource.unit ? ` ${resource.unit}` : ""}
                      </span>
                      {resource.averageUnitRate !== undefined ? <span>Avg {formatMoney(resource.averageUnitRate, 2)}</span> : null}
                      {resource.positionCount !== undefined ? <span>{resource.positionCount.toLocaleString()} positions</span> : null}
                    </div>
                  </div>
                  <span className="font-mono text-sm font-semibold text-fg">{formatMoney(resource.totalCost, 2)}</span>
                </div>
              ))
            )}
          </div>
          <PaginationBar
            label="resources"
            page={resourcePaged.page}
            pageSize={resourcePaged.pageSize}
            total={resourcePaged.total}
            totalPages={resourcePaged.totalPages}
            onPageChange={resourcePaged.setPage}
          />
        </div>
      </div>
    </div>
  );
}

export function ReviewTab({
  workspace,
  onApply,
  onError,
  qualitySummary = null,
  qualityFindings = [],
  resourceSummaryRows = [],
  onQualityFindingAction,
}: ReviewTabProps) {
  const [subTab, setSubTab] = useState<ReviewSubTab>("quality");
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

  // Knowledge books and datasets are cited by the review but are not part of
  // the workspace payload, so they are fetched once, best-effort — an
  // unresolved id simply renders as the agent wrote it.
  const [knowledgeBooks, setKnowledgeBooks] = useState<Array<{ id: string; name?: string }>>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name?: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      listKnowledgeBooks(projectId).catch(() => []),
      listDatasets(projectId).catch(() => []),
    ]).then(([books, sets]) => {
      if (cancelled) return;
      setKnowledgeBooks(books as Array<{ id: string; name?: string }>);
      setDatasets(sets as Array<{ id: string; name?: string }>);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  const reviewLabelIndex = useMemo(() => buildReviewLabelIndex({
    worksheets: workspace.worksheets,
    sourceDocuments: workspace.sourceDocuments,
    phases: workspace.phases,
    worksheetFolders: workspace.worksheetFolders,
    rateSchedules: workspace.rateSchedules,
    knowledgeBooks,
    datasets,
  }), [workspace.worksheets, workspace.sourceDocuments, workspace.phases, workspace.worksheetFolders, workspace.rateSchedules, knowledgeBooks, datasets]);

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
      { id: "quality", label: "Quality", count: qualityFindings.length },
      { id: "coverage", label: "Coverage", count: coverage.length },
      { id: "gaps", label: "Gaps & Risks", count: findings.length },
      { id: "competitiveness", label: "Competitiveness", count: (competitiveness.overestimates?.length || 0) + (competitiveness.underestimates?.length || 0) },
      { id: "productivity", label: "Productivity", count: productivityBenchmarks.length },
      { id: "recommendations", label: "Recommendations", count: recommendations.filter((item) => item.status === "open").length },
    ],
    [coverage.length, findings.length, competitiveness.overestimates?.length, competitiveness.underestimates?.length, productivityBenchmarks.length, qualityFindings.length, recommendations],
  );

  const canMarkCurrent = !!review && !isRunning && !!review.currentRevisionId && review.currentRevisionId === review.revisionId;
  const reviewActionLabel = review?.isOutdated ? "Mark Current" : review?.reviewState === "resolved" ? "Reopen Review" : "Resolve Review";

  return (
    <ReviewLabelContext.Provider value={reviewLabelIndex}>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-lg border border-line bg-panel/35 p-3">
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
              variant={review.reviewState === "resolved" && !review.isOutdated ? "secondary" : "default"}
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
            <Button size="sm" variant="default" onClick={handleStartReview} disabled={isStarting}>
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

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {subTabs.map((tab) => (
          <button key={tab.id} type="button" onClick={() => setSubTab(tab.id)} className={cn("flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors", subTab === tab.id ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}>
            {tab.label}
            {tab.count != null && tab.count > 0 ? <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none", subTab === tab.id ? "bg-accent/20 text-accent" : "bg-fg/10 text-fg/40")}>{tab.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {subTab === "quality" ? (
          <motion.div key="quality" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full min-h-0">
            <QualityReviewSubTab
              summary={qualitySummary}
              findings={qualityFindings}
              resources={resourceSummaryRows}
              onFindingAction={onQualityFindingAction}
            />
          </motion.div>
        ) : !review ? (
          <div className="flex h-full items-center justify-center text-sm text-fg/35">
            Run a quote review to inspect scope coverage, gaps, competitiveness, productivity, and recommendations.
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {subTab === "coverage" ? <motion.div key="coverage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full min-h-0"><CoverageSubTab items={coverage} editable={editMode && !isRunning} busy={isPending} onChange={(items) => saveReviewPatch({ coverage: items })} /></motion.div> : null}
            {subTab === "gaps" ? <motion.div key="gaps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full min-h-0"><GapsRisksSubTab findings={findings} editable={editMode && !isRunning} busy={isPending} onChange={(items) => saveReviewPatch({ findings: items })} /></motion.div> : null}
            {subTab === "competitiveness" ? <motion.div key="competitiveness" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full min-h-0"><CompetitivenessSubTab data={competitiveness} editable={editMode && !isRunning} busy={isPending} onChange={(next) => saveReviewPatch({ competitiveness: next })} /></motion.div> : null}
            {subTab === "productivity" ? <motion.div key="productivity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full min-h-0"><ProductivitySubTab data={competitiveness} editable={editMode && !isRunning} busy={isPending} onChange={(next) => saveReviewPatch({ competitiveness: next })} /></motion.div> : null}
            {subTab === "recommendations" ? <motion.div key="recommendations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} className="h-full min-h-0"><RecommendationsSubTab recommendations={recommendations} editable={editMode && !isRunning} busy={isPending} projectId={projectId} onApply={handleApply} onError={onError} onRefreshReview={loadReview} onChange={(next) => saveReviewPatch({ recommendations: next })} /></motion.div> : null}
          </AnimatePresence>
        )}
      </div>
    </div>
    </ReviewLabelContext.Provider>
  );
}

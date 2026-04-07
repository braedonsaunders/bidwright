"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Info,
  Loader2,
  Play,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Square,
  TrendingDown,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import {
  startReview,
  getLatestReview,
  resolveRecommendation,
  dismissRecommendation,
  stopReview,
  connectReviewStream,
  getReviewStatus,
  type QuoteReview,
  type ReviewCoverageItem,
  type ReviewFinding,
  type ReviewCompetitiveness,
  type ReviewRecommendation,
  type ReviewSummary,
  type ProjectWorkspaceData,
  type WorkspaceResponse,
  getProjectWorkspace,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

// ── Types ────────────────────────────────────────────────────

type ReviewSubTab = "coverage" | "gaps" | "competitiveness" | "productivity" | "recommendations";

interface ReviewTabProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
}

// ── Helpers ──────────────────────────────────────────────────

function severityColor(sev: string) {
  switch (sev) {
    case "CRITICAL": return "danger";
    case "WARNING": return "warning";
    case "INFO": return "info";
    default: return "default";
  }
}

function priorityColor(p: string) {
  switch (p) {
    case "HIGH": return "danger";
    case "MEDIUM": return "warning";
    case "LOW": return "info";
    default: return "default";
  }
}

function coverageColor(status: string) {
  switch (status) {
    case "YES": return "success";
    case "VERIFY": return "warning";
    case "NO": return "danger";
    default: return "default";
  }
}

function formatOptionalInteger(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return value.toLocaleString();
}

function formatOptionalDecimal(value?: number | null, digits = 1) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "—";
  return value.toFixed(digits);
}

// ── Coverage SubTab ──────────────────────────────────────────

function CoverageSubTab({ items }: { items: ReviewCoverageItem[] }) {
  const yesCount = items.filter(i => i.status === "YES").length;
  const verifyCount = items.filter(i => i.status === "VERIFY").length;
  const noCount = items.filter(i => i.status === "NO").length;
  const total = items.length;
  const pct = total > 0 ? Math.round((yesCount / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-4 rounded-lg border border-line bg-panel2/30 px-4 py-3">
        <div className="text-2xl font-bold tabular-nums">{pct}%</div>
        <div className="flex-1">
          <div className="text-xs text-fg/50 mb-1">Scope Coverage</div>
          <div className="h-2 rounded-full bg-bg overflow-hidden flex">
            {total > 0 && (
              <>
                <div className="bg-success h-full transition-all" style={{ width: `${(yesCount / total) * 100}%` }} />
                <div className="bg-warning h-full transition-all" style={{ width: `${(verifyCount / total) * 100}%` }} />
                <div className="bg-danger h-full transition-all" style={{ width: `${(noCount / total) * 100}%` }} />
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" /> {yesCount} Covered</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> {verifyCount} Verify</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" /> {noCount} Missing</span>
        </div>
      </div>

      {/* Table */}
      {items.length === 0 ? (
        <div className="text-center py-12 text-fg/30 text-sm">No coverage data yet</div>
      ) : (
        <div className="rounded-lg border border-line overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs [&_tbody_td:last-child]:!max-w-none [&_tbody_td:last-child]:!overflow-visible [&_tbody_td:last-child]:!whitespace-normal [&_tbody_td:last-child]:!break-words [&_tbody_td:last-child]:!text-clip">
            <thead>
              <tr className="bg-panel2/50 border-b border-line">
                <th className="px-3 py-2 text-left font-medium text-fg/50 w-20">Ref</th>
                <th className="px-3 py-2 text-left font-medium text-fg/50">Requirement</th>
                <th className="px-3 py-2 text-center font-medium text-fg/50 w-20">Status</th>
                <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[320px]">Notes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className={cn("border-b border-line/50 last:border-0", item.status === "NO" && "bg-danger/[0.03]")}>
                  <td className="px-3 py-2 align-top font-mono text-fg/60">{item.specRef}</td>
                  <td className="px-3 py-2 align-top text-fg/80 whitespace-normal break-words">{item.requirement}</td>
                  <td className="px-3 py-2 align-top text-center">
                    <Badge tone={coverageColor(item.status)} className="text-[10px]">{item.status}</Badge>
                  </td>
                  <td className="px-3 py-2 align-top text-fg/50 whitespace-normal break-words">
                    {item.notes || item.worksheetName || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Gaps & Risks SubTab ──────────────────────────────────────

function GapsRisksSubTab({ findings }: { findings: ReviewFinding[] }) {
  const [filter, setFilter] = useState<"ALL" | "CRITICAL" | "WARNING" | "INFO">("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = filter === "ALL" ? findings : findings.filter(f => f.severity === filter);
  const critCount = findings.filter(f => f.severity === "CRITICAL").length;
  const warnCount = findings.filter(f => f.severity === "WARNING").length;
  const infoCount = findings.filter(f => f.severity === "INFO").length;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-2">
        {(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
              filter === f ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60"
            )}
          >
            {f === "ALL" ? `All (${findings.length})` :
             f === "CRITICAL" ? `Critical (${critCount})` :
             f === "WARNING" ? `Warnings (${warnCount})` : `Info (${infoCount})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-fg/30 text-sm">
          {findings.length === 0 ? "No findings yet" : "No findings match filter"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(f => (
            <div key={f.id} className={cn(
              "rounded-lg border overflow-hidden transition-colors",
              f.severity === "CRITICAL" ? "border-danger/30 bg-danger/[0.02]" :
              f.severity === "WARNING" ? "border-warning/30 bg-warning/[0.02]" :
              "border-line bg-panel2/20"
            )}>
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left"
                onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
              >
                {f.severity === "CRITICAL" ? <ShieldAlert className="h-4 w-4 text-danger shrink-0" /> :
                 f.severity === "WARNING" ? <AlertTriangle className="h-4 w-4 text-warning shrink-0" /> :
                 <Info className="h-4 w-4 text-accent shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={severityColor(f.severity)} className="text-[9px]">{f.severity}</Badge>
                    <span className="text-xs font-medium text-fg/80 truncate">{f.title}</span>
                  </div>
                </div>
                {f.estimatedImpact && (
                  <span className="text-[11px] font-mono text-fg/40 shrink-0">{f.estimatedImpact}</span>
                )}
                {f.specRef && (
                  <span className="text-[10px] text-fg/30 shrink-0">{f.specRef}</span>
                )}
                {expandedId === f.id ? <ChevronDown className="h-3.5 w-3.5 text-fg/25 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-fg/25 shrink-0" />}
              </button>
              {expandedId === f.id && (
                <div className="px-4 pb-3 border-t border-line/30">
                  <p className="text-xs text-fg/60 whitespace-pre-wrap mt-2">{f.description}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Competitiveness SubTab ───────────────────────────────────

function CompetitivenessSubTab({ data }: { data: ReviewCompetitiveness }) {
  const overestimates = data.overestimates || [];
  const underestimates = data.underestimates || [];
  const benchmarks = [] as NonNullable<ReviewCompetitiveness["benchmarking"]>["streams"];

  return (
    <div className="space-y-6">
      {/* Total savings */}
      {data.totalSavingsRange && (
        <div className="flex items-center gap-3 rounded-lg border border-success/30 bg-success/5 px-4 py-3">
          <TrendingDown className="h-5 w-5 text-success shrink-0" />
          <div>
            <div className="text-xs font-medium text-success">Total Potential Savings</div>
            <div className="text-lg font-bold text-success tabular-nums">{data.totalSavingsRange}</div>
          </div>
        </div>
      )}

      {/* Overestimates */}
      {overestimates.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-fg/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowUpRight className="h-3.5 w-3.5" /> Potential Overestimates
          </h3>
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-panel2/50 border-b border-line">
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-20">Impact</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-36">Area</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50">Analysis</th>
                  <th className="px-3 py-2 text-right font-medium text-fg/50 w-28">Savings</th>
                </tr>
              </thead>
              <tbody>
                {overestimates.map(oe => (
                  <tr key={oe.id} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2"><Badge tone={priorityColor(oe.impact)} className="text-[9px]">{oe.impact}</Badge></td>
                    <td className="px-3 py-2 font-medium text-fg/70">{oe.area}</td>
                    <td className="px-3 py-2 text-fg/50">{oe.analysis}</td>
                    <td className="px-3 py-2 text-right font-mono text-success font-medium">{oe.savingsRange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Underestimates */}
      {underestimates.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-fg/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <ArrowDownRight className="h-3.5 w-3.5" /> Potential Underestimates
          </h3>
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-panel2/50 border-b border-line">
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-20">Impact</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50 w-36">Area</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50">Analysis</th>
                  <th className="px-3 py-2 text-right font-medium text-fg/50 w-28">Risk</th>
                </tr>
              </thead>
              <tbody>
                {underestimates.map(ue => (
                  <tr key={ue.id} className="border-b border-line/50 last:border-0">
                    <td className="px-3 py-2"><Badge tone={priorityColor(ue.impact)} className="text-[9px]">{ue.impact}</Badge></td>
                    <td className="px-3 py-2 font-medium text-fg/70">{ue.area}</td>
                    <td className="px-3 py-2 text-fg/50">{ue.analysis}</td>
                    <td className="px-3 py-2 text-right font-mono text-danger font-medium">{ue.riskRange}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Productivity Benchmarks */}
      {benchmarks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-fg/60 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5" /> Productivity Benchmarking
          </h3>
          {data.benchmarking?.description && (
            <p className="text-[11px] text-fg/40 mb-2 italic">{data.benchmarking.description}</p>
          )}
          <div className="rounded-lg border border-line overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-panel2/50 border-b border-line">
                  <th className="px-3 py-2 text-left font-medium text-fg/50">Stream</th>
                  <th className="px-3 py-2 text-right font-medium text-fg/50">Footage</th>
                  <th className="px-3 py-2 text-right font-medium text-fg/50">Hours</th>
                  <th className="px-3 py-2 text-right font-medium text-fg/50">{benchmarks[0]?.unit || "ft/hr"}</th>
                  <th className="px-3 py-2 text-right font-medium text-fg/50">FM:TL</th>
                  <th className="px-3 py-2 text-left font-medium text-fg/50">Assessment</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b, i) => {
                  const assessLow = b.assessment.toLowerCase();
                  const color = assessLow.includes("heavy") || assessLow.includes("slow") ? "text-warning" :
                    assessLow.includes("good") || assessLow.includes("efficient") ? "text-success" : "text-fg/60";
                  return (
                    <tr key={i} className="border-b border-line/50 last:border-0">
                      <td className="px-3 py-2 font-medium text-fg/70">{b.name}</td>
                      <td className="px-3 py-2 text-right font-mono text-fg/60">{b.footage?.toLocaleString() || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-fg/60">{b.hours.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-fg/60">{b.productionRate?.toFixed(1) || "—"}</td>
                      <td className="px-3 py-2 text-right font-mono text-fg/60">{b.fmTlRatio?.toFixed(2) || "—"}</td>
                      <td className={cn("px-3 py-2 font-medium", color)}>{b.assessment}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {overestimates.length === 0 && underestimates.length === 0 && benchmarks.length === 0 && (
        <div className="text-center py-12 text-fg/30 text-sm">No competitiveness data yet</div>
      )}
    </div>
  );
}

// ── Recommendations SubTab ───────────────────────────────────

function ProductivitySubTab({ data }: { data: ReviewCompetitiveness }) {
  const benchmarks = data.benchmarking?.streams || [];
  const description = data.benchmarking?.description;
  const streamsWithHours = benchmarks.filter((stream) => Number.isFinite(stream.hours) && stream.hours > 0).length;
  const streamsWithRates = benchmarks.filter(
    (stream) => typeof stream.productionRate === "number" && Number.isFinite(stream.productionRate) && stream.productionRate > 0
  ).length;
  const streamsWithFmTl = benchmarks.filter(
    (stream) => typeof stream.fmTlRatio === "number" && Number.isFinite(stream.fmTlRatio) && stream.fmTlRatio > 0
  ).length;
  const incompleteStreams = benchmarks.filter(
    (stream) =>
      !(Number.isFinite(stream.hours) && stream.hours > 0) ||
      !(typeof stream.productionRate === "number" && Number.isFinite(stream.productionRate) && stream.productionRate > 0) ||
      !(typeof stream.fmTlRatio === "number" && Number.isFinite(stream.fmTlRatio) && stream.fmTlRatio > 0)
  ).length;

  if (benchmarks.length === 0) {
    return <div className="text-center py-12 text-fg/30 text-sm">No productivity data yet</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">Streams</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">{benchmarks.length}</div>
        </div>
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">Quantified Hours</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">
            {streamsWithHours}/{benchmarks.length}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">Benchmark Rates</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">
            {streamsWithRates}/{benchmarks.length}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-panel2/30 px-4 py-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg/40">FM:TL Ratios</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-fg/85">
            {streamsWithFmTl}/{benchmarks.length}
          </div>
        </div>
      </div>

      {(description || incompleteStreams > 0) && (
        <div className="rounded-lg border border-line bg-panel2/20 px-4 py-3 space-y-1.5">
          {description && <p className="text-xs text-fg/55">{description}</p>}
          {incompleteStreams > 0 && (
            <p className="text-[11px] text-fg/40">
              {incompleteStreams} stream{incompleteStreams === 1 ? "" : "s"} are missing one or more quantified productivity metrics, so unavailable values are shown as dashes.
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-line overflow-x-auto">
        <table className="w-full min-w-[960px] text-xs">
          <thead>
            <tr className="bg-panel2/50 border-b border-line">
              <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[220px]">Stream</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-28">Footage</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-24">Hours</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-32">MH/LF benchmark</th>
              <th className="px-3 py-2 text-right font-medium text-fg/50 w-20">FM:TL</th>
              <th className="px-3 py-2 text-left font-medium text-fg/50 min-w-[360px]">Assessment</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((benchmark, index) => {
              const assessmentText = benchmark.assessment.trim() || "No productivity assessment provided yet";
              const assessLow = assessmentText.toLowerCase();
              const color =
                assessLow.includes("heavy") || assessLow.includes("slow") || assessLow.includes("premium")
                  ? "text-warning"
                  : assessLow.includes("good") || assessLow.includes("efficient") || assessLow.includes("favorable")
                    ? "text-success"
                    : "text-fg/60";

              return (
                <tr key={`${benchmark.name}-${index}`} className="border-b border-line/50 last:border-0 align-top">
                  <td className="px-3 py-2 font-medium text-fg/70">{benchmark.name}</td>
                  <td className="px-3 py-2 text-right font-mono text-fg/60">{formatOptionalInteger(benchmark.footage)}</td>
                  <td className="px-3 py-2 text-right font-mono text-fg/60">{formatOptionalInteger(benchmark.hours)}</td>
                  <td className="px-3 py-2 text-right font-mono text-fg/60">{formatOptionalDecimal(benchmark.productionRate)}</td>
                  <td className="px-3 py-2 text-right font-mono text-fg/60">{formatOptionalDecimal(benchmark.fmTlRatio, 2)}</td>
                  <td className={cn("px-3 py-2 whitespace-normal break-words", color)}>{assessmentText}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecommendationsSubTab({
  recommendations,
  projectId,
  onApply,
  onError,
}: {
  recommendations: ReviewRecommendation[];
  projectId: string;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const openRecs = recommendations.filter(r => r.status === "open");
  const resolvedRecs = recommendations.filter(r => r.status === "resolved" || r.status === "dismissed");

  function handleResolve(recId: string) {
    setResolvingId(recId);
    startTransition(async () => {
      try {
        const result = await resolveRecommendation(projectId, recId);
        onApply(result);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to resolve");
      } finally {
        setResolvingId(null);
      }
    });
  }

  function handleDismiss(recId: string) {
    startTransition(async () => {
      try {
        await dismissRecommendation(projectId, recId);
        // Refresh the review data — the parent will poll
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to dismiss");
      }
    });
  }

  function RecCard({ rec }: { rec: ReviewRecommendation }) {
    const isExpanded = expandedId === rec.id;
    const isResolving = resolvingId === rec.id;
    const isDone = rec.status === "resolved" || rec.status === "dismissed";

    return (
      <div className={cn(
        "rounded-lg border overflow-hidden transition-all",
        isDone ? "border-line/50 bg-panel2/10 opacity-60" : "border-line bg-panel2/20"
      )}>
        <button
          className="w-full flex items-center gap-3 px-4 py-3 text-left"
          onClick={() => setExpandedId(isExpanded ? null : rec.id)}
        >
          {isDone ? (
            rec.status === "resolved" ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <XCircle className="h-4 w-4 text-fg/30 shrink-0" />
          ) : (
            <Zap className={cn("h-4 w-4 shrink-0", rec.priority === "HIGH" ? "text-danger" : rec.priority === "MEDIUM" ? "text-warning" : "text-accent")} />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge tone={priorityColor(rec.priority)} className="text-[9px]">{rec.priority}</Badge>
              {rec.category && <span className="text-[10px] text-fg/30">{rec.category}</span>}
              <span className={cn("text-xs font-medium truncate", isDone ? "text-fg/40 line-through" : "text-fg/80")}>{rec.title}</span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-fg/40 shrink-0">{rec.impact}</span>
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-fg/25 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-fg/25 shrink-0" />}
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 border-t border-line/30 space-y-3">
            <p className="text-xs text-fg/60 whitespace-pre-wrap mt-3">{rec.description}</p>

            {rec.resolution && (
              <div className="rounded-md border border-line/50 bg-bg/30 px-3 py-2">
                <div className="text-[10px] text-fg/35 uppercase tracking-wider mb-1">Resolution</div>
                <p className="text-xs text-fg/50">{rec.resolution.summary}</p>
                {rec.resolution.actions.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {rec.resolution.actions.map((a, i) => (
                      <div key={i} className="text-[10px] text-fg/35 flex items-center gap-1">
                        <CircleDot className="h-2.5 w-2.5 shrink-0" />
                        <span className="font-mono">{a.action}</span>
                        {a.itemName && <span>— {a.itemName}</span>}
                        {a.worksheetName && <span className="text-fg/25">({a.worksheetName})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!isDone && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="accent"
                  onClick={() => handleResolve(rec.id)}
                  disabled={isPending}
                >
                  {isResolving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleDismiss(rec.id)}
                  disabled={isPending}
                >
                  Dismiss
                </Button>
              </div>
            )}

            {rec.status === "resolved" && (
              <div className="flex items-center gap-1.5 text-[11px] text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Resolved — changes applied to quote
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {recommendations.length === 0 ? (
        <div className="text-center py-12 text-fg/30 text-sm">No recommendations yet</div>
      ) : (
        <>
          {openRecs.length > 0 && (
            <div className="space-y-2">
              {openRecs.map(r => <RecCard key={r.id} rec={r} />)}
            </div>
          )}
          {resolvedRecs.length > 0 && (
            <div>
              <div className="text-[10px] text-fg/30 uppercase tracking-wider mb-2">
                Resolved / Dismissed ({resolvedRecs.length})
              </div>
              <div className="space-y-1.5">
                {resolvedRecs.map(r => <RecCard key={r.id} rec={r} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Executive Summary Card ───────────────────────────────────

function SummaryCard({ summary }: { summary: ReviewSummary | null }) {
  if (!summary || !summary.quoteTotal) return null;

  return (
    <div className="rounded-lg border border-line bg-panel2/20 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-[10px] text-fg/35 uppercase tracking-wider">Quote Total</div>
            <div className="text-lg font-bold tabular-nums">{formatMoney(summary.quoteTotal)}</div>
          </div>
          <div className="h-8 border-l border-line" />
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-fg/50">{summary.worksheetCount} worksheets</span>
            <span className="text-fg/50">{summary.itemCount} items</span>
            {summary.totalHours && <span className="text-fg/50">{summary.totalHours.toLocaleString()} hrs</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-fg/40">Coverage: <span className="font-medium text-fg/70">{summary.coverageScore}</span></span>
          {summary.riskCount.critical > 0 && <Badge tone="danger">{summary.riskCount.critical} Critical</Badge>}
          {summary.riskCount.warning > 0 && <Badge tone="warning">{summary.riskCount.warning} Warnings</Badge>}
          {summary.potentialSavings && <span className="text-success font-medium">Savings: {summary.potentialSavings}</span>}
        </div>
      </div>
      {summary.overallAssessment && (
        <p className="text-xs text-fg/50 border-t border-line/30 pt-2">{summary.overallAssessment}</p>
      )}
    </div>
  );
}

// ── Agent Activity Log ───────────────────────────────────────

function AgentActivityLog({ events, isRunning }: { events: any[]; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && expanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, expanded]);

  // Extract meaningful events (tool calls, messages)
  const meaningful = events.filter(e =>
    e.type === "tool_call" || e.type === "assistant_message" || e.type === "tool_result"
  ).slice(-30);

  return (
    <div className="rounded-lg border border-accent/20 bg-accent/[0.02] overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left border-b border-accent/10"
        onClick={() => setExpanded(!expanded)}
      >
        {isRunning ? <Loader2 className="h-3.5 w-3.5 text-accent animate-spin shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
        <span className="text-[11px] font-medium text-accent/70">
          {isRunning ? "Review agent working..." : "Review agent completed"}
        </span>
        <span className="text-[10px] text-fg/25 ml-auto">{events.length} events</span>
        {expanded ? <ChevronDown className="h-3 w-3 text-fg/25" /> : <ChevronRight className="h-3 w-3 text-fg/25" />}
      </button>
      {expanded && (
        <div ref={scrollRef} className="max-h-48 overflow-y-auto px-3 py-2 space-y-1">
          {meaningful.map((evt, i) => {
            const data = evt.data || {};
            if (evt.type === "assistant_message" && data.content) {
              return (
                <div key={i} className="text-[10px] text-fg/40 truncate">
                  {typeof data.content === "string" ? data.content.substring(0, 200) : "..."}
                </div>
              );
            }
            if (evt.type === "tool_call") {
              return (
                <div key={i} className="text-[10px] text-fg/30 flex items-center gap-1">
                  <span className="font-mono text-accent/60">{data.tool_name || data.toolId || "tool"}</span>
                </div>
              );
            }
            return null;
          })}
          {isRunning && (
            <div className="flex items-center gap-1.5 text-[10px] text-fg/25 animate-pulse">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Working...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ReviewTab Component ─────────────────────────────────

export function ReviewTab({ workspace, onApply, onError }: ReviewTabProps) {
  const [subTab, setSubTab] = useState<ReviewSubTab>("coverage");
  const [review, setReview] = useState<QuoteReview | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [isPending, startTransition] = useTransition();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const projectId = workspace.project.id;

  // Load latest review on mount
  useEffect(() => {
    loadReview();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [projectId]);

  const loadReview = useCallback(async () => {
    try {
      const { review: r } = await getLatestReview(projectId);
      setReview(r);
      if (r?.status === "running") {
        setIsRunning(true);
        startPolling();
        connectStream();
      }
    } catch {
      // No review yet — fine
    }
  }, [projectId]);

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { review: r } = await getLatestReview(projectId);
        setReview(r);
        if (r && r.status !== "running") {
          setIsRunning(false);
          if (pollRef.current) clearInterval(pollRef.current);
          if (eventSourceRef.current) eventSourceRef.current.close();
        }
      } catch {}
    }, 5000);
  }

  function connectStream() {
    if (eventSourceRef.current) eventSourceRef.current.close();
    try {
      const es = connectReviewStream(projectId);
      eventSourceRef.current = es;

      es.addEventListener("tool_call", (e) => {
        try {
          const data = JSON.parse(e.data);
          setEvents(prev => [...prev, { type: "tool_call", data }]);
        } catch {}
      });
      es.addEventListener("assistant_message", (e) => {
        try {
          const data = JSON.parse(e.data);
          setEvents(prev => [...prev, { type: "assistant_message", data }]);
        } catch {}
      });
      es.addEventListener("tool_result", (e) => {
        try {
          const data = JSON.parse(e.data);
          setEvents(prev => [...prev, { type: "tool_result", data }]);
        } catch {}
      });
      es.onerror = () => {
        // SSE connection lost — don't retry, polling handles updates
        es.close();
      };
    } catch {
      // Stream not available — polling will handle it
    }
  }

  async function handleStartReview() {
    setIsStarting(true);
    try {
      const result = await startReview(projectId);
      setIsRunning(true);
      setEvents([]);
      // Load the newly created review
      const { review: r } = await getLatestReview(projectId);
      setReview(r);
      startPolling();
      connectStream();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to start review");
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
      // Reload to get final state
      const { review: r } = await getLatestReview(projectId);
      setReview(r);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to stop review");
    }
  }

  // Wrapper for onApply that also refreshes the review
  function handleApply(next: WorkspaceResponse) {
    onApply(next);
    // Refresh review data since a recommendation was resolved
    loadReview();
  }

  const summary = review?.summary as ReviewSummary | null;
  const coverage = (review?.coverage as ReviewCoverageItem[]) || [];
  const findings = (review?.findings as ReviewFinding[]) || [];
  const competitiveness = (review?.competitiveness as ReviewCompetitiveness) || {};
  const productivityBenchmarks = competitiveness.benchmarking?.streams || [];
  const recommendations = (review?.recommendations as ReviewRecommendation[]) || [];

  const subTabs: Array<{ id: ReviewSubTab; label: string; count?: number }> = [
    { id: "coverage", label: "Coverage", count: coverage.length },
    { id: "gaps", label: "Gaps & Risks", count: findings.length },
    {
      id: "competitiveness",
      label: "Competitiveness",
      count: (competitiveness.overestimates?.length || 0) + (competitiveness.underestimates?.length || 0),
    },
    { id: "productivity", label: "Productivity", count: productivityBenchmarks.length },
    { id: "recommendations", label: "Recommendations", count: recommendations.filter(r => r.status === "open").length },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-3">
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex-1 flex items-center gap-3">
          {review ? (
            <Badge tone={review.status === "completed" ? "success" : review.status === "running" ? "warning" : "danger"}>
              {review.status === "running" ? "Running" : review.status === "completed" ? "Complete" : "Failed"}
            </Badge>
          ) : (
            <Badge tone="default">Not Run</Badge>
          )}
          {review?.createdAt && (
            <span className="text-[10px] text-fg/30">
              {new Date(review.createdAt).toLocaleString()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <Button size="sm" variant="secondary" onClick={handleStopReview}>
              <Square className="h-3 w-3" /> Stop Review
            </Button>
          ) : (
            <Button size="sm" variant="accent" onClick={handleStartReview} disabled={isStarting}>
              {isStarting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {review ? "Re-run Review" : "Start Review"}
            </Button>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <SummaryCard summary={summary} />

      {/* Agent Activity Log (when running or just completed) */}
      {(isRunning || events.length > 0) && (
        <AgentActivityLog events={events} isRunning={isRunning} />
      )}

      {/* SubTab bar */}
      <div className="flex items-center gap-1 shrink-0">
        {subTabs.map(st => (
          <button
            key={st.id}
            onClick={() => setSubTab(st.id)}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1",
              subTab === st.id ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60"
            )}
          >
            {st.label}
            {st.count != null && st.count > 0 && (
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none",
                subTab === st.id ? "bg-accent/20 text-accent" : "bg-fg/10 text-fg/40"
              )}>
                {st.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* SubTab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <AnimatePresence mode="wait">
          {subTab === "coverage" && (
            <motion.div key="coverage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <CoverageSubTab items={coverage} />
            </motion.div>
          )}
          {subTab === "gaps" && (
            <motion.div key="gaps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <GapsRisksSubTab findings={findings} />
            </motion.div>
          )}
          {subTab === "competitiveness" && (
            <motion.div key="competitiveness" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <CompetitivenessSubTab data={competitiveness} />
            </motion.div>
          )}
          {subTab === "productivity" && (
            <motion.div key="productivity" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <ProductivitySubTab data={competitiveness} />
            </motion.div>
          )}
          {subTab === "recommendations" && (
            <motion.div key="recommendations" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
              <RecommendationsSubTab
                recommendations={recommendations}
                projectId={projectId}
                onApply={handleApply}
                onError={onError}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

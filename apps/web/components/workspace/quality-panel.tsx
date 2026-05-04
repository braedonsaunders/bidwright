"use client";

import { AlertTriangle, CheckCircle2, CircleAlert, Info, ShieldCheck } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui";
import { cn } from "@/lib/utils";

export type QualityFindingSeverity = "error" | "warning" | "info" | "pass";

export interface QualityFinding {
  id: string;
  ruleId: string;
  title: string;
  message: string;
  severity: QualityFindingSeverity;
  category?: string;
  itemId?: string;
  worksheetId?: string;
  elementRef?: string;
  suggestion?: string;
  actionLabel?: string;
}

export interface QualityPanelSummary {
  score: number;
  status?: "passed" | "warnings" | "errors" | "pending";
  totalRules?: number;
  passedRules?: number;
  errorCount?: number;
  warningCount?: number;
  infoCount?: number;
}

export interface QualityPanelProps {
  summary: QualityPanelSummary | null;
  findings: QualityFinding[];
  loading?: boolean;
  className?: string;
  onFindingAction?: (finding: QualityFinding) => void;
}

const severityOrder: QualityFindingSeverity[] = ["error", "warning", "info", "pass"];

const severityMeta: Record<
  QualityFindingSeverity,
  {
    label: string;
    tone: "danger" | "warning" | "info" | "success";
    icon: typeof AlertTriangle;
    row: string;
  }
> = {
  error: { label: "Errors", tone: "danger", icon: CircleAlert, row: "border-danger/25 bg-danger/5" },
  warning: { label: "Warnings", tone: "warning", icon: AlertTriangle, row: "border-warning/25 bg-warning/5" },
  info: { label: "Info", tone: "info", icon: Info, row: "border-accent/25 bg-accent/5" },
  pass: { label: "Passed", tone: "success", icon: CheckCircle2, row: "border-success/25 bg-success/5" },
};

function scorePercent(score: number | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return 0;
  const normalized = score > 1 ? score : score * 100;
  return Math.max(0, Math.min(100, normalized));
}

function scoreLabel(score: number | undefined) {
  const pct = scorePercent(score);
  if (pct >= 90) return "Institutional";
  if (pct >= 75) return "Bid-ready";
  if (pct >= 55) return "Needs review";
  return "Blocked";
}

function statusTone(status: QualityPanelSummary["status"], pct: number) {
  if (!status) return "default";
  if (status === "errors" || pct < 55) return "danger";
  if (status === "warnings" || pct < 90) return "warning";
  if (status === "pending") return "info";
  return "success";
}

function groupFindings(findings: QualityFinding[]) {
  return severityOrder
    .map((severity) => ({
      severity,
      findings: findings.filter((finding) => finding.severity === severity),
    }))
    .filter((group) => group.findings.length > 0);
}

export function QualityPanel({
  summary,
  findings,
  loading = false,
  className,
  onFindingAction,
}: QualityPanelProps) {
  const hasSummary = !!summary;
  const pct = hasSummary ? scorePercent(summary.score) : 0;
  const grouped = groupFindings(findings);
  const tone = statusTone(summary?.status, pct);
  const badgeLabel = loading ? "Checking" : hasSummary ? scoreLabel(summary.score) : "Not checked";

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            Estimate Quality
          </CardTitle>
          <p className="mt-1 text-xs text-fg/50">
            Validation, evidence coverage, and pricing readiness.
          </p>
        </div>
        <Badge tone={tone}>{badgeLabel}</Badge>
      </CardHeader>

      <CardBody className="space-y-4">
        <div className="rounded-lg border border-line bg-bg/35 p-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-fg/45">Quality Score</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-fg">
                {loading || !hasSummary ? "--" : `${Math.round(pct)}%`}
              </div>
            </div>
            {summary ? (
              <div className="grid grid-cols-3 gap-2 text-right text-[11px] text-fg/55">
                <div>
                  <div className="font-semibold text-fg">{summary.errorCount ?? 0}</div>
                  <div>Errors</div>
                </div>
                <div>
                  <div className="font-semibold text-fg">{summary.warningCount ?? 0}</div>
                  <div>Warnings</div>
                </div>
                <div>
                  <div className="font-semibold text-fg">{summary.passedRules ?? 0}</div>
                  <div>Passed</div>
                </div>
              </div>
            ) : null}
          </div>
          <Progress value={pct} className="mt-3" />
        </div>

        {loading ? (
          <EmptyState className="py-6">Checking estimate quality...</EmptyState>
        ) : grouped.length === 0 ? (
          <EmptyState className="py-6">No validation findings yet.</EmptyState>
        ) : (
          <div className="space-y-3">
            {grouped.map((group) => {
              const meta = severityMeta[group.severity];
              const Icon = meta.icon;
              return (
                <section key={group.severity} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-fg/75">
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </div>
                    <Badge tone={meta.tone}>{group.findings.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {group.findings.map((finding) => (
                      <div key={finding.id} className={cn("rounded-lg border p-3", meta.row)}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium text-fg">{finding.title}</span>
                              {finding.category ? <Badge>{finding.category}</Badge> : null}
                              <span className="font-mono text-[10px] text-fg/35">{finding.ruleId}</span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-fg/65">{finding.message}</p>
                          </div>
                          {finding.elementRef ? (
                            <span className="max-w-28 shrink-0 truncate rounded-md bg-bg/45 px-1.5 py-0.5 font-mono text-[10px] text-fg/45">
                              {finding.elementRef}
                            </span>
                          ) : null}
                        </div>
                        {finding.suggestion || finding.actionLabel ? (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            {finding.suggestion ? (
                              <p className="text-[11px] leading-4 text-fg/50">{finding.suggestion}</p>
                            ) : <span />}
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
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

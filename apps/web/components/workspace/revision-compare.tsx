"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  GitCompareArrows,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  compareRevisions,
  type ProjectWorkspaceData,
  type QuoteRevisionComparison,
  type RevisionCompareLineItem,
  type RevisionCompareLineItemChange,
  type RevisionCompareMetric,
} from "@/lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@braedonsaunders/appkit-ui";
import { Badge, EmptyState, Select } from "@/components/legacy-controls";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

interface RevisionCompareProps {
  workspace: ProjectWorkspaceData;
  open: boolean;
  onClose: () => void;
}

/* ─── Helpers ─── */

function fmtMoney(v: number) {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtPercent(v: number) {
  return (v * 100).toFixed(1) + "%";
}

function fmtNumber(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatValue(v: number, format: RevisionCompareMetric["format"]) {
  if (format === "money") return fmtMoney(v);
  if (format === "percent") return fmtPercent(v);
  return fmtNumber(v);
}

function formatDelta(v: number, format: RevisionCompareMetric["format"]) {
  if (v === 0) return "--";
  const prefix = v > 0 ? "+" : "";
  return prefix + formatValue(v, format);
}

/** Cost going up is bad, revenue going up is good — the caller says which. */
function DeltaValue({
  delta,
  format,
  higherIsBetter = true,
  className,
}: {
  delta: number;
  format: RevisionCompareMetric["format"];
  higherIsBetter?: boolean;
  className?: string;
}) {
  if (delta === 0) return <span className={cn("text-fg/30", className)}>--</span>;
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium tabular-nums",
        good ? "text-success" : "text-danger",
        className,
      )}
    >
      {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {formatDelta(delta, format).replace(/^[+]/, "")}
    </span>
  );
}

const COST_LIKE_METRICS = new Set(["cost", "totalHours", "regHours", "overHours", "doubleHours"]);

function revisionLabel(revision: { revisionNumber: number; title?: string; status?: string }) {
  const title = revision.title?.trim();
  return `Rev ${revision.revisionNumber}${title ? ` — ${title}` : ""}`;
}

function changeTone(kind: RevisionCompareLineItemChange["changes"][number]) {
  if (kind === "quantity") return "info" as const;
  if (kind === "rate" || kind === "cost") return "warning" as const;
  return "default" as const;
}

function ItemRow({
  item,
  trailing,
}: {
  item: RevisionCompareLineItem;
  trailing: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{item.entityName || item.description || "Untitled line"}</div>
        <div className="truncate text-[11px] text-fg/40">
          {[item.worksheetName, item.category, `${fmtNumber(item.quantity)} ${item.uom}`.trim()]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <div className="shrink-0 text-right">{trailing}</div>
    </div>
  );
}

function SectionCard({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} ({count})
        </CardTitle>
      </CardHeader>
      <CardContent className="max-h-72 space-y-1 overflow-y-auto">{children}</CardContent>
    </Card>
  );
}

/* ─── Main Component ─── */

export function RevisionCompare({ workspace, open, onClose }: RevisionCompareProps) {
  const [selectedRevisionB, setSelectedRevisionB] = useState<string>("");
  const [comparison, setComparison] = useState<QuoteRevisionComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectId = workspace.project.id;
  const rev = workspace.currentRevision;

  // Every revision of this quote already ships with the workspace, so the
  // picker needs no round trip — only the comparison itself does.
  const otherRevisions = useMemo(
    () => (workspace.revisions ?? []).filter((entry) => entry.id !== rev.id),
    [workspace.revisions, rev.id],
  );

  const loadComparison = useCallback(
    async (revisionId: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await compareRevisions(projectId, revisionId, rev.id);
        setComparison(result);
      } catch (err) {
        setComparison(null);
        setError(err instanceof Error ? err.message : "Could not load the revision comparison.");
      } finally {
        setLoading(false);
      }
    },
    [projectId, rev.id],
  );

  useEffect(() => {
    if (!open) return;
    if (!selectedRevisionB) {
      setComparison(null);
      setError(null);
      return;
    }
    void loadComparison(selectedRevisionB);
  }, [open, selectedRevisionB, loadComparison]);

  // Reopening after a revision switch must not show the previous quote's diff.
  useEffect(() => {
    if (!open) {
      setSelectedRevisionB("");
      setComparison(null);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const options = [
    { value: "__select__", label: "Select a revision..." },
    ...otherRevisions.map((entry) => ({
      value: entry.id,
      label: revisionLabel(entry),
    })),
  ];

  const summary = comparison?.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/60 p-4 pt-12">
      <div className="relative w-full max-w-5xl rounded-xl border border-line bg-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div className="flex items-center gap-3">
            <GitCompareArrows className="h-5 w-5 text-accent" />
            <h2 className="text-base font-semibold">Revision Comparison</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-fg/40 hover:bg-panel2 hover:text-fg">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Revision selectors */}
        <div className="grid grid-cols-2 gap-4 border-b border-line px-6 py-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg/50">Revision A (Current)</label>
            <div className="flex h-9 items-center rounded-lg border border-line bg-panel2 px-3 text-sm">
              {revisionLabel(rev)}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg/50">Revision B (Compare To)</label>
            {otherRevisions.length === 0 ? (
              <div className="flex h-9 items-center rounded-lg border border-dashed border-line bg-panel2/40 px-3 text-sm text-fg/40">
                This quote has only one revision
              </div>
            ) : (
              <Select
                value={selectedRevisionB || "__select__"}
                onValueChange={(v) => setSelectedRevisionB(v === "__select__" ? "" : v)}
                options={options}
              />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {!selectedRevisionB ? (
            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-panel2/30 px-6 py-20 text-center">
              <GitCompareArrows className="mb-3 h-10 w-10 text-fg/15" />
              <p className="text-sm font-medium text-fg/40">Pick a revision to compare</p>
              <p className="mt-1 text-xs text-fg/25">
                Bidwright reprices both revisions and shows the financial movement plus every added, removed,
                requantified, and repriced line.
              </p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <Loader2 className="mb-3 h-6 w-6 animate-spin text-fg/30" />
              <p className="text-sm text-fg/40">Repricing both revisions...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-danger/30 bg-danger/5 px-6 py-16 text-center">
              <TriangleAlert className="mb-3 h-8 w-8 text-danger/70" />
              <p className="text-sm font-medium text-danger">Comparison failed</p>
              <p className="mt-1 max-w-lg break-words text-xs text-fg/40">{error}</p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-4"
                onClick={() => void loadComparison(selectedRevisionB)}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          ) : comparison ? (
            <div className="space-y-4">
              {/* Headline counts */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-line bg-panel2/40 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-fg/40">Added</div>
                  <div className="text-lg font-semibold tabular-nums text-success">{summary?.addedCount ?? 0}</div>
                </div>
                <div className="rounded-lg border border-line bg-panel2/40 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-fg/40">Removed</div>
                  <div className="text-lg font-semibold tabular-nums text-danger">{summary?.removedCount ?? 0}</div>
                </div>
                <div className="rounded-lg border border-line bg-panel2/40 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-fg/40">Qty changed</div>
                  <div className="text-lg font-semibold tabular-nums">{summary?.quantityChangedCount ?? 0}</div>
                </div>
                <div className="rounded-lg border border-line bg-panel2/40 px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-fg/40">Rate changed</div>
                  <div className="text-lg font-semibold tabular-nums">{summary?.rateChangedCount ?? 0}</div>
                </div>
              </div>

              {/* Financials */}
              <Card>
                <CardHeader>
                  <CardTitle>Financials</CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-fg/40">
                        <th className="pb-1 text-left font-medium">Metric</th>
                        <th className="pb-1 text-right font-medium">Rev {comparison.base.revisionNumber}</th>
                        <th className="pb-1 text-right font-medium">Rev {comparison.head.revisionNumber}</th>
                        <th className="pb-1 text-right font-medium">Change</th>
                        <th className="pb-1 text-right font-medium">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.financials.map((row) => (
                        <tr key={row.key} className="border-t border-line/60">
                          <td className="py-1.5 text-fg/60">{row.label}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatValue(row.base, row.format)}</td>
                          <td className="py-1.5 text-right font-medium tabular-nums">
                            {formatValue(row.head, row.format)}
                          </td>
                          <td className="py-1.5 text-right">
                            <DeltaValue
                              delta={row.delta}
                              format={row.format}
                              higherIsBetter={!COST_LIKE_METRICS.has(row.key)}
                              className="justify-end"
                            />
                          </td>
                          <td className="py-1.5 text-right text-xs tabular-nums text-fg/50">
                            {row.percentDelta == null ? "--" : fmtPercent(row.percentDelta)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-fg/35">
                    Line movement: {fmtMoney(summary?.priceDelta ?? 0)} price, {fmtMoney(summary?.costDelta ?? 0)} cost,{" "}
                    {fmtNumber(summary?.hoursDelta ?? 0)} hrs. The subtotal can move further — factors, adjustments, and
                    markups apply on top.
                  </p>
                </CardContent>
              </Card>

              {/* Line item changes */}
              <div className="grid grid-cols-2 gap-4">
                <SectionCard title="Added lines" count={comparison.lineItems.added.length}>
                  {comparison.lineItems.added.length === 0 ? (
                    <EmptyState>No added lines</EmptyState>
                  ) : (
                    comparison.lineItems.added.map((item, index) => (
                      <ItemRow
                        key={`${item.key}-${index}`}
                        item={item}
                        trailing={
                          <span className="inline-flex items-center gap-0.5 font-medium tabular-nums text-success">
                            <Plus className="h-3 w-3" />
                            {fmtMoney(item.extendedPrice)}
                          </span>
                        }
                      />
                    ))
                  )}
                </SectionCard>

                <SectionCard title="Removed lines" count={comparison.lineItems.removed.length}>
                  {comparison.lineItems.removed.length === 0 ? (
                    <EmptyState>No removed lines</EmptyState>
                  ) : (
                    comparison.lineItems.removed.map((item, index) => (
                      <ItemRow
                        key={`${item.key}-${index}`}
                        item={item}
                        trailing={
                          <span className="inline-flex items-center gap-0.5 font-medium tabular-nums text-danger">
                            <Minus className="h-3 w-3" />
                            {fmtMoney(item.extendedPrice)}
                          </span>
                        }
                      />
                    ))
                  )}
                </SectionCard>
              </div>

              <SectionCard title="Changed lines" count={comparison.lineItems.changed.length}>
                {comparison.lineItems.changed.length === 0 ? (
                  <EmptyState>
                    No line changed. {comparison.lineItems.unchangedCount} line
                    {comparison.lineItems.unchangedCount === 1 ? "" : "s"} matched exactly.
                  </EmptyState>
                ) : (
                  comparison.lineItems.changed.map((change, index) => (
                    <div
                      key={`${change.key}-${index}`}
                      className="rounded border border-line bg-bg/30 px-3 py-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">
                            {change.entityName || change.description || "Untitled line"}
                          </div>
                          <div className="truncate text-[11px] text-fg/40">
                            {[change.worksheetName, change.category].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {change.changes.map((kind) => (
                            <Badge key={kind} tone={changeTone(kind)}>
                              {kind}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div className="mt-1.5 grid grid-cols-4 gap-2 text-[11px]">
                        <div>
                          <div className="text-fg/35">Qty</div>
                          <div className="tabular-nums">
                            {fmtNumber(change.base.quantity)} → {fmtNumber(change.head.quantity)} {change.uom}
                          </div>
                        </div>
                        <div>
                          <div className="text-fg/35">Unit price</div>
                          <div className="tabular-nums">
                            {fmtMoney(change.base.unitPrice)} → {fmtMoney(change.head.unitPrice)}
                          </div>
                        </div>
                        <div>
                          <div className="text-fg/35">Hours</div>
                          <div className="tabular-nums">
                            {fmtNumber(change.base.hours)} → {fmtNumber(change.head.hours)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-fg/35">Extended</div>
                          <DeltaValue delta={change.extendedPriceDelta} format="money" className="justify-end" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </SectionCard>

              {/* Structure changes */}
              <div className="grid grid-cols-2 gap-4">
                <SectionCard
                  title="Phases & worksheets"
                  count={
                    comparison.phases.added.length
                    + comparison.phases.removed.length
                    + comparison.phases.changed.length
                    + comparison.worksheets.added.length
                    + comparison.worksheets.removed.length
                  }
                >
                  {comparison.phases.added.length === 0
                  && comparison.phases.removed.length === 0
                  && comparison.phases.changed.length === 0
                  && comparison.worksheets.added.length === 0
                  && comparison.worksheets.removed.length === 0 ? (
                    <EmptyState>Same phases and worksheets</EmptyState>
                  ) : (
                    <>
                      {comparison.worksheets.added.map((name) => (
                        <div key={`ws-add-${name}`} className="flex items-center gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <Badge tone="success">worksheet added</Badge>
                          <span className="truncate">{name}</span>
                        </div>
                      ))}
                      {comparison.worksheets.removed.map((name) => (
                        <div key={`ws-del-${name}`} className="flex items-center gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <Badge tone="danger">worksheet removed</Badge>
                          <span className="truncate">{name}</span>
                        </div>
                      ))}
                      {comparison.phases.added.map((phase) => (
                        <div key={`ph-add-${phase.number}`} className="flex items-center gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <Badge tone="success">phase added</Badge>
                          <span className="truncate">
                            {phase.number} {phase.name}
                          </span>
                        </div>
                      ))}
                      {comparison.phases.removed.map((phase) => (
                        <div key={`ph-del-${phase.number}`} className="flex items-center gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <Badge tone="danger">phase removed</Badge>
                          <span className="truncate">
                            {phase.number} {phase.name}
                          </span>
                        </div>
                      ))}
                      {comparison.phases.changed.map((phase) => (
                        <div key={`ph-chg-${phase.number}`} className="flex items-center gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <Badge tone="info">phase {phase.changes.join(", ")}</Badge>
                          <span className="truncate">
                            {phase.base?.name} → {phase.head?.name}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </SectionCard>

                <SectionCard
                  title="Adjustments"
                  count={
                    comparison.adjustments.added.length
                    + comparison.adjustments.removed.length
                    + comparison.adjustments.changed.length
                  }
                >
                  {comparison.adjustments.added.length === 0
                  && comparison.adjustments.removed.length === 0
                  && comparison.adjustments.changed.length === 0 ? (
                    <EmptyState>Same adjustments</EmptyState>
                  ) : (
                    <>
                      {comparison.adjustments.added.map((entry) => (
                        <div key={`adj-add-${entry.name}`} className="flex items-center justify-between gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <span className="flex items-center gap-2">
                            <Badge tone="success">added</Badge>
                            <span className="truncate">{entry.name}</span>
                          </span>
                          <span className="tabular-nums text-fg/60">
                            {entry.percentage != null
                              ? fmtPercent(entry.percentage)
                              : entry.amount != null
                                ? fmtMoney(entry.amount)
                                : "--"}
                          </span>
                        </div>
                      ))}
                      {comparison.adjustments.removed.map((entry) => (
                        <div key={`adj-del-${entry.name}`} className="flex items-center justify-between gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <span className="flex items-center gap-2">
                            <Badge tone="danger">removed</Badge>
                            <span className="truncate">{entry.name}</span>
                          </span>
                          <span className="tabular-nums text-fg/60">
                            {entry.percentage != null
                              ? fmtPercent(entry.percentage)
                              : entry.amount != null
                                ? fmtMoney(entry.amount)
                                : "--"}
                          </span>
                        </div>
                      ))}
                      {comparison.adjustments.changed.map((entry) => (
                        <div key={`adj-chg-${entry.name}`} className="flex items-center justify-between gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-xs">
                          <span className="flex items-center gap-2">
                            <Badge tone="info">{entry.changes.join(", ")}</Badge>
                            <span className="truncate">{entry.name}</span>
                          </span>
                          <span className="tabular-nums text-fg/60">
                            {entry.base?.percentage != null || entry.head?.percentage != null
                              ? `${entry.base?.percentage != null ? fmtPercent(entry.base.percentage) : "--"} → ${
                                  entry.head?.percentage != null ? fmtPercent(entry.head.percentage) : "--"
                                }`
                              : `${entry.base?.amount != null ? fmtMoney(entry.base.amount) : "--"} → ${
                                  entry.head?.amount != null ? fmtMoney(entry.head.amount) : "--"
                                }`}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </SectionCard>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-line px-6 py-3">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

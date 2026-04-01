"use client";

import type { ProjectWorkspaceData } from "@/lib/api";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Helpers ─── */

function fmt(value: number | undefined | null): string {
  return (value ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtPct(value: number | undefined | null): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function fmtHours(value: number | undefined | null): string {
  return (value ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/* ─── Component ─── */

export interface TotalsBarProps {
  workspace: ProjectWorkspaceData;
}

export function TotalsBar({ workspace }: TotalsBarProps) {
  const rev = workspace.currentRevision;
  const totals = workspace.estimate?.totals ?? { subtotal: 0, cost: 0, estimatedProfit: 0, estimatedMargin: 0, breakout: [] };
  const breakout = totals.breakout ?? [];
  const { subtotal, cost, estimatedProfit, estimatedMargin } = totals;
  const { regHours, overHours, doubleHours } = rev;

  return (
    <div className="sticky bottom-0 z-30 border-t border-line bg-panel/95 backdrop-blur-md">
      <div className="grid grid-cols-[1fr_minmax(0,0.5fr)_minmax(0,0.5fr)] gap-px bg-line">
        {/* ── Left: Breakout Package List (50%) ── */}
        <div className="bg-panel px-5 py-3">
          {breakout.length > 0 ? (
            <div className="space-y-1">
              {breakout.map((entry, idx) => (
                <div
                  key={entry.entityId ?? idx}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex items-center gap-2 truncate text-fg/80">
                    <span className="truncate">{entry.name}</span>
                    {entry.type === "modifier" && (
                      <Badge tone="warning">Modifier</Badge>
                    )}
                    {entry.type === "option" && (
                      <Badge tone="info">Option</Badge>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-fg/60">
                    {fmt(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg/30">No breakout entries</p>
          )}
        </div>

        {/* ── Middle: Financial Metrics (25%) ── */}
        <div className="flex flex-col justify-center gap-2 bg-panel px-5 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[11px] font-medium uppercase tracking-wider text-fg/40">
              Cost
            </span>
            <span className="font-mono text-fg/70">{fmt(cost)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[11px] font-medium uppercase tracking-wider text-fg/40">
              Est. Margin
            </span>
            <span className="font-mono text-fg/70">{fmtPct(estimatedMargin)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[11px] font-medium uppercase tracking-wider text-fg/40">
              Est. Profit
            </span>
            <span
              className={cn(
                "font-mono",
                (estimatedProfit ?? 0) >= 0 ? "text-success" : "text-danger"
              )}
            >
              {fmt(estimatedProfit)}
            </span>
          </div>
        </div>

        {/* ── Right: Grand Totals (25%) ── */}
        <div className="flex flex-col justify-center gap-2 bg-panel px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-fg/40">
              Total
            </span>
            <span className="font-mono text-lg font-semibold text-fg">
              {fmt(subtotal)}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-fg/50">
            <span>
              <span className="font-medium text-fg/40">REG</span>{" "}
              <span className="font-mono">{fmtHours(regHours)}</span>
            </span>
            <span>
              <span className="font-medium text-fg/40">1.5X</span>{" "}
              <span className="font-mono">{fmtHours(overHours)}</span>
            </span>
            <span>
              <span className="font-medium text-fg/40">2X</span>{" "}
              <span className="font-mono">{fmtHours(doubleHours)}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

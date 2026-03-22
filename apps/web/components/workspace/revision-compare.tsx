"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GitCompareArrows,
  Minus,
  Plus,
  X,
} from "lucide-react";
import type {
  ProjectWorkspaceData,
  QuoteRevision,
  WorkspaceWorksheet,
  WorkspaceWorksheetItem,
  ProjectPhase,
  ProjectModifier,
} from "@/lib/api";
import {
  Button,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Select,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

interface RevisionCompareProps {
  workspace: ProjectWorkspaceData;
  open: boolean;
  onClose: () => void;
}

interface FinancialRow {
  label: string;
  valueA: number;
  valueB: number | null;
  format: "money" | "percent" | "number";
}

/* ─── Helpers ─── */

function fmtMoney(v: number) {
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPercent(v: number) {
  return (v * 100).toFixed(1) + "%";
}

function fmtNumber(v: number) {
  return v.toLocaleString("en-US");
}

function formatValue(v: number, format: "money" | "percent" | "number") {
  if (format === "money") return fmtMoney(v);
  if (format === "percent") return fmtPercent(v);
  return fmtNumber(v);
}

function DiffArrow({ diff }: { diff: number }) {
  if (diff === 0) return <span className="text-fg/30">--</span>;
  const positive = diff > 0;
  return (
    <span className={cn("flex items-center gap-0.5 text-xs font-medium", positive ? "text-emerald-400" : "text-red-400")}>
      {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(diff).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
    </span>
  );
}

/* ─── Main Component ─── */

export function RevisionCompare({ workspace, open, onClose }: RevisionCompareProps) {
  const [selectedRevisionB, setSelectedRevisionB] = useState<string>("");

  if (!open) return null;

  const rev = workspace.currentRevision;
  const phases = workspace.phases ?? [];
  const modifiers = workspace.modifiers ?? [];
  const worksheets = workspace.worksheets ?? [];
  const allItems = worksheets.flatMap((ws) => ws.items ?? []);

  // Financial metrics for Revision A (current)
  const financialRows: FinancialRow[] = [
    { label: "Subtotal", valueA: rev.subtotal, valueB: null, format: "money" },
    { label: "Cost", valueA: rev.cost, valueB: null, format: "money" },
    { label: "Profit", valueA: rev.estimatedProfit, valueB: null, format: "money" },
    { label: "Margin", valueA: rev.estimatedMargin, valueB: null, format: "percent" },
    { label: "Total Hours", valueA: rev.totalHours, valueB: null, format: "number" },
    { label: "Reg Hours", valueA: rev.regHours, valueB: null, format: "number" },
  ];

  const hasComparison = selectedRevisionB !== "";

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
              Rev {rev.revisionNumber} &mdash; {rev.title}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg/50">Revision B (Compare To)</label>
            <Select
              value={selectedRevisionB}
              onChange={(e) => setSelectedRevisionB(e.target.value)}
            >
              <option value="">Select a revision...</option>
              {/* In a full implementation, this would list all available revisions */}
              <option value="placeholder" disabled>
                (Load revisions from API)
              </option>
            </Select>
          </div>
        </div>

        {/* Content */}
        <div className="grid grid-cols-2 gap-4 p-6">
          {/* Left side - Current revision */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-fg/70">
              Rev {rev.revisionNumber}: {rev.title}
            </h3>

            {/* Financial summary */}
            <Card>
              <CardHeader>
                <CardTitle>Financials</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                {financialRows.map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <span className="text-fg/50">{row.label}</span>
                    <span className="font-medium tabular-nums">
                      {formatValue(row.valueA, row.format)}
                    </span>
                  </div>
                ))}
              </CardBody>
            </Card>

            {/* Phases */}
            <Card>
              <CardHeader>
                <CardTitle>Phases ({phases.length})</CardTitle>
              </CardHeader>
              <CardBody className="space-y-1">
                {phases.length === 0 ? (
                  <EmptyState>No phases</EmptyState>
                ) : (
                  phases.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded border border-line bg-bg/30 px-3 py-1.5 text-sm">
                      <Badge tone="default">{p.number}</Badge>
                      <span className="truncate">{p.name}</span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>

            {/* Line Items summary */}
            <Card>
              <CardHeader>
                <CardTitle>Line Items ({allItems.length})</CardTitle>
              </CardHeader>
              <CardBody className="space-y-1 max-h-60 overflow-y-auto">
                {allItems.length === 0 ? (
                  <EmptyState>No line items</EmptyState>
                ) : (
                  allItems.slice(0, 20).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between rounded border border-line bg-bg/30 px-3 py-1.5 text-xs"
                    >
                      <span className="truncate flex-1 mr-2">{item.entityName}</span>
                      <span className="tabular-nums text-fg/60">{fmtMoney(item.price)}</span>
                    </div>
                  ))
                )}
                {allItems.length > 20 && (
                  <p className="text-xs text-fg/40 text-center pt-1">
                    +{allItems.length - 20} more items
                  </p>
                )}
              </CardBody>
            </Card>

            {/* Modifiers */}
            <Card>
              <CardHeader>
                <CardTitle>Modifiers ({modifiers.length})</CardTitle>
              </CardHeader>
              <CardBody className="space-y-1">
                {modifiers.length === 0 ? (
                  <EmptyState>No modifiers</EmptyState>
                ) : (
                  modifiers.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded border border-line bg-bg/30 px-3 py-1.5 text-sm">
                      <span>{m.name}</span>
                      <span className="text-fg/60 tabular-nums">
                        {m.percentage != null ? fmtPercent(m.percentage) : m.amount != null ? fmtMoney(m.amount) : "--"}
                      </span>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          </div>

          {/* Right side - Comparison revision */}
          <div className="space-y-4">
            {hasComparison ? (
              <h3 className="text-sm font-semibold text-fg/70">Comparison Data</h3>
            ) : (
              <h3 className="text-sm font-semibold text-fg/70">Revision B</h3>
            )}

            {!hasComparison ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-panel2/30 px-6 py-20 text-center">
                <GitCompareArrows className="mb-3 h-10 w-10 text-fg/15" />
                <p className="text-sm font-medium text-fg/40">
                  Load a revision to compare
                </p>
                <p className="mt-1 text-xs text-fg/25">
                  Select a revision from the dropdown above to see a side-by-side diff of financials, line items, phases, and modifiers.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-line bg-panel2/30 px-6 py-20 text-center">
                <p className="text-sm font-medium text-fg/40">
                  Comparison data would load here via an API call.
                </p>
                <p className="mt-1 text-xs text-fg/25">
                  Financial diffs, added/removed line items, phase changes, and modifier changes will appear once revision data is fetched.
                </p>
              </div>
            )}
          </div>
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

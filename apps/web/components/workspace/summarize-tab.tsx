"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type {
  AdditionalLineItem,
  ProjectModifier,
  ProjectWorkspaceData,
  SummaryRowData,
  SummaryRowInput,
  SummaryRowType,
  SummaryRowStyle,
  SummaryPreset,
  WorkspaceResponse,
} from "@/lib/api";
import {
  applySummaryPreset,
  createAdditionalLineItem,
  createModifier,
  createSummaryRow,
  deleteAdditionalLineItem,
  deleteModifier,
  deleteSummaryRow,
  fetchQuotePdfBlobUrl,
  reorderSummaryRows,
  updateAdditionalLineItem,
  updateModifier,
  updateRevision,
  updateSummaryRow,
} from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  ModalBackdrop,
  Select,
  Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Constants ─── */

const SUMMARY_PRESETS: { id: SummaryPreset; label: string; description: string }[] = [
  { id: "by_category", label: "By Category", description: "One row per item category" },
  { id: "quick_total", label: "Quick Total", description: "Single grand total" },
  { id: "by_phase", label: "By Phase", description: "One row per project phase" },
  { id: "phase_x_category", label: "Phase × Category", description: "Phases with category detail" },
  { id: "custom", label: "Custom", description: "Start from scratch" },
];

const ROW_TYPE_LABELS: Record<SummaryRowType, string> = {
  auto_category: "Category",
  auto_phase: "Phase",
  manual: "Manual",
  modifier: "Modifier",
  subtotal: "Subtotal",
  separator: "Separator",
};

const ROW_TYPE_TONES: Record<SummaryRowType, "default" | "info" | "warning" | "success"> = {
  auto_category: "info",
  auto_phase: "info",
  manual: "default",
  modifier: "warning",
  subtotal: "success",
  separator: "default",
};

// Legacy constants kept for backward-compat modifier/ALI sections
const MODIFIER_TYPES = [
  "Contingency",
  "Surcharge",
  "Discount",
  "Fuel Surcharge",
  "Birla Surcharge",
  "Other",
] as const;

const MODIFIER_APPLIES = [
  "All",
  "Labour Only",
  "Materials Only",
  "Equipment Only",
] as const;

const ALI_TYPES = [
  "OptionStandalone",
  "OptionAdditional",
  "LineItemAdditional",
  "LineItemStandalone",
  "CustomTotal",
] as const;

const ALI_LABELS: Record<string, string> = {
  OptionStandalone: "Option",
  OptionAdditional: "Option Add",
  LineItemAdditional: "Line Item Add",
  LineItemStandalone: "Line Item",
  CustomTotal: "Custom Total",
};

function parseNum(v: string, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ─── Props ─── */

interface SummarizeTabProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
}

/* ─── Main Component ─── */

export function SummarizeTab({ workspace, onApply }: SummarizeTabProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const projectId = workspace.project.id;
  const revisionId = workspace.currentRevision.id;
  const summaryRows: SummaryRowData[] = (workspace as any).summaryRows ?? [];
  const hasSummaryRows = summaryRows.length > 0;

  // Legacy data
  const totals = workspace.estimate?.totals ?? {
    subtotal: 0,
    cost: 0,
    estimatedProfit: 0,
    estimatedMargin: 0,
    totalHours: 0,
    breakout: [],
  };

  /* ── PDF helpers ── */

  const loadPdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      const url = await fetchQuotePdfBlobUrl(projectId);
      setPdfBlobUrl(url);
    } catch {
      setError("Failed to load PDF preview.");
    } finally {
      setPdfLoading(false);
    }
  }, [projectId]);

  function openPdfModal() {
    setPdfModalOpen(true);
    if (!pdfBlobUrl) loadPdf();
  }

  function downloadPdf() {
    if (pdfBlobUrl) {
      const a = document.createElement("a");
      a.href = pdfBlobUrl;
      a.download = `${workspace.quote.quoteNumber ?? "quote"}.pdf`;
      a.click();
    } else {
      loadPdf();
    }
  }

  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  function handleError(e: unknown) {
    setError(e instanceof Error ? e.message : "Operation failed.");
  }

  function apply(next: WorkspaceResponse) {
    onApply(next);
    setError(null);
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl(null);
    }
  }

  /* ── Summary Row Actions ── */

  function handleApplyPreset(preset: SummaryPreset) {
    startTransition(async () => {
      try {
        apply(await applySummaryPreset(projectId, preset));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function handleAddRow(type: SummaryRowType) {
    setAddMenuOpen(false);
    const defaultLabels: Record<SummaryRowType, string> = {
      auto_category: "Category",
      auto_phase: "Phase",
      manual: "New Item",
      modifier: "New Modifier",
      subtotal: "Subtotal",
      separator: "───",
    };
    startTransition(async () => {
      try {
        apply(await createSummaryRow(projectId, { type, label: defaultLabels[type] }));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function handleUpdateRow(rowId: string, patch: SummaryRowInput) {
    startTransition(async () => {
      try {
        apply(await updateSummaryRow(projectId, rowId, patch));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function handleDeleteRow(rowId: string) {
    startTransition(async () => {
      try {
        apply(await deleteSummaryRow(projectId, rowId));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function handleMoveRow(rowId: string, direction: "up" | "down") {
    const idx = summaryRows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= summaryRows.length) return;

    const ids = summaryRows.map((r) => r.id);
    [ids[idx], ids[newIdx]] = [ids[newIdx], ids[idx]];

    startTransition(async () => {
      try {
        apply(await reorderSummaryRows(projectId, ids));
      } catch (e) {
        handleError(e);
      }
    });
  }

  /* ── Legacy Modifier CRUD ── */

  function addModifier() {
    startTransition(async () => {
      try {
        apply(
          await createModifier(projectId, {
            name: "New Modifier",
            type: "Contingency",
            appliesTo: "All",
            percentage: 0,
            amount: 0,
            show: "Yes",
          })
        );
      } catch (e) {
        handleError(e);
      }
    });
  }

  function patchModifier(id: string, patch: Partial<ProjectModifier>) {
    startTransition(async () => {
      try {
        apply(await updateModifier(projectId, id, patch));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function removeModifier(id: string) {
    startTransition(async () => {
      try {
        apply(await deleteModifier(projectId, id));
      } catch (e) {
        handleError(e);
      }
    });
  }

  /* ── Legacy ALI CRUD ── */

  function addAli() {
    startTransition(async () => {
      try {
        apply(
          await createAdditionalLineItem(projectId, {
            name: "New Line Item",
            description: "",
            type: "LineItemAdditional",
            amount: 0,
          })
        );
      } catch (e) {
        handleError(e);
      }
    });
  }

  function patchAli(id: string, patch: Partial<AdditionalLineItem>) {
    startTransition(async () => {
      try {
        apply(await updateAdditionalLineItem(projectId, id, patch));
      } catch (e) {
        handleError(e);
      }
    });
  }

  function removeAli(id: string) {
    startTransition(async () => {
      try {
        apply(await deleteAdditionalLineItem(projectId, id));
      } catch (e) {
        handleError(e);
      }
    });
  }

  /* ── Computed totals from summary rows ── */
  const summaryTotals = useMemo(() => {
    if (!hasSummaryRows) return null;
    let totalValue = 0;
    let totalCost = 0;
    for (const row of summaryRows) {
      if (!row.visible) continue;
      if (row.type === "separator") continue;
      // Only count top-level rows for grand total (skip modifiers, they're additive)
      totalValue += row.computedValue;
      totalCost += row.computedCost;
    }
    const profit = totalValue - totalCost;
    const margin = totalValue === 0 ? 0 : profit / totalValue;
    return { totalValue, totalCost, profit, margin };
  }, [summaryRows, hasSummaryRows]);

  return (
    <div className="flex flex-col h-full min-h-0 pb-1">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-4 shrink-0 pb-3">
        {/* Left: preset pills */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {SUMMARY_PRESETS.map((p) => (
            <button
              key={p.id}
              disabled={isPending}
              onClick={() => handleApplyPreset(p.id)}
              title={p.description}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                "bg-panel2 text-fg/60 hover:bg-panel2/80 hover:text-fg"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Add Row dropdown */}
          <div className="relative">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setAddMenuOpen(!addMenuOpen)}
              disabled={isPending}
            >
              <Plus className="h-3 w-3" />
              Add Row
              <ChevronDown className="h-3 w-3" />
            </Button>
            {addMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-panel border border-line rounded-lg shadow-lg py-1 min-w-[160px]">
                  {(
                    [
                      "auto_category",
                      "auto_phase",
                      "manual",
                      "modifier",
                      "subtotal",
                      "separator",
                    ] as SummaryRowType[]
                  ).map((type) => (
                    <button
                      key={type}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-panel2/60 transition-colors flex items-center gap-2"
                      onClick={() => handleAddRow(type)}
                    >
                      <Badge tone={ROW_TYPE_TONES[type]} className="text-[9px]">
                        {ROW_TYPE_LABELS[type]}
                      </Badge>
                      <span className="text-fg/60">{ROW_TYPE_LABELS[type]}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Legacy buttons */}
          {!hasSummaryRows && (
            <>
              <Button size="xs" variant="secondary" onClick={addModifier} disabled={isPending}>
                <Plus className="h-3 w-3" />
                Modifier
              </Button>
              <Button size="xs" variant="secondary" onClick={addAli} disabled={isPending}>
                <Plus className="h-3 w-3" />
                Line Item
              </Button>
            </>
          )}

          <Button size="xs" variant="ghost" onClick={openPdfModal}>
            <Eye className="h-3 w-3" />
            PDF Preview
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger mb-2 shrink-0">
          {error}
        </div>
      )}

      {/* ── Main table ── */}
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-line">
        {hasSummaryRows ? (
          /* ═══ New Summary Rows Table ═══ */
          <table className="w-full text-sm">
            <thead className="bg-panel2 text-[11px] font-medium uppercase text-fg/35 sticky top-0 z-10">
              <tr>
                <th className="border-b border-line px-2 py-2 w-8" />
                <th className="border-b border-line px-2 py-2 w-10" />
                <th className="border-b border-line px-4 py-2 text-left">Label</th>
                <th className="border-b border-line px-4 py-2 text-right w-28">Value</th>
                <th className="border-b border-line px-4 py-2 text-right w-28">Cost</th>
                <th className="border-b border-line px-4 py-2 text-right w-24">Margin $</th>
                <th className="border-b border-line px-4 py-2 text-right w-20">Margin %</th>
                <th className="border-b border-line px-4 py-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row, idx) => (
                <SummaryRowEditor
                  key={row.id}
                  row={row}
                  allRows={summaryRows}
                  disabled={isPending}
                  isFirst={idx === 0}
                  isLast={idx === summaryRows.length - 1}
                  onUpdate={(patch) => handleUpdateRow(row.id, patch)}
                  onDelete={() => handleDeleteRow(row.id)}
                  onMove={(dir) => handleMoveRow(row.id, dir)}
                />
              ))}
            </tbody>
            <tfoot className="bg-panel2 text-xs font-medium sticky bottom-0">
              <tr className="border-t border-line">
                <td className="px-2 py-2.5" />
                <td className="px-2 py-2.5" />
                <td className="px-4 py-2.5 text-fg/50">Grand Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                  {formatMoney(summaryTotals?.totalValue ?? 0)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatMoney(summaryTotals?.totalCost ?? 0)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span
                    className={cn(
                      "font-medium",
                      (summaryTotals?.profit ?? 0) >= 0 ? "text-success" : "text-danger"
                    )}
                  >
                    {formatMoney(summaryTotals?.profit ?? 0)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatPercent(summaryTotals?.margin ?? 0, 1)}
                </td>
                <td className="px-4 py-2.5" />
              </tr>
            </tfoot>
          </table>
        ) : (
          /* ═══ Legacy Breakout + Modifier + ALI Table ═══ */
          totals.breakout.length === 0 &&
          workspace.modifiers.length === 0 &&
          (workspace.additionalLineItems ?? []).length === 0 ? (
            <EmptyState className="m-8">
              No summary data. Use a preset above or add line items on the Estimate tab.
            </EmptyState>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-panel2 text-[11px] font-medium uppercase text-fg/35 sticky top-0 z-10">
                <tr>
                  <th className="border-b border-line px-4 py-2 text-left">Name</th>
                  <th className="border-b border-line px-4 py-2 text-right w-28">Value</th>
                  <th className="border-b border-line px-4 py-2 text-right w-28">Cost</th>
                  <th className="border-b border-line px-4 py-2 text-right w-24">Margin $</th>
                  <th className="border-b border-line px-4 py-2 text-right w-20">Margin %</th>
                  <th className="border-b border-line px-4 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {totals.breakout.map((row, idx) => (
                  <LegacyBreakoutRow key={`bo-${idx}`} row={row} />
                ))}

                {workspace.modifiers.length > 0 && (
                  <tr>
                    <td colSpan={6} className="border-t-2 border-line bg-panel2/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg/30">
                      Modifiers
                    </td>
                  </tr>
                )}
                {workspace.modifiers.map((mod) => (
                  <LegacyModifierRow
                    key={mod.id}
                    mod={mod}
                    disabled={isPending}
                    onPatch={(patch) => patchModifier(mod.id, patch)}
                    onDelete={() => removeModifier(mod.id)}
                  />
                ))}

                {(workspace.additionalLineItems ?? []).length > 0 && (
                  <tr>
                    <td colSpan={6} className="border-t-2 border-line bg-panel2/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg/30">
                      Additional Line Items
                    </td>
                  </tr>
                )}
                {(workspace.additionalLineItems ?? []).map((ali) => (
                  <LegacyAliRow
                    key={ali.id}
                    ali={ali}
                    disabled={isPending}
                    onPatch={(patch) => patchAli(ali.id, patch)}
                    onDelete={() => removeAli(ali.id)}
                  />
                ))}
              </tbody>
              <tfoot className="bg-panel2 text-xs font-medium sticky bottom-0">
                <tr className="border-t border-line">
                  <td className="px-4 py-2.5 text-fg/50">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                    {formatMoney(totals.subtotal)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatMoney(totals.cost)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={cn("font-medium", totals.estimatedProfit >= 0 ? "text-success" : "text-danger")}>
                      {formatMoney(totals.estimatedProfit)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatPercent(totals.estimatedMargin, 1)}
                  </td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          )
        )}
      </div>

      {/* ── PDF Preview Modal ── */}
      <ModalBackdrop open={pdfModalOpen} onClose={() => setPdfModalOpen(false)} size="xl">
        <Card className="flex h-[90vh] w-full flex-col shadow-xl">
          <CardHeader className="flex shrink-0 items-center justify-between border-b border-line">
            <CardTitle>PDF Preview</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="secondary" onClick={downloadPdf}>
                <Download className="h-3 w-3" />
                Download
              </Button>
              <button
                type="button"
                onClick={() => setPdfModalOpen(false)}
                className="rounded-md p-1 text-fg/40 hover:text-fg transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>
          <CardBody className="flex-1 overflow-hidden p-0">
            {pdfLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-fg/40">
                Loading PDF...
              </div>
            ) : pdfBlobUrl ? (
              <iframe
                src={pdfBlobUrl}
                className="h-full w-full border-0 bg-white"
                title="PDF Full Preview"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-fg/40">
                Failed to load PDF.
              </div>
            )}
          </CardBody>
        </Card>
      </ModalBackdrop>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Summary Row Editor (inline-editable)
   ═══════════════════════════════════════════════════════════════════════════ */

function SummaryRowEditor({
  row,
  allRows,
  disabled,
  isFirst,
  isLast,
  onUpdate,
  onDelete,
  onMove,
}: {
  row: SummaryRowData;
  allRows: SummaryRowData[];
  disabled: boolean;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: SummaryRowInput) => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
}) {
  const isSeparator = row.type === "separator";
  const isAutoRow = row.type === "auto_category" || row.type === "auto_phase";
  const isManualOrModifier = row.type === "manual" || row.type === "modifier";
  const marginDollars = row.computedValue - row.computedCost;

  if (isSeparator) {
    return (
      <tr className="border-b border-line/30 bg-panel2/20">
        <td className="px-2 py-1">
          <div className="flex flex-col gap-0.5">
            <button disabled={disabled || isFirst} onClick={() => onMove("up")} className="text-fg/20 hover:text-fg/60 disabled:opacity-30">
              <ArrowUp className="h-3 w-3" />
            </button>
            <button disabled={disabled || isLast} onClick={() => onMove("down")} className="text-fg/20 hover:text-fg/60 disabled:opacity-30">
              <ArrowDown className="h-3 w-3" />
            </button>
          </div>
        </td>
        <td className="px-2 py-1">
          <Badge tone="default" className="text-[9px]">Sep</Badge>
        </td>
        <td colSpan={5} className="px-4 py-1">
          <div className="border-t border-line/40" />
        </td>
        <td className="px-2 py-1 text-center">
          <button onClick={onDelete} disabled={disabled} className="rounded p-1 text-fg/25 hover:text-danger transition-colors">
            <Trash2 className="h-3 w-3" />
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr
      className={cn(
        "border-b border-line/50 hover:bg-panel2/30",
        !row.visible && "opacity-40",
        row.style === "bold" && "font-semibold",
        row.style === "indent" && "pl-4",
      )}
    >
      {/* Move arrows */}
      <td className="px-2 py-1.5">
        <div className="flex flex-col gap-0.5">
          <button disabled={disabled || isFirst} onClick={() => onMove("up")} className="text-fg/20 hover:text-fg/60 disabled:opacity-30">
            <ArrowUp className="h-3 w-3" />
          </button>
          <button disabled={disabled || isLast} onClick={() => onMove("down")} className="text-fg/20 hover:text-fg/60 disabled:opacity-30">
            <ArrowDown className="h-3 w-3" />
          </button>
        </div>
      </td>

      {/* Type badge */}
      <td className="px-2 py-1.5">
        <Badge tone={ROW_TYPE_TONES[row.type]} className="text-[9px]">
          {ROW_TYPE_LABELS[row.type]}
        </Badge>
      </td>

      {/* Label + config */}
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-2">
          <Input
            className="h-7 flex-1 min-w-[100px] text-xs"
            value={row.label}
            disabled={disabled}
            onChange={(e) => onUpdate({ label: e.target.value })}
            onBlur={(e) => onUpdate({ label: e.target.value })}
          />

          {/* Auto-category: source selector */}
          {row.type === "auto_category" && (
            <Input
              className="h-7 w-32 text-xs"
              placeholder="Category name"
              value={row.sourceCategory ?? ""}
              disabled={disabled}
              onChange={(e) => onUpdate({ sourceCategory: e.target.value || null })}
              onBlur={(e) => onUpdate({ sourceCategory: e.target.value || null })}
            />
          )}

          {/* Auto-phase: source selector */}
          {row.type === "auto_phase" && (
            <Input
              className="h-7 w-32 text-xs"
              placeholder="Phase name"
              value={row.sourcePhase ?? ""}
              disabled={disabled}
              onChange={(e) => onUpdate({ sourcePhase: e.target.value || null })}
              onBlur={(e) => onUpdate({ sourcePhase: e.target.value || null })}
            />
          )}

          {/* Modifier: percent + applies to */}
          {row.type === "modifier" && (
            <>
              <div className="flex items-center gap-0.5">
                <Input
                  className="h-7 w-16 text-right text-xs"
                  type="number"
                  step="0.1"
                  placeholder="%"
                  value={row.modifierPercent ?? ""}
                  disabled={disabled}
                  onChange={(e) => onUpdate({ modifierPercent: e.target.value === "" ? null : parseNum(e.target.value) })}
                />
                <span className="text-[10px] text-fg/30">%</span>
              </div>
              <Select
                className="h-7 text-xs w-auto"
                value={row.appliesTo.length === 0 || (row.appliesTo.length === 1 && row.appliesTo[0] === "all") ? "all" : "specific"}
                disabled={disabled}
                onChange={(e) => {
                  if (e.target.value === "all") {
                    onUpdate({ appliesTo: ["all"] });
                  }
                  // "specific" just keeps current — user edits via multi-select in future
                }}
              >
                <option value="all">All Rows</option>
                {allRows
                  .filter((r) => r.id !== row.id && r.type !== "modifier" && r.type !== "separator" && r.type !== "subtotal")
                  .map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
              </Select>
            </>
          )}

          {/* Visibility toggle */}
          <button
            onClick={() => onUpdate({ visible: !row.visible })}
            disabled={disabled}
            className="text-fg/25 hover:text-fg/60 transition-colors"
            title={row.visible ? "Visible on PDF" : "Hidden from PDF"}
          >
            {row.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
        </div>
      </td>

      {/* Value */}
      <td className="px-4 py-1.5">
        {row.type === "manual" ? (
          <div className="flex items-center justify-end gap-0.5">
            <span className="text-[10px] text-fg/30">$</span>
            <Input
              className="h-7 w-24 text-right text-xs"
              type="number"
              step="0.01"
              value={row.manualValue ?? ""}
              disabled={disabled}
              onChange={(e) => onUpdate({ manualValue: e.target.value === "" ? null : parseNum(e.target.value) })}
            />
          </div>
        ) : row.type === "modifier" ? (
          <div className="flex items-center justify-end gap-0.5">
            <span className="text-[10px] text-fg/30">$</span>
            <Input
              className="h-7 w-24 text-right text-xs"
              type="number"
              step="0.01"
              value={row.modifierAmount ?? ""}
              disabled={disabled}
              onChange={(e) => onUpdate({ modifierAmount: e.target.value === "" ? null : parseNum(e.target.value) })}
            />
          </div>
        ) : isAutoRow ? (
          <AutoValueCell
            value={row.computedValue}
            override={row.overrideValue}
            disabled={disabled}
            onOverride={(v) => onUpdate({ overrideValue: v })}
          />
        ) : (
          <span className="block text-right tabular-nums">{formatMoney(row.computedValue)}</span>
        )}
      </td>

      {/* Cost */}
      <td className="px-4 py-1.5">
        {row.type === "manual" ? (
          <div className="flex items-center justify-end gap-0.5">
            <span className="text-[10px] text-fg/30">$</span>
            <Input
              className="h-7 w-24 text-right text-xs"
              type="number"
              step="0.01"
              value={row.manualCost ?? ""}
              disabled={disabled}
              onChange={(e) => onUpdate({ manualCost: e.target.value === "" ? null : parseNum(e.target.value) })}
            />
          </div>
        ) : isAutoRow ? (
          <AutoValueCell
            value={row.computedCost}
            override={row.overrideCost}
            disabled={disabled}
            onOverride={(v) => onUpdate({ overrideCost: v })}
          />
        ) : (
          <span className="block text-right tabular-nums">{formatMoney(row.computedCost)}</span>
        )}
      </td>

      {/* Margin $ */}
      <td className="px-4 py-1.5 text-right tabular-nums">{formatMoney(marginDollars)}</td>

      {/* Margin % */}
      <td className="px-4 py-1.5 text-right tabular-nums">{formatPercent(row.computedMargin, 1)}</td>

      {/* Delete */}
      <td className="px-2 py-1.5 text-center">
        <button onClick={onDelete} disabled={disabled} className="rounded p-1 text-fg/25 hover:text-danger transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Auto Value Cell — click to override, clear to go back to auto
   ═══════════════════════════════════════════════════════════════════════════ */

function AutoValueCell({
  value,
  override,
  disabled,
  onOverride,
}: {
  value: number;
  override?: number | null;
  disabled: boolean;
  onOverride: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasOverride = override != null;

  if (editing || hasOverride) {
    return (
      <div className="flex items-center justify-end gap-0.5">
        <span className="text-[10px] text-fg/30">$</span>
        <Input
          className={cn("h-7 w-24 text-right text-xs", hasOverride && "border-warning/50")}
          type="number"
          step="0.01"
          value={override ?? value}
          disabled={disabled}
          autoFocus={editing && !hasOverride}
          onChange={(e) => onOverride(e.target.value === "" ? null : parseNum(e.target.value))}
          onBlur={() => setEditing(false)}
        />
        {hasOverride && (
          <button
            onClick={() => onOverride(null)}
            disabled={disabled}
            className="text-[9px] text-warning hover:text-warning/80 ml-0.5"
            title="Clear override — return to auto-calculated value"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <span
      className="block text-right tabular-nums cursor-pointer hover:text-accent transition-colors"
      onClick={() => !disabled && setEditing(true)}
      title="Click to override"
    >
      {formatMoney(value)}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Legacy Components (kept for backward compatibility when no summary rows)
   ═══════════════════════════════════════════════════════════════════════════ */

function LegacyBreakoutRow({
  row,
}: {
  row: ProjectWorkspaceData["estimate"]["totals"]["breakout"][number];
}) {
  const marginDollars = row.value - row.cost;
  const isModifier = row.type === "modifier";
  const isOption = row.type === "option";

  return (
    <tr className={cn("border-b border-line/50 hover:bg-panel2/30", (isModifier || isOption) && "bg-panel2/10")}>
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          {row.name}
          {isModifier && <Badge tone="warning">Modifier</Badge>}
          {isOption && <Badge tone="info">Option</Badge>}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.value)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.cost)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(marginDollars)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatPercent(row.margin, 1)}</td>
      <td className="px-4 py-2" />
    </tr>
  );
}

function LegacyModifierRow({
  mod,
  disabled,
  onPatch,
  onDelete,
}: {
  mod: ProjectModifier;
  disabled: boolean;
  onPatch: (patch: Partial<ProjectModifier>) => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b border-line/40 bg-warning/[0.03] hover:bg-warning/[0.06]">
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-2">
          <Badge tone="warning">Mod</Badge>
          <Input className="h-7 w-36 text-xs" value={mod.name} disabled={disabled} onChange={(e) => onPatch({ name: e.target.value })} onBlur={(e) => onPatch({ name: e.target.value })} />
          <Select className="h-7 text-xs w-auto" value={mod.type} disabled={disabled} onChange={(e) => onPatch({ type: e.target.value })}>
            {MODIFIER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select className="h-7 text-xs w-auto" value={mod.appliesTo} disabled={disabled} onChange={(e) => onPatch({ appliesTo: e.target.value })}>
            {MODIFIER_APPLIES.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Toggle checked={mod.show === "Yes"} onChange={(checked) => onPatch({ show: checked ? "Yes" : "No" })} />
          <span className="text-[10px] text-fg/30">Show</span>
        </div>
      </td>
      <td className="px-4 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <Input className="h-7 w-16 text-right text-xs" type="number" step="0.1" value={mod.percentage ?? ""} disabled={disabled} onChange={(e) => onPatch({ percentage: e.target.value === "" ? null : parseNum(e.target.value) })} />
          <span className="text-[10px] text-fg/30">%</span>
        </div>
      </td>
      <td className="px-4 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <span className="text-[10px] text-fg/30">$</span>
          <Input className="h-7 w-20 text-right text-xs" type="number" step="0.01" value={mod.amount ?? ""} disabled={disabled} onChange={(e) => onPatch({ amount: e.target.value === "" ? null : parseNum(e.target.value) })} />
        </div>
      </td>
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5 text-center">
        <button type="button" onClick={onDelete} disabled={disabled} className="rounded p-1 text-fg/25 hover:text-danger transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}

function LegacyAliRow({
  ali,
  disabled,
  onPatch,
  onDelete,
}: {
  ali: AdditionalLineItem;
  disabled: boolean;
  onPatch: (patch: Partial<AdditionalLineItem>) => void;
  onDelete: () => void;
}) {
  const isOption = ali.type.startsWith("Option");

  return (
    <tr className="border-b border-line/40 bg-info/[0.03] hover:bg-info/[0.06]">
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-2">
          <Badge tone={isOption ? "info" : "default"}>{ALI_LABELS[ali.type] ?? ali.type}</Badge>
          <Select className="h-7 text-xs w-auto" value={ali.type} disabled={disabled} onChange={(e) => onPatch({ type: e.target.value as AdditionalLineItem["type"] })}>
            {ALI_TYPES.map((t) => <option key={t} value={t}>{ALI_LABELS[t]}</option>)}
          </Select>
          <Input className="h-7 flex-1 min-w-[120px] text-xs" value={ali.name} disabled={disabled} onChange={(e) => onPatch({ name: e.target.value })} onBlur={(e) => onPatch({ name: e.target.value })} />
        </div>
      </td>
      <td className="px-4 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <span className="text-[10px] text-fg/30">$</span>
          <Input className="h-7 w-24 text-right text-xs" type="number" step="0.01" value={ali.amount} disabled={disabled} onChange={(e) => onPatch({ amount: parseNum(e.target.value) })} />
        </div>
      </td>
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5 text-center">
        <button type="button" onClick={onDelete} disabled={disabled} className="rounded p-1 text-fg/25 hover:text-danger transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}

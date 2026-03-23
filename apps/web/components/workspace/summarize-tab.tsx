"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  Download,
  Eye,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type {
  AdditionalLineItem,
  ProjectModifier,
  ProjectWorkspaceData,
  WorkspaceResponse,
} from "@/lib/api";
import {
  createAdditionalLineItem,
  createModifier,
  deleteAdditionalLineItem,
  deleteModifier,
  fetchQuotePdfBlobUrl,
  updateAdditionalLineItem,
  updateModifier,
  updateRevision,
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

type BreakoutStyle = "grand_total" | "category" | "phase" | "phase_detail" | "labour_material_equipment";

const BREAKOUT_STYLES: { id: BreakoutStyle; label: string }[] = [
  { id: "labour_material_equipment", label: "Labour / Material / Equipment" },
  { id: "grand_total", label: "Grand Total" },
  { id: "phase", label: "Phases" },
  { id: "phase_detail", label: "Phase Detail" },
  { id: "category", label: "Category" },
];

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

  const projectId = workspace.project.id;
  const revisionId = workspace.currentRevision.id;
  const rev = workspace.currentRevision;
  const breakoutStyle = rev.breakoutStyle as BreakoutStyle;
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

  /* ── Breakout style ── */

  function changeBreakoutStyle(style: BreakoutStyle) {
    startTransition(async () => {
      try {
        apply(await updateRevision(projectId, revisionId, { breakoutStyle: style }));
      } catch (e) {
        handleError(e);
      }
    });
  }

  /* ── Modifier CRUD ── */

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

  /* ── ALI CRUD ── */

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

  /* ── Phase detail: collect unique category names for column headers ── */

  const phaseDetailCategories = useMemo(() => {
    if (breakoutStyle !== "phase_detail") return [];
    const names = new Set<string>();
    for (const entry of totals.breakout) {
      if (entry.category) {
        for (const cat of entry.category) {
          names.add(cat.name);
        }
      }
    }
    return Array.from(names).sort();
  }, [breakoutStyle, totals.breakout]);

  const isPhaseDetail = breakoutStyle === "phase_detail";

  return (
    <div className="flex flex-col h-full min-h-0 pb-1">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-4 shrink-0 pb-3">
        {/* Left: breakout style pills */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {BREAKOUT_STYLES.map((s) => (
            <button
              key={s.id}
              disabled={isPending}
              onClick={() => changeBreakoutStyle(s.id)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                breakoutStyle === s.id
                  ? "bg-accent text-accent-fg"
                  : "bg-panel2 text-fg/60 hover:bg-panel2/80 hover:text-fg"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          <Button size="xs" variant="secondary" onClick={addModifier} disabled={isPending}>
            <Plus className="h-3 w-3" />
            Modifier
          </Button>
          <Button size="xs" variant="secondary" onClick={addAli} disabled={isPending}>
            <Plus className="h-3 w-3" />
            Line Item
          </Button>
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
        {totals.breakout.length === 0 &&
          workspace.modifiers.length === 0 &&
          (workspace.additionalLineItems ?? []).length === 0 ? (
          <EmptyState className="m-8">
            No breakout data. Add line items on the Estimate tab first.
          </EmptyState>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-panel2/60 text-[11px] font-medium uppercase text-fg/35 sticky top-0 z-10">
              <tr>
                <th className="border-b border-line px-4 py-2 text-left">Name</th>
                {isPhaseDetail &&
                  phaseDetailCategories.map((cat) => (
                    <th key={cat} className="border-b border-line px-3 py-2 text-right w-24">
                      {cat}
                    </th>
                  ))}
                <th className="border-b border-line px-4 py-2 text-right w-28">Value</th>
                <th className="border-b border-line px-4 py-2 text-right w-28">Cost</th>
                <th className="border-b border-line px-4 py-2 text-right w-24">Margin $</th>
                <th className="border-b border-line px-4 py-2 text-right w-20">Margin %</th>
                <th className="border-b border-line px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {/* ── Breakout entries ── */}
              {totals.breakout.map((row, idx) => (
                <BreakoutRow
                  key={`bo-${idx}`}
                  row={row}
                  isPhaseDetail={isPhaseDetail}
                  categoryColumns={phaseDetailCategories}
                />
              ))}

              {/* ── Modifiers section ── */}
              {workspace.modifiers.length > 0 && (
                <tr>
                  <td
                    colSpan={isPhaseDetail ? 6 + phaseDetailCategories.length : 6}
                    className="border-t-2 border-line bg-panel2/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg/30"
                  >
                    Modifiers
                  </td>
                </tr>
              )}
              {workspace.modifiers.map((mod) => (
                <ModifierRow
                  key={mod.id}
                  mod={mod}
                  disabled={isPending}
                  onPatch={(patch) => patchModifier(mod.id, patch)}
                  onDelete={() => removeModifier(mod.id)}
                  extraCols={isPhaseDetail ? phaseDetailCategories.length : 0}
                />
              ))}

              {/* ── Additional line items section ── */}
              {(workspace.additionalLineItems ?? []).length > 0 && (
                <tr>
                  <td
                    colSpan={isPhaseDetail ? 6 + phaseDetailCategories.length : 6}
                    className="border-t-2 border-line bg-panel2/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-fg/30"
                  >
                    Additional Line Items
                  </td>
                </tr>
              )}
              {(workspace.additionalLineItems ?? []).map((ali) => (
                <AliRow
                  key={ali.id}
                  ali={ali}
                  disabled={isPending}
                  onPatch={(patch) => patchAli(ali.id, patch)}
                  onDelete={() => removeAli(ali.id)}
                  extraCols={isPhaseDetail ? phaseDetailCategories.length : 0}
                />
              ))}
            </tbody>

            {/* ── Totals footer ── */}
            <tfoot className="bg-panel2/40 text-xs font-medium sticky bottom-0">
              <tr className="border-t border-line">
                <td className="px-4 py-2.5 text-fg/50">Total</td>
                {isPhaseDetail &&
                  phaseDetailCategories.map((cat) => {
                    const catTotal = totals.breakout.reduce((sum, entry) => {
                      const c = entry.category?.find((c) => c.name === cat);
                      return sum + (c?.value ?? 0);
                    }, 0);
                    return (
                      <td key={cat} className="px-3 py-2.5 text-right tabular-nums text-fg/50">
                        {formatMoney(catTotal)}
                      </td>
                    );
                  })}
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                  {formatMoney(totals.subtotal)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatMoney(totals.cost)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span
                    className={cn(
                      "font-medium",
                      totals.estimatedProfit >= 0 ? "text-success" : "text-danger"
                    )}
                  >
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
        )}
      </div>

      {/* ── PDF Preview Modal ── */}
      <ModalBackdrop
        open={pdfModalOpen}
        onClose={() => setPdfModalOpen(false)}
        size="xl"
      >
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
   Breakout Row
   ═══════════════════════════════════════════════════════════════════════════ */

function BreakoutRow({
  row,
  isPhaseDetail,
  categoryColumns,
}: {
  row: ProjectWorkspaceData["estimate"]["totals"]["breakout"][number];
  isPhaseDetail: boolean;
  categoryColumns: string[];
}) {
  const marginDollars = row.value - row.cost;
  const isModifier = row.type === "modifier";
  const isOption = row.type === "option";

  // Build a lookup for category values when in phase_detail mode
  const catMap = useMemo(() => {
    if (!isPhaseDetail || !row.category) return new Map<string, number>();
    return new Map(row.category.map((c) => [c.name, c.value]));
  }, [isPhaseDetail, row.category]);

  return (
    <tr
      className={cn(
        "border-b border-line/50 hover:bg-panel2/30",
        (isModifier || isOption) && "bg-panel2/10"
      )}
    >
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          {row.name}
          {isModifier && <Badge tone="warning">Modifier</Badge>}
          {isOption && <Badge tone="info">Option</Badge>}
        </span>
      </td>
      {isPhaseDetail &&
        categoryColumns.map((cat) => (
          <td key={cat} className="px-3 py-2 text-right tabular-nums text-xs text-fg/60">
            {catMap.get(cat) ? formatMoney(catMap.get(cat)!) : "—"}
          </td>
        ))}
      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.value)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.cost)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatMoney(marginDollars)}</td>
      <td className="px-4 py-2 text-right tabular-nums">{formatPercent(row.margin, 1)}</td>
      <td className="px-4 py-2" />
    </tr>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Modifier Row (inline-editable)
   ═══════════════════════════════════════════════════════════════════════════ */

function ModifierRow({
  mod,
  disabled,
  onPatch,
  onDelete,
  extraCols,
}: {
  mod: ProjectModifier;
  disabled: boolean;
  onPatch: (patch: Partial<ProjectModifier>) => void;
  onDelete: () => void;
  extraCols: number;
}) {
  return (
    <tr className="border-b border-line/40 bg-warning/[0.03] hover:bg-warning/[0.06]">
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-2">
          <Badge tone="warning">Mod</Badge>
          <Input
            className="h-7 w-36 text-xs"
            value={mod.name}
            disabled={disabled}
            onChange={(e) => onPatch({ name: e.target.value })}
            onBlur={(e) => onPatch({ name: e.target.value })}
          />
          <Select
            className="h-7 text-xs w-auto"
            value={mod.type}
            disabled={disabled}
            onChange={(e) => onPatch({ type: e.target.value })}
          >
            {MODIFIER_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
          <Select
            className="h-7 text-xs w-auto"
            value={mod.appliesTo}
            disabled={disabled}
            onChange={(e) => onPatch({ appliesTo: e.target.value })}
          >
            {MODIFIER_APPLIES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
          <Toggle
            checked={mod.show === "Yes"}
            onChange={(checked) => onPatch({ show: checked ? "Yes" : "No" })}
          />
          <span className="text-[10px] text-fg/30">Show</span>
        </div>
      </td>
      {/* Empty cells for category columns */}
      {Array.from({ length: extraCols }).map((_, i) => (
        <td key={i} className="px-3 py-1.5" />
      ))}
      {/* Percentage */}
      <td className="px-4 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <Input
            className="h-7 w-16 text-right text-xs"
            type="number"
            step="0.1"
            value={mod.percentage ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onPatch({ percentage: e.target.value === "" ? null : parseNum(e.target.value) })
            }
          />
          <span className="text-[10px] text-fg/30">%</span>
        </div>
      </td>
      {/* Amount */}
      <td className="px-4 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <span className="text-[10px] text-fg/30">$</span>
          <Input
            className="h-7 w-20 text-right text-xs"
            type="number"
            step="0.01"
            value={mod.amount ?? ""}
            disabled={disabled}
            onChange={(e) =>
              onPatch({ amount: e.target.value === "" ? null : parseNum(e.target.value) })
            }
          />
        </div>
      </td>
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5 text-center">
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="rounded p-1 text-fg/25 hover:text-danger transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Additional Line Item Row (inline-editable)
   ═══════════════════════════════════════════════════════════════════════════ */

function AliRow({
  ali,
  disabled,
  onPatch,
  onDelete,
  extraCols,
}: {
  ali: AdditionalLineItem;
  disabled: boolean;
  onPatch: (patch: Partial<AdditionalLineItem>) => void;
  onDelete: () => void;
  extraCols: number;
}) {
  const isOption = ali.type.startsWith("Option");

  return (
    <tr className="border-b border-line/40 bg-info/[0.03] hover:bg-info/[0.06]">
      <td className="px-4 py-1.5">
        <div className="flex items-center gap-2">
          <Badge tone={isOption ? "info" : "default"}>
            {ALI_LABELS[ali.type] ?? ali.type}
          </Badge>
          <Select
            className="h-7 text-xs w-auto"
            value={ali.type}
            disabled={disabled}
            onChange={(e) =>
              onPatch({ type: e.target.value as AdditionalLineItem["type"] })
            }
          >
            {ALI_TYPES.map((t) => (
              <option key={t} value={t}>{ALI_LABELS[t]}</option>
            ))}
          </Select>
          <Input
            className="h-7 flex-1 min-w-[120px] text-xs"
            value={ali.name}
            disabled={disabled}
            onChange={(e) => onPatch({ name: e.target.value })}
            onBlur={(e) => onPatch({ name: e.target.value })}
          />
        </div>
      </td>
      {/* Empty cells for category columns */}
      {Array.from({ length: extraCols }).map((_, i) => (
        <td key={i} className="px-3 py-1.5" />
      ))}
      {/* Amount */}
      <td className="px-4 py-1.5">
        <div className="flex items-center justify-end gap-0.5">
          <span className="text-[10px] text-fg/30">$</span>
          <Input
            className="h-7 w-24 text-right text-xs"
            type="number"
            step="0.01"
            value={ali.amount}
            disabled={disabled}
            onChange={(e) => onPatch({ amount: parseNum(e.target.value) })}
          />
        </div>
      </td>
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5" />
      <td className="px-4 py-1.5 text-center">
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          className="rounded p-1 text-fg/25 hover:text-danger transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </td>
    </tr>
  );
}

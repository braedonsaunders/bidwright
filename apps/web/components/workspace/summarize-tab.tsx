"use client";

import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  AdjustmentPricingMode,
  CreateAdjustmentInput,
  ProjectAdjustment,
  ProjectWorkspaceData,
  SummaryPreset,
  SummaryRowData,
  SummaryRowInput,
  SummaryRowStyle,
  SummaryRowType,
  WorkspaceResponse,
} from "@/lib/api";
import {
  applySummaryPreset,
  createAdjustment,
  createSummaryRow,
  deleteAdjustment,
  deleteSummaryRow,
  reorderSummaryRows,
  updateAdjustment,
  updateSummaryRow,
} from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  Badge,
  Button,
  Input,
  Select,
  Toggle,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const SUMMARY_PRESETS: Array<{ id: SummaryPreset; label: string; description: string }> = [
  { id: "by_category", label: "By Category", description: "Category totals plus adjustments" },
  { id: "quick_total", label: "Quick Total", description: "Single grand total row" },
  { id: "by_phase", label: "By Phase", description: "Phase totals plus adjustments" },
  { id: "phase_x_category", label: "Phase x Category", description: "Phases with category detail" },
  { id: "custom", label: "Custom", description: "Saved manual layout" },
];

const ROW_TYPE_LABELS: Record<SummaryRowType, string> = {
  category: "Category",
  phase: "Phase",
  adjustment: "Adjustment",
  heading: "Heading",
  separator: "Separator",
  subtotal: "Subtotal",
};

const ROW_TYPE_TONES: Record<SummaryRowType, "default" | "info" | "warning" | "success"> = {
  category: "info",
  phase: "info",
  adjustment: "warning",
  heading: "default",
  separator: "default",
  subtotal: "success",
};

const STYLE_OPTIONS: SummaryRowStyle[] = ["normal", "bold", "indent", "highlight"];
const ROW_ADD_OPTIONS: SummaryRowType[] = ["heading", "category", "phase", "adjustment", "subtotal", "separator"];

const ADJUSTMENT_MODE_OPTIONS: Array<{ id: AdjustmentPricingMode; label: string }> = [
  { id: "modifier", label: "Percent Modifier" },
  { id: "line_item_additional", label: "Additional Line Item" },
  { id: "option_additional", label: "Optional Add" },
  { id: "option_standalone", label: "Optional Standalone" },
  { id: "line_item_standalone", label: "Standalone Line Item" },
  { id: "custom_total", label: "Custom Total" },
];

const ADJUSTMENT_TEMPLATES: Array<{ id: string; label: string; build: () => CreateAdjustmentInput }> = [
  {
    id: "modifier",
    label: "Percent Modifier",
    build: () => ({
      kind: "modifier",
      pricingMode: "modifier",
      name: "New Adjustment",
      type: "Contingency",
      appliesTo: "All",
      percentage: 0,
      amount: null,
      show: "Yes",
    }),
  },
  {
    id: "line_item_additional",
    label: "Additional Line Item",
    build: () => ({
      kind: "line_item",
      pricingMode: "line_item_additional",
      name: "New Line Item",
      description: "",
      type: "LineItemAdditional",
      amount: 0,
      show: "Yes",
    }),
  },
  {
    id: "option_additional",
    label: "Optional Add",
    build: () => ({
      kind: "line_item",
      pricingMode: "option_additional",
      name: "New Optional Add",
      description: "",
      type: "OptionAdditional",
      amount: 0,
      show: "Yes",
    }),
  },
  {
    id: "option_standalone",
    label: "Optional Standalone",
    build: () => ({
      kind: "line_item",
      pricingMode: "option_standalone",
      name: "New Optional Standalone",
      description: "",
      type: "OptionStandalone",
      amount: 0,
      show: "Yes",
    }),
  },
  {
    id: "line_item_standalone",
    label: "Standalone Line Item",
    build: () => ({
      kind: "line_item",
      pricingMode: "line_item_standalone",
      name: "New Standalone Line Item",
      description: "",
      type: "LineItemStandalone",
      amount: 0,
      show: "Yes",
    }),
  },
  {
    id: "custom_total",
    label: "Custom Total",
    build: () => ({
      kind: "line_item",
      pricingMode: "custom_total",
      name: "Custom Total",
      description: "",
      type: "CustomTotal",
      amount: 0,
      show: "Yes",
    }),
  },
];

function parseNum(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function categoryIdForName(value: string) {
  return `cat_${value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "uncategorized"}`;
}

function adjustmentKindTone(kind: ProjectAdjustment["kind"]) {
  return kind === "modifier" ? "warning" : "info";
}

function adjustmentEffectText(adjustment: ProjectAdjustment) {
  if (adjustment.pricingMode === "modifier") return "Adjusts the running subtotal";
  if (adjustment.pricingMode.includes("standalone") || adjustment.pricingMode === "custom_total") {
    return "Creates standalone pricing output";
  }
  return "Adds onto the base quote total";
}

function rowBehaviorText(row: SummaryRowData) {
  switch (row.type) {
    case "category":
      return "Pulls the current category total into the summary.";
    case "phase":
      return "Pulls the current phase total into the summary.";
    case "adjustment":
      return "Displays one pricing adjustment inside the presentation layout.";
    case "subtotal":
      return "Calculates a running subtotal from visible rows above.";
    case "separator":
      return "Visual divider only. No values are calculated.";
    case "heading":
    default:
      return "Freeform presentation heading. No values are calculated.";
  }
}

interface SummarizeTabProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
}

export function SummarizeTab({ workspace, onApply }: SummarizeTabProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nextRowType, setNextRowType] = useState<SummaryRowType>("heading");
  const [nextAdjustmentTemplate, setNextAdjustmentTemplate] = useState<string>("modifier");

  const projectId = workspace.project.id;
  const summaryRows = useMemo(
    () => [...(workspace.summaryRows ?? [])].sort((left, right) => left.order - right.order),
    [workspace.summaryRows],
  );
  const adjustments = useMemo(
    () => [...(workspace.adjustments ?? [])].sort((left, right) => left.order - right.order),
    [workspace.adjustments],
  );
  const totals = workspace.estimate?.totals ?? {
    subtotal: 0,
    cost: 0,
    estimatedProfit: 0,
    estimatedMargin: 0,
    totalHours: 0,
    categoryTotals: [],
    phaseTotals: [],
    phaseCategoryTotals: [],
    adjustmentTotals: [],
    breakout: [],
  };

  const categoryOptions = useMemo(() => {
    const fromTotals = (totals.categoryTotals ?? []).map((entry) => ({
      id: entry.id,
      label: entry.label,
    }));
    if (fromTotals.length > 0) {
      return fromTotals;
    }

    const seen = new Set<string>();
    return workspace.worksheets
      .flatMap((worksheet) => worksheet.items)
      .map((item) => item.category)
      .filter((category) => {
        const key = category.trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.localeCompare(right))
      .map((label) => ({ id: categoryIdForName(label), label }));
  }, [totals.categoryTotals, workspace.worksheets]);

  const phaseOptions = useMemo(
    () =>
      (workspace.phases ?? [])
        .map((phase) => ({
          id: phase.id,
          label: phase.number ? `${phase.number} - ${phase.name}` : phase.name,
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [workspace.phases],
  );

  const adjustmentOptions = useMemo(
    () =>
      adjustments.map((adjustment) => ({
        id: adjustment.id,
        label: adjustment.name || "Untitled Adjustment",
      })),
    [adjustments],
  );

  const modifierTargetOptions = useMemo(() => {
    const base = [{ id: "All", label: "All" }];
    const categories = categoryOptions.map((category) => ({
      id: category.label,
      label: category.label,
    }));
    return [...base, ...categories];
  }, [categoryOptions]);

  function apply(next: WorkspaceResponse) {
    onApply(next);
    setError(null);
  }

  function handleError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Operation failed.");
  }

  function runMutation(task: () => Promise<WorkspaceResponse>) {
    startTransition(async () => {
      try {
        apply(await task());
      } catch (cause) {
        handleError(cause);
      }
    });
  }

  function handleApplyPreset(preset: SummaryPreset) {
    runMutation(() => applySummaryPreset(projectId, preset));
  }

  function handleAddRow() {
    const firstCategory = categoryOptions[0] ?? null;
    const firstPhase = phaseOptions[0] ?? null;
    const firstAdjustment = adjustmentOptions[0] ?? null;

    const input: SummaryRowInput =
      nextRowType === "category"
        ? {
            type: "category",
            label: firstCategory?.label ?? "Category",
            sourceCategoryId: firstCategory?.id ?? null,
            sourceCategoryLabel: firstCategory?.label ?? null,
            style: "normal",
          }
        : nextRowType === "phase"
          ? {
              type: "phase",
              label: firstPhase?.label ?? "Phase",
              sourcePhaseId: firstPhase?.id ?? null,
              style: "normal",
            }
          : nextRowType === "adjustment"
            ? {
                type: "adjustment",
                label: firstAdjustment?.label ?? "Adjustment",
                sourceAdjustmentId: firstAdjustment?.id ?? null,
                style: "normal",
              }
            : nextRowType === "subtotal"
              ? { type: "subtotal", label: "Subtotal", style: "bold" }
              : nextRowType === "separator"
                ? { type: "separator", label: "", style: "normal" }
                : { type: "heading", label: "Heading", style: "bold" };

    runMutation(() => createSummaryRow(projectId, input));
  }

  function handleUpdateRow(rowId: string, patch: SummaryRowInput) {
    runMutation(() => updateSummaryRow(projectId, rowId, patch));
  }

  function handleDeleteRow(rowId: string) {
    runMutation(() => deleteSummaryRow(projectId, rowId));
  }

  function handleMoveRow(rowId: string, direction: "up" | "down") {
    const index = summaryRows.findIndex((row) => row.id === rowId);
    if (index < 0) return;
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= summaryRows.length) return;

    const orderedIds = summaryRows.map((row) => row.id);
    [orderedIds[index], orderedIds[nextIndex]] = [orderedIds[nextIndex], orderedIds[index]];
    runMutation(() => reorderSummaryRows(projectId, orderedIds));
  }

  function handleAddAdjustment() {
    const template = ADJUSTMENT_TEMPLATES.find((entry) => entry.id === nextAdjustmentTemplate) ?? ADJUSTMENT_TEMPLATES[0];
    runMutation(() => createAdjustment(projectId, template.build()));
  }

  function handlePatchAdjustment(adjustmentId: string, patch: Partial<ProjectAdjustment>) {
    runMutation(() => updateAdjustment(projectId, adjustmentId, patch));
  }

  function handleDeleteAdjustment(adjustmentId: string) {
    runMutation(() => deleteAdjustment(projectId, adjustmentId));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="shrink-0 border-b border-line px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 space-y-2">
                <h4 className="text-sm font-semibold text-fg">Summary Editor</h4>
                <div>
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-fg/40">
                    Breakout Type
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SUMMARY_PRESETS.map((preset) => {
                      const active = workspace.currentRevision.summaryLayoutPreset === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          title={preset.description}
                          onClick={() => handleApplyPreset(preset.id)}
                          className={cn(
                            "inline-flex items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                            active
                              ? "border-orange-500/60 bg-orange-500/15 text-orange-200"
                              : "border-line bg-panel2/30 text-fg/70 hover:border-orange-500/30 hover:bg-orange-500/8 hover:text-fg",
                          )}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-panel2/30 p-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-fg/40">Add Layout Row</div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Select
                      value={nextRowType}
                      onChange={(event) => setNextRowType(event.target.value as SummaryRowType)}
                      className="h-8 min-w-[170px] text-xs"
                    >
                      {ROW_ADD_OPTIONS.map((rowType) => (
                        <option key={rowType} value={rowType}>
                          {ROW_TYPE_LABELS[rowType]}
                        </option>
                      ))}
                    </Select>
                    <Button onClick={handleAddRow} disabled={isPending} size="sm" className="whitespace-nowrap">
                      <Plus className="h-4 w-4" />
                      Add Row
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-line bg-panel2/30 p-2">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em] text-fg/40">Add Adjustment</div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Select
                      value={nextAdjustmentTemplate}
                      onChange={(event) => setNextAdjustmentTemplate(event.target.value)}
                      className="h-8 min-w-[190px] text-xs"
                    >
                      {ADJUSTMENT_TEMPLATES.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label}
                        </option>
                      ))}
                    </Select>
                    <Button onClick={handleAddAdjustment} disabled={isPending} size="sm" variant="secondary" className="whitespace-nowrap">
                      <Plus className="h-4 w-4" />
                      Add Adjustment
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1320px] text-xs">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-[0.14em] text-fg/40">
                <th className="px-4 py-2.5 w-[92px]">Order</th>
                <th className="px-4 py-2.5 w-[120px]">Kind</th>
                <th className="px-4 py-2.5 min-w-[220px]">Label</th>
                <th className="px-4 py-2.5 min-w-[220px]">Source / Mode</th>
                <th className="px-4 py-2.5 min-w-[340px]">Inputs</th>
                <th className="px-4 py-2.5 min-w-[220px]">Result</th>
                <th className="px-4 py-2.5 w-[88px]">Show</th>
                <th className="px-4 py-2.5 w-[64px]" />
              </tr>
            </thead>
            <tbody>
              <SectionHeaderRow
                title="Layout Rows"
                description="Presentation-only rows that control pricing summary structure and order."
                count={summaryRows.length}
              />
              {summaryRows.length === 0 ? (
                <EmptyTableRow colSpan={8}>
                  No layout rows yet. Apply a preset or add a custom row.
                </EmptyTableRow>
              ) : (
                summaryRows.map((row, index) => (
                  <SummaryLayoutTableRow
                    key={row.id}
                    row={row}
                    categoryOptions={categoryOptions}
                    phaseOptions={phaseOptions}
                    adjustmentOptions={adjustmentOptions}
                    isFirst={index === 0}
                    isLast={index === summaryRows.length - 1}
                    busy={isPending}
                    onMove={handleMoveRow}
                    onDelete={handleDeleteRow}
                    onUpdate={handleUpdateRow}
                  />
                ))
              )}

              <SectionHeaderRow
                title="Adjustments"
                description="Live pricing adjustments used by quote math and PDF output."
                count={adjustments.length}
              />
              {adjustments.length === 0 ? (
                <EmptyTableRow colSpan={8}>
                  No adjustments yet. Worksheet items alone currently define the quote total.
                </EmptyTableRow>
              ) : (
                adjustments.map((adjustment) => (
                  <AdjustmentTableRow
                    key={adjustment.id}
                    adjustment={adjustment}
                    categoryOptions={modifierTargetOptions}
                    busy={isPending}
                    onDelete={handleDeleteAdjustment}
                    onPatch={handlePatchAdjustment}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SectionHeaderRow({
  title,
  description,
  count,
}: {
  title: string;
  description: string;
  count: number;
}) {
  return (
    <tr className="bg-panel2/35">
      <td colSpan={8} className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg/45">{title}</div>
            <div className="mt-1 text-xs text-fg/50">{description}</div>
          </div>
          <Badge tone="default" className="shrink-0">
            {count}
          </Badge>
        </div>
      </td>
    </tr>
  );
}

function EmptyTableRow({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr className="border-b border-line/60">
      <td colSpan={colSpan} className="px-4 py-8 text-center text-sm text-fg/35">
        {children}
      </td>
    </tr>
  );
}

function SummaryLayoutTableRow({
  row,
  categoryOptions,
  phaseOptions,
  adjustmentOptions,
  isFirst,
  isLast,
  busy,
  onMove,
  onDelete,
  onUpdate,
}: {
  row: SummaryRowData;
  categoryOptions: Array<{ id: string; label: string }>;
  phaseOptions: Array<{ id: string; label: string }>;
  adjustmentOptions: Array<{ id: string; label: string }>;
  isFirst: boolean;
  isLast: boolean;
  busy: boolean;
  onMove: (rowId: string, direction: "up" | "down") => void;
  onDelete: (rowId: string) => void;
  onUpdate: (rowId: string, patch: SummaryRowInput) => void;
}) {
  const canShowTotals = row.type !== "heading" && row.type !== "separator";
  const resolvedCategoryOptions =
    row.sourceCategoryId && !categoryOptions.some((option) => option.id === row.sourceCategoryId)
      ? [
          ...categoryOptions,
          {
            id: row.sourceCategoryId,
            label: row.sourceCategoryLabel ?? row.label ?? "Missing category",
          },
        ]
      : categoryOptions;
  const resolvedPhaseOptions =
    row.sourcePhaseId && !phaseOptions.some((option) => option.id === row.sourcePhaseId)
      ? [...phaseOptions, { id: row.sourcePhaseId, label: row.label || "Missing phase" }]
      : phaseOptions;
  const resolvedAdjustmentOptions =
    row.sourceAdjustmentId && !adjustmentOptions.some((option) => option.id === row.sourceAdjustmentId)
      ? [...adjustmentOptions, { id: row.sourceAdjustmentId, label: row.label || "Missing adjustment" }]
      : adjustmentOptions;

  return (
    <tr className="border-b border-line/60 align-top hover:bg-panel2/20">
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            className="h-7 w-7 px-0"
            onClick={() => onMove(row.id, "up")}
            disabled={busy || isFirst}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="h-7 w-7 px-0"
            onClick={() => onMove(row.id, "down")}
            disabled={busy || isLast}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-2 text-[10px] text-fg/35">#{row.order + 1}</div>
      </td>

      <td className="px-4 py-3">
        <Badge tone={ROW_TYPE_TONES[row.type]} className="whitespace-nowrap">
          {ROW_TYPE_LABELS[row.type]}
        </Badge>
      </td>

      <td className="px-4 py-3">
        <Input
          value={row.label}
          onChange={(event) => onUpdate(row.id, { label: event.target.value })}
          placeholder={row.type === "separator" ? "Optional divider label" : "Row label"}
          disabled={busy}
          className="h-8 text-xs"
        />
      </td>

      <td className="px-4 py-3">
        {row.type === "category" ? (
          <Select
            value={row.sourceCategoryId ?? ""}
            onChange={(event) => {
              const selected = resolvedCategoryOptions.find((option) => option.id === event.target.value) ?? null;
              onUpdate(row.id, {
                sourceCategoryId: selected?.id ?? null,
                sourceCategoryLabel: selected?.label ?? null,
                label: selected?.label ?? row.label,
              });
            }}
            disabled={busy}
            className="h-8 text-xs"
          >
            <option value="">Select category</option>
            {resolvedCategoryOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : row.type === "phase" ? (
          <Select
            value={row.sourcePhaseId ?? ""}
            onChange={(event) => {
              const selected = resolvedPhaseOptions.find((option) => option.id === event.target.value) ?? null;
              onUpdate(row.id, {
                sourcePhaseId: selected?.id ?? null,
                label: selected?.label ?? row.label,
              });
            }}
            disabled={busy}
            className="h-8 text-xs"
          >
            <option value="">Select phase</option>
            {resolvedPhaseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : row.type === "adjustment" ? (
          <Select
            value={row.sourceAdjustmentId ?? ""}
            onChange={(event) => {
              const selected = resolvedAdjustmentOptions.find((option) => option.id === event.target.value) ?? null;
              onUpdate(row.id, {
                sourceAdjustmentId: selected?.id ?? null,
                label: selected?.label ?? row.label,
              });
            }}
            disabled={busy}
            className="h-8 text-xs"
          >
            <option value="">Select adjustment</option>
            {resolvedAdjustmentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : (
          <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-fg/45">
            {row.type === "separator"
              ? "No linked source"
              : row.type === "subtotal"
                ? "Calculated from visible rows above"
                : "Presentation-only row"}
          </div>
        )}
      </td>

      <td className="px-4 py-3">
        <div className="grid gap-2 xl:grid-cols-[140px_minmax(0,1fr)]">
          <Select
            value={row.style}
            onChange={(event) => onUpdate(row.id, { style: event.target.value as SummaryRowStyle })}
            disabled={busy}
            className="h-8 text-xs"
          >
            {STYLE_OPTIONS.map((style) => (
              <option key={style} value={style}>
                {style}
              </option>
            ))}
          </Select>
          <div className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-fg/45">
            {rowBehaviorText(row)}
          </div>
        </div>
      </td>

      <td className="px-4 py-3">
        {canShowTotals ? (
          <div className="space-y-1.5">
            <ComputedMetric label="Amount" value={formatMoney(row.computedValue)} />
            <ComputedMetric label="Cost" value={formatMoney(row.computedCost)} />
            <ComputedMetric label="Margin" value={formatPercent(row.computedMargin)} />
          </div>
        ) : (
          <div className="text-[11px] text-fg/40">No financial output</div>
        )}
      </td>

      <td className="px-4 py-3">
        <Toggle
          checked={row.visible}
          onChange={(checked) => onUpdate(row.id, { visible: checked })}
          className={busy ? "pointer-events-none opacity-40" : ""}
        />
      </td>

      <td className="px-4 py-3">
        <Button variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onDelete(row.id)} disabled={busy}>
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      </td>
    </tr>
  );
}

function AdjustmentTableRow({
  adjustment,
  categoryOptions,
  busy,
  onPatch,
  onDelete,
}: {
  adjustment: ProjectAdjustment;
  categoryOptions: Array<{ id: string; label: string }>;
  busy: boolean;
  onPatch: (adjustmentId: string, patch: Partial<ProjectAdjustment>) => void;
  onDelete: (adjustmentId: string) => void;
}) {
  const isModifier = adjustment.pricingMode === "modifier";
  const percentDisplay = adjustment.percentage == null ? "" : String((adjustment.percentage * 100).toFixed(2));
  const resolvedCategoryOptions =
    adjustment.appliesTo && !categoryOptions.some((option) => option.id === adjustment.appliesTo)
      ? [...categoryOptions, { id: adjustment.appliesTo, label: adjustment.appliesTo }]
      : categoryOptions;

  return (
    <tr className="border-b border-line/60 align-top hover:bg-panel2/20">
      <td className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-fg/35">Adj</div>
        <div className="mt-2 text-[10px] text-fg/35">#{adjustment.order + 1}</div>
      </td>

      <td className="px-4 py-3">
        <Badge tone={adjustmentKindTone(adjustment.kind)} className="whitespace-nowrap">
          {adjustment.kind === "modifier" ? "Modifier" : "Line Item"}
        </Badge>
      </td>

      <td className="px-4 py-3">
        <div className="space-y-2">
          <Input
            value={adjustment.name}
            onChange={(event) => onPatch(adjustment.id, { name: event.target.value })}
            placeholder="Adjustment name"
            disabled={busy}
            className="h-8 text-xs"
          />
          <Input
            value={adjustment.type}
            onChange={(event) => onPatch(adjustment.id, { type: event.target.value })}
            placeholder={isModifier ? "Type" : "Code / Type"}
            disabled={busy}
            className="h-8 text-xs"
          />
        </div>
      </td>

      <td className="px-4 py-3">
        <Select
          value={adjustment.pricingMode}
          onChange={(event) => {
            const pricingMode = event.target.value as AdjustmentPricingMode;
            onPatch(adjustment.id, {
              pricingMode,
              kind: pricingMode === "modifier" ? "modifier" : "line_item",
              percentage: pricingMode === "modifier" ? adjustment.percentage ?? 0 : null,
            });
          }}
          disabled={busy}
          className="h-8 text-xs"
        >
          {ADJUSTMENT_MODE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </td>

      <td className="px-4 py-3">
        {isModifier ? (
          <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_120px_120px]">
            <Select
              value={adjustment.appliesTo || "All"}
              onChange={(event) => onPatch(adjustment.id, { appliesTo: event.target.value })}
              disabled={busy}
              className="h-8 text-xs"
            >
              {resolvedCategoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>

            <Input
              value={percentDisplay}
              onChange={(event) =>
                onPatch(adjustment.id, {
                  percentage: event.target.value === "" ? null : parseNum(event.target.value) / 100,
                })
              }
              placeholder="Percent"
              disabled={busy}
              className="h-8 text-xs"
            />

            <Input
              value={adjustment.amount ?? ""}
              onChange={(event) =>
                onPatch(adjustment.id, {
                  amount: event.target.value === "" ? null : parseNum(event.target.value),
                })
              }
              placeholder="Amount"
              disabled={busy}
              className="h-8 text-xs"
            />
          </div>
        ) : (
          <div className="grid gap-2 xl:grid-cols-[140px_minmax(0,1fr)]">
            <Input
              value={adjustment.amount ?? ""}
              onChange={(event) =>
                onPatch(adjustment.id, {
                  amount: event.target.value === "" ? null : parseNum(event.target.value),
                })
              }
              placeholder="Amount"
              disabled={busy}
              className="h-8 text-xs"
            />
            <Input
              value={adjustment.description}
              onChange={(event) => onPatch(adjustment.id, { description: event.target.value })}
              placeholder="Description"
              disabled={busy}
              className="h-8 text-xs"
            />
          </div>
        )}
      </td>

      <td className="px-4 py-3">
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-fg/70">{adjustmentEffectText(adjustment)}</div>
          {isModifier ? (
            <>
              <div className="text-[11px] text-fg/45">
                Target: <span className="text-fg/65">{adjustment.appliesTo || "All"}</span>
              </div>
              <div className="text-[11px] text-fg/45">
                Rate: <span className="font-medium text-fg/70">{adjustment.percentage == null ? "—" : formatPercent(adjustment.percentage, 2)}</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-fg/45">
              Amount: <span className="font-medium text-fg/70">{adjustment.amount == null ? "—" : formatMoney(adjustment.amount)}</span>
            </div>
          )}
        </div>
      </td>

      <td className="px-4 py-3">
        <Toggle
          checked={adjustment.show === "Yes"}
          onChange={(checked) => onPatch(adjustment.id, { show: checked ? "Yes" : "No" })}
          className={busy ? "pointer-events-none opacity-40" : ""}
        />
      </td>

      <td className="px-4 py-3">
        <Button variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onDelete(adjustment.id)} disabled={busy}>
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      </td>
    </tr>
  );
}

function ComputedMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-fg/45">{label}</span>
      <span className="font-mono text-[11px] font-medium text-fg/80">{value}</span>
    </div>
  );
}

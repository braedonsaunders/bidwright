"use client";

import type { ComponentProps } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Plus,
  Trash2,
} from "lucide-react";
import type {
  AdjustmentPricingMode,
  AdjustmentTotalEntry,
  CreateAdjustmentInput,
  ProjectAdjustment,
  ProjectWorkspaceData,
  SummaryBuilderAxisItem,
  SummaryBuilderConfig,
  SummaryBuilderDimension,
  SummaryPreset,
  WorkspaceResponse,
} from "@/lib/api";
import {
  applySummaryPreset,
  createAdjustment,
  deleteAdjustment,
  saveSummaryBuilder,
  updateAdjustment,
} from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  Button,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import * as RadixSelect from "@radix-ui/react-select";

const SUMMARY_PRESETS: Array<{ id: SummaryPreset; label: string; description: string }> = [
  { id: "quick_total", label: "Quick Total", description: "Single grand total with pricing ladder." },
  { id: "by_phase", label: "By Phase", description: "One row per phase with a unified pricing ladder." },
  { id: "by_category", label: "By Category", description: "One row per category with a unified pricing ladder." },
  { id: "phase_x_category", label: "Pivot", description: "Phase rows with category columns." },
];

const DIMENSION_LABELS: Record<SummaryBuilderDimension, string> = {
  none: "None",
  phase: "Phase",
  category: "Category",
};

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
      name: "New Modifier",
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

function lineItemAdjustmentType(pricingMode: AdjustmentPricingMode): ProjectAdjustment["type"] | null {
  switch (pricingMode) {
    case "line_item_additional":
      return "LineItemAdditional";
    case "line_item_standalone":
      return "LineItemStandalone";
    case "option_additional":
      return "OptionAdditional";
    case "option_standalone":
      return "OptionStandalone";
    case "custom_total":
      return "CustomTotal";
    case "modifier":
    default:
      return null;
  }
}

function adjustmentModeLabel(pricingMode: AdjustmentPricingMode) {
  return ADJUSTMENT_MODE_OPTIONS.find((option) => option.id === pricingMode)?.label ?? pricingMode;
}

function buildAxisKey(dimension: SummaryBuilderDimension, sourceId: string | null) {
  return `${dimension}:${sourceId ?? "none"}`;
}

function sourceEntriesForDimension(
  dimension: SummaryBuilderDimension,
  totals: ProjectWorkspaceData["estimate"]["totals"],
) {
  if (dimension === "phase") {
    return totals.phaseTotals.filter((entry) => entry.value !== 0 || entry.cost !== 0);
  }
  if (dimension === "category") {
    return totals.categoryTotals.filter((entry) => entry.value !== 0 || entry.cost !== 0);
  }
  return [];
}

function mergeAxisItems(
  dimension: SummaryBuilderDimension,
  existing: SummaryBuilderAxisItem[] | null | undefined,
  totals: ProjectWorkspaceData["estimate"]["totals"],
): SummaryBuilderAxisItem[] {
  if (dimension === "none") return [];

  const sources = sourceEntriesForDimension(dimension, totals);
  const sourceById = new Map(sources.map((entry) => [entry.id, entry]));
  const orderedExisting = [...(existing ?? [])].sort((left, right) => left.order - right.order);
  const next: SummaryBuilderAxisItem[] = [];
  const seen = new Set<string>();

  for (const item of orderedExisting) {
    if (!item.sourceId) continue;
    const source = sourceById.get(item.sourceId);
    if (!source || seen.has(source.id)) continue;
    next.push({
      key: item.key || buildAxisKey(dimension, source.id),
      sourceId: source.id,
      label: item.label || source.label,
      visible: item.visible !== false,
      order: next.length,
    });
    seen.add(source.id);
  }

  for (const source of sources) {
    if (seen.has(source.id)) continue;
    next.push({
      key: buildAxisKey(dimension, source.id),
      sourceId: source.id,
      label: source.label,
      visible: true,
      order: next.length,
    });
  }

  return next;
}

function inferPresetFromBuilder(config: Pick<SummaryBuilderConfig, "mode" | "rowDimension" | "columnDimension">): SummaryPreset {
  if (config.mode === "total" || config.rowDimension === "none") return "quick_total";
  if (config.mode === "grouped" && config.rowDimension === "phase") return "by_phase";
  if (config.mode === "grouped" && config.rowDimension === "category") return "by_category";
  if (config.mode === "pivot" && config.rowDimension === "phase" && config.columnDimension === "category") return "phase_x_category";
  return "custom";
}

function normalizeBuilder(
  raw: Partial<SummaryBuilderConfig>,
  totals: ProjectWorkspaceData["estimate"]["totals"],
): SummaryBuilderConfig {
  let rowDimension = raw.rowDimension ?? "category";
  let columnDimension = raw.columnDimension ?? "none";
  let mode = raw.mode ?? (columnDimension !== "none" ? "pivot" : rowDimension === "none" ? "total" : "grouped");

  if (mode === "total" || rowDimension === "none") {
    mode = "total";
    rowDimension = "none";
    columnDimension = "none";
  } else if (mode === "pivot" || columnDimension !== "none") {
    mode = "pivot";
    if (columnDimension === "none" || columnDimension === rowDimension) {
      columnDimension = rowDimension === "phase" ? "category" : "phase";
    }
  } else {
    mode = "grouped";
    columnDimension = "none";
  }

  const normalized: SummaryBuilderConfig = {
    version: 1,
    preset: raw.preset ?? "custom",
    mode,
    rowDimension,
    columnDimension,
    rows: mergeAxisItems(rowDimension, raw.rows, totals),
    columns: mergeAxisItems(columnDimension, raw.columns, totals),
    totals: {
      label: raw.totals?.label?.trim() || "Grand Total",
      visible: raw.totals?.visible !== false,
    },
  };

  normalized.preset = inferPresetFromBuilder(normalized);
  return normalized;
}

function createPresetBuilder(
  preset: SummaryPreset,
  totals: ProjectWorkspaceData["estimate"]["totals"],
): SummaryBuilderConfig {
  if (preset === "quick_total") {
    return normalizeBuilder({ version: 1, preset, mode: "total", rowDimension: "none", columnDimension: "none", rows: [], columns: [], totals: { label: "Grand Total", visible: true } }, totals);
  }
  if (preset === "by_phase") {
    return normalizeBuilder({ version: 1, preset, mode: "grouped", rowDimension: "phase", columnDimension: "none", rows: [], columns: [], totals: { label: "Grand Total", visible: true } }, totals);
  }
  if (preset === "by_category") {
    return normalizeBuilder({ version: 1, preset, mode: "grouped", rowDimension: "category", columnDimension: "none", rows: [], columns: [], totals: { label: "Grand Total", visible: true } }, totals);
  }
  return normalizeBuilder({ version: 1, preset: preset === "custom" ? "phase_x_category" : preset, mode: "pivot", rowDimension: "phase", columnDimension: "category", rows: [], columns: [], totals: { label: "Grand Total", visible: true } }, totals);
}

function buildInitialBuilder(workspace: ProjectWorkspaceData) {
  return normalizeBuilder(
    workspace.summaryBuilder ?? createPresetBuilder(workspace.currentRevision.summaryLayoutPreset, workspace.estimate.totals),
    workspace.estimate.totals,
  );
}

function buildPhaseCategoryKey(phaseId: string | null | undefined, categoryId: string) {
  return `${phaseId ?? "__unphased__"}::${categoryId}`;
}

function resolvePivotCell(
  config: SummaryBuilderConfig,
  row: SummaryBuilderAxisItem,
  column: SummaryBuilderAxisItem,
  totals: ProjectWorkspaceData["estimate"]["totals"],
) {
  const phaseId = config.rowDimension === "phase" ? row.sourceId : column.sourceId;
  const categoryId = config.rowDimension === "category" ? row.sourceId : column.sourceId;
  const entry = totals.phaseCategoryTotals.find((candidate) => candidate.id === buildPhaseCategoryKey(phaseId, categoryId ?? ""));
  return entry ?? { id: "", name: "", label: "", value: 0, cost: 0, margin: 0 };
}

function builderSignature(config: SummaryBuilderConfig) {
  return JSON.stringify({
    version: config.version,
    preset: config.preset,
    mode: config.mode,
    rowDimension: config.rowDimension,
    columnDimension: config.columnDimension,
    rows: [...config.rows]
      .sort((left, right) => left.order - right.order)
      .map((item) => ({ key: item.key, sourceId: item.sourceId, label: item.label, visible: item.visible, order: item.order })),
    columns: [...config.columns]
      .sort((left, right) => left.order - right.order)
      .map((item) => ({ key: item.key, sourceId: item.sourceId, label: item.label, visible: item.visible, order: item.order })),
    totals: config.totals,
  });
}

function resolveAxisTotal(
  dimension: SummaryBuilderDimension,
  sourceId: string | null,
  totals: ProjectWorkspaceData["estimate"]["totals"],
) {
  if (!sourceId) return null;
  if (dimension === "phase") return totals.phaseTotals.find((entry) => entry.id === sourceId) ?? null;
  if (dimension === "category") return totals.categoryTotals.find((entry) => entry.id === sourceId) ?? null;
  return null;
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
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  function commit(nextValue: string) {
    setIsEditing(false);
    setDraft(nextValue);
    if (nextValue !== value) onCommit(nextValue);
  }

  return (
    <Input
      {...props}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={() => setIsEditing(true)}
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
          setDraft(value);
          setIsEditing(false);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function BuilderSelect({
  value,
  onValueChange,
  options,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        className={cn(
          "inline-flex w-full items-center justify-between rounded-lg border border-line bg-bg/50 px-3 text-left text-sm text-fg outline-none transition-colors hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-fg/45",
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="ml-2 shrink-0">
          <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="z-50 overflow-hidden rounded-lg border border-line bg-panel shadow-xl" position="popper" sideOffset={4}>
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent/10 data-[state=checked]:text-accent"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ml-auto">
                  <Check className="h-3.5 w-3.5" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function IconToggleButton({
  active,
  onClick,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={onClick} disabled={disabled} title={active ? "Hide" : "Show"}>
      {active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-fg/45" />}
    </Button>
  );
}

function MetricCell({ value }: { value: string }) {
  return <td className="px-3 py-2 text-right font-mono text-[11px] font-medium text-fg/80">{value}</td>;
}

export function SummarizeTab({
  workspace,
  onApply,
}: {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [nextAdjustmentTemplate, setNextAdjustmentTemplate] = useState("modifier");

  const projectId = workspace.project.id;
  const totals = workspace.estimate.totals;
  const revisionKey = `${workspace.project.id}:${workspace.currentRevision.id}`;
  const [draftBuilder, setDraftBuilder] = useState(() => buildInitialBuilder(workspace));
  const pendingBuilderSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    pendingBuilderSignatureRef.current = null;
    setDraftBuilder(buildInitialBuilder(workspace));
  }, [revisionKey]);

  useEffect(() => {
    if (!workspace.summaryBuilder) return;
    const nextBuilder = normalizeBuilder(workspace.summaryBuilder, totals);
    const nextSignature = builderSignature(nextBuilder);
    if (pendingBuilderSignatureRef.current && pendingBuilderSignatureRef.current !== nextSignature) return;
    if (pendingBuilderSignatureRef.current === nextSignature) pendingBuilderSignatureRef.current = null;
    setDraftBuilder((current) => (builderSignature(current) === nextSignature ? current : nextBuilder));
  }, [workspace.summaryBuilder, totals]);

  const adjustments = useMemo(
    () => [...(workspace.adjustments ?? [])].sort((left, right) => left.order - right.order || left.name.localeCompare(right.name)),
    [workspace.adjustments],
  );
  const adjustmentTotalsById = useMemo(
    () => new Map((totals.adjustmentTotals ?? []).map((entry) => [entry.id, entry])),
    [totals.adjustmentTotals],
  );
  const modifierTargetOptions = useMemo(() => {
    const options = [{ id: "All", label: "Entire Quote" }, ...totals.categoryTotals.map((entry) => ({ id: entry.label, label: entry.label }))];
    const seen = new Set<string>();
    return options.filter((option) => {
      if (seen.has(option.id)) return false;
      seen.add(option.id);
      return true;
    });
  }, [totals.categoryTotals]);

  function apply(next: WorkspaceResponse) {
    onApply(next);
    setError(null);
  }

  function handleError(cause: unknown) {
    pendingBuilderSignatureRef.current = null;
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

  function persistBuilder(next: SummaryBuilderConfig) {
    const normalized = normalizeBuilder(next, totals);
    pendingBuilderSignatureRef.current = builderSignature(normalized);
    setDraftBuilder(normalized);
    runMutation(() => saveSummaryBuilder(projectId, normalized));
  }

  function updateRow(key: string, patch: Partial<SummaryBuilderAxisItem>) {
    persistBuilder({
      ...draftBuilder,
      rows: draftBuilder.rows.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    });
  }

  function updateColumn(key: string, patch: Partial<SummaryBuilderAxisItem>) {
    persistBuilder({
      ...draftBuilder,
      columns: draftBuilder.columns.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    });
  }

  function moveRow(key: string, direction: "up" | "down") {
    const items = [...draftBuilder.rows].sort((left, right) => left.order - right.order);
    const index = items.findIndex((item) => item.key === key);
    if (index < 0) return;
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    persistBuilder({
      ...draftBuilder,
      rows: items.map((item, order) => ({ ...item, order })),
    });
  }

  function moveColumn(key: string, direction: "up" | "down") {
    const items = [...draftBuilder.columns].sort((left, right) => left.order - right.order);
    const index = items.findIndex((item) => item.key === key);
    if (index < 0) return;
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    persistBuilder({
      ...draftBuilder,
      columns: items.map((item, order) => ({ ...item, order })),
    });
  }

  function handleRowDimensionChange(value: SummaryBuilderDimension) {
    if (value === "none") {
      persistBuilder({ ...draftBuilder, mode: "total", rowDimension: "none", columnDimension: "none" });
      return;
    }
    persistBuilder({
      ...draftBuilder,
      mode: draftBuilder.columnDimension === "none" ? "grouped" : "pivot",
      rowDimension: value,
    });
  }

  function handleColumnDimensionChange(value: SummaryBuilderDimension) {
    if (draftBuilder.rowDimension === "none") return;
    if (value === "none") {
      persistBuilder({ ...draftBuilder, mode: "grouped", columnDimension: "none" });
      return;
    }
    persistBuilder({ ...draftBuilder, mode: "pivot", columnDimension: value });
  }

  function handlePreset(preset: SummaryPreset) {
    setDraftBuilder(createPresetBuilder(preset, totals));
    runMutation(() => applySummaryPreset(projectId, preset));
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

  function handleMoveAdjustment(adjustmentId: string, direction: "up" | "down") {
    const index = adjustments.findIndex((adjustment) => adjustment.id === adjustmentId);
    if (index < 0) return;
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= adjustments.length) return;
    const current = adjustments[index];
    const target = adjustments[nextIndex];
    runMutation(async () => {
      let payload = await updateAdjustment(projectId, current.id, { order: target.order });
      payload = await updateAdjustment(projectId, target.id, { order: current.order });
      return payload;
    });
  }

  const sortedRows = [...draftBuilder.rows].sort((left, right) => left.order - right.order);
  const sortedColumns = [...draftBuilder.columns].sort((left, right) => left.order - right.order);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="shrink-0 border-b border-line px-4 py-3">
          <div className="flex flex-col gap-3">
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-fg">Summary Builder</h4>
              <p className="max-w-3xl text-xs text-fg/60">
                Build the quote breakdown from real project structure and shape the final pricing adjustments in one connected table.
                The summary stays tied to current phases and categories instead of hand-editing presentation rows.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {SUMMARY_PRESETS.map((preset) => {
                const active = draftBuilder.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    title={preset.description}
                    onClick={() => handlePreset(preset.id)}
                    className={cn(
                      "inline-flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors",
                      active
                        ? "border-orange-500/60 bg-orange-500/15 text-orange-200"
                        : "border-line bg-panel2/30 text-fg/70 hover:border-orange-500/30 hover:bg-orange-500/8 hover:text-fg",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel2/25 px-2 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-fg/45">Breakout</span>
                  <BuilderSelect
                    value={draftBuilder.rowDimension}
                    onValueChange={(value) => handleRowDimensionChange(value as SummaryBuilderDimension)}
                    options={[
                      { value: "none", label: "Grand Total Only" },
                      { value: "phase", label: "Phase" },
                      { value: "category", label: "Category" },
                    ]}
                    className="h-8 min-w-[160px] text-xs"
                  />
                </div>

                <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel2/25 px-2 py-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-fg/45">Columns</span>
                  <BuilderSelect
                    value={draftBuilder.columnDimension}
                    onValueChange={(value) => handleColumnDimensionChange(value as SummaryBuilderDimension)}
                    disabled={draftBuilder.rowDimension === "none"}
                    options={[
                      { value: "none", label: "None" },
                      ...(draftBuilder.rowDimension !== "phase" ? [{ value: "phase", label: "Phase" }] : []),
                      ...(draftBuilder.rowDimension !== "category" ? [{ value: "category", label: "Category" }] : []),
                    ]}
                    className="h-8 min-w-[132px] text-xs"
                  />
                </div>
              </div>
            </div>

            {error ? <div className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 pt-3">
          <SummaryBreakdownPanel
            builder={draftBuilder}
            totals={totals}
            rows={sortedRows}
            columns={sortedColumns}
            adjustments={adjustments}
            adjustmentTotalsById={adjustmentTotalsById}
            categoryOptions={modifierTargetOptions}
            nextAdjustmentTemplate={nextAdjustmentTemplate}
            busy={isPending}
            onNextAdjustmentTemplateChange={setNextAdjustmentTemplate}
            onAddAdjustment={handleAddAdjustment}
            onMoveRow={moveRow}
            onUpdateRow={updateRow}
            onMoveColumn={moveColumn}
            onUpdateColumn={updateColumn}
            onMoveAdjustment={handleMoveAdjustment}
            onPatchAdjustment={handlePatchAdjustment}
            onDeleteAdjustment={handleDeleteAdjustment}
          />
        </div>
      </section>
    </div>
  );
}

function SummaryBreakdownPanel({
  builder,
  totals,
  rows,
  columns,
  adjustments,
  adjustmentTotalsById,
  categoryOptions,
  nextAdjustmentTemplate,
  busy,
  onNextAdjustmentTemplateChange,
  onAddAdjustment,
  onMoveRow,
  onUpdateRow,
  onMoveColumn,
  onUpdateColumn,
  onMoveAdjustment,
  onPatchAdjustment,
  onDeleteAdjustment,
}: {
  builder: SummaryBuilderConfig;
  totals: ProjectWorkspaceData["estimate"]["totals"];
  rows: SummaryBuilderAxisItem[];
  columns: SummaryBuilderAxisItem[];
  adjustments: ProjectAdjustment[];
  adjustmentTotalsById: Map<string, AdjustmentTotalEntry>;
  categoryOptions: Array<{ id: string; label: string }>;
  nextAdjustmentTemplate: string;
  busy: boolean;
  onNextAdjustmentTemplateChange: (value: string) => void;
  onAddAdjustment: () => void;
  onMoveRow: (key: string, direction: "up" | "down") => void;
  onUpdateRow: (key: string, patch: Partial<SummaryBuilderAxisItem>) => void;
  onMoveColumn: (key: string, direction: "up" | "down") => void;
  onUpdateColumn: (key: string, patch: Partial<SummaryBuilderAxisItem>) => void;
  onMoveAdjustment: (adjustmentId: string, direction: "up" | "down") => void;
  onPatchAdjustment: (adjustmentId: string, patch: Partial<ProjectAdjustment>) => void;
  onDeleteAdjustment: (adjustmentId: string) => void;
}) {
  const visibleColumns = columns.filter((column) => column.visible !== false);
  const adjustmentColSpan = builder.mode === "pivot" ? visibleColumns.length + 5 : builder.mode === "grouped" ? 7 : 4;

  if (builder.mode === "total") {
    return (
      <section className="min-h-0 overflow-auto rounded-2xl border border-line bg-panel2/20">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-[0.14em] text-fg/40">
              <th className="px-3 py-2.5">Summary</th>
              <th className="px-3 py-2.5 text-right">Amount</th>
              <th className="px-3 py-2.5 text-right">Cost</th>
              <th className="px-3 py-2.5 text-right">Margin</th>
            </tr>
          </thead>
          <tbody>
            <AdjustmentSectionRows
              colSpan={adjustmentColSpan}
              adjustments={adjustments}
              adjustmentTotalsById={adjustmentTotalsById}
              categoryOptions={categoryOptions}
              nextAdjustmentTemplate={nextAdjustmentTemplate}
              busy={busy}
              onNextAdjustmentTemplateChange={onNextAdjustmentTemplateChange}
              onAddAdjustment={onAddAdjustment}
              onMoveAdjustment={onMoveAdjustment}
              onPatchAdjustment={onPatchAdjustment}
              onDeleteAdjustment={onDeleteAdjustment}
            />
            <tr className="bg-panel2/35">
              <td className="px-3 py-3 font-semibold text-fg">Grand Total</td>
              <MetricCell value={formatMoney(totals.subtotal)} />
              <MetricCell value={formatMoney(totals.cost)} />
              <MetricCell value={formatPercent(totals.estimatedMargin)} />
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  if (builder.mode === "grouped") {
    return (
      <section className="min-h-0 overflow-auto rounded-2xl border border-line bg-panel2/20">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-[0.14em] text-fg/40">
              <th className="w-[90px] px-3 py-2.5">Order</th>
              <th className="min-w-[240px] px-3 py-2.5">Label</th>
              <th className="min-w-[160px] px-3 py-2.5">Source</th>
              <th className="w-[140px] px-3 py-2.5 text-right">Amount</th>
              <th className="w-[140px] px-3 py-2.5 text-right">Cost</th>
              <th className="w-[140px] px-3 py-2.5 text-right">Margin</th>
              <th className="w-[72px] px-3 py-2.5 text-right">Show</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <SummarySourceRow
                key={row.key}
                row={row}
                index={index}
                rowCount={rows.length}
                dimension={builder.rowDimension}
                totals={totals}
                busy={busy}
                onMoveRow={onMoveRow}
                onUpdateRow={onUpdateRow}
              />
            ))}
            <AdjustmentSectionRows
              colSpan={adjustmentColSpan}
              adjustments={adjustments}
              adjustmentTotalsById={adjustmentTotalsById}
              categoryOptions={categoryOptions}
              nextAdjustmentTemplate={nextAdjustmentTemplate}
              busy={busy}
              onNextAdjustmentTemplateChange={onNextAdjustmentTemplateChange}
              onAddAdjustment={onAddAdjustment}
              onMoveAdjustment={onMoveAdjustment}
              onPatchAdjustment={onPatchAdjustment}
              onDeleteAdjustment={onDeleteAdjustment}
            />
            <tr className="bg-panel2/35">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 font-semibold text-fg">Grand Total</td>
              <td className="px-3 py-2 text-[11px] text-fg/45">Current quote total</td>
              <MetricCell value={formatMoney(totals.subtotal)} />
              <MetricCell value={formatMoney(totals.cost)} />
              <MetricCell value={formatPercent(totals.estimatedMargin)} />
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section className="min-h-0 overflow-auto rounded-2xl border border-line bg-panel2/20">
      <table className="w-full min-w-[1040px] text-xs">
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="border-b border-line text-left text-[11px] font-medium uppercase tracking-[0.14em] text-fg/40">
            <th className="sticky left-0 z-10 min-w-[280px] bg-panel px-3 py-2.5">{DIMENSION_LABELS[builder.rowDimension]}</th>
            {visibleColumns.map((column, index) => {
              const total = resolveAxisTotal(builder.columnDimension, column.sourceId, totals);
              return (
                <th key={column.key} className="min-w-[140px] border-l border-line px-3 py-2.5">
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="xs" className="h-6 w-6 px-0" onClick={() => onMoveColumn(column.key, "up")} disabled={busy || index === 0}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button type="button" variant="ghost" size="xs" className="h-6 w-6 px-0" onClick={() => onMoveColumn(column.key, "down")} disabled={busy || index === visibleColumns.length - 1}>
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <IconToggleButton active={column.visible} onClick={() => onUpdateColumn(column.key, { visible: !column.visible })} disabled={busy} />
                  </div>
                  <CommitInput value={column.label} onCommit={(value) => onUpdateColumn(column.key, { label: value })} disabled={busy} className="mt-1 h-8 text-xs" />
                  <div className="mt-1 text-right font-mono text-[10px] text-fg/45">{formatMoney(total?.value ?? 0)}</div>
                </th>
              );
            })}
            <th className="border-l border-line px-3 py-2.5 text-right">Amount</th>
            <th className="px-3 py-2.5 text-right">Cost</th>
            <th className="px-3 py-2.5 text-right">Margin</th>
            <th className="px-3 py-2.5 text-right">Show</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const total = resolveAxisTotal(builder.rowDimension, row.sourceId, totals);
            return (
              <tr key={row.key} className={cn("border-b border-line/60", !row.visible && "opacity-45")}>
                <td className="sticky left-0 z-10 bg-inherit px-3 py-2">
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onMoveRow(row.key, "up")} disabled={busy || index === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onMoveRow(row.key, "down")} disabled={busy || index === rows.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <CommitInput value={row.label} onCommit={(value) => onUpdateRow(row.key, { label: value })} disabled={busy} className="h-8 min-w-0 flex-1 text-xs" />
                  </div>
                </td>
                {visibleColumns.map((column) => {
                  const cell = resolvePivotCell(builder, row, column, totals);
                  return (
                    <td key={`${row.key}:${column.key}`} className="border-l border-line px-3 py-2 text-right font-mono text-[11px]">
                      {formatMoney(cell.value)}
                    </td>
                  );
                })}
                <MetricCell value={formatMoney(total?.value ?? 0)} />
                <MetricCell value={formatMoney(total?.cost ?? 0)} />
                <MetricCell value={formatPercent(total?.margin ?? 0)} />
                <td className="px-3 py-2 text-right">
                  <IconToggleButton active={row.visible} onClick={() => onUpdateRow(row.key, { visible: !row.visible })} disabled={busy} />
                </td>
              </tr>
            );
          })}
          <AdjustmentSectionRows
            colSpan={adjustmentColSpan}
            adjustments={adjustments}
            adjustmentTotalsById={adjustmentTotalsById}
            categoryOptions={categoryOptions}
            nextAdjustmentTemplate={nextAdjustmentTemplate}
            busy={busy}
            onNextAdjustmentTemplateChange={onNextAdjustmentTemplateChange}
            onAddAdjustment={onAddAdjustment}
            onMoveAdjustment={onMoveAdjustment}
            onPatchAdjustment={onPatchAdjustment}
            onDeleteAdjustment={onDeleteAdjustment}
          />
          <tr className="bg-panel2/35">
            <td colSpan={visibleColumns.length + 1} className="px-3 py-2 font-semibold text-fg">Grand Total</td>
            <MetricCell value={formatMoney(totals.subtotal)} />
            <MetricCell value={formatMoney(totals.cost)} />
            <MetricCell value={formatPercent(totals.estimatedMargin)} />
            <td className="px-3 py-2" />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function AdjustmentSectionRows({
  colSpan,
  adjustments,
  adjustmentTotalsById,
  categoryOptions,
  nextAdjustmentTemplate,
  busy,
  onNextAdjustmentTemplateChange,
  onAddAdjustment,
  onMoveAdjustment,
  onPatchAdjustment,
  onDeleteAdjustment,
}: {
  colSpan: number;
  adjustments: ProjectAdjustment[];
  adjustmentTotalsById: Map<string, AdjustmentTotalEntry>;
  categoryOptions: Array<{ id: string; label: string }>;
  nextAdjustmentTemplate: string;
  busy: boolean;
  onNextAdjustmentTemplateChange: (value: string) => void;
  onAddAdjustment: () => void;
  onMoveAdjustment: (adjustmentId: string, direction: "up" | "down") => void;
  onPatchAdjustment: (adjustmentId: string, patch: Partial<ProjectAdjustment>) => void;
  onDeleteAdjustment: (adjustmentId: string) => void;
}) {
  return (
    <>
      <tr className="bg-panel/70">
        <td colSpan={colSpan} className="px-0 py-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
            <div>
              <div className="text-sm font-semibold text-fg">Pricing Adjustments</div>
              <div className="mt-1 text-[11px] text-fg/55">
                Quote-level modifiers, alternates, allowances, and custom totals that feed into the final quoted total.
              </div>
            </div>
            <div className="flex w-full max-w-[420px] gap-2 sm:w-auto">
              <BuilderSelect
                value={nextAdjustmentTemplate}
                onValueChange={onNextAdjustmentTemplateChange}
                options={ADJUSTMENT_TEMPLATES.map((template) => ({ value: template.id, label: template.label }))}
                className="h-8 min-w-[200px] text-xs"
              />
              <Button onClick={onAddAdjustment} disabled={busy} size="sm" variant="secondary" className="shrink-0">
                <Plus className="h-4 w-4" />
                Add Row
              </Button>
            </div>
          </div>
        </td>
      </tr>
      <tr>
        <td colSpan={colSpan} className="px-0 py-0">
          {adjustments.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-fg/45">No pricing adjustments yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-panel/50">
                <tr className="border-y border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                  <th className="w-[92px] px-3 py-2">Order</th>
                  <th className="min-w-[220px] px-3 py-2">Row</th>
                  <th className="min-w-[180px] px-3 py-2">Type</th>
                  <th className="min-w-[240px] px-3 py-2">Scope / Notes</th>
                  <th className="w-[180px] px-3 py-2 text-right">Amount</th>
                  <th className="w-[140px] px-3 py-2 text-right">Cost</th>
                  <th className="w-[140px] px-3 py-2 text-right">Margin</th>
                  <th className="w-[72px] px-3 py-2 text-right">Show</th>
                  <th className="w-[72px] px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((adjustment, index) => (
                  <AdjustmentTableRow
                    key={adjustment.id}
                    adjustment={adjustment}
                    totals={adjustmentTotalsById.get(adjustment.id) ?? null}
                    categoryOptions={categoryOptions}
                    canMoveUp={index > 0}
                    canMoveDown={index < adjustments.length - 1}
                    busy={busy}
                    onMove={onMoveAdjustment}
                    onPatch={onPatchAdjustment}
                    onDelete={onDeleteAdjustment}
                  />
                ))}
              </tbody>
            </table>
          )}
        </td>
      </tr>
    </>
  );
}

function SummarySourceRow({
  row,
  index,
  rowCount,
  dimension,
  totals,
  busy,
  onMoveRow,
  onUpdateRow,
}: {
  row: SummaryBuilderAxisItem;
  index: number;
  rowCount: number;
  dimension: SummaryBuilderDimension;
  totals: ProjectWorkspaceData["estimate"]["totals"];
  busy: boolean;
  onMoveRow: (key: string, direction: "up" | "down") => void;
  onUpdateRow: (key: string, patch: Partial<SummaryBuilderAxisItem>) => void;
}) {
  const source = resolveAxisTotal(dimension, row.sourceId, totals);

  return (
    <tr className={cn("border-b border-line/60", !row.visible && "opacity-45")}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onMoveRow(row.key, "up")} disabled={busy || index === 0}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onMoveRow(row.key, "down")} disabled={busy || index === rowCount - 1}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
      <td className="px-3 py-2">
        <CommitInput value={row.label} onCommit={(value) => onUpdateRow(row.key, { label: value })} disabled={busy} className="h-8 text-xs" />
      </td>
      <td className="px-3 py-2">
        <div className="font-medium text-fg/80">{source?.label ?? "Missing source"}</div>
        <div className="mt-1 text-[11px] text-fg/45">{DIMENSION_LABELS[dimension]} total</div>
      </td>
      <td className="px-3 py-2 text-[11px] text-fg/55">
        Auto-linked to the current {DIMENSION_LABELS[dimension].toLowerCase()} structure so it stays in sync as the estimate changes.
      </td>
      <MetricCell value={formatMoney(source?.value ?? 0)} />
      <MetricCell value={formatMoney(source?.cost ?? 0)} />
      <MetricCell value={formatPercent(source?.margin ?? 0)} />
      <td className="px-3 py-2 text-right">
        <IconToggleButton active={row.visible} onClick={() => onUpdateRow(row.key, { visible: !row.visible })} disabled={busy} />
      </td>
      <td className="px-3 py-2" />
    </tr>
  );
}

function AdjustmentTableRow({
  adjustment,
  totals,
  categoryOptions,
  canMoveUp,
  canMoveDown,
  busy,
  onMove,
  onPatch,
  onDelete,
}: {
  adjustment: ProjectAdjustment;
  totals: AdjustmentTotalEntry | null;
  categoryOptions: Array<{ id: string; label: string }>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy: boolean;
  onMove: (adjustmentId: string, direction: "up" | "down") => void;
  onPatch: (adjustmentId: string, patch: Partial<ProjectAdjustment>) => void;
  onDelete: (adjustmentId: string) => void;
}) {
  const isModifier = adjustment.pricingMode === "modifier";
  const percentDisplay = adjustment.percentage == null ? "" : String((adjustment.percentage * 100).toFixed(2));

  return (
    <tr className={cn("border-b border-line/60", adjustment.show === "No" && "opacity-50")}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onMove(adjustment.id, "up")} disabled={busy || !canMoveUp}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onMove(adjustment.id, "down")} disabled={busy || !canMoveDown}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
      <td className="px-3 py-2">
        <CommitInput value={adjustment.name} onCommit={(value) => onPatch(adjustment.id, { name: value })} disabled={busy} className="h-8 text-xs" />
      </td>
      <td className="px-3 py-2">
        <BuilderSelect
          value={adjustment.pricingMode}
          onValueChange={(value) => {
            const pricingMode = value as AdjustmentPricingMode;
            onPatch(adjustment.id, {
              pricingMode,
              kind: pricingMode === "modifier" ? "modifier" : "line_item",
              percentage: pricingMode === "modifier" ? adjustment.percentage ?? 0 : null,
              type: lineItemAdjustmentType(pricingMode) ?? adjustment.type,
            });
          }}
          disabled={busy}
          options={ADJUSTMENT_MODE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          className="h-8 text-xs"
        />
      </td>
      <td className="px-3 py-2">
        {isModifier ? (
          <div className="space-y-2">
            <BuilderSelect
              value={adjustment.appliesTo || "All"}
              onValueChange={(value) => onPatch(adjustment.id, { appliesTo: value })}
              disabled={busy}
              options={categoryOptions.map((option) => ({ value: option.id, label: option.label }))}
              className="h-8 text-xs"
            />
            <div className="text-[11px] text-fg/45">Applies to the selected scope bucket before any optional exclusions.</div>
          </div>
        ) : (
          <div className="space-y-2">
            <CommitInput value={adjustment.description} onCommit={(value) => onPatch(adjustment.id, { description: value })} placeholder="Proposal note" disabled={busy} className="h-8 text-xs" />
            <div className="text-[11px] text-fg/45">{adjustmentModeLabel(adjustment.pricingMode)}</div>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="font-mono text-[11px] font-semibold text-fg">{formatMoney(totals?.value ?? adjustment.amount ?? 0)}</div>
        <div className="mt-2 space-y-2">
          {isModifier ? (
            <div className="grid grid-cols-2 gap-2">
              <CommitInput
                value={percentDisplay}
                onCommit={(value) => onPatch(adjustment.id, { percentage: value === "" ? null : parseNum(value) / 100 })}
                placeholder="%"
                disabled={busy}
                className="h-8 text-xs"
              />
              <CommitInput
                value={adjustment.amount == null ? "" : String(adjustment.amount)}
                onCommit={(value) => onPatch(adjustment.id, { amount: value === "" ? null : parseNum(value) })}
                placeholder="Cap"
                disabled={busy}
                className="h-8 text-xs"
              />
            </div>
          ) : (
            <CommitInput
              value={adjustment.amount == null ? "" : String(adjustment.amount)}
              onCommit={(value) => onPatch(adjustment.id, { amount: value === "" ? null : parseNum(value) })}
              placeholder="Amount"
              disabled={busy}
              className="h-8 text-xs"
            />
          )}
        </div>
      </td>
      <MetricCell value={formatMoney(totals?.cost ?? 0)} />
      <MetricCell value={formatPercent(totals?.margin ?? 0)} />
      <td className="px-3 py-2 text-right">
        <IconToggleButton active={adjustment.show === "Yes"} onClick={() => onPatch(adjustment.id, { show: adjustment.show === "Yes" ? "No" : "Yes" })} disabled={busy} />
      </td>
      <td className="px-3 py-2 text-right">
        <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onDelete(adjustment.id)} disabled={busy}>
          <Trash2 className="h-3.5 w-3.5 text-danger" />
        </Button>
      </td>
    </tr>
  );
}

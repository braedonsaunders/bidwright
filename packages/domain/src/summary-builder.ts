import type {
  AdjustmentPricingMode,
  RevisionTotals,
  SummaryBuilderAxisItem,
  SummaryBuilderConfig,
  SummaryBuilderDimension,
  SummaryPreset,
  SummaryRow,
  SummaryRowStyle,
  SummaryRowType,
} from "./models.js";

const standalonePricingModes = new Set<AdjustmentPricingMode>([
  "option_standalone",
  "line_item_standalone",
  "custom_total",
]);

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function buildAxisKey(dimension: SummaryBuilderDimension, sourceId: string | null) {
  return `${dimension}:${sourceId ?? "none"}`;
}

function buildPhaseCategoryKey(phaseId: string | null | undefined, categoryId: string) {
  return `${phaseId ?? "__unphased__"}::${categoryId}`;
}

function isStandaloneQuote(totals: RevisionTotals) {
  return totals.adjustmentTotals.some((entry) => standalonePricingModes.has(entry.pricingMode));
}

function sourceEntriesForDimension(dimension: SummaryBuilderDimension, totals: RevisionTotals) {
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
  totals: RevisionTotals,
): SummaryBuilderAxisItem[] {
  const sources = sourceEntriesForDimension(dimension, totals);
  if (dimension === "none") {
    return [];
  }

  const sourceById = new Map(sources.map((entry) => [entry.id, entry]));
  const orderedExisting = [...(existing ?? [])].sort((left, right) => left.order - right.order);
  const seen = new Set<string>();
  const next: SummaryBuilderAxisItem[] = [];

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

export function inferSummaryPresetFromBuilder(config: Pick<SummaryBuilderConfig, "mode" | "rowDimension" | "columnDimension">): SummaryPreset {
  if (config.mode === "total" || config.rowDimension === "none") {
    return "quick_total";
  }
  if (config.mode === "grouped" && config.rowDimension === "phase") {
    return "by_phase";
  }
  if (config.mode === "grouped" && config.rowDimension === "category") {
    return "by_category";
  }
  if (config.mode === "pivot" && config.rowDimension === "phase" && config.columnDimension === "category") {
    return "phase_x_category";
  }
  return "custom";
}

export function createSummaryBuilderPreset(preset: SummaryPreset, totals: RevisionTotals): SummaryBuilderConfig {
  if (preset === "quick_total") {
    return {
      version: 1,
      preset: "quick_total",
      mode: "total",
      rowDimension: "none",
      columnDimension: "none",
      rows: [],
      columns: [],
      totals: { label: "Grand Total", visible: true },
    };
  }

  if (preset === "by_phase") {
    return {
      version: 1,
      preset: "by_phase",
      mode: "grouped",
      rowDimension: "phase",
      columnDimension: "none",
      rows: mergeAxisItems("phase", [], totals),
      columns: [],
      totals: { label: "Grand Total", visible: true },
    };
  }

  if (preset === "by_category") {
    return {
      version: 1,
      preset: "by_category",
      mode: "grouped",
      rowDimension: "category",
      columnDimension: "none",
      rows: mergeAxisItems("category", [], totals),
      columns: [],
      totals: { label: "Grand Total", visible: true },
    };
  }

  if (preset === "phase_x_category") {
    return {
      version: 1,
      preset: "phase_x_category",
      mode: "pivot",
      rowDimension: "phase",
      columnDimension: "category",
      rows: mergeAxisItems("phase", [], totals),
      columns: mergeAxisItems("category", [], totals),
      totals: { label: "Grand Total", visible: true },
    };
  }

  return {
    version: 1,
    preset: "custom",
    mode: "grouped",
    rowDimension: "category",
    columnDimension: "none",
    rows: mergeAxisItems("category", [], totals),
    columns: [],
    totals: { label: "Grand Total", visible: true },
  };
}

export function normalizeSummaryBuilderConfig(
  raw: Partial<SummaryBuilderConfig> | null | undefined,
  totals: RevisionTotals,
): SummaryBuilderConfig {
  let rowDimension = raw?.rowDimension ?? "category";
  let columnDimension = raw?.columnDimension ?? "none";
  let mode = raw?.mode ?? (columnDimension !== "none" ? "pivot" : rowDimension === "none" ? "total" : "grouped");

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
    preset: raw?.preset ?? "custom",
    mode,
    rowDimension,
    columnDimension,
    rows: mergeAxisItems(rowDimension, raw?.rows, totals),
    columns: mergeAxisItems(columnDimension, raw?.columns, totals),
    totals: {
      label: raw?.totals?.label?.trim() || "Grand Total",
      visible: raw?.totals?.visible !== false,
    },
  };

  normalized.preset = inferSummaryPresetFromBuilder(normalized);
  return normalized;
}

export function deriveSummaryBuilderFromLegacy(
  rows: SummaryRow[],
  preset: SummaryPreset,
  totals: RevisionTotals,
): SummaryBuilderConfig {
  const orderedRows = [...rows].sort((left, right) => left.order - right.order);
  const subtotalRow = [...orderedRows].reverse().find((row) => row.type === "subtotal") ?? null;
  const phaseRows = orderedRows.filter((row) => row.type === "phase" && row.sourcePhaseId);
  const plainCategoryRows = orderedRows.filter(
    (row) => row.type === "category" && row.sourceCategoryId && !row.sourcePhaseId,
  );
  const nestedCategoryRows = orderedRows.filter(
    (row) => row.type === "category" && row.sourceCategoryId && row.sourcePhaseId,
  );

  if (orderedRows.length === 0) {
    return createSummaryBuilderPreset(preset, totals);
  }

  if (preset === "quick_total" || (phaseRows.length === 0 && plainCategoryRows.length === 0 && nestedCategoryRows.length === 0)) {
    return normalizeSummaryBuilderConfig(
      {
        version: 1,
        preset: "quick_total",
        mode: "total",
        rowDimension: "none",
        columnDimension: "none",
        rows: [],
        columns: [],
        totals: {
          label: subtotalRow?.label ?? "Grand Total",
          visible: subtotalRow?.visible !== false,
        },
      },
      totals,
    );
  }

  if (preset === "phase_x_category" || (phaseRows.length > 0 && nestedCategoryRows.length > 0)) {
    const columnSeed = new Map<string, SummaryBuilderAxisItem>();
    for (const row of nestedCategoryRows) {
      if (!row.sourceCategoryId || columnSeed.has(row.sourceCategoryId)) continue;
      columnSeed.set(row.sourceCategoryId, {
        key: buildAxisKey("category", row.sourceCategoryId),
        sourceId: row.sourceCategoryId,
        label: row.sourceCategoryLabel ?? row.label,
        visible: row.visible,
        order: columnSeed.size,
      });
    }

    return normalizeSummaryBuilderConfig(
      {
        version: 1,
        preset: "phase_x_category",
        mode: "pivot",
        rowDimension: "phase",
        columnDimension: "category",
        rows: phaseRows.map((row, index) => ({
          key: row.id,
          sourceId: row.sourcePhaseId ?? null,
          label: row.label,
          visible: row.visible,
          order: index,
        })),
        columns: Array.from(columnSeed.values()),
        totals: {
          label: subtotalRow?.label ?? "Grand Total",
          visible: subtotalRow?.visible !== false,
        },
      },
      totals,
    );
  }

  if (preset === "by_phase" || phaseRows.length > 0) {
    return normalizeSummaryBuilderConfig(
      {
        version: 1,
        preset: "by_phase",
        mode: "grouped",
        rowDimension: "phase",
        columnDimension: "none",
        rows: phaseRows.map((row, index) => ({
          key: row.id,
          sourceId: row.sourcePhaseId ?? null,
          label: row.label,
          visible: row.visible,
          order: index,
        })),
        columns: [],
        totals: {
          label: subtotalRow?.label ?? "Grand Total",
          visible: subtotalRow?.visible !== false,
        },
      },
      totals,
    );
  }

  return normalizeSummaryBuilderConfig(
    {
      version: 1,
      preset: "by_category",
      mode: "grouped",
      rowDimension: "category",
      columnDimension: "none",
      rows: plainCategoryRows.map((row, index) => ({
        key: row.id,
        sourceId: row.sourceCategoryId ?? null,
        label: row.label,
        visible: row.visible,
        order: index,
      })),
      columns: [],
      totals: {
        label: subtotalRow?.label ?? "Grand Total",
        visible: subtotalRow?.visible !== false,
      },
    },
    totals,
  );
}

function adjustmentRows(
  totals: RevisionTotals,
  startOrder: number,
): Array<Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">> {
  return totals.adjustmentTotals
    .filter((entry) => entry.show !== "No")
    .map((entry, index) => ({
      type: "adjustment" as SummaryRowType,
      label: entry.label,
      order: startOrder + index,
      visible: true,
      style: "normal" as SummaryRowStyle,
      sourceCategoryId: null,
      sourceCategoryLabel: null,
      sourcePhaseId: null,
      sourceAdjustmentId: entry.id,
    }));
}

export function materializeSummaryRowsFromBuilder(
  config: SummaryBuilderConfig,
  totals: RevisionTotals,
): Array<Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">> {
  const rows: Array<Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">> = [];
  const visibleRows = config.rows.filter((row) => row.visible).sort((left, right) => left.order - right.order);
  const visibleColumns = config.columns.filter((column) => column.visible).sort((left, right) => left.order - right.order);

  if (config.mode === "grouped") {
    for (const row of visibleRows) {
      rows.push({
        type: config.rowDimension === "phase" ? "phase" : "category",
        label: row.label,
        order: rows.length,
        visible: true,
        style: "normal",
        sourceCategoryId: config.rowDimension === "category" ? row.sourceId : null,
        sourceCategoryLabel: config.rowDimension === "category" ? row.label : null,
        sourcePhaseId: config.rowDimension === "phase" ? row.sourceId : null,
        sourceAdjustmentId: null,
      });
    }
  } else if (config.mode === "pivot") {
    for (const row of visibleRows) {
      for (const column of visibleColumns) {
        rows.push({
          type: "category",
          label: `${row.label} — ${column.label}`,
          order: rows.length,
          visible: true,
          style: "normal",
          sourceCategoryId: config.rowDimension === "category" ? row.sourceId : column.sourceId,
          sourceCategoryLabel: config.rowDimension === "category" ? row.label : column.label,
          sourcePhaseId: config.rowDimension === "phase" ? row.sourceId : column.sourceId,
          sourceAdjustmentId: null,
        });
      }
    }
  }

  rows.push(...adjustmentRows(totals, rows.length));

  if (config.totals.visible) {
    rows.push({
      type: "subtotal",
      label: config.totals.label,
      order: rows.length,
      visible: true,
      style: "bold",
      sourceCategoryId: null,
      sourceCategoryLabel: null,
      sourcePhaseId: null,
      sourceAdjustmentId: null,
    });
  }

  if (rows.length === 0) {
    rows.push({
      type: "subtotal",
      label: config.totals.label,
      order: 0,
      visible: true,
      style: "bold",
      sourceCategoryId: null,
      sourceCategoryLabel: null,
      sourcePhaseId: null,
      sourceAdjustmentId: null,
    });
  }

  return rows;
}

export function buildSummaryBuilderConfig(
  existing: Partial<SummaryBuilderConfig> | null | undefined,
  legacyRows: SummaryRow[],
  preset: SummaryPreset,
  totals: RevisionTotals,
): SummaryBuilderConfig {
  if (existing) {
    return normalizeSummaryBuilderConfig(existing, totals);
  }
  return deriveSummaryBuilderFromLegacy(legacyRows, preset, totals);
}

export function resolveSummaryCellValue(
  config: SummaryBuilderConfig,
  rowSourceId: string | null,
  columnSourceId: string | null,
  totals: RevisionTotals,
) {
  if (config.mode !== "pivot" || !rowSourceId || !columnSourceId) {
    return { value: 0, cost: 0, margin: 0 };
  }

  const phaseId = config.rowDimension === "phase" ? rowSourceId : columnSourceId;
  const categoryId = config.rowDimension === "category" ? rowSourceId : columnSourceId;
  const entry = totals.phaseCategoryTotals.find((candidate) => candidate.id === buildPhaseCategoryKey(phaseId, categoryId));

  return {
    value: roundMoney(entry?.value ?? 0),
    cost: roundMoney(entry?.cost ?? 0),
    margin: roundMoney(entry?.margin ?? 0),
  };
}

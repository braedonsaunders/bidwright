import type {
  AdjustmentPricingMode,
  RevisionTotals,
  SummaryBuilderAxisItem,
  SummaryBuilderClassificationConfig,
  SummaryBuilderConfig,
  SummaryBuilderDimension,
  SummaryPreset,
  SummaryRow,
  SummaryRowStyle,
  SummaryRowType,
} from "./models";
import { normalizeSummaryClassificationConfig } from "./construction-classification";

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

function buildPairKey(leftId: string | null | undefined, rightId: string | null | undefined) {
  return `${leftId ?? "__unphased__"}::${rightId ?? ""}`;
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
  if (dimension === "worksheet") {
    return (totals.worksheetTotals ?? []).filter((entry) => entry.value !== 0 || entry.cost !== 0);
  }
  if (dimension === "classification") {
    return (totals.classificationTotals ?? []).filter((entry) => entry.value !== 0 || entry.cost !== 0);
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

function classificationPresetConfig(preset: SummaryPreset): SummaryBuilderClassificationConfig | null {
  switch (preset) {
    case "by_masterformat_division":
      return normalizeSummaryClassificationConfig({ standard: "masterformat", level: "division" });
    case "by_uniformat_division":
      return normalizeSummaryClassificationConfig({ standard: "uniformat", level: "division" });
    case "by_omniclass_division":
      return normalizeSummaryClassificationConfig({ standard: "omniclass", level: "division" });
    case "by_uniclass_division":
      return normalizeSummaryClassificationConfig({ standard: "uniclass", level: "division" });
    case "by_din276_division":
      return normalizeSummaryClassificationConfig({ standard: "din276", level: "division" });
    case "by_nrm_division":
      return normalizeSummaryClassificationConfig({ standard: "nrm", level: "division" });
    case "by_icms_division":
      return normalizeSummaryClassificationConfig({ standard: "icms", level: "division" });
    case "by_cost_code":
      return normalizeSummaryClassificationConfig({ standard: "cost_code", level: "full" });
    default:
      return null;
  }
}

function presetForClassification(config: SummaryBuilderClassificationConfig): SummaryPreset {
  if (config.standard === "cost_code") return "by_cost_code";
  if (config.level !== "division") return "custom";
  switch (config.standard) {
    case "masterformat":
      return "by_masterformat_division";
    case "uniformat":
      return "by_uniformat_division";
    case "omniclass":
      return "by_omniclass_division";
    case "uniclass":
      return "by_uniclass_division";
    case "din276":
      return "by_din276_division";
    case "nrm":
      return "by_nrm_division";
    case "icms":
      return "by_icms_division";
    default:
      return "custom";
  }
}

export function inferSummaryPresetFromBuilder(
  config: Pick<SummaryBuilderConfig, "mode" | "rowDimension" | "columnDimension"> & Partial<Pick<SummaryBuilderConfig, "classification">>,
): SummaryPreset {
  if (config.mode === "total" || config.rowDimension === "none") {
    return "quick_total";
  }
  if (config.mode === "grouped" && config.rowDimension === "phase") {
    return "by_phase";
  }
  if (config.mode === "grouped" && config.rowDimension === "category") {
    return "by_category";
  }
  if (config.mode === "grouped" && config.rowDimension === "worksheet") {
    return "by_worksheet";
  }
  if (config.mode === "grouped" && config.rowDimension === "classification") {
    const classification = normalizeSummaryClassificationConfig(config.classification);
    return presetForClassification(classification);
  }
  if (config.mode === "pivot" && config.rowDimension === "phase" && config.columnDimension === "category") {
    return "phase_x_category";
  }
  return "custom";
}

export function createSummaryBuilderPreset(preset: SummaryPreset, totals: RevisionTotals): SummaryBuilderConfig {
  const defaultClassification = normalizeSummaryClassificationConfig();
  if (preset === "quick_total") {
    return {
      version: 1,
      preset: "quick_total",
      mode: "total",
      rowDimension: "none",
      columnDimension: "none",
      rows: [],
      columns: [],
      classification: defaultClassification,
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
      classification: defaultClassification,
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
      classification: defaultClassification,
      totals: { label: "Grand Total", visible: true },
    };
  }

  if (preset === "by_worksheet") {
    return {
      version: 1,
      preset: "by_worksheet",
      mode: "grouped",
      rowDimension: "worksheet",
      columnDimension: "none",
      rows: mergeAxisItems("worksheet", [], totals),
      columns: [],
      classification: defaultClassification,
      totals: { label: "Grand Total", visible: true },
    };
  }

  const classificationPreset = classificationPresetConfig(preset);
  if (classificationPreset) {
    return {
      version: 1,
      preset,
      mode: "grouped",
      rowDimension: "classification",
      columnDimension: "none",
      rows: mergeAxisItems("classification", [], totals),
      columns: [],
      classification: classificationPreset,
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
      classification: defaultClassification,
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
    classification: defaultClassification,
    totals: { label: "Grand Total", visible: true },
  };
}

function fallbackColumnDimension(rowDimension: SummaryBuilderDimension): SummaryBuilderDimension {
  return (["phase", "category", "classification", "worksheet"] as SummaryBuilderDimension[]).find(
    (dimension) => dimension !== rowDimension,
  ) ?? "category";
}

export function normalizeSummaryBuilderConfig(
  raw: Partial<SummaryBuilderConfig> | null | undefined,
  totals: RevisionTotals,
): SummaryBuilderConfig {
  let rowDimension = raw?.rowDimension ?? "category";
  let columnDimension = raw?.columnDimension ?? "none";
  let mode = raw?.mode ?? (columnDimension !== "none" ? "pivot" : rowDimension === "none" ? "total" : "grouped");
  const classification = normalizeSummaryClassificationConfig(raw?.classification);

  if (mode === "total" || rowDimension === "none") {
    mode = "total";
    rowDimension = "none";
    columnDimension = "none";
  } else if (mode === "pivot" || columnDimension !== "none") {
    mode = "pivot";
    if (columnDimension === "none" || columnDimension === rowDimension) {
      columnDimension = fallbackColumnDimension(rowDimension);
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
    classification,
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
  const worksheetRows = orderedRows.filter((row) => row.type === "worksheet" && row.sourceWorksheetId);
  const classificationRows = orderedRows.filter((row) => row.type === "classification" && row.sourceClassificationId);
  const plainCategoryRows = orderedRows.filter(
    (row) => row.type === "category" && row.sourceCategoryId && !row.sourcePhaseId,
  );
  const nestedCategoryRows = orderedRows.filter(
    (row) => row.type === "category" && row.sourceCategoryId && row.sourcePhaseId,
  );

  if (orderedRows.length === 0) {
    return createSummaryBuilderPreset(preset, totals);
  }

  if (
    preset === "quick_total" ||
    (phaseRows.length === 0 &&
      worksheetRows.length === 0 &&
      classificationRows.length === 0 &&
      plainCategoryRows.length === 0 &&
      nestedCategoryRows.length === 0)
  ) {
    return normalizeSummaryBuilderConfig(
      {
        version: 1,
        preset: "quick_total",
        mode: "total",
        rowDimension: "none",
        columnDimension: "none",
        rows: [],
        columns: [],
        classification: normalizeSummaryClassificationConfig(),
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
        classification: normalizeSummaryClassificationConfig(),
        totals: {
          label: subtotalRow?.label ?? "Grand Total",
          visible: subtotalRow?.visible !== false,
        },
      },
      totals,
    );
  }

  const legacyClassificationConfig = classificationPresetConfig(preset) ?? normalizeSummaryClassificationConfig();
  if (classificationPresetConfig(preset) || classificationRows.length > 0) {
    return normalizeSummaryBuilderConfig(
      {
        version: 1,
        preset: classificationPresetConfig(preset) ? preset : presetForClassification(legacyClassificationConfig),
        mode: "grouped",
        rowDimension: "classification",
        columnDimension: "none",
        rows: classificationRows.map((row, index) => ({
          key: row.id,
          sourceId: row.sourceClassificationId ?? null,
          label: row.label,
          visible: row.visible,
          order: index,
        })),
        columns: [],
        classification: legacyClassificationConfig,
        totals: {
          label: subtotalRow?.label ?? "Grand Total",
          visible: subtotalRow?.visible !== false,
        },
      },
      totals,
    );
  }

  if (preset === "by_worksheet" || worksheetRows.length > 0) {
    return normalizeSummaryBuilderConfig(
      {
        version: 1,
        preset: "by_worksheet",
        mode: "grouped",
        rowDimension: "worksheet",
        columnDimension: "none",
        rows: worksheetRows.map((row, index) => ({
          key: row.id,
          sourceId: row.sourceWorksheetId ?? null,
          label: row.label,
          visible: row.visible,
          order: index,
        })),
        columns: [],
        classification: normalizeSummaryClassificationConfig(),
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
        classification: normalizeSummaryClassificationConfig(),
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
      classification: normalizeSummaryClassificationConfig(),
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
      sourceWorksheetId: null,
      sourceWorksheetLabel: null,
      sourceClassificationId: null,
      sourceClassificationLabel: null,
      sourceAdjustmentId: entry.id,
    }));
}

type SummaryRowTemplate = Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">;

function emptySources(): Pick<
  SummaryRowTemplate,
  | "sourceCategoryId"
  | "sourceCategoryLabel"
  | "sourcePhaseId"
  | "sourceWorksheetId"
  | "sourceWorksheetLabel"
  | "sourceClassificationId"
  | "sourceClassificationLabel"
  | "sourceAdjustmentId"
> {
  return {
    sourceCategoryId: null,
    sourceCategoryLabel: null,
    sourcePhaseId: null,
    sourceWorksheetId: null,
    sourceWorksheetLabel: null,
    sourceClassificationId: null,
    sourceClassificationLabel: null,
    sourceAdjustmentId: null,
  };
}

function rowTypeForDimension(dimension: SummaryBuilderDimension): SummaryRowType {
  if (dimension === "phase" || dimension === "category" || dimension === "worksheet" || dimension === "classification") {
    return dimension;
  }
  return "heading";
}

function sourceFieldsForDimension(
  dimension: SummaryBuilderDimension,
  item: SummaryBuilderAxisItem,
): Partial<SummaryRowTemplate> {
  if (dimension === "phase") {
    return { sourcePhaseId: item.sourceId };
  }
  if (dimension === "category") {
    return { sourceCategoryId: item.sourceId, sourceCategoryLabel: item.label };
  }
  if (dimension === "worksheet") {
    return { sourceWorksheetId: item.sourceId, sourceWorksheetLabel: item.label };
  }
  if (dimension === "classification") {
    return { sourceClassificationId: item.sourceId, sourceClassificationLabel: item.label };
  }
  return {};
}

function materializedRow(
  type: SummaryRowType,
  label: string,
  order: number,
  sources: Partial<SummaryRowTemplate>,
  style: SummaryRowStyle = "normal",
): SummaryRowTemplate {
  return {
    type,
    label,
    order,
    visible: true,
    style,
    ...emptySources(),
    ...sources,
  };
}

export function materializeSummaryRowsFromBuilder(
  config: SummaryBuilderConfig,
  totals: RevisionTotals,
): Array<Omit<SummaryRow, "id" | "revisionId" | "computedValue" | "computedCost" | "computedMargin">> {
  const rows: SummaryRowTemplate[] = [];
  const visibleRows = config.rows.filter((row) => row.visible).sort((left, right) => left.order - right.order);
  const visibleColumns = config.columns.filter((column) => column.visible).sort((left, right) => left.order - right.order);

  if (config.mode === "grouped") {
    for (const row of visibleRows) {
      rows.push(materializedRow(rowTypeForDimension(config.rowDimension), row.label, rows.length, sourceFieldsForDimension(config.rowDimension, row)));
    }
  } else if (config.mode === "pivot") {
    for (const row of visibleRows) {
      for (const column of visibleColumns) {
        rows.push(
          materializedRow(
            rowTypeForDimension(config.rowDimension),
            `${row.label} — ${column.label}`,
            rows.length,
            {
              ...sourceFieldsForDimension(config.rowDimension, row),
              ...sourceFieldsForDimension(config.columnDimension, column),
            },
          ),
        );
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
      ...emptySources(),
    });
  }

  if (rows.length === 0) {
    rows.push({
      type: "subtotal",
      label: config.totals.label,
      order: 0,
      visible: true,
      style: "bold",
      ...emptySources(),
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

  const dims = [config.rowDimension, config.columnDimension];
  const sourceFor = (dimension: SummaryBuilderDimension) => (config.rowDimension === dimension ? rowSourceId : columnSourceId);
  const entry =
    dims.includes("worksheet") && dims.includes("category")
      ? totals.worksheetCategoryTotals.find((candidate) => candidate.id === buildPairKey(sourceFor("worksheet"), sourceFor("category")))
      : dims.includes("worksheet") && dims.includes("phase")
        ? totals.worksheetPhaseTotals.find((candidate) => candidate.id === buildPairKey(sourceFor("worksheet"), sourceFor("phase")))
        : dims.includes("worksheet") && dims.includes("classification")
          ? totals.worksheetClassificationTotals.find((candidate) => candidate.id === buildPairKey(sourceFor("worksheet"), sourceFor("classification")))
          : dims.includes("category") && dims.includes("classification")
            ? totals.categoryClassificationTotals.find((candidate) => candidate.id === buildPairKey(sourceFor("category"), sourceFor("classification")))
            : dims.includes("phase") && dims.includes("classification")
              ? totals.phaseClassificationTotals.find((candidate) => candidate.id === buildPairKey(sourceFor("phase"), sourceFor("classification")))
              : totals.phaseCategoryTotals.find((candidate) =>
                  candidate.id === buildPhaseCategoryKey(sourceFor("phase"), sourceFor("category") ?? ""),
                );

  return {
    value: roundMoney(entry?.value ?? 0),
    cost: roundMoney(entry?.cost ?? 0),
    margin: roundMoney(entry?.margin ?? 0),
  };
}

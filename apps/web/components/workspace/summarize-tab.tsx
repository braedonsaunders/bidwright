"use client";

import type { ComponentProps, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  Columns3,
  Eye,
  EyeOff,
  Filter,
  MoreHorizontal,
  Power,
  Plus,
  Search,
  Sigma,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import type {
  AdjustmentCalculationBase,
  AdjustmentFinancialCategory,
  AdjustmentPricingMode,
  AdjustmentTotalEntry,
  ConstructionClassificationLevel,
  ConstructionClassificationStandard,
  CreateAdjustmentInput,
  CostBreakdownEntry,
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
  Badge,
  Button,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as RadixSelect from "@radix-ui/react-select";
import type { ResourceSummaryRow } from "./resource-summary-panel";

type SummarizeSubTab = "summary" | "adjustments" | "pricing" | "costs" | "resources";

const SUMMARIZE_SUBTABS: Array<{ id: SummarizeSubTab; label: string; phase: "required" | "optional" }> = [
  { id: "summary", label: "Rollup", phase: "required" },
  { id: "adjustments", label: "Adjustments", phase: "required" },
  { id: "pricing", label: "Price Build", phase: "required" },
  { id: "costs", label: "Cost Mix", phase: "optional" },
  { id: "resources", label: "Resource Detail", phase: "optional" },
];

const SUMMARY_PRESETS: Array<{ id: SummaryPreset; label: string; description: string }> = [
  { id: "quick_total", label: "Quick Total", description: "Single line sell subtotal." },
  { id: "by_phase", label: "By Phase", description: "One base estimate row per phase." },
  { id: "by_category", label: "By Category", description: "One base estimate row per category." },
  { id: "by_worksheet", label: "By Worksheet", description: "One base estimate row per worksheet." },
  { id: "phase_x_category", label: "By Phase × By Category", description: "Phase rows with category columns." },
];

const CLASSIFICATION_ROLLUP_PRESETS: Array<{
  id: SummaryPreset;
  label: string;
  description: string;
  standard: ConstructionClassificationStandard;
  level: ConstructionClassificationLevel;
}> = [
  { id: "by_masterformat_division", label: "MasterFormat", description: "CSI MasterFormat divisions.", standard: "masterformat", level: "division" },
  { id: "by_uniformat_division", label: "UniFormat", description: "ASTM UniFormat/UniFormat II groups.", standard: "uniformat", level: "division" },
  { id: "by_omniclass_division", label: "OmniClass", description: "OmniClass table/code groups.", standard: "omniclass", level: "division" },
  { id: "by_uniclass_division", label: "Uniclass", description: "Uniclass system groups.", standard: "uniclass", level: "division" },
  { id: "by_din276_division", label: "DIN 276", description: "DIN 276 cost groups.", standard: "din276", level: "division" },
  { id: "by_nrm_division", label: "NRM", description: "New Rules of Measurement groups.", standard: "nrm", level: "division" },
  { id: "by_icms_division", label: "ICMS", description: "International Cost Management Standard groups.", standard: "icms", level: "division" },
  { id: "by_cost_code", label: "Cost Code", description: "Internal company cost codes.", standard: "cost_code", level: "full" },
];

const DIMENSION_LABELS: Record<SummaryBuilderDimension, string> = {
  none: "None",
  phase: "Phase",
  category: "Category",
  worksheet: "Worksheet",
  classification: "Construction Code",
};

const CLASSIFICATION_STANDARD_OPTIONS: Array<{ id: ConstructionClassificationStandard; label: string }> = [
  { id: "masterformat", label: "MasterFormat" },
  { id: "uniformat", label: "UniFormat" },
  { id: "omniclass", label: "OmniClass" },
  { id: "uniclass", label: "Uniclass" },
  { id: "din276", label: "DIN 276" },
  { id: "nrm", label: "NRM" },
  { id: "icms", label: "ICMS" },
  { id: "cost_code", label: "Cost Code" },
];

const CLASSIFICATION_LEVEL_OPTIONS: Array<{ id: ConstructionClassificationLevel; label: string }> = [
  { id: "division", label: "Division" },
  { id: "section", label: "Section" },
  { id: "full", label: "Full Code" },
];

const ADJUSTMENT_MODE_OPTIONS: Array<{ id: AdjustmentPricingMode; label: string }> = [
  { id: "modifier", label: "Percent Modifier" },
  { id: "line_item_additional", label: "Additional Line Item" },
  { id: "option_additional", label: "Optional Add" },
  { id: "option_standalone", label: "Optional Standalone" },
  { id: "line_item_standalone", label: "Standalone Line Item" },
  { id: "custom_total", label: "Custom Total" },
];

const FINANCIAL_CATEGORY_OPTIONS: Array<{ id: AdjustmentFinancialCategory; label: string }> = [
  { id: "overhead", label: "Overhead" },
  { id: "profit", label: "Profit" },
  { id: "tax", label: "Tax" },
  { id: "contingency", label: "Contingency" },
  { id: "insurance", label: "Insurance" },
  { id: "bond", label: "Bond" },
  { id: "allowance", label: "Allowance" },
  { id: "alternate", label: "Alternate" },
  { id: "fee", label: "Fee" },
  { id: "other", label: "Other" },
];

const CALCULATION_BASE_OPTIONS: Array<{ id: AdjustmentCalculationBase; label: string }> = [
  { id: "selected_scope", label: "Selected Scope" },
  { id: "line_subtotal", label: "Line Subtotal" },
  { id: "direct_cost", label: "Direct Cost" },
  { id: "cumulative", label: "Cumulative Total" },
];

const ADJUSTMENT_TEMPLATES: Array<{ id: string; label: string; build: () => CreateAdjustmentInput }> = [
  {
    id: "overhead",
    label: "Overhead %",
    build: () => ({
      kind: "modifier",
      pricingMode: "modifier",
      name: "Overhead",
      type: "Overhead",
      financialCategory: "overhead",
      calculationBase: "selected_scope",
      active: true,
      appliesTo: "All",
      percentage: 0,
      amount: null,
      show: "Yes",
    }),
  },
  {
    id: "profit",
    label: "Profit %",
    build: () => ({
      kind: "modifier",
      pricingMode: "modifier",
      name: "Profit",
      type: "Profit",
      financialCategory: "profit",
      calculationBase: "cumulative",
      active: true,
      appliesTo: "All",
      percentage: 0,
      amount: null,
      show: "Yes",
    }),
  },
  {
    id: "tax",
    label: "Tax %",
    build: () => ({
      kind: "modifier",
      pricingMode: "modifier",
      name: "Tax",
      type: "Tax",
      financialCategory: "tax",
      calculationBase: "cumulative",
      active: true,
      appliesTo: "All",
      percentage: 0,
      amount: null,
      show: "Yes",
    }),
  },
  {
    id: "allowance",
    label: "Fixed Allowance",
    build: () => ({
      kind: "line_item",
      pricingMode: "line_item_additional",
      name: "Allowance",
      description: "",
      type: "Allowance",
      financialCategory: "allowance",
      calculationBase: "line_subtotal",
      active: true,
      amount: 0,
      show: "Yes",
    }),
  },
  {
    id: "option_additional",
    label: "Alternate Add",
    build: () => ({
      kind: "line_item",
      pricingMode: "option_additional",
      name: "Alternate Add",
      description: "",
      type: "Alternate",
      financialCategory: "alternate",
      calculationBase: "line_subtotal",
      active: true,
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
      financialCategory: "alternate",
      calculationBase: "line_subtotal",
      active: true,
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
      financialCategory: "other",
      calculationBase: "line_subtotal",
      active: true,
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
      financialCategory: "other",
      calculationBase: "line_subtotal",
      active: true,
      amount: 0,
      show: "Yes",
    }),
  },
];

function parseNum(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value: number, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(Number.isFinite(value) ? value : 0);
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

function financialCategoryLabel(category: string) {
  return FINANCIAL_CATEGORY_OPTIONS.find((option) => option.id === category)?.label ?? category.replace(/_/g, " ");
}

function calculationBaseLabel(base: string) {
  return CALCULATION_BASE_OPTIONS.find((option) => option.id === base)?.label ?? base.replace(/_/g, " ");
}

const COMMON_RESOURCE_TYPE_LABELS: Record<string, string> = {
  labour: "Labour",
  material: "Material",
  equipment: "Equipment",
  subcontract: "Subcontract",
  travel: "Travel",
  uncategorized: "Uncategorized",
};

function resourceTypeKey(type: string) {
  const key = type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (key === "labor" || key === "labour") return "labour";
  if (key === "materials") return "material";
  if (key === "subcontractor" || key === "subcontractors") return "subcontract";
  return key || "uncategorized";
}

function titleCaseLabel(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resourceTypeLabel(type: string) {
  const key = resourceTypeKey(type);
  return COMMON_RESOURCE_TYPE_LABELS[key] ?? titleCaseLabel(type || key);
}

type ResourceSummaryPosition = NonNullable<ResourceSummaryRow["positions"]>[number];
type ResourcePivotDimension = "phase" | "category" | "vendor" | "type" | "resource" | "worksheet" | "source" | "unit";
type ResourcePivotColumnDimension = ResourcePivotDimension | "none";
type ResourcePivotMetric = "cost" | "hours" | "unit1Hours" | "unit2Hours" | "unit3Hours" | "quantity" | "positions" | "resources" | "avgRate";

interface ResourcePivotSlice {
  key: string;
  label: string;
}

interface ResourcePivotAccumulator {
  key: string;
  label: string;
  totalCost: number;
  totalQuantity: number;
  totalHours: number;
  hoursUnit1: number;
  hoursUnit2: number;
  hoursUnit3: number;
  positionCount: number;
  resources: Set<string>;
  positions: ResourceSummaryPosition[];
}

interface ResourcePivotRow {
  key: string;
  label: string;
  total: ResourcePivotAccumulator;
  cells: Map<string, ResourcePivotAccumulator>;
}

const RESOURCE_PIVOT_DIMENSIONS: Array<{ id: ResourcePivotDimension; label: string }> = [
  { id: "phase", label: "Phase" },
  { id: "category", label: "Category" },
  { id: "vendor", label: "Vendor" },
  { id: "type", label: "Type" },
  { id: "resource", label: "Resource" },
  { id: "worksheet", label: "Worksheet" },
  { id: "source", label: "Source" },
  { id: "unit", label: "Unit" },
];

const RESOURCE_PIVOT_METRICS: Array<{ id: ResourcePivotMetric; label: string; shortLabel: string }> = [
  { id: "cost", label: "Cost", shortLabel: "Cost" },
  { id: "hours", label: "Hours", shortLabel: "Hrs" },
  { id: "unit1Hours", label: "Unit 1 Hours", shortLabel: "U1 Hrs" },
  { id: "unit2Hours", label: "Unit 2 Hours", shortLabel: "U2 Hrs" },
  { id: "unit3Hours", label: "Unit 3 Hours", shortLabel: "U3 Hrs" },
  { id: "quantity", label: "Quantity", shortLabel: "Qty" },
  { id: "positions", label: "Positions", shortLabel: "Pos." },
  { id: "resources", label: "Resources", shortLabel: "Res." },
  { id: "avgRate", label: "Avg Rate", shortLabel: "Rate" },
];

function resourceMetricMeta(metric: ResourcePivotMetric) {
  return RESOURCE_PIVOT_METRICS.find((option) => option.id === metric) ?? { id: "cost" as const, label: "Cost", shortLabel: "Cost" };
}

const RESOURCE_PIVOT_PRESETS: Array<{
  id: string;
  label: string;
  metrics: ResourcePivotMetric[];
  rowDimension: ResourcePivotDimension;
  columnDimension: ResourcePivotColumnDimension;
  typeFilter: string;
}> = [
  { id: "rows_phase", label: "Rows: Phase", metrics: ["cost", "hours"], rowDimension: "phase", columnDimension: "none", typeFilter: "all" },
  { id: "rows_category", label: "Rows: Category", metrics: ["cost", "quantity"], rowDimension: "category", columnDimension: "none", typeFilter: "all" },
  { id: "matrix_phase_category", label: "Phase x Category", metrics: ["cost"], rowDimension: "phase", columnDimension: "category", typeFilter: "all" },
  { id: "matrix_vendor_category", label: "Vendor x Category", metrics: ["cost", "quantity"], rowDimension: "vendor", columnDimension: "category", typeFilter: "all" },
  { id: "matrix_type_vendor", label: "Type x Vendor", metrics: ["cost", "resources"], rowDimension: "type", columnDimension: "vendor", typeFilter: "all" },
];

function fallbackResourcePosition(resource: ResourceSummaryRow): ResourceSummaryPosition {
  return {
    id: resource.id,
    resourceId: resource.id,
    resourceName: resource.name,
    code: resource.code,
    type: resource.type,
    unit: resource.unit,
    quantity: resource.totalQuantity,
    totalCost: resource.totalCost,
    averageUnitRate: resource.averageUnitRate,
    hoursUnit1: resource.hoursUnit1,
    hoursUnit2: resource.hoursUnit2,
    hoursUnit3: resource.hoursUnit3,
    totalHours: resource.totalHours,
    positionCount: resource.positionCount ?? 1,
    phaseLabel: resource.phaseLabel ?? "Unphased",
    categoryLabel: resource.categoryLabel ?? resource.sourceLabel ?? "Uncategorized",
    vendorLabel: resource.vendorLabel ?? "Unassigned Vendor",
    worksheetLabel: resource.worksheetLabel ?? "Worksheet",
    sourceLabel: resource.sourceLabel,
    variantLabel: resource.variantLabel,
    confidence: resource.confidence,
  };
}

function flattenResourcePositions(resources: ResourceSummaryRow[]) {
  return resources.flatMap((resource) => resource.positions?.length ? resource.positions : [fallbackResourcePosition(resource)]);
}

function isHourUnit(unit: string | undefined) {
  const normalized = (unit ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return ["h", "hr", "hrs", "hour", "hours", "mh", "manhour", "manhours", "laborhour", "laborhours", "labourhour", "labourhours"].includes(normalized);
}

function finiteResourceNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isLabourResourceType(type: string) {
  const key = resourceTypeKey(type);
  return key.includes("labour") || key.includes("labor");
}

function resourcePositionHourBreakdown(position: ResourceSummaryPosition) {
  const hoursUnit1 = finiteResourceNumber(position.hoursUnit1);
  const hoursUnit2 = finiteResourceNumber(position.hoursUnit2);
  const hoursUnit3 = finiteResourceNumber(position.hoursUnit3);
  const tierTotal = finiteResourceNumber(position.totalHours);
  const visibleTotal = hoursUnit1 + hoursUnit2 + hoursUnit3;
  const fallbackTotal = visibleTotal > 0 ? visibleTotal : tierTotal;

  return {
    hoursUnit1,
    hoursUnit2,
    hoursUnit3,
    totalHours: fallbackTotal,
  };
}

function resourcePositionHours(position: ResourceSummaryPosition) {
  const breakdown = resourcePositionHourBreakdown(position);
  if (breakdown.totalHours > 0) return breakdown.totalHours;
  if (isHourUnit(position.unit) || isLabourResourceType(position.type)) return Number(position.quantity) || 0;
  return 0;
}

function createResourceAccumulator(key: string, label: string): ResourcePivotAccumulator {
  return {
    key,
    label,
    totalCost: 0,
    totalQuantity: 0,
    totalHours: 0,
    hoursUnit1: 0,
    hoursUnit2: 0,
    hoursUnit3: 0,
    positionCount: 0,
    resources: new Set<string>(),
    positions: [],
  };
}

function addResourcePosition(accumulator: ResourcePivotAccumulator, position: ResourceSummaryPosition) {
  const hourBreakdown = resourcePositionHourBreakdown(position);
  accumulator.totalCost += Number(position.totalCost) || 0;
  accumulator.totalQuantity += Number(position.quantity) || 0;
  accumulator.totalHours += resourcePositionHours(position);
  accumulator.hoursUnit1 += hourBreakdown.hoursUnit1;
  accumulator.hoursUnit2 += hourBreakdown.hoursUnit2;
  accumulator.hoursUnit3 += hourBreakdown.hoursUnit3;
  accumulator.positionCount += position.positionCount ?? 1;
  accumulator.resources.add(position.resourceId || position.resourceName || position.id);
  accumulator.positions.push(position);
}

function resourceDimensionValue(position: ResourceSummaryPosition, dimension: ResourcePivotDimension): ResourcePivotSlice {
  if (dimension === "phase") {
    const label = position.phaseLabel || "Unphased";
    return { key: position.phaseId ?? label.toLowerCase(), label };
  }
  if (dimension === "category") {
    const label = position.categoryLabel || "Uncategorized";
    return { key: position.categoryId ?? label.toLowerCase(), label };
  }
  if (dimension === "vendor") {
    const label = position.vendorLabel || "Unassigned Vendor";
    return { key: label.toLowerCase(), label };
  }
  if (dimension === "type") {
    const key = resourceTypeKey(position.type);
    return { key, label: resourceTypeLabel(position.type) };
  }
  if (dimension === "resource") {
    return { key: position.resourceId || position.resourceName.toLowerCase(), label: position.resourceName };
  }
  if (dimension === "worksheet") {
    const label = position.worksheetLabel || "Worksheet";
    return { key: position.worksheetId ?? label.toLowerCase(), label };
  }
  if (dimension === "source") {
    const label = position.sourceLabel || "Source";
    return { key: label.toLowerCase(), label: titleCaseLabel(label) };
  }
  const label = position.unit || "Unitless";
  return { key: label.toLowerCase(), label };
}

function resourceMetricValue(accumulator: ResourcePivotAccumulator, metric: ResourcePivotMetric) {
  if (metric === "cost") return accumulator.totalCost;
  if (metric === "hours") return accumulator.totalHours;
  if (metric === "unit1Hours") return accumulator.hoursUnit1;
  if (metric === "unit2Hours") return accumulator.hoursUnit2;
  if (metric === "unit3Hours") return accumulator.hoursUnit3;
  if (metric === "quantity") return accumulator.totalQuantity;
  if (metric === "positions") return accumulator.positionCount;
  if (metric === "resources") return accumulator.resources.size;
  const denominator = accumulator.totalQuantity || accumulator.totalHours;
  return denominator > 0 ? accumulator.totalCost / denominator : 0;
}

function resourcePositionMetricValue(position: ResourceSummaryPosition, metric: ResourcePivotMetric) {
  if (metric === "cost") return Number(position.totalCost) || 0;
  if (metric === "hours") return resourcePositionHours(position);
  if (metric === "unit1Hours") return resourcePositionHourBreakdown(position).hoursUnit1;
  if (metric === "unit2Hours") return resourcePositionHourBreakdown(position).hoursUnit2;
  if (metric === "unit3Hours") return resourcePositionHourBreakdown(position).hoursUnit3;
  if (metric === "quantity") return Number(position.quantity) || 0;
  if (metric === "positions") return position.positionCount ?? 1;
  if (metric === "resources") return 1;
  return position.averageUnitRate ?? ((Number(position.quantity) || 0) > 0 ? (Number(position.totalCost) || 0) / Number(position.quantity) : 0);
}

function formatResourceMetric(metric: ResourcePivotMetric, value: number) {
  if (metric === "cost" || metric === "avgRate") return formatMoney(value, metric === "avgRate" ? 2 : 0);
  if (metric === "hours" || metric === "unit1Hours" || metric === "unit2Hours" || metric === "unit3Hours") return `${formatNumber(value, value >= 100 ? 0 : 1)} h`;
  if (metric === "quantity") return formatNumber(value, value >= 100 ? 0 : 2);
  return formatNumber(value, 0);
}

function formatResourceQuantity(position: ResourceSummaryPosition) {
  return `${formatNumber(position.quantity, position.quantity >= 100 ? 0 : 2)}${position.unit ? ` ${position.unit}` : ""}`;
}

function buildResourcePivot(
  positions: ResourceSummaryPosition[],
  rowDimension: ResourcePivotDimension,
  columnDimension: ResourcePivotColumnDimension,
  metric: ResourcePivotMetric,
) {
  const rows = new Map<string, ResourcePivotRow>();
  const columns = new Map<string, ResourcePivotAccumulator>();
  const grandTotal = createResourceAccumulator("total", "Total");

  for (const position of positions) {
    const rowSlice = resourceDimensionValue(position, rowDimension);
    const columnSlice = columnDimension === "none" ? null : resourceDimensionValue(position, columnDimension);
    const row = rows.get(rowSlice.key) ?? {
      key: rowSlice.key,
      label: rowSlice.label,
      total: createResourceAccumulator(rowSlice.key, rowSlice.label),
      cells: new Map<string, ResourcePivotAccumulator>(),
    };

    addResourcePosition(row.total, position);
    addResourcePosition(grandTotal, position);

    if (columnSlice) {
      const column = columns.get(columnSlice.key) ?? createResourceAccumulator(columnSlice.key, columnSlice.label);
      addResourcePosition(column, position);
      columns.set(columnSlice.key, column);

      const cell = row.cells.get(columnSlice.key) ?? createResourceAccumulator(`${rowSlice.key}:${columnSlice.key}`, columnSlice.label);
      addResourcePosition(cell, position);
      row.cells.set(columnSlice.key, cell);
    }

    rows.set(rowSlice.key, row);
  }

  const sortedColumns = Array.from(columns.values()).sort((left, right) => resourceMetricValue(right, metric) - resourceMetricValue(left, metric) || left.label.localeCompare(right.label));
  const sortedRows = Array.from(rows.values()).sort((left, right) => resourceMetricValue(right.total, metric) - resourceMetricValue(left.total, metric) || left.label.localeCompare(right.label));

  return { rows: sortedRows, columns: sortedColumns, grandTotal };
}

function resourceSearchText(position: ResourceSummaryPosition) {
  return [
    position.resourceName,
    position.code,
    position.type,
    position.unit,
    position.phaseLabel,
    position.categoryLabel,
    position.vendorLabel,
    position.worksheetLabel,
    position.sourceLabel,
    position.variantLabel,
    position.itemLabel,
  ].filter(Boolean).join(" ").toLowerCase();
}

function lineSubtotalMetrics(totals: ProjectWorkspaceData["estimate"]["totals"]) {
  const value = totals.pricingLadder?.lineSubtotal ?? totals.subtotal;
  const cost = totals.cost;
  return {
    value,
    cost,
    margin: value === 0 ? 0 : (value - cost) / value,
  };
}

function factorRollupImpact(totals: ProjectWorkspaceData["estimate"]["totals"]) {
  const factors = totals.factorTotals ?? [];
  const valueDelta = factors.reduce((sum, entry) => sum + (entry.active ? entry.valueDelta : 0), 0);
  const hoursDelta = factors.reduce((sum, entry) => sum + (entry.active ? entry.hoursDelta : 0), 0);
  return {
    activeCount: factors.filter((entry) => entry.active).length,
    valueDelta,
    hoursDelta,
    beforeValue: totals.lineSubtotalBeforeFactors ?? null,
    afterValue: totals.pricingLadder?.lineSubtotal ?? totals.subtotal,
  };
}

function buildAxisKey(dimension: SummaryBuilderDimension, sourceId: string | null) {
  return `${dimension}:${sourceId ?? "none"}`;
}

const DEFAULT_CLASSIFICATION_CONFIG: SummaryBuilderConfig["classification"] = {
  standard: "masterformat",
  level: "division",
  includeUnclassified: true,
};

function normalizeClassificationConfig(
  raw?: Partial<SummaryBuilderConfig["classification"]> | null,
): SummaryBuilderConfig["classification"] {
  const standard = raw?.standard ?? DEFAULT_CLASSIFICATION_CONFIG.standard;
  return {
    standard,
    level: standard === "cost_code" ? "full" : raw?.level ?? DEFAULT_CLASSIFICATION_CONFIG.level,
    includeUnclassified: raw?.includeUnclassified !== false,
  };
}

function fallbackColumnDimension(rowDimension: SummaryBuilderDimension): SummaryBuilderDimension {
  return (["phase", "category", "classification", "worksheet"] as SummaryBuilderDimension[]).find(
    (dimension) => dimension !== rowDimension,
  ) ?? "category";
}

function classificationPresetConfig(preset: SummaryPreset): SummaryBuilderConfig["classification"] | null {
  const match = CLASSIFICATION_ROLLUP_PRESETS.find((entry) => entry.id === preset);
  if (!match) return null;
  return normalizeClassificationConfig({
    standard: match.standard,
    level: match.level,
    includeUnclassified: true,
  });
}

function presetForClassification(classification: SummaryBuilderConfig["classification"]): SummaryPreset {
  if (classification.standard === "cost_code") return "by_cost_code";
  if (classification.level !== "division") return "custom";
  return CLASSIFICATION_ROLLUP_PRESETS.find((entry) => entry.standard === classification.standard && entry.level === classification.level)?.id ?? "custom";
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

function inferPresetFromBuilder(
  config: Pick<SummaryBuilderConfig, "mode" | "rowDimension" | "columnDimension"> & Partial<Pick<SummaryBuilderConfig, "classification">>,
): SummaryPreset {
  if (config.mode === "total" || config.rowDimension === "none") return "quick_total";
  if (config.mode === "grouped" && config.rowDimension === "phase") return "by_phase";
  if (config.mode === "grouped" && config.rowDimension === "category") return "by_category";
  if (config.mode === "grouped" && config.rowDimension === "worksheet") return "by_worksheet";
  if (config.mode === "grouped" && config.rowDimension === "classification") {
    const classification = normalizeClassificationConfig(config.classification);
    return presetForClassification(classification);
  }
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
  const classification = normalizeClassificationConfig(raw.classification);

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
    preset: raw.preset ?? "custom",
    mode,
    rowDimension,
    columnDimension,
    rows: mergeAxisItems(rowDimension, raw.rows, totals),
    columns: mergeAxisItems(columnDimension, raw.columns, totals),
    classification,
    totals: {
      label: raw.totals?.label?.trim() || "Line Sell Subtotal",
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
    return normalizeBuilder({ version: 1, preset, mode: "total", rowDimension: "none", columnDimension: "none", rows: [], columns: [], classification: DEFAULT_CLASSIFICATION_CONFIG, totals: { label: "Line Sell Subtotal", visible: true } }, totals);
  }
  if (preset === "by_phase") {
    return normalizeBuilder({ version: 1, preset, mode: "grouped", rowDimension: "phase", columnDimension: "none", rows: [], columns: [], classification: DEFAULT_CLASSIFICATION_CONFIG, totals: { label: "Line Sell Subtotal", visible: true } }, totals);
  }
  if (preset === "by_category") {
    return normalizeBuilder({ version: 1, preset, mode: "grouped", rowDimension: "category", columnDimension: "none", rows: [], columns: [], classification: DEFAULT_CLASSIFICATION_CONFIG, totals: { label: "Line Sell Subtotal", visible: true } }, totals);
  }
  if (preset === "by_worksheet") {
    return normalizeBuilder({ version: 1, preset, mode: "grouped", rowDimension: "worksheet", columnDimension: "none", rows: [], columns: [], classification: DEFAULT_CLASSIFICATION_CONFIG, totals: { label: "Line Sell Subtotal", visible: true } }, totals);
  }
  const classificationPreset = classificationPresetConfig(preset);
  if (classificationPreset) {
    return normalizeBuilder({ version: 1, preset, mode: "grouped", rowDimension: "classification", columnDimension: "none", rows: [], columns: [], classification: classificationPreset, totals: { label: "Line Sell Subtotal", visible: true } }, totals);
  }
  return normalizeBuilder({ version: 1, preset: preset === "custom" ? "phase_x_category" : preset, mode: "pivot", rowDimension: "phase", columnDimension: "category", rows: [], columns: [], classification: DEFAULT_CLASSIFICATION_CONFIG, totals: { label: "Line Sell Subtotal", visible: true } }, totals);
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

function buildPairKey(leftId: string | null | undefined, rightId: string | null | undefined) {
  return `${leftId ?? "__unphased__"}::${rightId ?? ""}`;
}

function resolvePivotCell(
  config: SummaryBuilderConfig,
  row: SummaryBuilderAxisItem,
  column: SummaryBuilderAxisItem,
  totals: ProjectWorkspaceData["estimate"]["totals"],
) {
  const empty = { id: "", name: "", label: "", value: 0, cost: 0, margin: 0 };
  const dims = [config.rowDimension, config.columnDimension];
  const sourceFor = (dimension: SummaryBuilderDimension) => (config.rowDimension === dimension ? row.sourceId : column.sourceId);
  if (dims.includes("worksheet") && dims.includes("category")) {
    const entry = (totals.worksheetCategoryTotals ?? []).find((candidate) => candidate.id === buildPairKey(sourceFor("worksheet"), sourceFor("category")));
    return entry ?? empty;
  }
  if (dims.includes("worksheet") && dims.includes("phase")) {
    const entry = (totals.worksheetPhaseTotals ?? []).find((candidate) => candidate.id === buildPairKey(sourceFor("worksheet"), sourceFor("phase")));
    return entry ?? empty;
  }
  if (dims.includes("worksheet") && dims.includes("classification")) {
    const entry = (totals.worksheetClassificationTotals ?? []).find((candidate) => candidate.id === buildPairKey(sourceFor("worksheet"), sourceFor("classification")));
    return entry ?? empty;
  }
  if (dims.includes("category") && dims.includes("classification")) {
    const entry = (totals.categoryClassificationTotals ?? []).find((candidate) => candidate.id === buildPairKey(sourceFor("category"), sourceFor("classification")));
    return entry ?? empty;
  }
  if (dims.includes("phase") && dims.includes("classification")) {
    const entry = (totals.phaseClassificationTotals ?? []).find((candidate) => candidate.id === buildPairKey(sourceFor("phase"), sourceFor("classification")));
    return entry ?? empty;
  }
  const entry = totals.phaseCategoryTotals.find((candidate) => candidate.id === buildPhaseCategoryKey(sourceFor("phase"), sourceFor("category") ?? ""));
  return entry ?? empty;
}

function builderSignature(config: SummaryBuilderConfig) {
  return JSON.stringify({
    version: config.version,
    preset: config.preset,
    mode: config.mode,
    rowDimension: config.rowDimension,
    columnDimension: config.columnDimension,
    classification: config.classification,
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
  if (dimension === "worksheet") return (totals.worksheetTotals ?? []).find((entry) => entry.id === sourceId) ?? null;
  if (dimension === "classification") return (totals.classificationTotals ?? []).find((entry) => entry.id === sourceId) ?? null;
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

function MetricCell({ value, className }: { value: string; className?: string }) {
  return <td className={cn("px-3 py-2 text-right font-mono text-[11px] font-medium text-fg/80", className)}>{value}</td>;
}

export function SummarizeTab({
  workspace,
  resourceSummaryRows = [],
  onApply,
}: {
  workspace: ProjectWorkspaceData;
  resourceSummaryRows?: ResourceSummaryRow[];
  onApply: (next: WorkspaceResponse) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<SummarizeSubTab>("summary");
  const [nextAdjustmentTemplate, setNextAdjustmentTemplate] = useState("overhead");

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

  function handleClassificationConfigChange(patch: Partial<SummaryBuilderConfig["classification"]>) {
    const nextClassification = normalizeClassificationConfig({
      ...draftBuilder.classification,
      ...patch,
    });
    persistBuilder({
      ...draftBuilder,
      classification: nextClassification,
    });
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
  const activeClassificationPreset = CLASSIFICATION_ROLLUP_PRESETS.find((preset) => preset.id === draftBuilder.preset);
  const classificationMenuActive = Boolean(activeClassificationPreset) || draftBuilder.rowDimension === "classification" || draftBuilder.columnDimension === "classification";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pb-1">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
        {SUMMARIZE_SUBTABS.map((tab, index) => (
          <Fragment key={tab.id}>
            {index > 0 && tab.phase !== SUMMARIZE_SUBTABS[index - 1]?.phase ? (
              <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              onClick={() => {
                setActiveSubTab(tab.id);
                setError(null);
              }}
              className={cn(
                "whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                activeSubTab === tab.id ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60",
              )}
            >
              {tab.label}
            </button>
          </Fragment>
        ))}
      </div>

      {error ? (
        <div className="shrink-0 rounded-lg border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">{error}</div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {activeSubTab === "summary" ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="shrink-0 border-b border-line px-4 py-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-fg">Rollup</h4>
                    <p className="mt-1 max-w-2xl text-xs text-fg/55">Choose how the factor-adjusted line subtotal is organized before quote-level adjustments.</p>
                  </div>
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
                            ? "border-orange-400 bg-orange-500 text-white shadow-sm"
                            : "border-line bg-panel2/30 text-fg/70 hover:border-orange-500/30 hover:bg-orange-500/8 hover:text-fg",
                        )}
                      >
                        {preset.label}
                      </button>
                    );
                  })}

                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <button
                        type="button"
                        title="More construction rollups"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                          classificationMenuActive
                            ? "border-orange-400 bg-orange-500 text-white shadow-sm"
                            : "border-line bg-panel2/30 text-fg/70 hover:border-orange-500/30 hover:bg-orange-500/8 hover:text-fg",
                        )}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                        <span>{activeClassificationPreset?.label ?? "More"}</span>
                        <ChevronDown className="h-3 w-3 opacity-75" />
                      </button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        className="z-[100] w-64 rounded-lg border border-line bg-panel p-1 shadow-xl"
                        sideOffset={6}
                        align="start"
                      >
                        <DropdownMenu.Label className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/45">
                          Construction Codes
                        </DropdownMenu.Label>
                        {CLASSIFICATION_ROLLUP_PRESETS.map((preset) => {
                          const active = draftBuilder.preset === preset.id;
                          return (
                            <DropdownMenu.Item
                              key={preset.id}
                              className={cn(
                                "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-xs outline-none transition-colors hover:bg-panel2",
                                active ? "bg-orange-500/15 text-orange-200" : "text-fg/70",
                              )}
                              onSelect={() => handlePreset(preset.id)}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium">{preset.label}</div>
                                <div className="truncate text-[11px] text-fg/45">{preset.description}</div>
                              </div>
                              {active ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                            </DropdownMenu.Item>
                          );
                        })}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>

                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel2/25 px-2 py-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-fg/45">Breakout</span>
                      <BuilderSelect
                        value={draftBuilder.rowDimension}
                        onValueChange={(value) => handleRowDimensionChange(value as SummaryBuilderDimension)}
                        options={[
                          { value: "none", label: "Line Subtotal Only" },
                          { value: "phase", label: "Phase" },
                          { value: "category", label: "Category" },
                          { value: "worksheet", label: "Worksheet" },
                          { value: "classification", label: "Construction Code" },
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
                          ...(draftBuilder.rowDimension !== "worksheet" ? [{ value: "worksheet", label: "Worksheet" }] : []),
                          ...(draftBuilder.rowDimension !== "classification" ? [{ value: "classification", label: "Construction Code" }] : []),
                        ]}
                        className="h-8 min-w-[132px] text-xs"
                      />
                    </div>

                    {(draftBuilder.rowDimension === "classification" || draftBuilder.columnDimension === "classification") ? (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-panel2/25 px-2 py-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-fg/45">Code</span>
                        <BuilderSelect
                          value={draftBuilder.classification.standard}
                          onValueChange={(value) => handleClassificationConfigChange({ standard: value as ConstructionClassificationStandard })}
                          options={CLASSIFICATION_STANDARD_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                          className="h-8 min-w-[132px] text-xs"
                        />
                        <BuilderSelect
                          value={draftBuilder.classification.level}
                          onValueChange={(value) => handleClassificationConfigChange({ level: value as ConstructionClassificationLevel })}
                          disabled={draftBuilder.classification.standard === "cost_code"}
                          options={CLASSIFICATION_LEVEL_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
                          className="h-8 min-w-[112px] text-xs"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-3 pb-4 pt-3">
              <SummaryBreakdownPanel
                builder={draftBuilder}
                totals={totals}
                rows={sortedRows}
                columns={sortedColumns}
                busy={isPending}
                onMoveRow={moveRow}
                onUpdateRow={updateRow}
                onMoveColumn={moveColumn}
                onUpdateColumn={updateColumn}
              />
            </div>
          </section>
        ) : null}

        {activeSubTab === "adjustments" ? (
          <AdjustmentEditorPanel
            adjustments={adjustments}
            adjustmentTotalsById={adjustmentTotalsById}
            categoryOptions={modifierTargetOptions}
            nextAdjustmentTemplate={nextAdjustmentTemplate}
            busy={isPending}
            onNextAdjustmentTemplateChange={setNextAdjustmentTemplate}
            onAddAdjustment={handleAddAdjustment}
            onMoveAdjustment={handleMoveAdjustment}
            onPatchAdjustment={handlePatchAdjustment}
            onDeleteAdjustment={handleDeleteAdjustment}
          />
        ) : null}
        {activeSubTab === "pricing" ? <PricingLadderPanel totals={totals} /> : null}
        {activeSubTab === "costs" ? <CostBreakdownPanel entries={totals.costBreakdown ?? []} totalCost={totals.cost} /> : null}
        {activeSubTab === "resources" ? <ResourceBreakdownPanel resources={resourceSummaryRows} /> : null}
      </div>
    </div>
  );
}

function FinancialMetric({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-line bg-bg/35 p-3", highlight && "border-orange-500/35 bg-orange-500/10")}>
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-fg/45">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

function FactorRollupNotice({ totals }: { totals: ProjectWorkspaceData["estimate"]["totals"] }) {
  const impact = factorRollupImpact(totals);
  if (impact.activeCount === 0 || (Math.abs(impact.valueDelta) < 0.005 && Math.abs(impact.hoursDelta) < 0.005)) return null;
  return (
    <div className="border-b border-line bg-accent/5 px-3 py-2 text-[11px] text-fg/60">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{impact.activeCount} factor{impact.activeCount === 1 ? "" : "s"} included</Badge>
        {impact.beforeValue != null ? <span>Raw line subtotal {formatMoney(impact.beforeValue)}</span> : null}
        <span className={cn("font-mono", impact.valueDelta >= 0 ? "text-warning" : "text-success")}>
          {impact.valueDelta >= 0 ? "+" : ""}{formatMoney(impact.valueDelta)}
        </span>
        {Math.abs(impact.hoursDelta) >= 0.005 ? (
          <span className={cn("font-mono", impact.hoursDelta >= 0 ? "text-warning" : "text-success")}>
            {impact.hoursDelta >= 0 ? "+" : ""}{Math.round(impact.hoursDelta * 100) / 100} hr
          </span>
        ) : null}
        <span>Rollup values below are factor-adjusted before quote adjustments.</span>
      </div>
    </div>
  );
}

function PricingLadderPanel({ totals }: { totals: ProjectWorkspaceData["estimate"]["totals"] }) {
  const ladder = totals.pricingLadder;
  const rows = ladder?.rows ?? [];
  const factorRows = rows.filter((row) => row.rowType === "factor");
  const adjustmentRows = rows.filter((row) => row.rowType === "adjustment");
  const visibleStatementRows = rows.filter((row) => row.rowType !== "profit");

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="text-sm font-semibold text-fg">Price Build</div>
        <div className="mt-1 text-[11px] text-fg/55">Read-only audit from direct cost through factors, line subtotal, adjustments, and customer total.</div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <FinancialMetric label="Direct Cost" value={formatMoney(ladder?.directCost ?? totals.cost)} />
          <FinancialMetric label="Line Subtotal" value={formatMoney(ladder?.lineSubtotal ?? totals.subtotal)} />
          <FinancialMetric label="Customer Total" value={formatMoney(ladder?.grandTotal ?? totals.subtotal)} highlight />
          <FinancialMetric label="Margin" value={formatPercent(ladder?.internalMargin ?? totals.estimatedMargin)} />
        </div>

        <div className="overflow-hidden rounded-xl border border-line">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="sticky top-0 z-10 bg-panel2/80">
              <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                <th className="px-3 py-2">Layer</th>
                <th className="px-3 py-2 text-right">Base</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Running</th>
              </tr>
            </thead>
            <tbody>
              {visibleStatementRows.map((row) => (
                <tr key={row.id} className={cn("border-t border-line/60", (!row.active || !row.visible) && "opacity-50", row.rowType === "total" && "bg-panel2/35 font-semibold")}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-fg/80">{row.label}</div>
                    <div className="mt-0.5 text-[10px] text-fg/45">
                      {row.rowType === "factor"
                        ? `Productivity factor · ${row.appliesTo ?? "Scoped"}`
                        : row.rowType === "adjustment"
                        ? `${financialCategoryLabel(row.financialCategory)} · ${calculationBaseLabel(row.calculationBase ?? "selected_scope")}`
                        : financialCategoryLabel(row.financialCategory)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/65">{formatMoney(row.baseAmount)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/80">{formatMoney(row.value)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-fg">{formatMoney(row.runningTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {factorRows.length === 0 && adjustmentRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg/45">No estimate factors or quote adjustments in the price build.</div>
        ) : null}
      </div>
    </section>
  );
}

function AdjustmentEditorPanel({
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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="text-sm font-semibold text-fg">Adjustments</div>
        <div className="mt-1 text-[11px] text-fg/55">Enter overhead, profit, tax, allowances, alternates, and custom totals after the base estimate.</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <section className="min-h-0 overflow-hidden rounded-2xl border border-line bg-panel2/20">
          <table className="w-full min-w-[1080px] text-xs">
            <tbody>
              <AdjustmentSectionRows
                colSpan={9}
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
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}

type CostMixMode = "contribution" | "marginRisk" | "concentration" | "lineScale";
type CostMixFocusColumn = "cost" | "margin" | "share" | "avgLine";

interface CostMixRow {
  id: string;
  label: string;
  type: string;
  lines: number;
  quantity: number;
  cost: number;
  sell: number;
  profit: number;
  margin: number;
  markup: number;
  costShare: number;
  sellShare: number;
  avgCostPerLine: number;
  signal: {
    label: string;
    tone: "default" | "success" | "warning" | "danger" | "info";
  };
}

interface CostMixInsight {
  label: string;
  value: string;
  tone: "default" | "success" | "warning" | "danger" | "info";
}

const COST_MIX_MODES: Array<{
  id: CostMixMode;
  label: string;
  sortLabel: string;
  focusColumn: CostMixFocusColumn;
  tone: "default" | "success" | "warning" | "danger" | "info";
}> = [
  { id: "contribution", label: "Contribution", sortLabel: "Ranked by direct cost", focusColumn: "cost", tone: "info" },
  { id: "marginRisk", label: "Margin Risk", sortLabel: "Ranked by weakest margin", focusColumn: "margin", tone: "warning" },
  { id: "concentration", label: "Concentration", sortLabel: "Ranked by cost share", focusColumn: "share", tone: "info" },
  { id: "lineScale", label: "Line Scale", sortLabel: "Ranked by average line", focusColumn: "avgLine", tone: "default" },
];

function costMixModeMeta(mode: CostMixMode) {
  return COST_MIX_MODES.find((option) => option.id === mode) ?? COST_MIX_MODES[0];
}

function costMixSignal(
  row: Omit<CostMixRow, "signal">,
  blendedMargin: number,
): CostMixRow["signal"] {
  if (row.sell > 0 && row.cost <= 0) return { label: "No Cost Basis", tone: "warning" };
  if (row.profit < 0) return { label: "Loss", tone: "danger" };
  if (row.margin < blendedMargin - 0.05) return { label: "Margin Drag", tone: "warning" };
  if (row.costShare >= 0.35) return { label: "Concentrated", tone: "info" };
  if (row.margin > blendedMargin + 0.05) return { label: "Accretive", tone: "success" };
  return { label: "In Range", tone: "default" };
}

function buildCostMixRows(entries: CostBreakdownEntry[], totalCost: number, totalSell: number, blendedMargin: number): CostMixRow[] {
  return entries.map((entry) => {
    const cost = Number(entry.cost) || 0;
    const sell = Number(entry.value) || 0;
    const profit = sell - cost;
    const lines = Number(entry.itemCount) || 0;
    const rowBase = {
      id: entry.id,
      label: entry.label,
      type: entry.type,
      lines,
      quantity: Number(entry.quantity) || 0,
      cost,
      sell,
      profit,
      margin: sell > 0 ? profit / sell : Number(entry.margin) || 0,
      markup: cost > 0 ? profit / cost : 0,
      costShare: totalCost > 0 ? cost / totalCost : Number(entry.shareOfCost) || 0,
      sellShare: totalSell > 0 ? sell / totalSell : 0,
      avgCostPerLine: lines > 0 ? cost / lines : 0,
    };

    return {
      ...rowBase,
      signal: costMixSignal(rowBase, blendedMargin),
    };
  });
}

function sortCostMixRows(rows: CostMixRow[], mode: CostMixMode) {
  return [...rows].sort((left, right) => {
    if (mode === "marginRisk") {
      return left.margin - right.margin || right.cost - left.cost;
    }
    if (mode === "concentration") {
      return right.costShare - left.costShare || right.cost - left.cost;
    }
    if (mode === "lineScale") {
      return right.avgCostPerLine - left.avgCostPerLine || right.lines - left.lines;
    }
    return right.cost - left.cost || right.profit - left.profit;
  });
}

function buildCostMixInsights(rows: CostMixRow[], blendedMargin: number) {
  const largest = [...rows].sort((left, right) => right.costShare - left.costShare)[0];
  const drag = rows
    .filter((row) => row.profit < 0 || row.margin < blendedMargin - 0.05)
    .sort((left, right) => left.margin - right.margin || right.cost - left.cost)[0];
  const profitDriver = [...rows].sort((left, right) => right.profit - left.profit)[0];
  const largestLine = [...rows].sort((left, right) => right.avgCostPerLine - left.avgCostPerLine)[0];

  const insights: Array<CostMixInsight | null> = [
    largest
      ? { label: "Cost concentration", value: `${largest.label} ${formatPercent(largest.costShare, 0)}`, tone: largest.costShare >= 0.35 ? "warning" as const : "default" as const }
      : null,
    drag
      ? { label: "Margin drag", value: `${drag.label} ${formatPercent(drag.margin)}`, tone: drag.profit < 0 ? "danger" as const : "warning" as const }
      : { label: "Margin drag", value: "None flagged", tone: "success" as const },
    profitDriver
      ? { label: "Profit driver", value: `${profitDriver.label} ${formatMoney(profitDriver.profit)}`, tone: "info" as const }
      : null,
    largestLine
      ? { label: "Largest avg line", value: `${largestLine.label} ${formatMoney(largestLine.avgCostPerLine)}`, tone: "default" as const }
      : null,
  ];

  return insights.filter((insight): insight is CostMixInsight => insight !== null);
}

function CostMixSummaryChip({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "warning" | "danger" | "info" }) {
  const toneClass = {
    default: "border-line bg-bg/30",
    success: "border-success/25 bg-success/8",
    warning: "border-warning/25 bg-warning/8",
    danger: "border-danger/25 bg-danger/8",
    info: "border-accent/25 bg-accent/8",
  }[tone];

  return (
    <div className={cn("min-w-0 rounded-lg border px-2.5 py-2", toneClass)}>
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-fg/40">{label}</div>
      <div className="mt-1 truncate font-mono text-[12px] font-semibold text-fg">{value}</div>
    </div>
  );
}

function costMixInsightBadgeLabel(tone: CostMixInsight["tone"]) {
  if (tone === "success") return "OK";
  if (tone === "danger") return "Risk";
  if (tone === "warning") return "Watch";
  if (tone === "info") return "Driver";
  return "Track";
}

function costMixModeValue(row: CostMixRow, mode: CostMixMode) {
  if (mode === "marginRisk") return `Margin ${formatPercent(row.margin)}`;
  if (mode === "concentration") return `Share ${formatPercent(row.costShare, 0)}`;
  if (mode === "lineScale") return `Avg ${formatMoney(row.avgCostPerLine)}`;
  return `Cost ${formatMoney(row.cost)}`;
}

function costMixFocusClass(mode: CostMixMode, column: CostMixFocusColumn) {
  return costMixModeMeta(mode).focusColumn === column ? "bg-orange-500/10 text-fg" : "";
}

function CostMixHeaderCell({
  mode,
  column,
  className,
  children,
}: {
  mode: CostMixMode;
  column: CostMixFocusColumn;
  className?: string;
  children: ReactNode;
}) {
  const active = costMixModeMeta(mode).focusColumn === column;
  return (
    <th className={cn(className, active && "bg-orange-500/10 text-fg shadow-[inset_0_-2px_0_hsl(var(--accent))]")}>
      <span className="inline-flex items-center justify-end gap-1">
        {children}
        {active ? <ArrowDown className="h-3 w-3" /> : null}
      </span>
    </th>
  );
}

function CostBreakdownPanel({ entries, totalCost }: { entries: CostBreakdownEntry[]; totalCost: number }) {
  const [mode, setMode] = useState<CostMixMode>("contribution");
  const totalSell = entries.reduce((sum, entry) => sum + (Number(entry.value) || 0), 0);
  const totalProfit = totalSell - totalCost;
  const blendedMargin = totalSell > 0 ? totalProfit / totalSell : 0;
  const rows = useMemo(() => buildCostMixRows(entries, totalCost, totalSell, blendedMargin), [blendedMargin, entries, totalCost, totalSell]);
  const sortedRows = useMemo(() => sortCostMixRows(rows, mode), [mode, rows]);
  const insights = useMemo(() => buildCostMixInsights(rows, blendedMargin), [blendedMargin, rows]);
  const activeMode = costMixModeMeta(mode);

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="text-sm font-semibold text-fg">Cost Mix</div>
            <Badge tone="info" className="h-6">{formatNumber(entries.length, 0)} buckets</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {COST_MIX_MODES.map((option) => (
              <Button
                key={option.id}
                type="button"
                variant={mode === option.id ? "accent" : "ghost"}
                size="xs"
                className={cn("h-7 px-2 text-[11px]", mode === option.id && "shadow-[inset_0_-2px_0_currentColor]")}
                onClick={() => setMode(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-bg/25 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Badge tone={activeMode.tone}>{activeMode.label}</Badge>
            <span className="truncate text-xs font-medium text-fg/70">{activeMode.sortLabel}</span>
          </div>
          <span className="font-mono text-[11px] text-fg/45">{formatNumber(sortedRows.length, 0)} ranked</span>
        </div>

        <div className="grid gap-2 md:grid-cols-4">
          <CostMixSummaryChip label="Direct Cost" value={formatMoney(totalCost)} />
          <CostMixSummaryChip label="Sell Value" value={formatMoney(totalSell)} />
          <CostMixSummaryChip label="Gross Profit" value={formatMoney(totalProfit)} tone={totalProfit < 0 ? "danger" : "success"} />
          <CostMixSummaryChip label="Blended Margin" value={formatPercent(blendedMargin)} tone={blendedMargin < 0 ? "danger" : "info"} />
        </div>

        {entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg/45">No estimate lines to break down yet.</div>
        ) : (
          <>
            <div className="grid gap-2 lg:grid-cols-4">
              {insights.map((insight) => (
                <div key={`${insight.label}:${insight.value}`} className="rounded-lg border border-line bg-bg/25 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">{insight.label}</span>
                    <Badge tone={insight.tone}>{costMixInsightBadgeLabel(insight.tone)}</Badge>
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-fg/75" title={insight.value}>{insight.value}</div>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-line bg-bg/15">
              <table className="w-full min-w-[1160px] text-xs">
                <thead className="sticky top-0 z-10 bg-panel2/95">
                  <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                    <th className="sticky left-0 z-20 min-w-[220px] bg-panel px-3 py-2 shadow-[1px_0_0_hsl(var(--line))]">Bucket</th>
                    <th className="w-[88px] px-3 py-2 text-right">Lines</th>
                    <CostMixHeaderCell mode={mode} column="cost" className="w-[140px] px-3 py-2 text-right">Cost</CostMixHeaderCell>
                    <th className="w-[140px] px-3 py-2 text-right">Sell</th>
                    <th className="w-[140px] px-3 py-2 text-right">Profit</th>
                    <CostMixHeaderCell mode={mode} column="margin" className="w-[110px] px-3 py-2 text-right">Margin</CostMixHeaderCell>
                    <th className="w-[110px] px-3 py-2 text-right">Markup</th>
                    <CostMixHeaderCell mode={mode} column="share" className="w-[180px] px-3 py-2">Cost Mix</CostMixHeaderCell>
                    <CostMixHeaderCell mode={mode} column="avgLine" className="w-[140px] px-3 py-2 text-right">Avg Line</CostMixHeaderCell>
                    <th className="w-[130px] px-3 py-2">Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, index) => (
                    <tr key={row.id} className="group border-b border-line/60 last:border-b-0 hover:bg-panel2/20">
                      <td className="sticky left-0 z-10 bg-panel px-3 py-2 shadow-[1px_0_0_hsl(var(--line))]">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge tone={activeMode.tone} className="shrink-0 font-mono">#{index + 1}</Badge>
                          <div className="truncate font-medium text-fg/85" title={row.label}>{row.label}</div>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[10px] text-fg/40">
                          <span className="truncate">{titleCaseLabel(row.type || "Bucket")}</span>
                          <span className="font-mono text-fg/55">{costMixModeValue(row, mode)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/65">{formatNumber(row.lines, 0)}</td>
                      <td className={cn("px-3 py-2 text-right font-mono text-[11px] font-semibold text-fg", costMixFocusClass(mode, "cost"))}>{formatMoney(row.cost)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/75">{formatMoney(row.sell)}</td>
                      <td className={cn("px-3 py-2 text-right font-mono text-[11px] font-semibold", row.profit < 0 ? "text-danger" : "text-success")}>{formatMoney(row.profit)}</td>
                      <td className={cn("px-3 py-2 text-right font-mono text-[11px]", row.margin < blendedMargin - 0.05 ? "text-warning" : "text-fg/75", costMixFocusClass(mode, "margin"))}>{formatPercent(row.margin)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/65">{formatPercent(row.markup)}</td>
                      <td className={cn("px-3 py-2", costMixFocusClass(mode, "share"))}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel2">
                            <div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.min(100, Math.max(0, row.costShare * 100))}%` }} />
                          </div>
                          <span className="w-10 text-right font-mono text-[10px] text-fg/45">{formatPercent(row.costShare, 0)}</span>
                        </div>
                      </td>
                      <td className={cn("px-3 py-2 text-right font-mono text-[11px] text-fg/65", costMixFocusClass(mode, "avgLine"))}>{formatMoney(row.avgCostPerLine)}</td>
                      <td className="px-3 py-2"><Badge tone={row.signal.tone}>{row.signal.label}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function ResourceMetricMenu({
  metrics,
  onChange,
}: {
  metrics: ResourcePivotMetric[];
  onChange: (metrics: ResourcePivotMetric[]) => void;
}) {
  const activeMetrics = metrics.length > 0 ? metrics : ["cost" as ResourcePivotMetric];

  function toggleMetric(metric: ResourcePivotMetric) {
    if (activeMetrics.includes(metric)) {
      if (activeMetrics.length === 1) return;
      onChange(activeMetrics.filter((candidate) => candidate !== metric));
      return;
    }
    onChange([...activeMetrics, metric]);
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="secondary" size="sm" className="h-8 min-w-[180px] justify-between px-2.5 text-xs">
          <span className="flex min-w-0 items-center gap-1.5">
            <Sigma className="h-3.5 w-3.5 shrink-0 text-fg/45" />
            <span className="truncate">
              {activeMetrics.map((metric) => resourceMetricMeta(metric).shortLabel).join(", ")}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg/40" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="z-[100] w-56 rounded-lg border border-line bg-panel p-1 shadow-xl" sideOffset={6} align="start">
          <DropdownMenu.Label className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg/45">
            Values
          </DropdownMenu.Label>
          {RESOURCE_PIVOT_METRICS.map((option) => {
            const checked = activeMetrics.includes(option.id);
            return (
              <DropdownMenu.Item
                key={option.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs outline-none transition-colors hover:bg-panel2",
                  checked ? "text-orange-200" : "text-fg/70",
                )}
                onSelect={(event) => {
                  event.preventDefault();
                  toggleMetric(option.id);
                }}
              >
                <span className={cn("flex h-4 w-4 items-center justify-center rounded border", checked ? "border-orange-400 bg-orange-500 text-white" : "border-line text-transparent")}>
                  <Check className="h-3 w-3" />
                </span>
                <span>{option.label}</span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ResourceBreakdownPanel({ resources }: { resources: ResourceSummaryRow[] }) {
  const positions = useMemo(() => flattenResourcePositions(resources), [resources]);
  const [metrics, setMetrics] = useState<ResourcePivotMetric[]>(["cost"]);
  const [rowDimension, setRowDimension] = useState<ResourcePivotDimension>("type");
  const [columnDimension, setColumnDimension] = useState<ResourcePivotColumnDimension>("category");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedSlice, setSelectedSlice] = useState<{ rowKey: string; columnKey: string | null } | null>(null);
  const activeMetrics = metrics.length > 0 ? metrics : ["cost" as ResourcePivotMetric];
  const primaryMetric = activeMetrics[0] ?? "cost";
  const showHourTiers = activeMetrics.some((metric) => metric === "hours" || metric === "unit1Hours" || metric === "unit2Hours" || metric === "unit3Hours");

  const typeOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string; count: number }>();
    for (const position of positions) {
      const value = resourceTypeKey(position.type);
      const current = options.get(value) ?? { value, label: resourceTypeLabel(position.type), count: 0 };
      current.count += 1;
      options.set(value, current);
    }
    return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label));
  }, [positions]);

  const filteredPositions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return positions.filter((position) => {
      if (typeFilter !== "all" && resourceTypeKey(position.type) !== typeFilter) return false;
      if (!normalizedQuery) return true;
      return resourceSearchText(position).includes(normalizedQuery);
    });
  }, [positions, query, typeFilter]);

  const pivot = useMemo(
    () => buildResourcePivot(filteredPositions, rowDimension, columnDimension, primaryMetric),
    [filteredPositions, rowDimension, columnDimension, primaryMetric],
  );

  const selectedPositions = useMemo(() => {
    const source = selectedSlice
      ? filteredPositions.filter((position) => {
          const row = resourceDimensionValue(position, rowDimension);
          if (row.key !== selectedSlice.rowKey) return false;
          if (!selectedSlice.columnKey || columnDimension === "none") return true;
          return resourceDimensionValue(position, columnDimension).key === selectedSlice.columnKey;
        })
      : filteredPositions;
    return [...source].sort((left, right) => resourcePositionMetricValue(right, primaryMetric) - resourcePositionMetricValue(left, primaryMetric) || right.totalCost - left.totalCost).slice(0, 32);
  }, [columnDimension, filteredPositions, primaryMetric, rowDimension, selectedSlice]);

  const selectedRow = selectedSlice ? pivot.rows.find((row) => row.key === selectedSlice.rowKey) : null;
  const selectedColumn = selectedSlice?.columnKey ? pivot.columns.find((column) => column.key === selectedSlice.columnKey) : null;
  const selectionLabel = selectedRow ? [selectedRow.label, selectedColumn?.label].filter(Boolean).join(" / ") : "Top Contributors";
  const activePreset = RESOURCE_PIVOT_PRESETS.find((preset) =>
    preset.metrics.join("|") === activeMetrics.join("|") &&
    preset.rowDimension === rowDimension &&
    preset.columnDimension === columnDimension &&
    preset.typeFilter === typeFilter,
  );
  const maxCellValue = pivot.rows.reduce((max, row) => {
    let nextMax = max;
    for (const column of pivot.columns) {
      const value = resourceMetricValue(row.cells.get(column.key) ?? createResourceAccumulator("", ""), primaryMetric);
      if (value > nextMax) nextMax = value;
    }
    return nextMax;
  }, 0);

  function handleRowDimensionChange(value: ResourcePivotDimension) {
    setRowDimension(value);
    if (columnDimension === value) setColumnDimension("none");
    setSelectedSlice(null);
  }

  function handleColumnDimensionChange(value: ResourcePivotColumnDimension) {
    setColumnDimension(value === rowDimension ? "none" : value);
    setSelectedSlice(null);
  }

  function applyResourcePreset(preset: (typeof RESOURCE_PIVOT_PRESETS)[number]) {
    setMetrics(preset.metrics);
    setRowDimension(preset.rowDimension);
    setColumnDimension(preset.columnDimension);
    setTypeFilter(preset.typeFilter);
    setQuery("");
    setSelectedSlice(null);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Table2 className="h-4 w-4 text-orange-300" />
            Resource Detail
          </div>
          <Badge tone="info" className="h-6">{formatNumber(filteredPositions.length, 0)} / {formatNumber(positions.length, 0)} positions</Badge>
          {selectedSlice ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => setSelectedSlice(null)} className="h-7 px-2" title="Clear selection">
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          ) : null}
        </div>

        <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(180px,1fr)_170px_150px_150px_180px_150px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/35" />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedSlice(null);
              }}
              placeholder="Search resources, vendors, phases"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <BuilderSelect
            value={activePreset?.id ?? "custom"}
            onValueChange={(value) => {
              const preset = RESOURCE_PIVOT_PRESETS.find((candidate) => candidate.id === value);
              if (preset) applyResourcePreset(preset);
            }}
            options={[
              { value: "custom", label: "Custom Pivot" },
              ...RESOURCE_PIVOT_PRESETS.map((preset) => ({ value: preset.id, label: preset.label })),
            ]}
            className="h-8 text-xs"
          />
          <BuilderSelect
            value={rowDimension}
            onValueChange={(value) => handleRowDimensionChange(value as ResourcePivotDimension)}
            options={RESOURCE_PIVOT_DIMENSIONS.map((option) => ({ value: option.id, label: `Rows: ${option.label}` }))}
            className="h-8 text-xs"
          />
          <BuilderSelect
            value={columnDimension}
            onValueChange={(value) => handleColumnDimensionChange(value as ResourcePivotColumnDimension)}
            options={[
              { value: "none", label: "Columns: None" },
              ...RESOURCE_PIVOT_DIMENSIONS.map((option) => ({
                value: option.id,
                label: `Columns: ${option.label}`,
                disabled: option.id === rowDimension,
              })),
            ]}
            className="h-8 text-xs"
          />
          <ResourceMetricMenu
            metrics={activeMetrics}
            onChange={(nextMetrics) => {
              setMetrics(nextMetrics);
              setSelectedSlice(null);
            }}
          />
          <BuilderSelect
            value={typeFilter}
            onValueChange={(value) => {
              setTypeFilter(value);
              setSelectedSlice(null);
            }}
            options={[
              { value: "all", label: "All Types" },
              ...typeOptions.map((option) => ({ value: option.value, label: `${option.label} (${formatNumber(option.count, 0)})` })),
            ]}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2">
        {positions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg/45">No resource composition has been captured yet.</div>
        ) : filteredPositions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-fg/45">No resources match the current filters.</div>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-bg/20">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-2.5 py-1.5">
                <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-fg/40">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Pivot
                </div>
                <div className="flex items-center gap-2 text-[10px] text-fg/40">
                  <Sigma className="h-3.5 w-3.5" />
                  {formatResourceMetric(primaryMetric, resourceMetricValue(pivot.grandTotal, primaryMetric))}
                  {columnDimension !== "none" ? <Columns3 className="h-3.5 w-3.5" /> : null}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <table className={cn("w-full text-xs", columnDimension === "none" ? "min-w-[680px]" : activeMetrics.length > 1 ? "min-w-[1280px]" : "min-w-[980px]")}>
                  <thead className="sticky top-0 z-10 bg-panel2/80">
                    {columnDimension === "none" ? (
                      <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                        <th className="sticky left-0 z-20 min-w-[240px] bg-panel px-3 py-2 shadow-[1px_0_0_hsl(var(--line))]">{RESOURCE_PIVOT_DIMENSIONS.find((option) => option.id === rowDimension)?.label}</th>
                        {activeMetrics.map((activeMetric) => (
                          <th key={activeMetric} className="w-[132px] px-3 py-2 text-right">{resourceMetricMeta(activeMetric).shortLabel}</th>
                        ))}
                        <th className="w-[150px] px-3 py-2">Share</th>
                      </tr>
                    ) : activeMetrics.length > 1 ? (
                      <>
                        <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                          <th rowSpan={2} className="sticky left-0 z-20 min-w-[240px] bg-panel px-3 py-2 align-bottom shadow-[1px_0_0_hsl(var(--line))]">{RESOURCE_PIVOT_DIMENSIONS.find((option) => option.id === rowDimension)?.label}</th>
                          {pivot.columns.map((column) => (
                            <th key={column.key} colSpan={activeMetrics.length} className="min-w-[132px] border-l border-line px-3 py-2 text-center">
                              <div className="truncate text-fg/50" title={column.label}>{column.label}</div>
                              <div className="mt-1 font-mono text-[10px] tracking-normal text-fg/35">{formatResourceMetric(primaryMetric, resourceMetricValue(column, primaryMetric))}</div>
                            </th>
                          ))}
                          <th colSpan={activeMetrics.length} className="border-l border-line bg-panel2/95 px-3 py-2 text-center">Total</th>
                        </tr>
                        <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                          {pivot.columns.flatMap((column) => activeMetrics.map((activeMetric) => (
                            <th key={`${column.key}:${activeMetric}`} className="min-w-[104px] border-l border-line px-3 py-1.5 text-right">{resourceMetricMeta(activeMetric).shortLabel}</th>
                          )))}
                          {activeMetrics.map((activeMetric) => (
                            <th key={`total:${activeMetric}`} className="min-w-[104px] border-l border-line bg-panel2/95 px-3 py-1.5 text-right">{resourceMetricMeta(activeMetric).shortLabel}</th>
                          ))}
                        </tr>
                      </>
                    ) : (
                      <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                        <th className="sticky left-0 z-20 min-w-[240px] bg-panel px-3 py-2 shadow-[1px_0_0_hsl(var(--line))]">{RESOURCE_PIVOT_DIMENSIONS.find((option) => option.id === rowDimension)?.label}</th>
                        {pivot.columns.map((column) => (
                          <th key={column.key} className="min-w-[132px] border-l border-line px-3 py-2 text-right">
                            <div className="truncate text-fg/50" title={column.label}>{column.label}</div>
                            <div className="mt-1 font-mono text-[10px] tracking-normal text-fg/35">{formatResourceMetric(primaryMetric, resourceMetricValue(column, primaryMetric))}</div>
                          </th>
                        ))}
                        <th className="sticky right-0 z-20 w-[132px] border-l border-line bg-panel2/95 px-3 py-2 text-right">Total</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {pivot.rows.map((row) => {
                      const rowMetric = resourceMetricValue(row.total, primaryMetric);
                      const selected = selectedSlice?.rowKey === row.key && !selectedSlice.columnKey;
                      const share = resourceMetricValue(pivot.grandTotal, primaryMetric) > 0 ? rowMetric / resourceMetricValue(pivot.grandTotal, primaryMetric) : 0;
                      return (
                        <tr
                          key={row.key}
                          className={cn("group border-b border-line/60 last:border-b-0 hover:bg-panel2/20", selected && "bg-orange-500/10")}
                        >
                          <td
                            className={cn(
                              "sticky left-0 z-10 cursor-pointer px-3 py-2 shadow-[1px_0_0_hsl(var(--line))]",
                              selected ? "bg-orange-950/40" : "bg-panel",
                            )}
                            onClick={() => setSelectedSlice({ rowKey: row.key, columnKey: null })}
                          >
                            <div className="truncate font-medium text-fg/85" title={row.label}>{row.label}</div>
                            <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-fg/40">
                              <span>{formatNumber(row.total.resources.size, 0)} res.</span>
                              <span>{formatNumber(row.total.positionCount, 0)} pos.</span>
                            </div>
                          </td>
                          {columnDimension === "none" ? (
                            <>
                              {activeMetrics.map((activeMetric) => (
                                <td key={activeMetric} className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-fg">
                                  {formatResourceMetric(activeMetric, resourceMetricValue(row.total, activeMetric))}
                                </td>
                              ))}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel2">
                                    <div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} />
                                  </div>
                                  <span className="w-10 text-right font-mono text-[10px] text-fg/45">{formatPercent(share, 0)}</span>
                                </div>
                              </td>
                            </>
                          ) : (
                            <>
                              {pivot.columns.map((column) => {
                                const cell = row.cells.get(column.key);
                                const primaryValue = cell ? resourceMetricValue(cell, primaryMetric) : 0;
                                const intensity = maxCellValue > 0 ? primaryValue / maxCellValue : 0;
                                const cellSelected = selectedSlice?.rowKey === row.key && selectedSlice.columnKey === column.key;
                                return activeMetrics.map((activeMetric) => {
                                  const value = cell ? resourceMetricValue(cell, activeMetric) : 0;
                                  const heatmapped = activeMetric === primaryMetric && value > 0;
                                  return (
                                    <td
                                      key={`${column.key}:${activeMetric}`}
                                      className={cn(
                                        "cursor-pointer border-l border-line px-3 py-2 text-right font-mono text-[11px] transition-colors hover:bg-orange-500/15",
                                        cellSelected && "bg-orange-500/20 text-fg",
                                        value === 0 && "text-fg/25",
                                      )}
                                      style={heatmapped ? { backgroundColor: `rgba(249, 115, 22, ${0.04 + Math.min(0.22, intensity * 0.18)})` } : undefined}
                                      onClick={() => setSelectedSlice({ rowKey: row.key, columnKey: column.key })}
                                      title={`${row.label} / ${column.label}`}
                                    >
                                      {value === 0 ? "-" : formatResourceMetric(activeMetric, value)}
                                    </td>
                                  );
                                });
                              })}
                              {activeMetrics.map((activeMetric) => (
                                <td
                                  key={`row-total:${activeMetric}`}
                                  className={cn(
                                    "cursor-pointer border-l border-line bg-inherit px-3 py-2 text-right font-mono text-[11px] font-semibold text-fg",
                                    activeMetrics.length === 1 && "sticky right-0 z-10",
                                  )}
                                  onClick={() => setSelectedSlice({ rowKey: row.key, columnKey: null })}
                                >
                                  {formatResourceMetric(activeMetric, resourceMetricValue(row.total, activeMetric))}
                                </td>
                              ))}
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {columnDimension === "none" ? (
                      <tr className="border-t border-line bg-panel2/35 font-semibold">
                        <td className="sticky left-0 z-10 bg-panel px-3 py-2 text-fg shadow-[1px_0_0_hsl(var(--line))]">Total</td>
                        {activeMetrics.map((activeMetric) => (
                          <td key={activeMetric} className="px-3 py-2 text-right font-mono text-[11px] text-fg">
                            {formatResourceMetric(activeMetric, resourceMetricValue(pivot.grandTotal, activeMetric))}
                          </td>
                        ))}
                        <td className="px-3 py-2" />
                      </tr>
                    ) : (
                      <tr className="border-t border-line bg-panel2/35 font-semibold">
                        <td className="sticky left-0 z-10 bg-panel px-3 py-2 text-fg shadow-[1px_0_0_hsl(var(--line))]">Total</td>
                        {pivot.columns.map((column) => (
                          activeMetrics.map((activeMetric) => (
                            <td key={`${column.key}:${activeMetric}`} className="border-l border-line px-3 py-2 text-right font-mono text-[11px] text-fg">
                              {formatResourceMetric(activeMetric, resourceMetricValue(column, activeMetric))}
                            </td>
                          ))
                        ))}
                        {activeMetrics.map((activeMetric) => (
                          <td
                            key={`grand:${activeMetric}`}
                            className={cn(
                              "border-l border-line bg-panel2 px-3 py-2 text-right font-mono text-[11px] text-fg",
                              activeMetrics.length === 1 && "sticky right-0 z-10",
                            )}
                          >
                            {formatResourceMetric(activeMetric, resourceMetricValue(pivot.grandTotal, activeMetric))}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {selectedSlice ? (
              <div className="shrink-0 overflow-hidden rounded-xl border border-line bg-bg/20">
                <div className="flex items-center justify-between gap-3 border-b border-line px-2.5 py-1.5">
                  <div className="flex min-w-0 items-center gap-2 text-[10px] font-medium uppercase tracking-[0.14em] text-fg/40">
                    <Filter className="h-3 w-3" />
                    <span className="truncate">{selectionLabel}</span>
                  </div>
                  <Badge>{formatNumber(selectedPositions.length, 0)} shown</Badge>
                </div>
                <div className="max-h-44 overflow-auto">
                  <table className={cn("w-full text-xs", showHourTiers ? "min-w-[1220px]" : "min-w-[980px]")}>
                    <thead className="sticky top-0 z-10 bg-panel2/80">
                      <tr className="border-b border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                        <th className="px-3 py-2">Resource</th>
                        <th className="w-[150px] px-3 py-2">Phase</th>
                        <th className="w-[150px] px-3 py-2">Category</th>
                        <th className="w-[150px] px-3 py-2">Vendor</th>
                        <th className="w-[110px] px-3 py-2 text-right">Qty</th>
                        {showHourTiers ? (
                          <>
                            <th className="w-[88px] px-3 py-2 text-right">U1 Hrs</th>
                            <th className="w-[88px] px-3 py-2 text-right">U2 Hrs</th>
                            <th className="w-[88px] px-3 py-2 text-right">U3 Hrs</th>
                          </>
                        ) : null}
                        {activeMetrics.map((activeMetric) => (
                          <th key={activeMetric} className="w-[110px] px-3 py-2 text-right">{resourceMetricMeta(activeMetric).shortLabel}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPositions.map((position) => {
                        const hourBreakdown = resourcePositionHourBreakdown(position);
                        return (
                          <tr key={position.id} className="border-b border-line/60 last:border-b-0">
                            <td className="px-3 py-2">
                              <div className="truncate font-medium text-fg/85" title={position.resourceName}>{position.resourceName}</div>
                              <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[10px] text-fg/40">
                                {position.code ? <span className="font-mono">{position.code}</span> : null}
                                <span>{resourceTypeLabel(position.type)}</span>
                                {position.sourceLabel ? <span>{titleCaseLabel(position.sourceLabel)}</span> : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-fg/65">{position.phaseLabel || "Unphased"}</td>
                            <td className="px-3 py-2 text-fg/65">{position.categoryLabel || "Uncategorized"}</td>
                            <td className="px-3 py-2 text-fg/65">{position.vendorLabel || "Unassigned Vendor"}</td>
                            <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/75">{formatResourceQuantity(position)}</td>
                            {showHourTiers ? (
                              <>
                                <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/70">{hourBreakdown.hoursUnit1 > 0 ? formatResourceMetric("unit1Hours", hourBreakdown.hoursUnit1) : "-"}</td>
                                <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/70">{hourBreakdown.hoursUnit2 > 0 ? formatResourceMetric("unit2Hours", hourBreakdown.hoursUnit2) : "-"}</td>
                                <td className="px-3 py-2 text-right font-mono text-[11px] text-fg/70">{hourBreakdown.hoursUnit3 > 0 ? formatResourceMetric("unit3Hours", hourBreakdown.hoursUnit3) : "-"}</td>
                              </>
                            ) : null}
                            {activeMetrics.map((activeMetric) => (
                              <td key={activeMetric} className="px-3 py-2 text-right font-mono text-[11px] font-semibold text-fg">
                                {formatResourceMetric(activeMetric, resourcePositionMetricValue(position, activeMetric))}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function SummaryBreakdownPanel({
  builder,
  totals,
  rows,
  columns,
  busy,
  onMoveRow,
  onUpdateRow,
  onMoveColumn,
  onUpdateColumn,
}: {
  builder: SummaryBuilderConfig;
  totals: ProjectWorkspaceData["estimate"]["totals"];
  rows: SummaryBuilderAxisItem[];
  columns: SummaryBuilderAxisItem[];
  busy: boolean;
  onMoveRow: (key: string, direction: "up" | "down") => void;
  onUpdateRow: (key: string, patch: Partial<SummaryBuilderAxisItem>) => void;
  onMoveColumn: (key: string, direction: "up" | "down") => void;
  onUpdateColumn: (key: string, patch: Partial<SummaryBuilderAxisItem>) => void;
}) {
  const visibleColumns = columns.filter((column) => column.visible !== false);
  const lineSubtotal = lineSubtotalMetrics(totals);

  if (builder.mode === "total") {
    return (
      <section className="min-h-0 overflow-auto rounded-2xl border border-line bg-panel2/20">
        <FactorRollupNotice totals={totals} />
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
            <tr className="bg-panel2/35">
              <td className="px-3 py-3 font-semibold text-fg">Line Sell Subtotal</td>
              <MetricCell value={formatMoney(lineSubtotal.value)} />
              <MetricCell value={formatMoney(lineSubtotal.cost)} />
              <MetricCell value={formatPercent(lineSubtotal.margin)} />
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  if (builder.mode === "grouped") {
    return (
      <section className="min-h-0 overflow-auto rounded-2xl border border-line bg-panel2/20">
        <FactorRollupNotice totals={totals} />
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
            <tr className="bg-panel2/35">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 font-semibold text-fg">Line Sell Subtotal</td>
              <td className="px-3 py-2 text-[11px] text-fg/45">Factor-adjusted base estimate before quote adjustments</td>
              <MetricCell value={formatMoney(lineSubtotal.value)} />
              <MetricCell value={formatMoney(lineSubtotal.cost)} />
              <MetricCell value={formatPercent(lineSubtotal.margin)} />
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section className="min-h-0 overflow-auto rounded-2xl border border-line bg-panel2/20">
      <FactorRollupNotice totals={totals} />
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
                <MetricCell value={formatMoney(total?.value ?? 0)} className="border-l border-line" />
                <MetricCell value={formatMoney(total?.cost ?? 0)} />
                <MetricCell value={formatPercent(total?.margin ?? 0)} />
                <td className="px-3 py-2 text-right">
                  <IconToggleButton active={row.visible} onClick={() => onUpdateRow(row.key, { visible: !row.visible })} disabled={busy} />
                </td>
              </tr>
            );
          })}
          <tr className="bg-panel2/35">
            <td colSpan={visibleColumns.length + 1} className="px-3 py-2 font-semibold text-fg">Line Sell Subtotal</td>
            <MetricCell value={formatMoney(lineSubtotal.value)} className="border-l border-line" />
            <MetricCell value={formatMoney(lineSubtotal.cost)} />
            <MetricCell value={formatPercent(lineSubtotal.margin)} />
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
              <div className="text-sm font-semibold text-fg">Adjustments</div>
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
            <div className="px-4 py-8 text-center text-sm text-fg/45">No quote adjustments yet.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-panel/50">
                <tr className="border-y border-line text-left text-[10px] font-medium uppercase tracking-[0.14em] text-fg/35">
                  <th className="w-[92px] px-3 py-2">Order</th>
                  <th className="min-w-[220px] px-3 py-2">Row</th>
                  <th className="min-w-[190px] px-3 py-2">Pricing</th>
                  <th className="min-w-[260px] px-3 py-2">Base / Scope</th>
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
        <div className="mt-1 text-[11px] text-fg/45">
          Auto-linked to the current {DIMENSION_LABELS[dimension].toLowerCase()} structure
        </div>
      </td>
      <MetricCell value={formatMoney(source?.value ?? 0)} />
      <MetricCell value={formatMoney(source?.cost ?? 0)} />
      <MetricCell value={formatPercent(source?.margin ?? 0)} />
      <td className="px-3 py-2 text-right">
        <IconToggleButton active={row.visible} onClick={() => onUpdateRow(row.key, { visible: !row.visible })} disabled={busy} />
      </td>
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
    <tr className={cn("border-b border-line/60", (adjustment.show === "No" || adjustment.active === false) && "opacity-50")}>
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
              calculationBase: pricingMode === "modifier" ? adjustment.calculationBase || "selected_scope" : "line_subtotal",
            });
          }}
          disabled={busy}
          options={ADJUSTMENT_MODE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          className="h-8 text-xs"
        />
        <BuilderSelect
          value={adjustment.financialCategory || "other"}
          onValueChange={(value) => onPatch(adjustment.id, { financialCategory: value })}
          disabled={busy}
          options={FINANCIAL_CATEGORY_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
          className="mt-2 h-8 text-xs"
        />
      </td>
      <td className="px-3 py-2">
        {isModifier ? (
          <div className="space-y-2">
            <BuilderSelect
              value={adjustment.calculationBase || "selected_scope"}
              onValueChange={(value) => onPatch(adjustment.id, { calculationBase: value })}
              disabled={busy}
              options={CALCULATION_BASE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
              className="h-8 text-xs"
            />
            <BuilderSelect
              value={adjustment.appliesTo || "All"}
              onValueChange={(value) => onPatch(adjustment.id, { appliesTo: value })}
              disabled={busy}
              options={categoryOptions.map((option) => ({ value: option.id, label: option.label }))}
              className="h-8 text-xs"
            />
            <div className="text-[11px] text-fg/45">Percent is calculated from the selected financial base.</div>
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
                placeholder="Fixed add"
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
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn("h-7 w-7 px-0", adjustment.active === false && "text-fg/40")}
            onClick={() => onPatch(adjustment.id, { active: adjustment.active === false })}
            disabled={busy}
            title={adjustment.active === false ? "Activate" : "Deactivate"}
          >
            <Power className="h-3.5 w-3.5" />
          </Button>
          <IconToggleButton active={adjustment.show === "Yes"} onClick={() => onPatch(adjustment.id, { show: adjustment.show === "Yes" ? "No" : "Yes" })} disabled={busy} />
        </div>
      </td>
      <td className="px-3 py-2 text-right">
        <Button type="button" variant="ghost" size="xs" className="h-7 w-7 px-0" onClick={() => onDelete(adjustment.id)} disabled={busy}>
          <Trash2 className="h-3.5 w-3.5 text-danger" />
        </Button>
      </td>
    </tr>
  );
}

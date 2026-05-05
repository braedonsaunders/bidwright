"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BookOpen,
  Boxes,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  CircleDollarSign,
  Columns,
  Copy,
  Download,
  Edit3,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Hammer,
  Layers,
  ListTree,
  Loader2,
  Maximize2,
  MoreHorizontal,
  MoveRight,
  Package,
  PlugZap,
  Plus,
  Search,
  Sparkles,
  Store,
  Table2,
  Tag,
  Trash2,
  X,
  Link2,
  Zap,
} from "lucide-react";
import type {
  CatalogSummary,
  CreateWorksheetItemInput,
  EffectiveCostRecord,
  EntityCategory,
  EstimateFactor,
  EstimateFactorFormulaType,
  EstimateFactorLibraryRecord,
  LineItemSearchResult,
  LineItemSearchSourceType,
  ProjectWorkspaceData,
  WorksheetItemPatchInput,
  WorkspaceResponse,
  WorkspaceWorksheet,
  WorkspaceWorksheetFolder,
  WorkspaceWorksheetItem,
} from "@/lib/api";
import {
  createWorksheet,
  createWorksheetFolder,
  createWorksheetItem,
  createWorksheetItemFast,
  createEstimateFactor,
  deleteWorksheetFolder,
  deleteWorksheet,
  deleteEstimateFactor,
  deleteWorksheetItem,
  deleteWorksheetItemFast,
  executePlugin,
  getEntityCategories,
  searchLineItemCandidates,
  searchPluginField,
  getEstimateFactorLibrary,
  updateEstimateFactor,
  updateWorksheet,
  updateWorksheetFolder,
  updateWorksheetItem,
  updateWorksheetItemFast,
} from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  bucketHoursByMultiplier,
  getWorksheetHourBreakdown,
} from "@/lib/worksheet-hours";
import {
  categoryAllowsEditingTierUnits,
  categoryUsesTieredUnits,
  getTierLabel,
} from "@/lib/entity-category-calculation";
import type { RateSchedule } from "@/lib/api";
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
} from "@/components/ui";
import * as RadixSelect from "@radix-ui/react-select";
import { cn } from "@/lib/utils";
import {
  applyWorksheetItemDelete,
  applyWorksheetItemMutation,
  applyWorksheetItemUpsert,
} from "@/lib/workspace-mutations";
import { ItemDetailDrawer } from "./item-detail-drawer";
import { AssemblyInsertModal } from "./assembly-insert-modal";
import { SaveSelectionAsAssemblyModal } from "./save-selection-as-assembly-modal";
import { makeUomOptions, useUomLibrary } from "@/components/shared/uom-select";
import { FactorParameterEditor } from "@/components/workspace/factor-parameter-editor";

/* ─── Types ─── */

export interface EstimateGridProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse | ((prev: WorkspaceResponse) => WorkspaceResponse)) => void;
  onError: (msg: string) => void;
  onRefresh: () => void;
  highlightItemId?: string;
  activeWorksheetId?: WorksheetTabId;
  onActiveWorksheetChange?: (worksheetId: WorksheetTabId) => void;
  onOpenPluginTools?: () => void;
}

type EditingCell = {
  rowId: string;
  column: EditableColumn;
} | null;

type EditableColumn =
  | "entityName"
  | "vendor"
  | "description"
  | "quantity"
  | "uom"
  | "cost"
  | "markup"
  | "price"
  | "unit1"
  | "unit2"
  | "unit3"
  | "phaseId";

type ContextMenuState = {
  rowId: string;
  x: number;
  y: number;
} | null;

type EntityDropdownPosition = {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  listMaxHeight: number;
  placement: "above" | "below";
} | null;

type SortDirection = "asc" | "desc";
type SortState = { column: ColumnId; direction: SortDirection } | null;

type WorksheetTabId = string | "all";
type WorksheetViewMode = "tabs" | "organizer";
type WorksheetViewId = WorksheetTabId | `folder:${string}`;
type OrganizerNodeTarget =
  | { type: "folder"; id: string; name: string; parentId: string | null }
  | { type: "worksheet"; id: string; name: string; folderId: string | null };
type OrganizerContextMenuState = (OrganizerNodeTarget & { x: number; y: number }) | null;
type RenameTarget = OrganizerNodeTarget | null;
type MoveTarget = OrganizerNodeTarget | null;
type DeleteFolderTarget = {
  folderId: string;
  name: string;
  parentId: string | null;
  worksheetCount: number;
  childFolderCount: number;
  itemCount: number;
} | null;
type FitLevel = "full" | "compact" | "tight";

type ColumnId =
  | "expand"
  | "checkbox"
  | "reorder"
  | "lineOrder"
  | "entityName"
  | "vendor"
  | "description"
  | "quantity"
  | "uom"
  | "factors"
  | "units"
  | "unit1"
  | "unit2"
  | "unit3"
  | "cost"
  | "markup"
  | "price"
  | "extCost"
  | "margin"
  | "phaseId"
  | "actions";

/* ─── Constants ─── */

/**
 * Badge styling props for a category. Drives the chip from the org-configured
 * EntityCategory.color (hex) directly — no hardcoded category-name → tone map.
 * Falls back to the neutral "default" tone when the category isn't configured.
 */
function getCategoryBadgeProps(
  categoryName: string,
  entityCategories: EntityCategory[],
): { style?: React.CSSProperties; tone?: "default" | "success" | "warning" | "danger" | "info" } {
  const catDef = entityCategories.find((c) => c.name === categoryName);
  if (catDef?.color) {
    return {
      style: {
        borderColor: catDef.color,
        backgroundColor: `${catDef.color}1A`,
        color: catDef.color,
      },
    };
  }
  return { tone: "default" };
}

const DEFAULT_CATEGORY_HEX = "#6b7280";

/**
 * The category to use when adding a row without an explicit choice — falls back
 * to the lowest-order enabled EntityCategory the org has configured. Returns
 * undefined only if the org has no enabled categories at all.
 */
function firstEnabledCategory(entityCategories: EntityCategory[]): EntityCategory | undefined {
  return entityCategories
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => a.order - b.order)[0];
}

/** Get the hex color for a category (for inline style borders); defaults to neutral grey. */
function getCategoryHexColor(
  categoryName: string,
  entityCategories: EntityCategory[]
): string {
  const catDef = entityCategories.find((c) => c.name === categoryName);
  return catDef?.color ?? DEFAULT_CATEGORY_HEX;
}

const EDITABLE_COLUMNS_ORDER: EditableColumn[] = [
  "entityName",
  "vendor",
  "description",
  "quantity",
  "uom",
  "unit1",
  "unit2",
  "unit3",
  "cost",
  "markup",
  "price",
  "phaseId",
];

const DEFAULT_VISIBLE_COLUMNS: ColumnId[] = [
  "expand",
  "entityName",
  "description",
  "quantity",
  "uom",
  "units",
  "cost",
  "extCost",
  "markup",
  "price",
];

const COLUMN_LABELS: Record<ColumnId, string> = {
  expand: "Detail",
  checkbox: "Select",
  reorder: "Reorder",
  lineOrder: "#",
  entityName: "Line Item Name",
  vendor: "Vendor",
  description: "Description",
  quantity: "Qty",
  uom: "UOM",
  factors: "Factors",
  units: "Units",
  unit1: "Reg",
  unit2: "OT",
  unit3: "DT",
  cost: "Cost",
  markup: "Markup",
  price: "Price",
  extCost: "Ext. Cost",
  margin: "Margin",
  phaseId: "Phase",
  actions: "Actions",
};

/** Columns that the user can toggle on/off */
const TOGGLEABLE_COLUMNS: ColumnId[] = [
  "lineOrder",
  "entityName",
  "vendor",
  "description",
  "quantity",
  "uom",
  "factors",
  "units",
  "cost",
  "extCost",
  "markup",
  "price",
  "margin",
  "phaseId",
];

const ESTIMATE_TABLE_COLUMN_ORDER: ColumnId[] = [
  "expand",
  "checkbox",
  "reorder",
  ...TOGGLEABLE_COLUMNS,
  "actions",
];

const ESTIMATE_TABLE_COLUMN_WIDTHS: Record<ColumnId, number> = {
  expand: 32,
  checkbox: 32,
  reorder: 56,
  lineOrder: 32,
  entityName: 200,
  vendor: 120,
  description: 220,
  quantity: 64,
  uom: 64,
  factors: 80,
  units: 160,
  unit1: 48,
  unit2: 48,
  unit3: 48,
  cost: 80,
  extCost: 96,
  markup: 64,
  price: 96,
  margin: 64,
  phaseId: 88,
  actions: 40,
};

const WORKSHEET_ORGANIZER_PANEL_WIDTH = 256;
const WORKSHEET_ORGANIZER_PANEL_GAP = 8;

const ENTITY_DROPDOWN_WIDTH = 560;
const ENTITY_DROPDOWN_MARGIN = 8;
const ENTITY_DROPDOWN_HEADER_HEIGHT = 84;
const ENTITY_DROPDOWN_PREFERRED_LIST_HEIGHT = 460;
const ENTITY_SEARCH_PAGE_SIZE = 90;
const TEMP_WORKSHEET_ITEM_PREFIX = "temp-worksheet-item-";

/* ─── Helpers ─── */

function parseNum(v: string, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function fmtPct(v: number) {
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 10) : "0";
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isTemporaryWorksheetItemId(itemId: string) {
  return itemId.startsWith(TEMP_WORKSHEET_ITEM_PREFIX);
}

function findWs(workspace: ProjectWorkspaceData, id: string) {
  return (workspace.worksheets ?? []).find((w) => w.id === id) ?? null;
}

function folderViewId(folderId: string): WorksheetViewId {
  return `folder:${folderId}`;
}

function worksheetViewIsFolder(id: WorksheetViewId): id is `folder:${string}` {
  return id.startsWith("folder:");
}

function folderIdFromView(id: WorksheetViewId) {
  return worksheetViewIsFolder(id) ? id.slice("folder:".length) : null;
}

function findWorksheetFolder(workspace: ProjectWorkspaceData, id: string) {
  return (workspace.worksheetFolders ?? []).find((folder) => folder.id === id) ?? null;
}

function getWorksheetFolderDescendantIds(
  folders: WorkspaceWorksheetFolder[],
  folderId: string,
) {
  const ids = new Set<string>([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return ids;
}

function getWorksheetsInFolderView(workspace: ProjectWorkspaceData, folderId: string) {
  const folderIds = getWorksheetFolderDescendantIds(workspace.worksheetFolders ?? [], folderId);
  return (workspace.worksheets ?? []).filter((worksheet) => worksheet.folderId && folderIds.has(worksheet.folderId));
}

function getWorksheetFolderPath(folders: WorkspaceWorksheetFolder[], folderId: string | null | undefined) {
  if (!folderId) return "";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(folderId);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    parts.unshift(cursor.name);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return parts.join(" / ");
}

function isDescendantWorksheetFolder(
  folders: WorkspaceWorksheetFolder[],
  candidateParentId: string,
  folderId: string,
) {
  let cursor = folders.find((folder) => folder.id === candidateParentId) ?? null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    if (cursor.id === folderId) return true;
    seen.add(cursor.id);
    cursor = cursor.parentId
      ? folders.find((folder) => folder.id === cursor?.parentId) ?? null
      : null;
  }
  return false;
}

function findCategoryForRow(
  row: WorkspaceWorksheetItem,
  categories: EntityCategory[]
): EntityCategory | undefined {
  return (row.categoryId ? categories.find((c) => c.id === row.categoryId) : undefined)
    ?? categories.find((c) => c.name === row.category || c.entityType === row.entityType);
}

function categoryRequiresRateSchedule(category: EntityCategory | undefined) {
  return category?.itemSource === "rate_schedule" || category?.calculationType === "tiered_rate";
}

type EstimatePhase = ProjectWorkspaceData["phases"][number];

function estimatePhaseLabel(phase: Pick<EstimatePhase, "number" | "name">) {
  return [phase.number, phase.name].map((part) => part?.trim()).filter(Boolean).join(" - ") || "Phase";
}

function buildEstimatePhaseOptions(phases: EstimatePhase[]) {
  const byId = new Map(phases.map((phase) => [phase.id, phase]));
  const childrenByParent = new Map<string | null, EstimatePhase[]>();
  for (const phase of phases) {
    const parentId = phase.parentId && byId.has(phase.parentId) ? phase.parentId : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(phase);
    childrenByParent.set(parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return estimatePhaseLabel(left).localeCompare(estimatePhaseLabel(right), undefined, { numeric: true, sensitivity: "base" });
    });
  }

  const options: Array<{ value: string; label: string }> = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    for (const phase of childrenByParent.get(parentId) ?? []) {
      if (visited.has(phase.id)) continue;
      visited.add(phase.id);
      options.push({
        value: phase.id,
        label: `${depth > 0 ? `${"--".repeat(depth)} ` : ""}${estimatePhaseLabel(phase)}`,
      });
      visit(phase.id, depth + 1);
    }
  };
  visit(null, 0);
  for (const phase of [...phases].sort((left, right) => estimatePhaseLabel(left).localeCompare(estimatePhaseLabel(right), undefined, { numeric: true, sensitivity: "base" }))) {
    if (visited.has(phase.id)) continue;
    options.push({ value: phase.id, label: estimatePhaseLabel(phase) });
  }
  return options;
}

/* ─── Tier slot helpers (unit1/2/3 are UI-only column ids) ─── */

const TIER_SLOT_MULTIPLIER: Record<"unit1" | "unit2" | "unit3", number> = {
  unit1: 1,
  unit2: 1.5,
  unit3: 2,
};

const TIER_SLOT_FALLBACK_KEY: Record<"unit1" | "unit2" | "unit3", string> = {
  unit1: "__reg",
  unit2: "__ot",
  unit3: "__dt",
};

const TIER_SLOT_FALLBACK_LABEL: Record<"unit1" | "unit2" | "unit3", string> = {
  unit1: "Reg",
  unit2: "OT",
  unit3: "DT",
};

function findScheduleForRow(row: WorkspaceWorksheetItem, schedules: RateSchedule[]): RateSchedule | null {
  if (row.rateScheduleItemId) {
    const direct = schedules.find((schedule) =>
      (schedule.items ?? []).some((item) => item.id === row.rateScheduleItemId),
    );
    if (direct) return direct;
  }
  const entityName = row.entityName?.trim();
  if (entityName) {
    const byName = schedules.find((schedule) =>
      (schedule.items ?? []).some(
        (item) => item.name === entityName || item.code === entityName,
      ),
    );
    if (byName) return byName;
  }
  return null;
}

function findTierIdForSlot(
  schedule: RateSchedule | null,
  slot: "unit1" | "unit2" | "unit3",
): string | null {
  if (!schedule) return null;
  const target = TIER_SLOT_MULTIPLIER[slot];
  const tier = (schedule.tiers ?? []).find((t) => Number(t.multiplier) === target);
  return tier?.id ?? null;
}

function readTierSlotHours(
  row: { tierUnits?: Record<string, number> | undefined },
  schedule: RateSchedule | null,
  slot: "unit1" | "unit2" | "unit3",
): number {
  const tierUnits = row.tierUnits ?? {};
  const tierId = findTierIdForSlot(schedule, slot);
  if (tierId && tierUnits[tierId] !== undefined) {
    const v = Number(tierUnits[tierId]);
    return Number.isFinite(v) ? v : 0;
  }
  // Look for any tier in the schedule with the target multiplier even via prefix.
  if (schedule) {
    const target = TIER_SLOT_MULTIPLIER[slot];
    for (const [key, raw] of Object.entries(tierUnits)) {
      const matched = (schedule.tiers ?? []).find(
        (t) => (t.id === key || t.id.startsWith(key)) && Number(t.multiplier) === target,
      );
      if (matched) {
        const v = Number(raw);
        return Number.isFinite(v) ? v : 0;
      }
    }
  }
  // Fallback to synthetic key written by the UI.
  const fallback = Number(tierUnits[TIER_SLOT_FALLBACK_KEY[slot]]);
  return Number.isFinite(fallback) ? fallback : 0;
}

function writeTierSlotHours(
  current: Record<string, number> | undefined,
  schedule: RateSchedule | null,
  slot: "unit1" | "unit2" | "unit3",
  value: number,
): Record<string, number> {
  const next: Record<string, number> = { ...(current ?? {}) };
  const tierId = findTierIdForSlot(schedule, slot);
  const fallbackKey = TIER_SLOT_FALLBACK_KEY[slot];
  if (tierId) {
    if (value === 0) {
      delete next[tierId];
    } else {
      next[tierId] = value;
    }
    if (next[fallbackKey] !== undefined) delete next[fallbackKey];
    return next;
  }
  if (value === 0) {
    delete next[fallbackKey];
  } else {
    next[fallbackKey] = value;
  }
  return next;
}

function getRowSlotHours(
  row: WorkspaceWorksheetItem,
  schedules: RateSchedule[],
): { unit1: number; unit2: number; unit3: number } {
  const breakdown = getWorksheetHourBreakdown(row, schedules);
  const buckets = bucketHoursByMultiplier(breakdown);
  // If the breakdown found nothing (no tier match), fall back to synthetic keys
  // and any positive unmatched tierUnits values.
  if (buckets.reg === 0 && buckets.ot === 0 && buckets.dt === 0) {
    const tierUnits = row.tierUnits ?? {};
    return {
      unit1: Number(tierUnits["__reg"]) || 0,
      unit2: Number(tierUnits["__ot"]) || 0,
      unit3: Number(tierUnits["__dt"]) || 0,
    };
  }
  return { unit1: buckets.reg, unit2: buckets.ot, unit3: buckets.dt };
}

function getTierSlotLabel(
  slot: "unit1" | "unit2" | "unit3",
  category: EntityCategory | undefined,
  schedule: RateSchedule | null,
): string {
  const tierId = findTierIdForSlot(schedule, slot);
  if (tierId) {
    const tier = (schedule?.tiers ?? []).find((t) => t.id === tierId);
    return getTierLabel(category, tierId, tier?.name ?? TIER_SLOT_FALLBACK_LABEL[slot]);
  }
  return TIER_SLOT_FALLBACK_LABEL[slot];
}

function isCellDisabledByCategory(
  category: EntityCategory | undefined,
  column: EditableColumn
): boolean {
  if (!category) return false;
  if (column === "entityName" || column === "vendor" || column === "description" || column === "phaseId") {
    return false;
  }
  if (column === "unit1" || column === "unit2" || column === "unit3") {
    return !categoryAllowsEditingTierUnits(category);
  }
  const fieldMap: Record<string, keyof EntityCategory["editableFields"]> = {
    quantity: "quantity",
    cost: "cost",
    markup: "markup",
    price: "price",
  };
  const field = fieldMap[column];
  if (!field) return false;
  return !category.editableFields[field];
}

function getLaborColumnLabel(
  column: "unit1" | "unit2" | "unit3",
  category: EntityCategory | undefined,
  schedule: RateSchedule | null,
): string {
  return getTierSlotLabel(column, category, schedule);
}

/** Entity option item with optional pricing data from catalog */
interface EntityOptionItem {
  label: string;
  value: string;
  source?:
    | "catalog"
    | "rate_schedule"
    | "cost_intelligence"
    | "cost_resource"
    | "labor_unit"
    | "assembly"
    | "plugin"
    | "external_action"
    | "plugin_result"
    | "freeform";
  sourceType?: LineItemSearchResult["sourceType"] | "plugin_result";
  sourceId?: string;
  actionType?: LineItemSearchResult["actionType"] | "plugin_result";
  unitCost?: number;
  unitPrice?: number;
  unit?: string;
  description?: string;
  rateScheduleItemId?: string;
  itemId?: string;
  effectiveCostId?: string;
  costResourceId?: string;
  laborUnitId?: string;
  quantity?: number;
  vendor?: string | null;
  code?: string;
  sourceNotes?: string;
  resourceComposition?: Record<string, unknown>;
  sourceEvidence?: Record<string, unknown>;
  searchableText?: string;
  subtitle?: string;
  score?: number;
  actionId?: string;
  pluginId?: string;
  pluginSlug?: string;
  toolId?: string;
  searchFieldId?: string;
  queryParam?: string;
  pluginInput?: Record<string, unknown>;
  unit1?: number;
  unit2?: number;
  unit3?: number;
  payload?: Record<string, unknown>;
}

interface EntityOptionGroup {
  categoryName: string;
  categoryId: string;
  entityType: string;
  defaultUom: string;
  label?: string;
  treePath?: string[];
  source?: EntityOptionItem["source"];
  sortPriority?: number;
  tone?: "accent" | "success" | "muted" | "warning";
  items: EntityOptionItem[];
}

function normalizeEntityLookup(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function metadataObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function hasMeaningfulMetadata(value: unknown) {
  const object = metadataObject(value);
  return !!object && Object.keys(object).length > 0;
}

function mergeSourceNotes(...values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const value of values) {
    for (const part of (value ?? "").split(/\n+/)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(trimmed);
    }
  }
  return parts.join("\n");
}

function resourceIdentity(resource: Record<string, unknown>) {
  return [
    resource.componentType,
    resource.rateScheduleItemId,
    resource.itemId,
    resource.costResourceId,
    resource.effectiveCostId,
    resource.laborUnitId,
  ].map((value) => String(value ?? "")).join("|");
}

function mergeResourceCompositions(...values: Array<Record<string, unknown> | undefined>) {
  const records = values.filter(hasMeaningfulMetadata) as Record<string, unknown>[];
  if (records.length === 0) return {};
  if (records.length === 1) return records[0];

  const resources: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const recordResources = Array.isArray(record.resources) ? record.resources : [];
    for (const resource of recordResources) {
      const object = metadataObject(resource);
      if (!object) continue;
      const key = resourceIdentity(object);
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push(object);
    }
  }

  return {
    source: "line_item_composer",
    sources: records.map((record) => record.source).filter(Boolean),
    resources,
  };
}

function mergeSourceEvidence(...values: Array<Record<string, unknown> | undefined>) {
  const records = values.filter(hasMeaningfulMetadata) as Record<string, unknown>[];
  if (records.length === 0) return {};
  if (records.length === 1) return records[0];
  return {
    source: "line_item_composer",
    evidence: records,
  };
}

function effectiveCostItem(cost: EffectiveCostRecord) {
  const costItem = metadataObject(cost.metadata?.costItem);
  return {
    name: cost.resource?.name?.trim() || metadataString(costItem, "name") || "Effective cost",
    code: cost.resource?.code?.trim() || metadataString(costItem, "code"),
    description: cost.resource?.description || metadataString(costItem, "description"),
    category: cost.resource?.category || metadataString(costItem, "category"),
    resourceType: cost.resource?.resourceType || metadataString(costItem, "resourceType"),
    defaultUom: cost.resource?.defaultUom || metadataString(costItem, "defaultUom") || cost.uom || "EA",
    manufacturer: cost.resource?.manufacturer || metadataString(costItem, "manufacturer"),
    manufacturerPartNumber: cost.resource?.manufacturerPartNumber || metadataString(costItem, "manufacturerPartNumber"),
    aliases: cost.resource?.aliases ?? [],
    tags: cost.resource?.tags ?? [],
  };
}

function categoryLookupKeys(category: EntityCategory) {
  return [category.id, category.name, category.entityType, category.analyticsBucket]
    .map(normalizeEntityLookup)
    .filter(Boolean);
}

function catalogForItem(workspace: ProjectWorkspaceData, catalogItemId: string | null | undefined) {
  if (!catalogItemId) return null;
  return (workspace.catalogs ?? []).find((catalog) =>
    (catalog.items ?? []).some((item) => item.id === catalogItemId),
  ) ?? null;
}

function effectiveCostMatchesCategory(
  cost: EffectiveCostRecord,
  category: EntityCategory,
  workspace: ProjectWorkspaceData,
) {
  const resource = cost.resource;
  const item = effectiveCostItem(cost);
  const categoryKeys = new Set(categoryLookupKeys(category));
  const resourceKeys = [
    item.category,
    item.resourceType,
    metadataString(resource?.metadata, "category"),
    metadataString(resource?.metadata, "resourceType"),
  ]
    .map(normalizeEntityLookup)
    .filter(Boolean);

  if (resourceKeys.some((key) => categoryKeys.has(key))) return true;

  const catalog = catalogForItem(workspace, resource?.catalogItemId);
  if (!catalog) return false;
  if (category.itemSource === "catalog" && category.catalogId && catalog.id === category.catalogId) return true;

  return [catalog.id, catalog.kind, catalog.name]
    .map(normalizeEntityLookup)
    .some((key) => categoryKeys.has(key));
}

function buildEffectiveCostOption(cost: EffectiveCostRecord): EntityOptionItem {
  const resource = cost.resource;
  const item = effectiveCostItem(cost);
  const name = item.name;
  const code = item.code;
  const vendor = cost.vendorName.trim();
  const region = cost.region.trim();
  const labelParts = [`${name}${code ? ` (${code})` : ""}`];
  if (vendor) labelParts.push(vendor);
  if (region) labelParts.push(region);

  const noteParts = [
    `Cost Intelligence cost basis ${cost.id}`,
    cost.method,
    vendor ? `vendor ${vendor}` : "",
    cost.effectiveDate ? `effective ${cost.effectiveDate}` : "",
    Number.isFinite(cost.confidence) ? `confidence ${Math.round(cost.confidence * 100)}%` : "",
  ].filter(Boolean);

  return {
    label: labelParts.join(" · "),
    value: name,
    source: "cost_intelligence",
    unitCost: cost.unitCost,
    unitPrice: cost.unitPrice ?? undefined,
    unit: cost.uom || item.defaultUom || "EA",
    description: item.description || `${name} from Cost Intelligence`,
    itemId: resource?.catalogItemId ?? undefined,
    effectiveCostId: cost.id,
    costResourceId: cost.resourceId ?? resource?.id ?? undefined,
    vendor: vendor || null,
    sourceNotes: noteParts.join("; "),
    resourceComposition: {
      source: "cost_intelligence",
      resources: [{
        componentType: "cost_intelligence",
        effectiveCostId: cost.id,
        costResourceId: cost.resourceId ?? resource?.id ?? null,
        itemId: resource?.catalogItemId ?? null,
        uom: cost.uom || item.defaultUom || "EA",
        unitCost: cost.unitCost,
        unitPrice: cost.unitPrice ?? null,
      }],
    },
    sourceEvidence: {
      source: "cost_intelligence",
      effectiveCostId: cost.id,
      costResourceId: cost.resourceId ?? resource?.id ?? null,
      sourceObservationId: cost.sourceObservationId ?? null,
      vendorName: cost.vendorName,
      region: cost.region,
      method: cost.method,
      effectiveDate: cost.effectiveDate ?? null,
      expiresAt: cost.expiresAt ?? null,
      confidence: cost.confidence,
    },
    searchableText: [
      name,
      code,
      vendor,
      region,
      cost.method,
      item.category,
      item.resourceType,
      item.manufacturer,
      item.manufacturerPartNumber,
      ...item.aliases,
      ...item.tags,
    ].filter(Boolean).join(" "),
  };
}

function entityOptionMatchesSearch(item: EntityOptionItem, query: string) {
  if (!query) return true;
  const haystack = [
    item.label,
    item.value,
    item.description,
    item.vendor,
    item.sourceNotes,
    item.searchableText,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

function payloadString(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function payloadNumber(payload: Record<string, unknown> | undefined, key: string) {
  const value = payload?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function compactMoney(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function firstText(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

function compactPath(parts: Array<string | null | undefined>, separator = " / ") {
  const seen = new Set<string>();
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(separator);
}

function cleanHierarchyPart(value: string | null | undefined) {
  return (value ?? "")
    .replace(/:selected:/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceBadgeLabel(source: EntityOptionItem["source"]) {
  switch (source) {
    case "rate_schedule": return "Rate";
    case "cost_intelligence": return "CI";
    case "cost_resource": return "Resource";
    case "labor_unit": return "Labor";
    case "assembly": return "Assembly";
    case "external_action": return "Action";
    case "plugin": return "Plugin";
    case "plugin_result": return "Product";
    case "catalog": return "Catalog";
      default: return "";
  }
}

function sourceIconFor(source: EntityOptionItem["source"]) {
  switch (source) {
    case "rate_schedule": return Zap;
    case "cost_intelligence": return BrainCircuit;
    case "cost_resource": return Boxes;
    case "labor_unit": return Hammer;
    case "assembly": return Layers;
    case "external_action": return Store;
    case "plugin": return PlugZap;
    case "plugin_result": return Package;
    case "catalog": return BookOpen;
    default: return Tag;
  }
}

function sourceAccentClasses(source: EntityOptionItem["source"]) {
  switch (source) {
    case "cost_intelligence":
      return "border-success/25 bg-success/8 text-success";
    case "labor_unit":
      return "border-warning/25 bg-warning/8 text-warning";
    case "rate_schedule":
      return "border-accent/25 bg-accent/10 text-accent";
    case "assembly":
      return "border-success/25 bg-success/8 text-success";
    case "external_action":
    case "plugin":
    case "plugin_result":
      return "border-accent/25 bg-accent/8 text-accent";
    case "cost_resource":
      return "border-fg/15 bg-panel2 text-fg/65";
    case "catalog":
      return "border-line bg-bg/70 text-fg/65";
    default:
      return "border-line bg-panel2 text-fg/50";
  }
}

type EntityBrowseModeId =
  | "rate_books"
  | "catalogs"
  | "labor_units"
  | "cost_intel"
  | "assemblies"
  | "plugins";

const ENTITY_BROWSE_CARDS: Array<{
  id: EntityBrowseModeId;
  label: string;
  detail: string;
  sources: LineItemSearchSourceType[];
  Icon: typeof BookOpen;
  accent: string;
}> = [
  {
    id: "rate_books",
    label: "Rate Books",
    detail: "Imported quote schedules",
    sources: ["rate_schedule_item"],
    Icon: Zap,
    accent: "border-accent/25 bg-accent/8 text-accent",
  },
  {
    id: "catalogs",
    label: "Catalogues",
    detail: "Materials, labour, stock, equipment",
    sources: ["catalog_item", "cost_resource"],
    Icon: BookOpen,
    accent: "border-fg/15 bg-bg text-fg/70",
  },
  {
    id: "labor_units",
    label: "Labour Units",
    detail: "Hierarchical production units",
    sources: ["labor_unit"],
    Icon: Hammer,
    accent: "border-warning/25 bg-warning/8 text-warning",
  },
  {
    id: "cost_intel",
    label: "Cost Intel",
    detail: "Vendor-backed effective costs",
    sources: ["effective_cost"],
    Icon: BrainCircuit,
    accent: "border-success/25 bg-success/8 text-success",
  },
  {
    id: "assemblies",
    label: "Assemblies",
    detail: "Kits and configured builds",
    sources: ["assembly"],
    Icon: Layers,
    accent: "border-success/25 bg-success/8 text-success",
  },
  {
    id: "plugins",
    label: "External Searches",
    detail: "Provider lookups that return line items",
    sources: ["external_action"],
    Icon: Store,
    accent: "border-accent/25 bg-accent/8 text-accent",
  },
];

function entityBrowseCardById(id: EntityBrowseModeId | null) {
  return ENTITY_BROWSE_CARDS.find((card) => card.id === id) ?? null;
}

type EstimateSearchSettings = {
  disabledSourceTypes: LineItemSearchSourceType[];
  disabledLaborLibraryIds: string[];
  disabledCatalogIds: string[];
};

const ESTIMATE_SEARCH_PREF_KEY = "estimateSearch";
const LINE_ITEM_SEARCH_SOURCE_TYPES: LineItemSearchSourceType[] = [
  "catalog_item",
  "rate_schedule_item",
  "labor_unit",
  "cost_resource",
  "effective_cost",
  "assembly",
  "plugin_tool",
  "external_action",
];

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)));
}

function isLineItemSearchSourceType(value: string): value is LineItemSearchSourceType {
  return LINE_ITEM_SEARCH_SOURCE_TYPES.includes(value as LineItemSearchSourceType);
}

function readEstimateSearchSettings(pdfPreferences: Record<string, unknown> | null | undefined): EstimateSearchSettings {
  const preferences = asPlainRecord(pdfPreferences);
  const rawSettings = asPlainRecord(preferences[ESTIMATE_SEARCH_PREF_KEY]);
  return {
    disabledSourceTypes: uniqueStringArray(rawSettings.disabledSourceTypes).filter(isLineItemSearchSourceType),
    disabledLaborLibraryIds: uniqueStringArray(rawSettings.disabledLaborLibraryIds),
    disabledCatalogIds: uniqueStringArray(rawSettings.disabledCatalogIds),
  };
}

function searchSourceTypeEnabled(settings: EstimateSearchSettings, sourceType: LineItemSearchSourceType) {
  return !settings.disabledSourceTypes.includes(sourceType);
}

function enabledSearchSourcesForRequest(
  settings: EstimateSearchSettings,
  sourceTypes: LineItemSearchSourceType[] | undefined,
) {
  if (!sourceTypes) return undefined;
  return sourceTypes.filter((sourceType) => searchSourceTypeEnabled(settings, sourceType));
}

function browseCardIsEnabled(settings: EstimateSearchSettings, card: { sources: LineItemSearchSourceType[] }) {
  return card.sources.some((sourceType) => searchSourceTypeEnabled(settings, sourceType));
}

function laborHierarchyLevelLabel(level: number) {
  return ["Library", "Catalogue", "Discipline", "Group", "Class", "Sub-class"][level] ?? `Level ${level + 1}`;
}

function sourcePriority(source: EntityOptionItem["source"]) {
  switch (source) {
    case "rate_schedule": return 0;
    case "labor_unit": return 1;
    case "catalog": return 2;
    case "cost_intelligence": return 3;
    case "cost_resource": return 4;
    case "assembly": return 5;
    case "external_action": return 8;
    case "plugin": return 9;
    case "plugin_result": return 10;
    default: return 6;
  }
}

function entityOptionKey(item: EntityOptionItem) {
  return [
    item.actionId,
    item.source,
    item.sourceId,
    item.rateScheduleItemId,
    item.itemId,
    item.effectiveCostId,
    item.costResourceId,
    item.laborUnitId,
    item.value,
  ].filter(Boolean).join("\u001f");
}

function mergeEntityOptionGroups(
  existing: EntityOptionGroup[],
  incoming: EntityOptionGroup[],
) {
  const groups = existing.map((group) => ({
    ...group,
    items: [...group.items],
  }));
  const groupIndexById = new Map(groups.map((group, index) => [group.categoryId, index]));
  const seen = new Set(groups.flatMap((group) => group.items.map(entityOptionKey)));

  for (const incomingGroup of incoming) {
    const index = groupIndexById.get(incomingGroup.categoryId);
    const target = index === undefined
      ? {
          ...incomingGroup,
          items: [],
        }
      : groups[index];

    for (const item of incomingGroup.items) {
      const key = entityOptionKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      target.items.push(item);
    }

    if (index === undefined) {
      groupIndexById.set(target.categoryId, groups.length);
      groups.push(target);
    }
  }

  return groups;
}

function sourceForSearchResult(result: LineItemSearchResult): EntityOptionItem["source"] {
  switch (result.sourceType) {
    case "catalog_item": return "catalog";
    case "rate_schedule_item": return "rate_schedule";
    case "effective_cost": return "cost_intelligence";
    case "cost_resource": return "cost_resource";
    case "labor_unit": return "labor_unit";
    case "assembly": return "assembly";
    case "external_action": return "external_action";
    case "plugin_tool": return "plugin";
    default: return "freeform";
  }
}

function findCategoryForSearchResult(
  result: Pick<LineItemSearchResult, "category" | "entityType" | "uom">,
  categories: EntityCategory[],
  fallbackCategoryName?: string,
) {
  const keys = [result.category, result.entityType].map(normalizeEntityLookup).filter(Boolean);
  const match = categories.find((category) => {
    const categoryKeys = categoryLookupKeys(category);
    return keys.some((key) => categoryKeys.includes(key));
  });
  if (match) {
    return match;
  }
  if (fallbackCategoryName) {
    return categories.find((category) => category.name === fallbackCategoryName);
  }
  return undefined;
}

function sourceGroupForSearchResult(
  result: LineItemSearchResult,
  category: EntityCategory | undefined,
  payload: Record<string, unknown>,
  isAction: boolean,
) {
  const source = sourceForSearchResult(result);
  const targetCategoryName = isAction ? "Actions" : (category?.name ?? result.category) || result.entityType || "Other";
  const entityType = isAction ? "Action" : (category?.entityType ?? result.entityType) || result.category || targetCategoryName;
  const defaultUom = category?.defaultUom ?? result.uom ?? "EA";

  if (isAction) {
    const pluginName = firstText(payloadString(payload, "pluginName"), result.subtitle, "Actions");
    return {
      categoryName: targetCategoryName,
      categoryId: `__actions:${normalizeEntityLookup(pluginName) || result.sourceId}`,
      entityType,
      defaultUom,
      label: `Actions / ${pluginName}`,
      source,
      sortPriority: 900,
      tone: "accent" as const,
    };
  }

  switch (result.sourceType) {
    case "labor_unit": {
      const provider = firstText(payloadString(payload, "provider"), result.vendor);
      const discipline = payloadString(payload, "discipline");
      const laborCategory = payloadString(payload, "laborCategory") || payloadString(payload, "category");
      const className = payloadString(payload, "className");
      const subClassName = payloadString(payload, "subClassName");
      const treePath = [
        "Labour units",
        provider,
        discipline,
        laborCategory,
        className,
        subClassName,
      ].map(cleanHierarchyPart).filter(Boolean);
      const headerLabel = compactPath(["Labour units", provider || discipline], " / ");
      return {
        categoryName: targetCategoryName,
        categoryId: `labor:${normalizeEntityLookup(provider)}:${normalizeEntityLookup(discipline)}:${normalizeEntityLookup(laborCategory)}:${normalizeEntityLookup(className)}:${normalizeEntityLookup(subClassName)}`,
        entityType,
        defaultUom,
        label: headerLabel || "Labor units",
        treePath,
        source,
        sortPriority: 100,
        tone: "warning" as const,
      };
    }
    case "catalog_item": {
      const catalog = firstText(payloadString(payload, "catalogName"), result.subtitle);
      const catalogKind = firstText(payloadString(payload, "catalogKind"), result.entityType);
      const itemCategory = firstText(payloadString(payload, "catalogCategory"), result.category);
      const rateScheduleItemId = payloadString(payload, "rateScheduleItemId");
      if (rateScheduleItemId) {
        const schedule = firstText(payloadString(payload, "scheduleName"), result.subtitle);
        const scheduleCategory = firstText(payloadString(payload, "scheduleCategory"), result.category, targetCategoryName);
        return {
          categoryName: targetCategoryName,
          categoryId: `catalog-rate:${normalizeEntityLookup(schedule)}:${normalizeEntityLookup(scheduleCategory)}:${normalizeEntityLookup(catalog || catalogKind)}`,
          entityType,
          defaultUom,
          label: compactPath(["Rate book", scheduleCategory, schedule]),
          source: "rate_schedule" as const,
          sortPriority: 5,
          tone: "accent" as const,
        };
      }
      const path = compactPath(["Catalog", catalog || catalogKind, itemCategory !== catalogKind ? itemCategory : ""]);
      return {
        categoryName: targetCategoryName,
        categoryId: `catalog:${normalizeEntityLookup(catalog || catalogKind)}:${normalizeEntityLookup(itemCategory)}`,
        entityType,
        defaultUom,
        label: path || "Catalog",
        source,
        sortPriority: 200,
        tone: "muted" as const,
      };
    }
    case "rate_schedule_item": {
      const schedule = firstText(payloadString(payload, "scheduleName"), result.subtitle);
      const scheduleCategory = firstText(payloadString(payload, "scheduleCategory"), result.category);
      return {
        categoryName: targetCategoryName,
        categoryId: `rate:${normalizeEntityLookup(schedule)}:${normalizeEntityLookup(scheduleCategory)}`,
        entityType,
        defaultUom,
        label: compactPath(["Rates", scheduleCategory, schedule]),
        source,
        sortPriority: 0,
        tone: "accent" as const,
      };
    }
    case "effective_cost": {
      const resourceType = firstText(payloadString(payload, "resourceType"), result.entityType);
      const costCategory = firstText(payloadString(payload, "costCategory"), result.category);
      const vendor = firstText(payloadString(payload, "vendorName"), result.vendor);
      const region = payloadString(payload, "region");
      return {
        categoryName: targetCategoryName,
        categoryId: `cost:${normalizeEntityLookup(resourceType)}:${normalizeEntityLookup(costCategory)}:${normalizeEntityLookup(vendor)}:${normalizeEntityLookup(region)}`,
        entityType,
        defaultUom,
        label: compactPath(["Cost intel", resourceType || costCategory, vendor, region]),
        source,
        sortPriority: 300,
        tone: "success" as const,
      };
    }
    case "cost_resource": {
      const resourceType = firstText(payloadString(payload, "resourceType"), result.entityType);
      const resourceCategory = firstText(payloadString(payload, "resourceCategory"), result.category);
      const manufacturer = firstText(payloadString(payload, "manufacturer"), result.vendor);
      return {
        categoryName: targetCategoryName,
        categoryId: `resource:${normalizeEntityLookup(resourceType)}:${normalizeEntityLookup(resourceCategory)}:${normalizeEntityLookup(manufacturer)}`,
        entityType,
        defaultUom,
        label: compactPath(["Resources", resourceType || resourceCategory, manufacturer]),
        source,
        sortPriority: 400,
        tone: "muted" as const,
      };
    }
    case "assembly": {
      const assemblyCategory = firstText(payloadString(payload, "assemblyCategory"), result.category);
      return {
        categoryName: targetCategoryName,
        categoryId: `assembly:${normalizeEntityLookup(assemblyCategory) || "general"}`,
        entityType,
        defaultUom,
        label: compactPath(["Assemblies", assemblyCategory]),
        source,
        sortPriority: 500,
        tone: "success" as const,
      };
    }
    default:
      return {
        categoryName: targetCategoryName,
        categoryId: category?.id ?? `${result.sourceType}:${normalizeEntityLookup(targetCategoryName) || "other"}`,
        entityType,
        defaultUom,
        label: compactPath([sourceBadgeLabel(source) || "Library", targetCategoryName]),
        source,
        sortPriority: sourcePriority(source),
        tone: "muted" as const,
      };
  }
}

function entityOptionFromSearchResult(
  result: LineItemSearchResult,
  categories: EntityCategory[],
  searchTerm: string,
): { group: EntityOptionGroup; item: EntityOptionItem } {
  const category = findCategoryForSearchResult(result, categories);
  const isAction = result.actionType !== "select" || result.sourceType === "external_action" || result.sourceType === "plugin_tool";
  const payload = result.payload ?? {};
  const groupInfo = sourceGroupForSearchResult(result, category, payload, isAction);
  const costResourceId = payloadString(payload, "costResourceId") || undefined;
  const effectiveCostId = payloadString(payload, "effectiveCostId") || undefined;
  const laborUnitId = payloadString(payload, "laborUnitId") || undefined;
  const itemId = payloadString(payload, "itemId") || payloadString(payload, "catalogItemId") || undefined;
  const rateScheduleItemId = payloadString(payload, "rateScheduleItemId") || undefined;
  const quantity =
    payloadNumber(payload, "quantity") ??
    payloadNumber(payload, "outputQuantity") ??
    payloadNumber(payload, "defaultQuantity");
  const sourceEvidence = metadataObject(payload.sourceEvidence) ?? {
    source: result.sourceType,
    sourceId: result.sourceId,
    searchDocumentId: result.id,
    sourceNotes: payloadString(payload, "sourceNotes") || result.subtitle,
  };
  const resourceComposition = metadataObject(payload.resourceComposition) ?? (
    rateScheduleItemId || itemId || costResourceId || effectiveCostId || laborUnitId
      ? {
          source: result.sourceType,
          resources: [{
            componentType: result.sourceType,
            rateScheduleItemId: rateScheduleItemId ?? null,
            itemId: itemId ?? null,
            costResourceId: costResourceId ?? null,
            effectiveCostId: effectiveCostId ?? null,
            laborUnitId: laborUnitId ?? null,
            uom: result.uom || null,
            unitCost: result.unitCost ?? null,
            unitPrice: result.unitPrice ?? null,
          }],
        }
      : undefined
  );
  const label = result.actionType === "plugin_remote_search" && searchTerm.trim()
    ? `Search ${result.title} for "${searchTerm.trim()}"`
    : result.actionType === "plugin_tool"
      ? `Run ${result.title}`
      : `${result.title}${result.code ? ` (${result.code})` : ""}`;

  return {
    group: {
      categoryName: groupInfo.categoryName,
      categoryId: groupInfo.categoryId,
      entityType: groupInfo.entityType,
      defaultUom: groupInfo.defaultUom,
      label: groupInfo.label,
      treePath: groupInfo.treePath,
      source: groupInfo.source,
      sortPriority: groupInfo.sortPriority,
      tone: groupInfo.tone,
      items: [],
    },
    item: {
      label,
      value: result.title,
      source: sourceForSearchResult(result),
      sourceType: result.sourceType,
      sourceId: result.sourceId,
      actionType: result.actionType,
      unitCost: result.unitCost ?? undefined,
      unitPrice: result.unitPrice ?? undefined,
      unit: result.uom,
      description: payloadString(payload, "description") || result.subtitle || result.title,
      rateScheduleItemId,
      itemId,
      effectiveCostId,
      costResourceId,
      laborUnitId,
      quantity,
      vendor: result.vendor || null,
      code: result.code || undefined,
      sourceNotes: payloadString(payload, "sourceNotes") || result.subtitle,
      resourceComposition,
      sourceEvidence,
      searchableText: [result.title, result.subtitle, result.code, result.vendor, result.category, result.entityType].join(" "),
      subtitle: result.subtitle,
      score: result.score,
      actionId: result.id,
      pluginId: payloadString(payload, "pluginId") || undefined,
      pluginSlug: payloadString(payload, "pluginSlug") || undefined,
      toolId: payloadString(payload, "toolId") || undefined,
      searchFieldId: payloadString(payload, "searchFieldId") || undefined,
      queryParam: payloadString(payload, "queryParam") || "q",
      unit1: payloadNumber(payload, "unit1"),
      unit2: payloadNumber(payload, "unit2"),
      unit3: payloadNumber(payload, "unit3"),
      payload,
    },
  };
}

function groupSearchResults(
  results: LineItemSearchResult[],
  categories: EntityCategory[],
  searchTerm: string,
  currentCategoryName?: string,
): EntityOptionGroup[] {
  const groups = new Map<string, EntityOptionGroup>();
  const mappedResults = results.map((result) => entityOptionFromSearchResult(result, categories, searchTerm));
  const linkedCatalogRateIds = new Set(
    mappedResults
      .filter(({ item }) => item.source === "catalog" && item.rateScheduleItemId)
      .map(({ item }) => item.rateScheduleItemId!),
  );

  for (const mapped of mappedResults) {
    if (
      mapped.item.source === "rate_schedule" &&
      mapped.item.rateScheduleItemId &&
      linkedCatalogRateIds.has(mapped.item.rateScheduleItemId)
    ) {
      continue;
    }
    const key = mapped.group.categoryId;
    const group = groups.get(key) ?? mapped.group;
    group.items.push(mapped.item);
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((left, right) => {
    if (left.categoryName === "Actions" && right.categoryName !== "Actions") return 1;
    if (right.categoryName === "Actions" && left.categoryName !== "Actions") return -1;
    if (currentCategoryName && left.categoryName === currentCategoryName && right.categoryName !== currentCategoryName) return -1;
    if (currentCategoryName && right.categoryName === currentCategoryName && left.categoryName !== currentCategoryName) return 1;
    const priorityDelta = (left.sortPriority ?? sourcePriority(left.source)) - (right.sortPriority ?? sourcePriority(right.source));
    if (priorityDelta !== 0) return priorityDelta;
    return (left.label ?? left.categoryName).localeCompare(right.label ?? right.categoryName);
  });
}

function optionMeasureLabel(item: EntityOptionItem) {
  if (item.source === "labor_unit") {
    const normal = item.unit1 ?? payloadNumber(item.payload, "unit1");
    if (normal !== undefined) return `${normal.toFixed(2)} h/u`;
  }
  const cost = item.unitCost;
  const price = item.unitPrice;
  if (cost !== undefined && price !== undefined && (cost !== 0 || price !== 0)) {
    if (cost === 0) return `${compactMoney(price)}`;
    if (price === 0) return `${compactMoney(cost)}`;
    return `${compactMoney(cost)} / ${compactMoney(price)}`;
  }
  if (price !== undefined && price !== 0) return compactMoney(price);
  if (cost !== undefined && cost !== 0) return compactMoney(cost);
  return "";
}

function optionMetaParts(item: EntityOptionItem) {
  const payload = item.payload;
  switch (item.source) {
    case "labor_unit": {
      const difficulty = payloadString(payload, "defaultDifficulty");
      const difficult = payloadNumber(payload, "hoursDifficult");
      const veryDifficult = payloadNumber(payload, "hoursVeryDifficult");
      return [
        item.unit ? `UOM ${item.unit}` : "",
        difficulty ? `default ${difficulty}` : "",
        difficult !== undefined ? `${difficult.toFixed(2)} diff` : "",
        veryDifficult !== undefined ? `${veryDifficult.toFixed(2)} very` : "",
      ].filter(Boolean);
    }
    case "rate_schedule":
      return [
        payloadString(payload, "scheduleName") || item.subtitle,
        item.code,
        item.unit ? `per ${item.unit}` : "",
      ].filter(Boolean);
    case "cost_intelligence": {
      const confidence = payloadNumber(payload, "confidence");
      return [
        item.vendor,
        payloadString(payload, "region"),
        payloadString(payload, "method"),
        confidence !== undefined ? `${Math.round(confidence * 100)}% conf` : "",
        payloadString(payload, "effectiveDate"),
      ].filter(Boolean);
    }
    case "cost_resource":
      return [
        compactPath([payloadString(payload, "resourceType"), payloadString(payload, "resourceCategory")], " / "),
        payloadString(payload, "manufacturerPartNumber"),
        item.unit ? `UOM ${item.unit}` : "",
      ].filter(Boolean);
    case "catalog":
      return [
        payloadString(payload, "scheduleName"),
        payloadString(payload, "catalogName") || item.subtitle,
        item.code,
        item.vendor,
        item.unit ? `UOM ${item.unit}` : "",
      ].filter(Boolean);
    case "assembly":
      return [
        item.code,
        payloadString(payload, "assemblyCategory"),
        item.unit ? `unit ${item.unit}` : "",
      ].filter(Boolean);
    case "external_action":
    case "plugin":
      return [
        payloadString(payload, "pluginName") || item.subtitle,
        payloadString(payload, "toolName"),
        item.actionType === "plugin_remote_search" ? "remote search" : "creates lines",
      ].filter(Boolean);
    case "plugin_result":
      return [
        item.vendor,
        item.subtitle,
      ].filter(Boolean);
    default:
      return [
        item.subtitle || item.description,
        item.unit ? `UOM ${item.unit}` : "",
      ].filter(Boolean);
  }
}

function laborUnitReferenceParts(item: EntityOptionItem) {
  const code = item.code ?? "";
  const codeParts = code.split("-").filter(Boolean);
  const description = payloadString(item.payload, "description");
  const tableFromDescription = description.match(/\bSource Table\s+([A-Za-z0-9.-]+)/i)?.[1] ?? "";
  const table = (tableFromDescription || codeParts[1] || "").replace(/[.,;:]+$/, "");
  return {
    code,
    series: codeParts[0] || "",
    table,
    ref: codeParts.slice(2).join("-"),
  };
}

/** Build entity dropdown options grouped by category */
function buildEntityOptions(
  workspace: ProjectWorkspaceData,
  categories: EntityCategory[],
  effectiveCosts: EffectiveCostRecord[] = [],
): EntityOptionGroup[] {
  const groups: EntityOptionGroup[] = [];

  const costCategories = categories.filter((cat) => cat.enabled && cat.itemSource !== "rate_schedule");
  const fallbackCostCategory = costCategories[0] ?? null;
  const costOptionsByCategory = new Map<string, EntityOptionItem[]>();

  for (const cost of effectiveCosts) {
    if (!Number.isFinite(cost.unitCost)) continue;
    const matchedCategories = costCategories.filter((cat) => effectiveCostMatchesCategory(cost, cat, workspace));
    const targetCategories = matchedCategories.length > 0
      ? matchedCategories
      : fallbackCostCategory
      ? [fallbackCostCategory]
      : [];

    for (const target of targetCategories) {
      const bucket = costOptionsByCategory.get(target.id) ?? [];
      if (!bucket.some((item) => item.effectiveCostId === cost.id)) {
        bucket.push(buildEffectiveCostOption(cost));
      }
      costOptionsByCategory.set(target.id, bucket);
    }
  }

  for (const cat of categories) {
    const items: EntityOptionItem[] = [];
    const itemSource = cat.itemSource || "freeform";

    switch (itemSource) {
      case "rate_schedule": {
        // Rate books are keyed by the canonical EntityCategory.entityType.
        const catKey = cat.entityType.trim();
        for (const sched of workspace.rateSchedules ?? []) {
          if (sched.category.trim() === catKey) {
            for (const rsItem of sched.items ?? []) {
              const firstTier = sched.tiers?.[0];
              const rate = firstTier ? (rsItem.rates[firstTier.id] ?? 0) : 0;
              if (!items.some((i) => i.rateScheduleItemId === rsItem.id)) {
                items.push({
                  label: `${rsItem.name}${rsItem.code ? ` (${rsItem.code})` : ""}`,
                  value: rsItem.name,
                  source: "rate_schedule",
                  unitCost: rate,
                  unit: rsItem.unit,
                  rateScheduleItemId: rsItem.id,
                });
              }
            }
          }
        }
        if (items.length === 0) {
          items.push({ label: cat.name, value: cat.name });
        }
        break;
      }
      case "catalog": {
        // Pull from the explicitly-linked catalog (cat.catalogId) when set,
        // else any catalog whose kind matches entityType (case-insensitive).
        const catKey = cat.entityType.toLowerCase();
        for (const catalog of workspace.catalogs ?? []) {
          const isLinked = cat.catalogId
            ? catalog.id === cat.catalogId
            : catalog.kind.toLowerCase() === catKey;
          if (isLinked) {
            for (const ci of catalog.items ?? []) {
              items.push({
                label: ci.name,
                value: ci.name,
                source: "catalog",
                unitCost: ci.unitCost,
                unitPrice: ci.unitPrice,
                unit: ci.unit,
                description: ci.name,
                itemId: ci.id,
              });
            }
          }
        }
        if (items.length === 0) {
          items.push({ label: cat.name, value: cat.name });
        }
        break;
      }
      case "freeform":
      default: {
        items.push({ label: cat.name, value: cat.name, source: "freeform" });
        break;
      }
    }

    const costItems = costOptionsByCategory.get(cat.id) ?? [];
    for (const costItem of costItems) {
      if (!items.some((item) => item.effectiveCostId === costItem.effectiveCostId)) {
        items.push(costItem);
      }
    }

    groups.push({
      categoryName: cat.name,
      categoryId: cat.id,
      entityType: cat.entityType,
      defaultUom: cat.defaultUom,
      items,
    });
  }

  return groups;
}

/** Group rows by category. When preserveOrder is true (user has an active sort), skip the default lineOrder sort. */
function groupRowsByCategory(
  rows: WorkspaceWorksheetItem[],
  categories: EntityCategory[],
  preserveOrder = false,
  adjustedLineItemsById: Map<string, WorkspaceWorksheetItem> = new Map(),
): Array<{
  category: string;
  catDef: EntityCategory | undefined;
  items: WorkspaceWorksheetItem[];
  totalPrice: number;
}> {
  const catOrder = categories.map((c) => c.name);
  const grouped: Record<string, WorkspaceWorksheetItem[]> = {};

  for (const row of rows) {
    const cat = row.category || "";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(row);
  }

  // Sort groups by category order
  const result: Array<{
    category: string;
    catDef: EntityCategory | undefined;
    items: WorkspaceWorksheetItem[];
    totalPrice: number;
  }> = [];

  for (const catName of catOrder) {
    if (grouped[catName]) {
      const items = preserveOrder
        ? grouped[catName]
        : grouped[catName].sort((a, b) => a.lineOrder - b.lineOrder);
      result.push({
        category: catName,
        catDef: categories.find((c) => c.name === catName),
        items,
        totalPrice: items.reduce((s, r) => s + (adjustedLineItemsById.get(r.id)?.price ?? r.price), 0),
      });
      delete grouped[catName];
    }
  }

  // Any remaining categories not in the entity categories list
  for (const [catName, items] of Object.entries(grouped)) {
    const sorted = preserveOrder
      ? items
      : items.sort((a, b) => a.lineOrder - b.lineOrder);
    result.push({
      category: catName,
      catDef: undefined,
      items: sorted,
      totalPrice: sorted.reduce((s, r) => s + (adjustedLineItemsById.get(r.id)?.price ?? r.price), 0),
    });
  }

  return result;
}

/* ─── Component ─── */

export function EstimateGrid({
  workspace,
  onApply,
  onError,
  onRefresh,
  highlightItemId,
  activeWorksheetId,
  onActiveWorksheetChange,
  onOpenPluginTools,
}: EstimateGridProps) {
  const [isPending, startTransition] = useTransition();

  // Entity categories loaded from API
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);
  const globalUoms = useUomLibrary();

  // Tab state
  const [worksheetViewMode, setWorksheetViewMode] = useState<WorksheetViewMode>("tabs");
  const [activeTab, setActiveTabState] = useState<WorksheetViewId>(
    activeWorksheetId ?? workspace.worksheets[0]?.id ?? "all"
  );
  const prevTabRef = useRef<WorksheetViewId>(activeTab);
  const [tabSlideDir, setTabSlideDir] = useState<1 | -1>(1);

  const setActiveTab = useCallback((nextTab: WorksheetViewId) => {
    setActiveTabState((prev) => {
      // Resolve direction by tab order: "all" first, then worksheet array order.
      const order: WorksheetViewId[] = ["all", ...(workspace.worksheets ?? []).map((w) => w.id)];
      const prevIdx = order.indexOf(prev);
      const nextIdx = order.indexOf(nextTab);
      if (prevIdx >= 0 && nextIdx >= 0 && prevIdx !== nextIdx) {
        setTabSlideDir(nextIdx > prevIdx ? 1 : -1);
      }
      prevTabRef.current = nextTab;
      return nextTab;
    });
    if (!worksheetViewIsFolder(nextTab)) {
      onActiveWorksheetChange?.(nextTab);
    }
  }, [onActiveWorksheetChange, workspace.worksheets]);

  useEffect(() => {
    if (!activeWorksheetId || activeWorksheetId === activeTab) return;
    if (worksheetViewIsFolder(activeTab)) return;
    setActiveTabState(activeWorksheetId);
    prevTabRef.current = activeWorksheetId;
  }, [activeTab, activeWorksheetId]);

  // Editing state
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  // Selected cell (for keyboard navigation when not editing)
  const [selectedCell, setSelectedCell] = useState<{ rowId: string; column: EditableColumn } | null>(null);

  // Entity dropdown state
  const [entityDropdownRowId, setEntityDropdownRowId] = useState<string | null>(null);
  const [entitySearchTerm, setEntitySearchTerm] = useState("");
  const [entityBrowseMode, setEntityBrowseMode] = useState<EntityBrowseModeId | null>(null);
  const [entityHighlightIdx, setEntityHighlightIdx] = useState(0);
  const entitySearchRef = useRef<HTMLInputElement | null>(null);
  const [entityDropdownPos, setEntityDropdownPos] = useState<EntityDropdownPosition>(null);
  const entityCellRef = useRef<HTMLTableCellElement | null>(null);
  const entityDropdownRef = useRef<HTMLDivElement | null>(null);

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  // Tab menu
  const [tabMenu, setTabMenu] = useState<{ wsId: string; x: number; y: number } | null>(null);

  // Modals
  const [showNewWsModal, setShowNewWsModal] = useState(false);
  const [newWsName, setNewWsName] = useState("");
  const [newWsFolderId, setNewWsFolderId] = useState<string | null>(null);
  const [renameWsId, setRenameWsId] = useState<string | null>(null);
  const [renameWsName, setRenameWsName] = useState("");
  const [deleteWsTarget, setDeleteWsTarget] = useState<{ wsId: string; name: string; itemCount: number } | null>(null);
  const [folderForm, setFolderForm] = useState<{ parentId: string | null; name: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameName, setRenameName] = useState("");
  const [moveTarget, setMoveTarget] = useState<MoveTarget>(null);
  const [moveParentId, setMoveParentId] = useState<string>("__root__");
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<DeleteFolderTarget>(null);
  const [organizerMenu, setOrganizerMenu] = useState<OrganizerContextMenuState>(null);


  // Selected row
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // Scroll to highlighted item from global search or agent navigation.
  useEffect(() => {
    if (!highlightItemId) return;
    setSelectedRowId(highlightItemId);
    setSelectedCell({ rowId: highlightItemId, column: "entityName" });
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-cell-row="${highlightItemId}"][data-cell-col="entityName"]`)
        || document.querySelector(`[data-item-id="${highlightItemId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-accent/50", "bg-accent/10");
        setTimeout(() => el.classList.remove("ring-2", "ring-accent/50", "bg-accent/10"), 2500);
      }
    });
  }, [highlightItemId]);

  // Collapsed category groups
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Inline tab rename
  const [inlineRenameWsId, setInlineRenameWsId] = useState<string | null>(null);
  const [inlineRenameName, setInlineRenameName] = useState("");
  const inlineRenameRef = useRef<HTMLInputElement | null>(null);
  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const gridWidthRef = useRef<HTMLDivElement | null>(null);
  const [tabOverflow, setTabOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const [gridWidth, setGridWidth] = useState(0);

  // ─── NEW STATE: Detail Drawer ───
  const [detailItem, setDetailItem] = useState<WorkspaceWorksheetItem | null>(null);
  const [factorLineItem, setFactorLineItem] = useState<WorkspaceWorksheetItem | null>(null);

  // ─── NEW STATE: Row Selection / Bulk Operations ───
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMarkupValue, setBulkMarkupValue] = useState("");

  // ─── NEW STATE: Column Visibility ───
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnId>>(
    new Set(DEFAULT_VISIBLE_COLUMNS)
  );
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const userToggledColumnsRef = useRef(false);

  // ─── Sort State ───
  const [sortState, setSortState] = useState<SortState>(null);

  // ─── Add Items command center ───
  const [showAddItemsPicker, setShowAddItemsPicker] = useState(false);
  const [addItemsSearchTerm, setAddItemsSearchTerm] = useState("");
  const [addItemsBrowseMode, setAddItemsBrowseMode] = useState<EntityBrowseModeId | null>(null);
  const [addItemsGroups, setAddItemsGroups] = useState<EntityOptionGroup[]>([]);
  const [addItemsLoading, setAddItemsLoading] = useState(false);
  const [addItemsLoadingMore, setAddItemsLoadingMore] = useState(false);
  const [addItemsHasMore, setAddItemsHasMore] = useState(false);
  const [addItemsOffset, setAddItemsOffset] = useState(0);
  const [addItemsError, setAddItemsError] = useState<string | null>(null);
  const [selectedAddItems, setSelectedAddItems] = useState<Map<string, { group: EntityOptionGroup; item: EntityOptionItem }>>(() => new Map());
  const addItemsRequestRef = useRef(0);
  const addItemsLoadingMoreRef = useRef(false);

  // ─── NEW STATE: Assembly insert ───
  const [showAssemblyPicker, setShowAssemblyPicker] = useState(false);
  const [showSaveAsAssembly, setShowSaveAsAssembly] = useState(false);

  const [entitySearchGroups, setEntitySearchGroups] = useState<EntityOptionGroup[]>([]);
  const [entitySearchLoading, setEntitySearchLoading] = useState(false);
  const [entitySearchLoadingMore, setEntitySearchLoadingMore] = useState(false);
  const [entitySearchHasMore, setEntitySearchHasMore] = useState(false);
  const [entitySearchOffset, setEntitySearchOffset] = useState(0);
  const [entitySearchError, setEntitySearchError] = useState<string | null>(null);
  const [entityActionLoadingId, setEntityActionLoadingId] = useState<string | null>(null);
  const [entityPluginResults, setEntityPluginResults] = useState<EntityOptionItem[]>([]);
  const entitySearchRequestRef = useRef(0);
  const entitySearchLoadingMoreRef = useRef(false);

  useEffect(() => {
    if (!detailItem) return;
    const updated = workspace.worksheets
      .flatMap((worksheet) => worksheet.items)
      .find((item) => item.id === detailItem.id);
    if (!updated) {
      setDetailItem(null);
      return;
    }
    if (updated !== detailItem) {
      setDetailItem(updated);
    }
  }, [detailItem, workspace]);

  const applyMutationError = useCallback((message: string, error: unknown) => {
    onRefresh();
    onError(error instanceof Error ? error.message : message);
  }, [onError, onRefresh]);

  const buildOptimisticItem = useCallback((
    row: WorkspaceWorksheetItem,
    patch: WorksheetItemPatchInput,
  ) => {
    const nextRow: WorkspaceWorksheetItem = {
      ...row,
      ...patch,
      vendor: patch.vendor === null ? undefined : patch.vendor ?? row.vendor,
      phaseId: patch.phaseId === undefined ? row.phaseId : patch.phaseId,
      rateScheduleItemId:
        patch.rateScheduleItemId === undefined
          ? row.rateScheduleItemId
          : patch.rateScheduleItemId,
      itemId: patch.itemId === undefined ? row.itemId : patch.itemId,
      tierUnits: patch.tierUnits === undefined ? row.tierUnits : patch.tierUnits,
      sourceNotes:
        patch.sourceNotes === undefined ? row.sourceNotes : patch.sourceNotes,
    };

    if (
      patch.price === undefined &&
      (patch.quantity !== undefined ||
        patch.cost !== undefined ||
        patch.markup !== undefined)
    ) {
      nextRow.price = roundMoney(nextRow.cost * nextRow.quantity * (1 + nextRow.markup));
    }

    return nextRow;
  }, []);

  const commitItemPatch = useCallback((
    rowId: string,
    patch: WorksheetItemPatchInput,
    fallbackMessage = "Save failed.",
  ) => {
    if (isTemporaryWorksheetItemId(rowId)) {
      return;
    }

    const row = workspace.worksheets
      .flatMap((worksheet) => worksheet.items)
      .find((item) => item.id === rowId);
    if (!row) {
      return;
    }

    const optimisticItem = buildOptimisticItem(row, patch);
    onApply((current) => applyWorksheetItemUpsert(current, optimisticItem));

    startTransition(async () => {
      try {
        const mutation = await updateWorksheetItemFast(
          workspace.project.id,
          rowId,
          patch,
        );
        onApply((current) => applyWorksheetItemMutation(current, mutation));
      } catch (error) {
        applyMutationError(fallbackMessage, error);
      }
    });
  }, [applyMutationError, buildOptimisticItem, onApply, workspace.project.id, workspace.worksheets]);

  const createItem = useCallback((
    worksheetId: string,
    payload: CreateWorksheetItemInput,
    fallbackMessage = "Create failed.",
  ) => {
    const temporaryId = `${TEMP_WORKSHEET_ITEM_PREFIX}${crypto.randomUUID()}`;
    const worksheet = workspace.worksheets.find((entry) => entry.id === worksheetId);
    const fallbackOrder =
      worksheet?.items.reduce(
        (maxOrder, item) => Math.max(maxOrder, item.lineOrder),
        0,
      ) ?? 0;

    const optimisticItem: WorkspaceWorksheetItem = {
      id: temporaryId,
	      worksheetId,
	      phaseId: payload.phaseId ?? null,
	      categoryId: payload.categoryId ?? null,
	      category: payload.category,
      entityType: payload.entityType,
      entityName: payload.entityName,
      classification: payload.classification ?? {},
      costCode: payload.costCode ?? null,
      vendor: payload.vendor ?? undefined,
      description: payload.description,
      quantity: payload.quantity,
      uom: payload.uom,
      cost: payload.cost,
      markup: payload.markup,
      price: payload.price,
      lineOrder: payload.lineOrder ?? fallbackOrder + 1,
      rateScheduleItemId: payload.rateScheduleItemId ?? null,
      itemId: payload.itemId ?? null,
      tierUnits: payload.tierUnits ?? {},
      sourceNotes: payload.sourceNotes,
    };

    onApply((current) => applyWorksheetItemUpsert(current, optimisticItem));

    startTransition(async () => {
      try {
        const mutation = await createWorksheetItemFast(
          workspace.project.id,
          worksheetId,
          payload,
        );
        onApply((current) => {
          const withoutTemporary = applyWorksheetItemDelete(current, temporaryId);
          return applyWorksheetItemMutation(withoutTemporary, mutation);
        });
        if (selectedRowId === temporaryId) {
          setSelectedRowId(mutation.item.id);
        }
      } catch (error) {
        applyMutationError(fallbackMessage, error);
      }
    });
  }, [applyMutationError, onApply, selectedRowId, workspace.project.id, workspace.worksheets]);

  const createDraftItem = useCallback((worksheetId: string) => {
    const temporaryId = `${TEMP_WORKSHEET_ITEM_PREFIX}${crypto.randomUUID()}`;
    const worksheet = workspace.worksheets.find((entry) => entry.id === worksheetId);
    const fallbackOrder =
      worksheet?.items.reduce(
        (maxOrder, item) => Math.max(maxOrder, item.lineOrder),
        0,
      ) ?? 0;
    const draftItem: WorkspaceWorksheetItem = {
      id: temporaryId,
	      worksheetId,
	      phaseId: null,
	      categoryId: null,
	      category: "",
      entityType: "",
      entityName: "",
      classification: {},
      costCode: null,
      vendor: undefined,
      description: "",
      quantity: 1,
      uom: "",
      cost: 0,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: 0,
      lineOrder: fallbackOrder + 1,
      rateScheduleItemId: null,
      itemId: null,
      tierUnits: {},
      sourceNotes: "",
    };

    setCategoryFilter("");
    onApply((current) => applyWorksheetItemUpsert(current, draftItem));
    setSelectedRowId(temporaryId);
    setSelectedCell({ rowId: temporaryId, column: "entityName" });
    setEntityDropdownRowId(temporaryId);
    setEntitySearchTerm("");
    setEntitySearchError(null);
    setEntityPluginResults([]);
  }, [onApply, workspace.currentRevision.defaultMarkup, workspace.worksheets]);

  const removeItem = useCallback((
    itemId: string,
    fallbackMessage = "Delete failed.",
  ) => {
    if (isTemporaryWorksheetItemId(itemId)) {
      onApply((current) => applyWorksheetItemDelete(current, itemId));
      return;
    }

    onApply((current) => applyWorksheetItemDelete(current, itemId));

    startTransition(async () => {
      try {
        const mutation = await deleteWorksheetItemFast(workspace.project.id, itemId);
        onApply((current) => applyWorksheetItemMutation(current, mutation));
      } catch (error) {
        applyMutationError(fallbackMessage, error);
      }
    });
  }, [applyMutationError, onApply, workspace.project.id]);

  const positionEntityDropdown = useCallback((anchorEl?: HTMLTableCellElement | null) => {
    const anchor = anchorEl ?? entityCellRef.current;
    if (!anchor || typeof window === "undefined") return;

    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const dropdownWidth = entityDropdownRef.current?.offsetWidth ?? ENTITY_DROPDOWN_WIDTH;
    const headerEl = entityDropdownRef.current?.querySelector<HTMLElement>("[data-entity-dropdown-header]");
    const headerHeight = Math.ceil(
      headerEl?.getBoundingClientRect().height ?? ENTITY_DROPDOWN_HEADER_HEIGHT
    );
    const headerTopMax = Math.max(
      ENTITY_DROPDOWN_MARGIN,
      viewportHeight - ENTITY_DROPDOWN_MARGIN - headerHeight
    );
    const headerTop = Math.min(Math.max(rect.top, ENTITY_DROPDOWN_MARGIN), headerTopMax);
    const spaceBelowList = Math.max(
      0,
      viewportHeight - headerTop - headerHeight - ENTITY_DROPDOWN_MARGIN
    );
    const spaceAboveList = Math.max(0, headerTop - ENTITY_DROPDOWN_MARGIN);
    const placement: "above" | "below" =
      spaceBelowList >= Math.min(ENTITY_DROPDOWN_PREFERRED_LIST_HEIGHT, spaceAboveList) ||
      spaceBelowList >= spaceAboveList
        ? "below"
        : "above";
    const listMaxHeight = Math.max(
      0,
      Math.min(
        ENTITY_DROPDOWN_PREFERRED_LIST_HEIGHT,
        placement === "above" ? spaceAboveList : spaceBelowList
      )
    );
    const maxHeight = headerHeight + listMaxHeight;
    const top = headerTop;
    const maxLeft = Math.max(
      ENTITY_DROPDOWN_MARGIN,
      viewportWidth - dropdownWidth - ENTITY_DROPDOWN_MARGIN
    );
    const left = Math.min(Math.max(rect.left, ENTITY_DROPDOWN_MARGIN), maxLeft);

    setEntityDropdownPos({
      left,
      top,
      bottom: undefined,
      maxHeight,
      listMaxHeight,
      placement,
    });
  }, []);

  // Load entity categories on mount
  useEffect(() => {
    let cancelled = false;
    getEntityCategories()
      .then((cats) => {
        if (!cancelled) setEntityCategories(cats);
      })
      .catch(() => {
        // Silently fail; categories will be empty
      });
    return () => { cancelled = true; };
  }, []);

  // Sync active tab when worksheets change
  useEffect(() => {
    if (worksheetViewIsFolder(activeTab)) {
      const folderId = folderIdFromView(activeTab);
      if (folderId && !findWorksheetFolder(workspace, folderId)) {
        setActiveTab(workspace.worksheets[0]?.id ?? "all");
      }
      return;
    }
    if (activeTab !== "all" && !findWs(workspace, activeTab)) {
      setActiveTab(workspace.worksheets[0]?.id ?? "all");
    }
  }, [workspace, activeTab, setActiveTab]);

  // Focus entity search when dropdown opens
  useEffect(() => {
    if (entityDropdownRowId) {
      setTimeout(() => entitySearchRef.current?.focus(), 0);
    }
  }, [entityDropdownRowId]);

  useEffect(() => {
    if (!entityDropdownRowId) return;

    positionEntityDropdown();

    const handleViewportChange = () => positionEntityDropdown();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [entityDropdownRowId, positionEntityDropdown]);

  // Focus inline rename input
  useEffect(() => {
    if (inlineRenameWsId) {
      setTimeout(() => {
        inlineRenameRef.current?.focus();
        inlineRenameRef.current?.select();
      }, 0);
    }
  }, [inlineRenameWsId]);

  // Clear selection when worksheet tab changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [activeTab]);

  const activeEntityRow = useMemo(() => {
    if (!entityDropdownRowId) return null;
    return (workspace.worksheets ?? [])
      .flatMap((worksheet) => worksheet.items)
      .find((row) => row.id === entityDropdownRowId) ?? null;
  }, [entityDropdownRowId, workspace.worksheets]);
  const estimateSearchSettings = useMemo(
    () => readEstimateSearchSettings(workspace.currentRevision.pdfPreferences),
    [workspace.currentRevision.pdfPreferences],
  );
  const enabledEntityBrowseCards = useMemo(
    () => ENTITY_BROWSE_CARDS.filter((card) => browseCardIsEnabled(estimateSearchSettings, card)),
    [estimateSearchSettings],
  );
  const activeEntityBrowseCard = useMemo(
    () => {
      const card = entityBrowseCardById(entityBrowseMode);
      return card && browseCardIsEnabled(estimateSearchSettings, card) ? card : null;
    },
    [entityBrowseMode, estimateSearchSettings],
  );

  useEffect(() => {
    if (!entityDropdownRowId || !activeEntityRow) {
      setEntitySearchGroups([]);
      setEntitySearchLoading(false);
      setEntitySearchLoadingMore(false);
      entitySearchLoadingMoreRef.current = false;
      setEntitySearchHasMore(false);
      setEntitySearchOffset(0);
      setEntitySearchError(null);
      setEntityPluginResults([]);
      setEntityBrowseMode(null);
      return;
    }

    const requestId = ++entitySearchRequestRef.current;
    const trimmedSearch = entitySearchTerm.trim();
    const browseCard = trimmedSearch ? null : activeEntityBrowseCard;
    if (!trimmedSearch && !browseCard) {
      setEntitySearchGroups([]);
      setEntitySearchLoading(false);
      setEntitySearchLoadingMore(false);
      entitySearchLoadingMoreRef.current = false;
      setEntitySearchHasMore(false);
      setEntitySearchOffset(0);
      setEntitySearchError(null);
      setEntityPluginResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setEntitySearchLoading(true);
      setEntitySearchLoadingMore(false);
      entitySearchLoadingMoreRef.current = false;
      setEntitySearchHasMore(false);
      setEntitySearchOffset(0);
      setEntitySearchError(null);
      try {
        const results = await searchLineItemCandidates(workspace.project.id, {
          q: entitySearchTerm,
          category: activeEntityRow.category,
          worksheetId: activeEntityRow.worksheetId,
          sourceTypes: enabledSearchSourcesForRequest(estimateSearchSettings, browseCard?.sources),
          disabledSourceTypes: estimateSearchSettings.disabledSourceTypes,
          disabledLaborLibraryIds: estimateSearchSettings.disabledLaborLibraryIds,
          disabledCatalogIds: estimateSearchSettings.disabledCatalogIds,
          limit: ENTITY_SEARCH_PAGE_SIZE,
          offset: 0,
        });
        if (requestId !== entitySearchRequestRef.current) return;
        setEntitySearchGroups(groupSearchResults(results, entityCategories, entitySearchTerm, activeEntityRow.category));
        setEntitySearchOffset(results.length);
        setEntitySearchHasMore(results.length === ENTITY_SEARCH_PAGE_SIZE);
        setEntityPluginResults([]);
      } catch (error) {
        if (requestId !== entitySearchRequestRef.current) return;
        setEntitySearchGroups([]);
        setEntitySearchOffset(0);
        setEntitySearchHasMore(false);
        setEntitySearchError(error instanceof Error ? error.message : "Search failed.");
      } finally {
        if (requestId === entitySearchRequestRef.current) {
          setEntitySearchLoading(false);
        }
      }
    }, trimmedSearch ? 180 : 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeEntityBrowseCard, activeEntityRow, entityCategories, entityBrowseMode, entityDropdownRowId, entitySearchTerm, estimateSearchSettings, workspace.project.id]);

  const loadMoreEntitySearchResults = useCallback(async () => {
    if (
      !entityDropdownRowId ||
      !activeEntityRow ||
      entitySearchLoading ||
      entitySearchLoadingMore ||
      entitySearchLoadingMoreRef.current ||
      !entitySearchHasMore
    ) {
      return;
    }

    const requestId = entitySearchRequestRef.current;
    const trimmedSearch = entitySearchTerm.trim();
    const browseCard = trimmedSearch ? null : activeEntityBrowseCard;
    entitySearchLoadingMoreRef.current = true;
    setEntitySearchLoadingMore(true);
    setEntitySearchError(null);
    try {
      const results = await searchLineItemCandidates(workspace.project.id, {
        q: entitySearchTerm,
        category: activeEntityRow.category,
        worksheetId: activeEntityRow.worksheetId,
        sourceTypes: enabledSearchSourcesForRequest(estimateSearchSettings, browseCard?.sources),
        disabledSourceTypes: estimateSearchSettings.disabledSourceTypes,
        disabledLaborLibraryIds: estimateSearchSettings.disabledLaborLibraryIds,
        disabledCatalogIds: estimateSearchSettings.disabledCatalogIds,
        limit: ENTITY_SEARCH_PAGE_SIZE,
        offset: entitySearchOffset,
      });
      if (requestId !== entitySearchRequestRef.current) return;
      const nextGroups = groupSearchResults(results, entityCategories, entitySearchTerm, activeEntityRow.category);
      setEntitySearchGroups((current) => mergeEntityOptionGroups(current, nextGroups));
      setEntitySearchOffset((current) => current + results.length);
      setEntitySearchHasMore(results.length === ENTITY_SEARCH_PAGE_SIZE);
    } catch (error) {
      if (requestId !== entitySearchRequestRef.current) return;
      setEntitySearchError(error instanceof Error ? error.message : "Search failed.");
      setEntitySearchHasMore(false);
    } finally {
      if (requestId === entitySearchRequestRef.current) {
        entitySearchLoadingMoreRef.current = false;
        setEntitySearchLoadingMore(false);
      }
    }
  }, [
    activeEntityRow,
    activeEntityBrowseCard,
    entityCategories,
    entityBrowseMode,
    entityDropdownRowId,
    entitySearchHasMore,
    entitySearchLoading,
    entitySearchLoadingMore,
    entitySearchOffset,
    entitySearchTerm,
    estimateSearchSettings,
    workspace.project.id,
  ]);

  const entityDisplayGroups = useMemo(() => {
    if (entityPluginResults.length === 0) return entitySearchGroups;
    const remoteGroup: EntityOptionGroup = {
      categoryName: "Provider Results",
      categoryId: "__provider_results",
      entityType: "Material",
      defaultUom: "EA",
      label: "Provider results",
      source: "plugin_result",
      sortPriority: 50,
      tone: "success",
      items: entityPluginResults,
    };
    return [remoteGroup, ...entitySearchGroups];
  }, [entityPluginResults, entitySearchGroups]);

  // Flat list of selectable entity items for keyboard navigation when the
  // entity dropdown is open. Items in the "matching" group come first.
  const entityFlatItems = useMemo(() => {
    if (!entityDropdownRowId || !activeEntityRow) return [];
    type FlatEntity = { group: EntityOptionGroup; item: EntityOptionItem };
    const out: FlatEntity[] = [];
    for (const group of entityDisplayGroups) {
      for (const item of group.items) out.push({ group, item });
    }
    return out;
  }, [activeEntityRow, entityDisplayGroups, entityDropdownRowId]);

  // Reset highlight when dropdown opens or search changes
  useEffect(() => {
    setEntityHighlightIdx(0);
  }, [entityBrowseMode, entityDropdownRowId, entitySearchTerm]);

  useEffect(() => {
    setEntityHighlightIdx((current) => {
      if (entityFlatItems.length === 0) return 0;
      return Math.min(current, entityFlatItems.length - 1);
    });
  }, [entityFlatItems.length]);

  // Scroll the highlighted entity item into view
  useEffect(() => {
    if (!entityDropdownRowId || !entityDropdownRef.current) return;
    const el = entityDropdownRef.current.querySelector<HTMLElement>(`[data-entity-idx="${entityHighlightIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [entityHighlightIdx, entityDropdownRowId]);

  // ─── Dynamic Column Visibility (auto-default) ───
  // Analyzes active rows' categories to auto-hide irrelevant labor columns.
  // Only applies when user hasn't manually toggled columns yet.
  const autoDefaultColumns = useMemo(() => {
    if (entityCategories.length === 0) return null;

    const allItems = (workspace.worksheets ?? []).flatMap((w) => w.items);
    const activeCats = new Set(allItems.map((r) => r.category));
    const activeCatDefs = entityCategories.filter((c) => activeCats.has(c.name));

    const cols = new Set(DEFAULT_VISIBLE_COLUMNS);

    // Hide combined units column if no rows use labour or have unit fields
    const hasLabourOrUnit1 = activeCatDefs.some((c) =>
      categoryUsesTieredUnits(c) || categoryAllowsEditingTierUnits(c)
    );
    if (!hasLabourOrUnit1 && allItems.length > 0) {
      cols.delete("units");
    }

    return cols;
  }, [entityCategories, workspace.worksheets]);

  // Apply auto-default columns when categories first load (and user hasn't toggled)
  useEffect(() => {
    if (autoDefaultColumns && !userToggledColumnsRef.current) {
      setVisibleColumns(autoDefaultColumns);
    }
  }, [autoDefaultColumns]);

  const getRowHourBreakdown = useCallback(
    (row: WorkspaceWorksheetItem) => getRowSlotHours(row, workspace.rateSchedules),
    [workspace.rateSchedules],
  );

  const getRowUnitSlotLabels = useCallback(
    (row: WorkspaceWorksheetItem, category: EntityCategory | undefined) => {
      const schedule = findScheduleForRow(row, workspace.rateSchedules);
      return {
        unit1: getTierSlotLabel("unit1", category, schedule),
        unit2: getTierSlotLabel("unit2", category, schedule),
        unit3: getTierSlotLabel("unit3", category, schedule),
      };
    },
    [workspace.rateSchedules],
  );

  const getEditableValue = useCallback(
    (row: WorkspaceWorksheetItem, column: EditableColumn) => {
      if (column === "unit1" || column === "unit2" || column === "unit3") {
        return getRowHourBreakdown(row)[column];
      }
      return row[column as keyof WorkspaceWorksheetItem];
    },
    [getRowHourBreakdown],
  );

  // Toggle sort on column click
  function handleSortToggle(column: ColumnId) {
    setSortState((prev) => {
      if (prev?.column === column) {
        if (prev.direction === "asc") return { column, direction: "desc" };
        // Third click clears sort
        return null;
      }
      return { column, direction: "asc" };
    });
  }

  const adjustedLineItemsById = useMemo(() => {
    const rows = workspace.estimate?.totals?.adjustedLineItems ?? workspace.estimate?.lineItems ?? [];
    return new Map(rows.map((item) => [item.id, item]));
  }, [workspace.estimate?.lineItems, workspace.estimate?.totals?.adjustedLineItems]);

  const displayLineItem = useCallback(
    (item: WorkspaceWorksheetItem) => adjustedLineItemsById.get(item.id) ?? item,
    [adjustedLineItemsById],
  );

  const lineItemHasFactorAdjustment = useCallback((item: WorkspaceWorksheetItem) => {
    const adjusted = adjustedLineItemsById.get(item.id);
    if (!adjusted) return false;
    if (
      Math.abs((adjusted.price ?? 0) - (item.price ?? 0)) >= 0.005 ||
      Math.abs((adjusted.cost ?? 0) - (item.cost ?? 0)) >= 0.005
    ) {
      return true;
    }
    const adjustedSlots = getRowSlotHours(adjusted, workspace.rateSchedules);
    const itemSlots = getRowSlotHours(item, workspace.rateSchedules);
    return (
      Math.abs(adjustedSlots.unit1 - itemSlots.unit1) >= 0.005 ||
      Math.abs(adjustedSlots.unit2 - itemSlots.unit2) >= 0.005 ||
      Math.abs(adjustedSlots.unit3 - itemSlots.unit3) >= 0.005
    );
  }, [adjustedLineItemsById, workspace.rateSchedules]);

  // Get visible rows
  const visibleRows = useMemo(() => {
    let rows: WorkspaceWorksheetItem[];

    if (activeTab === "all") {
      rows = (workspace.worksheets ?? []).flatMap((w) => w.items);
    } else if (worksheetViewIsFolder(activeTab)) {
      const folderId = folderIdFromView(activeTab);
      rows = folderId
        ? getWorksheetsInFolderView(workspace, folderId).flatMap((w) => w.items)
        : [];
    } else {
      const ws = findWs(workspace, activeTab);
      rows = ws ? ws.items : [];
    }

    if (categoryFilter) {
      rows = rows.filter((r) => r.category === categoryFilter);
    }

    if (phaseFilter) {
      rows = rows.filter((r) => r.phaseId === phaseFilter);
    }

    // Apply sorting
    if (sortState) {
      const { column, direction } = sortState;
      const mult = direction === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        let aVal: string | number = 0;
        let bVal: string | number = 0;

        switch (column) {
          case "lineOrder": aVal = a.lineOrder; bVal = b.lineOrder; break;
          case "entityName": aVal = a.entityName.toLowerCase(); bVal = b.entityName.toLowerCase(); break;
          case "vendor": aVal = (a.vendor ?? "").toLowerCase(); bVal = (b.vendor ?? "").toLowerCase(); break;
          case "description": aVal = a.description.toLowerCase(); bVal = b.description.toLowerCase(); break;
          case "quantity": aVal = a.quantity; bVal = b.quantity; break;
          case "uom": aVal = a.uom; bVal = b.uom; break;
          case "unit1": aVal = getRowHourBreakdown(displayLineItem(a)).unit1; bVal = getRowHourBreakdown(displayLineItem(b)).unit1; break;
          case "unit2": aVal = getRowHourBreakdown(displayLineItem(a)).unit2; bVal = getRowHourBreakdown(displayLineItem(b)).unit2; break;
          case "unit3": aVal = getRowHourBreakdown(displayLineItem(a)).unit3; bVal = getRowHourBreakdown(displayLineItem(b)).unit3; break;
          case "cost": aVal = displayLineItem(a).cost; bVal = displayLineItem(b).cost; break;
          case "markup": aVal = a.markup; bVal = b.markup; break;
          case "price": aVal = displayLineItem(a).price; bVal = displayLineItem(b).price; break;
          case "extCost": aVal = displayLineItem(a).cost * a.quantity; bVal = displayLineItem(b).cost * b.quantity; break;
          case "margin": {
            const adjustedA = displayLineItem(a);
            const adjustedB = displayLineItem(b);
            const aExt = adjustedA.cost * a.quantity;
            const bExt = adjustedB.cost * b.quantity;
            aVal = adjustedA.price > 0 ? (adjustedA.price - aExt) / adjustedA.price : 0;
            bVal = adjustedB.price > 0 ? (adjustedB.price - bExt) / adjustedB.price : 0;
            break;
          }
          default: return 0;
        }

        if (aVal < bVal) return -1 * mult;
        if (aVal > bVal) return 1 * mult;
        return 0;
      });
    }

    return rows;
  }, [categoryFilter, phaseFilter, activeTab, workspace, sortState, getRowHourBreakdown, displayLineItem]);

  const activeFolderId = folderIdFromView(activeTab);
  const activeFolder = activeFolderId ? findWorksheetFolder(workspace, activeFolderId) : null;
  const activeWorksheetForActions = useMemo(() => {
    if (activeTab !== "all" && !worksheetViewIsFolder(activeTab)) {
      return findWs(workspace, activeTab);
    }
    if (activeFolderId) {
      return getWorksheetsInFolderView(workspace, activeFolderId)[0] ?? null;
    }
    return workspace.worksheets[0] ?? null;
  }, [activeFolderId, activeTab, workspace]);

  const activeViewLabel = activeTab === "all"
    ? "All worksheets"
    : activeFolder
      ? getWorksheetFolderPath(workspace.worksheetFolders ?? [], activeFolder.id)
      : findWs(workspace, activeTab)?.name ?? "Worksheet";

  const fitWidth = worksheetViewMode === "organizer" && gridWidth > 0
    ? gridWidth + WORKSHEET_ORGANIZER_PANEL_WIDTH + WORKSHEET_ORGANIZER_PANEL_GAP
    : gridWidth;
  const fitLevel: FitLevel = fitWidth > 0 && fitWidth < 760
    ? "tight"
    : fitWidth > 0 && fitWidth < 1040
      ? "compact"
      : "full";

  // Grouped rows
  const groupedRows = useMemo(
    () => groupRowsByCategory(visibleRows, entityCategories, sortState !== null, adjustedLineItemsById),
    [visibleRows, entityCategories, sortState, adjustedLineItemsById]
  );

  // Totals
  const totals = useMemo(() => {
    return {
      cost: visibleRows.reduce((sum, r) => sum + displayLineItem(r).cost * r.quantity, 0),
      price: visibleRows.reduce((sum, r) => sum + displayLineItem(r).price, 0),
      regHrs: visibleRows.reduce((sum, r) => sum + getRowHourBreakdown(displayLineItem(r)).unit1 * r.quantity, 0),
      otHrs: visibleRows.reduce((sum, r) => sum + getRowHourBreakdown(displayLineItem(r)).unit2 * r.quantity, 0),
      dtHrs: visibleRows.reduce((sum, r) => sum + getRowHourBreakdown(displayLineItem(r)).unit3 * r.quantity, 0),
      count: visibleRows.length,
    };
  }, [visibleRows, getRowHourBreakdown, displayLineItem]);

  const lineFactorsByItemId = useMemo(() => {
    const map = new Map<string, EstimateFactor[]>();
    for (const factor of workspace.estimateFactors ?? []) {
      const ids = Array.isArray(factor.scope?.worksheetItemIds) ? factor.scope.worksheetItemIds : [];
      if ((factor.applicationScope ?? "global") === "global" || ids.length === 0) continue;
      for (const id of ids) {
        const list = map.get(id) ?? [];
        list.push(factor);
        map.set(id, list);
      }
    }
    return map;
  }, [workspace.estimateFactors]);

  const factorTotalsById = useMemo(
    () => new Map((workspace.estimate?.totals?.factorTotals ?? []).map((entry) => [entry.id, entry])),
    [workspace.estimate?.totals?.factorTotals],
  );

  const activeAddItemsBrowseCard = useMemo(
    () => {
      const card = entityBrowseCardById(addItemsBrowseMode);
      return card && browseCardIsEnabled(estimateSearchSettings, card) ? card : null;
    },
    [addItemsBrowseMode, estimateSearchSettings],
  );

  const addItemsFlatItems = useMemo(() => {
    type FlatEntity = { group: EntityOptionGroup; item: EntityOptionItem };
    const rows: FlatEntity[] = [];
    for (const group of addItemsGroups) {
      for (const item of group.items) rows.push({ group, item });
    }
    return rows;
  }, [addItemsGroups]);

  useEffect(() => {
    if (!showAddItemsPicker) {
      setAddItemsGroups([]);
      setAddItemsLoading(false);
      setAddItemsLoadingMore(false);
      addItemsLoadingMoreRef.current = false;
      setAddItemsHasMore(false);
      setAddItemsOffset(0);
      setAddItemsError(null);
      setAddItemsBrowseMode(null);
      setAddItemsSearchTerm("");
      setSelectedAddItems(new Map());
      return;
    }

    const requestId = ++addItemsRequestRef.current;
    const trimmedSearch = addItemsSearchTerm.trim();
    const browseCard = trimmedSearch ? null : activeAddItemsBrowseCard;
    if (!trimmedSearch && !browseCard) {
      setAddItemsGroups([]);
      setAddItemsLoading(false);
      setAddItemsLoadingMore(false);
      addItemsLoadingMoreRef.current = false;
      setAddItemsHasMore(false);
      setAddItemsOffset(0);
      setAddItemsError(null);
      return;
    }

    const timer = window.setTimeout(async () => {
      setAddItemsLoading(true);
      setAddItemsLoadingMore(false);
      addItemsLoadingMoreRef.current = false;
      setAddItemsHasMore(false);
      setAddItemsOffset(0);
      setAddItemsError(null);
      try {
        const results = await searchLineItemCandidates(workspace.project.id, {
          q: addItemsSearchTerm,
          worksheetId: activeWorksheetForActions?.id,
          sourceTypes: enabledSearchSourcesForRequest(estimateSearchSettings, browseCard?.sources),
          disabledSourceTypes: estimateSearchSettings.disabledSourceTypes,
          disabledLaborLibraryIds: estimateSearchSettings.disabledLaborLibraryIds,
          disabledCatalogIds: estimateSearchSettings.disabledCatalogIds,
          limit: ENTITY_SEARCH_PAGE_SIZE,
          offset: 0,
        });
        if (requestId !== addItemsRequestRef.current) return;
        setAddItemsGroups(groupSearchResults(results, entityCategories, addItemsSearchTerm, ""));
        setAddItemsOffset(results.length);
        setAddItemsHasMore(results.length === ENTITY_SEARCH_PAGE_SIZE);
      } catch (error) {
        if (requestId !== addItemsRequestRef.current) return;
        setAddItemsGroups([]);
        setAddItemsOffset(0);
        setAddItemsHasMore(false);
        setAddItemsError(error instanceof Error ? error.message : "Search failed.");
      } finally {
        if (requestId === addItemsRequestRef.current) {
          setAddItemsLoading(false);
        }
      }
    }, trimmedSearch ? 180 : 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeAddItemsBrowseCard,
    activeWorksheetForActions?.id,
    addItemsBrowseMode,
    addItemsSearchTerm,
    entityCategories,
    estimateSearchSettings,
    showAddItemsPicker,
    workspace.project.id,
  ]);

  const loadMoreAddItems = useCallback(async () => {
    if (
      !showAddItemsPicker ||
      addItemsLoading ||
      addItemsLoadingMore ||
      addItemsLoadingMoreRef.current ||
      !addItemsHasMore
    ) {
      return;
    }

    const requestId = addItemsRequestRef.current;
    const trimmedSearch = addItemsSearchTerm.trim();
    const browseCard = trimmedSearch ? null : activeAddItemsBrowseCard;
    addItemsLoadingMoreRef.current = true;
    setAddItemsLoadingMore(true);
    setAddItemsError(null);
    try {
      const results = await searchLineItemCandidates(workspace.project.id, {
        q: addItemsSearchTerm,
        worksheetId: activeWorksheetForActions?.id,
        sourceTypes: enabledSearchSourcesForRequest(estimateSearchSettings, browseCard?.sources),
        disabledSourceTypes: estimateSearchSettings.disabledSourceTypes,
        disabledLaborLibraryIds: estimateSearchSettings.disabledLaborLibraryIds,
        disabledCatalogIds: estimateSearchSettings.disabledCatalogIds,
        limit: ENTITY_SEARCH_PAGE_SIZE,
        offset: addItemsOffset,
      });
      if (requestId !== addItemsRequestRef.current) return;
      const nextGroups = groupSearchResults(results, entityCategories, addItemsSearchTerm, "");
      setAddItemsGroups((current) => mergeEntityOptionGroups(current, nextGroups));
      setAddItemsOffset((current) => current + results.length);
      setAddItemsHasMore(results.length === ENTITY_SEARCH_PAGE_SIZE);
    } catch (error) {
      if (requestId !== addItemsRequestRef.current) return;
      setAddItemsError(error instanceof Error ? error.message : "Search failed.");
      setAddItemsHasMore(false);
    } finally {
      if (requestId === addItemsRequestRef.current) {
        addItemsLoadingMoreRef.current = false;
        setAddItemsLoadingMore(false);
      }
    }
  }, [
    activeAddItemsBrowseCard,
    activeWorksheetForActions?.id,
    addItemsHasMore,
    addItemsLoading,
    addItemsLoadingMore,
    addItemsOffset,
    addItemsSearchTerm,
    entityCategories,
    estimateSearchSettings,
    showAddItemsPicker,
    workspace.project.id,
  ]);

  // Helper to check if a column is visible
  // Checkbox column only appears when items are selected (bulk mode)
  const isColVisible = useCallback(
    (col: ColumnId) => {
      if (col === "checkbox") return selectedIds.size > 0;
      if (!visibleColumns.has(col)) return false;
      if (fitLevel === "compact") {
        return !["lineOrder", "vendor", "extCost", "markup", "margin"].includes(col);
      }
      if (fitLevel === "tight") {
        return !["lineOrder", "vendor", "uom", "factors", "extCost", "markup", "margin", "phaseId", "actions"].includes(col);
      }
      return true;
    },
    [fitLevel, visibleColumns, selectedIds.size]
  );

  // Count visible data columns for colSpan on group header
  const visibleColumnCount = useMemo(() => {
    let count = 0;
    // expand, checkbox, reorder are always-visible structural columns
    if (isColVisible("expand")) count++;
    if (isColVisible("checkbox")) count++;
    if (isColVisible("reorder")) count++;
    for (const col of TOGGLEABLE_COLUMNS) {
      if (isColVisible(col)) count++;
    }
    // actions column
    if (isColVisible("actions")) count++;
    return count;
  }, [isColVisible]);

  const tableMinWidth = useMemo(() => {
    return ESTIMATE_TABLE_COLUMN_ORDER.reduce((width, column) => (
      isColVisible(column) ? width + ESTIMATE_TABLE_COLUMN_WIDTHS[column] : width
    ), 0);
  }, [isColVisible]);

  // ─── Cell editing ───

  function startEditing(rowId: string, column: EditableColumn, currentValue: string | number) {
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;

    // Entity name uses the dropdown instead
    if (column === "entityName") {
      setEntityDropdownRowId(rowId);
      setEntitySearchTerm("");
      setSelectedCell({ rowId, column });
      setSelectedRowId(rowId);
      return;
    }

    if (isTemporaryWorksheetItemId(row.id)) return;

    const catDef = findCategoryForRow(row, entityCategories);
    if (isCellDisabledByCategory(catDef, column)) return;

    let val: string;
    if (column === "markup") {
      val = fmtPct(currentValue as number);
    } else {
      val = String(currentValue ?? "");
    }

    setEditingCell({ rowId, column });
    setSelectedCell({ rowId, column });
    setEditValue(val);
    setSelectedRowId(rowId);

    setTimeout(() => {
      editInputRef.current?.focus();
      if (editInputRef.current && "select" in editInputRef.current) {
        (editInputRef.current as HTMLInputElement).select();
      }
    }, 0);
  }

  function commitEdit() {
    if (!editingCell) return;
    const { rowId, column } = editingCell;
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) {
      setEditingCell(null);
      return;
    }

    let patch: Record<string, unknown> = {};
    const currentVal = getEditableValue(row, column);

    if (column === "markup") {
      const numVal = parseNum(editValue) / 100;
      if (numVal === currentVal) {
        setEditingCell(null);
        return;
      }
      patch = { markup: numVal };
    } else if (
      column === "quantity" ||
      column === "cost" ||
      column === "price" ||
      column === "unit1" ||
      column === "unit2" ||
      column === "unit3"
    ) {
      const numVal = parseNum(editValue);
      if (numVal === currentVal) {
        setEditingCell(null);
        return;
      }
      if (column === "unit1" || column === "unit2" || column === "unit3") {
        const schedule = findScheduleForRow(row, workspace.rateSchedules);
        patch = {
          tierUnits: writeTierSlotHours(row.tierUnits, schedule, column, numVal),
        };
      } else {
        patch = { [column]: numVal };
      }
    } else if (column === "phaseId") {
      const phaseVal = editValue || null;
      if (phaseVal === currentVal) {
        setEditingCell(null);
        return;
      }
      patch = { phaseId: phaseVal };
    } else {
      if (editValue === currentVal) {
        setEditingCell(null);
        return;
      }
      patch = { [column]: editValue };
    }

    setEditingCell(null);
    commitItemPatch(rowId, patch as WorksheetItemPatchInput);
  }

  function cancelEdit() {
    setEditingCell(null);
  }

  /** Advance to next editable cell in tab order, skipping disabled ones */
  function advanceToNextCell(rowId: string, column: EditableColumn) {
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;
    const catDef = findCategoryForRow(row, entityCategories);

    const colIdx = EDITABLE_COLUMNS_ORDER.indexOf(column);
    // Try remaining columns in current row
    for (let i = colIdx + 1; i < EDITABLE_COLUMNS_ORDER.length; i++) {
      const nextCol = EDITABLE_COLUMNS_ORDER[i];
      if (!isCellDisabledByCategory(catDef, nextCol)) {
        const rawVal = getEditableValue(row, nextCol);
        startEditing(rowId, nextCol, rawVal as string | number);
        return;
      }
    }
    // Move to next row, first editable column
    const rowIdx = visibleRows.indexOf(row);
    if (rowIdx < visibleRows.length - 1) {
      const nextRow = visibleRows[rowIdx + 1];
      const nextCatDef = findCategoryForRow(nextRow, entityCategories);
      for (const col of EDITABLE_COLUMNS_ORDER) {
        if (!isCellDisabledByCategory(nextCatDef, col)) {
          const rawVal = getEditableValue(nextRow, col);
          startEditing(nextRow.id, col, rawVal as string | number);
          return;
        }
      }
    }
  }

  function retreatToPrevCell(rowId: string, column: EditableColumn) {
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;
    const catDef = findCategoryForRow(row, entityCategories);
    const colIdx = EDITABLE_COLUMNS_ORDER.indexOf(column);
    for (let i = colIdx - 1; i >= 0; i--) {
      const prevCol = EDITABLE_COLUMNS_ORDER[i];
      if (!isCellDisabledByCategory(catDef, prevCol)) {
        const rawVal = getEditableValue(row, prevCol);
        startEditing(rowId, prevCol, rawVal as string | number);
        return;
      }
    }
    // Wrap to previous row's last editable column
    const rowIdx = visibleRows.indexOf(row);
    if (rowIdx > 0) {
      const prevRow = visibleRows[rowIdx - 1];
      const prevCatDef = findCategoryForRow(prevRow, entityCategories);
      for (let i = EDITABLE_COLUMNS_ORDER.length - 1; i >= 0; i--) {
        const col = EDITABLE_COLUMNS_ORDER[i];
        if (!isCellDisabledByCategory(prevCatDef, col)) {
          const rawVal = getEditableValue(prevRow, col);
          startEditing(prevRow.id, col, rawVal as string | number);
          return;
        }
      }
    }
  }

  // ─── Selected-cell movement (no edit mode) ───
  function moveSelectedCell(dir: "up" | "down" | "left" | "right") {
    if (!selectedCell) return;
    const { rowId, column } = selectedCell;
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;
    const catDef = findCategoryForRow(row, entityCategories);

    if (dir === "left" || dir === "right") {
      const colIdx = EDITABLE_COLUMNS_ORDER.indexOf(column);
      const step = dir === "right" ? 1 : -1;
      for (let i = colIdx + step; i >= 0 && i < EDITABLE_COLUMNS_ORDER.length; i += step) {
        const c = EDITABLE_COLUMNS_ORDER[i];
        if (!isCellDisabledByCategory(catDef, c)) {
          setSelectedCell({ rowId, column: c });
          return;
        }
      }
      return;
    }

    // up / down: same column, prev/next visible row whose column is editable
    const rowIdx = visibleRows.indexOf(row);
    const step = dir === "down" ? 1 : -1;
    for (let i = rowIdx + step; i >= 0 && i < visibleRows.length; i += step) {
      const candidate = visibleRows[i];
      const candCat = findCategoryForRow(candidate, entityCategories);
      if (!isCellDisabledByCategory(candCat, column)) {
        setSelectedCell({ rowId: candidate.id, column });
        setSelectedRowId(candidate.id);
        return;
      }
    }
  }

  // ─── Document-level keyboard nav when a cell is selected but not editing ───
  useEffect(() => {
    if (!selectedCell || editingCell) return;
    if (entityDropdownRowId) return; // entity picker handles its own keys
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // Don't intercept when the user is typing in any editable surface
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) {
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveSelectedCell("down");
          return;
        case "ArrowUp":
          e.preventDefault();
          moveSelectedCell("up");
          return;
        case "ArrowLeft":
          e.preventDefault();
          moveSelectedCell("left");
          return;
        case "ArrowRight":
        case "Tab":
          e.preventDefault();
          moveSelectedCell(e.shiftKey ? "left" : "right");
          return;
        case "Enter":
        case "F2": {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return;
          e.preventDefault();
          const row = visibleRows.find((r) => r.id === selectedCell.rowId);
          if (!row) return;
          const rawVal = getEditableValue(row, selectedCell.column);
          startEditing(selectedCell.rowId, selectedCell.column, rawVal as string | number);
          return;
        }
        case "Escape":
          e.preventDefault();
          setSelectedCell(null);
          return;
      }
      // Printable single char → enter edit mode and let the input replace value
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const row = visibleRows.find((r) => r.id === selectedCell.rowId);
        if (!row) return;
        const rawVal = getEditableValue(row, selectedCell.column);
        startEditing(selectedCell.rowId, selectedCell.column, rawVal as string | number);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedCell, editingCell, entityDropdownRowId, visibleRows, entityCategories]);

  // Scroll the selected cell into view when it changes (without editing)
  useEffect(() => {
    if (!selectedCell || editingCell) return;
    const el = document.querySelector<HTMLElement>(
      `[data-cell-row="${selectedCell.rowId}"][data-cell-col="${selectedCell.column}"]`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedCell, editingCell]);

  // Clear selection if its row disappears
  useEffect(() => {
    if (!selectedCell) return;
    if (!visibleRows.some((r) => r.id === selectedCell.rowId)) setSelectedCell(null);
  }, [visibleRows, selectedCell]);

  function handleCellKeyDown(e: React.KeyboardEvent) {
    if (!editingCell) return;
    if (e.key === "Enter") {
      // Commit and keep this cell selected (no auto-advance) — Tab moves on
      e.preventDefault();
      const { rowId, column } = editingCell;
      commitEdit();
      setSelectedCell({ rowId, column });
    } else if (e.key === "Escape") {
      const { rowId, column } = editingCell;
      cancelEdit();
      setSelectedCell({ rowId, column });
    } else if (e.key === "Tab") {
      e.preventDefault();
      const { rowId, column } = editingCell;
      commitEdit();
      if (e.shiftKey) {
        setTimeout(() => retreatToPrevCell(rowId, column), 0);
      } else {
        setTimeout(() => advanceToNextCell(rowId, column), 0);
      }
    }
  }

  // ─── Entity selection ───

	  function handleEntitySelect(
    rowId: string,
    entityName: string,
    categoryName: string,
    entityType: string,
    defaultUom: string,
    catalogData?: {
      cost?: number;
      uom?: string;
      description?: string;
      vendor?: string | null;
      sourceNotes?: string;
      price?: number;
      quantity?: number;
      unit1?: number;
      unit2?: number;
      unit3?: number;
      costResourceId?: string;
      effectiveCostId?: string;
      laborUnitId?: string;
      resourceComposition?: Record<string, unknown>;
      sourceEvidence?: Record<string, unknown>;
    },
    rateScheduleItemId?: string,
    itemId?: string,
  ) {
    setEntityDropdownRowId(null);
    setEntityDropdownPos(null);
    setEntitySearchTerm("");
    setEntityBrowseMode(null);
    setEntityPluginResults([]);

	    const row = visibleRows.find((r) => r.id === rowId);
	    const newCatDef = entityCategories.find((c) => c.name === categoryName);
	    const oldCategory = row?.category;
	    const categoryChanged = oldCategory !== categoryName;
	    const preservingProductivityBasis = !!rateScheduleItemId && !!row?.laborUnitId;

	    const patch: Record<string, unknown> = {
	      categoryId: newCatDef?.id ?? null,
	      entityName,
	      category: categoryName,
	      entityType,
	      uom: preservingProductivityBasis ? row.uom : catalogData?.uom ?? defaultUom,
	    };

    if (catalogData?.cost !== undefined) patch.cost = catalogData.cost;
    if (catalogData?.price !== undefined) patch.price = catalogData.price;
    if (catalogData?.quantity !== undefined) patch.quantity = catalogData.quantity;
	    if (catalogData?.description && !(preservingProductivityBasis && row?.description)) patch.description = catalogData.description;
    if (catalogData?.vendor !== undefined) patch.vendor = catalogData.vendor;
    if (catalogData?.sourceNotes !== undefined) patch.sourceNotes = catalogData.sourceNotes;
    if (catalogData?.costResourceId !== undefined) patch.costResourceId = catalogData.costResourceId;
    if (catalogData?.effectiveCostId !== undefined) patch.effectiveCostId = catalogData.effectiveCostId;
    if (catalogData?.laborUnitId !== undefined) patch.laborUnitId = catalogData.laborUnitId;
    if (catalogData?.resourceComposition !== undefined) patch.resourceComposition = catalogData.resourceComposition;
    if (catalogData?.sourceEvidence !== undefined) patch.sourceEvidence = catalogData.sourceEvidence;

    if (preservingProductivityBasis && row) {
      if (row.laborUnitId && catalogData?.laborUnitId === undefined) {
        patch.laborUnitId = row.laborUnitId;
      }
      if (catalogData?.sourceNotes !== undefined || row.sourceNotes) {
        patch.sourceNotes = mergeSourceNotes(row.sourceNotes, catalogData?.sourceNotes);
      }
      if (catalogData?.resourceComposition !== undefined || hasMeaningfulMetadata(row.resourceComposition)) {
        patch.resourceComposition = mergeResourceCompositions(
          row.resourceComposition,
          catalogData?.resourceComposition,
        );
      }
      if (catalogData?.sourceEvidence !== undefined || hasMeaningfulMetadata(row.sourceEvidence)) {
        patch.sourceEvidence = mergeSourceEvidence(row.sourceEvidence, catalogData?.sourceEvidence);
      }
    }

    if (itemId) {
      patch.itemId = itemId;
    } else if (categoryChanged) {
      patch.itemId = null;
    }

	    if (rateScheduleItemId) {
	      patch.rateScheduleItemId = rateScheduleItemId;
	      const schedule = (workspace.rateSchedules ?? []).find((s) =>
	        s.items.some((i) => i.id === rateScheduleItemId),
	      );
	      if (schedule) {
	        const incomingUnit1 = Number(catalogData?.unit1 ?? 0);
	        const incomingUnit2 = Number(catalogData?.unit2 ?? 0);
	        const incomingUnit3 = Number(catalogData?.unit3 ?? 0);
	        // Existing per-row hours bucketed by tier multiplier (1.0/1.5/2.0).
	        const existingSlots = row ? getRowSlotHours(row, workspace.rateSchedules ?? []) : { unit1: 0, unit2: 0, unit3: 0 };
	        const existingUnit1 = incomingUnit1 || existingSlots.unit1;
	        const existingUnit2 = incomingUnit2 || existingSlots.unit2;
	        const existingUnit3 = incomingUnit3 || existingSlots.unit3;
	        const hasProductivityHours = !!(catalogData?.laborUnitId ?? row?.laborUnitId) && (existingUnit1 > 0 || existingUnit2 > 0 || existingUnit3 > 0);
	        const sortedTiers = [...schedule.tiers].sort((left, right) => left.multiplier - right.multiplier || left.sortOrder - right.sortOrder);
	        const tierUnits: Record<string, number> = {};
	        if (hasProductivityHours) {
	          const regular = sortedTiers.find((tier) => tier.multiplier === 1) ?? sortedTiers[0];
	          const overtime = sortedTiers.find((tier) => tier.multiplier === 1.5);
	          const doubletime = sortedTiers.find((tier) => tier.multiplier === 2);
	          if (regular && existingUnit1 > 0) tierUnits[regular.id] = existingUnit1;
	          if (overtime && existingUnit2 > 0) tierUnits[overtime.id] = existingUnit2;
	          if (doubletime && existingUnit3 > 0) tierUnits[doubletime.id] = existingUnit3;
	        } else {
	          for (const tier of schedule.tiers) {
	            tierUnits[tier.id] = 0;
	          }
	        }
	        patch.tierUnits = tierUnits;
	      }
    } else if (categoryChanged) {
      patch.rateScheduleItemId = null;
      patch.tierUnits = {};
    }

    if (
      categoryChanged &&
      catalogData?.costResourceId === undefined &&
      catalogData?.effectiveCostId === undefined &&
      catalogData?.laborUnitId === undefined
    ) {
      patch.costResourceId = null;
      patch.effectiveCostId = null;
      patch.laborUnitId = null;
      patch.resourceComposition = {};
      patch.sourceEvidence = {};
    }

	    if (categoryChanged && newCatDef) {
	      patch.uom = preservingProductivityBasis ? row?.uom : catalogData?.uom ?? newCatDef.defaultUom;
      if (!categoryAllowsEditingTierUnits(newCatDef)) patch.tierUnits = {};
      if (isCellDisabledByCategory(newCatDef, "cost")) patch.cost = catalogData?.cost ?? 0;
      if (isCellDisabledByCategory(newCatDef, "markup")) patch.markup = workspace.currentRevision.defaultMarkup ?? 0.2;
      if (isCellDisabledByCategory(newCatDef, "price")) patch.price = 0;
    }

    if (row && isTemporaryWorksheetItemId(row.id)) {
      const patchHas = (key: string) => Object.prototype.hasOwnProperty.call(patch, key);
      const patchValue = <T,>(key: string, fallback: T): T =>
        patchHas(key) && patch[key] !== undefined ? (patch[key] as T) : fallback;
      const createPayload: CreateWorksheetItemInput = {
	        phaseId: row.phaseId ?? null,
	        categoryId: (patch.categoryId as string | null | undefined) ?? newCatDef?.id ?? null,
	        category: String(patch.category ?? categoryName),
        entityType: String(patch.entityType ?? entityType),
        entityName: String(patch.entityName ?? entityName),
        classification: row.classification ?? {},
        costCode: row.costCode ?? null,
        vendor: (patch.vendor as string | null | undefined) ?? row.vendor ?? null,
        description: String(patch.description ?? row.description ?? ""),
        quantity: Number(patchValue("quantity", row.quantity ?? 1)),
        uom: String(patch.uom ?? row.uom ?? defaultUom),
        cost: Number(patch.cost ?? row.cost ?? 0),
        markup: Number(patch.markup ?? row.markup ?? workspace.currentRevision.defaultMarkup ?? 0.2),
        price: Number(patch.price ?? row.price ?? 0),
        lineOrder: row.lineOrder,
        rateScheduleItemId: patchValue("rateScheduleItemId", row.rateScheduleItemId ?? null) as string | null,
        itemId: patchValue("itemId", row.itemId ?? null) as string | null,
        costResourceId: patchValue("costResourceId", row.costResourceId ?? null) as string | null,
        effectiveCostId: patchValue("effectiveCostId", row.effectiveCostId ?? null) as string | null,
        laborUnitId: patchValue("laborUnitId", row.laborUnitId ?? null) as string | null,
        tierUnits: (patch.tierUnits as Record<string, number> | undefined) ?? row.tierUnits ?? {},
        sourceNotes: String(patch.sourceNotes ?? row.sourceNotes ?? ""),
        resourceComposition: patchValue("resourceComposition", row.resourceComposition ?? {}) as Record<string, unknown>,
        sourceEvidence: patchValue("sourceEvidence", row.sourceEvidence ?? {}) as Record<string, unknown>,
      };

      startTransition(async () => {
        try {
          const mutation = await createWorksheetItemFast(
            workspace.project.id,
            row.worksheetId,
            createPayload,
          );
          onApply((current) => {
            const withoutDraft = applyWorksheetItemDelete(current, row.id);
            return applyWorksheetItemMutation(withoutDraft, mutation);
          });
          setSelectedRowId(mutation.item.id);
          setSelectedCell({ rowId: mutation.item.id, column: "entityName" });
        } catch (error) {
          applyMutationError("Create failed.", error);
        }
      });
      return;
    }

	    commitItemPatch(rowId, patch as WorksheetItemPatchInput);
	  }

  function categoryByAnalyticsBucket(bucket: string) {
    const normalized = bucket.trim().toLowerCase();
    return entityCategories.find((category) => (category.analyticsBucket ?? "").trim().toLowerCase() === normalized);
  }

  function labourCategory() {
    return categoryByAnalyticsBucket("labour")
      ?? entityCategories.find((category) => /labou?r/i.test(`${category.name} ${category.entityType}`))
      ?? entityCategories.find((category) => category.itemSource === "rate_schedule" && category.calculationType === "tiered_rate");
  }

  function materialCategory() {
    return categoryByAnalyticsBucket("material")
      ?? entityCategories.find((category) => /materials?/i.test(`${category.name} ${category.entityType}`))
      ?? firstEnabledCategory(entityCategories);
  }

  function inferCanonicalCategoryForOption(group: EntityOptionGroup, item: EntityOptionItem) {
    const direct = getTargetCategoryForEntityGroup(group, item);
    if (item.source === "labor_unit") {
      return labourCategory() ?? direct;
    }
    if (item.source === "cost_intelligence" || item.source === "cost_resource" || item.source === "plugin_result") {
      const resourceType = [
        payloadString(item.payload, "resourceType"),
        payloadString(item.payload, "costCategory"),
        payloadString(item.payload, "resourceCategory"),
        group.categoryName,
        group.entityType,
      ].join(" ").toLowerCase();
      if (/\bequipment\b|\brental\b/.test(resourceType)) {
        return categoryByAnalyticsBucket("equipment")
          ?? entityCategories.find((category) => /\bequipment\b/i.test(`${category.name} ${category.entityType}`))
          ?? direct
          ?? materialCategory();
      }
      if (/\bsub(contract|contractor)?\b/.test(resourceType)) {
        return categoryByAnalyticsBucket("subcontractor")
          ?? entityCategories.find((category) => /\bsub/i.test(`${category.name} ${category.entityType}`))
          ?? direct
          ?? materialCategory();
      }
      if (/\blabou?r\b/.test(resourceType)) {
        return labourCategory() ?? direct ?? materialCategory();
      }
      return direct ?? materialCategory();
    }
    return direct;
  }

  function stageTemporaryWorksheetItemPatch(rowId: string, patch: WorksheetItemPatchInput) {
    const row = visibleRows.find((candidate) => candidate.id === rowId);
    if (!row || !isTemporaryWorksheetItemId(row.id)) return false;
    const staged: WorkspaceWorksheetItem = {
      ...row,
      ...patch,
      categoryId: patch.categoryId === undefined ? row.categoryId : patch.categoryId,
      vendor: patch.vendor === null ? undefined : patch.vendor ?? row.vendor,
      phaseId: patch.phaseId === undefined ? row.phaseId : patch.phaseId,
      rateScheduleItemId: patch.rateScheduleItemId === undefined ? row.rateScheduleItemId : patch.rateScheduleItemId,
      itemId: patch.itemId === undefined ? row.itemId : patch.itemId,
      tierUnits: patch.tierUnits === undefined ? row.tierUnits : patch.tierUnits,
      sourceNotes: patch.sourceNotes === undefined ? row.sourceNotes : patch.sourceNotes,
      resourceComposition: patch.resourceComposition === undefined ? row.resourceComposition : patch.resourceComposition,
      sourceEvidence: patch.sourceEvidence === undefined ? row.sourceEvidence : patch.sourceEvidence,
    };
    onApply((current) => applyWorksheetItemUpsert(current, staged));
    return true;
  }

  function buildOptionSourcePatch(
    targetCategory: EntityCategory,
    item: EntityOptionItem,
  ): WorksheetItemPatchInput {
    const uom = item.unit ?? targetCategory.defaultUom;
    // Translate any productivity hours from the option (unit1/2/3) into tier units
    // when we have a matching schedule.
    let tierUnits: Record<string, number> | undefined;
    if (item.rateScheduleItemId && (item.unit1 || item.unit2 || item.unit3)) {
      const schedule = (workspace.rateSchedules ?? []).find((s) =>
        (s.items ?? []).some((i) => i.id === item.rateScheduleItemId),
      );
      if (schedule) {
        const next: Record<string, number> = {};
        const reg = schedule.tiers.find((t) => Number(t.multiplier) === 1);
        const ot = schedule.tiers.find((t) => Number(t.multiplier) === 1.5);
        const dt = schedule.tiers.find((t) => Number(t.multiplier) === 2);
        if (reg && item.unit1) next[reg.id] = Number(item.unit1) || 0;
        if (ot && item.unit2) next[ot.id] = Number(item.unit2) || 0;
        if (dt && item.unit3) next[dt.id] = Number(item.unit3) || 0;
        tierUnits = next;
      }
    }
    return {
      categoryId: targetCategory.id,
      category: targetCategory.name,
      entityType: targetCategory.entityType,
      entityName: item.value || item.label,
      uom,
      cost: item.unitCost ?? undefined,
      price: item.unitPrice ?? undefined,
      quantity: item.quantity,
      tierUnits,
      description: item.description ?? item.label,
      vendor: item.vendor ?? null,
      sourceNotes: item.sourceNotes ?? "",
      costResourceId: item.costResourceId ?? null,
      effectiveCostId: item.effectiveCostId ?? null,
      laborUnitId: item.laborUnitId ?? null,
      itemId: item.itemId ?? null,
      rateScheduleItemId: item.rateScheduleItemId ?? null,
      resourceComposition: item.resourceComposition ?? {},
      sourceEvidence: item.sourceEvidence ?? {},
    };
  }

	  async function handlePluginRemoteSearch(item: EntityOptionItem) {
    const query = entitySearchTerm.trim();
    if (!item.pluginId || !item.toolId || !item.searchFieldId) {
      onError("This plugin search action is missing its tool metadata.");
      return;
    }
    if (query.length < 2) {
      setEntitySearchError("Type at least 2 characters before searching an external provider.");
      return;
    }

    const actionId = item.actionId ?? `${item.pluginId}:${item.toolId}:${item.searchFieldId}`;
    setEntityActionLoadingId(actionId);
    setEntitySearchError(null);
    try {
      const rows = await searchPluginField(item.pluginId, item.toolId, item.searchFieldId, {
        [item.queryParam ?? "q"]: query,
        limit: 10,
      });
      const mapped = rows.slice(0, 12).map((result, index) => {
        const title = String(result.title ?? result.name ?? result.label ?? query);
        const vendor = String(result.vendor ?? result.source ?? result.seller ?? item.label.replace(/^Search\s+/i, "") ?? "");
        const cost = payloadNumber(result, "price") ?? payloadNumber(result, "cost") ?? payloadNumber(result, "extracted_price");
        const description = String(result.description ?? result.title ?? title);
        const input = {
          query,
          name: title,
          vendor,
          cost: cost ?? 0,
          description,
          quantity: 1,
          markup: workspace.currentRevision.defaultMarkup ?? 0.15,
        };
        return {
          label: title,
          value: title,
          source: "plugin_result" as const,
          sourceType: "plugin_result" as const,
          actionType: "plugin_result" as const,
          unitCost: cost,
          quantity: 1,
          unit: "EA",
          vendor,
          description,
          subtitle: [vendor, result.rating ? `Rating ${result.rating}` : "", result.link ? "Open product link in details" : ""].filter(Boolean).join(" · "),
          sourceNotes: [item.label, result.link ? String(result.link) : ""].filter(Boolean).join("; "),
          actionId: `${actionId}:${index}`,
          pluginId: item.pluginId,
          pluginSlug: item.pluginSlug,
          toolId: item.toolId,
          pluginInput: input,
          payload: result,
        } satisfies EntityOptionItem;
      });
      setEntityPluginResults(mapped);
      if (mapped.length === 0) {
        setEntitySearchError(`No ${item.label.replace(/^Search\s+/i, "")} results for "${query}".`);
      }
    } catch (error) {
      setEntityPluginResults([]);
      setEntitySearchError(error instanceof Error ? error.message : "External provider search failed.");
    } finally {
      setEntityActionLoadingId(null);
    }
  }

  function handleEntityAction(rowId: string, group: EntityOptionGroup, item: EntityOptionItem) {
    if (item.actionType === "plugin_remote_search") {
      void handlePluginRemoteSearch(item);
      return;
    }

    const row = visibleRows.find((candidate) => candidate.id === rowId);
    if (item.actionType === "open_assembly") {
      setEntityDropdownRowId(null);
      setEntityDropdownPos(null);
      setEntitySearchTerm("");
      setEntityBrowseMode(null);
      setShowAssemblyPicker(true);
      return;
    }

    if (item.actionType === "plugin_tool") {
      setEntityDropdownRowId(null);
      setEntityDropdownPos(null);
      setEntitySearchTerm("");
      setEntityBrowseMode(null);
      if (onOpenPluginTools) {
        onOpenPluginTools();
      } else {
        onError("Open Plugin Tools to run this action.");
      }
      return;
    }

    if (item.actionType === "plugin_result") {
      setEntityDropdownRowId(null);
      setEntityDropdownPos(null);
      setEntitySearchTerm("");
      setEntityBrowseMode(null);
      if (!item.pluginId || !item.toolId || !item.pluginInput) {
        onError("This provider result is missing its plugin execution data.");
        return;
      }
      startTransition(async () => {
        try {
          await executePlugin(
            item.pluginId!,
            item.toolId!,
            workspace.project.id,
            workspace.currentRevision.id,
            item.pluginInput!,
            {
              worksheetId: row?.worksheetId,
              executedBy: "user",
            },
          );
          onRefresh();
        } catch (error) {
          onError(error instanceof Error ? error.message : "Plugin execution failed.");
        }
      });
      return;
    }

    const targetCategory = inferCanonicalCategoryForOption(group, item);
    if (!targetCategory) {
      setEntitySearchError("Choose a configured worksheet category before applying this result.");
      return;
    }
    if (categoryRequiresRateSchedule(targetCategory) && !item.rateScheduleItemId) {
      if (item.source === "labor_unit") {
        const stagedPatch = buildOptionSourcePatch(targetCategory, item);
        stagedPatch.rateScheduleItemId = row?.rateScheduleItemId ?? undefined;
        stagedPatch.itemId = row?.itemId ?? null;
        if (row?.rateScheduleItemId && !isTemporaryWorksheetItemId(row.id)) {
          stagedPatch.entityName = row.entityName;
          commitItemPatch(row.id, stagedPatch, "Labor productivity update failed.");
          setEntityDropdownRowId(null);
          setEntityDropdownPos(null);
          setEntitySearchTerm("");
          setEntityBrowseMode(null);
          return;
        }
        if (stageTemporaryWorksheetItemPatch(rowId, stagedPatch)) {
          setSelectedCell({ rowId, column: "entityName" });
          setEntityDropdownRowId(rowId);
          setEntityBrowseMode("rate_books");
          setEntitySearchTerm("");
          setEntitySearchError("Productivity selected. Choose an imported labour rate item to price this line.");
          return;
        }
      }
      setEntitySearchError(
        `Choose an imported ${targetCategory.name} item for this category before creating the row.`
      );
      return;
    }

    setEntityDropdownRowId(null);
    setEntityDropdownPos(null);
    setEntitySearchTerm("");
    setEntityBrowseMode(null);

    handleEntitySelect(
	      rowId,
	      item.value,
	      targetCategory.name,
	      targetCategory.entityType,
	      targetCategory.defaultUom,
      item.unitCost !== undefined ||
        item.unitPrice !== undefined ||
        item.unit !== undefined ||
        item.description !== undefined ||
        item.vendor !== undefined ||
        item.sourceNotes !== undefined ||
        item.quantity !== undefined ||
        item.unit1 !== undefined ||
        item.unit2 !== undefined ||
        item.unit3 !== undefined ||
        item.costResourceId !== undefined ||
        item.effectiveCostId !== undefined ||
        item.laborUnitId !== undefined ||
        item.resourceComposition !== undefined ||
        item.sourceEvidence !== undefined
        ? {
            cost: item.unitCost,
            price: item.unitPrice,
            uom: item.unit,
            description: item.description ?? item.label,
            vendor: item.vendor,
            sourceNotes: item.sourceNotes,
            quantity: item.quantity,
            unit1: item.unit1,
            unit2: item.unit2,
            unit3: item.unit3,
            costResourceId: item.costResourceId,
            effectiveCostId: item.effectiveCostId,
            laborUnitId: item.laborUnitId,
            resourceComposition: item.resourceComposition,
            sourceEvidence: item.sourceEvidence,
          }
        : undefined,
      item.rateScheduleItemId,
      item.itemId,
    );
  }

  // ─── Row operations ───

  const addNewItem = useCallback((_categoryOverride?: string) => {
    const wsId = activeWorksheetForActions?.id;
    if (!wsId) {
      if (activeFolderId) {
        setNewWsFolderId(activeFolderId);
        setNewWsName("");
        setShowNewWsModal(true);
      }
      return;
    }

    const ws = findWs(workspace, wsId);
    if (!ws) return;

    createDraftItem(wsId);
  }, [activeFolderId, activeWorksheetForActions?.id, createDraftItem, workspace]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || (!e.metaKey && !e.ctrlKey) || e.altKey) return;
      if (editingCell || entityDropdownRowId || isPending) return;

      const target = e.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName;
        if (
          tagName === "INPUT" ||
          tagName === "TEXTAREA" ||
          tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest("[role='dialog']")
        ) {
          return;
        }
        if (gridWidthRef.current && target !== document.body && !gridWidthRef.current.contains(target)) return;
      } else if (target instanceof Element && gridWidthRef.current && !gridWidthRef.current.contains(target)) {
        return;
      }

      if ((workspace.worksheets ?? []).length === 0) return;
      e.preventDefault();
      addNewItem();
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [addNewItem, editingCell, entityDropdownRowId, isPending, workspace.worksheets]);

  function deleteRow(itemId: string) {
    removeItem(itemId);
    if (selectedRowId === itemId) setSelectedRowId(null);
    if (detailItem?.id === itemId) setDetailItem(null);
    setSelectedIds((prev) => {
      const n = new Set(prev);
      n.delete(itemId);
      return n;
    });
  }

  function duplicateRow(itemId: string) {
    const row = visibleRows.find((r) => r.id === itemId);
    if (!row) return;

	    const payload: CreateWorksheetItemInput = {
	      phaseId: row.phaseId ?? null,
	      categoryId: row.categoryId ?? null,
	      category: row.category,
      entityType: row.entityType,
      entityName: row.entityName,
      classification: row.classification ?? {},
      costCode: row.costCode ?? null,
      vendor: row.vendor ?? null,
      description: row.description,
      quantity: row.quantity,
      uom: row.uom,
      cost: row.cost,
      markup: row.markup,
      price: row.price,
      lineOrder: row.lineOrder + 1,
      rateScheduleItemId: row.rateScheduleItemId ?? null,
      itemId: row.itemId ?? null,
      costResourceId: row.costResourceId ?? null,
      effectiveCostId: row.effectiveCostId ?? null,
      laborUnitId: row.laborUnitId ?? null,
      tierUnits: row.tierUnits ?? {},
      sourceNotes: row.sourceNotes ?? "",
      resourceComposition: row.resourceComposition ?? {},
      sourceEvidence: row.sourceEvidence ?? {},
    };

    createItem(row.worksheetId, payload, "Duplicate failed.");
  }

  // ─── Reorder ───

  function handleMoveUp(row: WorkspaceWorksheetItem, groupItems: WorkspaceWorksheetItem[]) {
    const idx = groupItems.findIndex((r) => r.id === row.id);
    if (idx <= 0) return;
    const prev = groupItems[idx - 1];
    const prevOrder = prev.lineOrder;
    const thisOrder = row.lineOrder;

    startTransition(async () => {
      try {
        // Swap lineOrder values
        const r1 = await updateWorksheetItem(workspace.project.id, row.id, { lineOrder: prevOrder });
        const r2 = await updateWorksheetItem(workspace.project.id, prev.id, { lineOrder: thisOrder });
        onApply(r2);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Reorder failed.");
      }
    });
  }

  function handleMoveDown(row: WorkspaceWorksheetItem, groupItems: WorkspaceWorksheetItem[]) {
    const idx = groupItems.findIndex((r) => r.id === row.id);
    if (idx < 0 || idx >= groupItems.length - 1) return;
    const next = groupItems[idx + 1];
    const nextOrder = next.lineOrder;
    const thisOrder = row.lineOrder;

    startTransition(async () => {
      try {
        const r1 = await updateWorksheetItem(workspace.project.id, row.id, { lineOrder: nextOrder });
        const r2 = await updateWorksheetItem(workspace.project.id, next.id, { lineOrder: thisOrder });
        onApply(r2);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Reorder failed.");
      }
    });
  }

  // ─── Bulk Operations ───

  function toggleSelectRow(rowId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    const selectableRowIds = visibleRows
      .filter((row) => !isTemporaryWorksheetItemId(row.id))
      .map((row) => row.id);

    if (selectedIds.size === selectableRowIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableRowIds));
    }
  }

  function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        for (const id of ids) {
          last = await deleteWorksheetItem(workspace.project.id, id);
        }
        if (last) onApply(last);
        setSelectedIds(new Set());
        if (detailItem && ids.includes(detailItem.id)) setDetailItem(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Bulk delete failed.");
      }
    });
  }

  function handleBulkMoveToWorksheet(targetWsId: string) {
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        for (const id of ids) {
          // Moving means updating worksheetId - but the API takes item id and patch
          // We need to delete from old and create in new, or if the API supports worksheetId update
          // For now, let's try setting worksheetId via update
          last = await updateWorksheetItem(workspace.project.id, id, { worksheetId: targetWsId } as Record<string, unknown>);
        }
        if (last) onApply(last);
        setSelectedIds(new Set());
      } catch (e) {
        onError(e instanceof Error ? e.message : "Move failed.");
      }
    });
  }

  function handleBulkAssignPhase(phaseId: string) {
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        for (const id of ids) {
          last = await updateWorksheetItem(workspace.project.id, id, { phaseId: phaseId || null });
        }
        if (last) onApply(last);
        setSelectedIds(new Set());
      } catch (e) {
        onError(e instanceof Error ? e.message : "Assign phase failed.");
      }
    });
  }

  function handleBulkSetMarkup() {
    const val = parseNum(bulkMarkupValue) / 100;
    if (!Number.isFinite(val)) return;
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        for (const id of ids) {
          last = await updateWorksheetItem(workspace.project.id, id, { markup: val });
        }
        if (last) onApply(last);
        setSelectedIds(new Set());
        setBulkMarkupValue("");
      } catch (e) {
        onError(e instanceof Error ? e.message : "Set markup failed.");
      }
    });
  }

  function handleBulkDuplicate() {
    const ids = Array.from(selectedIds);
    const rows = ids.map((id) => visibleRows.find((r) => r.id === id)).filter(Boolean) as WorkspaceWorksheetItem[];
    if (rows.length === 0) return;

    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        for (const row of rows) {
	          const payload: CreateWorksheetItemInput = {
	            phaseId: row.phaseId ?? null,
	            categoryId: row.categoryId ?? null,
	            category: row.category,
            entityType: row.entityType,
            entityName: row.entityName,
            classification: row.classification ?? {},
            costCode: row.costCode ?? null,
            vendor: row.vendor ?? null,
            description: row.description,
            quantity: row.quantity,
            uom: row.uom,
            cost: row.cost,
            markup: row.markup,
            price: row.price,
            rateScheduleItemId: row.rateScheduleItemId ?? null,
            itemId: row.itemId ?? null,
            costResourceId: row.costResourceId ?? null,
            effectiveCostId: row.effectiveCostId ?? null,
            laborUnitId: row.laborUnitId ?? null,
            tierUnits: row.tierUnits ?? {},
            sourceNotes: row.sourceNotes ?? "",
            resourceComposition: row.resourceComposition ?? {},
            sourceEvidence: row.sourceEvidence ?? {},
          };
          last = await createWorksheetItem(workspace.project.id, row.worksheetId, payload);
        }
        if (last) onApply(last);
        setSelectedIds(new Set());
      } catch (e) {
        onError(e instanceof Error ? e.message : "Bulk duplicate failed.");
      }
    });
  }

  // ─── Universal Add Items ───

  function getTargetCategoryForEntityGroup(group: EntityOptionGroup, item?: EntityOptionItem) {
    const directMatch = entityCategories.find((category) =>
      category.name === group.categoryName || category.entityType === group.entityType
    );
    if (directMatch || item?.source !== "catalog") return directMatch;

    const catalogKind = firstText(
      payloadString(item.payload, "catalogKind"),
      payloadString(item.payload, "catalogName"),
    );
    if (!catalogKind) return undefined;
    const catalogKey = normalizeEntityLookup(catalogKind);
    return entityCategories.find((category) =>
      normalizeEntityLookup(category.name) === catalogKey ||
      normalizeEntityLookup(category.entityType) === catalogKey
    );
  }

	  function canCreateWorksheetItemFromOption(group: EntityOptionGroup, item: EntityOptionItem) {
	    const targetCategory = inferCanonicalCategoryForOption(group, item);
    if (item.actionType && item.actionType !== "select") return false;
    if (item.source === "assembly" || item.source === "plugin" || item.source === "external_action" || item.source === "plugin_result") {
      return false;
    }
    if (categoryRequiresRateSchedule(targetCategory) && !item.rateScheduleItemId) return false;
    return true;
  }

  function buildCreatePayloadFromEntityOption(
    group: EntityOptionGroup,
    item: EntityOptionItem,
    lineOrder?: number,
	  ): { payload?: CreateWorksheetItemInput; error?: string } {
	    const targetCategory = inferCanonicalCategoryForOption(group, item);
    if (categoryRequiresRateSchedule(targetCategory) && !item.rateScheduleItemId) {
      return {
        error: `Choose an imported ${targetCategory?.name ?? "rate"} item before creating a row.`,
      };
    }

    const fallbackCategory = firstEnabledCategory(entityCategories);
    const catalogKind = item.source === "catalog"
      ? firstText(payloadString(item.payload, "catalogKind"), payloadString(item.payload, "catalogName"))
      : "";
    const categoryName = targetCategory?.name ?? (catalogKind || group.categoryName || fallbackCategory?.name || "");
    const entityType = targetCategory?.entityType ?? (catalogKind || group.entityType || fallbackCategory?.entityType || "");
    const uom = item.unit ?? group.defaultUom ?? targetCategory?.defaultUom ?? "EA";
    const markup = workspace.currentRevision.defaultMarkup ?? 0.2;
	    const payload: CreateWorksheetItemInput = {
	      phaseId: null,
	      categoryId: targetCategory?.id ?? (categoryName === fallbackCategory?.name ? fallbackCategory.id : null),
	      category: categoryName,
      entityType,
      entityName: item.value || item.label,
      classification: {},
      costCode: null,
      vendor: item.vendor ?? null,
      description: item.description ?? item.label,
      quantity: item.quantity ?? 1,
      uom,
      cost: item.unitCost ?? 0,
      markup,
      price: item.unitPrice ?? 0,
      lineOrder,
      rateScheduleItemId: item.rateScheduleItemId ?? null,
      itemId: item.itemId ?? null,
      costResourceId: item.costResourceId ?? null,
      effectiveCostId: item.effectiveCostId ?? null,
      laborUnitId: item.laborUnitId ?? null,
      tierUnits: {},
      sourceNotes: item.sourceNotes ?? "",
      resourceComposition: item.resourceComposition ?? {},
      sourceEvidence: item.sourceEvidence ?? {},
    };

    if (item.rateScheduleItemId) {
      const schedule = (workspace.rateSchedules ?? []).find((entry) =>
        entry.items.some((scheduleItem) => scheduleItem.id === item.rateScheduleItemId),
      );
      if (schedule) {
        const seeded: Record<string, number> = Object.fromEntries(
          schedule.tiers.map((tier) => [tier.id, 0]),
        );
        const reg = schedule.tiers.find((t) => Number(t.multiplier) === 1);
        const ot = schedule.tiers.find((t) => Number(t.multiplier) === 1.5);
        const dt = schedule.tiers.find((t) => Number(t.multiplier) === 2);
        if (reg && item.unit1) seeded[reg.id] = Number(item.unit1) || 0;
        if (ot && item.unit2) seeded[ot.id] = Number(item.unit2) || 0;
        if (dt && item.unit3) seeded[dt.id] = Number(item.unit3) || 0;
        payload.tierUnits = seeded;
      }
    }

    if (targetCategory) {
      payload.uom = item.unit ?? targetCategory.defaultUom;
      if (!categoryAllowsEditingTierUnits(targetCategory)) payload.tierUnits = {};
      if (isCellDisabledByCategory(targetCategory, "cost")) payload.cost = item.unitCost ?? 0;
      if (isCellDisabledByCategory(targetCategory, "markup")) payload.markup = markup;
      if (isCellDisabledByCategory(targetCategory, "price")) payload.price = 0;
    }

    return { payload };
  }

  function handleAddSelectedItems() {
    const wsId = activeWorksheetForActions?.id;
    if (!wsId) return;

    const selected = Array.from(selectedAddItems.values()).filter(({ group, item }) =>
      canCreateWorksheetItemFromOption(group, item)
    );
    if (selected.length === 0) return;

    const worksheet = findWs(workspace, wsId);
    const baseOrder =
      worksheet?.items.reduce(
        (maxOrder, item) => Math.max(maxOrder, item.lineOrder),
        0,
      ) ?? 0;

    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        const errors: string[] = [];
        for (const [index, entry] of selected.entries()) {
          const result = buildCreatePayloadFromEntityOption(entry.group, entry.item, baseOrder + index + 1);
          if (!result.payload) {
            if (result.error) errors.push(result.error);
            continue;
          }
          last = await createWorksheetItem(workspace.project.id, wsId, result.payload);
        }
        if (last) onApply(last);
        setShowAddItemsPicker(false);
        setSelectedAddItems(new Map());
        setAddItemsSearchTerm("");
        setAddItemsBrowseMode(null);
        if (errors.length > 0) {
          onError(errors.length === 1 ? errors[0]! : `${errors.length} selected items could not be added.`);
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Add items failed.");
      }
    });
  }

  // ─── Copy & Export ───

  function copyRowToClipboard(rowId: string) {
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;
    const phase = (workspace.phases ?? []).find((p) => p.id === row.phaseId);
    const extCost = row.cost * row.quantity;
    const text = [
      row.entityName,
      row.category,
      row.vendor ?? "",
      row.description,
      `Qty: ${row.quantity}`,
      `UOM: ${row.uom}`,
      `Cost: ${row.cost}`,
      `Ext. Cost: ${extCost.toFixed(2)}`,
      `Markup: ${(row.markup * 100).toFixed(1)}%`,
      `Price: ${row.price}`,
      phase ? `Phase: ${estimatePhaseLabel(phase)}` : "",
    ].filter(Boolean).join("\t");
    navigator.clipboard.writeText(text);
  }

  function exportTableAsCsv() {
    const headers = ["#", "Category", "Line Item Name", "Vendor", "Description", "Qty", "UOM", "Cost", "Ext. Cost", "Markup", "Price", "Margin", "Phase"];
    const csvRows: Array<Array<unknown>> = [];

    for (const row of visibleRows) {
      const extCost = row.cost * row.quantity;
      const margin = row.price > 0 ? ((row.price - extCost) / row.price * 100).toFixed(1) : "0";
      const phase = (workspace.phases ?? []).find((p) => p.id === row.phaseId);
      const cells = [
        row.lineOrder,
        row.category,
        row.entityName,
        row.vendor ?? "",
        row.description,
        row.quantity,
        row.uom,
        row.cost.toFixed(2),
        extCost.toFixed(2),
        `${(row.markup * 100).toFixed(1)}%`,
        row.price.toFixed(2),
        `${margin}%`,
        phase ? estimatePhaseLabel(phase) : "",
      ];
      csvRows.push(cells);
    }

    downloadCsv(`estimate-${workspace.project.name.replace(/\s+/g, "-").toLowerCase()}.csv`, headers, csvRows);
  }

  // ─── Context menu ───

  function handleContextMenu(e: React.MouseEvent, rowId: string) {
    e.preventDefault();
    if (isTemporaryWorksheetItemId(rowId)) return;
    setContextMenu({ rowId, x: e.clientX, y: e.clientY });
    setSelectedRowId(rowId);
  }

  useEffect(() => {
    function close() {
      setContextMenu(null);
      setTabMenu(null);
      setOrganizerMenu(null);
      if (entityDropdownRowId) {
        setEntityDropdownRowId(null);
        setEntityDropdownPos(null);
      }
    }
    if (contextMenu || tabMenu || organizerMenu || entityDropdownRowId) {
      const timer = setTimeout(() => {
        document.addEventListener("click", close);
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("click", close);
      };
    }
  }, [contextMenu, tabMenu, organizerMenu, entityDropdownRowId]);

  // Close column picker on outside click
  useEffect(() => {
    if (!showColumnPicker) return;
    function close(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-column-picker]")) {
        setShowColumnPicker(false);
      }
    }
    const timer = setTimeout(() => document.addEventListener("click", close), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", close);
    };
  }, [showColumnPicker]);

  // ─── Worksheet operations ───

  function handleCreateWorksheet() {
    if (!newWsName.trim()) return;
    startTransition(async () => {
      try {
        const next = await createWorksheet(workspace.project.id, { name: newWsName.trim(), folderId: newWsFolderId });
        onApply(next);
        const ws = next.workspace.worksheets.at(-1);
        if (ws) setActiveTab(ws.id);
        setShowNewWsModal(false);
        setNewWsName("");
        setNewWsFolderId(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Create failed.");
      }
    });
  }

  function handleInlineRenameCommit() {
    if (!inlineRenameWsId || !inlineRenameName.trim()) {
      setInlineRenameWsId(null);
      return;
    }
    const wsId = inlineRenameWsId;
    const name = inlineRenameName.trim();
    setInlineRenameWsId(null);

    startTransition(async () => {
      try {
        const next = await updateWorksheet(workspace.project.id, wsId, { name });
        onApply(next);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Rename failed.");
      }
    });
  }

  function handleDeleteWorksheet(wsId: string) {
    startTransition(async () => {
      try {
        const next = await deleteWorksheet(workspace.project.id, wsId);
        onApply(next);
        setActiveTab(next.workspace.worksheets[0]?.id ?? "all");
        setDeleteWsTarget(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  function handleTabContextMenu(e: React.MouseEvent, wsId: string) {
    e.preventDefault();
    setTabMenu({ wsId, x: e.clientX, y: e.clientY });
  }

  function handleCreateFolder() {
    if (!folderForm?.name.trim()) return;
    const parentId = folderForm.parentId;
    const name = folderForm.name.trim();
    startTransition(async () => {
      try {
        const next = await createWorksheetFolder(workspace.project.id, { name, parentId });
        onApply(next);
        const created = next.workspace.worksheetFolders.find(
          (folder) => folder.name === name && (folder.parentId ?? null) === (parentId ?? null),
        );
        if (created) {
          setWorksheetViewMode("organizer");
          setActiveTab(folderViewId(created.id));
        }
        setFolderForm(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Create folder failed.");
      }
    });
  }

  function handleRenameTarget() {
    if (!renameTarget || !renameName.trim()) {
      setRenameTarget(null);
      return;
    }
    const target = renameTarget;
    const name = renameName.trim();
    setRenameTarget(null);
    setRenameName("");
    startTransition(async () => {
      try {
        const next = target.type === "folder"
          ? await updateWorksheetFolder(workspace.project.id, target.id, { name })
          : await updateWorksheet(workspace.project.id, target.id, { name });
        onApply(next);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Rename failed.");
      }
    });
  }

  function handleMoveTarget() {
    if (!moveTarget) return;
    const target = moveTarget;
    const parentId = moveParentId === "__root__" ? null : moveParentId;
    setMoveTarget(null);
    startTransition(async () => {
      try {
        const next = target.type === "folder"
          ? await updateWorksheetFolder(workspace.project.id, target.id, { parentId })
          : await updateWorksheet(workspace.project.id, target.id, { folderId: parentId });
        onApply(next);
        if (target.type === "folder") {
          setActiveTab(folderViewId(target.id));
        } else {
          setActiveTab(target.id);
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Move failed.");
      }
    });
  }

  function handleDeleteFolder(folderId: string) {
    startTransition(async () => {
      try {
        const next = await deleteWorksheetFolder(workspace.project.id, folderId);
        onApply(next);
        if (activeFolderId === folderId) {
          setActiveTab("all");
        }
        setDeleteFolderTarget(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete folder failed.");
      }
    });
  }

  function openMoveTarget(target: OrganizerNodeTarget) {
    setMoveTarget(target);
    setMoveParentId(
      target.type === "folder"
        ? target.parentId ?? "__root__"
        : target.folderId ?? "__root__",
    );
  }

  function openRenameTarget(target: OrganizerNodeTarget) {
    setRenameTarget(target);
    setRenameName(target.name);
  }


  // ─── Category group toggle ───

  function toggleCategoryCollapse(cat: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }

  // ─── Column visibility toggle ───

  function toggleColumn(col: ColumnId) {
    userToggledColumnsRef.current = true;
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }

  // ─── Sort indicator helper ───

  function renderSortIcon(col: ColumnId) {
    if (sortState?.column !== col) {
      return <ArrowUpDown className="h-2.5 w-2.5 opacity-0 group-hover/th:opacity-40 transition-opacity" />;
    }
    return sortState.direction === "asc"
      ? <ArrowUp className="h-2.5 w-2.5 text-accent" />
      : <ArrowDown className="h-2.5 w-2.5 text-accent" />;
  }

  // ─── Render cell helpers ───

  /** Combined units cell — shows unit1 · unit2 · unit3 inline, each editable */
  function renderUnitsCell(row: WorkspaceWorksheetItem) {
    return renderResolvedUnitsCell(row);

    const catDef = findCategoryForRow(row, entityCategories);
    const hasTieredUnits = categoryUsesTieredUnits(catDef);
    const hourBreakdown = getRowHourBreakdown(row);

    const renderUnitSlot = (
      field: "unit1" | "unit2" | "unit3",
      value: number,
      label: string
    ) => {
      const isEditing = editingCell?.rowId === row.id && editingCell?.column === field;
      const disabled = isCellDisabledByCategory(catDef, field);

      if (isEditing) {
        return (
          <input
            key={field}
            ref={(el) => { editInputRef.current = el; }}
            type="number"
            step="0.01"
            className="w-14 text-center rounded border border-accent/50 bg-bg px-1 py-0.5 text-xs outline-none tabular-nums"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleCellKeyDown}
            autoFocus
          />
        );
      }
      if (disabled) {
        return (
          <span key={field} className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-fg/30 italic" title={label}
            onClick={(e) => e.stopPropagation()}
          >
            {value || "–"}
          </span>
        );
      }
      return (
        <span
          key={field}
          role="button"
          tabIndex={0}
          className="tabular-nums text-xs px-1.5 py-0.5 rounded cursor-pointer hover:bg-accent/5 hover:text-accent transition-colors min-w-[32px] text-center inline-block"
          title={`Click to edit ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            startEditing(row.id, field, value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              startEditing(row.id, field, value);
            }
          }}
        >
          {value || <span className="text-fg/20">–</span>}
        </span>
      );
    };

    return (
      <td className="border-b border-line px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-0">
          {renderUnitSlot("unit1", hourBreakdown.unit1, "Unit 1")}
          {hasTieredUnits && (
            <>
              <span className="text-fg/15 text-[9px] select-none">·</span>
              {renderUnitSlot("unit2", hourBreakdown.unit2, "Unit 2")}
              <span className="text-fg/15 text-[9px] select-none">·</span>
              {renderUnitSlot("unit3", hourBreakdown.unit3, "Unit 3")}
            </>
          )}
        </div>
      </td>
    );
  }

  function renderResolvedUnitsCell(row: WorkspaceWorksheetItem) {
    const catDef = findCategoryForRow(row, entityCategories);
    const isTemporary = isTemporaryWorksheetItemId(row.id);
    const hasTieredUnits = categoryUsesTieredUnits(catDef);
    const hourBreakdown = getRowHourBreakdown(row);
    const unitLabels = getRowUnitSlotLabels(row, catDef);
    const hasDerivedSecondaryUnits = hourBreakdown.unit2 > 0 || hourBreakdown.unit3 > 0;
    const visibleUnitSlots =
      hasTieredUnits
        ? (["unit1", "unit2", "unit3"] as const)
        : hasDerivedSecondaryUnits
          ? ((["unit1", "unit2", "unit3"] as const).filter((slot) => hourBreakdown[slot] > 0))
          : (["unit1"] as const);

    const renderUnitSlot = (
      field: "unit1" | "unit2" | "unit3",
      value: number,
      label: string,
    ) => {
      const isEditing = editingCell?.rowId === row.id && editingCell?.column === field;
      const disabled = isTemporary || isCellDisabledByCategory(catDef, field);
      const isSelected = selectedCell?.rowId === row.id && selectedCell?.column === field;

      if (isEditing) {
        return (
          <input
            key={field}
            ref={(el) => { editInputRef.current = el; }}
            type="number"
            step="0.01"
            size={1}
            className="w-12 min-w-0 text-center rounded border border-accent/50 bg-bg px-1 py-0.5 text-xs outline-none tabular-nums"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleCellKeyDown}
            autoFocus
          />
        );
      }

      const valueDisplay = value || <span className="text-fg/20">-</span>;

      if (disabled) {
        return (
          <span
            key={field}
            className="tabular-nums text-xs text-fg/30 italic w-12 inline-block text-center"
            title={label}
            onClick={(e) => e.stopPropagation()}
          >
            {valueDisplay}
          </span>
        );
      }

      return (
        <span
          key={field}
          role="button"
          tabIndex={0}
          data-cell-row={row.id}
          data-cell-col={field}
          className={cn(
            "tabular-nums text-xs py-0.5 rounded cursor-pointer hover:bg-accent/5 hover:text-accent transition-colors w-12 text-center inline-block",
            isSelected && "ring-1 ring-inset ring-accent/60 bg-accent/5 text-accent",
          )}
          title={`Click to edit ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedCell({ rowId: row.id, column: field });
            startEditing(row.id, field, value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              startEditing(row.id, field, value);
            }
          }}
        >
          {valueDisplay}
        </span>
      );
    };

    return (
      <td className="border-b border-line px-1 py-0.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-0">
          {visibleUnitSlots.map((field, index) => (
            <div key={field} className="contents">
              {index > 0 ? <span className="text-fg/15 text-[9px] select-none">{"\u00B7"}</span> : null}
              {renderUnitSlot(field, hourBreakdown[field], unitLabels[field])}
            </div>
          ))}
        </div>
      </td>
    );
  }

  function renderEditableCell(
    row: WorkspaceWorksheetItem,
    column: EditableColumn,
    displayValue: React.ReactNode,
    className?: string
  ) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.column === column;
    const catDef = findCategoryForRow(row, entityCategories);
    const disabled = isTemporaryWorksheetItemId(row.id) || isCellDisabledByCategory(catDef, column);

    if (isEditing) {
      if (column === "uom" || column === "phaseId") {
        const phases = workspace.phases ?? [];
        const PHASE_NONE = "__none__";
        const isPhase = column === "phaseId";
        const items: Array<{ value: string; label: string }> = isPhase
          ? [
              { value: PHASE_NONE, label: "None" },
              ...buildEstimatePhaseOptions(phases),
            ]
          : catDef?.validUoms?.length
          ? catDef.validUoms.map((u) => ({ value: u, label: u }))
          : makeUomOptions(globalUoms, { compact: true, value: editValue || row.uom });
        const currentValue = isPhase ? (editValue || PHASE_NONE) : editValue;
        const commit = (val: string) => {
          if (isPhase) {
            const realVal = val === PHASE_NONE ? "" : val;
            setEditValue(realVal);
            if (realVal !== (row.phaseId ?? "")) commitItemPatch(row.id, { phaseId: realVal || null });
          } else {
            setEditValue(val);
            if (val !== row.uom) commitItemPatch(row.id, { uom: val });
          }
        };
        const close = () => {
          setEditingCell(null);
          setSelectedCell({ rowId: row.id, column });
          setSelectedRowId(row.id);
        };
        const advanceAfter = (dir: "next" | "prev") => {
          close();
          if (dir === "next") setTimeout(() => advanceToNextCell(row.id, column), 0);
          else setTimeout(() => retreatToPrevCell(row.id, column), 0);
        };
        return (
          <td className={cn("border-b border-line px-2 py-1 text-xs", className)}>
            <RadixSelect.Root
              open
              value={currentValue}
              onValueChange={(val) => {
                commit(val);
                close();
              }}
              onOpenChange={(o) => {
                if (!o) close();
              }}
            >
              <RadixSelect.Trigger className="inline-flex h-6 w-full min-w-0 items-center justify-between gap-1 rounded border border-accent/50 bg-bg px-1.5 text-[11px] text-fg outline-none">
                <RadixSelect.Value />
                <RadixSelect.Icon><ChevronDown className="h-3 w-3 text-fg/40" /></RadixSelect.Icon>
              </RadixSelect.Trigger>
              <RadixSelect.Portal>
                <RadixSelect.Content
                  position="popper"
                  sideOffset={4}
                  className="z-[300] overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const target = (e.target as HTMLElement | null)?.getAttribute("data-radix-select-item-value") ?? null;
                      if (target) commit(target);
                      advanceAfter(e.shiftKey ? "prev" : "next");
                    }
                  }}
                >
                  <RadixSelect.Viewport className="p-1 max-h-[280px]">
                    {items.map((opt) => (
                      <RadixSelect.Item
                        key={opt.value}
                        value={opt.value}
                        data-radix-select-item-value={opt.value}
                        className="relative flex cursor-default select-none items-center rounded-md py-1.5 pl-7 pr-2 text-xs text-fg/75 outline-none data-[highlighted]:bg-panel2 data-[highlighted]:text-fg"
                      >
                        <RadixSelect.ItemIndicator className="absolute left-2 inline-flex items-center text-accent">
                          <Check className="h-3.5 w-3.5" />
                        </RadixSelect.ItemIndicator>
                        <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                      </RadixSelect.Item>
                    ))}
                  </RadixSelect.Viewport>
                </RadixSelect.Content>
              </RadixSelect.Portal>
            </RadixSelect.Root>
          </td>
        );
      }

      const inputType =
        column === "quantity" ||
        column === "cost" ||
        column === "price" ||
        column === "markup" ||
        column === "unit1" ||
        column === "unit2" ||
        column === "unit3"
          ? "number"
          : "text";

      return (
        <td className={cn("border-b border-line px-2 py-1 text-xs", className)}>
          <input
            ref={(el) => { editInputRef.current = el; }}
            type={inputType}
            size={1}
            step={inputType === "number" ? "0.01" : undefined}
            className="h-6 w-full min-w-0 rounded border border-accent/50 bg-bg px-1.5 text-xs outline-none tabular-nums"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleCellKeyDown}
          />
        </td>
      );
    }

    // Entity name cell - show dropdown trigger
	    if (column === "entityName") {
	      const isDropdownOpen = entityDropdownRowId === row.id;
	      const isSelected = selectedCell?.rowId === row.id && selectedCell?.column === "entityName";
	      const isDraft = isTemporaryWorksheetItemId(row.id) && !row.category;
	      return (
	        <td
          ref={isDropdownOpen ? entityCellRef : undefined}
          data-cell-row={row.id}
          data-cell-col="entityName"
          className={cn(
            "border-b border-line px-2 py-2 text-xs cursor-pointer transition-colors min-w-0 overflow-hidden",
            "hover:bg-accent/5",
            isSelected && !isDropdownOpen && "ring-1 ring-inset ring-accent/60 bg-accent/5",
            className
          )}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedCell({ rowId: row.id, column: "entityName" });
		            if (isDropdownOpen) {
		              setEntityDropdownRowId(null);
		              setEntityDropdownPos(null);
		              setEntityBrowseMode(null);
		              setEntityPluginResults([]);
		            } else {
		              positionEntityDropdown(e.currentTarget as HTMLTableCellElement);
		              setEntityDropdownRowId(row.id);
		              setEntitySearchTerm("");
		              setEntityBrowseMode(null);
		              setEntitySearchError(null);
		              setEntityPluginResults([]);
	              setSelectedRowId(row.id);
	            }
          }}
	        >
	          <div className="flex min-w-0 items-center gap-1">
	            {!isDraft && (
	              <Badge
	                {...getCategoryBadgeProps(row.category, entityCategories)}
	                className="text-[9px] px-1 py-0"
	              >
	                {findCategoryForRow(row, entityCategories)?.shortform ?? row.category.charAt(0)}
	              </Badge>
	            )}
	            <span className={cn("truncate", isDraft && "italic text-fg/35")}>
	              {isDraft ? "Choose item..." : row.entityName}
	            </span>
	          </div>
          {/* Entity dropdown rendered via portal */}
	          {isDropdownOpen && entityDropdownPos && (() => {
	            const matchingGroups = entityDisplayGroups.filter((g) => row.category && g.categoryName === row.category);
	            const actionGroups = entityDisplayGroups.filter((g) => g.categoryName === "Actions");
	            const providerGroups = entityDisplayGroups.filter((g) => g.categoryName === "Provider Results");
	            const otherGroups = entityDisplayGroups.filter((g) =>
	              (!row.category || g.categoryName !== row.category) &&
	              g.categoryName !== "Actions" &&
	              g.categoryName !== "Provider Results"
	            );
	            const sourceStats = Array.from(
	              entityFlatItems.reduce<Map<string, number>>((map, entry) => {
	                const label = sourceBadgeLabel(entry.item.source) || "Item";
	                map.set(label, (map.get(label) ?? 0) + 1);
	                return map;
	              }, new Map()),
	            ).slice(0, 5);

	            const selectFlatItem = (idx: number) => {
	              const flat = entityFlatItems[idx];
	              if (!flat) return;
	              handleEntityAction(row.id, flat.group, flat.item);
	            };
	            const entityFlatIndexByKey = new Map(
	              entityFlatItems.map((entry, index) => [
	                `${entry.group.categoryId}\u001f${entityOptionKey(entry.item)}`,
	                index,
	              ]),
	            );

	            const handleResultsScroll = (event: { currentTarget: HTMLDivElement }) => {
	              const target = event.currentTarget;
	              if (target.scrollTop + target.clientHeight >= target.scrollHeight - 180) {
	                void loadMoreEntitySearchResults();
	              }
	            };

		            const renderGroupItems = (
		              group: EntityOptionGroup,
		              filtered: EntityOptionItem[],
		              options: { inLaborTree?: boolean; laborTreeDepth?: number } = {},
		            ) =>
		              filtered.map((item) => {
		                const myIdx = entityFlatIndexByKey.get(`${group.categoryId}\u001f${entityOptionKey(item)}`) ?? 0;
		                const isHighlighted = myIdx === entityHighlightIdx;
		                const isLinkedCatalogRate = item.source === "catalog" && !!item.rateScheduleItemId;
		                const badge = isLinkedCatalogRate ? "Catalog + rate" : sourceBadgeLabel(item.source);
		                const badgeToneSource = isLinkedCatalogRate ? "rate_schedule" : item.source;
		                const isActionLoading = item.actionId && entityActionLoadingId === item.actionId;
		                const SourceIcon = sourceIconFor(item.source);
		                const ActionIcon = item.actionType === "plugin_remote_search"
	                  ? ExternalLink
	                  : item.actionType === "plugin_tool"
	                  ? PlugZap
	                  : item.actionType === "open_assembly"
	                  ? Layers
		                  : ChevronRight;
		                const isLaborChoice = item.source === "labor_unit";
		                const needsRate = isLaborChoice && !item.rateScheduleItemId;
		                const measure = optionMeasureLabel(item);
		                const detailParts = optionMetaParts(item);
		                const laborTreeDepth = isLaborChoice ? options.laborTreeDepth ?? group.treePath?.length ?? 0 : 0;
		                const laborReference = isLaborChoice ? laborUnitReferenceParts(item) : null;
		                const laborDifficult = isLaborChoice ? payloadNumber(item.payload, "hoursDifficult") : undefined;
		                const laborVeryDifficult = isLaborChoice ? payloadNumber(item.payload, "hoursVeryDifficult") : undefined;
		                return (
		                  <button
		                    key={`${group.categoryId}-${entityOptionKey(item)}`}
		                    data-entity-idx={myIdx}
		                    className={cn(
		                      "group flex items-center gap-1.5 px-2 text-left transition-colors",
		                      isLaborChoice
		                        ? cn(
		                            "mx-2 mb-1 w-[calc(100%-1rem)] rounded-md border bg-panel/90 shadow-[0_1px_0_rgba(0,0,0,0.04)] hover:border-warning/35 hover:bg-warning/8",
		                            options.inLaborTree
		                              ? "border-warning/15 py-1"
		                              : "border-warning/20 py-1.5",
		                          )
		                        : "w-full border-b border-line/60 bg-bg/35 py-1 hover:bg-accent/5 last:border-b-0",
		                      isHighlighted && (isLaborChoice ? "border-accent/35 bg-accent/10" : "bg-accent/10"),
		                    )}
		                    style={laborTreeDepth > 1 ? { paddingLeft: Math.min(40, 8 + laborTreeDepth * 5) } : undefined}
		                    onMouseEnter={() => setEntityHighlightIdx(myIdx)}
		                    onClick={() => selectFlatItem(myIdx)}
		                  >
		                    <span className={cn(
		                      "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
		                      sourceAccentClasses(item.source),
		                    )}>
		                      {isActionLoading ? (
		                        <Loader2 className="h-3 w-3 animate-spin" />
		                      ) : (
		                        <SourceIcon className="h-3 w-3" />
		                      )}
		                    </span>
		                    {isLaborChoice ? (
		                      <span className="min-w-0 flex-1">
		                        <span className="grid min-w-0 grid-cols-[minmax(84px,auto)_minmax(0,1fr)_auto] items-center gap-1.5">
		                          <span className="truncate rounded border border-warning/20 bg-bg/70 px-1 py-px font-mono text-[9px] font-semibold leading-3 text-warning">
		                            {laborReference?.code || "No code"}
		                          </span>
		                          <span className="min-w-0 truncate text-[11px] font-semibold leading-3 text-fg">
		                            {item.value || item.label}
		                          </span>
		                          {measure && (
		                            <span className="shrink-0 rounded border border-line bg-panel px-1 py-px text-[9px] font-semibold tabular-nums leading-3 text-fg/70">
		                              {measure}
		                            </span>
		                          )}
		                        </span>
		                        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] leading-3 text-fg/45">
		                          {laborReference?.table && (
		                            <span className="shrink-0 rounded border border-line/70 bg-bg/60 px-1 py-px font-medium">
		                              Table {laborReference.table}
		                            </span>
		                          )}
		                          {laborReference?.ref && (
		                            <span className="shrink-0 rounded border border-line/70 bg-bg/60 px-1 py-px font-medium">
		                              Ref {laborReference.ref}
		                            </span>
		                          )}
		                          {item.unit && (
		                            <span className="shrink-0 rounded border border-line/70 bg-bg/60 px-1 py-px">
		                              {item.unit}
		                            </span>
		                          )}
		                          {laborDifficult !== undefined && (
		                            <span className="shrink-0 tabular-nums">
		                              Diff {laborDifficult.toFixed(2)}
		                            </span>
		                          )}
		                          {laborVeryDifficult !== undefined && (
		                            <span className="shrink-0 tabular-nums">
		                              Very {laborVeryDifficult.toFixed(2)}
		                            </span>
		                          )}
		                          {needsRate && (
		                            <span className="shrink-0 rounded border border-warning/25 bg-warning/8 px-1 py-px text-[8px] font-semibold uppercase leading-3 text-warning">
		                              Needs rate
		                            </span>
		                          )}
		                        </span>
		                      </span>
		                    ) : (
		                      <span className="min-w-0 flex-1">
		                        <span className="flex min-w-0 items-center gap-2">
		                          <span className="min-w-0 flex-1">
		                            <span className="block truncate text-[11px] font-semibold leading-3 text-fg">
		                              {item.label}
		                            </span>
		                          </span>
		                          {measure && (
		                            <span className="shrink-0 rounded border border-line bg-panel px-1 py-px text-[9px] font-medium tabular-nums leading-3 text-fg/60">
		                              {measure}
		                            </span>
		                          )}
		                        </span>
		                        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[9px] leading-3 text-fg/42">
		                          {badge && (
		                            <span className={cn("shrink-0 rounded border px-1 py-px text-[8px] font-semibold leading-3", sourceAccentClasses(badgeToneSource))}>
		                              {badge}
		                            </span>
		                          )}
		                          {detailParts.slice(0, 3).map((part, detailIndex) => (
		                            <span key={`${part}-${detailIndex}`} className="min-w-0 max-w-[190px] truncate">
		                              {part}
		                            </span>
		                          ))}
		                        </span>
		                      </span>
		                    )}
	                    <span className="flex shrink-0 items-center text-fg/25 transition-colors group-hover:text-accent">
	                      <ActionIcon className="h-3.5 w-3.5" />
	                    </span>
	                  </button>
	                );
	              });

	            const renderGroupBlock = (
	              group: EntityOptionGroup,
	              label: string,
	              tone: "accent" | "success" | "muted" | "warning" = "muted",
	            ) => {
		              if (group.items.length === 0) return null;
	              const showTreePath = group.source === "labor_unit" && (group.treePath?.length ?? 0) > 1;
		              return (
		                <div key={group.categoryId} className="bg-bg/25">
		                  <div className={cn(
		                    "sticky top-0 z-20 flex items-center justify-between border-b border-t px-2 py-0.5 text-[9px] font-semibold uppercase tracking-normal bg-panel shadow-[0_1px_0_rgba(0,0,0,0.04)]",
		                    tone === "accent" && "border-accent/20 text-accent",
		                    tone === "success" && "border-success/20 text-success",
		                    tone === "warning" && "border-warning/20 text-warning",
	                    tone === "muted" && "border-line text-fg/40",
	                  )}>
		                    <span className="truncate">{label}</span>
		                    <span className="text-fg/30">{group.items.length}</span>
			                  </div>
			                  {showTreePath && (
			                    <div className="border-b border-warning/25 bg-warning/10 px-2 py-1 shadow-[inset_0_-1px_0_rgba(0,0,0,0.03)]">
			                      <div className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase leading-3 text-warning">
			                        <ListTree className="h-3 w-3" />
			                        Labour hierarchy
			                      </div>
			                      <div className="space-y-0.5">
			                        {group.treePath!.map((part, level) => {
			                          const isLeaf = level === group.treePath!.length - 1;
			                          return (
			                            <div
			                              key={`${part}-${level}`}
			                              className="relative flex min-w-0 items-center gap-1.5 text-[10px] leading-4"
			                              style={{ paddingLeft: Math.min(44, level * 9) }}
			                            >
			                              {level > 0 && (
			                                <span className="absolute left-0 top-1/2 h-px w-2 -translate-y-1/2 bg-warning/40" />
			                              )}
			                              <span className={cn(
			                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[8px] font-bold tabular-nums",
			                                isLeaf
			                                  ? "border-warning/45 bg-warning/18 text-warning"
			                                  : "border-warning/25 bg-bg/65 text-warning/70",
			                              )}>
			                                {level + 1}
			                              </span>
			                              <span className="w-[58px] shrink-0 text-[8px] font-semibold uppercase tracking-normal text-warning/70">
			                                {laborHierarchyLevelLabel(level)}
			                              </span>
			                              <span className={cn(
			                                "min-w-0 truncate rounded px-1",
			                                isLeaf
			                                  ? "border border-warning/20 bg-panel/90 text-[11px] font-bold text-fg shadow-[0_1px_0_rgba(0,0,0,0.03)]"
			                                  : "font-medium text-fg/72",
			                              )}>
			                                {part}
			                              </span>
			                            </div>
			                          );
			                        })}
			                      </div>
			                    </div>
			                  )}
		                  {showTreePath ? (
		                    <div className="border-t border-warning/20 bg-bg/55 py-1">
		                      {renderGroupItems(group, group.items)}
		                    </div>
		                  ) : (
		                    renderGroupItems(group, group.items)
		                  )}
		                </div>
		              );
		            };

		            type LaborTreeNode = {
		              key: string;
		              label: string;
		              level: number;
		              itemCount: number;
		              children: Map<string, LaborTreeNode>;
		              groups: EntityOptionGroup[];
		            };

		            const buildLaborTree = (groups: EntityOptionGroup[]) => {
		              const root: LaborTreeNode = {
		                key: "labor-root",
		                label: "Labour units",
		                level: -1,
		                itemCount: 0,
		                children: new Map(),
		                groups: [],
		              };

		              for (const group of groups) {
		                const rawPath = (group.treePath?.length ? group.treePath : [group.label ?? group.categoryName])
		                  .map(cleanHierarchyPart)
		                  .filter(Boolean);
		                const path = rawPath[0]?.toLowerCase() === "labour units"
		                  ? rawPath.slice(1).map((part, index) => ({ part, level: index + 1 }))
		                  : rawPath.map((part, level) => ({ part, level }));
		                let cursor = root;
		                cursor.itemCount += group.items.length;
		                path.forEach(({ part, level }) => {
		                  const partKey = normalizeEntityLookup(part) || `${level}-${cursor.children.size}`;
		                  let child = cursor.children.get(partKey);
		                  if (!child) {
		                    child = {
		                      key: `${cursor.key}/${partKey}`,
		                      label: part,
		                      level,
		                      itemCount: 0,
		                      children: new Map(),
		                      groups: [],
		                    };
		                    cursor.children.set(partKey, child);
		                  }
		                  child.itemCount += group.items.length;
		                  cursor = child;
		                });
		                cursor.groups.push(group);
		              }

		              return root;
		            };

		            const laborTreeLabel = (groups: EntityOptionGroup[]) => {
		              const providers = Array.from(new Set(
		                groups
		                  .map((group) => group.treePath?.[1])
		                  .filter((provider): provider is string => Boolean(provider)),
		              ));
		              return providers.length === 1 ? `Labour units / ${providers[0]}` : "Labour units";
		            };

		            const renderLaborTreeNode = (node: LaborTreeNode): ReactNode => {
		              const children = Array.from(node.children.values());
		              const isLeaf = node.groups.length > 0;
		              const visibleDepth = Math.max(0, node.level - 1);
		              const branchIndent = Math.min(58, 8 + visibleDepth * 10);
		              const itemIndent = Math.min(66, 14 + (visibleDepth + 1) * 10);
		              return (
		                <div key={node.key} className="relative">
		                  <div
		                    className={cn(
		                      "flex min-w-0 items-center gap-1.5 border-b border-warning/10 px-2 py-0.5 text-[10px] leading-4",
		                      isLeaf ? "bg-warning/8" : "bg-warning/5",
		                    )}
		                    style={{ paddingLeft: branchIndent }}
		                  >
		                    <span className={cn(
		                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[7px] font-bold tabular-nums",
		                      isLeaf
		                        ? "border-warning/40 bg-panel/90 text-warning"
		                        : "border-warning/25 bg-bg/65 text-warning/70",
		                    )}>
		                      {node.level + 1}
		                    </span>
		                    <span className="w-[56px] shrink-0 text-[8px] font-semibold uppercase tracking-normal text-warning/70">
		                      {laborHierarchyLevelLabel(node.level)}
		                    </span>
		                    <span className={cn(
		                      "min-w-0 truncate",
		                      isLeaf ? "font-bold text-fg" : "font-medium text-fg/72",
		                    )}>
		                      {node.label}
		                    </span>
		                    <span className="ml-auto shrink-0 text-[9px] font-medium tabular-nums text-fg/30">
		                      {node.itemCount}
		                    </span>
		                  </div>
		                  {children.length > 0 && (
		                    <div className="bg-bg/35">
		                      {children.map(renderLaborTreeNode)}
		                    </div>
		                  )}
		                  {node.groups.length > 0 && (
		                    <div className="border-b border-warning/10 bg-bg/60 py-1" style={{ paddingLeft: itemIndent }}>
		                      {node.groups.map((group) => (
		                        <div key={`${node.key}-${group.categoryId}`}>
		                          {renderGroupItems(group, group.items, { inLaborTree: true, laborTreeDepth: 0 })}
		                        </div>
		                      ))}
		                    </div>
		                  )}
		                </div>
		              );
		            };

		            const renderLaborTreeGroups = (groups: EntityOptionGroup[], keySeed: string) => {
		              if (groups.length === 0) return null;
		              const root = buildLaborTree(groups);
		              const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
		              return (
		                <div key={keySeed} className="bg-bg/25">
		                  <div className="sticky top-0 z-20 flex items-center justify-between border-b border-t border-warning/20 bg-panel px-2 py-0.5 text-[9px] font-semibold uppercase tracking-normal text-warning shadow-[0_1px_0_rgba(0,0,0,0.04)]">
		                    <span className="truncate">{laborTreeLabel(groups)}</span>
		                    <span className="text-fg/30">{itemCount}</span>
		                  </div>
		                  <div className="bg-warning/5 py-0.5">
		                    {Array.from(root.children.values()).map(renderLaborTreeNode)}
		                  </div>
		                </div>
		              );
		            };

		            const renderGroupCollection = (
		              groups: EntityOptionGroup[],
		              fallbackTone: "accent" | "success" | "muted" | "warning",
		              keyPrefix: string,
		            ) => {
		              const blocks: ReactNode[] = [];
		              let laborBatch: EntityOptionGroup[] = [];

		              const flushLaborBatch = () => {
		                if (laborBatch.length === 0) return;
		                const first = laborBatch[0];
		                const last = laborBatch[laborBatch.length - 1];
		                blocks.push(renderLaborTreeGroups(
		                  laborBatch,
		                  `${keyPrefix}-labor-${first.categoryId}-${last.categoryId}-${laborBatch.length}`,
		                ));
		                laborBatch = [];
		              };

		              groups.forEach((group, index) => {
		                if (group.source === "labor_unit" && (group.treePath?.length ?? 0) > 1) {
		                  laborBatch.push(group);
		                  return;
		                }
		                flushLaborBatch();
		                const block = renderGroupBlock(
		                  group,
		                  group.label ?? group.categoryName,
		                  group.tone ?? fallbackTone,
		                );
		                if (block) blocks.push(block);
		              });
		              flushLaborBatch();
		              return blocks;
		            };

		            const browseCard = entitySearchTerm.trim() ? null : activeEntityBrowseCard;
		            const BrowseHeaderIcon = browseCard?.Icon;
		            const showBrowseLaunchpad = !entitySearchTerm.trim() && !browseCard;
		            const renderBrowseLaunchpad = () => (
		              <div className="p-2">
		                <div className="grid grid-cols-2 gap-1.5">
		                  {enabledEntityBrowseCards.map((card) => {
		                    const BrowseIcon = card.Icon;
		                    return (
		                      <button
		                        key={card.id}
		                        type="button"
		                        className="group flex min-h-[58px] items-center gap-2 rounded-lg border border-line/70 bg-bg/45 px-2 py-1.5 text-left transition-colors hover:border-accent/30 hover:bg-accent/5"
		                        onClick={() => {
		                          setEntityBrowseMode(card.id);
		                          setEntityHighlightIdx(0);
		                        }}
		                      >
		                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md border", card.accent)}>
		                          <BrowseIcon className="h-4 w-4" />
		                        </span>
		                        <span className="min-w-0">
		                          <span className="block truncate text-[12px] font-semibold leading-4 text-fg">
		                            {card.label}
		                          </span>
		                          <span className="block truncate text-[10px] leading-3 text-fg/42">
		                            {card.detail}
		                          </span>
		                        </span>
		                        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-fg/25 transition-colors group-hover:text-accent" />
		                      </button>
		                    );
		                  })}
		                </div>
		                {enabledEntityBrowseCards.length === 0 && (
		                  <div className="rounded-lg border border-dashed border-line bg-bg/35 px-3 py-7 text-center text-xs text-fg/42">
		                    All estimate search sources are disabled for this quote.
		                  </div>
		                )}
		              </div>
		            );

	            return createPortal(
	              <motion.div
	                ref={entityDropdownRef}
	                initial={{ opacity: 0, scale: 0.98, y: entityDropdownPos.placement === "above" ? 2 : -2 }}
	                animate={{ opacity: 1, scale: 1 }}
	                exit={{ opacity: 0, scale: 0.98, y: entityDropdownPos.placement === "above" ? 2 : -2 }}
	                transition={{ duration: 0.12 }}
	                className={cn(
	                  "fixed z-[200] flex w-[min(560px,calc(100vw-16px))] flex-col border border-line/80 bg-panel/95 shadow-2xl backdrop-blur-xl",
	                  entityDropdownPos.placement === "above"
	                    ? "overflow-visible rounded-b-xl rounded-t-none"
	                    : "overflow-hidden rounded-xl",
	                )}
	                style={{
	                  top: entityDropdownPos.top,
	                  bottom: entityDropdownPos.bottom,
                  left: entityDropdownPos.left,
                  maxHeight: entityDropdownPos.placement === "below" ? entityDropdownPos.maxHeight : undefined,
	                }}
	                onClick={(e) => e.stopPropagation()}
		              >
		                <div
		                  data-entity-dropdown-header
		                  className={cn(
		                    "bg-panel2/30 p-2",
		                    entityDropdownPos.placement === "below" && "border-b border-line/80",
		                  )}
		                >
		                  <div className="flex items-center gap-2 rounded-lg border border-line bg-bg/80 px-2.5 py-1.5 shadow-inner focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20">
		                    <Search className="h-4 w-4 shrink-0 text-accent" />
	                    <input
	                      ref={entitySearchRef}
	                      type="text"
	                      className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg/30"
	                      placeholder="Search libraries, catalogs, rates, plugins..."
		                      value={entitySearchTerm}
		                      onChange={(e) => {
		                        const next = e.target.value;
		                        setEntitySearchTerm(next);
		                        if (next.trim()) setEntityBrowseMode(null);
		                      }}
		                      onKeyDown={(e) => {
	                      const len = entityFlatItems.length;
	                      if (e.key === "Escape") {
		                        e.preventDefault();
			                        setEntityDropdownRowId(null);
		                        setEntityDropdownPos(null);
		                        setEntityBrowseMode(null);
		                        setEntityPluginResults([]);
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        if (len > 0) setEntityHighlightIdx((i) => (i + 1) % len);
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        if (len > 0) setEntityHighlightIdx((i) => (i - 1 + len) % len);
                      } else if (e.key === "Home") {
                        e.preventDefault();
                        if (len > 0) setEntityHighlightIdx(0);
                      } else if (e.key === "End") {
                        e.preventDefault();
                        if (len > 0) setEntityHighlightIdx(len - 1);
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        if (len > 0) selectFlatItem(Math.min(entityHighlightIdx, len - 1));
                      } else if (e.key === "Tab") {
                        e.preventDefault();
                        const advancing = !e.shiftKey;
                        const targetRowId = row.id;
                        if (len > 0) {
                          selectFlatItem(Math.min(entityHighlightIdx, len - 1));
                        } else {
	                          setEntityDropdownRowId(null);
		                          setEntityDropdownPos(null);
		                          setEntitySearchTerm("");
		                          setEntityBrowseMode(null);
		                          setEntityPluginResults([]);
	                        }
                        // After selecting, hop to the next/prev editable cell
                        setTimeout(() => {
                          if (advancing) advanceToNextCell(targetRowId, "entityName");
	                          else retreatToPrevCell(targetRowId, "entityName");
	                        }, 0);
	                      }
	                    }}
	                    />
	                    {entitySearchLoading ? (
	                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
	                    ) : (
	                      <Sparkles className="h-4 w-4 shrink-0 text-accent/70" />
	                    )}
		                  </div>
		                  <div className="mt-1.5 flex min-w-0 items-center gap-1 overflow-hidden">
		                    {browseCard ? (
		                      <button
		                        type="button"
		                        className={cn("inline-flex max-w-[260px] shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", browseCard.accent)}
		                        onClick={() => setEntityBrowseMode(null)}
		                      >
		                        {BrowseHeaderIcon && <BrowseHeaderIcon className="h-3 w-3" />}
		                        <span className="truncate">{browseCard.label}</span>
		                        <X className="h-3 w-3" />
		                      </button>
		                    ) : (
		                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-bg/55 px-1.5 py-0.5 text-[10px] font-medium text-fg/45">
		                        <CircleDollarSign className="h-3 w-3" />
		                        {showBrowseLaunchpad ? "Browse source" : `${entityFlatItems.length} loaded`}
		                      </span>
		                    )}
		                    {!showBrowseLaunchpad && sourceStats.map(([label, count]) => (
		                      <span key={label} className="inline-flex shrink-0 rounded-md border border-line bg-bg/45 px-1.5 py-0.5 text-[10px] text-fg/40">
		                        {label} {count}
		                      </span>
		                    ))}
	                    {entitySearchHasMore && (
	                      <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-accent/20 bg-accent/8 px-1.5 py-0.5 text-[10px] font-medium text-accent">
	                        <ArrowDown className="h-3 w-3" />
	                        more
	                      </span>
	                    )}
	                  </div>
	                </div>
		                <div
		                  className={cn(
		                    "overflow-y-auto p-0",
		                    entityDropdownPos.placement === "above" &&
		                      "absolute bottom-[calc(100%-1px)] left-[-1px] right-[-1px] rounded-t-xl border border-b-0 border-line/80 bg-panel/95 backdrop-blur-xl",
		                  )}
		                  style={{ maxHeight: entityDropdownPos.listMaxHeight }}
			                  onScroll={handleResultsScroll}
			                >
			                  {showBrowseLaunchpad && renderBrowseLaunchpad()}
			                  {!showBrowseLaunchpad && entitySearchLoading && entityFlatItems.length === 0 && (
			                    <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-fg/45">
			                      <Loader2 className="h-4 w-4 animate-spin text-accent" />
			                      Searching indexed library...
		                    </div>
		                  )}
		                  {entitySearchError && (
			                    <div className="rounded-lg border border-danger/20 bg-danger/5 px-2.5 py-2 text-[11px] text-danger">
			                      {entitySearchError}
			                    </div>
			                  )}
			                  {!showBrowseLaunchpad && !entitySearchLoading && !entitySearchError && entityFlatItems.length === 0 && (
			                    <div className="rounded-lg border border-dashed border-line bg-bg/40 px-3 py-8 text-center text-xs text-fg/45">
			                      No matches. Keep typing or create a freeform item.
			                    </div>
				                  )}
				                  {!showBrowseLaunchpad && renderGroupCollection(providerGroups, "success", "provider")}
				                  {!showBrowseLaunchpad && renderGroupCollection(matchingGroups, "accent", "matching")}
				                  {!showBrowseLaunchpad && renderGroupCollection(otherGroups, "muted", "other")}
				                  {!showBrowseLaunchpad && renderGroupCollection(actionGroups, "accent", "actions")}
				                  {!showBrowseLaunchpad && entitySearchLoadingMore && (
				                    <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-fg/40">
				                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
				                      Loading more...
				                    </div>
				                  )}
				                  {!showBrowseLaunchpad && !entitySearchHasMore && !entitySearchLoading && entityFlatItems.length > 0 && (
				                    <div className="py-2 text-center text-[10px] text-fg/30">
				                      End of indexed results
				                    </div>
			                  )}
		                </div>
              </motion.div>,
              document.body,
            );
          })()}
        </td>
      );
    }

    const isSelected = selectedCell?.rowId === row.id && selectedCell?.column === column;
    return (
      <td
        data-cell-row={row.id}
        data-cell-col={column}
        className={cn(
          "border-b border-line px-2 py-2 text-xs transition-colors relative min-w-0 overflow-hidden align-top",
          disabled
            ? "bg-surface/50 cursor-not-allowed"
            : "cursor-pointer hover:bg-accent/5",
          isSelected && !disabled && "ring-1 ring-inset ring-accent/60 bg-accent/5",
          className
        )}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedCell({ rowId: row.id, column });
          if (!disabled) {
            const raw = getEditableValue(row, column);
            startEditing(row.id, column, raw as string | number);
          }
        }}
      >
        <div className="min-w-0 overflow-hidden">
          {disabled ? <span className="italic opacity-40">{displayValue}</span> : displayValue}
        </div>
      </td>
    );
  }

  // ─── Tab scroll helpers ───
  const checkTabOverflow = useCallback(() => {
    const el = tabScrollRef.current;
    if (!el) return;
    setTabOverflow({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    checkTabOverflow();
    const el = tabScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkTabOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkTabOverflow, workspace.worksheets]);

  useEffect(() => {
    const el = gridWidthRef.current;
    if (!el) return;
    const update = () => setGridWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [worksheetViewMode]);

  const scrollTabs = useCallback((dir: "left" | "right") => {
    const el = tabScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  }, []);

  // ─── Render ───

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2 pb-1">
      {/* ─── Worksheet Navigation ─── */}
      <div className="flex items-center gap-2 border-b border-line shrink-0">
        <div className="flex items-center rounded-md border border-line bg-bg/60 p-0.5">
          <button
            type="button"
            onClick={() => setWorksheetViewMode("tabs")}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
              worksheetViewMode === "tabs" ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/65",
            )}
            title="Horizontal worksheet tabs"
          >
            <Table2 className="h-3 w-3" />
            Tabs
          </button>
          <button
            type="button"
            onClick={() => setWorksheetViewMode("organizer")}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
              worksheetViewMode === "organizer" ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/65",
            )}
            title="Worksheet folders and hierarchy"
          >
            <ListTree className="h-3 w-3" />
            Organizer
          </button>
        </div>

        {worksheetViewMode === "tabs" ? (
          <>
            <button
              onClick={() => scrollTabs("left")}
              className={cn(
                "shrink-0 p-1 transition-opacity",
                tabOverflow.left ? "text-fg/40 hover:text-fg/70" : "text-fg/10 pointer-events-none"
              )}
              aria-label="Scroll tabs left"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>

            <div
              ref={tabScrollRef}
              onScroll={checkTabOverflow}
              onWheel={(e) => {
                if (!tabScrollRef.current) return;
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                  e.preventDefault();
                  tabScrollRef.current.scrollLeft += e.deltaY;
                  checkTabOverflow();
                }
              }}
              className="flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0"
            >
              <button
                onClick={() => setActiveTab("all")}
                className={cn(
                  "relative px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap",
                  activeTab === "all"
                    ? "text-accent bg-accent/5"
                    : "text-fg/40 hover:text-fg/60"
                )}
              >
                All
                {activeTab === "all" && (
                  <motion.span
                    layoutId="ws-tab-indicator"
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-accent rounded-full"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
              </button>

              {(workspace.worksheets ?? []).map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => setActiveTab(ws.id)}
                  onDoubleClick={() => {
                    setInlineRenameWsId(ws.id);
                    setInlineRenameName(ws.name);
                  }}
                  onContextMenu={(e) => handleTabContextMenu(e, ws.id)}
                  className={cn(
                    "group relative px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap",
                    activeTab === ws.id
                      ? "text-accent bg-accent/5"
                      : "text-fg/40 hover:text-fg/60"
                  )}
                >
                  {inlineRenameWsId === ws.id ? (
                    <input
                      ref={inlineRenameRef}
                      type="text"
                      className="w-24 h-5 bg-bg border border-accent/50 rounded px-1 text-xs outline-none"
                      value={inlineRenameName}
                      onChange={(e) => setInlineRenameName(e.target.value)}
                      onBlur={handleInlineRenameCommit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleInlineRenameCommit();
                        } else if (e.key === "Escape") {
                          setInlineRenameWsId(null);
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      {ws.name}
                      <span className="ml-1 text-[10px] text-fg/25">({ws.items.length})</span>
                    </>
                  )}
                  {activeTab === ws.id && (
                    <motion.span
                      layoutId="ws-tab-indicator"
                      className="absolute inset-x-0 -bottom-px h-0.5 bg-accent rounded-full"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                </button>
              ))}

              <button
                onClick={() => {
                  setNewWsFolderId(null);
                  setNewWsName("");
                  setShowNewWsModal(true);
                }}
                className="ml-1 p-1.5 text-fg/30 hover:text-fg/60 transition-colors shrink-0"
                title="Add worksheet"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              onClick={() => scrollTabs("right")}
              className={cn(
                "shrink-0 p-1 transition-opacity",
                tabOverflow.right ? "text-fg/40 hover:text-fg/70" : "text-fg/10 pointer-events-none"
              )}
              aria-label="Scroll tabs right"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="truncate text-fg/60">{activeViewLabel}</span>
            <span className="text-[10px] text-fg/30">
              {visibleRows.length} row{visibleRows.length === 1 ? "" : "s"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setFolderForm({ parentId: activeFolderId ?? null, name: "" })}
                title="New folder"
              >
                <FolderPlus className="h-3 w-3" />
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setNewWsFolderId(activeFolderId ?? null);
                  setNewWsName("");
                  setShowNewWsModal(true);
                }}
                title="New worksheet"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Toolbar ─── */}
      <div className="flex items-center gap-2 shrink-0">
          <RadixSelect.Root value={categoryFilter} onValueChange={(v) => setCategoryFilter(v === "__all__" ? "" : v)}>
            <RadixSelect.Trigger className="inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-lg border border-line bg-bg/50 text-fg outline-none hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors">
              <RadixSelect.Value placeholder="All types" />
              <RadixSelect.Icon><ChevronDown className="h-3 w-3 text-fg/40" /></RadixSelect.Icon>
            </RadixSelect.Trigger>
            <RadixSelect.Portal>
              <RadixSelect.Content className="z-[100] overflow-hidden rounded-lg border border-line bg-panel shadow-xl" position="popper" sideOffset={4}>
                <RadixSelect.Viewport className="p-1">
                  <RadixSelect.Item value="__all__" className="flex items-center gap-2 px-2 py-1 text-[11px] rounded cursor-pointer outline-none data-[highlighted]:bg-accent/10 text-fg">
                    <RadixSelect.ItemText>All types</RadixSelect.ItemText>
                  </RadixSelect.Item>
                  {entityCategories.map((c) => (
                    <RadixSelect.Item key={c.id} value={c.name} className="flex items-center gap-2 px-2 py-1 text-[11px] rounded cursor-pointer outline-none data-[highlighted]:bg-accent/10 text-fg">
                      <RadixSelect.ItemText>{c.name}</RadixSelect.ItemText>
                    </RadixSelect.Item>
                  ))}
                </RadixSelect.Viewport>
              </RadixSelect.Content>
            </RadixSelect.Portal>
          </RadixSelect.Root>

          <div className="ml-auto flex items-center gap-1.5">
            {/* Column visibility toggle */}
            <div className="relative" data-column-picker>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setShowColumnPicker(!showColumnPicker)}
                title="Toggle columns"
              >
                <Columns className="h-3 w-3" />
              </Button>
              {showColumnPicker && (
                <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-line bg-panel shadow-xl py-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase text-fg/35 tracking-wider border-b border-line">
                    Visible Columns
                  </div>
                  {TOGGLEABLE_COLUMNS.map((col) => (
                    <button
                      key={col}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleColumn(col);
                      }}
                    >
                      <span className={cn("h-3.5 w-3.5 flex items-center justify-center rounded border", visibleColumns.has(col) ? "bg-accent border-accent text-white" : "border-line")}>
                        {visibleColumns.has(col) && <Check className="h-2.5 w-2.5" />}
                      </span>
                      {COLUMN_LABELS[col]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button size="xs" variant="ghost" onClick={exportTableAsCsv} title="Export as CSV">
              <Download className="h-3 w-3" />
            </Button>
	            <Button
	              size="xs"
	              onClick={() => addNewItem()}
	              disabled={isPending || (workspace.worksheets ?? []).length === 0}
	              title={(workspace.worksheets ?? []).length === 0 ? "Create a worksheet first" : "Add one line item"}
	            >
	              <Plus className="h-3 w-3" /> Add
	            </Button>
	            <Button
	              size="xs"
	              variant="ghost"
	              onClick={() => setShowAddItemsPicker(true)}
	              disabled={isPending || (workspace.worksheets ?? []).length === 0}
	              title={(workspace.worksheets ?? []).length === 0 ? "Create a worksheet first" : "Add multiple line items"}
	            >
	              <Boxes className="h-3 w-3" /> Multi
	            </Button>
	          </div>
	        </div>

      {/* ─── Bulk Operations Toolbar ─── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-accent/5 border border-accent/20 rounded-lg text-xs">
          <span className="font-medium text-accent">{selectedIds.size} selected</span>

          <Button size="xs" variant="danger" onClick={handleBulkDelete} disabled={isPending}>
            <Trash2 className="h-3 w-3" /> Delete Selected
          </Button>

          <Button size="xs" variant="ghost" onClick={handleBulkDuplicate} disabled={isPending}>
            <Copy className="h-3 w-3" /> Duplicate Selected
          </Button>

          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShowSaveAsAssembly(true)}
            disabled={isPending}
            title="Create a reusable assembly from these line items"
          >
            <Layers className="h-3 w-3" /> Save as Assembly
          </Button>

          {/* Move to Worksheet dropdown */}
          <Select
            size="xs"
            className="w-36"
            value=""
            placeholder="Move to..."
            onValueChange={(v) => {
              if (v) handleBulkMoveToWorksheet(v);
            }}
            options={(workspace.worksheets ?? []).map((ws) => ({ value: ws.id, label: ws.name }))}
          />

          {/* Assign Phase dropdown */}
          <Select
            size="xs"
            className="w-36"
            value=""
            placeholder="Assign Phase..."
            onValueChange={(v) => {
              handleBulkAssignPhase(v === "__none__" ? "" : v);
            }}
            options={[
              { value: "__none__", label: "None" },
              ...buildEstimatePhaseOptions(workspace.phases ?? []),
            ]}
          />

          {/* Set Markup */}
          <div className="flex items-center gap-1">
            <Input
              className="h-7 w-16 text-[11px]"
              type="number"
              placeholder="Markup %"
              value={bulkMarkupValue}
              onChange={(e) => setBulkMarkupValue(e.target.value)}
            />
            <Button size="xs" variant="ghost" onClick={handleBulkSetMarkup} disabled={!bulkMarkupValue || isPending}>
              Apply
            </Button>
          </div>

          <button
            className="ml-auto text-fg/40 hover:text-fg/60 transition-colors"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ─── Grid ─── */}
      <div className={cn("flex-1 min-h-0 relative", worksheetViewMode === "organizer" && "flex gap-2")}>
        {worksheetViewMode === "organizer" && (
          <WorksheetOrganizerPanel
            workspace={workspace}
            activeViewId={activeTab}
            onSelectAll={() => setActiveTab("all")}
            onSelectFolder={(folderId) => setActiveTab(folderViewId(folderId))}
            onSelectWorksheet={(worksheetId) => setActiveTab(worksheetId)}
            onOpenContextMenu={(target, x, y) => setOrganizerMenu({ ...target, x, y })}
            onCreateRootFolder={() => setFolderForm({ parentId: null, name: "" })}
            onCreateRootWorksheet={() => {
              setNewWsFolderId(null);
              setNewWsName("");
              setShowNewWsModal(true);
            }}
          />
        )}
        <div
          ref={gridWidthRef}
          className={cn(
            "min-h-0",
            worksheetViewMode === "organizer" ? "relative flex-1" : "absolute inset-0",
          )}
        >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: tabSlideDir * 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -tabSlideDir * 16 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 flex flex-col"
          >
          {visibleRows.length === 0 ? (
            <EmptyState>
              {(workspace.worksheets ?? []).length === 0 ? (
                <>
                  No worksheets yet.{" "}
                  <button
                    className="text-accent hover:underline"
                    onClick={() => {
                      setNewWsName("");
                      setShowNewWsModal(true);
                    }}
                  >
                    Create a worksheet first
                  </button>
                  .
                </>
              ) : (
	                <>
	                  No line items found.{" "}
	                  <button className="text-accent hover:underline" onClick={() => addNewItem()}>
	                    Add one
	                  </button>
	                </>
              )}
            </EmptyState>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-line">
              <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full table-fixed text-sm" style={{ minWidth: tableMinWidth }}>
                <thead className="bg-panel2 text-[11px] font-medium uppercase text-fg/35 sticky top-0 z-10">
                  <tr>
                    {/* Expand button column */}
                    {isColVisible("expand") && (
                      <th className="border-b border-line px-1 py-2 w-8" />
                    )}
                    {/* Checkbox column */}
                    {isColVisible("checkbox") && (
                      <th className="border-b border-line px-1 py-2 w-8">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-line accent-accent cursor-pointer"
                          checked={visibleRows.length > 0 && selectedIds.size === visibleRows.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                    )}
                    {/* Reorder column */}
                    {isColVisible("reorder") && (
                      <th className="border-b border-line px-1 py-2 w-14" />
                    )}
                    {isColVisible("lineOrder") && (
                      <th className="border-b border-line px-2 py-2 text-left w-8 cursor-pointer select-none group/th" onClick={() => handleSortToggle("lineOrder")}>
                        <span className="flex items-center gap-1"># {renderSortIcon("lineOrder")}</span>
                      </th>
                    )}
                    {isColVisible("entityName") && (
                      <th className="border-b border-line px-2 py-2 text-left w-[200px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("entityName")}>
                        <span className="flex items-center gap-1">Line Item Name {renderSortIcon("entityName")}</span>
                      </th>
                    )}
                    {isColVisible("vendor") && (
                      <th className="border-b border-line px-2 py-2 text-left w-[120px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("vendor")}>
                        <span className="flex items-center gap-1">Vendor {renderSortIcon("vendor")}</span>
                      </th>
                    )}
                    {isColVisible("description") && (
                      <th className="border-b border-line px-2 py-2 text-left w-[220px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("description")}>
                        <span className="flex items-center gap-1">Description {renderSortIcon("description")}</span>
                      </th>
                    )}
                    {isColVisible("quantity") && (
                      <th className="border-b border-line px-2 py-2 text-right w-16 cursor-pointer select-none group/th" onClick={() => handleSortToggle("quantity")}>
                        <span className="flex items-center justify-end gap-1">Qty {renderSortIcon("quantity")}</span>
                      </th>
                    )}
                    {isColVisible("uom") && (
                      <th className="border-b border-line px-2 py-2 text-center w-16 cursor-pointer select-none group/th" onClick={() => handleSortToggle("uom")}>
                        <span className="flex items-center justify-center gap-1">UOM {renderSortIcon("uom")}</span>
                      </th>
                    )}
                    {isColVisible("factors") && (
                      <th className="border-b border-line px-1 py-1.5 text-center w-[80px]">
                        <span className="flex items-center justify-center gap-1">Factors</span>
                      </th>
                    )}
                    {isColVisible("units") && (
                      <th className="border-b border-line px-1.5 py-2 text-center w-[160px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("unit1")}>
                        <span className="flex items-center justify-center gap-1 text-[10px]">Units {renderSortIcon("unit1")}</span>
                      </th>
                    )}
                    {isColVisible("cost") && (
                      <th className="border-b border-line px-2 py-2 text-right w-20 cursor-pointer select-none group/th" onClick={() => handleSortToggle("cost")}>
                        <span className="flex items-center justify-end gap-1">Cost {renderSortIcon("cost")}</span>
                      </th>
                    )}
                    {isColVisible("extCost") && (
                      <th className="border-b border-line px-2 py-2 text-right w-24 cursor-pointer select-none group/th" onClick={() => handleSortToggle("extCost")}>
                        <span className="flex items-center justify-end gap-1">Ext. Cost {renderSortIcon("extCost")}</span>
                      </th>
                    )}
                    {isColVisible("markup") && (
                      <th className="border-b border-line px-2 py-2 text-right w-16 cursor-pointer select-none group/th" onClick={() => handleSortToggle("markup")}>
                        <span className="flex items-center justify-end gap-1">Markup {renderSortIcon("markup")}</span>
                      </th>
                    )}
                    {isColVisible("price") && (
                      <th className="border-b border-line px-2 py-2 text-right w-24 cursor-pointer select-none group/th" onClick={() => handleSortToggle("price")}>
                        <span className="flex items-center justify-end gap-1">Price {renderSortIcon("price")}</span>
                      </th>
                    )}
                    {isColVisible("margin") && (
                      <th className="border-b border-line px-2 py-2 text-right w-16 cursor-pointer select-none group/th" onClick={() => handleSortToggle("margin")}>
                        <span className="flex items-center justify-end gap-1">Margin {renderSortIcon("margin")}</span>
                      </th>
                    )}
                    {isColVisible("phaseId") && (
                      <th className="border-b border-line px-2 py-2 text-left w-[88px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("phaseId")}>
                        <span className="flex items-center gap-1">Phase {renderSortIcon("phaseId")}</span>
                      </th>
                    )}
                    {isColVisible("actions") && (
                      <th className="border-b border-line px-2 py-2 text-center w-10"></th>
                    )}
                  </tr>
                </thead>
                <tbody>
	                  {groupedRows.map((group, groupIndex) => {
	                    const isCollapsed = collapsedCategories.has(group.category);
	                    return (
	                      <GroupRows
	                        key={`${group.category || "__uncategorized"}-${group.catDef?.id ?? "custom"}-${groupIndex}`}
	                        group={group}
                        isCollapsed={isCollapsed}
                        onToggleCollapse={() => toggleCategoryCollapse(group.category)}
                        selectedRowId={selectedRowId}
                        onSelectRow={setSelectedRowId}
                        onContextMenu={handleContextMenu}
                        renderEditableCell={renderEditableCell}
                        renderUnitsCell={renderUnitsCell}
                        entityCategories={entityCategories}
                        workspace={workspace}
                        visibleColumns={visibleColumns}
                        isColVisible={isColVisible}
                        visibleColumnCount={visibleColumnCount}
                        selectedIds={selectedIds}
                        lineFactorsByItemId={lineFactorsByItemId}
                        factorTotalsById={factorTotalsById}
                        displayLineItem={displayLineItem}
                        lineItemHasFactorAdjustment={lineItemHasFactorAdjustment}
                        onOpenLineFactors={setFactorLineItem}
                        onToggleSelectRow={toggleSelectRow}
                        onMoveUp={handleMoveUp}
                        onMoveDown={handleMoveDown}
                        detailItem={detailItem}
                        onOpenDetail={setDetailItem}
                        isPending={isPending}
                      />
                    );
                  })}
                </tbody>
                {/* ─── Totals footer ─── */}
                <tfoot className="bg-panel2 text-xs font-medium sticky bottom-0 z-10">
                  <tr>
                    {isColVisible("expand") && <td className="border-t border-line px-1 py-2" />}
                    {isColVisible("checkbox") && <td className="border-t border-line px-1 py-2" />}
                    {isColVisible("reorder") && <td className="border-t border-line px-1 py-2" />}
                    {isColVisible("lineOrder") && (
                      <td className="border-t border-line px-2 py-2" />
                    )}
                    {isColVisible("entityName") && (
                      <td className="border-t border-line px-2 py-2">
                        <span className="text-fg/50">{totals.count} items</span>
                      </td>
                    )}
                    {isColVisible("vendor") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("description") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("quantity") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("uom") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("factors") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("units") && (
                      <td className="border-t border-line px-1 py-2">
                        <div className="flex items-center justify-center gap-1 tabular-nums text-xs">
                          <span title="Regular">{totals.regHrs > 0 ? totals.regHrs.toLocaleString() : ""}</span>
                          {(totals.otHrs > 0 || totals.dtHrs > 0) && (
                            <>
                              <span className="text-fg/15">·</span>
                              <span title="Overtime">{totals.otHrs > 0 ? totals.otHrs.toLocaleString() : "0"}</span>
                              <span className="text-fg/15">·</span>
                              <span title="Double Time">{totals.dtHrs > 0 ? totals.dtHrs.toLocaleString() : "0"}</span>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                    {isColVisible("cost") && (
                      <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                        {formatMoney(totals.cost)}
                      </td>
                    )}
                    {isColVisible("extCost") && (
                      <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                        {formatMoney(totals.cost)}
                      </td>
                    )}
                    {isColVisible("markup") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("price") && (
                      <td className="border-t border-line px-2 py-2 text-right tabular-nums font-semibold">
                        {formatMoney(totals.price)}
                      </td>
                    )}
                    {isColVisible("margin") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("phaseId") && <td className="border-t border-line px-2 py-2" />}
                    {isColVisible("actions") && <td className="border-t border-line px-2 py-2" />}
                  </tr>
                </tfoot>
                </table>
              </div>
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line bg-panel2/40 px-2.5 py-1 text-[10px] leading-4 text-fg/35">
                <span className="truncate">
                  Press{" "}
                  <kbd className="rounded border border-line bg-bg/70 px-1 py-px font-mono text-[9px] text-fg/45">
                    Cmd/Ctrl Enter
                  </kbd>{" "}
                  for a new line with search ready.
                </span>
                <span className="hidden shrink-0 text-fg/30 sm:inline">
                  Multi adds several library results at once.
                </span>
              </div>
            </div>
          )}
          </motion.div>
        </AnimatePresence>
        </div>
      </div>

      {/* ─── Context menu ─── */}
      {contextMenu && (
        <div
          ref={(el) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            let x = contextMenu.x;
            let y = contextMenu.y;
            if (x + rect.width > vw) x = vw - rect.width - 8;
            if (y + rect.height > vh) y = vh - rect.height - 8;
            if (x < 0) x = 8;
            if (y < 0) y = 8;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
          }}
          className="fixed z-50 rounded-lg border border-line bg-panel shadow-xl py-1 text-xs min-w-[160px]"
          style={{ left: -9999, top: -9999 }}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-panel2/60 flex items-center gap-2"
            onClick={() => {
              const row = visibleRows.find((r) => r.id === contextMenu.rowId);
              if (row) setDetailItem(row);
              setContextMenu(null);
            }}
          >
            <Maximize2 className="h-3 w-3" /> Open Detail
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-panel2/60 flex items-center gap-2"
            onClick={() => {
              copyRowToClipboard(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            <Clipboard className="h-3 w-3" /> Copy Row
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-panel2/60 flex items-center gap-2"
            onClick={() => {
              duplicateRow(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            <Copy className="h-3 w-3" /> Duplicate
          </button>

          <div className="my-1 border-t border-line" />

          <button
            className="w-full text-left px-3 py-1.5 hover:bg-panel2/60 flex items-center gap-2"
            onClick={() => {
              exportTableAsCsv();
              setContextMenu(null);
            }}
          >
            <Download className="h-3 w-3" /> Export Table as CSV
          </button>

          <div className="my-1 border-t border-line" />

          <button
            className="w-full text-left px-3 py-1.5 hover:bg-danger/10 text-danger flex items-center gap-2"
            onClick={() => {
              deleteRow(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}

      {/* ─── Tab context menu ─── */}
      {tabMenu && (
        <div
          className="fixed z-50 rounded-lg border border-line bg-panel shadow-xl py-1 text-xs min-w-[140px]"
          style={{ left: tabMenu.x, top: tabMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-panel2/60"
            onClick={() => {
              setInlineRenameWsId(tabMenu.wsId);
              const ws = findWs(workspace, tabMenu.wsId);
              setInlineRenameName(ws?.name ?? "");
              setTabMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-danger/10 text-danger"
            onClick={() => {
              const ws = findWs(workspace, tabMenu.wsId);
              if (ws) {
                setDeleteWsTarget({ wsId: ws.id, name: ws.name, itemCount: ws.items.length });
              }
              setTabMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* ─── Organizer context menu ─── */}
      {organizerMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-line bg-panel py-1 text-xs shadow-xl"
          style={{ left: organizerMenu.x, top: organizerMenu.y }}
        >
          {organizerMenu.type === "folder" && (
            <>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel2/60"
                onClick={() => {
                  setFolderForm({ parentId: organizerMenu.id, name: "" });
                  setOrganizerMenu(null);
                }}
              >
                <FolderPlus className="h-3 w-3" /> New folder
              </button>
              <button
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel2/60"
                onClick={() => {
                  setNewWsFolderId(organizerMenu.id);
                  setNewWsName("");
                  setShowNewWsModal(true);
                  setOrganizerMenu(null);
                }}
              >
                <Plus className="h-3 w-3" /> New worksheet
              </button>
              <div className="my-1 border-t border-line" />
            </>
          )}
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel2/60"
            onClick={() => {
              openRenameTarget(organizerMenu);
              setOrganizerMenu(null);
            }}
          >
            <Edit3 className="h-3 w-3" /> Rename
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-panel2/60"
            onClick={() => {
              openMoveTarget(organizerMenu);
              setOrganizerMenu(null);
            }}
          >
            <MoveRight className="h-3 w-3" /> Move
          </button>
          <div className="my-1 border-t border-line" />
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-danger/10"
            onClick={() => {
              if (organizerMenu.type === "folder") {
                const folderWorksheets = getWorksheetsInFolderView(workspace, organizerMenu.id);
                setDeleteFolderTarget({
                  folderId: organizerMenu.id,
                  name: organizerMenu.name,
                  parentId: organizerMenu.parentId,
                  worksheetCount: folderWorksheets.length,
                  childFolderCount: (workspace.worksheetFolders ?? []).filter((folder) => folder.parentId === organizerMenu.id).length,
                  itemCount: folderWorksheets.reduce((sum, worksheet) => sum + worksheet.items.length, 0),
                });
              } else {
                const ws = findWs(workspace, organizerMenu.id);
                if (ws) {
                  setDeleteWsTarget({ wsId: ws.id, name: ws.name, itemCount: ws.items.length });
                }
              }
              setOrganizerMenu(null);
            }}
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}

      {/* ─── Delete worksheet confirmation modal ─── */}
      {deleteWsTarget && (
        <ModalBackdrop open={true} onClose={() => setDeleteWsTarget(null)} size="sm">
          <div className="rounded-xl border border-line bg-panel shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">Delete worksheet?</h2>
                <p className="mt-0.5 text-xs text-fg/50">This cannot be undone.</p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteWsTarget(null)}
                disabled={isPending}
                className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 text-xs text-fg/75 space-y-2">
              <p>
                Delete worksheet <span className="font-medium text-fg">&ldquo;{deleteWsTarget.name}&rdquo;</span>?
              </p>
              <p className="text-fg/55">
                {deleteWsTarget.itemCount === 0
                  ? "This worksheet has no line items."
                  : `All ${deleteWsTarget.itemCount} line item${deleteWsTarget.itemCount === 1 ? "" : "s"} on it will be permanently deleted.`}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              <Button size="sm" variant="ghost" onClick={() => setDeleteWsTarget(null)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleDeleteWorksheet(deleteWsTarget.wsId)}
                disabled={isPending}
              >
                {isPending ? "Deleting…" : "Delete worksheet"}
              </Button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* ─── Delete folder confirmation modal ─── */}
      {deleteFolderTarget && (
        <ModalBackdrop open={true} onClose={() => setDeleteFolderTarget(null)} size="sm">
          <div className="rounded-xl border border-line bg-panel shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">Delete folder?</h2>
                <p className="mt-0.5 text-xs text-fg/50">Worksheets inside it will be moved up one level.</p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteFolderTarget(null)}
                disabled={isPending}
                className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70 disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2 px-5 py-4 text-xs text-fg/75">
              <p>
                Delete folder <span className="font-medium text-fg">&ldquo;{deleteFolderTarget.name}&rdquo;</span>?
              </p>
              <p className="text-fg/55">
                {deleteFolderTarget.worksheetCount} worksheet{deleteFolderTarget.worksheetCount === 1 ? "" : "s"},
                {" "}{deleteFolderTarget.childFolderCount} child folder{deleteFolderTarget.childFolderCount === 1 ? "" : "s"},
                and {deleteFolderTarget.itemCount} line item{deleteFolderTarget.itemCount === 1 ? "" : "s"} will stay in the estimate.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              <Button size="sm" variant="ghost" onClick={() => setDeleteFolderTarget(null)} disabled={isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleDeleteFolder(deleteFolderTarget.folderId)}
                disabled={isPending}
              >
                {isPending ? "Deleting..." : "Delete folder"}
              </Button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* ─── New folder modal ─── */}
      {folderForm && (
        <ModalBackdrop open={true} onClose={() => setFolderForm(null)} size="sm">
          <div className="rounded-xl border border-line bg-panel shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">New folder</h2>
                <p className="mt-0.5 text-xs text-fg/50">
                  {folderForm.parentId
                    ? `Inside ${getWorksheetFolderPath(workspace.worksheetFolders ?? [], folderForm.parentId)}`
                    : "At the top level"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFolderForm(null)}
                className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5 px-5 py-4">
              <span className="text-xs font-medium text-fg/65">Folder name</span>
              <Input
                autoFocus
                placeholder="e.g. Mechanical / Field install"
                value={folderForm.name}
                onChange={(e) => setFolderForm((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              <Button size="sm" variant="ghost" onClick={() => setFolderForm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={handleCreateFolder}
                disabled={!folderForm.name.trim() || isPending}
              >
                Create
              </Button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* ─── Rename organizer node modal ─── */}
      {renameTarget && (
        <ModalBackdrop open={true} onClose={() => setRenameTarget(null)} size="sm">
          <div className="rounded-xl border border-line bg-panel shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">Rename {renameTarget.type}</h2>
                <p className="mt-0.5 text-xs text-fg/50">{renameTarget.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5 px-5 py-4">
              <span className="text-xs font-medium text-fg/65">Name</span>
              <Input
                autoFocus
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameTarget();
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              <Button size="sm" variant="ghost" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="accent" onClick={handleRenameTarget} disabled={!renameName.trim() || isPending}>
                Rename
              </Button>
            </div>
          </div>
        </ModalBackdrop>
      )}

      {/* ─── Move organizer node modal ─── */}
      {moveTarget && (() => {
        const folders = workspace.worksheetFolders ?? [];
        const folderOptions = [
          { value: "__root__", label: "Top level" },
          ...folders
            .filter((folder) =>
              moveTarget.type === "worksheet" ||
              (folder.id !== moveTarget.id && !isDescendantWorksheetFolder(folders, folder.id, moveTarget.id))
            )
            .map((folder) => ({
              value: folder.id,
              label: getWorksheetFolderPath(folders, folder.id) || folder.name,
            })),
        ];
        return (
          <ModalBackdrop open={true} onClose={() => setMoveTarget(null)} size="sm">
            <div className="rounded-xl border border-line bg-panel shadow-2xl">
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-fg">Move {moveTarget.type}</h2>
                  <p className="mt-0.5 text-xs text-fg/50">{moveTarget.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMoveTarget(null)}
                  className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="space-y-1.5 px-5 py-4">
                <span className="text-xs font-medium text-fg/65">Destination</span>
                <Select
                  value={moveParentId}
                  onValueChange={setMoveParentId}
                  options={folderOptions}
                />
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
                <Button size="sm" variant="ghost" onClick={() => setMoveTarget(null)}>
                  Cancel
                </Button>
                <Button size="sm" variant="accent" onClick={handleMoveTarget} disabled={isPending}>
                  Move
                </Button>
              </div>
            </div>
          </ModalBackdrop>
        );
      })()}

      {/* ─── New Worksheet modal ─── */}
      {showNewWsModal && (
        <ModalBackdrop open={showNewWsModal} onClose={() => {
          setShowNewWsModal(false);
          setNewWsFolderId(null);
        }} size="sm">
          <div className="rounded-xl border border-line bg-panel shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-fg">New worksheet</h2>
                <p className="mt-0.5 text-xs text-fg/50">
                  {newWsFolderId
                    ? `Inside ${getWorksheetFolderPath(workspace.worksheetFolders ?? [], newWsFolderId)}`
                    : "Group related line items into their own tab."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowNewWsModal(false);
                  setNewWsFolderId(null);
                }}
                className="rounded-md p-1 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5 px-5 py-4">
              <span className="text-xs font-medium text-fg/65">Worksheet name</span>
              <Input
                autoFocus
                placeholder="e.g. Mechanical pipe rack"
                value={newWsName}
                onChange={(e) => setNewWsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateWorksheet();
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
              <Button size="sm" variant="ghost" onClick={() => {
                setShowNewWsModal(false);
                setNewWsFolderId(null);
              }}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="accent"
                onClick={handleCreateWorksheet}
                disabled={!newWsName.trim() || isPending}
              >
                Create
              </Button>
            </div>
          </div>
        </ModalBackdrop>
      )}


      {/* ─── Assembly Insert Modal ─── */}
      <AssemblyInsertModal
        open={showAssemblyPicker}
        onClose={() => setShowAssemblyPicker(false)}
        projectId={workspace.project.id}
        worksheetId={activeWorksheetForActions?.id ?? null}
        onInserted={(next, info) => {
          onApply(next);
          if (info.warnings.length > 0) {
            onError(`Inserted with warnings: ${info.warnings.join("; ")}`);
          }
        }}
      />

      {/* ─── Save Selection As Assembly Modal ─── */}
      <SaveSelectionAsAssemblyModal
        open={showSaveAsAssembly}
        onClose={() => setShowSaveAsAssembly(false)}
        projectId={workspace.project.id}
        worksheetId={activeWorksheetForActions?.id ?? null}
        selectedItemIds={Array.from(selectedIds)}
        onSaved={(info) => {
          setSelectedIds(new Set());
          if (info.skippedFreeform > 0) {
            onError(`Saved "${info.assemblyName}" — skipped ${info.skippedFreeform} freeform line${info.skippedFreeform === 1 ? "" : "s"} (no catalog or rate-schedule reference).`);
          }
        }}
      />


      {/* ─── Universal Add Items Modal ─── */}
      {showAddItemsPicker && (() => {
        const browseCard = addItemsSearchTerm.trim() ? null : activeAddItemsBrowseCard;
        const BrowseHeaderIcon = browseCard?.Icon;
        const showBrowseLaunchpad = !addItemsSearchTerm.trim() && !browseCard;
        const selectableVisibleItems = addItemsFlatItems.filter(({ group, item }) =>
          canCreateWorksheetItemFromOption(group, item)
        );
        const allVisibleSelected =
          selectableVisibleItems.length > 0 &&
          selectableVisibleItems.every(({ item }) => selectedAddItems.has(entityOptionKey(item)));
        const sourceStats = Array.from(
          addItemsFlatItems.reduce<Map<string, number>>((map, entry) => {
            const label = sourceBadgeLabel(entry.item.source) || "Item";
            map.set(label, (map.get(label) ?? 0) + 1);
            return map;
          }, new Map()),
        ).slice(0, 6);

        const toggleAddItem = (group: EntityOptionGroup, item: EntityOptionItem) => {
          if (!canCreateWorksheetItemFromOption(group, item)) return;
          const key = entityOptionKey(item);
          setSelectedAddItems((current) => {
            const next = new Map(current);
            if (next.has(key)) next.delete(key);
            else next.set(key, { group, item });
            return next;
          });
        };

        const handleActionItem = (item: EntityOptionItem) => {
          if (item.actionType === "open_assembly") {
            setShowAddItemsPicker(false);
            setShowAssemblyPicker(true);
            return;
          }
          if (item.actionType === "plugin_tool" || item.actionType === "plugin_remote_search") {
            setShowAddItemsPicker(false);
            if (onOpenPluginTools) onOpenPluginTools();
            else onError("Open Plugin Tools to run this action.");
          }
        };

        const renderBrowseLaunchpad = () => (
          <div className="grid grid-cols-3 gap-2 p-3">
            <button
              type="button"
              className="group flex min-h-[86px] flex-col justify-between rounded-lg border border-accent/25 bg-accent/8 p-3 text-left transition-colors hover:border-accent/45 hover:bg-accent/10"
              onClick={() => {
                addNewItem();
                setShowAddItemsPicker(false);
              }}
            >
              <span className="flex items-center justify-between">
                <span className="flex h-8 w-8 items-center justify-center rounded-md border border-accent/25 bg-bg text-accent">
                  <Plus className="h-4 w-4" />
                </span>
                <ChevronRight className="h-4 w-4 text-accent/45 transition-colors group-hover:text-accent" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-fg">Blank Row</span>
                <span className="block text-[11px] leading-4 text-fg/45">Start with an empty worksheet line</span>
              </span>
            </button>
            {enabledEntityBrowseCards.map((card) => {
              const BrowseIcon = card.Icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  className="group flex min-h-[86px] flex-col justify-between rounded-lg border border-line/70 bg-bg/45 p-3 text-left transition-colors hover:border-accent/30 hover:bg-accent/5"
                  onClick={() => setAddItemsBrowseMode(card.id)}
                >
                  <span className="flex items-center justify-between">
                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-md border", card.accent)}>
                      <BrowseIcon className="h-4 w-4" />
                    </span>
                    <ChevronRight className="h-4 w-4 text-fg/25 transition-colors group-hover:text-accent" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-fg">{card.label}</span>
                    <span className="block text-[11px] leading-4 text-fg/45">{card.detail}</span>
                  </span>
                </button>
              );
            })}
            {enabledEntityBrowseCards.length === 0 && (
              <div className="col-span-3 rounded-lg border border-dashed border-line bg-bg/35 px-3 py-8 text-center text-xs text-fg/42">
                All estimate search sources are disabled for this quote.
              </div>
            )}
          </div>
        );

        const renderAddItemRow = (group: EntityOptionGroup, item: EntityOptionItem) => {
          const key = entityOptionKey(item);
          const selected = selectedAddItems.has(key);
          const selectable = canCreateWorksheetItemFromOption(group, item);
          const needsRate = item.source === "labor_unit" && !item.rateScheduleItemId;
          const isLinkedCatalogRate = item.source === "catalog" && !!item.rateScheduleItemId;
          const badge = isLinkedCatalogRate ? "Catalog + rate" : sourceBadgeLabel(item.source);
          const badgeToneSource = isLinkedCatalogRate ? "rate_schedule" : item.source;
          const SourceIcon = sourceIconFor(item.source);
          const ActionIcon = item.actionType === "open_assembly"
            ? Layers
            : item.actionType === "plugin_tool" || item.actionType === "plugin_remote_search"
              ? PlugZap
              : ChevronRight;
          const measure = optionMeasureLabel(item);
          const detailParts = optionMetaParts(item);

          return (
            <button
              key={`${group.categoryId}-${key}`}
              type="button"
              className={cn(
                "group flex w-full items-center gap-2 border-b border-line/60 px-2.5 py-1.5 text-left transition-colors last:border-b-0",
                selected ? "bg-accent/8" : "bg-bg/35 hover:bg-accent/5",
                !selectable && "opacity-85",
              )}
              onClick={() => {
                if (selectable) toggleAddItem(group, item);
                else handleActionItem(item);
              }}
            >
              <span className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                selectable
                  ? selected
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-line bg-panel text-fg/30"
                  : sourceAccentClasses(item.source),
              )}>
                {selectable ? (
                  selected ? <Check className="h-3 w-3" /> : null
                ) : (
                  <SourceIcon className="h-3 w-3" />
                )}
              </span>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", sourceAccentClasses(item.source))}>
                <SourceIcon className="h-3 w-3" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="block min-w-0 flex-1 truncate text-[12px] font-semibold leading-4 text-fg">
                    {item.label}
                  </span>
                  {measure && (
                    <span className="shrink-0 rounded border border-line bg-panel px-1 py-px text-[9px] font-medium tabular-nums leading-3 text-fg/60">
                      {measure}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-fg/42">
                  {badge && (
                    <span className={cn("shrink-0 rounded border px-1 py-px text-[8px] font-semibold leading-3", sourceAccentClasses(badgeToneSource))}>
                      {badge}
                    </span>
                  )}
                  {needsRate && (
                    <span className="shrink-0 rounded border border-warning/25 bg-warning/8 px-1 py-px text-[9px] font-semibold leading-3 text-warning">
                      Needs rate
                    </span>
                  )}
                  {detailParts.slice(0, 4).map((part, detailIndex) => (
                    <span key={`${part}-${detailIndex}`} className="min-w-0 max-w-[220px] truncate">
                      {part}
                    </span>
                  ))}
                </span>
              </span>
              {!selectable && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-accent">
                  Open
                  <ActionIcon className="h-3.5 w-3.5" />
                </span>
              )}
            </button>
          );
        };

        const renderGroupBlock = (group: EntityOptionGroup) => {
          if (group.items.length === 0) return null;
          return (
            <div key={group.categoryId} className="bg-bg/25">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-t border-line bg-panel px-2.5 py-1 text-[10px] font-semibold uppercase tracking-normal text-fg/42">
                <span className="truncate">{group.label ?? group.categoryName}</span>
                <span>{group.items.length}</span>
              </div>
              {group.items.map((item) => renderAddItemRow(group, item))}
            </div>
          );
        };

        return (
          <ModalBackdrop open={showAddItemsPicker} onClose={() => setShowAddItemsPicker(false)}>
            <div className="flex h-[min(76vh,720px)] w-[min(960px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
              <div className="border-b border-line bg-panel2/30 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-accent" />
                      Add Line Items
                    </h4>
                    <p className="mt-0.5 text-[11px] text-fg/42">
                      Search every indexed source, select many rows, or open assemblies and plugin tools from here.
                    </p>
                  </div>
                  <Button size="xs" variant="ghost" onClick={() => setShowAddItemsPicker(false)} title="Close">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-bg/80 px-2.5 py-1.5 shadow-inner focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20">
                    <Search className="h-4 w-4 shrink-0 text-accent" />
                    <input
                      autoFocus
                      type="text"
                      className="h-6 min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg/30"
                      placeholder="Search rates, catalogues, labour units, assemblies, cost intel, plugins..."
                      value={addItemsSearchTerm}
                      onChange={(e) => {
                        const next = e.target.value;
                        setAddItemsSearchTerm(next);
                        if (next.trim()) setAddItemsBrowseMode(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setShowAddItemsPicker(false);
                      }}
                    />
                    {addItemsLoading ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                    ) : (
                      <Sparkles className="h-4 w-4 shrink-0 text-accent/70" />
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      addNewItem();
                      setShowAddItemsPicker(false);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Blank
                  </Button>
                </div>

                <div className="mt-2 flex min-w-0 items-center gap-1 overflow-hidden">
                  {browseCard ? (
                    <button
                      type="button"
                      className={cn("inline-flex max-w-[280px] shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", browseCard.accent)}
                      onClick={() => setAddItemsBrowseMode(null)}
                    >
                      {BrowseHeaderIcon && <BrowseHeaderIcon className="h-3 w-3" />}
                      <span className="truncate">{browseCard.label}</span>
                      <X className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-bg/55 px-1.5 py-0.5 text-[10px] font-medium text-fg/45">
                      <CircleDollarSign className="h-3 w-3" />
                      {showBrowseLaunchpad ? "Choose source" : `${addItemsFlatItems.length} loaded`}
                    </span>
                  )}
                  {!showBrowseLaunchpad && sourceStats.map(([label, count]) => (
                    <span key={label} className="inline-flex shrink-0 rounded-md border border-line bg-bg/45 px-1.5 py-0.5 text-[10px] text-fg/40">
                      {label} {count}
                    </span>
                  ))}
                  {!showBrowseLaunchpad && selectableVisibleItems.length > 0 && (
                    <button
                      type="button"
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-bg/45 px-1.5 py-0.5 text-[10px] font-medium text-fg/55 hover:border-accent/35 hover:text-accent"
                      onClick={() => {
                        setSelectedAddItems((current) => {
                          const next = new Map(current);
                          if (allVisibleSelected) {
                            for (const { item } of selectableVisibleItems) next.delete(entityOptionKey(item));
                          } else {
                            for (const entry of selectableVisibleItems) next.set(entityOptionKey(entry.item), entry);
                          }
                          return next;
                        });
                      }}
                    >
                      <Check className="h-3 w-3" />
                      {allVisibleSelected ? "Clear visible" : "Select visible"}
                    </button>
                  )}
                </div>
              </div>

              <div
                className="min-h-0 flex-1 overflow-y-auto"
                onScroll={(event) => {
                  const target = event.currentTarget;
                  if (target.scrollTop + target.clientHeight >= target.scrollHeight - 220) {
                    void loadMoreAddItems();
                  }
                }}
              >
                {showBrowseLaunchpad && renderBrowseLaunchpad()}
                {!showBrowseLaunchpad && addItemsLoading && addItemsFlatItems.length === 0 && (
                  <div className="flex items-center justify-center gap-2 px-3 py-10 text-xs text-fg/45">
                    <Loader2 className="h-4 w-4 animate-spin text-accent" />
                    Searching indexed line-item sources...
                  </div>
                )}
                {addItemsError && (
                  <div className="m-3 rounded-lg border border-danger/20 bg-danger/5 px-2.5 py-2 text-[11px] text-danger">
                    {addItemsError}
                  </div>
                )}
                {!showBrowseLaunchpad && !addItemsLoading && !addItemsError && addItemsFlatItems.length === 0 && (
                  <div className="m-3 rounded-lg border border-dashed border-line bg-bg/40 px-3 py-10 text-center text-xs text-fg/45">
                    No matches yet.
                  </div>
                )}
                {!showBrowseLaunchpad && addItemsGroups.map(renderGroupBlock)}
                {!showBrowseLaunchpad && addItemsLoadingMore && (
                  <div className="flex items-center justify-center gap-2 py-3 text-[11px] text-fg/40">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    Loading more...
                  </div>
                )}
                {!showBrowseLaunchpad && !addItemsHasMore && !addItemsLoading && addItemsFlatItems.length > 0 && (
                  <div className="py-2 text-center text-[10px] text-fg/30">
                    End of indexed results
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-line bg-panel2/25 px-3 py-2">
                <span className="text-xs text-fg/45">
                  {selectedAddItems.size} item{selectedAddItems.size === 1 ? "" : "s"} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setShowAddItemsPicker(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleAddSelectedItems}
                    disabled={selectedAddItems.size === 0 || isPending}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Selected
                  </Button>
                </div>
              </div>
            </div>
          </ModalBackdrop>
        );
      })()}

      <LineFactorDrawer
        item={factorLineItem}
        workspace={workspace}
        factors={factorLineItem ? lineFactorsByItemId.get(factorLineItem.id) ?? [] : []}
        factorTotalsById={factorTotalsById}
        onClose={() => setFactorLineItem(null)}
        onApply={onApply}
        onError={onError}
      />

      {/* ─── Item Detail Drawer ─── */}
      <AnimatePresence>
        {detailItem && (
          <ItemDetailDrawer
            key={detailItem.id}
            item={detailItem}
            workspace={workspace}
            entityCategories={entityCategories}
            onPatchItem={(itemId, patch) => {
              commitItemPatch(itemId, patch);
            }}
            onDelete={(id) => {
              deleteRow(id);
              setDetailItem(null);
            }}
            onDuplicate={(id) => {
              duplicateRow(id);
            }}
            onRefreshWorkspace={onRefresh}
            onError={onError}
            onClose={() => setDetailItem(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function lineFactorPercent(value: number) {
  return Number.isFinite(value) ? Math.round((value - 1) * 10_000) / 100 : 0;
}

function lineFactorValueFromPercent(value: string) {
  const parsed = Number(value);
  const percent = Number.isFinite(parsed) ? parsed : 0;
  return Math.max(0.05, Math.min(10, Math.round((1 + percent / 100) * 10_000) / 10_000));
}

function lineFactorFormulaLabel(value: EstimateFactorFormulaType | string | undefined) {
  switch (value) {
    case "condition_score":
      return "condition score";
    case "neca_condition_score":
      return "condition score sheet";
    case "temperature_productivity":
      return "temperature productivity";
    case "extended_duration":
      return "extended duration";
    case "per_unit_scale":
      return "scaled input";
    default:
      return "fixed multiplier";
  }
}

function lineFactorScope(item: WorkspaceWorksheetItem) {
  return {
    mode: "line" as const,
    worksheetItemIds: [item.id],
    worksheetIds: [item.worksheetId],
    categoryIds: item.categoryId ? [item.categoryId] : undefined,
    categoryNames: item.category ? [item.category] : undefined,
  };
}

function LineFactorDrawer({
  item,
  workspace,
  factors,
  factorTotalsById,
  onClose,
  onApply,
  onError,
}: {
  item: WorkspaceWorksheetItem | null;
  workspace: ProjectWorkspaceData;
  factors: EstimateFactor[];
  factorTotalsById: Map<string, ProjectWorkspaceData["estimate"]["totals"]["factorTotals"][number]>;
  onClose: () => void;
  onApply: (next: WorkspaceResponse) => void;
  onError: (message: string) => void;
}) {
  const [library, setLibrary] = useState<EstimateFactorLibraryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("Line Productivity Factor");
  const [customPercent, setCustomPercent] = useState("0");
  const [editingFactorId, setEditingFactorId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingPercent, setEditingPercent] = useState("0");
  const [editingParameters, setEditingParameters] = useState<Record<string, unknown>>({});
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    getEstimateFactorLibrary(workspace.project.id)
      .then((entries) => {
        if (!cancelled) setLibrary(entries.filter((entry) => (entry.applicationScope ?? "both") !== "global"));
      })
      .catch((cause) => {
        if (!cancelled) onError(cause instanceof Error ? cause.message : "Failed to load factor library");
      });
    return () => { cancelled = true; };
  }, [item, onError, workspace.project.id]);

  if (!item || typeof document === "undefined") return null;

  const filteredLibrary = library.filter((entry) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${entry.name} ${entry.code} ${entry.category} ${entry.description} ${entry.tags.join(" ")}`.toLowerCase().includes(needle);
  });

  const mutate = (task: () => Promise<WorkspaceResponse>) => {
    startTransition(async () => {
      try {
        onApply(await task());
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Line factor operation failed");
      }
    });
  };

  const addLibraryFactor = (entry: EstimateFactorLibraryRecord) => {
    mutate(() => createEstimateFactor(workspace.project.id, {
      name: entry.name,
      code: entry.code,
      description: entry.description,
      category: entry.category,
      impact: entry.impact,
      value: entry.value,
      active: true,
      appliesTo: item.entityName || item.category || "Line item",
      applicationScope: "line",
      scope: lineFactorScope(item),
      formulaType: entry.formulaType ?? "fixed_multiplier",
      parameters: entry.parameters ?? {},
      confidence: entry.confidence,
      sourceType: "library",
      sourceId: entry.id,
      sourceRef: { ...(entry.sourceRef ?? {}), libraryEntryId: entry.id, lineItemId: item.id },
      tags: entry.tags,
    }));
  };

  const addCustomFactor = () => {
    mutate(() => createEstimateFactor(workspace.project.id, {
      name: customName.trim() || "Line Productivity Factor",
      code: "LINE-CUSTOM",
      description: `Line-level factor for ${item.entityName || "worksheet item"}`,
      category: "Line Factor",
      impact: "labor_hours",
      value: lineFactorValueFromPercent(customPercent),
      active: true,
      appliesTo: item.entityName || item.category || "Line item",
      applicationScope: "line",
      scope: lineFactorScope(item),
      formulaType: "fixed_multiplier",
      parameters: {},
      confidence: "medium",
      sourceType: "custom",
      sourceRef: { basis: "Estimator-entered line factor", lineItemId: item.id },
      tags: ["line-factor"],
    }));
    setCustomOpen(false);
    setCustomPercent("0");
  };

  const toggleFactor = (factor: EstimateFactor) => {
    mutate(() => updateEstimateFactor(workspace.project.id, factor.id, { active: !factor.active }));
  };

  const startEdit = (factor: EstimateFactor) => {
    setEditingFactorId(factor.id);
    setEditingName(factor.name);
    setEditingPercent(String(lineFactorPercent(factor.value)));
    setEditingParameters(factor.parameters ?? {});
  };

  const saveEdit = (factor: EstimateFactor) => {
    mutate(() => updateEstimateFactor(workspace.project.id, factor.id, {
      name: editingName.trim() || factor.name,
      value: lineFactorValueFromPercent(editingPercent),
      formulaType: factor.formulaType ?? "fixed_multiplier",
      parameters: editingParameters,
    }));
    setEditingFactorId(null);
  };

  return createPortal(
    <AnimatePresence>
      <motion.div key="line-factor-drawer-backdrop" className="fixed inset-0 z-[80] bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        key="line-factor-drawer-panel"
        className="fixed bottom-0 right-0 top-0 z-[81] flex w-full max-w-[520px] flex-col border-l border-line bg-panel shadow-2xl"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-fg">Line Factors</div>
            <div className="mt-1 truncate text-[11px] text-fg/45">{item.entityName || item.description || item.id}</div>
          </div>
          <Button size="xs" variant="ghost" className="h-8 w-8 px-0" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <section className="rounded-lg border border-line bg-bg/35">
            <div className="border-b border-line px-3 py-2 text-xs font-semibold text-fg">Applied to this line</div>
            {factors.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-fg/40">No line factors yet.</div>
            ) : factors.map((factor) => {
              const total = factorTotalsById.get(factor.id);
              const isEditing = editingFactorId === factor.id;
              return (
                <div key={factor.id} className="flex items-center gap-2 border-b border-line/70 px-3 py-2 last:border-b-0">
                  <button className="shrink-0" onClick={() => toggleFactor(factor)} disabled={isPending}>
                    <Badge tone={factor.active ? "success" : "default"}>{factor.active ? "On" : "Off"}</Badge>
                  </button>
                  {isEditing ? (
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_76px_auto_auto] gap-2">
                        <Input className="h-7 text-xs" value={editingName} onChange={(event) => setEditingName(event.target.value)} />
                        <Input className="h-7 text-right font-mono text-xs" value={editingPercent} onChange={(event) => setEditingPercent(event.target.value)} />
                        <Button size="xs" className="h-7 px-2" onClick={() => saveEdit(factor)} disabled={isPending}>Save</Button>
                        <Button size="xs" variant="ghost" className="h-7 px-2" onClick={() => setEditingFactorId(null)} disabled={isPending}>Cancel</Button>
                      </div>
                      {factor.formulaType !== "fixed_multiplier" ? (
                        <FactorParameterEditor
                          compact
                          formulaType={(factor.formulaType ?? "fixed_multiplier") as EstimateFactorFormulaType}
                          parameters={editingParameters}
                          onChange={setEditingParameters}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-fg">{factor.name}</div>
                        <div className="mt-0.5 text-[10px] text-fg/45">{lineFactorFormulaLabel(factor.formulaType)} / {lineFactorPercent(total?.value ?? factor.value)}%</div>
                      </div>
                      <div className={cn("font-mono text-[11px]", (total?.valueDelta ?? 0) >= 0 ? "text-warning" : "text-success")}>{formatMoney(total?.valueDelta ?? 0)}</div>
                      <Button size="xs" variant="ghost" className="h-7 px-2" onClick={() => startEdit(factor)} disabled={isPending}>Edit</Button>
                      <Button size="xs" variant="ghost" className="h-7 px-2" onClick={() => mutate(() => deleteEstimateFactor(workspace.project.id, factor.id))} disabled={isPending}>
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </section>

          <section className="rounded-lg border border-line bg-bg/35">
            <div className="border-b border-line px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-fg">Add from library</div>
                <Button size="xs" variant="secondary" onClick={() => setCustomOpen((open) => !open)}><Plus className="h-3 w-3" /> Custom</Button>
              </div>
              <Input className="mt-2 h-8 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search line-capable factors" />
            </div>
            {customOpen ? (
              <div className="grid gap-2 border-b border-line p-3">
                <Input className="text-xs" value={customName} onChange={(event) => setCustomName(event.target.value)} />
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input className="text-right font-mono text-xs" value={customPercent} onChange={(event) => setCustomPercent(event.target.value)} />
                  <Button size="xs" onClick={addCustomFactor} disabled={isPending}>Add</Button>
                </div>
              </div>
            ) : null}
            <div className="max-h-[44vh] overflow-auto">
              {filteredLibrary.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-fg/40">No matching line-capable factors.</div>
              ) : filteredLibrary.map((entry) => (
                <button
                  key={entry.id}
                  className="flex w-full items-start gap-2 border-b border-line/70 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-accent/5"
                  onClick={() => addLibraryFactor(entry)}
                  disabled={isPending}
                >
                  <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-fg">{entry.name}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-fg/45">{entry.category} / {lineFactorFormulaLabel(entry.formulaType)}</span>
                  </span>
                  <Badge tone={entry.value >= 1 ? "warning" : "success"}>{lineFactorPercent(entry.value)}%</Badge>
                </button>
              ))}
            </div>
          </section>
        </div>
      </motion.aside>
    </AnimatePresence>,
    document.body,
  );
}

function WorksheetOrganizerPanel({
  workspace,
  activeViewId,
  onSelectAll,
  onSelectFolder,
  onSelectWorksheet,
  onOpenContextMenu,
  onCreateRootFolder,
  onCreateRootWorksheet,
}: {
  workspace: ProjectWorkspaceData;
  activeViewId: WorksheetViewId;
  onSelectAll: () => void;
  onSelectFolder: (folderId: string) => void;
  onSelectWorksheet: (worksheetId: string) => void;
  onOpenContextMenu: (target: OrganizerNodeTarget, x: number, y: number) => void;
  onCreateRootFolder: () => void;
  onCreateRootWorksheet: () => void;
}) {
  const folders = workspace.worksheetFolders ?? [];
  const worksheets = workspace.worksheets ?? [];
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map((folder) => folder.id)));

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, WorkspaceWorksheetFolder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? null;
      const next = map.get(key) ?? [];
      next.push(folder);
      map.set(key, next);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }
    return map;
  }, [folders]);

  const worksheetsByFolder = useMemo(() => {
    const map = new Map<string | null, WorkspaceWorksheet[]>();
    for (const worksheet of worksheets) {
      const key = worksheet.folderId ?? null;
      const next = map.get(key) ?? [];
      next.push(worksheet);
      map.set(key, next);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    }
    return map;
  }, [worksheets]);

  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (!worksheetViewIsFolder(activeViewId)) return;
    const folderId = folderIdFromView(activeViewId);
    if (!folderId) return;
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const ancestors = new Set<string>();
    let cursor = byId.get(folderId);
    while (cursor) {
      ancestors.add(cursor.id);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    setExpanded((prev) => new Set([...prev, ...ancestors]));
  }, [activeViewId, folders]);

  useEffect(() => {
    if (q) setExpanded(new Set(folders.map((folder) => folder.id)));
  }, [folders, q]);

  const worksheetMatches = useCallback((worksheet: WorkspaceWorksheet) => {
    if (!q) return true;
    const path = getWorksheetFolderPath(folders, worksheet.folderId).toLowerCase();
    return worksheet.name.toLowerCase().includes(q) || path.includes(q);
  }, [folders, q]);

  const folderMatches = useCallback((folder: WorkspaceWorksheetFolder): boolean => {
    if (!q) return true;
    if (folder.name.toLowerCase().includes(q)) return true;
    const childFolders = foldersByParent.get(folder.id) ?? [];
    const childWorksheets = worksheetsByFolder.get(folder.id) ?? [];
    return childWorksheets.some(worksheetMatches) || childFolders.some(folderMatches);
  }, [foldersByParent, q, worksheetMatches, worksheetsByFolder]);

  function toggle(folderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function folderStats(folderId: string) {
    const folderWorksheets = getWorksheetsInFolderView(workspace, folderId);
    const items = folderWorksheets.flatMap((worksheet) => worksheet.items);
    return {
      worksheetCount: folderWorksheets.length,
      price: items.reduce((sum, item) => sum + item.price, 0),
    };
  }

  function renderWorksheet(worksheet: WorkspaceWorksheet, depth: number) {
    if (!worksheetMatches(worksheet)) return null;
    const isActive = activeViewId === worksheet.id;
    const price = worksheet.items.reduce((sum, item) => sum + item.price, 0);
    return (
      <button
        key={worksheet.id}
        type="button"
        className={cn(
          "group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors",
          isActive ? "bg-accent/10 text-accent" : "text-fg/65 hover:bg-panel2/60 hover:text-fg",
        )}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => onSelectWorksheet(worksheet.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onOpenContextMenu(
            { type: "worksheet", id: worksheet.id, name: worksheet.name, folderId: worksheet.folderId ?? null },
            e.clientX,
            e.clientY,
          );
        }}
      >
        <span className="w-3.5 shrink-0" />
        <Table2 className="h-3.5 w-3.5 shrink-0 text-fg/35" />
        <span className="min-w-0 flex-1 truncate font-medium" title={worksheet.name}>{worksheet.name}</span>
        <span className="text-[10px] text-fg/30">{worksheet.items.length}</span>
        <span className="hidden text-[10px] tabular-nums text-fg/30 xl:inline">{formatMoney(price)}</span>
      </button>
    );
  }

  function renderFolder(folder: WorkspaceWorksheetFolder, depth: number): React.ReactNode {
    if (!folderMatches(folder)) return null;
    const isExpanded = expanded.has(folder.id);
    const isActive = activeViewId === folderViewId(folder.id);
    const childFolders = foldersByParent.get(folder.id) ?? [];
    const childWorksheets = worksheetsByFolder.get(folder.id) ?? [];
    const stats = folderStats(folder.id);
    return (
      <div key={folder.id}>
        <button
          type="button"
          className={cn(
            "group flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-xs transition-colors",
            isActive ? "bg-accent/10 text-accent" : "text-fg/70 hover:bg-panel2/60 hover:text-fg",
          )}
          style={{ paddingLeft: depth * 14 + 8 }}
          onClick={() => onSelectFolder(folder.id)}
          onDoubleClick={() => toggle(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            onOpenContextMenu(
              { type: "folder", id: folder.id, name: folder.name, parentId: folder.parentId ?? null },
              e.clientX,
              e.clientY,
            );
          }}
        >
          <span
            className="rounded p-0.5 text-fg/35 hover:bg-bg/60"
            onClick={(e) => {
              e.stopPropagation();
              toggle(folder.id);
            }}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          {isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
          <span className="text-[10px] text-fg/30">{stats.worksheetCount}</span>
          <span className="hidden text-[10px] tabular-nums text-fg/30 xl:inline">{formatMoney(stats.price)}</span>
        </button>
        {isExpanded && (
          <div>
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {childWorksheets.map((worksheet) => renderWorksheet(worksheet, depth + 1))}
            {childFolders.length === 0 && childWorksheets.length === 0 && !q && (
              <div className="px-2 py-1 text-[11px] italic text-fg/25" style={{ paddingLeft: (depth + 1) * 14 + 24 }}>
                Empty
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const rootFolders = foldersByParent.get(null) ?? [];
  const rootWorksheets = worksheetsByFolder.get(null) ?? [];

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-lg border border-line bg-panel/50">
      <div className="flex items-center gap-1 border-b border-line p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
          <Input
            className="h-7 pl-7 text-xs"
            placeholder="Search worksheets..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
          onClick={onCreateRootFolder}
          title="New root folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-fg/35 transition-colors hover:bg-panel2 hover:text-fg/70"
          onClick={onCreateRootWorksheet}
          title="New root worksheet"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        <button
          type="button"
          className={cn(
            "mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
            activeViewId === "all" ? "bg-accent/10 text-accent" : "text-fg/65 hover:bg-panel2/60 hover:text-fg",
          )}
          onClick={onSelectAll}
        >
          <Layers className="h-3.5 w-3.5" />
          <span className="min-w-0 flex-1 truncate font-medium">All worksheets</span>
          <span className="text-[10px] text-fg/30">{worksheets.length}</span>
        </button>
        {rootFolders.map((folder) => renderFolder(folder, 0))}
        {rootWorksheets.map((worksheet) => renderWorksheet(worksheet, 0))}
        {rootFolders.length === 0 && rootWorksheets.length === 0 && (
          <EmptyState className="mt-4">No worksheets yet.</EmptyState>
        )}
      </div>
    </aside>
  );
}

/* ─── GroupRows sub-component ─── */

function GroupRows({
  group,
  isCollapsed,
  onToggleCollapse,
  selectedRowId,
  onSelectRow,
  onContextMenu,
  renderEditableCell,
  renderUnitsCell,
  entityCategories,
  workspace,
  visibleColumns,
  isColVisible,
  visibleColumnCount,
  selectedIds,
  lineFactorsByItemId,
  factorTotalsById,
  displayLineItem,
  lineItemHasFactorAdjustment,
  onOpenLineFactors,
  onToggleSelectRow,
  onMoveUp,
  onMoveDown,
  detailItem,
  onOpenDetail,
  isPending,
}: {
  group: {
    category: string;
    catDef: EntityCategory | undefined;
    items: WorkspaceWorksheetItem[];
    totalPrice: number;
  };
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  selectedRowId: string | null;
  onSelectRow: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, rowId: string) => void;
  renderEditableCell: (
    row: WorkspaceWorksheetItem,
    column: EditableColumn,
    displayValue: React.ReactNode,
    className?: string
  ) => React.ReactNode;
  renderUnitsCell: (row: WorkspaceWorksheetItem) => React.ReactNode;
  entityCategories: EntityCategory[];
  workspace: ProjectWorkspaceData;
  visibleColumns: Set<ColumnId>;
  isColVisible: (col: ColumnId) => boolean;
  visibleColumnCount: number;
  selectedIds: Set<string>;
  lineFactorsByItemId: Map<string, EstimateFactor[]>;
  factorTotalsById: Map<string, ProjectWorkspaceData["estimate"]["totals"]["factorTotals"][number]>;
  displayLineItem: (item: WorkspaceWorksheetItem) => WorkspaceWorksheetItem;
  lineItemHasFactorAdjustment: (item: WorkspaceWorksheetItem) => boolean;
  onOpenLineFactors: (item: WorkspaceWorksheetItem) => void;
  onToggleSelectRow: (id: string) => void;
  onMoveUp: (row: WorkspaceWorksheetItem, groupItems: WorkspaceWorksheetItem[]) => void;
  onMoveDown: (row: WorkspaceWorksheetItem, groupItems: WorkspaceWorksheetItem[]) => void;
  detailItem: WorkspaceWorksheetItem | null;
  onOpenDetail: (item: WorkspaceWorksheetItem) => void;
  isPending: boolean;
	}) {
	  const catDef = group.catDef;
	  const isDraftGroup = group.category === "";

  /* Set of item IDs that have takeoff links */
  const linkedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const link of (workspace as any).takeoffLinks ?? []) {
      ids.add(link.worksheetItemId);
    }
    return ids;
  }, [(workspace as any).takeoffLinks]);

  return (
    <>
      {/* Category group header */}
	      <tr
	        className="bg-panel2/30 cursor-pointer hover:bg-panel2/50 transition-colors border-l-4"
	        style={{ borderLeftColor: catDef?.color ?? "#6b7280" }}
	        onClick={onToggleCollapse}
	      >
	        <td colSpan={visibleColumnCount} className="border-b border-line px-2 py-1.5">
	          <div className="flex items-center gap-2">
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-fg/40" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
            )}
	            {isDraftGroup ? (
	              <span className="text-[11px] font-medium text-fg/40">New row</span>
	            ) : (
	              <Badge
	                {...getCategoryBadgeProps(group.category, entityCategories)}
	              >
	                {group.category}
	              </Badge>
	            )}
            <span className="text-[11px] text-fg/40">
              {group.items.length} item{group.items.length !== 1 ? "s" : ""}
            </span>
            <span className="ml-auto text-xs font-medium tabular-nums text-fg/60">
              {formatMoney(group.totalPrice)}
            </span>
          </div>
        </td>
      </tr>
      {/* Items */}
      {!isCollapsed &&
        group.items.map((row, idx) => {
          const isTemporary = isTemporaryWorksheetItemId(row.id);
          const isSelected = selectedRowId === row.id;
          const isChecked = selectedIds.has(row.id);
          const isDetailOpen = detailItem?.id === row.id;
          const phase = (workspace.phases ?? []).find((p) => p.id === row.phaseId);
          const displayRow = displayLineItem(row);
          const hasFactorAdjustment = lineItemHasFactorAdjustment(row);
          const extCost = displayRow.cost * row.quantity;
          const margin = displayRow.price > 0 ? ((displayRow.price - extCost) / displayRow.price * 100).toFixed(1) + "%" : "--";

          return (
            <tr
              key={row.id}
              data-item-id={row.id}
              className={cn(
                "transition-colors border-l-2",
                isTemporary && "opacity-60",
                isDetailOpen
                  ? "bg-accent/10"
                  : isSelected
                  ? "bg-accent/5"
                  : "hover:bg-panel2/15"
              )}
              style={{ borderLeftColor: (catDef?.color ?? "#6b7280") + "40" }}
              onClick={() => onSelectRow(row.id)}
              onContextMenu={(e) => onContextMenu(e, row.id)}
            >
              {/* Expand button */}
              {isColVisible("expand") && (
                <td className="border-b border-line px-1 py-2 text-center">
                  <button
                    className={cn(
                      "p-0.5 rounded hover:bg-panel2/60 transition-colors",
                      isDetailOpen ? "text-accent" : "text-fg/25 hover:text-fg/50"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isTemporary) {
                        onOpenDetail(row);
                      }
                    }}
                    title="Open detail"
                    disabled={isTemporary}
                  >
                    <Maximize2 className="h-3 w-3" />
                  </button>
                </td>
              )}

              {/* Checkbox */}
              {isColVisible("checkbox") && (
                <td className="border-b border-line px-1 py-2 text-center">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-line accent-accent cursor-pointer"
                    checked={isChecked}
                    disabled={isTemporary}
                    onChange={(e) => {
                      e.stopPropagation();
                      onToggleSelectRow(row.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </td>
              )}

              {/* Reorder arrows */}
              {isColVisible("reorder") && (
                <td className="border-b border-line px-0.5 py-1 text-center">
                  <div className="flex items-center gap-0">
                    <button
                      className={cn(
                        "p-0.5 rounded transition-colors",
                        idx === 0 || isTemporary
                          ? "text-fg/10 cursor-not-allowed"
                          : "text-fg/30 hover:text-fg/60 hover:bg-panel2/60"
                      )}
                      disabled={idx === 0 || isPending || isTemporary}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveUp(row, group.items);
                      }}
                      title="Move up"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      className={cn(
                        "p-0.5 rounded transition-colors",
                        idx === group.items.length - 1 || isTemporary
                          ? "text-fg/10 cursor-not-allowed"
                          : "text-fg/30 hover:text-fg/60 hover:bg-panel2/60"
                      )}
                      disabled={idx === group.items.length - 1 || isPending || isTemporary}
                      onClick={(e) => {
                        e.stopPropagation();
                        onMoveDown(row, group.items);
                      }}
                      title="Move down"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                </td>
              )}

              {/* Row number */}
              {isColVisible("lineOrder") && (
                <td className="border-b border-line px-2 py-2 text-[10px] text-fg/25 tabular-nums">
                  {idx + 1}
                </td>
              )}

              {/* Line Item Name (with dropdown) */}
              {isColVisible("entityName") &&
                renderEditableCell(row, "entityName", <span className="block truncate">{row.entityName}</span>)}

              {/* Vendor */}
              {isColVisible("vendor") &&
                renderEditableCell(row, "vendor", <span className="block truncate">{row.vendor ?? ""}</span>)}

              {/* Description */}
              {isColVisible("description") &&
                renderEditableCell(
                  row,
                  "description",
                  row.description
                    ? <span className="block truncate">{row.description}</span>
                    : <span className="text-fg/20 italic">Add description...</span>,
                )}

              {/* Quantity */}
              {isColVisible("quantity") &&
                renderEditableCell(
                  row,
                  "quantity",
                  <span className="tabular-nums inline-flex items-center gap-1">
                    {linkedItemIds.has(row.id) && (
                      <span title="Linked to takeoff mark">
                        <Link2 className="h-3 w-3 text-accent/60 shrink-0" />
                      </span>
                    )}
                    {row.quantity}
                    {visibleColumns.has("uom") && !isColVisible("uom") && <span className="text-[10px] text-fg/35">{row.uom}</span>}
                  </span>,
                  "text-right"
                )}

              {/* UOM */}
              {isColVisible("uom") &&
                renderEditableCell(row, "uom", row.uom, "text-center")}

              {isColVisible("factors") && (
                <td className="border-b border-line px-1 py-1 text-center">
                  <button
                    className={cn(
                      "inline-flex h-5 max-w-full items-center justify-center gap-0.5 rounded border px-1 text-[10px] leading-none transition-colors",
                      (lineFactorsByItemId.get(row.id)?.length ?? 0) > 0
                        ? "border-accent/35 bg-accent/10 text-accent"
                        : "border-line bg-bg/45 text-fg/45 hover:border-accent/35 hover:text-accent",
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenLineFactors(row);
                    }}
                    title="Line factors"
                  >
                    <Zap className="h-2.5 w-2.5" />
                    <span>{lineFactorsByItemId.get(row.id)?.length ?? 0}</span>
                    {lineFactorsByItemId.get(row.id)?.some((factor) => (factorTotalsById.get(factor.id)?.valueDelta ?? 0) !== 0) ? (
                      <span className="max-w-[40px] truncate text-[9px] text-fg/45">
                        {formatMoney(lineFactorsByItemId.get(row.id)?.reduce((sum, factor) => sum + (factorTotalsById.get(factor.id)?.valueDelta ?? 0), 0) ?? 0)}
                      </span>
                    ) : null}
                  </button>
                </td>
              )}

              {/* Combined units column */}
              {isColVisible("units") && renderUnitsCell(row)}

              {/* Cost */}
              {isColVisible("cost") &&
                renderEditableCell(
                  row,
                  "cost",
                  <span className="block tabular-nums">
                    {formatMoney(displayRow.cost, 2)}
                    {visibleColumns.has("extCost") && !isColVisible("extCost") && (
                      <span className="block text-[10px] text-fg/35">{formatMoney(extCost, 2)} ext</span>
                    )}
                  </span>,
                  "text-right"
                )}

              {/* Ext. Cost (read-only) */}
              {isColVisible("extCost") && (
                <td className="border-b border-line px-2 py-2 text-xs text-right tabular-nums text-fg/60">
                  {formatMoney(extCost, 2)}
                </td>
              )}

              {/* Markup */}
              {isColVisible("markup") &&
                renderEditableCell(
                  row,
                  "markup",
                  <span className="tabular-nums">{formatPercent(row.markup)}</span>,
                  "text-right"
                )}

              {/* Price */}
              {isColVisible("price") &&
                renderEditableCell(
                  row,
                  "price",
                  <span
                    className={cn(
                      "inline-flex h-5 max-w-full items-center justify-end rounded-md px-1.5 tabular-nums font-medium leading-none",
                      hasFactorAdjustment && "border border-accent/35 bg-accent/10 text-accent",
                    )}
                    title={hasFactorAdjustment ? `Raw ${formatMoney(row.price)} / factor-adjusted ${formatMoney(displayRow.price)}` : undefined}
                  >
                    <span>{formatMoney(displayRow.price)}</span>
                    {visibleColumns.has("markup") && !isColVisible("markup") && (
                      <span className="block text-[10px] font-normal text-fg/35">{formatPercent(row.markup)} mkup</span>
                    )}
                    {visibleColumns.has("margin") && !isColVisible("margin") && (
                      <span className="block text-[10px] font-normal text-fg/35">{margin}</span>
                    )}
                  </span>,
                  "text-right"
                )}

              {/* Margin (read-only) */}
              {isColVisible("margin") && (
                <td className="border-b border-line px-2 py-2 text-xs text-right tabular-nums text-fg/60">
                  {margin}
                </td>
              )}

              {/* Phase */}
              {isColVisible("phaseId") &&
                renderEditableCell(
                  row,
                  "phaseId",
                  phase ? (
                    <span className="text-fg/60 truncate block max-w-[72px]" title={estimatePhaseLabel(phase)}>{estimatePhaseLabel(phase)}</span>
                  ) : (
                    <span className="text-fg/20">--</span>
                  ),
                  "text-left"
                )}

              {/* Actions */}
              {isColVisible("actions") && (
                <td className="border-b border-line px-1 py-2 text-center">
                  <button
                    className="p-1 rounded hover:bg-panel2/60 text-fg/30 hover:text-fg/60 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onContextMenu(e, row.id);
                    }}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </td>
              )}
            </tr>
          );
        })}
    </>
  );
}

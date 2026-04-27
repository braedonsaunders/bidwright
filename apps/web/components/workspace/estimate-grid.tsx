"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Columns,
  Copy,
  Download,
  GripVertical,
  Layers,
  Maximize2,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Trash2,
  X,
  Link2,
} from "lucide-react";
import type {
  CatalogItem,
  CatalogSummary,
  CreateWorksheetItemInput,
  EntityCategory,
  ProjectWorkspaceData,
  WorksheetItemPatchInput,
  WorkspaceResponse,
  WorkspaceWorksheet,
  WorkspaceWorksheetItem,
} from "@/lib/api";
import {
  createWorksheet,
  createWorksheetItem,
  createWorksheetItemFast,
  deleteWorksheet,
  deleteWorksheetItem,
  deleteWorksheetItemFast,
  getEntityCategories,
  updateWorksheet,
  updateWorksheetItem,
  updateWorksheetItemFast,
} from "@/lib/api";
import { formatMoney, formatPercent } from "@/lib/format";
import {
  getWorksheetHourBreakdown,
  getWorksheetUnitSlotLabels,
  mapLegacyUnitsToTierUnits,
} from "@/lib/worksheet-hours";
import {
  categoryAllowsEditingUnitSlot,
  categoryUsesTieredUnits,
} from "@/lib/entity-category-calculation";
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
import { AssemblyInstancesModal } from "./assembly-instances-modal";

/* ─── Types ─── */

export interface EstimateGridProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse | ((prev: WorkspaceResponse) => WorkspaceResponse)) => void;
  onError: (msg: string) => void;
  onRefresh: () => void;
  highlightItemId?: string;
  activeWorksheetId?: WorksheetTabId;
  onActiveWorksheetChange?: (worksheetId: WorksheetTabId) => void;
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
} | null;

type SortDirection = "asc" | "desc";
type SortState = { column: ColumnId; direction: SortDirection } | null;

type WorksheetTabId = string | "all";

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

/** Fallback badge tones when no dynamic category color is available */
const CATEGORY_COLORS_FALLBACK: Record<string, string> = {
  Labour: "info",
  Equipment: "warning",
  Material: "success",
  Consumables: "default",
  "Stock Items": "default",
  "Other Charges": "danger",
  "Travel & Per Diem": "warning",
  Subcontractors: "info",
  "Rental Equipment": "warning",
};

/** Resolve badge tone from entity categories state, falling back to hardcoded map */
function getCategoryBadgeTone(
  categoryName: string,
  entityCategories: EntityCategory[]
): "default" | "success" | "warning" | "danger" | "info" {
  const catDef = entityCategories.find((c) => c.name === categoryName);
  if (catDef?.color) {
    // Map common hex colors to badge tones
    const hex = catDef.color.toLowerCase();
    if (hex.includes("22c55e") || hex.includes("10b981") || hex.includes("16a34a")) return "success";
    if (hex.includes("f59e0b") || hex.includes("eab308") || hex.includes("d97706")) return "warning";
    if (hex.includes("ef4444") || hex.includes("dc2626") || hex.includes("f43f5e")) return "danger";
    if (hex.includes("3b82f6") || hex.includes("6366f1") || hex.includes("0ea5e9")) return "info";
  }
  return (CATEGORY_COLORS_FALLBACK[categoryName] ?? "default") as "default" | "success" | "warning" | "danger" | "info";
}

/** Get the hex color for a category (for inline style borders) */
function getCategoryHexColor(
  categoryName: string,
  entityCategories: EntityCategory[]
): string {
  const catDef = entityCategories.find((c) => c.name === categoryName);
  return catDef?.color ?? "#6b7280";
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
  expand: "Expand",
  checkbox: "Select",
  reorder: "Reorder",
  lineOrder: "#",
  entityName: "Entity Name",
  vendor: "Vendor",
  description: "Description",
  quantity: "Qty",
  uom: "UOM",
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
  "units",
  "cost",
  "extCost",
  "markup",
  "price",
  "margin",
  "phaseId",
];

const ENTITY_DROPDOWN_WIDTH = 320;
const ENTITY_DROPDOWN_GAP = 4;
const ENTITY_DROPDOWN_MARGIN = 8;
const ENTITY_DROPDOWN_HEADER_HEIGHT = 44;
const ENTITY_DROPDOWN_PREFERRED_LIST_HEIGHT = 256;
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

function findCategoryForRow(
  row: WorkspaceWorksheetItem,
  categories: EntityCategory[]
): EntityCategory | undefined {
  return categories.find((c) => c.name === row.category);
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
    return !categoryAllowsEditingUnitSlot(category, column);
  }
  const fieldMap: Record<string, keyof EntityCategory["editableFields"]> = {
    quantity: "quantity",
    cost: "cost",
    markup: "markup",
    price: "price",
    unit1: "unit1",
    unit2: "unit2",
    unit3: "unit3",
  };
  const field = fieldMap[column];
  if (!field) return false;
  return !category.editableFields[field];
}

function getLaborColumnLabel(
  column: "unit1" | "unit2" | "unit3",
  category: EntityCategory | undefined
): string {
  if (!category) {
    return column === "unit1" ? "Unit 1" : column === "unit2" ? "Unit 2" : "Unit 3";
  }
  const map = { unit1: "unit1", unit2: "unit2", unit3: "unit3" } as const;
  const label = category.unitLabels[map[column]];
  return label || (column === "unit1" ? "Unit 1" : column === "unit2" ? "Unit 2" : "Unit 3");
}

/** Entity option item with optional pricing data from catalog */
interface EntityOptionItem {
  label: string;
  value: string;
  unitCost?: number;
  unitPrice?: number;
  unit?: string;
  description?: string;
  rateScheduleItemId?: string;
  itemId?: string;
}

/** Build entity dropdown options grouped by category */
function buildEntityOptions(
  workspace: ProjectWorkspaceData,
  categories: EntityCategory[]
): Array<{
  categoryName: string;
  categoryId: string;
  entityType: string;
  defaultUom: string;
  items: EntityOptionItem[];
}> {
  const groups: Array<{
    categoryName: string;
    categoryId: string;
    entityType: string;
    defaultUom: string;
    items: EntityOptionItem[];
  }> = [];

  for (const cat of categories) {
    const items: EntityOptionItem[] = [];
    const itemSource = cat.itemSource || "freeform";

    switch (itemSource) {
      case "rate_schedule": {
        // Pull items from revision-scoped rate schedules
        const catKey = cat.entityType.toLowerCase();
        for (const sched of workspace.rateSchedules ?? []) {
          if (sched.category === catKey || sched.category === "general") {
            for (const rsItem of sched.items ?? []) {
              const firstTier = sched.tiers?.[0];
              const rate = firstTier ? (rsItem.rates[firstTier.id] ?? 0) : 0;
              if (!items.some((i) => i.rateScheduleItemId === rsItem.id)) {
                items.push({
                  label: `${rsItem.name}${rsItem.code ? ` (${rsItem.code})` : ""}`,
                  value: rsItem.name,
                  unitCost: rate,
                  unit: rsItem.unit,
                  rateScheduleItemId: rsItem.id,
                });
              }
            }
          }
        }
        // Also include matching catalog items as fallback
        for (const catalog of workspace.catalogs ?? []) {
          if (catalog.kind === catKey || catalog.kind === "labor") {
            for (const ci of catalog.items ?? []) {
              if (!items.some((i) => i.value === ci.name)) {
                items.push({ label: ci.name, value: ci.name, unitCost: ci.unitCost, unitPrice: ci.unitPrice, unit: ci.unit, itemId: ci.id });
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
        // Pull items from catalogs — filter by catalogId if set, otherwise by kind matching entityType
        const catKey = cat.entityType.toLowerCase();
        for (const catalog of workspace.catalogs ?? []) {
          if (cat.catalogId ? catalog.id === cat.catalogId : (catalog.kind === catKey || catalog.kind === "equipment" || catalog.kind === "materials")) {
            for (const ci of catalog.items ?? []) {
              items.push({ label: ci.name, value: ci.name, unitCost: ci.unitCost, unitPrice: ci.unitPrice, unit: ci.unit, itemId: ci.id });
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
        items.push({ label: cat.name, value: cat.name });
        break;
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
  preserveOrder = false
): Array<{
  category: string;
  catDef: EntityCategory | undefined;
  items: WorkspaceWorksheetItem[];
  totalPrice: number;
}> {
  const catOrder = categories.map((c) => c.name);
  const grouped: Record<string, WorkspaceWorksheetItem[]> = {};

  for (const row of rows) {
    const cat = row.category || "Uncategorized";
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
        totalPrice: items.reduce((s, r) => s + r.price, 0),
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
      totalPrice: sorted.reduce((s, r) => s + r.price, 0),
    });
  }

  return result;
}

/** Map catalog kind to category name */
function catalogKindToCategory(kind: string): string {
  switch (kind) {
    case "labor":
      return "Labour";
    case "equipment":
      return "Equipment";
    case "materials":
      return "Material";
    default:
      return "Material";
  }
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
}: EstimateGridProps) {
  const [isPending, startTransition] = useTransition();

  // Entity categories loaded from API
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);

  // Tab state
  const [activeTab, setActiveTabState] = useState<WorksheetTabId>(
    activeWorksheetId ?? workspace.worksheets[0]?.id ?? "all"
  );
  const setActiveTab = useCallback((nextTab: WorksheetTabId) => {
    setActiveTabState(nextTab);
    onActiveWorksheetChange?.(nextTab);
  }, [onActiveWorksheetChange]);

  useEffect(() => {
    if (!activeWorksheetId || activeWorksheetId === activeTab) return;
    setActiveTabState(activeWorksheetId);
  }, [activeTab, activeWorksheetId]);

  // Editing state
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  // Entity dropdown state
  const [entityDropdownRowId, setEntityDropdownRowId] = useState<string | null>(null);
  const [entitySearchTerm, setEntitySearchTerm] = useState("");
  const entitySearchRef = useRef<HTMLInputElement | null>(null);
  const [entityDropdownPos, setEntityDropdownPos] = useState<EntityDropdownPosition>(null);
  const entityCellRef = useRef<HTMLTableCellElement | null>(null);
  const entityDropdownRef = useRef<HTMLDivElement | null>(null);

  // Scroll to highlighted item from global search
  useEffect(() => {
    if (!highlightItemId) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-item-id="${highlightItemId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-accent/50", "bg-accent/10");
        setTimeout(() => el.classList.remove("ring-2", "ring-accent/50", "bg-accent/10"), 2500);
      }
    });
  }, [highlightItemId]);

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
  const [renameWsId, setRenameWsId] = useState<string | null>(null);
  const [renameWsName, setRenameWsName] = useState("");


  // Selected row
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // Collapsed category groups
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Inline tab rename
  const [inlineRenameWsId, setInlineRenameWsId] = useState<string | null>(null);
  const [inlineRenameName, setInlineRenameName] = useState("");
  const inlineRenameRef = useRef<HTMLInputElement | null>(null);
  const tabScrollRef = useRef<HTMLDivElement | null>(null);
  const [tabOverflow, setTabOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  // ─── NEW STATE: Detail Drawer ───
  const [detailItem, setDetailItem] = useState<WorkspaceWorksheetItem | null>(null);

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

  // ─── NEW STATE: Catalog Quick-Add ───
  const [showCatalogPicker, setShowCatalogPicker] = useState(false);
  const [catalogSearchTerm, setCatalogSearchTerm] = useState("");
  const [selectedCatalogItemIds, setSelectedCatalogItemIds] = useState<Set<string>>(new Set());

  // ─── NEW STATE: Assembly insert ───
  const [showAssemblyPicker, setShowAssemblyPicker] = useState(false);
  const [showSaveAsAssembly, setShowSaveAsAssembly] = useState(false);
  const [showAssemblyInstances, setShowAssemblyInstances] = useState(false);

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
      category: payload.category,
      entityType: payload.entityType,
      entityName: payload.entityName,
      vendor: payload.vendor ?? undefined,
      description: payload.description,
      quantity: payload.quantity,
      uom: payload.uom,
      cost: payload.cost,
      markup: payload.markup,
      price: payload.price,
      unit1: payload.unit1,
      unit2: payload.unit2,
      unit3: payload.unit3,
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

  const removeItem = useCallback((
    itemId: string,
    fallbackMessage = "Delete failed.",
  ) => {
    if (isTemporaryWorksheetItemId(itemId)) {
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
    const preferredHeight = ENTITY_DROPDOWN_HEADER_HEIGHT + ENTITY_DROPDOWN_PREFERRED_LIST_HEIGHT;
    const spaceBelow = Math.max(
      0,
      viewportHeight - rect.bottom - ENTITY_DROPDOWN_GAP - ENTITY_DROPDOWN_MARGIN
    );
    const spaceAbove = Math.max(0, rect.top - ENTITY_DROPDOWN_GAP - ENTITY_DROPDOWN_MARGIN);
    const openAbove = spaceBelow < preferredHeight && spaceAbove > spaceBelow;
    const availableHeight = openAbove ? spaceAbove : spaceBelow;
    const maxHeight =
      availableHeight > ENTITY_DROPDOWN_HEADER_HEIGHT
        ? Math.min(preferredHeight, availableHeight)
        : availableHeight;
    const listMaxHeight = Math.max(
      0,
      maxHeight - ENTITY_DROPDOWN_HEADER_HEIGHT
    );
    const maxLeft = Math.max(
      ENTITY_DROPDOWN_MARGIN,
      viewportWidth - dropdownWidth - ENTITY_DROPDOWN_MARGIN
    );
    const left = Math.min(Math.max(rect.left, ENTITY_DROPDOWN_MARGIN), maxLeft);

    setEntityDropdownPos({
      left,
      top: openAbove ? undefined : rect.bottom + ENTITY_DROPDOWN_GAP,
      bottom: openAbove ? viewportHeight - rect.top + ENTITY_DROPDOWN_GAP : undefined,
      maxHeight,
      listMaxHeight,
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
    if (activeTab !== "all" && !findWs(workspace, activeTab)) {
      setActiveTab(workspace.worksheets[0]?.id ?? "all");
    }
  }, [workspace.worksheets, activeTab]);

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

  // Entity dropdown options
  const entityOptions = useMemo(
    () => buildEntityOptions(workspace, entityCategories),
    [workspace, entityCategories]
  );

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
    const hasLabourOrUnit1 = activeCatDefs.some((c) => categoryUsesTieredUnits(c) || c.editableFields.unit1);
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
    (row: WorkspaceWorksheetItem) => getWorksheetHourBreakdown(row, workspace.rateSchedules),
    [workspace.rateSchedules],
  );

  const getRowUnitSlotLabels = useCallback(
    (row: WorkspaceWorksheetItem, category: EntityCategory | undefined) =>
      getWorksheetUnitSlotLabels(row, workspace.rateSchedules, category?.unitLabels),
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

  // Get visible rows
  const visibleRows = useMemo(() => {
    let rows: WorkspaceWorksheetItem[];

    if (activeTab === "all") {
      rows = (workspace.worksheets ?? []).flatMap((w) => w.items);
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
          case "unit1": aVal = getRowHourBreakdown(a).unit1; bVal = getRowHourBreakdown(b).unit1; break;
          case "unit2": aVal = getRowHourBreakdown(a).unit2; bVal = getRowHourBreakdown(b).unit2; break;
          case "unit3": aVal = getRowHourBreakdown(a).unit3; bVal = getRowHourBreakdown(b).unit3; break;
          case "cost": aVal = a.cost; bVal = b.cost; break;
          case "markup": aVal = a.markup; bVal = b.markup; break;
          case "price": aVal = a.price; bVal = b.price; break;
          case "extCost": aVal = a.cost * a.quantity; bVal = b.cost * b.quantity; break;
          case "margin": {
            const aExt = a.cost * a.quantity;
            const bExt = b.cost * b.quantity;
            aVal = a.price > 0 ? (a.price - aExt) / a.price : 0;
            bVal = b.price > 0 ? (b.price - bExt) / b.price : 0;
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
  }, [categoryFilter, phaseFilter, activeTab, workspace.worksheets, sortState, getRowHourBreakdown]);

  // Grouped rows
  const groupedRows = useMemo(
    () => groupRowsByCategory(visibleRows, entityCategories, sortState !== null),
    [visibleRows, entityCategories, sortState]
  );

  // Totals
  const totals = useMemo(() => {
    return {
      cost: visibleRows.reduce((sum, r) => sum + r.cost * r.quantity, 0),
      price: visibleRows.reduce((sum, r) => sum + r.price, 0),
      regHrs: visibleRows.reduce((sum, r) => sum + getRowHourBreakdown(r).unit1 * r.quantity, 0),
      otHrs: visibleRows.reduce((sum, r) => sum + getRowHourBreakdown(r).unit2 * r.quantity, 0),
      dtHrs: visibleRows.reduce((sum, r) => sum + getRowHourBreakdown(r).unit3 * r.quantity, 0),
      count: visibleRows.length,
    };
  }, [visibleRows, getRowHourBreakdown]);

  // All catalog items flattened (for catalog quick-add)
  const allCatalogItems = useMemo(() => {
    const items: Array<CatalogItem & { catalogKind: string; catalogName: string }> = [];
    for (const catalog of workspace.catalogs ?? []) {
      for (const ci of catalog.items ?? []) {
        items.push({ ...ci, catalogKind: catalog.kind, catalogName: catalog.name });
      }
    }
    return items;
  }, [workspace.catalogs]);

  // Filtered catalog items for picker
  const filteredCatalogItems = useMemo(() => {
    const q = catalogSearchTerm.trim().toLowerCase();
    if (!q) return allCatalogItems;
    return allCatalogItems.filter(
      (ci) =>
        ci.name.toLowerCase().includes(q) ||
        ci.code.toLowerCase().includes(q) ||
        ci.catalogName.toLowerCase().includes(q)
    );
  }, [allCatalogItems, catalogSearchTerm]);

  // Helper to check if a column is visible
  // Checkbox column only appears when items are selected (bulk mode)
  const isColVisible = useCallback(
    (col: ColumnId) => {
      if (col === "checkbox") return selectedIds.size > 0;
      return visibleColumns.has(col);
    },
    [visibleColumns, selectedIds.size]
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

  // ─── Cell editing ───

  function startEditing(rowId: string, column: EditableColumn, currentValue: string | number) {
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;
    if (isTemporaryWorksheetItemId(row.id)) return;

    const catDef = findCategoryForRow(row, entityCategories);
    if (isCellDisabledByCategory(catDef, column)) return;

    // Entity name uses the dropdown instead
    if (column === "entityName") {
      setEntityDropdownRowId(rowId);
      setEntitySearchTerm("");
      return;
    }

    let val: string;
    if (column === "markup") {
      val = fmtPct(currentValue as number);
    } else {
      val = String(currentValue ?? "");
    }

    setEditingCell({ rowId, column });
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
        const nextUnits = {
          ...getRowHourBreakdown(row),
          [column]: numVal,
        };

        patch = {
          [column]: numVal,
          ...(row.rateScheduleItemId || Object.keys(row.tierUnits ?? {}).length > 0
            ? {
                tierUnits: mapLegacyUnitsToTierUnits(
                  row,
                  workspace.rateSchedules,
                  {
                    unit1: nextUnits.unit1,
                    unit2: nextUnits.unit2,
                    unit3: nextUnits.unit3,
                  },
                ),
              }
            : {}),
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

  function handleCellKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (editingCell) {
        const { rowId, column } = editingCell;
        commitEdit();
        // Move down to same column in next row
        const rowIdx = visibleRows.findIndex((r) => r.id === rowId);
        if (rowIdx >= 0 && rowIdx < visibleRows.length - 1) {
          const nextRow = visibleRows[rowIdx + 1];
          const rawVal = getEditableValue(nextRow, column);
          setTimeout(() => startEditing(nextRow.id, column, rawVal as string | number), 0);
        }
      }
    } else if (e.key === "Escape") {
      cancelEdit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (editingCell) {
        const { rowId, column } = editingCell;
        commitEdit();
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
    /** Optional auto-populate fields from catalog item */
    catalogData?: { cost?: number; uom?: string; description?: string },
    /** Optional rate schedule item ID to link */
    rateScheduleItemId?: string,
    /** Optional catalog item ID to link */
    itemId?: string,
  ) {
    setEntityDropdownRowId(null);
    setEntityDropdownPos(null);
    setEntitySearchTerm("");

    const row = visibleRows.find((r) => r.id === rowId);
    const newCatDef = entityCategories.find((c) => c.name === categoryName);
    const oldCategory = row?.category;
    const categoryChanged = oldCategory !== categoryName;

    // Build patch with the basic entity fields
    const patch: Record<string, unknown> = {
      entityName,
      category: categoryName,
      entityType,
      uom: catalogData?.uom ?? defaultUom,
    };

    // Auto-populate from catalog item if provided
    if (catalogData?.cost !== undefined) {
      patch.cost = catalogData.cost;
    }
    if (catalogData?.description) {
      patch.description = catalogData.description;
    }

    // Link to catalog item if provided
    if (itemId) {
      patch.itemId = itemId;
    } else if (categoryChanged) {
      patch.itemId = null;
    }

    // Link to rate schedule item if provided
    if (rateScheduleItemId) {
      patch.rateScheduleItemId = rateScheduleItemId;
      // Initialize tier hours from revision's rate schedules
      const schedule = (workspace.rateSchedules ?? []).find((s) =>
        s.items.some((i) => i.id === rateScheduleItemId),
      );
      if (schedule) {
        const tierUnits: Record<string, number> = {};
        for (const tier of schedule.tiers) {
          tierUnits[tier.id] = 0;
        }
        patch.tierUnits = tierUnits;
      }
    } else if (categoryChanged) {
      // Clear rate schedule link when category changes
      patch.rateScheduleItemId = null;
      patch.tierUnits = {};
    }

    // Category Change Reset: when switching categories, reset fields
    // based on new category's editableFields
    if (categoryChanged && newCatDef) {
      // Reset UOM to the new category's default
      patch.uom = catalogData?.uom ?? newCatDef.defaultUom;

      // Clear computed fields that are non-editable in the new category
      if (isCellDisabledByCategory(newCatDef, "unit1")) patch.unit1 = 0;
      if (isCellDisabledByCategory(newCatDef, "unit2")) patch.unit2 = 0;
      if (isCellDisabledByCategory(newCatDef, "unit3")) patch.unit3 = 0;
      if (isCellDisabledByCategory(newCatDef, "cost")) patch.cost = catalogData?.cost ?? 0;
      if (isCellDisabledByCategory(newCatDef, "markup")) patch.markup = workspace.currentRevision.defaultMarkup ?? 0.2;
      if (isCellDisabledByCategory(newCatDef, "price")) patch.price = 0;
    }

    commitItemPatch(rowId, patch as WorksheetItemPatchInput);
  }

  // ─── Row operations ───

  function addNewItem(categoryOverride?: string) {
    const wsId = activeTab !== "all" ? activeTab : workspace.worksheets[0]?.id;
    if (!wsId) return;

    const ws = findWs(workspace, wsId);
    if (!ws) return;

    const catName = categoryOverride ?? "Material";
    const catDef = entityCategories.find((c) => c.name === catName);

    const payload: CreateWorksheetItemInput = {
      category: catName,
      entityType: catDef?.entityType ?? "Material",
      entityName: "New Item",
      description: "",
      quantity: 1,
      uom: catDef?.defaultUom ?? "EA",
      cost: 0,
      markup: workspace.currentRevision.defaultMarkup ?? 0.2,
      price: 0,
      unit1: 0,
      unit2: 0,
      unit3: 0,
    };

    createItem(wsId, payload);
  }

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
      category: row.category,
      entityType: row.entityType,
      entityName: row.entityName,
      vendor: row.vendor ?? null,
      description: row.description,
      quantity: row.quantity,
      uom: row.uom,
      cost: row.cost,
      markup: row.markup,
      price: row.price,
      unit1: row.unit1,
      unit2: row.unit2,
      unit3: row.unit3,
      lineOrder: row.lineOrder + 1,
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
            category: row.category,
            entityType: row.entityType,
            entityName: row.entityName,
            vendor: row.vendor ?? null,
            description: row.description,
            quantity: row.quantity,
            uom: row.uom,
            cost: row.cost,
            markup: row.markup,
            price: row.price,
            unit1: row.unit1,
            unit2: row.unit2,
            unit3: row.unit3,
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

  // ─── Catalog Quick-Add ───

  function handleAddFromCatalog() {
    const wsId = activeTab !== "all" ? activeTab : workspace.worksheets[0]?.id;
    if (!wsId) return;

    const selected = allCatalogItems.filter((ci) => selectedCatalogItemIds.has(ci.id));
    if (selected.length === 0) return;

    startTransition(async () => {
      try {
        let last: WorkspaceResponse | null = null;
        for (const ci of selected) {
          const catName = catalogKindToCategory(ci.catalogKind);
          const catDef = entityCategories.find((c) => c.name === catName);

          const payload: CreateWorksheetItemInput = {
            category: catName,
            entityType: catDef?.entityType ?? "Material",
            entityName: ci.name,
            description: "",
            quantity: 1,
            uom: ci.unit,
            cost: ci.unitCost,
            markup: workspace.currentRevision.defaultMarkup ?? 0.2,
            price: ci.unitPrice,
            unit1: 0,
            unit2: 0,
            unit3: 0,
          };

          last = await createWorksheetItem(workspace.project.id, wsId, payload);
        }
        if (last) onApply(last);
        setShowCatalogPicker(false);
        setSelectedCatalogItemIds(new Set());
        setCatalogSearchTerm("");
      } catch (e) {
        onError(e instanceof Error ? e.message : "Add from catalog failed.");
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
      phase ? `Phase: ${phase.number} - ${phase.name}` : "",
    ].filter(Boolean).join("\t");
    navigator.clipboard.writeText(text);
  }

  function exportTableAsCsv() {
    const headers = ["#", "Category", "Entity Name", "Vendor", "Description", "Qty", "UOM", "Cost", "Ext. Cost", "Markup", "Price", "Margin", "Phase"];
    const csvRows = [headers.join(",")];

    for (const row of visibleRows) {
      const extCost = row.cost * row.quantity;
      const margin = row.price > 0 ? ((row.price - extCost) / row.price * 100).toFixed(1) : "0";
      const phase = (workspace.phases ?? []).find((p) => p.id === row.phaseId);
      const cells = [
        row.lineOrder,
        `"${row.category}"`,
        `"${row.entityName.replace(/"/g, '""')}"`,
        `"${(row.vendor ?? "").replace(/"/g, '""')}"`,
        `"${row.description.replace(/"/g, '""')}"`,
        row.quantity,
        row.uom,
        row.cost.toFixed(2),
        extCost.toFixed(2),
        `${(row.markup * 100).toFixed(1)}%`,
        row.price.toFixed(2),
        `${margin}%`,
        phase ? `"${phase.number} - ${phase.name}"` : "",
      ];
      csvRows.push(cells.join(","));
    }

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estimate-${workspace.project.name.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      if (entityDropdownRowId) {
        setEntityDropdownRowId(null);
        setEntityDropdownPos(null);
      }
    }
    if (contextMenu || tabMenu || entityDropdownRowId) {
      const timer = setTimeout(() => {
        document.addEventListener("click", close);
      }, 0);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("click", close);
      };
    }
  }, [contextMenu, tabMenu, entityDropdownRowId]);

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
        const next = await createWorksheet(workspace.project.id, { name: newWsName.trim() });
        onApply(next);
        const ws = next.workspace.worksheets.at(-1);
        if (ws) setActiveTab(ws.id);
        setShowNewWsModal(false);
        setNewWsName("");
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
    if (workspace.worksheets.length <= 1) return;
    startTransition(async () => {
      try {
        const next = await deleteWorksheet(workspace.project.id, wsId);
        onApply(next);
        setActiveTab(next.workspace.worksheets[0]?.id ?? "all");
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  function handleTabContextMenu(e: React.MouseEvent, wsId: string) {
    e.preventDefault();
    setTabMenu({ wsId, x: e.clientX, y: e.clientY });
  }

  // ─── Description click → open detail drawer ───

  function handleDescClick(rowId: string) {
    if (isTemporaryWorksheetItemId(rowId)) return;
    const allItems = (workspace.worksheets ?? []).flatMap((w: { items: WorkspaceWorksheetItem[] }) => w.items);
    const item = allItems.find((i: WorkspaceWorksheetItem) => i.id === rowId);
    if (item) setDetailItem(item);
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

      const valueDisplay = value || <span className="text-fg/20">-</span>;

      if (disabled) {
        return (
          <span
            key={field}
            className="tabular-nums text-xs text-fg/30 italic px-1"
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
      if (column === "uom") {
        const validUoms = catDef?.validUoms ?? ["EA", "LF", "FT", "SF", "HR", "DAY", "WK", "MO", "LS"];
        return (
          <td className={cn("border-b border-line px-1 py-0.5", className)}>
            <select
              ref={(el) => { editInputRef.current = el; }}
              className="h-7 w-full rounded border border-accent/50 bg-bg px-1 text-xs outline-none"
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value);
                const val = e.target.value;
                setEditingCell(null);
                commitItemPatch(row.id, { uom: val });
              }}
              onBlur={commitEdit}
              onKeyDown={handleCellKeyDown}
            >
              {validUoms.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </td>
        );
      }

      if (column === "phaseId") {
        return (
          <td className={cn("border-b border-line px-1 py-0.5", className)}>
            <select
              ref={(el) => { editInputRef.current = el; }}
              className="h-7 w-full rounded border border-accent/50 bg-bg px-1 text-xs outline-none"
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value);
                const val = e.target.value || null;
                setEditingCell(null);
                commitItemPatch(row.id, { phaseId: val });
              }}
              onBlur={commitEdit}
              onKeyDown={handleCellKeyDown}
            >
              <option value="">None</option>
              {(workspace.phases ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} - {p.name}
                </option>
              ))}
            </select>
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
        <td className={cn("border-b border-line px-1 py-0.5", className)}>
          <input
            ref={(el) => { editInputRef.current = el; }}
            type={inputType}
            step={inputType === "number" ? "0.01" : undefined}
            className="h-7 w-full rounded border border-accent/50 bg-bg px-1.5 text-xs outline-none tabular-nums"
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
      return (
        <td
          ref={isDropdownOpen ? entityCellRef : undefined}
          className={cn(
            "border-b border-line px-2 py-2 text-xs cursor-pointer transition-colors",
            "hover:bg-accent/5",
            className
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (isDropdownOpen) {
              setEntityDropdownRowId(null);
              setEntityDropdownPos(null);
            } else {
              positionEntityDropdown(e.currentTarget as HTMLTableCellElement);
              setEntityDropdownRowId(row.id);
              setEntitySearchTerm("");
              setSelectedRowId(row.id);
            }
          }}
        >
          <div className="flex items-center gap-1">
            <Badge
              tone={getCategoryBadgeTone(row.category, entityCategories)}
              className="text-[9px] px-1 py-0"
            >
              {findCategoryForRow(row, entityCategories)?.shortform ?? row.category.charAt(0)}
            </Badge>
            <span className="truncate">{row.entityName}</span>
          </div>
          {/* Entity dropdown rendered via portal */}
          {isDropdownOpen && entityDropdownPos && (() => {
            const q = entitySearchTerm.toLowerCase();
            // Separate matching category groups from others
            const matchingGroups = entityOptions.filter((g) => g.categoryName === row.category);
            const otherGroups = entityOptions.filter((g) => g.categoryName !== row.category);

            const renderGroupItems = (group: typeof entityOptions[0], filtered: EntityOptionItem[]) =>
              filtered.map((item) => (
                <button
                  key={`${group.categoryId}-${item.value}-${item.rateScheduleItemId ?? ""}`}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors flex items-center justify-between"
                  onClick={() =>
                    handleEntitySelect(
                      row.id,
                      item.value,
                      group.categoryName,
                      group.entityType,
                      group.defaultUom,
                      item.unitCost !== undefined
                        ? { cost: item.unitCost, uom: item.unit, description: item.label }
                        : undefined,
                      item.rateScheduleItemId,
                      item.itemId,
                    )
                  }
                >
                  <span className="truncate">
                    {item.rateScheduleItemId && <span className="text-accent mr-1">&#9679;</span>}
                    {item.label}
                  </span>
                  {(item.unitCost !== undefined || item.unitPrice !== undefined) && (
                    <span className="ml-2 text-[10px] text-fg/30 tabular-nums whitespace-nowrap">
                      {item.unitCost !== undefined && `$${item.unitCost.toFixed(2)}`}
                      {item.unitCost !== undefined && item.unitPrice !== undefined && " / "}
                      {item.unitPrice !== undefined && `$${item.unitPrice.toFixed(2)}`}
                    </span>
                  )}
                </button>
              ));

            return createPortal(
              <motion.div
                ref={entityDropdownRef}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.12 }}
                className="fixed z-[200] flex w-80 flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-xl"
                style={{
                  top: entityDropdownPos.top,
                  bottom: entityDropdownPos.bottom,
                  left: entityDropdownPos.left,
                  maxHeight: entityDropdownPos.maxHeight,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-2 border-b border-line">
                  <input
                    ref={entitySearchRef}
                    type="text"
                    className="w-full h-7 rounded border border-line bg-bg px-2 text-xs outline-none focus:border-accent/50"
                    placeholder="Search entities..."
                    value={entitySearchTerm}
                    onChange={(e) => setEntitySearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setEntityDropdownRowId(null);
                        setEntityDropdownPos(null);
                      }
                    }}
                  />
                </div>
                <div
                  className="overflow-y-auto py-1"
                  style={{ maxHeight: entityDropdownPos.listMaxHeight }}
                >
                  {/* Matching category first */}
                  {matchingGroups.map((group) => {
                    const filtered = q
                      ? group.items.filter((it) => it.label.toLowerCase().includes(q))
                      : group.items;
                    if (filtered.length === 0 && q) return null;
                    return (
                      <div key={group.categoryId}>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase text-accent/60 tracking-wider bg-accent/5">
                          Matching &mdash; {group.categoryName}
                        </div>
                        {renderGroupItems(group, filtered)}
                      </div>
                    );
                  })}

                  {/* Other categories */}
                  {otherGroups.length > 0 && (
                    <>
                      {matchingGroups.length > 0 && (
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase text-fg/25 tracking-wider bg-panel2/20 border-t border-line mt-1">
                          Other
                        </div>
                      )}
                      {otherGroups.map((group) => {
                        const filtered = q
                          ? group.items.filter((it) => it.label.toLowerCase().includes(q))
                          : group.items;
                        if (filtered.length === 0 && q) return null;
                        return (
                          <div key={group.categoryId}>
                            <div className="px-3 py-1 text-[10px] font-semibold uppercase text-fg/35 tracking-wider bg-panel2/40">
                              {group.categoryName}
                            </div>
                            {renderGroupItems(group, filtered)}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </motion.div>,
              document.body,
            );
          })()}
        </td>
      );
    }

    return (
      <td
        className={cn(
          "border-b border-line px-2 py-2 text-xs transition-colors",
          disabled
            ? "bg-surface/50 cursor-not-allowed"
            : "cursor-pointer hover:bg-accent/5",
          className
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) {
            const raw = getEditableValue(row, column);
            startEditing(row.id, column, raw as string | number);
          }
        }}
      >
        {disabled ? <span className="italic opacity-40">{displayValue}</span> : displayValue}
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

  const scrollTabs = useCallback((dir: "left" | "right") => {
    const el = tabScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  }, []);

  // ─── Render ───

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-2 pb-1">
      {/* ─── Worksheet Tabs ─── */}
      <div className="flex items-center border-b border-line shrink-0">
        {/* Left scroll arrow */}
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

        {/* Scrollable tab strip */}
        <div
          ref={tabScrollRef}
          onScroll={checkTabOverflow}
          onWheel={(e) => {
            if (!tabScrollRef.current) return;
            // Convert vertical scroll to horizontal
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
              "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap border-b-2",
              activeTab === "all"
                ? "border-accent text-accent bg-accent/5"
                : "border-transparent text-fg/40 hover:text-fg/60"
            )}
          >
            All
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
                "group px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap border-b-2",
                activeTab === ws.id
                  ? "border-accent text-accent bg-accent/5"
                  : "border-transparent text-fg/40 hover:text-fg/60"
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
            </button>
          ))}

          <button
            onClick={() => {
              setNewWsName("");
              setShowNewWsModal(true);
            }}
            className="ml-1 p-1.5 text-fg/30 hover:text-fg/60 transition-colors shrink-0"
            title="Add worksheet"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Right scroll arrow */}
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
            <Button size="xs" onClick={() => addNewItem()} disabled={isPending}><Plus className="h-3 w-3" /> Item</Button>

            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setShowCatalogPicker(true);
                setCatalogSearchTerm("");
                setSelectedCatalogItemIds(new Set());
              }}
              disabled={isPending}
            >
              <Package className="h-3 w-3" /> Catalog
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setShowAssemblyPicker(true)}
              disabled={isPending}
            >
              <Layers className="h-3 w-3" /> Assembly
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setShowAssemblyInstances(true)}
              disabled={isPending}
              title="Manage assembly groups in this worksheet"
            >
              Groups
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
            className="w-36 h-7 text-[11px]"
            value=""
            onChange={(e) => {
              if (e.target.value) handleBulkMoveToWorksheet(e.target.value);
            }}
          >
            <option value="">Move to...</option>
            {(workspace.worksheets ?? []).map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </Select>

          {/* Assign Phase dropdown */}
          <Select
            className="w-36 h-7 text-[11px]"
            value=""
            onChange={(e) => {
              handleBulkAssignPhase(e.target.value);
            }}
          >
            <option value="">Assign Phase...</option>
            <option value="">None</option>
            {(workspace.phases ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.number} - {p.name}</option>
            ))}
          </Select>

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
      <div className="flex-1 min-h-0">
          {visibleRows.length === 0 ? (
            <EmptyState>
              No line items found.{" "}
              <button className="text-accent hover:underline" onClick={() => addNewItem()}>
                Add one
              </button>
            </EmptyState>
          ) : (
            <div className="overflow-auto rounded-lg border border-line h-full">
              <table className="w-full text-sm">
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
                      <th className="border-b border-line px-2 py-2 text-left min-w-[140px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("entityName")}>
                        <span className="flex items-center gap-1">Entity Name {renderSortIcon("entityName")}</span>
                      </th>
                    )}
                    {isColVisible("vendor") && (
                      <th className="border-b border-line px-2 py-2 text-left min-w-[100px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("vendor")}>
                        <span className="flex items-center gap-1">Vendor {renderSortIcon("vendor")}</span>
                      </th>
                    )}
                    {isColVisible("description") && (
                      <th className="border-b border-line px-2 py-2 text-left min-w-[160px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("description")}>
                        <span className="flex items-center gap-1">Description {renderSortIcon("description")}</span>
                      </th>
                    )}
                    {isColVisible("quantity") && (
                      <th className="border-b border-line px-2 py-2 text-right w-16 cursor-pointer select-none group/th" onClick={() => handleSortToggle("quantity")}>
                        <span className="flex items-center justify-end gap-1">Qty {renderSortIcon("quantity")}</span>
                      </th>
                    )}
                    {isColVisible("uom") && (
                      <th className="border-b border-line px-2 py-2 text-center w-14 cursor-pointer select-none group/th" onClick={() => handleSortToggle("uom")}>
                        <span className="flex items-center justify-center gap-1">UOM {renderSortIcon("uom")}</span>
                      </th>
                    )}
                    {isColVisible("units") && (
                      <th className="border-b border-line px-1.5 py-2 text-center cursor-pointer select-none group/th" onClick={() => handleSortToggle("unit1")}>
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
                      <th className="border-b border-line px-2 py-2 text-left w-20 max-w-[80px] cursor-pointer select-none group/th" onClick={() => handleSortToggle("phaseId")}>
                        <span className="flex items-center gap-1">Phase {renderSortIcon("phaseId")}</span>
                      </th>
                    )}
                    {isColVisible("actions") && (
                      <th className="border-b border-line px-2 py-2 text-center w-10"></th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {groupedRows.map((group) => {
                    const isCollapsed = collapsedCategories.has(group.category);
                    return (
                      <GroupRows
                        key={group.category}
                        group={group}
                        isCollapsed={isCollapsed}
                        onToggleCollapse={() => toggleCategoryCollapse(group.category)}
                        selectedRowId={selectedRowId}
                        onSelectRow={setSelectedRowId}
                        onContextMenu={handleContextMenu}
                        onDescDoubleClick={handleDescClick}
                        renderEditableCell={renderEditableCell}
                        renderUnitsCell={renderUnitsCell}
                        entityCategories={entityCategories}
                        workspace={workspace}
                        visibleColumns={visibleColumns}
                        isColVisible={isColVisible}
                        visibleColumnCount={visibleColumnCount}
                        selectedIds={selectedIds}
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
          )}
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
              handleDeleteWorksheet(tabMenu.wsId);
              setTabMenu(null);
            }}
            disabled={workspace.worksheets.length <= 1}
          >
            Delete
          </button>
        </div>
      )}

      {/* ─── New Worksheet modal ─── */}
      {showNewWsModal && (
        <ModalBackdrop open={showNewWsModal} onClose={() => setShowNewWsModal(false)}>
          <div className="w-80">
            <h4 className="text-sm font-semibold mb-3">New Worksheet</h4>
            <Input
              autoFocus
              className="mb-3"
              placeholder="Worksheet name..."
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateWorksheet();
              }}
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowNewWsModal(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateWorksheet} disabled={!newWsName.trim() || isPending}>
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
        worksheetId={activeTab !== "all" ? activeTab : (workspace.worksheets[0]?.id ?? null)}
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
        worksheetId={activeTab !== "all" ? activeTab : (workspace.worksheets[0]?.id ?? null)}
        selectedItemIds={Array.from(selectedIds)}
        onSaved={(info) => {
          setSelectedIds(new Set());
          if (info.skippedFreeform > 0) {
            onError(`Saved "${info.assemblyName}" — skipped ${info.skippedFreeform} freeform line${info.skippedFreeform === 1 ? "" : "s"} (no catalog or rate-schedule reference).`);
          }
        }}
      />

      {/* ─── Assembly Instances Modal ─── */}
      <AssemblyInstancesModal
        open={showAssemblyInstances}
        onClose={() => setShowAssemblyInstances(false)}
        projectId={workspace.project.id}
        worksheetId={activeTab !== "all" ? activeTab : (workspace.worksheets[0]?.id ?? null)}
        onWorkspaceUpdated={(workspace) => onApply(workspace)}
      />

      {/* ─── Catalog Quick-Add Modal ─── */}
      {showCatalogPicker && (
        <ModalBackdrop open={showCatalogPicker} onClose={() => setShowCatalogPicker(false)}>
          <div className="w-[600px] max-h-[70vh] flex flex-col rounded-xl border border-line bg-panel p-5 shadow-xl">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Add from Catalog
            </h4>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
              <Input
                autoFocus
                className="pl-8"
                placeholder="Search catalog items..."
                value={catalogSearchTerm}
                onChange={(e) => setCatalogSearchTerm(e.target.value)}
              />
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto border border-line rounded-lg max-h-[400px]">
              {filteredCatalogItems.length === 0 ? (
                <div className="p-6 text-center text-xs text-fg/40">
                  {allCatalogItems.length === 0
                    ? "No catalog items available."
                    : "No items match your search."}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-panel2/60 text-[10px] font-medium uppercase text-fg/35 sticky top-0">
                    <tr>
                      <th className="border-b border-line px-2 py-1.5 w-8">
                        <input
                          type="checkbox"
                          className="h-3 w-3 rounded border-line accent-accent cursor-pointer"
                          checked={
                            filteredCatalogItems.length > 0 &&
                            filteredCatalogItems.every((ci) => selectedCatalogItemIds.has(ci.id))
                          }
                          onChange={() => {
                            if (filteredCatalogItems.every((ci) => selectedCatalogItemIds.has(ci.id))) {
                              setSelectedCatalogItemIds(new Set());
                            } else {
                              setSelectedCatalogItemIds(new Set(filteredCatalogItems.map((ci) => ci.id)));
                            }
                          }}
                        />
                      </th>
                      <th className="border-b border-line px-2 py-1.5 text-left">Code</th>
                      <th className="border-b border-line px-2 py-1.5 text-left">Name</th>
                      <th className="border-b border-line px-2 py-1.5 text-left">Catalog</th>
                      <th className="border-b border-line px-2 py-1.5 text-center">Unit</th>
                      <th className="border-b border-line px-2 py-1.5 text-right">Cost</th>
                      <th className="border-b border-line px-2 py-1.5 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCatalogItems.map((ci) => {
                      const checked = selectedCatalogItemIds.has(ci.id);
                      return (
                        <tr
                          key={ci.id}
                          className={cn(
                            "cursor-pointer transition-colors",
                            checked ? "bg-accent/5" : "hover:bg-panel2/20"
                          )}
                          onClick={() => {
                            setSelectedCatalogItemIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(ci.id)) {
                                next.delete(ci.id);
                              } else {
                                next.add(ci.id);
                              }
                              return next;
                            });
                          }}
                        >
                          <td className="border-b border-line px-2 py-1.5">
                            <input
                              type="checkbox"
                              className="h-3 w-3 rounded border-line accent-accent cursor-pointer"
                              checked={checked}
                              readOnly
                            />
                          </td>
                          <td className="border-b border-line px-2 py-1.5 font-mono text-fg/50">{ci.code}</td>
                          <td className="border-b border-line px-2 py-1.5 font-medium">{ci.name}</td>
                          <td className="border-b border-line px-2 py-1.5">
                            <Badge
                              tone={getCategoryBadgeTone(catalogKindToCategory(ci.catalogKind), entityCategories)}
                              className="text-[9px]"
                            >
                              {ci.catalogKind}
                            </Badge>
                          </td>
                          <td className="border-b border-line px-2 py-1.5 text-center">{ci.unit}</td>
                          <td className="border-b border-line px-2 py-1.5 text-right tabular-nums">{formatMoney(ci.unitCost, 2)}</td>
                          <td className="border-b border-line px-2 py-1.5 text-right tabular-nums">{formatMoney(ci.unitPrice, 2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center mt-3">
              <span className="text-xs text-fg/40">
                {selectedCatalogItemIds.size} item{selectedCatalogItemIds.size !== 1 ? "s" : ""} selected
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowCatalogPicker(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAddFromCatalog}
                  disabled={selectedCatalogItemIds.size === 0 || isPending}
                >
                  Add Selected
                </Button>
              </div>
            </div>
          </div>
        </ModalBackdrop>
      )}

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

/* ─── GroupRows sub-component ─── */

function GroupRows({
  group,
  isCollapsed,
  onToggleCollapse,
  selectedRowId,
  onSelectRow,
  onContextMenu,
  onDescDoubleClick,
  renderEditableCell,
  renderUnitsCell,
  entityCategories,
  workspace,
  visibleColumns,
  isColVisible,
  visibleColumnCount,
  selectedIds,
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
  onDescDoubleClick: (rowId: string) => void;
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
  onToggleSelectRow: (id: string) => void;
  onMoveUp: (row: WorkspaceWorksheetItem, groupItems: WorkspaceWorksheetItem[]) => void;
  onMoveDown: (row: WorkspaceWorksheetItem, groupItems: WorkspaceWorksheetItem[]) => void;
  detailItem: WorkspaceWorksheetItem | null;
  onOpenDetail: (item: WorkspaceWorksheetItem) => void;
  isPending: boolean;
}) {
  const catDef = group.catDef;
  const regLabel = catDef ? catDef.unitLabels.unit1 : "";
  const overLabel = catDef ? catDef.unitLabels.unit2 : "";
  const doubleLabel = catDef ? catDef.unitLabels.unit3 : "";

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
            <Badge
              tone={getCategoryBadgeTone(group.category, entityCategories)}
            >
              {group.category}
            </Badge>
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
          const extCost = row.cost * row.quantity;
          const margin = row.price > 0 ? ((row.price - extCost) / row.price * 100).toFixed(1) + "%" : "--";

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
              onClick={() => {
                onSelectRow(row.id);
                if (!isTemporary) {
                  onOpenDetail(row);
                }
              }}
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

              {/* Entity Name (with dropdown) */}
              {isColVisible("entityName") &&
                renderEditableCell(row, "entityName", row.entityName, "min-w-[200px]")}

              {/* Vendor */}
              {isColVisible("vendor") &&
                renderEditableCell(row, "vendor", row.vendor ?? "", "min-w-[100px]")}

              {/* Description */}
              {isColVisible("description") && (
                <td
                  className="border-b border-line px-2 py-2 text-xs cursor-pointer hover:bg-accent/5 min-w-[160px] max-w-[200px] truncate"
                  onClick={() => onDescDoubleClick(row.id)}
                  title={row.description}
                >
                  {row.description || <span className="text-fg/20 italic">Add description...</span>}
                </td>
              )}

              {/* Quantity */}
              {isColVisible("quantity") &&
                renderEditableCell(
                  row,
                  "quantity",
                  <span className="tabular-nums inline-flex items-center gap-1">
                    {linkedItemIds.has(row.id) && (
                      <span title="Linked to takeoff annotation">
                        <Link2 className="h-3 w-3 text-accent/60 shrink-0" />
                      </span>
                    )}
                    {row.quantity}
                  </span>,
                  "text-right"
                )}

              {/* UOM */}
              {isColVisible("uom") &&
                renderEditableCell(row, "uom", row.uom, "text-center")}

              {/* Combined units column */}
              {isColVisible("units") && renderUnitsCell(row)}

              {/* Cost */}
              {isColVisible("cost") &&
                renderEditableCell(
                  row,
                  "cost",
                  <span className="tabular-nums">{formatMoney(row.cost, 2)}</span>,
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
                  <span className="tabular-nums font-medium">{formatMoney(row.price)}</span>,
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
                    <span className="text-fg/60 truncate block max-w-[72px]" title={`${phase.number} – ${phase.name}`}>{phase.number} – {phase.name}</span>
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

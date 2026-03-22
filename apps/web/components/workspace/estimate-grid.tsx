"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  GripVertical,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  CreateWorksheetItemInput,
  EntityCategory,
  ProjectWorkspaceData,
  WorkspaceResponse,
  WorkspaceWorksheet,
  WorkspaceWorksheetItem,
} from "@/lib/api";
import {
  createWorksheet,
  createWorksheetItem,
  deleteWorksheet,
  deleteWorksheetItem,
  getEntityCategories,
  updateWorksheet,
  updateWorksheetItem,
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
} from "@/components/ui";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

export interface EstimateGridProps {
  workspace: ProjectWorkspaceData;
  onApply: (next: WorkspaceResponse) => void;
  onError: (msg: string) => void;
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
  | "laborHourReg"
  | "laborHourOver"
  | "laborHourDouble"
  | "phaseId";

type ContextMenuState = {
  rowId: string;
  x: number;
  y: number;
} | null;

type WorksheetTabId = string | "all" | "summary";

/* ─── Constants ─── */

const CATEGORY_COLORS: Record<string, string> = {
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

const EDITABLE_COLUMNS_ORDER: EditableColumn[] = [
  "entityName",
  "vendor",
  "description",
  "quantity",
  "uom",
  "laborHourReg",
  "laborHourOver",
  "laborHourDouble",
  "cost",
  "markup",
  "price",
  "phaseId",
];

/* ─── Helpers ─── */

function parseNum(v: string, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function fmtPct(v: number) {
  return Number.isFinite(v) ? String(Math.round(v * 1000) / 10) : "0";
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
  const fieldMap: Record<string, keyof EntityCategory["editableFields"]> = {
    quantity: "quantity",
    cost: "cost",
    markup: "markup",
    price: "price",
    laborHourReg: "laborHourReg",
    laborHourOver: "laborHourOver",
    laborHourDouble: "laborHourDouble",
  };
  const field = fieldMap[column];
  if (!field) return false;
  return !category.editableFields[field];
}

function getLaborColumnLabel(
  column: "laborHourReg" | "laborHourOver" | "laborHourDouble",
  category: EntityCategory | undefined
): string {
  if (!category) {
    return column === "laborHourReg" ? "Reg Hrs" : column === "laborHourOver" ? "OT Hrs" : "DT Hrs";
  }
  const map = { laborHourReg: "reg", laborHourOver: "over", laborHourDouble: "double" } as const;
  const label = category.laborHourLabels[map[column]];
  return label || (column === "laborHourReg" ? "Reg Hrs" : column === "laborHourOver" ? "OT Hrs" : "DT Hrs");
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
  items: Array<{ label: string; value: string }>;
}> {
  const groups: Array<{
    categoryName: string;
    categoryId: string;
    entityType: string;
    defaultUom: string;
    items: Array<{ label: string; value: string }>;
  }> = [];

  for (const cat of categories) {
    const items: Array<{ label: string; value: string }> = [];

    if (cat.name === "Labour") {
      // Labour rates from the project
      for (const lr of workspace.labourRates ?? []) {
        items.push({ label: lr.name, value: lr.name });
      }
      // Also include labor catalog items
      for (const catalog of workspace.catalogs ?? []) {
        if (catalog.kind === "labor") {
          for (const ci of catalog.items ?? []) {
            if (!items.some((i) => i.value === ci.name)) {
              items.push({ label: ci.name, value: ci.name });
            }
          }
        }
      }
      if (items.length === 0) {
        items.push({ label: "Labour", value: "Labour" });
      }
    } else if (cat.name === "Equipment") {
      for (const catalog of workspace.catalogs ?? []) {
        if (catalog.kind === "equipment") {
          for (const ci of catalog.items ?? []) {
            items.push({ label: ci.name, value: ci.name });
          }
        }
      }
      if (items.length === 0) {
        items.push({ label: "Equipment", value: "Equipment" });
      }
    } else if (cat.name === "Stock Items" || cat.name === "Consumables") {
      for (const catalog of workspace.catalogs ?? []) {
        if (catalog.kind === "materials") {
          for (const ci of catalog.items ?? []) {
            items.push({ label: ci.name, value: ci.name });
          }
        }
      }
      if (items.length === 0) {
        items.push({ label: cat.name, value: cat.name });
      }
    } else {
      // Material, Other Charges, Travel, Subcontractors, Rental
      items.push({ label: cat.name, value: cat.name });
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

/** Group rows by category */
function groupRowsByCategory(
  rows: WorkspaceWorksheetItem[],
  categories: EntityCategory[]
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
      const items = grouped[catName].sort((a, b) => a.lineOrder - b.lineOrder);
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
    const sorted = items.sort((a, b) => a.lineOrder - b.lineOrder);
    result.push({
      category: catName,
      catDef: undefined,
      items: sorted,
      totalPrice: sorted.reduce((s, r) => s + r.price, 0),
    });
  }

  return result;
}

/* ─── Component ─── */

export function EstimateGrid({ workspace, onApply, onError }: EstimateGridProps) {
  const [isPending, startTransition] = useTransition();

  // Entity categories loaded from API
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);

  // Tab state
  const [activeTab, setActiveTab] = useState<WorksheetTabId>(
    workspace.worksheets[0]?.id ?? "all"
  );

  // Editing state
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  // Entity dropdown state
  const [entityDropdownRowId, setEntityDropdownRowId] = useState<string | null>(null);
  const [entitySearchTerm, setEntitySearchTerm] = useState("");
  const entitySearchRef = useRef<HTMLInputElement | null>(null);

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
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

  // Description popup
  const [descPopup, setDescPopup] = useState<{ rowId: string; value: string } | null>(null);

  // Selected row
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  // Collapsed category groups
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Inline tab rename
  const [inlineRenameWsId, setInlineRenameWsId] = useState<string | null>(null);
  const [inlineRenameName, setInlineRenameName] = useState("");
  const inlineRenameRef = useRef<HTMLInputElement | null>(null);

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
    if (activeTab !== "all" && activeTab !== "summary" && !findWs(workspace, activeTab)) {
      setActiveTab(workspace.worksheets[0]?.id ?? "all");
    }
  }, [workspace.worksheets, activeTab]);

  // Focus entity search when dropdown opens
  useEffect(() => {
    if (entityDropdownRowId) {
      setTimeout(() => entitySearchRef.current?.focus(), 0);
    }
  }, [entityDropdownRowId]);

  // Focus inline rename input
  useEffect(() => {
    if (inlineRenameWsId) {
      setTimeout(() => {
        inlineRenameRef.current?.focus();
        inlineRenameRef.current?.select();
      }, 0);
    }
  }, [inlineRenameWsId]);

  // Entity dropdown options
  const entityOptions = useMemo(
    () => buildEntityOptions(workspace, entityCategories),
    [workspace, entityCategories]
  );

  // Get visible rows
  const visibleRows = useMemo(() => {
    let rows: WorkspaceWorksheetItem[];
    if (activeTab === "all" || activeTab === "summary") {
      rows = (workspace.worksheets ?? []).flatMap((w) => w.items);
    } else {
      const ws = findWs(workspace, activeTab);
      rows = ws ? ws.items : [];
    }

    const q = searchTerm.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.entityName, r.description, r.category, r.entityType, r.vendor ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    if (categoryFilter) {
      rows = rows.filter((r) => r.category === categoryFilter);
    }

    if (phaseFilter) {
      rows = rows.filter((r) => r.phaseId === phaseFilter);
    }

    return rows;
  }, [searchTerm, categoryFilter, phaseFilter, activeTab, workspace.worksheets]);

  // Grouped rows
  const groupedRows = useMemo(
    () => groupRowsByCategory(visibleRows, entityCategories),
    [visibleRows, entityCategories]
  );

  // Summary data
  const summaryData = useMemo(() => {
    const allItems = (workspace.worksheets ?? []).flatMap((w) => w.items);
    const byCategory: Record<string, { count: number; cost: number; price: number; regHrs: number; otHrs: number; dtHrs: number }> = {};

    for (const item of allItems) {
      const cat = item.category || "Uncategorized";
      if (!byCategory[cat]) {
        byCategory[cat] = { count: 0, cost: 0, price: 0, regHrs: 0, otHrs: 0, dtHrs: 0 };
      }
      byCategory[cat].count++;
      byCategory[cat].cost += item.cost * item.quantity;
      byCategory[cat].price += item.price;
      byCategory[cat].regHrs += item.laborHourReg;
      byCategory[cat].otHrs += item.laborHourOver;
      byCategory[cat].dtHrs += item.laborHourDouble;
    }

    return byCategory;
  }, [workspace.worksheets]);

  // Totals
  const totals = useMemo(() => {
    return {
      cost: visibleRows.reduce((sum, r) => sum + r.cost * r.quantity, 0),
      price: visibleRows.reduce((sum, r) => sum + r.price, 0),
      regHrs: visibleRows.reduce((sum, r) => sum + r.laborHourReg, 0),
      otHrs: visibleRows.reduce((sum, r) => sum + r.laborHourOver, 0),
      dtHrs: visibleRows.reduce((sum, r) => sum + r.laborHourDouble, 0),
      count: visibleRows.length,
    };
  }, [visibleRows]);

  // ─── Cell editing ───

  function startEditing(rowId: string, column: EditableColumn, currentValue: string | number) {
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;

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
    const currentVal = row[column as keyof WorkspaceWorksheetItem];

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
      column === "laborHourReg" ||
      column === "laborHourOver" ||
      column === "laborHourDouble"
    ) {
      const numVal = parseNum(editValue);
      if (numVal === currentVal) {
        setEditingCell(null);
        return;
      }
      patch = { [column]: numVal };
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

    startTransition(async () => {
      try {
        const next = await updateWorksheetItem(workspace.project.id, rowId, patch);
        onApply(next);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Save failed.");
      }
    });
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
        const rawVal = row[nextCol as keyof WorkspaceWorksheetItem];
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
          const rawVal = nextRow[col as keyof WorkspaceWorksheetItem];
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
          const rawVal = nextRow[column as keyof WorkspaceWorksheetItem];
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
    defaultUom: string
  ) {
    setEntityDropdownRowId(null);
    setEntitySearchTerm("");

    startTransition(async () => {
      try {
        const next = await updateWorksheetItem(workspace.project.id, rowId, {
          entityName,
          category: categoryName,
          entityType,
          uom: defaultUom,
        });
        onApply(next);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Save failed.");
      }
    });
  }

  // ─── Row operations ───

  function addNewItem(categoryOverride?: string) {
    const wsId = activeTab !== "all" && activeTab !== "summary" ? activeTab : workspace.worksheets[0]?.id;
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
      laborHourReg: 0,
      laborHourOver: 0,
      laborHourDouble: 0,
    };

    startTransition(async () => {
      try {
        const next = await createWorksheetItem(workspace.project.id, wsId, payload);
        onApply(next);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Create failed.");
      }
    });
  }

  function deleteRow(itemId: string) {
    startTransition(async () => {
      try {
        const next = await deleteWorksheetItem(workspace.project.id, itemId);
        onApply(next);
        if (selectedRowId === itemId) setSelectedRowId(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Delete failed.");
      }
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
      laborHourReg: row.laborHourReg,
      laborHourOver: row.laborHourOver,
      laborHourDouble: row.laborHourDouble,
      lineOrder: row.lineOrder + 1,
    };

    startTransition(async () => {
      try {
        const next = await createWorksheetItem(workspace.project.id, row.worksheetId, payload);
        onApply(next);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Duplicate failed.");
      }
    });
  }

  // ─── Context menu ───

  function handleContextMenu(e: React.MouseEvent, rowId: string) {
    e.preventDefault();
    setContextMenu({ rowId, x: e.clientX, y: e.clientY });
    setSelectedRowId(rowId);
  }

  useEffect(() => {
    function close() {
      setContextMenu(null);
      setTabMenu(null);
      if (entityDropdownRowId) {
        setEntityDropdownRowId(null);
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

  // ─── Description popup ───

  function handleDescDoubleClick(rowId: string, currentDesc: string) {
    setDescPopup({ rowId, value: currentDesc });
  }

  function saveDescPopup() {
    if (!descPopup) return;
    startTransition(async () => {
      try {
        const next = await updateWorksheetItem(workspace.project.id, descPopup.rowId, {
          description: descPopup.value,
        });
        onApply(next);
        setDescPopup(null);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Save failed.");
      }
    });
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

  // ─── Render cell helpers ───

  function renderEditableCell(
    row: WorkspaceWorksheetItem,
    column: EditableColumn,
    displayValue: React.ReactNode,
    className?: string
  ) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.column === column;
    const catDef = findCategoryForRow(row, entityCategories);
    const disabled = isCellDisabledByCategory(catDef, column);

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
                startTransition(async () => {
                  try {
                    const next = await updateWorksheetItem(workspace.project.id, row.id, { uom: val });
                    onApply(next);
                  } catch (err) {
                    onError(err instanceof Error ? err.message : "Save failed.");
                  }
                });
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
                startTransition(async () => {
                  try {
                    const next = await updateWorksheetItem(workspace.project.id, row.id, { phaseId: val });
                    onApply(next);
                  } catch (err) {
                    onError(err instanceof Error ? err.message : "Save failed.");
                  }
                });
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
        column === "laborHourReg" ||
        column === "laborHourOver" ||
        column === "laborHourDouble"
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
          className={cn(
            "border-b border-line px-2 py-2 text-xs cursor-pointer transition-colors relative",
            "hover:bg-accent/5",
            className
          )}
          onClick={(e) => {
            e.stopPropagation();
            setEntityDropdownRowId(isDropdownOpen ? null : row.id);
            setEntitySearchTerm("");
            setSelectedRowId(row.id);
          }}
        >
          <div className="flex items-center gap-1">
            <Badge
              tone={(CATEGORY_COLORS[row.category] ?? "default") as "default" | "success" | "warning" | "danger" | "info"}
              className="text-[9px] px-1 py-0"
            >
              {findCategoryForRow(row, entityCategories)?.shortform ?? row.category.charAt(0)}
            </Badge>
            <span className="truncate">{row.entityName}</span>
          </div>
          {/* Entity dropdown */}
          {isDropdownOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-line bg-panel shadow-xl"
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
                    }
                  }}
                />
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {entityOptions.map((group) => {
                  const q = entitySearchTerm.toLowerCase();
                  const filtered = q
                    ? group.items.filter((it) => it.label.toLowerCase().includes(q))
                    : group.items;
                  if (filtered.length === 0 && q) return null;
                  return (
                    <div key={group.categoryId}>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase text-fg/35 tracking-wider bg-panel2/40">
                        {group.categoryName}
                      </div>
                      {filtered.map((item) => (
                        <button
                          key={`${group.categoryId}-${item.value}`}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/10 transition-colors"
                          onClick={() =>
                            handleEntitySelect(
                              row.id,
                              item.value,
                              group.categoryName,
                              group.entityType,
                              group.defaultUom
                            )
                          }
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </td>
      );
    }

    return (
      <td
        className={cn(
          "border-b border-line px-2 py-2 text-xs cursor-pointer transition-colors",
          disabled ? "text-fg/25 cursor-not-allowed opacity-40" : "hover:bg-accent/5",
          className
        )}
        onClick={() => {
          if (!disabled) {
            const raw = row[column as keyof WorkspaceWorksheetItem];
            startEditing(row.id, column, raw as string | number);
          }
        }}
      >
        {displayValue}
      </td>
    );
  }

  // ─── Render ───

  return (
    <div className="space-y-3">
      {/* ─── Worksheet Tabs ─── */}
      <div className="flex items-center gap-0.5 border-b border-line overflow-x-auto">
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
          onClick={() => setActiveTab("summary")}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap border-b-2",
            activeTab === "summary"
              ? "border-accent text-accent bg-accent/5"
              : "border-transparent text-fg/40 hover:text-fg/60"
          )}
        >
          Summary
        </button>

        <button
          onClick={() => {
            setNewWsName("");
            setShowNewWsModal(true);
          }}
          className="ml-1 p-1.5 text-fg/30 hover:text-fg/60 transition-colors"
          title="Add worksheet"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>

        {/* Toolbar inline with tabs */}
        {activeTab !== "summary" && (
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-fg/30" />
              <Input className="pl-7 h-7 w-40 text-[11px]" placeholder="Filter..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
            <Select className="w-28 h-7 text-[11px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All types</option>
              {entityCategories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </Select>
            <Button size="xs" onClick={() => addNewItem()} disabled={isPending}><Plus className="h-3 w-3" /> Item</Button>
          </div>
        )}
      </div>

      {/* ─── Summary View ─── */}
      {activeTab === "summary" && (
        <Card>
          <CardHeader>
            <CardTitle>Category Summary</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-panel2/60 text-[11px] font-medium uppercase text-fg/35">
                  <tr>
                    <th className="border-b border-line px-3 py-2 text-left">Category</th>
                    <th className="border-b border-line px-3 py-2 text-right">Items</th>
                    <th className="border-b border-line px-3 py-2 text-right">Cost</th>
                    <th className="border-b border-line px-3 py-2 text-right">Price</th>
                    <th className="border-b border-line px-3 py-2 text-right">Units 1</th>
                    <th className="border-b border-line px-3 py-2 text-right">Units 2</th>
                    <th className="border-b border-line px-3 py-2 text-right">Units 3</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(summaryData).map(([cat, data]) => (
                    <tr key={cat} className="hover:bg-panel2/20">
                      <td className="border-b border-line px-3 py-2">
                        <Badge tone={(CATEGORY_COLORS[cat] ?? "default") as "default" | "success" | "warning" | "danger" | "info"}>
                          {cat}
                        </Badge>
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums">
                        {data.count}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums">
                        {formatMoney(data.cost)}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums font-medium">
                        {formatMoney(data.price)}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums">
                        {data.regHrs > 0 ? data.regHrs.toLocaleString() : "--"}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums">
                        {data.otHrs > 0 ? data.otHrs.toLocaleString() : "--"}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums">
                        {data.dtHrs > 0 ? data.dtHrs.toLocaleString() : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-panel2/40 text-xs font-medium">
                  <tr>
                    <td className="border-t border-line px-3 py-2 text-fg/50">Total</td>
                    <td className="border-t border-line px-3 py-2 text-right tabular-nums">
                      {Object.values(summaryData).reduce((s, d) => s + d.count, 0)}
                    </td>
                    <td className="border-t border-line px-3 py-2 text-right tabular-nums">
                      {formatMoney(Object.values(summaryData).reduce((s, d) => s + d.cost, 0))}
                    </td>
                    <td className="border-t border-line px-3 py-2 text-right tabular-nums font-medium">
                      {formatMoney(Object.values(summaryData).reduce((s, d) => s + d.price, 0))}
                    </td>
                    <td className="border-t border-line px-3 py-2 text-right tabular-nums">
                      {Object.values(summaryData).reduce((s, d) => s + d.regHrs, 0).toLocaleString()}
                    </td>
                    <td className="border-t border-line px-3 py-2 text-right tabular-nums">
                      {Object.values(summaryData).reduce((s, d) => s + d.otHrs, 0).toLocaleString()}
                    </td>
                    <td className="border-t border-line px-3 py-2 text-right tabular-nums">
                      {Object.values(summaryData).reduce((s, d) => s + d.dtHrs, 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ─── Grid ─── */}
      {activeTab !== "summary" && (
        <>
          {visibleRows.length === 0 ? (
            <EmptyState>
              No line items found.{" "}
              <button className="text-accent hover:underline" onClick={() => addNewItem()}>
                Add one
              </button>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-panel2/60 text-[11px] font-medium uppercase text-fg/35 sticky top-0 z-10">
                  <tr>
                    <th className="border-b border-line px-2 py-2 text-left w-8">#</th>
                    <th className="border-b border-line px-2 py-2 text-left min-w-[200px]">Entity Name</th>
                    <th className="border-b border-line px-2 py-2 text-left min-w-[100px]">Vendor</th>
                    <th className="border-b border-line px-2 py-2 text-left min-w-[160px]">Description</th>
                    <th className="border-b border-line px-2 py-2 text-right w-16">Qty</th>
                    <th className="border-b border-line px-2 py-2 text-center w-14">UOM</th>
                    <th className="border-b border-line px-2 py-2 text-right w-20">Units 1</th>
                    <th className="border-b border-line px-2 py-2 text-right w-20">Units 2</th>
                    <th className="border-b border-line px-2 py-2 text-right w-20">Units 3</th>
                    <th className="border-b border-line px-2 py-2 text-right w-20">Cost</th>
                    <th className="border-b border-line px-2 py-2 text-right w-16">Markup</th>
                    <th className="border-b border-line px-2 py-2 text-right w-24">Price</th>
                    <th className="border-b border-line px-2 py-2 text-left w-24">Phase</th>
                    <th className="border-b border-line px-2 py-2 text-center w-10"></th>
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
                        onDescDoubleClick={handleDescDoubleClick}
                        renderEditableCell={renderEditableCell}
                        entityCategories={entityCategories}
                        workspace={workspace}
                      />
                    );
                  })}
                </tbody>
                {/* ─── Totals footer ─── */}
                <tfoot className="bg-panel2/40 text-xs font-medium sticky bottom-0">
                  <tr>
                    <td className="border-t border-line px-2 py-2" colSpan={2}>
                      <span className="text-fg/50">{totals.count} items</span>
                    </td>
                    <td className="border-t border-line px-2 py-2" />
                    <td className="border-t border-line px-2 py-2" />
                    <td className="border-t border-line px-2 py-2" />
                    <td className="border-t border-line px-2 py-2" />
                    <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                      {totals.regHrs > 0 ? totals.regHrs.toLocaleString() : ""}
                    </td>
                    <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                      {totals.otHrs > 0 ? totals.otHrs.toLocaleString() : ""}
                    </td>
                    <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                      {totals.dtHrs > 0 ? totals.dtHrs.toLocaleString() : ""}
                    </td>
                    <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                      {formatMoney(totals.cost)}
                    </td>
                    <td className="border-t border-line px-2 py-2" />
                    <td className="border-t border-line px-2 py-2 text-right tabular-nums font-semibold">
                      {formatMoney(totals.price)}
                    </td>
                    <td className="border-t border-line px-2 py-2" />
                    <td className="border-t border-line px-2 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* ─── Context menu ─── */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg border border-line bg-panel shadow-xl py-1 text-xs min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-panel2/60 flex items-center gap-2"
            onClick={() => {
              duplicateRow(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            <Copy className="h-3 w-3" /> Duplicate
          </button>
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

      {/* ─── Description popup ─── */}
      {descPopup && (
        <ModalBackdrop open={!!descPopup} onClose={() => setDescPopup(null)}>
          <div className="w-96">
            <h4 className="text-sm font-semibold mb-3">Edit Description</h4>
            <textarea
              autoFocus
              rows={5}
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent/50 resize-y"
              value={descPopup.value}
              onChange={(e) => setDescPopup({ ...descPopup, value: e.target.value })}
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button size="sm" variant="ghost" onClick={() => setDescPopup(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveDescPopup} disabled={isPending}>
                Save
              </Button>
            </div>
          </div>
        </ModalBackdrop>
      )}
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
  entityCategories,
  workspace,
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
  onDescDoubleClick: (rowId: string, desc: string) => void;
  renderEditableCell: (
    row: WorkspaceWorksheetItem,
    column: EditableColumn,
    displayValue: React.ReactNode,
    className?: string
  ) => React.ReactNode;
  entityCategories: EntityCategory[];
  workspace: ProjectWorkspaceData;
}) {
  const catDef = group.catDef;
  const regLabel = catDef ? catDef.laborHourLabels.reg : "";
  const overLabel = catDef ? catDef.laborHourLabels.over : "";
  const doubleLabel = catDef ? catDef.laborHourLabels.double : "";

  return (
    <>
      {/* Category group header */}
      <tr
        className="bg-panel2/30 cursor-pointer hover:bg-panel2/50 transition-colors"
        onClick={onToggleCollapse}
      >
        <td colSpan={14} className="border-b border-line px-2 py-1.5">
          <div className="flex items-center gap-2">
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-fg/40" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
            )}
            <Badge
              tone={(CATEGORY_COLORS[group.category] ?? "default") as "default" | "success" | "warning" | "danger" | "info"}
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
          const isSelected = selectedRowId === row.id;
          const phase = (workspace.phases ?? []).find((p) => p.id === row.phaseId);

          return (
            <tr
              key={row.id}
              className={cn(
                "transition-colors",
                isSelected ? "bg-accent/5" : "hover:bg-panel2/15"
              )}
              onClick={() => onSelectRow(row.id)}
              onContextMenu={(e) => onContextMenu(e, row.id)}
            >
              {/* Row number */}
              <td className="border-b border-line px-2 py-2 text-[10px] text-fg/25 tabular-nums">
                {idx + 1}
              </td>

              {/* Entity Name (with dropdown) */}
              {renderEditableCell(row, "entityName", row.entityName, "min-w-[200px]")}

              {/* Vendor */}
              {renderEditableCell(row, "vendor", row.vendor ?? "", "min-w-[100px]")}

              {/* Description */}
              <td
                className="border-b border-line px-2 py-2 text-xs cursor-pointer hover:bg-accent/5 min-w-[160px] max-w-[200px] truncate"
                onClick={() => onDescDoubleClick(row.id, row.description)}
                title={row.description}
              >
                {row.description || <span className="text-fg/20 italic">Add description...</span>}
              </td>

              {/* Quantity */}
              {renderEditableCell(
                row,
                "quantity",
                <span className="tabular-nums">{row.quantity}</span>,
                "text-right"
              )}

              {/* UOM */}
              {renderEditableCell(row, "uom", row.uom, "text-center")}

              {/* Labour Hours - dynamic labels */}
              {renderEditableCell(
                row,
                "laborHourReg",
                <span className="tabular-nums">{row.laborHourReg || "--"}</span>,
                "text-right"
              )}
              {renderEditableCell(
                row,
                "laborHourOver",
                <span className="tabular-nums">{row.laborHourOver || "--"}</span>,
                "text-right"
              )}
              {renderEditableCell(
                row,
                "laborHourDouble",
                <span className="tabular-nums">{row.laborHourDouble || "--"}</span>,
                "text-right"
              )}

              {/* Cost */}
              {renderEditableCell(
                row,
                "cost",
                <span className="tabular-nums">{formatMoney(row.cost, 2)}</span>,
                "text-right"
              )}

              {/* Markup */}
              {renderEditableCell(
                row,
                "markup",
                <span className="tabular-nums">{formatPercent(row.markup)}</span>,
                "text-right"
              )}

              {/* Price */}
              {renderEditableCell(
                row,
                "price",
                <span className="tabular-nums font-medium">{formatMoney(row.price)}</span>,
                "text-right"
              )}

              {/* Phase */}
              {renderEditableCell(
                row,
                "phaseId",
                phase ? (
                  <span className="text-fg/60">{phase.number}</span>
                ) : (
                  <span className="text-fg/20">--</span>
                ),
                "text-left"
              )}

              {/* Actions */}
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
            </tr>
          );
        })}
    </>
  );
}

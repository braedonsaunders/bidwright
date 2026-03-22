"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
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

const CATEGORIES = [
  "Labour",
  "Equipment",
  "Stock Items",
  "Material",
  "Consumables",
  "Other Charges",
  "Travel & Per Diem",
  "Subcontractors",
  "Rental Equipment",
];

const UOM_OPTIONS = [
  "EA", "LF", "FT", "SF", "HR", "DAY", "WK", "MO", "LS",
  "CY", "LB", "TON", "GAL", "SET", "LOT", "IN", "M", "CM",
];

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

/* ─── Cell editability rules ─── */

function isCellDisabled(category: string, column: EditableColumn): boolean {
  switch (category) {
    case "Labour":
      if (column === "cost" || column === "markup" || column === "price") return true;
      break;
    case "Equipment":
      if (column === "laborHourOver" || column === "laborHourDouble") return true;
      break;
    case "Other Charges":
      if (
        column === "quantity" ||
        column === "cost" ||
        column === "markup" ||
        column === "laborHourReg" ||
        column === "laborHourOver" ||
        column === "laborHourDouble"
      )
        return true;
      break;
    case "Stock Items":
      if (column === "laborHourDouble" || column === "cost" || column === "price") return true;
      break;
  }
  return false;
}

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

/* ─── Component ─── */

export function EstimateGrid({ workspace, onApply, onError }: EstimateGridProps) {
  const [isPending, startTransition] = useTransition();

  // Tab state
  const [activeTab, setActiveTab] = useState<WorksheetTabId>(
    workspace.worksheets[0]?.id ?? "all"
  );

  // Editing state
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [phaseFilter, setPhaseFilter] = useState("");

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  // Tab menu (rename/delete)
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

  // Column visibility
  const [hiddenColumns, setHiddenColumns] = useState<Set<EditableColumn>>(new Set());

  // Sync active tab when worksheets change
  useEffect(() => {
    if (activeTab !== "all" && activeTab !== "summary" && !findWs(workspace, activeTab)) {
      setActiveTab(workspace.worksheets[0]?.id ?? "all");
    }
  }, [workspace.worksheets, activeTab]);

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

  // Summary data
  const summaryData = useMemo(() => {
    const allItems = (workspace.worksheets ?? []).flatMap((w) => w.items);
    const byCategory: Record<string, { count: number; cost: number; price: number; hours: number }> = {};

    for (const item of allItems) {
      const cat = item.category || "Uncategorized";
      if (!byCategory[cat]) {
        byCategory[cat] = { count: 0, cost: 0, price: 0, hours: 0 };
      }
      byCategory[cat].count++;
      byCategory[cat].cost += item.cost * item.quantity;
      byCategory[cat].price += item.price;
      byCategory[cat].hours += item.laborHourReg + item.laborHourOver + item.laborHourDouble;
    }

    return byCategory;
  }, [workspace.worksheets]);

  // Totals
  const totals = useMemo(() => {
    return {
      cost: visibleRows.reduce((sum, r) => sum + r.cost * r.quantity, 0),
      price: visibleRows.reduce((sum, r) => sum + r.price, 0),
      hours: visibleRows.reduce(
        (sum, r) => sum + r.laborHourReg + r.laborHourOver + r.laborHourDouble,
        0
      ),
      count: visibleRows.length,
    };
  }, [visibleRows]);

  // ─── Cell editing ───

  function startEditing(rowId: string, column: EditableColumn, currentValue: string | number) {
    const row = visibleRows.find((r) => r.id === rowId);
    if (!row) return;
    if (isCellDisabled(row.category, column)) return;

    let val: string;
    if (column === "markup") {
      val = fmtPct(currentValue as number);
    } else {
      val = String(currentValue ?? "");
    }

    setEditingCell({ rowId, column });
    setEditValue(val);
    setSelectedRowId(rowId);

    // Focus the input after render
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

    // Build patch
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

  function handleCellKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit();
      // Could advance to next cell here
    }
  }

  // ─── Row operations ───

  function addNewItem() {
    const wsId = activeTab !== "all" && activeTab !== "summary" ? activeTab : workspace.worksheets[0]?.id;
    if (!wsId) return;

    const ws = findWs(workspace, wsId);
    if (!ws) return;

    const payload: CreateWorksheetItemInput = {
      category: "Material",
      entityType: "Material",
      entityName: "New Item",
      description: "",
      quantity: 1,
      uom: "EA",
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

  // Close context menu on click anywhere
  useEffect(() => {
    function close() {
      setContextMenu(null);
      setTabMenu(null);
    }
    if (contextMenu || tabMenu) {
      document.addEventListener("click", close);
      return () => document.removeEventListener("click", close);
    }
  }, [contextMenu, tabMenu]);

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

  function handleRenameWorksheet() {
    if (!renameWsId || !renameWsName.trim()) return;
    startTransition(async () => {
      try {
        const next = await updateWorksheet(workspace.project.id, renameWsId, {
          name: renameWsName.trim(),
        });
        onApply(next);
        setRenameWsId(null);
        setRenameWsName("");
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

  // ─── Column visibility ───

  function toggleColumn(col: EditableColumn) {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }

  const isColVisible = useCallback(
    (col: EditableColumn) => !hiddenColumns.has(col),
    [hiddenColumns]
  );

  // ─── Render helpers ───

  function renderEditableCell(
    row: WorkspaceWorksheetItem,
    column: EditableColumn,
    displayValue: React.ReactNode,
    className?: string
  ) {
    const isEditing = editingCell?.rowId === row.id && editingCell?.column === column;
    const disabled = isCellDisabled(row.category, column);

    if (isEditing) {
      if (column === "uom") {
        return (
          <td className={cn("border-b border-line px-1 py-0.5", className)}>
            <select
              ref={(el) => { editInputRef.current = el; }}
              className="h-7 w-full rounded border border-accent/50 bg-bg px-1 text-xs outline-none"
              value={editValue}
              onChange={(e) => {
                setEditValue(e.target.value);
                // Auto-commit selects
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
              {UOM_OPTIONS.map((u) => (
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

    return (
      <td
        className={cn(
          "border-b border-line px-2 py-2 text-xs cursor-pointer transition-colors",
          disabled ? "text-fg/25 cursor-not-allowed" : "hover:bg-accent/5",
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
            onContextMenu={(e) => handleTabContextMenu(e, ws.id)}
            className={cn(
              "group px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap border-b-2",
              activeTab === ws.id
                ? "border-accent text-accent bg-accent/5"
                : "border-transparent text-fg/40 hover:text-fg/60"
            )}
          >
            {ws.name}
            <span className="ml-1 text-[10px] text-fg/25">({ws.items.length})</span>
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
                    <th className="border-b border-line px-3 py-2 text-right">Hours</th>
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
                        {data.hours.toLocaleString()}
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
                      {Object.values(summaryData)
                        .reduce((s, d) => s + d.hours, 0)
                        .toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ─── Toolbar ─── */}
      {activeTab !== "summary" && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
              <Input
                className="pl-8 h-8 text-xs"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg"
                  onClick={() => setSearchTerm("")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <Select
              className="w-36 h-8 text-xs"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>

            <Select
              className="w-36 h-8 text-xs"
              value={phaseFilter}
              onChange={(e) => setPhaseFilter(e.target.value)}
            >
              <option value="">All phases</option>
              {(workspace.phases ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} - {p.name}
                </option>
              ))}
            </Select>

            {/* Column visibility dropdown */}
            <div className="relative group">
              <Button size="xs" variant="ghost" className="h-8 text-[11px]">
                Columns
              </Button>
              <div className="absolute right-0 top-full z-30 mt-1 hidden group-hover:block w-44 rounded-lg border border-line bg-panel shadow-lg py-1 text-xs">
                {(
                  [
                    ["entityName", "Entity Name"],
                    ["vendor", "Vendor"],
                    ["description", "Description"],
                    ["quantity", "Qty"],
                    ["uom", "UOM"],
                    ["laborHourReg", "Reg Hrs"],
                    ["laborHourOver", "OT Hrs"],
                    ["laborHourDouble", "DT Hrs"],
                    ["cost", "Cost"],
                    ["markup", "Markup"],
                    ["price", "Price"],
                    ["phaseId", "Phase"],
                  ] as [EditableColumn, string][]
                ).map(([col, label]) => (
                  <label
                    key={col}
                    className="flex items-center gap-2 px-3 py-1 hover:bg-panel2/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isColVisible(col)}
                      onChange={() => toggleColumn(col)}
                      className="rounded"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <Button size="sm" onClick={addNewItem} disabled={isPending} className="h-8">
              <Plus className="h-3 w-3" /> Add item
            </Button>
          </div>

          {/* ─── Data Grid ─── */}
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="bg-panel2/60 text-[10px] font-medium uppercase text-fg/35 sticky top-0 z-10">
                <tr>
                  <th className="whitespace-nowrap border-b border-line px-2 py-2 text-left w-8">#</th>
                  {isColVisible("entityName") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-left min-w-[160px]">
                      Entity Name
                    </th>
                  )}
                  {isColVisible("vendor") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-left min-w-[100px]">
                      Vendor
                    </th>
                  )}
                  {isColVisible("description") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-left min-w-[140px]">
                      Description
                    </th>
                  )}
                  <th className="whitespace-nowrap border-b border-line px-2 py-2 text-left w-16">
                    Category
                  </th>
                  {isColVisible("quantity") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-right w-16">
                      Qty
                    </th>
                  )}
                  {isColVisible("uom") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-left w-14">
                      UOM
                    </th>
                  )}
                  {isColVisible("laborHourReg") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-right w-16">
                      Reg Hrs
                    </th>
                  )}
                  {isColVisible("laborHourOver") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-right w-16">
                      OT Hrs
                    </th>
                  )}
                  {isColVisible("laborHourDouble") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-right w-16">
                      DT Hrs
                    </th>
                  )}
                  {isColVisible("cost") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-right w-20">
                      Cost
                    </th>
                  )}
                  {isColVisible("markup") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-right w-16">
                      Markup
                    </th>
                  )}
                  {isColVisible("price") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-right w-24">
                      Price
                    </th>
                  )}
                  {isColVisible("phaseId") && (
                    <th className="whitespace-nowrap border-b border-line px-2 py-2 text-left w-24">
                      Phase
                    </th>
                  )}
                  <th className="whitespace-nowrap border-b border-line px-1 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const wsName =
                    activeTab === "all"
                      ? (workspace.worksheets ?? []).find((w) => w.id === row.worksheetId)?.name
                      : undefined;
                  const isSelected = selectedRowId === row.id;
                  const phase = row.phaseId
                    ? (workspace.phases ?? []).find((p) => p.id === row.phaseId)
                    : null;

                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        "transition-colors",
                        isSelected ? "bg-accent/8" : "hover:bg-panel2/30"
                      )}
                      onClick={() => setSelectedRowId(row.id)}
                      onContextMenu={(e) => handleContextMenu(e, row.id)}
                    >
                      {/* Line order / drag handle */}
                      <td className="border-b border-line px-1 py-1.5 text-fg/30 text-center">
                        <div className="flex items-center gap-0.5">
                          <GripVertical className="h-3 w-3 text-fg/15 cursor-grab" />
                          <span className="text-[10px]">{row.lineOrder}</span>
                        </div>
                      </td>

                      {/* Entity Name */}
                      {isColVisible("entityName") &&
                        renderEditableCell(row, "entityName", (
                          <div>
                            <div className="font-medium text-fg">{row.entityName}</div>
                            {wsName && (
                              <div className="text-[10px] text-fg/25 mt-0.5">{wsName}</div>
                            )}
                          </div>
                        ))}

                      {/* Vendor */}
                      {isColVisible("vendor") &&
                        renderEditableCell(
                          row,
                          "vendor",
                          <span className="text-fg/60">{row.vendor || "-"}</span>
                        )}

                      {/* Description */}
                      {isColVisible("description") && (
                        <td
                          className="border-b border-line px-2 py-1.5 text-fg/50 cursor-pointer hover:bg-accent/5 max-w-[200px]"
                          onClick={() => startEditing(row.id, "description", row.description)}
                          onDoubleClick={() => handleDescDoubleClick(row.id, row.description)}
                        >
                          {editingCell?.rowId === row.id && editingCell?.column === "description" ? (
                            <input
                              ref={(el) => { editInputRef.current = el; }}
                              type="text"
                              className="h-6 w-full rounded border border-accent/50 bg-bg px-1 text-xs outline-none"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={handleCellKeyDown}
                            />
                          ) : (
                            <span className="line-clamp-1 text-xs">{row.description || "-"}</span>
                          )}
                        </td>
                      )}

                      {/* Category (read-only) */}
                      <td className="border-b border-line px-2 py-1.5">
                        <Badge
                          tone={
                            (CATEGORY_COLORS[row.category] ?? "default") as
                              | "default"
                              | "success"
                              | "warning"
                              | "danger"
                              | "info"
                          }
                        >
                          {row.category}
                        </Badge>
                      </td>

                      {/* Qty */}
                      {isColVisible("quantity") &&
                        renderEditableCell(
                          row,
                          "quantity",
                          <span className="tabular-nums text-right block">{row.quantity.toLocaleString()}</span>,
                          "text-right"
                        )}

                      {/* UOM */}
                      {isColVisible("uom") &&
                        renderEditableCell(
                          row,
                          "uom",
                          <span className="text-fg/60">{row.uom}</span>
                        )}

                      {/* Reg Hrs */}
                      {isColVisible("laborHourReg") &&
                        renderEditableCell(
                          row,
                          "laborHourReg",
                          <span className="tabular-nums text-right block">
                            {row.laborHourReg || "-"}
                          </span>,
                          "text-right"
                        )}

                      {/* OT Hrs */}
                      {isColVisible("laborHourOver") &&
                        renderEditableCell(
                          row,
                          "laborHourOver",
                          <span className="tabular-nums text-right block">
                            {row.laborHourOver || "-"}
                          </span>,
                          "text-right"
                        )}

                      {/* DT Hrs */}
                      {isColVisible("laborHourDouble") &&
                        renderEditableCell(
                          row,
                          "laborHourDouble",
                          <span className="tabular-nums text-right block">
                            {row.laborHourDouble || "-"}
                          </span>,
                          "text-right"
                        )}

                      {/* Cost */}
                      {isColVisible("cost") &&
                        renderEditableCell(
                          row,
                          "cost",
                          <span className="tabular-nums text-right block">
                            {formatMoney(row.cost, 2)}
                          </span>,
                          "text-right"
                        )}

                      {/* Markup */}
                      {isColVisible("markup") &&
                        renderEditableCell(
                          row,
                          "markup",
                          <span className="tabular-nums text-right block">
                            {formatPercent(row.markup, 1)}
                          </span>,
                          "text-right"
                        )}

                      {/* Price */}
                      {isColVisible("price") &&
                        renderEditableCell(
                          row,
                          "price",
                          <span className="tabular-nums text-right block font-semibold">
                            {formatMoney(row.price, 2)}
                          </span>,
                          "text-right"
                        )}

                      {/* Phase */}
                      {isColVisible("phaseId") &&
                        renderEditableCell(
                          row,
                          "phaseId",
                          <span className="text-fg/50 text-[11px]">
                            {phase ? `${phase.number} - ${phase.name}` : "-"}
                          </span>
                        )}

                      {/* Actions */}
                      <td className="border-b border-line px-1 py-1.5">
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="p-1 text-fg/25 hover:text-fg/60 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateRow(row.id);
                            }}
                            title="Duplicate"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          <button
                            className="p-1 text-fg/25 hover:text-danger transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRow(row.id);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={20}
                      className="px-3 py-8 text-center text-xs text-fg/30"
                    >
                      {searchTerm || categoryFilter || phaseFilter
                        ? "No items match filters"
                        : "No line items yet. Click \"Add item\" to begin."}
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Footer with totals */}
              <tfoot className="bg-panel2/40 text-[11px] font-medium">
                <tr>
                  <td className="border-t border-line px-2 py-2"></td>
                  {isColVisible("entityName") && (
                    <td className="border-t border-line px-2 py-2 text-fg/50">
                      {totals.count} item{totals.count !== 1 ? "s" : ""}
                    </td>
                  )}
                  {isColVisible("vendor") && <td className="border-t border-line px-2 py-2"></td>}
                  {isColVisible("description") && (
                    <td className="border-t border-line px-2 py-2"></td>
                  )}
                  <td className="border-t border-line px-2 py-2"></td>
                  {isColVisible("quantity") && <td className="border-t border-line px-2 py-2"></td>}
                  {isColVisible("uom") && <td className="border-t border-line px-2 py-2"></td>}
                  {isColVisible("laborHourReg") && (
                    <td className="border-t border-line px-2 py-2"></td>
                  )}
                  {isColVisible("laborHourOver") && (
                    <td className="border-t border-line px-2 py-2"></td>
                  )}
                  {isColVisible("laborHourDouble") && (
                    <td className="border-t border-line px-2 py-2"></td>
                  )}
                  {isColVisible("cost") && (
                    <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                      {formatMoney(totals.cost)}
                    </td>
                  )}
                  {isColVisible("markup") && <td className="border-t border-line px-2 py-2"></td>}
                  {isColVisible("price") && (
                    <td className="border-t border-line px-2 py-2 text-right tabular-nums font-semibold">
                      {formatMoney(totals.price)}
                    </td>
                  )}
                  {isColVisible("phaseId") && <td className="border-t border-line px-2 py-2"></td>}
                  <td className="border-t border-line px-2 py-2 text-right tabular-nums">
                    {totals.hours.toLocaleString()} hrs
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* ─── Context Menu ─── */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-lg border border-line bg-panel shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-panel2/60"
            onClick={() => {
              const row = visibleRows.find((r) => r.id === contextMenu.rowId);
              if (row) {
                startEditing(row.id, "entityName", row.entityName);
              }
              setContextMenu(null);
            }}
          >
            Edit
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-panel2/60"
            onClick={() => {
              duplicateRow(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            Duplicate
          </button>
          <div className="h-px bg-line mx-2 my-1" />
          {workspace.worksheets.length > 1 && (
            <div className="px-3 py-1 text-[10px] font-medium uppercase text-fg/30">
              Move to Worksheet
            </div>
          )}
          {workspace.worksheets
            .filter((ws) => {
              const row = visibleRows.find((r) => r.id === contextMenu.rowId);
              return row && ws.id !== row.worksheetId;
            })
            .map((ws) => (
              <button
                key={ws.id}
                className="block w-full px-3 py-1.5 text-left hover:bg-panel2/60"
                onClick={() => {
                  const row = visibleRows.find((r) => r.id === contextMenu.rowId);
                  if (!row) return;
                  // Move = create in new ws + delete from old
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
                  };
                  startTransition(async () => {
                    try {
                      await createWorksheetItem(workspace.project.id, ws.id, payload);
                      const next = await deleteWorksheetItem(workspace.project.id, row.id);
                      onApply(next);
                    } catch (e) {
                      onError(e instanceof Error ? e.message : "Move failed.");
                    }
                  });
                  setContextMenu(null);
                }}
              >
                {ws.name}
              </button>
            ))}
          <div className="h-px bg-line mx-2 my-1" />
          <button
            className="block w-full px-3 py-1.5 text-left text-danger hover:bg-panel2/60"
            onClick={() => {
              deleteRow(contextMenu.rowId);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}

      {/* ─── Tab Context Menu ─── */}
      {tabMenu && (
        <div
          className="fixed z-50 min-w-[140px] rounded-lg border border-line bg-panel shadow-lg py-1 text-xs"
          style={{ left: tabMenu.x, top: tabMenu.y }}
        >
          <button
            className="block w-full px-3 py-1.5 text-left hover:bg-panel2/60"
            onClick={() => {
              const ws = findWs(workspace, tabMenu.wsId);
              if (ws) {
                setRenameWsId(ws.id);
                setRenameWsName(ws.name);
              }
              setTabMenu(null);
            }}
          >
            Rename
          </button>
          <button
            className="block w-full px-3 py-1.5 text-left text-danger hover:bg-panel2/60"
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

      {/* ─── New Worksheet Modal ─── */}
      <ModalBackdrop open={showNewWsModal} onClose={() => setShowNewWsModal(false)} size="sm">
        <Card>
          <CardHeader>
            <CardTitle>New Worksheet</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Input
              placeholder="Worksheet name"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateWorksheet();
              }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setShowNewWsModal(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateWorksheet} disabled={!newWsName.trim() || isPending}>
                Create
              </Button>
            </div>
          </CardBody>
        </Card>
      </ModalBackdrop>

      {/* ─── Rename Worksheet Modal ─── */}
      <ModalBackdrop
        open={renameWsId !== null}
        onClose={() => {
          setRenameWsId(null);
          setRenameWsName("");
        }}
        size="sm"
      >
        <Card>
          <CardHeader>
            <CardTitle>Rename Worksheet</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <Input
              placeholder="Worksheet name"
              value={renameWsName}
              onChange={(e) => setRenameWsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRenameWorksheet();
              }}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRenameWsId(null);
                  setRenameWsName("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleRenameWorksheet}
                disabled={!renameWsName.trim() || isPending}
              >
                Rename
              </Button>
            </div>
          </CardBody>
        </Card>
      </ModalBackdrop>

      {/* ─── Description Popup ─── */}
      <ModalBackdrop
        open={descPopup !== null}
        onClose={() => setDescPopup(null)}
        size="md"
      >
        <Card>
          <CardHeader>
            <CardTitle>Edit Description</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <textarea
              className="min-h-32 w-full rounded-lg border border-line bg-bg/50 px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
              value={descPopup?.value ?? ""}
              onChange={(e) => setDescPopup((p) => (p ? { ...p, value: e.target.value } : p))}
              autoFocus
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setDescPopup(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveDescPopup} disabled={isPending}>
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      </ModalBackdrop>
    </div>
  );
}

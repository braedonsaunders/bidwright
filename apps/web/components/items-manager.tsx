"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Check,
  ChevronDown,
  Edit3,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CatalogSummary, CatalogItem } from "@/lib/api";
import {
  createCatalog,
  updateCatalog,
  deleteCatalog,
  listCatalogItems,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  searchCatalogItems,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  EmptyState,
  FadeIn,
  Input,
  Select,
} from "@/components/ui";

/* ─── Constants ─── */

const CATALOG_KINDS = [
  { value: "labor", label: "Labor" },
  { value: "equipment", label: "Equipment" },
  { value: "materials", label: "Materials" },
  { value: "knowledge_library", label: "Knowledge Library" },
  { value: "rate_book", label: "Rate Book" },
] as const;

const CATALOG_SCOPES = [
  { value: "global", label: "Global" },
  { value: "project", label: "Project" },
] as const;

const ITEM_CATEGORIES = [
  "Labour",
  "Equipment",
  "Material",
  "Consumable",
  "Stock Item",
  "Subcontract",
  "Other Charges",
] as const;

const ITEM_UNITS = [
  "EA", "LF", "FT", "HR", "DAY", "WK", "MO", "SF", "SY",
  "CY", "TON", "GAL", "LB", "LS", "LOT", "SET", "PR", "PKG",
] as const;

type EditingCell = { itemId: string; field: string } | null;

const KIND_BADGE_TONE: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  labor: "warning",
  equipment: "info",
  materials: "success",
  knowledge_library: "default",
  rate_book: "danger",
};

/* ─── Helpers ─── */

function computeMargin(cost: number, price: number): number {
  if (price === 0) return 0;
  return (price - cost) / price;
}

/* ─── Component ─── */

export function ItemsManager({
  catalogs: initialCatalogs,
}: {
  catalogs: CatalogSummary[];
}) {
  const [catalogs, setCatalogs] = useState(initialCatalogs);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(
    initialCatalogs[0]?.id ?? null
  );
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // New catalog form
  const [showNewCatalog, setShowNewCatalog] = useState(false);
  const [newCatalog, setNewCatalog] = useState({
    name: "",
    kind: "materials",
    scope: "global",
    description: "",
  });

  // Edit catalog
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editCatalogName, setEditCatalogName] = useState("");

  const selectedCatalog = catalogs.find((c) => c.id === selectedCatalogId);

  // Load items when catalog changes
  useEffect(() => {
    if (!selectedCatalogId) {
      setItems([]);
      return;
    }
    setLoadingItems(true);
    listCatalogItems(selectedCatalogId)
      .then((result) => setItems(result))
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false));
  }, [selectedCatalogId]);

  // Filter items
  const filteredItems = useMemo(() => {
    let filtered = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.code.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          (typeof item.metadata?.category === "string" &&
            item.metadata.category.toLowerCase().includes(q))
      );
    }
    if (categoryFilter) {
      filtered = filtered.filter(
        (item) => item.metadata?.category === categoryFilter
      );
    }
    return filtered;
  }, [items, search, categoryFilter]);

  // Catalog CRUD
  const handleCreateCatalog = useCallback(async () => {
    if (!newCatalog.name.trim()) return;
    try {
      const created = await createCatalog({
        name: newCatalog.name.trim(),
        kind: newCatalog.kind,
        scope: newCatalog.scope,
        description: newCatalog.description,
      });
      setCatalogs((prev) => [...prev, { ...created, items: [] }]);
      setSelectedCatalogId(created.id);
      setNewCatalog({ name: "", kind: "materials", scope: "global", description: "" });
      setShowNewCatalog(false);
    } catch (err) {
      console.error("Failed to create catalog:", err);
    }
  }, [newCatalog]);

  const handleUpdateCatalogName = useCallback(async () => {
    if (!editingCatalogId || !editCatalogName.trim()) return;
    try {
      const updated = await updateCatalog(editingCatalogId, {
        name: editCatalogName.trim(),
      });
      setCatalogs((prev) =>
        prev.map((c) => (c.id === editingCatalogId ? { ...c, name: updated.name } : c))
      );
    } catch (err) {
      console.error("Failed to update catalog:", err);
    }
    setEditingCatalogId(null);
  }, [editingCatalogId, editCatalogName]);

  const handleDeleteCatalog = useCallback(async (catalogId: string) => {
    try {
      await deleteCatalog(catalogId);
      setCatalogs((prev) => prev.filter((c) => c.id !== catalogId));
      if (selectedCatalogId === catalogId) {
        setSelectedCatalogId(null);
        setItems([]);
      }
    } catch (err) {
      console.error("Failed to delete catalog:", err);
    }
  }, [selectedCatalogId]);

  // Item CRUD
  const handleAddItem = useCallback(async () => {
    if (!selectedCatalogId) return;
    try {
      const created = await createCatalogItem(selectedCatalogId, {
        code: "",
        name: "New Item",
        unit: "EA",
        unitCost: 0,
        unitPrice: 0,
        category: "",
      });
      setItems((prev) => [...prev, created]);
    } catch (err) {
      console.error("Failed to create item:", err);
    }
  }, [selectedCatalogId]);

  const startEdit = (itemId: string, field: string, currentValue: string | number) => {
    setEditingCell({ itemId, field });
    setEditValue(String(currentValue ?? ""));
  };

  const commitEdit = useCallback(async () => {
    if (!editingCell || !selectedCatalogId) return;
    const { itemId, field } = editingCell;
    const numericFields = ["unitCost", "unitPrice"];
    const value = numericFields.includes(field)
      ? parseFloat(editValue) || 0
      : editValue;

    // Optimistic update
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        if (field === "category") {
          return { ...item, metadata: { ...item.metadata, category: value as string } };
        }
        return { ...item, [field]: value };
      })
    );
    setEditingCell(null);

    // Persist
    try {
      const patch: Record<string, unknown> = {};
      if (field === "category") {
        patch.category = value;
      } else {
        patch[field] = value;
      }
      await updateCatalogItem(selectedCatalogId, itemId, patch as Partial<CatalogItem> & { category?: string });
    } catch (err) {
      console.error("Failed to update item:", err);
    }
  }, [editingCell, editValue, selectedCatalogId]);

  const cancelEdit = () => setEditingCell(null);

  const handleDeleteItem = useCallback(async (itemId: string) => {
    if (!selectedCatalogId) return;
    try {
      await deleteCatalogItem(selectedCatalogId, itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      setSelectedItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  }, [selectedCatalogId]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedCatalogId || selectedItems.size === 0) return;
    const ids = Array.from(selectedItems);
    try {
      await Promise.all(ids.map((id) => deleteCatalogItem(selectedCatalogId, id)));
      setItems((prev) => prev.filter((i) => !selectedItems.has(i.id)));
      setSelectedItems(new Set());
    } catch (err) {
      console.error("Failed to delete items:", err);
    }
  }, [selectedCatalogId, selectedItems]);

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((i) => i.id)));
    }
  };

  // Select handling for dropdowns
  const handleSelectCommit = useCallback(async (itemId: string, field: string, value: string) => {
    if (!selectedCatalogId) return;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        if (field === "category") {
          return { ...item, metadata: { ...item.metadata, category: value } };
        }
        return { ...item, [field]: value };
      })
    );
    try {
      const patch: Record<string, unknown> = {};
      if (field === "category") {
        patch.category = value;
      } else {
        patch[field] = value;
      }
      await updateCatalogItem(selectedCatalogId, itemId, patch as Partial<CatalogItem> & { category?: string });
    } catch (err) {
      console.error("Failed to update item:", err);
    }
  }, [selectedCatalogId]);

  const columns = [
    { key: "code", label: "Code", className: "w-28", editable: true, type: "text" as const },
    { key: "name", label: "Name", className: "min-w-[160px]", editable: true, type: "text" as const },
    { key: "category", label: "Category", className: "w-32", editable: true, type: "select" as const },
    { key: "unit", label: "Unit", className: "w-20", editable: true, type: "select" as const },
    { key: "unitCost", label: "Unit Cost", className: "w-28 text-right", editable: true, type: "number" as const },
    { key: "unitPrice", label: "Unit Price", className: "w-28 text-right", editable: true, type: "number" as const },
    { key: "margin", label: "Margin", className: "w-24 text-right", editable: false, type: "text" as const },
  ];

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Items &amp; Catalogs</h1>
            <p className="text-xs text-fg/50">
              Manage your material, labor, and equipment catalogs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled>
              <Upload className="h-3.5 w-3.5" />
              Import
            </Button>
          </div>
        </div>
      </FadeIn>

      <div className="flex gap-5">
        {/* ─── Catalog Sidebar ─── */}
        <FadeIn delay={0.05} className="w-60 shrink-0">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Catalogs</CardTitle>
              <button
                onClick={() => setShowNewCatalog(true)}
                className="text-fg/40 hover:text-accent transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </CardHeader>
            <div className="p-2 space-y-0.5">
              <AnimatePresence>
                {showNewCatalog && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 px-2 py-2 mb-1 border border-line rounded-lg bg-panel2/30"
                  >
                    <Input
                      className="h-7 text-xs"
                      placeholder="Catalog name"
                      value={newCatalog.name}
                      onChange={(e) =>
                        setNewCatalog((p) => ({ ...p, name: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateCatalog();
                        if (e.key === "Escape") setShowNewCatalog(false);
                      }}
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Select
                        className="h-7 text-xs flex-1"
                        value={newCatalog.kind}
                        onChange={(e) =>
                          setNewCatalog((p) => ({ ...p, kind: e.target.value }))
                        }
                      >
                        {CATALOG_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        className="h-7 text-xs w-20"
                        value={newCatalog.scope}
                        onChange={(e) =>
                          setNewCatalog((p) => ({ ...p, scope: e.target.value }))
                        }
                      >
                        {CATALOG_SCOPES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={handleCreateCatalog}
                        className="text-success hover:text-success/80"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setShowNewCatalog(false)}
                        className="text-fg/40 hover:text-fg/60"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {catalogs.length === 0 && !showNewCatalog && (
                <p className="px-3 py-4 text-center text-xs text-fg/40">
                  No catalogs yet
                </p>
              )}

              {catalogs.map((catalog) => (
                <div
                  key={catalog.id}
                  className={cn(
                    "group flex items-center gap-1 rounded-lg px-2 py-2 text-left text-xs transition-colors",
                    selectedCatalogId === catalog.id
                      ? "bg-accent/10 text-accent font-medium"
                      : "text-fg/60 hover:bg-panel2 hover:text-fg/80"
                  )}
                >
                  {editingCatalogId === catalog.id ? (
                    <Input
                      className="h-6 text-xs flex-1"
                      value={editCatalogName}
                      onChange={(e) => setEditCatalogName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdateCatalogName();
                        if (e.key === "Escape") setEditingCatalogId(null);
                      }}
                      onBlur={handleUpdateCatalogName}
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setSelectedCatalogId(catalog.id)}
                      className="flex-1 truncate text-left"
                    >
                      {catalog.name}
                    </button>
                  )}

                  <Badge
                    tone={KIND_BADGE_TONE[catalog.kind] ?? "default"}
                    className="shrink-0 text-[9px]"
                  >
                    {catalog.kind}
                  </Badge>

                  {catalog.scope === "project" && (
                    <span className="shrink-0 text-[9px] text-fg/30">PRJ</span>
                  )}

                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCatalogId(catalog.id);
                        setEditCatalogName(catalog.name);
                      }}
                      className="text-fg/30 hover:text-fg/60"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCatalog(catalog.id);
                      }}
                      className="text-fg/30 hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </FadeIn>

        {/* ─── Items Table ─── */}
        <FadeIn delay={0.1} className="min-w-0 flex-1">
          <Card>
            {/* Toolbar */}
            <div className="flex items-center gap-3 border-b border-line px-5 py-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/25" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Search items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <Select
                className="h-8 w-36 text-xs"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories</option>
                {ITEM_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </Select>

              {selectedItems.size > 0 && (
                <Button variant="danger" size="sm" onClick={handleBulkDelete}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete {selectedItems.size}
                </Button>
              )}

              <Button
                variant="accent"
                size="sm"
                onClick={handleAddItem}
                disabled={!selectedCatalogId}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </Button>
            </div>

            {!selectedCatalog ? (
              <EmptyState className="m-5">
                <Package className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                Select a catalog to view items
              </EmptyState>
            ) : loadingItems ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={
                            filteredItems.length > 0 &&
                            selectedItems.size === filteredItems.length
                          }
                          onChange={toggleSelectAll}
                          className="rounded border-line"
                        />
                      </th>
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          className={cn(
                            "px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40",
                            col.className
                          )}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="w-12 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 && (
                      <tr>
                        <td
                          colSpan={columns.length + 2}
                          className="px-5 py-12 text-center text-sm text-fg/40"
                        >
                          <Package className="mx-auto mb-2 h-8 w-8 text-fg/20" />
                          No items in this catalog
                        </td>
                      </tr>
                    )}
                    {filteredItems.map((item, i) => {
                      const category =
                        (item.metadata?.category as string) ?? "";
                      const margin = computeMargin(
                        item.unitCost,
                        item.unitPrice
                      );

                      return (
                        <motion.tr
                          key={item.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.2,
                            delay: Math.min(i * 0.02, 0.3),
                            ease: "easeOut",
                          }}
                          className="border-b border-line last:border-0 hover:bg-panel2/40 transition-colors group"
                        >
                          {/* Checkbox */}
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.id)}
                              onChange={() => toggleSelectItem(item.id)}
                              className="rounded border-line"
                            />
                          </td>

                          {columns.map((col) => {
                            const isEditing =
                              editingCell?.itemId === item.id &&
                              editingCell?.field === col.key;

                            let rawValue: string | number;
                            if (col.key === "category") {
                              rawValue = category;
                            } else if (col.key === "margin") {
                              rawValue = margin;
                            } else {
                              rawValue = (
                                item as unknown as Record<string, string | number>
                              )[col.key] ?? "";
                            }

                            let displayValue: string;
                            if (col.key === "unitCost" || col.key === "unitPrice") {
                              displayValue = formatMoney(rawValue as number, 2);
                            } else if (col.key === "margin") {
                              displayValue = formatPercent(rawValue as number);
                            } else {
                              displayValue = String(rawValue ?? "");
                            }

                            // Non-editable column (margin)
                            if (!col.editable) {
                              return (
                                <td
                                  key={col.key}
                                  className={cn(
                                    "px-4 py-2.5 text-xs",
                                    col.className
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "text-fg/70",
                                      col.key === "margin" &&
                                        margin > 0 &&
                                        "text-success",
                                      col.key === "margin" &&
                                        margin < 0 &&
                                        "text-danger"
                                    )}
                                  >
                                    {displayValue}
                                  </span>
                                </td>
                              );
                            }

                            // Select-based edit (category, unit)
                            if (col.type === "select") {
                              const options =
                                col.key === "category"
                                  ? ITEM_CATEGORIES
                                  : ITEM_UNITS;
                              return (
                                <td
                                  key={col.key}
                                  className={cn(
                                    "px-4 py-2.5 text-xs",
                                    col.className
                                  )}
                                >
                                  <Select
                                    className="h-7 text-xs w-full bg-transparent border-0 p-0"
                                    value={String(rawValue)}
                                    onChange={(e) =>
                                      handleSelectCommit(
                                        item.id,
                                        col.key,
                                        e.target.value
                                      )
                                    }
                                  >
                                    <option value="">--</option>
                                    {options.map((o) => (
                                      <option key={o} value={o}>
                                        {o}
                                      </option>
                                    ))}
                                  </Select>
                                </td>
                              );
                            }

                            // Text / number inline edit
                            return (
                              <td
                                key={col.key}
                                className={cn(
                                  "px-4 py-2.5 text-xs",
                                  col.className,
                                  !isEditing && "cursor-pointer"
                                )}
                                onClick={() => {
                                  if (!isEditing)
                                    startEdit(item.id, col.key, rawValue);
                                }}
                              >
                                {isEditing ? (
                                  <Input
                                    className="h-7 text-xs"
                                    type={col.type === "number" ? "number" : "text"}
                                    value={editValue}
                                    onChange={(e) =>
                                      setEditValue(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitEdit();
                                      if (e.key === "Escape") cancelEdit();
                                    }}
                                    onBlur={commitEdit}
                                    autoFocus
                                  />
                                ) : (
                                  <span className="text-fg/70">
                                    {displayValue || (
                                      <span className="text-fg/25 italic">
                                        empty
                                      </span>
                                    )}
                                  </span>
                                )}
                              </td>
                            );
                          })}

                          {/* Delete button */}
                          <td className="px-3 py-2.5">
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="opacity-0 group-hover:opacity-100 text-fg/30 hover:text-danger transition-all"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </FadeIn>
      </div>
    </div>
  );
}

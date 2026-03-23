"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
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

/* ─── Item Detail Drawer ─── */

function CatalogItemDrawer({
  item,
  catalogId,
  onSave,
  onDelete,
  onClose,
}: {
  item: CatalogItem;
  catalogId: string;
  onSave: (updated: CatalogItem) => void;
  onDelete: (itemId: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    code: item.code,
    name: item.name,
    unit: item.unit,
    unitCost: item.unitCost,
    unitPrice: item.unitPrice,
    category: (item.metadata?.category as string) ?? "",
  });

  useEffect(() => {
    setForm({
      code: item.code,
      name: item.name,
      unit: item.unit,
      unitCost: item.unitCost,
      unitPrice: item.unitPrice,
      category: (item.metadata?.category as string) ?? "",
    });
  }, [item]);

  const margin = computeMargin(form.unitCost, form.unitPrice);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await updateCatalogItem(catalogId, item.id, {
        code: form.code,
        name: form.name,
        unit: form.unit,
        unitCost: form.unitCost,
        unitPrice: form.unitPrice,
        category: form.category,
      } as Partial<CatalogItem> & { category?: string });
      onSave(updated);
    } catch (err) {
      console.error("Failed to update item:", err);
    } finally {
      setSaving(false);
    }
  }, [catalogId, item.id, form, onSave]);

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed inset-y-0 right-0 z-40 w-[400px] bg-panel border-l border-line shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-line bg-panel2/40">
        <div className="flex items-center gap-2 min-w-0">
          {form.category && (
            <Badge tone="default" className="shrink-0 text-[10px]">
              {form.category}
            </Badge>
          )}
          <span className="text-sm font-semibold truncate">
            {form.name || "New Item"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded hover:bg-danger/10 text-fg/40 hover:text-danger transition-colors"
            onClick={() => onDelete(item.id)}
            title="Delete item"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors"
            onClick={onClose}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div>
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            Item Code
          </label>
          <Input
            className="mt-1"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="e.g. MAT-001"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            Name
          </label>
          <Input
            className="mt-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Item name"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              Category
            </label>
            <Select
              className="mt-1"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">None</option>
              {ITEM_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </Select>
          </div>

          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              Unit
            </label>
            <Select
              className="mt-1"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            >
              {ITEM_UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              Unit Cost
            </label>
            <Input
              className="mt-1"
              type="number"
              step="0.01"
              value={form.unitCost}
              onChange={(e) =>
                setForm({ ...form, unitCost: Number(e.target.value) || 0 })
              }
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              Unit Price
            </label>
            <Input
              className="mt-1"
              type="number"
              step="0.01"
              value={form.unitPrice}
              onChange={(e) =>
                setForm({ ...form, unitPrice: Number(e.target.value) || 0 })
              }
            />
          </div>
        </div>

        {/* Calculated Margin */}
        <div className="p-3 bg-panel2/30 rounded-lg">
          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
            Margin
          </label>
          <div
            className={cn(
              "mt-1 text-lg font-semibold tabular-nums",
              margin > 0 && "text-success",
              margin < 0 && "text-danger",
              margin === 0 && "text-fg/50"
            )}
          >
            {formatPercent(margin)}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-line px-5 py-3 flex items-center justify-end gap-2 bg-panel2/20">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="accent" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </motion.div>
  );
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

  // Sync when parent finishes fetching catalogs
  useEffect(() => {
    setCatalogs(initialCatalogs);
    setSelectedCatalogId((prev) => prev ?? initialCatalogs[0]?.id ?? null);
  }, [initialCatalogs]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null);

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
  const drawerItem = drawerItemId ? items.find((i) => i.id === drawerItemId) : null;

  // Load items when catalog changes
  useEffect(() => {
    if (!selectedCatalogId) {
      setItems([]);
      return;
    }
    setLoadingItems(true);
    setDrawerItemId(null);
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
      setDrawerItemId(created.id);
    } catch (err) {
      console.error("Failed to create item:", err);
    }
  }, [selectedCatalogId]);

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
      if (drawerItemId === itemId) setDrawerItemId(null);
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  }, [selectedCatalogId, drawerItemId]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedCatalogId || selectedItems.size === 0) return;
    const ids = Array.from(selectedItems);
    try {
      await Promise.all(ids.map((id) => deleteCatalogItem(selectedCatalogId, id)));
      setItems((prev) => prev.filter((i) => !selectedItems.has(i.id)));
      setSelectedItems(new Set());
      if (drawerItemId && ids.includes(drawerItemId)) setDrawerItemId(null);
    } catch (err) {
      console.error("Failed to delete items:", err);
    }
  }, [selectedCatalogId, selectedItems, drawerItemId]);

  const handleDrawerSave = useCallback((updated: CatalogItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  const toggleSelectItem = (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
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

  const columns = [
    { key: "code", label: "Code", className: "w-28" },
    { key: "name", label: "Name", className: "min-w-[160px]" },
    { key: "category", label: "Category", className: "w-32" },
    { key: "unit", label: "Unit", className: "w-20" },
    { key: "unitCost", label: "Unit Cost", className: "w-28 text-right" },
    { key: "unitPrice", label: "Unit Price", className: "w-28 text-right" },
    { key: "margin", label: "Margin", className: "w-24 text-right" },
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
                className="whitespace-nowrap"
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.length === 0 && (
                      <tr>
                        <td
                          colSpan={columns.length + 1}
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
                      const isActive = drawerItemId === item.id;

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
                          onClick={() => setDrawerItemId(item.id)}
                          className={cn(
                            "border-b border-line last:border-0 transition-colors cursor-pointer",
                            isActive
                              ? "bg-accent/5"
                              : "hover:bg-panel2/40"
                          )}
                        >
                          {/* Checkbox */}
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={selectedItems.has(item.id)}
                              onChange={() => {}}
                              onClick={(e) => toggleSelectItem(e, item.id)}
                              className="rounded border-line"
                            />
                          </td>

                          {columns.map((col) => {
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
                                  {displayValue || (
                                    <span className="text-fg/25 italic">
                                      —
                                    </span>
                                  )}
                                </span>
                              </td>
                            );
                          })}
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

      {/* ─── Item Detail Drawer ─── */}
      <AnimatePresence>
        {drawerItem && selectedCatalogId && (
          <CatalogItemDrawer
            key={drawerItem.id}
            item={drawerItem}
            catalogId={selectedCatalogId}
            onSave={handleDrawerSave}
            onDelete={handleDeleteItem}
            onClose={() => setDrawerItemId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

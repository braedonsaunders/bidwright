"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Check,
  Edit3,
  FileSpreadsheet,
  Library,
  Loader2,
  Package,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent } from "@/lib/format";
import type { CatalogSummary, CatalogItem, EntityCategory } from "@/lib/api";
import { CatalogImportModal } from "@/components/catalog-import-modal";
import { ConfirmModal } from "@/components/workspace/modals";
import {
  createCatalog,
  updateCatalog,
  deleteCatalog,
  listCatalogItems,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem,
  getEntityCategories,
  listCatalogLibrary,
  getCatalogLibraryItem,
  adoptCatalogTemplate,
} from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  Drawer,
  EmptyState,
  Input,
  RecordList,
  type RecordColumn,
  SearchSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@appkit/ui";
import { UomSelect } from "@/components/shared/uom-select";

/* ─── Constants ─── */

const LEGACY_CATALOG_KIND_LABELS: Record<string, string> = {
  labor: "Labour",
  labour: "Labour",
  equipment: "Equipment",
  materials: "Material",
  material: "Material",
  knowledge_library: "Knowledge Library",
  rate_book: "Rate Book",
  subcontract: "Subcontract",
};

type CatalogBadgeVariant = "secondary" | "success" | "warning" | "destructive" | "info";

const KIND_BADGE_TONE: Record<string, CatalogBadgeVariant> = {
  labor: "warning",
  labour: "warning",
  labourclass: "warning",
  equipment: "info",
  equipmentrate: "info",
  rentalequipment: "info",
  materials: "success",
  material: "success",
  stockitem: "success",
  consumable: "success",
  rate_book: "destructive",
};

/* ─── Helpers ─── */

function computeMargin(cost: number, price: number): number {
  if (price === 0) return 0;
  return (price - cost) / price;
}

function normalizeToken(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function humanizeToken(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function catalogKindValue(category: EntityCategory) {
  return category.entityType?.trim() || category.name.trim();
}

function catalogKindLabel(kind: string, categories: EntityCategory[]) {
  const normalizedKind = normalizeToken(kind);
  const matchedCategory = categories.find((category) => {
    return [category.entityType, category.name, category.id].some((candidate) => normalizeToken(candidate) === normalizedKind);
  });
  return matchedCategory?.name ?? LEGACY_CATALOG_KIND_LABELS[kind] ?? LEGACY_CATALOG_KIND_LABELS[normalizedKind] ?? humanizeToken(kind);
}

function catalogKindTone(kind: string, categories: EntityCategory[]): CatalogBadgeVariant {
  const label = catalogKindLabel(kind, categories);
  const normalized = normalizeToken(`${kind} ${label}`);
  if (KIND_BADGE_TONE[normalizeToken(kind)]) return KIND_BADGE_TONE[normalizeToken(kind)];
  if (normalized.includes("labour") || normalized.includes("labor")) return "warning";
  if (normalized.includes("equipment") || normalized.includes("rental")) return "info";
  if (normalized.includes("material") || normalized.includes("stock") || normalized.includes("consumable")) return "success";
  if (normalized.includes("ratebook")) return "destructive";
  return "secondary";
}

function isCatalogNotFoundError(error: unknown) {
  return error instanceof Error && /catalog not found|404 not found/i.test(error.message);
}

/* ─── Item Detail Drawer ─── */

function CatalogItemDrawer({
  categoryOptions,
  item,
  catalogId,
  onSave,
  onDelete,
  onClose,
}: {
  categoryOptions: string[];
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
      onClose();
    } catch (err) {
      console.error("Failed to update item:", err);
    } finally {
      setSaving(false);
    }
  }, [catalogId, item.id, form, onSave]);

  return (
    <Drawer
      open
      onClose={onClose}
      size="sm"
      title={(
        <div className="flex min-w-0 items-center gap-2">
          {form.category && <Badge variant="secondary">{form.category}</Badge>}
          <span className="truncate">{form.name || "New item"}</span>
        </div>
      )}
      description={form.code || "Catalog item"}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          <Button variant="destructive" size="sm" onClick={() => onDelete(item.id)}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save item"}
            </Button>
          </div>
        </div>
      )}
    >
      <div className="space-y-4">
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
            <SearchSelect
              className="mt-1"
              value={form.category}
              onChange={(value) => setForm({ ...form, category: value })}
              options={categoryOptions.map((category) => ({ value: category, label: category }))}
              clearable
              emptyLabel="None"
              searchable
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">
              Unit
            </label>
            <UomSelect
              className="mt-1"
              value={form.unit}
              onValueChange={(v) => setForm({ ...form, unit: v })}
            />
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
    </Drawer>
  );
}

/* ─── Component ─── */

export function ItemsManager({
  catalogs: initialCatalogs,
  embedded = false,
  onCatalogsChange,
}: {
  catalogs: CatalogSummary[];
  embedded?: boolean;
  onCatalogsChange?: (catalogs: CatalogSummary[]) => void;
}) {
  const [catalogs, setCatalogs] = useState(initialCatalogs);
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(
    initialCatalogs[0]?.id ?? null
  );
  const [deletedCatalogIds, setDeletedCatalogIds] = useState<Set<string>>(new Set());
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);

  // Sync when parent finishes fetching catalogs (but exclude locally deleted ones)
  useEffect(() => {
    const visibleCatalogs = initialCatalogs.filter((c) => !deletedCatalogIds.has(c.id));
    setCatalogs(visibleCatalogs);
    setSelectedCatalogId((prev) => (
      prev && visibleCatalogs.some((catalog) => catalog.id === prev)
        ? prev
        : visibleCatalogs[0]?.id ?? null
    ));
  }, [initialCatalogs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getEntityCategories()
      .then((categories) => setEntityCategories(categories.filter((category) => category.enabled !== false)))
      .catch(() => setEntityCategories([]));
  }, []);

  const publishCatalogs = useCallback((nextCatalogs: CatalogSummary[]) => {
    setCatalogs(nextCatalogs);
    onCatalogsChange?.(nextCatalogs);
  }, [onCatalogsChange]);

  const updateCatalogs = useCallback((updater: (current: CatalogSummary[]) => CatalogSummary[]) => {
    publishCatalogs(updater(catalogs));
  }, [catalogs, publishCatalogs]);

  const updateCatalogItemCount = useCallback((
    catalogId: string,
    delta: number,
    updateItems?: (items: CatalogItem[]) => CatalogItem[],
  ) => {
    updateCatalogs((current) =>
      current.map((catalog) => {
        if (catalog.id !== catalogId) return catalog;
        const currentCount = catalog.itemCount ?? catalog.items?.length ?? 0;
        return {
          ...catalog,
          itemCount: Math.max(0, currentCount + delta),
          items: catalog.items && updateItems ? updateItems(catalog.items) : catalog.items,
        };
      }),
    );
  }, [updateCatalogs]);

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [drawerItemId, setDrawerItemId] = useState<string | null>(null);

  // AI-assisted bulk import
  const [showImport, setShowImport] = useState(false);

  // New catalog form
  const [showNewCatalog, setShowNewCatalog] = useState(false);
  const [newCatalog, setNewCatalog] = useState({
    name: "",
    category: "",
    description: "",
  });

  // Edit catalog
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editCatalogName, setEditCatalogName] = useState("");
  const [deleteCatalogId, setDeleteCatalogId] = useState<string | null>(null);
  const [deletingCatalogId, setDeletingCatalogId] = useState<string | null>(null);
  const [deleteCatalogError, setDeleteCatalogError] = useState<string | null>(null);

  // Library browser
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryTemplates, setLibraryTemplates] = useState<CatalogSummary[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryPreview, setLibraryPreview] = useState<(CatalogSummary & { items: CatalogItem[]; total: number }) | null>(null);
  const [libraryPreviewLoading, setLibraryPreviewLoading] = useState(false);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);

  const selectedCatalog = catalogs.find((c) => c.id === selectedCatalogId);
  const deleteCatalogTarget = catalogs.find((c) => c.id === deleteCatalogId) ?? null;
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

  const catalogCategoryOptions = useMemo(() => {
    const seen = new Set<string>();
    return entityCategories
      .map((category) => ({
        value: catalogKindValue(category),
        label: category.name.trim(),
      }))
      .filter((option) => {
        const key = normalizeToken(option.value);
        if (!option.value || !option.label || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [entityCategories]);

  const itemCategoryOptions = useMemo(() => {
    const ordered = new Map<string, string>();
    for (const category of entityCategories) {
      const label = category.name.trim();
      if (label) ordered.set(normalizeToken(label), label);
    }
    for (const item of items) {
      const label = typeof item.metadata?.category === "string" ? item.metadata.category.trim() : "";
      if (label && !ordered.has(normalizeToken(label))) ordered.set(normalizeToken(label), label);
    }
    return Array.from(ordered.values());
  }, [entityCategories, items]);

  useEffect(() => {
    if (catalogCategoryOptions.length === 0) return;
    setNewCatalog((current) => {
      if (catalogCategoryOptions.some((option) => option.value === current.category)) return current;
      return { ...current, category: catalogCategoryOptions[0].value };
    });
  }, [catalogCategoryOptions]);

  // Reset page when filters change
  useEffect(() => { setPage(0); }, [search, categoryFilter, selectedCatalogId]);

  const paginatedItems = filteredItems.slice(page * pageSize, (page + 1) * pageSize);

  // Catalog CRUD
  const handleCreateCatalog = useCallback(async () => {
    const category = newCatalog.category || catalogCategoryOptions[0]?.value || "";
    if (!newCatalog.name.trim() || !category) return;
    try {
      const created = await createCatalog({
        name: newCatalog.name.trim(),
        kind: category,
        scope: "global",
        description: newCatalog.description,
      });
      publishCatalogs([...catalogs, { ...created, items: [] }]);
      setSelectedCatalogId(created.id);
      setNewCatalog({ name: "", category, description: "" });
      setShowNewCatalog(false);
    } catch (err) {
      console.error("Failed to create catalog:", err);
    }
  }, [catalogCategoryOptions, catalogs, newCatalog, publishCatalogs]);

  const handleUpdateCatalogName = useCallback(async () => {
    if (!editingCatalogId || !editCatalogName.trim()) return;
    try {
      const updated = await updateCatalog(editingCatalogId, {
        name: editCatalogName.trim(),
      });
      publishCatalogs(catalogs.map((c) => (c.id === editingCatalogId ? { ...c, name: updated.name } : c)));
    } catch (err) {
      console.error("Failed to update catalog:", err);
    }
    setEditingCatalogId(null);
  }, [catalogs, editingCatalogId, editCatalogName, publishCatalogs]);

  const handleDeleteCatalog = useCallback(async () => {
    const target = deleteCatalogTarget;
    if (!target) return;
    const catalogId = target.id;
    setDeletingCatalogId(catalogId);
    setDeleteCatalogError(null);
    try {
      await deleteCatalog(catalogId);
      setDeletedCatalogIds((prev) => new Set(prev).add(catalogId));
      const nextCatalogs = catalogs.filter((c) => c.id !== catalogId);
      publishCatalogs(nextCatalogs);
      if (selectedCatalogId === catalogId) {
        setSelectedCatalogId(nextCatalogs[0]?.id ?? null);
        setItems([]);
      }
      setDeleteCatalogId(null);
    } catch (err) {
      if (isCatalogNotFoundError(err)) {
        setDeletedCatalogIds((prev) => new Set(prev).add(catalogId));
        const nextCatalogs = catalogs.filter((c) => c.id !== catalogId);
        publishCatalogs(nextCatalogs);
        if (selectedCatalogId === catalogId) {
          setSelectedCatalogId(nextCatalogs[0]?.id ?? null);
          setItems([]);
        }
        setDeleteCatalogId(null);
        return;
      }
      console.error("Failed to delete catalog:", err);
      setDeleteCatalogError(err instanceof Error ? err.message : "Failed to delete catalog.");
    } finally {
      setDeletingCatalogId(null);
    }
  }, [catalogs, deleteCatalogTarget, publishCatalogs, selectedCatalogId]);

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
      updateCatalogItemCount(selectedCatalogId, 1, (catalogItems) => [...catalogItems, created]);
      setDrawerItemId(created.id);
    } catch (err) {
      console.error("Failed to create item:", err);
    }
  }, [selectedCatalogId, updateCatalogItemCount]);

  const handleDeleteItem = useCallback(async (itemId: string) => {
    if (!selectedCatalogId) return;
    try {
      await deleteCatalogItem(selectedCatalogId, itemId);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      updateCatalogItemCount(selectedCatalogId, -1, (catalogItems) => catalogItems.filter((item) => item.id !== itemId));
      setSelectedItems((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
      if (drawerItemId === itemId) setDrawerItemId(null);
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  }, [selectedCatalogId, drawerItemId, updateCatalogItemCount]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedCatalogId || selectedItems.size === 0) return;
    const ids = Array.from(selectedItems);
    try {
      await Promise.all(ids.map((id) => deleteCatalogItem(selectedCatalogId, id)));
      setItems((prev) => prev.filter((i) => !selectedItems.has(i.id)));
      updateCatalogItemCount(selectedCatalogId, -ids.length, (catalogItems) => catalogItems.filter((item) => !selectedItems.has(item.id)));
      setSelectedItems(new Set());
      if (drawerItemId && ids.includes(drawerItemId)) setDrawerItemId(null);
    } catch (err) {
      console.error("Failed to delete items:", err);
    }
  }, [selectedCatalogId, selectedItems, drawerItemId, updateCatalogItemCount]);

  const handleDrawerSave = useCallback((updated: CatalogItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  }, []);

  // Library handlers
  const openLibrary = useCallback(async () => {
    setShowLibrary(true);
    setLibraryLoading(true);
    setLibraryPreview(null);
    try {
      const templates = await listCatalogLibrary();
      setLibraryTemplates(templates);
    } catch (err) {
      console.error("Failed to load catalog library:", err);
      setLibraryTemplates([]);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  const previewTemplate = useCallback(async (templateId: string) => {
    // Don't clear existing preview — keeps content visible while loading
    setLibraryPreviewLoading(true);
    try {
      const preview = await getCatalogLibraryItem(templateId, { limit: 50 });
      setLibraryPreview(preview);
    } catch (err) {
      console.error("Failed to preview template:", err);
    } finally {
      setLibraryPreviewLoading(false);
    }
  }, []);

  const handleAdopt = useCallback(async (templateId: string) => {
    setAdoptingId(templateId);
    try {
      const adopted = await adoptCatalogTemplate(templateId);
      publishCatalogs([...catalogs, adopted]);
      setSelectedCatalogId(adopted.id);
      setShowLibrary(false);
      setLibraryPreview(null);
    } catch (err) {
      console.error("Failed to adopt template:", err);
    } finally {
      setAdoptingId(null);
    }
  }, [catalogs, publishCatalogs]);

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

  const columns = useMemo<RecordColumn<CatalogItem>[]>(() => [
    {
      key: "selection",
      label: "",
      width: 40,
      render: (item) => (
        <input
          type="checkbox"
          checked={selectedItems.has(item.id)}
          onChange={() => {}}
          onClick={(event) => toggleSelectItem(event, item.id)}
          className="rounded border-border"
          aria-label={`Select ${item.name}`}
        />
      ),
    },
    { key: "code", label: "Code", width: 112, render: (item) => <span className="font-mono text-xs text-fg-muted">{item.code || "—"}</span> },
    { key: "name", label: "Name", width: "28%" },
    {
      key: "category",
      label: "Category",
      width: 140,
      render: (item) => {
        const category = typeof item.metadata?.category === "string" ? item.metadata.category : "";
        return category ? <Badge variant="secondary">{category}</Badge> : <span className="text-fg-subtle">—</span>;
      },
    },
    { key: "unit", label: "Unit", width: 80 },
    { key: "unitCost", label: "Unit cost", kind: "amount", width: 112, format: (value) => formatMoney(Number(value), 2) },
    { key: "unitPrice", label: "Unit price", kind: "amount", width: 112, format: (value) => formatMoney(Number(value), 2) },
    {
      key: "margin",
      label: "Margin",
      kind: "custom",
      align: "right",
      width: 96,
      render: (item) => {
        const margin = computeMargin(item.unitCost, item.unitPrice);
        return (
          <span className={cn("block text-right tabular-nums", margin > 0 && "text-success", margin < 0 && "text-danger")}>
            {formatPercent(margin)}
          </span>
        );
      },
    },
  ], [selectedItems]);
  const deleteTargetItemCount = deleteCatalogTarget?.itemCount ?? deleteCatalogTarget?.items?.length ?? 0;
  const deleteCatalogMessage = deleteCatalogTarget
    ? deleteCatalogError
      ? `Could not delete "${deleteCatalogTarget.name}": ${deleteCatalogError}`
      : `Delete "${deleteCatalogTarget.name}" and ${deleteTargetItemCount} catalog item${deleteTargetItemCount === 1 ? "" : "s"}? This cannot be undone.`
    : "";
  const catalogItemCount = (catalog: CatalogSummary) => {
    const savedCount = catalog.itemCount ?? catalog.items?.length ?? 0;
    if (catalog.id !== selectedCatalogId) return savedCount;
    return loadingItems ? savedCount : items.length;
  };

  return (
    <div className={cn(embedded ? "flex h-full min-h-0 flex-col gap-3" : "space-y-5")}>
      {!embedded && (
      <div>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Items &amp; Catalogs</CardTitle>
              <p className="text-xs text-fg/40 mt-0.5">
                Manage your material, labor, and equipment catalogs
              </p>
            </div>
            <Button variant="default" size="sm" onClick={openLibrary}>
              <Library className="h-3.5 w-3.5" />
              Browse Library
            </Button>
          </CardHeader>
        </Card>
      </div>
      )}

      <div className={cn("flex", embedded ? "min-h-0 flex-1 gap-3" : "gap-5")}>
        {/* ─── Catalog Sidebar ─── */}
        <div className={cn("w-60 shrink-0", embedded && "min-h-0")}>
          <Card className={cn("overflow-hidden", embedded && "flex h-full min-h-0 flex-col")}>
            <CardHeader className="flex shrink-0 flex-row items-center justify-between px-3 py-2.5">
              <CardTitle>Catalogs</CardTitle>
              <button
                onClick={() => setShowNewCatalog(true)}
                className="text-fg/40 hover:text-accent transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            </CardHeader>
            <div className={cn("space-y-0.5 p-2", embedded && "min-h-0 flex-1 overflow-y-auto")}>
              {showNewCatalog && (
                  <div className="mb-1 space-y-1.5 rounded-lg border border-line bg-panel2/30 px-2 py-2">
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
                    <SearchSelect
                      value={newCatalog.category}
                      onChange={(value) =>
                        setNewCatalog((current) => ({ ...current, category: value }))
                      }
                      options={
                        catalogCategoryOptions.length > 0
                          ? catalogCategoryOptions
                          : [{ value: "__no_categories__", label: "No categories available", disabled: true }]
                      }
                      placeholder="Category"
                      disabled={catalogCategoryOptions.length === 0}
                    />
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={handleCreateCatalog}
                        disabled={!newCatalog.name.trim() || !newCatalog.category}
                        className="text-success hover:text-success/80 disabled:pointer-events-none disabled:opacity-35"
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
                  </div>
              )}

              {catalogs.length === 0 && !showNewCatalog && (
                <p className="px-3 py-4 text-center text-xs text-fg/40">
                  No catalogs yet
                </p>
              )}

              {catalogs.map((catalog) => {
                const isSelected = selectedCatalogId === catalog.id;
                const itemCount = catalogItemCount(catalog);
                return (
                  <div
                    key={catalog.id}
                    className={cn(
                      "group flex items-center gap-1 rounded-lg px-2 py-2 text-left text-xs transition-colors",
                      isSelected
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
                        className="min-w-0 flex-1 truncate text-left"
                      >
                        {catalog.name}
                      </button>
                    )}

                    <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1">
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
                          isSelected ? "bg-accent/15 text-accent" : "bg-panel2 text-fg/45"
                        )}
                        title={`${itemCount} item${itemCount === 1 ? "" : "s"}`}
                      >
                        {itemCount}
                      </span>

                      <Badge
                        variant={catalogKindTone(catalog.kind, entityCategories)}
                        className="max-w-20 shrink-0 truncate text-[9px]"
                      >
                        {catalogKindLabel(catalog.kind, entityCategories)}
                      </Badge>
                    </div>

                    <div className="flex w-0 shrink-0 justify-end overflow-hidden opacity-0 transition-all group-hover:w-8 group-hover:opacity-100">
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
                          setDeleteCatalogError(null);
                          setDeleteCatalogId(catalog.id);
                        }}
                        title="Delete catalog"
                        aria-label={`Delete ${catalog.name}`}
                        className="text-fg/30 hover:text-danger"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ─── Items Table ─── */}
        <div className={cn("min-w-0 flex-1", embedded && "min-h-0")}>
          <Card className={cn(embedded && "flex h-full min-h-0 flex-col overflow-hidden")}>
            {!selectedCatalog ? (
              <div className="p-5">
                <EmptyState
                  icon={<Package />}
                  title="Select a catalog"
                  description="Choose a catalog from the left to view and edit its items."
                />
              </div>
            ) : loadingItems ? (
              <div className="flex items-center justify-center py-12 text-sm text-fg-muted">
                <Loader2 className="mr-2 size-4 animate-spin" /> Loading items…
              </div>
            ) : (
              <div className={cn("p-3", embedded && "min-h-0 flex-1")}>
                <RecordList
                  columns={columns}
                  rows={paginatedItems}
                  getRowId={(item) => item.id}
                  className={cn(embedded && "flex h-full min-h-0 flex-col")}
                  tableContainerClassName={cn(
                    "rounded-none border-0 shadow-none",
                    embedded && "min-h-0 flex-1 overflow-auto",
                  )}
                  search={{
                    value: search,
                    onChange: setSearch,
                    placeholder: "Search items by name, code, or category…",
                  }}
                  filters={(
                    <SearchSelect
                      className="w-44"
                      value={categoryFilter}
                      onChange={setCategoryFilter}
                      options={itemCategoryOptions.map((category) => ({ value: category, label: category }))}
                      clearable
                      emptyLabel="All categories"
                      searchable
                      ariaLabel="Filter by category"
                    />
                  )}
                  toolbarActions={(
                    <>
                      {filteredItems.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
                          {selectedItems.size === filteredItems.length ? "Clear selection" : "Select all"}
                        </Button>
                      )}
                      {selectedItems.size > 0 && (
                        <Button variant="destructive" size="sm" onClick={() => void handleBulkDelete()}>
                          <Trash2 className="size-3.5" /> Delete {selectedItems.size}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowImport(true)}
                        disabled={catalogs.length === 0}
                        title="Import items from XLSX, CSV, or PDF using AI column mapping"
                      >
                        <FileSpreadsheet className="size-3.5" /> Import
                      </Button>
                      <Button size="sm" onClick={() => void handleAddItem()} disabled={!selectedCatalogId}>
                        <Plus className="size-3.5" /> Add item
                      </Button>
                    </>
                  )}
                  pagination={{
                    page: page + 1,
                    perPage: pageSize,
                    total: filteredItems.length,
                    onPageChange: (nextPage) => setPage(nextPage - 1),
                  }}
                  empty={{
                    icon: <Package />,
                    title: search || categoryFilter ? "No items match these filters" : "No items in this catalog",
                    description: search || categoryFilter
                      ? "Try a broader search or clear the category filter."
                      : "Add or import the first catalog item.",
                    action: search || categoryFilter ? undefined : (
                      <Button size="sm" onClick={() => void handleAddItem()}><Plus className="size-3.5" /> Add item</Button>
                    ),
                  }}
                  onRowClick={(item) => setDrawerItemId(item.id)}
                />
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ─── Item Detail Drawer ─── */}
      {drawerItem && selectedCatalogId && (
        <CatalogItemDrawer
          key={drawerItem.id}
          categoryOptions={itemCategoryOptions}
          item={drawerItem}
          catalogId={selectedCatalogId}
          onSave={handleDrawerSave}
          onDelete={handleDeleteItem}
          onClose={() => setDrawerItemId(null)}
        />
      )}

      {/* ─── Library Browser Drawer ─── */}
      <Drawer
        open={showLibrary}
        onClose={() => { setShowLibrary(false); setLibraryPreview(null); }}
        size="xl"
        title="Catalog library"
        description="Browse and import catalog templates into your organization."
        bodyClassName="p-0"
      >
              <div className="flex h-[70vh] min-h-[520px]">
                {/* Template list */}
                <div className="w-64 border-r border-line overflow-y-auto p-3 space-y-1">
                  {libraryLoading ? (
                    <div className="flex items-center justify-center py-12 text-fg/40">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : libraryTemplates.length === 0 ? (
                    <div className="text-center py-12">
                      <Package className="h-8 w-8 mx-auto text-fg/20 mb-2" />
                      <p className="text-xs text-fg/40">No templates available</p>
                      <p className="text-[10px] text-fg/30 mt-1">Run the seed script to populate templates</p>
                    </div>
                  ) : (
                    libraryTemplates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => previewTemplate(template.id)}
                        className={cn(
                          "w-full text-left px-3 py-2.5 rounded-lg border transition-all",
                          libraryPreview?.id === template.id
                            ? "border-accent/40 bg-accent/5"
                            : "border-transparent hover:bg-panel2/40"
                        )}
                      >
                        <div className="text-sm font-medium text-fg truncate">{template.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={catalogKindTone(template.kind, entityCategories)} className="text-[10px]">
                            {catalogKindLabel(template.kind, entityCategories)}
                          </Badge>
                          {template.itemCount != null && (
                            <span className="text-[10px] text-fg/40">{template.itemCount} items</span>
                          )}
                        </div>
                        {template.description && (
                          <p className="text-[10px] text-fg/40 mt-1 line-clamp-2">{template.description}</p>
                        )}
                      </button>
                    ))
                  )}
                </div>

                {/* Preview panel */}
                <div className="flex-1 min-w-0 flex flex-col relative">
                  {/* Loading overlay — shown on top of existing content */}
                  {libraryPreviewLoading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-panel/60 backdrop-blur-[1px]">
                      <Loader2 className="h-5 w-5 animate-spin text-fg/40" />
                    </div>
                  )}
                  {!libraryPreview ? (
                    <div className="flex items-center justify-center flex-1 text-sm text-fg/40">
                      <div className="text-center space-y-2">
                        <Library className="h-8 w-8 mx-auto text-fg/20" />
                        <p>Select a template to preview</p>
                      </div>
                    </div>
                  ) : libraryPreview ? (
                    <>
                      <div className="px-5 py-4 border-b border-line">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-fg">{libraryPreview.name}</h3>
                            {libraryPreview.description && (
                              <p className="text-xs text-fg/50 mt-0.5">{libraryPreview.description}</p>
                            )}
                            <div className="flex items-center gap-3 mt-2 text-[10px] text-fg/40">
                              <span>{libraryPreview.total} items total</span>
                              {libraryPreview.sourceDescription && (
                                <span>{libraryPreview.sourceDescription}</span>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAdopt(libraryPreview.id)}
                            disabled={adoptingId === libraryPreview.id}
                          >
                            {adoptingId === libraryPreview.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                            {adoptingId === libraryPreview.id ? "Importing..." : "Import to My Catalogs"}
                          </Button>
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto">
                        <Table>
                          <TableHeader className="sticky top-0 bg-panel2/80 backdrop-blur-sm">
                            <TableRow noAnimate>
                              <TableHead>Code</TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Category</TableHead>
                              <TableHead>Unit</TableHead>
                              <TableHead className="text-right">Cost</TableHead>
                              <TableHead className="text-right">Price</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {libraryPreview.items.map((item, idx) => (
                              <TableRow key={item.id || idx}>
                                <TableCell className="font-mono text-fg-muted">{item.code || "—"}</TableCell>
                                <TableCell>{item.name}</TableCell>
                                <TableCell className="text-fg-muted">{(item.metadata as Record<string, string>)?.category || "—"}</TableCell>
                                <TableCell className="text-fg-muted">{item.unit}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {item.unitCost > 0 ? `$${item.unitCost.toFixed(2)}` : "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {item.unitPrice > 0 ? `$${item.unitPrice.toFixed(2)}` : "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {libraryPreview.total > libraryPreview.items.length && (
                          <div className="text-center py-3 text-[10px] text-fg/30">
                            Showing {libraryPreview.items.length} of {libraryPreview.total} items
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
      </Drawer>

      <ConfirmModal
        open={Boolean(deleteCatalogTarget)}
        onClose={() => {
          if (deletingCatalogId) return;
          setDeleteCatalogId(null);
          setDeleteCatalogError(null);
        }}
        title="Delete Catalog"
        message={deleteCatalogMessage}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={handleDeleteCatalog}
        isPending={Boolean(deletingCatalogId)}
      />

      <CatalogImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        catalogs={catalogs}
        defaultCatalogId={selectedCatalogId ?? undefined}
        onImported={(info) => {
          if (info.created > 0) {
            updateCatalogItemCount(info.catalogId, info.created);
          }
          // Re-trigger the items load by clearing then re-setting the
          // selectedCatalogId — the useEffect on line 378 reloads.
          if (selectedCatalogId === info.catalogId) {
            setSelectedCatalogId(null);
            setTimeout(() => setSelectedCatalogId(info.catalogId), 0);
          } else {
            setSelectedCatalogId(info.catalogId);
          }
        }}
      />
    </div>
  );
}

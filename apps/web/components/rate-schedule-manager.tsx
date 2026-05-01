"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Edit3,
  Layers,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import * as RadixSelect from "@radix-ui/react-select";
import { cn } from "@/lib/utils";
import type { RateSchedule, CatalogSummary, EntityCategory } from "@/lib/api";
import {
  createRateSchedule,
  deleteRateSchedule,
  updateRateSchedule,
  getRateSchedule,
  addRateScheduleTier,
  updateRateScheduleTier,
  deleteRateScheduleTier,
  addRateScheduleItem,
  updateRateScheduleItem,
  deleteRateScheduleItem,
  autoCalculateRateSchedule,
  getCatalogs,
  getEntityCategories,
  listCatalogItems,
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
import { CatalogItemPicker, type CatalogPickerItem } from "@/components/shared/catalog-item-picker";

/* ─── Constants ─── */

const TIER_UOM_OPTIONS = [
  { value: "__none__", label: "Any UoM" },
  { value: "HR", label: "HR" },
  { value: "DAY", label: "DAY" },
  { value: "WK", label: "WK" },
  { value: "MO", label: "MO" },
  { value: "EA", label: "EA" },
  { value: "LF", label: "LF" },
  { value: "FT", label: "FT" },
  { value: "SF", label: "SF" },
  { value: "LS", label: "LS" },
];

type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

const FALLBACK_TONES: Record<string, BadgeTone> = {
  labour: "info",
  equipment: "warning",
  materials: "success",
  general: "default",
};

function categoryBadgeProps(
  category: string,
  categories: EntityCategory[],
): { style?: React.CSSProperties; tone?: BadgeTone } {
  const ec = categories.find((c) => c.name.toLowerCase() === category.toLowerCase());
  if (ec?.color) {
    return {
      style: {
        borderColor: ec.color,
        backgroundColor: `${ec.color}1A`,
        color: ec.color,
      },
    };
  }
  return { tone: FALLBACK_TONES[category.toLowerCase()] ?? "default" };
}

/* ─── Types ─── */

type Tier = RateSchedule["tiers"][number];
type Item = RateSchedule["items"][number];

/* ─── Component ─── */

export function RateScheduleManager({
  schedules: initialSchedules,
  setSchedules: setParentSchedules,
  loading,
  catalogs = [],
}: {
  schedules: RateSchedule[];
  setSchedules: (s: RateSchedule[]) => void;
  loading: boolean;
  catalogs?: CatalogSummary[];
}) {
  const [schedules, setSchedulesLocal] = useState<RateSchedule[]>(initialSchedules);
  const setSchedules = useCallback(
    (fn: (prev: RateSchedule[]) => RateSchedule[]) => {
      setSchedulesLocal((prev) => fn(prev));
    },
    []
  );

  // Sync local state up to parent after render
  useEffect(() => {
    setParentSchedules(schedules);
  }, [schedules, setParentSchedules]);

  // Sync from parent when initial data arrives
  useEffect(() => {
    if (initialSchedules.length > 0) {
      setSchedulesLocal(initialSchedules);
    }
  }, [initialSchedules]);

  // Load catalogs with items if not provided
  const [loadedCatalogs, setLoadedCatalogs] = useState<CatalogSummary[]>([]);
  useEffect(() => {
    const baseCats = catalogs.length > 0 ? Promise.resolve(catalogs) : getCatalogs();
    baseCats.then(async (cats) => {
      const withItems = await Promise.all(
        cats.map(async (cat) => {
          try {
            const items = await listCatalogItems(cat.id);
            return { ...cat, items };
          } catch {
            return cat;
          }
        })
      );
      setLoadedCatalogs(withItems);
    }).catch(() => {});
  }, [catalogs]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RateSchedule | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Entity categories (dynamic)
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);
  useEffect(() => {
    getEntityCategories()
      .then((cats) => setEntityCategories(cats))
      .catch(() => {});
  }, []);
  const categoryOptions = useMemo(
    () =>
      entityCategories
        .filter((c) => c.enabled)
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ value: c.name, label: c.name })),
    [entityCategories],
  );

  // Create-new mode (uses the same drawer as edit)
  const [isCreating, setIsCreating] = useState(false);
  const [creatingSaving, setCreatingSaving] = useState(false);

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ itemId: string; tierId: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  // New tier/item forms
  const [showAddTier, setShowAddTier] = useState(false);
  const [newTierName, setNewTierName] = useState("");
  const [newTierMultiplier, setNewTierMultiplier] = useState("1.0");
  const [newTierUom, setNewTierUom] = useState<string>("__none__");
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editTierForm, setEditTierForm] = useState<{ name: string; multiplier: string; uom: string }>({ name: "", multiplier: "1.0", uom: "__none__" });
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemForm, setNewItemForm] = useState({ name: "", code: "", unit: "HR", catalogItemId: null as string | null });

  // Edit schedule header
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState({ name: "", description: "", category: "", defaultMarkup: 0 });

  /* ─── Filtered list ─── */

  const filtered = useMemo(() => {
    let list = schedules;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter) {
      list = list.filter((s) => s.category === categoryFilter);
    }
    return list;
  }, [schedules, search, categoryFilter]);

  /* ─── Load detail ─── */

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setEditingCell(null);
    setShowAddTier(false);
    setShowAddItem(false);
    setEditingHeader(false);
    setIsCreating(false);
    try {
      const full = await getRateSchedule(id);
      setDetail(full);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  /* ─── Schedule CRUD ─── */

  const startCreate = useCallback(() => {
    const fallbackCategory = categoryOptions[0]?.value ?? "";
    setSelectedId(null);
    setDetail(null);
    setIsCreating(true);
    setEditingHeader(true);
    setHeaderForm({
      name: "",
      description: "",
      category: fallbackCategory,
      defaultMarkup: 0,
    });
  }, [categoryOptions]);

  const handleCreate = useCallback(async () => {
    const name = headerForm.name.trim();
    if (!name) return;
    setCreatingSaving(true);
    try {
      const created = await createRateSchedule({
        name,
        category: headerForm.category,
        description: headerForm.description,
        defaultMarkup: headerForm.defaultMarkup,
      });
      setSchedules((prev) => [...prev, created]);
      setIsCreating(false);
      setEditingHeader(false);
      loadDetail(created.id);
    } catch (err) {
      console.error("Failed to create schedule:", err);
    } finally {
      setCreatingSaving(false);
    }
  }, [headerForm, setSchedules, loadDetail]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteRateSchedule(id);
        setSchedules((prev) => prev.filter((s) => s.id !== id));
        if (selectedId === id) {
          setSelectedId(null);
          setDetail(null);
        }
      } catch (err) {
        console.error("Failed to delete schedule:", err);
      }
    },
    [selectedId, setSchedules]
  );

  const handleUpdateHeader = useCallback(async () => {
    if (!detail) return;
    try {
      const updated = await updateRateSchedule(detail.id, {
        name: headerForm.name,
        description: headerForm.description,
        category: headerForm.category,
        defaultMarkup: headerForm.defaultMarkup,
      });
      setDetail({ ...detail, ...updated });
      setSchedules((prev) =>
        prev.map((s) => (s.id === detail.id ? { ...s, ...updated } : s))
      );
      setEditingHeader(false);
    } catch (err) {
      console.error("Failed to update schedule:", err);
    }
  }, [detail, headerForm, setSchedules]);

  /* ─── Tier CRUD ─── */

  const handleAddTier = useCallback(async () => {
    if (!detail || !newTierName.trim()) return;
    try {
      const updated = await addRateScheduleTier(detail.id, {
        name: newTierName.trim(),
        multiplier: parseFloat(newTierMultiplier) || 1.0,
        uom: newTierUom === "__none__" ? null : newTierUom,
      });
      setDetail(updated);
      setNewTierName("");
      setNewTierMultiplier("1.0");
      setNewTierUom("__none__");
      setShowAddTier(false);
    } catch (err) {
      console.error("Failed to add tier:", err);
    }
  }, [detail, newTierName, newTierMultiplier, newTierUom]);

  const handleDeleteTier = useCallback(
    async (tierId: string) => {
      if (!detail) return;
      try {
        const updated = await deleteRateScheduleTier(detail.id, tierId);
        setDetail(updated);
      } catch (err) {
        console.error("Failed to delete tier:", err);
      }
    },
    [detail]
  );

  const handleUpdateTierMultiplier = useCallback(
    async (tierId: string, multiplier: number) => {
      if (!detail) return;
      try {
        const updated = await updateRateScheduleTier(detail.id, tierId, { multiplier });
        setDetail(updated);
      } catch (err) {
        console.error("Failed to update tier:", err);
      }
    },
    [detail]
  );

  const handleSaveTierEdit = useCallback(
    async () => {
      if (!detail || !editingTierId) return;
      const name = editTierForm.name.trim();
      const multiplier = parseFloat(editTierForm.multiplier) || 1;
      if (!name) return;
      try {
        const updated = await updateRateScheduleTier(detail.id, editingTierId, {
          name,
          multiplier,
          uom: editTierForm.uom === "__none__" ? null : editTierForm.uom,
        });
        setDetail(updated);
        setEditingTierId(null);
      } catch (err) {
        console.error("Failed to update tier:", err);
      }
    },
    [detail, editingTierId, editTierForm]
  );

  /* ─── Item CRUD ─── */

  const handleAddItem = useCallback(async () => {
    if (!detail || !newItemForm.catalogItemId) return;
    try {
      const updated = await addRateScheduleItem(detail.id, {
        catalogItemId: newItemForm.catalogItemId,
      });
      setDetail(updated);
      setNewItemForm({ name: "", code: "", unit: "HR", catalogItemId: null });
      setShowAddItem(false);
    } catch (err) {
      console.error("Failed to add item:", err);
    }
  }, [detail, newItemForm]);

  const handlePickerSelect = useCallback((item: CatalogPickerItem) => {
    setNewItemForm({
      name: item.name,
      code: item.code,
      unit: item.unit || "HR",
      catalogItemId: item.id,
    });
  }, []);

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (!detail) return;
      try {
        const updated = await deleteRateScheduleItem(detail.id, itemId);
        setDetail(updated);
      } catch (err) {
        console.error("Failed to delete item:", err);
      }
    },
    [detail]
  );

  const startRateEdit = (item: Item, tierId: string) => {
    setEditingCell({ itemId: item.id, tierId });
    setEditValue(String(item.rates?.[tierId] ?? 0));
  };

  const saveRateEdit = useCallback(
    async (item: Item) => {
      if (!detail || !editingCell) return;
      const val = parseFloat(editValue) || 0;
      const newRates = { ...item.rates, [editingCell.tierId]: val };
      try {
        const updated = await updateRateScheduleItem(detail.id, item.id, { rates: newRates });
        setDetail(updated);
        setEditingCell(null);
      } catch (err) {
        console.error("Failed to update rate:", err);
      }
    },
    [detail, editingCell, editValue]
  );

  const handleAutoCalculate = useCallback(async () => {
    if (!detail) return;
    try {
      const updated = await autoCalculateRateSchedule(detail.id);
      setDetail(updated);
    } catch (err) {
      console.error("Failed to auto-calculate:", err);
    }
  }, [detail]);

  /* ─── Render ─── */

  const fmt = (n: number | undefined) =>
    n != null ? `$${n.toFixed(2)}` : "—";

  return (
    <div className="space-y-5">
      {/* Header */}
      <FadeIn>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Rate Schedules</CardTitle>
              <p className="text-xs text-fg/40 mt-0.5">
                                               Manage your organization's master rate library. Import these into projects.
              </p>
            </div>
            <Button variant="accent" size="xs" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" />
              New Schedule
            </Button>
          </CardHeader>
        </Card>
      </FadeIn>

      {/* Toolbar: search + filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
          <Input className="pl-8 text-xs h-8" placeholder="Search schedules..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {[{ value: "", label: "All" }, ...categoryOptions].map((c) => (
            <button
              key={c.value || "__all__"}
              onClick={() => setCategoryFilter(c.value === categoryFilter ? "" : c.value)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                (c.value === "" ? !categoryFilter : categoryFilter === c.value) ? "bg-accent/10 text-accent" : "text-fg/40 hover:text-fg/60 hover:bg-panel2/60"
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-fg/30 ml-auto">{filtered.length} schedule{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Full-width list */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="text-xs text-fg/30 text-center py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-fg/30 text-center py-12">No rate schedules found.</div>
        ) : (
          <div className="divide-y divide-line">
            {filtered.map((schedule) => (
              <div
                key={schedule.id}
                role="button"
                tabIndex={0}
                onClick={() => loadDetail(schedule.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); loadDetail(schedule.id); } }}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-panel2/40 transition-colors cursor-pointer group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-fg truncate">{schedule.name}</span>
                    <Badge {...categoryBadgeProps(schedule.category, entityCategories)} className="text-[10px] shrink-0">{schedule.category}</Badge>
                  </div>
                  {schedule.description && <p className="text-xs text-fg/40 mt-0.5 truncate">{schedule.description}</p>}
                </div>
                <div className="flex items-center gap-4 shrink-0 text-[11px] text-fg/40">
                  <span>{schedule.items?.length ?? 0} items</span>
                  <span>{schedule.tiers?.length ?? 0} tiers</span>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-fg/20 shrink-0" />
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(schedule.id); }}
                  className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-danger/10 text-fg/30 hover:text-danger transition-all shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Edit / Create Drawer (portalled to body to escape FadeIn transform) ── */}
      {typeof document !== "undefined" && ReactDOM.createPortal(
      <AnimatePresence>
        {(isCreating || (selectedId && detail)) && (
          <motion.div
            key="rate-schedule-drawer"
            initial={{ x: 560 }}
            animate={{ x: 0 }}
            exit={{ x: 560 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-40 w-[560px] bg-panel border-l border-line shadow-2xl flex flex-col"
          >
            {/* Drawer header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line bg-panel2/40">
              {editingHeader ? (
                <div className="flex-1 space-y-3">
                  {isCreating && (
                    <p className="text-[11px] font-semibold text-fg/55 uppercase tracking-wider">New Rate Schedule</p>
                  )}
                  <div>
                    <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Name</label>
                    <Input
                      className="mt-1 text-sm font-medium"
                      autoFocus={isCreating}
                      value={headerForm.name}
                      onChange={(e) => setHeaderForm({ ...headerForm, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && headerForm.name.trim()) {
                          isCreating ? handleCreate() : handleUpdateHeader();
                        }
                      }}
                      placeholder="e.g. Mechanical Labour Rates"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Category</label>
                      <Select
                        className="mt-1"
                        value={headerForm.category}
                        onValueChange={(v) => setHeaderForm({ ...headerForm, category: v })}
                        options={
                          categoryOptions.length > 0
                            ? categoryOptions
                            : [{ value: headerForm.category, label: headerForm.category || "—" }]
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Default Markup %</label>
                      <Input className="mt-1" type="number" step="0.1" value={headerForm.defaultMarkup} onChange={(e) => setHeaderForm({ ...headerForm, defaultMarkup: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Description</label>
                    <Input className="mt-1 text-xs" value={headerForm.description} onChange={(e) => setHeaderForm({ ...headerForm, description: e.target.value })} placeholder="Optional description" />
                  </div>
                  <div className="flex gap-2 justify-end pt-1">
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        if (isCreating) {
                          setIsCreating(false);
                          setEditingHeader(false);
                        } else {
                          setEditingHeader(false);
                        }
                      }}
                      disabled={creatingSaving}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="xs"
                      onClick={isCreating ? handleCreate : handleUpdateHeader}
                      disabled={!headerForm.name.trim() || creatingSaving}
                    >
                      {isCreating ? (creatingSaving ? "Creating…" : "Create") : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold text-fg truncate">{detail!.name}</h2>
                      <Badge {...categoryBadgeProps(detail!.category, entityCategories)} className="text-[10px]">{detail!.category}</Badge>
                    </div>
                    {detail!.description && <p className="text-xs text-fg/40 mt-0.5">{detail!.description}</p>}
                    <p className="text-[10px] text-fg/30 mt-0.5">Markup: {detail!.defaultMarkup}%</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors" onClick={() => { setHeaderForm({ name: detail!.name, description: detail!.description ?? "", category: detail!.category, defaultMarkup: detail!.defaultMarkup }); setEditingHeader(true); }} title="Edit">
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors" onClick={() => { setSelectedId(null); setDetail(null); }} title="Close">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {isCreating ? (
                <div className="flex items-center justify-center py-12 text-center text-xs text-fg/40">
                  Save the schedule to start adding tiers and items.
                </div>
              ) : loadingDetail || !detail ? (
                <div className="flex items-center justify-center py-12 text-xs text-fg/30">Loading...</div>
              ) : (
                <>
                  {/* Tiers */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Tiers</h3>
                      <div className="flex gap-1.5">
                        {detail.autoCalculate && detail.tiers.length > 0 && (
                          <Button size="xs" variant="ghost" onClick={handleAutoCalculate}><Calculator className="h-3 w-3" /> Auto-Calc</Button>
                        )}
                        <Button size="xs" variant="ghost" onClick={() => setShowAddTier(true)}><Plus className="h-3 w-3" /> Add</Button>
                      </div>
                    </div>
                    {showAddTier && (
                      <div className="flex items-end gap-2 mb-3 p-3 rounded-lg border border-accent/20 bg-accent/5">
                        <div className="flex-1">
                          <label className="text-[10px] font-medium text-fg/40 uppercase">Name</label>
                          <Input className="mt-1 h-8 text-xs" value={newTierName} onChange={(e) => setNewTierName(e.target.value)} placeholder="e.g. Overtime" onKeyDown={(e) => e.key === "Enter" && handleAddTier()} />
                        </div>
                        <div className="w-24">
                          <label className="text-[10px] font-medium text-fg/40 uppercase">Multiplier</label>
                          <Input className="mt-1 h-8 text-xs" type="number" step="0.1" value={newTierMultiplier} onChange={(e) => setNewTierMultiplier(e.target.value)} />
                        </div>
                        <div className="w-28">
                          <label className="text-[10px] font-medium text-fg/40 uppercase">UoM</label>
                          <Select
                            size="sm"
                            value={newTierUom}
                            onValueChange={setNewTierUom}
                            options={TIER_UOM_OPTIONS}
                            triggerClassName="mt-1"
                          />
                        </div>
                        <Button size="xs" onClick={handleAddTier} disabled={!newTierName.trim()}>Add</Button>
                        <Button size="xs" variant="ghost" onClick={() => { setShowAddTier(false); setNewTierName(""); setNewTierUom("__none__"); }}><X className="h-3 w-3" /></Button>
                      </div>
                    )}
                    {detail.tiers.length === 0 ? (
                      <p className="text-xs text-fg/30 py-2">No tiers. Add Regular, Overtime, Double Time, etc.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {detail.tiers.sort((a, b) => a.sortOrder - b.sortOrder).map((tier) => (
                          editingTierId === tier.id ? (
                            <div key={tier.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-accent/5 border border-accent/20">
                              <Input className="h-6 w-24 text-xs" value={editTierForm.name} onChange={(e) => setEditTierForm({ ...editTierForm, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") handleSaveTierEdit(); if (e.key === "Escape") setEditingTierId(null); }} autoFocus />
                              <Input className="h-6 w-14 text-xs text-right" type="number" step="0.1" value={editTierForm.multiplier} onChange={(e) => setEditTierForm({ ...editTierForm, multiplier: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") handleSaveTierEdit(); if (e.key === "Escape") setEditingTierId(null); }} />
                              <span className="text-[10px] text-fg/40">×</span>
                              <Select
                                size="xs"
                                value={editTierForm.uom}
                                onValueChange={(v) => setEditTierForm({ ...editTierForm, uom: v })}
                                options={TIER_UOM_OPTIONS}
                                triggerClassName="w-20"
                              />
                              <button onClick={handleSaveTierEdit} className="p-0.5 rounded hover:bg-accent/10 text-accent transition-colors"><Check className="h-3 w-3" /></button>
                              <button onClick={() => setEditingTierId(null)} className="p-0.5 rounded hover:bg-panel2/60 text-fg/30 transition-colors"><X className="h-3 w-3" /></button>
                            </div>
                          ) : (
                            <div key={tier.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel2/40 border border-line group cursor-pointer hover:border-accent/30 transition-colors" onClick={() => { setEditingTierId(tier.id); setEditTierForm({ name: tier.name, multiplier: String(tier.multiplier), uom: tier.uom ?? "__none__" }); }}>
                              <span className="text-xs font-medium text-fg">{tier.name}</span>
                              <span className="text-[10px] text-fg/40">{tier.multiplier}×</span>
                              {tier.uom ? (
                                <span className="text-[10px] font-medium text-accent/70 uppercase tracking-wider">{tier.uom}</span>
                              ) : null}
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteTier(tier.id); }} className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-danger/10 text-fg/30 hover:text-danger transition-all">
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Items & Rates */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Items & Rates</h3>
                      {!showAddItem && (
                        <Button size="xs" variant="ghost" onClick={() => setShowAddItem(true)}><Plus className="h-3 w-3" /> Add Item</Button>
                      )}
                    </div>

                  {detail.items.length === 0 && !showAddItem ? (
                    <p className="text-xs text-fg/30 py-4 text-center">No items yet. Add rate items to this schedule.</p>
                  ) : (
                    <div className="-mx-5 px-5 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-line">
                            <th className="text-left py-2 pr-2 text-[10px] font-medium text-fg/40 uppercase tracking-wider w-14">Code</th>
                            <th className="text-left py-2 pr-2 text-[10px] font-medium text-fg/40 uppercase tracking-wider">Name</th>
                            <th className="text-left py-2 pr-1 text-[10px] font-medium text-fg/40 uppercase tracking-wider w-10">Unit</th>
                            {detail.tiers
                              .sort((a, b) => a.sortOrder - b.sortOrder)
                              .map((tier) => (
                                <th key={tier.id} className="text-right py-2 px-1 text-[10px] font-medium text-fg/40 uppercase tracking-wider w-18" colSpan={1}>
                                  {tier.name}
                                </th>
                              ))}
                              <th className="w-8" />
                            </tr>
                          </thead>
                          <tbody>
                            {detail.items.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => (
                              <tr key={item.id} className="border-b border-line/50 hover:bg-panel2/20 group">
                                <td className="py-1.5 pr-2 text-fg/60 font-mono text-[11px]">{item.code || "—"}</td>
                                <td className="py-1.5 pr-2 text-fg font-medium text-[11px] truncate max-w-[160px]">{item.name}</td>
                                <td className="py-1.5 pr-1 text-fg/50 text-[11px]">{item.unit}</td>
                                {detail.tiers
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .map((tier) => (
                                    <td key={tier.id} className="py-1 px-0.5">
                                      <div className="flex flex-col items-end">
                                        {editingCell?.itemId === item.id && editingCell?.tierId === tier.id ? (
                                          <input
                                            type="number"
                                            step="0.01"
                                            className="w-16 text-right px-1 py-0.5 rounded bg-panel2 border border-accent/30 text-fg text-[11px] focus:outline-none focus:ring-1 focus:ring-accent/50"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value)}
                                            onBlur={() => saveRateEdit(item)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") saveRateEdit(item);
                                              if (e.key === "Escape") setEditingCell(null);
                                            }}
                                            autoFocus
                                          />
                                        ) : (
                                          <button
                                            onClick={() => startRateEdit(item, tier.id)}
                                            className="text-right text-[11px] text-fg/80 hover:text-accent px-0.5 py-0.5 rounded hover:bg-accent/5 transition-colors w-16"
                                          >
                                            {fmt(item.rates?.[tier.id])}
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  ))}
                                <td className="py-2 text-right">
                                  <button
                                    onClick={() => handleDeleteItem(item.id)}
                                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-danger/10 text-fg/30 hover:text-danger transition-all"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <AnimatePresence>
                      {showAddItem && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
                          <div className="flex items-end gap-2 mt-3 p-3 rounded-lg border border-accent/20 bg-accent/5">
                            <div className="flex-1 min-w-0">
                              <label className="text-[10px] font-medium text-fg/40 uppercase">Catalog item</label>
                              <div className="mt-1">
                                {loadedCatalogs.length > 0 ? (
                                  <CatalogItemPicker
                                    catalogs={loadedCatalogs}
                                    value={newItemForm.catalogItemId}
                                    onSelect={handlePickerSelect}
                                    placeholder="Search catalog items..."
                                  />
                                ) : (
                                  <p className="text-[11px] text-fg/40">No catalog items loaded — add items to a catalog first.</p>
                                )}
                              </div>
                              {newItemForm.catalogItemId && (
                                <p className="mt-1 text-[10px] text-fg/40">
                                  {newItemForm.code && <span className="font-mono mr-1">{newItemForm.code}</span>}
                                  {newItemForm.name} · {newItemForm.unit}
                                </p>
                              )}
                            </div>
                            <Button size="xs" onClick={handleAddItem} disabled={!newItemForm.catalogItemId}>Add</Button>
                            <Button size="xs" variant="ghost" onClick={() => { setShowAddItem(false); setNewItemForm({ name: "", code: "", unit: "HR", catalogItemId: null }); }}><X className="h-3 w-3" /></Button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body)}
    </div>
  );
}

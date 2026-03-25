"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
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
import type { RateSchedule, CatalogSummary } from "@/lib/api";
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

const CATEGORIES = [
  { value: "labour", label: "Labour" },
  { value: "equipment", label: "Equipment" },
  { value: "materials", label: "Materials" },
  { value: "general", label: "General" },
] as const;

const CATEGORY_BADGE: Record<string, "default" | "success" | "warning" | "danger" | "info"> = {
  labour: "info",
  equipment: "warning",
  materials: "success",
  general: "default",
};

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
  const [loadedCatalogs, setLoadedCatalogs] = useState<CatalogSummary[]>(catalogs);
  useEffect(() => {
    if (catalogs.length > 0) {
      setLoadedCatalogs(catalogs);
      return;
    }
    getCatalogs().then(async (cats) => {
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

  // New schedule form
  const [showCreate, setShowCreate] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", category: "labour", description: "" });

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ itemId: string; tierId: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingCostCell, setEditingCostCell] = useState<{ itemId: string; tierId: string } | null>(null);
  const [editCostValue, setEditCostValue] = useState("");

  // New tier/item forms
  const [showAddTier, setShowAddTier] = useState(false);
  const [newTierName, setNewTierName] = useState("");
  const [newTierMultiplier, setNewTierMultiplier] = useState("1.0");
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
    setEditingCostCell(null);
    setShowAddTier(false);
    setShowAddItem(false);
    setEditingHeader(false);
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

  const handleCreate = useCallback(async () => {
    if (!newForm.name.trim()) return;
    try {
      const created = await createRateSchedule({
        name: newForm.name.trim(),
        category: newForm.category,
        description: newForm.description,
      });
      setSchedules((prev) => [...prev, created]);
      setNewForm({ name: "", category: "labour", description: "" });
      setShowCreate(false);
      loadDetail(created.id);
    } catch (err) {
      console.error("Failed to create schedule:", err);
    }
  }, [newForm, setSchedules, loadDetail]);

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
      });
      setDetail(updated);
      setNewTierName("");
      setNewTierMultiplier("1.0");
      setShowAddTier(false);
    } catch (err) {
      console.error("Failed to add tier:", err);
    }
  }, [detail, newTierName, newTierMultiplier]);

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

  /* ─── Item CRUD ─── */

  const handleAddItem = useCallback(async () => {
    if (!detail || !newItemForm.name.trim()) return;
    try {
      const updated = await addRateScheduleItem(detail.id, {
        name: newItemForm.name.trim(),
        code: newItemForm.code.trim(),
        unit: newItemForm.unit,
        catalogItemId: newItemForm.catalogItemId ?? undefined,
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
    setEditingCostCell(null);
  };

  const startCostEdit = (item: Item, tierId: string) => {
    setEditingCostCell({ itemId: item.id, tierId });
    setEditCostValue(String(item.costRates?.[tierId] ?? 0));
    setEditingCell(null);
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

  const saveCostEdit = useCallback(
    async (item: Item) => {
      if (!detail || !editingCostCell) return;
      const val = parseFloat(editCostValue) || 0;
      const newCostRates = { ...item.costRates, [editingCostCell.tierId]: val };
      try {
        const updated = await updateRateScheduleItem(detail.id, item.id, { costRates: newCostRates });
        setDetail(updated);
        setEditingCostCell(null);
      } catch (err) {
        console.error("Failed to update cost rate:", err);
      }
    },
    [detail, editingCostCell, editCostValue]
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
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Rate Schedules</h1>
            <p className="text-xs text-fg/50 mt-0.5">
              Manage your organization&apos;s master rate library. Import these into projects.
            </p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            New Schedule
          </Button>
        </div>
      </FadeIn>

      {/* Create form */}
      <AnimatePresence>
        {showCreate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <Card>
              <CardHeader>
                <CardTitle>New Rate Schedule</CardTitle>
              </CardHeader>
              <div className="px-5 pb-5 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Name</label>
                    <Input
                      className="mt-1"
                      value={newForm.name}
                      onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
                      placeholder="e.g. Mechanical Labour Rates"
                      onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Category</label>
                    <Select
                      className="mt-1"
                      value={newForm.category}
                      onChange={(e) => setNewForm({ ...newForm, category: e.target.value })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Description</label>
                  <Input
                    className="mt-1"
                    value={newForm.description}
                    onChange={(e) => setNewForm({ ...newForm, description: e.target.value })}
                    placeholder="Optional description"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleCreate} disabled={!newForm.name.trim()}>Create</Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main layout: sidebar + detail */}
      <div className="flex gap-5 min-h-[600px]">
        {/* Schedule list sidebar */}
        <div className="w-72 shrink-0 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
              <Input
                className="pl-8 text-xs"
                placeholder="Search schedules..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <RadixSelect.Root value={categoryFilter || "__all__"} onValueChange={(val) => setCategoryFilter(val === "__all__" ? "" : val)}>
              <RadixSelect.Trigger className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs rounded-lg border border-line bg-bg/50 text-fg outline-none hover:border-accent/30 focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors whitespace-nowrap">
                <RadixSelect.Value placeholder="All" />
                <RadixSelect.Icon className="ml-1 shrink-0">
                  <ChevronDown className="h-3 w-3 text-fg/40" />
                </RadixSelect.Icon>
              </RadixSelect.Trigger>
              <RadixSelect.Portal>
                <RadixSelect.Content className="z-50 rounded-lg border border-line bg-panel shadow-xl" position="popper" sideOffset={4}>
                  <RadixSelect.Viewport className="p-1">
                    <RadixSelect.Item value="__all__" className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md outline-none cursor-pointer hover:bg-accent/10 data-[highlighted]:bg-accent/10 data-[state=checked]:text-accent">
                      <RadixSelect.ItemIndicator className="shrink-0"><Check className="h-3 w-3" /></RadixSelect.ItemIndicator>
                      <RadixSelect.ItemText>All</RadixSelect.ItemText>
                    </RadixSelect.Item>
                    {CATEGORIES.map((c) => (
                      <RadixSelect.Item key={c.value} value={c.value} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md outline-none cursor-pointer hover:bg-accent/10 data-[highlighted]:bg-accent/10 data-[state=checked]:text-accent">
                        <RadixSelect.ItemIndicator className="shrink-0"><Check className="h-3 w-3" /></RadixSelect.ItemIndicator>
                        <RadixSelect.ItemText>{c.label}</RadixSelect.ItemText>
                      </RadixSelect.Item>
                    ))}
                  </RadixSelect.Viewport>
                </RadixSelect.Content>
              </RadixSelect.Portal>
            </RadixSelect.Root>
          </div>

          {loading ? (
            <div className="text-sm text-fg/40 text-center py-8">Loading...</div>
          ) : filtered.length === 0 ? (
            <EmptyState>No rate schedules found.</EmptyState>
          ) : (
            <div className="space-y-1">
              {filtered.map((schedule) => (
                <div
                  key={schedule.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => loadDetail(schedule.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadDetail(schedule.id); } }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-lg border transition-all group cursor-pointer",
                    selectedId === schedule.id
                      ? "border-accent/40 bg-accent/5"
                      : "border-transparent hover:bg-panel2/40"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-fg truncate">{schedule.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(schedule.id);
                      }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-danger/10 text-fg/30 hover:text-danger transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge tone={CATEGORY_BADGE[schedule.category] ?? "default"} className="text-[10px]">
                      {schedule.category}
                    </Badge>
                    {schedule.items?.length != null && (
                      <span className="text-[10px] text-fg/40">{schedule.items.length} items</span>
                    )}
                    {schedule.tiers?.length != null && (
                      <span className="text-[10px] text-fg/40">{schedule.tiers.length} tiers</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 min-w-0">
          {!selectedId ? (
            <div className="flex items-center justify-center h-full text-sm text-fg/40">
              <div className="text-center space-y-2">
                <Layers className="h-8 w-8 mx-auto text-fg/20" />
                <p>Select a schedule to view and edit</p>
              </div>
            </div>
          ) : loadingDetail ? (
            <div className="flex items-center justify-center h-full text-sm text-fg/40">Loading...</div>
          ) : !detail ? (
            <div className="flex items-center justify-center h-full text-sm text-fg/40">Schedule not found</div>
          ) : (
            <div className="space-y-4">
              {/* Header */}
              <Card>
                <div className="px-5 py-4">
                  {editingHeader ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Name</label>
                          <Input className="mt-1" value={headerForm.name} onChange={(e) => setHeaderForm({ ...headerForm, name: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Category</label>
                          <Select className="mt-1" value={headerForm.category} onChange={(e) => setHeaderForm({ ...headerForm, category: e.target.value })}>
                            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </Select>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Description</label>
                          <Input className="mt-1" value={headerForm.description} onChange={(e) => setHeaderForm({ ...headerForm, description: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Default Markup %</label>
                          <Input className="mt-1" type="number" step="0.1" value={headerForm.defaultMarkup} onChange={(e) => setHeaderForm({ ...headerForm, defaultMarkup: Number(e.target.value) || 0 })} />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setEditingHeader(false)}>Cancel</Button>
                        <Button size="sm" onClick={handleUpdateHeader}>Save</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-semibold text-fg">{detail.name}</h2>
                          <Badge tone={CATEGORY_BADGE[detail.category] ?? "default"} className="text-[10px]">
                            {detail.category}
                          </Badge>
                        </div>
                        {detail.description && (
                          <p className="text-xs text-fg/50 mt-1">{detail.description}</p>
                        )}
                        <p className="text-[10px] text-fg/30 mt-1">
                          Markup: {detail.defaultMarkup}% · Auto-calculate: {detail.autoCalculate ? "Yes" : "No"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setHeaderForm({
                            name: detail.name,
                            description: detail.description ?? "",
                            category: detail.category,
                            defaultMarkup: detail.defaultMarkup,
                          });
                          setEditingHeader(true);
                        }}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    </div>
                  )}
                </div>
              </Card>

              {/* Tiers */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <CardTitle className="text-sm">Tiers</CardTitle>
                  <div className="flex gap-2">
                    {detail.autoCalculate && detail.tiers.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={handleAutoCalculate}>
                        <Calculator className="h-3.5 w-3.5" />
                        Auto-Calculate
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setShowAddTier(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      Add Tier
                    </Button>
                  </div>
                </CardHeader>
                <div className="px-5 pb-4">
                  {showAddTier && (
                    <div className="flex items-end gap-2 mb-3 p-3 rounded-lg border border-accent/20 bg-accent/5">
                      <div className="flex-1">
                        <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Name</label>
                        <Input
                          className="mt-1"
                          value={newTierName}
                          onChange={(e) => setNewTierName(e.target.value)}
                          placeholder="e.g. Overtime"
                          onKeyDown={(e) => e.key === "Enter" && handleAddTier()}
                        />
                      </div>
                      <div className="w-28">
                        <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Multiplier</label>
                        <Input
                          className="mt-1"
                          type="number"
                          step="0.1"
                          value={newTierMultiplier}
                          onChange={(e) => setNewTierMultiplier(e.target.value)}
                        />
                      </div>
                      <Button size="sm" onClick={handleAddTier} disabled={!newTierName.trim()}>Add</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowAddTier(false); setNewTierName(""); }}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  {detail.tiers.length === 0 ? (
                    <p className="text-xs text-fg/40 py-2">No tiers defined. Add tiers like Regular, Overtime, Double Time.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {detail.tiers
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((tier) => (
                          <div
                            key={tier.id}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-panel2/40 border border-line group"
                          >
                            <span className="text-sm font-medium text-fg">{tier.name}</span>
                            <span className="text-[10px] text-fg/40">{tier.multiplier}×</span>
                            <button
                              onClick={() => handleDeleteTier(tier.id)}
                              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-danger/10 text-fg/30 hover:text-danger transition-all"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </Card>

              {/* Rate table */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <CardTitle className="text-sm">Items &amp; Rates</CardTitle>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddItem(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Item
                  </Button>
                </CardHeader>
                <div className="px-5 pb-4">
                  <AnimatePresence>
                    {showAddItem && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="flex items-end gap-2 mb-3 p-3 rounded-lg border border-accent/20 bg-accent/5">
                          <div className="flex-1 min-w-0">
                            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Item</label>
                            <div className="mt-1">
                              {loadedCatalogs.length > 0 ? (
                                <CatalogItemPicker
                                  catalogs={loadedCatalogs}
                                  value={newItemForm.catalogItemId}
                                  onSelect={handlePickerSelect}
                                  allowFreeText
                                  freeTextValue={newItemForm.catalogItemId ? "" : newItemForm.name}
                                  onFreeTextChange={(val) =>
                                    setNewItemForm({ ...newItemForm, name: val, catalogItemId: null })
                                  }
                                  placeholder="Search catalog items..."
                                />
                              ) : (
                                <Input
                                  value={newItemForm.name}
                                  onChange={(e) => setNewItemForm({ ...newItemForm, name: e.target.value })}
                                  placeholder="e.g. Journeyman Pipefitter"
                                  onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                                />
                              )}
                            </div>
                          </div>
                          <div className="w-24">
                            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Code</label>
                            <Input
                              className="mt-1"
                              value={newItemForm.code}
                              onChange={(e) => setNewItemForm({ ...newItemForm, code: e.target.value })}
                              placeholder="JP-01"
                            />
                          </div>
                          <div className="w-20">
                            <label className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Unit</label>
                            <Select
                              className="mt-1"
                              value={newItemForm.unit}
                              onChange={(e) => setNewItemForm({ ...newItemForm, unit: e.target.value })}
                            >
                              {["HR", "DAY", "WK", "MO", "EA", "LF", "FT", "SF", "SY", "CY", "TON", "GAL", "LB", "LS", "LOT", "SET", "PR", "PKG"].map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </Select>
                          </div>
                          <Button size="sm" onClick={handleAddItem} disabled={!newItemForm.name.trim()}>Add</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setShowAddItem(false); setNewItemForm({ name: "", code: "", unit: "HR", catalogItemId: null }); }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {detail.items.length === 0 ? (
                    <EmptyState>No items yet. Add rate items to this schedule.</EmptyState>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-line">
                            <th className="text-left py-2 pr-3 text-[11px] font-medium text-fg/40 uppercase tracking-wider w-20">Code</th>
                            <th className="text-left py-2 pr-3 text-[11px] font-medium text-fg/40 uppercase tracking-wider min-w-[140px]">Name</th>
                            <th className="text-left py-2 pr-3 text-[11px] font-medium text-fg/40 uppercase tracking-wider w-14">Unit</th>
                            {detail.tiers
                              .sort((a, b) => a.sortOrder - b.sortOrder)
                              .map((tier) => (
                                <th key={tier.id} className="text-right py-2 px-2 text-[11px] font-medium text-fg/40 uppercase tracking-wider w-24" colSpan={1}>
                                  <div>{tier.name}</div>
                                  <div className="text-[9px] font-normal text-fg/25">sell / cost</div>
                                </th>
                              ))}
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items
                            .sort((a, b) => a.sortOrder - b.sortOrder)
                            .map((item) => (
                              <tr key={item.id} className="border-b border-line/50 hover:bg-panel2/20 group">
                                <td className="py-2 pr-3 text-fg/60 font-mono text-xs">{item.code || "—"}</td>
                                <td className="py-2 pr-3 text-fg font-medium">{item.name}</td>
                                <td className="py-2 pr-3 text-fg/50 text-xs">{item.unit}</td>
                                {detail.tiers
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .map((tier) => (
                                    <td key={tier.id} className="py-1 px-1">
                                      <div className="flex flex-col items-end gap-0.5">
                                        {/* Sell rate */}
                                        {editingCell?.itemId === item.id && editingCell?.tierId === tier.id ? (
                                          <input
                                            type="number"
                                            step="0.01"
                                            className="w-20 text-right px-1.5 py-0.5 rounded bg-panel2 border border-accent/30 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-accent/50"
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
                                            className="text-right text-xs text-fg/80 hover:text-accent px-1 py-0.5 rounded hover:bg-accent/5 transition-colors w-20"
                                          >
                                            {fmt(item.rates?.[tier.id])}
                                          </button>
                                        )}
                                        {/* Cost rate */}
                                        {editingCostCell?.itemId === item.id && editingCostCell?.tierId === tier.id ? (
                                          <input
                                            type="number"
                                            step="0.01"
                                            className="w-20 text-right px-1.5 py-0.5 rounded bg-panel2 border border-emerald-500/30 text-fg text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                                            value={editCostValue}
                                            onChange={(e) => setEditCostValue(e.target.value)}
                                            onBlur={() => saveCostEdit(item)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") saveCostEdit(item);
                                              if (e.key === "Escape") setEditingCostCell(null);
                                            }}
                                            autoFocus
                                          />
                                        ) : (
                                          <button
                                            onClick={() => startCostEdit(item, tier.id)}
                                            className="text-right text-[10px] text-fg/40 hover:text-emerald-400 px-1 py-0.5 rounded hover:bg-emerald-500/5 transition-colors w-20"
                                          >
                                            {fmt(item.costRates?.[tier.id])}
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
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

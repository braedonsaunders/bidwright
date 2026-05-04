"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
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
  getSettings,
  listCatalogItems,
} from "@/lib/api";
import { CURRENCIES } from "@/components/settings-page-config";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  FadeIn,
  Input,
  Select,
} from "@/components/ui";
import { CatalogItemPicker, type CatalogPickerItem } from "@/components/shared/catalog-item-picker";
import { useUomOptions } from "@/components/shared/uom-select";

/* ─── Constants ─── */

type BadgeTone = "default" | "success" | "warning" | "danger" | "info";

function cleanCategoryValue(value: string | null | undefined) {
  return (value ?? "").trim();
}

function categoryLookupValue(value: string | null | undefined) {
  return cleanCategoryValue(value).toLowerCase().replace(/[\s_-]+/g, "");
}

function categoryOptionValue(category: EntityCategory) {
  return cleanCategoryValue(category.entityType) || cleanCategoryValue(category.name) || category.id;
}

function categoryCandidateValues(category: EntityCategory) {
  return [category.entityType, category.name, category.id].map(cleanCategoryValue).filter(Boolean);
}

function findConfiguredCategoryByValue(category: string, categories: EntityCategory[]) {
  const key = cleanCategoryValue(category);
  if (!key) return undefined;
  const lookupKey = categoryLookupValue(key);
  return categories.find(
    (candidate) =>
      candidate.enabled !== false &&
      categoryCandidateValues(candidate).some((value) => categoryLookupValue(value) === lookupKey),
  );
}

function scheduleCategoryFormValue(category: string, categories: EntityCategory[]) {
  const match = findConfiguredCategoryByValue(category, categories);
  return match ? categoryOptionValue(match) : "";
}

function categoryLabel(category: string, categories: EntityCategory[]) {
  return findConfiguredCategoryByValue(category, categories)?.name ?? category;
}

function rateScheduleMatchesCategory(scheduleCategory: string, filterValue: string, categories: EntityCategory[]) {
  const key = cleanCategoryValue(filterValue);
  if (!key) return true;
  const lookupKey = categoryLookupValue(key);
  const configured = findConfiguredCategoryByValue(scheduleCategory, categories);
  const values = configured ? categoryCandidateValues(configured) : [scheduleCategory];
  return values.some((value) => categoryLookupValue(value) === lookupKey);
}

function canonicalCategoryOptionValue(value: string, options: Array<{ value: string; label: string }>) {
  const lookupKey = categoryLookupValue(value);
  return options.find((option) => categoryLookupValue(option.value) === lookupKey)?.value ?? cleanCategoryValue(value);
}

function categoryBadgeProps(
  category: string,
  categories: EntityCategory[],
): { style?: React.CSSProperties; tone?: BadgeTone } {
  const ec = findConfiguredCategoryByValue(category, categories);
  if (ec?.color) {
    return {
      style: {
        borderColor: ec.color,
        backgroundColor: `${ec.color}1A`,
        color: ec.color,
      },
    };
  }
  return { tone: "default" };
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatScheduleDate(value: string | null | undefined) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function dateInputValue(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function optionalDateValue(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatScheduleDateRange(start: string | null | undefined, end: string | null | undefined) {
  if (start && end) return `${formatScheduleDate(start)} - ${formatScheduleDate(end)}`;
  if (start) return `From ${formatScheduleDate(start)}`;
  if (end) return `Until ${formatScheduleDate(end)}`;
  return "-";
}

function metadataText(metadata: Record<string, unknown> | null | undefined, key: string) {
  const value = metadata?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function compactMetadataSummary(schedule: Pick<RateSchedule, "metadata">) {
  return [
    metadataText(schedule.metadata, "sourceName"),
    metadataText(schedule.metadata, "version"),
    metadataText(schedule.metadata, "region"),
    metadataText(schedule.metadata, "currency"),
  ].filter(Boolean).join(" · ");
}

function normalizeCurrency(value: string | null | undefined, fallback = "USD") {
  const normalized = (value ?? "").trim().toUpperCase();
  if (normalized.length === 3) return normalized;
  const fallbackNormalized = fallback.trim().toUpperCase();
  return fallbackNormalized.length === 3 ? fallbackNormalized : "USD";
}

/* ─── Types ─── */

type Tier = RateSchedule["tiers"][number];
type Item = RateSchedule["items"][number];

interface RateScheduleHeaderForm {
  name: string;
  description: string;
  category: string;
  defaultMarkup: number;
  effectiveDate: string;
  expiryDate: string;
  sourceName: string;
  version: string;
  region: string;
  currency: string;
}

function headerFormFromSchedule(schedule: RateSchedule, categories: EntityCategory[], fallbackCurrency = "USD"): RateScheduleHeaderForm {
  return {
    name: schedule.name,
    description: schedule.description ?? "",
    category: scheduleCategoryFormValue(schedule.category, categories),
    defaultMarkup: schedule.defaultMarkup,
    effectiveDate: dateInputValue(schedule.effectiveDate),
    expiryDate: dateInputValue(schedule.expiryDate),
    sourceName: metadataText(schedule.metadata, "sourceName"),
    version: metadataText(schedule.metadata, "version"),
    region: metadataText(schedule.metadata, "region"),
    currency: normalizeCurrency(metadataText(schedule.metadata, "currency"), fallbackCurrency),
  };
}

function mergeHeaderMetadata(existing: Record<string, unknown> | null | undefined, form: RateScheduleHeaderForm) {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  const fields: Array<[string, string]> = [
    ["sourceName", form.sourceName],
    ["version", form.version],
    ["region", form.region],
    ["currency", form.currency],
  ];
  for (const [key, value] of fields) {
    const trimmed = value.trim();
    if (trimmed) next[key] = trimmed;
    else delete next[key];
  }
  return next;
}

/* ─── Component ─── */

export function RateScheduleManager({
  schedules: initialSchedules,
  setSchedules: setParentSchedules,
  loading,
  catalogs = [],
  embedded = false,
}: {
  schedules: RateSchedule[];
  setSchedules: (s: RateSchedule[]) => void;
  loading: boolean;
  catalogs?: CatalogSummary[];
  embedded?: boolean;
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
  const [page, setPage] = useState(0);

  // Entity categories (dynamic)
  const [entityCategories, setEntityCategories] = useState<EntityCategory[]>([]);
  useEffect(() => {
    getEntityCategories()
      .then((cats) => setEntityCategories(cats.filter((category) => category.enabled !== false)))
      .catch(() => setEntityCategories([]));
  }, []);
  const categoryOptions = useMemo(
    () => {
      const seen = new Set<string>();
      const options = entityCategories
        .filter((c) => c.enabled !== false)
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ value: categoryOptionValue(c), label: c.name }))
        .filter((option) => {
          const key = categoryLookupValue(option.value);
          if (!key || !option.label.trim() || seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      return options;
    },
    [entityCategories],
  );

  // Create-new mode (uses the same drawer as edit)
  const [isCreating, setIsCreating] = useState(false);
  const [creatingSaving, setCreatingSaving] = useState(false);
  const [organizationCurrency, setOrganizationCurrency] = useState("USD");

  useEffect(() => {
    getSettings()
      .then((settings) => setOrganizationCurrency(normalizeCurrency(settings.defaults.currency)))
      .catch(() => setOrganizationCurrency("USD"));
  }, []);

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
  const tierUomOptions = useUomOptions({ compact: true, blankValue: "__none__", blankLabel: "Any UoM" });

  // Edit schedule header
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerForm, setHeaderForm] = useState<RateScheduleHeaderForm>({
    name: "",
    description: "",
    category: "",
    defaultMarkup: 0,
    effectiveDate: "",
    expiryDate: "",
    sourceName: "",
    version: "",
    region: "",
    currency: "",
  });
  const currencyOptions = useMemo(() => {
    const currency = normalizeCurrency(headerForm.currency, organizationCurrency);
    return [
      ...CURRENCIES.map((value) => ({ value, label: value })),
      ...(CURRENCIES.includes(currency) ? [] : [{ value: currency, label: currency }]),
    ];
  }, [headerForm.currency, organizationCurrency]);
  const headerCategoryIsValid = useMemo(
    () => categoryOptions.some((option) => categoryLookupValue(option.value) === categoryLookupValue(headerForm.category)),
    [categoryOptions, headerForm.category],
  );
  const headerDateRangeIsValid = !headerForm.effectiveDate || !headerForm.expiryDate || headerForm.expiryDate >= headerForm.effectiveDate;

  useEffect(() => {
    if (!isCreating) return;
    setHeaderForm((current) => {
      const nextCategory = current.category || categoryOptions[0]?.value || "";
      const nextCurrency = normalizeCurrency(current.currency, organizationCurrency);
      if (current.category === nextCategory && current.currency === nextCurrency) return current;
      return { ...current, category: nextCategory, currency: nextCurrency };
    });
  }, [categoryOptions, isCreating, organizationCurrency]);

  useEffect(() => {
    if (!editingHeader || isCreating || !detail) return;
    setHeaderForm((current) => {
      if (current.category) return current;
      const nextCategory = scheduleCategoryFormValue(detail.category, entityCategories);
      return nextCategory ? { ...current, category: nextCategory } : current;
    });
  }, [detail, editingHeader, entityCategories, isCreating]);

  /* ─── Filtered list ─── */

  const filtered = useMemo(() => {
    let list = schedules;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.effectiveDate?.toLowerCase().includes(q) ||
          s.expiryDate?.toLowerCase().includes(q) ||
          compactMetadataSummary(s).toLowerCase().includes(q)
      );
    }
    if (categoryFilter) {
      list = list.filter((s) => rateScheduleMatchesCategory(s.category, categoryFilter, entityCategories));
    }
    return list;
  }, [schedules, search, categoryFilter, entityCategories]);
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleSchedules = filtered.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    setPage(0);
  }, [search, categoryFilter]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages - 1));
  }, [totalPages]);

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

  // Sync flyout edits back to the list so tier/item counts (and any other
  // header-level fields) update without a page reload.
  const applyScheduleUpdate = useCallback(
    (updated: RateSchedule) => {
      setDetail(updated);
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    },
    [setSchedules]
  );

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
      effectiveDate: "",
      expiryDate: "",
      sourceName: "",
      version: "",
      region: "",
      currency: organizationCurrency,
    });
  }, [categoryOptions, organizationCurrency]);

  const handleCreate = useCallback(async () => {
    const name = headerForm.name.trim();
    const category = canonicalCategoryOptionValue(headerForm.category, categoryOptions);
    if (!name || !categoryOptions.some((option) => categoryLookupValue(option.value) === categoryLookupValue(category)) || !headerDateRangeIsValid) return;
    setCreatingSaving(true);
    try {
      const normalizedHeaderForm = {
        ...headerForm,
        category,
        currency: normalizeCurrency(headerForm.currency, organizationCurrency),
      };
      const created = await createRateSchedule({
        name,
        category,
        description: normalizedHeaderForm.description,
        defaultMarkup: normalizedHeaderForm.defaultMarkup,
        effectiveDate: optionalDateValue(normalizedHeaderForm.effectiveDate),
        expiryDate: optionalDateValue(normalizedHeaderForm.expiryDate),
        metadata: mergeHeaderMetadata({}, normalizedHeaderForm),
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
  }, [categoryOptions, headerDateRangeIsValid, headerForm, organizationCurrency, setSchedules, loadDetail]);

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
    const category = canonicalCategoryOptionValue(headerForm.category, categoryOptions);
    if (!categoryOptions.some((option) => categoryLookupValue(option.value) === categoryLookupValue(category)) || !headerDateRangeIsValid) return;
    try {
      const normalizedHeaderForm = {
        ...headerForm,
        category,
        currency: normalizeCurrency(headerForm.currency, organizationCurrency),
      };
      const updated = await updateRateSchedule(detail.id, {
        name: normalizedHeaderForm.name,
        description: normalizedHeaderForm.description,
        category,
        defaultMarkup: normalizedHeaderForm.defaultMarkup,
        effectiveDate: optionalDateValue(normalizedHeaderForm.effectiveDate),
        expiryDate: optionalDateValue(normalizedHeaderForm.expiryDate),
        metadata: mergeHeaderMetadata(detail.metadata, normalizedHeaderForm),
      });
      setDetail({ ...detail, ...updated });
      setSchedules((prev) =>
        prev.map((s) => (s.id === detail.id ? { ...s, ...updated } : s))
      );
      setEditingHeader(false);
    } catch (err) {
      console.error("Failed to update schedule:", err);
    }
  }, [categoryOptions, detail, headerDateRangeIsValid, headerForm, organizationCurrency, setSchedules]);

  /* ─── Tier CRUD ─── */

  const handleAddTier = useCallback(async () => {
    if (!detail || !newTierName.trim()) return;
    try {
      const updated = await addRateScheduleTier(detail.id, {
        name: newTierName.trim(),
        multiplier: parseFloat(newTierMultiplier) || 1.0,
        uom: newTierUom === "__none__" ? null : newTierUom,
      });
      applyScheduleUpdate(updated);
      setNewTierName("");
      setNewTierMultiplier("1.0");
      setNewTierUom("__none__");
      setShowAddTier(false);
    } catch (err) {
      console.error("Failed to add tier:", err);
    }
  }, [detail, newTierName, newTierMultiplier, newTierUom, applyScheduleUpdate]);

  const handleDeleteTier = useCallback(
    async (tierId: string) => {
      if (!detail) return;
      try {
        const updated = await deleteRateScheduleTier(detail.id, tierId);
        applyScheduleUpdate(updated);
      } catch (err) {
        console.error("Failed to delete tier:", err);
      }
    },
    [detail, applyScheduleUpdate]
  );

  const handleUpdateTierMultiplier = useCallback(
    async (tierId: string, multiplier: number) => {
      if (!detail) return;
      try {
        const updated = await updateRateScheduleTier(detail.id, tierId, { multiplier });
        applyScheduleUpdate(updated);
      } catch (err) {
        console.error("Failed to update tier:", err);
      }
    },
    [detail, applyScheduleUpdate]
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
        applyScheduleUpdate(updated);
        setEditingTierId(null);
      } catch (err) {
        console.error("Failed to update tier:", err);
      }
    },
    [detail, editingTierId, editTierForm, applyScheduleUpdate]
  );

  /* ─── Item CRUD ─── */

  const handleAddItem = useCallback(async () => {
    if (!detail || !newItemForm.catalogItemId) return;
    try {
      const updated = await addRateScheduleItem(detail.id, {
        catalogItemId: newItemForm.catalogItemId,
      });
      applyScheduleUpdate(updated);
      setNewItemForm({ name: "", code: "", unit: "HR", catalogItemId: null });
      setShowAddItem(false);
    } catch (err) {
      console.error("Failed to add item:", err);
    }
  }, [detail, newItemForm, applyScheduleUpdate]);

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
        applyScheduleUpdate(updated);
      } catch (err) {
        console.error("Failed to delete item:", err);
      }
    },
    [detail, applyScheduleUpdate]
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
        applyScheduleUpdate(updated);
        setEditingCell(null);
      } catch (err) {
        console.error("Failed to update rate:", err);
      }
    },
    [detail, editingCell, editValue, applyScheduleUpdate]
  );

  const handleAutoCalculate = useCallback(async () => {
    if (!detail) return;
    try {
      const updated = await autoCalculateRateSchedule(detail.id);
      applyScheduleUpdate(updated);
    } catch (err) {
      console.error("Failed to auto-calculate:", err);
    }
  }, [detail, applyScheduleUpdate]);

  /* ─── Render ─── */

  const fmt = (n: number | undefined) =>
    n != null ? `$${n.toFixed(2)}` : "—";

  return (
    <div className={cn(embedded ? "flex h-full min-h-0 flex-col gap-3" : "space-y-5")}>
      {/* Header */}
      {!embedded && (
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
      )}

      <Card className={cn("flex min-h-0 flex-col overflow-hidden", embedded && "h-full flex-1")}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <div className="relative min-w-[220px] flex-1 md:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/30" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Search rate books by name or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {[{ value: "", label: "All" }, ...categoryOptions].map((c) => {
              const active = c.value === "" ? !categoryFilter : categoryFilter === c.value;
              return (
                <button
                  key={c.value || "__all__"}
                  type="button"
                  onClick={() => setCategoryFilter(c.value === categoryFilter ? "" : c.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    active ? "bg-accent/10 text-accent" : "text-fg/40 hover:bg-panel2/60 hover:text-fg/60",
                  )}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-fg/35">
              {formatCount(filtered.length)} rate book{filtered.length === 1 ? "" : "s"}
            </span>
            <Button type="button" variant="accent" size="sm" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[13%]" />
              <col className="w-[9%]" />
              <col className="w-[16%]" />
              <col className="w-[7%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="border-b border-line">
                <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Rate Book</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Category</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Scope</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Effective</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Items</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Tiers</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Markup</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-fg/40">Auto</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-fg/40">
                    Loading rate books...
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-fg/40">
                    No rate books match this view.
                  </td>
                </tr>
              )}

              {!loading && visibleSchedules.map((schedule, index) => {
                const selected = selectedId === schedule.id;
                const metadataSummary = compactMetadataSummary(schedule);
                return (
                  <motion.tr
                    key={schedule.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16, delay: Math.min(index * 0.012, 0.18) }}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadDetail(schedule.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        loadDetail(schedule.id);
                      }
                    }}
                    className={cn(
                      "group cursor-pointer border-b border-line last:border-0 outline-none transition-colors",
                      selected ? "bg-accent/10" : "hover:bg-panel2/40 focus-visible:bg-panel2/60",
                    )}
                  >
                    <td className="min-w-0 px-3 py-2.5">
                      <div className="truncate text-xs font-semibold text-fg">{schedule.name}</div>
                      <div className="mt-0.5 truncate text-[11px] text-fg/45">
                        {schedule.description || metadataSummary || "No description"}
                      </div>
                      {schedule.description && metadataSummary && (
                        <div className="mt-0.5 truncate text-[10px] text-fg/35">{metadataSummary}</div>
                      )}
                    </td>
                    <td className="min-w-0 px-3 py-2.5">
                      <Badge {...categoryBadgeProps(schedule.category, entityCategories)} className="max-w-full truncate text-[10px]">
                        {categoryLabel(schedule.category, entityCategories) || "-"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-fg/55">
                      <span className="capitalize">{schedule.scope}</span>
                    </td>
                    <td className="truncate px-3 py-2.5 text-xs text-fg/45">
                      {formatScheduleDateRange(schedule.effectiveDate, schedule.expiryDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-fg/70">
                      {formatCount(schedule.items?.length ?? 0)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-fg/70">
                      {formatCount(schedule.tiers?.length ?? 0)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-fg/70">
                      {(schedule.defaultMarkup ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {schedule.autoCalculate ? (
                          <Badge tone="info" className="text-[10px]">On</Badge>
                        ) : (
                          <span className="text-xs text-fg/30">-</span>
                        )}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(schedule.id);
                          }}
                          className="rounded p-1 text-fg/30 opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100 focus:opacity-100"
                          title="Delete rate book"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel2/20 px-3 py-2 text-xs text-fg/45">
          <span className="tabular-nums">
            {filtered.length === 0 ? 0 : page * pageSize + 1}-{Math.min((page + 1) * pageSize, filtered.length)} of {formatCount(filtered.length)} rate books
          </span>
          <div className="flex items-center gap-2">
            <span>Page {page + 1} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page <= 0}
                className="rounded p-1 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                title="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                disabled={page >= totalPages - 1}
                className="rounded p-1 text-fg/45 transition-colors hover:bg-panel2/70 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
                title="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
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
                        if (e.key === "Enter" && headerForm.name.trim() && headerCategoryIsValid && headerDateRangeIsValid) {
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
                        disabled={categoryOptions.length === 0}
                        placeholder="Select category"
                        options={
                          categoryOptions.length > 0
                            ? categoryOptions
                            : [{ value: "", label: "No categories available", disabled: true }]
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Default Markup %</label>
                      <Input className="mt-1" type="number" step="0.1" value={headerForm.defaultMarkup} onChange={(e) => setHeaderForm({ ...headerForm, defaultMarkup: Number(e.target.value) || 0 })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Start Date</label>
                      <Input
                        className="mt-1"
                        type="date"
                        value={headerForm.effectiveDate}
                        onChange={(e) => setHeaderForm({ ...headerForm, effectiveDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">End Date</label>
                      <Input
                        className="mt-1"
                        type="date"
                        value={headerForm.expiryDate}
                        onChange={(e) => setHeaderForm({ ...headerForm, expiryDate: e.target.value })}
                      />
                    </div>
                  </div>
                  {!headerDateRangeIsValid && (
                    <p className="text-[10px] font-medium text-danger">End date must be on or after start date.</p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Source</label>
                      <Input
                        className="mt-1 text-xs"
                        value={headerForm.sourceName}
                        onChange={(e) => setHeaderForm({ ...headerForm, sourceName: e.target.value })}
                        placeholder="Optional source"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Version</label>
                      <Input
                        className="mt-1 text-xs"
                        value={headerForm.version}
                        onChange={(e) => setHeaderForm({ ...headerForm, version: e.target.value })}
                        placeholder="Optional version"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Region</label>
                      <Input
                        className="mt-1 text-xs"
                        value={headerForm.region}
                        onChange={(e) => setHeaderForm({ ...headerForm, region: e.target.value })}
                        placeholder="Optional region"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-fg/40 uppercase tracking-wider">Currency</label>
                      <Select
                        className="mt-1"
                        value={normalizeCurrency(headerForm.currency, organizationCurrency)}
                        onValueChange={(currency) => setHeaderForm({ ...headerForm, currency })}
                        options={currencyOptions}
                        triggerClassName="text-xs uppercase"
                      />
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
                      disabled={!headerForm.name.trim() || !headerCategoryIsValid || !headerDateRangeIsValid || creatingSaving}
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
                      <Badge {...categoryBadgeProps(detail!.category, entityCategories)} className="text-[10px]">{categoryLabel(detail!.category, entityCategories)}</Badge>
                    </div>
                    {detail!.description && <p className="text-xs text-fg/40 mt-0.5">{detail!.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-fg/35">
                      <span>Markup: {detail!.defaultMarkup}%</span>
                      {(detail!.effectiveDate || detail!.expiryDate) && (
                        <span>Effective: {formatScheduleDateRange(detail!.effectiveDate, detail!.expiryDate)}</span>
                      )}
                      {compactMetadataSummary(detail!) && <span>{compactMetadataSummary(detail!)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors" onClick={() => { setHeaderForm(headerFormFromSchedule(detail!, entityCategories, organizationCurrency)); setEditingHeader(true); }} title="Edit">
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
                            options={tierUomOptions}
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
                                options={tierUomOptions}
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

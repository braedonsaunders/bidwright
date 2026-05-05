"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Edit3,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { RateSchedule, EntityCategory, ResourceCatalogRecord } from "@/lib/api";
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
  getEntityCategories,
  getSettings,
  listResources,
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
type DrawerTab = "pricing" | "components";
type ComponentTarget = "cost" | "price" | "both";
type ComponentBasis =
  | "per_line"
  | "per_quantity"
  | "per_tier_unit"
  | "per_day"
  | "percent_of_base_cost"
  | "percent_of_base_price";

interface RatebookComponentRule {
  id: string;
  code: string;
  label: string;
  kind: string;
  target: ComponentTarget;
  basis: ComponentBasis;
  amount: number;
  appliesToTierId: string | null;
  appliesToTierName: string | null;
  categoryNames: string[];
  entityTypes: string[];
}

interface RatebookComponentTemplate {
  code: string;
  label: string;
  kind: string;
  target: ComponentTarget;
  basis: ComponentBasis;
  amount: number;
  description: string;
}

const componentKindOptions = [
  { value: "travel", label: "Travel" },
  { value: "per_diem", label: "Per Diem" },
  { value: "mileage", label: "Mileage" },
  { value: "accommodation", label: "Accommodation" },
  { value: "allowance", label: "Allowance" },
  { value: "burden", label: "Burden" },
  { value: "markup", label: "Markup" },
  { value: "discount", label: "Discount" },
  { value: "other", label: "Other" },
];

const componentTargetOptions = [
  { value: "cost", label: "Cost side" },
  { value: "price", label: "Sell side" },
  { value: "both", label: "Both" },
];

const componentBasisOptions = [
  { value: "per_line", label: "Per line" },
  { value: "per_quantity", label: "Per quantity" },
  { value: "per_tier_unit", label: "Per tier unit" },
  { value: "per_day", label: "Per day" },
  { value: "percent_of_base_cost", label: "% base cost" },
  { value: "percent_of_base_price", label: "% base sell" },
];

const componentTemplates: RatebookComponentTemplate[] = [
  {
    code: "travel_flat",
    label: "Travel allowance",
    kind: "travel",
    target: "cost",
    basis: "per_line",
    amount: 150,
    description: "Fixed mobilization or trip charge on each matching resource line.",
  },
  {
    code: "mileage",
    label: "Mileage recovery",
    kind: "mileage",
    target: "cost",
    basis: "per_quantity",
    amount: 0.75,
    description: "Variable travel cost driven by the line quantity.",
  },
  {
    code: "per_diem",
    label: "Per diem",
    kind: "per_diem",
    target: "cost",
    basis: "per_day",
    amount: 95,
    description: "Daily field allowance calculated from tier units.",
  },
  {
    code: "lodging",
    label: "Lodging",
    kind: "accommodation",
    target: "cost",
    basis: "per_day",
    amount: 175,
    description: "Hotel or accommodation cost per calculated field day.",
  },
  {
    code: "labor_burden",
    label: "Labor burden",
    kind: "burden",
    target: "cost",
    basis: "percent_of_base_cost",
    amount: 0.18,
    description: "Payroll burden, benefits, insurance, or overhead against direct cost.",
  },
  {
    code: "sell_markup",
    label: "Sell markup",
    kind: "markup",
    target: "price",
    basis: "percent_of_base_cost",
    amount: 0.15,
    description: "Customer-facing add-on over the resource direct cost.",
  },
  {
    code: "discount",
    label: "Customer discount",
    kind: "discount",
    target: "price",
    basis: "percent_of_base_price",
    amount: -0.05,
    description: "Sell-side concession against the base sell total.",
  },
  {
    code: "allowance",
    label: "General allowance",
    kind: "allowance",
    target: "both",
    basis: "per_line",
    amount: 50,
    description: "One-off allowance carried on both cost and sell sides.",
  },
];

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

function metadataArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function normalizeComponentTarget(value: unknown): ComponentTarget {
  return value === "price" || value === "both" ? value : "cost";
}

function normalizeComponentBasis(value: unknown): ComponentBasis {
  const raw = typeof value === "string" ? value : "";
  return componentBasisOptions.some((option) => option.value === raw) ? (raw as ComponentBasis) : "per_line";
}

function componentOptionLabel(options: Array<{ value: string; label: string }>, value: string) {
  return options.find((option) => option.value === value)?.label ?? value.replace(/_/g, " ");
}

function isPercentComponentBasis(basis: ComponentBasis) {
  return basis === "percent_of_base_cost" || basis === "percent_of_base_price";
}

function componentAmountInputValue(component: Pick<RatebookComponentRule, "amount" | "basis">) {
  return isPercentComponentBasis(component.basis)
    ? Number((component.amount * 100).toFixed(4))
    : component.amount;
}

function componentAmountFromInput(value: string, basis: ComponentBasis) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return isPercentComponentBasis(basis) ? amount / 100 : amount;
}

function formatComponentAmount(component: Pick<RatebookComponentRule, "amount" | "basis">) {
  if (isPercentComponentBasis(component.basis)) {
    return `${(component.amount * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  }
  return component.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function componentCodeFromLabel(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function stringArrayFromMetadata(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim()).map((entry) => entry.trim())
    : [];
}

function listInputValue(values: string[]) {
  return values.join(", ");
}

function listInputValues(value: string) {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function ratebookComponentsFromMetadata(metadata: Record<string, unknown> | null | undefined): RatebookComponentRule[] {
  const rawRules = [
    ...metadataArray(metadata?.costComponents),
    ...metadataArray(metadata?.rateComponents),
    ...metadataArray(metadata?.pricingComponents),
  ];
  return rawRules.map((rule, index) => {
    const kind = typeof rule.kind === "string" ? rule.kind : "other";
    const code = typeof rule.code === "string" && rule.code.trim() ? rule.code.trim() : kind;
    return {
      id: typeof rule.id === "string" && rule.id.trim() ? rule.id : `component-${index + 1}`,
      code,
      label: typeof rule.label === "string" && rule.label.trim() ? rule.label.trim() : code,
      kind,
      target: normalizeComponentTarget(rule.target),
      basis: normalizeComponentBasis(rule.basis),
      amount: Number(rule.amount ?? rule.rate ?? rule.percentage) || 0,
      appliesToTierId: typeof rule.appliesToTierId === "string" && rule.appliesToTierId.trim() ? rule.appliesToTierId.trim() : null,
      appliesToTierName: typeof rule.appliesToTierName === "string" && rule.appliesToTierName.trim() ? rule.appliesToTierName.trim() : null,
      categoryNames: stringArrayFromMetadata(rule.categoryNames),
      entityTypes: stringArrayFromMetadata(rule.entityTypes),
    };
  });
}

function metadataWithRatebookComponents(
  metadata: Record<string, unknown> | null | undefined,
  components: RatebookComponentRule[],
) {
  const next: Record<string, unknown> = { ...(metadata ?? {}) };
  const serialize = (component: RatebookComponentRule) => ({
    id: component.id,
    code: component.code,
    label: component.label,
    kind: component.kind,
    target: component.target,
    basis: component.basis,
    amount: component.amount,
    ...(component.appliesToTierId ? { appliesToTierId: component.appliesToTierId } : {}),
    ...(component.appliesToTierName ? { appliesToTierName: component.appliesToTierName } : {}),
    ...(component.categoryNames.length > 0 ? { categoryNames: component.categoryNames } : {}),
    ...(component.entityTypes.length > 0 ? { entityTypes: component.entityTypes } : {}),
  });
  const costComponents = components.filter((component) => component.target === "cost").map(serialize);
  const pricingComponents = components.filter((component) => component.target !== "cost").map(serialize);
  if (costComponents.length > 0) next.costComponents = costComponents;
  else delete next.costComponents;
  if (pricingComponents.length > 0) next.pricingComponents = pricingComponents;
  else delete next.pricingComponents;
  delete next.rateComponents;
  return next;
}

function emptyComponentDraft(): RatebookComponentRule {
  return {
    id: "",
    code: "",
    label: "",
    kind: "travel",
    target: "cost",
    basis: "per_line",
    amount: 0,
    appliesToTierId: null,
    appliesToTierName: null,
    categoryNames: [],
    entityTypes: [],
  };
}

/* ─── Component ─── */

export function RateScheduleManager({
  schedules: initialSchedules,
  setSchedules: setParentSchedules,
  loading,
  embedded = false,
}: {
  schedules: RateSchedule[];
  setSchedules: (s: RateSchedule[]) => void;
  loading: boolean;
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

  const [resources, setResources] = useState<ResourceCatalogRecord[]>([]);
  useEffect(() => {
    let cancelled = false;
    listResources({ limit: 750 })
      .then((rows) => {
        if (!cancelled) setResources(rows);
      })
      .catch(() => {
        if (!cancelled) setResources([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RateSchedule | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("pricing");
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
  const [editingCell, setEditingCell] = useState<{ itemId: string; tierId: string; side: "cost" | "sell" } | null>(null);
  const [editValue, setEditValue] = useState("");

  // New tier/item forms
  const [showAddTier, setShowAddTier] = useState(false);
  const [newTierName, setNewTierName] = useState("");
  const [newTierMultiplier, setNewTierMultiplier] = useState("1.0");
  const [newTierUom, setNewTierUom] = useState<string>("__none__");
  const [editingTierId, setEditingTierId] = useState<string | null>(null);
  const [editTierForm, setEditTierForm] = useState<{ name: string; multiplier: string; uom: string }>({ name: "", multiplier: "1.0", uom: "__none__" });
  const [showAddItem, setShowAddItem] = useState(false);
  const [resourceQuery, setResourceQuery] = useState("");
  const [componentDraft, setComponentDraft] = useState<RatebookComponentRule>(emptyComponentDraft);
  const [newItemForm, setNewItemForm] = useState({
    name: "",
    code: "",
    unit: "EA",
    resourceId: null as string | null,
    catalogItemId: null as string | null,
  });
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
    setDrawerTab("pricing");
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
    setDrawerTab("pricing");
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

  const ratebookComponents = useMemo(
    () => ratebookComponentsFromMetadata(detail?.metadata),
    [detail?.metadata],
  );

  const handleAddComponent = useCallback(async () => {
    if (!detail) return;
    const label = componentDraft.label.trim();
    const code = componentDraft.code.trim() || componentCodeFromLabel(label);
    if (!label || !code) return;
    const nextComponent: RatebookComponentRule = {
      ...componentDraft,
      id: componentDraft.id || `component-${Date.now()}`,
      code,
      label,
      amount: Number(componentDraft.amount) || 0,
    };
    const nextComponents = componentDraft.id
      ? ratebookComponents.map((component) => (component.id === componentDraft.id ? nextComponent : component))
      : [...ratebookComponents, nextComponent];
    try {
      const updated = await updateRateSchedule(detail.id, {
        metadata: metadataWithRatebookComponents(detail.metadata, nextComponents),
      });
      applyScheduleUpdate(updated);
      setComponentDraft(emptyComponentDraft());
    } catch (err) {
      console.error("Failed to add ratebook component:", err);
    }
  }, [applyScheduleUpdate, componentDraft, detail, ratebookComponents]);

  const handleUseComponentTemplate = useCallback((template: RatebookComponentTemplate) => {
    setComponentDraft({
      id: "",
      code: template.code,
      label: template.label,
      kind: template.kind,
      target: template.target,
      basis: template.basis,
      amount: template.amount,
      appliesToTierId: null,
      appliesToTierName: null,
      categoryNames: [],
      entityTypes: [],
    });
    setDrawerTab("components");
  }, []);

  const handleEditComponent = useCallback((component: RatebookComponentRule) => {
    setComponentDraft({
      ...component,
      categoryNames: [...component.categoryNames],
      entityTypes: [...component.entityTypes],
    });
    setDrawerTab("components");
  }, []);

  const handleDeleteComponent = useCallback(async (componentId: string) => {
    if (!detail) return;
    try {
      const updated = await updateRateSchedule(detail.id, {
        metadata: metadataWithRatebookComponents(
          detail.metadata,
          ratebookComponents.filter((component) => component.id !== componentId),
        ),
      });
      applyScheduleUpdate(updated);
    } catch (err) {
      console.error("Failed to delete ratebook component:", err);
    }
  }, [applyScheduleUpdate, detail, ratebookComponents]);

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

  const filteredResources = useMemo(() => {
    const query = resourceQuery.trim().toLowerCase();
    if (!query) return resources;
    return resources.filter((resource) =>
      [
        resource.name,
        resource.code,
        resource.category,
        resource.resourceType,
        resource.manufacturer,
        resource.manufacturerPartNumber,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [resourceQuery, resources]);

  const handleAddItem = useCallback(async () => {
    if (!detail || (!newItemForm.resourceId && !newItemForm.catalogItemId)) return;
    try {
      const updated = await addRateScheduleItem(detail.id, {
        resourceId: newItemForm.resourceId,
        catalogItemId: newItemForm.catalogItemId,
      });
      applyScheduleUpdate(updated);
      setNewItemForm({ name: "", code: "", unit: "EA", resourceId: null, catalogItemId: null });
      setResourceQuery("");
      setShowAddItem(false);
    } catch (err) {
      console.error("Failed to add item:", err);
    }
  }, [detail, newItemForm, applyScheduleUpdate]);

  const handleResourceSelect = useCallback((resourceId: string) => {
    const resource = resources.find((candidate) => candidate.id === resourceId);
    if (!resource) {
      setNewItemForm({ name: "", code: "", unit: "EA", resourceId: null, catalogItemId: null });
      return;
    }
    setNewItemForm({
      name: resource.name,
      code: resource.code,
      unit: resource.defaultUom || "EA",
      resourceId: resource.id,
      catalogItemId: resource.catalogItemId,
    });
  }, [resources]);

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

  const startRateEdit = (item: Item, tierId: string, side: "cost" | "sell") => {
    setEditingCell({ itemId: item.id, tierId, side });
    setEditValue(String(side === "cost" ? item.costRates?.[tierId] ?? 0 : item.rates?.[tierId] ?? 0));
  };

  const saveRateEdit = useCallback(
    async (item: Item) => {
      if (!detail || !editingCell) return;
      const val = parseFloat(editValue) || 0;
      const patch = editingCell.side === "cost"
        ? { costRates: { ...item.costRates, [editingCell.tierId]: val } }
        : { rates: { ...item.rates, [editingCell.tierId]: val } };
      try {
        const updated = await updateRateScheduleItem(detail.id, item.id, patch);
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
              <CardTitle>Ratebooks</CardTitle>
              <p className="text-xs text-fg/40 mt-0.5">
                                               Manage resource cost and sell overrides. Import these into projects.
              </p>
            </div>
            <Button variant="accent" size="xs" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" />
              New Ratebook
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
              placeholder="Search Ratebooks by name or description..."
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
              {formatCount(filtered.length)} ratebook{filtered.length === 1 ? "" : "s"}
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
                <th className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Ratebook</th>
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
                    Loading Ratebooks...
                  </td>
                </tr>
              )}

              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-sm text-fg/40">
                    No Ratebooks match this view.
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
                          title="Delete Ratebook"
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
            {filtered.length === 0 ? 0 : page * pageSize + 1}-{Math.min((page + 1) * pageSize, filtered.length)} of {formatCount(filtered.length)} Ratebooks
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
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 right-0 z-40 flex w-[min(1120px,calc(100vw-24px))] flex-col border-l border-line bg-panel shadow-2xl"
          >
            {/* Drawer header */}
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line bg-panel2/40">
              {editingHeader ? (
                <div className="flex-1 space-y-3">
                  {isCreating && (
                    <p className="text-[11px] font-semibold text-fg/55 uppercase tracking-wider">New Ratebook</p>
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
                      placeholder="e.g. Customer Resource Rates"
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

            {!isCreating && detail && !editingHeader && (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-5 py-2">
                <div className="flex items-center gap-1 rounded-lg bg-bg/45 p-1">
                  {[
                    { id: "pricing" as DrawerTab, label: "Resource Pricing", icon: DollarSign },
                    { id: "components" as DrawerTab, label: "Components", icon: SlidersHorizontal },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = drawerTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setDrawerTab(tab.id)}
                        className={cn(
                          "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors",
                          active ? "bg-panel text-fg shadow-sm" : "text-fg/45 hover:text-fg",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <div className="hidden items-center gap-2 text-[10px] text-fg/40 md:flex">
                  <span>{formatCount(detail.items.length)} resource rows</span>
                  <span>{formatCount(detail.tiers.length)} tiers</span>
                  <span>{formatCount(ratebookComponents.length)} components</span>
                </div>
              </div>
            )}

            {/* Drawer body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {isCreating ? (
                <div className="flex items-center justify-center py-12 text-center text-xs text-fg/40">
                  Save the schedule to start adding tiers and items.
                </div>
              ) : loadingDetail || !detail ? (
                <div className="flex items-center justify-center py-12 text-xs text-fg/30">Loading...</div>
              ) : drawerTab === "components" ? (
                <div className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-line bg-bg/35 px-3 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">Cost Rules</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums text-fg">
                        {formatCount(ratebookComponents.filter((component) => component.target === "cost" || component.target === "both").length)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-line bg-bg/35 px-3 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">Sell Rules</div>
                      <div className="mt-1 text-lg font-semibold tabular-nums text-fg">
                        {formatCount(ratebookComponents.filter((component) => component.target === "price" || component.target === "both").length)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-line bg-bg/35 px-3 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-fg/35">Currency</div>
                      <div className="mt-1 text-lg font-semibold uppercase text-fg">
                        {normalizeCurrency(metadataText(detail.metadata, "currency"), organizationCurrency)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg/40">Templates</h3>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {componentTemplates.map((template) => (
                        <button
                          key={template.code}
                          type="button"
                          onClick={() => handleUseComponentTemplate(template)}
                          className="rounded-lg border border-line bg-bg/25 p-3 text-left transition-colors hover:border-accent/40 hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-fg">{template.label}</span>
                            <Badge tone={template.target === "cost" ? "warning" : template.target === "price" ? "success" : "info"} className="shrink-0 text-[10px]">
                              {template.target === "price" ? "Sell" : template.target === "both" ? "Both" : "Cost"}
                            </Badge>
                          </div>
                          <div className="mt-1 text-[11px] text-fg/45">{template.description}</div>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-fg/35">
                            <span>{componentOptionLabel(componentBasisOptions, template.basis)}</span>
                            <span className="font-mono tabular-nums">{formatComponentAmount(template)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-line bg-bg/20 p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium uppercase tracking-wider text-fg/40">Rule Editor</div>
                      </div>
                      {componentDraft.id ? (
                        <Button size="xs" variant="ghost" onClick={() => setComponentDraft(emptyComponentDraft())}>
                          <X className="h-3 w-3" />
                          Clear
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Label</label>
                          <Input
                            className="mt-1 h-8 text-xs"
                            value={componentDraft.label}
                            onChange={(event) => {
                              const label = event.target.value;
                              setComponentDraft((current) => ({
                                ...current,
                                label,
                                code: !current.code || current.code === componentCodeFromLabel(current.label)
                                  ? componentCodeFromLabel(label)
                                  : current.code,
                              }));
                            }}
                            placeholder="Travel zone A"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Code</label>
                          <Input
                            className="mt-1 h-8 font-mono text-xs"
                            value={componentDraft.code}
                            onChange={(event) => setComponentDraft((current) => ({ ...current, code: event.target.value }))}
                            placeholder="travel_zone_a"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Kind</label>
                          <Select
                            className="mt-1"
                            size="xs"
                            value={componentDraft.kind}
                            onValueChange={(kind) => setComponentDraft((current) => ({ ...current, kind }))}
                            options={componentKindOptions}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Side</label>
                          <Select
                            className="mt-1"
                            size="xs"
                            value={componentDraft.target}
                            onValueChange={(target) => setComponentDraft((current) => ({ ...current, target: target as ComponentTarget }))}
                            options={componentTargetOptions}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Basis</label>
                          <Select
                            className="mt-1"
                            size="xs"
                            value={componentDraft.basis}
                            onValueChange={(basis) => {
                              const nextBasis = basis as ComponentBasis;
                              setComponentDraft((current) => {
                                const wasPercent = isPercentComponentBasis(current.basis);
                                const isPercent = isPercentComponentBasis(nextBasis);
                                const amount = wasPercent === isPercent
                                  ? current.amount
                                  : isPercent
                                    ? current.amount / 100
                                    : current.amount * 100;
                                return { ...current, basis: nextBasis, amount };
                              });
                            }}
                            options={componentBasisOptions}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">
                            Amount{isPercentComponentBasis(componentDraft.basis) ? " %" : ""}
                          </label>
                          <Input
                            className="mt-1 h-8 text-right text-xs"
                            type="number"
                            step="0.01"
                            value={componentAmountInputValue(componentDraft)}
                            onChange={(event) => setComponentDraft((current) => ({
                              ...current,
                              amount: componentAmountFromInput(event.target.value, current.basis),
                            }))}
                          />
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Tier Scope</label>
                          <Select
                            className="mt-1"
                            size="xs"
                            value={componentDraft.appliesToTierId ?? "__all__"}
                            onValueChange={(tierId) => {
                              const tier = detail.tiers.find((candidate) => candidate.id === tierId);
                              setComponentDraft((current) => ({
                                ...current,
                                appliesToTierId: tierId === "__all__" ? null : tierId,
                                appliesToTierName: tierId === "__all__" ? null : tier?.name ?? null,
                              }));
                            }}
                            options={[
                              { value: "__all__", label: "All tiers" },
                              ...detail.tiers
                                .slice()
                                .sort((left, right) => left.sortOrder - right.sortOrder)
                                .map((tier) => ({ value: tier.id, label: tier.name })),
                            ]}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Category Filters</label>
                          <Input
                            className="mt-1 h-8 text-xs"
                            value={listInputValue(componentDraft.categoryNames)}
                            onChange={(event) => setComponentDraft((current) => ({ ...current, categoryNames: listInputValues(event.target.value) }))}
                            placeholder="Optional, comma separated"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-medium uppercase text-fg/40">Entity Type Filters</label>
                          <Input
                            className="mt-1 h-8 text-xs"
                            value={listInputValue(componentDraft.entityTypes)}
                            onChange={(event) => setComponentDraft((current) => ({ ...current, entityTypes: listInputValues(event.target.value) }))}
                            placeholder="Optional, comma separated"
                          />
                        </div>
                        <div className="flex items-end justify-end gap-2 pt-1">
                          <Button size="xs" variant="ghost" onClick={() => setComponentDraft(emptyComponentDraft())}>
                            Reset
                          </Button>
                          <Button size="xs" onClick={handleAddComponent} disabled={!componentDraft.label.trim()}>
                            <Plus className="h-3 w-3" />
                            {componentDraft.id ? "Save Rule" : "Add Rule"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg/40">Active Rules</h3>
                      <Badge tone="info" className="text-[10px]">{formatCount(ratebookComponents.length)} active</Badge>
                    </div>
                    {ratebookComponents.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-fg/35">
                        No Ratebook component rules yet.
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-lg border border-line">
                        <table className="w-full min-w-[900px] text-xs">
                          <thead className="bg-bg/45">
                            <tr className="border-b border-line">
                              <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-fg/40">Rule</th>
                              <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-fg/40">Side</th>
                              <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-fg/40">Basis</th>
                              <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-fg/40">Amount</th>
                              <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-fg/40">Applies</th>
                              <th className="w-16" />
                            </tr>
                          </thead>
                          <tbody>
                            {ratebookComponents.map((component) => {
                              const tier = component.appliesToTierId
                                ? detail.tiers.find((candidate) => candidate.id === component.appliesToTierId)
                                : null;
                              const applies = [
                                tier?.name ?? component.appliesToTierName ?? "All tiers",
                                component.categoryNames.length > 0 ? `Categories: ${component.categoryNames.join(", ")}` : "",
                                component.entityTypes.length > 0 ? `Types: ${component.entityTypes.join(", ")}` : "",
                              ].filter(Boolean).join(" · ");
                              return (
                                <tr key={component.id} className="border-b border-line/60 last:border-b-0">
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-fg">{component.label}</div>
                                    <div className="font-mono text-[10px] text-fg/35">{component.code} · {componentOptionLabel(componentKindOptions, component.kind)}</div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <Badge tone={component.target === "cost" ? "warning" : component.target === "price" ? "success" : "info"} className="text-[10px]">
                                      {component.target === "price" ? "Sell" : component.target === "both" ? "Both" : "Cost"}
                                    </Badge>
                                  </td>
                                  <td className="px-3 py-2 text-fg/55">{componentOptionLabel(componentBasisOptions, component.basis)}</td>
                                  <td className="px-3 py-2 text-right font-mono tabular-nums text-fg/75">{formatComponentAmount(component)}</td>
                                  <td className="px-3 py-2 text-fg/50">{applies}</td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleEditComponent(component)}
                                        className="rounded p-1 text-fg/35 transition-colors hover:bg-accent/10 hover:text-accent"
                                        title="Edit rule"
                                      >
                                        <Edit3 className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteComponent(component.id)}
                                        className="rounded p-1 text-fg/30 transition-colors hover:bg-danger/10 hover:text-danger"
                                        title="Delete rule"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
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
                      <p className="text-xs text-fg/30 py-2">No tiers. Add tiers such as Each, Day, Week, Regular, or Overtime.</p>
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
                                <th key={tier.id} className="text-right py-2 px-1 text-[10px] font-medium text-fg/40 uppercase tracking-wider w-32" colSpan={2}>
                                  {tier.name}
                                </th>
                              ))}
                              <th className="w-8" />
                            </tr>
                            {detail.tiers.length > 0 ? (
                              <tr className="border-b border-line/60">
                                <th />
                                <th />
                                <th />
                                {detail.tiers
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .flatMap((tier) => [
                                    <th key={`${tier.id}:cost`} className="text-right py-1 px-1 text-[9px] font-medium text-fg/35 uppercase tracking-wider">Cost</th>,
                                    <th key={`${tier.id}:sell`} className="text-right py-1 px-1 text-[9px] font-medium text-fg/35 uppercase tracking-wider">Sell</th>,
                                  ])}
                                <th />
                              </tr>
                            ) : null}
                          </thead>
                          <tbody>
                            {detail.items.sort((a, b) => a.sortOrder - b.sortOrder).map((item) => (
                              <tr key={item.id} className="border-b border-line/50 hover:bg-panel2/20 group">
                                <td className="py-1.5 pr-2 text-fg/60 font-mono text-[11px]">{item.code || "—"}</td>
                                <td className="py-1.5 pr-2 text-fg font-medium text-[11px] truncate max-w-[160px]">{item.name}</td>
                                <td className="py-1.5 pr-1 text-fg/50 text-[11px]">{item.unit}</td>
                                {detail.tiers
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .flatMap((tier) => [
                                    <td key={`${tier.id}:cost`} className="py-1 px-0.5">
                                      <div className="flex flex-col items-end">
                                        {editingCell?.itemId === item.id && editingCell?.tierId === tier.id && editingCell.side === "cost" ? (
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
                                            onClick={() => startRateEdit(item, tier.id, "cost")}
                                            className="text-right text-[11px] text-fg/80 hover:text-accent px-0.5 py-0.5 rounded hover:bg-accent/5 transition-colors w-16"
                                          >
                                            {fmt(item.costRates?.[tier.id])}
                                          </button>
                                        )}
                                      </div>
                                    </td>,
                                    <td key={`${tier.id}:sell`} className="py-1 px-0.5">
                                      <div className="flex flex-col items-end">
                                        {editingCell?.itemId === item.id && editingCell?.tierId === tier.id && editingCell.side === "sell" ? (
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
                                            onClick={() => startRateEdit(item, tier.id, "sell")}
                                            className="text-right text-[11px] text-fg/80 hover:text-accent px-0.5 py-0.5 rounded hover:bg-accent/5 transition-colors w-16"
                                          >
                                            {fmt(item.rates?.[tier.id])}
                                          </button>
                                        )}
                                      </div>
                                    </td>,
                                  ])}
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
                              <label className="text-[10px] font-medium text-fg/40 uppercase">Resource</label>
                              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)]">
                                <Input
                                  value={resourceQuery}
                                  onChange={(event) => setResourceQuery(event.target.value)}
                                  placeholder="Search resources..."
                                  className="h-8"
                                />
                                <Select
                                  value={newItemForm.resourceId ?? ""}
                                  onValueChange={handleResourceSelect}
                                  options={filteredResources.slice(0, 100).map((resource) => ({
                                    value: resource.id,
                                    label: [resource.code, resource.name].filter(Boolean).join(" · ") || resource.id,
                                  }))}
                                  placeholder="Select resource"
                                  size="xs"
                                  disabled={resources.length === 0}
                                />
                              </div>
                              {resources.length === 0 ? (
                                <p className="mt-1 text-[11px] text-fg/40">No resources found.</p>
                              ) : null}
                              {newItemForm.resourceId && (
                                <p className="mt-1 text-[10px] text-fg/40">
                                  {newItemForm.code && <span className="font-mono mr-1">{newItemForm.code}</span>}
                                  {newItemForm.name} · {newItemForm.unit}
                                </p>
                              )}
                            </div>
                            <Button size="xs" onClick={handleAddItem} disabled={!newItemForm.resourceId && !newItemForm.catalogItemId}>Add</Button>
                            <Button size="xs" variant="ghost" onClick={() => { setShowAddItem(false); setResourceQuery(""); setNewItemForm({ name: "", code: "", unit: "EA", resourceId: null, catalogItemId: null }); }}><X className="h-3 w-3" /></Button>
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

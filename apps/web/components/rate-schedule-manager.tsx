"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Calculator,
  Check,
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
  Drawer,
  Input,
  RecordList,
  SearchSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type RecordColumn,
} from "@braedonsaunders/appkit-ui";
import { useUomOptions } from "@/components/shared/uom-select";

/* ─── Constants ─── */

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
): { style?: React.CSSProperties; variant?: "secondary" } {
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
  return { variant: "secondary" };
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
  | "per_hour"
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
  { value: "per_hour", label: "Per hour" },
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

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number) {
  const sign = value < 0 ? -1 : 1;
  return sign * Number(`${Math.round(Number(`${Math.abs(value)}e2`))}e-2`);
}

function catalogBaseCost(item: Item) {
  return finiteNumber(item.catalogUnitCost);
}

function costComponentAppliesToTier(component: RatebookComponentRule, tier: Tier) {
  if (component.appliesToTierId && component.appliesToTierId !== tier.id) return false;
  if (component.appliesToTierName && categoryLookupValue(component.appliesToTierName) !== categoryLookupValue(tier.name)) return false;
  return true;
}

function loadedCostForTierUnit(item: Item, tier: Tier, components: RatebookComponentRule[]) {
  const unitCost = catalogBaseCost(item);
  if (unitCost === null) return null;

  const baseCost = roundMoney(unitCost * (finiteNumber(tier.multiplier) ?? 1));
  const basePrice = finiteNumber(item.rates?.[tier.id]) ?? 0;
  return components
    .filter((component) => component.target === "cost" || component.target === "both")
    .filter((component) => costComponentAppliesToTier(component, tier))
    .reduce((total, component) => {
      const amount = finiteNumber(component.amount) ?? 0;
      switch (component.basis) {
        case "percent_of_base_cost":
          return total + baseCost * amount;
        case "percent_of_base_price":
          return total + basePrice * amount;
        case "per_line":
        case "per_quantity":
        case "per_tier_unit":
        case "per_hour":
        case "per_day":
        default:
          return total + amount;
      }
    }, baseCost);
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
  const [itemSearch, setItemSearch] = useState("");
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
  const [addingItem, setAddingItem] = useState(false);
  const [addItemError, setAddItemError] = useState("");
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourcePage, setResourcePage] = useState(0);
  const [componentDraft, setComponentDraft] = useState<RatebookComponentRule>(emptyComponentDraft);
  const [componentTemplatesOpen, setComponentTemplatesOpen] = useState(false);
  const [componentEditorOpen, setComponentEditorOpen] = useState(false);
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
    setItemSearch("");
    setResourceQuery("");
    setResourcePage(0);
    setAddItemError("");
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
      setComponentEditorOpen(false);
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
    setComponentEditorOpen(true);
  }, []);

  const handleEditComponent = useCallback((component: RatebookComponentRule) => {
    setComponentDraft({
      ...component,
      categoryNames: [...component.categoryNames],
      entityTypes: [...component.entityTypes],
    });
    setDrawerTab("components");
    setComponentEditorOpen(true);
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

  // One-click tier presets so a new rate book is set up correctly:
  //  - "labour": multiplier tiers (Reg 1.0 / OT 1.5 / DT 2.0), UoM left blank —
  //    paired with a "Tiered Rate Schedule" category (the per-tier hours grid).
  //  - "duration": UoM tiers (Day / Week / Month) — paired with a "Duration /
  //    Usage Pricing" category (the UoM picks the rate; quantity × duration).
  const handleApplyTierPreset = useCallback(
    async (preset: "labour" | "duration") => {
      if (!detail) return;
      const presetTiers =
        preset === "labour"
          ? [
              { name: "Regular", multiplier: 1.0, uom: null },
              { name: "Overtime", multiplier: 1.5, uom: null },
              { name: "Double Time", multiplier: 2.0, uom: null },
            ]
          : [
              { name: "Daily", multiplier: 1.0, uom: "DAY" },
              { name: "Weekly", multiplier: 1.0, uom: "WK" },
              { name: "Monthly", multiplier: 1.0, uom: "MO" },
            ];
      try {
        let updated = detail;
        for (const tier of presetTiers) {
          updated = await addRateScheduleTier(detail.id, tier);
        }
        applyScheduleUpdate(updated);
        setShowAddTier(false);
      } catch (err) {
        console.error("Failed to apply tier preset:", err);
      }
    },
    [detail, applyScheduleUpdate],
  );

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

  const resourcePageSize = 12;
  const resourceTotalPages = Math.max(1, Math.ceil(filteredResources.length / resourcePageSize));
  const visibleResources = useMemo(
    () => filteredResources.slice(resourcePage * resourcePageSize, (resourcePage + 1) * resourcePageSize),
    [filteredResources, resourcePage],
  );

  useEffect(() => {
    setResourcePage(0);
  }, [resourceQuery]);

  useEffect(() => {
    setResourcePage((current) => Math.min(current, resourceTotalPages - 1));
  }, [resourceTotalPages]);

  const closeAddItemDrawer = useCallback(() => {
    if (addingItem) return;
    setShowAddItem(false);
    setResourceQuery("");
    setResourcePage(0);
    setAddItemError("");
    setNewItemForm({ name: "", code: "", unit: "EA", resourceId: null, catalogItemId: null });
  }, [addingItem]);

  const handleAddItem = useCallback(async () => {
    if (!detail || !newItemForm.catalogItemId) return;
    setAddingItem(true);
    setAddItemError("");
    try {
      const updated = await addRateScheduleItem(detail.id, {
        resourceId: newItemForm.resourceId,
        catalogItemId: newItemForm.catalogItemId,
      });
      applyScheduleUpdate(updated);
      setNewItemForm({ name: "", code: "", unit: "EA", resourceId: null, catalogItemId: null });
      setResourceQuery("");
      setResourcePage(0);
      setShowAddItem(false);
    } catch (err) {
      console.error("Failed to add item:", err);
      setAddItemError(err instanceof Error ? err.message : "Could not add this resource to the Ratebook.");
    } finally {
      setAddingItem(false);
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

  const startSellRateEdit = (item: Item, tierId: string) => {
    setEditingCell({ itemId: item.id, tierId });
    setEditValue(String(item.rates?.[tierId] ?? 0));
  };

  const saveRateEdit = useCallback(
    async (item: Item) => {
      if (!detail || !editingCell) return;
      const val = parseFloat(editValue) || 0;
      const patch = { rates: { ...item.rates, [editingCell.tierId]: val } };
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

  const visibleRatebookItems = useMemo(() => {
    if (!detail) return [];
    const query = itemSearch.trim().toLowerCase();
    return detail.items
      .filter((item) => !query || [item.code, item.name, item.unit].some((value) => value.toLowerCase().includes(query)))
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }, [detail, itemSearch]);

  const resourceColumns = useMemo<RecordColumn<ResourceCatalogRecord>[]>(() => [
    {
      key: "name",
      label: "Resource",
      width: "48%",
      render: (resource) => (
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-fg">{resource.name}</div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-fg/40">{resource.code || "No resource code"}</div>
        </div>
      ),
    },
    {
      key: "category",
      label: "Category",
      width: "24%",
      render: (resource) => <span className="text-xs text-fg/55">{resource.category || resource.resourceType || "—"}</span>,
    },
    {
      key: "defaultUom",
      label: "UoM",
      width: "10%",
      render: (resource) => <span className="text-xs font-medium text-fg/60">{resource.defaultUom || "EA"}</span>,
    },
    {
      key: "catalogItemId",
      label: "Cost source",
      width: "18%",
      render: (resource) => (
        <Badge variant={resource.catalogItemId ? "success" : "warning"} className="text-[10px]">
          {resource.catalogItemId ? "Ready" : "Missing"}
        </Badge>
      ),
    },
  ], []);

  const scheduleColumns = useMemo<RecordColumn<RateSchedule>[]>(() => [
    {
      key: "name",
      label: "Ratebook",
      width: "30%",
      render: (schedule) => {
        const metadataSummary = compactMetadataSummary(schedule);
        return (
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-fg">{schedule.name}</div>
            <div className="mt-0.5 truncate text-[11px] text-fg/45">
              {schedule.description || metadataSummary || "No description"}
            </div>
            {schedule.description && metadataSummary ? (
              <div className="mt-0.5 truncate text-[10px] text-fg/35">{metadataSummary}</div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "category",
      label: "Category",
      width: "13%",
      render: (schedule) => (
        <Badge {...categoryBadgeProps(schedule.category, entityCategories)} className="max-w-full truncate text-[10px]">
          {categoryLabel(schedule.category, entityCategories) || "-"}
        </Badge>
      ),
    },
    {
      key: "scope",
      label: "Scope",
      width: "9%",
      render: (schedule) => <span className="capitalize">{schedule.scope}</span>,
    },
    {
      key: "effectiveDate",
      label: "Effective",
      width: "16%",
      render: (schedule) => (
        <span className="text-xs text-fg/45">
          {formatScheduleDateRange(schedule.effectiveDate, schedule.expiryDate)}
        </span>
      ),
    },
    {
      key: "items",
      label: "Items",
      kind: "amount",
      width: "7%",
      format: (_value, schedule) => formatCount(schedule.items?.length ?? 0),
    },
    {
      key: "tiers",
      label: "Tiers",
      kind: "amount",
      width: "7%",
      format: (_value, schedule) => formatCount(schedule.tiers?.length ?? 0),
    },
    {
      key: "defaultMarkup",
      label: "Markup",
      kind: "amount",
      width: "10%",
      format: (_value, schedule) => `${(schedule.defaultMarkup ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`,
    },
    {
      key: "actions",
      label: "Auto",
      kind: "actions",
      width: "8%",
      render: (schedule) => (
        <div className="flex items-center justify-end gap-1.5">
          {schedule.autoCalculate ? <Badge variant="info" className="text-[10px]">On</Badge> : <span className="text-xs text-fg/30">-</span>}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void handleDelete(schedule.id);
            }}
            className="rounded p-1 text-fg/30 transition-colors hover:bg-danger/10 hover:text-danger"
            title="Delete Ratebook"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ], [entityCategories, handleDelete]);

  return (
    <div className={cn(embedded ? "flex h-full min-h-0 flex-col gap-3" : "space-y-5")}>
      {/* Header */}
      {!embedded && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Ratebooks</CardTitle>
              <p className="text-xs text-fg/40 mt-0.5">
                                               Manage resource cost and sell overrides. Import these into projects.
              </p>
            </div>
            <Button variant="default" size="sm" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" />
              New Ratebook
            </Button>
          </CardHeader>
        </Card>
      )}

      <RecordList
        columns={scheduleColumns}
        rows={loading ? [] : visibleSchedules}
        getRowId={(schedule) => schedule.id}
        className={cn(embedded && "flex h-full min-h-0 flex-1 flex-col")}
        tableClassName="table-fixed"
        tableContainerClassName={cn(
          embedded && "min-h-0 flex-1 overflow-auto rounded-none border-0 bg-transparent shadow-none",
        )}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search Ratebooks by name or description...",
        }}
        filters={(
          <SearchSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={categoryOptions}
            clearable
            emptyLabel="All categories"
            placeholder="All categories"
            ariaLabel="Filter Ratebooks by category"
            className="w-52"
          />
        )}
        toolbarActions={(
          <>
            <span className="text-[10px] text-fg/35">
              {formatCount(filtered.length)} ratebook{filtered.length === 1 ? "" : "s"}
            </span>
            <Button type="button" size="sm" onClick={startCreate}>
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </>
        )}
        pagination={{
          page: page + 1,
          perPage: pageSize,
          total: filtered.length,
          onPageChange: (nextPage) => setPage(nextPage - 1),
        }}
        empty={{
          title: loading ? "Loading Ratebooks..." : "No Ratebooks match this view.",
          description: loading ? "Fetching the latest Ratebook records." : "Try another search or category filter.",
        }}
        onRowClick={(schedule) => void loadDetail(schedule.id)}
      />

      <Drawer
        open={Boolean(isCreating || (selectedId && detail))}
        onClose={() => {
          closeAddItemDrawer();
          if (isCreating) {
            setIsCreating(false);
            setEditingHeader(false);
          } else {
            setSelectedId(null);
            setDetail(null);
          }
        }}
        size="2xl"
        title={editingHeader ? (isCreating ? "New Ratebook" : "Edit Ratebook") : detail?.name ?? "Ratebook"}
        description={
          editingHeader
            ? "Configure the Ratebook identity, category, effective dates, and source metadata."
            : detail
              ? [detail.description, compactMetadataSummary(detail)].filter(Boolean).join(" · ") || "Resource pricing and cost rules."
              : "Resource pricing and cost rules."
        }
        headerActions={!editingHeader && detail ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setHeaderForm(headerFormFromSchedule(detail, entityCategories, organizationCurrency));
              setEditingHeader(true);
            }}
          >
            <Edit3 className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : undefined}
        bodyClassName="overflow-y-auto p-0"
      >
              {editingHeader ? (
                <div className="space-y-3 p-5">
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
                      <SearchSelect
                        className="mt-1"
                        value={headerForm.category}
                        onChange={(v) => setHeaderForm({ ...headerForm, category: v })}
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
                      <SearchSelect
                        className="mt-1"
                        value={normalizeCurrency(headerForm.currency, organizationCurrency)}
                        onChange={(currency) => setHeaderForm({ ...headerForm, currency })}
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
                      size="sm"
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
                      size="sm"
                      onClick={isCreating ? handleCreate : handleUpdateHeader}
                      disabled={!headerForm.name.trim() || !headerCategoryIsValid || !headerDateRangeIsValid || creatingSaving}
                    >
                      {isCreating ? (creatingSaving ? "Creating…" : "Create") : "Save"}
                    </Button>
                  </div>
                </div>
              ) : null}

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
            <div className="space-y-5 p-5">
              {isCreating ? (
                <div className="flex items-center justify-center py-12 text-center text-xs text-fg/40">
                  Save the schedule to start adding tiers and items.
                </div>
              ) : loadingDetail || !detail ? (
                <div className="flex items-center justify-center py-12 text-xs text-fg/30">Loading...</div>
              ) : drawerTab === "components" ? (
                <div className="space-y-4">
                  <div>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg/40">Active Rules</h3>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-fg/35">
                          <span>{formatCount(ratebookComponents.filter((component) => component.target === "cost" || component.target === "both").length)} cost</span>
                          <span>{formatCount(ratebookComponents.filter((component) => component.target === "price" || component.target === "both").length)} sell</span>
                          <span>{normalizeCurrency(metadataText(detail.metadata, "currency"), organizationCurrency)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={componentTemplatesOpen ? "secondary" : "ghost"}
                          onClick={() => setComponentTemplatesOpen((open) => !open)}
                        >
                          <ChevronRight className={cn("h-3 w-3 transition-transform", componentTemplatesOpen && "rotate-90")} />
                          Templates
                        </Button>
                        <Button
                          size="sm"
                          variant={componentEditorOpen ? "secondary" : "ghost"}
                          onClick={() => setComponentEditorOpen((open) => !open)}
                        >
                          <ChevronRight className={cn("h-3 w-3 transition-transform", componentEditorOpen && "rotate-90")} />
                          {componentDraft.id ? "Editing Rule" : "New Rule"}
                        </Button>
                      </div>
                    </div>
                    {ratebookComponents.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-fg/35">
                        No Ratebook component rules yet.
                      </div>
                    ) : (
                      <Table className="min-w-[900px] text-xs">
                          <TableHeader className="bg-bg/45">
                            <TableRow noAnimate className="border-b border-line">
                              <TableHead className="h-auto px-3 py-2 text-[10px]">Rule</TableHead>
                              <TableHead className="h-auto px-3 py-2 text-[10px]">Side</TableHead>
                              <TableHead className="h-auto px-3 py-2 text-[10px]">Basis</TableHead>
                              <TableHead className="h-auto px-3 py-2 text-right text-[10px]">Amount</TableHead>
                              <TableHead className="h-auto px-3 py-2 text-[10px]">Applies</TableHead>
                              <TableHead className="h-auto w-16" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
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
                                <TableRow key={component.id} className="border-b border-line/60 last:border-b-0">
                                  <TableCell className="px-3 py-2">
                                    <div className="font-medium text-fg">{component.label}</div>
                                    <div className="font-mono text-[10px] text-fg/35">{component.code} · {componentOptionLabel(componentKindOptions, component.kind)}</div>
                                  </TableCell>
                                  <TableCell className="px-3 py-2">
                                    <Badge variant={component.target === "cost" ? "warning" : component.target === "price" ? "success" : "info"} className="text-[10px]">
                                      {component.target === "price" ? "Sell" : component.target === "both" ? "Both" : "Cost"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="px-3 py-2 text-fg/55">{componentOptionLabel(componentBasisOptions, component.basis)}</TableCell>
                                  <TableCell className="px-3 py-2 text-right font-mono tabular-nums text-fg/75">{formatComponentAmount(component)}</TableCell>
                                  <TableCell className="px-3 py-2 text-fg/50">{applies}</TableCell>
                                  <TableCell className="px-2 py-2 text-right">
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
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                      </Table>
                    )}
                  </div>

                  {componentTemplatesOpen ? (
                    <div>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-[11px] font-medium uppercase tracking-wider text-fg/40">Templates</h3>
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
                              <Badge variant={template.target === "cost" ? "warning" : template.target === "price" ? "success" : "info"} className="shrink-0 text-[10px]">
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
                  ) : null}

                  {componentEditorOpen ? (
                    <div className="rounded-lg border border-line bg-bg/20 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[11px] font-medium uppercase tracking-wider text-fg/40">Rule Editor</div>
                        {componentDraft.id ? (
                          <Button size="sm" variant="ghost" onClick={() => setComponentDraft(emptyComponentDraft())}>
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
                            <SearchSelect
                              className="mt-1"
                              value={componentDraft.kind}
                              onChange={(kind) => setComponentDraft((current) => ({ ...current, kind }))}
                              options={componentKindOptions}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase text-fg/40">Side</label>
                            <SearchSelect
                              className="mt-1"
                              value={componentDraft.target}
                              onChange={(target) => setComponentDraft((current) => ({ ...current, target: target as ComponentTarget }))}
                              options={componentTargetOptions}
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-medium uppercase text-fg/40">Basis</label>
                            <SearchSelect
                              className="mt-1"
                              value={componentDraft.basis}
                              onChange={(basis) => {
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
                              step={isPercentComponentBasis(componentDraft.basis) ? "0.01" : "0.001"}
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
                            <SearchSelect
                              className="mt-1"
                              value={componentDraft.appliesToTierId ?? "__all__"}
                              onChange={(tierId) => {
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
                            <Button size="sm" variant="ghost" onClick={() => setComponentDraft(emptyComponentDraft())}>
                              Reset
                            </Button>
                            <Button size="sm" onClick={handleAddComponent} disabled={!componentDraft.label.trim()}>
                              <Plus className="h-3 w-3" />
                              {componentDraft.id ? "Save Rule" : "Add Rule"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  {/* Tiers */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Tiers</h3>
                      <div className="flex gap-1.5">
                        {detail.autoCalculate && detail.tiers.length > 0 && (
                          <Button size="sm" variant="ghost" onClick={handleAutoCalculate}><Calculator className="h-3 w-3" /> Auto-Calc</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setShowAddTier(true)}><Plus className="h-3 w-3" /> Add</Button>
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
                          <SearchSelect
                            value={newTierUom}
                            onChange={setNewTierUom}
                            options={tierUomOptions}
                            triggerClassName="mt-1"
                          />
                        </div>
                        <Button size="sm" onClick={handleAddTier} disabled={!newTierName.trim()}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setShowAddTier(false); setNewTierName(""); setNewTierUom("__none__"); }}><X className="h-3 w-3" /></Button>
                      </div>
                    )}
                    {detail.tiers.length === 0 ? (
                      <div className="py-2 space-y-2.5">
                        <p className="text-xs text-fg/40">No tiers yet. Start from a preset, or use <span className="text-fg/60">Add</span> for custom tiers.</p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => handleApplyTierPreset("labour")}>
                            <Plus className="h-3 w-3" /> Labour · Reg / OT / DT
                          </Button>
                          <Button size="sm" onClick={() => handleApplyTierPreset("duration")}>
                            <Plus className="h-3 w-3" /> Equipment · Day / Week / Month
                          </Button>
                        </div>
                        <p className="text-[10px] leading-relaxed text-fg/35">
                          Set a <span className="text-fg/55 font-medium">multiplier</span> per tier (Reg 1.0 / OT 1.5 / DT 2.0) for a <span className="text-fg/55">Tiered Rate Schedule</span> category — the worksheet shows the per-tier hours grid.
                          Set a <span className="text-fg/55 font-medium">UoM</span> per tier (Day / Week / Month) for a <span className="text-fg/55">Duration / Usage Pricing</span> category — the worksheet UoM picks the rate.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {detail.tiers.sort((a, b) => a.sortOrder - b.sortOrder).map((tier) => (
                          editingTierId === tier.id ? (
                            <div key={tier.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-accent/5 border border-accent/20">
                              <Input className="h-6 w-24 text-xs" value={editTierForm.name} onChange={(e) => setEditTierForm({ ...editTierForm, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") handleSaveTierEdit(); if (e.key === "Escape") setEditingTierId(null); }} autoFocus />
                              <Input className="h-6 w-14 text-xs text-right" type="number" step="0.1" value={editTierForm.multiplier} onChange={(e) => setEditTierForm({ ...editTierForm, multiplier: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") handleSaveTierEdit(); if (e.key === "Escape") setEditingTierId(null); }} />
                              <span className="text-[10px] text-fg/40">×</span>
                              <SearchSelect
                                value={editTierForm.uom}
                                onChange={(v) => setEditTierForm({ ...editTierForm, uom: v })}
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
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-[11px] font-medium text-fg/40 uppercase tracking-wider">Items & Rates</h3>
                      <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                        <div className="relative w-full sm:w-64">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg/35" />
                          <Input
                            value={itemSearch}
                            onChange={(event) => setItemSearch(event.target.value)}
                            placeholder="Search Ratebook items..."
                            className="h-8 pl-8 text-xs"
                          />
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAddItemError("");
                            setShowAddItem(true);
                          }}
                        >
                          <Plus className="h-3 w-3" /> Add Item
                        </Button>
                      </div>
                    </div>

                  {detail.items.length === 0 ? (
                    <p className="text-xs text-fg/30 py-4 text-center">No items yet. Add rate items to this schedule.</p>
                  ) : visibleRatebookItems.length === 0 ? (
                    <p className="py-4 text-center text-xs text-fg/30">No Ratebook items match “{itemSearch}”.</p>
                  ) : (
                    <Table
                      className="w-full min-w-max text-xs"
                      containerClassName="-mx-5 w-[calc(100%+2.5rem)] rounded-none border-x-0 shadow-none"
                    >
                        <TableHeader>
                          <TableRow noAnimate className="border-b border-line">
                            <TableHead className="h-auto w-14 py-2 pr-2 text-[10px]">Code</TableHead>
                            <TableHead className="h-auto py-2 pr-2 text-[10px]">Name</TableHead>
                            <TableHead className="h-auto w-10 py-2 pr-1 text-[10px]">Unit</TableHead>
                            {detail.tiers
                              .sort((a, b) => a.sortOrder - b.sortOrder)
                              .map((tier) => (
                                <TableHead key={tier.id} className="h-auto w-32 px-1 py-2 text-right text-[10px]" colSpan={2}>
                                  {tier.name}
                                </TableHead>
                              ))}
                              <TableHead className="h-auto w-8" />
                            </TableRow>
                            {detail.tiers.length > 0 ? (
                              <TableRow noAnimate className="border-b border-line/60">
                                <TableHead className="h-auto" />
                                <TableHead className="h-auto" />
                                <TableHead className="h-auto" />
                                {detail.tiers
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .flatMap((tier) => [
                                    <TableHead key={`${tier.id}:cost`} className="h-auto px-1 py-1 text-right text-[9px]">Cost</TableHead>,
                                    <TableHead key={`${tier.id}:sell`} className="h-auto px-1 py-1 text-right text-[9px]">Sell</TableHead>,
                                  ])}
                                <TableHead className="h-auto" />
                              </TableRow>
                            ) : null}
                          </TableHeader>
                          <TableBody>
                            {visibleRatebookItems.map((item) => (
                              <TableRow key={item.id} className="group border-b border-line/50 hover:bg-panel2/20">
                                <TableCell className="py-1.5 pr-2 font-mono text-[11px] text-fg/60">{item.code || "—"}</TableCell>
                                <TableCell className="max-w-[160px] truncate py-1.5 pr-2 text-[11px] font-medium text-fg">{item.name}</TableCell>
                                <TableCell className="py-1.5 pr-1 text-[11px] text-fg/50">{item.unit}</TableCell>
                                {detail.tiers
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                                  .flatMap((tier) => [
                                    <TableCell key={`${tier.id}:cost`} className="px-0.5 py-1">
                                      <div className="flex flex-col items-end">
                                        <span
                                          className="block w-16 rounded px-0.5 py-0.5 text-right text-[11px] text-fg/65"
                                          title="Read-only: catalog item cost with tier multiplier plus ratebook cost components."
                                        >
                                          {fmt(loadedCostForTierUnit(item, tier, ratebookComponents) ?? undefined)}
                                        </span>
                                      </div>
                                    </TableCell>,
                                    <TableCell key={`${tier.id}:sell`} className="px-0.5 py-1">
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
                                            onClick={() => startSellRateEdit(item, tier.id)}
                                            className="text-right text-[11px] text-fg/80 hover:text-accent px-0.5 py-0.5 rounded hover:bg-accent/5 transition-colors w-16"
                                          >
                                            {fmt(item.rates?.[tier.id])}
                                          </button>
                                        )}
                                      </div>
                                    </TableCell>,
                                  ])}
                                <TableCell className="py-2 text-right">
                                  <button
                                    onClick={() => handleDeleteItem(item.id)}
                                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-danger/10 text-fg/30 hover:text-danger transition-all"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                    </Table>
                    )}
                  </div>
                </>
              )}
            </div>
      </Drawer>

      <Drawer
        open={Boolean(showAddItem && detail)}
        onClose={closeAddItemDrawer}
        stacked
        size="lg"
        title="Add Ratebook Item"
        description={detail ? `Choose a catalog resource for ${detail.name}.` : "Choose a catalog resource."}
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={closeAddItemDrawer} disabled={addingItem}>
              Cancel
            </Button>
            <Button type="button" onClick={handleAddItem} disabled={!newItemForm.catalogItemId || addingItem}>
              {addingItem ? "Adding…" : "Add to Ratebook"}
            </Button>
          </>
        )}
      >
        <RecordList
          columns={resourceColumns}
          rows={visibleResources}
          getRowId={(resource) => resource.id}
          search={{
            value: resourceQuery,
            onChange: setResourceQuery,
            placeholder: "Search resources by name, code, category, or manufacturer...",
          }}
          toolbarActions={(
            <span className="text-xs text-fg/40">
              {formatCount(filteredResources.length)} resource{filteredResources.length === 1 ? "" : "s"}
            </span>
          )}
          pagination={{
            page: resourcePage + 1,
            perPage: resourcePageSize,
            total: filteredResources.length,
            onPageChange: (nextPage) => setResourcePage(nextPage - 1),
          }}
          activeRowId={newItemForm.resourceId}
          onRowClick={(resource) => {
            handleResourceSelect(resource.id);
            setAddItemError("");
          }}
          empty={{
            title: resourceQuery ? "No resources match this search." : "No catalog resources are available.",
            description: resourceQuery ? "Try a broader resource name, code, category, or manufacturer." : "Add resources to the catalog before using them in a Ratebook.",
          }}
        />

        {newItemForm.resourceId ? (
          <div className="mt-4 rounded-lg border border-line bg-bg/30 p-3">
            <div className="text-xs font-semibold text-fg">{newItemForm.name}</div>
            <div className="mt-1 text-[11px] text-fg/45">
              {[newItemForm.code, newItemForm.unit].filter(Boolean).join(" · ")}
            </div>
            {!newItemForm.catalogItemId ? (
              <p className="mt-2 text-xs text-danger">This resource has no catalog cost source and cannot be added yet.</p>
            ) : null}
          </div>
        ) : null}

        {addItemError ? <p className="mt-3 text-sm text-danger">{addItemError}</p> : null}
      </Drawer>
    </div>
  );
}

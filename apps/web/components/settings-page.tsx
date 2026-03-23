"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Layers,
  Loader2,
  Lock,
  Mail,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  Users,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  FadeIn,
  Input,
  Label,
  Select,
  Separator,
  Toggle,
} from "@/components/ui";
import {
  getSettings as apiGetSettings,
  updateSettings as apiUpdateSettings,
  createUser as apiCreateUser,
  updateUser as apiUpdateUser,
  deleteUser as apiDeleteUser,
  testEmailConnection as apiTestEmail,
  getBrand as apiGetBrand,
  updateBrand as apiUpdateBrand,
  captureBrand as apiCaptureBrand,
  getEntityCategories as apiGetCategories,
  createEntityCategory as apiCreateCategory,
  updateEntityCategory as apiUpdateCategory,
  deleteEntityCategory as apiDeleteCategory,
  getCustomers as apiGetCustomers,
  createCustomer as apiCreateCustomer,
  updateCustomer as apiUpdateCustomer,
  deleteCustomer as apiDeleteCustomer,
  getCustomer as apiGetCustomer,
  createCustomerContact as apiCreateContact,
  updateCustomerContact as apiUpdateContact,
  deleteCustomerContact as apiDeleteContact,
  getDepartments as apiGetDepartments,
  createDepartment as apiCreateDepartment,
  updateDepartment as apiUpdateDepartment,
  deleteDepartment as apiDeleteDepartment,
  type AppSettingsRecord,
  type BrandProfile,
  type EntityCategory,
  type CalculationType,
  type Customer,
  type CustomerContact,
  type CustomerWithContacts,
  type Department,
  testProviderKey as apiTestProviderKey,
  fetchProviderModels as apiFetchProviderModels,
  getConditionLibrary as apiGetConditionLibrary,
  createConditionLibraryEntry as apiCreateConditionLibraryEntry,
  deleteConditionLibraryEntry as apiDeleteConditionLibraryEntry,
  type ConditionLibraryEntry,
  type CatalogSummary,
  type RateSchedule,
  type DatasetRecord,
} from "@/lib/api";
import { ItemsManager } from "@/components/items-manager";
import { RateScheduleManager } from "@/components/rate-schedule-manager";
import { PluginsPage } from "@/components/plugins-page";

const STORAGE_KEY = "bidwright-settings";

type SettingsGroup = "organization" | "estimating" | "data" | "integrations" | "users";
type OrgSubTab = "general" | "brand" | "departments";
type EstimatingSubTab = "defaults" | "catalogs" | "rates";
type DataSubTab = "categories" | "clients" | "conditions";
type IntegrationsSubTab = "email" | "apikeys" | "plugins";

const ORG_SUBTABS: { id: OrgSubTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "brand", label: "Brand" },
  { id: "departments", label: "Departments" },
];
const ESTIMATING_SUBTABS: { id: EstimatingSubTab; label: string }[] = [
  { id: "defaults", label: "Defaults" },
  { id: "catalogs", label: "Items & Catalogs" },
  { id: "rates", label: "Rate Schedules" },
];
const DATA_SUBTABS: { id: DataSubTab; label: string }[] = [
  { id: "categories", label: "Categories" },
  { id: "clients", label: "Clients" },
  { id: "conditions", label: "Inclusions & Exclusions" },
];
const INTEGRATIONS_SUBTABS: { id: IntegrationsSubTab; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "apikeys", label: "API Keys" },
  { id: "plugins", label: "Plugins" },
];

interface GeneralSettings {
  timezone: string;
  currency: string;
  dateFormat: string;
  fiscalYearStart: number;
}

interface EmailSettings {
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  fromAddress: string;
  fromName: string;
}

interface DefaultSettings {
  defaultMarkup: number;
  defaultBreakoutStyle: string;
  defaultQuoteType: string;
}

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: "Estimator" | "Admin" | "Viewer";
  active: boolean;
}

interface IntegrationSettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey: string;
  geminiApiKey: string;
  lmstudioBaseUrl: string;
  llmProvider: string;
  llmModel: string;
  azureDiEndpoint: string;
  azureDiKey: string;
}

interface AllSettings {
  general: GeneralSettings;
  email: EmailSettings;
  defaults: DefaultSettings;
  users: UserRecord[];
  integrations: IntegrationSettings;
}

const DEFAULT_BRAND: BrandProfile = {
  companyName: "",
  tagline: "",
  industry: "",
  description: "",
  services: [],
  targetMarkets: [],
  brandVoice: "",
  colors: { primary: "", secondary: "", accent: "" },
  logoUrl: "",
  socialLinks: {},
  websiteUrl: "",
  lastCapturedAt: null,
};

const DEFAULT_SETTINGS: AllSettings = {
  general: {
    timezone: "America/New_York",
    currency: "USD",
    dateFormat: "MM/DD/YYYY",
    fiscalYearStart: 1,
  },
  email: {
    smtpHost: "",
    smtpPort: "587",
    smtpUsername: "",
    smtpPassword: "",
    fromAddress: "",
    fromName: "",
  },
  defaults: {
    defaultMarkup: 15,
    defaultBreakoutStyle: "category",
    defaultQuoteType: "Firm",
  },
  users: [
    {
      id: "default-user",
      name: "Default Estimator",
      email: "estimator@company.com",
      role: "Admin",
      active: true,
    },
  ],
  integrations: {
    openaiApiKey: "",
    anthropicApiKey: "",
    openrouterApiKey: "",
    geminiApiKey: "",
    lmstudioBaseUrl: "http://localhost:1234/v1",
    llmProvider: "anthropic",
    llmModel: "claude-sonnet-4-20250514",
    azureDiEndpoint: "",
    azureDiKey: "",
  },
};

const GROUPS: { key: SettingsGroup; label: string; icon: typeof Building2 }[] = [
  { key: "organization", label: "Organization", icon: Building2 },
  { key: "estimating", label: "Estimating", icon: SlidersHorizontal },
  { key: "data", label: "Data Management", icon: Layers },
  { key: "integrations", label: "Integrations", icon: Zap },
  { key: "users", label: "Users & Access", icon: Users },
];

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "UTC",
];

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF", "JPY"];
const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const CALCULATION_TYPES: { value: CalculationType; label: string }[] = [
  { value: "auto_labour", label: "Auto Labour" },
  { value: "auto_equipment", label: "Auto Equipment" },
  { value: "auto_stock", label: "Auto Stock" },
  { value: "auto_consumable", label: "Auto Consumable" },
  { value: "auto_subcontract", label: "Auto Subcontract" },
  { value: "direct_price", label: "Direct Price" },
  { value: "manual", label: "Manual" },
  { value: "formula", label: "Formula" },
];

const VALID_UOMS = ["EA", "LF", "SF", "SY", "CY", "TON", "LB", "GAL", "HR", "DAY", "WK", "MO", "LS", "MH", "CF", "BF", "PC", "SET", "BAG", "BOX", "ROLL"];

const PROVIDER_CONFIG: Record<string, { label: string; keyField: keyof IntegrationSettings; placeholder: string; keyLabel: string }> = {
  anthropic: { label: "Anthropic", keyField: "anthropicApiKey", placeholder: "sk-ant-***", keyLabel: "Anthropic API Key" },
  openai: { label: "OpenAI", keyField: "openaiApiKey", placeholder: "sk-***", keyLabel: "OpenAI API Key" },
  openrouter: { label: "OpenRouter", keyField: "openrouterApiKey", placeholder: "sk-or-***", keyLabel: "OpenRouter API Key" },
  gemini: { label: "Google Gemini", keyField: "geminiApiKey", placeholder: "AI***", keyLabel: "Gemini API Key" },
  lmstudio: { label: "LM Studio (Local)", keyField: "lmstudioBaseUrl", placeholder: "http://localhost:1234/v1", keyLabel: "LM Studio Base URL" },
};

// ── Searchable Model Selector ────────────────────────────────────────────────

function SearchableModelSelect({
  value,
  onChange,
  models,
  loading,
  placeholder = "Select a model...",
}: {
  value: string;
  onChange: (v: string) => void;
  models: { id: string; name: string }[];
  loading: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(
    () =>
      models.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [models, search],
  );

  const selected = models.find((m) => m.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 0); }}
        className={cn(
          "w-full flex items-center justify-between rounded-lg border border-line bg-panel px-3 py-2 text-xs text-fg transition-colors hover:border-accent focus:outline-none focus:ring-1 focus:ring-accent",
          open && "border-accent ring-1 ring-accent",
        )}
      >
        <span className={selected ? "text-fg" : "text-fg/40"}>
          {loading ? "Loading models..." : selected ? selected.name : placeholder}
        </span>
        <ChevronDown className={cn("h-3 w-3 text-fg/40 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-line bg-panel shadow-lg">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search className="h-3 w-3 text-fg/40 shrink-0" />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models..."
              className="flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg/30"
            />
          </div>
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-fg/40">
                <Loader2 className="h-3 w-3 animate-spin" /> Fetching models...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-fg/40">
                {models.length === 0 ? "Enter an API key and test connection to load models" : "No models match your search"}
              </div>
            ) : (
              filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onChange(m.id); setOpen(false); setSearch(""); }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/10",
                    m.id === value && "bg-accent/5 text-accent",
                  )}
                >
                  {m.id === value && <Check className="h-3 w-3 shrink-0 text-accent" />}
                  <div className={m.id === value ? "" : "pl-5"}>
                    <div className="font-medium">{m.name}</div>
                    {m.name !== m.id && <div className="text-[10px] text-fg/30">{m.id}</div>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const EDITABLE_FIELD_KEYS: { key: keyof EntityCategory["editableFields"]; label: string }[] = [
  { key: "quantity", label: "Quantity" },
  { key: "cost", label: "Cost" },
  { key: "markup", label: "Markup" },
  { key: "price", label: "Price" },
  { key: "laborHourReg", label: "Labor Hr (Reg)" },
  { key: "laborHourOver", label: "Labor Hr (OT)" },
  { key: "laborHourDouble", label: "Labor Hr (DT)" },
];

const NEW_CATEGORY_TEMPLATE: Omit<EntityCategory, "id"> = {
  name: "",
  entityType: "",
  shortform: "",
  defaultUom: "EA",
  validUoms: ["EA"],
  editableFields: { quantity: true, cost: true, markup: true, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
  laborHourLabels: { reg: "Regular", over: "Overtime", double: "Double Time" },
  calculationType: "manual",
  calcFormula: "",
  color: "#6366f1",
  order: 999,
  isBuiltIn: false,
  enabled: true,
};

function maskKey(value: string) {
  if (!value || value.length < 8) return value ? "****" : "";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

// ── Tag Input Helper ─────────────────────────────────────────────────────────

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");
  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-0.5 text-xs text-accent">
            {v}
            <button onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-danger">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!input.trim()}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Color Swatch ─────────────────────────────────────────────────────────────

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-8 cursor-pointer rounded border border-line"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="#000000" className="flex-1" />
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SettingsPage({
  initialCatalogs = [],
  initialSchedules = [],
  initialPlugins = [],
  initialDatasets = [],
}: {
  initialCatalogs?: CatalogSummary[];
  initialSchedules?: RateSchedule[];
  initialPlugins?: any[];
  initialDatasets?: DatasetRecord[];
} = {}) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const validGroups: SettingsGroup[] = ["organization", "estimating", "data", "integrations", "users"];
  const initialGroup = validGroups.includes(tabParam as SettingsGroup) ? (tabParam as SettingsGroup) : "organization";
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>(initialGroup);
  const [orgSubTab, setOrgSubTab] = useState<OrgSubTab>("general");
  const [estimatingSubTab, setEstimatingSubTab] = useState<EstimatingSubTab>("defaults");
  const [dataSubTab, setDataSubTab] = useState<DataSubTab>("categories");
  const [integrationsSubTab, setIntegrationsSubTab] = useState<IntegrationsSubTab>("email");
  const [settings, setSettings] = useState<AllSettings>(DEFAULT_SETTINGS);
  const [brand, setBrand] = useState<BrandProfile>(DEFAULT_BRAND);
  const settingsLoaded = useRef(false);
  const brandLoaded = useRef(false);
  const settingsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const brandTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [emailTestStatus, setEmailTestStatus] = useState<{ loading: boolean; result?: { success: boolean; message: string } }>({ loading: false });
  const [userSaving, setUserSaving] = useState<string | null>(null);
  const [brandCapturing, setBrandCapturing] = useState(false);
  const [brandCaptureUrl, setBrandCaptureUrl] = useState("");
  const [categories, setCategories] = useState<EntityCategory[]>([]);
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null);
  const [catEdits, setCatEdits] = useState<Record<string, Partial<EntityCategory>>>({});
  const [catSaving, setCatSaving] = useState<string | null>(null);
  const [catDeleting, setCatDeleting] = useState<string | null>(null);
  const [catDeleteConfirm, setCatDeleteConfirm] = useState<string | null>(null);

  // Integrations
  const [keyTestStatus, setKeyTestStatus] = useState<{ loading: boolean; result?: { success: boolean; message: string } }>({ loading: false });
  const [providerModels, setProviderModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Customers
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expandedCustId, setExpandedCustId] = useState<string | null>(null);
  const [custEdits, setCustEdits] = useState<Record<string, Partial<Customer>>>({});
  const [custSaving, setCustSaving] = useState<string | null>(null);
  const [custDeleteConfirm, setCustDeleteConfirm] = useState<string | null>(null);
  const [custContacts, setCustContacts] = useState<Record<string, CustomerContact[]>>({});
  const [contactEdits, setContactEdits] = useState<Record<string, Partial<CustomerContact>>>({});
  const [contactSaving, setContactSaving] = useState<string | null>(null);
  const [contactDeleteConfirm, setContactDeleteConfirm] = useState<string | null>(null);

  // Departments
  const [departments, setDepartments] = useState<Department[]>([]);
  const [expandedDeptId, setExpandedDeptId] = useState<string | null>(null);
  const [deptEdits, setDeptEdits] = useState<Record<string, Partial<Department>>>({});
  const [deptSaving, setDeptSaving] = useState<string | null>(null);
  const [deptDeleteConfirm, setDeptDeleteConfirm] = useState<string | null>(null);

  // Conditions library
  const [conditionLibrary, setConditionLibrary] = useState<ConditionLibraryEntry[]>([]);
  const [newInclusion, setNewInclusion] = useState("");
  const [newExclusion, setNewExclusion] = useState("");
  const [conditionSaving, setConditionSaving] = useState(false);

  // Rate schedules (for embedding)
  const [rateSchedules, setRateSchedules] = useState<RateSchedule[]>(initialSchedules);
  const [ratesLoading, setRatesLoading] = useState(false);

  useEffect(() => {
    // Load settings from API
    apiGetSettings()
      .then((apiSettings) => {
        setSettings((prev) => ({
          general: {
            ...prev.general,
            timezone: apiSettings.defaults.timezone || prev.general.timezone,
            currency: apiSettings.defaults.currency || prev.general.currency,
            dateFormat: apiSettings.defaults.dateFormat || prev.general.dateFormat,
            fiscalYearStart: apiSettings.defaults.fiscalYearStart ?? prev.general.fiscalYearStart,
          },
          email: {
            ...prev.email,
            smtpHost: apiSettings.email.host || prev.email.smtpHost,
            smtpPort: String(apiSettings.email.port) || prev.email.smtpPort,
            smtpUsername: apiSettings.email.username || prev.email.smtpUsername,
            smtpPassword: apiSettings.email.password || prev.email.smtpPassword,
            fromAddress: apiSettings.email.fromAddress || prev.email.fromAddress,
            fromName: apiSettings.email.fromName || prev.email.fromName,
          },
          defaults: {
            ...prev.defaults,
            defaultMarkup: apiSettings.defaults.defaultMarkup ?? prev.defaults.defaultMarkup,
            defaultBreakoutStyle: apiSettings.defaults.breakoutStyle || prev.defaults.defaultBreakoutStyle,
            defaultQuoteType: apiSettings.defaults.quoteType || prev.defaults.defaultQuoteType,
          },
          users: prev.users,
          integrations: {
            ...prev.integrations,
            openaiApiKey: apiSettings.integrations.openaiKey || prev.integrations.openaiApiKey,
            anthropicApiKey: apiSettings.integrations.anthropicKey || prev.integrations.anthropicApiKey,
            openrouterApiKey: apiSettings.integrations.openrouterKey || prev.integrations.openrouterApiKey,
            geminiApiKey: apiSettings.integrations.geminiKey || prev.integrations.geminiApiKey,
            lmstudioBaseUrl: (apiSettings.integrations as Record<string, string>).lmstudioBaseUrl || prev.integrations.lmstudioBaseUrl,
            llmProvider: apiSettings.integrations.llmProvider || prev.integrations.llmProvider,
            llmModel: apiSettings.integrations.llmModel || prev.integrations.llmModel,
            azureDiEndpoint: (apiSettings.integrations as any).azureDiEndpoint || prev.integrations.azureDiEndpoint,
            azureDiKey: (apiSettings.integrations as any).azureDiKey || prev.integrations.azureDiKey,
          },
        }));

        // Load brand separately
        if (apiSettings.brand) {
          setBrand((prev) => ({ ...prev, ...apiSettings.brand }));
          if (apiSettings.brand.websiteUrl) setBrandCaptureUrl(apiSettings.brand.websiteUrl);
        }
        // Mark loaded so auto-save skips the initial hydration
        setTimeout(() => { settingsLoaded.current = true; brandLoaded.current = true; }, 0);
      })
      .catch(() => {
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored) as Partial<AllSettings>;
            setSettings((prev) => ({
              general: { ...prev.general, ...parsed.general },
              email: { ...prev.email, ...parsed.email },
              defaults: { ...prev.defaults, ...parsed.defaults },
              users: parsed.users ?? prev.users,
              integrations: { ...prev.integrations, ...parsed.integrations },
            }));
          }
        } catch {
          // use defaults
        }
        setTimeout(() => { settingsLoaded.current = true; brandLoaded.current = true; }, 0);
      });
  }, []);

  // Load entity categories
  useEffect(() => {
    apiGetCategories().then(setCategories).catch(() => {});
  }, []);

  // Load customers
  useEffect(() => {
    apiGetCustomers().then(setCustomers).catch(() => {});
  }, []);

  // Load departments
  useEffect(() => {
    apiGetDepartments().then(setDepartments).catch(() => {});
  }, []);

  // Load condition library
  useEffect(() => {
    apiGetConditionLibrary().then(setConditionLibrary).catch(() => {});
  }, []);

  const addConditionLibraryEntry = async (type: string, value: string) => {
    if (!value.trim()) return;
    setConditionSaving(true);
    try {
      const entry = await apiCreateConditionLibraryEntry({ type, value: value.trim() });
      setConditionLibrary((prev) => [...prev, entry]);
      if (type === "inclusion") setNewInclusion("");
      else setNewExclusion("");
    } catch {}
    setConditionSaving(false);
  };

  const removeConditionLibraryEntry = async (entryId: string) => {
    try {
      await apiDeleteConditionLibraryEntry(entryId);
      setConditionLibrary((prev) => prev.filter((e) => e.id !== entryId));
    } catch {}
  };

  const getCatEdit = (cat: EntityCategory): EntityCategory => ({
    ...cat,
    ...(catEdits[cat.id] || {}),
    editableFields: { ...cat.editableFields, ...(catEdits[cat.id]?.editableFields || {}) },
    laborHourLabels: { ...cat.laborHourLabels, ...(catEdits[cat.id]?.laborHourLabels || {}) },
  });

  const updateCatEdit = (id: string, patch: Partial<EntityCategory>) =>
    setCatEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const saveCat = useCallback(async (cat: EntityCategory) => {
    const merged = { ...cat, ...(catEdits[cat.id] || {}), editableFields: { ...cat.editableFields, ...(catEdits[cat.id]?.editableFields || {}) }, laborHourLabels: { ...cat.laborHourLabels, ...(catEdits[cat.id]?.laborHourLabels || {}) } };
    setCatSaving(cat.id);
    try {
      if (cat.id.startsWith("new-")) {
        const { id: _id, ...rest } = merged;
        const created = await apiCreateCategory(rest);
        setCategories((prev) => prev.map((c) => (c.id === cat.id ? created : c)));
        setCatEdits((prev) => { const n = { ...prev }; delete n[cat.id]; return n; });
        setExpandedCatId(created.id);
      } else {
        const updated = await apiUpdateCategory(cat.id, merged);
        setCategories((prev) => prev.map((c) => (c.id === cat.id ? updated : c)));
        setCatEdits((prev) => { const n = { ...prev }; delete n[cat.id]; return n; });
      }
    } catch {
      // keep local edits
    } finally {
      setCatSaving(null);
    }
  }, [catEdits]);

  const deleteCat = useCallback(async (id: string) => {
    setCatDeleting(id);
    try {
      if (!id.startsWith("new-")) await apiDeleteCategory(id);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setCatEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (expandedCatId === id) setExpandedCatId(null);
    } catch {
      // keep
    } finally {
      setCatDeleting(null);
      setCatDeleteConfirm(null);
    }
  }, [expandedCatId]);

  const addCategory = () => {
    const tempId = `new-${Date.now()}`;
    const newCat: EntityCategory = { ...NEW_CATEGORY_TEMPLATE, id: tempId, order: categories.length };
    setCategories((prev) => [...prev, newCat]);
    setExpandedCatId(tempId);
  };

  const toggleCatEnabled = useCallback(async (cat: EntityCategory, enabled: boolean) => {
    setCategories((prev) => prev.map((c) => (c.id === cat.id ? { ...c, enabled } : c)));
    if (!cat.id.startsWith("new-")) {
      try { await apiUpdateCategory(cat.id, { enabled }); } catch { /* revert silently */ }
    }
  }, []);

  // ── Customer CRUD ────────────────────────────────────────────────────────

  const getCustEdit = (c: Customer): Customer => ({ ...c, ...(custEdits[c.id] || {}) });
  const updateCustEdit = (id: string, patch: Partial<Customer>) =>
    setCustEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const addCustomer = () => {
    const tempId = `new-${Date.now()}`;
    const newCust: Customer = {
      id: tempId, organizationId: "", name: "", shortName: "", phone: "", email: "",
      website: "", addressStreet: "", addressCity: "", addressProvince: "",
      addressPostalCode: "", addressCountry: "", notes: "", active: true,
      createdAt: "", updatedAt: "",
    };
    setCustomers((prev) => [...prev, newCust]);
    setExpandedCustId(tempId);
  };

  const saveCustomer = useCallback(async (cust: Customer) => {
    const merged = { ...cust, ...(custEdits[cust.id] || {}) };
    setCustSaving(cust.id);
    try {
      if (cust.id.startsWith("new-")) {
        const created = await apiCreateCustomer(merged);
        setCustomers((prev) => prev.map((c) => (c.id === cust.id ? created : c)));
        setCustEdits((prev) => { const n = { ...prev }; delete n[cust.id]; return n; });
        setExpandedCustId(created.id);
      } else {
        const updated = await apiUpdateCustomer(cust.id, merged);
        setCustomers((prev) => prev.map((c) => (c.id === cust.id ? updated : c)));
        setCustEdits((prev) => { const n = { ...prev }; delete n[cust.id]; return n; });
      }
    } catch { /* keep edits */ } finally { setCustSaving(null); }
  }, [custEdits]);

  const deleteCustomer = useCallback(async (id: string) => {
    try {
      if (!id.startsWith("new-")) await apiDeleteCustomer(id);
      setCustomers((prev) => prev.filter((c) => c.id !== id));
      setCustEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (expandedCustId === id) setExpandedCustId(null);
    } catch { /* keep */ } finally { setCustDeleteConfirm(null); }
  }, [expandedCustId]);

  const toggleCustActive = useCallback(async (cust: Customer, active: boolean) => {
    setCustomers((prev) => prev.map((c) => (c.id === cust.id ? { ...c, active } : c)));
    if (!cust.id.startsWith("new-")) {
      try { await apiUpdateCustomer(cust.id, { active }); } catch { /* revert silently */ }
    }
  }, []);

  // Load contacts when a customer is expanded
  useEffect(() => {
    if (expandedCustId && !expandedCustId.startsWith("new-") && !custContacts[expandedCustId]) {
      apiGetCustomer(expandedCustId).then((cust) => {
        setCustContacts((prev) => ({ ...prev, [expandedCustId]: cust.contacts }));
      }).catch(() => {});
    }
  }, [expandedCustId, custContacts]);

  const addContact = (customerId: string) => {
    const tempId = `new-${Date.now()}`;
    const newContact: CustomerContact = {
      id: tempId, customerId, name: "", title: "", phone: "", email: "",
      isPrimary: false, active: true, createdAt: "", updatedAt: "",
    };
    setCustContacts((prev) => ({ ...prev, [customerId]: [...(prev[customerId] || []), newContact] }));
  };

  const saveContact = useCallback(async (customerId: string, contact: CustomerContact) => {
    const merged = { ...contact, ...(contactEdits[contact.id] || {}) };
    setContactSaving(contact.id);
    try {
      if (contact.id.startsWith("new-")) {
        const created = await apiCreateContact(customerId, merged);
        setCustContacts((prev) => ({
          ...prev,
          [customerId]: (prev[customerId] || []).map((c) => (c.id === contact.id ? created : c)),
        }));
        setContactEdits((prev) => { const n = { ...prev }; delete n[contact.id]; return n; });
      } else {
        const updated = await apiUpdateContact(customerId, contact.id, merged);
        setCustContacts((prev) => ({
          ...prev,
          [customerId]: (prev[customerId] || []).map((c) => (c.id === contact.id ? updated : c)),
        }));
        setContactEdits((prev) => { const n = { ...prev }; delete n[contact.id]; return n; });
      }
    } catch { /* keep edits */ } finally { setContactSaving(null); }
  }, [contactEdits]);

  const deleteContact = useCallback(async (customerId: string, contactId: string) => {
    try {
      if (!contactId.startsWith("new-")) await apiDeleteContact(customerId, contactId);
      setCustContacts((prev) => ({
        ...prev,
        [customerId]: (prev[customerId] || []).filter((c) => c.id !== contactId),
      }));
      setContactEdits((prev) => { const n = { ...prev }; delete n[contactId]; return n; });
    } catch { /* keep */ } finally { setContactDeleteConfirm(null); }
  }, []);

  const updateContactEdit = (id: string, patch: Partial<CustomerContact>) =>
    setContactEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const getContactEdit = (c: CustomerContact): CustomerContact => ({ ...c, ...(contactEdits[c.id] || {}) });

  // ── Department CRUD ─────────────────────────────────────────────────────

  const getDeptEdit = (d: Department): Department => ({ ...d, ...(deptEdits[d.id] || {}) });
  const updateDeptEdit = (id: string, patch: Partial<Department>) =>
    setDeptEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const addDepartment = () => {
    const tempId = `new-${Date.now()}`;
    const newDept: Department = {
      id: tempId, organizationId: "", name: "", code: "", description: "",
      active: true, createdAt: "", updatedAt: "",
    };
    setDepartments((prev) => [...prev, newDept]);
    setExpandedDeptId(tempId);
  };

  const saveDepartment = useCallback(async (dept: Department) => {
    const merged = { ...dept, ...(deptEdits[dept.id] || {}) };
    setDeptSaving(dept.id);
    try {
      if (dept.id.startsWith("new-")) {
        const created = await apiCreateDepartment(merged);
        setDepartments((prev) => prev.map((d) => (d.id === dept.id ? created : d)));
        setDeptEdits((prev) => { const n = { ...prev }; delete n[dept.id]; return n; });
        setExpandedDeptId(created.id);
      } else {
        const updated = await apiUpdateDepartment(dept.id, merged);
        setDepartments((prev) => prev.map((d) => (d.id === dept.id ? updated : d)));
        setDeptEdits((prev) => { const n = { ...prev }; delete n[dept.id]; return n; });
      }
    } catch { /* keep edits */ } finally { setDeptSaving(null); }
  }, [deptEdits]);

  const deleteDepartment = useCallback(async (id: string) => {
    try {
      if (!id.startsWith("new-")) await apiDeleteDepartment(id);
      setDepartments((prev) => prev.filter((d) => d.id !== id));
      setDeptEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (expandedDeptId === id) setExpandedDeptId(null);
    } catch { /* keep */ } finally { setDeptDeleteConfirm(null); }
  }, [expandedDeptId]);

  const toggleDeptActive = useCallback(async (dept: Department, active: boolean) => {
    setDepartments((prev) => prev.map((d) => (d.id === dept.id ? { ...d, active } : d)));
    if (!dept.id.startsWith("new-")) {
      try { await apiUpdateDepartment(dept.id, { active }); } catch { /* revert silently */ }
    }
  }, []);

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    const apiPayload: Partial<AppSettingsRecord> = {
      general: {} as AppSettingsRecord["general"],
      email: {
        host: settings.email.smtpHost,
        port: parseInt(settings.email.smtpPort, 10) || 587,
        username: settings.email.smtpUsername,
        password: settings.email.smtpPassword,
        fromAddress: settings.email.fromAddress,
        fromName: settings.email.fromName,
      },
      defaults: {
        defaultMarkup: settings.defaults.defaultMarkup,
        breakoutStyle: settings.defaults.defaultBreakoutStyle,
        quoteType: settings.defaults.defaultQuoteType,
        timezone: settings.general.timezone,
        currency: settings.general.currency,
        dateFormat: settings.general.dateFormat,
        fiscalYearStart: settings.general.fiscalYearStart,
      },
      integrations: {
        openaiKey: settings.integrations.openaiApiKey,
        anthropicKey: settings.integrations.anthropicApiKey,
        openrouterKey: settings.integrations.openrouterApiKey,
        geminiKey: settings.integrations.geminiApiKey,
        lmstudioBaseUrl: settings.integrations.lmstudioBaseUrl,
        llmProvider: settings.integrations.llmProvider,
        llmModel: settings.integrations.llmModel,
        azureDiEndpoint: settings.integrations.azureDiEndpoint,
        azureDiKey: settings.integrations.azureDiKey,
      },
    };

    apiUpdateSettings(apiPayload).catch(() => {});
  }, [settings]);

  const saveBrand = useCallback(async () => {
    try { await apiUpdateBrand(brand); } catch {}
  }, [brand]);

  // Auto-save settings on change (debounced)
  useEffect(() => {
    if (!settingsLoaded.current) return;
    clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(save, 800);
    return () => clearTimeout(settingsTimer.current);
  }, [save]);

  // Auto-save brand on change (debounced)
  useEffect(() => {
    if (!brandLoaded.current) return;
    clearTimeout(brandTimer.current);
    brandTimer.current = setTimeout(saveBrand, 800);
    return () => clearTimeout(brandTimer.current);
  }, [saveBrand]);

  const handleCaptureBrand = useCallback(async () => {
    if (!brandCaptureUrl.trim()) return;
    setBrandCapturing(true);
    try {
      const captured = await apiCaptureBrand(brandCaptureUrl.trim());
      setBrand(captured);
    } catch (err) {
      // Show error inline
      console.error("Brand capture failed:", err);
    } finally {
      setBrandCapturing(false);
    }
  }, [brandCaptureUrl]);

  const updateGeneral = (patch: Partial<GeneralSettings>) =>
    setSettings((s) => ({ ...s, general: { ...s.general, ...patch } }));
  const updateEmail = (patch: Partial<EmailSettings>) =>
    setSettings((s) => ({ ...s, email: { ...s.email, ...patch } }));
  const updateDefaults = (patch: Partial<DefaultSettings>) =>
    setSettings((s) => ({ ...s, defaults: { ...s.defaults, ...patch } }));
  const updateIntegrations = (patch: Partial<IntegrationSettings>) =>
    setSettings((s) => ({ ...s, integrations: { ...s.integrations, ...patch } }));
  const updateUserLocal = (id: string, patch: Partial<UserRecord>) =>
    setSettings((s) => ({ ...s, users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  const updateBrandLocal = (patch: Partial<BrandProfile>) =>
    setBrand((b) => ({ ...b, ...patch }));

  const getProviderKey = useCallback((provider: string) => {
    const cfg = PROVIDER_CONFIG[provider];
    if (!cfg) return "";
    return (settings.integrations[cfg.keyField] as string) || "";
  }, [settings.integrations]);

  const handleTestKey = useCallback(async () => {
    const provider = settings.integrations.llmProvider;
    const key = getProviderKey(provider);
    setKeyTestStatus({ loading: true });
    try {
      const res = await apiTestProviderKey(provider, key, provider === "lmstudio" ? settings.integrations.lmstudioBaseUrl : undefined);
      setKeyTestStatus({ loading: false, result: res });
    } catch (err: any) {
      setKeyTestStatus({ loading: false, result: { success: false, message: err.message || "Test failed" } });
    }
  }, [settings.integrations, getProviderKey]);

  const handleFetchModels = useCallback(async (provider?: string, apiKey?: string) => {
    const p = provider || settings.integrations.llmProvider;
    const k = apiKey || getProviderKey(p);
    if (!k && p !== "lmstudio") return;
    setModelsLoading(true);
    try {
      const res = await apiFetchProviderModels(p, k, p === "lmstudio" ? settings.integrations.lmstudioBaseUrl : undefined);
      setProviderModels(res.models || []);
    } catch {
      setProviderModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [settings.integrations, getProviderKey]);

  // Auto-fetch models when provider changes or on initial load for integrations tab
  useEffect(() => {
    if (activeGroup !== "integrations") return;
    const provider = settings.integrations.llmProvider;
    const key = getProviderKey(provider);
    if (key || provider === "lmstudio") {
      handleFetchModels(provider, key);
    } else {
      setProviderModels([]);
    }
  }, [activeGroup, settings.integrations.llmProvider]);

  const saveUser = useCallback(async (user: UserRecord) => {
    setUserSaving(user.id);
    try {
      await apiUpdateUser(user.id, {
        name: user.name,
        email: user.email,
        role: user.role.toLowerCase() as "admin" | "estimator" | "viewer",
        active: user.active,
      });
    } catch {
      // Still saved locally
    } finally {
      setUserSaving(null);
    }
  }, []);
  const addUser = async () => {
    const tempId = `user-${Date.now()}`;
    const newUser: UserRecord = { id: tempId, name: "", email: "", role: "Estimator", active: true };
    setSettings((s) => ({ ...s, users: [...s.users, newUser] }));
    try {
      const created = await apiCreateUser({ name: "", email: `new-${Date.now()}@placeholder.com`, role: "estimator" });
      setSettings((s) => ({ ...s, users: s.users.map((u) => (u.id === tempId ? { ...u, id: created.id } : u)) }));
    } catch {
      // User added locally
    }
  };
  const removeUser = useCallback(async (id: string) => {
    try { await apiDeleteUser(id); } catch { /* Remove locally anyway */ }
    setSettings((s) => ({ ...s, users: s.users.filter((u) => u.id !== id) }));
  }, []);
  const handleTestEmail = useCallback(async () => {
    setEmailTestStatus({ loading: true });
    try {
      const result = await apiTestEmail();
      setEmailTestStatus({ loading: false, result });
    } catch (err) {
      setEmailTestStatus({ loading: false, result: { success: false, message: err instanceof Error ? err.message : "Connection test failed" } });
    }
    setTimeout(() => setEmailTestStatus({ loading: false }), 5000);
  }, []);

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">Settings</h1>
            <p className="text-xs text-fg/50">Configure your Bidwright workspace</p>
          </div>
        </div>
      </FadeIn>

      {/* Horizontal tab bar */}
      <FadeIn delay={0.05}>
        <div className="flex items-center gap-1 border-b border-line pb-px">
          {GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <button
                key={group.key}
                onClick={() => setActiveGroup(group.key)}
                className={cn(
                  "flex items-center gap-2 rounded-t-lg px-4 py-2 text-xs transition-colors -mb-px border-b-2",
                  activeGroup === group.key
                    ? "border-accent text-accent font-medium"
                    : "border-transparent text-fg/50 hover:text-fg/80 hover:border-line"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {group.label}
              </button>
            );
          })}
        </div>
      </FadeIn>

      {/* Tab content */}
      <FadeIn delay={0.1} className="space-y-5">
          {activeGroup === "organization" && (
            <div className="flex items-center gap-1 shrink-0">
              {ORG_SUBTABS.map((t) => {
                const active = orgSubTab === t.id;
                return (
                  <button key={t.id} onClick={() => setOrgSubTab(t.id)} className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap", active ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}>{t.label}</button>
                );
              })}
            </div>
          )}
          {activeGroup === "organization" && orgSubTab === "general" && (
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Timezone</Label>
                    <Select value={settings.general.timezone} onChange={(e) => updateGeneral({ timezone: e.target.value })}>
                      {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label>Currency</Label>
                    <Select value={settings.general.currency} onChange={(e) => updateGeneral({ currency: e.target.value })}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Date Format</Label>
                    <Select value={settings.general.dateFormat} onChange={(e) => updateGeneral({ dateFormat: e.target.value })}>
                      {DATE_FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label>Fiscal Year Start</Label>
                    <Select
                      value={String(settings.general.fiscalYearStart)}
                      onChange={(e) => updateGeneral({ fiscalYearStart: parseInt(e.target.value, 10) })}
                    >
                      {MONTHS.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
                    </Select>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {activeGroup === "organization" && orgSubTab === "brand" && (
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>Brand Capture</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  <p className="text-xs text-fg/50">
                    Enter your website URL and we&apos;ll automatically extract your brand identity using AI-powered analysis.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={brandCaptureUrl}
                      onChange={(e) => setBrandCaptureUrl(e.target.value)}
                      placeholder="https://yourcompany.com"
                      className="flex-1"
                    />
                    <Button
                      variant="accent"
                      size="sm"
                      onClick={handleCaptureBrand}
                      disabled={brandCapturing || !brandCaptureUrl.trim()}
                    >
                      {brandCapturing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Capturing...
                        </>
                      ) : (
                        <>
                          <Globe className="h-3.5 w-3.5" />
                          Capture Brand
                        </>
                      )}
                    </Button>
                  </div>
                  {brand.lastCapturedAt && (
                    <p className="text-[11px] text-fg/40">
                      Last captured: {new Date(brand.lastCapturedAt).toLocaleString()}
                    </p>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Brand Profile</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Company Name</Label>
                      <Input value={brand.companyName} onChange={(e) => updateBrandLocal({ companyName: e.target.value })} placeholder="Your Company" />
                    </div>
                    <div>
                      <Label>Industry</Label>
                      <Input value={brand.industry} onChange={(e) => updateBrandLocal({ industry: e.target.value })} placeholder="Construction, Technology, etc." />
                    </div>
                  </div>
                  <div>
                    <Label>Tagline</Label>
                    <Input value={brand.tagline} onChange={(e) => updateBrandLocal({ tagline: e.target.value })} placeholder="Your company tagline" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <textarea
                      value={brand.description}
                      onChange={(e) => updateBrandLocal({ description: e.target.value })}
                      placeholder="A brief description of your company..."
                      className="w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50 resize-none"
                      rows={3}
                    />
                  </div>
                  <div>
                    <Label>Brand Voice</Label>
                    <Input value={brand.brandVoice} onChange={(e) => updateBrandLocal({ brandVoice: e.target.value })} placeholder="Professional, approachable, technical..." />
                  </div>
                  <Separator />
                  <div>
                    <Label>Services</Label>
                    <TagInput values={brand.services} onChange={(v) => updateBrandLocal({ services: v })} placeholder="Add a service..." />
                  </div>
                  <div>
                    <Label>Target Markets</Label>
                    <TagInput values={brand.targetMarkets} onChange={(v) => updateBrandLocal({ targetMarkets: v })} placeholder="Add a market..." />
                  </div>
                  <Separator />
                  <p className="text-xs font-medium text-fg/60 uppercase tracking-wider">Brand Colors</p>
                  <div className="grid grid-cols-3 gap-4">
                    <ColorField label="Primary" value={brand.colors.primary} onChange={(v) => updateBrandLocal({ colors: { ...brand.colors, primary: v } })} />
                    <ColorField label="Secondary" value={brand.colors.secondary} onChange={(v) => updateBrandLocal({ colors: { ...brand.colors, secondary: v } })} />
                    <ColorField label="Accent" value={brand.colors.accent} onChange={(v) => updateBrandLocal({ colors: { ...brand.colors, accent: v } })} />
                  </div>
                  <Separator />
                  <div>
                    <Label>Logo URL</Label>
                    <Input value={brand.logoUrl} onChange={(e) => updateBrandLocal({ logoUrl: e.target.value })} placeholder="https://yourcompany.com/logo.png" />
                    {brand.logoUrl && (
                      <div className="mt-2 flex items-center gap-3">
                        <img src={brand.logoUrl} alt="Logo preview" className="h-10 rounded border border-line object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      </div>
                    )}
                  </div>
                  <Separator />
                  <p className="text-xs font-medium text-fg/60 uppercase tracking-wider">Social Links</p>
                  <div className="grid grid-cols-2 gap-4">
                    {["linkedin", "twitter", "facebook", "instagram", "youtube"].map((platform) => (
                      <div key={platform}>
                        <Label className="capitalize">{platform}</Label>
                        <Input
                          value={brand.socialLinks[platform] || ""}
                          onChange={(e) => updateBrandLocal({ socialLinks: { ...brand.socialLinks, [platform]: e.target.value } })}
                          placeholder={`https://${platform}.com/...`}
                        />
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {activeGroup === "integrations" && (
            <div className="flex items-center gap-1 shrink-0">
              {INTEGRATIONS_SUBTABS.map((t) => {
                const active = integrationsSubTab === t.id;
                return (
                  <button key={t.id} onClick={() => setIntegrationsSubTab(t.id)} className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap", active ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}>{t.label}</button>
                );
              })}
            </div>
          )}
          {activeGroup === "integrations" && integrationsSubTab === "email" && (
            <Card>
              <CardHeader>
                <CardTitle>Email (SMTP) Settings</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>SMTP Host</Label>
                    <Input value={settings.email.smtpHost} onChange={(e) => updateEmail({ smtpHost: e.target.value })} placeholder="smtp.gmail.com" />
                  </div>
                  <div>
                    <Label>Port</Label>
                    <Input value={settings.email.smtpPort} onChange={(e) => updateEmail({ smtpPort: e.target.value })} placeholder="587" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Username</Label>
                    <Input value={settings.email.smtpUsername} onChange={(e) => updateEmail({ smtpUsername: e.target.value })} placeholder="user@gmail.com" />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input type="password" value={settings.email.smtpPassword} onChange={(e) => updateEmail({ smtpPassword: e.target.value })} placeholder="********" />
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>From Address</Label>
                    <Input value={settings.email.fromAddress} onChange={(e) => updateEmail({ fromAddress: e.target.value })} placeholder="quotes@yourcompany.com" />
                  </div>
                  <div>
                    <Label>From Name</Label>
                    <Input value={settings.email.fromName} onChange={(e) => updateEmail({ fromName: e.target.value })} placeholder="Your Company Quotes" />
                  </div>
                </div>
                <Separator />
                <div className="flex items-center gap-3">
                  <Button variant="secondary" size="sm" onClick={handleTestEmail} disabled={emailTestStatus.loading}>
                    {emailTestStatus.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                    Test Connection
                  </Button>
                  {emailTestStatus.result && (
                    <span className={cn("text-xs", emailTestStatus.result.success ? "text-success" : "text-danger")}>
                      {emailTestStatus.result.message}
                    </span>
                  )}
                </div>
              </CardBody>
            </Card>
          )}

          {activeGroup === "estimating" && (
            <div className="flex items-center gap-1 shrink-0">
              {ESTIMATING_SUBTABS.map((t) => {
                const active = estimatingSubTab === t.id;
                return (
                  <button key={t.id} onClick={() => setEstimatingSubTab(t.id)} className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap", active ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}>{t.label}</button>
                );
              })}
            </div>
          )}
          {activeGroup === "estimating" && estimatingSubTab === "defaults" && (
            <Card>
              <CardHeader>
                <CardTitle>Default Values</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div>
                  <Label>Default Markup (%)</Label>
                  <Input
                    type="number"
                    value={settings.defaults.defaultMarkup}
                    onChange={(e) => updateDefaults({ defaultMarkup: parseFloat(e.target.value) || 0 })}
                    placeholder="15"
                  />
                </div>
                <div>
                  <Label>Default Breakout Style</Label>
                  <Select value={settings.defaults.defaultBreakoutStyle} onChange={(e) => updateDefaults({ defaultBreakoutStyle: e.target.value })}>
                    <option value="category">By Category</option>
                    <option value="phase">By Phase</option>
                    <option value="worksheet">By Worksheet</option>
                    <option value="flat">Flat (No Breakout)</option>
                  </Select>
                </div>
                <div>
                  <Label>Default Quote Type</Label>
                  <Select value={settings.defaults.defaultQuoteType} onChange={(e) => updateDefaults({ defaultQuoteType: e.target.value })}>
                    <option value="Firm">Firm</option>
                    <option value="Budget">Budget</option>
                    <option value="BudgetDNE">Budget DNE</option>
                  </Select>
                </div>
                <div>
                  <Label>Max Agent Iterations</Label>
                  <Input
                    type="number"
                    value={(settings.defaults as any).maxAgentIterations ?? 200}
                    onChange={(e) => updateDefaults({ maxAgentIterations: parseInt(e.target.value) || 200 } as any)}
                    placeholder="200"
                    min={10}
                    max={1000}
                  />
                  <p className="mt-1 text-[11px] text-fg/40">Maximum tool call iterations for AI estimating runs</p>
                </div>
              </CardBody>
            </Card>
          )}

          {activeGroup === "users" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Users</CardTitle>
                <Button variant="accent" size="xs" onClick={addUser}>
                  <Users className="h-3 w-3" />
                  Add User
                </Button>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Name</th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40">Email</th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 w-36">Role</th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 w-20">Active</th>
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.users.map((user) => (
                      <tr key={user.id} className="border-b border-line last:border-0">
                        <td className="px-5 py-2.5">
                          <Input className="h-7 text-xs" value={user.name} onChange={(e) => updateUserLocal(user.id, { name: e.target.value })} onBlur={() => saveUser(user)} placeholder="Full name" />
                        </td>
                        <td className="px-5 py-2.5">
                          <Input className="h-7 text-xs" value={user.email} onChange={(e) => updateUserLocal(user.id, { email: e.target.value })} onBlur={() => saveUser(user)} placeholder="email@company.com" />
                        </td>
                        <td className="px-5 py-2.5">
                          <Select className="h-7 text-xs" value={user.role} onChange={(e) => { const role = e.target.value as UserRecord["role"]; updateUserLocal(user.id, { role }); saveUser({ ...user, role }); }}>
                            <option value="Estimator">Estimator</option>
                            <option value="Admin">Admin</option>
                            <option value="Viewer">Viewer</option>
                          </Select>
                        </td>
                        <td className="px-5 py-2.5">
                          <Toggle checked={user.active} onChange={(val) => { updateUserLocal(user.id, { active: val }); saveUser({ ...user, active: val }); }} />
                        </td>
                        <td className="px-5 py-2.5">
                          <button onClick={() => removeUser(user.id)} className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors" title="Delete user">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {activeGroup === "integrations" && integrationsSubTab === "apikeys" && (() => {
            const provider = settings.integrations.llmProvider;
            const cfg = PROVIDER_CONFIG[provider];
            const currentKey = cfg ? (settings.integrations[cfg.keyField] as string) : "";
            const isLmStudio = provider === "lmstudio";
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Integrations &amp; API Keys</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  <div>
                    <Label>LLM Provider</Label>
                    <Select
                      value={provider}
                      onChange={(e) => {
                        const next = e.target.value;
                        updateIntegrations({ llmProvider: next, llmModel: "" });
                        setKeyTestStatus({ loading: false });
                        setProviderModels([]);
                      }}
                    >
                      {Object.entries(PROVIDER_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </Select>
                  </div>

                  <Separator />

                  {/* Provider-specific credentials */}
                  <div>
                    <Label>{cfg?.keyLabel || "API Key"}</Label>
                    <Input
                      type={isLmStudio ? "text" : "password"}
                      value={currentKey}
                      onChange={(e) => cfg && updateIntegrations({ [cfg.keyField]: e.target.value })}
                      placeholder={cfg?.placeholder || ""}
                    />
                    {currentKey && !isLmStudio && (
                      <p className="mt-1 text-[11px] text-fg/40">Current: {maskKey(currentKey)}</p>
                    )}
                    {isLmStudio && (
                      <p className="mt-1 text-[11px] text-fg/40">URL for your local LM Studio server</p>
                    )}
                  </div>

                  {/* Test Connection Button */}
                  <div className="flex items-center gap-3">
                    <Button
                      variant="default"
                      size="xs"
                      onClick={handleTestKey}
                      disabled={keyTestStatus.loading || (!currentKey && !isLmStudio)}
                    >
                      {keyTestStatus.loading ? (
                        <><Loader2 className="h-3 w-3 animate-spin" /> Testing...</>
                      ) : (
                        <><Zap className="h-3 w-3" /> Test Connection</>
                      )}
                    </Button>
                    {keyTestStatus.result && (
                      <span className={cn("text-xs", keyTestStatus.result.success ? "text-green-500" : "text-red-500")}>
                        {keyTestStatus.result.success ? <Check className="inline h-3 w-3 mr-1" /> : <X className="inline h-3 w-3 mr-1" />}
                        {keyTestStatus.result.message}
                      </span>
                    )}
                  </div>

                  <Separator />

                  {/* Model Selection */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <Label className="mb-0">Model</Label>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => handleFetchModels()}
                        disabled={modelsLoading || (!currentKey && !isLmStudio)}
                        className="text-[10px] h-5 px-1.5"
                      >
                        {modelsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                      </Button>
                    </div>
                    <SearchableModelSelect
                      value={settings.integrations.llmModel}
                      onChange={(v) => updateIntegrations({ llmModel: v })}
                      models={providerModels}
                      loading={modelsLoading}
                      placeholder={!currentKey && !isLmStudio ? "Enter API key first..." : "Select a model..."}
                    />
                  </div>

                  <Separator />

                  {/* Azure Document Intelligence */}
                  <div>
                    <p className="text-xs font-medium text-fg/60 mb-2">Azure Document Intelligence</p>
                    <p className="text-[10px] text-fg/40 mb-3">Used for OCR extraction from scanned PDFs, structured table extraction, and form key-value pair detection.</p>
                    <div className="space-y-3">
                      <div>
                        <Label>Endpoint</Label>
                        <Input
                          type="text"
                          value={settings.integrations.azureDiEndpoint}
                          onChange={(e) => updateIntegrations({ azureDiEndpoint: e.target.value })}
                          placeholder="https://your-resource.cognitiveservices.azure.com/"
                        />
                      </div>
                      <div>
                        <Label>API Key</Label>
                        <Input
                          type="password"
                          value={settings.integrations.azureDiKey}
                          onChange={(e) => updateIntegrations({ azureDiKey: e.target.value })}
                          placeholder="Enter Azure DI key..."
                        />
                        {settings.integrations.azureDiKey && (
                          <p className="mt-1 text-[11px] text-fg/40">Current: {maskKey(settings.integrations.azureDiKey)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })()}

          {activeGroup === "data" && (
            <div className="flex items-center gap-1 shrink-0">
              {DATA_SUBTABS.map((t) => {
                const active = dataSubTab === t.id;
                return (
                  <button key={t.id} onClick={() => setDataSubTab(t.id)} className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap", active ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}>{t.label}</button>
                );
              })}
            </div>
          )}
          {activeGroup === "data" && dataSubTab === "categories" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Entity Categories</CardTitle>
                <Button variant="accent" size="xs" onClick={addCategory}>
                  <Plus className="h-3 w-3" />
                  Add Category
                </Button>
              </CardHeader>
              <div className="divide-y divide-line">
                {categories.length === 0 && (
                  <div className="px-5 py-8 text-center text-xs text-fg/40">
                    No categories configured. Click &quot;Add Category&quot; to get started.
                  </div>
                )}
                {categories.map((cat) => {
                  const edited = getCatEdit(cat);
                  const isExpanded = expandedCatId === cat.id;
                  return (
                    <div key={cat.id}>
                      {/* Summary row */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedCatId(isExpanded ? null : cat.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCatId(isExpanded ? null : cat.id); } }}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-panel2 transition-colors cursor-pointer"
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-fg/40 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-fg/40 shrink-0" />}
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color || "#888" }}
                        />
                        <span className="font-medium text-fg truncate">{cat.name || "Untitled"}</span>
                        <Badge className="text-[10px] shrink-0">{cat.shortform || "—"}</Badge>
                        <Badge className="text-[10px] shrink-0">{cat.calculationType.replace(/_/g, " ")}</Badge>
                        {cat.isBuiltIn && <Lock className="h-3 w-3 text-fg/30 shrink-0" />}
                        <span className="flex-1" />
                        <span onClick={(e) => e.stopPropagation()}>
                          <Toggle checked={cat.enabled} onChange={(val) => toggleCatEnabled(cat, val)} />
                        </span>
                      </div>

                      {/* Expanded editor */}
                      {isExpanded && (
                        <div className="border-t border-line bg-panel2/50 px-5 py-4 space-y-4" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) saveCat(cat); }}>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <Label>Name</Label>
                              <Input
                                value={edited.name}
                                onChange={(e) => updateCatEdit(cat.id, { name: e.target.value })}
                                placeholder="Category name"
                              />
                            </div>
                            <div>
                              <Label>Shortform</Label>
                              <Input
                                value={edited.shortform}
                                onChange={(e) => updateCatEdit(cat.id, { shortform: e.target.value.slice(0, 2) })}
                                placeholder="LB"
                                maxLength={2}
                              />
                            </div>
                            <div>
                              <Label>Entity Type</Label>
                              <Input
                                value={edited.entityType}
                                onChange={(e) => updateCatEdit(cat.id, { entityType: e.target.value })}
                                placeholder="labour, equipment, etc."
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Default UOM</Label>
                              <Select
                                value={edited.defaultUom}
                                onChange={(e) => updateCatEdit(cat.id, { defaultUom: e.target.value })}
                              >
                                {VALID_UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
                              </Select>
                            </div>
                            <div>
                              <Label>Valid UOMs</Label>
                              <Input
                                value={(edited.validUoms || []).join(", ")}
                                onChange={(e) => updateCatEdit(cat.id, { validUoms: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                                placeholder="EA, LF, SF"
                              />
                              <p className="mt-1 text-[11px] text-fg/40">Comma-separated list</p>
                            </div>
                          </div>

                          <Separator />
                          <p className="text-xs font-medium text-fg/60 uppercase tracking-wider">Editable Fields</p>
                          <div className="flex flex-wrap gap-4">
                            {EDITABLE_FIELD_KEYS.map((f) => (
                              <label key={f.key} className="flex items-center gap-2 text-xs text-fg/80 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={edited.editableFields[f.key]}
                                  onChange={(e) =>
                                    updateCatEdit(cat.id, {
                                      editableFields: { ...edited.editableFields, [f.key]: e.target.checked },
                                    })
                                  }
                                  className="rounded border-line accent-accent"
                                />
                                {f.label}
                              </label>
                            ))}
                          </div>

                          <Separator />
                          <p className="text-xs font-medium text-fg/60 uppercase tracking-wider">Labor Hour Labels</p>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <Label>Regular</Label>
                              <Input
                                value={edited.laborHourLabels.reg}
                                onChange={(e) => updateCatEdit(cat.id, { laborHourLabels: { ...edited.laborHourLabels, reg: e.target.value } })}
                                placeholder="Regular"
                              />
                            </div>
                            <div>
                              <Label>Overtime</Label>
                              <Input
                                value={edited.laborHourLabels.over}
                                onChange={(e) => updateCatEdit(cat.id, { laborHourLabels: { ...edited.laborHourLabels, over: e.target.value } })}
                                placeholder="Overtime"
                              />
                            </div>
                            <div>
                              <Label>Double Time</Label>
                              <Input
                                value={edited.laborHourLabels.double}
                                onChange={(e) => updateCatEdit(cat.id, { laborHourLabels: { ...edited.laborHourLabels, double: e.target.value } })}
                                placeholder="Double Time"
                              />
                            </div>
                          </div>

                          <Separator />
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Calculation Type</Label>
                              <Select
                                value={edited.calculationType}
                                onChange={(e) => updateCatEdit(cat.id, { calculationType: e.target.value as CalculationType })}
                              >
                                {CALCULATION_TYPES.map((ct) => (
                                  <option key={ct.value} value={ct.value}>{ct.label}</option>
                                ))}
                              </Select>
                            </div>
                            <div>
                              <Label>Color</Label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  value={edited.color || "#000000"}
                                  onChange={(e) => updateCatEdit(cat.id, { color: e.target.value })}
                                  className="h-8 w-8 cursor-pointer rounded border border-line"
                                />
                                <Input
                                  value={edited.color}
                                  onChange={(e) => updateCatEdit(cat.id, { color: e.target.value })}
                                  placeholder="#000000"
                                  className="flex-1"
                                />
                              </div>
                            </div>
                          </div>

                          {edited.calculationType === "formula" && (
                            <div>
                              <Label>Custom Formula</Label>
                              <Input
                                value={edited.calcFormula}
                                onChange={(e) => updateCatEdit(cat.id, { calcFormula: e.target.value })}
                                placeholder="qty * cost * (1 + markup)"
                              />
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-2 pt-2">
                            {!cat.isBuiltIn && (
                              <>
                                {catDeleteConfirm === cat.id ? (
                                  <div className="flex items-center gap-2 ml-2">
                                    <span className="text-xs text-danger">Delete this category?</span>
                                    <Button
                                      variant="danger"
                                      size="xs"
                                      onClick={() => deleteCat(cat.id)}
                                      disabled={catDeleting === cat.id}
                                    >
                                      {catDeleting === cat.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                                    </Button>
                                    <Button variant="secondary" size="xs" onClick={() => setCatDeleteConfirm(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setCatDeleteConfirm(cat.id)}
                                    className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors ml-2"
                                    title="Delete category"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Clients Tab ────────────────────────────────────────── */}
          {activeGroup === "data" && dataSubTab === "clients" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Clients</CardTitle>
                <Button variant="accent" size="xs" onClick={addCustomer}>
                  <Plus className="h-3 w-3" />
                  Add Client
                </Button>
              </CardHeader>
              <div className="divide-y divide-line">
                {customers.length === 0 && (
                  <div className="px-5 py-8 text-center text-xs text-fg/40">
                    No clients yet. Click &quot;Add Client&quot; to get started.
                  </div>
                )}
                {customers.map((cust) => {
                  const edited = getCustEdit(cust);
                  const isExpanded = expandedCustId === cust.id;
                  const contacts = custContacts[cust.id] || [];
                  return (
                    <div key={cust.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedCustId(isExpanded ? null : cust.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCustId(isExpanded ? null : cust.id); } }}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-panel2 transition-colors cursor-pointer"
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-fg/40 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-fg/40 shrink-0" />}
                        <span className="font-medium text-fg truncate">{cust.name || "Untitled"}</span>
                        {cust.email && <span className="text-xs text-fg/40 truncate">{cust.email}</span>}
                        {cust.phone && <span className="text-xs text-fg/40 truncate">{cust.phone}</span>}
                        <span className="flex-1" />
                        <span onClick={(e) => e.stopPropagation()}>
                          <Toggle checked={cust.active} onChange={(val) => toggleCustActive(cust, val)} />
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-line bg-panel2/50 px-5 py-4 space-y-4" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) saveCustomer(cust); }}>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Name</Label>
                              <Input value={edited.name} onChange={(e) => updateCustEdit(cust.id, { name: e.target.value })} placeholder="Client name" />
                            </div>
                            <div>
                              <Label>Short Name</Label>
                              <Input value={edited.shortName} onChange={(e) => updateCustEdit(cust.id, { shortName: e.target.value })} placeholder="Abbreviation" />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Phone</Label>
                              <Input value={edited.phone} onChange={(e) => updateCustEdit(cust.id, { phone: e.target.value })} placeholder="Phone number" />
                            </div>
                            <div>
                              <Label>Email</Label>
                              <Input value={edited.email} onChange={(e) => updateCustEdit(cust.id, { email: e.target.value })} placeholder="Email address" />
                            </div>
                          </div>
                          <div>
                            <Label>Website</Label>
                            <Input value={edited.website} onChange={(e) => updateCustEdit(cust.id, { website: e.target.value })} placeholder="https://" />
                          </div>
                          <Separator />
                          <p className="text-xs font-medium text-fg/60 uppercase tracking-wider">Address</p>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <Label>Street</Label>
                              <Input value={edited.addressStreet} onChange={(e) => updateCustEdit(cust.id, { addressStreet: e.target.value })} />
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <Label>City</Label>
                              <Input value={edited.addressCity} onChange={(e) => updateCustEdit(cust.id, { addressCity: e.target.value })} />
                            </div>
                            <div>
                              <Label>Province / State</Label>
                              <Input value={edited.addressProvince} onChange={(e) => updateCustEdit(cust.id, { addressProvince: e.target.value })} />
                            </div>
                            <div>
                              <Label>Postal / Zip</Label>
                              <Input value={edited.addressPostalCode} onChange={(e) => updateCustEdit(cust.id, { addressPostalCode: e.target.value })} />
                            </div>
                          </div>
                          <div>
                            <Label>Country</Label>
                            <Input value={edited.addressCountry} onChange={(e) => updateCustEdit(cust.id, { addressCountry: e.target.value })} />
                          </div>
                          <div>
                            <Label>Notes</Label>
                            <Input value={edited.notes} onChange={(e) => updateCustEdit(cust.id, { notes: e.target.value })} placeholder="Internal notes" />
                          </div>

                          {/* Contacts sub-section */}
                          <Separator />
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider">Contacts</p>
                            {!cust.id.startsWith("new-") && (
                              <Button variant="secondary" size="xs" onClick={() => addContact(cust.id)}>
                                <Plus className="h-3 w-3" />
                                Add Contact
                              </Button>
                            )}
                          </div>
                          {cust.id.startsWith("new-") && (
                            <p className="text-xs text-fg/40">Fill in client details and click away to save, then add contacts.</p>
                          )}
                          {contacts.length > 0 && (
                            <div className="space-y-2">
                              {contacts.map((contact) => {
                                const ce = getContactEdit(contact);
                                return (
                                  <div key={contact.id} className="rounded-lg border border-line bg-panel p-3 space-y-3" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) saveContact(cust.id, contact); }}>
                                    <div className="grid grid-cols-2 gap-3">
                                      <div>
                                        <Label>Name</Label>
                                        <Input value={ce.name} onChange={(e) => updateContactEdit(contact.id, { name: e.target.value })} placeholder="Contact name" />
                                      </div>
                                      <div>
                                        <Label>Title</Label>
                                        <Input value={ce.title} onChange={(e) => updateContactEdit(contact.id, { title: e.target.value })} placeholder="Job title" />
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                      <div>
                                        <Label>Phone</Label>
                                        <Input value={ce.phone} onChange={(e) => updateContactEdit(contact.id, { phone: e.target.value })} placeholder="Phone" />
                                      </div>
                                      <div>
                                        <Label>Email</Label>
                                        <Input value={ce.email} onChange={(e) => updateContactEdit(contact.id, { email: e.target.value })} placeholder="Email" />
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                      <label className="flex items-center gap-2 text-xs text-fg/80 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={ce.isPrimary}
                                          onChange={(e) => updateContactEdit(contact.id, { isPrimary: e.target.checked })}
                                          className="rounded border-line accent-accent"
                                        />
                                        Primary Contact
                                      </label>
                                      <span className="flex-1" />
                                      {contactDeleteConfirm === contact.id ? (
                                        <div className="flex items-center gap-2">
                                          <Button variant="danger" size="xs" onClick={() => deleteContact(cust.id, contact.id)}>Confirm</Button>
                                          <Button variant="secondary" size="xs" onClick={() => setContactDeleteConfirm(null)}>Cancel</Button>
                                        </div>
                                      ) : (
                                        <button
                                          onClick={() => setContactDeleteConfirm(contact.id)}
                                          className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-2 pt-2">
                            {custDeleteConfirm === cust.id ? (
                              <div className="flex items-center gap-2 ml-2">
                                <span className="text-xs text-danger">Delete this client?</span>
                                <Button variant="danger" size="xs" onClick={() => deleteCustomer(cust.id)}>Confirm</Button>
                                <Button variant="secondary" size="xs" onClick={() => setCustDeleteConfirm(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setCustDeleteConfirm(cust.id)}
                                className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors ml-2"
                                title="Delete client"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Departments Tab ──────────────────────────────────────── */}
          {activeGroup === "organization" && orgSubTab === "departments" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Departments</CardTitle>
                <Button variant="accent" size="xs" onClick={addDepartment}>
                  <Plus className="h-3 w-3" />
                  Add Department
                </Button>
              </CardHeader>
              <div className="divide-y divide-line">
                {departments.length === 0 && (
                  <div className="px-5 py-8 text-center text-xs text-fg/40">
                    No departments yet. Click &quot;Add Department&quot; to get started.
                  </div>
                )}
                {departments.map((dept) => {
                  const edited = getDeptEdit(dept);
                  const isExpanded = expandedDeptId === dept.id;
                  return (
                    <div key={dept.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedDeptId(isExpanded ? null : dept.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedDeptId(isExpanded ? null : dept.id); } }}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-panel2 transition-colors cursor-pointer"
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-fg/40 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-fg/40 shrink-0" />}
                        <span className="font-medium text-fg truncate">{dept.name || "Untitled"}</span>
                        {dept.code && <Badge className="text-[10px] shrink-0">{dept.code}</Badge>}
                        {dept.description && <span className="text-xs text-fg/40 truncate">{dept.description}</span>}
                        <span className="flex-1" />
                        <span onClick={(e) => e.stopPropagation()}>
                          <Toggle checked={dept.active} onChange={(val) => toggleDeptActive(dept, val)} />
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-line bg-panel2/50 px-5 py-4 space-y-4" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) saveDepartment(dept); }}>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Name</Label>
                              <Input value={edited.name} onChange={(e) => updateDeptEdit(dept.id, { name: e.target.value })} placeholder="Department name" />
                            </div>
                            <div>
                              <Label>Code</Label>
                              <Input value={edited.code} onChange={(e) => updateDeptEdit(dept.id, { code: e.target.value })} placeholder="MECH, ELEC, etc." />
                            </div>
                          </div>
                          <div>
                            <Label>Description</Label>
                            <Input value={edited.description} onChange={(e) => updateDeptEdit(dept.id, { description: e.target.value })} placeholder="Department description" />
                          </div>

                          <div className="flex items-center gap-2 pt-2">
                            {deptDeleteConfirm === dept.id ? (
                              <div className="flex items-center gap-2 ml-2">
                                <span className="text-xs text-danger">Delete this department?</span>
                                <Button variant="danger" size="xs" onClick={() => deleteDepartment(dept.id)}>Confirm</Button>
                                <Button variant="secondary" size="xs" onClick={() => setDeptDeleteConfirm(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeptDeleteConfirm(dept.id)}
                                className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors ml-2"
                                title="Delete department"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Items & Catalogs ─── (kept mounted to preserve state across tab switches) */}
          <div className={activeGroup === "estimating" && estimatingSubTab === "catalogs" ? "" : "hidden"}>
            <ItemsManager catalogs={initialCatalogs} />
          </div>

          {/* ── Rate Schedules ─── (kept mounted to preserve state across tab switches) */}
          <div className={activeGroup === "estimating" && estimatingSubTab === "rates" ? "" : "hidden"}>
            <RateScheduleManager schedules={rateSchedules} setSchedules={setRateSchedules} loading={ratesLoading} catalogs={initialCatalogs} />
          </div>

          {/* ── Inclusions / Exclusions ─── */}
          {activeGroup === "data" && dataSubTab === "conditions" && (
            <Card>
              <CardHeader>
                <CardTitle>Inclusions &amp; Exclusions Library</CardTitle>
              </CardHeader>
              <div className="px-5 pb-5">
                <p className="text-xs text-fg/50 mb-4">Manage your organization&apos;s standard inclusion and exclusion clauses. These are available to quickly add when setting up project quotes.</p>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Inclusions */}
                  <div>
                    <h3 className="text-sm font-medium text-fg mb-3">Inclusions</h3>
                    <div className="space-y-1.5 mb-3">
                      {conditionLibrary.filter((e) => e.type === "inclusion" || e.type === "Inclusion").length === 0 && (
                        <p className="text-xs text-fg/40 italic py-2">No inclusions yet</p>
                      )}
                      {conditionLibrary
                        .filter((e) => e.type === "inclusion" || e.type === "Inclusion")
                        .map((entry) => (
                          <div key={entry.id} className="group flex items-center gap-2 rounded-lg border border-line bg-panel2/50 px-3 py-2">
                            <span className="flex-1 text-xs text-fg">{entry.value}</span>
                            <button
                              onClick={() => removeConditionLibraryEntry(entry.id)}
                              className="rounded p-1 text-fg/20 opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger transition-all"
                              title="Remove"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={newInclusion}
                        onChange={(e) => setNewInclusion(e.target.value)}
                        placeholder="Add inclusion clause..."
                        className="flex-1"
                        onKeyDown={(e) => e.key === "Enter" && addConditionLibraryEntry("inclusion", newInclusion)}
                      />
                      <Button variant="secondary" size="sm" onClick={() => addConditionLibraryEntry("inclusion", newInclusion)} disabled={conditionSaving || !newInclusion.trim()}>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Exclusions */}
                  <div>
                    <h3 className="text-sm font-medium text-fg mb-3">Exclusions</h3>
                    <div className="space-y-1.5 mb-3">
                      {conditionLibrary.filter((e) => e.type === "exclusion" || e.type === "Exclusion").length === 0 && (
                        <p className="text-xs text-fg/40 italic py-2">No exclusions yet</p>
                      )}
                      {conditionLibrary
                        .filter((e) => e.type === "exclusion" || e.type === "Exclusion")
                        .map((entry) => (
                          <div key={entry.id} className="group flex items-center gap-2 rounded-lg border border-line bg-panel2/50 px-3 py-2">
                            <span className="flex-1 text-xs text-fg">{entry.value}</span>
                            <button
                              onClick={() => removeConditionLibraryEntry(entry.id)}
                              className="rounded p-1 text-fg/20 opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger transition-all"
                              title="Remove"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={newExclusion}
                        onChange={(e) => setNewExclusion(e.target.value)}
                        placeholder="Add exclusion clause..."
                        className="flex-1"
                        onKeyDown={(e) => e.key === "Enter" && addConditionLibraryEntry("exclusion", newExclusion)}
                      />
                      <Button variant="secondary" size="sm" onClick={() => addConditionLibraryEntry("exclusion", newExclusion)} disabled={conditionSaving || !newExclusion.trim()}>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* ── Plugins ─── */}
          {activeGroup === "integrations" && integrationsSubTab === "plugins" && (
            <PluginsPage initialPlugins={initialPlugins} initialDatasets={initialDatasets} />
          )}

        </FadeIn>
    </div>
  );
}

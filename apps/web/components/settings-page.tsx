"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  Building2,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Mail,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  Download,
  Users,
  X,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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
  MultiSelect,
  type MultiSelectOption,
} from "@/components/ui";
import {
  AgentRuntimeSettings,
  ColorField,
  SearchableModelSelect,
  TagInput,
} from "@/components/settings-page-helpers";
import {
  CALCULATION_TYPES,
  CURRENCIES,
  DATA_SUBTABS,
  DATE_FORMATS,
  DEFAULT_BRAND,
  DEFAULT_SETTINGS,
  EDITABLE_FIELD_KEYS,
  GROUPS,
  INTEGRATIONS_SUBTABS,
  ITEM_SOURCE_OPTIONS,
  MONTHS,
  NEW_CATEGORY_TEMPLATE,
  ORG_SUBTABS,
  PROVIDER_CONFIG,
  STORAGE_KEY,
  TIMEZONES,
  VALID_UOMS,
  maskKey,
  type AllSettings,
  type DataSubTab,
  type DefaultSettings,
  type EmailSettings,
  type GeneralSettings,
  type IntegrationSettings,
  type IntegrationsSubTab,
  type OrgSubTab,
  type SettingsGroup,
  type UserRecord,
} from "@/components/settings-page-config";
import {
  getSettings as apiGetSettings,
  updateSettings as apiUpdateSettings,
  createUser as apiCreateUser,
  updateUser as apiUpdateUser,
  deleteUser as apiDeleteUser,
  listUsers as apiListUsers,
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
  type EstimatorPersona,
  listPersonas as apiListPersonas,
  createPersona as apiCreatePersona,
  updatePersona as apiUpdatePersona,
  deletePersona as apiDeletePersona,
  listKnowledgeBooks as apiListKnowledgeBooks,
  type KnowledgeBookRecord,
  type AuthUser,
} from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { ItemsManager } from "@/components/items-manager";
import { RateScheduleManager } from "@/components/rate-schedule-manager";
import { PluginsPage } from "@/components/plugins-page";
import { LabourCostManager } from "@/components/labour-cost-manager";
import { BurdenManager } from "@/components/burden-manager";
import { TravelPolicyManager } from "@/components/travel-policy-manager";
import { listRateSchedules } from "@/lib/api";
import {
  exportAllDataManagement,
  parseExportFile,
  importAllDataManagement,
  defaultImportOptions,
  IMPORT_SECTION_ORDER,
  IMPORT_SECTION_LABELS,
  type ImportSummary,
  type ImportProgress,
  type ImportResult,
  type ImportOptions,
  type ImportSectionKey,
} from "@/lib/data-export-import";

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
  const validGroups: SettingsGroup[] = ["organization", "data", "integrations", "users"];
  const initialGroup = validGroups.includes(tabParam as SettingsGroup) ? (tabParam as SettingsGroup) : "organization";
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>(initialGroup);
  const [orgSubTab, setOrgSubTab] = useState<OrgSubTab>("general");
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
  const [brandCaptureError, setBrandCaptureError] = useState<string | null>(null);
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

  // Personas
  const [personas, setPersonas] = useState<EstimatorPersona[]>([]);
  const [expandedPersonaId, setExpandedPersonaId] = useState<string | null>(null);
  const [personaEdits, setPersonaEdits] = useState<Record<string, Partial<EstimatorPersona>>>({});
  const [personaDeleteConfirm, setPersonaDeleteConfirm] = useState<string | null>(null);
  const [knowledgeBooks, setKnowledgeBooks] = useState<KnowledgeBookRecord[]>([]);

  // Conditions library
  const [conditionLibrary, setConditionLibrary] = useState<ConditionLibraryEntry[]>([]);
  const [newInclusion, setNewInclusion] = useState("");
  const [newExclusion, setNewExclusion] = useState("");
  const [newClarification, setNewClarification] = useState("");
  const [conditionSaving, setConditionSaving] = useState(false);

  // Data Management import/export
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importConfirm, setImportConfirm] = useState<{ data: any; summary: ImportSummary; fileName: string } | null>(null);
  const [importOptions, setImportOptions] = useState<ImportOptions | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Password reset
  const [passwordResetUserId, setPasswordResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordResetSaving, setPasswordResetSaving] = useState(false);

  const { user: currentUser } = useAuth();

  // Rate schedules (for embedding)
  const [rateSchedules, setRateSchedules] = useState<RateSchedule[]>(initialSchedules);
  const [ratesLoading, setRatesLoading] = useState(false);

  // Data export handler
  const handleExportAll = useCallback(async () => {
    setExporting(true);
    try {
      await exportAllDataManagement();
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }, []);

  // Data import handler
  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be selected again
    try {
      const { data, summary } = await parseExportFile(file);
      setImportConfirm({ data, summary, fileName: file.name });
      setImportOptions(defaultImportOptions(summary));
    } catch (err: any) {
      alert(err.message || "Failed to parse import file");
    }
  }, []);

  const handleImportConfirm = useCallback(async () => {
    if (!importConfirm || !importOptions) return;
    const opts = importOptions;
    setImporting(true);
    setImportProgress(null);
    setImportResult(null);
    setImportError(null);
    try {
      const result = await importAllDataManagement(importConfirm.data, (p) => setImportProgress({ ...p }), opts);
      setImportResult(result);
    } catch (err: any) {
      setImportError(err.message || "Unknown error");
    } finally {
      setImporting(false);
    }
  }, [importConfirm, importOptions]);

  const handleImportDismiss = useCallback(() => {
    const hadResult = !!importResult;
    setImportConfirm(null);
    setImportOptions(null);
    setImportProgress(null);
    setImportResult(null);
    setImportError(null);
    if (hadResult) window.location.reload();
  }, [importResult]);

  // Fetch rate schedules if initial prop is empty (e.g., auth timing issue)
  useEffect(() => {
    if (initialSchedules.length === 0) {
      setRatesLoading(true);
      listRateSchedules()
        .then((data) => { if (Array.isArray(data)) setRateSchedules(data); })
        .catch(() => {})
        .finally(() => setRatesLoading(false));
    } else {
      setRateSchedules(initialSchedules);
    }
  }, [initialSchedules]);

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
            authMethod: apiSettings.email.authMethod || prev.email.authMethod,
            oauth2TenantId: apiSettings.email.oauth2TenantId || prev.email.oauth2TenantId,
            oauth2ClientId: apiSettings.email.oauth2ClientId || prev.email.oauth2ClientId,
            oauth2ClientSecret: apiSettings.email.oauth2ClientSecret || prev.email.oauth2ClientSecret,
          },
          defaults: {
            ...prev.defaults,
            defaultMarkup: apiSettings.defaults.defaultMarkup ?? prev.defaults.defaultMarkup,
            defaultBreakoutStyle: apiSettings.defaults.breakoutStyle || prev.defaults.defaultBreakoutStyle,
            defaultQuoteType: apiSettings.defaults.quoteType || prev.defaults.defaultQuoteType,
            benchmarkingEnabled: apiSettings.defaults.benchmarkingEnabled ?? prev.defaults.benchmarkingEnabled,
            benchmarkMinimumSimilarity: apiSettings.defaults.benchmarkMinimumSimilarity ?? prev.defaults.benchmarkMinimumSimilarity,
            benchmarkMaximumComparables: apiSettings.defaults.benchmarkMaximumComparables ?? prev.defaults.benchmarkMaximumComparables,
            benchmarkLowerHoursRatio: apiSettings.defaults.benchmarkLowerHoursRatio ?? prev.defaults.benchmarkLowerHoursRatio,
            benchmarkUpperHoursRatio: apiSettings.defaults.benchmarkUpperHoursRatio ?? prev.defaults.benchmarkUpperHoursRatio,
            requireHumanReviewForBenchmarkOutliers: apiSettings.defaults.requireHumanReviewForBenchmarkOutliers ?? prev.defaults.requireHumanReviewForBenchmarkOutliers,
          },
          users: prev.users,
          integrations: {
            ...prev.integrations,
            openaiApiKey: apiSettings.integrations.openaiKey || prev.integrations.openaiApiKey,
            anthropicApiKey: apiSettings.integrations.anthropicKey || prev.integrations.anthropicApiKey,
            openrouterApiKey: apiSettings.integrations.openrouterKey || prev.integrations.openrouterApiKey,
            geminiApiKey: apiSettings.integrations.geminiKey || prev.integrations.geminiApiKey,
            lmstudioBaseUrl: (apiSettings.integrations as any).lmstudioBaseUrl || prev.integrations.lmstudioBaseUrl,
            llmProvider: apiSettings.integrations.llmProvider || prev.integrations.llmProvider,
            llmModel: apiSettings.integrations.llmModel || prev.integrations.llmModel,
            azureDiEndpoint: (apiSettings.integrations as any).azureDiEndpoint || prev.integrations.azureDiEndpoint,
            azureDiKey: (apiSettings.integrations as any).azureDiKey || prev.integrations.azureDiKey,
            agentRuntime: (apiSettings.integrations as any).agentRuntime || prev.integrations.agentRuntime,
            agentModel: (apiSettings.integrations as any).agentModel || prev.integrations.agentModel,
            maxConcurrentSubAgents: (apiSettings.integrations as any).maxConcurrentSubAgents ?? prev.integrations.maxConcurrentSubAgents,
          },
          termsAndConditions: (apiSettings as any).termsAndConditions ?? prev.termsAndConditions,
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
              termsAndConditions: parsed.termsAndConditions ?? prev.termsAndConditions,
            }));
          }
        } catch {
          // use defaults
        }
        setTimeout(() => { settingsLoaded.current = true; brandLoaded.current = true; }, 0);
      });
  }, []);

  // Load users from API
  useEffect(() => {
    apiListUsers()
      .then((apiUsers) => {
        const mapped: UserRecord[] = apiUsers.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: (u.role.charAt(0).toUpperCase() + u.role.slice(1)) as UserRecord["role"],
          active: u.active,
        }));
        if (mapped.length > 0) {
          setSettings((s) => ({ ...s, users: mapped }));
        }
      })
      .catch(() => {});
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

  // Load personas + knowledge books
  useEffect(() => {
    if (activeGroup === "organization" && orgSubTab === "personas") {
      apiListPersonas().then(setPersonas).catch(() => {});
      apiListKnowledgeBooks().then(setKnowledgeBooks).catch(() => {});
    }
  }, [activeGroup, orgSubTab]);

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
      else if (type === "exclusion") setNewExclusion("");
      else if (type === "clarification") setNewClarification("");
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
    unitLabels: { ...cat.unitLabels, ...(catEdits[cat.id]?.unitLabels || {}) },
  });

  const updateCatEdit = (id: string, patch: Partial<EntityCategory>) =>
    setCatEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const saveCat = useCallback(async (cat: EntityCategory) => {
    const merged = { ...cat, ...(catEdits[cat.id] || {}), editableFields: { ...cat.editableFields, ...(catEdits[cat.id]?.editableFields || {}) }, unitLabels: { ...cat.unitLabels, ...(catEdits[cat.id]?.unitLabels || {}) } };
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

  // ── Persona CRUD ───────────────────────────────────────────────────────

  const TRADE_OPTIONS = ["mechanical", "electrical", "structural", "civil", "general", "controls", "insulation"] as const;

  const TRADE_COLORS: Record<string, string> = {
    mechanical: "bg-blue-500/15 text-blue-400",
    electrical: "bg-yellow-500/15 text-yellow-400",
    structural: "bg-red-500/15 text-red-400",
    civil: "bg-green-500/15 text-green-400",
    general: "bg-gray-500/15 text-gray-400",
    controls: "bg-purple-500/15 text-purple-400",
    insulation: "bg-orange-500/15 text-orange-400",
  };

  const getPersonaEdit = (p: EstimatorPersona): EstimatorPersona => ({ ...p, ...(personaEdits[p.id] || {}) });
  const updatePersonaEdit = (id: string, patch: Partial<EstimatorPersona>) =>
    setPersonaEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const addPersona = () => {
    const tempId = `new-${Date.now()}`;
    const newPersona: EstimatorPersona = {
      id: tempId, organizationId: "", name: "", trade: "general", description: "",
      systemPrompt: "", knowledgeBookIds: [], datasetTags: [], packageBuckets: [],
      defaultAssumptions: {}, productivityGuidance: {}, commercialGuidance: {}, reviewFocusAreas: [], isDefault: false,
      enabled: true, order: personas.length, createdAt: "", updatedAt: "",
    };
    setPersonas((prev) => [...prev, newPersona]);
    setExpandedPersonaId(tempId);
  };

  const parsePersonaJsonField = (value: unknown) => {
    if (typeof value === "string") {
      try { return value.trim() ? JSON.parse(value) : {}; } catch { return {}; }
    }
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  };

  const patchPersonaNestedJsonField = (
    personaId: string,
    field: "defaultAssumptions" | "productivityGuidance" | "commercialGuidance",
    currentValue: unknown,
    section: string,
    patch: Record<string, unknown>,
  ) => {
    const currentRoot = parsePersonaJsonField(currentValue);
    const currentSection = parsePersonaJsonField(currentRoot[section]);
    updatePersonaEdit(personaId, {
      [field]: {
        ...currentRoot,
        [section]: {
          ...currentSection,
          ...patch,
        },
      },
    } as Partial<EstimatorPersona>);
  };

  const normalizePersonaForSave = (persona: Partial<EstimatorPersona>): Partial<EstimatorPersona> => {
    return {
      ...persona,
      packageBuckets: Array.isArray(persona.packageBuckets) ? persona.packageBuckets : [],
      reviewFocusAreas: Array.isArray(persona.reviewFocusAreas) ? persona.reviewFocusAreas : [],
      defaultAssumptions: parsePersonaJsonField(persona.defaultAssumptions),
      productivityGuidance: parsePersonaJsonField(persona.productivityGuidance),
      commercialGuidance: parsePersonaJsonField(persona.commercialGuidance),
    };
  };

  const savePersona = useCallback(async (persona: EstimatorPersona) => {
    const merged = normalizePersonaForSave({ ...persona, ...(personaEdits[persona.id] || {}) });
    try {
      if (persona.id.startsWith("new-")) {
        const created = await apiCreatePersona(merged);
        setPersonas((prev) => prev.map((p) => (p.id === persona.id ? created : p)));
        setPersonaEdits((prev) => { const n = { ...prev }; delete n[persona.id]; return n; });
        setExpandedPersonaId(created.id);
      } else {
        const updated = await apiUpdatePersona(persona.id, merged);
        setPersonas((prev) => prev.map((p) => (p.id === persona.id ? updated : p)));
        setPersonaEdits((prev) => { const n = { ...prev }; delete n[persona.id]; return n; });
      }
    } catch { /* keep edits */ }
  }, [personaEdits]);

  const deletePersonaById = useCallback(async (id: string) => {
    try {
      if (!id.startsWith("new-")) await apiDeletePersona(id);
      setPersonas((prev) => prev.filter((p) => p.id !== id));
      setPersonaEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (expandedPersonaId === id) setExpandedPersonaId(null);
    } catch { /* keep */ } finally { setPersonaDeleteConfirm(null); }
  }, [expandedPersonaId]);

  const togglePersonaEnabled = useCallback(async (persona: EstimatorPersona, enabled: boolean) => {
    setPersonas((prev) => prev.map((p) => (p.id === persona.id ? { ...p, enabled } : p)));
    if (!persona.id.startsWith("new-")) {
      try { await apiUpdatePersona(persona.id, { enabled }); } catch { /* revert silently */ }
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
        authMethod: settings.email.authMethod,
        oauth2TenantId: settings.email.oauth2TenantId,
        oauth2ClientId: settings.email.oauth2ClientId,
        oauth2ClientSecret: settings.email.oauth2ClientSecret,
      },
      defaults: {
        defaultMarkup: settings.defaults.defaultMarkup,
        breakoutStyle: settings.defaults.defaultBreakoutStyle,
        quoteType: settings.defaults.defaultQuoteType,
        timezone: settings.general.timezone,
        currency: settings.general.currency,
        dateFormat: settings.general.dateFormat,
        fiscalYearStart: settings.general.fiscalYearStart,
        benchmarkingEnabled: settings.defaults.benchmarkingEnabled,
        benchmarkMinimumSimilarity: settings.defaults.benchmarkMinimumSimilarity,
        benchmarkMaximumComparables: settings.defaults.benchmarkMaximumComparables,
        benchmarkLowerHoursRatio: settings.defaults.benchmarkLowerHoursRatio,
        benchmarkUpperHoursRatio: settings.defaults.benchmarkUpperHoursRatio,
        requireHumanReviewForBenchmarkOutliers: settings.defaults.requireHumanReviewForBenchmarkOutliers,
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
        agentRuntime: (settings.integrations as any).agentRuntime ?? null,
        agentModel: (settings.integrations as any).agentModel ?? null,
        maxConcurrentSubAgents: (settings.integrations as any).maxConcurrentSubAgents ?? null,
      },
      termsAndConditions: settings.termsAndConditions,
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
    setBrandCaptureError(null);
    try {
      const captured = await apiCaptureBrand(brandCaptureUrl.trim());
      setBrand(captured);
    } catch (err: any) {
      const msg = err?.message || "Brand capture failed";
      setBrandCaptureError(msg);
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

  const handlePasswordReset = useCallback(async () => {
    if (!passwordResetUserId || !newPassword) return;
    setPasswordResetSaving(true);
    try {
      await apiUpdateUser(passwordResetUserId, { password: newPassword });
      setPasswordResetUserId(null);
      setNewPassword("");
    } catch {
      // still close
    } finally {
      setPasswordResetSaving(false);
    }
  }, [passwordResetUserId, newPassword]);
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
                  {brandCaptureError && (
                    <p className="text-[11px] text-red-500">{brandCaptureError}</p>
                  )}
                  {brand.lastCapturedAt && !brandCaptureError && (
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
                <CardTitle>Email Settings</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                {/* Auth method toggle */}
                <div>
                  <Label>Authentication Method</Label>
                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateEmail({ authMethod: "smtp" })}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        settings.email.authMethod !== "oauth2"
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line bg-bg/50 text-fg/50 hover:text-fg/70"
                      )}
                    >
                      SMTP
                    </button>
                    <button
                      type="button"
                      onClick={() => updateEmail({ authMethod: "oauth2" })}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        settings.email.authMethod === "oauth2"
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line bg-bg/50 text-fg/50 hover:text-fg/70"
                      )}
                    >
                      Office 365 (OAuth2)
                    </button>
                  </div>
                </div>

                <Separator />

                {/* SMTP fields */}
                {settings.email.authMethod !== "oauth2" && (
                  <>
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
                  </>
                )}

                {/* OAuth2 fields */}
                {settings.email.authMethod === "oauth2" && (
                  <>
                    <div className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
                      <p className="text-xs text-fg/70 leading-relaxed">
                        <strong className="text-fg/90">Azure AD Setup:</strong> Register an app in Azure Portal &rarr; App registrations. Under API permissions, add <code className="rounded bg-bg/60 px-1 py-0.5 text-[10px]">Mail.Send</code> (Application type) and grant admin consent. Under Certificates &amp; secrets, create a client secret. Enter the values below.
                      </p>
                    </div>
                    <div>
                      <Label>Tenant ID</Label>
                      <Input value={settings.email.oauth2TenantId} onChange={(e) => updateEmail({ oauth2TenantId: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                      <p className="mt-1 text-[11px] text-fg/40">Found in Azure Portal &rarr; Azure Active Directory &rarr; Overview</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Client ID</Label>
                        <Input value={settings.email.oauth2ClientId} onChange={(e) => updateEmail({ oauth2ClientId: e.target.value })} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                      </div>
                      <div>
                        <Label>Client Secret</Label>
                        <Input type="password" value={settings.email.oauth2ClientSecret} onChange={(e) => updateEmail({ oauth2ClientSecret: e.target.value })} placeholder="********" />
                      </div>
                    </div>
                  </>
                )}

                <Separator />

                {/* Common fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>From Address</Label>
                    <Input value={settings.email.fromAddress} onChange={(e) => updateEmail({ fromAddress: e.target.value })} placeholder="quotes@yourcompany.com" />
                    {settings.email.authMethod === "oauth2" && (
                      <p className="mt-1 text-[11px] text-fg/40">Must be a licensed mailbox in your O365 tenant</p>
                    )}
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

          {activeGroup === "organization" && orgSubTab === "defaults" && (
            <Card>
              <CardHeader>
                <CardTitle>Default Values</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label className="mb-1 block">Historical Benchmarking</Label>
                      <p className="text-xs text-fg/40">
                        Controls whether AI estimates can use organization quote history as a benchmark input.
                      </p>
                    </div>
                    <Toggle
                      checked={settings.defaults.benchmarkingEnabled}
                      onChange={(val) => updateDefaults({ benchmarkingEnabled: val })}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div>
                      <Label>Minimum Similarity</Label>
                      <Input
                        type="number"
                        step="0.05"
                        value={settings.defaults.benchmarkMinimumSimilarity}
                        onChange={(e) => updateDefaults({ benchmarkMinimumSimilarity: parseFloat(e.target.value) || 0 })}
                        placeholder="0.55"
                      />
                      <p className="mt-1 text-[11px] text-fg/35">Comparables below this similarity score are discarded.</p>
                    </div>
                    <div>
                      <Label>Maximum Comparables</Label>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        value={settings.defaults.benchmarkMaximumComparables}
                        onChange={(e) => updateDefaults({ benchmarkMaximumComparables: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                        placeholder="5"
                      />
                      <p className="mt-1 text-[11px] text-fg/35">Caps how many historical jobs are included in benchmark medians.</p>
                    </div>
                    <div>
                      <Label>Lower Review Ratio</Label>
                      <Input
                        type="number"
                        step="0.05"
                        value={settings.defaults.benchmarkLowerHoursRatio}
                        onChange={(e) => updateDefaults({ benchmarkLowerHoursRatio: parseFloat(e.target.value) || 0 })}
                        placeholder="0.75"
                      />
                      <p className="mt-1 text-[11px] text-fg/35">Require review if hours or calibrated totals fall below this share of the median.</p>
                    </div>
                    <div>
                      <Label>Upper Review Ratio</Label>
                      <Input
                        type="number"
                        step="0.05"
                        value={settings.defaults.benchmarkUpperHoursRatio}
                        onChange={(e) => updateDefaults({ benchmarkUpperHoursRatio: parseFloat(e.target.value) || 0 })}
                        placeholder="1.25"
                      />
                      <p className="mt-1 text-[11px] text-fg/35">Require review if hours or calibrated totals rise above this share of the median.</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-line bg-panel2/40 px-4 py-3">
                    <div>
                      <Label className="mb-1 block">Require Human Review For Outliers</Label>
                      <p className="text-xs text-fg/40">
                        When enabled, benchmark and calibration envelope outliers stop at review instead of auto-completing.
                      </p>
                    </div>
                    <Toggle
                      checked={settings.defaults.requireHumanReviewForBenchmarkOutliers}
                      onChange={(val) => updateDefaults({ requireHumanReviewForBenchmarkOutliers: val })}
                    />
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {activeGroup === "users" && (
            <>
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
                      <th className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-fg/40 w-28">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.users.map((user) => {
                      const isCurrentUser = user.id === currentUser?.id || (!!currentUser?.email && user.email === currentUser.email);
                      return (
                      <tr key={user.id} className={cn("border-b border-line last:border-0", isCurrentUser && "bg-accent/5")}>
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <Input className="h-7 text-xs" value={user.name} onChange={(e) => updateUserLocal(user.id, { name: e.target.value })} onBlur={() => saveUser(user)} placeholder="Full name" />
                            {isCurrentUser && <Badge tone="info" className="text-[9px] shrink-0">You</Badge>}
                          </div>
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
                          <div className="flex items-center gap-1">
                            <button onClick={() => { setPasswordResetUserId(user.id); setNewPassword(""); }} className="rounded p-1 text-fg/30 hover:bg-accent/10 hover:text-accent transition-colors" title="Reset password">
                              <KeyRound className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => removeUser(user.id)} className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors" title="Delete user">
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
            </Card>

            {/* Password Reset Modal */}
            {passwordResetUserId && createPortal(
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPasswordResetUserId(null)}>
                <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold text-fg mb-1">Reset Password</h3>
                  <p className="text-xs text-fg/50 mb-4">
                    Set a new password for {settings.users.find((u) => u.id === passwordResetUserId)?.name || "this user"}.
                  </p>
                  <Input
                    type="password"
                    className="h-8 text-xs mb-4"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="xs" onClick={() => setPasswordResetUserId(null)}>Cancel</Button>
                    <Button variant="accent" size="xs" onClick={handlePasswordReset} disabled={!newPassword || passwordResetSaving}>
                      {passwordResetSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
                      {passwordResetSaving ? "Saving..." : "Reset Password"}
                    </Button>
                  </div>
                </div>
              </div>,
              document.body,
            )}
            </>

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
              <div className="flex-1" />
              <Button variant="ghost" size="xs" onClick={handleExportAll} disabled={exporting || importing}>
                {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                {exporting ? "Exporting..." : "Export All"}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => importFileRef.current?.click()} disabled={importing || exporting}>
                {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {importing ? (importProgress ? `Importing (${importProgress.sectionsComplete}/${importProgress.totalSections})...` : "Importing...") : "Import"}
              </Button>
              <input ref={importFileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            </div>
          )}
          {activeGroup === "data" && dataSubTab === "categories" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Categories</CardTitle>
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
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedCatId(expandedCatId === cat.id ? null : cat.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCatId(expandedCatId === cat.id ? null : cat.id); } }}
                    className={cn("flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-panel2 transition-colors cursor-pointer", expandedCatId === cat.id && "bg-accent/5")}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color || "#888" }}
                    />
                    <span className="font-medium text-fg truncate">{cat.name || "Untitled"}</span>
                    <Badge className="text-[10px] shrink-0">{cat.shortform || "—"}</Badge>
                    <Badge tone="default" className="text-[10px] shrink-0">{(cat.itemSource || "freeform").replace(/_/g, " ")}</Badge>
                    <span className="flex-1" />
                    <span onClick={(e) => e.stopPropagation()}>
                      <Toggle checked={cat.enabled} onChange={(val) => toggleCatEnabled(cat, val)} />
                    </span>
                  </div>
                ))}

                {/* Category Drawer (portalled to body to escape FadeIn transform) */}
                {typeof document !== "undefined" && createPortal(
                <AnimatePresence>
                  {expandedCatId && (() => {
                    const cat = categories.find((c) => c.id === expandedCatId);
                    if (!cat) return null;
                    const edited = getCatEdit(cat);
                    return (
                      <motion.div
                        key="category-drawer"
                        initial={{ x: 420 }}
                        animate={{ x: 0 }}
                        exit={{ x: 420 }}
                        transition={{ type: "spring", damping: 30, stiffness: 300 }}
                        className="fixed inset-y-0 right-0 z-40 w-[420px] bg-panel border-l border-line shadow-2xl flex flex-col"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-line bg-panel2/40">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: edited.color || "#888" }} />
                            <span className="text-sm font-semibold truncate">{edited.name || "New Category"}</span>
                                  </div>
                          <div className="flex items-center gap-1">
                            {!cat.isBuiltIn && (
                              <button
                                className="p-1.5 rounded hover:bg-danger/10 text-fg/40 hover:text-danger transition-colors"
                                onClick={() => {
                                  if (catDeleteConfirm === cat.id) { deleteCat(cat.id); }
                                  else { setCatDeleteConfirm(cat.id); }
                                }}
                                title={catDeleteConfirm === cat.id ? "Confirm delete" : "Delete category"}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors"
                              onClick={() => { saveCat(cat); setExpandedCatId(null); }}
                              title="Close"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-5">
                          {/* Basic Info */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Basic Info</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Name</Label>
                                <Input value={edited.name} onChange={(e) => updateCatEdit(cat.id, { name: e.target.value })} placeholder="Category name" />
                              </div>
                              <div>
                                <Label>Shortform</Label>
                                <Input value={edited.shortform} onChange={(e) => updateCatEdit(cat.id, { shortform: e.target.value.slice(0, 2) })} placeholder="LB" maxLength={2} />
                              </div>
                              <div>
                                <Label>Entity Type</Label>
                                <Input value={edited.entityType} onChange={(e) => updateCatEdit(cat.id, { entityType: e.target.value })} placeholder="Labour, Equipment..." />
                              </div>
                              <div>
                                <Label>Color</Label>
                                <div className="flex items-center gap-2">
                                  <input type="color" value={edited.color || "#000000"} onChange={(e) => updateCatEdit(cat.id, { color: e.target.value })} className="h-8 w-8 cursor-pointer rounded border border-line" />
                                  <Input value={edited.color} onChange={(e) => updateCatEdit(cat.id, { color: e.target.value })} placeholder="#000000" className="flex-1" />
                                </div>
                              </div>
                            </div>
                          </div>

                          <Separator />

                          {/* Item Source */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Item Source</p>
                            <Select
                              value={edited.itemSource || "freeform"}
                              onChange={(e) => updateCatEdit(cat.id, { itemSource: e.target.value as EntityCategory["itemSource"] })}
                            >
                              {ITEM_SOURCE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </Select>
                            <p className="mt-1 text-[11px] text-fg/40">
                              {ITEM_SOURCE_OPTIONS.find((o) => o.value === (edited.itemSource || "freeform"))?.description}
                            </p>
                            {edited.itemSource === "catalog" && (
                              <div className="mt-3">
                                <Label>Linked Catalog</Label>
                                <Select
                                  value={edited.catalogId || ""}
                                  onChange={(e) => updateCatEdit(cat.id, { catalogId: e.target.value || null })}
                                >
                                  <option value="">Any catalog</option>
                                  {initialCatalogs.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>
                                  ))}
                                </Select>
                              </div>
                            )}
                            {edited.itemSource === "rate_schedule" && (
                              <p className="mt-2 text-[11px] text-fg/40">Rate schedules are imported per-quote from Settings &gt; Estimating &gt; Rate Schedules.</p>
                            )}
                          </div>

                          <Separator />

                          {/* Units */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Units</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Default UOM</Label>
                                <Select value={edited.defaultUom} onChange={(e) => updateCatEdit(cat.id, { defaultUom: e.target.value })}>
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
                              </div>
                            </div>
                          </div>

                          <Separator />

                          {/* Editable Fields */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Editable Fields</p>
                            <div className="flex flex-wrap gap-4">
                              {EDITABLE_FIELD_KEYS.map((f) => (
                                <label key={f.key} className="flex items-center gap-2 text-xs text-fg/80 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={edited.editableFields[f.key]}
                                    onChange={(e) => updateCatEdit(cat.id, { editableFields: { ...edited.editableFields, [f.key]: e.target.checked } })}
                                    className="rounded border-line accent-accent"
                                  />
                                  {f.label}
                                </label>
                              ))}
                            </div>
                          </div>

                          <Separator />

                          {/* Unit Column Labels */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Unit Column Labels</p>
                            <p className="text-[11px] text-fg/40 mb-3">Custom labels for the unit columns shown in the estimator grid. These map to rate schedule tiers when using rate schedule item source.</p>
                            <div className="grid grid-cols-3 gap-3">
                              <div>
                                <Label>Unit 1</Label>
                                <Input value={edited.unitLabels.unit1} onChange={(e) => updateCatEdit(cat.id, { unitLabels: { ...edited.unitLabels, unit1: e.target.value } })} placeholder="Unit 1" />
                              </div>
                              <div>
                                <Label>Unit 2</Label>
                                <Input value={edited.unitLabels.unit2} onChange={(e) => updateCatEdit(cat.id, { unitLabels: { ...edited.unitLabels, unit2: e.target.value } })} placeholder="Unit 2" />
                              </div>
                              <div>
                                <Label>Unit 3</Label>
                                <Input value={edited.unitLabels.unit3} onChange={(e) => updateCatEdit(cat.id, { unitLabels: { ...edited.unitLabels, unit3: e.target.value } })} placeholder="Unit 3" />
                              </div>
                            </div>
                          </div>

                          <Separator />

                          {/* Calculation */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Calculation</p>
                            <div>
                              <Label>Calculation Type</Label>
                              <Select value={edited.calculationType} onChange={(e) => updateCatEdit(cat.id, { calculationType: e.target.value as CalculationType })}>
                                {CALCULATION_TYPES.map((ct) => (
                                  <option key={ct.value} value={ct.value}>{ct.label}</option>
                                ))}
                              </Select>
                            </div>
                            {edited.calculationType === "formula" && (
                              <div className="mt-3">
                                <Label>Custom Formula</Label>
                                <Input value={edited.calcFormula} onChange={(e) => updateCatEdit(cat.id, { calcFormula: e.target.value })} placeholder="qty * cost * (1 + markup)" />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="border-t border-line px-5 py-3 flex items-center justify-end gap-2 bg-panel2/20">
                          <Button variant="secondary" size="sm" onClick={() => setExpandedCatId(null)}>
                            Cancel
                          </Button>
                          <Button variant="accent" size="sm" onClick={() => { saveCat(cat); setExpandedCatId(null); }}>
                            Save
                          </Button>
                        </div>
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>,
                document.body
                )}
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
                {customers.map((cust) => (
                  <div
                    key={cust.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedCustId(expandedCustId === cust.id ? null : cust.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedCustId(expandedCustId === cust.id ? null : cust.id); } }}
                    className={cn("flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-panel2 transition-colors cursor-pointer", expandedCustId === cust.id && "bg-accent/5")}
                  >
                    <Building2 className="h-3.5 w-3.5 text-fg/30 shrink-0" />
                    <span className="font-medium text-fg truncate">{cust.name || "Untitled"}</span>
                    {cust.email && <span className="text-xs text-fg/40 truncate">{cust.email}</span>}
                    {cust.phone && <span className="text-xs text-fg/40 truncate">{cust.phone}</span>}
                    <span className="flex-1" />
                    <span onClick={(e) => e.stopPropagation()}>
                      <Toggle checked={cust.active} onChange={(val) => toggleCustActive(cust, val)} />
                    </span>
                  </div>
                ))}

                {/* Client Drawer (portalled to body to escape FadeIn transform) */}
                {typeof document !== "undefined" && createPortal(
                <AnimatePresence>
                  {expandedCustId && (() => {
                    const cust = customers.find((c) => c.id === expandedCustId);
                    if (!cust) return null;
                    const edited = getCustEdit(cust);
                    const contacts = custContacts[cust.id] || [];
                    return (
                      <motion.div
                        key="client-drawer"
                        initial={{ x: 420 }}
                        animate={{ x: 0 }}
                        exit={{ x: 420 }}
                        transition={{ type: "spring", damping: 30, stiffness: 300 }}
                        className="fixed inset-y-0 right-0 z-40 w-[420px] bg-panel border-l border-line shadow-2xl flex flex-col"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-line bg-panel2/40">
                          <div className="flex items-center gap-2 min-w-0">
                            <Building2 className="h-3.5 w-3.5 text-fg/40 shrink-0" />
                            <span className="text-sm font-semibold truncate">{edited.name || "New Client"}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            {!cust.id.startsWith("new-") && (
                              <button
                                className="p-1.5 rounded hover:bg-danger/10 text-fg/40 hover:text-danger transition-colors"
                                onClick={() => {
                                  if (custDeleteConfirm === cust.id) { deleteCustomer(cust.id); }
                                  else { setCustDeleteConfirm(cust.id); }
                                }}
                                title={custDeleteConfirm === cust.id ? "Confirm delete" : "Delete client"}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors"
                              onClick={() => { saveCustomer(cust); setExpandedCustId(null); }}
                              title="Close"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-5 space-y-5">
                          {/* Basic Info */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Basic Info</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Name</Label>
                                <Input value={edited.name} onChange={(e) => updateCustEdit(cust.id, { name: e.target.value })} placeholder="Client name" />
                              </div>
                              <div>
                                <Label>Short Name</Label>
                                <Input value={edited.shortName} onChange={(e) => updateCustEdit(cust.id, { shortName: e.target.value })} placeholder="Abbreviation" />
                              </div>
                            </div>
                          </div>

                          {/* Contact Info */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Contact Info</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <Label>Phone</Label>
                                <Input value={edited.phone} onChange={(e) => updateCustEdit(cust.id, { phone: e.target.value })} placeholder="Phone number" />
                              </div>
                              <div>
                                <Label>Email</Label>
                                <Input value={edited.email} onChange={(e) => updateCustEdit(cust.id, { email: e.target.value })} placeholder="Email address" />
                              </div>
                            </div>
                            <div className="mt-3">
                              <Label>Website</Label>
                              <Input value={edited.website} onChange={(e) => updateCustEdit(cust.id, { website: e.target.value })} placeholder="https://" />
                            </div>
                          </div>

                          {/* Address */}
                          <div>
                            <p className="text-xs font-medium text-fg/60 uppercase tracking-wider mb-3">Address</p>
                            <div className="space-y-3">
                              <div>
                                <Label>Street</Label>
                                <Input value={edited.addressStreet} onChange={(e) => updateCustEdit(cust.id, { addressStreet: e.target.value })} />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label>City</Label>
                                  <Input value={edited.addressCity} onChange={(e) => updateCustEdit(cust.id, { addressCity: e.target.value })} />
                                </div>
                                <div>
                                  <Label>Province / State</Label>
                                  <Input value={edited.addressProvince} onChange={(e) => updateCustEdit(cust.id, { addressProvince: e.target.value })} />
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <Label>Postal / Zip</Label>
                                  <Input value={edited.addressPostalCode} onChange={(e) => updateCustEdit(cust.id, { addressPostalCode: e.target.value })} />
                                </div>
                                <div>
                                  <Label>Country</Label>
                                  <Input value={edited.addressCountry} onChange={(e) => updateCustEdit(cust.id, { addressCountry: e.target.value })} />
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Notes */}
                          <div>
                            <Label>Notes</Label>
                            <Input value={edited.notes} onChange={(e) => updateCustEdit(cust.id, { notes: e.target.value })} placeholder="Internal notes" />
                          </div>

                          {/* Contacts sub-section */}
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <p className="text-xs font-medium text-fg/60 uppercase tracking-wider">Contacts</p>
                              {!cust.id.startsWith("new-") && (
                                <Button variant="secondary" size="xs" onClick={() => addContact(cust.id)}>
                                  <Plus className="h-3 w-3" />
                                  Add Contact
                                </Button>
                              )}
                            </div>
                            {cust.id.startsWith("new-") && (
                              <p className="text-xs text-fg/40">Save the client first, then add contacts.</p>
                            )}
                            {contacts.length > 0 && (
                              <div className="space-y-2">
                                {contacts.map((contact) => {
                                  const ce = getContactEdit(contact);
                                  return (
                                    <div key={contact.id} className="rounded-lg border border-line bg-panel2/30 p-3 space-y-3" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) saveContact(cust.id, contact); }}>
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
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-panel2/40">
                          <Button variant="secondary" size="sm" onClick={() => setExpandedCustId(null)}>Cancel</Button>
                          <Button variant="accent" size="sm" onClick={() => { saveCustomer(cust); setExpandedCustId(null); }}>Save</Button>
                        </div>
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>,
                document.body
                )}
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

          {/* ── Terms & Conditions Tab ─────────────────────────────────── */}
          {activeGroup === "organization" && orgSubTab === "terms" && (
            <Card>
              <CardHeader>
                <CardTitle>Terms & Conditions</CardTitle>
              </CardHeader>
              <CardBody>
                <div className="space-y-4">
                  <div>
                    <Label>Organization Terms & Conditions</Label>
                    <p className="text-xs text-fg/40 mt-1 mb-3">
                      Paste your standard terms and conditions below. These will be included in all generated quote PDFs when the Terms & Conditions section is enabled.
                    </p>
                    <textarea
                      className="w-full rounded-lg border border-line bg-transparent px-4 py-3 text-sm text-fg leading-relaxed resize-y focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 min-h-[400px]"
                      rows={20}
                      value={settings.termsAndConditions}
                      onChange={(e) => setSettings((prev) => ({ ...prev, termsAndConditions: e.target.value }))}
                      placeholder={"1. SCOPE OF WORK\nThe Contractor shall provide all labour, materials, and equipment necessary to complete the work as described in this proposal.\n\n2. PAYMENT TERMS\nPayment is due within 30 days of invoice date...\n\n3. WARRANTY\nAll work shall be warranted for a period of one (1) year from the date of completion..."}
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-fg/30">
                      {settings.termsAndConditions.length > 0
                        ? `${settings.termsAndConditions.length.toLocaleString()} characters`
                        : "No terms configured"}
                    </span>
                    <span className="text-xs text-fg/30">Auto-saves when changed</span>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* ── Estimator Personas Tab ─────────────────────────────── */}
          {activeGroup === "organization" && orgSubTab === "personas" && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Estimator Personas</CardTitle>
                <Button variant="accent" size="xs" onClick={addPersona}>
                  <Plus className="h-3 w-3" />
                  Add Persona
                </Button>
              </CardHeader>
              <div className="divide-y divide-line">
                {personas.length === 0 && (
                  <div className="px-5 py-8 text-center text-xs text-fg/40">
                    No personas yet. Click &quot;Add Persona&quot; to get started.
                  </div>
                )}
                {personas.map((persona) => {
                  const edited = getPersonaEdit(persona);
                  const isExpanded = expandedPersonaId === persona.id;
                  const defaultAssumptions = parsePersonaJsonField((edited as any).defaultAssumptions);
                  const productivityGuidance = parsePersonaJsonField((edited as any).productivityGuidance);
                  const commercialGuidance = parsePersonaJsonField((edited as any).commercialGuidance);
                  const supervisionGuidance = parsePersonaJsonField(productivityGuidance.supervision);
                  const packagingGuidance = parsePersonaJsonField(commercialGuidance.packaging);
                  return (
                    <div key={persona.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setExpandedPersonaId(isExpanded ? null : persona.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedPersonaId(isExpanded ? null : persona.id); } }}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-panel2 transition-colors cursor-pointer"
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-fg/40 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-fg/40 shrink-0" />}
                        <span className="font-medium text-fg truncate">{edited.name || "Untitled"}</span>
                        {edited.trade && (
                          <Badge className={cn("text-[10px] shrink-0", TRADE_COLORS[edited.trade] || "")}>
                            {edited.trade}
                          </Badge>
                        )}
                        {edited.isDefault && <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400 shrink-0" />}
                        {edited.description && <span className="text-xs text-fg/40 truncate">{edited.description}</span>}
                        <span className="flex-1" />
                        <span onClick={(e) => e.stopPropagation()}>
                          <Toggle checked={edited.enabled} onChange={(val) => togglePersonaEnabled(persona, val)} />
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-line bg-panel2/50 px-5 py-4 space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Name</Label>
                              <Input value={edited.name} onChange={(e) => updatePersonaEdit(persona.id, { name: e.target.value })} placeholder="Persona name" />
                            </div>
                            <div>
                              <Label>Trade</Label>
                              <Select value={edited.trade} onChange={(e) => updatePersonaEdit(persona.id, { trade: e.target.value })}>
                                {TRADE_OPTIONS.map((t) => (
                                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                                ))}
                              </Select>
                            </div>
                          </div>
                          <div>
                            <Label>Description</Label>
                            <Input value={edited.description} onChange={(e) => updatePersonaEdit(persona.id, { description: e.target.value })} placeholder="Brief description of this persona" />
                          </div>
                          <div>
                            <Label>System Prompt</Label>
                            <textarea
                              className="w-full rounded-lg border border-line bg-transparent px-4 py-3 text-sm text-fg font-mono leading-relaxed resize-y focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 min-h-[200px]"
                              rows={16}
                              value={edited.systemPrompt}
                              onChange={(e) => updatePersonaEdit(persona.id, { systemPrompt: e.target.value })}
                              placeholder="Enter the persona's system prompt... This instructs the agent how to think about estimates for this trade."
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Priority Knowledge Books</Label>
                              <p className="text-[10px] text-fg/30 mb-1.5">Agent searches these first but can access all books</p>
                              <MultiSelect
                                options={knowledgeBooks
                                  .filter((b) => b.status === "indexed")
                                  .map((b) => ({
                                    value: b.id,
                                    label: b.name,
                                    description: `${b.category} · ${b.pageCount} pages · ${b.sourceFileName}`,
                                  }))}
                                selected={edited.knowledgeBookIds || []}
                                onChange={(ids) => updatePersonaEdit(persona.id, { knowledgeBookIds: ids })}
                                placeholder="Select knowledge books..."
                              />
                            </div>
                            <div>
                              <Label>Dataset Tags</Label>
                              <Input
                                value={(edited.datasetTags || []).join(", ")}
                                onChange={(e) => updatePersonaEdit(persona.id, { datasetTags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                                placeholder="Comma-separated tags"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Package Buckets</Label>
                              <Input
                                value={(edited.packageBuckets || []).join(", ")}
                                onChange={(e) => updatePersonaEdit(persona.id, { packageBuckets: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                                placeholder="Fabrication, Installation, Testing..."
                              />
                              <p className="mt-1 text-[10px] text-fg/30">Preferred commercial breakdown for this persona</p>
                            </div>
                            <div>
                              <Label>Review Focus Areas</Label>
                              <Input
                                value={(edited.reviewFocusAreas || []).join(", ")}
                                onChange={(e) => updatePersonaEdit(persona.id, { reviewFocusAreas: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                                placeholder="Supports, logistics, testing..."
                              />
                              <p className="mt-1 text-[10px] text-fg/30">Areas the reconcile pass should scrutinize first</p>
                            </div>
                          </div>
                          <div className="rounded-xl border border-line bg-panel/50 p-4 space-y-4">
                            <div>
                              <p className="text-sm font-medium text-fg">Editable Estimating Policy</p>
                              <p className="text-xs text-fg/40 mt-1">
                                These helpers write into the persona JSON so supervision and commercialization rules live in user-editable policy, not the prompt generator.
                              </p>
                            </div>
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                              <div className="space-y-3">
                                <p className="text-xs font-medium text-fg/70 uppercase tracking-wide">Supervision</p>
                                <div>
                                  <Label>Coverage Mode</Label>
                                  <Select
                                    value={String(supervisionGuidance.coverageMode ?? "single_source")}
                                    onChange={(e) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "productivityGuidance",
                                      (edited as any).productivityGuidance,
                                      "supervision",
                                      { coverageMode: e.target.value },
                                    )}
                                  >
                                    <option value="single_source">Single source only</option>
                                    <option value="embedded">Embedded in packages</option>
                                    <option value="general_conditions">General Conditions</option>
                                    <option value="hybrid">Hybrid split</option>
                                  </Select>
                                </div>
                                <div>
                                  <Label>Foreman To Trades</Label>
                                  <Input
                                    value={String(supervisionGuidance.foremanToTrades ?? "")}
                                    onChange={(e) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "productivityGuidance",
                                      (edited as any).productivityGuidance,
                                      "supervision",
                                      { foremanToTrades: e.target.value },
                                    )}
                                    placeholder="1:6"
                                  />
                                </div>
                                <div>
                                  <Label>Superintendent Threshold (Weeks)</Label>
                                  <Input
                                    type="number"
                                    value={String(supervisionGuidance.superintendentThresholdWeeks ?? "")}
                                    onChange={(e) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "productivityGuidance",
                                      (edited as any).productivityGuidance,
                                      "supervision",
                                      { superintendentThresholdWeeks: parseFloat(e.target.value) || 0 },
                                    )}
                                    placeholder="4"
                                  />
                                </div>
                              </div>
                              <div className="space-y-3">
                                <p className="text-xs font-medium text-fg/70 uppercase tracking-wide">Commercialization</p>
                                <div>
                                  <Label>Weak Evidence Pricing Mode</Label>
                                  <Select
                                    value={String(packagingGuidance.weakEvidencePricingMode ?? "allowance")}
                                    onChange={(e) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "commercialGuidance",
                                      (edited as any).commercialGuidance,
                                      "packaging",
                                      { weakEvidencePricingMode: e.target.value },
                                    )}
                                  >
                                    <option value="allowance">Allowance</option>
                                    <option value="subcontract">Subcontract</option>
                                    <option value="historical_allowance">Historical allowance</option>
                                    <option value="detailed">Detailed takeoff</option>
                                  </Select>
                                </div>
                                <div>
                                  <Label>Shop Fabrication Pricing Mode</Label>
                                  <Select
                                    value={String(packagingGuidance.shopFabricationPricingMode ?? "detailed")}
                                    onChange={(e) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "commercialGuidance",
                                      (edited as any).commercialGuidance,
                                      "packaging",
                                      { shopFabricationPricingMode: e.target.value },
                                    )}
                                  >
                                    <option value="detailed">Detailed takeoff</option>
                                    <option value="subcontract">Subcontract</option>
                                    <option value="historical_allowance">Historical allowance</option>
                                    <option value="allowance">Allowance</option>
                                  </Select>
                                </div>
                                <div>
                                  <Label>Default Subcontract Scopes</Label>
                                  <Input
                                    value={(Array.isArray(defaultAssumptions.subcontractDefaults) ? defaultAssumptions.subcontractDefaults : []).join(", ")}
                                    onChange={(e) => updatePersonaEdit(persona.id, {
                                      defaultAssumptions: {
                                        ...defaultAssumptions,
                                        subcontractDefaults: e.target.value.split(",").map((value) => value.trim()).filter(Boolean),
                                      },
                                    } as any)}
                                    placeholder="scaffolding, NDT, insulation"
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 gap-4">
                            <div>
                              <Label>Default Assumptions (JSON)</Label>
                              <textarea
                                className="w-full rounded-lg border border-line bg-transparent px-4 py-3 text-xs text-fg font-mono leading-relaxed resize-y focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 min-h-[120px]"
                                value={typeof (edited as any).defaultAssumptions === "string" ? (edited as any).defaultAssumptions : JSON.stringify(edited.defaultAssumptions || {}, null, 2)}
                                onChange={(e) => updatePersonaEdit(persona.id, { defaultAssumptions: e.target.value as any } as any)}
                                placeholder='{"selfPerformDefaults":["install"],"subcontractDefaults":["scaffold"]}'
                              />
                            </div>
                            <div>
                              <Label>Productivity Guidance (JSON)</Label>
                              <textarea
                                className="w-full rounded-lg border border-line bg-transparent px-4 py-3 text-xs text-fg font-mono leading-relaxed resize-y focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 min-h-[120px]"
                                value={typeof (edited as any).productivityGuidance === "string" ? (edited as any).productivityGuidance : JSON.stringify(edited.productivityGuidance || {}, null, 2)}
                                onChange={(e) => updatePersonaEdit(persona.id, { productivityGuidance: e.target.value as any } as any)}
                                placeholder='{"crewNorms":{"foremanToTrades":"1:5"},"fixedVsVariable":"favor packaged allowances when evidence is weak"}'
                              />
                            </div>
                            <div>
                              <Label>Commercial Guidance (JSON)</Label>
                              <textarea
                                className="w-full rounded-lg border border-line bg-transparent px-4 py-3 text-xs text-fg font-mono leading-relaxed resize-y focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 min-h-[120px]"
                                value={typeof (edited as any).commercialGuidance === "string" ? (edited as any).commercialGuidance : JSON.stringify(edited.commercialGuidance || {}, null, 2)}
                                onChange={(e) => updatePersonaEdit(persona.id, { commercialGuidance: e.target.value as any } as any)}
                                placeholder='{"preferredPricingModes":{"supports":"subcontract","testing":"allowance"},"confidencePolicy":"use allowance if execution model is not evidenced"}'
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-fg">
                              <input
                                type="checkbox"
                                checked={edited.isDefault}
                                onChange={(e) => updatePersonaEdit(persona.id, { isDefault: e.target.checked })}
                                className="rounded border-line"
                              />
                              Is Default
                            </label>
                            <div className="flex items-center gap-2">
                              <Label className="mb-0">Enabled</Label>
                              <Toggle checked={edited.enabled} onChange={(val) => updatePersonaEdit(persona.id, { enabled: val })} />
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-2">
                            <Button variant="accent" size="xs" onClick={() => savePersona(persona)}>
                              Save
                            </Button>
                            {personaDeleteConfirm === persona.id ? (
                              <div className="flex items-center gap-2 ml-2">
                                <span className="text-xs text-danger">Delete this persona?</span>
                                <Button variant="danger" size="xs" onClick={() => deletePersonaById(persona.id)}>Confirm</Button>
                                <Button variant="secondary" size="xs" onClick={() => setPersonaDeleteConfirm(null)}>Cancel</Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPersonaDeleteConfirm(persona.id)}
                                className="rounded p-1 text-fg/30 hover:bg-danger/10 hover:text-danger transition-colors ml-2"
                                title="Delete persona"
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

          {/* ── Items & Catalogs ─── */}
          {activeGroup === "data" && dataSubTab === "catalogs" && (
            <ItemsManager catalogs={initialCatalogs} />
          )}

          {/* ── Rate Schedules ─── */}
          {activeGroup === "data" && dataSubTab === "rates" && (
            <RateScheduleManager schedules={rateSchedules} setSchedules={setRateSchedules} loading={ratesLoading} catalogs={initialCatalogs} />
          )}

          {/* ── Inclusions / Exclusions ─── */}
          {activeGroup === "data" && dataSubTab === "conditions" && (
            <Card>
              <CardHeader>
                <CardTitle>Conditions Library</CardTitle>
              </CardHeader>
              <div className="px-5 pb-5">
                <p className="text-xs text-fg/50 mb-4">
                  Manage your organization&apos;s standard clause library. These are available to quickly add when setting up project quotes.
                </p>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                  {/* Inclusions */}
                  <div className="flex flex-col">
                    <h3 className="text-sm font-medium text-fg mb-3 flex items-center gap-2">
                      Inclusions
                      <span className="text-[10px] font-normal text-fg/35 bg-fg/5 rounded-full px-2 py-0.5">
                        {conditionLibrary.filter((e) => e.type === "inclusion" || e.type === "Inclusion").length}
                      </span>
                    </h3>
                    <div className="space-y-1.5 mb-3 flex-1">
                      {conditionLibrary.filter((e) => e.type === "inclusion" || e.type === "Inclusion").length === 0 && (
                        <p className="text-xs text-fg/40 italic py-2">No inclusions yet</p>
                      )}
                      {conditionLibrary
                        .filter((e) => e.type === "inclusion" || e.type === "Inclusion")
                        .map((entry) => (
                          <div key={entry.id} className="group flex items-start gap-2 rounded-lg border border-line bg-panel2/50 px-3 py-2">
                            <span className="flex-1 text-xs text-fg leading-relaxed">{entry.value}</span>
                            <button
                              onClick={() => removeConditionLibraryEntry(entry.id)}
                              className="mt-0.5 shrink-0 rounded p-1 text-fg/20 opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger transition-all"
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
                  <div className="flex flex-col">
                    <h3 className="text-sm font-medium text-fg mb-3 flex items-center gap-2">
                      Exclusions
                      <span className="text-[10px] font-normal text-fg/35 bg-fg/5 rounded-full px-2 py-0.5">
                        {conditionLibrary.filter((e) => e.type === "exclusion" || e.type === "Exclusion").length}
                      </span>
                    </h3>
                    <div className="space-y-1.5 mb-3 flex-1">
                      {conditionLibrary.filter((e) => e.type === "exclusion" || e.type === "Exclusion").length === 0 && (
                        <p className="text-xs text-fg/40 italic py-2">No exclusions yet</p>
                      )}
                      {conditionLibrary
                        .filter((e) => e.type === "exclusion" || e.type === "Exclusion")
                        .map((entry) => (
                          <div key={entry.id} className="group flex items-start gap-2 rounded-lg border border-line bg-panel2/50 px-3 py-2">
                            <span className="flex-1 text-xs text-fg leading-relaxed">{entry.value}</span>
                            <button
                              onClick={() => removeConditionLibraryEntry(entry.id)}
                              className="mt-0.5 shrink-0 rounded p-1 text-fg/20 opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger transition-all"
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

                  {/* Clarifications */}
                  <div className="flex flex-col">
                    <h3 className="text-sm font-medium text-fg mb-3 flex items-center gap-2">
                      Clarifications
                      <span className="text-[10px] font-normal text-fg/35 bg-fg/5 rounded-full px-2 py-0.5">
                        {conditionLibrary.filter((e) => e.type === "clarification" || e.type === "Clarification").length}
                      </span>
                    </h3>
                    <div className="space-y-1.5 mb-3 flex-1">
                      {conditionLibrary.filter((e) => e.type === "clarification" || e.type === "Clarification").length === 0 && (
                        <p className="text-xs text-fg/40 italic py-2">No clarifications yet</p>
                      )}
                      {conditionLibrary
                        .filter((e) => e.type === "clarification" || e.type === "Clarification")
                        .map((entry) => (
                          <div key={entry.id} className="group flex items-start gap-2 rounded-lg border border-line bg-panel2/50 px-3 py-2">
                            <span className="flex-1 text-xs text-fg leading-relaxed">{entry.value}</span>
                            <button
                              onClick={() => removeConditionLibraryEntry(entry.id)}
                              className="mt-0.5 shrink-0 rounded p-1 text-fg/20 opacity-0 group-hover:opacity-100 hover:bg-danger/10 hover:text-danger transition-all"
                              title="Remove"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={newClarification}
                        onChange={(e) => setNewClarification(e.target.value)}
                        placeholder="Add clarification clause..."
                        className="flex-1"
                        onKeyDown={(e) => e.key === "Enter" && addConditionLibraryEntry("clarification", newClarification)}
                      />
                      <Button variant="secondary" size="sm" onClick={() => addConditionLibraryEntry("clarification", newClarification)} disabled={conditionSaving || !newClarification.trim()}>
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>

                </div>
              </div>
            </Card>
          )}

          {/* ── Labour Costs & Burden ─── */}
          {activeGroup === "data" && dataSubTab === "costs" && (
            <div className="space-y-6">
              <LabourCostManager />
              <BurdenManager />
            </div>
          )}

          {/* ── Travel Policies ─── */}
          {activeGroup === "data" && dataSubTab === "travel" && (
            <TravelPolicyManager />
          )}

          {/* ── Agent Runtime ─── */}
          {activeGroup === "integrations" && integrationsSubTab === "agent" && (
            <AgentRuntimeSettings settings={settings} onUpdate={(patch) => setSettings((prev) => ({ ...prev, integrations: { ...prev.integrations, ...patch } }))} onUpdateDefaults={updateDefaults} />
          )}

          {/* ── Plugins ─── */}
          {activeGroup === "integrations" && integrationsSubTab === "plugins" && (
            <PluginsPage initialPlugins={initialPlugins} initialDatasets={initialDatasets} entityCategories={categories} />
          )}

        </FadeIn>

      {/* ── Import Confirmation Dialog ─── */}
      {importConfirm && importOptions && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-panel border border-line rounded-xl shadow-2xl w-[460px] max-h-[80vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-line">
              <h3 className="text-sm font-semibold">Import Data</h3>
              <p className="text-xs text-fg/40 mt-1">{importConfirm.fileName}</p>
            </div>

            {/* ── State: Importing (progress) ── */}
            {importing && (
              <div className="px-5 py-6 text-xs">
                <div className="flex items-center gap-2.5 mb-4">
                  <Loader2 className="h-4 w-4 animate-spin text-accent" />
                  <span className="text-fg/60 font-medium">
                    {importProgress ? importProgress.currentSection : "Starting import..."}
                  </span>
                </div>
                {importProgress && (
                  <>
                    <div className="w-full bg-bg rounded-full h-1.5 mb-2">
                      <div
                        className="bg-accent h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((importProgress.sectionsComplete / importProgress.totalSections) * 100)}%` }}
                      />
                    </div>
                    <p className="text-fg/30 text-[10px]">{importProgress.sectionsComplete} of {importProgress.totalSections} sections complete</p>
                    {importProgress.errors.length > 0 && (
                      <p className="text-amber-400/70 text-[10px] mt-1">{importProgress.errors.length} error{importProgress.errors.length !== 1 ? "s" : ""} so far</p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── State: Fatal error ── */}
            {!importing && importError && (
              <>
                <div className="px-5 py-5 text-xs">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-danger mb-1">Import Failed</p>
                      <p className="text-fg/50">{importError}</p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-3 border-t border-line flex items-center justify-end">
                  <Button variant="secondary" size="sm" onClick={handleImportDismiss}>Close</Button>
                </div>
              </>
            )}

            {/* ── State: Complete (results) ── */}
            {!importing && importResult && (() => {
              const totalCreated = Object.values(importResult.created).reduce((a, b) => a + b, 0);
              const totalUpdated = Object.values(importResult.updated).reduce((a, b) => a + b, 0);
              const totalDeleted = Object.values(importResult.deleted).reduce((a, b) => a + b, 0);
              const hasErrors = importResult.errors.length > 0;
              return (
                <>
                  <div className="px-5 py-4 space-y-3 text-xs">
                    <div className="flex items-start gap-2.5">
                      {hasErrors ? (
                        <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p className="font-medium text-fg mb-1">{hasErrors ? "Import Completed with Errors" : "Import Complete"}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-fg/50">
                          {totalCreated > 0 && <span><span className="text-emerald-400 font-medium">{totalCreated}</span> created</span>}
                          {totalUpdated > 0 && <span><span className="text-blue-400 font-medium">{totalUpdated}</span> updated</span>}
                          {totalDeleted > 0 && <span><span className="text-fg/40 font-medium">{totalDeleted}</span> removed</span>}
                          {totalCreated === 0 && totalUpdated === 0 && totalDeleted === 0 && <span>No changes</span>}
                        </div>
                      </div>
                    </div>

                    {/* Per-section breakdown */}
                    <div className="space-y-0.5 pt-2 border-t border-line">
                      {IMPORT_SECTION_ORDER.map((key) => {
                        const c = importResult.created[key] ?? 0;
                        const u = importResult.updated[key] ?? 0;
                        const ci = key === "catalogs" ? (importResult.created.catalogItems ?? 0) : 0;
                        const ui = key === "catalogs" ? (importResult.updated.catalogItems ?? 0) : 0;
                        if (c === 0 && u === 0 && ci === 0 && ui === 0) return null;
                        const parts: string[] = [];
                        if (c > 0) parts.push(`${c} created`);
                        if (u > 0) parts.push(`${u} updated`);
                        if (ci > 0) parts.push(`${ci} items created`);
                        if (ui > 0) parts.push(`${ui} items updated`);
                        return (
                          <div key={key} className="flex items-center justify-between py-1 px-2">
                            <span className="text-fg/50">{IMPORT_SECTION_LABELS[key]}</span>
                            <span className="text-fg/30">{parts.join(", ")}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Errors list */}
                    {hasErrors && (
                      <div className="pt-2 border-t border-line">
                        <p className="text-amber-400/80 font-medium mb-1.5">{importResult.errors.length} Error{importResult.errors.length !== 1 ? "s" : ""}</p>
                        <div className="max-h-[140px] overflow-y-auto space-y-1 bg-bg/60 rounded-md p-2">
                          {importResult.errors.map((err, i) => (
                            <p key={i} className="text-fg/40 text-[10px] leading-snug">{err}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="px-5 py-3 border-t border-line flex items-center justify-end">
                    <Button variant="accent" size="sm" onClick={handleImportDismiss}>Done</Button>
                  </div>
                </>
              );
            })()}

            {/* ── State: Configuration (initial) ── */}
            {!importing && !importResult && !importError && (
              <>
                <div className="px-5 py-4 space-y-3 text-xs">
                  {/* Import mode selector */}
                  <div>
                    <p className="text-fg/60 font-medium mb-2">Import Mode</p>
                    <div className="flex gap-1 p-0.5 bg-bg rounded-lg border border-line">
                      <button
                        type="button"
                        className={cn(
                          "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                          importOptions.mode === "add" ? "bg-panel text-fg shadow-sm" : "text-fg/40 hover:text-fg/60",
                        )}
                        onClick={() => setImportOptions((o) => o ? { ...o, mode: "add" } : o)}
                      >
                        Add / Update
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                          importOptions.mode === "overwrite" ? "bg-panel text-fg shadow-sm" : "text-fg/40 hover:text-fg/60",
                        )}
                        onClick={() => setImportOptions((o) => o ? { ...o, mode: "overwrite" } : o)}
                      >
                        Overwrite
                      </button>
                    </div>
                    <p className="text-fg/30 mt-1.5">
                      {importOptions.mode === "add"
                        ? "New items will be created. Existing items (matched by name) will be updated."
                        : "All existing data in selected categories will be deleted and replaced."}
                    </p>
                  </div>
                  {/* Section toggles */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-fg/60 font-medium">Data to Import</p>
                      <button
                        type="button"
                        className="text-[10px] text-accent hover:text-accent/80"
                        onClick={() => {
                          const allEnabled = IMPORT_SECTION_ORDER.every((k) => {
                            const count = importConfirm.summary[k] ?? 0;
                            return count === 0 || importOptions.enabledSections[k];
                          });
                          setImportOptions((o) => {
                            if (!o) return o;
                            const next = { ...o.enabledSections };
                            for (const k of IMPORT_SECTION_ORDER) {
                              const count = importConfirm.summary[k] ?? 0;
                              if (count > 0) next[k] = !allEnabled;
                            }
                            return { ...o, enabledSections: next };
                          });
                        }}
                      >
                        {IMPORT_SECTION_ORDER.every((k) => (importConfirm.summary[k] ?? 0) === 0 || importOptions.enabledSections[k]) ? "Deselect All" : "Select All"}
                      </button>
                    </div>
                    <div className="space-y-0.5">
                      {IMPORT_SECTION_ORDER.map((key) => {
                        const label = IMPORT_SECTION_LABELS[key];
                        const count = importConfirm.summary[key] ?? 0;
                        const itemCount = key === "catalogs" ? importConfirm.summary.catalogItems : 0;
                        if (count === 0) return null;
                        return (
                          <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-bg/60">
                            <label className="flex items-center gap-2.5 cursor-pointer flex-1">
                              <Toggle
                                checked={importOptions.enabledSections[key]}
                                onChange={(val) => setImportOptions((o) => o ? { ...o, enabledSections: { ...o.enabledSections, [key]: val } } : o)}
                              />
                              <span className={cn("text-fg/60", !importOptions.enabledSections[key] && "text-fg/25")}>{label}</span>
                            </label>
                            <div className="flex items-center gap-1.5">
                              {itemCount > 0 && <span className={cn("text-fg/25 text-[10px]", !importOptions.enabledSections[key] && "opacity-40")}>{itemCount} items</span>}
                              <Badge tone="default" className={cn(!importOptions.enabledSections[key] && "opacity-30")}>{count}</Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {importOptions.mode === "overwrite" && (
                    <p className="text-amber-400/80 mt-2 pt-2 border-t border-line">Warning: Overwrite will permanently delete existing data in selected categories before importing.</p>
                  )}
                  {importOptions.mode === "add" && (
                    <p className="text-fg/30 mt-2 pt-2 border-t border-line">Existing data not in the import file will be preserved.</p>
                  )}
                </div>
                <div className="px-5 py-3 border-t border-line flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={handleImportDismiss}>Cancel</Button>
                  <Button
                    variant={importOptions.mode === "overwrite" ? "danger" : "accent"}
                    size="sm"
                    onClick={handleImportConfirm}
                    disabled={!IMPORT_SECTION_ORDER.some((k) => importOptions.enabledSections[k])}
                  >
                    {importOptions.mode === "overwrite" ? "Overwrite & Import" : "Import"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}

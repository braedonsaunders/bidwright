"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  KeyRound,
  Loader2,
  Mail,
  Plus,
  Star,
  Trash2,
  Upload,
  Download,
  Users,
  X,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { DEFAULT_UOMS, normalizeUomCode, normalizeUomLibrary, type UnitOfMeasure } from "@bidwright/domain";
import { cn } from "@/lib/utils";
import { SUPPORTED_LOCALES, localeDisplayName, normalizeLocale } from "@/lib/i18n";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  FadeIn,
  Input,
  Label,
  Select,
  Separator,
  Textarea,
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
import { OrganizationImportExportPage } from "@/components/organization-import-export-page";
import { FactorParameterEditor } from "@/components/workspace/factor-parameter-editor";
import {
  CALCULATION_TYPE_OPTIONS,
  getCalculationPreset,
  getCalculationTypeOption,
} from "@/lib/entity-category-calculation";
import {
  CURRENCIES,
  DATA_SUBTABS,
  DATE_FORMATS,
  DEFAULT_BRAND,
  DEFAULT_SETTINGS,
  GROUPS,
  INTEGRATIONS_SUBTABS,
  MONTHS,
  ORG_SUBTABS,
  PROVIDER_CONFIG,
  STORAGE_KEY,
  TIMEZONES,
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
  reorderEntityCategories as apiReorderCategories,
  getDepartments as apiGetDepartments,
  createDepartment as apiCreateDepartment,
  updateDepartment as apiUpdateDepartment,
  deleteDepartment as apiDeleteDepartment,
  type AppSettingsRecord,
  type BrandProfile,
  type CalculationType,
  type EntityCategory,
  type Department,
  testProviderKey as apiTestProviderKey,
  fetchProviderModels as apiFetchProviderModels,
  listEstimateFactorLibraryEntries as apiListEstimateFactorLibraryEntries,
  createEstimateFactorLibraryEntry as apiCreateEstimateFactorLibraryEntry,
  updateEstimateFactorLibraryEntry as apiUpdateEstimateFactorLibraryEntry,
  deleteEstimateFactorLibraryEntry as apiDeleteEstimateFactorLibraryEntry,
  type CreateEstimateFactorInput,
  type DatasetRecord,
  type EstimatorPersona,
  type EstimateFactorConfidence,
  type EstimateFactorApplicationScope,
  type EstimateFactorFormulaType,
  type EstimateFactorScope,
  type EstimateFactorImpact,
  type EstimateFactorLibraryRecord,
  type EstimateFactorSourceType,
  listPersonas as apiListPersonas,
  createPersona as apiCreatePersona,
  updatePersona as apiUpdatePersona,
  deletePersona as apiDeletePersona,
  listKnowledgeBooks as apiListKnowledgeBooks,
  listKnowledgeDocuments as apiListKnowledgeDocuments,
  type KnowledgeBookRecord,
  type KnowledgeDocumentRecord,
  type AuthUser,
} from "@/lib/api";
import { useAuth } from "@/components/auth-provider";
import { PluginsPage } from "@/components/plugins-page";
import { IntegrationsPage } from "@/components/integrations/integrations-page";
import { ConditionLibraryManager } from "@/components/condition-library-manager";
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
import { setCachedUoms } from "@/components/shared/uom-select";

const AZURE_DI_MODEL_OPTIONS = [
  { value: "prebuilt-layout", label: "Layout" },
  { value: "prebuilt-read", label: "Read" },
  { value: "prebuilt-invoice", label: "Invoice" },
  { value: "prebuilt-contract", label: "Contract" },
  { value: "prebuilt-document", label: "Document (legacy)" },
] as const;

const AZURE_DI_FEATURE_OPTIONS: MultiSelectOption[] = [
  { value: "keyValuePairs", label: "Key-value pairs", description: "General form fields" },
  { value: "queryFields", label: "Query fields", description: "Named fields without training" },
  { value: "ocrHighResolution", label: "High-res OCR", description: "Small text and drawings" },
  { value: "barcodes", label: "Barcodes", description: "Barcode detection" },
  { value: "languages", label: "Languages", description: "Language detection" },
  { value: "formulas", label: "Formulas", description: "Math notation" },
  { value: "styleFont", label: "Font/style", description: "Font properties" },
];

// ── Main Component ───────────────────────────────────────────────────────────

function resolveSettingsNavigation(tabParam: string | null, groupParam: string | null) {
  const validGroups: SettingsGroup[] = ["organization", "data", "importExport", "integrations", "users"];
  const dataTabAliases: Record<string, DataSubTab> = {
    categories: "categories",
    units: "uoms",
    uoms: "uoms",
    conditions: "conditions",
    factors: "factors",
  };
  const removedLibraryTabs = new Set(["items", "catalogs", "assemblies", "rates", "resource-catalog", "cost-database"]);

  const orgTabs = new Set<OrgSubTab>(ORG_SUBTABS.map((tab) => tab.id));
  const integrationTabs = new Set<IntegrationsSubTab>(INTEGRATIONS_SUBTABS.map((tab) => tab.id));
  const dataTab = tabParam ? dataTabAliases[tabParam] : undefined;
  const orgTab = tabParam && orgTabs.has(tabParam as OrgSubTab) ? (tabParam as OrgSubTab) : undefined;
  const integrationTab = tabParam && integrationTabs.has(tabParam as IntegrationsSubTab) ? (tabParam as IntegrationsSubTab) : undefined;
  const removedLibraryTab = tabParam ? removedLibraryTabs.has(tabParam) : false;

  const groupFromParam = validGroups.includes(groupParam as SettingsGroup) ? (groupParam as SettingsGroup) : undefined;
  const importExportAliases = new Set(["import-export", "import_export", "importExport", "import", "export", "migration"]);
  const groupFromTabParam = validGroups.includes(tabParam as SettingsGroup)
    ? (tabParam as SettingsGroup)
    : tabParam && importExportAliases.has(tabParam)
      ? "importExport"
      : undefined;
  const group: SettingsGroup = groupFromParam ?? (dataTab || removedLibraryTab ? "data" : orgTab ? "organization" : integrationTab ? "integrations" : groupFromTabParam ?? "organization");

  return {
    group,
    orgSubTab: orgTab ?? "general",
    dataSubTab: dataTab ?? "categories",
    integrationsSubTab: integrationTab ?? "email",
  };
}

export function SettingsPage({
  initialPlugins = [],
  initialDatasets = [],
}: {
  initialPlugins?: any[];
  initialDatasets?: DatasetRecord[];
} = {}) {
  const t = useTranslations("Settings");
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const groupParam = searchParams.get("group");
  const initialNavigation = resolveSettingsNavigation(tabParam, groupParam);
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>(initialNavigation.group);
  const [orgSubTab, setOrgSubTab] = useState<OrgSubTab>(initialNavigation.orgSubTab);
  const [dataSubTab, setDataSubTab] = useState<DataSubTab>(initialNavigation.dataSubTab);
  const [integrationsSubTab, setIntegrationsSubTab] = useState<IntegrationsSubTab>(initialNavigation.integrationsSubTab);
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
  const [pluginEntityCategories, setPluginEntityCategories] = useState<EntityCategory[]>([]);

  // Integrations
  const [keyTestStatus, setKeyTestStatus] = useState<{ loading: boolean; result?: { success: boolean; message: string } }>({ loading: false });
  const [providerModels, setProviderModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Departments
  const [departments, setDepartments] = useState<Department[]>([]);
  const [expandedDeptId, setExpandedDeptId] = useState<string | null>(null);
  const [deptEdits, setDeptEdits] = useState<Record<string, Partial<Department>>>({});
  const [deptSaving, setDeptSaving] = useState<string | null>(null);
  const [deptDeleteConfirm, setDeptDeleteConfirm] = useState<string | null>(null);

  // Personas
  const [personas, setPersonas] = useState<EstimatorPersona[]>([]);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [personaEdits, setPersonaEdits] = useState<Record<string, Partial<EstimatorPersona>>>({});
  const [personaDeleteConfirm, setPersonaDeleteConfirm] = useState<string | null>(null);
  const [knowledgeBooks, setKnowledgeBooks] = useState<KnowledgeBookRecord[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocumentRecord[]>([]);

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

  const { user: currentUser, organization: currentOrganization, setOrganizationLanguage } = useAuth();

  useEffect(() => {
    const next = resolveSettingsNavigation(tabParam, groupParam);
    setActiveGroup(next.group);
    setOrgSubTab(next.orgSubTab);
    setDataSubTab(next.dataSubTab);
    setIntegrationsSubTab(next.integrationsSubTab);
  }, [groupParam, tabParam]);

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

  useEffect(() => {
    // Load settings from API
    apiGetSettings()
      .then((apiSettings) => {
        setSettings((prev) => ({
          general: {
            ...prev.general,
            language: normalizeLocale(apiSettings.general.language ?? currentOrganization?.language ?? prev.general.language),
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
            uoms: normalizeUomLibrary(apiSettings.defaults.uoms),
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
            documentExtractionProvider: (apiSettings.integrations as any).documentExtractionProvider || prev.integrations.documentExtractionProvider,
            azureDiModel: (apiSettings.integrations as any).azureDiModel || prev.integrations.azureDiModel,
            azureDiFeatures: Array.isArray((apiSettings.integrations as any).azureDiFeatures)
              ? (apiSettings.integrations as any).azureDiFeatures
              : prev.integrations.azureDiFeatures,
            azureDiQueryFields: (apiSettings.integrations as any).azureDiQueryFields ?? prev.integrations.azureDiQueryFields,
            azureDiOutputFormat: (apiSettings.integrations as any).azureDiOutputFormat || prev.integrations.azureDiOutputFormat,
            agentRuntime: (apiSettings.integrations as any).agentRuntime || prev.integrations.agentRuntime,
            agentModel: (apiSettings.integrations as any).agentModel || prev.integrations.agentModel,
            agentReasoningEffort: (apiSettings.integrations as any).agentReasoningEffort || prev.integrations.agentReasoningEffort,
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
              defaults: { ...prev.defaults, ...parsed.defaults, uoms: normalizeUomLibrary(parsed.defaults?.uoms) },
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

  // Keep plugin authoring supplied with the org category schema.
  useEffect(() => {
    apiGetCategories().then(setPluginEntityCategories).catch(() => {});
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
      apiListKnowledgeDocuments().then(setKnowledgeDocuments).catch(() => {});
    }
  }, [activeGroup, orgSubTab]);

  // Conditions library is owned by ConditionLibraryManager (own state, own
  // fetch, own drawer). No state lives on the settings page.

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
      systemPrompt: "", knowledgeBookIds: [], knowledgeDocumentIds: [], datasetTags: [], packageBuckets: [],
      defaultAssumptions: {}, productivityGuidance: {}, commercialGuidance: {}, reviewFocusAreas: [], isDefault: false,
      enabled: true, order: personas.length, createdAt: "", updatedAt: "",
    };
    setPersonas((prev) => [...prev, newPersona]);
    setEditingPersonaId(tempId);
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
      } else {
        const updated = await apiUpdatePersona(persona.id, merged);
        setPersonas((prev) => prev.map((p) => (p.id === persona.id ? updated : p)));
        setPersonaEdits((prev) => { const n = { ...prev }; delete n[persona.id]; return n; });
      }
      setEditingPersonaId(null);
    } catch { /* keep edits, leave drawer open so user can retry */ }
  }, [personaEdits]);

  const deletePersonaById = useCallback(async (id: string) => {
    try {
      if (!id.startsWith("new-")) await apiDeletePersona(id);
      setPersonas((prev) => prev.filter((p) => p.id !== id));
      setPersonaEdits((prev) => { const n = { ...prev }; delete n[id]; return n; });
      if (editingPersonaId === id) setEditingPersonaId(null);
    } catch { /* keep */ } finally { setPersonaDeleteConfirm(null); }
  }, [editingPersonaId]);

  const togglePersonaEnabled = useCallback(async (persona: EstimatorPersona, enabled: boolean) => {
    setPersonas((prev) => prev.map((p) => (p.id === persona.id ? { ...p, enabled } : p)));
    if (!persona.id.startsWith("new-")) {
      try { await apiUpdatePersona(persona.id, { enabled }); } catch { /* revert silently */ }
    }
  }, []);

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    const apiPayload: Partial<AppSettingsRecord> = {
      general: {
        language: settings.general.language,
      } as AppSettingsRecord["general"],
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
        uoms: normalizeUomLibrary(settings.defaults.uoms),
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
        documentExtractionProvider: settings.integrations.documentExtractionProvider,
        azureDiModel: settings.integrations.azureDiModel,
        azureDiFeatures: settings.integrations.azureDiFeatures,
        azureDiQueryFields: settings.integrations.azureDiQueryFields,
        azureDiOutputFormat: settings.integrations.azureDiOutputFormat,
        agentRuntime: (settings.integrations as any).agentRuntime ?? null,
        agentModel: (settings.integrations as any).agentModel ?? null,
        agentReasoningEffort: (settings.integrations as any).agentReasoningEffort ?? "extra_high",
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

  useEffect(() => {
    setCachedUoms(settings.defaults.uoms, currentOrganization?.id);
  }, [currentOrganization?.id, settings.defaults.uoms]);

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

  const updateGeneral = (patch: Partial<GeneralSettings>) => {
    if (patch.language) setOrganizationLanguage(patch.language);
    setSettings((s) => ({ ...s, general: { ...s.general, ...patch } }));
  };
  const updateEmail = (patch: Partial<EmailSettings>) =>
    setSettings((s) => ({ ...s, email: { ...s.email, ...patch } }));
  const updateDefaults = (patch: Partial<DefaultSettings>) =>
    setSettings((s) => ({ ...s, defaults: { ...s.defaults, ...patch } }));
  const uomLibrary = useMemo(() => normalizeUomLibrary(settings.defaults.uoms), [settings.defaults.uoms]);
  const updateUomLibrary = useCallback(
    (uoms: UnitOfMeasure[]) => updateDefaults({ uoms: normalizeUomLibrary(uoms) }),
    [],
  );
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
            <h1 className="text-lg font-semibold text-fg">{t("title")}</h1>
            <p className="text-xs text-fg/50">{t("subtitle")}</p>
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
                {t(`groups.${group.key}`)}
              </button>
            );
          })}
        </div>
      </FadeIn>

      {/* Tab content */}
      <FadeIn delay={0.1} className="space-y-5">
          {activeGroup === "organization" && (
            <div className="flex items-center gap-1 shrink-0">
              {ORG_SUBTABS.map((tab) => {
                const active = orgSubTab === tab.id;
                return (
                  <button key={tab.id} onClick={() => setOrgSubTab(tab.id)} className={cn("px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap", active ? "bg-panel2 text-fg" : "text-fg/40 hover:text-fg/60")}>{t(`orgTabs.${tab.id}`)}</button>
                );
              })}
            </div>
          )}
          {activeGroup === "organization" && orgSubTab === "general" && (
            <div className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("localizationTitle")}</CardTitle>
                    <CardDescription>{t("localizationDescription")}</CardDescription>
                  </CardHeader>
                  <CardBody>
                    <div className="max-w-md">
                      <Label>{t("language")}</Label>
                      <Select
                        value={settings.general.language}
                        onValueChange={(v) => updateGeneral({ language: normalizeLocale(v) })}
                        options={SUPPORTED_LOCALES.map((locale) => ({ value: locale.code, label: localeDisplayName(locale.code) }))}
                      />
                    </div>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t("regionalTitle")}</CardTitle>
                    <CardDescription>{t("regionalDescription")}</CardDescription>
                  </CardHeader>
                  <CardBody>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <Label>{t("timezone")}</Label>
                        <Select
                          value={settings.general.timezone}
                          onValueChange={(v) => updateGeneral({ timezone: v })}
                          options={TIMEZONES.map((tz) => ({ value: tz, label: tz.replace(/_/g, " ") }))}
                        />
                      </div>
                      <div>
                        <Label>{t("currency")}</Label>
                        <Select
                          value={settings.general.currency}
                          onValueChange={(v) => updateGeneral({ currency: v })}
                          options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                        />
                      </div>
                      <div>
                        <Label>{t("dateFormat")}</Label>
                        <Select
                          value={settings.general.dateFormat}
                          onValueChange={(v) => updateGeneral({ dateFormat: v })}
                          options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
                        />
                      </div>
                    </div>
                  </CardBody>
                </Card>
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle>{t("fiscalTitle")}</CardTitle>
                    <CardDescription>{t("fiscalDescription")}</CardDescription>
                  </CardHeader>
                  <CardBody>
                    <div className="max-w-xs">
                      <Label>{t("fiscalYearStart")}</Label>
                      <Select
                        value={String(settings.general.fiscalYearStart)}
                        onValueChange={(v) => updateGeneral({ fiscalYearStart: parseInt(v, 10) })}
                        options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                      />
                    </div>
                  </CardBody>
                </Card>
              </div>
            </div>
          )}

          {activeGroup === "organization" && orgSubTab === "brand" && (
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>Brand Capture</CardTitle>
                </CardHeader>
                <CardBody className="space-y-4">
                  <p className="text-xs text-fg/50">
                    Enter your website URL and we'll automatically extract your brand identity using AI-powered analysis.
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
                    <Select
                      value={settings.defaults.defaultBreakoutStyle}
                      onValueChange={(v) => updateDefaults({ defaultBreakoutStyle: v })}
                      options={[
                        { value: "category", label: "By Category" },
                        { value: "phase", label: "By Phase" },
                        { value: "worksheet", label: "By Worksheet" },
                        { value: "flat", label: "Flat (No Breakout)" },
                      ]}
                    />
                  </div>
                  <div>
                    <Label>Default Quote Type</Label>
                    <Select
                      value={settings.defaults.defaultQuoteType}
                      onValueChange={(v) => updateDefaults({ defaultQuoteType: v })}
                      options={[
                        { value: "Firm", label: "Firm" },
                        { value: "Budget", label: "Budget" },
                        { value: "BudgetDNE", label: "Budget DNE" },
                      ]}
                    />
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
                          <Select
                            className="h-7 text-xs"
                            size="xs"
                            value={user.role}
                            onValueChange={(v) => { const role = v as UserRecord["role"]; updateUserLocal(user.id, { role }); saveUser({ ...user, role }); }}
                            options={[
                              { value: "Estimator", label: "Estimator" },
                              { value: "Admin", label: "Admin" },
                              { value: "Viewer", label: "Viewer" },
                            ]}
                          />
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
                      onValueChange={(v) => {
                        updateIntegrations({ llmProvider: v, llmModel: "" });
                        setKeyTestStatus({ loading: false });
                        setProviderModels([]);
                      }}
                      options={Object.entries(PROVIDER_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))}
                    />
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
                    <p className="text-[10px] text-fg/40 mb-3">Primary extraction for PDFs, Office files, images, HTML, structured tables, and form key-value pairs.</p>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>Document extraction</Label>
                          <Select
                            value={settings.integrations.documentExtractionProvider}
                            onValueChange={(value) => updateIntegrations({ documentExtractionProvider: value as IntegrationSettings["documentExtractionProvider"] })}
                            options={[
                              { value: "azure", label: "Azure first" },
                              { value: "auto", label: "Auto fallback" },
                              { value: "local", label: "Local only" },
                            ]}
                          />
                        </div>
                        <div>
                          <Label>Azure model</Label>
                          <Select
                            value={settings.integrations.azureDiModel}
                            onValueChange={(value) => updateIntegrations({ azureDiModel: value as IntegrationSettings["azureDiModel"] })}
                            options={[...AZURE_DI_MODEL_OPTIONS]}
                          />
                        </div>
                      </div>
                      <div>
                        <Label>Analysis features</Label>
                        <MultiSelect
                          selected={settings.integrations.azureDiFeatures ?? ["keyValuePairs"]}
                          onChange={(azureDiFeatures) => updateIntegrations({ azureDiFeatures: azureDiFeatures as IntegrationSettings["azureDiFeatures"] })}
                          options={AZURE_DI_FEATURE_OPTIONS}
                          placeholder="Select v4 features..."
                        />
                      </div>
                      <div>
                        <Label>Content format</Label>
                        <Select
                          value={settings.integrations.azureDiOutputFormat}
                          onValueChange={(value) => updateIntegrations({ azureDiOutputFormat: value as IntegrationSettings["azureDiOutputFormat"] })}
                          options={[
                            { value: "text", label: "Text" },
                            { value: "markdown", label: "Markdown" },
                          ]}
                        />
                      </div>
                      {(settings.integrations.azureDiFeatures ?? []).includes("queryFields") && (
                        <div>
                          <Label>Query fields</Label>
                          <Textarea
                            rows={2}
                            value={settings.integrations.azureDiQueryFields}
                            onChange={(e) => updateIntegrations({ azureDiQueryFields: e.target.value })}
                            placeholder="ProjectNumber, BidDueDate, Owner, Architect"
                          />
                        </div>
                      )}
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
          {activeGroup === "data" && dataSubTab === "uoms" && (
            <UomSettingsPanel uoms={uomLibrary} onChange={updateUomLibrary} />
          )}
          {activeGroup === "data" && dataSubTab === "categories" && (
            <EntityCategorySettingsPanel
              uoms={uomLibrary}
              onCategoriesChange={setPluginEntityCategories}
            />
          )}

          {activeGroup === "importExport" && (
            <OrganizationImportExportPage
              organizationName={currentOrganization?.name}
              settings={settings}
              brand={brand}
              users={settings.users}
              datasets={initialDatasets}
            />
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
                    No departments yet. Click "Add Department" to get started.
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
                    No personas yet. Click "Add Persona" to get started.
                  </div>
                )}
                {personas.map((persona) => {
                  const edited = getPersonaEdit(persona);
                  const isActive = editingPersonaId === persona.id;
                  return (
                    <div key={persona.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setEditingPersonaId(persona.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingPersonaId(persona.id); } }}
                        className={cn(
                          "flex w-full items-center gap-3 px-5 py-3 text-left text-sm transition-colors cursor-pointer",
                          isActive ? "bg-panel2" : "hover:bg-panel2",
                        )}
                      >
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
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── Persona Edit Drawer ─────────────────────────────────── */}
          {activeGroup === "organization" && orgSubTab === "personas" && typeof document !== "undefined" && createPortal(
            <AnimatePresence>
              {(() => {
                const persona = editingPersonaId ? personas.find((p) => p.id === editingPersonaId) : null;
                if (!persona) return null;
                const edited = getPersonaEdit(persona);
                const defaultAssumptions = parsePersonaJsonField((edited as any).defaultAssumptions);
                const productivityGuidance = parsePersonaJsonField((edited as any).productivityGuidance);
                const commercialGuidance = parsePersonaJsonField((edited as any).commercialGuidance);
                const supervisionGuidance = parsePersonaJsonField(productivityGuidance.supervision);
                const packagingGuidance = parsePersonaJsonField(commercialGuidance.packaging);
                return (
                  <>
                    <motion.div
                      key="persona-drawer-backdrop"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 z-40 bg-black/20"
                      onClick={() => setEditingPersonaId(null)}
                    />
                    <motion.div
                      key="persona-drawer"
                      initial={{ x: "100%" }}
                      animate={{ x: 0 }}
                      exit={{ x: "100%" }}
                      transition={{ type: "spring", damping: 30, stiffness: 300 }}
                      className="fixed inset-y-0 right-0 z-50 w-[640px] max-w-[100vw] bg-panel border-l border-line shadow-2xl flex flex-col"
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2 px-5 py-4 border-b border-line bg-panel2/40">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-semibold truncate">{edited.name || "Untitled persona"}</span>
                          {edited.trade && (
                            <Badge className={cn("text-[10px] shrink-0", TRADE_COLORS[edited.trade] || "")}>
                              {edited.trade}
                            </Badge>
                          )}
                          {edited.isDefault && <Star className="h-3.5 w-3.5 text-yellow-400 fill-yellow-400 shrink-0" />}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {personaDeleteConfirm === persona.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-danger">Delete?</span>
                              <Button variant="danger" size="xs" onClick={() => deletePersonaById(persona.id)}>Confirm</Button>
                              <Button variant="secondary" size="xs" onClick={() => setPersonaDeleteConfirm(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setPersonaDeleteConfirm(persona.id)}
                              className="p-1.5 rounded hover:bg-danger/10 text-fg/40 hover:text-danger transition-colors"
                              title="Delete persona"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            className="p-1.5 rounded hover:bg-panel2/60 text-fg/40 hover:text-fg/70 transition-colors"
                            onClick={() => setEditingPersonaId(null)}
                            title="Close"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Body */}
                      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Name</Label>
                              <Input value={edited.name} onChange={(e) => updatePersonaEdit(persona.id, { name: e.target.value })} placeholder="Persona name" />
                            </div>
                            <div>
                              <Label>Trade</Label>
                              <Select
                                value={edited.trade}
                                onValueChange={(v) => updatePersonaEdit(persona.id, { trade: v })}
                                options={TRADE_OPTIONS.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
                              />
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
                              <Label>Priority Knowledge Pages</Label>
                              <p className="text-[10px] text-fg/30 mb-1.5">Manual notes and pasted table pages to prioritize</p>
                              <MultiSelect
                                options={knowledgeDocuments
                                  .filter((d) => d.status === "indexed" || d.status === "draft")
                                  .map((d) => ({
                                    value: d.id,
                                    label: d.title,
                                    description: `${d.category} · ${d.pageCount} pages · ${(d.tags || []).join(", ")}`,
                                  }))}
                                selected={edited.knowledgeDocumentIds || []}
                                onChange={(ids) => updatePersonaEdit(persona.id, { knowledgeDocumentIds: ids })}
                                placeholder="Select knowledge pages..."
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
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
                                    onValueChange={(v) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "productivityGuidance",
                                      (edited as any).productivityGuidance,
                                      "supervision",
                                      { coverageMode: v },
                                    )}
                                    options={[
                                      { value: "single_source", label: "Single source only" },
                                      { value: "embedded", label: "Embedded in packages" },
                                      { value: "general_conditions", label: "General Conditions" },
                                      { value: "hybrid", label: "Hybrid split" },
                                    ]}
                                  />
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
                                    onValueChange={(v) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "commercialGuidance",
                                      (edited as any).commercialGuidance,
                                      "packaging",
                                      { weakEvidencePricingMode: v },
                                    )}
                                    options={[
                                      { value: "allowance", label: "Allowance" },
                                      { value: "subcontract", label: "Subcontract" },
                                      { value: "historical_allowance", label: "Historical allowance" },
                                      { value: "detailed", label: "Detailed takeoff" },
                                    ]}
                                  />
                                </div>
                                <div>
                                  <Label>Shop Fabrication Pricing Mode</Label>
                                  <Select
                                    value={String(packagingGuidance.shopFabricationPricingMode ?? "detailed")}
                                    onValueChange={(v) => patchPersonaNestedJsonField(
                                      persona.id,
                                      "commercialGuidance",
                                      (edited as any).commercialGuidance,
                                      "packaging",
                                      { shopFabricationPricingMode: v },
                                    )}
                                    options={[
                                      { value: "detailed", label: "Detailed takeoff" },
                                      { value: "subcontract", label: "Subcontract" },
                                      { value: "historical_allowance", label: "Historical allowance" },
                                      { value: "allowance", label: "Allowance" },
                                    ]}
                                  />
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
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-panel2/40">
                        <Button variant="secondary" size="sm" onClick={() => setEditingPersonaId(null)}>
                          Cancel
                        </Button>
                        <Button variant="accent" size="sm" onClick={() => savePersona(persona)}>
                          Save
                        </Button>
                      </div>
                    </motion.div>
                  </>
                );
              })()}
            </AnimatePresence>,
            document.body,
          )}

          {/* ── Conditions Library (unified table + pill filters + drawer) ─── */}
          {activeGroup === "data" && dataSubTab === "conditions" && (
            <ConditionLibraryManager />
          )}

          {/* ── Factors ─── */}
          {activeGroup === "data" && dataSubTab === "factors" && (
            <FactorLibraryManager />
          )}

          {/* ── Agent Runtime ─── */}
          {activeGroup === "integrations" && integrationsSubTab === "agent" && (
            <AgentRuntimeSettings settings={settings} onUpdate={(patch) => setSettings((prev) => ({ ...prev, integrations: { ...prev.integrations, ...patch } }))} onUpdateDefaults={updateDefaults} />
          )}

          {/* ── Plugins ─── */}
          {activeGroup === "integrations" && integrationsSubTab === "plugins" && (
            <PluginsPage initialPlugins={initialPlugins} initialDatasets={initialDatasets} entityCategories={pluginEntityCategories} />
          )}

          {/* ── Integrations (NetSuite, Procore, Slack, QuickBooks, Custom REST...) ─── */}
          {activeGroup === "integrations" && integrationsSubTab === "integrations" && (
            <IntegrationsPage />
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

const ENTITY_CATEGORY_CALCULATION_OPTIONS = CALCULATION_TYPE_OPTIONS.map(({ value, label }) => ({ value, label }));

const ENTITY_CATEGORY_ITEM_SOURCE_OPTIONS: Array<{ value: EntityCategory["itemSource"]; label: string; description: string }> = [
  { value: "freeform", label: "Freeform", description: "Estimator-entered rows that are not forced through a library source." },
  { value: "rate_schedule", label: "Ratebook", description: "Rows are selected from rate schedules and priced from tiers." },
  { value: "catalog", label: "Catalog", description: "Rows are selected from catalog resources and priced from catalog data." },
];

const ENTITY_CATEGORY_ANALYTICS_BUCKET_OPTIONS = [
  { value: "", label: "No roll-up bucket" },
  { value: "labour", label: "Labour" },
  { value: "material", label: "Material" },
  { value: "equipment", label: "Equipment" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "allowance", label: "Allowance" },
];

const ENTITY_CATEGORY_EDITABLE_FIELDS: Array<{ key: keyof EntityCategory["editableFields"]; label: string }> = [
  { key: "quantity", label: "Quantity" },
  { key: "cost", label: "Cost" },
  { key: "markup", label: "Markup" },
  { key: "price", label: "Price" },
  { key: "tierUnits", label: "Tier units" },
];

const NEW_ENTITY_CATEGORY_TEMPLATE: Omit<EntityCategory, "id"> = {
  name: "",
  entityType: "",
  shortform: "",
  defaultUom: "EA",
  validUoms: ["EA"],
  editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: false },
  unitLabels: {},
  calculationType: "manual",
  calcFormula: "",
  itemSource: "freeform",
  catalogId: null,
  analyticsBucket: null,
  color: "#6366f1",
  order: 999,
  isBuiltIn: false,
  enabled: true,
};

type EntityCategoryDrawer =
  | { mode: "create"; category: EntityCategory }
  | { mode: "edit"; category: EntityCategory };

function sortEntityCategories(categories: EntityCategory[]) {
  return [...categories].sort((a, b) => {
    const order = (a.order ?? 0) - (b.order ?? 0);
    return order !== 0 ? order : a.name.localeCompare(b.name);
  });
}

function cloneEntityCategory(category: EntityCategory): EntityCategory {
  return {
    ...category,
    validUoms: [...(category.validUoms ?? [])],
    editableFields: { ...category.editableFields },
    unitLabels: { ...(category.unitLabels ?? {}) },
  };
}

function buildNewEntityCategory(order: number): EntityCategory {
  return {
    ...cloneEntityCategory({ ...NEW_ENTITY_CATEGORY_TEMPLATE, id: `new-${Date.now()}`, order }),
    validUoms: [...NEW_ENTITY_CATEGORY_TEMPLATE.validUoms],
    editableFields: { ...NEW_ENTITY_CATEGORY_TEMPLATE.editableFields },
    unitLabels: { ...NEW_ENTITY_CATEGORY_TEMPLATE.unitLabels },
  };
}

function normalizeCategoryForSave(category: EntityCategory): EntityCategory {
  const defaultUom = normalizeUomCode(category.defaultUom) || "EA";
  const validUoms = Array.from(
    new Set([defaultUom, ...(category.validUoms ?? []).map(normalizeUomCode)].filter(Boolean)),
  );
  const itemSource = category.itemSource ?? "freeform";
  return {
    ...category,
    name: category.name.trim(),
    entityType: category.entityType.trim(),
    shortform: category.shortform.trim().slice(0, 4).toUpperCase(),
    defaultUom,
    validUoms,
    editableFields: {
      quantity: Boolean(category.editableFields?.quantity),
      cost: Boolean(category.editableFields?.cost),
      markup: Boolean(category.editableFields?.markup),
      price: Boolean(category.editableFields?.price),
      tierUnits: Boolean(category.editableFields?.tierUnits),
    },
    unitLabels: { ...(category.unitLabels ?? {}) },
    calculationType: category.calculationType,
    calcFormula: category.calcFormula.trim(),
    itemSource,
    catalogId: itemSource === "catalog" ? category.catalogId ?? null : null,
    analyticsBucket: category.analyticsBucket?.trim() || null,
    color: category.color.trim() || "#6b7280",
  };
}

function EntityCategorySettingsPanel({
  uoms,
  onCategoriesChange,
}: {
  uoms: UnitOfMeasure[];
  onCategoriesChange?: (categories: EntityCategory[]) => void;
}) {
  const [categories, setCategories] = useState<EntityCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<EntityCategoryDrawer | null>(null);
  const [draft, setDraft] = useState<EntityCategory | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const uomOptions = useMemo<MultiSelectOption[]>(() => {
    const normalized = normalizeUomLibrary(uoms).filter((unit) => unit.active);
    return normalized.map((unit) => ({
      value: unit.code,
      label: unit.label ? `${unit.code} · ${unit.label}` : unit.code,
      description: unit.description,
    }));
  }, [uoms]);

  const publishCategories = useCallback((nextCategories: EntityCategory[]) => {
    const sorted = sortEntityCategories(nextCategories);
    setCategories(sorted);
    onCategoriesChange?.(sorted);
  }, [onCategoriesChange]);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiGetCategories();
      publishCategories(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, [publishCategories]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  const openCreateDrawer = () => {
    const category = buildNewEntityCategory(categories.length);
    setDrawer({ mode: "create", category });
    setDraft(category);
    setDeleteConfirmId(null);
    setError(null);
  };

  const openEditDrawer = (category: EntityCategory) => {
    const copy = cloneEntityCategory(category);
    setDrawer({ mode: "edit", category });
    setDraft(copy);
    setDeleteConfirmId(null);
    setError(null);
  };

  const updateDraft = (patch: Partial<EntityCategory>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const updateEditableField = (key: keyof EntityCategory["editableFields"], value: boolean) => {
    setDraft((current) => current ? {
      ...current,
      editableFields: { ...current.editableFields, [key]: value },
    } : current);
  };

  const applyCalculationPreset = () => {
    setDraft((current) => {
      if (!current) return current;
      const preset = getCalculationPreset(current.calculationType);
      return {
        ...current,
        editableFields: { ...current.editableFields, ...preset.editableFields },
        unitLabels: { ...current.unitLabels, ...preset.unitLabels },
      };
    });
  };

  const saveCategory = async () => {
    if (!drawer || !draft) return;
    const payload = normalizeCategoryForSave(draft);
    if (!payload.name || !payload.entityType) {
      setError("Name and entity type are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = drawer.mode === "create"
        ? await apiCreateCategory(payload)
        : await apiUpdateCategory(drawer.category.id, payload);
      publishCategories([saved, ...categories.filter((category) => category.id !== drawer.category.id && category.id !== saved.id)]);
      setDrawer(null);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  const toggleCategoryEnabled = async (category: EntityCategory, enabled: boolean) => {
    const previous = categories;
    publishCategories(categories.map((candidate) => candidate.id === category.id ? { ...candidate, enabled } : candidate));
    setError(null);
    try {
      const saved = await apiUpdateCategory(category.id, { enabled });
      publishCategories(categories.map((candidate) => candidate.id === category.id ? saved : candidate));
    } catch (cause) {
      publishCategories(previous);
      setError(cause instanceof Error ? cause.message : "Failed to update category");
    }
  };

  const moveCategory = async (category: EntityCategory, direction: -1 | 1) => {
    const sorted = sortEntityCategories(categories);
    const index = sorted.findIndex((candidate) => candidate.id === category.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return;
    const next = [...sorted];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    const reordered = next.map((candidate, order) => ({ ...candidate, order }));
    const previous = categories;
    publishCategories(reordered);
    setError(null);
    try {
      await apiReorderCategories(reordered.map((candidate) => candidate.id));
    } catch (cause) {
      publishCategories(previous);
      setError(cause instanceof Error ? cause.message : "Failed to reorder categories");
    }
  };

  const deleteCategory = async (category: EntityCategory) => {
    if (deleteConfirmId !== category.id) {
      setDeleteConfirmId(category.id);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiDeleteCategory(category.id);
      publishCategories(categories.filter((candidate) => candidate.id !== category.id));
      setDrawer(null);
      setDraft(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete category");
    } finally {
      setSaving(false);
      setDeleteConfirmId(null);
    }
  };

  const enabledCount = categories.filter((category) => category.enabled).length;
  const disabledCount = categories.length - enabledCount;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Entity Categories</CardTitle>
          <p className="mt-1 text-xs text-fg/45">
            Organization-level estimate schema for row behavior, pricing mode, units, and analytics roll-ups.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info" className="text-[10px]">{enabledCount} enabled</Badge>
          {disabledCount > 0 ? <Badge tone="default" className="text-[10px]">{disabledCount} disabled</Badge> : null}
          <Button variant="accent" size="xs" onClick={openCreateDrawer}>
            <Plus className="h-3.5 w-3.5" />
            Add Category
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {error ? <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div> : null}
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-fg/45">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading categories...
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-[minmax(190px,1.2fr)_130px_150px_130px_120px_86px_92px] gap-2 bg-panel2/60 px-3 py-2 text-[10px] font-medium uppercase text-fg/35">
              <div>Category</div>
              <div>Source</div>
              <div>Calculation</div>
              <div>Bucket</div>
              <div>Default UOM</div>
              <div>Status</div>
              <div />
            </div>
            {categories.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-fg/40">
                No categories configured. Add one to define how estimate rows behave.
              </div>
            ) : categories.map((category, index) => {
              const calculation = getCalculationTypeOption(category.calculationType);
              const source = ENTITY_CATEGORY_ITEM_SOURCE_OPTIONS.find((option) => option.value === category.itemSource);
              return (
                <div
                  key={category.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEditDrawer(category)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openEditDrawer(category);
                    }
                  }}
                  className="grid cursor-pointer grid-cols-[minmax(190px,1.2fr)_130px_150px_130px_120px_86px_92px] items-center gap-2 border-t border-line px-3 py-2 text-xs transition-colors hover:bg-panel2/40"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color || "#6b7280" }} />
                      <span className="truncate font-medium text-fg">{category.name || "Untitled"}</span>
                      {category.shortform ? <Badge className="shrink-0 text-[10px]">{category.shortform}</Badge> : null}
                    </div>
                    <div className="mt-1 truncate text-[10px] text-fg/40">{category.entityType || "No entity type"}</div>
                  </div>
                  <div className="truncate text-fg/55">{source?.label ?? category.itemSource}</div>
                  <div className="truncate text-fg/55">{calculation.label}</div>
                  <div className="truncate text-fg/55">{category.analyticsBucket || "-"}</div>
                  <div className="font-mono text-[11px] text-fg/55">{category.defaultUom}</div>
                  <div onClick={(event) => event.stopPropagation()}>
                    <Toggle checked={category.enabled} onChange={(checked) => toggleCategoryEnabled(category, checked)} />
                  </div>
                  <div className="flex items-center justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                    <Button variant="ghost" size="xs" className="h-7 px-2" disabled={index === 0 || saving} onClick={() => moveCategory(category, -1)} title="Move up">
                      <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                    </Button>
                    <Button variant="ghost" size="xs" className="h-7 px-2" disabled={index === categories.length - 1 || saving} onClick={() => moveCategory(category, 1)} title="Move down">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>

      {drawer && draft && typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          <motion.div
            key="entity-category-drawer-backdrop"
            className="fixed inset-0 z-40 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDrawer(null)}
          />
          <motion.aside
            key="entity-category-drawer-panel"
            className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[560px] flex-col border-l border-line bg-panel shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: draft.color || "#6b7280" }} />
                  <div className="truncate text-sm font-semibold text-fg">{drawer.mode === "edit" ? draft.name || "Edit Category" : "Create Category"}</div>
                </div>
                <div className="mt-1 truncate text-[11px] text-fg/45">{draft.entityType || "Organization estimate schema"}</div>
              </div>
              <button className="rounded p-1.5 text-fg/40 hover:bg-panel2 hover:text-fg" onClick={() => setDrawer(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name</Label>
                  <Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Labour" />
                </div>
                <div className="space-y-1.5">
                  <Label>Shortform</Label>
                  <Input
                    value={draft.shortform}
                    onChange={(event) => updateDraft({ shortform: event.target.value.slice(0, 4).toUpperCase() })}
                    placeholder="LAB"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Entity Type</Label>
                  <Input value={draft.entityType} onChange={(event) => updateDraft({ entityType: event.target.value })} placeholder="Labour" />
                </div>
                <ColorField label="Color" value={draft.color} onChange={(color) => updateDraft({ color })} />
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Item Source</Label>
                    <Select
                      value={draft.itemSource}
                      onValueChange={(itemSource) => updateDraft({ itemSource: itemSource as EntityCategory["itemSource"] })}
                      options={ENTITY_CATEGORY_ITEM_SOURCE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    />
                    <p className="text-[11px] text-fg/40">
                      {ENTITY_CATEGORY_ITEM_SOURCE_OPTIONS.find((option) => option.value === draft.itemSource)?.description}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Analytics Bucket</Label>
                    <Select
                      value={draft.analyticsBucket ?? ""}
                      onValueChange={(analyticsBucket) => updateDraft({ analyticsBucket: analyticsBucket || null })}
                      options={ENTITY_CATEGORY_ANALYTICS_BUCKET_OPTIONS}
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                  <div className="space-y-1.5">
                    <Label>Default UOM</Label>
                    <Select
                      value={draft.defaultUom}
                      onValueChange={(defaultUom) => updateDraft({ defaultUom, validUoms: Array.from(new Set([defaultUom, ...(draft.validUoms ?? [])])) })}
                      options={uomOptions.map((option) => ({ value: option.value, label: option.value }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Valid UOMs</Label>
                    <MultiSelect
                      options={uomOptions}
                      selected={draft.validUoms ?? []}
                      onChange={(validUoms) => updateDraft({ validUoms: Array.from(new Set([draft.defaultUom, ...validUoms])) })}
                      placeholder="Select valid units"
                    />
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase text-fg/60">Calculation</p>
                    <p className="mt-1 text-[11px] text-fg/40">{getCalculationTypeOption(draft.calculationType).description}</p>
                  </div>
                  <Button variant="secondary" size="xs" onClick={applyCalculationPreset}>Apply Preset</Button>
                </div>
                <Select
                  value={draft.calculationType}
                  onValueChange={(calculationType) => updateDraft({ calculationType: calculationType as CalculationType })}
                  options={ENTITY_CATEGORY_CALCULATION_OPTIONS}
                />
                {draft.calculationType === "formula" ? (
                  <div className="space-y-1.5">
                    <Label>Formula</Label>
                    <Input value={draft.calcFormula} onChange={(event) => updateDraft({ calcFormula: event.target.value })} placeholder="quantity * cost * (1 + markup)" />
                  </div>
                ) : null}
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase text-fg/60">Editable Fields</p>
                  <p className="mt-1 text-[11px] text-fg/40">Controls which columns estimators can edit for rows in this category.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {ENTITY_CATEGORY_EDITABLE_FIELDS.map((field) => (
                    <label key={field.key} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg/35 px-3 py-2 text-xs text-fg/75">
                      <span>{field.label}</span>
                      <Toggle checked={Boolean(draft.editableFields?.[field.key])} onChange={(checked) => updateEditableField(field.key, checked)} />
                    </label>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel2/35 px-3 py-2">
                <div>
                  <div className="text-xs font-medium text-fg">Enabled</div>
                  <div className="mt-0.5 text-[11px] text-fg/40">Disabled categories remain preserved but stop appearing as active estimate choices.</div>
                </div>
                <Toggle checked={draft.enabled} onChange={(enabled) => updateDraft({ enabled })} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
              <div>
                {drawer.mode === "edit" && !draft.isBuiltIn ? (
                  <Button variant={deleteConfirmId === drawer.category.id ? "danger" : "ghost"} size="sm" onClick={() => deleteCategory(drawer.category)} disabled={saving}>
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleteConfirmId === drawer.category.id ? "Confirm Delete" : "Delete"}
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setDrawer(null)} disabled={saving}>Cancel</Button>
                <Button variant="accent" size="sm" onClick={saveCategory} disabled={saving || !draft.name.trim() || !draft.entityType.trim()}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Save
                </Button>
              </div>
            </div>
          </motion.aside>
        </AnimatePresence>,
        document.body,
      )}
    </Card>
  );
}

const SETTINGS_FACTOR_IMPACT_OPTIONS: Array<{ value: EstimateFactorImpact; label: string }> = [
  { value: "labor_hours", label: "Labor hours" },
  { value: "resource_units", label: "Resource units" },
  { value: "direct_cost", label: "Direct cost" },
  { value: "sell_price", label: "Sell price" },
];

const SETTINGS_FACTOR_CONFIDENCE_OPTIONS: Array<{ value: EstimateFactorConfidence; label: string }> = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const SETTINGS_FACTOR_SOURCE_OPTIONS: Array<{ value: EstimateFactorSourceType; label: string }> = [
  { value: "knowledge", label: "Knowledge book" },
  { value: "library", label: "Library" },
  { value: "labor_unit", label: "Labor unit" },
  { value: "condition_difficulty", label: "Condition difficulty" },
  { value: "neca_difficulty", label: "Legacy condition difficulty" },
  { value: "agent", label: "Agent" },
  { value: "custom", label: "Custom" },
];

const SETTINGS_FACTOR_APPLICATION_SCOPE_OPTIONS: Array<{ value: EstimateFactorApplicationScope; label: string }> = [
  { value: "global", label: "Global" },
  { value: "line", label: "Line" },
  { value: "both", label: "Both" },
];

const SETTINGS_FACTOR_FORMULA_OPTIONS: Array<{ value: EstimateFactorFormulaType; label: string }> = [
  { value: "fixed_multiplier", label: "Fixed multiplier" },
  { value: "per_unit_scale", label: "Scaled input" },
  { value: "condition_score", label: "Condition score" },
  { value: "temperature_productivity", label: "Temperature productivity" },
  { value: "neca_condition_score", label: "Condition score sheet" },
  { value: "extended_duration", label: "Extended duration" },
];

const SETTINGS_FACTOR_SCOPE_OPTIONS = [
  { value: "all", label: "Entire estimate" },
  { value: "bucket:labour", label: "Labour bucket" },
  { value: "bucket:material", label: "Material bucket" },
  { value: "bucket:equipment", label: "Equipment bucket" },
  { value: "bucket:subcontract", label: "Subcontract bucket" },
];

type SettingsFactorDrawer =
  | { mode: "create" }
  | { mode: "edit"; entry: EstimateFactorLibraryRecord };

interface SettingsFactorDraft {
  name: string;
  code: string;
  description: string;
  category: string;
  impact: EstimateFactorImpact;
  percent: string;
  applicationScope: EstimateFactorApplicationScope;
  scopeValue: string;
  formulaType: EstimateFactorFormulaType;
  parameters: Record<string, unknown>;
  confidence: EstimateFactorConfidence;
  sourceType: EstimateFactorSourceType;
  sourceId: string;
  basis: string;
  locator: string;
  tags: string;
}

function settingsFactorPercent(value: number) {
  return Number.isFinite(value) ? (value - 1) * 100 : 0;
}

function settingsFactorMultiplier(percent: string) {
  const parsed = Number(percent);
  const safe = Number.isFinite(parsed) ? parsed : 0;
  return Math.max(0.05, Math.min(10, Math.round((1 + safe / 100) * 10_000) / 10_000));
}

function settingsFactorSourceText(sourceRef: Record<string, unknown> | undefined, key: string) {
  const value = sourceRef?.[key];
  return typeof value === "string" ? value : "";
}

function settingsFactorSourceLabel(value: EstimateFactorSourceType | string | undefined) {
  switch (value) {
    case "knowledge":
      return "Knowledge";
    case "library":
      return "Library";
    case "labor_unit":
      return "Labor unit";
    case "condition_difficulty":
    case "neca_difficulty":
      return "Condition difficulty";
    case "agent":
      return "Agent";
    default:
      return "Custom";
  }
}

function settingsFactorScopeValue(entry?: EstimateFactorLibraryRecord) {
  const scope = entry?.scope ?? {};
  if (Array.isArray(scope.analyticsBuckets) && scope.analyticsBuckets[0]) return `bucket:${scope.analyticsBuckets[0]}`;
  return "all";
}

function settingsFactorScope(scopeValue: string): { appliesTo: string; scope: EstimateFactorScope } {
  if (scopeValue.startsWith("bucket:")) {
    const bucket = scopeValue.slice("bucket:".length);
    return {
      appliesTo: bucket === "labour" ? "Labour" : bucket,
      scope: { mode: "category" as const, analyticsBuckets: [bucket, bucket === "labour" ? "labor" : bucket] },
    };
  }
  return { appliesTo: "Entire estimate", scope: { mode: "all" as const } };
}

function settingsFactorDraft(entry?: EstimateFactorLibraryRecord): SettingsFactorDraft {
  return {
    name: entry?.name ?? "Custom Factor",
    code: entry?.code ?? "CUSTOM",
    description: entry?.description ?? "",
    category: entry?.category ?? "Productivity",
    impact: entry?.impact ?? "labor_hours",
    percent: String(Math.round(settingsFactorPercent(entry?.value ?? 1) * 100) / 100),
    applicationScope: entry?.applicationScope ?? "both",
    scopeValue: settingsFactorScopeValue(entry),
    formulaType: entry?.formulaType ?? "fixed_multiplier",
    parameters: entry?.parameters ?? {},
    confidence: entry?.confidence ?? "medium",
    sourceType: entry?.sourceType ?? "custom",
    sourceId: entry?.sourceId ?? "",
    basis: settingsFactorSourceText(entry?.sourceRef, "basis"),
    locator: settingsFactorSourceText(entry?.sourceRef, "locator"),
    tags: (entry?.tags ?? ["custom"]).join(", "),
  };
}

function settingsFactorInput(draft: SettingsFactorDraft, baseSourceRef?: Record<string, unknown>): CreateEstimateFactorInput {
  const scoped = settingsFactorScope(draft.scopeValue);
  return {
    name: draft.name.trim() || "Factor",
    code: draft.code.trim(),
    description: draft.description.trim(),
    category: draft.category.trim() || "Productivity",
    impact: draft.impact,
    value: settingsFactorMultiplier(draft.percent),
    appliesTo: scoped.appliesTo,
    applicationScope: draft.applicationScope,
    scope: scoped.scope,
    formulaType: draft.formulaType,
    parameters: draft.parameters,
    confidence: draft.confidence,
    sourceType: draft.sourceType,
    sourceId: draft.sourceId.trim() || null,
    sourceRef: {
      ...(baseSourceRef ?? {}),
      ...(draft.basis.trim() ? { basis: draft.basis.trim() } : {}),
      ...(draft.locator.trim() ? { locator: draft.locator.trim() } : {}),
    },
    tags: draft.tags.split(",").map((entry) => entry.trim()).filter(Boolean),
  };
}

const FACTOR_LIBRARY_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function FactorLibraryManager() {
  const [entries, setEntries] = useState<EstimateFactorLibraryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drawer, setDrawer] = useState<SettingsFactorDrawer | null>(null);
  const [draft, setDraft] = useState<SettingsFactorDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [pageIndex, setPageIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await apiListEstimateFactorLibraryEntries());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load factor library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDraft(drawer?.mode === "edit" ? settingsFactorDraft(drawer.entry) : drawer ? settingsFactorDraft() : null);
  }, [drawer]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => `${entry.name} ${entry.code} ${entry.category} ${entry.description} ${entry.tags.join(" ")}`.toLowerCase().includes(needle));
  }, [entries, query]);

  const orgCount = entries.length;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize),
    [filtered, safePageIndex, pageSize],
  );

  // Reset to page 0 whenever search/page-size changes so users don't land on an empty page.
  useEffect(() => {
    setPageIndex(0);
  }, [query, pageSize]);

  async function saveDrawer() {
    if (!drawer || !draft) return;
    setSaving(true);
    setError(null);
    try {
      const base = drawer.mode === "edit" ? drawer.entry.sourceRef : {};
      const input = settingsFactorInput(draft, base);
      const saved = drawer.mode === "edit"
        ? await apiUpdateEstimateFactorLibraryEntry(drawer.entry.id, input)
        : await apiCreateEstimateFactorLibraryEntry(input);
      setEntries((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setDrawer(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save factor");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry: EstimateFactorLibraryRecord) {
    if (!window.confirm(`Delete ${entry.name}?`)) return;
    setSaving(true);
    setError(null);
    try {
      await apiDeleteEstimateFactorLibraryEntry(entry.id);
      setEntries((current) => current.filter((candidate) => candidate.id !== entry.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete factor");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Factor Library</CardTitle>
          <p className="mt-1 text-xs text-fg/45">Reusable labor, cost, and productivity factors available inside estimate workspaces.</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info" className="text-[10px]">{orgCount} editable</Badge>
          <Button variant="accent" size="xs" onClick={() => setDrawer({ mode: "create" })}>
            <Plus className="h-3.5 w-3.5" />
            Add Factor
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex items-center gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search factor library"
            className="max-w-md text-xs"
          />
          <Select
            className="w-32"
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v) || 25)}
            options={FACTOR_LIBRARY_PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n} per page` }))}
          />
        </div>
        {error ? <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</div> : null}
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-fg/45"><Loader2 className="h-4 w-4 animate-spin" /> Loading factors...</div>
        ) : (
          <>
          <div className="overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-[minmax(240px,1fr)_130px_120px_120px_minmax(180px,0.8fr)_56px] bg-panel2/60 px-3 py-2 text-[10px] font-medium uppercase text-fg/35">
              <div>Factor</div>
              <div>Category</div>
              <div>Impact</div>
              <div>Multiplier</div>
              <div>Evidence</div>
              <div />
            </div>
            {pageRows.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-fg/40">
                {query ? "No matching factors." : "No factors yet. Click \"Add Factor\" to add one."}
              </div>
            ) : pageRows.map((entry) => {
              const criteriaCount = Array.isArray((entry.sourceRef as any)?.scoreSheet?.criteria) ? (entry.sourceRef as any).scoreSheet.criteria.length : 0;
              return (
                <div
                  key={entry.id}
                  onClick={() => setDrawer({ mode: "edit", entry })}
                  className="grid cursor-pointer grid-cols-[minmax(240px,1fr)_130px_120px_120px_minmax(180px,0.8fr)_56px] items-center gap-2 border-t border-line px-3 py-2 text-xs hover:bg-panel2/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-left font-medium text-fg">{entry.name}</span>
                      <Badge tone="default">Org</Badge>
                    </div>
                    <div className="mt-1 truncate font-mono text-[10px] text-fg/40">{entry.code || entry.id}</div>
                  </div>
                  <div className="truncate text-fg/60">{entry.category}</div>
                  <div className="truncate text-fg/60">{SETTINGS_FACTOR_IMPACT_OPTIONS.find((option) => option.value === entry.impact)?.label ?? entry.impact}</div>
                  <div className={cn("font-mono text-[11px]", entry.value >= 1 ? "text-warning" : "text-success")}>
                    {settingsFactorPercent(entry.value) >= 0 ? "+" : ""}{Math.round(settingsFactorPercent(entry.value) * 100) / 100}%
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-fg/55">{settingsFactorSourceText(entry.sourceRef, "locator") || settingsFactorSourceText(entry.sourceRef, "title") || settingsFactorSourceLabel(entry.sourceType)}</div>
                    {criteriaCount ? <div className="mt-0.5 text-[10px] text-fg/35">{criteriaCount} criteria</div> : null}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-8 px-2"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteEntry(entry);
                      }}
                      disabled={saving}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > 0 && (
            <div className="flex items-center justify-between text-xs text-fg/50">
              <span>
                Showing {safePageIndex * pageSize + 1}–
                {Math.min((safePageIndex + 1) * pageSize, filtered.length)} of {filtered.length}
                {filtered.length !== entries.length && ` (filtered from ${entries.length})`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={safePageIndex === 0}
                  onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </Button>
                <span className="text-fg/40">
                  Page {safePageIndex + 1} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={safePageIndex >= totalPages - 1}
                  onClick={() => setPageIndex(Math.min(totalPages - 1, safePageIndex + 1))}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          </>
        )}
      </CardBody>

      {drawer && draft && typeof document !== "undefined" && createPortal(
        <AnimatePresence>
          <motion.div key="factor-library-drawer-backdrop" className="fixed inset-0 z-40 bg-black/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(null)} />
          <motion.aside
            key="factor-library-drawer-panel"
            className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[560px] flex-col border-l border-line bg-panel shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <div className="text-sm font-semibold text-fg">{drawer.mode === "edit" ? "Edit Factor" : "Create Factor"}</div>
                <div className="mt-1 text-[11px] text-fg/45">{draft.code || "Organization library"}</div>
              </div>
              <button className="rounded p-1.5 text-fg/40 hover:bg-panel2 hover:text-fg" onClick={() => setDrawer(null)}><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Name</Label>
                  <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <Input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Input value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Description</Label>
                  <Textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Impact</Label>
                  <Select value={draft.impact} onValueChange={(impact) => setDraft({ ...draft, impact: impact as EstimateFactorImpact })} options={SETTINGS_FACTOR_IMPACT_OPTIONS} />
                </div>
                <div className="space-y-1.5">
                  <Label>Percent</Label>
                  <Input value={draft.percent} onChange={(event) => setDraft({ ...draft, percent: event.target.value })} className="text-right font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label>Scope</Label>
                  <Select value={draft.scopeValue} onValueChange={(scopeValue) => setDraft({ ...draft, scopeValue })} options={SETTINGS_FACTOR_SCOPE_OPTIONS} />
                </div>
                <div className="space-y-1.5">
                  <Label>Apply As</Label>
                  <Select value={draft.applicationScope} onValueChange={(applicationScope) => setDraft({ ...draft, applicationScope: applicationScope as EstimateFactorApplicationScope })} options={SETTINGS_FACTOR_APPLICATION_SCOPE_OPTIONS} />
                </div>
                <div className="space-y-1.5">
                  <Label>Formula</Label>
                  <Select value={draft.formulaType} onValueChange={(formulaType) => setDraft({ ...draft, formulaType: formulaType as EstimateFactorFormulaType })} options={SETTINGS_FACTOR_FORMULA_OPTIONS} />
                </div>
                <div className="space-y-1.5">
                  <Label>Confidence</Label>
                  <Select value={draft.confidence} onValueChange={(confidence) => setDraft({ ...draft, confidence: confidence as EstimateFactorConfidence })} options={SETTINGS_FACTOR_CONFIDENCE_OPTIONS} />
                </div>
                <div className="space-y-1.5">
                  <Label>Source</Label>
                  <Select value={draft.sourceType} onValueChange={(sourceType) => setDraft({ ...draft, sourceType: sourceType as EstimateFactorSourceType })} options={SETTINGS_FACTOR_SOURCE_OPTIONS} />
                </div>
                <div className="space-y-1.5">
                  <Label>Source ID</Label>
                  <Input value={draft.sourceId} onChange={(event) => setDraft({ ...draft, sourceId: event.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Evidence</Label>
                  <Textarea rows={3} value={draft.basis} onChange={(event) => setDraft({ ...draft, basis: event.target.value })} />
                </div>
                {draft.formulaType !== "fixed_multiplier" ? (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label>Parameters</Label>
                    <FactorParameterEditor
                      formulaType={draft.formulaType}
                      parameters={draft.parameters}
                      onChange={(parameters) => setDraft({ ...draft, parameters })}
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>Locator</Label>
                  <Input value={draft.locator} onChange={(event) => setDraft({ ...draft, locator: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tags</Label>
                  <Input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
              <Button variant="secondary" size="sm" onClick={() => setDrawer(null)} disabled={saving}>Cancel</Button>
              <Button variant="accent" size="sm" onClick={saveDrawer} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </motion.aside>
        </AnimatePresence>,
        document.body,
      )}
    </Card>
  );
}

function UomSettingsPanel({ uoms, onChange }: { uoms: UnitOfMeasure[]; onChange: (uoms: UnitOfMeasure[]) => void }) {
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const defaultCodes = useMemo(() => new Set(DEFAULT_UOMS.map((unit) => unit.code)), []);

  const normalized = useMemo(() => normalizeUomLibrary(uoms), [uoms]);
  const activeCount = normalized.filter((unit) => unit.active).length;

  const replace = (code: string, patch: Partial<UnitOfMeasure>) => {
    onChange(normalized.map((unit) => (unit.code === code ? { ...unit, ...patch } : unit)));
  };

  const addUnit = () => {
    const code = normalizeUomCode(newCode);
    if (!code) return;
    const existing = normalized.find((unit) => unit.code === code);
    if (existing) {
      replace(code, {
        label: newLabel.trim() || existing.label || code,
        description: newDescription.trim(),
        active: true,
      });
    } else {
      onChange([
        ...normalized,
        {
          code,
          label: newLabel.trim() || code,
          description: newDescription.trim(),
          active: true,
          order: normalized.length,
        },
      ]);
    }
    setNewCode("");
    setNewLabel("");
    setNewDescription("");
  };

  const removeUnit = (code: string) => {
    if (defaultCodes.has(code)) {
      replace(code, { active: false });
      return;
    }
    onChange(normalized.filter((unit) => unit.code !== code));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Units of Measure</CardTitle>
          <p className="mt-1 text-xs text-fg/45">
            Organization-scoped UOMs used by assemblies, catalogs, rate tiers, and estimate rows.
          </p>
        </div>
        <Badge tone="info" className="text-[10px]">{activeCount} active</Badge>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1.5fr)_auto] items-end gap-2 rounded-lg border border-line bg-panel2/35 p-3">
          <div>
            <Label>Code</Label>
            <Input
              value={newCode}
              onChange={(event) => setNewCode(normalizeUomCode(event.target.value))}
              placeholder="EA"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <Label>Label</Label>
            <Input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="Each" className="text-xs" />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="How this unit is used" className="text-xs" />
          </div>
          <Button variant="accent" size="sm" onClick={addUnit} disabled={!normalizeUomCode(newCode)}>
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-line">
          <div className="grid grid-cols-[90px_minmax(0,1fr)_minmax(0,1.5fr)_84px_54px] gap-2 border-b border-line bg-panel2/45 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-fg/35">
            <div>Code</div>
            <div>Label</div>
            <div>Description</div>
            <div>Status</div>
            <div />
          </div>
          <div className="divide-y divide-line">
            {normalized.map((unit) => (
              <div key={unit.code} className="grid grid-cols-[90px_minmax(0,1fr)_minmax(0,1.5fr)_84px_54px] items-center gap-2 px-3 py-2">
                <div className="font-mono text-xs font-semibold text-fg/70">{unit.code}</div>
                <Input value={unit.label} onChange={(event) => replace(unit.code, { label: event.target.value })} className="h-8 text-xs" />
                <Input value={unit.description ?? ""} onChange={(event) => replace(unit.code, { description: event.target.value })} className="h-8 text-xs" />
                <div className="flex items-center justify-start">
                  <Toggle checked={unit.active} onChange={(active) => replace(unit.code, { active })} />
                </div>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => removeUnit(unit.code)}
                  title={defaultCodes.has(unit.code) ? "Disable built-in unit" : "Delete unit"}
                  className="px-2 text-fg/45 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

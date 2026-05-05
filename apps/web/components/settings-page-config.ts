import { ArrowUpDown, Building2, Layers, Users, Zap } from "lucide-react";
import { DEFAULT_UOMS, type UnitOfMeasure } from "@bidwright/domain";

import type { BrandProfile } from "@/lib/api";

export const STORAGE_KEY = "bidwright-settings";

export type SettingsGroup = "organization" | "data" | "importExport" | "integrations" | "users";
export type OrgSubTab = "general" | "brand" | "departments" | "defaults" | "terms" | "personas";
export type DataSubTab = "categories" | "uoms" | "conditions" | "factors";
export type IntegrationsSubTab = "agent" | "apikeys" | "email" | "plugins" | "integrations";

export const ORG_SUBTABS: { id: OrgSubTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "brand", label: "Brand" },
  { id: "departments", label: "Departments" },
  { id: "defaults", label: "Defaults" },
  { id: "terms", label: "Terms & Conditions" },
];

export const DATA_SUBTABS: { id: DataSubTab; label: string }[] = [
  { id: "categories", label: "Categories" },
  { id: "uoms", label: "Units" },
  { id: "factors", label: "Factors" },
  { id: "conditions", label: "Conditions" },
];

export const INTEGRATIONS_SUBTABS: { id: IntegrationsSubTab; label: string }[] = [
  { id: "agent", label: "Agent Runtime" },
  { id: "apikeys", label: "API Keys" },
  { id: "email", label: "Email" },
  { id: "plugins", label: "Plugins" },
  { id: "integrations", label: "Integrations" },
];

export interface GeneralSettings {
  timezone: string;
  currency: string;
  dateFormat: string;
  fiscalYearStart: number;
}

export interface EmailSettings {
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  fromAddress: string;
  fromName: string;
  authMethod: "smtp" | "oauth2";
  oauth2TenantId: string;
  oauth2ClientId: string;
  oauth2ClientSecret: string;
}

export interface DefaultSettings {
  defaultMarkup: number;
  defaultBreakoutStyle: string;
  defaultQuoteType: string;
  uoms: UnitOfMeasure[];
  benchmarkingEnabled: boolean;
  benchmarkMinimumSimilarity: number;
  benchmarkMaximumComparables: number;
  benchmarkLowerHoursRatio: number;
  benchmarkUpperHoursRatio: number;
  requireHumanReviewForBenchmarkOutliers: boolean;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: "Estimator" | "Admin" | "Viewer";
  active: boolean;
}

export interface IntegrationSettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey: string;
  geminiApiKey: string;
  lmstudioBaseUrl: string;
  llmProvider: string;
  llmModel: string;
  azureDiEndpoint: string;
  azureDiKey: string;
  documentExtractionProvider: "azure" | "local" | "auto";
  azureDiModel: "prebuilt-layout" | "prebuilt-read" | "prebuilt-document" | "prebuilt-invoice";
  agentRuntime?: string | null;
  agentModel?: string | null;
  agentReasoningEffort?: string | null;
  claudeCodePath?: string | null;
  codexPath?: string | null;
  maxConcurrentSubAgents?: number;
}

export interface AllSettings {
  general: GeneralSettings;
  email: EmailSettings;
  defaults: DefaultSettings;
  users: UserRecord[];
  integrations: IntegrationSettings;
  termsAndConditions: string;
}

export const DEFAULT_BRAND: BrandProfile = {
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

export const DEFAULT_SETTINGS: AllSettings = {
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
    authMethod: "smtp",
    oauth2TenantId: "",
    oauth2ClientId: "",
    oauth2ClientSecret: "",
  },
  defaults: {
    defaultMarkup: 15,
    defaultBreakoutStyle: "category",
    defaultQuoteType: "Firm",
    uoms: DEFAULT_UOMS,
    benchmarkingEnabled: true,
    benchmarkMinimumSimilarity: 0.55,
    benchmarkMaximumComparables: 5,
    benchmarkLowerHoursRatio: 0.75,
    benchmarkUpperHoursRatio: 1.25,
    requireHumanReviewForBenchmarkOutliers: true,
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
    documentExtractionProvider: "azure",
    azureDiModel: "prebuilt-layout",
    agentReasoningEffort: "extra_high",
  },
  termsAndConditions: "",
};

export const GROUPS: { key: SettingsGroup; label: string; icon: typeof Building2 }[] = [
  { key: "organization", label: "Organization", icon: Building2 },
  { key: "data", label: "Data Management", icon: Layers },
  { key: "importExport", label: "Import / Export", icon: ArrowUpDown },
  { key: "integrations", label: "Integrations", icon: Zap },
  { key: "users", label: "Users & Access", icon: Users },
];

export const TIMEZONES = [
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

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF", "JPY"];
export const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const PROVIDER_CONFIG: Record<string, { label: string; keyField: keyof IntegrationSettings; placeholder: string; keyLabel: string }> = {
  anthropic: { label: "Anthropic", keyField: "anthropicApiKey", placeholder: "sk-ant-***", keyLabel: "Anthropic API Key" },
  openai: { label: "OpenAI", keyField: "openaiApiKey", placeholder: "sk-***", keyLabel: "OpenAI API Key" },
  openrouter: { label: "OpenRouter", keyField: "openrouterApiKey", placeholder: "sk-or-***", keyLabel: "OpenRouter API Key" },
  gemini: { label: "Google Gemini", keyField: "geminiApiKey", placeholder: "AI***", keyLabel: "Gemini API Key" },
  lmstudio: { label: "LM Studio (Local)", keyField: "lmstudioBaseUrl", placeholder: "http://localhost:1234/v1", keyLabel: "LM Studio Base URL" },
};

export function maskKey(value: string) {
  if (!value || value.length < 8) return value ? "****" : "";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

import { apiRequest } from "./client";
import type { UnitOfMeasure } from "@bidwright/domain";
import type { SupportedLocale } from "@/lib/i18n";

export interface BrandProfile {
  companyName: string;
  tagline: string;
  industry: string;
  description: string;
  services: string[];
  targetMarkets: string[];
  brandVoice: string;
  colors: { primary: string; secondary: string; accent: string };
  logoUrl: string;
  socialLinks: Record<string, string>;
  websiteUrl: string;
  lastCapturedAt: string | null;
}

export interface AppSettingsRecord {
  general: { orgName: string; address: string; phone: string; website: string; logoUrl: string; language: SupportedLocale };
  email: { host: string; port: number; username: string; password: string; fromAddress: string; fromName: string; authMethod?: "smtp" | "oauth2"; oauth2TenantId?: string; oauth2ClientId?: string; oauth2ClientSecret?: string };
  defaults: {
    defaultMarkup: number;
    breakoutStyle: string;
    quoteType: string;
    timezone: string;
    currency: string;
    dateFormat: string;
    uoms?: UnitOfMeasure[];
    benchmarkingEnabled?: boolean;
    benchmarkMinimumSimilarity?: number;
    benchmarkMaximumComparables?: number;
    benchmarkLowerHoursRatio?: number;
    benchmarkUpperHoursRatio?: number;
    requireHumanReviewForBenchmarkOutliers?: boolean;
  };
  integrations: {
    openaiKey: string;
    anthropicKey: string;
    openrouterKey: string;
    geminiKey: string;
    lmstudioBaseUrl?: string;
    llmProvider: string;
    llmModel: string;
    azureDiEndpoint?: string;
    azureDiKey?: string;
    documentExtractionProvider?: "azure" | "local" | "auto";
    azureDiModel?: "prebuilt-layout" | "prebuilt-read" | "prebuilt-document" | "prebuilt-invoice" | "prebuilt-contract";
    azureDiFeatures?: Array<"keyValuePairs" | "queryFields" | "ocrHighResolution" | "formulas" | "styleFont" | "barcodes" | "languages">;
    azureDiQueryFields?: string;
    azureDiOutputFormat?: "text" | "markdown";
    drawingExtractionProvider?: "landingAi" | "geminiPro" | "geminiFlash" | "none";
    drawingExtractionEnabled?: boolean;
    /** @deprecated kept for backward compatibility. */
    landingAiDrawingExtractionEnabled?: boolean;
    landingAiApiKey?: string;
    landingAiEndpoint?: string;
    landingAiParseModel?: string;
    landingAiExtractModel?: string;
    geminiApiKey?: string;
    geminiProModel?: string;
    geminiFlashModel?: string;
    geminiThinkingEnabled?: boolean;
    autodeskClientId?: string;
    autodeskClientSecret?: string;
    autodeskApsRevitActivityId?: string;
    autodeskApsAutocadActivityId?: string;
    agentRuntime?: string;
    agentModel?: string;
    agentReasoningEffort?: string;
    maxConcurrentSubAgents?: number;
  };
  brand: BrandProfile;
  termsAndConditions?: string;
}

export async function getSettings() {
  return apiRequest<AppSettingsRecord>("/settings");
}

export async function testEmailConnection() {
  return apiRequest<{ success: boolean; message: string }>("/settings/test-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function testProviderKey(provider: string, apiKey: string, baseUrl?: string) {
  return apiRequest<{ success: boolean; message: string }>("/settings/integrations/test-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey, baseUrl }),
  });
}

export async function fetchProviderModels(provider: string, apiKey: string, baseUrl?: string) {
  return apiRequest<{ models: { id: string; name: string }[] }>("/settings/integrations/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey, baseUrl }),
  });
}

export async function searchTools(query: string) {
  const params = new URLSearchParams({ search: query });
  return apiRequest<Array<{ id: string; name: string; description: string; pluginId: string }>>(`/api/tools?${params.toString()}`);
}

export async function updateSettings(patch: Partial<AppSettingsRecord>) {
  return apiRequest<AppSettingsRecord>("/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function getBrand() {
  return apiRequest<BrandProfile>("/settings/brand");
}

export async function updateBrand(patch: Partial<BrandProfile>) {
  return apiRequest<BrandProfile>("/settings/brand", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function captureBrand(websiteUrl: string) {
  return apiRequest<BrandProfile>("/settings/brand/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ websiteUrl }),
  });
}

// ── Per-user settings ────────────────────────────────────────────────────
// User-scoped overrides for credentials and preferences. Keys mirror
// AppSettingsRecord["integrations"] so the spawn pipeline can shallow-merge
// these onto org defaults. OAuth blocks are nested objects keyed by
// `<provider>Oauth = { accessToken, refreshToken?, expiresAt? }`.

export interface UserOauthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface UserSettingsRecord {
  integrations: Partial<{
    anthropicKey: string;
    openaiKey: string;
    geminiKey: string;
    openrouterKey: string;
    anthropicOauth: UserOauthCredential;
    openaiOauth: UserOauthCredential;
    googleOauth: UserOauthCredential;
    agentRuntime: string;
    agentModel: string;
    agentReasoningEffort: string;
    claudeCodePath: string;
    codexPath: string;
    opencodePath: string;
    geminiPath: string;
  }>;
  preferences: Record<string, unknown>;
  updatedAt: string | null;
}

/**
 * For each provider/kind slot, returns where the credential the spawn
 * pipeline will actually use is sourced from. Lets the UI render
 * "Using: your Claude Pro OAuth" / "Using: org Anthropic API key" without
 * re-implementing the merge logic.
 */
export interface EffectiveCredentialSources {
  sources: Record<string, { source: "user" | "organization" | "none"; kind: "api_key" | "oauth" | null }>;
}

export async function getUserSettings() {
  return apiRequest<UserSettingsRecord>("/user/settings");
}

export async function updateUserSettings(patch: {
  integrations?: UserSettingsRecord["integrations"];
  preferences?: UserSettingsRecord["preferences"];
}) {
  return apiRequest<UserSettingsRecord>("/user/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function getEffectiveCredentialSources() {
  return apiRequest<EffectiveCredentialSources>("/user/settings/effective");
}

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
    fiscalYearStart: number;
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

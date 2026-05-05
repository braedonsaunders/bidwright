export const AZURE_DOCUMENT_INTELLIGENCE_API_VERSION = '2024-11-30' as const;

export const AZURE_DOCUMENT_INTELLIGENCE_MODEL_IDS = [
  'prebuilt-layout',
  'prebuilt-read',
  'prebuilt-document',
  'prebuilt-invoice',
  'prebuilt-contract',
] as const;

export const AZURE_DOCUMENT_INTELLIGENCE_FEATURE_IDS = [
  'keyValuePairs',
  'queryFields',
  'ocrHighResolution',
  'formulas',
  'styleFont',
  'barcodes',
  'languages',
] as const;

export const DEFAULT_AZURE_DOCUMENT_INTELLIGENCE_FEATURES = ['keyValuePairs'] as const;

export type AzureDocumentIntelligenceModel = typeof AZURE_DOCUMENT_INTELLIGENCE_MODEL_IDS[number];
export type AzureDocumentIntelligenceFeature = typeof AZURE_DOCUMENT_INTELLIGENCE_FEATURE_IDS[number];

const MODEL_ID_SET = new Set<string>(AZURE_DOCUMENT_INTELLIGENCE_MODEL_IDS);
const FEATURE_ID_SET = new Set<string>(AZURE_DOCUMENT_INTELLIGENCE_FEATURE_IDS);

export function isAzureDocumentIntelligenceModel(value: unknown): value is AzureDocumentIntelligenceModel {
  return typeof value === 'string' && MODEL_ID_SET.has(value);
}

export function normalizeAzureDocumentIntelligenceFeatures(
  value: unknown,
  fallback: readonly AzureDocumentIntelligenceFeature[] = [],
): AzureDocumentIntelligenceFeature[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : fallback;

  return Array.from(new Set(
    raw.filter((feature): feature is AzureDocumentIntelligenceFeature => (
      typeof feature === 'string' && FEATURE_ID_SET.has(feature.trim())
    )).map((feature) => feature.trim() as AzureDocumentIntelligenceFeature),
  ));
}

export function parseAzureDocumentIntelligenceQueryFields(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n]/)
      : [];

  return Array.from(new Set(
    raw
      .map((field) => String(field ?? '').trim())
      .filter(Boolean),
  ));
}

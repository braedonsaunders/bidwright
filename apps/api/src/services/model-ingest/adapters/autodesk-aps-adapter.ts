import type { ModelIngestCapability } from "@bidwright/domain";
import type { ModelAdapterIngestResult, ModelIngestAdapter, ModelIngestContext, ModelIngestSettings, ModelIngestSource } from "../types.js";
import {
  makeCanonicalManifest,
  makeProvenance,
} from "../utils.js";

const ADAPTER_ID = "autodesk-aps.native-cad-bim";
const ADAPTER_VERSION = "1.0.0";
const FORMATS = new Set(["rvt", "dwg"]);
const CONFIG_KEYS = {
  clientId: "autodeskClientId",
  clientSecret: "autodeskClientSecret",
  revitActivityId: "autodeskApsRevitActivityId",
  autocadActivityId: "autodeskApsAutocadActivityId",
} as const;
const ACTIVITY_CONFIG_BY_FORMAT: Record<string, keyof typeof CONFIG_KEYS> = {
  rvt: "revitActivityId",
  dwg: "autocadActivityId",
};

function settingValue(settings: ModelIngestSettings | undefined, key: string) {
  const value = settings?.integrations?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function configured(settings: ModelIngestSettings | undefined, key: keyof typeof CONFIG_KEYS) {
  const settingKey = CONFIG_KEYS[key];
  const value = settingValue(settings, settingKey);
  return {
    configured: Boolean(value),
    source: value ? "organization_settings" : "missing",
    missingKey: settingKey,
  };
}

function capability(format?: string, settings?: ModelIngestSettings): ModelIngestCapability {
  const clientId = configured(settings, "clientId");
  const clientSecret = configured(settings, "clientSecret");
  const activityConfigKey = format ? ACTIVITY_CONFIG_BY_FORMAT[format] : undefined;
  const activity = activityConfigKey ? configured(settings, activityConfigKey) : undefined;
  const missing = [clientId, clientSecret, activity].filter((entry) => entry && !entry.configured).map((entry) => entry!.missingKey);
  const hasAuth = clientId.configured && clientSecret.configured;
  const hasActivity = !activity || activity.configured;
  const status: ModelIngestCapability["status"] = hasAuth && hasActivity ? "available" : hasAuth ? "degraded" : "missing";
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: "autodesk-aps",
    formats: Array.from(FORMATS),
    status,
    message: status === "available"
      ? "Autodesk APS credentials and extraction activity are configured."
      : status === "degraded"
        ? "Autodesk APS credentials are configured, but the format-specific extraction activity is not configured."
        : "Autodesk APS credentials are not configured. Native RVT/DWG extraction is unavailable.",
    missingConfigKeys: missing,
    features: {
      geometry: status === "available",
      properties: status === "available",
      quantities: status === "available",
      estimateLens: status === "available",
      rawArtifacts: true,
      requiresCloud: true,
    },
    metadata: {
      auth: hasAuth ? "configured" : "missing",
      clientIdSource: clientId.source,
      clientSecretSource: clientSecret.source,
      activitySource: activity?.source ?? null,
      activitySettingKey: activity ? CONFIG_KEYS[activityConfigKey!] : null,
      configScope: "organization_settings_only",
      allowedProvider: "single Autodesk APS integration",
      dgn: "intentionally_unsupported",
    },
  };
}

export const autodeskApsAdapter: ModelIngestAdapter = {
  id: ADAPTER_ID,
  version: ADAPTER_VERSION,
  formats: FORMATS,
  priority: 70,
  capability(format?: string, settings?: ModelIngestSettings) {
    return capability(format, settings);
  },
  async ingest(source: ModelIngestSource, context: ModelIngestContext): Promise<ModelAdapterIngestResult> {
    const activeCapability = capability(context.format, context.settings);
    const method = context.format === "rvt" ? "autodesk_aps_revit_automation" : "autodesk_aps_autocad_automation";
    const issue = activeCapability.status === "available"
      ? {
          severity: "warning",
          code: "autodesk_aps_worker_not_bound",
          message: "Autodesk APS capability is configured, but BidWright has not yet received a completed APS extraction payload for this file. The file is indexed as a native-source shell.",
        }
      : {
          severity: "warning",
          code: activeCapability.status === "missing" ? "autodesk_aps_missing_config" : "autodesk_aps_activity_missing",
          message: activeCapability.message ?? "Autodesk APS extraction is unavailable.",
          metadata: { missingConfigKeys: activeCapability.missingConfigKeys ?? [] },
        };
    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method,
      confidence: 0.2,
    });
    const summary = {
      parser: method,
      nativeFormat: context.format,
      provider: "autodesk-aps",
      status: activeCapability.status,
      note: "Native RVT/DWG extraction is intentionally routed through the single Autodesk APS provider, not cad2data or local proprietary converter installs.",
      missingConfigKeys: activeCapability.missingConfigKeys ?? [],
    };
    const canonicalManifest = makeCanonicalManifest({
      status: "partial",
      units: "",
      capability: activeCapability,
      provenance,
      summary,
      elementStats: {},
      estimateLens: [],
      issues: [issue],
    });
    return {
      status: "partial",
      units: "",
      manifest: summary,
      elementStats: {},
      elements: [],
      quantities: [],
      bomRows: [],
      issues: [issue],
      canonicalManifest,
      artifacts: [],
    };
  },
};

import type { CanonicalModelElement, CanonicalModelQuantity, ModelIngestCapability } from "@bidwright/domain";
import { ApsClient } from "../aps-client.js";
import { buildEstimateLens, createId, makeCanonicalManifest, makeProvenance } from "../utils.js";
import type { ModelAdapterIngestResult, ModelIngestAdapter, ModelIngestContext, ModelIngestSettings, ModelIngestSource } from "../types.js";

const ADAPTER_ID = "autodesk-aps.model-derivative";
const ADAPTER_VERSION = "2.0.0";
const FORMATS = new Set(["rvt", "dwg", "nwd", "nwf", "nwc"]);
const MAX_TRANSLATION_WAIT_MS = 600_000;

function settingValue(settings: ModelIngestSettings | undefined, key: string) {
  const value = settings?.integrations?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function capability(format?: string, settings?: ModelIngestSettings): ModelIngestCapability {
  const clientId = settingValue(settings, "autodeskClientId");
  const clientSecret = settingValue(settings, "autodeskClientSecret");
  const hasAuth = Boolean(clientId && clientSecret);
  const status: ModelIngestCapability["status"] = hasAuth ? "available" : "missing";
  return {
    adapterId: ADAPTER_ID,
    adapterVersion: ADAPTER_VERSION,
    provider: "autodesk-aps",
    formats: Array.from(FORMATS),
    status,
    message: status === "available"
      ? `Autodesk APS Model Derivative API is configured for .${format ?? "rvt/dwg/nwd"} extraction.`
      : "Autodesk APS credentials are not configured. RVT/DWG/Navisworks extraction requires Client ID and Client Secret in organization settings.",
    missingConfigKeys: hasAuth ? [] : ["autodeskClientId", "autodeskClientSecret"],
    features: {
      geometry: hasAuth,
      properties: hasAuth,
      quantities: hasAuth,
      estimateLens: hasAuth,
      rawArtifacts: true,
      requiresCloud: true,
    },
    metadata: {
      engine: "autodesk_model_derivative_v2",
      auth: hasAuth ? "configured" : "missing",
      configScope: "organization_settings_only",
      navisworks: "supported_via_nwd_nwf_nwc",
      revit: "supported_via_rvt",
      autocad: "supported_via_dwg",
      dgn: "intentionally_unsupported",
    },
  };
}

function formatLabel(format: string): string {
  if (format === "rvt") return "Revit";
  if (format === "dwg") return "AutoCAD DWG";
  if (format === "nwd" || format === "nwf" || format === "nwc") return "Navisworks";
  return format.toUpperCase();
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
    const clientId = settingValue(context.settings, "autodeskClientId");
    const clientSecret = settingValue(context.settings, "autodeskClientSecret");

    if (!clientId || !clientSecret) {
      return buildMissingResult(source, context, activeCapability);
    }

    const method = `aps_model_derivative_${context.format}`;
    const client = new ApsClient(clientId, clientSecret);

    const objectKey = `${source.projectId}/${source.id}/${source.fileName}`;

    let uploaded;
    try {
      uploaded = await client.uploadObject(objectKey, context.absPath);
    } catch (err) {
      return buildErrorResult(source, context, activeCapability, method, err instanceof Error ? err.message : String(err), "aps_upload_failed");
    }

    let translationStatus;
    try {
      await client.submitTranslation(uploaded.urn);
      translationStatus = await client.waitForTranslation(uploaded.urn, MAX_TRANSLATION_WAIT_MS);
    } catch (err) {
      return buildErrorResult(source, context, activeCapability, method, err instanceof Error ? err.message : String(err), "aps_translation_failed");
    }

    if (translationStatus.status === "timeout") {
      return buildTimeoutResult(source, context, activeCapability, method, uploaded.urn);
    }

    let modelData;
    try {
      modelData = await client.extractModelData(uploaded.urn);
    } catch (err) {
      return buildErrorResult(source, context, activeCapability, method, err instanceof Error ? err.message : String(err), "aps_metadata_extraction_failed");
    }

    const elements: CanonicalModelElement[] = modelData.objects.map((obj) => ({
      id: createId("me"),
      externalId: String(obj.objectid),
      name: obj.name,
      elementClass: obj.elementClass || formatLabel(context.format),
      elementType: obj.elementType || undefined,
      system: obj.system || undefined,
      level: obj.level || undefined,
      material: obj.material || undefined,
      estimateRelevant: isEstimateRelevant(obj.elementClass, obj.elementType),
      properties: Object.keys(obj.properties).length > 0 ? obj.properties : undefined,
    }));

    const quantities: CanonicalModelQuantity[] = [];
    for (const obj of modelData.objects) {
      const elementId = String(obj.objectid);
      for (const q of obj.quantities) {
        quantities.push({
          id: createId("mq"),
          elementId,
          quantityType: q.quantityType,
          value: q.value,
          unit: q.unit || guessUnit(q.quantityType),
          method: "aps_model_derivative_property",
          confidence: 0.85,
        });
      }
    }

    const classCounts = new Map<string, number>();
    for (const el of elements) {
      const key = el.elementClass || "unknown";
      classCounts.set(key, (classCounts.get(key) ?? 0) + 1);
    }
    const topClasses = Array.from(classCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([name, count]) => ({ name, count }));

    const estimateLens = buildEstimateLens({
      elements,
      quantities,
      defaultSource: "native-quantity",
    });

    const provenance = makeProvenance({
      source,
      format: context.format,
      checksum: context.checksum,
      size: context.size,
      capability: activeCapability,
      method,
      confidence: 0.85,
    });

    const summary = {
      parser: method,
      engine: "autodesk_model_derivative_v2",
      nativeFormat: context.format,
      formatLabel: formatLabel(context.format),
      provider: "autodesk-aps",
      urn: uploaded.urn,
      viewCount: modelData.views.length,
      views: modelData.views.map((v) => ({ guid: v.guid, name: v.name, role: v.role })),
      translationStatus: translationStatus.status,
      translationProgress: translationStatus.progress,
      objectCount: elements.length,
      quantityCount: quantities.length,
    };

    const issues: Array<{ severity: "info" | "warning" | "error"; code: string; message: string; metadata?: Record<string, unknown> }> = [];
    if (quantities.length === 0) {
      issues.push({
        severity: "info",
        code: "aps_no_quantities_extracted",
        message: `APS extracted ${elements.length} elements but no numeric quantity properties were found. Properties are available for element classification.`,
      });
    }

    const canonicalManifest = makeCanonicalManifest({
      status: "indexed",
      units: guessUnits(context.format),
      capability: activeCapability,
      provenance,
      summary,
      elementStats: {
        totalElements: elements.length,
        totalQuantities: quantities.length,
        classDistribution: topClasses,
      },
      estimateLens,
      issues,
    });

    return {
      status: "indexed",
      units: guessUnits(context.format),
      manifest: summary,
      elementStats: {
        totalElements: elements.length,
        totalQuantities: quantities.length,
        classDistribution: topClasses,
      },
      elements,
      quantities,
      bomRows: buildBomRows(elements, quantities),
      issues,
      canonicalManifest,
      artifacts: [],
    };
  },
};

function isEstimateRelevant(elementClass: string, elementType: string): boolean {
  const lower = `${elementClass} ${elementType}`.toLowerCase();
  const keywords = [
    "wall", "floor", "ceiling", "roof", "door", "window", "column", "beam",
    "slab", "foundation", "stair", "ramp", "rail", "curtain", "panel",
    "duct", "pipe", "cable", "conduit", "tray", "conductor", "fitting",
    "equipment", "fixture", "furniture", "plant", "mechanical", "electrical",
    "plumbing", "fire", "sprinkler", "structural", "concrete", "steel",
    "framing", "rebar", "reinforcement", "mep",
  ];
  return keywords.some((kw) => lower.includes(kw));
}

function guessUnit(quantityType: string): string {
  const lower = quantityType.toLowerCase();
  if (lower.includes("area")) return "sq ft";
  if (lower.includes("volume")) return "cu ft";
  if (lower.includes("length") || lower.includes("width") || lower.includes("height") || lower.includes("depth") || lower.includes("perimeter") || lower.includes("thickness") || lower.includes("radius") || lower.includes("diameter") || lower.includes("offset") || lower.includes("elevation")) return "ft";
  if (lower.includes("count")) return "ea";
  return "";
}

function guessUnits(format: string): string {
  if (format === "rvt" || format === "dwg") return "ft";
  return "ft";
}

function buildBomRows(
  elements: CanonicalModelElement[],
  quantities: CanonicalModelQuantity[],
): Array<Record<string, unknown>> {
  const qtyByElement = new Map<string, CanonicalModelQuantity[]>();
  for (const q of quantities) {
    const rows = qtyByElement.get(q.elementId ?? "") ?? [];
    rows.push(q);
    qtyByElement.set(q.elementId ?? "", rows);
  }
  return elements.map((el) => ({
    elementId: el.id,
    name: el.name,
    class: el.elementClass,
    type: el.elementType,
    level: el.level,
    material: el.material,
    quantities: (qtyByElement.get(el.externalId) ?? []).map((q) => ({
      type: q.quantityType,
      value: q.value,
      unit: q.unit,
    })),
  }));
}

function buildMissingResult(source: ModelIngestSource, context: ModelIngestContext, activeCapability: ModelIngestCapability): ModelAdapterIngestResult {
  const method = `aps_model_derivative_${context.format}`;
  const issue = {
    severity: "warning" as const,
    code: "autodesk_aps_missing_config",
    message: "Autodesk APS credentials are not configured. RVT/DWG/Navisworks extraction requires Client ID and Client Secret in organization settings.",
    metadata: { missingConfigKeys: activeCapability.missingConfigKeys ?? [] },
  };
  const provenance = makeProvenance({ source, format: context.format, checksum: context.checksum, size: context.size, capability: activeCapability, method, confidence: 0.1 });
  const summary = { parser: method, nativeFormat: context.format, provider: "autodesk-aps", status: "missing_config" };
  const canonicalManifest = makeCanonicalManifest({ status: "partial", units: "", capability: activeCapability, provenance, summary, elementStats: {}, issues: [issue] });
  return { status: "partial", units: "", manifest: summary, elementStats: {}, elements: [], quantities: [], bomRows: [], issues: [issue], canonicalManifest, artifacts: [] };
}

function buildErrorResult(source: ModelIngestSource, context: ModelIngestContext, activeCapability: ModelIngestCapability, method: string, message: string, code: string): ModelAdapterIngestResult {
  const issue = { severity: "error" as const, code, message };
  const provenance = makeProvenance({ source, format: context.format, checksum: context.checksum, size: context.size, capability: activeCapability, method, confidence: 0.1 });
  const summary = { parser: method, nativeFormat: context.format, provider: "autodesk-aps", error: message };
  const canonicalManifest = makeCanonicalManifest({ status: "failed", units: "", capability: activeCapability, provenance, summary, elementStats: {}, issues: [issue] });
  return { status: "failed", units: "", manifest: summary, elementStats: {}, elements: [], quantities: [], bomRows: [], issues: [issue], canonicalManifest, artifacts: [] };
}

function buildTimeoutResult(source: ModelIngestSource, context: ModelIngestContext, activeCapability: ModelIngestCapability, method: string, urn: string): ModelAdapterIngestResult {
  const issue = {
    severity: "warning" as const,
    code: "aps_translation_timeout",
    message: `APS Model Derivative translation did not complete within the polling window. The translation may still be processing on Autodesk's servers. URN: ${urn}`,
    metadata: { urn },
  };
  const provenance = makeProvenance({ source, format: context.format, checksum: context.checksum, size: context.size, capability: activeCapability, method, confidence: 0.3 });
  const summary = { parser: method, nativeFormat: context.format, provider: "autodesk-aps", status: "translation_timeout", urn };
  const canonicalManifest = makeCanonicalManifest({ status: "partial", units: "", capability: activeCapability, provenance, summary, elementStats: {}, issues: [issue] });
  return { status: "partial", units: "", manifest: summary, elementStats: {}, elements: [], quantities: [], bomRows: [], issues: [issue], canonicalManifest, artifacts: [] };
}

/**
 * LandingAI ADE drawing-extraction provider.
 *
 * LandingAI uses a two-step async pipeline:
 * - POST {endpoint}/v1/ade/parse/jobs                          — submit PDF, returns jobId
 * - GET  {endpoint}/v1/ade/parse/jobs/{jobId}                   — poll until complete
 * - POST {endpoint}/v1/ade/extract                              — schema-driven extraction over parse markdown
 *
 * Because LandingAI parse can take >30s and we need to surface "running" state to the
 * agent immediately, we expose async lifecycle via `landingAiAsyncBound(settings)`.
 * The synchronous `parse()` method composes startJob → poll → extract internally.
 */

import type {
  DrawingProvider,
  IntegrationSettingsSnapshot,
  ParseProviderInput,
  ProviderResult,
} from "./types.js";
import { hashFingerprint, safeJson, sleep } from "./util.js";

const DEFAULT_ENDPOINT = "https://api.va.landing.ai";
const DEFAULT_PARSE_MODEL = "dpt-2-latest";
const DEFAULT_EXTRACT_MODEL = "extract-latest";

function endpointBase(value: unknown) {
  const text = String(value ?? "").trim() || DEFAULT_ENDPOINT;
  return text.replace(/\/+$/, "");
}

function authHeaders(apiKey: string) {
  return { Authorization: `Bearer ${apiKey}` };
}

interface LandingAiCfg {
  apiKey: string;
  endpoint: string;
  parseModel: string;
  extractModel: string;
}

function readSettings(settings: IntegrationSettingsSnapshot): LandingAiCfg {
  return {
    apiKey: String(settings.landingAiApiKey ?? "").trim(),
    endpoint: endpointBase(settings.landingAiEndpoint),
    parseModel: String(settings.landingAiParseModel ?? "").trim() || DEFAULT_PARSE_MODEL,
    extractModel: String(settings.landingAiExtractModel ?? "").trim() || DEFAULT_EXTRACT_MODEL,
  };
}

function landingAiSchema() {
  return {
    type: "object",
    properties: {
      drawing_title: { type: "string" },
      drawing_number: { type: "string" },
      revision: { type: "string" },
      sheet_number: { type: "string" },
      scale: { type: "string" },
      customer: { type: "string" },
      project: { type: "string" },
      discipline: { type: "string" },
      drawing_type: { type: "string" },
      key_quantities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "string" },
            unit: { type: "string" },
            evidence_text: { type: "string" },
          },
        },
      },
      bom_or_parts_rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            item: { type: "string" },
            description: { type: "string" },
            quantity: { type: "string" },
            unit: { type: "string" },
            material: { type: "string" },
          },
        },
      },
      schedules: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            rows: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
      important_notes: { type: "array", items: { type: "string" } },
      open_questions: { type: "array", items: { type: "string" } },
    },
  };
}

async function fetchOutputUrl(outputUrl: unknown) {
  if (typeof outputUrl !== "string" || !outputUrl) return null;
  const response = await fetch(outputUrl);
  if (!response.ok) return null;
  return safeJson(response);
}

async function pollParseJob(args: {
  endpoint: string;
  apiKey: string;
  jobId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const startedAt = Date.now();
  let last: any = null;
  while (Date.now() - startedAt < args.timeoutMs) {
    if (args.signal?.aborted) throw new Error("LandingAI parse aborted");
    const response = await fetch(`${args.endpoint}/v1/ade/parse/jobs/${encodeURIComponent(args.jobId)}`, {
      headers: authHeaders(args.apiKey),
    });
    const data = await safeJson(response) as any;
    if (!response.ok) {
      throw new Error(`LandingAI parse poll failed: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
    }
    last = data;
    const status = String(data?.status ?? "").toLowerCase();
    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(`LandingAI parse failed: ${String(data?.failure_reason ?? status)}`);
    }
    const hasResult = data?.data || data?.output_url;
    if (hasResult && (["completed", "complete", "succeeded", "success"].includes(status) || Number(data?.progress ?? 0) >= 1)) {
      const externalData = data.output_url && !data.data ? await fetchOutputUrl(data.output_url) : null;
      return { ...data, data: data.data ?? externalData ?? null };
    }
    await sleep(2_000);
  }
  throw new Error(`LandingAI parse timed out after ${args.timeoutMs}ms${last?.status ? ` (last status: ${last.status})` : ""}`);
}

async function runExtract(args: {
  endpoint: string;
  apiKey: string;
  model: string;
  markdown: string;
}) {
  if (!args.markdown.trim()) return null;
  const form = new FormData();
  form.append("schema", JSON.stringify(landingAiSchema()));
  form.append("markdown", new Blob([args.markdown], { type: "text/markdown" }), "drawing.md");
  form.append("model", args.model || DEFAULT_EXTRACT_MODEL);
  const response = await fetch(`${args.endpoint}/v1/ade/extract`, {
    method: "POST",
    headers: authHeaders(args.apiKey),
    body: form,
  });
  const data = await safeJson(response) as any;
  if (!response.ok) {
    throw new Error(`LandingAI extract failed: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

function configSnapshot(cfg: LandingAiCfg) {
  return { endpoint: cfg.endpoint, parseModel: cfg.parseModel, extractModel: cfg.extractModel };
}

function configFingerprint(cfg: LandingAiCfg) {
  return hashFingerprint(["landingAi", cfg.endpoint, cfg.parseModel, cfg.extractModel]);
}

async function assembleResult(args: {
  cacheKey: string;
  jobId: string;
  job: any;
  cfg: LandingAiCfg;
  includeExtraction: boolean;
  onProgress?: ParseProviderInput["onProgress"];
}): Promise<ProviderResult> {
  const parseData = (args.job?.data && typeof args.job.data === "object") ? args.job.data : {};
  const markdown = typeof parseData.markdown === "string" ? parseData.markdown : "";

  let extract: ProviderResult["extract"] = null;
  if (args.includeExtraction && markdown.trim() && args.cfg.apiKey) {
    try {
      const extractData = await runExtract({
        endpoint: args.cfg.endpoint,
        apiKey: args.cfg.apiKey,
        model: args.cfg.extractModel,
        markdown,
      });
      if (extractData) {
        extract = {
          extraction: (extractData as any).extraction ?? {},
          extractionMetadata: (extractData as any).extraction_metadata ?? {},
          metadata: (extractData as any).metadata ?? {},
        };
      }
    } catch (error) {
      await args.onProgress?.({
        phase: "Drawing Evidence",
        detail: `LandingAI parse finished but extract failed: ${error instanceof Error ? error.message : String(error)}`,
        jobId: args.jobId,
      });
    }
  }

  return {
    provider: "landingAi",
    cacheKey: args.cacheKey,
    status: "completed",
    parse: {
      metadata: parseData.metadata ?? args.job?.metadata ?? {},
      markdown,
      chunks: Array.isArray(parseData.chunks) ? parseData.chunks : [],
      splits: Array.isArray(parseData.splits) ? parseData.splits : [],
      grounding: parseData.grounding ?? {},
    },
    extract,
    job: {
      jobId: args.jobId,
      status: args.job?.status ?? "completed",
      progress: args.job?.progress ?? null,
      receivedAt: args.job?.received_at ?? null,
    },
    meta: {
      provider: "landingAi",
      model: args.cfg.parseModel,
      endpoint: args.cfg.endpoint,
      config: configSnapshot(args.cfg),
    },
  };
}

/**
 * Settings-bound async lifecycle handle for LandingAI.
 * Used by vision-routes.ts to surface "running" state immediately and resume polling later.
 */
export interface LandingAiBoundHandle {
  configSnapshot: Record<string, unknown>;
  cacheKeyFor(sourceHash: string): string;
  startJob(input: ParseProviderInput): Promise<{ jobId: string; cacheKey: string; running: ProviderResult }>;
  resumeJob(args: {
    jobId: string;
    sourceHash: string;
    fileName: string;
    includeExtraction?: boolean;
    onProgress?: ParseProviderInput["onProgress"];
    timeoutMs?: number;
  }): Promise<ProviderResult>;
}

export function landingAiAsyncBound(settings: IntegrationSettingsSnapshot): LandingAiBoundHandle {
  const cfg = readSettings(settings);
  const fingerprint = configFingerprint(cfg);
  return {
    configSnapshot: configSnapshot(cfg),
    cacheKeyFor: (sourceHash: string) => `${sourceHash}:${fingerprint}`,

    async startJob(input: ParseProviderInput) {
      if (!cfg.apiKey) throw new Error("LandingAI api key not configured");
      const cacheKey = `${input.sourceHash}:${fingerprint}`;
      const form = new FormData();
      const blob = new Blob([new Uint8Array(input.pdfBytes)], { type: "application/pdf" });
      form.append("document", blob, input.fileName || "drawing.pdf");
      form.append("model", cfg.parseModel);
      form.append("split", "page");

      const response = await fetch(`${cfg.endpoint}/v1/ade/parse/jobs`, {
        method: "POST",
        headers: authHeaders(cfg.apiKey),
        body: form,
      });
      const data = await safeJson(response) as any;
      if (!response.ok) {
        throw new Error(`LandingAI parse start failed: ${response.status} ${JSON.stringify(data).slice(0, 500)}`);
      }
      const jobId = String(data?.job_id ?? data?.jobId ?? "");
      if (!jobId) throw new Error("LandingAI did not return a parse job id");

      const running: ProviderResult = {
        provider: "landingAi",
        cacheKey,
        status: "running",
        parse: { markdown: "", chunks: [] },
        extract: null,
        job: {
          jobId,
          status: data?.status ?? "running",
          progress: data?.progress ?? null,
          receivedAt: data?.received_at ?? null,
        },
        meta: { provider: "landingAi", model: cfg.parseModel, endpoint: cfg.endpoint, config: configSnapshot(cfg) },
      };
      return { jobId, cacheKey, running };
    },

    async resumeJob(args) {
      if (!cfg.apiKey) throw new Error("LandingAI api key not configured");
      const cacheKey = `${args.sourceHash}:${fingerprint}`;
      const job = await pollParseJob({
        endpoint: cfg.endpoint,
        apiKey: cfg.apiKey,
        jobId: args.jobId,
        timeoutMs: args.timeoutMs ?? 15 * 60_000,
      });
      return await assembleResult({
        cacheKey,
        jobId: args.jobId,
        job,
        cfg,
        includeExtraction: args.includeExtraction !== false,
        onProgress: args.onProgress,
      });
    },
  };
}

class LandingAiProvider implements DrawingProvider {
  readonly id = "landingAi" as const;

  isConfigured(settings: IntegrationSettingsSnapshot): boolean {
    return !!String(settings.landingAiApiKey ?? "").trim();
  }

  configFingerprint(settings: IntegrationSettingsSnapshot): string {
    return configFingerprint(readSettings(settings));
  }

  modelLabel(settings: IntegrationSettingsSnapshot): string {
    return readSettings(settings).parseModel;
  }

  configSnapshot(settings: IntegrationSettingsSnapshot): Record<string, unknown> {
    return configSnapshot(readSettings(settings));
  }

  async parse(input: ParseProviderInput, settings: IntegrationSettingsSnapshot): Promise<ProviderResult> {
    const cfg = readSettings(settings);
    const cacheKey = `${input.sourceHash}:${configFingerprint(cfg)}`;
    if (!cfg.apiKey) {
      return {
        provider: "landingAi",
        cacheKey,
        status: "failed",
        parse: { markdown: "", chunks: [] },
        extract: null,
        error: "missing_api_key",
        meta: { provider: "landingAi", model: cfg.parseModel, endpoint: cfg.endpoint, config: configSnapshot(cfg) },
      };
    }
    const handle = landingAiAsyncBound(settings);
    const started = await handle.startJob(input);
    return await handle.resumeJob({
      jobId: started.jobId,
      sourceHash: input.sourceHash,
      fileName: input.fileName,
      includeExtraction: input.includeExtraction !== false,
      timeoutMs: input.pollTimeoutMs ?? 120_000,
      onProgress: input.onProgress,
    });
  }
}

export function createLandingAiProvider(): DrawingProvider {
  return new LandingAiProvider();
}

/**
 * Gemini drawing-extraction provider.
 *
 * One implementation serves both Gemini 2.5 Pro and Gemini 2.5 Flash — the
 * concrete model id is selected per provider variant (`geminiPro` vs `geminiFlash`).
 * Uses the REST `generateContent` endpoint with PDF input via inline_data.
 *
 * Returns the same `ProviderResult` shape as LandingAI: parse.markdown,
 * parse.chunks (with grounding), and extract.extraction (drawing fields).
 */

import type {
  DrawingProvider,
  DrawingProviderId,
  IntegrationSettingsSnapshot,
  ParseProviderInput,
  ProviderChunk,
  ProviderResult,
} from "./types.js";
import { hashFingerprint, encodeBase64 } from "./util.js";

const DEFAULT_PRO_MODEL = "gemini-2.5-pro";
const DEFAULT_FLASH_MODEL = "gemini-2.5-flash";

interface GeminiCfg {
  apiKey: string;
  model: string;
  thinkingEnabled: boolean;
}

function readSettings(settings: IntegrationSettingsSnapshot, variant: "geminiPro" | "geminiFlash"): GeminiCfg {
  const apiKey = String(settings.geminiApiKey ?? "").trim();
  const model = variant === "geminiPro"
    ? (String(settings.geminiProModel ?? "").trim() || DEFAULT_PRO_MODEL)
    : (String(settings.geminiFlashModel ?? "").trim() || DEFAULT_FLASH_MODEL);
  const thinkingEnabled = settings.geminiThinkingEnabled !== false;
  return { apiKey, model, thinkingEnabled };
}

const VERBOSE_PROMPT = `You are a construction/engineering drawing parser modeled after Landing.ai's Agentic Document Extraction. Output ONE JSON object with the exact keys below. Be VERBOSE on figures — describe every visible element.

{
  "markdown": "<full markdown of the drawing's content. Render text/labels/dimensions verbatim. For each figure (drawing view, schematic, photo), write a verbose paragraph describing: the view name, what is depicted, every callout/label/annotation, every dimension and what it measures, every component visible, spatial relationships between components, and any symbols. Use heading levels per page. Preserve title-block and schedule tables as markdown tables.>",
  "chunks": [
    {
      "id": "<short id>",
      "type": "text" | "table" | "figure" | "attestation" | "marginalia",
      "page": <int, 1-indexed>,
      "bbox": {"top": <0-1>, "left": <0-1>, "right": <0-1>, "bottom": <0-1>},
      "content": "<for figure chunks: a multi-sentence verbose visual description naming the view, every component, every dimension and its target, every annotation/symbol, and spatial relationships. for text/table chunks: verbatim content as markdown.>"
    }
  ],
  "extraction": {
    "drawing_title": "<from title block>",
    "drawing_number": "<dwg# from title block>",
    "revision": "",
    "sheet_number": "",
    "scale": "",
    "customer": "",
    "project": "",
    "discipline": "<mechanical|structural|electrical|civil|process|architectural>",
    "drawing_type": "",
    "key_quantities": [{"name": "...", "value": "...", "unit": "..."}],
    "bom_or_parts_rows": [{"item": "...", "description": "...", "quantity": "...", "unit": "...", "material": "..."}],
    "schedules": [{"name": "...", "rows": []}],
    "important_notes": ["..."],
    "open_questions": ["..."]
  }
}

CRITICAL:
- bbox values are floats 0-1, NOT pixels. Divide pixel coords by page width/height before emitting.
- For figure chunks: the description must mention every visible component, dimension, and label — match Landing.ai's verbose narrative quality (>= ~400 chars per non-trivial figure).
- For attestation chunks: describe the stamp/signature/approval block contents verbatim plus visual details (color, layout, what's signed/unsigned).
- Never hallucinate values. If a label is unclear, mark with "(illegible)" or omit. Do NOT add prefixes/suffixes that aren't in the original (do not add "0 " before drawing numbers, do not add unrelated words to titles).
- Output ONLY valid JSON, no markdown fences.`;

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}

async function callGemini(args: {
  model: string;
  apiKey: string;
  pdfBase64: string;
  thinkingEnabled: boolean;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: GeminiResponse["usageMetadata"] }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`;
  const generationConfig: Record<string, unknown> = {
    temperature: 0.1,
    responseMimeType: "application/json",
    maxOutputTokens: 32768,
  };
  if (!args.thinkingEnabled) {
    generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }
  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: "application/pdf", data: args.pdfBase64 } },
        { text: VERBOSE_PROMPT },
      ],
    }],
    generationConfig,
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: args.signal,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini ${args.model} failed: ${response.status} ${raw.slice(0, 500)}`);
  }
  let parsed: GeminiResponse;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error(`Gemini ${args.model}: response was not JSON: ${raw.slice(0, 300)}`); }
  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error(`Gemini ${args.model}: missing candidates[0].content.parts[0].text`);
  }
  return { text, usage: parsed.usageMetadata };
}

interface ParsedGeminiOutput {
  markdown?: unknown;
  chunks?: unknown;
  extraction?: unknown;
}

function coerceBBox(value: unknown): { top: number; left: number; right: number; bottom: number } | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const top = Number(v.top);
  const left = Number(v.left);
  const right = Number(v.right);
  const bottom = Number(v.bottom);
  if (![top, left, right, bottom].every(Number.isFinite)) return null;
  // If any value > 1.5 we assume pixel coords were emitted; coerce by max-normalizing.
  const max = Math.max(top, left, right, bottom);
  if (max > 1.5) {
    return { top: top / max, left: left / max, right: right / max, bottom: bottom / max };
  }
  return { top, left, right, bottom };
}

function coerceChunks(value: unknown): ProviderChunk[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const type = String(raw.type ?? "text");
    const content = String(raw.content ?? raw.markdown ?? "");
    if (!content) return [];
    const page = Number.isFinite(Number(raw.page)) ? Number(raw.page) : 1;
    const bbox = coerceBBox(raw.bbox) ?? coerceBBox((raw.grounding as any)?.[0]?.box);
    const grounding = bbox ? [{ page, box: bbox }] : undefined;
    const id = String(raw.id ?? `g-${page}-${index}`);
    return [{
      id,
      type,
      page,
      markdown: content,
      grounding,
    } satisfies ProviderChunk];
  });
}

function coerceExtraction(value: unknown): ProviderResult["extract"] {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  // If extraction object is empty, treat as null.
  const hasAny = Object.values(e).some((v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0));
  if (!hasAny) return null;
  return {
    extraction: e as Record<string, unknown>,
    extractionMetadata: {},
    metadata: {},
  };
}

function tryParseJson(text: string): { ok: true; value: ParsedGeminiOutput } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as ParsedGeminiOutput };
  } catch (error) {
    // Attempt salvage: trim trailing chunks that may be truncated.
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace > 0) {
      try {
        return { ok: true, value: JSON.parse(text.slice(0, lastBrace + 1)) as ParsedGeminiOutput };
      } catch {
        // fall through
      }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

class GeminiProvider implements DrawingProvider {
  readonly id: DrawingProviderId;
  private readonly variant: "geminiPro" | "geminiFlash";

  constructor(variant: "geminiPro" | "geminiFlash") {
    this.variant = variant;
    this.id = variant;
  }

  isConfigured(settings: IntegrationSettingsSnapshot): boolean {
    return !!String(settings.geminiApiKey ?? "").trim();
  }

  configFingerprint(settings: IntegrationSettingsSnapshot): string {
    const cfg = readSettings(settings, this.variant);
    return hashFingerprint([this.variant, cfg.model, cfg.thinkingEnabled ? "think" : "nothink"]);
  }

  modelLabel(settings: IntegrationSettingsSnapshot): string {
    return readSettings(settings, this.variant).model;
  }

  configSnapshot(settings: IntegrationSettingsSnapshot): Record<string, unknown> {
    const cfg = readSettings(settings, this.variant);
    return { model: cfg.model, thinkingEnabled: cfg.thinkingEnabled };
  }

  async parse(input: ParseProviderInput, settings: IntegrationSettingsSnapshot): Promise<ProviderResult> {
    const cfg = readSettings(settings, this.variant);
    const cacheKey = `${input.sourceHash}:${this.configFingerprint(settings)}`;
    const meta = {
      provider: this.id,
      model: cfg.model,
      endpoint: "https://generativelanguage.googleapis.com",
      config: this.configSnapshot(settings),
    };
    if (!cfg.apiKey) {
      return {
        provider: this.id, cacheKey, status: "failed",
        parse: { markdown: "", chunks: [] }, extract: null,
        error: "missing_api_key", meta,
      };
    }

    await input.onProgress?.({
      phase: "Drawing Evidence",
      detail: `Calling Gemini ${cfg.model} (${cfg.thinkingEnabled ? "thinking" : "no-think"}) for ${input.fileName}`,
    });

    const pdfBase64 = encodeBase64(input.pdfBytes);
    let response: Awaited<ReturnType<typeof callGemini>>;
    try {
      response = await callGemini({
        model: cfg.model,
        apiKey: cfg.apiKey,
        pdfBase64,
        thinkingEnabled: cfg.thinkingEnabled,
        signal: input.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        provider: this.id, cacheKey, status: "failed",
        parse: { markdown: "", chunks: [] }, extract: null,
        error: message, meta,
      };
    }

    const parsed = tryParseJson(response.text);
    if (!parsed.ok) {
      return {
        provider: this.id, cacheKey, status: "failed",
        parse: { markdown: "", chunks: [] }, extract: null,
        error: `gemini_json_parse_error: ${parsed.error}`,
        meta: { ...meta, config: { ...meta.config, rawResponse: response.text.slice(0, 1000) } },
      };
    }

    const out = parsed.value;
    const markdown = typeof out.markdown === "string" ? out.markdown : "";
    const chunks = coerceChunks(out.chunks);
    const extract = coerceExtraction(out.extraction);

    return {
      provider: this.id,
      cacheKey,
      status: "completed",
      parse: {
        markdown,
        chunks,
        metadata: { usage: response.usage ?? {} },
      },
      extract,
      job: { status: "completed", progress: 1 },
      meta,
    };
  }
}

export function createGeminiProProvider(): DrawingProvider {
  return new GeminiProvider("geminiPro");
}

export function createGeminiFlashProvider(): DrawingProvider {
  return new GeminiProvider("geminiFlash");
}

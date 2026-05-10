import { createLLMAdapter } from "@bidwright/agent";
import type { ChatContentBlock, ChatMessage } from "@bidwright/agent";

/**
 * Site-Photo Takeoff Service
 *
 * Accepts one or more site photos plus an optional focus prompt, sends them
 * to the user's configured LLM runtime (Anthropic / OpenAI / Gemini / etc),
 * and returns a structured Bill of Materials the estimator can review and
 * convert into worksheet line items.
 *
 * Runtime-agnostic by design: never assumes Claude. The caller resolves the
 * user's provider/apiKey/model from getEffectiveIntegrations() and passes
 * them in. If the chosen provider doesn't support vision, the service
 * surfaces a clear actionable error instead of silently falling back.
 */

export interface PhotoTakeoffImage {
  /** Base64-encoded image bytes — no data: URL prefix. */
  data: string;
  /** MIME type, e.g. "image/jpeg" / "image/png" / "image/webp" / "image/heic". */
  mimeType: string;
  /** Optional user-supplied label that helps the LLM disambiguate ("North
   *  wall demo", "Bathroom 2 finishes"). Empty string is fine. */
  caption?: string;
}

export interface PhotoTakeoffCategory {
  /** EntityCategory.id from the organization's category taxonomy. The LLM
   *  picks one of these per row; the API enforces validity against the
   *  org's actual category list when applying. */
  id: string;
  name: string;
  entityType: string;
  defaultUom: string;
  shortform?: string | null;
}

export interface PhotoTakeoffRequest {
  /** One or more images. Bounded by the calling route — service trusts the
   *  caller to keep total payload size reasonable. */
  images: PhotoTakeoffImage[];
  /** Free-text user guidance ("focus on demolition", "ignore the existing
   *  HVAC", "the orange marker is 1 meter for scale"). Concatenated into
   *  the user prompt as-is, so estimator agency is preserved. */
  focusPrompt?: string;
  /** Available estimate categories so the LLM can tag each BOM row with
   *  the right organization-defined bucket instead of inventing one or
   *  defaulting to Uniformat. */
  categories: PhotoTakeoffCategory[];
  /** Optional context lines describing the project / worksheet so the LLM
   *  produces scope appropriate to the estimate (residential vs commercial,
   *  etc). Each line becomes a system-prompt bullet. */
  projectContext?: string[];
  /** Provider config sourced from getEffectiveIntegrations(userId). The
   *  service does NOT read env or settings — it's a pure function of its
   *  inputs so route-level credential precedence stays in one place. */
  llm: {
    provider: string;
    apiKey: string;
    model: string;
  };
}

export interface PhotoTakeoffLineItem {
  /** Best-effort short label — UI uses as the entityName seed. */
  description: string;
  /** Quantity inferred from the image. May be a rough estimate; UI surfaces
   *  the confidence so the user can sanity-check. */
  quantity: number;
  /** Unit of measure. Should be one of the category's defaultUom or a
   *  common UOM (SF, LF, EA, CY, HR). The UI normalizes case before apply. */
  uom: string;
  /** id of one of the supplied categories. May be empty if the LLM was
   *  unsure — the UI shows a category picker and forces a choice on apply. */
  categoryId: string;
  /** Free-text rationale + which image(s) backed the inference. Lives on
   *  the worksheet item's sourceNotes so the audit trail is preserved. */
  notes: string;
  /** 0..1 — the LLM's self-reported confidence. Surfaced as a chip so the
   *  estimator knows where to focus their review. */
  confidence: number;
  /** Indices into the request.images array, identifying which photo(s)
   *  contributed to this row. */
  sourceImageIndexes: number[];
}

export interface PhotoTakeoffResult {
  items: PhotoTakeoffLineItem[];
  /** A concise narrative summarising what the LLM saw across the photos —
   *  helps the estimator confirm the photos were interpreted correctly. */
  summary: string;
  /** Non-fatal warnings (clipped image, low confidence, missing categories,
   *  etc). Empty array on a clean run. */
  warnings: string[];
}

/**
 * Conservative list of providers we currently know speak the vision shape
 * in our agent adapters. If a user has selected a provider not in this set,
 * we 400 with a clear error instead of guessing.
 *
 * Keep this list in sync with the adapters under packages/agent/src/llm/adapters.
 * Anthropic's adapter handles image blocks natively; the OpenAI adapter was
 * extended in this same change to translate image content blocks into
 * `image_url` content parts.
 */
const VISION_CAPABLE_PROVIDERS = new Set(["anthropic", "openai", "openrouter"]);

function trimText(value: string, max = 240): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Build the system prompt. Structured + constrained so the LLM returns
 * machine-parseable JSON. We avoid prescribing a code system (Uniformat)
 * because the user's org may not run on it — instead we hand the model the
 * EntityCategory list as the SoT and tell it to pick one per row.
 */
function buildSystemPrompt(categories: PhotoTakeoffCategory[], projectContext: string[] = []): string {
  const categoryLines = categories
    .map((c) =>
      `  - { id: "${c.id}", name: "${c.name}", entityType: "${c.entityType}", defaultUom: "${c.defaultUom}" }`,
    )
    .join("\n");
  const contextLines = projectContext.length
    ? `\nProject context (use to set scope appropriately, e.g. residential vs commercial vs industrial):\n${projectContext.map((line) => `  - ${line}`).join("\n")}\n`
    : "";
  return `You are a senior construction estimator extracting a Bill of Materials from one or more site photographs.
${contextLines}
Your job:
- Identify the construction scope visible in the photos.
- For each distinct work item, output a JSON object with: description, quantity, uom, categoryId, notes, confidence, sourceImageIndexes.
- Pick categoryId from EXACTLY this list of organization-defined categories — do not invent new ones:
${categoryLines}
- If a row genuinely doesn't fit any category, set categoryId to "" and explain in notes; the estimator will assign one manually.
- Quantity must be a rough but defensible numeric estimate. Use the user's focus prompt for measurement hints (markers, ref objects, dimensions called out).
- UOM should match the category's defaultUom when applicable; otherwise pick the standard for that scope (SF, LF, EA, CY, HR, SY, CF, GAL, TON).
- sourceImageIndexes is an array of 0-based indexes into the photos you were sent. Use multiple indexes when a single item spans photos.
- confidence is 0.0 to 1.0. Be conservative — 0.3 for "rough guess from poor angle", 0.7 for "clearly visible with reasonable reference", 0.9 for "explicit measurements visible".

Output ONLY a JSON object of shape:
{
  "summary": "<one-paragraph narrative of what you saw across the photos>",
  "items": [ <line item objects> ],
  "warnings": [ <string warnings — empty array if none> ]
}

No markdown fences. No prose outside the JSON.`;
}

/**
 * Extract the JSON object from a model response. Handles two failure modes:
 *  - Model wrapped the JSON in markdown fences (```json ... ```).
 *  - Model emitted a prelude before the JSON.
 * Throws a clear error when the response isn't recoverable so the caller
 * can surface it instead of silently returning empty results.
 */
function parseModelJson(raw: string): { summary: string; items: unknown[]; warnings: string[] } {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Photo-takeoff model response was not valid JSON. Snippet: ${trimText(raw, 240)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Photo-takeoff model response did not contain a top-level JSON object.");
  }
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const items = Array.isArray(obj.items) ? obj.items : [];
  const warnings = Array.isArray(obj.warnings) ? obj.warnings.filter((w): w is string => typeof w === "string") : [];
  return { summary, items, warnings };
}

function normalizeRow(
  raw: unknown,
  categories: PhotoTakeoffCategory[],
  imageCount: number,
  warnings: string[],
): PhotoTakeoffLineItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const description = typeof r.description === "string" ? r.description.trim() : "";
  if (!description) return null;
  const quantity =
    typeof r.quantity === "number" && Number.isFinite(r.quantity)
      ? r.quantity
      : Number(r.quantity ?? 0);
  const uom = typeof r.uom === "string" ? r.uom.trim() : "";
  const requestedCategoryId = typeof r.categoryId === "string" ? r.categoryId.trim() : "";
  // Enforce that the LLM picked from our category list. Strangers map to "".
  const matched = categories.find((c) => c.id === requestedCategoryId);
  const categoryId = matched ? matched.id : "";
  if (requestedCategoryId && !matched) {
    warnings.push(
      `LLM proposed category "${requestedCategoryId}" not in the organization list. Row "${trimText(description, 80)}" left uncategorized for manual assignment.`,
    );
  }
  const notes = typeof r.notes === "string" ? r.notes.trim() : "";
  const confidenceRaw = typeof r.confidence === "number" ? r.confidence : Number(r.confidence ?? 0.5);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, confidenceRaw))
    : 0.5;
  const sourceImageIndexes = Array.isArray(r.sourceImageIndexes)
    ? r.sourceImageIndexes
        .map((n) => (typeof n === "number" ? n : Number(n)))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < imageCount)
    : [];
  return { description, quantity, uom, categoryId, notes, confidence, sourceImageIndexes };
}

export async function generatePhotoTakeoff(input: PhotoTakeoffRequest): Promise<PhotoTakeoffResult> {
  if (!input.images.length) {
    throw new Error("At least one image is required.");
  }
  if (!input.llm.apiKey) {
    throw new Error("No LLM API key configured. Set one in Settings > Integrations before running photo takeoff.");
  }
  if (!VISION_CAPABLE_PROVIDERS.has(input.llm.provider)) {
    throw new Error(
      `Photo takeoff requires a vision-capable provider. "${input.llm.provider}" is not currently supported — switch to Anthropic, OpenAI, or OpenRouter in Settings > Integrations.`,
    );
  }
  if (!input.categories.length) {
    // Empty category list isn't a hard error — the LLM can still produce
    // rows, they'll just all surface as "uncategorized" for the user to
    // assign on apply. Warn so the caller can surface it.
  }

  const adapter = createLLMAdapter({
    provider: input.llm.provider as any,
    apiKey: input.llm.apiKey,
    model: input.llm.model,
  });

  // Build the user message: an interleaved sequence of image blocks plus a
  // single trailing text block carrying the focus prompt. Image-then-text
  // is well-supported across vision providers; mixing them keeps the prompt
  // anchored to a specific photo when the user names one in the focus text.
  const content: ChatContentBlock[] = [];
  input.images.forEach((image, index) => {
    content.push({
      type: "image",
      imageData: image.data,
      imageMimeType: image.mimeType,
    });
    const captionLine = image.caption ? `Caption: ${image.caption}` : "";
    content.push({
      type: "text",
      text: [`Photo ${index} of ${input.images.length}.`, captionLine].filter(Boolean).join(" "),
    });
  });
  const focus = input.focusPrompt?.trim();
  content.push({
    type: "text",
    text: focus
      ? `User focus / measurement hints:\n${focus}\n\nProduce the JSON BOM now.`
      : "Produce the JSON BOM now.",
  });

  const systemPrompt = buildSystemPrompt(input.categories, input.projectContext);
  const messages: ChatMessage[] = [{ role: "user", content }];

  const response = await adapter.chat({
    model: input.llm.model,
    systemPrompt,
    messages,
    // Vision responses are concise relative to model-derivative narratives;
    // 4k tokens accommodates a typical 30–50 row BOM with full notes.
    maxTokens: 4096,
    temperature: 0.2,
  });

  const block = response.content[0];
  const rawText =
    typeof block === "string"
      ? block
      : (block as { text?: string })?.text ?? "";

  const parsed = parseModelJson(rawText);
  const warnings = [...parsed.warnings];
  const items = parsed.items
    .map((row) => normalizeRow(row, input.categories, input.images.length, warnings))
    .filter((row): row is PhotoTakeoffLineItem => row !== null);

  if (!items.length) {
    warnings.push("Model returned no usable line items. Try a more focused prompt or a higher-resolution photo.");
  }

  return {
    items,
    summary: parsed.summary.trim(),
    warnings,
  };
}

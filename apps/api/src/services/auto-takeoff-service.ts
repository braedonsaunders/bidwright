// Auto-takeoff line-item suggestions for a takeoff annotation.
//
// Given an annotation the user has drawn (a wall measurement, a count of
// receptacles, an area for drywall, etc.), this service asks Claude:
// "looks like 5/8 drywall — here are line items that match what you've
// already got in your catalog / rate schedule." The user can accept any
// of them and the worksheet auto-fills.
//
// V1 is text-only (no image cropping). The annotation's label, type, and
// measured quantity are usually enough — the user already named it
// ("12mm gyproc accent wall") when they drew it. If we want vision later,
// we can crop the bbox and pass it through the same image path the
// /api/cli ask-AI endpoint uses.
//
// Falls back to an empty list when no LLM key is configured (instead of
// throwing) so the UI degrades gracefully.

import { prisma } from "@bidwright/db";
import { createLLMAdapter } from "@bidwright/agent";

export type SuggestionKind = "catalog" | "rateScheduleItem";

export interface LineItemSuggestion {
  kind: SuggestionKind;
  /** CatalogItem.id or RateScheduleItem.id */
  id: string;
  /** Display name of the item (so the UI can render before resolving). */
  name: string;
  /** Item code (if any). */
  code: string;
  /** Item unit (EA, M, M2, HR, etc.). */
  unit: string;
  /** One-line reason this item matches the annotation. */
  reasoning: string;
  /** 0..1 — Claude's confidence that this item fits. */
  confidence: number;
  /** Suggested quantity to apply (usually annotation.measurement.value). */
  recommendedQuantity: number;
}

export interface SuggestLineItemsResult {
  annotationId: string;
  suggestions: LineItemSuggestion[];
  warnings: string[];
}

interface AnnotationRow {
  id: string;
  projectId: string;
  annotationType: string;
  label: string;
  groupName: string;
  measurement: any;
}

interface CandidateItem {
  kind: SuggestionKind;
  id: string;
  code: string;
  name: string;
  unit: string;
}

const MAX_CANDIDATES_PER_KIND = 60;
const MAX_SUGGESTIONS = 5;

function extractText(response: { content: Array<unknown> }): string {
  const block = response.content[0];
  if (typeof block === "string") return block;
  return (block as { text?: string }).text ?? "";
}

function extractJson(text: string): string {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1]!.trim();
  return text.trim();
}

function summariseMeasurement(m: any): { value: number; unit: string } {
  if (!m || typeof m !== "object") return { value: 0, unit: "" };
  // measurement shapes vary by annotation type — pick the most useful field.
  const value =
    Number(m.area) ||
    Number(m.length) ||
    Number(m.value) ||
    Number(m.count) ||
    0;
  const unit = String(m.unit ?? m.units ?? "");
  return { value, unit };
}

function describeAnnotationType(t: string): string {
  if (t.startsWith("area-")) return "area takeoff";
  if (t.startsWith("linear")) return "linear takeoff";
  if (t.startsWith("count")) return "count takeoff";
  return t;
}

export async function suggestLineItemsForAnnotation(
  projectId: string,
  annotationId: string,
): Promise<SuggestLineItemsResult> {
  const warnings: string[] = [];

  const annotation = (await prisma.takeoffAnnotation.findFirst({
    where: { id: annotationId, projectId },
    select: {
      id: true,
      projectId: true,
      annotationType: true,
      label: true,
      groupName: true,
      measurement: true,
    },
  })) as AnnotationRow | null;

  if (!annotation) {
    return {
      annotationId,
      suggestions: [],
      warnings: ["Annotation not found for this project."],
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!project) {
    return {
      annotationId,
      suggestions: [],
      warnings: ["Project not found."],
    };
  }

  // Pull candidate items from the org's catalogs (org-scoped + project-scoped)
  // and rate schedules. Cap each list — 60 names is plenty for an LLM prompt.
  const catalogs = await prisma.catalog.findMany({
    where: {
      OR: [
        { organizationId: project.organizationId },
        { projectId },
      ],
    },
    select: { id: true },
  });
  const catalogItems = catalogs.length
    ? await prisma.catalogItem.findMany({
        where: { catalogId: { in: catalogs.map((c) => c.id) } },
        select: { id: true, code: true, name: true, unit: true },
        orderBy: { updatedAt: "desc" },
        take: MAX_CANDIDATES_PER_KIND,
      })
    : [];

  const rateSchedules = await prisma.rateSchedule.findMany({
    where: {
      OR: [
        { organizationId: project.organizationId },
        { projectId },
      ],
    },
    select: { id: true },
  });
  const rateItems = rateSchedules.length
    ? await prisma.rateScheduleItem.findMany({
        where: { scheduleId: { in: rateSchedules.map((r) => r.id) } },
        select: { id: true, code: true, name: true, unit: true },
        take: MAX_CANDIDATES_PER_KIND,
      })
    : [];

  const candidates: CandidateItem[] = [
    ...catalogItems.map((c) => ({
      kind: "catalog" as const,
      id: c.id,
      code: c.code ?? "",
      name: c.name ?? "",
      unit: c.unit ?? "",
    })),
    ...rateItems.map((r) => ({
      kind: "rateScheduleItem" as const,
      id: r.id,
      code: r.code ?? "",
      name: r.name ?? "",
      unit: r.unit ?? "",
    })),
  ].filter((c) => c.name.trim().length > 0);

  if (candidates.length === 0) {
    return {
      annotationId,
      suggestions: [],
      warnings: [
        "No catalog or rate-schedule items found for this organization. Add items to your catalog so AI can suggest matches.",
      ],
    };
  }

  const apiKey =
    process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return {
      annotationId,
      suggestions: [],
      warnings: [
        "No LLM API key configured — cannot generate AI suggestions.",
      ],
    };
  }
  const provider = process.env.ANTHROPIC_API_KEY
    ? "anthropic"
    : process.env.OPENAI_API_KEY
      ? "openai"
      : "anthropic";
  const model =
    process.env.LLM_MODEL ??
    (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o");

  const measurement = summariseMeasurement(annotation.measurement);
  const annotationDescription = [
    `Label: "${annotation.label || "(unlabelled)"}"`,
    `Type: ${describeAnnotationType(annotation.annotationType)} (${annotation.annotationType})`,
    annotation.groupName ? `Group: ${annotation.groupName}` : null,
    measurement.value > 0
      ? `Measured quantity: ${measurement.value} ${measurement.unit}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Build a compact, indexed candidate list. We send the index back so we
  // don't have to fuzzy-match names later.
  const candidateLines = candidates
    .map((c, i) => {
      const code = c.code ? `[${c.code}] ` : "";
      const unit = c.unit ? ` (${c.unit})` : "";
      return `${i}. ${c.kind === "catalog" ? "CAT" : "RATE"} ${code}${c.name}${unit}`;
    })
    .join("\n");

  const systemPrompt =
    "You are a construction estimator helping a colleague turn a takeoff annotation into worksheet line items. " +
    "From the candidate items below, pick the few that best match the annotation. " +
    'Return ONLY a JSON object: {"suggestions":[{"index":N,"reasoning":"...","confidence":0..1}]} — at most 5 items, ranked best first. ' +
    "If nothing fits, return an empty array. Never invent items not in the candidate list.";

  const userPrompt = [
    "ANNOTATION:",
    annotationDescription,
    "",
    "CANDIDATES (pick by index):",
    candidateLines,
  ].join("\n");

  let suggestions: LineItemSuggestion[] = [];
  try {
    const adapter = createLLMAdapter({
      provider: provider as any,
      apiKey,
      model,
    });
    const response = await adapter.chat({
      model,
      systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1024,
      temperature: 0.2,
    });
    const text = extractText(response);
    const parsed = JSON.parse(extractJson(text)) as {
      suggestions?: Array<{
        index?: number;
        reasoning?: string;
        confidence?: number;
      }>;
    };
    const raw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    for (const s of raw) {
      if (typeof s?.index !== "number") continue;
      const cand = candidates[s.index];
      if (!cand) continue;
      const confidence = Math.max(
        0,
        Math.min(1, Number(s.confidence ?? 0.5)),
      );
      suggestions.push({
        kind: cand.kind,
        id: cand.id,
        name: cand.name,
        code: cand.code,
        unit: cand.unit,
        reasoning: String(s.reasoning ?? "").slice(0, 240),
        confidence,
        recommendedQuantity: measurement.value,
      });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
  } catch (err) {
    warnings.push(
      `AI suggestion failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { annotationId, suggestions: [], warnings };
  }

  if (suggestions.length === 0) {
    warnings.push("AI returned no matching items.");
  }

  return { annotationId, suggestions, warnings };
}

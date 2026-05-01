// Auto-detect drawing scale from a page's title block.
//
// Construction drawings spell their scale out in plain text — usually in the
// bottom-right title block. This service runs the page through Azure
// Document Intelligence (already wired into the PDF parser), pulls all text
// out, and scans for common scale notations:
//
//   "SCALE: 1:50",  "1:100",  "1/4\" = 1'-0\"",  "1\" = 20'"
//
// The matches come back as drawing-scale presets the UI can drop in as
// chips next to the metric / imperial defaults, so the user doesn't even
// have to type a known scale — just pick the one the drawing already says.
//
// Falls back gracefully when no Azure key is set: returns an empty list
// rather than failing.

import { readFile } from "node:fs/promises";
import { prisma } from "@bidwright/db";
import { createPdfParser } from "@bidwright/ingestion";
import { resolveApiPath } from "../paths.js";

export interface DetectedScale {
  raw: string;
  kind: "metric" | "imperial";
  label: string;
  /** paperInches × multiplier = realValue (matches our scalePresets math) */
  multiplier: number;
  unit: "m" | "ft";
  /** 0..1 — higher when the match is near a "SCALE" keyword. */
  confidence: number;
}

export interface DetectScaleResult {
  ocrText: string;
  detectedScales: DetectedScale[];
  detectedDiscipline: DetectedDiscipline | null;
  warnings: string[];
}

export type DisciplineKey =
  | "architectural"
  | "structural"
  | "civil"
  | "electrical"
  | "mechanical"
  | "plumbing"
  | "fire-protection"
  | "site"
  | "demolition"
  | "interior"
  | "landscape";

export interface DetectedDiscipline {
  key: DisciplineKey;
  /** The exact substring that triggered the detection. */
  raw: string;
  confidence: number;
}

const DISCIPLINE_PATTERNS: Array<{ key: DisciplineKey; re: RegExp }> = [
  { key: "electrical",       re: /\b(electrical|power|lighting plan|panel(?:board)? schedule)\b/i },
  { key: "mechanical",       re: /\b(mechanical|HVAC|ductwork|VAV|RTU)\b/i },
  { key: "plumbing",         re: /\b(plumbing|sanitary|sewer plan|water riser|DWV)\b/i },
  { key: "fire-protection",  re: /\b(fire\s*protection|sprinkler|fire alarm|fire suppression)\b/i },
  { key: "structural",       re: /\b(structural|framing plan|footing plan|foundation plan|beam schedule|column schedule)\b/i },
  { key: "civil",            re: /\b(civil|grading|drainage plan|utility plan|stormwater)\b/i },
  { key: "site",             re: /\b(site plan|sitework|civil site)\b/i },
  { key: "landscape",        re: /\b(landscape|planting plan|hardscape)\b/i },
  { key: "demolition",       re: /\b(demolition|demo plan)\b/i },
  { key: "interior",         re: /\b(interior|finish plan|finishes|RCP|reflected ceiling)\b/i },
  { key: "architectural",    re: /\b(architectural|floor plan|building plan|enlarged plan)\b/i },
];

function detectDiscipline(text: string): DetectedDiscipline | null {
  // Score each pattern by how often + how early it matches; surface the top.
  let best: { key: DisciplineKey; raw: string; score: number } | null = null;
  for (const { key, re } of DISCIPLINE_PATTERNS) {
    const all = Array.from(text.matchAll(new RegExp(re.source, re.flags + (re.flags.includes("g") ? "" : "g"))));
    if (all.length === 0) continue;
    const first = all[0]!;
    const earliness = Math.max(0, 1 - (first.index ?? 0) / Math.max(text.length, 1));
    const score = all.length + earliness * 0.5;
    if (!best || score > best.score) {
      best = { key, raw: first[0], score };
    }
  }
  if (!best) return null;
  // Confidence: scale linearly to a sensible 0.5 .. 0.95 range.
  const confidence = Math.min(0.95, 0.5 + best.score * 0.1);
  return { key: best.key, raw: best.raw, confidence };
}

const METRIC_RE = /\b1\s*[:：]\s*(\d{1,5})\b/g;
const IMPERIAL_FRAC_RE = /(\d+)\s*\/\s*(\d+)\s*[”"]\s*=\s*(\d+)\s*['′]/g;
// Negative lookbehind prevents matching the "4\"" inside fractional notations
// like "1/4\"=1'-0\"". Without it, that text would also produce a false-positive
// "4\"=1'" detection (multiplier 0.25), which a user could click and apply a
// wildly wrong scale.
const IMPERIAL_WHOLE_RE = /(?<![\/\d])(\d+)\s*[”"]\s*=\s*(\d+)\s*['′]/g;
const SCALE_KEYWORD_RE = /\bSCALE\s*[:=]?/i;

function detectionConfidence(near: string, full: string, idx: number): number {
  // If the word "SCALE" appears within 24 chars before the match, boost.
  const window = full.slice(Math.max(0, idx - 24), idx);
  return SCALE_KEYWORD_RE.test(window) ? 0.95 : 0.7;
}

export function parseScalesFromText(text: string): DetectedScale[] {
  const out: DetectedScale[] = [];
  const seen = new Set<string>();

  // Metric ratios.
  for (const match of text.matchAll(METRIC_RE)) {
    const n = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(n) || n < 2 || n > 50000) continue;
    const label = `1:${n}`;
    if (seen.has(`m:${label}`)) continue;
    seen.add(`m:${label}`);
    out.push({
      raw: match[0],
      kind: "metric",
      label,
      multiplier: n * 0.0254, // paperInches × (n × 25.4 mm) ÷ 1000 = metres
      unit: "m",
      confidence: detectionConfidence(match[0], text, match.index ?? 0),
    });
  }

  // Imperial fractional: e.g. 1/4" = 1'-0"
  for (const match of text.matchAll(IMPERIAL_FRAC_RE)) {
    const num = Number.parseInt(match[1]!, 10);
    const den = Number.parseInt(match[2]!, 10);
    const ft = Number.parseInt(match[3]!, 10);
    if (!num || !den || !ft) continue;
    const paperInches = num / den;
    if (paperInches <= 0) continue;
    const multiplier = ft / paperInches; // paperInches × multiplier = real ft
    const label = `${num}/${den}"=${ft}'`;
    if (seen.has(`i:${label}`)) continue;
    seen.add(`i:${label}`);
    out.push({
      raw: match[0],
      kind: "imperial",
      label,
      multiplier,
      unit: "ft",
      confidence: detectionConfidence(match[0], text, match.index ?? 0),
    });
  }

  // Imperial whole inch: e.g. 1" = 20'
  for (const match of text.matchAll(IMPERIAL_WHOLE_RE)) {
    const inch = Number.parseInt(match[1]!, 10);
    const ft = Number.parseInt(match[2]!, 10);
    if (!inch || !ft) continue;
    const multiplier = ft / inch;
    const label = `${inch}"=${ft}'`;
    if (seen.has(`i:${label}`)) continue;
    seen.add(`i:${label}`);
    out.push({
      raw: match[0],
      kind: "imperial",
      label,
      multiplier,
      unit: "ft",
      confidence: detectionConfidence(match[0], text, match.index ?? 0),
    });
  }

  // Sort by confidence descending so the most likely candidate is first.
  out.sort((a, b) => b.confidence - a.confidence);
  return out;
}

export async function detectTitleBlockScale(
  projectId: string,
  documentId: string,
  pageNumber: number,
  azureConfig?: { endpoint?: string; key?: string },
): Promise<DetectScaleResult> {
  const warnings: string[] = [];

  // Resolve the document. Knowledge books are fine too — the agent's
  // takeoff-tab uses them interchangeably.
  let storagePath: string | null = null;
  let fileName = "drawing.pdf";

  const doc = await prisma.sourceDocument.findFirst({
    where: { id: documentId, projectId },
    select: { storagePath: true, fileName: true },
  });
  if (doc?.storagePath) {
    storagePath = doc.storagePath;
    fileName = doc.fileName;
  } else {
    const book = await prisma.knowledgeBook.findUnique({
      where: { id: documentId },
      select: { storagePath: true, sourceFileName: true },
    });
    if (book?.storagePath) {
      storagePath = book.storagePath;
      fileName = book.sourceFileName || fileName;
    }
  }

  if (!storagePath) {
    return { ocrText: "", detectedScales: [], detectedDiscipline: null, warnings: ["Source file not available for OCR"] };
  }

  const buffer = await readFile(resolveApiPath(storagePath));
  // Azure DI creds come from org Settings > Integrations.
  const azureEndpoint = azureConfig?.endpoint;
  const azureKey = azureConfig?.key;
  if (!azureEndpoint || !azureKey) {
    warnings.push("Azure Document Intelligence isn't configured — OCR cannot run. Set credentials in Settings > Integrations.");
    return { ocrText: "", detectedScales: [], detectedDiscipline: null, warnings };
  }

  const parser = createPdfParser({
    provider: "azure",
    azureEndpoint,
    azureKey,
    azureModel: "prebuilt-layout",
  });

  let text = "";
  try {
    const parsed = await parser.parse(buffer, fileName);
    const pageIdx = Math.max(0, Math.min(pageNumber - 1, (parsed.pages ?? []).length - 1));
    const targetPage = parsed.pages?.[pageIdx];
    text = targetPage?.content ?? parsed.content ?? "";
  } catch (err) {
    warnings.push(`OCR failed: ${(err as Error).message}`);
    return { ocrText: "", detectedScales: [], detectedDiscipline: null, warnings };
  }

  const detectedScales = parseScalesFromText(text);
  if (detectedScales.length === 0) {
    warnings.push("No scale notation matched on this page.");
  }
  const detectedDiscipline = detectDiscipline(text);
  return { ocrText: text, detectedScales, detectedDiscipline, warnings };
}

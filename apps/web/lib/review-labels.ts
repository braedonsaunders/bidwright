/**
 * Resolve the opaque record ids the review agent writes into its prose
 * ("carried on li-2830cf0b") back into the names an estimator recognises.
 *
 * The agent references records by id because that is what the tools return,
 * and it usually abbreviates to the id's first segment. Rewriting at render
 * time (rather than only fixing the prompt) also repairs every review that was
 * already saved.
 */

export type ReviewLabelKind = "line" | "worksheet" | "document" | "phase" | "book" | "dataset" | "rate" | "other";

export interface ReviewLabel {
  label: string;
  kind: ReviewLabelKind;
  /** The full id, so the raw value stays recoverable in a tooltip. */
  id: string;
}

/** `li-2830cf0b`, `doc-2104cf37-2b94-4cb2-a4e3-20ecd2a046f9`, `kb-29e8c125`… */
const ID_PATTERN = /\b([a-z]{2,6})-([0-9a-f]{6,8})(?:-[0-9a-f]{4,12})*\b/gi;

/** Records are keyed by prefix + first hex segment, which is how ids are abbreviated. */
function indexKey(id: string) {
  const match = /^([a-z]{2,6})-([0-9a-f]{6,8})/i.exec(id.trim());
  return match ? `${match[1].toLowerCase()}-${match[2].toLowerCase()}` : "";
}

function cleanLabel(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  // Storage paths leak in as document names ("file/M-E012-0727.nwd").
  return text.replace(/^.*\//, "").trim();
}

export interface ReviewLabelSources {
  worksheets?: Array<{ id: string; name?: string; items?: Array<{ id: string; entityName?: string; description?: string; category?: string }> }>;
  sourceDocuments?: Array<{ id: string; fileName?: string; documentType?: string }>;
  phases?: Array<{ id: string; name?: string }>;
  worksheetFolders?: Array<{ id: string; name?: string }>;
  rateSchedules?: Array<{ id: string; name?: string; items?: Array<{ id: string; name?: string; code?: string }> }>;
  knowledgeBooks?: Array<{ id: string; name?: string; title?: string }>;
  datasets?: Array<{ id: string; name?: string; title?: string }>;
}

export function buildReviewLabelIndex(sources: ReviewLabelSources): Map<string, ReviewLabel> {
  const index = new Map<string, ReviewLabel>();
  const add = (id: string, label: string, kind: ReviewLabelKind) => {
    const key = indexKey(id);
    if (!key || !label || index.has(key)) return;
    index.set(key, { label, kind, id });
  };

  for (const worksheet of sources.worksheets ?? []) {
    add(worksheet.id, cleanLabel(worksheet.name), "worksheet");
    for (const item of worksheet.items ?? []) {
      // Many lines share a generic entityName ("Material"), which is no more
      // useful than the raw id. Qualify with whatever distinguishes it — the
      // description usually names the vendor or quote, else the worksheet.
      const name = cleanLabel(item.entityName) || cleanLabel(item.description) || cleanLabel(item.category);
      const description = cleanLabel(item.description);
      const detail = description && description !== name
        ? (description.length > 48 ? `${description.slice(0, 47)}…` : description)
        : cleanLabel(worksheet.name);
      add(item.id, name && detail ? `${name} — ${detail}` : name, "line");
    }
  }
  for (const document of sources.sourceDocuments ?? []) add(document.id, cleanLabel(document.fileName), "document");
  for (const phase of sources.phases ?? []) add(phase.id, cleanLabel(phase.name), "phase");
  for (const folder of sources.worksheetFolders ?? []) add(folder.id, cleanLabel(folder.name), "worksheet");
  for (const schedule of sources.rateSchedules ?? []) {
    add(schedule.id, cleanLabel(schedule.name), "rate");
    for (const item of schedule.items ?? []) add(item.id, cleanLabel(item.name) || cleanLabel(item.code), "rate");
  }
  for (const book of sources.knowledgeBooks ?? []) add(book.id, cleanLabel(book.name) || cleanLabel(book.title), "book");
  for (const dataset of sources.datasets ?? []) add(dataset.id, cleanLabel(dataset.name) || cleanLabel(dataset.title), "dataset");

  return index;
}

export type ReviewTextSegment =
  | { type: "text"; value: string }
  | { type: "label"; value: string; label: ReviewLabel };

/**
 * Split prose into plain text and resolved-id segments. Ids with no matching
 * record stay verbatim — dropping them would lose the only reference the
 * reviewer has.
 */
export function segmentReviewText(text: string, index: Map<string, ReviewLabel>): ReviewTextSegment[] {
  if (!text) return [];
  if (index.size === 0) return [{ type: "text", value: text }];

  const segments: ReviewTextSegment[] = [];
  let lastIndex = 0;
  ID_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ID_PATTERN.exec(text)) !== null) {
    const resolved = index.get(indexKey(match[0]));
    if (!resolved) continue;
    if (match.index > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    segments.push({ type: "label", value: match[0], label: resolved });
    lastIndex = match.index + match[0].length;
  }

  if (segments.length === 0) return [{ type: "text", value: text }];
  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}

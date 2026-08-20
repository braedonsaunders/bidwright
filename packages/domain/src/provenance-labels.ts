/**
 * Turn record ids inside estimator-facing provenance text into readable names.
 *
 * The agent cites its sources in a worksheet item's sourceNotes, but it writes
 * the raw record id — and usually a TRUNCATED one, just the first uuid segment:
 *
 *   "350 LF high-level 8 in storm @1%. $21.90/LF Sch40 list, ds-fb7262c3."
 *
 * An estimator reading that has no idea what ds-fb7262c3 is. It resolves to
 * "PVC Schedule 40 Pipe and Standard Fittings - List Prices", which is the
 * thing they actually need to see to judge whether the basis is sound.
 */

/** Prefixes that identify a citable record. */
export const PROVENANCE_ID_PREFIXES = [
  "ds",   // Dataset
  "lu",   // LaborUnit
  "rsi",  // RateScheduleItem
  "kdoc", // KnowledgeDocument
  "kb",   // KnowledgeBook
  "doc",  // SourceDocument
  "cat",  // CatalogItem
  "li",   // WorksheetItem
] as const;

export type ProvenanceIdPrefix = (typeof PROVENANCE_ID_PREFIXES)[number];

/**
 * Matches a full or truncated record id: a known prefix followed by at least
 * one hex-ish segment. Deliberately not anchored to full uuids — the agent
 * abbreviates, and an abbreviated citation is exactly the unreadable case.
 */
const ID_PATTERN = new RegExp(
  `\\b(${PROVENANCE_ID_PREFIXES.join("|")})-([0-9a-zA-Z]+(?:-[0-9a-zA-Z]+)*)\\b`,
  "g",
);

export type ProvenanceToken = {
  /** The whole matched id, e.g. "ds-fb7262c3". */
  raw: string;
  prefix: ProvenanceIdPrefix;
};

/** Every citable id mentioned in the text, de-duplicated, in order. */
export function findProvenanceIds(text: string): ProvenanceToken[] {
  if (!text) return [];
  const seen = new Set<string>();
  const tokens: ProvenanceToken[] = [];
  for (const match of text.matchAll(ID_PATTERN)) {
    const raw = match[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push({ raw, prefix: match[1] as ProvenanceIdPrefix });
  }
  return tokens;
}

/**
 * Replace ids with their names.
 *
 * `names` maps a raw (possibly truncated) id to its display name. Ids with no
 * entry are left exactly as written: an unresolvable id is still a real clue
 * for whoever has to debug it, and silently deleting it would be worse than
 * leaving it. Parenthesised ids collapse to the bare name so the text does not
 * end up with doubled brackets.
 */
export function humanizeProvenanceIds(
  text: string,
  names: ReadonlyMap<string, string>,
): string {
  if (!text) return text;
  return text.replace(ID_PATTERN, (raw) => names.get(raw) ?? raw);
}

/**
 * Resolve a truncated id against full ids. Returns the match only when exactly
 * one candidate shares the prefix — an ambiguous abbreviation is left alone
 * rather than guessed at, since citing the wrong dataset is worse than citing
 * an opaque one.
 */
export function resolveTruncatedId(
  raw: string,
  candidateIds: readonly string[],
): string | null {
  const exact = candidateIds.find((id) => id === raw);
  if (exact) return exact;
  const prefixed = candidateIds.filter((id) => id.startsWith(`${raw}-`));
  return prefixed.length === 1 ? prefixed[0] : null;
}

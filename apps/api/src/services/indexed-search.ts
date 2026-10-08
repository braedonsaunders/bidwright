import { buildEstimatorSearchProfile, uniqueStrings, normalizeEstimatorSearchText, estimatorTermMatches, scoreEstimatorSearchText, type SearchProfile } from "./estimator-search.js";

// Keep these expressions identical to the migration's GIN expression indexes.
// Source/library descriptions and arbitrary JSON metadata are deliberately not
// repeated on every labour unit: they describe the book, not the operation.
export const LABOR_SEARCH_VECTOR = String.raw`(
  setweight(to_tsvector('english', regexp_replace(coalesce("name", '') || ' ' || coalesce("code", ''), '([[:lower:]])([[:upper:]])', '\1 \2', 'g')), 'A') ||
  setweight(to_tsvector('english', coalesce("className", '') || ' ' || coalesce("subClassName", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("description", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("category", '') || ' ' || coalesce("discipline", '')), 'C')
)`;
export const CHUNK_SEARCH_VECTOR = `(
  setweight(to_tsvector('english', coalesce("sectionTitle", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("text", '')), 'B')
)`;
export const ROW_SEARCH_VECTOR = String.raw`to_tsvector('english', regexp_replace("data"::text, '([[:lower:]])([[:upper:]])', '\1 \2', 'g'))`;

export function indexedSearchQuery(query: string) {
  const profile = buildEstimatorSearchProfile(query);
  // Quotes make punctuation literal, and OR gives useful partial matches when
  // the source uses a different operation name. Ranking measures term coverage.
  const terms = uniqueStrings(profile.terms.map((term) => term.token));
  return { terms, webQuery: terms.map((term) => `"${term}"`).join(" OR ") };
}

export function searchExcerpt(text: string, query: string, maxChars = 900) {
  if (text.length <= maxChars) return text;
  const terms = buildEstimatorSearchProfile(query).terms;
  const lower = text.toLowerCase();
  const positions = terms.flatMap((term) => term.variants.flatMap((variant) => {
    const out: number[] = [];
    let position = lower.indexOf(variant);
    while (position >= 0 && out.length < 100) {
      out.push(position);
      position = lower.indexOf(variant, position + variant.length);
    }
    return out;
  }));
  let bestStart = 0, bestScore = -1;
  for (const position of positions) {
    const start = Math.max(0, Math.min(text.length - maxChars, position - Math.floor(maxChars / 4)));
    const window = lower.slice(start, start + maxChars);
    const score = terms.reduce((sum, term) => sum + (term.variants.some((v) => window.includes(v)) ? term.weight : 0), 0);
    if (score > bestScore) { bestStart = start; bestScore = score; }
  }
  return `${bestStart ? "…" : ""}${text.slice(bestStart, bestStart + maxChars)}${bestStart + maxChars < text.length ? "…" : ""}`;
}

/** Combine database stemming with exact engineering-size matches. */
export function rankIndexedCandidates<T>(items: T[], profile: SearchProfile, text: (item: T) => unknown, heading: (item: T) => unknown = () => "", numericIdentity: (item: T) => unknown = text) {
  return items.map((item: any) => {
    const match = scoreEstimatorSearchText(profile, text(item), heading(item));
    const normalized = normalizeEstimatorSearchText(numericIdentity(item));
    const stemmed = new Set<string>(item._indexedMatchedTerms ?? []);
    const matchedTerms = profile.terms.filter((term) => /^\d/.test(term.token)
      ? estimatorTermMatches(normalized, term) : stemmed.has(term.token) || match?.matchedTerms.includes(term.token)).map((term) => term.token);
    const coverage = profile.totalWeight ? profile.terms.reduce((sum, term) => sum + (matchedTerms.includes(term.token) ? term.weight : 0), 0) / profile.totalWeight : 0;
    return { item: item as T, score: matchedTerms.length / Math.max(1, profile.terms.length) * 100 + coverage * 10 + (match?.score ?? 0) * 0.1 + Number(item._indexedScore ?? 0), coverage,
      matchedTerms, matchedPhrases: match?.matchedPhrases ?? [], anchorMatches: profile.terms.filter((term) => term.isAnchor && matchedTerms.includes(term.token)).length };
  }).filter((entry) => entry.matchedTerms.length).sort((a, b) => b.score - a.score);
}

/** Column names and values are parameters; only known comparison operators enter SQL. */
export function datasetFilterPredicate(filters: Array<{ column: string; op: string; value: unknown }>, params: unknown[]) {
  return filters.map((filter) => {
    params.push(filter.column);
    const key = `$${params.length}`;
    const value = `r."data" -> ${key}::text`, text = `r."data" ->> ${key}::text`;
    if (filter.op === "contains") {
      params.push(String(filter.value).toLowerCase());
      return `strpos(lower(coalesce(${text}, '')), $${params.length}::text) > 0`;
    }
    const numeric = typeof filter.value === "number" ? filter.value : typeof filter.value === "string" && filter.value.trim() ? Number(filter.value) : NaN;
    if (Number.isFinite(numeric)) {
      params.push(numeric);
      const op = ({ eq: "=", gt: ">", lt: "<", gte: ">=", lte: "<=" } as Record<string, string>)[filter.op];
      if (!op) throw new Error("Unsupported dataset comparison");
      return `(CASE WHEN ${text} ~ '^[[:space:]]*[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?[[:space:]]*$' THEN (${text})::numeric END) ${op} $${params.length}::numeric`;
    }
    if (filter.op !== "eq") return "FALSE";
    params.push(JSON.stringify(filter.value) ?? "null");
    return `${value} = $${params.length}::jsonb`;
  }).join(" AND ") || "TRUE";
}

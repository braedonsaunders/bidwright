import { stemmer } from "@orama/stemmers/english";

export type SearchProfileTerm = {
  token: string;
  variants: string[];
  weight: number;
  isAnchor: boolean;
};

export type SearchProfile = {
  raw: string;
  terms: SearchProfileTerm[];
  phrases: string[];
  anchorCount: number;
  totalWeight: number;
};

export type RankedSearchEntry<T> = {
  item: T;
  score: number;
  matchedTerms: string[];
  matchedPhrases: string[];
  coverage: number;
  anchorMatches: number;
};

const ESTIMATE_SEARCH_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from", "in", "into", "is", "it",
  "of", "on", "or", "per", "the", "to", "with", "without", "work", "scope", "item", "items", "unit",
  "units", "basis", "price", "pricing", "cost", "costs", "estimate", "estimated", "labor", "labour",
]);

export function normalizeEstimatorSearchText(value: unknown) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")
    .match(/[a-z][a-z0-9]*|\d+[a-z][a-z0-9]*|\d+(?:-\d+\/\d+|\/\d+|\.\d+)?/g)?.join(" ") ?? "";
}

export function estimatorSearchTokens(value: unknown) {
  const normalized = normalizeEstimatorSearchText(value);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter((token) => (token.length > 1 || /^\d/.test(token)) && !ESTIMATE_SEARCH_STOPWORDS.has(token));
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}


function estimatorSearchTermWeight(token: string) {
  if (/\d/.test(token)) return 2;
  if (token.length >= 8) return 1.5;
  return 1;
}

export function buildEstimatorSearchProfile(query: string): SearchProfile {
  const raw = normalizeEstimatorSearchText(query);
  const tokens = estimatorSearchTokens(query);
  const terms = uniqueStrings(tokens).map((token) => {
    const weight = estimatorSearchTermWeight(token);
    return {
      token,
      variants: [token],
      weight,
      isAnchor: weight >= 2 || /\d/.test(token),
    };
  });
  const phrases: string[] = [];
  for (const width of [3, 2]) {
    for (let index = 0; index <= tokens.length - width; index += 1) {
      const phrase = tokens.slice(index, index + width).join(" ");
      if (phrase.length >= 6) phrases.push(phrase);
    }
  }
  return {
    raw,
    terms,
    phrases: uniqueStrings(phrases),
    anchorCount: terms.filter((term) => term.isAnchor).length,
    totalWeight: terms.reduce((sum, term) => sum + term.weight, 0),
  };
}

export function lineItemAutocompleteTsQuery(value: unknown) {
  const normalized = normalizeEstimatorSearchText(value);
  if (!normalized) return "";
  const tokens = uniqueStrings(normalized.split(" ").filter((token) => token.length > 1)).slice(0, 8);
  if (tokens.length < 2 || tokens.some((token) => token.length < 4)) return "";
  return tokens.map((token) => `${token}:*`).join(" & ");
}

// Bounded text cache: the same candidate is compared across query terms,
// corpus weights and diagnostics. Source text and reported terms stay original.
const stemmedSearchTexts = new Map<string, string>();
function stemmedSearchText(text: string) {
  const cached = stemmedSearchTexts.get(text);
  if (cached !== undefined) return cached;
  const stemmed = text.split(" ").map((token) => /^\d/.test(token) ? token : stemmer(token)).join(" ");
  if (stemmedSearchTexts.size >= 4096) stemmedSearchTexts.delete(stemmedSearchTexts.keys().next().value!);
  stemmedSearchTexts.set(text, stemmed);
  return stemmed;
}

export function estimatorTermMatches(haystack: string, term: SearchProfileTerm) {
  const padded = ` ${stemmedSearchText(haystack)} `;
  return term.variants.some((variant) => padded.includes(` ${stemmedSearchText(variant)} `));
}

export function scoreEstimatorSearchText(profile: SearchProfile, textValue: unknown, headingValue: unknown = "") {
  const haystack = normalizeEstimatorSearchText(textValue);
  const heading = normalizeEstimatorSearchText(headingValue);
  if (!haystack && !heading) return null;

  let score = 0;
  let matchedWeight = 0;
  let anchorMatches = 0;
  const matchedTerms: string[] = [];
  const matchedPhrases: string[] = [];
  const combined = `${heading} ${haystack}`.trim();

  for (const term of profile.terms) {
    const inBody = estimatorTermMatches(combined, term);
    if (!inBody) continue;
    const inHeading = heading ? estimatorTermMatches(heading, term) : false;
    score += term.weight * (inHeading ? 2.2 : 1);
    matchedWeight += term.weight;
    matchedTerms.push(term.token);
    if (term.isAnchor) anchorMatches += 1;
  }

  for (const phrase of profile.phrases) {
    if (stemmedSearchText(combined).includes(stemmedSearchText(phrase))) {
      matchedPhrases.push(phrase);
      score += phrase.split(" ").length * 1.5;
    }
  }
  if (profile.raw && combined.includes(profile.raw)) score += 8;
  if (score <= 0) return null;

  return {
    score,
    matchedTerms,
    matchedPhrases,
    coverage: profile.totalWeight > 0 ? matchedWeight / profile.totalWeight : 0,
    anchorMatches,
  };
}

export function rankEstimatorSearchItems<T>(
  items: T[],
  profile: SearchProfile,
  getText: (item: T) => unknown,
  getHeading: (item: T) => unknown = () => "",
): Array<RankedSearchEntry<T>> {
  return items
    .map((item) => {
      const match = scoreEstimatorSearchText(profile, getText(item), getHeading(item));
      return match ? { item, ...match } : null;
    })
    .filter((entry): entry is RankedSearchEntry<T> => entry !== null)
    .sort((left, right) =>
      right.score - left.score ||
      right.coverage - left.coverage ||
      right.anchorMatches - left.anchorMatches
    );
}

const DATASET_IDENTITY_COLUMN = /(?:^|_)(?:size|diameter|nominal|nps|dn|gauge|schedule|class|rating|code|model|part|item)(?:_|$)/i;

export function datasetRowIdentityText(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return Object.entries(data as Record<string, unknown>)
    .filter(([key, value]) => DATASET_IDENTITY_COLUMN.test(key.replace(/([a-z])([A-Z])/g, "$1_$2")) && (typeof value === "string" || typeof value === "number"))
    .map(([key, value]) => `${key} ${String(value)}`)
    .join(" ");
}

export type DatasetQueryFilter = {
  column: string;
  op: "eq" | "gt" | "lt" | "gte" | "lte" | "contains";
  value: unknown;
};

export function datasetValueMatchesFilter(value: unknown, filter: DatasetQueryFilter): boolean {
  const numericValue = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  const numericFilter = typeof filter.value === "number" ? filter.value : typeof filter.value === "string" && filter.value.trim() !== "" ? Number(filter.value) : Number.NaN;
  const bothNumeric = Number.isFinite(numericValue) && Number.isFinite(numericFilter);
  switch (filter.op) {
    case "eq": return bothNumeric ? numericValue === numericFilter : value === filter.value;
    case "gt": return bothNumeric && numericValue > numericFilter;
    case "lt": return bothNumeric && numericValue < numericFilter;
    case "gte": return bothNumeric && numericValue >= numericFilter;
    case "lte": return bothNumeric && numericValue <= numericFilter;
    case "contains": return String(value ?? "").toLowerCase().includes(String(filter.value).toLowerCase());
  }
}

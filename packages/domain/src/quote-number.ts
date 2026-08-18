/**
 * Organization-configurable quote/estimate numbering.
 *
 * Numbers were hard-coded as `BW-YYMMDD-<4 random hex>`. Estimators want their
 * own scheme — initials, date, and a real running count, e.g. `BS-260818-0035`.
 * The pattern is stored on the organization's settings and rendered here.
 *
 * The sequence is derived from existing numbers rather than a stored counter:
 * every non-sequence token is resolved to its literal value first, so the
 * matcher only counts numbers from the same scope the pattern implies. A
 * pattern with date tokens therefore restarts each day, and one without them
 * runs continuously — without either behaviour needing to be configured.
 */

export type QuoteNumberContext = {
  /** Initials of the user creating the quote, e.g. "BS". */
  initials?: string | null;
  /** Creation instant; defaults to now. */
  date?: Date;
};

export type QuoteNumberToken = {
  token: string;
  label: string;
  example: string;
};

/** Tokens offered in the settings UI. Keep in sync with `renderToken`. */
export const QUOTE_NUMBER_TOKENS: QuoteNumberToken[] = [
  { token: "{INITIALS}", label: "User initials", example: "BS" },
  { token: "{YYYY}", label: "4-digit year", example: "2026" },
  { token: "{YY}", label: "2-digit year", example: "26" },
  { token: "{MM}", label: "2-digit month", example: "08" },
  { token: "{DD}", label: "2-digit day", example: "18" },
  { token: "{SEQ}", label: "Increment (pad with :n)", example: "0035" },
  { token: "{RAND}", label: "Random (pad with :n)", example: "A3F9" },
];

/** Preserves the historical BW-YYMMDD-XXXX format for orgs that set nothing. */
export const DEFAULT_QUOTE_NUMBER_PATTERN = "BW-{YY}{MM}{DD}-{RAND:4}";

const TOKEN_RE = /\{([A-Z]+)(?::(\d+))?\}/g;

/** Initials from a display name — "Braedon Saunders" -> "BS". */
export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "";
  const letters = parts.slice(0, 3).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("");
}

function pad(value: string | number, width: number | undefined, fallbackWidth = 0): string {
  const text = String(value);
  const target = width ?? fallbackWidth;
  return target > 0 ? text.padStart(target, "0") : text;
}

function randomAlphanumeric(length: number): string {
  const alphabet = "0123456789ABCDEF";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function dateParts(date: Date) {
  return {
    YYYY: String(date.getUTCFullYear()),
    YY: String(date.getUTCFullYear()).slice(-2),
    MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
    DD: String(date.getUTCDate()).padStart(2, "0"),
  };
}

/**
 * Render a pattern. `sequence` is only needed when the pattern uses `{SEQ}`;
 * callers get it from `nextQuoteNumberSequence`.
 */
export function formatQuoteNumber(
  pattern: string,
  context: QuoteNumberContext & { sequence?: number } = {},
): string {
  const date = context.date ?? new Date();
  const parts = dateParts(date);
  const initials = (context.initials ?? "").toUpperCase();

  return (pattern || DEFAULT_QUOTE_NUMBER_PATTERN).replace(
    TOKEN_RE,
    (match, rawName: string, rawWidth: string | undefined) => {
      const width = rawWidth ? Number(rawWidth) : undefined;
      switch (rawName) {
        case "INITIALS":
          return initials;
        case "YYYY":
        case "YY":
        case "MM":
        case "DD":
          return parts[rawName];
        case "SEQ":
          return pad(context.sequence ?? 1, width, 4);
        case "RAND":
          return randomAlphanumeric(width ?? 4);
        default:
          // Unknown token: leave it visible so the misconfiguration is obvious
          // in the preview rather than silently vanishing from every number.
          return match;
      }
    },
  );
}

/** True when the pattern needs a sequence looked up before rendering. */
export function patternUsesSequence(pattern: string): boolean {
  return /\{SEQ(?::\d+)?\}/.test(pattern || "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Regex matching numbers from the same scope as `pattern`, capturing `{SEQ}`.
 * Every other token is resolved to its literal value, so today's numbers do not
 * collide with yesterday's and one user's do not collide with another's.
 */
export function quoteNumberSequenceMatcher(
  pattern: string,
  context: QuoteNumberContext = {},
): RegExp | null {
  if (!patternUsesSequence(pattern)) return null;
  const date = context.date ?? new Date();
  const parts = dateParts(date);
  const initials = (context.initials ?? "").toUpperCase();

  let source = "";
  let lastIndex = 0;
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(pattern)) !== null) {
    source += escapeRegExp(pattern.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const [, rawName, rawWidth] = match;
    if (rawName === "SEQ") {
      source += "(\\d+)";
    } else if (rawName === "INITIALS") {
      source += escapeRegExp(initials);
    } else if (rawName === "YYYY" || rawName === "YY" || rawName === "MM" || rawName === "DD") {
      source += escapeRegExp(parts[rawName]);
    } else if (rawName === "RAND") {
      source += `[0-9A-F]{${rawWidth ? Number(rawWidth) : 4}}`;
    } else {
      source += escapeRegExp(match[0]);
    }
  }
  source += escapeRegExp(pattern.slice(lastIndex));
  return new RegExp(`^${source}$`);
}

/**
 * Next sequence for `pattern`, given the numbers already issued. Uses max+1 so
 * deleting a quote never reissues its number.
 */
export function nextQuoteNumberSequence(
  pattern: string,
  existingNumbers: Iterable<string>,
  context: QuoteNumberContext = {},
): number {
  const matcher = quoteNumberSequenceMatcher(pattern, context);
  if (!matcher) return 1;
  let highest = 0;
  for (const candidate of existingNumbers) {
    const found = matcher.exec(candidate ?? "");
    if (!found) continue;
    const value = Number.parseInt(found[1] ?? "", 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return highest + 1;
}

/** Human-readable problems with a pattern; empty when it is usable. */
export function validateQuoteNumberPattern(pattern: string): string[] {
  const issues: string[] = [];
  const trimmed = (pattern ?? "").trim();
  if (!trimmed) {
    issues.push("Pattern cannot be empty.");
    return issues;
  }
  const known = new Set(QUOTE_NUMBER_TOKENS.map((entry) => entry.token.replace(/[{}]/g, "")));
  const re = new RegExp(TOKEN_RE.source, "g");
  let match: RegExpExecArray | null;
  let tokenCount = 0;
  while ((match = re.exec(trimmed)) !== null) {
    tokenCount += 1;
    if (!known.has(match[1])) issues.push(`Unknown token ${match[0]}.`);
  }
  if (tokenCount === 0) {
    issues.push("Pattern has no tokens, so every quote would get the same number.");
  }
  if (!patternUsesSequence(trimmed) && !/\{RAND(?::\d+)?\}/.test(trimmed)) {
    issues.push("Add {SEQ} or {RAND} so each quote gets a distinct number.");
  }
  return issues;
}

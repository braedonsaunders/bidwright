import { twMerge } from "tailwind-merge";

// Merges Tailwind utility classes, resolving conflicts so the *last* class
// wins (e.g. cn("w-full", "w-32") → "w-32"). This is what every caller
// expects — without twMerge, both classes end up in the className attribute
// and the browser uses whichever Tailwind emits later in the stylesheet,
// which silently breaks size overrides on wrapped components like Input
// and Select. Falsy values are filtered so callers can do `cn("a", flag && "b")`.
export function cn(...classes: Array<string | false | null | undefined>) {
  return twMerge(classes.filter(Boolean).join(" "));
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
};

function decodeSingleEntity(entity: string): string | null {
  if (!entity) return null;

  if (entity.startsWith("#x") || entity.startsWith("#X")) {
    const codePoint = Number.parseInt(entity.slice(2), 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : null;
  }

  if (entity.startsWith("#")) {
    const codePoint = Number.parseInt(entity.slice(1), 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : null;
  }

  return NAMED_HTML_ENTITIES[entity.toLowerCase()] ?? null;
}

export function decodeHtmlEntities(value: string): string {
  if (!value || !value.includes("&")) return value;

  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    const next = decoded.replace(/&(#(?:x|X)?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/g, (match, entity) => {
      const resolved = decodeSingleEntity(entity);
      return resolved ?? match;
    });

    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
}

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

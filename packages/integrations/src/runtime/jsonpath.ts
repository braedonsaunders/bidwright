/**
 * Minimal JSONPath evaluator for manifest-driven response mapping.
 *
 * Supports the subset we need:
 *   $              — root
 *   $.foo          — property access
 *   $.foo.bar
 *   $.items[0]     — array index
 *   $.items[*]     — all elements (flattened)
 *   $.items[*].id  — projection
 *   $['weird key'] — quoted property names with spaces / dots
 *
 * Filter expressions and slices are intentionally unsupported — keep the
 * surface tiny and predictable. Manifests can always pre-shape via `select`
 * + `map` rather than packing logic into a path.
 */

export type JsonValue =
  | null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };

interface Token {
  type: "root" | "key" | "index" | "wild";
  value?: string | number;
}

function tokenize(path: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  if (path[i] !== "$") throw new Error(`JSONPath must start with '$' (got: ${path})`);
  tokens.push({ type: "root" });
  i++;

  while (i < path.length) {
    const ch = path[i];
    if (ch === ".") {
      i++;
      let j = i;
      while (j < path.length && /[A-Za-z0-9_$]/.test(path[j]!)) j++;
      if (j === i) throw new Error(`Empty key after '.' in path: ${path}`);
      tokens.push({ type: "key", value: path.slice(i, j) });
      i = j;
    } else if (ch === "[") {
      i++;
      if (path[i] === "*") {
        if (path[i + 1] !== "]") throw new Error(`Expected ']' after '*' in: ${path}`);
        tokens.push({ type: "wild" });
        i += 2;
      } else if (path[i] === "'" || path[i] === "\"") {
        const quote = path[i]!;
        i++;
        let j = i;
        while (j < path.length && path[j] !== quote) j++;
        if (j === path.length) throw new Error(`Unterminated quoted key in: ${path}`);
        tokens.push({ type: "key", value: path.slice(i, j) });
        i = j + 1;
        if (path[i] !== "]") throw new Error(`Expected ']' after quoted key in: ${path}`);
        i++;
      } else {
        let j = i;
        while (j < path.length && /[0-9-]/.test(path[j]!)) j++;
        if (j === i) throw new Error(`Expected index in: ${path}`);
        const n = Number(path.slice(i, j));
        if (!Number.isInteger(n)) throw new Error(`Bad index in: ${path}`);
        tokens.push({ type: "index", value: n });
        i = j;
        if (path[i] !== "]") throw new Error(`Expected ']' in: ${path}`);
        i++;
      }
    } else {
      throw new Error(`Unexpected char '${ch}' at ${i} in path: ${path}`);
    }
  }
  return tokens;
}

function step(values: JsonValue[], token: Token): JsonValue[] {
  const next: JsonValue[] = [];
  for (const v of values) {
    if (token.type === "key") {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const k = token.value as string;
        if (k in (v as object)) next.push((v as Record<string, JsonValue>)[k]!);
      }
    } else if (token.type === "index") {
      if (Array.isArray(v)) {
        const n = token.value as number;
        const idx = n < 0 ? v.length + n : n;
        if (idx >= 0 && idx < v.length) next.push(v[idx]!);
      }
    } else if (token.type === "wild") {
      if (Array.isArray(v)) for (const item of v) next.push(item);
      else if (v && typeof v === "object") for (const item of Object.values(v)) next.push(item);
    }
  }
  return next;
}

/**
 * Evaluate a JSONPath against a JSON value. Returns an array of matched
 * values (empty if no match).
 */
export function evalJsonPath(path: string, value: JsonValue): JsonValue[] {
  if (path === "$") return [value];
  const tokens = tokenize(path);
  let acc: JsonValue[] = [value];
  for (const t of tokens) {
    if (t.type === "root") continue;
    acc = step(acc, t);
  }
  return acc;
}

/**
 * Convenience: return the first match or `undefined`.
 */
export function evalJsonPathFirst(path: string, value: JsonValue): JsonValue | undefined {
  const matches = evalJsonPath(path, value);
  return matches.length > 0 ? matches[0] : undefined;
}

/**
 * Apply a `{ outKey: "$.path" }` map to an input value. Used by action.output.map
 * and trigger.output.map.
 */
export function applyMap(
  map: Record<string, string> | undefined,
  value: JsonValue,
): JsonValue {
  if (!map) return value;
  const out: Record<string, JsonValue> = {};
  for (const [k, p] of Object.entries(map)) {
    const v = evalJsonPathFirst(p, value);
    out[k] = (v === undefined ? null : v);
  }
  return out;
}

/**
 * Apply `select` (single path) then `map` (key projection).
 */
export function selectAndMap(
  select: string,
  map: Record<string, string> | undefined,
  value: JsonValue,
): JsonValue {
  const selected = select === "$" ? value : (evalJsonPathFirst(select, value) ?? null);
  return applyMap(map, selected);
}

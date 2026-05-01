/**
 * `{{...}}` template substitution for manifest-driven request shaping.
 *
 * Variables:
 *   {{config.<key>}}      — Integration.config (non-secret)
 *   {{credential.<kind>}} — decrypted secret (server-side only; never logged)
 *   {{input.<param>}}     — action input
 *   {{cursor}}            — sync cursor
 *   {{nowIso}}            — current ISO-8601 timestamp
 *   {{now}}               — current epoch millis
 *
 * Unknown variables resolve to empty string (with `strict: true` they throw).
 * Nested keys via dot notation are supported. Arrays/objects are JSON-stringified
 * when interpolated into a string context.
 */

export interface TemplateContext {
  config: Record<string, unknown>;
  credential: Record<string, string>;
  input: Record<string, unknown>;
  cursor?: string | null;
  extra?: Record<string, unknown>;
}

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function resolvePath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function renderString(
  template: string,
  ctx: TemplateContext,
  options: { strict?: boolean } = {},
): string {
  if (typeof template !== "string") return template as unknown as string;
  return template.replace(TOKEN_RE, (_match, expr: string) => {
    const value = resolveExpr(expr, ctx);
    if (value === undefined) {
      if (options.strict) throw new Error(`Template variable not found: ${expr}`);
      return "";
    }
    return stringify(value);
  });
}

export function resolveExpr(expr: string, ctx: TemplateContext): unknown {
  const [head, ...rest] = expr.split(".");
  const tail = rest.join(".");
  switch (head) {
    case "config":     return resolvePath(ctx.config, tail);
    case "credential": return resolvePath(ctx.credential, tail);
    case "input":      return resolvePath(ctx.input, tail);
    case "cursor":     return ctx.cursor ?? "";
    case "now":        return Date.now();
    case "nowIso":     return new Date().toISOString();
    default: {
      if (ctx.extra && head in ctx.extra) {
        return tail ? resolvePath(ctx.extra[head], tail) : ctx.extra[head];
      }
      return undefined;
    }
  }
}

/**
 * Walk a value tree and apply `renderString` to every string leaf.
 * Used for templating `request.headers`, `request.query`, `request.body`.
 */
export function renderDeep<T>(value: T, ctx: TemplateContext, options: { strict?: boolean } = {}): T {
  if (value == null) return value;
  if (typeof value === "string") return renderString(value, ctx, options) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx, options)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = renderDeep(v, ctx, options);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Parse a query-string flag without the `z.coerce.boolean()` footgun.
 *
 * `Boolean("false")` is true, so `refresh=false` would otherwise rebuild the
 * line-item search index on every agent search.
 */
export function parseQueryBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  return undefined;
}

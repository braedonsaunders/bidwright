/**
 * `sourceRefs` accept either a plain string cite or an object, normalizing both
 * to the string form the evidence gates read.
 *
 * The gates ask for "structured sourceRefs", and an agent reasonably reads that
 * as "send me a structure". The array was typed `z.array(z.string())`, so an
 * object came back as a raw `MCP error -32602: expected string, received
 * object` with no hint about the intended shape -- and the agent alternated
 * between object and string forms, each rejected by a different layer for a
 * different reason. Accepting both and normalizing removes the guess: the
 * "structured" the gates want is a resolvable id inside the string, not a
 * nested object.
 */

import { z } from "zod";

/** Keys an agent plausibly puts the resolvable id under. */
const ID_KEYS = [
  "id", "ref", "sourceRef", "documentId", "docId", "sourceId", "itemId",
  "claimId", "effectiveCostId", "costResourceId", "laborUnitId", "labourUnitId",
  "datasetId", "bookId", "rateScheduleItemId", "url", "uri",
] as const;

/** Keys that name the source when no id is present. */
const LABEL_KEYS = ["title", "name", "document", "file", "fileName", "label", "query"] as const;

/** Keys that locate the cite within the source. */
const LOCATOR_KEYS = ["page", "pageNumber", "pageNum", "sheet", "row", "cell", "section"] as const;

function firstNonEmpty(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/** Flatten one source ref to its string form. Returns "" for unusable input. */
export function normalizeSourceRef(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";

  const record = value as Record<string, unknown>;
  const head = firstNonEmpty(record, ID_KEYS) || firstNonEmpty(record, LABEL_KEYS);
  if (!head) return "";

  const locator = firstNonEmpty(record, LOCATOR_KEYS);
  return locator ? `${head} p.${locator}` : head;
}

/**
 * An array of source refs. Accepts strings or objects on the way in, and always
 * produces strings. Drops entries that carry no identifiable source rather than
 * storing `"[object Object]"`.
 */
export function sourceRefArray(description?: string) {
  const schema = z
    .array(
      z
        .union([z.string(), z.number(), z.record(z.unknown())])
        .transform(normalizeSourceRef),
    )
    .transform((refs) => refs.filter(Boolean))
    .default([]);
  return description ? schema.describe(description) : schema;
}

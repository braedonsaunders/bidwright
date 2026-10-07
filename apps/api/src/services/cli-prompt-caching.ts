/** Per-run cache canaries never mutate tenant or deployment defaults. */
export function assertPromptCachingOverride(value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw Object.assign(new Error("promptCaching must be a boolean"), { statusCode: 400 });
  }
}

export function resolveRunPromptCaching(requested: unknown, previous?: unknown, configured = false): boolean {
  assertPromptCachingOverride(requested);
  return typeof requested === "boolean" ? requested : typeof previous === "boolean" ? previous : configured;
}

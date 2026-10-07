export const CLI_REASONING_EFFORTS = ["auto", "low", "medium", "high", "extra_high", "max"] as const;
export type CliReasoningEffort = typeof CLI_REASONING_EFFORTS[number];

export function isCliReasoningEffort(value: unknown): value is CliReasoningEffort {
  return CLI_REASONING_EFFORTS.some((effort) => effort === value);
}

export function assertReasoningEffortOverride(value: unknown): void {
  if (value !== undefined && !isCliReasoningEffort(value)) {
    throw Object.assign(new Error(`reasoningEffort must be one of: ${CLI_REASONING_EFFORTS.join(", ")}`), { statusCode: 400 });
  }
}

export function normalizeCliReasoningEffort(value: unknown, mode = "build_estimate"): CliReasoningEffort {
  return isCliReasoningEffort(value) ? value : mode === "qa" ? "medium" : "high";
}

/** A run override never mutates the tenant setting; continuations retain it. */
export function resolveRunReasoningEffort(requested: unknown, configured: unknown, mode = "build_estimate", previous?: unknown): CliReasoningEffort {
  assertReasoningEffortOverride(requested);
  return normalizeCliReasoningEffort(requested ?? (isCliReasoningEffort(previous) ? previous : configured), mode);
}

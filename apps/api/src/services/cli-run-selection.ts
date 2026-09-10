/**
 * Choosing which AiRun represents a project's current agent state.
 *
 * "Newest run wins" is right almost always, and wrong in one case that matters:
 * a resume issued against an agent that is still working dies in a few hundred
 * milliseconds (the runtime refuses a second writer on the same thread). That
 * stillborn run is the newest, so it became the run the status endpoint
 * reported — turning a healthy, still-running estimate into a visible failure.
 * Each retry appended another one, so every attempt to recover re-applied the
 * mask. These helpers skip that tail while a real run is still open.
 */

export interface SelectableRun {
  status?: string;
  output?: unknown;
}

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "stopped"]);

function statusEventValues(run: SelectableRun | undefined): string[] {
  const events = ((run?.output as { events?: unknown })?.events || []) as Array<{
    type?: string;
    data?: { status?: unknown };
  }>;
  if (!Array.isArray(events)) return [];
  return events
    .filter((event) => event?.type === "status")
    .map((event) => String(event?.data?.status ?? ""));
}

/**
 * A run whose process never came up: marked failed, and it never once reported
 * "running". A CLI that starts at all emits a running status before anything
 * else, so its absence is a reliable "this never began".
 */
export function isStillbornRun(run: SelectableRun | undefined): boolean {
  if (run?.status !== "failed") return false;
  return !statusEventValues(run).includes("running");
}

/** A run the DB still has open, with no terminal status event in its transcript. */
export function isOpenRun(run: SelectableRun | undefined): boolean {
  if (run?.status !== "running") return false;
  return !statusEventValues(run).some((status) => TERMINAL_RUN_STATUSES.has(status));
}

/**
 * Pick the run that represents the project's current state.
 *
 * Falls back to the newest run whenever the last run that actually started has
 * finished, so a genuine start-up failure with nothing else running still
 * surfaces to the user rather than silently reporting the previous run.
 */
export function selectLatestRun<T extends SelectableRun>(runs: T[]): T | undefined {
  if (runs.length === 0) return undefined;
  const newest = runs[runs.length - 1];
  if (!isStillbornRun(newest)) return newest;

  let index = runs.length - 1;
  while (index >= 0 && isStillbornRun(runs[index])) index -= 1;
  const lastStarted = index >= 0 ? runs[index] : undefined;
  return lastStarted && isOpenRun(lastStarted) ? lastStarted : newest;
}

const pending = new Map<string, Promise<unknown>>();
/** Retries during workspace preparation share one launch, not a second paid review. */
export function coalesceReviewLaunch<T>(key: string, launch: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const work = Promise.resolve().then(launch).finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
export function reviewSessionKey(projectId: string) { return `review:${projectId}`; }

/** Review controls cannot attach to or stop a concurrent estimating session. */
export function selectReviewSession<T extends { status: string; _spawnOpts?: { reviewOnly?: boolean } }>(advisory: T | undefined, project: T | undefined): T | undefined {
  if (advisory?.status === "running") return advisory;
  return project?._spawnOpts?.reviewOnly ? project : advisory;
}

/** The cancellation check brackets the async host spawn, not just its preparation. */
export async function abortableAgentSpawn<T>(signal: AbortSignal | undefined, spawn: () => Promise<T>, stop: (child: T) => Promise<void>): Promise<T> {
  signal?.throwIfAborted();
  const child = await spawn();
  if (signal?.aborted) {
    await stop(child);
    signal.throwIfAborted();
  }
  return child;
}

export function acceptTakeoffSyncMessage(
  handledMessageIds: Set<string>,
  messageId: string | undefined,
  limit = 500,
): boolean {
  // Older producers did not include message ids. Preserve compatibility while
  // newer dual-transport messages are deduplicated across postMessage and
  // BroadcastChannel.
  if (!messageId) return true;
  if (handledMessageIds.has(messageId)) return false;

  handledMessageIds.add(messageId);
  while (handledMessageIds.size > limit) {
    const oldest = handledMessageIds.values().next().value;
    if (!oldest) break;
    handledMessageIds.delete(oldest);
  }
  return true;
}

export function replayDetachedViewerCommand<T>(
  isDetachedMirror: boolean,
  command: T | null,
  send: (command: T) => void,
): boolean {
  if (!isDetachedMirror || !command) return false;
  send(command);
  return true;
}

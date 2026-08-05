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

export const DETACHED_TAKEOFF_COMMAND_RECEIVER = "__bidwrightApplyTakeoffModelCommand" as const;

/**
 * Deliver a viewer command through the popup's same-origin window proxy.
 * Unlike postMessage/BroadcastChannel this is synchronous: a true result
 * means the detached React tree accepted the command immediately. Access is
 * guarded because a browser may temporarily deny WindowProxy property reads
 * while the popup is navigating.
 */
export function deliverDetachedTakeoffCommand<T>(target: unknown, command: T): boolean {
  try {
    const receiver = (target as Record<string, unknown> | null)?.[DETACHED_TAKEOFF_COMMAND_RECEIVER];
    if (typeof receiver !== "function") return false;
    return receiver(command) !== false;
  } catch {
    return false;
  }
}

export function resolveDetachedModelCommandTarget(
  assetId: string,
  selectedDocumentId: string | null,
  selectedModelAssetId: string | null,
  documents: Array<{ id: string; modelAssetId?: string }>,
): { kind: "active" } | { kind: "switch"; documentId: string } | null {
  // SourceDocument-backed models (including the current Navisworks flow) do
  // not get a synthetic `model-asset-*` takeoff document because they have no
  // FileNode id. `selectedModelAssetId` is therefore the authoritative match
  // for the viewer that is already open.
  if (selectedModelAssetId === assetId) return { kind: "active" };

  const target = documents.find((document) => document.modelAssetId === assetId);
  if (!target) return null;
  if (target.id === selectedDocumentId) return { kind: "active" };
  return { kind: "switch", documentId: target.id };
}

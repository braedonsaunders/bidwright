"use client";

export interface WorkspaceSyncMessage {
  type: "workspace-mutated";
  projectId: string;
  originId?: string;
  reason?: string;
}

export function workspaceChannelName(projectId: string): string {
  return `bw-workspace-${projectId}`;
}

export function modelEditorChannelName(projectId: string): string {
  return `bw-model-editor-${projectId}`;
}

export function postWorkspaceMutation(
  projectId: string,
  options: { originId?: string; reason?: string } = {},
) {
  if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;

  const channel = new BroadcastChannel(workspaceChannelName(projectId));
  channel.postMessage({
    type: "workspace-mutated",
    projectId,
    originId: options.originId,
    reason: options.reason,
  } satisfies WorkspaceSyncMessage);
  channel.close();
}

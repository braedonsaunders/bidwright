import type { ProcessSandboxLauncherIdentity } from "@braedonsaunders/appkit-process-sandbox";

const MAX_ID = 2_147_483_647;

function parseId(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`[agent-host] ${label} must be a decimal integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > MAX_ID) {
    throw new Error(
      `[agent-host] ${label} must be between ${minimum} and ${MAX_ID}.`,
    );
  }
  return parsed;
}

/**
 * Identity used only to invoke AppKit's setuid bubblewrap launcher. The API
 * itself may remain root so it can access existing project storage, while
 * every agent command begins from an explicitly unprivileged identity.
 */
export function getProcessSandboxLauncherIdentity(
  env: NodeJS.ProcessEnv = process.env,
): ProcessSandboxLauncherIdentity {
  return {
    uid: parseId(env.BIDWRIGHT_RUNTIME_UID, 1000, "BIDWRIGHT_RUNTIME_UID", 1),
    gid: parseId(env.BIDWRIGHT_RUNTIME_GID, 1000, "BIDWRIGHT_RUNTIME_GID", 0),
  };
}

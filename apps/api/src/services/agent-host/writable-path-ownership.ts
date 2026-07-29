import { lchown, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ProcessSandboxLauncherIdentity } from "@appkit/process-sandbox";

/**
 * Every sandbox launch must be able to traverse the project workspace and
 * open API-generated 0600 control files. Whether the workspace is writable
 * inside the namespace is a separate bind-mount policy.
 */
export function launcherAccessiblePaths(
  projectDir: string,
  agentRuntimePaths: readonly string[],
): string[] {
  return [...new Set([projectDir, ...agentRuntimePaths])];
}

async function chownTree(
  path: string,
  identity: ProcessSandboxLauncherIdentity,
): Promise<void> {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  if (stats.uid !== identity.uid || stats.gid !== identity.gid) {
    // lchown deliberately changes a symlink itself, never its target.
    await lchown(path, identity.uid, identity.gid);
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) return;

  for (const entry of await readdir(path)) {
    await chownTree(join(path, entry), identity);
  }
}

/**
 * AppKit launches bubblewrap as an unprivileged identity. Writable bind
 * sources therefore need to be owned by that same identity before the
 * namespace is created. The API runs as root so it can migrate older storage;
 * normalize only the already-resolved project and per-user runtime paths.
 */
export async function prepareLauncherWritablePaths(
  paths: readonly string[],
  identity: ProcessSandboxLauncherIdentity,
): Promise<void> {
  for (const path of new Set(paths)) {
    await chownTree(path, identity);
  }
}

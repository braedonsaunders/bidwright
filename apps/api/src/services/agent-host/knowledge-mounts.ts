/**
 * Read-only mounts for the knowledge books an agent's instructions point at.
 *
 * The agent workspace symlinks each organisation book into `knowledge/`, but
 * the sandbox masks /data, so the links dangled and the agent could not open
 * any book through its own file tools. Binding the whole knowledge root would
 * show every tenant's books, and following the workspace's symlinks would let
 * an agent mount anything it can name. So the server decides: the books it
 * links are the organisation's global books, and exactly those files are
 * bound read-only.
 */

import { existsSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";

export interface KnowledgeBookRecord {
  storagePath: string | null;
}

export interface KnowledgeMountDeps {
  /** Global knowledge books of the organisation that owns this project. */
  loadOrganizationBooks: (projectId: string) => Promise<KnowledgeBookRecord[]>;
  knowledgeRoot: string;
  dataRoot: string;
  exists?: (path: string) => boolean;
}

export async function authorizedKnowledgeMounts(projectDir: string, deps: KnowledgeMountDeps): Promise<string[]> {
  const projectId = basename(resolve(projectDir));
  if (!projectId.startsWith("project-")) return [];
  const exists = deps.exists ?? existsSync;
  const root = resolve(deps.knowledgeRoot);
  const mounts = new Set<string>();
  for (const book of await deps.loadOrganizationBooks(projectId)) {
    if (!book.storagePath) continue;
    const file = resolve(deps.dataRoot, book.storagePath);
    // Only files inside the knowledge root, never anything a stored path
    // could steer elsewhere.
    const inside = relative(root, file);
    if (!inside || inside.startsWith("..") || inside.startsWith(sep)) continue;
    if (exists(file)) mounts.add(file);
  }
  return [...mounts].sort();
}

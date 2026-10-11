import { apiGet, apiPost, getProjectId } from "./api-client.js";

function sourceId(id: unknown): string {
  if (typeof id !== "string" || !id.trim()) throw new Error("A source document or FileNode id is required");
  return id.trim();
}

/** Read-only lookup: unextracted files remain files until explicitly promoted. */
export async function resolveSourceDocumentId(id: string): Promise<string> {
  const trimmed = sourceId(id);
  if (!/^(fn-|file-)/.test(trimmed)) return trimmed;
  const result = await apiGet<{ id?: string; message?: string }>(`/projects/${getProjectId()}/documents/resolve-source?sourceId=${encodeURIComponent(trimmed)}`);
  if (typeof result?.id !== "string") throw new Error(result?.message || "This file has no extracted SourceDocument. promoteSourceDocument explicitly ingests supported source files.");
  return result.id;
}

/** Explicit write used only by promotion tools. */
export async function promoteSourceDocumentId(id: string): Promise<string> {
  const trimmed = sourceId(id);
  if (!/^(fn-|file-)/.test(trimmed)) return trimmed;
  const document = await apiPost<{ id?: string }>(`/projects/${getProjectId()}/documents/from-file-node`, { fileNodeId: trimmed });
  if (typeof document?.id !== "string") throw new Error("Source promotion returned no document id");
  return document.id;
}

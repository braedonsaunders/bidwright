import { apiPost, getProjectId } from "./api-client.js";

/** Preserve library/document ids; resolve literal FileNode ids and Files UI keys server-side. */
export async function resolveSourceDocumentId(id: string): Promise<string> {
  if (!/^(fn-|file-)/.test(id.trim())) return id.trim();
  const document = await apiPost<{ id: string }>(`/projects/${getProjectId()}/documents/from-file-node`, { fileNodeId: id.trim() });
  return document.id;
}

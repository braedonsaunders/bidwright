/** A Files UI key adds `file-`; copied FileNode ids can themselves start with it. */
export async function resolveProjectFileNode<T extends { id: string; projectId: string; type: string }>(
  projectId: string,
  sourceId: string,
  getFileNode: (id: string) => Promise<T | null>,
): Promise<T | null> {
  const id = sourceId.trim();
  for (const candidate of [...new Set([id, ...(id.startsWith("file-") ? [id.slice(5)] : [])])]) {
    const node = await getFileNode(candidate);
    if (node?.projectId === projectId && node.type === "file") return node;
  }
  return null;
}

export async function resolveProjectSource(store: {
  getDocument: (projectId: string, id: string) => Promise<any>;
  getFileNode?: (id: string) => Promise<any>;
}, projectId: string, sourceId: string) {
  const doc = await store.getDocument(projectId, sourceId);
  if (doc) return { doc, documentId: doc.id as string, fileNodeId: undefined as string | undefined };
  if (!store.getFileNode) return null;
  const node = await resolveProjectFileNode(projectId, sourceId, (id) => store.getFileNode!(id));
  if (!node) return null;
  const linkedId = node.documentId ?? node.metadata?.sourceDocumentId;
  const linked = linkedId ? await store.getDocument(projectId, linkedId) : null;
  return {
    doc: linked ?? { ...node, fileName: node.name, source: "file_node" },
    documentId: `file-${node.id}`,
    fileNodeId: node.id as string,
  };
}

/** Only formats that can become one extracted source; archives/models use their own explicit adapters. */
export function canPromoteSourceFile(name: string): boolean {
  return /\.(pdf|txt|md|csv|tsv|xlsx|xls|docx|doc|rtf|html?|png|jpe?g|tiff?|bmp|webp)$/i.test(name);
}

// Revision narrative is copied even when copyQuote resets the estimate.
// Keep every blind evaluation entry point on the same API patch.
export const BLIND_REVISION_PATCH = {
  title: "Evaluation",
  description: "",
  notes: "",
  scratchpad: "",
  leadLetter: "",
  followUpNote: "",
  shippingMethod: "",
  shippingTerms: "",
  freightOnBoard: "",
  status: "Open",
} as const;

export async function blindCopiedRevision(
  sourceProjectId: string,
  projectId: string,
  revisionId: string,
  patch: (path: string, body: typeof BLIND_REVISION_PATCH) => Promise<unknown>,
) {
  if (!sourceProjectId || !projectId || sourceProjectId === projectId || !revisionId) {
    throw new Error("Blinding requires an isolated copied project and its revision id");
  }
  await patch(`/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`, BLIND_REVISION_PATCH);
}

// Explicit answer-file exclusions preserve original drawings, BOMs and vendor quotes.
export async function excludeCopiedAnswerFiles(
  sourceProjectId: string,
  projectId: string,
  names: string[],
  files: { id: string; projectId: string; name: string; type: string; documentId?: string }[],
  remove: (path: string) => Promise<unknown>,
) {
  if (!sourceProjectId || !projectId || sourceProjectId === projectId) {
    throw new Error("Answer-file exclusions require an isolated copied project");
  }
  const selected = files.filter((file) => names.includes(file.name));
  for (const name of names) {
    if (!selected.some((file) => file.name === name)) throw new Error(`Answer file not found: ${name}`);
  }
  if (selected.some((file) => file.projectId !== projectId || file.type !== "file" || file.documentId)) {
    throw new Error("Answer-file exclusions require unlinked files belonging to the copied project");
  }
  for (const file of selected) {
    await remove(`/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(file.id)}`);
  }
  return selected.map(({ id, name }) => ({ id, name }));
}

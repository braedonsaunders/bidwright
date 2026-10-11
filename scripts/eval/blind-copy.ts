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

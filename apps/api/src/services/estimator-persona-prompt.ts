export async function resolveEstimatorPersonaForPrompt(store: any, personaId: string | undefined) {
  if (!personaId) return null;
  const persona = await store.getEstimatorPersona(personaId);
  if (!persona) return null;

  const bookIds: string[] = Array.isArray(persona.knowledgeBookIds)
    ? persona.knowledgeBookIds
    : JSON.parse(persona.knowledgeBookIds as string || "[]");
  const knowledgeDocumentIds: string[] = Array.isArray((persona as any).knowledgeDocumentIds)
    ? (persona as any).knowledgeDocumentIds
    : JSON.parse((persona as any).knowledgeDocumentIds as string || "[]");
  const datasetTags: string[] = Array.isArray(persona.datasetTags)
    ? persona.datasetTags
    : JSON.parse(persona.datasetTags as string || "[]");

  let bookNames: string[] = [];
  let knowledgeDocumentNames: string[] = [];
  if (bookIds.length > 0) {
    const books = await Promise.all(bookIds.map((id) => store.getKnowledgeBook(id).catch(() => null)));
    bookNames = books.flatMap((book: any) => book?.name ? [book.name] : []);
  }
  if (knowledgeDocumentIds.length > 0) {
    const documents = await Promise.all(knowledgeDocumentIds.map((id) => store.getKnowledgeDocument(id).catch(() => null)));
    knowledgeDocumentNames = documents.flatMap((document: any) => document?.title ? [document.title] : []);
  }

  return {
    name: persona.name,
    trade: persona.trade,
    systemPrompt: persona.systemPrompt,
    knowledgeBookNames: bookNames,
    knowledgeDocumentNames,
    datasetTags,
    packageBuckets: Array.isArray((persona as any).packageBuckets) ? (persona as any).packageBuckets : [],
    defaultAssumptions: ((persona as any).defaultAssumptions as Record<string, unknown>) ?? {},
    productivityGuidance: ((persona as any).productivityGuidance as Record<string, unknown>) ?? {},
    commercialGuidance: ((persona as any).commercialGuidance as Record<string, unknown>) ?? {},
    reviewFocusAreas: Array.isArray((persona as any).reviewFocusAreas) ? (persona as any).reviewFocusAreas : [],
  };
}


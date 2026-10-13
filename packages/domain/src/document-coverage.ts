export interface SourceReadRecord {
  documentId: string;
  tool: string;
  pages?: number[];
  section?: string;
  offset?: number;
  returnedChars?: number;
  totalChars?: number;
  truncated?: boolean;
  checksum?: string;
}

/** Delivery telemetry, not proof of understanding or scope completeness. */
export function summarizeDocumentCoverage(documents: Array<{ id: string; name?: string; pageCount?: number | null; checksum?: string | null }>, reads: SourceReadRecord[], views: Array<{ documentId?: string | null; pageNumber: number; tool: string; sourceChecksum?: string | null }> = []) {
  const sources = documents.map(doc => {
    const current = reads.filter(r => r.documentId === doc.id && (!doc.checksum || !r.checksum || doc.checksum === r.checksum));
    const visual = views.filter(v => v.documentId === doc.id && (!doc.checksum || !v.sourceChecksum || doc.checksum === v.sourceChecksum));
    const textPages = new Set<number>(), partialPages = new Set<number>();
    const groups = new Map<string, SourceReadRecord[]>();
    for (const read of current) {
      const key = JSON.stringify([read.tool, read.pages ?? [], read.section ?? ""]);
      groups.set(key, [...(groups.get(key) ?? []), read]);
    }
    let completeTextReads = 0;
    for (const group of groups.values()) {
      let end = 0;
      for (const read of [...group].sort((a,b) => (a.offset ?? 0) - (b.offset ?? 0))) {
        if ((read.offset ?? 0) <= end) end = Math.max(end, (read.offset ?? 0) + (read.returnedChars ?? 0));
      }
      const total = Math.max(...group.map(r => r.totalChars ?? Infinity));
      const complete = total > 0 && end >= total;
      if (complete) completeTextReads++;
      for (const page of group[0].pages ?? []) (complete && group[0].tool === "readDocumentText" ? textPages : partialPages).add(page);
    }
    const viewedPages = [...new Set(visual.map(v => v.pageNumber))].sort((a,b) => a-b);
    const fullPageViews = new Set(visual.filter(v => /readDrawingPage/.test(v.tool)).map(v => v.pageNumber));
    const covered = new Set([...textPages, ...fullPageViews]);
    const unreadPages = doc.pageCount ? Array.from({length: doc.pageCount}, (_, i) => i+1).filter(p => !covered.has(p)) : [];
    return { documentId: doc.id, name: doc.name, status: !current.length && !visual.length ? "unread" : doc.pageCount && !unreadPages.length ? "pages delivered" : "partly read",
      pageCount: doc.pageCount ?? null, textPageCount: textPages.size, textPages: [...textPages].sort((a,b)=>a-b).slice(0,40), viewedPageCount: viewedPages.length, viewedPages: viewedPages.slice(0,40), partialTextPages: [...partialPages].filter(p => !textPages.has(p)).sort((a,b)=>a-b).slice(0,40),
      unreadPageCount: doc.pageCount ? unreadPages.length : null, unreadPages: unreadPages.slice(0, 40),
      sections: [...new Set(current.map(r => r.section).filter(Boolean))].slice(0,40), readCalls: current.length, truncatedReads: current.filter(r => r.truncated).length, completeTextReads,
      fact: "Pages means delivered text or full-page images; tiles cover only a region. Unpaged extracted text does not establish individual page coverage. Historical reads without telemetry are unknown." };
  });
  return { sources, unreadDocuments: sources.filter(s => s.status === "unread").length, partlyReadDocuments: sources.filter(s => s.status === "partly read").length,
    fact: "Recorded source delivery, not comprehension. Unread includes sources with no recorded delivery; previous uninstrumented reads may be unknown. Truncated reads can be continued by offset with the same page/sheet selector." };
}

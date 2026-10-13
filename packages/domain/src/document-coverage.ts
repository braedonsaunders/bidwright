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
  pageRanges?: Array<{ page: number; start: number; end: number }>;
  sheetNames?: string[];
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
    const completeSheets = new Set<string>();
    const expectedSheets = new Set(current.flatMap(r => r.sheetNames ?? []));
    for (const group of groups.values()) {
      let end = 0;
      const intervals: Array<[number, number]> = [];
      for (const read of [...group].sort((a,b) => (a.offset ?? 0) - (b.offset ?? 0))) {
        const start = read.offset ?? 0, finish = start + (read.returnedChars ?? 0);
        if (start <= end) end = Math.max(end, finish);
        const last = intervals.at(-1);
        if (last && start <= last[1]) last[1] = Math.max(last[1], finish);
        else intervals.push([start, finish]);
      }
      const total = Math.max(...group.map(r => r.totalChars ?? Infinity));
      const complete = total > 0 && end >= total;
      if (complete) completeTextReads++;
      if (group[0].tool === "readDocumentText") for (const range of group.flatMap(r => r.pageRanges ?? [])) {
        if (intervals.some(([start, end]) => start <= range.start && end >= range.end)) textPages.add(range.page);
        else if (intervals.some(([start, end]) => start < range.end && end > range.start)) partialPages.add(range.page);
      }
      if (complete && group[0].tool === "readSpreadsheet") {
        for (const name of group[0].section === "all sheets" ? group[0].sheetNames ?? [] : [group[0].section ?? ""]) if (name) completeSheets.add(name);
      }
      for (const page of group.some(r => r.pageRanges !== undefined) ? [] : group[0].pages ?? []) (complete && group[0].tool === "readDocumentText" ? textPages : partialPages).add(page);
    }
    const viewedPages = [...new Set(visual.map(v => v.pageNumber))].sort((a,b) => a-b);
    const fullPageViews = new Set(visual.filter(v => /readDrawingPage/.test(v.tool)).map(v => v.pageNumber));
    const covered = new Set([...textPages, ...fullPageViews]);
    const unreadPages = doc.pageCount ? Array.from({length: doc.pageCount}, (_, i) => i+1).filter(p => !covered.has(p)) : [];
    const sheetsRead = expectedSheets.size > 0 && [...expectedSheets].every(s => completeSheets.has(s));
    return { documentId: doc.id, name: doc.name, sheetCount: expectedSheets.size || null, readSheetCount: completeSheets.size, status: !current.length && !visual.length ? "unread" : sheetsRead ? "read" : doc.pageCount && !unreadPages.length ? "pages delivered" : "partly read",
      pageCount: doc.pageCount ?? null, deliveredPageCount: doc.pageCount ? doc.pageCount - unreadPages.length : null,
      pageCoverage: doc.pageCount ? `${doc.pageCount - unreadPages.length}/${doc.pageCount} pages delivered` : null,
      textPageCount: textPages.size, textPages: [...textPages].sort((a,b)=>a-b).slice(0,10), viewedPageCount: viewedPages.length, viewedPages: viewedPages.slice(0,10), partialTextPages: [...partialPages].filter(p => !textPages.has(p)).sort((a,b)=>a-b).slice(0,10),
      unreadPageCount: expectedSheets.size ? null : doc.pageCount ? unreadPages.length : null, unreadPages: expectedSheets.size ? [] : unreadPages.slice(0, 10),
      sections: [...new Set(current.map(r => r.section).filter(Boolean))].slice(0,10), readCalls: current.length, truncatedReads: current.filter(r => r.truncated).length, completeTextReads,
      fact: "Pages means delivered text or full-page images; tiles cover only a region. Page coverage follows recorded physical page text ranges. Historical reads without telemetry are unknown." };
  });
  return { totalDocuments: sources.length, shownDocuments: Math.min(20, sources.length), sources: sources.slice().sort((a,b) => Number(b.status === "unread") - Number(a.status === "unread") || Number(b.status === "partly read") - Number(a.status === "partly read")).slice(0,20), readDocuments: sources.filter(s => ["read", "pages delivered"].includes(s.status)).length, unreadDocuments: sources.filter(s => s.status === "unread").length, partlyReadDocuments: sources.filter(s => s.status === "partly read").length,
    fact: "Recorded source delivery, not comprehension. Unread includes sources with no recorded delivery; previous uninstrumented reads may be unknown. Truncated reads can be continued by offset with the same page/sheet selector." };
}

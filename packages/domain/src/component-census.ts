export interface ComponentCensusEntry {
  type: string;
  pageNumber: number | null;
  count: number | null;
  unit: string;
  method: "schedule quantity" | "tagged schedule rows" | "legend entry" | "tagged text references";
  confidence: number;
  sourceRefs: Array<{ page?: number; table?: number; row?: number; text: string }>;
}

/** Generic schedule/legend columns, not trade-specific component or connection rules. */
export function componentCensus(tables: Array<{ markdown?: string; pageNumber?: number; page?: number }>, textPages: Array<{ pageNumber: number | null; text: string }>, tagPrefixes: string[] = []) {
  const entries: ComponentCensusEntry[] = [];
  tables.forEach((table, tableIndex) => {
    const rows = (table.markdown ?? "").split("\n").filter(line => line.includes("|")).map(line => line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()));
    if (rows.length < 2) return;
    const header = rows[0].map(cell => cell.toLowerCase());
    const qty = header.findIndex(cell => /^(qty\.?|quantity|count|number required)$/.test(cell));
    const uom = header.findIndex(cell => /^(unit|units|uom)$/.test(cell));
    const type = header.findIndex(cell => /^(type|description|component|item|designation)$/.test(cell)) >= 0 ? header.findIndex(cell => /^(type|description|component|item|designation)$/.test(cell)) : header.indexOf("symbol");
    const tag = header.findIndex(cell => /^(tag|mark|id|reference)$/.test(cell));
    if (type < 0) return;
    const pageNumber = table.pageNumber ?? table.page ?? null;
    const groups = new Map<string, ComponentCensusEntry>();
    const seenTags = new Set<string>();
    rows.slice(1).forEach((row, index) => {
      if (row.every(cell => /^[-: ]*$/.test(cell)) || !row[type]) return;
      const value = qty >= 0 && /^\d+(?:\.\d+)?$/.test(row[qty] ?? "") ? Number(row[qty]) : null;
      const tagged = tag >= 0 && !!row[tag];
      if (tagged && seenTags.has(row[tag])) return;
      if (tagged) seenTags.add(row[tag]);
      const method = value !== null ? "schedule quantity" : tagged ? "tagged schedule rows" : "legend entry";
      const unit = value !== null && uom >= 0 ? row[uom] || "unknown" : "EA";
      const key = `${row[type]}:${method}:${unit}`;
      const entry = groups.get(key) ?? { type: row[type], pageNumber, count: method === "legend entry" ? null : 0, unit, method, confidence: value !== null ? .95 : tagged ? .8 : .5, sourceRefs: [] };
      if (entry.count !== null) entry.count += value ?? 1;
      entry.sourceRefs.push({ ...(pageNumber ? { page: pageNumber } : {}), table: tableIndex, row: index + 2, text: row.join(" | ") });
      groups.set(key, entry);
    });
    entries.push(...groups.values());
  });
  for (const page of textPages) for (const prefix of tagPrefixes) {
    // Literal prefixes are supplied by the caller from the source legend; never infer trade tag rules.
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const tags = [...new Set(page.text.match(new RegExp(`\\b${escaped}[- ]?\\d+[A-Za-z]?\\b`, "g")) ?? [])];
    if (tags.length) entries.push({ type: prefix, pageNumber: page.pageNumber, count: tags.length, unit: "EA", method: "tagged text references", confidence: .5, sourceRefs: [{ ...(page.pageNumber ? { page: page.pageNumber } : {}), text: tags.join(", ") }] });
  }
  return { entries, fact: "Schedule quantities, tagged references and symbol matches can overlap; they are separate observations, not additive totals. Legend presence has no installed count. Confidence describes extraction, not verified scope. Connections use the estimator's stated per-component basis in a derivation." };
}

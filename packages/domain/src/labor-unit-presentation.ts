/** Read-time identities: imported numeric row labels are not operation names. */
export function laborUnitPresentation(unit: Record<string, any>) {
  const ref = unit.sourceRef ?? {};
  const meta = unit.metadata ?? {};
  const dimensions = ref.dimensions ?? ref.rowDimensions ?? meta.dimensions ?? {};
  const dimensionText = Array.isArray(dimensions) ? dimensions.map((dimension) => `${dimension.label ?? dimension.key} ${dimension.value}`).join(", ") : Object.entries(dimensions)
    .filter(([, value]) => ["string", "number"].includes(typeof value))
    .map(([key, value]) => `${key} ${value}`).join(", ");
  const parts = [ref.datasetName ?? meta.sourceDatasetName ?? meta.datasetName ?? unit.category ?? unit.className,
    unit.subClassName, dimensionText, ref.valueColumnName ?? ref.columnName ?? ref.column ?? meta.columnName,
    /^\d+(\.\d+)?$/.test(String(unit.name)) ? (dimensionText ? "" : `${unit.className || "row"} ${unit.name}`) : unit.name]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const name = [...new Set(parts)].join(" › ");
  const path = [...new Set([unit.library?.name ?? meta.libraryName, unit.category, name].filter(Boolean))].join(" › ");
  return { name: name || String(unit.name ?? ""), path, sourceBook: ref.sourceBookName ?? ref.bookName ?? ref.bookId ?? ref.sourceBookId ?? null,
    sourcePage: ref.sourcePages ?? ref.page ?? ref.pageNumber ?? ref.sourcePage ?? null };
}

/** Keep independent operations separate; a broad row cannot win by incidental word overlap. */
export function laborOperationQueries(query: string): string[] {
  const explicit = query.split(/\s*(?:;|\n|\band\b|\bthen\b)\s*/i).filter(Boolean);
  if (explicit.length > 1) return explicit.slice(0, 8);
  const operation = /\b(?:fabricat(?:e|ion|ing)|weld(?:ing)?|erect(?:ion|ing)?|cut(?:ting)?|install(?:ation|ing)?|demoli(?:sh|tion)|paint(?:ing)?|excavat(?:e|ion|ing)|insulat(?:e|ion|ing)|drill(?:ing)?|test(?:ing)?)\b/gi;
  const hits = [...query.matchAll(operation)];
  if (hits.length < 2) return [query];
  // A leading material belongs with the first operation ("steel plate fabrication").
  return hits.map((hit, index) => query.slice(index === 0 ? 0 : hit.index!, hits[index + 1]?.index ?? query.length).trim()).filter(Boolean).slice(0, 8);
}

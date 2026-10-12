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
  return { displayName: name || String(unit.name ?? ""), path, sourceBook: ref.sourceBookName ?? ref.bookName ?? ref.bookId ?? ref.sourceBookId ?? null,
    sourcePage: ref.sourcePages ?? ref.page ?? ref.pageNumber ?? ref.sourcePage ?? null };
}

/** Only explicit separators denote independent searches; grammatical phrases stay intact. */
export function laborOperationQueries(query: string): string[] {
  return query.split(/[;\n]/).map(part => part.trim()).filter(Boolean).slice(0, 8);
}

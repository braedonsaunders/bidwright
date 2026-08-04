type SearchableDataset = {
  name?: unknown;
  description?: unknown;
  tags?: unknown;
  columns?: unknown;
};

function normalized(value: unknown): string {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function datasetText(dataset: SearchableDataset): { metadata: string; columns: string } {
  const tags = Array.isArray(dataset.tags) ? dataset.tags.join(" ") : dataset.tags;
  const columns = Array.isArray(dataset.columns)
    ? dataset.columns.map((column: any) => `${column?.key ?? ""} ${column?.name ?? ""} ${column?.label ?? ""}`).join(" ")
    : dataset.columns;
  return {
    metadata: normalized(`${dataset.name ?? ""} ${dataset.description ?? ""} ${tags ?? ""}`),
    columns: normalized(columns),
  };
}

/**
 * Promote datasets that cover the requested activity/material and penalize
 * explicit scope contradictions. Text relevance alone otherwise ranks a
 * "welding only / carbon steel" table above a combined fit-and-weld stainless
 * table simply because its title repeats more query words.
 */
export function datasetSearchFitnessAdjustment(query: string, dataset: SearchableDataset): number {
  const request = normalized(query);
  const { metadata, columns } = datasetText(dataset);
  let adjustment = 0;

  const needsFit = /\bfit(?:ting|up)?\b/.test(request);
  const needsWeld = /\bweld(?:ing|s)?\b/.test(request);
  const needsStainless = /\bstainless\b|\b304l?\b|\b316l?\b/.test(request);
  const fittingColumns = /\bfit(?:ting)?(?: hrs| hours)?\b/.test(columns);
  const weldingBasis = /\bweld|minutes per inch|number of passes/.test(`${metadata} ${columns}`);
  const stainlessColumns = /\bstainless(?: percent| factor| adder)?\b/.test(columns);

  if (needsFit && needsWeld && fittingColumns && weldingBasis) adjustment += 18;
  if (needsFit && /\bweld(?:ing)? only\b/.test(metadata)) adjustment -= 22;
  if (needsStainless && stainlessColumns) adjustment += 12;
  if (needsStainless && /\bcarbon steel\b/.test(metadata)) adjustment -= 14;

  return adjustment;
}


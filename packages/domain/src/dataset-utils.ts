export type DatasetRowRecord = Record<string, unknown>;

export interface DatasetFieldFilter {
  key: string;
  value: unknown;
}

const DATASET_KEY_ALIASES: Record<string, string[]> = {
  category: ["labour_category", "labourCategory", "LabourCategory"],
  labour_category: ["category"],
  labourCategory: ["category"],
  LabourCategory: ["category"],
  labourcategory: ["category"],
};

export function normalizeDatasetKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getNormalizedDatasetKeyCandidates(key: string): Set<string> {
  const aliases = DATASET_KEY_ALIASES[key] ?? DATASET_KEY_ALIASES[normalizeDatasetKey(key)] ?? [];
  return new Set([key, ...aliases].map(normalizeDatasetKey));
}

export function getDatasetCellValue(row: DatasetRowRecord, key: string): unknown {
  if (key in row) {
    return row[key];
  }

  const candidates = getNormalizedDatasetKeyCandidates(key);
  for (const [rowKey, value] of Object.entries(row)) {
    if (candidates.has(normalizeDatasetKey(rowKey))) {
      return value;
    }
  }

  return undefined;
}

export function getDatasetCellString(row: DatasetRowRecord, key: string): string {
  const value = getDatasetCellValue(row, key);
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

export function getDatasetCellNumber(row: DatasetRowRecord, key: string): number {
  const value = getDatasetCellValue(row, key);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function datasetRowMatchesFilters(
  row: DatasetRowRecord,
  filters: DatasetFieldFilter[],
): boolean {
  return filters.every((filter) => {
    const expected = String(filter.value ?? "").trim();
    if (!expected) {
      return true;
    }
    return getDatasetCellString(row, filter.key) === expected;
  });
}

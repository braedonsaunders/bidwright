import type { DatasetColumn } from "./models";

export type DatasetRowRecord = Record<string, unknown>;
export type DatasetFieldDefinition = Pick<DatasetColumn, "key" | "name">;

export interface DatasetFieldFilter {
  key: string;
  value: unknown;
}

function splitCamelCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export function normalizeDatasetKey(key: string): string {
  return splitCamelCase(key).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokenizeDatasetKey(key: string): string[] {
  return splitCamelCase(key)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function isTokenSubset(required: string[], candidate: string[]): boolean {
  if (required.length === 0) {
    return false;
  }
  const candidateSet = new Set(candidate);
  return required.every((token) => candidateSet.has(token));
}

function scoreDatasetIdentifierMatch(requested: string, candidate: string): number {
  if (!requested || !candidate) {
    return 0;
  }

  if (requested === candidate) {
    return 100;
  }

  const requestedNormalized = normalizeDatasetKey(requested);
  const candidateNormalized = normalizeDatasetKey(candidate);
  if (!requestedNormalized || !candidateNormalized) {
    return 0;
  }

  if (requestedNormalized === candidateNormalized) {
    return 95;
  }

  const requestedTokens = tokenizeDatasetKey(requested);
  const candidateTokens = tokenizeDatasetKey(candidate);
  if (requestedTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  if (requestedTokens.join("|") === candidateTokens.join("|")) {
    return 90;
  }

  if (isTokenSubset(requestedTokens, candidateTokens)) {
    return 75 - Math.max(0, candidateTokens.length - requestedTokens.length);
  }

  if (
    requestedNormalized.length >= 4 &&
    (candidateNormalized.endsWith(requestedNormalized) || candidateNormalized.startsWith(requestedNormalized))
  ) {
    return 65;
  }

  if (
    candidateNormalized.length >= 4 &&
    (requestedNormalized.endsWith(candidateNormalized) || requestedNormalized.startsWith(candidateNormalized))
  ) {
    return 60;
  }

  return 0;
}

function scoreDatasetFieldDefinitionMatch(
  requestedKey: string,
  definition: DatasetFieldDefinition,
): number {
  return Math.max(
    scoreDatasetIdentifierMatch(requestedKey, definition.key),
    scoreDatasetIdentifierMatch(requestedKey, definition.name ?? ""),
  );
}

function resolveDatasetFieldDefinition(
  requestedKey: string,
  definitions: DatasetFieldDefinition[],
): DatasetFieldDefinition | null {
  const scored = definitions
    .map((definition) => ({
      definition,
      score: scoreDatasetFieldDefinitionMatch(requestedKey, definition),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return null;
  }

  const best = scored[0];
  const tied = scored.filter((entry) => entry.score === best.score);
  if (tied.length > 1) {
    const uniqueKeys = new Set(tied.map((entry) => normalizeDatasetKey(entry.definition.key)));
    if (uniqueKeys.size > 1) {
      return null;
    }
  }

  return best.definition;
}

export function resolveDatasetFieldKey(
  requestedKey: string,
  options?: {
    columns?: DatasetFieldDefinition[];
    row?: DatasetRowRecord;
    candidateKeys?: string[];
  },
): string | null {
  if (!requestedKey) {
    return null;
  }

  if (options?.row && requestedKey in options.row) {
    return requestedKey;
  }

  const requestedNormalized = normalizeDatasetKey(requestedKey);
  const exactKey =
    Object.keys(options?.row ?? {}).find((key) => normalizeDatasetKey(key) === requestedNormalized) ??
    options?.candidateKeys?.find((key) => normalizeDatasetKey(key) === requestedNormalized) ??
    options?.columns?.find((column) => normalizeDatasetKey(column.key) === requestedNormalized)?.key;
  if (exactKey) {
    return exactKey;
  }

  if (options?.columns?.length) {
    const definition = resolveDatasetFieldDefinition(requestedKey, options.columns);
    if (definition) {
      return definition.key;
    }
  }

  const rowKeys = Object.keys(options?.row ?? {});
  if (rowKeys.length > 0) {
    const definition = resolveDatasetFieldDefinition(
      requestedKey,
      rowKeys.map((key) => ({ key, name: key })),
    );
    if (definition) {
      return definition.key;
    }
  }

  if (options?.candidateKeys?.length) {
    const definition = resolveDatasetFieldDefinition(
      requestedKey,
      options.candidateKeys.map((key) => ({ key, name: key })),
    );
    if (definition) {
      return definition.key;
    }
  }

  return null;
}

export function getDatasetCellValue(
  row: DatasetRowRecord,
  key: string,
  columns?: DatasetFieldDefinition[],
): unknown {
  const resolvedKey = resolveDatasetFieldKey(key, { columns, row });
  return resolvedKey ? row[resolvedKey] : undefined;
}

export function getDatasetCellString(
  row: DatasetRowRecord,
  key: string,
  columns?: DatasetFieldDefinition[],
): string {
  const value = getDatasetCellValue(row, key, columns);
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

export function getDatasetCellNumber(
  row: DatasetRowRecord,
  key: string,
  columns?: DatasetFieldDefinition[],
): number {
  const value = getDatasetCellValue(row, key, columns);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function datasetRowMatchesFilters(
  row: DatasetRowRecord,
  filters: DatasetFieldFilter[],
  columns?: DatasetFieldDefinition[],
): boolean {
  return filters.every((filter) => {
    const expected = String(filter.value ?? "").trim();
    if (!expected) {
      return true;
    }
    return getDatasetCellString(row, filter.key, columns) === expected;
  });
}

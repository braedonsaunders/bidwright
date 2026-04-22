"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Plus,
  Minus,
  GripVertical,
  ChevronDown,
  ChevronRight,
  Calculator,
  Search,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  FadeIn,
  Input,
  Label,
  Select,
  Textarea,
  Toggle,
} from "@/components/ui";
import type {
  PluginUISchema,
  PluginUISection,
  PluginField,
  PluginTable,
  PluginTableColumn,
  PluginScoring,
  PluginFieldOption,
  PluginFieldConditional,
  PluginOutput,
} from "@/lib/api";
import {
  listDatasetRows,
  listRateSchedules,
} from "@/lib/api";
import { resolveApiUrl } from "@/lib/api/client";
import {
  computeNecaExtendedDuration,
  computeNecaTemperatureAdjustment,
} from "@bidwright/domain";

// ── Dataset Options Hook ────────────────────────────────────────────

type DatasetRowData = Record<string, unknown>;
type DatasetRowsById = Record<string, DatasetRowData[]>;
type PluginSearchResult = Record<string, unknown>;

// Cache for dataset rows to avoid redundant fetches
const datasetRowsCache = new Map<string, { rows: DatasetRowData[]; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

async function fetchDatasetRows(datasetId: string): Promise<DatasetRowData[]> {
  const cacheKey = `all:${datasetId}`;
  const cached = datasetRowsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.rows;

  try {
    const result = await listDatasetRows(datasetId, { limit: 5000 });
    const rows = (result.rows ?? []).map((r: any) => r.data ?? r);
    datasetRowsCache.set(cacheKey, { rows, ts: Date.now() });
    return rows;
  } catch {
    return [];
  }
}

function useDatasetOptions(
  optionsSource: PluginField["optionsSource"],
  parentValue?: unknown,
): { options: PluginFieldOption[]; loading: boolean; allRows: DatasetRowData[] } {
  const [options, setOptions] = useState<PluginFieldOption[]>([]);
  const [allRows, setAllRows] = useState<DatasetRowData[]>([]);
  const [loading, setLoading] = useState(false);
  const prevKey = useRef("");

  useEffect(() => {
    if (!optionsSource?.datasetId || !optionsSource.column) return;
    if (optionsSource.type !== "dataset" && optionsSource.type !== "cascade") return;

    // For cascade, skip if no parent value
    if (optionsSource.type === "cascade" && (!parentValue || parentValue === "")) {
      setOptions([]);
      setAllRows([]);
      return;
    }

    const key = `${optionsSource.datasetId}:${optionsSource.column}:${optionsSource.type}:${parentValue ?? ""}`;
    if (key === prevKey.current) return;
    prevKey.current = key;

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const rows = await fetchDatasetRows(optionsSource.datasetId!);

        let filtered = rows;
        if (optionsSource.type === "cascade" && optionsSource.parentColumn && parentValue) {
          filtered = rows.filter(
            (r) => String(r[optionsSource.parentColumn!] ?? "") === String(parentValue)
          );
        }

        // Extract unique values for the column
        const seen = new Set<string>();
        const opts: PluginFieldOption[] = [];
        for (const row of filtered) {
          const val = String(row[optionsSource.column!] ?? "");
          if (val && !seen.has(val)) {
            seen.add(val);
            opts.push({ value: val, label: val });
          }
        }
        opts.sort((a, b) => a.label.localeCompare(b.label));

        if (!cancelled) {
          setOptions(opts);
          setAllRows(rows);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setOptions([]);
          setAllRows([]);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [optionsSource?.datasetId, optionsSource?.column, optionsSource?.type, optionsSource?.parentColumn, parentValue]);

  return { options, loading, allRows };
}

// ── Rate schedule options hook ──────────────────────────────────────

function useRateScheduleOptions(
  optionsSource: PluginField["optionsSource"],
): { options: PluginFieldOption[]; loading: boolean } {
  const [options, setOptions] = useState<PluginFieldOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (optionsSource?.type !== "rate_schedule") return;

    setLoading(true);
    (async () => {
      try {
        const schedules = await listRateSchedules();
        const opts: PluginFieldOption[] = [];
        for (const sched of schedules ?? []) {
          for (const item of (sched as any).items ?? []) {
            opts.push({
              value: item.id,
              label: `${item.name}${item.trade ? ` (${item.trade})` : ""}`,
              description: `$${item.rate?.toFixed(2) ?? "0.00"}/hr`,
            });
          }
        }
        setOptions(opts);
      } catch {
        setOptions([]);
      }
      setLoading(false);
    })();
  }, [optionsSource?.type]);

  return { options, loading };
}

// ── Formula Evaluator ─────────────────────────────────────────────────

/** Lookup a value from dataset rows by matching field values. */
function datasetLookup(
  rows: DatasetRowData[],
  matchColumns: string[],
  matchValues: unknown[],
  resultColumn: string,
): number {
  for (const row of rows) {
    let match = true;
    for (let i = 0; i < matchColumns.length; i++) {
      const rowVal = String(row[matchColumns[i]] ?? "");
      const matchVal = String(matchValues[i] ?? "");
      if (!matchVal || rowVal !== matchVal) { match = false; break; }
    }
    if (match) {
      const val = row[resultColumn];
      return typeof val === "number" ? val : parseFloat(String(val)) || 0;
    }
  }
  return 0;
}

/** Interpolate a value from a sorted dataset lookup table. */
function datasetInterpolate(
  rows: DatasetRowData[],
  inputColumn: string,
  inputValue: number,
  resultColumn: string,
): number {
  if (rows.length === 0) return 0;
  const sorted = [...rows].sort((a, b) => (Number(a[inputColumn]) || 0) - (Number(b[inputColumn]) || 0));
  const first = Number(sorted[0][inputColumn]) || 0;
  const last = Number(sorted[sorted.length - 1][inputColumn]) || 0;
  if (inputValue <= first) return Number(sorted[0][resultColumn]) || 0;
  if (inputValue >= last) return Number(sorted[sorted.length - 1][resultColumn]) || 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = Number(sorted[i][inputColumn]) || 0;
    const hi = Number(sorted[i + 1][inputColumn]) || 0;
    if (inputValue >= lo && inputValue <= hi) {
      const t = hi !== lo ? (inputValue - lo) / (hi - lo) : 0;
      const loVal = Number(sorted[i][resultColumn]) || 0;
      const hiVal = Number(sorted[i + 1][resultColumn]) || 0;
      return loVal + t * (hiVal - loVal);
    }
  }
  return 0;
}

/** Nearest-neighbor lookup in a dataset by Euclidean distance across multiple columns. */
function datasetNearest(
  rows: DatasetRowData[],
  matchColumns: string[],
  matchValues: number[],
  resultColumn: string,
): number {
  let bestDist = Infinity;
  let bestVal = 0;
  for (const row of rows) {
    let dist = 0;
    for (let i = 0; i < matchColumns.length; i++) {
      const diff = (Number(row[matchColumns[i]]) || 0) - matchValues[i];
      dist += diff * diff;
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestVal = Number(row[resultColumn]) || 0;
    }
  }
  return bestVal;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysBetween(start: unknown, end: unknown): number {
  const startValue = Date.parse(String(start ?? ""));
  const endValue = Date.parse(String(end ?? ""));
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || endValue <= startValue) {
    return 0;
  }
  return Math.round((endValue - startValue) / 86_400_000);
}

function resolveComputationResultColumn(
  values: Record<string, unknown>,
  computation?: PluginField["computation"],
): string {
  if (!computation) {
    return "value";
  }

  const selectedKey = computation.resultColumnFrom
    ? String(values[computation.resultColumnFrom] ?? "")
    : "";

  if (selectedKey && computation.resultColumnMap?.[selectedKey]) {
    return computation.resultColumnMap[selectedKey];
  }

  return computation.resultColumn ?? "value";
}

function evaluateFormula(
  formula: string,
  values: Record<string, unknown>,
  datasetRows?: DatasetRowData[],
  computation?: PluginField["computation"],
): number {
  try {
    // Handle lookup() formula — requires dataset context
    if (formula.startsWith("lookup(") && datasetRows && computation) {
      const lookupCols = computation.lookupColumns ?? [];
      const resultCol = resolveComputationResultColumn(values, computation);
      const matchValues = lookupCols.map((col) => values[col]);
      return datasetLookup(datasetRows, lookupCols, matchValues, resultCol);
    }

    // Handle interpolate() formula
    if (formula.startsWith("interpolate(") && datasetRows && computation) {
      const inputCol = computation.lookupColumns?.[0] ?? "";
      const resultCol = resolveComputationResultColumn(values, computation);
      const inputValue = toNumber(values[inputCol]);
      return datasetInterpolate(datasetRows, inputCol, inputValue, resultCol);
    }

    // Handle nearest() formula
    if (formula.startsWith("nearest(") && datasetRows && computation) {
      const matchCols = computation.lookupColumns ?? [];
      const resultCol = resolveComputationResultColumn(values, computation);
      const matchValues = matchCols.map((col) => toNumber(values[col]));
      return datasetNearest(datasetRows, matchCols, matchValues, resultCol);
    }

    // Handle sum() aggregation for table data
    // sum(tableId, 'columnId') — evaluates from table data stored in values
    const sumMatch = formula.match(/^sum\((\w+),\s*'(\w+)'\)\s*(.*)/);
    if (sumMatch) {
      const [, tableId, colId, rest] = sumMatch;
      const tableRows = values[`__table_${tableId}`] as Record<string, unknown>[] | undefined;
      const sum = (tableRows ?? []).reduce((acc, row) => acc + (Number(row[colId]) || 0), 0);
      if (rest) {
        // Evaluate rest of expression with sum value
        // eslint-disable-next-line no-new-func
        const fn = new Function("__sum__", ...Object.keys(values), `"use strict"; try { return __sum__ ${rest}; } catch { return 0; }`);
        const result = fn(sum, ...Object.keys(values).map((k) => values[k]));
        return typeof result === "number" && isFinite(result) ? result : 0;
      }
      return sum;
    }

    // Standard formula evaluation
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      "daysBetween",
      "necaTemperatureLostProductivity",
      "necaTemperatureAdditionalHours",
      "necaExtendedRecommendedWorkers",
      "necaExtendedAdditionalHours",
      ...Object.keys(values),
      `"use strict"; try { return (${formula}); } catch { return 0; }`
    );
    const result = fn(
      daysBetween,
      (temperature: unknown, temperatureUnit: unknown, humidity: unknown) =>
        computeNecaTemperatureAdjustment({
          temperature: toNumber(temperature),
          temperatureUnit: String(temperatureUnit ?? "F"),
          humidity: toNumber(humidity),
          baseHours: 0,
        }).lostProductivityPercent,
      (baseHours: unknown, temperature: unknown, temperatureUnit: unknown, humidity: unknown) =>
        computeNecaTemperatureAdjustment({
          baseHours: toNumber(baseHours),
          temperature: toNumber(temperature),
          temperatureUnit: String(temperatureUnit ?? "F"),
          humidity: toNumber(humidity),
        }).additionalHours,
      (baseHours: unknown) =>
        computeNecaExtendedDuration({
          baseHours: toNumber(baseHours),
          monthsExtended: 1,
        }).recommendedWorkers,
      (baseHours: unknown, workers: unknown, monthsExtended: unknown) =>
        computeNecaExtendedDuration({
          baseHours: toNumber(baseHours),
          workers: toNumber(workers) || undefined,
          monthsExtended: toNumber(monthsExtended),
        }).totalAdditionalHours,
      ...Object.keys(values).map((k) => values[k])
    );
    return typeof result === "number" && isFinite(result) ? result : 0;
  } catch {
    return 0;
  }
}

function formatValue(value: number, format?: string): string {
  switch (format) {
    case "currency":
      return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "hours":
      return `${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} hrs`;
    case "percentage":
      return `${value.toFixed(1)}%`;
    case "number":
    default:
      return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
}

function buildFormulaValues(
  values: Record<string, unknown>,
  tableData: Record<string, Record<string, unknown>[]>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...values };
  for (const [tableId, rows] of Object.entries(tableData)) {
    next[`__table_${tableId}`] = rows;
  }
  return next;
}

function recomputeComputedFields(
  schema: PluginUISchema,
  values: Record<string, unknown>,
  tableData: Record<string, Record<string, unknown>[]>,
  datasetRowsById: DatasetRowsById,
): Record<string, unknown> {
  const next = { ...values };
  const formulaValues = buildFormulaValues(next, tableData);

  for (const section of schema.sections) {
    for (const field of section.fields ?? []) {
      if (field.type !== "computed" || !field.computation) {
        continue;
      }

      const datasetRows = field.computation.datasetId
        ? datasetRowsById[field.computation.datasetId] ?? []
        : undefined;
      next[field.id] = evaluateFormula(
        field.computation.formula,
        formulaValues,
        datasetRows,
        field.computation,
      );
      formulaValues[field.id] = next[field.id];
    }
  }

  return next;
}

function resolveSearchResultValue(
  result: PluginSearchResult,
  selector?: string | string[],
): unknown {
  if (!selector) {
    return undefined;
  }

  if (Array.isArray(selector)) {
    for (const key of selector) {
      const value = result[key];
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  }

  return result[selector];
}

// ── Field Visibility Check ─────────────────────────────────────────────

function evaluateConditional(conditional: PluginFieldConditional, values: Record<string, unknown>): boolean {
  const fieldValue = values[conditional.field];
  switch (conditional.operator) {
    case "eq": return fieldValue === conditional.value;
    case "neq": return fieldValue !== conditional.value;
    case "gt": return Number(fieldValue) > Number(conditional.value);
    case "lt": return Number(fieldValue) < Number(conditional.value);
    case "gte": return Number(fieldValue) >= Number(conditional.value);
    case "lte": return Number(fieldValue) <= Number(conditional.value);
    case "in": return Array.isArray(conditional.value) && conditional.value.includes(fieldValue);
    case "not_in": return Array.isArray(conditional.value) && !conditional.value.includes(fieldValue);
    case "contains": return String(fieldValue).includes(String(conditional.value));
    case "truthy": return Boolean(fieldValue);
    case "falsy": return !fieldValue;
    default: return true;
  }
}

function isFieldVisible(field: PluginField, values: Record<string, unknown>): boolean {
  if (!field.conditionals?.length) return true;
  return field.conditionals.every((c) => {
    if (c.action === "show") return evaluateConditional(c, values);
    if (c.action === "hide") return !evaluateConditional(c, values);
    return true;
  });
}

// ── Width CSS ─────────────────────────────────────────────────────────

const widthClasses: Record<string, string> = {
  full: "col-span-12",
  half: "col-span-6",
  third: "col-span-4",
  quarter: "col-span-3",
};

// ── Field Renderer ────────────────────────────────────────────────────

function PluginSearchField({
  field,
  value,
  onChange,
  onPatch,
  allValues,
}: {
  field: PluginField;
  value: unknown;
  onChange: (value: unknown) => void;
  onPatch?: (patch: Record<string, unknown>) => void;
  allValues: Record<string, unknown>;
}) {
  const searchConfig = field.searchConfig;
  const [query, setQuery] = useState(String(value ?? ""));
  const [results, setResults] = useState<PluginSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const minQueryLength = searchConfig?.minQueryLength ?? field.validation?.minLength ?? 1;

  useEffect(() => {
    setQuery(String(value ?? ""));
  }, [value]);

  const extraParams = useMemo(() => {
    const params: Record<string, string> = {};
    for (const [paramKey, sourceFieldId] of Object.entries(searchConfig?.params ?? {})) {
      const sourceValue = allValues[sourceFieldId];
      if (sourceValue !== undefined && sourceValue !== null && sourceValue !== "") {
        params[paramKey] = String(sourceValue);
      }
    }
    return params;
  }, [allValues, searchConfig?.params]);

  const extraParamsKey = useMemo(() => JSON.stringify(extraParams), [extraParams]);
  const paramFieldCount = Object.keys(searchConfig?.params ?? {}).length;
  const hasAllParamValues = Object.keys(extraParams).length >= paramFieldCount;

  useEffect(() => {
    if (!searchConfig?.endpoint) {
      setResults([]);
      setLoading(false);
      return;
    }

    const trimmed = query.trim();
    if (trimmed.length < minQueryLength) {
      setResults([]);
      setLoading(false);
      return;
    }
    if (!hasAllParamValues) {
      setResults([]);
      setLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          [searchConfig.queryParam]: trimmed,
          ...extraParams,
        });
        const response = await fetch(
          resolveApiUrl(`${searchConfig.endpoint}?${params.toString()}`),
          {
            cache: "no-store",
            credentials: "include",
            headers: { Accept: "application/json" },
          },
        );
        if (!response.ok) {
          throw new Error(`Search request failed (${response.status})`);
        }

        const payload = (await response.json()) as PluginSearchResult[] | { results?: PluginSearchResult[] };
        const nextResults = Array.isArray(payload)
          ? payload
          : Array.isArray(payload.results)
            ? payload.results
            : [];

        if (currentRequestId === requestIdRef.current) {
          setResults(nextResults);
        }
      } catch {
        if (currentRequestId === requestIdRef.current) {
          setResults([]);
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    extraParamsKey,
    hasAllParamValues,
    minQueryLength,
    query,
    searchConfig?.endpoint,
    searchConfig?.queryParam,
  ]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-fg/30" />
        <Input
          id={field.id}
          className="pl-9 pr-9"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
          }}
          placeholder={field.placeholder}
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-fg/30" />
        )}
      </div>

      {results.length > 0 && (
        <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-panel2/50">
          {results.map((result, index) => {
            const selectedValue =
              resolveSearchResultValue(result, searchConfig?.valueField) ??
              resolveSearchResultValue(result, searchConfig?.displayField) ??
              query;
            const displayValue = String(
              resolveSearchResultValue(result, searchConfig?.displayField) ?? selectedValue ?? "",
            );
            const meta = (searchConfig?.resultFields ?? [])
              .map((key) => {
                const rawValue = result[key];
                if (rawValue === undefined || rawValue === null || rawValue === "") {
                  return null;
                }
                if (key.toLowerCase().includes("price") && typeof rawValue === "number") {
                  return `$${rawValue.toFixed(2)}`;
                }
                return String(rawValue);
              })
              .filter((entry): entry is string => Boolean(entry));

            return (
              <button
                key={`${String(selectedValue)}-${index}`}
                type="button"
                className="w-full border-b border-line/50 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-panel"
                onClick={() => {
                  const patch: Record<string, unknown> = { [field.id]: selectedValue };
                  for (const [targetFieldId, selector] of Object.entries(searchConfig?.populateFields ?? {})) {
                    const resolvedValue = resolveSearchResultValue(result, selector);
                    if (resolvedValue !== undefined) {
                      patch[targetFieldId] = resolvedValue;
                    }
                  }

                  setQuery(displayValue);
                  setResults([]);
                  if (onPatch) {
                    onPatch(patch);
                  } else {
                    onChange(selectedValue);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-xs font-medium text-fg/80">{displayValue}</span>
                  {meta[0] && (
                    <span className="shrink-0 text-[10px] text-accent">{meta[0]}</span>
                  )}
                </div>
                {meta.length > 1 && (
                  <p className="mt-1 text-[10px] text-fg/45">{meta.slice(1).join(" | ")}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {!loading && query.trim().length >= minQueryLength && !hasAllParamValues && (
        <p className="text-[10px] text-fg/40">Complete the related fields before searching.</p>
      )}

      {!loading && query.trim().length >= minQueryLength && hasAllParamValues && results.length === 0 && (
        <p className="text-[10px] text-fg/40">No matches found.</p>
      )}
    </div>
  );
}

function PluginFieldRenderer({
  field,
  value,
  onChange,
  onPatch,
  allValues,
  error,
  datasetRowsById,
}: {
  field: PluginField;
  value: unknown;
  onChange: (value: unknown) => void;
  onPatch?: (patch: Record<string, unknown>) => void;
  allValues: Record<string, unknown>;
  error?: string;
  datasetRowsById?: DatasetRowsById;
}) {
  if (!isFieldVisible(field, allValues)) return null;

  // Resolve dataset options for select fields
  const parentField = field.optionsSource?.type === "cascade" ? field.optionsSource.dependsOn : undefined;
  const parentValue = parentField ? allValues[parentField] : undefined;
  const dsOpts = useDatasetOptions(
    field.optionsSource?.type === "dataset" || field.optionsSource?.type === "cascade"
      ? field.optionsSource
      : undefined,
    parentValue,
  );
  const rsOpts = useRateScheduleOptions(
    field.optionsSource?.type === "rate_schedule" ? field.optionsSource : undefined,
  );

  // Merge: dataset/rate_schedule options override static options
  const resolvedOptions = useMemo(() => {
    if (dsOpts.options.length > 0) return dsOpts.options;
    if (rsOpts.options.length > 0) return rsOpts.options;
    return field.options ?? [];
  }, [dsOpts.options, rsOpts.options, field.options]);

  const optionsLoading = dsOpts.loading || rsOpts.loading;
  const fieldDatasetRows = field.computation?.datasetId
    ? datasetRowsById?.[field.computation.datasetId] ?? []
    : undefined;

  const computedValue = field.type === "computed" && field.computation
    ? evaluateFormula(field.computation.formula, allValues, fieldDatasetRows, field.computation)
    : undefined;

  return (
    <div className={cn(widthClasses[field.width ?? "full"], "space-y-1")}>
      <Label htmlFor={field.id}>
        {field.label}
        {field.validation?.required && <span className="text-danger ml-0.5">*</span>}
      </Label>
      {field.description && (
        <p className="text-[10px] text-fg/40 -mt-0.5 mb-1">{field.description}</p>
      )}

      {field.type === "text" && (
        <Input
          id={field.id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "number" && (
        <Input
          id={field.id}
          type="number"
          value={value !== undefined && value !== null ? String(value) : ""}
          onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
          placeholder={field.placeholder}
          min={field.validation?.min}
          max={field.validation?.max}
          step="any"
        />
      )}

      {field.type === "currency" && (
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-fg/40">$</span>
          <Input
            id={field.id}
            type="number"
            className="pl-7"
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder={field.placeholder ?? "0.00"}
            step="0.01"
            min={field.validation?.min}
          />
        </div>
      )}

      {field.type === "percentage" && (
        <div className="relative">
          <Input
            id={field.id}
            type="number"
            className="pr-7"
            value={value !== undefined && value !== null ? String(value) : ""}
            onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
            placeholder={field.placeholder ?? "0"}
            step="0.1"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg/40">%</span>
        </div>
      )}

      {field.type === "select" && (
        <div className="relative">
          <Select
            id={field.id}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            disabled={optionsLoading}
          >
            <option value="">
              {optionsLoading ? "Loading..." : field.placeholder ?? "Select..."}
            </option>
            {resolvedOptions.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </Select>
          {optionsLoading && (
            <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-fg/30" />
          )}
        </div>
      )}

      {field.type === "multi-select" && (
        <select
          id={field.id}
          multiple
          className="h-auto min-h-[80px] w-full rounded-lg border border-line bg-bg/50 px-3 py-2 text-sm text-fg outline-none"
          value={Array.isArray(value) ? value.map(String) : []}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
            onChange(selected);
          }}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {field.type === "radio" && (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs transition-all",
                value === opt.value
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-line bg-bg/50 text-fg/60 hover:border-fg/30"
              )}
            >
              <span className="font-medium">{opt.label}</span>
              {opt.description && (
                <span className="block text-[10px] text-fg/40 mt-0.5">{opt.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {field.type === "slider" && (
        <div className="flex items-center gap-3">
          <input
            id={field.id}
            type="range"
            className="flex-1 accent-accent"
            value={Number(value ?? field.defaultValue ?? 1)}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            min={field.validation?.min ?? 0}
            max={field.validation?.max ?? 100}
            step={0.1}
          />
          <span className="text-xs font-mono text-fg/60 w-10 text-right">
            {Number(value ?? field.defaultValue ?? 1).toFixed(1)}
          </span>
        </div>
      )}

      {field.type === "date" && (
        <Input
          id={field.id}
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.type === "textarea" && (
        <Textarea
          id={field.id}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
        />
      )}

      {field.type === "boolean" && (
        <div className="flex items-center gap-2">
          <Toggle
            checked={Boolean(value ?? field.defaultValue)}
            onChange={(v) => onChange(v)}
          />
          <span className="text-xs text-fg/60">{value ? "Yes" : "No"}</span>
        </div>
      )}

      {field.type === "computed" && computedValue !== undefined && (
        <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2">
          <Calculator className="h-3.5 w-3.5 text-accent/60" />
          <span className="text-sm font-mono font-medium text-accent">
            {formatValue(computedValue, field.computation?.format)}
          </span>
        </div>
      )}

      {field.type === "search" && (
        <PluginSearchField
          field={field}
          value={value}
          onChange={onChange}
          onPatch={onPatch}
          allValues={allValues}
        />
      )}

      {field.type === "hidden" && (
        <input type="hidden" id={field.id} value={String(value ?? "")} />
      )}

      {error && (
        <p className="text-[10px] text-danger flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// ── Table Renderer ────────────────────────────────────────────────────

function PluginTableRenderer({
  table,
  rows,
  onRowsChange,
  allValues,
}: {
  table: PluginTable;
  rows: Record<string, unknown>[];
  onRowsChange: (rows: Record<string, unknown>[]) => void;
  allValues: Record<string, unknown>;
}) {
  const addRow = useCallback(() => {
    onRowsChange([...rows, { ...table.rowTemplate }]);
  }, [rows, table.rowTemplate, onRowsChange]);

  const deleteRow = useCallback((idx: number) => {
    onRowsChange(rows.filter((_, i) => i !== idx));
  }, [rows, onRowsChange]);

  const updateCell = useCallback((rowIdx: number, colId: string, value: unknown) => {
    const updated = rows.map((row, i) => {
      if (i !== rowIdx) return row;
      const newRow = { ...row, [colId]: value };
      // Recompute computed columns
      for (const col of table.columns) {
        if (col.type === "computed" && col.computation) {
          newRow[col.id] = evaluateFormula(col.computation.formula, newRow);
        }
      }
      return newRow;
    });
    onRowsChange(updated);
  }, [rows, table.columns, onRowsChange]);

  // Calculate aggregates
  const aggregates = useMemo(() => {
    const agg: Record<string, number> = {};
    for (const col of table.columns) {
      if (col.aggregate) {
        const vals = rows.map((r) => Number(r[col.id]) || 0);
        switch (col.aggregate) {
          case "sum": agg[col.id] = vals.reduce((a, b) => a + b, 0); break;
          case "avg": agg[col.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0; break;
          case "min": agg[col.id] = vals.length ? Math.min(...vals) : 0; break;
          case "max": agg[col.id] = vals.length ? Math.max(...vals) : 0; break;
          case "count": agg[col.id] = vals.length; break;
        }
      }
    }
    return agg;
  }, [rows, table.columns]);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-panel2/50">
              {table.allowReorder && <th className="w-8 px-1" />}
              {table.columns.map((col) => (
                <th
                  key={col.id}
                  className="px-3 py-2 text-left font-medium text-fg/60"
                  style={{ width: col.width }}
                >
                  {col.label}
                </th>
              ))}
              {table.allowDeleteRow && <th className="w-8 px-1" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx} className="border-b border-line/50 hover:bg-panel2/30">
                {table.allowReorder && (
                  <td className="px-1 text-center">
                    <GripVertical className="h-3 w-3 text-fg/20 cursor-grab" />
                  </td>
                )}
                {table.columns.map((col) => (
                  <td key={col.id} className="px-1 py-1">
                    {col.type === "computed" ? (
                      <span className="px-2 text-xs font-mono text-accent">
                        {formatValue(Number(row[col.id]) || 0, col.computation?.format)}
                      </span>
                    ) : col.type === "select" ? (
                      <select
                        className="h-7 w-full rounded border border-line/50 bg-transparent px-2 text-xs text-fg outline-none focus:border-accent/50"
                        value={String(row[col.id] ?? "")}
                        onChange={(e) => updateCell(rowIdx, col.id, e.target.value)}
                        disabled={!col.editable}
                      >
                        <option value="">Select...</option>
                        {(col.options ?? []).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : col.type === "number" || col.type === "currency" ? (
                      <input
                        type="number"
                        className="h-7 w-full rounded border border-line/50 bg-transparent px-2 text-xs text-fg outline-none focus:border-accent/50 font-mono"
                        value={row[col.id] !== undefined ? String(row[col.id]) : ""}
                        onChange={(e) => updateCell(rowIdx, col.id, e.target.value ? parseFloat(e.target.value) : 0)}
                        disabled={!col.editable}
                        step="any"
                      />
                    ) : (
                      <input
                        type="text"
                        className="h-7 w-full rounded border border-line/50 bg-transparent px-2 text-xs text-fg outline-none focus:border-accent/50"
                        value={String(row[col.id] ?? "")}
                        onChange={(e) => updateCell(rowIdx, col.id, e.target.value)}
                        disabled={!col.editable}
                      />
                    )}
                  </td>
                ))}
                {table.allowDeleteRow && (
                  <td className="px-1 text-center">
                    <button
                      type="button"
                      onClick={() => deleteRow(rowIdx)}
                      className="rounded p-0.5 text-fg/30 hover:text-danger transition-colors"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {table.totalsRow && (
            <tfoot>
              <tr className="bg-panel2/30 font-medium">
                {table.allowReorder && <td />}
                {table.columns.map((col) => (
                  <td key={col.id} className="px-3 py-2">
                    {col.aggregate && aggregates[col.id] !== undefined ? (
                      <span className="text-xs font-mono text-accent font-semibold">
                        {formatValue(aggregates[col.id], col.computation?.format ?? "number")}
                      </span>
                    ) : col === table.columns[0] ? (
                      <span className="text-xs text-fg/50">Total</span>
                    ) : null}
                  </td>
                ))}
                {table.allowDeleteRow && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {table.allowAddRow && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={addRow}
          disabled={table.maxRows !== undefined && rows.length >= table.maxRows}
        >
          <Plus className="h-3 w-3" />
          Add Row
        </Button>
      )}
    </div>
  );
}

// ── Scoring Renderer ──────────────────────────────────────────────────

function PluginScoringRenderer({
  scoring,
  scores,
  onScoresChange,
}: {
  scoring: PluginScoring;
  scores: Record<string, number>;
  onScoresChange: (scores: Record<string, number>) => void;
}) {
  const totalScore = useMemo(() => {
    let total = 0;
    for (const criterion of scoring.criteria) {
      const score = scores[criterion.id] ?? criterion.scale.min;
      total += score * criterion.weight;
    }
    return total;
  }, [scores, scoring.criteria]);

  const maxScore = useMemo(
    () => scoring.criteria.reduce((sum, criterion) => sum + (criterion.scale.max * criterion.weight), 0),
    [scoring.criteria],
  );

  const currentResult = useMemo(() => {
    return scoring.resultMapping.find(
      (r) => totalScore >= r.minScore && totalScore <= r.maxScore
    ) ?? scoring.resultMapping[0];
  }, [totalScore, scoring.resultMapping]);

  return (
    <div className="space-y-4">
      {scoring.description && (
        <p className="text-xs text-fg/50">{scoring.description}</p>
      )}

      <div className="space-y-3">
        {scoring.criteria.map((criterion) => {
          const value = scores[criterion.id] ?? criterion.scale.min;
          return (
            <div key={criterion.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-fg/80">{criterion.label}</span>
                  {criterion.description && (
                    <span className="text-[10px] text-fg/40 ml-2">{criterion.description}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-fg/40">
                    {criterion.scale.labels?.[value] ?? ""}
                  </span>
                  <Badge tone="info" className="text-[10px] font-mono">{value}</Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-fg/40 w-6 text-center">
                  {criterion.scale.labels?.[criterion.scale.min] ?? criterion.scale.min}
                </span>
                <input
                  type="range"
                  className="flex-1 accent-accent"
                  value={value}
                  onChange={(e) =>
                    onScoresChange({ ...scores, [criterion.id]: parseInt(e.target.value) })
                  }
                  min={criterion.scale.min}
                  max={criterion.scale.max}
                  step={criterion.scale.step}
                />
                <span className="text-[10px] text-fg/40 w-6 text-center">
                  {criterion.scale.labels?.[criterion.scale.max] ?? criterion.scale.max}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Result Display */}
      <div
        className="rounded-lg border px-4 py-3 flex items-center justify-between"
        style={{
          borderColor: currentResult?.color ? `${currentResult.color}40` : undefined,
          backgroundColor: currentResult?.color ? `${currentResult.color}10` : undefined,
        }}
      >
        <div>
          <span className="text-sm font-semibold" style={{ color: currentResult?.color }}>
            {currentResult?.label}
          </span>
          {currentResult?.description && (
            <p className="text-[11px] text-fg/50 mt-0.5">{currentResult.description}</p>
          )}
        </div>
        <div className="text-right">
          <span className="text-lg font-mono font-bold" style={{ color: currentResult?.color }}>
            {totalScore.toFixed(1)}
          </span>
          <p className="text-[10px] text-fg/40">score of {maxScore.toFixed(1)}</p>
        </div>
      </div>
    </div>
  );
}

// ── Section Renderer ──────────────────────────────────────────────────

function PluginSectionRenderer({
  section,
  values,
  onChange,
  onPatch,
  tableData,
  onTableDataChange,
  scoringData,
  onScoringDataChange,
  errors,
  datasetRowsById,
}: {
  section: PluginUISection;
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  onPatch?: (patch: Record<string, unknown>) => void;
  tableData: Record<string, Record<string, unknown>[]>;
  onTableDataChange: (tableId: string, rows: Record<string, unknown>[]) => void;
  scoringData: Record<string, Record<string, number>>;
  onScoringDataChange: (scoringId: string, scores: Record<string, number>) => void;
  errors: Record<string, string>;
  datasetRowsById?: DatasetRowsById;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const fieldValues = useMemo(() => buildFormulaValues(values, tableData), [tableData, values]);

  return (
    <div className="space-y-3">
      {section.label && (
        <button
          type="button"
          className="flex items-center gap-2 w-full text-left"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-fg/40" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-fg/40" />
          )}
          <span className="text-xs font-semibold text-fg/70 uppercase tracking-wide">
            {section.label}
          </span>
          {section.description && (
            <span className="text-[10px] text-fg/40 font-normal normal-case tracking-normal">
              — {section.description}
            </span>
          )}
        </button>
      )}

      {!collapsed && (
        <FadeIn>
          {(section.type === "fields" || section.type === "search") && section.fields && (
            <div className="grid grid-cols-12 gap-3">
              {section.fields
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .map((field) => (
                  <PluginFieldRenderer
                    key={field.id}
                    field={field}
                    value={values[field.id]}
                    onChange={(v) => onChange(field.id, v)}
                    onPatch={onPatch}
                    allValues={fieldValues}
                    error={errors[field.id]}
                    datasetRowsById={datasetRowsById}
                  />
                ))}
            </div>
          )}

          {section.type === "table" && section.table && (
            <PluginTableRenderer
              table={section.table}
              rows={tableData[section.table.id] ?? section.table.defaultRows ?? []}
              onRowsChange={(rows) => onTableDataChange(section.table!.id, rows)}
              allValues={values}
            />
          )}

          {section.type === "scoring" && section.scoring && (
            <PluginScoringRenderer
              scoring={section.scoring}
              scores={scoringData[section.scoring.id] ?? {}}
              onScoresChange={(scores) => onScoringDataChange(section.scoring!.id, scores)}
            />
          )}

          {section.type === "preview" && (
            <div className="rounded-lg border border-line bg-bg/50 p-4 min-h-[120px]">
              <p className="text-xs text-fg/30 italic">
                Preview will be generated after submission...
              </p>
            </div>
          )}

          {section.type === "summary" && (
            <div className="rounded-lg border border-line bg-panel2/30 p-4">
              <p className="text-xs text-fg/50">Output summary will appear here after execution.</p>
            </div>
          )}
        </FadeIn>
      )}
    </div>
  );
}

// ── Main Plugin Runtime ───────────────────────────────────────────────

export interface PluginRuntimeProps {
  schema: PluginUISchema;
  initialValues?: Record<string, unknown>;
  initialTableData?: Record<string, Record<string, unknown>[]>;
  initialScoringData?: Record<string, Record<string, number>>;
  onSubmit: (data: {
    values: Record<string, unknown>;
    tableData: Record<string, Record<string, unknown>[]>;
    scoringData: Record<string, Record<string, number>>;
  }) => void;
  onCancel?: () => void;
  submitting?: boolean;
  output?: PluginOutput | null;
  onAddItemsToWorksheet?: (items: NonNullable<PluginOutput["lineItems"]>, worksheetId: string) => void;
  worksheets?: Array<{ id: string; name: string }>;
}

export function PluginRuntime({
  schema,
  initialValues,
  initialTableData,
  initialScoringData,
  onSubmit,
  onCancel,
  submitting,
  output,
  onAddItemsToWorksheet,
  worksheets,
}: PluginRuntimeProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues ?? {});
  const [tableData, setTableData] = useState<Record<string, Record<string, unknown>[]>>(initialTableData ?? {});
  const [scoringData, setScoringData] = useState<Record<string, Record<string, number>>>(initialScoringData ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [datasetRowsById, setDatasetRowsById] = useState<DatasetRowsById>({});

  // Collect all dataset IDs referenced by computed fields (for lookup/interpolate/nearest)
  useEffect(() => {
    const dsIds = new Set<string>();
    for (const section of schema.sections) {
      if (!section.fields) continue;
      for (const field of section.fields) {
        if (field.computation?.datasetId) dsIds.add(field.computation.datasetId);
      }
    }
    if (dsIds.size === 0) {
      setDatasetRowsById({});
      return;
    }

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        [...dsIds].map(async (datasetId) => [datasetId, await fetchDatasetRows(datasetId)] as const),
      );
      if (!cancelled) {
        setDatasetRowsById(Object.fromEntries(entries));
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build cascade dependency map: fieldId → dependent field IDs
  const cascadeDeps = useMemo(() => {
    const deps: Record<string, string[]> = {};
    for (const section of schema.sections) {
      if (!section.fields) continue;
      for (const field of section.fields) {
        if (field.optionsSource?.type === "cascade" && field.optionsSource.dependsOn) {
          const parent = field.optionsSource.dependsOn;
          if (!deps[parent]) deps[parent] = [];
          deps[parent].push(field.id);
        }
      }
    }
    return deps;
  }, [schema.sections]);

  // Initialize default values from schema
  useEffect(() => {
    const defaults: Record<string, unknown> = {};
    const tableDefs: Record<string, Record<string, unknown>[]> = {};
    for (const section of schema.sections) {
      if (section.fields) {
        for (const field of section.fields) {
          if (field.defaultValue !== undefined && values[field.id] === undefined) {
            defaults[field.id] = field.defaultValue;
          }
        }
      }
      if (section.table?.defaultRows && !tableData[section.table.id]) {
        tableDefs[section.table.id] = [...section.table.defaultRows];
      }
    }
    if (Object.keys(tableDefs).length > 0) {
      setTableData((t) => ({ ...tableDefs, ...t }));
    }
    if (Object.keys(defaults).length > 0 || Object.keys(tableDefs).length > 0) {
      const nextTables = Object.keys(tableDefs).length > 0
        ? { ...tableDefs, ...tableData }
        : tableData;
      setValues((v) => recomputeComputedFields(schema, { ...defaults, ...v }, nextTables, datasetRowsById));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setValues((prev) => recomputeComputedFields(schema, prev, tableData, datasetRowsById));
  }, [datasetRowsById, schema, tableData]);

  const handleValuesPatch = useCallback((patch: Record<string, unknown>) => {
    const patchKeys = Object.keys(patch);
    if (patchKeys.length === 0) {
      return;
    }

    setValues((prev) => {
      const next = { ...prev, ...patch };

      const clearDeps = (parentId: string) => {
        const deps = cascadeDeps[parentId];
        if (!deps) return;
        for (const depId of deps) {
          if (!(depId in patch)) {
            next[depId] = "";
          }
          clearDeps(depId);
        }
      };

      for (const fieldId of patchKeys) {
        clearDeps(fieldId);
      }

      return recomputeComputedFields(schema, next, tableData, datasetRowsById);
    });

    setErrors((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const fieldId of patchKeys) {
        if (fieldId in next) {
          delete next[fieldId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [cascadeDeps, datasetRowsById, schema, tableData]);

  const handleFieldChange = useCallback((fieldId: string, value: unknown) => {
    handleValuesPatch({ [fieldId]: value });
  }, [handleValuesPatch]);

  const handleTableDataChange = useCallback((tableId: string, rows: Record<string, unknown>[]) => {
    setTableData((prev) => {
      const next = { ...prev, [tableId]: rows };
      setValues((currentValues) => recomputeComputedFields(schema, currentValues, next, datasetRowsById));
      return next;
    });
  }, [datasetRowsById, schema]);

  const handleScoringDataChange = useCallback((scoringId: string, scores: Record<string, number>) => {
    setScoringData((prev) => ({ ...prev, [scoringId]: scores }));
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};
    for (const section of schema.sections) {
      if (!section.fields) continue;
      for (const field of section.fields) {
        if (!isFieldVisible(field, values)) continue;
        if (field.type === "computed" || field.type === "hidden") continue;
        const val = values[field.id];
        if (field.validation?.required && (val === undefined || val === null || val === "")) {
          newErrors[field.id] = `${field.label} is required`;
        }
        if (field.validation?.min !== undefined && typeof val === "number" && val < field.validation.min) {
          newErrors[field.id] = `${field.label} must be at least ${field.validation.min}`;
        }
        if (field.validation?.max !== undefined && typeof val === "number" && val > field.validation.max) {
          newErrors[field.id] = `${field.label} must be at most ${field.validation.max}`;
        }
        if (field.validation?.minLength !== undefined && typeof val === "string" && val.length < field.validation.minLength) {
          newErrors[field.id] = `${field.label} must be at least ${field.validation.minLength} characters`;
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [schema.sections, values]);

  const handleSubmit = useCallback(() => {
    if (!validate()) return;
    onSubmit({ values, tableData, scoringData });
  }, [validate, onSubmit, values, tableData, scoringData]);

  const sortedSections = useMemo(
    () => [...schema.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [schema.sections]
  );

  return (
    <div className="space-y-5">
      {sortedSections.map((section) => (
        <PluginSectionRenderer
          key={section.id}
          section={section}
          values={values}
          onChange={handleFieldChange}
          onPatch={handleValuesPatch}
          tableData={tableData}
          onTableDataChange={handleTableDataChange}
          scoringData={scoringData}
          onScoringDataChange={handleScoringDataChange}
          errors={errors}
          datasetRowsById={datasetRowsById}
        />
      ))}

      {/* Output Display */}
      {output && (
        <PluginOutputDisplay
          output={output}
          onAddItemsToWorksheet={onAddItemsToWorksheet}
          worksheets={worksheets}
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            {schema.cancelLabel ?? "Cancel"}
          </Button>
        )}
        <Button variant="accent" size="sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Processing..." : schema.submitLabel ?? "Submit"}
        </Button>
      </div>
    </div>
  );
}

// ── Plugin Output Display ─────────────────────────────────────────────

export function PluginOutputDisplay({
  output,
  onAddItemsToWorksheet,
  worksheets,
}: {
  output: PluginOutput;
  onAddItemsToWorksheet?: (items: NonNullable<PluginOutput["lineItems"]>, worksheetId: string) => void;
  worksheets?: Array<{ id: string; name: string }>;
}) {
  const [selectedWorksheet, setSelectedWorksheet] = useState("");

  return (
    <FadeIn>
      <div className="rounded-lg border border-success/20 bg-success/5 p-4 space-y-3">
        {output.displayText && (
          <p className="text-xs text-success font-medium">{output.displayText}</p>
        )}

        {output.type === "line_items" && output.lineItems && output.lineItems.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium uppercase tracking-wide">
              Line Items ({output.lineItems.length})
            </p>
            <div className="overflow-x-auto rounded border border-line/50">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-line/30 bg-panel2/30">
                    <th className="px-2 py-1 text-left text-fg/50">Category</th>
                    <th className="px-2 py-1 text-left text-fg/50">Description</th>
                    <th className="px-2 py-1 text-right text-fg/50">Qty</th>
                    <th className="px-2 py-1 text-right text-fg/50">Cost</th>
                    <th className="px-2 py-1 text-right text-fg/50">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {output.lineItems.map((item, i) => (
                    <tr key={i} className="border-b border-line/20">
                      <td className="px-2 py-1 text-fg/60">{item.category}</td>
                      <td className="px-2 py-1 text-fg/80">{item.description}</td>
                      <td className="px-2 py-1 text-right font-mono text-fg/60">
                        {item.quantity} {item.uom}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-fg/60">
                        {item.cost !== undefined ? `$${item.cost.toFixed(2)}` : "\u2014"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-fg/80">
                        {item.price !== undefined ? `$${item.price.toFixed(2)}` : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {onAddItemsToWorksheet && (
              <div className="mt-3 flex items-center gap-2">
                <Select
                  value={selectedWorksheet}
                  onChange={(e) => setSelectedWorksheet(e.target.value)}
                  className="text-xs h-7"
                >
                  <option value="">Select worksheet...</option>
                  {(worksheets ?? []).map(ws => (
                    <option key={ws.id} value={ws.id}>{ws.name}</option>
                  ))}
                </Select>
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!selectedWorksheet}
                  onClick={() => {
                    if (selectedWorksheet && output.lineItems) {
                      onAddItemsToWorksheet(output.lineItems, selectedWorksheet);
                    }
                  }}
                >
                  Add {output.lineItems.length} items to worksheet
                </Button>
              </div>
            )}
          </div>
        )}

        {output.type === "text_content" && output.textContent && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium">
              Output → {output.textContent.targetField}
            </p>
            <div className="rounded border border-line/50 bg-bg/50 p-3 text-xs text-fg/80 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {output.textContent.content}
            </div>
          </div>
        )}

        {output.type === "revision_patch" && output.revisionPatches && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium uppercase tracking-wide">
              Revision Updates
            </p>
            {output.revisionPatches.map((patch, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-panel2/30 px-3 py-1.5">
                <span className="text-xs text-fg/60">{patch.field}</span>
                <span className="text-xs font-mono text-accent">{String(patch.value)}</span>
              </div>
            ))}
          </div>
        )}

        {output.type === "score" && output.scores && (
          <div className="space-y-1">
            <p className="text-[10px] text-fg/50 font-medium uppercase tracking-wide">Scores</p>
            {output.scores.map((score, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-panel2/30 px-3 py-1.5">
                <span className="text-xs text-fg/60">{score.label}</span>
                <span className="text-xs font-mono text-accent">
                  {score.score}/{score.maxScore}
                </span>
              </div>
            ))}
          </div>
        )}

        {output.type === "summary" && output.summary && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-fg/70">{output.summary.title}</p>
            {output.summary.sections.map((sec, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-panel2/30 px-3 py-1.5">
                <span className="text-xs text-fg/60">{sec.label}</span>
                <span className="text-xs font-mono text-fg/80">
                  {sec.format === "currency"
                    ? `$${Number(sec.value).toFixed(2)}`
                    : sec.format === "hours"
                    ? `${Number(sec.value).toFixed(2)} hrs`
                    : sec.format === "percentage"
                    ? `${Number(sec.value).toFixed(1)}%`
                    : String(sec.value)}
                </span>
              </div>
            ))}
          </div>
        )}

        {output.type === "composite" && output.children && (
          <div className="space-y-3">
            {output.children.map((child, i) => (
              <PluginOutputDisplay
                key={i}
                output={child}
                onAddItemsToWorksheet={onAddItemsToWorksheet}
                worksheets={worksheets}
              />
            ))}
          </div>
        )}
      </div>
    </FadeIn>
  );
}

import type { PluginSearchDataSource, PluginSearchDataSourceParam } from "@bidwright/domain";

type SearchDataSourceContext = {
  dataSource: PluginSearchDataSource;
  requestQuery: Record<string, string | undefined>;
  pluginConfig: Record<string, unknown>;
  env: Record<string, string | undefined>;
};

type ResolvedParam =
  | { ok: true; value?: string }
  | { ok: false; message: string };

export type PluginRemoteSearchResult = Record<string, unknown>;
type PluginSearchResultType = NonNullable<PluginSearchDataSource["resultTypes"]>[string];

export async function executePluginSearchDataSource(
  context: SearchDataSourceContext,
): Promise<PluginRemoteSearchResult[]> {
  const { dataSource } = context;
  if (dataSource.type !== "http-json") {
    throw new Error(`Unsupported search data source type: ${dataSource.type}`);
  }

  const url = new URL(dataSource.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Search data source URL must use http or https.");
  }

  const headers = new Headers({ Accept: "application/json" });
  for (const [name, source] of Object.entries(dataSource.headers ?? {})) {
    const resolved = resolveParam(source, context);
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    if (resolved.value) {
      headers.set(name, resolved.value);
    }
  }

  for (const [name, source] of Object.entries(dataSource.query ?? {})) {
    const resolved = resolveParam(source, context);
    if (!resolved.ok) {
      throw new Error(resolved.message);
    }
    if (resolved.value !== undefined && resolved.value !== "") {
      url.searchParams.set(name, resolved.value);
    }
  }

  const response = await fetch(url, {
    method: dataSource.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(dataSource.timeoutMs ?? 15_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;
  const fallbackText = payload ? "" : await response.text().catch(() => "");

  if (!response.ok) {
    const upstreamMessage = getFirstString(readErrorValues(payload, dataSource.errorPaths), fallbackText);
    throw new Error(
      upstreamMessage
        ? `Remote search failed (${response.status}): ${upstreamMessage}`
        : `Remote search failed (${response.status})`,
    );
  }
  if (!isRecord(payload)) {
    throw new Error("Remote search returned an unexpected response.");
  }

  const errorMessage = getFirstString(readErrorValues(payload, dataSource.errorPaths));
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return mapSearchResults(payload, dataSource);
}

function resolveParam(source: PluginSearchDataSourceParam, context: SearchDataSourceContext): ResolvedParam {
  if (!isRecord(source)) {
    return { ok: true, value: serializeParamValue(source) };
  }

  const value = (() => {
    switch (source.from) {
      case "query":
        return getFirstString(context.requestQuery[source.key ?? "q"], source.default);
      case "field":
        return getFirstString(context.requestQuery[source.key], source.default);
      case "config":
        return getFirstString(context.pluginConfig[source.key], source.env ? context.env[source.env] : undefined, source.default);
      case "env":
        return getFirstString(context.env[source.key], source.default);
      case "limit":
        return String(resolveLimit(context.requestQuery.limit, source.min, source.max, source.default));
      case "static":
        return serializeParamValue(source.value);
      default:
        return "";
    }
  })();

  if (!value && source.required) {
    return { ok: false, message: `${source.label ?? source.key ?? "Required search value"} is required.` };
  }
  return { ok: true, value };
}

function resolveLimit(rawLimit: unknown, min = 1, max = 20, fallback = 10): number {
  const parsed = Number(rawLimit);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function serializeParamValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "";
}

function mapSearchResults(payload: Record<string, unknown>, dataSource: PluginSearchDataSource): PluginRemoteSearchResult[] {
  const records = collectResultRecords(payload, dataSource.resultPaths);
  const results = records
    .map((record, index) => {
      const mapped: PluginRemoteSearchResult = { ...(dataSource.resultDefaults ?? {}) };
      for (const [target, selector] of Object.entries(dataSource.resultMap)) {
        const rawValue = resolveSelector(record, selector);
        mapped[target] = transformResultValue(rawValue, dataSource.resultTypes?.[target]);
      }
      if (mapped.id === undefined || mapped.id === null || mapped.id === "") {
        mapped.id = String(index);
      }
      return mapped;
    })
    .filter((result) => getFirstString(result.title, result.name, result.label));

  return uniqueBy(results, (item) => {
    const fields = dataSource.dedupeFields ?? ["id", "product_id", "property_token", "link", "title", "name"];
    return getFirstString(...fields.map((field) => item[field]));
  });
}

function collectResultRecords(payload: Record<string, unknown>, paths: string[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const path of paths) {
    for (const value of readPathValues(payload, path)) {
      if (Array.isArray(value)) {
        records.push(...value.filter(isRecord));
      } else if (isRecord(value)) {
        records.push(value);
      }
    }
  }
  return records;
}

function resolveSelector(record: Record<string, unknown>, selector: string | string[]): unknown {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (const path of selectors) {
    const values = readPathValues(record, path);
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
  }
  return undefined;
}

function transformResultValue(value: unknown, type?: PluginSearchResultType): unknown {
  if (type === "number") {
    return getNumericValue(value);
  }
  if (type === "image") {
    return getFirstStringFromValue(value);
  }
  if (type === "boolean") {
    return value === true || value === "true";
  }
  if (type === "string") {
    return getFirstStringFromValue(value);
  }
  return normalizeResultValue(value);
}

function normalizeResultValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return getFirstStringFromValue(value);
  }
  return value ?? "";
}

function readErrorValues(payload: unknown, errorPaths?: string[]): unknown[] {
  if (!isRecord(payload)) {
    return [];
  }
  return (errorPaths ?? ["error", "message", "search_metadata.error"]).flatMap((path) => readPathValues(payload, path));
}

function readPathValues(source: unknown, path: string): unknown[] {
  if (path === "$") {
    return [source];
  }

  return path.split(".").reduce<unknown[]>((values, segment) => {
    const next: unknown[] = [];
    for (const value of values) {
      if (segment === "*") {
        if (Array.isArray(value)) {
          next.push(...value);
        }
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isRecord(item) && segment in item) {
            next.push(item[segment]);
          }
        }
        continue;
      }
      if (isRecord(value) && segment in value) {
        next.push(value[segment]);
      }
    }
    return next;
  }, [source]);
}

function getFirstString(...values: unknown[]): string {
  for (const value of values) {
    const candidate = getFirstStringFromValue(value);
    if (candidate) {
      return candidate;
    }
  }
  return "";
}

function getFirstStringFromValue(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = getFirstStringFromValue(item);
      if (candidate) {
        return candidate;
      }
    }
  }
  return "";
}

function getNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    unique.push(item);
  }
  return unique;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

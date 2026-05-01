import { createHash } from "node:crypto";
import type { IntegrationManifestParsed, ManifestSync, ManifestRequest } from "../manifest/schema.js";
import { applyAuth, type OutboundRequest } from "../auth/index.js";
import { renderDeep, renderString } from "./template.js";
import { evalJsonPath, evalJsonPathFirst, type JsonValue } from "./jsonpath.js";

/**
 * Manifest-driven sync runner. Pulls records from a foreign system using:
 *   - request shape declared by the manifest's sync entry,
 *   - an opaque cursor (timestamp, page token, etag) tracked in
 *     IntegrationSyncState by the API/worker layer,
 *   - JSONPath extraction for `recordsPath`, `externalIdPath`, and `cursor`.
 *
 * Returns the records plus the next cursor. Persistence (ExternalRecord
 * upserts, IntegrationSyncState advance) is the caller's responsibility so
 * the runner stays free of DB dependencies and is unit-testable.
 */

export interface RunSyncInput {
  manifest: IntegrationManifestParsed;
  sync: ManifestSync;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
  cursor: string | null;
  fetchImpl?: typeof fetch;
  /** Hard cap on a single run (defense against runaway pagination). */
  maxPages?: number;
  /** Hard cap on records emitted in one run. */
  maxRecords?: number;
}

export interface SyncRecord {
  externalId: string;
  data: unknown;
  fingerprint: string;
}

export interface RunSyncOutput {
  success: boolean;
  records: SyncRecord[];
  nextCursor: string | null;
  pagesFetched: number;
  error?: string;
  durationMs: number;
}

function fingerprintOf(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(value: unknown): string {
  // Stable JSON: sort object keys recursively
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`);
  return `{${pairs.join(",")}}`;
}

function composeUrl(baseUrl: string | undefined, path: string, query: Record<string, string>): string {
  let url: URL;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    url = new URL(path);
  } else if (!baseUrl) {
    throw new Error(`sync request needs baseUrl or absolute path (got: ${path})`);
  } else {
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const rel = path.startsWith("/") ? path.slice(1) : path;
    url = new URL(rel, base);
  }
  for (const [k, v] of Object.entries(query)) {
    if (v === "" || v == null) continue;
    url.searchParams.set(k, v);
  }
  return url.toString();
}

function extractCursor(sync: ManifestSync, body: unknown, headers: Headers): string | null {
  if (sync.cursor?.fromHeader) {
    const v = headers.get(sync.cursor.fromHeader);
    return v ?? null;
  }
  if (sync.cursor?.fromResponse) {
    try {
      const v = evalJsonPathFirst(sync.cursor.fromResponse, body as JsonValue);
      if (v == null) return null;
      return typeof v === "string" ? v : JSON.stringify(v);
    } catch { return null; }
  }
  return null;
}

export async function runSync(opts: RunSyncInput): Promise<RunSyncOutput> {
  const { manifest, sync, config, credentials } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxPages = opts.maxPages ?? 100;
  const maxRecords = opts.maxRecords ?? 50_000;
  const start = Date.now();
  const records: SyncRecord[] = [];

  if (!sync.request) {
    return {
      success: false,
      records: [],
      nextCursor: opts.cursor,
      pagesFetched: 0,
      error: "manifest sync has no request defined (push-only sync?)",
      durationMs: Date.now() - start,
    };
  }

  let cursor = opts.cursor;
  let pages = 0;

  while (pages < maxPages && records.length < maxRecords) {
    const ctx = { config, credential: credentials, input: {}, cursor };
    const req: ManifestRequest = sync.request;
    const renderedQuery = renderDeep(req.query, ctx) as Record<string, string>;
    const renderedHeaders = renderDeep(req.headers, ctx) as Record<string, string>;
    const renderedPath = renderString(req.path, ctx);
    const renderedBody = renderDeep(req.body, ctx);

    // If the manifest specifies a cursor request param and we have a cursor, attach it.
    const query: Record<string, string> = { ...renderedQuery };
    if (sync.cursor?.requestParam && cursor) query[sync.cursor.requestParam] = cursor;

    const baseUrl = manifest.connection.baseUrl
      ? renderString(manifest.connection.baseUrl, ctx)
      : undefined;

    let url: string;
    try { url = composeUrl(baseUrl, renderedPath, query); }
    catch (e) {
      return {
        success: false, records, nextCursor: cursor, pagesFetched: pages,
        error: (e as Error).message, durationMs: Date.now() - start,
      };
    }

    const initialOutbound: OutboundRequest = {
      method: req.method,
      url,
      headers: { Accept: "application/json", ...renderedHeaders },
      query: {},
      body: renderedBody,
      bodyEncoding: req.bodyEncoding,
    };
    let outbound: OutboundRequest;
    try { outbound = applyAuth(manifest.connection.auth, initialOutbound, { credentials, config }); }
    catch (e) {
      return {
        success: false, records, nextCursor: cursor, pagesFetched: pages,
        error: (e as Error).message, durationMs: Date.now() - start,
      };
    }

    let res: Response;
    let body: unknown;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      try {
        res = await fetchImpl(outbound.url, {
          method: outbound.method,
          headers: outbound.headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) body = await res.json().catch(() => null);
      else body = await res.text().catch(() => null);
    } catch (e) {
      return {
        success: false, records, nextCursor: cursor, pagesFetched: pages,
        error: (e as Error).message, durationMs: Date.now() - start,
      };
    }

    if (!res.ok) {
      return {
        success: false, records, nextCursor: cursor, pagesFetched: pages,
        error: `HTTP ${res.status}: ${typeof body === "string" ? body.slice(0, 400) : JSON.stringify(body).slice(0, 400)}`,
        durationMs: Date.now() - start,
      };
    }

    pages++;

    // Extract records
    let extracted: JsonValue[] = [];
    try { extracted = evalJsonPath(sync.recordsPath, body as JsonValue); }
    catch { extracted = []; }
    // recordsPath usually points at an array — flatten one level if so.
    if (extracted.length === 1 && Array.isArray(extracted[0])) {
      extracted = extracted[0] as JsonValue[];
    }

    for (const r of extracted) {
      if (records.length >= maxRecords) break;
      let externalId: string;
      try {
        const v = evalJsonPathFirst(sync.externalIdPath, r);
        externalId = v == null ? "" : (typeof v === "string" ? v : JSON.stringify(v));
      } catch { externalId = ""; }
      if (!externalId) continue;
      records.push({ externalId, data: r, fingerprint: fingerprintOf(r) });
    }

    const next = extractCursor(sync, body, res.headers);
    if (!next || next === cursor) {
      cursor = next ?? cursor;
      break;
    }
    cursor = next;
  }

  return {
    success: true,
    records,
    nextCursor: cursor,
    pagesFetched: pages,
    durationMs: Date.now() - start,
  };
}

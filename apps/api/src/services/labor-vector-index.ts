import { createHash } from "node:crypto";
import { createEmbedder } from "@bidwright/vector";
import { laborSearchText, laborSearchProfile } from "./labor-search.js";
import { resolveEmbeddingConfig } from "./knowledge-service.js";
import type { PrismaApiStore } from "../prisma-store.js";

export function laborEmbeddingText(unit: any) {
  const { task, context } = laborSearchText(unit);
  return `${task}\n${unit.library?.name ?? ""} › ${unit.category ?? ""} › ${unit.className ?? ""}\n${context}`.slice(0, 3000);
}
export const laborContentHash = (text: string) => createHash("sha256").update(text).digest("hex");
export const laborNamespace = (org: string | null) => org === null ? "shared" : `org:${org}`;
const accessible = (org: string) => ({ library: { OR: [{ organizationId: org }, { organizationId: null }] } });
const providerKey = (config: any) => laborContentHash(JSON.stringify([config.provider, config.baseUrl ?? ""]));
const dependencies = { resolveEmbeddingConfig, createEmbedder };
const existsCache = new Map<string, { until: number; value: Promise<boolean> }>();
const queryCache = new Map<string, { until: number; vector: number[] }>();
const boundedSet = <T>(cache: Map<string, T>, key: string, value: T) => {
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
};
export const LABOR_SIMILARITY_FLOOR = .65;
export interface LaborSemanticBatch {
  providerKey: string; model: string; dimensions: number; queries: Map<string, number[]>;
}
export interface LaborSemanticFilters {
  libraryId?: string; provider?: string; category?: string | null; className?: string | null; subClassName?: string | null;
  excludeIds?: string[]; includeEmptyHierarchy?: boolean;
}

/** Bounded, resumable pages. The default dry run neither mutates data nor calls the provider. */
export async function indexLaborUnitPage(db: any, store: PrismaApiStore, input: { cursor?: string; limit?: number; dryRun?: boolean }, deps = dependencies) {
  const config = await deps.resolveEmbeddingConfig(store);
  if (!config) return { enabled: false, fact: "No embedding provider configured", nextCursor: null, embedded: 0 };
  const org = store.organizationId, key = providerKey(config);
  const embedder = deps.createEmbedder({ ...config, signal: AbortSignal.timeout(120_000) });
  const model = config.model ?? embedder.id, dimensions = embedder.dimensions;
  const run = async (tx: any) => {
    // Serializes concurrent indexing pages, including two tenants' shared rows, before checking hashes/spending.
    if (input.dryRun === false) await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('labor-unit-vector-index'))::text");
    const units = await tx.laborUnit.findMany({ where: { ...accessible(org), ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
      include: { library: true }, orderBy: { id: "asc" }, take: Math.min(100, Math.max(1, input.limit ?? 100)) });
    const records = units.map((unit: any) => { const text = laborEmbeddingText(unit); return { unit, text, hash: laborContentHash(text), namespace: laborNamespace(unit.library.organizationId) }; });
    // No document IDs or requestor-org copies: one row per source unit, shared libraries stored once.
    const existing: any[] = await tx.$queryRawUnsafe(`SELECT unit_id, content_hash FROM labor_unit_vectors
      WHERE provider_key = $1 AND model = $2 AND dimensions = $3 AND unit_id = ANY($4::text[])`, key, model, dimensions, units.map((u: any) => u.id));
    const hashes = new Map(existing.map(row => [row.unit_id, row.content_hash]));
    const changed = records.filter((record: any) => hashes.get(record.unit.id) !== record.hash);
    const estimatedTokens = changed.reduce((sum: number, record: any) => sum + Math.ceil(Buffer.byteLength(record.text) / 4), 0);
    let embedded = 0, saved = 0;
    if (input.dryRun === false && changed.length) {
      const embeddings = await embedder.embed(changed.map((record: any) => record.text));
      if (embeddings.length !== changed.length || embeddings.some(vector => vector.length !== dimensions)) throw new Error("Embedding batch shape differs from the configured dimensions");
      for (let index = 0; index < changed.length; index++) {
        const record = changed[index], unit = record.unit;
        // Reject snapshots edited during the provider call; locks serialize later edits with the invalidation triggers.
        const written = await tx.$queryRawUnsafe(`WITH current_unit AS MATERIALIZED (
          SELECT u.id FROM "LaborUnit" u JOIN "LaborUnitLibrary" l ON l.id = u."libraryId"
          WHERE u.id = $1 AND l.id = $2 AND u."updatedAt" = $10::timestamp AND l."updatedAt" = $11::timestamp
          AND (l."organizationId" = $12 OR l."organizationId" IS NULL) FOR SHARE OF u, l
        ) INSERT INTO labor_unit_vectors (unit_id, library_id, namespace, provider_key, model, dimensions, content_hash, text, embedding, unit_updated_at, library_updated_at)
          SELECT id, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10::timestamp, $11::timestamp FROM current_unit
          ON CONFLICT (unit_id) DO UPDATE SET library_id = EXCLUDED.library_id, namespace = EXCLUDED.namespace,
            provider_key = EXCLUDED.provider_key, model = EXCLUDED.model, dimensions = EXCLUDED.dimensions, content_hash = EXCLUDED.content_hash,
            text = EXCLUDED.text, embedding = EXCLUDED.embedding, unit_updated_at = EXCLUDED.unit_updated_at, library_updated_at = EXCLUDED.library_updated_at
          RETURNING unit_id`, unit.id, unit.libraryId, record.namespace, key, model, dimensions, record.hash, record.text,
          `[${embeddings[index].join(",")}]`, unit.updatedAt, unit.library.updatedAt, org);
        saved += written.length;
      }
      embedded = changed.length;
    }
    let purged = 0;
    if (input.dryRun === false) {
      const removed = await tx.$queryRawUnsafe(`DELETE FROM labor_unit_vectors v USING "LaborUnit" u, "LaborUnitLibrary" l
        WHERE v.unit_id = u.id AND u."libraryId" = l.id AND (l."organizationId" = $1 OR l."organizationId" IS NULL)
        AND (v.provider_key <> $2 OR v.model <> $3 OR v.dimensions <> $4 OR v.library_id <> l.id
          OR v.namespace <> CASE WHEN l."organizationId" IS NULL THEN 'shared' ELSE 'org:' || l."organizationId" END
          OR v.unit_updated_at <> u."updatedAt" OR v.library_updated_at <> l."updatedAt") RETURNING v.unit_id`, org, key, model, dimensions);
      purged = removed.length;
    }
    return { enabled: true, model, dimensions, dryRun: input.dryRun !== false, purged, scanned: units.length,
      unchanged: records.length - changed.length, pending: changed.length, embedded, saved, estimatedTokens,
      tokenEstimateMethod: "UTF-8 bytes / 4; approximate, not provider-billed tokens", nextCursor: units.length ? units[units.length - 1].id : null };
  };
  const result = input.dryRun === false ? await db.$transaction(run, { timeout: 180_000, maxWait: 10_000 }) : await run(db);
  if (input.dryRun === false) existsCache.clear();
  return result;
}

/** One provider batch for a breakdown; individual searches consume these prepared vectors. */
export async function prepareLaborSemanticBatch(db: any, store: PrismaApiStore, queries: string[], deps = dependencies): Promise<LaborSemanticBatch | null> {
  try {
    const config = await deps.resolveEmbeddingConfig(store);
    if (!config) return null;
    const embedder = deps.createEmbedder({ ...config, signal: AbortSignal.timeout(Math.max(100, Number(process.env.BIDWRIGHT_SEARCH_EMBEDDING_TIMEOUT_MS) || 5000)) });
    const batch: LaborSemanticBatch = { providerKey: providerKey(config), model: config.model ?? embedder.id, dimensions: embedder.dimensions, queries: new Map() };
    const org = store.organizationId, cacheKey = JSON.stringify([org, batch.providerKey, batch.model, batch.dimensions]);
    let exists = existsCache.get(cacheKey);
    if (!exists || exists.until <= Date.now()) {
      const value = db.$queryRawUnsafe(`SELECT v.unit_id FROM labor_unit_vectors v JOIN "LaborUnitLibrary" l ON l.id = v.library_id
        WHERE (l."organizationId" = $1 OR l."organizationId" IS NULL) AND v.provider_key = $2 AND v.model = $3 AND v.dimensions = $4 LIMIT 1`, org, batch.providerKey, batch.model, batch.dimensions).then((rows: any[]) => rows.length > 0);
      exists = { until: Date.now() + 60_000, value }; boundedSet(existsCache, cacheKey, exists);
    }
    if (!await exists.value) return null;
    const pending: string[] = [];
    for (const query of new Set(queries.map(q => laborSearchProfile(q).raw))) {
      const cached = queryCache.get(`${cacheKey}:${query}`);
      if (cached && cached.until > Date.now()) batch.queries.set(query, cached.vector); else pending.push(query);
    }
    if (pending.length) {
      const vectors = await embedder.embed(pending, "query");
      if (vectors.length !== pending.length || vectors.some(v => v.length !== batch.dimensions)) return null;
      pending.forEach((query, i) => { batch.queries.set(query, vectors[i]); boundedSet(queryCache, `${cacheKey}:${query}`, { until: Date.now() + 15 * 60_000, vector: vectors[i] }); });
    }
    return batch;
  } catch { return null; }
}

export async function searchLaborVectors(db: any, store: PrismaApiStore, query: string, options: { filters?: LaborSemanticFilters; batch?: LaborSemanticBatch | null } = {}, deps = dependencies) {
  try {
    const batch = options.batch === undefined ? await prepareLaborSemanticBatch(db, store, [query], deps) : options.batch;
    const vector = batch?.queries.get(laborSearchProfile(query).raw);
    if (!batch || !vector) return [];
    const params: unknown[] = [store.organizationId, batch.providerKey, batch.model, batch.dimensions, `[${vector.join(",")}]`, LABOR_SIMILARITY_FLOOR];
    const conditions = ['(l."organizationId" = $1 OR l."organizationId" IS NULL)', 'v.provider_key = $2', 'v.model = $3', 'v.dimensions = $4',
      'v.unit_updated_at = u."updatedAt"', 'v.library_updated_at = l."updatedAt"'];
    for (const [key, value] of Object.entries(options.filters ?? {})) {
      if (key === "excludeIds") { conditions.push(`u.id <> ALL($${params.push(value)}::text[])`); continue; }
      if (!["libraryId", "provider", "category", "className", "subClassName"].includes(key) || typeof value !== "string") continue;
      if (!value.trim() && !(options.filters?.includeEmptyHierarchy && ["category", "className", "subClassName"].includes(key))) continue;
      const index = params.push(value.trim());
      if (key === "category" && /^labou?r$/i.test(value)) conditions.push(`(u."entityCategoryType" ILIKE '%lab%' OR u.category ILIKE $${index})`);
      else if (["libraryId", "provider", "category", "className", "subClassName"].includes(key)) conditions.push(`${key === "provider" ? 'l.provider' : `u."${key}"`} = $${index}`);
    }
    // Materialize eligibility BEFORE vector ranking. This avoids pgvector 0.6's post-HNSW-filter starvation,
    // including narrow library/category filters. Exact ranking is bounded by the accessible labour corpus.
    return await db.$queryRawUnsafe(`WITH eligible AS MATERIALIZED (
      SELECT v.unit_id, v.embedding FROM labor_unit_vectors v JOIN "LaborUnit" u ON u.id = v.unit_id
      JOIN "LaborUnitLibrary" l ON l.id = u."libraryId" WHERE ${conditions.join(" AND ")}
    ), scored AS (SELECT unit_id AS id, 1 - (embedding <=> $5::vector) AS score FROM eligible)
      SELECT id, score FROM scored WHERE score >= $6 ORDER BY score DESC, id LIMIT 10`, ...params) as Array<{ id: string; score: number }>;
  } catch { return []; }
}

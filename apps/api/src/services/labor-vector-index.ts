import { createHash } from "node:crypto";
import { createEmbedder, PgVectorStore } from "@bidwright/vector";
import { laborSearchText } from "./labor-search.js";
import { cachedQueryEmbedding, resolveEmbeddingConfig, type ResolvedEmbeddingConfig } from "./knowledge-service.js";
import type { PrismaApiStore } from "../prisma-store.js";

export function laborEmbeddingText(unit: any) {
  const { task, context } = laborSearchText(unit);
  return `${task}\n${unit.library?.name ?? ""} › ${unit.category ?? ""} › ${unit.className ?? ""}\n${context}`.slice(0, 3000);
}
export const laborContentHash = (text: string) => createHash("sha256").update(text).digest("hex");
function vectorDocument(config: ResolvedEmbeddingConfig) {
  return `labor-units:${laborContentHash(JSON.stringify([config.provider, config.baseUrl, config.model, config.dimensions])).slice(0, 16)}`;
}
function vectors(db: any, org: string) {
  return new PgVectorStore(async <T>(sql: string, params?: unknown[]) => db.$queryRawUnsafe(sql, ...(params ?? [])) as Promise<T[]>, org);
}
const accessible = (org: string) => ({ library: { OR: [{ organizationId: org }, { organizationId: null }] } });

/** A bounded, resumable job page. Read-only dry run is the default; it never calls the provider. */
export async function indexLaborUnitPage(db: any, store: PrismaApiStore, input: { cursor?: string; limit?: number; dryRun?: boolean }, dependencies = { resolveEmbeddingConfig, createEmbedder }) {
  const config = await dependencies.resolveEmbeddingConfig(store);
  if (!config) return { enabled: false, fact: "No embedding provider configured", nextCursor: null, embedded: 0 };
  const org = store.organizationId, documentId = vectorDocument(config);
  const units = await db.laborUnit.findMany({ where: { ...accessible(org), ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
    include: { library: true }, orderBy: { id: "asc" }, take: Math.min(100, Math.max(1, input.limit ?? 100)) });
  const records = units.map((unit: any) => { const text = laborEmbeddingText(unit); return { unit, text, hash: laborContentHash(text), id: `${org}:${documentId}:${unit.id}` }; });
  // Existing storage is required. No DDL or embedding spend before this read succeeds.
  const existing: any[] = await db.$queryRawUnsafe(`SELECT id, metadata FROM vector_records WHERE organization_id = $1 AND document_id = $2 AND id = ANY($3::text[])`, org, documentId, records.map((record: any) => record.id));
  const hashes = new Map(existing.map(row => [row.id, row.metadata?.contentHash]));
  const changed = records.filter((record: any) => hashes.get(record.id) !== record.hash);
  const estimatedTokens = changed.reduce((sum: number, record: any) => sum + Math.ceil(Buffer.byteLength(record.text) / 4), 0);
  let embedded = 0;
  if (input.dryRun === false && changed.length) {
    const embedder = dependencies.createEmbedder({ ...config, signal: AbortSignal.timeout(120_000) });
    const columns = await db.$queryRawUnsafe(`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'vector_records'::regclass AND attname = 'embedding'`);
    if (columns[0]?.type !== `vector(${embedder.dimensions})`) throw new Error("Embedding dimensions differ from vector_records storage; no embeddings requested");
    const embeddings = await embedder.embed(changed.map((record: any) => record.text));
    if (embeddings.length !== changed.length || embeddings.some(vector => vector.length !== embedder.dimensions)) throw new Error("Embedding batch shape differs from the configured dimensions");
    await vectors(db, org).upsert(changed.map((record: any, index: number) => ({ id: record.id, chunkId: record.unit.id, documentId, projectId: null, scope: "library" as const,
      embedding: embeddings[index], text: record.text, metadata: { sourceType: "labor_unit", unitId: record.unit.id, libraryId: record.unit.libraryId, contentHash: record.hash } })));
    embedded = changed.length;
  }
  return { enabled: true, model: config.model, dimensions: config.dimensions, dryRun: input.dryRun !== false,
    scanned: units.length, unchanged: records.length - changed.length, pending: changed.length, embedded, estimatedTokens,
    tokenEstimateMethod: "UTF-8 bytes / 4; approximate, not provider-billed tokens", nextCursor: units.length ? units[units.length - 1].id : null };
}

/** The same org-scoped pgvector hybrid store used by knowledge search; no indexing during reads. */
export async function searchLaborVectors(db: any, store: PrismaApiStore, query: string, dependencies = { resolveEmbeddingConfig, createEmbedder }) {
  try {
    const config = await dependencies.resolveEmbeddingConfig(store);
    if (!config) return [];
    const documentId = vectorDocument(config), org = store.organizationId;
    const exists: any[] = await db.$queryRawUnsafe(`SELECT id FROM vector_records WHERE organization_id = $1 AND document_id = $2 LIMIT 1`, org, documentId);
    if (!exists.length) return [];
    const embedder = dependencies.createEmbedder({ ...config, signal: AbortSignal.timeout(5000) });
    const queryVector = await cachedQueryEmbedding(JSON.stringify([org, documentId, query.trim()]), () => embedder.embedQuery(query));
    const hits = await vectors(db, org).search({ query, queryVector, documentId, scope: "library", limit: 60, minScore: .2, hybridWeight: .3 });
    return hits.map(hit => ({ id: hit.record.chunkId, score: hit.vectorScore }));
  } catch { return []; } // Lexical search still works when embeddings/storage are unavailable.
}

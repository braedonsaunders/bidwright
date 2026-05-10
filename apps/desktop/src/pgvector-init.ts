/**
 * Best-effort pgvector setup for the desktop's embedded Postgres.
 *
 * embedded-postgres ships vanilla Postgres binaries from the
 * theseus-rs/postgresql-binaries distribution — no pgvector. So we
 * attempt `CREATE EXTENSION vector` on each launch:
 *
 *   • If it succeeds (the binary happens to include pgvector OR the
 *     user dropped the extension into the postgres install themselves),
 *     we run `init-pgvector.sql` to create the `vector_records` table
 *     and the HNSW index that powers hybrid semantic search.
 *
 *   • If it fails (the common case for plain embedded-postgres), we
 *     log once and move on. The api's knowledge-service has a graceful
 *     text-search fallback when `vector_records` is missing, so the
 *     desktop install keeps working — just without the vector half of
 *     hybrid search.
 *
 * Either outcome is non-fatal. We never fail the desktop boot on pgvector
 * because the rest of Bidwright (estimating, agent, document ingestion,
 * snapshot) all work without it.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export interface InitPgvectorOpts {
  /** `postgresql://user:pass@host:port/db` for the embedded cluster. */
  databaseUrl: string;
  /** Path to the bundled init-pgvector.sql (table DDL + indexes). */
  initSqlPath: string;
}

export async function initPgvectorIfAvailable(opts: InitPgvectorOpts): Promise<{
  vectorAvailable: boolean;
}> {
  // Lazy-import `pg` so the module graph doesn't pay for it when the
  // dev path skips this file entirely.
  const { Client } = await import("pg");
  const client = new Client({ connectionString: opts.databaseUrl });
  try {
    await client.connect();
  } catch (err) {
    console.warn(
      `[desktop] pgvector init: couldn't connect to ${opts.databaseUrl}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return { vectorAvailable: false };
  }

  try {
    // Step 1 — try to create the extension. Throws if pgvector isn't
    // available on this postgres install.
    try {
      await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("could not open extension control file") ||
        message.includes("is not available") ||
        message.includes("does not exist")
      ) {
        console.warn(
          `[desktop] pgvector extension not available in this Postgres build — semantic search will fall back to text-only. ` +
            `(detail: ${message.split("\n")[0]})`,
        );
        return { vectorAvailable: false };
      }
      throw err;
    }

    // Step 2 — apply the init-pgvector.sql DDL (table + indexes).
    // Idempotent thanks to IF NOT EXISTS / IF EXISTS guards in the script.
    if (!existsSync(opts.initSqlPath)) {
      console.warn(
        `[desktop] pgvector init: ${opts.initSqlPath} not found in bundle; skipping table DDL`,
      );
      return { vectorAvailable: true };
    }
    const sql = await readFile(opts.initSqlPath, "utf-8");
    await client.query(sql);
    console.log("[desktop] pgvector + vector_records ready (semantic search enabled)");
    return { vectorAvailable: true };
  } catch (err) {
    // Anything else (bad SQL, locked schema, etc.) — log loud but don't
    // fail the boot.
    console.error(
      `[desktop] pgvector init failed; continuing with text-only fallback: ${
        err instanceof Error ? err.message : err
      }`,
    );
    return { vectorAvailable: false };
  } finally {
    await client.end().catch(() => {});
  }
}

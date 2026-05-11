import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveApiPath } from "./paths.js";

/**
 * One-time-per-process startup tasks.
 *
 *   1. ensureIntegrationsEncryptionKey()
 *        Resolves the integrations encryption key in this priority order:
 *          (a) `INTEGRATIONS_ENCRYPTION_KEY` env var,
 *          (b) `${DATA_DIR}/secrets/integrations.key` file,
 *          (c) generates a fresh 32-byte key, writes the file, sets the env.
 *        Result: every install gets a working key on first boot, durable
 *        across restarts via the data volume, with no operator action.
 *
 *   2. applyPendingMigrations()
 *        Runs `prisma migrate deploy` against the configured DATABASE_URL.
 *        Idempotent — only applies migrations not yet recorded in the
 *        `_prisma_migrations` table. Skipped if DATABASE_URL is unset
 *        (early dev / local bring-up). Failures are fatal — refusing to
 *        start with a stale schema is safer than running anyway.
 *
 *   3. ensurePrismaClient()
 *        Generates the Prisma client if it appears not to have been generated
 *        for the current schema. In Docker images we already do this at
 *        build time; the local-dev convenience here is the safety net.
 *
 * All three are wrapped in `runStartupBootstrap()` so the API entrypoint
 * just calls it once.
 */

const SECRETS_DIRNAME = "secrets";
const KEY_FILENAME = "integrations.key";
const KEY_BYTES = 32;

// ── Encryption key ────────────────────────────────────────────────────────

export async function ensureIntegrationsEncryptionKey(): Promise<{
  source: "env" | "file" | "generated";
  filePath?: string;
}> {
  if (process.env.INTEGRATIONS_ENCRYPTION_KEY) {
    return { source: "env" };
  }

  const dir = resolveApiPath(SECRETS_DIRNAME);
  const filePath = path.join(dir, KEY_FILENAME);

  // Try to read existing
  try {
    const existing = (await readFile(filePath, "utf8")).trim();
    if (existing) {
      const buf = Buffer.from(existing, "base64");
      if (buf.length === KEY_BYTES) {
        process.env.INTEGRATIONS_ENCRYPTION_KEY = existing;
        return { source: "file", filePath };
      }
      console.warn(
        `[bootstrap] ${filePath} exists but is malformed (${buf.length} bytes after base64 decode, expected ${KEY_BYTES}). Regenerating.`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Failed to read integrations key file: ${(err as Error).message}`);
    }
  }

  // Generate and persist
  await mkdir(dir, { recursive: true });
  const key = randomBytes(KEY_BYTES).toString("base64");
  await writeFile(filePath, `${key}\n`, "utf8");
  // Best-effort restrict permissions (no-op on Windows).
  try { await chmod(filePath, 0o600); } catch { /* ignore */ }
  process.env.INTEGRATIONS_ENCRYPTION_KEY = key;
  return { source: "generated", filePath };
}

// ── Prisma migrations ─────────────────────────────────────────────────────

function locatePrismaSchema(): string {
  // The Electron desktop bundle and any other host that doesn't preserve
  // the workspace path layout sets BIDWRIGHT_PRISMA_SCHEMA explicitly.
  // Honor that first; fall back to the relative-to-this-file walk that
  // works under tsx (dev + docker, where the source tree is on disk).
  if (process.env.BIDWRIGHT_PRISMA_SCHEMA) return process.env.BIDWRIGHT_PRISMA_SCHEMA;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src/bootstrap.ts → ../../../packages/db/prisma/schema.prisma
  return path.resolve(here, "../../..", "packages/db/prisma/schema.prisma");
}

function locatePrismaCwd(): string {
  // BIDWRIGHT_PRISMA_CWD escape hatch for the desktop bundle (where the
  // @bidwright/db package lives under Resources/app/node_modules/, not at
  // a fixed repo-root-relative path).
  if (process.env.BIDWRIGHT_PRISMA_CWD) return process.env.BIDWRIGHT_PRISMA_CWD;
  // Run from the @bidwright/db package directory so prisma picks up local
  // node_modules and the standard schema location.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..", "packages/db");
}

/**
 * Resolve the bundled prisma CLI's entry script (build/index.js). In the
 * packaged Electron app, end-users don't have prisma / pnpm / npx on PATH,
 * and the historic `npx --yes prisma` fallback fetches the LATEST prisma
 * (currently v7), whose schema validator rejects our v6-style datasource
 * `url = env(...)` block. Invoking the workspace's pinned prisma binary
 * with `process.execPath` keeps the CLI version locked to whatever's in
 * pnpm-lock.yaml.
 *
 * Resolution order:
 *   1. BIDWRIGHT_PRISMA_CLI env var (set by desktop main.ts which has
 *      direct access to @bidwright/db's node_modules layout)
 *   2. Walk node_modules from this file (works in dev / docker)
 *   3. Walk @bidwright/db's node_modules (transitive dep location)
 */
function locateBundledPrismaCli(): string | null {
  if (process.env.BIDWRIGHT_PRISMA_CLI) {
    return process.env.BIDWRIGHT_PRISMA_CLI;
  }
  try {
    const pkgUrl = import.meta.resolve("prisma/package.json");
    const pkgPath = fileURLToPath(pkgUrl);
    return path.resolve(path.dirname(pkgPath), "build", "index.js");
  } catch {
    /* fall through */
  }
  try {
    const dbPkgUrl = import.meta.resolve("@bidwright/db/package.json");
    const dbPkgDir = path.dirname(fileURLToPath(dbPkgUrl));
    const candidate = path.resolve(dbPkgDir, "node_modules", "prisma", "build", "index.js");
    return candidate;
  } catch {
    return null;
  }
}

interface SpawnResult { code: number | null; stdout: string; stderr: string; }

function runCommand(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env, shell: process.platform === "win32" });
    let stdout = ""; let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Runs `prisma <subcommand>` against the schema, walking through the same
 * candidate-CLI list (`prisma`, `pnpm exec prisma`, `npx prisma`) and
 * returning the first successful invocation. Returns `{ ok: false }` and
 * the last failure if every candidate fails.
 */
async function runPrismaCommand(
  subArgs: string[],
): Promise<{ ok: boolean; result?: SpawnResult; lastErr?: SpawnResult }> {
  const cwd = locatePrismaCwd();
  const schema = locatePrismaSchema();
  const env = { ...process.env };

  const bundledCli = locateBundledPrismaCli();
  const candidates: Array<{ cmd: string; args: string[] }> = [
    // Bundled prisma binary — guaranteed-version, no PATH or network deps.
    // Tried first so packaged Electron installs always hit it.
    ...(bundledCli
      ? [{ cmd: process.execPath, args: [bundledCli, ...subArgs, `--schema=${schema}`] }]
      : []),
    { cmd: "prisma", args: [...subArgs, `--schema=${schema}`] },
    { cmd: "pnpm", args: ["--filter", "@bidwright/db", "exec", "prisma", ...subArgs, `--schema=${schema}`] },
    // Last-resort: pin the major version so npx never grabs a newer
    // incompatible release. Pinned to ^6 to track our @prisma/client.
    { cmd: "npx", args: ["--yes", "prisma@^6", ...subArgs, `--schema=${schema}`] },
  ];

  let lastErr: SpawnResult | undefined;
  for (const candidate of candidates) {
    try {
      const result = await runCommand(candidate.cmd, candidate.args, cwd, env);
      if (result.code === 0) return { ok: true, result };
      lastErr = result;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }
  return { ok: false, lastErr };
}

/**
 * Mark a single migration as applied in `_prisma_migrations`. Used to
 * recover from P3009 (failed migration left half-applied) when the DB
 * schema is already in sync via some other path (e.g. `db push`).
 */
async function resolveMigrationApplied(migrationName: string): Promise<boolean> {
  const { ok } = await runPrismaCommand(["migrate", "resolve", "--applied", migrationName]);
  return ok;
}

export async function applyPendingMigrations(): Promise<{ applied: boolean; reason?: string }> {
  if (!process.env.DATABASE_URL) {
    return { applied: false, reason: "DATABASE_URL not set" };
  }

  // Escape hatch: skip bootstrap migrations entirely. Useful in
  // docker-compose deploys where a separate db-migrate container has
  // already synced the schema (e.g. via `prisma db push`) and running
  // `prisma migrate deploy` would just re-discover history-table
  // mismatches the operator already worked around.
  if (process.env.BIDWRIGHT_SKIP_BOOTSTRAP_MIGRATIONS === "1") {
    return { applied: false, reason: "BIDWRIGHT_SKIP_BOOTSTRAP_MIGRATIONS=1" };
  }

  const first = await runPrismaCommand(["migrate", "deploy"]);
  if (first.ok) {
    const out = first.result?.stdout.trim() ?? "";
    if (out) console.log(`[bootstrap] prisma migrate deploy:\n${out}`);
    // Desktop-mode safety net: run db push to guarantee schema sync.
    // Migrate deploy can report "no pending migrations" against a DB
    // whose history table says baseline is applied but whose actual
    // schema is partial (rc14 bug — marked the baseline applied without
    // ever running it). db push is idempotent: no-op on a clean DB,
    // heals partial-schema DBs by creating the missing tables.
    if (process.env.BIDWRIGHT_MODE === "desktop") {
      await reconcileDesktopSchema();
    }
    return { applied: true };
  }

  // v0.1.0 baseline migration collapses pre-launch migration history. Any
  // user who installed an earlier rc has stale `_prisma_migrations` rows
  // pointing at migrations that no longer exist in our folder, and likely
  // some of those rows are in failed state. We can't iterate-and-resolve
  // through a folder that doesn't have those migration names anymore.
  //
  // Resolution: drop `_prisma_migrations` outright, then mark our single
  // baseline migration as applied (idempotent — schema is already in sync
  // from the prior install). New installs never hit this path because
  // their first migrate-deploy succeeds.
  const out = `${first.lastErr?.stdout ?? ""}\n${first.lastErr?.stderr ?? ""}`;
  const isRecoverable =
    out.includes("P3009") || // failed migration row
    out.includes("P3005") || // schema not empty, migrate not initialized
    out.includes("P3018") || // migration failed to apply cleanly
    out.includes("non-empty database");
  if (!isRecoverable) {
    const detail = `\n${first.lastErr?.stdout.trim() ?? ""}\n${first.lastErr?.stderr.trim() ?? ""}`;
    throw new Error(`prisma migrate deploy failed.${detail}`);
  }

  console.warn(
    `[bootstrap] Dirty migration history detected. Dropping _prisma_migrations and ` +
      `reconciling schema via prisma db push.`,
  );
  await dropPrismaMigrationsTable();

  // `prisma db push` reconciles the live schema with schema.prisma without
  // touching migration history. Idempotent: creates missing tables, alters
  // mismatched columns, drops removed columns/tables (with
  // --accept-data-loss). Critical for users upgrading from an rc that had
  // a partial schema — just marking the baseline migration applied would
  // leave Prisma believing things are in sync when half the tables are
  // missing.
  const push = await runPrismaCommand(["db", "push", "--accept-data-loss", "--skip-generate"]);
  if (!push.ok) {
    const detail = `\n${push.lastErr?.stdout.trim() ?? ""}\n${push.lastErr?.stderr.trim() ?? ""}`;
    throw new Error(`prisma db push failed during rebaseline.${detail}`);
  }
  const pushOut = push.result?.stdout.trim() ?? "";
  if (pushOut) console.log(`[bootstrap] prisma db push:\n${pushOut}`);

  // Mark the baseline as applied so future `migrate deploy` invocations
  // (in case the user later moves to a server install) see clean state.
  const migrationsDir = path.resolve(path.dirname(locatePrismaSchema()), "migrations");
  const baseline = (await listMigrationDirs(migrationsDir))[0];
  if (baseline) {
    const resolved = await resolveMigrationApplied(baseline);
    if (!resolved) {
      console.warn(
        `[bootstrap] Schema reconciled via db push, but failed to mark "${baseline}" ` +
          `as applied. Future migrate deploy may need manual intervention.`,
      );
    }
  }

  console.log(`[bootstrap] schema reconciled via db push after dirty-history recovery.`);
  return { applied: true };
}

/**
 * List all migration directory names under `migrationsDir`, sorted
 * chronologically (Prisma names them with a leading timestamp). Returns
 * empty if the directory doesn't exist or contains no migration subdirs.
 */
async function listMigrationDirs(migrationsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Desktop-only safety net: run `prisma db push` after a successful
 * migrate-deploy to guarantee the live schema matches schema.prisma.
 *
 * Why this is needed: rc14 had a recovery bug that dropped
 * `_prisma_migrations` and marked the baseline migration applied
 * WITHOUT ever running it, leaving DBs with a partial schema and a
 * "clean" migration history. Subsequent launches see migrate-deploy
 * say "no pending migrations" and proceed, then crash on the first
 * query against a missing table.
 *
 * db push is idempotent — diffs the live schema against schema.prisma
 * and applies only what's needed. No-op on a clean DB.
 */
async function reconcileDesktopSchema(): Promise<void> {
  const push = await runPrismaCommand([
    "db", "push", "--accept-data-loss", "--skip-generate",
  ]);
  if (!push.ok) {
    const detail = `\n${push.lastErr?.stdout.trim() ?? ""}\n${push.lastErr?.stderr.trim() ?? ""}`;
    throw new Error(`prisma db push (desktop safety net) failed.${detail}`);
  }
  const out = push.result?.stdout.trim() ?? "";
  if (out && !/already in sync/i.test(out)) {
    console.log(`[bootstrap] prisma db push (desktop safety net):\n${out}`);
  }
}

/**
 * Drop the `_prisma_migrations` table directly via pg. Used to clear a
 * dirty migration history when the schema is otherwise in sync — safer
 * than `prisma migrate reset` which wipes user data.
 */
async function dropPrismaMigrationsTable(): Promise<void> {
  // @ts-expect-error - pg has no types installed at the api package level
  const pgMod = await import("pg");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Client = ((pgMod as any).default ?? pgMod).Client;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await client.query(`DROP TABLE IF EXISTS "_prisma_migrations"`);
  } finally {
    try { await client.end(); } catch { /* ignore */ }
  }
}

// ── Optional: ensure prisma client is generated ───────────────────────────

export async function ensurePrismaClientGenerated(): Promise<{ generated: boolean }> {
  // The Prisma client throws a recognizable error on first import if it has
  // not been generated. We probe by trying to import the @bidwright/db
  // module — if it loads cleanly and `prisma` is a real PrismaClient, we're
  // good. Otherwise we run `prisma generate`.
  try {
    const mod = await import("@bidwright/db");
    // If this doesn't throw, the client exists.
    if (mod && typeof mod.prisma === "object") return { generated: false };
  } catch (err) {
    if (!/did not initialize|@prisma\/client did not initialize|Cannot find module/.test((err as Error).message)) {
      throw err;
    }
  }

  const cwd = locatePrismaCwd();
  const schema = locatePrismaSchema();
  const env = { ...process.env };
  const bundledCli = locateBundledPrismaCli();
  const candidates: Array<{ cmd: string; args: string[] }> = [
    ...(bundledCli
      ? [{ cmd: process.execPath, args: [bundledCli, "generate", `--schema=${schema}`] }]
      : []),
    { cmd: "prisma", args: ["generate", `--schema=${schema}`] },
    { cmd: "pnpm", args: ["--filter", "@bidwright/db", "exec", "prisma", "generate", `--schema=${schema}`] },
    { cmd: "npx", args: ["--yes", "prisma@^6", "generate", `--schema=${schema}`] },
  ];
  for (const c of candidates) {
    try {
      const r = await runCommand(c.cmd, c.args, cwd, env);
      if (r.code === 0) return { generated: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return { generated: false };
}

// ── Top-level bootstrap ───────────────────────────────────────────────────

export async function runStartupBootstrap(): Promise<void> {
  // Migrations first — schema is a hard dependency for everything else.
  // Failure is fatal; the caller should surface and exit.
  if (process.env.DATABASE_URL) {
    const m = await applyPendingMigrations();
    if (m.applied) console.log("[bootstrap] Database schema is up to date.");
  } else {
    console.warn("[bootstrap] DATABASE_URL is not set — skipping migration deploy.");
  }

  // Encryption key — must be set before the integrations runtime touches
  // any credential. Always succeeds (env / file / generate).
  const key = await ensureIntegrationsEncryptionKey();
  if (key.source === "generated") {
    console.log(`[bootstrap] Generated new integrations encryption key at ${key.filePath}.`);
    console.log("[bootstrap]   This file is the only copy. Back it up with the rest of your data volume.");
  } else if (key.source === "file") {
    console.log(`[bootstrap] Loaded integrations encryption key from ${key.filePath}.`);
  }
  // (env-supplied keys are silent — operators set them deliberately.)
}

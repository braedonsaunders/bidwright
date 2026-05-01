import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
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
  // packages/db/prisma/schema.prisma — resolved relative to this file's location
  // at runtime, both in dev (tsx) and in Docker (where the source tree is copied
  // verbatim into /app).
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src/bootstrap.ts → ../../../packages/db/prisma/schema.prisma
  return path.resolve(here, "../../..", "packages/db/prisma/schema.prisma");
}

function locatePrismaCwd(): string {
  // Run from the @bidwright/db package directory so prisma picks up local
  // node_modules and the standard schema location.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..", "packages/db");
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

export async function applyPendingMigrations(): Promise<{ applied: boolean; reason?: string }> {
  if (!process.env.DATABASE_URL) {
    return { applied: false, reason: "DATABASE_URL not set" };
  }

  const cwd = locatePrismaCwd();
  const schema = locatePrismaSchema();
  const env = { ...process.env };

  // Try the local prisma CLI first (fastest, deterministic). Fall back to
  // `pnpm --filter @bidwright/db exec prisma` and finally `npx prisma`.
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: "prisma", args: ["migrate", "deploy", `--schema=${schema}`] },
    { cmd: "pnpm", args: ["--filter", "@bidwright/db", "exec", "prisma", "migrate", "deploy", `--schema=${schema}`] },
    { cmd: "npx", args: ["--yes", "prisma", "migrate", "deploy", `--schema=${schema}`] },
  ];

  let lastErr: SpawnResult | undefined;
  for (const candidate of candidates) {
    try {
      const result = await runCommand(candidate.cmd, candidate.args, cwd, env);
      if (result.code === 0) {
        // Trim and forward prisma's own line-by-line output for visibility.
        const out = result.stdout.trim();
        if (out) console.log(`[bootstrap] prisma migrate deploy:\n${out}`);
        return { applied: true };
      }
      lastErr = result;
    } catch (err) {
      // ENOENT for the binary — try the next candidate.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
  }

  const detail = lastErr
    ? `\n${lastErr.stdout.trim()}\n${lastErr.stderr.trim()}`
    : "";
  throw new Error(`prisma migrate deploy failed across all candidates.${detail}`);
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
  const candidates: Array<{ cmd: string; args: string[] }> = [
    { cmd: "prisma", args: ["generate", `--schema=${schema}`] },
    { cmd: "pnpm", args: ["--filter", "@bidwright/db", "exec", "prisma", "generate", `--schema=${schema}`] },
    { cmd: "npx", args: ["--yes", "prisma", "generate", `--schema=${schema}`] },
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

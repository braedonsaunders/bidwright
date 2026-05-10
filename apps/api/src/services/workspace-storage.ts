/**
 * Project workspace snapshot/restore against S3-compatible storage.
 *
 * Why this exists: in a multi-host hosted deployment a user's project
 * workspace ( /data/bidwright-api/projects/<projectId> ) needs to follow
 * them across hosts so we can scale the api pool statelessly. Without
 * snapshots, every prompt is pinned to whichever host last touched the
 * project — fine for self-host on one VM, but a hard ceiling on the
 * hosted SaaS tier.
 *
 * Backends supported via the S3 API:
 *   • Cloudflare R2 (hosted SaaS)         — endpoint = `<acct>.r2.cloudflarestorage.com`
 *   • MinIO / SeaweedFS / Garage         — self-host LAN buckets
 *   • AWS S3                              — fallback when no endpoint set
 *
 * The single S3 client driver covers all three; only the config differs.
 *
 * Snapshot format: streamed gzipped tar of the project workspace dir.
 * No diff tracking yet — we upload a full snapshot on every session
 * exit. The simplification is fine while sessions are minutes long and
 * workspaces are tens of MB; if either of those drift, swap the
 * implementation here without changing the call sites.
 *
 * The service is a no-op (NoopWorkspaceStorage) when not configured —
 * desktop and single-tenant Docker self-host don't need workspace
 * sharding.
 */

import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { create as tarCreate, extract as tarExtract } from "tar";

export interface WorkspaceStorage {
  /** Identifier used in startup logs / health output. */
  readonly id: string;
  /** True when a real backend is wired up. The factory returns a noop
   *  impl when env config is missing; call sites can short-circuit on
   *  `!ready()` to avoid extra disk I/O. */
  ready(): boolean;
  /**
   * Upload a directory as `<key>.tar.gz` to the configured bucket.
   * Existing objects with the same key are overwritten. Idempotent;
   * errors should be caught at the call site (snapshot failures must
   * never fail a user's session).
   */
  snapshot(opts: { key: string; sourceDir: string }): Promise<void>;
  /**
   * Download `<key>.tar.gz` and extract it into `targetDir`. If the
   * remote object doesn't exist, returns `false` and leaves the dir
   * untouched. If extract fails partway the function tries to clean up
   * any half-extracted state before returning.
   */
  restore(opts: { key: string; targetDir: string }): Promise<boolean>;
  /** Delete a snapshot. Non-fatal if the object isn't there. */
  delete(opts: { key: string }): Promise<void>;
}

class NoopWorkspaceStorage implements WorkspaceStorage {
  readonly id = "noop";
  ready() {
    return false;
  }
  async snapshot() {
    /* nothing to do — see ready() */
  }
  async restore() {
    return false;
  }
  async delete() {
    /* nothing to do */
  }
}

interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  prefix: string;
  forcePathStyle: boolean;
  /** Display label for logs ("R2 / MinIO / AWS"). */
  flavor: string;
}

/**
 * S3-compatible implementation. Keeps a singleton {@link S3Client} —
 * AWS SDK v3 is heavyweight (~10 MB) so we lazy-load on first call to
 * keep cold-start tight on noop deploys. The client itself is thread-
 * safe and can be reused across snapshot/restore calls.
 */
class S3WorkspaceStorage implements WorkspaceStorage {
  readonly id: string;
  private clientPromise: Promise<{
    client: import("@aws-sdk/client-s3").S3Client;
    sdk: typeof import("@aws-sdk/client-s3");
  }> | null = null;

  constructor(private readonly config: S3Config) {
    this.id = `s3:${config.flavor}:${config.bucket}`;
  }

  ready() {
    return true;
  }

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const sdk = await import("@aws-sdk/client-s3");
        const client = new sdk.S3Client({
          region: this.config.region,
          endpoint: this.config.endpoint,
          forcePathStyle: this.config.forcePathStyle,
          credentials:
            this.config.accessKeyId && this.config.secretAccessKey
              ? {
                  accessKeyId: this.config.accessKeyId,
                  secretAccessKey: this.config.secretAccessKey,
                }
              : undefined,
        });
        return { client, sdk };
      })();
    }
    return this.clientPromise;
  }

  private objectKey(key: string): string {
    const safe = key.replace(/^\/+|\/+$/g, "");
    const prefix = this.config.prefix.replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${safe}.tar.gz` : `${safe}.tar.gz`;
  }

  async snapshot(opts: { key: string; sourceDir: string }): Promise<void> {
    if (!existsSync(opts.sourceDir)) {
      // Nothing to snapshot — caller may have torn down already.
      return;
    }
    const entries = await readdir(opts.sourceDir).catch(() => []);
    if (entries.length === 0) return;

    const { client } = await this.getClient();
    const { Upload } = await import("@aws-sdk/lib-storage");

    // Stream tar.gz directly into S3 via the SDK's multipart Upload
    // helper. PutObject doesn't work with a streaming body because the
    // SDK tries to compute a content hash up front; lib-storage handles
    // streaming uploads natively (chunks into 5 MB parts under the
    // hood). Avoids temp-file disk pressure on busy hosts.
    //
    // We pipe through a PassThrough because tar's internal `Pack` stream
    // implements only a subset of the Node.js Readable surface, which
    // the AWS SDK rejects with "Body Data is unsupported format". The
    // PassThrough is a real Readable and proxies the bytes one-to-one.
    const passthrough = new PassThrough();
    const tarStream = tarCreate(
      {
        gzip: { level: 6 },
        cwd: opts.sourceDir,
        // Skip transient files the agent runtime treats as scratch.
        // Including these would inflate snapshots without changing the
        // resumable state.
        filter: (path) => {
          if (path.startsWith("./.bidwright-prompt.txt")) return false;
          if (path.startsWith("./.bidwright-run.bat")) return false;
          if (path.startsWith("./.bidwright-resume.bat")) return false;
          if (path.startsWith("./.bidwright-mcp-config.json")) return false;
          return true;
        },
      },
      // Empty list = pack everything in cwd.
      ["."],
    );
    (tarStream as unknown as NodeJS.ReadableStream).pipe(passthrough);

    const upload = new Upload({
      client,
      params: {
        Bucket: this.config.bucket,
        Key: this.objectKey(opts.key),
        Body: passthrough,
        ContentType: "application/gzip",
      },
    });
    await upload.done();
  }

  async restore(opts: { key: string; targetDir: string }): Promise<boolean> {
    const { client, sdk } = await this.getClient();
    let response: import("@aws-sdk/client-s3").GetObjectCommandOutput;
    try {
      response = await client.send(
        new sdk.GetObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey(opts.key),
        }),
      );
    } catch (err) {
      if (
        err instanceof Error &&
        (err.name === "NoSuchKey" ||
          err.name === "NotFound" ||
          (err as { Code?: string }).Code === "NoSuchKey")
      ) {
        return false;
      }
      throw err;
    }
    const body = response.Body;
    if (!body) return false;

    await mkdir(opts.targetDir, { recursive: true });

    // The aws-sdk Body is a web ReadableStream in browsers / a Node
    // Readable in node — pipe it into tar.extract through the standard
    // Node stream pipeline so back-pressure is honored.
    const nodeStream =
      body instanceof Readable ? body : Readable.fromWeb(body as never);
    try {
      await pipeline(
        nodeStream,
        tarExtract({
          cwd: opts.targetDir,
          // Extract preserves mtimes which matters for the agent's
          // session.json freshness checks; the absent flag would force
          // every restore to look like a "just touched" workspace.
        }),
      );
    } catch (err) {
      // Half-extracted state — clean up best effort and surface the
      // failure so the caller can decide whether to fall through to a
      // fresh workspace or fail the spawn.
      await rm(opts.targetDir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
    return true;
  }

  async delete(opts: { key: string }): Promise<void> {
    const { client, sdk } = await this.getClient();
    await client
      .send(
        new sdk.DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: this.objectKey(opts.key),
        }),
      )
      .catch((err) => {
        if (
          err instanceof Error &&
          (err.name === "NoSuchKey" ||
            err.name === "NotFound" ||
            (err as { Code?: string }).Code === "NoSuchKey")
        ) {
          return;
        }
        throw err;
      });
  }
}

let cached: WorkspaceStorage | null = null;

/**
 * Pick a workspace storage backend from env. Order:
 *
 *   1. WORKSPACE_STORAGE_PROVIDER=s3 → S3WorkspaceStorage with the
 *      remaining WORKSPACE_S3_* env vars.
 *   2. Anything else (or unset) → NoopWorkspaceStorage.
 *
 * The endpoint hint in the log line distinguishes R2 / MinIO / AWS so
 * operators can sanity-check what their compose env actually selected:
 *
 *   • R2:    endpoint contains "r2.cloudflarestorage.com"
 *   • MinIO: endpoint set, not R2 (force path style is also typical)
 *   • AWS:   endpoint unset (SDK default)
 */
export function getWorkspaceStorage(): WorkspaceStorage {
  if (cached) return cached;

  const provider = (process.env.WORKSPACE_STORAGE_PROVIDER || "").trim().toLowerCase();
  if (provider !== "s3") {
    cached = new NoopWorkspaceStorage();
    console.log(
      "[workspace-storage] disabled (WORKSPACE_STORAGE_PROVIDER not set to 's3') — workspaces stay on local disk",
    );
    return cached;
  }

  const bucket = (process.env.WORKSPACE_S3_BUCKET || "").trim();
  if (!bucket) {
    console.warn(
      "[workspace-storage] WORKSPACE_STORAGE_PROVIDER=s3 but WORKSPACE_S3_BUCKET is unset; falling back to noop",
    );
    cached = new NoopWorkspaceStorage();
    return cached;
  }

  const endpoint = (process.env.WORKSPACE_S3_ENDPOINT || "").trim() || undefined;
  // Cloudflare R2 always uses region "auto"; AWS S3 needs a real region.
  // Default to "auto" so an R2 user can omit the var; AWS users set
  // WORKSPACE_S3_REGION explicitly.
  const region = (process.env.WORKSPACE_S3_REGION || "auto").trim();
  const accessKeyId = (process.env.WORKSPACE_S3_ACCESS_KEY_ID || "").trim() || undefined;
  const secretAccessKey = (process.env.WORKSPACE_S3_SECRET_ACCESS_KEY || "").trim() || undefined;
  const prefix = (process.env.WORKSPACE_S3_PREFIX || "bidwright/workspaces").trim();
  const forcePathStyle =
    (process.env.WORKSPACE_S3_FORCE_PATH_STYLE || "").trim().toLowerCase() === "true";

  const flavor = endpoint
    ? endpoint.includes("r2.cloudflarestorage.com")
      ? "r2"
      : "s3-compatible"
    : "aws";

  cached = new S3WorkspaceStorage({
    bucket,
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    prefix,
    forcePathStyle,
    flavor,
  });
  console.log(
    `[workspace-storage] enabled flavor=${flavor} bucket=${bucket} region=${region}` +
      `${endpoint ? ` endpoint=${endpoint}` : ""}` +
      ` prefix=${prefix} forcePathStyle=${forcePathStyle}`,
  );
  return cached;
}

/**
 * Reset the cached storage instance — test seam, do not call from
 * production code.
 */
export function __resetWorkspaceStorageForTests(): void {
  cached = null;
}

/**
 * Compose a stable storage key from org + project ids. Hosted-side keys
 * are scoped by org so two orgs with colliding project cuids stay
 * separate. The `key` we get back goes verbatim into the S3 object key
 * (with `.tar.gz` appended by the storage impl).
 */
export function workspaceStorageKey(opts: {
  organizationId: string | null | undefined;
  projectId: string;
}): string {
  const org = (opts.organizationId || "_").replace(/[^a-zA-Z0-9_-]/g, "_");
  const project = opts.projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `org/${org}/projects/${project}`;
}

/**
 * Snapshot a workspace dir, swallowing any error. Snapshot failures
 * must never break a user's session — at worst they re-prompt and the
 * next snapshot succeeds. We log loudly so it surfaces in dashboards.
 */
export async function snapshotWorkspaceSafe(opts: {
  storage: WorkspaceStorage;
  key: string;
  sourceDir: string;
}): Promise<void> {
  if (!opts.storage.ready()) return;
  try {
    await opts.storage.snapshot({ key: opts.key, sourceDir: opts.sourceDir });
    console.log(`[workspace-storage] snapshot ok: key=${opts.key}`);
  } catch (err) {
    console.error(
      `[workspace-storage] snapshot failed: key=${opts.key}`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Restore a workspace dir, returning whether anything was actually
 * restored. Errors are surfaced so the caller can choose to fall through
 * to a fresh workspace vs failing the spawn — they're closer to the
 * user-facing decision than this helper is.
 */
export async function restoreWorkspaceIfPresent(opts: {
  storage: WorkspaceStorage;
  key: string;
  targetDir: string;
}): Promise<boolean> {
  if (!opts.storage.ready()) return false;
  // Make sure the parent dir exists; the storage impl creates targetDir
  // itself but a missing parent will surface as a confusing ENOENT.
  await mkdir(dirname(opts.targetDir), { recursive: true }).catch(() => {});
  return opts.storage.restore({ key: opts.key, targetDir: opts.targetDir });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Readable } from "node:stream";
import { relativeProjectFilePath, resolveApiPath } from "../paths.js";

// ── Chunked, resumable large-file upload ─────────────────────────────────
//
// Large LiDAR scans (up to ~1 GB) can't reliably ship as a single multipart
// POST on flaky jobsite connections, and the server bodyLimit is 64 MB.
// These routes accept the file in 16 MB application/octet-stream chunks
// appended to a temp file under DATA_DIR/tmp-uploads/<uploadId>/, then on
// completion create the FileNode exactly like POST /projects/:id/files/upload.
//
//   POST   /api/projects/:projectId/uploads                → init
//   PATCH  /api/projects/:projectId/uploads/:uploadId      → append chunk
//   GET    /api/projects/:projectId/uploads/:uploadId      → resume status
//   POST   /api/projects/:projectId/uploads/:uploadId/complete → finalize

export const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB — stays under the 64 MB bodyLimit
const TMP_UPLOADS_DIR = "tmp-uploads";
const STALE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
// Generous ceiling so a bogus totalSize can't reserve unbounded disk.
const MAX_TOTAL_SIZE = 8 * 1024 * 1024 * 1024; // 8 GB

// uploadId is used as a path segment — accept only our own randomUUID() output.
const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isValidUploadId(uploadId: string): boolean {
  return UPLOAD_ID_RE.test(uploadId);
}

// Pure decision logic for a chunk append — unit-testable without a server.
export type ChunkAppendPlan =
  | { ok: true }
  | { ok: false; status: 400 | 409 | 413; message: string };

export function planChunkAppend(input: {
  offset: number;
  receivedBytes: number;
  totalSize: number;
  contentLength?: number | null;
}): ChunkAppendPlan {
  const { offset, receivedBytes, totalSize, contentLength } = input;
  if (!Number.isInteger(offset) || offset < 0) {
    return { ok: false, status: 400, message: "x-upload-offset must be a non-negative integer" };
  }
  if (offset !== receivedBytes) {
    return { ok: false, status: 409, message: "Offset does not match received bytes" };
  }
  if (receivedBytes >= totalSize) {
    return { ok: false, status: 409, message: "Upload already has all declared bytes" };
  }
  if (
    typeof contentLength === "number" &&
    Number.isFinite(contentLength) &&
    receivedBytes + contentLength > totalSize
  ) {
    return { ok: false, status: 413, message: "Chunk would exceed the declared totalSize" };
  }
  return { ok: true };
}

interface UploadMeta {
  projectId: string;
  fileName: string;
  totalSize: number;
  parentId: string | null;
  createdAt: string;
  createdBy: string | null;
}

function uploadDir(uploadId: string) {
  return resolveApiPath(TMP_UPLOADS_DIR, uploadId);
}

function uploadPartPath(uploadId: string) {
  return path.join(uploadDir(uploadId), "data.part");
}

function uploadMetaPath(uploadId: string) {
  return path.join(uploadDir(uploadId), "meta.json");
}

async function readUploadMeta(uploadId: string): Promise<UploadMeta | null> {
  try {
    const raw = await readFile(uploadMetaPath(uploadId), "utf8");
    const parsed = JSON.parse(raw) as Partial<UploadMeta>;
    if (
      typeof parsed.projectId !== "string" ||
      typeof parsed.fileName !== "string" ||
      typeof parsed.totalSize !== "number"
    ) {
      return null;
    }
    return {
      projectId: parsed.projectId,
      fileName: parsed.fileName,
      totalSize: parsed.totalSize,
      parentId: typeof parsed.parentId === "string" ? parsed.parentId : null,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
      createdBy: typeof parsed.createdBy === "string" ? parsed.createdBy : null,
    };
  } catch {
    return null;
  }
}

async function receivedBytesFor(uploadId: string): Promise<number> {
  try {
    return (await stat(uploadPartPath(uploadId))).size;
  } catch {
    return 0;
  }
}

// Opportunistic GC — sweep abandoned temp uploads older than 24h. Errors are
// swallowed: GC must never fail an init request.
async function sweepStaleUploads() {
  const root = resolveApiPath(TMP_UPLOADS_DIR);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return; // directory doesn't exist yet
  }
  const cutoff = Date.now() - STALE_UPLOAD_MAX_AGE_MS;
  for (const entry of entries) {
    if (!isValidUploadId(entry)) continue;
    const dir = path.join(root, entry);
    try {
      const info = await stat(dir);
      const partInfo = await stat(path.join(dir, "data.part")).catch(() => null);
      const newest = Math.max(info.mtimeMs, partInfo?.mtimeMs ?? 0);
      if (newest < cutoff) {
        await rm(dir, { recursive: true, force: true });
      }
    } catch {
      // ignore — another request may have completed/removed it concurrently
    }
  }
}

export async function chunkedUploadRoutes(app: FastifyInstance) {
  // Raw octet-stream chunks: hand the request stream to the route untouched.
  // Registered inside this plugin so the parser stays scoped to these routes.
  app.addContentTypeParser("application/octet-stream", (_req, payload, done) => {
    done(null, payload);
  });

  // Serialize appends per upload — a second concurrent PATCH for the same
  // uploadId would interleave writes into data.part.
  const activeAppends = new Set<string>();

  // ── POST /api/projects/:projectId/uploads — init ──────────────────────
  app.post("/api/projects/:projectId/uploads", async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const project = await request.store!.getProject(projectId);
    if (!project) return reply.code(404).send({ message: "Project not found" });

    const body = (request.body ?? {}) as {
      fileName?: unknown;
      totalSize?: unknown;
      parentId?: unknown;
    };
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const totalSize = typeof body.totalSize === "number" ? body.totalSize : NaN;
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;

    if (!fileName) {
      return reply.code(400).send({ message: "fileName is required" });
    }
    if (!Number.isInteger(totalSize) || totalSize <= 0) {
      return reply.code(400).send({ message: "totalSize must be a positive integer" });
    }
    if (totalSize > MAX_TOTAL_SIZE) {
      return reply.code(413).send({ message: `totalSize exceeds the ${MAX_TOTAL_SIZE} byte limit` });
    }

    // Fire-and-forget sweep of abandoned uploads.
    void sweepStaleUploads().catch(() => {});

    const uploadId = randomUUID();
    const dir = uploadDir(uploadId);
    await mkdir(dir, { recursive: true });
    await writeFile(uploadPartPath(uploadId), Buffer.alloc(0));
    const meta: UploadMeta = {
      projectId,
      fileName,
      totalSize,
      parentId,
      createdAt: new Date().toISOString(),
      createdBy: request.user?.id ?? null,
    };
    await writeFile(uploadMetaPath(uploadId), JSON.stringify(meta, null, 2));

    reply.code(201);
    return { uploadId, chunkSize: CHUNK_SIZE, receivedBytes: 0 };
  });

  // Shared lookup: validates uploadId + meta + project scoping. Returns null
  // after sending the error reply.
  async function resolveUpload(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ uploadId: string; meta: UploadMeta } | null> {
    const { projectId, uploadId } = request.params as { projectId: string; uploadId: string };
    if (!isValidUploadId(uploadId)) {
      await reply.code(400).send({ message: "Invalid uploadId" });
      return null;
    }
    // Org-scoped store lookup keeps other tenants from touching the upload.
    const project = await request.store!.getProject(projectId);
    if (!project) {
      await reply.code(404).send({ message: "Project not found" });
      return null;
    }
    const meta = await readUploadMeta(uploadId);
    if (!meta || meta.projectId !== projectId) {
      await reply.code(404).send({ message: "Upload not found" });
      return null;
    }
    return { uploadId, meta };
  }

  // ── PATCH /api/projects/:projectId/uploads/:uploadId — append chunk ───
  app.patch("/api/projects/:projectId/uploads/:uploadId", async (request, reply) => {
    const resolved = await resolveUpload(request, reply);
    if (!resolved) return;
    const { uploadId, meta } = resolved;

    const contentType = String(request.headers["content-type"] ?? "");
    if (!contentType.startsWith("application/octet-stream")) {
      return reply.code(415).send({ message: "Chunks must be application/octet-stream" });
    }

    if (activeAppends.has(uploadId)) {
      return reply
        .code(409)
        .send({ message: "Another chunk is being written", receivedBytes: await receivedBytesFor(uploadId) });
    }
    activeAppends.add(uploadId);
    try {
      const receivedBytes = await receivedBytesFor(uploadId);
      const offsetHeader = request.headers["x-upload-offset"];
      const offset = Number.parseInt(Array.isArray(offsetHeader) ? offsetHeader[0] : offsetHeader ?? "", 10);
      const contentLengthHeader = request.headers["content-length"];
      const contentLength = contentLengthHeader ? Number.parseInt(String(contentLengthHeader), 10) : null;

      const plan = planChunkAppend({
        offset: Number.isNaN(offset) ? -1 : offset,
        receivedBytes,
        totalSize: meta.totalSize,
        contentLength,
      });
      if (!plan.ok) {
        return reply.code(plan.status).send({ message: plan.message, receivedBytes });
      }

      const remaining = meta.totalSize - receivedBytes;
      let written = 0;
      let overflow = false;
      const limiter = new Transform({
        transform(chunk: Buffer, _enc, done) {
          written += chunk.length;
          if (written > remaining) {
            overflow = true;
            done(new Error("Chunk exceeds declared totalSize"));
            return;
          }
          done(null, chunk);
        },
      });

      const partPath = uploadPartPath(uploadId);
      try {
        await pipeline(request.body as Readable, limiter, createWriteStream(partPath, { flags: "a" }));
      } catch (err) {
        // Roll the part file back to the last verified offset so the client
        // can resume cleanly from `receivedBytes`.
        await truncate(partPath, receivedBytes).catch(() => {});
        if (overflow) {
          return reply.code(413).send({
            message: "Chunk exceeds the declared totalSize",
            receivedBytes,
          });
        }
        throw err;
      }

      return { receivedBytes: receivedBytes + written };
    } finally {
      activeAppends.delete(uploadId);
    }
  });

  // ── GET /api/projects/:projectId/uploads/:uploadId — resume status ────
  app.get("/api/projects/:projectId/uploads/:uploadId", async (request, reply) => {
    const resolved = await resolveUpload(request, reply);
    if (!resolved) return;
    const { uploadId, meta } = resolved;
    return {
      receivedBytes: await receivedBytesFor(uploadId),
      totalSize: meta.totalSize,
      fileName: meta.fileName,
    };
  });

  // ── POST /api/projects/:projectId/uploads/:uploadId/complete ──────────
  app.post("/api/projects/:projectId/uploads/:uploadId/complete", async (request, reply) => {
    const resolved = await resolveUpload(request, reply);
    if (!resolved) return;
    const { uploadId, meta } = resolved;

    const receivedBytes = await receivedBytesFor(uploadId);
    if (receivedBytes !== meta.totalSize) {
      return reply.code(409).send({
        message: `Upload is incomplete (${receivedBytes} of ${meta.totalSize} bytes)`,
        receivedBytes,
      });
    }

    const fileExt = path.extname(meta.fileName).replace(/^\./, "").toLowerCase();

    // Create the FileNode first to get an ID for the storage path — mirrors
    // POST /projects/:projectId/files/upload.
    const node = await request.store!.createFileNode(meta.projectId, {
      parentId: meta.parentId,
      name: meta.fileName,
      type: "file",
      fileType: fileExt || undefined,
      size: receivedBytes,
      metadata: {},
    });

    const relPath = relativeProjectFilePath(meta.projectId, node.id, meta.fileName);
    const absPath = resolveApiPath(relPath);
    await mkdir(path.dirname(absPath), { recursive: true });

    const partPath = uploadPartPath(uploadId);
    try {
      // Same volume in the common case — atomic and instant.
      await rename(partPath, absPath);
    } catch {
      await copyFile(partPath, absPath);
    }
    await rm(uploadDir(uploadId), { recursive: true, force: true });

    const updated = await request.store!.updateFileNode(node.id, { storagePath: relPath });

    reply.code(201);
    return updated;
  });
}

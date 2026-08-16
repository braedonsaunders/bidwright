import { resolveApiUrl } from "./api/client";
import type { FileNode } from "./api";

// ── Chunked, resumable large-file upload client ──────────────────────────
//
// Companion to the API's /api/projects/:projectId/uploads routes. Splits a
// File into sequential chunks, appends each with an x-upload-offset header,
// and resumes from the server's byte count after a network drop or 409.
// Designed for large LiDAR scans on flaky jobsite connections.

const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024; // matches the server's advertised chunkSize
const MAX_CHUNK_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 300;
const RETRY_MAX_DELAY_MS = 5000;

export interface ChunkedUploadOptions {
  parentId?: string;
  chunkSize?: number;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

interface InitResponse {
  uploadId: string;
  chunkSize: number;
  receivedBytes: number;
}

interface StatusResponse {
  receivedBytes: number;
  totalSize: number;
  fileName: string;
}

class UploadHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "UploadHttpError";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Upload aborted", "AbortError");
  }
}

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(resolveApiUrl(path), {
    cache: "no-store",
    credentials: "include",
    ...init,
    headers: {
      Accept: "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const body = await parseJsonBody(response);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message: unknown }).message)
        : `Request failed for ${path} (${response.status})`;
    throw new UploadHttpError(message, response.status, body);
  }
  return body as T;
}

async function fetchUploadStatus(
  projectId: string,
  uploadId: string,
  signal?: AbortSignal,
): Promise<StatusResponse> {
  return requestJson<StatusResponse>(`/api/projects/${projectId}/uploads/${uploadId}`, {
    method: "GET",
    signal,
  });
}

/**
 * Upload a file in resumable 16 MB chunks. Retries each chunk up to 5 times
 * with exponential backoff; on an offset conflict (409) or network error it
 * asks the server how many bytes it has and resumes from there.
 */
export async function uploadFileChunked(
  projectId: string,
  file: File,
  opts?: ChunkedUploadOptions,
): Promise<FileNode> {
  const { parentId, onProgress, signal } = opts ?? {};

  throwIfAborted(signal);
  const init = await requestJson<InitResponse>(`/api/projects/${projectId}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      totalSize: file.size,
      ...(parentId ? { parentId } : {}),
    }),
    signal,
  });

  const uploadId = init.uploadId;
  const chunkSize = opts?.chunkSize ?? init.chunkSize ?? DEFAULT_CHUNK_SIZE;
  let offset = init.receivedBytes ?? 0;

  while (offset < file.size) {
    let attempts = 0;
    // Retry loop for a single chunk. The slice is recomputed from the current
    // offset on every attempt so a resync (from 409/status) shifts the window.
    for (;;) {
      throwIfAborted(signal);
      // A resync may reveal the server already has everything we would send.
      if (offset >= file.size) break;
      const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
      try {
        const result = await requestJson<{ receivedBytes: number }>(
          `/api/projects/${projectId}/uploads/${uploadId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type": "application/octet-stream",
              "x-upload-offset": String(offset),
            },
            body: chunk,
            signal,
          },
        );
        offset = result.receivedBytes;
        break;
      } catch (err) {
        if (isAbortError(err)) throw err;

        const isOffsetConflict = err instanceof UploadHttpError && err.status === 409;
        const isNetworkError = !(err instanceof UploadHttpError);
        if (!isOffsetConflict && !isNetworkError) {
          // Fatal server response (404, 413, 500, ...) — retrying won't help.
          throw err;
        }

        attempts += 1;
        if (attempts > MAX_CHUNK_RETRIES) {
          throw err instanceof Error
            ? new Error(`Chunked upload failed after ${MAX_CHUNK_RETRIES} retries: ${err.message}`)
            : new Error(`Chunked upload failed after ${MAX_CHUNK_RETRIES} retries`);
        }

        if (isNetworkError) {
          const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempts - 1), RETRY_MAX_DELAY_MS);
          await sleep(delay, signal);
        }

        // Resync with the server's byte count so we resume, not restart.
        try {
          const status = await fetchUploadStatus(projectId, uploadId, signal);
          offset = status.receivedBytes;
        } catch (statusErr) {
          if (isAbortError(statusErr)) throw statusErr;
          // Status check failed (still offline?) — keep the current offset and
          // let the next attempt's backoff handle it.
        }
      }
    }
    onProgress?.(offset, file.size);
  }

  return requestJson<FileNode>(`/api/projects/${projectId}/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal,
  });
}

/** Provider-agnostic helpers used by drawing-extraction implementations. */

import { createHash } from "node:crypto";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/** Stable short hash for cache-key fingerprints. */
export function hashFingerprint(parts: Array<string | number | boolean | null | undefined>): string {
  const normalized = parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function encodeBase64(bytes: Uint8Array | Buffer): string {
  if (Buffer.isBuffer(bytes)) return bytes.toString("base64");
  return Buffer.from(bytes).toString("base64");
}

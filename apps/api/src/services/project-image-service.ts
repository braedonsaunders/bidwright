import { extname } from "node:path";

export const MAX_AGENT_PROJECT_IMAGE_BYTES = 20 * 1024 * 1024;

export type AgentProjectImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

const MIME_BY_EXTENSION: Record<string, AgentProjectImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const SUPPORTED_MIMES = new Set<AgentProjectImageMime>(
  Object.values(MIME_BY_EXTENSION),
);

export function declaredProjectImageMime(
  fileName: unknown,
  fileType?: unknown,
): AgentProjectImageMime | null {
  const normalizedType = String(fileType ?? "").trim().toLowerCase();
  if (SUPPORTED_MIMES.has(normalizedType as AgentProjectImageMime)) {
    return normalizedType as AgentProjectImageMime;
  }

  const typeAsExtension = normalizedType.replace(/^\./, "");
  if (MIME_BY_EXTENSION[typeAsExtension]) {
    return MIME_BY_EXTENSION[typeAsExtension];
  }

  const extension = extname(String(fileName ?? ""))
    .slice(1)
    .toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? null;
}

export function detectedProjectImageMime(
  bytes: Uint8Array,
): AgentProjectImageMime | null {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }

  return null;
}

export function validateAgentProjectImage(input: {
  bytes: Uint8Array;
  fileName: unknown;
  fileType?: unknown;
}): AgentProjectImageMime {
  if (input.bytes.byteLength > MAX_AGENT_PROJECT_IMAGE_BYTES) {
    throw new Error(
      `Image exceeds the ${MAX_AGENT_PROJECT_IMAGE_BYTES / 1024 / 1024} MB agent inspection limit.`,
    );
  }

  const declared = declaredProjectImageMime(input.fileName, input.fileType);
  if (!declared) {
    throw new Error(
      "Unsupported image format. Agent inspection supports PNG, JPG/JPEG, WebP, and GIF.",
    );
  }

  const detected = detectedProjectImageMime(input.bytes);
  if (!detected) {
    throw new Error("The stored file does not contain a supported image signature.");
  }
  if (detected !== declared) {
    throw new Error(
      `The stored image signature (${detected}) does not match its declared format (${declared}).`,
    );
  }

  return detected;
}

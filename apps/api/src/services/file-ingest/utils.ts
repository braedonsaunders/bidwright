import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CanonicalFileIngestManifest,
  FileIngestArtifact,
  FileIngestCapability,
  FileIngestSourceProvenance,
} from "@bidwright/domain";
import { resolveApiPath, sanitizeFileName } from "../../paths.js";
import type { FileIngestIssue, FileIngestSource } from "./types.js";

export function createId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function extensionOf(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export async function sha256File(absPath: string) {
  return createHash("sha256").update(await readFile(absPath)).digest("hex");
}

export function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function fileSize(absPath: string) {
  return (await stat(absPath)).size;
}

export function textPreview(text: string, maxLength = 800) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

export function makeProvenance(args: {
  source: FileIngestSource;
  format: string;
  checksum: string;
  size: number;
  capability: FileIngestCapability;
  method: string;
  confidence: number;
}): FileIngestSourceProvenance {
  return {
    sourceKind: args.source.source,
    sourceId: args.source.id,
    projectId: args.source.projectId,
    fileName: args.source.fileName,
    fileType: args.source.fileType,
    format: args.format,
    storagePath: args.source.storagePath,
    sourceChecksum: args.checksum,
    sourceSize: args.size,
    adapterId: args.capability.adapterId,
    adapterVersion: args.capability.adapterVersion,
    provider: args.capability.provider,
    generatedAt: new Date().toISOString(),
    method: args.method,
    confidence: args.confidence,
  };
}

export function normalizeIssues(issues: FileIngestIssue[]): CanonicalFileIngestManifest["issues"] {
  return issues.map((issue) => ({
    severity: issue.severity === "error" || issue.severity === "warning" ? issue.severity : "info",
    code: issue.code,
    message: issue.message,
    metadata: issue.metadata,
  }));
}

export async function persistFileIngestArtifacts(args: {
  projectId: string;
  sourceId: string;
  checksum: string;
  manifest: CanonicalFileIngestManifest;
  extraArtifacts?: Array<{
    kind: FileIngestArtifact["kind"];
    fileName: string;
    payload: unknown;
    description: string;
    mediaType?: string;
  }>;
}) {
  const safeSource = sanitizeFileName(args.sourceId);
  const root = path.join("file-ingest", args.projectId, `${safeSource}-${args.checksum.slice(0, 12)}`);
  const absRoot = resolveApiPath(root);
  await mkdir(absRoot, { recursive: true });

  const writeArtifact = async (
    kind: FileIngestArtifact["kind"],
    fileName: string,
    payload: unknown,
    description: string,
    mediaType = "application/json",
  ): Promise<FileIngestArtifact> => {
    const relativePath = path.join(root, fileName);
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    await writeFile(resolveApiPath(relativePath), text, "utf8");
    return {
      id: createId("fia"),
      kind,
      path: relativePath,
      mediaType,
      checksum: sha256Text(text),
      size: Buffer.byteLength(text),
      description,
    };
  };

  const extraArtifacts: FileIngestArtifact[] = [];
  for (const artifact of args.extraArtifacts ?? []) {
    extraArtifacts.push(await writeArtifact(
      artifact.kind,
      artifact.fileName,
      artifact.payload,
      artifact.description,
      artifact.mediaType,
    ));
  }

  const finalManifest = {
    ...args.manifest,
    artifacts: extraArtifacts,
  };
  const manifestArtifact = await writeArtifact("manifest", "manifest.json", finalManifest, "Canonical file ingest manifest");
  return [manifestArtifact, ...extraArtifacts];
}

import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const apiDataRoot = process.env.DATA_DIR || path.join(process.cwd(), "data", "bidwright-api");

export function resolveApiPath(...segments: string[]) {
  return path.resolve(apiDataRoot, ...segments);
}

export function relativeStatePath() {
  return "state.json";
}

export function relativeWorkspacePath(projectId: string) {
  return path.join("workspaces", `${projectId}.json`);
}

export function relativeJobPath(jobId: string) {
  return path.join("jobs", `${jobId}.json`);
}

export function relativePackageRoot(packageId: string) {
  return path.join("packages", packageId);
}

export function relativePackageArchivePath(packageId: string, originalFileName: string) {
  return path.join("packages", packageId, "archive", sanitizeFileName(originalFileName));
}

export function relativePackageReportPath(packageId: string) {
  return path.join("packages", packageId, "report.json");
}

export function relativePackageChunksPath(packageId: string) {
  return path.join("packages", packageId, "chunks.json");
}

export function relativePackageDocumentPath(packageId: string, documentId: string, title: string) {
  return path.join("packages", packageId, "documents", `${sanitizeFileName(title || documentId)}-${documentId}.json`);
}

export function resolveRelativePath(relativePath: string) {
  return resolveApiPath(relativePath);
}

export function sanitizeFileName(value: string) {
  const trimmed = value.trim().replace(/[\\/]+/g, "-");
  const ext = path.extname(trimmed);
  const base = ext ? trimmed.slice(0, -ext.length) : trimmed;
  const safeBase = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const safeExt = ext
    .replace(/[^a-zA-Z0-9.]+/g, "")
    .toLowerCase();

  return `${safeBase || "file"}${safeExt}`;
}


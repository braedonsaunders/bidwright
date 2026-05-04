import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function resolveDataRoot() {
  const configuredDataRoot = process.env.DATA_DIR?.trim();
  if (!configuredDataRoot) {
    return path.join(repoRoot, "data", "bidwright-api");
  }
  return path.isAbsolute(configuredDataRoot)
    ? configuredDataRoot
    : path.resolve(repoRoot, configuredDataRoot);
}

export const apiDataRoot = resolveDataRoot();

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

export function relativeKnowledgeBookPath(bookId: string, fileName: string) {
  return path.join("knowledge", bookId, sanitizeFileName(fileName));
}

export function relativeKnowledgeBookThumbnailPath(bookId: string) {
  return path.join("knowledge", bookId, "thumbnail.png");
}

export function relativeProjectFilePath(projectId: string, nodeId: string, fileName: string) {
  return path.join("projects", projectId, "files", nodeId, sanitizeFileName(fileName));
}

export function resolveRelativePath(relativePath: string) {
  return resolveApiPath(relativePath);
}

// ── Project directory paths (for CLI agent runtime) ──────────────────

export function resolveProjectDir(projectId: string) {
  return resolveApiPath("projects", projectId);
}

export function resolveProjectDocumentsDir(projectId: string) {
  return resolveApiPath("projects", projectId, "documents");
}

export function resolveProjectClaudeMd(projectId: string) {
  return resolveApiPath("projects", projectId, "CLAUDE.md");
}

export function resolveProjectClaudeSettings(projectId: string) {
  return resolveApiPath("projects", projectId, ".claude", "settings.json");
}

export function resolveProjectSessionJson(projectId: string) {
  return resolveApiPath("projects", projectId, ".bidwright", "session.json");
}

export function resolveKnowledgeDir() {
  return resolveApiPath("knowledge");
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

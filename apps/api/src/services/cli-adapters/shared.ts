/**
 * Shared helpers used by every CLI adapter.
 *
 * These are factored out of cli-runtime.ts so adapters can reuse them
 * without depending on each other.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";

export const BIDWRIGHT_PERMISSIONS: readonly string[] = [
  "mcp__bidwright__*",
  "Bash(*)",
  "Read(*)",
  "Write(*)",
  "Edit(*)",
  "Glob(*)",
  "Grep(*)",
  "Agent(*)",
  "TodoWrite",
  "WebSearch(*)",
  "WebFetch(*)",
];

/**
 * Resolve a CLI binary by searching candidates in order:
 *   1. user-supplied path (if absolute or contains a path separator)
 *   2. extra candidates from `extras` (e.g. Windows npm shim paths)
 *   3. each name in `binaryNames` via `which`/`where`
 * Returns null if nothing resolves.
 */
export function resolveCliCommand(
  binaryNames: string[],
  customPath?: string,
  extras: string[] = [],
): string | null {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const candidates: string[] = [];
  if (customPath?.trim()) candidates.push(customPath.trim());
  for (const extra of extras) candidates.push(extra);
  for (const name of binaryNames) candidates.push(name);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const looksLikePath =
      candidate.includes("\\") ||
      candidate.includes("/") ||
      /^[A-Za-z]:/.test(candidate);

    if (looksLikePath) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const resolved = execSync(`${whichCmd} ${candidate}`, { encoding: "utf-8" })
        .trim()
        .split(/\r?\n/)[0];
      if (resolved) return resolved;
    } catch {
      // try next
    }
  }
  return null;
}

export function getCliVersion(command: string): string | undefined {
  try {
    const executable = command.includes(" ") ? `"${command}"` : command;
    return execSync(`${executable} --version`, { encoding: "utf-8" }).trim();
  } catch {
    return undefined;
  }
}

export function quoteWindowsArg(arg: string): string {
  if (arg.includes(" ") || arg.includes("\\") || arg.includes('"')) {
    return `"${arg}"`;
  }
  return arg;
}

/**
 * For npm-installed CLIs that ship a node-script wrapper (.cmd / shell stub),
 * resolve to the underlying `cli.js` so we can read it for model-list scraping.
 */
export function getCliShimTarget(
  commandPath: string,
  packagePath: string[],
  relativeCliPath: string,
): string | null {
  if (!existsSync(commandPath)) return null;
  if (commandPath.endsWith(".js")) return commandPath;

  try {
    const shim = readFileSync(commandPath, "utf-8").trim();
    const baseDir = dirname(commandPath);
    const match = shim.match(/["']([^"']*node_modules[\\/][^"']+)["']/i);
    if (match?.[1]) {
      const rawTarget = match[1]
        .replace(/%dp0%|%~dp0/gi, `${baseDir}\\`)
        .replace(/\$basedir/gi, baseDir);
      const normalizedTarget = rawTarget.replace(
        /[\\/]+/g,
        process.platform === "win32" ? "\\" : "/",
      );
      const resolvedTarget = resolvePath(normalizedTarget);
      if (existsSync(resolvedTarget)) return resolvedTarget;
    }
  } catch {
    // fall through to layout heuristics
  }

  const candidates = [
    join(dirname(commandPath), "node_modules", ...packagePath, relativeCliPath),
    join(dirname(commandPath), "..", "lib", "node_modules", ...packagePath, relativeCliPath),
    join(dirname(commandPath), "..", "node_modules", ...packagePath, relativeCliPath),
  ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function normalizeCliModelDescription(description: string): string {
  return description
    .replace(/\$\{[^}]+\}/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+[•·]\s*$/g, "")
    .trim();
}

export function dedupeModels<T extends { id: string }>(models: T[]): T[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || "";
}

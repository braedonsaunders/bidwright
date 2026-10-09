import { execFileSync } from "node:child_process";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Spoolyard (github.com/braedonsaunders/spoolyard) is built in its own repo and served from
// apps/web/public/spoolyard, where the piping editor runs embedded like the CAD and model editors.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const spoolyard = resolve(process.env.SPOOLYARD_DIR ?? join(repoRoot, "..", "spoolyard"));
const source = join(spoolyard, "dist");
const target = join(repoRoot, "apps", "web", "public", "spoolyard");

try {
  if (!(await stat(source)).isDirectory()) throw new Error(`${source} is not a directory`);
} catch (error) {
  throw new Error(`Spoolyard dist not found at ${source}. Run pnpm build in the Spoolyard checkout, or set SPOOLYARD_DIR.`, {
    cause: error,
  });
}

await mkdir(dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
const commit = execFileSync("git", ["-C", spoolyard, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
await writeFile(join(target, "VERSION"), commit + "\n");
console.log(`Synced Spoolyard ${commit} to apps/web/public/spoolyard`);

import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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

// A page opened before this update still runs the previous build, which loads parts of itself (PDF export, the 3D
// review) on demand by their hashed names. The previous build's own assets are kept beside the new ones for one release
// so those pages keep working until they reload; assets carried over from earlier releases are dropped.
const assets = join(target, "assets"), carriedList = join(assets, ".carried");
const carried = new Set((await readFile(carriedList, "utf8").catch(() => "")).split("\n").filter(Boolean));
const previous = [];
for (const name of await readdir(assets).catch(() => [])) {
  if (name === ".carried" || carried.has(name)) continue;
  previous.push({ name, bytes: await readFile(join(assets, name)) });
}
await mkdir(dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
const kept = [];
for (const { name, bytes } of previous) {
  if (await stat(join(assets, name)).catch(() => null)) continue;
  await writeFile(join(assets, name), bytes);
  kept.push(name);
}
await writeFile(carriedList, kept.join("\n") + (kept.length ? "\n" : ""));
const commit = execFileSync("git", ["-C", spoolyard, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
await writeFile(join(target, "VERSION"), commit + "\n");
console.log(`Synced Spoolyard ${commit} to apps/web/public/spoolyard`);

import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = join(repoRoot, "apps", "cad-editor", "packages", "bidwright-cad-editor", "dist");
const target = join(repoRoot, "apps", "web", "public", "cad-editor");

try {
  const sourceStat = await stat(source);
  if (!sourceStat.isDirectory()) {
    throw new Error(`${source} is not a directory`);
  }
} catch (error) {
  throw new Error("BidWright CAD editor dist folder not found. Run pnpm --dir apps/cad-editor run build:bidwright first.", {
    cause: error,
  });
}

await mkdir(dirname(target), { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });

console.log("Synced BidWright CAD editor assets to apps/web/public/cad-editor");

#!/usr/bin/env node
/**
 * Set the product version.
 *
 * Versioning story, in one place:
 *
 *   - There is ONE product version. It lives in the root package.json.
 *   - apps/desktop mirrors it because electron-builder reads that field for
 *     installer filenames and for auto-update version comparison. Those two
 *     must never disagree; `version-story.test.ts` enforces it.
 *   - Every other workspace package is private and unpublished, so it has no
 *     version of its own — they are pinned at 0.0.0 to say exactly that.
 *     Cross-package deps use `workspace:*`, so the number is never consulted.
 *   - Server images are identified by immutable `sha-<commit>` tags, not
 *     semver. /health reports both, so a running deployment maps to a release.
 *
 * Usage:
 *   node scripts/set-version.mjs 0.3.0
 *   git commit -am "chore: release 0.3.0"
 *   git tag desktop-v0.3.0 && git push origin main desktop-v0.3.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <semver>   e.g. 0.3.0");
  process.exit(1);
}

// Only these two carry the product version — see the note above.
for (const manifest of ["package.json", "apps/desktop/package.json"]) {
  const path = join(repoRoot, manifest);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const previous = json.version;
  json.version = version;
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${manifest}: ${previous} -> ${version}`);
}

console.log(`\nNext:\n  git commit -am "chore: release ${version}"`);
console.log(`  git tag desktop-v${version} && git push origin main desktop-v${version}`);

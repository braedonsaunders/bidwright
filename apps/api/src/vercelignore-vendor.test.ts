import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { globSync } from "node:fs";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const vercelignorePath = join(repoRoot, ".vercelignore");

/**
 * Every `file:` dependency spec in the workspace, as a repo-relative path.
 *
 * The demo deploy broke because the root package.json installed six AppKit
 * packages from `file:vendor/appkit/*.tgz` while `.vercelignore` excluded
 * `*.tgz` — Vercel omitted them and `pnpm install --frozen-lockfile` failed
 * with ENOENT before the build started. Those are published to npm now and the
 * vendor directory is gone, so this should find nothing; the check stays so
 * that reintroducing a local file: dependency can't silently break the deploy
 * the same way.
 */
function localFileDependencies(): string[] {
  const manifests = [
    "package.json",
    ...globSync("apps/*/package.json", { cwd: repoRoot }),
    ...globSync("packages/*/package.json", { cwd: repoRoot }),
  ];
  const found = new Set<string>();
  for (const manifest of manifests) {
    const manifestDir = dirname(manifest);
    const json = JSON.parse(readFileSync(join(repoRoot, manifest), "utf8"));
    const specs: string[] = [
      ...Object.values(json.dependencies ?? {}),
      ...Object.values(json.devDependencies ?? {}),
      ...Object.values(json.pnpm?.overrides ?? {}),
    ].filter((spec): spec is string => typeof spec === "string");

    for (const spec of specs) {
      if (!spec.startsWith("file:")) continue;
      const raw = spec.slice("file:".length);
      // Resolve relative to the manifest, then normalise to repo-relative.
      const resolved = join(manifestDir === "." ? "" : manifestDir, raw);
      found.add(resolved.replace(/^\.\//, ""));
    }
  }
  return [...found];
}

/** Whether .vercelignore (gitignore semantics) excludes each path. */
function excludedPaths(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const dir = mkdtempSync(join(tmpdir(), "vercelignore-"));
  try {
    execFileSync("git", ["init", "-q", "."], { cwd: dir });
    copyFileSync(vercelignorePath, join(dir, ".gitignore"));
    for (const path of paths) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), "");
    }
    return paths.filter((path) => {
      try {
        // check-ignore exits 0 when ignored, 1 when not.
        execFileSync("git", ["check-ignore", "-q", path], { cwd: dir, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("nothing pnpm installs from a local path is excluded from the Vercel upload", () => {
  const excluded = excludedPaths(localFileDependencies());
  assert.deepEqual(
    excluded,
    [],
    "these are installed from disk but excluded from the Vercel upload, so " +
      "`pnpm install --frozen-lockfile` will fail there with ENOENT",
  );
});

test("the AppKit packages come from the registry, not a vendored tarball", () => {
  // They are published now, so the vendored copies were removed entirely
  // rather than kept alive with a .vercelignore negation.
  const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const overrides: Record<string, string> = root?.pnpm?.overrides ?? {};
  const appkit = Object.entries(overrides).filter(([name]) => name.startsWith("@braedonsaunders/appkit-"));
  assert.ok(appkit.length > 0, "expected AppKit overrides to exist");
  for (const [name, spec] of appkit) {
    assert.ok(!spec.startsWith("file:"), `${name} must resolve from the registry, got ${spec}`);
  }
});

test("stray tarballs are still kept out of the upload", () => {
  assert.deepEqual(
    excludedPaths(["stray-pack.tgz", "apps/web/some-pack.tgz"]).sort(),
    ["apps/web/some-pack.tgz", "stray-pack.tgz"],
  );
});

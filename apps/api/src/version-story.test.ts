import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const read = (relative: string) => JSON.parse(readFileSync(join(repoRoot, relative), "utf8"));

const manifests = [
  "package.json",
  ...globSync("apps/*/package.json", { cwd: repoRoot }),
  ...globSync("packages/*/package.json", { cwd: repoRoot }),
];

test("the product version lives in exactly one place, and desktop mirrors it", () => {
  // electron-builder reads apps/desktop's version for installer filenames and
  // for auto-update comparison, so it cannot simply defer to the root. If the
  // two drift, a tag says one thing and the shipped artifact says another.
  const root = read("package.json").version;
  const desktop = read("apps/desktop/package.json").version;
  assert.match(root, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, "root version must be semver");
  assert.equal(desktop, root, "apps/desktop version must equal the root product version");
});

test("internal packages are not independently versioned", () => {
  // Everything here is private and consumed via workspace:*, so a per-package
  // version is fiction that drifts -- which is exactly what happened: the
  // desktop shipped 0.1.9 while web and api still claimed 0.1.0 forever.
  const offenders: string[] = [];
  for (const manifest of manifests) {
    if (manifest === "package.json" || manifest === "apps/desktop/package.json") continue;
    const json = read(manifest);
    if (json.version !== "0.0.0") offenders.push(`${manifest} = ${json.version}`);
  }
  assert.deepEqual(offenders, [], "internal packages must stay at 0.0.0");
});

test("no workspace package can be published to npm by accident", () => {
  // Five packages were publishable purely by omission. They contain the
  // product's server and agent code; a stray `npm publish` is not undoable.
  const publishable = manifests.filter((manifest) => read(manifest).private !== true);
  assert.deepEqual(publishable, [], "every workspace package must set private: true");
});

test("the release tag format matches what the workflow triggers on", () => {
  const workflow = readFileSync(join(repoRoot, ".github/workflows/desktop-release.yml"), "utf8");
  assert.match(workflow, /- "desktop-v\*"/, "workflow triggers on desktop-v* tags");
  // set-version.mjs tells the operator to tag desktop-v<version>; keep those in step.
  const script = readFileSync(join(repoRoot, "scripts/set-version.mjs"), "utf8");
  assert.match(script, /git tag desktop-v\$\{version\}/, "the script prints a matching tag");
});

test("health reports both the release and the exact build", () => {
  // deploymentTag alone (sha-<commit>) never said which release was running.
  const server = readFileSync(join(repoRoot, "apps/api/src/server.ts"), "utf8");
  const health = server.slice(server.indexOf('app.get("/health"'), server.indexOf('app.get("/api/demo/status"'));
  assert.match(health, /version: PRODUCT_VERSION/);
  assert.match(health, /deploymentTag: process\.env\.BIDWRIGHT_DEPLOYMENT_TAG/);
});

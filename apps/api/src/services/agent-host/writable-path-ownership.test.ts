import assert from "node:assert/strict";
import { mkdtemp, mkdir, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { prepareLauncherWritablePaths } from "./writable-path-ownership.js";

test("prepares nested writable paths without following symlink targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "bidwright-launcher-path-"));
  const external = await mkdtemp(join(tmpdir(), "bidwright-launcher-external-"));
  const nested = join(root, ".bidwright", "runtime-broker");
  const request = join(nested, "request.json");
  const externalFile = join(external, "outside.txt");
  await mkdir(nested, { recursive: true });
  await writeFile(request, "{}", { mode: 0o600 });
  await writeFile(externalFile, "outside");
  await symlink(externalFile, join(nested, "outside-link"));

  const identity = { uid: process.getuid!(), gid: process.getgid!() };
  const externalBefore = await stat(externalFile);
  await prepareLauncherWritablePaths([root], identity);

  const [rootAfter, requestAfter, externalAfter] = await Promise.all([
    stat(root),
    stat(request),
    stat(externalFile),
  ]);
  assert.equal(rootAfter.uid, identity.uid);
  assert.equal(rootAfter.gid, identity.gid);
  assert.equal(requestAfter.uid, identity.uid);
  assert.equal(requestAfter.gid, identity.gid);
  assert.equal(externalAfter.uid, externalBefore.uid);
  assert.equal(externalAfter.gid, externalBefore.gid);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preserveCurrentInstructions } from "./instruction-restore.js";

test("restoring an older provider snapshot cannot overwrite the current role", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bw-role-"));
  try {
    await writeFile(join(dir, "AGENTS.md"), "Read-only Q&A. Use saved derivations.");
    await preserveCurrentInstructions(dir, async () => {
      await writeFile(join(dir, "AGENTS.md"), "Build and modify the estimate.");
      return true;
    });
    assert.equal(await readFile(join(dir, "AGENTS.md"), "utf8"), "Read-only Q&A. Use saved derivations.");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

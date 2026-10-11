import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the adapter's mapping of the OCCT result, including duplicated face vertices.
test("OCCT adapter persists per-solid closure and assembly instances with explicit output units", async () => {
  const require = createRequire(import.meta.url);
  const modulePath = require.resolve("occt-import-js");
  const original = require.cache[modulePath];
  const cube = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1];
  const indices = [0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
  const positions = indices.flatMap((i) => cube.slice(i * 3, i * 3 + 3).map((v) => v + 1e6));
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: async () => ({
    ReadStepFile: (_bytes: unknown, params: any) => {
      assert.equal(params.linearUnit, "foot");
      return { success: true, root: { name: "Assembly", children: [{ name: "Part 1", meshes: [0] }, { name: "Part 2", meshes: [0] }] },
        meshes: [{ name: "Cube", attributes: { position: { array: positions } } }, { name: "Open", attributes: { position: { array: positions.slice(9) } } }] };
    },
  }) } as any;
  const dir = await mkdtemp(join(tmpdir(), "occt-metrics-"));
  try {
    const absPath = join(dir, "synthetic.step"); await writeFile(absPath, "adapter test input");
    const { occtAdapter } = await import("./occt-adapter.js");
    const result = await occtAdapter.ingest({ id: "s", source: "file_node", projectId: "p", fileName: "synthetic.step" }, { absPath, checksum: "test", size: 18, format: "step" });
    const closed = result.elements.find((e) => e.name === "Cube")!;
    assert.equal(closed.properties?.closed, true);
    assert.equal((closed.properties?.assemblyInstances as unknown[]).length, 2);
    assert.equal(result.quantities.find((q) => q.elementId === closed.id && q.quantityType === "volume")?.value, 1);
    assert.equal(result.quantities.find((q) => q.elementId === closed.id && q.quantityType === "volume")?.unit, "CF");
    const open = result.elements.find((e) => e.name === "Open")!;
    assert.equal(open.properties?.closed, false);
    assert.equal(result.quantities.some((q) => q.elementId === open.id && q.quantityType === "volume"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (original) require.cache[modulePath] = original; else delete require.cache[modulePath];
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@bidwright/db";
import { getProjectModelScanStatus, listProjectModelAssets, startProjectModelScan } from "./model-service.js";

test("a failed source ends the scan with an error and polling retains asset diagnostics", async (t) => {
  const restores: Array<() => void> = [];
  const replace = (object: any, key: string, fn: any) => {
    const original = object[key]; object[key] = fn; restores.push(() => { object[key] = original; });
  };
  t.after(() => restores.reverse().forEach(restore => restore()));
  let asset: any = { id: "asset", projectId: "scan-test", status: "pending" };
  let issues: any[] = [];
  replace(prisma.project, "findUnique", async () => ({ id: "scan-test" }));
  replace(prisma.sourceDocument, "findMany", async () => [{ id: "missing", fileName: "missing.nwd", storagePath: null }]);
  replace(prisma.fileNode, "findMany", async () => []);
  replace(prisma.modelAsset, "findFirst", async () => asset);
  replace(prisma.modelAsset, "findUnique", async () => asset);
  replace(prisma.modelAsset, "update", async ({ data }: any) => (asset = { ...asset, ...data }));
  replace(prisma.modelAsset, "findMany", async () => [{ ...asset, issues, _count: { pickups: 0 } }]);
  for (const table of ["modelIssue", "modelBom", "modelElementConnection", "modelTakeoffGroup", "modelQuantity", "modelElement"]) {
    replace((prisma as any)[table], "deleteMany", async () => ({ count: 0 }));
  }
  replace(prisma.pickup, "updateMany", async () => ({ count: 0 }));
  replace(prisma.modelBom, "create", async () => ({}));
  replace(prisma.modelIssue, "createMany", async ({ data }: any) => { issues = data; return { count: data.length }; });
  replace(prisma.modelTakeoffRecipe, "findMany", async () => []);
  replace(prisma.modelTakeoffOverride, "findMany", async () => []);
  replace(prisma, "$transaction", async (input: any) => typeof input === "function" ? input(prisma) : Promise.all(input));
  startProjectModelScan("scan-test", {});
  for (let i = 0; i < 100 && getProjectModelScanStatus("scan-test").status === "running"; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const scan = getProjectModelScanStatus("scan-test");
  assert.equal(scan.status, "failed");
  assert.match(scan.error!, /missing.nwd/);
  assert.deepEqual(scan.syncedIds, ["asset"]);
  asset.manifest = { ...asset.manifest, translationProgress: "old value", modelIngest: { summary: { translationProgress: "complete" } } };
  const assets = await listProjectModelAssets("scan-test", { discover: false });
  assert.equal(assets[0].status, "failed");
  assert.equal(assets[0].progress, "complete");
  assert.equal(assets[0].terminalErrors.length, 1);
  assert.match(assets[0].terminalErrors[0].code, /missing|source/);
});

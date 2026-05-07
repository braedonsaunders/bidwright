import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveApiPath } from "../../apps/api/src/paths.js";
import { generateFileIngestManifest, getFileIngestCapabilities } from "../../apps/api/src/services/file-ingest/orchestrator.js";

const projectId = "file-ingest-benchmark";
const fixtureRoot = path.join("file-ingest-benchmark", "fixtures");

const fixtures = [
  {
    id: "fixture-txt",
    fileName: "scope.txt",
    content: "Bidwright file ingest benchmark\n\nScope: replace four rooftop units and reconnect controls.\n",
  },
  {
    id: "fixture-csv",
    fileName: "rates.csv",
    content: "Item,Unit,Qty\nRTU,eac,4\nControls,lot,1\n",
  },
  {
    id: "fixture-obj",
    fileName: "triangle.obj",
    content: ["o triangle", "v 0 0 0", "v 1 0 0", "v 0 1 0", "f 1 2 3", ""].join("\n"),
  },
];

async function main() {
  await mkdir(resolveApiPath(fixtureRoot), { recursive: true });
  const capabilities = await getFileIngestCapabilities();
  console.log(JSON.stringify({ capabilityCount: capabilities.length, capabilities }, null, 2));

  for (const fixture of fixtures) {
    const storagePath = path.join(fixtureRoot, fixture.fileName);
    await writeFile(resolveApiPath(storagePath), fixture.content, "utf8");
    const result = await generateFileIngestManifest({
      id: fixture.id,
      source: "raw_file",
      projectId,
      fileName: fixture.fileName,
      fileType: path.extname(fixture.fileName).slice(1),
      storagePath,
      size: Buffer.byteLength(fixture.content),
    });
    console.log(JSON.stringify({
      fileName: fixture.fileName,
      status: result.status,
      family: result.family,
      adapter: result.capability.adapterId,
      capabilityStatus: result.capability.status,
      summary: result.manifest.summary,
      artifactKinds: result.manifest.artifacts.map((artifact) => artifact.kind),
      issues: result.issues.map((issue) => ({ code: issue.code, severity: issue.severity })),
    }, null, 2));
  }
}

await main();

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveApiPath } from "../../apps/api/src/paths.js";
import { generateModelIngestManifest, getModelIngestCapabilities } from "../../apps/api/src/services/model-ingest/orchestrator.js";

const projectId = "model-ingest-benchmark";
const fixtureRoot = path.join("model-ingest-benchmark", "fixtures");

const fixtures = [
  {
    id: "fixture-obj",
    fileName: "triangle.obj",
    content: [
      "o triangle",
      "v 0 0 0",
      "v 1 0 0",
      "v 0 1 0",
      "g triangle",
      "f 1 2 3",
      "",
    ].join("\n"),
  },
  {
    id: "fixture-dxf",
    fileName: "lines.dxf",
    content: [
      "0", "SECTION",
      "2", "HEADER",
      "9", "$INSUNITS",
      "70", "2",
      "0", "ENDSEC",
      "0", "SECTION",
      "2", "ENTITIES",
      "0", "LINE",
      "8", "A-WALL",
      "10", "0",
      "20", "0",
      "11", "10",
      "21", "0",
      "0", "ENDSEC",
      "0", "EOF",
      "",
    ].join("\n"),
  },
  {
    id: "fixture-ifc",
    fileName: "minimal.ifc",
    content: [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
      "FILE_NAME('minimal.ifc','2026-05-06T00:00:00',('Bidwright'),('Bidwright'),'','','');",
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
      "#1=IFCPERSON($,'Bidwright',$,$,$,$,$,$);",
      "#2=IFCORGANIZATION($,'Bidwright',$,$,$);",
      "#3=IFCPERSONANDORGANIZATION(#1,#2,$);",
      "#4=IFCAPPLICATION(#2,'1.0','Bidwright Benchmark','BIDWRIGHT');",
      "#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);",
      "#10=IFCCARTESIANPOINT((0.,0.,0.));",
      "#11=IFCDIRECTION((0.,0.,1.));",
      "#12=IFCDIRECTION((1.,0.,0.));",
      "#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);",
      "#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#13,$);",
      "#30=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
      "#31=IFCUNITASSIGNMENT((#30));",
      "#40=IFCPROJECT('0oLw5pW1P8qv7xXbW2d001',#5,'Benchmark Project',$,$,$,$,(#20),#31);",
      "#50=IFCWALL('2O2Fr$t4X7Zf8NOew3FNr2',#5,'Test Wall',$,$,$,$,$,$);",
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n"),
  },
];

async function main() {
  await mkdir(resolveApiPath(fixtureRoot), { recursive: true });
  const capabilities = await getModelIngestCapabilities();
  console.log(JSON.stringify({ capabilities }, null, 2));

  for (const fixture of fixtures) {
    const storagePath = path.join(fixtureRoot, fixture.fileName);
    await writeFile(resolveApiPath(storagePath), fixture.content, "utf8");
    const result = await generateModelIngestManifest({
      id: fixture.id,
      source: "file_node",
      projectId,
      fileName: fixture.fileName,
      fileType: path.extname(fixture.fileName).slice(1),
      storagePath,
      size: Buffer.byteLength(fixture.content),
    });
    console.log(JSON.stringify({
      fileName: fixture.fileName,
      status: result.status,
      parser: result.manifest.parser,
      adapter: result.capability.adapterId,
      adapterStatus: result.capability.status,
      elements: result.elements.length,
      quantities: result.quantities.length,
      issues: result.issues.map((issue) => ({ code: issue.code, severity: issue.severity })),
    }, null, 2));
  }
}

await main();

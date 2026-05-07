import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { prisma } from "../../packages/db/src/client.js";
import { PrismaApiStore } from "../../apps/api/src/prisma-store.js";
import { resolveApiPath, sanitizeFileName } from "../../apps/api/src/paths.js";
import { generateFileIngestManifest } from "../../apps/api/src/services/file-ingest/orchestrator.js";
import { resolveProjectFileIngestSource } from "../../apps/api/src/services/file-ingest-service.js";
import { getScheduleImportCandidates, importProjectSchedule } from "../../apps/api/src/services/schedule-import-service.js";

const requireFromApi = createRequire(new URL("../../apps/api/package.json", import.meta.url));
const JSZip = requireFromApi("jszip") as typeof import("jszip");
const XLSX = requireFromApi("xlsx") as typeof import("xlsx");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ORG_ID = process.env.BIDWRIGHT_SMOKE_ORG_ID || "cmn2a1wzw0001xopqxwctc7xl";
const USER_ID = process.env.BIDWRIGHT_SMOKE_USER_ID || "cmn2a1x0t0005xopqqu596udt";

type SampleGroup =
  | "documents"
  | "spreadsheets"
  | "text-web-config"
  | "images"
  | "email"
  | "archives"
  | "models-cad-bim"
  | "schedules";

interface SampleSpec {
  group: SampleGroup;
  name: string;
  content?: Buffer | string;
  copyFrom?: string;
  downloadUrl?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  notes?: string;
}

interface CreatedSample {
  spec: SampleSpec;
  nodeId: string;
  storagePath: string;
  size: number;
  checksum: string;
  sourceStatus: "generated" | "copied" | "downloaded" | "fallback";
  ingest?: {
    status: string;
    family: string;
    adapterStatus?: string;
    parser?: unknown;
    issues: Array<{ severity: string; code: string; message: string }>;
    error?: string;
  };
  schedule?: {
    provider?: string;
    status?: string;
    message?: string;
    imported?: unknown;
    error?: string;
  };
}

type SpreadsheetBookType = import("xlsx").BookType;

const groupFolders: Record<SampleGroup, string> = {
  documents: "01-documents",
  spreadsheets: "02-spreadsheets",
  "text-web-config": "03-text-web-config",
  images: "04-images",
  email: "05-email",
  archives: "06-archives",
  "models-cad-bim": "07-models-cad-bim",
  schedules: "08-schedules",
};

const mimeTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  rtf: "application/rtf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  mhtml: "multipart/related",
  mht: "multipart/related",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tiff: "image/tiff",
  tif: "image/tiff",
  bmp: "image/bmp",
  webp: "image/webp",
  gif: "image/gif",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
  zip: "application/zip",
  "7z": "application/x-7z-compressed",
  rar: "application/vnd.rar",
  tar: "application/x-tar",
  gz: "application/gzip",
  tgz: "application/gzip",
  dwg: "application/acad",
  dxf: "image/vnd.dxf",
  rvt: "application/octet-stream",
  mpp: "application/vnd.ms-project",
  mpt: "application/vnd.ms-project",
  mpx: "application/x-project",
  p6xml: "application/xml",
  pmxml: "application/xml",
  xml: "application/xml",
  step: "model/step",
  stp: "model/step",
  iges: "model/iges",
  igs: "model/iges",
  stl: "model/stl",
  obj: "model/obj",
  gltf: "model/gltf+json",
  glb: "model/gltf-binary",
  dae: "model/vnd.collada+xml",
  fbx: "application/octet-stream",
  "3ds": "application/x-3ds",
  brep: "application/octet-stream",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  yml: "text/yaml",
  yaml: "text/yaml",
  log: "text/plain",
  ini: "text/plain",
  toml: "text/plain",
  conf: "text/plain",
  cfg: "text/plain",
};

function extOf(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function utf8(value: string) {
  return Buffer.from(value, "utf8");
}

function makePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 96 >>\nstream\nBT /F1 18 Tf 72 720 Td (BidWright ingest smoke PDF) Tj 0 -28 Td (Fixture: one page with readable text.) Tj ET\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return utf8(body);
}

async function makeDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>BidWright ingest smoke DOCX</w:t></w:r></w:p>
    <w:p><w:r><w:t>Scope: mechanical room modernization, valves, controls, and closeout.</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Qty</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Pump</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function makePptx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.file("ppt/slides/slide1.xml", `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:p><a:r><a:t>BidWright ingest smoke PPTX</a:t></a:r></a:p>
      <a:p><a:r><a:t>Fixture slide with construction scope and quantities.</a:t></a:r></a:p>
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

function makeWorkbook(bookType: SpreadsheetBookType) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Cost Code", "Description", "Quantity", "Unit"],
    ["23 21 13", "Hydronic piping", 120, "lf"],
    ["23 21 16", "Hydronic valves", 8, "ea"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Estimate Takeoff");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType }));
}

function makeZip() {
  const zip = new JSZip();
  zip.file("readme.txt", "BidWright archive smoke fixture\n");
  zip.file("nested/quantity.csv", "item,qty,unit\npipe,120,lf\nvalve,8,ea\n");
  return zip.generateAsync({ type: "nodebuffer" });
}

function makeTar(entries: Array<{ name: string; content: string | Buffer }>) {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content) ? entry.content : utf8(entry.content);
    const header = Buffer.alloc(512, 0);
    header.write(entry.name, 0, 100, "utf8");
    header.write("0000644\0", 100, 8, "ascii");
    header.write("0000000\0", 108, 8, "ascii");
    header.write("0000000\0", 116, 8, "ascii");
    header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
    header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12, "ascii");
    header.fill(" ", 148, 156, "ascii");
    header.write("0", 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
    blocks.push(header, content);
    const pad = (512 - (content.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}

function makeBmp() {
  const pixelData = Buffer.from([
    0x00, 0x00, 0xff, 0x00,
    0xff, 0xff, 0xff, 0x00,
  ]);
  const header = Buffer.alloc(62, 0);
  header.write("BM", 0, 2, "ascii");
  header.writeUInt32LE(header.length + pixelData.length, 2);
  header.writeUInt32LE(header.length, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(2, 18);
  header.writeInt32LE(1, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(32, 28);
  header.writeUInt32LE(pixelData.length, 34);
  return Buffer.concat([header, pixelData]);
}

function makeTiff() {
  const buffer = Buffer.alloc(122, 0);
  buffer.write("II", 0, 2, "ascii");
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(8, 4);
  buffer.writeUInt16LE(8, 8);
  const tags = [
    [256, 4, 1, 1],
    [257, 4, 1, 1],
    [258, 3, 1, 8],
    [259, 3, 1, 1],
    [262, 3, 1, 1],
    [273, 4, 1, 118],
    [278, 4, 1, 1],
    [279, 4, 1, 1],
  ];
  let offset = 10;
  for (const [tag, type, count, value] of tags) {
    buffer.writeUInt16LE(tag, offset);
    buffer.writeUInt16LE(type, offset + 2);
    buffer.writeUInt32LE(count, offset + 4);
    buffer.writeUInt32LE(value, offset + 8);
    offset += 12;
  }
  buffer.writeUInt32LE(0, offset);
  buffer[118] = 0xff;
  return buffer;
}

function makeGlb() {
  const json = JSON.stringify({
    asset: { version: "2.0", generator: "BidWright ingest smoke" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Smoke cube shell", mesh: 0 }],
    meshes: [{ name: "Smoke mesh", primitives: [] }],
  });
  const jsonPadding = (4 - (Buffer.byteLength(json) % 4)) % 4;
  const jsonChunk = Buffer.concat([utf8(json), Buffer.alloc(jsonPadding, 0x20)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.write("JSON", 4, 4, "ascii");
  return Buffer.concat([header, chunkHeader, jsonChunk]);
}

function makeEmpty3ds() {
  const buffer = Buffer.alloc(6);
  buffer.writeUInt16LE(0x4d4d, 0);
  buffer.writeUInt32LE(6, 2);
  return buffer;
}

function makeMspdiXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Project>
  <Name>BidWright Smoke MSPDI</Name>
  <Tasks>
    <Task><UID>1</UID><ID>1</ID><Name>Mobilization</Name><Start>2026-06-01T08:00:00</Start><Finish>2026-06-02T17:00:00</Finish><Duration>PT16H0M0S</Duration><OutlineLevel>1</OutlineLevel><PercentComplete>25</PercentComplete></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Install equipment</Name><Start>2026-06-03T08:00:00</Start><Finish>2026-06-05T17:00:00</Finish><Duration>PT24H0M0S</Duration><OutlineLevel>1</OutlineLevel><PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink></Task>
  </Tasks>
  <Resources><Resource><UID>1</UID><ID>1</ID><Name>Pipefitter crew</Name><Group>Labor</Group><Type>1</Type></Resource></Resources>
  <Assignments><Assignment><TaskUID>2</TaskUID><ResourceUID>1</ResourceUID><Units>1</Units></Assignment></Assignments>
</Project>
`;
}

function makeP6Xml(rootName = "Project") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<${rootName}>
  <Activity><ObjectId>A1</ObjectId><Id>BW-100</Id><Name>Submittals</Name><StartDate>2026-06-01</StartDate><FinishDate>2026-06-03</FinishDate><OriginalDuration>3</OriginalDuration><PercentComplete>10</PercentComplete></Activity>
  <Activity><ObjectId>A2</ObjectId><Id>BW-200</Id><Name>Field install</Name><StartDate>2026-06-04</StartDate><FinishDate>2026-06-10</FinishDate><OriginalDuration>5</OriginalDuration><PercentComplete>0</PercentComplete></Activity>
  <Relationship><PredecessorActivityObjectId>A1</PredecessorActivityObjectId><SuccessorActivityObjectId>A2</SuccessorActivityObjectId><Type>FS</Type><Lag>0</Lag></Relationship>
</${rootName}>
`;
}

function makeXer() {
  return [
    "ERMHDR\t9.0\tBidWright",
    "%T\tPROJWBS",
    "%F\twbs_id\tparent_wbs_id\twbs_name\twbs_short_name",
    "%R\t1\t\tSmoke Project\tSMOKE",
    "%T\tTASK",
    "%F\ttask_id\ttask_code\ttask_name\twbs_id\ttask_type\ttarget_start_date\ttarget_end_date\tremain_drtn_hr_cnt\tphys_complete_pct",
    "%R\tA1\tBW-100\tSubmittals\t1\tTask Dependent\t2026-06-01\t2026-06-03\t24\t10",
    "%R\tA2\tBW-200\tField install\t1\tTask Dependent\t2026-06-04\t2026-06-10\t40\t0",
    "%T\tTASKPRED",
    "%F\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt",
    "%R\tA2\tA1\tPR_FS\t0",
    "",
  ].join("\n");
}

function makeMpx() {
  return [
    "MPX,Microsoft Project for Windows,4.0,ANSI",
    "50,Unique ID,ID,Name,Start,Finish,Duration,Percent Complete,Outline Level,Milestone,Summary,Predecessors",
    "51,1,1,BidWright MPX Smoke,2026-06-01,2026-06-01,0,0,1,0,1,",
    "51,2,2,Mobilization,2026-06-01,2026-06-02,2,25,2,0,0,",
    "51,3,3,Install equipment,2026-06-03,2026-06-05,3,0,2,0,0,2FS",
    "60,Unique ID,ID,Name,Group,Type",
    "61,1,1,Pipefitter crew,Labor,Labor",
    "70,Task Unique ID,Resource Unique ID,Units",
    "71,3,1,1",
    "",
  ].join("\n");
}

function makeIfc() {
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    "FILE_NAME('bidwright-smoke.ifc','2026-05-06T00:00:00',('Bidwright'),('Bidwright'),'','','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    "#1=IFCPERSON($,'Bidwright',$,$,$,$,$,$);",
    "#2=IFCORGANIZATION($,'Bidwright',$,$,$);",
    "#3=IFCPERSONANDORGANIZATION(#1,#2,$);",
    "#4=IFCAPPLICATION(#2,'1.0','Bidwright Smoke','BIDWRIGHT');",
    "#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,0);",
    "#10=IFCCARTESIANPOINT((0.,0.,0.));",
    "#11=IFCDIRECTION((0.,0.,1.));",
    "#12=IFCDIRECTION((1.,0.,0.));",
    "#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);",
    "#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#13,$);",
    "#30=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
    "#31=IFCUNITASSIGNMENT((#30));",
    "#40=IFCPROJECT('0oLw5pW1P8qv7xXbW2d001',#5,'Smoke Project',$,$,$,$,(#20),#31);",
    "#50=IFCWALL('2O2Fr$t4X7Zf8NOew3FNr2',#5,'Smoke Wall',$,$,$,$,$,$);",
    "#51=IFCDOOR('1gPs91r5X2sveBIDW001',#5,'Smoke Door',$,$,$,$,$,$);",
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}

async function downloadBuffer(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function materializeSample(spec: SampleSpec) {
  if (spec.downloadUrl) {
    try {
      return { buffer: await downloadBuffer(spec.downloadUrl), status: "downloaded" as const };
    } catch (error) {
      const fallback = spec.content ? Buffer.isBuffer(spec.content) ? spec.content : utf8(spec.content) : utf8(`Download failed for ${spec.name}: ${error instanceof Error ? error.message : String(error)}\n`);
      return { buffer: fallback, status: "fallback" as const };
    }
  }
  if (spec.copyFrom) {
    const sourcePath = path.isAbsolute(spec.copyFrom) ? spec.copyFrom : path.join(repoRoot, spec.copyFrom);
    return { buffer: await readFile(sourcePath), status: "copied" as const };
  }
  return { buffer: Buffer.isBuffer(spec.content) ? spec.content : utf8(spec.content ?? ""), status: "generated" as const };
}

async function buildSamples(): Promise<SampleSpec[]> {
  const zipFixture = await makeZip();
  const tarFixture = makeTar([
    { name: "readme.txt", content: "BidWright TAR smoke fixture\n" },
    { name: "nested/quantity.csv", content: "item,qty,unit\npipe,120,lf\n" },
  ]);
  const docx = await makeDocx();
  const pptx = await makePptx();

  const bluebeamCsv = "Subject,Page Label,Quantity,Units,Comments,Status,Layer\nValve takeoff,A-101,8,EA,Counted from fixture,Complete,M-Process\nPipe length,A-102,120,LF,Measured centerline,Complete,M-Piping\n";
  const textScope = "BidWright ingest smoke text fixture\nScope: replace pumps, valves, controls, insulation, testing, and closeout.\n";
  const html = "<!doctype html><html><head><title>BidWright Smoke HTML</title></head><body><h1>BidWright Smoke HTML</h1><table><tr><th>Item</th><th>Qty</th></tr><tr><td>Valve</td><td>8</td></tr></table></body></html>\n";
  const mhtml = [
    "MIME-Version: 1.0",
    "Content-Type: multipart/related; boundary=\"----bidwright-smoke\"",
    "",
    "------bidwright-smoke",
    "Content-Type: text/html; charset=\"utf-8\"",
    "",
    html,
    "------bidwright-smoke--",
    "",
  ].join("\r\n");
  const eml = [
    "From: estimator@example.com",
    "To: bidwright@example.com",
    "Subject: BidWright smoke email",
    "Date: Wed, 6 May 2026 10:00:00 -0400",
    "Message-ID: <bidwright-smoke@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please include the attached-like scope notes for valves, pipe, controls, and closeout.",
    "",
  ].join("\r\n");

  return [
    {
      group: "documents",
      name: "sample.pdf",
      downloadUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      sourceUrl: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
      sourceLabel: "W3C dummy PDF fixture",
      content: makePdf(),
      notes: "Tiny public PDF fixture with generated local PDF fallback.",
    },
    { group: "documents", name: "sample.docx", content: docx, notes: "Generated OpenXML Word document." },
    {
      group: "documents",
      name: "sample.doc",
      downloadUrl: "https://raw.githubusercontent.com/morungos/node-word-extractor/develop/__tests__/data/test01.doc",
      sourceUrl: "https://github.com/morungos/node-word-extractor",
      sourceLabel: "morungos/node-word-extractor test fixture",
      notes: "Public legacy Word fixture used to exercise .doc parsing.",
    },
    { group: "documents", name: "sample.rtf", content: "{\\rtf1\\ansi BidWright ingest smoke RTF.\\par Scope includes testing and balancing.\\par}\n" },
    { group: "documents", name: "sample.pptx", content: pptx, notes: "Generated OpenXML presentation." },

    { group: "spreadsheets", name: "takeoff.xlsx", content: makeWorkbook("xlsx") },
    { group: "spreadsheets", name: "takeoff.xls", content: makeWorkbook("xls") },
    { group: "spreadsheets", name: "takeoff.xlsm", content: makeWorkbook("xlsm"), notes: "Macro-enabled container shape without macros." },
    { group: "spreadsheets", name: "takeoff.ods", content: makeWorkbook("ods") },
    { group: "spreadsheets", name: "bluebeam-markups.csv", content: bluebeamCsv, notes: "CSV shaped like Bluebeam markup export." },
    { group: "spreadsheets", name: "tabular-takeoff.tsv", content: bluebeamCsv.replace(/,/g, "\t") },

    { group: "text-web-config", name: "scope.html", content: html },
    { group: "text-web-config", name: "scope.htm", content: html },
    { group: "text-web-config", name: "scope.mhtml", content: mhtml },
    { group: "text-web-config", name: "scope.mht", content: mhtml },
    { group: "text-web-config", name: "scope.txt", content: textScope },
    { group: "text-web-config", name: "scope.md", content: "# BidWright Smoke Markdown\n\n- Pumps: 2 EA\n- Valves: 8 EA\n" },
    { group: "text-web-config", name: "scope.markdown", content: "# Markdown Extension Smoke\n\nQuantity table preserved as text.\n" },
    { group: "text-web-config", name: "scope.json", content: JSON.stringify({ project: "BidWright smoke", quantities: [{ item: "Valve", qty: 8, unit: "EA" }] }, null, 2) },
    { group: "text-web-config", name: "schedule-mspdi.xml", content: makeMspdiXml(), notes: "Also used by schedule import as Microsoft Project XML." },
    { group: "text-web-config", name: "scope.yml", content: "project: BidWright smoke\nquantities:\n  - item: Valve\n    qty: 8\n    unit: EA\n" },
    { group: "text-web-config", name: "scope.yaml", content: "project: BidWright smoke\nscope: hydronic upgrades\n" },
    { group: "text-web-config", name: "ingest.log", content: "INFO BidWright smoke log line\nWARN Example warning for parser visibility\n" },
    { group: "text-web-config", name: "settings.ini", content: "[bidwright]\nproject=smoke\nmode=ingest\n" },
    { group: "text-web-config", name: "settings.toml", content: "[bidwright]\nproject = \"smoke\"\nmode = \"ingest\"\n" },
    { group: "text-web-config", name: "app.conf", content: "project smoke\nmode ingest\n" },
    { group: "text-web-config", name: "app.cfg", content: "project=smoke\nmode=ingest\n" },

    { group: "images", name: "sample.png", content: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64") },
    { group: "images", name: "sample.jpg", content: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVEAEBAAAAAAAAAAAAAAAAAAAAAf/aAAwDAQACEAMQAAABo//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//Z", "base64") },
    { group: "images", name: "sample.jpeg", content: Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVEAEBAAAAAAAAAAAAAAAAAAAAAf/aAAwDAQACEAMQAAABo//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//Z", "base64") },
    { group: "images", name: "sample.tiff", content: makeTiff() },
    { group: "images", name: "sample.tif", content: makeTiff() },
    { group: "images", name: "sample.bmp", content: makeBmp() },
    { group: "images", name: "sample.webp", content: Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AA/v89WAAAAA==", "base64") },
    { group: "images", name: "sample.gif", content: Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64") },

    { group: "email", name: "sample.eml", content: eml },
    {
      group: "email",
      name: "sample.msg",
      downloadUrl: "https://raw.githubusercontent.com/tutao/oxmsg/master/test/testOut_noattach.msg",
      sourceUrl: "https://github.com/tutao/oxmsg",
      sourceLabel: "tutao/oxmsg test fixture",
      notes: "Public Outlook .msg fixture.",
    },

    { group: "archives", name: "sample.zip", content: zipFixture },
    {
      group: "archives",
      name: "sample.7z",
      downloadUrl: "https://raw.githubusercontent.com/miurahr/py7zr/master/tests/data/copy.7z",
      sourceUrl: "https://github.com/miurahr/py7zr",
      sourceLabel: "miurahr/py7zr test fixture",
    },
    {
      group: "archives",
      name: "sample.rar",
      downloadUrl: "https://raw.githubusercontent.com/ssokolow/rar-test-files/master/build/testfile.rar3.rar",
      sourceUrl: "https://github.com/ssokolow/rar-test-files",
      sourceLabel: "ssokolow/rar-test-files test fixture",
    },
    { group: "archives", name: "sample.tar", content: tarFixture },
    { group: "archives", name: "sample.gz", content: gzipSync("BidWright gzip smoke fixture\n") },
    { group: "archives", name: "sample.tgz", content: gzipSync(tarFixture) },

    { group: "models-cad-bim", name: "sample.step", copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/conical-surface/conical-surface.step" },
    { group: "models-cad-bim", name: "sample.stp", copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp" },
    { group: "models-cad-bim", name: "sample.iges", copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.igs" },
    { group: "models-cad-bim", name: "sample.igs", copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.igs" },
    { group: "models-cad-bim", name: "sample.brep", copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/cax-if-brep/as1_pe_203.brep" },
    { group: "models-cad-bim", name: "sample.stl", copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.stl" },
    { group: "models-cad-bim", name: "sample.obj", content: "o smoke_triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\ng smoke\nf 1 2 3\n" },
    { group: "models-cad-bim", name: "sample.fbx", copyFrom: "data/bidwright-api/projects/project-hospital-expansion/files/cad-sample-valve-assembly/valve-assembly.fbx" },
    { group: "models-cad-bim", name: "sample.gltf", content: JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Smoke node", mesh: 0 }], meshes: [{ name: "Smoke mesh", primitives: [] }] }, null, 2) },
    { group: "models-cad-bim", name: "sample.glb", content: makeGlb() },
    { group: "models-cad-bim", name: "sample.3ds", content: makeEmpty3ds(), notes: "Minimal valid empty 3DS chunk; current server extractor is shell-only for 3DS." },
    { group: "models-cad-bim", name: "sample.dae", content: `<?xml version="1.0" encoding="utf-8"?><COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"><asset><unit name="meter" meter="1"/></asset><library_geometries/><scene/></COLLADA>\n` },
    { group: "models-cad-bim", name: "sample.ifc", content: makeIfc() },
    {
      group: "models-cad-bim",
      name: "sample.dwg",
      downloadUrl: "https://raw.githubusercontent.com/nextgis/dwg_samples/master/line_2000.dwg",
      sourceUrl: "https://github.com/nextgis/dwg_samples",
      sourceLabel: "nextgis/dwg_samples fixture",
      notes: "Real DWG fixture; extraction should report Autodesk APS missing unless configured.",
    },
    { group: "models-cad-bim", name: "sample.dxf", copyFrom: "data/bidwright-api/model-ingest-benchmark/fixtures/lines.dxf" },
    {
      group: "models-cad-bim",
      name: "sample.rvt",
      downloadUrl: "https://raw.githubusercontent.com/specklesystems/xUnitRevit/master/SampleLibrary/TestModels/walls.rvt",
      sourceUrl: "https://github.com/specklesystems/xUnitRevit",
      sourceLabel: "specklesystems/xUnitRevit test model",
      notes: "Real RVT fixture; extraction should report Autodesk APS missing unless configured.",
    },

    {
      group: "schedules",
      name: "sample.mpp",
      downloadUrl: "https://raw.githubusercontent.com/joniles/mpxj/master/junit/data/DurationTest8.mpp",
      sourceUrl: "https://github.com/joniles/mpxj",
      sourceLabel: "MPXJ test fixture",
      notes: "Binary Microsoft Project fixture; this server reports MPXJ missing if Java/JARs are unavailable.",
    },
    {
      group: "schedules",
      name: "sample.mpt",
      downloadUrl: "https://raw.githubusercontent.com/joniles/mpxj/master/junit/data/DurationTest8.mpp",
      sourceUrl: "https://github.com/joniles/mpxj",
      sourceLabel: "MPXJ MPP fixture reused for MPT capability state",
      notes: "MPT uses the same binary family as MPP; fixture is reused to verify candidate/capability behavior.",
    },
    { group: "schedules", name: "sample.mpx", content: makeMpx(), notes: "Generated MPX text exchange file." },
    { group: "schedules", name: "sample.xer", content: makeXer(), notes: "Generated Primavera P6 XER fixture." },
    { group: "schedules", name: "sample.p6xml", content: makeP6Xml("Project"), notes: "Generated Primavera-style XML fixture." },
    { group: "schedules", name: "sample.pmxml", content: makeP6Xml("ProjectManagement"), notes: "Generated PMXML-style fixture." },
  ];
}

async function main() {
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const store = new PrismaApiStore(prisma, ORG_ID);
  store.setUserId(USER_ID);
  const created = await store.createProject({
    name: `Ingest Smoke Matrix - ${runStamp}`,
    clientName: "BidWright QA",
    location: "Local Smoke Lab",
    packageName: "All Supported File Types",
    scope: "One representative sample per supported intake/model/schedule format, created for UI and ingest regression review.",
    summary: "Dedicated smoke quote for validating BidWright file, model, archive, email, and schedule ingest behavior.",
    creationMode: "manual",
  });
  const projectId = created.project.id;
  const quoteId = created.quote?.id ?? null;
  const revisionId = created.revision?.id ?? null;

  const root = await store.createFileNode(projectId, {
    name: "Ingest Smoke Matrix",
    type: "directory",
    scope: "project",
    metadata: { ingestSmoke: true, runStamp },
    createdBy: USER_ID,
  });
  const folderIds = new Map<SampleGroup, string>();
  for (const [group, folderName] of Object.entries(groupFolders) as Array<[SampleGroup, string]>) {
    const folder = await store.createFileNode(projectId, {
      parentId: root.id,
      name: folderName,
      type: "directory",
      scope: "project",
      metadata: { ingestSmoke: true, group, runStamp },
      createdBy: USER_ID,
    });
    folderIds.set(group, folder.id);
  }

  const storageRoot = path.join("projects", projectId, "files", "ingest-smoke");
  await mkdir(resolveApiPath(storageRoot), { recursive: true });

  const samples = await buildSamples();
  const createdSamples: CreatedSample[] = [];

  for (const spec of samples) {
    const { buffer, status: sourceStatus } = await materializeSample(spec);
    const safeName = sanitizeFileName(spec.name);
    const storagePath = path.join(storageRoot, groupFolders[spec.group], safeName);
    await mkdir(path.dirname(resolveApiPath(storagePath)), { recursive: true });
    await writeFile(resolveApiPath(storagePath), buffer);
    const checksum = sha256(buffer);
    const node = await store.createFileNode(projectId, {
      parentId: folderIds.get(spec.group),
      name: spec.name,
      type: "file",
      scope: "project",
      fileType: extOf(spec.name),
      size: buffer.length,
      storagePath,
      metadata: {
        ingestSmoke: true,
        group: spec.group,
        runStamp,
        checksum,
        sourceStatus,
        sourceUrl: spec.sourceUrl,
        sourceLabel: spec.sourceLabel,
        notes: spec.notes,
      },
      createdBy: USER_ID,
    });
    createdSamples.push({ spec, nodeId: node.id, storagePath, size: buffer.length, checksum, sourceStatus });
  }

  for (const sample of createdSamples) {
    try {
      const source = await resolveProjectFileIngestSource(projectId, "file_node", sample.nodeId);
      const result = await generateFileIngestManifest(source);
      sample.ingest = {
        status: result.status,
        family: result.family,
        adapterStatus: result.capability.status,
        parser: result.manifest.summary?.parser,
        issues: result.issues.map((issue) => ({
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
        })),
      };
      await store.updateFileNode(sample.nodeId, {
        metadata: {
          ingestSmoke: true,
          group: sample.spec.group,
          runStamp,
          checksum: sample.checksum,
          sourceStatus: sample.sourceStatus,
          sourceUrl: sample.spec.sourceUrl,
          sourceLabel: sample.spec.sourceLabel,
          notes: sample.spec.notes,
          smokeIngest: sample.ingest,
        },
      });
    } catch (error) {
      sample.ingest = {
        status: "failed",
        family: "unknown",
        issues: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const scheduleCandidates = await getScheduleImportCandidates(projectId);
  const candidatesById = new Map(scheduleCandidates.candidates.map((candidate) => [candidate.sourceId, candidate]));
  for (const sample of createdSamples) {
    const candidate = candidatesById.get(sample.nodeId);
    if (!candidate) continue;
    sample.schedule = {
      provider: candidate.provider,
      status: candidate.status,
      message: candidate.message,
    };
    if (candidate.status === "available") {
      try {
        const result = await importProjectSchedule({
          projectId,
          sourceKind: candidate.sourceKind,
          sourceId: candidate.sourceId,
          mode: "replace",
        });
        sample.schedule.imported = result.imported;
      } catch (error) {
        sample.schedule.error = error instanceof Error ? error.message : String(error);
      }
    }
    const current = await prisma.fileNode.findUnique({ where: { id: sample.nodeId }, select: { metadata: true } });
    await store.updateFileNode(sample.nodeId, {
      metadata: {
        ...((current?.metadata as Record<string, unknown> | null) ?? {}),
        smokeSchedule: sample.schedule,
      },
    });
  }

  const counts = createdSamples.reduce<Record<string, number>>((acc, sample) => {
    const key = `${sample.ingest?.status ?? "not-run"}:${sample.ingest?.family ?? "unknown"}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const scheduleCounts = createdSamples.reduce<Record<string, number>>((acc, sample) => {
    if (!sample.schedule) return acc;
    const key = sample.schedule.status ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const report = {
    generatedAt: new Date().toISOString(),
    projectId,
    quoteId,
    revisionId,
    projectName: created.project.name,
    rootFileNodeId: root.id,
    storageRoot,
    counts,
    scheduleCounts,
    samples: createdSamples.map((sample) => ({
      fileName: sample.spec.name,
      group: sample.spec.group,
      nodeId: sample.nodeId,
      storagePath: sample.storagePath,
      size: sample.size,
      checksum: sample.checksum,
      sourceStatus: sample.sourceStatus,
      sourceUrl: sample.spec.sourceUrl,
      sourceLabel: sample.spec.sourceLabel,
      notes: sample.spec.notes,
      ingest: sample.ingest,
      schedule: sample.schedule,
    })),
  };

  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const reportPath = path.join(storageRoot, "ingest-smoke-report.json");
  await writeFile(resolveApiPath(reportPath), reportText, "utf8");
  const reportStat = await stat(resolveApiPath(reportPath));
  await store.createFileNode(projectId, {
    parentId: root.id,
    name: "ingest-smoke-report.json",
    type: "file",
    scope: "project",
    fileType: "json",
    size: reportStat.size,
    storagePath: reportPath,
    metadata: { ingestSmoke: true, runStamp, report: true },
    createdBy: USER_ID,
  });

  console.log(JSON.stringify({
    projectId,
    quoteId,
    revisionId,
    projectName: created.project.name,
    rootFileNodeId: root.id,
    reportPath,
    totalSamples: createdSamples.length,
    counts,
    scheduleCounts,
    failed: createdSamples
      .filter((sample) => sample.ingest?.status === "failed" || sample.schedule?.error)
      .map((sample) => ({
        fileName: sample.spec.name,
        ingest: sample.ingest,
        schedule: sample.schedule,
      })),
  }, null, 2));
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

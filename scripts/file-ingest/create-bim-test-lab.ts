/**
 * Create / refresh the "BIM Workspace Test Lab" project.
 *
 * A focused test fixture for the takeoff intake surface: real files on disk
 * across the four AI/parser-driven intake types (BIM, 3D Geometry, Site
 * Photos, Spreadsheet), all wired through FileNode + ModelAsset so the
 * intake cards show non-zero counts, the BIM workspace lists real elements
 * (with classification + LOD), and the photo card has photos to populate
 * the count badge.
 *
 * Stable project id so re-runs are idempotent. If the project already
 * exists it gets deleted and recreated cleanly.
 *
 * Run with:
 *   pnpm tsx scripts/file-ingest/create-bim-test-lab.ts
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../../packages/db/src/client.js";
import { PrismaApiStore } from "../../apps/api/src/prisma-store.js";
import { resolveApiPath, sanitizeFileName } from "../../apps/api/src/paths.js";
import { syncProjectModelAssets } from "../../apps/api/src/services/model-service.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const PROJECT_NAME = "BIM Workspace Test Lab";
const ORG_ID = process.env.BIDWRIGHT_SMOKE_ORG_ID || "cmn2a1wzw0001xopqxwctc7xl";
const USER_ID = process.env.BIDWRIGHT_SMOKE_USER_ID || "cmn2a1x0t0005xopqqu596udt";

type FixtureGroup = "bim" | "3d-geometry" | "photos" | "spreadsheets";

interface Fixture {
  group: FixtureGroup;
  name: string;
  content?: Buffer | string;
  copyFrom?: string;
  notes?: string;
}

const GROUP_FOLDERS: Record<FixtureGroup, string> = {
  bim: "01-bim",
  "3d-geometry": "02-3d-geometry",
  photos: "03-photos",
  spreadsheets: "04-spreadsheets",
};

// ── Fixture content generators ──────────────────────────────────────────

/**
 * Real IFC4 file with a Site → Building → Storey hierarchy and a handful
 * of construction elements (walls / slabs / doors / windows / beams /
 * columns / a roof slab) plus IfcRelDefinesByProperties → Pset_VerificationStatus
 * carrying explicit LOD values. Substantial enough that web-ifc will
 * actually extract elements, the IFC→Uniformat heuristic kicks in for
 * each class, and the LOD-from-Pset path lights up.
 *
 * Hand-rolled because importing an external IFC sample would add a network
 * dependency to the seed script.
 */
function makeRichIfc(): string {
  // GlobalId placeholders — IFC requires 22-char base64-like ids; we use
  // distinct stable strings so re-runs produce identical hashes.
  const lines: string[] = [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
    "FILE_NAME('bim-test-lab.ifc','2026-05-10T00:00:00',('Bidwright'),('Bidwright'),'','BidwrightSeed','');",
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    // ── Header / units ───────────────────────────────────────────────
    "#1=IFCPERSON($,'Bidwright',$,$,$,$,$,$);",
    "#2=IFCORGANIZATION($,'Bidwright','BIM Test Lab',$,$);",
    "#3=IFCPERSONANDORGANIZATION(#1,#2,$);",
    "#4=IFCAPPLICATION(#2,'1.0','Bidwright Seed','BIDWRIGHT_SEED');",
    "#5=IFCOWNERHISTORY(#3,#4,$,.ADDED.,$,$,$,1715299200);",
    "#10=IFCCARTESIANPOINT((0.,0.,0.));",
    "#11=IFCDIRECTION((0.,0.,1.));",
    "#12=IFCDIRECTION((1.,0.,0.));",
    "#13=IFCAXIS2PLACEMENT3D(#10,#11,#12);",
    "#14=IFCLOCALPLACEMENT($,#13);",
    "#20=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#13,$);",
    "#30=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
    "#31=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);",
    "#32=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);",
    "#33=IFCUNITASSIGNMENT((#30,#31,#32));",
    "#40=IFCPROJECT('PROJ_BIDWRIGHT_TESTLAB001',#5,'BIM Workspace Test Lab',$,$,$,$,(#20),#33);",
    // ── Spatial structure ─────────────────────────────────────────────
    "#50=IFCSITE('SITE_BIDWRIGHT_TESTLAB001',#5,'Test Site',$,$,#14,$,$,.ELEMENT.,$,$,$,$,$);",
    "#51=IFCRELAGGREGATES('REL_PROJ_SITE_TESTLAB1',#5,$,$,#40,(#50));",
    "#60=IFCBUILDING('BLDG_BIDWRIGHT_TESTLAB1',#5,'Main Building',$,$,#14,$,$,.ELEMENT.,$,$,$);",
    "#61=IFCRELAGGREGATES('REL_SITE_BLDG_TESTLAB1',#5,$,$,#50,(#60));",
    "#70=IFCBUILDINGSTOREY('LVL01_BIDWRIGHT_TESTLAB',#5,'Level 01',$,$,#14,$,$,.ELEMENT.,0.);",
    "#71=IFCBUILDINGSTOREY('LVL02_BIDWRIGHT_TESTLAB',#5,'Level 02',$,$,#14,$,$,.ELEMENT.,3500.);",
    "#72=IFCRELAGGREGATES('REL_BLDG_LVLS_TESTLAB1',#5,$,$,#60,(#70,#71));",
  ];

  // ── Elements ─────────────────────────────────────────────────────────
  // Each entry: id, IFC class, name, GlobalId, expected LOD.
  // GlobalIds must be unique 22-ish-char strings; we pad with the class.
  const elementSpecs: Array<{
    id: number;
    cls: string;
    name: string;
    gid: string;
    lod: "200" | "300" | "350" | "400";
  }> = [
    { id: 100, cls: "IFCWALL",   name: "Exterior CMU Wall — North",       gid: "WALL_NORTH_EXT_TESTLAB", lod: "300" },
    { id: 101, cls: "IFCWALL",   name: "Exterior CMU Wall — South",       gid: "WALL_SOUTH_EXT_TESTLAB", lod: "300" },
    { id: 102, cls: "IFCWALL",   name: "Exterior CMU Wall — East",        gid: "WALL_EAST_EXT_TESTLAB1", lod: "300" },
    { id: 103, cls: "IFCWALL",   name: "Exterior CMU Wall — West",        gid: "WALL_WEST_EXT_TESTLAB1", lod: "300" },
    { id: 104, cls: "IFCWALL",   name: "Interior Partition — Corridor",   gid: "WALL_INT_CORRIDOR_TLB1", lod: "200" },
    { id: 110, cls: "IFCSLAB",   name: "Slab on Grade — Level 01",        gid: "SLAB_SOG_LVL01_TESTLAB", lod: "350" },
    { id: 111, cls: "IFCSLAB",   name: "Roof Slab",                       gid: "SLAB_ROOF_TESTLAB_LAB1", lod: "300" },
    { id: 120, cls: "IFCBEAM",   name: "Steel Beam W12x26 — Bay 1",       gid: "BEAM_W12x26_BAY1_TLAB",  lod: "400" },
    { id: 121, cls: "IFCBEAM",   name: "Steel Beam W12x26 — Bay 2",       gid: "BEAM_W12x26_BAY2_TLAB",  lod: "400" },
    { id: 130, cls: "IFCCOLUMN", name: "HSS 6x6 Column — A1",             gid: "COL_HSS6x6_A1_TLAB001",  lod: "400" },
    { id: 131, cls: "IFCCOLUMN", name: "HSS 6x6 Column — A2",             gid: "COL_HSS6x6_A2_TLAB001",  lod: "400" },
    { id: 132, cls: "IFCCOLUMN", name: "HSS 6x6 Column — B1",             gid: "COL_HSS6x6_B1_TLAB001",  lod: "400" },
    { id: 133, cls: "IFCCOLUMN", name: "HSS 6x6 Column — B2",             gid: "COL_HSS6x6_B2_TLAB001",  lod: "400" },
    { id: 140, cls: "IFCDOOR",   name: "Main Entry Door 3'-0\" x 7'-0\"", gid: "DOOR_MAIN_ENTRY_TLAB01", lod: "350" },
    { id: 141, cls: "IFCDOOR",   name: "Interior Door 3'-0\" x 7'-0\"",   gid: "DOOR_INT_CORR_TLAB001",  lod: "200" },
    { id: 150, cls: "IFCWINDOW", name: "Storefront Window 6x4",           gid: "WIN_STOREFRONT_TLAB001", lod: "300" },
    { id: 151, cls: "IFCWINDOW", name: "Storefront Window 6x4 — Sym",     gid: "WIN_STOREFRONT_TLAB002", lod: "300" },
    { id: 152, cls: "IFCWINDOW", name: "Punched Window 3x4 — South",      gid: "WIN_PUNCHED_S_TLAB001",  lod: "300" },
    { id: 153, cls: "IFCWINDOW", name: "Punched Window 3x4 — North",      gid: "WIN_PUNCHED_N_TLAB001",  lod: "300" },
    { id: 160, cls: "IFCROOF",   name: "Built-Up Membrane Roof",          gid: "ROOF_BUR_TESTLAB001",    lod: "300" },
  ];

  for (const e of elementSpecs) {
    // IFC instance: minimal valid entity (placement + representation set to $).
    // PredefinedType "$" — adapter falls back to class name on extraction.
    lines.push(`#${e.id}=${e.cls}('${e.gid}',#5,'${e.name}',$,$,#14,$,$,$);`);
  }

  // Relate elements to their storey via IfcRelContainedInSpatialStructure.
  // Group by destination storey: Level 01 (#70) gets walls / slab on grade /
  // beams / columns / doors / windows; Level 02 (#71) gets the roof.
  const lvl01Ids = elementSpecs
    .filter((e) => e.id !== 111 && e.id !== 160)
    .map((e) => `#${e.id}`)
    .join(",");
  const lvl02Ids = elementSpecs
    .filter((e) => e.id === 111 || e.id === 160)
    .map((e) => `#${e.id}`)
    .join(",");
  lines.push(`#900=IFCRELCONTAINEDINSPATIALSTRUCTURE('REL_LVL01_CONTAIN_TLAB1',#5,$,$,(${lvl01Ids}),#70);`);
  lines.push(`#901=IFCRELCONTAINEDINSPATIALSTRUCTURE('REL_LVL02_CONTAIN_TLAB1',#5,$,$,(${lvl02Ids}),#71);`);

  // ── Pset_VerificationStatus carrying LOD per element ─────────────────
  // The IFC adapter scans IFCRELDEFINESBYPROPERTIES for psets whose name
  // contains "LOD" / "VerificationStatus" / "Development", so one pset per
  // element with the Pset_VerificationStatus name is what lights up the
  // LOD-from-Pset extraction path.
  let propRefId = 1000;
  let psetId = 2000;
  let relId = 3000;
  for (const e of elementSpecs) {
    const valueRef = propRefId;
    const psetRef = psetId;
    lines.push(`#${valueRef}=IFCPROPERTYSINGLEVALUE('LOD',$,IFCLABEL('${e.lod}'),$);`);
    lines.push(`#${psetRef}=IFCPROPERTYSET('PSET_LOD_${e.id}_TLAB${String(e.id).padStart(3, "0")}',#5,'Pset_VerificationStatus','LOD verification status',(#${valueRef}));`);
    lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('REL_PSET_${e.id}_TLAB${String(e.id).padStart(3, "0")}',#5,$,$,(#${e.id}),#${psetRef});`);
    propRefId += 1;
    psetId += 1;
    relId += 1;
  }

  lines.push("ENDSEC;");
  lines.push("END-ISO-10303-21;");
  lines.push("");
  return lines.join("\n");
}

/**
 * Estimating-style CSV — the spreadsheet intake card surfaces this as a
 * tabular preview source. Construction quantity / cost columns so an
 * estimator browsing the file sees something realistic.
 */
function makeEstimatingCsv(): string {
  const header = [
    "Division",
    "Description",
    "Quantity",
    "UOM",
    "Unit Cost",
    "Total Cost",
    "Markup %",
    "Sell",
    "Source Note",
  ].join(",");
  const rows = [
    ["03 30 00", "Cast-in-place concrete, slab on grade, 4\" thick", "1240", "SF", "8.50", "10540.00", "0.18", "12437.20", "Per arch slab schedule sheet S-101"],
    ["04 22 00", "8\" CMU exterior wall, fully grouted", "2160", "SF", "21.75", "46980.00", "0.18", "55436.40", "Sheet A-201, N/S/E/W walls"],
    ["05 12 00", "Structural steel — W12x26 beam, primed + painted", "82", "LF", "62.40", "5116.80", "0.18", "6037.82", "Bay 1 + Bay 2 framing"],
    ["05 12 00", "Structural steel — HSS 6x6 column, 14 ft", "4", "EA", "740.00", "2960.00", "0.18", "3492.80", "Corners A1/A2/B1/B2"],
    ["08 11 00", "Hollow metal door + frame 3'-0\" x 7'-0\"", "2", "EA", "1320.00", "2640.00", "0.20", "3168.00", "Main entry + corridor interior"],
    ["08 50 00", "Aluminum storefront window 6'x4'", "2", "EA", "2810.00", "5620.00", "0.18", "6631.60", "South elevation"],
    ["08 50 00", "Aluminum punched window 3'x4'", "2", "EA", "1240.00", "2480.00", "0.18", "2926.40", "North + south punched openings"],
    ["07 50 00", "Built-up membrane roofing, 4-ply", "1240", "SF", "9.85", "12214.00", "0.18", "14412.52", "Full roof deck per A-501"],
    ["09 21 16", "Gypsum board partition — corridor, 5/8\" both sides on 3-5/8\" metal stud", "640", "SF", "12.30", "7872.00", "0.18", "9288.96", "Interior corridor partition"],
    ["09 91 23", "Interior paint — primer + 2 coats latex", "2800", "SF", "1.95", "5460.00", "0.18", "6442.80", "All interior wall + ceiling finishes"],
  ];
  return [header, ...rows.map((r) => r.map((c) => (/[,\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))].join("\n");
}

/**
 * Minimal valid 1x1 JPEG — single grey pixel. Browsers and vision APIs
 * accept it as a real image even though it carries no information. Used
 * to populate the on-card photo count for testing the UI; estimators
 * upload real photos through the SitePhotoIntake drag-drop at runtime.
 */
const PLACEHOLDER_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVEAEBAAAAAAAAAAAAAAAAAAAAAf/aAAwDAQACEAMQAAABo//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//Z",
  "base64",
);

/**
 * Minimal valid 1x1 PNG — single pixel. Used like the JPEG above.
 */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

// ── Helpers ──────────────────────────────────────────────────────────────

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function extOf(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

async function loadCopy(spec: Fixture): Promise<Buffer> {
  if (spec.copyFrom) {
    const sourcePath = path.isAbsolute(spec.copyFrom) ? spec.copyFrom : path.join(repoRoot, spec.copyFrom);
    return readFile(sourcePath);
  }
  if (Buffer.isBuffer(spec.content)) return spec.content;
  if (typeof spec.content === "string") return Buffer.from(spec.content, "utf8");
  throw new Error(`Fixture "${spec.name}" has neither content nor copyFrom`);
}

function buildFixtures(): Fixture[] {
  return [
    // ── BIM ────────────────────────────────────────────────────────────
    { group: "bim", name: "bim-test-lab.ifc", content: makeRichIfc(), notes: "Hand-rolled IFC4 — site/building/2 storeys, 20 elements (walls/slabs/beams/columns/doors/windows/roof) with Pset_VerificationStatus LOD per element." },

    // ── 3D Geometry (mesh + parametric, no element semantics) ─────────
    {
      group: "3d-geometry",
      name: "rounded-cube.step",
      copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/rounded-cube/rounded-cube.step",
      notes: "OCCT-shipped rounded cube STEP for parametric solid intake.",
    },
    {
      group: "3d-geometry",
      name: "cube-10x10.stl",
      copyFrom: "node_modules/.pnpm/occt-import-js@0.0.23/node_modules/occt-import-js/test/testfiles/cube-10x10mm/Cube 10x10.stl",
      notes: "OCCT-shipped 10mm cube STL for mesh-only intake.",
    },
    {
      group: "3d-geometry",
      name: "triangle.obj",
      content: "o test_triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\ng face\nf 1 2 3\n",
      notes: "Synthetic single-triangle OBJ — smallest valid mesh.",
    },

    // ── Site Photos ──────────────────────────────────────────────────
    { group: "photos", name: "site-entry.jpg",       content: PLACEHOLDER_JPEG, notes: "Placeholder 1x1 JPEG; replace with a real photo to exercise the AI BOM flow." },
    { group: "photos", name: "north-wall.jpg",       content: PLACEHOLDER_JPEG, notes: "Placeholder 1x1 JPEG." },
    { group: "photos", name: "interior-corridor.jpg", content: PLACEHOLDER_JPEG, notes: "Placeholder 1x1 JPEG." },
    { group: "photos", name: "roof-deck.png",         content: PLACEHOLDER_PNG,  notes: "Placeholder 1x1 PNG." },
    { group: "photos", name: "storefront-glazing.jpg", content: PLACEHOLDER_JPEG, notes: "Placeholder 1x1 JPEG." },

    // ── Spreadsheets ─────────────────────────────────────────────────
    { group: "spreadsheets", name: "estimating-template.csv", content: makeEstimatingCsv(), notes: "Real construction estimating CSV — Division/Description/Qty/UOM/cost/markup/sell columns; 10 rows across concrete/CMU/steel/doors/windows/roofing/finishes." },
  ];
}

// ── Main ─────────────────────────────────────────────────────────────────

async function deleteExistingByName(name: string) {
  // createProject ignores caller-supplied ids, so we dedupe by name. Cascade
  // delete handles all dependents (FileNode, ModelAsset, Quote, etc).
  const existing = await prisma.project.findMany({
    where: { organizationId: ORG_ID, name },
    select: { id: true },
  });
  if (existing.length === 0) return;
  await prisma.project.deleteMany({ where: { id: { in: existing.map((p) => p.id) } } });
  console.log(`  · removed ${existing.length} prior copy(s).`);
}

async function main() {
  const store = new PrismaApiStore(prisma, ORG_ID);
  store.setUserId(USER_ID);

  console.log(`[bim-test-lab] Resetting "${PROJECT_NAME}" (if present)…`);
  await deleteExistingByName(PROJECT_NAME);

  console.log("[bim-test-lab] Creating project…");
  const created = await store.createProject({
    name: PROJECT_NAME,
    clientName: "BidWright QA",
    location: "Local Test Lab",
    packageName: "BIM Intake Validation",
    scope:
      "Real fixtures across the four AI/parser-driven takeoff intake types — BIM (rich IFC4 with PSet LODs), 3D Geometry (STEP/STL/OBJ), Site Photos, and Spreadsheet. Use this project to validate the intake cards, the BIM workspace element table, and the Site Photo BOM flow.",
    summary:
      "Dedicated test project for the BIM + intake surface. Files are regenerated from source so every run is identical and the data lines up with intake-card counts.",
    creationMode: "manual",
  } as any);
  const projectId = created.project.id;

  console.log("[bim-test-lab] Creating folder tree…");
  const root = await store.createFileNode(projectId, {
    name: "Test Fixtures",
    type: "directory",
    scope: "project",
    metadata: { bimTestLab: true },
    createdBy: USER_ID,
  } as any);
  const folderIds = new Map<FixtureGroup, string>();
  for (const [group, folderName] of Object.entries(GROUP_FOLDERS) as Array<[FixtureGroup, string]>) {
    const folder = await store.createFileNode(projectId, {
      parentId: root.id,
      name: folderName,
      type: "directory",
      scope: "project",
      metadata: { bimTestLab: true, group },
      createdBy: USER_ID,
    } as any);
    folderIds.set(group, folder.id);
  }

  console.log("[bim-test-lab] Writing fixtures + creating FileNodes…");
  const storageRoot = path.join("projects", projectId, "files", "bim-test-lab");
  await mkdir(resolveApiPath(storageRoot), { recursive: true });

  const fixtures = buildFixtures();
  for (const spec of fixtures) {
    const buffer = await loadCopy(spec);
    const safeName = sanitizeFileName(spec.name);
    const storagePath = path.join(storageRoot, GROUP_FOLDERS[spec.group], safeName);
    await mkdir(path.dirname(resolveApiPath(storagePath)), { recursive: true });
    await writeFile(resolveApiPath(storagePath), buffer);
    const checksum = sha256(buffer);
    await store.createFileNode(projectId, {
      parentId: folderIds.get(spec.group),
      name: spec.name,
      type: "file",
      scope: "project",
      fileType: extOf(spec.name),
      size: buffer.length,
      storagePath,
      metadata: {
        bimTestLab: true,
        group: spec.group,
        checksum,
        notes: spec.notes,
      },
      createdBy: USER_ID,
    } as any);
    console.log(`  · ${spec.group}/${spec.name}  ${(buffer.length / 1024).toFixed(1)} KB`);
  }

  // ── Run model ingest so BIM + 3D files turn into ModelAsset + element rows ──
  console.log("[bim-test-lab] Running model ingest (extracts elements + classification + LOD)…");
  try {
    const sync = await syncProjectModelAssets(projectId);
    console.log(`  · ingested ${sync.syncedIds.length} model asset(s) from ${sync.sourceCount} source(s).`);
  } catch (err) {
    console.warn(`  · model ingest failed: ${(err as Error).message}`);
  }

  // Spot-check counts so the operator sees confirmation.
  const fileNodeCount = await prisma.fileNode.count({ where: { projectId } });
  const modelAssetCount = await prisma.modelAsset.count({ where: { projectId } });
  const elementCount = await prisma.modelElement.count({ where: { model: { projectId } } });

  console.log("");
  console.log("✓ BIM Workspace Test Lab ready.");
  console.log(`  project id   : ${projectId}`);
  console.log(`  file nodes   : ${fileNodeCount}`);
  console.log(`  model assets : ${modelAssetCount}`);
  console.log(`  model elements: ${elementCount}`);
  console.log("");
  console.log("Open the project in the workspace and click through each intake card —");
  console.log("counts should be > 0 for BIM, 3D Geometry, Photos, and Spreadsheets.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

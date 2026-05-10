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

type FixtureGroup = "bim" | "dwg" | "3d-geometry" | "photos" | "spreadsheets";

interface Fixture {
  group: FixtureGroup;
  name: string;
  /** Inline-generated content. Used for the spreadsheet, photo placeholders,
   *  and the synthetic OBJ. Mutually exclusive with copyFrom / downloadUrl. */
  content?: Buffer | string;
  /** Relative path under repoRoot to copy from. Used for occt-shipped STEP/
   *  STL fixtures already in node_modules. */
  copyFrom?: string;
  /** Full URL to download from at seed time. Used for the real IFC + DWG
   *  samples so the test data is authentic, not hand-rolled. */
  downloadUrl?: string;
  /** Where the file came from — printed in metadata so the audit trail is
   *  clear and the user can attribute / re-source manually if a link rots. */
  sourceUrl?: string;
  sourceLabel?: string;
  notes?: string;
}

const GROUP_FOLDERS: Record<FixtureGroup, string> = {
  bim: "01-bim",
  dwg: "02-dwg",
  "3d-geometry": "03-3d-geometry",
  photos: "04-photos",
  spreadsheets: "05-spreadsheets",
};

// ── Fixture content generators ──────────────────────────────────────────

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

/**
 * Fetch a fixture from a public URL. Used for the real IFC and DWG samples
 * — we deliberately do NOT bundle them in the repo so the test data stays
 * a thin pointer to authoritative upstream sources, and so the script
 * documents the provenance through the `sourceUrl` field.
 *
 * 30 second timeout per file; throws with a clear error if the source is
 * unreachable so the operator knows to retry on a connection.
 */
async function downloadBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCopy(spec: Fixture): Promise<Buffer> {
  if (spec.copyFrom) {
    const sourcePath = path.isAbsolute(spec.copyFrom) ? spec.copyFrom : path.join(repoRoot, spec.copyFrom);
    return readFile(sourcePath);
  }
  if (spec.downloadUrl) {
    try {
      return await downloadBuffer(spec.downloadUrl);
    } catch (err) {
      throw new Error(
        `Failed to download "${spec.name}" from ${spec.downloadUrl}: ${(err as Error).message}. ` +
          "Re-run when the source is reachable.",
      );
    }
  }
  if (Buffer.isBuffer(spec.content)) return spec.content;
  if (typeof spec.content === "string") return Buffer.from(spec.content, "utf8");
  throw new Error(`Fixture "${spec.name}" has neither content, copyFrom, nor downloadUrl`);
}

function buildFixtures(): Fixture[] {
  return [
    // ── BIM ────────────────────────────────────────────────────────────
    // NIST Duplex Apartment Architecture model — the de-facto reference
    // IFC2x3 building used across IFC tooling for testing. ~2.4 MB; carries
    // walls, slabs, doors, windows, spaces, stairs, beams, columns, etc.
    // with proper site/building/storey hierarchy.
    {
      group: "bim",
      name: "Duplex-Architecture.ifc",
      downloadUrl: "https://raw.githubusercontent.com/youshengCode/IfcSampleFiles/main/Ifc2x3_Duplex_Architecture.ifc",
      sourceUrl: "https://github.com/youshengCode/IfcSampleFiles",
      sourceLabel: "NIST Duplex Apartment — Architecture (IFC2x3)",
      notes: "Industry-standard reference BIM model. Drives the BIM intake card + element table + classification heuristic at realistic scale.",
    },

    // ── DWG ────────────────────────────────────────────────────────────
    // Real DWG — small AutoCAD-saved line drawing. The DWG intake card
    // counts this and the DXF/DWG takeoff surface opens it; depending on
    // adapter setup (Autodesk APS) extraction may be limited locally.
    {
      group: "dwg",
      name: "line-2000.dwg",
      downloadUrl: "https://raw.githubusercontent.com/nextgis/dwg_samples/master/line_2000.dwg",
      sourceUrl: "https://github.com/nextgis/dwg_samples",
      sourceLabel: "nextgis/dwg_samples — line_2000.dwg",
      notes: "Public DWG fixture for exercising the DWG intake / takeoff surface.",
    },

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
        sourceUrl: spec.sourceUrl,
        sourceLabel: spec.sourceLabel,
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

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

interface LabPhaseSpec {
  id: string;
  number: string;
  name: string;
  description: string;
  order: number;
  startDate: string;
  endDate: string;
  color: string;
}

interface LabScheduleTaskSpec {
  id: string;
  phaseId: string;
  parentTaskId?: string | null;
  outlineLevel: number;
  name: string;
  description: string;
  taskType: "summary" | "task" | "milestone";
  status: "not_started" | "in_progress" | "complete";
  startDate: string;
  endDate: string;
  duration: number;
  progress: number;
  assignee: string;
  order: number;
  baselineStart?: string;
  baselineEnd?: string;
  deadlineDate?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
}

interface LabScheduleResourceSpec {
  id: string;
  name: string;
  role: string;
  kind: "labor" | "equipment" | "subcontractor" | "material";
  color: string;
  defaultUnits: number;
  capacityPerDay: number;
  costRate: number;
}

interface LabScheduleDependencySpec {
  id: string;
  predecessorId: string;
  successorId: string;
  type: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
}

interface LabScheduleAssignmentSpec {
  id: string;
  taskId: string;
  resourceId: string;
  units: number;
  role: string;
}

const GROUP_FOLDERS: Record<FixtureGroup, string> = {
  bim: "01-bim",
  dwg: "02-dwg",
  "3d-geometry": "03-3d-geometry",
  photos: "04-photos",
  spreadsheets: "05-spreadsheets",
};

const LAB_SCHEDULE_CALENDAR_ID = "cal-bim-lab-standard";
const LAB_SCHEDULE_BASELINE_ID = "baseline-bim-lab-target";

const LAB_PHASES: LabPhaseSpec[] = [
  {
    id: "phase-bim-lab-010",
    number: "01",
    name: "Intake Setup",
    description: "Fixture intake, model sync, and first-pass BIM review.",
    order: 1,
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    color: "#2563eb",
  },
  {
    id: "phase-bim-lab-020",
    number: "02",
    name: "Quantity Validation",
    description: "Cross-check model, drawing, spreadsheet, and photo evidence.",
    order: 2,
    startDate: "2026-06-08",
    endDate: "2026-06-12",
    color: "#16a34a",
  },
  {
    id: "phase-bim-lab-030",
    number: "03",
    name: "Evidence Reconciliation",
    description: "Resolve quantity, classification, and source-link mismatches.",
    order: 3,
    startDate: "2026-06-15",
    endDate: "2026-06-19",
    color: "#f59e0b",
  },
  {
    id: "phase-bim-lab-040",
    number: "04",
    name: "Handoff & QA",
    description: "Estimator handoff, QA checkpoint, and lab reset notes.",
    order: 4,
    startDate: "2026-06-22",
    endDate: "2026-06-26",
    color: "#dc2626",
  },
];

const LAB_SCHEDULE_RESOURCES: LabScheduleResourceSpec[] = [
  {
    id: "res-bim-lab-coordinator",
    name: "BIM coordinator",
    role: "Coordination",
    kind: "labor",
    color: "#2563eb",
    defaultUnits: 1,
    capacityPerDay: 1,
    costRate: 118,
  },
  {
    id: "res-bim-lab-estimator",
    name: "Estimator",
    role: "Takeoff",
    kind: "labor",
    color: "#16a34a",
    defaultUnits: 1,
    capacityPerDay: 1,
    costRate: 105,
  },
  {
    id: "res-bim-lab-qa",
    name: "QA reviewer",
    role: "Review",
    kind: "labor",
    color: "#dc2626",
    defaultUnits: 0.5,
    capacityPerDay: 1,
    costRate: 126,
  },
  {
    id: "res-bim-lab-field",
    name: "Field reviewer",
    role: "Photos",
    kind: "labor",
    color: "#ea580c",
    defaultUnits: 0.5,
    capacityPerDay: 1,
    costRate: 94,
  },
  {
    id: "res-bim-lab-processor",
    name: "Model processor",
    role: "Ingest",
    kind: "equipment",
    color: "#7c3aed",
    defaultUnits: 1,
    capacityPerDay: 1,
    costRate: 35,
  },
];

const LAB_SCHEDULE_TASKS: LabScheduleTaskSpec[] = [
  {
    id: "task-bim-lab-010",
    phaseId: "phase-bim-lab-010",
    outlineLevel: 0,
    name: "BIM coordination and intake",
    description: "Summary task for fixture intake, model ingest, and first-pass BIM workspace checks.",
    taskType: "summary",
    status: "in_progress",
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    duration: 5,
    progress: 0.45,
    assignee: "BIM coordinator",
    order: 1,
  },
  {
    id: "task-bim-lab-011",
    phaseId: "phase-bim-lab-010",
    parentTaskId: "task-bim-lab-010",
    outlineLevel: 1,
    name: "Kickoff with estimating, BIM, and takeoff owners",
    description: "Confirm fixture scope and acceptance criteria for the lab run.",
    taskType: "milestone",
    status: "complete",
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    duration: 0,
    progress: 1,
    assignee: "BIM coordinator",
    order: 2,
    actualStart: "2026-06-01",
    actualEnd: "2026-06-01",
  },
  {
    id: "task-bim-lab-012",
    phaseId: "phase-bim-lab-010",
    parentTaskId: "task-bim-lab-010",
    outlineLevel: 1,
    name: "Load Duplex IFC and sync model assets",
    description: "Run model ingest and confirm assets, elements, classifications, and LOD rows populate.",
    taskType: "task",
    status: "complete",
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    duration: 2,
    progress: 1,
    assignee: "Model processor",
    order: 3,
    actualStart: "2026-06-01",
    actualEnd: "2026-06-02",
  },
  {
    id: "task-bim-lab-013",
    phaseId: "phase-bim-lab-010",
    parentTaskId: "task-bim-lab-010",
    outlineLevel: 1,
    name: "Review model tree, spaces, and element classifications",
    description: "Exercise the BIM workspace tree and classification panes with a moderately long task title.",
    taskType: "task",
    status: "in_progress",
    startDate: "2026-06-02",
    endDate: "2026-06-04",
    duration: 3,
    progress: 0.65,
    assignee: "BIM coordinator",
    order: 4,
  },
  {
    id: "task-bim-lab-014",
    phaseId: "phase-bim-lab-010",
    parentTaskId: "task-bim-lab-010",
    outlineLevel: 1,
    name: "Publish intake-card QA notes for BIM/3D/photo/spreadsheet",
    description: "Capture cross-card QA notes and source provenance for downstream review.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-04",
    endDate: "2026-06-05",
    duration: 2,
    progress: 0,
    assignee: "QA reviewer",
    order: 5,
    baselineStart: "2026-06-03",
    baselineEnd: "2026-06-04",
  },
  {
    id: "task-bim-lab-020",
    phaseId: "phase-bim-lab-020",
    outlineLevel: 0,
    name: "Model quantity validation",
    description: "Summary task for cross-source quantity validation.",
    taskType: "summary",
    status: "not_started",
    startDate: "2026-06-08",
    endDate: "2026-06-12",
    duration: 5,
    progress: 0,
    assignee: "Estimator",
    order: 6,
  },
  {
    id: "task-bim-lab-021",
    phaseId: "phase-bim-lab-020",
    parentTaskId: "task-bim-lab-020",
    outlineLevel: 1,
    name: "Spot-check walls, slabs, doors, and windows against takeoff rules",
    description: "Use element classifications to verify major model quantity buckets.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-08",
    endDate: "2026-06-10",
    duration: 3,
    progress: 0,
    assignee: "Estimator",
    order: 7,
    baselineStart: "2026-06-08",
    baselineEnd: "2026-06-09",
  },
  {
    id: "task-bim-lab-022",
    phaseId: "phase-bim-lab-020",
    parentTaskId: "task-bim-lab-020",
    outlineLevel: 1,
    name: "Review DXF wall, door, and window layers in drawing takeoff",
    description: "Confirm the synthetic room DXF opens and the layer controls have usable data.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-09",
    endDate: "2026-06-10",
    duration: 2,
    progress: 0,
    assignee: "Estimator",
    order: 8,
  },
  {
    id: "task-bim-lab-023",
    phaseId: "phase-bim-lab-020",
    parentTaskId: "task-bim-lab-020",
    outlineLevel: 1,
    name: "Compare CSV allowance rows to modeled quantities",
    description: "Check spreadsheet quantities and markup rows against the model-derived review set.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-10",
    endDate: "2026-06-11",
    duration: 2,
    progress: 0,
    assignee: "Estimator",
    order: 9,
  },
  {
    id: "task-bim-lab-024",
    phaseId: "phase-bim-lab-020",
    parentTaskId: "task-bim-lab-020",
    outlineLevel: 1,
    name: "Site photo BOM dry run and exception log",
    description: "Exercise the photo intake count and expected exception handling with placeholder images.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-11",
    endDate: "2026-06-12",
    duration: 2,
    progress: 0,
    assignee: "Field reviewer",
    order: 10,
  },
  {
    id: "task-bim-lab-030",
    phaseId: "phase-bim-lab-030",
    outlineLevel: 0,
    name: "Evidence reconciliation",
    description: "Summary task for resolving mismatches between BIM, DXF, spreadsheet, and photo evidence.",
    taskType: "summary",
    status: "not_started",
    startDate: "2026-06-15",
    endDate: "2026-06-19",
    duration: 5,
    progress: 0,
    assignee: "QA reviewer",
    order: 11,
  },
  {
    id: "task-bim-lab-031",
    phaseId: "phase-bim-lab-030",
    parentTaskId: "task-bim-lab-030",
    outlineLevel: 1,
    name: "Reconcile BIM/DXF/spreadsheet evidence links",
    description: "Attach a test review narrative to each source family and compare quantities.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-15",
    endDate: "2026-06-17",
    duration: 3,
    progress: 0,
    assignee: "QA reviewer",
    order: 12,
    baselineStart: "2026-06-15",
    baselineEnd: "2026-06-16",
  },
  {
    id: "task-bim-lab-032",
    phaseId: "phase-bim-lab-030",
    parentTaskId: "task-bim-lab-030",
    outlineLevel: 1,
    name: "Resolve mismatched classifications and units",
    description: "Close the loop on mismatches found during source reconciliation.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-17",
    endDate: "2026-06-18",
    duration: 2,
    progress: 0,
    assignee: "BIM coordinator",
    order: 13,
  },
  {
    id: "task-bim-lab-033",
    phaseId: "phase-bim-lab-030",
    parentTaskId: "task-bim-lab-030",
    outlineLevel: 1,
    name: "QA checkpoint: estimator signoff",
    description: "Milestone for estimator acceptance of BIM lab schedule and source evidence.",
    taskType: "milestone",
    status: "not_started",
    startDate: "2026-06-19",
    endDate: "2026-06-19",
    duration: 0,
    progress: 0,
    assignee: "QA reviewer",
    order: 14,
    deadlineDate: "2026-06-19",
  },
  {
    id: "task-bim-lab-040",
    phaseId: "phase-bim-lab-040",
    outlineLevel: 0,
    name: "Handoff and closeout",
    description: "Summary task for estimator handoff, QA notes, and closeout.",
    taskType: "summary",
    status: "not_started",
    startDate: "2026-06-22",
    endDate: "2026-06-26",
    duration: 5,
    progress: 0,
    assignee: "Estimator",
    order: 15,
  },
  {
    id: "task-bim-lab-041",
    phaseId: "phase-bim-lab-040",
    parentTaskId: "task-bim-lab-040",
    outlineLevel: 1,
    name: "Package estimate handoff with fixture provenance",
    description: "Prepare the schedule, model counts, file list, and source notes for review.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-22",
    endDate: "2026-06-24",
    duration: 3,
    progress: 0,
    assignee: "Estimator",
    order: 16,
    baselineStart: "2026-06-22",
    baselineEnd: "2026-06-23",
  },
  {
    id: "task-bim-lab-042",
    phaseId: "phase-bim-lab-040",
    parentTaskId: "task-bim-lab-040",
    outlineLevel: 1,
    name: "Archive lab findings and reset checklist",
    description: "Capture expected counts, fixture provenance, and reset guidance.",
    taskType: "task",
    status: "not_started",
    startDate: "2026-06-24",
    endDate: "2026-06-25",
    duration: 2,
    progress: 0,
    assignee: "QA reviewer",
    order: 17,
  },
  {
    id: "task-bim-lab-043",
    phaseId: "phase-bim-lab-040",
    parentTaskId: "task-bim-lab-040",
    outlineLevel: 1,
    name: "Close BIM lab smoke run",
    description: "Final schedule milestone for the seeded BIM workspace lab.",
    taskType: "milestone",
    status: "not_started",
    startDate: "2026-06-26",
    endDate: "2026-06-26",
    duration: 0,
    progress: 0,
    assignee: "BIM coordinator",
    order: 18,
    deadlineDate: "2026-06-26",
  },
];

const LAB_SCHEDULE_DEPENDENCIES: LabScheduleDependencySpec[] = [
  { id: "dep-bim-lab-001", predecessorId: "task-bim-lab-011", successorId: "task-bim-lab-012", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-002", predecessorId: "task-bim-lab-012", successorId: "task-bim-lab-013", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-003", predecessorId: "task-bim-lab-013", successorId: "task-bim-lab-014", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-004", predecessorId: "task-bim-lab-014", successorId: "task-bim-lab-021", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-005", predecessorId: "task-bim-lab-021", successorId: "task-bim-lab-022", type: "SS", lagDays: 1 },
  { id: "dep-bim-lab-006", predecessorId: "task-bim-lab-022", successorId: "task-bim-lab-023", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-007", predecessorId: "task-bim-lab-023", successorId: "task-bim-lab-024", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-008", predecessorId: "task-bim-lab-024", successorId: "task-bim-lab-031", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-009", predecessorId: "task-bim-lab-031", successorId: "task-bim-lab-032", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-010", predecessorId: "task-bim-lab-032", successorId: "task-bim-lab-033", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-011", predecessorId: "task-bim-lab-033", successorId: "task-bim-lab-041", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-012", predecessorId: "task-bim-lab-041", successorId: "task-bim-lab-042", type: "FS", lagDays: 0 },
  { id: "dep-bim-lab-013", predecessorId: "task-bim-lab-042", successorId: "task-bim-lab-043", type: "FS", lagDays: 0 },
];

const LAB_SCHEDULE_ASSIGNMENTS: LabScheduleAssignmentSpec[] = [
  { id: "asg-bim-lab-011a", taskId: "task-bim-lab-011", resourceId: "res-bim-lab-coordinator", units: 0.5, role: "Kickoff lead" },
  { id: "asg-bim-lab-011b", taskId: "task-bim-lab-011", resourceId: "res-bim-lab-estimator", units: 0.5, role: "Estimator owner" },
  { id: "asg-bim-lab-012a", taskId: "task-bim-lab-012", resourceId: "res-bim-lab-processor", units: 1, role: "Model ingest" },
  { id: "asg-bim-lab-012b", taskId: "task-bim-lab-012", resourceId: "res-bim-lab-coordinator", units: 0.5, role: "Ingest review" },
  { id: "asg-bim-lab-013a", taskId: "task-bim-lab-013", resourceId: "res-bim-lab-coordinator", units: 1, role: "Classification review" },
  { id: "asg-bim-lab-013b", taskId: "task-bim-lab-013", resourceId: "res-bim-lab-qa", units: 0.35, role: "QA spot-check" },
  { id: "asg-bim-lab-014a", taskId: "task-bim-lab-014", resourceId: "res-bim-lab-qa", units: 0.5, role: "QA notes" },
  { id: "asg-bim-lab-021a", taskId: "task-bim-lab-021", resourceId: "res-bim-lab-estimator", units: 1, role: "Quantity check" },
  { id: "asg-bim-lab-021b", taskId: "task-bim-lab-021", resourceId: "res-bim-lab-coordinator", units: 0.5, role: "Model support" },
  { id: "asg-bim-lab-022a", taskId: "task-bim-lab-022", resourceId: "res-bim-lab-estimator", units: 0.75, role: "Drawing review" },
  { id: "asg-bim-lab-023a", taskId: "task-bim-lab-023", resourceId: "res-bim-lab-estimator", units: 0.75, role: "Spreadsheet compare" },
  { id: "asg-bim-lab-024a", taskId: "task-bim-lab-024", resourceId: "res-bim-lab-field", units: 0.5, role: "Photo review" },
  { id: "asg-bim-lab-024b", taskId: "task-bim-lab-024", resourceId: "res-bim-lab-estimator", units: 0.25, role: "BOM review" },
  { id: "asg-bim-lab-031a", taskId: "task-bim-lab-031", resourceId: "res-bim-lab-qa", units: 0.75, role: "Evidence owner" },
  { id: "asg-bim-lab-031b", taskId: "task-bim-lab-031", resourceId: "res-bim-lab-estimator", units: 0.5, role: "Quantity owner" },
  { id: "asg-bim-lab-031c", taskId: "task-bim-lab-031", resourceId: "res-bim-lab-coordinator", units: 0.5, role: "Model owner" },
  { id: "asg-bim-lab-032a", taskId: "task-bim-lab-032", resourceId: "res-bim-lab-coordinator", units: 0.75, role: "Classification fixes" },
  { id: "asg-bim-lab-033a", taskId: "task-bim-lab-033", resourceId: "res-bim-lab-qa", units: 0.5, role: "Checkpoint" },
  { id: "asg-bim-lab-041a", taskId: "task-bim-lab-041", resourceId: "res-bim-lab-estimator", units: 1, role: "Handoff package" },
  { id: "asg-bim-lab-041b", taskId: "task-bim-lab-041", resourceId: "res-bim-lab-qa", units: 0.5, role: "Handoff review" },
  { id: "asg-bim-lab-042a", taskId: "task-bim-lab-042", resourceId: "res-bim-lab-qa", units: 0.5, role: "Archive notes" },
  { id: "asg-bim-lab-043a", taskId: "task-bim-lab-043", resourceId: "res-bim-lab-coordinator", units: 0.25, role: "Closeout" },
];

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
 * Synthetic ASCII DXF — small but real DXF (R2010) the server-side parser
 * can ingest without an external converter. Drives the DWG intake card and
 * the DWG/DXF takeoff surface end-to-end on a fresh checkout, even when
 * BIDWRIGHT_DWG_CONVERTER_CMD isn't set. The geometry is a 12 m x 8 m
 * room outline with a 0.9 m door arc and a 1.8 m window, on three named
 * layers (WALL / DOOR / WINDOW) so the layer-visibility popover has
 * something interesting to filter.
 */
function makeSyntheticDxf(): string {
  const pairs: Array<[number, string]> = [];
  const push = (code: number, value: string | number) => pairs.push([code, String(value)]);

  // ── HEADER ──
  push(0, "SECTION");
  push(2, "HEADER");
  push(9, "$ACADVER");
  push(1, "AC1024");
  push(9, "$INSUNITS");
  push(70, 6); // 6 = meters
  push(0, "ENDSEC");

  // ── TABLES (LAYER table only) ──
  push(0, "SECTION");
  push(2, "TABLES");
  push(0, "TABLE");
  push(2, "LAYER");
  for (const layer of [
    { name: "WALL", color: 7 },
    { name: "DOOR", color: 3 },
    { name: "WINDOW", color: 5 },
  ]) {
    push(0, "LAYER");
    push(2, layer.name);
    push(70, 0);
    push(62, layer.color);
    push(6, "CONTINUOUS");
  }
  push(0, "ENDTAB");
  push(0, "ENDSEC");

  // ── ENTITIES ──
  push(0, "SECTION");
  push(2, "ENTITIES");
  // Room outline — four walls.
  const corners = [
    [0, 0],
    [12, 0],
    [12, 8],
    [0, 8],
  ];
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % corners.length];
    push(0, "LINE");
    push(8, "WALL");
    push(10, x1);
    push(20, y1);
    push(11, x2);
    push(21, y2);
  }
  // Door arc on south wall.
  push(0, "ARC");
  push(8, "DOOR");
  push(10, 5.4);
  push(20, 0);
  push(40, 0.9);
  push(50, 0); // start angle
  push(51, 90); // end angle
  // Window on north wall.
  push(0, "LINE");
  push(8, "WINDOW");
  push(10, 4);
  push(20, 8);
  push(11, 5.8);
  push(21, 8);
  push(0, "ENDSEC");

  push(0, "EOF");

  // DXF uses CRLF historically; LF works fine with our parser but CRLF
  // matches what AutoCAD emits.
  return pairs.map(([code, value]) => `${String(code).padStart(3, " ")}\n${value}`).join("\r\n") + "\r\n";
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

    // ── DWG / DXF ──────────────────────────────────────────────────────
    // The ASCII DXF is the headline fixture for the DWG card — it parses
    // directly without an external converter, so the DWG/DXF takeoff
    // surface is exercisable end-to-end on a fresh checkout.
    {
      group: "dwg",
      name: "test-room.dxf",
      content: makeSyntheticDxf(),
      sourceLabel: "Synthetic 12 m x 8 m room (WALL / DOOR / WINDOW layers)",
      notes: "ASCII DXF — opens directly in the DWG/DXF takeoff surface, no converter needed.",
    },
    // Real binary DWG kept alongside for testing the converter integration
    // path. On a stock install with no BIDWRIGHT_DWG_CONVERTER_CMD it will
    // surface a friendly error pointing at the DXF above.
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

async function seedTestSchedule(projectId: string, revisionId: string) {
  const now = new Date();
  const scopedId = (id: string) => `${id}-${projectId}`;
  const calendarId = scopedId(LAB_SCHEDULE_CALENDAR_ID);
  const baselineId = scopedId(LAB_SCHEDULE_BASELINE_ID);
  const topLevelTasks = LAB_SCHEDULE_TASKS.filter((task) => !task.parentTaskId);
  const childTasks = LAB_SCHEDULE_TASKS.filter((task) => task.parentTaskId);
  const taskData = (task: LabScheduleTaskSpec) => ({
    id: scopedId(task.id),
    projectId,
    revisionId,
    phaseId: scopedId(task.phaseId),
    calendarId,
    parentTaskId: task.parentTaskId ? scopedId(task.parentTaskId) : null,
    outlineLevel: task.outlineLevel,
    name: task.name,
    description: task.description,
    taskType: task.taskType,
    status: task.status,
    startDate: task.startDate,
    endDate: task.endDate,
    duration: task.duration,
    progress: task.progress,
    assignee: task.assignee,
    order: task.order,
    constraintType: "asap",
    constraintDate: null,
    deadlineDate: task.deadlineDate ?? null,
    actualStart: task.actualStart ?? null,
    actualEnd: task.actualEnd ?? null,
    baselineStart: task.baselineStart ?? task.startDate,
    baselineEnd: task.baselineEnd ?? task.endDate,
    createdAt: now,
    updatedAt: now,
  });

  await prisma.$transaction(async (tx) => {
    await tx.quoteRevision.update({
      where: { id: revisionId },
      data: {
        dateDue: "2026-06-30",
        dateWorkStart: "2026-06-01",
        dateWorkEnd: "2026-06-26",
        updatedAt: now,
      },
    });

    await tx.phase.createMany({
      data: LAB_PHASES.map((phase) => ({
        id: scopedId(phase.id),
        revisionId,
        parentId: null,
        number: phase.number,
        name: phase.name,
        description: phase.description,
        order: phase.order,
        startDate: phase.startDate,
        endDate: phase.endDate,
        color: phase.color,
      })),
    });

    await tx.scheduleCalendar.create({
      data: {
        id: calendarId,
        projectId,
        revisionId,
        name: "BIM lab 5-day",
        description: "Seeded Monday-Friday calendar for the BIM workspace test schedule.",
        isDefault: true,
        workingDays: {
          mon: true,
          tue: true,
          wed: true,
          thu: true,
          fri: true,
          sat: false,
          sun: false,
          exceptions: [],
        } as any,
        shiftStartMinutes: 480,
        shiftEndMinutes: 1020,
        createdAt: now,
        updatedAt: now,
      },
    });

    await tx.scheduleResource.createMany({
      data: LAB_SCHEDULE_RESOURCES.map((resource) => ({
        id: scopedId(resource.id),
        projectId,
        revisionId,
        calendarId,
        name: resource.name,
        role: resource.role,
        kind: resource.kind,
        color: resource.color,
        defaultUnits: resource.defaultUnits,
        capacityPerDay: resource.capacityPerDay,
        costRate: resource.costRate,
        createdAt: now,
        updatedAt: now,
      })),
    });

    await tx.scheduleTask.createMany({ data: topLevelTasks.map(taskData) });
    await tx.scheduleTask.createMany({ data: childTasks.map(taskData) });

    await tx.scheduleDependency.createMany({
      data: LAB_SCHEDULE_DEPENDENCIES.map((dependency) => ({
        id: scopedId(dependency.id),
        predecessorId: scopedId(dependency.predecessorId),
        successorId: scopedId(dependency.successorId),
        type: dependency.type,
        lagDays: dependency.lagDays,
      })),
    });

    await tx.scheduleTaskAssignment.createMany({
      data: LAB_SCHEDULE_ASSIGNMENTS.map((assignment) => ({
        id: scopedId(assignment.id),
        taskId: scopedId(assignment.taskId),
        resourceId: scopedId(assignment.resourceId),
        units: assignment.units,
        role: assignment.role,
        createdAt: now,
        updatedAt: now,
      })),
    });

    await tx.scheduleBaseline.create({
      data: {
        id: baselineId,
        projectId,
        revisionId,
        name: "BIM lab target baseline",
        description: "Primary baseline seeded with the BIM lab test schedule.",
        kind: "primary",
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      },
    });

    await tx.scheduleBaselineTask.createMany({
      data: LAB_SCHEDULE_TASKS.map((task) => ({
        id: scopedId(`blt-${task.id}`),
        baselineId,
        taskId: scopedId(task.id),
        taskName: task.name,
        phaseId: scopedId(task.phaseId),
        startDate: task.baselineStart ?? task.startDate,
        endDate: task.baselineEnd ?? task.endDate,
        duration: task.duration,
        createdAt: now,
        updatedAt: now,
      })),
    });

    await tx.project.update({ where: { id: projectId }, data: { updatedAt: now } });
    await tx.quote.updateMany({ where: { projectId }, data: { updatedAt: now } });
  });
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
  if (!created.revision) {
    throw new Error(`Project ${projectId} was created without an active quote revision`);
  }

  console.log("[bim-test-lab] Creating test schedule…");
  await seedTestSchedule(projectId, created.revision.id);

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
  const scheduleTaskCount = await prisma.scheduleTask.count({ where: { projectId } });
  const scheduleResourceCount = await prisma.scheduleResource.count({ where: { projectId } });
  const scheduleTaskIds = await prisma.scheduleTask.findMany({
    where: { projectId },
    select: { id: true },
  });
  const scheduleDependencyCount = await prisma.scheduleDependency.count({
    where: { predecessorId: { in: scheduleTaskIds.map((task) => task.id) } },
  });

  console.log("");
  console.log("✓ BIM Workspace Test Lab ready.");
  console.log(`  project id   : ${projectId}`);
  console.log(`  file nodes   : ${fileNodeCount}`);
  console.log(`  model assets : ${modelAssetCount}`);
  console.log(`  model elements: ${elementCount}`);
  console.log(`  schedule tasks: ${scheduleTaskCount}`);
  console.log(`  schedule resources: ${scheduleResourceCount}`);
  console.log(`  schedule dependencies: ${scheduleDependencyCount}`);
  console.log("");
  console.log("Open the project in the workspace and click through each intake card —");
  console.log("counts should be > 0 for BIM, 3D Geometry, Photos, Spreadsheets, and Schedule.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

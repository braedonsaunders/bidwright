export type ProjectStatus =
  | "Intake"
  | "Parsing"
  | "Review"
  | "Estimate"
  | "Pending Award"
  | "Closed";

export type ReviewState = "Needs Review" | "Ready to Apply" | "Applied" | "Rejected";

export type WorkspaceTab = "dossier" | "estimate" | "knowledge" | "activity";

export interface ProjectRecord {
  id: string;
  name: string;
  customer: string;
  location: string;
  status: ProjectStatus;
  discipline: string;
  packageSize: string;
  dueDate: string;
  confidence: number;
  summary: string;
  scope: string[];
  sources: number;
  revisions: number;
  value: string;
  lastTouched: string;
}

export interface ReviewItem {
  id: string;
  title: string;
  target: string;
  state: ReviewState;
  confidence: number;
  source: string;
  rationale: string;
  impact: string;
}

export interface EstimateRow {
  item: string;
  category: string;
  qty: string;
  unit: string;
  laborHrs: string;
  cost: string;
  margin: string;
  total: string;
  source: string;
}

export interface KnowledgeDocument {
  title: string;
  kind: string;
  pages: string;
  coverage: string;
  relevance: string;
}

export interface ActivityItem {
  timestamp: string;
  actor: string;
  action: string;
  detail: string;
}

export interface DossierSection {
  title: string;
  description: string;
  status: "Complete" | "In Progress" | "Missing";
}

export const projects: ProjectRecord[] = [
  {
    id: "northgate-hospital-mech",
    name: "Northgate Medical Center Mechanical Expansion",
    customer: "Northgate Health Partners",
    location: "Denver, CO",
    status: "Estimate",
    discipline: "Mechanical / Pipefitting",
    packageSize: "412 pages",
    dueDate: "Apr 04, 2026",
    confidence: 86,
    summary:
      "A multi-building mechanical package with dense specs, staged demolition, rooftop equipment, hydronic piping, and a heavy commissioning burden.",
    scope: [
      "Steam and hydronic piping",
      "Demolition and phased tie-ins",
      "Rooftop equipment rigging",
      "Commissioning and startup",
    ],
    sources: 38,
    revisions: 3,
    value: "$4.8M target",
    lastTouched: "12 minutes ago",
  },
  {
    id: "riverside-plant-upgrade",
    name: "Riverside Process Plant Upgrade",
    customer: "Riverside Manufacturing",
    location: "Cleveland, OH",
    status: "Review",
    discipline: "Industrial Mechanical",
    packageSize: "276 pages",
    dueDate: "Mar 29, 2026",
    confidence: 79,
    summary:
      "High-risk retrofit with constrained shutdown windows, welded process piping, equipment swaps, and a long list of alternates.",
    scope: [
      "Process piping",
      "Shutdown planning",
      "Equipment setting",
      "Alternate pricing",
    ],
    sources: 24,
    revisions: 2,
    value: "$2.1M target",
    lastTouched: "38 minutes ago",
  },
  {
    id: "summit-campus-fitout",
    name: "Summit Campus Lab Fit-Out",
    customer: "Summit BioWorks",
    location: "Boston, MA",
    status: "Parsing",
    discipline: "Laboratory Piping",
    packageSize: "191 pages",
    dueDate: "Apr 11, 2026",
    confidence: 72,
    summary:
      "New lab buildout with specialty gas, vacuum, and controls coordination across multiple spec divisions.",
    scope: ["Specialty gas", "Vacuum systems", "Controls", "Sheet coordination"],
    sources: 19,
    revisions: 1,
    value: "$1.4M target",
    lastTouched: "1 hour ago",
  },
];

export const reviewQueue: ReviewItem[] = [
  {
    id: "rq-01",
    title: "Phase split: Demo / Rough-In / Closeout",
    target: "Scope structure",
    state: "Needs Review",
    confidence: 91,
    source: "Sheet M1.2 + spec 23 05 00",
    rationale:
      "The AI separated demolition from install work and preserved closeout activities as their own phase.",
    impact: "Changes worksheet grouping and proposal breakout.",
  },
  {
    id: "rq-02",
    title: "Add fuel surcharge modifier",
    target: "Modifiers",
    state: "Ready to Apply",
    confidence: 83,
    source: "Company rate policy + labor book reference",
    rationale:
      "The project is outside the home yard radius and the estimator policy supports a fuel surcharge.",
    impact: "Adds a visible modifier line and affects subtotal.",
  },
  {
    id: "rq-03",
    title: "Include scaffold rental allowance",
    target: "Estimate row",
    state: "Applied",
    confidence: 88,
    source: "Drawing A-402 + field note",
    rationale:
      "The work includes ceiling access above 18 feet, and the model found repeated access constraints.",
    impact: "Adds equipment allowance and notes for review.",
  },
  {
    id: "rq-04",
    title: "Pressure test documentation note",
    target: "Conditions",
    state: "Rejected",
    confidence: 65,
    source: "Spec 23 05 93",
    rationale:
      "The clause is already covered by the standard conditions library and did not need duplication.",
    impact: "No estimate change.",
  },
];

export const estimateRows: EstimateRow[] = [
  {
    item: "2-1/2 in welded hydronic piping",
    category: "Pipefitting",
    qty: "8,420",
    unit: "LF",
    laborHrs: "1,248",
    cost: "$611,400",
    margin: "31%",
    total: "$886,400",
    source: "Sheets M-201 to M-214",
  },
  {
    item: "Pump skid setting and alignment",
    category: "Equipment",
    qty: "3",
    unit: "EA",
    laborHrs: "96",
    cost: "$48,200",
    margin: "28%",
    total: "$67,000",
    source: "Drawing M-601",
  },
  {
    item: "Demo and tie-in allowance",
    category: "General Conditions",
    qty: "1",
    unit: "LS",
    laborHrs: "180",
    cost: "$94,500",
    margin: "24%",
    total: "$124,500",
    source: "Addendum 03",
  },
  {
    item: "Testing, flushing, startup",
    category: "Commissioning",
    qty: "1",
    unit: "LS",
    laborHrs: "72",
    cost: "$26,800",
    margin: "35%",
    total: "$41,200",
    source: "Spec 23 08 00",
  },
];

export const knowledgeDocs: KnowledgeDocument[] = [
  {
    title: "Mechanical Pipefitting Handbook",
    kind: "Library",
    pages: "388 pages",
    coverage: "Layout, productivity, and installed-cost heuristics",
    relevance: "Use as estimating precedent for labor efficiency and phasing",
  },
  {
    title: "Hydronic Systems Estimating Guide",
    kind: "Library",
    pages: "244 pages",
    coverage: "Piping, valves, accessories, and startup allowances",
    relevance: "Use when spec sheets reference hydronic distribution or pumps",
  },
  {
    title: "Northgate RFQ Package",
    kind: "Project",
    pages: "412 pages",
    coverage: "Specs, RFQ, drawings, addenda, and bid forms",
    relevance: "Primary project grounding source",
  },
];

export const activityFeed: ActivityItem[] = [
  {
    timestamp: "09:14",
    actor: "Avery",
    action: "Accepted phase proposal",
    detail: "Converted the AI phase plan into four estimator-approved scope buckets.",
  },
  {
    timestamp: "09:31",
    actor: "System",
    action: "Ingested Addendum 02",
    detail: "Identified 6 drawing revisions and 11 spec deltas across 3 sheets.",
  },
  {
    timestamp: "09:52",
    actor: "Jordan",
    action: "Edited line item",
    detail: "Adjusted scaffold allowance and attached source notes to the estimate row.",
  },
  {
    timestamp: "10:06",
    actor: "AI Agent",
    action: "Generated equipment suggestion",
    detail: "Recommended a 15K rough-terrain lift based on access constraints and ceiling heights.",
  },
];

export const dossierSections: DossierSection[] = [
  {
    title: "Project summary",
    description: "Foundational scope synopsis, target value, schedule pressure, and risks.",
    status: "Complete",
  },
  {
    title: "Division map",
    description: "Crosswalk between spec divisions, drawing sheets, and estimate buckets.",
    status: "In Progress",
  },
  {
    title: "Open gaps",
    description: "Missing alternates, incomplete equipment data, and unresolved exclusions.",
    status: "In Progress",
  },
  {
    title: "Compliance matrix",
    description: "Bid form requirements, insurance, bonds, testing, and documentation obligations.",
    status: "Missing",
  },
];

export const workspaceMetrics = [
  { label: "Target value", value: "$4.8M" },
  { label: "Pages parsed", value: "412" },
  { label: "Sources cited", value: "38" },
  { label: "AI findings", value: "24" },
];

export function getProject(projectId: string) {
  return projects.find((project) => project.id === projectId) ?? projects[0];
}

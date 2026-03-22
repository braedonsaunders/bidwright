import { summarizeRevisionFinancials } from "./calc";
import type { ProjectWorkspace } from "./types";

const projectWorkspace: ProjectWorkspace = {
  id: "project-harbour-pump",
  name: "Harbour Centre Boiler & Pump Replacement",
  customer: "Northshore Property Group",
  stage: "Bid Review",
  estimator: "Avery Chen",
  dueDate: "2026-04-05",
  dossier: {
    summary:
      "Mechanical retrofit package covering boiler replacement, hydronic pump swap-out, controls tie-in, demolition, startup, and warranty closeout. Package includes 312 indexed spec pages and 46 drawing sheets.",
    scopeMap: [
      "Mobilization and site protection",
      "Existing boiler and pump demolition",
      "New boiler setting and piping tie-ins",
      "Pump, valves, supports, and seismic restraint",
      "Controls integration and startup",
      "Testing, balancing support, and closeout"
    ],
    risks: [
      "Unclear crane path and restricted laydown space may affect labour and rigging duration.",
      "Controls points list is partially referenced but not fully scheduled in the package.",
      "Drawing M4.2 conflicts with spec section 23 21 13 on valve actuator scope."
    ],
    gaps: [
      "Awaiting confirmation on shutdown window sequencing.",
      "Need customer confirmation whether insulation patching is by mechanical or general trades.",
      "Need final addendum review for alternate baseplate detail."
    ],
    packageHealth: {
      files: 28,
      indexedPages: 434,
      drawings: 46,
      specs: 312
    }
  },
  documents: [
    {
      id: "doc-spec-232113",
      name: "Division 23 Mechanical Specifications",
      kind: "spec",
      pages: 312,
      discipline: "Mechanical",
      summary: "Primary mechanical specification package with equipment, piping, controls, and closeout requirements."
    },
    {
      id: "doc-rfq",
      name: "RFQ & Bid Form",
      kind: "rfq",
      pages: 18,
      discipline: "Commercial",
      summary: "Commercial terms, bid form, alternates, bonding, insurance, and schedule constraints."
    },
    {
      id: "doc-m-series",
      name: "Mechanical Drawings M1.0-M6.4",
      kind: "drawing",
      pages: 46,
      discipline: "Mechanical",
      summary: "Existing demolition plans, new piping, details, risers, and equipment schedules."
    }
  ],
  activeRevision: {
    id: "rev-2",
    revisionNumber: 2,
    title: "Issued For Bid",
    status: "Open",
    breakoutStyle: "PhaseDetail",
    subtotal: 0,
    cost: 0,
    estimatedProfit: 0,
    estimatedMargin: 0,
    phases: [
      {
        id: "phase-1",
        number: "01",
        name: "Mobilization & Demolition",
        description: "Protect the occupied building, isolate systems, and remove the existing boiler and associated piping.",
        order: 1
      },
      {
        id: "phase-2",
        number: "02",
        name: "Boiler Room Installation",
        description: "Set new boiler, pumps, piping, valves, supports, and seismic restraints.",
        order: 2
      },
      {
        id: "phase-3",
        number: "03",
        name: "Controls, Startup & Closeout",
        description: "Integrate controls, support TAB, startup, commissioning, and documentation.",
        order: 3
      }
    ],
    worksheets: [
      {
        id: "ws-1",
        name: "Boiler Room",
        order: 1,
        items: [
          {
            id: "item-1",
            worksheetId: "ws-1",
            phaseId: "phase-1",
            category: "Labour",
            entityName: "Journeyperson Pipefitter",
            vendor: null,
            description: "Existing boiler demolition, drain-down, disconnect, and staged removal.",
            quantity: 64,
            uom: "HR",
            cost: 98,
            markup: 0.22,
            price: 7651,
            labourHoursReg: 1,
            labourHoursOver: 0,
            labourHoursDouble: 0,
            citations: [
              {
                id: "cit-1",
                documentName: "Mechanical Drawings M1.0-M6.4",
                pageLabel: "M2.1",
                section: "Demolition Keynotes",
                excerpt: "Remove existing boiler, pump assembly, and associated supports.",
                sourceType: "project"
              }
            ]
          },
          {
            id: "item-2",
            worksheetId: "ws-1",
            phaseId: "phase-2",
            category: "Material",
            entityName: "Carbon Steel Piping Package",
            vendor: "Meridian Pipe",
            description: "New hydronic piping, fittings, valves, and hangers.",
            quantity: 1,
            uom: "EA",
            cost: 28500,
            markup: 0.18,
            price: 33630,
            labourHoursReg: 0,
            labourHoursOver: 0,
            labourHoursDouble: 0,
            citations: [
              {
                id: "cit-2",
                documentName: "Division 23 Mechanical Specifications",
                pageLabel: "23 21 13-12",
                section: "Hydronic Piping",
                excerpt: "Provide new steel hydronic piping, valves, and specialties complete.",
                sourceType: "project"
              }
            ]
          },
          {
            id: "item-3",
            worksheetId: "ws-1",
            phaseId: "phase-2",
            category: "Equipment",
            entityName: "40T Mobile Crane",
            vendor: "Liftline",
            description: "Crane support for removal and setting through roof hatch.",
            quantity: 2,
            uom: "DAY",
            cost: 0,
            markup: 0.12,
            price: 4800,
            labourHoursReg: 2,
            labourHoursOver: 0,
            labourHoursDouble: 0,
            citations: [
              {
                id: "cit-3",
                documentName: "Mechanical Drawings M1.0-M6.4",
                pageLabel: "M0.1",
                section: "General Notes",
                excerpt: "Coordinate rooftop access and rigging with building operations.",
                sourceType: "project"
              }
            ]
          }
        ]
      },
      {
        id: "ws-2",
        name: "Controls & Closeout",
        order: 2,
        items: [
          {
            id: "item-4",
            worksheetId: "ws-2",
            phaseId: "phase-3",
            category: "Subcontractors",
            entityName: "Controls Integration Allowance",
            vendor: "Axis Controls",
            description: "Provide BAS tie-in, point verification, startup attendance, and trend setup.",
            quantity: 1,
            uom: "EA",
            cost: 12800,
            markup: 0.2,
            price: 15360,
            labourHoursReg: 0,
            labourHoursOver: 0,
            labourHoursDouble: 0,
            citations: [
              {
                id: "cit-4",
                documentName: "Division 23 Mechanical Specifications",
                pageLabel: "23 09 23-7",
                section: "Direct Digital Control",
                excerpt: "Coordinate startup and integration with owner BAS vendor.",
                sourceType: "project"
              }
            ]
          }
        ]
      }
    ],
    modifiers: [
      {
        id: "mod-1",
        name: "Contingency",
        type: "Contingency",
        appliesTo: "All",
        percentage: 0.05,
        amount: null,
        showOnQuote: true
      }
    ],
    conditions: [
      {
        id: "cond-1",
        type: "Inclusion",
        value: "Price includes demolition, disposal, crane support, startup attendance, and standard closeout documentation.",
        order: 1
      },
      {
        id: "cond-2",
        type: "Exclusion",
        value: "Temporary heat, asbestos abatement, and structural modifications are excluded unless noted otherwise by addendum.",
        order: 2
      }
    ],
    reportSections: [
      {
        id: "rep-1",
        title: "Executive Summary",
        content:
          "Bidwright ingested the customer package, mapped the mechanical scope, and prepared a phase-driven estimate grounded in specs, drawings, and RFQ terms.",
        order: 1,
        sectionType: "content"
      },
      {
        id: "rep-2",
        title: "Major Risk Items",
        content:
          "Shutdown sequencing, crane access, and controls scope remain the primary variables affecting margin confidence.",
        order: 2,
        sectionType: "content"
      }
    ],
    aiProposals: [
      {
        id: "ai-1",
        type: "phase-plan",
        title: "Phase split based on demo, install, and startup sections",
        summary:
          "Suggested three-phase structure using spec section boundaries, drawing keynote clusters, and shutdown sequencing references.",
        confidence: 0.87,
        status: "pending",
        citations: [
          {
            id: "cit-5",
            documentName: "Division 23 Mechanical Specifications",
            pageLabel: "23 05 00-3",
            section: "Execution",
            excerpt: "Coordinate demolition, installation, and startup sequencing.",
            sourceType: "project"
          }
        ]
      },
      {
        id: "ai-2",
        type: "equipment",
        title: "Crane and rigging allowance detected",
        summary:
          "Suggested mobile crane allocation based on equipment replacement path, roof hatch reference, and weight schedule.",
        confidence: 0.74,
        status: "pending",
        citations: [
          {
            id: "cit-6",
            documentName: "Mechanical Drawings M1.0-M6.4",
            pageLabel: "M4.2",
            section: "Equipment Schedule",
            excerpt: "Replacement boiler section weight requires coordinated rigging plan.",
            sourceType: "project"
          }
        ]
      }
    ]
  },
  catalogRates: [
    { id: "rate-1", name: "Pipefitter RT", type: "labour", unit: "HR", value: 122 },
    { id: "rate-2", name: "Pipefitter Burden", type: "burden", unit: "HR", value: 18.5 },
    { id: "rate-3", name: "40T Mobile Crane", type: "equipment", unit: "DAY", value: 2400 },
    { id: "rate-4", name: "Hydronic Steel Package", type: "material", unit: "EA", value: 28500 }
  ]
};

const financials = summarizeRevisionFinancials(projectWorkspace.activeRevision);
projectWorkspace.activeRevision.subtotal = financials.subtotal;
projectWorkspace.activeRevision.cost = financials.cost;
projectWorkspace.activeRevision.estimatedProfit = financials.estimatedProfit;
projectWorkspace.activeRevision.estimatedMargin = financials.estimatedMargin;

export const sampleProjects = [projectWorkspace];

export function getProjectWorkspace(projectId: string) {
  return sampleProjects.find((project) => project.id === projectId) ?? sampleProjects[0];
}

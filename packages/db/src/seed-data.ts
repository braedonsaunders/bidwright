/**
 * Reusable seed functions — can be called from CLI (seed.ts) or API endpoints.
 */
import { mockStore, type BidwrightStore } from "@bidwright/domain";
import type { PrismaClient } from "@prisma/client";

export { mockStore };


export async function seedEntityCategories(prisma: PrismaClient, organizationId: string) {
  const categories = [
    {
      name: "Labour", entityType: "Labour", shortform: "L", defaultUom: "HR",
      validUoms: ["HR", "DAY", "WK", "MO"], color: "#3b82f6", order: 1,
      calculationType: "auto_labour", itemSource: "rate_schedule" as const,
      editableFields: { quantity: true, cost: false, markup: false, price: false, unit1: true, unit2: true, unit3: true },
      unitLabels: { unit1: "Reg Hrs", unit2: "OT Hrs", unit3: "DT Hrs" },
    },
    {
      name: "Equipment", entityType: "Equipment", shortform: "E", defaultUom: "DAY",
      validUoms: ["DAY", "WK", "MO", "EA"], color: "#f59e0b", order: 2,
      calculationType: "auto_equipment", itemSource: "catalog" as const,
      editableFields: { quantity: true, cost: false, markup: false, price: false, unit1: true, unit2: false, unit3: false },
      unitLabels: { unit1: "Duration", unit2: "", unit3: "" },
    },
    {
      name: "Material", entityType: "Material", shortform: "M", defaultUom: "EA",
      validUoms: ["EA", "LF", "SF", "CY", "TON", "GAL", "LB", "LS", "LOT", "SET"], color: "#22c55e", order: 3,
      calculationType: "manual", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, unit1: false, unit2: false, unit3: false },
      unitLabels: { unit1: "Reg Hrs", unit2: "OT Hrs", unit3: "DT Hrs" },
    },
    {
      name: "Subcontractor", entityType: "Subcontractor", shortform: "S", defaultUom: "LS",
      validUoms: ["EA", "LS", "HR"], color: "#8b5cf6", order: 4,
      calculationType: "manual", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, unit1: false, unit2: false, unit3: false },
      unitLabels: { unit1: "Reg Hrs", unit2: "OT Hrs", unit3: "DT Hrs" },
    },
    {
      name: "Consumables", entityType: "Consumable", shortform: "C", defaultUom: "EA",
      validUoms: ["EA", "KG", "LB", "GAL"], color: "#6b7280", order: 5,
      calculationType: "auto_consumable", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: false, unit1: false, unit2: false, unit3: false },
      unitLabels: { unit1: "Reg Hrs", unit2: "OT Hrs", unit3: "DT Hrs" },
    },
    {
      name: "Rental Equipment", entityType: "RentalEquipment", shortform: "R", defaultUom: "DAY",
      validUoms: ["DAY", "WK", "MO", "HR"], color: "#ec4899", order: 6,
      calculationType: "auto_equipment", itemSource: "rate_schedule" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, unit1: true, unit2: false, unit3: false },
      unitLabels: { unit1: "Duration", unit2: "", unit3: "" },
    },
    {
      name: "Travel & Per Diem", entityType: "Travel", shortform: "T", defaultUom: "DAY",
      validUoms: ["DAY", "EA", "MI"], color: "#f97316", order: 7,
      calculationType: "manual", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, unit1: false, unit2: false, unit3: false },
      unitLabels: { unit1: "Reg Hrs", unit2: "OT Hrs", unit3: "DT Hrs" },
    },
    {
      name: "Other Charges", entityType: "OtherCharges", shortform: "O", defaultUom: "LS",
      validUoms: ["EA", "LS", "%"], color: "#ef4444", order: 8,
      calculationType: "direct_price", itemSource: "freeform" as const,
      editableFields: { quantity: false, cost: false, markup: false, price: true, unit1: false, unit2: false, unit3: false },
      unitLabels: { unit1: "", unit2: "", unit3: "" },
    },
    {
      name: "Allowances", entityType: "Allowance", shortform: "A", defaultUom: "LS",
      validUoms: ["EA", "LS"], color: "#14b8a6", order: 9,
      calculationType: "direct_price", itemSource: "freeform" as const,
      editableFields: { quantity: false, cost: false, markup: false, price: true, unit1: false, unit2: false, unit3: false },
      unitLabels: { unit1: "", unit2: "", unit3: "" },
    },
    {
      name: "Overhead", entityType: "Overhead", shortform: "H", defaultUom: "%",
      validUoms: ["%", "EA", "LS"], color: "#a855f7", order: 10,
      calculationType: "direct_price", itemSource: "freeform" as const,
      editableFields: { quantity: false, cost: false, markup: false, price: true, unit1: false, unit2: false, unit3: false },
      unitLabels: { unit1: "", unit2: "", unit3: "" },
    },
  ];

  for (const cat of categories) {
    await prisma.entityCategory.upsert({
      where: { organizationId_name: { organizationId, name: cat.name } },
      update: {
        entityType: cat.entityType, shortform: cat.shortform, defaultUom: cat.defaultUom,
        validUoms: cat.validUoms, editableFields: cat.editableFields as any,
        unitLabels: cat.unitLabels as any, calculationType: cat.calculationType,
        itemSource: cat.itemSource,
        color: cat.color, order: cat.order, isBuiltIn: true, enabled: true,
      },
      create: {
        organizationId, name: cat.name, entityType: cat.entityType, shortform: cat.shortform,
        defaultUom: cat.defaultUom, validUoms: cat.validUoms, editableFields: cat.editableFields as any,
        unitLabels: cat.unitLabels as any, calculationType: cat.calculationType,
        itemSource: cat.itemSource,
        color: cat.color, order: cat.order, isBuiltIn: true, enabled: true,
      },
    });
  }
}

export async function seedSampleProjects(prisma: PrismaClient, store: BidwrightStore, organizationId: string) {
  for (const project of store.projects) {
    await prisma.project.create({
      data: {
        id: project.id,
        organizationId,
        name: project.name,
        clientName: project.clientName,
        location: project.location,
        packageName: project.packageName,
        packageUploadedAt: project.packageUploadedAt,
        ingestionStatus: project.ingestionStatus,
        summary: project.summary,
        sourceDocuments: {
          create: store.sourceDocuments
            .filter((d) => d.projectId === project.id)
            .map((d) => ({
              id: d.id, fileName: d.fileName, fileType: d.fileType, documentType: d.documentType,
              pageCount: d.pageCount, checksum: d.checksum, storagePath: d.storagePath,
              extractedText: d.extractedText, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt),
            })),
        },
      },
    });
  }

  for (const quote of store.quotes) {
    await prisma.quote.create({
      data: {
        id: quote.id, projectId: quote.projectId, quoteNumber: quote.quoteNumber,
        title: quote.title, status: quote.status, currentRevisionId: quote.currentRevisionId,
      },
    });
  }

  for (const revision of store.revisions) {
    await prisma.quoteRevision.create({
      data: {
        id: revision.id, quoteId: revision.quoteId, revisionNumber: revision.revisionNumber,
        title: revision.title, description: revision.description, notes: revision.notes,
        breakoutStyle: revision.breakoutStyle, useCalculatedTotal: revision.useCalculatedTotal,
        subtotal: revision.subtotal, cost: revision.cost,
        estimatedProfit: revision.estimatedProfit,
        estimatedMargin: revision.estimatedMargin,
        totalHours: revision.totalHours,
        worksheets: {
          create: store.worksheets
            .filter((w) => w.revisionId === revision.id)
            .map((w) => ({
              id: w.id, name: w.name, order: w.order,
              items: {
                create: store.worksheetItems
                  .filter((i) => i.worksheetId === w.id)
                  .map((i) => ({
                    id: i.id, category: i.category, entityType: i.entityType, entityName: i.entityName,
                    description: i.description, quantity: i.quantity, uom: i.uom,
                    cost: i.cost, markup: i.markup, price: i.price,
                    unit1: i.unit1, unit2: i.unit2,
                    unit3: i.unit3, lineOrder: i.lineOrder,
                  })),
              },
            })),
        },
        phases: {
          create: store.phases
            .filter((p) => p.revisionId === revision.id)
            .map((p) => ({ id: p.id, number: p.number, name: p.name, description: p.description, order: p.order })),
        },
        modifiers: {
          create: store.modifiers
            .filter((m) => m.revisionId === revision.id)
            .map((m) => ({
              id: m.id, name: m.name, type: m.type, appliesTo: m.appliesTo,
              percentage: m.percentage ?? null, amount: m.amount ?? null, show: m.show,
            })),
        },
        conditions: {
          create: store.conditions
            .filter((c) => c.revisionId === revision.id)
            .map((c) => ({ id: c.id, type: c.type, value: c.value, order: c.order })),
        },
      },
    });
  }

  for (const catalog of store.catalogs) {
    await prisma.catalog.create({
      data: {
        id: catalog.id, organizationId, projectId: catalog.projectId,
        name: catalog.name, kind: catalog.kind, scope: catalog.scope, description: catalog.description,
        items: {
          create: store.catalogItems
            .filter((i) => i.catalogId === catalog.id)
            .map((i) => ({
              id: i.id, code: i.code, name: i.name, unit: i.unit,
              unitCost: i.unitCost, unitPrice: i.unitPrice, metadata: i.metadata,
            })),
        },
      },
    });
  }

  for (const aiRun of store.aiRuns) {
    await prisma.aiRun.create({
      data: {
        id: aiRun.id, projectId: aiRun.projectId, revisionId: aiRun.revisionId,
        kind: aiRun.kind, status: aiRun.status, model: aiRun.model,
        promptVersion: aiRun.promptVersion, input: aiRun.input as any, output: aiRun.output as any,
        createdAt: new Date(aiRun.createdAt), updatedAt: new Date(aiRun.updatedAt),
      },
    });
  }

  for (const citation of store.citations) {
    await prisma.citation.create({
      data: {
        id: citation.id, projectId: citation.projectId, aiRunId: citation.aiRunId,
        sourceDocumentId: citation.sourceDocumentId, resourceType: citation.resourceType,
        resourceKey: citation.resourceKey, pageStart: citation.pageStart, pageEnd: citation.pageEnd,
        excerpt: citation.excerpt, confidence: citation.confidence,
      },
    });
  }
}

export async function seedRateSchedules(prisma: PrismaClient, store: BidwrightStore, organizationId: string) {
  for (const schedule of store.rateSchedules ?? []) {
    await prisma.rateSchedule.create({
      data: {
        id: schedule.id, organizationId, name: schedule.name, description: schedule.description,
        category: schedule.category, scope: schedule.scope, defaultMarkup: schedule.defaultMarkup,
        autoCalculate: schedule.autoCalculate, metadata: schedule.metadata as any,
        tiers: {
          create: (store.rateScheduleTiers ?? [])
            .filter((t) => t.scheduleId === schedule.id)
            .map((t) => ({ id: t.id, name: t.name, multiplier: t.multiplier, sortOrder: t.sortOrder })),
        },
        items: {
          create: (store.rateScheduleItems ?? [])
            .filter((i) => i.scheduleId === schedule.id)
            .map((i) => ({
              id: i.id, catalogItemId: i.catalogItemId, code: i.code, name: i.name,
              unit: i.unit, rates: i.rates, costRates: i.costRates, burden: i.burden,
              perDiem: i.perDiem, metadata: i.metadata, sortOrder: i.sortOrder,
            })),
        },
      },
    });
  }
}

export async function seedCustomersAndDepartments(prisma: PrismaClient, organizationId: string) {
  const customers = [
    { id: "cust_metro_health", name: "Metro Health Authority", shortName: "MHA", phone: "(416) 555-0100", email: "procurement@metrohealth.ca", website: "https://metrohealth.ca", addressStreet: "200 University Ave", addressCity: "Toronto", addressProvince: "Ontario", addressPostalCode: "M5H 3C6", addressCountry: "Canada", notes: "Major institutional client. Net-30 terms." },
    { id: "cust_northern_builders", name: "Northern Builders Ltd", shortName: "NBL", phone: "(403) 555-0200", email: "estimating@northernbuilders.ca", website: "https://northernbuilders.ca", addressStreet: "1500 Centre St N", addressCity: "Calgary", addressProvince: "Alberta", addressPostalCode: "T2E 2R8", addressCountry: "Canada", notes: "General contractor. Repeat client since 2019." },
    { id: "cust_greenfield_dev", name: "Greenfield Development Corp", shortName: "GDC", phone: "(604) 555-0300", email: "projects@greenfielddev.com", website: "https://greenfielddev.com", addressStreet: "888 Dunsmuir St, Suite 400", addressCity: "Vancouver", addressProvince: "British Columbia", addressPostalCode: "V6C 3K4", addressCountry: "Canada", notes: "Commercial developer. High-rise and mixed-use projects." },
    { id: "cust_apex_industrial", name: "Apex Industrial Services", shortName: "AIS", phone: "(905) 555-0400", email: "bids@apexindustrial.com", website: "", addressStreet: "45 Industrial Pkwy", addressCity: "Hamilton", addressProvince: "Ontario", addressPostalCode: "L8W 3N6", addressCountry: "Canada", notes: "Industrial maintenance and plant upgrades." },
  ];

  for (const c of customers) {
    await prisma.customer.create({ data: { ...c, organizationId } });
  }

  const contacts = [
    { id: "ccon_smith", customerId: "cust_metro_health", name: "John Smith", title: "Director of Facilities", phone: "(416) 555-0101", email: "john.smith@metrohealth.ca", isPrimary: true },
    { id: "ccon_chen", customerId: "cust_metro_health", name: "Linda Chen", title: "Procurement Manager", phone: "(416) 555-0102", email: "linda.chen@metrohealth.ca", isPrimary: false },
    { id: "ccon_taylor", customerId: "cust_northern_builders", name: "Mike Taylor", title: "Project Manager", phone: "(403) 555-0201", email: "m.taylor@northernbuilders.ca", isPrimary: true },
    { id: "ccon_patel", customerId: "cust_northern_builders", name: "Priya Patel", title: "Estimating Lead", phone: "(403) 555-0202", email: "p.patel@northernbuilders.ca", isPrimary: false },
    { id: "ccon_wong", customerId: "cust_greenfield_dev", name: "David Wong", title: "VP Construction", phone: "(604) 555-0301", email: "d.wong@greenfielddev.com", isPrimary: true },
    { id: "ccon_murphy", customerId: "cust_apex_industrial", name: "Sean Murphy", title: "Plant Manager", phone: "(905) 555-0401", email: "s.murphy@apexindustrial.com", isPrimary: true },
  ];

  for (const c of contacts) {
    await prisma.customerContact.create({ data: c });
  }

  const departments = [
    { id: "dept_mechanical", name: "Mechanical", code: "MECH", description: "Piping, HVAC, plumbing, and mechanical systems" },
    { id: "dept_electrical", name: "Electrical", code: "ELEC", description: "Power distribution, lighting, and controls" },
    { id: "dept_general", name: "General Contracting", code: "GC", description: "General construction and coordination" },
    { id: "dept_precon", name: "Pre-construction", code: "PRECON", description: "Estimating, planning, and value engineering" },
  ];

  for (const d of departments) {
    await prisma.department.create({ data: { ...d, organizationId } });
  }
}

/**
 * Seed all sample data into an organization.
 * This is the main entry point called from both CLI and API.
 */
export async function seedAllForOrganization(prisma: PrismaClient, organizationId: string) {
  await seedEntityCategories(prisma, organizationId);
  await seedSampleProjects(prisma, mockStore, organizationId);
  await seedRateSchedules(prisma, mockStore, organizationId);
  await seedCustomersAndDepartments(prisma, organizationId);
  await seedEstimatorPersonas(prisma, organizationId);
}

// ── Estimator Personas ──────────────────────────────────────────────────────

const PERSONAS = [
  {
    name: "Mechanical Piping Estimator",
    trade: "mechanical",
    description: "Senior mechanical estimator specializing in industrial piping, equipment setting, and process systems",
    isDefault: true,
    order: 0,
    datasetTags: ["pipe", "weld", "flange", "valve", "man-hours", "labour", "piping"],
    systemPrompt: `You are a senior mechanical piping estimator with 20+ years of experience in industrial piping installation. You think in terms of welds, joints, spool pieces, and crew-days — never in vague lump sums.

## Your Methodology

### Shop vs Field Distinction (CRITICAL)
- **Shop/Fabrication:** Cutting, beveling, fit-up, welding spools, pre-assembly, shop primer — done in a controlled laydown area. Productivity is 15-25% better than field.
- **Field/Installation:** Rigging spools into position, final fit-up at elevation, tie-in welds, hydrostatic testing, touch-up painting — done at the install location, often at height with access restrictions.
- You MUST create SEPARATE worksheets for fabrication vs installation. These are fundamentally different work activities with different crews, rates, and productivity.

### Pipe Sizing Drives Everything
- Hours per joint/weld increase exponentially with pipe diameter
- Schedule (wall thickness) affects weld time significantly — Sch 80 takes ~40% longer than Sch 40
- Material grade matters: CS=baseline, SS=1.3x, chrome-moly=1.5x, alloy=1.4x+

### Weld/Joint Counting
- For fabrication: count joints from ISOs or estimate from LF (typically 1 joint per 10-15 LF depending on fittings)
- For installation: count tie-in welds separately from shop welds — these are done in position (often overhead/vertical) with higher MH
- Flanged connections: bolt-up hours depend on flange size and number of bolts

### Crew Composition
- **Shop fab:** 1 fitter + 1 welder per station, foreman over 2-3 stations
- **Field install (small bore <=2"):** 2-person crew (1 fitter + 1 helper)
- **Field install (large bore >2"):** 3-person crew (1 fitter + 1 welder + 1 helper) + foreman
- **Rigging large spools:** Add rigger + crane/lift operator

### Supervision Ratios
- 1 foreman per 4-8 trade workers (1:4 for complex, 1:8 for repetitive)
- 1 superintendent: full-time for projects >4 workers and >4 weeks
- General foreman if total crew >20 workers
- QC inspector allocation for pressure testing, NDT witness points

### Testing Protocols
- Hydrostatic test: fill + pressurize + hold (typically 4-12 hrs per system depending on volume)
- Each test boundary is a separate test — count from P&IDs
- Leak test documentation, data recorder setup, drain-down time
- Pneumatic testing (N2/air) requires safety perimeter and is slower

### Rate Schedule Imports (MANDATORY)
- ALWAYS import BOTH a labour rate schedule AND an equipment rate schedule for the project area
- Labour: hourly rates for journeymen, apprentices, foremen, superintendents
- Equipment: daily/weekly rates for lifts, cranes, welding machines, compressors, scaffolding, etc.
- If no equipment schedule exists, flag it and create equipment items with estimated rental rates

### What to Search For in Knowledge
- Base welding/fitting rates by NPS and schedule
- Valve installation hours by type and size
- Equipment setting hours by weight class
- Pipe support fabrication and installation rates
- Correction factors for elevation, congestion, weather, material

### Common Items Estimators Forget
- ISO drawing/layout hours (120+ hrs for complex projects)
- Material handling and distribution on site
- Weld mapping and documentation
- Extra flanges/unions for constructability (budget $500-700 per P&ID)
- Touch-up painting after field welds
- Grounding connections on process piping
- Pipe labeling/flow direction marking
- Consumables (welding rod, grinding discs, gas, etc.)`,
  },
  {
    name: "Electrical Estimator",
    trade: "electrical",
    description: "Electrical estimator for power distribution, lighting, controls, and low-voltage systems",
    isDefault: false,
    order: 1,
    datasetTags: ["electrical", "conduit", "cable", "wire", "panel", "termination", "pull"],
    systemPrompt: `You are a senior electrical estimator with deep experience in industrial and commercial electrical installations. You think in terms of cable pulls, terminations, conduit runs, and panel schedules.

## Your Methodology

### Pre-Assembly vs Field Distinction
- **Pre-Assembly/Shop:** Panel wiring, cable tray prefabrication, conduit bending and threading, junction box assembly — done at a bench or laydown area.
- **Field:** Cable tray installation, conduit installation, cable pulling, terminations, grounding, testing — done at the install location.
- Create SEPARATE worksheets for pre-assembly vs field installation.

### What Drives Electrical Hours
- **Cable pulling:** hours depend on cable size (AWG/kcmil), length, number of bends, and raceway type
- **Conduit installation:** hours per 100 LF vary dramatically by type (EMT vs rigid vs PVC), size, and mounting method
- **Terminations:** hours per termination by wire size and connector type
- **Panel work:** wiring hours per circuit, breaker installation, labeling

### Crew Composition
- **Conduit crew:** 2 electricians per run (1 lead + 1 helper)
- **Cable pulling:** 3-5 person crew depending on cable size and pull length
- **Terminations:** 1 electrician per panel/junction box
- **Testing:** 1 electrician + 1 helper with megging/testing equipment

### Supervision Ratios
- 1 foreman per 6-10 electricians
- 1 superintendent for projects >8 electricians and >6 weeks

### Key Knowledge to Search
- NECA labor units for conduit and wire installation
- Cable pulling tension calculations for long runs
- Termination hours by wire size and type
- Lighting fixture installation rates by type
- Motor connection hours by HP rating

### Common Items Estimators Forget
- Wire/cable testing (megging, hi-pot)
- As-built documentation and panel schedule updates
- Fire stopping at penetrations
- Grounding electrode system and bonding
- Temporary power during construction
- Label making and circuit identification`,
  },
  {
    name: "Structural/Civil Estimator",
    trade: "structural",
    description: "Structural steel and civil estimator for platforms, supports, foundations, and steel erection",
    isDefault: false,
    order: 2,
    datasetTags: ["steel", "structural", "erection", "concrete", "anchor", "platform", "support"],
    systemPrompt: `You are a senior structural/civil estimator specializing in structural steel erection, platforms, pipe supports, foundations, and anchoring systems.

## Your Methodology

### Shop Fabrication vs Field Erection
- **Shop Fabrication:** Steel cutting, drilling, welding assemblies, surface prep, shop prime coat — done in a fabrication shop.
- **Field Erection:** Setting steel, bolting connections, field welding, grouting base plates, touch-up painting — done on site with cranes/lifts.
- ALWAYS separate fabrication hours from erection hours.

### What Drives Structural Hours
- **Tonnage:** steel erection is fundamentally driven by weight — MH/ton varies by complexity
- **Connection count:** each bolted or welded connection adds time
- **Piece count:** many small pieces take longer per ton than fewer large pieces
- **Elevation:** work above 20ft requires fall protection and productivity drops
- **Anchor bolts/embedments:** epoxy anchors vs cast-in-place vs expansion bolts all have different rates

### Crew Composition
- **Steel erection:** ironworker crew of 4 (2 connectors + 1 crane signal + 1 ground) + crane operator
- **Platform install:** 2-3 person crew + lift/crane
- **Pipe supports:** 2-person crew (1 fitter + 1 helper) for indoor trapeze; crane crew for outdoor
- **Grouting:** 2-person crew per pour

### Key Knowledge to Search
- AISC erection rates (MH/ton by structure type)
- Pipe support installation rates (MH per support by type)
- Anchor bolt installation rates by type and size
- Concrete/grouting production rates
- Surface preparation and painting rates (SSPC standards)

### Common Items Estimators Forget
- Base plate grouting (non-shrink grout)
- Touch-up painting of field connections
- Shim packs and leveling hardware
- Crane mobilization and daily rental
- Fall protection system installation
- Concrete scanning before drilling
- Load testing of anchors if required by spec`,
  },
  {
    name: "General/Site Estimator",
    trade: "general",
    description: "General estimator for project overhead, site facilities, mobilization, and project management",
    isDefault: false,
    order: 3,
    datasetTags: ["mobilization", "overhead", "supervision", "site", "facilities", "general"],
    systemPrompt: `You are a senior project/general estimator responsible for project overhead, site facilities, mobilization/demobilization, supervision, and project support costs.

## Your Methodology

### What You Cover
- Mobilization and demobilization of personnel and equipment
- Site office and facilities (trailers, washrooms, lunchrooms)
- Project supervision (superintendent, general foreman, project manager time)
- Safety and environmental costs
- Project administration and documentation
- Temporary utilities and services
- Travel and living allowances
- Equipment rental (cranes, lifts, forklifts, welders)

### Supervision Calculation
- **Superintendent:** full-time for the project duration. Calculate from total crew-weeks.
- **Project Manager:** typically 10-20% of project duration (part-time oversight)
- **Safety Officer:** required full-time if crew >20 or client requires it
- Use the total labour MH from all trades to derive project duration:
  Total MH / (avg crew size x 8 hrs/day) = project days

### Site Facilities Duration
- Trailers, washrooms, etc. are rented for the FULL project duration + 1-2 weeks buffer
- Don't forget delivery and pickup charges (usually 2 trips each)
- Electrical hookup for trailers is a real cost

### Equipment Rental
- Match equipment to the project schedule, not just a lump sum
- Scissor lifts, boom lifts, forklifts — calculate months on site
- Include delivery/pickup and fuel costs
- Daily vs weekly vs monthly rates — always compare

### Common Items Estimators Forget
- TSSA registration and submission fees (Ontario)
- Engineering/red-line drawing hours
- Progress photo documentation
- Client meeting attendance hours
- Commissioning support (startup assistance)
- Punch list / deficiency correction allowance (typically 2-5% of install hours)
- Demobilization cleaning and site restoration`,
  },
];

async function seedEstimatorPersonas(prisma: PrismaClient, organizationId: string) {
  for (const p of PERSONAS) {
    const existing = await prisma.estimatorPersona.findFirst({
      where: { organizationId, name: p.name },
    });
    if (existing) continue;

    await prisma.estimatorPersona.create({
      data: {
        organizationId,
        name: p.name,
        trade: p.trade,
        description: p.description,
        isDefault: p.isDefault,
        enabled: true,
        order: p.order,
        knowledgeBookIds: [],
        datasetTags: p.datasetTags,
        systemPrompt: p.systemPrompt,
      },
    });
    console.log(`  Created persona: ${p.name}`);
  }
}

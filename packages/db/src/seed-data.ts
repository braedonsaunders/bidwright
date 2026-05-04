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
      calculationType: "tiered_rate", itemSource: "rate_schedule" as const,
      analyticsBucket: "labour" as string | null,
      editableFields: { quantity: true, cost: false, markup: false, price: false, tierUnits: true },
      unitLabels: {},
    },
    {
      name: "Equipment", entityType: "Equipment", shortform: "E", defaultUom: "DAY",
      validUoms: ["DAY", "WK", "MO", "EA"], color: "#f59e0b", order: 2,
      calculationType: "duration_rate", itemSource: "catalog" as const,
      analyticsBucket: "equipment" as string | null,
      editableFields: { quantity: true, cost: false, markup: false, price: false, tierUnits: true },
      unitLabels: {},
    },
    {
      name: "Material", entityType: "Material", shortform: "M", defaultUom: "EA",
      validUoms: ["EA", "LF", "SF", "CY", "TON", "GAL", "LB", "LS", "LOT", "SET"], color: "#22c55e", order: 3,
      calculationType: "manual", itemSource: "freeform" as const,
      analyticsBucket: "material" as string | null,
      editableFields: { quantity: true, cost: true, markup: true, price: false, tierUnits: false },
      unitLabels: {},
    },
    {
      name: "Subcontractor", entityType: "Subcontractor", shortform: "S", defaultUom: "LS",
      validUoms: ["EA", "LS", "HR"], color: "#8b5cf6", order: 4,
      calculationType: "manual", itemSource: "freeform" as const,
      analyticsBucket: "subcontractor" as string | null,
      editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: false },
      unitLabels: {},
    },
    {
      name: "Consumables", entityType: "Consumable", shortform: "C", defaultUom: "EA",
      validUoms: ["EA", "KG", "LB", "GAL"], color: "#6b7280", order: 5,
      calculationType: "quantity_markup", itemSource: "freeform" as const,
      analyticsBucket: "material" as string | null,
      editableFields: { quantity: true, cost: true, markup: true, price: false, tierUnits: false },
      unitLabels: {},
    },
    {
      name: "Rental Equipment", entityType: "RentalEquipment", shortform: "R", defaultUom: "DAY",
      validUoms: ["DAY", "WK", "MO", "HR"], color: "#ec4899", order: 6,
      calculationType: "duration_rate", itemSource: "rate_schedule" as const,
      analyticsBucket: "equipment" as string | null,
      editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: true },
      unitLabels: {},
    },
    {
      name: "Travel & Per Diem", entityType: "Travel", shortform: "T", defaultUom: "DAY",
      validUoms: ["DAY", "EA", "MI"], color: "#f97316", order: 7,
      calculationType: "manual", itemSource: "freeform" as const,
      analyticsBucket: null as string | null,
      editableFields: { quantity: true, cost: true, markup: true, price: true, tierUnits: false },
      unitLabels: {},
    },
    {
      name: "Other Charges", entityType: "OtherCharges", shortform: "O", defaultUom: "LS",
      validUoms: ["EA", "LS", "%"], color: "#ef4444", order: 8,
      calculationType: "direct_total", itemSource: "freeform" as const,
      analyticsBucket: null as string | null,
      editableFields: { quantity: false, cost: false, markup: false, price: true, tierUnits: false },
      unitLabels: {},
    },
    {
      name: "Allowances", entityType: "Allowance", shortform: "A", defaultUom: "LS",
      validUoms: ["EA", "LS"], color: "#14b8a6", order: 9,
      calculationType: "direct_total", itemSource: "freeform" as const,
      analyticsBucket: "allowance" as string | null,
      editableFields: { quantity: false, cost: false, markup: false, price: true, tierUnits: false },
      unitLabels: {},
    },
    {
      name: "Overhead", entityType: "Overhead", shortform: "H", defaultUom: "%",
      validUoms: ["%", "EA", "LS"], color: "#a855f7", order: 10,
      calculationType: "direct_total", itemSource: "freeform" as const,
      analyticsBucket: null as string | null,
      editableFields: { quantity: false, cost: false, markup: false, price: true, tierUnits: false },
      unitLabels: {},
    },
  ];

  for (const cat of categories) {
    await prisma.entityCategory.upsert({
      where: { organizationId_name: { organizationId, name: cat.name } },
      update: {
        entityType: cat.entityType, shortform: cat.shortform, defaultUom: cat.defaultUom,
        validUoms: cat.validUoms, editableFields: cat.editableFields as any,
        unitLabels: cat.unitLabels as any, calculationType: cat.calculationType,
        itemSource: cat.itemSource, analyticsBucket: cat.analyticsBucket,
        color: cat.color, order: cat.order, isBuiltIn: true, enabled: true,
      },
      create: {
        organizationId, name: cat.name, entityType: cat.entityType, shortform: cat.shortform,
        defaultUom: cat.defaultUom, validUoms: cat.validUoms, editableFields: cat.editableFields as any,
        unitLabels: cat.unitLabels as any, calculationType: cat.calculationType,
        itemSource: cat.itemSource, analyticsBucket: cat.analyticsBucket,
        color: cat.color, order: cat.order, isBuiltIn: true, enabled: true,
      },
    });
  }
}

export async function seedSampleProjects(prisma: PrismaClient, store: BidwrightStore, organizationId: string) {
  const entityCategories = await prisma.entityCategory.findMany({ where: { organizationId } });
  const categoryByName = new Map(entityCategories.map((category) => [category.name, category]));
  const fallbackCategory =
    categoryByName.get("Material") ??
    entityCategories.find((category) => category.enabled) ??
    entityCategories[0];
  if (!fallbackCategory) {
    throw new Error("Cannot seed sample worksheet items without at least one EntityCategory");
  }

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
        breakoutStyle: revision.breakoutStyle,
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
	                    entityCategory: { connect: { id: (categoryByName.get(i.category) ?? fallbackCategory).id } },
	                    id: i.id, category: i.category, entityType: i.entityType, entityName: i.entityName,
                    description: i.description, quantity: i.quantity, uom: i.uom,
                    cost: i.cost, markup: i.markup, price: i.price,
                    tierUnits: i.tierUnits ?? {},
                    lineOrder: i.lineOrder,
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
              id: i.id,
              catalogItem: { connect: { id: i.catalogItemId } },
              code: i.code, name: i.name,
              unit: i.unit, rates: i.rates as any, costRates: i.costRates as any, burden: i.burden,
              perDiem: i.perDiem, metadata: i.metadata as any, sortOrder: i.sortOrder,
            })),
        },
      },
    });
  }
}

export async function seedCustomersAndDepartments(prisma: PrismaClient, organizationId: string) {
  const customers = [
    { id: "cust_city_health", name: "City Health Authority", shortName: "CHA", phone: "(416) 555-0100", email: "procurement@cityhealth.example", website: "https://cityhealth.example", addressStreet: "200 University Ave", addressCity: "Toronto", addressProvince: "Ontario", addressPostalCode: "M5H 3C6", addressCountry: "Canada", notes: "Sample institutional client. Net-30 terms." },
    { id: "cust_northline_builders", name: "Northline Builders Ltd", shortName: "NBL", phone: "(403) 555-0200", email: "estimating@northline.example", website: "https://northline.example", addressStreet: "1500 Centre St N", addressCity: "Calgary", addressProvince: "Alberta", addressPostalCode: "T2E 2R8", addressCountry: "Canada", notes: "Sample general contractor. Repeat client for demo purposes." },
    { id: "cust_westfield_dev", name: "Westfield Development Group", shortName: "WDG", phone: "(604) 555-0300", email: "projects@westfield.example", website: "https://westfield.example", addressStreet: "888 Dunsmuir St, Suite 400", addressCity: "Vancouver", addressProvince: "British Columbia", addressPostalCode: "V6C 3K4", addressCountry: "Canada", notes: "Sample commercial developer. Mixed-use projects." },
    { id: "cust_summit_industrial", name: "Summit Industrial Services", shortName: "SIS", phone: "(905) 555-0400", email: "bids@summitindustrial.example", website: "https://summitindustrial.example", addressStreet: "45 Industrial Pkwy", addressCity: "Hamilton", addressProvince: "Ontario", addressPostalCode: "L8W 3N6", addressCountry: "Canada", notes: "Sample industrial maintenance client." },
  ];

  for (const c of customers) {
    await prisma.customer.create({ data: { ...c, organizationId } });
  }

  const contacts = [
    { id: "ccon_mercer", customerId: "cust_city_health", name: "Alex Mercer", title: "Director of Facilities", phone: "(416) 555-0101", email: "alex.mercer@cityhealth.example", isPrimary: true },
    { id: "ccon_park", customerId: "cust_city_health", name: "Jamie Park", title: "Procurement Manager", phone: "(416) 555-0102", email: "jamie.park@cityhealth.example", isPrimary: false },
    { id: "ccon_brooks", customerId: "cust_northline_builders", name: "Jordan Brooks", title: "Project Manager", phone: "(403) 555-0201", email: "jordan.brooks@northline.example", isPrimary: true },
    { id: "ccon_shah", customerId: "cust_northline_builders", name: "Taylor Shah", title: "Estimating Lead", phone: "(403) 555-0202", email: "taylor.shah@northline.example", isPrimary: false },
    { id: "ccon_lin", customerId: "cust_westfield_dev", name: "Morgan Lin", title: "VP Construction", phone: "(604) 555-0301", email: "morgan.lin@westfield.example", isPrimary: true },
    { id: "ccon_reid", customerId: "cust_summit_industrial", name: "Casey Reid", title: "Plant Manager", phone: "(905) 555-0401", email: "casey.reid@summitindustrial.example", isPrimary: true },
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

### Piping Estimation: SYSTEM FIRST, Then Weld Type
- **ALWAYS estimate per system/P&ID** — each chemical or process system has different pipe sizes, connection counts, and complexity
- Within each system, break down by weld/joint type: butt welds by NPS, socket welds, threaded, flanged
- Create line items PER SYSTEM (e.g. "ISO System — Shop Fabrication", "Pentane System — Field Install")
- Do NOT lump all systems into generic weld-type breakdowns — a system with 50× 6" butt welds is fundamentally different from one with 200× ½" threaded connections

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

### Supervision & Support Hour Ratios (TRADE-SPECIFIC)
- **Foreman hours:** Should be approximately 15-25% of total trade hours on a given worksheet. 1 foreman per 4-8 trade workers (1:4 for complex fabrication, 1:8 for repetitive install). One foreman covers ALL concurrent activities — not each activity sequentially.
- **Superintendent:** Full-time (40 hrs/week) for projects >4 workers and >4 weeks duration.
- **General foreman:** Add if total crew >20 workers.
- **ISO drawing/layout hours:** 5-10% of total fabrication hours. This is real engineering labour for translating P&IDs into fabrication drawings and producing red-line documentation. For complex projects with 10+ P&IDs, budget 120-200+ hours.
- **Testing/inspection hours:** 5-10% of total installation man-hours. Do NOT allocate testing hours equal to or greater than installation hours — testing is coordination-heavy but not labour-intensive.
- **Punch list resolution:** 2-5% of total project hours. This is a clean-up/correction allowance, not a full re-work budget.
- **QC inspector allocation:** Specific hours for pressure testing documentation, NDT witness points, TSSA support.

### Subcontracting (WHAT WE TYPICALLY SUB OUT)
- **Insulation:** ALWAYS subcontracted. Industrial insulation is specialty work done by insulation subcontractors (e.g. Vanos, Crossroads). Do NOT estimate as self-performed labour. Budget using these installed rates (per LF, by insulation sub):
  - Outdoor piping, 2" fiberglass + aluminum jacket: $25-45/LF installed (higher for small bore, lower for large runs)
  - Indoor piping, ½" closed-cell foam (Armaflex): $8-15/LF installed
  - Equipment insulation (pump skids, HX, valves): $500-2,000/piece depending on complexity
  - Metal-clad piping (outdoor jacketed): $30-50/LF installed
  - Break insulation out BY SYSTEM when getting sub-quotes (e.g. "Pentane outdoor — 2,000 LF @ $35/LF = $70K", "ISO indoor — 750 LF @ $12/LF = $9K"). This matches how subs price and how you negotiate.
  - Total insulation on a 6-system industrial piping project typically runs $150K-$350K. If your total is under $100K, your rates are too low.
- **Blasting/surface prep:** ALWAYS subcontracted to coatings specialists — do NOT estimate as self-performed labour. SSPC-SP6 commercial blast + prime is specialty work. Budget $15-25/LF for pipe blasting + primer by sub. For a project with 5,000+ LF of CS pipe, blasting sub is typically $15K-$40K.
- **Scaffolding:** Subcontracted if required. For piping projects, boom/scissor lifts are usually sufficient and included in equipment.
- **NDT/RT inspection:** Third-party NDT subcontractor for radiographic testing, ultrasonic, MPI. We provide coordination labour only.
- **Crane services:** Large crane lifts (>10 ton) for tanks and heavy equipment typically subcontracted to crane rental companies.
- **Pipe supports (outdoor structural):** Outdoor structural pipe supports (floor-mounted racks, stanchions, structural steel frames) are typically subcontracted for fabrication — the shop welds and cuts structural steel, galvanizes if required, and delivers to site. Budget $8K-$15K per ton fabricated + $3K-$8K crane/rigging for installation. Self-perform INDOOR supports only (trapeze hangers, beam clamps, unistrut — these are lighter and don't need crane/structural fab). Split pipe support worksheets into:
  - Indoor supports: self-performed (hangers, clamps, unistrut) — typically 0.5-1.5 MH/support
  - Outdoor supports: subcontracted fabrication + self-performed or crane-assisted installation
- If the project scope or user instructions specify additional subcontracted items, follow those instructions.

### Testing Protocols
- Hydrostatic test: fill + pressurize + hold (typically 4-12 hrs per system depending on volume)
- Each test boundary is a separate test — count from P&IDs
- Leak test documentation, data recorder setup, drain-down time
- Pneumatic testing (N2/air) requires safety perimeter and is slower

### Rate Schedule Imports (MANDATORY)
- ALWAYS import BOTH a labour rate schedule AND an equipment rate schedule for the project area
- Labour: hourly rates for journeymen, apprentices, foremen, superintendents
- Equipment: daily/weekly/monthly rates for lifts, cranes, welding machines, compressors, etc.
- Equipment items MUST use the Equipment rate schedule with tierUnits set to the rental duration (e.g. {"Monthly": 4} for 4 months)
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
- Consumables (welding rod, grinding discs, gas, etc.)
- TSSA registration and submission costs
- Mob/demob for BOTH crew AND equipment separately`,
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

### Supervision & Support Hour Ratios (TRADE-SPECIFIC)
- **Foreman hours:** 10-20% of total trade hours. 1 foreman per 6-10 electricians (1:6 for complex termination work, 1:10 for repetitive conduit runs).
- **Superintendent:** Full-time for projects >8 electricians and >6 weeks.
- **Testing/inspection hours:** 8-15% of total installation hours. Electrical testing (megging, hi-pot, loop checks) is more labour-intensive per circuit than mechanical testing.
- **Punch list / commissioning:** 3-5% of total project hours. Includes circuit troubleshooting and label verification.
- **As-built documentation:** 2-3% of total hours for panel schedule updates, cable routing as-builts.

### Subcontracting (WHAT WE TYPICALLY SUB OUT)
- **Fire alarm:** Often subcontracted to licensed fire alarm contractors.
- **Low voltage / data cabling:** Typically subcontracted to structured cabling specialists.
- **High voltage terminations:** May require specialist sub for >600V terminations.
- **Concrete coring/cutting:** Subcontracted for large penetrations.
- Follow project scope and user instructions for additional subcontracted items.

### Key Knowledge to Search
- Company labor units for conduit and wire installation
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

### Supervision & Support Hour Ratios (TRADE-SPECIFIC)
- **Foreman hours:** 12-20% of total trade hours. 1 foreman per 4-6 ironworkers (steel erection requires close supervision for safety).
- **Superintendent:** Full-time for projects >6 workers and >3 weeks.
- **Drawing/detailing hours:** 3-5% of fabrication hours for shop drawing review, field layout, and marking.
- **Testing hours:** Minimal for structural — primarily anchor bolt torque verification and weld inspection (1-3% of install hours).
- **Punch list:** 2-4% of total erection hours for alignment corrections, touch-up painting, and snag list items.

### Subcontracting (WHAT WE TYPICALLY SUB OUT)
- **Hot-dip galvanizing:** Subcontracted to galvanizing facilities.
- **Large crane services:** Mobile cranes >50 ton typically rented with operator from crane companies.
- **NDT (weld inspection):** Third-party CWI/UT inspection for structural welds.
- **Concrete/foundations:** Typically by civil contractor — structural erectors set steel on foundations built by others.
- Follow project scope and user instructions for additional subcontracted items.

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

### Support Hour Ratios (TRADE-SPECIFIC)
- **Project Manager:** 10-20% of project duration (part-time oversight). Full-time if project value >$2M.
- **Safety Officer:** Full-time if crew >20 or client requires it. Part-time (50%) for smaller crews.
- **Punch list / deficiency correction:** 2-5% of total trade install hours across all trades. This is the allowance for correcting deficiencies identified during final walkdown.
- **Commissioning support:** 1-3% of total project hours. Piping contractors typically provide startup assistance but do NOT own commissioning.
- **Documentation/as-builts:** Budget 40-80 hours for red-line documentation on projects with 10+ P&IDs.

### Common Items Estimators Forget
- TSSA registration and submission fees (Ontario)
- Engineering/red-line drawing hours
- Progress photo documentation
- Client meeting attendance hours
- Commissioning support (startup assistance)
- Demobilization cleaning and site restoration
- Electrical hookup for site trailers (real labour cost)
- Delivery/pickup charges for rental facilities (usually 2 trips each)`,
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

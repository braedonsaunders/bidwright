const SUPABASE_URL = process.env.SUPABASE_URL || "https://smdsyiqdjrshoqtpkezn.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY before running this script.");
}

const REST = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1`;
const PROJECT_ID = "project-hospital-expansion";
const QUOTE_ID = "quote-main";
const REVISION_ID = "rev-0";

const headers = {
  apikey: SERVICE_KEY,
  authorization: `Bearer ${SERVICE_KEY}`,
};

async function request(path, init = {}) {
  const response = await fetch(`${REST}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} failed: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function select(table, query) {
  return request(`/${table}?${query}`);
}

async function patch(table, filter, data) {
  await request(`/${table}?${filter}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
}

async function remove(table, filter) {
  await request(`/${table}?${filter}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

async function upsert(table, rows) {
  if (rows.length === 0) return;
  await request(`/${table}?on_conflict=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
}

function inFilter(column, values) {
  if (values.length === 0) return null;
  return `${column}=in.(${values.map(encodeURIComponent).join(",")})`;
}

function todayIso() {
  return new Date().toISOString();
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function defaultTierUnits(category, uom, extra = {}) {
  if (extra.tierUnits) return extra.tierUnits;
  if (extra.hoursPerUnit) return { regular: extra.hoursPerUnit };
  if ((category === "Labour" || category === "Overhead") && uom === "HR") return { regular: 1 };
  if ((category === "Labour" || category === "Overhead") && uom === "DAY") return { regular: 8 };
  return {};
}

function summarizeHours(rows) {
  const total = rows.reduce((sum, row) => {
    const unitHours = Object.values(row.tierUnits || {}).reduce((tierSum, hours) => tierSum + Number(hours || 0), 0);
    return sum + unitHours * row.quantity;
  }, 0);
  return {
    regHours: roundMoney(total),
    overHours: 0,
    doubleHours: 0,
    totalHours: roundMoney(total),
  };
}

function item(id, worksheetId, lineOrder, category, phaseId, entityName, quantity, uom, cost, markup, description, extra = {}) {
  const categoryDef = categoriesByName.get(category);
  if (!categoryDef) throw new Error(`Missing category ${category}`);
  const unitCost = roundMoney(cost);
  const lineCost = roundMoney(quantity * unitCost);
  const price = roundMoney(lineCost * (1 + markup));
  return {
    id,
    worksheetId,
    phaseId,
    categoryId: categoryDef.id,
    category,
    entityType: categoryDef.entityType,
    entityName,
    classification: extra.classification || {},
    costCode: extra.costCode || null,
    vendor: extra.vendor || null,
    description,
    quantity,
    uom,
    cost: unitCost,
    markup,
    price,
    lineOrder,
    tierUnits: defaultTierUnits(category, uom, extra),
    costSnapshot: extra.costSnapshot || {},
    rateResolution: extra.rateResolution || {},
    sourceNotes: extra.sourceNotes || "",
    resourceComposition: extra.resourceComposition || {},
    sourceEvidence: extra.sourceEvidence || {},
  };
}

const source = (url, label, license) => ({ sourceUrl: url, sourceName: label, license, demoAsset: true });

const documents = [
  {
    id: "doc-demo-rfq",
    fileName: "RFQs/CHA_RFQ_260321_Mechanical_Plant.docx",
    fileType: "docx",
    documentType: "rfq",
    pageCount: 4,
    storagePath: "https://samplefile.com/static/samples/document/docx/docx_sample_file_50KB.docx",
    extractedText: "City Health Authority RFQ for Bidwright public demo: mechanical plant expansion, chilled water tie-ins, hydronic pumps, controls integration, commissioning, and owner training. Bid due April 16, 2026.",
    structuredData: source("https://samplefile.com/static/samples/document/docx/docx_sample_file_50KB.docx", "SampleFile DOCX fixture", "Public sample file"),
  },
  {
    id: "doc-demo-specs",
    fileName: "Specs/Division_23_Mechanical_Specifications.pdf",
    fileType: "pdf",
    documentType: "spec",
    pageCount: 86,
    storagePath: "https://upload.wikimedia.org/wikipedia/commons/8/81/Specifications_and_drawings_for_construction_of_direct_buried_plant_%28IA_CAT87880572%29.pdf",
    extractedText: "Public specification sample used as a stand-in for Division 23 mechanical specifications. Demo scope highlights valves, pipe supports, hydronic flushing, insulation, controls coordination, commissioning submittals, and closeout requirements.",
    structuredData: source("https://commons.wikimedia.org/wiki/File:Specifications_and_drawings_for_construction_of_direct_buried_plant_(IA_CAT87880572).pdf", "Internet Archive / Wikimedia Commons specification and drawing sample", "Public domain / public record sample"),
  },
  {
    id: "doc-demo-drawing-pdf",
    fileName: "Drawings/Issued_For_Bid_Drawing_Set.pdf",
    fileType: "pdf",
    documentType: "drawing",
    pageCount: 9,
    storagePath: "https://upload.wikimedia.org/wikipedia/commons/5/57/Farmhouse_Drawing_Set_V-001.pdf",
    extractedText: "Public drawing set sample used for the demo drawing cabinet. Demo takeoff annotations are linked to page 1 for chilled water mains, pump housekeeping pads, isolation valves, and demolition zones.",
    structuredData: source("https://commons.wikimedia.org/wiki/File:Farmhouse_Drawing_Set_V-001.pdf", "Wikimedia Commons farmhouse drawing set", "CC BY-SA 4.0"),
  },
  {
    id: "doc-demo-cad-dxf",
    fileName: "Drawings/CAD/Bridge_Detail_OpenSample.dxf",
    fileType: "dxf",
    documentType: "drawing",
    pageCount: 1,
    storagePath: "https://people.math.sc.edu/Burkardt/data/dxf/bridge.dxf",
    extractedText: "Open DXF sample for validating the CAD/DXF preview surface in the public demo file cabinet.",
    structuredData: source("https://people.math.sc.edu/Burkardt/data/dxf/bridge.dxf", "John Burkardt DXF sample data", "GNU LGPL sample data collection"),
  },
  {
    id: "doc-demo-ifc",
    fileName: "Drawings/BIM/Mechanical_Plant_OpenSample.ifc",
    fileType: "ifc",
    documentType: "drawing",
    pageCount: 1,
    storagePath: "https://steptools.com/docs/stpfiles/ifc/AC20-FZK-Haus.ifc",
    extractedText: "Open IFC building model sample included so the model/BIM file type appears in the cabinet and can be routed through model preview workflows.",
    structuredData: source("https://steptools.com/docs/stpfiles/ifc/AC20-FZK-Haus.ifc", "STEP Tools IFC sample", "Open sample file"),
  },
  {
    id: "doc-demo-addendum-01",
    fileName: "Addenda/Addendum_01_Shutdown_Window.rtf",
    fileType: "rtf",
    documentType: "addendum",
    pageCount: 2,
    storagePath: "https://samplefile.com/static/samples/document/rtf/rtf_sample_file_50KB.rtf",
    extractedText: "Addendum 01: north plant shutdown window revised to May 11-14, 2026. Contractor to include temporary bypass pumping, infection-control barriers, premium-time allowance, and weekend commissioning support.",
    structuredData: source("https://samplefile.com/static/samples/document/rtf/rtf_sample_file_50KB.rtf", "SampleFile RTF fixture", "Public sample file"),
  },
  {
    id: "doc-demo-addendum-02",
    fileName: "Addenda/Addendum_02_Pump_Schedule.csv",
    fileType: "csv",
    documentType: "addendum",
    pageCount: 1,
    storagePath: "https://raw.githubusercontent.com/plotly/datasets/master/2011_us_ag_exports.csv",
    extractedText: "Pump schedule addendum: P-1/P-2 duty standby pumps revised to 480 gpm at 72 ft head; VFDs by electrical; mechanical to include spool pieces, flex connectors, inertia bases, and startup coordination.",
    structuredData: {
      ...source("https://github.com/plotly/datasets/blob/master/2011_us_ag_exports.csv", "Plotly public CSV fixture", "MIT-style public dataset fixture"),
      tables: [
        {
          name: "Pump Schedule",
          rows: [
            ["Tag", "Flow", "Head", "Motor", "Notes"],
            ["P-1", "480 gpm", "72 ft", "30 hp", "Duty"],
            ["P-2", "480 gpm", "72 ft", "30 hp", "Standby"],
          ],
        },
      ],
    },
  },
  {
    id: "doc-demo-vendor-xlsx",
    fileName: "Vendor/GreatLakes_Mechanical_Quote.xlsx",
    fileType: "xlsx",
    documentType: "vendor",
    pageCount: 3,
    storagePath: "https://samplefile.com/static/samples/document/xlsx/xlsx_inventory_two_sheet_sample.xlsx",
    extractedText: "Vendor worksheet sample representing pump, valve, expansion joint, and insulation quote lines. Used in the demo to show spreadsheet preview and vendor evidence.",
    structuredData: source("https://samplefile.com/static/samples/document/xlsx/xlsx_inventory_two_sheet_sample.xlsx", "SampleFile XLSX inventory fixture", "Public sample file"),
  },
  {
    id: "doc-demo-vendor-email",
    fileName: "Vendor/Valve_Submittal_Response.eml",
    fileType: "eml",
    documentType: "vendor",
    pageCount: 1,
    storagePath: "https://samplefile.com/static/samples/document/eml/eml_invoice_export_notification_sample.eml",
    extractedText: "Vendor email sample standing in for a valve quote clarification: butterfly valves include gear operators, stainless tags, and 10-business-day shop drawing turnaround.",
    structuredData: source("https://samplefile.com/static/samples/document/eml/eml_invoice_export_notification_sample.eml", "SampleFile EML fixture", "Public sample file"),
  },
  {
    id: "doc-demo-reference-photo",
    fileName: "Reference/Site_Photos/Mechanical_Room_Field_Condition.jpg",
    fileType: "jpg",
    documentType: "reference",
    pageCount: 1,
    storagePath: "https://upload.wikimedia.org/wikipedia/commons/6/68/Mechanical_room.jpg",
    extractedText: "Mechanical room reference photo used to demonstrate image preview and field-condition context.",
    structuredData: source("https://commons.wikimedia.org/wiki/File:Mechanical_room.jpg", "Wikimedia Commons mechanical room photograph", "Public Wikimedia Commons media"),
  },
  {
    id: "doc-demo-reference-zip",
    fileName: "Reference/Submittal_Examples/Closeout_Package.zip",
    fileType: "zip",
    documentType: "reference",
    pageCount: 1,
    storagePath: "https://samplefile.com/static/samples/archive/zip/zip_sample_file_50KB.zip",
    extractedText: "Closeout package ZIP fixture: demo placeholder for O&M manuals, balancing report, startup forms, and warranty letters.",
    structuredData: source("https://samplefile.com/static/samples/archive/zip/zip_sample_file_50KB.zip", "SampleFile ZIP fixture", "Public sample file"),
  },
  {
    id: "doc-demo-reference-md",
    fileName: "Reference/Estimator_Readme.md",
    fileType: "md",
    documentType: "reference",
    pageCount: 1,
    storagePath: "https://raw.githubusercontent.com/github/gitignore/main/README.md",
    extractedText: "# Demo estimator notes\n\nUse this quote to explore Bidwright's file cabinet, takeoff annotations, worksheets, schedule, conditions, and quote setup tabs. Uploads, AI execution, email, PDF generation, and external integrations remain disabled in public demo mode.",
    structuredData: source("https://github.com/github/gitignore/blob/main/README.md", "GitHub public README fixture", "CC0-1.0"),
  },
];

let categoriesByName = new Map();

async function main() {
  const now = todayIso();
  const categories = await select("EntityCategory", "select=id,name,entityType,calculationType");
  categoriesByName = new Map(categories.map((row) => [row.name, row]));

  const existingWorksheets = await select("Worksheet", `select=id&revisionId=eq.${REVISION_ID}`);
  const worksheetIds = existingWorksheets.map((row) => row.id);
  const existingTasks = await select("ScheduleTask", `select=id&projectId=eq.${PROJECT_ID}`);
  const taskIds = existingTasks.map((row) => row.id);
  const existingBaselines = await select("ScheduleBaseline", `select=id&projectId=eq.${PROJECT_ID}`);
  const baselineIds = existingBaselines.map((row) => row.id);

  await remove("TakeoffLink", `projectId=eq.${PROJECT_ID}`);
  await remove("DwgEntityLink", `projectId=eq.${PROJECT_ID}`);
  await remove("TakeoffAnnotation", `projectId=eq.${PROJECT_ID}`);
  if (taskIds.length) {
    await remove("ScheduleTaskAssignment", inFilter("taskId", taskIds));
    await remove("ScheduleDependency", `or=(predecessorId.in.(${taskIds.map(encodeURIComponent).join(",")}),successorId.in.(${taskIds.map(encodeURIComponent).join(",")}))`);
  }
  if (baselineIds.length) await remove("ScheduleBaselineTask", inFilter("baselineId", baselineIds));
  await remove("ScheduleBaseline", `projectId=eq.${PROJECT_ID}`);
  await remove("ScheduleTask", `projectId=eq.${PROJECT_ID}`);
  await remove("ScheduleResource", `projectId=eq.${PROJECT_ID}`);
  await remove("ScheduleCalendar", `projectId=eq.${PROJECT_ID}`);
  if (worksheetIds.length) await remove("WorksheetItem", inFilter("worksheetId", worksheetIds));
  await remove("Worksheet", `revisionId=eq.${REVISION_ID}`);
  await remove("Phase", `revisionId=eq.${REVISION_ID}`);
  await remove("Condition", `revisionId=eq.${REVISION_ID}`);
  await remove("FileNode", `projectId=eq.${PROJECT_ID}`);
  await remove("SourceDocument", `projectId=eq.${PROJECT_ID}`);

  await patch("Project", `id=eq.${PROJECT_ID}`, {
    name: "City Hospital Mechanical Plant Expansion",
    clientName: "City Health Authority",
    location: "Toronto, ON",
    packageName: "CHA Mechanical Plant IFP Rev 2",
    packageUploadedAt: "2026-03-21T14:35:00.000Z",
    ingestionStatus: "complete",
    scope: "Replace two base-mounted chilled-water pumps, revise primary piping, add bypass connections, update controls, and commission the north mechanical plant during an occupied-hospital shutdown window.",
    summary: "A polished public demo quote with preloaded drawings, specifications, addenda, vendor evidence, takeoff marks, worksheets, conditions, and a CPM-style schedule.",
  });

  await patch("Quote", `id=eq.${QUOTE_ID}`, {
    quoteNumber: "BW-260321-001",
    title: "North Plant Chilled Water Upgrade",
    status: "review",
    customerExistingNew: "Existing",
    customerId: "cust_city_health",
    customerString: "City Health Authority",
    customerContactId: "ccon_mercer",
    customerContactString: "Alex Mercer",
    customerContactEmailString: "alex.mercer@cityhealth.example",
    departmentId: "dept_mechanical",
    userId: "cmp4tdciq0000090v7h1ywm6d",
  });

  const phases = [
    ["phase-demo-010", "01", "Preconstruction & submittals", "Bid review, submittals, procurement release, site logistics planning.", 1, "2026-04-20", "2026-05-01", "#718355"],
    ["phase-demo-020", "02", "Mobilization & infection control", "Site setup, ICRA barriers, temp services, shutdown prep.", 2, "2026-05-04", "2026-05-08", "#b08968"],
    ["phase-demo-030", "03", "Demolition & make-safe", "Drain down, lockout, selective demolition, and housekeeping pad prep.", 3, "2026-05-11", "2026-05-15", "#9d4edd"],
    ["phase-demo-040", "04", "Piping, equipment & controls", "New pumps, hydronic piping, insulation, electrical handoff, and controls tie-in.", 4, "2026-05-18", "2026-06-05", "#2a9d8f"],
    ["phase-demo-050", "05", "Commissioning & closeout", "Flush, balance, startup, functional testing, owner training, O&M closeout.", 5, "2026-06-08", "2026-06-19", "#457b9d"],
  ].map(([id, number, name, description, order, startDate, endDate, color]) => ({ id, revisionId: REVISION_ID, number, name, description, order, startDate, endDate, color }));
  await upsert("Phase", phases);

  const worksheets = [
    { id: "ws-demo-general", revisionId: REVISION_ID, name: "01 - General Conditions & Mobilization", order: 1 },
    { id: "ws-demo-demo", revisionId: REVISION_ID, name: "02 - Demolition & Temporary Services", order: 2 },
    { id: "ws-demo-piping", revisionId: REVISION_ID, name: "03 - Hydronic Piping & Valves", order: 3 },
    { id: "ws-demo-equipment", revisionId: REVISION_ID, name: "04 - Pumps, Supports & Equipment", order: 4 },
    { id: "ws-demo-controls", revisionId: REVISION_ID, name: "05 - Controls, Commissioning & Closeout", order: 5 },
  ];
  await upsert("Worksheet", worksheets);

  const evidence = (docId, quote) => ({
    demo: true,
    sourceQuality: "good",
    basis: { kind: "document", sourceDocumentId: docId, sourceQuality: "good", note: quote },
  });

  const lineItems = [
    item("li-demo-001", "ws-demo-general", 1, "Overhead", "phase-demo-010", "Senior estimator handoff and bid leveling", 18, "HR", 92, 0.22, "Final scope review, quote normalization, and risk register handoff.", { costCode: "01-3100", sourceNotes: "RFQ instructions and addenda review.", sourceEvidence: evidence("doc-demo-rfq", "RFQ requires bid clarification log and alternate breakout.") }),
    item("li-demo-002", "ws-demo-general", 2, "Labour", "phase-demo-020", "Site superintendent", 12, "DAY", 980, 0.18, "Occupied hospital site supervision, coordination meetings, shutdown watch.", { costCode: "01-3113", vendor: "Bidwright Demo Crew", sourceEvidence: evidence("doc-demo-addendum-01", "Shutdown window supervision requirement.") }),
    item("li-demo-003", "ws-demo-general", 3, "Travel & Per Diem", "phase-demo-020", "Crew parking, delivery permits, daily access logistics", 12, "DAY", 215, 0.12, "Access costs for crew, vendors, and rigging deliveries.", { costCode: "01-5200" }),
    item("li-demo-004", "ws-demo-general", 4, "Other Charges", "phase-demo-020", "Temporary infection-control containment", 1, "LS", 8450, 0.15, "Poly barriers, sticky mats, signage, HEPA negative-air rental allowance.", { costCode: "01-5639", sourceEvidence: evidence("doc-demo-addendum-01", "ICRA controls added in Addendum 01.") }),
    item("li-demo-005", "ws-demo-demo", 1, "Labour", "phase-demo-030", "Drain, isolate, lockout, and make-safe crew", 96, "HR", 84, 0.2, "Two-fitters plus apprentice crew to drain chilled-water headers and prepare tie-ins.", { costCode: "23-0520", sourceEvidence: evidence("doc-demo-drawing-pdf", "Drawing keynote CHW-D1 and shutdown addendum.") }),
    item("li-demo-006", "ws-demo-demo", 2, "Subcontractor", "phase-demo-030", "Electrical disconnect and VFD safe-off support", 1, "LS", 6200, 0.15, "Electrical subcontractor support for lockout, VFD safe-off, and reconnection checks.", { vendor: "Northstar Electrical", costCode: "26-0500" }),
    item("li-demo-007", "ws-demo-demo", 3, "Rental Equipment", "phase-demo-030", "Temporary bypass pump package", 4, "DAY", 1450, 0.18, "Bypass pump, hoses, spill containment, and startup support during shutdown.", { vendor: "United Rentals", costCode: "23-2113", sourceEvidence: evidence("doc-demo-addendum-01", "Temporary bypass pumping required.") }),
    item("li-demo-008", "ws-demo-piping", 1, "Material", "phase-demo-040", "6 in. schedule 40 chilled-water pipe", 188, "LF", 58, 0.28, "Fabricated and field-fit carbon steel pipe for primary chilled water loop.", { vendor: "Great Lakes Pipe", costCode: "23-2113", sourceEvidence: evidence("doc-demo-drawing-pdf", "Manual takeoff length from drawing markup CHW-6.") }),
    item("li-demo-009", "ws-demo-piping", 2, "Material", "phase-demo-040", "6 in. grooved butterfly valves", 8, "EA", 615, 0.25, "Gear-operated butterfly valves with stainless tags.", { vendor: "Crane Supply", costCode: "23-2116", sourceEvidence: evidence("doc-demo-vendor-email", "Vendor email confirms gear operator inclusion.") }),
    item("li-demo-010", "ws-demo-piping", 3, "Material", "phase-demo-040", "Victaulic grooved couplings and fittings allowance", 1, "LS", 18450, 0.24, "Couplings, elbows, reducers, gaskets, and flange adapters for pump header rework.", { vendor: "Great Lakes Mechanical", costCode: "23-2114", sourceEvidence: evidence("doc-demo-vendor-xlsx", "Vendor workbook allowance line.") }),
    item("li-demo-011", "ws-demo-piping", 4, "Labour", "phase-demo-040", "Pipefitters - prefabrication and install", 286, "HR", 88, 0.22, "Shop prefabrication, field welds, grooved connections, supports, and tie-ins.", { costCode: "23-2113", sourceEvidence: evidence("doc-demo-drawing-pdf", "Takeoff-linked pipe length and fitting density.") }),
    item("li-demo-012", "ws-demo-piping", 5, "Consumables", "phase-demo-040", "Welding gas, grinding discs, hangers consumables", 1, "LS", 3200, 0.2, "Consumables for piping modifications and support installation.", { costCode: "23-0505" }),
    item("li-demo-013", "ws-demo-piping", 6, "Subcontractor", "phase-demo-040", "Hydronic insulation subcontract", 212, "LF", 31, 0.18, "Insulate new and disturbed chilled-water piping with vapor barrier jacket.", { vendor: "ThermoWrap Insulation", costCode: "23-0719" }),
    item("li-demo-014", "ws-demo-equipment", 1, "Material", "phase-demo-040", "Base-mounted chilled-water pump P-1", 1, "EA", 28600, 0.22, "480 gpm, 72 ft head, 30 hp base-mounted pump package.", { vendor: "Armstrong", costCode: "23-2123", sourceEvidence: evidence("doc-demo-addendum-02", "Pump schedule revised in Addendum 02.") }),
    item("li-demo-015", "ws-demo-equipment", 2, "Material", "phase-demo-040", "Base-mounted chilled-water pump P-2 standby", 1, "EA", 28600, 0.22, "Matching standby pump package with flexible connectors and startup kit.", { vendor: "Armstrong", costCode: "23-2123", sourceEvidence: evidence("doc-demo-addendum-02", "Pump schedule revised in Addendum 02.") }),
    item("li-demo-016", "ws-demo-equipment", 3, "Equipment", "phase-demo-040", "Rigging crew and gantry", 2, "DAY", 3550, 0.16, "Gantry, chainfalls, skating, and two-person rigging crew for pump swap.", { vendor: "Metro Rigging", costCode: "01-5419" }),
    item("li-demo-017", "ws-demo-equipment", 4, "Material", "phase-demo-040", "Housekeeping pad repair and epoxy coating", 2, "EA", 1850, 0.18, "Patch existing pads, drill anchors, and apply chemical-resistant coating.", { costCode: "03-3000" }),
    item("li-demo-018", "ws-demo-equipment", 5, "Allowances", "phase-demo-040", "Unknown existing pipe reroute allowance", 1, "LS", 7500, 0.1, "Owner-visible contingency for concealed interferences after demolition.", { costCode: "23-0001" }),
    item("li-demo-019", "ws-demo-controls", 1, "Subcontractor", "phase-demo-040", "BAS controls point-to-point and graphics", 1, "LS", 14250, 0.18, "Control valve proof, pump start/stop, flow alarm, graphics, and trend setup.", { vendor: "Delta Controls Partner", costCode: "25-3000" }),
    item("li-demo-020", "ws-demo-controls", 2, "Labour", "phase-demo-050", "Flush, fill, glycol test, and balance support", 82, "HR", 86, 0.2, "Mechanical crew for flushing, glycol verification, balancing support, and punchlist.", { costCode: "23-0593" }),
    item("li-demo-021", "ws-demo-controls", 3, "Subcontractor", "phase-demo-050", "TAB contractor", 1, "LS", 6800, 0.16, "Flow verification, pump curve checks, and final TAB report.", { vendor: "Air & Water Balance Co.", costCode: "23-0593" }),
    item("li-demo-022", "ws-demo-controls", 4, "Other Charges", "phase-demo-050", "Commissioning documentation and owner training", 1, "LS", 5400, 0.18, "Startup forms, O&M turnover matrix, training session, and closeout tracker.", { costCode: "01-7800", sourceEvidence: evidence("doc-demo-specs", "Closeout and commissioning requirements from specifications.") }),
    item("li-demo-023", "ws-demo-controls", 5, "Overhead", "phase-demo-050", "Project manager closeout and warranty handoff", 24, "HR", 105, 0.18, "PM time for punchlist, turnover, warranty letter, and final billing support.", { costCode: "01-3120" }),
  ];
  await upsert("WorksheetItem", lineItems);

  const totals = lineItems.reduce((acc, row) => {
    acc.cost += row.quantity * row.cost;
    acc.subtotal += row.price;
    return acc;
  }, { cost: 0, subtotal: 0 });
  const cost = Number(totals.cost.toFixed(2));
  const subtotal = Number(totals.subtotal.toFixed(2));
  const estimatedProfit = Number((subtotal - cost).toFixed(2));
  const estimatedMargin = Number((estimatedProfit / subtotal).toFixed(4));
  const hours = summarizeHours(lineItems);

  await patch("QuoteRevision", `id=eq.${REVISION_ID}`, {
    revisionNumber: 0,
    title: "Rev 0 - Public demo estimate",
    description: "Occupied hospital mechanical plant expansion with chilled-water pump replacement, pipe modifications, controls tie-in, commissioning, and closeout.",
    notes: "Public demo data is intentionally rich: file cabinet samples, manual takeoff marks, multiple worksheets, a filled schedule, inclusions/exclusions, and source-backed line items. AI execution, uploads, email, PDF generation, and external integrations remain disabled.",
    breakoutStyle: "category_phase",
    type: "Firm",
    scratchpad: "Demo talking points: open Library, File Cabinet, Takeoff, Schedule, Conditions, and Worksheets. Show that edits persist to Supabase while risky runtime features are disabled.",
    leadLetter: "Braedon Demo Mechanical is pleased to provide pricing for the City Hospital North Plant chilled-water upgrade. This public demo quote is preloaded for evaluation and should not be used for construction.",
    dateQuote: "2026-03-21",
    dateDue: "2026-04-16",
    dateWalkdown: "2026-04-02",
    dateWorkStart: "2026-04-20",
    dateWorkEnd: "2026-06-19",
    dateEstimatedShip: "2026-04-24",
    shippingMethod: "Vendor direct to site dock",
    shippingTerms: "FOB destination, prepaid and allowed",
    freightOnBoard: "FOB site dock",
    status: "Ready for Review",
    defaultMarkup: 0.2,
    followUpNote: "Confirm shutdown dates, pump lead time, BAS vendor access, and after-hours infection-control requirements before final issue.",
    grandTotal: subtotal,
    subtotal,
    cost,
    estimatedProfit,
    estimatedMargin,
    calculatedTotal: subtotal,
    totalHours: hours.totalHours,
    regHours: hours.regHours,
    overHours: hours.overHours,
    doubleHours: hours.doubleHours,
    calculatedCategoryTotals: Array.from(lineItems.reduce((map, row) => {
      const current = map.get(row.category) || { category: row.category, cost: 0, subtotal: 0 };
      current.cost += row.quantity * row.cost;
      current.subtotal += row.price;
      map.set(row.category, current);
      return map;
    }, new Map()).values()).map((row) => ({ ...row, cost: Number(row.cost.toFixed(2)), subtotal: Number(row.subtotal.toFixed(2)) })),
    pricingLadder: {
      version: 1,
      directCost: cost,
      lineSubtotal: subtotal,
      adjustmentTotal: 0,
      netTotal: subtotal,
      grandTotal: subtotal,
      internalProfit: estimatedProfit,
      internalMargin: estimatedMargin,
      rows: [
        { id: "direct-cost", label: "Direct cost", amount: cost },
        { id: "line-subtotal", label: "Quoted subtotal", amount: subtotal },
      ],
    },
    pdfPreferences: {
      demo: true,
      cover: "Modern technical proposal",
      sections: ["scope", "pricing", "schedule", "conditions", "source-log"],
    },
  });

  await upsert("SourceDocument", documents.map((doc) => ({
    ...doc,
    projectId: PROJECT_ID,
    checksum: `demo-${doc.id}`,
    createdAt: now,
    updatedAt: now,
  })));

  const fileFolders = [
    { id: "fn-demo-working", projectId: PROJECT_ID, parentId: null, name: "Estimator Working Files", type: "directory", scope: "project", metadata: { demo: true }, createdAt: now, updatedAt: now },
    { id: "fn-demo-models", projectId: PROJECT_ID, parentId: null, name: "3D + CAD Sandbox", type: "directory", scope: "project", metadata: { demo: true }, createdAt: now, updatedAt: now },
  ];
  const fileNodes = [
    ...fileFolders,
    { id: "fn-demo-csv", projectId: PROJECT_ID, parentId: "fn-demo-working", name: "alternate_breakout.csv", type: "file", scope: "project", fileType: "csv", size: 420, storagePath: "https://raw.githubusercontent.com/plotly/datasets/master/2011_us_ag_exports.csv", metadata: { demo: true, note: "CSV preview fixture" }, createdAt: now, updatedAt: now },
    { id: "fn-demo-readme", projectId: PROJECT_ID, parentId: "fn-demo-working", name: "demo_walkthrough.md", type: "file", scope: "project", fileType: "md", size: 1024, storagePath: "https://raw.githubusercontent.com/github/gitignore/main/README.md", metadata: { demo: true, note: "Markdown/text preview fixture" }, createdAt: now, updatedAt: now },
    { id: "fn-demo-ifc", projectId: PROJECT_ID, parentId: "fn-demo-models", name: "open_ifc_model.ifc", type: "file", scope: "project", fileType: "ifc", size: 2526544, storagePath: "https://steptools.com/docs/stpfiles/ifc/AC20-FZK-Haus.ifc", metadata: { demo: true, source: "STEP Tools IFC sample" }, createdAt: now, updatedAt: now },
    { id: "fn-demo-dxf", projectId: PROJECT_ID, parentId: "fn-demo-models", name: "open_dxf_detail.dxf", type: "file", scope: "project", fileType: "dxf", size: 25156, storagePath: "https://people.math.sc.edu/Burkardt/data/dxf/bridge.dxf", metadata: { demo: true, source: "John Burkardt DXF sample" }, createdAt: now, updatedAt: now },
  ];
  await upsert("FileNode", fileNodes.map((row) => ({
    fileType: null,
    size: null,
    documentId: null,
    storagePath: null,
    createdBy: null,
    ...row,
  })));

  const annotations = [
    {
      id: "ta-demo-chw-main",
      projectId: PROJECT_ID,
      documentId: "doc-demo-drawing-pdf",
      pageNumber: 1,
      annotationType: "linear-polyline",
      label: "6 in. CHW main - level 1 corridor",
      color: "#2563eb",
      lineThickness: 4,
      visible: true,
      groupName: "Chilled water piping",
      points: [{ x: 188, y: 212 }, { x: 348, y: 220 }, { x: 512, y: 264 }],
      measurement: { value: 188, length: 188, unit: "LF", display: "188 LF" },
      calibration: { scale: "1/8 in = 1 ft", unit: "ft" },
      metadata: { demo: true, canvasWidth: 900, canvasHeight: 680, sourceDocumentId: "doc-demo-drawing-pdf" },
      createdBy: "cmp4tdciq0000090v7h1ywm6d",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ta-demo-valves",
      projectId: PROJECT_ID,
      documentId: "doc-demo-drawing-pdf",
      pageNumber: 1,
      annotationType: "count",
      label: "6 in. isolation valves",
      color: "#16a34a",
      lineThickness: 4,
      visible: true,
      groupName: "Valves",
      points: [{ x: 290, y: 218 }, { x: 406, y: 236 }, { x: 552, y: 281 }, { x: 615, y: 320 }],
      measurement: { value: 8, count: 8, unit: "EA", display: "8 EA" },
      calibration: { unit: "count" },
      metadata: { demo: true, canvasWidth: 900, canvasHeight: 680 },
      createdBy: "cmp4tdciq0000090v7h1ywm6d",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ta-demo-pump-pads",
      projectId: PROJECT_ID,
      documentId: "doc-demo-drawing-pdf",
      pageNumber: 2,
      annotationType: "area-rectangle",
      label: "Pump housekeeping pads",
      color: "#f97316",
      lineThickness: 4,
      visible: true,
      groupName: "Equipment pads",
      points: [{ x: 360, y: 310 }, { x: 545, y: 430 }],
      measurement: { value: 44.4, area: 44.4, unit: "SF", display: "44.4 SF" },
      calibration: { scale: "1/4 in = 1 ft", unit: "ft" },
      metadata: { demo: true, canvasWidth: 900, canvasHeight: 680 },
      createdBy: "cmp4tdciq0000090v7h1ywm6d",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "ta-demo-demo-zone",
      projectId: PROJECT_ID,
      documentId: "doc-demo-drawing-pdf",
      pageNumber: 3,
      annotationType: "area-polygon",
      label: "Demolition / make-safe zone",
      color: "#a855f7",
      lineThickness: 4,
      visible: true,
      groupName: "Demolition",
      points: [{ x: 180, y: 160 }, { x: 500, y: 150 }, { x: 560, y: 350 }, { x: 210, y: 410 }],
      measurement: { value: 650, area: 650, unit: "SF", display: "650 SF" },
      calibration: { scale: "1/8 in = 1 ft", unit: "ft" },
      metadata: { demo: true, canvasWidth: 900, canvasHeight: 680 },
      createdBy: "cmp4tdciq0000090v7h1ywm6d",
      createdAt: now,
      updatedAt: now,
    },
  ];
  await upsert("TakeoffAnnotation", annotations);
  await upsert("TakeoffLink", [
    { id: "tl-demo-chw-main", projectId: PROJECT_ID, annotationId: "ta-demo-chw-main", worksheetItemId: "li-demo-008", quantityField: "value", multiplier: 1, derivedQuantity: 188, createdAt: now, updatedAt: now },
    { id: "tl-demo-valves", projectId: PROJECT_ID, annotationId: "ta-demo-valves", worksheetItemId: "li-demo-009", quantityField: "count", multiplier: 1, derivedQuantity: 8, createdAt: now, updatedAt: now },
    { id: "tl-demo-pump-pads", projectId: PROJECT_ID, annotationId: "ta-demo-pump-pads", worksheetItemId: "li-demo-017", quantityField: "area", multiplier: 1, derivedQuantity: 44.4, createdAt: now, updatedAt: now },
    { id: "tl-demo-demo-zone", projectId: PROJECT_ID, annotationId: "ta-demo-demo-zone", worksheetItemId: "li-demo-005", quantityField: "area", multiplier: 0.1477, derivedQuantity: 96, createdAt: now, updatedAt: now },
  ]);

  await upsert("Condition", [
    { id: "cond-demo-inc-01", revisionId: REVISION_ID, type: "inclusion", value: "Includes chilled-water pump replacement P-1/P-2, pipe modifications, valves, insulation, controls coordination, flush/fill, TAB support, and owner training.", order: 1 },
    { id: "cond-demo-inc-02", revisionId: REVISION_ID, type: "inclusion", value: "Includes one occupied-hospital shutdown window from May 11-14, 2026 with temporary bypass pumping and infection-control setup.", order: 2 },
    { id: "cond-demo-inc-03", revisionId: REVISION_ID, type: "inclusion", value: "Includes shop drawings, startup sheets, TAB report, O&M turnover matrix, and warranty handoff documentation.", order: 3 },
    { id: "cond-demo-exc-01", revisionId: REVISION_ID, type: "exclusion", value: "Excludes hazardous-material abatement, structural engineering, seismic calculations, and permanent electrical feeders/VFD supply.", order: 4 },
    { id: "cond-demo-exc-02", revisionId: REVISION_ID, type: "exclusion", value: "Excludes premium time beyond the addendum shutdown window unless authorized by written change order.", order: 5 },
    { id: "cond-demo-clar-01", revisionId: REVISION_ID, type: "clarification", value: "Pump pricing assumes manufacturer standard lead time and owner-approved equal selections matching the revised pump schedule.", order: 6 },
    { id: "cond-demo-clar-02", revisionId: REVISION_ID, type: "clarification", value: "Manual takeoff quantities are demo evidence only; public demo disables automated vision and auto-takeoff processing.", order: 7 },
    { id: "cond-demo-alt-01", revisionId: REVISION_ID, type: "alternate", value: "Alternate A: deduct $7,500 if owner accepts existing pipe reroute risk allowance as T&M contingency instead of fixed price.", order: 8 },
  ]);

  const calendar = {
    id: "cal-demo-standard",
    projectId: PROJECT_ID,
    revisionId: REVISION_ID,
    name: "Hospital daytime shift",
    description: "Monday-Friday 7:00 AM - 5:00 PM, with approved shutdown weekend support.",
    isDefault: true,
    workingDays: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false, exceptions: ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14"] },
    shiftStartMinutes: 420,
    shiftEndMinutes: 1020,
    createdAt: now,
    updatedAt: now,
  };
  await upsert("ScheduleCalendar", [calendar]);

  const resources = [
    ["res-demo-pm", "Project manager", "PM", "labor", "#1d4ed8", 0.35, 1, 118],
    ["res-demo-super", "Site superintendent", "Supervision", "labor", "#92400e", 1, 1, 122],
    ["res-demo-fitters", "Pipefitter crew", "Mechanical crew", "labor", "#0f766e", 4, 4, 88],
    ["res-demo-controls", "Controls subcontractor", "Controls", "subcontractor", "#7c3aed", 1, 1, 135],
    ["res-demo-rigging", "Rigging crew", "Rigging", "equipment", "#ea580c", 1, 1, 3550],
    ["res-demo-tab", "TAB contractor", "TAB", "subcontractor", "#0369a1", 1, 1, 155],
  ].map(([id, name, role, kind, color, defaultUnits, capacityPerDay, costRate]) => ({
    id, projectId: PROJECT_ID, revisionId: REVISION_ID, calendarId: calendar.id, name, role, kind, color, defaultUnits, capacityPerDay, costRate, createdAt: now, updatedAt: now,
  }));
  await upsert("ScheduleResource", resources);

  const tasks = [
    ["task-demo-010", null, 0, "Preconstruction", "summary", "in_progress", "2026-04-20", "2026-05-01", 10, 45, "phase-demo-010", "Alex Mercer", 1],
    ["task-demo-011", "task-demo-010", 1, "Finalize bid clarifications and alternates", "task", "complete", "2026-04-20", "2026-04-22", 2, 100, "phase-demo-010", "Estimator", 2],
    ["task-demo-012", "task-demo-010", 1, "Pump submittals and procurement release", "task", "in_progress", "2026-04-23", "2026-05-01", 6, 35, "phase-demo-010", "PM", 3],
    ["task-demo-020", null, 0, "Mobilization & containment", "summary", "not_started", "2026-05-04", "2026-05-08", 5, 0, "phase-demo-020", "Superintendent", 4],
    ["task-demo-021", "task-demo-020", 1, "ICRA barriers and site logistics", "task", "not_started", "2026-05-04", "2026-05-05", 2, 0, "phase-demo-020", "Superintendent", 5],
    ["task-demo-022", "task-demo-020", 1, "Deliver bypass pump and rigging gear", "task", "not_started", "2026-05-06", "2026-05-08", 3, 0, "phase-demo-020", "Superintendent", 6],
    ["task-demo-030", null, 0, "Shutdown demolition window", "summary", "not_started", "2026-05-11", "2026-05-15", 5, 0, "phase-demo-030", "Superintendent", 7],
    ["task-demo-031", "task-demo-030", 1, "Drain, isolate, lockout, and make safe", "task", "not_started", "2026-05-11", "2026-05-12", 2, 0, "phase-demo-030", "Pipefitter crew", 8],
    ["task-demo-032", "task-demo-030", 1, "Selective demolition and pad prep", "task", "not_started", "2026-05-13", "2026-05-15", 3, 0, "phase-demo-030", "Pipefitter crew", 9],
    ["task-demo-040", null, 0, "Piping and equipment installation", "summary", "not_started", "2026-05-18", "2026-06-05", 15, 0, "phase-demo-040", "Pipefitter crew", 10],
    ["task-demo-041", "task-demo-040", 1, "Set pumps and repair housekeeping pads", "task", "not_started", "2026-05-18", "2026-05-20", 3, 0, "phase-demo-040", "Rigging crew", 11],
    ["task-demo-042", "task-demo-040", 1, "Install chilled-water mains and valves", "task", "not_started", "2026-05-21", "2026-05-29", 7, 0, "phase-demo-040", "Pipefitter crew", 12],
    ["task-demo-043", "task-demo-040", 1, "Insulation and labeling", "task", "not_started", "2026-06-01", "2026-06-03", 3, 0, "phase-demo-040", "Insulation sub", 13],
    ["task-demo-044", "task-demo-040", 1, "Controls point-to-point and graphics", "task", "not_started", "2026-06-03", "2026-06-05", 3, 0, "phase-demo-040", "Controls", 14],
    ["task-demo-050", null, 0, "Commissioning & turnover", "summary", "not_started", "2026-06-08", "2026-06-19", 10, 0, "phase-demo-050", "PM", 15],
    ["task-demo-051", "task-demo-050", 1, "Flush, fill, glycol test", "task", "not_started", "2026-06-08", "2026-06-10", 3, 0, "phase-demo-050", "Pipefitter crew", 16],
    ["task-demo-052", "task-demo-050", 1, "TAB and functional performance test", "task", "not_started", "2026-06-11", "2026-06-16", 4, 0, "phase-demo-050", "TAB", 17],
    ["task-demo-053", "task-demo-050", 1, "Owner training and O&M closeout", "milestone", "not_started", "2026-06-19", "2026-06-19", 0, 0, "phase-demo-050", "PM", 18],
  ].map(([id, parentTaskId, outlineLevel, name, taskType, status, startDate, endDate, duration, progress, phaseId, assignee, order]) => ({
    id,
    projectId: PROJECT_ID,
    revisionId: REVISION_ID,
    phaseId,
    calendarId: calendar.id,
    parentTaskId,
    outlineLevel,
    name,
    description: `Demo schedule task: ${name}`,
    taskType,
    status,
    startDate,
    endDate,
    duration,
    progress,
    assignee,
    order,
    constraintType: "asap",
    baselineStart: startDate,
    baselineEnd: endDate,
    createdAt: now,
    updatedAt: now,
  }));
  await upsert("ScheduleTask", tasks);

  const deps = [
    ["dep-demo-001", "task-demo-011", "task-demo-012"],
    ["dep-demo-002", "task-demo-012", "task-demo-021"],
    ["dep-demo-003", "task-demo-021", "task-demo-022"],
    ["dep-demo-004", "task-demo-022", "task-demo-031"],
    ["dep-demo-005", "task-demo-031", "task-demo-032"],
    ["dep-demo-006", "task-demo-032", "task-demo-041"],
    ["dep-demo-007", "task-demo-041", "task-demo-042"],
    ["dep-demo-008", "task-demo-042", "task-demo-043"],
    ["dep-demo-009", "task-demo-042", "task-demo-044"],
    ["dep-demo-010", "task-demo-043", "task-demo-051"],
    ["dep-demo-011", "task-demo-044", "task-demo-052"],
    ["dep-demo-012", "task-demo-051", "task-demo-052"],
    ["dep-demo-013", "task-demo-052", "task-demo-053"],
  ].map(([id, predecessorId, successorId]) => ({ id, predecessorId, successorId, type: "FS", lagDays: 0 }));
  await upsert("ScheduleDependency", deps);

  await upsert("ScheduleTaskAssignment", [
    ["sta-demo-011", "task-demo-011", "res-demo-pm", 0.5, "Estimator"],
    ["sta-demo-012", "task-demo-012", "res-demo-pm", 0.35, "Procurement"],
    ["sta-demo-021", "task-demo-021", "res-demo-super", 1, "Supervision"],
    ["sta-demo-022a", "task-demo-022", "res-demo-super", 0.5, "Delivery coordination"],
    ["sta-demo-022b", "task-demo-022", "res-demo-rigging", 1, "Rigging prep"],
    ["sta-demo-031", "task-demo-031", "res-demo-fitters", 4, "Mechanical crew"],
    ["sta-demo-032", "task-demo-032", "res-demo-fitters", 4, "Demo crew"],
    ["sta-demo-041", "task-demo-041", "res-demo-rigging", 1, "Rigging"],
    ["sta-demo-042", "task-demo-042", "res-demo-fitters", 4, "Piping"],
    ["sta-demo-044", "task-demo-044", "res-demo-controls", 1, "Controls"],
    ["sta-demo-051", "task-demo-051", "res-demo-fitters", 3, "Flush/fill"],
    ["sta-demo-052", "task-demo-052", "res-demo-tab", 1, "TAB"],
    ["sta-demo-053", "task-demo-053", "res-demo-pm", 0.5, "Closeout"],
  ].map(([id, taskId, resourceId, units, role]) => ({ id, taskId, resourceId, units, role, createdAt: now, updatedAt: now })));

  await upsert("ScheduleBaseline", [{
    id: "baseline-demo-bid",
    projectId: PROJECT_ID,
    revisionId: REVISION_ID,
    name: "Bid baseline",
    description: "Baseline captured from the public demo seed.",
    kind: "bid",
    isPrimary: true,
    createdAt: now,
    updatedAt: now,
  }]);
  await upsert("ScheduleBaselineTask", tasks.map((task) => ({
    id: `blt-${task.id}`,
    baselineId: "baseline-demo-bid",
    taskId: task.id,
    taskName: task.name,
    phaseId: task.phaseId,
    startDate: task.startDate,
    endDate: task.endDate,
    duration: task.duration,
    createdAt: now,
    updatedAt: now,
  })));

  await patch("Project", `id=eq.${PROJECT_ID}`, { updatedAt: todayIso() });
  await patch("Quote", `id=eq.${QUOTE_ID}`, { updatedAt: todayIso() });
  await patch("QuoteRevision", `id=eq.${REVISION_ID}`, { updatedAt: todayIso() });

  console.log(`Seeded public demo showcase: ${documents.length} documents, ${worksheets.length} worksheets, ${lineItems.length} line items, ${tasks.length} schedule tasks.`);
  console.log(`Demo totals: cost $${cost.toLocaleString()}, total $${subtotal.toLocaleString()}, profit $${estimatedProfit.toLocaleString()}, margin ${(estimatedMargin * 100).toFixed(1)}%, hours ${hours.totalHours}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

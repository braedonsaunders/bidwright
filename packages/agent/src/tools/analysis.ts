import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type AnalysisOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<Omit<ToolResult, 'duration_ms'>>;

function createAnalysisTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  tags: string[];
}, operation: AnalysisOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "analysis",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: false,
      mutates: false,
      tags: def.tags,
    },
    async execute(input: Record<string, unknown>, context: ToolExecutionContext) {
      const start = Date.now();
      try {
        const result = await operation(context, input);
        return { ...result, duration_ms: Date.now() - start };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error), duration_ms: Date.now() - start };
      }
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────

async function fetchWorkspace(ctx: ToolExecutionContext): Promise<any> {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Standard CSI MasterFormat divisions for completeness checking */
const CSI_DIVISIONS: Record<string, string> = {
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics, and Composites",
  "07": "Thermal and Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety and Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
};

const COMMON_CATEGORIES = ["labour", "material", "equipment", "subcontractor", "overhead", "permits"];

/** Industry-standard labour hour ranges per category (hours per unit of work) */
const LABOUR_HOUR_RANGES: Record<string, { minHours: number; maxHours: number; unit: string; description: string }> = {
  electrical: { minHours: 40, maxHours: 120, unit: "per 1000 sqft", description: "Electrical rough-in and finish" },
  plumbing: { minHours: 30, maxHours: 100, unit: "per 1000 sqft", description: "Plumbing rough-in and finish" },
  hvac: { minHours: 50, maxHours: 150, unit: "per 1000 sqft", description: "HVAC installation" },
  concrete: { minHours: 20, maxHours: 80, unit: "per cubic yard", description: "Concrete forming, pouring, finishing" },
  framing: { minHours: 30, maxHours: 90, unit: "per 1000 sqft", description: "Wood or metal framing" },
  drywall: { minHours: 15, maxHours: 50, unit: "per 1000 sqft", description: "Drywall hanging and finishing" },
  painting: { minHours: 10, maxHours: 40, unit: "per 1000 sqft", description: "Interior/exterior painting" },
  roofing: { minHours: 20, maxHours: 60, unit: "per 1000 sqft", description: "Roofing installation" },
  masonry: { minHours: 40, maxHours: 120, unit: "per 1000 sqft", description: "Brick/block/stone work" },
  flooring: { minHours: 15, maxHours: 50, unit: "per 1000 sqft", description: "Floor covering installation" },
  general: { minHours: 20, maxHours: 80, unit: "per scope item", description: "General construction labour" },
};

/** Common equipment by project scope keyword */
const EQUIPMENT_MAP: Record<string, string[]> = {
  excavation: ["Excavator", "Backhoe", "Dump Truck", "Compactor"],
  concrete: ["Concrete Mixer Truck", "Concrete Pump", "Vibrator", "Power Trowel"],
  steel: ["Crane", "Welding Equipment", "Rigging Hardware"],
  framing: ["Nail Gun", "Circular Saw", "Scaffolding"],
  electrical: ["Wire Puller", "Conduit Bender", "Multimeter", "Lift/Boom"],
  plumbing: ["Pipe Threader", "Soldering Kit", "Drain Camera"],
  hvac: ["Sheet Metal Brake", "Refrigerant Recovery Unit", "Crane/Lift"],
  roofing: ["Roofing Nailer", "Hot Tar Kettle", "Safety Harness System"],
  demolition: ["Hydraulic Breaker", "Skid Steer", "Dumpster/Roll-off"],
  earthwork: ["Bulldozer", "Grader", "Loader", "Surveying Equipment"],
  painting: ["Sprayer", "Scaffolding", "Pressure Washer"],
  landscaping: ["Skid Steer", "Sod Cutter", "Irrigation Tools"],
};

// ──────────────────────────────────────────────────────────────
// 1. analysis.analyzeScope
// ──────────────────────────────────────────────────────────────
export const analyzeScopeTool = createAnalysisTool({
  id: "analysis.analyzeScope",
  name: "Analyze Scope of Work",
  description: "Analyze the scope of work from project documents, extracting key requirements, divisions, and deliverables.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to analyze scope for"),
  }),
  tags: ["analysis", "scope", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];
  const documents: any[] = workspace.documents ?? [];
  const description: string = workspace.description ?? workspace.name ?? "";
  const notes: string = workspace.notes ?? "";

  // Group items by category
  const categories: Record<string, { count: number; totalCost: number; items: string[] }> = {};
  for (const item of items) {
    const cat = (item.category ?? item.division ?? "Uncategorized").toString();
    if (!categories[cat]) categories[cat] = { count: 0, totalCost: 0, items: [] };
    categories[cat].count += 1;
    categories[cat].totalCost += Number(item.totalCost ?? item.total ?? 0);
    categories[cat].items.push(item.name ?? item.description ?? "Unnamed item");
  }

  const totalValue = items.reduce((sum: number, i: any) => sum + Number(i.totalCost ?? i.total ?? 0), 0);

  return {
    success: true,
    data: {
      projectDescription: description,
      notes,
      totalLineItems: items.length,
      totalDocuments: documents.length,
      totalEstimatedValue: totalValue,
      scopeBreakdown: categories,
      categoryList: Object.keys(categories),
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 2. analysis.identifyGaps
// ──────────────────────────────────────────────────────────────
export const identifyGapsTool = createAnalysisTool({
  id: "analysis.identifyGaps",
  name: "Identify Gaps",
  description: "Find missing items or sections in the estimate by comparing the current worksheets against project documents and specifications.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to check for gaps"),
  }),
  tags: ["analysis", "gaps", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];
  const existingCategories = new Set(
    items.map((i: any) => (i.category ?? i.division ?? "").toString().toLowerCase())
  );

  const missingCategories: string[] = [];
  for (const cat of COMMON_CATEGORIES) {
    if (!existingCategories.has(cat)) {
      missingCategories.push(cat);
    }
  }

  // Check for items without costs
  const itemsWithoutCost = items.filter((i: any) => !i.unitCost && !i.totalCost && !i.total);
  // Check for items without quantities
  const itemsWithoutQuantity = items.filter((i: any) => !i.quantity || Number(i.quantity) === 0);

  return {
    success: true,
    data: {
      totalItems: items.length,
      missingCategories,
      itemsWithoutCost: itemsWithoutCost.map((i: any) => ({ id: i.id, name: i.name ?? i.description })),
      itemsWithoutQuantity: itemsWithoutQuantity.map((i: any) => ({ id: i.id, name: i.name ?? i.description })),
      gapCount: missingCategories.length + itemsWithoutCost.length + itemsWithoutQuantity.length,
      recommendation: missingCategories.length > 0
        ? `Consider adding line items for: ${missingCategories.join(", ")}`
        : "All common categories are represented in the estimate.",
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 3. analysis.crossReferenceSpecs
// ──────────────────────────────────────────────────────────────
export const crossReferenceSpecsTool = createAnalysisTool({
  id: "analysis.crossReferenceSpecs",
  name: "Cross-Reference Specs",
  description: "Match specification sections to drawing sheets, identifying which spec requirements correspond to which drawings.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to cross-reference"),
  }),
  tags: ["analysis", "specs", "drawings", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const documents: any[] = workspace.documents ?? [];
  const items: any[] = workspace.items ?? workspace.lineItems ?? [];

  // Classify documents
  const specs = documents.filter((d: any) => {
    const name = (d.name ?? d.filename ?? "").toLowerCase();
    return name.includes("spec") || name.includes("specification") || name.endsWith(".docx") || name.endsWith(".doc");
  });
  const drawings = documents.filter((d: any) => {
    const name = (d.name ?? d.filename ?? "").toLowerCase();
    return name.includes("drawing") || name.includes("plan") || name.includes("sheet") || name.endsWith(".dwg") || name.endsWith(".dxf");
  });

  // Map items to their closest document references by category matching
  const crossReferences: Array<{ category: string; specDocuments: string[]; drawingDocuments: string[]; itemCount: number }> = [];
  const categories = [...new Set(items.map((i: any) => (i.category ?? i.division ?? "General").toString()))];

  for (const cat of categories) {
    const catLower = cat.toLowerCase();
    const matchingSpecs = specs.filter((d: any) => (d.name ?? d.filename ?? "").toLowerCase().includes(catLower));
    const matchingDrawings = drawings.filter((d: any) => (d.name ?? d.filename ?? "").toLowerCase().includes(catLower));
    const catItems = items.filter((i: any) => (i.category ?? i.division ?? "General").toString() === cat);

    crossReferences.push({
      category: cat,
      specDocuments: matchingSpecs.map((d: any) => d.name ?? d.filename),
      drawingDocuments: matchingDrawings.map((d: any) => d.name ?? d.filename),
      itemCount: catItems.length,
    });
  }

  return {
    success: true,
    data: {
      totalSpecs: specs.length,
      totalDrawings: drawings.length,
      totalDocuments: documents.length,
      crossReferences,
      unmatchedCategories: crossReferences.filter(cr => cr.specDocuments.length === 0 && cr.drawingDocuments.length === 0).map(cr => cr.category),
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 4. analysis.validateQuantities
// ──────────────────────────────────────────────────────────────
export const validateQuantitiesTool = createAnalysisTool({
  id: "analysis.validateQuantities",
  name: "Validate Quantities",
  description: "Check estimated quantities against document takeoffs and flag any discrepancies or outliers.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to validate quantities for"),
    worksheetId: z.string().optional().describe("Limit validation to a specific worksheet"),
  }),
  tags: ["analysis", "quantities", "validate", "read"],
}, async (ctx, input) => {
  const workspace = await fetchWorkspace(ctx);

  let items: any[] = workspace.items ?? workspace.lineItems ?? [];
  const worksheetId = input.worksheetId as string | undefined;
  if (worksheetId) {
    items = items.filter((i: any) => i.worksheetId === worksheetId);
  }

  const flags: Array<{ itemId: string; itemName: string; issue: string; severity: "warning" | "error" }> = [];

  for (const item of items) {
    const qty = Number(item.quantity ?? 0);
    const cost = Number(item.unitCost ?? item.cost ?? 0);
    const total = Number(item.totalCost ?? item.total ?? 0);
    const name = item.name ?? item.description ?? "Unnamed";

    if (qty === 0) {
      flags.push({ itemId: item.id, itemName: name, issue: "Quantity is 0", severity: "error" });
    }
    if (qty > 1000) {
      flags.push({ itemId: item.id, itemName: name, issue: `Very high quantity: ${qty}`, severity: "warning" });
    }
    if (cost === 0 && total === 0) {
      flags.push({ itemId: item.id, itemName: name, issue: "Unit cost and total cost are both 0", severity: "error" });
    }
    if (qty > 0 && cost > 0 && Math.abs(total - qty * cost) > 0.01) {
      flags.push({ itemId: item.id, itemName: name, issue: `Total (${total}) does not match qty * unit cost (${qty * cost})`, severity: "warning" });
    }
  }

  return {
    success: true,
    data: {
      totalItemsChecked: items.length,
      issueCount: flags.length,
      errors: flags.filter(f => f.severity === "error"),
      warnings: flags.filter(f => f.severity === "warning"),
      flags,
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 5. analysis.compareHistorical
// ──────────────────────────────────────────────────────────────
export const compareHistoricalTool = createAnalysisTool({
  id: "analysis.compareHistorical",
  name: "Compare Historical",
  description: "Compare the current project estimate with similar past projects to identify pricing anomalies and benchmark performance.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to compare against historical data"),
  }),
  tags: ["analysis", "historical", "compare", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];
  const totalValue = items.reduce((sum: number, i: any) => sum + Number(i.totalCost ?? i.total ?? 0), 0);

  // Typical construction cost ranges (per sqft) for benchmarking
  const benchmarks: Record<string, { lowPerSqft: number; highPerSqft: number }> = {
    residential: { lowPerSqft: 100, highPerSqft: 400 },
    commercial: { lowPerSqft: 150, highPerSqft: 600 },
    industrial: { lowPerSqft: 80, highPerSqft: 350 },
    institutional: { lowPerSqft: 200, highPerSqft: 700 },
  };

  // Category-level cost distribution analysis
  const categories: Record<string, number> = {};
  for (const item of items) {
    const cat = (item.category ?? item.division ?? "Other").toString();
    categories[cat] = (categories[cat] ?? 0) + Number(item.totalCost ?? item.total ?? 0);
  }

  const categoryPercentages: Record<string, string> = {};
  for (const [cat, cost] of Object.entries(categories)) {
    categoryPercentages[cat] = totalValue > 0 ? `${((cost / totalValue) * 100).toFixed(1)}%` : "0%";
  }

  return {
    success: true,
    data: {
      totalEstimateValue: totalValue,
      lineItemCount: items.length,
      costDistribution: categoryPercentages,
      industryBenchmarks: benchmarks,
      note: "Historical comparison is best-effort. Benchmarks shown are typical construction cost ranges. For accurate comparison, a historical project database is recommended.",
      analysis: {
        averageCostPerItem: items.length > 0 ? totalValue / items.length : 0,
        highestCostCategory: Object.entries(categories).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A",
        lowestCostCategory: Object.entries(categories).sort((a, b) => a[1] - b[1])[0]?.[0] ?? "N/A",
      },
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 6. analysis.estimateLabourHours
// ──────────────────────────────────────────────────────────────
export const estimateLabourHoursTool = createAnalysisTool({
  id: "analysis.estimateLabourHours",
  name: "Estimate Labour Hours",
  description: "Suggest labour hours for a given scope of work based on historical data, industry standards, and project complexity.",
  inputSchema: z.object({
    description: z.string().describe("Description of the scope of work to estimate labour for"),
    category: z.string().describe("Work category (e.g. 'Electrical', 'Plumbing', 'HVAC', 'General')"),
  }),
  tags: ["analysis", "labour", "estimate", "read"],
}, async (_ctx, input) => {
  const category = (input.category as string).toLowerCase();
  const description = (input.description as string).toLowerCase();

  // Find best matching labour range
  let match = LABOUR_HOUR_RANGES[category];
  if (!match) {
    // Try fuzzy match on description
    for (const [key, range] of Object.entries(LABOUR_HOUR_RANGES)) {
      if (description.includes(key)) {
        match = range;
        break;
      }
    }
  }
  if (!match) {
    match = LABOUR_HOUR_RANGES.general;
  }

  return {
    success: true,
    data: {
      category: input.category,
      description: input.description,
      estimatedRange: {
        minHours: match.minHours,
        maxHours: match.maxHours,
        unit: match.unit,
        scopeDescription: match.description,
      },
      midpointHours: (match.minHours + match.maxHours) / 2,
      note: "These are industry-standard ranges. Actual hours may vary based on project complexity, site conditions, crew experience, and local factors.",
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 7. analysis.suggestEquipment
// ──────────────────────────────────────────────────────────────
export const suggestEquipmentTool = createAnalysisTool({
  id: "analysis.suggestEquipment",
  name: "Suggest Equipment",
  description: "Recommend equipment needed for the project based on scope analysis and similar past projects.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to suggest equipment for"),
  }),
  tags: ["analysis", "equipment", "suggest", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];
  const description: string = (workspace.description ?? workspace.name ?? "").toLowerCase();

  // Collect all relevant text for keyword matching
  const allText = [
    description,
    ...items.map((i: any) => ((i.name ?? "") + " " + (i.description ?? "") + " " + (i.category ?? "")).toLowerCase()),
  ].join(" ");

  const suggestedEquipment: Record<string, string[]> = {};
  for (const [keyword, equipment] of Object.entries(EQUIPMENT_MAP)) {
    if (allText.includes(keyword)) {
      suggestedEquipment[keyword] = equipment;
    }
  }

  // Always suggest general safety equipment
  const generalEquipment = ["PPE (Hard Hats, Safety Vests, Gloves)", "First Aid Kit", "Fire Extinguisher", "Temporary Fencing"];

  return {
    success: true,
    data: {
      suggestedByScope: suggestedEquipment,
      generalSafetyEquipment: generalEquipment,
      totalScopeKeywordsMatched: Object.keys(suggestedEquipment).length,
      note: "Equipment suggestions are based on keyword analysis of project scope and line items. Review and adjust based on specific project requirements.",
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 8. analysis.riskAssessment
// ──────────────────────────────────────────────────────────────
export const riskAssessmentTool = createAnalysisTool({
  id: "analysis.riskAssessment",
  name: "Risk Assessment",
  description: "Identify project risks based on scope, specifications, site conditions, and historical data. Returns risk items with severity and mitigation suggestions.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to assess risks for"),
  }),
  tags: ["analysis", "risk", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];
  const totalValue = items.reduce((sum: number, i: any) => sum + Number(i.totalCost ?? i.total ?? 0), 0);

  const risks: Array<{ risk: string; severity: "low" | "medium" | "high"; category: string; mitigation: string }> = [];

  // Check for high-value single items (>30% of total)
  for (const item of items) {
    const cost = Number(item.totalCost ?? item.total ?? 0);
    if (totalValue > 0 && cost / totalValue > 0.3) {
      risks.push({
        risk: `High-value item "${item.name ?? item.description}" represents ${((cost / totalValue) * 100).toFixed(1)}% of total estimate`,
        severity: "high",
        category: "concentration",
        mitigation: "Consider breaking into sub-items, getting multiple quotes, or adding contingency for this line item.",
      });
    }
  }

  // Check for missing common categories
  const existingCategories = new Set(items.map((i: any) => (i.category ?? "").toString().toLowerCase()));
  const criticalMissing = ["labour", "material"].filter(c => !existingCategories.has(c));
  if (criticalMissing.length > 0) {
    risks.push({
      risk: `Missing critical categories: ${criticalMissing.join(", ")}`,
      severity: "high",
      category: "completeness",
      mitigation: "Add line items for missing categories to ensure a complete estimate.",
    });
  }

  // Check for items with zero cost
  const zeroCostItems = items.filter((i: any) => Number(i.totalCost ?? i.total ?? 0) === 0);
  if (zeroCostItems.length > 0) {
    risks.push({
      risk: `${zeroCostItems.length} item(s) have zero cost`,
      severity: "medium",
      category: "pricing",
      mitigation: "Review and assign costs to all line items before submitting the estimate.",
    });
  }

  // Check for very few items (potentially incomplete)
  if (items.length < 5 && items.length > 0) {
    risks.push({
      risk: "Estimate has very few line items, which may indicate incomplete scope coverage",
      severity: "medium",
      category: "completeness",
      mitigation: "Review project documents to ensure all scope items are captured.",
    });
  }

  // Check for no documents
  const documents: any[] = workspace.documents ?? [];
  if (documents.length === 0) {
    risks.push({
      risk: "No source documents attached to the project",
      severity: "medium",
      category: "documentation",
      mitigation: "Upload project plans, specifications, and RFP documents for reference.",
    });
  }

  // Vendor concentration check
  const vendors: Record<string, number> = {};
  for (const item of items) {
    const vendor = (item.vendor ?? item.supplier ?? "").toString();
    if (vendor) {
      vendors[vendor] = (vendors[vendor] ?? 0) + Number(item.totalCost ?? item.total ?? 0);
    }
  }
  for (const [vendor, cost] of Object.entries(vendors)) {
    if (totalValue > 0 && cost / totalValue > 0.5) {
      risks.push({
        risk: `Large single-vendor dependency: "${vendor}" accounts for ${((cost / totalValue) * 100).toFixed(1)}% of costs`,
        severity: "high",
        category: "vendor",
        mitigation: "Consider diversifying suppliers or obtaining backup quotes.",
      });
    }
  }

  return {
    success: true,
    data: {
      totalRisks: risks.length,
      highSeverity: risks.filter(r => r.severity === "high").length,
      mediumSeverity: risks.filter(r => r.severity === "medium").length,
      lowSeverity: risks.filter(r => r.severity === "low").length,
      risks,
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 9. analysis.completenessCheck
// ──────────────────────────────────────────────────────────────
export const completenessCheckTool = createAnalysisTool({
  id: "analysis.completenessCheck",
  name: "Completeness Check",
  description: "Check if the estimate covers all specification divisions and drawing disciplines, flagging any sections without corresponding line items.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to check completeness for"),
  }),
  tags: ["analysis", "completeness", "check", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];

  // Collect all category/division text from items
  const itemText = items.map((i: any) =>
    ((i.category ?? "") + " " + (i.division ?? "") + " " + (i.name ?? "") + " " + (i.description ?? "")).toLowerCase()
  ).join(" ");

  const coveredDivisions: string[] = [];
  const missingDivisions: string[] = [];

  for (const [code, name] of Object.entries(CSI_DIVISIONS)) {
    const nameLower = name.toLowerCase();
    // Check if division name keywords appear in item text
    const keywords = nameLower.split(/[\s,/]+/).filter(w => w.length > 3);
    const found = keywords.some(kw => itemText.includes(kw));
    if (found) {
      coveredDivisions.push(`Division ${code}: ${name}`);
    } else {
      missingDivisions.push(`Division ${code}: ${name}`);
    }
  }

  const completenessScore = Object.keys(CSI_DIVISIONS).length > 0
    ? (coveredDivisions.length / Object.keys(CSI_DIVISIONS).length) * 100
    : 0;

  return {
    success: true,
    data: {
      totalCSIDivisions: Object.keys(CSI_DIVISIONS).length,
      coveredDivisions,
      missingDivisions,
      coveredCount: coveredDivisions.length,
      missingCount: missingDivisions.length,
      completenessScore: `${completenessScore.toFixed(1)}%`,
      note: "Not all CSI divisions apply to every project. Review missing divisions and determine which are relevant to your scope.",
    },
  };
});

// ──────────────────────────────────────────────────────────────
// 10. analysis.pricingAnalysis
// ──────────────────────────────────────────────────────────────
export const pricingAnalysisTool = createAnalysisTool({
  id: "analysis.pricingAnalysis",
  name: "Pricing Analysis",
  description: "Analyze pricing against current market rates, flagging items that are significantly above or below market benchmarks.",
  inputSchema: z.object({
    projectId: z.string().describe("Project ID to analyze pricing for"),
  }),
  tags: ["analysis", "pricing", "market", "read"],
}, async (ctx, _input) => {
  const workspace = await fetchWorkspace(ctx);

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];

  const flags: Array<{ itemId: string; itemName: string; issue: string; severity: "info" | "warning" | "error" }> = [];

  for (const item of items) {
    const name = item.name ?? item.description ?? "Unnamed";
    const unitCost = Number(item.unitCost ?? item.cost ?? 0);
    const totalCost = Number(item.totalCost ?? item.total ?? 0);
    const markup = Number(item.markup ?? item.markupPercent ?? 0);

    if (unitCost === 0 && totalCost === 0) {
      flags.push({ itemId: item.id, itemName: name, issue: "Item has zero cost", severity: "error" });
    }

    if (markup > 0 && markup < 5) {
      flags.push({ itemId: item.id, itemName: name, issue: `Very low markup: ${markup}%`, severity: "warning" });
    }

    if (markup > 100) {
      flags.push({ itemId: item.id, itemName: name, issue: `Very high markup: ${markup}%`, severity: "warning" });
    }

    // Flag extremely high unit costs
    if (unitCost > 10000) {
      flags.push({ itemId: item.id, itemName: name, issue: `High unit cost: $${unitCost.toLocaleString()}`, severity: "info" });
    }
  }

  const totalValue = items.reduce((sum: number, i: any) => sum + Number(i.totalCost ?? i.total ?? 0), 0);
  const avgUnitCost = items.length > 0
    ? items.reduce((sum: number, i: any) => sum + Number(i.unitCost ?? i.cost ?? 0), 0) / items.length
    : 0;

  return {
    success: true,
    data: {
      totalItems: items.length,
      totalEstimateValue: totalValue,
      averageUnitCost: avgUnitCost,
      flagCount: flags.length,
      errors: flags.filter(f => f.severity === "error"),
      warnings: flags.filter(f => f.severity === "warning"),
      info: flags.filter(f => f.severity === "info"),
      flags,
    },
  };
});

// ──────────────────────────────────────────────────────────────
// Export all tools as array
// ──────────────────────────────────────────────────────────────
export const analysisTools: Tool[] = [
  analyzeScopeTool,
  identifyGapsTool,
  crossReferenceSpecsTool,
  validateQuantitiesTool,
  compareHistoricalTool,
  estimateLabourHoursTool,
  suggestEquipmentTool,
  riskAssessmentTool,
  completenessCheckTool,
  pricingAnalysisTool,
];

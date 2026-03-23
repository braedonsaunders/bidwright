import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type PricingOperationResult = { success: boolean; data?: unknown; error?: string; citations?: ToolResult["citations"]; sideEffects?: string[]; duration_ms?: number };
type PricingOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<PricingOperationResult>;

function createPricingTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  tags: string[];
}, operation: PricingOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "pricing",
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

// ──────────────────────────────────────────────────────────────
// 1. pricing.lookupRate
// ──────────────────────────────────────────────────────────────
export const lookupRateTool = createPricingTool({
  id: "pricing.lookupRate",
  name: "Lookup Rate Schedule",
  description:
    "Search for labour rates by trade, location, and optional date. Checks rate schedules and datasets for matching rates. Returns the best matching rate data including regular, overtime, and double-time rates. If no data is found, returns a clear message so you can flag the item for manual pricing.",
  inputSchema: z.object({
    trade: z.string().describe("Trade or labour classification (e.g. 'Electrician Journeyman', 'Plumber Apprentice', 'HVAC Mechanic')"),
    location: z.string().optional().describe("Job location for regional rate adjustments (e.g. 'Denver, CO')"),
    date: z.string().optional().describe("Effective date for rate lookup (ISO format). Defaults to current date."),
    projectId: z.string().optional().describe("Project ID to also check project-specific rate schedules"),
  }),
  tags: ["pricing", "labour", "rates", "read"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;

  // Search rate schedules for matching labour rates
  const params = new URLSearchParams();
  if (pid) params.set("projectId", pid);
  params.set("scope", "all");

  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/rate-schedules?${params.toString()}`);
    const schedules = await res.json();

    const trade = String(input.trade).toLowerCase();
    const matches: unknown[] = [];

    if (Array.isArray(schedules.schedules ?? schedules)) {
      for (const schedule of (schedules.schedules ?? schedules)) {
        if (!schedule.items) continue;
        for (const item of schedule.items) {
          const nameMatch = item.name?.toLowerCase().includes(trade) || item.code?.toLowerCase().includes(trade);
          if (nameMatch) {
            matches.push({
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              itemId: item.id,
              code: item.code,
              name: item.name,
              unit: item.unit,
              rates: item.rates,
              costRates: item.costRates,
              burden: item.burden,
              perDiem: item.perDiem,
            });
          }
        }
      }
    }

    // Also search datasets for rate data
    const dsParams = new URLSearchParams({ q: String(input.trade) });
    if (pid) dsParams.set("projectId", pid);
    dsParams.set("limit", "5");
    const dsRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search?${dsParams.toString()}`);
    const dsData = await dsRes.json();
    const datasetHits = (dsData.hits ?? []).filter((h: any) =>
      h.text?.toLowerCase().includes("rate") || h.text?.toLowerCase().includes("wage") || h.text?.toLowerCase().includes("labour") || h.text?.toLowerCase().includes("labor")
    );

    if (matches.length === 0 && datasetHits.length === 0) {
      return {
        success: true,
        data: {
          found: false,
          trade: input.trade,
          location: input.location ?? null,
          message: `No labour rate data found for "${input.trade}". You should create the line item with $0 cost and flag it for manual pricing, or ask the user to provide rate data.`,
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        trade: input.trade,
        location: input.location ?? null,
        rateScheduleMatches: matches,
        knowledgeHits: datasetHits.slice(0, 3),
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 2. pricing.lookupMaterialPrice
// ──────────────────────────────────────────────────────────────
export const lookupMaterialPriceTool = createPricingTool({
  id: "pricing.lookupMaterialPrice",
  name: "Lookup Material Price",
  description:
    "Search for material pricing by description. Checks catalog items, datasets, and knowledge base for pricing data. Returns matching prices with vendor and unit info. If no data is found, returns a clear message.",
  inputSchema: z.object({
    material: z.string().describe("Material name or description (e.g. '3/4 inch EMT conduit', '12 AWG THHN wire')"),
    vendor: z.string().optional().describe("Preferred vendor to filter results"),
    quantity: z.number().optional().describe("Quantity needed (may affect unit pricing at volume)"),
    projectId: z.string().optional().describe("Project ID for project-specific catalog lookups"),
  }),
  tags: ["pricing", "materials", "catalog", "read"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  const material = String(input.material);

  try {
    // Search catalogs
    const catParams = new URLSearchParams({ q: material });
    if (pid) catParams.set("projectId", pid);
    catParams.set("limit", "10");
    const catRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/catalogs/search?${catParams.toString()}`);
    let catalogMatches: unknown[] = [];
    if (catRes.ok) {
      const catData = await catRes.json();
      catalogMatches = (catData.items ?? catData.results ?? []).slice(0, 5);
    }

    // Search knowledge base for pricing info
    const kbParams = new URLSearchParams({ q: `${material} price cost unit` });
    if (pid) kbParams.set("projectId", pid);
    kbParams.set("limit", "5");
    const kbRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search?${kbParams.toString()}`);
    const kbData = await kbRes.json();
    const knowledgeHits = (kbData.hits ?? []).slice(0, 3);

    if (catalogMatches.length === 0 && knowledgeHits.length === 0) {
      return {
        success: true,
        data: {
          found: false,
          material,
          message: `No pricing data found for "${material}". Create the line item with $0 material cost and flag it for manual pricing.`,
        },
      };
    }

    return {
      success: true,
      data: {
        found: catalogMatches.length > 0 || knowledgeHits.length > 0,
        material,
        catalogMatches,
        knowledgeHits,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 3. pricing.lookupEquipmentRate
// ──────────────────────────────────────────────────────────────
export const lookupEquipmentRateTool = createPricingTool({
  id: "pricing.lookupEquipmentRate",
  name: "Lookup Equipment Rate",
  description:
    "Search for equipment rental rates by type and duration. Checks catalogs, datasets, and knowledge base. Returns daily/weekly/monthly rates if available.",
  inputSchema: z.object({
    equipment: z.string().describe("Equipment type (e.g. 'Scissor Lift 26ft', 'Mini Excavator', 'Concrete Pump')"),
    duration: z.string().optional().describe("Rental duration (e.g. 'daily', 'weekly', 'monthly', '3 weeks')"),
    location: z.string().optional().describe("Job location for regional rate lookup"),
    projectId: z.string().optional().describe("Project ID for project-specific lookups"),
  }),
  tags: ["pricing", "equipment", "rental", "read"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  const equipment = String(input.equipment);

  try {
    // Search catalogs for equipment
    const catParams = new URLSearchParams({ q: equipment });
    if (pid) catParams.set("projectId", pid);
    catParams.set("limit", "10");
    const catRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/catalogs/search?${catParams.toString()}`);
    let catalogMatches: unknown[] = [];
    if (catRes.ok) {
      const catData = await catRes.json();
      catalogMatches = (catData.items ?? catData.results ?? []).filter((item: any) =>
        item.kind === "equipment" || item.category === "equipment" || item.name?.toLowerCase().includes("rental")
      ).slice(0, 5);
    }

    // Search knowledge base
    const kbParams = new URLSearchParams({ q: `${equipment} rental rate` });
    if (pid) kbParams.set("projectId", pid);
    kbParams.set("limit", "5");
    const kbRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search?${kbParams.toString()}`);
    const kbData = await kbRes.json();
    const knowledgeHits = (kbData.hits ?? []).slice(0, 3);

    if (catalogMatches.length === 0 && knowledgeHits.length === 0) {
      return {
        success: true,
        data: {
          found: false,
          equipment,
          duration: input.duration ?? null,
          message: `No equipment rate data found for "${equipment}". Create the line item with $0 equipment cost and flag it for manual pricing.`,
        },
      };
    }

    return {
      success: true,
      data: {
        found: true,
        equipment,
        duration: input.duration ?? null,
        catalogMatches,
        knowledgeHits,
      },
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 4. pricing.searchPricingData
// ──────────────────────────────────────────────────────────────
export const searchPricingDataTool = createPricingTool({
  id: "pricing.searchPricingData",
  name: "Search Pricing Data",
  description:
    "Broad search across all pricing sources — catalogs, datasets, rate schedules, and knowledge base. Use this when you need to find pricing information but don't know exactly which category it falls under.",
  inputSchema: z.object({
    query: z.string().describe("Search query for pricing information"),
    category: z.enum(["all", "labour", "materials", "equipment", "general"]).optional().describe("Filter by pricing category"),
    projectId: z.string().optional().describe("Project ID for project-specific lookups"),
    limit: z.number().optional().default(10).describe("Maximum results to return"),
  }),
  tags: ["pricing", "search", "read"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  const query = String(input.query);
  const limit = Number(input.limit) || 10;

  try {
    const results: { source: string; items: unknown[] }[] = [];

    // Search rate schedules
    const rsParams = new URLSearchParams();
    if (pid) rsParams.set("projectId", pid);
    rsParams.set("scope", "all");
    const rsRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/rate-schedules?${rsParams.toString()}`);
    if (rsRes.ok) {
      const rsData = await rsRes.json();
      const schedules = rsData.schedules ?? rsData;
      const rsMatches: unknown[] = [];
      if (Array.isArray(schedules)) {
        for (const schedule of schedules) {
          if (!schedule.items) continue;
          for (const item of schedule.items) {
            if (item.name?.toLowerCase().includes(query.toLowerCase()) || item.code?.toLowerCase().includes(query.toLowerCase())) {
              rsMatches.push({ scheduleName: schedule.name, ...item });
            }
          }
        }
      }
      if (rsMatches.length > 0) results.push({ source: "rate_schedules", items: rsMatches.slice(0, limit) });
    }

    // Search catalogs
    const catParams = new URLSearchParams({ q: query });
    if (pid) catParams.set("projectId", pid);
    catParams.set("limit", String(limit));
    const catRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/catalogs/search?${catParams.toString()}`);
    if (catRes.ok) {
      const catData = await catRes.json();
      const items = catData.items ?? catData.results ?? [];
      if (items.length > 0) results.push({ source: "catalogs", items: items.slice(0, limit) });
    }

    // Search knowledge base
    const kbParams = new URLSearchParams({ q: query });
    if (pid) kbParams.set("projectId", pid);
    kbParams.set("limit", String(limit));
    const kbRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search?${kbParams.toString()}`);
    if (kbRes.ok) {
      const kbData = await kbRes.json();
      const hits = kbData.hits ?? [];
      if (hits.length > 0) results.push({ source: "knowledge_base", items: hits.slice(0, limit) });
    }

    if (results.every((r) => r.items.length === 0)) {
      return {
        success: true,
        data: {
          found: false,
          query,
          message: `No pricing data found for "${query}". Flag items for manual pricing.`,
        },
      };
    }

    return { success: true, data: { found: true, query, results } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 5. pricing.getMarketRate
// ──────────────────────────────────────────────────────────────
export const getMarketRateTool = createPricingTool({
  id: "pricing.getMarketRate",
  name: "Get Market Rate",
  description:
    "Look up current market rates for a trade or item in a given location. This tool queries external market data sources (RS Means, BLS, etc.) when configured. If market data is not yet available, it returns a clear message. Use this to validate your estimates against market benchmarks.",
  inputSchema: z.object({
    item: z.string().describe("Trade, material, or equipment to look up (e.g. 'Electrician Journeyman', '3/4 EMT conduit')"),
    location: z.string().optional().describe("Location for regional pricing (e.g. 'Denver, CO')"),
    category: z.enum(["labour", "materials", "equipment"]).optional().describe("Pricing category"),
    projectId: z.string().optional().describe("Project ID for context"),
  }),
  tags: ["pricing", "market", "benchmark", "read"],
}, async (_ctx, input) => {
  // Market data integration point — returns "not configured" until data sources are connected
  return {
    success: true,
    data: {
      found: false,
      item: input.item,
      location: input.location ?? null,
      category: input.category ?? null,
      message: "Market rate data sources are not yet configured. Create line items with your best estimate and flag them for manual pricing review. When market data (RS Means, BLS, supplier feeds) is connected, this tool will return current benchmark rates.",
    },
  };
});

// ──────────────────────────────────────────────────────────────
// Export all pricing tools
// ──────────────────────────────────────────────────────────────
export const pricingTools: Tool[] = [
  lookupRateTool,
  lookupMaterialPriceTool,
  lookupEquipmentRateTool,
  searchPricingDataTool,
  getMarketRateTool,
];

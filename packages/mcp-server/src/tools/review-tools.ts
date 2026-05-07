import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiPost, getProjectId } from "../api-client.js";

export function registerReviewTools(server: McpServer) {

  // ── saveReviewCoverage ────────────────────────────────────
  server.tool(
    "saveReviewCoverage",
    "Save scope coverage analysis — maps each spec requirement to whether it's covered in the estimate. Call this once with ALL coverage items.",
    {
      items: z.array(z.object({
        specRef: z.string().describe("Spec section reference (e.g. '3.2', '4.1', 'Bid Sheet Item 3')"),
        requirement: z.string().describe("What the spec requires"),
        status: z.enum(["YES", "VERIFY", "NO"]).describe("YES = fully covered, VERIFY = partially covered or needs confirmation, NO = not covered"),
        worksheetName: z.string().optional().describe("Name of the worksheet covering this requirement"),
        notes: z.string().optional().describe("Details about coverage, what's missing, or what needs verification"),
      })),
    },
    async ({ items }) => {
      await apiPost(`/api/review/${getProjectId()}/save-section`, { section: "coverage", data: items });
      return { content: [{ type: "text" as const, text: `Saved ${items.length} coverage items` }] };
    }
  );

  // ── saveReviewFindings ────────────────────────────────────
  server.tool(
    "saveReviewFindings",
    "Save gaps and risks identified in the review — issues that need attention before quote submission.",
    {
      findings: z.array(z.object({
        id: z.string().describe("Unique finding ID (e.g. 'F1', 'F2')"),
        severity: z.enum(["CRITICAL", "WARNING", "INFO"]).describe("CRITICAL = missing scope >$5K, WARNING = questionable or unclear, INFO = observation"),
        title: z.string().describe("Short finding title"),
        description: z.string().describe("Detailed finding description with analysis"),
        specRef: z.string().optional().describe("Reference to spec section or document"),
        estimatedImpact: z.string().optional().describe("Estimated financial impact (e.g. '$5K-$10K')"),
      })),
    },
    async ({ findings }) => {
      await apiPost(`/api/review/${getProjectId()}/save-section`, { section: "findings", data: findings });
      return { content: [{ type: "text" as const, text: `Saved ${findings.length} findings` }] };
    }
  );

  // ── saveReviewCompetitiveness ─────────────────────────────
  server.tool(
    "saveReviewCompetitiveness",
    "Save competitiveness analysis — overestimates, underestimates, and productivity benchmarking data.",
    {
      overestimates: z.array(z.object({
        id: z.string().describe("Unique ID (e.g. 'OE1')"),
        impact: z.enum(["HIGH", "MEDIUM", "LOW"]).describe("Savings impact level"),
        area: z.string().describe("Area or item being analyzed"),
        analysis: z.string().describe("Detailed analysis of why this may be overestimated"),
        currentValue: z.string().optional().describe("Current quoted value/hours"),
        benchmarkValue: z.string().optional().describe("Industry benchmark value"),
        savingsRange: z.string().describe("Potential savings range (e.g. '$15K-$25K')"),
      })).optional(),
      underestimates: z.array(z.object({
        id: z.string().describe("Unique ID (e.g. 'UE1')"),
        impact: z.enum(["HIGH", "MEDIUM", "LOW"]),
        area: z.string(),
        analysis: z.string(),
        riskRange: z.string().describe("Potential underquote risk (e.g. '$5K-$10K')"),
      })).optional(),
      benchmarking: z.object({
        description: z.string().optional().describe("Benchmark methodology description"),
        streams: z.array(z.object({
          name: z.string().describe("Stream or work area name"),
          footage: z.coerce.number().optional().describe("Total footage/quantity"),
          hours: z.coerce.number().describe("Total quoted hours"),
          productionRate: z.coerce.number().optional().describe("Production rate (units/hr or ft/hr)"),
          unit: z.string().optional().describe("Unit of production rate (e.g. 'ft/hr')"),
          fmTlRatio: z.coerce.number().optional().describe("Foreman to Trade Labour ratio"),
          assessment: z.string().describe("Assessment of this rate (Good, Acceptable, Heavy, Very heavy, etc.)"),
        })),
      }).optional(),
      totalSavingsRange: z.string().optional().describe("Total potential savings range across all items"),
    },
    async (analysis) => {
      await apiPost(`/api/review/${getProjectId()}/save-section`, { section: "competitiveness", data: analysis });
      const count = (analysis.overestimates?.length || 0) + (analysis.underestimates?.length || 0);
      return { content: [{ type: "text" as const, text: `Saved competitiveness analysis: ${count} items, ${analysis.benchmarking?.streams?.length || 0} benchmarks` }] };
    }
  );

  // ── saveReviewRecommendation ──────────────────────────────
  server.tool(
    "saveReviewRecommendation",
    "Save a single actionable recommendation. Call this once for EACH recommendation. Include resolution actions that specify exactly what quote changes to make.",
    {
      id: z.string().describe("Unique recommendation ID (e.g. 'R1', 'R2')"),
      title: z.string().describe("Short recommendation title"),
      description: z.string().describe("Detailed recommendation with rationale"),
      priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
      impact: z.string().describe("Estimated impact (e.g. '$5K-$10K savings', 'Risk mitigation')"),
      category: z.string().optional().describe("Category (e.g. 'Cost Reduction', 'Scope Gap', 'Compliance', 'Accuracy')"),
      resolution: z.object({
        summary: z.string().describe("Brief description of what the resolution does"),
        actions: z.array(z.object({
          action: z.enum(["createItem", "updateItem", "deleteItem", "addCondition"]).describe("Type of quote modification"),
          worksheetId: z.string().optional().describe("Target worksheet ID (for createItem)"),
          worksheetName: z.string().optional().describe("Target worksheet name (for context)"),
          itemId: z.string().optional().describe("Target item ID (for updateItem/deleteItem)"),
          itemName: z.string().optional().describe("Target item name (for context)"),
          item: z.record(z.unknown()).optional().describe("Full item data for createItem"),
          changes: z.record(z.unknown()).optional().describe("Partial item changes for updateItem"),
          type: z.string().optional().describe("Condition type for addCondition"),
          value: z.string().optional().describe("Condition value for addCondition"),
        })),
      }),
    },
    async (rec) => {
      await apiPost(`/api/review/${getProjectId()}/save-section`, { section: "recommendations", data: rec });
      return { content: [{ type: "text" as const, text: `Saved recommendation: ${rec.title}` }] };
    }
  );

  // ── saveReviewSummary ─────────────────────────────────────
  server.tool(
    "saveReviewSummary",
    "Save the executive summary of the review. Call this LAST after all other review sections are saved.",
    {
      quoteTotal: z.coerce.number().describe("Total quoted amount"),
      worksheetCount: z.coerce.number().describe("Number of worksheets"),
      itemCount: z.coerce.number().describe("Total number of line items"),
      totalHours: z.coerce.number().optional().describe("Total labour hours"),
      coverageScore: z.string().describe("Coverage percentage (e.g. '85%')"),
      riskCount: z.object({
        critical: z.coerce.number(),
        warning: z.coerce.number(),
        info: z.coerce.number(),
      }),
      potentialSavings: z.string().optional().describe("Total potential savings range"),
      keyFindings: z.array(z.string()).describe("Top 3-5 key findings as bullet points"),
      overallAssessment: z.string().describe("1-2 sentence overall assessment of the quote"),
    },
    async (summary) => {
      await apiPost(`/api/review/${getProjectId()}/save-section`, { section: "summary", data: summary });
      return { content: [{ type: "text" as const, text: `Review summary saved. Quote total: $${summary.quoteTotal.toLocaleString()}, Coverage: ${summary.coverageScore}` }] };
    }
  );
}

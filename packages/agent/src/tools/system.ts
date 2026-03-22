import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";

type StoreOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

function createSystemTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  tags: string[];
  mutates?: boolean;
}, operation: StoreOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "system",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: false,
      mutates: def.mutates ?? false,
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
// system.listTools
// ──────────────────────────────────────────────────────────────
export const listToolsTool = createSystemTool({
  id: "system.listTools",
  name: "List Available Tools",
  description: "List all available tools, optionally filtered by category or search query. Use this to discover what tools are available.",
  inputSchema: z.object({
    category: z.enum(["quote", "knowledge", "vision", "analysis", "dynamic", "system"]).optional().describe("Filter by tool category"),
    search: z.string().optional().describe("Search tools by name or description"),
  }),
  tags: ["tools", "discovery", "read"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Tool list would be returned here", filters: input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// system.getProjectSummary
// ──────────────────────────────────────────────────────────────
export const getProjectSummaryTool = createSystemTool({
  id: "system.getProjectSummary",
  name: "Get Project Summary",
  description: "Get a compact summary of the current project including name, client, revision count, total value, item count, and key dates.",
  inputSchema: z.object({}),
  tags: ["project", "summary", "read"],
}, async (ctx) => {
  return { success: true, data: { message: "Project summary would be returned here", projectId: ctx.projectId }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// system.getDocumentList
// ──────────────────────────────────────────────────────────────
export const getDocumentListTool = createSystemTool({
  id: "system.getDocumentList",
  name: "List Source Documents",
  description: "List all source documents (plans, specs, RFPs) uploaded to this project with their processing status and page counts.",
  inputSchema: z.object({
    status: z.enum(["pending", "processing", "completed", "failed"]).optional().describe("Filter by processing status"),
  }),
  tags: ["documents", "read"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Document list would be returned here", projectId: ctx.projectId, filters: input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// system.getCitations
// ──────────────────────────────────────────────────────────────
export const getCitationsTool = createSystemTool({
  id: "system.getCitations",
  name: "Get Citations",
  description: "Retrieve citations linking line items or decisions back to source documents. Can filter by document or item.",
  inputSchema: z.object({
    documentId: z.string().optional().describe("Filter citations by source document ID"),
    itemId: z.string().optional().describe("Filter citations by line item ID"),
    limit: z.number().optional().default(20).describe("Maximum number of citations to return"),
  }),
  tags: ["citations", "documents", "read"],
}, async (ctx, input) => {
  return { success: true, data: { message: "Citations would be returned here", filters: input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// system.logActivity
// ──────────────────────────────────────────────────────────────
export const logActivityTool = createSystemTool({
  id: "system.logActivity",
  name: "Log Activity",
  description: "Record an activity or decision in the project audit log for traceability.",
  inputSchema: z.object({
    action: z.string().describe("Description of the action taken"),
    category: z.enum(["estimate", "review", "document", "communication", "system"]).default("system").describe("Activity category"),
    details: z.string().optional().describe("Additional details or reasoning"),
    relatedItemIds: z.array(z.string()).optional().describe("IDs of related items or entities"),
  }),
  tags: ["activity", "audit", "write"],
  mutates: true,
}, async (ctx, input) => {
  return { success: true, data: { message: "Activity logged", input }, duration_ms: 0 };
});

// ──────────────────────────────────────────────────────────────
// system.askUser
// ──────────────────────────────────────────────────────────────
export const askUserTool = createSystemTool({
  id: "system.askUser",
  name: "Ask User",
  description: "Pause execution and ask the user a question. Use when you need clarification, confirmation for an ambiguous request, or user input before proceeding.",
  inputSchema: z.object({
    question: z.string().describe("The question to ask the user"),
    options: z.array(z.string()).optional().describe("Optional list of suggested answers the user can choose from"),
    context: z.string().optional().describe("Additional context explaining why you are asking"),
  }),
  tags: ["user", "interaction", "pause"],
}, async (ctx, input) => {
  return {
    success: true,
    data: {
      action: "pause_for_user_input",
      question: input.question,
      options: input.options,
      context: input.context,
    },
    duration_ms: 0,
  };
});

// ──────────────────────────────────────────────────────────────
// Export all system tools
// ──────────────────────────────────────────────────────────────
export const systemTools: Tool[] = [
  listToolsTool,
  getProjectSummaryTool,
  getDocumentListTool,
  getCitationsTool,
  logActivityTool,
  askUserTool,
];

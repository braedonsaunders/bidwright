import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type StoreOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<Omit<ToolResult, 'duration_ms'>>;

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
    category: z.enum(["quote", "knowledge", "vision", "analysis", "dynamic", "system", "web"]).optional().describe("Filter by tool category"),
    search: z.string().optional().describe("Search tools by name or description"),
  }),
  tags: ["tools", "discovery", "read"],
}, async (ctx, input) => {
  const params = new URLSearchParams();
  if (input.category) params.set("category", input.category as string);
  if (input.search) params.set("search", input.search as string);

  const qs = params.toString();
  const url = `${ctx.apiBaseUrl}/api/tools${qs ? `?${qs}` : ""}`;
  const res = await apiFetch(ctx, url);
  if (!res.ok) return { success: false, error: `API error: ${res.status}`, duration_ms: 0 };
  const data = await res.json();
  return { success: true, data };
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
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!res.ok) return { success: false, error: `API error: ${res.status}` };
  const workspace: any = await res.json();

  const items: any[] = workspace.items ?? workspace.lineItems ?? [];
  const documents: any[] = workspace.documents ?? [];
  const totalValue = items.reduce((sum: number, i: any) => sum + Number(i.totalCost ?? i.total ?? 0), 0);

  return {
    success: true,
    data: {
      projectId: ctx.projectId,
      name: workspace.name ?? workspace.projectName ?? "Untitled Project",
      description: workspace.description ?? null,
      client: workspace.client ?? workspace.clientName ?? null,
      revisionId: ctx.revisionId,
      quoteId: ctx.quoteId,
      totalValue,
      itemCount: items.length,
      documentCount: documents.length,
      categories: [...new Set(items.map((i: any) => (i.category ?? i.division ?? "Uncategorized").toString()))],
      createdAt: workspace.createdAt ?? null,
      updatedAt: workspace.updatedAt ?? null,
    },
  };
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
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/documents/${ctx.projectId}`);
  if (!res.ok) return { success: false, error: `API error: ${res.status}` };
  let documents: any = await res.json();

  // Handle if response is wrapped in an object
  if (!Array.isArray(documents) && documents.documents) {
    documents = documents.documents;
  }

  // Filter by status if provided
  const status = input.status as string | undefined;
  if (status) {
    documents = documents.filter((d: any) => d.status === status);
  }

  return {
    success: true,
    data: {
      projectId: ctx.projectId,
      totalDocuments: documents.length,
      documents: documents.map((d: any) => ({
        id: d.id,
        name: d.name ?? d.filename,
        mimeType: d.mimeType ?? null,
        status: d.status ?? null,
        pageCount: d.pageCount ?? d.pages ?? null,
        fileSize: d.fileSize ?? d.size ?? null,
        uploadedAt: d.uploadedAt ?? d.createdAt ?? null,
      })),
    },
  };
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
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/workspace`);
  if (!res.ok) return { success: false, error: `API error: ${res.status}` };
  const workspace: any = await res.json();

  let citations: any[] = workspace.citations ?? [];

  const documentId = input.documentId as string | undefined;
  const itemId = input.itemId as string | undefined;
  const limit = (input.limit as number) ?? 20;

  if (documentId) {
    citations = citations.filter((c: any) => c.documentId === documentId);
  }
  if (itemId) {
    citations = citations.filter((c: any) => c.itemId === itemId || c.lineItemId === itemId);
  }

  citations = citations.slice(0, limit);

  return {
    success: true,
    data: {
      totalCitations: citations.length,
      citations: citations.map((c: any) => ({
        documentId: c.documentId,
        itemId: c.itemId ?? c.lineItemId ?? null,
        excerpt: c.excerpt ?? null,
        pageStart: c.pageStart ?? c.page ?? null,
        pageEnd: c.pageEnd ?? null,
        confidence: c.confidence ?? null,
      })),
    },
  };
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
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${ctx.projectId}/activities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: input.action,
      category: input.category ?? "system",
      details: input.details ?? null,
      relatedItemIds: input.relatedItemIds ?? [],
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      timestamp: new Date().toISOString(),
    }),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status}`, duration_ms: 0 };
  const data = await res.json();
  return { success: true, data };
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
}, async (_ctx, input) => {
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

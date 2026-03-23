import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type ProjectFileOperationResult = { success: boolean; data?: unknown; error?: string; citations?: ToolResult["citations"]; sideEffects?: string[]; duration_ms?: number };
type ProjectFileOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ProjectFileOperationResult>;

/**
 * Factory for project-file tools. Mirrors the createKnowledgeTool pattern
 * but uses the "project" category for grouping in the LLM tool list.
 */
function createProjectFileTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  requiresConfirmation?: boolean;
  mutates?: boolean;
  tags: string[];
}, operation: ProjectFileOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "knowledge",
      description: def.description,
      parameters: [],
      inputSchema: def.inputSchema,
      requiresConfirmation: def.requiresConfirmation ?? false,
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
// 1. project.listFiles
// ──────────────────────────────────────────────────────────────
export const listFilesTool = createProjectFileTool({
  id: "project.listFiles",
  name: "List Project Files",
  description: "List all files and documents in a project. Optionally filter by filename pattern or document type (specs, drawings, rfq, submittals, schedules).",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    filter: z.string().optional().describe("Filter by filename pattern"),
    type: z.enum(["all", "specs", "drawings", "rfq", "submittals", "schedules", "other"]).optional().describe("Filter by document type"),
  }),
  tags: ["project", "files", "read"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  const params = new URLSearchParams();
  if (input.filter) params.set("filter", String(input.filter));
  if (input.type) params.set("type", String(input.type));
  const qs = params.toString();
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/documents/${pid}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 2. project.readFile
// ──────────────────────────────────────────────────────────────
export const readFileTool = createProjectFileTool({
  id: "project.readFile",
  name: "Read Project File",
  description: "Read the full content of a project document. Optionally specify a page range to read a subset of a large document (e.g. '1-5' or '10').",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    documentId: z.string().describe("Document ID to read"),
    pageRange: z.string().optional().describe("Page range to read, e.g. '1-5' or '10'"),
  }),
  tags: ["project", "files", "read"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  const params = new URLSearchParams();
  if (input.pageRange) params.set("pages", String(input.pageRange));
  const qs = params.toString();
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/documents/${pid}/${input.documentId}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 3. project.searchFiles
// ──────────────────────────────────────────────────────────────
export const searchFilesTool = createProjectFileTool({
  id: "project.searchFiles",
  name: "Search Project Files",
  description: "Full-text search across all project documents. Returns matching excerpts with document references. Useful for finding specific specs, clauses, or scope items.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    query: z.string().describe("Search query"),
    type: z.enum(["all", "specs", "drawings", "rfq", "submittals"]).optional().describe("Filter results by document type"),
    limit: z.number().optional().default(10).describe("Maximum number of results to return"),
  }),
  tags: ["project", "files", "search", "read"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  const params = new URLSearchParams({ q: String(input.query) });
  if (pid) params.set("projectId", pid);
  if (input.type) params.set("type", String(input.type));
  if (input.limit) params.set("limit", String(input.limit));
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/search?${params.toString()}`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 4. project.analyzeDocument
// ──────────────────────────────────────────────────────────────
export const analyzeDocumentTool = createProjectFileTool({
  id: "project.analyzeDocument",
  name: "Analyze Project Document",
  description: "Deep analysis of a project document using vision and LLM capabilities. Supports summary, scope extraction, quantity takeoff, spec requirements extraction, and drawing review.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    documentId: z.string().describe("Document ID to analyze"),
    analysisType: z.enum(["summary", "scope_extraction", "quantity_takeoff", "spec_requirements", "drawing_review"]).describe("Type of analysis to perform"),
    focusArea: z.string().optional().describe("Specific area or section to focus on"),
  }),
  tags: ["project", "files", "analysis"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: input.documentId,
        projectId: pid,
        analysisType: input.analysisType,
        focusArea: input.focusArea ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 5. project.ingestDocument
// ──────────────────────────────────────────────────────────────
export const ingestProjectDocumentTool = createProjectFileTool({
  id: "project.ingestDocument",
  name: "Ingest Project Document",
  description: "Trigger ingestion of a project document into the knowledge system. Parses, chunks, and indexes the document so it can be searched and referenced by the agent.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    documentId: z.string().describe("Document ID to ingest"),
    title: z.string().optional().describe("Override title for the document in the knowledge base"),
    category: z.enum(["estimating", "labour", "equipment", "materials", "safety", "standards", "general"]).optional().describe("Knowledge category for the document"),
  }),
  mutates: true,
  tags: ["project", "files", "knowledge", "write"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: input.documentId,
        projectId: pid,
        title: input.title ?? null,
        category: input.category ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["document_ingested"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 6. project.getDocumentManifest
// ──────────────────────────────────────────────────────────────
export const getDocumentManifestTool = createProjectFileTool({
  id: "project.getDocumentManifest",
  name: "Get Document Manifest",
  description:
    "Get a high-level manifest of all documents in the project. Returns each document's name, type classification (RFQ, spec, drawing, schedule, etc.), page count, and indexing status. Use this first to understand what's in the bid package before diving into specific documents.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
  }),
  tags: ["project", "files", "read", "manifest"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/documents/${pid}/enhanced`);
    if (!res.ok) {
      // Fallback to basic document listing
      const fallbackRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/documents/${pid}`);
      const fallbackData = await fallbackRes.json();
      return { success: true, data: fallbackData };
    }
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 7. project.extractScopeItems
// ──────────────────────────────────────────────────────────────
export const extractScopeItemsTool = createProjectFileTool({
  id: "project.extractScopeItems",
  name: "Extract Scope Items",
  description:
    "Analyze a document to extract scope of work items. Uses AI to identify deliverables, tasks, and requirements from specs, RFQs, and other project documents. Optionally focus on a specific trade or section.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    documentId: z.string().describe("Document ID to analyze for scope items"),
    focusArea: z.string().optional().describe("Focus on a specific trade, division, or section (e.g. 'Division 26 Electrical', 'HVAC systems')"),
  }),
  tags: ["project", "files", "analysis", "scope"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: input.documentId,
        projectId: pid,
        analysisType: "scope_extraction",
        focusArea: input.focusArea ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 8. project.extractQuantities
// ──────────────────────────────────────────────────────────────
export const extractQuantitiesTool = createProjectFileTool({
  id: "project.extractQuantities",
  name: "Extract Quantities",
  description:
    "Analyze a document to extract quantities for estimating. Uses AI to identify measurable quantities like linear feet of conduit, number of fixtures, square footage, etc. Optionally focus on a specific trade or material type.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    documentId: z.string().describe("Document ID to analyze for quantities"),
    focusArea: z.string().optional().describe("Focus on specific quantities (e.g. 'lighting fixtures', 'cable tray', 'ductwork')"),
  }),
  tags: ["project", "files", "analysis", "quantities", "takeoff"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/knowledge/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId: input.documentId,
        projectId: pid,
        analysisType: "quantity_takeoff",
        focusArea: input.focusArea ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 9. project.getFileTree
// ──────────────────────────────────────────────────────────────
export const getFileTreeTool = createProjectFileTool({
  id: "project.getFileTree",
  name: "Get File Tree",
  description: "Get the full hierarchical file tree for the project. Returns all directories and files with their parent-child relationships, sizes, and types. Use this to understand the project's file organization.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    scope: z.enum(["project", "knowledge"]).optional().describe("Filter by scope"),
  }),
  tags: ["project", "files", "read", "tree"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  const params = new URLSearchParams();
  if (input.scope) params.set("scope", String(input.scope));
  const qs = params.toString();
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${pid}/files/tree${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 10. project.createFolder
// ──────────────────────────────────────────────────────────────
export const createFolderTool = createProjectFileTool({
  id: "project.createFolder",
  name: "Create Folder",
  description: "Create a new directory in the project file tree. Optionally specify a parent folder to create a nested directory.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    name: z.string().describe("Folder name"),
    parentId: z.string().optional().describe("Parent folder ID to nest under (root if omitted)"),
  }),
  mutates: true,
  tags: ["project", "files", "write", "folder"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${pid}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        type: "directory",
        parentId: input.parentId ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["folder_created"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 11. project.moveFile
// ──────────────────────────────────────────────────────────────
export const moveFileTool = createProjectFileTool({
  id: "project.moveFile",
  name: "Move File or Folder",
  description: "Move a file or folder to a different parent directory. Set parentId to null to move to root level.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    nodeId: z.string().describe("ID of the file or folder to move"),
    parentId: z.string().nullable().describe("ID of the destination folder, or null for root"),
  }),
  mutates: true,
  requiresConfirmation: true,
  tags: ["project", "files", "write", "move"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${pid}/files/${input.nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: input.parentId }),
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["file_moved"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 12. project.renameFile
// ──────────────────────────────────────────────────────────────
export const renameFileTool = createProjectFileTool({
  id: "project.renameFile",
  name: "Rename File or Folder",
  description: "Rename a file or folder in the project file tree.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    nodeId: z.string().describe("ID of the file or folder to rename"),
    name: z.string().describe("New name for the file or folder"),
  }),
  mutates: true,
  tags: ["project", "files", "write", "rename"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${pid}/files/${input.nodeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name }),
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["file_renamed"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 13. project.deleteFile
// ──────────────────────────────────────────────────────────────
export const deleteFileTool = createProjectFileTool({
  id: "project.deleteFile",
  name: "Delete File or Folder",
  description: "Delete a file or folder from the project file tree. If deleting a folder, all contents are removed recursively. This action cannot be undone.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    nodeId: z.string().describe("ID of the file or folder to delete"),
  }),
  mutates: true,
  requiresConfirmation: true,
  tags: ["project", "files", "write", "delete"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${pid}/files/${input.nodeId}`, {
      method: "DELETE",
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["file_deleted"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// 14. project.uploadFileFromUrl
// ──────────────────────────────────────────────────────────────
export const uploadFileFromUrlTool = createProjectFileTool({
  id: "project.uploadFileFromUrl",
  name: "Upload File from URL",
  description: "Download a file from a URL and add it to the project file tree. Useful for pulling in vendor cut sheets, spec PDFs, or reference documents from the web.",
  inputSchema: z.object({
    projectId: z.string().optional().describe("Project ID (defaults to current project)"),
    url: z.string().describe("URL of the file to download"),
    name: z.string().optional().describe("Override filename (derived from URL if omitted)"),
    parentId: z.string().optional().describe("Parent folder ID (root if omitted)"),
  }),
  mutates: true,
  tags: ["project", "files", "write", "upload", "web"],
}, async (ctx, input) => {
  const pid = (input.projectId as string) || ctx.projectId;
  try {
    const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/projects/${pid}/files/upload-from-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: input.url,
        name: input.name ?? undefined,
        parentId: input.parentId ?? null,
      }),
    });
    const data = await res.json();
    return { success: true, data, sideEffects: ["file_uploaded"] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ──────────────────────────────────────────────────────────────
// Export all project file tools as array
// ──────────────────────────────────────────────────────────────
export const projectFileTools: Tool[] = [
  listFilesTool,
  readFileTool,
  searchFilesTool,
  analyzeDocumentTool,
  ingestProjectDocumentTool,
  getDocumentManifestTool,
  extractScopeItemsTool,
  extractQuantitiesTool,
  getFileTreeTool,
  createFolderTool,
  moveFileTool,
  renameFileTool,
  deleteFileTool,
  uploadFileFromUrlTool,
];

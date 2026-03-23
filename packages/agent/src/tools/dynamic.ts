import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult, ToolParameter, DynamicToolConfig } from "../types.js";
import { apiFetch } from "./api-fetch.js";

type DynamicOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<Omit<ToolResult, 'duration_ms'>>;

function createDynamicTool(def: {
  id: string;
  name: string;
  description: string;
  inputSchema: z.ZodType;
  requiresConfirmation?: boolean;
  mutates?: boolean;
  tags: string[];
}, operation: DynamicOperation): Tool {
  return {
    definition: {
      id: def.id,
      name: def.name,
      category: "dynamic",
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

const toolParameterSchema: z.ZodType<ToolParameter> = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string(),
  required: z.boolean(),
  enum: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});

const implementationSchema: z.ZodType<DynamicToolConfig["implementation"]> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("calculation"), formula: z.string() }),
  z.object({ type: z.literal("prompt_template"), prompt: z.string() }),
  z.object({ type: z.literal("api_call"), url: z.string(), method: z.string(), bodyTemplate: z.string() }),
  z.object({ type: z.literal("javascript"), code: z.string() }),
]);

// ──────────────────────────────────────────────────────────────
// 1. dynamic.createTool
// ──────────────────────────────────────────────────────────────
export const createToolTool = createDynamicTool({
  id: "dynamic.createTool",
  name: "Create Dynamic Tool",
  description: "Create a new dynamic tool that can be used in future agent sessions. Supports calculation formulas, prompt templates, API calls, and JavaScript implementations.",
  inputSchema: z.object({
    name: z.string().describe("Name for the new tool"),
    description: z.string().describe("Description of what the tool does"),
    parameters: z.array(toolParameterSchema).describe("Input parameters for the tool"),
    implementation: implementationSchema.describe("Implementation configuration for the tool"),
  }),
  mutates: true,
  tags: ["dynamic", "create", "write"],
}, async (ctx, input) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/tools/dynamic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      parameters: input.parameters,
      implementation: input.implementation,
      createdBy: ctx.userId,
    }),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status}`, duration_ms: 0 };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 2. dynamic.listTools
// ──────────────────────────────────────────────────────────────
export const listToolsTool = createDynamicTool({
  id: "dynamic.listTools",
  name: "List Dynamic Tools",
  description: "List all user-created dynamic tools with their configurations and enabled status.",
  inputSchema: z.object({}),
  tags: ["dynamic", "list", "read"],
}, async (ctx) => {
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/tools/dynamic`);
  if (!res.ok) return { success: false, error: `API error: ${res.status}`, duration_ms: 0 };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 3. dynamic.executeTool
// ──────────────────────────────────────────────────────────────
export const executeToolTool = createDynamicTool({
  id: "dynamic.executeTool",
  name: "Execute Dynamic Tool",
  description: "Execute a user-created dynamic tool by its ID with the provided input parameters.",
  inputSchema: z.object({
    toolId: z.string().describe("ID of the dynamic tool to execute"),
    input: z.record(z.unknown()).describe("Input parameters for the tool execution"),
  }),
  tags: ["dynamic", "execute"],
}, async (ctx, input) => {
  const toolId = input.toolId as string;
  const toolInput = (input.input ?? {}) as Record<string, unknown>;

  // Fetch the tool config
  const listRes = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/tools/dynamic`);
  if (!listRes.ok) return { success: false, error: `API error fetching tools: ${listRes.status}`, duration_ms: 0 };
  const tools: any = await listRes.json();
  const toolConfig = (Array.isArray(tools) ? tools : (tools as any).tools ?? []).find(
    (t: any) => t.id === toolId || t.toolId === toolId
  );
  if (!toolConfig) return { success: false, error: `Dynamic tool not found: ${toolId}`, duration_ms: 0 };
  if (toolConfig.enabled === false) return { success: false, error: `Dynamic tool is disabled: ${toolId}`, duration_ms: 0 };

  const impl = toolConfig.implementation;

  switch (impl.type) {
    case "calculation": {
      // Evaluate formula with input variables
      try {
        const vars = Object.entries(toolInput).map(([k, v]) => `const ${k} = ${JSON.stringify(v)};`).join("\n");
        const fn = new Function(`${vars}\nreturn (${impl.formula});`);
        const result = fn();
        return { success: true, data: { result, formula: impl.formula } };
      } catch (err) {
        return { success: false, error: `Formula evaluation error: ${err instanceof Error ? err.message : String(err)}`, duration_ms: 0 };
      }
    }

    case "prompt_template": {
      // Replace {{variable}} placeholders with input values
      let prompt = impl.prompt;
      for (const [key, value] of Object.entries(toolInput)) {
        prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), String(value));
      }
      return { success: true, data: { formattedPrompt: prompt } };
    }

    case "api_call": {
      try {
        let body = impl.bodyTemplate;
        for (const [key, value] of Object.entries(toolInput)) {
          body = body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), JSON.stringify(value));
        }
        const apiRes = await fetch(impl.url, {
          method: impl.method,
          headers: { "Content-Type": "application/json" },
          body: impl.method.toUpperCase() !== "GET" ? body : undefined,
        });
        if (!apiRes.ok) return { success: false, error: `API call failed: ${apiRes.status}`, duration_ms: 0 };
        const data = await apiRes.json();
        return { success: true, data };
      } catch (err) {
        return { success: false, error: `API call error: ${err instanceof Error ? err.message : String(err)}`, duration_ms: 0 };
      }
    }

    case "javascript": {
      try {
        const fn = new Function("input", "context", impl.code);
        const result = await fn(toolInput, { projectId: ctx.projectId, userId: ctx.userId });
        return { success: true, data: { result } };
      } catch (err) {
        return { success: false, error: `JavaScript execution error: ${err instanceof Error ? err.message : String(err)}`, duration_ms: 0 };
      }
    }

    default:
      return { success: false, error: `Unknown implementation type: ${(impl as any).type}`, duration_ms: 0 };
  }
});

// ──────────────────────────────────────────────────────────────
// 4. dynamic.updateTool
// ──────────────────────────────────────────────────────────────
export const updateToolTool = createDynamicTool({
  id: "dynamic.updateTool",
  name: "Update Dynamic Tool",
  description: "Update an existing dynamic tool's configuration. Only fields provided will be changed.",
  inputSchema: z.object({
    toolId: z.string().describe("ID of the dynamic tool to update"),
    name: z.string().optional().describe("New name"),
    description: z.string().optional().describe("New description"),
    parameters: z.array(toolParameterSchema).optional().describe("New parameters"),
    implementation: implementationSchema.optional().describe("New implementation configuration"),
    enabled: z.boolean().optional().describe("Enable or disable the tool"),
  }),
  mutates: true,
  tags: ["dynamic", "update", "write"],
}, async (ctx, input) => {
  const toolId = input.toolId as string;
  const { toolId: _, ...updates } = input;

  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/tools/dynamic/${toolId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status}`, duration_ms: 0 };
  const data = await res.json();
  return { success: true, data };
});

// ──────────────────────────────────────────────────────────────
// 5. dynamic.deleteTool
// ──────────────────────────────────────────────────────────────
export const deleteToolTool = createDynamicTool({
  id: "dynamic.deleteTool",
  name: "Delete Dynamic Tool",
  description: "Delete a user-created dynamic tool. This action requires confirmation.",
  inputSchema: z.object({
    toolId: z.string().describe("ID of the dynamic tool to delete"),
  }),
  requiresConfirmation: true,
  mutates: true,
  tags: ["dynamic", "delete", "write"],
}, async (ctx, input) => {
  const toolId = input.toolId as string;
  const res = await apiFetch(ctx, `${ctx.apiBaseUrl}/api/tools/dynamic/${toolId}`, {
    method: "DELETE",
  });
  if (!res.ok) return { success: false, error: `API error: ${res.status}`, duration_ms: 0 };
  return { success: true, data: { deleted: true, toolId } };
});

// ──────────────────────────────────────────────────────────────
// Export all tools as array
// ──────────────────────────────────────────────────────────────
export const dynamicTools: Tool[] = [
  createToolTool,
  listToolsTool,
  executeToolTool,
  updateToolTool,
  deleteToolTool,
];

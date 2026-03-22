import { z } from "zod";
import type { Tool, ToolExecutionContext, ToolResult, ToolParameter, DynamicToolConfig } from "../types.js";

type DynamicOperation = (ctx: ToolExecutionContext, input: Record<string, unknown>) => Promise<ToolResult>;

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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Dynamic tool created", input }, duration_ms: 0 };
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
}, async () => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Dynamic tools list would be returned here" }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Dynamic tool execution result would be returned here", input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Dynamic tool updated", input }, duration_ms: 0 };
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
}, async (_ctx, input) => {
  // TODO: wire to actual implementation
  return { success: true, data: { message: "Dynamic tool deleted", toolId: input.toolId }, duration_ms: 0 };
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
